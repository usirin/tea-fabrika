import {structuralHash} from "@demlik/tea";
import {planOf, taskId, ticketId} from "../ids.ts";
import {
	type Catchup,
	type CatchupAsk,
	type CatchupCmd,
	type CatchupView,
	catchup,
	LOCKFILE,
	pushCatchup,
	readCatchup,
	tryMerge,
} from "../stages/catchup/machine.ts";
import {noRun} from "../stages/review/reviewer.ts";
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

// A plan's branch kept up with main, under every order of messages: its world and its laws.
//
// The world asks for a catch-up (take main in) or a drop (take a removed task's commits out). The
// read may find no branch, main already in, a branch behind, or commits to revert; the trial merge
// may be clean, the lockfile alone, or a file in conflict; the resolver answers every file, leaves
// one, or fails, for the merge asked about or another one; the push is answered or refused. A
// restart may come at any time.

export type AnyCatchupMsg = MsgOf<typeof catchup>;
type Msg = AnyCatchupMsg;
const catchupUpdate = stepOf<Catchup, Msg, CatchupCmd>(catchup);

const PLAN = planOf(ticketId("o/r#7"));
const BRANCH = "B";
const MAIN = "M";
const FILE = "src/a.ts";
const ASKS: readonly CatchupAsk[] = [
	{plan: PLAN, drop: null},
	{plan: PLAN, drop: taskId("t2")},
];

const view = (patch: Partial<CatchupView> = {}): CatchupView => ({
	branch: BRANCH,
	main: MAIN,
	merged: false,
	drops: [],
	...patch,
});

const UNKNOWN = {_tag: "unknown" as const};

export function catchupWorld(): World<Catchup, Msg, CatchupCmd> {
	return {
		outside: () => [
			...ASKS.map((ask): Msg => ({type: "start", ask})),
			{type: "resume"},
			...[MAIN, "M0"].flatMap((main): Msg[] => [
				{
					type: "catchup_resolved",
					base: BRANCH,
					main,
					files: [{path: FILE, text: "x"}],
					ran: noRun,
				},
				{type: "catchup_resolved", base: BRANCH, main, files: [], ran: noRun},
				{type: "catchup_unresolved", base: BRANCH, main, why: "broke", ran: null},
			]),
		],
		answers: (cmd): readonly Msg[] => {
			switch (cmd.type) {
				case "catchup_read":
					return [
						readCatchup.ok(cmd, view(), 0),
						readCatchup.ok(cmd, view({merged: true}), 0),
						readCatchup.ok(cmd, view({branch: null}), 0),
						readCatchup.ok(cmd, view({drops: ["d2", "d1"]}), 0),
						readCatchup.err(cmd, UNKNOWN, 0),
					];
				case "catchup_try":
					return [
						tryMerge.ok(cmd, {conflicts: [], lockfile: false}, 0),
						tryMerge.ok(cmd, {conflicts: [], lockfile: true}, 0),
						tryMerge.ok(cmd, {conflicts: [FILE], lockfile: true}, 0),
						tryMerge.err(cmd, UNKNOWN, 0),
					];
				case "catchup_push":
					return [
						pushCatchup.ok(cmd, {head: "H", changed: true}, 0),
						pushCatchup.err(cmd, UNKNOWN, 0),
						pushCatchup.err(cmd, {_tag: "unresolved"}, 0),
					];
			}
		},
		restart: (msg) => msg.type === "resume",
	};
}

const pushesIn = (cmds: readonly CatchupCmd[]) =>
	cmds.flatMap((c) => (c.type === "catchup_push" ? [c] : []));

/** What the read said, and the conflicts the trial merge found, along one path. */
type Seen = {readonly view: CatchupView | null; readonly conflicts: readonly string[]};

export function catchupLaws<S extends Catchup>(): readonly Law<S, Msg, CatchupCmd>[] {
	return [
		watched<S, Msg, CatchupCmd, Seen>(
			"a push goes from the branch as read and takes in the main it read, or only reverts",
			{view: null, conflicts: []},
			(seen, {prev, msg, cmds}) => {
				const now: Seen =
					prev.phase === "reading" && msg.type === "catchup_read_ok"
						? {view: msg.value, conflicts: []}
						: prev.phase === "trying" && msg.type === "catchup_try_ok"
							? {...seen, conflicts: msg.value.conflicts}
							: seen;
				for (const push of pushesIn(cmds)) {
					const v = now.view;
					if (v === null || v.branch === null) return broke("a push with no branch read");
					if (push.base !== v.branch) return broke(`pushed from ${push.base}, read ${v.branch}`);
					const drop = "ask" in prev && prev.ask.drop !== null;
					if (drop) {
						if (push.main !== null || push.resolved.length > 0)
							return broke("a drop merged something in");
						if (structuralHash(push.reverts) !== structuralHash(v.drops))
							return broke(`reverted ${push.reverts.join(", ")}, read ${v.drops.join(", ")}`);
					} else {
						if (push.reverts.length > 0) return broke("a catch-up reverted a commit");
						if (push.main !== v.main) return broke(`merged ${push.main}, read main at ${v.main}`);
						const left = now.conflicts.filter((p) => !push.resolved.some((f) => f.path === p));
						if (left.length > 0) return broke(`pushed with ${left.join(", ")} unresolved`);
					}
				}
				return now;
			},
		),
		law<S, Msg, CatchupCmd>("the lockfile never goes to the resolver", ({next}) =>
			next.phase === "resolving" && next.tried.conflicts.includes(LOCKFILE)
				? "the resolver was asked about the lockfile"
				: null,
		),
		law<S, Msg, CatchupCmd>(
			"a resolver Msg counts only for the merge asked about",
			({prev, msg, next}) =>
				(msg.type === "catchup_resolved" || msg.type === "catchup_unresolved") &&
				!(prev.phase === "resolving" && prev.base === msg.base && prev.main === msg.main) &&
				structuralHash(prev) !== structuralHash(next)
					? `a resolver answer for ${msg.main} was taken`
					: null,
		),
		law<S, Msg, CatchupCmd>("an ended catch-up sends nothing", ({prev, cmds}) =>
			prev.phase === "over" && cmds.length > 0
				? `${cmds.map((c) => c.type).join(", ")} after the catch-up ended`
				: null,
		),
	];
}

export const catchupInit: Catchup = {phase: "idle"};
export const catchupStep: Update<Catchup, Msg, CatchupCmd> = catchupUpdate;

export function showCatchupMsg(m: Msg): string {
	switch (m.type) {
		case "start":
			return m.ask.drop === null ? "start: take main in" : `start: drop ${m.ask.drop}`;
		case "catchup_read_ok":
			return `read: ${m.value.branch === null ? "no branch" : m.value.merged ? "main in" : `drops ${m.value.drops.length}`}`;
		case "catchup_try_ok":
			return `tried: ${m.value.conflicts.length} conflicts${m.value.lockfile ? ", lockfile" : ""}`;
		case "catchup_resolved":
			return `resolved ${m.files.length} for ${m.main}`;
		case "catchup_unresolved":
			return `unresolved for ${m.main}`;
		case "resume":
			return "restart, then resume";
		default:
			return m.type;
	}
}

// ---------------------------------------------------------------- planted mistakes

/** A merge with a conflict is pushed at once, the resolver never asked. */
export const pushesUnresolved: Update<Catchup, Msg, CatchupCmd> = (s, m) =>
	s.phase === "trying" && m.type === "catchup_try_ok"
		? catchupUpdate(s, {...m, value: {...m.value, conflicts: []}})
		: catchupUpdate(s, m);

/** The lockfile goes to the resolver with the other files. */
export const resolvesTheLockfile: Update<Catchup, Msg, CatchupCmd> = (s, m) =>
	s.phase === "trying" && m.type === "catchup_try_ok" && m.value.conflicts.length > 0
		? catchupUpdate(s, {
				...m,
				value: {...m.value, conflicts: [...m.value.conflicts, LOCKFILE]},
			})
		: catchupUpdate(s, m);
