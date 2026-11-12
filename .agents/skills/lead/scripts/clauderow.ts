// clauderow.ts --run ID [--billing subscription|key] [--role R] [--ticket T] [--pr P] [--parent RUN]
//              [--outcome O] [--note ID] [--step S] [--corrects RUN] <transcript.jsonl> [reason...]
//   prints one `field/runs/` row for a Claude Code subagent, from its transcript, for fieldfile.ts.
// clauderow.ts --turns <transcript.jsonl>
//   prints one line per model call instead (context, dollars, tool calls), so the cost curve of a
//   long run can be read.
// Today's lead tooling, run on our own laptop; it is not product.
//
//   node clauderow.ts --run t593-hand1 --billing subscription agent-1.jsonl ported one script \
//     | node fieldfile.ts runs /dev/stdin
//
// What a row must never lose: each model call is counted once, at its own list price; a price this
// file does not hold stops the run and is never guessed or read as zero; and `billing` is only what
// the caller gave, since a subagent's transcript has no `system/init` line and so does not say how
// the run was paid (field/README.md).
//
// It reads only each assistant message's `usage`, `model`, `id` and tool-call count, the
// timestamps, and the `.meta.json` beside the transcript (effort, and whether the run finished). No
// message text is read into the row: its reason is what the caller passes.
//
// Dollars are the list price on Anthropic's pricing page (SOURCE and PRICES below), even on a
// subscription, which bills no call. It is the page's global routing price; every call checked had
// inference_geo "global", service_tier "standard" and speed "standard".
//
// Edge cases, each with a test:
//   - A transcript writes one line per content block, each with the same message id and the same
//     usage. A call is counted once by its id, with the first line's time, model and usage, and its
//     tool calls are added up over its lines.
//   - A message with no id is keyed by its line's `uuid`. A line with neither is its own call.
//   - A line that is blank, is not JSON or is not a JSON object is skipped, and so is a line that
//     is not an assistant message or has no usage. A usage of another shape stops the run.
//   - A call routed another way than global, standard and standard stops the run, and so does a
//     model with no price here. Nothing is printed then, in `--turns` too.
//   - Claude Haiku 5.5 is priced by each call's prompt length: up to 100,000 tokens, and over.
//   - A usage without the 5-minute and 1-hour split counts its cache writes as 5-minute ones, less
//     the 1-hour ones it does name.
//   - Times are printed in the local time zone, to the second, never rounded up. A timestamp that
//     names no zone stops the run, since it cannot be placed.
//   - The row starts at the first timestamp of any line and ends at the last, not only the calls'.
//   - A `.meta.json` that says `finished: false` is a run still going: `ended` is null and the
//     reason says the numbers are a floor. No meta file is a finished run with no effort.
//   - `tokens` is the last call's whole context, output included. A turn's `context` is its prompt.
//   - Dollars and minutes round half to even on the exact value, as the Python script this replaces
//     did, so a row made again from an old transcript holds the same numbers.
//   - A transcript with no model calls is refused for a row, and prints no line for `--turns`.

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, DateTime, Effect, FileSystem, Layer, Option, Result, Schema } from "effect";
import { Argument, Command, Flag } from "effect/cli";

export const SOURCE = "https://platform.claude.com/docs/en/about-claude/pricing";

export class Refused extends Schema.TaggedError<Refused>()("Refused", { reason: Schema.String }) {}

/** One call's tokens by how they are priced: uncached input, the two cache writes, cache reads, output. */
export interface Tokens {
  readonly input: number;
  readonly write5m: number;
  readonly write1h: number;
  readonly read: number;
  readonly output: number;
}

/** Dollars per token, by the same five names. */
type Price = Tokens;

/** A model's list price, the day it was read, and its price for a prompt over 100,000 tokens if it has one. */
interface Listed {
  readonly read: string;
  readonly price: Price;
  readonly long?: Price;
}

const M = 1e-6;

/** A price from the page's dollars per million tokens. */
const perMillion = (input: number, write5m: number, write1h: number, read: number, output: number): Price => ({
  input: input * M,
  write5m: write5m * M,
  write1h: write1h * M,
  read: read * M,
  output: output * M,
});

const PRICES: ReadonlyMap<string, Listed> = new Map([
  ["claude-opus-5-5", { read: "2026-11-08", price: perMillion(4, 5, 8, 0.2, 20) }],
  ["claude-sonnet-5-5", { read: "2026-11-08", price: perMillion(2, 2.5, 4, 0.1, 10) }],
  ["claude-fable-5-2", { read: "2026-11-10", price: perMillion(8, 10, 16, 0.2, 40) }],
  [
    "claude-haiku-5-5",
    {
      read: "2026-11-08",
      price: perMillion(0.1, 0.125, 0.2, 0.01, 0.5),
      long: perMillion(0.5, 0.625, 1, 0.05, 2.5),
    },
  ],
]);

/** The only routing the prices above are for. */
const ROUTING = [
  ["inference_geo", "global"],
  ["service_tier", "standard"],
  ["speed", "standard"],
] as const;

const Count = Schema.optionalKey(Schema.NullOr(Schema.Int));
const Routed = Schema.optionalKey(Schema.NullOr(Schema.String));

/** A message's `usage`, as the Messages API writes it. Other fields are not read. */
const Usage = Schema.Struct({
  input_tokens: Count,
  cache_creation_input_tokens: Count,
  cache_creation: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ ephemeral_5m_input_tokens: Count, ephemeral_1h_input_tokens: Count })),
  ),
  cache_read_input_tokens: Count,
  output_tokens: Count,
  inference_geo: Routed,
  service_tier: Routed,
  speed: Routed,
});
type Usage = typeof Usage.Type;

const Field = Schema.optionalKey(Schema.Unknown);

/** The four fields read from a transcript line, and the four read from its message. */
const Line = Schema.Struct({ type: Field, timestamp: Field, uuid: Field, message: Field });
const Message = Schema.Struct({ id: Field, model: Field, content: Field, usage: Field });
const ToolUse = Schema.Struct({ type: Schema.Literal("tool_use") });
/** A usage that says nothing: `{}`. */
const Empty = Schema.Record(Schema.String, Schema.Never);

/** The `.meta.json` beside a transcript. */
const Meta = Schema.Struct({ effort: Schema.optionalKey(Schema.NullOr(Schema.String)), finished: Field });

const decodeLine = Schema.decodeUnknownResult(Schema.fromJsonString(Line));
const decodeMessage = Schema.decodeUnknownResult(Message);
const decodeUsage = Schema.decodeUnknownResult(Usage);
const decodeMeta = Schema.decodeUnknownResult(Schema.fromJsonString(Meta));

/** One model call: when its first line was written, its model, its tokens, tool calls and list dollars. */
export interface Call {
  readonly at: string | null;
  readonly model: string;
  readonly tokens: Tokens;
  readonly tools: number;
  readonly usd: number;
}

/** What a transcript says: its calls in order, and the first and last timestamp of any line. */
export interface Transcript {
  readonly calls: ReadonlyArray<Call>;
  readonly first: string | null;
  readonly last: string | null;
}

const refuse = (reason: string) => Result.fail(new Refused({ reason }));

/** A usage's tokens by price. */
const split = (usage: Usage): Tokens => {
  const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  return {
    input: usage.input_tokens ?? 0,
    write5m: usage.cache_creation?.ephemeral_5m_input_tokens ?? (usage.cache_creation_input_tokens ?? 0) - write1h,
    write1h,
    read: usage.cache_read_input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
  };
};

/** One call's list dollars, or a refusal when its price is not here. */
const priced = (model: unknown, usage: Usage, tokens: Tokens): Result.Result<number, Refused> => {
  for (const [key, wanted] of ROUTING) {
    const got = usage[key] ?? wanted;

    if (got !== wanted) {
      return refuse(`${key} '${got}' has no price here`);
    }
  }

  if (typeof model !== "string") {
    return refuse("a call names no model, so it has no list price");
  }

  const listed = PRICES.get(model);

  if (listed === undefined) {
    return refuse(`no list price for '${model}'`);
  }

  const prompt = tokens.input + tokens.write5m + tokens.write1h + tokens.read;
  const price = listed.long !== undefined && prompt > 100_000 ? listed.long : listed.price;
  // Added in this order, as the Python script did, so the sum is the same number to the last bit.
  return Result.succeed(
    tokens.input * price.input +
      tokens.write5m * price.write5m +
      tokens.write1h * price.write1h +
      tokens.read * price.read +
      tokens.output * price.output,
  );
};

const named = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** A transcript's calls and its first and last timestamp, or the first refusal. */
export const read = (text: string): Result.Result<Transcript, Refused> => {
  interface Draft {
    readonly at: string | null;
    readonly model: unknown;
    readonly usage: Usage;
    readonly line: number;
    tools: number;
  }

  const drafts: Draft[] = [];
  const byKey = new Map<string, Draft>();
  let first: string | null = null;
  let last: string | null = null;

  for (const [i, json] of text.split("\n").entries()) {
    const line = decodeLine(json);

    if (Result.isFailure(line)) {
      continue;
    }

    const at = named(line.success.timestamp);
    first ??= at;
    last = at ?? last;
    const message = decodeMessage(line.success.message);

    if (line.success.type !== "assistant" || Result.isFailure(message)) {
      continue;
    }

    const { content, id, model, usage: said } = message.success;

    if (said === undefined || said === null || Schema.is(Empty)(said)) {
      continue;
    }

    const usage = decodeUsage(said);

    if (Result.isFailure(usage)) {
      return refuse(`line ${i + 1}: a call's usage could not be read`);
    }

    const tools = Array.isArray(content) ? content.filter(Schema.is(ToolUse)).length : 0;
    const key = named(id) ?? named(line.success.uuid);
    const seen = key === null ? undefined : byKey.get(key);

    if (seen !== undefined) {
      seen.tools += tools;
      continue;
    }

    const draft: Draft = { at, model, usage: usage.success, line: i + 1, tools };
    drafts.push(draft);

    if (key !== null) {
      byKey.set(key, draft);
    }
  }

  const calls: Call[] = [];

  for (const draft of drafts) {
    const tokens = split(draft.usage);
    const usd = priced(draft.model, draft.usage, tokens);

    if (Result.isFailure(usd)) {
      return Result.fail(usd.failure);
    }

    calls.push({ at: draft.at, model: String(draft.model), tokens, tools: draft.tools, usd: usd.success });
  }

  return Result.succeed({ calls, first, last });
};

/**
 * A number rounded to some decimal places, half to even on its exact value, as Python's `round`
 * does. `toFixed` is exact too but rounds a tie away from zero, and a tie is exactly an odd number
 * of halves of the last place, so only that case is mended.
 */
export const rounded = (x: number, places: number): number => {
  const digits = Number(Math.abs(x).toFixed(places).replace(".", ""));
  const halves = Math.abs(x) * 2 ** (places + 1);
  const tie = Number.isInteger(halves) && halves % 2 === 1;
  return Math.sign(x) * Number(`${tie && digits % 2 === 1 ? digits - 1 : digits}e-${places}`);
};

/** A count with a comma between each three digits: 1,234,567. */
const grouped = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** A timestamp names its zone: `Z` or an offset, after a time. */
const ZONED = /T.*(?:Z|[+-]\d{2}:?\d{2})$/;

/** The instant a transcript's timestamp names, or a refusal when it names none. */
const instant = (at: string | null): Result.Result<DateTime.Utc, Refused> => {
  const made = at !== null && ZONED.test(at) ? DateTime.make(at) : Option.none();
  return Option.isSome(made)
    ? Result.succeed(DateTime.toUtc(made.value))
    : refuse(`a timestamp is missing or names no time zone: ${JSON.stringify(at)}`);
};

/** An instant as that zone's clock reads it, to the second: `2026-11-10T00:12:15-08:00`. */
const local = (zone: DateTime.TimeZone, at: DateTime.Utc): string => {
  const zoned = DateTime.setZone(at, zone);
  return `${DateTime.formatIsoOffset(zoned).slice(0, 19)}${DateTime.zonedOffsetIso(zoned)}`;
};

/** How a row's run was paid, when the caller says. */
export const Billing = Schema.Literals(["subscription", "key"]);

/** What the caller says about the run; the transcript says none of it. */
export interface Ask {
  readonly run: string;
  readonly role: string;
  readonly reason: string;
  readonly ticket: string | null;
  readonly pr: string | null;
  readonly parent: string | null;
  readonly outcome: string | null;
  readonly note: string | null;
  readonly billing: typeof Billing.Type | null;
  readonly corrects: string | null;
  readonly step: string | null;
}

const Text = Schema.NullOr(Schema.String);

/** One `field/runs/` row, in the key order field/README.md gives. Its `reason` is saved as `why`. */
const Row = Schema.Struct({
  date: Schema.String,
  run: Schema.String,
  ticket: Text,
  pr: Text,
  started: Schema.String,
  ended: Text,
  parent: Text,
  active: Schema.Null,
  role: Schema.String,
  model: Schema.String,
  effort: Text,
  outcome: Text,
  reason: Schema.String,
  tokens: Schema.Number,
  tools: Schema.Number,
  minutes: Schema.Number,
  note: Text,
  costUsd: Schema.Null,
  listUsd: Schema.Number,
  billed: Schema.Number,
  inputTokens: Schema.Number,
  cachedTokens: Schema.Number,
  outputTokens: Schema.Number,
  billing: Schema.optionalKey(Billing),
  corrects: Schema.optionalKey(Schema.String),
  step: Schema.optionalKey(Schema.String),
}).pipe(Schema.encodeKeys({ reason: "why" }));

/** One model call of a transcript, for the cost curve. */
const Turn = Schema.Struct({
  call: Schema.Number,
  at: Schema.String,
  context: Schema.Number,
  write: Schema.Number,
  output: Schema.Number,
  tools: Schema.Number,
  usd: Schema.Number,
  total: Schema.Number,
});

const encodeRow = Schema.encodeSync(Schema.fromJsonString(Row));
const encodeTurn = Schema.encodeSync(Schema.fromJsonString(Turn));

const load = Effect.fn("clauderow.load")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs
    .readFileString(path)
    .pipe(Effect.mapError(() => new Refused({ reason: `${path} could not be read` })));
  return yield* Effect.fromResult(read(text));
});

/** What the `.meta.json` beside a transcript says, or nothing when there is none. */
const beside = Effect.fn("clauderow.beside")(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  const meta = `${path.slice(0, -".jsonl".length)}.meta.json`;
  const unreadable = Effect.mapError(() => new Refused({ reason: `${meta} could not be read` }));

  if (!path.endsWith(".jsonl") || !(yield* fs.exists(meta).pipe(unreadable))) {
    return {};
  }

  return yield* Effect.fromResult(decodeMeta(yield* fs.readFileString(meta).pipe(unreadable))).pipe(unreadable);
});

/** The row of one transcript, as the JSON line fieldfile.ts takes. */
export const row = Effect.fn("clauderow.row")(function* (path: string, ask: Ask) {
  const zone = yield* DateTime.CurrentTimeZone;
  const { calls, first, last } = yield* load(path);
  const final = calls.at(-1);

  if (final === undefined) {
    return yield* new Refused({ reason: `no model calls in ${path}` });
  }

  const meta = yield* beside(path);
  const begun = yield* Effect.fromResult(instant(first));
  const ended = yield* Effect.fromResult(instant(last));
  const open = meta.finished === false;
  const models = [...new Set(calls.map((call) => call.model))].toSorted();
  const reads = [...new Set(models.map((model) => PRICES.get(model)?.read ?? ""))].toSorted();
  const sum = (pick: (call: Call) => number) => calls.reduce((total, call) => total + pick(call), 0);
  const input = sum((call) => call.tokens.input);
  const write5m = sum((call) => call.tokens.write5m);
  const write1h = sum((call) => call.tokens.write1h);
  const cached = sum((call) => call.tokens.read);
  const output = sum((call) => call.tokens.output);
  const { tokens } = final;
  const reason = [
    ask.reason,
    ` Claude Code subagent transcript: ${calls.length} model calls; tokens in ${grouped(input)} uncached,`,
    ` ${grouped(write5m)} 5-minute and ${grouped(write1h)} 1-hour cache writes, ${grouped(cached)} cache reads;`,
    ` out ${grouped(output)}. Dollars are list price (${SOURCE}, read ${reads.join(", ")}).`,
    open ? " Still running when read, so `ended` is null and the numbers are a floor." : "",
    ask.billing === null ? "" : ` Billing \`${ask.billing}\` as the caller gave it; the transcript does not record it.`,
  ].join("");

  return encodeRow({
    date: local(zone, begun).slice(0, 10),
    run: ask.run,
    ticket: ask.ticket,
    pr: ask.pr,
    started: local(zone, begun),
    ended: open ? null : local(zone, ended),
    parent: ask.parent,
    active: null,
    role: ask.role,
    model: models.join("+"),
    effort: meta.effort ?? null,
    outcome: ask.outcome,
    reason: reason.trim(),
    tokens: tokens.input + tokens.write5m + tokens.write1h + tokens.read + tokens.output,
    tools: sum((call) => call.tools),
    // Seconds first, then minutes, as the Python script divided.
    minutes: rounded((DateTime.toEpochMillis(ended) - DateTime.toEpochMillis(begun)) / 1000 / 60, 1),
    note: ask.note,
    costUsd: null,
    listUsd: rounded(
      sum((call) => call.usd),
      4,
    ),
    billed: input + write5m + write1h + cached + output,
    inputTokens: input + write5m + write1h + cached,
    cachedTokens: cached,
    outputTokens: output,
    ...(ask.billing === null ? {} : { billing: ask.billing }),
    ...(ask.corrects === null ? {} : { corrects: ask.corrects }),
    ...(ask.step === null ? {} : { step: ask.step }),
  });
});

/** One JSON line per model call of a transcript: its context, dollars and the dollars so far. */
export const turns = Effect.fn("clauderow.turns")(function* (path: string) {
  const zone = yield* DateTime.CurrentTimeZone;
  const { calls } = yield* load(path);
  const lines: string[] = [];
  let total = 0;

  for (const [i, call] of calls.entries()) {
    const at = yield* Effect.fromResult(instant(call.at));
    const { input, output, read: cached, write1h, write5m } = call.tokens;
    total += call.usd;
    lines.push(
      encodeTurn({
        call: i + 1,
        at: local(zone, at),
        context: input + write5m + write1h + cached,
        write: write5m + write1h,
        output,
        tools: call.tools,
        usd: rounded(call.usd, 5),
        total: rounded(total, 4),
      }),
    );
  }

  return lines;
});

const said = (name: string, description: string) =>
  Flag.String(name).pipe(
    Flag.withDescription(description),
    Flag.optional,
    Flag.map(Option.filter((value) => value !== "")),
    Flag.map(Option.getOrNull),
  );

const clauderow = Command.make(
  "clauderow",
  {
    run: said("run", "The row's id, so parent and corrects can name it; needed unless --turns"),
    billing: Flag.Literals("billing", Billing.literals).pipe(
      Flag.withDescription("How the run was paid; left out of the row when not given"),
      Flag.optional,
      Flag.map(Option.getOrNull),
    ),
    role: Flag.String("role").pipe(Flag.withDefault("hand")),
    ticket: said("ticket", "The ticket the run worked on"),
    pr: said("pr", "The pull request the run worked on"),
    parent: said("parent", "The run that started this one"),
    outcome: said("outcome", "How the run ended"),
    note: said("note", "The field note about this run"),
    corrects: said("corrects", "The earlier row this one corrects"),
    step: said("step", "The pipeline step the run did"),
    turns: Flag.Boolean("turns").pipe(
      Flag.withDescription("Print one line per model call, and no row"),
      Flag.withDefault(false),
    ),
    transcript: Argument.String("transcript"),
    reason: Argument.String("reason").pipe(Argument.variadic()),
  },
  ({ reason, run, transcript, turns: perCall, ...ask }) =>
    Effect.gen(function* () {
      if (perCall) {
        return yield* Effect.forEach(yield* turns(transcript), (line) => Console.log(line), {
          concurrency: 1,
          discard: true,
        });
      }

      if (run === null) {
        return yield* new Refused({
          reason: "--run is required: a row needs its id so parent and corrects can name it",
        });
      }

      return yield* Console.log(yield* row(transcript, { ...ask, run, reason: reason.join(" ") }));
    }).pipe(Effect.tapError((refused) => Console.error(`clauderow: ${refused.reason}`))),
);

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(clauderow, { version: "0.0.0" })(process.argv.slice(2)).pipe(
      Effect.provide(Layer.mergeAll(NodeServices.layer, DateTime.layerCurrentZoneLocal)),
    ),
    { disableErrorReporting: true },
  );
}
