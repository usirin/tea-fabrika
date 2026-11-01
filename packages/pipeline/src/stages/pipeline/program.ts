import {
	defineProgram,
	flag,
	jobTraceId,
	kind,
	output,
	type RefsOf,
	type Send,
} from "@kampus/fabrika-old";
import {Clock, Effect, Exit, Schema, Stream} from "effect";
import {claim, newLane, release} from "../../asks/claims.ts";
import {readFacts, sendFact} from "../../asks/ledger.ts";
import {foldLedger} from "../../asks/rules.ts";
import {bookTarget} from "../../code-host-local.ts";
import {planOf, readTicketId, type TicketId, ticketOf} from "../../ids.ts";
import type {AgentStep} from "../../settings.ts";
import {type CodeFact, type Outcome, TicketNumber} from "../../tickets/ticket.ts";
import {Tickets} from "../../tickets/tickets.ts";
import {buildKind as buildStage, buildToTheEnd} from "../build/program.ts";
import {examChild, examToTheEnd} from "../exam/program.ts";
import {MAX_MUTANTS} from "../mutation/machine.ts";
import {mutationChild, mutationToTheEnd} from "../mutation/program.ts";
import {postsOf} from "../operate/machine.ts";
import {openItems} from "../operate/stop.ts";
import {nameOf} from "../outcome.ts";
import {revisionOfDraft} from "../plan/plan.ts";
import {planKind as planStage, planToTheEnd} from "../plan/program.ts";
import {planMarkdown} from "../plan/render.ts";
import {pushChild, pushToTheEnd} from "../push/program.ts";
import {reviewReadInterpret, reviewSubscribe} from "../review/handlers.ts";
import {Review, review} from "../review/machine.ts";
import {keepRows, type Reviewed} from "../review/program.ts";
import {shipReadInterpret, shipSubscribe, shipWriteInterpret} from "../ship/handlers.ts";
import {Ship, ship} from "../ship/machine.ts";
import {sortChild, sortToTheEnd} from "../sort/program.ts";
import {reviewLine, shipLine} from "../status.ts";
import type {PropertyId} from "../test-writer/brief.ts";
import {answersChild, answersToTheEnd, testsChild, testsToTheEnd} from "../test-writer/program.ts";
import {DEFAULT_INCLUDES, includedBy} from "../test-writer/written.ts";
import {reviewDrawing, shipDrawing} from "../traced.ts";
import {listUsdOf, LaneNow, pickedFor, type Picked} from "./agents.ts";
import {fenced, listed, loadBrief, type Brief} from "./briefs.ts";
import {answerHeard, ticketUrlOf} from "./hosts.ts";
import {
	type askPerson,
	type Carry,
	type claimLane,
	Lane,
	lane,
	type readFiled,
	type releaseLane,
	type runStep,
	type StepEnd,
} from "./machine.ts";
import {LANE_NAMES} from "./outcome.ts";
import {LaneWatch} from "./pulls.ts";
import {LaneHome, LaneWork} from "./work.ts";

// The lane as a program: one tracker ticket through every step, each step's own machine, each step's
// facts on the ticket. Today's version. `pipeline` (programs/pipeline) starts this under an id named
// by the ticket, so typing the line again finds the lane where it stood.
//
//   lane_step {step: "build", count: 7, ...}
//     1. tells the agents who runs this step, from what brief, in what folder
//     2. writes `started`, with the brief's name and hash, under `r-build-7/started`
//     3. runs build's own machine under the Act's intent, to its end
//     4. writes `ended`, with both token counts and dollars, under `r-build-7/ended`
//     5. says one line
//
// The Act sent again after a kill finds the facts by their ids and the machine under its intent.

const unknown = {_tag: "unknown" as const};

/** A failure, with the words a person can act on where it has them. */
type Broke = {readonly _tag: string; readonly says?: string};

const OUTPUTS = {
	step: output(Schema.String, "One line per step as it ends, and per question as it is asked."),
	ended: output(
		Schema.Struct({name: Schema.Literals(LANE_NAMES), said: Schema.String}),
		"Once: how the lane ended, and why.",
	),
};
type Outputs = typeof OUTPUTS;

const buildChild = {...buildStage, parent: "lane" as const};
const planChild = {...planStage, parent: "lane" as const};

const reviewChild = kind({
	machine: review,
	state: Review,
	parent: "lane",
	options: () => ({
		ctx: undefined,
		interpret: {...reviewReadInterpret, review_file_note: () => Effect.succeed("kept" as const)},
		subscribe: reviewSubscribe,
		terminal: (s: Review) => s.phase === "over",
	}),
	recovered: (s) => (s.phase === "idle" ? null : {type: "resume"}),
	drawing: ({id}) => reviewDrawing(id, id),
	status: reviewLine,
});

const shipChild = kind({
	machine: ship,
	state: Ship,
	parent: "lane",
	options: () => ({
		ctx: undefined,
		interpret: {...shipReadInterpret, ...shipWriteInterpret()},
		subscribe: shipSubscribe,
		terminal: (s: Ship) => s.phase === "over",
	}),
	recovered: (s) => (s.phase === "idle" ? null : {type: "resume"}),
	drawing: ({id}) => shipDrawing(id, id),
	status: shipLine,
});

interface Stages {
	readonly send: Send<Outputs>;
	readonly machines: {
		readonly triage: RefsOf<typeof sortChild>;
		readonly plan: RefsOf<typeof planChild>;
		readonly exam: RefsOf<typeof examChild>;
		readonly tests: RefsOf<typeof testsChild>;
		readonly answers: RefsOf<typeof answersChild>;
		readonly build: RefsOf<typeof buildChild>;
		readonly mutation: RefsOf<typeof mutationChild>;
		readonly review: RefsOf<typeof reviewChild>;
		readonly push: RefsOf<typeof pushChild>;
		readonly ship: RefsOf<typeof shipChild>;
	};
}

/** A stage's outcome as the ticket's facts hold it: its five verbs and no more. Pure. */
export const factOutcome = (o: {
	readonly kind: string;
	readonly part?: boolean;
	readonly to?: string;
	readonly why?: string;
	readonly who?: string;
	readonly for?: string;
}): Outcome => {
	switch (o.kind) {
		case "done":
			return {kind: "done", part: o.part ?? false};
		case "send":
			return {kind: "send", to: o.to ?? "", why: o.why ?? ""} as Outcome;
		case "ask":
			return {kind: "ask", who: o.who ?? "", for: o.for ?? ""} as Outcome;
		case "skip":
			return {kind: "skip", why: o.why ?? ""} as Outcome;
		default:
			return {kind: "stuck", why: o.why ?? ""} as Outcome;
	}
};

/** Whether whoever filed a ticket is `person`, or an agent of theirs. Pure. */
export const filedBy = (
	by: {readonly kind: string; readonly id?: string; readonly for?: string} | undefined,
	person: string,
): boolean => by !== undefined && (by.kind === "agent" ? by.for === person : by.id === person);

const AGENT_STEPS: Partial<
	Record<Carried["step"], {readonly step: AgentStep; readonly brief: string}>
> = {
	triage: {step: "triage", brief: "triage.md"},
	plan: {step: "plan", brief: "plan.md"},
	exam: {step: "exam", brief: "exam.md"},
	test_writer: {step: "test_writer", brief: "test-writer.md"},
	mutants: {step: "test_writer", brief: "test-writer-mutants.md"},
	build: {step: "build", brief: "build.md"},
	review: {step: "review", brief: "review.md"},
};

type Carried = ReturnType<typeof runStep>;

/** What a step's body has to hand. */
interface At {
	readonly cmd: Carried;
	readonly repo: string;
	readonly url: string;
	readonly id: TicketId;
	readonly run: string;
	readonly picked: Picked | null;
	readonly brief: Brief | null;
	readonly title: string;
	readonly body: string;
	readonly tell: (
		folder: string,
		access: "read" | "write",
		slots: Readonly<Record<string, string>>,
	) => Effect.Effect<void>;
	readonly stages: Stages["machines"];
}

const budgetOf = (at: At) => ({
	model: at.picked?.model ?? "",
	effort: at.picked?.effort ?? "high",
	budget: at.picked?.usd ?? 1,
});

const need = <A>(value: A | null | undefined, says: string): Effect.Effect<A, Broke> =>
	value === null || value === undefined
		? Effect.fail({_tag: "unknown", says})
		: Effect.succeed(value);

/** A step's end, and what its machine said went wrong: the ticket and the tile say it too. */
type BodyEnd = StepEnd & {readonly problems: readonly string[]};

const ended = (
	outcome: Parameters<typeof factOutcome>[0],
	carry: StepEnd["carry"] = {},
	problems: readonly string[] = [],
): BodyEnd => ({
	outcome: factOutcome(outcome),
	carry,
	problems,
});

const propertiesOf = (carry: Carry, round: number) => {
	if (round > 1)
		return carry.open.map((item, i) => ({
			id: `p${i + 1}` as PropertyId,
			when: item.text,
			result: item.wants.join(" ") || item.says,
			why: item.says,
			behavior: "new" as const,
			tool: "test" as const,
			code: [],
		}));
	return (carry.plan?.properties ?? []).map((p, i) => ({...p, id: `p${i + 1}` as PropertyId}));
};

/** Each step: what its agent is told, and its machine, to its end. */
const bodies = {
	triage: (at: At) =>
		Effect.gen(function* () {
			const work = yield* LaneWork;
			yield* at.tell(yield* work.empty, "read", {});
			const end = yield* sortToTheEnd(
				at.stages.triage,
				at.cmd.intent,
				{ticket: at.url, tries: 3},
				{...budgetOf(at), note: `A ticket on ${at.repo}.`},
			);
			return ended(end.outcome, {}, end.report.problems);
		}),

	plan: (at: At) =>
		Effect.gen(function* () {
			const work = yield* LaneWork;
			const tickets = yield* Tickets;
			const main = yield* work.main;
			yield* at.tell(yield* work.copy(main), "read", {
				ticket: fenced(`# ${at.title}\n\n${at.body}`, "markdown"),
				base: main,
				code_context: "None gathered. Read the code in your folder.",
				names: "None gathered.",
				decisions: "None.",
				note: "",
			});
			const end = yield* planToTheEnd(
				at.cmd.intent,
				{ticket: at.url, tries: 3},
				budgetOf(at),
				at.stages.plan as never,
			);
			const draft = end.report.plan;
			if (draft === null) return ended(end.outcome, {}, end.report.problems);
			const data = revisionOfDraft(draft);
			if (data === null) return ended({kind: "stuck", why: "unchecked"});
			const plan = planOf(at.id);
			yield* sendFact(
				{type: "planned", plan, tickets: [ticketOf(plan)], data, problems: []},
				{id: `${at.run}/planned`, by: "lane"},
			);
			const track = foldLedger(yield* readFacts).plans.get(plan);
			const version = track?.versions.length ?? 1;
			const last = track?.versions.at(-1);
			const tasks = (last?.data.tasks ?? []).map((t) => t.id);
			yield* tickets.write(at.cmd.number, `${at.run}/planned-fact`, {
				type: "planned",
				version,
				tasks,
			});
			if (last !== undefined)
				yield* tickets.talk(at.cmd.number, `${at.run}/plan-text`, {
					type: "commented",
					body: planMarkdown(last.data, at.title),
				});
			return ended(end.outcome, {
				plan: draft,
				version,
				rules: (draft.exam ?? []).map((c) => c.path),
			});
		}),

	exam: (at: At) =>
		Effect.gen(function* () {
			const work = yield* LaneWork;
			const main = yield* work.main;
			const changes = at.cmd.carry.plan?.exam ?? [];
			yield* at.tell(yield* work.copy(main), "read", {
				ticket: `${at.title}\n\n${at.body}`,
				changes: listed(changes.map((c) => `${c.path}: ${c.change} (${c.why})`)),
				note: "",
			});
			const end = yield* examToTheEnd(at.stages.exam, at.cmd.intent, {
				ticket: at.url,
				number: at.cmd.number,
				base: main,
				changes,
				tries: 3,
			});
			return ended(end.outcome, {examPr: end.report.pr ?? null}, end.report.problems);
		}),

	exam_merge: (at: At) =>
		Effect.gen(function* () {
			const pr = yield* need(at.cmd.carry.examPr, "the exam has no pull request");
			return ended(yield* shipped(at, pr));
		}),

	test_writer: (at: At) =>
		Effect.gen(function* () {
			const work = yield* LaneWork;
			const settings = yield* work.settings;
			const {carry, round} = at.cmd;
			const tree = yield* work.tree(at.cmd.number);
			const base = round > 1 ? yield* need(carry.head, "no head to add tests on") : tree.base;
			const properties = propertiesOf(carry, round);
			const includes = settings.test_writer?.includes ?? [...DEFAULT_INCLUDES];
			const taken = (yield* work.listAt(tree.tree, base)).filter(includedBy(includes));
			const version = (carry.version ?? 1) + round - 1;
			const summary = carry.plan?.summary ?? at.title;
			const pointers = carry.plan?.pointers ?? [];
			yield* at.tell(yield* work.copy(base), "read", {
				ticket: at.url,
				plan: `Version ${version}. ${summary}`,
				base,
				properties: fenced(JSON.stringify(properties, null, 1), "json"),
				interface:
					carry.plan?.interface === undefined ? "None." : fenced(carry.plan.interface, "ts"),
				pointers: listed(pointers.map((p) => `${p.at}: ${p.why}`)),
				includes: listed(includes),
				taken: listed(taken),
				test_command: (settings.test_writer?.run ?? []).join(" "),
				note: "",
			});
			const end = yield* testsToTheEnd(at.stages.tests, at.cmd.intent, {
				ticket: at.url,
				plan: {version, summary},
				base,
				properties,
				pointers,
				includes,
				tries: 3,
			});
			const commit = end.report.commit;
			const files = commit === null ? [] : yield* work.filesOf(tree.tree, commit);
			return ended(
				end.outcome,
				{
					base: round > 1 ? carry.base : base,
					head: commit ?? base,
					exam: [...carry.exam, ...files],
				},
				end.report.problems,
			);
		}),

	build: (at: At) =>
		Effect.gen(function* () {
			const work = yield* LaneWork;
			const settings = yield* work.settings;
			const {carry, round} = at.cmd;
			const tree = yield* work.tree(at.cmd.number);
			const tests = propertiesOf(carry, round);
			const pointers = carry.plan?.pointers ?? [];
			yield* at.tell(tree.tree, "write", {
				summary: carry.plan?.summary ?? at.title,
				properties: fenced(JSON.stringify(tests, null, 1), "json"),
				tests: listed(carry.exam),
				interface:
					carry.plan?.interface === undefined ? "None." : fenced(carry.plan.interface, "ts"),
				pointers: listed(pointers.map((p) => `${p.at}: ${p.why}`)),
				exam: listed(carry.exam),
				checks: listed((settings.build?.checks ?? []).map((c) => c.join(" "))),
				quick: listed(
					(settings.mutation?.tests ?? []).length === 0
						? []
						: [(settings.mutation?.tests ?? []).join(" ")],
				),
				decided: "None.",
			});
			const end = yield* buildToTheEnd(
				at.cmd.intent,
				{ticket: at.url, number: at.cmd.number, round, open: carry.open},
				budgetOf(at) as never,
				at.stages.build as never,
			);
			return ended(
				end.outcome,
				{
					head: end.report.head ?? carry.head,
					deviations: end.report.built?.deviations ?? [],
				},
				end.report.problems,
			);
		}),

	mutation: (at: At) =>
		Effect.gen(function* () {
			const {carry} = at.cmd;
			const base = yield* need(carry.base, "no base to mutate from");
			const head = yield* need(carry.head, "no head to mutate");
			const end = yield* mutationToTheEnd(at.stages.mutation, at.cmd.intent, {
				ticket: at.url,
				base,
				head,
				kept: (carry.plan?.properties ?? []).flatMap((p) => p.code ?? []),
				// The diff holds the writer's commit, so listing its files would always ask. The
				// builder's guard holds those files, and rule files land only by the exam's own pull request.
				exam: [],
				allowed: [],
				seed: at.cmd.count,
				most: MAX_MUTANTS,
			});
			return ended(end.outcome, {survived: end.report.ran?.survived ?? []});
		}),

	mutants: (at: At) =>
		Effect.gen(function* () {
			const work = yield* LaneWork;
			const settings = yield* work.settings;
			const {carry} = at.cmd;
			const head = yield* need(carry.head, "no head the mutants lived on");
			const tree = yield* work.tree(at.cmd.number);
			const includes = settings.test_writer?.includes ?? [...DEFAULT_INCLUDES];
			const taken = (yield* work.listAt(tree.tree, head)).filter(includedBy(includes));
			yield* at.tell(yield* work.copy(head), "read", {
				ticket: at.url,
				head,
				survived: fenced(JSON.stringify(carry.survived, null, 1), "json"),
				properties: fenced(JSON.stringify(propertiesOf(carry, 1), null, 1), "json"),
				includes: listed(includes),
				taken: listed(taken),
				test_command: (settings.test_writer?.run ?? []).join(" "),
				note: "",
			});
			const end = yield* answersToTheEnd(at.stages.answers, at.cmd.intent, {
				ticket: at.url,
				head,
				survived: carry.survived,
				includes,
				tries: 3,
			});
			const commit = end.report.commit;
			const files = commit === null ? [] : yield* work.filesOf(tree.tree, commit);
			return ended(
				end.outcome,
				{head: commit ?? head, exam: [...carry.exam, ...files]},
				end.report.problems,
			);
		}),

	review: (at: At) =>
		Effect.gen(function* () {
			const work = yield* LaneWork;
			const tickets = yield* Tickets;
			const settings = yield* work.settings;
			const head = yield* need(at.cmd.carry.head, "no head to review");
			const folder = yield* work.copy(head);
			yield* at.tell(folder, "read", {
				tools: "A shell, in a copy of the code at this head. What you change there is thrown away.",
				checked: "The checks below ran at this head.",
			});
			const rubrics = `${folder}/${settings.review?.rubrics ?? "docs/rubrics"}`;
			const target = bookTarget(planOf(at.id));
			const reviewed: Reviewed = yield* Effect.gen(function* () {
				const runtime = yield* at.stages.review
					.get(at.cmd.intent)
					.start(
						{type: "start", ask: {pr: target, head: null, rubrics}, settings: budgetOf(at)},
						{conflict: "use_existing"},
					);
				const end = yield* runtime.done();
				if (end.phase !== "over") return yield* Effect.die(`the review stopped in ${end.phase}`);
				yield* keepRows(end.report, target);
				return {
					pr: target,
					outcome: end.outcome,
					name: nameOf(end.outcome),
					...end.report,
				} as Reviewed;
			}).pipe(Effect.scoped);
			const open = reviewed.criteria.filter((c) => c.state === "open");
			if (reviewed.head !== null)
				yield* tickets.write(at.cmd.number, `${at.run}/reviewed`, {
					type: "reviewed",
					head: reviewed.head,
					met: reviewed.criteria.length - open.length,
					of: reviewed.criteria.length,
					findings: open.map((c) => c.text),
				});
			return ended(
				reviewed.outcome,
				{
					posts: postsOf(reviewed),
					open: reviewed.outcome.kind === "send" ? openItems(reviewed) : [],
				},
				reviewed.problems,
			);
		}),

	push: (at: At) =>
		Effect.gen(function* () {
			const work = yield* LaneWork;
			const tickets = yield* Tickets;
			const {carry} = at.cmd;
			const base = yield* need(carry.base, "no base to push from");
			const head = yield* need(carry.head, "no head to push");
			const end = yield* pushToTheEnd(at.stages.push, at.cmd.intent, {
				ticket: at.url,
				number: at.cmd.number,
				head,
				title: at.title,
				// Named in words: this text must not close a number on the code host.
				body: [
					`From tracker ticket ${at.cmd.number}.`,
					"",
					carry.plan?.summary ?? "",
					"",
					carry.deviations.length === 0 ? "No deviations." : listed(carry.deviations),
				].join("\n"),
				posts: carry.posts,
			});
			if (end.outcome.kind !== "done") return ended(end.outcome);
			yield* tickets.write(at.cmd.number, `${at.run}/pushed`, {
				type: "pushed",
				head,
				commits: yield* work.commits(base, head),
			});
			yield* (yield* LaneWatch).look(at.cmd.number, end.outcome.pr);
			return ended(end.outcome, {pr: end.outcome.pr});
		}),

	merge: (at: At) =>
		Effect.gen(function* () {
			const pr = yield* need(at.cmd.carry.pr, "no pull request to merge");
			const outcome = yield* shipped(at, pr);
			if (outcome.kind === "done") yield* (yield* LaneWatch).look(at.cmd.number, pr);
			return ended(outcome);
		}),
};

/** Ship, as it is, to its end. Its guards are its own. */
const shipped = (at: At, pr: string) =>
	Effect.gen(function* () {
		const runtime = yield* at.stages.ship
			.get(at.cmd.intent)
			.start({type: "start", pr}, {conflict: "use_existing"});
		const end = yield* runtime.done();
		if (end.phase !== "over") return yield* Effect.die(`the ship stopped in ${end.phase}`);
		return end.outcome;
	}).pipe(Effect.scoped);

const money = (usd: number | null) => (usd === null ? "price unknown" : `$${usd.toFixed(2)}`);

const laneInterpret = ({send, machines}: Stages) => ({
	lane_read: (cmd: ReturnType<typeof readFiled>) =>
		Effect.gen(function* () {
			const tickets = yield* Tickets;
			const {person} = yield* LaneHome;
			const ticket = yield* tickets.read(cmd.number);
			return {
				state: ticket.state === "closed" ? ("closed" as const) : ("open" as const),
				mine: filedBy(ticket.timeline[0]?.by, person),
			};
		}).pipe(Effect.mapError(() => unknown)),

	lane_claim: (cmd: ReturnType<typeof claimLane>) =>
		Effect.gen(function* () {
			const {repo} = yield* (yield* LaneWork).config;
			return yield* claim(`${repo}#${cmd.number}` as TicketId, cmd.lane);
		}).pipe(Effect.mapError(() => unknown)),

	lane_release: (cmd: ReturnType<typeof releaseLane>) =>
		Effect.gen(function* () {
			const {repo} = yield* (yield* LaneWork).config;
			yield* release(`${repo}#${cmd.number}` as TicketId, cmd.lane);
			return "released" as const;
		}).pipe(Effect.mapError(() => unknown)),

	lane_ask: (cmd: ReturnType<typeof askPerson>) =>
		Effect.gen(function* () {
			const tickets = yield* Tickets;
			yield* tickets.write(cmd.number, cmd.ask, {
				type: "asked",
				ask: cmd.ask,
				what: cmd.what,
				picks: cmd.picks as never,
			});
			yield* send("step", `asks: ${cmd.what}. Answer it in: ticket --ticket ${cmd.number}`);
			return null;
		}).pipe(Effect.mapError(() => unknown)),

	lane_step: (cmd: Carried) =>
		Effect.gen(function* () {
			const tickets = yield* Tickets;
			const work = yield* LaneWork;
			const now = yield* LaneNow;
			const home = yield* LaneHome;
			const run = `r-${cmd.step}-${cmd.count}`;
			const from = yield* Clock.currentTimeMillis;
			const said = (line: string) => send("step", `${cmd.step}: ${line}`);

			const body = Effect.gen(function* () {
				const {repo} = yield* work.config;
				const url = ticketUrlOf(repo, cmd.number);
				const id = yield* need(readTicketId(url), `${url} names no ticket`);
				const settings = yield* work.settings;
				const agent = AGENT_STEPS[cmd.step];
				const picked = agent === undefined ? null : pickedFor(settings, agent.step);
				const brief = agent === undefined ? null : yield* loadBrief(home.briefs, agent.brief);
				const ticket = yield* tickets.read(cmd.number);
				const first = ticket.timeline[0]?.fact;
				yield* now.exam.set(cmd.carry.exam);
				const trace = yield* jobTraceId;
				yield* tickets.write(cmd.number, `${run}/started`, {
					type: "started",
					run,
					stage: cmd.step,
					task: null,
					log: null,
					...(trace === null ? {} : {trace}),
					...(brief === null ? {} : {brief: brief.name, hash: brief.hash}),
					...(picked === null
						? {}
						: {harness: picked.harness, model: picked.model, effort: picked.effort}),
				} as CodeFact);
				const at: At = {
					cmd,
					repo,
					url,
					id,
					run,
					picked,
					brief,
					title: ticket.title,
					body: first?.type === "filed" ? first.body : "",
					stages: machines,
					tell: (folder, access, slots) =>
						brief === null || picked === null
							? Effect.void
							: now.set({picked, brief, slots, folder, access}),
				};
				const end: BodyEnd = yield* bodies[cmd.step](at) as Effect.Effect<BodyEnd, Broke>;
				return {end, picked};
			}).pipe(Effect.scoped);

			const exit = yield* Effect.exit(body);
			const spent = yield* now.take;
			const picked = Exit.isSuccess(exit) ? exit.value.picked : null;
			const listUsd =
				picked === null
					? 0
					: listUsdOf(picked.model, {
							input: spent.input,
							cached: spent.cached,
							output: spent.output,
						});
			const usd = picked?.harness === "claude" ? (spent.usd ?? 0) : (listUsd ?? 0);
			const to = yield* Clock.currentTimeMillis;
			const write = (outcome: Outcome) =>
				tickets.write(cmd.number, `${run}/ended`, {
					type: "ended",
					run,
					stage: cmd.step,
					outcome,
					usd,
					input: spent.input,
					output: spent.output,
					turns: spent.turns,
					cached: spent.cached,
					billed: spent.usd,
					listUsd,
					minutes: (to - from) / 60_000,
					...(picked === null
						? {}
						: {harness: picked.harness, model: picked.model, effort: picked.effort}),
				} as CodeFact);
			if (Exit.isSuccess(exit)) {
				const {outcome, carry, problems} = exit.value.end;
				yield* write(outcome);
				yield* said(
					[
						nameOf(outcome),
						...(picked === null
							? []
							: [`${picked.model}, ${spent.input + spent.output} tokens, ${money(listUsd)}`]),
					].join("  "),
				);
				if (outcome.kind === "stuck" && problems.length > 0) {
					const why = problems.join(" ").slice(0, 2_000);
					yield* said(`why: ${why}`);
					yield* tickets
						.talk(cmd.number, `${run}/why`, {
							type: "commented",
							body: `${cmd.step} is stuck. ${why}`,
						})
						.pipe(Effect.ignore);
				}
				return {outcome, carry};
			}
			// A named end: the fact says it broke, and the line says what a person can do.
			const stops = String(exit.cause).slice(0, 300);
			yield* write(factOutcome({kind: "stuck", why: "run_failed"})).pipe(Effect.ignore);
			yield* said(`could not run: ${stops}`);
			return yield* Effect.fail(unknown);
		}).pipe(Effect.mapError(() => unknown)),
});

const laneKind = kind({
	machine: lane,
	state: Lane,
	parent: "main",
	options: (stages: Stages) => ({
		ctx: undefined,
		interpret: laneInterpret(stages),
		subscribe: {
			lane_answer: (sub: {
				readonly deps: {
					readonly number: number;
					readonly ask: string;
					readonly picks: readonly string[];
				};
			}) =>
				answerHeard(sub.deps.number, sub.deps.ask, sub.deps.picks).pipe(
					Stream.map((heard) => ({type: "lane_answered" as const, ...heard})),
				),
		},
		terminal: (s: Lane) => s.phase === "over",
	}),
	recovered: (s) => (s.phase === "idle" ? null : {type: "resume"}),
	drawing: ({id}) => ({
		name: id,
		service: "lane",
		steps: {
			lane_read: "read the ticket",
			lane_claim: "claim it",
			lane_step: "run a step",
			lane_ask: "ask the person",
			lane_answer: "wait for the answer",
			lane_release: "let it go",
		},
	}),
	status: (s) =>
		s.phase === "over"
			? `#${s.number}: ${nameOf(s.outcome)}`
			: s.phase === "running"
				? `#${s.number}: ${s.step}`
				: s.phase,
});

/** The one lane of one ticket. Started by `pipeline` under an id the ticket names. */
export const laneProgram = defineProgram({
	name: "lane",
	description: "One tracker ticket through every step, in order.",
	flags: {ticket: flag(TicketNumber, "The tracker ticket this lane works.")},
	inputs: {},
	outputs: OUTPUTS,
	machines: {
		lane: laneKind,
		triage: sortChild,
		plan: planChild,
		exam: examChild,
		tests: testsChild,
		answers: answersChild,
		build: buildChild,
		mutation: mutationChild,
		review: reviewChild,
		push: pushChild,
		ship: shipChild,
	},
	main: ({flags, send, machines}) =>
		Effect.gen(function* () {
			const n = flags.ticket;
			const config = yield* Effect.result((yield* LaneWork).config);
			if (config._tag === "Failure") {
				const says = config.failure.says ?? "no config";
				yield* send("ended", {name: "stuck:step_failed", said: says});
				return;
			}
			const id = readTicketId(`${config.success.repo}#${n}`);
			if (id === null) {
				yield* send("ended", {
					name: "stuck:step_failed",
					said: `${config.success.repo} names no repo`,
				});
				return;
			}
			const ref = machines.lane.get(`lane/${n}`);
			const kept = yield* ref.read;
			const laneId =
				kept !== null && kept.phase !== "idle" && "lane" in kept ? kept.lane : yield* newLane(id);
			const runtime = yield* ref.start(
				{type: "start", number: n, lane: laneId},
				{conflict: "use_existing"},
			);
			const end = yield* runtime.done();
			if (end.phase !== "over") return yield* Effect.die(`the lane stopped in ${end.phase}`);
			yield* send("ended", {name: nameOf(end.outcome) as never, said: end.said});
		}).pipe(Effect.scoped),
});
