// A plan's branch kept up with main, on tea-host (experiment 105): the catch-up machine
// (../stages/catchup/) under a name its lane gives it (`lane:<n>:t1:r1:catchup`).
//
//   read     the branch and main from the remote, and in a copy: is main in the branch, and (for a
//            drop) which of the task's commits are not reverted yet
//   try      the merge in a copy, thrown away: the files in conflict
//   resolve  the child `<name>:agent` makes its own copy, merges, and runs a builder on the
//            conflicts that are not the lockfile; it answers each file's text. A ledger row, so a
//            takeover after it pays for no second run
//   push     on whichever host holds the stage now: the merge made again from the same two
//            commits, the resolved files put in, the lockfile made again by pnpm, one commit with a
//            fixed author and date. Keyed, from where the branch stood, never forced

import type {Ledger, Self} from "@kampus/fabrika";
import {Effect, Exit, FileSystem, Option, type Path, Schema, Stream} from "effect";
import type {ChildProcessSpawner} from "effect/process";
import {runLow} from "../child.ts";
import {sessionOf} from "../combos.ts";
import {criterionId, PlanId, type PlanId as PlanIdType, TaskId} from "../ids.ts";
import {type BuildDrafted, Builder, Settings} from "../stages/build/form.ts";
import {Pushed} from "../stages/build/services.ts";
import {
	branchOfPlan,
	type CatchupAsk,
	type CatchupMsg,
	type Catchup as CatchupState,
	catchup,
	LOCKFILE,
	type pushCatchup,
	type Resolved,
	type ResolveSub,
	type readCatchup,
	type tryMerge,
} from "../stages/catchup/machine.ts";
import {nameOf} from "../stages/outcome.ts";
import {type AgentAsk, agentOf, askAgent, asWritten, type Turn} from "./agent.ts";
import {BuildWork, commitEnv, copyAt} from "./build.ts";
import {Idempotency} from "./idempotency.ts";
import {type Git, gitOn, Outside} from "./outside.ts";
import {jsonJournal, type Stage} from "./stage.ts";
import {repoOfPlan} from "./task.ts";

type Failed = {readonly _tag: "unknown"};
const failed = Effect.fail<Failed>({_tag: "unknown"});

export const CatchupJob = Schema.Struct({
	plan: PlanId,
	drop: Schema.NullOr(TaskId),
	settings: Settings,
	/** The resolver child's dollar cap. */
	usd: Schema.Finite,
	/** The commit's date, in seconds: one merge commit, the same on every host. */
	at: Schema.Finite,
});
export type CatchupJob = typeof CatchupJob.Type;

/** What the resolver child answers: each conflicted file's merged text, and how its run went. */
export interface ResolveAnswer {
	readonly drafted: BuildDrafted;
	readonly files: readonly Resolved[];
}

const ResolveAsk = Schema.Struct({
	plan: PlanId,
	base: Schema.String,
	main: Schema.String,
	conflicts: Schema.Array(Schema.String),
	settings: Settings,
});
type ResolveAsk = typeof ResolveAsk.Type;
const readResolveAsk = Schema.decodeUnknownExit(ResolveAsk);

const askIdOf = (a: {readonly plan: PlanIdType; readonly base: string; readonly main: string}) =>
	`catchup/${a.plan}/${a.base}/${a.main}`;

const MARKERS = /^(?:<{7}|>{7}|={7})(?: |$)/m;

/** The files git left unmerged in the copy. */
const unmerged = (git: Git, tree: string) =>
	git
		.ok(["-C", tree, "diff", "--name-only", "--diff-filter=U"])
		.pipe(Effect.map((out) => out.split("\n").filter((p) => p !== "")));

/** In the copy at `base`: merge `main` in, and leave the result for the caller. True: it merged clean. */
const mergeIn = (git: Git, tree: string, main: string) =>
	git
		.git(["-C", tree, "merge", "--no-commit", "--no-ff", "-q", main])
		.pipe(Effect.map((ran) => ran.code === 0));

/** The resolver's brief: the conflicts, as one task a builder can do in the copy. */
const resolveBrief = (ask: ResolveAsk, tree: string, name: string) => ({
	ticket: `https://github.com/${ask.plan.slice(0, ask.plan.indexOf("#"))}/issues/${ask.plan.slice(ask.plan.indexOf("#") + 1)}`,
	number: Number(ask.plan.slice(ask.plan.indexOf("#") + 1)),
	title: `Resolve the merge of main into ${branchOfPlan(ask.plan)}`,
	body: [
		`Main was merged into ${branchOfPlan(ask.plan)} in this copy, and these files were left in conflict:`,
		"",
		...ask.conflicts.map((p) => `- ${p}`),
		"",
		`Edit only those files. Keep what each side meant. Leave no conflict marker. Do not touch ${LOCKFILE}: code makes it again.`,
	].join("\n"),
	criteria: [
		{
			id: criterionId("c1"),
			version: 1,
			text: "When someone opens each conflicted file, no conflict marker is left, and both sides' changes are still there",
			checked: false,
			evidence: null,
		},
	] as const,
	round: 1,
	open: [],
	rules: [],
	tree,
	branch: branchOfPlan(ask.plan),
	session: sessionOf(`resolve ${name} ${ask.base} ${ask.main}`),
});

/**
 * The child's turn: a copy of its own, the merge made in it, the real `Builder` (live or scripted)
 * run on the conflicts, and each conflicted file's text as it left it.
 */
export const resolveTurn =
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
			const read = readResolveAsk(ask.brief);
			if (Exit.isFailure(read))
				return yield* Effect.die(`a resolve ask that does not read: ${ask.id}`);
			const a = read.value;
			const work = yield* BuildWork;
			const outside = yield* Outside;
			const fs = yield* FileSystem.FileSystem;
			const git = yield* gitOn(work.env);
			const tree = `${work.dir}/${at.name.replace(/[^a-zA-Z0-9._-]/g, "_")}/tree`;
			yield* copyAt(git, outside.remote(repoOfPlan(a.plan)), tree, a.base);
			yield* mergeIn(git, tree, a.main);
			const drafted = yield* (yield* Builder).build(resolveBrief(a, tree, at.name), a.settings);
			const files = yield* Effect.forEach(
				a.conflicts,
				(path) =>
					fs.readFileString(`${tree}/${path}`).pipe(
						Effect.map((text): Resolved => ({path, text})),
						Effect.orElseSucceed((): Resolved | null => null),
					),
				{concurrency: 1},
			);
			yield* git.git(["-C", tree, "merge", "--abort"]);
			const answer: ResolveAnswer = {
				drafted,
				files: files.filter((f): f is Resolved => f !== null),
			};
			return {answer, cost: {usd: drafted.spend.costUsd, tokens: drafted.spend.tokens}, agent};
		}).pipe(Effect.orDie);

const handlers = (o: {
	readonly name: string;
	readonly job: CatchupJob;
	readonly gate: Idempotency["Service"];
	readonly outside: Outside["Service"];
	readonly work: BuildWork["Service"];
	readonly git: Git;
	readonly commitGit: Git;
	readonly context: import("effect").Context.Context<
		Self | Ledger | FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
	>;
}) => {
	const {gate, outside, git, job} = o;
	const repo = repoOfPlan(job.plan);
	const remote = outside.remote(repo);
	const branch = branchOfPlan(job.plan);
	const tree = `${o.work.dir}/${o.name.replace(/[^a-zA-Z0-9._-]/g, "_")}/tree`;

	const read = (cmd: ReturnType<typeof readCatchup>) =>
		Effect.gen(function* () {
			const head = yield* outside.branchHead(repo, branch);
			const main = yield* outside.branchHead(repo, "main");
			if (main === null) return yield* failed;
			if (head === null) return {branch: null, main, merged: true, drops: []};
			yield* copyAt(git, remote, tree, head);
			const merged =
				(yield* git.git(["-C", tree, "merge-base", "--is-ancestor", main, head])).code === 0;
			const drops = cmd.drop === null ? [] : yield* dropsOf(cmd, head, main);
			return {branch: head, main, merged, drops};
		}).pipe(Effect.provideContext(o.context));

	/** The task's commits on the branch, newest first, that no revert on the branch names yet. */
	const dropsOf = (ask: CatchupAsk, head: string, main: string) =>
		Effect.gen(function* () {
			const log = yield* git.ok([
				"-C",
				tree,
				"log",
				"--no-merges",
				"--format=%H%x1f%s%x1f%b%x1e",
				`${main}..${head}`,
			]);
			const commits = log
				.split("\x1e")
				.map((c) => c.trim())
				.filter((c) => c !== "")
				.map((c) => {
					const [sha = "", subject = "", body = ""] = c.split("\x1f");
					return {sha, subject, body};
				});
			const reverted = new Set(
				commits.flatMap((c) =>
					[...c.body.matchAll(/This reverts commit ([0-9a-f]{40})/g)].map((m) => m[1]),
				),
			);
			return commits
				.filter((c) => c.subject.startsWith(`${ask.drop}: `) && !reverted.has(c.sha))
				.map((c) => c.sha);
		});

	const tryIt = (cmd: ReturnType<typeof tryMerge>) =>
		Effect.gen(function* () {
			yield* copyAt(git, remote, tree, cmd.base);
			const clean = yield* mergeIn(git, tree, cmd.main);
			const left = clean ? [] : yield* unmerged(git, tree);
			yield* git.git(["-C", tree, "merge", "--abort"]);
			return {conflicts: left.filter((p) => p !== LOCKFILE), lockfile: left.includes(LOCKFILE)};
		}).pipe(Effect.provideContext(o.context));

	type PushErr = {readonly _tag: "unknown" | "unresolved" | "lockfile_failed"};
	const refuse = (tag: PushErr["_tag"]) => Effect.fail<PushErr>({_tag: tag});

	const push = (cmd: ReturnType<typeof pushCatchup>) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* copyAt(git, remote, tree, cmd.base);
			if (cmd.main === null) {
				for (const sha of cmd.reverts) {
					const ran = yield* o.commitGit.git(["-C", tree, "revert", "--no-edit", sha]);
					if (ran.code !== 0) {
						yield* git.git(["-C", tree, "revert", "--abort"]);
						return yield* refuse("unresolved");
					}
				}
			} else {
				yield* mergeIn(git, tree, cmd.main);
				for (const f of cmd.resolved) {
					if (MARKERS.test(f.text)) return yield* refuse("unresolved");
					yield* fs
						.writeFileString(`${tree}/${f.path}`, f.text)
						.pipe(Effect.mapError((): PushErr => ({_tag: "unknown"})));
					yield* git.ok(["-C", tree, "add", "--", f.path]);
				}
				if (cmd.lockfile) {
					// Main's lockfile, then made again from the merged manifests: never merged by hand.
					yield* git.ok(["-C", tree, "checkout", "--theirs", "--", LOCKFILE]);
					const made = yield* runLow(
						"pnpm",
						["install", "--lockfile-only", "--offline", "--ignore-scripts"],
						{cwd: tree, env: o.work.env},
					).pipe(Effect.mapError((): PushErr => ({_tag: "lockfile_failed"})));
					if (made.code !== 0) return yield* refuse("lockfile_failed");
					yield* git.ok(["-C", tree, "add", "--", LOCKFILE]);
				}
				if ((yield* unmerged(git, tree)).length > 0) return yield* refuse("unresolved");
				const key = `${o.name}#push:${branch}@${cmd.base}`;
				yield* o.commitGit.ok([
					"-C",
					tree,
					"commit",
					"--no-verify",
					"-q",
					"-m",
					`${cmd.message}\n\nFabrika-Key: ${key}`,
				]);
			}
			const sha = (yield* git.ok(["-C", tree, "rev-parse", "HEAD"])).trim();
			const pushed: Pushed = {head: sha, changed: sha !== cmd.base};
			if (!pushed.changed) return pushed;
			return yield* gate.once({
				op: "push",
				subject: `${branch}@${cmd.base}`,
				answer: Pushed,
				look: () =>
					outside
						.branchHead(repo, branch)
						.pipe(Effect.map((now) => (now === sha ? Option.some(pushed) : Option.none()))),
				send: (k) =>
					Effect.gen(function* () {
						// Compare-and-set: only from where the catch-up read the branch.
						const now = yield* outside.branchHead(repo, branch);
						if (now === sha) return pushed;
						if (now !== cmd.base) return yield* failed;
						yield* outside.push(k, {repo, tree, branch, sha});
						return pushed;
					}),
			});
		}).pipe(
			Effect.mapError((e): PushErr => ("_tag" in e ? (e as PushErr) : {_tag: "unknown"})),
			Effect.provideContext(o.context),
		);

	const resolve = (sub: ResolveSub) =>
		Stream.fromEffect(
			askAgent(
				agentOf(o.name),
				askIdOf(sub.deps),
				{...sub.deps, settings: job.settings},
				asWritten<ResolveAnswer>(),
			).pipe(
				Effect.map((asked): CatchupMsg => {
					const at = {base: sub.deps.base, main: sub.deps.main};
					if (asked.how !== "answered")
						return {
							type: "catchup_unresolved",
							...at,
							why: "the resolver reached its limit",
							ran: null,
						};
					const d = asked.answer.drafted;
					const ran = {spend: d.spend, tools: d.tools, refused: d.refused, links: d.links};
					return d.answer === "built"
						? {type: "catchup_resolved", ...at, files: asked.answer.files, ran}
						: {
								type: "catchup_unresolved",
								...at,
								why: d.answer === "broke" ? d.error : d.answer,
								ran,
							};
				}),
				Effect.provideContext(o.context),
			),
		);

	return {
		interpret: {catchup_read: read, catchup_try: tryIt, catchup_push: push},
		subscribe: {catchup_resolve: resolve},
	};
};

const decodeJob = Schema.decodeUnknownExit(Schema.fromJsonString(CatchupJob));
const jobOf = (self: Self["Service"]) =>
	self.reads.readStream(self.inbox).pipe(
		Effect.orElseSucceed(() => []),
		Effect.flatMap((rows) => {
			const row = rows.find((r) => r.id === "job");
			const job = row === undefined ? null : decodeJob(row.data);
			return job !== null && Exit.isSuccess(job)
				? Effect.succeed(job.value)
				: Effect.die("a catch-up stage booted with no job");
		}),
	);

export const hostedCatchup: Stage<
	CatchupState,
	CatchupMsg,
	CatchupJob,
	| BuildWork
	| Outside
	| Idempotency
	| Self
	| Ledger
	| FileSystem.FileSystem
	| Path.Path
	| ChildProcessSpawner.ChildProcessSpawner
> = {
	kind: "catchup",
	job: CatchupJob,
	boot: (self) =>
		Effect.gen(function* () {
			const work = yield* BuildWork;
			const context = yield* Effect.context<
				Self | Ledger | FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
			>();
			const job = yield* jobOf(self);
			const h = handlers({
				name: self.name,
				job,
				gate: yield* Idempotency,
				outside: yield* Outside,
				work,
				git: yield* gitOn(work.env),
				commitGit: yield* gitOn(commitEnv(work.env, job.at)),
				context,
			});
			return yield* self.run(
				catchup,
				{schema: jsonJournal<CatchupState>(), cursor: () => 0},
				{
					ctx: undefined,
					interpret: h.interpret,
					subscribe: h.subscribe,
					terminal: (s: CatchupState) => s.phase === "over",
				},
			);
		}),
	over: (s) => s.phase === "over",
	idle: (s) => s.phase === "idle",
	start: (job) => ({type: "start", ask: {plan: job.plan, drop: job.drop}}),
	resume: {type: "resume"},
	finish: (end) =>
		Effect.succeed(
			end.phase !== "over"
				? null
				: {
						name: nameOf(end.outcome),
						outcome: end.outcome,
						problems: end.problems,
						spend: end.spend,
					},
		),
	agent: (job) => ({usd: job.usd}),
};
