import {Context, Effect, Layer, Option, Result, Schema, Stream} from "effect";
import {LedgerTransaction, type LedgerTurn} from "../data/ledger-transaction.ts";
import {type Ledger, type LedgerError} from "../data/ledger.ts";
import {lineFor, type Rev} from "../data/log.ts";
import {short} from "../data/trace.ts";
import {type From, type Letter, Mailbox} from "./mailbox.ts";
import {processMail} from "./process-mail.ts";
import {
	type Caller,
	clientInbox,
	Dead,
	DeadInput,
	Down,
	ProcessError,
	ProcessEvent,
	type ProcessInfo,
	ProcessTable,
	signalId,
	type Start,
	type StartAnswer,
	type State,
} from "./process.ts";

const tag = (word: string): string => `fab.process.${word}`;
const id = (...parts: ReadonlyArray<Schema.Json>): string => JSON.stringify(parts);
const Send = Schema.TaggedStruct("send", {m: Down});
type Policy = {readonly reason: string; readonly crashes: number; readonly until: number};
type Failure = ProcessError | LedgerError;
/**
 * Trusted wiring, never decoded from public params: who calls, and `by`, the brain's own writer
 * key. Every event this manager writes carries that `by`, and its fold trusts no other.
 */
type Wiring = Caller & {readonly by: string};
const failed = Effect.fnUntraced(function* (error: Failure) {
	yield* Effect.annotateCurrentSpan({[tag("answer")]: "refused", [tag("reason")]: error.reason});
});

export class ProcessManager extends Context.Service<
	ProcessManager,
	{
		readonly start: (request: Start, from: From) => Effect.Effect<StartAnswer, Failure>;
		readonly exit: (process: string, reason: string, from: From) => Effect.Effect<void, Failure>;
		readonly info: Effect.Effect<ReadonlyArray<ProcessInfo>, LedgerError>;
		readonly status: (name: string) => Effect.Effect<
			{
				readonly name: string;
				readonly state: typeof State.Type;
				readonly at: number;
				readonly restarts: ReadonlyArray<number>;
			},
			Failure
		>;
		readonly resolve: (
			process: string,
		) => Effect.Effect<{readonly name: string; readonly state: typeof State.Type}, Failure>;
		readonly dead: (
			process: string,
			dead: typeof DeadInput.Type,
			from: From,
		) => Effect.Effect<void, Failure>;
		readonly isLive: (process: string) => Effect.Effect<boolean, LedgerError>;
		readonly monitor: (ref: string, process: string, from: From) => Effect.Effect<void, Failure>;
		readonly demonitor: (ref: string, from: From) => Effect.Effect<void, Failure>;
		readonly receive: (process: string, after: Rev) => Stream.Stream<Letter, Failure>;
		readonly down: (process: string, policy: Policy, from: From) => Effect.Effect<void, Failure>;
	}
>()("@kampus/libfabrika/ProcessManager") {
	static readonly layer = (
		caller: Wiring,
		nextId: Effect.Effect<string>,
	): Layer.Layer<ProcessManager, never, LedgerTransaction> =>
		Layer.effect(
			ProcessManager,
			Effect.gen(function* () {
				const tx = yield* LedgerTransaction;
				const fold = (turn: LedgerTurn) => ProcessTable.read(turn.read, caller.by);
				// The brain writes every line here; `from` keeps the call's person, parent and trace, and
				// `asked` keeps the caller's own key. The fold trusts `by` alone and never reads `asked`.
				const line = (from: From, event: Parameters<typeof lineFor>[1]) =>
					lineFor({...from, by: caller.by}, {...event, asked: from.by});
				const checked = Effect.fnUntraced(function* <A>(
					step: (table: ProcessTable, turn: LedgerTurn) => Result.Result<A, ProcessError>,
				) {
					return yield* Effect.fromResult(yield* tx.transact((turn) => step(fold(turn), turn)));
				});
				const signal = (
					table: ProcessTable,
					turn: LedgerTurn,
					watch: {readonly ref: string; readonly round: number},
					process: string,
					reason: string,
					to: (typeof Down.Type)["to"],
					from: From,
				) => {
					const {ref, round} = watch;
					const inbox =
						to._tag === "client"
							? clientInbox(to.client)
							: `${Option.getOrThrow(table.life(to.process)).name}/inbox`;
					const letter = signalId(to, ref, round);
					// A retried call may find this signal already written. Only the brain's own row counts;
					// another writer's row at this id makes the append refuse, and the whole turn with it.
					if (
						[...turn.read(inbox, 0)].some((entry) => entry.id === letter && entry.by === caller.by)
					)
						return;
					turn.append(
						inbox,
						letter,
						line(from, Send.make({m: Down.make({ref, process, reason, to})})),
					);
				};
				const start = Effect.fn("process.start")(function* (request: Start, from: From) {
					yield* Effect.annotateCurrentSpan(
						short({
							[tag("name")]: request.name,
							[tag("program")]: request.code.program,
							[tag("hash")]: request.code.hash,
						}),
					);
					const saved = yield* checked((table) => table.start(request, caller, from));
					const answer = Option.isSome(saved)
						? saved.value
						: yield* Effect.gen(function* () {
								const process = yield* nextId;
								return yield* checked((table, turn) => {
									const current = table.start(request, caller, from);
									if (Result.isFailure(current)) return Result.fail(current.failure);
									if (Option.isSome(current.success)) return Result.succeed(current.success.value);
									if (table.collision(process))
										return Result.fail(new ProcessError({reason: "id_collision"}));
									if (request._tag === "first")
										turn.append(
											ProcessTable.stream,
											id("registered", request.name),
											line(
												from,
												ProcessEvent.cases.registered.make({
													name: request.name,
													program: request.code.program,
													owner: caller.owner,
												}),
											),
										);
									const placed = turn.append(
										ProcessTable.events(request.name),
										request.id,
										line(
											from,
											ProcessEvent.cases.started.make({
												process,
												name: request.name,
												...request.code,
											}),
										),
									);
									if (request._tag === "again")
										turn.append(
											ProcessTable.events(request.name),
											id("restarted", process),
											line(
												from,
												ProcessEvent.cases.restarted.make({
													process,
													after: request.after,
													name: request.name,
													reason: request.reason,
													build: request.code.hash,
												}),
											),
										);
									return Result.succeed({process, rev: placed.rev});
								});
							});
					yield* Effect.annotateCurrentSpan({
						"fab.process": answer.process,
						[tag("answer")]: "placed",
						[tag("rev")]: answer.rev,
					});
					return answer;
				}, Effect.tapError(failed));
				const exit = Effect.fn("process.exit")(function* (
					process: string,
					reason: string,
					from: From,
				) {
					yield* Effect.annotateCurrentSpan({"fab.process": process});
					yield* checked((table, turn) => {
						const life = table.exit(process, reason, caller.owner);
						if (Result.isFailure(life)) return Result.fail(life.failure);
						if (life.success.state._tag !== "live") return Result.succeed(undefined);
						turn.append(
							ProcessTable.events(life.success.name),
							id("exited", process),
							line(from, ProcessEvent.cases.exited.make({process, reason})),
						);
						for (const watch of table.inbound(process))
							signal(table, turn, watch, process, reason, watch.to, from);
						for (const watch of table.outbound(process))
							turn.append(
								ProcessTable.stream,
								id("demonitored", watch.to, watch.ref, watch.round),
								line(
									from,
									ProcessEvent.cases.demonitored.make({
										ref: watch.ref,
										to: watch.to,
										reason: "watcher_exited",
									}),
								),
							);
						return Result.succeed(undefined);
					});
				}, Effect.tapError(failed));
				const monitor = Effect.fn("process.monitor")(function* (
					ref: string,
					process: string,
					from: From,
				) {
					yield* Effect.annotateCurrentSpan({
						"fab.process": process,
						...short({[tag("ref")]: ref}),
					});
					yield* checked((table, turn) => {
						const round = table.monitor(ref, process, caller.recipient);
						if (Result.isFailure(round)) return Result.fail(round.failure);
						if (Option.isNone(round.success)) return Result.succeed(undefined);
						turn.append(
							ProcessTable.stream,
							id("monitored", caller.recipient, ref, round.success.value),
							line(from, ProcessEvent.cases.monitored.make({ref, process, to: caller.recipient})),
						);
						if (!table.isLive(process))
							signal(
								table,
								turn,
								{ref, round: round.success.value},
								process,
								"noproc",
								caller.recipient,
								from,
							);
						return Result.succeed(undefined);
					});
				}, Effect.tapError(failed));
				const demonitor = Effect.fn("process.demonitor")(function* (ref: string, from: From) {
					yield* Effect.annotateCurrentSpan(short({[tag("ref")]: ref}));
					yield* checked((table, turn) => {
						const watch = table.demonitor(ref, caller.recipient);
						if (Option.isSome(watch))
							turn.append(
								ProcessTable.stream,
								id("demonitored", caller.recipient, ref, watch.value.round),
								line(
									from,
									ProcessEvent.cases.demonitored.make({
										ref,
										to: caller.recipient,
										reason: "canceled",
									}),
								),
							);
						return Result.succeed(undefined);
					});
				}, Effect.tapError(failed));
				const down = Effect.fn("process.down")(function* (
					process: string,
					policy: Policy,
					from: From,
				) {
					yield* Effect.annotateCurrentSpan({"fab.process": process});
					yield* checked((table, turn) => {
						const life = table.down(process, policy.reason, caller.owner);
						if (Result.isFailure(life)) return Result.fail(life.failure);
						turn.append(
							ProcessTable.events(life.success.name),
							id("down", process, policy),
							line(from, ProcessEvent.cases.down.make({process, ...policy})),
						);
						return Result.succeed(undefined);
					});
				}, Effect.tapError(failed));
				const receive = (process: string, after: Rev): Stream.Stream<Letter, Failure> =>
					Stream.unwrap(
						Effect.gen(function* () {
							yield* Effect.annotateCurrentSpan({"fab.process": process, [tag("after")]: after});
							const mail = yield* checked((table, turn) => {
								const life = table.life(process);
								if (Option.isNone(life) || !table.isLive(process))
									return Result.fail(new ProcessError({reason: "ended"}));
								return Result.succeed(
									processMail(table, process, turn.read(`${life.value.name}/inbox`, after)),
								);
							});
							const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
							yield* Effect.annotateCurrentSpan({
								[tag("letters")]: mail.length,
								...(mail.length === 0
									? {}
									: {[tag("lag")]: Math.max(...mail.map(({arrivedAt}) => now - arrivedAt))}),
							});
							return Stream.fromIterable(mail.map(({letter}) => letter));
						}).pipe(Effect.tapError(failed)),
					).pipe(Stream.withSpan("process.receive"));
				const info = Effect.fn("process.info")(function* () {
					return yield* tx.transact((turn) => fold(turn).info);
				});
				return {
					resolve: Effect.fn("process.resolve")(function* (process: string) {
						return yield* checked((table) => {
							const old = table.parent(process, caller.owner);
							return Result.isFailure(old)
								? Result.fail(old.failure)
								: table.status(old.success.name, caller.owner);
						});
					}),
					status: Effect.fn("process.status")(function* (name: string) {
						const status = yield* checked((table) => table.status(name, caller.owner));
						return {...status, at: yield* Effect.clockWith((clock) => clock.currentTimeMillis)};
					}),
					dead: Effect.fn("process.dead")(function* (
						process: string,
						dead: typeof DeadInput.Type,
						from: From,
					) {
						const input = yield* Schema.decodeUnknownEffect(DeadInput)(dead).pipe(
							Effect.mapError(() => new ProcessError({reason: "bad_text"})),
						);
						yield* checked((table, turn) => {
							const life = table.parent(process, caller.owner);
							if (Result.isFailure(life)) return Result.fail(life.failure);
							const value = Dead.make({
								...input,
								process: life.success.state.process,
								program: life.success.state.code.program,
								name: life.success.name,
							});
							const stream = `${process}/dead`;
							const key = id("dead", process, value.m);
							const prior = [...turn.read(stream, 0)].find(
								(entry) => entry.id === key && entry.by === caller.by,
							);
							if (prior === undefined) turn.append(stream, key, line(from, value));
							return Result.succeed(undefined);
						});
					}),
					start,
					exit,
					monitor,
					demonitor,
					down,
					receive,
					info: info(),
					isLive: Effect.fn("process.isLive")(function* (process: string) {
						return yield* tx.transact((turn) => fold(turn).isLive(process));
					}),
				};
			}),
		);
}

export const CoordinationLayer = (
	caller: Wiring,
	nextId: Effect.Effect<string>,
): Layer.Layer<Mailbox | ProcessManager, never, Ledger | LedgerTransaction> =>
	Layer.mergeAll(Mailbox.layer, ProcessManager.layer(caller, nextId));
