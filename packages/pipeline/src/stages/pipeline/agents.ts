import type {Sub} from "@demlik/tea";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Agent} from "@kampus/fabrika-old";
import {claudeAdapter, type DraftRun, psReaper} from "@kampus/fabrika-old/agents/claude";
import {codexAdapter, codexHomeOf} from "@kampus/fabrika-old/agents/codex";
import {Context, Effect, FileSystem, Layer, Option, Result, Stream} from "effect";
import {ChildProcessSpawner} from "effect/process";
import type {AgentStep, Settings} from "../../settings.ts";
import {type BuildDrafted, Builder, type BuildBrief} from "../build/form.ts";
import {Built} from "../build/form.ts";
import {PlanDraft} from "../plan/plan.ts";
import {planDraft} from "../plan/planner.ts";
import {Planner} from "../plan/services.ts";
import type {Brief as ReviewBrief} from "../review/gate.ts";
import {type Drafted, noRun, Reviewer, type Said} from "../review/reviewer.ts";
import {Form} from "../review/sheet.ts";
import {SortReply} from "../sort/answer.ts";
import {sortDraft} from "../sort/machine.ts";
import {Sorter} from "../sort/services.ts";
import {type Brief, fenced, fill, listed} from "./briefs.ts";
import type {LaneHome} from "./work.ts";
import {LaneWork} from "./work.ts";

// The lane's agents, through our own agent interface, whichever maker runs them. A step's logic
// never names a model: it says which step it is, and `fabrika.toml` says who runs it.
//
//   [agents.build]
//   harness = "codex"
//   model = "gpt-6-astra"
//   effort = "high"
//
// Every run's prompt is its step's brief file, filled in (./briefs.ts): the machines' own first
// prompt is not used. A later try keeps the machine's prompt, which is only the Check's problems.
// The first turn of a Codex run is contained as experiments 152 and 153 say: its own home, a
// keep-list for its environment, no key, and a permission profile. A read-only step's folder is a
// copy of the code with no history, and its box refuses a write there.
//
// A last message that does not fit its schema gets one more try here, in the same conversation, for
// every step alike. A step's machine only ever hears how the second try ended: an answer, or a misfit.
//
// What a run spent is counted here (`Meter`), and the step that ran it writes it on the ticket.

/** When `fabrika.toml` says nothing. Triage stays where experiment 159 left it; see its write-up. */
const DEFAULTS: Readonly<Record<AgentStep, Picked>> = {
	triage: {harness: "claude", model: "opus", effort: "medium", usd: 2},
	plan: {harness: "codex", model: "gpt-6-astra", effort: "high", usd: 10},
	exam: {harness: "codex", model: "gpt-6-astra", effort: "high", usd: 10},
	test_writer: {harness: "codex", model: "gpt-6-astra", effort: "high", usd: 10},
	build: {harness: "codex", model: "gpt-6-astra", effort: "high", usd: 10},
	review: {harness: "codex", model: "gpt-6-astra", effort: "high", usd: 10},
};

export interface Picked {
	readonly harness: "codex" | "claude";
	readonly model: string;
	readonly effort: "low" | "medium" | "high";
	readonly usd: number;
}

/** Who runs a step: its table in `fabrika.toml`, then the default. Pure. */
export const pickedFor = (settings: Settings, step: AgentStep): Picked => ({
	...DEFAULTS[step],
	...settings.agents?.[step],
});

/** Dollars per million tokens, at API list price. A model not here has no price: never another's. */
const LIST: Readonly<Record<string, {in: number; cached: number; out: number}>> = {
	"gpt-6.1-sol": {in: 2, cached: 0.1, out: 10},
};

export interface Tokens {
	readonly input: number;
	readonly cached: number;
	readonly output: number;
}

/** A run at list price. `null`: this model's price is not known. Pure. */
export const listUsdOf = (model: string, t: Tokens): number | null => {
	const rate = LIST[model];
	if (rate === undefined) return null;
	return (
		(rate.in * Math.max(0, t.input - t.cached) + rate.cached * t.cached + rate.out * t.output) /
		1_000_000
	);
};

/** What the agents of one step have spent so far. */
export interface Spent extends Tokens {
	readonly turns: number;
	/** What the maker says it billed. `null`: it says nothing, as on a flat plan. */
	readonly usd: number | null;
	/** How many last messages did not fit their schema, each followed by one more try. */
	readonly misfits: number;
}

const NOTHING: Spent = {input: 0, cached: 0, output: 0, turns: 0, usd: null, misfits: 0};

/** What the step now running told the agents: the brief, its slots, who runs it and where. */
export interface StepNow {
	readonly picked: Picked;
	readonly brief: Brief;
	readonly slots: Readonly<Record<string, string>>;
	/** The folder its agent works in. */
	readonly folder: string;
	/** Whether the agent may change that folder. Only the builder's is ever kept. */
	readonly access: "read" | "write";
}

/**
 * The one lane this run holds: which step is on, and what it spent. Made fresh with the run, and
 * told again when an Act is sent again after a kill. A kill loses the count of turns already spent
 * in the step it cut.
 */
export class LaneNow extends Context.Service<
	LaneNow,
	{
		readonly set: (now: StepNow) => Effect.Effect<void>;
		readonly get: Effect.Effect<StepNow>;
		readonly spend: (
			spent: Omit<Spent, "usd" | "misfits"> & {readonly usd: number},
		) => Effect.Effect<void>;
		/** A last message did not fit. */
		readonly misfit: Effect.Effect<void>;
		/** What was spent since the last call. */
		readonly take: Effect.Effect<Spent>;
		/** The exam files the builder may not touch, for the step on now. */
		readonly exam: {
			readonly set: (files: readonly string[]) => Effect.Effect<void>;
			readonly get: Effect.Effect<readonly string[]>;
		};
	}
>()("LaneNow") {}

export const laneNow = Layer.sync(LaneNow, () => {
	let now: StepNow | null = null;
	let spent = NOTHING;
	let exam: readonly string[] = [];
	return {
		set: (next) =>
			Effect.sync(() => {
				now = next;
			}),
		get: Effect.suspend(() =>
			now === null ? Effect.die("an agent ran with no step on") : Effect.succeed(now),
		),
		spend: (s) =>
			Effect.sync(() => {
				spent = {
					input: spent.input + s.input,
					cached: spent.cached + s.cached,
					output: spent.output + s.output,
					turns: spent.turns + s.turns,
					usd: (spent.usd ?? 0) + s.usd,
					misfits: spent.misfits,
				};
			}),
		misfit: Effect.sync(() => {
			spent = {...spent, misfits: spent.misfits + 1};
		}),
		take: Effect.sync(() => {
			const was = spent;
			spent = NOTHING;
			return was;
		}),
		exam: {
			set: (files) =>
				Effect.sync(() => {
					exam = files;
				}),
			get: Effect.sync(() => exam),
		},
	};
});

/** The adapters a lane's agents run through. */
export class LaneAgents extends Context.Service<
	LaneAgents,
	{readonly agents: Effect.Effect<typeof Agent.Agents.Service>}
>()("LaneAgents") {}

const READ_ONLY_CLAUDE = {
	disallowedTools: ["Bash", "Edit", "Write", "NotebookEdit", "WebFetch", "WebSearch"],
};

/** The makers on this machine. Built at the first agent's start, so a lane that never reaches one needs neither. */
export const laneAgents: Layer.Layer<LaneAgents, never, LaneHome | LaneWork> = Layer.effect(
	LaneAgents,
	Effect.gen(function* () {
		const work = yield* LaneWork;
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const fs = yield* FileSystem.FileSystem;
		const agents = yield* Effect.cached(
			Effect.gen(function* () {
				const config = yield* work.config.pipe(Effect.orElseSucceed(() => null));
				const codex = config?.codex ?? "codex";
				const parent = process.env;
				const adapters = {
					codex: yield* codexAdapter({codex, parent, access: "write"}),
					codex_read: yield* codexAdapter({codex, parent, access: "read"}),
					claude: claudeAdapter({}),
					claude_read: claudeAdapter({more: () => READ_ONLY_CLAUDE}),
				};
				const made = Agent.makeAgents({
					adapters,
					sessions: yield* Agent.fileSessions(work.at("sessions")),
					reaper: psReaper,
				});
				// Each Codex session makes a home of its own: the lane says so before it can exist, so the
				// lane's end can take it, however the run went. A hold that cannot be written costs a folder.
				const run: typeof made.run = (turn) =>
					turn.provider.startsWith("codex")
						? Stream.unwrap(
								work
									.hold(codexHomeOf(`session:${turn.session}`, parent))
									.pipe(Effect.ignore, Effect.as(made.run(turn))),
							)
						: made.run(turn);
				return {...made, run};
			}).pipe(
				Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
				Effect.provideService(FileSystem.FileSystem, fs),
			),
		);
		return {agents};
	}),
).pipe(Layer.provide(nodeServices));

const SECONDS = 3600;

const turnOf = <A>(
	now: StepNow,
	run: {session: string; prompt: string},
	answer: Agent.Turn<A>["answer"],
): Agent.Turn<A> => ({
	provider: `${now.picked.harness}${now.access === "read" ? "_read" : ""}`,
	session: run.session,
	folder: now.folder,
	prompt: run.prompt,
	system: {_tag: "append", text: ""},
	answer,
	model: now.picked.model,
	effort: now.picked.effort,
	limits: {
		// A flat plan has no dollars to hold: Codex's adapter takes none.
		usd: now.picked.harness === "claude" ? now.picked.usd : null,
		tools: null,
		seconds: SECONDS,
	},
});

/** The first try's prompt is the brief, filled; a later one is what the machine says, the Check's problems. */
const promptFor = (now: StepNow, run: DraftRun, slot: string | null): string =>
	run.session.continues
		? run.prompt
		: fill(now.brief, slot === null ? now.slots : {...now.slots, [slot]: run.prompt});

/** A step's turn: its spend counted as it ends. */
const metered = <A, R>(
	stream: Stream.Stream<Agent.Heard<A>, Agent.AgentFailed, R>,
	spend: LaneNow["Service"]["spend"],
) =>
	stream.pipe(
		Stream.tap((heard) =>
			heard._tag === "ended"
				? spend({
						input: heard.tokens.input,
						cached: heard.tokens.cached,
						output: heard.tokens.output,
						turns: heard.requests ?? 1,
						usd: heard.usd ?? 0,
					})
				: Effect.void,
		),
	);

/** What the most of a message a second try is shown. */
const MISFIT_SHOWN = 2_000;

/** What a second try is told: the message that did not fit, in its own words. Pure. */
const misfitPrompt = (said: string): string =>
	[
		"Your last message is not the answer asked for, so code could read nothing from it. It said:",
		fenced(said.slice(0, MISFIT_SHOWN)),
		"Do not do the work again. Answer now with the whole answer, as one JSON object in the shape you were given, and nothing else.",
	].join("\n");

/**
 * A step's turn on the agents, counted as it ends, with one more try on a last message that does not
 * fit. The first try's end is never heard: only the second's, an answer or a misfit, which ends the
 * step as a misfit always has. Every step comes through here, so a machine's own limit on its tries
 * stays a limit on what its Check sent back.
 */
const tried = <A>(
	agents: typeof Agent.Agents.Service,
	lane: LaneNow["Service"],
	turn: Agent.Turn<A>,
): Stream.Stream<Agent.Heard<A>, Agent.AgentFailed> =>
	Stream.unwrap(
		Effect.sync(() => {
			let last = "";
			return metered(agents.run(turn), lane.spend).pipe(
				Stream.tap((heard) =>
					heard._tag === "said"
						? Effect.sync(() => {
								last = heard.text;
							})
						: Effect.void,
				),
				Stream.flatMap((heard) =>
					heard._tag === "ended" && heard.stop === "end_turn" && heard.answer === null
						? Stream.unwrap(
								lane.misfit.pipe(
									Effect.as(metered(agents.run({...turn, prompt: misfitPrompt(last)}), lane.spend)),
								),
							)
						: Stream.succeed(heard),
				),
			);
		}),
	);

/** A Draft's run on the agents: the same three Msgs, the same Sub. `slot`: the brief's slot its own prompt fills. */
export const draftRunner = <N extends string, O>(
	name: N,
	answer: Agent.Turn<O>["answer"],
	slot: string | null = null,
) =>
	Effect.gen(function* () {
		const lane = yield* LaneNow;
		const {agents} = yield* LaneAgents;
		const held = yield* agents;
		const now = yield* lane.get;
		const trying: typeof held = {...held, run: (turn) => tried(held, lane, turn)};
		return Agent.agentRunner(name, trying, (run) =>
			turnOf(now, {session: run.session.id, prompt: promptFor(now, run, slot)}, answer),
		);
	});

/** One whole run on the agents: `ended`, or how it failed. */
const wholeRun = <A>(turn: (now: StepNow) => Agent.Turn<A>) =>
	Effect.gen(function* () {
		const lane = yield* LaneNow;
		const {agents} = yield* LaneAgents;
		const held = yield* agents;
		const now = yield* lane.get;
		const heard = yield* tried(held, lane, turn(now)).pipe(Stream.runLast, Effect.result);
		return heard;
	});

type WholeEnd<A> =
	| {readonly kind: "answer"; readonly answer: A}
	| {readonly kind: "misfit" | "over_budget"}
	| {readonly kind: "broke"; readonly error: string};

/** How a whole run ended, in the words a Builder and a Reviewer answer in. Pure. */
const endOf = <A>(
	heard: Result.Result<Option.Option<Agent.Heard<A>>, Agent.AgentFailed>,
): WholeEnd<A> => {
	if (Result.isFailure(heard)) return {kind: "broke", error: heard.failure.message};
	if (Option.isNone(heard.success) || heard.success.value._tag !== "ended")
		return {kind: "broke", error: "the agent said nothing"};
	const ended = heard.success.value;
	if (ended.stop === "over_budget") return {kind: "over_budget"};
	if (ended.stop !== "end_turn") return {kind: "broke", error: ended.stop};
	return ended.answer === null ? {kind: "misfit"} : {kind: "answer", answer: ended.answer};
};

// ---------------------------------------------------------------- the four services

export const lanePlanner = Layer.effect(
	Planner,
	Effect.gen(function* () {
		const lane = yield* LaneNow;
		const home = yield* LaneAgents;
		return {
			run: (run, _settings) =>
				Stream.unwrap(
					draftRunner("plan", PlanDraft).pipe(
						Effect.provideService(LaneNow, lane),
						Effect.provideService(LaneAgents, home),
						Effect.map((runner) =>
							runner({id: "plan", type: "plan", deps: run} as Sub<"plan", DraftRun>),
						),
					),
				),
		};
	}),
);

export const laneSorter = Layer.effect(
	Sorter,
	Effect.gen(function* () {
		const lane = yield* LaneNow;
		const home = yield* LaneAgents;
		return {
			run: (run, _settings) =>
				Stream.unwrap(
					draftRunner("sort", SortReply, "brief").pipe(
						Effect.provideService(LaneNow, lane),
						Effect.provideService(LaneAgents, home),
						Effect.map((runner) =>
							runner({id: "sort", type: "sort", deps: run} as Sub<"sort", DraftRun>),
						),
					),
				),
		};
	}),
);

const criteriaText = (rows: readonly {readonly id: string; readonly text: string}[]) =>
	listed(rows.map((c) => `${c.id}: ${c.text}`));

export const laneBuilder = Layer.effect(
	Builder,
	Effect.gen(function* () {
		const lane = yield* LaneNow;
		const home = yield* LaneAgents;
		return {
			build: (brief: BuildBrief): Effect.Effect<BuildDrafted> =>
				wholeRun<Built>((now) =>
					turnOf(
						{...now, folder: brief.tree},
						{
							session: brief.session,
							prompt: fill(now.brief, {
								...now.slots,
								ticket: brief.ticket,
								body: fenced(`# ${brief.title}\n\n${brief.body}`, "markdown"),
								round: String(brief.round),
								branch: brief.branch,
								criteria: criteriaText(brief.criteria),
								open: listed(brief.open.map((item) => `${item.text}: ${item.says}`)),
							}),
						},
						Built,
					),
				).pipe(
					Effect.provideService(LaneNow, lane),
					Effect.provideService(LaneAgents, home),
					Effect.map((heard): BuildDrafted => {
						const end = endOf(heard);
						if (end.kind === "answer") return {answer: "built", built: end.answer, ...noRun};
						if (end.kind === "broke") return {answer: "broke", error: end.error, ...noRun};
						return {answer: end.kind, ...noRun};
					}),
				),
		};
	}),
);

export const laneReviewer = Layer.effect(
	Reviewer,
	Effect.gen(function* () {
		const lane = yield* LaneNow;
		const home = yield* LaneAgents;
		return {
			review: (brief: ReviewBrief, _settings, note: string | null): Stream.Stream<Said> =>
				Stream.fromEffect(
					wholeRun<Form>((now) =>
						turnOf(
							now,
							{
								session: `review-${brief.head}-${note === null ? 1 : 2}`,
								prompt:
									note ??
									fill(now.brief, {
										...now.slots,
										pr: brief.pr,
										head: brief.head,
										ticket: brief.ticket.id,
										criteria: criteriaText(brief.criteria),
										files: listed(brief.files.map((f) => `${f.path} (${f.kind})`)),
										deviations:
											brief.deviations === null ? "None." : JSON.stringify(brief.deviations),
										checks: brief.checks.state,
										rules: brief.rules.map((r) => `## ${r.file}\n\n${r.text}`).join("\n\n"),
										rubrics: brief.rubrics.map((r) => `## ${r.kind}\n\n${r.text}`).join("\n\n"),
										focus: "None.",
										diff: fenced(brief.diff, "diff"),
										note: "",
									}),
							},
							Form,
						),
					).pipe(
						Effect.provideService(LaneNow, lane),
						Effect.provideService(LaneAgents, home),
						Effect.map((heard): Said => {
							const end = endOf(heard);
							const drafted = ((): Drafted => {
								switch (end.kind) {
									case "answer":
										return {answer: "form", form: end.answer, ...noRun};
									case "misfit":
										return {answer: "misfit", ...noRun};
									case "over_budget":
										return {answer: "over_budget", ...noRun};
									case "broke":
										return {answer: "broke", error: end.error, ...noRun};
								}
							})();
							return {kind: "ended", drafted};
						}),
					),
				),
		};
	}),
);

export {planDraft, sortDraft};
