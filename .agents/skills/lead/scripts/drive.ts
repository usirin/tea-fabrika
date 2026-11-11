// drive.ts: run one step end to end in plain code, in a box, so no agent waits on it. Today's
// lead tooling, run on our own laptop; it is not product. Run it in the background and read the
// last line only: one JSON object with the outcome, the new head and the report's path.
//
//   node drive.ts <lane> <plan|tests|build|mutation|review> <brief-file> [--agent codex|claude]
//                 [--model sonnet|opus] [--electron] [--from <ref>] [--ticket <n>]
//                 [--branch fabrikalfa/<name>] [--plan <approved plan>] [--plan-only]
//
// The agent runs through today's fabrika agents package on its ACP rows (./agents.ts): Codex or
// Claude Code, unchanged, in the harness's own containment, with only its model login
// (.decisions/0026, 0028). The box's git data sits outside the box, where the harness lets no
// command write it, so the agent commits nothing: it reads git through a view (`gitView`), leaves
// its changes in the tree, and drive copies them into a fresh worktree of the main checkout and
// commits them as one signed step commit through stepcommit, with main's own signer. A mutation
// step's Stryker run happens before its agent starts, in a container with its own network
// (mutbox.ts, decision 0045): drive runs it on the step's start head with the tests a `RELATED=`
// line of the brief names, and the agent only reads the report, which rides in its prompt. A run
// that is stuck there ends the step stuck, with no agent; it is never run on the host. Mutation's
// agent is Claude only, one Electron step at a time. The box cannot write state/electron.lock, so
// drive holds it for the whole step, outside the box: for mutation, and for a Claude step started
// with --electron (a step whose laws or shots run the app). The chain runs these same pieces in
// process (`prepare`, `driveStep`); the command below is for one step by hand.
//
// The step is a tea machine on the Effect engine:
//
//   (before)           box.sh gc, then a refusal when the data volume has under 20 GB free, or
//                      when a worktree of the main checkout holds the lane's branch
//   starting   Act     box.sh new, at the lane's head
//   drafting   Sub     one turn of the agent in the box (`runTurn`), waited on; its typed answer
//   reading    Gather  collect the tree and sign it, then the commits, their step notes, exam
//                      paths, leaks and the report
//   (update)   Check   pure: what the step answered and what the reads found make one outcome
//                      (a manifest the lockfile must follow, changed with the lockfile left alone,
//                      is an ask: a box has no network, so the lead refreshes it outside)
//   pushing    Act     botpush the backup branch, <branch>-wip (a -wip branch as it is), when
//                      the step committed
//   recording  Act     the field row, state/<lane>.json and .md, and the box removed unless stuck
//                      or it still holds work no branch has (uncommitted files, commits off the
//                      step's branch); the outcome line's reason then says what was kept
//   over               the outcome
//
// Exit codes: 0 done, 10 send to tests, 11 send to build, 12 send to plan, 20 ask (a question for
// the lead, in `reason`), 30 stuck, 40 skip (nothing here for the step, such as a mutation step
// whose diff has no product lines; the why is in `reason`), 2 usage, 3 refused to start, before
// any agent ran: `refused:<check>`, one of agent_cap (8 agents running: the ACP harnesses drive
// started), low_disk (under 20 GB free after box.sh gc), branch_checked_out (the lane's
// branch checked out in a worktree, which the fetch could not update), docker_busy (a mutation step
// while another run holds the one Docker box), or a box.sh new start check
// (plan_unapproved, base_not_signed, shared_ticket, root_not_ancestor). It never retries. A stuck step
// keeps its box for the lead to look at, and so does any step whose box still holds uncommitted
// files or commits off its branch. DRIVE_MINUTES (default 60) is how long the agent may run
// before it is stopped and the step is stuck.

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineMachine, type DepKeyedSub, type Sub } from "@demlik/tea";
import { Cmd, run } from "@demlik/tea/effect";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { layer as nodeServices } from "@effect/platform-node/NodeServices";
import { nameOf, outcomesOf } from "@kampus/pipeline/stages/outcome";
import { Cause, Effect, FileSystem, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";
import {
  type Agents,
  Answer,
  Ended,
  makeStepAgents,
  NO_SPENT,
  type Provider,
  runTurn,
  Spent,
  stepRow,
  type Turned,
} from "./agents.ts";
import { checkHolds, heldRules, laneRoot, lockfileBehind, startHead, stepOf, wipOf, workspaceGlobs } from "./lane.ts";

const HERE = import.meta.dirname;
export const STEPS = ["plan", "tests", "build", "mutation", "review"] as const;
export type StepName = (typeof STEPS)[number];
const AGENTS = ["codex", "claude"] as const;
export type AgentName = (typeof AGENTS)[number];

/** The provider row a step's agent runs on: Codex only reads for a plan or a review. */
export const stepProvider = (agent: AgentName, step: StepName): Provider =>
  agent === "claude" ? "claude" : step === "plan" || step === "review" ? "codex-read" : "codex";

// ---------------------------------------------------------------- the outcome

const drive = outcomesOf({
  done: { head: Schema.String },
  send: {
    tests: ["exam_paths", "step_said"],
    build: ["step_said"],
    plan: ["plancheck", "step_said"],
  },
  ask: { lead: ["question", "lockfile"] },
  skip: ["step_said"],
  stuck: [
    "box_failed",
    "agent_failed",
    "sign_failed",
    "timeout",
    "fetch_failed",
    "read_failed",
    "record_failed",
    "review_committed",
    "unsigned",
    "leak",
    "no_answer",
    "no_commit",
    "push_failed",
    "step_said",
  ],
});

type Outcome = typeof drive.schema.Type;

/**
 * The start checks, before any agent runs: box.sh new's, then drive's own (the agent cap, free disk,
 * the lane's branch held by a worktree). A no from one is not a step's answer, so it is its own end,
 * `refused:<check>` with exit 3, and never counts as a stuck step (ticket 428).
 */
const BOX_CHECKS = ["plan_unapproved", "base_not_signed", "shared_ticket", "root_not_ancestor"] as const;

const CHECKS = [...BOX_CHECKS, "agent_cap", "low_disk", "branch_checked_out", "docker_busy"] as const;
type Check = (typeof CHECKS)[number];
type Refused = { readonly kind: "refused"; readonly check: Check };
/** How a drive ends: the step's outcome, or a start check that refused before the step ran. */
type End = Outcome | Refused;

/** The name an end prints as: an outcome's own, or `refused:<check>`. */
export const endName = (e: End): string => (e.kind === "refused" ? `refused:${e.check}` : nameOf(e));

const exitOf = (o: End): number => {
  switch (o.kind) {
    case "refused":
      return 3;
    case "done":
      return 0;
    case "send":
      return o.to === "tests" ? 10 : o.to === "build" ? 11 : 12;
    case "ask":
      return 20;
    case "skip":
      return 40;
    default:
      return 30;
  }
};

/** The field row's outcome word for a drive outcome's name (field/README.md, a `step` row). */
export const rowOf = (outcome: string): string =>
  ({ done: "pass", send: "fail", ask: "parked", skip: "skip" })[outcome.split(":")[0] ?? ""] ?? "stopped";

// ---------------------------------------------------------------- the moves

const Ask = Schema.Struct({
  lane: Schema.String,
  step: Schema.Literals(STEPS),
  agent: Schema.Literals(AGENTS),
  /** The model as the harness names it, and its effort where the harness offers one. */
  model: Schema.String,
  effort: Schema.NullOr(Schema.String),
  ticket: Schema.String,
  /** The approved plan box.sh checks at every start and step. */
  plan: Schema.String,
  branch: Schema.String,
  base: Schema.String,
  /** Where the lane left main. The commits check reads the whole lane from here, so the earlier
   * steps' links are in its chain and the newest of each is not stale. */
  root: Schema.String,
  box: Schema.String,
  run: Schema.String,
  prompt: Schema.String,
  report: Schema.String,
  events: Schema.String,
  err: Schema.String,
  minutes: Schema.Number,
  /** When this run started, in ms: a report older than this is not this run's. */
  started: Schema.Number,
});
type Ask = typeof Ask.Type;

const Read = Schema.Struct({
  /** `null`: the fetch failed, with why in `problem`. */
  head: Schema.NullOr(Schema.String),
  commits: Schema.Number,
  unsigned: Schema.Array(Schema.String),
  exam: Schema.Array(Schema.String),
  /** `file:line` of each added line that leaks; never the text. */
  leaks: Schema.Array(Schema.String),
  /** Work the box holds that no branch has, as `N uncommitted files` or `N commits off <branch>`;
   * a box with any is never removed. */
  left: Schema.Array(Schema.String),
  /** Manifests the step changed that pnpm-lock.yaml must follow, with the lockfile left alone. */
  manifests: Schema.Array(Schema.String),
  /** What `plancheck --draft` said when it failed; `null` when it passed or did not run. */
  plancheck: Schema.NullOr(Schema.String),
  /** Files the agent left changed in the box's tree: a review may leave none. */
  changed: Schema.Number,
  report: Schema.String,
  problem: Schema.NullOr(Schema.String),
});
type Read = typeof Read.Type;

const Done = Schema.Struct({ ok: Schema.Boolean, detail: Schema.String });

/** What box.sh new did: made the box, refused it at a named start check, or failed. */
const Started = Schema.TaggedUnion({
  made: {},
  refused: { check: Schema.Literals(BOX_CHECKS), detail: Schema.String },
  failed: { detail: Schema.String },
});

const boxNew = Cmd.make("box_new", { input: Ask, ok: Started, err: ["unknown"] });
const stepRead = Cmd.make("step_read", { input: Ask, ok: Read, err: ["unknown"] });

const backupPush = Cmd.make("backup_push", {
  input: Schema.Struct({ ask: Ask, head: Schema.String }),
  ok: Done,
  err: ["unknown"],
});

const Entry = Schema.Struct({
  ask: Ask,
  outcome: Schema.String,
  reason: Schema.String,
  head: Schema.String,
  exit: Schema.Number,
  keep: Schema.Boolean,
  /** What the agent's turn spent, for the field row. */
  spent: Spent,
});

const record = Cmd.make("record", { input: Entry, ok: Done, err: ["unknown"] });

type Cmds =
  | ReturnType<typeof boxNew>
  | ReturnType<typeof stepRead>
  | ReturnType<typeof backupPush>
  | ReturnType<typeof record>;

type DraftSub = Sub<"draft", Ask>;
/** The agent's turn, as it ended (./agents.ts). */
type Drafted = { readonly type: "drafted"; readonly turned: Turned<Answer> };

type Model =
  | { readonly phase: "idle" }
  | { readonly phase: "starting" | "drafting"; readonly ask: Ask }
  | {
      readonly phase: "reading";
      readonly ask: Ask;
      readonly answer: Answer | null;
      readonly spent: Spent;
    }
  | {
      readonly phase: "pushing";
      readonly ask: Ask;
      readonly outcome: Outcome;
      readonly reason: string;
      readonly head: string;
      readonly left: readonly string[];
      readonly spent: Spent;
    }
  | {
      readonly phase: "recording" | "over";
      readonly ask: Ask;
      readonly outcome: End;
      readonly reason: string;
      readonly head: string;
      readonly kept: boolean;
      readonly spent: Spent;
    };

type Msg = { readonly type: "start"; readonly ask: Ask } | Drafted;

// ---------------------------------------------------------------- the Check

const ANSWER = /^[`*\s]*answer:\s*(done|send\s+(tests|build|plan)|ask|skip|stuck)\b[`*\s]*(.*)$/i;

/**
 * How a report's answer reads. Only `one` is the step's own word. `none`, `many` and `unread` are
 * all stuck:no_answer: a report with two answers that disagree was once taken as its last one
 * (p16b review7, 2026-11-10, ticket 557).
 */
const Said = Schema.TaggedUnion({
  none: {},
  many: { count: Schema.Number },
  unread: {},
  one: { verb: Schema.String, to: Schema.String, reason: Schema.String },
});

const FENCE = /^(`{3,}|~{3,})/;

/** The report's lines outside its code fences, trimmed, the empty ones dropped. A plan quotes code
 * with an `answer:` field, and a fence left open hides the rest. */
const outsideFences = (report: string) => {
  const lines: string[] = [];
  let fenced = false;

  for (const line of report.split("\n").map((l) => l.trim())) {
    if (FENCE.test(line)) {
      fenced = !fenced;
    } else if (!fenced && line !== "") {
      lines.push(line);
    }
  }

  return lines;
};

/** What the step said: its one `answer:` line. None, two or more, or one with no verb is not an answer. */
const readAnswer = (report: string): typeof Said.Type => {
  const lines = outsideFences(report).filter((l) => /^[`*\s]*answer:/i.test(l));

  if (lines.length !== 1) {
    return lines.length === 0 ? Said.cases.none.make({}) : Said.cases.many.make({ count: lines.length });
  }

  const m = ANSWER.exec(lines[0] ?? "");

  if (m === null) {
    return Said.cases.unread.make({});
  }

  const verb = (m[1] ?? "").split(/\s+/)[0]?.toLowerCase() ?? "";
  const reason = (m[3] ?? "").replace(/^[`*\s]+|[`*\s]+$/g, "");
  return Said.cases.one.make({ verb, to: m[2]?.toLowerCase() ?? "", reason });
};

/** A review is merge-ready only when its first line says so and no line says `changes: <n>`, n above 0. */
const mergeReady = (report: string) => {
  const lines = outsideFences(report).map((l) => l.replace(/^[`*#\s]+/, ""));
  return /^merge-ready\b/i.test(lines[0] ?? "") && !lines.some((l) => /^changes:\s*0*[1-9]/i.test(l));
};

const GREEN = /^[`* \t]*laws:[ \t]*green\b[`* \t:]*(.*)$/im;

/** A build that changed nothing says which laws it ran green with a `laws: green <paths>` line.
 * The head is the tests step's, already checked, and the mutation step's baseline reruns them. */
const greenOf = (report: string) => {
  const m = GREEN.exec(report);

  if (m === null) {
    return null;
  }

  return (m[1] ?? "").replace(/[`*\s]+$/, "") || "laws named";
};

type Judged = { readonly outcome: Outcome; readonly reason: string };
type Ended = { readonly outcome: End; readonly reason: string };

const stuck = (why: Extract<Outcome, { kind: "stuck" }>["why"], text: string): Judged => ({
  outcome: { kind: "stuck", why },
  reason: text,
});

/** What the typed answer says, as the one answer `readAnswer` reads; `null` when the agent gave none. */
export const answerWords = (answer: Answer | null) =>
  answer === null ? null : Said.cases.one.make({ verb: answer.verb, to: answer.to ?? "", reason: answer.reason });

/**
 * The Check, pure: what the reads found wins over what the step said. The step's word is its typed
 * answer (./agents.ts), or, for a report with none, its one `answer:` line. A review's `done`,
 * typed or not, also needs a merge-ready verdict line.
 */
export const decide = (ask: Ask, read: Read, answer: Answer | null = null): Judged => {
  if (read.head === null) {
    return stuck("fetch_failed", read.problem ?? "fetch failed");
  }

  if (read.problem !== null) {
    return stuck("read_failed", read.problem);
  }

  if (ask.step === "review" && read.changed > 0) {
    return stuck("review_committed", `the review left ${read.changed} files changed in its box`);
  }

  if (ask.step === "review" && read.head !== ask.base) {
    return stuck("review_committed", `the review moved the head to ${read.head.slice(0, 8)}`);
  }

  if (read.unsigned.length > 0) {
    return stuck("unsigned", read.unsigned.slice(0, 5).join("; "));
  }

  if (read.leaks.length > 0) {
    return stuck("leak", `added lines leak, nothing pushed: ${read.leaks.slice(0, 10).join(" ")}`);
  }

  if (ask.step === "build" && read.exam.length > 0) {
    return {
      outcome: { kind: "send", to: "tests", why: "exam_paths" },
      reason: `the build touched exam paths: ${read.exam.join(" ")}`,
    };
  }

  // A box has no network, so it cannot refresh the lockfile; the lead does, outside it (ticket 385).
  if (read.manifests.length > 0) {
    return {
      outcome: { kind: "ask", who: "lead", for: "lockfile" },
      reason:
        `pnpm-lock.yaml is behind ${read.manifests.join(" ")}, and a box has no network. ` +
        `Outside the box, on ${wipOf(ask.branch)} at ${read.head.slice(0, 8)}: ` +
        "pnpm install --lockfile-only, check each new version is exact and the plan names it, " +
        `commit pnpm-lock.yaml as a lead commit with stepcommit.sh, push it with botpush.mjs, ` +
        `then run ${ask.step} again`,
    };
  }

  if (ask.step === "plan" && read.plancheck !== null) {
    return {
      outcome: { kind: "send", to: "plan", why: "plancheck" },
      reason: `plancheck --draft: ${read.plancheck}`,
    };
  }

  const said = answerWords(answer) ?? readAnswer(read.report);

  if (said._tag === "none") {
    return stuck("no_answer", "no answer line in the report");
  }

  if (said._tag === "many") {
    return stuck("no_answer", `${said.count} answer lines in the report, and drive takes exactly one`);
  }

  if (said._tag === "unread") {
    return stuck("no_answer", "the answer line names no verb drive knows");
  }

  switch (said.verb) {
    case "done":
      if (ask.step === "build" && read.commits === 0) {
        const green = answer?.laws ?? greenOf(read.report);

        if (green === null) {
          return stuck("no_commit", "answered done with no commit");
        }

        return {
          outcome: { kind: "done", part: false, head: read.head },
          reason: `no commit: every law already green at ${read.head.slice(0, 8)} (${green})`,
        };
      }

      if (ask.step === "tests" && read.commits === 0) {
        return stuck("no_commit", "answered done with no commit");
      }

      if (ask.step === "review" && !mergeReady(read.report)) {
        return stuck("no_answer", "answered done under a verdict that is not merge-ready");
      }

      return { outcome: { kind: "done", part: false, head: read.head }, reason: said.reason };
    case "send": {
      const to = said.to === "tests" ? "tests" : said.to === "plan" ? "plan" : "build";
      return { outcome: { kind: "send", to, why: "step_said" }, reason: said.reason };
    }
    case "ask":
      return { outcome: { kind: "ask", who: "lead", for: "question" }, reason: said.reason };
    case "skip":
      return { outcome: { kind: "skip", why: "step_said" }, reason: said.reason };
    default:
      return stuck("step_said", said.reason);
  }
};

/** Every file drive keeps for one box, by suffix. A box name is fresh only when none exists. */
const BOX_FILES = [
  "",
  "-gitdata",
  "-view",
  "-mutbox",
  "-prompt.md",
  ".md",
  ".jsonl",
  ".err",
  ".log",
  "-plan.md",
  "-plan.jsonl",
];

/**
 * The first box `<lane>-<step><n>`, from `n` up, that no file of an older run holds. A refused run
 * once returned an older run's `<box>.md` as its report (p12 review5, 2026-11-09, ticket 383).
 */
export const freshBox = (lane: string, step: string, n: number, taken: (name: string) => boolean): string => {
  for (let i = n; ; i += 1) {
    const box = `${lane}-${step}${i}`;

    if (!BOX_FILES.some((suffix) => taken(`${box}${suffix}`))) {
      return box;
    }
  }
};

/**
 * The report's path when this run wrote it: the file exists (`mtime` is its mtime in ms) and is no
 * older than the run's start, read to the whole second for file systems that keep only seconds. A
 * run that wrote none, such as one box.sh refused before the agent started, gives no report.
 */
export const reportOf = (path: string, started: number, mtime: number | null): string | null =>
  mtime !== null && mtime >= Math.floor(started / 1000) * 1000 ? path : null;

// ---------------------------------------------------------------- the machine

type Step = readonly [Model, readonly Cmds[]];
const stay = (s: Model): Step => [s, []];

/** A stuck box stays for the lead to look at, and so does one holding work no branch has, whatever
 * the step answered (layers build2, 2026-11-09: a send back removed 10 uncommitted files). */
const recordIt = (ask: Ask, j: Ended, head: string, spent: Spent, left: readonly string[] = []): Step => {
  const kept = j.outcome.kind === "stuck" || left.length > 0;
  const reason = left.length > 0 ? `${j.reason} (box kept: ${left.join(", ")})` : j.reason;
  const entry = record({
    ask,
    outcome: endName(j.outcome),
    reason,
    head,
    exit: exitOf(j.outcome),
    keep: kept,
    spent,
  });
  return [{ phase: "recording", ask, outcome: j.outcome, reason, head, kept, spent }, [entry]];
};

/** The Draft: the agent's one turn, a Sub keyed on the Ask while the step drafts. */
const draft: DepKeyedSub<Model, DraftSub> = {
  type: "draft",
  deps: (s: Model) => (s.phase === "drafting" ? s.ask : null),
} as DepKeyedSub<Model, DraftSub>;

export const machine = defineMachine({
  types: { model: {} as Model, msg: {} as Msg, sub: {} as DraftSub, ctx: undefined },
  cmds: [boxNew, stepRead, backupPush, record],
  init: (): Step => [{ phase: "idle" }, []],
  subs: [draft],
  update: {
    start: (s, m): Step => {
      if (s.phase !== "idle") {
        return stay(s);
      }

      if (m.ask.step === "plan") {
        return [{ phase: "drafting", ask: m.ask }, []];
      }

      return [{ phase: "starting", ask: m.ask }, [boxNew(m.ask)]];
    },
    box_new_ok: (s, m): Step => {
      if (s.phase !== "starting") {
        return stay(s);
      }

      const started = m.value;

      if (started._tag === "refused") {
        return recordIt(
          s.ask,
          { outcome: { kind: "refused", check: started.check }, reason: started.detail },
          s.ask.base,
          NO_SPENT,
        );
      }

      if (started._tag === "failed") {
        return recordIt(s.ask, stuck("box_failed", started.detail), s.ask.base, NO_SPENT);
      }

      return [{ phase: "drafting", ask: s.ask }, []];
    },
    box_new_err: (s): Step =>
      s.phase === "starting" ? recordIt(s.ask, stuck("box_failed", "box.sh new threw"), s.ask.base, NO_SPENT) : stay(s),
    drafted: (s, m): Step => {
      if (s.phase !== "drafting") {
        return stay(s);
      }

      const t = m.turned;

      if (t._tag === "failed") {
        return recordIt(
          s.ask,
          stuck("agent_failed", `${s.ask.agent} ${t.reason}: ${t.message}; see ${s.ask.events}`),
          s.ask.base,
          t.spent,
        );
      }

      if (t.stop === "over_time") {
        return recordIt(s.ask, stuck("timeout", `stopped after ${s.ask.minutes} minutes`), s.ask.base, t.spent);
      }

      if (t.stop !== "end_turn") {
        return recordIt(s.ask, stuck("agent_failed", `${s.ask.agent} stopped: ${t.stop}`), s.ask.base, t.spent);
      }

      return [{ phase: "reading", ask: s.ask, answer: t.answer, spent: t.spent }, [stepRead(s.ask)]];
    },
    step_read_ok: (s, m): Step => {
      if (s.phase !== "reading") {
        return stay(s);
      }

      const j = decide(s.ask, m.value, s.answer);
      const head = m.value.head ?? s.ask.base;

      if (j.outcome.kind !== "stuck" && m.value.commits > 0) {
        const asked = backupPush({ ask: s.ask, head });
        const pushing = { outcome: j.outcome, reason: j.reason, head, left: m.value.left, spent: s.spent };
        return [{ phase: "pushing", ask: s.ask, ...pushing }, [asked]];
      }

      return recordIt(s.ask, j, head, s.spent, m.value.left);
    },
    step_read_err: (s): Step =>
      s.phase === "reading"
        ? recordIt(s.ask, stuck("fetch_failed", "reading the step threw"), s.ask.base, s.spent)
        : stay(s),
    backup_push_ok: (s, m): Step => {
      if (s.phase !== "pushing") {
        return stay(s);
      }

      if (!m.value.ok) {
        return recordIt(s.ask, stuck("push_failed", m.value.detail), s.head, s.spent, s.left);
      }

      return recordIt(s.ask, { outcome: s.outcome, reason: s.reason }, s.head, s.spent, s.left);
    },
    backup_push_err: (s): Step =>
      s.phase === "pushing" ? recordIt(s.ask, stuck("push_failed", "botpush threw"), s.head, s.spent, s.left) : stay(s),
    record_ok: (s, m): Step => {
      if (s.phase !== "recording") {
        return stay(s);
      }

      if (m.value.ok) {
        return [{ ...s, phase: "over" }, []];
      }

      const outcome: Outcome = { kind: "stuck", why: "record_failed" };
      return [{ ...s, phase: "over", outcome, reason: `${s.reason} (${m.value.detail})`, kept: true }, []];
    },
    record_err: (s): Step =>
      s.phase === "recording"
        ? [
            {
              ...s,
              phase: "over",
              outcome: { kind: "stuck", why: "record_failed" },
              reason: `${s.reason} (not recorded)`,
              kept: true,
            },
            [],
          ]
        : stay(s),
  },
});

// ---------------------------------------------------------------- the world

export type Env = {
  readonly MAIN: string;
  readonly BOXES: string;
  readonly GH_REPO: string;
  /** The model a Codex box runs and its effort (env.sh, decision 0022). */
  readonly CODEX_MODEL: string;
  readonly CODEX_EFFORT: string;
};

export const sh = (cmd: string, args: readonly string[], cwd?: string) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
};

const tail = (text: string, n = 3) => text.trim().split("\n").slice(-n).join(" | ");

/** This run's report, or `null` when it wrote none. */
const writtenReport = (ask: Ask) => {
  const mtime = existsSync(ask.report) ? statSync(ask.report).mtimeMs : null;
  return reportOf(ask.report, ask.started, mtime);
};

/** The paths env.sh gives every lead script. */
export const loadEnv = (): Env => {
  const r = sh("sh", [
    "-c",
    '. "$0" && printf "%s\\n%s\\n%s\\n%s\\n%s\\n" "$MAIN" "$BOXES" "$GH_REPO" "$CODEX_MODEL" "$CODEX_EFFORT"',
    join(HERE, "env.sh"),
  ]);
  const [MAIN = "", BOXES = "", GH_REPO = "", CODEX_MODEL = "", CODEX_EFFORT = ""] = r.out.split("\n");

  if (r.code !== 0 || !MAIN) {
    throw new Error(`env.sh failed: ${r.err}`);
  }

  return { MAIN, BOXES, GH_REPO, CODEX_MODEL, CODEX_EFFORT };
};

// Shapes that leak on any machine: home and temp folders, key prefixes, private keys, em dashes.
const SHAPES = [
  /\/Users\/[A-Za-z]/,
  /\/home\/[a-z]/,
  /\/private\/(tmp|var)\//,
  /\/var\/folders\/[a-z0-9_]{2}\//,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY/,
  // An em dash, built from its code so this file has none.
  new RegExp(String.fromCharCode(0x2014)),
];

/** `file:line` of each added line that leaks. The private words are read here and never printed. */
const leaksIn = (diff: string, repo: string): string[] => {
  const file = join(homedir(), ".fabrika/leak-words");
  const words = existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .map((w) => w.trim().toLowerCase())
        .filter(Boolean)
    : [];
  const hits: string[] = [];
  let path: string | null = null;
  let line = 0;

  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      path = raw.startsWith("+++ b/") ? raw.slice(6) : null;
    } else if (raw.startsWith("@@")) {
      line = Number(/\+(\d+)/.exec(raw)?.[1] ?? 0);
    } else if (raw.startsWith("+") && path !== null) {
      const text = raw.slice(1).replaceAll(repo, "");
      const low = text.toLowerCase();

      if (SHAPES.some((s) => s.test(text)) || words.some((w) => low.includes(w))) {
        hits.push(`${path}:${line}`);
      }

      line += 1;
    }
  }

  return hits;
};

const unsignedIn = (env: Env, ask: Ask, head: string): string[] => {
  // stepcommit signs mutation as tests for now.
  const expect = ask.step === "mutation" ? "tests" : ask.step;
  const shas = sh("git", ["-C", env.MAIN, "rev-list", `${ask.base}..${head}`])
    .out.split("\n")
    .filter(Boolean);
  return shas.flatMap((sha) => {
    const r = sh("git", ["-C", env.MAIN, "notes", "--ref=fabrika", "show", sha]);

    if (r.code !== 0) {
      return [`${sha.slice(0, 8)} has no step note`];
    }

    const note = JSON.parse(r.out) as { _tag?: string; step?: string; ticket?: string };

    if (note._tag !== "attested") {
      return [`${sha.slice(0, 8)} note is not attested`];
    }

    if (note.step !== expect) {
      return [`${sha.slice(0, 8)} signed ${note.step}, not ${expect}`];
    }

    if (String(note.ticket) !== ask.ticket) {
      return [`${sha.slice(0, 8)} signed for ticket ${note.ticket}, not ${ask.ticket}`];
    }

    return [];
  });
};

/** The steps signed on the lane's own commits, from where it left main. */
const stepsIn = (env: Env, root: string, head: string): Set<string> =>
  new Set(
    sh("git", ["-C", env.MAIN, "rev-list", `${root}..${head}`])
      .out.split("\n")
      .filter(Boolean)
      .flatMap((sha) => {
        const r = sh("git", ["-C", env.MAIN, "notes", "--ref=fabrika", "show", sha]);
        return r.code === 0 ? stepOf(r.out) : [];
      }),
  );

// Git with no hooks and no repo-set helpers, so nothing Claude wrote into a tree runs as drive.
const SAFE_GIT = {
  ...process.env,
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "core.hooksPath",
  GIT_CONFIG_VALUE_0: "/dev/null",
  GIT_CONFIG_KEY_1: "core.fsmonitor",
  GIT_CONFIG_VALUE_1: "false",
};

/** Git on the box's own data from outside it: by the data folder, never through the `.git` file
 * the agent could rewrite, with no hooks and no fsmonitor, so nothing it wrote runs as drive. */
const boxGit = (env: Pick<Env, "BOXES">, box: string, ...args: string[]) => {
  const r = spawnSync(
    "git",
    [
      `--git-dir=${join(env.BOXES, `${box}-gitdata`)}`,
      `--work-tree=${join(env.BOXES, box)}`,
      "-c",
      "status.renames=false",
      ...args,
    ],
    { encoding: "utf8", env: SAFE_GIT },
  );
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
};

/**
 * Git the agent can read. The box's own git data sits beside the box, where the harness closes
 * everything, and it borrows its objects from the main checkout, closed too. So the agent gets a
 * view: a mirror of the main checkout's git data (hard links, no copy), holding the box as a linked
 * worktree at the step's base. The harness opens a worktree's git folder to read only
 * (`gitOf` in packages/fabrika/src/agents/claude/sandbox.ts), so `git diff`, `log` and `show` work
 * in the box and nothing git keeps can be written. drive never reads the view or the box's `.git`
 * file: it reads the box's own data (`boxGit`). Returns what failed, or `null`.
 */
const gitView = (env: Env, ask: Ask): string | null => {
  const work = join(env.BOXES, ask.box);
  const view = join(env.BOXES, `${ask.box}-view`);
  const own = join(view, "worktrees", ask.box);
  const clone = sh("git", ["clone", "-q", "--mirror", "--local", env.MAIN, view]);

  if (clone.code !== 0) {
    return `git view: ${tail(clone.err)}`;
  }

  mkdirSync(own, { recursive: true });
  writeFileSync(join(own, "commondir"), "../..\n");
  writeFileSync(join(own, "gitdir"), `${join(work, ".git")}\n`);
  writeFileSync(join(own, "HEAD"), `${ask.base}\n`);
  copyFileSync(join(env.BOXES, `${ask.box}-gitdata`, "index"), join(own, "index"));
  writeFileSync(join(work, ".git"), `gitdir: ${own}\n`);
  return null;
};

/** The view goes when the step ends, and a box that stays gets its own `.git` line back. */
const dropView = (env: Env, box: string) => {
  const work = join(env.BOXES, box);
  rmSync(join(env.BOXES, `${box}-view`), { recursive: true, force: true });

  if (box !== "" && existsSync(join(env.BOXES, `${box}-gitdata`)) && existsSync(work)) {
    writeFileSync(join(work, ".git"), `gitdir: ${join(env.BOXES, `${box}-gitdata`)}\n`);
  }
};

/** One file the agent left changed. `from` is set only for a case-only rename: its old name. */
export type Change = { readonly xy: string; readonly path: string; readonly from?: string };

/** Each file the agent left changed in the box's tree, by its status letters. */
export const changedFiles = (porcelain: string): Change[] =>
  porcelain
    .split("\0")
    .filter(Boolean)
    .map((e) => ({ xy: e.slice(0, 2), path: e.slice(3) }));

/**
 * Case-only renames, which `git status` cannot see on a disk that ignores case: a tracked `id.ts`
 * the agent renamed to `Id.ts` reads as a modified `id.ts`, or as nothing when its text is the
 * same (ticket 573). The disk's own name, from `realpath`, says it moved. Each answer is the
 * tracked name and the name on disk. A deleted file, a folder whose case changed and a disk that
 * keeps case all give none: git already sees those, or (a folder) this does not handle them.
 */
export const caseRenames = (box: string, tracked: readonly string[]): { from: string; path: string }[] => {
  const top = realpathSync.native(box);
  const out: { from: string; path: string }[] = [];

  for (const from of tracked) {
    const at = join(box, from);

    if (!existsSync(at)) {
      continue;
    }

    const path = realpathSync.native(at).slice(top.length + 1);

    if (
      path !== from &&
      path.toLowerCase() === from.toLowerCase() &&
      path.split("/").slice(0, -1).join("/") === from.split("/").slice(0, -1).join("/")
    ) {
      out.push({ from, path });
    }
  }

  return out;
};

/**
 * What the agent left in the box's tree, read from outside the box: every edited, deleted and new
 * file by its own name, a new folder file by file. The agent cannot commit, so this is all the
 * work a box holds. A box whose data cannot be read answers a non-zero `code`, never "no changes".
 */
export const boxChanges = (env: Pick<Env, "BOXES">, box: string) => {
  const status = boxGit(env, box, "status", "--porcelain=v1", "-z", "--untracked-files=all");

  if (status.code !== 0) {
    return { ...status, changes: [] as Change[] };
  }

  const listed = boxGit(env, box, "ls-files", "--cached", "-z");

  if (listed.code !== 0) {
    return { ...listed, changes: [] as Change[] };
  }

  const moved = caseRenames(join(env.BOXES, box), listed.out.split("\0").filter(Boolean));
  const old = new Set(moved.map((m) => m.from));
  const changes: Change[] = [
    ...changedFiles(status.out).filter((c) => !old.has(c.path)),
    ...moved.map((m) => ({ xy: "R ", ...m })),
  ];
  return { ...status, changes };
};

/**
 * The step commit's subject: the report's first line of prose, else the `reason` of its JSON answer
 * (a report can be the answer alone), else a plain stand-in. One line, cut to fit.
 */
export const commitSubject = (ask: Pick<Ask, "ticket" | "step">, report: string): string => {
  const lines = report.split("\n").map((l) => l.replace(/^[#*`\s]+|[*`\s]+$/g, ""));
  const prose = lines.find((l) => l.length > 0 && !l.startsWith("{"));
  const reason = lines
    .filter((l) => l.startsWith("{"))
    .map((l) => /"reason"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(l)?.[1]?.replace(/\\(.)/g, "$1").trim())
    .find((w) => w !== undefined && w.length > 0);
  return `T${ask.ticket} ${ask.step}: ${(prose ?? reason ?? "the step's work").slice(0, 72)}`;
};

/**
 * The agent holds no key and cannot reach the box's git data, so it commits nothing. Its changes
 * are read from the tree and copied into a fresh worktree of the main checkout at the base;
 * stepcommit commits them as the bot and signs them as the step, with main's own signer. The
 * branch then points at that one signed commit, or stays at the base when nothing changed.
 */
const collect = (env: Env, ask: Ask, changes: readonly Change[]) => {
  const git = (...args: string[]) => {
    const r = spawnSync("git", ["-C", env.MAIN, ...args], { encoding: "utf8", env: SAFE_GIT });
    return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
  };

  if (changes.length === 0) {
    return git("update-ref", `refs/heads/${ask.branch}`, ask.base);
  }

  const subject = commitSubject(ask, readFileSync(ask.report, "utf8"));
  const wt = join(env.BOXES, `${ask.box}-sign`);
  const add = git("worktree", "add", "-q", "--detach", wt, ask.base);

  if (add.code !== 0) {
    return add;
  }

  try {
    const box = join(env.BOXES, ask.box);

    for (const { xy, path, from: old } of changes) {
      const to = join(wt, path);
      rmSync(to, { force: true, recursive: true });

      // A case-only rename: the old name's file goes, so the copy below writes the new name on
      // disk, and stepcommit drops the old index entry.
      if (old !== undefined) {
        rmSync(join(wt, old), { force: true });
      }

      if (xy.includes("D")) {
        continue;
      }

      const from = join(box, path);
      const stat = lstatSync(from);
      mkdirSync(join(to, ".."), { recursive: true });

      if (stat.isSymbolicLink()) {
        symlinkSync(readlinkSync(from), to);
      } else {
        copyFileSync(from, to);
        chmodSync(to, stat.mode & 0o777);
      }
    }

    const r = spawnSync(
      "sh",
      [
        join(HERE, "../../step-commit/scripts/stepcommit.sh"),
        ask.step,
        ask.ticket,
        subject,
        ...changes.map((c) => c.path),
      ],
      {
        cwd: wt,
        encoding: "utf8",
        env: {
          ...SAFE_GIT,
          // The fresh worktree has no node_modules, so stepcommit's format check finds
          // oxfmt in the main checkout's, where the signer comes from too.
          PATH: `${join(env.MAIN, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
          STEPCOMMIT_SIGNER: `node ${join(env.MAIN, "next/apps/fabrika/src/exam/commits.ts")}`,
          // The sign worktree is not the box: name the box whose facts stepcommit checks.
          STEPCOMMIT_BOX: ask.box,
        },
      },
    );

    if (r.status !== 0) {
      return { code: r.status ?? -1, out: "", err: `stepcommit: ${r.stdout}${r.stderr}` };
    }

    const head = sh("git", ["-C", wt, "rev-parse", "HEAD"]).out.trim();
    return git("update-ref", `refs/heads/${ask.branch}`, head);
  } finally {
    git("worktree", "remove", "--force", wt);
  }
};

/** Why the commits check held the step: each rule and commit, else its exit and last lines. */
export const commitsSaid = (
  check: { code: number; out: string; err: string },
  laneSteps: ReadonlySet<string>,
): string => {
  const rules = heldRules(check.out, laneSteps);
  return rules.length > 0
    ? `commits check: ${rules.slice(0, 5).join("; ")}${rules.length > 5 ? `; and ${rules.length - 5} more` : ""}`
    : `commits check exit ${check.code}: ${tail(check.out + check.err)}`;
};

/**
 * What box.sh new's exit and stderr say: exit 3 with a `refused <check>: <why>` line is a start
 * check's no; any other failure, or a line naming no known check, is the box failing.
 */
export const startedOf = (code: number, err: string): typeof Started.Type => {
  if (code === 0) {
    return Started.cases.made.make({});
  }

  const line = err
    .split("\n")
    .toReversed()
    .map((l) => /^refused ([a-z_]+): ?(.*)$/.exec(l.trim()))
    .find((m) => m !== null);
  const check = BOX_CHECKS.find((c) => c === line?.[1]);

  if (code === 3 && line && check) {
    return Started.cases.refused.make({ check, detail: line[2] ?? "" });
  }

  return Started.cases.failed.make({ detail: `box.sh new: ${tail(err)}` });
};

const handlers = (env: Env) => {
  const box = (...args: string[]) => sh("sh", [join(HERE, "box.sh"), ...args]);
  const git = (...args: string[]) => sh("git", ["-C", env.MAIN, "-c", "core.hooksPath=/dev/null", ...args]);
  return {
    box_new: (cmd: Ask) =>
      Effect.sync(() => {
        const r = box(
          "new",
          cmd.box,
          cmd.base,
          cmd.branch,
          "--ticket",
          cmd.ticket,
          "--plan",
          cmd.plan,
          "--root",
          cmd.root,
          "--lane",
          cmd.lane,
        );
        writeFileSync(join(env.BOXES, `${cmd.box}.log`), r.out + r.err);
        const started = startedOf(r.code, r.err);

        if (started._tag !== "made") {
          return started;
        }

        const problem = gitView(env, cmd);
        return problem === null ? started : Started.cases.failed.make({ detail: problem });
      }),
    step_read: (ask: Ask) =>
      Effect.sync((): Read => {
        const written = writtenReport(ask);
        const report = written === null ? "" : readFileSync(written, "utf8");
        const empty = {
          commits: 0,
          unsigned: [],
          exam: [],
          leaks: [],
          left: [] as string[],
          manifests: [],
          plancheck: null,
          changed: 0,
          report,
        };

        if (ask.step === "plan") {
          const r = sh("sh", [join(HERE, "../../plan/scripts/plancheck.sh"), "--draft", ask.report], env.MAIN);
          return {
            ...empty,
            head: ask.base,
            plancheck: r.code === 0 ? null : tail(r.out + r.err),
            problem: null,
          };
        }

        // What the agent left in the tree, read from outside the box. A review leaves nothing, so
        // its branch stays at the base and nothing is committed.
        const status = boxChanges(env, ask.box);

        if (status.code !== 0) {
          return { ...empty, head: null, problem: `box status: ${tail(status.err)}` };
        }

        const { changes } = status;
        empty.changed = changes.length;
        // Work the box holds that no branch has: what the agent changed, until it is collected.
        const held = changes.length > 0 ? [`${changes.length} uncommitted files`] : [];
        const ref = `refs/heads/${ask.branch}`;
        const f = ask.step === "review" ? { code: 0, err: "" } : collect(env, ask, changes);

        if (f.code !== 0) {
          return {
            ...empty,
            head: null,
            left: held,
            problem: `collect: ${tail(f.err)}`,
          };
        }

        if (ask.step === "review") {
          empty.left = held;
        }

        const head = ask.step === "review" ? ask.base : git("rev-parse", ref).out.trim();
        const failed = (what: string, r: { code: number; err: string }) => ({
          ...empty,
          head,
          problem: `${what}: ${tail(r.err)}`,
        });
        const count = git("rev-list", "--count", `${ask.base}..${head}`);

        if (count.code !== 0) {
          return failed("rev-list", count);
        }

        const commits = Number(count.out.trim());
        // Every path any commit touched, so a change undone by a later commit still counts.
        const touched = git("log", "--format=", "--name-only", `${ask.base}..${head}`);

        if (touched.code !== 0) {
          return failed("git log", touched);
        }

        const names = [...new Set(touched.out.split("\n").filter(Boolean))];
        const at = (rev: string, path: string) => {
          const r = git("show", `${rev}:${path}`);
          return r.code === 0 ? r.out : null;
        };
        const manifests = lockfileBehind(
          names
            .filter((n) => n === "pnpm-workspace.yaml" || /(^|\/)package\.json$/.test(n))
            .map((path) => ({ path, before: at(ask.base, path), after: at(head, path) })),
          workspaceGlobs(at(head, "pnpm-workspace.yaml") ?? ""),
          names.includes("pnpm-lock.yaml"),
        );
        const examRun =
          names.length === 0
            ? { code: 0, out: "", err: "" }
            : sh("python3", [
                "-I",
                join(HERE, "../../step-commit/scripts/exam.py"),
                join(env.MAIN, "exam-paths.json"),
                ...names,
              ]);

        if (examRun.code > 1) {
          return failed("exam.py", examRun);
        }

        const exam = examRun.out
          .split("\n")
          .filter(Boolean)
          .map((l) => l.split("\t")[0] ?? l);
        // Each commit's own added lines, so nothing a later commit removed slips past.
        const diff = git("log", "-p", "-U0", "--no-color", "--format=", `${ask.base}..${head}`);

        if (diff.code !== 0) {
          return failed("git log -p", diff);
        }

        // The repo's own commit check verifies the signatures; this step's name is checked here.
        const check =
          commits === 0
            ? { code: 0, out: "", err: "" }
            : sh(
                "node",
                [join(env.MAIN, "next/apps/fabrika/src/exam/commits.ts"), "check", "--base", ask.root, "--head", head],
                env.MAIN,
              );

        if (check.code > 1) {
          return failed("commits check", check);
        }

        // Exit 1 holds the step unless every stuck answer it gave was a waived stale link.
        const laneSteps = stepsIn(env, ask.root, head);
        const holds = checkHolds(check.code, check.out, laneSteps);
        const unsigned = [...(holds ? [commitsSaid(check, laneSteps)] : []), ...unsignedIn(env, ask, head)];
        return {
          head,
          commits,
          unsigned,
          exam,
          leaks: leaksIn(diff.out, env.GH_REPO),
          left: empty.left,
          manifests,
          plancheck: null,
          changed: changes.length,
          report,
          problem: null,
        };
      }),
    backup_push: (cmd: { ask: Ask; head: string }) =>
      Effect.sync(() => {
        const r = sh("node", [join(HERE, "botpush.mjs"), env.MAIN, wipOf(cmd.ask.branch), cmd.head]);
        return {
          ok: r.code === 0,
          detail: r.code === 0 ? tail(r.out, 1) : `botpush: ${tail(r.out + r.err, 1)}`,
        };
      }),
    record: (e: typeof Entry.Type) =>
      Effect.sync(() => {
        const { ask } = e;
        const notes: string[] = [];
        const ended = new Date().toISOString();
        dropView(env, ask.box);

        // The saved files are scrubbed first (redact.sh prints only a count), then the field row,
        // held beside the boxes until a field PR lands it.
        if (existsSync(ask.events)) {
          const scrubbed = sh("sh", [join(HERE, "redact.sh"), ask.report, ask.events]);
          const redacted = scrubbed.code === 0 ? Number(scrubbed.out.trim()) : null;

          if (scrubbed.code !== 0) {
            notes.push(`redact.sh failed: ${tail(scrubbed.err, 1)}`);
          }

          appendFileSync(
            join(env.BOXES, `${ask.lane}-rows.jsonl`),
            stepRow({
              run: ask.run,
              ticket: ask.ticket,
              step: ask.step,
              provider: stepProvider(ask.agent, ask.step),
              model: ask.model,
              effort: ask.effort,
              outcome: rowOf(e.outcome),
              reason: `drive.ts ${ask.step} in box ${ask.box} at ${ask.base.slice(0, 8)}: ${e.outcome}. ${e.reason}`,
              started: new Date(ask.started),
              ended: new Date(ended),
              spent: e.spent,
              redacted: Number.isFinite(redacted) ? redacted : null,
            }),
          );
        }

        const ok = notes.length === 0;
        const outcome = ok ? e.outcome : "stuck:record_failed";
        const keep = e.keep || !ok;
        // A stuck step, or a build sent back for exam paths, does not move the lane's head.
        const accepted =
          !outcome.startsWith("stuck") && !outcome.startsWith("refused") && outcome !== "send:tests:exam_paths";
        const state = join(env.BOXES, "state", `${ask.lane}.json`);
        const saved = existsSync(state)
          ? (JSON.parse(readFileSync(state, "utf8")) as Lane)
          : { lane: ask.lane, steps: [] };
        const entry = {
          step: ask.step,
          box: ask.box,
          run: ask.run,
          from: ask.base,
          head: e.head,
          outcome,
          why: ok ? e.reason : `${e.reason} (${notes.join("; ")})`,
          exit: ok ? e.exit : 30,
          report: writtenReport(ask),
          kept: keep,
          ended,
        };
        const lane: Lane = {
          ...saved,
          ticket: ask.ticket,
          plan: ask.plan,
          branch: ask.branch,
          root: ask.root,
          head: accepted ? e.head : (saved.head ?? ask.base),
          steps: [...saved.steps, entry],
        };
        writeFileSync(`${state}.tmp`, `${JSON.stringify(lane, null, "\t")}\n`);
        renameSync(`${state}.tmp`, state);
        appendFileSync(
          join(env.BOXES, "state", `${ask.lane}.md`),
          `- ${ended} drive.ts ${ask.step} in box ${ask.box}: ${outcome}, head ${e.head.slice(0, 8)}. ${e.reason}\n`,
        );

        if (!keep && ask.step !== "plan" && ask.box) {
          rmSync(join(env.BOXES, ask.box), { recursive: true, force: true });
          rmSync(join(env.BOXES, `${ask.box}-gitdata`), { recursive: true, force: true });
          // Its facts go with it, so no later stepcommit reads a dead box's plan hash.
          rmSync(join(env.BOXES, "state", `${ask.box}.box`), { force: true });
        }

        return { ok, detail: notes.join("; ") };
      }),
  };
};

/** What a step is told on top of the brief: its skill, and that drive commits its work. */
export const agentTail = (ask: Pick<Ask, "step" | "ticket">, electron: boolean) => {
  const skill = `You are the ${ask.step} step for ticket ${ask.ticket}, run by drive.ts in a box. Use the ${ask.step} skill: read .agents/skills/${ask.step}/SKILL.md first and follow it.\n`;
  const commit =
    ask.step === "plan"
      ? "Change no file. Your final message is the plan.\n"
      : ask.step === "review"
        ? "Change no file: a review that leaves a changed file is stuck. git reads work in your box (diff, log, show). Run no command that writes, not even a scratch copy or a temp file: your box refuses it, and a refused command ends your turn with no answer.\n"
        : "git only reads in your box (status, diff, log, show): its data is outside, where the box lets nothing write. Do not try to stage, stash, check out or commit, run stepcommit or pnpm commits sign; you hold no step key. Leave every change in the tree, and drive.ts commits and signs all of it as one step commit when you answer. Never push.\n";
  const lock = holdsElectron(ask.step, electron)
    ? "drive.ts holds the laptop's Electron lock (state/electron.lock) for you for this whole step, so do not take it or wait on it. Start at most one Electron app at a time, and close it before you answer.\n"
    : "";
  return `\n\n---\n${skill}${commit}${lock}`;
};

/**
 * The approved plan, whole, for a step in a box. The harness closes home around the box (Claude's
 * sandbox, Codex's fence), so a step cannot read a plan kept beside the boxes: it rides in the
 * prompt. A plan step writes the plan, and a missing file is box.sh new's refusal to make.
 */
export const planTail = (step: StepName, path: string, text: string | null) =>
  step === "plan" || text === null
    ? ""
    : `\n\n---\nThe approved plan (${path}), whole. Your box cannot read outside itself, so read it here:\n\n${text.trim()}\n`;

/**
 * The lane's newest mutation report, whole, for a review: the review reads it (the review skill,
 * "anything the brief names"), and its box reads nothing outside itself. Briefs named
 * `../<lane>-mutationN.md`, so two Codex reviews ended stuck after half a minute and a Claude
 * review said done without it (p34w-review1 and 2, layout-review2, 2026-11-10; ticket 569).
 */
export const mutationTail = (step: StepName, steps: Lane["steps"], read: (path: string) => string | null): string => {
  if (step !== "review") {
    return "";
  }

  const last = steps.findLast((s) => s.step === "mutation" && typeof s.report === "string");
  const text = last?.report ? read(last.report) : null;
  return text === null || !last?.report
    ? "\n\n---\nThis lane has no mutation report drive can read; say so in your review, and do not look for one outside your box.\n"
    : `\n\n---\nThe lane's newest mutation report (${last.report}), whole. Your box cannot read outside itself, so read it here:\n\n${text.trim()}\n`;
};

/** How a step's draft runs: what the step is asked, in; how its turn ended, out. */
type DraftRun = (env: Env, agents: Agents, ask: Ask) => Effect.Effect<Turned<Answer>>;

/** One turn of the agent in the box (a plan reads the main checkout), on the prompt given. */
const turn = (env: Env, agents: Agents, ask: Ask, prompt: string) =>
  runTurn(agents, {
    provider: stepProvider(ask.agent, ask.step),
    session: ask.box,
    folder: ask.step === "plan" ? env.MAIN : join(env.BOXES, ask.box),
    prompt,
    system: `You are the ${ask.step} step for ticket ${ask.ticket}, run by drive.ts; answer with the JSON object the prompt asks for.`,
    answer: Answer,
    model: ask.model,
    effort: ask.effort,
    minutes: ask.minutes,
    events: ask.events,
    report: ask.report,
  });

/** Any step but mutation: one turn on the prompt file, the brief with drive's tail. */
const turnDraft: DraftRun = (env, agents, ask) => turn(env, agents, ask, readFileSync(ask.prompt, "utf8"));

// ---------------------------------------------------------------- MUTATION WIRING (ticket 483)
//
// The one place that says how the mutation step runs. Everything else here and in the chain
// treats mutation as any step: the box, the git view, collect, the checks and the field row.
//
//   MUTATION_AGENT   who the chain starts it as, and the only agent `prepare` takes for it.
//   mutationDraft    how its draft runs: first the Stryker sample, in a container with its own
//                    network (mutbox.ts, decision 0045), on the step's start head with the tests
//                    the brief's `RELATED=` line names and the lane's root as arm a. Then one
//                    agent turn that reads the report. A run that ended stuck (Docker down, a
//                    second Docker box, a failed baseline) is a stuck step with no agent started.
//
// The agent's box reads nothing outside itself, so the report (`BOXES/<box>-mutbox/mutbox.json`)
// rides in its prompt, whole. This file opens no socket and allows none; that is the container's
// side.
export const MUTATION_AGENT: AgentName = "claude";

/** The related test paths a mutation brief names, on a line of its own: `RELATED=a.test.ts,b.test.ts`. */
export const relatedIn = (brief: string): string | undefined => /^RELATED=(\S.*)$/m.exec(brief)?.[1]?.trim();

const MutboxLine = Schema.fromJsonString(
  Schema.Struct({
    outcome: Schema.Literals(["done", "skip", "stuck"]),
    reason: Schema.String,
    detail: Schema.String,
  }),
);

/** What mutbox.ts answered, from its last line: its outcome and why. Anything else is stuck. */
export const mutboxAnswer = (stdout: string): { outcome: "done" | "skip" | "stuck"; reason: string } => {
  const line = Schema.decodeUnknownOption(MutboxLine)(stdout.trim().split("\n").at(-1) ?? "");
  return line._tag === "Some"
    ? {
        outcome: line.value.outcome,
        reason: [line.value.reason, line.value.detail].filter(Boolean).join(": "),
      }
    : { outcome: "stuck", reason: "mutbox.ts gave no answer" };
};

/** What a mutation agent is told about the run that already happened in the container. */
export const mutboxTail = (report: string, skip: boolean) =>
  `\n\n---\nThe Stryker run for this step already happened, in a container with its own network (decision 0045). Its report, the JSON file the lead keeps at ${report}, follows this note, whole, since your box reads nothing outside itself: the sample, the counts, each survivor with its file and line, the tests left out or skipped with the reason, and \`narrowing\`, the mutants arm a (the base's tests) kills and arm b (this branch's) lets live. Do not run Stryker, the mutation command or the sampler yourself, and start nothing that listens on a port. Read the report and do the skill's steps 3 to 6 from it.\n${skip ? "The sampler selected no mutation range, so commit nothing and end with `answer: skip <why>`.\n" : ""}`;

/** mutbox.ts's command line for one step: the build is the step's start head, arm a the lane's root. */
export const mutboxArgs = (env: Pick<Env, "MAIN" | "BOXES">, ask: Ask, related: string): Array<string> => [
  "run",
  "--checkout",
  env.MAIN,
  "--ticket",
  ask.ticket,
  "--build",
  ask.base,
  "--base",
  ask.root,
  "--related",
  related,
  "--out",
  join(env.BOXES, `${ask.box}-mutbox`),
  "--lock",
  dockerLock(env),
  "--plan",
  ask.plan,
];

/** The one Docker box's lock, as mutbox.ts takes it and drive's start check reads it. */
export const dockerLock = (env: Pick<Env, "BOXES">) => join(env.BOXES, "state", "docker.lock");

/** How mutbox.ts ran: its exit code and what it printed. */
export type MutboxRun = (args: ReadonlyArray<string>) => Effect.Effect<{ readonly code: number; readonly out: string }>;

/** The real run: mutbox.ts as a child process, its own log on our stderr. One that cannot start answers 127. */
const runMutbox: MutboxRun = (args) =>
  Effect.gen(function* () {
    const ran = yield* ChildProcess.make(process.execPath, [join(HERE, "mutbox.ts"), ...args], {
      extendEnv: true,
      stdin: "ignore",
      stderr: "inherit",
    });
    const [out, code] = yield* Effect.all([ran.stdout.pipe(Stream.decodeText(), Stream.mkString), ran.exitCode], {
      concurrency: 2,
    });
    return { code: Number(code), out };
  }).pipe(
    Effect.scoped,
    Effect.catch(() => Effect.succeed({ code: 127, out: "" })),
    Effect.provide(nodeServices),
  );

/** A step that ended stuck before any agent started: the same shape an agent's own stuck answer has. */
const stuckBefore = (reason: string): Turned<Answer> => ({
  ...Ended.make({ stop: "end_turn", spent: NO_SPENT, said: reason }),
  answer: Answer.make({ verb: "stuck", to: null, reason, laws: null }),
});

/**
 * The mutation step's draft. mutbox.ts runs first; its exit 30, a stuck line, no line at all or a
 * report that cannot be read ends the step stuck with mutbox's own reason, and no agent starts.
 * Otherwise the agent gets the prompt file, `mutboxTail` and the report's text.
 */
export const mutationDraft =
  (mutbox: MutboxRun): DraftRun =>
  (env, agents, ask) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stop = (reason: string) =>
        fs.writeFileString(ask.report, `${reason}\n`).pipe(Effect.ignore, Effect.as(stuckBefore(reason)));
      const prompt = yield* fs.readFileString(ask.prompt).pipe(Effect.orElseSucceed(() => ""));
      const related = relatedIn(prompt);

      if (related === undefined) {
        return yield* stop("mutbox: the brief names no related tests on a RELATED=<paths> line");
      }

      const ran = yield* mutbox(mutboxArgs(env, ask, related));
      const answer = mutboxAnswer(ran.out);

      if (ran.code === 30 || answer.outcome === "stuck") {
        return yield* stop(`mutbox: ${answer.outcome === "stuck" ? answer.reason : "exit 30"}`);
      }

      const report = join(env.BOXES, `${ask.box}-mutbox`, "mutbox.json");
      const text = yield* fs.readFileString(report).pipe(Effect.orElseSucceed(() => ""));

      if (text.trim() === "") {
        return yield* stop(`mutbox: no report at ${report}`);
      }

      // The prompt file is the record of what the agent was asked, so it gets the report too.
      const whole = `${prompt}${mutboxTail(report, answer.outcome === "skip")}\n${text}`;
      yield* fs.writeFileString(ask.prompt, whole).pipe(Effect.ignore);
      return yield* turn(env, agents, ask, whole);
    }).pipe(Effect.provide(nodeServices));

/**
 * The Draft, as a Sub that answers once. The prompt file is the brief with drive's tail; the
 * system prompt names the step.
 */
export const agentsDraft =
  (env: Env, agents: Agents, mutbox: MutboxRun = runMutbox) =>
  (sub: DraftSub) =>
    Stream.fromEffect(
      (sub.deps.step === "mutation" ? mutationDraft(mutbox) : turnDraft)(env, agents, sub.deps).pipe(
        Effect.map((turned) => ({ type: "drafted", turned }) satisfies Drafted),
      ),
    );

type Lane = {
  readonly lane: string;
  readonly ticket?: string;
  readonly plan?: string;
  readonly branch?: string;
  readonly root?: string;
  readonly head?: string;
  readonly steps: readonly { readonly step: string; readonly report?: string | null }[];
};

// ---------------------------------------------------------------- the command

const TAIL = `

---
drive.ts reads your report, then one JSON object at its very end (its schema follows this prompt):
  verb: done | send | ask | skip | stuck
  to:   tests | build | plan when the verb is send, else null
  reason: one or two sentences: what to tell the next step, the one question for the lead, why there is
        nothing here for this step, or why you are stuck
  laws: for a build that needed no change, because every law is already green at its start, the
        narrow test paths you ran; else null
`;

const MIN_FREE_GB = 20;

/** Whole GB free on the volume that holds `path`, from `df -k`; `null` when df says nothing usable. */
const freeGb = (path: string): number | null => {
  const r = sh("df", ["-k", path]);
  const kb = Number(r.out.trim().split("\n").at(-1)?.trim().split(/\s+/)[3]);
  return r.code === 0 && Number.isFinite(kb) ? Math.floor(kb / 1024 / 1024) : null;
};

/**
 * The worktree that has `branch` checked out, from `git worktree list --porcelain`; `null` when none.
 * The fetch at the end of a step updates `refs/heads/<branch>`, which git refuses while a worktree
 * holds it, so a step that started anyway would lose its fetch after the agent's whole run.
 */
const holderOf = (porcelain: string, branch: string): string | null => {
  for (const block of porcelain.split("\n\n")) {
    const lines = block.split("\n");

    if (lines.includes(`branch refs/heads/${branch}`)) {
      return lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length) ?? "";
    }
  }

  return null;
};

/**
 * The live process holding the one Docker box's lock (mutbox.ts writes its pid there), or `null`
 * when the lock is absent, unreadable or left by a dead run, which mutbox.ts itself takes over. A
 * mutation step started while another box ran got mutbox's docker_busy only after its box was made,
 * as a stuck step (layout-mutation3, 2026-11-10; ticket 566).
 */
export const dockerHolder = (lock: string | null, alive: (pid: number) => boolean): number | null => {
  const pid = Number(lock?.trim());
  return lock !== null && Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : null;
};

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists and is someone else's.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * Whether drive holds `BOXES/state/electron.lock` for the whole step. The box cannot write the
 * lock (its sandbox writes only the box and caches), so drive takes it outside, before the agent
 * starts: always for mutation, and for any Claude step started with `--electron`.
 */
export const holdsElectron = (step: StepName, flagged: boolean) => step === "mutation" || flagged;

const usage = () => {
  console.error(
    "usage: node drive.ts <lane> <plan|tests|build|mutation|review> <brief-file> [--agent codex|claude] [--model sonnet|opus] [--electron] [--from <ref>] [--ticket <n>] [--branch fabrikalfa/<name>] [--plan <approved plan>] [--plan-only]",
  );
  process.exit(2);
};

const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Takes the lock file for this pid; `false` when another process holds it. */
const lockTaken = (lock: string): boolean => {
  try {
    writeFileSync(lock, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
};

/** One Electron step at a time: a lock file holding the owner's pid, taken over when it is dead. */
const takeElectron = (env: Env) =>
  Effect.gen(function* () {
    const lock = join(env.BOXES, "state", "electron.lock");

    for (;;) {
      if (lockTaken(lock)) {
        process.on("exit", () => rmSync(lock, { force: true }));
        return;
      }

      const owner = Number(readFileSync(lock, "utf8").trim());

      if (alive(owner)) {
        yield* Effect.sleep("20 seconds");
      } else {
        rmSync(lock, { force: true });
      }
    }
  });

/** What one step is asked for, as the command line or the chain gives it. */
export interface StepArgs {
  readonly lane: string;
  readonly step: StepName;
  readonly brief: string;
  readonly agent: AgentName;
  /** Claude's model; a Codex box runs env.sh's CODEX_MODEL. */
  readonly model?: string | undefined;
  readonly electron: boolean;
  readonly ticket?: string | undefined;
  readonly branch?: string | undefined;
  readonly plan?: string | undefined;
  readonly from?: string | undefined;
}

/**
 * How `prepare` ended: the step ready to run, or a no before any agent ran, a usage error (exit 2)
 * or a start check's refusal (exit 3).
 */
export const Start = Schema.TaggedUnion({
  prepared: { ask: Ask, electron: Schema.Boolean },
  refused: { outcome: Schema.String, reason: Schema.String, exit: Schema.Number },
});

export type Prepared = typeof Start.cases.prepared.Type;
export type Refusal = typeof Start.cases.refused.Type;
const refusal = Start.cases.refused.make;

const usageError = (reason: string): Refusal => refusal({ outcome: "usage", reason, exit: 2 });

/**
 * Everything before the agent: the usage checks, the base and the lane's root, a fresh box name,
 * the agent cap, the disk, the lane's branch not held by a worktree, and the prompt file. Pure
 * reads of the main checkout and the laptop; nothing it does needs undoing.
 */
export const prepare = (env: Env, p: StepArgs): Prepared | Refusal => {
  const { lane, step, agent, electron } = p;

  if (!/^[a-z0-9][a-z0-9-]*$/.test(lane) || !existsSync(p.brief)) {
    return usageError("a lane name and a brief file are required");
  }

  if (step === "mutation" && agent !== MUTATION_AGENT) {
    return usageError(`a mutation step's agent may start Electron; run it with --agent ${MUTATION_AGENT}`);
  }

  if (step === "mutation" && relatedIn(readFileSync(p.brief, "utf8")) === undefined) {
    return usageError(
      "a mutation step needs its related tests: a line RELATED=<paths> in the brief (its Stryker run goes in a container, decision 0045)",
    );
  }

  if (electron && agent !== "claude") {
    return usageError("--electron is for --agent claude; a Codex box cannot start Electron");
  }

  if (agent === "codex" && p.model !== undefined) {
    return usageError("--model is for --agent claude; a Codex box reads CODEX_MODEL");
  }

  mkdirSync(join(env.BOXES, "state"), { recursive: true });
  const statePath = join(env.BOXES, "state", `${lane}.json`);
  const saved: Lane | null = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf8")) as Lane) : null;
  const ticket = p.ticket ?? saved?.ticket;

  if (!ticket) {
    return usageError(`no ticket for lane ${lane} yet; pass --ticket`);
  }

  const branch = p.branch ?? saved?.branch ?? `fabrikalfa/${lane}`;
  const plan = p.plan ?? saved?.plan ?? join(env.BOXES, `${lane}-PLAN.md`);

  if (!branch.startsWith("fabrikalfa/")) {
    return usageError("the branch is fabrikalfa/<name>");
  }

  sh("git", ["-C", env.MAIN, "fetch", "-q", "origin"]);

  // A plan writer reads the main checkout as it stands, so its base is that checkout's HEAD.
  if (step === "plan" && p.from !== undefined) {
    return usageError("a plan reads the main checkout; it takes no --from");
  }

  // With no --from, a lane whose branch or -wip backup is on origin continues from the newest
  // tip, unless the saved head has moved past it (`startHead`). A box started at main on a
  // branch that has work drops that work (2026-11-09), so a saved head off the branch loses.
  const pushed = [branch, wipOf(branch)]
    .map((ref) =>
      sh("git", ["-C", env.MAIN, "rev-parse", "-q", "--verify", `refs/remotes/origin/${ref}^{commit}`]).out.trim(),
    )
    .filter(Boolean);
  const isAncestor = (a: string, b: string) =>
    sh("git", ["-C", env.MAIN, "merge-base", "--is-ancestor", a, b]).code === 0;
  const lastHead = startHead(pushed, saved?.head, isAncestor);
  const from = step === "plan" ? "HEAD" : (p.from ?? lastHead ?? "origin/main");
  const base = sh("git", ["-C", env.MAIN, "rev-parse", "-q", "--verify", `${from}^{commit}`]).out.trim();

  if (!base) {
    return usageError(`${from} is not a commit in the main checkout`);
  }

  // The lane's root: where its base left main, moved up past a caught-up main (lane.ts).
  const root = laneRoot(
    saved?.root,
    sh("git", ["-C", env.MAIN, "merge-base", "origin/main", base]).out.trim(),
    base,
    isAncestor,
  );

  if (!root) {
    return usageError(`${base.slice(0, 8)} shares no history with origin/main`);
  }

  const box = freshBox(lane, step, (saved?.steps.filter((e) => e.step === step).length ?? 0) + 1, (name) =>
    existsSync(join(env.BOXES, name)),
  );
  const n = Number(box.slice(`${lane}-${step}`.length));
  const at = (suffix: string) => join(env.BOXES, `${box}${suffix}`);
  const claude = agent === "claude";
  const ask: Ask = {
    lane,
    step,
    agent,
    model: claude ? (p.model ?? "sonnet") : env.CODEX_MODEL,
    effort: claude ? null : env.CODEX_EFFORT,
    ticket,
    plan,
    branch,
    base,
    root,
    box,
    run: `t${ticket}-${step}${n === 1 ? "" : n}`,
    prompt: at("-prompt.md"),
    report: step === "plan" ? at("-plan.md") : at(".md"),
    events: step === "plan" ? at("-plan.jsonl") : at(".jsonl"),
    err: at(".err"),
    minutes: Number(process.env.DRIVE_MINUTES ?? 60),
    started: Date.now(),
  };
  // The agents running now: the ACP harnesses drive starts (and a Codex exec a hand started).
  const count = (pattern: string) => sh("pgrep", ["-f", pattern]).out.split("\n").filter(Boolean).length;
  const agents = count("codex-acp/dist/index.js") + count("claude-agent-acp/dist/index.js") + count("^codex exec");

  if (agents >= 8) {
    return refusal({
      outcome: endName({ kind: "refused", check: "agent_cap" }),
      reason: `${agents} agents running (the ACP harnesses drive started); the cap is 8`,
      exit: 3,
    });
  }

  // Dead boxes filled the disk once (2026-11-09): sweep them, then refuse on a nearly full disk,
  // naming what gc kept and why, so the lead fixes the cause and never asks the owner for space.
  const gc = spawnSync("sh", [join(HERE, "box.sh"), "gc"], {
    stdio: ["ignore", "pipe", 2],
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  process.stderr.write(gc.stdout ?? "");
  const free = freeGb(env.BOXES);

  if (free === null || free < MIN_FREE_GB) {
    const said = free === null ? "df could not read the free space" : `${free} GB free`;
    const keeps = (gc.stdout ?? "").split("\n").filter((l) => l.startsWith("keep "));
    return refusal({
      outcome: endName({ kind: "refused", check: "low_disk" }),
      reason: `${said} on the boxes' volume after box.sh gc; drive needs ${MIN_FREE_GB}; gc kept ${keeps.length}: ${keeps.map((l) => l.slice(5)).join("; ") || "nothing"}`,
      exit: 3,
    });
  }

  // A plan reads the main checkout and a review changes nothing; every other step moves the
  // lane's branch at the end. Refuse now, not after the agent ran (themes tests, 2026-11-09).
  if (step !== "plan" && step !== "review") {
    const list = sh("git", ["-C", env.MAIN, "worktree", "list", "--porcelain"]);
    const holder = list.code === 0 ? holderOf(list.out, branch) : "";

    if (holder !== null) {
      return list.code === 0
        ? refusal({
            outcome: endName({ kind: "refused", check: "branch_checked_out" }),
            reason: `${branch} is checked out in ${holder}; detach it there (git switch --detach) first`,
            exit: 3,
          })
        : refusal({
            outcome: "stuck:worktree_unreadable",
            reason: `git worktree list failed: ${tail(list.err)}`,
            exit: 30,
          });
    }
  }

  // One Docker box at a time (0012): a mutation step's Stryker run needs it, so a box held by
  // another run is a start check's no, before box.sh new, never a stuck step.
  if (step === "mutation") {
    const lock = dockerLock(env);
    const holder = dockerHolder(existsSync(lock) ? readFileSync(lock, "utf8") : null, isAlive);

    if (holder !== null) {
      return refusal({
        outcome: endName({ kind: "refused", check: "docker_busy" }),
        reason: `another Docker box is running (pid ${holder}); one at a time`,
        exit: 3,
      });
    }
  }

  const verdict =
    step === "review"
      ? "Keep your verdict line, merge-ready or changes: <n>, as the report's first line.\nThe verdict is not the answer. The last line is `answer: done <why>` when merge-ready, else `answer: send build <why>`, `send tests` or `send plan`. Never `answer: merge-ready`.\n"
      : "";
  writeFileSync(
    ask.prompt,
    readFileSync(p.brief, "utf8") +
      planTail(step, plan, existsSync(plan) ? readFileSync(plan, "utf8") : null) +
      mutationTail(step, saved?.steps ?? [], (path) => (existsSync(path) ? readFileSync(path, "utf8") : null)) +
      agentTail(ask, electron) +
      TAIL +
      verdict,
  );
  return Start.cases.prepared.make({ ask, electron });
};

/** drive's one line: how the step ended, as the chain and a reader of the log take it. */
export interface DriveLine {
  readonly outcome: string;
  readonly lane: string;
  readonly step: StepName;
  readonly agent: AgentName;
  readonly box: string;
  readonly from: string;
  readonly head: string;
  readonly reason: string;
  readonly report: string | null;
  readonly kept: boolean;
  readonly exit: number;
  readonly model: string;
}

/**
 * Run one prepared step to its end: the Electron lock and the one-typecheck wait, then the
 * machine, its Cmds in the main checkout and its one agent turn in the box. Never throws: a
 * crash is a `stuck:crash` line, with the box kept.
 */
export const driveStep = (env: Env, agents: Agents, p: Prepared): Effect.Effect<DriveLine> => {
  const { ask } = p;
  const lock = join(env.BOXES, "state", "electron.lock");
  const program = Effect.gen(function* () {
    if (holdsElectron(ask.step, p.electron)) {
      yield* takeElectron(env);
    }

    // One typecheck at a time across all agents: a step that typechecks waits for a free tsgo.
    if (ask.step === "tests" || ask.step === "build" || ask.step === "mutation") {
      while (sh("pgrep", ["-x", "tsgo"]).code === 0) {
        yield* Effect.sleep("20 seconds");
      }
    }

    const handle = yield* run(machine, {
      ctx: undefined,
      interpret: handlers(env),
      subscribe: { draft: agentsDraft(env, agents) },
      terminal: (m) => m.phase === "over",
    });
    const runtime = yield* handle.ready;
    yield* runtime.dispatch({ type: "start", ask });
    const end = yield* runtime.done();

    if (end.phase !== "over") {
      return yield* Effect.die(`drive stopped in ${end.phase}`);
    }

    return {
      outcome: endName(end.outcome),
      lane: ask.lane,
      step: ask.step,
      agent: ask.agent,
      box: ask.box,
      from: ask.base,
      head: end.head,
      reason: end.reason,
      report: writtenReport(ask),
      kept: end.kept,
      exit: exitOf(end.outcome),
      model: ask.model,
    } satisfies DriveLine;
  }).pipe(
    Effect.scoped,
    Effect.ensuring(
      Effect.sync(() => {
        if (holdsElectron(ask.step, p.electron)) {
          rmSync(lock, { force: true });
        }
      }),
    ),
  );
  return program.pipe(
    Effect.catchCause((cause) =>
      Effect.succeed({
        outcome: "stuck:crash",
        lane: ask.lane,
        step: ask.step,
        agent: ask.agent,
        box: ask.box,
        from: ask.base,
        head: ask.base,
        reason: Cause.pretty(cause),
        report: writtenReport(ask),
        kept: true,
        exit: 30,
        model: ask.model,
      } satisfies DriveLine),
    ),
  );
};

const main = () => {
  const args = process.argv.slice(2);
  const [lane = "", step = "", brief = ""] = args;
  const agent = flag(args, "--agent") ?? "codex";

  if (
    !(STEPS as readonly string[]).includes(step) ||
    !(AGENTS as readonly string[]).includes(agent) ||
    !existsSync(brief)
  ) {
    usage();
  }

  const env = loadEnv();
  const prepared = prepare(env, {
    lane,
    step: step as StepName,
    brief,
    agent: agent as AgentName,
    model: flag(args, "--model"),
    electron: args.includes("--electron"),
    ticket: flag(args, "--ticket"),
    branch: flag(args, "--branch"),
    plan: flag(args, "--plan"),
    from: flag(args, "--from"),
  });

  if (prepared._tag === "refused") {
    if (prepared.exit === 2) {
      console.error(`drive.ts: ${prepared.reason}`);
      process.exit(2);
    }

    console.log(JSON.stringify({ outcome: prepared.outcome, reason: prepared.reason }));
    process.exit(prepared.exit);
  }

  if (args.includes("--plan-only")) {
    console.log(
      JSON.stringify({
        outcome: "plan-only",
        ...prepared.ask,
        electron: holdsElectron(prepared.ask.step, prepared.electron),
      }),
    );
    return;
  }

  const program = Effect.gen(function* () {
    const agents = yield* makeStepAgents(join(env.BOXES, "state", "sessions"));
    const line = yield* driveStep(env, agents, prepared);
    console.log(JSON.stringify(line));
    process.exitCode = line.exit;
  }).pipe(
    // A crash is still one JSON line, and the box is kept for the lead to read.
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        console.log(
          JSON.stringify({
            outcome: "stuck:crash",
            lane,
            step,
            box: prepared.ask.box,
            reason: Cause.pretty(cause),
            kept: true,
            exit: 30,
          }),
        );
        process.exitCode = 30;
      }),
    ),
  );
  NodeRuntime.runMain(program);
};

if (import.meta.main) {
  main();
}
