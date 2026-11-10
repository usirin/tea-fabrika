// P33 / p79. The plan leaves the adapter signature open. Tests use:
// layer(sql, {probe(gateway, session): Effect<number | null, LedgerError>,
//             admitted(key): Effect<boolean, LedgerError>}).
// join({key, client, gateway, session, at}), leave(client, session), online(key).
// Join values are already checked by P10/P12; probe timestamps come from the gateway.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Tracer } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { LedgerError } from "../ledger/Ledger.ts";
import { A, B, W, storage } from "../processes/Process.test-support.ts";
import { GatewayManager } from "./Connections.ts";

const NOW = 1_790_000_000_000;

const setup = (now: number) => {
  const connection = (client = "tab-a", session = A, key = "key-a") => ({
    key,
    client,
    session,
    gateway: `gateway:${client}`,
    at: now,
  });
  const store = storage();
  const live = new Set(["key-a", "key-b"]);
  const pings = new Map<string, number | null>();
  const failed = new Set<string>();
  const asked: Array<{ gateway: string; session: string }> = [];
  const layer = () =>
    GatewayManager.layer(store.sql, {
      admitted: (key: string) => Effect.sync(() => live.has(key)),
      probe: (gateway: string, session: string) =>
        Effect.suspend(() => {
          asked.push({ gateway, session });
          return failed.has(session)
            ? Effect.fail(new LedgerError({ reason: "unreachable" }))
            : Effect.succeed(pings.get(session) ?? null);
        }),
    });
  return { store, live, pings, failed, asked, layer, connection };
};

const time = fc.integer({ min: 0, max: 2 ** 47 });

const check = <A, E, R>(arb: fc.Arbitrary<A>, examples: NoInfer<A>[], law: (a: A) => Effect.Effect<void, E, R>) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    yield* Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(arb, (a) => Effect.runPromise(law(a).pipe(Effect.provideContext(context)))),
        {
          seed: 119120,
          numRuns: 40,
          includeErrorInReport: true,
          examples: examples.map((a): [A] => [a]),
        },
      ),
    );
  });

describe("p79, online is a fresh read of admitted gateway sessions", () => {
  it.effect("gateway probes start without waiting for another gateway's reply", () =>
    check(
      fc.record({ count: fc.integer({ min: 2, max: 8 }), delay: fc.integer({ min: 2, max: 100 }) }),
      [],
      ({ count, delay }) => {
        const world = setup(NOW);
        const started: string[] = [];
        const layer = GatewayManager.layer(world.store.sql, {
          admitted: () => Effect.succeed(true),
          probe: (gateway) =>
            Effect.gen(function* () {
              started.push(gateway);
              yield* Effect.sleep(delay);
              return NOW;
            }),
        });
        return Effect.gen(function* () {
          yield* TestClock.setTime(NOW);
          const gateway = yield* GatewayManager;

          for (let i = 0; i < count; i++) {
            yield* gateway.join(world.connection(`tab-${i}`));
          }

          const pending = yield* Effect.forkChild(gateway.online("key-a"));
          yield* Effect.gen(function* () {
            yield* TestClock.adjust(1);
            expect(started, "all gateways are probed before any reply").toHaveLength(count);
            yield* TestClock.adjust(delay);
            expect(yield* Fiber.join(pending)).toHaveLength(count);
          }).pipe(Effect.ensuring(Fiber.interrupt(pending)));
        }).pipe(Effect.provide(layer));
      },
    ),
  );
  it.effect("storage and broken connection rows keep their typed LedgerError", () =>
    check(fc.string(), [], (message) => {
      const world = setup(NOW);
      const broken = GatewayManager.layer(
        {
          ...world.store.sql,
          transaction: () => {
            throw new Error(message);
          },
        },
        {
          admitted: () => Effect.succeed(true),
          probe: () => Effect.succeed(null),
        },
      );
      return Effect.gen(function* () {
        yield* Effect.gen(function* () {
          const gateway = yield* GatewayManager;

          for (const action of [
            gateway.join(world.connection()),
            gateway.leave("tab-a", A),
            gateway.online("key-a").pipe(Effect.asVoid),
          ]) {
            const result = yield* Effect.result(action);
            expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "storage" } });

            if (result._tag === "Failure") {
              expect(result.failure).toBeInstanceOf(LedgerError);
            }
          }
        }).pipe(Effect.provide(broken));
        yield* Effect.gen(function* () {
          const gateway = yield* GatewayManager;
          yield* gateway.join(world.connection());
          world.store.sql.exec("UPDATE process_gateways SET session = ?", `invalid:${message}`);
          const result = yield* Effect.result(gateway.online("key-a"));
          expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "bad_row" } });
        }).pipe(Effect.provide(world.layer()));
      });
    }),
  );

  for (const [elapsed, state] of [
    [74_999, "online"],
    [75_000, "away"],
    [75_001, "away"],
  ] as const) {
    it.effect(`plant, wrong 75-second edge: ${elapsed} ms since the trusted ping is ${state}`, () =>
      check(
        fc.tuple(
          time,
          state === "online" ? fc.integer({ min: 0, max: 74_999 }) : fc.integer({ min: 75_000, max: 1_000_000 }),
        ),
        [[NOW, elapsed]],
        ([NOW, elapsed]) => {
          const world = setup(NOW);
          const { connection } = world;
          world.pings.set(A, NOW);
          return Effect.gen(function* () {
            yield* TestClock.setTime(NOW);
            const gateways = yield* GatewayManager;
            yield* gateways.join(connection());
            yield* TestClock.setTime(NOW + elapsed);
            expect(
              (yield* gateways.online("key-a")).map((row) => ({
                client: row.client,
                state: row.state,
              })),
            ).toEqual([{ client: "tab-a", state }]);
            expect(world.asked).toEqual([{ gateway: "gateway:tab-a", session: A }]);
            expect(world.store.rows()).toEqual([]);
          }).pipe(Effect.provide(world.layer()));
        },
      ),
    );
  }

  it.effect("plant, no first ping means away: a new session uses its admitted connection time", () =>
    check(time, [NOW], (NOW) => {
      const world = setup(NOW);
      const { connection } = world;
      return Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const gateways = yield* GatewayManager;
        yield* gateways.join(connection());
        yield* TestClock.setTime(NOW + 74_999);
        expect((yield* gateways.online("key-a"))[0]?.state).toBe("online");
        yield* TestClock.setTime(NOW + 75_000);
        expect((yield* gateways.online("key-a"))[0]?.state).toBe("away");
      }).pipe(Effect.provide(world.layer()));
    }),
  );
  it.effect("plant, merge tabs across keys: keys group only their own current sessions", () =>
    check(time, [NOW], (NOW) => {
      const world = setup(NOW);
      const { connection } = world;
      return Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const gateways = yield* GatewayManager;
        yield* gateways.join(connection());
        yield* gateways.join(connection("tab-b", B));
        yield* gateways.join(connection("tab-c", W, "key-b"));
        expect((yield* gateways.online("key-a")).map((row) => row.client).sort()).toEqual(["tab-a", "tab-b"]);
        expect((yield* gateways.online("key-b")).map((row) => row.client)).toEqual(["tab-c"]);
      }).pipe(Effect.provide(world.layer()));
    }),
  );
  it.effect("plant, guess after a failed probe: failure is unknown and does not hide healthy tabs", () =>
    check(time, [NOW], (NOW) => {
      const world = setup(NOW);
      const { connection } = world;
      world.failed.add(A);
      world.pings.set(B, NOW);
      return Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const gateways = yield* GatewayManager;
        yield* gateways.join(connection());
        yield* gateways.join(connection("tab-b", B));
        expect(
          (yield* gateways.online("key-a"))
            .map((row) => ({ client: row.client, state: row.state }))
            .sort((a, b) => a.client.localeCompare(b.client)),
        ).toEqual([
          { client: "tab-a", state: "unknown" },
          { client: "tab-b", state: "online" },
        ]);
        world.failed.delete(A);
        world.pings.set(A, NOW);
        expect((yield* gateways.online("key-a")).every((row) => row.state === "online")).toBe(true);
      }).pipe(Effect.provide(world.layer()));
    }),
  );
  it.effect("plant, old close removes a reconnect: leave affects only its own session", () =>
    check(time, [NOW], (NOW) => {
      const world = setup(NOW);
      const { connection } = world;
      return Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const gateways = yield* GatewayManager;
        yield* gateways.join(connection());
        yield* gateways.join(connection("tab-a", B));
        yield* gateways.leave("tab-a", A);
        expect((yield* gateways.online("key-a")).map((row) => row.session)).toEqual([B]);
        expect(world.asked.map((row) => row.session)).toEqual([B]);
        yield* gateways.leave("tab-a", B);
        expect(yield* gateways.online("key-a")).toEqual([]);
      }).pipe(Effect.provide(world.layer()));
    }),
  );
  it.effect("plant, cached membership: a revoked key is excluded immediately", () =>
    check(time, [NOW], (NOW) => {
      const world = setup(NOW);
      const { connection } = world;
      return Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const gateways = yield* GatewayManager;
        yield* gateways.join(connection());
        expect(yield* gateways.online("key-a")).toHaveLength(1);
        world.live.delete("key-a");
        world.asked.length = 0;
        expect(yield* gateways.online("key-a")).toEqual([]);
        expect(world.asked).toEqual([]);
      }).pipe(Effect.provide(world.layer()));
    }),
  );
  it.effect("plant, save the online answer: reopen keeps connection rows and probes again", () =>
    check(time, [NOW], (NOW) => {
      const world = setup(NOW);
      const { connection } = world;
      return Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        yield* GatewayManager.use((g) => g.join(connection())).pipe(Effect.provide(world.layer()));
        expect(
          (yield* GatewayManager.use((g) => g.online("key-a")).pipe(Effect.provide(world.layer())))[0]?.state,
        ).toBe("online");
        world.store.reopen();
        yield* TestClock.setTime(NOW + 75_001);
        expect(
          (yield* GatewayManager.use((g) => g.online("key-a")).pipe(Effect.provide(world.layer())))[0]?.state,
        ).toBe("away");
        world.pings.set(A, NOW + 75_000);
        expect(
          (yield* GatewayManager.use((g) => g.online("key-a")).pipe(Effect.provide(world.layer())))[0]?.state,
        ).toBe("online");
        expect(world.asked).toHaveLength(3);
        expect(world.store.rows()).toEqual([]);
      });
    }),
  );
  it.effect("plant, background polling: time alone causes no probe and no ledger event", () =>
    check(time, [NOW], (NOW) => {
      const world = setup(NOW);
      const { connection } = world;
      return Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const gateways = yield* GatewayManager;
        yield* gateways.join(connection());
        yield* TestClock.adjust(75_001);
        expect(world.asked).toEqual([]);
        expect(world.store.rows()).toEqual([]);
        yield* gateways.online("key-a");
        expect(world.asked).toHaveLength(1);
      }).pipe(Effect.provide(world.layer()));
    }),
  );
  it.effect("p97 plant, omit failed probe span: every gateway call and probe ends its named span", () =>
    check(time, [NOW], (NOW) => {
      const world = setup(NOW);
      const { connection } = world;
      world.failed.add(A);
      const spans: Array<Tracer.NativeSpan> = [];
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options);
          spans.push(span);
          return span;
        },
      });
      return Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        const gateways = yield* GatewayManager;
        yield* gateways.join(connection());
        yield* gateways.online("key-a");
        yield* gateways.leave("tab-a", A);

        for (const name of ["gateway.join", "gateway.online", "gateway.probe", "gateway.leave"]) {
          expect(
            spans.filter((span) => span.name === name && span.status._tag === "Ended"),
            name,
          ).toHaveLength(1);
        }

        const join = spans.find((span) => span.name === "gateway.join")!;
        expect(join.attributes.get("fab.gateway.client")).toBe("tab-a");
        expect(join.attributes.get("fab.gateway.session")).toBe(A);
      }).pipe(Effect.provide(world.layer()), Effect.withTracer(tracer));
    }),
  );
});
