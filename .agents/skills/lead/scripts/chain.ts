// chain.ts: run one lane's steps end to end in plain code, with no lead agent holding it. Today's
// lead tooling, run on our own laptop; it is not product. Run it in the background and read the
// last line only: one JSON object with how the lane ended.
//
//   node chain.ts <lane> <lane-brief.md> [--ticket <n>] [--branch fabrikalfa/<name>]
//                 [--plan <approved plan>] [--claude tests,build] [--electron tests,build]
//                 [--codex-exec tests,build,review] [--model sonnet|opus]
//                 [--start tests|build|mutation|review]
//
// `--codex-exec` names the steps whose Codex runs as the installed `codex exec`, plainly, on the
// user's own Codex config (./codexexec.ts), in place of Codex through ACP. `--claude` wins a step
// both name. The judgment agent stays on the ACP row.
//
// The lane is a tea machine on the Effect engine. Each step runs drive.ts's pieces in this
// process (`prepare`, then `driveStep`: one box, one agent turn, the reads, the push, the row),
// and the machine reads the step's one line to pick the next move. Every agent, a step's and the
// judgment's, runs through today's fabrika agents package on its ACP rows (./agents.ts): the
// unmodified harness, in its own containment, with only its model login. A fresh, short
// read-only Codex agent is started only where judgment is needed: a step that asked a question or got stuck. It
// reads the lane's state file and the report, answers once, and is gone. The five verbs stay:
// done, send, ask, skip, stuck.
//
//   stepping   Act     drive's prepare and driveStep, the brief cut from the lane brief's section
//                      plus the lane's facts (heads, round, what the last step said)
//   hosting    Act     the host step (./flow/host.ts) before a review of a head it has not run at:
//                      the brief's `## host` commands on the laptop, outside any box; a fail sends
//                      the lane to build with the command's last lines, no section is a skip
//   judging    Draft   one read-only Codex turn in the main checkout, one typed answer: send a step
//                      again with a note, or park the lane for the lead
//   opening    Act     botpush the branch and open the pull request (or find the open one)
//   typechecking Listen CI's `typecheck` job at the pushed head, polled until that one job ends
//                      (./ci/typecheck.ts; no laptop typecheck, 0133): red sends the lane back with
//                      the error lines from the job's log, to tests when every error is in an exam
//                      path, else to build, counted as a send back (0076), and the PR stays open
//                      for the next push; no answer in time, or no type error in a failed job,
//                      goes on, and the last line says why
//   loosening  Check   loosening.sh on the lane's exam diff, its output posted on the PR (0014):
//                      0 hits goes on, any hit parks for the lead's hand check, an error is stuck
//   landing    Act     ./pr/Queue.ts: the leak checks on the change, each commit and the PR's title
//                      and description, a wait for `ci-required` at the head within
//                      `CHAIN_QUEUE_MINUTES` (60), then one squash pinned to that head, which adds
//                      the PR to GitHub's merge queue (0162). GitHub tests it on newest main and
//                      merges it later; the chain never merges main in and never waits for the merge
//   over               done (queued), ask (parked for the lead, the why in `reason`) or stuck
//
// The moves, pure (`moveOf`): tests done -> build -> (host) -> review -> open -> (CI's typecheck)
// -> loosen -> queue. Every
// review runs at a head the host step ran at: a review whose head it has not seen runs it first,
// and that round counts against `MaxSteps`. A lane runs no
// mutation step: mutation runs hourly against main instead (.decisions/0066). `--start mutation`
// stays for a lane parked inside its mutation step before 0066: it runs that one step, then goes on
// to review, so nothing in flight is stranded. No move ever names mutation: a send to it, or to
// plan, parks (only the lead approves a plan). A send goes to the lane step it names. A lockfile ask
// parks too: the lead refreshes it outside the box. Any other ask, and any stuck, goes to the
// judgment agent. A start refusal for a full laptop (agent_cap, low_disk) is retried on one named
// Effect Schedule (`slotSchedule`); any other refusal parks. Every limit is a Context.Reference with
// an overridable default (the defaults: a step retried every 5 minutes, 6 times; 3 stucks in a row
// on one step; 16 steps a lane with no backstop; 20 minutes a host command), and
// `CHAIN_WAIT_MINUTES`, `CHAIN_WAITS`, `CHAIN_STUCKS`, `CHAIN_STEPS`, `CHAIN_HOST_MINUTES` and
// `CHAIN_TYPECHECK_MINUTES` (20, the wait for CI's typecheck job) and `CHAIN_TYPECHECK_EVERY` (10
// seconds between reads of it) and `CHAIN_QUEUE_MINUTES` (60, the wait for `ci-required` before the
// queue) override them from outside. Running out of retries is a typed
// `RetriesExhausted`, reported as stuck (decided with the clanka walk, 2026-11-09). Exit codes: 0
// queued, 20 parked (ask), 30 stuck, 2 usage. The lead runs `land.ts merged <pr>` later, which
// closes the PR's tickets and starts the box cleanup once GitHub has merged it.
//
// The lane's budget (.decisions/0076). Every stuck step carries its fault, `tool` or `work`
// (drive's `faultFrom`). The machine keeps the marks of the lane's last 5 steps; when 3 of them were
// sent back or stuck on the work, it stops with an ask that holds the counts: redo, cut scope or
// drop. A tool stuck is marked and never counted. The backstop is twice the estimate a line such
// as `Estimate: 12 steps, $15` gives in the approved plan, else in the lane brief; at its steps or
// its dollars the chain stops the same way, before the next step or judgment. With no estimate, one
// printed line says so and `MaxSteps` holds. `CHAIN_INTENSITY`, `CHAIN_WITHIN` and `CHAIN_BACKSTOP`
// override the 3, the 5 and the 2. The stop, its rule and what was spent, goes in the chain record.
// A host step is a step here too: its round counts toward the backstop and `MaxSteps`, and its
// mark joins the window (a send to build is a send back; a stuck is a tool stuck, never counted).
// No agent sees these numbers. The window counts this process's steps: a lane started again after
// a person's answer starts a fresh window. The tool budget shared by all lanes is not built here.
//
// Each step's record is a Schema value (`StepRecord`) written to `state/<lane>-chain.json` before
// the step starts and again when it ends, so a resume (`--start <step>`) needs nothing in memory.
// While the lane runs, the record also holds its heartbeat (./flow/Beat.ts, ticket 685): the phase
// the chain is in, since when, and when an agent last wrote, written on each phase change and every
// 30 seconds, so a status page tells a lane at work from one blocked in a hung call.
// A lane keeps one version of its scripts from start to end (./pin.ts, ticket 835): started from a
// checkout, chain.ts copies `.agents/` at the main checkout's commit into `BOXES/pins/<lane>.<pid>`,
// runs itself again from there, and removes the copy when that process ends. The record's
// `scripts` names the commit; a restart pins again and prints the commit its last process ran on.
// The lane's pull request is a draft from its first commit (0134): drive's pushing phase pushes each
// step's commit to the branch and opens the draft when the branch has none (./pr/Publish.ts). The
// `opening` phase pushes the reviewed head, gives the pull request the brief's `## pr` words and
// marks it ready (`Publish.ready`), through the typed PullRequests service.
// The chain holds every right (the bot's push, the PR, the merge queue, the commit and its signature); a
// box or the judgment agent holds only its model login
// (.decisions/0028-the-parent-holds-every-right.md). The steps run the unmodified harness
// (.decisions/0026-fabrika-never-owns-the-agent-loop.md).
//
// The lane brief is one Markdown file. Its text before the first `## ` heading goes to every step.
// Then one section per step, `## tests`, `## build`, `## review`, and `## pr`, the pull request's
// description (its first line is the title). An optional `## host` names the host step's commands
// in a fenced block, one per line; a `## host` that names none is a usage error. An older brief's `## mutation` is accepted and not run,
// unless the lane starts at mutation, which needs it. drive appends its own answer tail.
//
// What it writes, all under BOXES: each step's brief as `<lane>-chain<round>-<step>-brief.md`, one
// `chain:` line per move in `state/<lane>.md`, and the judgment turn's field row in
// `<lane>-rows.jsonl`, beside the steps' rows. The pull request's description ends with a table of
// the steps and their list-price dollars. loosening.sh runs from the lane's merge-base with
// origin/main to the reviewed head and is given no mapping table, so a renamed law is a hit too; a
// loosening comment that does not post is stuck.

// The chain's record, logs and brief are sync file calls: a debt agents-ledger.json named for this
// import until three names left it and its line changed. The ledger only shrinks, so it is marked here.
// oxlint-disable-next-line fabrika/no-node-imports, fabrika/no-node-filesystem -- edge: sync file calls not yet moved to Effect's FileSystem (0033)
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineMachine } from "@demlik/tea";
import { Cmd, run } from "@demlik/tea/effect";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Context, Duration, Effect, Layer, Result, Schedule, Schema } from "effect";
import { type Agents, Judgment, listUsd, makeStepAgents, runTurn, stepRow } from "./agents.ts";
import * as ChecksGh from "./ci/ChecksGh.ts";
import * as Typecheck from "./ci/typecheck.ts";
import {
  type AgentName,
  type DrivePhase,
  driveStep,
  type Env,
  FAULTS,
  type Fault,
  faultFrom,
  freeLane,
  holdLane,
  laneRunning,
  loadEnv,
  MUTATION_AGENT,
  prepare,
  runNames,
  sh,
} from "./drive.ts";
import * as Beat from "./flow/Beat.ts";
import * as Host from "./flow/host.ts";
import * as Outcome from "./flow/Outcome.ts";
import { pinFolder, stepOf, wipOf } from "./lane.ts";
import * as Pin from "./pin.ts";
import * as Plants from "./plants.ts";
import * as Publish from "./pr/Publish.ts";
import * as PullRequestsGh from "./pr/PullRequestsGh.ts";
import * as PushesProcess from "./pr/PushesProcess.ts";
import * as Queue from "./pr/Queue.ts";
import * as RunId from "./runid.ts";

const HERE = import.meta.dirname;
/** Every step the chain can start at: the lane's steps, and mutation for a lane parked inside it. */
export const STEPS = ["tests", "build", "mutation", "review"] as const;
export type StepName = (typeof STEPS)[number];
const isStep = (s: string): s is StepName => (STEPS as readonly string[]).includes(s);
/** A lane's name, as its state files and its pin folder carry it. */
const LANE_NAME = /^[a-z0-9][a-z0-9-]*$/;
/** A lane's steps, in order (0066). A move names only these, so no move reaches mutation. */
export const LANE_STEPS = ["tests", "build", "review"] as const;
export type LaneStep = (typeof LANE_STEPS)[number];
const isLaneStep = (s: string): s is LaneStep => (LANE_STEPS as readonly string[]).includes(s);

// ---------------------------------------------------------------- the limits

/** Minutes between two tries of a step drive refused for a full laptop. */
export const WaitMinutes = Context.Reference<number>("chain/WaitMinutes", { defaultValue: () => 5 });
/** How many times such a step is tried again before `RetriesExhausted`. */
export const MaxWaits = Context.Reference<number>("chain/MaxWaits", { defaultValue: () => 6 });
/** Stucks in a row on one step before the lane parks without asking. */
export const MaxStucks = Context.Reference<number>("chain/MaxStucks", { defaultValue: () => 3 });
/** Steps a lane may run before it parks, when its plan and brief give no estimate for a backstop. */
export const MaxSteps = Context.Reference<number>("chain/MaxSteps", { defaultValue: () => 16 });
/** The lane's intensity (0076): this many sends or work stucks... */
export const IntensityCount = Context.Reference<number>("chain/IntensityCount", { defaultValue: () => 3 });
/** ...within this many of its last steps stop the chain and ask a person. */
export const IntensityWithin = Context.Reference<number>("chain/IntensityWithin", { defaultValue: () => 5 });
/** The backstop is this many times the estimate the plan or the lane brief gives (0076). */
export const BackstopTimes = Context.Reference<number>("chain/BackstopTimes", { defaultValue: () => 2 });
/** Minutes each host command may run (./flow/host.ts says where the default comes from). */
export const HostMinutes = Context.Reference<number>("chain/HostMinutes", { defaultValue: () => Host.MINUTES });

/** Minutes the lane waits for CI's typecheck job at its pushed head to end (./ci/typecheck.ts). */
export const TypecheckMinutes = Context.Reference<number>("chain/TypecheckMinutes", {
  defaultValue: () => Typecheck.MINUTES,
});

/** Seconds between two reads of that job while it runs (./ci/typecheck.ts says why this many). */
export const TypecheckEvery = Context.Reference<number>("chain/TypecheckEvery", {
  defaultValue: () => Typecheck.EVERY,
});

/** Minutes the lane waits for `ci-required` at its head to end before it asks for the merge queue. */
export const QueueMinutes = Context.Reference<number>("chain/QueueMinutes", {
  defaultValue: () => Queue.LANE_WAIT.minutes,
});

/** The one schedule for a step drive refused for a slot: every `minutes`, `times` times. */
export const slotSchedule = (minutes: number) => Schedule.spaced(Duration.minutes(minutes));

/** drive refused the step for a full laptop (agent_cap or low_disk); retried on `slotSchedule`. */
export class SlotRefused extends Schema.TaggedError<SlotRefused>()("SlotRefused", {
  check: Schema.String,
  reason: Schema.String,
}) {}

/** A named schedule ran out; the lane reports it as stuck. */
export class RetriesExhausted extends Schema.TaggedError<RetriesExhausted>()("RetriesExhausted", {
  schedule: Schema.String,
  times: Schema.Number,
  reason: Schema.String,
}) {}

/** Whether a drive outcome is a slot refusal, the one kind the schedule retries. */
export const slotRefusal = (outcome: string): string | null => {
  const [verb, check = ""] = outcome.split(":");
  return verb === "refused" && (check === "agent_cap" || check === "low_disk") ? check : null;
};

// ---------------------------------------------------------------- what drive said

/** drive.ts's last line, the fields the chain reads. */
export type Line = {
  readonly outcome: string;
  readonly head: string;
  readonly reason: string;
  /** A stuck step's fault, `tool` or `work` (0076); `null` for any other outcome. */
  readonly fault: Fault | null;
  readonly report: string | null;
  readonly box: string;
  readonly exit: number;
  /** The step's list-price dollars, `null` when none were priced. */
  readonly listUsd: number | null;
};

const str = (v: unknown, or = ""): string => (typeof v === "string" ? v : or);
const FaultS = Schema.Literals(FAULTS);
const isFault = Schema.is(FaultS);

/** The last JSON line of drive's output, read loosely; `null` when there is none. */
export const lineOf = (out: string, exit: number): Line | null => {
  for (const raw of out.trim().split("\n").toReversed()) {
    const parsed = Result.try((): unknown => JSON.parse(raw));

    if (Result.isFailure(parsed)) {
      continue;
    }

    const d = parsed.success;

    if (d === null || typeof d !== "object" || !("outcome" in d)) {
      continue;
    }

    const o = d as Record<string, unknown>;
    const outcome = str(o.outcome);
    const reason = str(o.reason);
    return {
      outcome,
      head: str(o.head),
      reason,
      fault: isFault(o.fault) ? o.fault : faultFrom(outcome, reason),
      report: typeof o.report === "string" ? o.report : null,
      box: str(o.box),
      exit: typeof o.exit === "number" ? o.exit : exit,
      listUsd: typeof o.listUsd === "number" ? o.listUsd : null,
    };
  }

  return null;
};

// ---------------------------------------------------------------- the moves

/** The next move after a step's outcome, as data. */
export const Move = Schema.TaggedUnion({
  step: { step: Schema.Literals(LANE_STEPS), note: Schema.String },
  judge: {},
  open: {},
  park: { reason: Schema.String },
});
export type Move = typeof Move.Type;
const toStep = (step: LaneStep, note: string) => Move.cases.step.make({ step, note });
const toPark = (reason: string) => Move.cases.park.make({ reason });
const toJudge = Move.cases.judge.make({});
const toOpen = Move.cases.open.make({});

/**
 * The step a done answer hands to, or `null` at the end of the chain. Build hands to review (0066);
 * a mutation step, run only by `--start mutation`, hands to review too.
 */
const after: Record<StepName, LaneStep | null> = {
  tests: "build",
  build: "review",
  mutation: "review",
  review: null,
};

/**
 * The Check, pure: what drive's outcome means for the lane. `stucks` counts stucks in a row on
 * this step, against the `MaxStucks` limit. A slot refusal never reaches here: the step's Cmd
 * retries it on `slotSchedule`, and running out is a `RetriesExhausted` on the err channel.
 */
export const moveOf = (step: StepName, line: Line, stucks: number, maxStucks: number): Move => {
  const [verb, to = "", reason = ""] = line.outcome.split(":");

  switch (verb) {
    case "done":
    case "skip": {
      // A skip is nothing here for this step: on to the next, with the why on record.
      const next = after[step];
      return next === null ? toOpen : toStep(next, "");
    }
    case "send":
      if (isLaneStep(to)) {
        // A step that sends the lane to itself is not done and not a send: another round of it
        // only loops (2026-11-11), so judgment reads why, and sends it on or parks it.
        return to === step ? toJudge : toStep(to, `${step} answered ${line.outcome}: ${line.reason}`);
      }

      // plan is the lead's to approve; mutation is no lane step since 0066, so neither runs here.
      return toPark(`${step} sent the lane to ${to}, which is not a lane step: ${line.reason}`);
    case "ask":
      if (reason === "lockfile") {
        return toPark(line.reason);
      }

      return toJudge;
    case "refused":
      return toPark(`drive refused: ${line.outcome}: ${line.reason}`);
    default:
      return stucks >= maxStucks ? toPark(`${step} stuck ${maxStucks} times in a row: ${line.reason}`) : toJudge;
  }
};

// An older answer may still name mutation; it reads as a send that names no lane step, so it parks.
const JUDGED = /^[`*\s]*answer:\s*(send\s+(tests|build|mutation|review)|park)\b[`*\s]*(.*)$/i;

/** A judgment: a step to run again with a note, or a park for the lead. */
export type Judged = typeof Move.cases.step.Type | typeof Move.cases.park.Type;

/** A typed judgment (./agents.ts) as a move; a send that names no step is a park. */
export const judgedMove = (j: Judgment): Judged =>
  j.answer === "send" && j.step !== null
    ? toStep(j.step, `the lead's judgment: ${j.note}`)
    : toPark(j.note || "the judgment agent parked the lane with no why");

/** The judge Cmd's answer: the move it chose as JSON, or, for an older text, its `answer:` line. */
export const moveFrom = (text: string): Judged => {
  // A text that is not such JSON, or reads as neither move, falls back to its `answer:` line.
  const move = Result.try((): Judged | undefined => {
    const d = JSON.parse(text) as Judged;

    if (d._tag === "step" && isLaneStep(d.step)) {
      return toStep(d.step, String(d.note ?? ""));
    }

    if (d._tag === "park") {
      return toPark(String(d.reason ?? ""));
    }

    return undefined;
  });
  return Result.getOrUndefined(move) ?? judgedOf(text);
};

/** What the judgment agent said on its last `answer:` line; none is a park. */
export const judgedOf = (text: string): Judged => {
  for (const line of text.split("\n").toReversed()) {
    const m = JUDGED.exec(line.trim());

    if (m === null) {
      continue;
    }

    const note = (m[3] ?? "").replace(/^[`*\s]+|[`*\s]+$/g, "");
    const to = m[2]?.toLowerCase() ?? "";

    if (isLaneStep(to)) {
      return toStep(to, `the lead's judgment: ${note}`);
    }

    return toPark(note || "the judgment agent parked the lane with no why");
  }

  return toPark("the judgment agent gave no answer line");
};

// ---------------------------------------------------------------- the brief

/** The lane brief, cut at its `## ` headings: the shared head and one body per section. */
export const sectionsOf = (text: string): { head: string; sections: Record<string, string> } => {
  const sections: Record<string, string> = {};
  let name: string | null = null;
  const head: string[] = [];
  const bodies: Record<string, string[]> = {};

  for (const line of text.split("\n")) {
    const m = /^## (\S+)\s*$/.exec(line);

    if (m) {
      name = (m[1] ?? "").toLowerCase();
      bodies[name] ??= [];
      continue;
    }

    if (name === null) {
      head.push(line);
    } else {
      bodies[name]?.push(line);
    }
  }

  for (const [k, v] of Object.entries(bodies)) {
    sections[k] = v.join("\n").trim();
  }

  return { head: head.join("\n").trim(), sections };
};

/**
 * The sections a lane brief lacks for a lane started at `start`: every lane step's and `pr`. A
 * `## mutation` is needed only to start at mutation; an older brief that has one is still accepted.
 */
export const lacks = (lane: ReturnType<typeof sectionsOf>, start: StepName): string[] =>
  [...LANE_STEPS, ...(start === "mutation" ? ["mutation"] : []), "pr"].filter((k) => !lane.sections[k]);

/** What one step is told about the lane: the brief's shared head, its section and the facts. */
export type Facts = {
  readonly ticket: string;
  readonly branch: string;
  readonly plan: string;
  readonly root: string;
  readonly head: string;
  readonly round: number;
  readonly heads: Partial<Record<StepName, string>>;
  /** Every commit on the lane since its root, oldest first, with the step its note names; `null`
   * when git could not list them. */
  readonly commits: ReadonlyArray<StepCommit> | null;
  readonly note: string;
  /** The last host step's outcome and head, for a review; `null` for any other step. */
  readonly host: string | null;
  /** The lane's plant records (./plants.ts), for a review; `null` for any other step or with none. */
  readonly plants: string | null;
};

/** One commit on the lane, and the step its `fabrika` note names (`unsigned` with none). */
export type StepCommit = { readonly step: string; readonly sha: string };

/**
 * What the lane has committed, by step, in short shas. Heads fill only on a done, so a step that
 * committed and then sent the lane on still shows here (2026-11-11: a lane read "No step has
 * committed yet." over three partial commits).
 */
export const committedLine = (commits: ReadonlyArray<StepCommit> | null): string => {
  if (commits === null) {
    return "The lane's step commits could not be read (git rev-list failed).";
  }

  if (commits.length === 0) {
    return "No step has committed yet.";
  }

  const steps = [...new Set(commits.map((c) => c.step))];
  const by = steps.map(
    (s) =>
      `${s} ${commits
        .filter((c) => c.step === s)
        .map((c) => c.sha.slice(0, 8))
        .join(" ")}`,
  );
  return `Step commits since the lane left main, oldest first: ${by.join("; ")}.`;
};

export const briefOf = (lane: ReturnType<typeof sectionsOf>, step: StepName, f: Facts): string => {
  const short = (s: string) => s.slice(0, 8);
  const heads = STEPS.filter((s) => f.heads[s]).map((s) => `${s} ${short(f.heads[s] ?? "")}`);
  const lines = [
    lane.head,
    "",
    lane.sections[step] ?? "",
    "",
    "---",
    `Lane facts, written by chain.ts, round ${f.round}: ticket ${f.ticket}, branch ${f.branch}, approved plan ${f.plan}.`,
    `This step starts at ${short(f.head)}; the lane left main at ${short(f.root)}.`,
    committedLine(f.commits),
    ...(heads.length > 0 ? [`Heads so far: ${heads.join(", ")}.`] : []),
    ...(f.note ? [`Last round: ${f.note}`] : []),
  ];

  if (step === "review") {
    lines.push(`Parent base: origin/main at ${f.root}`, `Reviewed head: ${wipOf(f.branch)} at ${f.head}`);
  }

  if (step === "review" && f.host !== null) {
    lines.push(
      `Host run, by chain.ts on the laptop outside any box (the brief's \`## host\` commands, e2e laws and shots): ${f.host}`,
    );
  }

  if (step === "review" && f.plants !== null) {
    lines.push("", f.plants);
  }

  // Only a lane started at mutation, parked inside that step before 0066, gets here.
  if (step === "mutation") {
    lines.push(
      `T=${f.ticket}, BUILD=${short(f.heads.build ?? f.head)} (the newest build commit; the mutation sampler diffs it against its parent).`,
    );
  }

  return `${lines.join("\n")}\n`;
};

// ---------------------------------------------------------------- the budget

/**
 * How one step ended, as the lane's intensity counts it (0076): `pass` (done, skip or ask), `send`
 * (sent back), `work` (stuck on the work) or `tool` (stuck on a tool, never counted against the lane).
 */
export const MARKS = ["pass", "send", "work", "tool"] as const;
export type Mark = (typeof MARKS)[number];

export const markFrom = (line: Line): Mark => {
  const [verb] = line.outcome.split(":");
  return verb === "send" ? "send" : verb === "stuck" ? (line.fault ?? "work") : "pass";
};

/** The marks the intensity counts against the lane: sends and work stucks. */
const counted = (window: readonly Mark[]) => ({
  sends: window.filter((m) => m === "send").length,
  work: window.filter((m) => m === "work").length,
});

/** A lane's size in steps and dollars: the estimate a plan or brief gives, or the backstop from it. */
const Budget = Schema.Struct({ steps: Schema.Number, dollars: Schema.Number });
export type Budget = typeof Budget.Type;

/**
 * The estimate in a plan or lane brief: the first line that says `estimate` and then `<n> steps`
 * and `$<d>`, as in `Estimate: 12 steps, $15`. An estimate in agent hours alone is none.
 */
export const estimateIn = (text: string): Budget | null => {
  for (const line of text.split("\n")) {
    const m = /\bestimate\b.*?\b(\d+)\s+steps?\b.*?\$\s?(\d+(?:\.\d+)?)/i.exec(line);
    const steps = Number(m?.[1]);
    const dollars = Number(m?.[2]);

    if (m !== null && steps > 0 && dollars > 0) {
      return { steps, dollars };
    }
  }

  return null;
};

/** The backstop: `times` the estimate, steps rounded up. */
export const backstopFrom = (estimate: Budget, times: number): Budget => ({
  steps: Math.ceil(estimate.steps * times),
  dollars: estimate.dollars * times,
});

/** Why the chain stopped to ask a person to redo, cut scope or drop (0076), kept in its record. */
export const Stop = Schema.TaggedUnion({
  intensity: {
    count: Schema.Number,
    within: Schema.Number,
    window: Schema.Array(Schema.Literals(MARKS)),
    steps: Schema.Number,
    dollars: Schema.Number,
  },
  backstop: {
    passed: Schema.Literals(["steps", "dollars"]),
    backstop: Budget,
    steps: Schema.Number,
    dollars: Schema.Number,
  },
});
export type Stop = typeof Stop.Type;

/** The stop's question, with its counts, for the lead. */
export const stopReason = (stop: Stop): string => {
  const spent = `Spent so far: ${stop.steps} steps, $${stop.dollars.toFixed(2)}.`;
  const ask = "Answer redo, cut scope or drop (0076).";

  if (stop._tag === "intensity") {
    const { sends, work } = counted(stop.window);
    const tools = stop.window.filter((m) => m === "tool").length;
    return `intensity: ${sends + work} of the last ${stop.window.length} steps were sent back or stuck on the work (${sends} sent back, ${work} stuck on the work; ${tools} stuck on a tool, not counted; the limit is ${stop.count} in ${stop.within}). ${spent} ${ask}`;
  }

  const limit = stop.passed === "steps" ? `${stop.backstop.steps} steps` : `$${stop.backstop.dollars.toFixed(2)}`;
  return `backstop: the lane reached ${limit}, its backstop (${stop.backstop.steps} steps, $${stop.backstop.dollars.toFixed(2)}). ${spent} ${ask}`;
};

// ---------------------------------------------------------------- the machine

const Run = Schema.Struct({
  step: Schema.Literals(STEPS),
  note: Schema.String,
  round: Schema.Number,
});

const lineFields = {
  outcome: Schema.String,
  head: Schema.String,
  reason: Schema.String,
  fault: Schema.NullOr(FaultS),
  report: Schema.NullOr(Schema.String),
  box: Schema.String,
  exit: Schema.Number,
  listUsd: Schema.NullOr(Schema.Number),
};

const LineS = Schema.Struct(lineFields);

// `fault` and `listUsd` came with 0076: a record written before them reads them as null.
const SavedLine = Schema.Struct({
  ...lineFields,
  fault: lineFields.fault.pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  listUsd: lineFields.listUsd.pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
});

const Done = Schema.Struct({ ok: Schema.Boolean, detail: Schema.String });

const stepRun = Cmd.make("step_run", { input: Run, ok: LineS, err: ["RetriesExhausted", "unknown"] });

/** One step's record, saved before it starts (`line` null) and again when it ends. */
export const StepRecord = Schema.Struct({
  round: Schema.Number,
  step: Schema.Literals([...STEPS, "host"]),
  note: Schema.String,
  startedAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  line: Schema.NullOr(SavedLine),
  /** The judgment agent's box and answer after this step, when one was asked. */
  judged: Schema.NullOr(Schema.Struct({ box: Schema.String, answer: Schema.String })),
});
export type StepRecord = typeof StepRecord.Type;

/** The lane's chain record, `state/<lane>-chain.json`. */
export const ChainRecord = Schema.Struct({
  lane: Schema.String,
  pr: Schema.NullOr(Schema.Number),
  /** When GitHub was found to have merged the PR already; the chain itself only queues. */
  landed: Schema.NullOr(Schema.String),
  /** When the chain added the PR to GitHub's merge queue. */
  queued: Schema.optionalKey(Schema.String),
  steps: Schema.Array(StepRecord),
  /** Why the chain last stopped to ask a person (0076), when it did. */
  stop: Schema.optionalKey(Stop),
  /** The heartbeat while the chain runs (./flow/Beat.ts); gone once the lane ends. */
  beat: Schema.optionalKey(Beat.Beat),
  /** The commit and folder the lane's last process ran its scripts from (./pin.ts, ticket 835). */
  scripts: Schema.optionalKey(Pin.Pinned),
});
export type ChainRecord = typeof ChainRecord.Type;

/**
 * The rounds a lane's record already holds. A lane started again (`--start`) counts on from here,
 * so a new round never takes an older round's record.
 */
export const roundsIn = (record: ChainRecord): number => record.steps.reduce((most, e) => Math.max(most, e.round), 0);

const judge = Cmd.make("judge", {
  input: Schema.Struct({ step: Schema.Literals(STEPS), line: LineS, round: Schema.Number }),
  ok: Schema.Struct({ text: Schema.String, listUsd: Schema.NullOr(Schema.Number) }),
  err: ["unknown"],
});

const prOpen = Cmd.make("pr_open", {
  input: Schema.Struct({ head: Schema.String }),
  ok: Schema.Struct({ pr: Schema.NullOr(Schema.Number), detail: Schema.String }),
  err: ["unknown"],
});

const loosen = Cmd.make("loosen", {
  input: Schema.Struct({ pr: Schema.Number, head: Schema.String }),
  ok: Schema.Struct({ code: Schema.Number, text: Schema.String }),
  err: ["unknown"],
});

const land = Cmd.make("land", {
  input: Schema.Struct({ pr: Schema.Number }),
  ok: Done,
  err: ["unknown"],
});

/** The host step at the lane's head (`""` for a lane started at review: the state file's head). */
const hostRun = Cmd.make("host_run", {
  input: Schema.Struct({ round: Schema.Number, head: Schema.String }),
  ok: Schema.Struct({
    outcome: Schema.Literals(["done", "skip", "send", "ask", "stuck"]),
    head: Schema.String,
    reason: Schema.String,
  }),
  err: ["unknown"],
});

/** CI's typecheck job at the pushed head, read the moment it ends, once the PR is open (0133). */
const typecheckRead = Cmd.make("typecheck_read", {
  input: Schema.Struct({ pr: Schema.Number, head: Schema.String }),
  ok: Typecheck.Verdict,
  err: ["unknown"],
});

type Cmds =
  | ReturnType<typeof typecheckRead>
  | ReturnType<typeof stepRun>
  | ReturnType<typeof judge>
  | ReturnType<typeof prOpen>
  | ReturnType<typeof loosen>
  | ReturnType<typeof land>
  | ReturnType<typeof hostRun>;

/** How the lane ends: queued, parked for the lead, or stuck; a stop of 0076 says which rule fired. */
export type End = { readonly kind: "done" | "ask" | "stuck"; readonly reason: string; readonly stop?: Stop };
export const exitOf = (e: End): number => (e.kind === "done" ? 0 : e.kind === "ask" ? 20 : 30);

/**
 * The Check, pure: what loosening.sh's exit means before the queue (0014). Exit 0 (no hits) goes on,
 * and `null` says so. Exit 1 is the hit list, parked for the lead's hand check. Anything else is an
 * operating error or an output that never reached the PR: the check fails closed, so it is stuck.
 */
export const looseningEnd = (pr: number, ran: { readonly code: number; readonly text: string }): End | null => {
  const text = ran.text.trim();

  if (ran.code === 0) {
    return null;
  }

  return ran.code === 1
    ? { kind: "ask", reason: `PR ${pr}: loosening.sh hits for the lead's hand check: ${text}` }
    : { kind: "stuck", reason: `PR ${pr}: loosening.sh did not run clean (exit ${ran.code}): ${text}` };
};

type Lane = {
  readonly round: number;
  readonly head: string;
  /** The head the host step last passed or skipped at; `null` before it ran. */
  readonly hosted: string | null;
  readonly heads: Partial<Record<StepName, string>>;
  readonly stucks: number;
  /** The last steps' marks, at most `intensity.within` of them (0076). */
  readonly window: readonly Mark[];
  /** List-price dollars this chain spent, steps and judgments. */
  readonly dollars: number;
  /** Why CI's typecheck job last gave no answer; `null` when it answered, or was not reached. */
  readonly unchecked: string | null;
};

/**
 * The limits the machine reads, from the References, once at start. With a backstop, its steps
 * take `maxSteps`'s place; with none (no estimate), `maxSteps` holds.
 */
export type Limits = {
  readonly maxSteps: number;
  readonly maxStucks: number;
  readonly intensity: { readonly count: number; readonly within: number };
  readonly backstop: Budget | null;
};

type Model =
  | { readonly phase: "idle"; readonly lane: Lane }
  | {
      readonly phase: "stepping";
      readonly lane: Lane;
      readonly step: StepName;
      readonly note: string;
    }
  | { readonly phase: "hosting"; readonly lane: Lane; readonly note: string }
  | { readonly phase: "judging"; readonly lane: Lane; readonly step: StepName; readonly line: Line }
  | { readonly phase: "opening"; readonly lane: Lane }
  | { readonly phase: "typechecking"; readonly lane: Lane; readonly pr: number }
  | { readonly phase: "loosening"; readonly lane: Lane; readonly pr: number }
  | { readonly phase: "landing"; readonly lane: Lane; readonly pr: number }
  | { readonly phase: "over"; readonly lane: Lane; readonly end: End };

type Msg = { readonly type: "start"; readonly step: StepName };
type Step = readonly [Model, readonly Cmds[]];

const stay = (s: Model): Step => [s, []];
const over = (lane: Lane, end: End): Step => [{ phase: "over", lane, end }, []];
const stopped = (lane: Lane, stop: Stop): Step => over(lane, { kind: "ask", reason: stopReason(stop), stop });

/** The intensity, pure: the window holds `count` sends or work stucks (0076). */
const intensityStop = (lane: Lane, { count, within }: Limits["intensity"]): Stop | null => {
  const { sends, work } = counted(lane.window);
  return sends + work >= count
    ? Stop.cases.intensity.make({ count, within, window: lane.window, steps: lane.round, dollars: lane.dollars })
    : null;
};

/** The backstop, pure: the lane ran its steps or spent its dollars (0076). */
const backstopStop = (lane: Lane, backstop: Budget | null): Stop | null => {
  if (backstop === null) {
    return null;
  }

  const passed = lane.round >= backstop.steps ? "steps" : lane.dollars >= backstop.dollars ? "dollars" : null;
  return passed === null
    ? null
    : Stop.cases.backstop.make({ passed, backstop, steps: lane.round, dollars: lane.dollars });
};

/** loosening.sh on the reviewed head of the open PR, before anything lands (0014). */
const loosenAt = (lane: Lane, pr: number): Step => [
  { phase: "loosening", lane, pr },
  [loosen({ pr, head: lane.head })],
];

const runStep = (lane: Lane, step: StepName, note: string): Step => {
  const round = lane.round + 1;
  const next = { ...lane, round };
  const asked = stepRun({ step, note, round });
  return [{ phase: "stepping", lane: next, step, note }, [asked]];
};

/** The host step before a review; it holds the review's note until it ends. */
const runHost = (lane: Lane, note: string): Step => {
  const round = lane.round + 1;
  return [{ phase: "hosting", lane: { ...lane, round }, note }, [hostRun({ round, head: lane.head })]];
};

/**
 * A lane step, after the budget's check: the backstop, or with none `MaxSteps`, may stop the lane
 * first. A review at a head the host step has not run at hosts first, as one more step.
 */
const next = (lane: Lane, step: LaneStep, note: string, limits: Limits): Step => {
  const backstop = backstopStop(lane, limits.backstop);

  if (backstop !== null) {
    return stopped(lane, backstop);
  }

  if (limits.backstop === null && lane.round >= limits.maxSteps) {
    return over(lane, { kind: "ask", reason: `${limits.maxSteps} steps ran (MaxSteps); the lane parks` });
  }

  return step === "review" && lane.hosted !== lane.head ? runHost(lane, note) : runStep(lane, step, note);
};

/**
 * Take a move: a step, the judgment agent, the pull request or a park. Before a step or a judgment,
 * the backstop, or with none `MaxSteps` for a step, may stop the lane.
 */
const take = (lane: Lane, step: StepName, line: Line, move: Move, limits: Limits): Step => {
  switch (move._tag) {
    case "step":
      return next(lane, move.step, move.note, limits);
    case "judge": {
      const backstop = backstopStop(lane, limits.backstop);
      return backstop !== null
        ? stopped(lane, backstop)
        : [{ phase: "judging", lane, step, line }, [judge({ step, line, round: lane.round })]];
    }
    // No laptop typecheck first (0133): CI's typecheck job answers once the head is pushed.
    case "open":
      return [{ phase: "opening", lane }, [prOpen({ head: lane.head })]];
    default:
      return over(lane, { kind: "ask", reason: move.reason });
  }
};

export const makeMachine = (limits: Limits) =>
  defineMachine({
    types: { model: {} as Model, msg: {} as Msg, ctx: undefined },
    cmds: [stepRun, judge, prOpen, typecheckRead, loosen, land, hostRun],
    init: (): Step => [
      {
        phase: "idle",
        lane: { round: 0, head: "", hosted: null, heads: {}, stucks: 0, window: [], dollars: 0, unchecked: null },
      },
      [],
    ],
    update: {
      start: (s, m): Step => {
        if (s.phase !== "idle") {
          return stay(s);
        }

        return m.step === "review" ? runHost(s.lane, "") : runStep(s.lane, m.step, "");
      },
      // Done or skip: review, at the head the host step ran at. A send goes to build with the
      // command's last lines, as a red check would; a stuck ends the lane.
      host_run_ok: (s, m): Step => {
        if (s.phase !== "hosting") {
          return stay(s);
        }

        const { outcome, head, reason } = m.value;
        // 0076: the host step's mark joins the window like any step's. A send to build is a send
        // back; a stuck is the tool's (git, the signer, the push), never counted against the lane.
        const mark: Mark = outcome === "send" ? "send" : outcome === "stuck" ? "tool" : "pass";
        const lane: Lane = { ...s.lane, window: [...s.lane.window, mark].slice(-limits.intensity.within) };
        const intensity = intensityStop(lane, limits.intensity);

        if (intensity !== null) {
          return stopped(lane, intensity);
        }

        if (outcome === "done" || outcome === "skip") {
          const at = head || lane.head;
          return next({ ...lane, head: at, hosted: at }, "review", s.note, limits);
        }

        if (outcome === "send") {
          return next(lane, "build", `host answered send:build: ${reason}`, limits);
        }

        return over(lane, { kind: outcome === "ask" ? "ask" : "stuck", reason: `host: ${reason}` });
      },
      host_run_err: (s): Step =>
        s.phase === "hosting" ? over(s.lane, { kind: "stuck", reason: "the host step threw" }) : stay(s),
      step_run_ok: (s, m): Step => {
        if (s.phase !== "stepping") {
          return stay(s);
        }

        const line = m.value;
        const [verb] = line.outcome.split(":");
        const accepted = verb === "done" || verb === "send" || verb === "skip";
        const lane: Lane = {
          ...s.lane,
          head: accepted && line.head ? line.head : s.lane.head,
          heads: verb === "done" && line.head ? { ...s.lane.heads, [s.step]: line.head } : s.lane.heads,
          stucks: verb === "stuck" ? s.lane.stucks + 1 : 0,
          window: [...s.lane.window, markFrom(line)].slice(-limits.intensity.within),
          dollars: s.lane.dollars + (line.listUsd ?? 0),
        };
        // 0076: the window is checked before any move, so a tripped lane starts nothing more.
        const intensity = intensityStop(lane, limits.intensity);

        if (intensity !== null) {
          return stopped(lane, intensity);
        }

        return take(lane, s.step, line, moveOf(s.step, line, lane.stucks, limits.maxStucks), limits);
      },
      // A typed RetriesExhausted (the slot schedule ran out) or any other failure: stuck, with why.
      step_run_err: (s, m): Step =>
        s.phase === "stepping"
          ? over(s.lane, {
              kind: "stuck",
              reason:
                m.error._tag === "RetriesExhausted"
                  ? `${s.step}: ${m.error.schedule} ran out after ${m.error.times} tries: ${m.error.reason}`
                  : `drive.ts ${s.step} could not be started`,
            })
          : stay(s),
      judge_ok: (s, m): Step => {
        if (s.phase !== "judging") {
          return stay(s);
        }

        const move = moveFrom(m.value.text);
        const lane = { ...s.lane, dollars: s.lane.dollars + (m.value.listUsd ?? 0) };
        return take(lane, s.step, s.line, move, limits);
      },
      judge_err: (s): Step =>
        s.phase === "judging"
          ? over(s.lane, {
              kind: "ask",
              reason: `${s.step} ${s.line.outcome}: ${s.line.reason} (the judgment agent failed)`,
            })
          : stay(s),
      // The PR is open and the head pushed: CI's typecheck job at that head is next (0133).
      pr_open_ok: (s, m): Step => {
        if (s.phase !== "opening") {
          return stay(s);
        }

        const { pr } = m.value;

        if (pr === null) {
          return over(s.lane, { kind: "stuck", reason: m.value.detail });
        }

        return [{ phase: "typechecking", lane: s.lane, pr }, [typecheckRead({ pr, head: s.lane.head })]];
      },
      // Green goes on to loosening.sh. Red is a send back (0076): its mark joins the window, and
      // the step it names gets the error lines; the PR stays open for the next push. No answer
      // goes on too, and the lane keeps why.
      typecheck_read_ok: (s, m): Step => {
        if (s.phase !== "typechecking") {
          return stay(s);
        }

        const verdict = m.value;

        if (verdict._tag !== "red") {
          const unchecked = verdict._tag === "skipped" ? verdict.reason : null;
          return loosenAt({ ...s.lane, unchecked }, s.pr);
        }

        const window = [...s.lane.window, "send" as const].slice(-limits.intensity.within);
        const lane: Lane = { ...s.lane, window, unchecked: null };
        const intensity = intensityStop(lane, limits.intensity);

        if (intensity !== null) {
          return stopped(lane, intensity);
        }

        const said = `CI's typecheck job at ${lane.head.slice(0, 8)} (PR ${s.pr}) answered send:${verdict.to}`;
        return next(lane, verdict.to, `${said}:\n${verdict.lines.join("\n")}`, limits);
      },
      typecheck_read_err: (s): Step =>
        s.phase === "typechecking"
          ? loosenAt({ ...s.lane, unchecked: "reading CI's typecheck job threw" }, s.pr)
          : stay(s),
      loosen_ok: (s, m): Step => {
        if (s.phase !== "loosening") {
          return stay(s);
        }

        const end = looseningEnd(s.pr, m.value);
        return end === null ? [{ phase: "landing", lane: s.lane, pr: s.pr }, [land({ pr: s.pr })]] : over(s.lane, end);
      },
      loosen_err: (s): Step =>
        s.phase === "loosening"
          ? over(s.lane, { kind: "stuck", reason: `loosening.sh for PR ${s.pr} threw` })
          : stay(s),
      pr_open_err: (s): Step =>
        s.phase === "opening" ? over(s.lane, { kind: "stuck", reason: "opening the PR threw" }) : stay(s),
      land_ok: (s, m): Step =>
        s.phase === "landing"
          ? over(
              s.lane,
              m.value.ok
                ? { kind: "done", reason: `PR ${s.pr} queued: ${m.value.detail}` }
                : { kind: "stuck", reason: `PR ${s.pr} not queued: ${m.value.detail}` },
            )
          : stay(s),
      land_err: (s): Step =>
        s.phase === "landing" ? over(s.lane, { kind: "stuck", reason: `queueing PR ${s.pr} threw` }) : stay(s),
    },
  });

// ---------------------------------------------------------------- the world

type Setup = {
  readonly env: Env;
  readonly agents: Agents;
  readonly lane: string;
  readonly ticket: string;
  readonly branch: string;
  readonly plan: string;
  readonly brief: ReturnType<typeof sectionsOf>;
  readonly claude: ReadonlySet<StepName>;
  /** Steps whose Codex runs as plain `codex exec` (`--codex-exec`). */
  readonly exec: ReadonlySet<StepName>;
  readonly electron: ReadonlySet<StepName>;
  readonly model: string;
  /** The `## host` section's commands; none skips the host step. */
  readonly host: ReadonlyArray<string>;
  readonly beats: Beats;
};

/** The last `n` lines of a file, or a line saying it is not there. */
const lastLines = (path: string | null, n: number): string =>
  path !== null && existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").slice(-n).join("\n") : "(none)";

const JUDGE_TAIL = (lane: string, step: StepName, line: Line, state: string, report: string) => `
You are the lead's judgment for lane ${lane}, started by chain.ts because the ${step} step
answered ${line.outcome}: ${line.reason}
You read; you change no file and start nothing. Your row only reads this repo and nothing beside
it, so the lane's state file and the step's report follow below. Read what you need in this repo.
Before you park a question, search .decisions/, .glossary/ and docs/direction/ for its answer. Then
answer with one JSON object (its schema follows): answer "send" with the step to run again (tests, build
or review) and a note of one or two sentences for that step, or answer "park" with step null and
why the lead has to look, in one sentence.
Send a step again when the fix is clear and that step owns it (a tests step owns test files, a
build step product code). Park when a plan would change, a decision is needed, a secret or a
person is involved, or the same step already failed the same way.${
  line.outcome.startsWith(`send:${step}:`)
    ? `
The ${step} step sent the lane to itself, which chain.ts never runs as one more round. When what it
lists as left needs another step's code, a typecheck or --changed, send the next step with that
list in the note. Park when the step itself is not done.`
    : ""
}

---
The lane's state file, its last lines:

${state}

---
The ${step} step's report:

${report}
`;

/** The chain record, a Schema value read and written whole: what a resume needs is on disk. */
const chainFile = (path: string, lane: string) => {
  const readRecord = (): ChainRecord =>
    existsSync(path)
      ? Schema.decodeUnknownSync(ChainRecord)(JSON.parse(readFileSync(path, "utf8")))
      : { lane, pr: null, landed: null, steps: [] };
  const writeRecord = (r: ChainRecord) => {
    const text = JSON.stringify(Schema.encodeSync(ChainRecord)(r), null, "\t");
    writeFileSync(`${path}.tmp`, `${text}\n`);
    renameSync(`${path}.tmp`, path);
  };
  return { readRecord, writeRecord };
};

/** drive.ts's machine phase as a beat's; `null` where the chain names the phase itself. */
const beatPhase = {
  idle: null,
  starting: "box",
  drafting: "agent",
  reading: "collect",
  pushing: "commit",
  recording: "cleanup",
  over: null,
} as const satisfies Record<DrivePhase, Beat.Phase | null>;

/** When a file was last written, or `null` when it is not there. */
const writtenAt = (path: string | null): Date | null =>
  path !== null && existsSync(path) ? statSync(path).mtime : null;

/**
 * The lane's heartbeat in its chain record (./flow/Beat.ts). `enter` names a new phase and, for a
 * phase with an agent, the event log that agent appends to; `tick` writes the beat again; `clear`
 * drops it when the lane ends. The record on disk holds the beat; only the log's path is in memory.
 */
const beating = (file: ReturnType<typeof chainFile>) => {
  let events: string | null = null;
  const write = (beat: Beat.Beat) => file.writeRecord({ ...file.readRecord(), beat });
  const enter = (phase: Beat.Phase, log: string | null) => {
    events = log;
    const now = new Date();
    const entered = Beat.enter(file.readRecord().beat ?? null, phase, now);
    write(Beat.tick(entered, now, writtenAt(events)));
  };
  const tick = () => {
    const beat = file.readRecord().beat;

    if (beat !== undefined) {
      write(Beat.tick(beat, new Date(), writtenAt(events)));
    }
  };
  const clear = () => {
    const { beat: _, ...rest } = file.readRecord();
    file.writeRecord(rest);
  };
  return { enter, tick, clear };
};

type Beats = ReturnType<typeof beating>;

const handlers = (s: Setup) => {
  const { env } = s;
  const state = join(env.BOXES, "state", `${s.lane}.json`);
  const md = join(env.BOXES, "state", `${s.lane}.md`);
  const chainState = join(env.BOXES, "state", `${s.lane}-chain.json`);
  const note = (text: string) => appendFileSync(md, `- ${new Date().toISOString()} chain: ${text}\n`);
  const saved = (): {
    head?: string;
    root?: string;
    steps: { step: string; outcome: string; head: string }[];
  } => (existsSync(state) ? JSON.parse(readFileSync(state, "utf8")) : { steps: [] });
  /** A step's report beside the lane, for its plant table; `null` once the file is gone. */
  const readReport = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);
  const { readRecord, writeRecord } = chainFile(chainState, s.lane);
  /** Replace this round's record (one per round), or add it. */
  const saveStep = (entry: StepRecord) => {
    const r = readRecord();
    const steps = r.steps.some((e) => e.round === entry.round)
      ? r.steps.map((e) => (e.round === entry.round ? entry : e))
      : [...r.steps, entry];
    writeRecord({ ...r, steps });
  };
  // A lane started again (`--start`) counts on from the rounds its record holds, so a new round
  // never takes an older round's record, brief or judgment files.
  const earlier = roundsIn(readRecord());
  const headsOf = () => {
    const heads: Partial<Record<StepName, string>> = {};

    for (const e of saved().steps) {
      if (isStep(e.step) && e.outcome === "done") {
        heads[e.step] = e.head;
      }
    }

    return heads;
  };
  /** The lane's commits from its root to its head, oldest first, each with its note's step. */
  const laneCommits = (root: string, head: string): StepCommit[] | null => {
    if (root === "" || head === "") {
      return [];
    }

    const listed = sh("git", ["-C", env.MAIN, "rev-list", "--reverse", `${root}..${head}`]);
    return listed.code !== 0
      ? null
      : listed.out
          .split("\n")
          .filter(Boolean)
          .map((sha) => {
            const r = sh("git", ["-C", env.MAIN, "notes", "--ref=fabrika", "show", sha]);
            return { sha, step: (r.code === 0 ? stepOf(r.out)[0] : undefined) ?? "unsigned" };
          });
  };
  return {
    step_run: (cmd: typeof Run.Type) =>
      Effect.gen(function* () {
        const lane = saved();
        const round = earlier + cmd.round;
        const heads = headsOf();
        const facts: Facts = {
          ticket: s.ticket,
          branch: s.branch,
          plan: s.plan,
          root: lane.root ?? "",
          head: lane.head ?? "",
          round,
          heads,
          commits: laneCommits(lane.root ?? "", lane.head ?? ""),
          note: cmd.note,
          host: cmd.step === "review" ? Host.lastHost(lane.steps) : null,
          plants:
            cmd.step === "review" ? Plants.section(Plants.records(lane.steps, readReport), heads.build ?? null) : null,
        };
        const brief = join(env.BOXES, `${s.lane}-chain${round}-${cmd.step}-brief.md`);
        writeFileSync(brief, briefOf(s.brief, cmd.step, facts));
        // MUTATION WIRING (ticket 483): mutation's agent is drive.ts's `MUTATION_AGENT`; how its
        // draft runs is `mutationDraft` there. The chain names no other fact about that step, and
        // runs it only for a lane started at mutation (0066).
        const agent = stepAgent(cmd.step, s.claude, s.exec);
        const claude = agent === "claude";
        const entry: StepRecord = {
          round,
          step: cmd.step,
          note: cmd.note,
          startedAt: new Date().toISOString(),
          endedAt: null,
          line: null,
          judged: null,
        };
        saveStep(entry);
        note(`round ${round}: starting ${cmd.step} on ${agent}${cmd.note ? ` (${cmd.note})` : ""}`);
        const minutes = yield* WaitMinutes;
        const times = yield* MaxWaits;
        // One drive run, in this process: prepare (the start checks) and, when they pass, the step.
        // A slot refusal is a typed failure the schedule retries.
        const once = Effect.gen(function* () {
          // prepare runs the start checks in this thread: a hung one stops the beat. Box cleanup is
          // not among them (gcloop.ts, 0101).
          s.beats.enter("cleanup", null);
          const prepared = prepare(env, {
            lane: s.lane,
            step: cmd.step,
            brief,
            agent,
            model: claude ? s.model : undefined,
            electron: claude && s.electron.has(cmd.step),
            ticket: s.ticket,
            branch: s.branch,
            plan: s.plan,
          });

          if (prepared._tag === "refused") {
            const check = slotRefusal(prepared.outcome);

            if (check !== null) {
              note(`drive refused ${cmd.step} (${check}); trying again in ${minutes} minutes`);
              s.beats.enter("wait", null);
              return yield* Effect.fail(new SlotRefused({ check, reason: prepared.reason }));
            }

            return {
              outcome: prepared.outcome,
              head: "",
              reason: prepared.reason,
              fault: faultFrom(prepared.outcome, prepared.reason),
              report: null,
              box: "",
              exit: prepared.exit,
              listUsd: null,
            } satisfies Line;
          }

          const events = prepared.ask.events;
          s.beats.enter("wait", events);
          const ran = yield* driveStep(env, s.agents, prepared, (phase) => {
            const named = beatPhase[phase];

            if (named !== null) {
              s.beats.enter(named, events);
            }
          });
          return {
            outcome: ran.outcome,
            head: ran.head,
            reason: ran.reason,
            fault: ran.fault,
            report: ran.report,
            box: ran.box,
            exit: ran.exit,
            listUsd: ran.listUsd,
          } satisfies Line;
        });
        const line = yield* once.pipe(
          Effect.retry({ schedule: slotSchedule(minutes), times }),
          Effect.catchTag("SlotRefused", (e) =>
            Effect.fail(
              new RetriesExhausted({
                schedule: `slotSchedule(${minutes} minutes)`,
                times: times + 1,
                reason: `${e.check}: ${e.reason}`,
              }),
            ),
          ),
          Effect.tapError((e) =>
            Effect.sync(() => {
              saveStep({
                ...entry,
                endedAt: new Date().toISOString(),
                line: {
                  outcome: `stuck:${e._tag}`,
                  head: "",
                  reason: e.reason,
                  fault: faultFrom(`stuck:${e._tag}`, e.reason),
                  report: null,
                  box: "",
                  exit: 30,
                  listUsd: null,
                },
              });
              note(`round ${round}: ${cmd.step} ${e._tag}: ${e.reason.slice(0, 200)}`);
            }),
          ),
          // tea's err channel takes a plain tagged record; the class stays inside the handler.
          Effect.mapError((e) => ({
            _tag: "RetriesExhausted" as const,
            schedule: e.schedule,
            times: e.times,
            reason: e.reason,
          })),
        );
        saveStep({ ...entry, endedAt: new Date().toISOString(), line });
        return line;
      }),
    judge: (cmd: { step: StepName; line: Line; round: number }) =>
      Effect.gen(function* () {
        const box = RunId.next(s.lane, "judge", runNames(env.BOXES, s.lane));
        const at = (suffix: string) => join(env.BOXES, `${box}${suffix}`);
        note(`round ${earlier + cmd.round}: ${cmd.step} ${cmd.line.outcome}; asking a judgment agent (${box})`);
        s.beats.enter("judge", at(".jsonl"));
        const started = new Date();
        // One turn in the main checkout on the row that only reads (Codex's read-only profile):
        // the judgment cannot change the checkout, by the harness and not by a promise. That row
        // reads nothing beside the checkout, so the state file and the report ride in the prompt.
        const turned = yield* runTurn(s.agents, {
          provider: "codex-read",
          session: box,
          folder: env.MAIN,
          prompt: JUDGE_TAIL(s.lane, cmd.step, cmd.line, lastLines(md, 40), lastLines(cmd.line.report, 200)),
          system: `You are the lead's judgment for lane ${s.lane}, run by chain.ts. You read and change no file.`,
          answer: Judgment,
          model: env.CODEX_MODEL,
          effort: env.CODEX_EFFORT,
          minutes: 20,
          events: at(".jsonl"),
          report: at(".md"),
        });
        const text = turned._tag === "ended" ? turned.said : `${turned.reason}: ${turned.message}`;
        const move = turned._tag === "ended" && turned.answer !== null ? judgedMove(turned.answer) : judgedOf(text);
        // Its field row, beside the steps' rows (record wide).
        const scrubbed = sh("sh", [join(HERE, "redact.sh"), at(".md"), at(".jsonl")]);
        appendFileSync(
          join(env.BOXES, `${s.lane}-rows.jsonl`),
          stepRow({
            run: box,
            ticket: s.ticket,
            step: cmd.step,
            provider: "codex-read",
            model: env.CODEX_MODEL,
            effort: env.CODEX_EFFORT,
            outcome: move._tag === "step" ? "pass" : "parked",
            reason: `chain.ts judgment for ${s.lane} after ${cmd.step} ${cmd.line.outcome}: ${move._tag === "step" ? `send ${move.step}` : "park"}`,
            started,
            ended: new Date(),
            spent: turned.spent,
            redacted: scrubbed.code === 0 ? Number(scrubbed.out.trim()) : null,
          }),
        );
        const answer = move._tag === "step" ? `send ${move.step}: ${move.note}` : `park: ${move.reason}`;
        note(`judgment: ${answer}`);
        const r = readRecord();
        const last = r.steps.find((e) => e.round === earlier + cmd.round);

        if (last) {
          saveStep({ ...last, judged: { box, answer } });
        }

        return { text: JSON.stringify(move), listUsd: listUsd("codex-read", env.CODEX_MODEL, turned.spent) };
      }),
    // CI's typecheck job alone, polled until it ends: never the whole run or ci-required (0133).
    typecheck_read: (cmd: { pr: number; head: string }) =>
      Effect.gen(function* () {
        s.beats.enter("typecheck", null);
        const minutes = yield* TypecheckMinutes;
        const every = yield* TypecheckEvery;
        note(`typecheck: waiting for CI's ${Typecheck.JOB} job at ${cmd.head.slice(0, 8)} (PR ${cmd.pr})`);
        const pushed = Date.now();
        const verdict = yield* Typecheck.wait({ main: env.MAIN, head: cmd.head, minutes, every });
        const took = Math.round((Date.now() - pushed) / 1000);
        note(`typecheck: ${Typecheck.summary(verdict)} (${took} s after the push)`);
        return verdict;
      }).pipe(Effect.provide(Layer.provideMerge(ChecksGh.layer(env.GH_REPO), NodeServices.layer))),
    pr_open: (cmd: { head: string }) =>
      Effect.gen(function* () {
        s.beats.enter("pr", null);
        const title = (s.brief.sections.pr ?? "")
          .split("\n")[0]
          ?.replace(/^#+\s*/, "")
          .trim();

        if (!title) {
          return { pr: null, detail: "the lane brief has no `## pr` section with a title line" };
        }

        const body = [
          (s.brief.sections.pr ?? "").split("\n").slice(1).join("\n").trim(),
          "",
          "## Steps",
          "",
          `Ran end to end by \`chain.ts ${s.lane}\`: no lead agent held the lane. Each step was its own agent through the fabrika agents package on ACP (${providers(
            saved().steps.map((e) => e.step),
            s.claude,
            s.exec,
          )}); the lead agent wrote no step's work. Steps and dollars:`,
          "",
          ...stepsTable(join(env.BOXES, `${s.lane}-rows.jsonl`), saved().steps),
        ].join("\n");
        // The draft opened at the lane's first commit (drive's pushing phase, 0134) takes the brief's
        // words and is marked ready; a lane started before that gets its pull request here.
        note(`review said merge-ready at ${cmd.head.slice(0, 8)}; pushing ${s.branch} and marking its PR ready`);
        const services = Layer.mergeAll(PushesProcess.layer(HERE), PullRequestsGh.layer(env.GH_REPO, env.MAIN));
        const readied = yield* Publish.ready({
          dir: env.MAIN,
          branch: s.branch,
          head: cmd.head,
          text: { title, body },
        }).pipe(
          Effect.map((p) => ({ pr: p.pr, detail: p.opened ? "opened" : "existing" })),
          Effect.catch((e) => Effect.succeed({ pr: null, detail: `${s.branch} not marked ready: ${e.reason}` })),
          Effect.provide(Layer.provide(services, NodeServices.layer)),
        );

        if (readied.pr === null) {
          return readied;
        }

        note(`ready: https://github.com/${env.GH_REPO}/pull/${readied.pr}`);
        writeRecord({ ...readRecord(), pr: readied.pr });
        return readied;
      }),
    // loosening.sh on the exam diff from where the lane leaves main to the reviewed head, run in
    // the main checkout, which holds every step's commits. Its output, hits or not, goes on the PR
    // as a comment before anything lands (0014); a comment that fails is exit 2, never a pass.
    loosen: (cmd: { pr: number; head: string }) =>
      Effect.sync(() => {
        s.beats.enter("loosening", null);
        sh("git", ["-C", env.MAIN, "fetch", "-q", "origin", "main"]);
        const base = sh("git", ["-C", env.MAIN, "merge-base", "origin/main", cmd.head]);

        if (base.code !== 0 || !base.out.trim()) {
          return { code: 2, text: `no merge-base of origin/main and ${cmd.head.slice(0, 8)}` };
        }

        const from = base.out.trim();
        const ran = sh("sh", [join(HERE, "loosening.sh"), from, cmd.head], env.MAIN);
        const text = [ran.out.trim(), ran.err.trim()].filter(Boolean).join("\n");
        note(
          `loosening.sh ${from.slice(0, 8)} ${cmd.head.slice(0, 8)} exited ${ran.code}: ${text.split("\n")[0] ?? ""}`,
        );
        const bodyFile = join(env.BOXES, `${s.lane}-loosening.md`);
        writeFileSync(
          bodyFile,
          [
            `\`loosening.sh ${from} ${cmd.head}\`, run by \`chain.ts ${s.lane}\` after review and before the merge queue (exit ${ran.code}):`,
            "",
            "```text",
            text || "(no output)",
            "```",
            "",
          ].join("\n"),
        );
        const posted = sh("gh", ["pr", "comment", String(cmd.pr), "-R", env.GH_REPO, "--body-file", bodyFile]);

        if (posted.code !== 0) {
          return { code: 2, text: `the loosening comment did not post on PR ${cmd.pr}: ${text}` };
        }

        return { code: ran.code, text };
      }),
    host_run: (cmd: { round: number; head: string }) =>
      Effect.gen(function* () {
        const round = earlier + cmd.round;
        const head = cmd.head || (saved().head ?? "");
        const entry: StepRecord = {
          round,
          step: "host",
          note: "",
          startedAt: new Date().toISOString(),
          endedAt: null,
          line: null,
          judged: null,
        };
        saveStep(entry);
        s.beats.enter("host", null);
        const name = RunId.next(s.lane, "host", runNames(env.BOXES, s.lane));
        note(`round ${round}: starting host ${name} at ${head.slice(0, 8)} (${s.host.length} commands)`);
        const args = {
          main: env.MAIN,
          boxes: env.BOXES,
          lane: s.lane,
          ticket: s.ticket,
          branch: s.branch,
          plan: s.plan,
          head,
          name,
          commands: s.host,
          minutes: yield* HostMinutes,
        };
        const hosted = yield* Host.host(args).pipe(
          Effect.catchTag("StepFailed", (e) =>
            Effect.succeed({ outcome: Outcome.stuck(e.reason), head, log: null } satisfies Host.Hosted),
          ),
        );
        const ended = new Date().toISOString();
        yield* Host.recordInLane(args, hosted, ended).pipe(
          Effect.catch((e) => Effect.sync(() => note(`round ${round}: host could not write the state file: ${e}`))),
        );
        const line: Line = {
          outcome: Host.outcomeName(hosted.outcome),
          head: hosted.head,
          reason: hosted.outcome.reason,
          report: hosted.log,
          box: name,
          exit: hosted.outcome._tag === "stuck" ? 30 : 0,
          // A host stuck is the tool's (git, the signer, the push); the host step runs no agent.
          fault: hosted.outcome._tag === "stuck" ? "tool" : null,
          listUsd: null,
        };
        saveStep({ ...entry, endedAt: ended, line });
        note(`round ${round}: host ${line.outcome}, head ${hosted.head.slice(0, 8)}: ${line.reason.slice(0, 200)}`);
        return { outcome: hosted.outcome._tag, head: hosted.head, reason: hosted.outcome.reason };
      }).pipe(Effect.provide(NodeServices.layer)),
    // The reviewed head enters GitHub's merge queue (./pr/Queue.ts, 0162). The wait is for
    // `ci-required` at that head only; the merge is GitHub's, later, and nothing here waits for it.
    land: (cmd: { pr: number }) =>
      Effect.gen(function* () {
        const minutes = yield* QueueMinutes;
        note(`queue: PR ${cmd.pr}, waiting up to ${minutes} minutes for ${Queue.REQUIRED}`);
        s.beats.enter("land", null);
        const services = Layer.mergeAll(
          PushesProcess.layer(HERE),
          PullRequestsGh.layer(env.GH_REPO, env.MAIN),
          ChecksGh.layer(env.GH_REPO),
        );
        const added = yield* Queue.add({
          dir: env.MAIN,
          pr: cmd.pr,
          wait: { minutes, every: Queue.LANE_WAIT.every },
        }).pipe(
          Effect.map((a) => ({ ok: true, detail: Queue.line(a), at: a._tag })),
          Effect.catch((e) => Effect.succeed({ ok: false, detail: e.reason, at: null })),
          Effect.provide(Layer.provide(services, NodeServices.layer)),
        );
        note(`queue: ${added.detail}`);
        const now = new Date().toISOString();
        writeRecord({
          ...readRecord(),
          ...(added.at === "queued" ? { queued: now } : {}),
          landed: added.at === "merged" ? now : null,
        });
        return { ok: added.ok, detail: added.detail };
      }),
  };
};

/**
 * Which agent ran the lane's steps, for the PR body. It names only steps the lane ran, so a lane
 * with no mutation step (0066) claims none; a mutation step runs on drive's `MUTATION_AGENT`.
 */
export const providers = (
  ran: readonly string[],
  claude: ReadonlySet<StepName>,
  exec: ReadonlySet<StepName> = new Set(),
): string => {
  const on = (agent: AgentName) => STEPS.filter((s) => ran.includes(s) && stepAgent(s, claude, exec) === agent);
  const onExec = on("codex-exec");
  const onClaude = on("claude");
  return [
    "Codex in a box",
    ...(onExec.length === 0 ? [] : [`plain codex exec for ${onExec.join(", ")}`]),
    ...(onClaude.length === 0 ? [] : [`or Claude for ${onClaude.join(", ")}`]),
  ].join(", ");
};

/**
 * Which agent a step runs on: mutation on drive's `MUTATION_AGENT`; else Claude for a step
 * `--claude` names, plain `codex exec` for one `--codex-exec` names, and Codex through ACP for the
 * rest. `--claude` wins a step both name.
 */
export const stepAgent = (step: StepName, claude: ReadonlySet<StepName>, exec: ReadonlySet<StepName>): AgentName =>
  step === "mutation" ? MUTATION_AGENT : claude.has(step) ? "claude" : exec.has(step) ? "codex-exec" : "codex";

/** One table row per step the lane ran, with its list-price dollars from the rows file. */
export const stepsTable = (
  rowsFile: string,
  steps: readonly { step: string; outcome: string; box?: string; run?: string }[],
): string[] => {
  const dollars = new Map<string, number>();

  if (existsSync(rowsFile)) {
    for (const raw of readFileSync(rowsFile, "utf8").split("\n")) {
      // A line that is not JSON, or is JSON null, holds no row.
      const r = Result.getOrUndefined(Result.try(() => JSON.parse(raw) as { run?: string; listUsd?: number } | null));

      if (r?.run && typeof r.listUsd === "number") {
        dollars.set(r.run, r.listUsd);
      }
    }
  }

  const total = steps.reduce((sum, e) => sum + (dollars.get(e.run ?? "") ?? 0), 0);
  return [
    "| Step | Box | Outcome | List $ |",
    "|---|---|---|---|",
    ...steps.map(
      (e) =>
        `| ${e.step} | ${e.box ?? ""} | ${e.outcome} | ${dollars.has(e.run ?? "") ? (dollars.get(e.run ?? "") ?? 0).toFixed(2) : ""} |`,
    ),
    `| total | | | ${total.toFixed(2)} |`,
  ];
};

// ---------------------------------------------------------------- the command

const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const stepSet = (text: string | undefined): Set<StepName> =>
  new Set(
    (text ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(isStep),
  );

export const chainMain = (args: string[], env: Env, pin: Pin.Pinned | null) =>
  Effect.gen(function* () {
    const [lane = "", briefPath = ""] = args;

    if (!LANE_NAME.test(lane) || !existsSync(briefPath)) {
      console.error(
        "usage: node chain.ts <lane> <lane-brief.md> [--ticket <n>] [--branch fabrikalfa/<name>] [--plan <path>] [--claude tests,build] [--electron tests,build] [--codex-exec tests,build,review] [--model sonnet|opus] [--start tests|build|mutation|review]",
      );
      process.exit(2);
    }

    // One live process drives a lane: a second chain, or a chain beside a step run alone, stops
    // here, before any box is made. The scope gives the lane back however the chain ends.
    const running = yield* Effect.acquireRelease(
      Effect.sync(() => holdLane(env.BOXES, lane)),
      (held) => (held === null ? Effect.sync(() => freeLane(env.BOXES, lane)) : Effect.void),
    );

    if (running !== null) {
      console.error(`chain.ts: ${laneRunning(lane, running)}`);
      process.exit(3);
    }

    const statePath = join(env.BOXES, "state", `${lane}.json`);
    const saved: { ticket?: string; branch?: string; plan?: string } = existsSync(statePath)
      ? JSON.parse(readFileSync(statePath, "utf8"))
      : {};
    const ticket = flag(args, "--ticket") ?? saved.ticket;

    if (!ticket) {
      console.error(`chain.ts: no ticket for lane ${lane} yet; pass --ticket`);
      process.exit(2);
    }

    const branch = flag(args, "--branch") ?? saved.branch ?? `fabrikalfa/${lane}`;
    const plan = flag(args, "--plan") ?? saved.plan ?? join(env.BOXES, `${lane}-PLAN.md`);
    const start = flag(args, "--start") ?? "tests";

    if (!isStep(start)) {
      console.error(`chain.ts: --start takes one of ${STEPS.join(", ")}`);
      process.exit(2);
    }

    const brief = sectionsOf(readFileSync(briefPath, "utf8"));
    const missing = lacks(brief, start);

    if (missing.length > 0) {
      console.error(`chain.ts: the lane brief lacks sections: ${missing.map((m) => `## ${m}`).join(", ")}`);
      process.exit(2);
    }

    const host = Host.hostCommands(brief.sections.host);

    if (brief.sections.host !== undefined && host.length === 0) {
      console.error("chain.ts: the lane brief's `## host` names no command in a fenced block");
      process.exit(2);
    }

    const record = chainFile(join(env.BOXES, "state", `${lane}-chain.json`), lane);

    // A restart is a new choice of scripts: the record and the log say which commit, and the last.
    if (pin !== null) {
      console.error(`chain.ts: ${Pin.pinLine(record.readRecord().scripts, pin)}`);
      record.writeRecord({ ...record.readRecord(), scripts: pin });
    }

    const beats = beating(record);
    // A beat left by a process that died is not this one's: its phase must not lend its `since`.
    beats.clear();
    const setup: Omit<Setup, "agents"> = {
      beats,
      env,
      lane,
      ticket,
      branch,
      plan,
      brief,
      claude: stepSet(flag(args, "--claude")),
      exec: stepSet(flag(args, "--codex-exec")),
      electron: stepSet(flag(args, "--electron")),
      model: flag(args, "--model") ?? "sonnet",
      host,
    };
    const backstop = yield* backstopFor(plan, briefPath);
    const limits: Limits = {
      maxSteps: yield* MaxSteps,
      maxStucks: yield* MaxStucks,
      intensity: { count: yield* IntensityCount, within: yield* IntensityWithin },
      backstop,
    };
    const machine = makeMachine(limits);
    const agents = yield* makeStepAgents(join(env.BOXES, "state", "sessions"), env.MAIN);
    const handle = yield* run(machine, {
      ctx: undefined,
      interpret: handlers({ ...setup, agents }),
      terminal: (m) => m.phase === "over",
    });
    const runtime = yield* handle.ready;
    // The beat between phase changes; it stops with this scope, or with a call that blocks.
    const every = Schedule.spaced(Duration.millis(Beat.EVERY));
    yield* Effect.sync(beats.tick).pipe(Effect.repeat(every), Effect.forkScoped);
    yield* runtime.dispatch({ type: "start", step: start });
    const end = yield* runtime.done();

    if (end.phase !== "over") {
      return yield* Effect.die(`chain stopped in ${end.phase}`);
    }

    const { stop } = end.end;
    beats.clear();

    // The stop goes in the chain record with the rule that fired and what was spent (0076).
    if (stop !== undefined) {
      record.writeRecord({ ...record.readRecord(), stop });
    }

    console.log(
      JSON.stringify({
        outcome: end.end.kind,
        lane,
        rounds: end.lane.round,
        head: end.lane.head,
        reason: end.end.reason,
        dollars: Math.round(end.lane.dollars * 100) / 100,
        ...(stop === undefined ? {} : { stop }),
        // Never a silent skip: a typecheck that gave no answer says so on the last line.
        ...(end.lane.unchecked === null ? {} : { typecheck: `no answer: ${end.lane.unchecked}` }),
        exit: exitOf(end.end),
      }),
    );
    return end.end;
  });

/**
 * The lane's backstop: `BackstopTimes` the estimate in the approved plan, else in the lane brief.
 * With none, one printed line says the backstop is skipped and `MaxSteps` holds. The numbers go to
 * stderr only, never into a step's brief or the state file a judgment reads (0076).
 */
const backstopFor = (plan: string, brief: string) =>
  Effect.gen(function* () {
    const times = yield* BackstopTimes;
    const maxSteps = yield* MaxSteps;
    const found = [plan, brief].flatMap((path) => {
      const estimate = existsSync(path) ? estimateIn(readFileSync(path, "utf8")) : null;
      return estimate === null ? [] : [{ path, estimate }];
    })[0];

    if (found === undefined) {
      console.error(
        `chain.ts: no estimate in steps and dollars in ${plan} or ${brief}; the backstop is skipped, and MaxSteps (${maxSteps}) holds`,
      );
      return null;
    }

    const backstop = backstopFrom(found.estimate, times);
    console.error(
      `chain.ts: backstop ${backstop.steps} steps, $${backstop.dollars.toFixed(2)}: ${times} times the estimate in ${found.path}`,
    );
    return backstop;
  });

/** A limit's override from the environment, when set and a number. */
const overridden =
  (ref: Context.Reference<number>, name: string) =>
  <E>(self: Effect.Effect<void, E, never>): Effect.Effect<void, E, never> => {
    const v = Number(process.env[name]);
    return process.env[name] !== undefined && Number.isFinite(v) ? Effect.provideService(self, ref, v) : self;
  };

/** The last line of a lane that never started: its pin could not be made or read. */
const unpinned = (reason: string, lane?: string) => {
  console.log(JSON.stringify({ outcome: "stuck", ...(lane === undefined ? {} : { lane }), reason, exit: 30 }));
  process.exitCode = 30;
};

/**
 * A lane started from a checkout pins its scripts first and runs chain.ts again from the pin, with
 * the same arguments (./pin.ts, ticket 835): that pinned process drives the lane. This one waits,
 * answers its exit code, and removes the pin when it ends; a SIGINT or SIGTERM stops the pinned
 * process first.
 */
const launch = (env: Env, lane: string, args: ReadonlyArray<string>) =>
  NodeRuntime.runMain(
    Effect.gen(function* () {
      const folder = pinFolder(env.BOXES, lane, process.pid);
      const pin = yield* Pin.acquire({ main: env.MAIN, folder, script: "chain.ts" });
      const code = yield* Pin.runPinned(pin, env, "chain.ts", args);
      yield* Effect.sync(() => {
        process.exitCode = code;
      });
    }).pipe(
      Effect.scoped,
      Effect.catchTag("PinFailed", (e) => Effect.sync(() => unpinned(`scripts not pinned: ${e.reason}`, lane))),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );

const main = () => {
  const env = loadEnv();
  const args = process.argv.slice(2);
  const state = Pin.pinState(process.env[Pin.PIN_ENV]);
  const [lane = ""] = args;

  if (state._tag === "malformed") {
    unpinned(`${Pin.PIN_ENV} does not parse: ${state.value}`);
    return;
  }

  // A usage error needs no pin: it is printed here, from the checkout.
  if (state._tag === "unpinned" && LANE_NAME.test(lane)) {
    launch(env, lane, args);
    return;
  }

  const pin = state._tag === "pinned" ? state.pin : null;
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const end = yield* chainMain(args, env, pin);
        process.exitCode = exitOf(end);
      }),
    ).pipe(
      overridden(WaitMinutes, "CHAIN_WAIT_MINUTES"),
      overridden(MaxWaits, "CHAIN_WAITS"),
      overridden(MaxStucks, "CHAIN_STUCKS"),
      overridden(MaxSteps, "CHAIN_STEPS"),
      overridden(IntensityCount, "CHAIN_INTENSITY"),
      overridden(IntensityWithin, "CHAIN_WITHIN"),
      overridden(BackstopTimes, "CHAIN_BACKSTOP"),
      overridden(HostMinutes, "CHAIN_HOST_MINUTES"),
      overridden(TypecheckMinutes, "CHAIN_TYPECHECK_MINUTES"),
      overridden(TypecheckEvery, "CHAIN_TYPECHECK_EVERY"),
      overridden(QueueMinutes, "CHAIN_QUEUE_MINUTES"),
    ),
  ).catch((e: unknown) => {
    console.log(JSON.stringify({ outcome: "stuck", reason: String(e), exit: 30 }));
    process.exitCode = 30;
  });
};

if (import.meta.main) {
  main();
}
