// The local ledger: the Durable Object, in Miniflare, in a child process on this machine. The shape
// docs/direction/a-local-first-sync-engine.md decided, from experiments 93 and 94:
//
//   - workerd's own socket (`direct`), on a fixed port, so a restart keeps the same URL;
//   - the child in its own process group, and every signal to the whole group: a kill to the Node
//     process alone leaves workerd serving;
//   - a memory cap: the group's resident memory is read every `checkEvery`, and past `capMb`
//     (500 MB) the child is stopped and started again (94 saw workerd grow without bound);
//   - a small pool of keep-alive connections (`layerHttp`).
//
// `layerLocal` gives both the `Ledger` and `LocalLedger`, the handle on the child: its URL, its
// restarts, and `crash` (SIGKILL the group, start again), which the fault tests use.
//
// The local door (`door.ts`): one person, from `person` (default "owner"), proven by a secret.
// The secret is made once and kept in the data folder, `door-secret`, readable by this user only:
// whoever can read that folder can read the ledger's own files too, so it guards no less than the
// data does. Another process on this machine joins with `layerAttach`, which reads the same file.
// With `persist` in memory, the secret is too, and only this process holds it.
//
// Node at the edge: `process.execPath` to start the child, a free port from `node:net`, and `ps`
// for the group's memory. The child itself is started and signalled through Effect's ChildProcess.
import {createServer} from "node:net";
import {NodeServices} from "@effect/platform-node";
import {
	Context,
	Deferred,
	Duration,
	Effect,
	Exit,
	Fiber,
	FileSystem,
	Layer,
	Path,
	Redacted,
	Ref,
	Schedule,
	Schema,
	Scope,
	Semaphore,
	Stream,
} from "effect";
import {ChildProcess, ChildProcessSpawner} from "effect/process";
import {beside} from "./beside.ts";
import {newToken} from "./door.ts";
import {layerHttp} from "./http.ts";

export class LocalError extends Schema.TaggedError<LocalError>()("LocalError", {
	message: Schema.String,
}) {}

export interface LocalOptions {
	/** The Durable Object's data folder. */
	readonly persist: string;
	/** The ledger's name (one Durable Object per name). */
	readonly ledger: string;
	/** The direct socket's port. Default: a free one, kept across restarts. */
	readonly port?: number;
	readonly graceMs?: number;
	/** Crashes in a row on one message before it goes to `<name>/dead`; `null`: never. Default 3. */
	readonly maxDeliveries?: number | null;
	/** Restart the child when its process group holds more than this. Default 500 MB. */
	readonly capMb?: number;
	/** How often the memory is read. Default 2 s. */
	readonly checkEvery?: Duration.Duration;
	readonly maxSockets?: number;
	/** Who the one person on this laptop's ledger is: their writer is `user:<person>`. Default "owner". */
	readonly person?: string;
}

const SECRET_FILE = "door-secret";

/** The local door's secret: kept in the data folder (made once, this user only), or in memory. */
const secretOf = (persist: string | false) =>
	Effect.gen(function* () {
		if (persist === false) return Redacted.make(newToken("fabrika_l_"));
		const fs = yield* FileSystem.FileSystem;
		const path = (yield* Path.Path).join(persist, SECRET_FILE);
		if (!(yield* fs.exists(path))) {
			yield* fs.makeDirectory(persist, {recursive: true});
			// `wx`: two starters at once, and one of them writes it; the other reads what it wrote.
			yield* fs
				.writeFileString(path, newToken("fabrika_l_"), {flag: "wx", mode: 0o600})
				.pipe(Effect.ignore);
		}
		return Redacted.make((yield* fs.readFileString(path)).trim());
	}).pipe(Effect.mapError((e) => new LocalError({message: `the door's secret: ${String(e)}`})));

export class LocalLedger extends Context.Service<
	LocalLedger,
	{
		readonly url: string;
		readonly port: number;
		/** The local door's secret: what lets this process in as the person. */
		readonly token: Redacted.Redacted<string>;
		/** The child's pid, which is its process group's id. */
		readonly pid: Effect.Effect<number>;
		/** Restarts so far: crashes and memory-cap restarts. */
		readonly restarts: Effect.Effect<number>;
		/** The group's resident memory now, in MB. */
		readonly memoryMb: Effect.Effect<number>;
		/** SIGKILL the whole group, then start it again. Answers how long the restart took. */
		readonly crash: Effect.Effect<{readonly restartMs: number}, LocalError>;
		/** Stop the group gracefully (SIGTERM, then SIGKILL after 3 s) and start it again. */
		readonly restart: Effect.Effect<{readonly restartMs: number}, LocalError>;
	}
>()("@kampus/fabrika/LocalLedger") {}

const DAEMON = beside(import.meta.url, "daemon");

/**
 * Miniflare and esbuild (which bundles the ledger's Worker) are optional peers of the package, and
 * only the child loads them. Without this check their absence would surface 30 s later as the
 * child's stack trace; with it, as one line, at once.
 */
const miniflareInstalled = Effect.forEach(
	["miniflare", "esbuild"],
	(peer) =>
		Effect.try({
			// Resolved from here, the folder the child starts from, so it finds what the child would.
			try: () => import.meta.resolve(peer),
			catch: () =>
				new LocalError({
					message: `@kampus/fabrika/local runs the ledger in Miniflare, bundled by esbuild, and ${peer} is not installed: install it (npm install ${peer})`,
				}),
		}),
	// One after the other: the first one missing is the one named.
	{concurrency: 1},
);

/** A free TCP port on 127.0.0.1. Node at the edge: Effect has no "pick me a port". */
const freePort = Effect.callback<number, LocalError>((resume) => {
	const s = createServer();
	s.listen(0, "127.0.0.1", () => {
		const a = s.address();
		s.close(() =>
			resume(
				a && typeof a === "object"
					? Effect.succeed(a.port)
					: Effect.fail(new LocalError({message: "no free port"})),
			),
		);
	});
});

const Ready = Schema.fromJsonString(Schema.Struct({ready: Schema.String, pid: Schema.Number}));
const readyOf = Schema.decodeUnknownExit(Ready);

/** Every process's group and resident memory, from `ps`. */
const groupMemoryKb = (pgid: number) =>
	Effect.gen(function* () {
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const out = yield* spawner.string(ChildProcess.make("ps", ["-A", "-o", "pgid=,rss="]));
		let kb = 0;
		for (const line of out.split("\n")) {
			const [g, rss] = line.trim().split(/\s+/);
			if (Number(g) === pgid) kb += Number(rss);
		}
		return kb;
	});

export const startLocal = (o: LocalOptions) =>
	Effect.gen(function* () {
		yield* miniflareInstalled;
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const port = o.port ?? (yield* freePort);
		const url = `http://127.0.0.1:${port}`;
		const token = yield* secretOf(o.persist);
		const restarts = yield* Ref.make(0);
		const lock = yield* Semaphore.make(1);

		type Child = {readonly scope: Scope.Closeable; readonly pid: number};
		const spawnOne = Effect.gen(function* () {
			const scope = yield* Scope.make();
			const started = Effect.gen(function* () {
				const handle = yield* ChildProcess.make(process.execPath, ["--no-warnings", DAEMON], {
					env: {
						PERSIST: o.persist,
						PORT: String(port),
						GRACE_MS: String(o.graceMs ?? 1000),
						DOOR_PERSON: o.person ?? "owner",
						DOOR_SECRET: Redacted.value(token),
						...(o.maxDeliveries === undefined
							? {}
							: {
									MAX_DELIVERIES: o.maxDeliveries === null ? "off" : String(o.maxDeliveries),
								}),
					},
					extendEnv: true,
					detached: true,
					forceKillAfter: Duration.seconds(3),
				}).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
				const ready = yield* Deferred.make<number, LocalError>();
				// Every stdout line is read, so the pipe never fills; the first ready line is the answer.
				yield* handle.stdout.pipe(
					Stream.decodeText(),
					Stream.splitLines,
					Stream.runForEach((line) => {
						const exit = readyOf(line);
						return Exit.isSuccess(exit) ? Deferred.succeed(ready, exit.value.pid) : Effect.void;
					}),
					Effect.ignore,
					Effect.forkScoped,
				);
				const err: string[] = [];
				const errRead = yield* handle.stderr.pipe(
					Stream.decodeText(),
					Stream.runForEach((t) => Effect.sync(() => err.push(t))),
					Effect.ignore,
					Effect.forkScoped,
				);
				// The child's end is an answer too, and at once: a child that has ended will never be
				// ready. A port that is taken ends it within a second, as workerd cannot listen on it;
				// waiting out the clock instead made that a 30 s hang (CI saw it twice). What it said is
				// read to the end first, so the answer names why.
				yield* handle.exitCode.pipe(
					Effect.flatMap((code) =>
						Fiber.join(errRead).pipe(
							Effect.andThen(
								Deferred.fail(
									ready,
									new LocalError({
										message: `the ledger stopped before it was ready (exit ${code}): ${err.join("").slice(0, 500)}`,
									}),
								),
							),
						),
					),
					Effect.ignore,
					Effect.forkScoped,
				);
				// The clock only for a child that lives on and never says it is ready: no event comes.
				yield* Deferred.await(ready).pipe(
					Effect.timeoutOrElse({
						duration: Duration.seconds(30),
						orElse: () =>
							Effect.fail(
								new LocalError({
									message: `the ledger did not say it was ready in 30 s: ${err.join("").slice(0, 500)}`,
								}),
							),
					}),
				);
				return handle.pid;
			}).pipe(
				Scope.provide(scope),
				Effect.mapError((e) =>
					e instanceof LocalError ? e : new LocalError({message: String(e)}),
				),
				Effect.tapError(() => Scope.close(scope, Exit.void)),
			);
			const pid = yield* started;
			return {scope, pid} satisfies Child;
		});

		const child = yield* Ref.make<Child>(yield* spawnOne);
		yield* Effect.addFinalizer(() =>
			Ref.get(child).pipe(Effect.flatMap((c) => Scope.close(c.scope, Exit.void))),
		);

		const again = (stop: (c: Child) => Effect.Effect<void>) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					yield* stop(yield* Ref.get(child));
					const t0 = performance.now();
					yield* Ref.set(child, yield* spawnOne);
					yield* Ref.update(restarts, (n) => n + 1);
					return {restartMs: Math.round(performance.now() - t0)};
				}),
			);
		// SIGKILL: the group dies at once, mid-write; closing its scope finds it gone.
		const sigkill = (c: Child) =>
			Effect.try({
				// Node at the edge: a signal to the whole group (a negative pid).
				try: () => process.kill(-c.pid, "SIGKILL"),
				catch: (e) => new LocalError({message: String(e)}),
			}).pipe(Effect.ignore, Effect.andThen(Scope.close(c.scope, Exit.void)));
		const memoryMb = Ref.get(child).pipe(
			Effect.flatMap((c) => groupMemoryKb(c.pid)),
			Effect.map((kb) => Math.round(kb / 102.4) / 10),
			Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
			Effect.orElseSucceed(() => 0),
		);
		const restart = again((c) => Scope.close(c.scope, Exit.void));

		// The memory cap.
		const cap = o.capMb ?? 500;
		yield* memoryMb.pipe(
			Effect.flatMap((mb) => (mb > cap ? Effect.ignore(restart) : Effect.void)),
			Effect.repeat(Schedule.spaced(o.checkEvery ?? Duration.seconds(2))),
			Effect.forkScoped,
		);

		return LocalLedger.of({
			url,
			port,
			token,
			pid: Ref.get(child).pipe(Effect.map((c) => c.pid)),
			restarts: Ref.get(restarts),
			memoryMb,
			crash: again(sigkill),
			restart,
		});
	});

/** The local ledger and the `Ledger` over it. The child stops when the layer's scope closes. */
export const layerLocal = (o: LocalOptions) => {
	const local = Layer.effect(LocalLedger, startLocal(o)).pipe(Layer.provide(NodeServices.layer));
	const ledger = Layer.unwrap(
		Effect.gen(function* () {
			const l = yield* LocalLedger;
			return layerHttp({
				url: l.url,
				ledger: o.ledger,
				token: l.token,
				...(o.maxSockets === undefined ? {} : {maxSockets: o.maxSockets}),
			});
		}),
	);
	return ledger.pipe(Layer.provideMerge(local));
};

export interface AttachOptions {
	/** The data folder the ledger was started on: its door's secret is there. */
	readonly persist: string;
	readonly ledger: string;
	/** The ledger's direct socket. */
	readonly port: number;
	readonly maxSockets?: number;
}

/**
 * The `Ledger` of a local ledger another process started on this machine (`layerLocal` with a
 * `persist` folder), as its one person: the door's secret is read from that folder.
 */
export const layerAttach = (o: AttachOptions) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = (yield* Path.Path).join(o.persist, SECRET_FILE);
			const secret = yield* fs
				.readFileString(path)
				.pipe(
					Effect.mapError(
						() => new LocalError({message: `no ledger was started on ${o.persist}: no ${path}`}),
					),
				);
			return layerHttp({
				url: `http://127.0.0.1:${o.port}`,
				ledger: o.ledger,
				token: Redacted.make(secret.trim()),
				...(o.maxSockets === undefined ? {} : {maxSockets: o.maxSockets}),
			});
		}),
	).pipe(Layer.provide(NodeServices.layer));
