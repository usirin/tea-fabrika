import { defineMachine, type Sub, type TimerSub } from "@demlik/tea";
import { allOver, type Children, type RepliesDeps, slotSubs, spawn, stepChild } from "./combos.ts";
import type { DraftRun } from "./draft.ts";
import { type Claimed, type LaneView, routeOf } from "./fabrika.ts";
import { intentOf } from "./primitives.ts";
import {
  type ClaimCmd,
  type CloseCmd,
  claimLane,
  DEFS,
  defaultKnobs,
  finishLane,
  isSettle,
  type Knobs,
  makeTree,
  type OperatorCmd,
  parkAsk,
  type Pass,
  ranOf,
  readLane,
  releaseLane,
  removeTree,
  type TreeCmd,
  type Settle,
  type ShellRow,
  shellDraft,
  type Step,
  startTurn,
  stepTurn,
  type Turn,
  type TurnMsg,
  timerOf,
  turnInFlight,
  type ViewCmd,
} from "./turn.ts";

// The operator, as primitives joined by hand. Today an agent reads the operate
// skill (2,556 lines) and drives a lane: read the fold, spawn the shell its
// state names, read the fold again, park to a person. Here that loop is code:
//
//   claim                   Act
//   make the working copy   Act, the copy named in the state first
//   read the lane           Gather
//   per active task         spawn: one turn each (src/turn.ts)
//     route by state name   a code table (src/fabrika.ts), type-blind
//     queued                remember: Act "started", Gather it back
//     a stage               Gather the brief, Act "dispatched", Draft the shell
//                           (it records its own result), Gather: did it land?
//                           If not, remember its last word, or that it died
//     review                Gather the pull request first; Listen while its
//                           checks run or nobody can say whether it merges
//     the merge queue       Listen; remember what it did
//     a park                gate: a known recipe is an Act, tried again on a
//                           clock; anything else is ask (Act a question, Listen
//                           for the reply, read it by code or a Judge)
//   all turns over          read the lane again, and loop
//   the end, however        Act: post the record (a lane that landed or tripped),
//                           remove the working copy, let go of the lane
//
// The machine's own spend is code, plus one Jev call per reply a person
// writes in words.

export type { Knobs, ShellRow, Turn };
export { defaultKnobs };

export interface Log {
  readonly shells: readonly ShellRow[];
  /** Cmds the machine sent, Jev's among them. */
  readonly cmds: number;
  readonly jev: number;
  readonly passes: number;
}

/** How a run ended. */
export type End =
  | { readonly kind: "terminal"; readonly status: Exclude<LaneView["status"], "active"> }
  | { readonly kind: "parked"; readonly why: string }
  /** No claim: another driver has the lane, no seat is free, or it is not a lane to drive. */
  | { readonly kind: "unclaimed"; readonly why: Extract<Claimed, { won: false }>["why"]; readonly detail: string }
  | { readonly kind: "stopped"; readonly why: string };

type Closing = "finish" | "remove" | "release";

interface Running {
  /** This run's name: every intent and conversation id starts with it. */
  readonly run: string;
  readonly lane: string;
  readonly knobs: Knobs;
  readonly log: Log;
}

/**
 * A run that holds the lane, and the working copy it made for it. The tree is
 * named in the state before the Act that makes it goes out, so a restart
 * neither makes a second one nor forgets the first, and every way out of
 * here passes through `closing`, which removes it.
 */
interface Holding extends Running {
  readonly token: string;
  readonly tree: string;
}

export type Operator =
  | { readonly phase: "idle" }
  | (Running & { readonly phase: "claiming"; readonly asked: ClaimCmd })
  | (Holding & { readonly phase: "making"; readonly asked: TreeCmd })
  | (Holding & { readonly phase: "reading"; readonly pass: number; readonly asked: ViewCmd })
  | (Holding & {
      readonly phase: "driving";
      readonly pass: number;
      readonly issue: string;
      readonly turns: Children<Turn>;
    })
  | (Holding & {
      readonly phase: "closing";
      readonly end: End;
      /** The steps after the one in flight. */
      readonly steps: readonly Closing[];
      readonly asked: CloseCmd;
      /** Whether the tree is gone yet. */
      readonly removed: boolean;
    })
  /** `tree`: the one the run made, `null` when it made none; `removed`: whether it is gone. */
  | (Running & { readonly phase: "ended"; readonly end: End; readonly tree: string | null; readonly removed: boolean });

export type OperatorMsg =
  | { readonly type: "start"; readonly run: string; readonly lane: string; readonly knobs: Knobs }
  /** Sent once after booting from saved state: ask again whatever was in flight. */
  | { readonly type: "resume" }
  | TurnMsg;

type AnyMsg = OperatorMsg | Settle;

const emptyLog: Log = { shells: [], cmds: 0, jev: 0, passes: 0 };
const running = (s: Running): Running => ({ run: s.run, lane: s.lane, knobs: s.knobs, log: s.log });
const holding = (s: Holding): Holding => ({ ...running(s), token: s.token, tree: s.tree });

function closeCmd(s: Holding, step: Closing): CloseCmd {
  const intent = intentOf(s.run, "end", step);
  switch (step) {
    case "finish":
      return finishLane({ lane: s.lane, intent });
    case "remove":
      return removeTree({ name: s.tree, intent });
    case "release":
      return releaseLane({ lane: s.lane, token: s.token, intent });
  }
}

/**
 * The end, whatever it is: a lane that landed or tripped posts its record
 * first; every run then removes its tree and lets go of the lane.
 */
function closing(s: Holding, end: End): Step<Operator> {
  const record = end.kind === "terminal" && end.status !== "cancelled";
  const [first, ...steps] = (record ? ["finish", "remove", "release"] : ["remove", "release"]) as [Closing, ...Closing[]];
  const asked = closeCmd(s, first);
  return [{ ...holding(s), phase: "closing", end, steps, asked, removed: false }, [asked]];
}

function reading(s: Holding, pass: number): Step<Operator> {
  const asked = readLane({ key: "", lane: s.lane });
  return [{ ...holding(s), log: { ...s.log, passes: pass }, phase: "reading", pass, asked }, [asked]];
}

/** A fresh read of the lane: end it, or spawn a turn for each active task that is not finished. */
function drive(s: Extract<Operator, { phase: "reading" }>, view: LaneView): Step<Operator> {
  if (view.status !== "active") return closing(s, { kind: "terminal", status: view.status });
  const spent = s.log.shells.reduce((sum, r) => sum + r.spend.costUsd, 0);
  if (spent >= s.knobs.maxRunUsd) {
    const why = `the run's shells have cost $${spent.toFixed(2)}, past its limit of $${s.knobs.maxRunUsd}`;
    return closing(s, { kind: "stopped", why });
  }
  const open = view.tasks.filter((t) => routeOf(t.state)?.kind !== "final");
  if (open.length === 0) return closing(s, { kind: "stopped", why: "the lane is active and has no task to drive" });
  const p: Pass = { run: s.run, lane: s.lane, pass: s.pass, issue: view.issue, tree: s.tree, knobs: s.knobs };
  let turns: Children<Turn> = {};
  const cmds: OperatorCmd[] = [];
  for (const task of open) {
    const [turn, out] = startTurn(task, p);
    const next = spawn(turns, task.task, turn, s.knobs.slots);
    if (next === null) break; // every slot is taken: the rest wait for the next pass
    turns = next;
    cmds.push(...out);
  }
  const driving = { ...holding(s), phase: "driving" as const, pass: s.pass, issue: view.issue, turns };
  return joined(driving, cmds);
}

/** Once every turn is over: stop, park, or read the lane again. */
function joined(s: Extract<Operator, { phase: "driving" }>, cmds: readonly OperatorCmd[]): Step<Operator> {
  if (!allOver(s.turns, (t) => t.phase === "over")) return [s, cmds];
  const ends = Object.values(s.turns).flatMap((c) => (c.state.phase === "over" ? [{ task: c.state.task, end: c.state.end }] : []));
  const whys = (kind: "stopped" | "parked") =>
    ends.flatMap((e) => (e.end.kind === kind ? [`${e.task}: ${e.end.why}`] : [])).join("; ");
  if (whys("stopped") !== "") return closing(s, { kind: "stopped", why: whys("stopped") });
  if (whys("parked") !== "") return closing(s, { kind: "parked", why: whys("parked") });
  const [next, more] = reading(s, s.pass + 1);
  return [next, [...cmds, ...more]];
}

/** Which turn a Msg is for: the key on its Cmd, or on the Msg itself. `null`: the run's own. */
function keyOf(m: AnyMsg): string | null {
  if (isSettle(m)) return typeof m.cmd.key === "string" && m.cmd.key !== "" ? m.cmd.key : null;
  return "key" in m && typeof m.key === "string" ? m.key : null;
}

function step(s: Operator, m: AnyMsg): Step<Operator> {
  if (m.type === "start") {
    if (s.phase !== "idle") return [s, []];
    const asked = claimLane({ lane: m.lane, intent: intentOf(m.run, "claim") });
    return [{ run: m.run, lane: m.lane, knobs: m.knobs, log: emptyLog, phase: "claiming", asked }, [asked]];
  }
  if (m.type === "resume") return resumed(s);
  switch (s.phase) {
    case "claiming": {
      if (m.type === claimLane.errType) return [ended(s, { kind: "stopped", why: "the claim could not be read or written" }), []];
      if (m.type !== claimLane.okType) return [s, []];
      const claimed = (m as { value: Claimed }).value;
      if (!claimed.won) return [ended(s, { kind: "unclaimed", why: claimed.why, detail: claimed.detail }), []];
      // The tree is named here, in the state, before the Act that makes it.
      const tree = `${s.lane}-${s.run}`;
      const asked = makeTree({ name: tree, intent: intentOf(s.run, "tree") });
      return [{ ...running(s), phase: "making", token: claimed.token, tree, asked }, [asked]];
    }
    case "making":
      if (m.type === makeTree.errType) return closing(s, { kind: "stopped", why: "the working copy could not be made" });
      return m.type === makeTree.okType ? reading(s, 1) : [s, []];
    case "reading":
      if (keyOf(m) !== null) return [s, []];
      if (m.type === readLane.errType) return closing(s, { kind: "stopped", why: "the lane could not be read" });
      return m.type === readLane.okType ? drive(s, (m as { value: LaneView }).value) : [s, []];
    case "driving": {
      const key = keyOf(m);
      const turn = key === null ? undefined : s.turns[key];
      if (key === null || turn === undefined) return [s, []];
      const ran = ranOf(turn.state, m);
      const p: Pass = { run: s.run, lane: s.lane, pass: s.pass, issue: s.issue, tree: s.tree, knobs: s.knobs };
      const [turns, cmds] = stepChild(s.turns, key, (t) => stepTurn(t, m, p));
      const log = ran === null ? s.log : { ...s.log, shells: [...s.log.shells, ran] };
      return joined({ ...s, turns, log }, cmds);
    }
    case "closing": {
      if (m.type !== `${s.asked.type}_ok` && m.type !== `${s.asked.type}_err`) return [s, []];
      // A step that fails does not hold the next: a lane left claimed is worse than one left untidy.
      const removed = s.removed || m.type === removeTree.okType;
      const [next, ...steps] = s.steps;
      if (next === undefined) return [{ ...running(s), phase: "ended", end: s.end, tree: s.tree, removed }, []];
      const asked = closeCmd(s, next);
      return [{ ...s, steps, asked, removed }, [asked]];
    }
    default:
      return [s, []];
  }
}

const ended = (s: Running, end: End): Operator => ({ ...running(s), phase: "ended", end, tree: null, removed: false });

function resumed(s: Operator): Step<Operator> {
  switch (s.phase) {
    case "claiming":
    case "making":
    case "reading":
    case "closing":
      return [s, [s.asked]];
    case "driving":
      return [s, Object.values(s.turns).flatMap((c) => turnInFlight(c.state))];
    default:
      return [s, []];
  }
}

/** The machine's update: one step, and a count of what went out and how much of it was Jev. */
export function update(s: Operator, m: AnyMsg): Step<Operator> {
  const [next, cmds] = step(s, m);
  if (next.phase === "idle" || cmds.length === 0) return [next, cmds];
  const jev = cmds.filter((c) => c.type === parkAsk.judge.ask.cmdType).length;
  return [{ ...next, log: { ...next.log, cmds: next.log.cmds + cmds.length, jev: next.log.jev + jev } }, cmds];
}

// ---------------------------------------------------------------- the Subs

export interface AtDeps {
  readonly key: string;
  readonly lane: string;
  readonly task: string;
}

export type OperatorSub =
  | Sub<"shell", DraftRun>
  | Sub<"pr_watch", AtDeps>
  | Sub<"queue", AtDeps>
  | Sub<"park_replies", RepliesDeps>
  | TimerSub<OperatorMsg>;

const turnsOf = (s: Operator) => (s.phase === "driving" ? s.turns : null);
const at = (t: Turn, s: Operator): AtDeps => ({ key: t.task, lane: s.phase === "idle" ? "" : s.lane, task: t.task });

/** Each kind of thing a turn may listen to, one entry per slot. */
function subsFor(slots: number) {
  return [
    ...slotSubs(slots, "shell", turnsOf, (t: Turn) => (t.phase === "drafting" ? t.run : null)),
    ...slotSubs(slots, "pr_watch", turnsOf, (t: Turn, s: Operator) => (t.phase === "pr_waiting" ? at(t, s) : null)),
    ...slotSubs(slots, "queue", turnsOf, (t: Turn, s: Operator) => (t.phase === "queued" ? at(t, s) : null)),
    ...slotSubs(slots, "park_replies", turnsOf, (t: Turn) => (t.phase === "asking" ? parkAsk.listening(t.ask) : null)),
    ...slotSubs(slots, "timer", turnsOf, (t: Turn, s: Operator) => (s.phase === "driving" ? timerOf(t, s.knobs) : null)),
  ];
}

/** Every Msg type the machine has a cell for: its own, and each Cmd's two answers. */
const MSG_TYPES = [
  "start",
  "resume",
  shellDraft.types.tool,
  shellDraft.types.finished,
  shellDraft.types.failed,
  "pr_read",
  "queue_read",
  "park_reply",
  "shell_overtime",
  "recheck",
  "queue_stalled",
  ...DEFS.flatMap((d) => [d.okType, d.errType]),
];

/**
 * The operator machine. Its number of slots is fixed when it is made, because
 * tea's subs are a fixed list; a run's `knobs.slots` must not be larger. One
 * update function, routed inside by Msg type the way Elm's `case msg of` is:
 * tea wants a cell per type, so every type gets the same cell.
 */
export function createOperator(slots = defaultKnobs.slots) {
  return defineMachine({
    types: { model: {} as Operator, msg: {} as OperatorMsg, sub: {} as OperatorSub, ctx: undefined },
    cmds: DEFS,
    init: (loaded) => [loaded ?? { phase: "idle" }, []],
    update: Object.fromEntries(MSG_TYPES.map((type) => [type, update])) as never,
    subs: subsFor(slots) as never,
  });
}
