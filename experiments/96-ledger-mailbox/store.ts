// Copied from experiments/94-tea-host/store.ts. What changed:
//
//   - The counter's state lives on its own stream, `counter:1/state`, not on the registry stream.
//     The lease is on `counter:1`, and a lease guards every stream under its name, so the fence
//     still covers each save. Hosts watching the registry no longer see one event per message.
//   - Each save carries an id, `<fence>:<cursor>`, so a save whose answer was lost is simply sent
//     again: the ledger answers `dup` if the first one landed. 94 read the stream's end to find
//     out. The fence is in the id, so a frozen owner's save can never be mistaken for the new
//     owner's save of the same message.
//   - Loading reads only the last state event (`readLast`), not every state ever saved.
//
// 94's two guards still hold, now both on the state stream: the rev (a save lands only if nothing
// was saved since this run's last save or load) and the fence (only while this claim's lease, on
// the prefix, is live). After a takeover the state stream has not moved until the new owner saves,
// so a frozen owner's late save is refused by the fence, not by the rev as in 94.
import {type FencedStore, refuse, StoreConflictError} from "@demlik/tea";
import {Cause, Duration, Effect, Exit, Schema} from "effect";
import {Count} from "../94-tea-host/counter.ts";
import type {Ledger, Row} from "./service.ts";

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

/** The last event of a state stream, decoded, and the rev the stream ends at. */
export const lastState = (rows: readonly Row[]) => {
	const at = rows.at(-1);
	const exit = at === undefined ? null : decodeState(at.data);
	return {
		state: exit !== null && Exit.isSuccess(exit) ? exit.value.state : null,
		version: at?.rev ?? 0,
	};
};

const promised = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
	Effect.runPromiseExit(effect).then((exit) =>
		Exit.isSuccess(exit) ? exit.value : Promise.reject(Cause.squash(exit.cause)),
	);

export const ledgerStore = (
	ledger: Ledger["Service"],
	o: {
		readonly stream: string;
		readonly fence: number;
		readonly holder: string;
		readonly note: (n: WriteNote) => void;
	},
): FencedStore<Count> => {
	const load = Effect.map(ledger.readLast(o.stream, 1), lastState);

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
			const event = {
				kind: "state",
				writer: o.holder,
				data: {fence: o.fence, state},
				id: `${o.fence}:${state.cursor}`,
			};
			for (let tries = 1; ; tries++) {
				const sent = yield* ledger.append(o.stream, expected, event, o.fence).pipe(Effect.result);
				if (sent._tag === "Success") {
					const r = sent.success;
					if (r.ok) {
						note(true, r.dup ? "answer lost, landed" : null, r.rev);
						return r.rev;
					}
					const actual = r.why === "stale" ? r.rev : expected;
					note(false, r.why, actual);
					return yield* Effect.fail(new StoreConflictError(expected, actual));
				}
				// No answer: the append may have landed. Its id makes sending it again safe.
				if (tries >= 20) {
					note(false, "unreachable", null);
					return yield* Effect.fail(new StoreConflictError(expected, -1));
				}
				yield* Effect.sleep(Duration.millis(50));
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
