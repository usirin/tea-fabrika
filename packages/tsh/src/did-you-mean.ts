// The one guess a refusal may carry: the closest known name, by edit
// distance, and only when it is close. A wrong guess costs a reader more than
// no guess, so the bound is tight: one edit for a name of up to three
// letters, two above that. Two letters swapped count as one edit. The idea is
// Tuval's command parser's.

const boundFor = (typed: string): number => (typed.length <= 3 ? 1 : 2);

/**
 * Edit distance between `a` and `b`, where two letters swapped is one edit,
 * as a typing slip is (`sqe` is one edit from `seq`). Past `limit`, `limit + 1`.
 */
function distance(a: string, b: string, limit: number): number {
	if (Math.abs(a.length - b.length) > limit) return limit + 1;
	let before: number[] = [];
	let previous = Array.from({length: b.length + 1}, (_, i) => i);
	for (let row = 1; row <= a.length; row++) {
		const current = [row];
		for (let col = 1; col <= b.length; col++) {
			let value = Math.min(
				(current[col - 1] ?? 0) + 1,
				(previous[col] ?? 0) + 1,
				(previous[col - 1] ?? 0) + (a.charAt(row - 1) === b.charAt(col - 1) ? 0 : 1),
			);
			const swapped =
				row > 1 &&
				col > 1 &&
				a.charAt(row - 1) === b.charAt(col - 2) &&
				a.charAt(row - 2) === b.charAt(col - 1);
			if (swapped) value = Math.min(value, (before[col - 2] ?? 0) + 1);
			current.push(value);
		}
		before = previous;
		previous = current;
	}
	const found = previous[b.length] ?? limit + 1;
	return found > limit ? limit + 1 : found;
}

/** The closest of `known` to `typed`, inside the bound, or nothing. A tie goes to the one listed first. */
export function didYouMean(typed: string, known: Iterable<string>): string | undefined {
	const limit = boundFor(typed);
	let best: string | undefined;
	let bestDistance = limit + 1;
	for (const name of known) {
		if (name === typed) continue;
		const d = distance(typed, name, limit);
		if (d < bestDistance) {
			best = name;
			bestDistance = d;
		}
	}
	return best;
}
