import { Context, Effect, Layer, Schema } from "effect";
import { LedgerError } from "../data/ledger.ts";
import type { Sql } from "../data/referee.ts";
import { ProcessId, short } from "../data/trace.ts";

const Connection = Schema.Struct({
  key: Schema.NonEmptyString,
  client: Schema.NonEmptyString,
  gateway: Schema.NonEmptyString,
  session: ProcessId,
  at: Schema.Int,
});
type Connection = typeof Connection.Type;

const Online = Schema.Struct({
  ...Connection.fields,
  state: Schema.Literals(["online", "away", "unknown"]),
});
type Online = typeof Online.Type;

type Adapter<P, A> = {
  readonly probe: (gateway: string, session: string) => Effect.Effect<number | null, LedgerError, P>;
  readonly admitted: (key: string) => Effect.Effect<boolean, LedgerError, A>;
};

const decodeConnection = Schema.decodeUnknownSync(Connection);

// T6's 30-second ping tolerates a missing reply before the 75-second away boundary.
const AWAY = 75_000;

export class GatewayManager extends Context.Service<
  GatewayManager,
  {
    readonly join: (connection: Connection) => Effect.Effect<void, LedgerError>;
    readonly leave: (client: string, session: string) => Effect.Effect<void, LedgerError>;
    readonly online: (key: string) => Effect.Effect<ReadonlyArray<Online>, LedgerError>;
  }
>()("@kampus/libfabrika/GatewayManager") {
  static readonly layer = <P, A>(sql: Sql, adapter: Adapter<P, A>): Layer.Layer<GatewayManager, never, P | A> =>
    Layer.effect(
      GatewayManager,
      Effect.gen(function* () {
        // Capture the adapters' services once. Calling a method still does all its work lazily.
        const context = yield* Effect.context<P | A>();
        const stored = Effect.fnUntraced(function* <T>(step: () => T) {
          return yield* Effect.try({
            try: () =>
              sql.transaction(() => {
                sql.exec(`CREATE TABLE IF NOT EXISTS process_gateways (
							client TEXT PRIMARY KEY, "key" TEXT NOT NULL, gateway TEXT NOT NULL,
							session TEXT NOT NULL, at INTEGER NOT NULL)`);
                return step();
              }),
            catch: (error) => new LedgerError({ reason: Schema.isSchemaError(error) ? "bad_row" : "storage" }),
          });
        });
        const probe = Effect.fn("gateway.probe")(function* (connection: Connection) {
          yield* Effect.annotateCurrentSpan(
            short({ "fab.gateway": connection.gateway, "fab.gateway.session": connection.session }),
          );
          return yield* Effect.suspend(() => adapter.probe(connection.gateway, connection.session)).pipe(
            Effect.provideContext(context),
          );
        });
        return {
          join: Effect.fn("gateway.join")(function* (connection: Connection) {
            yield* Effect.annotateCurrentSpan(
              short({
                "fab.gateway.client": connection.client,
                "fab.gateway.session": connection.session,
              }),
            );
            yield* stored(() => {
              const row = decodeConnection(connection);
              sql.exec(
                `INSERT INTO process_gateways ("key", client, gateway, session, at) VALUES (?, ?, ?, ?, ?)
							ON CONFLICT(client) DO UPDATE SET "key" = excluded."key", gateway = excluded.gateway,
							session = excluded.session, at = excluded.at`,
                row.key,
                row.client,
                row.gateway,
                row.session,
                row.at,
              );
            });
          }),
          leave: Effect.fn("gateway.leave")(function* (client: string, session: string) {
            yield* Effect.annotateCurrentSpan(short({ "fab.gateway.client": client, "fab.gateway.session": session }));
            yield* stored(() => {
              sql.exec(`DELETE FROM process_gateways WHERE client = ? AND session = ?`, client, session);
            });
          }),
          online: Effect.fn("gateway.online")(function* (key: string) {
            yield* Effect.annotateCurrentSpan(short({ "fab.gateway.key": key }));

            if (!(yield* Effect.suspend(() => adapter.admitted(key)).pipe(Effect.provideContext(context)))) {
              return [];
            }

            const connections = yield* stored(() =>
              sql
                .exec(`SELECT * FROM process_gateways WHERE "key" = ? ORDER BY client`, key)
                .map((row) => decodeConnection(row)),
            );
            return yield* Effect.forEach(
              connections,
              (connection) =>
                Effect.gen(function* () {
                  const ping = yield* Effect.result(probe(connection));
                  const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
                  return Online.make({
                    ...connection,
                    state:
                      ping._tag === "Failure"
                        ? "unknown"
                        : now - (ping.success ?? connection.at) >= AWAY
                          ? "away"
                          : "online",
                  });
                }),
              { concurrency: "unbounded" },
            );
          }),
        };
      }),
    );
}
