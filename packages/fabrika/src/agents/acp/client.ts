// `/unstable`: a turn's `usage` is an unstable ACP field, and the SDK's stable entry drops it from
// what it parses. Read through the stable one, every turn would report no tokens, with no error.
import * as acp from "@agentclientprotocol/sdk/unstable";
import {type Cause, Effect, Queue, type Scope, Stream} from "effect";
import {ChildProcess, ChildProcessSpawner} from "effect/process";

// One ACP connection to one harness process, in Effect's terms. The harness
// (an adapter like claude-agent-acp, or the fake agent) is a child process
// spoken to in JSON-RPC over its stdin and stdout. The official ACP library
// speaks the protocol; this file only hands it the two pipes and turns its
// Promises into Effects.
//
//   const c = yield* connect(harness, folder, heard)         // spawned, initialized; killed when the scope closes
//   const opened = yield* c.open("new", null, folder, meta)  // session/new | session/load | session/resume
//   yield* c.prompt(opened.id, "read a.txt")                 // session/prompt: the turn, to its stop
//   heard(...)                                               // every update and ask, in the order it came
//
// The Effect side owns the process: `ChildProcess` spawns it with only the
// environment it is given, and the scope kills it. Node is not touched here.
// The one bridge is Web Streams, which the ACP library reads and writes:
// stdout becomes a `ReadableStream` (`Stream.toReadableStreamWith`), and a
// `WritableStream` feeds a queue that runs into stdin.
//
// What the harness sends on its own is handed to `heard`, in arrival order:
// a `session/update`, or a permission ask that waits for its answer. The
// library calls the handlers in the order the lines came, and `heard` must
// only put the value on a queue, so the order is the wire's. The caller puts
// a turn's end on that same queue after `prompt` returns, so a fold reading
// it sees every update of a turn before the turn's end.

/** A harness that can be started: its command, and the environment it is handed whole. */
export interface Spawnable {
	readonly command: string;
	readonly args: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	/**
	 * Hand the process a fd 3 that this process holds open and never writes:
	 * experiment 71's lifeline (src/stages/build/guard.ts). When this process
	 * ends, however it ends, the child reads the end of it.
	 */
	readonly lifeline?: boolean;
}

/** A permission ask, waiting for its answer. `answer` may be called once; later calls do nothing. */
export interface PendingAsk {
	readonly id: string;
	readonly request: acp.RequestPermissionRequest;
	readonly answer: (response: acp.RequestPermissionResponse) => void;
}

/** What the harness sent on its own, in the order it came. */
export type Heard =
	| {readonly kind: "update"; readonly update: acp.SessionUpdate}
	| {readonly kind: "ask"; readonly ask: PendingAsk};

/** A request the harness answered with an error, or a connection that broke. */
export interface AcpFailed {
	readonly _tag: "acp_failed";
	readonly method: string;
	readonly message: string;
}

export type OpenHow = "new" | "load" | "resume";

/** A session, opened. */
export interface Opened {
	readonly id: string;
	readonly mode: string | null;
	readonly modes: readonly string[];
	readonly config: readonly acp.SessionConfigOption[];
}

export interface Connection {
	readonly init: acp.InitializeResponse;
	/** The harness's process, for a stop that ends what it started (the agent interface's reaper). */
	readonly pid: number;
	/** Whether the harness says it can open a session again this way. */
	readonly can: (how: Exclude<OpenHow, "new">) => boolean;
	readonly open: (
		how: OpenHow,
		id: string | null,
		folder: string,
		meta: Readonly<Record<string, unknown>> | undefined,
		/** MCP servers the client lends the session (ACP's `mcpServers`). None when left out. */
		servers?: readonly acp.McpServer[],
	) => Effect.Effect<Opened, AcpFailed>;
	/** Set a config option by its category (`model`, `thought_level`, `mode`). Answers the options as they stand after. */
	readonly configure: (
		session: Opened,
		category: string,
		value: string,
	) => Effect.Effect<Opened, AcpFailed>;
	readonly prompt: (session: string, text: string) => Effect.Effect<acp.PromptResponse, AcpFailed>;
	readonly cancel: (session: string) => Effect.Effect<void, AcpFailed>;
	/** The last of what the harness wrote on stderr: for a failure's message, never shown on its own. */
	readonly stderr: () => string;
}

const failed =
	(method: string) =>
	(error: unknown): AcpFailed => ({
		_tag: "acp_failed",
		method,
		message:
			error instanceof acp.RequestError
				? `${error.code}: ${error.message}`
				: error instanceof Error
					? error.message
					: String(error),
	});

const call = <A>(method: string, run: () => Promise<A>): Effect.Effect<A, AcpFailed> =>
	Effect.tryPromise({try: run, catch: failed(method)});

/** Every value a select option offers, its groups flattened. */
export const valuesOf = (option: acp.SessionConfigOption): readonly string[] =>
	option.type === "select"
		? option.options.flatMap((o) => ("group" in o ? o.options.map((x) => x.value) : [o.value]))
		: [];

const openedOf = (
	id: string,
	response: acp.NewSessionResponse | acp.LoadSessionResponse | acp.ResumeSessionResponse,
): Opened => ({
	id,
	mode: response.modes?.currentModeId ?? null,
	modes: response.modes?.availableModes.map((m) => m.id) ?? [],
	config: response.configOptions ?? [],
});

/** The tail of stderr kept: enough for why it broke, small enough to never grow. */
const TAIL = 4_000;

/**
 * A harness's own notifications, outside ACP's methods (`_`-prefixed), that a
 * caller wants to hear: by method name. Each is handed over as it comes, its
 * params unread. The Claude adapter's `_claude/sdkMessage` is one.
 */
export interface Extensions {
	readonly methods: readonly string[];
	readonly heard: (method: string, params: unknown) => void;
}

/**
 * Start `harness` in `folder`, initialize it, and answer the connection. The
 * process is killed when the scope closes; its stdin closes first.
 */
export const connect = (
	harness: Spawnable,
	folder: string,
	heard: (heard: Heard) => void,
	extensions?: Extensions,
): Effect.Effect<Connection, AcpFailed, Scope.Scope | ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const handle = yield* spawner
			.spawn(
				ChildProcess.make(harness.command, [...harness.args], {
					cwd: folder,
					env: {...harness.env},
					extendEnv: false,
					forceKillAfter: "3 seconds",
					...(harness.lifeline === true ? {additionalFds: {fd3: {type: "input" as const}}} : {}),
				}),
			)
			.pipe(Effect.mapError(failed("spawn")));
		const context = yield* Effect.context<never>();

		let tail = "";
		yield* handle.stderr.pipe(
			Stream.decodeText(),
			Stream.runForEach((text) =>
				Effect.sync(() => {
					tail = (tail + text).slice(-TAIL);
				}),
			),
			Effect.ignore,
			Effect.forkScoped,
		);

		// stdin: what the library writes goes on a queue, and the queue runs into the process.
		const inbox = yield* Queue.unbounded<Uint8Array, Cause.Done>();
		yield* Stream.fromQueue(inbox).pipe(Stream.run(handle.stdin), Effect.ignore, Effect.forkScoped);
		const output = new WritableStream<Uint8Array>({
			write: (chunk) => {
				Queue.offerUnsafe(inbox, chunk);
			},
			close: () => {
				Queue.endUnsafe(inbox);
			},
		});
		const input = Stream.toReadableStreamWith(handle.stdout, context);

		let asks = 0;
		const base = acp.client({name: "tea-fabrika acp"});
		for (const method of extensions?.methods ?? [])
			base.onNotification(
				method,
				(params: unknown) => params,
				(ctx) => {
					extensions?.heard(method, ctx.params);
				},
			);
		const app = base
			.onNotification(acp.methods.client.session.update, (ctx) => {
				heard({kind: "update", update: ctx.params.update});
			})
			.onRequest(
				acp.methods.client.session.requestPermission,
				(ctx) =>
					new Promise<acp.RequestPermissionResponse>((resolve) => {
						asks += 1;
						let open = true;
						const answer = (response: acp.RequestPermissionResponse) => {
							if (!open) return;
							open = false;
							resolve(response);
						};
						// A turn cancelled while it waits answers `cancelled`, as ACP asks of a client.
						ctx.signal.addEventListener("abort", () => answer({outcome: {outcome: "cancelled"}}));
						heard({kind: "ask", ask: {id: `ask-${asks}`, request: ctx.params, answer}});
					}),
			);
		const connection = app.connect(acp.ndJsonStream(output, input));
		yield* Effect.addFinalizer(() =>
			Effect.sync(() => {
				connection.close();
				Queue.endUnsafe(inbox);
			}),
		);
		const agent = connection.agent;

		const init = yield* call("initialize", () =>
			agent.request(acp.methods.agent.initialize, {
				protocolVersion: acp.PROTOCOL_VERSION,
				// The client reads and writes no file and runs no terminal for the harness: it has its own tools, contained.
				// It takes `notice` updates: without them a harness writes its own warnings into the
				// model's reply (the Claude adapter's "Auto mode unavailable" did, live).
				clientCapabilities: {
					fs: {readTextFile: false, writeTextFile: false},
					terminal: false,
					session: {notices: {}},
				},
				clientInfo: {name: "tea-fabrika", version: "0"},
			}),
		).pipe(
			Effect.mapError((e) => ({...e, message: `${e.message}${tail === "" ? "" : `\n${tail}`}`})),
		);

		const can = (how: "load" | "resume") =>
			how === "load"
				? init.agentCapabilities?.loadSession === true
				: init.agentCapabilities?.sessionCapabilities?.resume !== undefined &&
					init.agentCapabilities.sessionCapabilities.resume !== null;

		const open: Connection["open"] = (how, id, cwd, meta, servers = []) => {
			const base: acp.NewSessionRequest = {
				cwd,
				mcpServers: [...servers],
				...(meta === undefined ? {} : {_meta: {...meta}}),
			};
			if (how === "new")
				return call("session/new", () =>
					agent.request<acp.NewSessionResponse, acp.NewSessionRequest>(
						acp.methods.agent.session.new,
						base,
					),
				).pipe(Effect.map((r) => openedOf(r.sessionId, r)));
			const sessionId = id ?? "";
			return how === "load"
				? call("session/load", () =>
						agent.request(acp.methods.agent.session.load, {...base, sessionId}),
					).pipe(Effect.map((r) => openedOf(sessionId, r)))
				: call("session/resume", () =>
						agent.request(acp.methods.agent.session.resume, {...base, sessionId}),
					).pipe(Effect.map((r) => openedOf(sessionId, r)));
		};

		const configure: Connection["configure"] = (session, category, value) =>
			Effect.gen(function* () {
				const option = session.config.find((o) => o.category === category);
				if (option === undefined)
					return yield* Effect.fail<AcpFailed>({
						_tag: "acp_failed",
						method: "session/set_config_option",
						message: `the harness offers no ${category} option`,
					});
				if (!valuesOf(option).includes(value))
					return yield* Effect.fail<AcpFailed>({
						_tag: "acp_failed",
						method: "session/set_config_option",
						message: `${category} ${value} is not one of: ${valuesOf(option).join(", ")}`,
					});
				const r = yield* call("session/set_config_option", () =>
					agent.request(acp.methods.agent.session.setConfigOption, {
						sessionId: session.id,
						configId: option.id,
						value,
					}),
				);
				// The options can change with a value: a model without effort drops its effort option.
				const mode = r.configOptions.find((o) => o.category === "mode");
				return {
					...session,
					config: r.configOptions,
					mode: mode?.type === "select" ? mode.currentValue : session.mode,
				};
			});

		return {
			init,
			pid: Number(handle.pid),
			can,
			open,
			configure,
			prompt: (session, text) =>
				call("session/prompt", () =>
					agent.request(acp.methods.agent.session.prompt, {
						sessionId: session,
						prompt: [{type: "text", text}],
					}),
				),
			cancel: (session) =>
				call("session/cancel", () =>
					agent.notify(acp.methods.agent.session.cancel, {sessionId: session}),
				),
			stderr: () => tail,
		};
	});
