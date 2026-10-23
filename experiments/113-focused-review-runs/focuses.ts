// Experiment 113's focuses and the shape of one run, shared by the runner
// (../113-focused-review-runs.ts) and the count (./count.ts).
import type {Ran} from "../112-reviewer-noise/pairs.ts";

/**
 * The three focuses, one per run of a trio. Each is said to the run after the way of working
 * (`focus` in packages/pipeline/src/stages/review/reviewer.ts); the run still owes the whole
 * form. Written before any run, and not changed after.
 */
export const FOCUSES = {
	A: "A broad sweep for bugs, held against the criteria. Go through every changed file, line by line. Look for anything that does not do what the criteria ask: a wrong result, a case left out, an error not handled, a test that cannot fail.",
	B: "For each criterion in turn, ask: what is the one way it is most likely to be false at this commit? Name that way to yourself, then go and check it in the code, following the code as far as you need. Grade the row by what you find.",
	C: "Effects across files, and security. Follow each change out of the diff: into the code that calls it, the code it calls, and files the diff does not touch that depend on what changed. Look for callers left behind, two places that now disagree, a write that can stop half way and leave things broken, and input from outside that is trusted when it should not be.",
} as const;
export type FocusId = keyof typeof FOCUSES;

/** One run, as the results keep it: 112's, with its focus. `k` is the trio's number. */
export type FocusedRan = Ran & {readonly focus: FocusId};

/** The five pairs 112b counted. p1-t2-fb61 is out: sonnet has 3 runs a kind there. */
export const COUNTED = ["p2-t2-f590", "p3-t2-9698", "p3-t1-5148", "p4-t2-23bb", "p4-t1-741c"];
