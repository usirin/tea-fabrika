import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  readdirSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, matchesGlob, resolve, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { testConfig } from "../vitest.config.ts";

const root = resolve(import.meta.dirname, "..");
const options = { seed: 325, numRuns: 4 };
const configUrl = pathToFileURL(join(root, "vitest.config.ts")).href;

const load = `
if (process.env.TEST_NODE_VERSION) {
  Object.defineProperty(process, 'version', {value: 'v' + process.env.TEST_NODE_VERSION});
  Object.defineProperty(process.versions, 'node', {value: process.env.TEST_NODE_VERSION});
}
process.argv = ['node', process.env.TEST_PROGRAMMATIC === '1' ? 'example.mjs' : 'vitest', ...JSON.parse(process.env.TEST_ARGS)];
const {default: config} = await import(process.env.TEST_CONFIG ?? ${JSON.stringify(configUrl)});
const {testConfig: shared} = await import(${JSON.stringify(configUrl)});
const {Shards} = await import(${JSON.stringify(pathToFileURL(join(root, "vitest.shards.ts")).href)});
const base = typeof config === 'function' ? await config({command: 'serve', mode: 'test'}) : config;
const {resolveConfig} = await import(${JSON.stringify(pathToFileURL(createRequire(import.meta.resolve("vitest/package.json")).resolve("vite")).href)});
if (process.env.TEST_NODE_MISSING === '1') Object.defineProperty(process.versions, 'node', {value: undefined});
const value = process.env.TEST_IMPORT_ONLY === '1' ? base : await resolveConfig({...base, configFile: false}, 'serve', 'test');
if (process.env.TEST_SETUP === '1') {
  for (const file of [value.test.setupFiles ?? []].flat()) await import(new URL(file, process.env.TEST_SETUP_ROOT ?? ${JSON.stringify(pathToFileURL(`${root}/`).href)}));
}
console.log(JSON.stringify({workers: value.test.maxWorkers, home: process.env.FABRIKA_HOME ?? null,
  personHome: process.env.HOME ?? null,
  testTimeout: value.test.testTimeout, hookTimeout: value.test.hookTimeout,
  shared,
  sharedTimeouts: [shared?.test?.testTimeout, shared?.test?.hookTimeout],
  setupFiles: value.test.setupFiles, sequencer: value.test.sequence?.sequencer === Shards,
  forceRerunTriggers: value.test.forceRerunTriggers, include: value.test.include}));
`;

const probe = (cwd: string, args: string[], env: Record<string, string | undefined> = {}) =>
  spawnSync(process.execPath, ["--input-type=module", "-e", load], {
    cwd,
    encoding: "utf8",
    timeout: 5_000,
    env: {
      ...process.env,
      CI: undefined,
      TYPESAFE_API_KEY: undefined,
      TEST_ARGS: JSON.stringify(args),
      ...env,
    },
  });

const freshHomes = (stdout: string, temp: string, inherited: string[]) => {
  const got = JSON.parse(stdout);
  expect(got.home).not.toBe(got.personHome);
  for (const path of [got.home, got.personHome]) {
    expect(typeof path).toBe("string");
    const child = relative(temp, path);
    expect(child.length).toBeGreaterThan(0);
    expect(child.startsWith("..") || isAbsolute(child)).toBe(false);
    expect(inherited).not.toContain(path);
    expect(readdirSync(path)).toEqual([]);
  }
  expect(Buffer.byteLength(join(got.home, "host", "sock"))).toBeLessThan(103);
};

describe("T325 K9 machine caps, today's tooling", () => {
  // pinned: T377, string-only imports left testConfig without a real consumer.
  // Plant: import a different config in the child with one shared setting changed.
  it("pinned: T377 child loads the parent's shared config", () => {
    const ran = probe(root, ["run", "--maxWorkers=1", "scripts/caps.test.ts"]);
    expect(ran.status, ran.stderr).toBe(0);
    expect(JSON.parse(ran.stdout).shared).toEqual(JSON.parse(JSON.stringify(testConfig)));
  });

  // No domain Schema for runtime versions. Plant: omit the check or refuse CI too.
  it("R5 refuses mismatched or missing local Node versions and lets CI run", () => {
    const pinned = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).engines?.node;
    expect(pinned).toBe("26.13.0");
    fc.assert(
      fc.property(fc.tuple(fc.integer({ min: 20, max: 30 }), fc.nat({ max: 30 }), fc.nat({ max: 30 })), (parts) => {
        const different = parts.join(".") === pinned ? `${parts[0]}.0.99` : parts.join(".");

        for (const version of [pinned, different, undefined]) {
          for (const ci of [undefined, "1"]) {
            const ran = probe(root, ["run", "--maxWorkers=1", "scripts/caps.test.ts"], {
              CI: ci,
              TEST_NODE_VERSION: version,
              TEST_NODE_MISSING: version === undefined ? "1" : undefined,
            });
            const refused = !ci && version !== pinned;
            expect(ran.status, ran.stderr).toBe(refused ? 1 : 0);

            if (refused) {
              const lines = ran.stderr.split("\n").filter((line) => line.includes("Local test run refused"));
              expect(lines).toHaveLength(1);
              expect(lines[0]).toContain(version === undefined ? process.version : `v${version}`);
              expect(lines[0]).toContain(`v${pinned}`);
              expect(lines[0]).toContain(`volta run --node ${pinned}`);
            }
          }
        }
      }),
      {
        ...options,
        seed: 119120,
        numRuns: 5,
        endOnFailure: true,
        examples: [[[26, 13, 1]], [[26, 0, 0]]],
      },
    );
  });

  // R4 findings 4 and 7. Process order and temp roots have no domain Schema.
  // Plants: put the lock under TMPDIR; never recover a lock after its owner is killed.
  for (const [ended, title] of [
    ["alive", "shares the typecheck lock across temp roots"],
    ["group", "recovers a killed typecheck holder"],
    ["wrapper", "keeps the compiler lock after its wrapper dies"],
  ] as const) {
    it(`R4 ${title}`, async () => {
      await fc.assert(
        fc.asyncProperty(fc.stringMatching(/^[a-z]{2,8}$/), async (suffix) => {
          const dir = mkdtempSync(join(tmpdir(), "tc-r4-"));
          const children: ChildProcess[] = [];

          try {
            const bin = join(dir, "bin"),
              events = join(dir, "events");
            mkdirSync(bin);
            writeFileSync(events, "");
            writeFileSync(
              join(dir, "compiler.mjs"),
              `import {appendFileSync, existsSync} from 'node:fs';
if (process.argv.includes('patch')) process.exit(0);
appendFileSync(process.env.TEST_EVENTS, 'start '+process.env.TEST_ID+'\\n');
setInterval(() => { if (existsSync(process.env.TEST_RELEASE)) process.exit(0); }, 10);
`,
            );

            for (const command of ["pnpm", "tsgo", "effect-tsgo"]) {
              writeFileSync(
                join(bin, command),
                `#!/bin/sh\nexec '${process.execPath}' '${join(dir, "compiler.mjs")}' "$@"\n`,
                { mode: 0o755 },
              );
            }

            const start = (id: string, temp: string) => {
              mkdirSync(temp, { recursive: true });
              const child = spawn("sh", [join(root, "scripts/typecheck.sh")], {
                cwd: root,
                detached: true,
                stdio: "ignore",
                env: {
                  ...process.env,
                  PATH: `${bin}:${process.env.PATH}`,
                  TMPDIR: temp,
                  TEST_EVENTS: events,
                  TEST_ID: id,
                  TEST_RELEASE: join(dir, `release-${id}`),
                  TYPESAFE_API_KEY: undefined,
                },
              });
              children.push(child);
              return child;
            };
            const until = async (test: () => boolean) => {
              const end = Date.now() + 3_000;

              while (!test() && Date.now() < end) {
                await new Promise((r) => setTimeout(r, 20));
              }

              expect(test(), readFileSync(events, "utf8")).toBe(true);
            };
            const temp = join(dir, suffix),
              first = start("a", temp);
            await until(() => readFileSync(events, "utf8").includes("start a"));

            if (ended !== "alive") {
              process.kill(ended === "group" ? -first.pid! : first.pid!, "SIGKILL");
              await until(() => first.signalCode !== null);
            }

            const second = start("b", ended === "group" ? temp : join(dir, `${suffix}-other`));

            if (ended !== "group") {
              await new Promise((r) => setTimeout(r, 250));
              expect(readFileSync(events, "utf8"), "two fake compilers overlapped").toBe("start a\n");
              writeFileSync(join(dir, "release-a"), "");

              if (ended === "alive") {
                await until(() => first.exitCode !== null);
              }
            }

            await until(() => readFileSync(events, "utf8").includes("start b"));
            writeFileSync(join(dir, "release-b"), "");
            await until(() => second.exitCode !== null);
            expect(second.exitCode).toBe(0);
          } finally {
            for (const child of children) {
              try {
                if (child.pid) {
                  process.kill(-child.pid, "SIGKILL");
                }
              } catch {
                /* Already reaped. */
              }
            }

            rmSync(dir, { recursive: true, force: true });
          }
        }),
        { ...options, seed: 119120, numRuns: 2, endOnFailure: true },
      );
    });
  }

  // R4 finding 8. Plant: inherit the whole temp-root length into a socket home.
  it("R4 bounds generated home bytes even under long temp roots", () => {
    fc.assert(
      fc.property(fc.integer({ min: 104, max: 180 }), (length) => {
        const dir = mkdtempSync(join(tmpdir(), "fh-r4-"));
        let generated: string | undefined;

        try {
          const temp = join(dir, "x".repeat(length));
          mkdirSync(temp);
          const ran = probe(root, ["run", "scripts/caps.test.ts"], {
            TMPDIR: temp,
            FABRIKA_HOME: undefined,
            TEST_SETUP: "1",
          });
          expect(ran.status, ran.stderr).toBe(0);
          generated = JSON.parse(ran.stdout).home;
          expect(typeof generated).toBe("string");
          expect(Buffer.byteLength(generated!)).toBeLessThan(103);
          expect(existsSync(generated!)).toBe(true);
        } finally {
          if (generated) {
            rmSync(generated, { recursive: true, force: true });
          }

          rmSync(dir, { recursive: true, force: true });
        }
      }),
      { ...options, numRuns: 2 },
    );
  });

  // R4 finding 5. CLI spellings have no domain Schema. Plant: compare a percentage as a number.
  it("R4 enforces the cap on every maxWorkers spelling", () => {
    fc.assert(
      fc.property(
        fc.record({ cap: fc.integer({ min: 1, max: 3 }), percent: fc.integer({ min: 1, max: 250 }) }),
        ({ cap, percent }) => {
          const counts = spawnSync(process.execPath, ["-p", "require('node:os').availableParallelism()"], {
            encoding: "utf8",
          });
          const cpus = Number(counts.stdout);
          const resolved = Math.max(1, Math.min(cpus, Math.round((percent / 100) * cpus)));

          for (const [value, count] of [
            [`${percent}%`, resolved],
            [` ${percent}.5% `, resolved],
            ["100%", cpus],
            ["1%", Math.max(1, Math.round(cpus / 100))],
            [String(cap + 1), cap + 1],
            ["1", 1],
          ] as const) {
            for (const args of [
              [`--maxWorkers=${value}`],
              ["--maxWorkers", value],
              [`--max-workers=${value}`],
              ["--max-workers", value],
            ]) {
              const ran = probe(root, ["run", ...args, "scripts/caps.test.ts"], {
                FABRIKA_MAX_WORKERS: String(cap),
              });
              expect(ran.status, `${args.join(" ")} resolved to ${count} with cap ${cap}: ${ran.stderr}`).toBe(
                count > cap ? 1 : 0,
              );

              if (count <= cap) {
                expect(JSON.parse(ran.stdout).workers).toBe(count);
              }
            }
          }
        },
      ),
      { ...options, numRuns: 2 },
    );
  });

  // R4 finding 6. Plants: trust any positional filter, omit untracked or staged files,
  // compare two endpoints, or use a matcher which skips hidden path segments.
  it("R4 covers broad filters and Vitest's changed-file classes", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{2,8}$/), (suffix) => {
        const dir = mkdtempSync(join(tmpdir(), "caps-git-"));

        try {
          const git = (...args: string[]) => {
            const ran = spawnSync("git", ["-c", "user.name=Tests", "-c", "user.email=tests@example.invalid", ...args], {
              cwd: dir,
              encoding: "utf8",
            });
            expect(ran.status, ran.stderr).toBe(0);
          };
          const put = (file: string, text: string) => {
            mkdirSync(dirname(join(dir, file)), { recursive: true });
            writeFileSync(join(dir, file), text);
          };
          git("init", "-q");
          put("pnpm-lock.yaml", "base");
          git("add", ".");
          git("commit", "-qm", "base");
          git("update-ref", "refs/remotes/origin/main", "HEAD");

          for (const filter of [".", "test", "./", dir]) {
            const ran = probe(dir, ["run", filter]);
            expect(ran.status, `broad filter ${filter}`).toBe(1);
            expect(ran.stderr).toContain("<narrow path>");
          }

          // T375: skill paths follow imports instead of forcing every test to rerun.
          for (const [path, refused] of [
            [`fixtures/.${suffix}/input.ts`, true],
            [`.agents/skills/${suffix}/SKILL.md`, false],
            [`.claude/skills/${suffix}/SKILL.md`, false],
          ] as const) {
            put(path, "untracked");
            expect(probe(dir, ["run", "--changed"]).status, `untracked ${path}`).toBe(refused ? 1 : 0);
            rmSync(join(dir, path));
          }

          put("pnpm-lock.yaml", "staged");
          git("add", "pnpm-lock.yaml");
          put("pnpm-lock.yaml", "base");
          expect(probe(dir, ["run", "--changed"]).status, "staged change canceled by working copy").toBe(1);
          git("restore", "--staged", "pnpm-lock.yaml");
          // Both branches independently write equal bytes. Three-dot still sees our commit.
          git("checkout", "-qb", "other");
          put("pnpm-lock.yaml", suffix);
          git("add", ".");
          git("commit", "-qm", "other");
          git("update-ref", "refs/remotes/origin/main", "HEAD");
          git("checkout", "--detach", "HEAD^");
          put("pnpm-lock.yaml", suffix);
          git("add", ".");
          git("commit", "-qm", "ours");
          expect(probe(dir, ["run", "--changed=origin/main"]).status, "equal divergent changes").toBe(1);
          // Main alone changed a trigger. Our branch only changes ordinary source.
          git("checkout", "--detach", "HEAD^");
          put("plain.ts", suffix);
          git("add", ".");
          git("commit", "-qm", "source");
          expect(probe(dir, ["run", "--changed=origin/main"]).status, "main-only trigger must not refuse").toBe(0);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      { ...options, numRuns: 2 },
    );
  });

  // R4 finding 9. Plant: export a callback, or run the person's guard while merely importing.
  it("R4 keeps the default config usable by mergeConfig and object spreads", () => {
    fc.assert(
      fc.property(fc.constantFrom("merge", "spread", "p10"), (form) => {
        const dir = mkdtempSync(join(tmpdir(), "caps-export-"));

        try {
          const wrapper = join(dir, "config.mjs");
          writeFileSync(
            wrapper,
            form === "p10"
              ? `export {default} from ${JSON.stringify(pathToFileURL(join(root, "fixtures/next/p10/vitest.config.ts")).href)};`
              : `import base from ${JSON.stringify(configUrl)};\nimport {mergeConfig} from ${JSON.stringify(import.meta.resolve("vitest/config"))};\nexport default ${form === "merge" ? "mergeConfig(base, {test: {includeTaskLocation: true}})" : '{...base, test: {...base.test, include: ["one.test.ts"]}}'};`,
          );

          for (const args of [[], ["run"]]) {
            const imported = probe(root, args, {
              TEST_CONFIG: pathToFileURL(wrapper).href,
              TEST_IMPORT_ONLY: "1",
            });
            expect(imported.status, imported.stderr).toBe(0);
            expect(JSON.parse(imported.stdout).testTimeout).toBe(60_000);
          }

          const programmatic = probe(root, [], {
            TEST_CONFIG: pathToFileURL(wrapper).href,
            TEST_PROGRAMMATIC: "1",
          });
          expect(programmatic.status, programmatic.stderr).toBe(0);
          const ran = probe(root, ["run", "scripts/caps.test.ts"], {
            TEST_CONFIG: pathToFileURL(wrapper).href,
          });
          expect(ran.status, ran.stderr).toBe(0);
          const got = JSON.parse(ran.stdout);
          expect(got.testTimeout).toBe(60_000);
          expect(got.setupFiles).toContain("./scripts/vitest.setup.ts");
          expect(got.sequencer).toBe(true);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
        // pinned: T325 R4, the default callback broke all three existing caller shapes.
      }),
      { ...options, examples: [["merge"], ["spread"], ["p10"]] },
    );
  });

  // Plant: replace the env cap with 3.
  it("uses FABRIKA_MAX_WORKERS, defaults to three, and refuses invalid counts", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), (n) => {
        for (const [setting, count] of [
          [String(n), n],
          [undefined, 3],
        ] as const) {
          const ran = probe(root, ["run", "scripts/caps.test.ts"], { FABRIKA_MAX_WORKERS: setting });
          expect(ran.status, ran.stderr).toBe(0);
          expect(JSON.parse(ran.stdout).workers).toBe(count);
        }

        for (const requested of [1, n + 1]) {
          const ran = probe(root, ["run", `--maxWorkers=${requested}`, "scripts/caps.test.ts"], {
            FABRIKA_MAX_WORKERS: String(n),
          });
          expect(ran.status, ran.stderr).toBe(requested > n ? 1 : 0);
          expect(
            requested > n ? ran.stderr.includes("FABRIKA_MAX_WORKERS") : JSON.parse(ran.stdout).workers === requested,
          ).toBe(true);
        }

        for (const setting of ["0", "-1", "1.5", "garbage"]) {
          expect(probe(root, ["run", "scripts/caps.test.ts"], { FABRIKA_MAX_WORKERS: setting }).status).not.toBe(0);
        }
      }),
      options,
    );
  });

  // Plant: allow a force trigger to turn local --changed into a full run. This loads the real
  // config only. It never starts a broad Vitest process, even if the guard is broken.
  it("refuses local broad runs after force triggers, names a narrow command, and leaves CI alone", () => {
    fc.assert(
      fc.property(
        fc.record({
          trigger: fc.constantFrom("pnpm-lock.yaml", "oxlint-plugins/index.ts", "fixtures/toy/input.txt"),
          form: fc.constantFrom("--changed=origin/main", "--changed", "--changed", "--changed=origin/main"),
        }),
        ({ trigger, form }) => {
          const dir = mkdtempSync(join(tmpdir(), "caps-"));

          try {
            const git = (...args: string[]) => {
              const ran = spawnSync(
                "git",
                ["-c", "user.name=Tests", "-c", "user.email=tests@example.invalid", ...args],
                { cwd: dir, encoding: "utf8" },
              );
              expect(ran.status, ran.stderr).toBe(0);
            };
            git("init", "-q");
            writeFileSync(join(dir, "base"), "base");
            git("add", "base");
            git("commit", "-qm", "base");
            git("update-ref", "refs/remotes/origin/main", "HEAD");
            mkdirSync(dirname(join(dir, trigger)), { recursive: true });
            writeFileSync(join(dir, trigger), "changed");
            git("add", trigger);

            for (const args of [["run"], ["run", form], ["run", "--changed", "origin/main"]]) {
              const ran = probe(dir, args);
              expect(ran.status).not.toBe(0);
              expect(ran.stderr).toContain("pnpm exec vitest run --maxWorkers=1 <narrow path>");
              expect(probe(dir, args, { CI: "1" }).status).toBe(0);
            }

            expect(probe(dir, ["run", "scripts/caps.test.ts"]).status).toBe(0);
            git("restore", "--staged", "--", trigger);
            rmSync(join(dir, trigger));

            // T375: source and skill changes alone must not force a broad run.
            for (const path of ["plain.ts", ".agents/skills/lead/SKILL.md", ".claude/skills/lead/SKILL.md"]) {
              mkdirSync(dirname(join(dir, path)), { recursive: true });
              writeFileSync(join(dir, path), "changed");
              git("add", path);

              for (const args of [
                ["run", form],
                ["run", "--changed", "origin/main"],
              ]) {
                expect(probe(dir, args).status, path).toBe(0);
              }
            }
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      options,
    );
  });

  // Plants: export a function as testConfig; drop setupFiles; run the local guard on import.
  // fast-check supplies raw CLI and RELATED edge cases; there is no domain Schema for either.
  // Load the wrapper emitted by run.sh so its real imports and shared settings are checked.
  // The disposable setup only marks that it ran. The real home guard still has its laws below.
  it("preserves shared settings and configured setup in Stryker without the local CLI guard", () => {
    fc.assert(
      fc.property(
        fc.record({
          paths: fc.uniqueArray(fc.stringMatching(/^[a-z]{1,8}\.test\.ts$/), {
            minLength: 1,
            maxLength: 3,
          }),
          args: fc.constantFrom([], ["run"], ["run", "stryker.config.json"]),
          ci: fc.constantFrom(undefined, "1"),
          trigger: fc.constantFrom("pnpm-lock.yaml", "fixtures/toy/input.txt", ".github/workflows/check.yaml"),
        }),
        ({ paths, args, ci, trigger }) => {
          const dir = mkdtempSync(join(tmpdir(), "caps-config-"));

          try {
            mkdirSync(join(dir, "scripts"));
            writeFileSync(join(dir, "scripts/vitest.setup.ts"), "process.env.FABRIKA_HOME = process.env.TEST_HOME;\n");
            const source = readFileSync(join(root, ".agents/skills/mutation/scripts/run.sh"), "utf8")
              .split("<<'TS'\n")[1]
              ?.split("\nTS\n")[0];

            if (!source) {
              throw new Error("run.sh did not emit a Vitest config");
            }

            const wrapper = join(dir, "vitest.mutation.config.mjs");
            writeFileSync(
              wrapper,
              source
                .replace('"./vitest.config.ts"', JSON.stringify(configUrl))
                .replace('"vitest/config"', JSON.stringify(import.meta.resolve("vitest/config"))),
            );

            for (const mutation of [true, false]) {
              const ran = probe(root, mutation ? args : ["run", "scripts/caps.test.ts"], {
                CI: ci,
                RELATED: ` , ${paths.join(" , ")} , `,
                TEST_CONFIG: mutation ? pathToFileURL(wrapper).href : undefined,
                TEST_SETUP: "1",
                TEST_SETUP_ROOT: pathToFileURL(`${dir}/`).href,
                TEST_HOME: join(dir, "marked-home"),
                FABRIKA_HOME: undefined,
              });
              expect(ran.status, ran.stderr).toBe(0);
              const got = JSON.parse(ran.stdout);
              expect(got.testTimeout).toBe(mutation ? 10_000 : 60_000);
              expect(got.hookTimeout).toBe(mutation ? 10_000 : 60_000);
              expect(got.home).toBe(join(dir, "marked-home"));
              expect(got.setupFiles).toContain("./scripts/vitest.setup.ts");
              expect(got.sequencer).toBe(true);
              expect(got.sharedTimeouts).toEqual([60_000, 60_000]);

              // T375: Stryker keeps the remaining triggers and skill non-triggers.
              for (const [path, forced] of [
                [trigger, true],
                [".agents/skills/tests/SKILL.md", false],
                [".claude/skills/tests/SKILL.md", false],
              ] as const) {
                expect(
                  got.forceRerunTriggers.some((glob: string) => matchesGlob(path, glob)),
                  path,
                ).toBe(forced);
              }

              if (mutation) {
                expect(got.workers).toBe(1);
                expect(got.include).toEqual(paths);
              }
            }
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      {
        ...options,
        // pinned: T325 round 2, Stryker loads the config without a Vitest path or CI.
        examples: [[{ paths: ["caps.test.ts"], args: [], ci: undefined, trigger: "pnpm-lock.yaml" }]],
      },
    );
  });

  // Plants: leave FABRIKA_HOME unset; compare the spelling without resolving a symlink.
  it("L2 replaces direct or linked real homes with fresh homes", () => {
    fc.assert(
      fc.property(fc.record({ link: fc.boolean(), suffix: fc.stringMatching(/^[a-z]{1,6}$/) }), ({ link, suffix }) => {
        const dir = mkdtempSync(join(tmpdir(), "fh-"));

        try {
          const home = join(dir, "person"),
            real = join(home, ".fabrika"),
            safe = join(dir, suffix);
          mkdirSync(real, { recursive: true });
          mkdirSync(safe);
          const alias = join(dir, "alias");
          symlinkSync(real, alias);
          const env = { HOME: home, TMPDIR: dir, TEST_SETUP: "1" };
          const unset = probe(root, ["run", "scripts/caps.test.ts"], {
            ...env,
            FABRIKA_HOME: undefined,
          });
          expect(unset.status, unset.stderr).toBe(0);
          const got = JSON.parse(unset.stdout).home;
          expect(typeof got, "test setup left FABRIKA_HOME unset").toBe("string");
          expect(got.startsWith(dir)).toBe(true);
          expect(Buffer.byteLength(got)).toBeLessThan(103);
          expect(existsSync(got)).toBe(true);
          expect(probe(root, ["run", "scripts/caps.test.ts"], { ...env, FABRIKA_HOME: safe }).status).toBe(0);
          const bad = probe(root, ["run", "scripts/caps.test.ts"], {
            ...env,
            FABRIKA_HOME: link ? alias : real,
          });
          expect(bad.status, bad.stderr).toBe(0);
          freshHomes(bad.stdout, dir, [home, real, alias]);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      { seed: 119120, numRuns: 4 },
    );
  });

  // Plant: compare only the supplied spelling and accept a symlink into the real home.
  it("L2 replaces every spelling and explicit temp homes", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z]{2,8}$/), (suffix) => {
        const dir = mkdtempSync(join(tmpdir(), "fh-link-"));

        try {
          const home = join(dir, "person"),
            real = join(home, ".fabrika"),
            safe = join(dir, suffix);
          mkdirSync(real, { recursive: true });
          mkdirSync(safe);
          const alias = join(dir, "alias");
          symlinkSync(real, alias);
          const env = { HOME: home, TMPDIR: dir, TEST_SETUP: "1" };
          const accepted = probe(root, ["run", "scripts/caps.test.ts"], {
            ...env,
            FABRIKA_HOME: safe,
          });
          expect(accepted.status, accepted.stderr).toBe(0);
          freshHomes(accepted.stdout, dir, [home, safe]);

          for (const path of [real, alias, join(real, "..", ".fabrika")]) {
            const refused = probe(root, ["run", "scripts/caps.test.ts"], {
              ...env,
              FABRIKA_HOME: path,
            });
            expect(refused.status, refused.stderr).toBe(0);
            freshHomes(refused.stdout, dir, [home, path]);
          }
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      { seed: 119120, numRuns: 4 },
    );
  });

  // L1 plant: keep an inherited folder, including its old state.
  it("L1 replaces arbitrary inherited homes with empty short temp homes", () => {
    fc.assert(
      fc.property(
        fc.record({
          home: fc.option(fc.constantFrom("dirty", "alias", "dot", "outside"), { nil: undefined }),
          app: fc.option(fc.constantFrom("dirty", "alias", "dot", "outside"), { nil: undefined }),
          length: fc.integer({ min: 1, max: 120 }),
        }),
        ({ home, app, length }) => {
          const dir = mkdtempSync(join(tmpdir(), "law-"));
          try {
            const dirty = join(dir, ".fabrika");
            mkdirSync(dirty);
            writeFileSync(join(dirty, "old"), "old state");
            mkdirSync(join(dir, "real"));
            symlinkSync(dirty, join(dir, "alias"));
            const paths = {
              dirty,
              alias: join(dir, "alias"),
              dot: dir + "/real/../.fabrika",
              outside: join(dir, "outside"),
            };
            const temp = join(dir, "t".repeat(length));
            mkdirSync(temp);
            const ran = probe(root, ["run", "scripts/caps.test.ts"], {
              TEST_SETUP: "1",
              TMPDIR: temp,
              HOME: home === undefined ? undefined : paths[home],
              FABRIKA_HOME: app === undefined ? undefined : paths[app],
            });
            expect(ran.status, ran.stderr).toBe(0);
            freshHomes(
              ran.stdout,
              Buffer.byteLength(join(temp, "fh-XXXXXX", "host", "sock")) < 103 ? temp : "/tmp",
              Object.values(paths),
            );
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      { seed: 119120, numRuns: 12 },
    );
  });

  // scenario: the locked home from ticket 574. Plant: read homedir()/.fabrika.
  it("L3 ignores a locked inherited home", () => {
    const dir = mkdtempSync(join(tmpdir(), "locked-"));
    const home = join(dir, "person");
    mkdirSync(join(home, ".fabrika"), { recursive: true });
    chmodSync(home, 0);
    try {
      const ran = probe(root, ["run", "scripts/caps.test.ts"], {
        TEST_SETUP: "1",
        HOME: home,
        FABRIKA_HOME: undefined,
        TMPDIR: dir,
      });
      expect(ran.status, ran.stderr).toBe(0);
      freshHomes(ran.stdout, dir, [home]);
    } finally {
      chmodSync(home, 0o700);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Plant: release the lock while the compiler is still alive. The compiler and pnpm below are
  // controlled stand-ins. No real typecheck runs; overlapping wrappers must serialize their work.
  it("holds one typecheck lock through success, failure and an interrupted waiter", async () => {
    expect(
      existsSync(join(root, "scripts/typecheck.sh")),
      "typecheck.sh is absent, so typechecks have no shared lock",
    ).toBe(true);
    await fc.assert(
      fc.asyncProperty(
        fc.record({ code: fc.constantFrom(0, 1, 2), cancel: fc.boolean() }),
        async ({ code, cancel }) => {
          const dir = mkdtempSync(join(tmpdir(), "tc-"));
          const children: ChildProcess[] = [];

          try {
            const bin = join(dir, "bin");
            mkdirSync(bin);
            writeFileSync(
              join(dir, "compiler.mjs"),
              `import {appendFileSync, existsSync} from 'node:fs';\nconst id = process.env.TEST_ID;\nif (process.argv.includes('patch')) process.exit(0);\nappendFileSync(process.env.TEST_EVENTS, 'start '+id+'\\n');\nconst timer = setInterval(() => {if (existsSync(process.env.TEST_RELEASE)) {clearInterval(timer); appendFileSync(process.env.TEST_EVENTS, 'end '+id+'\\n'); process.exit(Number(process.env.TEST_EXIT));}}, 10);\n`,
            );

            for (const command of ["pnpm", "tsgo", "effect-tsgo"]) {
              writeFileSync(
                join(bin, command),
                `#!/bin/sh\nexec '${process.execPath}' '${join(dir, "compiler.mjs")}' "$@"\n`,
                { mode: 0o755 },
              );
            }

            const events = join(dir, "events");
            writeFileSync(events, "");
            const start = (id: string, code: number) => {
              const child = spawn("sh", [join(root, "scripts/typecheck.sh")], {
                cwd: root,
                detached: true,
                env: {
                  ...process.env,
                  PATH: `${bin}:${process.env.PATH}`,
                  TMPDIR: dir,
                  TEST_ID: id,
                  TEST_EXIT: String(code),
                  TEST_EVENTS: events,
                  TEST_RELEASE: join(dir, `release-${id}`),
                  TYPESAFE_API_KEY: undefined,
                },
                stdio: "ignore",
              });
              children.push(child);
              return child;
            };
            const until = async (test: () => boolean) => {
              const end = Date.now() + 3_000;

              while (!test() && Date.now() < end) {
                await new Promise((r) => setTimeout(r, 15));
              }

              expect(test(), readFileSync(events, "utf8")).toBe(true);
            };
            const first = start("a", code);
            await until(() => readFileSync(events, "utf8").includes("start a"));
            const second = start("b", 0);
            await new Promise((r) => setTimeout(r, 100));
            expect(readFileSync(events, "utf8")).toBe("start a\n");

            if (cancel) {
              second.kill("SIGTERM");
              await until(() => second.signalCode !== null);
            }

            writeFileSync(join(dir, "release-a"), "");
            await until(() => first.exitCode !== null);
            expect(first.exitCode).toBe(code);

            if (!cancel) {
              await until(() => readFileSync(events, "utf8").includes("start b"));
              writeFileSync(join(dir, "release-b"), "");
              await until(() => second.exitCode !== null);
              expect(second.exitCode).toBe(0);
            }

            const last = start("c", 0);
            await until(() => readFileSync(events, "utf8").includes("start c"));
            writeFileSync(join(dir, "release-c"), "");
            await until(() => last.exitCode !== null);
            expect(last.exitCode).toBe(0);
          } finally {
            for (const child of children) {
              try {
                if (child.pid) {
                  process.kill(-child.pid, "SIGKILL");
                }
              } catch {
                /* Already reaped. */
              }
            }

            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      options,
    );
  });
});
