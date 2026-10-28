import {defineMachine} from "@demlik/tea";
import {Effect, Layer, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {ear} from "../program/ear.ts";
import {listed} from "../program/listed.ts";
import {defineProgram, kind, start, tell} from "../program/program.ts";
import {input, output} from "../program/shape.ts";
import * as Program from "../program/spike-serve.ts";
import {memoryStorage} from "../program/storage.ts";
import {JobStorage, Programs, programList} from "./programs.ts";
import {type Printed, type Ready, tsh} from "./shell.ts";
import {spikeTsh} from "./spike-tsh.ts";

// Experiment 164: tsh on one mailbox (./spike-tsh.ts), on the case
// ./window.test.ts runs on tsh today. A program with a window runs in the
// foreground, so the `line` handler waits on it; only Ctrl-C ends it.

const idle = defineMachine({
	types: {
		model: {} as {readonly open: boolean},
		msg: {} as {readonly type: "noop"},
		ctx: undefined,
	},
	cmds: [],
	init: (loaded) => [loaded ?? {open: true}, []],
	update: {noop: (s) => [s, []]},
});

const win = defineProgram({
	name: "win",
	description: "Says it is open, reads its input until it closes, then says so.",
	inputs: {n: input(Schema.Int, "A number.")},
	outputs: {said: output(Schema.String, "What it is doing.")},
	machines: {
		idle: kind({
			machine: idle,
			state: Schema.Struct({open: Schema.Boolean}),
			parent: "main",
			options: () => ({ctx: undefined}),
			drawing: () => ({name: "idle", steps: {}}),
			status: () => "idle",
		}),
	},
	view: {machine: "idle", data: Schema.Struct({open: Schema.Boolean}), of: (s) => s},
	main: ({inputs, send}) =>
		send("said", "open").pipe(
			Effect.andThen(inputs.n.pipe(Stream.runDrain)),
			Effect.andThen(send("said", "closed")),
		),
});

const services = <A, E, R>(body: Effect.Effect<A, E, R>) =>
	body.pipe(
		Effect.provideService(JobStorage, memoryStorage()),
		Effect.provideService(Programs, programList([listed(win, Layer.empty)])),
	);

/** `win` in the foreground, then `piled` more lines told behind it, then Ctrl-C. */
const spike = (piled: number) =>
	Effect.gen(function* () {
		const printed = ear<Printed>();
		const ready = ear<Ready>();
		const started = yield* Program.start(
			spikeTsh,
			{show: "short"},
			{printed: printed.hear, ready: ready.hear},
			{id: "tsh:spike", storage: memoryStorage()},
		).pipe(services);
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		yield* Program.tell(started.run, "line", "win");
		yield* printed.upTo(1);
		for (let i = 0; i < piled; i++) yield* Program.tell(started.run, "line", "jobs");
		const signal = yield* Program.tell(started.run, "signal", "interrupt").pipe(
			Effect.catchTag("MailboxFull", (full) => Effect.succeed(full._tag)),
		);
		const first = signal === "queued" ? yield* ready.upTo(1) : [];
		return {signal, first: first.map((r) => r.status), box: started.run.queues()};
	}).pipe(Effect.scoped);

const today = (piled: number) =>
	Effect.gen(function* () {
		const printed = ear<Printed>();
		const ready = ear<Ready>();
		const started = yield* start(
			tsh,
			{show: "short"},
			{printed: printed.hear, ready: ready.hear},
			{id: "tsh:today", storage: memoryStorage()},
		).pipe(services);
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		yield* tell(started.run, "line", "win");
		yield* printed.upTo(1);
		for (let i = 0; i < piled; i++) yield* tell(started.run, "line", "jobs");
		const signal = yield* tell(started.run, "signal", "interrupt");
		const first = yield* ready.upTo(1);
		return {signal, first: first.map((r) => r.status)};
	}).pipe(Effect.scoped);

describe("tsh on one mailbox: Ctrl-C beside a foreground job", () => {
	it("Ctrl-C reaches the foreground job the line handler waits on, and stops it with 130", async () => {
		const seen = await Effect.runPromise(spike(0));
		expect(seen).toMatchObject({signal: "queued", first: [130]});
	});

	it("998 lines piled behind it still leave room: Ctrl-C is the 1000th value told and not handled", async () => {
		const seen = await Effect.runPromise(spike(998));
		expect(seen).toMatchObject({signal: "queued", first: [130]});
	});

	it("999 lines piled behind it fill the mailbox, and Ctrl-C is refused MailboxFull", async () => {
		const seen = await Effect.runPromise(spike(999));
		expect(seen).toEqual({
			signal: "MailboxFull",
			first: [],
			box: {length: 1000, waiting: 0, by: {line: 1000}},
		});
	});

	it("today's tsh, the same 999 lines: `signal` has its own line, and Ctrl-C still arrives", async () => {
		const seen = await Effect.runPromise(today(999));
		expect(seen).toEqual({signal: "queued", first: [130]});
	});
});
