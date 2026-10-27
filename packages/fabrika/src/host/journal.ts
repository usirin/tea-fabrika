// A program's journal on the ledger: a tea `FencedStore` on `<name>/state`, for any state with a
// Schema. Lifted from experiment 97 (experiments/97-one-ledger/store.ts), which merged 95's and
// 96's. Not exported on its own: the host builds it inside `Self.run`, beside the error sink, so a
// program never holds a fenced journal without the sink (demlik issue 728).
//
// Every save is one append at the rev it last saw, under the fence of the host's claim. Three
// guards, all in the ledger: the rev, the fence (only while this claim is the name's newest), and
// the name (a save with no fence is `denied`). A refusal is tea's `StoreConflictError`; tea saves a
// step before it runs that step's Cmds, so a refused save also stops the Cmds.
//
// A save whose answer was lost is sent again under the same id, `<fence>:<expected rev>`; the
// ledger answers `dup` if the first landed. One id per (fence, rev) is enough: two saves at the
// same rev cannot both land, and tea sends the same state again when it retries.
//
// New in 151: a save the ledger does not answer is sent again with no limit on tries, a second
// apart at most, until it lands, is refused, or the program stops (`signal`). Experiment 149: a
// save that gave up after 20 tries ended the program on a two second wifi drop.
import {type FencedStore, refuse, StoreConflictError} from "@demlik/tea";
import {Cause, Duration, Effect, Exit, Schema} from "effect";
import type {Ledger, Row} from "./ledger.ts";

/** What the host says about each save. */
export type WriteNote = {
	readonly ev: "write";
	readonly fence: number;
	readonly expected: number;
	readonly ok: boolean;
	/** `null`: it landed. Else "stale", "fenced", "denied", "unreachable", or "answer lost, landed". */
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

// tea's store is Promise-shaped: the Effect is run here, at its edge, until `signal` says stop.
const promised = <A, E>(effect: Effect.Effect<A, E>, signal: AbortSignal): Promise<A> =>
	Effect.runPromiseExit(effect, {signal}).then((exit) =>
		Exit.isSuccess(exit) ? exit.value : Promise.reject(Cause.squash(exit.cause)),
	);

/** The wait before try `tries + 1` of a write with no answer: 100 ms, doubling, then a second. */
export const backoff = (tries: number) =>
	Duration.millis(Math.min(1000, 50 * 2 ** Math.min(tries, 5)));

export const journalStore = <S>(
	ledger: Ledger["Service"],
	o: {
		readonly schema: Schema.Codec<S, unknown>;
		/** `<name>/state`. */
		readonly stream: string;
		readonly fence: number;
		readonly holder: string;
		readonly note: (n: WriteNote) => void;
		/** Aborted when the program stops: a save still waiting on the ledger stops with it. */
		readonly signal: AbortSignal;
	},
): FencedStore<S> => {
	const lastState = lastStateOf(o.schema);
	const load = Effect.map(ledger.readLast(o.stream, 1), lastState);

	const save = (state: S, expected: number) =>
		Effect.gen(function* () {
			const sentAt = Date.now();
			const note = (ok: boolean, why: string | null, rev: number | null) =>
				o.note({ev: "write", fence: o.fence, expected, ok, why, rev, sentAt, at: Date.now()});
			const event = {
				kind: "state",
				writer: o.holder,
				data: {fence: o.fence, state},
				id: `${o.fence}:${expected}`,
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
				if (e._tag !== "LedgerUnreachable") {
					note(
						false,
						e._tag === "Fenced" ? "fenced" : e._tag === "Denied" ? "denied" : "unknown",
						expected,
					);
					return yield* Effect.fail(new StoreConflictError(expected, expected));
				}
				// No answer: the append may have landed. Its id makes sending it again safe. Said once,
				// so the host knows the save waits.
				if (tries === 1) note(false, "unreachable", null);
				yield* Effect.sleep(backoff(tries));
			}
		});

	const decode = Schema.decodeUnknownExit(o.schema);
	return {
		fenced: true,
		load: () =>
			promised(
				Effect.map(load, (l) => l.state),
				o.signal,
			),
		loadFenced: () =>
			promised(
				Effect.map(load, (l) => ({raw: l.state, version: l.version})),
				o.signal,
			),
		saveFenced: (state, expected) => promised(save(state, expected), o.signal),
		save: () => Promise.reject(new Error("the journal saves only through saveFenced")),
		migrate: (raw) => {
			if (raw === null || raw === undefined) return null;
			const exit = decode(raw);
			return Exit.isSuccess(exit) ? exit.value : refuse("not a saved state");
		},
	};
};
