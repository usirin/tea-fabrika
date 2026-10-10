import { describe, expect, it } from "vitest";
import { oneImportAway, stem } from "./imports.ts";

// The free cut before the missing-file check: a candidate stays only if it is
// one import from a changed file, either way, matched by name (experiment 38).

const file = (path: string, text = "") => ({ path, text });
/** The paths `oneImportAway` keeps. */
const kept = (candidates: readonly { path: string; text: string }[], changed: readonly { path: string; text: string }[]) =>
  oneImportAway(candidates, changed).map((c) => c.path);

describe("a file's stem", () => {
  it("is its name up to the first dot", () => {
    expect(stem("src/check-verb.unit.test.ts")).toBe("check-verb");
    expect(stem("src/index.ts")).toBe("index");
    expect(stem(".eslintrc.json")).toBe("");
  });
});

describe("the files one import from a change", () => {
  const parse = file("src/parse.ts", "export function parse() {}");

  it("keep a file that imports a changed file", () => {
    expect(kept([file("src/cli.ts", `import { parse } from "./parse.ts";`)], [parse])).toEqual(["src/cli.ts"]);
  });

  it("keep a file a changed file imports, as the change left it", () => {
    const changed = file("src/parse.ts", `import { HOUR } from "./units.ts";\nexport function parse() {}`);

    expect(kept([file("src/units.ts", "export const HOUR = 3600;")], [changed])).toEqual(["src/units.ts"]);
  });

  it("keep a test that imports its changed source, and a source whose test changed", () => {
    const test = file("src/leaks.unit.test.ts", `import { leaks } from "./leaks.ts";`);
    const source = file("src/leaks.ts", "export const leaks = 1;");

    expect(kept([test], [source])).toEqual(["src/leaks.unit.test.ts"]);
    expect(kept([source], [test])).toEqual(["src/leaks.ts"]);
  });

  it("drop a file with no link either way, even one on the same subject", () => {
    expect(kept([file("src/format.ts", "// formats what parse reads\nexport function format() {}")], [parse])).toEqual([]);
  });

  it("match an import with any extension, or none, but not a longer name", () => {
    const importing = (spec: string) => file("src/cli.ts", `import { parse } from "${spec}";`);

    for (const spec of ["./parse.ts", "./parse.js", "./parse", "../src/parse.ts", "./parse.unit.test.ts"]) {
      expect(kept([importing(spec)], [parse]), spec).toEqual(["src/cli.ts"]);
    }
    for (const spec of ["./parser.ts", "./parse-utils.ts", "./reparse.ts"]) {
      expect(kept([importing(spec)], [parse]), spec).toEqual([]);
    }
  });

  it("match by name alone: a changed `index` reaches any file importing an `index`, and a folder import reaches no index", () => {
    const other = file("lib/other.ts", `export * from "../elsewhere/index.ts";`);
    const changedApp = file("src/app.ts", `import { hours } from "./time";`);

    expect(kept([other], [file("src/time/index.ts")])).toEqual(["lib/other.ts"]);
    expect(kept([file("src/time/index.ts", "export const hours = 1;")], [changedApp])).toEqual([]);
  });

  it("still keep the importers of a file the change deleted, which reads as empty", () => {
    expect(kept([file("src/cli.ts", `import { parse } from "./parse.ts";`)], [file("src/parse.ts", "")])).toEqual(["src/cli.ts"]);
  });

  it("never match through a changed dotfile, which has no name to import", () => {
    expect(kept([file("src/cli.ts", `import x from "./.eslintrc.json";`)], [file(".eslintrc.json", "{}")])).toEqual([]);
  });
});
