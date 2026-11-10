// `next/`, exam item 13, C4: React's store hook has no allowed file; tea's value is kept.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { plant } from "./plant.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");
const CODE = "fabrika(one-store-hook)";
const HOOK = "next/packages/tuval/src/window/use-model.ts";
const FIRES = "next/programs/counter/src/view.tsx";
const PASSES = "next/programs/counter/src/tile.tsx";
const RUNTIME = "next/programs/counter/src/dropped-runtime.ts";
const MODEL = "next/programs/counter/src/dropped-model.ts";
const OTHER_HOOKS = "next/programs/counter/src/dropped-hooks.ts";
const OTHER_CALLS = "next/programs/counter/src/other-calls.ts";
const COMPUTED = "next/programs/counter/src/computed.ts";
const PRIVATE = "next/programs/counter/src/private.ts";
const UNARY = "next/programs/counter/src/unary.ts";
const TEST = "next/programs/counter/src/view.test.ts";
const TSX_TEST = "next/programs/counter/src/view.test.tsx";
const OUTSIDE = "programs/counter/src/view.tsx";

const forbidden = [
  'import * as React from "react";', // 1
  'import {useSyncExternalStore} from "react";', // 2
  'import {useSyncExternalStore as useStore} from "react";', // 3
  'import {useSyncExternalStore as useShim} from "use-sync-external-store/shim";', // 4
  "declare const store: {read: () => number; listen: (f: () => void) => () => void};", // 5
  "export const read = () => React.useSyncExternalStore(store.listen, store.read);", // 6
  "export const kept = [useSyncExternalStore, useStore, useShim];", // 7
].join("\n");

const passes = [
  'import {type ViewHandle, useRuntime} from "@demlik/tea/react";',
  'declare const run: ViewHandle<{views: {counter: {count: number}}}, {type: "inc"}>;',
  "export const Counter = () => {",
  "\tconst [view, send] = useRuntime(run, (model) => model.views.counter);",
  '\treturn <button onClick={() => send({type: "inc"})}>{view.count}</button>;',
  "};",
].join("\n");

const runtime = [
  'import {type ViewHandle, useRuntime} from "@demlik/tea/react";', // 1
  'import * as tea from "@demlik/tea/react";', // 2
  'declare const run: ViewHandle<{count: number}, {type: "inc"}>;', // 3
  "export const Bare = () => { useRuntime(run); return null; };", // 4
  "export const Voided = () => { void useRuntime(run); return null; };", // 5
  "export const Member = () => { tea.useRuntime(run); return null; };", // 6
  "export const VoidMember = () => { void tea.useRuntime(run); return null; };", // 7
].join("\n");

const model = [
  'import {useModel} from "@kampus/tuval";', // 1
  "declare const store: {read: () => number; listen: (f: () => void) => () => void};", // 2
  "export const Bare = () => { useModel(store); return null; };", // 3
  "export const Voided = () => { void useModel(store); return null; };", // 4
].join("\n");

// Declarations keep the import and member checks from masking a missed dropped value.
const otherHooks = [
  "declare const run: unknown;", // 1
  "declare const useMachine: (run: unknown) => unknown;", // 2
  "declare const useSyncExternalStore: (run: unknown) => unknown;", // 3
  "export const Machine = () => { useMachine(run); return null; };", // 4
  "export const VoidMachine = () => { void useMachine(run); return null; };", // 5
  "export const Store = () => { useSyncExternalStore(run); return null; };", // 6
  "export const VoidStore = () => { void useSyncExternalStore(run); return null; };", // 7
].join("\n");

const otherCalls = [
  'import {useEffect} from "react";',
  'import {useSyncExternalStore} from "./local-store.ts";',
  "export const kept = [useEffect, useSyncExternalStore];",
  "declare const helper: () => number;",
  "declare const makeHook: () => () => number;",
  "export const Other = () => { helper(); makeHook()(); helper; return null; };",
].join("\n");

const computed = [
  "declare const useRuntime: string;",
  "declare const useSyncExternalStore: string;",
  "declare const hooks: Record<string, (run: unknown) => unknown>;",
  "declare const run: unknown;",
  "export const Indexed = () => { hooks[useRuntime](run); return hooks[useSyncExternalStore](run); };",
  'export const Literal = () => { hooks["useRuntime"](run); return hooks["useSyncExternalStore"](run); };',
].join("\n");

const privateCalls = [
  "export class Store {",
  "\t#useRuntime = () => null;",
  "\t#useSyncExternalStore = () => null;",
  "\tread() { this.#useRuntime(); return this.#useSyncExternalStore(); }",
  "}",
].join("\n");

const unary = [
  'import {useRuntime} from "@demlik/tea/react";',
  "declare const run: unknown;",
  "export const Negated = () => { !useRuntime(run); return null; };",
  "export const Type = () => { typeof useRuntime(run); return null; };",
].join("\n");

describe("one-store-hook", async () => {
  const all = await plant({
    [HOOK]: forbidden,
    [FIRES]: forbidden,
    [PASSES]: passes,
    [RUNTIME]: runtime,
    [MODEL]: model,
    [OTHER_HOOKS]: otherHooks,
    [OTHER_CALLS]: otherCalls,
    [COMPUTED]: computed,
    [PRIVATE]: privateCalls,
    [UNARY]: unary,
    [TEST]: `${forbidden}\n${runtime}`,
    [TSX_TEST]: `${forbidden}\n${runtime}`,
    [OUTSIDE]: `${forbidden}\n${runtime}`,
  });

  // Plants: restore the retired path allowance, or delete an import branch or member visitor.
  it.each([HOOK, FIRES])("rejects React imports, aliases, the shim and members in %s", (file) => {
    expect(all(CODE, file)).toEqual([2, 3, 4, 6]);
  });

  // Plant: forbid tea's hook or report calls whose returned value is kept.
  it("passes tea's selector when the view draws its value", () => {
    expect(all(CODE, PASSES)).toEqual([]);
  });

  // Plants: drop useRuntime from the hook set, or remove bare, void or member-call handling.
  it("rejects dropped useRuntime values in bare, void and plain member calls", () => {
    expect(all(CODE, RUNTIME)).toEqual([4, 5, 6, 7]);
  });

  // Plant: replace the old hook set with only useRuntime.
  it("still rejects bare and void useModel calls", () => {
    expect(all(CODE, MODEL)).toEqual([3, 4]);
  });

  it("rejects dropped useMachine and useSyncExternalStore values without an import finding", () => {
    expect(all(CODE, OTHER_HOOKS)).toEqual([4, 5, 6, 7]);
  });

  it("passes other React imports, same-named imports elsewhere, helpers and non-call statements", () => {
    expect(all(CODE, OTHER_CALLS)).toEqual([]);
  });

  // plant indexes named findings only; oxlint's plugin crashes have no rule code.
  it("does not crash on non-call statements or calls of returned functions", () => {
    const at = realpathSync(mkdtempSync(join(tmpdir(), "exam-")));

    try {
      copyFileSync(join(ROOT, ".oxlintrc.json"), join(at, ".oxlintrc.json"));
      symlinkSync(join(ROOT, "oxlint-plugins"), join(at, "oxlint-plugins"));
      mkdirSync(dirname(join(at, OTHER_CALLS)), { recursive: true });
      writeFileSync(join(at, OTHER_CALLS), otherCalls);
      const ran = spawnSync(
        join(ROOT, "node_modules", ".bin", "oxlint"),
        [
          `--config=${join(at, ".oxlintrc.json")}`,
          "--disable-nested-config",
          "--no-ignore",
          "--format=json",
          OTHER_CALLS,
        ],
        { cwd: at, encoding: "utf8" },
      );
      expect(ran.status, ran.stdout + ran.stderr).toBe(0);
      expect(JSON.parse(ran.stdout)).toMatchObject({ number_of_files: 1, diagnostics: [] });
    } finally {
      rmSync(at, { recursive: true, force: true });
    }
  });

  it.each([COMPUTED, PRIVATE])("leaves non-plain member access in %s alone", (file) => {
    expect(all(CODE, file)).toEqual([]);
  });

  it("distinguishes unary uses of a hook value from void dropping it", () => {
    expect(all(CODE, UNARY)).toEqual([]);
  });

  // Plant: remove the test override from the real config copied by plant.
  it.each([TEST, TSX_TEST])("leaves %s out of the rule", (file) => {
    expect(all(CODE, file)).toEqual([]);
  });

  // Plant: enable the rule globally instead of only under next/.
  it("adds no restriction outside next/", () => {
    expect(all(CODE, OUTSIDE)).toEqual([]);
  });
});
