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
// `Process.sleep`: the next tick is set only once the read is over, so two
// reads of one child never overlap.
//
// A read that never answers must not stop the loop. Elm's answer is a race
// between the read and a `Process.sleep` of the read's limit: whichever ends
// first ends the read. Here the clock stays on while reading, set to `limit`,
// and when it fires first the read counts as failed and the next wait starts.
// Each read carries the tick it was sent for, so an answer that comes after
// its read was given up names an old tick and changes nothing.
//
// Like the combos in src/combos.ts, it is plain data plus pure functions a
// hand-written parent calls from its own update. The child does not write
// the fact. It hands the change back, Elm's "out message" from a child's
// update, and the parent writes it with an Act it already owns (and with
// `remember` when the write must be read back). So the child knows nothing of
// the ledger, and one Poll serves a `pr` fact and a scheduled job alike.
//
// Every Cmd, Sub and Msg carries the child's `key`.

/** The read: a Gather Cmd that carries the child's key and the tick it was sent for, so its answer finds its way back. */
export type Keyed = Cmd & {readonly key: string; readonly tick: number};

/** How fast a poll goes, both in ms and both required: no number is made up here. */
export interface Pace {
	/** From the end of one read to the next tick. */
	readonly every: number;
	/** How long a read may take before it counts as failed. */
	readonly limit: number;
}

/**
 * A poll between reads, or in one. `last` is what `by` gave for the last
 * change reported, `null` before the first read, so the first read always
 * counts as a change. The pace is copied in when the poll starts, so a running
 * poll keeps its own. `input` is what the parent gave at start; each tick's
 * read is built from it.
 */
export interface Polling<I> extends Pace {
	readonly phase: "waiting" | "reading";
	readonly key: string;
	readonly tick: number;
	readonly last: string | null;
	readonly input: I;
}

/**
 * The clock's Msg: whose poll it wakes, which tick it was set for, and the
 * phase it was set in. In "waiting" it says read now; in "reading" it says
 * the read took too long. The phase also keeps the two clocks of one tick
 * apart when `every` and `limit` are the same number.
 */
export interface Tick<T extends string> {
	readonly type: T;
	readonly key: string;
	readonly tick: number;
	readonly phase: "waiting" | "reading";
}

/** What a poll hands its parent when a read changed. `tick` names the write, the same on every replay. */
export interface Changed<V> {
	readonly key: string;
	readonly tick: number;
	readonly value: V;
}

/**
 * Poll: wake on a clock, read with a Gather, report only a change. `read`
 * builds the Gather from the child's key, the tick, and what the parent gave
 * at start, and the Gather carries the key and the tick;
 * `by` names the part of a read that counts (the checks' state, a hash), so
 * a read that differs only elsewhere is no change.
 */
export function createPoll<const N extends string, I, R extends Keyed, V>(config: {
	readonly name: N;
	readonly read: (key: string, tick: number, input: I) => R;
	readonly by: (value: V) => string;
}) {
	const tickType = `${config.name}_tick` as const;
	type State = Polling<I>;
	type Step = readonly [State, Changed<V> | null];

	/** Start waiting for the first tick. Nothing is read until the clock says so. */
	const start = (key: string, input: I, pace: Pace): State => ({
		phase: "waiting",
		key,
		every: pace.every,
		limit: pace.limit,
		tick: 0,
		last: null,
		input,
	});

	const readOf = (s: State): R => config.read(s.key, s.tick, s.input);

	const next = (s: State, last: string | null): State => ({
		...s,
		phase: "waiting",
		tick: s.tick + 1,
		last,
	});

	/** The read this answer belongs to is the one out now. */
	const current = (s: State, read: R): boolean =>
		s.phase === "reading" && read.key === s.key && read.tick === s.tick;

	/**
	 * The clock woke the child. Set while waiting: read. Set while reading: the
	 * read took too long, so it counts as failed. A clock set for another tick,
	 * another phase, or another child changes nothing.
	 */
	function ticked(s: State, m: Tick<typeof tickType>): readonly [State, readonly R[]] {
		if (m.key !== s.key || m.tick !== s.tick || m.phase !== s.phase) return [s, []];
		if (s.phase === "reading") return [next(s, s.last), []];
		const reading: State = {...s, phase: "reading"};
		return [reading, [readOf(reading)]];
	}

	/** The read answered: a change when `by` differs from the last one reported, else nothing. An answer for a read given up changes nothing. */
	function answered(s: State, read: R, value: V): Step {
		if (!current(s, read)) return [s, null];
		const seen = config.by(value);
		if (seen === s.last) return [next(s, s.last), null];
		return [next(s, seen), {key: s.key, tick: s.tick, value}];
	}

	/** The read failed: wait for the next tick. Each read is fresh, so a missed one loses nothing. */
	const failed = (s: State, read: R): State => (current(s, read) ? next(s, s.last) : s);

	/** The clock this state asks for: always on, `every` between reads and `limit` during one. */
	const clock = (s: State): TimerDeps<Tick<typeof tickType>> => ({
		ms: s.phase === "waiting" ? s.every : s.limit,
		msg: {type: tickType, key: s.key, tick: s.tick, phase: s.phase},
	});

	/** What a restart sends again: the read, if one was out. A Gather, so asking twice is safe. */
	const inFlight = (s: State): R | null => (s.phase === "reading" ? readOf(s) : null);

	return {name: config.name, tickType, start, ticked, answered, failed, clock, inFlight} as const;
}
