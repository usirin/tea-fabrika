import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {isMainThread} from "node:worker_threads";
import {Effect, Exit, Layer} from "effect";
import * as fc from "fast-check";
import {afterEach, expect, it, vi} from "vitest";
import {go, home, options, repo, word} from "../project.test-support.ts";

vi.mock("@effect/platform-node/NodeRuntime", () => ({runMain: vi.fn()}));
vi.mock("@kampus/pipeline/code-host-github", () => ({
	gitHubCodeHost: () => Layer.empty,
	gitHubCodeTree: () => Layer.empty,
}));
vi.mock("@tea-fabrika/tracker/github", () => ({
	GITHUB: [],
	gitHubPullRequests: () => Layer.empty,
	gitHubRepoTree: () => Layer.empty,
}));
vi.mock("./jev.ts", () => ({hostJev: () => Layer.empty}));
vi.mock("./run.ts", () => ({runHost: vi.fn(() => Effect.void)}));
// Stryker's vitest runner runs tests in a worker thread, where process.umask(mode) throws
// ("not supported in workers"). There, host/main's umask call and the restore below act on a
// stand-in; on the main thread the real umask is used exactly as before.
if (!isMainThread) {
	let fake = process.umask();
	vi.spyOn(process, "umask").mockImplementation(((next?: string | number) => {
		const before = fake;
		if (next !== undefined) fake = typeof next === "string" ? Number.parseInt(next, 8) : next;
		return before;
	}) as typeof process.umask);
}
const mask = process.umask();
afterEach(() => process.umask(mask));

// Replaces the contract that FABRIKA_REPO could supply an unchecked root or no project.
it("P1: host/main validates project.json and ignores inherited FABRIKA_REPO", async () => {
	const {Project} = await import("../project.ts");
	await fc.assert(
		fc.asyncProperty(
			fc.record({name: word, inherited: fc.option(word, {nil: undefined})}),
			async ({name, inherited}) => {
				vi.resetModules();
				const app = home();
				const project = await go(Project.check(repo(app, name)));
				const durable = join(app, "projects", project.key);
				mkdirSync(durable, {recursive: true});
				writeFileSync(join(durable, "project.json"), JSON.stringify(project));
				vi.stubEnv("FABRIKA_HOME", durable);
				vi.stubEnv("FABRIKA_REPO", inherited);
				const {runMain} = await import("@effect/platform-node/NodeRuntime");
				const {runHost} = await import("./run.ts");
				vi.mocked(runMain).mockClear();
				vi.mocked(runHost).mockClear();
				await import("./main.ts");
				const main = vi.mocked(runMain).mock.calls[0]?.[0];
				if (main === undefined) throw new Error("host main did not run");
				await Effect.runPromise(main);
				expect(runHost).toHaveBeenCalledWith(
					expect.objectContaining({project, repo: project.root}),
				);
			},
		),
		options,
	);
});
it("P1: a missing, changed-root or forged project record starts no host", async () => {
	const {Project} = await import("../project.ts");
	await fc.assert(
		fc.asyncProperty(
			fc.record({name: word, bad: fc.constantFrom("missing", "forged", "moved")}),
			async ({name, bad}) => {
				vi.resetModules();
				const app = home();
				const project = await go(Project.check(repo(app, name)));
				if (bad !== "missing")
					writeFileSync(
						join(app, "project.json"),
						JSON.stringify({
							...project,
							...(bad === "forged" ? {key: "0".repeat(64)} : {root: join(app, "gone")}),
						}),
					);
				const {runMain} = await import("@effect/platform-node/NodeRuntime");
				const {runHost} = await import("./run.ts");
				vi.mocked(runMain).mockClear();
				vi.mocked(runHost).mockClear();
				await import("./main.ts");
				const main = vi.mocked(runMain).mock.calls[0]?.[0];
				if (main === undefined) throw new Error("host main did not run");
				expect(Exit.isFailure(await Effect.runPromiseExit(main))).toBe(true);
				expect(runHost).not.toHaveBeenCalled();
			},
		),
		options,
	);
});
