import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Effect, Layer} from "effect";
import {afterEach, expect, it, vi} from "vitest";

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
vi.mock("./run.ts", () => ({runHost: vi.fn((_options: unknown) => Effect.void)}));

const homes: string[] = [];
const mask = process.umask();

afterEach(() => {
	vi.unstubAllEnvs();
	process.umask(mask);

	for (const home of homes.splice(0)) {
		rmSync(home, {recursive: true, force: true});
	}
});

it.each([undefined, "", "/repo"])("starts with FABRIKA_REPO=%j", async (repo) => {
	vi.resetModules();
	const home = mkdtempSync(join(tmpdir(), "host-main-"));
	homes.push(home);
	vi.stubEnv("FABRIKA_HOME", home);
	vi.stubEnv("FABRIKA_REPO", repo);
	const {runMain} = await import("@effect/platform-node/NodeRuntime");
	const {runHost} = await import("./run.ts");
	vi.mocked(runMain).mockClear();
	vi.mocked(runHost).mockClear();
	await import("./main.ts");
	const main = vi.mocked(runMain).mock.calls[0]?.[0];

	if (main === undefined) {
		throw new Error("host main did not run");
	}

	await Effect.runPromise(main);
	expect(runHost).toHaveBeenCalledWith(expect.objectContaining({repo: repo || undefined}));
});
