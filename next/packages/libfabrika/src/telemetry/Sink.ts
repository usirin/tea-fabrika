// The span sink: every object installs one Tracer, and a span that ends is in the object's own SQLite
// before `end` returns. `flush` ships it to its record later, when the runner says. Tier 1, P37
// (laws p98, p99 and p101).
//
// The queue is a table, `unsent`, not memory: an object sleeps and loses memory, and a timer fiber
// is what "a wait is data" forbids. Nothing is dropped. A write that cannot land (`SQLITE_FULL`) is
// held in memory and tried again at each later `end`, and the next `flush` fails the step with
// `storage`: let it crash. The sink's own calls end no span.
import { applyCell } from "@demlik/tea";
import { Cause, Clock, Context, Effect, Exit, Layer, Option, Redacted, Result, Schema, Tracer } from "effect";
import type { Sql } from "../Sql.ts";
import type { Archive } from "./Archive.ts";
import {
  archiveDays,
  HEALTH_TABLES,
  hourStart,
  readSummaries,
  rollup,
  writeHealth,
  writeSize,
} from "./internal/measurements.ts";
import { type Ended, held, machine } from "./internal/sink.ts";
import { RecordManager } from "./Records.ts";
import {
  Chain,
  chainName,
  errorClass,
  OBJECT,
  PROCESS,
  SinkError,
  SpanRow,
  type MetricPoint,
  short,
  sinkError,
  type Tag,
} from "./Trace.ts";

export { SinkError } from "./Trace.ts";

const ERROR = "error.type";
const DROPPED = "fab.sink.dropped";
/** The most characters of a failure's text kept as content: half a Durable Object row. */
const MOST_CONTENT = 1_000_000;
/** How many spans one record call carries. */
const BATCH = 100;

const SINK_TABLES = [
  `CREATE TABLE IF NOT EXISTS unsent (
		"spanId" TEXT PRIMARY KEY, chain TEXT NOT NULL, row TEXT NOT NULL, content TEXT)`,
  `CREATE TABLE IF NOT EXISTS parts (chain TEXT PRIMARY KEY, part INTEGER NOT NULL)`,
];

const Unsent = Schema.Struct({
  spanId: Schema.String,
  chain: Schema.fromJsonString(Chain),
  row: Schema.fromJsonString(SpanRow),
  content: Schema.NullOr(Schema.String),
});

const decodeUnsent = Schema.decodeUnknownSync(Unsent);
const encodeChain = Schema.encodeSync(Schema.fromJsonString(Chain));
const encodeRow = Schema.encodeSync(Schema.fromJsonString(SpanRow));
const decodePart = Schema.decodeUnknownSync(Schema.Struct({ part: Schema.Int }));

/** Tags as a row keeps them: strings (cut at 128), finite numbers, booleans, and `Redacted` as
 *  `"<redacted>"`. Anything else is dropped, and counted. */
const keep = (attributes: Iterable<readonly [string, unknown]>) => {
  const tags: Record<string, Tag> = {};
  let dropped = 0;

  for (const [key, value] of attributes) {
    if (Redacted.isRedacted(value)) {
      tags[key] = "<redacted>";
    } else if (typeof value === "string") {
      Object.assign(tags, short({ [key]: value }));
    } else if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      tags[key] = value;
    } else {
      dropped += 1;
    }
  }

  return { tags, dropped };
};

/** The span's own `fab.process`, else its nearest ancestor's, else none. */
const findProcess = (span: Tracer.AnySpan): Option.Option<string> => {
  if (span._tag === "ExternalSpan") {
    return Option.none();
  }

  const own = span.attributes.get(PROCESS);

  if (typeof own === "string" && own !== "") {
    return Option.some(own);
  }

  return Option.flatMap(span.parent, findProcess);
};

/** The largest numeric tag whose key ends in `.lag`, such as P6's `fab.ledger.lag`. */
const largestLag = (tags: Readonly<Record<string, Tag>>): number | null => {
  const lags = Object.entries(tags).flatMap(([key, value]) =>
    key.endsWith(".lag") && typeof value === "number" ? [value] : [],
  );
  return lags.length === 0 ? null : Math.max(...lags);
};

const cutContent = (text: string): string =>
  text.length <= MOST_CONTENT ? text : `${text.slice(0, MOST_CONTENT)}\n[cut: ${text.length} characters]`;

/** Turns an ended span into its rows. Pure: no write, no clock but the span's own times. `object`
 *  is the one that ended it, the row's resource. */
const ended = (span: Tracer.NativeSpan, endTime: bigint, exit: Exit.Exit<unknown, unknown>, object: string): Ended => {
  const own = keep(span.attributes);
  const kept = span.events.map(([name, time, attributes]) => ({
    name,
    time,
    ...keep(Object.entries(attributes)),
  }));
  const links = span.links.map(({ span: linked, attributes }) => ({
    traceId: linked.traceId,
    spanId: linked.spanId,
    ...keep(Object.entries(attributes)),
  }));
  const dropped = [...kept, ...links].reduce((n, one) => n + one.dropped, own.dropped);
  const failure = Exit.isFailure(exit) ? Option.some(exit.cause) : Option.none();
  const error = Option.map(failure, (cause) => {
    const named = own.tags[ERROR];
    return typeof named === "string" ? named : errorClass(Cause.squash(cause));
  });
  const tags: Record<string, Tag> = {
    ...own.tags,
    ...Option.match(error, { onNone: () => ({}), onSome: (type) => ({ [ERROR]: type }) }),
    ...(dropped > 0 ? { [DROPPED]: dropped } : {}),
  };
  const startTime = span.status.startTime;
  const row = SpanRow.make({
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: Option.match(span.parent, {
      onNone: () => null,
      onSome: (parent) => parent.spanId,
    }),
    name: span.name,
    kind: span.kind,
    startTimeUnixNano: String(startTime),
    endTimeUnixNano: String(endTime),
    attributes: tags,
    events: kept.map(({ name, time, tags: attributes }) => ({
      name,
      timeUnixNano: String(time),
      attributes,
    })),
    links: links.map(({ traceId, spanId, tags: attributes }) => ({ traceId, spanId, attributes })),
    resource: { attributes: { [OBJECT]: object } },
    ok: Exit.isSuccess(exit),
  });
  return {
    health: {
      piece: span.name,
      at: Number(endTime / 1_000_000n),
      ms: Number(endTime - startTime) / 1_000_000,
      ok: row.ok,
      error: Option.getOrNull(error),
      lag: largestLag(tags),
      spanId: row.spanId,
    },
    chain: Option.match(findProcess(span), {
      onNone: () => Chain.cases.spans.make({}),
      onSome: (process) => Chain.cases.job.make({ process }),
    }),
    row,
    content: Option.getOrNull(Option.map(failure, (cause) => cutContent(Cause.pretty(cause)))),
  };
};

/** A span that tells the sink when it ends. Effect calls `end` once, synchronously. */
class SinkSpan extends Tracer.NativeSpan {
  private readonly onEnd: (span: SinkSpan, endTime: bigint, exit: Exit.Exit<unknown, unknown>) => void;

  constructor(
    options: ConstructorParameters<typeof Tracer.NativeSpan>[0],
    onEnd: (span: SinkSpan, endTime: bigint, exit: Exit.Exit<unknown, unknown>) => void,
  ) {
    super(options);
    this.onEnd = onEnd;
  }

  override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    if (this.status._tag === "Ended") {
      return;
    }

    super.end(endTime, exit);
    this.onEnd(this, endTime, exit);
  }
}

export class SpanSink extends Context.Service<
  SpanSink,
  {
    /** Sends `unsent` to each chain's current part, deleting each row only after a good answer and
     *  following `rolled`; then archives each due day of raw health rows. Fails with `storage`,
     *  before it sends anything, when an `end` met a write it could not land since the last flush. */
    readonly flush: Effect.Effect<{ readonly sent: number }, SinkError, RecordManager | Archive>;
    /** The summaries whose hour is in `[from, to)`, after rolling up every closed hour. */
    readonly summaries: (from: number, to: number) => Effect.Effect<ReadonlyArray<MetricPoint>, SinkError>;
  }
>()("@kampus/libfabrika/SpanSink") {
  /** Provides `Tracer.Tracer` and `SpanSink` over this object's `Sql`. Building it touches nothing:
   *  the tables come with the first span. */
  static readonly layer = (sql: Sql, who: { readonly object: string }): Layer.Layer<SpanSink> =>
    Layer.unwrap(
      Effect.sync(() => {
        const { tracer, sink } = make(sql, who);
        return Layer.merge(Layer.succeed(SpanSink, sink), Layer.succeed(Tracer.Tracer, tracer));
      }),
    );
}

const make = (sql: Sql, who: { readonly object: string }) => {
  let ready = false;
  /** Spans held after a full disk, a failure owed to the next flush, and the newest hour sized.
   *  Changed only by what `applyCell` returns. Memory only: a wake checks once more. */
  let state = machine.init(null, {})[0];

  /** Runs `step` as one atomic step, with the tables made first on first use. */
  const atomic = <A>(step: () => A): A =>
    sql.transaction(() => {
      if (!ready) {
        for (const query of [...HEALTH_TABLES, ...SINK_TABLES]) {
          sql.exec(query);
        }
      }

      ready = true;
      return step();
    });

  const land = ({ health, chain, row, content }: Ended) => {
    writeHealth(sql, health);
    sql.exec(
      `INSERT INTO unsent ("spanId", chain, row, content) VALUES (?, ?, ?, ?)`,
      row.spanId,
      encodeChain(chain),
      encodeRow(row),
      content,
    );
  };

  /** Lands the held spans and `more` in one step, then rolls up closed hours before `now`. A span's
   *  `end` also writes this hour's size row. A throw keeps every span held. */
  const commit = (more: ReadonlyArray<Ended>, now: number, sized: boolean): Result.Result<void, unknown> => {
    const hour = hourStart(now);
    const { checked } = state;
    const done = Result.try({
      try: () =>
        atomic(() => {
          for (const one of [...held(state), ...more]) {
            land(one);
          }

          if (hour > checked) {
            rollup(sql, now);

            if (sized) {
              writeSize(sql, now);
            }
          }
        }),
      catch: (error) => error,
    });
    state = applyCell(
      machine,
      state,
      Result.isFailure(done) ? { type: "commit_failed", more } : { type: "committed", hour, sized },
    )[0];
    return done;
  };

  const tracer = Tracer.make({
    span: (options) =>
      new SinkSpan(options, (span, endTime, exit) => {
        commit([ended(span, endTime, exit, who.object)], Number(endTime / 1_000_000n), true);
      }),
  });

  const attempt = Effect.fnUntraced(function* <A>(step: () => A) {
    return yield* Effect.try({ try: () => atomic(step), catch: sinkError });
  });

  /** Sends one chain's rows to its part, on through each `rolled`. Deletes only what landed. */
  const send = Effect.fnUntraced(function* (
    records: (typeof RecordManager)["Service"],
    chain: Chain,
    rows: ReadonlyArray<{ readonly span: SpanRow; readonly content: string | null }>,
  ) {
    const name = chainName(chain);
    let at = yield* attempt(() =>
      Option.match(Option.fromUndefinedOr(sql.exec(`SELECT part FROM parts WHERE chain = ?`, name)[0]), {
        onNone: () => 0,
        onSome: (row) => decodePart(row).part,
      }),
    );
    let left = rows;
    let sent = 0;

    while (left.length > 0) {
      const answer = yield* records.write(chain, at, left);
      const landed = answer._tag === "written" ? left.map((row) => row.span.spanId) : answer.had;
      const next = at + 1;
      yield* attempt(() => {
        for (const spanId of landed) {
          sql.exec(`DELETE FROM unsent WHERE "spanId" = ?`, spanId);
        }

        if (answer._tag === "rolled") {
          sql.exec(
            `INSERT INTO parts (chain, part) VALUES (?, ?)
							ON CONFLICT (chain) DO UPDATE SET part = excluded.part`,
            name,
            next,
          );
        }
      });
      sent += landed.length;

      if (answer._tag === "written") {
        return sent;
      }

      const had = new Set(answer.had);
      left = left.filter((row) => !had.has(row.span.spanId));
      at = next;
    }

    return sent;
  });

  const flush = Effect.gen(function* () {
    const before = state;
    state = applyCell(machine, state, { type: "flush_checked" })[0];

    if (before._tag !== "clean") {
      return yield* Effect.fail(new SinkError({ reason: "storage", held: held(before).length }));
    }

    const records = yield* RecordManager;
    const unsent = yield* attempt(() =>
      sql.exec(`SELECT * FROM unsent ORDER BY rowid`).map((row) => decodeUnsent(row)),
    );
    const chains = new Map<string, { chain: Chain; rows: Array<{ span: SpanRow; content: string | null }> }>();

    for (const { chain, row, content } of unsent) {
      const name = chainName(chain);
      const group = chains.get(name) ?? { chain, rows: [] };
      group.rows.push({ span: row, content });
      chains.set(name, group);
    }

    let sent = 0;

    for (const { chain, rows } of chains.values()) {
      for (let from = 0; from < rows.length; from += BATCH) {
        sent += yield* send(records, chain, rows.slice(from, from + BATCH));
      }
    }

    yield* archiveDays(sql, who.object, yield* Clock.currentTimeMillis);
    return { sent };
  });

  const summaries = Effect.fnUntraced(function* (from: number, to: number) {
    const done = commit([], yield* Clock.currentTimeMillis, false);

    if (Result.isFailure(done)) {
      return yield* Effect.fail(new SinkError({ reason: "storage", held: held(state).length }));
    }

    return yield* attempt(() => readSummaries(sql, from, to));
  });

  return { tracer, sink: { flush, summaries } };
};
