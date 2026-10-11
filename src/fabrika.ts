import { Context, type Effect } from "effect";
import { z } from "zod";

// What the operator needs from fabrika, as typed methods and typed answers.
// Not fabrika's CLI: the methods are cut from what the operate skill does
// with a lane (claim it, read it, brief a shell, record what the driver saw,
// clear a park, let it go), and every answer is data the machine routes on. A Layer
// serves it: in tests an in-memory lane (src/fabrika-scripted.ts); live, an
// adapter over today's fabrika, or tea-fabrika's own lane machine
// (experiments/48-operator-from-six-moves.md says which and why).
//
// Two kinds of failure. An answer fabrika gives on purpose (the claim is held,
// the brief is refused, the park is not clearable yet) is a typed `ok`. Only
// "could not read or write at all" is an error, and the machine stops on it:
// fabrika's own rule that an unknown exit is never a partial answer.

/** Why a lane parked: fabrika 0.9.0's closed set of causes. */
export const ParkCause = z.enum([
  "assembly-conflict",
  "awaiting-cp-approval",
  "base-conflicted",
  "claim-stranded",
  "head-behind-base",
  "head-ci-red",
  "no-design-manifest",
  "no-preview-render",
  "no-preview-routed",
  "no-rendered-delta",
  "queue-ejected",
  "render-axis-missing",
  "repair-budget-spent",
  "replay-budget-spent",
  "replay-conflict",
  "size-stop",
  "spawn-dead",
  "tree-hijacked",
  "verdict-owed",
  "worktree-holds-branch",
  "write-unlanded",
]);
export type ParkCause = z.infer<typeof ParkCause>;

/**
 * Whose problem a park is. `founder`: a product call or an owner's act no
 * code may make. `driver`: machinery. Fabrika's own table, for 0.9.0.
 */
export const PARK_ROUTE: Readonly<Record<ParkCause, "driver" | "founder">> = Object.fromEntries(
  ParkCause.options.map((c) => [c, c === "awaiting-cp-approval" || c === "size-stop" ? "founder" : "driver"]),
) as Record<ParkCause, "driver" | "founder">;

/** The parks a known recipe clears, by state and cause (0.9.0's recipe table). `null`: any cause. */
export const RECIPES: readonly { readonly state: string; readonly cause: ParkCause | null }[] = [
  { state: "human:cp-approval", cause: "awaiting-cp-approval" },
  { state: "human:cp-approval", cause: "head-ci-red" },
  { state: "human:queue-stall", cause: null },
  ...(
    [
      "head-ci-red",
      "worktree-holds-branch",
      "spawn-dead",
      "tree-hijacked",
      "claim-stranded",
      "no-rendered-delta",
      "no-preview-routed",
      "render-axis-missing",
    ] as const
  ).map((cause) => ({ state: "blocked", cause })),
];

export const Shell = z.enum(["builder", "ui-builder", "mixed-builder", "reviewer", "ui-reviewer", "shipper"]);
export type Shell = z.infer<typeof Shell>;

/** One task of the lane's active phase, as the fold has it now. */
export const TaskView = z.object({
  task: z.string(),
  /** The leaf state's name: what the operator routes on, and the only thing. */
  state: z.string(),
  /** Why it parked, when it is parked and the park says. */
  cause: ParkCause.nullable(),
  /** The task's pull request, once it has one. */
  pr: z.string().nullable(),
  /**
   * How many events the task's ledger holds. A write that landed shows here
   * even when the state stays the same (a lap back into `build`, another wait
   * in the merge queue), so a read can tell "written" from "lost".
   */
  seq: z.number(),
});
export type TaskView = z.infer<typeof TaskView>;

export const LaneView = z.object({
  lane: z.string(),
  /** The driven issue's URL: where a person is asked. */
  issue: z.string(),
  /** `cancelled`: the issue was closed with no landing. Every status but `active` ends the run. */
  status: z.enum(["active", "done", "tripped", "cancelled"]),
  tasks: z.array(TaskView),
});
export type LaneView = z.infer<typeof LaneView>;

export const Claimed = z.discriminatedUnion("won", [
  z.object({ won: z.literal(true), token: z.string() }),
  z.object({
    won: z.literal(false),
    /** `held`: another driver has it. `no_seat`: too many lanes run. `not_a_lane`: a child of an epic, an epic with no plan. */
    why: z.enum(["held", "no_seat", "not_a_lane"]),
    detail: z.string(),
  }),
]);
export type Claimed = z.infer<typeof Claimed>;

/** Why no brief could be written, each a different next move. */
export const BriefRefusal = z.enum([
  /** The state routes to no shell. */
  "no_shell",
  /** The task's issue cannot be read, or is gone. */
  "no_issue",
  /** Not exactly one open pull request where the state needs one. */
  "no_pr",
  /** A review with no pull request left: it was pointed at another issue. */
  "pr_repointed",
  /** An epic child's commits are on no branch, or on several. */
  "branch_unclear",
  /** The betting table says the work has spent its size. */
  "size_stop",
  /** The epic's branch is too old to carry a verb the brief needs. */
  "stale_branch",
]);
export type BriefRefusal = z.infer<typeof BriefRefusal>;

export const Brief = z.object({
  shell: Shell,
  /** The whole prompt, to be handed over as it is. */
  prompt: z.string(),
  issue: z.string(),
  pr: z.string().nullable(),
});
export type Brief = z.infer<typeof Brief>;

export const Briefed = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), brief: Brief }),
  z.object({ ok: z.literal(false), why: BriefRefusal }),
]);
export type Briefed = z.infer<typeof Briefed>;

/** A pull request as a reviewer would meet it. */
export const PrState = z.object({
  mergeable: z.enum(["mergeable", "conflicting", "unknown"]),
  checks: z.enum(["pending", "green", "red"]),
});
export type PrState = z.infer<typeof PrState>;

/** The merge queue, read once. */
export const QueueReading = z.enum(["waiting", "landed", "ejected", "parked"]);
export type QueueReading = z.infer<typeof QueueReading>;

/** What the driver itself saw, to be written on the lane. Fabrika turns each into its own event. */
export const DriverFact = z.discriminatedUnion("kind", [
  /** A queued task starts: the build begins. */
  z.object({ kind: z.literal("started") }),
  /** A shell ended on this terminal word, and its own report did not land. */
  z.object({ kind: z.literal("token"), token: z.string(), pr: z.string().nullable() }),
  /** A shell broke, ran past its time, or ended with no word. */
  z.object({ kind: z.literal("shell_dead"), why: z.string() }),
  /** The pull request conflicts with its base: back to the builder before any review. */
  z.object({ kind: z.literal("base_conflicted"), pr: z.string() }),
  /** What the merge queue did. `stalled`: nothing, for longer than the run waits. */
  z.object({ kind: z.literal("queue"), reading: z.enum(["landed", "ejected", "parked", "stalled"]) }),
  /** A park the driver found. `cause` `null`: one fabrika has no word for, which goes to a person. */
  z.object({ kind: z.literal("park"), cause: ParkCause.nullable(), why: z.string() }),
  /** A review whose pull request was pointed elsewhere: back to the build. */
  z.object({ kind: z.literal("rewind") }),
]);
export type DriverFact = z.infer<typeof DriverFact>;

export const Unparked = z.enum([
  /** The recipe's read held, and the park is cleared. */
  "cleared",
  /** A recipe covers the park, but its read does not hold yet. */
  "not_yet",
  /** No recipe covers it. */
  "novel",
]);
export type Unparked = z.infer<typeof Unparked>;

/** Could not read or write at all. The machine stops; nothing is guessed. */
export type Unknown = { readonly _tag: "unknown" };

interface At {
  readonly lane: string;
  readonly task: string;
}
interface Intended {
  readonly intent: string;
}

/**
 * Fabrika, as the operator meets it. The reads answer the same every time
 * they are asked about the same world. Every write takes an `intent`, and a
 * second write with an intent already written answers as the first did,
 * without writing again.
 */
export class Fabrika extends Context.Service<
  Fabrika,
  {
    /** Take the lane for this run, booting its ledger if it has none. */
    readonly claim: (request: { readonly lane: string } & Intended) => Effect.Effect<Claimed, Unknown>;
    /** The fold now: the lane's status and its active tasks. */
    readonly view: (lane: string) => Effect.Effect<LaneView, Unknown>;
    /** The prompt for the shell a task's state routes to, or why there is none. */
    readonly brief: (at: At) => Effect.Effect<Briefed, Unknown>;
    /** The task's pull request, the one `view` named: can it be reviewed as it stands. */
    readonly pr: (at: At & { readonly pr: string }) => Effect.Effect<PrState, Unknown>;
    /** The merge queue, read once for the task's pull request. */
    readonly queue: (at: At & { readonly pr: string }) => Effect.Effect<QueueReading, Unknown>;
    /** Say a shell is about to start on a task. */
    readonly dispatched: (request: At & Intended & { readonly shell: Shell }) => Effect.Effect<void, Unknown>;
    /**
     * Write what the driver saw. Refused (fabrika would not take it) is `false`.
     * `pr`: the task's pull request as `view` named it, for the facts a ledger line carries one on.
     */
    readonly record: (
      request: At & Intended & { readonly fact: DriverFact; readonly pr: string | null },
    ) => Effect.Effect<boolean, Unknown>;
    /** Clear a park by the recipe its cause has, if one does. */
    readonly unpark: (request: At & Intended) => Effect.Effect<Unparked, Unknown>;
    /** Clear a park on a person's word. `grant`: give a spent repair budget one more round. */
    readonly clear: (
      request: At & Intended & { readonly said: string; readonly grant: boolean },
    ) => Effect.Effect<boolean, Unknown>;
    /** Post a finished lane's record on its issue, once. */
    readonly finish: (request: { readonly lane: string } & Intended) => Effect.Effect<void, Unknown>;
    /** Give the lane back. */
    readonly release: (request: { readonly lane: string; readonly token: string } & Intended) => Effect.Effect<void, Unknown>;
  }
>()("Fabrika") {}

/**
 * The working copies a lane's shells work in, made and removed by the
 * machine, never by an agent: every shell of a lane runs in the one tree the
 * run made when it claimed the lane, and the run removes it however the lane
 * ends. A tree is named, not pathed: the Layer keeps the trees in one folder
 * of its own. Both calls are safe to repeat: making a tree that stands, or
 * removing one that is gone, does nothing and succeeds.
 *
 * Not on `Fabrika`: a tree is git on the machine that runs the lane, not the
 * lane's ledger, and it is the same whichever ledger the lane keeps. Not the
 * lane's `Workspace` either, which runs an issue's tests in a folder it is
 * handed.
 */
export class Worktrees extends Context.Service<
  Worktrees,
  {
    /** Check out the repo's default branch, as it is now, in a new tree. */
    readonly make: (request: { readonly name: string } & Intended) => Effect.Effect<void, Unknown>;
    readonly remove: (request: { readonly name: string } & Intended) => Effect.Effect<void, Unknown>;
  }
>()("Worktrees") {}

// ---------------------------------------------------------------- the routing table

/** What the operator does in a state. */
export type Route =
  /** Write that the work starts. */
  | { readonly kind: "start" }
  /**
   * Run a shell. `settled`: read the pull request first, and brief only once
   * it merges clean and its checks have finished. `minutes`: how long the
   * shell may run before it counts as dead.
   */
  | { readonly kind: "shell"; readonly shell: Shell; readonly minutes: number; readonly settled: boolean }
  /** The pull request is in the merge queue: listen to it. */
  | { readonly kind: "queue" }
  /** The task is finished; nothing to do. */
  | { readonly kind: "final" }
  /** The task is parked: gate it. */
  | { readonly kind: "park" }
  /** A state this machine knows and does not drive yet. */
  | { readonly kind: "unbuilt"; readonly why: string };

const shell = (s: Shell, minutes: number, settled = false): Route => ({ kind: "shell", shell: s, minutes, settled });
const PARK: Route = { kind: "park" };
const FINAL: Route = { kind: "final" };

/**
 * State name to action, the operate skill's routing table as code. Type-blind:
 * it reads the state's name, never the work's type or labels. The time a shell
 * may take is the skill's budget for a dead spawn.
 */
export const ROUTES: Readonly<Record<string, Route>> = {
  queued: { kind: "start" },
  build: shell("builder", 40),
  "build:ui": shell("ui-builder", 40),
  "build:mixed": shell("mixed-builder", 40),
  review: shell("reviewer", 15, true),
  "review:ui": shell("ui-reviewer", 15, true),
  ship: shell("shipper", 10),
  "ship:queued": { kind: "queue" },
  landed: FINAL,
  shipped: FINAL,
  diagnosed: FINAL,
  blocked: PARK,
  frozen: PARK,
  integrate: { kind: "unbuilt", why: "landing an epic's child on its branch is not built here yet" },
};

/** The route for a state; every `human:*` is a park. `null`: no route, and the run stops. */
export const routeOf = (state: string): Route | null => ROUTES[state] ?? (state.startsWith("human:") ? PARK : null);

/** Whether a known recipe covers this park. */
export const hasRecipe = (state: string, cause: ParkCause | null): boolean =>
  RECIPES.some((r) => r.state === state && (r.cause === null || r.cause === cause));
