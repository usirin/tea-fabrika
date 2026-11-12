// T753, next/. The caller owns the SQLite driver; settings/StartsTest owns the shared laws.
import { DatabaseSync } from "node:sqlite"; // edge: the ledger's synchronous Sql driver needs node:sqlite
import { describe, expect } from "@effect/vitest";
import { Context, Effect, Exit, Layer, Option, Schema } from "effect";
import { Digest } from "effect/crypto";
import * as fc from "fast-check";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import * as Start from "../settings/Start.ts";
import { Starts, StartsError, Decode, Refused, Storage, Unreachable } from "../settings/Starts.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import type { Sql } from "../Sql.ts";
import { projectRuntime, settingsReply, type Env } from "./runtime.ts";
import * as SettingsStartsLedger from "./SettingsStartsLedger.ts";
import * as SettingsStartsRemote from "./SettingsStartsRemote.ts";

// This throws at the synchronous platform edge, before the ledger translates the failure.
const exec =
  (base: Sql, refused: () => boolean, cause: Error): Sql["exec"] =>
  (query, ...args) => {
    if (refused() && /SELECT|INSERT/i.test(query)) {
      throw cause;
    }

    return base.exec(query, ...args);
  };

const open = Effect.gen(function* () {
  const database = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (db) => Effect.sync(() => db.close()),
  );
  const base = nodeSql(database);
  let reads = 0;
  let appends = 0;
  const sql: Sql = {
    ...base,
    exec: (query, ...args) => {
      // Count bounded entry reads, excluding append's own identity and head checks.
      if (/SELECT \* FROM entries WHERE stream = \? AND rev > \?/i.test(query)) {
        reads++;
      }

      if (/INSERT INTO entries/i.test(query)) {
        appends++;
      }

      return base.exec(query, ...args);
    },
  };
  const context = yield* Layer.build(SettingsStartsLedger.layer(sql));
  const starts = Context.get(context, Starts);
  const known = new Set<string>();
  const record = Effect.fnUntraced(function* (input: StartsTest.Input) {
    const receipt = yield* starts.record(input);
    known.add(input.start);
    return receipt;
  });
  return {
    record,
    read: starts.read,
    entries: Effect.suspend(() => Effect.forEach([...known], starts.read, { concurrency: 1 })),
    loseReply: (work) => work.pipe(Effect.andThen(Effect.fail("reply lost after commit"))),
    counts: () => ({ reads, appends, consumers: 0 }),
  } satisfies StartsTest.Driver;
}).pipe(Effect.provide(Digest.layerWebCrypto));

StartsTest.suite(open);

for (const kind of StartsTest.originKinds) {
  StartsTest.law(
    `L3 saved reads and repeats reject forbidden ${kind} origins`,
    fc.tuple(StartsTest.recipe, StartsTest.originFault(kind), fc.array(fc.nat(), { minLength: 8, maxLength: 30 })),
    ([recipe, fault, choices]) =>
      Effect.gen(function* () {
        const db = yield* Effect.acquireRelease(
          Effect.sync(() => new DatabaseSync(":memory:")),
          (owned) => Effect.sync(() => owned.close()),
        );
        const context = yield* Layer.build(SettingsStartsLedger.layer(nodeSql(db)));
        const starts = Context.get(context, Starts);
        const input = yield* StartsTest.input(recipe);
        const original = yield* starts.record(input);
        const bad = StartsTest.changeOrigin(input, fault);
        let poisoned = false;

        for (const choice of choices) {
          const moves = poisoned ? ["read", "repeat", "restore"] : ["read", "repeat", "poison"];
          const move = moves[choice % moves.length];

          if (move === "poison" || move === "restore") {
            poisoned = move === "poison";
            // Simulate a saved entry received from storage, bypassing today's writer.
            db.prepare("UPDATE entries SET body = ? WHERE id = ?").run(
              JSON.stringify({
                start: input.start,
                settings: poisoned ? bad.settings : input.settings,
                build: input.build,
                repo: input.repo,
              }),
              input.start,
            );
          }

          const work = move === "repeat" ? starts.record(input) : starts.read(input.start);
          const exit = yield* Effect.exit(work);
          expect(Exit.isFailure(exit)).toBe(poisoned);

          if (Exit.isFailure(exit)) {
            expect(exit.cause).toMatchObject({
              reasons: [{ _tag: "Fail", error: { _tag: "StartsError", reason: { _tag: "Decode" } } }],
            });
          } else {
            expect(exit.value).toEqual(original);
          }

          expect(db.prepare("SELECT count(*) AS total FROM entries").get()).toMatchObject({ total: 1 });
        }
      }),
  );

  StartsTest.law(
    `L3 remote reads and matching acknowledgements reject forbidden ${kind} origins`,
    fc.tuple(StartsTest.recipe, StartsTest.originFault(kind), fc.array(fc.nat(), { minLength: 8, maxLength: 30 })),
    ([recipe, fault, choices]) =>
      Effect.gen(function* () {
        const input = yield* StartsTest.input(recipe);
        const bad = StartsTest.changeOrigin(input, fault);
        let poisoned = false;
        const call = async () => StartsTest.reply(poisoned ? bad : input);
        const context = yield* Layer.build(SettingsStartsRemote.layer({ settingsStart: call, settingsRead: call }));
        const starts = Context.get(context, Starts);

        for (const choice of choices) {
          const moves = poisoned ? ["read", "record", "restore"] : ["read", "record", "poison"];
          const move = moves[choice % moves.length];

          if (move === "poison" || move === "restore") {
            poisoned = move === "poison";
          }

          // Match even the poisoned input, so body comparison cannot mask missing origin validation.
          const work = move === "record" ? starts.record(poisoned ? bad : input) : starts.read(input.start);
          const exit = yield* Effect.exit(work);
          expect(Exit.isFailure(exit)).toBe(poisoned);

          if (Exit.isFailure(exit)) {
            expect(exit.cause).toMatchObject({
              reasons: [{ _tag: "Fail", error: { _tag: "StartsError", reason: { _tag: "Decode" } } }],
            });
          } else {
            expect(exit.value).toEqual(StartsTest.receipt(input));
          }
        }
      }),
  );
}

StartsTest.law(
  "L5 the public Project settings endpoint records and reads without constructing consumers",
  fc.tuple(StartsTest.recipe, fc.array(fc.nat(), { minLength: 8, maxLength: 30 })),
  ([recipe, choices]) =>
    Effect.gen(function* () {
      const db = yield* Effect.acquireRelease(
        Effect.sync(() => new DatabaseSync(":memory:")),
        (owned) => Effect.sync(() => owned.close()),
      );
      const sql = nodeSql(db);
      let consumers = 0;
      const unexpected = () => {
        consumers++;
        return {};
      };
      const input = yield* StartsTest.input(recipe);
      // oxlint-disable-next-line fabrika/no-type-assertions -- edge: only Alchemy can construct a full object state; these are its SQLite handles
      const ctx = {
        id: { name: input.name },
        storage: {
          sql: {
            exec: (query: string, ...args: Parameters<typeof sql.exec> extends [string, ...infer A] ? A : never) => {
              if (/CREATE TABLE IF NOT EXISTS (unsent|spans|content|process_state)/i.test(query)) {
                consumers++;
              }

              return sql.exec(query, ...args);
            },
            get databaseSize() {
              return sql.size();
            },
          },
          transactionSync: sql.transaction,
          get: async () => unexpected(),
          put: async () => unexpected(),
        },
      } as unknown as DurableObjectState;
      // oxlint-disable-next-line fabrika/no-type-assertions -- edge: namespace doubles count any non-ledger work without workerd's nominal brands
      const env = {
        INSTANCE: JSON.stringify(input),
        PROJECT: { getByName: unexpected },
        PROCESS: { getByName: unexpected },
        CONNECTION: { getByName: unexpected },
        RECORD: { getByName: unexpected },
        LOADER: { get: unexpected },
        MEASUREMENTS: { put: unexpected, head: unexpected },
      } as unknown as Env;
      const runtime = yield* Effect.acquireRelease(
        Effect.sync(() =>
          projectRuntime(ctx, env, {
            programs: {},
            bootstrap: { id: "unexpected", name: "unexpected", program: "unexpected" },
            door: () => Effect.sync(unexpected).pipe(Effect.andThen(Effect.die("unexpected consumer construction"))),
          }),
        ),
        (owned) => owned.disposeEffect,
      );
      const saved = new Map<string, Start.Receipt>();
      let current = input;

      for (const [index, choice] of choices.entries()) {
        const moves = saved.has(current.start) ? ["repeat", "read", "concurrent", "deploy"] : ["record", "lost"];
        const move = moves[choice % moves.length];

        if (move === "deploy") {
          current = yield* StartsTest.input({ ...recipe, start: `${recipe.start}-${index}` });
          continue;
        }

        if (move === "lost") {
          // The caller loses the first answer after the endpoint has placed the entry.
          yield* runtime.settingsStart(current);
        }

        const replies = yield* Effect.forEach(
          Array.from({ length: move === "concurrent" ? 2 + (choice % 4) : 1 }),
          () => (move === "read" ? runtime.settingsRead(current.start) : runtime.settingsStart(current)),
          { concurrency: "unbounded" },
        );

        for (const raw of replies) {
          const reply = yield* Schema.decodeUnknownEffect(Start.Reply)(raw);
          expect(reply._tag).toBe("ok");

          if (reply._tag === "ok") {
            expect(reply.value).toMatchObject({
              start: current.start,
              settings: current.settings,
              build: current.build,
            });
            expect(reply.value).toEqual(saved.get(current.start) ?? reply.value);
            saved.set(current.start, reply.value);
          }
        }

        expect(consumers).toBe(0);
      }
    }),
);

describe("L5 minimal start path, next/", () => {
  StartsTest.law(
    "recording requires no Project, program loader, telemetry, RecordPart or recursive RPC",
    fc.tuple(StartsTest.recipe, fc.array(fc.nat(), { minLength: 2, maxLength: 20 })),
    ([recipe, choices]) =>
      Effect.gen(function* () {
        // Deliberately supply only the local SQL driver. A full Project dependency cannot build here.
        const driver = yield* open;
        const input = yield* StartsTest.input(recipe);

        for (const choice of choices) {
          const before = driver.counts();
          const receipts = yield* Effect.forEach(Array.from({ length: 1 + (choice % 4) }), () => driver.record(input), {
            concurrency: "unbounded",
          });

          for (const receipt of receipts) {
            expect(receipt.settings).toEqual(input.settings);
          }

          expect(driver.counts().appends - before.appends).toBe(before.appends === 0 ? 1 : 0);
          expect(driver.counts().consumers).toBe(0);
        }
      }).pipe(Effect.provide(Digest.layerWebCrypto)),
  );

  StartsTest.law(
    "L17 a real storage failure remains the exact lower failure in StartsError",
    fc.tuple(StartsTest.recipe, fc.string()),
    ([recipe, message]) =>
      Effect.gen(function* () {
        const database = yield* Effect.acquireRelease(
          Effect.sync(() => new DatabaseSync(":memory:")),
          (db) => Effect.sync(() => db.close()),
        );
        const base = nodeSql(database);
        const cause = new Error(message, { cause: { code: "SQLITE_FULL" } });
        let fail = false;
        const sql: Sql = {
          ...base,
          exec: exec(base, () => fail, cause),
        };
        const context = yield* Layer.build(SettingsStartsLedger.layer(sql));
        const starts = Context.get(context, Starts);
        const input = yield* StartsTest.input(recipe);
        fail = true;
        const error = yield* Effect.flip(starts.record(input));
        expect(error.reason._tag).toBe("Storage");
        // Translation may retain a LedgerError around the platform cause.
        let lower: unknown = error.reason;

        for (let depth = 0; depth < 8 && lower !== cause; depth++) {
          lower = typeof lower === "object" && lower !== null && "cause" in lower ? lower.cause : undefined;
        }

        expect(lower).toBe(cause);
        fail = false;
        expect((yield* starts.record(input)).start).toBe(input.start);
      }).pipe(Effect.provide(Digest.layerWebCrypto)),
  );
});

StartsTest.law(
  "L4 L17 rejected transports and malformed acknowledgements never supply a start",
  fc.tuple(StartsTest.recipe, fc.array(fc.nat(), { minLength: 8, maxLength: 30 }), StartsTest.sentinel),
  ([recipe, choices, secret]) =>
    Effect.gen(function* () {
      const input = yield* StartsTest.input(recipe);
      const lower = new Error(secret, { cause: { private: secret } });
      let reject = true;
      let calls = 0;
      const call = () => {
        calls++;
        return reject ? Promise.reject(lower) : Promise.resolve({ placed: true });
      };
      const context = yield* Layer.build(SettingsStartsRemote.layer({ settingsStart: call, settingsRead: call }));
      const starts = Context.get(context, Starts);

      for (const choice of choices) {
        reject = choice % 2 === 0;
        const before = calls;
        const error = yield* Effect.flip(starts.record(input));
        expect(error).toBeInstanceOf(StartsError);
        expect(error.reason._tag).toBe(reject ? "Unreachable" : "Decode");

        if (error.reason._tag === "Unreachable") {
          expect(error.reason.cause).toBe(lower);
        }

        if (error.reason._tag === "Decode") {
          expect(Schema.isSchemaError(error.reason.cause)).toBe(true);
        }

        expect(calls - before).toBe(1);
      }
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
);

StartsTest.law(
  "L10 [secrets] nested lower failures stay out of checked RPC failures and start records",
  fc.tuple(StartsTest.recipe, StartsTest.sentinel, fc.array(fc.nat(), { minLength: 8, maxLength: 35 })),
  ([recipe, secret, choices]) =>
    Effect.gen(function* () {
      const input = yield* StartsTest.input(recipe);
      const driver = yield* open;
      expect.hasAssertions();
      const lower = new Error(secret, { cause: { password: secret } });
      const reasons = [
        new Decode({ cause: lower }),
        new Refused({ cause: lower }),
        new Storage({ cause: lower }),
        new Unreachable({ cause: lower }),
      ];
      let placed = false;

      for (const choice of choices) {
        const moves = placed ? ["repeat", "failure", "read"] : ["record", "failure"];
        const move = moves[choice % moves.length];

        if (move === "failure") {
          const reason = Option.getOrThrow(
            Option.fromUndefinedOr(reasons[Math.floor(choice / moves.length) % reasons.length]),
          );
          const reply = yield* settingsReply(Effect.fail(new StartsError({ reason })));
          StartsTest.exclude(reply, secret);
          expect(JSON.stringify(reply)).not.toContain("cause");
        } else {
          StartsTest.exclude(JSON.stringify(input), secret);
          const receipt = yield* move === "read" ? driver.read(input.start) : driver.record(input);
          placed = true;
          StartsTest.exclude(receipt, secret);
        }

        StartsTest.exclude(yield* driver.entries, secret);
      }
    }).pipe(Effect.provide(Digest.layerWebCrypto)),
);
