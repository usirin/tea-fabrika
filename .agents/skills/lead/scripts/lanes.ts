// lanes.ts: what each lane is doing now, one JSON line a lane. It is the reader of the heartbeat
// chain.ts keeps (./flow/Beat.ts, ticket 685). Today's lead tooling, run on our own laptop; it is
// not product. It only reads: no lane, box or process is touched.
//
//   node lanes.ts                 every lane with a chain record that is not queued or landed
//   node lanes.ts --all           the queued and landed ones too
//   node lanes.ts t843 mq1        only these lanes
//
//   {"lane":"t843","state":"running","step":"tests","box":"t843-tests8","phase":"agent",
//    "quietSeconds":12,"since":"2026-11-12T14:01:16.812Z","text":"agent for 5m, last agent output 13s ago"}
//
// What it reads for a lane, all under BOXES:
//   state/<lane>-chain.json   the chain record: its steps, when it landed, and the beat while a
//                             chain runs (chain.ts clears the beat when the lane ends)
//   state/<lane>.lock         there while a process holds the lane, a chain or a step run alone
//   <lane>-chain.out          the chain's output; its last `{"outcome":...}` line is how the lane's
//                             last process ended, and the file's last write is when
//   state/<box>.box           one for each box that still stands: the box of a step that runs now
//
// The states, first match wins (`verdict`):
//   landed    the record says when it landed, or no process holds the lane and it ended `done`
//             with no queue time (a lane from before the merge queue)
//   queued    the record says when the chain added its pull request to GitHub's merge queue.
//             GitHub merges it later; `land.ts merged <pr>` reads whether it has
//   waits     no process holds the lane and its last outcome is `ask` or `stuck`: it stopped and
//             waits on the lead, with the outcome's reason and since when. Never running or stuck.
//   running   `Beat.says` finds the beat fresh; or a step is open, with no beat, for less than the
//             beat's limit
//   stuck     `Beat.says` finds the beat or the agent quiet past the limit (`Beat.QUIET`); or a
//             step is open, with no beat, for longer than it
//   unknown   nothing above can be said, and `text` says what is missing
//
// A lane started again appends to the same out file, so an old `ask` line stays its last outcome
// until the new process ends. The lock tells the two apart: an outcome counts only while no process
// holds the lane.
//
// Edge cases, each with a law in lanes.test.ts:
//   - no chain record for a named lane: `unknown`, "no chain record"
//   - a record with no beat (a lane from before the heartbeat): its outcome line decides; with an
//     open step and no outcome it is running until the limit, then stuck
//   - a beat in the future (a clock that moved): running, and `quietSeconds` is 0, never negative
//   - a record that does not read (half-written, or not a record): `unknown`, and the other lanes
//     still print
//   - a lane that finished and landed: `landed`, left out unless named or `--all`
//   - a lane whose pull request is in the merge queue: `queued`, left out the same way
//   - two lanes: two lines, in name order
//   - a last outcome of `ask` beside an open step and an old beat: `waits`
//   - a lane started again after an `ask`: the lock is held, so the fresh beat decides
//   - an out file with other lines before and after the outcome line
//
// Existing tools looked at (decision 0040): none reads this record. `gcloop.ts status` reads the
// sweep log, and the status page read the lane's state file and a clock, which is ticket 685.

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, DateTime, Effect, FileSystem, Option, Path, Predicate, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import * as Beat from "./flow/Beat.ts";
import { paths } from "./gcloop.ts";

// ---------------------------------------------------------------- what is read

/** The part of a step's record (chain.ts's `StepRecord`) this reader needs. */
const Step = Schema.Struct({
  step: Schema.String,
  startedAt: Schema.String,
  endedAt: Schema.NullOr(Schema.String),
  line: Schema.NullOr(Schema.Struct({ box: Schema.String })),
});

/** The part of the chain record (chain.ts's `ChainRecord`) this reader needs. */
export const Record = Schema.Struct({
  landed: Schema.NullOr(Schema.String),
  queued: Schema.optionalKey(Schema.String),
  steps: Schema.Array(Step),
  beat: Schema.optionalKey(Beat.Beat),
});
export type Record = typeof Record.Type;

const RecordText = Schema.fromJsonString(Record);

/** The lane's record as found: not there, there but unreadable, or read. */
export const Found = Schema.TaggedUnion({
  missing: {},
  unreadable: {},
  read: { record: Record },
});
export type Found = typeof Found.Type;

/** How a lane's last process ended: chain.ts's last line, and when the out file was last written. */
export const End = Schema.Struct({
  outcome: Schema.Literals(["done", "ask", "stuck"]),
  reason: Schema.String,
  at: Schema.NullOr(Schema.String),
});
export type End = typeof End.Type;

const EndLine = Schema.fromJsonString(
  Schema.Struct({ outcome: End.fields.outcome, reason: Schema.optionalKey(Schema.String) }),
);

/** Everything read about one lane, before the clock is looked at. */
export type Seen = {
  readonly lane: string;
  readonly found: Found;
  /** Whether a process holds the lane: its lock file is there. */
  readonly held: boolean;
  readonly end: End | null;
  /** The boxes that still stand, by name: every `state/<box>.box`. */
  readonly boxes: ReadonlyArray<string>;
};

// ---------------------------------------------------------------- what is said

export const STATES = ["running", "waits", "stuck", "queued", "landed", "unknown"] as const;

/** One lane's line. */
export const Line = Schema.Struct({
  lane: Schema.String,
  state: Schema.Literals(STATES),
  /** The lane's last step, open or ended. */
  step: Schema.NullOr(Schema.String),
  /** That step's box: the one that stands now for an open step, else the one its line names. */
  box: Schema.NullOr(Schema.String),
  phase: Schema.NullOr(Schema.Literals(Beat.PHASES)),
  /** Seconds since the chain last wrote its beat; `null` with no beat. */
  quietSeconds: Schema.NullOr(Schema.Number),
  /** Since when: the phase began, the step started, the lane stopped or landed. */
  since: Schema.NullOr(Schema.String),
  text: Schema.String,
});
export type Line = typeof Line.Type;

/** The last `{"outcome":...}` line in a chain's output, among whatever else was printed there. */
export const lastOutcome = (out: string): Omit<End, "at"> | null => {
  for (const line of out.split("\n").toReversed()) {
    const end = Schema.decodeUnknownOption(EndLine)(line.trim());

    if (Option.isSome(end)) {
      return { outcome: end.value.outcome, reason: end.value.reason ?? "" };
    }
  }

  return null;
};

/** The box of an open step: the standing `<lane>-<step><n>` with the highest n. */
const standing = (lane: string, step: string, boxes: ReadonlyArray<string>): string | null => {
  const head = `${lane}-${step}`;
  const runs = boxes
    .filter((box) => box.startsWith(head) && /^\d+$/.test(box.slice(head.length)))
    .toSorted((a, b) => Number(a.slice(head.length)) - Number(b.slice(head.length)));
  return runs.at(-1) ?? null;
};

/** What a lane is doing at `now`, from what was read. Pure: the rules are in the header. */
export const verdict = (seen: Seen, now: Date, quiet = Beat.QUIET): Line => {
  const nothing = { lane: seen.lane, step: null, box: null, phase: null, quietSeconds: null, since: null };

  if (seen.found._tag === "missing") {
    return { ...nothing, state: "unknown", text: "no chain record" };
  }

  if (seen.found._tag === "unreadable") {
    return { ...nothing, state: "unknown", text: "the chain record does not read" };
  }

  const { record } = seen.found;
  const last = record.steps.at(-1) ?? null;
  const open = last !== null && last.endedAt === null ? last : null;
  const box = open === null ? last?.line?.box || null : standing(seen.lane, open.step, seen.boxes);
  const lane = { ...nothing, step: last?.step ?? null, box };

  if (record.landed !== null) {
    return { ...lane, state: "landed", since: record.landed, text: "landed" };
  }

  // A lane started again holds its lock, so its fresh beat decides, as after an `ask`.
  if (record.queued !== undefined && !seen.held) {
    return { ...lane, state: "queued", since: record.queued, text: "in GitHub's merge queue" };
  }

  if (!seen.held && seen.end !== null) {
    const { outcome, reason, at } = seen.end;
    return outcome === "done"
      ? { ...lane, state: "landed", since: at, text: reason }
      : { ...lane, state: "waits", since: at, text: `${outcome}: ${reason}` };
  }

  if (record.beat !== undefined) {
    const said = Beat.says(record.beat, now, quiet);
    return {
      ...lane,
      state: said.stuck ? "stuck" : "running",
      phase: record.beat.phase,
      quietSeconds: Math.max(0, Math.floor((now.getTime() - Date.parse(record.beat.at)) / 1000)),
      since: record.beat.since,
      text: said.text,
    };
  }

  if (open !== null) {
    const ms = now.getTime() - Date.parse(open.startedAt);
    const stuck = ms > quiet;
    return {
      ...lane,
      state: stuck ? "stuck" : "running",
      since: open.startedAt,
      text: `${open.step} open for ${Beat.spoken(ms)}, no beat in the record${stuck ? ": stuck" : ""}`,
    };
  }

  return {
    ...lane,
    state: "unknown",
    text: seen.held
      ? "a process holds the lane, and its record has no beat and no open step"
      : "no beat, no open step and no outcome line",
  };
};

// ---------------------------------------------------------------- the reads

const CHAIN = "-chain.json";

/** Everything on disk about one lane. A file that is not there, or cannot be read, is left out. */
const see = Effect.fn("lanes.see")(function* (boxes: string, lane: string, standingBoxes: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const read = (file: string) => fs.readFileString(file).pipe(Effect.option);
  const out = path.join(boxes, `${lane}-chain.out`);
  const record = yield* read(path.join(boxes, "state", `${lane}${CHAIN}`));
  const held = yield* fs
    .exists(path.join(boxes, "state", `${lane}.lock`))
    .pipe(Effect.catch(() => Effect.succeed(false)));
  const ended = Option.flatMapNullishOr(yield* read(out), lastOutcome);
  const written = Option.flatMap(yield* fs.stat(out).pipe(Effect.option), (info) => info.mtime);
  const found = Option.match(record, {
    onNone: () => Found.cases.missing.make({}),
    onSome: (text) =>
      Option.match(Schema.decodeUnknownOption(RecordText)(text), {
        onNone: () => Found.cases.unreadable.make({}),
        onSome: (read) => Found.cases.read.make({ record: read }),
      }),
  });
  const end = Option.map(ended, (e) => ({
    ...e,
    at: Option.getOrNull(Option.map(written, (date) => date.toISOString())),
  }));
  return { lane, found, held, end: Option.getOrNull(end), boxes: standingBoxes } satisfies Seen;
});

/**
 * The lines for the lanes under `boxes`, in name order: the `named` ones, or every lane with a
 * chain record, the landed ones only with `all`. The clock is Effect's, so a test sets the time.
 */
export const read = Effect.fn("lanes.read")(function* (
  boxes: string,
  options: { readonly named: ReadonlyArray<string>; readonly all: boolean },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = yield* fs.readDirectory(path.join(boxes, "state")).pipe(Effect.catch(() => Effect.succeed([])));
  const recorded = names.filter((name) => name.endsWith(CHAIN)).map((name) => name.slice(0, -CHAIN.length));
  const standingBoxes = names.filter((name) => name.endsWith(".box")).map((name) => name.slice(0, -".box".length));
  const asked = (options.named.length > 0 ? options.named : recorded).toSorted();
  const now = DateTime.toDate(yield* DateTime.now);
  const lines = yield* Effect.forEach(
    asked,
    (lane) => Effect.map(see(boxes, lane, standingBoxes), (seen) => verdict(seen, now)),
    { concurrency: 1 },
  );
  return options.named.length > 0 || options.all
    ? lines
    : lines.filter((line) => line.state !== "landed" && line.state !== "queued");
});

// ---------------------------------------------------------------- the command

const lanes = Command.make(
  "lanes",
  {
    named: Argument.variadic(Argument.String("lane")),
    all: Flag.Boolean("all").pipe(Flag.withDefault(false)),
  },
  ({ named, all }) =>
    Effect.gen(function* () {
      const folders = yield* paths();
      const lines = yield* read(folders.boxes, { named, all });
      yield* Effect.forEach(lines, (line) => Console.log(JSON.stringify(Schema.encodeSync(Line)(line))), {
        concurrency: 1,
      });
    }),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(lanes, { version: "0.0.0" })(process.argv.slice(2)).pipe(
      Effect.tapError((e) => (Predicate.isTagged(e, "Broken") ? Console.error(`lanes: ${e.reason}`) : Effect.void)),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
