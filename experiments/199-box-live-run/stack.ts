// Experiment 199's stack: 148's shape cut to one object and its box. Deployed from code by the
// driver (experiments 147 and 148), stage "cloud" only. No `Alchemy.remote()`.
//
//   RUNS     the BoxRun Durable Object, which owns the container application "Run"
//   SESSION  the driver's made-up session for the door, made per run
//   BOX_SIZE standard-4's size in numbers, given at start (Alchemy refuses a size on an application
//            owned by a Durable Object, 148)
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import type {SecretProviders} from "alchemy/Stack";
import {Config, Effect} from "effect";

export const PREFIX = "tf-exp-199";

/** standard-4: 4 vCPU, 12 GiB, 20 GB of disk (Cloudflare's limits page, read 2026-11-02). */
export const STANDARD_4 = {vcpu: 4, memoryMib: 12 * 1024, diskMb: 20_000};

/** The box is destroyed after this long, whatever it is doing: the run's 45-minute cap. */
export const RUN_CAP_MS = 45 * 60_000;

export const stackOf = (secrets: SecretProviders) =>
	Alchemy.Stack(
		PREFIX,
		{providers: Cloudflare.providers(), state: Alchemy.localState(), secrets},
		Effect.gen(function* () {
			const Run = Cloudflare.Container("Run", {
				schedulingPolicy: "durable_object",
				context: `${import.meta.dirname}/box`,
			});
			const worker = yield* Cloudflare.Worker(PREFIX, {
				main: `${import.meta.dirname}/dist/worker.mjs`,
				compatibility: {date: "2026-10-01"},
				// Alchemy turns Workers Logs on by default (experiment 144). Off.
				observability: {enabled: false},
				env: {
					RUNS: Cloudflare.DurableObject("BoxRun", {containers: [Run]}),
					SESSION: yield* Config.Redacted("SESSION"),
					BOX_SIZE: JSON.stringify(STANDARD_4),
					RUN_CAP_MS: String(RUN_CAP_MS),
				},
			});
			return {url: worker.url};
		}),
	);
