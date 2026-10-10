import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { Sub } from "@demlik/tea";
import { Effect, Schedule, Stream } from "effect";
import { type RepliesDeps, Thread } from "./combos.ts";
import { type DraftRun, sdkRunner } from "./draft.ts";
import { Fabrika, type Shell, Worktrees } from "./fabrika.ts";
import type { AtDeps, Operator, OperatorMsg } from "./operator.ts";
import {
  type BriefCmd,
  type ClaimCmd,
  type ClearCmd,
  type DispatchedCmd,
  type finishLane,
  type PostCmd,
  type PrCmd,
  parkAsk,
  type RecordCmd,
  type releaseLane,
  type removeTree,
  shellDraft,
  type TreeCmd,
  type UnparkCmd,
  type ViewCmd,
} from "./turn.ts";

// What the operator machine runs on: the handlers for its Cmds, the runners
// for its Subs, and the rows a finished run adds to field/runs.jsonl. The
// machine itself (src/operator.ts) never touches any of this.

const withFabrika = <A, E>(use: (fabrika: Fabrika["Service"]) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    return yield* use(yield* Fabrika);
  });

/** The Cmds' handlers: fabrika's through `Fabrika`, the question through the `Thread`, the reply's reading through `Jev`. */
export const operatorInterpret = (jevModel: string) => ({
  lane_claim: (c: ClaimCmd) => withFabrika((f) => f.claim({ lane: c.lane, intent: c.intent })),
  lane_view: (c: ViewCmd) => withFabrika((f) => f.view(c.lane)),
  lane_brief: (c: BriefCmd) => withFabrika((f) => f.brief({ lane: c.lane, task: c.task })),
  lane_pr: (c: PrCmd) => withFabrika((f) => f.pr({ lane: c.lane, task: c.task })),
  lane_dispatched: (c: DispatchedCmd) =>
    withFabrika((f) => Effect.as(f.dispatched({ lane: c.lane, task: c.task, shell: c.shell, intent: c.intent }), null)),
  lane_record: (c: RecordCmd) => withFabrika((f) => f.record({ lane: c.lane, task: c.task, fact: c.fact, intent: c.intent })),
  lane_unpark: (c: UnparkCmd) => withFabrika((f) => f.unpark({ lane: c.lane, task: c.task, intent: c.intent })),
  lane_clear: (c: ClearCmd) =>
    withFabrika((f) => f.clear({ lane: c.lane, task: c.task, said: c.said, grant: c.grant, intent: c.intent })),
  lane_finish: (c: ReturnType<typeof finishLane>) =>
    withFabrika((f) => Effect.as(f.finish({ lane: c.lane, intent: c.intent }), null)),
  tree_make: (c: TreeCmd) =>
    Effect.gen(function* () {
      return yield* Effect.as((yield* Worktrees).make({ name: c.name, intent: c.intent }), null);
    }),
  tree_remove: (c: ReturnType<typeof removeTree>) =>
    Effect.gen(function* () {
      return yield* Effect.as((yield* Worktrees).remove({ name: c.name, intent: c.intent }), null);
    }),
  lane_release: (c: ReturnType<typeof releaseLane>) =>
    withFabrika((f) => Effect.as(f.release({ lane: c.lane, token: c.token, intent: c.intent }), null)),
  park_post: (c: PostCmd) =>
    Effect.gen(function* () {
      return yield* (yield* Thread).post({ where: c.where, text: c.text, intent: c.intent });
    }),
  park_read_judge: parkAsk.judge.handle(jevModel),
});

/**
 * Read something over and over, and hand on each reading that differs from
 * the one before: a Listen over a world that cannot push. A read that fails
 * is skipped; the next one is asked on time.
 */
const poll = <A>(every: number, read: (f: Fabrika["Service"]) => Effect.Effect<A, unknown>) =>
  Stream.unwrap(
    Effect.gen(function* () {
      const f = yield* Fabrika;
      return Stream.fromEffectSchedule(
        read(f).pipe(Effect.match({ onSuccess: (a): A | null => a, onFailure: () => null })),
        Schedule.spaced(every),
      ).pipe(
        Stream.filter((a): a is A => a !== null),
        Stream.changesWith((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      );
    }),
  );

/**
 * The Subs' runners, live. `shell` opens one Agent SDK query per shell run;
 * `options` gives it the folder, the fabrika plugin and its limits. The PR
 * and the merge queue are read every `pollMs`.
 */
export const operatorSubscribe = (config: { readonly pollMs: number; readonly shell: (run: DraftRun) => Options }) => ({
  shell: sdkRunner(shellDraft, config.shell),
  pr_watch: (sub: Sub<"pr_watch", AtDeps>) =>
    poll(config.pollMs, (f) => f.pr(sub.deps)).pipe(
      Stream.map((pr): OperatorMsg => ({ type: "pr_read", key: sub.deps.key, pr })),
    ),
  queue: (sub: Sub<"queue", AtDeps>) =>
    poll(config.pollMs, (f) => f.queue(sub.deps)).pipe(
      Stream.map((reading): OperatorMsg => ({ type: "queue_read", key: sub.deps.key, reading })),
    ),
  park_replies: (sub: Sub<"park_replies", RepliesDeps>) =>
    Stream.unwrap(
      Effect.gen(function* () {
        return (yield* Thread).replies(sub.deps.thread, sub.deps.after);
      }),
    ).pipe(
      Stream.map((reply): OperatorMsg => ({ type: "park_reply", key: sub.deps.key, reply })),
    ),
});

/**
 * The Agent SDK options for a shell: it works in the tree the run made (by
 * name, under `trees`, the folder the `Worktrees` Layer keeps them in), with
 * the fabrika plugin loaded from `plugin`.
 */
export const shellOptions =
  (config: { readonly trees: string; readonly plugin: string; readonly model: string; readonly maxBudgetUsd: number }) =>
  (run: DraftRun): Options => ({
    cwd: run.folder === null ? config.trees : join(config.trees, run.folder),
    model: config.model,
    plugins: [{ type: "local", path: config.plugin }],
    settingSources: ["project"],
    permissionMode: "acceptEdits",
    maxBudgetUsd: config.maxBudgetUsd,
  });

// ---------------------------------------------------------------- the field log

/** A row of `field/runs.jsonl`. */
export interface RunRow {
  readonly date: string;
  readonly lane: string;
  readonly role: "machine" | "builder" | "reviewer" | "shipper";
  readonly model: string | null;
  readonly effort: string | null;
  readonly outcome: "merged" | "pass" | "fail" | "parked" | "stopped";
  readonly why: string | null;
  readonly tokens: number;
  readonly tools: number;
  readonly minutes: number;
  readonly note: string | null;
  /** On the machine's row only: its Jev calls, and the dollars its shells cost. */
  readonly jev?: number;
  readonly costUsd?: number;
}

const ROLE: Readonly<Record<Shell, "builder" | "reviewer" | "shipper">> = {
  builder: "builder",
  "ui-builder": "builder",
  "mixed-builder": "builder",
  reviewer: "reviewer",
  "ui-reviewer": "reviewer",
  shipper: "shipper",
};

/** A shell's terminal word as the field log's outcome. Any other word is kept as the why. */
const OUTCOME: Readonly<Record<string, RunRow["outcome"]>> = {
  PASS: "pass",
  FAIL: "fail",
  "SHIPPED-PR": "pass",
  "SUCCESS-NO-PR": "pass",
  QUEUED: "pass",
  MERGED: "merged",
  LANDED: "merged",
};

const tenth = (n: number) => Math.round(n * 10) / 10;

/**
 * The rows a finished run adds to the field log: one for the machine, one
 * per shell it ran. `repo` is `owner/name`; `minutes` is the run's wall time,
 * which the host measures.
 */
export function fieldRows(
  s: Operator,
  at: { readonly date: string; readonly repo: string; readonly minutes: number; readonly model: string },
): RunRow[] {
  if (s.phase !== "ended") return [];
  const lane = `${at.repo}#${s.lane}`;
  const shells = s.log.shells.map((r): RunRow => {
    const outcome = r.outcome === "finished" ? (OUTCOME[r.token ?? ""] ?? "stopped") : "stopped";
    return {
      date: at.date,
      lane,
      role: ROLE[r.shell],
      model: at.model,
      effort: null,
      outcome,
      why: outcome === "stopped" ? (r.why ?? r.token ?? r.outcome) : null,
      tokens: r.spend.tokens,
      tools: r.tools,
      minutes: tenth(r.spend.minutes),
      note: null,
    };
  });
  const { end } = s;
  const machine: RunRow = {
    date: at.date,
    lane,
    role: "machine",
    model: null,
    effort: null,
    outcome:
      end.kind === "terminal" ? (end.status === "done" ? "merged" : "stopped") : end.kind === "parked" ? "parked" : "stopped",
    why:
      end.kind === "terminal"
        ? end.status === "done"
          ? null
          : "tripped"
        : end.kind === "unclaimed"
          ? `${end.why}: ${end.detail}`
          : end.why,
    tokens: 0,
    tools: s.log.cmds,
    minutes: tenth(at.minutes),
    note: null,
    jev: s.log.jev,
    costUsd: Math.round(s.log.shells.reduce((sum, r) => sum + r.spend.costUsd, 0) * 100) / 100,
  };
  return [machine, ...shells];
}
