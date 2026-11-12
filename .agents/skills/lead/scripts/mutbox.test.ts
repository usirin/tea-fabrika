import "../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/limit.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/sample.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/scope.ts?raw";
// mutbox.ts reads the plan's owners through plancheck.sh, so its laws run when that or what it reads changes.
import "../../plan/scripts/plancheck.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./sizecap.ts?raw";
import "../../step-commit/scripts/exam.py?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./agents.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./codexexec.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./boxnode.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
import "./box.sh?raw";
import "./clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./runid.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pgrep.ts?raw";
import "./env.sh?raw";
import "./fieldrow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./boxfiles.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gc.ts?raw";
import "./keepruns.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./lane.ts?raw";
import "./leakgrep.sh?raw";
import "./redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gcloop.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./flow/Beat.ts?raw";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Clock, Effect, Exit, Fiber, Layer, Schedule, Stream } from "effect";
import { TestClock } from "effect/testing";
import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import packageJson from "../../../../package.json" with { type: "json" };
import entry from "./mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import dockerfile from "./mutbox.Dockerfile?raw";
import {
  baseNode,
  bounded,
  buildOwns,
  CallTimeout,
  DOCKER_SECONDS,
  droppedFromArmA,
  exitCode,
  imageTag,
  judge,
  KILL_GRACE_SECONDS,
  LABEL,
  LIMITS,
  mountable,
  narrowed,
  narrowingUnknown,
  needsHost,
  OWNER,
  parseRelated,
  pnpmVersion,
  reachLine,
  runArgs,
  secondsFor,
  tally,
  timeoutLine,
} from "./mutbox.ts";

// Today's lead tooling. The pure parts are properties. The flow runs the real script against a
// stand-in `docker` on PATH, so no test here needs Docker; the one real run is the labeled
// scenario at the end, which only runs when MUTBOX_DOCKER=1 says a Docker box is free.
const options = { seed: 483, numRuns: 100 };
const script = join(import.meta.dirname, "mutbox.ts");
const made: string[] = [];

afterAll(() => {
  for (const dir of made) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const segment = fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/);

const testPath = fc
  .tuple(fc.array(segment, { minLength: 0, maxLength: 3 }), segment, fc.constantFrom("ts", "tsx"))
  .map(([dirs, name, ext]) => [...dirs, `${name}.test.${ext}`].join("/"));

const row = fc.record({
  file: fc.constantFrom("src/a.ts", "src/b.ts"),
  line: fc.integer({ min: 1, max: 9 }),
  column: fc.integer({ min: 0, max: 9 }),
  endLine: fc.integer({ min: 1, max: 9 }),
  endColumn: fc.integer({ min: 0, max: 9 }),
  mutator: fc.constantFrom("BooleanLiteral", "EqualityOperator"),
  replacement: fc.constantFrom("true", "false", ""),
  status: fc.constantFrom("Killed", "Survived", "Timeout", "NoCoverage", "CompileError"),
});

describe("mutbox, the pure parts", () => {
  // Plants: accept a path that climbs out, an absolute one, an option, or a file that is no test.
  it("related paths are plain test files inside the repo, or the whole list is refused", () => {
    fc.assert(
      fc.property(fc.array(testPath, { minLength: 1, maxLength: 5 }), (paths) => {
        expect(parseRelated(paths.join(","))).toEqual(paths);
        expect(parseRelated(` ${paths.join(" , ")} ,`)).toEqual(paths);

        for (const bad of ["../x.test.ts", "/etc/x.test.ts", "-x.test.ts", "src/a.ts", "a/../b.test.ts"]) {
          expect(parseRelated([...paths, bad].join(","))).toBeNull();
        }
      }),
      options,
    );
    expect(parseRelated("")).toBeNull();
    expect(parseRelated(",,")).toBeNull();
  });

  // Plants: drop `--network none`, add a volume, mount the output read-write over the input.
  it("the docker run line fences every run the same way, whatever it is asked", () => {
    fc.assert(
      fc.property(
        fc.record({
          name: segment,
          image: segment,
          input: fc.string(),
          output: fc.string(),
          ticket: fc.stringMatching(/^[0-9]{1,5}$/),
          build: fc.stringMatching(/^[0-9a-f]{40}$/),
          related: fc.array(testPath, { minLength: 1, maxLength: 3 }),
          lock: fc.string(),
        }),
        (ask) => {
          const args = runArgs(ask);
          const pair = (flag: string) => args.flatMap((a, i) => (a === flag ? [args[i + 1] ?? ""] : []));
          expect(pair("--network")).toEqual(["none"]);
          expect(pair("--cap-drop")).toEqual(["ALL"]);
          expect(pair("--security-opt")).toEqual(["no-new-privileges"]);
          expect(pair("--user")).toEqual(["node"]);
          expect(pair("--cpus")).toEqual([String(LIMITS.cpus)]);
          expect(pair("--memory")).toEqual([LIMITS.memory]);
          expect(pair("--memory-swap")).toEqual([LIMITS.memory]);
          expect(pair("--pids-limit")).toEqual([String(LIMITS.pids)]);
          expect(pair("--label")).toEqual([LABEL, `${OWNER}=${ask.lock}`]);
          expect(args).toContain("--rm");
          expect(pair("--mount")).toEqual([
            `type=bind,src=${ask.input},dst=/in,readonly`,
            `type=bind,src=${ask.output},dst=/out`,
          ]);
          // Nothing else crosses: no volume, no host network, no extra right, no device.
          const flags = args.slice(0, args.indexOf(ask.image)).filter((a) => a.startsWith("-"));
          expect(new Set(flags)).toEqual(
            new Set([
              "--rm",
              "--init",
              "--platform",
              "--network",
              "--cap-drop",
              "--security-opt",
              "--user",
              "--cpus",
              "--memory",
              "--memory-swap",
              "--pids-limit",
              "--name",
              "--label",
              "--mount",
              "--env",
            ]),
          );
          expect(pair("--env").map((e) => e.split("=")[0])).toEqual(["T", "BUILD", "RELATED"]);
        },
      ),
      options,
    );
  });

  // Plant: let a comma through, so `--mount` reads the rest of the path as its own options.
  it("a path docker --mount cannot take is refused, and a path with spaces is fine", () => {
    fc.assert(
      fc.property(fc.array(segment, { minLength: 1, maxLength: 4 }), fc.constantFrom(",", '"', "\n"), (parts, bad) => {
        const path = `/${parts.join("/ with spaces/")}`;
        expect(mountable(path)).toBe(true);
        expect(mountable(`${path}${bad}x`)).toBe(false);
        expect(mountable(path.slice(1))).toBe(false);
      }),
      options,
    );
  });

  // Plants: answer null for every source, so a window test is counted as run; match the text
  // `from "electron"` anywhere, so a plant string counts (the old regex, ticket 655); count a
  // type-only import; miss `require` or `import()`.
  it("a test that loads Electron or a browser driver needs the host; a plant string or a type import does not", () => {
    const loader = fc.constantFrom(
      (m: string, q: string) => `import {x} from ${q}${m}${q};\n`,
      (m: string, q: string) => `import ${q}${m}${q};\n`,
      (m: string, q: string) => `const x = await import(${q}${m}${q});\n`,
      (m: string, q: string) => `const x = require(${q}${m}${q});\n`,
      (m: string, q: string) => `export * from ${q}${m}${q};\n`,
    );
    const inert = fc.constantFrom(
      (m: string, q: string) => `import type {X} from ${q}${m}${q};\n`,
      (m: string, q: string) => `const plant = \`import {app} from ${q}${m}${q}; app.quit();\`;\n`,
      (m: string) => `const plant = 'import {app} from "${m}"';\n`,
      (m: string, q: string) => `// import {app} from ${q}${m}${q};\n`,
    );
    fc.assert(
      fc.property(
        fc.constantFrom("electron", "playwright", "@playwright/test"),
        fc.constantFrom('"', "'"),
        fc.constantFrom("vitest", "./electron.ts", "effect", "node:net"),
        loader,
        inert,
        (name, quote, other, load, quiet) => {
          expect(needsHost("a.test.ts", load(name, quote))).toMatch(/no display/);
          expect(needsHost("a.test.ts", load(other, quote))).toBeNull();
          expect(needsHost("a.test.ts", `import {it} from "vitest";\n${quiet(name, quote)}`)).toBeNull();
        },
      ),
      {
        ...options,
        // pinned: lane t389's oxlint-plugins/e2e-windows.test.ts, left out though it opens no window.
        examples: [
          [
            "electron",
            '"',
            "vitest",
            (m, q) => `import {x} from ${q}${m}${q};\n`,
            (m) => `const p = \`import {BrowserWindow as W} from "${m}";\`;\n`,
          ],
        ],
      },
    );
  });

  // format: the real Dockerfile's base is pinned by digest, and is the Node this repo runs.
  it("format: the image's base is pinned by digest at the repo's own Node version", () => {
    expect(baseNode(dockerfile)).toBe(packageJson.engines.node);
    expect(baseNode("FROM node:26.13.0-bookworm\n")).toBeNull();
    expect(baseNode(`FROM node:26-bookworm@sha256:${"a".repeat(64)}`)).toBeNull();
    expect(pnpmVersion(packageJson.packageManager)).not.toBeNull();
    expect(pnpmVersion("pnpm@^12.0.0")).toBeNull();
    expect(pnpmVersion("pnpm@latest")).toBeNull();
    expect(imageTag("0123456789abcdef0123")).toBe("fabrika-mutbox:0123456789abcdef");
    // The entry never asks for a network or a key, and the Dockerfile copies only what it names.
    expect(dockerfile.match(/^COPY .*$/gm)).toEqual([
      "COPY mutbox-entry.sh /usr/local/bin/mutbox-entry",
      "COPY --chown=node:node pnpm-lock.yaml pnpm-workspace.yaml ./",
      "COPY --chown=node:node patches ./patches",
    ]);
    expect(entry).toContain("pnpm install --offline --frozen-lockfile");
    expect(secondsFor(true)).toBeGreaterThan(secondsFor(false));
  });

  // Plants: count NoCoverage as tested; report a mutant arm a also lets live as narrowing.
  it("an arm's counts add up, and narrowing is exactly what arm a kills and arm b lets live", () => {
    fc.assert(
      fc.property(
        fc.array(row, { maxLength: 30 }),
        fc.array(row, { maxLength: 30 }),
        fc.nat({ max: 40 }),
        (a, b, selected) => {
          const arm = tally(0, "report", b, selected);
          expect(Object.values(arm.counts).reduce((x, y) => x + y, 0)).toBe(b.length);
          expect(arm.tested).toBe(b.filter((r) => ["Killed", "Survived", "Timeout"].includes(r.status)).length);
          expect(arm.survivors).toEqual(b.filter((r) => r.status === "Survived"));
          expect(arm.unreached).toBe(Math.max(0, selected - b.length));
          const same = (x: object, y: object) =>
            JSON.stringify({ ...x, status: "" }) === JSON.stringify({ ...y, status: "" });
          const list = narrowed(a, b);

          for (const r of b) {
            const lives = r.status === "Survived" || r.status === "NoCoverage";
            const killedInA = a.some((x) => same(x, r) && (x.status === "Killed" || x.status === "Timeout"));
            expect(list.includes(r)).toBe(lives && killedInA);
          }
        },
      ),
      options,
    );
  });

  // Plants: call a run with no tested mutant done; call a missing report done.
  it("only a run with a real test result is done, and every other end is skip or stuck", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(0, 1, 70, 71, 124, 137),
        fc.option(fc.array(fc.constant("src/a.ts:1:0-1:5"), { maxLength: 2 }), { nil: null }),
        fc.option(fc.array(row, { maxLength: 6 }), { nil: null }),
        (exit, ranges, rows) => {
          const files = [{ file: "src/a.ts", total: 2, selected: 2 }];
          const sample = ranges === null ? null : { seed: 119120, ranges, total: 2, selected: 2, left: 0, files };
          const b = rows === null ? null : tally(exit, "report", rows, 2);
          const got = judge({ exit, sample, b, failed: ["a.test.ts: fails"], base: null, owners: null });
          expect(exitCode(got.outcome)).toBe({ done: 0, skip: 40, stuck: 30 }[got.outcome]);

          if (got.outcome === "done") {
            expect(b?.tested).toBeGreaterThan(0);
            expect(sample?.ranges.length).toBeGreaterThan(0);
            expect([0, 124]).toContain(exit);
          }

          if (got.outcome === "skip") {
            expect(sample?.ranges).toEqual([]);
          }

          if ([70, 71, 137].includes(exit)) {
            expect(got.outcome).toBe("stuck");
          }

          if (got.outcome !== "done" || got.reason !== "") {
            expect(got.reason).not.toBe("");
            expect(got.detail).not.toBe("");
          }
        },
      ),
      options,
    );
  });

  // Lane t389, 2026-11-10: five rounds read done with no arm a, and with the hook, the launcher
  // and the rule unreached. A gap the run knows about is a done that names it, with narrowing
  // unknown; only an unexpected arm a or an unreached build file is stuck. Plants, each one: make
  // no_reach or no_arm_a stuck; drop a gap from the reason; read none_pass as base_has_none; drop
  // the arm_a_failed or no_build_reach check; count a build file with no mutant on its changed
  // lines as missed; read folder owners by the shortest row; call narrowing known with a gap.
  it("property: a known gap is a done that names it, and an unexpected arm a or an unreached build file is stuck", () => {
    const reach = fc.array(
      fc.record({
        file: fc.constantFrom("src/a.ts", "src/b.cjs", "lib/c.ts", "lib/x/d.ts"),
        total: fc.nat({ max: 3 }),
        selected: fc.nat({ max: 3 }),
      }),
      { maxLength: 4 },
    );
    const owner = fc.constantFrom("build", "tests", "lead");
    const owners = fc.option(
      fc.record({ "src/a.ts": owner, "src/b.cjs": owner, "lib/": owner, "lib/x/": owner }, { requiredKeys: [] }),
      { nil: null },
    );
    const arm = fc.option(
      fc.constantFrom(0, 1, 124).map((exit) => tally(exit, "report", [], 2)),
      { nil: null },
    );
    const base = fc.option(
      fc
        .record({ a: arm, has: fc.nat({ max: 2 }), drop: fc.nat({ max: 2 }) })
        .map(({ a, has, drop }) => ({ a, has, kept: Math.max(0, has - drop) })),
      { nil: null },
    );
    fc.assert(
      fc.property(fc.option(reach, { nil: undefined }), base, owners, (files, base, owners) => {
        const sample = { seed: 119120, ranges: ["src/a.ts:1:0-1:5"], total: 2, selected: 2, left: 0, files };
        const b = tally(0, "report", [{ ...killedRow }], 2);
        const got = judge({ exit: 0, sample, b, failed: [], base, owners });
        const owns = (file: string) => {
          const map: Record<string, string> = owners ?? {};
          const key =
            file in map
              ? file
              : Object.keys(map)
                  .filter((k) => k.endsWith("/") && file.startsWith(k))
                  .sort((x, y) => y.length - x.length)[0];
          return key !== undefined && map[key] === "build";
        };
        const owned = (files ?? []).filter((f) => f.total > 0 && owns(f.file));
        const stuck =
          base !== null && base.kept > 0 && (base.a === null || ![0, 124].includes(base.a.exit))
            ? "arm_a_failed"
            : owned.length > 0 && owned.every((f) => f.selected === 0)
              ? "no_build_reach"
              : null;
        const gaps = [
          ...(files === undefined ? ["no_reach:old_sampler"] : []),
          ...(base !== null && base.kept === 0
            ? [base.has === 0 ? "no_arm_a:base_has_none" : "no_arm_a:none_pass"]
            : []),
        ];

        const unknown = stuck === null && gaps.length > 0;
        expect({
          outcome: got.outcome,
          reason: got.reason,
          unknown: narrowingUnknown(got.reason),
          said: got.detail.includes("narrowing is unknown"),
          named: stuck !== "no_build_reach" || got.detail.includes(owned[0]?.file ?? ""),
          empty: got.detail === "",
        }).toEqual({
          outcome: stuck === null ? "done" : "stuck",
          reason: stuck ?? gaps.join(","),
          unknown,
          said: unknown,
          named: true,
          empty: stuck === null && gaps.length === 0,
        });
      }),
      {
        ...options,
        examples: [
          // pinned: lane t389's build owned electron-hook.d.cts, a file no mutant can ever reach.
          [[{ file: "src/b.cjs", total: 0, selected: 0 }], null, { "src/b.cjs": "build" }],
          // pinned: lane t389's base had none of its related tests.
          [[{ file: "src/a.ts", total: 1, selected: 1 }], { a: null, has: 0, kept: 0 }, null],
          // pinned: t502b's base tests failed on the build, so none passed.
          [[{ file: "src/a.ts", total: 1, selected: 1 }], { a: null, has: 2, kept: 0 }, null],
        ],
      },
    );
  });

  // Plants: keep a failing base test; name a missing file as failing; drop the failing test's name.
  it("property: arm a leaves out exactly the related tests not kept, each with why", () => {
    const paths = ["src/a.test.ts", "src/b.test.ts", "src/c.test.ts", "src/d.test.ts"];
    fc.assert(
      fc.property(
        fc.subarray(paths),
        fc.func(fc.boolean()),
        fc.string({ minLength: 1, maxLength: 8 }),
        (onBase, passes, name) => {
          const kept = onBase.filter((p) => passes(p));
          const baseline = {
            testResults: onBase.map((p) => ({
              name: `/repo/${p}`,
              assertionResults: [{ fullName: `${name} ${p}`, status: kept.includes(p) ? "passed" : "failed" }],
            })),
          };
          const dropped = droppedFromArmA(paths, onBase, kept, baseline);
          expect(dropped.map((d) => d.path)).toEqual(paths.filter((p) => !kept.includes(p)));

          for (const d of dropped) {
            expect(d.reason).toBe(
              onBase.includes(d.path)
                ? `its base version fails on the build: ${name} ${d.path}`
                : "the base has no such file",
            );
          }
        },
      ),
      options,
    );
  });

  // format: the line the report gains, read by the lead and the mutation agent.
  it("format: the reach line counts the changed files with a mutant and names each without one", () => {
    expect(
      reachLine([
        { file: "a.ts", total: 4, selected: 2 },
        { file: "b.cjs", total: 3, selected: 0 },
        { file: "index.ts", total: 0, selected: 0 },
      ]),
    ).toBe(
      "the sample reached 1 of 3 changed files; zero mutants in b.cjs (3 mutants on its changed lines, none selected), index.ts (no mutant on its changed lines)",
    );
    expect(reachLine([{ file: "a.ts", total: 1, selected: 1 }])).toBe("the sample reached 1 of 1 changed files");
    expect(buildOwns({ "lib/": "tests", "lib/x/": "build" }, "lib/x/d.ts")).toBe(true);
    expect(buildOwns({ "lib/": "build", "lib/x/d.ts": "tests" }, "lib/x/d.ts")).toBe(false);
  });
});

const killedRow = {
  file: "src/a.ts",
  line: 1,
  column: 0,
  endLine: 1,
  endColumn: 4,
  mutator: "BooleanLiteral",
  replacement: "false",
  status: "Killed",
};

// The stand-in docker: it writes every call to calls.log and plays the container from container.sh.
const DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE/calls.log"
case "$1 $2" in
"version "*) [ -z "\${DOWN:-}" ] || exit 1; echo "\${SERVER:-linux/arm64}" ;;
"ps "*) cat "$FAKE/leftover" 2>/dev/null || : ;;
"rm "*|"kill "*) : ;;
"image inspect") [ -e "$FAKE/image" ] || exit 1; echo id ;;
"image prune") echo "untagged: fabrika-mutbox:old" ;;
"build "*) for a; do last=$a; done; (cd "$last" && find . -type f | sort) > "$FAKE/context.txt"; touch "$FAKE/image" ;;
"run "*)
	for a; do case $a in type=bind,src=*,dst=/out) out=\${a#type=bind,src=}; out=\${out%,dst=/out} ;; esac; done
	for a; do case $a in type=bind,src=*,dst=/in,readonly) in=\${a#type=bind,src=}; in=\${in%,dst=/in,readonly} ;; esac; done
	export OUT="$out" IN="$in"
	exec sh "$FAKE/container.sh" ;;
esac
`;

const mutant = (status: string, line: number) => ({
  id: String(line),
  mutatorName: "BooleanLiteral",
  replacement: "false",
  status,
  location: { start: { line, column: 0 }, end: { line, column: 4 } },
});

const DONE = `
mkdir -p "$OUT/b"
echo 0 > "$OUT/b/exit"
echo '${JSON.stringify({
  seed: 119120,
  ranges: ["src/a.ts:1:0-1:4"],
  total: 2,
  selected: 2,
  left: 0,
  files: [
    { file: "src/a.ts", total: 2, selected: 2 },
    { file: "src/b.cjs", total: 3, selected: 0 },
  ],
})}' > "$OUT/b/sample.json"
echo '${JSON.stringify({ files: { "src/a.ts": { mutants: [mutant("Killed", 1), mutant("Survived", 2)] } } })}' > "$OUT/b/report.json"
echo '${JSON.stringify({
  testResults: [
    {
      name: "/repo/src/a.test.ts",
      assertionResults: [
        { fullName: "adds", status: "passed" },
        { fullName: "on a Mac only", status: "skipped" },
      ],
    },
  ],
})}' > "$OUT/baseline.json"
echo 1000 > "$OUT/memory.peak"
echo 'usage_usec 2500000' > "$OUT/cpu.stat"
git --git-dir "$IN/repo.git" log --format=%s refs/heads/build > "$FAKE/commits.txt"
`;

type Setup = {
  run?: string;
  image?: boolean;
  env?: Record<string, string>;
  docker?: boolean;
  lockPid?: number;
  leftover?: string;
  related?: string;
  node?: string;
  seconds?: number;
  lockfile?: string;
  outName?: string;
  /** Flags after the fixed ones, such as `--plan` or `--base`, from the test folder and the build. */
  args?: (at: { dir: string; build: string }) => string[];
  /** Files written into the test folder, beside the checkout, before the run. */
  files?: Record<string, string>;
};

/** A real git checkout with two commits, a stand-in docker, and one run of the real script. */
const run = (setup: Setup = {}) => {
  // A folder with a space in its name: every path the script handles has one.
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), "mutbox-"))), "with space");
  made.push(join(dir, ".."));
  const repo = join(dir, "repo"),
    fake = join(dir, "fake"),
    bin = join(dir, "bin"),
    out = join(dir, setup.outName ?? "out"),
    lock = join(dir, "docker.lock");

  for (const d of [join(repo, "src"), join(repo, "patches"), fake, bin]) {
    mkdirSync(d, { recursive: true });
  }

  const git = (...args: string[]) => {
    const ran = spawnSync(
      "/usr/bin/git",
      ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", ...args],
      { encoding: "utf8" },
    );
    expect(ran.status, ran.stderr).toBe(0);
    return ran.stdout.trim();
  };
  git("init", "-q");
  writeFileSync(
    join(repo, "package.json"),
    JSON.stringify({
      packageManager: "pnpm@12.16.1",
      engines: { node: setup.node ?? baseNode(dockerfile) },
    }),
  );
  writeFileSync(join(repo, "pnpm-lock.yaml"), setup.lockfile ?? "lockfileVersion: '9.0'\n");
  writeFileSync(join(repo, "pnpm-workspace.yaml"), "packages: []\n");
  writeFileSync(join(repo, "patches/x@1.0.0.patch"), "diff\n");
  writeFileSync(join(repo, "src/a.ts"), "export const a = true;\n");
  writeFileSync(join(repo, "src/a.test.ts"), 'import {it} from "vitest";\n');
  writeFileSync(join(repo, "src/win.test.ts"), 'import {_electron} from "playwright";\n');
  git("add", ".");
  git("commit", "-qm", "parent");
  writeFileSync(join(repo, "src/a.ts"), "export const a = false;\n");
  writeFileSync(join(repo, "secret.txt"), "never committed\n");
  git("commit", "-qam", "build");
  const build = git("rev-parse", "HEAD");
  // The build commit is not a branch tip, as on a lane whose later steps moved on.
  writeFileSync(join(repo, "src/a.ts"), "export const a = null;\n");
  git("commit", "-qam", "later");

  if (setup.docker !== false) {
    writeFileSync(join(bin, "docker"), DOCKER, { mode: 0o755 });
  }

  writeFileSync(join(fake, "container.sh"), setup.run ?? DONE);

  if (setup.image !== false) {
    writeFileSync(join(fake, "image"), "");
  }

  if (setup.lockPid !== undefined) {
    writeFileSync(lock, String(setup.lockPid));
  }

  if (setup.leftover !== undefined) {
    writeFileSync(join(fake, "leftover"), `${setup.leftover}\n`);
  }

  for (const [path, text] of Object.entries(setup.files ?? {})) {
    writeFileSync(join(dir, path), text);
  }

  const started = Date.now();
  const ran = spawnSync(
    process.execPath,
    [
      script,
      "run",
      "--checkout",
      repo,
      "--ticket",
      "483",
      "--build",
      build,
      "--related",
      setup.related ?? "src/a.test.ts",
      "--out",
      out,
      "--lock",
      lock,
      ...(setup.seconds === undefined ? [] : ["--seconds", String(setup.seconds)]),
      ...(setup.args?.({ dir, build }) ?? []),
    ],
    {
      encoding: "utf8",
      timeout: 30_000,
      env: {
        // With no stand-in, no docker at all: a CI machine has a real one in /usr/bin.
        PATH: setup.docker === false ? bin : `${bin}:/usr/bin:/bin`,
        HOME: dir,
        FAKE: fake,
        ...setup.env,
      },
    },
  );
  const calls = existsSync(join(fake, "calls.log"))
    ? readFileSync(join(fake, "calls.log"), "utf8").trim().split("\n")
    : [];
  const line = ran.stdout.trim().split("\n").at(-1) ?? "";
  return {
    code: ran.status,
    text: ran.stdout + ran.stderr,
    summary: line.startsWith("{") ? JSON.parse(line) : null,
    saved: existsSync(join(out, "mutbox.json")) ? readFileSync(join(out, "mutbox.json"), "utf8").trim() : null,
    line,
    calls,
    ranContainer: calls.some((c) => c.startsWith("run ")),
    context: existsSync(join(fake, "context.txt"))
      ? readFileSync(join(fake, "context.txt"), "utf8").trim().split("\n")
      : null,
    commits: existsSync(join(fake, "commits.txt"))
      ? readFileSync(join(fake, "commits.txt"), "utf8").trim().split("\n")
      : null,
    lockLeft: existsSync(lock),
    inputLeft: existsSync(join(out, "in")),
    ms: Date.now() - started,
    fake,
    dir,
    build,
  };
};

describe("mutbox, the run against a stand-in docker", () => {
  // scenario: the happy path once, end to end, since every later case is one change to it.
  // Plant: read the report without mounting the output, or leave the lock or the input behind.
  it("scenario: a path with spaces runs, reports, and leaves no lock, input or container", () => {
    const got = run();
    expect(got.code, got.text).toBe(0);
    expect(got.summary).toMatchObject({
      outcome: "done",
      ticket: "483",
      build: got.build,
      network: "none",
      related: ["src/a.test.ts"],
      excluded: [],
      skipped: ["src/a.test.ts: on a Mac only (skipped)"],
      usage: { memoryPeakBytes: 1000, cpuSeconds: 2.5 },
      reach:
        "the sample reached 1 of 2 changed files; zero mutants in src/b.cjs (3 mutants on its changed lines, none selected)",
      b: { exit: 0, from: "report", tested: 2, counts: { Killed: 1, Survived: 1 } },
      a: null,
      narrowing: null,
    });
    expect(got.summary.b.survivors).toEqual([
      {
        file: "src/a.ts",
        line: 2,
        column: 0,
        endLine: 2,
        endColumn: 4,
        mutator: "BooleanLiteral",
        replacement: "false",
        status: "Survived",
      },
    ]);
    expect(got.saved).toBe(got.line);
    // The copy that went in holds the build commit and its parent, and nothing later.
    expect(got.commits).toEqual(["build", "parent"]);
    expect(got.lockLeft).toBe(false);
    expect(got.inputLeft).toBe(false);
    const runCall = got.calls.find((c) => c.startsWith("run "))!;
    expect(runCall).toContain("--network none");
    expect(runCall).toContain(`src=${join(got.dir, "out", "box")},dst=/out`);
    expect(got.calls.at(-1)).toMatch(/^rm -f fabrika-mutbox-483-\d+$/);
    expect(got.calls.some((c) => c.startsWith("build "))).toBe(false);
  });

  // Plant: run the sample on the host when docker is missing.
  it("with Docker missing, stopped or on another platform the step is stuck and nothing runs", () => {
    for (const [setup, reason] of [
      [{ docker: false }, "docker_down"],
      [{ env: { DOWN: "1" } }, "docker_down"],
      [{ env: { SERVER: "linux/amd64" } }, "not_arm64"],
    ] as const) {
      const got = run(setup);
      expect(got.code, got.text).toBe(30);
      expect(got.summary).toMatchObject({ outcome: "stuck", reason });
      expect(got.ranContainer).toBe(false);
      expect(got.saved).toBe(got.line);
      expect(got.lockLeft).toBe(false);
    }
  });

  // Plants: reuse any image; copy the whole checkout into the build; keep the tag when the lockfile changes.
  it("a missing image is built from the commit's own lockfile, and a changed lockfile is a new image", () => {
    const first = run({ image: false });
    expect(first.code, first.text).toBe(0);
    const built = first.calls.find((c) => c.startsWith("build "))!;
    expect(built).toContain("--build-arg PNPM=12.16.1");
    expect(built).toContain(`--label ${LABEL}`);
    // The build's folder holds the lockfile, workspace file, patches and our two files only.
    expect(first.context).toEqual([
      "./Dockerfile",
      "./mutbox-entry.sh",
      "./patches/x@1.0.0.patch",
      "./pnpm-lock.yaml",
      "./pnpm-workspace.yaml",
    ]);
    const tag = (calls: string[]) =>
      /--tag (fabrika-mutbox:[0-9a-f]{16})/.exec(calls.find((c) => c.startsWith("build "))!)?.[1];
    const again = run({ image: false });
    const other = run({ image: false, lockfile: "lockfileVersion: '9.0'\n# changed\n" });
    expect(tag(again.calls)).toBe(tag(first.calls));
    expect(tag(other.calls)).not.toBe(tag(first.calls));
    expect(first.calls.find((c) => c.startsWith("run "))).toContain(tag(first.calls));
  });

  // Plant: build an image for a Node the commit does not run.
  it("a commit that runs another Node than the image's base is stuck before any build", () => {
    const got = run({ node: "20.0.0", image: false });
    expect(got.code, got.text).toBe(30);
    expect(got.summary).toMatchObject({ outcome: "stuck", reason: "node_mismatch" });
    expect(got.calls.some((c) => c.startsWith("build ") || c.startsWith("run "))).toBe(false);
  });

  // Plant: wait for the container for ever, or leave it running after the limit.
  it("at the time limit the container is killed and removed, and the step is stuck", () => {
    const got = run({ run: "exec sleep 20\n", seconds: 1 });
    expect(got.code, got.text).toBe(30);
    expect(got.summary).toMatchObject({ outcome: "stuck", reason: "time_limit" });
    expect(got.ms).toBeLessThan(15_000);
    const name = /--name (fabrika-mutbox-483-\d+)/.exec(got.calls.find((c) => c.startsWith("run "))!)![1];
    expect(got.calls).toContain(`kill ${name}`);
    expect(got.calls.at(-1)).toBe(`rm -f ${name}`);
    expect(got.lockLeft).toBe(false);
    expect(got.inputLeft).toBe(false);
  });

  // Plant: read a half-written report after a kill and call it done.
  it("a container killed mid-run is stuck, whatever it left, and is removed", () => {
    const got = run({ run: `${DONE}\nexit 137\n` });
    expect(got.code, got.text).toBe(30);
    expect(got.summary).toMatchObject({ outcome: "stuck", reason: "killed" });
    expect(got.calls.at(-1)).toMatch(/^rm -f fabrika-mutbox-483-/);
  });

  // Plants: start a second container beside a live one; wait on a lock whose owner is dead.
  it("a second run is stuck while one is live, and a dead run's lock and container are cleared", () => {
    const busy = run({ lockPid: process.pid });
    expect(busy.code, busy.text).toBe(30);
    expect(busy.summary).toMatchObject({ outcome: "stuck", reason: "docker_busy" });
    expect(busy.ranContainer).toBe(false);
    // The live run's lock is not ours to remove.
    expect(busy.lockLeft).toBe(true);

    const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
    const taken = run({ lockPid: dead, leftover: "abc123" });
    expect(taken.code, taken.text).toBe(0);
    expect(taken.calls).toContain("rm -f abc123");
    expect(taken.calls.indexOf("rm -f abc123")).toBeLessThan(taken.calls.findIndex((c) => c.startsWith("run ")));
    expect(taken.lockLeft).toBe(false);
  });

  // Plant: hand docker a path whose comma it reads as a mount option.
  it("an output path docker --mount cannot take is stuck before Docker is asked", () => {
    const got = run({ outName: "out,ro" });
    expect(got.code, got.text).toBe(30);
    expect(got.summary).toMatchObject({ outcome: "stuck", reason: "bad_path" });
    expect(got.calls).toEqual([]);
  });

  // Plants: run a window test and count it; pass an option or an outside path to the test runner.
  it("a related test that needs a window is left out by name, and a bad path stops the run", () => {
    const got = run({ related: "src/a.test.ts,src/win.test.ts,src/gone.test.ts" });
    expect(got.code, got.text).toBe(0);
    expect(got.summary.related).toEqual(["src/a.test.ts"]);
    expect(got.summary.excluded).toEqual([
      { path: "src/win.test.ts", reason: expect.stringContaining("no display") },
      { path: "src/gone.test.ts", reason: "the build commit has no such file" },
    ]);
    expect(got.calls.find((c) => c.startsWith("run "))).toContain("RELATED=src/a.test.ts ");

    const none = run({ related: "src/win.test.ts" });
    expect(none.code, none.text).toBe(30);
    expect(none.summary).toMatchObject({ outcome: "stuck", reason: "no_tests" });
    expect(none.ranContainer).toBe(false);

    for (const related of ["--config=/x.test.ts", "../a.test.ts", "src/a.ts", ""]) {
      const bad = run({ related });
      expect(bad.code, bad.text).not.toBe(0);
      expect(bad.calls).toEqual([]);
    }
  });

  // scenario: lane t389 read done five times with its build's files unreached and no arm a.
  // Plants: skip the plan read; drop the no_build_reach check; make no_arm_a stuck; leave
  // narrowing null or armA out; drop the arm_a_failed check.
  it("scenario: a build file with no mutant is stuck, no passing base test is a done with narrowing unknown", () => {
    const plan = (file: string) => `# Plan\n\n| File | Owner step |\n| --- | --- |\n| \`${file}\` | build |\n`;
    const missed = run({
      files: { "plan.md": plan("src/b.cjs") },
      args: ({ dir }) => ["--plan", join(dir, "plan.md")],
    });
    expect(missed.code, missed.text).toBe(30);
    expect(missed.summary).toMatchObject({ outcome: "stuck", reason: "no_build_reach" });
    expect(missed.summary.detail).toContain("src/b.cjs");
    expect(missed.summary.reach).toContain("1 of 2 changed files");

    const reached = run({
      files: { "plan.md": plan("src/a.ts") },
      args: ({ dir }) => ["--plan", join(dir, "plan.md")],
    });
    expect(reached.code, reached.text).toBe(0);
    expect(reached.summary).toMatchObject({ outcome: "done", reason: "" });

    const unread = run({ args: ({ dir }) => ["--plan", join(dir, "no-such-plan.md")] });
    expect(unread.summary).toMatchObject({ outcome: "stuck", reason: "bad_plan" });
    expect(unread.ranContainer).toBe(false);

    // The base has src/a.test.ts, and its one test fails on the build: dropped, so no arm a ran.
    const failing = JSON.stringify({
      testResults: [{ name: "/repo/src/a.test.ts", assertionResults: [{ fullName: "adds", status: "failed" }] }],
    });
    const none = run({
      run: `${DONE}\necho '${failing}' > "$OUT/a-baseline.json"\necho > "$OUT/a-kept"\n`,
      args: ({ build }) => ["--base", `${build}^`],
    });
    expect(none.code, none.text).toBe(0);
    expect(none.summary).toMatchObject({
      outcome: "done",
      reason: "no_arm_a:none_pass",
      a: null,
      narrowing: "unknown",
      armA: { dropped: [{ path: "src/a.test.ts", reason: "its base version fails on the build: adds" }] },
    });
    expect(none.line).toContain("no_arm_a:none_pass");

    // A kept base test and no arm a answer is not a known state.
    const lost = run({
      run: `${DONE}\necho src/a.test.ts > "$OUT/a-kept"\n`,
      args: ({ build }) => ["--base", `${build}^`],
    });
    expect(lost.code, lost.text).toBe(30);
    expect(lost.summary).toMatchObject({ outcome: "stuck", reason: "arm_a_failed", armA: { dropped: [] } });
  });

  // Plant: follow a link the container planted, and read a file from outside the output folder.
  it("a link planted in the output is never read through", () => {
    const got = run({
      run: `mkdir -p "$OUT/b"\necho 0 > "$OUT/b/exit"\necho 'PLANTED-SECRET' > "$FAKE/outside.json"\nln -s "$FAKE/outside.json" "$OUT/b/sample.json"\n`,
    });
    expect(got.code, got.text).toBe(30);
    expect(got.summary).toMatchObject({ outcome: "stuck", reason: "bad_output" });
    expect(got.text).not.toContain("PLANTED-SECRET");
  });

  // Plants: call an empty sample done; call a failed baseline or an untested sample done.
  it("no range is a skip, and a failed baseline, a dry run or no report is stuck", () => {
    const sample = (ranges: string[]) =>
      JSON.stringify({ seed: 119120, ranges, total: 0, selected: ranges.length, left: 0 });
    const skip = run({
      run: `mkdir -p "$OUT/b"\necho 1 > "$OUT/b/exit"\necho '${sample([])}' > "$OUT/b/sample.json"\nexit 1\n`,
    });
    expect(skip.code, skip.text).toBe(40);
    expect(skip.summary).toMatchObject({ outcome: "skip", reason: "no_ranges" });

    const baseline = JSON.stringify({
      testResults: [{ name: "/repo/src/a.test.ts", assertionResults: [{ fullName: "adds", status: "failed" }] }],
    });
    const failed = run({ run: `echo '${baseline}' > "$OUT/baseline.json"\nexit 71\n` });
    expect(failed.code, failed.text).toBe(30);
    expect(failed.summary).toMatchObject({ outcome: "stuck", reason: "baseline_failed" });
    expect(failed.summary.detail).toContain("src/a.test.ts: adds");

    const report = JSON.stringify({ files: { "src/a.ts": { mutants: [mutant("NoCoverage", 1)] } } });
    const dry = run({
      run: `mkdir -p "$OUT/b"\necho 0 > "$OUT/b/exit"\necho '${sample(["src/a.ts:1:0-1:4"])}' > "$OUT/b/sample.json"\necho '${report}' > "$OUT/b/report.json"\n`,
    });
    expect(dry.code, dry.text).toBe(30);
    expect(dry.summary).toMatchObject({ outcome: "stuck", reason: "no_tested_mutant" });

    const nothing = run({ run: "exit 1\n" });
    expect(nothing.code, nothing.text).toBe(30);
    expect(nothing.summary).toMatchObject({ outcome: "stuck", reason: "no_report" });

    const install = run({ run: "exit 70\n" });
    expect(install.summary).toMatchObject({ outcome: "stuck", reason: "install_failed" });
  });

  // Plants: call any untested sample a skip; call a mix, an empty report or a capped run static.
  it("scenario: a sample of only static mutants, which ignoreStatic leaves Ignored, is a skip", () => {
    const sample = JSON.stringify({ seed: 119120, ranges: ["src/a.ts:1:0-1:4"], total: 2, selected: 2, left: 0 });
    const ran = (statuses: string[], exit = 0) => {
      const report = JSON.stringify({
        files: { "src/a.ts": { mutants: statuses.map((status, n) => mutant(status, n + 1)) } },
      });
      return run({
        run: `mkdir -p "$OUT/b"\necho ${exit} > "$OUT/b/exit"\necho '${sample}' > "$OUT/b/sample.json"\necho '${report}' > "$OUT/b/report.json"\nexit ${exit}\n`,
      });
    };

    const fixed = ran(["Ignored", "Ignored"]);
    expect(fixed.code, fixed.text).toBe(40);
    expect(fixed.summary).toMatchObject({ outcome: "skip", reason: "static_only" });
    expect(fixed.summary.detail).toContain("Ignored 2");

    for (const statuses of [["Ignored", "NoCoverage"], []]) {
      const mixed = ran(statuses);
      expect(mixed.code, mixed.text).toBe(30);
      expect(mixed.summary).toMatchObject({ outcome: "stuck", reason: "no_tested_mutant" });
    }

    const capped = ran(["Ignored"], 124);
    expect(capped.code, capped.text).not.toBe(40);
    expect(capped.summary.reason).not.toBe("static_only");
  });

  // Plant: drop the events fallback, so a capped run reports nothing.
  it("when the five minutes ran out, what Stryker kept in its events is the report", () => {
    const tested = (n: number, status: string) => JSON.stringify({ ...mutant(status, n), fileName: "/repo/src/a.ts" });
    const got = run({
      run: `mkdir -p "$OUT/b/events"\necho 124 > "$OUT/b/exit"\necho '${JSON.stringify({ seed: 119120, ranges: ["src/a.ts:1:0-9:4"], total: 5, selected: 5, left: 0, files: [{ file: "src/a.ts", total: 5, selected: 5 }] })}' > "$OUT/b/sample.json"\necho '${tested(1, "Killed")}' > "$OUT/b/events/00002-onMutantTested.json"\necho '${tested(2, "Survived")}' > "$OUT/b/events/00003-onMutantTested.json"\necho '{}' > "$OUT/b/events/00000-onDryRunCompleted.json"\nexit 124\n`,
    });
    expect(got.code, got.text).toBe(0);
    expect(got.summary).toMatchObject({
      outcome: "done",
      reason: "capped",
      b: { exit: 124, from: "events", tested: 2, unreached: 3 },
    });
    expect(got.summary.b.survivors).toHaveLength(1);
  });
});

describe("mutbox gc against a stand-in docker", () => {
  const gc = (setup: { lockPid?: number; leftover?: string; down?: boolean }) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "mutbox-gc-")));
    made.push(dir);
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin/docker"), DOCKER, { mode: 0o755 });

    if (setup.lockPid !== undefined) {
      writeFileSync(join(dir, "docker.lock"), String(setup.lockPid));
    }

    if (setup.leftover !== undefined) {
      writeFileSync(join(dir, "leftover"), `${setup.leftover}\n`);
    }

    const ran = spawnSync(process.execPath, [script, "gc", "--lock", join(dir, "docker.lock")], {
      encoding: "utf8",
      timeout: 30_000,
      env: {
        PATH: `${join(dir, "bin")}:/usr/bin:/bin`,
        HOME: dir,
        FAKE: dir,
        ...(setup.down ? { DOWN: "1" } : {}),
      },
    });
    const log = join(dir, "calls.log");
    return {
      code: ran.status,
      text: ran.stdout + ran.stderr,
      calls: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [],
    };
  };

  // Plants: remove a live run's container; prune images without our label.
  it("gc removes leftover containers and week-old images, and never touches a live run", () => {
    const swept = gc({ leftover: "abc123", lockPid: spawnSync(process.execPath, ["-e", ""]).pid! });
    expect(swept.code, swept.text).toBe(0);
    expect(swept.calls).toContain("rm -f abc123");
    expect(swept.calls).toContain(`image prune --all --force --filter label=${LABEL} --filter until=168h`);
    expect(swept.text).toContain("removed 1 containers and 1 images");

    const live = gc({ leftover: "abc123", lockPid: process.pid });
    expect(live.code, live.text).toBe(0);
    expect(live.text).toContain("keep mutbox");
    expect(live.calls.some((c) => c.startsWith("rm ") || c.startsWith("image prune"))).toBe(false);

    const down = gc({ down: true });
    expect(down.code, down.text).toBe(0);
    expect(down.text).toContain("Docker is not running");
  });
});

// 2026-11-10: a `docker ps` in gc never returned, and two lanes sat 1 h 50 min with no agent.
// The stand-in is a real child process that writes its pid, then waits for one line on stdin.
// Without that line it never ends by itself.
// That line comes at `delay` on the test clock, so the child's run time follows the test clock and
// a 30 s bound costs milliseconds. Plants: drop the bound; time out but leave the child running;
// fail with something other than CallTimeout; stop a call that answered in time.
describe("a call past its bound is stopped, and its child with it", () => {
  const seconds = DOCKER_SECONDS.call;
  const limit = seconds * 1000;
  const alive = (pid: number) => spawnSync("kill", ["-0", String(pid)]).status === 0;
  const readPid = (file: string) =>
    Effect.sync(() => (existsSync(file) ? Number(readFileSync(file, "utf8").trim()) || 0 : 0));
  /** The line on stdin, at `delay` ms on the test clock, however late the child asked for it. */
  const lineAt = (delay: number) =>
    Stream.fromEffect(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;

        if (delay > now) {
          yield* Effect.sleep(delay - now);
        }

        return new TextEncoder().encode("go\n");
      }),
    );
  const called = (delay: number, script: string) =>
    Effect.gen(function* () {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), "mutbox-bound-")));
      made.push(dir);
      const file = join(dir, "pid");
      const fiber = yield* bounded("sh", ["-c", script, "sh", file], seconds, lineAt(delay)).pipe(Effect.forkChild);
      // On the live clock: wait until the child is up and reading, then move the test clock.
      const pid = yield* readPid(file).pipe(
        Effect.repeat({ until: (p) => p > 0, schedule: Schedule.spaced("5 millis") }),
        TestClock.withLive,
      );
      yield* TestClock.adjust(delay);
      const exit = yield* Effect.exit(Fiber.join(fiber));
      return { exit, pid };
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, TestClock.layer())));
  // At end of input with no line it hangs, as `exec sleep`, keeping its pid: only a kill ends it.
  const waits = 'echo $$ > "$1"; read line || exec sleep 600; echo "got $line"';

  it("an answer before the bound is read whole; past it, CallTimeout and no child left", () =>
    fc.assert(
      fc.asyncProperty(
        fc.oneof(fc.integer({ min: 0, max: limit - 1 }), fc.integer({ min: limit + 1, max: 10 * limit })),
        (delay) =>
          called(delay, waits).pipe(
            Effect.tap(({ exit, pid }) =>
              Effect.sync(() => {
                expect(exit).toStrictEqual(
                  delay < limit
                    ? Exit.succeed({ out: "got go\n", err: "", code: 0 })
                    : Exit.fail(new CallTimeout({ command: `sh -c ${waits}`, seconds })),
                );
                expect(alive(pid)).toBe(false);
              }),
            ),
            Effect.asVoid,
            Effect.runPromise,
          ),
      ),
      { seed: 1110, numRuns: 25 },
    ));

  // scenario: a hung client that ignores SIGTERM still goes, by SIGKILL after the grace. Its
  // `sleep` inherits the ignored TERM. This one waits the grace on the real clock.
  it("scenario: a child that ignores SIGTERM is killed after the grace", () => {
    const started = Date.now();
    return called(2 * limit, `trap '' TERM; ${waits}`).pipe(
      Effect.tap(({ exit, pid }) =>
        Effect.sync(() => {
          expect(Exit.isFailure(exit)).toBe(true);
          expect(alive(pid)).toBe(false);
          expect(Date.now() - started).toBeGreaterThanOrEqual(KILL_GRACE_SECONDS * 1000);
        }),
      ),
      Effect.runPromise,
    );
  });

  // format: the line gc prints, after "mutbox gc: ", before it exits 0 and the chain goes on.
  it("format: the line a timed-out call leaves", () => {
    expect(timeoutLine(new CallTimeout({ command: "docker ps -aq", seconds: 30 }))).toBe(
      "docker ps -aq passed its 30 s limit and was stopped",
    );
  });
});

// scenario: the real fence, once, on a laptop with a free Docker box (MUTBOX_DOCKER=1). It is
// skipped in CI, whose Docker is linux/amd64, and by default, since it holds the one Docker box.
// Only a real container shows that a listener works on its own loopback and that nothing outside
// is reachable. Plant: change `--network none` to `--network bridge`, and the fetch succeeds.
describe.skipIf(process.env.MUTBOX_DOCKER !== "1")("mutbox, a real container", () => {
  it("scenario: inside the fence a port listens on loopback and nothing outside is reachable", () => {
    const probe = `
const net = require("node:net");
const server = net.createServer((s) => s.end("hello")).listen(() => {
  net.connect(server.address().port, "localhost", function () {
    this.on("data", (d) => {
      console.log("loopback:" + d);
      server.close();
      fetch("https://registry.npmjs.org/").then(() => console.log("outside:reached"), () => console.log("outside:refused"));
    });
  });
});`;
    const args = runArgs({
      name: `fabrika-mutbox-probe-${process.pid}`,
      image: "",
      input: tmpdir(),
      output: tmpdir(),
      ticket: "0",
      build: "0",
      related: [],
      lock: "probe",
    });
    const from = /^FROM (\S+)$/m.exec(dockerfile)?.[1] ?? "";
    // The same fence, on the pinned base image alone, with the probe in place of the entry.
    const fenced = [...args.slice(0, args.indexOf("")), from, "node", "-e", probe].filter(
      (a, i, all) => !(a === "--mount" || all[i - 1] === "--mount"),
    );
    const ran = spawnSync("docker", fenced, { encoding: "utf8", timeout: 120_000 });
    expect(ran.stdout, ran.stderr).toContain("loopback:hello");
    expect(ran.stdout, ran.stderr).toContain("outside:refused");
    const left = spawnSync("docker", ["ps", "-aq", "--filter", `name=fabrika-mutbox-probe-${process.pid}`], {
      encoding: "utf8",
    });
    expect(left.stdout.trim()).toBe("");
  });
});
