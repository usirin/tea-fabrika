// node-kinds.json names exports that code-graph treats as used (0524, ticket 933, L6). A made-up
// name would hide a dead export, so each name must be real: exported by a file its glob matches, and
// bound by that same string somewhere else in next/, as the platform binds a class by its name.
//
// The glob is package-relative, as in code-graph 0.15.0's `conventionMatcher`: "src/brain.ts" matches
// `src/brain.ts` inside the nearest folder with a package.json. Test files are left out, as code-graph
// and exam-paths.json class them.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, matchesGlob } from "node:path";
import { Schema } from "effect";
import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..", "..");
const CODE = /\.[cm]?[jt]sx?$/;
const TEST = /(?:\.test\.tsx?|Test\.ts|\.test-support\.ts)$/;

const Kinds = Schema.fromJsonString(
  Schema.Struct({
    entryExportConventions: Schema.Record(
      Schema.String,
      Schema.Struct({ files: Schema.String, exports: Schema.Array(Schema.String) }),
    ),
  }),
);

const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
  .stdout.split("\0")
  .filter((p) => p !== "");

const packages = tracked
  .filter((p) => p.endsWith("package.json"))
  .map((p) => dirname(p))
  .sort((a, b) => b.length - a.length);

/** A path inside its nearest package, as code-graph matches a convention's glob against it. */
const inPackage = (path: string) => {
  const dir = packages.find((d) => d === "." || path.startsWith(`${d}/`)) ?? ".";
  return dir === "." ? path : path.slice(dir.length + 1);
};

const sources = tracked.filter((p) => p.startsWith("next/") && CODE.test(p) && !TEST.test(p));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** A file's text with every comment blanked, so a name in a comment is no binding. */
const code = (path: string) => {
  const text = read(path);
  const { comments } = parseSync(path, text);
  return comments.reduce((out, c) => out.slice(0, c.start) + " ".repeat(c.end - c.start) + out.slice(c.end), text);
};

const exported = (path: string) =>
  parseSync(path, read(path)).module.staticExports.flatMap((e) => e.entries.map((x) => x.exportName.name));

/** What is wrong with one names file, as one line per problem; empty when every name is real. */
const problems = (text: string) => {
  const kinds = Schema.decodeUnknownSync(Kinds)(text);
  const found: string[] = [];

  for (const [name, { files, exports }] of Object.entries(kinds.entryExportConventions)) {
    const homes = tracked.filter((p) => CODE.test(p) && !TEST.test(p) && matchesGlob(inPackage(p), files));

    if (homes.length === 0) {
      found.push(`${name}: its glob ${files} matches no file`);
      continue;
    }

    const names = new Set(homes.flatMap(exported));
    const others = sources.filter((p) => !homes.includes(p)).map(code);

    for (const binding of exports) {
      if (!names.has(binding)) {
        found.push(`${name}: ${binding} is not exported by ${homes.join(", ")}`);
      }

      const literal = new RegExp(`(["'\`])${binding.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1`);

      if (!others.some((text) => literal.test(text))) {
        found.push(`${name}: ${binding} is bound by no string in next/ outside ${homes.join(", ")}`);
      }
    }
  }

  return found;
};

describe("node-kinds.json (L6)", () => {
  it("L6 scenario: every name is exported by a file its glob matches and bound by that string elsewhere in next/", () => {
    // The real file and the tracked tree: on main, RecordPart and IsolateTail, both from src/brain.ts.
    const text = readFileSync(join(ROOT, "node-kinds.json"), "utf8");
    expect(Object.keys(Schema.decodeUnknownSync(Kinds)(text).entryExportConventions)).not.toEqual([]);
    expect(problems(text)).toEqual([]);
  });
});
