// T749 slice 1, next/. Laws G7, G8 and G2's malformed saved key for the SYN-cookie helper.
// G7: bytes come from the supplied SecureRandom (32 for a missing secret, 24 per salt, none for a
// saved one), a saved secret survives every reopen, and a racing initializer keeps the installed key.
// G8: a cookie checks only for its own client, before its expiry instant, and spends once.
// Plants, each run once and undone: global randomness; overwriting an installed secret; accepting a
// cookie at its expiry instant; reusing a spent cookie; replacing a malformed saved key.
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Result } from "effect";
import { SecureRandom } from "effect/crypto";
import { Base64Url } from "effect/encoding";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { gatewayNonce } from "./GatewayNonce.ts";
import { gatewayStore } from "./GatewayStore.ts";

const checks = { seed: 119120, numRuns: 60 };

type Nonces = Effect.Success<ReturnType<typeof gatewayNonce>>;
type Store = ReturnType<typeof gatewayStore>;

// One in-memory database per run, given back by the run's scope.
const database = Effect.acquireRelease(
  Effect.sync(() => new DatabaseSync(":memory:")),
  (db) => Effect.sync(() => db.close()),
);

const savedKey = (store: Store) =>
  store.sql.exec("SELECT value FROM gateway_state WHERE name='challengeKey'")[0]?.value ?? null;

/** Bytes the test hands to SecureRandom, and every size the helper asked for. */
const source = () => {
  const queue: Array<Uint8Array> = [];
  const asked: Array<number> = [];
  const service = SecureRandom.make((size) => {
    asked.push(size);
    const next = queue.shift();
    return next !== undefined && next.length === size ? next : new Uint8Array(size).fill(255);
  });
  return { queue, asked, layer: Layer.succeed(SecureRandom.SecureRandom, service) };
};

const salt = (cookie: string) => cookie.split(".")[1] ?? "";

// fast-check picks each command from the state it is folding. A command's run leaves the Effect
// that performs it in the walk's holder, and the walk runs it.
type Holder<R> = { readonly real: R; next: Effect.Effect<void, unknown> };

const walkable = <M extends object, R>(
  name: string,
  check: (m: M) => boolean,
  apply: (m: M, r: R) => Effect.Effect<void, unknown>,
): fc.Command<M, Holder<R>> => ({
  check,
  run: (m, h) => {
    h.next = apply(m, h.real);
  },
  toString: () => name,
});

const walk = Effect.fnUntraced(function* <M extends object, R>(
  moves: Iterable<fc.Command<M, Holder<R>>>,
  m: M,
  real: R,
) {
  const holder: Holder<R> = { real, next: Effect.void };

  for (const step of moves) {
    if (step.check(m)) {
      step.run(m, holder);
      yield* holder.next;
    }
  }
});

describe("T749 G7: nonce bytes come from SecureRandom and a saved secret is kept", () => {
  type Model = { installed: boolean; issued: Array<{ client: string; cookie: string }> };
  type Real = {
    readonly store: Store;
    readonly bytes: ReturnType<typeof source>;
    nonces: Nonces | null;
    key: unknown;
  };
  const move = (
    name: string,
    check: (m: Model) => boolean,
    apply: (m: Model, r: Real) => Effect.Effect<void, unknown>,
  ) => walkable<Model, Real>(name, check, apply);

  const open = (secret: Uint8Array) =>
    move(
      `open(${Base64Url.encode(secret)})`,
      () => true,
      Effect.fnUntraced(function* (m, r) {
        r.bytes.queue.push(secret);
        r.bytes.asked.length = 0;
        const nonces = yield* gatewayNonce(r.store, 60_000, 100).pipe(Effect.provide(r.bytes.layer));
        r.nonces = nonces;

        if (m.installed) {
          // A saved secret needs no new draw and is never replaced.
          expect(savedKey(r.store)).toBe(r.key);
          expect(r.bytes.asked).toEqual([]);
        } else {
          expect(r.bytes.asked).toEqual([32]);
          expect(JSON.parse(String(savedKey(r.store)))).toBe(Base64Url.encode(secret));
          r.key = savedKey(r.store);
          m.installed = true;
        }

        r.bytes.queue.length = 0;

        // Every cookie issued under the installed secret still checks after the reopen.
        for (const { client, cookie } of m.issued) {
          expect(yield* nonces.check(client, cookie)).not.toBeNull();
        }
      }),
    );

  const race = (first: Uint8Array, second: Uint8Array) =>
    move(
      "race(two initializers that both find no secret)",
      (m) => !m.installed,
      Effect.fnUntraced(function* (m, r) {
        const entered = yield* Deferred.make<void>(),
          release = yield* Deferred.make<void>();
        // The first initializer suspends while drawing; the second installs its secret meanwhile.
        const slow = Layer.succeed(SecureRandom.SecureRandom, {
          ...SecureRandom.make(() => first),
          randomBytes: (size: number) =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(first.slice(0, size)),
            ),
        });
        const a = yield* Effect.forkChild(gatewayNonce(r.store, 60_000, 100).pipe(Effect.provide(slow)));
        yield* Deferred.await(entered).pipe(Effect.raceFirst(Fiber.await(a)));
        r.bytes.queue.push(second);
        const b = yield* gatewayNonce(r.store, 60_000, 100).pipe(Effect.provide(r.bytes.layer));
        r.bytes.queue.length = 0;
        const installed = savedKey(r.store);
        yield* Deferred.succeed(release, undefined);
        const late = yield* Fiber.join(a);
        // The late initializer adopts the key that is already installed.
        expect(savedKey(r.store)).toBe(installed);
        const cookie = yield* late.issue("race-client");
        expect(yield* b.check("race-client", cookie)).not.toBeNull();
        const other = yield* b.issue("race-client");
        expect(yield* late.check("race-client", other)).not.toBeNull();
        r.nonces = b;
        r.key = installed;
        m.installed = true;
      }),
    );

  const issue = (client: string, bytes: Uint8Array) =>
    move(
      `issue(${client}, ${Base64Url.encode(bytes)})`,
      (m) => m.installed,
      Effect.fnUntraced(function* (m, r) {
        r.bytes.queue.push(bytes);
        r.bytes.asked.length = 0;
        const nonces = r.nonces;

        if (nonces === null) {
          return yield* Effect.die("an issue move runs only after an open");
        }

        const cookie = yield* nonces.issue(client);
        expect(r.bytes.asked).toEqual([24]);
        expect(salt(cookie)).toBe(Base64Url.encode(bytes));
        r.bytes.queue.length = 0;
        m.issued.push({ client, cookie });
      }),
    );

  const bytes = (n: number) => fc.uint8Array({ minLength: n, maxLength: n });

  it("generated opens, reopens, races and issues use only supplied bytes and keep the installed key", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.commands(
          [
            bytes(32).map(open),
            fc.tuple(bytes(32), bytes(32)).map(([a, b]) => race(a, b)),
            fc.tuple(fc.constantFrom("client-a", "client-b"), bytes(24)).map(([c, b]) => issue(c, b)),
          ],
          { maxCommands: 12 },
        ),
        (moves) =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const store = gatewayStore(nodeSql(yield* database));
                const real: Real = { store, bytes: source(), nonces: null, key: null };
                const model: Model = { installed: false, issued: [] };

                yield* walk(moves, model, real);
              }),
            ).pipe(Effect.provide(TestClock.layer())),
          ),
      ),
      checks,
    );
  });
});

describe("T749 G8: cookies keep their expiry, binding and spending rules", () => {
  type Cookie = { readonly client: string; readonly cookie: string; readonly issuedAt: number };
  type Model = {
    now: number;
    readonly ttl: number;
    readonly cap: number;
    issued: Array<Cookie>;
    spent: Map<string, number>;
  };
  type Real = { readonly store: Store; readonly nonces: Nonces };
  const move = (
    name: string,
    check: (m: Model) => boolean,
    apply: (m: Model, r: Real) => Effect.Effect<void, unknown>,
  ) => walkable<Model, Real>(name, check, apply);
  const live = (m: Model, c: Cookie) => c.issuedAt <= m.now && c.issuedAt + m.ttl > m.now;
  // After any clock move, every issued cookie checks for its own client exactly while it is live.
  const recheck = Effect.fnUntraced(function* (m: Model, r: Real) {
    for (const c of m.issued) {
      expect(yield* r.nonces.check(c.client, c.cookie)).toBe(live(m, c) ? c.issuedAt + m.ttl : null);
    }
  });

  const issue = (client: string) =>
    move(
      `issue(${client})`,
      () => true,
      Effect.fnUntraced(function* (m, r) {
        const cookie = yield* r.nonces.issue(client);
        m.issued.push({ client, cookie, issuedAt: m.now });
      }),
    );

  const advance = (ms: number) =>
    move(
      `advance(${ms})`,
      () => true,
      Effect.fnUntraced(function* (m, r) {
        m.now += ms;
        yield* TestClock.setTime(m.now);
        yield* recheck(m, r);
      }),
    );

  // State-guided: move the clock to exactly the expiry instant of an issued, not yet expired cookie.
  const toExpiry = (pick: number) =>
    move(
      `toExpiry(${pick})`,
      (m) => m.issued.some((c) => c.issuedAt + m.ttl > m.now),
      Effect.fnUntraced(function* (m, r) {
        const open = m.issued.filter((c) => c.issuedAt + m.ttl > m.now);
        const c = open[pick % open.length]!;
        m.now = c.issuedAt + m.ttl;
        yield* TestClock.setTime(m.now);
        yield* recheck(m, r);
      }),
    );

  const check = (pick: number, as: number, tamper: number | null) =>
    move(
      `check(${pick}, as ${as}, tamper ${tamper})`,
      (m) => m.issued.length > 0,
      Effect.fnUntraced(function* (m, r) {
        const c = m.issued[pick % m.issued.length]!;
        const client = ["client-a", "client-b", "client-c"][as]!;
        const parts = c.cookie.split(".");
        const s = parts[1]!;
        // A changed salt character changes the signed bytes: 24 bytes fill 32 characters exactly.
        const changed =
          tamper === null
            ? c.cookie
            : [parts[0], `${s.slice(0, tamper)}${s[tamper] === "A" ? "B" : "A"}${s.slice(tamper + 1)}`, parts[2]].join(
                ".",
              );
        const expected = tamper === null && client === c.client && live(m, c) ? c.issuedAt + m.ttl : null;
        expect(yield* r.nonces.check(client, changed)).toBe(expected);
      }),
    );

  const spend = (pick: number) =>
    move(
      `spend(${pick})`,
      (m) => m.issued.length > 0,
      Effect.fnUntraced(function* (m, r) {
        const c = m.issued[pick % m.issued.length]!;
        const until = c.issuedAt + m.ttl;
        const held = [...m.spent.values()].filter((u) => u > m.now).length;
        const fresh = until > m.now && !m.spent.has(c.cookie);
        const before = r.store.sql.exec("SELECT nonce, until FROM gateway_spent ORDER BY nonce");
        const result = yield* Effect.exit(r.store.atomic(() => r.nonces.spend(c.cookie, until, m.now)));
        expect(Exit.isSuccess(result)).toBe(true);
        const spent = Exit.isSuccess(result) ? result.value : null;

        if (fresh && held >= m.cap) {
          // A full receipt table refuses before evicting any live receipt.
          expect(spent !== null && Result.isFailure(spent)).toBe(true);
          expect(r.store.sql.exec("SELECT nonce, until FROM gateway_spent ORDER BY nonce")).toEqual(before);
          return;
        }

        expect(spent).toEqual(Result.succeed(fresh));

        if (fresh) {
          for (const [cookie, u] of m.spent) {
            if (u <= m.now) {
              m.spent.delete(cookie);
            }
          }

          m.spent.set(c.cookie, until);
        }
      }),
    );

  it("generated issues, clock moves, checks and spends follow the cookie rules", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5_000 }),
        fc.integer({ min: 1, max: 4 }),
        fc.commands(
          [
            fc.constantFrom("client-a", "client-b").map(issue),
            fc.integer({ min: 0, max: 3_000 }).map(advance),
            fc.nat().map(toExpiry),
            fc
              .tuple(fc.nat(), fc.integer({ min: 0, max: 2 }), fc.option(fc.integer({ min: 0, max: 31 })))
              .map(([pick, as, tamper]) => check(pick, as, tamper)),
            fc.nat().map(spend),
          ],
          { maxCommands: 30 },
        ),
        (ttl, cap, moves) =>
          Effect.runPromise(
            Effect.scoped(
              Effect.gen(function* () {
                const store = gatewayStore(nodeSql(yield* database));
                yield* TestClock.setTime(0);
                const nonces = yield* gatewayNonce(store, ttl, cap).pipe(Effect.provide(source().layer));
                const model: Model = { now: 0, ttl, cap, issued: [], spent: new Map() };

                yield* walk(moves, model, { store, nonces });
              }),
            ).pipe(Effect.provide(TestClock.layer())),
          ),
      ),
      checks,
    );
  });
});

describe("T749 G2: a malformed saved nonce key fails as the gateway's storage fault and stays", () => {
  // Corruptions derived from a real 43-character saved key, each invalid by construction: cut it,
  // lengthen it within the alphabet, break its alphabet, or change its JSON type.
  const corrupt = fc.oneof(
    fc.integer({ min: 0, max: 42 }).map((n) => (key: string) => JSON.stringify(key.slice(0, n))),
    fc.stringMatching(/^[A-Za-z0-9_-]{1,8}$/).map((extra) => (key: string) => JSON.stringify(`${key}${extra}`)),
    fc
      .integer({ min: 0, max: 42 })
      .map((n) => (key: string) => JSON.stringify(`${key.slice(0, n)}*${key.slice(n + 1)}`)),
    fc.constantFrom("42", "null", "{}", "[]", "not json").map((raw) => () => raw),
  );

  it("generated corruptions of a saved key refuse the helper without drawing or replacing it", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 32, maxLength: 32 }), corrupt, (secret, change) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const store = gatewayStore(nodeSql(yield* database));
              const bytes = source();
              bytes.queue.push(secret);
              yield* gatewayNonce(store, 60_000, 100).pipe(Effect.provide(bytes.layer));
              const saved = JSON.parse(String(savedKey(store))) as string;
              expect(saved).toHaveLength(43);
              const broken = change(saved);
              store.sql.exec("UPDATE gateway_state SET value=? WHERE name='challengeKey'", broken);
              bytes.asked.length = 0;
              const exit = yield* Effect.exit(gatewayNonce(store, 60_000, 100).pipe(Effect.provide(bytes.layer)));
              // The malformed key stays, and nothing is drawn to replace it.
              expect(savedKey(store)).toBe(broken);
              expect(bytes.asked).toEqual([]);
              expect(exit).toMatchObject({ _tag: "Failure" });
              const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
              expect(failure).toMatchObject({ _tag: "GatewayError", reason: "storage" });
              expect((failure as { readonly cause?: unknown }).cause).not.toMatchObject({ _tag: "GatewayError" });
            }),
          ).pipe(Effect.provide(TestClock.layer())),
        ),
      ),
      checks,
    );
  });
});
