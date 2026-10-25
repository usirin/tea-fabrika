import type {Cmd, TimerDeps} from "@demlik/tea";

// Poll: a clock wakes the child, code reads something, and the child reports
// a change only when the read differs from the last one it reported. For
// things that send no event, which a Listen alone cannot hear: a pull
// request's checks, a scheduled job (docs/direction/new-combos.md).
//
// The Elm answer: `Time.every` sends a tick, `update` answers the tick with a
// read Cmd, and `update` answers the read by comparing it with what the model
// last saw. Here the tick is tea's built-in `timer` Sub, which every engine
// runs and which fires once, `ms` after it starts. Its Msg carries the tick's
// number, so each tick sets a new clock, as the host's renew clock does
// (packages/fabrika/src/host/host-machine.ts). Elm writes the same loop with
// `Process.sleep`: the next tick is set only once the read has answered, so
// two reads of one child never overlap.
//
// Like the combos in src/combos.ts, it is plain data plus pure functions a
// hand-written parent calls from its own update. The child does not write
// the fact. It hands the change back, Elm's "out message" from a child's
// update, and the parent writes it with an Act it already owns (and with
// `remember` when the write must be read back). So the child knows nothing of
// the ledger, and one Poll serves a `pr` fact and a scheduled job alike.
//
// Every Cmd, Sub and Msg carries the child's `key`.

/** The read: a Gather Cmd that carries the child's key, so its answer finds its way back. */
export type Keyed = Cmd & {readonly key: string};

/**
 * A poll between reads, or in one. `last` is what `by` gave for the last
 * change reported, `null` before the first read, so the first read always
 * counts as a change. `every` is copied in when the poll starts, so a running
 * poll keeps its own pace.
 */
export interface Polling<R extends Keyed> {
	readonly phase: "waiting" | "reading";
	readonly key: string;
	/** ms between the last read's answer and the next tick. */
	readonly every: number;
	readonly tick: number;
	readonly last: string | null;
	/** The Gather each tick sends, built once at start. */
	readonly read: R;
}

/** The clock's Msg: whose poll it wakes, and which tick it was set for. */
export interface Tick<T extends string> {
	readonly type: T;
	readonly key: string;
	readonly tick: number;
}

/** What a poll hands its parent when a read changed. `tick` names the write, the same on every replay. */
export interface Changed<V> {
	readonly key: string;
	readonly tick: number;
	readonly value: V;
}

/**
 * Poll: wake on a clock, read with a Gather, report only a change. `read`
 * builds the Gather from the child's key and what the parent gave at start,
 * and the Gather carries that key;
 * `by` names the part of a read that counts (the checks' state, a hash), so
 * a read that differs only elsewhere is no change.
 */
export function createPoll<const N extends string, I, R extends Keyed, V>(config: {
	readonly name: N;
	readonly read: (key: string, input: I) => R;
	readonly by: (value: V) => string;
}) {
	const tickType = `${config.name}_tick` as const;
	type State = Polling<R>;
	type Step = readonly [State, Changed<V> | null];

	/** Start waiting for the first tick. Nothing is read until the clock says so. */
	const start = (key: string, input: I, every: number): State => ({
		phase: "waiting",
		key,
		every,
		tick: 0,
		last: null,
		read: config.read(key, input),
	});

	/** The clock woke the child: read. A tick set for another wait, or another child, changes nothing. */
	function ticked(s: State, m: Tick<typeof tickType>): readonly [State, readonly R[]] {
		if (s.phase !== "waiting" || m.key !== s.key || m.tick !== s.tick) return [s, []];
		return [{...s, phase: "reading"}, [s.read]];
	}

	const next = (s: State, last: string | null): State => ({
		...s,
		phase: "waiting",
		tick: s.tick + 1,
		last,
	});

	/** The read answered: a change when `by` differs from the last one reported, else nothing. */
	function answered(s: State, value: V): Step {
		if (s.phase !== "reading") return [s, null];
		const seen = config.by(value);
		if (seen === s.last) return [next(s, s.last), null];
		return [next(s, seen), {key: s.key, tick: s.tick, value}];
	}

	/** The read failed: wait for the next tick. Each read is fresh, so a missed one loses nothing. */
	const failed = (s: State): State => (s.phase === "reading" ? next(s, s.last) : s);

	/** The clock this state asks for: on only between reads. */
	const clock = (s: State): TimerDeps<Tick<typeof tickType>> | null =>
		s.phase === "waiting" ? {ms: s.every, msg: {type: tickType, key: s.key, tick: s.tick}} : null;

	/** What a restart sends again: the read, if one was out. A Gather, so asking twice is safe. */
	const inFlight = (s: State): R | null => (s.phase === "reading" ? s.read : null);

	return {name: config.name, tickType, start, ticked, answered, failed, clock, inFlight} as const;
}
