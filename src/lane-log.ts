// A lane of today's fabrika, read back from what it left on disk: its
// `workflow.json` (the lane's machine, one region per task) and its
// `events.jsonl` (one line per event, in the order they were written). This
// folds the second through the first, the way fabrika does on every verb, and
// keeps each step: which state the task was in, which event arrived, and where
// it went. Experiment 53 counts over those steps, and `src/fabrika-recorded.ts`
// replays them under the operator machine.
//
// The fold follows fabrika-cli 0.9.0's rules, and nothing else is read: no
// git, no GitHub. Where a line does not fold (the state has no arm for the
// event) the step is kept and marked, never dropped.

/** One line of `events.jsonl`. `event` is bare: `ISSUE.DONE` and `ISSUE_12.DONE` are both `DONE`. */
export interface LogEntry {
	readonly task: string;
	readonly event: string;
	/** When it was written, in ms. */
	readonly at: number;
	/** The same moment as the line spells it: what a `CORRECTED` line points at. */
	readonly stamp: string;
	readonly pr: string | null;
	/** Why a park parked or a lap lapped, when the line says. */
	readonly cause: string | null;
	readonly classes: readonly string[] | null;
	/** On a ship's `DONE`: the merge left its issue open. */
	readonly partial: boolean | null;
	/** On a build's `DONE`: proven by a diagnosis comment, not a pull request. */
	readonly diagnosis: boolean;
	/** On a `CLEARED`: the repair round a person granted. */
	readonly round: number | null;
	readonly waitGrant: number | null;
	/** On a `CORRECTED`: the stamp of the line it corrects. */
	readonly corrects: string | null;
	/** Every field of the line, for a reader that wants one this type does not name. */
	readonly raw: Readonly<Record<string, unknown>>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** `TASK.DONE` to `DONE`. */
export const bareEvent = (event: string): string => {
	const dot = event.indexOf(".");
	return dot === -1 ? event : event.slice(dot + 1);
};

/** The lines that parse, in order, and how many did not. */
export function parseLog(log: string): {
	readonly entries: readonly LogEntry[];
	readonly malformed: number;
} {
	const entries: LogEntry[] = [];
	let malformed = 0;
	for (const line of log.split("\n")) {
		if (line.trim() === "") continue;
		let raw: unknown;
		try {
			raw = JSON.parse(line);
		} catch {
			malformed += 1;
			continue;
		}
		if (
			!isRecord(raw) ||
			typeof raw.task !== "string" ||
			typeof raw.event !== "string" ||
			typeof raw.at !== "string"
		) {
			malformed += 1;
			continue;
		}
		const at = Date.parse(raw.at);
		if (Number.isNaN(at)) {
			malformed += 1;
			continue;
		}
		entries.push({
			task: raw.task,
			event: bareEvent(raw.event),
			at,
			stamp: raw.at,
			pr: text(raw.pr),
			cause: text(raw.cause),
			classes: Array.isArray(raw.classes)
				? raw.classes.filter((c): c is string => typeof c === "string")
				: null,
			partial: typeof raw.partial === "boolean" ? raw.partial : null,
			diagnosis: raw.diagnosis === true,
			round: typeof raw.round === "number" ? raw.round : null,
			waitGrant: typeof raw.waitGrant === "number" ? raw.waitGrant : null,
			corrects: text(raw.corrects),
			raw,
		});
	}
	return {entries, malformed};
}

// ---------------------------------------------------------------- the machine

/** One task's folded state: its leaf, the state it left, and its three budgets. */
export interface TaskState {
	readonly state: string;
	/** The state before this one: where an `UNBLOCKED` goes back to. */
	readonly was: string | null;
	readonly retries: number;
	readonly maxRetries: number;
	readonly cleared: readonly number[];
	/** Sticky: an event that names no class leaves the standing set alone. */
	readonly classes: readonly string[];
	readonly waits: number;
	readonly maxWaits: number;
	readonly laps: number;
	readonly maxLaps: number;
}

type Cell = (s: TaskState, e: LogEntry) => TaskState;

export interface CompiledTask {
	readonly initial: TaskState;
	readonly cells: Readonly<Record<string, Readonly<Record<string, Cell>>>>;
	/** Every leaf state the region declares, history states left out. */
	readonly states: readonly string[];
	readonly finals: ReadonlySet<string>;
	/** Finals that trip the lane: where a spent budget falls through to. */
	readonly errorFinals: ReadonlySet<string>;
}

export interface CompiledLane {
	readonly id: string;
	readonly phases: readonly {readonly name: string; readonly tasks: readonly string[]}[];
	readonly tasks: Readonly<Record<string, CompiledTask>>;
}

/** The events a document may declare an arm for: fabrika's seven operator events. */
export const OPERATOR_EVENTS = [
	"DONE",
	"PASS",
	"FAIL",
	"BLOCKED",
	"WIP",
	"UNBLOCKED",
	"LAP",
] as const;
/** The two ends the board proves, each a cell on every state: an issue closed unplanned, or shipped outside the lane. */
export const BOARD_TERMINALS: Readonly<Record<string, string>> = {
	CANCELLED: "board:cancelled",
	LANDED: "board:landed",
};
/** Lines that are about the log and reach no task's machine. */
export const LOG_EVENTS = ["CORRECTED", "AMENDED"] as const;

const RETRY_BUDGET = 3;
const WAIT_BUDGET = 3;
const LAP_BUDGET = 16;
const TEXT_CLASSES = ["code", "doc", "skill"];

/** Whether a class stands over a task. `mixed` is rendered work and text work at once. */
const classStands = (standing: readonly string[], name: string): boolean =>
	name === "mixed"
		? standing.includes("ui") && TEXT_CLASSES.some((c) => standing.includes(c))
		: standing.includes(name);

/** The repair budget once rounds have been cleared: the highest round a person granted, when that is past the declared one. */
function budgetWith(declared: number, cleared: readonly number[]): number {
	const granted = cleared.filter((r) => Number.isInteger(r) && r >= declared + 1);
	return granted.length === 0 ? declared : Math.max(declared + 1, Math.max(...granted) + 1) - 1;
}

const guardOf = (arm: unknown): string | null => (isRecord(arm) ? text(arm.guard) : null);
const targetOf = (arm: unknown): string | null => (isRecord(arm) ? text(arm.target) : null);
const prefixed = (arm: unknown, prefix: string): string | null => {
	const guard = guardOf(arm);
	return guard?.startsWith(prefix) ? guard.slice(prefix.length) : null;
};

/** The classes and the wait grant an event carries, folded in before any guard reads them. */
function withPayload(s: TaskState, e: LogEntry): TaskState {
	const classed = e.classes === null ? s : {...s, classes: e.classes};
	return e.waitGrant === null ? classed : {...classed, maxWaits: classed.maxWaits + e.waitGrant};
}

const to = (s: TaskState, state: string, more: Partial<TaskState> = {}): TaskState => ({
	...s,
	...more,
	state,
	was: s.state,
});

/** A guarded arm list as a cell. `spent`: where a spent budget lands, when the list ends in a budget pair. */
interface Guarded {
	readonly cell: Cell;
	readonly spent: string | null;
}

/** One guarded arm list. `null`: a shape this reader does not know. */
function guardedCell(event: string, arms: readonly unknown[]): Guarded | null {
	// Every arm but the last is `class:<name>`: route on the class, spend nothing.
	const classArms = arms
		.slice(0, -1)
		.map((arm) => [prefixed(arm, "class:"), targetOf(arm)] as const);
	const last = targetOf(arms.at(-1));
	if (
		classArms.length > 0 &&
		classArms.every(([name, target]) => name !== null && target !== null) &&
		last !== null
	) {
		const cell: Cell = (s, e) => {
			const c = withPayload(s, e);
			return to(c, classArms.find(([name]) => classStands(c.classes, name as string))?.[1] ?? last);
		};
		return {cell, spent: null};
	}
	// Leading `lap:<cause>` routes, then `class:<name>` routes, then the budget pair.
	const lapRoutes: (readonly [string, string])[] = [];
	for (const arm of arms) {
		const cause = prefixed(arm, "lap:");
		const target = targetOf(arm);
		if (cause === null || target === null) break;
		lapRoutes.push([cause, target]);
	}
	const rest = arms.slice(lapRoutes.length);
	const classRoutes: (readonly [string, string])[] = [];
	for (const arm of rest) {
		const name = prefixed(arm, "class:");
		const target = targetOf(arm);
		if (name === null || target === null) break;
		classRoutes.push([name, target]);
	}
	const pair = rest.slice(rest.length - classRoutes.length === 2 ? classRoutes.length : 0);
	const [taken, fallthrough] = pair.map(targetOf);
	if (pair.length !== 2 || taken == null || fallthrough == null) return null;
	const routes = rest.length - classRoutes.length === 2 ? classRoutes : [];
	const loop = (s: TaskState) =>
		routes.find(([name]) => classStands(s.classes, name))?.[1] ?? taken;
	const first = guardOf(pair[0]);
	if (first === "done:diagnosis") {
		return {cell: (s, e) => to(withPayload(s, e), e.diagnosis ? taken : fallthrough), spent: null};
	}
	if (first === "merge:partial") {
		return {
			cell: (s, e) => to(withPayload(s, e), e.partial === true ? taken : fallthrough),
			spent: null,
		};
	}
	// The budget pair: loop while the budget lasts, else fall through. Which budget is the event's.
	const cell: Cell =
		event === "FAIL"
			? (s, e) => {
					const c = withPayload(s, e);
					return c.retries < c.maxRetries
						? to(c, loop(c), {retries: c.retries + 1})
						: to(c, fallthrough);
				}
			: event === "LAP"
				? (s, e) => {
						const c = withPayload(s, e);
						const routed =
							e.cause === null ? undefined : lapRoutes.find(([cause]) => cause === e.cause)?.[1];
						return c.laps < c.maxLaps
							? to(c, routed ?? loop(c), {laps: c.laps + 1})
							: to(c, fallthrough);
					}
				: (s, e) => {
						const c = withPayload(s, e);
						return c.waits < c.maxWaits ? to(c, loop(c), {waits: c.waits + 1}) : to(c, fallthrough);
					};
	return {cell, spent: fallthrough};
}

function compileTask(region: unknown, context: unknown): CompiledTask | null {
	if (!isRecord(region) || !isRecord(region.states) || typeof region.initial !== "string")
		return null;
	const nodes = region.states;
	const ctx = isRecord(context) ? context : {};
	const declared = typeof ctx.maxRetries === "number" ? ctx.maxRetries : RETRY_BUDGET;
	const initialState = region.initial;
	const typeOf = (name: string) =>
		isRecord(nodes[name]) ? text((nodes[name] as Record<string, unknown>).type) : null;
	const finals = new Set(Object.keys(nodes).filter((name) => typeOf(name) === "final"));
	const errorFinals = new Set<string>();
	const cells: Record<string, Record<string, Cell>> = {};

	for (const [name, node] of Object.entries(nodes)) {
		if (typeOf(name) === "history") continue;
		const own: Record<string, Cell> = {};
		cells[name] = own;
		const on = isRecord(node) && isRecord(node.on) ? node.on : {};
		for (const [spelled, transition] of Object.entries(on)) {
			const event = bareEvent(spelled);
			if (Array.isArray(transition)) {
				const guarded = guardedCell(event, transition);
				if (guarded === null) continue;
				own[event] = guarded.cell;
				// A final where a spent budget lands trips the lane.
				if (guarded.spent !== null && finals.has(guarded.spent)) errorFinals.add(guarded.spent);
			} else if (typeof transition === "string") {
				own[event] =
					typeOf(transition) === "history"
						? (s, e) => ({...withPayload(s, e), state: s.was ?? initialState})
						: (s, e) => to(withPayload(s, e), transition);
			}
		}
	}
	// The compiler's own cells, on every state: a cleared round, and the two ends the board proves.
	for (const state of Object.values(BOARD_TERMINALS)) {
		finals.add(state);
		cells[state] = {};
	}
	for (const [name, own] of Object.entries(cells)) {
		own.CLEARED = (s, e) => {
			if (e.round === null || s.cleared.includes(e.round)) return s;
			const cleared = [...s.cleared, e.round].sort((a, b) => a - b);
			return {...s, cleared, maxRetries: budgetWith(declared, cleared)};
		};
		if (Object.values(BOARD_TERMINALS).includes(name)) continue;
		for (const [event, terminal] of Object.entries(BOARD_TERMINALS))
			own[event] = (s) => to(s, terminal);
	}
	const initial: TaskState = {
		state: initialState,
		was: null,
		retries: 0,
		maxRetries: declared,
		cleared: [],
		classes: Array.isArray(ctx.classes)
			? ctx.classes.filter((c): c is string => typeof c === "string")
			: [],
		waits: 0,
		maxWaits: typeof ctx.maxWaits === "number" ? ctx.maxWaits : WAIT_BUDGET,
		laps: 0,
		maxLaps: typeof ctx.maxLaps === "number" ? ctx.maxLaps : LAP_BUDGET,
	};
	const states = Object.keys(cells);
	return {initial, cells, states, finals, errorFinals};
}

/** A `workflow.json`, compiled: its phases in order, and one machine per task. `null`: not a lane's machine. */
export function compileLane(workflow: unknown): CompiledLane | null {
	const machine = isRecord(workflow) ? workflow.machine : null;
	if (!isRecord(machine) || !isRecord(machine.states)) return null;
	const context = isRecord(machine.context) ? machine.context : {};
	const tasks: Record<string, CompiledTask> = {};
	const phases: {name: string; tasks: string[]}[] = [];
	for (const [phase, node] of Object.entries(machine.states)) {
		if (!isRecord(node) || node.type !== "parallel" || !isRecord(node.states)) continue;
		const own: string[] = [];
		for (const [task, region] of Object.entries(node.states)) {
			const compiled = compileTask(region, context[task]);
			if (compiled === null) return null;
			tasks[task] = compiled;
			own.push(task);
		}
		phases.push({name: phase, tasks: own});
	}
	if (phases.length === 0) return null;
	const id = isRecord(workflow) && typeof workflow.id === "string" ? workflow.id : "";
	return {id, phases, tasks};
}

// ---------------------------------------------------------------- the fold

/** One event, folded: where the task stood, and where it went. */
export interface Step {
	readonly entry: LogEntry;
	readonly from: string;
	readonly to: string;
	/** The state had no arm for the event: fabrika would refuse to replay the log here. The task stays put. */
	readonly noCell: boolean;
	/** The task's state after the event, budgets and all. */
	readonly after: TaskState;
}

/** Apply each `CORRECTED` line to the line it names (its `partial`), and drop the corrections. */
export function applyCorrections(entries: readonly LogEntry[]): readonly LogEntry[] {
	const corrections = entries.filter((e) => e.event === "CORRECTED");
	if (corrections.length === 0) return entries;
	const patched = entries.filter((e) => e.event !== "CORRECTED");
	for (const c of corrections) {
		const hits = patched.flatMap((e, i) =>
			e.task === c.task && e.stamp === c.corrects ? [i] : [],
		);
		const [index] = hits;
		// A correction that attaches integrate evidence changes no routing: only `partial` is read by the fold.
		if (hits.length !== 1 || index === undefined || isRecord(c.raw.integrate)) continue;
		patched[index] = {...(patched[index] as LogEntry), partial: c.partial === true};
	}
	return patched;
}

/** One event on one task. */
export function stepTask(task: CompiledTask, s: TaskState, entry: LogEntry): Step {
	const cell = task.cells[s.state]?.[entry.event];
	if (cell === undefined) return {entry, from: s.state, to: s.state, noCell: true, after: s};
	const after = cell(s, entry);
	return {entry, from: s.state, to: after.state, noCell: false, after};
}

export type LaneStatus =
	| "active"
	| "complete"
	| "tripped"
	| "diagnosed"
	| "board:cancelled"
	| "board:landed";

/** The lane's status from its tasks' states: the first phase not all final is active; a finished phase can end the lane early. */
export function statusOf(
	lane: CompiledLane,
	states: Readonly<Record<string, TaskState>>,
): {readonly status: LaneStatus; readonly phase: string | null} {
	for (const phase of lane.phases) {
		const leaf = (task: string) => (states[task] as TaskState).state;
		const compiled = (task: string) => lane.tasks[task] as CompiledTask;
		if (!phase.tasks.every((t) => compiled(t).finals.has(leaf(t))))
			return {status: "active", phase: phase.name};
		const board = phase.tasks.map(leaf).find((s) => Object.values(BOARD_TERMINALS).includes(s));
		if (board !== undefined) return {status: board as LaneStatus, phase: null};
		if (phase.tasks.some((t) => leaf(t) === "diagnosed")) return {status: "diagnosed", phase: null};
		if (phase.tasks.some((t) => compiled(t).errorFinals.has(leaf(t))))
			return {status: "tripped", phase: null};
	}
	return {status: "complete", phase: null};
}

export interface Walk {
	/** Each task's steps, in the order its events were written. */
	readonly steps: Readonly<Record<string, readonly Step[]>>;
	readonly states: Readonly<Record<string, TaskState>>;
	readonly status: LaneStatus;
	/** Lines about a task the machine does not hold (a child an amendment took out of the plan). */
	readonly strays: number;
	/** Lines the fold applied a correction from, and amendments of the task set. */
	readonly corrected: number;
	readonly amended: number;
}

/** Fold a whole log through its lane. */
export function walk(lane: CompiledLane, entries: readonly LogEntry[]): Walk {
	const corrected = entries.filter((e) => e.event === "CORRECTED").length;
	const amended = entries.filter((e) => e.event === "AMENDED").length;
	const steps: Record<string, Step[]> = {};
	const states: Record<string, TaskState> = {};
	for (const [name, task] of Object.entries(lane.tasks)) {
		steps[name] = [];
		states[name] = task.initial;
	}
	let strays = 0;
	for (const entry of applyCorrections(entries)) {
		if (entry.event === "AMENDED") continue;
		const task = lane.tasks[entry.task];
		if (task === undefined) {
			strays += 1;
			continue;
		}
		const step = stepTask(task, states[entry.task] as TaskState, entry);
		(steps[entry.task] as Step[]).push(step);
		states[entry.task] = step.after;
	}
	return {steps, states, status: statusOf(lane, states).status, strays, corrected, amended};
}

// ---------------------------------------------------------------- what a step is

/** The stage a state belongs to, read off its name. */
export type Stage = "queued" | "build" | "review" | "ship" | "integrate" | "park" | "final";

export function stageOf(state: string): Stage {
	if (state === "queued") return "queued";
	if (state.startsWith("build")) return "build";
	if (state.startsWith("review")) return "review";
	if (state.startsWith("ship") && state !== "shipped") return "ship";
	if (state.startsWith("integrate")) return "integrate";
	if (state === "blocked" || state === "frozen" || state.startsWith("human:")) return "park";
	return "final";
}

/** Whether a state is a park: the lane waits there for something outside it. */
export const isPark = (state: string): boolean => stageOf(state) === "park";
