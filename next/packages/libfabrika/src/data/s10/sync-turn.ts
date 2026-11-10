// S10 spike, next/, never merged. A `SqlClient` whose turn is the platform's synchronous
// transaction: `withTransaction(body)` runs `body` to its end inside one `transactionSync` call, so
// nothing else in the object can run between its first statement and its commit. A body that waits
// on anything (a timer, a fetch, another fiber) cannot finish there: it is interrupted, the turn
// rolls back and the caller gets a defect, at once.
import {Cause, Context, Effect, Exit, Scheduler} from "effect";
import {type SqlClient, SqlError} from "effect/sql";

/** The one platform call this needs: `ctx.storage.transactionSync`, or node:sqlite's BEGIN and COMMIT. */
export type TransactionSync = <A>(step: () => A) => A;

const ROLLBACK = Symbol("rollback");

export const withSyncTurn = <Client extends SqlClient.SqlClient>(
	client: Client,
	transactionSync: TransactionSync,
): Client =>
	Object.assign(client, {
		withTransaction: <A, E, R>(
			body: Effect.Effect<A, E, R>,
		): Effect.Effect<A, E | SqlError.SqlError, R> =>
			Effect.flatMap(Effect.context<R>(), (context) =>
				Effect.suspend((): Effect.Effect<A, E | SqlError.SqlError> => {
					let exit: Exit.Exit<A, E> | undefined;

					try {
						transactionSync(() => {
							// No automatic yields inside the turn, as Effect's own Durable Object driver sets for
							// its turns: a child fiber that yielded would leave this one waiting.
							exit = Effect.runSyncExitWith(
								Context.add(context, Scheduler.PreventSchedulerYield, true),
							)(body);

							if (Exit.isFailure(exit)) {
								const died = Cause.squash(exit.cause);

								// Effect leaves a fiber that went async running; stop it before it writes outside the turn.
								if (Cause.isAsyncFiberError(died)) {
									died.fiber.interruptUnsafe();
								}

								throw ROLLBACK;
							}
						});
					} catch (error) {
						if (error !== ROLLBACK) {
							return Effect.fail(
								new SqlError.SqlError({
									reason: SqlError.classifySqliteError(error, {
										message: "Failed transaction",
										operation: "transaction",
									}),
								}),
							);
						}
					}

					return exit ?? Effect.die("the synchronous transaction did not run its step");
				}),
			),
	});
