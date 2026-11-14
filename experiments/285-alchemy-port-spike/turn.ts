// Experiment 285, next/. One Effect Durable Object that runs the same work on two turns:
//
//   S   today's turn:   storage.transactionSync(step)                        (CloudflareSql.ts on main)
//   Sb  the plan's turn: state.storage.transaction(Effect.sync(step))        (Alchemy's wrapper, no raw handle)
//   St  Sb with a typed throw: state.storage.transaction(Effect.try(step))
//
// The ledger here is the real one, `LedgerSql.layer` from libfabrika, unchanged. On S it gets today's
// driver. On Sb its own `sql.transaction` only runs the step, and the whole ledger call runs as one
// plain synchronous step inside Alchemy's Effect transaction. That is the same turn S5 builds, with
// the Effect boundary one call further out, so no product file had to change for the run.
import * as Cloudflare from "@alchemy.run/cloudflare";
import { Doorbell, Ledger } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerSql from "@kampus/libfabrika/ledger/LedgerSql";
import type { Line } from "@kampus/libfabrika/ledger/Log";
import type { Sql, SqlValue } from "@kampus/libfabrika/Sql";
import { Cause, Clock, Effect, Exit, Layer, Stream } from "effect";

type Route = "S" | "Sb" | "St";

interface TurnShape {
  readonly run: (op: string, body: unknown) => Effect.Effect<unknown>;
}

export class Turn extends Cloudflare.DurableObject<Turn, TurnShape>()("Turn") {}

/** Thrown inside a step to roll the turn back, with the ledger call's own exit kept. */
class Rollback extends Error {
  readonly exit: Exit.Exit<unknown, unknown>;

  constructor(exit: Exit.Exit<unknown, unknown>) {
    super("rollback");
    this.exit = exit;
  }
}

/** A ledger call as one plain step: it runs to its end synchronously, and a failed call throws. */
const wholeCall =
  <A, E>(work: Effect.Effect<A, E>) =>
  (): Exit.Exit<A, E> => {
    const exit = Effect.runSyncExit(work);

    if (Exit.isFailure(exit)) {
      throw new Rollback(exit);
    }

    return exit;
  };

/** What a step that throws does. */
const thrown = (): never => {
  throw new RangeError("the step threw");
};

const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** How an Effect ended, as plain data two routes can be compared by. */
const shown = (exit: Exit.Exit<unknown, unknown>): unknown => {
  if (Exit.isSuccess(exit)) {
    return { ok: exit.value };
  }

  const [reason] = exit.cause.reasons;
  const error = reason !== undefined && Cause.isFailReason(reason) ? reason.error : undefined;
  const defect = reason !== undefined && Cause.isDieReason(reason) ? reason.defect : undefined;
  const of = (value: unknown) =>
    typeof value === "object" && value !== null
      ? {
          class: value.constructor.name,
          ...("_tag" in value ? { _tag: value._tag } : {}),
          ...("reason" in value ? { reason: value.reason } : {}),
          ...("message" in value ? { message: String(value.message).slice(0, 160) } : {}),
        }
      : String(value);
  return error !== undefined ? { fail: of(error) } : { die: of(defect) };
};

const digest = (text: string) =>
  Effect.promise(async () => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  });

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

const line = (over: Partial<Line>): Line => ({
  by: "SHA256:writer-a",
  for: "owner",
  sentAt: "2026-11-13T21:10:01.204Z",
  seen: 0,
  parent: null,
  traceId: TRACE,
  build: "b-285",
  _tag: "saved",
  body: { note: "n", base: 1 },
  ...over,
});

export const TurnLive = Turn.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    const native = state.raw.storage;
    const exec = (query: string, ...params: ReadonlyArray<SqlValue>) =>
      Array.from(native.sql.exec(query, ...params)) as ReadonlyArray<Record<string, SqlValue>>;

    // The three turns. Each takes a plain step and answers with how it ended.
    const turn = <A>(route: Route, step: () => A): Effect.Effect<Exit.Exit<A, unknown>> =>
      route === "S"
        ? Effect.exit(Effect.try({ try: () => native.transactionSync(step), catch: (error) => error }))
        : route === "Sb"
          ? Effect.exit(state.storage.transaction(Effect.sync(step)))
          : Effect.exit(state.storage.transaction(Effect.try({ try: step, catch: (error) => error })));

    // A clock that only counts, so two routes write the same `arrivedAt`.
    let tick = 1_700_000_000_000;
    const counting: Clock.Clock = {
      currentTimeMillisUnsafe: () => tick++,
      currentTimeMillis: Effect.sync(() => tick++),
      currentTimeNanosUnsafe: () => BigInt(tick++) * 1_000_000n,
      currentTimeNanos: Effect.sync(() => BigInt(tick++) * 1_000_000n),
      sleep: () => Effect.void,
    };
    const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });
    const ledgerOn = (sql: Sql) =>
      Effect.runSync(
        Layer.build(LedgerSql.layer(sql, { reader: "connection:t1" }).pipe(Layer.provide(quiet))).pipe(
          Effect.provideService(Clock.Clock, counting),
          Effect.scoped,
        ),
      );
    // Today's driver, the lines of CloudflareSql.ts on main.
    const today: Sql = {
      exec,
      transaction: (step) => native.transactionSync(step),
      size: () => native.sql.databaseSize,
    };
    // The driver for a call that already runs inside the Effect transaction.
    const inside: Sql = { exec, transaction: (step) => step(), size: () => native.sql.databaseSize };
    const ledgers = { S: ledgerOn(today), Sb: ledgerOn(inside), St: ledgerOn(inside) };

    /** One ledger call on one route, ending in its own exit. */
    const ledger = <A>(route: Route, call: (ledger: (typeof Ledger)["Service"]) => Effect.Effect<A, unknown>) => {
      const work = Ledger.use(call).pipe(Effect.provide(ledgers[route]), Effect.provideService(Clock.Clock, counting));

      if (route === "S") {
        return Effect.exit(work);
      }

      // The whole call is the step, so a failed call rolls the turn back.
      return turn(route, wholeCall(work)).pipe(
        Effect.map((outer): Exit.Exit<A, unknown> => {
          if (Exit.isSuccess(outer)) {
            return outer.value;
          }

          const [reason] = outer.cause.reasons;
          const thrown =
            reason !== undefined && Cause.isDieReason(reason)
              ? reason.defect
              : reason !== undefined && Cause.isFailReason(reason)
                ? reason.error
                : undefined;
          return thrown instanceof Rollback ? (thrown.exit as Exit.Exit<A, unknown>) : (outer as Exit.Exit<A, unknown>);
        }),
      );
    };

    const dump = Effect.gen(function* () {
      const tables = exec(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name`,
      ).map((row) => String(row.name));
      const rows = Object.fromEntries(tables.map((name) => [name, exec(`SELECT * FROM "${name}" ORDER BY rowid`)]));
      return {
        tables: Object.fromEntries(tables.map((name) => [name, rows[name]?.length ?? 0])),
        hash: yield* digest(JSON.stringify(rows)),
      };
    });

    const scratch = () => exec(`CREATE TABLE IF NOT EXISTS scratch (n INTEGER PRIMARY KEY, note TEXT NOT NULL)`);
    const count = () => Number(exec(`SELECT COUNT(*) AS c FROM scratch`)[0]?.c ?? 0);

    /** Every way a plain step can end, on one route. */
    const cases = (route: Route) =>
      Effect.gen(function* () {
        scratch();
        exec(`DELETE FROM scratch`);
        const out: Record<string, unknown> = {};
        const one = <A>(name: string, step: () => A) =>
          Effect.gen(function* () {
            const before = count();
            const exit = yield* turn(route, step);
            out[name] = { before, after: count(), exit: shown(exit) };
          });
        yield* one("commit", () => {
          exec(`INSERT INTO scratch VALUES (1, 'a')`);
          exec(`INSERT INTO scratch VALUES (2, 'b')`);
          return count();
        });
        yield* one("throw", () => {
          exec(`INSERT INTO scratch VALUES (3, 'c')`);
          exec(`INSERT INTO scratch VALUES (4, 'd')`);
          return thrown();
        });
        yield* one("unique", () => {
          exec(`INSERT INTO scratch VALUES (5, 'e')`);
          return exec(`INSERT INTO scratch VALUES (1, 'again')`).length;
        });
        yield* one("reads its own writes", () => {
          exec(`INSERT INTO scratch VALUES (6, 'f')`);
          return exec(`SELECT note FROM scratch WHERE n = 6`)[0]?.note;
        });
        yield* one("260 inserts", () => {
          for (let n = 100; n < 360; n++) {
            exec(`INSERT INTO scratch VALUES (?, 'bulk')`, n);
          }

          return count();
        });
        yield* one("returns null", () => null);
        // The next call after a failed turn works, with no gap in what it sees.
        yield* one("after a failure", () => exec(`SELECT MAX(n) AS n FROM scratch`)[0]?.n);
        return out;
      });

    /** A seeded run of ledger calls. The same seed gives the same calls on every route. */
    const workload = (route: Route, seed: number, calls: number) =>
      Effect.gen(function* () {
        const random = mulberry(seed);
        const pick = (n: number) => Math.floor(random() * n);
        const streams = ["tickets", "notes", "mail"];
        const sent: Array<{ stream: string; id: string; line: Line }> = [];
        const answers: Array<unknown> = [];
        let head = 0;
        // The store makes its tables in a turn of its own on first use. Do that before the run, so
        // a first call that is refused cannot take the tables down with it on Sb.
        yield* ledger(route, (l) => l.wait("tickets", 0));
        // A planted storage failure, as experiment 249 planted it: a real trigger that aborts.
        exec(
          `CREATE TRIGGER IF NOT EXISTS planted BEFORE INSERT ON entries WHEN NEW.id LIKE 'boom%' BEGIN SELECT RAISE(ABORT, 'planted'); END`,
        );

        for (let n = 0; n < calls; n++) {
          const stream = streams[pick(streams.length)] ?? "tickets";
          const roll = pick(100);
          const old = sent.length > 0 ? sent[pick(sent.length)] : undefined;

          if (roll < 50 || old === undefined) {
            const id = `in-${seed}-${n}`;
            const body = line({ seen: pick(head + 1), body: { note: `n-${n}`, base: pick(9) } });
            const exit = yield* ledger(route, (l) => l.append(stream, id, body));
            sent.push({ stream, id, line: body });

            if (Exit.isSuccess(exit) && exit.value._tag === "placed") {
              head = exit.value.rev;
            }

            answers.push(["append", shown(exit)]);
          } else if (roll < 62) {
            answers.push(["resend", shown(yield* ledger(route, (l) => l.append(old.stream, old.id, old.line)))]);
          } else if (roll < 72) {
            const changed = { ...old.line, body: { note: "changed", base: n } };
            answers.push(["reuse", shown(yield* ledger(route, (l) => l.append(old.stream, old.id, changed)))]);
          } else if (roll < 80) {
            const ahead = line({ seen: head + 1 + pick(5) });
            answers.push(["ahead", shown(yield* ledger(route, (l) => l.append(stream, `in-${seed}-a${n}`, ahead)))]);
          } else if (roll < 83) {
            // The insert fails late in the turn, after the turn's reads.
            answers.push(["boom", shown(yield* ledger(route, (l) => l.append(stream, `boom-${seed}-${n}`, line({}))))]);
          } else if (roll < 86) {
            const bad = line({ traceId: "0".repeat(32) });
            answers.push(["bad", shown(yield* ledger(route, (l) => l.append(stream, `in-${seed}-b${n}`, bad)))]);
          } else if (roll < 95) {
            const after = pick(head + 1);
            const exit = yield* ledger(route, (l) =>
              Stream.runCollect(l.read(stream, after)).pipe(Effect.map((rows) => Array.from(rows))),
            );
            answers.push(["read", shown(exit)]);
          } else {
            answers.push(["wait", shown(yield* ledger(route, (l) => l.wait(stream, pick(head + 1))))]);
          }
        }

        const kinds: Record<string, number> = {};

        type Shown = { ok?: { _tag?: string; reason?: string }; fail?: { reason?: string }; die?: unknown };

        for (const [kind, answer] of answers as Array<[string, Shown]>) {
          const how =
            answer.ok !== undefined
              ? `${answer.ok._tag ?? "rows"}${answer.ok.reason === undefined ? "" : `:${answer.ok.reason}`}`
              : answer.fail !== undefined
                ? `failed:${answer.fail.reason}`
                : "died";
          const key = `${kind}:${how}`;
          kinds[key] = (kinds[key] ?? 0) + 1;
        }

        return { calls, kinds, answers: yield* digest(JSON.stringify(answers)), ...(yield* dump) };
      });

    const run = (op: string, input: unknown): Effect.Effect<unknown> =>
      Effect.gen(function* () {
        const body = (input ?? {}) as {
          route?: Route;
          seed?: number;
          calls?: number;
          id?: string;
          n?: number;
          pause?: "none" | "key" | "sleep";
        };
        const route = body.route ?? "S";

        if (op === "cases") {
          return yield* cases(route);
        }

        if (op === "workload") {
          return yield* workload(route, body.seed ?? 119120, body.calls ?? 300);
        }

        if (op === "append") {
          // One append from one request. With a pause, the call waits outside the turn, before it,
          // as a real method does when it reads a key or calls another object first.
          if (body.pause === "key") {
            yield* state.storage.get("nothing");
          } else if (body.pause === "sleep") {
            yield* Effect.sleep("3 millis");
          }

          const exit = yield* ledger(route, (l) => l.append("tickets", body.id ?? "in-x", line({})));
          return shown(exit);
        }

        if (op === "prime") {
          return shown(yield* ledger(route, (l) => l.wait("tickets", 0)));
        }

        if (op === "entries") {
          return exec(`SELECT rev, pos, id FROM entries ORDER BY rev`);
        }

        if (op === "appends") {
          // n appends one after another inside one call, for the timing.
          const n = body.n ?? 0;
          const tag = `${body.id ?? "t"}`;
          let placed = 0;

          for (let i = 0; i < n; i++) {
            const exit = yield* ledger(route, (l) => l.append("tickets", `in-${tag}-${i}`, line({})));
            placed += Exit.isSuccess(exit) && exit.value._tag === "placed" ? 1 : 0;
          }

          return { n, placed };
        }

        if (op === "keys") {
          // The key and alarm calls through Alchemy's own storage, no raw handle.
          yield* state.storage.put("k", { v: 1 });
          const got = yield* state.storage.get("k");
          const inTurn = yield* Effect.exit(
            state.storage.transaction(
              Effect.gen(function* () {
                yield* state.storage.put("k2", 2);
                return yield* Effect.fail("stop");
              }),
            ),
          );
          const k2 = yield* state.storage.get("k2");
          const removed = yield* state.storage.delete("k");
          const at = Date.now() + 60_000;
          yield* state.storage.setAlarm(at);
          const alarm = yield* state.storage.getAlarm();
          yield* state.storage.deleteAlarm();
          const gone = yield* state.storage.getAlarm();
          return { got, rolledBack: shown(inTurn), k2: k2 ?? null, removed, alarmSet: alarm === at, alarmGone: gone };
        }

        return { unknown: op };
      }).pipe(Effect.catchCause((cause) => Effect.succeed({ crashed: Cause.pretty(cause).slice(0, 2000) })));

    return Effect.succeed({ run } satisfies TurnShape);
  }),
);
