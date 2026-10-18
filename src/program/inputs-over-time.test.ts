import {Cause, Effect, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {defineProgram, pipe, start, tell} from "./program.ts";
import {flag, input, output} from "./shape.ts";
import {memoryStorage, type Storage} from "./storage.ts";

// Experiment 79: what a program's inputs do over time. A value or a flag
// kept by an earlier start meets today's shapes at the next one (row 6 of
// the #657 harvest), and a line nobody reads fills (row 11).

const why = (ended: {readonly kind: string; readonly cause?: Cause.Cause<unknown>} | null) =>
	ended?.cause === undefined ? "" : String(Cause.squash(ended.cause));

const Lower = Schema.String.check(Schema.isPattern(/^[a-z]+$/));

/** Sends on each line it is told. */
const relay = defineProgram({
	name: "relay",
	description: "Sends on each line it is told.",
	inputs: {line: input(Schema.String, "A line.")},
	outputs: {out: output(Schema.String, "The same line.")},
	main: ({inputs, send}) => inputs.line.pipe(Stream.runForEach((line) => send("out", line))),
});

/** Takes lines and never acks them, so each one stays in its sender's outbox. */
const holder = (shape: Schema.Codec<string, string>, got: string[]) =>
	defineProgram({
		name: "holder",
		description: "Takes lines and never acks them.",
		inputs: {line: input(shape, "A line.", {ack: "manual"})},
		outputs: {},
		main: ({inputs}) =>
			inputs.line.pipe(Stream.runForEach(({value}) => Effect.sync(() => got.push(value)))),
	});

/** One start of `relay | holder`, under the run id `relay:1`: tell `told`, wait until `holder` has them all, then stop both. */
const once = (disk: Storage, shape: Schema.Codec<string, string>, told: readonly string[]) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const got: string[] = [];
			const target = yield* start(holder(shape, got), {});
			if (target.kind !== "running") return null;
			const source = yield* pipe(
				{program: relay, flags: {}, keeping: {id: "relay:1", storage: disk}},
				"out",
				target,
				"line",
			);
			if (source.kind !== "running") return null;
			for (const line of told) tell(source.run, "line", line);
			// Settled: everything told reached holder, and a resend had its time; or relay ended first.
			const settled = Effect.gen(function* () {
				while (got.length < told.length) yield* Effect.sleep("1 millis");
				yield* Effect.sleep("50 millis");
				return null;
			});
			const ended = yield* settled.pipe(
				Effect.raceFirst(source.run.ended),
				Effect.timeout("2 seconds"),
			);
			return {got, ended};
		}).pipe(Effect.scoped),
	);

describe("a value kept in an outbox meets a stricter input at the next start (row 6)", () => {
	it("today: the resend answers bad_shape, the sender fails before main, and fails the same way at every start after", async () => {
		const disk = memoryStorage();
		const first = await once(disk, Schema.String, ["Abc"]);
		expect(first?.got).toEqual(["Abc"]);

		const second = await once(disk, Lower, []);
		const third = await once(disk, Lower, []);
		expect(why(second?.ended ?? null)).toMatch(
			/relay sent out down a pipe that answered bad_shape/,
		);
		expect(why(third?.ended ?? null)).toMatch(/relay sent out down a pipe that answered bad_shape/);
	});
});

describe("a run's flags at its next start (row 6)", () => {
	const seen: string[] = [];
	const moder = defineProgram({
		name: "moder",
		description: "Says the mode it runs in.",
		flags: {mode: flag(Schema.Literals(["read", "write"]), "read or write, for the whole run.")},
		inputs: {},
		outputs: {},
		main: ({flags}) => Effect.sync(() => seen.push(flags.mode)),
	});

	it("today: a run started again under its id with other flags runs with them, while its record keeps the first", async () => {
		const disk = memoryStorage();
		const keeping = {id: "moder:1", storage: disk};
		await Effect.runPromise(
			Effect.gen(function* () {
				const a = yield* start(moder, {mode: "read"}, {}, keeping);
				if (a.kind === "running") yield* a.run.ended;
				const b = yield* start(moder, {mode: "write"}, {}, keeping);
				if (b.kind === "running") yield* b.run.ended;
			}).pipe(Effect.scoped),
		);
		const record = await Effect.runPromise(disk.record("moder:1"));
		expect({seen, kept: record?.flags}).toEqual({seen: ["read", "write"], kept: {mode: "read"}});
	});
});

describe("a line nobody reads (row 11)", () => {
	it("today: a host tells 100,000 values to a run that never reads, and every one is queued", async () => {
		const stuck = defineProgram({
			name: "stuck",
			description: "Never reads its input.",
			inputs: {n: input(Schema.Int, "A number.")},
			outputs: {},
			main: () => Effect.never,
		});
		const words = await Effect.runPromise(
			Effect.gen(function* () {
				const started = yield* start(stuck, {});
				if (started.kind !== "running") return null;
				const counts = new Map<string, number>();
				for (let i = 0; i < 100_000; i++) {
					const word = tell(started.run, "n", i);
					counts.set(word, (counts.get(word) ?? 0) + 1);
				}
				return Object.fromEntries(counts);
			}).pipe(Effect.scoped),
		);
		expect(words).toEqual({queued: 100_000});
	});
});
