// Ticket 737, G1 and G3. next/ decodes input with Effect Schema (decision 0023), so oxlint's own
// `no-restricted-properties` reports a bare `JSON.parse` there. It blocks in every folder at zero
// (0523), and since ticket 909 a wrong service ID blocks too (decision 0168). The fixtures are the
// rule's inputs (0093); the replay reads the tree.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";

const CODE = "eslint(no-restricted-properties)";
const ID = "fabrika(service-id)";
const root = resolve(import.meta.dirname, "..");
const word = fc.stringMatching(/^[a-z]{2,6}$/);

/** A file of numbered lines, and the lines the rule must fire on. */
const file = (lines: ReadonlyArray<readonly [string, boolean]>) => ({
  text: `${lines.map(([line]) => line).join("\n")}\n`,
  fires: lines.flatMap(([, fires], i) => (fires ? [i + 1] : [])),
});

describe("T737 G1 a bare JSON.parse in next/ is reported", () => {
  it("fires on the parse forms oxlint resolves, and on nothing else or outside next/", async () => {
    await fc.assert(
      fc.asyncProperty(fc.record({ name: word.map((w) => `v${w}`), text: fc.json() }), async ({ name, text }) => {
        const body = (inside: boolean) =>
          file([
            [`export const ${name} = JSON.parse(${JSON.stringify(text)});`, inside],
            [`export const computed = JSON["parse"](${JSON.stringify(text)});`, inside],
            [`export const optional = JSON?.parse(${JSON.stringify(text)});`, inside],
            [`export const reference = JSON.parse;`, inside],
            ["export const { parse } = JSON;", inside],
            // Not a parse of JSON: another object's parse, a comment, a string, a type, a stringify.
            [`export const other = { parse: (s: string) => s }.parse(${JSON.stringify(text)});`, false],
            ["// JSON.parse in a comment", false],
            ['export const quoted = "JSON.parse(x)";', false],
            ["export type Parse = typeof JSON.parse;", false],
            [`export const out = JSON.stringify(${JSON.stringify(text)});`, false],
            // A documented miss: an alias of JSON is not followed.
            [`const J = JSON;`, false],
            [`export const aliased = J.parse(${JSON.stringify(text)});`, false],
          ]);
        const shadow = (inside: boolean) =>
          file([
            // A documented false alarm: oxlint's rule does not read scope, so a local JSON fires too.
            ["const JSON = { parse: (s: string) => s };", false],
            ['export const local = JSON.parse("x");', inside],
          ]);
        const files = {
          "next/packages/libfabrika/src/transport/Probe.ts": body(true),
          "next/apps/fabrika/src/probe.test.ts": body(true),
          "next/packages/libfabrika/src/transport/Shadow.ts": shadow(true),
          "packages/fabrika/src/probe.ts": body(false),
          // Not under `oxlint-plugins/`: the planted folder links that one to the real folder.
          "scripts/probe.ts": body(false),
        };
        const linted = await plant(Object.fromEntries(Object.entries(files).map(([path, f]) => [path, f.text])));

        for (const [path, f] of Object.entries(files)) {
          expect(linted(CODE, path), path).toEqual(f.fires);
        }
      }),
      { seed: 119120, numRuns: 4 },
    );
  });

  it("scenario: replayed over the plan's decode sites, no bare JSON.parse is left in them", () => {
    const sites = [
      "next/packages/libfabrika/src/transport/Hello.ts",
      "next/packages/libfabrika/src/transport/Connection.ts",
      "next/packages/libfabrika/src/runtime/Program.ts",
      "next/apps/fabrika/src/runtime.ts",
    ];
    const ran = spawnSync(
      join(root, "node_modules/.bin/oxlint"),
      [`--config=${join(root, ".oxlintrc.json")}`, "--disable-nested-config", "--no-ignore", "--format=json", ...sites],
      { cwd: root, encoding: "utf8", maxBuffer: 2 ** 30, timeout: 120_000 },
    );
    const report: {
      readonly diagnostics: ReadonlyArray<{ readonly code?: string; readonly filename: string }>;
    } = JSON.parse(ran.stdout);
    expect(report.diagnostics.filter((d) => d.code === CODE).map((d) => d.filename)).toEqual([]);
  });
});

/** Runs `pnpm lint`'s oxlint step on planted files inside next/, as the repo runs it. */
const lint = (files: Readonly<Record<string, string>>, args: ReadonlyArray<string>) => {
  const dir = realpathSync(mkdtempSync(join(root, "next", ".decode-lint-")));

  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }

    const ran = spawnSync(process.execPath, [join(root, "oxlint-plugins/lint.ts"), ...args, ...Object.keys(files)], {
      cwd: dir,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(ran.error).toBeUndefined();
    return ran;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** One libfabrika file as the lint runner sees it: a service with a wrong or right ID, and a parse or none. */
const probe = ({
  parse,
  id,
  blocking,
}: {
  readonly parse: boolean;
  readonly id: string | null;
  readonly blocking: boolean;
}) =>
  `${[
    'import { Context } from "effect";',
    "",
    `export class Probe extends Context.Service<Probe, { readonly n: number }>()("${id ?? "@kampus/libfabrika/runtime/Probe"}") {}`,
    "",
    `export const read = (text: string): unknown => ${parse ? "JSON.parse(text)" : "text"};`,
    ...(blocking ? ["", "debugger;"] : []),
  ].join("\n")}\n`;

const PROBE = "next/packages/libfabrika/src/runtime/Probe.ts";

// T930 L9: the planted folder has no warn line, so it is at zero and a bare JSON.parse blocks there
// (0523), beside a wrong service ID, which blocks since ticket 909.
describe("T737 G3, T909 and T930 L9: a bare JSON.parse in a clean folder and a wrong service ID both block", () => {
  it("a clean report passes, and a JSON.parse, a wrong ID or another blocking one fails", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(
        fc.record({ parse: fc.boolean(), id: fc.boolean(), blocking: fc.boolean(), name: word }),
        ({ parse, id, blocking, name }) => {
          const ran = lint({ [PROBE]: probe({ parse, id: id ? `fabrika/${name}` : null, blocking }) }, [
            "--warn=no-debugger",
          ]);
          const blocks = Number(parse) + Number(blocking) + Number(id);
          expect(ran.stdout).toContain(`oxlint: ${blocks} blocking, 0 advice`);
          expect(ran.stdout.includes(CODE)).toBe(parse);
          expect(ran.stdout.includes(ID)).toBe(id);
          expect(ran.status, ran.stdout + ran.stderr).toBe(blocks > 0 ? 1 : 0);
          seen.add(`${parse}:${id}:${blocking}`);
        },
      ),
      { seed: 119120, numRuns: 32 },
    );
    expect(seen.size).toBe(8);
  });

  // Law 10 of docs/plan/effect-rules-small.md, and T930 L9. Only the real lint runner reads the
  // severity and the real config holds the rule's level, so two real runs stand where no generator can.
  it("scenario: the lint runner exits 1 on a wrong service ID, and 1 on a bare JSON.parse alone in a clean folder", () => {
    const wrong = lint({ [PROBE]: probe({ parse: false, id: "@kampus/libfabrika/Probe", blocking: false }) }, []);
    expect(wrong.stdout).toContain(ID);
    expect(wrong.stdout).toContain("oxlint: 1 blocking, 0 advice");
    expect(wrong.status, wrong.stdout + wrong.stderr).toBe(1);

    const parsed = lint({ [PROBE]: probe({ parse: true, id: null, blocking: false }) }, []);
    expect(parsed.stdout).toContain(CODE);
    expect(parsed.stdout).not.toContain(ID);
    expect(parsed.stdout).toContain("oxlint: 1 blocking, 0 advice");
    expect(parsed.status, parsed.stdout + parsed.stderr).toBe(1);
  });
});
