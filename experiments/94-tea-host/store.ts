// The counter's journal on the ledger: a tea `FencedStore` whose every save is one append to the
// registry stream, at the rev it last saw and under the fence of the host's claim. Two guards,
// both in the ledger's one INSERT (experiment 93's `sql.ts`):
//
//   - the rev: a save lands only if nothing was appended since this run's last save or load, so
//     a newer claim, or the alarm's `lease_expired`, refuses it (`stale`);
//   - the fence: a save lands only while this claim's lease is live, so a host that slept past
//     its lease is refused even when nobody has claimed since (`fenced`).
//
// A refusal is tea's `StoreConflictError`: the run stops where it stands, and the program's
// `main` fails. The fence goes into each state event, so the log alone shows who wrote what.
//
// Why the registry stream and not a stream of its own: 93's fence guards only the stream its
// lease is on (`leases.stream = ?1`). Progress beside the claim keeps 93's ledger unchanged.
import {type FencedStore, refuse, StoreConflictError} from "@demlik/tea";
import {Cause, Duration, Effect, Exit, Schema} from "effect";
import {Count} from "./counter.ts";
import type {Ledger, Row} from "./ledger.ts";

/** What a host says about each write, for the harness. */
export type WriteNote = {
	readonly ev: "write";
	readonly fence: number;
	readonly expected: number;
	readonly ok: boolean;
	readonly why: string | null;
	readonly rev: number | null;
	readonly count: number;
	readonly sentAt: number;
	readonly at: number;
};

const StateData = Schema.Struct({fence: Schema.Number, state: Count});
const decodeState = Schema.decodeUnknownExit(Schema.fromJsonString(StateData));

/** The last `state` event of a registry stream, and the rev the stream ends at. */
export const lastState = (rows: readonly Row[]) => {
	const at = rows.findLast((r) => r.kind === "state");
	const exit = at === undefined ? null : decodeState(at.data);
	return {
		state: exit !== null && Exit.isSuccess(exit) ? exit.value.state : null,
		version: rows.at(-1)?.rev ?? 0,
	};
};

const promised = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
	Effect.runPromiseExit(effect).then((exit) =>
		Exit.isSuccess(exit) ? exit.value : Promise.reject(Cause.squash(exit.cause)),
	);

/** A save whose answer was lost: did it land? Read the stream's end and see. */
const landed = (rows: readonly Row[], expected: number, writer: string, state: Count) => {
	const end = rows.at(-1);
	if (end === undefined || end.rev !== expected + 1 || end.writer !== writer) return false;
	const exit = decodeState(end.data);
	return Exit.isSuccess(exit) && exit.value.state.cursor === state.cursor;
};

export const ledgerStore = (
	ledger: Ledger["Service"],
	o: {
		readonly stream: string;
		readonly fence: number;
		readonly holder: string;
		readonly note: (n: WriteNote) => void;
	},
): FencedStore<Count> => {
	const load = Effect.map(ledger.readStream(o.stream), lastState);

	const save = (state: Count, expected: number) =>
		Effect.gen(function* () {
			const sentAt = Date.now();
			const note = (ok: boolean, why: string | null, rev: number | null) =>
				o.note({
					ev: "write",
					fence: o.fence,
					expected,
					ok,
					why,
					rev,
					count: state.count,
					sentAt,
					at: Date.now(),
				});
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
				if (rows !== null && landed(rows, expected, o.holder, state)) {
					note(true, "answer lost, landed", expected + 1);
					return expected + 1;
				}
				if (rows !== null && (rows.at(-1)?.rev ?? 0) !== expected) {
					note(false, "stale", rows.at(-1)?.rev ?? 0);
					return yield* Effect.fail(new StoreConflictError(expected, rows.at(-1)?.rev ?? 0));
				}
				if (tries >= 20) {
					note(false, "unreachable", null);
					return yield* Effect.fail(new StoreConflictError(expected, -1));
				}
			}
		});

	return {
		fenced: true,
		load: () => promised(Effect.map(load, (l) => l.state)),
		loadFenced: () => promised(Effect.map(load, (l) => ({raw: l.state, version: l.version}))),
		saveFenced: (state, expected) => promised(save(state, expected)),
		save: () => Promise.reject(new Error("the journal saves only through saveFenced")),
		migrate: (raw) => {
			if (raw === null || raw === undefined) return null;
			const exit = Schema.decodeUnknownExit(Count)(raw);
			return Exit.isSuccess(exit) ? exit.value : refuse("not a saved count");
		},
	};
};
