import {Effect, Stream} from "effect";
import type {RunSub, readFacts, readTicket} from "./machine.ts";
import {PlanFacts, PlanHost, Planner} from "./services.ts";

// What answers the plan machine's Cmds and runs its Sub. Both Cmds are reads;
// the machine writes nothing.

export const planInterpret = {
	plan_ticket: (cmd: ReturnType<typeof readTicket>) =>
		Effect.gen(function* () {
			return yield* (yield* PlanHost).ticket(cmd.ticket);
		}),
	plan_facts: (cmd: ReturnType<typeof readFacts>) =>
		Effect.gen(function* () {
			return yield* (yield* PlanFacts).gather(cmd.ticket);
		}),
};

export const planSubscribe = {
	/** The planner's run, as long as the Sub is on. When it closes, the stream is cut, and the agent with it. */
	plan_run: (sub: RunSub) =>
		Stream.unwrap(
			Effect.gen(function* () {
				return (yield* Planner).run(sub.deps.run, sub.deps.settings);
			}),
		),
};
