// Experiment 79, row 11: a host floods a run that never reads its inputs.
// Tells COUNT values, half to each of two inputs, then says what each tell
// answered and how much the heap grew. Since 2026-10-30 the two share one
// mailbox, so 1000 go in across both, not 1000 each. Run with
// `node --expose-gc experiments/79-flood.ts`.

import {defineProgram, input, start, tell} from "@kampus/fabrika-old";
import {Effect, Schema} from "effect";

const COUNT = Number(process.env.COUNT ?? 1_000_000);

const stuck = defineProgram({
	name: "stuck",
	description: "Never reads its inputs.",
	inputs: {line: input(Schema.String, "A line."), other: input(Schema.String, "Another line.")},
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
			// Since 2026-10-19 a full line fails instead of answering `full`, and since 2026-10-30 the
			// error is `MailboxFull`: counted under its tag.
			const word = yield* tell(
				started.run,
				i % 2 === 0 ? "line" : "other",
				`line ${i} of a script`,
			).pipe(Effect.catchTag("MailboxFull", (full) => Effect.succeed(full._tag)));
			counts[word] = (counts[word] ?? 0) + 1;
		}
		const grew = heap() - before;
		return {told: COUNT, counts, heapGrewMB: Math.round(grew / 1e5) / 10};
	}).pipe(Effect.scoped),
);
console.log(JSON.stringify(report));
