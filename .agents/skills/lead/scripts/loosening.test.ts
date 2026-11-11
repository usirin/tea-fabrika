import "./catchup.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./freshmain.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./land.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.ts?raw";
import "./mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.Dockerfile?raw";
import "../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/limit.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/sample.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/scope.ts?raw";
import "./loosening.sh?raw";
import "./leakgrep.sh?raw";
import "./skillscheck.sh?raw";
import "./box.sh?raw";
import "./keepruns.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./runid.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pgrep.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./agents.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./boxnode.ts?raw";
import "./fieldrow.py?raw";
import "./runplan.sh?raw";
import "./env.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gc.ts?raw";
import "./redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
import "./clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./lane.ts?raw";
import "../../plan/scripts/plancheck.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./sizecap.ts?raw";
import "../../step-commit/scripts/exam.py?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const script = process.env.T318_LOOSENING_SCRIPT ?? join(import.meta.dirname, "loosening.sh");
const word = fc.stringMatching(/^[a-z]{2,12}$/);

const input = fc.record({
  name: word,
  extra: word,
  title: fc.constantFrom("it", "test"),
  count: fc.integer({ min: 20, max: 200 }),
  delta: fc.integer({ min: 1, max: 8 }),
  space: fc.constantFrom(" ", "\n\t"),
});

type Input = {
  name: string;
  extra: string;
  title: string;
  count: number;
  delta: number;
  space: string;
};

const source = (v: Input, body = "expect(value).toBe(value);", modifier = "", title = v.name, options = "") =>
  `${v.title}${modifier}(${JSON.stringify(title)}, () => { fc.assert(fc.property(fc.integer({min: ${-v.count}, max: ${v.count}}), value => { ${body} }), {numRuns: ${v.count}${options}}); });\n`;

const env = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  TYPESAFE_API_KEY: undefined,
};

type File = string | { content: string; mode: number } | { link: string };

const compare = (before: Record<string, File>, after: Record<string, File>, mapping?: string) => {
  const dir = mkdtempSync(join(tmpdir(), "loosening-"));
  const git = (...args: string[]) => {
    const ran = spawnSync("/usr/bin/git", ["-C", dir, ...args], {
      encoding: "utf8",
      env,
      timeout: 15_000,
    });
    expect(ran.error).toBeUndefined();
    expect(ran.status, ran.stderr).toBe(0);
    return ran.stdout.trim();
  };

  try {
    git("init", "-q", "--initial-branch=main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    expect(git("remote")).toBe("");
    // Use the real exam classifier, with generated paths covered by the real list.
    const rows = [
      { glob: "checks/**/*.test.ts" },
      { glob: "checks/**/*.test.tsx" },
      ...["skillscheck.sh", "exam-paths.json", "vitest.config.ts", ".github/workflows/check.yml"].map((glob) => ({
        glob,
      })),
    ];
    writeFileSync(join(dir, "exam-paths.json"), JSON.stringify(rows));
    const write = (files: Record<string, File>) => {
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        rmSync(join(dir, path), { force: true });

        if (typeof content === "string") {
          writeFileSync(join(dir, path), content);
        } else if ("link" in content) {
          symlinkSync(content.link, join(dir, path));
        } else {
          writeFileSync(join(dir, path), content.content, { mode: content.mode });
        }
      }

      git("add", ".");
      git("commit", "-qm", "fixture", "--allow-empty");
      return git("rev-parse", "HEAD");
    };
    const base = write(before);

    for (const path of Object.keys(before)) {
      if (!(path in after)) {
        rmSync(join(dir, path));
      }
    }

    const head = write(after);
    const args = [script, base, head];

    if (mapping !== undefined) {
      writeFileSync(join(dir, "mapping.md"), mapping);
      args.push(join(dir, "mapping.md"));
    }

    const got = spawnSync("sh", args, { cwd: dir, encoding: "utf8", env, timeout: 5_000 });
    expect(got.error).toBeUndefined();
    expect(got.signal).toBeNull();
    return { code: got.status, text: got.stdout + got.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const file = "checks/nested/generated.test.ts";

const flagged = (v: Input, before: string, after: string, kind: string, mapping?: string) => {
  const got = compare({ [file]: before }, { [file]: after }, mapping);
  expect(got.code, got.text).toBe(1);
  expect(got.text).toContain(`${file}: ${kind}: ${v.name}`);
};

describe("loosening, today's tooling", () => {
  // Plant: classify from head alone, letting a deleted row hide its deleted exam.
  it("T318 either ref's exam list protects deleted or newly classified laws", () => {
    fc.assert(
      fc.property(input, word, (v, folder) => {
        const path = `${folder}/${v.extra}.ts`;

        for (const side of ["base", "head"]) {
          const rows = JSON.stringify([{ glob: `${folder}/**/*.ts` }]);
          const got = compare(
            { [path]: source(v), "exam-paths.json": side === "base" ? rows : "[]" },
            { "exam-paths.json": side === "head" ? rows : "[]" },
          );
          expect(got.code, got.text).toBe(1);
          expect(got.text).toContain(`${path}: removed law: ${v.name}`);
        }
      }),
      { seed: 31830, numRuns: 5, endOnFailure: true },
    );
  });

  const form = fc.record({
    base: fc.constantFrom("it", "test"),
    alias: fc.constantFrom("direct", "import", "const", "namespace", "destructure", "extended"),
    parameter: fc.constantFrom("", ".each([1, 2])", ".for([1, 2])"),
    options: fc.constantFrom("inline", "shared", "spread"),
    last: fc.boolean(),
    quote: fc.constantFrom("'", '"', "`"),
    chainFirst: fc.boolean(),
  });
  type Form = {
    base: string;
    alias: string;
    parameter: string;
    options: string;
    last: boolean;
    quote: string;
    chainFirst?: boolean;
  };
  const call = (v: Input, shape: Form, suite: boolean, modifier = "", option = "") => {
    const base = suite ? (shape.base === "it" ? "describe" : "suite") : shape.base;
    const alias = `law_${v.extra}`;
    const prefix =
      shape.alias === "import"
        ? `import {${base} as ${alias}} from 'vitest';\n`
        : shape.alias === "const"
          ? `const ${alias} = ${base};\n`
          : shape.alias === "destructure"
            ? `import * as checks from 'vitest';\nconst {${base}: ${alias}} = checks;\n`
            : shape.alias === "extended"
              ? `const ${alias} = ${suite ? base : `${base}.extend({})`};\n`
              : shape.alias === "namespace"
                ? "import * as checks from 'vitest';\n"
                : "";
    const target = shape.alias === "direct" ? base : shape.alias === "namespace" ? `checks.${base}` : alias;
    const options = option
      ? shape.options === "inline"
        ? `{${option}: true}`
        : shape.options === "spread"
          ? `{...settings}`
          : "settings"
      : "{}";
    const shared = option && shape.options !== "inline" ? `const settings = {${option}: true};\n` : "";
    const body = suite ? `() => { test('${v.extra}', () => check(value)); }` : "() => check(value)";
    const args = shape.last ? `${body}, ${options}` : `${options}, ${body}`;
    return `${prefix}${shared}${target}${shape.chainFirst ? shape.parameter + modifier : modifier + shape.parameter}(${shape.quote}${v.name}${shape.quote}, ${args});\n`;
  };

  // Plants: recognize only direct it/test names, dot modifiers, or one options position.
  it.each(["skipIf", "runIf", "skip", "todo", "only", "fails"])(
    "T318 generated test and suite forms report %s muting",
    (kind) => {
      fc.assert(
        fc.property(input, form, (v, shape) => {
          for (const suite of kind === "fails" ? [false] : [false, true]) {
            const conditional = kind === "skipIf" || kind === "runIf";
            const modifier = conditional ? `.${kind}(${kind === "skipIf" ? "true" : "false"})` : "";
            const got = compare(
              { [file]: call(v, shape, suite) },
              { [file]: call(v, shape, suite, modifier, conditional ? "" : kind) },
            );
            expect(got.code, got.text).toBe(1);
            expect(got.text).toContain(`${file}: ${kind === "fails" ? "it.fails" : kind}:`);
          }
        }),
        { seed: 31831, numRuns: 12, endOnFailure: true },
      );
    },
  );

  // Plant: miss an aliased call when neither expect nor fc.property appears directly.
  it("T318 removed aliased law calls remain laws across generated source forms", () => {
    fc.assert(
      fc.property(input, form, (v, shape) => {
        flagged(v, call(v, shape, false), "", "removed law");
      }),
      { seed: 31832, numRuns: 12, endOnFailure: true },
    );
  });

  const range = fc.record({
    generator: fc.constantFrom("integer", "float", "double", "string", "array"),
    key: fc.constantFrom("min", "max", "minLength", "maxLength"),
    shared: fc.boolean(),
    bound: fc.integer({ min: 200, max: 2000 }),
    wrapped: fc.boolean(),
  });
  type Range = { generator: string; key: string; shared: boolean; bound: number; wrapped: boolean };
  const ranged = (v: Input, r: Range, value: number | undefined, decoy = "") => {
    const key = ["array", "string"].includes(r.generator)
      ? r.key.startsWith("min")
        ? "minLength"
        : "maxLength"
      : r.key.startsWith("min")
        ? "min"
        : "max";
    const options = value === undefined ? "" : `{${key}: ${value}}`;
    const arg = r.shared && options ? "settings" : options;
    const generator = `fc.${r.generator}(${r.generator === "array" ? `fc.integer()${arg ? ", " : ""}` : ""}${arg})`;
    const prelude = r.shared && options ? `const settings = ${options};\n` : "";
    const active = r.wrapped ? `const active_${v.extra} = ${generator};\n` : "";
    return `${prelude}${active}${r.wrapped ? decoy : ""}${v.title}('${v.name}', () => { ${r.wrapped ? "" : decoy} fc.assert(fc.property(${r.wrapped ? `active_${v.extra}` : generator}, check)); });\n`;
  };

  // Plants: compare only bounds already present, ignore shared objects, or match an unused call.
  it.each(["added", "shared", "unused"])("T318 generated generator source forms expose %s narrowing", (kind) => {
    fc.assert(
      fc.property(input, range, (v, shape) => {
        const r = { ...shape, shared: kind === "shared" || shape.shared };
        const start = r.key.startsWith("min") && !["array", "string"].includes(r.generator) ? -r.bound : r.bound;
        const end = start + (r.key.startsWith("min") ? v.delta : -v.delta);
        const before = ranged(v, r, kind === "added" ? undefined : start);
        const decoy =
          kind === "unused"
            ? `${
                ranged(v, { ...r, shared: false, wrapped: false }, start)
                  .split("fc.property(")[1]!
                  .split(", check")[0]
              };`
            : "";
        const got = compare({ [file]: before }, { [file]: ranged(v, r, end, decoy) });
        expect(got.code, got.text).toBe(1);
        expect(got.text).toContain(": tighter fast-check bound:");
      }),
      { seed: 31833, numRuns: 12, endOnFailure: true },
    );
  });

  // Plant: drop a numRuns option and quietly restore fast-check's default of 100.
  it("T318 removing generated high run counts is a hit for inline and shared options", () => {
    fc.assert(
      fc.property(input, fc.integer({ min: 101, max: 2000 }), fc.boolean(), (v, runs, shared) => {
        const options = `{seed: ${v.count}, numRuns: ${runs}}`;
        const before = `${
          shared ? `const settings = ${options};\n` : ""
        }${call(v, { base: v.title, alias: "direct", parameter: "", options: "inline", last: false, quote: "'" }, false)}\nfc.assert(fc.property(fc.integer(), check), ${shared ? "settings" : options});`;
        const after = before.replace(`, numRuns: ${runs}`, "");
        const got = compare({ [file]: before }, { [file]: after });
        expect(got.code, got.text).toBe(1);
        expect(got.text).toContain(": fewer numRuns:");
      }),
      { seed: 31834, numRuns: 8, endOnFailure: true },
    );
  });

  // Plants: clear additions or wrapping in an existing file; reject an in-place mapped rename.
  it("T318 source forms hit existing additions and wrapping but clear in-place mapped renames", () => {
    fc.assert(
      fc.property(input, form, range, (v, shape, r) => {
        const before = call(v, shape, false);
        const renamed = `${v.name}-new`;

        for (const [after, mapping, code] of [
          [before + source(v, undefined, "", renamed), undefined, 1],
          [before.replaceAll(" ", v.space), undefined, v.space === " " ? 0 : 1],
          [
            call({ ...v, name: renamed }, shape, false),
            `| Removed | Replacement |\n| --- | --- |\n| ${v.name} | ${renamed} |`,
            0,
          ],
        ] as const) {
          const got = compare({ [file]: before }, { [file]: after }, mapping);
          expect(got.code, got.text).toBe(code);
        }

        const start = r.bound;
        const end = start + (r.key.startsWith("min") ? -v.delta : v.delta);
        const wider = compare({ [file]: ranged(v, r, start) }, { [file]: ranged(v, r, end) });
        expect(wider.code, wider.text).toBe(1);
      }),
      { seed: 31835, numRuns: 12, endOnFailure: true },
    );
  });

  // Plant: stop reporting a disappeared it/test/fc.property, or trust a mapping with no replacement.
  it("T318 removed laws and properties require an existing named replacement", () => {
    fc.assert(
      fc.property(input, (v) => {
        const original = source(v);

        for (const after of ["", `// ${original}`, original.replace("fc.property", "fc.sample")]) {
          flagged(v, original, after, "removed law");
        }

        flagged(
          v,
          original,
          "",
          "removed law",
          `| Removed | Replacement |\n| --- | --- |\n| ${v.name} | nonexistent |`,
        );
        const deleted = compare({ [file]: original }, {});
        expect(deleted.code).toBe(1);
        expect(deleted.text).toContain(`${file}: removed law: ${v.name}`);
      }),
      { seed: 3181, numRuns: 4 },
    );
  });

  // Plants: ignore skip, todo, it.fails, or only, including describe and parameterized tests.
  it("T318 each muting modifier is reported even when the law name survives", () => {
    fc.assert(
      fc.property(input, (v) => {
        for (const modifier of ["skip", "todo", "fails", "only"]) {
          const got = compare({ [file]: source(v) }, { [file]: source(v, undefined, `.${modifier}`) });
          expect(got.code, got.text).toBe(1);
          expect(got.text).toContain(`${file}: ${modifier === "fails" ? "it.fails" : modifier}:`);
        }

        for (const modifier of ["skip", "only"]) {
          const got = compare(
            { [file]: `describe('${v.name}', () => {${source(v)}});` },
            { [file]: `describe.${modifier}('${v.name}', () => {${source(v)}});` },
          );
          expect(got.code, got.text).toBe(1);
          expect(got.text).toContain(`: ${modifier}:`);
        }

        flagged(
          v,
          `test.each([1])('${v.name}', () => expect(1).toBe(1));`,
          `test.skip.each([1])('${v.name}', () => expect(1).toBe(1));`,
          "skip",
        );
      }),
      { seed: 3182, numRuns: 4 },
    );
  });

  // Plant: ignore a smaller numRuns or either inward bound. Exercise each key alone.
  it("T318 fewer runs and every inward fast-check bound are separate hits", () => {
    fc.assert(
      fc.property(input, (v) => {
        flagged(
          v,
          source(v),
          source(v).replace(`numRuns: ${v.count}`, `numRuns: ${v.count - v.delta}`),
          "fewer numRuns",
        );
        const shared = `const options = {numRuns: ${v.count}};\n${source(v).replace(`{numRuns: ${v.count}}`, "options")}`;
        const got = compare(
          { [file]: shared },
          { [file]: shared.replace(`numRuns: ${v.count}`, `numRuns: ${v.count - v.delta}`) },
        );
        expect(got.code, got.text).toBe(1);
        expect(got.text).toContain(": fewer numRuns:");

        for (const key of ["min", "max", "minLength", "maxLength"]) {
          const start = v.count,
            end = start + (key.startsWith("min") ? v.delta : -v.delta);
          const before = `${v.title}('${v.name}', () => fc.assert(fc.property(fc.array(fc.integer(), {${key}: ${start}}), xs => expect(xs).toBeDefined())));`;
          flagged(v, before, before.replace(`${key}: ${start}`, `${key}: ${end}`), "tighter fast-check bound");
        }
      }),
      { seed: 3183, numRuns: 4 },
    );
  });

  // Plant: compare expect counts only for the whole file; a new test must not hide an old loss.
  it("T318 removed expects are found per law despite added assertions elsewhere", () => {
    fc.assert(
      fc.property(input, (v) => {
        flagged(v, source(v), source(v, "") + source(v, undefined, "", `${v.name}-added`), "removed expect");
        flagged(v, source(v), source(v, "expect(true).toBe(true);"), "removed expect");
      }),
      { seed: 3184, numRuns: 5 },
    );
  });

  // Plants: clear existing additions or wrapping; reject mapped titles or accept a file move.
  it("T318 only identical bytes and in-place mapped renames clear existing exam files", () => {
    let accepted = 0;
    fc.assert(
      fc.property(input, (v) => {
        const before = source(v),
          renamed = `${v.name}-${v.extra}`;

        for (const [after, map, code] of [
          [before + source(v, undefined, "", renamed), undefined, 1],
          [before.replaceAll(" ", v.space), undefined, v.space === " " ? 0 : 1],
          [
            source(v, undefined, "", renamed),
            `Unrelated text\n\n| replacement | removed |\n| --- | --- |\n| \`${renamed}\` | \`${v.name}\` |\n`,
            0,
          ],
          [source(v, undefined, "", renamed), `removed | replacement\n--- | ---\n${v.name} | ${renamed}\n`, 0],
        ] as const) {
          const got = compare(
            { [file]: before, "product.ts": before },
            { [file]: after, "product.ts": "it.skip('ignored');" },
            map,
          );
          expect(got.code, got.text).toBe(code);

          if (code === 0) {
            expect(got.text.trim()).toBe(`loosening: 0 hits in ${after === before ? 0 : 1} exam files`);
            accepted++;
          }
        }

        const moved = compare(
          { [file]: before },
          { "checks/moved.test.tsx": source(v, undefined, "", renamed) },
          `| removed | replacement |\n| --- | --- |\n| ${v.name} | ${renamed} |`,
        );
        expect(moved.code, moved.text).toBe(1);

        for (const after of [
          before.replace("fc.assert(", "fc.integer({min: 0, max: 1}); fc.assert("),
          before
            .replace(`min: ${-v.count}`, `min: ${-v.count - v.delta}`)
            .replace(`max: ${v.count}`, `max: ${v.count + v.delta}`)
            .replace(`numRuns: ${v.count}`, `numRuns: ${v.count + v.delta}`),
        ]) {
          expect(compare({ [file]: before }, { [file]: after }).code).toBe(1);
        }

        const onlyProduct = compare({ "product.ts": before }, { "product.ts": "it.only('ignored');" });
        expect(onlyProduct.code).toBe(0);
        expect(onlyProduct.text).toContain("0 hits in 0 exam files");
        accepted++;
        const existing = `describe.skip('${v.name}', () => {${before}});`;
        const shifted = compare(
          { [file]: existing },
          { [file]: `// ${v.extra}\n${existing}\n${source(v, undefined, "", renamed)}` },
        );
        expect(shifted.code, shifted.text).toBe(1);
      }),
      { seed: 3185, numRuns: 4 },
    );
    console.info(
      `T318 loosening: ${accepted} clean diffs accepted, 0 false alarms; history measurement belongs to lead`,
    );
  });

  // Plant: ignore matcher arguments and silently clear a changed expected value.
  it("T318 updating a matcher argument is an unrecognized change", () => {
    fc.assert(
      fc.property(input, (v) => {
        const before = source(v),
          after = before.replace(".toBe(value)", `.toBe(${v.count})`);
        const got = compare({ [file]: before }, { [file]: after });
        expect(got.code, got.text).toBe(1);
        expect(got.text).toContain(`${file}: unrecognized change: line 1`);
      }),
      { seed: 3186, numRuns: 4 },
    );
  });

  // Plants: clear a token edit inside an old body or accept a mapped title with a changed body.
  it("T318 fail closed on generated old body and old statement edits", () => {
    fc.assert(
      fc.property(input, (v) => {
        const before = source(v);

        for (const after of [
          before.replace("toBe(value)", `toBe(${v.count})`),
          before.replace("fc.assert(", "return; fc.assert("),
          before.replace("fc.assert(", "if (false) fc.assert("),
          before.replace("fc.integer(", "fc.nat("),
          before.replace("expect(value)", "expect(value + 1)"),
        ]) {
          const got = compare({ [file]: `// ${v.extra}\n${before}` }, { [file]: `// ${v.extra}\n${after}` });
          expect(got.code, got.text).toBe(1);
          expect(got.text).toMatch(/unrecognized change: line \d+/);
        }

        const statement = `const size_${v.extra} = ${v.count};\n`;
        expect(
          compare(
            { [file]: statement + before },
            { [file]: statement.replace(`${v.count}`, `${v.count + v.delta}`) + before },
          ).code,
        ).toBe(1);
        const renamed = `${v.name}-new`;
        expect(
          compare(
            { [file]: before },
            { [file]: source(v, `expect(value).toBe(${v.count});`, "", renamed) },
            `| Removed | Replacement |\n| --- | --- |\n| ${v.name} | ${renamed} |`,
          ).code,
        ).toBe(1);
      }),
      { seed: 31840, numRuns: 4, endOnFailure: true },
    );
  });

  // Plant: the old named-pattern-only parser clears these review2 misses. Each case runs alone.
  it.each(["aliases", "conditions", "options", "removals", "assertions", "ranges"])(
    "T318 review2 %s forms cannot clear a generated weaker law",
    (kind) => {
      fc.assert(
        fc.property(input, (v) => {
          const pairs: [string, string][] = [];
          const body = `() => expect(value).toBe(${v.count})`;
          const law = (target: string, options = "") =>
            `${target}('${v.name}', ${options ? `${options}, ` : ""}${body});\n`;

          if (kind === "aliases") {
            for (const root of ["it", "test", "describe"]) {
              for (const flag of ["skip", "todo", "fails", "only", "skipIf(true)", "runIf(false)"]) {
                const original = `const law_${v.extra} = ${root};\n${law(`law_${v.extra}`)}`;
                pairs.push([original, original.replace(`= ${root};`, `= ${root}.${flag};`)]);
              }
            }
          }

          if (kind === "conditions") {
            for (const root of ["it", "test", "describe", "suite"]) {
              for (const flag of ["skipIf", "runIf"]) {
                const off = flag === "skipIf" ? "false" : "true";
                pairs.push([
                  law(`${root}.${flag}(${off})`),
                  law(`${root}.${flag}(${off === "true" ? "false" : "true"})`),
                ]);
              }
            }
          }

          if (kind === "options") {
            for (const flag of ["skip", "todo", "only", "fails"]) {
              for (const root of ["it", "describe"]) {
                for (const declaration of [
                  `const settings: Options = {${flag}: false};`,
                  `const settings = {${flag}: false} as const;`,
                  `const settings = <Options>{${flag}: false};`,
                  `const settings = {['${flag}']: false};`,
                  `const muted = false; const settings = {${flag}: muted};`,
                  `const settings = {}; settings.${flag} = false;`,
                ]) {
                  const original = `${declaration}\n${law(root, "settings")}`;
                  pairs.push([original, original.replace("false", "true")]);
                }
              }
            }
          }

          if (kind === "removals") {
            for (const root of ["it", "test"]) {
              for (const table of [
                "",
                `.each\`value | answer\n\${${v.count}} | \${${v.count}}\``,
                `.for\`value | answer\n\${${v.count}} | \${${v.count}}\``,
              ]) {
                const prelude = `const title = '${v.name}';\n`;
                pairs.push([`${prelude}${root}${table}(title, () => check(value));\n`, prelude]);

                if (table) {
                  pairs.push([`${root}${table}('${v.name}', () => check(value));\n`, ""]);
                }
              }
            }
          }

          if (kind === "assertions") {
            const original = `import {expect as check_${v.extra}} from 'vitest';\nit('${v.name}', () => { check_${v.extra}(value).toBe(${v.count}); });\n`;
            pairs.push([original, original.replace(`check_${v.extra}(value).toBe(${v.count});`, "")]);
          }

          if (kind === "ranges") {
            for (const [imports, target] of [
              ["import * as f from 'fast-check';", "f.integer"],
              ["import {integer} from 'fast-check';", "integer"],
              ["import {integer as numbers} from 'fast-check';", "numbers"],
              ["import fc from 'fast-check';", "fc.integer"],
            ]) {
              for (const settings of [
                `const settings: Bounds = {max: ${v.count}};`,
                `const settings = {max: ${v.count}} as const;`,
                `const settings = <Bounds>{max: ${v.count}};`,
                `const settings = {['max']: ${v.count}};`,
                `const size = ${v.count}; const settings = {max: size};`,
                `const settings = {}; settings.max = ${v.count};`,
              ]) {
                const original = `${imports}\n${settings}\nit('${v.name}', () => fc.assert(fc.property(${target}(settings), check)));`;
                pairs.push([original, original.replace(`${v.count}`, `${v.count - v.delta}`)]);
              }

              const original = `${imports}\nconst values = ${target}({max: ${v.count}});\nit('${v.name}', () => fc.assert(fc.property(values, check)));`;
              pairs.push([
                original,
                original.replaceAll("values", `values_${v.extra}`).replace(`${v.count}`, `${v.count - v.delta}`),
              ]);
            }
          }

          for (const [before, after] of pairs) {
            const got = compare({ [file]: before }, { [file]: after });
            expect(got.code, `${kind}\n${before}\n${after}\n${got.text}`).toBe(1);
          }
        }),
        { seed: 31841, numRuns: 2, endOnFailure: true },
      );
    },
  );

  // Plant: clear a whole added statement, comment, or mapped move in an existing file.
  it("T318 existing files hit for all insertions comments and mapped moves", () => {
    fc.assert(
      fc.property(input, (v) => {
        const before = `const old_${v.extra} = [${v.count}];\ndescribe('group', () => {${source(v)}});\n`;
        const added = source(v, undefined, "", `${v.name}-added`);

        for (const addition of [
          added,
          `describe('${v.name}-group', () => {${added}});\n`,
          `const helper_${v.extra} = (n) => n + ${v.count};\n`,
          `import {helper_${v.extra}} from './helper';\n`,
        ]) {
          for (const after of [addition + before, before + addition, before.replace(source(v), addition + source(v))]) {
            const got = compare({ [file]: before }, { [file]: after });
            expect(got.code, got.text).toBe(1);
          }
        }

        for (const after of [
          before.replace("fc.assert(", `${added}fc.assert(`),
          before.replace(`[${v.count}]`, `[${v.count}, ${v.delta}]`),
          `${before}const old_${v.extra} = ${v.count};\n`,
          before.replace("describe(", `if (false) describe(`),
        ]) {
          expect(compare({ [file]: before }, { [file]: after }).code).toBe(1);
        }

        const wrapped = before.replaceAll(" ", v.space).replace("fc.assert", `/* ${v.extra} */ fc.assert`);
        expect(compare({ [file]: before }, { [file]: wrapped }).code).toBe(1);
        const destination = "checks/destination.test.ts";
        const renamed = `${v.name}-new`;
        const mapped = compare(
          { [file]: source(v), [destination]: "// kept file\n" },
          { [file]: "// kept file\n", [destination]: source(v, undefined, "", renamed) },
          `| Removed | Replacement |\n| --- | --- |\n| ${v.name} | ${renamed} |`,
        );
        expect(mapped.code, mapped.text).toBe(1);
      }),
      { seed: 31842, numRuns: 3, endOnFailure: true },
    );
  });

  // Plants: treat any addition as safe; ignore a deleted/renamed test or a non-test exam change.
  it("T318 shared state additions and every non-additive exam file change hit", () => {
    fc.assert(
      fc.property(input, (v) => {
        const before = source(v);

        for (const added of [
          `beforeEach(() => reset(${v.count}));`,
          `afterEach(() => reset(${v.count}));`,
          `beforeAll(() => reset(${v.count}));`,
          `afterAll(() => reset(${v.count}));`,
          `vi.mock('./${v.extra}');`,
          `vi.stubGlobal('${v.extra}', ${v.count});`,
          `vi.stubEnv('${v.extra}', '${v.count}');`,
          `fc.configureGlobal({numRuns: ${v.count}});`,
          `expect.extend({${v.extra}: () => ({pass: true})});`,
          `process.env.${v.extra} = '${v.count}';`,
          `import './${v.extra}';`,
          `const helper_${v.extra} = vi.mock('./${v.extra}');`,
          `test('${v.extra}', () => { vi.stubGlobal('${v.extra}', ${v.count}); });`,
          `const helper_${v.extra} = () => { process.env.${v.extra} = '${v.count}'; };`,
        ]) {
          for (const after of [before + added, `describe('group', () => {${before}${added}});`]) {
            const base = after.startsWith("describe") ? `describe('group', () => {${before}});` : before;
            const got = compare({ [file]: base }, { [file]: after });
            expect(got.code, `${added}\n${got.text}`).toBe(1);
          }
        }

        for (const path of ["skillscheck.sh", "exam-paths.json", "vitest.config.ts", ".github/workflows/check.yml"]) {
          const content = path === "exam-paths.json" ? JSON.stringify([{ glob: "exam-paths.json" }]) : `# ${v.name}\n`;
          expect(compare({ [path]: content }, { [path]: `${content}\n` }).code).toBe(1);
        }

        for (const [original, after] of [
          [{}, { [file]: before }],
          [{ [file]: before }, {}],
          [{ [file]: before }, { "checks/renamed.test.ts": before }],
        ] as const) {
          const got = compare(original, after);
          expect(got.code, got.text).toBe(Object.keys(original).length ? 1 : 0);
        }
      }),
      { seed: 31843, numRuns: 2, endOnFailure: true },
    );
  });

  // Plants: the review3 parser clears mutations that added code makes to old state.
  it.each(["options", "helper", "getter", "module"])(
    "T318 review3 added %s access in an existing file is a hit",
    (kind) => {
      fc.assert(
        fc.property(input, (v) => {
          const prelude =
            kind === "options"
              ? `const settings = {numRuns: ${v.count}};\n`
              : kind === "module"
                ? `import {state} from './product';\n`
                : `const shared = {check: n => expect(n).toBe(n), get disable() { this.check = () => {}; return ${v.count}; }};\n`;
          const before =
            prelude +
            (kind === "options"
              ? source(v).replace(`{numRuns: ${v.count}}`, "settings")
              : kind === "module"
                ? source(v, "state.check(value);")
                : source(v, "shared.check(value);"));
          const write =
            kind === "options"
              ? "settings.numRuns = 1;"
              : kind === "module"
                ? "state.check = () => {};"
                : "shared.check = () => {};";
          const additions =
            kind === "getter"
              ? [`const added_${v.extra} = shared.disable;\n`, source(v, "shared.disable;", "", `${v.name}-added`)]
              : [source(v, write, "", `${v.name}-added`)];

          for (const addition of additions) {
            const got = compare({ [file]: before }, { [file]: before + addition });
            expect(got.code, `${kind}\n${got.text}`).toBe(1);
            expect(got.text).toContain(`${file}: unrecognized change:`);
          }
        }),
        { seed: 31850, numRuns: 3, endOnFailure: true },
      );
    },
  );

  // Plants: token equality hides automatic semicolons, regex text, and mid-line comments.
  it.each(["return-newline", "regex", "mid-line-comment"])(
    "T318 review3 raw %s edits in an existing law hit",
    (kind) => {
      fc.assert(
        fc.property(input, (v) => {
          const before =
            kind === "return-newline"
              ? source(v, "return expect(value).toBe(value);")
              : kind === "regex"
                ? source(v, "const pattern = /[//]/; expect(value).toBe(value);")
                : source(v, "return /* same line */ expect(value).toBe(value);");
          const after =
            kind === "return-newline"
              ? before.replace("return expect", "return\nexpect")
              : kind === "regex"
                ? before.replace("expect(value).toBe(value);", "")
                : before.replace("same line", "split\nline");
          const got = compare({ [file]: before }, { [file]: after });
          expect(got.code, got.text).toBe(1);
          expect(got.text).toContain(`${file}: unrecognized change:`);
        }),
        { seed: 31851, numRuns: 3, endOnFailure: true },
      );
    },
  );

  // Plant: a mapping consumes the same body across files, ignoring its new suite or helper.
  it.each(["skipped-suite", "weaker-helper"])("T318 review3 mapped move onto %s is a hit", (kind) => {
    fc.assert(
      fc.property(input, (v) => {
        const renamed = `${v.name}-new`,
          destination = "checks/destination.test.ts";
        const old = source(v, "check(value);"),
          next = source(v, "check(value);", "", renamed);
        const shell =
          kind === "skipped-suite" ? `describe.skip('${v.extra}', () => {\n});\n` : "const check = () => {};\n";
        const before = {
          [file]: `const check = n => expect(n).toBe(n);\n${old}`,
          [destination]: shell,
        };
        const after = {
          [file]: "const check = n => expect(n).toBe(n);\n",
          [destination]: kind === "skipped-suite" ? shell.replace("\n});", `\n${next}});`) : shell + next,
        };
        const got = compare(before, after, `| Removed | Replacement |\n| --- | --- |\n| ${v.name} | ${renamed} |`);
        expect(got.code, got.text).toBe(1);
        expect(got.text).toContain(`${file}: unrecognized change:`);
      }),
      { seed: 31852, numRuns: 3, endOnFailure: true },
    );
  });

  // Plant: compare blob text alone, missing symlinks and executable-mode changes.
  it.each(["symlink", "mode", "new-symlink"])(
    "T318 review3 %s exam paths never clear identical Git content",
    (kind) => {
      fc.assert(
        fc.property(word, (name) => {
          const target = `target-${name}`;
          const original = kind === "new-symlink" ? {} : { [file]: target };
          const got = compare(original, {
            [file]: kind === "mode" ? { content: target, mode: 0o755 } : { link: target },
          });
          expect(got.code, got.text).toBe(1);
          expect(got.text).toContain("unrecognized change:");
        }),
        { seed: 31853, numRuns: 3, endOnFailure: true },
      );
    },
  );

  // Plant: split classifier output into lines or tabs, losing deleted exam filenames.
  it.each(["\t", "\n", "\r", "\v"])("T318 review3 deleted names containing control %j are hits", (control) => {
    fc.assert(
      fc.property(
        input,
        fc.integer({ min: 1, max: 159 }).filter((n) => n < 32 || n >= 127),
        (v, generated) => {
          for (const character of new Set([control, String.fromCharCode(generated)])) {
            const path = `checks/${v.extra}${character}${v.name}.test.ts`;
            const got = compare({ [path]: source(v) }, {});
            expect(got.code, `${JSON.stringify(path)}\n${got.text}`).toBe(1);
            expect(got.text).toContain("unrecognized change:");
          }
        },
      ),
      { seed: 31854, numRuns: 3, endOnFailure: true },
    );
  });

  // Plants: reject a clean new regular file or miss one shared-state entry in a new file.
  it.each([0o644, 0o755])("T318 new regular test mode %i clears only without shared state", (mode) => {
    fc.assert(
      fc.property(input, (v) => {
        const clean = `import {it, expect} from 'vitest';\nimport fc from 'fast-check';\n${source(v)}`;
        expect(compare({}, { [file]: { content: clean, mode } }).code).toBe(0);

        for (const shared of [
          `vi.mock('./${v.extra}');`,
          `process.env.${v.extra} = '${v.count}';`,
          `globalThis.${v.extra} = ${v.count};`,
          "beforeEach(() => {});",
          "afterEach(() => {});",
          "beforeAll(() => {});",
          "afterAll(() => {});",
          `fc.configureGlobal({numRuns: ${v.count}});`,
          `expect.extend({${v.extra}: () => ({pass: true})});`,
          `import './${v.extra}';`,
        ]) {
          const got = compare({}, { [file]: { content: clean + shared, mode } });
          expect(got.code, `${shared}\n${got.text}`).toBe(1);
        }
      }),
      { seed: 31855, numRuns: 2, endOnFailure: true },
    );
  });

  // Plants: accept a title edit elsewhere on the line, a moved line, or a second raw edit.
  // Regex and nested template text that looks like a call must not count as a test title.
  it("T318 mapped renames change one quoted title per line in place", () => {
    fc.assert(
      fc.property(input, fc.constantFrom("'", '"', "`"), (v, quote) => {
        const renamed = `${v.name}-new`;
        const before = source(v).replace(JSON.stringify(v.name), `${quote}${v.name}${quote}`);
        const after = before.replace(`${quote}${v.name}${quote}`, `${quote}${renamed}${quote}`);
        const map = `| Removed | Replacement |\n| --- | --- |\n| ${v.name} | ${renamed} |`;
        expect(compare({ [file]: before }, { [file]: after }, map).code).toBe(0);
        expect(
          compare(
            { "skillscheck.sh": `cat <<'JS'\n${before}JS\n` },
            { "skillscheck.sh": `cat <<'JS'\n${after}JS\n` },
            map,
          ).code,
        ).toBe(1);

        for (const changed of [`\n${after}`, after.replace("fc.assert", "/* added */ fc.assert"), `${after}\n`]) {
          const got = compare({ [file]: before }, { [file]: changed }, map);
          expect(got.code, got.text).toBe(1);
        }

        const duplicate = source(v, `expect(${quote}${v.name}${quote}).toBe(${quote}${v.name}${quote});`);
        expect(
          compare(
            { [file]: duplicate },
            {
              [file]: duplicate.replace(`expect(${quote}${v.name}${quote})`, `expect(${quote}${renamed}${quote})`),
            },
            map,
          ).code,
        ).toBe(1);
        const computed = before.replace(`${quote}${v.name}${quote}`, `${quote}${v.name}${quote} + suffix`);
        expect(
          compare(
            { [file]: computed },
            { [file]: computed.replace(`${quote}${v.name}${quote}`, `${quote}${renamed}${quote}`) },
            map,
          ).code,
        ).toBe(1);

        for (const pattern of [
          `const pattern = /it('${v.name}-pattern')/;\n${source(v)}`,
          `const title = \`\${\`\nit('${v.name}-pattern')\n\`}\`;\n${source(v)}`,
        ]) {
          expect(
            compare(
              { [file]: pattern },
              { [file]: pattern.replace(`${v.name}-pattern`, `${v.name}-replacement`) },
              `| Removed | Replacement |\n| --- | --- |\n| ${v.name}-pattern | ${v.name}-replacement |`,
            ).code,
          ).toBe(1);
        }
      }),
      { seed: 31856, numRuns: 3, endOnFailure: true },
    );
  });

  // Plant: a failed classifier becomes an empty selected list and therefore a clean diff.
  it("T318 classifier failures are operating errors", () => {
    fc.assert(
      fc.property(input, (v) => {
        for (const invalid of ["[", JSON.stringify([{ glob: v.count }]), JSON.stringify([{ unknown: v.extra }])]) {
          const got = compare(
            { [file]: source(v), "exam-paths.json": invalid },
            { [file]: "", "exam-paths.json": invalid },
          );
          expect(got.code, got.text).toBe(2);
          expect(got.text).not.toContain("0 hits");
        }
      }),
      { seed: 31857, numRuns: 2, endOnFailure: true },
    );
  });

  // Plant: report every parser hit as an owner read, or turn bad refs into a clear diff.
  it("T318 usage explains hand checks and operating errors exit two", () => {
    fc.assert(
      fc.property(word, (missing) => {
        const usage = spawnSync("sh", [script], { encoding: "utf8", env });
        expect(usage.status).toBe(2);

        for (const phrase of [
          "pattern parser cannot cover every form TypeScript can write",
          "lead's hand check",
          "hit list in the PR",
          "Only real loosening waits on the owner",
          "additions to an existing test file",
          "added code there can reach old laws' state",
          "new test file can still touch the filesystem or the process outside the file",
        ]) {
          expect(usage.stderr).toContain(phrase);
        }

        const invalid = spawnSync("sh", [script, `missing-${missing}`, "HEAD"], {
          encoding: "utf8",
          env,
        });
        expect(invalid.status).toBe(2);
        expect(invalid.stdout).not.toContain("0 hits");
      }),
      { seed: 31844, numRuns: 3, endOnFailure: true },
    );
  });
});
