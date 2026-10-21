import {applyCell} from "@demlik/tea";
import {describe, expect, it} from "vitest";
import type {Entry, Fact} from "../../asks/ledger.ts";
import {foldLedger, openAsks, planAskId, problemWith} from "../../asks/rules.ts";
import {askId, criterionId, planOf, taskId, ticketId} from "../../ids.ts";
import {type PlanDraft, revisionOfDraft} from "../plan/plan.ts";
import {
	jobFor,
	kidOf,
	kindOf,
	type Lane,
	type LaneCmd,
	type LaneJob,
	lane,
	notePlan,
	prBody,
	readLane,
	startKid,
} from "./machine.ts";
import {type LaneAt, type LaneView, laneViewOf, next, START} from "./view.ts";

// A plan's lane, pure: what `next` picks from what it reads, the view the facts fold to, and the
// machine one step at a time. The run on tea-host, with its children, is experiment 105.

const TICKET = ticketId("example/repo#700");
const PLAN = planOf(TICKET);
const FOLD = ticketId("example/repo#707");
const T1 = taskId("t1");
const T2 = taskId("t2");

const claim = (when: string, result: string) => ({
	when,
	result,
	check: {how: "test" as const, what: "a test runs it"},
	serves: ["mover"] as const,
});
const job = (when: string, result: string) => ({
	...claim(when, result),
	fixture: "three files in two packages, moved twice",
});

const DRAFT: PlanDraft = {
	summary: "Moving a file into another package works.",
	stories: [
		{
			id: "mover",
			who: "someone who moves files",
			want: "to move across packages",
			why: "to split code",
		},
	],
	tasks: [
		{
			title: "Refuse a crossing move",
			ends: "pr",
			job: job("a row crosses a package line", "the move is refused and says why"),
			criteria: [claim("the row stays inside one package", "the move goes ahead")],
		},
		{
			title: "Rewrite imports across packages",
			ends: "pr",
			job: job("a file moves into another package", "its importers import it through the package"),
			criteria: [],
		},
	],
	goal: {
		job: job("every file of a folder moves", "the workspace builds and its tests pass"),
		criteria: [],
	},
	pointers: [],
	questions: [],
};

const ledger = (facts: readonly Fact[]): Entry[] => facts.map((fact, i) => ({seq: i + 1, fact}));
const planned = (tickets = [TICKET]): Fact => ({
	type: "planned",
	plan: PLAN,
	tickets,
	data: revisionOfDraft(DRAFT)!,
	problems: [],
});
const approve = (version: number): Fact => ({
	type: "answered",
	id: planAskId(PLAN, version),
	answer: {kind: "approve"},
});
const judged = (
	task: "t1" | "t2" | "plan",
	head: string,
	rows: [string, "pass" | "fail"][],
): Fact => ({
	type: "judged",
	plan: PLAN,
	task: task === "plan" ? "plan" : taskId(task),
	head,
	proof: "a scripted review",
	rows: rows.map(([c, grade]) => ({
		criterion: criterionId(c),
		version: 1,
		head,
		grade,
		proof: "read",
	})),
	found: [],
});

const NOW = {head: "h1", behind: false, pr: null};

const view = (patch: Partial<LaneView> = {}): LaneView => ({
	approved: true,
	closed: false,
	waiting: [],
	tasks: [
		{task: T1, settled: true, open: []},
		{task: T2, settled: true, open: []},
	],
	removed: [],
	planOpen: [],
	planTodo: [],
	head: "h1",
	behind: false,
	met: true,
	pr: null,
	tickets: [TICKET],
	version: 1,
	folds: [],
	title: "Refuse a crossing move",
	summary: "Moving a file into another package works.",
	...patch,
});

const OPEN_ITEM = {
	criterion: criterionId("c2"),
	text: "x",
	says: "Failed: y.",
	where: [],
	wants: [],
};

describe("the next step", () => {
	it("goes in the order the plan needs: owner, fold, drop, a task not done, open, ship", () => {
		const at: LaneAt = START;
		expect(next(at, view({pr: {url: "pr", state: "merged", head: "m"}}))).toEqual({
			go: "done",
			pr: "pr",
			head: "m",
		});
		expect(next(at, view({closed: true}))).toEqual({go: "skip", why: "closed"});
		expect(next(at, view({waiting: ["plan:x@2"], folds: [FOLD]}))).toEqual({
			go: "wait",
			asks: ["plan:x@2"],
		});
		expect(next(at, view({approved: false, version: 0, tasks: []}))).toEqual({
			go: "plan",
			version: 1,
			folds: [],
		});
		expect(next(at, view({approved: false, version: 1})).go).toBe("stuck");
		expect(next(at, view({folds: [FOLD], removed: [T2]}))).toEqual({
			go: "plan",
			version: 2,
			folds: [FOLD],
		});
		expect(next(at, view({removed: [T2]}))).toEqual({go: "drop", task: T2});
		expect(next({...at, dropped: [T2]}, view({removed: [T2]})).go).toBe("open");
		// The owner took every task out: the lane ends, it does not review an empty change.
		expect(next({...at, dropped: [T1, T2]}, view({removed: [T1, T2], tasks: []}))).toEqual({
			go: "skip",
			why: "emptied",
		});
		const unsettled = view({tasks: [{task: T1, settled: false, open: [OPEN_ITEM]}], met: false});
		expect(next({...at, rounds: {t1: 2}}, unsettled)).toEqual({
			go: "round",
			task: T1,
			round: 3,
			open: [OPEN_ITEM],
			fix: false,
		});
		expect(next(at, view())).toEqual({go: "open"});
		const opened = view({pr: {url: "pr", state: "open", head: "h1"}});
		expect(next(at, opened)).toEqual({go: "ship", pr: "pr", run: 1});
	});

	it("tells the last task's rounds the plan's own criteria not passed yet, and no other task's", () => {
		const goal = {...OPEN_ITEM, criterion: criterionId("c9"), says: "Not judged yet."};
		const both = (settled: boolean) =>
			view({
				met: false,
				planTodo: [goal],
				tasks: [
					{task: T1, settled, open: []},
					{task: T2, settled: false, open: [OPEN_ITEM]},
				],
			});
		expect(next(START, both(false))).toMatchObject({go: "round", task: T1, open: []});
		expect(next(START, both(true))).toMatchObject({
			go: "round",
			task: T2,
			open: [OPEN_ITEM, goal],
			fix: false,
		});
	});

	it("a met head behind main is caught up by a last review, not opened", () => {
		expect(next(START, view({behind: true}))).toEqual({go: "final", round: 1});
	});

	it("a plan criterion the last review failed sends one round to the last task, once per final", () => {
		const short = view({met: false, planOpen: [OPEN_ITEM]});
		const at: LaneAt = {...START, rounds: {t2: 1}, finals: 1};
		expect(next(at, short)).toEqual({
			go: "round",
			task: T2,
			round: 2,
			open: [OPEN_ITEM],
			fix: true,
		});
		expect(next({...at, fixedAt: 1}, short)).toEqual({go: "final", round: 2});
	});

	it("has no cap: round 40, the 20th last review and the 20th ship run start like the first", () => {
		const unsettled = view({tasks: [{task: T1, settled: false, open: []}], met: false});
		expect(next({...START, rounds: {t1: 39}}, unsettled)).toMatchObject({go: "round", round: 40});
		expect(next({...START, finals: 19, fixedAt: 19}, view({met: false}))).toEqual({
			go: "final",
			round: 20,
		});
		const opened = view({pr: {url: "pr", state: "open", head: "h1"}});
		expect(next({...START, ships: 19}, opened)).toEqual({go: "ship", pr: "pr", run: 20});
		// What stops a list that no longer shrinks is the owner's ask the desk raised: the lane waits.
		expect(next({...START, finals: 3}, view({met: false, waiting: ["stuck:x/plan/1"]}))).toEqual({
			go: "wait",
			asks: ["stuck:x/plan/1"],
		});
	});
});

describe("the lane's view, from the facts", () => {
	it("a ticket folded in after approval is planned again, and the new version waits on the owner", () => {
		const facts: Fact[] = [planned(), approve(1)];
		const before = laneViewOf(foldLedger(ledger(facts)), PLAN, NOW);
		expect(before).toMatchObject({approved: true, version: 1, folds: [], waiting: []});
		expect(before.tasks.map((t) => [t.task, t.settled])).toEqual([
			["t1", false],
			["t2", false],
		]);
		facts.push({type: "folded", plan: PLAN, ticket: FOLD});
		const folded = laneViewOf(foldLedger(ledger(facts)), PLAN, NOW);
		expect(folded).toMatchObject({version: 1, folds: [FOLD], tickets: [TICKET, FOLD]});
		expect(next(START, folded)).toEqual({go: "plan", version: 2, folds: [FOLD]});
		facts.push(planned([FOLD]));
		const v2 = laneViewOf(foldLedger(ledger(facts)), PLAN, NOW);
		expect(v2).toMatchObject({version: 2, folds: [], waiting: [planAskId(PLAN, 2)]});
		expect(openAsks(foldLedger(ledger(facts))).map((a) => a.id)).toEqual([planAskId(PLAN, 2)]);
	});

	it("met only when every live criterion passed at the head the lane reads", () => {
		const facts: Fact[] = [
			planned(),
			approve(1),
			judged("t1", "h1", [
				["c1", "pass"],
				["c2", "pass"],
			]),
			judged("t2", "h1", [["c3", "pass"]]),
		];
		const short = laneViewOf(foldLedger(ledger(facts)), PLAN, NOW);
		expect(short.tasks.every((t) => t.settled)).toBe(true);
		expect(short.met).toBe(false);
		expect(next(START, short)).toEqual({go: "final", round: 1});
		facts.push(
			judged("plan", "h2", [
				["c1", "pass"],
				["c2", "pass"],
				["c3", "pass"],
				["c4", "pass"],
			]),
		);
		expect(laneViewOf(foldLedger(ledger(facts)), PLAN, {...NOW, head: "h2"}).met).toBe(true);
		expect(laneViewOf(foldLedger(ledger(facts)), PLAN, {...NOW, head: "h3"}).met).toBe(false);
	});

	it("a plan's list that stops shrinking is the owner's stuck ask, on the whole book, and no task to remove", () => {
		const reviewed = (open: number): Fact => ({type: "reviewed", plan: PLAN, task: "plan", open});
		const facts: Fact[] = [planned(), approve(1), reviewed(2), reviewed(2)];
		// One stall earns one more last review.
		expect(laneViewOf(foldLedger(ledger(facts)), PLAN, NOW).waiting).toEqual([]);
		facts.push(reviewed(2));
		const state = foldLedger(ledger(facts));
		const id = askId(`stuck:${PLAN}/plan/1`);
		expect(laneViewOf(state, PLAN, NOW).waiting).toEqual([id]);
		const ask = state.asks.get(id);
		expect(ask).toMatchObject({for: "stuck", task: "plan", why: "no_progress", open: [2, 2, 2]});
		expect(ask?.for === "stuck" && ask.criteria.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4"]);
		expect(problemWith(state, {id, answer: {kind: "remove"}})).toMatch(/no task to remove/);
		expect(problemWith(state, {id, answer: {kind: "keep_going", rounds: 2}})).toBeNull();
	});

	it("a final that reopens a task's criterion sends the lane back to that task", () => {
		const facts: Fact[] = [
			planned(),
			approve(1),
			judged("t1", "h1", [
				["c1", "pass"],
				["c2", "pass"],
			]),
			judged("t2", "h1", [["c3", "pass"]]),
			judged("plan", "h2", [
				["c1", "pass"],
				["c2", "pass"],
				["c3", "fail"],
				["c4", "pass"],
			]),
		];
		const v = laneViewOf(foldLedger(ledger(facts)), PLAN, {...NOW, head: "h2"});
		expect(next({...START, rounds: {t1: 1, t2: 1}, finals: 1}, v)).toMatchObject({
			go: "round",
			task: "t2",
			round: 2,
			fix: false,
		});
	});
});

type AnyMsg = {readonly type: string; readonly [field: string]: unknown};
const step = (s: Lane, msg: AnyMsg) => applyCell<Lane, AnyMsg, LaneCmd>(lane, s, msg);
const JOB: LaneJob = {
	plan: PLAN,
	settings: {model: "haiku", effort: "low", budget: 1},
	usd: 1,
	rubrics: "rubrics",
	at: 1_000,
};

describe("the lane machine", () => {
	const reading = () => {
		const [s, [cmd]] = step({phase: "idle"}, {type: "start", lane: "lane:700", job: JOB});
		expect(cmd).toMatchObject({type: readLane.cmdType});
		return {s, cmd: cmd!};
	};

	it("a fold: one plan child, then its draft as the next version, then a fresh read", () => {
		const {s, cmd} = reading();
		const [starting, [start]] = step(s, {
			type: readLane.okType,
			cmd,
			value: view({folds: [FOLD]}),
		});
		expect(start).toMatchObject({
			type: startKid.cmdType,
			kid: "lane:700:v2:plan",
			job: {ticket: "https://github.com/example/repo/issues/700", tries: 2},
		});
		expect(kindOf("lane:700:v2:plan")).toBe("plan");
		const [running] = step(starting, {type: startKid.okType, cmd: start, value: {started: true}});
		expect(running).toMatchObject({phase: "running", kid: "lane:700:v2:plan"});
		const [planning, [planned]] = step(running, {
			type: "kid_over",
			kid: "lane:700:v2:plan",
			end: {outcome: {kind: "done"}},
		});
		expect(planned).toMatchObject({
			type: notePlan.cmdType,
			plan: PLAN,
			kid: "lane:700:v2:plan",
			folds: [FOLD],
		});
		const [again, [read]] = step(planning, {type: notePlan.okType, cmd: planned, value: {}});
		expect(again.phase).toBe("reading");
		expect(read).toMatchObject({type: readLane.cmdType});
		const [stuck] = step(planning, {
			type: notePlan.errType,
			cmd: planned,
			error: {_tag: "no_plan"},
		});
		expect(stuck).toMatchObject({phase: "over", outcome: {kind: "stuck", why: "plan_failed"}});
	});

	it("a round is catch-up, build, review, each at the head the one before left", () => {
		const {s, cmd} = reading();
		const unsettled = view({tasks: [{task: T1, settled: false, open: []}], met: false, head: null});
		const [s1, [c1]] = step(s, {type: readLane.okType, cmd, value: unsettled});
		expect(c1).toMatchObject({kid: "lane:700:t1:r1:catchup", job: {plan: PLAN, drop: null}});
		const [r1] = step(s1, {type: startKid.okType, cmd: c1, value: {started: true}});
		const [s2, [c2]] = step(r1, {
			type: "kid_over",
			kid: "lane:700:t1:r1:catchup",
			end: {outcome: {kind: "done"}, head: "m1"},
		});
		expect(c2).toMatchObject({kid: "lane:700:t1:r1:build", job: {task: T1, round: 1}});
		const [r2] = step(s2, {type: startKid.okType, cmd: c2, value: {started: true}});
		const [s3, [c3]] = step(r2, {
			type: "kid_over",
			kid: "lane:700:t1:r1:build",
			end: {outcome: {kind: "done"}, head: "b1"},
		});
		expect(c3).toMatchObject({kid: "lane:700:t1:r1:review", job: {task: T1, head: "b1"}});
		const [r3] = step(s3, {type: startKid.okType, cmd: c3, value: {started: true}});
		const [noting, [note]] = step(r3, {
			type: "kid_over",
			kid: "lane:700:t1:r1:review",
			end: {outcome: {kind: "send"}, open: [OPEN_ITEM, OPEN_ITEM]},
		});
		expect(noting.phase).toBe("noting");
		expect(note).toMatchObject({task: T1, kid: "lane:700:t1:r1:review", open: 2});
		// A review that could not see a criterion met is a round with work open, for the stall rule.
		const [unseen, [seen]] = step(r3, {
			type: "kid_over",
			kid: "lane:700:t1:r1:review",
			end: {outcome: {kind: "stuck", why: "unseen"}, open: [OPEN_ITEM]},
		});
		expect(unseen.phase).toBe("noting");
		expect(seen).toMatchObject({task: T1, kid: "lane:700:t1:r1:review", open: 1});
		// Any other stuck review stops the lane.
		const [over] = step(r3, {
			type: "kid_over",
			kid: "lane:700:t1:r1:review",
			end: {outcome: {kind: "stuck", why: "draft_failed"}},
		});
		expect(over).toMatchObject({phase: "over", outcome: {kind: "stuck", why: "review_failed"}});
	});

	it("a last review that did not pass, and a ship run that did not merge, count in the plan's list", () => {
		const {s, cmd} = reading();
		const running = (value: LaneView, kid: string) => {
			const [s1, [c1]] = step(s, {type: readLane.okType, cmd, value});
			const [r1] = step(s1, {type: startKid.okType, cmd: c1, value: {started: true}});
			if (!kid.endsWith(":catchup")) return r1;
			const [s2, [c2]] = step(r1, {type: "kid_over", kid, end: {outcome: {kind: "done"}}});
			return step(s2, {type: startKid.okType, cmd: c2, value: {started: true}})[0];
		};
		const final = running(view({met: false}), "lane:700:final:r1:catchup");
		expect(final).toMatchObject({phase: "running", kid: "lane:700:final:r1:review"});
		const failed = step(final, {
			type: "kid_over",
			kid: "lane:700:final:r1:review",
			end: {outcome: {kind: "send"}, open: [OPEN_ITEM, OPEN_ITEM, OPEN_ITEM]},
		})[1];
		expect(failed).toMatchObject([
			{type: "lane_note", task: "plan", kid: "lane:700:final:r1:review", open: 3},
		]);
		// A pass is no count of its own: the ship run after it is.
		const passed = step(final, {
			type: "kid_over",
			kid: "lane:700:final:r1:review",
			end: {outcome: {kind: "done"}, head: "h2"},
		})[1];
		expect(passed).toMatchObject([{type: readLane.cmdType}]);
		const ship = running(view({pr: {url: "pr", state: "open", head: "h1"}}), "lane:700:s1:ship");
		const sent = step(ship, {
			type: "kid_over",
			kid: "lane:700:s1:ship",
			end: {outcome: {kind: "send", why: "checks_red"}},
		})[1];
		expect(sent).toMatchObject([
			{type: "lane_note", task: "plan", kid: "lane:700:s1:ship", open: 1},
		]);
		const merged = step(ship, {
			type: "kid_over",
			kid: "lane:700:s1:ship",
			end: {outcome: {kind: "done"}},
		})[1];
		expect(merged).toMatchObject([{type: readLane.cmdType}]);
	});

	it("a child stuck stops the lane and names it; a child's end for another name is not this one's", () => {
		const {s, cmd} = reading();
		const [s1, [c1]] = step(s, {type: readLane.okType, cmd, value: view({removed: [T2]})});
		expect(c1).toMatchObject({kid: "lane:700:t2:drop:catchup", job: {drop: T2}});
		const [r1] = step(s1, {type: startKid.okType, cmd: c1, value: {started: true}});
		expect(
			step(r1, {type: "kid_over", kid: "lane:700:t1:r1:build", end: {outcome: {kind: "stuck"}}})[0],
		).toBe(r1);
		const [over] = step(r1, {
			type: "kid_over",
			kid: "lane:700:t2:drop:catchup",
			end: {outcome: {kind: "stuck", why: "conflict"}},
		});
		expect(over).toMatchObject({
			phase: "over",
			outcome: {kind: "stuck", why: "catchup_failed"},
			report: {problems: ["lane:700:t2:drop:catchup: conflict"]},
		});
	});

	it("taken over mid-step, it asks the same thing again", () => {
		const {s, cmd} = reading();
		const [starting, [start]] = step(s, {type: readLane.okType, cmd, value: view()});
		expect(starting.phase).toBe("opening");
		const [same, [again]] = step(starting, {type: "resume"});
		expect(same).toBe(starting);
		expect(again).toEqual(start);
	});

	it("names each child from the lane's counts, and the pull request closes every ticket", () => {
		expect(kidOf("lane:700", {flow: "final", round: 2, step: "review", head: "h"})).toBe(
			"lane:700:final:r2:review",
		);
		expect(kidOf("lane:700", {flow: "ship", run: 1, pr: "p"})).toBe("lane:700:s1:ship");
		expect(jobFor("lane:700", JOB, {flow: "ship", run: 1, pr: "p"})).toEqual({pr: "p"});
		expect(prBody(view({tickets: [TICKET, FOLD]}))).toBe(
			"Moving a file into another package works.\n\nCloses #700\nCloses #707",
		);
	});
});
