// Review on tea-host (experiment 104): the review machine, unchanged, under `review:<n>`. Its
// reviewer runs in the child `review:<n>:agent`, asked by message under an id made of the commit
// and the try's note, so a review taken over after its reviewer answered reads the answer from the
// ledger and pays for no second run. The verdict is posted as one comment, keyed, once.

import type {Ledger, Self} from "@kampus/fabrika-old";
import {Effect, Exit, Option, Schema, Stream} from "effect";
import type {CodeHost} from "../services.ts";
import {commentOf, type Verdict} from "../stages/operate/writes.ts";
import {nameOf} from "../stages/outcome.ts";
import {Brief} from "../stages/review/gate.ts";
import {reviewReadInterpret, reviewSubscribe} from "../stages/review/handlers.ts";
import {type Review, type ReviewMsg, review} from "../stages/review/machine.ts";
import {askOf} from "../stages/review/program.ts";
import {noRun, Reviewer, type Said, Settings} from "../stages/review/reviewer.ts";
import {type AgentAsk, agentOf, askAgent, asWritten, digest, type Turn} from "./agent.ts";
import {Idempotency} from "./idempotency.ts";
import {Outside} from "./outside.ts";
import {jsonJournal, type Stage} from "./stage.ts";

export const ReviewJob = Schema.Struct({
	/** The pull request, or one commit of it: `.../pull/<n>/commits/<sha>`. */
	pr: Schema.String,
	rubrics: Schema.String,
	settings: Settings,
	/** The child's dollar cap: its `limits` on the child spec. */
	usd: Schema.Finite,
});
export type ReviewJob = typeof ReviewJob.Type;

/** What the stage asks its reviewer child. */
const ReviewAsk = Schema.Struct({
	brief: Brief,
	settings: Settings,
	note: Schema.NullOr(Schema.String),
});
const readAsk = Schema.decodeUnknownExit(ReviewAsk);

/** The stage's `Reviewer`: an ask to its child, the answer replayed as the run's stream. */
export const childReviewer = (child: string) =>
	Effect.gen(function* () {
		const context = yield* Effect.context<Self | Ledger>();
		return Reviewer.of({
			review: (brief, settings, note) =>
				Stream.unwrap(
					askAgent(
						child,
						`${brief.pr}@${brief.head}/${digest(note ?? "")}`,
						{brief, settings, note},
						asWritten<readonly Said[]>(),
					).pipe(
						Effect.map((asked) =>
							asked.how === "answered"
								? Stream.fromIterable<Said>(asked.answer)
								: Stream.succeed<Said>({kind: "ended", drafted: {answer: "over_budget", ...noRun}}),
						),
						Effect.provideContext(context),
					),
				),
		});
	});

/** The child's turn: the real `Reviewer` (live or scripted) on one ask, its stream kept whole. */
export const reviewTurn =
	(agent: Turn["agent"]) =>
	(ask: AgentAsk): Effect.Effect<Turn, never, Reviewer> =>
		Effect.gen(function* () {
			const read = readAsk(ask.brief);
			if (Exit.isFailure(read))
				return yield* Effect.die(`a review ask that does not read: ${ask.id}`);
			const {brief, settings, note} = read.value;
			const said = Array.from(
				yield* (yield* Reviewer).review(brief, settings, note).pipe(Stream.runCollect),
			);
			const ended = said.find((s) => s.kind === "ended");
			const spend = ended?.kind === "ended" ? ended.drafted.spend : noRun.spend;
			return {answer: said, cost: {usd: spend.costUsd, tokens: spend.tokens}, agent};
		});

/** The verdict comment for a review that judged a head: one line of marker, then each row. */
export const verdictOf = (end: Extract<Review, {phase: "over"}>, pr: string): Verdict | null => {
	const {report, outcome} = end;
	if (report.head === null || report.rows.length === 0 || report.replay) return null;
	return {
		pr,
		head: report.head,
		kind: "review-code",
		verdict: outcome.kind === "done" ? "pass" : "fail",
		reason: nameOf(outcome),
		text: report.rows.map((r) => `- ${r.criterion} v${r.version}: ${r.grade}`).join("\n"),
	};
};

export const hostedReview: Stage<
	Review,
	ReviewMsg,
	ReviewJob,
	CodeHost | Outside | Idempotency | Self | Ledger
> = {
	kind: "review",
	job: ReviewJob,
	boot: (self) =>
		Effect.gen(function* () {
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
				.pipe(Effect.provideService(Reviewer, reviewer));
		}),
	over: (s) => s.phase === "over",
	idle: (s) => s.phase === "idle",
	start: (job) => ({type: "start", ask: askOf(job.pr, job.rubrics), settings: job.settings}),
	resume: {type: "resume"},
	finish: (end, job) =>
		Effect.gen(function* () {
			if (end.phase !== "over") return null;
			const pr = askOf(job.pr, job.rubrics).pr;
			const verdict = verdictOf(end, pr);
			if (verdict !== null) {
				const gate = yield* Idempotency;
				const outside = yield* Outside;
				yield* gate
					.once({
						op: "comment",
						subject: `${verdict.pr}@${verdict.head}`,
						answer: Schema.Null,
						look: (key) =>
							outside
								.hasComment(verdict.pr, key)
								.pipe(Effect.map((there) => (there ? Option.some(null) : Option.none()))),
						send: (key) =>
							outside.comment(key, verdict.pr, commentOf(verdict)).pipe(Effect.as(null)),
					})
					.pipe(Effect.orDie);
			}
			return {
				name: nameOf(end.outcome),
				outcome: end.outcome,
				head: end.report.head,
				rows: end.report.rows.map((r) => ({criterion: r.criterion, grade: r.grade})),
				posted: verdict === null ? null : verdict.verdict,
			};
		}),
	agent: (job) => ({usd: job.usd}),
};
