// The mutation step's toy repository (packages/pipeline/src/stages/mutation).
// Its test is weak on purpose: nothing checks a number above `high`, so a
// mutant of that line survives. `unit` is there for a mutant the typecheck
// rejects (a compile error), and the error text for one the ignorer takes out.

export type Unit = "n";

/** `n` held between `low` and `high`. */
export function clamp(n: number, low: number, high: number): number {
	if (low > high) throw new Error("low is above high");
	if (n < low) return low;
	if (n > high) return high;
	return n;
}

/** The unit `clamp` works in. */
export function unit(): Unit {
	return "n";
}
