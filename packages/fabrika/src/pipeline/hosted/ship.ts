// Ship on tea-host (experiment 104): the ship machine, unchanged, under `ship:<n>`. Its three writes
// (enqueue, merge, a re-run of red checks) go through `Idempotency` to `Outside`, keyed by the pull
// request and head, so a ship taken over after its enqueue finds the pull request in the queue and
// does not enqueue again. No agent: ship is code.
import {Effect, Option, Schema} from "effect";
import type {CriteriaRecord} from "../criteria/record.ts";
import {type CodeHost, CodeHostWrites} from "../services.ts";
import {nameOf} from "../stages/outcome.ts";
import {Merged, Rerun} from "../stages/ship/facts.ts";
import {shipReadInterpret, shipSubscribe, shipWriteInterpret} from "../stages/ship/handlers.ts";
import {type Ship, type ShipMsg, ship} from "../stages/ship/machine.ts";
import {Idempotency} from "./idempotency.ts";
import {EnqueueAnswer, Outside} from "./outside.ts";
import {jsonJournal, type Stage} from "./stage.ts";

export const ShipJob = Schema.Struct({pr: Schema.String});
export type ShipJob = typeof ShipJob.Type;

/** `CodeHostWrites` whose every write goes out once, under this lease's gate. */
export const shipWritesOf = (
	gate: Idempotency["Service"],
	outside: Outside["Service"],
): CodeHostWrites["Service"] => ({
	enqueue: (ready) =>
		gate.once({
			op: "enqueue",
			subject: `${ready.pr}@${ready.head}`,
			answer: EnqueueAnswer,
			look: () =>
				outside
					.landing(ready.pr, ready.head)
					.pipe(
						Effect.map((l) =>
							l.at === "none" ? Option.none() : Option.some<EnqueueAnswer>("queued"),
						),
					),
			send: (key) => outside.enqueue(key, ready),
		}),
	merge: (ready) =>
		gate.once({
			op: "merge",
			subject: `${ready.pr}@${ready.head}`,
			answer: Merged,
			look: () =>
				outside
					.landing(ready.pr, ready.head)
					.pipe(
						Effect.map((l) =>
							l.at === "merged"
								? Option.some<Merged>({reading: "merged", commit: l.commit})
								: Option.none(),
						),
					),
			send: (key) => outside.merge(key, ready),
		}),
	// A re-run leaves nothing to read back by key: one sent before a kill may be sent again.
	rerunChecks: (pr, head) =>
		gate.once({
			op: "rerun",
			subject: `${pr}@${head}`,
			answer: Schema.Array(Rerun),
			look: () => Effect.succeed(Option.none()),
			send: (key) => outside.rerunChecks(key, pr, head),
		}),
});

export const hostedShip: Stage<
	Ship,
	ShipMsg,
	ShipJob,
	CodeHost | CriteriaRecord | Outside | Idempotency
> = {
	kind: "ship",
	job: ShipJob,
	boot: (self) =>
		Effect.gen(function* () {
			const writes = shipWritesOf(yield* Idempotency, yield* Outside);
			return yield* self
				.run(
					ship,
					{schema: jsonJournal<Ship>(), cursor: () => 0},
					{
						ctx: undefined,
						interpret: {...shipReadInterpret, ...shipWriteInterpret()},
						subscribe: shipSubscribe,
						terminal: (s: Ship) => s.phase === "over",
					},
				)
				.pipe(Effect.provideService(CodeHostWrites, writes));
		}),
	over: (s) => s.phase === "over",
	idle: (s) => s.phase === "idle",
	start: (job) => ({type: "start", pr: job.pr}),
	resume: {type: "resume"},
	finish: (end) =>
		Effect.succeed(end.phase === "over" ? {name: nameOf(end.outcome), outcome: end.outcome} : null),
	agent: null,
};
