import {Context, Effect, Layer} from "effect";
import {type Doorbell, type LedgerError} from "./ledger.ts";
import {type Entry, type Line, type Rev} from "./log.ts";
import {Referee, type Sql} from "./referee.ts";

/** Available only inside the synchronous callback. Refusal aborts the whole turn. */
export interface LedgerTurn {
	readonly read: (stream: string, after: Rev) => Iterable<Entry>;
	readonly append: (
		stream: string,
		id: string,
		line: Line,
	) => {readonly rev: Rev; readonly pos: Rev};
}

export class LedgerTransaction extends Context.Service<
	LedgerTransaction,
	{readonly run: <A>(step: (turn: LedgerTurn) => A) => Effect.Effect<A, LedgerError>}
>()("@kampus/libfabrika/LedgerTransaction") {
	static readonly layer = (sql: Sql): Layer.Layer<LedgerTransaction, never, Doorbell> =>
		Layer.effect(
			LedgerTransaction,
			Effect.gen(function* () {
				const referee = yield* Referee;
				return {run: referee.run};
			}),
		).pipe(Layer.provide(Referee.layer(sql)));
}
