// The lint rules are the exam, so each one is seen to fail. Each planted line says whether its rule
// must refuse it. The planted files sit beside this one, so the repository's own .oxlintrc.json is
// what runs. `no-secret-env` and `no-redacted-value` are planted in
// packages/fabrika/src/redacted-lint.test.ts, `no-project-settings` in
// packages/fabrika/src/agents/claude/rules.test.ts.
// `no-node-filesystem` and `no-node-imports` plant next/ paths in their own test files.
// `program-package-layout` reads a program's package.json, so it plants generated program
// packages under next/programs/ in program-package-layout.test.ts.
// The planted lines of our own rules also run in process through oxlint's RuleTester, and every
// plant's file goes through one oxlint run, so the config is still what refuses each one.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { RuleTester } from "oxlint/plugins-dev";
import { afterAll, describe, expect, it } from "vitest";
import { BUILTIN_PLANTS, type Plant } from "./builtin-plants.ts";
import fabrika from "./index.ts";

const ROOT = join(import.meta.dirname, "..");
const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");

// RuleTester runs each case at once, inside the test that plants it.
RuleTester.describe = (_name, fn) => fn();
RuleTester.it = (_name, fn) => fn();
// From the top of the repo, so a rule reads each planted path as oxlint gives it there.
const tester = new RuleTester({ cwd: ROOT });

const plant = mkdtempSync(join(import.meta.dirname, ".plant-"));
afterAll(() => rmSync(plant, { recursive: true, force: true }));
// What `./b.laws` must be taken for: a file with one more extension, not a named file.
writeFileSync(join(plant, "b.laws.ts"), "export const b = 1;\n");

type Fire = { readonly code: string; readonly line: number };

/** What `pnpm lint`'s oxlint refuses in each of these files, from one run through the repo's config. */
const firesIn = (paths: readonly string[]): ReadonlyMap<string, readonly Fire[]> => {
  const out = spawnSync(OXLINT, ["--format=json", ...paths.map((path) => relative(ROOT, path))], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const report = JSON.parse(out.stdout) as {
    readonly diagnostics: readonly {
      readonly code: string;
      readonly filename: string;
      readonly labels: readonly { readonly span: { readonly line: number } }[];
    }[];
  };
  const fires = new Map<string, Fire[]>(paths.map((path) => [path, []]));

  for (const d of report.diagnostics) {
    if (d.labels[0] !== undefined) {
      fires.get(join(ROOT, d.filename))?.push({ code: d.code, line: d.labels[0].span.line });
    }
  }

  return fires;
};

/** The lines one rule's code refuses, in order. */
const linesOf = (fires: readonly Fire[], code: string): readonly number[] =>
  fires
    .filter((f) => f.code === code)
    .map((f) => f.line)
    .sort((a, b) => a - b);

/** The lines `pnpm lint`'s oxlint refuses in this file under one rule's code. */
const fires = (path: string, code: string): readonly number[] => linesOf(firesIn([path]).get(path)!, code);

const EFFECT = 'import {Context, Data, Duration, Effect, Schedule} from "effect";';

const PLANTS: readonly Plant[] = [
  {
    code: "fabrika(no-bare-tell)",
    prelude: [
      "declare const run: {tell: (n: string, x: number) => unknown};",
      "declare const tell: (r: unknown, n: string, x: number) => unknown;",
      "declare const xs: number[];",
    ],
    lines: [
      ['tell(run, "n", 1);', true],
      ['run.tell("n", 1);', true],
      ['xs.forEach((x) => run.tell("n", x));', true],
      ['export const told = tell(run, "n", 1);', false],
    ],
  },
  {
    code: "fabrika(no-context-tag)",
    prelude: [EFFECT],
    lines: [
      ['export const a = Context.Tag("a");', true],
      ['export const b = Context.GenericTag("b");', true],
      ['export const c = Effect.Service("c");', true],
      ['export const d = Context.Service("d");', false],
    ],
  },
  {
    code: "fabrika(no-data-taggederror)",
    prelude: [EFFECT, "declare const Other: {TaggedError: (n: string) => new () => object};"],
    lines: [
      ['export class A extends Data.TaggedError("A") {}', true],
      ['export class B extends Other.TaggedError("B") {}', false],
    ],
  },
  {
    code: "fabrika(no-effect-promise)",
    prelude: [EFFECT, "declare const p: () => Promise<number>;", "declare const c: () => string;"],
    lines: [
      ["export const a = Effect.promise(p);", true],
      ["export const b = Effect.tryPromise(p);", true],
      ["export const d = Effect.tryPromise({try: p, catch: c});", false],
    ],
  },
  {
    code: "fabrika(no-expect-in-if)",
    file: "planted.test.ts",
    prelude: [
      "declare const it: (n: string, f: () => void) => void;",
      "declare const expect: (x: unknown) => {toBe: (y: unknown) => void};",
      "declare const x: number;",
    ],
    lines: [
      ['it("a", () => { if (x > 0) { expect(x).toBe(1); } });', true],
      ['it("b", () => { expect(x).toBe(1); if (x > 0) { expect(x).toBe(1); } });', false],
    ],
  },
  {
    code: "fabrika(no-implicit-effect-concurrency)",
    prelude: [EFFECT, "declare const xs: number[];", "declare const f: (x: number) => unknown;"],
    lines: [
      ["export const a = Effect.all(xs);", true],
      ["export const b = Effect.forEach(xs, f);", true],
      ["export const c = Effect.validate(xs, f);", true],
      ['export const d = Effect.all(xs, {concurrency: "unbounded"});', false],
      ["export const e = Effect.forEach(xs, f, {concurrency: 1});", false],
    ],
  },
  {
    code: "fabrika(no-numeric-duration)",
    prelude: [EFFECT],
    lines: [
      ["export const a = Effect.sleep(5000);", true],
      ["export const b = Schedule.spaced(1000);", true],
      ['export const c = Effect.sleep("5 seconds");', false],
      ["export const d = Effect.sleep(Duration.seconds(5));", false],
    ],
  },
  {
    code: "fabrika(no-raw-try-catch)",
    prelude: [EFFECT, "declare const f: () => void;", "export const e = Effect.void;"],
    lines: [
      ["try { f(); } catch { f(); }", true],
      ["export const g = () => { f(); };", false],
    ],
  },
  {
    code: "fabrika(no-throw-in-effect-gen)",
    prelude: [EFFECT],
    lines: [
      ['export const a = Effect.gen(function* () { throw new Error("a"); });', true],
      ['export const b = () => { throw new Error("b"); };', false],
    ],
  },
  {
    code: "fabrika(no-type-assertions)",
    prelude: ["declare const x: number;"],
    lines: [
      ["export const a = x as any;", true],
      ["export const b = x as unknown as string;", true],
      ["export const c = x as number;", false],
    ],
  },
  {
    code: "fabrika(use-import-extensions)",
    prelude: [],
    lines: [
      ['export {a} from "./thing";', true],
      ['export {b} from "./b.laws";', true],
      ['export const c = import("./thing");', true],
      ['export {d} from "./thing.ts";', false],
      ['export {e} from "effect";', false],
      // Only `b.laws.ts` is there, so Node would not find either of these.
      ['export {f} from "./b.laws.js";', true],
      ['export {g} from "./b.laws.tsx";', true],
      ['export {h} from "./b.laws.ts";', false],
    ],
  },
  {
    code: "fabrika(no-redacted-value)",
    file: "planted.tsx",
    prelude: ['import {Redacted} from "effect";', "declare const Other: {value: () => null};"],
    lines: [
      ["export const a = <Redacted.value />;", true],
      ["export const b = <Redacted.value></Redacted.value>;", true],
      ["export const c = <Other.value />;", false],
    ],
  },
  // Biome's built-in rules that must not be lost in the move.
  {
    code: "eslint(no-unused-vars)",
    prelude: [],
    lines: [
      ['import {gone} from "./gone.ts";', true],
      ["const unused = 1;", true],
      ["export const f = (a: number, _b: number) => a;", false],
      ["export const g = (a: number, b: number) => a;", true],
    ],
  },
  {
    code: "typescript(no-non-null-assertion)",
    prelude: ["declare const x: number | undefined;"],
    lines: [
      ["export const a = x!;", true],
      ["export const b = x ?? 0;", false],
    ],
  },
  {
    code: "typescript(ban-ts-comment)",
    prelude: [],
    lines: [
      ["// @ts-ignore", true],
      ["export const a = 1;", false],
    ],
  },
  {
    // Braces on every body, even on one line (owner, 2026-11-09; 0021).
    code: "eslint(curly)",
    prelude: ["declare let x: number;", "declare const ys: number[];"],
    lines: [
      ["if (x) x++;", true],
      ["if (x) { x++; } else x--;", true],
      ["for (const y of ys) x += y;", true],
      ["while (x) x--;", true],
      ["do x--; while (x);", true],
      ["if (x) { x++; } else { x--; }", false],
    ],
  },
  {
    code: "eslint(no-sequences)",
    prelude: [],
    lines: [
      ["export const a = (1, 2);", true],
      ["export const b = [1, 2];", false],
    ],
  },
  {
    code: "eslint(array-callback-return)",
    prelude: ["declare const xs: number[];", "declare const f: (x: number) => void;"],
    lines: [
      ["xs.forEach((x) => x);", true],
      ["xs.forEach((x) => { f(x); });", false],
    ],
  },
  {
    code: "typescript(no-empty-object-type)",
    prelude: [],
    lines: [
      ["export declare const a: {};", true],
      ["export declare const b: {c: 1};", false],
    ],
  },
  // Code never reaches a primitive (design language call 3's lint half): only the token build,
  // under packages/fabrika-design/src/build/, imports Radix. The path case is below.
  {
    code: "eslint(no-restricted-imports)",
    prelude: [],
    lines: [
      ['import {slateDarkA} from "@radix-ui/colors";', true],
      ['import "@radix-ui/colors/slate-dark-alpha.css";', true],
      ['export {slate} from "effect";', false],
    ],
  },
];

/** Each file the describe below plants, written as it is collected, so one oxlint run reads them all. */
const planted: string[] = [];

const put = (name: string, text: string): string => {
  const file = join(plant, name);
  writeFileSync(file, text);
  planted.push(file);
  return file;
};

/** The planted file, its text and the lines its rule must refuse. */
const write = (p: Plant, name: string) => {
  const text = `${[...p.prelude, ...p.lines.map(([line]) => line)].join("\n")}\n`;
  const file = put(`${name}-${p.file ?? "planted.ts"}`, text);
  const want = p.lines.flatMap(([, refused], at) => (refused ? [p.prelude.length + at + 1] : []));
  return { file, text, want };
};

let linted: ReadonlyMap<string, readonly Fire[]> | undefined;

/** The one oxlint run over every planted file, made by the first test that reads it. */
const firesInPlanted = (file: string, code: string): readonly number[] =>
  linesOf((linted ??= firesIn(planted)).get(file)!, code);

/** In process, RuleTester: our own rule refuses exactly the lines it must. */
const inProcess = (p: Plant, { file, text, want }: ReturnType<typeof write>) => {
  const rule = fabrika.rules[p.code.replace(/^fabrika\((.*)\)$/, "$1")]!;
  const filename = relative(ROOT, file);
  tester.run(p.code, rule, {
    valid: want.length === 0 ? [{ code: text, filename }] : [],
    invalid: want.length === 0 ? [] : [{ code: text, filename, errors: want.map((line) => ({ line, message: /\S/ })) }],
  });
};

describe("each rule refuses what it is there to refuse", () => {
  const ours = PLANTS.map((p, i) => [p.code, p, write(p, String(i))] as const);
  const builtIn = BUILTIN_PLANTS.map((p, i) => [p.code, p, write(p, `builtin-${i}`)] as const);
  const self = put("self.ts", 'import {a} from "./self.ts";\nimport {b} from "./b.laws.ts";\nexport {a, b};\n');
  const poll = put(
    "poll.test.ts",
    `${[
      'import {expect, it} from "vitest";',
      'it("a", () => { expect.poll(() => 1).toBe(1); });',
      'it("b", async () => { await expect.poll(() => 1).toBe(1); });',
    ].join("\n")}\n`,
  );
  const notATest = put(
    "not-a-test.ts",
    `declare const it: any, expect: any, x: number;\n${'it("a", () => { if (x > 0) { expect(x).toBe(1); } });'}\n`,
  );

  it.each(ours)("%s", (_code, p, at) => {
    if (p.code.startsWith("fabrika(")) {
      inProcess(p, at);
    }

    expect(firesInPlanted(at.file, p.code)).toEqual(at.want);
  });

  it.each(builtIn)("built in, on with 0 hits: %s", (_code, p, at) => {
    expect(firesInPlanted(at.file, p.code)).toEqual(at.want);
  });

  it("built in, on with 0 hits: import(no-self-import)", () => {
    expect(firesInPlanted(self, "import(no-self-import)")).toEqual([1]);
  });

  // It reports each line twice, so this one counts lines, not reports.
  it("built in, on with 0 hits: vitest(require-awaited-expect-poll)", () => {
    expect([...new Set(firesInPlanted(poll, "vitest(require-awaited-expect-poll)"))]).toEqual([2]);
  });

  it("each built-in rule is planted once", () => {
    const codes = BUILTIN_PLANTS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("a test file is the only place no-expect-in-if looks", () => {
    expect(firesInPlanted(notATest, "fabrika(no-expect-in-if)")).toEqual([]);
  });

  it("the plugin has one planted line or more for every rule it lists", async () => {
    const { default: plugin } = await import("./index.ts");
    const planted = new Set(PLANTS.map((p) => p.code));
    // `no-bare-disable` reports at the top of the file, so it has its own test below.
    const elsewhere = [
      "prefer-schema-arbitrary", // generated syntax laws in prefer-schema-arbitrary.test.ts
      "law-shape", // one generated line per edge case, at next/ test paths, in law-shape.test.ts
      "no-secret-env",
      "no-redacted-value",
      "no-project-settings",
      "no-bare-disable",
      // P17a's path-scoped rules have plants in their own oxlint-plugins/*.test.ts files.
      "door-is-library",
      "outside-input-constructor",
      // T737's rule reads only libfabrika's src, so service-id.test.ts plants it there.
      "service-id",
      // T518's retired module is planted in one-id-module.test.ts.
      "one-id-module",
      // Generated files and their fix in padding-line-between-statements.test.ts.
      "padding-line-between-statements",
      // next/'s exam rules, planted at next/ paths in next/apps/fabrika/src/exam/.
      "no-promises",
      "no-effect-run-outside-edge",
      "edge-comment",
      "effect-functions",
      "no-of",
      "no-hand-tag",
      "one-store-hook",
      "no-clock-in-view",
      // Generated ledger-sql.test.ts plants run at next/ paths with the real lint config.
      "no-ledger-sql",
      "no-node-filesystem",
      "no-node-imports",
      // libfabrika's modules are planted at their real paths in modules.test.ts.
      "modules",
      // P16's rule reads the program package, so generated packages plant it in its own test file.
      "program-package-layout",
      // Generated no-why-key.test.ts plants run at next/ paths with the real lint config.
      "no-why-key",
      // Generated no-stage-word.test.ts plants run at next/ paths with the real lint config.
      "no-stage-word",
    ];
    const missing = Object.keys(plugin.rules).filter(
      (rule) => !planted.has(`fabrika(${rule})`) && !elsewhere.includes(rule),
    );
    expect(missing).toEqual([]);
  });
});

describe("lint.ts, the first step of pnpm lint", () => {
  const lint = (path: string) =>
    spawnSync(process.execPath, ["oxlint-plugins/lint.ts", relative(ROOT, path)], {
      cwd: ROOT,
      encoding: "utf8",
    });

  const advice = join(plant, "advice.ts");
  const blocking = join(plant, "blocking.ts");

  it("prints an advice rule's fire and does not fail", () => {
    writeFileSync(
      advice,
      [
        'import {Effect} from "effect";',
        "declare const f: () => void;",
        "export const e = Effect.void;",
        "",
        "try { f(); } catch { f(); }",
        "",
      ].join("\n"),
    );
    const out = lint(advice);
    expect(out.stdout).toContain("fabrika(no-raw-try-catch)");
    expect(out.stdout).toContain("oxlint: 0 blocking, 1 advice");
    expect(out.status).toBe(0);
  });

  it("fails on a warning from a blocking rule", () => {
    writeFileSync(blocking, "declare const x: number;\nexport const a = x as any;\n");
    const out = lint(blocking);
    expect(out.stdout).toContain("fabrika(no-type-assertions)");
    expect(out.status).toBe(1);
  });

  it("fails when oxlint looked at nothing, so a clean run cannot be faked by a bad path", () => {
    const out = lint(join(plant, "no-such-file.ts"));
    expect(out.status).not.toBe(0);
  });
});

const SECRET = "export const a = process.env.GITHUB_TOKEN;";

describe("an ignore comment names its rules and says why", () => {
  const run = (name: string, text: string) => {
    const file = join(plant, name);
    writeFileSync(file, text);
    return spawnSync(process.execPath, ["oxlint-plugins/lint.ts", relative(ROOT, file)], {
      cwd: ROOT,
      encoding: "utf8",
    });
  };

  it.each([
    ["no rule, the next line", `// oxlint-disable-next-line\n${SECRET}\n`],
    ["no reason", `// oxlint-disable-next-line fabrika/no-secret-env\n${SECRET}\n`],
    ["no rule, a reason", `// oxlint-disable-next-line -- why\n${SECRET}\n`],
    ["dashes for a rule, the next line", `// oxlint-disable-next-line -- -- edge: x\n${SECRET}\n`],
    ["dashes for a rule, the whole file", `/* oxlint-disable -- -- x */\n${SECRET}\n`],
    ["three dashes for a rule", `// oxlint-disable-next-line --- -- x\n${SECRET}\n`],
    ["two dashed rules", `// oxlint-disable-next-line --, -- -- x\n${SECRET}\n`],
    ["dashes glued to the reason", `// oxlint-disable-next-line -- --x\n${SECRET}\n`],
    ["an empty reason", `// oxlint-disable-next-line fabrika/no-secret-env -- \n${SECRET}\n`],
    ["words but no dashes", `// oxlint-disable-next-line fabrika/no-secret-env why\n${SECRET}\n`],
    ["no rule, the whole file", `/* oxlint-disable */\n${SECRET}\n`],
    ["no rule, lower down", `\n\n/* oxlint-disable */\n${SECRET}\n`],
    ["no rule, this line", `${SECRET} // oxlint-disable-line\n`],
    ["a rule glued on", `/* oxlint-disablefabrika/no-secret-env */\n${SECRET}\n`],
    ["eslint, the whole file", `/* eslint-disable */\n${SECRET}\n`],
    ["eslint, the next line", `// eslint-disable-next-line\n${SECRET}\n`],
    ["eslint, in full", `// eslint-disable-next-line fabrika/no-secret-env -- why\n${SECRET}\n`],
    ["JSX", `export const a = (\n\t<a>\n\t\t{/* oxlint-disable-next-line */}\n\t\t<b />\n\t</a>\n);\n`],
  ])("refuses %s, and that comment cannot silence the refusal", (name, text) => {
    const out = run(`bare-${name.replaceAll(/\W/g, "-")}.tsx`, text);
    expect(out.stdout).toContain("fabrika(no-bare-disable)");
    expect(out.status).toBe(1);
  });

  it("says which line, since it reports at the top of the file", () => {
    const out = run("line.ts", `\n\n// oxlint-disable-next-line\n${SECRET}\n`);
    expect(out.stdout).toContain("on line 3");
  });

  it.each([
    ["one rule", `// oxlint-disable-next-line fabrika/no-secret-env -- why\n${SECRET}\n`],
    ["from here on", `/* oxlint-disable fabrika/no-secret-env -- why\n more why */\n${SECRET}\n`],
    ["two rules", `// oxlint-disable-next-line fabrika/no-secret-env, no-debugger -- why\n${SECRET}\ndebugger;\n`],
    ["words that only mention it", `// the oxlint-disable comment\nexport const b = 1;\n`],
  ])("takes %s", (_name, text) => {
    const out = run("named.ts", text);
    expect(out.stdout).not.toContain("no-bare-disable");
  });
});

describe("a plain file cannot take a folder out of the checks", () => {
  const LINT = join(ROOT, "oxlint-plugins", "lint.ts");
  const FORMAT = join(ROOT, "oxlint-plugins", "format.ts");
  const inFolder = (files: Readonly<Record<string, string>>) => {
    const folder = mkdtempSync(join(plant, "hide-"));
    mkdirSync(join(folder, "sub"));

    for (const [name, text] of Object.entries(files)) {
      writeFileSync(join(folder, name), text);
    }

    return folder;
  };
  const node = (script: string, cwd: string, ...args: readonly string[]) =>
    spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });

  it.each([
    ["a .eslintignore", ".eslintignore", "sub/\n"],
    ["a nested .oxlintrc.json", "sub/.oxlintrc.json", "{}\n"],
    ["a nested oxlint.config.ts", "sub/oxlint.config.ts", "export default {};\n"],
  ])("oxlint still refuses a secret beside %s", (_name, file, text) => {
    const cwd = inFolder({ "sub/a.ts": `${SECRET}\n`, [file]: text });
    const out = node(LINT, cwd, ".");
    expect(out.stdout).toContain("fabrika(no-secret-env)");
    expect(out.status).toBe(1);
  });

  it.each([
    ["a .prettierignore", ".prettierignore", "sub/\n"],
    ["a nested .oxfmtrc.json", "sub/.oxfmtrc.json", '{"ignorePatterns": ["**"]}\n'],
  ])("oxfmt still refuses unformatted code beside %s", (_name, file, text) => {
    const cwd = inFolder({ "sub/a.ts": "export   const a   = 1\n", [file]: text });
    const out = node(FORMAT, cwd, "--check", ".");
    expect(out.stdout).toContain("sub/a.ts");
    expect(out.status).toBe(1);
  });

  it("oxfmt takes formatted code, so the two above fail for the right reason", () => {
    const cwd = inFolder({ "sub/a.ts": "export const a = 1;\n" });
    expect(node(FORMAT, cwd, "--check", ".").status).toBe(0);
  });

  it("a .gitignore over a tracked file fails lint.ts, and names the file", () => {
    const cwd = inFolder({ "sub/a.ts": `${SECRET}\n`, "sub/.gitignore": "*\n" });
    spawnSync("git", ["init", "-q"], { cwd });
    spawnSync("git", ["add", "-f", "sub/a.ts"], { cwd });
    const out = node(LINT, cwd, ".");
    expect(out.stderr).toContain("sub/a.ts");
    expect(out.status).toBe(2);
  });
});

describe("rules that apply by path", () => {
  const plantIn = (folder: string, text: string) => {
    const at = mkdtempSync(join(ROOT, folder, ".plant-"));
    const file = join(at, "planted.ts");
    writeFileSync(file, text);
    return { at, file };
  };
  const made: string[] = [];
  afterAll(() => {
    for (const at of made) {
      rmSync(at, { recursive: true, force: true });
    }
  });

  it.each([
    ["eslint(prefer-template)", 'export const f = (a: string) => a + "b";\n'],
    ["eslint(prefer-arrow-callback)", "export const a = [1].map(function (x) { return x; });\n"],
    ["eslint(require-yield)", "export const a = function* () { return 1; };\n"],
  ])("experiments/ is under %s", (code, text) => {
    const { at, file } = plantIn("experiments", text);
    made.push(at);
    expect(fires(file, code)).toEqual([1]);
  });

  const HOOK = 'import {useState} from "react";\nexport const f = (x: number) => { if (x) useState(0); };\n';

  it.each(["apps", "programs"])("a hook in a .ts file under %s/ is checked", (folder) => {
    const { at, file } = plantIn(folder, HOOK);
    made.push(at);
    expect(fires(file, "react-hooks(rules-of-hooks)")).toEqual([2]);
  });

  const EFFECTS = [
    'import {useEffect, useEffectEvent} from "react";',
    "export const stale = (n: number) => {",
    "\tuseEffect(() => console.log(n), []);",
    "};",
    "export const fresh = (n: number) => {",
    "\tconst log = useEffectEvent(() => console.log(n));",
    "\tuseEffect(() => log(), [n]);",
    "};",
    "",
  ].join("\n");

  it.each(["apps", "programs"])("an effect's stale value under %s/ is refused", (folder) => {
    const { at, file } = plantIn(folder, EFFECTS);
    made.push(at);
    expect(fires(file, "react-hooks(exhaustive-deps)")).toEqual([3]);
  });

  const RADIX = 'import {slateDarkA} from "@radix-ui/colors";\nexport const a9 = slateDarkA.slateA9;\n';

  it("the token build, under packages/fabrika-design/src/build/, may import Radix", () => {
    mkdirSync(join(ROOT, "packages/fabrika-design/src/build"), { recursive: true });
    const { at, file } = plantIn("packages/fabrika-design/src/build", RADIX);
    made.push(at);
    expect(fires(file, "eslint(no-restricted-imports)")).toEqual([]);
  });

  it("the rest of the design package may not, so the exception is the build's folder alone", () => {
    const { at, file } = plantIn("packages/fabrika-design/src", RADIX);
    made.push(at);
    expect(fires(file, "eslint(no-restricted-imports)")).toEqual([1]);
  });

  it("a `use` in a .ts file under packages/ is left alone: it is Effect's, not a hook", () => {
    const { at, file } = plantIn("packages", HOOK);
    made.push(at);
    expect(fires(file, "react-hooks(rules-of-hooks)")).toEqual([]);
  });
});
