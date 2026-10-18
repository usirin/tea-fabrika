import {call, defineProgram} from "@tea-fabrika/tea-program";
import {input} from "@tea-fabrika/tea-program/shape";
import {memoryStorage} from "@tea-fabrika/tea-program/storage";
import {Cause, Effect, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {queueKind, workQueue} from "./queue.ts";

// The kept queue (./queue.ts), the mechanism: once its input has ended and
// every value is worked, nothing of it stays kept. And the rule under that:
// a run is dropped from storage only once no start of it is live, since a
// live copy's next save would keep it again.

/** A program that works `told` through its queue, doing `work` for each value. */
const queued = (told: readonly string[], work: (item: string) => Effect.Effect<void>) =>
	defineProgram({
		name: "queued",
		description: "Works each value through its kept queue.",
		inputs: {},
		outputs: {},
		machines: {queue: queueKind},
		main: ({machines}) =>
			workQueue(
				machines.queue,
				Stream.fromIterable(told).pipe(Stream.map((value) => ({value, ack: Effect.void}))),
				work,
				() => Effect.void,
			),
	});

describe("a kept queue reads only an input that acks", () => {
	it("an input declared without {ack: 'manual'} does not compile as the queue's input", () => {
		const program = defineProgram({
			name: "queued",
			description: "Works one of its inputs through its kept queue.",
			inputs: {
				plain: input(Schema.String, "Told and gone."),
				acking: input(Schema.String, "Acked once kept.", {ack: "manual"}),
			},
			outputs: {},
			machines: {queue: queueKind},
			main: ({inputs, machines}) =>
				Effect.all(
					[
						workQueue(
							machines.queue,
							inputs.acking,
							() => Effect.void,
							() => Effect.void,
						),
						workQueue(
							machines.queue,
							// @ts-expect-error: a value the queue has not kept yet would be lost to a kill
							inputs.plain,
							() => Effect.void,
							() => Effect.void,
						),
					],
					{concurrency: "unbounded", discard: true},
				),
		});
		expect(program.inputs.acking.ack).toBe("manual");
	});
});

describe("the kept queue", () => {
	it("is gone from storage once its input ended and every value was worked, and stays gone", async () => {
		const storage = memoryStorage();
		const worked: string[] = [];
		await Effect.runPromise(
			call(
				queued(["a", "b", "c"], (item) => Effect.sync(() => worked.push(item))),
				{},
				{keeping: {id: "queued:1", storage}},
			),
		);
		const now = (await Effect.runPromise(storage.record("queued:1")))?.machines;
		await Effect.runPromise(Effect.sleep("50 millis"));
		const later = (await Effect.runPromise(storage.record("queued:1")))?.machines;
		expect({worked, now, later}).toEqual({worked: ["a", "b", "c"], now: [], later: []});
	});

	it("a run cleared while a start of it is live fails the program, by name: the clear would not hold", async () => {
		const program = defineProgram({
			name: "queued",
			description: "Clears its queue while it works it.",
			inputs: {},
			outputs: {},
			machines: {queue: queueKind},
			main: ({machines}) =>
				machines.queue
					.get("queue")
					.start()
					.pipe(Effect.andThen(machines.queue.get("queue").clear), Effect.scoped),
		});
		const called = await Effect.runPromise(
			call(program, {}, {keeping: {id: "queued:2", storage: memoryStorage()}}),
		);
		const ended =
			called.kind === "called" ? (called.ended as {kind: string; cause?: unknown}) : null;
		expect(ended?.kind).toBe("failed");
		expect(Cause.pretty(ended?.cause as Cause.Cause<unknown>)).toContain(
			"queued cleared its queue run queue while it runs: its next save would keep it again",
		);
	});
});
