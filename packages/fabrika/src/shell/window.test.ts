import {defineMachine} from "@demlik/tea";
import {Effect, Layer, Schema, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {ear} from "../program/ear.ts";
import {listed} from "../program/listed.ts";
import {defineProgram, kind, start, tell} from "../program/program.ts";
import {input, output} from "../program/shape.ts";
import {memoryStorage} from "../program/storage.ts";
import {JobStorage, Programs, programList} from "./programs.ts";
import {type Printed, type Ready, tsh} from "./shell.ts";

// A program with a window, run in tsh's foreground: tsh keeps its inputs open, since its window
// tells them, and waits for it as for any foreground line. The same program with no window has
// its inputs closed at once, as `seq` does, so it ends at once.

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

const inputs = {n: input(Schema.Int, "A number.")};
const outputs = {said: output(Schema.String, "What it is doing.")};
const machines = {
	idle: kind({
		machine: idle,
		state: Schema.Struct({open: Schema.Boolean}),
		parent: "main",
		options: () => ({ctx: undefined}),
		drawing: () => ({name: "idle", steps: {}}),
		status: () => "idle",
	}),
};
const description = "Says it is open, reads its input until it closes, then says so.";

const win = defineProgram({
	name: "win",
	description,
	inputs,
	outputs,
	machines,
	view: {machine: "idle", data: Schema.Struct({open: Schema.Boolean}), of: (s) => s},
	main: ({inputs, send}) =>
		send("said", "open").pipe(
			Effect.andThen(inputs.n.pipe(Stream.runDrain)),
			Effect.andThen(send("said", "closed")),
		),
});

const bare = defineProgram({
	name: "bare",
	description,
	inputs,
	outputs,
	machines,
	main: ({inputs, send}) =>
		send("said", "open").pipe(
			Effect.andThen(inputs.n.pipe(Stream.runDrain)),
			Effect.andThen(send("said", "closed")),
		),
});

const session = () =>
	Effect.gen(function* () {
		const printed = ear<Printed>();
		const ready = ear<Ready>();
		const storage = memoryStorage();
		const list = programList([listed(win, Layer.empty), listed(bare, Layer.empty)]);
		const started = yield* start(
			tsh,
			{show: "short"},
			{printed: printed.hear, ready: ready.hear},
			{id: "tsh:window", storage},
		).pipe(Effect.provideService(JobStorage, storage), Effect.provideService(Programs, list));
		if (started.kind !== "running") return yield* Effect.die("tsh did not start");
		return {run: started.run, printed, ready};
	});

describe("a program with a window, in the foreground", () => {
	it("keeps its inputs open until it is stopped; the same program with no window ends at once", async () => {
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const {run, printed, ready} = yield* session();
				expect(yield* tell(run, "line", "bare")).toBe("queued");
				const [bare] = yield* ready.upTo(1);
				const bareSaid = printed.values.map((p) => p.text);
				expect(yield* tell(run, "line", "win")).toBe("queued");
				// Open, and still running: tsh waits for it, and Ctrl-C is what ends it.
				yield* printed.upTo(bareSaid.length + 1);
				expect(yield* tell(run, "signal", "interrupt")).toBe("queued");
				const [, win] = yield* ready.upTo(2);
				return {bare, bareSaid, win, winSaid: printed.values.slice(bareSaid.length)};
			}).pipe(Effect.scoped),
		);
		expect(seen.bare?.status).toBe(0);
		expect(seen.bareSaid).toEqual(["open", "closed"]);
		expect(seen.win?.status).toBe(130);
		expect(seen.winSaid[0]?.text).toBe("open");
		expect(seen.winSaid.map((p) => p.text)).not.toContain("closed");
	});
});
