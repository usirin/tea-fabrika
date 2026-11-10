// Today's version, T245 PR 3. These plants go through the real root CSS config.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import stylelint from "stylelint";
import { afterAll, assert, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const CONFIG = join(ROOT, "stylelint.config.ts");
const RUNNER = join(ROOT, "oxlint-plugins/stylelint.ts");
const FIXTURES = join(import.meta.dirname, "css/fixtures");
const WINDOW = "apps/fabrika/src/window/window.css";
const TOKENS = "packages/fabrika-design/src/tokens.css";

const RULES = [
  { law: 21, name: "token-exists", lines: [1, 2, 3, 4] },
  {
    law: 22,
    name: "no-raw-color",
    lines: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23],
  },
  { law: 23, name: "no-primitive-var", lines: [1, 2, 3] },
  { law: 24, name: "part-token-owner", lines: [1, 2] },
  { law: 25, name: "motion-under-guard", lines: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { law: 26, name: "font-size-from-scale", lines: [1, 2, 3, 4, 5, 6, 7] },
] as const;

const temps: string[] = [];

afterAll(() => {
  for (const path of temps) {
    rmSync(path, { recursive: true, force: true });
  }
});

const temp = () => {
  const path = mkdtempSync(join(tmpdir(), "css-law-"));
  temps.push(path);
  return path;
};

const write = (root: string, path: string, text: string) => {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
  return target;
};

const rootConfig = async (): Promise<stylelint.Config> => {
  assert(existsSync(CONFIG), "Today's lint has no root CSS config. PR 3 must install it.");
  const module: { default: stylelint.Config } = await import(pathToFileURL(CONFIG).href);
  return module.default;
};

const fixture = (side: "bad" | "good", name: string) => {
  const file = join(FIXTURES, side, `${name}.css`);
  assert(existsSync(file), `Law fixture deleted: ${relative(ROOT, file)}`);
  return file;
};

const lint = async (file: string, codeFilename?: string) => {
  await rootConfig();
  const report = await stylelint.lint({
    configFile: CONFIG,
    ...(codeFilename === undefined
      ? { files: file }
      : { code: readFileSync(file, "utf8"), codeFilename: join(ROOT, codeFilename) }),
  });
  expect(report.results).toHaveLength(1);
  const [result] = report.results;
  assert(result);
  expect(result.parseErrors, "The plant must be valid CSS").toEqual([]);
  expect(result.invalidOptionWarnings, "The real config must have valid options").toEqual([]);
  expect(
    result.warnings.filter((warning) => warning.text.startsWith("Unknown rule")),
    "PR 3's CSS rules must be implemented and registered",
  ).toEqual([]);
  return result.warnings;
};

describe("T245 PR 3, laws 21 to 26: each rule refuses its plants", () => {
  it.each(RULES)("law $law: $name", async ({ name, lines }) => {
    let bad = fixture("bad", name);

    // Plant this one under programs/, where a tile's tokens are forbidden.
    if (name === "part-token-owner") {
      const program = mkdtempSync(join(ROOT, "programs/.css-law-"));
      temps.push(program);
      bad = write(program, "fixtures/window.css", readFileSync(bad, "utf8"));
    }

    const warnings = await lint(bad);
    const fires = warnings.filter((warning) => warning.rule === `fabrika/${name}`);
    expect([...new Set(fires.map((warning) => warning.line))].sort((a, b) => a - b)).toEqual(lines);
    expect(fires.every((warning) => warning.severity === "error")).toBe(true);
    const good = fixture("good", name);
    expect(await lint(good, name === "part-token-owner" ? WINDOW : undefined)).toEqual([]);
  });

  it("law 21 reads only var() past comments and spaces and names the unknown token", async () => {
    const file = write(
      temp(),
      "reference.css",
      ".a { color: var(/* token */ --missing); }\n.label { content: attr(--label); }\n.literal { --keyword: var; }\n",
    );
    expect(await lint(file)).toEqual([
      expect.objectContaining({
        rule: "fabrika/token-exists",
        text: expect.stringContaining("--missing"),
      }),
    ]);
  });

  it("law 22 checks named backgrounds and hex colors without treating escapes as colors", async () => {
    const file = write(
      temp(),
      "colors.css",
      `.named { background: rebeccapurple; }
.hex { color: #aabbcc; }
.alpha { color: #aabbccdd; }
.escaped { --anchor: \\#fff; }
.image { background: url(red); }
`,
    );
    const warnings = await lint(file);
    expect(warnings.map(({ rule, line }) => ({ rule, line }))).toEqual(
      [1, 2, 3].map((line) => ({ rule: "fabrika/no-raw-color", line })),
    );
  });

  it("law 26 ignores quoted fallback data when the font size is a scale token", async () => {
    const file = write(temp(), "size.css", '.a { font-size: var(--fs-small, "12px"); }\n');
    expect(await lint(file)).toEqual([]);
  });

  // env() can supply a style, and calc-mix() a numeric weight, before the size.
  // https://www.w3.org/TR/css-env-1/#env-function
  // https://www.w3.org/TR/css-values-5/#calc-mix
  it.each(["env(--fs-style, italic)", "calc-mix(0.5, 400, 600)"])(
    "law 26 checks the pixel font size after %s",
    async (prefix) => {
      const file = write(temp(), "font.css", `.a { font: ${prefix} 12px var(--font); }\n`);
      expect(await lint(file)).toEqual([expect.objectContaining({ rule: "fabrika/font-size-from-scale" })]);
    },
  );

  it("laws 22, 23, 24 and 26 allow the real generated regions and hand-written scale", async () => {
    expect(await lint(join(ROOT, TOKENS))).toEqual([]);
  });

  it("laws 22 to 24 exempt generated content only at the real token file's path", async () => {
    const file = write(
      temp(),
      "generated.css",
      `:root {
/* @generated colors from tokens/color by pnpm tokens: edit the TOML, never this */
/* The @end generated colors marker comes after these declarations. */
--slate-a9: #dfebfd6d;
--indigo-9: #3e63dd;
--focus: var(--indigo-9);
--tile-edge-on: var(--slate-a9);
/* @end generated colors */
}\n`,
    );
    expect(await lint(file, TOKENS)).toEqual([]);
    const warnings = await lint(file, "programs/css-plant/window.css");
    expect(warnings.map(({ rule }) => rule)).toEqual(
      expect.arrayContaining(["fabrika/no-raw-color", "fabrika/no-primitive-var", "fabrika/part-token-owner"]),
    );
  });

  it("law 26 refuses a pixel font size outside the hand-written scale, even in tokens.css", async () => {
    const file = write(temp(), "size.css", ".a { font-size: 12px; }\n");
    const warnings = await lint(file, TOKENS);
    expect(warnings.map(({ rule }) => rule)).toContain("fabrika/font-size-from-scale");
  });

  it.each(['"sky"', "'sky'"])("law 22 limits pipe %s to its exact selector and five tokens", async (name) => {
    const file = write(
      temp(),
      "pipe.css",
      `[data-pipe=${name}] { --tile-wash: #fff; --tile-wash-on: #fff; --tile-edge-hover: #fff; --tile-edge-on: #fff; --tile-edge-loud: #fff; }\n`,
    );
    expect(await lint(file, WINDOW)).toEqual([]);
    const warnings = await lint(file, "programs/css-plant/window.css");
    expect(warnings.map(({ rule }) => rule)).toContain("fabrika/no-raw-color");
    const nested = write(temp(), "nested-pipe.css", `.outer [data-pipe=${name}] { --tile-wash: #fff; }\n`);
    expect(await lint(nested, WINDOW)).toEqual([expect.objectContaining({ rule: "fabrika/no-raw-color" })]);
  });
});

const settingsProblems = (config: stylelint.Config | undefined, base: stylelint.Config) => {
  const problems: string[] = [];

  for (const { name } of RULES) {
    const rule = `fabrika/${name}`;
    const setting = config?.rules?.[rule];

    if (!Array.isArray(setting) || setting[0] !== true || setting[1]?.severity !== "error") {
      problems.push(`${rule}: must be on at error`);
    }

    if (!Array.isArray(setting) || !Array.isArray(setting[1]?.known)) {
      problems.push(`${rule}: known list is missing`);
    }

    if (!isDeepStrictEqual(setting, base.rules?.[rule])) {
      problems.push(`${rule}: options were replaced`);
    }
  }

  return problems;
};

const warningPaths = (value: unknown, path = "config"): string[] => {
  if (value === null || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, item]) => [
    ...((key === "severity" || key === "defaultSeverity") && item === "warning" ? [`${path}.${key}`] : []),
    ...warningPaths(item, `${path}.${key}`),
  ]);
};

const configPlant = (body: string) => {
  const root = temp();
  const file = write(
    root,
    "stylelint.config.mjs",
    `import base from ${JSON.stringify(pathToFileURL(CONFIG).href)};\n${body}\n`,
  );
  return { root, file };
};

describe("T245 PR 3, laws 27 and 28: the effective config cannot weaken a rule", () => {
  it("law 27 keeps each rule's complete root options in every tracked CSS file", async () => {
    const base = await rootConfig();
    expect(
      Object.keys(base.rules ?? {})
        .filter((rule) => rule.startsWith("fabrika/"))
        .sort(),
    ).toEqual(RULES.map(({ name }) => `fabrika/${name}`).sort());
    const tracked = spawnSync("git", ["ls-files", "-z", "--", "*.css"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(tracked.status).toBe(0);
    const files = tracked.stdout.split("\0").filter((path) => path.endsWith(".css"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const resolved = await stylelint.resolveConfig(join(ROOT, file), { configFile: CONFIG });
      expect(settingsProblems(resolved, base), file).toEqual([]);
    }

    const plant = configPlant(
      'export default {...base, overrides: [{files: ["**/*.css"], rules: {"fabrika/no-raw-color": [true]}}]};',
    );
    const resolved = await stylelint.resolveConfig(join(plant.root, "programs/plant/window.css"), {
      configFile: plant.file,
    });
    expect(settingsProblems(resolved, base)).toContain("fabrika/no-raw-color: options were replaced");
  });

  it("law 28 has no warning anywhere, including overrides and disable reports", async () => {
    const base = await rootConfig();
    expect(warningPaths(base)).toEqual([]);
    const actual = await stylelint.resolveConfig(join(ROOT, WINDOW), { configFile: CONFIG });
    expect(
      settingsProblems(actual, base),
      "All six rules must be registered at error before testing warning plants",
    ).toEqual([]);

    for (const { name } of RULES) {
      const rule = `fabrika/${name}`;
      const plant = configPlant(
        `export default {...base, overrides: [{files: ["**/*.css"], rules: {${JSON.stringify(rule)}: [true, {severity: "warning", known: []}]}}]};`,
      );
      const resolved = await stylelint.resolveConfig(join(plant.root, "apps/plant/window.css"), {
        configFile: plant.file,
      });
      expect(warningPaths(resolved)).toContain(`config.rules.${rule}.1.severity`);
      expect(settingsProblems(resolved, base)).toContain(`${rule}: must be on at error`);
    }
  });
});

// The runner gets a real git index and its own root config. It imports the actual config and
// plugins, clearing only the existing debt so a tiny planted repo can be clean.
const runnerRepo = (knownRule?: string, known: unknown = []) => {
  assert(existsSync(RUNNER), "Today's lint has no CSS runner. PR 3 must check tracked CSS.");
  assert(existsSync(CONFIG), "The CSS runner needs the real root config.");
  const root = temp();
  const repo = join(root, "repo");
  mkdirSync(repo);
  const initialized = spawnSync("git", ["init", "--quiet", `--separate-git-dir=${join(root, "git-data")}`, repo], {
    encoding: "utf8",
  });
  expect(initialized.status, initialized.stderr).toBe(0);
  write(repo, "package.json", '{"type":"module"}\n');
  symlinkSync(join(ROOT, "node_modules"), join(repo, "node_modules"), "dir");
  cpSync(join(ROOT, "oxlint-plugins"), join(repo, "oxlint-plugins"), {
    recursive: true,
    filter: (path) => !path.includes("/node_modules"),
  });
  symlinkSync(join(ROOT, "oxlint-plugins/node_modules"), join(repo, "oxlint-plugins/node_modules"), "dir");

  for (const path of ["packages/fabrika-design/src/token-names.json", "packages/fabrika-design/tokens/parts.toml"]) {
    write(repo, path, readFileSync(join(ROOT, path), "utf8"));
  }

  write(
    repo,
    "stylelint.config.ts",
    `import base from ${JSON.stringify(pathToFileURL(CONFIG).href)};
export default {...base, rules: Object.fromEntries(Object.entries(base.rules).map(([name, setting]) => [name, [setting[0], {...setting[1], known: name === ${JSON.stringify(knownRule ?? "")} ? ${JSON.stringify(known)} : []}]]))};
`,
  );
  return repo;
};

const track = (repo: string, files: Record<string, string>) => {
  for (const [path, contents] of Object.entries(files)) {
    write(repo, path, contents);
  }

  const added = spawnSync("git", ["add", "--", ...Object.keys(files)], {
    cwd: repo,
    encoding: "utf8",
  });
  expect(added.status, added.stderr).toBe(0);
};

const run = (repo: string) => {
  const result = spawnSync(process.execPath, ["oxlint-plugins/stylelint.ts"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, TYPESAFE_API_KEY: undefined },
  });
  expect(result.error).toBeUndefined();
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
};

describe("T245 PR 3, law 29: known only shrinks", () => {
  it("law 29 keeps the root known lists matched to the tracked CSS", () => {
    const result = run(ROOT);
    expect(result.status, result.output).toBe(0);
  });

  it("law 29 refuses a known value that is not a list", () => {
    const repo = runnerRepo("fabrika/no-raw-color", "");
    track(repo, { "apps/plant/window.css": ".a { color: var(--focus); }\n" });
    const result = run(repo);
    expect(result.status, result.output).toBe(2);
    expect(result.output).toContain("fabrika/no-raw-color");
    expect(result.output).toContain("known");
  });

  it("law 29 rejects non-string entries before a rule checks CSS", async () => {
    const plant = configPlant(
      'export default {...base, rules: {...base.rules, "fabrika/no-raw-color": [true, {severity: "error", known: [42]}]}};',
    );
    const report = await stylelint.lint({
      configFile: plant.file,
      code: ".a { color: var(--focus); }",
      codeFilename: join(ROOT, WINDOW),
    });
    expect(report.errored).toBe(true);
    expect(report.results.flatMap(({ invalidOptionWarnings }) => invalidOptionWarnings)).toEqual([
      expect.objectContaining({ text: expect.stringContaining("known") }),
    ]);
  });

  it.each([
    {
      rule: "no-raw-color",
      entry: "programs/plant/window.css .known { color }",
      bad: ".known { color: #fff; }",
      good: ".known { color: var(--text-primary); }",
    },
    {
      rule: "token-exists",
      entry: "--old-name",
      bad: ".known { color: var(--old-name); }",
      good: ".known { color: var(--text-primary); }",
    },
    {
      rule: "font-size-from-scale",
      entry: "programs/plant/window.css .known { font-size }",
      bad: ".known { font-size: 10px; }",
      good: ".known { font-size: var(--fs-small); }",
    },
  ])("law 29 refuses a stale $rule entry after the CSS is fixed", ({ rule, entry, bad, good }) => {
    const repo = runnerRepo(`fabrika/${rule}`, [entry]);
    track(repo, { "programs/plant/window.css": `${bad}\n` });
    expect(run(repo).status).toBe(0);
    write(repo, "programs/plant/window.css", `${good}\n`);
    const stale = run(repo);
    expect(stale.status).not.toBe(0);
    expect(stale.output).toContain(entry);
  });

  it.each([
    { path: "programs/other/window.css", css: ".known { color: #fff; }" },
    { path: "programs/plant/window.css", css: ".other { color: #fff; }" },
    { path: "programs/plant/window.css", css: ".known { background: #fff; }" },
  ])("law 29 cannot let known debt hide a new fire at $path: $css", ({ path, css }) => {
    const repo = runnerRepo("fabrika/no-raw-color", ["programs/plant/window.css .known { color }"]);
    track(repo, { [path]: `${css}\n` });
    const result = run(repo);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("fabrika/no-raw-color");
    expect(result.output).toContain(path);
  });
});

describe("T245 PR 3, law 30: the runner and disable comments cannot hide CSS", () => {
  it("law 30 accepts tracked clean CSS and prints all six counts", () => {
    const manifest: { scripts: { lint: string } } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(manifest.scripts.lint).toContain("node oxlint-plugins/stylelint.ts");
    const repo = runnerRepo("fabrika/no-raw-color", ["programs/plant/window.css .known { color }"]);
    track(repo, {
      "apps/plant/window.css": ".a { color: var(--text-primary); }\n",
      "programs/plant/window.css": ".known { color: #fff; color: #fff; }\n",
    });
    const result = run(repo);
    expect(result.status, result.output).toBe(0);

    for (const { name } of RULES) {
      expect(result.output).toContain(`fabrika/${name}`);
    }

    expect(result.output).toContain("fabrika/no-raw-color: 2 fires, 1 known entries");
    expect(result.output).toContain("stylelint: 2 files, 0 blocking");
  });

  it.each(RULES)("law 30 fails and prints the path, line and $name fire", ({ name }) => {
    const repo = runnerRepo();
    const path = "programs/plant/window.css";
    track(repo, { [path]: `\n\n${readFileSync(fixture("bad", name), "utf8")}` });
    const result = run(repo);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(`fabrika/${name}`);
    expect(result.output).toContain(`${path}:3:`);
    expect(result.output).not.toContain("failed without a diagnostic");
  });

  it("law 30 gives invalid options a path, fallback location and stylelint label", () => {
    const repo = runnerRepo("fabrika/no-raw-color", [42]);
    const path = "apps/plant/window.css";
    track(repo, { [path]: ".a { color: var(--focus); }\n" });
    const result = run(repo);
    expect(result.status).toBe(1);
    expect(result.output).toContain(`${path}:1:1 stylelint `);
    expect(result.output).toContain("known");
    expect(result.output).not.toContain("failed without a diagnostic");
  });

  it("law 30 reads every tracked scope despite nested configs and ignore files", () => {
    const repo = runnerRepo();
    const paths = ["apps", "packages", "programs", "next"].map((scope) => `${scope}/plant/window.css`);
    track(repo, Object.fromEntries(paths.map((path) => [path, ".a { color: #fff; }\n"])));
    write(repo, ".stylelintignore", "**/*.css\n");
    write(
      repo,
      "apps/.stylelintrc.json",
      JSON.stringify({ rules: Object.fromEntries(RULES.map(({ name }) => [`fabrika/${name}`, null])) }),
    );
    write(repo, "apps/untracked.css", ".broken {\n");
    track(repo, { "experiments/plant/ignored.css": ".broken {\n" });
    const result = run(repo);
    expect(result.status).not.toBe(0);

    for (const path of paths) {
      expect(result.output).toContain(`${path}:1:`);
    }

    expect(result.output).not.toContain("untracked.css");
    expect(result.output).not.toContain("experiments/plant/ignored.css");
  });

  it("law 30 fails when the git index contains no CSS", () => {
    const repo = runnerRepo();
    track(repo, { "apps/plant/readme.txt": "no stylesheet\n" });
    const result = run(repo);
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/no.*(?:css|files)|(?:0|zero).*files/i);
  });

  it("law 30 fails on a CSS parse error rather than reporting a clean run", () => {
    const repo = runnerRepo();
    track(repo, { "apps/plant/broken.css": ".broken { color:\n" });
    const result = run(repo);
    expect(result.status).toBe(1);
    expect(result.output).toContain("broken.css");
    expect(result.output).not.toContain("Unconfigured CSS rule");

    for (const { name } of RULES) {
      expect(result.output).toContain(`fabrika/${name}`);
    }
  });

  it("law 30 fails if stylelint crashes before it can report", () => {
    const repo = runnerRepo();
    track(repo, { "apps/plant/window.css": ".a { color: var(--focus); }\n" });
    write(repo, "stylelint.config.ts", 'throw new Error("planted stylelint crash");\n');
    const result = run(repo);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("planted stylelint crash");
  });

  it.each([
    {
      comment: "/* stylelint-disable */",
      css: ".a { color: #fff; }",
      report: "--report-unscoped-disables",
    },
    {
      comment: "/* stylelint-disable fabrika/no-raw-color */",
      css: ".a { color: #fff; }",
      report: "--report-descriptionless-disables",
    },
    {
      comment: "/* stylelint-disable fabrika/no-such-rule -- planted scope */",
      css: ".a { color: var(--focus); }",
      report: "--report-invalid-scope-disables",
    },
    {
      comment: "/* stylelint-disable fabrika/no-raw-color -- planted unused disable */",
      css: ".a { color: var(--focus); }",
      report: "--report-needless-disables",
    },
  ])("law 30 reports $report", async ({ comment, css, report }) => {
    const file = write(temp(), "disable.css", `${comment}\n${css}\n`);
    const warnings = await lint(file);
    expect(warnings.map(({ rule }) => rule)).toContain(report);
    expect(warnings.every(({ severity }) => severity === "error")).toBe(true);
  });

  it("law 30 allows a needed disable that names its rule and reason", async () => {
    const file = write(
      temp(),
      "disable.css",
      "/* stylelint-disable fabrika/no-raw-color -- planted contrast sample */\n.a { color: #fff; }\n/* stylelint-enable fabrika/no-raw-color */\n",
    );
    expect(await lint(file)).toEqual([]);
  });
});
