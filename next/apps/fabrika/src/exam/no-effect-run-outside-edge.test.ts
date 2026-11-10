// `no-effect-run-outside-edge` (exam item 2): an Effect runs only on a line under an edge comment.
// There is no list of edge files (owner, 2026-11-05; Tier 1, P35), so each run fires at every one of
// the 18 paths that list once named, and passes only where an edge comment stands over it.
import { describe, expect, it } from "vitest";
import { plant } from "./plant.ts";

const CODE = "fabrika(no-effect-run-outside-edge)";
const FIRES = "next/packages/libfabrika/src/app/fires.ts";
const PASSES = "next/apps/fabrika/dev.ts";
const EDGE = "next/packages/libfabrika/src/app/edges.ts";

const runs = [
  'import {Effect, FiberSet, ManagedRuntime, Layer} from "effect";', // 1
  "declare const thing: Effect.Effect<number>;", // 2
  "const runtime = ManagedRuntime.make(Layer.empty);", // 3
  "export const a = Effect.runPromise(thing);", // 4
  "export const b = Effect.runSync(thing);", // 5
  "export const c = Effect.runFork(thing);", // 6
  "export const d = Effect.runPromiseExit(thing);", // 7
  "export const e = runtime.runPromise(thing);", // 8
  "export const f = Effect.runCallback(thing);", // 9
  "declare const set: FiberSet.FiberSet;", // 10
  "export const g = FiberSet.runtimePromise(set)();", // 11
  "export const h = FiberSet.makeRuntimePromise();", // 12
].join("\n");

const RUN_LINES = [4, 5, 6, 7, 8, 9, 11, 12];

const passes = [
  'import {NodeRuntime} from "@effect/platform-node";',
  'import {Effect} from "effect";',
  "NodeRuntime.runMain(Effect.log('dev'));",
  "export const later = Effect.succeed(1);",
].join("\n");

const RULE = "fabrika/no-effect-run-outside-edge";

// Each run under its own edge comment, then one comment for both edge rules over one line.
const edges = [
  'import {Effect, FiberSet, ManagedRuntime, Layer} from "effect";',
  "declare const thing: Effect.Effect<number>;",
  "const runtime = ManagedRuntime.make(Layer.empty);",
  "declare const set: FiberSet.FiberSet;",
  "declare const p: Promise<number>;",
  ...[
    "export const a = Effect.runPromise(thing);",
    "export const b = Effect.runSync(thing);",
    "export const c = Effect.runFork(thing);",
    "export const d = Effect.runPromiseExit(thing);",
    "export const e = runtime.runPromise(thing);",
    "export const f = Effect.runCallback(thing);",
    "export const g = FiberSet.runtimePromise(set)();",
    "export const h = FiberSet.makeRuntimePromise();",
  ].flatMap((line) => [`// oxlint-disable-next-line ${RULE} -- edge: the platform calls it`, line]),
  `// oxlint-disable-next-line fabrika/no-promises, ${RULE} -- edge: a Durable Object answers a Promise`,
  "export const i = Effect.runPromise(Effect.tryPromise(() => p));",
].join("\n");

/** Every path the old list named, at the place the plan's "Packages" section put it. */
const OLD_EDGES = [
  "next/packages/libfabrika/src/data/project.ts",
  "next/packages/libfabrika/src/data/ledger.ts",
  "next/packages/libfabrika/src/app/process.ts",
  "next/packages/libfabrika/src/transport/gateway.ts",
  "next/packages/libfabrika/src/transport/hello.ts",
  "next/packages/libfabrika/src/transport/sshsig.ts",
  "next/apps/fabrika/src/brain.ts",
  "next/apps/fabrika/build.ts",
  "next/packages/tuval/src/window/use-model.ts",
  "next/packages/tuval/src/browser/key.ts",
  "next/packages/tuval/src/electron/preload.ts",
  "next/packages/tuval/src/electron/panel-preload.ts",
  "next/packages/tuval/src/electron/key.ts",
  "next/packages/tuval/src/electron/person-key.ts",
  "next/packages/tuval/src/electron/person-check.ts",
  "next/apps/fabrika/src/launchd.ts",
  "next/apps/fabrika/src/entry/electron-main.ts",
  "next/apps/fabrika/alchemy.run.ts",
];

describe("no-effect-run-outside-edge", async () => {
  const all = await plant({
    [FIRES]: runs,
    [PASSES]: passes,
    [EDGE]: edges,
    ...Object.fromEntries(OLD_EDGES.map((path) => [path, runs])),
    "next/packages/libfabrika/src/app/process.test.ts": runs,
  });

  it("fires on each run, a runtime's methods and the runtime makers too", () => {
    expect(all(CODE, FIRES)).toEqual(RUN_LINES);
  });

  it("fires at each of the 18 paths the old list named: the list is gone", () => {
    expect(OLD_EDGES).toHaveLength(18);

    for (const path of OLD_EDGES) {
      expect(all(CODE, path)).toEqual(RUN_LINES);
    }
  });

  it("passes each run under an edge comment, and one comment for both rules", () => {
    expect(all(CODE, EDGE)).toEqual([]);
    expect(all("fabrika(no-promises)", EDGE)).toEqual([]);
    expect(all("fabrika(edge-comment)", EDGE)).toEqual([]);
    // Every comment silenced something: none is unused.
    expect(all("", EDGE)).toEqual([]);
  });

  it("passes NodeRuntime.runMain and tests", () => {
    expect(all(CODE, PASSES)).toEqual([]);
    expect(all(CODE, "next/packages/libfabrika/src/app/process.test.ts")).toEqual([]);
  });
});
