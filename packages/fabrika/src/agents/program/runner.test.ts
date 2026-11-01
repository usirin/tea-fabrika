import {describe, expect, it} from "@effect/vitest";
import {Duration, Effect, Fiber, Latch, Schema, Stream} from "effect";
import {defineProgram, start, tell} from "../../program/program.ts";
import {CAPACITY} from "../../program/shape.ts";
import {memoryStorage, type Storage} from "../../program/storage.ts";
import {makeAgents} from "../agent/core.ts";
import {fakeAdapter, saying} from "../agent/fake.ts";
import {memorySessions} from "../agent/sessions.ts";
import {
	type Adapter,
	type AdapterTurn,
	Agents,
	failed,
	NO_LIMITS,
	noReaper,
	type Raw,
	type Stop,
	type Tokens,
} from "../agent/turn.ts";
import type {DraftMsg, DraftRun} from "../claude/draft.ts";
import type {Reads} from "../claude/schema.ts";
import {type AgentFlags, chat, flags, inputs, outputs} from "./chat.ts";
import {Conversation, conversationKind, End, type Provider} from "./conversation.ts";
import {fakeProviders, type Story} from "./fakes.ts";
import {programRunner} from "./runner.ts";

// `programRunner` and what it leans on in `chat`, on both fake providers: the three Msgs of a
// Draft, what each says when a run is refused or fails, what a child started again under the same
// id does (it pays for nothing twice), and what a kill leaves of the prompts waiting. The two real
// programs are one `defineProgram` each around `chat`; here is that one line, so this file tests
// the library with no package above it.

const programs = {
	claude: defineProgram({
		name: "claude",
		description: "claude, for this test",
		flags,
		inputs,
		outputs,
		machines: {conversation: conversationKind},
		view: {machine: "conversation", data: Conversation, of: (s: Conversation) => s},
		main: (io) => chat("claude", io),
	}),
	codex: defineProgram({
		name: "codex",
		description: "codex, for this test",
		flags,
		inputs,
		outputs,
		machines: {conversation: conversationKind},
		view: {machine: "conversation", data: Conversation, of: (s: Conversation) => s},
		main: (io) => chat("codex", io),
	}),
};

const GOOD = {label: "bug"};
const SPENT: Tokens = {input: 70, cached: 5, output: 9};
const LABEL_SCHEMA = {
	type: "object",
	properties: {label: {type: "string", enum: ["bug", "feature"]}},
	required: ["label"],
	additionalProperties: false,
} as const;

const story = (turn: AdapterTurn): Story => {
	const p = turn.prompt;
	return {
		tool: {id: "t1", title: "Read"},
		said: "Read the ticket.",
		answer: p.includes("misfit") ? {label: "nope"} : GOOD,
		hang: p.includes("hang"),
		...(p.includes("counts") ? {spent: SPENT} : {}),
	};
};

const world = (provider: Provider) => {
	const fake = fakeProviders(story)[provider];
	const sessions = memorySessions();
	const agents = makeAgents({adapters: {[provider]: fake}, sessions, reaper: noReaper});
	return {fake, agents, sessions, storage: memoryStorage() as Storage};
};
type World = ReturnType<typeof world>;

const given = (more: Partial<AgentFlags> = {}): AgentFlags => ({
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

const RUN = {key: "sort:7", id: "sort:7/1", prompt: "sort #7", session: {id: "sort/7"}} as DraftRun;

const runner = (provider: Provider, w: World, more: Partial<AgentFlags> = {}, prompt = "sort") =>
	programRunner({
		name: "sort",
		program: programs[provider],
		agents: w.agents,
		flags: () => given(more),
		keeping: () => ({id: `child:${provider}`, storage: w.storage}),
	})({...RUN, prompt});

type Msg = DraftMsg<"sort", Schema.Json>;
const all = (stream: Stream.Stream<Msg>) =>
	stream.pipe(Stream.runCollect, Effect.map(Array.from<Msg>));

const until = (check: () => boolean) =>
	Effect.gen(function* () {
		while (!check()) yield* Effect.sleep(Duration.millis(2));
	}).pipe(Effect.timeout("2 seconds"), Effect.orDie);

/** Start the program with no runner, as a host does; `act` tells it things; the scope's end is the kill. */
const killedAfter = (
	provider: Provider,
	w: World,
	act: (told: (prompt: string) => Effect.Effect<unknown>) => Effect.Effect<void>,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const started = yield* start(
				programs[provider],
				given(),
				{},
				{id: `child:${provider}`, storage: w.storage},
			).pipe(Effect.provideService(Agents, w.agents));
			if (started.kind !== "running") return yield* Effect.die("not started");
			yield* act((p) => tell(started.run, "prompt", p).pipe(Effect.orDie));
			yield* until(() => started.run.mailbox().length === 0);
		}),
	);

/** What the program kept under this run, read back by starting it with `prompt` closed. */
/**
 * A storage that holds the save of `began`, the second save with one turn in it (`told` is the
 * first): a turn caught between being read and running.
 */
const heldAtBegan = (inner: Storage) => {
	const open = Effect.runSync(Latch.make(false));
	let withOneTurn = 0;
	return {
		reached: () => withOneTurn >= 2,
		release: open.open,
		record: inner.record,
		remove: inner.remove,
		open: (run: string, given: unknown) =>
			inner.open(run, given).pipe(
				Effect.map((handle) => ({
					...handle,
					store: <S>(machine: string, id: string, state: Schema.Codec<S, unknown>) => {
						const store = handle.store(machine, id, state);
						return {
							...store,
							save: (s: S) => {
								if ((s as Conversation).turns.length === 1) withOneTurn++;
								return withOneTurn === 2 && (s as Conversation).turns.length === 1
									? Effect.runPromise(open.await).then(() => store.save(s))
									: store.save(s);
							},
						};
					},
				})),
			),
	} satisfies Storage & {readonly reached: unknown; readonly release: unknown};
};

const heardAfterRestart = (provider: Provider, w: World) =>
	Effect.scoped(
		Effect.gen(function* () {
			const heard: {readonly name: string; readonly value: unknown}[] = [];
			const hear = (name: string) => (value: unknown) => {
				heard.push({name, value});
			};
			const started = yield* start(
				programs[provider],
				given(),
				{started: hear("started"), ended: hear("ended")},
				{id: `child:${provider}`, storage: w.storage},
			).pipe(Effect.provideService(Agents, w.agents));
			if (started.kind !== "running") return yield* Effect.die("not started");
			started.close("prompt");
			const ended = yield* started.run.ended;
			return {heard, ended: ended.kind};
		}),
	);

describe("the service keeps what did not fit", () => {
	const Label = Schema.Struct({label: Schema.Literal("bug")});
	const endOf = (raws: readonly Raw[], holds = {usd: false, schema: true}) =>
		Effect.gen(function* () {
			const fake = fakeAdapter(() => ({raws}), holds);
			const agents = makeAgents({
				adapters: {fake},
				sessions: memorySessions(),
				reaper: noReaper,
			});
			const heard = yield* agents
				.run({
					provider: "fake",
					session: "s",
					folder: "/w",
					prompt: "p",
					system: {_tag: "append", text: ""},
					answer: Label as Reads<{readonly label: "bug"}>,
					model: null,
					effort: null,
					limits: NO_LIMITS,
				})
				.pipe(Stream.runCollect);
			return Array.from(heard).at(-1);
		});
	const said = (text: string): Raw => ({_tag: "said", text});
	const ended = (structured: unknown, stop: Stop = "end_turn"): Raw => ({
		_tag: "ended",
		stop,
		structured,
		usd: null,
		requests: null,
	});

	for (const [what, raws, misfit] of [
		["a typed answer that does not fit", [ended({label: "x"})], {label: "x"}],
		["a typed null", [ended(null)], null],
		["a last message of JSON", [said('  {"label":"x"} '), ended(undefined)], {label: "x"}],
		["a last message of words", [said(" no idea "), ended(undefined)], "no idea"],
	] as const)
		it.live(`${what}: kept as it came`, () =>
			Effect.map(endOf(raws), (end) => {
				expect(end).toMatchObject({_tag: "ended", answer: null, misfit});
			}),
		);

	for (const [what, raws] of [
		["nothing said", [ended(undefined)]],
		["an empty message", [said("  "), ended(undefined)]],
		["an answer that fits", [ended({label: "bug"})]],
		["a turn stopped short", [said("no idea"), ended(undefined, "cancelled")]],
	] as const)
		it.live(`${what}: no misfit`, () =>
			Effect.map(endOf(raws), (end) => {
				expect(end).toHaveProperty("_tag", "ended");
				expect(end).not.toHaveProperty("misfit");
			}),
		);
});

describe("the service tells a maker of no schema nothing", () => {
	const promptWith = <A>(answer: Reads<A>) =>
		Effect.gen(function* () {
			const fake = fakeAdapter(() => saying("{}"), {usd: false, schema: false});
			const agents = makeAgents({
				adapters: {fake},
				sessions: memorySessions(),
				reaper: noReaper,
			});
			yield* agents
				.run({
					provider: "fake",
					session: "s",
					folder: "/w",
					prompt: "p",
					system: {_tag: "append", text: ""},
					answer,
					model: null,
					effort: null,
					limits: NO_LIMITS,
				})
				.pipe(Stream.runDrain);
			return fake.seen.started[0]?.prompt;
		});

	it.live("no schema: the prompt alone; a schema: the prompt asks for its form", () =>
		Effect.gen(function* () {
			expect(yield* promptWith(Schema.Json)).toBe("p");
			expect(yield* promptWith(Schema.Struct({n: Schema.Number}))).toContain(
				"matching this JSON Schema:",
			);
		}),
	);
});

for (const provider of ["claude", "codex"] as const) {
	const paid = provider === "claude";

	describe(`programRunner on ${provider}`, () => {
		it.live(
			"a good turn: one tool Msg per tool id, then finished with the answer and its spend",
			() =>
				Effect.gen(function* () {
					const w = world(provider);
					const msgs = yield* all(runner(provider, w));
					const tokens = paid ? 1240 : 1135;
					expect(msgs).toEqual([
						{type: "sort_tool", key: RUN.key, id: RUN.id, tool: "Read"},
						{
							type: "sort_finished",
							key: RUN.key,
							id: RUN.id,
							output: GOOD,
							session: "sort/7",
							spend: {
								costUsd: paid ? 0.012 : 0,
								tokens,
								context: 0,
								turns: paid ? 2 : 0,
								minutes: expect.any(Number),
							},
						},
					]);
					expect(w.fake.seen.started).toHaveLength(1);
					expect(w.fake.seen.started[0]?.prompt).toBe("sort");
				}),
		);

		it.live("it ends the program: the prompt input closes after the one prompt", () =>
			Effect.gen(function* () {
				const w = world(provider);
				yield* all(runner(provider, w));
				const after = yield* heardAfterRestart(provider, w);
				expect(after.ended).toBe("ended");
				expect(after.heard).toMatchObject([{name: "started", value: {resent: 0, resumed: true}}]);
				expect(w.fake.seen.started).toHaveLength(1);
			}),
		);

		it.live("it keeps the prompt input closed, on the run's record", () =>
			Effect.gen(function* () {
				const w = world(provider);
				yield* all(runner(provider, w));
				const record = yield* w.storage.record(`child:${provider}`).pipe(Effect.orDie);
				expect(record?.closed).toEqual(["prompt"]);
			}),
		);

		it.live("a turn that does not end on its own is a failed Msg, with what it spent", () =>
			Effect.gen(function* () {
				const w = world(provider);
				const msgs = yield* all(runner(provider, w, {seconds: 0.02}, "hang"));
				expect(msgs.at(-1)).toMatchObject({type: "sort_failed", key: RUN.key, id: RUN.id});
				const last = msgs.at(-1);
				expect(last?.type === "sort_failed" ? last.error : "no").toBe("over_time");
				expect(w.fake.seen.stopped).toBe(1);
			}),
		);

		it.live("a provider's failure says its words", () =>
			Effect.gen(function* () {
				const w = world(provider);
				// A dollar cap is refused where the provider holds none; give Claude's row none too.
				const held: Adapter = {...w.fake, holds: {usd: false, schema: true}};
				const agents = makeAgents({
					adapters: {[provider]: held},
					sessions: memorySessions(),
					reaper: noReaper,
				});
				const msgs = yield* all(
					programRunner({
						name: "sort",
						program: programs[provider],
						agents,
						flags: () => given({usd: 1}),
						keeping: () => ({id: "child:cap", storage: memoryStorage()}),
					})(RUN),
				);
				expect(msgs).toHaveLength(1);
				const last = msgs[0];
				expect(last?.type).toBe("sort_failed");
				expect(last?.type === "sort_failed" ? last.error : "").toMatch(/^cannot_limit: /);
			}),
		);

		it.live("flags its shape refuses: the Msg says which", () =>
			Effect.gen(function* () {
				const w = world(provider);
				const msgs = yield* all(runner(provider, w, {seconds: -1}));
				expect(msgs).toHaveLength(1);
				const m = msgs[0];
				expect(m?.type).toBe("sort_failed");
				expect(m?.type === "sort_failed" ? m.error : "").toMatch(
					/^the agent program refused seconds: /,
				);
				expect(w.fake.seen.started).toEqual([]);
			}),
		);

		// The review: the stage heard only `failed with no answer`, and never why.
		for (const [what, more, words] of [
			["a folder that is not absolute", {folder: "work"}, "--folder must be an absolute path"],
			["a schema that is no schema", {schema: {type: 5}}, "--schema is no JSON Schema"],
			["a broken $ref", {schema: {$ref: "#/nope"}}, "--schema is no JSON Schema"],
		] as const)
			it.live(`a run refused for ${what}: the Msg gives the program's own words`, () =>
				Effect.gen(function* () {
					const w = world(provider);
					const msgs = yield* all(runner(provider, w, more as Partial<AgentFlags>));
					expect(msgs).toHaveLength(1);
					const m = msgs[0];
					expect(m?.type).toBe("sort_failed");
					const error = m?.type === "sort_failed" ? m.error : "";
					expect(error).toContain("the agent program failed with no answer: ");
					expect(error).toContain(words);
					expect(w.fake.seen.started).toEqual([]);
				}),
			);

		it.live("a run on the other provider's kept conversation is refused, with its words", () =>
			Effect.gen(function* () {
				const w = world(provider);
				const other: Provider = provider === "claude" ? "codex" : "claude";
				yield* all(
					programRunner({
						name: "sort",
						program: programs[other],
						agents: makeAgents({
							adapters: {[other]: fakeProviders(story)[other]},
							sessions: memorySessions(),
							reaper: noReaper,
						}),
						flags: () => given(),
						keeping: () => ({id: `child:${provider}`, storage: w.storage}),
					})(RUN),
				);
				const msgs = yield* all(runner(provider, w));
				expect(msgs).toHaveLength(1);
				const m = msgs[0];
				expect(m?.type === "sort_failed" ? m.error : "").toContain(
					`this run's session is on ${other}: it cannot move to ${provider}`,
				);
				expect(w.fake.seen.started).toEqual([]);
			}),
		);

		it.live(
			"--schema refuses an answer: the Msg hands it on as it came, for the stage's decode",
			() =>
				Effect.gen(function* () {
					const w = world(provider);
					const msgs = yield* all(runner(provider, w, {schema: LABEL_SCHEMA}, "misfit"));
					expect(msgs.at(-1)).toMatchObject({type: "sort_finished", output: {label: "nope"}});
					// It is kept: a child started again hands on the same words, for no second turn.
					const again = yield* all(runner(provider, w, {schema: LABEL_SCHEMA}, "misfit"));
					expect(again).toMatchObject([{type: "sort_finished", output: {label: "nope"}}]);
					expect(w.fake.seen.started).toHaveLength(1);
				}),
		);

		it.live(
			"started again after its turn ended: the kept answer comes back, and no turn is paid for",
			() =>
				Effect.gen(function* () {
					const w = world(provider);
					const first = yield* all(runner(provider, w));
					const again = yield* all(runner(provider, w));
					expect(w.fake.seen.started).toHaveLength(1);
					expect(again).toHaveLength(1);
					const [f, a] = [first.at(-1), again[0]];
					expect(a?.type).toBe("sort_finished");
					if (f?.type !== "sort_finished" || a?.type !== "sort_finished")
						return yield* Effect.die("no answer");
					expect(a.output).toEqual(f.output);
					expect(a.spend).toEqual(f.spend);
					expect(a.session).toBe("sort/7");
				}),
		);

		it.live(
			"started again after a turn that failed: the kept failure comes back, with no new turn",
			() =>
				Effect.gen(function* () {
					const w = world(provider);
					const first = yield* all(runner(provider, w, {seconds: 0.02}, "hang"));
					const again = yield* all(runner(provider, w, {seconds: 0.02}, "hang"));
					expect(w.fake.seen.started).toHaveLength(1);
					expect(again.map((m) => m.type)).toEqual(["sort_failed"]);
					expect(first.at(-1)?.type).toBe("sort_failed");
					expect(again[0]?.type === "sort_failed" ? again[0].error : "").toBe("over_time");
				}),
		);

		it.live(
			"started again mid-turn: the program runs the cut-off turn again, once, and the Msg is its",
			() =>
				Effect.gen(function* () {
					let turns = 0;
					const fake = fakeProviders(() => {
						turns += 1;
						return {said: "ok", answer: GOOD, hang: turns === 1};
					})[provider];
					const w: World = {
						...world(provider),
						fake,
						agents: makeAgents({
							adapters: {[provider]: fake},
							sessions: memorySessions(),
							reaper: noReaper,
						}),
					};
					yield* killedAfter(provider, w, (told) =>
						Effect.gen(function* () {
							yield* told("sort");
							yield* until(() => fake.seen.started.length === 1);
						}),
					);
					expect(fake.seen.started).toHaveLength(1);
					const msgs = yield* all(runner(provider, w, {}, "a prompt that must not run"));
					expect(msgs.at(-1)?.type).toBe("sort_finished");
					expect(fake.seen.started.map((t) => t.prompt)).toEqual(["sort", "sort"]);
				}),
		);

		it.live("the Sub turned off stops the run and its turn", () =>
			Effect.gen(function* () {
				const w = world(provider);
				const fiber = yield* Effect.forkChild(all(runner(provider, w, {}, "hang")));
				yield* until(() => w.fake.seen.started.length === 1);
				yield* Fiber.interrupt(fiber);
				expect(w.fake.seen.stopped).toBe(1);
			}),
		);
	});

	describe(`chat on ${provider}, what a kill leaves`, () => {
		it.live(
			"prompts read while a turn ran are kept: a start runs them all, in the order told",
			() =>
				Effect.gen(function* () {
					const w = world(provider);
					yield* killedAfter(provider, w, (told) =>
						Effect.gen(function* () {
							yield* told("first hang");
							yield* until(() => w.fake.seen.started.length === 1);
							yield* told("second");
							yield* told("third");
						}),
					);
					expect(w.fake.seen.started).toHaveLength(1);
					const fake = fakeProviders(() => ({said: "ok", answer: GOOD}))[provider];
					const after = yield* heardAfterRestart(provider, {
						...w,
						fake,
						agents: makeAgents({
							adapters: {[provider]: fake},
							sessions: w.sessions,
							reaper: noReaper,
						}),
					});
					expect(after.ended).toBe("ended");
					expect(after.heard[0]).toMatchObject({
						name: "started",
						value: {resent: 3, resumed: true},
					});
					expect(after.heard.slice(1).map((h) => h.value)).toMatchObject([
						{turn: 1, stop: "end_turn"},
						{turn: 2, stop: "end_turn"},
						{turn: 3, stop: "end_turn"},
					]);
					expect(fake.seen.started.map((t) => t.prompt)).toEqual(["first hang", "second", "third"]);
				}),
		);

		it.live(
			"the line of kept prompts has an end: past it a prompt waits, and each end makes room",
			() =>
				Effect.gen(function* () {
					const id = `full:${provider}`;
					const storage = memoryStorage();
					// A run killed with the line full: writing that state beats telling a thousand prompts.
					const handle = yield* storage.open(id, given());
					const turns = Array.from({length: CAPACITY}, (_, i) => ({
						n: i + 1,
						prompt: `line ${i + 1}`,
						said: [],
						tools: [],
						asks: [],
						end: null,
					}));
					yield* Effect.promise(() =>
						handle
							.store("conversation", "conversation", Conversation)
							.save({provider, session: "sort/7", told: CAPACITY, turns}),
					);
					let began = 0;
					const fake = fakeProviders(() => {
						began += 1;
						return {said: "ok", answer: GOOD, hang: began === 1};
					})[provider];
					const agents = makeAgents({
						adapters: {[provider]: fake},
						sessions: memorySessions(),
						reaper: noReaper,
					});
					const started = yield* start(programs[provider], given(), {}, {id, storage}).pipe(
						Effect.provideService(Agents, agents),
					);
					if (started.kind !== "running") return yield* Effect.die("not started");
					const told = () => started.run.machines.conversation.state()?.told;
					yield* until(() => fake.seen.started.length === 1);
					yield* tell(started.run, "prompt", "one too many");
					yield* until(() => started.run.mailbox().length === 0);
					// The handler has it, and waits for room: it is not kept yet.
					yield* Effect.sleep(Duration.millis(30));
					expect(told()).toBe(CAPACITY);
					yield* tell(started.run, "cancel", 1);
					yield* until(() => told() === CAPACITY + 1);
				}).pipe(Effect.scoped),
		);

		it.live("a turn ended before the kill is not sent again, and the ones after it are", () =>
			Effect.gen(function* () {
				const w = world(provider);
				const told2 = "next hang";
				yield* killedAfter(provider, w, (told) =>
					Effect.gen(function* () {
						yield* told("done");
						yield* told(told2);
						yield* until(() => w.fake.seen.started.length === 2);
					}),
				);
				const fake = fakeProviders(() => ({said: "ok", answer: GOOD}))[provider];
				const after = yield* heardAfterRestart(provider, {
					...w,
					fake,
					agents: makeAgents({
						adapters: {[provider]: fake},
						sessions: w.sessions,
						reaper: noReaper,
					}),
				});
				expect(after.heard[0]).toMatchObject({value: {resent: 1}});
				expect(fake.seen.started.map((t) => t.prompt)).toEqual([told2]);
			}),
		);
	});

	describe(`chat on ${provider}, a cancel while a turn starts`, () => {
		it.live("a cancel by number read before the turn is running still stops it", () =>
			Effect.gen(function* () {
				const w = world(provider);
				const storage = heldAtBegan(w.storage);
				const ended: End[] = [];
				const started = yield* start(
					programs[provider],
					given(),
					{
						ended: (e) => {
							ended.push(e);
						},
					},
					{id: `starting:${provider}`, storage},
				).pipe(Effect.provideService(Agents, w.agents));
				if (started.kind !== "running") return yield* Effect.die("not started");
				yield* tell(started.run, "prompt", "hang");
				yield* until(storage.reached);
				yield* tell(started.run, "cancel", 1);
				yield* until(() => started.run.mailbox().length === 0);
				yield* storage.release;
				yield* until(() => ended.length === 1);
				expect(ended[0]).toMatchObject({stop: "cancelled"});
				expect(w.fake.seen.started).toHaveLength(1);
				expect(w.fake.seen.stopped).toBe(1);
			}).pipe(Effect.scoped),
		);
	});

	describe(`chat on ${provider}, what a cut turn records`, () => {
		const runCut = (w: World, prompt: string) =>
			Effect.gen(function* () {
				const ended: End[] = [];
				const started = yield* start(
					programs[provider],
					given(),
					{
						ended: (e) => {
							ended.push(e);
						},
					},
					{id: `cut:${provider}`, storage: w.storage},
				).pipe(Effect.provideService(Agents, w.agents));
				if (started.kind !== "running") return yield* Effect.die("not started");
				yield* tell(started.run, "prompt", prompt);
				yield* until(() => w.fake.seen.started.length === 1);
				yield* Effect.sleep(Duration.millis(10));
				yield* tell(started.run, "cancel", "now");
				yield* until(() => ended.length === 1);
				return ended[0];
			}).pipe(Effect.scoped);

		it.live("a provider that counts as it goes: the tokens heard before the cancel are kept", () =>
			Effect.gen(function* () {
				const end = yield* runCut(world(provider), "hang counts");
				expect(end).toMatchObject({
					stop: "cancelled",
					tokens: SPENT,
					counted: "requests",
					usd: null,
					requests: null,
				});
				expect(End.toSpend(end as End).tokens).toBe(79);
			}),
		);

		it.live("a turn the service failed keeps the tokens heard before it, and its words", () =>
			Effect.gen(function* () {
				const breaking: Adapter = {
					name: "fake",
					holds: {usd: false, schema: true},
					start: () =>
						Effect.succeed({
							updates: Stream.concat(
								Stream.make<Raw[]>(
									{_tag: "opened", own: "own"},
									{_tag: "tokens", tokens: SPENT, whole: false},
								),
								Stream.fail(failed("start", "it broke")),
							),
							pid: null,
							stop: Effect.void,
						}),
				};
				const agents = makeAgents({
					adapters: {[provider]: breaking},
					sessions: memorySessions(),
					reaper: noReaper,
				});
				const msgs = yield* all(
					programRunner({
						name: "sort",
						program: programs[provider],
						agents,
						flags: () => given(),
						keeping: () => ({id: "child:broke", storage: memoryStorage()}),
					})(RUN),
				);
				expect(msgs).toHaveLength(1);
				const m = msgs[0];
				expect(m?.type === "sort_failed" ? m.error : "").toBe("start: it broke");
				expect(m?.type === "sort_failed" ? m.spend.tokens : 0).toBe(79);
			}),
		);

		it.live("a provider that says nothing before its end: zero, and `counted` says none", () =>
			Effect.gen(function* () {
				const end = yield* runCut(world(provider), "hang");
				expect(end).toMatchObject({
					stop: "cancelled",
					tokens: {input: 0, cached: 0, output: 0},
					counted: "none",
					usd: null,
				});
			}),
		);
	});

	describe(`chat on ${provider}, what it says at a start`, () => {
		const startedWith = (w: World) =>
			Effect.scoped(
				Effect.gen(function* () {
					const out: unknown[] = [];
					const started = yield* start(
						programs[provider],
						given(),
						{
							started: (s) => {
								out.push(s);
							},
						},
						{id: `opened:${provider}`, storage: memoryStorage()},
					).pipe(Effect.provideService(Agents, w.agents));
					if (started.kind !== "running") return yield* Effect.die("not started");
					yield* until(() => out.length === 1);
					return out[0];
				}),
			);

		it.live("resumed is true only for a session this provider knows", () =>
			Effect.gen(function* () {
				const w = world(provider);
				const other: Provider = provider === "claude" ? "codex" : "claude";
				expect(yield* startedWith(w)).toMatchObject({resumed: false});
				yield* w.sessions.put("sort/7", other, "their-own");
				expect(yield* startedWith(w)).toMatchObject({resumed: false});
			}),
		);

		it.live("resumed is true for a session this provider opened", () =>
			Effect.gen(function* () {
				const w = world(provider);
				yield* w.sessions.put("sort/7", provider, "own");
				expect(yield* startedWith(w)).toMatchObject({resumed: true});
			}),
		);
	});

	describe(`chat on ${provider}, a turn with no --schema`, () => {
		it.live("the provider is told no schema, and the prompt stays the person's", () =>
			Effect.gen(function* () {
				const w = world(provider);
				yield* all(runner(provider, w));
				expect(w.fake.seen.started[0]?.schema).toEqual({});
				expect(w.fake.seen.started[0]?.prompt).toBe("sort");
			}),
		);

		it.live("an answer that is no JSON is kept beside its null, and handed on as words", () =>
			Effect.gen(function* () {
				const msgs = yield* all(
					programRunner({
						name: "sort",
						program: programs[provider],
						agents: makeAgents({
							adapters: {[provider]: fakeAdapter(() => saying("the answer is five"))},
							sessions: memorySessions(),
							reaper: noReaper,
						}),
						flags: () => given(),
						keeping: () => ({id: "child:words", storage: memoryStorage()}),
					})(RUN),
				);
				const last = msgs.at(-1);
				expect(last?.type === "sort_finished" ? last.output : "no").toBe("the answer is five");
			}),
		);
	});
}
