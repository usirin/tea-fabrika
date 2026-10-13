import {join} from "node:path";
import type {Options, SDKMessage} from "@anthropic-ai/claude-agent-sdk";
import type {Sub} from "@demlik/tea";
import {Effect, Schedule, Stream} from "effect";
import {type RepliesDeps, Thread} from "./combos.ts";
import {type DraftRun, sdkRunner} from "./draft.ts";
import {Fabrika, type Shell, Worktrees} from "./fabrika.ts";
import {
	type AtDeps,
	defaultKnobs,
	type Knobs,
	type Operator,
	type OperatorMsg,
} from "./operator.ts";
import {guardHook} from "./shell-guard.ts";
import {preloadOf, shellPrompt} from "./shell-skill.ts";
import {shipReadInterpret, shipSubscribe, shipWriteInterpret} from "./stages/ship/handlers.ts";
import type {ChecksSub, QueueSub} from "./stages/ship/machine.ts";
import {
	type BriefCmd,
	type ClaimCmd,
	type ClearCmd,
	type DispatchedCmd,
	type finishLane,
	type PostCmd,
	type PrCmd,
	parkAsk,
	type RecordCmd,
	type releaseLane,
	type removeTree,
	shellDraft,
	type TreeCmd,
	type UnparkCmd,
	type ViewCmd,
} from "./turn.ts";

// What the operator machine runs on: the handlers for its Cmds, the runners
// for its Subs, and the rows a finished run adds to field/runs.jsonl. The
// machine itself (src/operator.ts) never touches any of this.

const withFabrika = <A, E>(use: (fabrika: Fabrika["Service"]) => Effect.Effect<A, E>) =>
	Effect.gen(function* () {
		return yield* use(yield* Fabrika);
	});

/** The Cmds' handlers: fabrika's through `Fabrika`, the question through the `Thread`, the reply's reading through `Jev`. */
export const operatorInterpret = (jevModel: string) => ({
	lane_claim: (c: ClaimCmd) => withFabrika((f) => f.claim({lane: c.lane, intent: c.intent})),
	lane_view: (c: ViewCmd) => withFabrika((f) => f.view(c.lane)),
	lane_brief: (c: BriefCmd) => withFabrika((f) => f.brief({lane: c.lane, task: c.task})),
	lane_pr: (c: PrCmd) => withFabrika((f) => f.pr({lane: c.lane, task: c.task, pr: c.pr})),
	lane_dispatched: (c: DispatchedCmd) =>
		withFabrika((f) =>
			Effect.as(f.dispatched({lane: c.lane, task: c.task, shell: c.shell, intent: c.intent}), null),
		),
	lane_record: (c: RecordCmd) =>
		withFabrika((f) =>
			f.record({lane: c.lane, task: c.task, fact: c.fact, pr: c.pr, intent: c.intent}),
		),
	lane_unpark: (c: UnparkCmd) =>
		withFabrika((f) => f.unpark({lane: c.lane, task: c.task, intent: c.intent})),
	lane_clear: (c: ClearCmd) =>
		withFabrika((f) =>
			f.clear({lane: c.lane, task: c.task, said: c.said, grant: c.grant, intent: c.intent}),
		),
	lane_finish: (c: ReturnType<typeof finishLane>) =>
		withFabrika((f) => Effect.as(f.finish({lane: c.lane, intent: c.intent}), null)),
	tree_make: (c: TreeCmd) =>
		Effect.gen(function* () {
			return yield* Effect.as((yield* Worktrees).make({name: c.name, intent: c.intent}), null);
		}),
	tree_remove: (c: ReturnType<typeof removeTree>) =>
		Effect.gen(function* () {
			return yield* Effect.as((yield* Worktrees).remove({name: c.name, intent: c.intent}), null);
		}),
	lane_release: (c: ReturnType<typeof releaseLane>) =>
		withFabrika((f) =>
			Effect.as(f.release({lane: c.lane, token: c.token, intent: c.intent}), null),
		),
	park_post: (c: PostCmd) =>
		Effect.gen(function* () {
			return yield* (yield* Thread).post({where: c.where, text: c.text, intent: c.intent});
		}),
	park_read_judge: parkAsk.judge.handle(jevModel),
});

/**
 * The handlers of an operator whose ship stage is the ship machine: its own,
 * and the child's. The child's read asks `CodeHost`; its two writes ask
 * `CodeHostWrites`.
 *
 * The child's tidy-up does nothing here, on purpose. The lane's working copy
 * is the operator's: it made it, and it removes it on every way out of a run,
 * landed or not. A child that removed it too would cover only the landing,
 * and the tree would be asked gone twice.
 */
export const operatorShipInterpret = (jevModel: string) => ({
	...operatorInterpret(jevModel),
	...shipReadInterpret,
	...shipWriteInterpret(),
});

/**
 * Read something over and over, and hand on each reading that differs from
 * the one before: a Listen over a world that cannot push. A read that fails
 * is skipped; the next one is asked on time.
 */
const poll = <A>(every: number, read: (f: Fabrika["Service"]) => Effect.Effect<A, unknown>) =>
	Stream.unwrap(
		Effect.gen(function* () {
			const f = yield* Fabrika;
			return Stream.fromEffectSchedule(
				read(f).pipe(Effect.match({onSuccess: (a): A | null => a, onFailure: () => null})),
				Schedule.spaced(every),
			).pipe(
				Stream.filter((a): a is A => a !== null),
				Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
			);
		}),
	);

/**
 * The Subs' runners, live. `shell` opens one Agent SDK query per shell run
 * ({@link shellRunner}). The PR and the merge queue are read every `pollMs`.
 */
export const operatorSubscribe = (config: {
	readonly pollMs: number;
	readonly shell: ShellConfig;
}) => ({
	shell: shellRunner(config.shell),
	pr_watch: (sub: Sub<"pr_watch", AtDeps>) =>
		poll(config.pollMs, (f) => f.pr(sub.deps)).pipe(
			Stream.map((pr): OperatorMsg => ({type: "pr_read", key: sub.deps.key, pr})),
		),
	queue: (sub: Sub<"queue", AtDeps>) =>
		poll(config.pollMs, (f) => f.queue(sub.deps)).pipe(
			Stream.map((reading): OperatorMsg => ({type: "queue_read", key: sub.deps.key, reading})),
		),
	park_replies: (sub: Sub<"park_replies", RepliesDeps>) =>
		Stream.unwrap(
			Effect.gen(function* () {
				return (yield* Thread).replies(sub.deps.thread, sub.deps.after);
			}),
		).pipe(Stream.map((reply): OperatorMsg => ({type: "park_reply", key: sub.deps.key, reply}))),
});

/**
 * The runners of the ship child's two Listens, for an operator whose ship
 * stage is the ship machine. Both only read, through `CodeHost`. What they
 * say is the child's Msg, which the operator hands on by its pull request.
 */
export const operatorShipSubscribe = {
	ship_checks: (sub: ChecksSub) =>
		shipSubscribe.ship_checks(sub).pipe(Stream.map((m) => m as OperatorMsg)),
	ship_queue: (sub: QueueSub) =>
		shipSubscribe.ship_queue(sub).pipe(Stream.map((m) => m as OperatorMsg)),
};

/** The tools the fabrika shells' own definitions name. Pre-approved, so a shell never waits on a prompt nobody will answer. */
const SHELL_TOOLS = ["Bash", "Read", "Write", "Edit", "Grep", "Glob", "Skill", "Agent"];

export interface ShellConfig {
	/** The folder the `Worktrees` Layer keeps the trees in. */
	readonly trees: string;
	/** The fabrika plugin's folder. */
	readonly plugin: string;
	/** Folders outside a shell's tree it may still write: the lane's ledger, temp. */
	readonly alsoWritable: readonly string[];
	readonly model: string;
	readonly effort: "low" | "medium" | "high";
	/** The dollars one shell may cost before the SDK stops it. */
	readonly maxShellUsd: number;
	/** For a dry run: the only tools a shell gets, in place of its definition's. */
	readonly onlyTools?: readonly string[];
	/** Hears of each tool call the Check refused. */
	readonly refused?: (run: DraftRun, tool: string, why: string) => void;
	/** Is shown every SDK message of every shell, for a log. */
	readonly seen?: (run: DraftRun, message: SDKMessage) => void;
}

/** The shell a run is, from its agent's name: `fabrika:builder` is `builder`. */
const shellOf = (run: DraftRun) => (run.agent ?? "").replace(/^[^:]*:/, "");

/** What a run's agent definition preloads, or nothing when the run names no agent. */
const preloadFor = (config: ShellConfig, run: DraftRun) =>
	run.agent === null ? null : preloadOf(config.plugin, shellOf(run));

/**
 * The Agent SDK options for a shell. It works in the tree the run made, with
 * the fabrika plugin loaded from a folder and the repo's own project
 * settings. Its tools are pre-approved and anything else is denied without a
 * prompt; the Check (src/shell-guard.ts) reads every call before it runs.
 *
 * The connectors of the signed-in account are left out. No shell's work
 * needs one, and none is pre-approved, so nothing a shell does today is lost.
 * A dry run names its whole list of tools, and the runner ends a run whose
 * list holds anything else (`extraTools`, src/draft.ts): with the connectors
 * in, a dry run would end that way whenever they were ready in time. Servers
 * the plugin or the repo names are not touched.
 */
export const shellOptions =
	(config: ShellConfig) =>
	(run: DraftRun): Options => {
		const tree = run.folder === null ? config.trees : join(config.trees, run.folder);
		const rules = {
			tree,
			alsoWritable: config.alsoWritable,
			loaded: preloadFor(config, run)?.skills ?? [],
		};
		return {
			cwd: tree,
			model: config.model,
			effort: config.effort,
			plugins: [{type: "local", path: config.plugin}],
			settingSources: ["project"],
			settings: {disableClaudeAiConnectors: true},
			permissionMode: "dontAsk",
			allowedTools: config.onlyTools === undefined ? SHELL_TOOLS : [...config.onlyTools],
			...(config.onlyTools === undefined ? {} : {tools: [...config.onlyTools]}),
			hooks: {
				PreToolUse: [{hooks: [guardHook(rules, (tool, why) => config.refused?.(run, tool, why))]}],
			},
			maxBudgetUsd: config.maxShellUsd,
		};
	};

/**
 * The shells' runner: one Agent SDK query per run, sent the shell's skill and
 * then its brief (src/shell-skill.ts), under {@link shellOptions}.
 */
export const shellRunner = (config: ShellConfig) =>
	sdkRunner(shellDraft, shellOptions(config), {
		prompt: (run) => {
			const preload = preloadFor(config, run);
			return preload === null ? run.prompt : shellPrompt(preload, run.prompt);
		},
		...(config.seen === undefined ? {} : {seen: config.seen}),
	});

// ---------------------------------------------------------------- a run's settings

const positive = (name: string, raw: string | undefined, fallback: number): number => {
	if (raw === undefined || raw.trim() === "") return fallback;
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0)
		throw new Error(`${name} must be a number above zero, and it is "${raw}"`);
	return n;
};

/**
 * The numbers a run is started with, from its environment, over the defaults:
 *
 *   WHO=<login>,<login>   whose replies answer a question the machine asks
 *                         (`OWNER=<login>` is the same list with one name)
 *   ASK_WAIT_MIN          how long a question waits before the run ends parked
 *   RECHECK_MIN           how long between two tries of a park's recipe, also
 *                         while its question is open; the question quotes it
 *   CI_WAIT_MIN           how long checks may take before a review
 *   MAX_RUN_USD           what the run's shells may cost in all
 *
 * A run with nobody on its list could ask and never hear the answer, so that
 * is refused here, before anything is claimed. A login is kept in lower case:
 * GitHub's are not case-sensitive.
 */
export function knobsOf(env: Readonly<Record<string, string | undefined>>): Knobs {
	const names = (env.WHO ?? env.OWNER ?? "").split(/[\s,]+/).filter((w) => w !== "");
	const who = [...new Set(names.map((w) => w.replace(/^@/, "").toLowerCase()))];
	if (who.length === 0)
		throw new Error(
			"WHO is not set: name the logins whose replies answer a question, as WHO=<login>,<login>",
		);
	const minutes = (name: string, fallback: number) =>
		positive(name, env[name], fallback / 60_000) * 60_000;
	return {
		...defaultKnobs,
		who,
		maxRunUsd: positive("MAX_RUN_USD", env.MAX_RUN_USD, defaultKnobs.maxRunUsd),
		ciWaitMs: minutes("CI_WAIT_MIN", defaultKnobs.ciWaitMs),
		askWaitMs: minutes("ASK_WAIT_MIN", defaultKnobs.askWaitMs),
		recheckMs: minutes("RECHECK_MIN", defaultKnobs.recheckMs),
	};
}

// ---------------------------------------------------------------- the field log

/** A row of `field/runs.jsonl`. */
export interface RunRow {
	readonly date: string;
	readonly lane: string;
	readonly role: "machine" | "builder" | "reviewer" | "shipper";
	readonly model: string | null;
	readonly effort: string | null;
	readonly outcome: "merged" | "pass" | "fail" | "parked" | "stopped";
	readonly why: string | null;
	readonly tokens: number;
	readonly tools: number;
	readonly minutes: number;
	readonly note: string | null;
	/** A shell's dollars; on the machine's row, the dollars of all its shells. */
	readonly costUsd: number;
	/** On a shell's row: every token billed, each turn's input counted again. `tokens` is the conversation's size at its end. */
	readonly billed?: number;
	/** On the machine's row only: its Jev calls. */
	readonly jev?: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

const ROLE: Readonly<Record<Shell, "builder" | "reviewer" | "shipper">> = {
	builder: "builder",
	"ui-builder": "builder",
	"mixed-builder": "builder",
	reviewer: "reviewer",
	"ui-reviewer": "reviewer",
	shipper: "shipper",
};

/**
 * A shell's terminal word as the field log's outcome. Any other word is
 * `stopped`, with the word kept as the why. A shipper that parks the lane for
 * an owner's approval did its job, and so did one whose watch on the merge
 * queue ran out with the pull request still in it: the machine listens on.
 */
const OUTCOME: Readonly<Record<string, RunRow["outcome"]>> = {
	PASS: "pass",
	FAIL: "fail",
	"SHIPPED-PR": "pass",
	"SUCCESS-NO-PR": "pass",
	QUEUED: "pass",
	UNRESOLVED: "pass",
	MERGED: "merged",
	LANDED: "merged",
	"AWAITING-CP-APPROVAL": "parked",
};

const tenth = (n: number) => Math.round(n * 10) / 10;

/**
 * The rows a finished run adds to the field log: one for the machine, one
 * per shell it ran. `repo` is `owner/name`; `minutes` is the run's wall time,
 * which the host measures.
 */
export function fieldRows(
	s: Operator,
	at: {
		readonly date: string;
		readonly repo: string;
		readonly minutes: number;
		readonly model: string;
		readonly effort: string | null;
	},
): RunRow[] {
	if (s.phase !== "ended") return [];
	const lane = `${at.repo}#${s.lane}`;
	const shells = s.log.shells.map((r): RunRow => {
		const outcome = r.outcome === "finished" ? (OUTCOME[r.token ?? ""] ?? "stopped") : "stopped";
		return {
			date: at.date,
			lane,
			role: ROLE[r.shell],
			model: at.model,
			effort: at.effort,
			outcome,
			// A shell that ended on its own with no last word is the one the machine then records dead.
			why:
				outcome === "stopped" || outcome === "parked"
					? (r.why ?? r.token ?? (r.outcome === "finished" ? "ended with no last word" : r.outcome))
					: null,
			// The conversation's size at its end: what a subagent run reports, so the rows compare.
			tokens: r.spend.context,
			tools: r.tools,
			minutes: tenth(r.spend.minutes),
			note: null,
			costUsd: cents(r.spend.costUsd),
			billed: r.spend.tokens,
		};
	});
	// A ship stage the ship machine ran, not a shell. It is a `shipper` row with no model and no cost, and its note
	// says so, with each phase the machine stood in and how it ended, so a later reader can tell the two apart.
	const ships = (s.log.ships ?? []).map((r): RunRow => {
		const verb = r.outcome.kind;
		const outcome =
			verb === "done" ? "merged" : verb === "send" ? "fail" : verb === "ask" ? "parked" : "stopped";
		return {
			date: at.date,
			lane,
			role: "shipper",
			model: null,
			effort: null,
			outcome,
			why: verb === "done" ? null : r.name,
			tokens: 0,
			tools: 0,
			minutes: 0,
			note: `the ship machine, no agent: ${r.phases.join(" > ")}; ended ${r.name} on ${r.pr}`,
			costUsd: 0,
		};
	});
	const {end} = s;
	const machine: RunRow = {
		date: at.date,
		lane,
		role: "machine",
		model: null,
		effort: null,
		outcome:
			end.kind === "terminal"
				? end.status === "done"
					? "merged"
					: "stopped"
				: end.kind === "parked"
					? "parked"
					: "stopped",
		why:
			end.kind === "terminal"
				? end.status === "done"
					? null
					: end.status
				: end.kind === "unclaimed"
					? `${end.why}: ${end.detail}`
					: end.why,
		tokens: 0,
		tools: s.log.cmds,
		minutes: tenth(at.minutes),
		note: null,
		costUsd: cents(s.log.shells.reduce((sum, r) => sum + r.spend.costUsd, 0)),
		jev: s.log.jev,
	};
	return [machine, ...shells, ...ships];
}
