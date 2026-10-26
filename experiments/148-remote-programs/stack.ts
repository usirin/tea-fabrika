// Experiment 148's one stack, two stages (docs/direction/local-is-the-cloud.md), made by a
// function so the driver can deploy it from code (experiment 147) and the CLI can load it too:
//
//   alchemy dev stack.run.ts --stage local              workerd and Docker on the laptop, no account
//   deploy({stack: stackOf({boxes, secrets}), stage: "cloud"})     Cloudflare, from the driver's live part
//
// The same Worker (dist/worker.mjs, from build.ts), the same four Durable Objects and the same
// job image in both. What differs is read from config, never written here:
//
//   UPSTREAM   local: the stand-in model on the laptop      cloud: https://api.anthropic.com
//   KEY_SEAL   local: made up per run by the driver         cloud: a Worker secret, set once
//   SESSIONS   local: the stand-in door's made-up sessions  cloud: replaced by PR 92's door
//   BOX_SIZE   local: the size in numbers, given at start   cloud: the application's "basic"
//
// No `Alchemy.remote()`: nothing here reaches Cloudflare from the local stage.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import type {SecretProviders} from "alchemy/Stack";
import {Config, Effect} from "effect";

export interface StackInputs {
	/** With the job box. Without, a box job answers "the box did not start" (the live round's token may not use Containers). */
	readonly boxes: boolean;
	/** Where the credentials and config come from, in code. None: the process environment, as the CLI. */
	readonly secrets?: SecretProviders;
}

export const stackOf = (inputs: StackInputs) =>
	Alchemy.Stack(
		"tf-exp-148",
		{
			providers: Cloudflare.providers(),
			state: Alchemy.localState(),
			...(inputs.secrets === undefined ? {} : {secrets: inputs.secrets}),
		},
		Effect.gen(function* () {
			const stage = yield* Alchemy.Stage;
			const cloud = stage === "cloud";
			/** The box a job runs in: one per job, started by the job's own Durable Object. */
			const Job = Cloudflare.Container("Job", {
				schedulingPolicy: "durable_object",
				context: `${import.meta.dirname}/box`,
				// 1/4 vCPU and 1 GiB. Local workerd refuses the name at start, so there the size goes
				// in numbers, at start (BOX_SIZE).
				...(cloud ? {instanceType: "basic" as const} : {}),
			});
			const upstream = cloud ? "https://api.anthropic.com" : yield* Config.String("UPSTREAM");
			const worker = yield* Cloudflare.Worker("tf-exp-148", {
				main: `${import.meta.dirname}/dist/worker.mjs`,
				compatibility: {date: "2026-10-01"},
				// Alchemy turns Workers Logs on by default (experiment 144). Off.
				observability: {enabled: false},
				env: {
					HOSTS: Cloudflare.DurableObject("ProjectHost"),
					JOBS: inputs.boxes
						? Cloudflare.DurableObject("JobBox", {containers: [Job]})
						: Cloudflare.DurableObject("JobBox"),
					PEOPLE: Cloudflare.DurableObject("Person"),
					LEDGER: Cloudflare.DurableObject("Ledger"),
					KEY_SEAL: yield* Config.Redacted("KEY_SEAL"),
					SESSIONS: yield* Config.Redacted("SESSIONS"),
					UPSTREAM: upstream,
					BOX_SIZE: cloud ? "" : JSON.stringify({vcpu: 0.25, memoryMib: 1024, diskMb: 4000}),
					JOB_TIMEOUT_MS: "600000",
					JOB_CALLS: "50",
				},
			});
			return {url: worker.url};
		}),
	);
