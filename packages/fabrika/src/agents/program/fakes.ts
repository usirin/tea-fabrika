import {type FakeScript, fakeAdapter} from "../agent/fake.ts";
import type {Adapter, AdapterTurn, Raw} from "../agent/turn.ts";

// Two fake providers for the agent programs (experiment 169), one per maker,
// each holding what its real adapter holds and saying a turn the way its
// maker does: Claude with its dollars, its request count and a typed answer
// field; Codex with neither, and the answer only in its last message. The
// raws are what each real adapter's pure part makes of its maker's events
// (`rawOf` in ../claude/adapter.ts, `rawOfLine` in ../codex/adapter.ts),
// written out here so this file starts no maker and imports no SDK.
//
//   const {claude, codex} = fakeMakers((turn) => story(turn));
//   makeAgents({adapters: {claude, codex}, sessions: memorySessions(), reaper: noReaper})

/** One turn, as both makers would tell it. `answer`: the JSON the agent ends with. `hang`: it never ends. */
export interface Story {
	readonly tool?: {readonly id: string; readonly title: string};
	readonly said: string;
	readonly answer: unknown;
	readonly hang?: boolean;
}

/** Claude through its SDK: a tool call, then its result, the text, the turn's tokens, dollars and typed answer. */
export const claudeRaws = (s: Story): readonly Raw[] => [
	...(s.tool === undefined
		? []
		: [
				{_tag: "tool", id: s.tool.id, title: s.tool.title, status: "pending"} as const,
				{_tag: "tool", id: s.tool.id, title: "", status: "completed"} as const,
			]),
	{_tag: "said", text: s.said},
	...(s.hang === true
		? []
		: [
				{_tag: "tokens", tokens: {input: 1200, cached: 900, output: 40}, whole: true} as const,
				{_tag: "ended", stop: "end_turn", structured: s.answer, usd: 0.012, requests: 2} as const,
			]),
];

/**
 * Codex through `codex exec --json`: a command started and completed, its last message holding the
 * answer as JSON text (what `--output-schema` makes it print), then the turn's tokens. No dollars,
 * no request count, no typed answer field.
 */
export const codexRaws = (s: Story): readonly Raw[] => [
	...(s.tool === undefined
		? []
		: [
				{_tag: "tool", id: s.tool.id, title: s.tool.title, status: "in_progress"} as const,
				{_tag: "tool", id: s.tool.id, title: s.tool.title, status: "completed"} as const,
			]),
	{_tag: "said", text: s.said},
	...(s.hang === true
		? []
		: [
				{_tag: "said", text: JSON.stringify(s.answer)} as const,
				{_tag: "tokens", tokens: {input: 1100, cached: 800, output: 35}, whole: true} as const,
				{
					_tag: "ended",
					stop: "end_turn",
					structured: undefined,
					usd: null,
					requests: null,
				} as const,
			]),
];

const script =
	(raws: (s: Story) => readonly Raw[], story: (turn: AdapterTurn) => Story) =>
	(turn: AdapterTurn): FakeScript => {
		const s = story(turn);
		return {raws: raws(s), hang: s.hang === true};
	};

/** Both fake makers, on one story. Each holds what its real adapter holds. */
export const fakeMakers = (story: (turn: AdapterTurn) => Story) => {
	const claude = fakeAdapter(script(claudeRaws, story), {usd: true, schema: true});
	const codex = fakeAdapter(script(codexRaws, story), {usd: false, schema: true});
	return {claude, codex} satisfies Record<string, Adapter>;
};
