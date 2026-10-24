// Native edge: node-pty owns the PTY; the program owns its streams and lifetime.
import {defineMachine} from "@demlik/tea";
import {run as runMachine} from "@demlik/tea/effect";
import {defineProgram, input, kind, output} from "@kampus/fabrika";
import pty from "@lydell/node-pty";
import {Effect, Queue, Schema, Stream} from "effect";
import {Message, View, ZERO} from "./view.ts";

type Event =
	| {type: "opened"; pid: number; id: string}
	| {type: "input"; data: string; bytes: number}
	| {type: "output"; data: string}
	| {type: "exited"; code: number}
	| {type: "stopped"}
	| {type: "size"; cols: number; rows: number};
class ShellFailed extends Schema.TaggedError<ShellFailed>()("ShellFailed", {why: Schema.String}) {}
const heard = (traffic: View["stdin"], data: string) => ({
	chunks: traffic.chunks + 1,
	bytes: traffic.bytes + new TextEncoder().encode(data).length,
	last: data.slice(-160),
});
export const machine = defineMachine({
	types: {model: {} as View, msg: {} as Event, ctx: undefined},
	cmds: [],
	init: () => [ZERO, []],
	update: {
		opened: (state, event) => [{...state, phase: "running", pid: event.pid, id: event.id}, []],
		input: (state, event) => [
			{
				...state,
				stdin: {
					chunks: state.stdin.chunks + 1,
					bytes: state.stdin.bytes + event.bytes,
					last: event.data.slice(-160),
				},
			},
			[],
		],
		output: (state, event) => {
			const chunks = [...state.chunks, {seq: state.next, data: event.data}];
			let length = chunks.reduce((sum, chunk) => sum + chunk.data.length, 0);
			while (length > 128 * 1024 && chunks.length > 1) length -= chunks.shift()?.data.length ?? 0;
			return [
				{...state, chunks, next: state.next + 1, stdout: heard(state.stdout, event.data)},
				[],
			];
		},
		exited: (state, event) => [{...state, phase: "exited", code: event.code}, []],
		stopped: (state) => [state.phase === "exited" ? state : {...state, phase: "stopped"}, []],
		size: (state, event) => [{...state, cols: event.cols, rows: event.rows}, []],
	},
});

export const terminal = (options: {
	cwd: string;
	shell: string;
	args?: string[];
	observeInput?: boolean;
	env: Record<string, string>;
}) =>
	defineProgram({
		name: "terminal",
		description: "A native terminal, with typed stdin/stdout and a host-owned lifetime.",
		inputs: {
			action: input(Message, "Ephemeral keyboard input and dimensions; never a durable inbox."),
			stdin: input(
				Schema.String,
				"Text written to the native process, including text from another program.",
			),
		},
		outputs: {stdout: output(Schema.String, "Text read from the native PTY.")},
		machines: {
			session: kind({
				machine,
				parent: "main",
				options: () => ({ctx: undefined}),
				drawing: () => ({name: "terminal", steps: {}}),
				status: (state) => state.phase,
			}),
		},
		view: {machine: "session", data: View, of: (state) => state},
		main: ({inputs, send, watch}) =>
			Effect.gen(function* () {
				const events = yield* Queue.unbounded<Event>();
				let exited = false;
				const native = yield* Effect.acquireRelease(
					Effect.try({
						try: () => {
							const child = pty.spawn(
								options.shell,
								options.args ?? ["--noprofile", "--norc", "-i"],
								{
									name: "xterm-256color",
									cols: 80,
									rows: 24,
									cwd: options.cwd,
									env: {
										...options.env,
										TERM: "xterm-256color",
										PS1: "fabrika % ",
										BASH_SILENCE_DEPRECATION_WARNING: "1",
									},
								},
							);
							const data = child.onData((data) =>
								Queue.offerUnsafe(events, {type: "output", data}),
							);
							const exit = child.onExit(({exitCode}) => {
								exited = true;
								Queue.offerUnsafe(events, {type: "exited", code: exitCode});
							});
							return {
								child,
								dispose: () => {
									data.dispose();
									exit.dispose();
									if (!exited) child.kill();
								},
							};
						},
						catch: (cause) => new ShellFailed({why: String(cause)}),
					}),
					(native) => Effect.sync(native.dispose),
				);
				const handle = yield* runMachine(machine, {ctx: undefined, interpret: {}});
				const runtime = yield* handle.ready;
				yield* watch("session", "shell", runtime);
				yield* runtime.dispatch({type: "opened", pid: native.child.pid, id: crypto.randomUUID()});
				const incoming = Stream.merge(
					inputs.action,
					inputs.stdin.pipe(Stream.map((data) => ({type: "input", data}) as const)),
				);
				const read = Stream.fromQueue(events).pipe(
					Stream.takeUntil((event) => event.type === "exited"),
					Stream.runForEach((event) =>
						Effect.gen(function* () {
							yield* runtime.dispatch(event);
							if (event.type === "output") yield* send("stdout", event.data);
						}),
					),
				);
				const write = incoming.pipe(
					Stream.runForEach((message) =>
						Effect.gen(function* () {
							if (runtime.getState().phase !== "running") return;
							yield* Effect.try({
								try: () =>
									message.type === "input"
										? native.child.write(message.data)
										: native.child.resize(message.cols, message.rows),
								catch: (cause) => new ShellFailed({why: String(cause)}),
							});
							if (message.type === "input")
								yield* runtime.dispatch({
									type: "input",
									data: options.observeInput ? message.data : "",
									bytes: new TextEncoder().encode(message.data).length,
								});
							else yield* runtime.dispatch({type: "size", cols: message.cols, rows: message.rows});
						}),
					),
				);
				yield* Effect.raceFirst(read, write).pipe(
					Effect.ensuring(runtime.dispatch({type: "stopped"}).pipe(Effect.orDie)),
				);
			}).pipe(Effect.scoped),
	});
