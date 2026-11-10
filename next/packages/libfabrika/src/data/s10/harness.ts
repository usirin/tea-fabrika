// S10 spike, never merged. The test seam on route E: a `SqlClient` wrapped so a law can count
// statements or make one fail. On main that seam is the three-function `Sql` itself.
import {Effect, Layer} from "effect";
import {SqlClient, SqlError} from "effect/sql";
import {type TransactionSync, withSyncTurn} from "./sync-turn.ts";

/** What to do with one statement: let it pass, or fail it with what the driver would make of `thrown`. */
export type Verdict = {readonly thrown?: unknown; readonly pass?: true};
export type Hook = (query: string) => Verdict;
export const pass = (): Verdict => ({pass: true});

export type Handle = {readonly path: string; readonly hook?: Hook};

const failed = (thrown: unknown) =>
	Effect.fail(
		new SqlError.SqlError({
			reason: SqlError.classifySqliteError(thrown, {
				message: "Failed to execute statement",
				operation: "execute",
			}),
		}),
	);

/** The `SqlClient` below it, with `hook` asked before every statement the store makes. */
export const hooked = (hook: Hook): Layer.Layer<SqlClient.SqlClient, never, SqlClient.SqlClient> =>
	Layer.effect(
		SqlClient.SqlClient,
		Effect.map(SqlClient.SqlClient, (client) => {
			const ask = (query: string, run: () => unknown) => {
				const verdict = hook(query);
				return verdict.pass === true ? run() : failed(verdict.thrown);
			};
			return new Proxy(client, {
				apply: (target, self, args: Array<unknown>) =>
					ask(Array.isArray(args[0]) ? args[0].join("?") : String(args[0]), () =>
						Reflect.apply(target, self, args),
					),
				get: (target, key) =>
					key === "unsafe"
						? (query: string, params?: ReadonlyArray<unknown>) =>
								ask(query, () => target.unsafe(query, params))
						: Reflect.get(target, key, target),
			});
		}),
	);

/** node:sqlite's own BEGIN and COMMIT, run through the client, as one synchronous call. */
export const nodeTurn =
	(client: SqlClient.SqlClient): TransactionSync =>
	(step) => {
		Effect.runSync(client.unsafe("BEGIN IMMEDIATE"));

		try {
			const value = step();
			Effect.runSync(client.unsafe("COMMIT"));
			return value;
		} catch (error) {
			Effect.runSync(Effect.ignore(client.unsafe("ROLLBACK")));
			throw error;
		}
	};

/** `S10_TURN=sync` runs every law on the synchronous turn; unset, on the driver's own turn. */
export const turned: Layer.Layer<SqlClient.SqlClient, never, SqlClient.SqlClient> =
	process.env["S10_TURN"] === "sync"
		? Layer.effect(
				SqlClient.SqlClient,
				Effect.map(SqlClient.SqlClient, (client) => withSyncTurn(client, nodeTurn(client))),
			)
		: Layer.effect(SqlClient.SqlClient, SqlClient.SqlClient);
