import {structuralHash} from "@demlik/tea";
import type {Entry} from "../asks/ledger.ts";
import {asksOnStall, foldLedger, openAsks, planAskId} from "../asks/rules.ts";
import {criterionId, type Owner, PLAN, planOf, storyId, taskId, ticketId} from "../ids.ts";
import type {Item} from "../stages/build/ticket.ts";
import {
	type ChildEnd,
	type Flow,
	type Lane,
	type LaneCmd,
	type LaneJob,
	lane,
	notePlan,
	noteRound,
	openPr,
	readLane,
	startChild,
} from "../stages/lane/machine.ts";
import type {LaneView} from "../stages/lane/view.ts";
import type {Revision} from "../stages/plan/plan.ts";
import {closes} from "./build.ts";
import {
	Broke,
	broke,
	type Law,
	law,
	type MsgOf,
	type Step,
	stepOf,
	type Update,
	type Watch,
	type World,
	watched,
} from "./explore.ts";

// A plan's lane under every order of messages: its world and its laws.
//
// The lane runs no agent, so its world is what it reads and what its children hand back. A read
// may find no plan yet, an open ask, a closed plan, a removed task, a task not done, every task
// done and met, or met with main moved on, or the pull request merged. A child may end done,
// sent back with work open, stuck (a review's `unseen` among the whys), or skipped, and a late end
// of another child may come at any time. Each write may be answered or refused, and the owner may
// move. A restart may come at any time.
//
// There is no cap (docs/direction/done-is-per-criterion.md): only the stall rule stops a loop, and
// the desk runs it on what the lane counts. So the lane's laws here are that it counts every review
// and every ship run that did not merge, and that no count of its own ever ends it. The stall rule
// itself is the asks core's, walked in ../asks/rules.test.ts. Whether the two, wired together, ask
// the owner at the right round, and only then, is the desk run below (`withTheDesk`), with its own
// laws (`deskLaws`): a read there is the plan's view folded from the lane's own counts.

export type AnyLaneMsg = MsgOf<typeof lane>;
type Msg = AnyLaneMsg;
const laneUpdate = stepOf<Lane, Msg, LaneCmd>(lane);

const TICKET = ticketId("o/r#7");
const PLAN_ID = planOf(TICKET);
const LANE = "lane:7";
const T1 = taskId("t1");
const T2 = taskId("t2");
const JOB: LaneJob = {
	plan: PLAN_ID,
	settings: {model: "m", effort: "low", budget: 1},
	usd: 1,
	rubrics: "r",
	at: 0,
};
const OPEN: Item = {
	criterion: criterionId("c1"),
	text: "every window opens",
	says: "Failed.",
	where: [],
	wants: [],
};

const view = (patch: Partial<LaneView> = {}): LaneView => ({
	approved: true,
	closed: false,
	waiting: [],
	tasks: [{task: T1, settled: true, open: []}],
	removed: [],
	planOpen: [],
	planTodo: [],
	head: "H",
	behind: false,
	met: true,
	pr: null,
	tickets: ["o/r#7", "o/r#9"],
	version: 1,
	folds: [],
	title: "windows",
	// The planner's words: a closing word in them must never reach the pull request.
	summary: "Opens the windows. Fixes #2.",
	...patch,
});

/** What a read may find, by a short name. */
export const VIEWS: Readonly<Record<string, LaneView>> = {
	"no plan yet": view({approved: false, version: 0, tasks: []}),
	"an open ask": view({waiting: ["plan:o/r#7@2"]}),
	closed: view({closed: true}),
	"a task not done": view({tasks: [{task: T1, settled: false, open: [OPEN]}], met: false}),
	"t2 removed": view({removed: [T2]}),
	met: view(),
	"met, main moved": view({behind: true, met: true}),
	"met, pull request open": view({pr: {url: "P", state: "open", head: "H"}}),
	"not met": view({met: false}),
	merged: view({pr: {url: "P", state: "merged", head: "H"}}),
};

/** How a child may end, by a short name. */
export const ENDS: Readonly<Record<string, ChildEnd>> = {
	done: {outcome: {kind: "done"}, head: "H2"},
	"sent back": {outcome: {kind: "send", why: "review_failed"}, open: [OPEN]},
	unseen: {outcome: {kind: "stuck", why: "unseen"}},
	stuck: {outcome: {kind: "stuck", why: "draft_failed"}},
	skipped: {outcome: {kind: "skip", why: "up_to_date"}},
};

const UNKNOWN = {_tag: "unknown" as const};
const STRAY = `${LANE}:t9:r1:build`;

/**
 * The lane's world. `views`: the reads it may find, by name (every one by default). A world of one
 * read reaches a whole round, catch-up to the noted review, in a short search.
 */
export function laneWorld(
	options: {readonly views?: readonly (keyof typeof VIEWS)[]} = {},
): World<Lane, Msg, LaneCmd> {
	const views = (options.views ?? Object.keys(VIEWS)).flatMap((name) => VIEWS[name] ?? []);
	return {
		outside: (s) => {
			const children = [...new Set([...(s.phase === "running" ? [s.child] : []), STRAY])];
			return [
				{type: "start", lane: LANE, job: JOB},
				{type: "resume"},
				{type: "owner_moved"},
				...children.flatMap((child) =>
					Object.values(ENDS).map((end): Msg => ({type: "child_over", child, end})),
				),
			];
		},
		answers: (cmd): readonly Msg[] => {
			switch (cmd.type) {
				case "lane_read":
					return [...views.map((v) => readLane.ok(cmd, v, 0)), readLane.err(cmd, UNKNOWN, 0)];
				case "lane_start":
					return [startChild.ok(cmd, {started: true}, 0), startChild.err(cmd, UNKNOWN, 0)];
				case "lane_note":
					return [noteRound.ok(cmd, {}, 0), noteRound.err(cmd, UNKNOWN, 0)];
				case "lane_open":
					return [openPr.ok(cmd, {url: "P"}, 0), openPr.err(cmd, UNKNOWN, 0)];
				case "lane_planned":
					return [
						notePlan.ok(cmd, {}, 0),
						notePlan.err(cmd, {_tag: "no_plan"}, 0),
						notePlan.err(cmd, UNKNOWN, 0),
					];
			}
		},
		restart: (msg) => msg.type === "resume",
	};
}

const numbers = (tickets: readonly string[]) =>
	tickets.map((t) => `#${t.slice(t.indexOf("#") + 1)}`).sort();

/** The last view read along a path, and every child started: its name, and its job's hash. */
type Seen = {
	readonly view: LaneView | null;
	readonly started: readonly (readonly [string, string])[];
};

const viewAfter = (seen: Seen, prev: Lane, msg: Msg): LaneView | null =>
	prev.phase === "reading" && msg.type === "lane_read_ok" ? msg.value : seen.view;

/**
 * What the stall rule counts for a child's end, and in which list. `null`: nothing. A task's review
 * counts what it left open, 0 when it passed. A last review that did not pass counts what it left
 * open, in the whole plan's list; one that passed is no count of its own. A ship run that did not
 * merge counts 1 there. A review that could not see a criterion met (`unseen`) left at least one
 * open. Any other stuck end, and a task's review skipped, stop the lane: nothing is counted.
 */
function countOf(f: Flow, end: ChildEnd): {readonly task: Owner; readonly open: number} | null {
	const {kind, why} = end.outcome;
	const review = (f.flow === "round" || f.flow === "final") && f.step === "review";
	if (kind === "stuck" && !(review && why === "unseen")) return null;
	const open = Math.max(1, end.open?.length ?? 1);
	if (f.flow === "round" && f.step === "review")
		return kind === "skip" ? null : {task: f.task, open: kind === "done" ? 0 : open};
	if (f.flow === "final" && f.step === "review") return kind === "done" ? null : {task: PLAN, open};
	if (f.flow === "ship") return kind === "done" ? null : {task: PLAN, open: 1};
	return null;
}

/** The running child's end, when this step took it: its flow and how it ended. */
const endTaken = (
	prev: Lane,
	msg: Msg,
): {readonly child: string; readonly flow: Flow; readonly end: ChildEnd} | null =>
	prev.phase === "running" && msg.type === "child_over" && msg.child === prev.child
		? {child: msg.child, flow: prev.flow, end: msg.end}
		: null;

/** A read the lane may end on: the pull request merged, the plan closed or emptied, or unreadable. */
const endsOn = (v: LaneView): boolean =>
	v.pr?.state === "merged" ||
	v.closed ||
	(v.approved && v.tasks.length === 0) ||
	(!v.approved && v.version > 0);

export function laneLaws<S extends Lane>(): readonly Law<S, Msg, LaneCmd>[] {
	return [
		// A name started again is how a lane taken over finds its child: the one already there is
		// the one. So a name must always mean the same job, or the child found is the wrong work.
		watched<S, Msg, LaneCmd, Seen>(
			"a child's name always means the same job",
			{view: null, started: []},
			(seen, {prev, msg, cmds}) => {
				const started = [...seen.started];
				for (const c of cmds) {
					if (c.type !== "lane_start") continue;
					const job = structuralHash(c.job);
					const before = started.find(([child]) => child === c.child);
					if (before === undefined) started.push([c.child, job]);
					else if (before[1] !== job) return broke(`${c.child} started again with another job`);
				}
				return {view: viewAfter(seen, prev, msg), started};
			},
		),
		watched<S, Msg, LaneCmd, Seen>(
			"no work starts while the owner has an ask open or the plan is closed",
			{view: null, started: []},
			(seen, {prev, msg, cmds}) => {
				const v = viewAfter(seen, prev, msg);
				const work = cmds.some((c) => c.type === "lane_start" || c.type === "lane_open");
				if (work && msg.type !== "resume" && v !== null && (v.waiting.length > 0 || v.closed))
					return broke("work started on a read with the owner's ask open");
				return {view: v, started: seen.started};
			},
		),
		watched<S, Msg, LaneCmd, Seen>(
			"the pull request opens only at a met head that has main in, and closes exactly the plan's tickets",
			{view: null, started: []},
			(seen, {prev, msg, cmds}) => {
				const v = viewAfter(seen, prev, msg);
				for (const c of cmds) {
					if (c.type !== "lane_open") continue;
					if (v === null) return broke("opened before any read");
					if (!v.met || v.behind || c.head !== v.head)
						return broke(`opened at ${c.head}: met ${v.met}, behind ${v.behind}, head ${v.head}`);
					const named = closes(c.body);
					if (structuralHash(named) !== structuralHash(numbers(v.tickets)))
						return broke(
							`the text closes ${named.join(", ")}, the plan covers ${numbers(v.tickets).join(", ")}`,
						);
				}
				return {view: v, started: seen.started};
			},
		),
		watched<S, Msg, LaneCmd, Seen>(
			"the lane ends done only on its pull request merged",
			{view: null, started: []},
			(seen, {prev, msg, next}) => {
				const v = viewAfter(seen, prev, msg);
				if (next.phase === "over" && prev.phase !== "over" && next.outcome.kind === "done")
					if (v?.pr?.state !== "merged") return broke("done with no merged pull request");
				return {view: v, started: seen.started};
			},
		),
		law<S, Msg, LaneCmd>("a child's end counts only for the child running", ({prev, msg, next}) =>
			msg.type === "child_over" &&
			!(prev.phase === "running" && prev.child === msg.child) &&
			structuralHash(prev) !== structuralHash(next)
				? `${msg.child}'s end was taken while ${prev.phase === "running" ? prev.child : "no child"} ran`
				: null,
		),
		law<S, Msg, LaneCmd>(
			"every review, and every ship run that did not merge, is counted for the stall rule with what it left open",
			({prev, msg, cmds}) => {
				const taken = endTaken(prev, msg);
				if (taken === null) return null;
				const want = countOf(taken.flow, taken.end);
				const notes = cmds.flatMap((c) =>
					c.type === "lane_note" ? [{task: c.task, open: c.open}] : [],
				);
				const said = notes.map((n) => `${n.open} in ${n.task}`).join(", ") || "nothing";
				if (want === null) return notes.length === 0 ? null : `${taken.child}: counted ${said}`;
				return notes.length === 1 && notes[0]?.task === want.task && notes[0].open === want.open
					? null
					: `${taken.child} left ${want.open} open in ${want.task}, and the lane counted ${said}`;
			},
		),
		law<S, Msg, LaneCmd>(
			"no count of the lane's own ends it: only a read, a child stuck or a failed write does",
			({prev, msg, next}) => {
				if (next.phase !== "over" || prev.phase === "over") return null;
				if (msg.type === "lane_read_ok" && endsOn(msg.value)) return null;
				if (msg.type === "child_over" && msg.end.outcome.kind !== "done") return null;
				if (msg.type.endsWith("_err")) return null;
				return `the lane ended ${next.outcome.kind}:${"why" in next.outcome ? next.outcome.why : ""} on ${msg.type}, with work left`;
			},
		),
		law<S, Msg, LaneCmd>("an ended lane sends nothing", ({prev, cmds}) =>
			prev.phase === "over" && cmds.length > 0
				? `${cmds.map((c) => c.type).join(", ")} after the lane ended`
				: null,
		),
	];
}

export const laneInit: Lane = {phase: "idle"};
export const laneStep: Update<Lane, Msg, LaneCmd> = laneUpdate;

const nameIn = <T>(table: Readonly<Record<string, T>>, value: T) =>
	Object.entries(table).find(([, v]) => structuralHash(v) === structuralHash(value))?.[0] ?? "?";

export function showLaneMsg(m: Msg): string {
	switch (m.type) {
		case "lane_read_ok":
			return `read: ${nameIn(VIEWS, m.value)}`;
		case "child_over":
			return `${m.child}: ${nameIn(ENDS, m.end)}`;
		case "lane_start_ok":
			return `${m.cmd.child} started`;
		case "resume":
			return "restart, then resume";
		default:
			return m.type;
	}
}

// ---------------------------------------------------------------- the lane and the desk

/** What a desk run's children hand back, list by list. Each list ends in a pass or a merge. */
export interface Script {
	/** What t1's reviews leave open, round by round, before one passes. */
	readonly task?: readonly number[];
	/** What the last reviews leave open, one by one, before one passes. */
	readonly finals?: readonly number[];
	/** How many ship runs are sent back to the builder before one merges. */
	readonly ships?: number;
}

/** Where every list stands on a path: what each child's end counted, as `countOf` says, and the first list the stall rule asked on. */
type Lists = {
	readonly counts: Readonly<Record<string, readonly number[]>>;
	readonly asked: string | null;
};

const NO_LISTS: Lists = {counts: {}, asked: null};

const counted = <S extends Lane>(lists: Lists, step: Step<S, Msg, LaneCmd>): Lists => {
	const taken = endTaken(step.prev, step.msg);
	const c = taken === null ? null : countOf(taken.flow, taken.end);
	if (c === null) return lists;
	const list = [...(lists.counts[c.task] ?? []), c.open];
	const asked = lists.asked ?? (asksOnStall(list) ? `${c.task}'s list, ${list.join(", ")},` : null);
	return {counts: {...lists.counts, [c.task]: list}, asked};
};

const shownLists = (lists: Lists) =>
	Object.entries(lists.counts)
		.map(([task, list]) => `${task}: ${list.join(", ")}`)
		.join("; ");

/**
 * The laws of a lane wired to the desk. A list the stall rule asks the owner on stops the lane until
 * the owner answers; a list it does not ask on never stops it, however many rounds it took. Their
 * memory is the children's ends, not the lane's notes: a lane that counts wrong breaks them.
 */
export function deskLaws<S extends Lane>(): readonly Law<S, Msg, LaneCmd>[] {
	return [
		watched<S, Msg, LaneCmd, Lists>(
			"a list the stall rule asks the owner on starts no child until the owner answers",
			NO_LISTS,
			(before, step) => {
				const lists = counted(before, step);
				for (const c of step.cmds)
					if (c.type === "lane_start" && lists.asked !== null)
						return broke(`${lists.asked} asks the owner, and ${c.child} started`);
				return lists;
			},
		),
		watched<S, Msg, LaneCmd, Lists>(
			"a list that still shrinks never stops the lane: there is no cap",
			NO_LISTS,
			(before, step) => {
				const lists = counted(before, step);
				const {prev, next} = step;
				const stops =
					(next.phase === "waiting" && prev.phase !== "waiting") ||
					(next.phase === "over" && prev.phase !== "over" && next.outcome.kind !== "done");
				if (stops && lists.asked === null)
					return broke(
						`the lane stopped (${next.phase}) with every list still shrinking: ${shownLists(lists)}`,
					);
				return lists;
			},
		),
	];
}

/** The plan a desk run folds: one task, as a first version. */
const DESK_PLAN: Revision = {
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

/** What a child started counts as in a desk run: a task's round or a last review (by its review), or a ship run. */
const startedOf = (child: string): "round" | "final" | "ship" | null =>
	child.endsWith(":ship")
		? "ship"
		: !child.endsWith(":review")
			? null
			: child.includes(":final:")
				? "final"
				: "round";

/** How a desk run ended: the lane's last state, the laws it broke, what the lane counted, and the asks it waits on. */
export interface DeskRun {
	readonly state: Lane;
	readonly broken: readonly {readonly law: string; readonly why: string}[];
	/** What the lane counted, list by list, as the desk holds it. */
	readonly noted: Readonly<Record<string, readonly number[]>>;
	/** The asks the lane waits on at the end. Empty: it did not stop for the owner. */
	readonly waiting: readonly string[];
	/** Children started, by kind: `round`, `final`, `ship`. */
	readonly started: Readonly<Record<string, number>>;
}

/**
 * The lane wired to the desk, as on a host, on one path. Each read is the view of a plan whose t1
 * and last reviews and ship runs end as `script` says, and whose asks are the desk's: the asks core
 * folded over the plan and the lane's own `reviewed` notes. Every Cmd is answered ok, in order. The
 * run stops when the lane waits on the owner, ends, or takes `most` steps. Every law of the lane and
 * of the desk is walked along it.
 */
export function withTheDesk(
	update: Update<Lane, Msg, LaneCmd>,
	script: Script,
	most = 5_000,
): DeskRun {
	const {task = [], finals = [], ships = 0} = script;
	const entries: Entry[] = [
		{
			seq: 1,
			fact: {type: "planned", plan: PLAN_ID, tickets: [TICKET], data: DESK_PLAN, problems: []},
		},
		{seq: 2, fact: {type: "answered", id: planAskId(PLAN_ID, 1), answer: {kind: "approve"}}},
	];
	const at = {task: 0, finals: 0, ships: 0, settled: false, passed: finals.length === 0};
	let pr: LaneView["pr"] = null;
	const read = (): LaneView => {
		const waiting = openAsks(foldLedger(entries)).map((a) => a.id);
		return view({
			tasks: [{task: T1, settled: at.settled, open: at.settled ? [] : [OPEN]}],
			met: at.settled && at.passed,
			pr,
			waiting,
		});
	};
	const items = (n: number) => Array.from({length: n}, () => OPEN);
	const endOf = (f: Flow): ChildEnd => {
		if (f.flow === "ship") {
			if (at.ships < ships) {
				at.ships += 1;
				return {outcome: {kind: "send", why: "checks_red"}};
			}
			if (pr !== null) pr = {...pr, state: "merged"};
			return {outcome: {kind: "done"}};
		}
		if (f.flow === "drop" || f.flow === "plan" || f.step !== "review")
			return {outcome: {kind: "done"}, head: "H"};
		const list = f.flow === "round" ? task : finals;
		const i = f.flow === "round" ? at.task : at.finals;
		if (i < list.length) {
			if (f.flow === "round") at.task += 1;
			else at.finals += 1;
			return {outcome: {kind: "send", why: "review_failed"}, open: items(list[i] ?? 1)};
		}
		if (f.flow === "round") at.settled = true;
		else at.passed = true;
		return {outcome: {kind: "done"}, head: "H"};
	};
	const answer = (cmd: LaneCmd): Msg => {
		switch (cmd.type) {
			case "lane_read":
				return readLane.ok(cmd, read(), 0);
			case "lane_start":
				return startChild.ok(cmd, {started: true}, 0);
			case "lane_note":
				entries.push({
					seq: entries.length + 1,
					fact: {type: "reviewed", plan: cmd.plan, task: cmd.task, open: cmd.open},
				});
				return noteRound.ok(cmd, {}, 0);
			case "lane_open":
				pr = {url: "P", state: "open", head: "H"};
				return openPr.ok(cmd, {url: "P"}, 0);
			case "lane_planned":
				return notePlan.ok(cmd, {}, 0);
		}
	};
	const laws = [...laneLaws<Lane>(), ...deskLaws<Lane>()];
	let watches: (Watch<Lane, Msg, LaneCmd> | null)[] = laws.map((l) => l.begin());
	const broken: {law: string; why: string}[] = [];
	const started: Record<string, number> = {};
	let state: Lane = laneInit;
	const queue: Msg[] = [{type: "start", lane: LANE, job: JOB}];
	for (let n = 0; n < most; n++) {
		const msg =
			queue.shift() ??
			(state.phase === "running"
				? {type: "child_over", child: state.child, end: endOf(state.flow)}
				: null);
		if (msg === null) break;
		const [next, cmds] = update(state, msg);
		const step = {prev: state, msg, next, cmds};
		watches = watches.map((w, i) => {
			if (w === null) return null;
			const after = w.step(step);
			if (!(after instanceof Broke)) return after;
			broken.push({law: laws[i]?.name ?? "?", why: after.why});
			return null;
		});
		for (const c of cmds) {
			const kind = c.type === "lane_start" ? startedOf(c.child) : null;
			if (kind !== null) started[kind] = (started[kind] ?? 0) + 1;
			queue.push(answer(c));
		}
		state = next;
		if (state.phase === "waiting" || state.phase === "over") break;
	}
	const noted: Record<string, number[]> = {};
	for (const {fact} of entries)
		if (fact.type === "reviewed") noted[fact.task] = [...(noted[fact.task] ?? []), fact.open];
	return {
		state,
		broken,
		noted,
		waiting: state.phase === "waiting" ? state.asks : [],
		started,
	};
}

// ---------------------------------------------------------------- planted mistakes

/**
 * A fixed cap put back, the kind experiment 105 first had (12 rounds a task, 4 last reviews, 3
 * ship runs): where the lane would start a round, a last review or a ship run past `most`, it stops
 * instead, though the list may still be shrinking.
 */
export const aCapPutBack =
	(most: number): Update<Lane, Msg, LaneCmd> =>
	(s, m) => {
		const [next, cmds] = laneUpdate(s, m);
		if (s.phase !== "reading" || next.phase !== "starting") return [next, cmds];
		const f = next.flow;
		const count =
			f.flow === "round" || f.flow === "final" ? f.round : f.flow === "ship" ? f.run : 0;
		if (count <= most) return [next, cmds];
		const {lane: name, job, at, pr} = next;
		return [
			{
				lane: name,
				job,
				at,
				pr,
				phase: "over",
				outcome: {kind: "stuck", why: "read_failed"},
				report: {rounds: at.rounds, finals: at.finals, pr, problems: ["the cap"]},
			},
			[],
		];
	};

/** The lane counts no last review, as before the cap came out: a last review that keeps failing runs on, asked about by nobody. */
export const forgetsTheLastReviews: Update<Lane, Msg, LaneCmd> = (s, m) => {
	const [next, cmds] = laneUpdate(s, m);
	if (s.phase !== "running" || s.flow.flow !== "final" || next.phase !== "noting")
		return [next, cmds];
	const asked = readLane({plan: next.job.plan, pr: next.pr});
	const {lane: name, job, at, pr} = next;
	return [{lane: name, job, at, pr, phase: "reading", asked}, [asked]];
};

/** The planner's summary goes into the pull request as it came: its "Fixes #2" closes #2. */
export const rawBody: Update<Lane, Msg, LaneCmd> = (s, m) => {
	const [next, cmds] = laneUpdate(s, m);
	if (next.phase !== "opening" || s.phase !== "reading" || m.type !== "lane_read_ok")
		return [next, cmds];
	const asked = {...next.asked, body: `${m.value.summary}\n\n${next.asked.body}`};
	return [{...next, asked}, cmds.map((c) => (c.type === "lane_open" ? asked : c))];
};

/** The pull request opens on a met head even when main has moved on. */
export const opensBehind: Update<Lane, Msg, LaneCmd> = (s, m) =>
	s.phase === "reading" && m.type === "lane_read_ok" && m.value.behind
		? laneUpdate(s, {...m, value: {...m.value, behind: false}})
		: laneUpdate(s, m);

/** A child's name leaves out its round: the second round starts the first one's child again. */
export const forgetsTheRound: Update<Lane, Msg, LaneCmd> = (s, m) => {
	const [next, cmds] = laneUpdate(s, m);
	const strip = (child: string) => child.replace(/:r\d+:/, ":r1:");
	return [next, cmds.map((c) => (c.type === "lane_start" ? {...c, child: strip(c.child)} : c))];
};
