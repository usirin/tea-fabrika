import type { Sub } from "@demlik/tea";
import { Effect, Layer, Stream } from "effect";
import { type Reply, Thread } from "./combos.ts";
import type { DraftRun, Spend } from "./draft.ts";
import {
  type BriefRefusal,
  type Claimed,
  type DriverFact,
  Fabrika,
  type LaneView,
  type ParkCause,
  type PrState,
  type QueueReading,
  type Shell,
  type Unparked,
  Worktrees,
} from "./fabrika.ts";
import type { OperatorMsg } from "./operator.ts";
import type { ShellEnd } from "./turn.ts";

// Fabrika in memory, for tests: one single-task lane folded by a small table
// of fabrika's issue-lane template, shells that follow a script, and a thread
// a person answers on. No CLI, no GitHub, no agent. Every write is kept with
// its intent, and a second write of an intent answers as the first did.

/** An event on the lane, as a shell's own report or the driver's record lands it. */
export type LaneEvent =
  | "WIP"
  | "DONE"
  | "PASS"
  | "FAIL"
  | "QUEUED"
  | "LANDED"
  | "EJECTED"
  | "UNRESOLVED"
  | "LAP"
  /** The issue was closed with no landing. */
  | "CANCELLED"
  | { readonly blocked: ParkCause | null };

/** One shell run in the script. */
export interface ShellScript {
  readonly shell: Shell;
  /** What its own report lands on the lane; `null` when its report never lands. */
  readonly reports: LaneEvent | null;
  /** Its last word, as the typed answer; `null` when it gives none that fits. */
  readonly says: ShellEnd | null;
  /** A pull request it opens. */
  readonly opens?: string;
  /** `fails`: the run breaks. `hangs`: it never ends. */
  readonly ends?: "fails" | "hangs";
}

export interface FakeScript {
  readonly lane: string;
  /** Where the lane starts, and why when that is a park. */
  readonly state?: string;
  readonly cause?: ParkCause | null;
  /** For a lane that starts parked: the state it parked out of. `queued` when left out. */
  readonly from?: string;
  readonly pr?: string | null;
  readonly claim?: Claimed;
  readonly shells?: readonly ShellScript[];
  /** Successive readings of the pull request; the last one holds. */
  readonly prs?: readonly PrState[];
  /** Successive readings of the merge queue; the last one holds. */
  readonly queue?: readonly QueueReading[];
  /** Successive answers of the recipe; the last one holds. `broken`: that try cannot run at all. */
  readonly unpark?: readonly (Unparked | "broken")[];
  /** What a person replies once a question is posted. */
  readonly replies?: readonly Reply[];
  /** Briefs refused, by the state they were asked in. */
  readonly refuse?: Readonly<Record<string, BriefRefusal>>;
  /** A park that nothing moves: the recipe may say it cleared it, and the lane stays where it is. */
  readonly stuck?: boolean;
  /** The merge leaves the issue open ("Part of #N"): fabrika folds a `DONE` out of ship back to `queued`. */
  readonly partial?: boolean;
  /** Make every read of the lane fail. */
  readonly unreadable?: boolean;
}

/** The issue-lane template's arms, cut to what the tests walk. Experiment 53 counts real lanes' arms against it. */
export const NEXT: Readonly<Record<string, Partial<Record<string, string>>>> = {
  queued: { WIP: "build" },
  build: { DONE: "review", LAP: "build" },
  review: { PASS: "ship", FAIL: "build", LAP: "build", WIP: "build" },
  // `LAP`: a conflict with the base found in ship goes back to build and costs no repair round (experiment 53 saw 10).
  ship: { QUEUED: "ship:queued", DONE: "shipped", FAIL: "build", LAP: "build" },
  "ship:queued": { LANDED: "shipped", EJECTED: "build", UNRESOLVED: "ship:queued" },
};

/**
 * How a shell's terminal word folds, for a driver that writes it. The words
 * from `LANDED` on are the shipper's, as fabrika 0.9.0's own table folds them
 * out of `ship`: the ship machine's outcome is written in them.
 */
const TOKENS: Readonly<Record<string, LaneEvent>> = {
  "SHIPPED-PR": "DONE",
  PASS: "PASS",
  FAIL: "FAIL",
  QUEUED: "QUEUED",
  MERGED: "DONE",
  LANDED: "DONE",
  "ALREADY-MERGED": "DONE",
  "ROUTED-REPAIR": "FAIL",
  EJECTED: "FAIL",
  "ROUTED-REVIEW": { blocked: "verdict-owed" },
  "AWAITING-CP-APPROVAL": { blocked: "awaiting-cp-approval" },
  REFUSED: { blocked: null },
  UNKNOWN: { blocked: null },
};

const parkState = (cause: ParkCause | null) =>
  cause === "awaiting-cp-approval" ? "human:cp-approval" : cause === "repair-budget-spent" ? "human:budget-spent" : "blocked";

/** A scripted shell's cost: a conversation that ended `context` tokens long, billed for three turns of it. */
const toolSpend = (context: number): Spend => ({ costUsd: context / 100_000, tokens: context * 3, context, turns: 3, minutes: 0.5 });

export function fakeFabrika(script: FakeScript) {
  const issue = `https://github.com/example/repo/issues/${script.lane}`;
  const lane = {
    state: script.state ?? "queued",
    cause: script.cause ?? null,
    pr: script.pr ?? null,
    /** Where a park came from, and so where clearing it goes back to. A lane scripted to start parked came from `queued`. */
    before: (script.state === "blocked" || script.state?.startsWith("human:") ? (script.from ?? "queued") : null) as string | null,
    waits: 0,
    /** Events on the ledger. */
    seq: 0,
  };
  /** The working copies: made, removed, and standing now. */
  const trees = { made: [] as string[], removed: [] as string[], standing: new Set<string>() };
  /** The folder each shell ran in, in order. */
  const folders: string[] = [];
  const shells = [...(script.shells ?? [])];
  /** Everything written, in order, with its intent. A repeat of an intent is not in it. */
  const writes: { readonly what: string; readonly intent: string }[] = [];
  const answers = new Map<string, unknown>();
  const asked: { readonly text: string; readonly where: string }[] = [];
  const dispatched: Shell[] = [];
  const reads = { prs: 0, queue: 0, unpark: 0 };

  const at = <T>(list: readonly T[] | undefined, i: number, fallback: T): T =>
    list === undefined || list.length === 0 ? fallback : (list[Math.min(i, list.length - 1)] as T);

  /** Fold one event; `false` when the state has no arm for it, and nothing is written. */
  function fold(event: LaneEvent): boolean {
    const landed = arm(event);
    if (landed) lane.seq += 1;
    return landed;
  }

  function arm(event: LaneEvent): boolean {
    if (event === "CANCELLED") {
      lane.state = "board:cancelled";
      return true;
    }
    if (typeof event === "object") {
      lane.before = lane.state;
      lane.state = parkState(event.blocked);
      lane.cause = event.blocked;
      return true;
    }
    if (event === "UNRESOLVED" && ++lane.waits > 3) {
      lane.before = lane.state;
      lane.state = "human:queue-stall";
      lane.cause = null;
      return true;
    }
    const next = NEXT[lane.state]?.[event];
    if (next === undefined) return false;
    // A merge that left its issue open is no end: the lane goes round again.
    lane.state = next === "shipped" && script.partial === true ? "queued" : next;
    return true;
  }

  function unblock(): boolean {
    if (lane.before === null || script.stuck === true) return false;
    lane.state = lane.before;
    lane.before = null;
    lane.cause = null;
    lane.seq += 1;
    return true;
  }

  /** A write, once per intent. */
  const once = <A>(what: string, intent: string, write: () => A): Effect.Effect<A> =>
    Effect.sync(() => {
      if (answers.has(intent)) return answers.get(intent) as A;
      const answer = write();
      answers.set(intent, answer);
      writes.push({ what, intent });
      return answer;
    });

  function factEvent(fact: DriverFact): LaneEvent | null {
    switch (fact.kind) {
      case "started":
        return "WIP";
      case "token":
        return TOKENS[fact.token] ?? null;
      case "shell_dead":
        return lane.state === "build" || lane.state === "review" ? "LAP" : { blocked: "spawn-dead" };
      case "base_conflicted":
        return "LAP";
      case "queue":
        return fact.reading === "landed" ? "LANDED" : fact.reading === "ejected" ? "EJECTED" : "UNRESOLVED";
      case "park":
        return { blocked: fact.cause };
      case "rewind":
        return "WIP";
    }
  }

  const view = (): LaneView => ({
    lane: script.lane,
    issue,
    status: lane.state === "shipped" ? "done" : lane.state === "board:cancelled" ? "cancelled" : "active",
    tasks: [{ task: "issue", state: lane.state, cause: lane.cause, pr: lane.pr, seq: lane.seq }],
  });

  const unknown = Effect.fail({ _tag: "unknown" } as const);

  const layer = Layer.succeed(Fabrika, {
    claim: ({ intent }) => once("claim", intent, () => script.claim ?? { won: true, token: "token-1" }),
    view: () => (script.unreadable ? unknown : Effect.sync(view)),
    brief: () =>
      Effect.sync(() => {
        const refusal = script.refuse?.[lane.state];
        if (refusal !== undefined) return { ok: false as const, why: refusal };
        const next = shells[0];
        if (next === undefined) throw new Error(`no shell scripted for ${lane.state}`);
        return { ok: true as const, brief: { shell: next.shell, prompt: `brief for ${lane.state}`, issue, pr: lane.pr } };
      }),
    pr: () => Effect.sync(() => at(script.prs, reads.prs++, { mergeable: "mergeable", checks: "green" } as PrState)),
    queue: () => Effect.sync(() => at(script.queue, reads.queue++, "waiting" as QueueReading)),
    dispatched: ({ shell, intent }) => Effect.asVoid(once(`dispatched ${shell}`, intent, () => dispatched.push(shell))),
    record: ({ fact, intent }) =>
      once(`record ${fact.kind}`, intent, () => {
        const event = factEvent(fact);
        return event !== null && fold(event);
      }),
    unpark: ({ intent }) =>
      Effect.flatMap(
        once("unpark", intent, () => {
          const answer = at<Unparked | "broken">(script.unpark, reads.unpark++, "novel");
          if (answer === "cleared") unblock();
          return answer;
        }),
        (answer) => (answer === "broken" ? unknown : Effect.succeed(answer)),
      ),
    clear: ({ intent, grant }) => once(`clear${grant ? " +round" : ""}`, intent, unblock),
    finish: ({ intent }) => Effect.asVoid(once("finish", intent, () => null)),
    release: ({ intent }) => Effect.asVoid(once("release", intent, () => null)),
  });

  /** What people have replied so far. A reply added later is seen by whoever listens after it. */
  const replies: Reply[] = [...(script.replies ?? [])];
  const thread = Layer.succeed(Thread, {
    post: ({ where, text, intent }) =>
      once("ask", intent, () => {
        asked.push({ where, text });
        return { thread: `${where}#question`, at: 1_000 };
      }),
    replies: (_thread, after) => Stream.fromIterable(replies.filter((r) => r.at > after)),
  });

  /** The shells, scripted: each run takes the next script, lands its report, and ends as told. */
  const shellRunner = (sub: Sub<"shell", DraftRun>): Stream.Stream<OperatorMsg> =>
    Stream.unwrap(
      Effect.sync(() => {
        const next = shells.shift();
        const { key, id } = sub.deps;
        if (next === undefined) throw new Error("a shell ran that no script names");
        if (sub.deps.agent !== `fabrika:${next.shell}`) throw new Error(`ran ${sub.deps.agent}, the script says ${next.shell}`);
        if (sub.deps.folder === null || !trees.standing.has(sub.deps.folder)) {
          throw new Error(`a shell ran outside a standing tree: ${sub.deps.folder}`);
        }
        folders.push(sub.deps.folder);
        if (next.ends === "hangs") return Stream.never;
        if (next.opens !== undefined) lane.pr = next.opens;
        if (next.reports !== null) fold(next.reports);
        const tools: OperatorMsg[] = [
          { type: "shell_tool", key, id, tool: "Read" },
          { type: "shell_tool", key, id, tool: "Bash" },
        ];
        const end: OperatorMsg =
          next.ends === "fails"
            ? { type: "shell_failed", key, id, error: "error_during_execution", spend: toolSpend(1_000) }
            : { type: "shell_finished", key, id, output: next.says, session: sub.deps.session.id, spend: toolSpend(50_000) };
        return Stream.fromIterable([...tools, end]);
      }),
    );

  /** Making a tree that stands, or removing one that is gone, does nothing. */
  const worktrees = Layer.succeed(Worktrees, {
    make: ({ name, intent }) =>
      Effect.asVoid(
        once("make tree", intent, () => {
          if (trees.standing.has(name)) return;
          trees.made.push(name);
          trees.standing.add(name);
        }),
      ),
    remove: ({ name, intent }) =>
      Effect.asVoid(
        once("remove tree", intent, () => {
          if (trees.standing.delete(name)) trees.removed.push(name);
        }),
      ),
  });

  return {
    layer: Layer.mergeAll(layer, worktrees),
    thread,
    shellRunner,
    lane,
    trees,
    folders,
    writes,
    asked,
    dispatched,
    view,
    /** A person replies now. */
    say: (reply: Reply) => replies.push(reply),
  };
}
