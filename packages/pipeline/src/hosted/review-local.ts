// A review with no pull request, on tea-host (experiment 105): the review machine, unchanged, on a
// plan's branch at one commit, under a name its lane gives it (`lane:<n>:t1:r1:review`, or
// `lane:<n>:final:r1:review` for the last review over the whole book). What it reads is
// `localCodeHost` (../code-host-local.ts) over a copy this host makes of the remote at that commit:
// a takeover makes the copy again, so nothing lives only on the dead host's disk.
//
//   target   one task's criteria (`<plan>/tasks/<task>`), or every live one (`<plan>/book`)
//   agent    the reviewer runs in the child `<name>:agent`, as in a hosted review (./review.ts),
//            after the turn puts the plan's reading clone at the head (`localReviewTurn`)
//   rows     one `judged` fact in the plan's ledger, under the id `<name>/judged`: a takeover that
//            writes it again writes nothing new. What it found that no criterion covers goes in
//            the book under the task, or under the plan for the last review

import {type Ledger, Self} from "@kampus/fabrika-old";
import {Context, Effect, Exit, type FileSystem, type Path, Schema} from "effect";
import type {ChildProcessSpawner} from "effect/process";
import {readFacts, sendFact} from "../asks/ledger.ts";
import {bookOf, foldLedger} from "../asks/rules.ts";
import {
	bookTarget,
	type LocalCheck,
	localCodeHost,
	taskOf,
	taskTarget,
} from "../code-host-local.ts";
import {kept} from "../criteria/record.ts";
import {Owner, PLAN, PlanId} from "../ids.ts";
import {CodeHost} from "../services.ts";
import {openItems} from "../stages/operate/stop.ts";
import {nameOf} from "../stages/outcome.ts";
import {reviewReadInterpret, reviewSubscribe} from "../stages/review/handlers.ts";
import {type Review, type ReviewMsg, review} from "../stages/review/machine.ts";
import {judgementOf} from "../stages/review/program.ts";
import {Reviewer, Settings} from "../stages/review/reviewer.ts";
import {type AgentAsk, agentOf, type Turn} from "./agent.ts";
import {BuildWork, copyAt} from "./build.ts";
import {gitOn, Outside} from "./outside.ts";
import {childReviewer, reviewTurn} from "./review.ts";
import {jsonJournal, type Stage} from "./stage.ts";
import {repoOfPlan} from "./task.ts";

/**
 * Where a live reviewer reads a plan's code: one clone per plan under the work folder, made and
 * fetched by the review's own turn (`localReviewTurn`). `null`: the target names no plan.
 */
export const readingIn = (work: string, target: string): string | null => {
	const at = taskOf(target);
	return at === null ? null : `${work}/read/${at.plan.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
};

const HeadAsk = Schema.Struct({brief: Schema.Struct({pr: Schema.String, head: Schema.String})});
const readHead = Schema.decodeUnknownExit(HeadAsk);

/**
 * The review child's turn on a plan's branch. A live reviewer reads code from a clone and fetches
 * nothing, and the head was pushed from a builder's copy, maybe on another host. So the turn first
 * puts the plan's reading clone (`readingIn`) at the head the brief names, fetched from the remote
 * on whichever host runs it; then the reviewer runs as in ./review.ts.
 */
export const localReviewTurn =
	(agent: Turn["agent"]) =>
	(ask: AgentAsk): Effect.Effect<Turn, never, LocalTurnNeeds> =>
		Effect.gen(function* () {
			const read = readHead(ask.brief);
			const brief = Exit.isSuccess(read) ? read.value.brief : null;
			const at = brief === null ? null : taskOf(brief.pr);
			const work = yield* BuildWork;
			const dir = brief === null ? null : readingIn(work.dir, brief.pr);
			if (brief !== null && at !== null && dir !== null) {
				const outside = yield* Outside;
				const git = yield* gitOn(work.env);
				// A clone that cannot be made leaves the reviewer to say it does not hold the commit.
				yield* copyAt(git, outside.remote(repoOfPlan(at.plan)), dir, brief.head).pipe(
					Effect.ignore,
				);
			}
			return yield* reviewTurn(agent)(ask);
		});

type LocalTurnNeeds =
	| Reviewer
	| BuildWork
	| Outside
	| FileSystem.FileSystem
	| Path.Path
	| ChildProcessSpawner.ChildProcessSpawner;

/** The checks a local review runs at the head, in the copy's root. At least one. */
export class LocalChecks extends Context.Service<
	LocalChecks,
	readonly [LocalCheck, ...LocalCheck[]]
>()("@kampus/fabrika-old/pipeline/LocalChecks") {}

export const LocalReviewJob = Schema.Struct({
	plan: PlanId,
	/** A task, or `plan`: the whole book. */
	task: Owner,
	/** The commit to review: the plan's branch where the lane read it. */
	head: Schema.String,
	rubrics: Schema.String,
	settings: Settings,
	usd: Schema.Finite,
});
export type LocalReviewJob = typeof LocalReviewJob.Type;

/** What the review stage's target is for a job. */
export const targetOf = (job: Pick<LocalReviewJob, "plan" | "task">) =>
	job.task === PLAN ? bookTarget(job.plan) : taskTarget(job.plan, job.task);

const decodeJob = Schema.decodeUnknownExit(Schema.fromJsonString(LocalReviewJob));
const jobOf = (self: Self["Service"]) =>
	self.reads.readStream(self.inbox).pipe(
		Effect.orElseSucceed(() => []),
		Effect.flatMap((rows) => {
			const row = rows.find((r) => r.id === "job");
			const job = row === undefined ? null : decodeJob(row.data);
			return job !== null && Exit.isSuccess(job)
				? Effect.succeed(job.value)
				: Effect.die("a review stage booted with no job");
		}),
	);

/** The round's rows and findings, in the plan's book, once: the id is the stage's own. */
const keepJudged = (end: Extract<Review, {phase: "over"}>, job: LocalReviewJob) =>
	Effect.gen(function* () {
		const judgement = judgementOf(end.report, targetOf(job));
		if (judgement === null) return false;
		const book = bookOf(foldLedger(yield* readFacts), job.plan);
		if (book === null) return false;
		const self = yield* Self;
		yield* sendFact(
			{
				type: "judged",
				plan: job.plan,
				task: job.task,
				head: judgement.head,
				proof: judgement.proof,
				rows: kept(book, judgement),
				found: judgement.found,
			},
			{id: `${self.name}/judged`, by: self.name, hold: {name: self.name, fence: self.fence}},
		).pipe(Effect.catchTag("Fenced", () => Effect.die("a review lost its lease as it ended")));
		return true;
	});

export const hostedLocalReview: Stage<
	Review,
	ReviewMsg,
	LocalReviewJob,
	| BuildWork
	| LocalChecks
	| Outside
	| Self
	| Ledger
	| FileSystem.FileSystem
	| Path.Path
	| ChildProcessSpawner.ChildProcessSpawner
> = {
	kind: "review",
	job: LocalReviewJob,
	boot: (self) =>
		Effect.gen(function* () {
			const job = yield* jobOf(self);
			const work = yield* BuildWork;
			const outside = yield* Outside;
			const git = yield* gitOn(work.env);
			const tree = `${work.dir}/${self.name.replace(/[^a-zA-Z0-9._-]/g, "_")}/tree`;
			yield* copyAt(git, outside.remote(repoOfPlan(job.plan)), tree, job.head).pipe(Effect.orDie);
			const host = yield* Effect.provide(
				Effect.gen(function* () {
					return yield* CodeHost;
				}),
				localCodeHost({repo: tree, base: "origin/main", checks: yield* LocalChecks}).layer,
			);
			const reviewer = yield* childReviewer(agentOf(self.name));
			return yield* self
				.run(
					review,
					{schema: jsonJournal<Review>(), cursor: () => 0},
					{
						ctx: undefined,
						interpret: {
							...reviewReadInterpret,
							review_file_note: () => Effect.succeed("kept" as const),
						},
						subscribe: reviewSubscribe,
						terminal: (s: Review) => s.phase === "over",
					},
				)
				.pipe(Effect.provideService(Reviewer, reviewer), Effect.provideService(CodeHost, host));
		}),
	over: (s) => s.phase === "over",
	idle: (s) => s.phase === "idle",
	start: (job) => ({
		type: "start",
		ask: {pr: targetOf(job), head: null, rubrics: job.rubrics},
		settings: job.settings,
	}),
	resume: {type: "resume"},
	finish: (end, job) =>
		Effect.gen(function* () {
			if (end.phase !== "over") return null;
			const judged = yield* keepJudged(end, job);
			return {
				name: nameOf(end.outcome),
				outcome: end.outcome,
				head: end.report.head,
				rows: end.report.rows.map((r) => ({
					criterion: r.criterion,
					version: r.version,
					grade: r.grade,
				})),
				open: openItems({outcome: end.outcome, criteria: end.report.criteria}),
				judged,
				cost: end.report.cost,
			};
		}),
	agent: (job) => ({usd: job.usd}),
};
