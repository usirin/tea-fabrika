import type {JobTrace, Span} from "@kampus/fabrika-old";
import type {Entry, FactOf} from "@kampus/pipeline/tickets/ticket";

// Signature only (ticket 141): the plan's names and types, for the tests to import. The builder
// writes the bodies. Today's version.
//
// One ticket's lanes, folded from its facts: the fold the view and the laws share. Pure.
//
//   lanesOf(T117, now, Infinity).map((l) => [l.rows.length, l.open])   // [[7, false], [5, false], [1, false]]
//   lanesOf(T117, now, PLAN8_STARTED + 180_000).at(-1)?.rows.at(-1)
//   // {kind: "step", run: "r-plan-8", to: upTo, ended: null}

const notBuilt = (): never => {
	throw new Error("not built: ticket 141");
};

/** A step's end, as the ticket holds it. */
export type Ended = FactOf<"ended">;

/**
 * A step's price, in three cases: a known price in dollars, a model with no known price, or a step
 * that ran no model (code). Never a 0 standing in for unknown.
 */
export type Price =
	| {readonly kind: "usd"; readonly usd: number}
	| {readonly kind: "unknown"}
	| {readonly kind: "none"};

/** One row of a lane: a step it ran, or a wait on a person. */
export type LaneRow =
	| {
			readonly kind: "step";
			readonly run: string;
			readonly stage: string;
			readonly from: number;
			readonly to: number;
			readonly ended: Ended | null;
			readonly model: string | null;
			readonly harness: string | null;
			readonly price: Price;
	  }
	| {
			readonly kind: "wait";
			readonly ask: string;
			readonly what: string;
			readonly from: number;
			readonly to: number;
			readonly pick: string | null;
			readonly by: string | null;
	  };

/** One lane: the facts of one trace id, on its own time axis. */
export type Lane = {
	readonly trace: string;
	readonly restart: {readonly at: number; readonly from: string} | null;
	/** The restart's at, else its first started's at. */
	readonly from: number;
	/** Its last ended or answered, or now while open. */
	readonly to: number;
	readonly rows: readonly LaneRow[];
	readonly open: boolean;
};

/** A ticket's lanes, from its facts up to `upTo`, with `now` for what is still open. */
export const lanesOf = (
	_timeline: readonly Entry[],
	_now: number,
	_upTo: number,
): readonly Lane[] => notBuilt();

/** The times a replay stops at: each started, ended, asked, answered and restarted, in order. */
export const stopsOf = (_timeline: readonly Entry[]): readonly number[] => notBuilt();

/**
 * The spans under one step, from its lane's job record: by `tea.lane.run` when the span has it,
 * else the "run a step" span that overlaps [from, to] most.
 */
export const childrenOf = (
	_record: JobTrace,
	_run: string,
	_from: number,
	_to: number,
): readonly Span[] => notBuilt();

/**
 * What the lane line and the ticket line say. Not named in the plan: the test writer named it, for
 * L6 and E1 ("the summary's unknown count", "$0.07, 5 unknown"). `usd`: the sum of the `usd` rows,
 * `null` when no row has a known price, so nothing reads as $0.00. `waited`: ms of the wait rows.
 */
export type Summary = {
	readonly lanes: number;
	readonly steps: number;
	readonly waits: number;
	readonly waited: number;
	readonly usd: number | null;
	readonly unknown: number;
};

/** The summary of some lanes: one lane's line, or the whole ticket's. */
export const summaryOf = (_lanes: readonly Lane[]): Summary => notBuilt();
