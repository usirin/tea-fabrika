// One host process of experiment 104: `serve` for one stage's registered name and its agent child.
// The harness starts several of these, one after another or side by side; whichever holds a name's
// lease runs its program. Each prints one JSON line per event, written synchronously, so a line
// said just before a planted SIGKILL is not lost in a pipe.
//
// Config (env):
//   LEDGER_URL, LEDGER_NAME   the Miniflare ledger
//   HOST                      this host's name, unique per process start
//   FAKE_URL, REMOTE          the fake code host, and this run's bare repository
//   STAGE, NAME               ship|review|plan|build, and the stage's registered name
//   WORK                      this host's folder for working copies (a fresh one per process)
//   FAULT, FAULT_ACT          a fault point (`agent-turn`, `after-send:push`, ...) and kill|stop
//   PLANT                     none | no_lease_check | unkeyed
//   TTL_MS                    the lease's length
// Node only at this edge: the runtime, writeSync to stdout, and the signal a fault sends itself.
import {writeSync} from "node:fs";
import {NodeRuntime} from "@effect/platform-node";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Config, Effect, Layer} from "effect";
import {type HostEvent, serve} from "../../packages/fabrika/src/host/host.ts";
import {layerHttp} from "../../packages/fabrika/src/host/http.ts";
import {type AgentNote, agentOf, agentProgram} from "../../packages/pipeline/src/hosted/agent.ts";
import {BuildWork, buildTurn, hostedBuild} from "../../packages/pipeline/src/hosted/build.ts";
import {Faults} from "../../packages/pipeline/src/hosted/idempotency.ts";
import {hostedPlan, planTurn} from "../../packages/pipeline/src/hosted/plan.ts";
import {hostedReview, reviewTurn} from "../../packages/pipeline/src/hosted/review.ts";
import {hostedShip} from "../../packages/pipeline/src/hosted/ship.ts";
import {hostedStage, type StageNote} from "../../packages/pipeline/src/hosted/stage.ts";
import {realBuild, realOutside, realPlan, realReview} from "./real.ts";
import {
	buildReads,
	fakeOutside,
	planReads,
	rawWrite,
	reviewCodeHost,
	scriptedBuild,
	scriptedPlan,
	scriptedReview,
	shipCodeHost,
	shipRecord,
} from "./world.ts";

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
const child = <R>(turn: Parameters<typeof agentProgram<R>>[0]["turn"]) =>
	agentProgram({turn, hold: HOLD, say: agentSay, turnFaultMs: TURN_FAULT_MS});

const main = Effect.gen(function* () {
	const stage = env("STAGE");
	const name = env("NAME");
	const fake = env("FAKE_URL");
	const plant = env("PLANT", "none");
	const ttlMs = Number(env("TTL_MS", "1000"));
	const planted = plant === "no_lease_check" ? {planted: "no_lease_check" as const} : {};
	const timing = {ttlMs, renewEveryMs: Math.round(ttlMs / 4)};
	const both = <A, B>(program: A, agent: B) => ({program, agent});

	const programs =
		stage === "ship"
			? both(hostedStage(hostedShip, stageSay, planted), null)
			: stage === "review"
				? both(
						hostedStage(
							plant === "unkeyed"
								? {
										...hostedReview,
										// The planted mistake: a comment sent straight to the code host, with no key.
										finish: (end, job, n) =>
											rawWrite(fake, "comment", {pr: job.pr, body: "posted with no key"}).pipe(
												Effect.orDie,
												Effect.andThen(hostedReview.finish(end, job, n)),
											),
									}
								: hostedReview,
							stageSay,
							planted,
						),
						child(reviewTurn(AGENT)),
					)
				: stage === "plan"
					? both(hostedStage(hostedPlan, stageSay, planted), child(planTurn(AGENT)))
					: both(hostedStage(hostedBuild, stageSay, planted), child(buildTurn(AGENT)));

	yield* serve({name, holder: HOST, program: programs.program, listen: listen(name), ...timing});
	if (programs.agent !== null)
		yield* serve({
			name: agentOf(name),
			holder: HOST,
			program: programs.agent,
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
		const stage = env("STAGE");
		const scripted =
			stage === "ship"
				? Layer.mergeAll(shipCodeHost(fake), shipRecord)
				: stage === "review"
					? Layer.mergeAll(reviewCodeHost, scriptedReview)
					: stage === "plan"
						? Layer.mergeAll(planReads, scriptedPlan)
						: Layer.mergeAll(buildReads, scriptedBuild.pipe(Layer.provide(nodeServices)), work);
		const real =
			stage === "review"
				? realReview(env("CLONE"))
				: stage === "plan"
					? realPlan(env("CLONE"))
					: realBuild(env("WORK"), ledger);
		const world = REAL
			? Layer.mergeAll(realOutside(), real.pipe(Layer.provide(nodeServices)))
			: Layer.mergeAll(fakeOutside(fake, env("REMOTE")), scripted);
		return yield* main.pipe(Effect.provide(Layer.mergeAll(ledger, faults, world, nodeServices)));
	}),
);
