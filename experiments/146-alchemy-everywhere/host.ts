// Spike 1: a resource of our own, `Fabrika.Host`, written with Alchemy v2's own API.
//
//   const host = yield* Host("laptop", {home, programs: ["counter"], ledger: "memory"});
//   host.pid; host.socket; // Outputs, resolved after deploy
//
// A resource is two parts (alchemy@2.0.0-beta.84, src/Resource.ts and src/Provider.ts):
//
//   - its type: `Resource<"Fabrika.Host", Props, Attributes>`, and the constructor
//     `Resource<Host>("Fabrika.Host")`;
//   - its provider: a Layer made by `Provider.effect(Host, ...)`, with `reconcile` (create and
//     update are one call since the beta's unified lifecycle), `delete`, and optional `read` and
//     `diff`. The provider is an Effect, so it can ask for any service from its context; this
//     one asks for `Processes`, below, and the Layer's type says so.
//
// What changes what:
//
//   - `programs` changed: an update in place. The new config is written and the host gets SIGHUP;
//     the pid stays the same.
//   - `home` or `ledger` changed: a replacement. A new home is a new host, and a host opens one
//     ledger for its whole life (docs/direction/tea-host.md).
//   - the process died out of band: `read` says it is gone, which `alchemy drift` (not a plain
//     deploy) turns into a fresh start.
import {spawn} from "node:child_process";
import {openSync} from "node:fs";
import {createConnection} from "node:net";
import {join} from "node:path";
import {isResolved} from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import {Resource} from "alchemy/Resource";
import {Context, Duration, Effect, FileSystem, Layer, Option, Schedule, Schema} from "effect";

export interface HostProps {
	/** The host's home folder. Its config, pid file, socket and log live here. */
	readonly home: string;
	/** The programs it runs. Changing them reloads the host in place. */
	readonly programs: ReadonlyArray<string>;
	/** Which ledger it opens. Changing it is a new host. */
	readonly ledger: "memory" | "local";
}

export interface HostAttributes {
	readonly pid: number;
	readonly socket: string;
	readonly home: string;
	readonly startedAt: number;
	readonly programs: ReadonlyArray<string>;
	readonly reloads: number;
}

export type Host = Resource<"Fabrika.Host", HostProps, HostAttributes>;
export const Host = Resource<Host>("Fabrika.Host");

export class HostError extends Schema.TaggedError<HostError>()("HostError", {
	message: Schema.String,
}) {}

/** What a host answers on its socket. */
const Answer = Schema.fromJsonString(
	Schema.Struct({
		pid: Schema.Number,
		startedAt: Schema.Number,
		reloads: Schema.Number,
		config: Schema.Struct({
			programs: Schema.Array(Schema.String),
			ledger: Schema.Literals(["memory", "local"]),
		}),
	}),
);
type Answer = typeof Answer.Type;
const answerOf = Schema.decodeUnknownOption(Answer);

/**
 * Starting, signalling and asking a host process. A service, so the provider names no platform
 * and a test can hand it a fake. `Processes.node` is the real one.
 */
export class Processes extends Context.Service<
	Processes,
	{
		/** Start the host in the background, in its own process group, so it outlives the deploy. */
		readonly start: (home: string) => Effect.Effect<number, HostError>;
		readonly signal: (pid: number, signal: "SIGHUP" | "SIGTERM") => Effect.Effect<void>;
		readonly alive: (pid: number) => Effect.Effect<boolean>;
		/** What the host on this socket says it is, or none when nothing answers. */
		readonly ask: (socket: string) => Effect.Effect<Option.Option<Answer>>;
	}
>()("exp146/Processes") {
	/**
	 * Node at the edge: Effect's ChildProcess ties a child to a Scope and stops it when the scope
	 * closes, and a host must outlive the deploy that started it. So `spawn` with `detached`, its
	 * output to a log file in its home, and `unref`.
	 */
	static readonly node = Layer.succeed(Processes, {
		start: (home) =>
			Effect.try({
				try: () => {
					const log = openSync(join(home, "host.log"), "a");
					const child = spawn(
						process.execPath,
						[new URL("./host-process.ts", import.meta.url).pathname, home],
						{detached: true, stdio: ["ignore", log, log]},
					);
					child.unref();
					if (child.pid === undefined) throw new Error("no pid");
					return child.pid;
				},
				catch: (e) => new HostError({message: `could not start the host: ${String(e)}`}),
			}),
		// Already gone: a stop that finds nothing to stop has done its job.
		signal: (pid, signal) => Effect.try(() => process.kill(pid, signal)).pipe(Effect.ignore),
		alive: (pid) =>
			Effect.try(() => process.kill(pid, 0)).pipe(
				Effect.as(true),
				Effect.orElseSucceed(() => false),
			),
		ask: (socket) =>
			Effect.callback<Option.Option<Answer>>((resume) => {
				const conn = createConnection(socket);
				let text = "";
				conn.setTimeout(1000, () => conn.destroy());
				conn.on("connect", () => conn.write("hello\n"));
				conn.on("data", (b) => {
					text += b.toString();
				});
				conn.on("error", () => resume(Effect.succeed(Option.none())));
				conn.on("close", () => resume(Effect.succeed(answerOf(text.trim()))));
				return Effect.sync(() => conn.destroy());
			}),
	});
}

const socketOf = (home: string) => join(home, "host.sock");

const attributesOf = (home: string, a: Answer): HostAttributes => ({
	pid: a.pid,
	socket: socketOf(home),
	home,
	startedAt: a.startedAt,
	programs: a.config.programs,
	reloads: a.reloads,
});

/** Try again every 25 ms, up to 200 times: 5 s for a host to start, reload or stop. */
const patiently = {times: 200, schedule: Schedule.spaced(Duration.millis(25))};

export const HostProvider = () =>
	Provider.effect(
		Host,
		Effect.gen(function* () {
			const processes = yield* Processes;
			const fs = yield* FileSystem.FileSystem;

			const writeConfig = (news: HostProps) =>
				fs.writeFileString(
					join(news.home, "config.json"),
					JSON.stringify({programs: news.programs, ledger: news.ledger}),
				);

			/** Ask until the host answers in the shape `ok` wants. */
			const waitFor = (home: string, ok: (a: Answer) => boolean) =>
				processes.ask(socketOf(home)).pipe(
					Effect.flatMap((a) =>
						Option.isSome(a) && ok(a.value)
							? Effect.succeed(a.value)
							: Effect.fail(new HostError({message: `no host answered in ${home}`})),
					),
					Effect.retry(patiently),
				);

			const stop = (pid: number) =>
				Effect.gen(function* () {
					yield* processes.signal(pid, "SIGTERM");
					yield* processes.alive(pid).pipe(
						Effect.filterOrFail(
							(alive) => !alive,
							() => new HostError({message: `host ${pid} did not stop`}),
						),
						Effect.retry(patiently),
					);
				});

			return Host.Provider.of({
				// For `alchemy nuke`, which lists every resource of a type and deletes it. Hosts are
				// not listed: a nuke stops only the hosts in state. `Provider.effect` would default it,
				// but `Host.Provider.of` types it as required (src/Provider.ts, ProviderServiceInput).
				list: () => Effect.succeed([]),
				read: ({olds, output}) =>
					processes
						.ask(socketOf(output?.home ?? olds.home))
						.pipe(
							Effect.map((a) =>
								Option.isSome(a) ? attributesOf(output?.home ?? olds.home, a.value) : undefined,
							),
						),
				diff: ({news, olds}) =>
					Effect.sync(() =>
						!isResolved(news)
							? undefined
							: news.home !== olds.home || news.ledger !== olds.ledger
								? {action: "replace" as const, deleteFirst: true}
								: news.programs.join(",") !== olds.programs.join(",")
									? {action: "update" as const}
									: undefined,
					),
				reconcile: ({news, output}) =>
					Effect.gen(function* () {
						yield* fs.makeDirectory(news.home, {recursive: true});
						yield* writeConfig(news);
						const running = output === undefined ? false : yield* processes.alive(output.pid);
						if (output !== undefined && running) {
							// Update in place: same process, new config.
							yield* processes.signal(output.pid, "SIGHUP");
							const want = news.programs.join(",");
							return attributesOf(
								news.home,
								yield* waitFor(news.home, (a) => a.config.programs.join(",") === want),
							);
						}
						const pid = yield* processes.start(news.home);
						return attributesOf(news.home, yield* waitFor(news.home, (a) => a.pid === pid));
					}),
				// A create that failed half way leaves a row with no output: the pid file says who to stop.
				delete: ({olds, output}) =>
					output === undefined
						? fs.readFileString(join(olds.home, "host.pid")).pipe(
								Effect.flatMap((s) => stop(Number(s.trim()))),
								Effect.catchTag("PlatformError", () => Effect.void),
							)
						: stop(output.pid),
			});
		}),
	);
