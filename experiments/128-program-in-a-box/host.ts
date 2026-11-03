// Experiment 128, fabrika's part: the host side. `startBoxed` starts a program in a box and
// hands back a handle shaped like `start`'s: tell an input, hear outputs, see the end.
//
//   const started = yield* startBoxed(place, double, {});
//   if (started.kind === "running") {
//     yield* started.run.tell("n", 2);            // "queued": checked here, then written to stdin
//     started.run.listen("n", (n) => ...);        // 4, read from stdout and checked again
//     started.close("n");
//     yield* started.run.ended;                   // {kind: "ended"}
//   }
//
// Each value is checked with the program's own shapes on both sides of the wall: here before it
// goes in, by the program's own `start` inside, and each output here again as it comes out.
// Each service the program asks for is served here, with the real layer the caller provides.
// The box lives in the caller's scope: when it closes, the box is taken away.

import * as NodeStream from "@effect/platform-node/NodeStream";
import {
	type AnyProgram,
	type BadShape,
	type Program,
	readFlags,
	type Word,
} from "@kampus/fabrika-old";
import {Deferred, Effect, Exit, type Scope, Stream} from "effect";
import {type Box, boxed, type Started} from "./box.ts";
import {answer, type Handlers, type Outside} from "./cmd-wall.ts";
import {type Boxable, type Down, line, type Routes, readUp, serve} from "./wall.ts";

/** Where a box runs, and how the runner is reached inside it. */
export interface Place {
	readonly box: Box;
	/** The repo's root, as the box sees it. */
	readonly root: string;
	/** The repo's root on the host, to find a program's file under it. */
	readonly hostRoot: string;
	/** `node`, as the box sees it. */
	readonly node: string;
	/** The whole environment the box is handed. Nothing else of the host's goes in. */
	readonly env: Readonly<Record<string, string>>;
}

/** How a boxed run ended. `gone`: the box ended without saying how. */
export type BoxEnded =
	| {readonly kind: "ended"}
	| {readonly kind: "stopped"}
	| {readonly kind: "failed"; readonly why: string}
	| {readonly kind: "gone"; readonly why: string};

type In<P extends AnyProgram> = keyof P["inputs"] & string;
type Out<P extends AnyProgram> = keyof P["outputs"] & string;
/** The services a program asks for: the host provides their real layers. `Outside` is the box's own. */
type ServicesOf<P> =
	P extends Program<any, any, any, any, any, infer R> ? Exclude<R, Outside> : never;

export interface BoxedRun<P extends AnyProgram> {
	readonly id: string;
	tell(name: In<P>, value: unknown): Effect.Effect<Word>;
	listen(name: Out<P>, listener: (value: unknown) => void): () => void;
	readonly ended: Effect.Effect<BoxEnded>;
	/** The runner's process id, as the box says it in its first line. */
	readonly pid: Effect.Effect<number>;
}

export interface BoxedRunning<P extends AnyProgram> {
	readonly kind: "running";
	readonly run: BoxedRun<P>;
	readonly close: (name: In<P>) => void;
	readonly stop: Effect.Effect<BoxEnded>;
	/** The box itself, for the tests that kill it. */
	readonly box: Started;
	/** Frames written to the box's stdin so far. */
	readonly sent: () => number;
	/** `cmd` frames read from the box so far. */
	readonly cmds: () => number;
}

const RUNNER = "experiments/128-program-in-a-box/runner.ts";

export const startBoxed = <P extends AnyProgram>(
	place: Place,
	entry: Boxable<P>,
	flags: unknown,
	given: {readonly [K in Out<P>]?: (value: unknown) => void} = {},
	handlers: Handlers = {},
): Effect.Effect<BoxedRunning<P> | BadShape, never, Scope.Scope | ServicesOf<P>> =>
	Effect.gen(function* () {
		const scope = yield* Effect.scope;
		let cmds = 0;
		const program = entry.program;
		const read = readFlags(program, flags);
		if (read.kind === "bad_shape") return read;
		const file = `${place.root}/${entry.file.slice(place.hostRoot.length + 1)}`;
		const box = yield* Effect.acquireRelease(
			Effect.sync(() =>
				boxed(place.box, {
					command: place.node,
					args: [
						"--no-warnings",
						`${place.root}/${RUNNER}`,
						file,
						entry.name,
						JSON.stringify(read.flags),
					],
					env: place.env,
					cwd: place.root,
				}),
			),
			(b) => Effect.sync(b.kill),
		);
		const {child} = box;
		const {stdout} = child;
		if (stdout === null) return yield* Effect.die(new Error("the box has no stdout"));
		let stderr = "";
		child.stderr?.on("data", (c: Buffer) => {
			stderr = (stderr + c.toString("utf8")).slice(-1_000);
		});
		// A box that is gone cannot be written to; its end is read from stdout, not from here.
		child.stdin?.on("error", () => undefined);
		let sent = 0;
		const write = (frame: Down) =>
			Effect.sync(() => {
				if (child.stdin?.writable !== true) return;
				sent++;
				child.stdin.write(line(frame));
			});

		const ended = yield* Deferred.make<BoxEnded>();
		const hi = yield* Deferred.make<number>();
		const exited = new Promise<string>((resolve) =>
			child.on("exit", (code, signal) => resolve(signal === null ? `exit ${code}` : signal)),
		);
		const listeners = new Map<string, Set<(value: unknown) => void>>();
		for (const name of Object.keys(program.outputs)) {
			const first = (given as Record<string, ((v: unknown) => void) | undefined>)[name];
			listeners.set(name, new Set(first === undefined ? [] : [first]));
		}

		const routes: Routes = new Map();
		// Each wall asks for its own real service; together they are the program's services.
		for (const wall of entry.walls)
			yield* serve(wall, write, routes) as Effect.Effect<void, never, Scope.Scope | ServicesOf<P>>;

		yield* NodeStream.fromReadable<Uint8Array>({evaluate: () => stdout}).pipe(
			Stream.decodeText(),
			Stream.splitLines,
			Stream.runForEach((text) => {
				const got = readUp(text);
				if (Exit.isFailure(got)) return Effect.void;
				const frame = got.value;
				switch (frame.kind) {
					case "hi":
						return Deferred.succeed(hi, frame.pid);
					case "out": {
						const declared = program.outputs[frame.name];
						const why =
							declared === undefined ? "no such output" : declared.shape.problem(frame.value);
						if (why !== undefined)
							return Deferred.succeed(ended, {
								kind: "failed",
								why: `the box sent ${frame.name}: ${why}`,
							}).pipe(Effect.andThen(Effect.sync(box.kill)));
						// A copy, as `start` does: a listener may add or drop listeners while it runs.
						for (const l of [...(listeners.get(frame.name) ?? [])]) l(frame.value);
						return Effect.void;
					}
					case "end": {
						const how: BoxEnded =
							frame.how === "failed" || frame.how === "bad_shape"
								? {kind: "failed", why: frame.why ?? frame.how}
								: {kind: frame.how};
						return Deferred.succeed(ended, how);
					}
					case "rpc":
						return routes.get(frame.wall)?.(frame.msg) ?? Effect.void;
					case "cmd":
						cmds++;
						// Its own fiber, so a slow handler does not hold up the frames behind it.
						return answer(entry.cmds, handlers, frame).pipe(
							Effect.flatMap(write),
							Effect.forkIn(scope),
						);
				}
			}),
			Effect.ignore,
			// stdout's end is the box's end. One that said nothing before it is `gone`.
			Effect.andThen(Effect.promise(() => exited)),
			Effect.flatMap((how) =>
				Deferred.succeed(ended, {
					kind: "gone",
					why: `${how}${stderr === "" ? "" : `: ${stderr.trim()}`}`,
				}),
			),
			Effect.andThen(Deferred.interrupt(hi)),
			Effect.forkScoped,
		);

		const closed = new Set<string>();
		const run: BoxedRun<P> = {
			id: `${program.name}:${crypto.randomUUID()}`,
			tell: (name, value) =>
				Effect.gen(function* () {
					const declared = program.inputs[name];
					if (declared === undefined) return "no_cell";
					if (declared.shape.problem(value) !== undefined) return "bad_shape";
					if (yield* Deferred.isDone(ended)) return "stopped";
					if (closed.has(name)) return "closed";
					yield* write({kind: "tell", name, value});
					return "queued";
				}),
			listen: (name, listener) => {
				const set = listeners.get(name);
				set?.add(listener);
				return () => set?.delete(listener);
			},
			ended: Deferred.await(ended),
			pid: Deferred.await(hi),
		};
		return {
			kind: "running",
			run,
			close: (name) => {
				closed.add(name);
				Effect.runSync(write({kind: "close", name}));
			},
			// Asked first; a box that does not answer in 5 s is taken away.
			stop: write({kind: "stop"}).pipe(
				Effect.andThen(Deferred.await(ended)),
				Effect.timeoutOrElse({
					duration: "5 seconds",
					orElse: () => Effect.sync(box.kill).pipe(Effect.andThen(Deferred.await(ended))),
				}),
			),
			box,
			sent: () => sent,
			cmds: () => cmds,
		} satisfies BoxedRunning<P>;
	});
