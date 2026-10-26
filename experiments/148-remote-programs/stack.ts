// Experiment 148's one stack, two stages (docs/direction/local-is-the-cloud.md), made by a
// function so the driver can deploy it from code (experiment 147) and the CLI can load it too:
//
//   alchemy dev stack.run.ts --stage local              workerd and Docker on the laptop, no account
//   deploy({stack: stackOf({boxes, standin, secrets}), stage: "cloud"})   Cloudflare, from the driver
//
// The same Worker (dist/worker.mjs, from build.ts), the same four Durable Objects and the same
// job image in both. What differs is read from config, never written here:
//
//   UPSTREAM   local: the stand-in model on the laptop      cloud: https://api.anthropic.com, or
//                                                           "standin", the Worker's own entrypoint
//   FAKE_KEYS  cloud with the stand-in only: its made-up keys, made per run by the driver
//   KEY_SEAL   local: made up per run by the driver         cloud: a Worker secret, set once
//   SESSIONS   local: the stand-in door's made-up sessions  cloud: replaced by PR 92's door
//   BOX_SIZE   both: the size in numbers, given at start (the application may hold none)
//
// No `Alchemy.remote()`: nothing here reaches Cloudflare from the local stage.
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import type {SecretProviders} from "alchemy/Stack";
import {Config, Effect} from "effect";

export interface StackInputs {
	/** With the job box. Without, a box job answers "the box did not start". */
	readonly boxes: boolean;
	/** On the cloud stage, the model is the Worker's own stand-in entrypoint: no real model, no real key. */
	readonly standin?: boolean;
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
			const standin = cloud && inputs.standin === true;
			/** The box a job runs in: one per job, started by the job's own Durable Object. */
			const Job = Cloudflare.Container("Job", {
				schedulingPolicy: "durable_object",
				context: `${import.meta.dirname}/box`,
				// No size and no name here: under a Durable Object, Alchemy refuses both on the
				// application ("pass per-instance settings to start()"). So the size goes in numbers at
				// start, on both stages (BOX_SIZE). Alchemy names the application, and its image, after
				// the stack, so the cleanup finds them by the run's prefix.
			});
			const upstream = standin
				? "standin"
				: cloud
					? "https://api.anthropic.com"
					: yield* Config.String("UPSTREAM");
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
					...(standin ? {FAKE_KEYS: yield* Config.Redacted("FAKE_KEYS")} : {}),
					UPSTREAM: upstream,
					// "basic"'s size: 1/4 vCPU, 1 GiB, 4 GB of disk.
					BOX_SIZE: JSON.stringify({vcpu: 0.25, memoryMib: 1024, diskMb: 4000}),
					JOB_TIMEOUT_MS: "600000",
					JOB_CALLS: "50",
				},
			});
			return {url: worker.url};
		}),
	);
