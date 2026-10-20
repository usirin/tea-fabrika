// A program's journal on the ledger: experiment 94's fenced store (../94-tea-host/store.ts) for
// any state with a Schema, not only the counter's. Every save is one append to the program's
// registry stream, at the rev it last saw and under the fence of the host's claim: a newer claim
// refuses it (`stale`), and so does a lease that ran out (`fenced`). A refusal is tea's
// `StoreConflictError`. tea saves a step's state before it runs that step's Cmds, so a refused
// save also stops the Cmds: a host that lost its name sends nothing for that step.
import {type FencedStore, refuse, StoreConflictError} from "@demlik/tea";
import {Cause, Duration, Effect, Exit, Schema} from "effect";
import type {Ledger, Row} from "./client.ts";

/** What a host says about each write, for the harness. */
export type WriteNote = {
	readonly ev: "write";
	readonly fence: number;
	readonly expected: number;
	readonly ok: boolean;
	readonly why: string | null;
	readonly rev: number | null;
	readonly sentAt: number;
	readonly at: number;
};

/** The last `state` event of a registry stream, and the rev the stream ends at. */
export const lastStateOf =
	<S>(schema: Schema.Codec<S, unknown>) =>
	(rows: readonly Row[]): {readonly state: S | null; readonly version: number} => {
		const decode = Schema.decodeUnknownExit(
			Schema.fromJsonString(Schema.Struct({fence: Schema.Number, state: schema})),
		);
		const at = rows.findLast((r) => r.kind === "state");
		const exit = at === undefined ? null : decode(at.data);
		return {
			state: exit !== null && Exit.isSuccess(exit) ? exit.value.state : null,
			version: rows.at(-1)?.rev ?? 0,
		};
	};

const promised = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
	Effect.runPromiseExit(effect).then((exit) =>
		Exit.isSuccess(exit) ? exit.value : Promise.reject(Cause.squash(exit.cause)),
	);

export const ledgerStore = <S>(
	ledger: Ledger["Service"],
	o: {
		readonly schema: Schema.Codec<S, unknown>;
		readonly stream: string;
		readonly fence: number;
		readonly holder: string;
		readonly note: (n: WriteNote, state: S) => void;
	},
): FencedStore<S> => {
	const lastState = lastStateOf(o.schema);
	const load = Effect.map(ledger.readStream(o.stream), lastState);
	/** A save whose answer was lost landed if the stream ends with it, by this writer. */
	const landed = (rows: readonly Row[], expected: number, state: S) => {
		const end = rows.at(-1);
		if (end === undefined || end.rev !== expected + 1 || end.writer !== o.holder) return false;
		return JSON.stringify(lastState([end]).state) === JSON.stringify(state);
	};

	const save = (state: S, expected: number) =>
		Effect.gen(function* () {
			const sentAt = Date.now();
			const note = (ok: boolean, why: string | null, rev: number | null) =>
				o.note(
					{ev: "write", fence: o.fence, expected, ok, why, rev, sentAt, at: Date.now()},
					state,
				);
			for (let tries = 1; ; tries++) {
				const sent = yield* ledger
					.append(
						o.stream,
						expected,
						{kind: "state", writer: o.holder, data: {fence: o.fence, state}},
						o.fence,
					)
					.pipe(Effect.result);
				if (sent._tag === "Success") {
					const r = sent.success;
					if (r.ok) {
						note(true, null, r.rev);
						return r.rev;
					}
					const actual = r.why === "stale" ? r.rev : expected;
					note(false, r.why, actual);
					return yield* Effect.fail(new StoreConflictError(expected, actual));
				}
				// No answer: the append may have landed. Read the end of the stream before trying again.
				yield* Effect.sleep(Duration.millis(50));
				const rows = yield* ledger.readStream(o.stream).pipe(Effect.orElseSucceed(() => null));
				if (rows !== null && landed(rows, expected, state)) {
					note(true, "answer lost, landed", expected + 1);
					return expected + 1;
				}
				const end = rows?.at(-1)?.rev ?? 0;
				if (rows !== null && end !== expected) {
					note(false, "stale", end);
					return yield* Effect.fail(new StoreConflictError(expected, end));
				}
				if (tries >= 20) {
					note(false, "unreachable", null);
					return yield* Effect.fail(new StoreConflictError(expected, -1));
				}
			}
		});

	const decode = Schema.decodeUnknownExit(o.schema);
	return {
		fenced: true,
		load: () => promised(Effect.map(load, (l) => l.state)),
		loadFenced: () => promised(Effect.map(load, (l) => ({raw: l.state, version: l.version}))),
		saveFenced: (state, expected) => promised(save(state, expected)),
		save: () => Promise.reject(new Error("the journal saves only through saveFenced")),
		migrate: (raw) => {
			if (raw === null || raw === undefined) return null;
			const exit = decode(raw);
			return Exit.isSuccess(exit) ? exit.value : refuse("not a saved state");
		},
	};
};
