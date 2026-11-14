// The referee: the one place that numbers the log. Plain code over a synchronous `Sql`, the same on
// workerd (a Durable Object's SQLite) and on Node (node:sqlite, in tests). Tier 1, P6 (laws p18,
// p20, p68, p92 to p95).
//
// An append is decided and written in one `Sql.transaction`, so nothing runs between the number and
// the write. A wait answers at once: `ready`, or a ring row that the next append past it takes out
// in its own step and rings once. No fiber, timer or Deferred is left behind, so the object can
// sleep under a parked wait. Every call ends one span with names, ids and numbers only.
import { Effect, Equal, Exit, Option, Result, Schema } from "effect";
import { ParentText, Rev } from "../../Rev.ts";
import type { Sql, SqlValue } from "../../Sql.ts";
import { causeClass, errorClass, short } from "../../telemetry/Trace.ts";
import type { Doorbell } from "../Ledger.ts";
import { LedgerError } from "../Ledger.ts";
import type { LedgerTurn } from "../LedgerTransaction.ts";
import { Appended, Entry, Line, PAGE, Row, ROW_BYTES, Waited } from "../Log.ts";
import type { Referee } from "../Referee.ts";
import { STREAM, tag } from "./ledgerTrace.ts";

const TABLES = [
  `CREATE TABLE IF NOT EXISTS entries (
		rev INTEGER PRIMARY KEY, stream TEXT NOT NULL, pos INTEGER NOT NULL, id TEXT NOT NULL,
		"arrivedAt" INTEGER NOT NULL, "by" TEXT NOT NULL, "for" TEXT NOT NULL, "sentAt" TEXT NOT NULL,
		seen INTEGER NOT NULL, parent TEXT, "traceId" TEXT NOT NULL,
		build TEXT NOT NULL, "_tag" TEXT NOT NULL, body TEXT NOT NULL,
		UNIQUE (stream, pos), UNIQUE (stream, id))`,
  `CREATE INDEX IF NOT EXISTS entries_by_stream ON entries (stream, rev)`,
  `CREATE TABLE IF NOT EXISTS rings (
		"to" TEXT NOT NULL, stream TEXT NOT NULL, after INTEGER NOT NULL, PRIMARY KEY ("to", stream))`,
];

/** Span tag keys past `STREAM` and `tag`: OpenTelemetry's messaging and error names. */
const ID = "messaging.message.id";
const OPERATION = "messaging.operation.type";
const ERROR = "error.type";

/** A waiter to ring, as the rings table holds it. */
const Ring = Schema.Struct({ to: Schema.String, after: Rev });
type Ring = typeof Ring.Type;

/** What one append step did. Only `placed` wrote, and only it rings. */
const Placing = Schema.TaggedUnion({
  placed: { rev: Rev, pos: Rev, rings: Schema.Array(Ring) },
  resent: { rev: Rev, pos: Rev },
  refused: Appended.cases.refused.fields,
});
type Placing = typeof Placing.Type;

const Head = Schema.Struct({ rev: Rev, arrivedAt: Schema.Int });
const Last = Schema.Struct({ pos: Rev });
/** A stream's newest rev, 0 when it is empty. */
const Top = Schema.Struct({ rev: Rev });
/** A stream's newest rev, and how many of its entries sit past a reader's `after`. */
const Lag = Schema.Struct({ head: Rev, lag: Rev });

/** Checks types before telling a bad parent or trace id apart from a bad line. */
const Loose = Schema.Struct({
  ...Line.fields,
  parent: Schema.NullOr(Schema.String),
  traceId: Schema.String,
});

const strict = { onExcessProperty: "error" } as const;
const decodeLoose = Schema.decodeUnknownResult(Loose, strict);
const isParent = Schema.is(Schema.NullOr(ParentText));
const decodeLine = Schema.decodeUnknownResult(Line, strict);

const decodeId = Schema.decodeUnknownResult(Schema.Struct({ stream: Entry.fields.stream, id: Entry.fields.id }));

const decodeRow = Schema.decodeUnknownSync(Row);
const decodeRing = Schema.decodeUnknownSync(Ring);
const decodeHead = Schema.decodeUnknownSync(Head);
const decodeLast = Schema.decodeUnknownSync(Last);
const decodeTop = Schema.decodeUnknownSync(Top);
const decodeLag = Schema.decodeUnknownSync(Lag);
const decodeStream = Schema.decodeUnknownSync(Schema.Struct({ stream: Schema.String }));

const encoder = new TextEncoder();

const bytes = (texts: ReadonlyArray<string | null>): number =>
  texts.reduce((n, text) => n + (text === null ? 0 : encoder.encode(text).length), 0);

type Reason = (typeof Appended.cases.refused.Type)["reason"];

/** The line, checked: shape (p92), parent (p68), trace (p68b) and row size (flag 13). */
const check = (stream: string, id: string, input: unknown): Result.Result<Line, Reason> => {
  if (Result.isFailure(decodeId({ stream, id }))) {
    return Result.fail("bad_line");
  }

  const loose = decodeLoose(input);

  if (Result.isFailure(loose)) {
    return Result.fail("bad_line");
  }

  if (!isParent(loose.success.parent)) {
    return Result.fail("bad_parent");
  }

  const line = decodeLine(loose.success);

  if (Result.isFailure(line)) {
    return Result.fail("bad_trace");
  }

  const { by, sentAt, parent, traceId, build, body } = line.success;
  const texts = [stream, id, by, line.success.for, sentAt, parent, traceId, build, line.success._tag];
  const size = bytes([...texts, JSON.stringify(body)]);
  // node:sqlite answers what workerd would (flag 13).
  return size > ROW_BYTES ? Result.fail("too_big") : Result.succeed(line.success);
};

/** What decides an append. The writer's clock and trace never decide (D3, S1). */
type Decides = Omit<Line, "sentAt" | "traceId">;

/** A resend is the same `by`, `for`, `parent`, `_tag` and `body`; `seen` and `build` may differ. */
const same = (line: Decides, first: Decides): boolean =>
  line.by === first.by &&
  line.for === first.for &&
  line.parent === first.parent &&
  line._tag === first._tag &&
  Equal.equals(line.body, first.body);

/** The answer when the line is not written, or none when it is new and in range. */
const decide = (
  line: Decides,
  first: Option.Option<Decides & Pick<Entry, "rev" | "pos">>,
  head: Rev,
): Option.Option<Placing> =>
  Option.match(first, {
    onSome: (entry) =>
      Option.some(
        same(line, entry)
          ? Placing.cases.resent.make({ rev: entry.rev, pos: entry.pos })
          : Placing.cases.refused.make({ reason: "id_reused" }),
      ),
    onNone: () =>
      line.seen > head ? Option.some(Placing.cases.refused.make({ reason: "seen_ahead" })) : Option.none(),
  });

/** What an atomic step threw: a SQL error, or a row that did not decode. Typed at once below. */
class Threw extends Schema.TaggedError<Threw>()("Threw", { error: Schema.Unknown }) {}

/** SQLite's own error code, as node:sqlite gives it (`errcode`), or the platform's `code`. */
const errorCode = (error: unknown): Option.Option<string | number> => {
  if (typeof error !== "object" || error === null) {
    return Option.none();
  }

  const code = "errcode" in error ? error.errcode : "code" in error ? error.code : undefined;
  return typeof code === "number" || typeof code === "string" ? Option.some(code) : Option.none();
};

/** @internal */
export const ledgerStore = (
  sql: Sql,
  doorbell: (typeof Doorbell)["Service"],
): (typeof Referee)["Service"] & {
  readonly transact: <A>(step: (turn: LedgerTurn) => A) => Effect.Effect<A, LedgerError>;
  readonly streams: (prefix: string, after: string | null) => Effect.Effect<ReadonlyArray<string>, LedgerError>;
} => {
  let ready = false;
  const one = (query: string, ...params: ReadonlyArray<SqlValue>): Option.Option<unknown> =>
    Option.fromUndefinedOr(sql.exec(query, ...params)[0]);

  /** Runs `work` as one atomic step, reading the referee's clock inside it. A throw is typed. */
  const atomic = Effect.fnUntraced(function* <A>(work: (now: () => number) => A) {
    return yield* Effect.clockWith((clock) =>
      Effect.try({
        try: () => {
          if (!ready) {
            sql.transaction(() => {
              for (const query of TABLES) {
                sql.exec(query);
              }
            });
            ready = true;
          }

          return sql.transaction(() => work(() => clock.currentTimeMillisUnsafe()));
        },
        catch: (error) => new Threw({ error }),
      }),
    ).pipe(
      Effect.catch(({ error }) => {
        if (error instanceof LedgerError) {
          return Effect.fail(error);
        }

        const reason = Schema.isSchemaError(error) ? "bad_row" : "storage";
        const failure = new LedgerError({
          reason,
          ...(error instanceof Error ? { message: error.message } : {}),
          cause: error,
        });
        // The class and code are tags; the message rides only in the span's failure, its content.
        return Effect.annotateCurrentSpan({
          [tag("reason")]: reason,
          [ERROR]: errorClass(error),
          ...Option.match(errorCode(error), {
            onNone: () => ({}),
            onSome: (code) => ({ [tag("code")]: code }),
          }),
        }).pipe(Effect.andThen(Effect.fail(failure)));
      }),
    );
  });

  const behind = (stream: string, after: Rev) =>
    decodeLag(
      Option.getOrThrow(
        one(
          `SELECT coalesce(max(rev), 0) AS head, coalesce(sum(rev > ?), 0) AS lag
					FROM entries WHERE stream = ?`,
          after,
          stream,
        ),
      ),
    );

  /** The stream's entry under `id`, by the UNIQUE (stream, id) index. */
  const byId = (stream: string, id: string): Option.Option<Entry> =>
    Option.map(one(`SELECT * FROM entries WHERE stream = ? AND id = ?`, stream, id), (row) => decodeRow(row));

  const place = (stream: string, id: string, line: Line, now: () => number): Placing => {
    const first = byId(stream, id);
    const last = Option.map(one(`SELECT rev, "arrivedAt" FROM entries ORDER BY rev DESC LIMIT 1`), (row) =>
      decodeHead(row),
    );
    const head = Option.match(last, { onNone: () => 0, onSome: (row) => row.rev });
    const answered = decide(line, first, head);

    if (Option.isSome(answered)) {
      return answered.value;
    }

    const rev = head + 1;
    const pos =
      decodeLast(Option.getOrThrow(one(`SELECT coalesce(max(pos), 0) AS pos FROM entries WHERE stream = ?`, stream)))
        .pos + 1;
    const arrivedAt = Math.max(now(), Option.match(last, { onNone: () => 0, onSome: (row) => row.arrivedAt }));
    sql.exec(
      `INSERT INTO entries (rev, stream, pos, id, "arrivedAt", "by", "for", "sentAt", seen, parent,
				"traceId", build, "_tag", body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      rev,
      stream,
      pos,
      id,
      arrivedAt,
      line.by,
      line.for,
      line.sentAt,
      line.seen,
      line.parent,
      line.traceId,
      line.build,
      line._tag,
      JSON.stringify(line.body),
    );
    const rings = sql
      .exec(`DELETE FROM rings WHERE stream = ? AND after < ? RETURNING "to", after`, stream, rev)
      .map((row) => decodeRing(row));
    return Placing.cases.placed.make({ rev, pos, rings });
  };

  /** Rings one waiter, at most once: a failed ring is gone all the same, kept only in its span. A
   *  ring that fails or dies, even by throwing before it gives an Effect, never changes the append. */
  const ring = Effect.fn("ledger.ring")(function* (stream: string, rev: Rev, { to, after }: Ring) {
    yield* Effect.annotateCurrentSpan({
      ...short({ [STREAM]: stream, [tag("to")]: to }),
      [tag("after")]: after,
      [tag("rev")]: rev,
    });
    return yield* Effect.suspend(() => doorbell.ring(to, stream, rev)).pipe(
      Effect.onExit((exit) =>
        Effect.annotateCurrentSpan(
          Exit.match(exit, {
            onSuccess: () => ({ [tag("ok")]: true }),
            onFailure: (cause) => ({ [tag("ok")]: false, [ERROR]: causeClass(cause) }),
          }),
        ),
      ),
    );
  });

  const refused = Effect.fnUntraced(function* (reason: Reason) {
    return yield* Effect.as(
      Effect.annotateCurrentSpan({ [tag("answer")]: "refused", [tag("reason")]: reason }),
      Appended.cases.refused.make({ reason }),
    );
  });

  const append = Effect.fn("ledger.append")(function* (stream: string, id: string, input: unknown) {
    yield* Effect.annotateCurrentSpan({
      ...short({ [STREAM]: stream, [ID]: id }),
      [OPERATION]: "send",
    });
    const checked = check(stream, id, input);

    if (Result.isFailure(checked)) {
      return yield* refused(checked.failure);
    }

    const line = checked.success;
    yield* Effect.annotateCurrentSpan(short({ [tag("tag")]: line._tag, [tag("by")]: line.by }));
    const placing = yield* atomic((now) => place(stream, id, line, now));
    return yield* Placing.match(placing, {
      refused: ({ reason }) => refused(reason),
      resent: ({ rev, pos }) =>
        Effect.as(
          Effect.annotateCurrentSpan({
            [tag("answer")]: "resent",
            [tag("rev")]: rev,
            [tag("pos")]: pos,
          }),
          Appended.cases.placed.make({ rev, pos }),
        ),
      placed: ({ rev, pos, rings }) =>
        Effect.forEach(rings, (waiter) => ring(stream, rev, waiter).pipe(Effect.catchCause(() => Effect.void)), {
          concurrency: "unbounded",
          discard: true,
        }).pipe(
          Effect.andThen(
            Effect.annotateCurrentSpan({
              [tag("answer")]: "placed",
              [tag("rev")]: rev,
              [tag("pos")]: pos,
              [tag("rings")]: rings.length,
            }),
          ),
          Effect.as(Appended.cases.placed.make({ rev, pos })),
        ),
    });
  });

  const read = Effect.fn("ledger.read")(function* (stream: string, after: Rev, reader: string) {
    yield* Effect.annotateCurrentSpan({
      ...short({ [STREAM]: stream, [tag("reader")]: reader }),
      [OPERATION]: "receive",
      [tag("after")]: after,
    });
    return yield* atomic((now) => {
      const { head, lag } = behind(stream, after);
      const entries = sql
        .exec(`SELECT * FROM entries WHERE stream = ? AND rev > ? ORDER BY rev LIMIT ?`, stream, after, PAGE)
        .map((row) => decodeRow(row));
      return { head, lag, entries, at: now() };
    }).pipe(
      Effect.tap(({ head, lag, entries, at }) =>
        Effect.annotateCurrentSpan({
          [tag("head")]: head,
          [tag("lag")]: lag,
          [tag("rows")]: entries.length,
          // The longest any returned entry waited to be seen, on the referee's one clock.
          ...(entries[0] === undefined ? {} : { [tag("visible_ms")]: at - entries[0].arrivedAt }),
        }),
      ),
      Effect.map(({ entries }) => entries),
    );
  });

  const wait = Effect.fn("ledger.wait")(function* (stream: string, after: Rev, reader: string) {
    yield* Effect.annotateCurrentSpan({
      ...short({ [STREAM]: stream, [tag("reader")]: reader }),
      [tag("after")]: after,
    });
    return yield* atomic(() => {
      const { head, lag } = behind(stream, after);

      if (head > after) {
        return { head, lag, waited: Waited.cases.ready.make({ rev: head }) };
      }

      sql.exec(
        `INSERT INTO rings ("to", stream, after) VALUES (?, ?, ?)
				ON CONFLICT ("to", stream) DO UPDATE SET after = min(after, excluded.after)`,
        reader,
        stream,
        after,
      );
      return { head, lag, waited: Waited.cases.parked.make({}) };
    }).pipe(
      Effect.tap(({ head, lag, waited }) =>
        Effect.annotateCurrentSpan({
          [tag("head")]: head,
          [tag("lag")]: lag,
          [tag("answer")]: waited._tag,
        }),
      ),
      Effect.map(({ waited }) => waited),
    );
  });

  const inTurn = <A>(step: (turn: LedgerTurn) => A, now: () => number) => {
    const rings: Array<{ stream: string; rev: Rev; waiter: Ring }> = [];
    let open = true;
    const ensureOpen = () => {
      if (!open) {
        throw new LedgerError({ reason: "storage", message: "ledger turn has ended" });
      }
    };
    const turn: LedgerTurn = {
      read: (stream, after) => {
        ensureOpen();
        return sql
          .exec(`SELECT * FROM entries WHERE stream = ? AND rev > ? ORDER BY rev`, stream, after)
          .map((row) => decodeRow(row));
      },
      get: (stream, id) => {
        ensureOpen();
        return byId(stream, id);
      },
      head: (stream) => {
        ensureOpen();
        return decodeTop(
          Option.getOrThrow(one(`SELECT coalesce(max(rev), 0) AS rev FROM entries WHERE stream = ?`, stream)),
        ).rev;
      },
      append: (stream, id, input) => {
        ensureOpen();
        const checked = check(stream, id, input);

        if (Result.isFailure(checked)) {
          throw new LedgerError({ reason: "refused" });
        }

        const placing = place(stream, id, checked.success, now);

        if (placing._tag === "refused") {
          throw new LedgerError({ reason: "refused" });
        }

        if (placing._tag === "placed") {
          for (const waiter of placing.rings) {
            rings.push({ stream, rev: placing.rev, waiter });
          }
        }

        return { rev: placing.rev, pos: placing.pos };
      },
    };

    try {
      return { value: step(turn), rings };
    } finally {
      open = false;
    }
  };
  const transact = Effect.fn("ledger.transaction")(function* <A>(step: (turn: LedgerTurn) => A) {
    const committed = yield* atomic((now) => inTurn(step, now));
    yield* Effect.forEach(
      committed.rings,
      ({ stream, rev, waiter }) => ring(stream, rev, waiter).pipe(Effect.catchCause(() => Effect.void)),
      {
        discard: true,
        concurrency: 1,
      },
    );
    return committed.value;
  });

  const streams = Effect.fn("ledger.streams")(function* (prefix: string, after: string | null) {
    return yield* atomic(() =>
      sql
        .exec(
          `SELECT DISTINCT stream FROM entries
         WHERE substr(stream, 1, length(?)) = ? AND (? IS NULL OR stream > ?)
         ORDER BY stream LIMIT ?`,
          prefix,
          prefix,
          after,
          after,
          PAGE,
        )
        .map((row) => decodeStream(row).stream),
    );
  });

  return { append, read, wait, transact, streams };
};
