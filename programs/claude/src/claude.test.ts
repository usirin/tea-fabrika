import {describe, expect, it} from "@effect/vitest";
import {
	Agent,
	CAPACITY,
	call,
	ear,
	memoryStorage,
	type Storage,
	start,
	tell,
} from "@kampus/fabrika";
import {type AgentFlags, fakeProviders, type Story} from "@kampus/fabrika/agents/program";
import {Duration, Effect, Schema} from "effect";
import {claude} from "./index.ts";

// `claude` on its fake provider (`fakeProviders` in @kampus/fabrika/agents/program), which says a
// turn the way the real Claude adapter does. programs/codex/src/codex.test.ts is the same file
// for `codex`: a difference between the two shows as a row that differs, side by side.

const Sorted = Schema.Struct({
	label: Schema.Literals(["bug", "feature"]),
	// A check JSON Schema cannot say: `--schema` loses it, and the stage's decoder keeps it.
	ticket: Schema.String.check(
		Schema.makeFilter((s: string) => s.startsWith("#") || "a ticket starts with #"),
	),
});

/** Sorted as the `--schema` flag holds it: a JSON Schema, read as JSON. */
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
	const fake = fakeProviders((turn) => story(turn.prompt)).claude;
	const agents = Agent.makeAgents({
		adapters: {claude: fake},
		sessions: Agent.memorySessions(),
		reaper: Agent.noReaper,
	});
	return {fake, agents};
};

const flags = (more: Partial<AgentFlags> = {}): AgentFlags => ({
	folder: "/work/copy",
	session: "sort/7",
	model: undefined,
	effort: undefined,
	system: undefined,
	usd: undefined,
	tools: undefined,
	seconds: undefined,
	schema: undefined,
	...more,
});

/** One prompt, the input closed after it, as `claude -p`: every output, in order. */
const once = (prompt: string, more: Partial<AgentFlags> = {}, w = world()) =>
	Effect.gen(function* () {
		const called = yield* call(claude, flags(more), {
			told: {prompt: [prompt]},
			keeping: {id: "claude:run", storage: memoryStorage()},
		}).pipe(Effect.provideService(Agent.Agents, w.agents));
		if (called.kind !== "called") return yield* Effect.die(`refused: ${called.why}`);
		return called.heard;
	});

const until = (check: () => boolean) =>
	Effect.gen(function* () {
		while (!check()) yield* Effect.sleep(Duration.millis(2));
	}).pipe(Effect.timeout("2 seconds"), Effect.orDie);

describe("claude", () => {
	it.live("its outputs, in order; Claude says its dollars and its request count", () =>
		Effect.gen(function* () {
			const heard = yield* once("sort #7", {schema: SORTED_JSON_SCHEMA});
			expect(heard.map((h) => h.name)).toEqual(["started", "tool", "tool", "said", "ended"]);
			expect(heard[0]?.value).toEqual({
				provider: "claude",
				session: "sort/7",
				resumed: false,
				resent: 0,
			});
			expect(heard.at(-1)?.value).toMatchObject({
				turn: 1,
				stop: "end_turn",
				answer: GOOD,
				counted: "turn",
				usd: 0.012,
				requests: 2,
			});
		}),
	);

	it.live("a second start on the same session carries the provider's own session on", () =>
		Effect.gen(function* () {
			const w = world();
			yield* once("sort #7", {}, w);
			const again = yield* once("sort #7 again", {}, w);
			expect(again[0]?.value).toMatchObject({resumed: true});
			expect(w.fake.seen.started.map((t) => t.resume)).toEqual([null, "fake-own-1"]);
			expect(w.fake.seen.started.map((t) => t.session)).toEqual(["sort/7", "sort/7"]);
		}),
	);

	it.live("cancel by number, before the turn is read and while it runs", () =>
		Effect.gen(function* () {
			const w = world();
			const ended = ear<{readonly turn: number; readonly stop: string}>();
			const said = ear<unknown>();
			const started = yield* start(
				claude,
				flags(),
				{ended: ended.hear, said: said.hear},
				{id: "claude:cancel", storage: memoryStorage()},
			).pipe(Effect.provideService(Agent.Agents, w.agents));
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
			// The service's stop runs at the end of every turn that reached the provider, cut or not; turn 2 never did.
			expect(w.fake.seen.stopped).toBe(2);
			expect(w.fake.seen.started.map((t) => t.prompt.split("\n")[0])).toEqual([
				"hang",
				"sort #7 too",
			]);
		}),
	);

	it.live("a cancel is taken while a turn runs, with the mailbox full of prompts behind it", () =>
		Effect.gen(function* () {
			const w = world();
			const ended = ear<{readonly turn: number; readonly stop: string}>();
			const said = ear<unknown>();
			const started = yield* start(
				claude,
				flags(),
				{ended: ended.hear, said: said.hear},
				{id: "claude:busy", storage: memoryStorage()},
			).pipe(Effect.provideService(Agent.Agents, w.agents));
			if (started.kind !== "running") return yield* Effect.die("not started");
			yield* tell(started.run, "prompt", "hang");
			// Turn 1 runs: every prompt told now waits in the mailbox, until it is full.
			yield* until(() => said.values.length > 0);
			const words: Record<string, number> = {};
			for (let i = 0; i <= CAPACITY; i++) {
				const word = yield* tell(started.run, "prompt", "sort #7").pipe(
					Effect.catchTag("MailboxFull", (full) => Effect.succeed(full._tag)),
				);
				words[word] = (words[word] ?? 0) + 1;
			}
			const behind = started.run.mailbox();
			const told = yield* tell(started.run, "cancel", "now");
			const [first] = yield* ended.upTo(1);
			yield* started.stop;
			const none = {length: 0, waiting: 0};
			expect({words, behind, told, first: [first?.turn, first?.stop]}).toEqual({
				words: {queued: CAPACITY, MailboxFull: 1},
				behind: {
					length: CAPACITY,
					inputs: {
						prompt: {length: CAPACITY, waiting: 0},
						cancel: none,
					},
				},
				told: "queued",
				first: [1, "cancelled"],
			});
		}),
	);

	it.live("a dollar cap: Claude holds it, and the turn runs", () =>
		Effect.gen(function* () {
			const heard = yield* once("sort #7", {usd: 0.5});
			expect(heard.at(-1)?.value).toMatchObject({stop: "end_turn", error: null});
		}),
	);

	// Any program in a pipe can tell an input, so no input answers an ask: a person's answer is a
	// fact from their own session (docs/direction/one-ask-and-one-meter.md, proposed).
	it("no input answers an ask: only a prompt and a cancel are told", () => {
		expect(Object.keys(claude.inputs)).toEqual(["prompt", "cancel"]);
	});

	// `prompt` closed at the second start: `serve` returns at once, and the cancel must still reach the resent turn.
	for (const closed of [false, true])
		it.live(
			`a start after a stop mid-turn keeps the conversation and sends the cut-off turn again (prompt ${closed ? "closed" : "open"})`,
			() =>
				Effect.gen(function* () {
					const w = world();
					const storage: Storage = memoryStorage();
					const first = yield* Effect.scoped(
						Effect.gen(function* () {
							const said = ear<unknown>();
							const started = yield* start(
								claude,
								flags(),
								{said: said.hear},
								{id: "claude:kept", storage},
							).pipe(Effect.provideService(Agent.Agents, w.agents));
							if (started.kind !== "running") return yield* Effect.die("not started");
							yield* tell(started.run, "prompt", "hang once");
							yield* until(() => said.values.length > 0);
							return started.run.machines.conversation.state();
						}),
					);
					expect(first).toMatchObject({told: 1, turns: [{n: 1, prompt: "hang once", end: null}]});
					const hears = ear<{readonly resent?: number; readonly stop?: string}>();
					const after = yield* Effect.scoped(
						Effect.gen(function* () {
							const started = yield* start(
								claude,
								flags(),
								{started: hears.hear, ended: hears.hear},
								{id: "claude:kept", storage},
							).pipe(Effect.provideService(Agent.Agents, w.agents));
							if (started.kind !== "running") return yield* Effect.die("not started");
							if (closed) started.close("prompt");
							yield* until(() => hears.values.length > 0);
							// Sent again: the provider carries the session on, and the turn hangs again until cancelled.
							yield* until(() => w.fake.seen.started.length === 2);
							yield* tell(started.run, "cancel", "now");
							yield* until(() => hears.values.length === 2);
							// Closed: the run ends once the resent turn has. Open: it waits for the next prompt.
							return closed ? (yield* started.run.ended).kind : "still running";
						}),
					);
					expect(after).toBe(closed ? "ended" : "still running");
					expect(hears.values).toMatchObject([{resent: 1}, {stop: "cancelled"}]);
					expect(w.fake.seen.started.map((t) => t.resume)).toEqual([null, "fake-own-1"]);
				}),
		);

	it.live("the answer is plain JSON: --schema holds the label, and loses the ticket's check", () =>
		Effect.gen(function* () {
			const answer = (prompt: string, more: Partial<AgentFlags>) =>
				Effect.map(once(prompt, more), (heard) => {
					const end = heard.at(-1);
					return end?.name === "ended" ? end.value.answer : "no end";
				});
			const prompts = ["sort #7", "bad label", "bad ticket"];
			const without: unknown[] = [];
			const held: unknown[] = [];
			for (const p of prompts) {
				without.push(yield* answer(p, {}));
				held.push(yield* answer(p, {schema: SORTED_JSON_SCHEMA}));
			}
			// No schema: any JSON passes; the stage's decoder must catch it.
			expect(without).toEqual([GOOD, {label: "bogus", ticket: "#7"}, {label: "bug", ticket: "7"}]);
			// --schema: the wrong label is null, and the ticket without # passes, its check lost.
			expect(held).toEqual([GOOD, null, {label: "bug", ticket: "7"}]);
		}),
	);
});
