/**
 * The `Watchers` layer that keeps view membership in the process's own SQL: one row per registered
 * name in the `process_watchers` table, read and written through the watchers machine.
 *
 * @stability unstable
 */
import { applyCell } from "@demlik/tea";
import { Clock, Effect, Layer, Result, Schema } from "effect";
import type { Sql } from "../Sql.ts";
import type { Update } from "./Entry.ts";
import { Model, watchers } from "./internal/watchers.ts";
import { WatcherManager } from "./WatcherManager.ts";
import { BadRow, Storage, Watchers, WatchersError } from "./Watchers.ts";

const Saved = Schema.Struct({ v: Schema.Literal(1), build: Schema.String, name: Schema.String, state: Model });
const decode = Schema.decodeUnknownResult(Schema.fromJsonString(Saved));
const encode = Schema.encodeSync(Schema.fromJsonString(Saved));

const stored = <A>(f: () => A) =>
  Effect.try({
    try: f,
    catch: (cause) => (Schema.is(WatchersError)(cause) ? cause : new WatchersError({ reason: new Storage({ cause }) })),
  });

const load = (sql: Sql, name: string) => {
  sql.exec("CREATE TABLE IF NOT EXISTS process_watchers (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const [row] = sql.exec("SELECT value FROM process_watchers WHERE name=?", name);

  if (row === undefined) {
    return watchers.init(null, {})[0];
  }

  const saved = decode(row.value);

  if (Result.isFailure(saved)) {
    throw new WatchersError({ reason: new BadRow({ cause: saved.failure }) });
  }

  if (saved.success.name !== name) {
    throw new WatchersError({ reason: new BadRow({ cause: new Error("watcher key mismatch") }) });
  }

  return watchers.init(saved.success.state, {})[0];
};

/**
 * Layer that provides `Watchers` over a process's own SQL, delivering through `WatcherManager`.
 *
 * **Details**
 *
 * `open` saves the client and then sends it the whole view; `publish` reads the saved clients and
 * sends the patch to each, one after another. A client the manager reports `Gone` has its watch
 * ended; one reported `Unreachable` keeps it. Each membership transaction finishes synchronously
 * before the next delivery starts, so no transaction stays open across a delivery.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (
  sql: Sql,
  descriptor: { readonly name: string; readonly build: string; readonly id?: string },
): Layer.Layer<Watchers, never, WatcherManager> =>
  Layer.effect(
    Watchers,
    Effect.gen(function* () {
      const manager = yield* WatcherManager;
      const step = (
        msg:
          | {
              readonly type: "open";
              readonly watch: { readonly client: string; readonly at: number; readonly position: number };
            }
          | { readonly type: "end"; readonly client: string },
      ) => {
        const before = load(sql, descriptor.name);
        const [next] = applyCell(watchers, before, msg);
        sql.exec(
          "INSERT INTO process_watchers (name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
          descriptor.name,
          encode({ v: 1, build: descriptor.build, name: descriptor.name, state: next }),
        );
        const held = new Set(next._tag === "empty" ? [] : next.clients.map((c) => c.client));
        return before._tag === "watching" ? before.clients.filter((c) => !held.has(c.client)).map((c) => c.client) : [];
      };
      const attributes = { name: descriptor.name, build: descriptor.build, process: descriptor.id ?? descriptor.name };
      const end = Effect.fn("watchers.end")(function* (client: string, position: number) {
        const at = yield* Clock.currentTimeMillis;
        yield* stored(() => sql.transaction(() => step({ type: "end", client })));
        yield* Effect.annotateCurrentSpan({ ...attributes, client, position, at, reason: "gone" });
      });
      const deliver = Effect.fnUntraced(function* (client: string, update: Update) {
        return yield* manager.publish(client, update).pipe(
          Effect.as("sent" as const),
          Effect.unwrapReason("WatcherManagerError"),
          Effect.catchTags({
            Gone: () => Effect.succeed("gone" as const),
            Unreachable: () => Effect.succeed("unknown" as const),
          }),
        );
      });
      return {
        open: Effect.fn("watchers.open")(function* (client: string, whole: Extract<Update, { type: "whole" }>) {
          const at = yield* Clock.currentTimeMillis;
          const evicted = yield* stored(() =>
            sql.transaction(() => step({ type: "open", watch: { client, at, position: whole.rev } })),
          );
          const outcome = yield* deliver(client, whole);
          yield* Effect.annotateCurrentSpan({
            ...attributes,
            client,
            position: whole.rev,
            at,
            evicted: evicted.length,
            "evicted.clients": evicted,
            outcome,
          });

          if (outcome === "gone") {
            yield* end(client, whole.rev);
          }
        }),
        publish: Effect.fn("watchers.publish")(function* (patch: Update) {
          const state = yield* stored(() => sql.transaction(() => load(sql, descriptor.name)));
          const clients = state._tag === "empty" ? [] : state.clients;
          let failures = 0;
          let sent = 0;
          let gone = 0;

          for (const watch of clients) {
            const outcome = yield* deliver(watch.client, patch);

            if (outcome === "gone") {
              yield* end(watch.client, patch.rev);
              gone++;
            } else if (outcome === "unknown") {
              failures++;
            } else {
              sent++;
            }
          }

          yield* Effect.annotateCurrentSpan({
            ...attributes,
            position: patch.rev,
            fanout: clients.length,
            sent,
            gone,
            failures,
          });
        }),
      };
    }),
  );
