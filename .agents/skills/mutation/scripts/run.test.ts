import "./run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./sample.ts?raw";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Today's tooling. Only the labeled package-import scenario starts real Stryker.
const script = join(import.meta.dirname, "run.sh");
const root = join(import.meta.dirname, "../../../..");
const options = { seed: 300, numRuns: 8 };

const helper = String.raw`
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const dir = process.env.COMMAND_FIXTURE;
const setup = JSON.parse(fs.readFileSync(path.join(dir, "setup.json"), "utf8"));
const args = process.argv.slice(2);
if (args[0]?.endsWith("/sample.ts")) {
  fs.appendFileSync(path.join(dir, "sample-calls.jsonl"), JSON.stringify(args) + "\n");
  const report = args[args.indexOf("--report") + 1];
  if (report) fs.writeFileSync(report, JSON.stringify({seed:119120, ranges:setup.ranges, total:1, selected:1, left:0}));
  process.stdout.write(setup.ranges.join(","));
  process.exit(setup.sampleExit);
}
if (args[0]?.endsWith("/core/bin/stryker.js")) {
  const config = JSON.parse(fs.readFileSync(args[2], "utf8"));
  const vitest = fs.readFileSync(path.join(dir, config.vitest.configFile), "utf8");
  fs.writeFileSync(path.join(dir, "invoked.json"), JSON.stringify({args, config, vitest}));
  if (setup.orphan) {
    const left = cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio:"ignore"});
    fs.writeFileSync(path.join(dir, "pids.json"), JSON.stringify([left.pid]));
  }
  if (!setup.hold) process.exit(setup.exit);
  const child = cp.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio:"ignore"});
  fs.writeFileSync(path.join(dir, "pids.json"), JSON.stringify([process.pid, child.pid]));
  setInterval(() => {}, 1000);
} else throw new Error("unhandled tool " + args[0]);
`;

type Setup = { ranges: string[]; sampleExit: number; exit: number; hold: boolean; orphan?: boolean };
const defaults: Setup = { ranges: ['"src/math.ts:1:0-1:30"'], sampleExit: 0, exit: 0, hold: false };

const fixture = (setup: Setup, inputs: { T?: string; BUILD?: string; RELATED?: string }) => {
  expect(existsSync(script), "build must extract the executable run.sh").toBe(true);
  const dir = mkdtempSync(join(tmpdir(), "mut-command-"));
  const bin = join(dir, "bin"),
    temp = join(dir, "tmp");
  mkdirSync(bin);
  mkdirSync(temp);
  writeFileSync(join(dir, "setup.json"), JSON.stringify(setup));
  writeFileSync(join(dir, "tool.cjs"), helper);
  writeFileSync(
    join(bin, "node"),
    `#!/bin/sh\ncase "$1" in\n*/sample.ts|*/core/bin/stryker.js) exec '${process.execPath}' '${join(dir, "tool.cjs")}' "$@";;\n*) exec '${process.execPath}' "$@";;\nesac\n`,
    { mode: 0o755 },
  );
  // nice is blocked in the box. If retained outside it, only this local shim can run.
  writeFileSync(join(bin, "nice"), '#!/bin/sh\n[ "$1" != -n ] || shift 2\nexec "$@"\n', {
    mode: 0o755,
  });
  mkdirSync(join(dir, ".agents/skills/mutation/scripts"), { recursive: true });

  if (existsSync(script)) {
    writeFileSync(join(dir, ".agents/skills/mutation/scripts/run.sh"), readFileSync(script));
  }

  writeFileSync(join(dir, ".agents/skills/mutation/scripts/sample.ts"), "// intercepted sampler\n");
  writeFileSync(
    join(dir, "vitest.config.ts"),
    'export const testConfig = {test: {include: ["all/**/*.test.ts"], exclude: ["keep-me"]}};\nexport default testConfig;\n',
  );
  return {
    dir,
    temp,
    env: {
      ...process.env,
      ...inputs,
      PATH: `${bin}:/usr/bin:/bin`,
      TMPDIR: temp,
      COMMAND_FIXTURE: dir,
      TYPESAFE_API_KEY: undefined,
      FABRIKA_HOME: join(dir, "fh"),
    },
    script: join(dir, ".agents/skills/mutation/scripts/run.sh"),
  };
};

type Invocation = {
  args: string[];
  config: {
    vitest: { related: boolean; configFile: string };
    mutate: string[];
    concurrency: number;
    ignoreStatic: boolean;
    incremental: boolean;
    incrementalFile: string;
    coverageAnalysis: string;
    timeoutMS: number;
  };
  vitest: string;
};

const invoked = (dir: string): Invocation | undefined =>
  existsSync(join(dir, "invoked.json")) ? JSON.parse(readFileSync(join(dir, "invoked.json"), "utf8")) : undefined;

const run = (setup: Setup, inputs: { T?: string; BUILD?: string; RELATED?: string }) => {
  const f = fixture(setup, inputs);

  try {
    const ran = spawnSync("sh", [f.script], {
      cwd: f.dir,
      env: f.env,
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(ran.error).toBeUndefined();
    expect(ran.signal).toBeNull();
    const sample = join(f.dir, "sample-calls.jsonl");
    return {
      code: ran.status,
      text: ran.stdout + ran.stderr,
      invocation: invoked(f.dir),
      configLeft: existsSync(join(f.dir, "vitest.mutation.config.ts")),
      samples: existsSync(sample)
        ? readFileSync(sample, "utf8")
            .trim()
            .split("\n")
            .map((s) => JSON.parse(s) as string[])
        : [],
    };
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }

    throw e;
  }
};

describe("mutation command, today's tooling", () => {
  // Plant: import the default config, which also installs the local CLI guard.
  // Resolve the emitted config in a fresh process without starting Stryker's socket server.
  it("T325 resolves shared settings without running the local CLI guard", () => {
    const dir = mkdtempSync(join(tmpdir(), "mut-config-"));

    try {
      const got = run(defaults, { T: "325", BUILD: "abc1234", RELATED: "math.test.ts" });
      expect(got.code, got.text).toBe(0);
      expect(got.invocation).toBeDefined();
      const source = got.invocation!.vitest;
      const wrapper = join(dir, "vitest.mutation.config.mjs");
      writeFileSync(
        wrapper,
        source
          .replace('"./vitest.config.ts"', JSON.stringify(pathToFileURL(join(root, "vitest.config.ts")).href))
          .replace('"vitest/config"', JSON.stringify(import.meta.resolve("vitest/config"))),
      );
      const vite = createRequire(import.meta.resolve("vitest/package.json")).resolve("vite");
      const imported = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
process.argv = ['node', 'vitest'];
const {default: config} = await import(${JSON.stringify(pathToFileURL(wrapper).href)});
const {resolveConfig} = await import(${JSON.stringify(pathToFileURL(vite).href)});
const resolved = await resolveConfig({...config, configFile: false}, 'serve', 'test');
console.log(JSON.stringify(resolved.test));
`,
        ],
        {
          cwd: root,
          encoding: "utf8",
          timeout: 5_000,
          env: {
            ...process.env,
            CI: undefined,
            RELATED: "math.test.ts",
            TYPESAFE_API_KEY: undefined,
          },
        },
      );
      expect(imported.status, imported.stderr).toBe(0);
      expect(JSON.parse(imported.stdout)).toMatchObject({
        include: ["math.test.ts"],
        maxWorkers: 1,
        setupFiles: ["./scripts/vitest.setup.ts"],
        testTimeout: 10_000,
        hookTimeout: 10_000,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Plants: drop SINCE; pass it as the build; pass --since when SINCE is empty (ticket 568).
  it("T568 the sampler starts its diff at SINCE when set, and at the build's parent when not", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-f0-9]{7,12}$/), fc.constantFrom("", "refs/heads/base"), (build, since) => {
        const got = run(defaults, { T: "568", BUILD: build, RELATED: "math.test.ts", SINCE: since });
        expect(got.code, got.text).toBe(0);
        const args = got.samples[0] ?? [];
        expect(args.slice(1, 3)).toEqual(["--build", build]);
        expect(args.includes("--since")).toBe(since !== "");

        if (since !== "") {
          expect(args[args.indexOf("--since") + 1]).toBe(since);
        }
      }),
      { seed: 568, numRuns: 8 },
    );
  });

  // Plants: related true; inherit all tests; accept an empty list or missing build/ranges.
  it("T300 emits related false and restricts Vitest to explicit tests", () => {
    fc.assert(
      fc.property(
        fc.record({
          ticket: fc.integer({ min: 1, max: 9999 }),
          build: fc.stringMatching(/^[a-f0-9]{7,12}$/),
          tests: fc.uniqueArray(fc.stringMatching(/^[a-z]{1,8}\.test\.ts$/), {
            minLength: 1,
            maxLength: 3,
          }),
          line: fc.integer({ min: 1, max: 30 }),
        }),
        ({ ticket, build, tests, line }) => {
          const range = `src/math.ts:${line}:0-${line}:30`;
          const got = run(
            { ...defaults, ranges: [JSON.stringify(range)] },
            { T: `${ticket}`, BUILD: build, RELATED: tests.join(",") },
          );
          expect(got.code, got.text).toBe(0);
          expect(got.invocation, "Stryker must start").toBeDefined();
          const call = got.invocation!;
          expect(call.config.vitest.related).toBe(false);
          expect(call.config.mutate).toEqual([range]);
          expect(call.config.concurrency).toBe(1);
          expect(call.config.ignoreStatic).toBe(true);
          expect(call.config.incremental).toBe(true);
          expect(call.config.incrementalFile).toContain(`mut-${ticket}/incremental.json`);
          expect(call.config.coverageAnalysis).toBe("perTest");
          expect(call.config.timeoutMS).toBe(5000);
          expect(call.args.at(-1)).toBe("--force");
          expect(got.samples).toHaveLength(1);
          expect(got.samples[0]).toEqual([
            ".agents/skills/mutation/scripts/sample.ts",
            "--build",
            build,
            "--seed",
            "119120",
            "--max",
            "150",
            "--report",
            expect.stringContaining(`mut-${ticket}/sample.json`),
          ]);
          // Evaluate the emitted config with only its two imports replaced by local bindings.
          const source = call.vitest.replace(/^import .*;\s*$/gm, "").replace("export default", "return");
          const config = new Function("base", "defineConfig", "process", source)(
            { test: { include: ["all/**/*.test.ts"], exclude: ["keep-me"] } },
            (x: unknown) => x,
            { env: { RELATED: tests.join(",") } },
          ) as {
            test: {
              include: string[];
              exclude: string[];
              maxWorkers: number;
              testTimeout: number;
              hookTimeout: number;
            };
          };
          expect(config.test.include).toEqual(tests);
          expect(config.test.maxWorkers).toBe(1);
          expect(config.test.testTimeout).toBe(10_000);
          expect(config.test.hookTimeout).toBe(10_000);
          expect(config.test.exclude).toEqual(
            expect.arrayContaining([
              "keep-me",
              "**/node_modules/**",
              "**/dist/**",
              "packages/pipeline/src/stages/mutation/stryker*.test.ts",
              "packages/pipeline/src/stages/pipeline/{program,github}.test.ts",
            ]),
          );
          expect(got.configLeft).toBe(false);
        },
      ),
      options,
    );
  });

  it("T300 refuses absent inputs, empty tests and empty or failed selection before Stryker", () => {
    fc.assert(
      fc.property(
        fc.record({ ticket: fc.integer({ min: 1, max: 9999 }), failure: fc.integer({ min: 1, max: 4 }) }),
        ({ ticket, failure }) => {
          const inputs = { T: `${ticket}`, BUILD: "abc1234", RELATED: "math.test.ts" };

          for (const [setup, env] of [
            [defaults, { ...inputs, T: undefined }],
            [defaults, { ...inputs, T: "" }],
            [defaults, { ...inputs, BUILD: undefined }],
            [defaults, { ...inputs, BUILD: "" }],
            [defaults, { ...inputs, RELATED: undefined }],
            [defaults, { ...inputs, RELATED: "" }],
            [defaults, { ...inputs, RELATED: ",," }],
            [{ ...defaults, ranges: [] }, inputs],
            [{ ...defaults, sampleExit: failure }, inputs],
          ] as const) {
            const got = run(setup, env);
            expect(got.code, got.text).not.toBe(0);
            expect(got.invocation).toBeUndefined();
            expect(got.configLeft).toBe(false);
          }
        },
      ),
      { ...options, numRuns: 3 },
    );
  });

  // Plants: leave the temporary config on normal or failed exit; leave a worker on stop.
  it("T300 cleans its config after successful and failed children", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 5 }), (status) => {
        for (const exit of [0, status]) {
          const got = run({ ...defaults, exit }, { T: "300", BUILD: "abc1234", RELATED: "math.test.ts" });
          expect(got.invocation).toBeDefined();
          expect(got.code, got.text).toBe(exit);
          expect(got.configLeft).toBe(false);
        }
      }),
      { ...options, numRuns: 3 },
    );
  });

  // Plant: drop the SIGKILL to the child group after the child exits.
  it("T300 stops a worker the child leaves behind when it exits on its own", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 5 }), async (exit) => {
        const f = fixture({ ...defaults, exit, orphan: true }, { T: "300", BUILD: "abc1234", RELATED: "math.test.ts" });
        let pids: number[] = [];

        try {
          const ran = spawnSync("sh", [f.script], {
            cwd: f.dir,
            env: f.env,
            encoding: "utf8",
            timeout: 10_000,
          });
          expect(ran.status, ran.stdout + ran.stderr).toBe(exit);
          pids = JSON.parse(readFileSync(join(f.dir, "pids.json"), "utf8"));

          for (let i = 0; i < 100 && pids.some(alive); i++) {
            await new Promise((r) => setTimeout(r, 10));
          }

          expect(pids.filter(alive), "the left-behind worker must be stopped").toEqual([]);
        } finally {
          for (const pid of pids) {
            try {
              process.kill(pid, "SIGKILL");
            } catch {}
          }

          rmSync(f.dir, { recursive: true, force: true });
        }
      }),
      { ...options, numRuns: 2 },
    );
  });

  it("T300 signals remove the temporary config and stop the whole child group", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("SIGTERM", "SIGINT"), async (signal) => {
        const f = fixture({ ...defaults, hold: true }, { T: "300", BUILD: "abc1234", RELATED: "math.test.ts" });
        const child = spawn("sh", [f.script], {
          cwd: f.dir,
          env: f.env,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (data) => {
          output += data;
        });
        child.stderr.on("data", (data) => {
          output += data;
        });
        const done = new Promise<number | null>((resolve) => child.once("exit", resolve));
        let pids: number[] = [];

        try {
          for (let i = 0; i < 200 && !existsSync(join(f.dir, "pids.json")) && child.exitCode === null; i++) {
            await new Promise((r) => setTimeout(r, 10));
          }

          expect(existsSync(join(f.dir, "pids.json")), `Stryker child must have started: ${output}`).toBe(true);
          pids = JSON.parse(readFileSync(join(f.dir, "pids.json"), "utf8"));
          child.kill(signal);
          const code = await Promise.race([
            done,
            new Promise<string>((r) => setTimeout(() => r("still running"), 3_000)),
          ]);
          expect(code, output).not.toBe("still running");
          expect(code, output).not.toBe(0);

          for (let i = 0; i < 100 && pids.some(alive); i++) {
            await new Promise((r) => setTimeout(r, 10));
          }

          expect(pids.filter(alive), output).toEqual([]);
          expect(existsSync(join(f.dir, "vitest.mutation.config.ts")), output).toBe(false);
        } finally {
          if (child.pid) {
            try {
              process.kill(-child.pid, "SIGKILL");
            } catch {}
          }

          for (const pid of pids) {
            try {
              process.kill(pid, "SIGKILL");
            } catch {}
          }

          await done;
          rmSync(f.dir, { recursive: true, force: true });
        }
      }),
      { ...options, numRuns: 2 },
    );
  });

  // scenario: real installed Stryker 10.1.1 tests a package-name import in a disposable repo.
  // Plant: supply unrelated.test.ts instead. A dry run or uncovered mutants cannot pass.
  it("T300 package imports reach a discovered test and a real tested mutant", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mut-package-"));
    const started = performance.now();

    try {
      const core = join(root, "packages/pipeline/node_modules/@stryker-mutator/core");
      expect(JSON.parse(readFileSync(join(core, "package.json"), "utf8")).version).toBe("10.1.1");
      mkdirSync(join(dir, "src"));
      mkdirSync(join(dir, "packages/pipeline"), { recursive: true });
      mkdirSync(join(dir, ".agents/skills/mutation/scripts"), { recursive: true });
      symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
      symlinkSync(join(root, "packages/pipeline/node_modules"), join(dir, "packages/pipeline/node_modules"));
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "t300-package", type: "module", exports: { ".": "./src/math.ts" } }),
      );
      writeFileSync(join(dir, "src/math.ts"), "export function add(a: number, b: number) { return a + b; }\n");
      writeFileSync(
        join(dir, "math.test.ts"),
        'import {expect, it} from "vitest";\nimport {add} from "t300-package";\nit("adds", () => expect(add(2, 3)).toBe(5));\n',
      );
      writeFileSync(
        join(dir, "unrelated.test.ts"),
        'import {expect, it} from "vitest";\nit("unrelated", () => expect(1).toBe(1));\n',
      );
      writeFileSync(
        join(dir, "vitest.config.ts"),
        'import {defineConfig} from "vitest/config";\nexport const testConfig = defineConfig({test: {include: ["*.test.ts"], maxWorkers: 1}});\nexport default testConfig;\n',
      );
      // Check run.sh's real imports before Stryker tries to bind its logging port.
      const emitted = readFileSync(script, "utf8").split("<<'TS'\n")[1]?.split("\nTS\n")[0];
      expect(emitted, "run.sh must emit the shared-config import").toBeDefined();
      const wrapper = join(dir, "vitest.mutation.config.ts");
      writeFileSync(wrapper, emitted!);
      const imported = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const {default: config} = await import(${JSON.stringify(pathToFileURL(wrapper).href)}); console.log(JSON.stringify(config.test.include));`,
        ],
        {
          cwd: dir,
          encoding: "utf8",
          env: { ...process.env, RELATED: "math.test.ts", TYPESAFE_API_KEY: undefined },
        },
      );
      expect(imported.status, imported.stderr).toBe(0);
      expect(JSON.parse(imported.stdout)).toEqual(["math.test.ts"]);
      rmSync(wrapper);
      // Selection has separate real laws. This scenario keeps exactly one cheap source range.
      writeFileSync(
        join(dir, ".agents/skills/mutation/scripts/sample.ts"),
        'console.log(JSON.stringify("src/math.ts:1:0-1:60"));\n',
      );
      const command = join(dir, ".agents/skills/mutation/scripts/run.sh");

      if (existsSync(script)) {
        writeFileSync(command, readFileSync(script));
      }

      const git = (...args: string[]) => {
        const ran = spawnSync("/usr/bin/git", ["-C", dir, ...args], {
          encoding: "utf8",
          timeout: 5_000,
        });
        expect(ran.status, ran.stderr).toBe(0);
        return ran.stdout.trim();
      };
      git("init", "-q");
      git("config", "user.name", "Fixture");
      git("config", "user.email", "fixture@example.test");
      git("add", "package.json", "src", "math.test.ts", "unrelated.test.ts", "vitest.config.ts");
      git("commit", "-qm", "fixture");
      // Record only this fixture's Node children, so a timeout never leaves Stryker behind.
      const pidFile = join(dir, "children.jsonl"),
        hook = join(dir, "record-child.mjs");
      writeFileSync(
        hook,
        'import {appendFileSync} from "node:fs";\nappendFileSync(process.env.T300_PID_FILE, JSON.stringify(process.pid) + "\\n");\n',
      );
      const child = spawn("sh", [command], {
        cwd: dir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          T: "300",
          BUILD: git("rev-parse", "HEAD"),
          RELATED: "math.test.ts",
          TMPDIR: dir,
          TYPESAFE_API_KEY: undefined,
          FABRIKA_HOME: join(dir, "fh"),
          T300_PID_FILE: pidFile,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(hook).href}`,
        },
      });
      let output = "",
        cap: ReturnType<typeof setTimeout> | undefined;
      child.stdout.on("data", (data) => {
        output += data;
      });
      child.stderr.on("data", (data) => {
        output += data;
      });
      const done = new Promise<number | null>((resolve, reject) => {
        child.once("exit", resolve);
        child.once("error", reject);
      });
      let status: number | null | "deadline";
      const children = () =>
        existsSync(pidFile)
          ? readFileSync(pidFile, "utf8")
              .trim()
              .split("\n")
              .filter(Boolean)
              .map((line) => JSON.parse(line) as number)
          : [];

      try {
        status = await Promise.race([
          done,
          new Promise<"deadline">((resolve) => {
            cap = setTimeout(() => resolve("deadline"), 45_000);
          }),
        ]);
      } finally {
        clearTimeout(cap);
        child.kill("SIGTERM");

        for (const pid of children().reverse()) {
          try {
            process.kill(pid, "SIGTERM");
          } catch {}
        }

        await new Promise((resolve) => setTimeout(resolve, 100));

        for (const pid of children().reverse()) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }

        child.kill("SIGKILL");
        await done;

        for (let i = 0; i < 100 && children().some(alive); i++) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        expect(children().filter(alive), "fixture left Node children behind").toEqual([]);
      }

      const logPath = join(dir, "mut-300/log.txt");
      const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : output;
      expect(status, log).toBe(0);
      const report = JSON.parse(readFileSync(join(dir, "mut-300/report.json"), "utf8"));
      const mutants = Object.values(report.files).flatMap(
        (f) => (f as { mutants: { status: string; killedBy?: string[]; coveredBy?: string[] }[] }).mutants,
      );
      expect(
        mutants.some((m) => ["Killed", "Survived", "Timeout"].includes(m.status)),
        log,
      ).toBe(true);
      expect(
        mutants.some((m) => m.status === "Killed" && m.killedBy?.length),
        log,
      ).toBe(true);
      expect(log).toMatch(/1 test|1 tests/);
    } finally {
      console.info(`T300 package-import scenario: ${((performance.now() - started) / 1000).toFixed(2)}s`);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
