// Build on tea-host (experiment 104): the build machine, unchanged, under `build:<n>:r<round>`.
//
// What changes is where the work lives. A host may die between any two steps, and the next holder
// may be another machine with no working copy, so no step keeps anything only on disk:
//
//   copy    reads where the branch stands (the round's base) and names a folder. It makes nothing.
//   build   the child `build:<n>:r<round>:agent` makes its own copy at the base, runs the builder
//           in it, and answers with the builder's form and the change as a binary patch. The
//           answer is a ledger row, so a takeover after it pays for no second run.
//   push    on whichever host holds the stage now: a copy made again from the remote at the base
//           (the ledger's), the patch applied, and one commit with the job's author and date. The
//           same base, patch, message and date make the same commit on every host, so a holder
//           that finds the branch already at that commit (a push made just before a kill) does
//           not push again. The push itself is keyed (./idempotency.ts), checks the branch is
//           still at the base first, and is never forced.
//   open    keyed too: a pull request already open from the branch is the one, and none is opened.
import {Context, Effect, Exit, FileSystem, Option, Path, Schema} from "effect";
import type {ChildProcessSpawner} from "effect/process";
import type {Self} from "../../host/host.ts";
import type {Ledger} from "../../host/ledger.ts";
import {runLow} from "../child.ts";
import {sessionOf} from "../combos.ts";
import {runEnv} from "../env.ts";
import {bodyText, messageText} from "../stages/build/body.ts";
import {BuildBrief, type BuildDrafted, Builder, Settings} from "../stages/build/form.ts";
import {buildReadInterpret, buildSubscribe} from "../stages/build/handlers.ts";
import {
	type Build,
	type BuildMsg,
	build,
	type copyTree,
	type openPr,
	type pushBranch,
} from "../stages/build/machine.ts";
import {type BuildHost, type Copied, Pushed} from "../stages/build/services.ts";
import {branchOf, ticketOf} from "../stages/build/ticket.ts";
import {nameOf} from "../stages/outcome.ts";
import {noRun} from "../stages/review/reviewer.ts";
import {type AgentAsk, agentOf, askAgent, asWritten, type Turn} from "./agent.ts";
import {Idempotency} from "./idempotency.ts";
import {branchHeadAt, type Git, gitOn, Outside, type Repo} from "./outside.ts";
import {jsonJournal, type Stage} from "./stage.ts";

type Failed = {readonly _tag: "unknown"};
const failed = Effect.fail<Failed>({_tag: "unknown"});

/** Where this host keeps its copies, and the environment git runs under. */
export class BuildWork extends Context.Service<
	BuildWork,
	{
		readonly dir: string;
		readonly env: Readonly<Record<string, string>>;
		/** Install the copy's packages before the builder runs in it (a real builder runs checks). */
		readonly install: boolean;
	}
>()("@kampus/fabrika/pipeline/BuildWork") {}

export const BuildJob = Schema.Struct({
	ticket: Schema.String,
	number: Schema.Finite,
	round: Schema.Finite,
	settings: Settings,
	usd: Schema.Finite,
	/** The commit's date, in seconds: one commit, the same on every host. */
	at: Schema.Finite,
});
export type BuildJob = typeof BuildJob.Type;

/** What the child answers: the builder's form, and the change against `base`. */
export interface BuildAnswer {
	readonly drafted: BuildDrafted;
	readonly patch: string;
	readonly base: string;
}

/** The stage's one ask to its child, per round. */
const askId = (brief: {readonly ticket: string; readonly round: number}) =>
	`build/${brief.ticket}/r${brief.round}`;

const repoOf = (ticket: string): Effect.Effect<Repo, Failed> => {
	const at = ticketOf(ticket);
	return at === null ? failed : Effect.succeed({owner: at.owner, name: at.name});
};

/** The commit's author and date: fixed, so every host makes the same commit. */
export const commitEnv = (env: Readonly<Record<string, string>>, at: number) => ({
	...env,
	GIT_AUTHOR_NAME: "fabrika",
	GIT_AUTHOR_EMAIL: "fabrika@users.noreply.github.com",
	GIT_AUTHOR_DATE: `${at} +0000`,
	GIT_COMMITTER_NAME: "fabrika",
	GIT_COMMITTER_EMAIL: "fabrika@users.noreply.github.com",
	GIT_COMMITTER_DATE: `${at} +0000`,
});

/** Where `branch` starts this round: its own commit on the remote, or main's when it is new. */
const baseOf = (git: Git, remote: string, branch: string) =>
	Effect.gen(function* () {
		const own = yield* branchHeadAt(git, remote, branch);
		if (own !== null) return own;
		const main = yield* branchHeadAt(git, remote, "main");
		return main === null ? yield* failed : main;
	});

/** A copy at `tree` standing at `base`, clean: made from the remote when it is not there. */
export const copyAt = (git: Git, remote: string, tree: string, base: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		if (!(yield* fs.exists(path.join(tree, ".git")).pipe(Effect.orElseSucceed(() => false)))) {
			yield* fs
				.makeDirectory(path.dirname(tree), {recursive: true})
				.pipe(Effect.mapError((): Failed => ({_tag: "unknown"})));
			yield* git.okLow(["clone", "-q", "--no-checkout", remote, tree]);
		}
		yield* git.okLow(["-C", tree, "fetch", "-q", remote, "+refs/heads/*:refs/remotes/origin/*"]);
		yield* git.ok(["-C", tree, "checkout", "-q", "--detach", "-f", base]);
		yield* git.ok(["-C", tree, "reset", "-q", "--hard", base]);
		yield* git.ok(["-C", tree, "clean", "-qfd"]);
	});

/** The copy's packages, installed once, with no login in reach: a real builder runs the checks. */
const installIn = (tree: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		if (yield* fs.exists(`${tree}/node_modules`).pipe(Effect.orElseSucceed(() => false))) return;
		const done = yield* runLow("pnpm", ["install", "--frozen-lockfile"], {
			cwd: tree,
			env: runEnv(),
		});
		if (done.code !== 0) return yield* failed;
	});

/** The `BuildWrites` of one hosted round: copy names, push makes the commit again, both writes keyed. */
const hostedBuildWrites = (o: {
	readonly name: string;
	readonly job: BuildJob;
	readonly gate: Idempotency["Service"];
	readonly outside: Outside["Service"];
	readonly work: BuildWork["Service"];
	readonly git: Git;
	readonly commitGit: Git;
	readonly context: Context.Context<Self | Ledger | FileSystem.FileSystem | Path.Path>;
}) => {
	const {gate, outside, git} = o;
	const tree = `${o.work.dir}/${o.name.replace(/[^a-zA-Z0-9._-]/g, "_")}/tree`;
	const copy = (ticket: string, number: number): Effect.Effect<Copied, Failed> =>
		Effect.gen(function* () {
			const repo = yield* repoOf(ticket);
			const branch = branchOf(number);
			const base = yield* baseOf(git, outside.remote(repo), branch);
			return {tree, branch, base};
		});
	const push = (ticket: string, copied: Copied, message: string) =>
		Effect.gen(function* () {
			const repo = yield* repoOf(ticket);
			const remote = outside.remote(repo);
			const asked = yield* askAgent(
				agentOf(o.name),
				askId({ticket, round: o.job.round}),
				null,
				asWritten<BuildAnswer>(),
			);
			if (asked.how !== "answered" || asked.answer.base !== copied.base) return yield* failed;
			const {patch} = asked.answer;
			if (patch === "") return {head: copied.base, changed: false};
			// The copy, made again here from the remote: this host may never have had one.
			yield* copyAt(git, remote, tree, copied.base);
			const fs = yield* FileSystem.FileSystem;
			const file = `${tree}/.git/fabrika.patch`;
			yield* fs
				.writeFileString(file, patch)
				.pipe(Effect.mapError((): Failed => ({_tag: "unknown"})));
			yield* git.ok(["-C", tree, "apply", "--index", "--binary", file]);
			const key = `${o.name}#push:${copied.branch}@${copied.base}`;
			yield* o.commitGit.ok([
				"-C",
				tree,
				"commit",
				"--no-verify",
				"-q",
				"-m",
				`${message}\n\nFabrika-Key: ${key}`,
			]);
			const sha = (yield* git.ok(["-C", tree, "rev-parse", "HEAD"])).trim();
			const pushed: Pushed = {head: sha, changed: true};
			return yield* gate.once({
				op: "push",
				subject: `${copied.branch}@${copied.base}`,
				answer: Pushed,
				look: () =>
					outside
						.branchHead(repo, copied.branch)
						.pipe(Effect.map((now) => (now === sha ? Option.some(pushed) : Option.none()))),
				send: (k) =>
					Effect.gen(function* () {
						// Compare-and-set: only from where the ledger says the branch stood.
						const now = yield* outside.branchHead(repo, copied.branch);
						if (now === sha) return pushed;
						const fromMain = (yield* outside.branchHead(repo, "main")) === copied.base;
						if (!(now === copied.base || (now === null && fromMain))) return yield* failed;
						yield* outside.push(k, {repo, tree, branch: copied.branch, sha});
						return pushed;
					}),
			});
		}).pipe(Effect.provideContext(o.context));
	const open = (ticket: string, number: number, title: string, body: string) =>
		Effect.gen(function* () {
			const repo = yield* repoOf(ticket);
			const branch = branchOf(number);
			return yield* gate.once({
				op: "open",
				subject: branch,
				answer: Schema.String,
				look: () =>
					outside
						.prFrom(repo, branch)
						.pipe(Effect.map((url) => (url === null ? Option.none() : Option.some(url)))),
				send: (k) => outside.open(k, {repo, branch, title, body}),
			});
		});
	return {
		build_copy: (cmd: ReturnType<typeof copyTree>) => copy(cmd.ticket, cmd.number),
		build_push: (cmd: ReturnType<typeof pushBranch>) =>
			push(cmd.ticket, cmd.copied, messageText(cmd.message)),
		build_open: (cmd: ReturnType<typeof openPr>) =>
			open(cmd.ticket, cmd.number, cmd.title, bodyText(cmd.body)),
	};
};

/** The stage's `Builder`: one ask per round to its child. */
const childBuilder = (child: string, context: Context.Context<Self | Ledger>) =>
	Builder.of({
		build: (brief, settings) =>
			askAgent(child, askId(brief), {brief, settings}, asWritten<BuildAnswer>()).pipe(
				Effect.map(
					(asked): BuildDrafted =>
						asked.how === "answered" ? asked.answer.drafted : {answer: "over_budget", ...noRun},
				),
				Effect.provideContext(context),
			),
	});

const BuildAskBody = Schema.Struct({brief: BuildBrief, settings: Settings});
const readAsk = Schema.decodeUnknownExit(BuildAskBody);

/**
 * The child's turn: a copy of its own at the base, the real `Builder` (live or scripted) run in
 * it, and the change it made, as a patch.
 */
export const buildTurn =
	(agent: Turn["agent"]) =>
	(
		ask: AgentAsk,
		at: {readonly name: string},
	): Effect.Effect<
		Turn,
		never,
		| Builder
		| BuildWork
		| Outside
		| FileSystem.FileSystem
		| Path.Path
		| ChildProcessSpawner.ChildProcessSpawner
	> =>
		Effect.gen(function* () {
			const read = readAsk(ask.brief);
			if (Exit.isFailure(read))
				return yield* Effect.die(`a build ask that does not read: ${ask.id}`);
			// The brief names the stage's folder: the child works in its own.
			const {brief} = read.value;
			const work = yield* BuildWork;
			const outside = yield* Outside;
			const git = yield* gitOn(work.env);
			const repo = yield* repoOf(brief.ticket);
			const remote = outside.remote(repo);
			const base = yield* baseOf(git, remote, brief.branch);
			const tree = `${work.dir}/${at.name.replace(/[^a-zA-Z0-9._-]/g, "_")}/tree`;
			yield* copyAt(git, remote, tree, base);
			if (work.install) yield* installIn(tree);
			const drafted = yield* (yield* Builder).build({...brief, tree}, read.value.settings);
			yield* git.ok(["-C", tree, "add", "-A"]);
			const patch = yield* git.ok(["-C", tree, "diff", "--cached", "--binary", base]);
			const answer: BuildAnswer = {drafted, patch, base};
			return {
				answer,
				cost: {usd: drafted.spend.costUsd, tokens: drafted.spend.tokens},
				agent,
			};
		}).pipe(Effect.orDie);

export const hostedBuild: Stage<
	Build,
	BuildMsg,
	BuildJob,
	| BuildHost
	| BuildWork
	| Outside
	| Idempotency
	| Self
	| Ledger
	| FileSystem.FileSystem
	| Path.Path
	| ChildProcessSpawner.ChildProcessSpawner
> = {
	kind: "build",
	job: BuildJob,
	boot: (self) =>
		Effect.gen(function* () {
			const work = yield* BuildWork;
			const context = yield* Effect.context<Self | Ledger | FileSystem.FileSystem | Path.Path>();
			const job = yield* jobOf(self);
			const writes = hostedBuildWrites({
				name: self.name,
				job,
				gate: yield* Idempotency,
				outside: yield* Outside,
				work,
				git: yield* gitOn(work.env),
				commitGit: yield* gitOn(commitEnv(work.env, job.at)),
				context,
			});
			return yield* self
				.run(
					build,
					{schema: jsonJournal<Build>(), cursor: () => 0},
					{
						ctx: undefined,
						interpret: {...buildReadInterpret, ...writes},
						subscribe: buildSubscribe,
						terminal: (s: Build) => s.phase === "over",
					},
				)
				.pipe(Effect.provideService(Builder, childBuilder(agentOf(self.name), context)));
		}),
	over: (s) => s.phase === "over",
	idle: (s) => s.phase === "idle",
	start: (job, name) => ({
		type: "start",
		ask: {ticket: job.ticket, number: job.number, round: job.round, open: []},
		settings: job.settings,
		// The builder's conversation is a UUID (Claude Code refuses any other id): one per job.
		session: sessionOf(`build ${name} ${job.at}`),
	}),
	resume: {type: "resume"},
	finish: (end) =>
		Effect.succeed(
			end.phase !== "over"
				? null
				: {
						name: nameOf(end.outcome),
						outcome: end.outcome,
						pr: end.report.pr,
						head: end.report.head,
						changed: end.report.changed,
						runs: end.report.runs,
					},
		),
	agent: (job) => ({usd: job.usd}),
};

const decodeJob = Schema.decodeUnknownExit(Schema.fromJsonString(BuildJob));
/** The job, from the stage's inbox: boot runs after the stage has read it. */
const jobOf = (self: Self["Service"]) =>
	self.reads.readStream(self.inbox).pipe(
		Effect.orElseSucceed(() => []),
		Effect.flatMap((rows) => {
			const row = rows.find((r) => r.id === "job");
			const job = row === undefined ? null : decodeJob(row.data);
			return job !== null && Exit.isSuccess(job)
				? Effect.succeed(job.value)
				: Effect.die("a build stage booted with no job");
		}),
	);
