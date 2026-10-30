import type {SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import {describe, expect, it} from "@effect/vitest";
import {Duration, Effect, Schema} from "effect";
import {ear} from "../../program/ear.ts";
import {call, type Given, start, tell} from "../../program/program.ts";
import {fit} from "../../program/shape.ts";
import {memoryStorage, type Storage} from "../../program/storage.ts";
import {makeAgents} from "../agent/core.ts";
import {memorySessions} from "../agent/sessions.ts";
import {Agents, noReaper, type Raw} from "../agent/turn.ts";
import {rawOf} from "../claude/adapter.ts";
import {rawOfLine} from "../codex/adapter.ts";
import type {Maker} from "./conversation.ts";
import {claudeRaws, codexRaws, fakeMakers, type Story} from "./fakes.ts";
import {
	type AgentFlags,
	agentProgram,
	claudeProgram,
	codexProgram,
	typedAgentProgram,
} from "./program.ts";

// `claude` and `codex` as programs, on the two fake makers (./fakes.ts): the
// same story told the way each maker tells it. Every test runs on both, so a
// difference between them shows as a failing row, not as a branch nobody ran.

const Sorted = Schema.Struct({
	label: Schema.Literals(["bug", "feature"]),
	// A check JSON Schema cannot say: way B loses it, way C keeps it.
	ticket: Schema.String.check(
		Schema.makeFilter((s: string) => s.startsWith("#") || "a ticket starts with #"),
	),
});

/** Sorted as the `--answer` flag holds it: a JSON Schema, read as JSON. */
const SORTED_JSON_SCHEMA = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
	Schema.toJsonSchemaDocument(Sorted).schema,
);

const GOOD = {label: "bug", ticket: "#7"};
const story = (prompt: string): Story => ({
	tool: {id: "t1", title: "Read"},
	said: "Read the ticket.",
	answer: prompt.includes("bad label")
		? {label: "bogus", ticket: "#7"}
		: prompt.includes("bad ticket")
			? {label: "bug", ticket: "7"}
			: GOOD,
	hang: prompt.includes("hang"),
});

const world = () => {
	const fakes = fakeMakers((turn) => story(turn.prompt));
	const sessions = memorySessions();
	const agents = makeAgents({adapters: fakes, sessions, reaper: noReaper});
	return {fakes, agents};
};

const flagsOf = (more: Partial<AgentFlags> = {}): AgentFlags => ({
	folder: "/work/copy",
	session: "sort/7",
	model: undefined,
	effort: undefined,
	system: undefined,
	usd: undefined,
	tools: undefined,
	seconds: undefined,
	...more,
});

const MAKERS: readonly Maker[] = ["claude", "codex"];
const programOf = (maker: Maker) => (maker === "claude" ? claudeProgram : codexProgram);

/** One prompt, the input closed after it, as `claude -p` or `codex exec`: every output, in order. */
type UntypedFlags = Given<(typeof claudeProgram)["flags"]>;
const once = (maker: Maker, prompt: string, more: Partial<UntypedFlags> = {}, w = world()) =>
	Effect.gen(function* () {
		const called = yield* call(
			programOf(maker),
			{...flagsOf(more), answer: more.answer},
			{told: {prompt: [prompt]}, keeping: {id: `${maker}:run`, storage: memoryStorage()}},
		).pipe(Effect.provideService(Agents, w.agents));
		if (called.kind !== "called") return yield* Effect.die(`refused: ${called.why}`);
		return called.heard;
	});

const until = (check: () => boolean) =>
	Effect.gen(function* () {
		while (!check()) yield* Effect.sleep(Duration.millis(2));
	}).pipe(Effect.timeout("2 seconds"), Effect.orDie);

describe("the fakes say what each real adapter makes of its maker's events", () => {
	it("claude: the SDK's messages, through rawOf", () => {
		const sdk = (m: Record<string, unknown>) =>
			// biome-ignore lint/plugin: a fixture holds the few fields rawOf reads; the SDK's full type has dozens more
			m as unknown as SDKMessage;
		const raws = [
			sdk({
				type: "assistant",
				parent_tool_use_id: null,
				message: {content: [{type: "tool_use", id: "t1", name: "Read", input: {}}]},
			}),
			sdk({
				type: "user",
				parent_tool_use_id: null,
				message: {content: [{type: "tool_result", tool_use_id: "t1"}]},
			}),
			sdk({
				type: "assistant",
				parent_tool_use_id: null,
				message: {content: [{type: "text", text: "Read the ticket."}]},
			}),
			sdk({
				type: "result",
				subtype: "success",
				is_error: false,
				total_cost_usd: 0.012,
				num_turns: 2,
				structured_output: GOOD,
				usage: {
					input_tokens: 300,
					output_tokens: 40,
					cache_read_input_tokens: 900,
					cache_creation_input_tokens: 0,
				},
			}),
		].flatMap((m) => rawOf(m) as Raw[]);
		expect(raws).toEqual(claudeRaws(story("sort #7")));
	});

	it("codex: `codex exec --json` lines, through rawOfLine", () => {
		const lines = [
			{type: "item.started", item: {id: "t1", type: "command_execution", command: "Read"}},
			{
				type: "item.completed",
				item: {id: "t1", type: "command_execution", command: "Read", status: "completed"},
			},
			{type: "item.completed", item: {id: "m1", type: "agent_message", text: "Read the ticket."}},
			{type: "item.completed", item: {id: "m2", type: "agent_message", text: JSON.stringify(GOOD)}},
			{
				type: "turn.completed",
				usage: {input_tokens: 1100, cached_input_tokens: 800, output_tokens: 35},
			},
		];
		const raws = lines.flatMap((l) => rawOfLine(JSON.stringify(l)) as Raw[]);
		expect(raws).toEqual(codexRaws(story("sort #7")));
	});
});

describe("claude and codex, at parity", () => {
	it.live("the same outputs in the same order; only what the maker says of its cost differs", () =>
		Effect.gen(function* () {
			const answer = SORTED_JSON_SCHEMA;
			const [c, x] = [
				yield* once("claude", "sort #7", {answer}),
				yield* once("codex", "sort #7", {answer}),
			];
			// Codex's answer is a message too: the program shows it as said, as the maker said it.
			expect(c.map((h) => h.name)).toEqual(["started", "tool", "tool", "said", "ended"]);
			expect(x.map((h) => h.name)).toEqual(["started", "tool", "tool", "said", "said", "ended"]);
			const end = (heard: typeof c) => heard.find((h) => h.name === "ended")?.value;
			expect(end(c)).toMatchObject({
				turn: 1,
				stop: "end_turn",
				answer: GOOD,
				counted: "turn",
				usd: 0.012,
				requests: 2,
			});
			expect(end(x)).toMatchObject({
				turn: 1,
				stop: "end_turn",
				answer: GOOD,
				counted: "turn",
				usd: null,
				requests: null,
			});
			expect(c[0]?.value).toEqual({maker: "claude", session: "sort/7", resumed: false, resent: 0});
			expect(x[0]?.value).toEqual({maker: "codex", session: "sort/7", resumed: false, resent: 0});
		}),
	);

	for (const maker of MAKERS)
		it.live(`${maker}: a second start on the same session carries the maker's own session on`, () =>
			Effect.gen(function* () {
				const w = world();
				yield* once(maker, "sort #7", {}, w);
				const again = yield* once(maker, "sort #7 again", {}, w);
				expect(again[0]?.value).toMatchObject({resumed: true});
				const seen = w.fakes[maker].seen.started;
				expect(seen.map((t) => t.resume)).toEqual([null, "fake-own-1"]);
				expect(seen.map((t) => t.session)).toEqual(["sort/7", "sort/7"]);
			}),
		);

	for (const maker of MAKERS)
		it.live(`${maker}: cancel by number, before the turn is read and while it runs`, () =>
			Effect.gen(function* () {
				const w = world();
				const ended = ear<{readonly turn: number; readonly stop: string}>();
				const said = ear<unknown>();
				const started = yield* start(
					programOf(maker),
					{...flagsOf(), answer: undefined},
					{ended: ended.hear, said: said.hear},
					{id: `${maker}:cancel`, storage: memoryStorage()},
				).pipe(Effect.provideService(Agents, w.agents));
				if (started.kind !== "running") return yield* Effect.die("not started");
				// Turn 2 cancelled before anyone told it; turn 1 hangs, and is cancelled while it runs.
				yield* tell(started.run, "cancel", 2);
				yield* tell(started.run, "prompt", "hang");
				yield* tell(started.run, "prompt", "sort #7");
				yield* tell(started.run, "prompt", "sort #7 too");
				yield* until(() => said.values.length > 0);
				yield* tell(started.run, "cancel", 1);
				started.close("prompt");
				yield* started.run.ended;
				expect(ended.values.map((e) => [e.turn, e.stop])).toEqual([
					[1, "cancelled"],
					[2, "cancelled"],
					[3, "end_turn"],
				]);
				// The service's stop runs at the end of every turn that reached the maker, cut or not; turn 2 never did.
				expect(w.fakes[maker].seen.stopped).toBe(2);
				expect(w.fakes[maker].seen.started.map((t) => t.prompt.split("\n")[0])).toEqual([
					"hang",
					"sort #7 too",
				]);
			}),
		);

	it.live("a dollar cap: claude takes it, codex fails the turn at start, and says why", () =>
		Effect.gen(function* () {
			const c = yield* once("claude", "sort #7", {usd: 0.5});
			const x = yield* once("codex", "sort #7", {usd: 0.5});
			expect(c.at(-1)?.value).toMatchObject({stop: "end_turn"});
			expect(x.at(-1)?.value).toMatchObject({
				stop: "failed",
				error: expect.stringContaining("cannot_limit"),
			});
		}),
	);

	for (const maker of MAKERS)
		it.live(`${maker}: an allow for an ask nothing waits on is said back, not lost`, () =>
			Effect.gen(function* () {
				const w = world();
				const asks = ear<unknown>();
				const started = yield* start(
					programOf(maker),
					{...flagsOf(), answer: undefined},
					{ask: asks.hear},
					{id: `${maker}:ask`, storage: memoryStorage()},
				).pipe(Effect.provideService(Agents, w.agents));
				if (started.kind !== "running") return yield* Effect.die("not started");
				yield* tell(started.run, "allow", "ask-1");
				const [heard] = yield* asks.upTo(1);
				expect(heard).toEqual({turn: null, id: "ask-1", title: "", answer: "not_waiting"});
				yield* started.stop;
			}),
		);

	for (const maker of MAKERS)
		it.live(
			`${maker}: a start after a stop mid-turn keeps the conversation and sends the cut-off turn again`,
			() =>
				Effect.gen(function* () {
					const w = world();
					const storage: Storage = memoryStorage();
					const first = yield* Effect.scoped(
						Effect.gen(function* () {
							const said = ear<unknown>();
							const started = yield* start(
								programOf(maker),
								{...flagsOf(), answer: undefined},
								{said: said.hear},
								{id: `${maker}:kept`, storage},
							).pipe(Effect.provideService(Agents, w.agents));
							if (started.kind !== "running") return yield* Effect.die("not started");
							yield* tell(started.run, "prompt", "hang once");
							yield* until(() => said.values.length > 0);
							return started.run.machines.conversation.state();
						}),
					);
					expect(first).toMatchObject({told: 1, turns: [{n: 1, prompt: "hang once", end: null}]});
					const hears = ear<{readonly resent?: number; readonly stop?: string}>();
					yield* Effect.scoped(
						Effect.gen(function* () {
							const started = yield* start(
								programOf(maker),
								{...flagsOf(), answer: undefined},
								{started: hears.hear, ended: hears.hear},
								{id: `${maker}:kept`, storage},
							).pipe(Effect.provideService(Agents, w.agents));
							if (started.kind !== "running") return yield* Effect.die("not started");
							yield* until(() => hears.values.length > 0);
							// Sent again: the maker carries the session on, and the turn hangs again until cancelled.
							yield* until(() => w.fakes[maker].seen.started.length === 2);
							yield* tell(started.run, "cancel", "now");
							yield* until(() => hears.values.length === 2);
						}),
					);
					expect(hears.values).toMatchObject([{resent: 1}, {stop: "cancelled"}]);
					expect(w.fakes[maker].seen.started.map((t) => t.resume)).toEqual([null, "fake-own-1"]);
				}),
		);
});

describe("the typed answer across the program boundary", () => {
	const answer = SORTED_JSON_SCHEMA;
	const typed = (maker: Maker) => typedAgentProgram(maker, Sorted, `${maker}-sort`);
	const endOf = (maker: Maker, way: "A" | "B" | "C", prompt: string) =>
		Effect.gen(function* () {
			const w = world();
			if (way === "C") {
				const called = yield* call(typed(maker), flagsOf(), {
					told: {prompt: [prompt]},
					keeping: {id: "c", storage: memoryStorage()},
				}).pipe(Effect.provideService(Agents, w.agents));
				if (called.kind !== "called") return yield* Effect.die("refused");
				return called.heard.find((h) => h.name === "ended")?.value.answer;
			}
			const heard = yield* once(maker, prompt, way === "B" ? {answer} : {}, w);
			const end = heard.find((h) => h.name === "ended")?.value as
				| {readonly answer: unknown}
				| undefined;
			return end?.answer;
		});

	for (const maker of MAKERS)
		it.live(`${maker}: a wrong label and a wrong ticket, each way`, () =>
			Effect.gen(function* () {
				const rows: Record<string, readonly unknown[]> = {};
				for (const way of ["A", "B", "C"] as const)
					rows[way] = [
						yield* endOf(maker, way, "sort #7"),
						yield* endOf(maker, way, "bad label"),
						yield* endOf(maker, way, "bad ticket"),
					];
				// A: any JSON passes; the stage must check, and nothing makes it.
				expect(rows.A).toEqual([GOOD, {label: "bogus", ticket: "#7"}, {label: "bug", ticket: "7"}]);
				// B: the JSON Schema holds the label, and loses the ticket's check.
				expect(rows.B).toEqual([GOOD, null, {label: "bug", ticket: "7"}]);
				// C: the stage's own schema holds both.
				expect(rows.C).toEqual([GOOD, null, null]);
			}),
		);

	it("C's `ended` fits a stage input of the same schema, and A's does not: a pipe checks it at the line", () => {
		const into = {shape: typed("claude").outputs.ended.shape};
		expect(fit(typed("codex").outputs.ended, into)).toBe("fits");
		expect(fit(agentProgram("claude").outputs.ended, into)).toBe("does_not_fit");
	});
});
