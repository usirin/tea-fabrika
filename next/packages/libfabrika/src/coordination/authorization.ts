import {Effect, Result, Schema} from "effect";
import {LedgerTransaction} from "../data/ledger-transaction.ts";
import {LedgerError} from "../data/ledger.ts";
import {Appended, type Line, valueFor} from "../data/log.ts";
import {short} from "../data/trace.ts";
import {admitted, foldMembers, MemberFact} from "./members.ts";
import {NotGranted} from "./session-manager.ts";

const known: ReadonlySet<string> = new Set(Object.keys(MemberFact.cases));
const decodeFact = Schema.decodeUnknownResult(MemberFact);

/** Current membership and the client write share one synchronous ledger transaction. */
export const appendAdmitted = Effect.fn("authorization.appendAdmitted")(
	function* (
		key: string,
		write: {readonly stream: string; readonly id: string; readonly line: Line},
	) {
		yield* Effect.annotateCurrentSpan(
			short({"fab.authorization.id": write.id, "fab.authorization.stream": write.stream}),
		);
		const transaction = yield* LedgerTransaction;
		const result = yield* transaction.transact(
			(turn): Result.Result<Appended, LedgerError | NotGranted> => {
				const facts: MemberFact[] = [];

				for (const row of turn.read("door/members", 0)) {
					if (!known.has(row._tag)) {
						continue;
					}

					const fact = decodeFact(valueFor(row));

					if (Result.isFailure(fact)) {
						return Result.fail(new LedgerError({why: "bad_row"}));
					}

					facts.push(fact.success);
				}

				if ("why" in admitted(foldMembers(facts), key)) {
					return Result.fail(new NotGranted({}));
				}

				return Result.succeed(
					Appended.cases.placed.make(turn.append(write.stream, write.id, write.line)),
				);
			},
		);
		const appended = yield* Effect.fromResult(result);
		yield* Effect.annotateCurrentSpan("fab.authorization.outcome", "placed");
		return appended;
	},
	Effect.tapError((error) =>
		Effect.annotateCurrentSpan(
			"fab.authorization.outcome",
			error._tag === "NotGranted" ? "not_granted" : error.why,
		),
	),
);
