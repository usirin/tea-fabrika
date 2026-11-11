// gcloop.ts: the box garbage collection loop (decision 0101). Today's lead tooling, run on our own
// laptop; it is not product.
//
//   node gcloop.ts sweep [--trigger timer|merge|hand]   one sweep: `box.sh gc` under nice, then one record
//   node gcloop.ts kick --trigger merge                 start a sweep in the background and return at once
//   node gcloop.ts status [--keeps]                     one plain line: when it last swept, how it ended
//   node gcloop.ts plist                                the timer's launchd unit, filled in for this laptop
//
// No step's start runs or waits for `box.sh gc` any more. A launchd timer starts a sweep every
// period (`GC_MINUTES`, default 30), and the catch-up script kicks one after each merge. Like the kubelet's
// garbage collection, which runs on its own loop and never inside "start a pod".
//
//   a sweep starts       it takes BOXES/state/gc.lock; one is held by a live process: it records
//                        `skipped` and exits 0 at once, so two sweeps never overlap
//   gc runs              `nice -n 15 sh box.sh gc`, for at most one period; what gc removes is gc.ts's
//                        business and does not change here
//   it ends              one line in BOXES/state/gc.jsonl, ok, failed or skipped alike: when it
//                        started and ended, what it removed and kept, the MB gc freed, the free space
//                        before and after; then the lock goes
//   status               the newest sweep that ran (not a skipped one), and `LATE` when it started
//                        more than two periods ago, or none is recorded
//
// Existing tools looked at for the timer (decision 0040):
//   - launchd, a user LaunchAgent with StartInterval
//     (https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html):
//     used. It is macOS's own scheduler, runs a missed interval once on wake, never starts a job
//     that is still running, and `launchctl list` and `launchctl bootout` list and stop it.
//   - cron (https://man.freebsd.org/cgi/man.cgi?crontab(5)): Apple marks it deprecated in favor of
//     launchd, and a run due while the laptop sleeps is lost.
//   - a long-running process on Effect's Schedule (https://effect.website/docs/scheduling/introduction/):
//     something must still start it at login and restart it when it dies, which is launchd again,
//     and a dead loop says nothing.
//   - GitHub scheduled workflows
//     (https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule):
//     a CI runner cannot see this laptop's boxes.
// The repo had no laptop timer before this: the hourly mutation run is a CI workflow a person or a
// session dispatches by hand (.github/workflows/mutation.yaml).

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  Config,
  Console,
  DateTime,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Option,
  Path,
  Predicate,
  Result,
  Schema,
  Stream,
} from "effect";
import { Command, Flag } from "effect/cli";
import { ChildProcess } from "effect/process";
import { spoken } from "./flow/Beat.ts";

// ---------------------------------------------------------------- the setting

/** Minutes between two timer sweeps (0069: a choice is a setting). From the environment, so
 * env.sh's way of setting a lead value from outside works here too; launchd's unit carries it. */
export const MINUTES = Config.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)), "GC_MINUTES").pipe(
  Config.withDefault(30),
);

/** The launchd job's name. */
export const LABEL = "local.tea-fabrika.gc";

// ---------------------------------------------------------------- the record

export const TRIGGERS = ["timer", "merge", "hand"] as const;

export const Outcome = Schema.TaggedUnion({
  ok: {},
  failed: { reason: Schema.String },
  skipped: { reason: Schema.String },
});
export type Outcome = typeof Outcome.Type;

/** What one sweep removed, read from gc's own lines. */
export const Removed = Schema.Struct({
  boxes: Schema.Array(Schema.String),
  worktrees: Schema.Array(Schema.String),
  /** `state/<box>.box` files whose box was gone. */
  facts: Schema.Array(Schema.String),
});
export type Removed = typeof Removed.Type;

/** One sweep, as BOXES/state/gc.jsonl keeps it: one line each, never rewritten. */
export const Sweep = Schema.Struct({
  startedAt: Schema.String,
  endedAt: Schema.String,
  ms: Schema.Number,
  trigger: Schema.Literals(TRIGGERS),
  /** The period this sweep ran under, in minutes. */
  minutes: Schema.Number,
  pid: Schema.Number,
  outcome: Outcome,
  /** gc's exit code; `null` when it did not end on its own (skipped, timed out, could not start). */
  code: Schema.NullOr(Schema.Number),
  removed: Removed,
  /** Each folder gc kept, with its reason, as gc printed it. */
  kept: Schema.Array(Schema.String),
  /** Folders gc looked at: the ones it removed and the ones it kept. */
  seen: Schema.Number,
  freedMb: Schema.Number,
  /** KB free on the boxes' volume before and after, from df; `null` when df said nothing. */
  freeKb: Schema.Struct({ before: Schema.NullOr(Schema.Number), after: Schema.NullOr(Schema.Number) }),
  /** mutbox's line when its Docker sweep was stopped at its time limit. */
  mutbox: Schema.NullOr(Schema.String),
});
export type Sweep = typeof Sweep.Type;

const SweepLine = Schema.fromJsonString(Sweep);

/** What gc printed, read: what it removed and kept, and the MB it freed. */
export const readOutput = (text: string) => {
  const boxes: string[] = [];
  const worktrees: string[] = [];
  const facts: string[] = [];
  const kept: string[] = [];
  let freedMb = 0;
  let mutbox: string | null = null;

  for (const line of text.split("\n")) {
    const fact = /^removed state\/(.+): its box is gone$/.exec(line);
    const tree = /^removed worktree (.+): [a-z_]+, (\d+) MB$/.exec(line);
    const box = /^removed ([^\s:/]+): .+, (\d+) MB$/.exec(line);

    if (line.startsWith("keep ")) {
      kept.push(line.slice("keep ".length));
    } else if (line.startsWith("mutbox gc: stopped")) {
      mutbox = line;
    } else if (fact?.[1] !== undefined) {
      facts.push(fact[1]);
    } else if (tree?.[1] !== undefined) {
      worktrees.push(tree[1]);
      freedMb += Number(tree[2]);
    } else if (box?.[1] !== undefined) {
      boxes.push(box[1]);
      freedMb += Number(box[2]);
    }
  }

  return {
    removed: Removed.make({ boxes, worktrees, facts }),
    kept,
    seen: boxes.length + worktrees.length + kept.length,
    freedMb,
    mutbox,
  };
};

const NOTHING = readOutput("");

// ---------------------------------------------------------------- the status line

/** The newest sweep that ran, and how many were skipped after it. */
export const newest = (sweeps: ReadonlyArray<Sweep>) => {
  const at = sweeps.findLastIndex((s) => s.outcome._tag !== "skipped");
  return { last: at < 0 ? null : (sweeps[at] ?? null), skipped: sweeps.length - 1 - at };
};

/** Late: no sweep ran yet, or the newest one started more than two periods before `now`. */
export const late = (last: Sweep | null, now: number, minutes: number): boolean =>
  last === null || now - Date.parse(last.startedAt) > 2 * minutes * 60_000;

const ended = (s: Sweep): string => {
  const took = spoken(s.ms);

  if (s.outcome._tag === "failed") {
    return `failed in ${took}: ${s.outcome.reason}`;
  }

  const r = s.removed;
  const trees = r.worktrees.length === 1 ? "1 worktree" : `${r.worktrees.length} worktrees`;
  return `ok in ${took}, removed ${r.boxes.length} boxes and ${trees}, ${s.freedMb} MB; kept ${s.kept.length}`;
};

/** Who holds the lock, as it says of itself. */
export const Holder = Schema.Struct({ pid: Schema.Number, startedAt: Schema.String });
export type Holder = typeof Holder.Type;

const HolderText = Schema.fromJsonString(Holder);

/** The one line a person reads: when the loop last swept, how that ended, and LATE when it is. */
export const says = (
  sweeps: ReadonlyArray<Sweep>,
  now: number,
  minutes: number,
  going: Holder | null = null,
): { late: boolean; text: string } => {
  const { last, skipped } = newest(sweeps);
  const isLate = late(last, now, minutes);
  const head = isLate ? "gc: LATE: " : "gc: ";
  const body =
    last === null
      ? "no sweep recorded"
      : `last swept ${spoken(now - Date.parse(last.startedAt))} ago (${last.trigger}), ${ended(last)}`;
  const tail = [
    `every ${minutes}m`,
    ...(skipped > 0 ? [`${skipped} skipped since`] : []),
    ...(going === null ? [] : [`one going for ${spoken(now - Date.parse(going.startedAt))} (pid ${going.pid})`]),
  ];
  return { late: isLate, text: `${head}${body}; ${tail.join("; ")}` };
};

// ---------------------------------------------------------------- the timer's unit

const xml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** The unit file with this laptop's values, XML-escaped, in place of its `{{name}}` marks; a mark
 * with no value is a failure that names it. */
export const fill = (template: string, values: Readonly<Record<string, string>>): Result.Result<string, string> => {
  const missing = new Set<string>();
  const filled = template.replaceAll(/\{\{([a-z]+)\}\}/g, (mark, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;

    if (value === undefined) {
      missing.add(mark);
      return mark;
    }

    return xml(value);
  });
  return missing.size === 0
    ? Result.succeed(filled)
    : Result.fail(`the unit file has no value for ${[...missing].join(", ")}`);
};

// ---------------------------------------------------------------- the world

/** The loop could not do its own part: the env, the record or the unit file. */
export class Broken extends Schema.TaggedError<Broken>()("Broken", { reason: Schema.String }) {}

/** One command run to its end: its exit code, stdout and stderr. */
const exec = Effect.fn("gcloop.exec")(function* (command: string, args: ReadonlyArray<string>) {
  const handle = yield* ChildProcess.make(command, args, { forceKillAfter: Duration.seconds(10) });
  const [out, err, code] = yield* Effect.all(
    [
      Stream.mkString(Stream.decodeText(handle.stdout)),
      Stream.mkString(Stream.decodeText(handle.stderr)),
      handle.exitCode,
    ],
    { concurrency: 3 },
  );
  return { code: Number(code), out, err };
}, Effect.scoped);

/** MAIN and BOXES from env.sh, as every lead script finds them. */
const paths = Effect.fn("gcloop.paths")(
  function* () {
    const path = yield* Path.Path;
    const env = path.join(import.meta.dirname, "env.sh");
    const r = yield* exec("sh", ["-c", '. "$0" && printf "%s\\n%s" "$MAIN" "$BOXES"', env]);
    const [main = "", boxes = ""] = r.out.split("\n");
    return r.code === 0 && main !== "" && boxes !== ""
      ? { main, boxes, state: path.join(boxes, "state") }
      : yield* new Broken({ reason: `env.sh gave no MAIN or BOXES: ${r.err.trim()}` });
  },
  Effect.catchTag("PlatformError", () => Effect.fail(new Broken({ reason: "env.sh could not run" }))),
);

/** KB free on the volume that holds `path`, from `df -k`; `null` when df says nothing usable. */
const freeKb = Effect.fn("gcloop.freeKb")(
  function* (path: string) {
    const r = yield* exec("df", ["-k", path]);
    const kb = Number(r.out.trim().split("\n").at(-1)?.trim().split(/\s+/)[3]);
    return r.code === 0 && Number.isFinite(kb) ? kb : null;
  },
  Effect.catch(() => Effect.succeed(null)),
);

const alive = (pid: number) =>
  Effect.try({ try: () => process.kill(pid, 0), catch: (e) => e }).pipe(
    Effect.as(true),
    // EPERM: the process exists and is someone else's.
    Effect.catch((e) => Effect.succeed(Predicate.hasProperty(e, "code") && e.code === "EPERM")),
  );

/** A holder counts while its process lives and its lock is younger than `stale`: a pid the system
 * gave to another process later must not hold the lock for good. */
const live = Effect.fn("gcloop.live")(function* (holder: Holder, now: Holder, stale: Duration.Duration) {
  const age = Date.parse(now.startedAt) - Date.parse(holder.startedAt);
  return age < Duration.toMillis(stale) && (yield* alive(holder.pid));
});

const readHolder = Effect.fn("gcloop.readHolder")(function* (lock: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(lock).pipe(Effect.catch(() => Effect.succeed("")));
  return Schema.decodeUnknownOption(HolderText)(text);
});

const sameHolder = (a: Option.Option<Holder>, b: Option.Option<Holder>): boolean =>
  Option.isNone(a) || Option.isNone(b)
    ? Option.isNone(a) && Option.isNone(b)
    : a.value.pid === b.value.pid && a.value.startedAt === b.value.startedAt;

/**
 * Take the lock: `null` when this sweep has it, else who holds it (`none` when the file does not
 * say). The lock is written whole beside its place and linked in, so no reader sees half of it,
 * and a link fails while one is there. A lock whose holder is dead (a sweep killed with SIGKILL
 * runs no finalizer, 0061) or that does not read is moved aside and taken, once. When what moved
 * is not what was read, another sweep took it first: it goes back, and this sweep skips.
 */
const take = Effect.fn("gcloop.take")(function* (lock: string, me: Holder, stale: Duration.Duration) {
  const fs = yield* FileSystem.FileSystem;
  const mine = `${lock}.${me.pid}`;
  yield* fs.writeFileString(mine, Schema.encodeSync(HolderText)(me));
  const link = fs.link(mine, lock).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );
  const held = Effect.fn("gcloop.held")(function* () {
    if (yield* link) {
      return null;
    }

    const holder = yield* readHolder(lock);

    if (Option.isSome(holder) && (yield* live(holder.value, me, stale))) {
      return holder;
    }

    const aside = `${lock}.dead.${me.pid}`;
    const moved = yield* fs.rename(lock, aside).pipe(
      Effect.as(true),
      Effect.catch(() => Effect.succeed(false)),
    );

    if (moved) {
      const was = yield* readHolder(aside);

      if (!sameHolder(was, holder)) {
        yield* fs.link(aside, lock).pipe(Effect.ignore);
        yield* fs.remove(aside, { force: true }).pipe(Effect.ignore);
        return was;
      }

      yield* fs.remove(aside, { force: true }).pipe(Effect.ignore);
    }

    return (yield* link) ? null : yield* readHolder(lock);
  });
  return yield* held().pipe(Effect.ensuring(fs.remove(mine, { force: true }).pipe(Effect.ignore)));
});

/** Give the lock back, only while it is still this sweep's. */
const give = Effect.fn("gcloop.give")(function* (lock: string, me: Holder) {
  const fs = yield* FileSystem.FileSystem;
  const holder = yield* readHolder(lock);

  if (Option.isSome(holder) && holder.value.pid === me.pid && holder.value.startedAt === me.startedAt) {
    yield* fs.remove(lock, { force: true }).pipe(Effect.ignore);
  }
});

/** The lock for one sweep, in a scope: `null` when this sweep holds it, else who does. A lock older
 * than `stale` is taken over whoever wrote it. */
export const lock = (state: string, me: Holder, stale: Duration.Duration) =>
  Effect.acquireRelease(take(`${state}/gc.lock`, me, stale), (holder) =>
    holder === null ? give(`${state}/gc.lock`, me) : Effect.void,
  );

/** What one sweep needs: where the records go, the command that sweeps, and its period. */
export interface Ask {
  readonly state: string;
  readonly gc: ReadonlyArray<string>;
  readonly trigger: (typeof TRIGGERS)[number];
  readonly minutes: number;
  /** How long gc may run before it is stopped: one period on the timer. */
  readonly limit: Duration.Duration;
  readonly pid: number;
}

const append = Effect.fn("gcloop.append")(
  function* (state: string, sweep: Sweep) {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(state, { recursive: true });
    yield* fs.writeFileString(`${state}/gc.jsonl`, `${Schema.encodeSync(SweepLine)(sweep)}\n`, { flag: "a" });
  },
  Effect.mapError((e) => new Broken({ reason: `the record could not be written: ${e.message}` })),
);

/** One sweep, start to record. It never fails for gc's sake: a gc that fails or hangs is a record. */
export const sweep = Effect.fn("gcloop.sweep")(function* (ask: Ask) {
  const fs = yield* FileSystem.FileSystem;
  const started = yield* DateTime.now;
  const me = Holder.make({ pid: ask.pid, startedAt: DateTime.formatIso(started) });
  yield* fs.makeDirectory(ask.state, { recursive: true }).pipe(Effect.ignore);

  const record = Effect.fn("gcloop.record")(function* (
    outcome: Outcome,
    code: number | null,
    read: ReturnType<typeof readOutput>,
    before: number | null,
    after: number | null,
  ) {
    const now = yield* DateTime.now;
    const done = Sweep.make({
      startedAt: me.startedAt,
      endedAt: DateTime.formatIso(now),
      ms: DateTime.toEpochMillis(now) - DateTime.toEpochMillis(started),
      trigger: ask.trigger,
      minutes: ask.minutes,
      pid: ask.pid,
      outcome,
      code,
      ...read,
      freeKb: { before, after },
    });
    yield* append(ask.state, done);
    return done;
  });

  return yield* Effect.scoped(
    Effect.gen(function* () {
      // A sweep is stopped after one period, so a lock older than two is a dead one's.
      const holder = yield* lock(ask.state, me, Duration.minutes(2 * ask.minutes));

      if (holder !== null) {
        const reason = Option.match(holder, {
          onNone: () => "a sweep is going",
          onSome: (h) => `a sweep is going (pid ${h.pid}, since ${h.startedAt})`,
        });
        return yield* record(Outcome.cases.skipped.make({ reason }), null, NOTHING, null, null);
      }

      const before = yield* freeKb(ask.state);
      const [command = "true", ...args] = ask.gc;
      const ran = yield* exec(command, args).pipe(Effect.timeoutOption(ask.limit), Effect.exit);
      const after = yield* freeKb(ask.state);

      if (Exit.isFailure(ran)) {
        const reason = `${command} could not run`;
        return yield* record(Outcome.cases.failed.make({ reason }), null, NOTHING, before, after);
      }

      if (Option.isNone(ran.value)) {
        const reason = `stopped after ${spoken(Duration.toMillis(ask.limit))}; the next sweep goes on`;
        return yield* record(Outcome.cases.failed.make({ reason }), null, NOTHING, before, after);
      }

      const { code, out, err } = ran.value.value;
      const read = readOutput(out);
      const said = err.trim().split("\n").at(-1)?.slice(-300) ?? "";
      const outcome =
        code === 0
          ? Outcome.cases.ok.make({})
          : Outcome.cases.failed.make({ reason: `box.sh gc exited ${code}${said === "" ? "" : `: ${said}`}` });
      return yield* record(outcome, code, read, before, after);
    }),
  );
});

/** Every sweep recorded, oldest first; a line that does not read as one is left out. */
export const sweeps = Effect.fn("gcloop.sweeps")(function* (state: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(`${state}/gc.jsonl`).pipe(Effect.catch(() => Effect.succeed("")));
  return text.split("\n").flatMap((line) => Option.toArray(Schema.decodeUnknownOption(SweepLine)(line)));
});

/** The status line now, with the live holder of the lock if a sweep is going. */
export const status = Effect.fn("gcloop.status")(function* (state: string, minutes: number) {
  const holder = yield* readHolder(`${state}/gc.lock`);
  const going = Option.isSome(holder) && (yield* alive(holder.value.pid)) ? holder.value : null;
  const now = DateTime.toEpochMillis(yield* DateTime.now);
  return says(yield* sweeps(state), now, minutes, going);
});

// ---------------------------------------------------------------- the commands

const trigger = Flag.Literals("trigger", TRIGGERS).pipe(Flag.withDefault("hand" as const));

const sweepCommand = Command.make("sweep", { trigger }, ({ trigger }) =>
  Effect.gen(function* () {
    const where = yield* paths();
    const path = yield* Path.Path;
    const minutes = yield* MINUTES;
    yield* sweep({
      state: where.state,
      gc: ["nice", "-n", "15", "sh", path.join(import.meta.dirname, "box.sh"), "gc"],
      trigger,
      minutes,
      limit: Duration.minutes(minutes),
      pid: process.pid,
    });
    yield* Console.log((yield* status(where.state, minutes)).text);
  }),
);

// The sweep outlives this command: `sh` puts it in the background with nothing tied to the caller's
// output, then ends, so a merge's own exit never waits on the cleanup.
const kickCommand = Command.make("kick", { trigger }, ({ trigger }) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const script = path.join(import.meta.dirname, "gcloop.ts");
    const r = yield* exec("sh", [
      "-c",
      'nohup "$0" "$1" sweep --trigger "$2" </dev/null >/dev/null 2>&1 &',
      process.execPath,
      script,
      trigger,
    ]);
    yield* Console.log(r.code === 0 ? `gc: sweep started (${trigger})` : `gc: no sweep started: ${r.err.trim()}`);
  }),
);

const statusCommand = Command.make(
  "status",
  { keeps: Flag.Boolean("keeps").pipe(Flag.withDefault(false)) },
  ({ keeps }) =>
    Effect.gen(function* () {
      const where = yield* paths();
      const line = yield* status(where.state, yield* MINUTES);
      const last = newest(yield* sweeps(where.state)).last;
      const kept = keeps && last !== null && last.kept.length > 0 ? `; it kept ${last.kept.join("; ")}` : "";
      yield* Console.log(`${line.text}${kept}`);
    }),
);

const plistCommand = Command.make("plist", {}, () =>
  Effect.gen(function* () {
    const where = yield* paths();
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const minutes = yield* MINUTES;
    const template = yield* fs.readFileString(path.join(import.meta.dirname, "..", "gc.plist"));
    const filled = fill(template, {
      label: LABEL,
      node: process.execPath,
      script: path.join(where.main, ".agents/skills/lead/scripts/gcloop.ts"),
      main: where.main,
      minutes: String(minutes),
      seconds: String(minutes * 60),
      path: process.env.PATH ?? "/usr/bin:/bin",
      log: path.join(where.state, "gc-timer.log"),
    });

    if (Result.isFailure(filled)) {
      return yield* new Broken({ reason: filled.failure });
    }

    yield* Console.log(filled.success.trimEnd());
  }),
);

const gcloop = Command.make("gcloop").pipe(
  Command.withSubcommands([sweepCommand, kickCommand, statusCommand, plistCommand]),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(gcloop, { version: "0.0.0" })(process.argv.slice(2)).pipe(
      Effect.tapError((e) => (Predicate.isTagged(e, "Broken") ? Console.error(`gc: ${e.reason}`) : Effect.void)),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
