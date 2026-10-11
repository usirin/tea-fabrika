import type { Sub } from "@demlik/tea";
import { run } from "@demlik/tea/effect";
import { Effect, Layer, Stream } from "effect";
import { type Reply, Thread } from "./combos.ts";
import type { DraftRun, Spend } from "./draft.ts";
import {
  type DriverFact,
  Fabrika,
  hasRecipe,
  type LaneView,
  ParkCause,
  type PrState,
  type QueueReading,
  routeOf,
  type Shell,
  type TaskView,
  type Unparked,
  Worktrees,
} from "./fabrika.ts";
import {
  applyCorrections,
  BOARD_TERMINALS,
  type CompiledLane,
  type CompiledTask,
  isPark,
  type LogEntry,
  stageOf,
  statusOf,
  stepTask,
  type TaskState,
} from "./lane-log.ts";
import { createOperator, defaultKnobs, type End, type Knobs, type Operator, type OperatorMsg } from "./operator.ts";
import { operatorInterpret, operatorSubscribe } from "./operator-host.ts";
import { scriptedJev } from "./scripted.ts";

// A lane that already happened, served to the operator machine as its world.
// The lane's own `workflow.json` folds it (src/lane-log.ts) and its recorded
// events are what lands: when the machine starts a shell, the shell "reports"
// the next line of the log; when it reads the merge queue, the reading is
// what the next line says the queue did; when it tries a park's recipe, the
// recipe clears it if the log's next line is the unblock.
//
// So the machine is asked, state by state, the one thing a log can check: in
// the state the lane really stood in, does the machine make a move that the
// lane's next real event can follow? It cannot say whether the shells would
// have done the same work, or how long anything took.
//
// What comes from outside the lane is applied from outside: a round a person
// cleared, and an end the board proved (the issue closed, or shipped by hand).

/** The shell fabrika briefs for a state, by the state's name. `null`: not a state a shell works in. */
const SHELLS: Readonly<Record<string, Shell>> = {
  build: "builder",
  "build:ui": "ui-builder",
  "build:mixed": "mixed-builder",
  review: "reviewer",
  "review:ui": "ui-reviewer",
  ship: "shipper",
};

const NO_SPEND: Spend = { costUsd: 0, tokens: 0, context: 0, turns: 0, minutes: 0 };
const PERSON = "person";

/** One park the machine met, and what it did about it. */
export interface ParkMet {
  readonly task: string;
  readonly state: string;
  /** The cause the log recorded, whether or not the machine knows the word. */
  readonly cause: string | null;
  /** `recipe`: code tried the park's recipe. `asked`: a question went to a person. A park can be both. */
  readonly recipe: boolean;
  readonly asked: boolean;
  /** How it left the park in the replay. `null`: it did not. */
  readonly cleared: "recipe" | "person" | null;
}

/**
 * Whose move landed one of the log's events in a replay. `shell`: a shell's
 * own report, which tests nothing of the machine. The machine's own writes:
 * `start`, `queue`, `dead_shell`, `conflict`, `rewind`, `recipe`, and
 * `person` (a clearance on a person's answer). `wait`: a wait in the merge
 * queue, which the machine listens through and never writes. `outside`: a
 * person's cleared round, or an end the board proved.
 */
export type Landed = "shell" | "start" | "queue" | "dead_shell" | "conflict" | "rewind" | "recipe" | "person" | "wait" | "outside";

interface TaskWorld {
  s: TaskState;
  /** The task's recorded events not yet landed. */
  rest: LogEntry[];
  seq: number;
  pr: string | null;
  /** Why it is parked, as the log said. */
  cause: string | null;
  /** A build has reported, so a pull request stands even where an old line names none. */
  built: boolean;
  /** A person cleared a repair round while it was parked: their answer was "one more round". */
  granted: boolean;
}

export function recordedLane(name: string, lane: CompiledLane, log: readonly LogEntry[]) {
  const issue = `https://github.com/example/repo/issues/${name}`;
  const world: Record<string, TaskWorld> = {};
  for (const [task, compiled] of Object.entries(lane.tasks)) {
    world[task] = { s: compiled.initial, rest: [], seq: 0, pr: null, cause: null, built: false, granted: false };
  }
  for (const entry of applyCorrections(log)) {
    if (entry.event !== "AMENDED") world[entry.task]?.rest.push(entry);
  }
  const total = Object.values(world).reduce((n, w) => n + w.rest.length, 0);

  /** What the replay saw, for the caller to read once the run has ended. */
  const seen = {
    shells: [] as Shell[],
    parks: [] as ParkMet[],
    /** The log ended while the machine still had a move to make: the lane never finished. */
    ranOut: null as string | null,
    /** The machine's move cannot be followed by the lane's next real event. */
    diverged: null as { readonly state: string; readonly why: string } | null,
    /** The lane was ended from outside it, by the board. */
    board: false,
    questions: 0,
    /** How each of the log's events landed in the replay: by whose move. */
    by: {} as Partial<Record<Landed, number>>,
  };

  const compiled = (task: string) => lane.tasks[task] as CompiledTask;
  const at = (task: string) => world[task] as TaskWorld;

  function land(task: string, entry: LogEntry, how: Landed): void {
    const w = at(task);
    const step = stepTask(compiled(task), w.s, entry);
    seen.by[how] = (seen.by[how] ?? 0) + 1;
    w.rest.shift();
    w.s = step.after;
    w.seq += 1;
    if (entry.pr !== null) w.pr = entry.pr;
    if (entry.event === "DONE" && stageOf(step.from) === "build") w.built = true;
    if (entry.event === "BLOCKED") w.cause = entry.cause;
    else if (!isPark(step.to)) w.cause = null;
    if (entry.event === "CLEARED") w.granted = true;
    else if (!isPark(step.to)) w.granted = false;
  }

  /** The task's next real event, once a person's cleared rounds before it are in. */
  function head(task: string): LogEntry | null {
    const w = at(task);
    while (w.rest[0]?.event === "CLEARED") land(task, w.rest[0], "outside");
    return w.rest[0] ?? null;
  }

  const diverge = (task: string, why: string): false => {
    seen.diverged ??= { state: at(task).s.state, why };
    return false;
  };
  /** The log has nothing more for this task: the lane stopped here in real life. */
  const out = (task: string): false => {
    seen.ranOut ??= at(task).s.state;
    return false;
  };

  /** Land the next event if it is one of `events`; otherwise say why the machine's move does not fit. */
  function follow(task: string, how: Landed, move: string, events: readonly string[]): boolean {
    const next = head(task);
    if (next === null) return out(task);
    if (!events.includes(next.event)) return diverge(task, `the machine ${move}; the log has ${next.event}${next.cause === null ? "" : ` (${next.cause})`}`);
    land(task, next, how);
    return true;
  }

  function parkOf(task: string): ParkMet {
    const w = at(task);
    const last = seen.parks.at(-1);
    if (last !== undefined && last.task === task && last.cleared === null) return last;
    const met: ParkMet = { task, state: w.s.state, cause: causeOf(task), recipe: false, asked: false, cleared: null };
    seen.parks.push(met);
    return met;
  }
  const amend = (met: ParkMet, more: Partial<ParkMet>) => {
    seen.parks[seen.parks.lastIndexOf(met)] = { ...met, ...more };
  };

  /**
   * Why a task is parked. A spent budget parks with no `BLOCKED` line, so its
   * state names its cause. An old line with no cause stays without one, even
   * in `human:cp-approval`: later lines show that state holds three causes.
   */
  function causeOf(task: string): string | null {
    const w = at(task);
    return w.cause ?? (w.s.state === "human:budget-spent" ? "repair-budget-spent" : null);
  }

  function view(): LaneView {
    // What the board proved arrives whatever the lane is doing.
    for (const task of Object.keys(world)) {
      const next = head(task);
      if (next !== null && Object.hasOwn(BOARD_TERMINALS, next.event)) {
        land(task, next, "outside");
        seen.board = true;
      }
    }
    const states = Object.fromEntries(Object.entries(world).map(([task, w]) => [task, w.s]));
    const { status, phase } = statusOf(lane, states);
    // A tripped lane is shown as its parked task: a person can still open it.
    const tripped = status === "tripped";
    const active = lane.phases.find((p) =>
      tripped ? p.tasks.some((t) => compiled(t).errorFinals.has(at(t).s.state)) : p.name === phase,
    );
    const tasks: TaskView[] = (active?.tasks ?? []).map((task) => {
      const w = at(task);
      const cause = ParkCause.safeParse(isPark(w.s.state) ? causeOf(task) : null);
      return {
        task,
        state: w.s.state,
        cause: cause.success ? cause.data : null,
        pr: w.pr ?? (w.built ? "https://github.com/example/repo/pull/0" : null),
        seq: w.seq,
      };
    });
    return {
      lane: name,
      issue,
      status: status === "active" || tripped ? "active" : status === "board:cancelled" ? "cancelled" : "done",
      tasks,
    };
  }

  function record(task: string, fact: DriverFact): boolean {
    switch (fact.kind) {
      case "started":
        return follow(task, "start", "starts the build", ["WIP"]);
      case "shell_dead":
        return follow(task, "dead_shell", "records a dead shell", ["LAP", "BLOCKED"]);
      case "base_conflicted":
        return follow(task, "conflict", "records a conflict", ["LAP"]);
      case "rewind":
        return follow(task, "rewind", "rewinds the review", ["WIP"]);
      case "queue":
        switch (fact.reading) {
          case "landed":
            return follow(task, "queue", "records the landing", ["DONE"]);
          case "ejected":
            return follow(task, "queue", "records the ejection", ["FAIL", "LAP"]);
          case "parked":
            return follow(task, "queue", "records the queue's park", ["BLOCKED"]);
          case "stalled":
            return follow(task, "queue", "records a stalled queue", ["WIP"]);
        }
        return false;
      case "token":
      case "park":
        return diverge(task, `the machine writes a ${fact.kind} the log has no line for`);
    }
  }

  /** The merge queue, as the task's next event says it went. A plain wait is passed over: the machine's wait is a Listen. */
  function queue(task: string): QueueReading {
    const w = at(task);
    if (w.s.state !== "ship:queued") return "waiting";
    const next = head(task);
    if (next === null) {
      out(task);
      return "waiting";
    }
    switch (next.event) {
      case "DONE":
        return "landed";
      case "FAIL":
      case "LAP":
        return "ejected";
      case "BLOCKED":
        return "parked";
      case "WIP":
        // The wait that spends the budget is the stall: the machine's own clock records that one.
        if (stepTask(compiled(task), w.s, next).to === "ship:queued") land(task, next, "wait");
        return "waiting";
      default:
        diverge(task, `the machine listens to the merge queue; the log has ${next.event}`);
        return "waiting";
    }
  }

  const unknown = Effect.fail({ _tag: "unknown" } as const);

  const layer = Layer.succeed(Fabrika, {
    claim: () => Effect.succeed({ won: true as const, token: "token" }),
    // Once the log has run out or the machine has left it, there is no world left to read.
    view: () => (seen.ranOut !== null || seen.diverged !== null ? unknown : Effect.sync(view)),
    brief: ({ task }) =>
      Effect.sync(() => {
        const w = at(task);
        const shell = SHELLS[w.s.state];
        if (shell === undefined) return { ok: false as const, why: "no_shell" as const };
        // A review whose pull request was pointed elsewhere goes back to the queue: the log's `WIP` out of review.
        if (stageOf(w.s.state) === "review" && head(task)?.event === "WIP") return { ok: false as const, why: "pr_repointed" as const };
        return { ok: true as const, brief: { shell, prompt: `brief for ${w.s.state}`, issue, pr: w.pr } };
      }),
    pr: ({ task }) =>
      Effect.sync((): PrState => {
        const next = head(task);
        const conflicted = next?.event === "LAP" && next.cause === "base-conflicted" && stageOf(at(task).s.state) === "review";
        return { mergeable: conflicted ? "conflicting" : "mergeable", checks: "green" };
      }),
    queue: ({ task }) => Effect.sync(() => queue(task)),
    dispatched: () => Effect.void,
    record: ({ task, fact }) => Effect.sync(() => record(task, fact)),
    unpark: ({ task }) =>
      Effect.sync((): Unparked => {
        const met = parkOf(task);
        amend(met, { recipe: true });
        if (!hasRecipe(met.state, ParkCause.safeParse(met.cause).data ?? null)) return "novel";
        if (head(task)?.event !== "UNBLOCKED") return "not_yet";
        land(task, head(task) as LogEntry, "recipe");
        amend(parkOf(task), { cleared: "recipe" });
        return "cleared";
      }),
    clear: ({ task }) =>
      Effect.sync(() => {
        const met = parkOf(task);
        if (!follow(task, "person", "clears the park on a person's word", ["UNBLOCKED"])) return false;
        amend(met, { cleared: "person" });
        return true;
      }),
    finish: () => Effect.void,
    release: () => Effect.void,
  });

  const worktrees = Layer.succeed(Worktrees, { make: () => Effect.void, remove: () => Effect.void });

  /** A person answers when the log shows the park was cleared: `/more` after a cleared round, `/resume` otherwise. */
  const replies = new Map<string, Reply>();
  const thread = Layer.succeed(Thread, {
    post: ({ intent }) =>
      Effect.sync(() => {
        const task = intent.split("/")[1] ?? "";
        const met = parkOf(task);
        amend(met, { asked: true });
        seen.questions += 1;
        const posted = seen.questions * 1_000;
        const name = `question-${seen.questions}`;
        if (head(task)?.event === "UNBLOCKED") {
          replies.set(name, { id: name, author: PERSON, body: at(task).granted ? "/more" : "/resume", at: posted + 1 });
        }
        return { thread: name, at: posted };
      }),
    replies: (name, after) => Stream.fromIterable([...replies.entries()].flatMap(([t, r]) => (t === name && r.at > after ? [r] : []))),
  });

  /** A shell "runs": the task's next recorded event lands as its report, or it dies where the log says a spawn died. */
  const shellRunner = (sub: Sub<"shell", DraftRun>): Stream.Stream<OperatorMsg> =>
    Stream.unwrap(
      Effect.sync((): Stream.Stream<OperatorMsg> => {
        const { key, id } = sub.deps;
        const w = at(key);
        const shell = SHELLS[w.s.state];
        if (shell !== undefined) seen.shells.push(shell);
        const next = head(key);
        const failed: OperatorMsg = { type: "shell_failed", key, id, error: "ended with no report", spend: NO_SPEND };
        if (next === null) {
          out(key);
          return Stream.make(failed);
        }
        if (next.cause === "spawn-dead" && (next.event === "LAP" || next.event === "BLOCKED")) return Stream.make(failed);
        if (compiled(key).cells[w.s.state]?.[next.event] === undefined) {
          diverge(key, `the machine runs the ${shell ?? "shell"}; the log has ${next.event}, which \`${w.s.state}\` has no arm for`);
          return Stream.make(failed);
        }
        land(key, next, "shell");
        const done: OperatorMsg = {
          type: "shell_finished",
          key,
          id,
          output: { token: next.event, pr: w.pr },
          session: sub.deps.session.id,
          spend: NO_SPEND,
        };
        return Stream.make(done);
      }),
    );

  return {
    layer: Layer.mergeAll(layer, worktrees),
    thread,
    shellRunner,
    seen,
    /** How many of the log's events have landed, of how many. */
    landed: () => total - Object.values(world).reduce((n, w) => n + w.rest.length, 0),
    total,
    states: () => Object.fromEntries(Object.entries(world).map(([task, w]) => [task, w.s.state])),
  };
}

// ---------------------------------------------------------------- one replay

/**
 * How a replay came out.
 *
 * - `same`: the machine walked the whole log and ended where the lane ended
 * - `board`: the same, and the lane's end was the board's, not the lane's own
 * - `ran_out`: the log ends mid-lane; the machine agreed with it as far as it goes
 * - `stopped`: the machine stopped by its own rule (a state it does not drive)
 * - `diverged`: the machine made a move the lane's next real event cannot follow
 * - `hung`: the replay did not end
 */
export type ReplayOutcome = "same" | "board" | "ran_out" | "stopped" | "diverged" | "hung";

export interface Replay {
  readonly outcome: ReplayOutcome;
  /** For `stopped` and `diverged`: why, with the task's name taken out. */
  readonly why: string | null;
  /** The state the machine stopped or diverged in, or the log ran out in. */
  readonly state: string | null;
  readonly end: End | null;
  readonly shells: readonly Shell[];
  readonly parks: readonly ParkMet[];
  /** How many of the log's events each kind of move landed. */
  readonly by: Readonly<Partial<Record<Landed, number>>>;
  readonly cmds: number;
  readonly passes: number;
  /** The log's events the replay landed, of how many. */
  readonly landed: number;
  readonly total: number;
}

/** Knobs for a replay: nothing in a log needs waiting for, so every clock is short. */
export const replayKnobs: Knobs = {
  ...defaultKnobs,
  slots: 4,
  recheckMs: 60_000,
  rechecks: 0,
  queueStallMs: 40,
  msPerMinute: 1_000,
  who: [PERSON],
  maxRunUsd: 1_000_000,
  askWaitMs: 25,
};

const NO_SHELLS = { trees: "", plugin: "", alsoWritable: [], model: "", effort: "medium", maxShellUsd: 0 } as const;

/** Drive the operator machine over one recorded lane, on the Effect engine, with the lane's log as its world. */
export async function replayLane(name: string, lane: CompiledLane, log: readonly LogEntry[], knobs: Knobs = replayKnobs): Promise<Replay> {
  const recorded = recordedLane(name, lane, log);
  const program = Effect.gen(function* () {
    const handle = yield* run(createOperator(knobs.slots), {
      ctx: undefined,
      interpret: operatorInterpret("replay"),
      subscribe: { ...operatorSubscribe({ pollMs: 1, shell: NO_SHELLS }), shell: recorded.shellRunner },
      terminal: (s: Operator) => s.phase === "ended",
    });
    const runtime = yield* handle.ready;
    yield* runtime.dispatch({ type: "start", run: "replay", lane: name, knobs });
    return yield* runtime.done().pipe(Effect.timeout("10 seconds"));
  });
  const services = Layer.mergeAll(recorded.layer, recorded.thread, scriptedJev([]));
  const ended = await Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(services), Effect.option));
  const { seen } = recorded;
  const base = { shells: seen.shells, parks: seen.parks, by: seen.by, landed: recorded.landed(), total: recorded.total };
  if (ended._tag === "None" || ended.value.phase !== "ended") {
    return { ...base, outcome: "hung", why: null, state: null, end: null, cmds: 0, passes: 0 };
  }
  const { end, log: ran } = ended.value;
  const counted = { ...base, end, cmds: ran.cmds, passes: ran.passes };
  if (seen.diverged !== null) return { ...counted, outcome: "diverged", why: seen.diverged.why, state: seen.diverged.state };
  // A stop by the machine's own rule counts before a log that ran out: with several tasks, both can be true.
  const ownRule = end.kind === "stopped" && /no route for the state|not built here yet|names no pull request|fabrika briefs/.test(end.why);
  if (seen.ranOut !== null && !ownRule) return { ...counted, outcome: "ran_out", why: null, state: seen.ranOut };
  if (end.kind === "stopped") {
    const states = Object.values(recorded.states());
    // The stop names its state, or it is the one state the table knows and does not drive.
    const state = states.find((s) => end.why.includes(`\`${s}\``)) ?? states.find((s) => routeOf(s)?.kind === "unbuilt") ?? null;
    return { ...counted, outcome: "stopped", why: end.why.replace(/^[^:]+: /, ""), state };
  }
  if (recorded.landed() < recorded.total) {
    return { ...counted, outcome: "diverged", why: `the run ended ${end.kind} with the log not used up`, state: null };
  }
  return { ...counted, outcome: seen.board ? "board" : "same", why: null, state: null };
}
