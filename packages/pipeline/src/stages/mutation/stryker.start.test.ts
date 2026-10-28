import {readFile, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {Effect, FileSystem, Path} from "effect";
import {describe, expect, it, vi} from "vitest";
import {MutationRunner} from "./services.ts";
import {strykerRunner} from "./stryker.ts";

// A tool that never starts, on the runner over the fixture. Only the child
// process is faked: the runner still lists real mutants with Stryker's
// instrumenter, reads the report and puts each mutant that survived in for
// the typecheck. The fake Stryker reports one mutant that survived.

const FIXTURE = fileURLToPath(new URL("../../../../../fixtures/mutation", import.meta.url));
const MODULES = fileURLToPath(new URL("../../../node_modules", import.meta.url));
const MISSING = "./no-such-tool";

vi.mock("../../child.ts", () => ({
	runChild: (_file: string, args: readonly string[], options: {cwd: string}) =>
		Effect.tryPromise(async () => {
			// What `nice` answers when it finds no program to run.
			if (args.includes(MISSING)) return {code: 127, out: "", err: `nice: ${MISSING}: not found`};
			if (args.some((a) => a.endsWith("stryker.js"))) {
				const config = JSON.parse(await readFile(args.at(-1) ?? "", "utf8"));
				const source = await readFile(`${options.cwd}/clamp.ts`, "utf8");
				const mutant = {
					mutatorName: "ConditionalExpression",
					replacement: "false",
					status: "Survived",
					location: {start: {line: 12, column: 6}, end: {line: 12, column: 14}},
				};
				await writeFile(
					config.jsonReporter.fileName,
					JSON.stringify({files: {"clamp.ts": {source, mutants: [mutant]}}}),
				);
			}
			return {code: 0, out: "", err: ""};
		}),
}));

/** The runner over a fresh copy of the fixture, with these tests and typecheck commands. */
const inCopy = <A, E>(
	commands: {
		readonly tests: readonly [string, ...string[]];
		readonly typecheck: readonly [string, ...string[]];
	},
	use: (runner: MutationRunner["Service"]) => Effect.Effect<A, E>,
) =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const dir = yield* fs.makeTempDirectoryScoped({prefix: "mutation-start-"});
				for (const name of yield* fs.readDirectory(FIXTURE))
					yield* fs.copyFile(path.join(FIXTURE, name), path.join(dir, name));
				yield* fs.symlink(MODULES, path.join(dir, "node_modules"));
				return yield* Effect.gen(function* () {
					return yield* use(yield* MutationRunner);
				}).pipe(Effect.provide(strykerRunner({folder: () => dir, ...commands})));
			}),
		).pipe(Effect.provide(nodeServices)),
	);

const SPANS = [{file: "clamp.ts", from: 12, to: 12}];

describe("a tool that never starts", () => {
	it("fails the run when the typecheck tool is missing, so no mutant is counted as a compile error", async () => {
		const ran = await inCopy({tests: ["vitest"], typecheck: [MISSING]}, (runner) =>
			runner.run({head: "h", spans: SPANS, seed: 5, most: 150}).pipe(Effect.flip),
		);
		expect(ran).toEqual({_tag: "could_not_run"});
	}, 120_000);

	it("fails the repo's tests when the test tool is missing, instead of calling them red", async () => {
		const ran = await inCopy({tests: [MISSING], typecheck: ["tsc"]}, (runner) =>
			runner.tests("h").pipe(Effect.flip),
		);
		expect(ran).toEqual({_tag: "could_not_run"});
	});
});
