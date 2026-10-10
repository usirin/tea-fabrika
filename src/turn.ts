import { z } from "zod";
import { type Asking, createAsk, gateJudge, inFlight, type Remember, type Reply, remember, sessionOf, written } from "./combos.ts";
import { createDraft, type DraftMsg, type DraftRun, type Spend } from "./draft.ts";
import {
  type Brief,
  Briefed,
  type BriefRefusal,
  Claimed,
  DriverFact,
  hasRecipe,
  LaneView,
  PARK_ROUTE,
  type ParkCause,
  PrState,
  type QueueReading,
  type Route,
  routeOf,
  Shell,
  type TaskView,
  Unparked,
} from "./fabrika.ts";
import { act, createJudge, gather, intentOf } from "./primitives.ts";

// One task's turn in one pass of the operator (src/operator.ts): route the
// task by its state's name, do the one thing the route says, and end. The
// operator spawns one turn per active task and reads the lane again once all
// of them are over. A turn is a nested model with a pure update, Elm's way.

// ---------------------------------------------------------------- the Cmds

const Unknown = ["unknown"] as const;
/** `key`: the turn that asked, so its answer comes back to it. */
const At = z.object({ key: z.string(), lane: z.string(), task: z.string() });

export const claimLane = act("lane_claim", { input: z.object({ lane: z.string() }), ok: Claimed, err: Unknown });
/** `key` is the turn that asked, or "" for the run itself. */
export const readLane = gather("lane_view", {
  input: z.object({ key: z.string(), lane: z.string() }),
  ok: LaneView,
  err: Unknown,
});
export const readBrief = gather("lane_brief", { input: At, ok: Briefed, err: Unknown });
export const readPr = gather("lane_pr", { input: At, ok: PrState, err: Unknown });
export const markDispatched = act("lane_dispatched", { input: At.extend({ shell: Shell }), ok: z.null(), err: Unknown });
/** `true`: written; `false`: fabrika refused it. */
export const recordFact = act("lane_record", { input: At.extend({ fact: DriverFact }), ok: z.boolean(), err: Unknown });
export const unparkTask = act("lane_unpark", { input: At, ok: Unparked, err: Unknown });
export const clearTask = act("lane_clear", {
  input: At.extend({ said: z.string(), grant: z.boolean() }),
  ok: z.boolean(),
  err: Unknown,
});
export const finishLane = act("lane_finish", { input: z.object({ lane: z.string() }), ok: z.null(), err: Unknown });
/** The lane's working copy, by name: made when the lane is claimed, removed however it ends. */
export const makeTree = act("tree_make", { input: z.object({ name: z.string() }), ok: z.null(), err: Unknown });
export const removeTree = act("tree_remove", { input: z.object({ name: z.string() }), ok: z.null(), err: Unknown });
export const releaseLane = act("lane_release", {
  input: z.object({ lane: z.string(), token: z.string() }),
  ok: z.null(),
  err: Unknown,
});

export type ClaimCmd = ReturnType<typeof claimLane>;
export type ViewCmd = ReturnType<typeof readLane>;
export type BriefCmd = ReturnType<typeof readBrief>;
export type PrCmd = ReturnType<typeof readPr>;
export type DispatchedCmd = ReturnType<typeof markDispatched>;
export type RecordCmd = ReturnType<typeof recordFact>;
export type UnparkCmd = ReturnType<typeof unparkTask>;
export type ClearCmd = ReturnType<typeof clearTask>;
export type TreeCmd = ReturnType<typeof makeTree>;
export type CloseCmd = ReturnType<typeof finishLane> | ReturnType<typeof removeTree> | ReturnType<typeof releaseLane>;

/** A shell's last word, typed: its terminal token, and the pull request it names. Read only when its own report did not land. */
export const ShellEnd = z.object({ token: z.string(), pr: z.string().nullable() });
export type ShellEnd = z.infer<typeof ShellEnd>;

/** The shells, as a Draft. */
export const shellDraft = createDraft({ name: "shell", output: ShellEnd });
export type ShellMsg = DraftMsg<"shell", ShellEnd>;

/** What a person may answer a park with. */
const parkChoices = {
  resume: "It is handled: carry on from where the lane stopped",
  more: "Give the work one more round of repairs, then carry on",
  leave: "Leave the lane parked: a person will take it from here",
} as const;
type ParkChoice = keyof typeof parkChoices;

/** Asking a person about a park, and reading the answer. */
export const parkAsk = createAsk({
  name: "park",
  judge: createJudge({
    name: "park_read",
    instructions:
      "`question` is what a pipeline asked a person about work it had to stop. `reply` is the person's answer. Which option does the reply choose?",
    choices: parkChoices,
  }),
});
export type PostCmd = ReturnType<typeof parkAsk.post>;
export type ReadCmd = ReturnType<typeof parkAsk.judge.ask>;
type AskState = Asking<ParkChoice, PostCmd, ReadCmd>;

export type OperatorCmd =
  | ClaimCmd
  | ViewCmd
  | BriefCmd
  | PrCmd
  | DispatchedCmd
  | RecordCmd
  | UnparkCmd
  | ClearCmd
  | TreeCmd
  | CloseCmd
  | PostCmd
  | ReadCmd;

export const DEFS = [
  claimLane,
  readLane,
  readBrief,
  readPr,
  markDispatched,
  recordFact,
  unparkTask,
  clearTask,
  makeTree,
  finishLane,
  removeTree,
  releaseLane,
  parkAsk.post,
  parkAsk.judge.ask,
] as const;

// ---------------------------------------------------------------- the model

/** The numbers a run is driven by, copied into its state when it starts, so a restart replays by them. */
export interface Knobs {
  /** How many tasks are driven at once. No more than the machine was made with. */
  readonly slots: number;
  /** How long to wait before trying a recipe on a park again, and how many tries before a person is asked. */
  readonly recheckMs: number;
  readonly rechecks: number;
  /** How long the merge queue may hold a pull request before that counts as stalled. */
  readonly queueStallMs: number;
  /** A minute of a shell's time limit, in ms: 60 000 live, small in tests. */
  readonly msPerMinute: number;
  /** The floor for reading a person's reply in words. */
  readonly askFloor: number;
  /** Whose replies count. */
  readonly who: readonly string[];
}

export const defaultKnobs: Knobs = {
  slots: 4,
  recheckMs: 5 * 60_000,
  rechecks: 6,
  queueStallMs: 60 * 60_000,
  msPerMinute: 60_000,
  askFloor: 0.8,
  who: [],
};

/** How a turn ended. */
export type TurnEnd =
  /** It did its one thing, and the next read of the lane says what follows. */
  | { readonly kind: "moved" }
  /** A person said to leave the lane parked. */
  | { readonly kind: "parked"; readonly why: string }
  /** Something no rule covers: the run stops, and says what. */
  | { readonly kind: "stopped"; readonly why: string };

type ShellRoute = Extract<Route, { kind: "shell" }>;
/** The writes a turn reads back before it counts them. */
type Writes = RecordCmd | ClearCmd | UnparkCmd;

/** What every turn knows: its task, the state it began in, its ledger's length then, and the task's pull request. */
interface Of {
  readonly task: string;
  readonly state: string;
  readonly seq: number;
  readonly pr: string | null;
}

export type Turn = Of &
  (
    | {
        readonly phase: "recording";
        /** What is being written, for the stop line if it does not land. */
        readonly what: string;
        readonly mem: Remember<Writes, ViewCmd>;
      }
    | { readonly phase: "reading_pr"; readonly route: ShellRoute; readonly asked: PrCmd }
    | { readonly phase: "pr_waiting"; readonly route: ShellRoute }
    | { readonly phase: "briefing"; readonly route: ShellRoute; readonly asked: BriefCmd }
    | { readonly phase: "dispatching"; readonly route: ShellRoute; readonly brief: Brief; readonly asked: DispatchedCmd }
    | { readonly phase: "drafting"; readonly route: ShellRoute; readonly run: DraftRun; readonly tools: number }
    /** The shell ended: read the lane to see if its own report landed. `end`: its last word, if it gave one. */
    | { readonly phase: "confirming"; readonly end: ShellEnd | null; readonly asked: ViewCmd }
    | { readonly phase: "queued"; readonly pass: number }
    | { readonly phase: "unparking"; readonly cause: ParkCause | null; readonly tries: number; readonly asked: UnparkCmd }
    | { readonly phase: "rechecking"; readonly cause: ParkCause | null; readonly tries: number }
    | { readonly phase: "asking"; readonly cause: ParkCause | null; readonly ask: AskState }
    | { readonly phase: "over"; readonly end: TurnEnd }
  );

/** One pass of the run, as a turn needs it. */
export interface Pass {
  readonly run: string;
  readonly lane: string;
  readonly pass: number;
  readonly issue: string;
  /** The working copy the run made: every shell works in it. */
  readonly tree: string;
  readonly knobs: Knobs;
}

// ---------------------------------------------------------------- the Msgs

/** The Msgs that arrive on their own, from the turns' Listens and Drafts. */
export type TurnMsg =
  | ShellMsg
  | { readonly type: "pr_read"; readonly key: string; readonly pr: PrState }
  | { readonly type: "queue_read"; readonly key: string; readonly reading: QueueReading }
  | { readonly type: "park_reply"; readonly key: string; readonly reply: Reply }
  | { readonly type: "shell_overtime"; readonly key: string; readonly id: string }
  | { readonly type: "recheck"; readonly key: string; readonly tries: number }
  | { readonly type: "queue_stalled"; readonly key: string; readonly pass: number };

/** A Cmd's answer, as the engine mints it. */
export type Settle =
  | { readonly type: `${string}_ok`; readonly cmd: Readonly<Record<string, unknown>>; readonly value: unknown }
  | { readonly type: `${string}_err`; readonly cmd: Readonly<Record<string, unknown>>; readonly error: unknown };

export type Step<S> = readonly [S, readonly OperatorCmd[]];

export const isSettle = (m: { readonly type: string }): m is Settle => "cmd" in m;

// ---------------------------------------------------------------- the turn

const over = (t: Of, end: TurnEnd): Step<Turn> => [{ ...of(t), phase: "over", end }, []];
const stop = (t: Of, why: string) => over(t, { kind: "stopped", why });
const moved = (t: Of) => over(t, { kind: "moved" });
function of(t: Of): Of {
  return { task: t.task, state: t.state, seq: t.seq, pr: t.pr };
}

/** remember: write a fact, then read the lane back. It counts once the task has left its state. */
function recording(t: Of, p: Pass, what: string, fact: DriverFact): Step<Turn> {
  const write = recordFact({ key: t.task, lane: p.lane, task: t.task, fact, intent: intentOf(p.run, p.pass, t.task, "record") });
  const [mem, cmds] = remember<Writes, ViewCmd>(write, readLane({ key: t.task, lane: p.lane }));
  return [{ ...of(t), phase: "recording", what, mem }, cmds];
}

function briefing(t: Of, p: Pass, route: ShellRoute): Step<Turn> {
  const asked = readBrief({ key: t.task, lane: p.lane, task: t.task });
  return [{ ...of(t), phase: "briefing", route, asked }, [asked]];
}

function unparking(t: Of, p: Pass, cause: ParkCause | null, tries: number): Step<Turn> {
  const asked = unparkTask({ key: t.task, lane: p.lane, task: t.task, intent: intentOf(p.run, p.pass, t.task, `unpark${tries}`) });
  return [{ ...of(t), phase: "unparking", cause, tries, asked }, [asked]];
}

/** ask: post the question on the issue, and wait for a typed answer. */
function asking(t: Of, p: Pass, cause: ParkCause | null, why: string): Step<Turn> {
  const text = [
    `The lane on ${p.issue} stopped at \`${t.state}\`${cause === null ? "" : ` (\`${cause}\`)`}. ${why}`,
    "The machine driving it has no rule that clears this, so it is waiting on you.",
  ].join("\n\n");
  const question = { where: p.issue, text, who: p.knobs.who, floor: p.knobs.askFloor };
  const [ask, cmds] = parkAsk.start(t.task, question, intentOf(p.run, p.pass, t.task, "ask"));
  return [{ ...of(t), phase: "asking", cause, ask }, cmds];
}

/** gate on a park: a known recipe clears it, so try the recipe; anything else is a person's. */
function gatePark(t: TaskView, p: Pass): Step<Turn> {
  if (hasRecipe(t.state, t.cause)) return unparking(t, p, t.cause, 1);
  return asking(t, p, t.cause, t.cause === null ? "The park says no cause." : "No known recipe clears this cause.");
}

/** Where a review stands before it is briefed: conflicting goes back to the build; unsettled waits. */
function settled(t: Of, p: Pass, route: ShellRoute, pr: PrState): Step<Turn> {
  if (pr.mergeable === "conflicting") {
    return t.pr === null
      ? stop(t, "the pull request conflicts with its base, and the lane names no pull request")
      : recording(t, p, "a pull request that conflicts with its base", { kind: "base_conflicted", pr: t.pr });
  }
  if (pr.mergeable === "unknown" || pr.checks === "pending") return [{ ...of(t), phase: "pr_waiting", route }, []];
  return briefing(t, p, route);
}

/** Start a turn on one task: route by its state's name. */
export function startTurn(t: TaskView, p: Pass): Step<Turn> {
  const route = routeOf(t.state);
  if (route === null) return stop(t, `no route for the state \`${t.state}\``);
  switch (route.kind) {
    case "start":
      return recording(t, p, "the start of the build", { kind: "started" });
    case "shell": {
      if (!route.settled) return briefing(t, p, route);
      const asked = readPr({ key: t.task, lane: p.lane, task: t.task });
      return [{ ...of(t), phase: "reading_pr", route, asked }, [asked]];
    }
    case "queue":
      return [{ ...of(t), phase: "queued", pass: p.pass }, []];
    case "park":
      return gatePark(t, p);
    case "final":
      return moved(t);
    case "unbuilt":
      return stop(t, route.why);
  }
}

/**
 * Whether the lane moved for this task since the turn began: the lane ended,
 * or the task's ledger grew (a new state, or a lap or a wait back into the same one).
 */
function hasMoved(view: LaneView, t: Of): boolean {
  const now = view.tasks.find((x) => x.task === t.task);
  return view.status !== "active" || now === undefined || now.seq > t.seq;
}

/** A refused brief: a rewind, a park to record, or a stop. */
function refused(t: Of, p: Pass, why: BriefRefusal): Step<Turn> {
  switch (why) {
    case "pr_repointed":
      return recording(t, p, "the rewind of a review whose pull request moved", { kind: "rewind" });
    case "size_stop":
      return recording(t, p, "the size stop", { kind: "park", cause: "size-stop", why: "the betting table's size stop" });
    case "no_issue":
    case "no_pr":
    case "branch_unclear":
      return recording(t, p, `a park (${why})`, { kind: "park", cause: null, why: `fabrika could not brief: ${why}` });
    case "no_shell":
    case "stale_branch":
      return stop(t, `fabrika could not brief: ${why}`);
  }
}

const value = <V>(m: Settle) => (m as { readonly value: V }).value;

/** One Msg for one turn. */
export function stepTurn(t: Turn, m: TurnMsg | Settle, p: Pass): Step<Turn> {
  if (isSettle(m) && "error" in m) return failed(t, m);
  switch (t.phase) {
    case "recording":
      if (m.type === recordFact.okType || m.type === clearTask.okType) {
        if (value<boolean>(m as Settle) === false) return stop(t, `fabrika refused to record ${t.what}`);
        const [mem, cmds] = written(t.mem);
        return [{ ...t, mem }, cmds];
      }
      if (m.type === readLane.okType && t.mem.step === "reading") {
        return hasMoved(value<LaneView>(m as Settle), t) ? moved(t) : stop(t, `${t.what} was recorded, and the lane did not move`);
      }
      return [t, []];
    case "reading_pr":
      return m.type === readPr.okType ? settled(t, p, t.route, value<PrState>(m as Settle)) : [t, []];
    case "pr_waiting":
      return m.type === "pr_read" ? settled(t, p, t.route, m.pr) : [t, []];
    case "briefing": {
      if (m.type !== readBrief.okType) return [t, []];
      const briefed = value<Briefed>(m as Settle);
      if (!briefed.ok) return refused(t, p, briefed.why);
      // The table and fabrika must name the same shell: a mismatch is two versions drifting apart.
      if (briefed.brief.shell !== t.route.shell) {
        return stop(t, `fabrika briefs \`${briefed.brief.shell}\` for \`${t.state}\`; the routing table says \`${t.route.shell}\``);
      }
      const intent = intentOf(p.run, p.pass, t.task, "dispatched");
      const asked = markDispatched({ key: t.task, lane: p.lane, task: t.task, shell: t.route.shell, intent });
      return [{ ...of(t), phase: "dispatching", route: t.route, brief: briefed.brief, asked }, [asked]];
    }
    case "dispatching": {
      if (m.type !== markDispatched.okType) return [t, []];
      // The conversation is named before the shell starts, from where it stands in the run.
      const id = intentOf(p.run, p.pass, t.task, "shell");
      const run: DraftRun = {
        key: t.task,
        id,
        prompt: t.brief.prompt,
        session: { id: sessionOf(id), continues: false },
        agent: `fabrika:${t.route.shell}`,
        folder: p.tree,
      };
      return [{ ...of(t), phase: "drafting", route: t.route, run, tools: 0 }, []];
    }
    case "drafting":
      return drafting(t, m, p);
    case "confirming":
      if (m.type !== readLane.okType) return [t, []];
      if (hasMoved(value<LaneView>(m as Settle), t)) return moved(t);
      // The shell's own report did not land: write its last word, or that it gave none.
      return t.end === null
        ? recording(t, p, "a shell that ended with no word", { kind: "shell_dead", why: "ended with no terminal word" })
        : recording(t, p, `the shell's \`${t.end.token}\``, { kind: "token", token: t.end.token, pr: t.end.pr });
    case "queued":
      if (m.type === "queue_stalled" && m.pass === t.pass) {
        return recording(t, p, "a stalled merge queue", { kind: "queue", reading: "stalled" });
      }
      if (m.type !== "queue_read" || m.reading === "waiting") return [t, []];
      return recording(t, p, `the merge queue's \`${m.reading}\``, { kind: "queue", reading: m.reading });
    case "unparking": {
      if (m.type !== unparkTask.okType) return [t, []];
      const answer = value<Unparked>(m as Settle);
      if (answer === "cleared") {
        // remember: the recipe says it cleared the park; count that only once the lane shows it.
        const [mem, cmds] = written(remember<Writes, ViewCmd>(t.asked, readLane({ key: t.task, lane: p.lane }))[0]);
        return [{ ...of(t), phase: "recording", what: "the recipe's clearance", mem }, cmds];
      }
      if (answer === "novel") return asking(t, p, t.cause, "Fabrika has no recipe for it.");
      if (t.cause !== null && PARK_ROUTE[t.cause] === "founder") {
        return asking(t, p, t.cause, "It waits on a call or an act only a person can make.");
      }
      if (t.tries > p.knobs.rechecks) return asking(t, p, t.cause, `Its recipe did not clear it in ${t.tries} tries.`);
      return [{ ...of(t), phase: "rechecking", cause: t.cause, tries: t.tries }, []];
    }
    case "rechecking":
      return m.type === "recheck" && m.tries === t.tries ? unparking(t, p, t.cause, t.tries + 1) : [t, []];
    case "asking":
      return stepAsk(t, m, p);
    case "over":
      return [t, []];
  }
}

/** A Cmd that could not read or write at all stops the turn, except a Judge, whose reply is set aside. */
function failed(t: Turn, m: Settle): Step<Turn> {
  if (t.phase === "asking" && m.type === parkAsk.judge.ask.errType) return [{ ...t, ask: parkAsk.unread(t.ask) }, []];
  if (t.phase === "asking" && m.type === parkAsk.post.errType) return stop(t, "the question to a person could not be posted");
  return stop(t, `\`${m.type.replace(/_err$/, "")}\` could not run`);
}

function drafting(t: Extract<Turn, { phase: "drafting" }>, m: TurnMsg | Settle, p: Pass): Step<Turn> {
  if (m.type === "shell_overtime") {
    return m.id === t.run.id
      ? recording(t, p, "a shell that ran out of time", { kind: "shell_dead", why: `ran past ${t.route.minutes} minutes` })
      : [t, []];
  }
  if (isSettle(m) || !("id" in m) || m.id !== t.run.id) return [t, []];
  const draft = m as ShellMsg;
  if (shellDraft.is.tool(draft)) return [{ ...t, tools: t.tools + 1 }, []];
  if (shellDraft.is.failed(draft)) return recording(t, p, "a shell that broke", { kind: "shell_dead", why: draft.error });
  const asked = readLane({ key: t.task, lane: p.lane });
  return [{ ...of(t), phase: "confirming", end: (draft as Extract<ShellMsg, { output: unknown }>).output, asked }, [asked]];
}

function stepAsk(t: Extract<Turn, { phase: "asking" }>, m: TurnMsg | Settle, p: Pass): Step<Turn> {
  if (m.type === parkAsk.post.okType) {
    const { thread, at } = value<{ thread: string; at: number }>(m as Settle);
    return [{ ...t, ask: parkAsk.posted(t.ask, thread, at) }, []];
  }
  if (m.type === "park_reply") {
    const [ask, cmds] = parkAsk.replied(t.ask, m.reply);
    return answered({ ...t, ask }, p, cmds);
  }
  if (m.type === parkAsk.judge.ask.okType && t.ask.phase === "reading") {
    const ruled = parkAsk.judge.rule(value<{ choice: ParkChoice; confidence: number }>(m as Settle), t.ask.question.floor);
    // gate on the Judge: a sure answer passes; an unsure one is set aside, and the ask waits on.
    const ask = gateJudge(ruled, parkAsk.judge.choices).pass ? parkAsk.read(t.ask, ruled) : parkAsk.unread(t.ask);
    return answered({ ...t, ask }, p, []);
  }
  return [t, []];
}

/** Once the person's answer is read, act on it: leave the park, or clear it on their word. */
function answered(t: Extract<Turn, { phase: "asking" }>, p: Pass, cmds: readonly OperatorCmd[]): Step<Turn> {
  const { ask } = t;
  if (ask.phase !== "answered") return [t, cmds];
  if (ask.choice === "leave") return over(t, { kind: "parked", why: `a person said to leave it: ${ask.reply.body}` });
  const write = clearTask({
    key: t.task,
    lane: p.lane,
    task: t.task,
    said: ask.reply.body,
    grant: ask.choice === "more",
    intent: intentOf(p.run, p.pass, t.task, "clear"),
  });
  const [mem, first] = remember<Writes, ViewCmd>(write, readLane({ key: t.task, lane: p.lane }));
  return [{ ...of(t), phase: "recording", what: "a person's clearance", mem }, first];
}

/** What a turn waits on, to be sent again after a restart. Subs reopen on their own. */
export function turnInFlight(t: Turn): readonly OperatorCmd[] {
  switch (t.phase) {
    case "recording":
      return [inFlight(t.mem)];
    case "reading_pr":
    case "briefing":
    case "dispatching":
    case "confirming":
    case "unparking":
      return [t.asked];
    case "asking": {
      const asked = parkAsk.asked(t.ask);
      return asked === null ? [] : [asked];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------- what a turn listens to

/** The one clock a turn may wait on: a shell's time limit, a recipe's next try, a stalled queue. */
export function timerOf(t: Turn, knobs: Knobs): { readonly ms: number; readonly msg: TurnMsg } | null {
  switch (t.phase) {
    case "drafting":
      return { ms: t.route.minutes * knobs.msPerMinute, msg: { type: "shell_overtime", key: t.task, id: t.run.id } };
    case "rechecking":
      return { ms: knobs.recheckMs, msg: { type: "recheck", key: t.task, tries: t.tries } };
    case "queued":
      return { ms: knobs.queueStallMs, msg: { type: "queue_stalled", key: t.task, pass: t.pass } };
    default:
      return null;
  }
}

/** One shell run, as the field log keeps it. */
export interface ShellRow {
  readonly task: string;
  readonly state: string;
  readonly shell: Shell;
  /** `finished`: it ended on its own. `failed`: it broke. `overtime`: it ran past its time and was stopped. */
  readonly outcome: "finished" | "failed" | "overtime";
  readonly token: string | null;
  readonly why: string | null;
  readonly tools: number;
  readonly spend: Spend;
}

/** The field log's row for the shell this Msg ends, if it ends one. */
export function ranOf(t: Turn, m: TurnMsg | Settle): ShellRow | null {
  if (t.phase !== "drafting" || isSettle(m) || !("id" in m) || m.id !== t.run.id) return null;
  const row = { task: t.task, state: t.state, shell: t.route.shell, tools: t.tools };
  if (m.type === "shell_overtime") {
    const spend = { costUsd: 0, tokens: 0, turns: 0, minutes: t.route.minutes };
    return { ...row, outcome: "overtime", token: null, why: `ran past ${t.route.minutes} minutes`, spend };
  }
  const draft = m as ShellMsg;
  if (shellDraft.is.finished(draft)) {
    return { ...row, outcome: "finished", token: draft.output?.token ?? null, why: null, spend: draft.spend };
  }
  if (shellDraft.is.failed(draft)) return { ...row, outcome: "failed", token: null, why: draft.error, spend: draft.spend };
  return null;
}
