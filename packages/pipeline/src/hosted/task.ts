// One task of a plan, built on tea-host (experiment 105): the task machine (../stages/task/) under
// a name its lane gives it (`lane:<n>:t1:r1:build`). The same three places for the work as a
// hosted build (./build.ts):
//
//   read    the plan's book from the ledger, and where the plan's branch and main stand
//   build   the child `<name>:agent` makes its own copy of the branch at the base, runs the
//           builder in it, and answers with the builder's form and the change as a patch, a
//           ledger row: a takeover after it pays for no second run
//   push    on whichever host holds the stage now: a copy made again from the remote at the base,
//           the patch applied, and one commit with a fixed author and date, so every host makes
//           the same commit. Keyed (./idempotency.ts), from the base only, never forced

import type {Ledger, Self} from "@kampus/fabrika";
import {Effect, Exit, FileSystem, Option, type Path, Schema, Stream} from "effect";
import type {ChildProcessSpawner} from "effect/process";
import {readFacts} from "../asks/ledger.ts";
import {foldLedger} from "../asks/rules.ts";
import {sessionOf} from "../combos.ts";
import type {PlanId} from "../ids.ts";
import {PlanId as PlanIdSchema, TaskId} from "../ids.ts";
import {
	type BuildBrief,
	type BuildDrafted,
	Builder,
	Built,
	type Ran,
	Settings,
} from "../stages/build/form.ts";
import {Pushed} from "../stages/build/services.ts";
import {Item} from "../stages/build/ticket.ts";
import {nameOf} from "../stages/outcome.ts";
import {noRun} from "../stages/review/reviewer.ts";
import {
	type pushTask,
	type readTask,
	type Task,
	type TaskMsg,
	type TaskRunSub,
	task,
} from "../stages/task/machine.ts";
import {taskViewOf} from "../stages/task/view.ts";
import {agentOf, askAgent, asWritten} from "./agent.ts";
import {type BuildAnswer, BuildWork, commitEnv, copyAt} from "./build.ts";
import {Idempotency} from "./idempotency.ts";
import {gitOn, Outside, type Repo} from "./outside.ts";
import {jsonJournal, type Stage} from "./stage.ts";

type Failed = {readonly _tag: "unknown"};
const failed = Effect.fail<Failed>({_tag: "unknown"});

export const TaskJob = Schema.Struct({
	plan: PlanIdSchema,
	task: TaskId,
	round: Schema.Finite,
	open: Schema.Array(Item),
	settings: Settings,
	/** The child's dollar cap. */
	usd: Schema.Finite,
	/** The commit's date, in seconds: one commit, the same on every host. */
	at: Schema.Finite,
});
export type TaskJob = typeof TaskJob.Type;

/** The repository a plan's tickets are in: `o/r#7` is `o/r`. */
export const repoOfPlan = (plan: PlanId): Repo => {
	const [owner = "", rest = ""] = plan.split("/");
	return {owner, name: rest.slice(0, rest.indexOf("#"))};
};

/** The stage's one ask to its child, per round. */
const askId = (job: TaskJob) => `task/${job.plan}/${job.task}/r${job.round}`;

const ranOf = (d: BuildDrafted): Ran => ({
	spend: d.spend,
	tools: d.tools,
	refused: d.refused,
	links: d.links,
});

/** How a builder run ended, as the task machine's Msg. A form that does not read is `misfit`. */
const msgOf =
	(at: {readonly task: TaskJob["task"]; readonly round: number; readonly run: number}) =>
	(d: BuildDrafted): TaskMsg => {
		const ran = ranOf(d);
		if (d.answer === "built") {
			const built = Schema.decodeUnknownOption(Built)(d.built);
			return Option.isSome(built)
				? {type: "task_built", ...at, built: built.value, ran}
				: {type: "task_failed", ...at, why: "misfit", error: null, ran};
		}
		if (d.answer === "broke")
			return {type: "task_failed", ...at, why: "broke", error: d.error, ran};
		return {type: "task_failed", ...at, why: d.answer, error: null, ran};
	};

const handlers = (o: {
	readonly name: string;
	readonly job: TaskJob;
	readonly gate: Idempotency["Service"];
	readonly outside: Outside["Service"];
	readonly work: BuildWork["Service"];
	readonly context: import("effect").Context.Context<
		Self | Ledger | FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
	>;
}) => {
	const {gate, outside, job} = o;
	const repo = repoOfPlan(job.plan);
	const tree = `${o.work.dir}/${o.name.replace(/[^a-zA-Z0-9._-]/g, "_")}/tree`;
	const ask = (brief: BuildBrief | null, settings: Settings | null) =>
		askAgent(
			agentOf(o.name),
			askId(job),
			brief === null ? null : {brief, settings},
			asWritten<BuildAnswer>(),
		);
	const read = (cmd: ReturnType<typeof readTask>) =>
		Effect.gen(function* () {
			const state = foldLedger(yield* readFacts);
			const view = taskViewOf(state, cmd.plan, cmd.task, {
				branch: yield* outside.branchHead(repo, planBranch(cmd.plan)),
				main: yield* outside.branchHead(repo, "main"),
			});
			return view;
		}).pipe(Effect.provideContext(o.context));
	const push = (cmd: ReturnType<typeof pushTask>) =>
		Effect.gen(function* () {
			const git = yield* gitOn(o.work.env);
			const commitGit = yield* gitOn(commitEnv(o.work.env, job.at));
			const asked = yield* ask(null, null);
			if (asked.how !== "answered" || asked.answer.base !== cmd.base) return yield* failed;
			const {patch} = asked.answer;
			if (patch === "") return {head: cmd.base, changed: false};
			const remote = outside.remote(repo);
			yield* copyAt(git, remote, tree, cmd.base);
			const fs = yield* FileSystem.FileSystem;
			const file = `${tree}/.git/fabrika.patch`;
			yield* fs
				.writeFileString(file, patch)
				.pipe(Effect.mapError((): Failed => ({_tag: "unknown"})));
			yield* git.ok(["-C", tree, "apply", "--index", "--binary", file]);
			const subject = `${cmd.branch}@${cmd.base}`;
			const key = `${o.name}#push:${subject}`;
			yield* commitGit.ok([
				"-C",
				tree,
				"commit",
				"--no-verify",
				"-q",
				"-m",
				`${cmd.message}\n\nFabrika-Key: ${key}`,
			]);
			const sha = (yield* git.ok(["-C", tree, "rev-parse", "HEAD"])).trim();
			const pushed: Pushed = {head: sha, changed: true};
			return yield* gate.once({
				op: "push",
				subject,
				answer: Pushed,
				look: () =>
					outside
						.branchHead(repo, cmd.branch)
						.pipe(Effect.map((now) => (now === sha ? Option.some(pushed) : Option.none()))),
				send: (k) =>
					Effect.gen(function* () {
						// Compare-and-set: only from where the round read the branch.
						const now = yield* outside.branchHead(repo, cmd.branch);
						if (now === sha) return pushed;
						const fromMain = (yield* outside.branchHead(repo, "main")) === cmd.base;
						if (!(now === cmd.base || (now === null && fromMain))) return yield* failed;
						yield* outside.push(k, {repo, tree, branch: cmd.branch, sha});
						return pushed;
					}),
			});
		}).pipe(Effect.provideContext(o.context));
	const builder = Builder.of({
		build: (brief, settings) =>
			ask(brief, settings).pipe(
				Effect.map(
					(asked): BuildDrafted =>
						asked.how === "answered" ? asked.answer.drafted : {answer: "over_budget", ...noRun},
				),
				Effect.provideContext(o.context),
			),
	});
	return {
		interpret: {task_read: read, task_push: push},
		subscribe: {
			task_run: (sub: TaskRunSub) =>
				Stream.fromEffect(builder.build(sub.deps.brief, sub.deps.settings)).pipe(
					Stream.map(msgOf({task: sub.deps.task, round: sub.deps.round, run: sub.deps.run})),
				),
		},
	};
};

const planBranch = (plan: PlanId) => `plan/${plan.slice(plan.indexOf("#") + 1)}`;

const decodeJob = Schema.decodeUnknownExit(Schema.fromJsonString(TaskJob));
const jobOf = (self: Self["Service"]) =>
	self.reads.readStream(self.inbox).pipe(
		Effect.orElseSucceed(() => []),
		Effect.flatMap((rows) => {
			const row = rows.find((r) => r.id === "job");
			const job = row === undefined ? null : decodeJob(row.data);
			return job !== null && Exit.isSuccess(job)
				? Effect.succeed(job.value)
				: Effect.die("a task stage booted with no job");
		}),
	);

export const hostedTask: Stage<
	Task,
	TaskMsg,
	TaskJob,
	| BuildWork
	| Outside
	| Idempotency
	| Self
	| Ledger
	| FileSystem.FileSystem
	| Path.Path
	| ChildProcessSpawner.ChildProcessSpawner
> = {
	kind: "task",
	job: TaskJob,
	boot: (self) =>
		Effect.gen(function* () {
			const context = yield* Effect.context<
				Self | Ledger | FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
			>();
			const job = yield* jobOf(self);
			const h = handlers({
				name: self.name,
				job,
				gate: yield* Idempotency,
				outside: yield* Outside,
				work: yield* BuildWork,
				context,
			});
			return yield* self.run(
				task,
				{schema: jsonJournal<Task>(), cursor: () => 0},
				{
					ctx: undefined,
					interpret: h.interpret,
					subscribe: h.subscribe,
					terminal: (s: Task) => s.phase === "over",
				},
			);
		}),
	over: (s) => s.phase === "over",
	idle: (s) => s.phase === "idle",
	start: (job, name) => ({
		type: "start",
		ask: {plan: job.plan, task: job.task, round: job.round, open: job.open},
		settings: job.settings,
		session: sessionOf(`task ${name} ${job.at}`),
	}),
	resume: {type: "resume"},
	finish: (end) =>
		Effect.succeed(
			end.phase !== "over"
				? null
				: {
						name: nameOf(end.outcome),
						outcome: end.outcome,
						head: end.report.head,
						changed: end.report.changed,
						runs: end.report.runs,
					},
		),
	agent: (job) => ({usd: job.usd}),
};
