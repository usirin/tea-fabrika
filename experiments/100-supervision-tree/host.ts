// One host process for the whole tree: `serve` from the package for top, sup:all, sup:rest, every
// worker (t:1 too, the child a call adds) and watcher:1. Three of these run at once; whoever wins
// a name's lease runs that name's program.
//
// Config (env): LEDGER_URL, LEDGER_NAME, HOST (unique per process start), TTL_MS, RENEW_MS. One
// JSON line per host event on stdout, tagged with the name, for the harness. Node only at this
// edge: the runtime, and stdout.
import {NodeRuntime} from "@effect/platform-node";
import {type HostEvent, serve} from "@kampus/fabrika";
import {layerHttp} from "@kampus/fabrika/http";
import {Config, Console, Duration, Effect} from "effect";
import {watcherProgram} from "../99-monitors-supervisor/programs.ts";
import {RETRY, SUPERVISORS, supervisorProgram, TRAPS, WATCHED, worker} from "./programs.ts";

const main = Effect.gen(function* () {
	const holder = yield* Config.String("HOST");
	const ttlMs = yield* Config.Number("TTL_MS").pipe(Config.withDefault(1000));
	const renewEveryMs = yield* Config.Number("RENEW_MS").pipe(Config.withDefault(250));
	const line = (o: object) => Console.log(JSON.stringify({host: holder, at: Date.now(), ...o}));
	const listen = (name: string) => (e: HostEvent) => Effect.runSync(line({name, ...e}));
	const timing = {ttlMs, renewEveryMs, retryMs: 50};

	for (const name of SUPERVISORS)
		yield* serve({
			name,
			holder,
			program: supervisorProgram(name),
			listen: listen(name),
			...timing,
		});
	yield* serve({
		name: "watcher:1",
		holder,
		program: watcherProgram(
			WATCHED,
			RETRY.retryMs,
			(o) => line({name: "watcher:1", ...o}),
			RETRY.maxRetryMs,
		),
		listen: listen("watcher:1"),
		...timing,
	});
	for (const [name, trap] of Object.entries(TRAPS))
		yield* serve({name, holder, program: worker(trap), listen: listen(name), ...timing});
	yield* line({ev: "started", pid: process.pid});
	// 94's pause detector: says when the process was frozen, and decides nothing.
	let last = Date.now();
	yield* Effect.sleep(Duration.millis(100)).pipe(
		Effect.andThen(() => {
			const now = Date.now();
			const gap = now - last;
			last = now;
			return gap > 600 ? line({ev: "paused", ms: gap - 100}) : Effect.void;
		}),
		Effect.forever,
		Effect.forkScoped,
	);
	return yield* Effect.never;
}).pipe(Effect.scoped);

NodeRuntime.runMain(
	Effect.gen(function* () {
		const layer = layerHttp({
			url: yield* Config.String("LEDGER_URL"),
			ledger: yield* Config.String("LEDGER_NAME").pipe(Config.withDefault("tea-host")),
		});
		return yield* main.pipe(Effect.provide(layer));
	}),
);
