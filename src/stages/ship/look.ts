import {applyCell} from "@demlik/tea";
import {Effect, Schema} from "effect";
import type {CodeHost} from "../../services.ts";
import {nameOf} from "../outcome.ts";
import {ShipFacts} from "./facts.ts";
import {shipReadInterpret} from "./handlers.ts";
import {readShipFacts, type Ship, type ShipCmd, ship} from "./machine.ts";
import {SHIP_NAMES, ShipOutcome} from "./outcome.ts";

// The ship machine on one pull request, as far as reading goes. It starts the
// real machine, answers its one read from the `CodeHost`, and stops at the
// first step after it: an ending, a wait, or a Cmd that would write. That Cmd
// is handed back, never sent. There is no way to make this write: it holds no
// handler that does.

/** A write the machine would send, as the Cmd it would send it with. */
const Write = (type: "ship_enqueue" | "ship_rerun_checks") =>
	Schema.Struct({
		type: Schema.Literal(type),
		pr: Schema.String,
		head: Schema.String,
		intent: Schema.String,
	});

/** What a look found. A schema, so the ship program can send it as an output. */
export const Look = Schema.Struct({
	pr: Schema.String,
	/** `null`: the read failed. */
	facts: Schema.NullOr(ShipFacts),
	/** The machine's answer, when the run ends at the gate or at a failed read. `null`: it would go on. */
	outcome: Schema.NullOr(ShipOutcome),
	/** The outcome's name, as it is spelled for people and logs: `send:builder:checks_red`. Made from the data, never the other way. */
	name: Schema.NullOr(Schema.Literals(SHIP_NAMES)),
	/** The write the machine sends next: the enqueue, or a re-run of red checks. It was not sent. */
	wouldSend: Schema.NullOr(Schema.Union([Write("ship_enqueue"), Write("ship_rerun_checks")])),
	/** What the machine would wait on next, with no write: checks still running. */
	wouldWaitFor: Schema.NullOr(Schema.Literal("checks")),
});
export type Look = typeof Look.Type;

type AnyMsg = {readonly type: string; readonly [field: string]: unknown};
const step = (s: Ship, msg: AnyMsg) => applyCell<Ship, AnyMsg, ShipCmd>(ship, s, msg);

/** Read one pull request and say what the machine does with it, up to its first write or wait. */
export const look = (pr: string): Effect.Effect<Look, never, CodeHost> =>
	Effect.gen(function* () {
		const [reading, [read]] = step({phase: "idle"}, {type: "start", pr});
		// The machine always starts with its read, so anything else is a bug here, not a failure to report.
		if (read?.type !== "ship_facts")
			return yield* Effect.die(new Error("the ship machine did not start with its read"));
		const answer = yield* shipReadInterpret.ship_facts(read).pipe(
			Effect.match({
				onSuccess: (value): AnyMsg & {readonly value?: ShipFacts} => ({
					type: readShipFacts.okType,
					cmd: read,
					value,
				}),
				onFailure: (error): AnyMsg & {readonly value?: ShipFacts} => ({
					type: readShipFacts.errType,
					cmd: read,
					error,
				}),
			}),
		);
		const [after, cmds] = step(reading, answer);
		const [next] = cmds;
		const outcome = after.phase === "over" ? after.outcome : null;
		return {
			pr,
			facts: answer.value ?? null,
			outcome,
			name: outcome === null ? null : nameOf(outcome),
			wouldSend: next?.type === "ship_enqueue" || next?.type === "ship_rerun_checks" ? next : null,
			wouldWaitFor: after.phase === "waiting" ? "checks" : null,
		};
	});
