// Signature only (ticket 141): the plan's names and types, for the tests to import. The builder
// writes the body. Today's version.
//
// The ruler's ticks, ranked, shared by the job view and the ticket view. Pure.
//
//   rank 1: the smallest round step with at most 4 ticks
//   rank 2: the smallest that divides it with at most 8
//   rank 3: the smallest that divides that with at most 16
//   The CSS shows rank 2 from a 480px ruler and rank 3 from 960px, so each label shown has 60px.
//
//   ticksOf(781_000)   // 0 r1, 1 min r3 … 5 min r1 … 10 min r1 … 13 min r3

const notBuilt = (): never => {
	throw new Error("not built: ticket 141");
};

/** One tick: its time from the axis start, in ms, and the coarsest rank it belongs to. */
export type Tick = {readonly t: number; readonly rank: 1 | 2 | 3};

/** The ticks of an axis `length` ms long, each at its coarsest rank, in time order. */
export const ticksOf = (_length: number): readonly Tick[] => notBuilt();
