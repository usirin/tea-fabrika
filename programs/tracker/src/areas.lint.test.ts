import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Areas PR 1, today's version (docs/direction/areas.md, A1 and fix 2; the plan's a7): the tracker
// holds no list of areas. Every name comes from the ledger's `tracker/areas` stream, folded. This
// reads the tracker's own source, tests left out. Importing the stream's name, `AREAS` from
// `@kampus/pipeline/tickets/area`, is fine: declaring an `AREAS` here, or a list of names, is not.
//
//   export const AREAS = ["pipeline", "app", ...] as const     experiment 205's designs.patch: refused

const SRC = fileURLToPath(new URL(".", import.meta.url));

const sources = readdirSync(SRC)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ file: f, text: readFileSync(join(SRC, f), "utf8") }));

/** The fixed list experiment 205's designs carried: the shape of what must not come back. */
const DESIGN_AREAS = [
  "pipeline",
  "app",
  "host",
  "ledger",
  "tsh",
  "agents",
  "lint",
  "next",
  "tracker",
  "ticket",
  "trace",
  "map",
  "markdown",
  "experiments",
];

/** Each array literal of plain strings in `text`, as its strings. */
const stringArrays = (text: string): readonly (readonly string[])[] =>
  [...text.matchAll(/\[\s*((?:(["'`])[^"'`\n]*\2\s*,\s*)+(["'`])[^"'`\n]*\3\s*,?\s*)\]/g)].map((m) =>
    [...(m[1] ?? "").matchAll(/(["'`])([^"'`\n]*)\1/g)].map((s) => s[2] ?? ""),
  );

describe("the tracker's source (a7)", () => {
  it("is read: there is source to check", () => {
    expect(sources.map((s) => s.file)).toContain("machine.ts");
  });

  it("would catch the designs' list, on one line or many", () => {
    const many = `export const AREAS = [\n\t"pipeline",\n\t"app",\n\t"host",\n] as const;`;
    expect(stringArrays(many)).toEqual([["pipeline", "app", "host"]]);
    expect(stringArrays(`Schema.Literals(['tracker', 'ticket'])`)).toEqual([["tracker", "ticket"]]);
    expect(stringArrays(`Schema.Literals(["open", "closed", "all"])`)).toEqual([["open", "closed", "all"]]);
  });

  it.each(sources.map((s) => [s.file, s.text] as const))("%s declares no `AREAS`", (_, text) => {
    expect(text).not.toMatch(/\b(?:const|let|var|function|class|enum|type|interface)\s+AREAS\b/);
  });

  it.each(sources.map((s) => [s.file, s.text] as const))("%s holds no list of two or more area names", (_, text) => {
    const lists = stringArrays(text).filter((list) => list.filter((s) => DESIGN_AREAS.includes(s)).length >= 2);
    expect(lists).toEqual([]);
  });

  it.each(sources.map((s) => [s.file, s.text] as const))(
    '%s spells no area the trace names, "pipeline" or "app", as a string',
    (_, text) => {
      expect(text).not.toMatch(/(["'`])(?:pipeline|app)\1/);
    },
  );
});
