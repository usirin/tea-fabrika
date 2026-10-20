// A program's journal on the one ledger: a tea `FencedStore` for any state with a Schema. It merges
// experiment 95's store (../95-agents-across-hosts/store.ts: any state, saved on the registry
// stream) and experiment 96's (../96-ledger-mailbox/store.ts: the counter's state on its own
// `<name>/state` stream, read back with `readLast`, each save carrying an id).
//
// Every save is one append to `<name>/state`, at the rev it last saw, under the fence of the host's
// claim. Three guards, all in the ledger: the rev (nothing saved since this run's last save or
// load), the fence (only while this claim's lease is live), and, new in 97, the guard on the name:
// a save that forgot its fence is `denied`, so only a lease holder can ever write a program's state.
// A refusal is tea's `StoreConflictError`. tea saves a step before it runs that step's Cmds, so a
// refused save also stops the Cmds: a host that lost its name sends nothing for that step.
//
// A save whose answer was lost is sent again with the same id; the ledger answers `dup` if the
// first landed. The id comes from the program (`saveId`): the counter's is its cursor, as in 96;
// a program whose state can change without its cursor moving uses the rev it expects.
import {type FencedStore, refuse, StoreConflictError} from "@demlik/tea";
import {Cause, Duration, Effect, Exit, Schema} from "effect";
import type {Ledger, Row} from "./service.ts";

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

/** The last event of a state stream, decoded, and the rev the stream ends at. */
export const lastStateOf =
	<S>(schema: Schema.Codec<S, unknown>) =>
	(rows: readonly Row[]): {readonly state: S | null; readonly version: number} => {
		const decode = Schema.decodeUnknownExit(
			Schema.fromJsonString(Schema.Struct({fence: Schema.Number, state: schema})),
		);
		const at = rows.at(-1);
		const exit = at === undefined ? null : decode(at.data);
		return {
			state: exit !== null && Exit.isSuccess(exit) ? exit.value.state : null,
			version: at?.rev ?? 0,
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
		/** `<name>/state`. */
		readonly stream: string;
		readonly fence: number;
		readonly holder: string;
		/** This save's message id, without the fence (the store puts the fence in front). */
		readonly saveId: (state: S, expected: number) => string;
		readonly note: (n: WriteNote, state: S) => void;
	},
): FencedStore<S> => {
	const lastState = lastStateOf(o.schema);
	const load = Effect.map(ledger.readLast(o.stream, 1), lastState);

	const save = (state: S, expected: number) =>
		Effect.gen(function* () {
			const sentAt = Date.now();
			const note = (ok: boolean, why: string | null, rev: number | null) =>
				o.note(
					{ev: "write", fence: o.fence, expected, ok, why, rev, sentAt, at: Date.now()},
					state,
				);
			const event = {
				kind: "state",
				writer: o.holder,
				data: {fence: o.fence, state},
				id: `${o.fence}:${o.saveId(state, expected)}`,
			};
			for (let tries = 1; ; tries++) {
				const sent = yield* ledger.append(o.stream, expected, event, o.fence).pipe(Effect.result);
				if (sent._tag === "Success") {
					note(true, sent.success.dup ? "answer lost, landed" : null, sent.success.rev);
					return sent.success.rev;
				}
				const e = sent.failure;
				if (e._tag === "Stale") {
					note(false, "stale", e.rev);
					return yield* Effect.fail(new StoreConflictError(expected, e.rev));
				}
				if (e._tag === "Fenced" || e._tag === "Denied") {
					note(false, e._tag === "Fenced" ? "fenced" : "denied", expected);
					return yield* Effect.fail(new StoreConflictError(expected, expected));
				}
				// No answer: the append may have landed. Its id makes sending it again safe.
				if (tries >= 20) {
					note(false, "unreachable", null);
					return yield* Effect.fail(new StoreConflictError(expected, -1));
				}
				yield* Effect.sleep(Duration.millis(50));
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
