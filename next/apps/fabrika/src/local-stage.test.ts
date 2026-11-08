import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {RuntimeLifecycle} from "@alchemy.run/cloudflare-runtime/core/Runtime";
import {NodeServices} from "@effect/platform-node";
import {afterEach, expect, it} from "@effect/vitest";
import type {BrainFact} from "@kampus/libfabrika/brain-fact";
import {ProcessIdGenerator} from "@kampus/libfabrika/coordination";
import {Context, Effect} from "effect";
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
	const {startStage} = await import("./stage.ts");
	const folder = home();
	vi.stubEnv("FABRIKA_HOME", folder);
	const facts: Array<typeof BrainFact.Type> = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
		const call = JSON.parse(String(options?.body)) as {
			method: string;
			args: Array<typeof BrainFact.Type>;
		};
		if (call.method === "brain") facts.push(call.args[0]!);
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
	for (const build of ["build-a", "build-b"]) {
		await Effect.runPromise(
			Effect.scoped(startStage({build, brain: "unused.mjs", programs: {}}, config)).pipe(
				Effect.provide(ProcessIdGenerator.layer),
				Effect.provide(NodeServices.layer),
			),
		);
	}
	const starts = facts.filter((fact) => fact._tag === "started");
	expect(starts).toHaveLength(2);
	expect(starts[1]).toMatchObject({after: starts[0]!.start, build: "build-b"});
	expect(starts[1]!.start).not.toBe(starts[0]!.start);
});
