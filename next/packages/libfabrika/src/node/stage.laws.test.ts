// P12, next/. Real stage, durable outbox and recording; only platform calls are supplied.
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {RuntimeLifecycle, type RuntimeEvent} from "@alchemy.run/cloudflare-runtime/core/Runtime";
import {NodeServices} from "@effect/platform-node";
import {Cause, Context, Effect, Exit, Schema} from "effect";
import {TestClock} from "effect/testing";
import * as fc from "fast-check";
import {expect, it, vi} from "vitest";
import type {BrainFact} from "../app/brain-fact.ts";
import {ProcessIdGenerator} from "../coordination/process-id.ts";
import {brainOutbox} from "./local-stage.ts";
import {startStage} from "./stage.ts";

const platform = vi.hoisted(() => ({rss: 0, samples: 0}));
vi.mock("node:child_process", async (original) => ({
	...(await original<typeof import("node:child_process")>()),
	execFile: (...args: Array<unknown>) => {
		const callback = args.at(-1) as (error: null, stdout: string) => void;
		platform.samples++;
		callback(null, String(platform.rss));
		return {kill: () => true};
	},
}));
const step = fc.record({
	// A crash has no RSS; a memory kill carries the measured bytes, including the cap.
	rss: fc.option(fc.integer({min: 488_282, max: 900_000}), {nil: null}),
	exitCode: fc.option(fc.integer({min: 0, max: 255}), {nil: null}),
	signal: fc.option(fc.constantFrom<NodeJS.Signals | number>("SIGTERM", "SIGKILL", 15), {
		nil: null,
	}),
	delay: fc.integer({min: 0, max: 10_000}),
});

it("the control plugin returns a typed error for malformed platform port data", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.jsonValue().filter((raw) => !Schema.is(Schema.Int)(raw)),
			async (raw) => {
				const home = mkdtempSync(join(tmpdir(), "p12-port-"));
				vi.stubEnv("FABRIKA_HOME", home);
				try {
					const exit = await Effect.runPromiseExit(
						Effect.scoped(
							startStage({name: "port-test", port: 18787, build: "test", home}, (local) =>
								Effect.suspend(() => {
									const plugin = [...local.mapUnsafe.values()].find(
										(value) => typeof value === "object" && value !== null && "sockets" in value,
									) as {start: (ports: Record<string, unknown>) => Effect.Effect<unknown>};
									return plugin.start({"fabrika-control": raw});
								}),
							),
						).pipe(Effect.provide(ProcessIdGenerator.layer), Effect.provide(NodeServices.layer)),
					);
					expect(Exit.isFailure(exit)).toBe(true);
					const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
					expect(Cause.hasDies(cause)).toBe(false);
					expect(Cause.hasFails(cause)).toBe(true);
					// Alchemy beta.84's PluginConfig.start fails with RuntimeError. A bad
					// platform port is its SystemError case, not our private ControlError.
					expect(Cause.findErrorOption(cause)).toMatchObject({
						_tag: "Some",
						value: {_tag: "SystemError", subtag: "control_port"},
					});
				} finally {
					vi.unstubAllEnvs();
					rmSync(home, {recursive: true, force: true});
				}
			},
		),
		{seed: 119120, numRuns: 20, examples: [[null], [{}], [1.5]]},
	);
});
type Step = ReturnType<typeof step.generate>["value"];
const memoryBrake: Step = {rss: 600_000, exitCode: null, signal: "SIGTERM", delay: 250};
const crashBrake: Step = {rss: null, exitCode: 1, signal: null, delay: 0};
const sequence = fc.record({
	restarts: fc.array(step, {maxLength: 4}),
	final: step,
	why: fc.constantFrom<"intensity" | "restart_failed">("intensity", "restart_failed"),
});

it("every observed exit is durable once across restart or brake, with its reason and RSS", async ({
	signal,
}) => {
	await fc.assert(
		fc.asyncProperty(sequence, async ({restarts, final, why}) => {
			const home = mkdtempSync(join(tmpdir(), "p12-exit-"));
			vi.stubEnv("FABRIKA_HOME", home);
			const kill = vi.spyOn(process, "kill").mockReturnValue(true);
			const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
				const call = JSON.parse(String(options?.body)) as {method: string};
				// Keep lifecycle facts in the real outbox while the real record sink still flushes.
				return Response.json(
					call.method === "brain" ? {error: {why: "offline"}} : {value: {_tag: "written"}},
				);
			});
			try {
				await Effect.runPromise(
					Effect.scoped(
						Effect.gen(function* () {
							let observe: (event: RuntimeEvent) => void = () => {};
							platform.rss = 0;
							// The first info call succeeds. Startup flush has no facts until deployment yields.
							fetch.mockImplementation(async (_url, options) => {
								const call = JSON.parse(String(options?.body)) as {method: string};
								return Response.json({value: call.method === "write" ? {_tag: "written"} : null});
							});
							yield* startStage({name: "life-test", port: 18787, build: "test", home}, (local) =>
								Effect.gen(function* () {
									observe = Context.get(local, RuntimeLifecycle);
									const plugin = [...local.mapUnsafe.values()].find(
										(value) => typeof value === "object" && value !== null && "sockets" in value,
									) as {start: (ports: Record<string, number>) => Effect.Effect<unknown>};
									observe({type: "start", worker: "life-test", pid: 27001});
									yield* plugin.start({"fabrika-control": 27002});
								}),
							);
							fetch.mockImplementation(async (_url, options) => {
								const call = JSON.parse(String(options?.body)) as {method: string};
								return Response.json(
									call.method === "brain" ? {error: {why: "offline"}} : {value: {_tag: "written"}},
								);
							});
							const outbox = yield* brainOutbox(home);
							const waitForFact = (ready: (fact: typeof BrainFact.Type) => boolean) =>
								Effect.gen(function* () {
									// The event queue writes files asynchronously, outside the supplied clock.
									// The enclosing test's abort signal bounds this wait.
									for (;;) {
										const rows = yield* outbox.pending;
										if (rows.some(ready)) return rows;
										yield* TestClock.withLive(Effect.sleep("10 millis"));
									}
								});
							const expected: Array<{
								start: string;
								why: string;
								exitCode: number | null;
								signal: string | null;
								bytes?: number;
							}> = [];
							const assertExits = Effect.gen(function* () {
								const rows = yield* outbox.pending;
								const exits = rows.filter((fact) => fact._tag === "exited");
								expect(exits).toHaveLength(expected.length);
								expect(new Set(exits.map((fact) => fact.id)).size).toBe(expected.length);
								expect(
									exits.map(({start, why, exitCode, signal, bytes}) => ({
										start,
										why,
										exitCode,
										signal,
										...(bytes === undefined ? {} : {bytes}),
									})),
								).toEqual(expected);
							});
							for (const [index, item] of [...restarts, final].entries()) {
								// Run the real memory sampler and replacement request on a supplied clock.
								platform.rss = item.rss ?? 0;
								const samples = platform.samples;
								for (;;) {
									yield* TestClock.adjust("1 second");
									if (platform.samples > samples) break;
									// The previous sample's file flush must finish before it sleeps again.
									yield* TestClock.withLive(Effect.sleep("10 millis"));
								}
								if (item.rss !== null) expect(kill).toHaveBeenCalledWith(27001 + index, "SIGTERM");
								const rows = yield* outbox.pending;
								// Startup may already be acknowledged; last remains durable in either case.
								const start =
									rows.filter((fact) => fact._tag === "started").at(-1)?.start ??
									(yield* outbox.last)!;
								const exit = {exitCode: item.exitCode, signal: item.signal, stderr: ""};
								expected.push({
									start,
									exitCode: item.exitCode,
									signal: item.signal === null ? null : String(item.signal),
									why: item.rss === null ? "crash" : "memory",
									...(item.rss === null ? {} : {bytes: item.rss * 1024}),
								});
								observe({type: "exit", worker: "life-test", exit});
								if (index < restarts.length) {
									observe({type: "restart", worker: "life-test", exit, delay: item.delay});
									yield* waitForFact((fact) => fact._tag === "restarting" && fact.start === start);
									yield* assertExits;
									observe({type: "start", worker: "life-test", pid: 27002 + index});
									yield* waitForFact((fact) => fact._tag === "started" && fact.after === start);
								} else {
									observe({type: "stop", worker: "life-test", exit, why});
									const pending = yield* waitForFact(
										(fact) => fact._tag === "braked" && fact.start === start,
									);
									expect(pending.filter((fact) => fact._tag === "braked")).toMatchObject([
										{start, why, exitCode: exit.exitCode, signal: expected.at(-1)!.signal},
									]);
									// Review 5: HEAD keeps braked but loses the final exited fact and its RSS.
									yield* assertExits;
								}
							}
							const memoryPids = [...restarts, final].flatMap((item, i) =>
								item.rss === null ? [] : [27001 + i],
							);
							expect(kill.mock.calls).toEqual(memoryPids.map((pid) => [pid, "SIGTERM"]));
						}),
					).pipe(
						Effect.provide(ProcessIdGenerator.layer),
						Effect.provide(NodeServices.layer),
						Effect.provide(TestClock.layer()),
					),
					{signal},
				);
			} finally {
				fetch.mockRestore();
				kill.mockRestore();
				vi.unstubAllEnvs();
				rmSync(home, {recursive: true, force: true});
			}
		}),
		{
			seed: 119120,
			numRuns: 20,
			examples: [
				// Review 5: final memory kill, no replacement to carry the RSS.
				[{restarts: [], final: memoryBrake, why: "intensity"}],
				[{restarts: [memoryBrake, crashBrake], final: crashBrake, why: "restart_failed"}],
				// Review 5: a pending start write resets the next memory kill's reason and RSS.
				[{restarts: [crashBrake], final: memoryBrake, why: "intensity"}],
			],
		},
	);
});
