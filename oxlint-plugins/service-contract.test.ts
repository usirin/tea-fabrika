// L12, next/. The lint rule owns contract shape; behavior lives in the desktop laws.
import { join } from "node:path";
import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { serviceContract } from "./service-contract.ts";

RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
const tester = new RuleTester({ cwd: join(import.meta.dirname, "..") });
const top = "next/packages/libfabrika/src/desktop/";
const headers = 'import { Context as C, Schema as S, Effect, Layer } from "effect";\n';

const shape =
  'export class BrainService extends C.Service<BrainService, { readonly stop: Effect.Effect<void> }>()("@kampus/libfabrika/desktop/BrainService")';

it("L12 contract bodies refuse running code under renamed imports and computed members", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("BrainService", "BrainControl", "BrainProbe"),
      fc.constantFrom(
        "static layer = Layer.succeed(this, {});",
        'static ["layer"] = Layer.effect(this, Effect.succeed({}));',
        "static layer() { return Layer.succeed(this, {}); }",
        "stop() { return Effect.void; }",
      ),
      (name, member) =>
        tester.run("service-contract", serviceContract, {
          valid: [{ filename: `${top}${name}.ts`, code: `${headers}${shape} {}\nexport const Status = S.String;` }],
          invalid: [
            {
              filename: `${top}${name}.ts`,
              code: `${headers}${shape} { ${member} }`,
              errors: [{ message: /only its written contract/ }],
            },
          ],
        }),
    ),
    { seed: 119120, numRuns: 100 },
  );
});

it("vector: schemas and errors pass; platform imports and running code fail", () => {
  // Fixed syntax forms are the parser's protocol, including constructs absent from generated members.
  const good = `${headers}export interface Shape { readonly stop: Effect.Effect<void> }\nexport class Failure extends S.TaggedError<Failure>()("Failure", { cause: S.Defect() }) {}\n${shape} {}`;
  tester.run("service-contract", serviceContract, {
    valid: [
      { filename: `${top}BrainService.ts`, code: good },
      { filename: `${top}BrainServiceManaged.ts`, code: `${headers}export const layer = Layer.empty;` },
    ],
    invalid: [
      'import { app } from "electron";',
      'import type { BrowserWindow } from "electron";',
      'import { DatabaseSync } from "node:sqlite";',
      'export { layer } from "./BrainServiceManaged.ts";',
      "export const layer = Layer.empty;",
      "export const stop = () => Effect.void;",
      "Effect.runSync(Effect.void);",
    ].map((code) => ({
      filename: `${top}BrainService.ts`,
      code: `${headers}${code}`,
      errors: [{ message: /only its written contract/ }],
    })),
  });
});

it("scenario: L12 the repo config rejects a static Layer at every new contract path", async () => {
  // The config, not RuleTester, must activate this rule at each approved contract.
  const paths = ["BrainService", "BrainControl", "BrainProbe"].map((name) => `${top}${name}.ts`);
  const result = await plant(
    Object.fromEntries(paths.map((file) => [file, `${headers}${shape} { static layer = Layer.empty; }\n`])),
  );

  for (const file of paths) {
    expect(result("fabrika(service-contract)", file)).toEqual([2]);
  }
});

it("L12 every desktop file, including test support, refuses platform imports and types", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("BrainServiceManaged.ts", "BrainLife.laws.test.ts", "BrainControl.test-support.ts"),
      fc.constantFrom(
        'import { readFile } from "node:fs";',
        'import type { BrowserWindow } from "electron";',
        'import { Root } from "@kampus/tuval";',
        "export type Timer = NodeJS.Timeout;",
      ),
      (name, code) => {
        tester.run("service-contract", serviceContract, {
          valid: [],
          invalid: [{ filename: `${top}${name}`, code, errors: [{ message: /only its written contract/ }] }],
        });
      },
    ),
    { seed: 119120, numRuns: 100 },
  );
});
