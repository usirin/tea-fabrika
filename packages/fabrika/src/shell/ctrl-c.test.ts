import {defineMachine} from "@demlik/tea";
import {Effect, Layer, Schema} from "effect";
import {describe, expect, it} from "vitest";
import {HostJobs, openJobs} from "../host/host-jobs.ts";
import {ear} from "../program/ear.ts";
import {listed} from "../program/listed.ts";
import {defineProgram, kind, start, tell} from "../program/program.ts";
import {CAPACITY, input, output} from "../program/shape.ts";
import {memoryStorage} from "../program/storage.ts";
import {Programs, programList} from "./programs.ts";
import {type Printed, type Ready, tsh} from "./shell.ts";

// Ctrl-C on one mailbox (2026-10-30). tsh's `line` handler waits on a
// foreground job, so every line typed after it waits in tsh's mailbox. Ctrl-C
// is tsh's `signal`, a control input: it goes beside that order, on its own
// small bound, as a terminal turns Ctrl-C into a signal that skips the input
// buffer. Akka's and Erlang's urgent messages go first but share the
// mailbox's bound, so this rule is ours, and these tests are its proof.

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

/** A program with a window: in the foreground it runs until Ctrl-C. */
const win = defineProgram({
	name: "win",
	description: "Says it is open, and reads its input until it closes.",
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
	main: ({serve, send}) => send("said", "open").pipe(Effect.andThen(serve({n: () => Effect.void}))),
});

/** `win` in the foreground, `piled` lines typed behind it, then Ctrl-C. */
const ctrlC = (piled: number) =>
	Effect.gen(function* () {
		const printed = ear<Printed>();
		const ready = ear<Ready>();
		const storage = memoryStorage();
		const jobs = yield* openJobs(storage);
		const started = yield* start(
			tsh,
			{show: "short"},
			{printed: printed.hear, ready: ready.hear},
			{id: "tsh:ctrl-c", storage},
		).pipe(
			Effect.provideService(HostJobs, jobs),
			Effect.provideService(Programs, programList([listed(win, Layer.empty)])),
		);
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		yield* tell(started.run, "line", "win");
		// Open: the line handler now waits on win.
		yield* printed.upTo(1);
		const words: Record<string, number> = {};
		for (let i = 0; i < piled; i++) {
			const word = yield* tell(started.run, "line", "jobs").pipe(
				Effect.catchTag("MailboxFull", (full) => Effect.succeed(full._tag)),
			);
			words[word] = (words[word] ?? 0) + 1;
		}
		const behind = started.run.mailbox();
		const signal = yield* tell(started.run, "signal", "interrupt");
		const [first] = yield* ready.upTo(1);
		return {words, behind, signal, status: first?.status};
	}).pipe(Effect.scoped);

describe("Ctrl-C reaches a foreground job however many lines wait behind it", () => {
	it("999 lines wait behind a slow line: Ctrl-C is taken, and stops the foreground job with 130", async () => {
		const seen = await Effect.runPromise(ctrlC(999));
		expect(seen).toEqual({
			words: {queued: 999},
			behind: {
				length: 999,
				inputs: {line: {length: 999, waiting: 0}, signal: {length: 0, waiting: 0}},
			},
			signal: "queued",
			status: 130,
		});
	});

	it("a full mailbox, its next line refused MailboxFull: Ctrl-C is still taken, and still stops the job", async () => {
		const seen = await Effect.runPromise(ctrlC(CAPACITY + 1));
		expect(seen).toEqual({
			words: {queued: CAPACITY, MailboxFull: 1},
			behind: {
				length: CAPACITY,
				inputs: {line: {length: CAPACITY, waiting: 0}, signal: {length: 0, waiting: 0}},
			},
			signal: "queued",
			status: 130,
		});
	});
});
