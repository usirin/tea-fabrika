import {structuralHash} from "@demlik/tea";
import type {Entry} from "../../asks/ledger.ts";
import {foldLedger, openAsks, planAskId} from "../../asks/rules.ts";
import {apply, type Book, currentOf, EMPTY} from "../../criteria/book.ts";
import {followedThenKept, heldOf} from "../../criteria/record.ts";
import {
	type LaneId,
	laneId as makeLaneId,
	type PlanId,
	planOf,
	storyId,
	type TicketId,
	taskId,
	ticketId,
} from "../../ids.ts";
import {
	type Build,
	type BuildCmd,
	copyTree,
	openPr,
	pushBranch,
	readTicket,
} from "../../stages/build/machine.ts";
import {READY, type Ticket} from "../../stages/build/ticket.ts";
import {
	type Loop,
	type LoopCmd,
	type LoopSettings,
	postVerdicts,
	runBuild,
	runReview,
	runShip,
} from "../../stages/operate/machine.ts";
import {openItems} from "../../stages/operate/stop.ts";
import {nameOf} from "../../stages/outcome.ts";
import type {Revision} from "../../stages/plan/plan.ts";
import {
	fileNote,
	gatherPack,
	type Report,
	type Review,
	type ReviewCmd,
} from "../../stages/review/machine.ts";
import type {Criterion, Pack} from "../../stages/review/pack.ts";
import {judgementOf, type Reviewed} from "../../stages/review/program.ts";
import {noRun} from "../../stages/review/reviewer.ts";
import type {Form} from "../../stages/review/sheet.ts";
import type {ShipFacts} from "../../stages/ship/facts.ts";
import {
	enqueue,
	finish,
	merge,
	readShipFacts,
	rerunChecks,
	type Ship,
	type ShipCmd,
} from "../../stages/ship/machine.ts";
import {type AnyBuildMsg, buildStep} from "../build.ts";
import type {Update} from "../explore.ts";
import {type AnyLoopMsg, loopStep} from "../loop.ts";
import {type AnyReviewMsg, FORMS, reviewStep} from "../review.ts";
import {type AnyShipMsg, shipStep} from "../ship.ts";
import type {Move, System} from "./search.ts";

// Lanes: the operate loop and its three stages, run side by side on the
// real reducers, over one shared world.
//
// One lane is what the operate program runs for one ticket (../../stages/
// operate/program.ts): the loop machine, and the stage machine its current
// Act started (build, review or ship), each stepped with the real `update`.
// The loop's Act is answered when its stage machine ends, as the program's
// `loop_build`, `loop_review` and `loop_ship` handlers do; `loop_post` is
// answered by the world, which writes the verdicts on the pull request.
//
// The shared world is GitHub and the ledger, as a small model:
//
//   main      a version number; each merge adds one
//   tickets   per ticket: who claims it, its branch and pull request (head,
//             the main it was cut from, its checks, the verdicts posted, its
//             place in the merge queue), its criteria record (the ticket's
//             criteria by id and version, and every verdict row a review
//             kept), and its part of the owner's desk
//
// Every Cmd is answered from that model, at the moment the answer comes: a
// read of the ship facts says what the pull request is then, not a value
// picked at random. So two lanes see each other's writes.
//
// What the model leaves out, on purpose: the agents (the builder hands back
// one plain form; the reviewer a pass or a fail), review notes, comments
// and approvals, mergeability, and CI on anything but the branch head. The
// laws that need those are the single-machine ones in ../specs.ts.
//
// Three host steps are not in any machine today, and are modelled here as
// sketches, each named as one: the claim on a ticket before a lane starts,
// a reviewed fact told to the owner's desk after each review round, and
// the merge queue (GitHub's, not ours).

// ---------------------------------------------------------------- the world

/** Who the reducers are: the real ones, or planted mistakes around them. */
export interface Steps {
	readonly loop: Update<Loop, AnyLoopMsg, LoopCmd>;
	readonly build: Update<Build, AnyBuildMsg, BuildCmd>;
	readonly review: Update<Review, AnyReviewMsg, ReviewCmd>;
	readonly ship: Update<Ship, AnyShipMsg, ShipCmd>;
}
export const REAL: Steps = {loop: loopStep, build: buildStep, review: reviewStep, ship: shipStep};

export type FormName = "pass" | "fail 1" | "fail both";

/**
 * How a lane takes its ticket before it starts. `none`: it does not, as
 * today. `cas`: one compare-and-set on the ledger's claim (a sketch).
 * `read_then_write`: it reads the claim, then writes it in a second step
 * (a planted mistake: the classic race).
 */
export type Claim = "none" | "cas" | "read_then_write";

export interface LanesOptions {
	readonly lanes: number;
	/** `own`: each lane a ticket of its own. `same`: every lane told the same ticket. */
	readonly tickets: "own" | "same";
	/** The repository has a merge queue; else ship merges straight in. */
	readonly queue: boolean;
	/** The loop's cap on rounds. */
	readonly cap: number;
	/** The forms the reviewer may hand back. */
	readonly forms: readonly FormName[];
	/** CI may report red, not only green. */
	readonly red?: boolean;
	/** CI may run again after it settled: checks go back to pending. */
	readonly flaky?: boolean;
	/** A clock beside every wait. Default on. */
	readonly clocks?: boolean;
	/** Every Cmd may also fail. */
	readonly errors?: boolean;
	/** How many times each lane's process may die and start again. */
	readonly restarts?: number;
	readonly claim?: Claim;
	/** Tell the owner's desk (the asks core) each review round, as a reviewed fact. */
	readonly desk?: boolean;
	/** How many times someone else may merge to main. */
	readonly outsider?: number;
	/** A builder may change nothing. */
	readonly idle?: boolean;
	/** The repository refuses a straight merge of a branch behind main. */
	readonly upToDate?: boolean;
	/** The merge queue may throw a pull request out. */
	readonly eject?: boolean;
	readonly steps?: Steps;
}

type Checks = "pending" | "green" | "red";

/** A ticket's branch and pull request, as GitHub has it. */
export interface Pr {
	/** The branch's commit. */
	readonly head: string;
	/** How many commits were pushed. */
	readonly n: number;
	/** The version of main the branch was cut from. Nothing in the machines moves it later. */
	readonly base: number;
	/** CI at the head. */
	readonly checks: Checks;
	readonly opened: boolean;
	readonly merged: boolean;
	/** The head in the merge queue, if any. */
	readonly queued: string | null;
	/** Each verdict posted, oldest first, with the head it is about. */
	readonly verdicts: readonly {readonly head: string; readonly verdict: "pass" | "fail"}[];
}

export interface Tick {
	/** The lane that holds the claim. */
	readonly claim: LaneId | null;
	readonly pr: Pr | null;
	/**
	 * The criteria record for this ticket (../../criteria/record.ts): the book
	 * of its criteria, and every verdict row a review kept. Ship reads it, and
	 * merges only with a passing row per criterion at the head.
	 */
	readonly record: Book;
	/** The owner's desk for this ticket's plan: the ledger's facts. */
	readonly desk: readonly Entry[];
}

type Stage =
	| {readonly stage: "build"; readonly asked: ReturnType<typeof runBuild>; readonly m: Build}
	| {readonly stage: "review"; readonly asked: ReturnType<typeof runReview>; readonly m: Review}
	| {readonly stage: "ship"; readonly asked: ReturnType<typeof runShip>; readonly m: Ship};

type AnyCmd = BuildCmd | ReviewCmd | ShipCmd | ReturnType<typeof postVerdicts>;
interface Flying {
	readonly key: string;
	readonly cmd: AnyCmd;
}

export interface Lane {
	readonly id: LaneId;
	/** The ticket's name in the world, as `T1`. On the code host and in the ledger it is `ticketOfName(ticket)`. */
	readonly ticket: string;
	/** `told`: not started. `seen`: read the claim free, not yet written. `working`: its loop runs. `refused`: the claim was taken. */
	readonly host: "told" | "seen" | "working" | "refused";
	readonly loop: Loop;
	readonly child: Stage | null;
	/** Cmds in flight, sorted by key. */
	readonly flight: readonly Flying[];
	readonly restarts: number;
}

export interface Lanes {
	readonly lanes: readonly Lane[];
	readonly tickets: Readonly<Record<string, Tick>>;
	readonly main: number;
	/** Merges by someone else still to come. */
	readonly outsider: number;
}

/** A merge onto main: which lane, which head, the main it was built and tested on, and the main it lands on. */
export interface Landing {
	readonly lane: number;
	readonly ticket: string;
	readonly head: string;
	/** The main the code that lands was last tested with: the branch's base, or main itself when the queue tested it. */
	readonly tested: number;
	readonly onto: number;
	/** The last verdict posted at this head, if any. */
	readonly verdict: "pass" | "fail" | null;
}
export interface Note {
	readonly landings?: readonly Landing[];
}

// ---------------------------------------------------------------- fixed values

/** A ticket's one task, as the criteria book names it. */
const TASK = taskId("t1");

/** Every ticket's criteria record as it starts: two criteria, `c1` and `c2`, each at version 1, no verdicts. */
const FIRST_RECORD: Book = ["every window opens", "the door locks"].reduce(
	(b, text) => apply(b, {type: "added", task: TASK, text, by: "plan"}),
	EMPTY,
);
/** The ticket's criteria, under the ids and versions the record gave them. */
const CRITERIA: readonly Criterion[] = currentOf(FIRST_RECORD).map(({id, version, text}) => ({
	id,
	version,
	text,
	checked: false,
	evidence: null,
}));
const settingsOf = (cap: number): LoopSettings => ({
	rubrics: "r",
	model: "m",
	effort: "low",
	budget: 1,
	rounds: cap,
	ship: "write",
});
/** Every ticket has the number 1: the machines never compare numbers across lanes, and one number lets two lanes be the same up to renaming. */
const NUMBER = 1;
/** As a first version: no task or criterion keeps an id, so the ledger gives them when it folds the plan in. */
const PLAN: Revision = {
	summary: "windows",
	stories: [{id: storyId("s1"), who: "a user", want: "open windows", why: "air"}],
	tasks: [
		{
			title: "windows",
			ends: "pr",
			job: {
				when: "a user opens every window",
				result: "each one opens",
				check: {how: "test", what: "a test"},
				serves: [storyId("s1")],
				fixture: "three windows",
			},
			criteria: [],
		},
	],
	pointers: [],
	questions: [],
};

const FAIL_BOTH: Form = {
	rows: CRITERIA.map((c, i) => ({
		id: c.id,
		grade: "fail" as const,
		where: [],
		says: i === 0 ? "stuck shut" : "no lock",
	})),
	findings: CRITERIA.map((c) => ({
		kind: "review-code" as const,
		from: {source: "criterion" as const, id: c.id},
		fault: `criterion ${c.id} is not met`,
		at: null,
		proof: "p",
		wants: `criterion ${c.id} met`,
	})),
	skipped: [],
};
const formOf = (name: FormName): Form => (name === "fail both" ? FAIL_BOTH : (FORMS[name] as Form));

const prUrl = (ticket: string) => `P-${ticket}`;
const laneId = (lane: number): LaneId => makeLaneId(`L${lane + 1}`);
const UNKNOWN = {_tag: "unknown" as const};

/** A world ticket (`T1`) as the code host and the ledger name it. */
export const ticketOfName = (name: string): TicketId => ticketId(`w/${name}#1`);
/** The plan a world ticket starts. */
export const planOfName = (name: string): PlanId => planOf(ticketOfName(name));

/** The desk a ticket starts with: its plan written and approved. */
export const firstDesk = (name: string): readonly Entry[] => {
	const plan = planOfName(name);
	return [
		{
			seq: 1,
			fact: {type: "planned", plan, tickets: [ticketOfName(name)], data: PLAN, problems: []},
		},
		{seq: 2, fact: {type: "answered", id: planAskId(plan, 1), answer: {kind: "approve"}}},
	];
};

const folds = new WeakMap<readonly Entry[], ReturnType<typeof foldLedger>>();
/** The desk, folded: what waits on the owner. Kept per list, since a list never changes. */
export const deskOf = (desk: readonly Entry[]) => {
	let folded = folds.get(desk);
	if (folded === undefined) {
		folded = foldLedger(desk);
		folds.set(desk, folded);
	}
	return folded;
};

/**
 * A review's round, kept in the ticket's record when the review ends, as the
 * program's `keepRows` (../../stages/review/program.ts) does through the
 * in-memory record (`memoryRecord`, ../../criteria/record.ts): the same
 * guards and the same pure steps, with no Effect around them.
 */
function keepRows(record: Book, report: Report, pr: string): Book {
	const judgement = judgementOf(report, pr);
	return judgement === null ? record : followedThenKept(record, judgement);
}

// ---------------------------------------------------------------- one lane's turn

/** What one move does to one lane, its ticket and main. Steps the machines in place, then hands back new values. */
class Turn {
	lane: Lane;
	tick: Tick;
	main: number;
	readonly landings: Landing[] = [];
	readonly o: Required<Pick<LanesOptions, "steps" | "desk" | "cap">>;
	readonly at: number;
	constructor(
		o: Required<Pick<LanesOptions, "steps" | "desk" | "cap">>,
		at: number,
		lane: Lane,
		tick: Tick,
		main: number,
	) {
		this.o = o;
		this.at = at;
		this.lane = lane;
		this.tick = tick;
		this.main = main;
	}

	fly(cmd: AnyCmd): void {
		const flight = [...this.lane.flight, {key: structuralHash(cmd), cmd}].sort((a, b) =>
			a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
		);
		this.lane = {...this.lane, flight};
	}

	/** The loop takes a Msg; each Act it sends starts its stage, or wakes the one already there. */
	toLoop(msg: AnyLoopMsg): void {
		const [loop, cmds] = this.o.steps.loop(this.lane.loop, msg);
		this.lane = {...this.lane, loop};
		for (const cmd of cmds) this.route(cmd);
	}

	route(cmd: LoopCmd): void {
		if (cmd.type === "loop_post") {
			this.fly(cmd);
			return;
		}
		const child = this.lane.child;
		// The same Act sent again (a restart): its stage's machine is kept under the intent, and resumes.
		if (child !== null && child.asked.intent === cmd.intent) {
			this.toChild({type: "resume"});
			return;
		}
		switch (cmd.type) {
			case "loop_build":
				this.lane = {...this.lane, child: {stage: "build", asked: cmd, m: {phase: "idle"}}};
				this.toChild({
					type: "start",
					ask: {ticket: cmd.ticket, number: cmd.number, round: cmd.round, open: cmd.open},
					settings: cmd.settings,
					session: cmd.intent,
				});
				return;
			case "loop_review":
				this.lane = {...this.lane, child: {stage: "review", asked: cmd, m: {phase: "idle"}}};
				this.toChild({
					type: "start",
					ask: {pr: cmd.pr, head: null, rubrics: cmd.rubrics},
					settings: cmd.settings,
				});
				return;
			case "loop_ship":
				this.lane = {...this.lane, child: {stage: "ship", asked: cmd, m: {phase: "idle"}}};
				this.toChild({type: "start", pr: cmd.pr});
				return;
		}
	}

	/** The current stage takes a Msg. When it ends, its outcome answers the loop's Act, as the program's handler does. */
	toChild(msg: AnyBuildMsg | AnyReviewMsg | AnyShipMsg): void {
		const child = this.lane.child;
		if (child === null) return;
		switch (child.stage) {
			case "build": {
				const [m, cmds] = this.o.steps.build(child.m, msg as AnyBuildMsg);
				this.lane = {...this.lane, child: {...child, m}};
				for (const c of cmds) this.fly(c);
				if (m.phase !== "over") return;
				this.lane = {...this.lane, child: null};
				this.toLoop(
					runBuild.ok(
						child.asked,
						{outcome: m.outcome, name: nameOf(m.outcome), report: m.report},
						0,
					),
				);
				return;
			}
			case "review": {
				const [m, cmds] = this.o.steps.review(child.m, msg as AnyReviewMsg);
				this.lane = {...this.lane, child: {...child, m}};
				for (const c of cmds) this.fly(c);
				if (m.phase !== "over") return;
				this.lane = {...this.lane, child: null};
				const reviewed: Reviewed = {
					pr: child.asked.pr,
					outcome: m.outcome,
					name: nameOf(m.outcome),
					...m.report,
				};
				// Its verdict rows go to the ticket's record before the loop hears of it, as the program does.
				this.tick = {...this.tick, record: keepRows(this.tick.record, m.report, child.asked.pr)};
				// The host's sketch: each review round is told to the owner's desk, as a reviewed fact.
				if (this.o.desk)
					this.tick = {
						...this.tick,
						desk: [
							...this.tick.desk,
							{
								seq: this.tick.desk.length + 1,
								fact: {
									type: "reviewed",
									plan: planOfName(this.lane.ticket),
									task: TASK,
									open: openItems(reviewed).length,
								},
							},
						],
					};
				this.toLoop(runReview.ok(child.asked, reviewed, 0));
				return;
			}
			case "ship": {
				const [m, cmds] = this.o.steps.ship(child.m, msg as AnyShipMsg);
				this.lane = {...this.lane, child: {...child, m}};
				for (const c of cmds) this.fly(c);
				if (m.phase !== "over") return;
				this.lane = {...this.lane, child: null};
				this.toLoop(runShip.ok(child.asked, {outcome: m.outcome, said: nameOf(m.outcome)}, 0));
				return;
			}
		}
	}

	/** A Cmd's answer, to the machine that sent it. */
	answer(cmd: AnyCmd, msg: AnyLoopMsg | AnyBuildMsg | AnyReviewMsg | AnyShipMsg): void {
		const at = this.lane.flight.findIndex((f) => f.cmd === cmd);
		this.lane = {...this.lane, flight: this.lane.flight.filter((_, i) => i !== at)};
		if (cmd.type === "loop_post") this.toLoop(msg as AnyLoopMsg);
		else this.toChild(msg as AnyBuildMsg | AnyReviewMsg | AnyShipMsg);
	}

	setPr(pr: Pr): void {
		this.tick = {...this.tick, pr};
	}

	/** Merge `head` onto main: one more version, the pull request merged. */
	land(pr: Pr, tested: number): number {
		const last = [...pr.verdicts].reverse().find((v) => v.head === pr.head);
		this.landings.push({
			lane: this.at,
			ticket: this.lane.ticket,
			head: pr.head,
			tested,
			onto: this.main,
			verdict: last?.verdict ?? null,
		});
		this.main += 1;
		this.setPr({...pr, merged: true, queued: null});
		return this.main;
	}
}

// ---------------------------------------------------------------- reads, as GitHub would answer them

const ticketRead = (ticket: string, pr: Pr | null): Ticket => ({
	url: ticket,
	number: NUMBER,
	state: "open",
	title: "windows",
	body: "b",
	labels: [READY],
	criteria: [...CRITERIA],
	prs:
		pr === null || !pr.opened
			? []
			: [{url: prUrl(ticket), state: pr.merged ? "merged" : "open", head: pr.head}],
	rules: [],
});

/** The review's pack at the head: the ticket's criteria under their ids, as its boxes name them. */
const packOf = (ticket: string, pr: Pr): Pack => ({
	pr: prUrl(ticket),
	head: pr.head,
	replay: false,
	state: pr.merged ? "merged" : "open",
	ticket: {id: ticket, link: "closes_it"},
	criteria: [...CRITERIA],
	files: [{path: "a.ts", kind: "review-code"}],
	kinds: ["review-code"],
	diff: "d",
	deviations: {state: "none"},
	checks: {state: pr.checks, required: []},
	rules: [],
	rubrics: [{kind: "review-code", text: "r"}],
});

/**
 * The ship facts at the pull request's head: GitHub's, and the ticket's
 * record, as ship's `readFacts` joins them. Main as two commits: where the
 * branch left it (`base`), and where it is now.
 */
const factsOf = (ticket: string, pr: Pr, record: Book, main: number): ShipFacts => {
	const last = [...pr.verdicts].reverse().find((v) => v.head === pr.head);
	const held = heldOf(record);
	return {
		head: pr.head,
		state: pr.merged ? "merged" : "open",
		ours: true,
		ticket: {id: ticket, link: "closes_it"},
		criteria: held?.criteria ?? null,
		verdicts: held?.verdicts ?? [],
		approval: "not_needed",
		reviews: [
			{
				kind: "review-code",
				verdict: last === undefined ? "missing" : last.verdict === "pass" ? "passed" : "failed",
			},
		],
		checks: pr.checks,
		mergeable: "clean",
		comments: [],
		main: {tested: `m${pr.base}`, tip: `m${main}`},
	};
};

const mainOf = (commit: string): number => Number(commit.slice(1));

// ---------------------------------------------------------------- the moves

interface Choice {
	readonly label: string;
	readonly touches: readonly string[];
	readonly fair: string | null;
	readonly rare?: boolean;
	readonly go: (turn: Turn) => void;
}

/** A lane's own key for a ticket's part of the world. */
const tickPart = (ticket: string) => `ticket:${ticket}`;
const lanePart = (lane: number) => `lane:${lane}`;

/** Every answer one Cmd in flight may get, from the world as it is now. */
function answersOf(
	o: Required<LanesOptions>,
	lane: Lane,
	cmd: AnyCmd,
	key: string,
	at: number,
	tick: Tick,
	main: number,
): Choice[] {
	const me = laneId(at);
	const t = tickPart(lane.ticket);
	const fair = `${me}:${key}`;
	const pr = tick.pr;
	const choice = (label: string, touches: readonly string[], go: (turn: Turn) => void): Choice => ({
		label: `${me} ${label}`,
		touches: [lanePart(at), ...touches],
		fair,
		go,
	});
	const failing = (label: string, go: (turn: Turn) => void): Choice[] =>
		o.errors ? [choice(`${label} fails`, [t], go)] : [];
	switch (cmd.type) {
		case "build_ticket":
			return [
				choice("reads the ticket", [t], (turn) =>
					turn.answer(cmd, readTicket.ok(cmd, ticketRead(lane.ticket, pr), 0)),
				),
				...failing("reading the ticket", (turn) =>
					turn.answer(cmd, readTicket.err(cmd, UNKNOWN, 0)),
				),
			];
		case "build_copy": {
			// A working copy on the branch if it was pushed, else on main as it is now.
			const base = pr === null ? `m${main}` : pr.head;
			return [
				choice(`copies at ${base}`, pr === null ? [t, "main"] : [t], (turn) =>
					turn.answer(cmd, copyTree.ok(cmd, {tree: "w", branch: "build/1", base}, 0)),
				),
				...failing("the copy", (turn) => turn.answer(cmd, copyTree.err(cmd, UNKNOWN, 0))),
			];
		}
		case "build_push": {
			const from = cmd.copied.base;
			// Never forced: a branch that moved since the copy refuses the push.
			if (pr !== null && pr.head !== from)
				return [
					choice(`push refused: the branch is at ${pr.head}`, [t], (turn) =>
						turn.answer(cmd, pushBranch.err(cmd, UNKNOWN, 0)),
					),
				];
			const n = (pr?.n ?? 0) + 1;
			const head = `${lane.ticket}.c${n}`;
			const pushed: Pr = {
				head,
				n,
				base: pr?.base ?? mainOf(from),
				checks: "pending",
				opened: pr?.opened ?? false,
				merged: false,
				queued: null,
				verdicts: pr?.verdicts ?? [],
			};
			return [
				choice(`pushes ${head}`, [t], (turn) => {
					turn.setPr(pushed);
					turn.answer(cmd, pushBranch.ok(cmd, {head, changed: true}, 0));
				}),
				...(o.idle && pr !== null
					? [
							choice("pushes nothing new", [t], (turn) =>
								turn.answer(cmd, pushBranch.ok(cmd, {head: from, changed: false}, 0)),
							),
						]
					: []),
				...failing("the push", (turn) => turn.answer(cmd, pushBranch.err(cmd, UNKNOWN, 0))),
			];
		}
		case "build_open":
			return [
				choice("opens the pull request", [t], (turn) => {
					if (turn.tick.pr !== null) turn.setPr({...turn.tick.pr, opened: true});
					turn.answer(cmd, openPr.ok(cmd, prUrl(lane.ticket), 0));
				}),
				...failing("opening it", (turn) => turn.answer(cmd, openPr.err(cmd, UNKNOWN, 0))),
			];
		case "review_pack":
			return [
				...(pr === null
					? []
					: [
							choice(`reads the pack at ${pr.head}: checks ${pr.checks}`, [t], (turn) =>
								turn.answer(cmd, gatherPack.ok(cmd, packOf(lane.ticket, pr), 0)),
							),
						]),
				...(pr === null || o.errors
					? [
							choice("reading the pack fails", [t], (turn) =>
								turn.answer(cmd, gatherPack.err(cmd, UNKNOWN, 0)),
							),
						]
					: []),
			];
		case "review_file_note":
			return [choice("files a note", [], (turn) => turn.answer(cmd, fileNote.ok(cmd, "kept", 0)))];
		case "loop_post":
			return [
				choice(
					`posts ${cmd.posts.map((p) => p.verdict).join(", ")} at ${cmd.head}`,
					[t],
					(turn) => {
						const now = turn.tick.pr;
						if (now !== null)
							turn.setPr({
								...now,
								verdicts: [
									...now.verdicts,
									...cmd.posts.map((p) => ({head: cmd.head, verdict: p.verdict})),
								],
							});
						turn.answer(cmd, postVerdicts.ok(cmd, "posted", 0));
					},
				),
				...failing("posting", (turn) => turn.answer(cmd, postVerdicts.err(cmd, UNKNOWN, 0))),
			];
		case "ship_facts": {
			const facts = pr === null ? null : factsOf(lane.ticket, pr, tick.record, main);
			return [
				...(facts === null
					? []
					: [
							choice(
								`reads the ship facts at ${facts.head}: ${facts.reviews?.[0]?.verdict}, checks ${facts.checks}`,
								[t],
								(turn) => turn.answer(cmd, readShipFacts.ok(cmd, facts, 0)),
							),
						]),
				...(facts === null || o.errors
					? [
							choice("reading the ship facts fails", [t], (turn) =>
								turn.answer(cmd, readShipFacts.err(cmd, UNKNOWN, 0)),
							),
						]
					: []),
			];
		}
		case "ship_rerun_checks":
			return [
				choice(`runs the checks again at ${cmd.head}`, [t], (turn) => {
					const now = turn.tick.pr;
					if (now !== null && now.head === cmd.head) turn.setPr({...now, checks: "pending"});
					turn.answer(cmd, rerunChecks.ok(cmd, [{run: 1, attempt: 1}], 0));
				}),
				...failing("the re-run", (turn) => turn.answer(cmd, rerunChecks.err(cmd, UNKNOWN, 0))),
			];
		case "ship_enqueue": {
			// The write takes only the proof; the head it names is the one GitHub is asked to queue.
			const {head} = cmd.ready;
			const answer = !o.queue
				? ("no_queue" as const)
				: pr === null || pr.head !== head
					? ("head_moved" as const)
					: ("queued" as const);
			return [
				choice(`enqueue ${head}: ${answer}`, [t], (turn) => {
					const now = turn.tick.pr;
					if (answer === "queued" && now !== null) turn.setPr({...now, queued: head});
					turn.answer(cmd, enqueue.ok(cmd, answer, 0));
				}),
				...failing("the enqueue", (turn) => turn.answer(cmd, enqueue.err(cmd, UNKNOWN, 0))),
			];
		}
		case "ship_merge": {
			const {head} = cmd.ready;
			if (pr === null || pr.head !== head)
				return [
					choice(`merge ${head}: head moved`, [t], (turn) =>
						turn.answer(cmd, merge.ok(cmd, {reading: "head_moved"}, 0)),
					),
				];
			if (pr.merged)
				return [
					choice(`merge ${head}: refused, it is merged already`, [t], (turn) =>
						turn.answer(cmd, merge.err(cmd, UNKNOWN, 0)),
					),
				];
			if (o.upToDate && pr.base !== main)
				return [
					choice(`merge ${head}: refused, the branch is behind main`, [t, "main"], (turn) =>
						turn.answer(cmd, merge.err(cmd, UNKNOWN, 0)),
					),
				];
			return [
				choice(`merges ${head} straight onto main ${main}`, [t, "main"], (turn) => {
					const now = turn.tick.pr ?? pr;
					const version = turn.land(now, now.base);
					turn.answer(cmd, merge.ok(cmd, {reading: "merged", commit: `m${version}`}, 0));
				}),
				...failing("the merge", (turn) => turn.answer(cmd, merge.err(cmd, UNKNOWN, 0))),
			];
		}
		case "ship_finish":
			return [
				choice("tidies up", [], (turn) => turn.answer(cmd, finish.ok(cmd, null, 0))),
				...failing("the tidy-up", (turn) => turn.answer(cmd, finish.err(cmd, UNKNOWN, 0))),
			];
	}
}

/** The moves of one lane that are its own: its host, its agents, its Listens and clocks, a restart. */
function laneChoices(o: Required<LanesOptions>, w: Lanes, at: number): Choice[] {
	const lane = w.lanes[at] as Lane;
	const me = laneId(at);
	const t = tickPart(lane.ticket);
	const own = lanePart(at);
	const tick = w.tickets[lane.ticket] as Tick;
	const out: Choice[] = [];
	const start = (turn: Turn) => {
		turn.lane = {...turn.lane, host: "working"};
		turn.toLoop({type: "start", ticket: lane.ticket, number: NUMBER, settings: settingsOf(o.cap)});
	};
	if (lane.host === "told" || lane.host === "seen") {
		const fair = `${me}:host`;
		if (o.claim === "none")
			out.push({label: `${me} starts on ${lane.ticket}`, touches: [own], fair, go: start});
		else if (o.claim === "cas")
			out.push({
				label: `${me} claims ${lane.ticket}`,
				touches: [own, t],
				fair,
				go: (turn) => {
					if (turn.tick.claim !== null) {
						turn.lane = {...turn.lane, host: "refused"};
						return;
					}
					turn.tick = {...turn.tick, claim: me};
					start(turn);
				},
			});
		else if (lane.host === "told")
			out.push({
				label: `${me} reads the claim on ${lane.ticket}: ${tick.claim ?? "free"}`,
				touches: [own, t],
				fair,
				go: (turn) => {
					turn.lane = {...turn.lane, host: turn.tick.claim === null ? "seen" : "refused"};
				},
			});
		else
			out.push({
				label: `${me} writes its claim on ${lane.ticket}`,
				touches: [own, t],
				fair,
				go: (turn) => {
					turn.tick = {...turn.tick, claim: me};
					start(turn);
				},
			});
		return out;
	}
	if (lane.host !== "working" || lane.loop.phase === "over") return out;

	lane.flight.forEach((f, i) => {
		if (i > 0 && lane.flight[i - 1]?.key === f.key) return; // the same Cmd twice: one set of answers
		out.push(...answersOf(o, lane, f.cmd, f.key, at, tick, w.main));
	});

	const child = lane.child;
	const pr = tick.pr;
	if (child?.stage === "build" && child.m.phase === "building") {
		const s = child.m;
		out.push({
			label: `${me} builder hands back its form`,
			touches: [own],
			fair: `${me}:builder`,
			go: (turn) =>
				turn.toChild({
					type: "build_built",
					ticket: s.ask.ticket,
					round: s.ask.round,
					run: s.run,
					built: {summary: "Opens the windows.", deviations: [], ran: [], left: []},
					ran: noRun,
				}),
		});
	}
	if (child?.stage === "review" && child.m.phase === "reviewing") {
		const s = child.m;
		for (const name of o.forms)
			out.push({
				label: `${me} reviewer hands back "${name}" at ${s.brief.head}`,
				touches: [own, t],
				fair: `${me}:reviewer`,
				go: (turn) =>
					turn.toChild({
						type: "review_reviewed",
						pr: s.brief.pr,
						head: s.brief.head,
						run: s.run,
						form: formOf(name),
						ran: noRun,
					}),
			});
	}
	if (child?.stage === "review" && child.m.phase === "waiting") {
		const s = child.m;
		if (pr !== null && pr.head === s.head && pr.checks !== "pending")
			out.push({
				label: `${me} hears the checks settled at ${s.head}`,
				touches: [own, t],
				fair: `${me}:listen`,
				go: (turn) => turn.toChild({type: "review_checks", pr: s.ask.pr, head: s.head}),
			});
		if (o.clocks)
			out.push({
				label: `${me} review's clock runs out, wait ${s.waited}`,
				touches: [own, t],
				fair: `${me}:clock:review:${s.waited}`,
				go: (turn) =>
					turn.toChild({type: "review_checks_overdue", pr: s.ask.pr, head: s.head, wait: s.waited}),
			});
	}
	if (child?.stage === "ship" && child.m.phase === "waiting") {
		const s = child.m;
		if (pr !== null && pr.head === s.head && pr.checks !== "pending")
			out.push({
				label: `${me} hears the checks settled at ${s.head}`,
				touches: [own, t],
				fair: `${me}:listen`,
				go: (turn) => turn.toChild({type: "ship_checks", pr: s.pr, head: s.head}),
			});
		if (o.clocks)
			out.push({
				label: `${me} ship's clock runs out, wait ${s.waited}`,
				touches: [own, t],
				fair: `${me}:clock:ship:${s.waited}`,
				go: (turn) =>
					turn.toChild({type: "ship_checks_overdue", pr: s.pr, head: s.head, wait: s.waited}),
			});
	}
	if (child?.stage === "ship" && child.m.phase === "queued" && o.clocks) {
		const s = child.m;
		out.push({
			label: `${me} queue's clock runs out`,
			touches: [own, t],
			fair: `${me}:clock:queue`,
			go: (turn) => turn.toChild({type: "ship_queue_overdue", pr: s.pr, head: s.ready.head}),
		});
	}
	if (lane.restarts < o.restarts)
		out.push({
			label: `${me} dies and starts again`,
			touches: [own, t],
			fair: null,
			rare: true,
			go: (turn) => {
				// Cmds in flight die with the process; the loop and its stage are kept, and resume.
				turn.lane = {...turn.lane, flight: [], restarts: turn.lane.restarts + 1};
				turn.toLoop({type: "resume"});
			},
		});
	return out;
}

// ---------------------------------------------------------------- the system

const PERMS: Readonly<Record<number, readonly (readonly number[])[]>> = {
	1: [[0]],
	2: [
		[0, 1],
		[1, 0],
	],
	3: [
		[0, 1, 2],
		[0, 2, 1],
		[1, 0, 2],
		[1, 2, 0],
		[2, 0, 1],
		[2, 1, 0],
	],
};

/** A short digest of a long string: two 32-bit hashes (the cyrb53 mix), as hex. */
export function digest(text: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 2654435761);
		h2 = Math.imul(h2 ^ c, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

/** The lanes world as a system to search. */
export function lanesWorld(options: LanesOptions): System<Lanes, Note> {
	const o: Required<LanesOptions> = {
		red: false,
		flaky: false,
		clocks: true,
		errors: false,
		restarts: 0,
		claim: "none",
		desk: false,
		outsider: 0,
		idle: false,
		upToDate: false,
		eject: false,
		steps: REAL,
		...options,
	};
	if (o.lanes < 1 || o.lanes > 3) throw new Error("one to three lanes");
	const names = Array.from({length: o.lanes}, (_, i) => (o.tickets === "own" ? `T${i + 1}` : "T1"));
	const tickets = [...new Set(names)];
	/** The one lane on a ticket, or -1 when several are. */
	const ownerOf = (ticket: string): number => {
		const on = names.flatMap((n, i) => (n === ticket ? [i] : []));
		return on.length === 1 ? (on[0] as number) : -1;
	};

	const init: Lanes = {
		lanes: names.map((ticket, at) => ({
			id: laneId(at),
			ticket,
			host: "told",
			loop: {phase: "idle"},
			child: null,
			flight: [],
			restarts: 0,
		})),
		tickets: Object.fromEntries(
			tickets.map((t) => [
				t,
				{claim: null, pr: null, record: FIRST_RECORD, desk: o.desk ? firstDesk(t) : []},
			]),
		),
		main: 0,
		outsider: o.outsider,
	};

	/** Apply one choice of lane `at` (or of the world, at -1, on `ticket`). */
	const apply = (
		w: Lanes,
		at: number,
		ticket: string,
		choice: Choice,
		lanes: readonly number[],
	) => {
		const tick = w.tickets[ticket] as Tick;
		const driver = at >= 0 ? at : (lanes[0] ?? 0);
		const turn = new Turn(o, driver, w.lanes[driver] as Lane, tick, w.main);
		choice.go(turn);
		const next: Lanes = {
			lanes: w.lanes.map((l, i) => (i === driver ? turn.lane : l)),
			tickets: turn.tick === tick ? w.tickets : {...w.tickets, [ticket]: turn.tick},
			main: turn.main,
			outsider: w.outsider,
		};
		return {next, landings: turn.landings};
	};

	const moves = (w: Lanes): Move<Lanes, Note>[] => {
		const out: Move<Lanes, Note>[] = [];
		const push = (lane: number, choice: Choice, next: Lanes, landings: readonly Landing[]) =>
			out.push({
				label: choice.label,
				lane,
				touches: choice.touches,
				fair: choice.fair,
				rare: choice.rare ?? false,
				next,
				...(landings.length > 0 ? {note: {landings}} : {}),
			});
		w.lanes.forEach((lane, at) => {
			for (const choice of laneChoices(o, w, at)) {
				const {next, landings} = apply(w, at, lane.ticket, choice, [at]);
				push(at, choice, next, landings);
			}
		});
		// The world on each ticket: CI, the merge queue, the owner at the desk.
		for (const ticket of tickets) {
			const tick = w.tickets[ticket] as Tick;
			const owner = ownerOf(ticket);
			const t = tickPart(ticket);
			const lanesOn = names.flatMap((n, i) => (n === ticket ? [i] : []));
			const world = (
				choice: Choice,
				extra: (next: Lanes) => {next: Lanes; landings: Landing[]},
			) => {
				const after = extra(w);
				push(owner, choice, after.next, after.landings);
			};
			const pr = tick.pr;
			if (pr !== null && !pr.merged) {
				if (pr.checks === "pending")
					for (const checks of o.red ? (["green", "red"] as const) : (["green"] as const)) {
						const choice: Choice = {
							label: `${ticket} CI ${checks} at ${pr.head}`,
							touches: [t],
							fair: `${ticket}:ci`,
							go: () => {},
						};
						world(choice, (w0) => ({
							next: {...w0, tickets: {...w0.tickets, [ticket]: {...tick, pr: {...pr, checks}}}},
							landings: [],
						}));
					}
				else if (o.flaky)
					world(
						{
							label: `${ticket} CI runs again at ${pr.head}`,
							touches: [t],
							fair: null,
							go: () => {},
						},
						(w0) => ({
							next: {
								...w0,
								tickets: {...w0.tickets, [ticket]: {...tick, pr: {...pr, checks: "pending"}}},
							},
							landings: [],
						}),
					);
				if (pr.queued !== null && pr.queued === pr.head) {
					// The queue tests the head on top of main as it is now, and lands it; the Listen tells every ship waiting on it.
					const outcomes = o.eject ? (["landed", "ejected"] as const) : (["landed"] as const);
					for (const reading of outcomes) {
						const waiting = lanesOn.filter((i) => {
							const c = (w.lanes[i] as Lane).child;
							return c?.stage === "ship" && c.m.phase === "queued";
						});
						const choice: Choice = {
							label:
								reading === "landed"
									? `${ticket} queue lands ${pr.head} onto main ${w.main}`
									: `${ticket} queue throws ${pr.head} out`,
							touches: [t, "main", ...waiting.map(lanePart)],
							fair: `${ticket}:queue`,
							go: () => {},
						};
						world(choice, (w0) => {
							let lanes = w0.lanes;
							let main = w0.main;
							let now = tick;
							const landings: Landing[] = [];
							const head = pr.head;
							if (reading === "landed") {
								const turn = new Turn(
									o,
									lanesOn[0] ?? 0,
									lanes[lanesOn[0] ?? 0] as Lane,
									now,
									main,
								);
								turn.land(pr, main);
								landings.push(...turn.landings);
								main = turn.main;
								now = turn.tick;
							} else now = {...now, pr: {...pr, queued: null}};
							for (const i of waiting) {
								const turn = new Turn(o, i, lanes[i] as Lane, now, main);
								turn.toChild(
									reading === "landed"
										? {
												type: "ship_queue",
												pr: prUrl(ticket),
												head,
												reading,
												commit: `m${main}`,
											}
										: {type: "ship_queue", pr: prUrl(ticket), head, reading},
								);
								lanes = lanes.map((l, j) => (j === i ? turn.lane : l));
								now = turn.tick;
								main = turn.main;
							}
							return {
								next: {...w0, lanes, main, tickets: {...w0.tickets, [ticket]: now}},
								landings,
							};
						});
					}
				}
			}
			// The owner may answer what waits on them, or never.
			for (const ask of openAsks(deskOf(tick.desk))) {
				if (ask.for !== "stuck") continue;
				for (const answer of [{kind: "keep_going" as const, rounds: 1}, {kind: "remove" as const}])
					world(
						{
							label: `${ticket} owner answers ${ask.id}: ${answer.kind}`,
							touches: [t],
							fair: null,
							go: () => {},
						},
						(w0) => ({
							next: {
								...w0,
								tickets: {
									...w0.tickets,
									[ticket]: {
										...tick,
										desk: [
											...tick.desk,
											{seq: tick.desk.length + 1, fact: {type: "answered", id: ask.id, answer}},
										],
									},
								},
							},
							landings: [],
						}),
					);
			}
		}
		if (w.outsider > 0)
			out.push({
				label: `someone else merges onto main ${w.main}`,
				lane: -1,
				touches: ["main"],
				fair: null,
				rare: false,
				next: {...w, main: w.main + 1, outsider: w.outsider - 1},
			});
		return out;
	};

	// The keys. Each lane and each ticket's part is hashed once per renaming and kept by object.
	const perms = PERMS[o.lanes] as readonly (readonly number[])[];
	const cache = new WeakMap<object, (string | undefined)[]>();
	const renamer = (perm: readonly number[]) => (text: string) =>
		text.replace(/\b([TL])([1-9])\b/g, (whole, kind: string, d: string) => {
			const i = Number(d) - 1;
			if (kind === "T" && o.tickets === "same") return whole;
			return `${kind}${(perm[i] ?? i) + 1}`;
		});
	const renames = perms.map(renamer);
	const partKey = (part: object, p: number): string => {
		let row = cache.get(part);
		if (row === undefined) {
			row = [];
			cache.set(part, row);
		}
		let k = row[p];
		if (k === undefined) {
			k = digest((renames[p] as (s: string) => string)(structuralHash(part)));
			row[p] = k;
		}
		return k;
	};
	const keyUnder = (w: Lanes, p: number): string => {
		const perm = perms[p] as readonly number[];
		const rename = renames[p] as (s: string) => string;
		const slots: string[] = new Array(w.lanes.length);
		w.lanes.forEach((lane, i) => {
			slots[perm[i] as number] = partKey(lane, p);
		});
		const ticks = Object.entries(w.tickets)
			.map(([name, tick]) => `${rename(name)}=${partKey(tick, p)}`)
			.sort();
		return `${slots.join(",")}|${ticks.join(",")}|${w.main}|${w.outsider}`;
	};

	return {
		init,
		lanes: o.lanes,
		moves,
		key: (w) => keyUnder(w, 0),
		canon: (w) => {
			let best = keyUnder(w, 0);
			for (let p = 1; p < perms.length; p++) {
				const k = keyUnder(w, p);
				if (k < best) best = k;
			}
			return best;
		},
		mine: (lane, part) =>
			part === lanePart(lane) || (part.startsWith("ticket:") && ownerOf(part.slice(7)) === lane),
		// What a law across lanes reads of a lane: whether it works its ticket. Only
		// a ticket another lane shares makes that matter; on a ticket of its own a
		// lane is read only by laws about that lane alone, or about main, which no
		// reduced step touches.
		face: (w, lane) => {
			const l = w.lanes[lane] as Lane;
			if (ownerOf(l.ticket) === lane) return "";
			return `${l.host}|${l.loop.phase === "over" ? nameOf(l.loop.outcome) : "on"}`;
		},
		ended: (w, lane) => {
			const l = w.lanes[lane] as Lane;
			return l.host === "refused" || l.loop.phase === "over";
		},
	};
}

/** The options a law run is named by, in a few words. */
export const describeLanes = (o: LanesOptions): string =>
	[
		`${o.lanes} lane${o.lanes === 1 ? "" : "s"}`,
		o.tickets === "same" ? "one ticket" : "own tickets",
		o.queue ? "queue" : "no queue",
		`cap ${o.cap}`,
		`forms ${o.forms.join("/")}`,
		...(o.red ? ["red CI"] : []),
		...(o.flaky ? ["flaky CI"] : []),
		...(o.clocks === false ? ["no clocks"] : []),
		...(o.errors ? ["errors"] : []),
		...((o.restarts ?? 0) > 0 ? [`${o.restarts} restart(s)`] : []),
		...(o.claim !== undefined && o.claim !== "none" ? [`claim ${o.claim}`] : []),
		...(o.desk ? ["desk"] : []),
		...((o.outsider ?? 0) > 0 ? [`outsider ${o.outsider}`] : []),
		...(o.idle ? ["idle builder"] : []),
		...(o.upToDate ? ["up to date"] : []),
		...(o.eject ? ["eject"] : []),
	].join(", ");
