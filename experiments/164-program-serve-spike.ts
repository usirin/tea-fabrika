// Experiment 164: experiment 79's flood, on today's runtime and on the spike's
// one mailbox (packages/fabrika/src/program/spike-serve.ts). A host tells COUNT
// values, split over two inputs, to a run that never reads; then says what each
// tell answered and how much the heap grew. No model, no network, $0.
//
//   node --expose-gc experiments/164-program-serve-spike.ts
//   COUNT=100000 node --expose-gc experiments/164-program-serve-spike.ts

import {defineProgram, input, start, tell} from "@kampus/fabrika";
import * as Program from "@kampus/fabrika/spike/serve";
import {Effect, Schema} from "effect";

const COUNT = Number(process.env.COUNT ?? 1_000_000);

const inputs = {
	line: input(Schema.String, "A line."),
	other: input(Schema.String, "Another line."),
};
const today = defineProgram({
	name: "stuck",
	description: "Never reads its inputs.",
	inputs,
	outputs: {},
	main: () => Effect.never,
});
const spike = Program.make("stuck", {
	description: "Never serves its inputs.",
	inputs,
	outputs: {},
	main: () => Effect.never,
});

// Node at the edge, said out loud: `gc` and `memoryUsage` are how the heap is read.
const heap = () => {
	(globalThis as {gc?: () => void}).gc?.();
	return process.memoryUsage().heapUsed;
};

type TellOne = (i: number) => Effect.Effect<string, {readonly _tag: string}>;

const flood = (
	tellOne: TellOne,
): Effect.Effect<{readonly counts: Record<string, number>; readonly heapGrewMB: number}> =>
	Effect.gen(function* () {
		const before = heap();
		const counts: Record<string, number> = {};
		for (let i = 0; i < COUNT; i++) {
			const word = yield* tellOne(i).pipe(Effect.catch((full) => Effect.succeed(full._tag)));
			counts[word] = (counts[word] ?? 0) + 1;
		}
		return {counts, heapGrewMB: Math.round((heap() - before) / 1e5) / 10};
	});

const name = (i: number) => (i % 2 === 0 ? "line" : "other");

const report = await Effect.runPromise(
	Effect.gen(function* () {
		const a = yield* start(today, {});
		const b = yield* Program.start(spike, {});
		if (a.kind !== "running" || b.kind !== "running") return null;
		const todayRun = a.run;
		const spikeRun = b.run;
		const tellToday: TellOne = (i): ReturnType<TellOne> =>
			tell(todayRun, name(i), `line ${i} of a script`);
		const tellSpike: TellOne = (i) => Program.tell(spikeRun, name(i), `line ${i} of a script`);
		return {told: COUNT, today: yield* flood(tellToday), spike: yield* flood(tellSpike)};
	}).pipe(Effect.scoped),
);
console.log(JSON.stringify(report));
