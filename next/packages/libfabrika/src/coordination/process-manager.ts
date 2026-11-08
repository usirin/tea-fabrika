// A process's start: which build it ran, recorded once per build on the stream `<pid>` (p21). In
// `next/`, a program's start is a process; "run" is an agent run only. Tier 1, P9. P33 adds exit,
// info, monitor, demonitor and the run number.
import {Context, Effect, Layer, Schema} from "effect";
import {Ledger, type LedgerError} from "../data/ledger.ts";
import {type Appended, lineFor} from "../data/log.ts";
import {short} from "../data/trace.ts";
import {answered, failed, type From, Mailbox} from "./mailbox.ts";

const tag = (word: string): string => `fab.process.${word}`;

/** The one line a start writes: the program and the hash of the build it ran. */
const Started = Schema.TaggedStruct("started", {program: Schema.String, hash: Schema.String});

export class ProcessManager extends Context.Service<
	ProcessManager,
	{
		/** One `started` line on `<pid>`, under the build hash. The same build again with the same
		 *  `by`, `for` and `cause` gets its first placing; from another input it is `id_reused`. */
		readonly start: (
			pid: string,
			code: {readonly program: string; readonly hash: string},
			from: From,
		) => Effect.Effect<Appended, LedgerError>;
	}
>()("@kampus/libfabrika/ProcessManager") {
	/** Building it touches nothing: each call reaches the ledger on its own. */
	static readonly layer: Layer.Layer<ProcessManager, never, Ledger> = Layer.effect(
		ProcessManager,
		Effect.gen(function* () {
			const ledger = yield* Ledger;
			return {
				start: Effect.fn("process.start")(
					function* (
						pid: string,
						code: {readonly program: string; readonly hash: string},
						from: From,
					) {
						const {program, hash} = code;
						yield* Effect.annotateCurrentSpan(
							short({[tag("pid")]: pid, [tag("program")]: program, [tag("hash")]: hash}),
						);
						return yield* ledger.append(pid, hash, lineFor(from, Started.make({program, hash})));
					},
					Effect.tap((answer) => answered(tag, answer)),
					Effect.tapError(failed(tag)),
				),
			};
		}),
	);
}

/** The Mailbox and the ProcessManager over one Ledger. */
export const CoordinationLayer: Layer.Layer<Mailbox | ProcessManager, never, Ledger> =
	Layer.mergeAll(Mailbox.layer, ProcessManager.layer);
