// The ruler's ticks, ranked, shared by the job view and the ticket view (ticket 141). Today's
// version. Pure.
//
//   rank 1: the smallest round step with at most 4 ticks
//   rank 2: the smallest round step that divides it with at most 8
//   rank 3: the smallest round step that divides that with at most 16
//   The CSS shows rank 2 from a 480px ruler and rank 3 from 960px, so each label shown has 60px:
//   at most 4 ticks over 240px, 8 over 480px, 16 over 960px.
//
//   ticksOf(781_000)   // 0 r1, 1 min r3 … 5 min r1 … 10 min r1 … 13 min r3
//
// The round steps are the clock's: 1, 2 and 5 of each power of ten under a second, then 1, 2, 5,
// 10, 15 and 30 seconds and minutes, then hours and days. 2.5 min is not one: a person reads a
// ruler in whole minutes. Each step is a whole number of ms, so a finer one can divide a coarser.

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The round steps, in ms, smallest first. */
const ROUND: readonly number[] = [
	1,
	2,
	5,
	10,
	20,
	50,
	100,
	200,
	500,
	...[1, 2, 5, 10, 15, 30].map((n) => n * SEC),
	...[1, 2, 5, 10, 15, 30].map((n) => n * MIN),
	...[1, 2, 3, 6, 12].map((n) => n * HOUR),
	DAY,
];

/** One tick: its time from the axis start, in ms, and the coarsest rank it belongs to. */
export type Tick = {readonly t: number; readonly rank: 1 | 2 | 3};

/** How many ticks a step gives over an axis: one at 0 and one at each whole step after. */
const countOf = (length: number, step: number): number => Math.floor(length / step) + 1;

/** The smallest round step that divides `coarser` and gives at most `most` ticks. */
const finest = (length: number, coarser: number, most: number): number =>
	ROUND.find((step) => coarser % step === 0 && countOf(length, step) <= most) ?? coarser;

/** The coarsest step: a round one with at most 4 ticks, else whole days. */
const coarsest = (length: number): number =>
	ROUND.find((step) => countOf(length, step) <= 4) ?? DAY * Math.ceil(length / (3 * DAY));

/** The ticks of an axis `length` ms long, each at its coarsest rank, in time order. */
export const ticksOf = (length: number): readonly Tick[] => {
	if (!(length > 0)) return [{t: 0, rank: 1}];
	const one = coarsest(length);
	const two = finest(length, one, 8);
	const three = finest(length, two, 16);
	const rankOf = (t: number): 1 | 2 | 3 => (t % one === 0 ? 1 : t % two === 0 ? 2 : 3);
	return Array.from({length: countOf(length, three)}, (_, k) => {
		const t = k * three;
		return {t, rank: rankOf(t)};
	});
};
