import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {RuntimeLifecycle} from "@alchemy.run/cloudflare-runtime/core/Runtime";
import {NodeServices} from "@effect/platform-node";
import {afterEach, expect, it} from "@effect/vitest";
import type {BrainEvent} from "@kampus/libfabrika/brain-event";
import {ProcessIdGenerator} from "@kampus/libfabrika/coordination";
import {Context, Deferred, Effect, Fiber} from "effect";
import {SecureRandom} from "effect/crypto";
import * as fc from "fast-check";
import {vi} from "vitest";

// P12, next/. Exercise startStage twice with one durable home. Only deployment and HTTP are fake.
vi.mock("../alchemy.run.ts", () => ({
	stack: (_built: unknown, _config: unknown, local: Context.Context<never>) => local,
}));
vi.mock("alchemy/Deploy", () => ({
	deploy: ({stack}: {stack: Context.Context<never>}) =>
		Effect.gen(function* () {
			const entries = [...stack.mapUnsafe.values()] as Array<unknown>;
			const plugin = entries.find(
				(entry) => typeof entry === "object" && entry !== null && "sockets" in entry,
			);
			if (typeof plugin !== "object" || plugin === null || !("start" in plugin))
				return yield* Effect.die("test deployment has no control plugin");
			const start = plugin.start as (ports: Record<string, number>) => Effect.Effect<unknown>;
			const observe = Context.get(stack, RuntimeLifecycle);
			observe({type: "start", worker: "fabrika", pid: 27001});
			yield* start({"fabrika-control": 27002});
			// Let the real lifecycle queue consume its start event before the real outbox flush.
			yield* Effect.yieldNow;
		}),
}));

const homes: Array<string> = [];
const home = () => {
	const folder = mkdtempSync(join(tmpdir(), "p12-m-"));
	homes.push(folder);
	return folder;
};
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const folder of homes.splice(0)) rmSync(folder, {recursive: true, force: true});
});

it("a later dev command links its first start to the last runtime in that home", async () => {
	await fc.assert(
		fc.asyncProperty(
			fc.tuple(fc.string({minLength: 1}), fc.string({minLength: 1})),
			async (builds) => {
				const {startStage} = await import("./stage.ts");
				const folder = home();
				vi.stubEnv("FABRIKA_HOME", folder);
				const events: Array<typeof BrainEvent.Type> = [];
				vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
					const call = JSON.parse(String(options?.body)) as {
						method: string;
						args: Array<typeof BrainEvent.Type>;
					};
					if (call.method === "brain") events.push(call.args[0]!);
					return Response.json({value: call.method === "info" ? [] : null});
				});
				const config = {
					home: folder,
					name: "life-contract",
					person: "person-test",
					founder: "public-test-key",
					window: null,
					port: 18787,
				};
				for (const build of builds) {
					await Effect.runPromise(
						Effect.scoped(startStage({build, brain: "unused.mjs", programs: {}}, config)).pipe(
							Effect.provide(ProcessIdGenerator.layer),
							Effect.provide(SecureRandom.layerWebCrypto),
							Effect.provide(NodeServices.layer),
						),
					);
				}
				const starts = events.filter((event) => event._tag === "started");
				expect(starts).toHaveLength(2);
				expect(starts[1]).toMatchObject({after: starts[0]!.start, build: builds[1]});
				expect(starts[1]!.start).not.toBe(starts[0]!.start);
			},
		),
		{seed: 119120, numRuns: 20, examples: [[["build-a", "build-b"]]]},
	);
});

it("stage readiness waits for the started event to reach the ledger", async () => {
	await fc.assert(
		fc.asyncProperty(fc.uuid(), async (build) => {
			const folder = home();
			vi.stubEnv("FABRIKA_HOME", folder);
			const reached = Effect.runSync(Deferred.make<void>());
			const release = Effect.runSync(Deferred.make<void>());
			const events: Array<typeof BrainEvent.Type> = [];
			vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
				const call = JSON.parse(String(options?.body)) as {
					method: string;
					args: Array<typeof BrainEvent.Type>;
				};
				if (call.method === "brain") {
					events.push(call.args[0]!);
					Effect.runSync(Deferred.succeed(reached, undefined));
					await Effect.runPromise(Deferred.await(release));
				}
				return Response.json({value: call.method === "write" ? {_tag: "written"} : null});
			});
			const {startStage} = await import("./stage.ts");
			await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const starting = yield* Effect.forkChild(
							startStage(
								{build, brain: "unused.mjs", programs: {}},
								{
									home: folder,
									name: "life-contract",
									person: "person-test",
									founder: "public-test",
									window: null,
									port: 18787,
								},
							),
						);
						yield* Deferred.await(reached);
						yield* Effect.yieldNow;
						expect(starting.pollUnsafe()).toBeUndefined();
						expect(events).toMatchObject([{_tag: "started", reason: "open", build}]);
						yield* Deferred.succeed(release, undefined);
						yield* Fiber.join(starting);
					}).pipe(Effect.ensuring(Deferred.succeed(release, undefined))),
				).pipe(
					Effect.provide(ProcessIdGenerator.layer),
					Effect.provide(SecureRandom.layerWebCrypto),
					Effect.provide(NodeServices.layer),
				),
			);
		}),
		{seed: 119120, numRuns: 10},
	);
});
