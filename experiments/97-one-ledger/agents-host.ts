// Experiment 97's port of experiment 95's tea-host (../95-agents-across-hosts/host.ts) onto the
// one ledger: 94's host machine, unchanged, for either program:
//
//   PROGRAM=asker      asks TOTAL questions of answerer:1 (the Mac's host A)
//   PROGRAM=answerer   answers them with AGENT=stub|claude (host B, in a container)
//
// What changed from 95: the lease is on the name itself (`asker:1`, not `registry/asker:1`); the
// claim, renew and registry tail are ./host-cmds.ts, shared with the counter's host; and a program
// reads its inbox by 96's live tail, not by polling the whole log.
//
// Config (env): LEDGER_URL, LEDGER_NAME, HOST (a base name; the process adds its start time, so
// a restarted container is a new holder), PROGRAM, TTL_MS, RENEW_MS, RETRY_MS. Asker: TOTAL,
// WINDOW, TIMEOUT_MS, REAL. Answerer: AGENT, STUB_MS, MODEL. One JSON line per event on stdout.
// Stops on SIGTERM: its scopes close, and the program stops with them.
import {run} from "@demlik/tea/effect";
import {NodeRuntime} from "@effect/platform-node";
import {Config, Console, Duration, Effect, Queue, Stream} from "effect";
import {createHost, type Host, type HostMsg} from "../94-tea-host/host-machine.ts";
import {Agent, claudeAgent, stubAgent} from "../95-agents-across-hosts/agent.ts";
import {serveAnswerer} from "./answerer.ts";
import {serveAsker} from "./asker.ts";
import {hostCmds} from "./host-cmds.ts";
import {Ledger, ledgerLayer, streams} from "./service.ts";
import type {Serving} from "./serving.ts";
import {meter, tail} from "./tail.ts";

const main = Effect.gen(function* () {
	const program = yield* Config.Literals(["asker", "answerer"], "PROGRAM");
	const holder = `${yield* Config.String("HOST")}@${Date.now().toString(36)}`;
	const name = `${program}:1`;
	const base = yield* Config.String("LEDGER_URL");
	const ledgerName = yield* Config.String("LEDGER_NAME").pipe(Config.withDefault("tea-host"));
	const ttlMs = yield* Config.Number("TTL_MS").pipe(Config.withDefault(1000));
	const renewEveryMs = yield* Config.Number("RENEW_MS").pipe(Config.withDefault(250));
	const retryMs = yield* Config.Number("RETRY_MS").pipe(Config.withDefault(50));
	const real = (yield* Config.String("REAL").pipe(Config.withDefault("0"))) === "1";
	const settings = {
		total: yield* Config.Number("TOTAL").pipe(Config.withDefault(200)),
		window: yield* Config.Number("WINDOW").pipe(Config.withDefault(8)),
		timeoutMs: yield* Config.Number("TIMEOUT_MS").pipe(Config.withDefault(1500)),
		retryMs: 200,
		real,
	};
	const agentName = yield* Config.Literals(["stub", "claude"], "AGENT").pipe(
		Config.withDefault("stub" as const),
	);
	const agent =
		agentName === "claude"
			? claudeAgent(yield* Config.String("MODEL").pipe(Config.withDefault("haiku")))
			: stubAgent(yield* Config.Number("STUB_MS").pipe(Config.withDefault(40)));
	const ledger = yield* Ledger;
	const S = streams(name);

	const line = (o: object) => Console.log(JSON.stringify({host: holder, at: Date.now(), ...o}));
	const reads = {registry: meter(), inbox: meter()};

	const {claim, renew, registryTail} = hostCmds({
		ledger,
		name: S.registry,
		holder,
		ttlMs,
		base,
		ledgerName,
		meter: reads.registry,
		line,
	});

	// ------------------------------------------------------------ the program, while owning

	const serve = (fence: number) =>
		Stream.callback<HostMsg>((queue) =>
			Effect.gen(function* () {
				// A failure with no caller: logged, and the host goes on (94's finding).
				const onError = (error: unknown, context: {readonly phase: string}) =>
					Effect.runSync(
						line({
							ev: "tea_error",
							fence,
							phase: context.phase,
							error: error instanceof Error ? error.message : String(error),
						}),
					);
				const o: Serving = {
					ledger,
					name,
					fence,
					holder,
					line,
					onError,
					started: Queue.offer(queue, {type: "program_started", fence}),
					tail: (stream, fromRev) =>
						tail(ledger, {base, name: ledgerName, stream, fromRev, meter: reads.inbox}),
				};
				const ended =
					program === "asker"
						? yield* serveAsker(o, settings, "answerer:1")
						: yield* serveAnswerer(o).pipe(Effect.provideService(Agent, agent));
				yield* line({
					ev: "program",
					phase: "ended",
					fence,
					how: ended.kind,
					why: ended.kind === "failed" ? String(ended.cause).slice(0, 300) : null,
				});
				yield* Queue.offer(queue, {type: "program_ended", fence, how: ended.kind});
				return yield* Effect.never;
			}).pipe(Effect.onInterrupt(() => line({ev: "program", phase: "stopped", fence}))),
		);

	// ------------------------------------------------------------ the machine

	const machine = createHost({renewEveryMs, retryMs});
	const handle = yield* run(machine, {
		ctx: undefined,
		interpret: {claim: () => claim, renew: (cmd) => renew(cmd.fence)},
		subscribe: {
			registry_tail: () => registryTail,
			program: (sub) => serve(sub.deps.fence),
		},
	});
	const host = yield* handle.ready;
	let was: Host = host.getState();
	host.observe((msg, now) => {
		if (now.phase !== was.phase && (now.phase === "owning" || was.phase === "owning"))
			Effect.runSync(
				line({
					ev: "phase",
					from: was.phase,
					to: now.phase,
					fence: now.phase === "owning" ? now.fence : was.phase === "owning" ? was.fence : null,
					by: msg.type,
				}),
			);
		was = now;
	});
	yield* line({ev: "up", pid: process.pid, program, ttlMs, renewEveryMs, agent: agent.name});
	// 94's pause detector: says how long the process was frozen (here: `docker pause`). Decides nothing.
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
	yield* Effect.sleep(Duration.seconds(1)).pipe(
		Effect.andThen(() => line({ev: "reads", ...reads})),
		Effect.forever,
		Effect.forkScoped,
	);
	return yield* Effect.never;
}).pipe(Effect.scoped);

NodeRuntime.runMain(
	Effect.gen(function* () {
		const layer = ledgerLayer(
			yield* Config.String("LEDGER_URL"),
			yield* Config.String("LEDGER_NAME").pipe(Config.withDefault("tea-host")),
		);
		return yield* main.pipe(Effect.provide(layer));
	}),
);
