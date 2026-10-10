import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import type { Issue } from "./issue.ts";
import { candidatesOf, jevMissingReader } from "./route.ts";
import { scriptedWorkspace } from "./scripted.ts";
import { Jev, MissingReader } from "./services.ts";
import { Settings, settingsFromToml } from "./settings.ts";

// The Jev plug-in of the missing-file check: which files it asks about, and
// how the scope, the floor and the cap from `fabrika.toml` act on what Jev says.

const issue: Issue = {
  id: "1",
  title: "parse durations in hours",
  goal: "parseDuration reads hours",
  body: "parseDuration should read `1.5h`.",
  criteria: [
    {
      kind: "example",
      id: "hours",
      rule: "Hours are read",
      file: "packages/time/src/parse.ts",
      name: "parseDuration",
      examples: [{ call: `parseDuration("1.5h")`, result: "5400" }],
    },
  ],
  openDecision: null,
};

/**
 * A repo with one package the change touches, one it does not, and a picture.
 * In the touched package, `index.ts` imports the changed file, the change
 * makes it import `units.ts`, and `format.ts` has no link to it either way.
 */
const base = {
  "packages/time/src/parse.ts": "export function parseDuration() {}",
  "packages/time/src/format.ts": "export function formatDuration() {}",
  "packages/time/src/index.ts": "export * from './parse.ts'",
  "packages/time/src/units.ts": "export const HOUR = 3600",
  "packages/time/src/logo.png": "binary",
  "packages/web/src/page.ts": "render()",
};
const current = {
  "packages/time/src/parse.ts": "import { HOUR } from './units.ts'\nexport function parseDuration() {}",
};
const changed = ["packages/time/src/parse.ts"];

/** A Jev that says yes to each file by its path, and records which paths it was asked about. */
function jevScoring(yes: Readonly<Record<string, number>>, failing = false) {
  const asked: string[] = [];
  const layer = Layer.succeed(Jev, {
    call: (request) =>
      Effect.sync(() => {
        const state = request.state as { readonly file: { readonly path: string } };
        asked.push(state.file.path);
        return failing
          ? { status: 401, body: {} }
          : {
              status: 200,
              body: {
                model: request.model,
                answers: { missed: { type: "noul", noul: yes[state.file.path] ?? 0.1 } },
                usage: { input_tokens: 0, output_tokens: 0 },
              },
            };
      }),
  });
  return { layer, asked };
}

const find = (toml: string, jev: Layer.Layer<Jev>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const settings = yield* settingsFromToml(toml);
      const workspace = scriptedWorkspace([], undefined, undefined, base, current);
      const needs = Layer.mergeAll(jev, Layer.succeed(Settings, settings), workspace);
      return yield* Effect.gen(function* () {
        return yield* (yield* MissingReader).find({ issue, diff: "+ hours", changed });
      }).pipe(Effect.provide(Layer.provide(jevMissingReader, needs)));
    }).pipe(Effect.match({ onSuccess: (right) => ({ right }), onFailure: (left) => ({ left }) })),
  );

const PACKAGE = '[review]\nmissing_scope = "package"\n';

describe("the files the missing-file check may ask about", () => {
  it("are the untouched text files in the packages the change touched", () => {
    expect(candidatesOf(Object.keys(base), changed)).toEqual([
      "packages/time/src/format.ts",
      "packages/time/src/index.ts",
      "packages/time/src/units.ts",
    ]);
  });

  it("are every untouched file when the change is at the top of the repo", () => {
    expect(candidatesOf(["slugify.js", "README.md", "lib/util.js"], ["slugify.js"])).toEqual(["README.md", "lib/util.js"]);
  });
});

describe("Jev as the missing-file reader", () => {
  it("asks only about the files one import from the change, either way, by default", async () => {
    const jev = jevScoring({ "packages/time/src/units.ts": 0.8 });

    expect(await find("", jev.layer)).toEqual({
      right: { kind: "checked", scope: "imports", asked: 2, flagged: [{ file: "packages/time/src/units.ts", yes: 0.8 }] },
    });
    // format.ts neither imports parse.ts nor is imported by it, so Jev never sees it.
    expect(jev.asked.toSorted()).toEqual(["packages/time/src/index.ts", "packages/time/src/units.ts"]);
  });

  it("asks about every file in the touched packages under the package scope", async () => {
    const jev = jevScoring({});

    expect(await find(PACKAGE, jev.layer)).toMatchObject({ right: { kind: "checked", scope: "package", asked: 3 } });
    expect(jev.asked.toSorted()).toEqual([
      "packages/time/src/format.ts",
      "packages/time/src/index.ts",
      "packages/time/src/units.ts",
    ]);
  });

  it("flags the files at or above the floor, surest first", async () => {
    const jev = jevScoring({ "packages/time/src/index.ts": 0.55, "packages/time/src/units.ts": 0.8 });

    expect(await find("", jev.layer)).toEqual({
      right: {
        kind: "checked",
        scope: "imports",
        asked: 2,
        flagged: [
          { file: "packages/time/src/units.ts", yes: 0.8 },
          { file: "packages/time/src/index.ts", yes: 0.55 },
        ],
      },
    });
  });

  it("flags less under a higher floor from the file", async () => {
    const scores = { "packages/time/src/index.ts": 0.55, "packages/time/src/units.ts": 0.8 };

    expect(await find("[review]\nmissing_floor = 0.7\n", jevScoring(scores).layer)).toMatchObject({
      right: { kind: "checked", flagged: [{ file: "packages/time/src/units.ts" }] },
    });
  });

  it("counts the cap after the scope, and asks nothing over it", async () => {
    const underCap = jevScoring({});
    const overCap = jevScoring({});

    expect(await find("[review]\nmissing_max_files = 2\n", underCap.layer)).toMatchObject({ right: { kind: "checked", asked: 2 } });
    expect(await find(`${PACKAGE}missing_max_files = 2\n`, overCap.layer)).toEqual({
      right: { kind: "too_many", scope: "package", candidates: 3, cap: 2 },
    });
    expect(overCap.asked).toEqual([]);
  });

  it("fails as a whole when Jev refuses, rather than answer from part of the files", async () => {
    expect(await find("", jevScoring({}, true).layer)).toEqual({ left: { _tag: "reader_failed" } });
  });
});
