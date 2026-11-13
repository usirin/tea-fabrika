// next/, W3/W4. Driver-free laws run by the Node module over real scoped SQLite files.
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Cause, Context, Effect, Exit, Layer, Schema } from "effect";
import type { Sql } from "../Sql.ts";
import { type Update, WatcherManager } from "./Entry.ts";
import { nth } from "./RepliesTest.ts";
import type { Database } from "./RepliesTest.ts";
import { Gone, Unreachable, WatcherManagerError } from "./WatcherManager.ts";
import { Watchers } from "./Watchers.ts";
import * as WatchersSql from "./WatchersSql.ts";

const failStore = (): never => {
  throw new Error("one-shot watcher storage failure");
};

const json = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)));
const RUNS = 100;

const Step = Arbitrary.all({
  pick: Arbitrary.schema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  client: Arbitrary.schema(Schema.NonEmptyString.check(Schema.isMaxLength(256))),
});

const Walk = Arbitrary.array(Step, { minLength: 4, maxLength: 20 });
const whole = { type: "whole", rev: 0, view: { count: 0 } } as const;
const patch = { type: "patch", base: 0, rev: 1, patch: [] } as const;
const rows = (sql: Sql) => sql.exec("SELECT * FROM process_watchers");

const build = Effect.fnUntraced(function* (sql: Sql, name: string, publish: WatcherManager["Service"]["publish"]) {
  const context = yield* Layer.build(
    WatchersSql.layer(sql, { name, build: "test" }).pipe(Layer.provide(Layer.succeed(WatcherManager, { publish }))),
  );
  return Context.get(context, Watchers);
});

const fails = Effect.fnUntraced(function* <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  reason: "Storage" | "BadRow" = "Storage",
) {
  const exit = yield* Effect.exit(effect);
  expect(Exit.isFailure(exit)).toBe(true);

  if (Exit.isFailure(exit)) {
    expect(Cause.hasFails(exit.cause)).toBe(true);
    const error = Cause.squash(exit.cause) as { _tag: string; reason: { _tag: string; cause: unknown } };
    expect(error._tag).toBe("WatchersError");
    expect(error.reason._tag).toBe(reason);
    expect(error.reason.cause).toBeDefined();
  }
});

export const suite = (database: Database) =>
  describe("saved watchers SQL, next/", () => {
    it.live.prop(
      "W3: names are isolated; refresh, removal and eviction keep a bounded live list",
      [Walk],
      ([walk]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* database;
            const sql = yield* open;
            const frames: Array<{ client: string; update: Update }> = [];
            const gone = new Set<string>();
            const publish: WatcherManager["Service"]["publish"] = (client, update) =>
              Effect.suspend(() => {
                if (gone.has(client)) {
                  return Effect.fail(new WatcherManagerError({ reason: new Gone({ cause: null }) }));
                }

                frames.push({ client, update });
                return Effect.void;
              });
            const a = yield* build(sql, "counter:a", publish);
            const b = yield* build(sql, "counter:b", publish);
            yield* b.open("isolated", whole);
            let held: Array<string> = [];

            for (let i = 0; i < 1026; i++) {
              const client = `window-${i}`;
              yield* a.open(client, whole);
              held = [...held, client].slice(-1024);
            }

            for (const step of walk) {
              const client = held.length && step.pick % 3 ? nth(held, step.pick) : step.client;

              if (step.pick % 3 === 2) {
                gone.add(client);
              } else {
                gone.delete(client);
                yield* a.open(client, whole);
                held = [...held.filter((c) => c !== client), client].slice(-1024);
              }

              frames.length = 0;
              yield* a.publish(patch);
              held = held.filter((c) => !gone.has(c));
              expect(frames.map((f) => f.client)).toEqual(held);
              expect(held.length).toBeLessThanOrEqual(1024);
              frames.length = 0;
              yield* b.publish(patch);
              expect(frames.map((f) => f.client)).toEqual(["isolated"]);
            }

            gone.clear();
            held.forEach((c) => {
              gone.add(c);
            });
            yield* a.publish(patch);
            // Reopening the layer cannot resurrect ended clients or an evicted client.
            const rebuilt = yield* build(sql, "counter:a", publish);
            frames.length = 0;
            yield* rebuilt.publish(patch);
            expect(frames).toEqual([]);
            expect(JSON.stringify(rows(sql)).length).toBeLessThan(2048);
          }),
        ),
      { timeout: RUNS * 10_000, arbitrary: { seed: 119120, runs: RUNS } },
    );

    it.live.prop(
      "W4: local read/write/cleanup failures are explicit and damaged rows remain untouched",
      [Walk],
      ([walk]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* database;
            const sql = yield* open;
            let armed: "read" | "save" | "cleanup" | null = null;
            let hit = false;
            const faulty: Sql = {
              ...sql,
              exec: (query, ...params) => {
                const read = /^\s*SELECT/i.test(query);
                const write = /^\s*(INSERT|UPDATE|REPLACE|DELETE)/i.test(query);

                if (
                  query.includes("process_watchers") &&
                  ((armed === "read" && read) || ((armed === "save" || armed === "cleanup") && write))
                ) {
                  armed = null;
                  hit = true;
                  return failStore();
                }

                return sql.exec(query, ...params);
              },
            };
            const frames: Array<string> = [];
            let gone = false;
            const watches = yield* build(faulty, "counter:fault", (client) =>
              Effect.suspend(() => {
                if (gone) {
                  return Effect.fail(new WatcherManagerError({ reason: new Gone({ cause: null }) }));
                }

                frames.push(client);
                return Effect.void;
              }),
            );
            yield* watches.open("held", whole);

            for (const [i, step] of walk.entries()) {
              const mode = i % 3 === 0 ? "read" : i % 3 === 1 ? "save" : "cleanup";
              armed = mode;
              hit = false;
              frames.length = 0;
              gone = mode === "cleanup";
              yield* fails(gone ? watches.publish(patch) : watches.open(step.client, whole));
              expect(hit, "the one-shot fault was exercised").toBe(true);
              expect(frames, "failed registration sent no whole").toEqual([]);
              gone = false;
              yield* watches.publish(patch);
              expect(frames).toContain("held");
              gone = true;
              yield* watches.publish(patch);
              gone = false;
              yield* watches.open("held", whole);
              const [row] = rows(sql).filter((r) => r.name === "counter:fault");
              expect(row).toBeDefined();
              const column = Object.keys(row ?? {}).find(
                (k) => typeof (row ?? {})[k] === "string" && String((row ?? {})[k]).startsWith("{"),
              );
              expect(column).toBeDefined();
              const original = String((row ?? {})[column ?? "value"]);
              const damaged = step.pick % 2 ? "{bad-json" : JSON.stringify({ ...json(original), v: 999 });
              sql.exec(`UPDATE process_watchers SET "${column}"=? WHERE name=?`, damaged, "counter:fault");
              const before = rows(sql);
              frames.length = 0;
              yield* fails(watches.open(step.client, whole), "BadRow");
              yield* fails(watches.publish(patch), "BadRow");
              expect(rows(sql)).toEqual(before);
              expect(frames).toEqual([]);
              sql.exec(`UPDATE process_watchers SET "${column}"=? WHERE name=?`, original, "counter:fault");
            }
          }),
        ),
      { timeout: RUNS * 3_000, arbitrary: { seed: 119120, runs: RUNS } },
    );
    it.live.prop(
      "W5: gone removes only that watch, unknown retains it, and fanout continues",
      [Walk],
      ([walk]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const open = yield* database;
            const sql = yield* open;
            const routes = new Map<string, "sent" | "gone" | "unknown">();
            const frames: Array<string> = [];
            const attempts: Array<string> = [];
            const publish: WatcherManager["Service"]["publish"] = (client) =>
              Effect.suspend(() => {
                attempts.push(client);
                const route = routes.get(client);

                if (route === "gone") {
                  return Effect.fail(new WatcherManagerError({ reason: new Gone({ cause: null }) }));
                }

                if (route === "unknown") {
                  return Effect.fail(
                    new WatcherManagerError({ reason: new Unreachable({ cause: new Error("send failed") }) }),
                  );
                }

                frames.push(client);
                return Effect.void;
              });
            let watches = yield* build(sql, "fanout:1", publish);
            const held = new Set<string>();

            for (const [i, step] of walk.entries()) {
              const client = `${step.client}:${i}`;
              routes.set(client, "sent");
              yield* watches.open(client, whole);
              held.add(client);
              const target = nth([...held], step.pick);
              const route = i % 2 ? "gone" : "unknown";
              routes.set(target, route);
              frames.length = 0;
              yield* watches.publish(patch);
              expect(frames.sort()).toEqual([...held].filter((c) => routes.get(c) === "sent").sort());

              if (route === "gone") {
                held.delete(target);
              }

              // A fresh layer must recover the removal, or recover the retained unknown, from SQL.
              watches = yield* build(sql, "fanout:1", publish);
              routes.set(target, "sent");
              frames.length = 0;
              attempts.length = 0;
              yield* watches.publish(patch);
              expect(frames.sort()).toEqual([...held].sort());
              expect(attempts.includes(target)).toBe(route === "unknown");
            }
          }),
        ),
      { timeout: RUNS * 3_000, arbitrary: { seed: 119120, runs: RUNS } },
    );
  });
