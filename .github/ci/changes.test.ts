import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { expect, it } from "vitest";
import { checkTracked } from "../../oxlint-plugins/gitignore.mjs";
import * as ci from "./changes.mjs";

// Today's CI, both versions. Covers changes.mjs and the shared gitignore.mjs.
// Red baseline adapters are preserved in the first T342 tests commit. These laws
// now import the implementation directly, so deleting it cannot bypass a check.
// T342 source plants, all caught: PR skips on main, all Markdown safe, broad
// packages prefix, any-match skips, every next path skips test, newline splitting,
// and ignored diff failure. The broad-prefix plant first survived mixed lists;
// checking each shared path alone closed that gap. Shared-check plants accepting
// hidden tracked files or failed Git output both failed the tracked-file law.
const options = { seed: 119120, numRuns: 100 };
// T375 plants caught: skill readTrees and shared scripts at the red baseline;
// script Markdown counted as prose, scripts skipping test, all Markdown safe,
// prose masking shared paths, and every skill-tree path counted as prose.
const heavy = { check: true, test: true, next: true, e2e: true };
type Runner = (args: string[]) => { status: number | null; stdout: string };
const word = fc.stringMatching(/^[a-z][a-z0-9_-]{0,12}$/);

// Decision 0090: a new row is its own file in a log's folder, as safe as a line in the old file.
const logs = fc.constantFrom("notes", "runs", "findings");

const safe = fc.oneof(
  word.map((s) => `field/${s}.jsonl`),
  fc.tuple(logs, word).map(([log, s]) => `field/${log}/2026-11-11-${s}.json`),
  word.map((s) => `docs/${s}.md`),
  word.map((s) => `field/${s}.md`),
);

const today = fc
  .tuple(fc.constantFrom("apps", "programs", "packs", "wip", "legacy", "packages/fabrika"), word)
  .map(([dir, s]) => `${dir}/${s}.ts`);

const next = word.map((s) => `next/packages/libfabrika/src/${s}.ts`);

const shared = fc.oneof(
  word.map((s) => `unknown/${s}`),
  fc.constantFrom(
    "packages/fabrika-design/src/colors.ts",
    "packages-other/file.ts",
    "nextish/file.ts",
    ".claude/skills/tests/SKILL.md",
    "pnpm-lock.yaml",
    "field/nested/a.jsonl",
    "tools/field/a.jsonl",
    "field/a.jsonl.ts",
    "field/other/2026-11-11-a.json",
    "tools/field/runs/2026-11-11-a.json",
  ),
);

const skillName = fc
  .stringMatching(/^[a-z]{1,12}$/)
  // Brief/prompt folders belong to readMarkdown's heavy-path family below.
  .filter((s) => !["brief", "briefs", "prompt", "prompts", "scripts"].includes(s));

const prose = fc.oneof(
  fc
    .tuple(skillName, fc.array(skillName, { maxLength: 2 }), skillName)
    .map(([skill, dirs, name]) => [".agents/skills", skill, ...dirs, `${name}.md`].join("/")),
  skillName.map((skill) => `.claude/skills/${skill}`),
);

const script = fc
  .tuple(
    fc.constantFrom("lead", "mutation", "plan", "step-commit"),
    skillName,
    fc.constantFrom("sh", "py", "mjs", "ts", "json"),
  )
  .map(([skill, name, ext]) => `.agents/skills/${skill}/scripts/${name}.${ext}`);

const otherSkill = fc.oneof(
  fc
    .tuple(skillName, fc.array(skillName, { maxLength: 2 }), skillName, fc.constantFrom("json", "ts", "txt"))
    .map(([skill, dirs, name, ext]) => [".agents/skills", skill, ...dirs, `${name}.${ext}`].join("/")),
  fc
    .tuple(skillName, skillName, fc.constantFrom("md", "json", "ts"))
    .map(([skill, name, ext]) => `.claude/skills/${skill}/${name}.${ext}`),
);

const path = fc.oneof(
  safe,
  today,
  next,
  shared,
  prose,
  script,
  otherSkill,
  fc.string({ minLength: 1 }).map((s) => `unusual/${s}`),
);

const list = fc.array(path, { maxLength: 12 });

it("main enables every job for every path list", () => {
  fc.assert(
    fc.property(list, (paths) => {
      expect(ci.classify(paths, "push")).toEqual({ ...heavy, field: true });
    }),
    options,
  );
});

it("skill prose and safe paths skip heavy jobs; field follows rows", () => {
  fc.assert(
    fc.property(fc.array(fc.oneof(safe, prose), { minLength: 1, maxLength: 12 }), (paths) => {
      expect(ci.classify(paths, "pull_request")).toEqual({
        check: false,
        test: false,
        next: false,
        e2e: false,
        field: paths.some((p) => /^field\/[^/]+\.jsonl$/.test(p) || /^field\/(?:notes|runs|findings)\//.test(p)),
      });
    }),
    options,
  );
});

it("skill scripts run check and test; other version flags follow their readers", () => {
  fc.assert(
    fc.property(
      fc.array(script, { minLength: 1, maxLength: 12 }),
      fc.array(fc.oneof(today, next), { maxLength: 12 }),
      (scripts, others) => {
        expect(ci.classify(scripts, "pull_request")).toEqual({
          ...heavy,
          next: false,
          e2e: false,
          field: false,
        });
        // A Markdown file beside a script is still script input, even though prose is quiet.
        expect(
          ci.classify(
            scripts.map((path) => path.replace(/\.[^.]+$/, ".md")),
            "pull_request",
          ),
        ).toEqual({ ...heavy, next: false, e2e: false, field: false });
        const flags = ci.classify([...scripts, ...others], "pull_request");
        expect(flags).toEqual({
          check: true,
          test: true,
          next: others.some((p) => p.startsWith("next/")),
          e2e: others.some((p) => !p.startsWith("next/")),
          field: false,
        });
      },
    ),
    options,
  );
});

it("other skill-tree paths still run every heavy job", () => {
  fc.assert(
    fc.property(fc.array(otherSkill, { minLength: 1, maxLength: 12 }), (paths) => {
      expect(ci.classify(paths, "pull_request")).toMatchObject(heavy);
    }),
    options,
  );
});

// Plan change, 2026-11-09: only paths no check reads are safe. Markdown under these trees, or
// in any brief or prompt folder, is read by a program (a brief is an agent's input; a fixture is
// a test's input), so it runs every check. Plant caught: the old "every .md outside the skill
// trees is safe" rule, which skipped programs/pipeline/briefs/x.md and fixtures/a/b.md.
const folder = fc.constantFrom("brief", "briefs", "prompt", "prompts");

const readMarkdown = fc.oneof(
  fc
    .tuple(fc.constantFrom("programs", "fixtures", "packages", "next"), fc.array(word, { maxLength: 3 }), word)
    .map(([root, dirs, name]) => [root, ...dirs, `${name}.md`].join("/")),
  fc
    .tuple(fc.array(word, { maxLength: 3 }), folder, fc.array(word, { maxLength: 2 }), word)
    .map(([above, dir, below, name]) => [...above, dir, ...below, `${name}.md`].join("/")),
);

it("Markdown a check reads runs every check, alone or beside safe paths", () => {
  fc.assert(
    fc.property(readMarkdown, fc.array(safe, { maxLength: 6 }), (read, paths) => {
      expect(ci.classify([read], "pull_request")).toMatchObject(heavy);
      expect(ci.classify([...paths, read], "pull_request")).toMatchObject(heavy);
    }),
    {
      ...options,
      examples: [
        // pinned: review of PR 578, a brief-only PR skipped every check.
        ["programs/pipeline/briefs/x.md", []],
        // pinned: review of PR 578, a fixture-only PR skipped every check.
        ["fixtures/a/b.md", []],
      ],
    },
  );
});

it("shared paths run everything; adding paths never disables a job", () => {
  fc.assert(
    fc.property(fc.array(path, { minLength: 1, maxLength: 10 }), list, shared, (paths, more, unknown) => {
      expect(ci.classify([unknown], "pull_request")).toMatchObject(heavy);
      expect(ci.classify([...paths, unknown], "pull_request")).toMatchObject(heavy);
      const before = ci.classify(paths, "pull_request");
      const after = ci.classify([...paths, ...more], "pull_request");

      for (const key of ["check", "test", "next", "e2e", "field"] as const) {
        expect(!before[key] || after[key]).toBe(true);
      }

      expect(ci.classify([], "pull_request")).toMatchObject(heavy);
      expect(ci.classify(null, "pull_request")).toMatchObject(heavy);
    }),
    options,
  );
});

it("today, next, mixed and the shared plant helper have separate version flags", () => {
  fc.assert(
    fc.property(
      fc.array(today, { minLength: 1, maxLength: 12 }),
      fc.array(next, { minLength: 1, maxLength: 12 }),
      (old, fresh) => {
        expect(ci.classify(old, "pull_request")).toMatchObject({ ...heavy, next: false });
        expect(ci.classify(fresh, "pull_request")).toMatchObject({
          ...heavy,
          test: false,
          e2e: false,
        });
        expect(ci.classify([...old, ...fresh], "pull_request")).toMatchObject(heavy);
        expect(ci.classify([...fresh, "next/apps/fabrika/src/exam/plant.ts"], "pull_request")).toMatchObject({
          test: true,
          e2e: false,
        });
      },
    ),
    options,
  );
});

it("next's exam signer runs today's tests, alone or beside other paths", () => {
  // T375 Amendment 1: box, plancheck and stepcommit tests read the signer.
  // Plant caught: let commits.ts skip test like any other next/ path.
  const commits = "next/apps/fabrika/src/exam/commits.ts";
  const helper = "next/apps/fabrika/src/exam/plant.ts";
  fc.assert(
    fc.property(list, (paths) => {
      expect(ci.classify([commits], "pull_request")).toEqual({
        ...heavy,
        e2e: false,
        field: false,
      });
      expect(ci.classify([...paths, commits], "pull_request")).toEqual(ci.classify([...paths, helper], "pull_request"));
    }),
    options,
  );
});

it("NUL diff keeps both move names and unusual paths; failed reads cannot skip", () => {
  fc.assert(
    fc.property(
      word,
      word,
      fc.constantFrom(" ", "\t", "\n"),
      fc.constantFrom(1, 128, null),
      (old, fresh, space, status) => {
        const paths = [`apps/${old}${space}old.ts`, `next/${fresh}${space}new.ts`];
        const calls: string[][] = [];
        const run: Runner = (args) => {
          calls.push(args);
          return {
            status: 0,
            stdout: args[0] === "merge-base" ? `${"a".repeat(40)}\n` : `${paths.join("\0")}\0`,
          };
        };
        expect(ci.readPaths("b".repeat(40), "c".repeat(40), "pull_request", run)).toEqual(paths);
        expect(calls[0]).toEqual(["merge-base", "b".repeat(40), "c".repeat(40)]);
        expect(calls[1]).toEqual(["diff", "--no-renames", "--name-only", "-z", "a".repeat(40), "c".repeat(40), "--"]);
        expect(
          ci.readPaths("b".repeat(40), "c".repeat(40), "pull_request", () => ({
            status,
            stdout: "",
          })),
        ).toBeNull();
        expect(
          ci.readPaths("b".repeat(40), "c".repeat(40), "pull_request", (args) =>
            args[0] === "merge-base" ? { status: 0, stdout: "a".repeat(40) } : { status, stdout: "" },
          ),
        ).toBeNull();
        expect(ci.readPaths("b".repeat(40), "c".repeat(40), "push", run)).toEqual(paths);
        expect(calls.at(-1)).toEqual([
          "diff",
          "--no-renames",
          "--name-only",
          "-z",
          "b".repeat(40),
          "c".repeat(40),
          "--",
        ]);
        expect(ci.readPaths("--bad", "c".repeat(40), "pull_request", run)).toBeNull();
        // A platform refusal has null stdout at runtime, despite Node's generic string type.
        expect(
          ci.readPaths("b".repeat(40), "c".repeat(40), "pull_request", () =>
            spawnSync("git", ["status"], {
              cwd: join(tmpdir(), "t342-no-such-folder", old),
              encoding: "utf8",
            }),
          ),
        ).toBeNull();
        expect(ci.readPaths("0".repeat(40), "c".repeat(40), "push", run)).toBeNull();
        // Zeros at either end are legal; only the all-zero SHA means no history.
        const zeros = `0${"a".repeat(38)}0`;
        expect(ci.readPaths(zeros, zeros, "push", run)).toEqual(paths);
        // A merge base Git prints that is not a SHA cannot reach the diff.
        expect(
          ci.readPaths("b".repeat(40), "c".repeat(40), "pull_request", (args) =>
            args[0] === "merge-base" ? { status: 0, stdout: "\n" } : run(args),
          ),
        ).toBeNull();
        // Empty output is no paths; output cut before its last NUL cannot skip.
        const answer = (stdout: string) =>
          ci.readPaths("b".repeat(40), "c".repeat(40), "push", () => ({ status: 0, stdout }));
        expect(answer("")).toEqual([]);
        expect(answer(paths.join("\0"))).toBeNull();
      },
    ),
    options,
  );
});

it("shared tracked-file check agrees with Git, including command errors", () => {
  fc.assert(
    fc.property(word, fc.boolean(), (name, ignored) => {
      const root = mkdtempSync(join(tmpdir(), "ci-ignore-"));

      try {
        const data = join(root, "data");
        // These disposable Git fixtures never touch this checkout's index or history.
        expect(spawnSync("git", ["init", "-q", "--separate-git-dir", data, join(root, "tree")]).status).toBe(0);
        const tree = join(root, "tree");
        writeFileSync(join(tree, name), "test");
        expect(spawnSync("git", ["add", "--", name], { cwd: tree }).status).toBe(0);
        writeFileSync(join(tree, ".gitignore"), ignored ? `${name}\n` : "other\n");
        expect(checkTracked(tree).ok).toBe(!ignored);
        expect(checkTracked(join(root, "missing")).ok).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
    options,
  );
});

// T375 mutation: unanchored skill paths. A skill-shaped path below another folder is no skill.
it("skill script and prose rules apply only at the repo root", () => {
  fc.assert(
    fc.property(fc.array(skillName, { maxLength: 2 }), script, skillName, (dirs, script, skill) => {
      const prefix = ["next", ...dirs].join("/");
      expect(ci.classify([`${prefix}/${script}`], "pull_request")).toEqual({
        ...heavy,
        test: false,
        e2e: false,
        field: false,
      });

      for (const root of ["next", "docs"]) {
        expect(ci.classify([[root, ...dirs, ".claude/skills", skill].join("/")], "pull_request")).toEqual({
          ...heavy,
          test: root !== "next",
          e2e: root !== "next",
          field: false,
        });
      }
    }),
    options,
  );
});
