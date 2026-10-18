import {access} from "node:fs/promises";
import {join} from "node:path";
import {JEV_ENDPOINT} from "@demlik/tea/jev";
import {Layer} from "effect";
import {type ClaudeOptions, claudeBuilder, claudeEnricher, claudeReviewer} from "./claude.ts";
import {localFacts} from "./code-facts.ts";
import {fileTracker, liveJev, localPublishedApi, localRepo, localWorkspace} from "./local.ts";
import {jevCommentReader, jevFailureReader, jevMatcher, jevMissingReader, jevRouter} from "./route.ts";
import type {defaultSettings, settingsFile} from "./settings.ts";
import {VITEST_REPORTER, vitestTests} from "./tests.ts";

// What the hosts that run a real ticket on a real pnpm monorepo share
// (src/real.ts, src/replay-run.ts): the issue's tests and checks in one
// package, and every service as a Layer. Each host says where the repo, the
// ticket and the run are.

/** Where a real run works: the repo, the package the issue's tests join, and the file they go in inside it. */
export interface RealSetup {
	/** A git checkout of the repo, clean, on the branch the builder works on. */
	readonly dir: string;
	/** The package's folder, relative to `dir`; "." for a repo that is one package. */
	readonly package: string;
	/** The branch a change lands in. */
	readonly base: string;
	/** The issue's tests, relative to the package, such as `src/fabrika-558.test.ts`. */
	readonly testsFile: string;
}

/**
 * The issue's tests: a vitest file in the package, run from the package's
 * folder. Vetting typechecks it with the tsconfig the package checks its
 * tests with, when it has one. And what CI asks of the package, but lint.
 */
export async function testingFor(setup: RealSetup) {
	const testTsconfig = (await access(join(setup.dir, setup.package, "tsconfig.test.json")).then(
		() => true,
		() => false,
	))
		? "tsconfig.test.json"
		: "tsconfig.json";
	const tests = vitestTests({
		package: setup.package,
		file: setup.testsFile,
		tsconfig: testTsconfig,
	});
	const inPackage = (script: string) => `pnpm --dir '${setup.package}' ${script}`;
	const testing = {
		// Its types, its test files' types, and its tests.
		test: [
			"sh",
			"-c",
			[
				inPackage("run typecheck"),
				inPackage("run --if-present typecheck:test"),
				inPackage(`exec vitest run --reporter=${VITEST_REPORTER}`),
			].join(" && "),
		],
		tests,
		install: ["pnpm", "install", "--frozen-lockfile", "--prefer-offline"],
	} as const;
	return {testTsconfig, tests, testing};
}

/** Every service a real run needs: Claude Code agents in `dir`, the real Jev, and the ticket in a folder tracker. */
export function realLayers(
	setup: RealSetup,
	options: {
		readonly testing: Awaited<ReturnType<typeof testingFor>>["testing"];
		readonly trackerDir: string;
		readonly key: string;
		readonly claude: ClaudeOptions;
		readonly settings: typeof defaultSettings | ReturnType<typeof settingsFile>;
	},
) {
	const {dir} = setup;
	const {testing, claude, settings} = options;
	const {tests} = testing;
	const jev = liveJev(options.key, JEV_ENDPOINT);
	const jevReading = Layer.mergeAll(jev, settings);
	const workspace = localWorkspace(dir, testing);
	return Layer.mergeAll(
		localFacts(dir),
		claudeEnricher(dir, claude),
		claudeBuilder(dir, {
			...claude,
			tests: tests.file,
			...(tests.typecheck ? {snippets: tests.typecheck.snippets} : {}),
		}),
		workspace,
		// What the package publishes, where the change started and in the change: the builder may not alter what the ticket does not name.
		localPublishedApi(dir, {package: setup.package, install: testing.install}),
		localRepo(dir, {...testing, base: setup.base}),
		jev,
		jevRouter.pipe(Layer.provide(jevReading)),
		claudeReviewer(dir, claude),
		jevMatcher.pipe(Layer.provide(jevReading)),
		fileTracker(options.trackerDir),
		jevCommentReader.pipe(Layer.provide(jevReading)),
		jevFailureReader.pipe(Layer.provide(jevReading)),
		jevMissingReader.pipe(Layer.provide(Layer.mergeAll(jevReading, workspace))),
		settings,
	);
}
