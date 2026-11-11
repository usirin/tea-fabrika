import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as fc from "fast-check";
import { expect, it, vi } from "vitest";
import { go, home, options, plant, repo, word } from "./project.test-support.ts";
import { startHost } from "./start-host.ts";

// Replaces T237-R2-3's inherited-repo fallback. T276 always requires a checked project.
const input = fc.record({ name: word, inherited: fc.constantFrom("absent", "wrong") });
const rootCheck = (seen: string, expected: string) => expect(seen).toBe(expected);

it("P1: the checked root reaches the actual child and fake harness despite absent or wrong FABRIKA_REPO", async () => {
  const { Project } = await import("./project.ts");
  await fc.assert(
    fc.asyncProperty(input, async ({ name, inherited }) => {
      const app = home();
      const root = repo(app, `chosen-${name}`);
      const wrong = repo(app, "wrong");
      const project = await go(Project.check(root));
      const paths = await go(Project.paths(app, project));
      const durable = join(app, "projects", project.key);
      mkdirSync(durable, { recursive: true });
      writeFileSync(join(durable, "project.json"), JSON.stringify(project));
      vi.stubEnv("FABRIKA_REPO", inherited === "absent" ? undefined : wrong);
      const entry = join(app, "child.mjs");
      // A real child reads the checked record, then talks to the real fake ACP process.
      writeFileSync(
        entry,
        `
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Effect, Stream, Layer} from ${JSON.stringify(import.meta.resolve("effect"))};
import * as NodeFileSystem from ${JSON.stringify(import.meta.resolve("@effect/platform-node/NodeFileSystem"))};
import * as NodePath from ${JSON.stringify(import.meta.resolve("@effect/platform-node/NodePath"))};
import * as NodeChildProcessSpawner from ${JSON.stringify(import.meta.resolve("@effect/platform-node/NodeChildProcessSpawner"))};
import {Project} from ${JSON.stringify(new URL("./project.ts", import.meta.url).href)};
import {summonManager} from ${JSON.stringify(import.meta.resolve("@kampus/fabrika-old/agents/summon"))};
import {Shell, memoryStorage} from ${JSON.stringify(import.meta.resolve("@kampus/fabrika-old"))};
const record = JSON.parse(readFileSync(join(process.env.FABRIKA_HOME, 'project.json'), 'utf8'));
const platform = NodeChildProcessSpawner.layer.pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)));
const project = await Effect.runPromise(Project.check(record.root).pipe(Effect.provide(platform)));
const result = await Effect.runPromise(Effect.gen(function* () {
 const manager = yield* Shell.SummonManager;
 const summoned = yield* manager.summon({agent: 'fake', settings: [], name: 'scout', by: 'user:fixture'});
 const news = yield* manager.turn('scout', 'read a.txt', null).pipe(Stream.runCollect);
 return {root: project.root, folder: summoned.folder, news};
}).pipe(Effect.provide(summonManager({storage: memoryStorage(), folder: project.root})), Effect.scoped));
process.stderr.write(JSON.stringify(result));
`,
      );
      const exited = await go(startHost({ binary: process.execPath, entry, home: durable, paths, project }));
      expect(await go(exited)).toBe(0);
      const seen = JSON.parse(readFileSync(paths.log, "utf8"));
      rootCheck(seen.root, root);
      rootCheck(seen.folder, root);
      expect(seen.news.some((news: { text?: string }) => news.text?.includes(`chosen-${name}`))).toBe(true);
      expect(readFileSync(join(root, ".fake-acp", "log"), "utf8")).toContain("prompt ");
    }),
    { ...options, numRuns: 5 },
  );
});

plant("P1 read the inherited repository", input, ({ name, inherited }) =>
  rootCheck(inherited === "absent" ? "" : "/fixture/wrong", `/fixture/chosen-${name}`),
);
