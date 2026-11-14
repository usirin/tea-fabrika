import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import * as fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createVitest, type Vitest, type TestSpecification } from "vitest/node";
import { parse } from "yaml";
import { measured } from "../../vitest.shards.ts";
import { vitestLegs } from "./workflow-lint.ts";

// Today's CI for both versions. Vitest 5.0.5's public node API, read in
// dist/chunks/plugin.d.C8mmycim.d.ts and cli-api.De07GUeT.js: `related` takes absolute
// paths; getRelevantTestSpecifications runs its own affected resolver without executing tests.
// Keep the real config and every test in the walk, including tests outside the skills folders.
// T375 plants caught: restoring skill force triggers selects every test; deleting box.test.ts's
// box.sh declaration omits that test. The latter first survived mixed subsets; singletons catch it.
// Since the reads are derived (oxlint-plugins/script-reads.mjs), the same plant is dropping the
// vitest.config.ts plugin that hands them to Vitest: every script alone then selects no test.
const root = join(import.meta.dirname, "../..");

const files = readdirSync(join(root, ".agents/skills"), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(root, join(entry.parentPath, entry.name)));

// Any depth under `scripts/`, as vitest.config.ts includes tests there (the flow runner's `flow/`).
const tree = new Map(
  files.filter((path) => /\/scripts\/.+$/.test(path)).map((path) => [path, readFileSync(join(root, path), "utf8")]),
);

const scripts = [...tree.keys()].filter((path) => !path.endsWith(".test.ts"));
const tests = [...tree.keys()].filter((path) => path.endsWith(".test.ts"));

// Independent expected readers: follow source names, not the derivation under test.
// This intentionally shares its over-match of names in comments and fixture strings. A name may
// hold a dot, as `catchup.test-support.ts` does.
const readers = new Map(
  tests.map((test) => {
    const reached = new Set<string>();
    const queue = [test];

    for (const path of queue) {
      const names = new Set((tree.get(path) ?? "").match(/[\w.-]+\.(?:sh|py|mjs|ts|json)\b/g));

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
const readScripts = scripts.filter((script) => [...readers.values()].some((paths) => paths.has(script)));

const markdown = files.filter((path) => path.endsWith(".md") && !path.includes("/scripts/"));
const options = { seed: 119120, numRuns: 20 };
let vitest: Vitest;

beforeAll(async () => {
  vitest = await createVitest("test", { root, watch: false, maxWorkers: 1 });
});

afterAll(async () => {
  await vitest?.close();
});

const affected = async (paths: string[]) => {
  vitest.config.related = paths.map((path) => join(root, path));
  return (await vitest.getRelevantTestSpecifications()).map((spec) => relative(root, spec.moduleId)).sort();
};

const declaring = (changed: ReadonlyArray<string>) =>
  tests.filter((test) => changed.some((path) => readers.get(test)!.has(path))).sort();

it("real script subsets select exactly their declaring tests, never an empty set", async () => {
  await fc.assert(
    fc.asyncProperty(fc.subarray(readScripts, { minLength: 1, maxLength: 12 }), async (paths) => {
      const expected = declaring(paths);
      expect(expected.length).toBeGreaterThan(0);
      expect(await affected(paths)).toEqual(expected);
    }),
    options,
  );
});

// scenario: every real script alone, each in its own test, so another declared script in a subset
// cannot hide a missing import. The subset property once re-checked only its sampled members
// alone, inside its own run: about 150 graph walks in one test, 12.7 s in the mutation
// container's plain run and over the mutation run's 10 s limit (CI runs 42988915529 and
// 42989306764). This walks every script, not a sample, at one walk per test.
it.each(readScripts)("the real script %s alone selects exactly its declaring tests, never none", async (path) => {
  const expected = declaring([path]);
  expect(expected.length).toBeGreaterThan(0);
  expect(await affected([path])).toEqual(expected);
});

it("real skill Markdown subsets select no test", async () => {
  await fc.assert(
    fc.asyncProperty(fc.subarray(markdown, { minLength: 1, maxLength: 12 }), async (paths) => {
      expect(await affected(paths)).toEqual([]);
    }),
    options,
  );
});

// Today's CI serves both versions. The baseline deliberately has no next/ CLI filter.
// The matrix also holds leg `e2e`, which runs no vitest, so the law reads the numbered legs only,
// as the workflow lint does. Plant, run once on check.yaml and restored: drop leg "5" from the next
// matrix, so file indices 5 of 5 land on no leg (red, the sorted legs are not 1 to 5).
describe("next workflow coverage", () => {
  const workflow = readFileSync(join(root, ".github/workflows/check.yaml"), "utf8");
  const nextWorkflow = parse(workflow).jobs.next;
  const indices = vitestLegs(workflow);
  const expression: string = nextWorkflow.steps.find((step: { env?: { SHARD?: string } }) => step.env?.SHARD)?.env
    .SHARD;
  const denominator = Number(/\/([1-9]\d*)$/.exec(expression)?.[1]);
  const contexts: Vitest[] = [];
  let nextSpecs: TestSpecification[];
  const repoPath = (spec: TestSpecification) => relative(root, spec.moduleId).replaceAll("\\", "/");
  const partition = async (specs: TestSpecification[]) => {
    const kept: string[][] = [];

    for (const context of contexts.slice(1)) {
      const Sequencer = context.config.sequence.sequencer;
      kept.push((await new Sequencer(context).shard(specs)).map(repoPath));
    }

    return kept;
  };
  const complete = (kept: string[][], universe: string[]) => {
    expect(kept.flat().toSorted()).toEqual(universe.toSorted());
    expect(new Set(kept.flat()).size).toBe(kept.flat().length);
  };
  beforeAll(async () => {
    const baseline = await createVitest("test", { root, watch: false, maxWorkers: 1 });
    contexts.push(baseline);
    nextSpecs = (await baseline.globTestSpecifications()).filter((spec) => repoPath(spec).startsWith("next/"));

    for (const index of indices) {
      contexts.push(
        await createVitest("test", {
          root,
          watch: false,
          maxWorkers: 1,
          shard: `${index}/${denominator}`,
        }),
      );
    }
  });
  afterAll(async () => {
    for (const context of contexts) {
      await context.close();
    }
  });

  it("scenario: workflow shards partition every config-discovered next file exactly once", async () => {
    // Real config discovery and each configured sequencer run without executing a test.
    expect(Number.isInteger(denominator)).toBe(true);
    expect(indices.toSorted((a, b) => Number(a) - Number(b))).toEqual(
      Array.from({ length: denominator }, (_, i) => String(i + 1)),
    );
    const universe = nextSpecs.map(repoPath);
    expect(universe.length).toBeGreaterThan(0);
    expect(new Set(universe).size).toBe(universe.length);
    const kept: string[][] = [];

    for (const context of contexts.slice(1)) {
      const specs = await context.globTestSpecifications(["next/"]);
      const Sequencer = context.config.sequence.sequencer;
      kept.push((await new Sequencer(context).shard(specs)).map(repoPath));
    }

    complete(kept, universe);
  });

  it("real configured shards preserve generated subsets, order and unmeasured files", async () => {
    // External test specifications have no domain Schema. Reuse real discovery, at most 12 files.
    await fc.assert(
      fc.asyncProperty(
        fc.subarray(nextSpecs, { maxLength: 10 }),
        fc.array(fc.nat(), { minLength: 12, maxLength: 12 }),
        fc.stringMatching(/^[a-z]{1,16}$/),
        async (subset, order, suffix) => {
          const project = nextSpecs[0]!.project;
          const unknown = ["a", "b"].map((letter) =>
            project.createSpecification(join(root, `next/apps/fabrika/src/unmeasured-${suffix}-${letter}.test.ts`)),
          );

          for (const spec of unknown) {
            expect(Object.hasOwn(measured, repoPath(spec))).toBe(false);
          }

          const files = [...subset, ...unknown];
          const shuffled = files
            .map((spec, i) => ({ spec, rank: order[i]! }))
            .toSorted((a, b) => a.rank - b.rank)
            .map(({ spec }) => spec);
          const first = await partition(files);
          complete(first, files.map(repoPath));

          for (const permutation of [shuffled, files.toReversed()]) {
            const kept = await partition(permutation);
            complete(kept, files.map(repoPath));
            expect(kept.map((paths) => paths.toSorted())).toEqual(first.map((paths) => paths.toSorted()));
          }
        },
      ),
      options,
    );
  });
});
