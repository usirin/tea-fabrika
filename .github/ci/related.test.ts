import {readdirSync, readFileSync} from "node:fs";
import {basename, join, relative} from "node:path";
import * as fc from "fast-check";
import {afterAll, beforeAll, expect, it} from "vitest";
import {createVitest, type Vitest} from "vitest/node";

// Today's CI for both versions. Vitest 5.0.5's public node API, read in
// dist/chunks/plugin.d.C8mmycim.d.ts and cli-api.De07GUeT.js: `related` takes absolute
// paths; getRelevantTestSpecifications runs its own affected resolver without executing tests.
// Keep the real config and every test in the walk, including tests outside the skills folders.
// T375 plants caught: restoring skill force triggers selects every test; deleting box.test.ts's
// box.sh declaration omits that test. The latter first survived mixed subsets; singletons catch it.
const root = join(import.meta.dirname, "../..");

const files = readdirSync(join(root, ".agents/skills"), {recursive: true, withFileTypes: true})
	.filter((entry) => entry.isFile())
	.map((entry) => relative(root, join(entry.parentPath, entry.name)));

const tree = new Map(
	files
		.filter((path) => /\/scripts\/[^/]+$/.test(path))
		.map((path) => [path, readFileSync(join(root, path), "utf8")]),
);

const scripts = [...tree.keys()].filter((path) => !path.endsWith(".test.ts"));
const tests = [...tree.keys()].filter((path) => path.endsWith(".test.ts"));

// Independent expected readers: follow source names, not the imports whose absence we plant.
// This intentionally shares the plan's over-match of names in comments and fixture strings.
const readers = new Map(
	tests.map((test) => {
		const reached = new Set<string>();
		const queue = [test];

		for (const path of queue) {
			const names = new Set((tree.get(path) ?? "").match(/[\w-]+\.(?:sh|py|mjs|ts|json)\b/g));

			for (const script of scripts) {
				if (names.has(basename(script)) && !reached.has(script)) {
					reached.add(script);
					queue.push(script);
				}
			}
		}

		return [test, reached] as const;
	}),
);

// Unreferenced scripts have no reader, as the plan's final limits section says.
const readScripts = scripts.filter((script) =>
	[...readers.values()].some((paths) => paths.has(script)),
);

const markdown = files.filter((path) => path.endsWith(".md") && !path.includes("/scripts/"));
const options = {seed: 119120, numRuns: 20};
let vitest: Vitest;

beforeAll(async () => {
	vitest = await createVitest("test", {root, watch: false, maxWorkers: 1});
});

afterAll(async () => {
	await vitest?.close();
});

const affected = async (paths: string[]) => {
	vitest.config.related = paths.map((path) => join(root, path));
	return (await vitest.getRelevantTestSpecifications())
		.map((spec) => relative(root, spec.moduleId))
		.sort();
};

it("real script subsets select exactly their declaring tests, never an empty set", async () => {
	await fc.assert(
		fc.asyncProperty(fc.subarray(readScripts, {minLength: 1, maxLength: 12}), async (paths) => {
			// Also check each member alone: another declared script must not hide a missing import.
			for (const changed of [paths, ...paths.map((path) => [path])]) {
				const expected = tests
					.filter((test) => changed.some((path) => readers.get(test)!.has(path)))
					.sort();
				expect(expected.length).toBeGreaterThan(0);
				expect(await affected(changed)).toEqual(expected);
			}
		}),
		options,
	);
});

it("real skill Markdown subsets select no test", async () => {
	await fc.assert(
		fc.asyncProperty(fc.subarray(markdown, {minLength: 1, maxLength: 12}), async (paths) => {
			expect(await affected(paths)).toEqual([]);
		}),
		options,
	);
});
