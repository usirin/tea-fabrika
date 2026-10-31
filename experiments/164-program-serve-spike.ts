// Experiment 164: experiment 79's flood on one mailbox. A host tells COUNT
// values, split over two inputs, to a run that never serves them; then says
// what each tell answered and how much the heap grew. No model, no network, $0.
//
//   node --expose-gc experiments/164-program-serve-spike.ts
//   COUNT=100000 node --expose-gc experiments/164-program-serve-spike.ts
//
// When the spike ran (2026-10-28), this script floods two runs side by side:
// the runtime of that day, one queue per input, and the spike's one mailbox
// (164-program-serve-spike/serve.ts). Since
// https://github.com/usirin/tea-fabrika/pull/195 the runtime is that one
// mailbox, and the spike no longer runs on it, so the script floods the
// runtime alone. The spike's own numbers are in the write-up.

import {defineProgram, input, start, tell} from "@kampus/fabrika";
import {Effect, Schema} from "effect";

const COUNT = Number(process.env.COUNT ?? 1_000_000);

const stuck = defineProgram({
	name: "stuck",
	description: "Never serves its inputs.",
	inputs: {
		line: input(Schema.String, "A line."),
		other: input(Schema.String, "Another line."),
	},
	outputs: {},
	main: () => Effect.never,
});

// Node at the edge, said out loud: `gc` and `memoryUsage` are how the heap is read.
const heap = () => {
	(globalThis as {gc?: () => void}).gc?.();
	return process.memoryUsage().heapUsed;
};

const name = (i: number) => (i % 2 === 0 ? "line" : "other");

const report = await Effect.runPromise(
	Effect.gen(function* () {
		const started = yield* start(stuck, {});
		if (started.kind !== "running") return null;
		const run = started.run;
		const before = heap();
		const counts: Record<string, number> = {};
		for (let i = 0; i < COUNT; i++) {
			const word = yield* tell(run, name(i), `line ${i} of a script`).pipe(
				Effect.catch((full) => Effect.succeed(full._tag)),
			);
			counts[word] = (counts[word] ?? 0) + 1;
		}
		return {told: COUNT, counts, heapGrewMB: Math.round((heap() - before) / 1e5) / 10};
	}).pipe(Effect.scoped),
);
console.log(JSON.stringify(report));
