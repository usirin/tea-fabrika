// A lane's `workflow.json` and `events.jsonl`, written by hand for tests: the
// shape fabrika 0.9.0 emits for one issue, and a small epic. No real lane's
// data is in here.

const budget = (loop: string, guard: string, spent: string) => [
  { target: loop, guard, actions: "increment" },
  { target: spent },
];
const laps = (loop: string) => budget(loop, "lapsRemaining", "human:machinery-stall");
const retries = (loop: string) => budget(loop, "retriesRemaining", "human:budget-spent");

/** The states of one issue's task, as fabrika's issue-lane template has them. `task` namespaces its events. */
function issueStates(task: string): Record<string, unknown> {
  const on = (arms: Record<string, unknown>) => ({ on: Object.fromEntries(Object.entries(arms).map(([event, to]) => [`${task}.${event}`, to])) });
  return {
    queued: on({ WIP: [{ target: "build:ui", guard: "class:ui" }, { target: "build" }], BLOCKED: "blocked" }),
    build: on({ DONE: [{ target: "diagnosed", guard: "done:diagnosis" }, { target: "review" }], BLOCKED: "blocked", LAP: laps("build") }),
    "build:ui": on({ DONE: "review", BLOCKED: "blocked", LAP: laps("build:ui") }),
    review: on({
      PASS: [{ target: "review:ui", guard: "class:ui" }, { target: "ship" }],
      FAIL: retries("build"),
      BLOCKED: "blocked",
      LAP: laps("review"),
      WIP: "queued",
    }),
    "review:ui": on({ PASS: "ship", FAIL: retries("build:ui"), BLOCKED: "blocked" }),
    ship: on({
      LAP: [{ target: "build", guard: "lap:base-conflicted" }, ...laps("ship")],
      DONE: [{ target: "queued", guard: "merge:partial" }, { target: "shipped" }],
      WIP: "ship:queued",
      BLOCKED: "human:cp-approval",
      FAIL: retries("build"),
    }),
    "ship:queued": on({
      LAP: laps("ship"),
      DONE: [{ target: "queued", guard: "merge:partial" }, { target: "shipped" }],
      BLOCKED: "human:cp-approval",
      WIP: budget("ship:queued", "waitsRemaining", "human:queue-stall"),
      FAIL: retries("build"),
    }),
    blocked: on({ UNBLOCKED: "hist" }),
    "human:cp-approval": on({ UNBLOCKED: "hist" }),
    "human:queue-stall": on({ UNBLOCKED: "hist" }),
    "human:machinery-stall": on({ UNBLOCKED: "hist" }),
    "human:budget-spent": { type: "final", ...on({ UNBLOCKED: "hist" }) },
    hist: { type: "history" },
    shipped: { type: "final" },
    diagnosed: { type: "final" },
  };
}

const terminals = { complete: { type: "final" }, tripped: { type: "final" } };
const phase = (tasks: Record<string, unknown>, next: string) => ({
  type: "parallel",
  states: tasks,
  onDone: [{ target: next, guard: "noErrors" }, { target: "tripped" }],
});

/** One issue's lane: a single task, `issue`. `classes`: what the lane's diff is, when it is known at boot. */
export function issueWorkflow(classes: readonly string[] = []): unknown {
  return {
    id: "coder",
    version: 1,
    machine: {
      id: "coder",
      initial: "pipeline",
      context: { issue: { retries: 0, maxRetries: 3, classes, laps: 0, maxLaps: 16 } },
      states: { pipeline: phase({ issue: { initial: "queued", states: issueStates("ISSUE") } }, "complete"), ...terminals },
    },
  };
}

/** An epic's child: built and reviewed like an issue, then landed on the epic's branch instead of shipped. */
function childStates(task: string): Record<string, unknown> {
  const on = (arms: Record<string, unknown>) => ({ on: Object.fromEntries(Object.entries(arms).map(([event, to]) => [`${task}.${event}`, to])) });
  return {
    queued: on({ WIP: "build", BLOCKED: "blocked" }),
    build: on({ DONE: "review", BLOCKED: "blocked" }),
    review: on({ PASS: "integrate", FAIL: retries("build"), BLOCKED: "blocked" }),
    integrate: on({ DONE: "landed", FAIL: retries("build"), BLOCKED: "blocked" }),
    blocked: on({ UNBLOCKED: "hist" }),
    "human:budget-spent": { type: "final", ...on({ UNBLOCKED: "hist" }) },
    hist: { type: "history" },
    landed: { type: "final" },
  };
}

/** A small epic: two children in the first phase, then the epic's own task, which ships. */
export function epicWorkflow(): unknown {
  return {
    id: "epic-1",
    version: 1,
    machine: {
      id: "epic-1",
      initial: "phase1",
      context: {},
      states: {
        phase1: phase(
          { issue_2: { initial: "queued", states: childStates("ISSUE_2") }, issue_3: { initial: "queued", states: childStates("ISSUE_3") } },
          "epic",
        ),
        epic: phase({ epic_1: { initial: "review", states: issueStates("EPIC_1") } }, "complete"),
        ...terminals,
      },
    },
  };
}

/**
 * A log, written short: each line is `EVENT` or `task.EVENT`, then any fields
 * as JSON. Lines are stamped a minute apart from `start`, or `+<minutes>`
 * after the line before.
 *
 *   log("WIP", "DONE", "+7 PASS", 'BLOCKED {"cause":"head-ci-red"}')
 */
export function log(...lines: readonly string[]): string {
  let at = Date.parse("2026-01-01T00:00:00.000Z");
  return lines
    .map((line) => {
      const [, gap, name, fields] = /^(?:\+(\d+(?:\.\d+)?) )?([\w.]+)(?: (\{.*\}))?$/.exec(line) ?? [];
      if (name === undefined) throw new Error(`not a log line: ${line}`);
      at += (gap === undefined ? 1 : Number(gap)) * 60_000;
      const [task, event] = name.includes(".") ? (name.split(".") as [string, string]) : ["issue", name];
      const spelled = `${task.toUpperCase()}.${event}`;
      return JSON.stringify({ task, event: spelled, at: new Date(at).toISOString(), ...(fields === undefined ? {} : JSON.parse(fields)) });
    })
    .join("\n");
}
