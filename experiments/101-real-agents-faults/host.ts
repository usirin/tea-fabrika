// One host for experiment 101: `serve` from the package, for either program. Experiment 98's
// agents host (../98-tea-host-package/agents-host.ts) with the real answerer:
//
//   PROGRAM=asker      asks TOTAL questions of answerer:1 (98's asker, on the Mac)
//   PROGRAM=answerer   answers them with Claude Code (./answerer.ts, in a container)
//
// Config (env): LEDGER_URL, LEDGER_NAME, HOST, PROGRAM, TTL_MS, RENEW_MS, RETRY_MS. Asker: TOTAL,
// WINDOW, TIMEOUT_MS. Answerer: MODE (fresh|resume), MODEL (haiku), CRASH_AFTER, MARKS. One JSON
// line per event on stdout.
import {NodeRuntime} from "@effect/platform-node";
import {type HostEvent, serve} from "@kampus/fabrika-old";
import {layerHttp} from "@kampus/fabrika-old/http";
import {Config, Console, Duration, Effect} from "effect";
import {askerProgram} from "../98-tea-host-package/asker.ts";
import {answererProgram} from "./answerer.ts";

const main = Effect.gen(function* () {
	const program = yield* Config.Literals(["asker", "answerer"], "PROGRAM");
	const holder = `${yield* Config.String("HOST")}@${Date.now().toString(36)}`;
	const name = `${program}:1`;
	const ttlMs = yield* Config.Number("TTL_MS").pipe(Config.withDefault(1000));
	const renewEveryMs = yield* Config.Number("RENEW_MS").pipe(Config.withDefault(250));
	const retryMs = yield* Config.Number("RETRY_MS").pipe(Config.withDefault(50));
	const line = (o: object) => Console.log(JSON.stringify({host: holder, at: Date.now(), ...o}));
	const listen = (e: HostEvent) => Effect.runSync(line(e));
	const common = {name, holder, ttlMs, renewEveryMs, retryMs, listen};
	if (program === "asker")
		yield* serve({
			...common,
			program: askerProgram(
				{
					total: yield* Config.Number("TOTAL").pipe(Config.withDefault(30)),
					window: yield* Config.Number("WINDOW").pipe(Config.withDefault(3)),
					timeoutMs: yield* Config.Number("TIMEOUT_MS").pipe(Config.withDefault(90_000)),
					retryMs: 200,
				},
				"answerer:1",
				line,
			),
		});
	else {
		const crashAfter = yield* Config.String("CRASH_AFTER").pipe(Config.withDefault(""));
		const marks = yield* Config.String("MARKS").pipe(Config.withDefault(""));
		yield* serve({
			...common,
			program: answererProgram(
				{
					mode: yield* Config.Literals(["fresh", "resume"], "MODE"),
					model: yield* Config.String("MODEL").pipe(Config.withDefault("haiku")),
					crashAfter: crashAfter === "" ? null : crashAfter,
					marks: marks === "" ? null : marks,
				},
				line,
			),
		});
	}
	yield* line({ev: "started", pid: process.pid, program});
	// 94's pause detector: says how long the process was frozen (here: `docker pause`).
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
