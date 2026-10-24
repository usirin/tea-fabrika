// Experiment 128, fabrika's part: the runner, inside the box.
//
//   node runner.ts <programs file> <export name> <flags as JSON>
//
// It loads the program, reads its flags, starts it with a stand-in for each service that
// crosses the wall, and then speaks frames (./wall.ts): each `tell` and `close` line on stdin
// goes to the run, each output goes to stdout as an `out` line, and the end as an `end` line.
// A machine's keyed Cmds go out through `Outside` (./cmd-wall.ts), and their answers come back.
// The program's own `start` checks the flags and every told value again, with its own schemas.
// stdin's end (the host is gone) stops the run, as an Erlang peer halts when its link drops.

import {pathToFileURL} from "node:url";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeStdio from "@effect/platform-node/NodeStdio";
import {type AnyProgram, memoryStorage, start} from "@kampus/fabrika";
import {Cause, Effect, Exit, Fiber, Layer, Queue, Stdio, Stream} from "effect";
import {outsideLayer, type Waiting} from "./cmd-wall.ts";
import {type Boxable, line, type Routes, readDown, standIn, type Up} from "./wall.ts";

const main = Effect.gen(function* () {
	const stdio = yield* Stdio.Stdio;
	const [file = "", name = "", raw = "{}"] = yield* stdio.args;
	const mod: Record<string, Boxable<AnyProgram>> = yield* Effect.promise(
		() => import(pathToFileURL(file).href),
	);
	const entry = mod[name];
	if (entry === undefined) return yield* Effect.die(new Error(`${file} exports no ${name}`));

	const lines = yield* Queue.unbounded<string, Cause.Done>();
	const write = (frame: Up) => Queue.offer(lines, line(frame)).pipe(Effect.asVoid);
	const writer = yield* Stream.fromQueue(lines).pipe(Stream.run(stdio.stdout()), Effect.forkScoped);
	const done = (frame: Up) =>
		write(frame).pipe(
			Effect.andThen(Queue.end(lines)),
			Effect.andThen(Fiber.await(writer)),
			Effect.asVoid,
		);

	const routes: Routes = new Map();
	const waiting: Waiting = new Map();
	const services = yield* Layer.build(
		Layer.mergeAll(
			outsideLayer(write, waiting),
			...entry.walls.map((w) => standIn(w, write, routes)),
		),
	);
	yield* write({kind: "hi", pid: process.pid});

	const outs = Object.fromEntries(
		Object.keys(entry.program.outputs).map((out) => [
			out,
			(value: unknown) => {
				Queue.offerUnsafe(lines, line({kind: "out", name: out, value}));
			},
		]),
	);
	const started = yield* start(entry.program, JSON.parse(raw), outs, {
		id: `${name}:boxed`,
		storage: memoryStorage(),
	}).pipe(Effect.provideContext(services));
	if (started.kind === "bad_shape")
		return yield* done({kind: "end", how: "bad_shape", why: started.why});

	yield* stdio.stdin.pipe(
		Stream.decodeText(),
		Stream.splitLines,
		Stream.runForEach((text) => {
			const read = readDown(text);
			if (Exit.isFailure(read)) return Effect.logWarning("a line that is no frame", text);
			const frame = read.value;
			switch (frame.kind) {
				case "tell":
					return started.run.offer(frame.name, frame.value);
				case "close":
					return Effect.sync(() => started.close(frame.name));
				case "stop":
					return started.stop;
				case "rpc":
					return routes.get(frame.wall)?.(frame.msg) ?? Effect.void;
				case "ok":
				case "err":
				case "no":
					return Effect.sync(() => waiting.get(frame.id)?.(frame));
			}
		}),
		Effect.andThen(started.stop),
		Effect.ignore,
		Effect.forkScoped,
	);

	const ended = yield* started.run.ended;
	yield* done(
		ended.kind === "failed"
			? {kind: "end", how: "failed", why: Cause.pretty(ended.cause)}
			: {kind: "end", how: ended.kind},
	);
});

NodeRuntime.runMain(
	main.pipe(
		Effect.scoped,
		Effect.provide(NodeStdio.layer),
		// The whole cause on stderr: the host shows its tail when the box ends without an `end`.
		Effect.tapCause((c) => Effect.sync(() => console.error(Cause.pretty(c)))),
	),
);
