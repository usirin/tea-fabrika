// One host process for the whole tree: `serve` from the package for sup:1, watcher:1 and every
// child. Three of these run at once; whoever wins a name's lease runs that name's program.
//
// Config (env): LEDGER_URL, LEDGER_NAME, HOST (unique per process start), CHILDREN, INTENSITY,
// PERIOD_MS, MAX_DELIVERIES (a number, or "off"), TTL_MS, RENEW_MS, RETRY_MS. One JSON line per
// host event on stdout, tagged with the name, for the harness. Node only at this edge: the
// runtime, and stdout.
import {NodeRuntime} from "@effect/platform-node";
import {type HostEvent, serve} from "@tea-fabrika/tea-host/host";
import {layerHttp} from "@tea-fabrika/tea-host/http";
import {Config, Console, Duration, Effect} from "effect";
import {childNames, childProgram, specOf, supervisorProgram, watcherProgram} from "./programs.ts";

const main = Effect.gen(function* () {
	const holder = yield* Config.String("HOST");
	const n = yield* Config.Number("CHILDREN").pipe(Config.withDefault(3));
	const intensity = yield* Config.Number("INTENSITY").pipe(Config.withDefault(5));
	const periodMs = yield* Config.Number("PERIOD_MS").pipe(Config.withDefault(5000));
	const deliveries = yield* Config.String("MAX_DELIVERIES").pipe(Config.withDefault("3"));
	const ttlMs = yield* Config.Number("TTL_MS").pipe(Config.withDefault(1000));
	const renewEveryMs = yield* Config.Number("RENEW_MS").pipe(Config.withDefault(250));
	const retryMs = yield* Config.Number("RETRY_MS").pipe(Config.withDefault(50));
	const line = (o: object) => Console.log(JSON.stringify({host: holder, at: Date.now(), ...o}));
	const listen = (name: string) => (e: HostEvent) => Effect.runSync(line({name, ...e}));
	const children = childNames(n);
	const spec = specOf(n, intensity, periodMs, deliveries === "off" ? null : Number(deliveries));
	const timing = {ttlMs, renewEveryMs, retryMs};

	yield* serve({
		name: "sup:1",
		holder,
		program: supervisorProgram(spec),
		listen: listen("sup:1"),
		...timing,
	});
	yield* serve({
		name: "watcher:1",
		holder,
		program: watcherProgram(["sup:1", ...children], 50, (o) => line({name: "watcher:1", ...o})),
		listen: listen("watcher:1"),
		...timing,
	});
	for (const name of children)
		yield* serve({name, holder, program: childProgram, listen: listen(name), ...timing});
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
