// One host process of experiment 111: `serve` for one sort's registered name and its agent child.
// The harness starts several of these, one after another or side by side; whichever holds a name's
// lease runs its program. Each prints one JSON line per event, written synchronously, so a line
// said just before a planted SIGKILL is not lost in a pipe. As 104's host.
//
// Config (env):
//   LEDGER_URL, LEDGER_NAME   the Miniflare ledger
//   HOST                      this host's name, unique per process start
//   FAKE_URL                  the fake issue host
//   NAME                      the sort's registered name, `sort:<n>`
//   FAULT, FAULT_ACT          a fault point (`agent-turn`, `after-send:close`, ...) and kill|stop
//   PLANT                     none | no_lease_check | unkeyed
//   TTL_MS                    the lease's length
//   AGENT=real                haiku on GitHub, on the sandbox only (HOLD_USD, TURN_FAULT_MS)
// Node only at this edge: the runtime, writeSync to stdout, and the signal a fault sends itself.
import {writeSync} from "node:fs";
import {NodeRuntime} from "@effect/platform-node";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Config, Effect, Layer} from "effect";
import {type HostEvent, serve} from "../../packages/fabrika/src/host/host.ts";
import {layerHttp} from "../../packages/fabrika/src/host/http.ts";
import {
	type AgentNote,
	agentOf,
	agentProgram,
} from "../../packages/fabrika/src/pipeline/hosted/agent.ts";
import {Faults} from "../../packages/fabrika/src/pipeline/hosted/idempotency.ts";
import {gitHubIssues} from "../../packages/fabrika/src/pipeline/hosted/issues.ts";
import {hostedSort, sortTurn} from "../../packages/fabrika/src/pipeline/hosted/sort.ts";
import {hostedStage, type StageNote} from "../../packages/fabrika/src/pipeline/hosted/stage.ts";
import {sh} from "../../packages/fabrika/src/pipeline/sh.ts";
import {
	githubSortHost,
	ledgerPlans,
} from "../../packages/fabrika/src/pipeline/stages/sort/services.ts";
import {liveSorter} from "../../packages/fabrika/src/pipeline/stages/sort/sorter.ts";
import {SANDBOX} from "../104-stages-on-tea-host/real.ts";
import {fakeIssues, fakeSortHost, rawWrite, scriptedSorter} from "./world.ts";

const env = (k: string, d = "") => process.env[k] ?? d;
const HOST = env("HOST");
const line = (o: object) => {
	writeSync(1, `${JSON.stringify({host: HOST, at: Date.now(), ...o})}\n`);
};

const FAULT = env("FAULT");
const ACT = env("FAULT_ACT", "kill");
let hit = false;
/** The planted fault: the first time `FAULT` is passed, this process kills or stops itself. */
const faults = Layer.succeed(Faults, {
	at: (point) =>
		Effect.sync(() => {
			if (hit || point !== FAULT) return;
			hit = true;
			line({ev: "fault", point, act: ACT});
			// The whole group: a real agent's `claude` process dies or stops with its host.
			process.kill(-process.pid, ACT === "stop" ? "SIGSTOP" : "SIGKILL");
			line({ev: "woke", point});
		}),
});

const stageSay = (n: StageNote) => line(n);
const agentSay = (n: AgentNote) => line(n);
const listen = (name: string) => (e: HostEvent) => {
	if (
		process.env.DEBUG === "1" ||
		e.ev === "claim" ||
		e.ev === "program" ||
		e.ev === "lease_end" ||
		e.ev === "tea_error"
	)
		line({name, ...e});
};
const REAL = env("AGENT") === "real";
const AGENT = REAL ? ("real" as const) : ("stub" as const);
/** A turn's upper bound, held before it starts: a real turn's is its SDK budget. */
const HOLD = {usd: Number(env("HOLD_USD", "0.02"))};
const TURN_FAULT_MS = Number(env("TURN_FAULT_MS", "100"));

const main = Effect.gen(function* () {
	const name = env("NAME");
	const fake = env("FAKE_URL");
	const plant = env("PLANT", "none");
	const ttlMs = Number(env("TTL_MS", "1000"));
	const planted = plant === "no_lease_check" ? {planted: "no_lease_check" as const} : {};
	const timing = {ttlMs, renewEveryMs: Math.round(ttlMs / 4)};
	const stage =
		plant === "unkeyed"
			? {
					...hostedSort,
					// The planted mistake: a comment sent straight to the issue host, with no key.
					finish: (
						end: Parameters<typeof hostedSort.finish>[0],
						job: Parameters<typeof hostedSort.finish>[1],
						n: string,
					) =>
						rawWrite(fake, "comment", {issue: job.ticket, body: "posted with no key"}).pipe(
							Effect.orDie,
							Effect.andThen(hostedSort.finish(end, job, n)),
						),
				}
			: hostedSort;
	const program = hostedStage(stage, stageSay, planted);
	const agent = agentProgram({
		turn: sortTurn(AGENT),
		hold: HOLD,
		say: agentSay,
		turnFaultMs: TURN_FAULT_MS,
	});
	yield* serve({name, holder: HOST, program, listen: listen(name), ...timing});
	yield* serve({
		name: agentOf(name),
		holder: HOST,
		program: agent,
		listen: listen(agentOf(name)),
		...timing,
	});
	line({ev: "started", pid: process.pid});
	return yield* Effect.never;
}).pipe(Effect.scoped);

NodeRuntime.runMain(
	Effect.gen(function* () {
		const ledger = layerHttp({
			url: yield* Config.String("LEDGER_URL"),
			ledger: yield* Config.String("LEDGER_NAME"),
		});
		const fake = env("FAKE_URL");
		const world = REAL
			? Layer.mergeAll(
					gitHubIssues([SANDBOX]),
					githubSortHost((args) => sh("gh", args)),
					liveSorter().pipe(Layer.provide(nodeServices)),
				)
			: Layer.mergeAll(fakeIssues(fake), fakeSortHost(fake), scriptedSorter);
		const plans = ledgerPlans.pipe(Layer.provide(ledger));
		return yield* main.pipe(
			Effect.provide(Layer.mergeAll(ledger, plans, faults, world, nodeServices)),
		);
	}),
);
