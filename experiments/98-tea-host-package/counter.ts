// Experiment 94's counter as a program the package serves. The machine is 94's
// (../94-tea-host/counter.ts), unchanged. What changed is everything around it: the program asks
// for nothing of its own (94's `Journal` service is gone). It gets `Self` from the host and runs
// the machine with `self.run`, which fills in the journal on `counter:1/state` and the error sink;
// its inbox comes as envelopes from the host's tail, after the journal's cursor.
import {defineProgram, envelope, input, Self} from "@kampus/fabrika-old";
import {Effect, Schema, Stream} from "effect";
import {Count, counter} from "../94-tea-host/counter.ts";

/** What a sender puts in each message: its id again, so the checks can read it from the row. */
export const Sent = Schema.Struct({id: Schema.String});

export const counterProgram = defineProgram({
	name: "counter",
	description:
		"Counts the messages in its inbox, once each, saving each count before it reads the next.",
	inputs: {inbox: input(envelope(Sent), "One message: its id, its rev in the inbox, its sender.")},
	outputs: {},
	main: ({inputs}) =>
		Effect.gen(function* () {
			const self = yield* Self;
			const handle = yield* self.run(
				counter,
				{schema: Count, cursor: (s) => s.cursor},
				{ctx: undefined},
			);
			const machine = yield* handle.ready;
			// Each dispatch returns once its state is saved: a refused save fails `main`, and the
			// run is gone (OTP: the process exits). The host says so and waits for the lease.
			yield* inputs.inbox.pipe(
				Stream.runForEach((e) => machine.dispatch({type: "increment", id: e.body.id, rev: e.rev})),
			);
		}).pipe(Effect.scoped),
});
