import {defineProgram, flag, output} from "@kampus/fabrika-old";
import {TicketNumber} from "@kampus/pipeline/tickets/ticket";
import {Context, Effect, Schema} from "effect";

// One line in a tile runs one tracker ticket through every step, each its own machine. Today's
// version. The lane itself is `laneProgram` (@kampus/pipeline): this is the line a person types.
//
//   tsh> pipeline --ticket 117            one line per step as it ends
//   tsh> pipeline --ticket 117 | runs     the runs window fills in as it goes
//
// `ticket` goes out once, at the start: that is all a window needs, and it is why closing the window
// never reaches the lane. The lane is kept under an id the ticket names, not this run's: typing the
// line again finds it where it stood.
//
// This file names no platform. What runs a lane on this machine is on the `./node` subpath.

/** What runs one ticket's lane, and says each line it has to say. */
export class LaneRunner extends Context.Service<
	LaneRunner,
	{readonly run: (n: number, say: (line: string) => Effect.Effect<void>) => Effect.Effect<void>}
>()("LaneRunner") {}

export const pipeline = defineProgram({
	name: "pipeline",
	description:
		"Runs one tracker ticket through every step: triage, plan, the person's yes, the exam, the test writer, build, mutation, one review, push, the person's yes, merge. Typed again, it goes on from where it stood.",
	flags: {
		ticket: flag(
			TicketNumber,
			"The tracker ticket to run. It must be yours, or an agent of yours.",
		),
	},
	inputs: {},
	outputs: {
		ticket: output(TicketNumber, "The ticket, once, at the start: for `runs` or `map` to open."),
		line: output(Schema.String, "One line per step as it ends, and per question as it is asked."),
	},
	machines: {},
	main: ({flags, send}) =>
		Effect.gen(function* () {
			yield* send("ticket", flags.ticket);
			const lanes = yield* LaneRunner;
			yield* lanes.run(flags.ticket, (line) => send("line", line));
		}),
});
