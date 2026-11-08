// A process's start: which build it ran, recorded once per build on the stream `<pid>` (p21). In
// `next/`, a program's start is a process; "run" is an agent run only. Tier 1, P9. P33 adds exit,
// info, monitor, demonitor and the run number.
import {Context, Effect, Layer, Schema} from "effect";
import {Ledger, type LedgerError} from "../data/ledger.ts";
import type {Appended} from "../data/log.ts";
import {short} from "../data/referee.ts";
import {answered, failed, type From, lineFor, Mailbox} from "./mailbox.ts";

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
				start: (pid, {program, hash}, from) =>
					ledger.append(pid, hash, lineFor(from, Started.make({program, hash}))).pipe(
						Effect.tap((answer) => answered(tag, answer)),
						Effect.tapError(failed(tag)),
						Effect.withSpan("process.start", {
							attributes: short({
								[tag("pid")]: pid,
								[tag("program")]: program,
								[tag("hash")]: hash,
							}),
						}),
					),
			};
		}),
	);
}

/** The Mailbox and the ProcessManager over one Ledger. */
export const CoordinationLayer: Layer.Layer<Mailbox | ProcessManager, never, Ledger> =
	Layer.mergeAll(Mailbox.layer, ProcessManager.layer);
