// Experiment 169: `claude` and `codex` as tea programs, one package each
// (programs/claude, programs/codex), on the parts they share in
// `@kampus/fabrika/agents/program`. Each stage that wants a typed answer hands
// the program a JSON Schema on `--schema` and decodes the plain answer with
// its own Effect schema (`decoder` in `@kampus/pipeline/decoder`). The saved
// numbers in results/169-agents-are-programs.json were measured on the first
// shape, one function that made both programs; the turn loop they time is the
// same code. Three steps:
//
//   P='env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15'
//   $P node experiments/169-agents-are-programs.ts order [n]   # prompt and cancel told at once, n times; fake providers, $0
//   $P node experiments/169-agents-are-programs.ts cost [n]    # one turn: Agents.run, a program call, a Draft's child run; fake, $0
//   $P node experiments/169-agents-are-programs.ts live        # one tiny prompt each: claude on haiku, codex on gpt-6-luna
//   node experiments/169-agents-are-programs.ts report         # no model: the saved numbers
//
// `live` signs Claude in the way Claude Code finds its own login (the keychain under USER, or
// CLAUDE_CODE_OAUTH_TOKEN if set; never printed), and Codex with the laptop's ChatGPT plan through
// a Codex home of its own that links to the login file. Each run works in a fresh temp folder, and
// the Codex home is removed after. Claude's turn is capped at $0.10.
//
// Node at the edge: fs for the temp folders and the results file.

import {mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Agent, call, ear, memoryStorage, start, tell} from "@kampus/fabrika";
import {codexHomeOf} from "@kampus/fabrika/agents/acp";
import {claudeAdapter, type DraftRun} from "@kampus/fabrika/agents/claude";
import {codexAdapter, psReaper} from "@kampus/fabrika/agents/codex";
import {
	type AgentFlags,
	fakeProviders,
	type Provider,
	programRunner,
} from "@kampus/fabrika/agents/program";
import {decoder} from "@kampus/pipeline/decoder";
import {claude} from "@tea-fabrika/claude";
import {codex} from "@tea-fabrika/codex";
import {Duration, Effect, Result, Schema, Stream} from "effect";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, "results", "169-agents-are-programs.json");
const CODEX = process.env.CODEX ?? join(homedir(), ".local", "bin", "codex");
const PROVIDERS: readonly Provider[] = ["claude", "codex"];
const PROGRAMS = {claude, codex};

type Results = Record<string, unknown>;
const saved = (): Results => {
	try {
		return JSON.parse(readFileSync(RESULTS, "utf8")) as Results;
	} catch {
		return {};
	}
};
const save = (key: string, value: unknown) => {
	const all = {...saved(), [key]: value};
	writeFileSync(RESULTS, `${JSON.stringify(all, null, "\t")}\n`);
};

const Answer = Schema.Struct({sum: Schema.Int});
/** The stage's side: the JSON Schema it hands the program, and its decode of what comes back. */
const summed = decoder(Answer);

const flags = (folder: string, more: Partial<AgentFlags> = {}): AgentFlags => ({
	folder,
	session: undefined,
	model: undefined,
	effort: undefined,
	system: undefined,
	usd: undefined,
	tools: undefined,
	seconds: undefined,
	schema: undefined,
	...more,
});

/** Fake providers: a prompt with "hang" never ends on its own; any other ends at once with {sum: 5}. */
const fakeWorld = () => {
	const fakes = fakeProviders((turn) => ({
		said: "ok",
		answer: {sum: 5},
		hang: turn.prompt.includes("hang"),
	}));
	return Agent.makeAgents({
		adapters: fakes,
		sessions: Agent.memorySessions(),
		reaper: Agent.noReaper,
	});
};

const pct = (xs: readonly number[], p: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return Number((s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0).toFixed(3));
};

// ---------------------------------------------------------------- order

type Case = "now" | "numbered" | "late_now" | "late_numbered";
const CASES: readonly Case[] = ["now", "numbered", "late_now", "late_numbered"];

/**
 * One trial. `now` and `numbered`: a turn that hangs, its cancel, and a second prompt, all told
 * at once; meant: turn 1 cancelled, turn 2 runs. `late_*`: a quick turn and a turn that hangs; a
 * cancel meant for the quick one is read only after it ended, as a stop key pressed during turn 1
 * reaches a busy program late; meant: nothing cancelled, turn 2 goes on.
 * The answer is what the turns ended in, 300 ms after the last tell.
 */
const trial = (provider: Provider, c: Case) =>
	Effect.gen(function* () {
		const agents = fakeWorld();
		const ended = ear<{readonly turn: number; readonly stop: string}>();
		const started = yield* start(
			PROGRAMS[provider],
			flags("/work/copy"),
			{ended: ended.hear},
			{id: `order:${provider}`, storage: memoryStorage()},
		).pipe(Effect.provideService(Agent.Agents, agents));
		if (started.kind !== "running") return "refused";
		const run = started.run;
		const cancel = c === "now" || c === "late_now" ? "now" : 1;
		const [first, second] = c === "now" || c === "numbered" ? ["hang", "quick"] : ["quick", "hang"];
		yield* tell(run, "prompt", first).pipe(Effect.orDie);
		if (c === "now" || c === "numbered") yield* tell(run, "cancel", cancel).pipe(Effect.orDie);
		yield* tell(run, "prompt", second).pipe(Effect.orDie);
		if (c === "late_now" || c === "late_numbered") {
			yield* ended.upTo(1);
			yield* tell(run, "cancel", cancel).pipe(Effect.orDie);
		}
		yield* Effect.sleep(Duration.millis(300));
		const seen = ended.values.map((e) => `${e.turn}:${e.stop}`).join(" ");
		yield* started.stop;
		return seen === "" ? "nothing ended" : seen;
	}).pipe(Effect.scoped);

const order = (n: number) =>
	Effect.gen(function* () {
		const out: Record<string, Record<string, number>> = {};
		for (const provider of PROVIDERS)
			for (const c of CASES) {
				const counts: Record<string, number> = {};
				for (let i = 0; i < n; i++) {
					const got = yield* trial(provider, c);
					counts[got] = (counts[got] ?? 0) + 1;
				}
				out[`${provider} ${c}`] = counts;
				console.log(provider, c, counts);
			}
		save("order", {
			n,
			meant: {
				now: "1:cancelled 2:end_turn",
				numbered: "1:cancelled 2:end_turn",
				late_now: "1:end_turn (2 hangs)",
				late_numbered: "1:end_turn (2 hangs)",
			},
			out,
		});
	});

// ---------------------------------------------------------------- cost

const RUN: DraftRun = {
	key: "k",
	id: "k/1",
	prompt: "add",
	session: {id: "s", continues: false},
	agent: null,
	folder: null,
};

const cost = (n: number) =>
	Effect.gen(function* () {
		const out: Record<string, {readonly p50: number; readonly p95: number}> = {};
		for (const provider of PROVIDERS) {
			const ways: Record<string, (i: number) => Effect.Effect<unknown>> = {
				direct: (i) => {
					const agents = fakeWorld();
					return Stream.runDrain(
						agents.run({
							provider,
							session: `s${i}`,
							folder: "/work/copy",
							prompt: "add",
							system: {_tag: "append", text: ""},
							answer: Answer,
							model: null,
							effort: null,
							limits: Agent.NO_LIMITS,
						}),
					).pipe(Effect.orDie);
				},
				program: (i) =>
					call(PROGRAMS[provider], flags("/work/copy", {session: `s${i}`, schema: summed.schema}), {
						told: {prompt: ["add"]},
						keeping: {id: `p${i}`, storage: memoryStorage()},
					}).pipe(Effect.provideService(Agent.Agents, fakeWorld())),
				child: (i) => {
					const runner = programRunner({
						name: "sum",
						program: PROGRAMS[provider],
						agents: fakeWorld(),
						flags: () => flags("/work/copy", {session: `s${i}`, schema: summed.schema}),
						keeping: () => ({id: `c${i}`, storage: memoryStorage()}),
					});
					return Stream.runDrain(runner(RUN).pipe(Stream.map(summed.decode)));
				},
			};
			for (const [way, once] of Object.entries(ways)) {
				for (let i = 0; i < 20; i++) yield* once(-i - 1); // warm up
				const ms: number[] = [];
				for (let i = 0; i < n; i++) {
					const t0 = performance.now();
					yield* once(i);
					ms.push(performance.now() - t0);
				}
				out[`${provider} ${way}`] = {p50: pct(ms, 50), p95: pct(ms, 95)};
				console.log(provider, way, out[`${provider} ${way}`]);
			}
		}
		save("cost", {
			n,
			ms: out,
			note: "fake providers, memory storage, one process; a turn that ends at once",
		});
	});

// ---------------------------------------------------------------- live

const LIVE: Record<Provider, Partial<AgentFlags>> = {
	claude: {model: "haiku", effort: "low", usd: 0.1, seconds: 120},
	codex: {model: "gpt-6-luna", effort: "low", seconds: 120},
};
const PROMPT = "What is 2 + 3? Use no tool. Answer with the JSON object only.";

const live = Effect.gen(function* () {
	const sessionsDir = realpathSync(mkdtempSync(join(tmpdir(), "exp169-sessions-")));
	const agents = Agent.makeAgents({
		adapters: {claude: claudeAdapter(), codex: yield* codexAdapter({codex: CODEX})},
		sessions: yield* Agent.fileSessions(sessionsDir),
		reaper: psReaper,
	});
	const out: Record<string, unknown> = {};
	for (const provider of PROVIDERS) {
		const folder = realpathSync(mkdtempSync(join(tmpdir(), `exp169-${provider}-`)));
		const session = `exp169/${provider}/${Date.now()}`;
		const t0 = performance.now();
		const called = yield* call(
			PROGRAMS[provider],
			flags(folder, {session, schema: summed.schema, ...LIVE[provider]}),
			{
				told: {prompt: [PROMPT]},
				keeping: {id: `live:${provider}`, storage: memoryStorage()},
			},
		).pipe(Effect.provideService(Agent.Agents, agents));
		const ms = Math.round(performance.now() - t0);
		const heard =
			called.kind === "called" ? called.heard.map((h) => ({name: h.name, value: h.value})) : called;
		// The stage's side: the plain answer, decoded by the stage's own schema.
		const end = called.kind === "called" ? called.heard.find((h) => h.name === "ended") : undefined;
		const read = Schema.decodeUnknownResult(Answer)(
			end?.name === "ended" ? end.value.answer : null,
		);
		const decoded = Result.isSuccess(read) ? read.success : `misfit: ${read.failure.message}`;
		out[provider] = {ms, settings: LIVE[provider], heard, decoded};
		console.log(provider, ms, JSON.stringify(heard), JSON.stringify(decoded));
		rmSync(folder, {recursive: true, force: true});
		if (provider === "codex")
			rmSync(codexHomeOf(`session:${session}`, process.env), {recursive: true, force: true});
	}
	rmSync(sessionsDir, {recursive: true, force: true});
	save("live", {when: new Date().toISOString().slice(0, 10), prompt: PROMPT, out});
}).pipe(Effect.scoped, Effect.provide(nodeServices));

// ---------------------------------------------------------------- main

const [step = "report", arg] = process.argv.slice(2);
const n = Number(arg ?? (step === "order" ? 50 : 300));
const main =
	step === "order"
		? order(n)
		: step === "cost"
			? cost(n)
			: step === "live"
				? live
				: Effect.sync(() => console.log(JSON.stringify(saved(), null, 2)));
await Effect.runPromise(main as Effect.Effect<void>);
