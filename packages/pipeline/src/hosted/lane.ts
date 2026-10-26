// A plan's lane on tea-host (experiment 105): the lane machine (../stages/lane/) under `lane:<n>`.
// It runs no agent: its work is its children, each a hosted stage under a name made from the
// lane's counts (`lane:700:t2:r1:build`). Before it starts one, it writes the child's name in
// `<lane>/children`, under its fence: that row is how a host learns to serve the child (./children.ts).
//
//   read    the facts, folded; the branch and main; whether main is in the branch; the pull request
//   start   the children row, `startChild`, and the job in the child's inbox under the id `job`. A child
//           that has its outcome row already is not started again
//   wait    the child's outcome row (a Sub that reads it until it is there); the owner's answer
//   note    one `reviewed` fact per child the stall rule counts, under an id made of its name
//   planned the plan child's draft as the plan's next version (ids kept where the words were),
//           under an id made of the child's name
//   open    the pull request and the last review's verdict on it, each through the gate, once

import {Ledger, Self, streams} from "@kampus/fabrika";
import {
	Duration,
	Effect,
	Exit,
	type FileSystem,
	Option,
	type Path,
	Schedule,
	Schema,
	Stream,
} from "effect";
import type {ChildProcessSpawner} from "effect/process";
import {readFacts, sendFact, steady} from "../asks/ledger.ts";
import {bookOf, foldLedger, latestOf, openAsks} from "../asks/rules.ts";
import {standingAt} from "../criteria/book.ts";
import {type PlanId, ticketOf} from "../ids.ts";
import {branchOfPlan} from "../stages/catchup/machine.ts";
import {
	ChildEnd,
	type Lane,
	type LaneJob,
	LaneJob as LaneJobSchema,
	type LaneMsg,
	type LaneSub,
	lane,
	type notePlan,
	type noteRound,
	type openPr,
	type readLane,
	type startChild,
} from "../stages/lane/machine.ts";
import {laneViewOf} from "../stages/lane/view.ts";
import {commentOf} from "../stages/operate/writes.ts";
import {nameOf} from "../stages/outcome.ts";
import {keptFrom} from "../stages/plan/ids.ts";
import {PlanDraft, revisionOfDraft} from "../stages/plan/plan.ts";
import {BuildWork, copyAt} from "./build.ts";
import {childrenOf} from "./children.ts";
import {Idempotency} from "./idempotency.ts";
import {gitOn, Outside} from "./outside.ts";
import {jsonJournal, readOutcome, type Stage} from "./stage.ts";
import {repoOfPlan} from "./task.ts";

type Failed = {readonly _tag: "unknown"};
type PlanFailed = Failed | {readonly _tag: "no_plan"};
const failed = Effect.fail<Failed>({_tag: "unknown"});

const EVERY = Schedule.spaced(Duration.millis(150));
const decodeEnd = Schema.decodeUnknownExit(ChildEnd);
const decodeDraft = Schema.decodeUnknownExit(Schema.Struct({draft: PlanDraft}));

type Needs =
	| Self
	| Ledger
	| BuildWork
	| FileSystem.FileSystem
	| Path.Path
	| ChildProcessSpawner.ChildProcessSpawner;

const handlers = (o: {
	readonly name: string;
	readonly job: LaneJob;
	readonly gate: Idempotency["Service"];
	readonly outside: Outside["Service"];
	readonly context: import("effect").Context.Context<Needs>;
}) => {
	const {gate, outside, job} = o;
	const repo = repoOfPlan(job.plan);
	const branch = branchOfPlan(job.plan);

	const read = (cmd: ReturnType<typeof readLane>) =>
		Effect.gen(function* () {
			const state = foldLedger(yield* readFacts);
			const head = yield* outside.branchHead(repo, branch);
			const main = yield* outside.branchHead(repo, "main");
			if (main === null) return yield* failed;
			let behind = false;
			if (head !== null) {
				const work = yield* BuildWork;
				const git = yield* gitOn(work.env);
				const tree = `${work.dir}/${o.name.replace(/[^a-zA-Z0-9._-]/g, "_")}/tree`;
				yield* copyAt(git, outside.remote(repo), tree, head);
				behind =
					(yield* git.git(["-C", tree, "merge-base", "--is-ancestor", main, head])).code !== 0;
			}
			const open = yield* outside.prFrom(repo, branch);
			const known = cmd.pr ?? open;
			const landing = known === null ? null : yield* outside.landing(known, head ?? "");
			const pr =
				known === null || landing === null
					? null
					: landing.at === "merged"
						? {url: known, state: "merged" as const, head: landing.commit}
						: open === null
							? null
							: {url: open, state: "open" as const, head: head ?? ""};
			return laneViewOf(state, cmd.plan, {head, behind, pr});
		}).pipe(Effect.provideContext(o.context));

	const start = (cmd: ReturnType<typeof startChild>) =>
		Effect.gen(function* () {
			const self = yield* Self;
			const ledger = yield* Ledger;
			if ((yield* readOutcome(cmd.child).pipe(Effect.orElseSucceed(() => null))) !== null)
				return {started: false};
			yield* steady(
				"note a child",
				ledger.append(
					childrenOf(self.name),
					"any",
					{kind: "child", writer: self.holder, id: cmd.child, data: {child: cmd.child}},
					self.fence,
				),
			).pipe(Effect.mapError((): Failed => ({_tag: "unknown"})));
			const started = yield* self.startChild(
				cmd.child,
				null,
				cmd.usd === null ? undefined : {usd: cmd.usd},
			);
			if (started.how !== "ok") return yield* failed;
			const sent = yield* self.send(streams(cmd.child).inbox, "job", cmd.job);
			if (sent.how !== "sent") return yield* failed;
			return {started: started.started};
		}).pipe(Effect.provideContext(o.context));

	const note = (cmd: ReturnType<typeof noteRound>) =>
		Effect.gen(function* () {
			const self = yield* Self;
			yield* sendFact(
				{type: "reviewed", plan: cmd.plan, task: cmd.task, open: cmd.open},
				{
					id: `${cmd.child}/reviewed`,
					by: self.name,
					hold: {name: self.name, fence: self.fence},
				},
			).pipe(Effect.mapError((): Failed => ({_tag: "unknown"})));
			return {};
		}).pipe(Effect.provideContext(o.context));

	const planned = (cmd: ReturnType<typeof notePlan>) =>
		Effect.gen(function* () {
			const self = yield* Self;
			const row = yield* readOutcome(cmd.child).pipe(Effect.orElseSucceed(() => null));
			const draft = decodeDraft(row?.outcome);
			const data = Exit.isSuccess(draft) ? revisionOfDraft(draft.value.draft) : null;
			if (data === null) return yield* Effect.fail<PlanFailed>({_tag: "no_plan"});
			const last = latestOf(foldLedger(yield* readFacts), cmd.plan);
			yield* sendFact(
				{
					type: "planned",
					plan: cmd.plan,
					// The first version covers the ticket the plan is named by.
					tickets: last === null ? [ticketOf(cmd.plan), ...cmd.folds] : cmd.folds,
					data: last === null ? data : keptFrom(last.data, data),
					problems: [],
				},
				{id: `${cmd.child}/planned`, by: self.name, hold: {name: self.name, fence: self.fence}},
			);
			return {};
		}).pipe(
			Effect.mapError((e): PlanFailed => (e._tag === "no_plan" ? e : {_tag: "unknown"})),
			Effect.provideContext(o.context),
		);

	const open = (cmd: ReturnType<typeof openPr>) =>
		Effect.gen(function* () {
			const url = yield* gate.once({
				op: "open",
				subject: branch,
				answer: Schema.String,
				look: () =>
					outside
						.prFrom(repo, branch)
						.pipe(Effect.map((u) => (u === null ? Option.none() : Option.some(u)))),
				send: (k) => outside.open(k, {repo, branch, title: cmd.title, body: cmd.body}),
			});
			const book = bookOf(foldLedger(yield* readFacts), cmd.plan);
			const rows = book === null ? [] : standingAt(book, cmd.head);
			const verdict = {
				pr: url,
				head: cmd.head,
				kind: "review-code" as const,
				verdict: "pass" as const,
				reason: "every criterion of the plan passed at this head",
				text: rows.map((r) => `- ${r.id} v${r.version} (${r.task}): ${r.state}`).join("\n"),
			};
			yield* gate.once({
				op: "comment",
				subject: `${url}@${cmd.head}`,
				answer: Schema.Null,
				look: (key) =>
					outside
						.hasComment(url, key)
						.pipe(Effect.map((there) => (there ? Option.some(null) : Option.none()))),
				send: (key) => outside.comment(key, url, commentOf(verdict)).pipe(Effect.as(null)),
			});
			return {url};
		}).pipe(
			Effect.mapError((): Failed => ({_tag: "unknown"})),
			Effect.provideContext(o.context),
		);

	const child = (sub: Extract<LaneSub, {type: "lane_child"}>) =>
		Stream.fromEffect(
			readOutcome(sub.deps.child).pipe(
				Effect.orElseSucceed(() => null),
				Effect.repeat({until: (r) => r !== null, schedule: EVERY}),
				Effect.map((r): LaneMsg => {
					const end = decodeEnd(r?.outcome);
					return Exit.isSuccess(end)
						? {type: "child_over", child: sub.deps.child, end: end.value}
						: {
								type: "child_over",
								child: sub.deps.child,
								end: {outcome: {kind: "stuck", why: "no_outcome"}},
							};
				}),
				Effect.provideContext(o.context),
			),
		);

	const ownerOf = (plan: PlanId) =>
		Effect.map(readFacts, (entries) =>
			openAsks(foldLedger(entries))
				.filter((a) => "plan" in a && a.plan === plan)
				.map((a) => a.id),
		);
	const owner = (sub: Extract<LaneSub, {type: "lane_owner"}>) =>
		Stream.fromEffect(
			ownerOf(sub.deps.plan).pipe(
				Effect.repeat({
					until: (now) =>
						now.length !== sub.deps.asks.length || now.some((id) => !sub.deps.asks.includes(id)),
					schedule: EVERY,
				}),
				Effect.as<LaneMsg>({type: "owner_moved"}),
				Effect.provideContext(o.context),
			),
		);

	return {
		interpret: {
			lane_read: read,
			lane_start: start,
			lane_note: note,
			lane_open: open,
			lane_planned: planned,
		},
		subscribe: {lane_child: child, lane_owner: owner},
	};
};

const decodeJob = Schema.decodeUnknownExit(Schema.fromJsonString(LaneJobSchema));
const jobOf = (self: Self["Service"]) =>
	self.reads.readStream(self.inbox).pipe(
		Effect.orElseSucceed(() => []),
		Effect.flatMap((rows) => {
			const row = rows.find((r) => r.id === "job");
			const job = row === undefined ? null : decodeJob(row.data);
			return job !== null && Exit.isSuccess(job)
				? Effect.succeed(job.value)
				: Effect.die("a lane booted with no job");
		}),
	);

export const hostedLane: Stage<Lane, LaneMsg, LaneJob, Outside | Idempotency | Needs> = {
	kind: "lane",
	job: LaneJobSchema,
	boot: (self) =>
		Effect.gen(function* () {
			// Its children's ends come as EXITs: read, never fatal. The outcome rows say how each ended.
			yield* self.trapExit(true);
			const context = yield* Effect.context<Needs>();
			const job = yield* jobOf(self);
			const h = handlers({
				name: self.name,
				job,
				gate: yield* Idempotency,
				outside: yield* Outside,
				context,
			});
			return yield* self.run(
				lane,
				{schema: jsonJournal<Lane>(), cursor: () => 0},
				{
					ctx: undefined,
					interpret: h.interpret,
					subscribe: h.subscribe,
					terminal: (s: Lane) => s.phase === "over",
				},
			);
		}),
	over: (s) => s.phase === "over",
	idle: (s) => s.phase === "idle",
	start: (job, name) => ({type: "start", lane: name, job}),
	resume: {type: "resume"},
	finish: (end) =>
		Effect.succeed(
			end.phase !== "over"
				? null
				: {name: nameOf(end.outcome), outcome: end.outcome, report: end.report},
		),
	agent: null,
};

/** A plan's lane's name: one per plan, so two hosts that start one hold one lease. */
export const laneOf = (plan: PlanId) => `lane:${plan.slice(plan.indexOf("#") + 1)}`;
