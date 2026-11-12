import * as fc from "fast-check";
import { RuleTester } from "oxlint/plugins-dev";
import { expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";
import { isolateBoundary } from "./isolate-boundary.ts";

const CODE = "fabrika(isolate-boundary)";
const stem = fc.stringMatching(/^[a-z]{1,8}$/);

const uses = [
  "type A = TraceItem;",
  "type B = Fetcher;",
  "const c = ctx.exports.Tail();",
  'const d = ctx["exports"].Tail();',
  "const e = ctx?.exports;",
  "class F { tail() { return this.ctx.exports.Tail(); } }",
];

// Run each generated check now, so fast-check can shrink its failure.
RuleTester.describe = (_name, body) => body();
RuleTester.it = (_name, body) => body();
const tester = new RuleTester({ cwd: process.cwd() });

it("U11 keeps platform names at the Cloudflare edge, including tests and optional reads", () => {
  fc.assert(
    fc.property(stem, (name) => {
      const code = uses.join("\n");
      tester.run("isolate-boundary", isolateBoundary, {
        valid: [
          { code, filename: `next/packages/libfabrika/src/cloudflare/${name}.ts` },
          { code, filename: `packages/fabrika/src/${name}.ts` },
        ],
        invalid: [
          `next/packages/libfabrika/src/runtime/${name}.ts`,
          `next/packages/libfabrika/src/runtime/${name}.test.ts`,
          `next/apps/fabrika/src/${name}.ts`,
        ].map((filename) => ({ code, filename, errors: uses.map((_, n) => ({ line: n + 1, message: /U11/ })) })),
      });
    }),
    { seed: 119120 },
  );
});

it("U11 passes comments, strings and ordinary exports; the app tail only hands off", () => {
  fc.assert(
    fc.property(stem, (name) => {
      tester.run("isolate-boundary", isolateBoundary, {
        valid: [
          {
            filename: `next/packages/libfabrika/src/runtime/${name}.ts`,
            code: '// TraceItem Fetcher ctx.exports\nconst text = "TraceItem Fetcher ctx.exports";\nconst e = module.exports;',
          },
          {
            filename: "next/apps/fabrika/src/brain.ts",
            code: "class IsolateTail { tail(items) { return tail(this.env, this.ctx.props, items); } }",
          },
        ],
        invalid: [
          {
            filename: "next/apps/fabrika/src/brain.ts",
            code: `class IsolateTail { tail(items) { const value${name} = items[0].cpuTime; return tail(value${name}); } }`,
            errors: [{ line: 1, message: /U11/ }],
          },
        ],
      });
    }),
    { seed: 119120 },
  );
});

// scenario: only a CLI pass through the repository config proves activation and registration.
it("scenario: U11 is enabled by the real config and leaves only cloudflare/ and today's version out", async () => {
  const runtime = "next/packages/libfabrika/src/runtime/usage.ts";
  const cloudflare = "next/packages/libfabrika/src/cloudflare/usage.ts";
  const old = "packages/fabrika/src/usage.ts";
  const result = await plant(Object.fromEntries([runtime, cloudflare, old].map((file) => [file, uses.join("\n")])));
  expect(result(CODE, runtime)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(result(CODE, cloudflare)).toEqual([]);
  expect(result(CODE, old)).toEqual([]);
});
