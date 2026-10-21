import {structuralHash} from "@demlik/tea";
import {criterionId, planOf, taskId, ticketId} from "../ids.ts";
import type {Item} from "../stages/build/ticket.ts";
import {
	type KidEnd,
	type Lane,
	type LaneCmd,
	type LaneJob,
	lane,
	notePlan,
	noteRound,
	openPr,
	readLane,
	startKid,
} from "../stages/lane/machine.ts";
import {type LaneView, MOST_ROUNDS} from "../stages/lane/view.ts";
import {closes} from "./build.ts";
import {
	broke,
	type Law,
	law,
	type MsgOf,
	stepOf,
	type Update,
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

export type AnyLaneMsg = MsgOf<typeof lane>;
type Msg = AnyLaneMsg;
const laneUpdate = stepOf<Lane, Msg, LaneCmd>(lane);

const PLAN = planOf(ticketId("o/r#7"));
const LANE = "lane:7";
const T1 = taskId("t1");
const T2 = taskId("t2");
const JOB: LaneJob = {
	plan: PLAN,
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
	"not met": view({met: false}),
	merged: view({pr: {url: "P", state: "merged", head: "H"}}),
};

/** How a child may end, by a short name. */
export const ENDS: Readonly<Record<string, KidEnd>> = {
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
			const kids = [...new Set([...(s.phase === "running" ? [s.kid] : []), STRAY])];
			return [
				{type: "start", lane: LANE, job: JOB},
				{type: "resume"},
				{type: "owner_moved"},
				...kids.flatMap((kid) =>
					Object.values(ENDS).map((end): Msg => ({type: "kid_over", kid, end})),
				),
			];
		},
		answers: (cmd): readonly Msg[] => {
			switch (cmd.type) {
				case "lane_read":
					return [...views.map((v) => readLane.ok(cmd, v, 0)), readLane.err(cmd, UNKNOWN, 0)];
				case "lane_start":
					return [startKid.ok(cmd, {started: true}, 0), startKid.err(cmd, UNKNOWN, 0)];
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
					const before = started.find(([kid]) => kid === c.kid);
					if (before === undefined) started.push([c.kid, job]);
					else if (before[1] !== job) return broke(`${c.kid} started again with another job`);
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
			msg.type === "kid_over" &&
			!(prev.phase === "running" && prev.kid === msg.kid) &&
			structuralHash(prev) !== structuralHash(next)
				? `${msg.kid}'s end was taken while ${prev.phase === "running" ? prev.kid : "no child"} ran`
				: null,
		),
		law<S, Msg, LaneCmd>("rounds never pass the cap", ({next}) => {
			if (!("at" in next)) return null;
			const most = Math.max(0, ...Object.values(next.at.rounds));
			return most > MOST_ROUNDS ? `round ${most} of ${MOST_ROUNDS}` : null;
		}),
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
		case "kid_over":
			return `${m.kid}: ${nameIn(ENDS, m.end)}`;
		case "lane_start_ok":
			return `${m.cmd.kid} started`;
		case "resume":
			return "restart, then resume";
		default:
			return m.type;
	}
}

// ---------------------------------------------------------------- planted mistakes

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
	const strip = (kid: string) => kid.replace(/:r\d+:/, ":r1:");
	return [next, cmds.map((c) => (c.type === "lane_start" ? {...c, kid: strip(c.kid)} : c))];
};
