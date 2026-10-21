// One host process for experiment 102's whole tree: `serve` from the package for top, every
// ticket, every scouts supervisor, every builder and every scout. Three of these run at once;
// whoever wins a name's lease runs that name's program.
//
// Config (env): LEDGER_URL, LEDGER_NAME, HOST (unique per process start), PER_CASE, SCALE, TTL_MS,
// RENEW_MS. One JSON line per host event and per stub-agent turn on stdout, for the harness. Node
// only at this edge: the runtime, and stdout.
import {NodeRuntime} from "@effect/platform-node";
import {type HostEvent, serve} from "@kampus/fabrika";
import {layerHttp} from "@kampus/fabrika/http";
import {Config, Console, Effect} from "effect";
import {agent, namesOf, supervisorProgram} from "./programs.ts";

const main = Effect.gen(function* () {
	const holder = yield* Config.String("HOST");
	const size = {
		perCase: yield* Config.Number("PER_CASE").pipe(Config.withDefault(1)),
		scale: yield* Config.Number("SCALE").pipe(Config.withDefault(1)),
	};
	const ttlMs = yield* Config.Number("TTL_MS").pipe(Config.withDefault(1000));
	const renewEveryMs = yield* Config.Number("RENEW_MS").pipe(Config.withDefault(250));
	const line = (o: object) => Console.log(JSON.stringify({host: holder, at: Date.now(), ...o}));
	const listen = (name: string) => (e: HostEvent) => Effect.runSync(line({name, ...e}));
	const timing = {ttlMs, renewEveryMs, retryMs: 50};
	const names = namesOf(size);
	const stub = agent(size, (o) => Effect.runSync(line(o)));

	for (const name of names.supervisors)
		yield* serve({
			name,
			holder,
			program: supervisorProgram(size, name),
			listen: listen(name),
			...timing,
		});
	for (const name of names.agents)
		yield* serve({name, holder, program: stub, listen: listen(name), ...timing});
	yield* line({ev: "started", pid: process.pid});
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
