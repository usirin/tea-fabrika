// One host process of experiment 105. It serves the sorts it is told (`SORTS`), and, told a plan
// (`DELIVER`), delivers it: the lane and every child the lane names, each with its agent
// (packages/pipeline/src/hosted/deliver.ts, the code `tsh deliver` runs). The harness
// starts several of these, one after another or side by side; whichever holds a name's lease runs
// it. Each prints one JSON line per event, written synchronously, so a line said just before a
// planted SIGKILL is not lost in a pipe. As 104's and 111's hosts.
//
// Config (env):
//   LEDGER_URL, LEDGER_NAME   the Miniflare ledger
//   HOST                      this host's name, unique per process start
//   FAKE_URL, REMOTE          the fake GitHub, and this run's bare repository
//   WORK                      this host's folder for working copies (a fresh one per process)
//   SORTS                     a comma list of sort names to serve (`sort:707,sort:711`)
//   DELIVER                   a plan's number, or empty
//   SCENARIO                  A | B | C: how the scripted agents bend (./world.ts)
//   FAULT, FAULT_NAME         a fault point (`agent-turn`, `after-send:push`, ...) and the one name
//                             it is planted on; FAULT_ACT kill|stop
//   TTL_MS                    the lease's length
//   AGENTS_FROM               a folder whose fabrika.toml picks each agent step's own model,
//                             effort and budget (`[agents.<step>]`, experiment 105b)
// Node only at this edge: the runtime, writeSync to stdout, and the signal a fault sends itself.
import {writeSync} from "node:fs";
import {NodeRuntime} from "@effect/platform-node";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Config, Effect, Layer} from "effect";
import {type HostEvent, serve} from "../../packages/fabrika/src/host/host.ts";
import {layerHttp} from "../../packages/fabrika/src/host/http.ts";
import {ledgerRecord} from "../../packages/pipeline/src/criteria/record.ts";
import {agentOf, agentProgram} from "../../packages/pipeline/src/hosted/agent.ts";
import {BuildWork} from "../../packages/pipeline/src/hosted/build.ts";
import {deliver, type Hosting} from "../../packages/pipeline/src/hosted/deliver.ts";
import {Faults} from "../../packages/pipeline/src/hosted/idempotency.ts";
import {hostedSort, sortTurn} from "../../packages/pipeline/src/hosted/sort.ts";
import {hostedStage} from "../../packages/pipeline/src/hosted/stage.ts";
import {planOf, ticketId} from "../../packages/pipeline/src/ids.ts";
import type {AgentStep} from "../../packages/pipeline/src/settings.ts";
import {loadSettings} from "../../packages/pipeline/src/settings-source.ts";
import {setupLines, setupOf} from "../../packages/pipeline/src/setup.ts";
import type {LaneJob} from "../../packages/pipeline/src/stages/lane/machine.ts";
import {RUBRICS} from "../../packages/pipeline/src/stages/review/scripted.ts";
import {ledgerPlans} from "../../packages/pipeline/src/stages/sort/services.ts";
import {fakeOutside} from "../104-stages-on-tea-host/world.ts";
import {fakeIssues, fakeSortHost} from "../111-sort-on-tea-host/world.ts";
import {REPO} from "./fake.ts";
import {realAgents} from "./real.ts";
import {
	fakePlanReads,
	localChecks,
	scriptedBuilder,
	scriptedPlanner,
	scriptedReview,
	scriptedSorter,
	shipCodeHost,
} from "./world.ts";

const env = (k: string, d = "") => process.env[k] ?? d;
const HOST = env("HOST");
const line = (o: object) => {
	writeSync(1, `${JSON.stringify({host: HOST, at: Date.now(), ...o})}\n`);
};

const FAULT = env("FAULT");
const FAULT_NAME = env("FAULT_NAME");
const ACT = env("FAULT_ACT", "kill");
let hit = false;
/** The planted fault, on one name only: the first time it is passed there, this process kills or stops itself. */
const faultsFor = (name: string): Faults["Service"] => ({
	at: (point) =>
		Effect.sync(() => {
			if (hit || point !== FAULT || name !== FAULT_NAME) return;
			hit = true;
			line({ev: "fault", name, point, act: ACT});
			// The whole group: a real agent's `claude` process dies or stops with its host.
			process.kill(-process.pid, ACT === "stop" ? "SIGSTOP" : "SIGKILL");
			line({ev: "woke", name, point});
		}),
});

const listen = (name: string) => (e: HostEvent) => {
	if (
		process.env.DEBUG === "1" ||
		e.ev === "claim" ||
		// Who held which name: the harness's one-holder law reads it, so it is never a debug line.
		e.ev === "phase" ||
		e.ev === "program" ||
		e.ev === "lease_end" ||
		e.ev === "tea_error"
	)
		line({name, ...e});
};
const REAL = env("AGENT") === "real";
const TTL_MS = Number(env("TTL_MS", "1000"));
const hosting: Hosting = {
	holder: HOST,
	ttlMs: TTL_MS,
	agent: REAL ? "real" : "stub",
	hold: {usd: Number(env("HOLD_USD", "0.02"))},
	turnFaultMs: Number(env("TURN_FAULT_MS", "100")),
	say: line,
	listen,
	faults: faultsFor,
};
/** Every agent's settings; `BUDGET`: one run's dollars, which a real pass sets low. */
const SETTINGS = {model: "haiku", effort: "low", budget: Number(env("BUDGET", "1"))} as const;
/**
 * Each agent step's own settings, picked as tsh picks them (packages/pipeline/src/setup.ts):
 * the fabrika.toml in the folder `AGENTS_FROM` names, over `SETTINGS` as this machine's tsh.toml
 * fallback. No folder: every step on `SETTINGS`, as before 105b.
 */
const agentsOf = Effect.gen(function* () {
	const folder = env("AGENTS_FROM");
	if (folder === "") return null;
	const {settings, holds} = yield* loadSettings({from: "folder", folder});
	const local = {...SETTINGS, rubrics: null};
	const setup = setupOf(settings, holds, local, {shipped: RUBRICS, repo: RUBRICS});
	for (const said of setupLines(setup, holds, settings))
		if (said.startsWith("agents.")) line({ev: "setup", said});
	const of = (step: AgentStep) => ({
		model: setup.agents[step].model.value,
		effort: setup.agents[step].effort.value,
		budget: setup.agents[step].budget.value,
	});
	return {plan: of("plan"), build: of("build"), review: of("review")};
});
/** The lane's job: the same on every host, so two hosts that cast it cast one. */
const jobOf = (
	plan: ReturnType<typeof planOf>,
	agents: Effect.Success<typeof agentsOf>,
): LaneJob => ({
	plan,
	settings: SETTINGS,
	...(agents === null ? {} : {agents}),
	usd: Number(env("KID_USD", "5")),
	rubrics: RUBRICS,
	at: 1_800_000_000,
});

const main = Effect.gen(function* () {
	const timing = {ttlMs: TTL_MS, renewEveryMs: Math.round(TTL_MS / 4)};
	for (const name of env("SORTS")
		.split(",")
		.filter((n) => n !== "")) {
		yield* serve({
			name,
			holder: HOST,
			program: hostedStage(hostedSort, line),
			listen: listen(name),
			...timing,
		}).pipe(Effect.provideService(Faults, faultsFor(name)));
		yield* serve({
			name: agentOf(name),
			holder: HOST,
			program: agentProgram({
				turn: sortTurn(hosting.agent),
				hold: hosting.hold,
				say: line,
				turnFaultMs: hosting.turnFaultMs ?? 100,
			}),
			listen: listen(agentOf(name)),
			...timing,
		}).pipe(Effect.provideService(Faults, faultsFor(agentOf(name))));
	}
	line({ev: "started", pid: process.pid});
	const plan = env("DELIVER");
	if (plan !== "") {
		const id = planOf(ticketId(`${REPO}#${plan}`));
		const outcome = yield* deliver(id, jobOf(id, yield* agentsOf), hosting);
		line({ev: "delivered", plan: id, outcome});
	}
	return yield* Effect.never;
}).pipe(Effect.scoped);

NodeRuntime.runMain(
	Effect.gen(function* () {
		const ledger = layerHttp({
			url: yield* Config.String("LEDGER_URL"),
			ledger: yield* Config.String("LEDGER_NAME"),
		});
		const fake = env("FAKE_URL");
		const work = Layer.succeed(BuildWork, {
			dir: env("WORK"),
			env: {
				PATH: env("PATH"),
				HOME: env("WORK"),
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_TERMINAL_PROMPT: "0",
			},
			install: false,
		});
		const agents = REAL
			? realAgents(env("REMOTE"), env("WORK"))
			: Layer.mergeAll(scriptedSorter, scriptedPlanner, scriptedBuilder, scriptedReview);
		const world = Layer.mergeAll(
			fakeOutside(fake, env("REMOTE")),
			fakeIssues(fake),
			fakeSortHost(fake),
			fakePlanReads(fake),
			agents,
			shipCodeHost(fake),
			localChecks,
			work,
		);
		const onLedger = Layer.mergeAll(ledgerPlans, ledgerRecord).pipe(Layer.provide(ledger));
		return yield* main.pipe(Effect.provide(Layer.mergeAll(ledger, onLedger, world, nodeServices)));
	}),
);
