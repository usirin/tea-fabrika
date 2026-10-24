import {defineMachine} from "@demlik/tea";
import {run as runMachine} from "@demlik/tea/effect";
import {
	defineProgram,
	input,
	kind,
	memoryStorage,
	output,
	pipe,
	start,
	tell,
} from "@kampus/fabrika";
import {terminal} from "@tea-fabrika/terminal";
import {ZERO as TERMINAL_ZERO, type Message as TerminalMessage} from "@tea-fabrika/terminal/view";
import {Cause, Effect, Schema, Stream} from "effect";
import {LINK_ZERO, type Link, type View} from "./terminal-pipe-view.ts";

type Event =
	| {type: "input"; text: string; bytes: number}
	| {type: "queued"; id: number}
	| {type: "enabled"; enabled: boolean};

// The link is a small program so pausing does not close either terminal's input.
const machine = defineMachine({
	types: {model: {} as Link, msg: {} as Event, ctx: undefined},
	cmds: [],
	init: () => [LINK_ZERO, []],
	update: {
		enabled: (state, event) => [{...state, enabled: event.enabled}, []],
		input: (state, event) => [
			{
				...state,
				next: state.next + 1,
				dropped: state.dropped + (state.enabled ? 0 : 1),
				packets: [
					...state.packets,
					{
						id: state.next,
						text: event.text.slice(0, 160),
						bytes: event.bytes,
						status: state.enabled ? ("pending" as const) : ("discarded" as const),
					},
				].slice(-24),
			},
			[],
		],
		queued: (state, event) => {
			const packet = state.packets.find(
				(packet) => packet.id === event.id && packet.status === "pending",
			);
			if (!packet) return [state, []];
			return [
				{
					...state,
					sent: state.sent + 1,
					bytes: state.bytes + packet.bytes,
					packets: state.packets.map((packet) =>
						packet.id === event.id ? {...packet, status: "queued" as const} : packet,
					),
				},
				[],
			];
		},
	},
});
const link = defineProgram({
	name: "terminal-link",
	description: "A pausable text link between two terminal programs.",
	inputs: {
		text: input(Schema.String, "Text from the sender's stdout."),
		enabled: input(Schema.Boolean, "Whether to forward new text; paused text is discarded."),
	},
	outputs: {text: output(Schema.String, "Text queued to the receiver's stdin.")},
	machines: {
		link: kind({
			machine,
			parent: "main",
			options: () => ({ctx: undefined}),
			drawing: () => ({name: "link", steps: {}}),
			status: (state) => (state.enabled ? "connected" : "paused"),
		}),
	},
	main: ({inputs, send, watch}) =>
		Effect.gen(function* () {
			const handle = yield* runMachine(machine, {ctx: undefined, interpret: {}});
			const runtime = yield* handle.ready;
			yield* watch("link", "link", runtime);
			const events = Stream.merge(
				inputs.text.pipe(
					Stream.map(
						(text) =>
							({type: "input", text, bytes: new TextEncoder().encode(text).length}) as const,
					),
				),
				inputs.enabled.pipe(Stream.map((enabled) => ({type: "enabled", enabled}) as const)),
			);
			yield* events.pipe(
				Stream.runForEach((event) =>
					Effect.gen(function* () {
						yield* runtime.dispatch(event);
						if (event.type !== "input") return;
						const packet = runtime.getState().packets.at(-1);
						if (packet?.status !== "pending") return;
						yield* send("text", event.text);
						yield* runtime.dispatch({type: "queued", id: packet.id});
					}),
				),
			);
		}).pipe(Effect.scoped),
});

export const openTerminalPipe = (id: string, options: {cwd: string; env: Record<string, string>}) =>
	Effect.gen(function* () {
		const kept = (role: string) => ({id: `terminal-pipe:${id}:${role}`, storage: memoryStorage()});
		const to = yield* start(
			terminal({
				...options,
				observeInput: true,
				shell: "/bin/bash",
				args: ["--noprofile", "--norc", "-c", "stty -echo -icrnl; exec tr '[:lower:]' '[:upper:]'"],
			}),
			{},
			{},
			kept("to"),
		);
		if (to.kind !== "running") return yield* Effect.die("Receiver refused its startup shape.");
		const wire = yield* pipe(
			{program: link, flags: {}, keeping: kept("link")},
			"text",
			to,
			"stdin",
		);
		if (wire.kind !== "running")
			return yield* Effect.die("The link did not fit the receiver's stdin.");
		const from = yield* pipe(
			{
				program: terminal({
					...options,
					observeInput: true,
					shell: "/bin/bash",
					args: ["--noprofile", "--norc", "-c", "stty -echo; exec cat"],
				}),
				flags: {},
				keeping: kept("from"),
			},
			"stdout",
			wire,
			"text",
		);
		if (from.kind !== "running")
			return yield* Effect.die("The sender's stdout did not fit the link.");
		let failure: string | null = null;
		const ended = [
			from.run.ended.pipe(
				Effect.map((ended) =>
					ended.kind === "failed" ? `Sender: ${Cause.pretty(ended.cause)}` : null,
				),
			),
			wire.run.ended.pipe(
				Effect.map((ended) =>
					ended.kind === "failed" ? `Connection: ${Cause.pretty(ended.cause)}` : null,
				),
			),
			to.run.ended.pipe(
				Effect.map((ended) =>
					ended.kind === "failed" ? `Receiver: ${Cause.pretty(ended.cause)}` : null,
				),
			),
		];
		for (const ending of ended)
			yield* ending.pipe(
				Effect.tap((why) =>
					Effect.sync(() => {
						if (why !== null) failure = why;
					}),
				),
				Effect.forkScoped,
			);
		return {
			view: (): View => ({
				from: from.run.machines.session.state() ?? TERMINAL_ZERO,
				to: to.run.machines.session.state() ?? TERMINAL_ZERO,
				link: wire.run.machines.link.state() ?? LINK_ZERO,
				failure,
			}),
			send: (side: "from" | "to", message: TerminalMessage): ReturnType<typeof tell> =>
				tell(side === "from" ? from.run : to.run, "action", message),
			enable: (enabled: boolean): ReturnType<typeof tell> => tell(wire.run, "enabled", enabled),
			stop: Effect.all([from.stop, wire.stop, to.stop], {concurrency: 1, discard: true}),
		};
	});
