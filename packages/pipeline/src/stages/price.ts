// A run's list price, from its tokens. Today's version. Pure, and it names no platform, so the
// lane that writes a step's end and a window's view that reads it price the same way.
//
//   listUsdOf("gpt-6-astra", {input: 120_000, cached: 100_000, output: 4_000})   // 0.5
//   listUsdOf("made-up-model", {input: 1, cached: 0, output: 1})                // null, never 0

/**
 * Dollars per million tokens, at API list price. A model not here has no price: never another's.
 * gpt-6-astra: OpenAI's pricing page (https://developers.openai.com/api/docs/pricing), read
 * 2026-11-02, standard tier, up to 272K input. A step keeps only its token totals, so the
 * long-context rate can never be told apart: the short one is the floor.
 */
const LIST: Readonly<Record<string, {in: number; cached: number; out: number}>> = {
	"gpt-6.1-sol": {in: 2, cached: 0.1, out: 10},
	"gpt-6-astra": {in: 10, cached: 1, out: 50},
};

export interface Tokens {
	readonly input: number;
	readonly cached: number;
	readonly output: number;
}

/** A run at list price. `null`: this model's price is not known. */
export const listUsdOf = (model: string, t: Tokens): number | null => {
	const rate = LIST[model];

	if (rate === undefined) {
		return null;
	}

	return (
		(rate.in * Math.max(0, t.input - t.cached) + rate.cached * t.cached + rate.out * t.output) /
		1_000_000
	);
};
