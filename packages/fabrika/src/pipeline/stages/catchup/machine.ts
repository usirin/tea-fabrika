import {defineMachine, type Sub} from "@demlik/tea";
import {Schema} from "effect";
import {PlanId, TaskId} from "../../ids.ts";
import {act, gather, intentOf, listen} from "../../primitives.ts";
import type {Ran} from "../build/form.ts";
import {Pushed} from "../build/services.ts";
import type {CatchupOutcome} from "./outcome.ts";

// A plan's one branch, kept up with main (docs/direction/done-is-per-criterion.md, "One PR per
// plan"). Every task lands on `plan/<n>` while main moves on; before a round builds, and before the
// last review, the branch takes main in by a merge. Never a rebase: the commits the reviews judged
// stay the commits they judged, and the branch is only ever pushed forward.
//
//   reading    where the branch and main stand, and whether main is in the branch already
//   trying     the merge, made in a copy and thrown away: which files conflict
//   resolving  the conflicts that are not the lockfile go to an agent, as a Sub: it answers the
//              files' merged text. The lockfile never goes to an agent: code makes it again
//   pushing    code makes the merge again from the same two commits, puts the resolved files in,
//              makes the lockfile again, and pushes one merge commit from where the branch stood.
//              An Act
//   over       the outcome
//
// The same machine takes a removed task's commits out (`drop`): one revert per commit, newest
// first, pushed the same way. A revert, never a rewrite.

const Unknown = ["unknown"] as const;

/** The one lockfile code makes again rather than merges. */
export const LOCKFILE = "pnpm-lock.yaml";

/** One catch-up, as asked: take main in, or take a removed task's commits out. */
export const CatchupAsk = Schema.Struct({
	plan: PlanId,
	/** `null`: take main in. A task: revert its commits. */
	drop: Schema.NullOr(TaskId),
});
export type CatchupAsk = typeof CatchupAsk.Type;

export const CatchupView = Schema.Struct({
	/** The plan's branch now. `null`: it has none yet. */
	branch: Schema.NullOr(Schema.String),
	main: Schema.String,
	/** Main's commit is in the branch already. */
	merged: Schema.Boolean,
	/** For a drop: the task's commits on the branch not reverted yet, newest first. */
	drops: Schema.Array(Schema.String),
});
export type CatchupView = typeof CatchupView.Type;

export const Tried = Schema.Struct({
	/** Files the merge left in conflict, the lockfile not among them. */
	conflicts: Schema.Array(Schema.String),
	/** The lockfile was in conflict too: code makes it again. */
	lockfile: Schema.Boolean,
});
export type Tried = typeof Tried.Type;

export const Resolved = Schema.Struct({path: Schema.String, text: Schema.String});
export type Resolved = typeof Resolved.Type;

export const readCatchup = gather("catchup_read", {
	input: CatchupAsk,
	ok: CatchupView,
	err: Unknown,
});

export const tryMerge = gather("catchup_try", {
	input: Schema.Struct({plan: PlanId, base: Schema.String, main: Schema.String}),
	ok: Tried,
	err: Unknown,
});

export const pushCatchup = act("catchup_push", {
	input: Schema.Struct({
		plan: PlanId,
		base: Schema.String,
		/** Merge this commit in; `null` for a drop. */
		main: Schema.NullOr(Schema.String),
		/** Revert these, in this order. */
		reverts: Schema.Array(Schema.String),
		resolved: Schema.Array(Resolved),
		lockfile: Schema.Boolean,
		message: Schema.String,
	}),
	ok: Pushed,
	err: ["unknown", "unresolved", "lockfile_failed"],
});

type ReadCmd = ReturnType<typeof readCatchup>;
type TryCmd = ReturnType<typeof tryMerge>;
type PushCmd = ReturnType<typeof pushCatchup>;
export type CatchupCmd = ReadCmd | TryCmd | PushCmd;

export type ResolveSub = Sub<
	"catchup_resolve",
	{
		readonly plan: PlanId;
		readonly base: string;
		readonly main: string;
		readonly conflicts: readonly string[];
	}
>;

type Held = {readonly ask: CatchupAsk};
type Read = Held & {readonly base: string; readonly main: string};

export type Catchup =
	| {readonly phase: "idle"}
	| (Held & {readonly phase: "reading"; readonly asked: ReadCmd})
	| (Read & {readonly phase: "trying"; readonly asked: TryCmd})
	| (Read & {readonly phase: "resolving"; readonly tried: Tried})
	| (Held & {readonly phase: "pushing"; readonly asked: PushCmd})
	| (Held & {
			readonly phase: "over";
			readonly outcome: CatchupOutcome;
			readonly problems: readonly string[];
			readonly spend: number;
	  });

export type CatchupMsg =
	| {readonly type: "start"; readonly ask: CatchupAsk}
	| {readonly type: "resume"}
	| {
			readonly type: "catchup_resolved";
			readonly base: string;
			readonly main: string;
			readonly files: readonly Resolved[];
			readonly ran: Ran;
	  }
	| {
			readonly type: "catchup_unresolved";
			readonly base: string;
			readonly main: string;
			readonly why: string;
			readonly ran: Ran | null;
	  };

type Step = readonly [Catchup, readonly CatchupCmd[]];
const stay = (s: Catchup): Step => [s, []];
const end = (
	s: Held,
	outcome: CatchupOutcome,
	problems: readonly string[] = [],
	spend = 0,
): Step => [{ask: s.ask, phase: "over", outcome, problems, spend}, []];

/** The plan's branch. */
export const branchOfPlan = (plan: PlanId) => `plan/${plan.slice(plan.indexOf("#") + 1)}`;

/** The merge commit's message. Pure. */
export const mergeMessage = (plan: PlanId, main: string) =>
	`Merge main (${main.slice(0, 12)}) into ${branchOfPlan(plan)}`;

const push = (s: Held, input: Omit<Parameters<typeof pushCatchup>[0], "intent" | "plan">): Step => {
	const asked = pushCatchup({
		plan: s.ask.plan,
		...input,
		intent: intentOf("catchup", s.ask.plan, input.base, input.main ?? "drop"),
	});
	return [{ask: s.ask, phase: "pushing", asked}, [asked]];
};

/** The resolver: on only while resolving. */
export const resolveSub = listen("catchup_resolve", (s: Catchup) =>
	s.phase === "resolving"
		? {plan: s.ask.plan, base: s.base, main: s.main, conflicts: s.tried.conflicts}
		: null,
);

const isFor = (s: Catchup, m: {readonly base: string; readonly main: string}) =>
	s.phase === "resolving" && s.base === m.base && s.main === m.main;

export const catchup = defineMachine({
	types: {model: {} as Catchup, msg: {} as CatchupMsg, sub: {} as ResolveSub, ctx: undefined},
	cmds: [readCatchup, tryMerge, pushCatchup],
	init: (loaded) => [loaded ?? {phase: "idle"}, []],
	subs: [resolveSub],
	update: {
		start: (s, m): Step => {
			if (s.phase !== "idle") return stay(s);
			const asked = readCatchup(m.ask);
			return [{ask: m.ask, phase: "reading", asked}, [asked]];
		},
		resume: (s): Step =>
			s.phase === "reading" || s.phase === "trying" || s.phase === "pushing"
				? [s, [s.asked]]
				: stay(s),
		catchup_read_ok: (s, m): Step => {
			if (s.phase !== "reading") return stay(s);
			const v = m.value;
			if (v.branch === null) return end(s, {kind: "skip", why: "up_to_date"});
			if (s.ask.drop !== null) {
				if (v.drops.length === 0) return end(s, {kind: "skip", why: "up_to_date"});
				return push(s, {
					base: v.branch,
					main: null,
					reverts: v.drops,
					resolved: [],
					lockfile: false,
					message: "",
				});
			}
			if (v.merged) return end(s, {kind: "skip", why: "up_to_date"});
			const asked = tryMerge({plan: s.ask.plan, base: v.branch, main: v.main});
			return [{ask: s.ask, base: v.branch, main: v.main, phase: "trying", asked}, [asked]];
		},
		catchup_read_err: (s): Step =>
			s.phase === "reading" ? end(s, {kind: "stuck", why: "read_failed"}) : stay(s),
		catchup_try_ok: (s, m): Step => {
			if (s.phase !== "trying") return stay(s);
			const tried = m.value;
			if (tried.conflicts.length > 0)
				return [{ask: s.ask, base: s.base, main: s.main, phase: "resolving", tried}, []];
			return push(s, {
				base: s.base,
				main: s.main,
				reverts: [],
				resolved: [],
				lockfile: tried.lockfile,
				message: mergeMessage(s.ask.plan, s.main),
			});
		},
		catchup_try_err: (s): Step =>
			s.phase === "trying" ? end(s, {kind: "stuck", why: "read_failed"}) : stay(s),
		catchup_resolved: (s, m): Step => {
			if (!isFor(s, m) || s.phase !== "resolving") return stay(s);
			const missing = s.tried.conflicts.filter((p) => !m.files.some((f) => f.path === p));
			if (missing.length > 0)
				return end(
					s,
					{kind: "stuck", why: "unresolved"},
					[`the resolver left ${missing.join(", ")}`],
					m.ran.spend.costUsd,
				);
			return push(s, {
				base: s.base,
				main: s.main,
				reverts: [],
				resolved: m.files,
				lockfile: s.tried.lockfile,
				message: mergeMessage(s.ask.plan, s.main),
			});
		},
		catchup_unresolved: (s, m): Step =>
			isFor(s, m) && s.phase === "resolving"
				? end(s, {kind: "stuck", why: "draft_failed"}, [m.why], m.ran?.spend.costUsd ?? 0)
				: stay(s),
		catchup_push_ok: (s, m): Step =>
			s.phase === "pushing"
				? end(s, {kind: "done", part: false, head: m.value.head, changed: m.value.changed})
				: stay(s),
		catchup_push_err: (s, m): Step => {
			if (s.phase !== "pushing") return stay(s);
			const why =
				m.error._tag === "unresolved"
					? "unresolved"
					: m.error._tag === "lockfile_failed"
						? "lockfile_failed"
						: "push_failed";
			return end(s, {kind: "stuck", why});
		},
	},
});
