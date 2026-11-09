import {execFile} from "node:child_process";
import {randomBytes} from "node:crypto";
import * as Plugin from "@alchemy.run/cloudflare-runtime/core/Plugin";
import {RuntimeLifecycle, type RuntimeEvent} from "@alchemy.run/cloudflare-runtime/core/Runtime";
import {SystemError} from "@alchemy.run/cloudflare-runtime/core/RuntimeError";
import {applyCell} from "@demlik/tea";
import {Context, Deferred, Effect, Exit, Queue, Schema, Scope} from "effect";
import {BrainFact} from "../app/brain-fact.ts";
import {brainLife} from "../app/brain-life.ts";
import {ProcessIdGenerator} from "../coordination/process-id.ts";
import {SpanSink} from "../data/sink.ts";
import {brainOutbox, checkMemory} from "./local-stage.ts";
import {stageRecording} from "./stage-recording.ts";

class ControlPlugin extends Plugin.Service<ControlPlugin>()(
	"cloudflare-runtime/plugin/FabrikaControl",
) {}
class ControlError extends Schema.TaggedError<ControlError>()("ControlError", {
	why: Schema.String,
}) {}
type Target = "project" | "process" | "record" | "loader" | "bucket";
const Response = Schema.Struct({
	value: Schema.optionalKey(Schema.Unknown),
	error: Schema.optionalKey(Schema.Struct({why: Schema.String})),
});
const sample = (pid: number) =>
	Effect.callback<number, ControlError>((resume) => {
		const child = execFile(
			"ps",
			["-o", "rss=", "-p", String(pid)],
			{encoding: "utf8"},
			(error, text) =>
				resume(
					error
						? Effect.fail(new ControlError({why: "sample"}))
						: Effect.succeed(Number(text.trim()) * 1024),
				),
		);
		return Effect.sync(() => {
			child.kill();
		});
	});
const bucketChecksum = Effect.fn(function* <E>(work: Effect.Effect<unknown, E>) {
	const raw = yield* work;
	if (raw === null) return null;
	const {sha256} = yield* Schema.decodeUnknownEffect(Schema.Struct({sha256: Schema.String}))(raw);
	return {
		checksums: {
			sha256: Uint8Array.from((sha256.match(/../g) ?? []).map((byte) => Number.parseInt(byte, 16)))
				.buffer,
		},
	};
});

export const startStage = Effect.fn("brain.stage")(function* <E, R>(
	options: {
		readonly name: string;
		readonly port: number;
		readonly build: string;
		readonly home: string;
	},
	deploy: (local: Context.Context<never>, scope: Scope.Scope) => Effect.Effect<unknown, E, R>,
) {
	const config = options,
		scope = yield* Effect.scope,
		ids = yield* ProcessIdGenerator;
	const outbox = yield* brainOutbox(options.home),
		runtimeScope = yield* Scope.make(),
		events = yield* Queue.unbounded<{
			readonly event: RuntimeEvent;
			readonly why: (typeof BrainFact.cases.started.Type)["why"];
			readonly bytes: number | undefined;
		}>(),
		// Alchemy's local Worker provider forks the workerd start, so deploy returns before workerd
		// listens. The control socket's first start opens this latch.
		listening = yield* Deferred.make<void>(),
		started = yield* Deferred.make<void>();
	const token = randomBytes(32).toString("base64url");
	let port = 0,
		pid = 0,
		previous = yield* outbox.last,
		start = "",
		stopping = false;
	let replacement: Deferred.Deferred<void, ControlError> | null = null;
	let reason: "open" | "crash" | "memory" | "core" = "open",
		bytes: number | undefined;
	let state = brainLife.init(null, {})[0];
	const transition = (
		msg:
			| Parameters<typeof brainLife.update.started>[1]
			| {type: "waiting"; after: string; until: number; why: string}
			| {type: "braked"; after: string; why: string}
			| {type: "stop"}
			| {type: "stopped"},
	) => {
		state = applyCell(brainLife, state, msg)[0];
	};
	const call = Effect.fnUntraced(function* (
		target: Target,
		project: string,
		name: string,
		method: string,
		args: ReadonlyArray<unknown>,
	) {
		if (port === 0) return yield* new ControlError({why: "offline"});
		// oxlint-disable-next-line fabrika/no-promises -- edge: the private runtime socket is an HTTP transport for object calls
		const response = yield* Effect.tryPromise({
			try: () =>
				fetch(`http://127.0.0.1:${port}`, {
					method: "POST",
					headers: {authorization: `Bearer ${token}`, "content-type": "application/json"},
					body: JSON.stringify({target, project, name, method, args}),
				}),
			catch: () => new ControlError({why: "unreachable"}),
		});
		// oxlint-disable-next-line fabrika/no-promises -- edge: the binding transport response returns a Promise
		const raw = yield* Effect.tryPromise({
			try: () => response.json(),
			catch: () => new ControlError({why: "bad_row"}),
		});
		const answer = yield* Schema.decodeUnknownEffect(Response)(raw).pipe(
			Effect.mapError(() => new ControlError({why: "bad_row"})),
		);
		if (answer.error !== undefined) return yield* new ControlError(answer.error);
		return answer.value;
	});
	const flush = outbox.flush((fact) => call("project", config.name, "", "brain", [fact]));
	const recording = yield* stageRecording(
		options.home,
		`brain:${config.name}`,
		(target, name, method, args) => call(target, config.name, name, method, args),
	);
	const sink = Context.get(recording, SpanSink);
	const flushRecords = sink.flush.pipe(Effect.provideContext(recording));
	const recorded = <A, E, R>(work: Effect.Effect<A, E, R>) =>
		work.pipe(
			Effect.exit,
			Effect.flatMap((exit) =>
				flushRecords.pipe(
					// The durable queue retries a down receiver. A full local disk still fails loudly.
					Effect.catchIf(
						(error) => error.why !== "storage",
						() => Effect.void,
					),
					Effect.flatMap(() => exit),
				),
			),
			Effect.provideContext(recording),
		);
	const local = Context.empty().pipe(
		Context.add(RuntimeLifecycle, (event) => {
			const observed = {event, why: reason, bytes};
			// A new child starts with a clean cause before any queued file write can yield.
			if (event.type === "start") {
				reason = "crash";
				bytes = undefined;
			}
			Queue.offerUnsafe(events, observed);
		}),
		Context.add(ControlPlugin, {
			sockets: [
				{
					name: "fabrika-control",
					address: "127.0.0.1:0",
					http: {},
					service: {
						name: "user-worker",
						entrypoint: "Control",
						props: {json: JSON.stringify({token})},
					},
				},
			],
			start: Effect.fnUntraced(function* (ports) {
				port = yield* Schema.decodeUnknownEffect(Schema.Int)(ports["fabrika-control"]).pipe(
					Effect.mapError(
						() =>
							new SystemError({
								subtag: "control_port",
								message: "The local runtime returned an invalid control port",
							}),
					),
				);
				yield* Deferred.succeed(listening, undefined);
				if (replacement !== null) {
					yield* Deferred.succeed(replacement, undefined);
					replacement = null;
				}
			}),
		}),
	);
	const stopRuntime = Effect.fn("brain.stop")(function* () {
		stopping = true;
		transition({type: "stop"});
		yield* Scope.close(runtimeScope, Exit.void);
		if (start !== "") {
			yield* outbox.add(
				BrainFact.cases.stopped.make({
					id: `${start}/stopped`,
					start,
					at: Date.now(),
					why: "stop",
				}),
			);
			yield* flush.pipe(Effect.ignore);
		}
		transition({type: "stopped"});
	});
	yield* Effect.addFinalizer(() => recorded(stopRuntime()).pipe(Effect.orDie));
	const restartRuntime = Effect.fn("brain.restart")(function* (
		ready: Deferred.Deferred<void, ControlError>,
	) {
		yield* Deferred.await(ready);
	});
	const recordEvents = Effect.forever(
		Effect.gen(function* () {
			const {event, why, bytes: rss} = yield* Queue.take(events);
			if (stopping) return;
			if (event.type === "exit") {
				yield* outbox.add(
					BrainFact.cases.exited.make({
						id: `${start}/exited`,
						start,
						at: Date.now(),
						why,
						exitCode: event.exit.exitCode,
						signal: event.exit.signal === null ? null : String(event.exit.signal),
						...(rss === undefined ? {} : {bytes: rss}),
					}),
				);
				pid = 0;
				const ready = yield* Deferred.make<void, ControlError>();
				replacement = ready;
				yield* Effect.forkIn(recorded(restartRuntime(ready)).pipe(Effect.ignore), scope);
			}
			if (event.type === "start") {
				previous = start || previous;
				start = yield* ids.next;
				pid = event.pid;
				const fact = BrainFact.cases.started.make({
					id: `${start}/started`,
					start,
					after: previous,
					build: config.build,
					why,
					pid,
					at: Date.now(),
					...(rss === undefined ? {} : {bytes: rss}),
				});
				transition({type: "started", ...fact});
				yield* outbox.add(fact);
				yield* Deferred.succeed(started, undefined);
			} else if (event.type === "restart") {
				transition({type: "waiting", after: start, until: Date.now() + event.delay, why});
				yield* outbox.add(
					BrainFact.cases.restarting.make({
						id: `${start}/restarting`,
						start,
						at: Date.now(),
						why,
						exitCode: event.exit.exitCode,
						signal: event.exit.signal === null ? null : String(event.exit.signal),
						backoff: event.delay,
						...(rss === undefined ? {} : {bytes: rss}),
					}),
				);
			} else if (event.type === "stop") {
				if (replacement !== null) {
					yield* Deferred.fail(replacement, new ControlError({why: event.why}));
					replacement = null;
				}
				transition({type: "braked", after: start, why: event.why});
				yield* outbox.add(
					BrainFact.cases.braked.make({
						id: `${start}/braked`,
						start,
						at: Date.now(),
						why: event.why,
						exitCode: event.exit.exitCode,
						signal: event.exit.signal === null ? null : String(event.exit.signal),
					}),
				);
				pid = 0;
			}
		}),
	);
	yield* Effect.forkScoped(recordEvents);
	const startRuntime = Effect.fn("brain.start")(function* () {
		yield* deploy(local, runtimeScope);
		yield* Deferred.await(listening).pipe(
			Effect.timeoutOrElse({
				duration: "30 seconds",
				orElse: () => Effect.fail(new ControlError({why: "start_timeout"})),
			}),
		);
		yield* Deferred.await(started);
		yield* call("project", config.name, "", "info", []);
		yield* flush;
	});
	yield* recorded(startRuntime());
	yield* Effect.forkScoped(
		Effect.forever(
			Effect.gen(function* () {
				yield* Effect.sleep("1 second");
				if (stopping || pid === 0) return;
				yield* checkMemory({
					pid,
					sample,
					replace: (value) =>
						Effect.sync(() => {
							reason = "memory";
							bytes = value.bytes;
							process.kill(value.pid, "SIGTERM");
						}),
				}).pipe(Effect.ignore);
				yield* flush.pipe(Effect.ignore);
				yield* flushRecords.pipe(
					Effect.catchIf(
						(error) => error.why !== "storage",
						() => Effect.void,
					),
					Effect.orDie,
				);
			}),
		),
	);
	const proxy = (target: Target, project: string, name = "") =>
		new Proxy(
			{},
			{
				get: (_value, method) => {
					if (method === "then") return undefined;
					const invoke = (args: ReadonlyArray<unknown>) =>
						call(target, project, name, String(method), args);
					// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the local binding proxy matches Durable Object's Promise API
					return (...args: ReadonlyArray<unknown>) => Effect.runPromise(invoke(args));
				},
			},
		);
	return {
		url: `http://127.0.0.1:${config.port}`,
		project: (project: string) => {
			const p = proxy("project", project);
			return new Proxy(p, {
				get: (value, method) =>
					method === "connect"
						? Reflect.get(p, "clientConnect")
						: method === "gateways"
							? {
									join: Reflect.get(p, "join"),
									leave: Reflect.get(p, "leave"),
									online: Reflect.get(p, "online"),
								}
							: method === "forProcess"
								? (pid: string) => ({
										sign: (id: string, parent: string, kind: string) =>
											Reflect.get(p, "sign")(pid, id, parent, kind),
										append: (input: unknown) => Reflect.get(p, "commit")(pid, input),
									})
								: Reflect.get(value, method),
			});
		},
		process: (pid: string) =>
			new Proxy(proxy("process", config.name, pid), {
				get: (value, method) => Reflect.get(value, method === "alarm" ? "savedAlarm" : method),
			}),
		record: (project: string, name: string) => proxy("record", project, name),
		loader: {
			load: (name: string, pid: string) =>
				// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the local Worker Loader proxy matches the platform's Promise API
				Effect.runPromise(
					call("loader", pid, name, "init", [null]).pipe(Effect.as(proxy("loader", pid, name))),
				),
		},
		bucket: {
			put: (key: string, body: Uint8Array, options: {sha256: string}) =>
				// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the local R2 proxy matches the platform's Promise API
				Effect.runPromise(call("bucket", config.name, "", "put", [key, [...body], options.sha256])),
			head: (key: string) =>
				// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: the local R2 proxy matches the platform's Promise API
				Effect.runPromise(bucketChecksum(call("bucket", config.name, "", "head", [key]))),
		},
	};
});
