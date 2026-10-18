// Experiment 79, row 11: a host floods a run that never reads its input.
// Tells COUNT values, then says what each tell answered and how much the
// heap grew. Run with `node --expose-gc experiments/79-flood.ts`.

import {Effect, Schema} from "effect";
import {defineProgram, start, tell} from "../packages/tea-program/src/program";
import {input} from "../packages/tea-program/src/shape";

const COUNT = Number(process.env.COUNT ?? 1_000_000);

const stuck = defineProgram({
	name: "stuck",
	description: "Never reads its input.",
	inputs: {line: input(Schema.String, "A line.")},
	outputs: {},
	main: () => Effect.never,
});

// Node at the edge, said out loud: `gc` and `memoryUsage` are how the heap is read.
const heap = () => {
	(globalThis as {gc?: () => void}).gc?.();
	return process.memoryUsage().heapUsed;
};

const report = await Effect.runPromise(
	Effect.gen(function* () {
		const started = yield* start(stuck, {});
		if (started.kind !== "running") return null;
		const before = heap();
		const counts: Record<string, number> = {};
		for (let i = 0; i < COUNT; i++) {
			const word = tell(started.run, "line", `line ${i} of a script`);
			counts[word] = (counts[word] ?? 0) + 1;
		}
		const grew = heap() - before;
		return {told: COUNT, counts, heapGrewMB: Math.round(grew / 1e5) / 10};
	}).pipe(Effect.scoped),
);
console.log(JSON.stringify(report));
