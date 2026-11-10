import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ledger, streams } from "@kampus/fabrika-old";
import { memoryTracing } from "@kampus/fabrika-old/otel";
import { fileStorage } from "@kampus/fabrika-old/storage/node";
import { Duration, Effect, Exit, Fiber, Layer, Option, Schema } from "effect";
import { expect, vi } from "vitest";
import { memoryLedger } from "../../asks/ledger.ts";
import type { Polling } from "../../code-host-github.ts";
import { hashOf, textOf } from "../../tickets/approval.ts";
import { type Entry, nameOf } from "../../tickets/ticket.ts";
import { Tickets, TicketsFailed, ticketsOnLedger } from "../../tickets/tickets.ts";
import { MutationRunner } from "../mutation/services.ts";
import { TestsWork } from "../test-writer/program.ts";
import { type CheckRun, CheckRunner } from "./checks.ts";
import { fakeEnv, type GhStory, makeFakeGh, makeLaneHome, shWord } from "./lane-fixture.ts";
import { laneLayer, runLane } from "./layer.ts";
import { Lane, type Resume } from "./machine.ts";
import { type Folded, fold, seenOf } from "./restart.ts";
import { LaneWork } from "./work.ts";

// The shared setup of the lane tests, `lane.*.test.ts`: a toy lane run whole, and what it read.

// One tracker ticket through the whole lane in this process: the real machines, the real Codex
// adapter over a fake `codex`, real git on a bare remote, real vitest and Stryker, the real box, and
// a person's answers written as the ticket window writes them. No live agent, and nothing real is
// touched. Today's version.

export const MODULES = fileURLToPath(new URL("../../../node_modules", import.meta.url));

export const BRIEFS = fileURLToPath(new URL("../../../../../programs/pipeline/briefs", import.meta.url));

export const OWNER = "user:owner";
export const NUMBER = 1;

export const file = (title: string, body: string, writer: string, number = NUMBER) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    yield* ledger.register(nameOf(number), writer);
    yield* ledger.send(streams(nameOf(number)).inbox, `file-${number}`, {
      kind: "filed",
      writer,
      data: { type: "filed", title, body },
    });
  });

export const readNumbered = (number: number) =>
  Effect.gen(function* () {
    return yield* (yield* Tickets).read(number);
  }).pipe(Effect.provide(ticketsOnLedger({ kind: "agent", id: "reader", for: "owner" })));

const read = readNumbered(NUMBER);

/** A person's yes at the plan and at each merge, the rule change's too. A step's question has none. */
export const YES = { approve: "approve", exam_merge: "merge", merge: "merge" };

/**
 * Answers every ask as a person, with `picks[kind]`, until the fiber is stopped. A question it has no
 * pick for fails it, out loud: a silent first pick could say `again` for ever.
 */
export const answering = (
  picks: Readonly<Record<string, string>>,
  {
    steps = [],
    notes = {},
    queues = {},
    leave = [],
    onlyStep,
  }: Pick<Script, "steps" | "notes" | "queues" | "leave"> & {
    /** The one step's question this person answers. Any other waits for ever. */
    readonly onlyStep?: string;
  } = {},
) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const done = new Set<string>();
    const queue = [...steps];
    const inTurn = new Map(Object.entries(queues).map(([kind, said]) => [kind, [...said]]));

    for (;;) {
      const ticket = yield* read;

      for (const entry of ticket.timeline) {
        const fact = entry.fact;

        if (fact.type !== "asked" || done.has(fact.ask)) {
          continue;
        }

        const kind = fact.ask.split("-")[1] ?? "";

        if (kind === "step" && onlyStep !== undefined && fact.ask !== onlyStep) {
          continue;
        }

        done.add(fact.ask);

        // A question this person leaves: the lane waits on it.
        if (leave.includes(kind)) {
          continue;
        }

        const pick = (kind === "step" ? queue.shift() : undefined) ?? inTurn.get(kind)?.shift() ?? picks[kind];

        if (pick === undefined) {
          return yield* Effect.die(
            new Error(
              `The test's person has no pick for ${fact.ask}, "${fact.what}" (${fact.picks.join(" or ")}). Give the test one.`,
            ),
          );
        }

        yield* ledger.send(streams(nameOf(NUMBER)).inbox, `answer-${fact.ask}`, {
          kind: "answered",
          writer: OWNER,
          data: {
            type: "answered",
            ask: fact.ask,
            pick,
            note: notes[kind] ?? "",
            text: yield* hashOf(textOf(ticket)),
          },
        });
      }

      yield* Effect.sleep("50 millis");
    }
  });

/**
 * Ends once each kind in `leave` has been asked on the ticket and the ticket has had no new fact for
 * a second: the lane is waiting on a question nobody will answer, as it would until `within`.
 */
const waitingOnLeft = (leave: readonly string[]) =>
  Effect.gen(function* () {
    let facts = -1;
    let quiet = 0;

    for (;;) {
      const { timeline } = yield* read;
      const asked = new Set(timeline.flatMap((e) => (e.fact.type === "asked" ? [e.fact.ask.split("-")[1] ?? ""] : [])));
      const waiting = leave.every((kind) => asked.has(kind));
      quiet = waiting && timeline.length === facts ? quiet + 1 : 0;
      facts = timeline.length;

      if (quiet >= 10) {
        return;
      }

      yield* Effect.sleep("100 millis");
    }
  }).pipe(Effect.orDie);

export interface Ran {
  readonly lines: readonly string[];
  /** The lane as it was saved after each line, in turn. `null`: it did not read back. */
  readonly stops: readonly (Lane | null)[];
  /** With `fold`: the fold of the lane's facts after each line, or why it failed. */
  readonly folds: readonly (Folded | string)[];
  readonly stages: readonly string[];
  readonly names: Readonly<Record<string, string>>;
  readonly facts: readonly { readonly type: string; readonly [key: string]: unknown }[];
  /** The ticket's entries, each fact with who wrote it. */
  readonly entries: readonly Entry[];
  /** With `traced`: every span the lane made and ended, raw. Without: none. */
  readonly spans: readonly Span[];
  readonly dir: string;
  readonly remote: string;
  /** The stand-in `gh`, when the script played one. */
  readonly gh: ReturnType<typeof makeFakeGh> | null;
  /**
   * Each run of the test writer's check, in turn: the commit its tests ran on, their files, and the
   * line it ran in, the first being 0.
   */
  readonly onBase: readonly {
    readonly line: number;
    readonly commit: string;
    readonly files: readonly string[];
  }[];
}

export interface Script {
  readonly title?: string;
  readonly writer?: string;
  /** The person's pick, by the kind of question. A question with none fails the test. */
  readonly picks?: Readonly<Record<string, string>>;
  /** A step's questions, answered in turn. Past the last, `picks` answers. */
  readonly steps?: readonly string[];
  /** What a person writes beside their pick, by the kind of question. */
  readonly notes?: Readonly<Record<string, string>>;
  /** The person's picks for one kind of question, in turn. Past the last, `picks` answers. */
  readonly queues?: Readonly<Record<string, readonly string[]>>;
  /**
   * Kinds of question the person never answers: the lane waits on them. Once each has been asked and
   * the ticket has had no new fact for a second, the line ends there with `WAITING`.
   */
  readonly leave?: readonly string[];
  /**
   * After the line ends, type it again, once per entry, each after its `between`: what happens while
   * the lane is stopped, such as main moving or a person closing the ticket (self-fix PR 5).
   */
  readonly again?: readonly {
    readonly between?: (at: Where) => Effect.Effect<void, never, Ledger>;
  }[];
  /** The mutation step's Stryker run cannot run, on the first line only: the lane stops at mutation. */
  readonly failMutation?: boolean;
  /**
   * On the first line only, each test writer's run on the base fails with this beside its
   * `could_not_run` tag, as the box would say it (tracker 193): the test writer runs once more, and the
   * lane stops at it, round 1.
   */
  readonly failOnBase?: Readonly<Record<string, unknown>>;
  /**
   * With `failOnBase`: the first of the test writer's runs on the base that fails, the first being 0,
   * on the first line; each run after it there fails too. Left out: 0.
   */
  readonly failOnBaseFrom?: number;
  /**
   * What the test writer's run on the base answers for `tests` on its `nth` run, counted over every
   * line, the first being 0. `null`: it runs for real.
   */
  readonly onBaseSays?: (
    nth: number,
    tests: readonly { readonly property: string; readonly file: string; readonly name: string }[],
  ) => readonly { readonly property: string; readonly result: "red" | "green" }[] | null;
  /** After each line, fold the lane's facts (./restart.ts), to set beside what it saved. */
  readonly fold?: boolean;
  /** Stop the lane when a line holding this is said, then type the line again. */
  readonly killAt?: string;
  /** The checkout the lane starts from has no origin. */
  readonly noOrigin?: boolean;
  /** The host is GitHub, played by a stand-in `gh` that tells this story. */
  readonly story?: GhStory;
  /** `[review] rubrics`. `null`: the file leaves the table out. */
  readonly rubrics?: string | null;
  /** `[checks] github`. */
  readonly counted?: "every" | "required" | "none";
  /** How the GitHub host's waits ask. Left out, as in use: every 30 s. */
  readonly polling?: Polling;
  /**
   * Seconds until a stuck line is stopped. It ends with `TIMED_OUT`, so a stuck lane says so with its
   * lines, before vitest's own 60 s limit (`vitest.config.ts`) fails the test with none. Left out: 50.
   * At most 50 for the same reason.
   */
  readonly within?: number;
  /** More files on main from the first commit. */
  readonly mainFiles?: readonly { readonly path: string; readonly text: string }[];
  /** After the kill, the repo's own checks turn red: a second `[[checks.run]]` starts to fail. */
  readonly redAfterKill?: boolean;
  /** What the fake agent says in place of its plain answers: `script.json`, fixtures/pipeline-lane/codex.mjs. */
  readonly fake?: FakeScript;
  /**
   * Stop the lane at the step's question whose line this matches, unanswered, and start it again from
   * what it saved, holding `offers` as code from before this change would have.
   */
  readonly savedAsking?: { readonly at: RegExp; readonly offers: readonly string[] };
  /** When the repo's own tests stop running at any head, as with a full disk: from a second test writer on, or once a lane stopped by `savedAsking` starts again. */
  readonly checksStopRunning?: "at_second_writer" | "at_restart";
  /**
   * What code's checks after a build answer at `head`, on their `nth` run, the first being 0. `null`:
   * they run for real. `where`: the run's folders, for a check that moves main while it runs.
   */
  readonly checksSay?: (head: string, nth: number, where: Where) => CheckRun | null;
  /** On the line typed again this many times, the first read of the ticket off the ledger fails. */
  readonly readFailsAt?: number;
  /**
   * A person closes or reopens the ticket, in turn, each once its step has ended: the lane's next read
   * of the ticket after that finds it so, and so does the step after it.
   */
  readonly ticketAfter?: readonly { readonly step: string; readonly fact: "closed" | "reopened" }[];
  /**
   * A person pushes one commit with `files` on top of the head the lane last pushed, on the remote,
   * once `step` has ended on the ticket: the lane's next read of the ticket after that finds it there.
   */
  readonly branchAfter?: {
    readonly step: string;
    readonly files: readonly { readonly path: string; readonly text: string }[];
  };
  /** On every line typed again, the ticket reads as a lane from before self-fix PR 4 left it: no `checked` facts. */
  readonly beforeChecks?: boolean;
  /** On every line typed again, the ticket reads as a lane from before self-fix PR 5 left it: no end kept its carry. */
  readonly beforeCarries?: boolean;
  /** Main names its formatter (`FORMATTER`) before the lane starts: `[format] run`, pushed. */
  readonly formatter?: boolean;
  /** Keep every span the lines make, raw, in memory (ticket 141). */
  readonly traced?: boolean;
  /**
   * The ticket's working copy is made from main before the first line, as an earlier line left ticket
   * 117's (tracker 194): its branch leaves main there, whatever main merges after.
   */
  readonly treeFirst?: boolean;
  /**
   * With `treeFirst`: one commit of these files on the working copy's branch, which main lacks, as a
   * line that built on it before would leave it.
   */
  readonly treeHolds?: readonly { readonly path: string; readonly text: string }[];
}

/** One span as the in-memory exporter keeps it. */
type Span = ReturnType<typeof memoryTracing>["spans"][number];

/** By step, as the fake names them. Each list goes by the step's runs, first run first. */
export interface FakeScript {
  /** A string is the whole last message. `with` lays keys over the plain answer. `null`: the plain answer. */
  readonly answers?: Readonly<
    Record<string, readonly (string | { readonly with: Readonly<Record<string, unknown>> } | null)[]>
  >;
  /** Codex `error` events, in mid-stream. */
  readonly notes?: Readonly<Record<string, readonly string[]>>;
  /** More files the step writes in its folder. */
  readonly writes?: Readonly<Record<string, readonly { readonly path: string; readonly text: string }[]>>;
  /** More files one run of the step writes, by the run, the first being 0. */
  readonly writesAt?: Readonly<
    Record<string, Readonly<Record<number, readonly { readonly path: string; readonly text: string }[]>>>
  >;
  /** Every review row is `unseen`, for this reason. */
  readonly unseen?: string;
  /** Every surviving mutant is answered `cannot`, for this reason. `{mutant}` in it is that mutant's id. */
  readonly cannot?: string;
  /** Each run's log keeps what its folder holds at these paths as it starts: `seen` in `codexRuns`. */
  readonly see?: readonly string[];
  /**
   * As one run of the step starts, by the run, the first being 0: a person pushes one commit to
   * `branch` on the remote, with `text` at `path`. Its sha is `pushed` in `codexRuns`.
   */
  readonly pushesAt?: Readonly<
    Record<string, Readonly<Record<number, { readonly branch: string; readonly path: string; readonly text: string }>>>
  >;
}

export const TIMED_OUT = "-- timed out --";
/** The line was ended while it waited on a question the person leaves (`leave`). */
const WAITING = "-- waiting on a question left unanswered --";
export const KILLED = "-- killed --";
/** The same line, typed again. */
export const AGAIN = "-- the same line again --";

/** Where a run's files are, for what happens between two lines. */
export interface Where {
  readonly dir: string;
  readonly home: string;
  readonly remote: string;
}

/** The lane as it is saved now, read back, or `null` when it does not read. */
const savedLane = (home: string) =>
  Effect.gen(function* () {
    const handle = yield* fileStorage(join(home, "storage", "lanes")).open(`lane-${NUMBER}`, {});
    const store = handle.store("lane", `lane/${NUMBER}`, Lane);
    const saved = store.migrate(yield* Effect.promise(() => store.load()));
    return Schema.is(Lane)(saved) ? saved : null;
  }).pipe(Effect.orDie);

const LegacyOver = Schema.Struct({
  phase: Schema.Literal("over"),
  number: Schema.Finite,
  trail: Schema.Array(Schema.Unknown),
  outcome: Schema.Unknown,
  said: Schema.String,
});

/** A ticket's fact as a lane from before self-fix PR 4 wrote it: no `checked` fact, and no checks in an end's carry. */
const withoutChecks = (entry: Entry): readonly Entry[] => {
  const { fact } = entry;

  if (fact.type === "checked") {
    return [];
  }

  if (fact.type !== "ended" || typeof fact.carry !== "object" || fact.carry === null) {
    return [entry];
  }

  const carry = Object.fromEntries(Object.entries(fact.carry).filter(([key]) => key !== "checked"));
  return [{ ...entry, fact: { ...fact, carry } }];
};

/** A ticket's fact as a lane from before self-fix PR 5 wrote it: an end kept no carry. */
const withoutCarry = (entry: Entry): Entry => {
  const { fact } = entry;

  if (fact.type !== "ended") {
    return entry;
  }

  const { carry: _, ...rest } = fact;
  return { ...entry, fact: rest };
};

/** The stopped lane, saved again as code from before self-fix PR 5 kept a stop: no `Held`, nowhere to go on. */
export const keptAsLegacy = (home: string) =>
  Effect.gen(function* () {
    const handle = yield* fileStorage(join(home, "storage", "lanes")).open(`lane-${NUMBER}`, {});
    const store = handle.store("lane", `lane/${NUMBER}`, Schema.Unknown);
    const raw = yield* Effect.promise(() => store.load());

    if (!Schema.is(LegacyOver)(raw)) {
      return yield* Effect.die(new Error("the lane was not saved over"));
    }

    const { phase, number, trail, outcome, said } = raw;
    yield* Effect.promise(() => store.save({ phase, number, trail, outcome, said }));
  }).pipe(Effect.orDie);

/**
 * The stopped lane, saved again to go on at `at`, in `round`, as a stop there would keep it. Left
 * out: as it was saved.
 */
export const keptGoingOn = (home: string, { at, round }: { readonly at?: Resume; readonly round?: number }) =>
  Effect.gen(function* () {
    const handle = yield* fileStorage(join(home, "storage", "lanes")).open(`lane-${NUMBER}`, {});
    const store = handle.store("lane", `lane/${NUMBER}`, Lane);
    const saved = store.migrate(yield* Effect.promise(() => store.load()));

    if (!Schema.is(Lane)(saved) || saved.phase !== "over" || !("held" in saved)) {
      return yield* Effect.die(new Error("the lane was not saved stopped"));
    }

    yield* Effect.promise(() =>
      store.save({
        ...saved,
        ...(at === undefined ? {} : { at }),
        ...(round === undefined ? {} : { held: { ...saved.held, round } }),
      }),
    );
  }).pipe(Effect.orDie);

/** One commit on the remote's main, as someone working elsewhere would push it. */
export const pushToMain = (
  { dir, remote }: Where,
  files: readonly { readonly path: string; readonly text: string }[],
) => {
  const work = join(dir, "elsewhere");
  const git = (...args: readonly string[]) =>
    execFileSync("git", ["-c", "user.name=Elsewhere", "-c", "user.email=elsewhere@example.com", ...args], {
      cwd: work,
      stdio: "pipe",
    });
  execFileSync("git", ["clone", "-q", remote, work], { stdio: "pipe" });

  for (const { path, text } of files) {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), text);
  }

  git("add", "-A");
  git("commit", "-qm", "Main moved elsewhere");
  git("push", "-q", "origin", "HEAD:main");
  rmSync(work, { recursive: true, force: true });
};

/**
 * One commit on the remote branch whose tip is `head`, as a person would push it there, on top of
 * what the lane left. Its sha.
 */
export const pushOnTopOf = (
  { dir, remote }: Where,
  head: string,
  files: readonly { readonly path: string; readonly text: string }[],
): string => {
  const branches = execFileSync(
    "git",
    ["--git-dir", remote, "for-each-ref", "--points-at", head, "--format=%(refname:lstrip=2)", "refs/heads/"],
    { encoding: "utf8", stdio: "pipe" },
  )
    .split("\n")
    .filter((name) => name !== "" && name !== "main");
  const [branch] = branches;

  if (branch === undefined || branches.length > 1) {
    throw new Error(`one branch should end at ${head}, not ${JSON.stringify(branches)}`);
  }

  const work = join(dir, "person");
  const git = (...args: readonly string[]) =>
    execFileSync("git", ["-c", "user.name=A person", "-c", "user.email=person@example.com", ...args], {
      cwd: work,
      encoding: "utf8",
      stdio: "pipe",
    });
  execFileSync("git", ["clone", "-q", "--branch", branch, remote, work], { stdio: "pipe" });

  for (const { path, text } of files) {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), text);
  }

  git("add", "-A");
  git("commit", "-qm", "A person's change");
  git("push", "-q", "origin", `HEAD:refs/heads/${branch}`);
  const sha = git("rev-parse", "HEAD").trim();
  rmSync(work, { recursive: true, force: true });
  return sha;
};

/** A person closes the ticket, in the window. */
export const closeTicket = Effect.gen(function* () {
  const ledger = yield* Ledger;
  yield* ledger.send(streams(nameOf(NUMBER)).inbox, `close-${NUMBER}`, {
    kind: "closed",
    writer: OWNER,
    data: { type: "closed" },
  });
}).pipe(Effect.orDie);

const SAVED_ASK = "a-step-99";

/**
 * The saved lane, as code from before this change would have kept it: asking the same thing, with
 * `offers` on offer. Under an id of its own, so the lane's own question on the ticket stays as it was
 * and the restarted lane writes this one there, with these picks.
 */
const keptAsAsking = (home: string, offers: readonly string[]) =>
  Effect.gen(function* () {
    const handle = yield* fileStorage(join(home, "storage", "lanes")).open(`lane-${NUMBER}`, {});
    const store = handle.store("lane", `lane/${NUMBER}`, Lane);
    const saved = store.migrate(yield* Effect.promise(() => store.load()));

    if (!Schema.is(Lane)(saved) || saved.phase !== "asking") {
      return yield* Effect.die(new Error("the lane was not saved asking"));
    }

    yield* Effect.promise(() =>
      store.save({
        ...saved,
        question: { ...saved.question, ask: SAVED_ASK, picks: offers },
        asked: {
          ...saved.asked,
          ask: SAVED_ASK,
          picks: offers,
          intent: `lane/${NUMBER}/${SAVED_ASK}`,
        },
      }),
    );
  }).pipe(Effect.orDie);

/**
 * The toy repository's own formatter: each leading pair of spaces becomes a tab. It stands for
 * `node oxlint-plugins/format.ts {files}` here, as in ./program.format.test.ts.
 */
const FORMATTER = {
  path: "fmt.mjs",
  text: [
    'import {readFileSync, writeFileSync} from "node:fs";',
    "for (const file of process.argv.slice(2))",
    '\twriteFileSync(file, readFileSync(file, "utf8").replace(/^(?: {2})+/gm, (s) => "\\t".repeat(s.length / 2)));',
    "",
  ].join("\n"),
};

/** Main names its formatter: `[format] run`, with `{files}` for the paths, pushed as a commit of its own. */
const nameFormatter = (seed: string) => {
  appendFileSync(
    join(seed, ".fabrika", "fabrika.toml"),
    `\n[format]\nrun = ${JSON.stringify(["node", FORMATTER.path, "{files}"])}\n`,
  );
  const git = (...args: readonly string[]) =>
    execFileSync("git", args, {
      cwd: seed,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "fixture",
        GIT_AUTHOR_EMAIL: "fixture@fabrika.invalid",
        GIT_COMMITTER_NAME: "fixture",
        GIT_COMMITTER_EMAIL: "fixture@fabrika.invalid",
      },
      stdio: "pipe",
    });
  git("add", "-A");
  git("commit", "--quiet", "-m", "name the formatter");
  git("push", "--quiet", "origin", "main");
};

/** Every folder a run made, for those tests that clean up after themselves. */
export const made: string[] = [];

export const lane = ({
  title = "Read names in one form",
  writer = OWNER,
  picks = {},
  steps,
  notes,
  queues,
  leave,
  again = [],
  failMutation = false,
  failOnBase,
  failOnBaseFrom = 0,
  onBaseSays,
  fold: folding = false,
  killAt,
  noOrigin = false,
  story,
  rubrics,
  counted,
  polling,
  within = 50,
  mainFiles,
  redAfterKill = false,
  fake,
  savedAsking,
  checksStopRunning,
  checksSay,
  readFailsAt,
  ticketAfter = [],
  branchAfter,
  beforeChecks = false,
  beforeCarries = false,
  formatter = false,
  traced = false,
  treeFirst = false,
  treeHolds,
}: Script): Promise<Ran> => {
  const tracing = traced ? memoryTracing({ raw: true }) : null;
  let checksRan = 0;
  /** A ticket's facts, read on a line typed again, as the older code the script names left them. */
  const olderThan = (timeline: readonly Entry[]): readonly Entry[] => {
    const checks = beforeChecks ? timeline.flatMap(withoutChecks) : timeline;
    return beforeCarries ? checks.map(withoutCarry) : checks;
  };
  /** The line whose first ticket read already failed. */
  let readFailed = false;
  /** How many times the line was typed again. */
  let typed = 0;
  /** The run's ledger, for a person's `ticketAfter` writes. Set as the run starts. */
  let ledgerOf: Ledger["Service"] | null = null;
  /** How many of `ticketAfter` the person has written. */
  let ticketMoved = 0;
  /** The person's next `ticketAfter` write, once its step has ended on the ticket. */
  const ticketMoves = (tickets: Tickets["Service"], n: number) =>
    Effect.gen(function* () {
      const move = ticketAfter[ticketMoved];

      if (move === undefined || ledgerOf === null) {
        return;
      }

      const { timeline } = yield* tickets.read(n);
      const ended = timeline.some((e) => {
        const fact = e.fact as Ran["facts"][number];
        return fact.type === "ended" && fact.stage === move.step;
      });

      if (!ended) {
        return;
      }

      ticketMoved++;
      yield* ledgerOf.send(streams(nameOf(NUMBER)).inbox, `${move.fact}-${ticketMoved}`, {
        kind: move.fact,
        writer: OWNER,
        data: { type: move.fact },
      });
    }).pipe(Effect.orDie);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-")));
  made.push(dir);
  const red = join(dir, "red");
  const { home, remote, seed } = makeLaneHome({
    dir,
    nodeModules: MODULES,
    reads: [dirname(dirname(dirname(MODULES)))],
    host: story === undefined ? "local" : "github",
    ...(rubrics === undefined ? {} : { rubrics }),
    ...(counted === undefined ? {} : { github: counted }),
    ...(mainFiles === undefined && !formatter
      ? {}
      : { mainFiles: [...(mainFiles ?? []), ...(formatter ? [FORMATTER] : [])] }),
    ...(redAfterKill ? { alsoCheck: `test ! -e ${shWord(red)}` } : {}),
  });
  /** Whether the person pushed `branchAfter`'s commit. */
  let branchMoved = false;
  /** The person's `branchAfter` push, once its step has ended on the ticket. */
  const branchMoves = (tickets: Tickets["Service"], n: number) =>
    Effect.gen(function* () {
      if (branchAfter === undefined || branchMoved) {
        return;
      }

      const facts = (yield* tickets.read(n)).timeline.map((e) => e.fact as Ran["facts"][number]);

      if (!facts.some((f) => f.type === "ended" && f.stage === branchAfter.step)) {
        return;
      }

      const head = facts.filter((f) => f.type === "pushed").at(-1)?.head;

      if (typeof head !== "string") {
        return;
      }

      branchMoved = true;
      yield* Effect.sync(() => pushOnTopOf({ dir, home, remote }, head, branchAfter.files));
    }).pipe(Effect.orDie);

  if (formatter) {
    nameFormatter(seed);
  }

  if (noOrigin) {
    execFileSync("git", ["remote", "remove", "origin"], { cwd: seed, stdio: "pipe" });
  }

  // The fake reads the remote from its script, for a person's push (`pushesAt`).
  if (fake !== undefined) {
    writeFileSync(join(dir, "script.json"), JSON.stringify({ ...fake, remote }));
  }

  for (const [key, value] of Object.entries(fakeEnv(dir))) {
    vi.stubEnv(key, value);
  }

  const gh = story === undefined ? null : makeFakeGh({ dir, remote, story });

  for (const [key, value] of Object.entries(gh?.env ?? {})) {
    vi.stubEnv(key, value);
  }

  const lines: string[] = [];
  const stops: (Lane | null)[] = [];
  const folds: (Folded | string)[] = [];
  const onBase: Ran["onBase"][number][] = [];
  /** What a line left: the lane as saved, and with `fold`, the fold of its facts. */
  const kept = () =>
    Effect.gen(function* () {
      stops.push(yield* savedLane(home));

      if (!folding) {
        return;
      }

      const folded = yield* Effect.exit(
        seenOf(NUMBER).pipe(
          Effect.map(fold),
          Effect.provide(laneLayer({ home, checkout: seed, briefs: BRIEFS, person: "owner" }, polling)),
        ),
      );
      folds.push(Exit.isSuccess(folded) ? folded.value : `the fold failed: ${String(folded.cause)}`);
    });
  const checksDown = () =>
    checksStopRunning === "at_second_writer"
      ? codexRuns(dir).filter((run) => run.step === "tests").length > 1
      : checksStopRunning === "at_restart" && lines.includes(KILLED);
  const line = () =>
    runLane(NUMBER, (said) => Effect.sync(() => void lines.push(said))).pipe(
      Effect.updateService(MutationRunner, (runner) => ({
        ...runner,
        tests: (head) =>
          Effect.suspend(() => (checksDown() ? Effect.fail({ _tag: "could_not_run" } as const) : runner.tests(head))),
        run: (ask) =>
          Effect.suspend(() =>
            failMutation && typed === 0 ? Effect.fail({ _tag: "could_not_run" } as const) : runner.run(ask),
          ),
      })),
      // Code's own checks after a build (self-fix PR 4) go down with them: they could not run.
      Effect.updateService(CheckRunner, (checks) => ({
        ...checks,
        run: (head) =>
          Effect.suspend(() => {
            const said = checksSay?.(head, checksRan++, { dir, home, remote }) ?? null;

            if (said !== null) {
              return Effect.succeed(said);
            }

            return checksDown()
              ? Effect.succeed({
                  head,
                  commands: [{ command: "node_modules/.bin/vitest run", code: null, ms: 3 }],
                  result: "not_run" as const,
                  failed: [],
                  tail: "spawn ENOSPC",
                })
              : checks.run(head);
          }),
      })),
      // Each run of the test writer's check, kept for the test to read.
      Effect.updateService(TestsWork, (work) => ({
        ...work,
        onBase: (commit, tests) =>
          Effect.suspend(() => {
            onBase.push({ line: typed, commit, files: tests.map((test) => test.file) });

            if (failOnBase !== undefined && typed === 0 && onBase.length > failOnBaseFrom) {
              return Effect.fail({ ...failOnBase, _tag: "could_not_run" } as const);
            }

            const says = onBaseSays?.(onBase.length - 1, tests) ?? null;
            return says === null ? work.onBase(commit, tests) : Effect.succeed(says);
          }),
      })),
      Effect.updateService(Tickets, (tickets) => ({
        ...tickets,
        read: (n) =>
          Effect.andThen(
            Effect.andThen(ticketMoves(tickets, n), branchMoves(tickets, n)),
            Effect.suspend(() => {
              if (typed !== readFailsAt || readFailed) {
                return tickets
                  .read(n)
                  .pipe(
                    Effect.map((ticket) => (typed > 0 ? { ...ticket, timeline: olderThan(ticket.timeline) } : ticket)),
                  );
              }

              readFailed = true;
              return Effect.fail(
                new TicketsFailed({
                  ticket: n,
                  why: "unreachable",
                  says: "the ledger did not answer",
                }),
              );
            }),
          ),
      })),
      Effect.provide(laneLayer({ home, checkout: seed, briefs: BRIEFS, person: "owner" }, polling)),
      Effect.timeoutOption(Duration.seconds(within)),
      Effect.flatMap((ended) => (Option.isNone(ended) ? Effect.sync(() => void lines.push(TIMED_OUT)) : Effect.void)),
      (ran) =>
        leave === undefined || leave.length === 0
          ? ran
          : Effect.raceFirst(
              ran,
              Effect.andThen(
                waitingOnLeft(leave),
                Effect.sync(() => void lines.push(WAITING)),
              ),
            ),
    );
  return Effect.runPromise(
    Effect.gen(function* () {
      ledgerOf = yield* Ledger;
      yield* file(title, "Lower case, no spaces around.", writer);
      const person = yield* Effect.forkScoped(
        answering(picks, {
          ...(steps === undefined ? {} : { steps }),
          ...(notes === undefined ? {} : { notes }),
          ...(queues === undefined ? {} : { queues }),
          ...(leave === undefined ? {} : { leave }),
          ...(savedAsking === undefined ? {} : { onlyStep: SAVED_ASK }),
        }),
      );
      const run = Effect.gen(function* () {
        // The ticket's working copy, made from main as it is now, as an earlier line would leave it.
        if (treeFirst) {
          yield* Effect.gen(function* () {
            const work = yield* LaneWork;
            const { tree } = yield* work.tree(NUMBER);

            if (treeHolds !== undefined) {
              yield* work.commit(tree, treeHolds, "a commit main lacks, from an earlier line");
            }
          }).pipe(
            Effect.provide(laneLayer({ home, checkout: seed, briefs: BRIEFS, person: "owner" }, polling)),
            Effect.orDie,
          );
        }

        if (savedAsking !== undefined) {
          const first = yield* Effect.forkScoped(line());

          while (!lines.some((said) => savedAsking.at.test(said))) {
            yield* Effect.sleep("20 millis");
          }

          yield* Fiber.interrupt(first);
          lines.push(KILLED);
          yield* keptAsAsking(home, savedAsking.offers);
        }

        if (killAt !== undefined) {
          const first = yield* Effect.forkScoped(line());

          while (!lines.some((said) => said.includes(killAt))) {
            yield* Effect.sleep("20 millis");
          }

          yield* Fiber.interrupt(first);
          lines.push(KILLED);

          if (redAfterKill) {
            writeFileSync(red, "");
          }
        }

        yield* line();
        yield* kept();

        for (const { between } of again) {
          if (between !== undefined) {
            yield* between({ dir, home, remote });
          }

          typed++;
          lines.push(AGAIN);
          yield* line();
          yield* kept();
        }
      });
      // The person's fiber ends only when it fails: then the test fails with it, now.
      yield* Effect.raceFirst(run, Fiber.join(person));
      const ticket = yield* read;
      const facts = ticket.timeline.map((e) => e.fact as Ran["facts"][number]);
      const ends = facts.filter((f) => f.type === "ended");
      return {
        lines,
        stops,
        folds,
        onBase,
        facts,
        entries: ticket.timeline,
        spans: tracing?.spans ?? [],
        dir,
        remote,
        gh,
        stages: ends.map((f) => String(f.stage)),
        names: Object.fromEntries(ends.map((f) => [String(f.stage), JSON.stringify(f.outcome)] as const)),
      } satisfies Ran;
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.fresh(memoryLedger().layer)),
      Effect.provide(tracing?.layer ?? Layer.empty),
    ),
  );
};

/**
 * A lane on a repository whose `[build] send_back` is `sendBack`, stopped at its first line, and the
 * lane as it was kept then. No agent runs past the triage.
 */
export const keptAtStart = (sendBack: boolean): Promise<Lane> => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-")));
  made.push(dir);
  const { home, seed } = makeLaneHome({ dir, nodeModules: MODULES, sendBack });

  for (const [key, value] of Object.entries(fakeEnv(dir))) {
    vi.stubEnv(key, value);
  }

  const lines: string[] = [];
  return Effect.runPromise(
    Effect.gen(function* () {
      yield* file("Read names in one form", "Lower case, no spaces around.", OWNER);
      const running = yield* Effect.forkScoped(
        runLane(NUMBER, (said) => Effect.sync(() => void lines.push(said))).pipe(
          Effect.provide(laneLayer({ home, checkout: seed, briefs: BRIEFS, person: "owner" })),
        ),
      );

      while (lines.length === 0) {
        yield* Effect.sleep("20 millis");
      }

      yield* Fiber.interrupt(running);
      const handle = yield* fileStorage(join(home, "storage", "lanes")).open(`lane-${NUMBER}`, {});
      const store = handle.store("lane", `lane/${NUMBER}`, Lane);
      const saved = store.migrate(yield* Effect.promise(() => store.load()));

      if (!Schema.is(Lane)(saved)) {
        return yield* Effect.die(new Error(lines.join("\n")));
      }

      return saved;
    }).pipe(Effect.scoped, Effect.provide(Layer.fresh(memoryLedger().layer))),
  );
};

export const onMain = (remote: string, path: string): string | null => {
  try {
    return execFileSync("git", ["--git-dir", remote, "show", `main:${path}`], {
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch {
    return null;
  }
};

/** Main's tip on the remote. */
export const onMainHead = (remote: string): string =>
  execFileSync("git", ["--git-dir", remote, "rev-parse", "main"], { encoding: "utf8" }).trim();

/** Does `newer` hold `older` in its history, on the remote? */
export const descends = (remote: string, older: string, newer: string): boolean => {
  try {
    execFileSync("git", ["--git-dir", remote, "merge-base", "--is-ancestor", older, newer], {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
};

export const codexRuns = (dir: string) =>
  existsSync(join(dir, "codex.log"))
    ? readFileSync(join(dir, "codex.log"), "utf8")
        .trim()
        .split("\n")
        .map(
          (row) =>
            JSON.parse(row) as {
              readonly args: readonly string[];
              readonly folder: string;
              readonly step: string;
              readonly prompt: string;
              readonly keys: readonly string[];
              readonly rubrics: string | null;
              readonly diff: string | null;
              readonly taken: readonly string[] | null;
              readonly loaded: Readonly<Record<string, string | null>>;
              readonly seen: Readonly<Record<string, string | null>>;
              /** The commit a person pushed as this run started (`pushesAt`), or `null`. */
              readonly pushed: string | null;
            },
        )
    : [];

export const WHOLE = [
  "triage",
  "plan",
  "exam",
  "test_writer",
  "build",
  "mutation",
  "mutants",
  "review",
  "push",
  "merge",
];

// The first text of the rubric fabrika ships, and the toy repository's own on main.
export const SHIPPED_RUBRIC = "# Code review: the default rubric";
export const TOY_RUBRIC = "Code that does what its ticket says.";

export const reviewRubrics = (dir: string) => codexRuns(dir).find((r) => r.step === "review")?.rubrics;

/** `src/lower.ts` as the fake's plain builder writes it: on main already, a build changes nothing. */
export const PLAIN_LOWER = {
  path: "src/lower.ts",
  text: "export function lower(name: string): string {\n\treturn name.trim().toLowerCase();\n}\n",
};

/** A test writer's answer whose one test, in a new file, fails on main and on any build of it. */
export const FAILS_ON_MAIN = {
  with: {
    files: [
      {
        path: "src/lower-never.test.ts",
        text: 'import {expect, it} from "vitest";\nimport {lower} from "./lower.ts";\n\nit("lowers to a word no name has", () => {\n\texpect(lower("AB")).toBe("never");\n});\n',
      },
    ],
    answers: [
      {
        property: "p1",
        kind: "test",
        file: "src/lower-never.test.ts",
        name: "lowers to a word no name has",
      },
    ],
  },
};

/**
 * A test writer's answer whose one test, in a new file, passes before any build. Self-fix PR 11, row
 * 28: the first such answer goes back to the writer one time, so this is the one more try.
 */
export const PASSES_AT_ONCE = {
  with: {
    files: [
      {
        path: "src/lower-once-more.test.ts",
        text: 'import {expect, it} from "vitest";\n\nit("lowers once more", () => {\n\texpect("ab").toBe("ab");\n});\n',
      },
    ],
    answers: [{ property: "p1", kind: "test", file: "src/lower-once-more.test.ts", name: "lowers once more" }],
  },
};

export const remoteGit = (remote: string, ...args: readonly string[]) =>
  execFileSync("git", ["--git-dir", remote, ...args], { encoding: "utf8", stdio: "pipe" }).trim();

/** The head the lane pushed, as the ticket says it. Its commit stays on the remote after the branch goes. */
export const pushedHead = (ran: Ran) => String(ran.facts.find((f) => f.type === "pushed")?.head);

/** The lane as line `i` saved it, when that is a stop that kept its `Held` and where it goes on. */
export const heldAt = (ran: Ran, i: number) => {
  const stop = ran.stops[i];
  return stop?.phase === "over" && "held" in stop ? stop : null;
};

/** The fold of the ticket's facts after line `i` gives the `Held` that line saved, and misses nothing. */
export const foldsAsSaved = (ran: Ran, i: number) => {
  const stop = heldAt(ran, i);
  expect(stop, `line ${i} saved no Held`).not.toBeNull();

  if (stop === null) {
    return;
  }

  const { count, round, carry, trail } = stop.held;
  expect(ran.folds[i]).toEqual({ held: { count, round, carry, trail }, missing: [], at: stop.at });
};

/** What the line said after it was typed again. */
export const secondLine = (ran: Ran) => ran.lines.slice(ran.lines.indexOf(AGAIN) + 1).join("\n");

export const askedFor = (ran: Ran, kind: string) =>
  ran.facts.filter((f) => f.type === "asked" && String(f.ask).startsWith(`a-${kind}-`));

/** One check, finished and passed: the plainest repository with CI. */
export const PASSED_CI: GhStory = { checks: [{ name: "ci", ends: "SUCCESS" }] };

export const WRITES = ["commit_make", "ref_move", "merge_write"];

/** A lane on the stand-in. Strict: a call it does not know fails this test, whatever the test says. */
export const onGitHub = async (script: Script) => {
  const ran = await lane({ within: 50, story: PASSED_CI, ...script });

  if (ran.gh === null) {
    return expect.unreachable("no stand-in gh was played");
  }

  const calls = ran.gh.calls();
  // It really reached the stand-in: a lane that never asked proves nothing.
  expect(calls.map((call) => call.kind)).toContain("pr_create");
  expect(calls.filter((call) => call.kind === "unknown")).toEqual([]);
  const kinds = calls.map((call) => call.kind);
  return {
    ...ran,
    calls,
    kinds,
    pulls: ran.gh.pulls(),
    wrote: kinds.filter((kind) => WRITES.includes(kind)),
  };
};

/**
 * A person moved the pull request's head, with the code changed, after the lane's review (self-fix PR
 * 11, jidoka row 63): the review runs again, at that head, the person is asked again, and what merges
 * is that head, with their commit in it. Nothing the person pushed is written over.
 */
export const movedHeadLands = (ran: Awaited<ReturnType<typeof onGitHub>>) => {
  const said = ran.lines.join("\n");
  expect(ran.names.merge, said).toContain("done");
  expect(
    codexRuns(ran.dir).filter((r) => r.step === "review"),
    said,
  ).toHaveLength(2);
  expect(askedFor(ran, "merge")).toHaveLength(2);
  const merged = ran.pulls[0]?.mergedHead ?? "nothing merged";
  expect(merged).not.toBe(pushedHead(ran));
  expect(remoteGit(ran.remote, "log", "--format=%s", "main")).toContain("A person pushed one more commit.");
  expect(ran.pulls[0]?.comments.map((c) => c.body.split("\n")[0]).join("\n")).toContain(
    `review-code: PASS @ ${merged}`,
  );
  expect(ran.lines.at(-1)).toContain("ended: done");
};

// For the tests under "a stopped lane, typed again".

/** A git command in the lane's own clone, where every commit it made is kept. */
export const inClone = (ran: Ran, ...args: readonly string[]) =>
  execFileSync("git", ["-C", join(ran.dir, "home", "work", "clone"), ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();

/** Whether `commit`'s tree holds `path`. */
export const holds = (ran: Ran, commit: string, path: string) => {
  try {
    inClone(ran, "cat-file", "-e", `${commit}:${path}`);
    return true;
  } catch {
    return false;
  }
};

/** The files `commit` changed from its first parent. */
export const changedBy = (ran: Ran, commit: string) =>
  inClone(ran, "diff-tree", "--no-commit-id", "--name-only", "-r", commit).split("\n");

/** The round each run of `stage` started in. */
export const roundsOf = (ran: Ran, stage: string) =>
  ran.facts.filter((f) => f.type === "started" && f.stage === stage).map((f) => Number(f.round ?? 1));

export const moveMain = (where: Where) =>
  Effect.sync(() => pushToMain(where, [{ path: "docs/elsewhere.md", text: "Written elsewhere.\n" }]));

/** The ticket's first `restarted` fact. */
export const restartOf = (ran: Ran) => ran.facts.find((f) => f.type === "restarted");

/** The head the lane's last end before its restart left: where the branch stood as it stopped. */
export const headBefore = (ran: Ran) => {
  const at = ran.facts.findIndex((f) => f.type === "restarted");
  const heads = ran.facts
    .slice(0, at)
    .filter((f) => f.type === "ended")
    .flatMap((f) => {
      const kept = Schema.decodeUnknownOption(Schema.Struct({ head: Schema.String }))(f.carry);
      return Option.isSome(kept) ? [kept.value.head] : [];
    });
  return heads.at(-1);
};

/** What a builder leaves in the test writer's file, in its first build only. */
export const TOUCHED = 'import {it} from "vitest";\n\nit("lowers capitals", () => {});\n';

/** The test writer's file written again: red without `lower`, green with the builder's. */
const REDONE =
  'import {expect, it} from "vitest";\nimport {lower} from "./lower.ts";\n\nit("lowers capitals", () => {\n\texpect(lower("AB")).toBe("ab");\n\texpect(lower("Ab")).toBe("ab");\n});\n';

export const REDONE_MARK = 'lower("Ab")';

/** A test writer's run that writes `REDONE`, and nothing else. */
export const WRITES_REDONE = {
  with: {
    files: [{ path: "src/lower.test.ts", text: REDONE }],
    answers: [{ property: "p1", kind: "test", file: "src/lower.test.ts", name: "lowers capitals" }],
  },
};

/** The second test writer's run writes `REDONE`, and nothing else. */
export const REDO = { tests: [null, WRITES_REDONE] };
export const SEE = ["src/lower.ts", "src/lower.test.ts"];

// For the tests under "a lane, on what the real agents answered".

export const runsOf = (ran: Ran, step: string) => codexRuns(ran.dir).filter((r) => r.step === step);
export const THE_PLANS_NO = { approve: "no" };

export const commentsOf = (ran: Ran) => ran.facts.filter((f) => f.type === "commented").map((f) => String(f.body));

export const REAL_LEAN =
  "Use Unicode compatibility decomposition and remove combining marks. This gives Çay Şeker → cay-seker and ﬂower → flower, but Straße → stra-e.";

export const REAL_QUESTION = {
  ask: "How broadly should non-ASCII letters fold into ASCII?",
  options: [
    "Use Unicode compatibility decomposition and remove combining marks; remaining non-ASCII characters separate words.",
    "Also support an explicitly agreed transliteration table for letters such as ß, æ and ø.",
  ],
  lean: REAL_LEAN,
  why: "“When they can” does not define a complete folding policy. The folding property, unsupported-character property and documentation criterion depend on this choice.",
  cost: "The lean gives bounded behavior without a maintained mapping table; broader transliteration needs an agreed character set and additional examples.",
  sure: 75,
  doubt: "Confirm whether titles containing letters such as ß, æ and ø must retain their usual transliterations.",
};

export const REAL_P1 = {
  when: "The three publication titles are converted",
  result: "Their slugs are respectively “hello-world”, “cay-seker” and an empty string.",
  why: "This is the author’s first useful workflow; it fails today because the slug helper does not exist.",
  behavior: "new",
  tool: "test",
  code: [],
};

export const REAL_P2 = {
  when: "Nonempty ASCII letter-and-digit words are joined by spaces and converted",
  result:
    "The slug is exactly the original words lowercased and joined by one hyphen, preserving every digit and letter in order.",
  why: "Dropping usable content would change the title’s meaning in its URL; the new helper is absent today.",
  behavior: "new",
  tool: "test",
  code: [],
};

/** Why the real test writer said it could not test p1. */
export const REAL_CANNOT =
  "The three publication title inputs are unspecified. The linked issue was unreachable, and clarification has not arrived. Guessing inputs would not test the promised examples.";

/** Why the real mutants' writer said it could not kill a mutant. */
export const REAL_MUTANT =
  "Both regexes globally remove every Unicode combining mark. The original deletes each consecutive run; the mutant deletes each mark individually. No observable behavior changes.";

export const P1_CANNOT = {
  tests: [
    {
      with: {
        answers: [
          { property: "p1", kind: "cannot", why: REAL_CANNOT },
          { property: "p2", kind: "test", file: "src/lower.test.ts", name: "lowers capitals" },
        ],
      },
    },
  ],
};

// For the tests under "a lane, on what the real agents answered > what a person is asked".

/** All a person has in front of them at one question: what its step wrote since it began, and the question. */
export const readBy = (ran: Ran, prefix: string) => {
  const at = ran.facts.findIndex((f) => f.type === "asked" && String(f.ask).startsWith(prefix));
  const asked = ran.facts[at];
  const from = ran.facts.slice(0, at).findLastIndex((f) => f.type === "started");
  const next = ran.facts.findIndex((f, i) => i > at && f.type === "answered");
  const said = ran.facts
    .slice(from, next < 0 ? undefined : next)
    .filter((f) => f.type === "commented")
    .map((f) => String(f.body));
  const what = String(asked?.what);
  const picks = Array.isArray(asked?.picks) ? asked.picks.map(String) : [];
  return { what, picks, text: [...said, what].join("\n") };
};

/** A line that names the pick, and says more than the pick. */
const explained = (text: string, pick: string) => {
  const name = new RegExp(`(^|[^a-z_])${pick.replace("_", "[ _]")}([^a-z_]|$)`, "i");
  return text.split("\n").some((line) => name.test(line) && line.trim().split(/\s+/).length > 4);
};

export const reads = (ran: Ran, prefix: string, words: readonly string[]) => {
  const { what, picks, text } = readBy(ran, prefix);
  expect(picks.length).toBeGreaterThan(0);
  expect(picks.length).toBeLessThanOrEqual(3);
  expect(words.filter((word) => !text.includes(word))).toEqual([]);
  expect(picks.filter((pick) => !explained(text, pick))).toEqual([]);
  expect(text).not.toContain("ask:owner");
  // The question itself is in words: no step's name or outcome's name as code.
  expect(what.match(/\b[a-z]+_[a-z_]+\b|\w+:\w+:\w+/g) ?? []).toEqual([]);
};

// For the tests under "a lane, on what the real agents answered > what a person is asked > what a person decided at the plan".

export const RUN3_LEAN = "Fold decomposable accents; treat remaining non-ASCII characters as word separators.";

export const RUN3_QUESTION = {
  ask: "How broadly should letters fold when Unicode accent decomposition does not produce ASCII, such as ß, ø, and ł?",
  options: [RUN3_LEAN, "Also support an agreed transliteration table, such as ß → ss, ø → o, and ł → l."],
  lean: RUN3_LEAN,
  why: "The ticket specifies Ç and Ş but does not define broader transliteration. The remaining-non-ASCII property depends on this choice; the accent-folding property defines the minimum supported folding.",
  cost: "The lean gives 'Straße' → 'stra-e'. Broader transliteration needs an explicit supported mapping and additional examples.",
  sure: 75,
  doubt: "Expected slugs for 'Straße', 'smør', and 'Łódź' would settle the intended scope.",
};

export const RUN3_FINDING = {
  kind: "review-code",
  from: { source: "check", name: "tests-prove-it" },
  fault:
    "Folding handles only canonical accents, losing other non-ASCII letters that have plain ASCII forms. Tests omit compatibility letters and explicitly require losing common letters such as ł and ø, so green checks preserve this ticket violation.",
  at: { file: "src/lower.ts", first: 2, last: 2 },
  proof:
    "Direct execution returned 'o-ce' for 'oﬃce', 'width' for 'Ｆｕｌｌ Width', and 'odz' for 'Łódź', rather than 'office', 'full-width', and 'lodz'.",
  wants:
    "Letters with plain ASCII forms survive folding, including these examples, and regression tests require their preservation instead of their loss.",
  seen: "ran",
};

/** The same finding, as a reviewer told of q1 marks it. */
export const AGAINST_Q1 = { ...RUN3_FINDING, from: { source: "decision", id: "q1" } };

export const OTHER_FINDING = {
  ...RUN3_FINDING,
  from: { source: "check", name: "bugs-a-person-would-hit" },
  fault: "An empty name comes back as a space.",
  proof: "Read from the code.",
  wants: "An empty name comes back empty.",
  seen: "read",
};

export const RUN3_NAME = "p1: preserves letters with plain ASCII forms, including ł and ø";

export const RUN3_ROUND_2 = {
  with: {
    files: [
      {
        path: "src/slug.folding.test.ts",
        text: `import {expect, it} from "vitest";\nimport {lower} from "./lower.ts";\n\nit(${JSON.stringify(RUN3_NAME)}, () => {\n\texpect(lower("Straße")).toBe("strasse");\n});\n`,
      },
    ],
    answers: [{ property: "p1", kind: "test", file: "src/slug.folding.test.ts", name: RUN3_NAME }],
    plants: [],
    gaps: [
      "Existing p5 and p6 tests in src/slug.test.ts require losing foldable letters, contradicting p1. They remain untouched. Passing both sets requires resolving that conflict.",
    ],
  },
};

const RUN3_LEFT =
  "Blocked by contradictory protected tests: src/slug.test.ts requires Straße → stra-e and discards ł, ø, æ, and œ; src/slug.folding.test.ts requires Straße → strasse and preserves those letters. The exam owner must reconcile these expectations before implementation can satisfy every check.";

export const NO_CHANGE = {
  with: {
    summary:
      "Reproduced the folding defect: Łódź produces odz instead of lodz. No files changed because the protected tests require contradictory behavior.",
    ran: [{ command: "node_modules/.bin/vitest run", passed: false }],
    left: [RUN3_LEFT],
  },
};

export const THE_LEAN = { plan: [{ with: { questions: [RUN3_QUESTION] } }] };

export const found = (...findings: readonly unknown[]) => ({ with: { findings } });

/** Run 3 as it went: the finding is not marked, and the builder changes nothing in round 2. */
export const RUN_3: FakeScript = {
  answers: {
    ...THE_LEAN,
    review: [found(RUN3_FINDING)],
    tests: [null, RUN3_ROUND_2],
    build: [null, NO_CHANGE],
  },
};

export const bye = (ran: Ran) => ran.lines.at(-1) ?? "";

export const answeredWith = (ran: Ran, pick: string) =>
  ran.facts.filter((f) => f.type === "answered" && f.pick === pick);

/** What makes round 2's test pass: a build's change to the file round 1's build wrote. */
export const FOLDS = {
  path: "src/lower.ts",
  text: 'export function lower(name: string): string {\n\treturn name.trim().toLowerCase().replaceAll("ß", "ss");\n}\n',
};

// For the tests under "the exam's pull request".

export const RULES = "[rules] Read names in one form";
export const RULE = ".oxlintrc.json";

export const FAULT = "The rules list is not empty: it turns on a rule the plan never named.";

/** A review of the exam's pull request that fails its one criterion, with the finding it rests on. */
export const FAILS_E1 = {
  with: {
    rows: [{ id: "e1", grade: "fail", where: [{ file: RULE, first: 1, last: 1 }], says: FAULT }],
    findings: [
      {
        kind: "review-code",
        from: { source: "criterion", id: "e1" },
        fault: FAULT,
        at: { file: RULE, first: 1, last: 1 },
        proof: "Read from the file.",
        wants: "The rules list is empty, as the plan says.",
        seen: "read",
      },
    ],
    skipped: [],
  },
};

export const exams = (ran: Ran) => codexRuns(ran.dir).filter((r) => r.step === "exam");

/** Where in the facts the first end of `stage` is, or -1. */
export const endOf = (ran: Ran, stage: string) => ran.facts.findIndex((f) => f.type === "ended" && f.stage === stage);

// What the real exam writer reads first is the filled brief, `briefs/exam.md` (agents.ts
// `promptFor`): the fake logs it as `prompt`. On a redo written on main, that text must say so.
export const MAIN_RULE = '{"main": 1}\n';

/** Main changes the rule file under the exam review's checks, the lane's first, once. */
export const mainTakesTheRule: NonNullable<Script["checksSay"]> = (_head, nth, where) => {
  if (nth === 0) {
    pushToMain(where, [{ path: RULE, text: MAIN_RULE }]);
  }

  return null;
};

/** The head an exam step's `ended` fact carries for the exam's pull request. */
export const pullHead = (fact: Ran["facts"][number] | undefined) =>
  (fact?.carry as { readonly examPull?: { readonly head: string } } | undefined)?.examPull?.head ?? "";

/** The lines on the ticket that name a kept ref. */
export const keptLines = (ran: Ran) =>
  ran.facts.filter((f) => f.type === "commented" && String(f.body).includes("refs/kept/")).map((f) => String(f.body));

/** The kept ref a line names. */
export const refIn = (line: string) => /refs\/kept\/[^\s`'"]*[^\s`'".,;:)]/.exec(line)?.[0] ?? "";

/** Where a kept ref may be: the lane's own clone, or the remote. */
export const keptPlaces = (ran: Ran) => [
  ["-C", join(ran.dir, "home", "work", "clone")],
  ["--git-dir", ran.remote],
];
