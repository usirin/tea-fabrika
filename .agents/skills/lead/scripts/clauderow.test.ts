// Today's lead tooling. clauderow.ts's laws (tickets 525 and 593): its edge cases on made-up
// transcripts held in memory, each one a law (clauderow.ts lists them), then the script itself on
// a temp folder. No real session file is read.
//
// The services it runs on are Effect's own, so their test layers are too: `FileSystem.layerNoop`
// for the disk and `DateTime.layerCurrentZoneNamed` for the laptop's time zone.
import { spawnSync } from "node:child_process";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, FileSystem, Layer, PlatformError, Result, Schema } from "effect";
import { type Ask, read, rounded, row, turns } from "./clauderow.ts";

const tool = { type: "tool_use", id: "t", name: "Read", input: {} };
const text = { type: "text", text: "made-up words that must never reach a row" };

/** A usage as the Messages API writes it, with the cache writes split by lifetime. */
const usage = (input: number, write5m: number, write1h: number, cached: number, output: number, more = {}) => ({
  input_tokens: input,
  cache_creation_input_tokens: write5m + write1h,
  cache_creation: { ephemeral_5m_input_tokens: write5m, ephemeral_1h_input_tokens: write1h },
  cache_read_input_tokens: cached,
  output_tokens: output,
  ...more,
});

/** One assistant line of a transcript. */
const assistant = (at: string, id: string, model: string, said: unknown, content: unknown = []) =>
  JSON.stringify({ type: "assistant", uuid: `u-${at}`, timestamp: at, message: { id, model, content, usage: said } });

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";
const HAIKU = "claude-haiku-5-5";
const FABLE = "claude-fable-5-2";

// One message over three lines, a blank line, a line that is not JSON, a message with no usage,
// content that is plain text, and a first and a last line that are no model call.
const plain = `${[
  JSON.stringify({ type: "user", timestamp: "2026-11-10T07:59:58.250Z", message: { content: "made-up ask" } }),
  assistant("2026-11-10T08:00:01.000Z", "msg_1", OPUS, usage(1200, 3000, 0, 0, 150), [text]),
  assistant("2026-11-10T08:00:01.500Z", "msg_1", OPUS, usage(1200, 3000, 0, 0, 150), [tool]),
  assistant("2026-11-10T08:00:01.900Z", "msg_1", OPUS, usage(1200, 3000, 0, 0, 150), [tool, tool]),
  "",
  "{not json",
  JSON.stringify({ type: "user", timestamp: "2026-11-10T08:00:09.000Z", message: { content: [tool] } }),
  assistant(
    "2026-11-10T08:03:30.000Z",
    "msg_2",
    OPUS,
    usage(40, 0, 2500, 4200, 3100, { service_tier: "standard", inference_geo: "global", speed: "standard" }),
    [tool],
  ),
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-11-10T08:04:00.000Z",
    message: { id: "msg_none", model: OPUS, content: [tool] },
  }),
  assistant("2026-11-10T08:07:45.999Z", "msg_3", OPUS, usage(7, 0, 0, 9900, 1_234_567), "plain text content"),
  JSON.stringify({ type: "system", timestamp: "2026-11-10T08:12:15.400Z" }),
].join("\n")}\n`;

// Two models, Haiku at 100,000 prompt tokens and at 100,001, two usages without the full split,
// and a run that crosses the start of daylight time in Los Angeles. Its meta says it still runs.
const open = [
  assistant(
    "2026-03-08T09:58:00.000Z",
    "msg_a",
    SONNET,
    { input_tokens: 500, cache_creation_input_tokens: 800, cache_read_input_tokens: null, output_tokens: 60 },
    [tool],
  ),
  assistant("2026-03-08T09:59:30.000Z", "msg_b", HAIKU, usage(90_000, 5000, 4000, 1000, 700)),
  assistant("2026-03-08T10:01:00.000Z", "msg_c", HAIKU, usage(90_000, 5000, 4000, 1001, 700), [tool, text, "odd"]),
  assistant(
    "2026-03-08T10:02:10.000Z",
    "msg_d",
    SONNET,
    {
      input_tokens: 10,
      cache_creation_input_tokens: 900,
      cache_creation: { ephemeral_1h_input_tokens: 300 },
      cache_read_input_tokens: 77,
      output_tokens: 5,
    },
    null,
  ),
].join("\n");

/** A line whose message has no id, so its `uuid` is its key. */
const unnamed = (at: string, uuid: string | undefined, said: unknown) =>
  JSON.stringify({
    type: "assistant",
    uuid,
    timestamp: at,
    message: { model: FABLE, content: [tool], usage: said },
  });

// Two lines of one message keyed by uuid, timestamps with an offset, and a call of no tokens.
const closed = `${[
  unnamed("2026-11-10T20:15:00.000+00:00", "only-uuid", usage(15_625, 0, 0, 0, 0)),
  unnamed("2026-11-10T20:15:01.000+00:00", "only-uuid", usage(15_625, 0, 0, 0, 0)),
  assistant("2026-11-10T20:45:03.000Z", "msg_z", FABLE, usage(0, 0, 0, 0, 0)),
].join("\n")}\n`;

const FILES: Readonly<Record<string, string>> = {
  "plain.jsonl": plain,
  "open.jsonl": open,
  "open.meta.json": JSON.stringify({ agentType: "general-purpose", effort: "high", finished: false }),
  "closed.jsonl": closed,
  "closed.meta.json": JSON.stringify({ finished: true }),
};

/** A disk that holds only these made-up files, and the zone the laptop is said to be in. */
const on = (zone: string, files: Readonly<Record<string, string>> = FILES) =>
  Effect.provide(
    Layer.mergeAll(
      FileSystem.layerNoop({
        exists: (path) => Effect.succeed(Object.hasOwn(files, path)),
        readFileString: (path) =>
          Object.hasOwn(files, path)
            ? Effect.succeed(files[path] ?? "")
            : Effect.fail(
                PlatformError.systemError({
                  _tag: "NotFound",
                  module: "FileSystem",
                  method: "readFileString",
                  description: "no such made-up file",
                }),
              ),
      }),
      DateTime.layerCurrentZoneNamed(zone),
    ),
  );

const ask = (over: Partial<Ask> = {}): Ask => ({
  run: "test-run",
  role: "hand",
  reason: "",
  ticket: null,
  pr: null,
  parent: null,
  outcome: null,
  note: null,
  billing: null,
  corrects: null,
  step: null,
  ...over,
});

/** A printed line holds the same values under the same keys in the same order as Python's line. */
const same = (line: string, python: string) => {
  expect(JSON.parse(line)).toEqual(JSON.parse(python));
  expect(Object.keys(JSON.parse(line))).toEqual(Object.keys(JSON.parse(python)));
};

/** Each printed line is Python's line of the same place, and there are as many. */
const sameLines = (lines: ReadonlyArray<string>, python: ReadonlyArray<string>) => {
  expect(lines).toHaveLength(python.length);

  for (const [i, line] of lines.entries()) {
    same(line, python[i] ?? "");
  }
};

// vector: each line below is what clauderow.py, the Python script this file replaces, printed for
// the same transcript, flags and TZ on 2026-11-12, just before it was deleted. A row made again
// from an old transcript must hold the same numbers, so the port is held to the old script's own
// output. Python wrote `, ` and `: ` between parts and `0.0` for a whole float; JSON reads both the
// same, and fieldfile.ts writes the row out again.
const PLAIN_ROW =
  '{"date": "2026-11-09", "run": "t593-hand1", "ticket": null, "pr": null, "started": "2026-11-09T23:59:58-08:00", "ended": "2026-11-10T00:12:15-08:00", "parent": null, "active": null, "role": "hand", "model": "claude-opus-5-5", "effort": null, "outcome": null, "why": "a made-up reason Claude Code subagent transcript: 3 model calls; tokens in 1,247 uncached, 3,000 5-minute and 2,500 1-hour cache writes, 14,100 cache reads; out 1,237,817. Dollars are list price (https://platform.claude.com/docs/en/about-claude/pricing, read 2026-11-08).", "tokens": 1244474, "tools": 4, "minutes": 12.3, "note": null, "costUsd": null, "listUsd": 24.7991, "billed": 1258664, "inputTokens": 20847, "cachedTokens": 14100, "outputTokens": 1237817}';

const PLAIN_TURNS = [
  '{"call": 1, "at": "2026-11-10T00:00:01-08:00", "context": 4200, "write": 3000, "output": 150, "tools": 3, "usd": 0.0228, "total": 0.0228}',
  '{"call": 2, "at": "2026-11-10T00:03:30-08:00", "context": 6740, "write": 2500, "output": 3100, "tools": 1, "usd": 0.083, "total": 0.1058}',
  '{"call": 3, "at": "2026-11-10T00:07:45-08:00", "context": 9907, "write": 0, "output": 1234567, "tools": 0, "usd": 24.69335, "total": 24.7991}',
];

const OPEN_ROW =
  '{"date": "2026-03-08", "run": "t593-review1", "ticket": "593", "pr": "12", "started": "2026-03-08T01:58:00-08:00", "ended": null, "parent": "t593-hand1", "active": null, "role": "reviewer", "model": "claude-haiku-5-5+claude-sonnet-5-5", "effort": "high", "outcome": "done", "why": "café, reviewed Claude Code subagent transcript: 4 model calls; tokens in 180,510 uncached, 11,400 5-minute and 8,300 1-hour cache writes, 2,078 cache reads; out 1,465. Dollars are list price (https://platform.claude.com/docs/en/about-claude/pricing, read 2026-11-08). Still running when read, so `ended` is null and the numbers are a floor. Billing `subscription` as the caller gave it; the transcript does not record it.", "tokens": 992, "tools": 2, "minutes": 4.2, "note": "2026-11-12-01", "costUsd": null, "listUsd": 0.0711, "billed": 203753, "inputTokens": 202288, "cachedTokens": 2078, "outputTokens": 1465, "billing": "subscription", "corrects": "t593-review0", "step": "review"}';

const OPEN_TURNS = [
  '{"call": 1, "at": "2026-03-08T01:58:00-08:00", "context": 1300, "write": 800, "output": 60, "tools": 1, "usd": 0.0036, "total": 0.0036}',
  '{"call": 2, "at": "2026-03-08T01:59:30-08:00", "context": 100000, "write": 9000, "output": 700, "tools": 0, "usd": 0.01078, "total": 0.0144}',
  '{"call": 3, "at": "2026-03-08T03:01:00-07:00", "context": 100001, "write": 9000, "output": 700, "tools": 1, "usd": 0.05393, "total": 0.0683}',
  '{"call": 4, "at": "2026-03-08T03:02:10-07:00", "context": 987, "write": 900, "output": 5, "tools": 0, "usd": 0.00278, "total": 0.0711}',
];

const CLOSED_ROW =
  '{"date": "2026-11-11", "run": "t593-hand2", "ticket": null, "pr": null, "started": "2026-11-11T01:45:00+05:30", "ended": "2026-11-11T02:15:03+05:30", "parent": null, "active": null, "role": "hand", "model": "claude-fable-5-2", "effort": null, "outcome": null, "why": "Claude Code subagent transcript: 2 model calls; tokens in 15,625 uncached, 0 5-minute and 0 1-hour cache writes, 0 cache reads; out 0. Dollars are list price (https://platform.claude.com/docs/en/about-claude/pricing, read 2026-11-10). Billing `key` as the caller gave it; the transcript does not record it.", "tokens": 0, "tools": 2, "minutes": 30.1, "note": null, "costUsd": null, "listUsd": 0.125, "billed": 15625, "inputTokens": 15625, "cachedTokens": 0, "outputTokens": 0, "billing": "key"}';

const CLOSED_TURNS = [
  '{"call": 1, "at": "2026-11-10T20:15:00+00:00", "context": 15625, "write": 0, "output": 0, "tools": 2, "usd": 0.125, "total": 0.125}',
  '{"call": 2, "at": "2026-11-10T20:45:03+00:00", "context": 0, "write": 0, "output": 0, "tools": 0, "usd": 0.0, "total": 0.125}',
];

const reviewed = ask({
  run: "t593-review1",
  billing: "subscription",
  role: "reviewer",
  ticket: "593",
  pr: "12",
  parent: "t593-hand1",
  outcome: "done",
  note: "2026-11-12-01",
  corrects: "t593-review0",
  step: "review",
  reason: "café, reviewed",
});

describe("clauderow prints what clauderow.py printed", () => {
  it.effect("vector: a finished run with no meta file, one message over three lines, in Los Angeles", () =>
    Effect.gen(function* () {
      same(yield* row("plain.jsonl", ask({ run: "t593-hand1", reason: "a made-up reason" })), PLAIN_ROW);
      sameLines(yield* turns("plain.jsonl"), PLAIN_TURNS);
    }).pipe(on("America/Los_Angeles")),
  );

  it.effect("vector: a run still going, two models, both Haiku prices, every flag, across a clock change", () =>
    Effect.gen(function* () {
      same(yield* row("open.jsonl", reviewed), OPEN_ROW);
      sameLines(yield* turns("open.jsonl"), OPEN_TURNS);
    }).pipe(on("America/Los_Angeles")),
  );

  it.effect("vector: a message keyed by its uuid, no reason, a half-hour zone and UTC", () =>
    Effect.gen(function* () {
      const kolkata = yield* row("closed.jsonl", ask({ run: "t593-hand2", billing: "key" })).pipe(on("Asia/Kolkata"));
      same(kolkata, CLOSED_ROW);
      sameLines(yield* turns("closed.jsonl").pipe(on("UTC")), CLOSED_TURNS);
    }),
  );

  // vector: Python's `round` on these values, run on 2026-11-12. The first four are exact ties,
  // where half to even and half away from zero part.
  it("vector: rounds half to even on the exact value, as Python's round does", () => {
    expect([
      rounded(0.031_25, 4),
      rounded(0.093_75, 4),
      rounded(0.125, 2),
      rounded(-0.25, 1),
      rounded(12.25, 1),
      rounded(12.35, 1),
      rounded(1e-7, 4),
      rounded(2.675, 2),
      rounded(0.05, 1),
      rounded(0.15, 1),
      rounded(24.799_100_000_000_003, 4),
    ]).toEqual([0.0312, 0.0938, 0.12, -0.2, 12.2, 12.3, 0, 2.67, 0.1, 0.1, 24.7991]);
  });
});

const count = (maximum: number) => Schema.Int.check(Schema.isBetween({ minimum: 0, maximum }));

const Counts = Schema.Struct({
  input: count(200_000),
  write5m: count(200_000),
  write1h: count(200_000),
  cached: count(2_000_000),
  output: count(60_000),
});
type Counts = typeof Counts.Type;
const some = (most: number) => Schema.Array(Counts).check(Schema.isMaxLength(most));
const ZERO: Counts = { input: 0, write5m: 0, write1h: 0, cached: 0, output: 0 };

/** A transcript of one line per call, each call with its own id. */
const transcript = (model: string, calls: ReadonlyArray<Counts>, more = {}, name = "msg") =>
  calls
    .map((call, i) =>
      assistant(
        `2026-11-10T08:00:${String(i).padStart(2, "0")}.000Z`,
        `${name}_${i}`,
        model,
        usage(call.input, call.write5m, call.write1h, call.cached, call.output, more),
      ),
    )
    .join("\n");

const options = { arbitrary: { seed: 119_120, runs: 50 } };

describe("clauderow's edge cases, each a law", () => {
  // pinned: Claude Fable 5.2's list price in dollars per million tokens, as Anthropic's pricing
  // page gave it on 2026-11-10 (https://platform.claude.com/docs/en/about-claude/pricing): $8 in,
  // $10 and $16 for a 5-minute and a 1-hour cache write, $0.20 for a cache read, $40 out.
  const fable = { input: 8, write5m: 10, write1h: 16, cached: 0.2, output: 40 };

  it.effect.prop(
    "gives a claude-fable-5-2 row its dollars at that list price, and says the day it was read",
    { calls: some(4).check(Schema.isMinLength(1)) },
    ({ calls }) =>
      Effect.gen(function* () {
        const got = JSON.parse(
          yield* row("agent.jsonl", ask()).pipe(on("UTC", { "agent.jsonl": transcript(FABLE, calls) })),
        );
        const dollars = calls.reduce(
          (sum, call) =>
            sum +
            (call.input * fable.input +
              call.write5m * fable.write5m +
              call.write1h * fable.write1h +
              call.cached * fable.cached +
              call.output * fable.output) /
              1e6,
          0,
        );
        expect(got.model).toBe(FABLE);
        expect(got.costUsd).toBeNull();
        // The row rounds to four places.
        expect(Math.abs(got.listUsd - dollars)).toBeLessThanOrEqual(0.000_06);
        expect(got.why).toContain("(https://platform.claude.com/docs/en/about-claude/pricing, read 2026-11-10)");
        expect(got.billed).toBe(got.inputTokens + got.outputTokens);
        expect("billing" in got).toBe(false);
      }),
    options,
  );

  it.effect.prop(
    "stops, and prints no row and no turn, on a model it has no list price for",
    { before: some(3), call: Counts },
    ({ before, call }) =>
      Effect.gen(function* () {
        const files = {
          "agent.jsonl": `${transcript(OPUS, before)}\n${transcript("claude-made-up-9", [call], {}, "odd")}`,
        };
        const refused = yield* Effect.flip(row("agent.jsonl", ask())).pipe(on("UTC", files));
        expect(refused.reason).toBe("no list price for 'claude-made-up-9'");
        expect((yield* Effect.flip(turns("agent.jsonl")).pipe(on("UTC", files))).reason).toBe(refused.reason);
      }),
    options,
  );

  it.effect.prop(
    "stops on a call routed another way than global, standard and standard",
    {
      key: Schema.Literals(["inference_geo", "service_tier", "speed"]),
      word: Schema.String,
      call: Counts,
    },
    ({ call, key, word }) =>
      Effect.gen(function* () {
        // No word with this start is one of the two the prices are for.
        const other = `not-${word}`;
        const files = { "agent.jsonl": transcript(OPUS, [call], { [key]: other }) };
        const refused = yield* Effect.flip(row("agent.jsonl", ask())).pipe(on("UTC", files));
        expect(refused.reason).toBe(`${key} '${other}' has no price here`);
        // A routing key that is null says nothing, so the price holds.
        const quiet = { "agent.jsonl": transcript(OPUS, [call], { [key]: null }) };
        expect(JSON.parse(yield* row("agent.jsonl", ask()).pipe(on("UTC", quiet))).model).toBe(OPUS);
      }),
    options,
  );

  it.prop(
    "counts a line with no message id and no uuid as its own call, and never folds two into one",
    { calls: some(5) },
    ({ calls }) => {
      const lines = calls.map((call) =>
        unnamed("2026-11-10T08:00:00.000Z", undefined, usage(call.input, 0, 0, 0, call.output)),
      );
      const got = read(lines.join("\n"));
      expect(Result.isSuccess(got) && got.success.calls.map((call) => call.tokens.input)).toEqual(
        calls.map((call) => call.input),
      );
    },
    options,
  );

  it("skips a line that is no JSON object and a message with no usage, and counts the rest", () => {
    const real = assistant("2026-11-10T08:00:00.000Z", "msg_1", OPUS, usage(1, 0, 0, 0, 1));
    const skipped = [
      "[]",
      "3",
      "null",
      '"words"',
      "{",
      "   ",
      assistant("2026-11-10T08:00:01.000Z", "msg_2", OPUS, {}),
    ];
    const noMessage = JSON.stringify({ type: "assistant", timestamp: "2026-11-10T08:00:02.000Z", message: "words" });
    const got = read([...skipped, real, noMessage, ...skipped].join("\n"));
    expect(Result.isSuccess(got) && got.success.calls).toHaveLength(1);
    expect(Result.isSuccess(got) && [got.success.first, got.success.last]).toEqual([
      "2026-11-10T08:00:01.000Z",
      "2026-11-10T08:00:01.000Z",
    ]);
  });

  it("stops on a usage of another shape, and never reads it as zero", () => {
    const odd = [{ input_tokens: "12" }, { output_tokens: 1.5 }, "words", 7, [], { speed: true }];

    for (const said of odd) {
      const got = read(`\n${assistant("2026-11-10T08:00:00.000Z", "msg_1", OPUS, said)}`);
      expect(Result.isFailure(got) && got.failure.reason).toBe("line 2: a call's usage could not be read");
    }
  });

  it.effect("stops on a timestamp that names no zone, and on a transcript with no timestamp", () =>
    Effect.gen(function* () {
      const said = usage(1, 0, 0, 0, 1);
      const bare = { "agent.jsonl": assistant("2026-11-10T08:00:00.000", "msg_1", OPUS, said) };
      const day = { "agent.jsonl": assistant("2026-11-10", "msg_1", OPUS, said) };
      const none = {
        "agent.jsonl": JSON.stringify({ type: "assistant", message: { id: "m", model: OPUS, usage: said } }),
      };

      for (const files of [bare, day, none]) {
        const refused = yield* Effect.flip(row("agent.jsonl", ask())).pipe(on("UTC", files));
        expect(refused.reason).toContain("a timestamp is missing or names no time zone");
        expect((yield* Effect.flip(turns("agent.jsonl")).pipe(on("UTC", files))).reason).toBe(refused.reason);
      }
    }),
  );

  it.effect("refuses a row for a transcript with no model calls, and prints no turn for it", () =>
    Effect.gen(function* () {
      const files = { "agent.jsonl": JSON.stringify({ type: "user", timestamp: "2026-11-10T08:00:01.000Z" }) };
      const refused = yield* Effect.flip(row("agent.jsonl", ask())).pipe(on("UTC", files));
      expect(refused.reason).toBe("no model calls in agent.jsonl");
      expect(yield* turns("agent.jsonl").pipe(on("UTC", files))).toEqual([]);
    }),
  );

  it.effect("stops on a transcript or a meta file it cannot read, and reads no meta beside another name", () =>
    Effect.gen(function* () {
      const line = assistant("2026-11-10T08:00:00.000Z", "msg_1", OPUS, usage(1, 0, 0, 0, 1));
      const missing = yield* Effect.flip(row("gone.jsonl", ask())).pipe(on("UTC", {}));
      expect(missing.reason).toBe("gone.jsonl could not be read");
      const broken = { "agent.jsonl": line, "agent.meta.json": "{" };
      expect((yield* Effect.flip(row("agent.jsonl", ask())).pipe(on("UTC", broken))).reason).toBe(
        "agent.meta.json could not be read",
      );
      // `agent.txt` less six letters is `a`: the old script read `a.meta.json` for it.
      const other = { "agent.txt": line, "a.meta.json": JSON.stringify({ effort: "high", finished: false }) };
      const got = JSON.parse(yield* row("agent.txt", ask()).pipe(on("UTC", other)));
      expect([got.effort, got.ended]).toEqual([null, "2026-11-10T08:00:00+00:00"]);
    }),
  );

  it.effect("reads no message text into a row or a turn", () =>
    Effect.gen(function* () {
      const printed = [yield* row("plain.jsonl", ask()), ...(yield* turns("plain.jsonl"))].join("\n");
      expect(printed).not.toContain("made-up");
      expect(printed).not.toContain("plain text content");
    }).pipe(on("UTC")),
  );

  // scenario: the script itself, on a temp folder, with the zone in TZ as a person's laptop has it.
  it.effect("scenario: prints the row, the turns, and on a refusal one line on stderr and exit 1", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "clauderow-" });
      yield* fs.writeFileString(`${dir}/plain.jsonl`, plain);
      yield* fs.writeFileString(`${dir}/odd.jsonl`, transcript("claude-made-up-9", [{ ...ZERO, input: 1 }]));
      const script = `${import.meta.dirname}/clauderow.ts`;
      const clauderow = (...args: string[]) =>
        spawnSync(process.execPath, [script, ...args], {
          cwd: dir,
          encoding: "utf8",
          env: { ...process.env, TZ: "America/Los_Angeles", TYPESAFE_API_KEY: undefined },
        });

      const made = clauderow("--run", "t593-hand1", "plain.jsonl", "a", "made-up", "reason");
      expect(made.status, made.stderr).toBe(0);
      expect(made.stdout.endsWith("\n")).toBe(true);
      same(made.stdout, PLAIN_ROW);
      // Flags may follow the transcript, as argparse let them.
      expect(clauderow("plain.jsonl", "--run", "t593-hand1", "a made-up reason").stdout).toBe(made.stdout);
      const curve = clauderow("--turns", "plain.jsonl");
      sameLines(curve.stdout.trimEnd().split("\n"), PLAIN_TURNS);

      const unnamedRun = clauderow("plain.jsonl");
      expect([unnamedRun.status, unnamedRun.stdout]).toEqual([1, ""]);
      expect(unnamedRun.stderr).toContain("clauderow: --run is required");
      const odd = clauderow("--run", "x", "odd.jsonl");
      expect([odd.status, odd.stdout]).toEqual([1, ""]);
      expect(odd.stderr).toBe("clauderow: no list price for 'claude-made-up-9'\n");
      expect(clauderow("--run", "x", "--billing", "cash", "plain.jsonl").status).not.toBe(0);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
