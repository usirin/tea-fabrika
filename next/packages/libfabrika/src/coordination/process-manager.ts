import {Context, Effect, Layer, Option, Result, Schema, Stream} from "effect";
import {LedgerTransaction, type LedgerTurn} from "../data/ledger-transaction.ts";
import {type Ledger, type LedgerError} from "../data/ledger.ts";
import {lineFor, type Rev} from "../data/log.ts";
import {short} from "../data/trace.ts";
import {type From, type Letter, Mailbox} from "./mailbox.ts";
import {processMail} from "./process-mail.ts";
import {
	type Caller,
	Down,
	ProcessError,
	ProcessFact,
	type ProcessInfo,
	ProcessTable,
	type Start,
	type StartAnswer,
} from "./process.ts";

const tag = (word: string): string => `fab.process.${word}`;
const id = (...parts: ReadonlyArray<Schema.Json>): string => JSON.stringify(parts);
const Send = Schema.TaggedStruct("send", {m: Down});
type Policy = {readonly why: string; readonly crashes: number; readonly until: number};
type Failure = ProcessError | LedgerError;
const failed = Effect.fnUntraced(function* (error: Failure) {
	yield* Effect.annotateCurrentSpan({[tag("answer")]: "refused", [tag("why")]: error.why});
});

export class ProcessManager extends Context.Service<
	ProcessManager,
	{
		readonly start: (request: Start, from: From) => Effect.Effect<StartAnswer, Failure>;
		readonly exit: (process: string, why: string, from: From) => Effect.Effect<void, Failure>;
		readonly info: Effect.Effect<ReadonlyArray<ProcessInfo>, LedgerError>;
		readonly isLive: (process: string) => Effect.Effect<boolean, LedgerError>;
		readonly monitor: (ref: string, process: string, from: From) => Effect.Effect<void, Failure>;
		readonly demonitor: (ref: string, from: From) => Effect.Effect<void, Failure>;
		readonly receive: (process: string, after: Rev) => Stream.Stream<Letter, Failure>;
		readonly down: (process: string, policy: Policy, from: From) => Effect.Effect<void, Failure>;
	}
>()("@kampus/libfabrika/ProcessManager") {
	static readonly layer = (
		caller: Caller,
		nextId: Effect.Effect<string>,
	): Layer.Layer<ProcessManager, never, LedgerTransaction> =>
		Layer.effect(
			ProcessManager,
			Effect.gen(function* () {
				const tx = yield* LedgerTransaction;
				const checked = Effect.fnUntraced(function* <A>(
					step: (table: ProcessTable, turn: LedgerTurn) => Result.Result<A, ProcessError>,
				) {
					return yield* Effect.fromResult(
						yield* tx.run((turn) => step(ProcessTable.read(turn.read), turn)),
					);
				});
				const signal = (
					table: ProcessTable,
					turn: LedgerTurn,
					ref: string,
					process: string,
					why: string,
					to: (typeof Down.Type)["to"],
					from: From,
				) => {
					const name =
						to._tag === "client" ? to.client : Option.getOrThrow(table.life(to.process)).name;
					turn.append(
						`${name}/inbox`,
						id("DOWN", to, ref),
						lineFor(from, Send.make({m: Down.make({ref, process, why, to})})),
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
									if (Result.isFailure(current)) return current;
									if (Option.isSome(current.success)) return Result.succeed(current.success.value);
									if (table.collision(process))
										return Result.fail(new ProcessError({why: "id_collision"}));
									if (request._tag === "first")
										turn.append(
											ProcessTable.stream,
											id("registered", request.name),
											lineFor(
												from,
												ProcessFact.cases.registered.make({
													name: request.name,
													program: request.code.program,
													owner: caller.owner,
												}),
											),
										);
									const placed = turn.append(
										request.name,
										request.id,
										lineFor(
											from,
											ProcessFact.cases.started.make({
												process,
												name: request.name,
												...request.code,
											}),
										),
									);
									if (request._tag === "again")
										turn.append(
											request.name,
											id("restarted", process),
											lineFor(
												from,
												ProcessFact.cases.restarted.make({
													process,
													after: request.after,
													name: request.name,
													why: request.why,
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
					why: string,
					from: From,
				) {
					yield* Effect.annotateCurrentSpan({"fab.process": process});
					yield* checked((table, turn) => {
						const life = table.exit(process, why, caller.owner);
						if (Result.isFailure(life)) return life;
						if (life.success.state._tag !== "live") return Result.succeed(undefined);
						turn.append(
							life.success.name,
							id("exited", process),
							lineFor(from, ProcessFact.cases.exited.make({process, why})),
						);
						for (const watch of table.inbound(process))
							signal(table, turn, watch.ref, process, why, watch.to, from);
						for (const watch of table.outbound(process))
							turn.append(
								ProcessTable.stream,
								id("demonitored", watch.ref, watch.to),
								lineFor(from, ProcessFact.cases.demonitored.make({ref: watch.ref, to: watch.to})),
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
						const watch = table.monitor(ref, process, caller.recipient);
						if (Result.isFailure(watch)) return watch;
						if (Option.isSome(watch.success)) return Result.succeed(undefined);
						turn.append(
							ProcessTable.stream,
							id("monitored", ref),
							lineFor(from, ProcessFact.cases.monitored.make({ref, process, to: caller.recipient})),
						);
						if (!table.isLive(process))
							signal(table, turn, ref, process, "noproc", caller.recipient, from);
						return Result.succeed(undefined);
					});
				}, Effect.tapError(failed));
				const demonitor = Effect.fn("process.demonitor")(function* (ref: string, from: From) {
					yield* Effect.annotateCurrentSpan(short({[tag("ref")]: ref}));
					yield* checked((table, turn) => {
						const watch = table.demonitor(ref, caller.recipient);
						if (Result.isFailure(watch)) return watch;
						if (Option.isSome(watch.success) && !watch.success.value.canceled)
							turn.append(
								ProcessTable.stream,
								id("demonitored", ref, caller.recipient),
								lineFor(from, ProcessFact.cases.demonitored.make({ref, to: caller.recipient})),
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
						const life = table.parent(process, caller.owner);
						if (Result.isFailure(life)) return life;
						if (life.success.state._tag === "live")
							return Result.fail(new ProcessError({why: "alive"}));
						turn.append(
							life.success.name,
							id("down", process, policy),
							lineFor(from, ProcessFact.cases.down.make({process, ...policy})),
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
									return Result.fail(new ProcessError({why: "ended"}));
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
				return {
					start,
					exit,
					monitor,
					demonitor,
					down,
					receive,
					info: tx
						.run((turn) => ProcessTable.read(turn.read).info)
						.pipe(Effect.withSpan("process.info")),
					isLive: Effect.fn("process.isLive")(function* (process: string) {
						return yield* tx.run((turn) => ProcessTable.read(turn.read).isLive(process));
					}),
				};
			}),
		);
}

export const CoordinationLayer = (
	caller: Caller,
	nextId: Effect.Effect<string>,
): Layer.Layer<Mailbox | ProcessManager, never, Ledger | LedgerTransaction> =>
	Layer.mergeAll(Mailbox.layer, ProcessManager.layer(caller, nextId));
