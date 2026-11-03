// List prices, so every model's spend reads in dollars. GPT sol runs on the ChatGPT plan, which prices
// no call, so its dollars here are what the same tokens would cost at OpenAI's standard API price.
// Claude's dollars come from the Agent SDK's own `total_cost_usd`, which is list price already; the
// Claude rows below are for estimates before a run. Pure.

/** One model's price, in dollars per token. `cached` is a cache read; it is part of `input`. */
export interface Price {
	readonly input: number;
	readonly cached: number;
	readonly output: number;
	/** Where the price was read, and when. */
	readonly source: string;
	readonly read: string;
}

/** gpt-6.1-sol, standard tier, short context: $2.00 input, $0.10 cached input, $10.00 output per 1M. */
export const SOL: Price = {
	input: 2e-6,
	cached: 0.1e-6,
	output: 10e-6,
	source: "https://developers.openai.com/api/docs/pricing",
	read: "2026-10-30",
};

/** gpt-6-luna, standard tier, short context: $0.10 input, $0.01 cached input, $0.50 output per 1M. */
export const LUNA: Price = {
	input: 0.1e-6,
	cached: 0.01e-6,
	output: 0.5e-6,
	source: "https://developers.openai.com/api/docs/pricing",
	read: "2026-10-31",
};

/** claude-haiku-5-5 up to 100k tokens of prompt: $0.10 input, $0.50 output per 1M; cache read guessed at a tenth. */
export const HAIKU: Price = {
	input: 0.1e-6,
	cached: 0.01e-6,
	output: 0.5e-6,
	source: "Anthropic's model table, as cached 2026-10-06",
	read: "2026-10-30",
};

/** claude-sonnet-5-5: $2.00 input, $0.20 cache read, $10.00 output per 1M. */
export const SONNET: Price = {
	input: 2e-6,
	cached: 0.2e-6,
	output: 10e-6,
	source: "Anthropic's model table, as cached 2026-10-06",
	read: "2026-10-30",
};

/** Tokens as the Codex adapter and the Agent SDK report them: `cached` is inside `input`. */
export interface Used {
	readonly input: number;
	readonly cached: number;
	readonly output: number;
}

/** What `used` costs at `price`, in dollars. */
export const usdAt = (price: Price, used: Used): number =>
	(used.input - used.cached) * price.input +
	used.cached * price.cached +
	used.output * price.output;
