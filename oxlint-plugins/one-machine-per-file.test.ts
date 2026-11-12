// Decision 0046's syntax laws. Generated code is tested through oxlint's public RuleTester;
// config and real-file copies go through the same lint command as the exam.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { oneMachinePerFile } from "./one-machine-per-file.ts";

RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
const tester = new RuleTester({ cwd: import.meta.dirname });
const RUNS = { seed: 119120, numRuns: 100 };
const CODE = "fabrika(one-machine-per-file)";
const TEA = 'import { Machine } from "@demlik/tea/effect";';
const COUNT = /at most one tea machine/;
const OWN = /must be defined in this file/;
const IO = /no input or output imports/;

type ErrorAt = { readonly line: number; readonly message: RegExp };

const check = (code: string, errors: readonly ErrorAt[]) => {
  tester.run("one-machine-per-file", oneMachinePerFile, {
    valid: errors.length === 0 ? [{ code, filename: "case.ts" }] : [],
    invalid: errors.length === 0 ? [] : [{ code, filename: "case.ts", errors: [...errors] }],
  });
};

type Piece = { readonly text: (i: number) => string; readonly calls: number };

// The expected call count belongs to the case table, independent of the rule's traversal.
const PIECES: readonly Piece[] = [
  { text: (i) => `export const m${i} = Machine.make({});`, calls: 1 },
  { text: (i) => `export let m${i} = Machine.make({});`, calls: 1 },
  { text: (i) => `export const m${i} = (c) => Machine.make({});`, calls: 1 },
  { text: (i) => `export function m${i}(c) { return Machine.make({}); }`, calls: 1 },
  { text: (i) => `export const m${i} = () => [Machine.make({}), Machine.make({})];`, calls: 2 },
  { text: (i) => `export const m${i} = { machine: Machine.make({}) };`, calls: 1 },
  { text: (i) => `export const m${i} = Program.make({ machine: Machine.make({}) });`, calls: 1 },
  { text: (i) => `const m${i} = Machine.make({}); export { m${i} };`, calls: 1 },
  { text: (i) => `const m${i} = () => Machine.make({}); export { m${i} as x${i} };`, calls: 1 },
  { text: (i) => `const m${i} = Machine.make({});`, calls: 0 },
  { text: (i) => `const m${i} = Machine.make({}); export const p${i} = Program.make({machine: m${i}});`, calls: 1 },
  { text: (i) => `const c${i} = Machine.make({}); export const m${i} = Machine.make({init: c${i}.init});`, calls: 1 },
  { text: (i) => `import {Machine as M${i}} from "@demlik/tea"; export const m${i} = M${i}.make({});`, calls: 1 },
  {
    text: (i) => `import * as T${i} from "@demlik/tea/effect"; export const m${i} = T${i}.Machine["make"]({});`,
    calls: 1,
  },
  { text: (i) => `export const m${i} = Machine["make"]({});`, calls: 1 },
  { text: (i) => `import {Machine as M${i}} from "other"; export const m${i} = M${i}.make({});`, calls: 0 },
  { text: (i) => `import type {Machine as M${i}} from "@demlik/tea"; export const m${i} = M${i}.make({});`, calls: 0 },
  { text: (i) => `export function m${i}(Machine) { return Machine.make({}); }`, calls: 0 },
  { text: (i) => `const m${i} = Machine.make({}); export type {m${i}};`, calls: 0 },
  { text: (i) => `const m${i} = Machine.make({}); export const p${i} = { m${i}: 0 };`, calls: 0 },
];

it("L1: exactly the reached calls after the first fire, in source order", () => {
  fc.assert(
    fc.property(fc.array(fc.constantFrom(...PIECES), { minLength: 1, maxLength: 6 }), (pieces) => {
      let seen = 0;
      const errors = pieces.flatMap((p, i) => {
        const at: ErrorAt[] = [];

        for (let n = 0; n < p.calls; n++) {
          if (seen++ > 0) {
            at.push({ line: i + 2, message: COUNT });
          }
        }

        return at;
      });
      check([TEA, ...pieces.map((p, i) => p.text(i))].join("\n"), errors);
    }),
    { ...RUNS, numRuns: 200 },
  );
});

it("L1: default exports and local default bindings count with every generated neighbor", () => {
  fc.assert(
    fc.property(
      fc.constantFrom(
        "export default Machine.make({});",
        "const main = Machine.make({}); export default main;",
        "export default function main() { return Machine.make({}); }",
        "const main = () => Machine.make({}); export default main;",
      ),
      fc.constantFrom(...PIECES),
      (main, p) => {
        const errors: ErrorAt[] = Array.from({ length: p.calls }, () => ({ line: 3, message: COUNT }));
        check([TEA, main, p.text(0)].join("\n"), errors);
      },
    ),
    RUNS,
  );
});

const PARTS = ["local", "{}", "Schema.Struct({ f: Imported })", "Imported", "Remote.Model", 'Remote["Model"]'] as const;

it("L2: only a part whose value is an import or imported member fires", () => {
  fc.assert(
    fc.property(
      fc.record({
        model: fc.constantFrom(...PARTS),
        msg: fc.constantFrom(...PARTS),
        update: fc.constantFrom(...PARTS),
      }),
      (parts) => {
        const lines = Object.entries(parts).map(([key, value]) => `${key}: ${value},`);
        const errors = Object.values(parts).flatMap((value, i) =>
          ["Imported", "Remote.Model", 'Remote["Model"]'].includes(value) ? [{ line: i + 5, message: OWN }] : [],
        );
        check(
          [
            TEA,
            'import {Imported, Remote} from "./parts.ts";',
            'import {Schema} from "effect"; const local = {};',
            "export const m = Machine.make({",
            ...lines,
            "});",
          ].join("\n"),
          errors,
        );
      },
    ),
    RUNS,
  );
});

const IO_IMPORTS = [
  ...[
    "Effect",
    "Layer",
    "Context",
    "ManagedRuntime",
    "Fiber",
    "Scope",
    "Clock",
    "Random",
    "Schedule",
    "FileSystem",
    "Path",
    "Config",
    "ConfigProvider",
    "Console",
    "Stream",
    "Queue",
    "PubSub",
    "Ref",
    "Deferred",
    "Semaphore",
    "Sink",
  ].map((n) => `import {${n} as Value} from "effect";`),
  ...["run", "runIn", "spawn", "stop", "tell", "EffectRun", "EffectInterpret", "EffectSubscribe"].map(
    (n) => `import {${n} as Value} from "@demlik/tea/effect";`,
  ),
  ...[
    "node:fs",
    "effect/process",
    "effect/http",
    "effect/cli",
    "effect/unstable/sql",
    "@effect/platform-node",
    "cloudflare:workers",
    "miniflare",
    "workerd",
    "wrangler",
    "@cloudflare/workers-types",
  ].map((n) => `import * as Value from "${n}";`),
];

const PURE_IMPORTS = [
  'import {Schema, Array, Result, Equal, Option} from "effect";',
  'import {Cmd} from "@demlik/tea/effect";',
  'import * as Value from "effect/encoding";',
  'import * as Value from "effect/crypto";',
  'import { Effect as Value } from "./helpers.ts";',
];

it("L3: each closed-list value import fires only when a machine call exists, including a private call", () => {
  fc.assert(
    fc.property(
      fc.boolean(),
      fc.boolean(),
      fc.subarray(IO_IMPORTS),
      fc.constantFrom(...PURE_IMPORTS),
      (hasCall, exported, imports, pure) => {
        // Every line binds a unique name; the generated set may contain different spellings of Value.
        const lines = [...imports, pure].map((s, i) => s.replaceAll("Value", `Value${i}`));
        const errors = hasCall ? imports.map((_, i) => ({ line: i + 2, message: IO })) : [];
        check(
          [TEA, ...lines, hasCall ? `${exported ? "export " : ""}const m = Machine.make({});` : ""].join("\n"),
          errors,
        );
        check(
          [TEA, ...lines.map((s) => s.replace("import ", "import type ")), "export const m = Machine.make({});"].join(
            "\n",
          ),
          [],
        );
        check(
          [
            TEA,
            ...lines.map((s) =>
              s.startsWith("import {")
                ? s.replace("import {", "import {type ").replaceAll(", ", ", type ")
                : s.replace("import ", "import type "),
            ),
            "const m = Machine.make({});",
          ].join("\n"),
          [],
        );
      },
    ),
    RUNS,
  );
});

const DOUBLE = `${TEA}\nexport const first = Machine.make({});\nexport const second = Machine.make({});\n`;

it("pinned: L4 the two product blocks enforce the rule; the five test globs leave fixture machines alone", async () => {
  // These paths exercise the exact globs in the approved scope, including RuntimeCauseTest's form.
  const paths = [
    "next/example.ts",
    ".agents/skills/example.ts",
    "next/example.test.ts",
    "next/example.test.tsx",
    "next/ExampleTest.ts",
    "next/example.test-support.ts",
    ".agents/example.test.ts",
  ];
  const result = await plant(Object.fromEntries(paths.map((p) => [p, DOUBLE])));
  paths.forEach((p, i) => {
    expect([p, result(CODE, p)]).toEqual([p, i < 2 ? [3] : []]);
  });
});

const REAL = [
  "next/packages/libfabrika/src/access/Access.ts",
  "next/packages/libfabrika/src/gateway/internal/waiting.ts",
  "next/packages/libfabrika/src/jobs/internal/job.ts",
  "next/packages/libfabrika/src/node/dev/DevLife.ts",
  "next/packages/libfabrika/src/processes/internal/processTable.ts",
  "next/packages/libfabrika/src/runtime/BrainLife.ts",
  "next/packages/libfabrika/src/runtime/internal/reply.ts",
  "next/packages/libfabrika/src/runtime/internal/supervisor.ts",
  "next/packages/libfabrika/src/telemetry/internal/sink.ts",
  "next/packages/libfabrika/src/transport/internal/connection.ts",
  "next/programs/checklist/src/program.ts",
  "next/programs/counter/src/program.ts",
  ".agents/skills/lead/scripts/flow/machine.ts",
];

it("scenario: L5 the 13 measured machine file copies have zero hits", async () => {
  // These are the plan's measured inputs, including both factory forms.
  const originals = Object.fromEntries(REAL.map((p) => [p, readFileSync(new URL(`../${p}`, import.meta.url), "utf8")]));
  const clean = await plant(originals);

  for (const p of REAL) {
    expect([p, clean(CODE, p)]).toEqual([p, []]);
  }
});

it("scenario: L5 each real file copy refuses one added second export", async () => {
  // Compare with the unchanged copy, so an existing hit cannot hide the planted count failure.
  const originals = Object.fromEntries(REAL.map((p) => [p, readFileSync(new URL(`../${p}`, import.meta.url), "utf8")]));
  const clean = await plant(originals);
  const broken = await plant(
    Object.fromEntries(
      Object.entries(originals).map(([p, s]) => [p, `${s}\nexport const plantedSecond = Machine.make({});\n`]),
    ),
  );

  for (const [p, s] of Object.entries(originals)) {
    expect([p, broken(CODE, p)]).toEqual([p, [...clean(CODE, p), s.split("\n").length + 1]]);
  }
});

it("scenario: L5 lint.ts over next/ and .agents/ has zero hits for this rule", () => {
  // This is the real tree count; other rules keep their own verdicts.
  const out = spawnSync(process.execPath, ["oxlint-plugins/lint.ts", "next/", ".agents/"], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
  });
  expect(out.error).toBeUndefined();
  expect([0, 1]).toContain(out.status);
  expect(out.stdout).toMatch(/oxlint: \d+ blocking/);
  expect(out.stdout.split("\n").filter((line) => line.includes(CODE))).toEqual([]);
});
