import {structuralHash} from "@demlik/tea";
import {criterionId, planOf, taskId, ticketId} from "../ids.ts";
import type {Built} from "../stages/build/form.ts";
import {noRun, type Settings} from "../stages/review/reviewer.ts";
import {
	MAX_RUNS,
	pushTask,
	readTask,
	type Task,
	type TaskCmd,
	task,
} from "../stages/task/machine.ts";
import {type TaskView, taskGate} from "../stages/task/view.ts";
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

// One task's build under every order of messages: its world and its laws.
//
// The world reads the task (open, removed, closed, with no base, with no criteria, or not at all),
// the builder hands back a form or fails, for the run asked for or an earlier one, and the push is
// answered, answered with nothing new, or refused. A restart may come at any time.

export type AnyTaskMsg = MsgOf<typeof task>;
type Msg = AnyTaskMsg;
const taskUpdate = stepOf<Task, Msg, TaskCmd>(task);

const PLAN = planOf(ticketId("o/r#7"));
const T1 = taskId("t1");
const SETTINGS: Settings = {model: "m", effort: "low", budget: 1};
const BASE = "base";

const view = (patch: Partial<TaskView> = {}): TaskView => ({
	ticket: "https://github.com/o/r/issues/7",
	number: 7,
	title: "windows",
	body: "b",
	criteria: [
		{id: criterionId("c1"), version: 1, text: "every window opens", checked: false, evidence: null},
	],
	approved: true,
	live: true,
	closed: false,
	branch: "plan/7",
	base: BASE,
	...patch,
});

/** What a builder may hand back. */
export const TASK_BUILTS: Readonly<Record<string, Built>> = {
	plain: {summary: "Opens the windows.", deviations: [], ran: [], left: []},
	"names another ticket": {
		summary: "Opens the windows. Fixes #2, and resolves GH-3.",
		deviations: [],
		ran: [],
		left: [],
	},
};

const UNKNOWN = {_tag: "unknown" as const};

export function taskWorld(): World<Task, Msg, TaskCmd> {
	return {
		outside: (s) => {
			const runs = s.phase === "building" ? [s.run, s.run - 1] : [1];
			const at = {task: T1, round: 1};
			return [
				{
					type: "start",
					ask: {plan: PLAN, task: T1, round: 1, open: []},
					settings: SETTINGS,
					session: "x",
				},
				{type: "resume"},
				...runs.flatMap((run): Msg[] => [
					...Object.values(TASK_BUILTS).map((built): Msg => ({
						type: "task_built",
						...at,
						run,
						built,
						ran: noRun,
					})),
					{type: "task_failed", ...at, run, why: "broke", error: null, ran: noRun},
					{type: "task_failed", ...at, run, why: "over_budget", error: null, ran: noRun},
				]),
			];
		},
		answers: (cmd): readonly Msg[] => {
			switch (cmd.type) {
				case "task_read":
					return [
						readTask.ok(cmd, view(), 0),
						readTask.ok(cmd, view({live: false}), 0),
						readTask.ok(cmd, view({closed: true}), 0),
						readTask.ok(cmd, view({base: null}), 0),
						readTask.ok(cmd, view({criteria: []}), 0),
						readTask.err(cmd, UNKNOWN, 0),
					];
				case "task_push":
					return [
						pushTask.ok(cmd, {head: "A", changed: true}, 0),
						pushTask.ok(cmd, {head: BASE, changed: false}, 0),
						pushTask.err(cmd, UNKNOWN, 0),
					];
			}
		},
		restart: (msg) => msg.type === "resume",
	};
}

const pushesIn = (cmds: readonly TaskCmd[]) =>
	cmds.flatMap((c) => (c.type === "task_push" ? [c] : []));

const runOf = (s: Task): number | null => (s.phase === "building" ? s.run : null);

export function taskLaws<S extends Task>(): readonly Law<S, Msg, TaskCmd>[] {
	return [
		watched<S, Msg, TaskCmd, TaskView | null>(
			"a push goes out only after the gate let the task through, from the base it read",
			null,
			(read, {prev, msg, cmds}) => {
				const now = prev.phase === "reading" && msg.type === "task_read_ok" ? msg.value : read;
				for (const push of pushesIn(cmds)) {
					if (now === null) return broke("a push before the task was read");
					if (taskGate(now).answer !== "go") return broke("a push the gate stopped");
					if (push.base !== now.base || push.branch !== now.branch)
						return broke(
							`pushed ${push.branch} from ${push.base}, read ${now.branch} at ${now.base}`,
						);
				}
				return now;
			},
		),
		law<S, Msg, TaskCmd>("the commit closes no ticket", ({cmds}) => {
			for (const push of pushesIn(cmds)) {
				const named = closes(push.message);
				if (named.length > 0) return `the commit message closes ${named.join(", ")}`;
			}
			return null;
		}),
		law<S, Msg, TaskCmd>("a builder Msg counts only for the run asked for", ({prev, msg, next}) =>
			(msg.type === "task_built" || msg.type === "task_failed") &&
			msg.run !== runOf(prev) &&
			structuralHash(prev) !== structuralHash(next)
				? `${msg.type} from run ${msg.run} was taken while ${runOf(prev) ?? "no run"} was asked for`
				: null,
		),
		law<S, Msg, TaskCmd>("runs never pass the limit", ({next}) => {
			const run = runOf(next);
			return run !== null && run > MAX_RUNS ? `run ${run} of ${MAX_RUNS}` : null;
		}),
		law<S, Msg, TaskCmd>("an ended task sends nothing", ({prev, cmds}) =>
			prev.phase === "over" && cmds.length > 0
				? `${cmds.map((c) => c.type).join(", ")} after the task ended`
				: null,
		),
	];
}

export const taskInit: Task = {phase: "idle"};
export const taskStep: Update<Task, Msg, TaskCmd> = taskUpdate;

export function showTaskMsg(m: Msg): string {
	switch (m.type) {
		case "task_read_ok":
			return `task read: ${taskGate(m.value).answer === "go" ? "go" : JSON.stringify(taskGate(m.value))}`;
		case "task_built": {
			const name = Object.entries(TASK_BUILTS).find(
				([, b]) => structuralHash(b) === structuralHash(m.built),
			)?.[0];
			return `builder hands back "${name ?? "?"}" (run ${m.run})`;
		}
		case "task_failed":
			return `run ${m.run} failed: ${m.why}`;
		case "task_push_ok":
			return `pushed: ${m.value.head}${m.value.changed ? "" : ", nothing new"}`;
		case "resume":
			return "restart, then resume";
		default:
			return m.type;
	}
}

// ---------------------------------------------------------------- planted mistakes

/** The builder's summary goes into the commit as it came: a "Fixes #2" in it closes #2. */
export const rawSummary: Update<Task, Msg, TaskCmd> = (s, m) => {
	const [next, cmds] = taskUpdate(s, m);
	if (next.phase !== "pushing" || s.phase !== "building") return [next, cmds];
	const message = `${next.asked.message}\n\n${next.built.summary}`;
	const asked = {...next.asked, message};
	return [{...next, asked}, cmds.map((c) => (c.type === "task_push" ? asked : c))];
};

/** The push goes from main, not from where the branch stood. */
export const pushesFromMain: Update<Task, Msg, TaskCmd> = (s, m) => {
	const [next, cmds] = taskUpdate(s, m);
	return [next, cmds.map((c) => (c.type === "task_push" ? {...c, base: "main"} : c))];
};
