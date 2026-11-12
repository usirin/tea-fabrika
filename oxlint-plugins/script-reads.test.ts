import { posix } from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { reached, scriptReads } from "./script-reads.mjs";

// Today's tooling. No schemas describe source text. Graphs hold cycles, unreferenced scripts and
// every naming form; the oracle walks the generated edges, never the source text. The edge cases
// the derivation's comment lists are one scenario each below.
const options = { seed: 119120, numRuns: 100 };
const refs = fc.array(fc.nat({ max: 19 }), { maxLength: 3 });

const model = fc.record({
  skills: fc.array(fc.array(refs, { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 4 }),
  tests: fc.array(refs, { maxLength: 3 }),
  form: fc.integer({ min: 0, max: 4 }),
});

type Model = typeof model extends fc.Arbitrary<infer T> ? T : never;

/** How `from` names `path`: its basename in three spellings, a path relative to `from`, or from the top. */
const forms = (from: string, path: string, form: number) => {
  const name = posix.basename(path);
  return [
    `"${name}"`,
    `join(import.meta.dirname, "${name}")`,
    `. "$(dirname "$0")/${name}"`,
    `"${posix.relative(posix.dirname(from), path).replace(/^(?!\.)/, "./")}"`,
    `join(env.MAIN, "${path}")`,
  ][form]!;
};

const none = () => false;

/** A generated tree, and for each test the set of files its edges reach. */
const build = ({ skills, tests, form }: Model) => {
  const files = skills.flatMap((scripts, s) =>
    scripts.map((edges, i) => ({ path: `.agents/skills/s${s}/scripts/s${s}file${i}.sh`, edges })),
  );
  const edges = files.map((f) => [...new Set(f.edges.map((n) => n % files.length))]);
  const tree = new Map<string, string>();
  files.forEach((file, i) => {
    tree.set(
      file.path,
      [
        ...edges[i]!.map((n) => forms(file.path, files[n]!.path, form)),
        // A basename inside a longer word, and a test's name, are not reads.
        ...files.map((f) => `# prefix${posix.basename(f.path)}suffix`),
        "# check0.test.ts",
      ].join("\n"),
    );
  });
  const expected = new Map<string, Set<string>>();
  tests.forEach((roots, i) => {
    const path = `.agents/skills/s0/scripts/check${i}.test.ts`;
    const start = [...new Set(roots.map((n) => n % files.length))];
    tree.set(path, start.map((n) => `// ${forms(path, files[n]!.path, form)}`).join("\n"));
    const reach = new Set(start);

    for (const n of reach) {
      for (const edge of edges[n]!) {
        reach.add(edge);
      }
    }

    expected.set(path, new Set([...reach].map((n) => files[n]!.path)));
  });
  return { files, edges, tree, expected };
};

describe("reached", () => {
  it("is exactly what the edges reach, in every naming form, each with a file that names it", () => {
    fc.assert(
      fc.property(model, (input) => {
        const { files, edges, tree, expected } = build(input);

        for (const [test, want] of expected) {
          const got = reached(tree, none, test);
          expect(new Set(got.keys())).toEqual(want);

          for (const [path, via] of got) {
            const from = files.findIndex((f) => f.path === via);
            const to = files.findIndex((f) => f.path === path);
            expect(from < 0 ? via === test : edges[from]!.includes(to)).toBe(true);
          }
        }
      }),
      options,
    );
  });

  it("scenario: a path built from a variable is missed, until the reading script names the file", () => {
    const tree = new Map([
      [".agents/skills/a/scripts/run.ts", `const script = join(import.meta.dirname, \`\${step}.sh\`);`],
      [".agents/skills/a/scripts/plan.sh", "echo plan"],
      [".agents/skills/a/scripts/run.test.ts", 'spawnSync("node", [join(import.meta.dirname, "run.ts")]);'],
    ]);
    const test = ".agents/skills/a/scripts/run.test.ts";
    expect([...reached(tree, none, test).keys()]).toEqual([".agents/skills/a/scripts/run.ts"]);
    expect(scriptReads(tree, none, () => "").unreached).toEqual([".agents/skills/a/scripts/plan.sh"]);
    const named = new Map(tree).set(
      ".agents/skills/a/scripts/run.ts",
      `// Runs plan.sh, by the step's name.\n${tree.get(".agents/skills/a/scripts/run.ts")}`,
    );
    expect(reached(named, none, test).get(".agents/skills/a/scripts/plan.sh")).toBe(".agents/skills/a/scripts/run.ts");
    expect(scriptReads(named, none, () => "").unreached).toEqual([]);
  });

  it("scenario: a shell script that sources another reaches it, and what that one runs in turn", () => {
    const tree = new Map([
      [".agents/skills/a/scripts/box.sh", '. "$(dirname "$0")/env.sh"\nexec node "$here/box.ts"'],
      [".agents/skills/a/scripts/env.sh", 'exec sh "$(dirname "$0")/../../b/scripts/redact.sh"'],
      [".agents/skills/b/scripts/redact.sh", "sed s/x/y/"],
      [".agents/skills/a/scripts/box.ts", ""],
      [".agents/skills/a/scripts/box.test.ts", 'const box = join(import.meta.dirname, "box.sh");'],
    ]);
    expect(Object.fromEntries(reached(tree, none, ".agents/skills/a/scripts/box.test.ts"))).toEqual({
      ".agents/skills/a/scripts/box.sh": ".agents/skills/a/scripts/box.test.ts",
      ".agents/skills/a/scripts/env.sh": ".agents/skills/a/scripts/box.sh",
      ".agents/skills/a/scripts/box.ts": ".agents/skills/a/scripts/box.sh",
      ".agents/skills/b/scripts/redact.sh": ".agents/skills/a/scripts/env.sh",
    });
  });

  it("scenario: a file only read at run time, under BOXES or made by the test, reaches nothing", () => {
    const tree = new Map([
      [
        ".agents/skills/a/scripts/lane.ts",
        [
          `const state = join(env.BOXES, "state", \`\${lane}.json\`);`,
          'writeFileSync("./out.json", x);',
          'readFileSync("runs/last.json");',
        ].join("\n"),
      ],
      [".agents/skills/a/scripts/lane.test.ts", '"lane.ts"'],
    ]);
    expect([...reached(tree, none, ".agents/skills/a/scripts/lane.test.ts").keys()]).toEqual([
      ".agents/skills/a/scripts/lane.ts",
    ]);
    expect(scriptReads(tree, none, () => "")).toEqual({ raw: [], unreached: [] });
  });

  it("scenario: a cycle ends, and each file in it is reached through the other", () => {
    const tree = new Map([
      [".agents/skills/a/scripts/a.sh", 'sh "$(dirname "$0")/b.sh"'],
      [".agents/skills/a/scripts/b.sh", 'sh "$(dirname "$0")/a.sh"'],
      [".agents/skills/a/scripts/a.test.ts", '"a.sh"'],
    ]);
    expect(Object.fromEntries(reached(tree, none, ".agents/skills/a/scripts/a.test.ts"))).toEqual({
      ".agents/skills/a/scripts/a.sh": ".agents/skills/a/scripts/a.test.ts",
      ".agents/skills/a/scripts/b.sh": ".agents/skills/a/scripts/a.sh",
    });
  });

  it("scenario: a file outside the scripts tree is reached when it exists, as a leaf, never Markdown, in node_modules or above", () => {
    const outside = new Set([
      "next/apps/x/rows.ts",
      "next/apps/x/deep.ts",
      ".github/ci/package.json",
      "exam-paths.json",
      "node_modules/pkg/index.js",
      "AGENTS.md",
      ".agents/skills/a/SKILL.md",
    ]);
    const tree = new Map([
      [
        ".agents/skills/a/scripts/check.ts",
        [
          'import { rows } from "../../../../next/apps/x/rows.ts";',
          'createRequire(new URL("../../../../.github/ci/package.json", import.meta.url));',
          'readFileSync(join(env.MAIN, "exam-paths.json"));',
          'import "../../../../node_modules/pkg/index.js";',
          'readFileSync("../../../../../above.txt");',
          'readFileSync(join(env.MAIN, "missing/file.json"));',
          "// As AGENTS.md says, and ../SKILL.md.",
        ].join("\n"),
      ],
      [".agents/skills/a/scripts/check.test.ts", '"check.ts"'],
    ]);
    // rows.ts imports deep.ts, but a file outside the scripts tree is never read for names.
    expect(
      [...reached(tree, (path) => outside.has(path), ".agents/skills/a/scripts/check.test.ts").keys()].sort(),
    ).toEqual([
      ".agents/skills/a/scripts/check.ts",
      ".github/ci/package.json",
      "exam-paths.json",
      "next/apps/x/rows.ts",
    ]);
  });
});

describe("scriptReads", () => {
  const imports = (path: string, form: number, n: number) =>
    [
      `import  "${path}?raw";`,
      `import"${path}?raw"`,
      `import value${n} from "${path}?raw";`,
      `import {one as one${n}} from "${path}?raw";`,
      `import "${path}";`,
      `const value${n} = await import("${path}?raw");`,
    ][form]!;

  const fixtures = (statement: string, form: number) =>
    [`// ${statement}`, `/* ${statement} */`, `${JSON.stringify(statement)};`, `\`\n${statement}\n\`;`][form]!;

  it("raw is exactly the bare ?raw imports, never a value import, a dynamic one, a comment or a string", () => {
    const line = fc.record({
      target: fc.nat({ max: 3 }),
      form: fc.nat({ max: 5 }),
      fixture: fc.option(fc.nat({ max: 3 })),
    });
    fc.assert(
      fc.property(fc.array(line, { maxLength: 6 }), (lines) => {
        const targets = ["./run.sh", "../../b/scripts/env.sh", "../../../../exam-paths.json", "./sub/x.ts"];
        const test = ".agents/skills/a/scripts/run.test.ts";
        const source = lines
          .map(({ target, form, fixture }, n) => {
            const statement = imports(targets[target]!, form, n);
            return fixture === null ? statement : fixtures(statement, fixture);
          })
          .join("\n");
        const want = lines
          .filter(({ form, fixture }) => form < 2 && fixture === null)
          .map(({ target }) => ({ test, path: posix.join(posix.dirname(test), targets[target]!) }));
        expect(scriptReads(new Map([[test, source]]), none, () => "").raw).toEqual(want);
      }),
      options,
    );
  });

  it("unreached is exactly the scripts no test reaches and no SKILL.md names", () => {
    fc.assert(
      fc.property(model, fc.array(fc.nat({ max: 19 }), { maxLength: 4 }), (input, named) => {
        const { files, tree, expected } = build(input);
        const tools = new Set(named.map((n) => files[n % files.length]!.path));
        // Each skill's tool table, plus a basename inside a longer word, which names no tool.
        const prose = (skill: string) =>
          files
            .filter(({ path }) => skill === `${path.split("/").slice(0, 3).join("/")}/SKILL.md`)
            .map(({ path }) =>
              tools.has(path) ? `| \`${posix.basename(path)}\` | a tool |` : `prefix${posix.basename(path)}`,
            )
            .join("\n");
        const reach = new Set([...expected.values()].flatMap((paths) => [...paths]));
        const want = files.map((f) => f.path).filter((path) => !reach.has(path) && !tools.has(path));
        expect(scriptReads(tree, none, prose).unreached).toEqual(want);
      }),
      options,
    );
  });

  it("scenario: a nested tool is named in SKILL.md by its path under scripts/, not its basename alone", () => {
    const tree = new Map([
      [".agents/skills/a/scripts/flow/run.ts", ""],
      [".agents/skills/a/scripts/run.ts", ""],
    ]);
    const prose = (skill: string) =>
      skill === ".agents/skills/a/SKILL.md" ? "| `flow/run.ts <flow-file>` | run one flow |" : "";
    expect(scriptReads(tree, none, prose).unreached).toEqual([".agents/skills/a/scripts/run.ts"]);
  });
});
