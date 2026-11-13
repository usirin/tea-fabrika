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
const heavy = { check: true, typecheck: true, test: true, next: true, e2e: true };
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

// 0175: a file of today's version, written apart from changes.mjs. Only these start today's own
// checks (its tests, e2e and build), on every event. No generator above makes a quiet path, plain
// Markdown or a field row, under these trees; the scenario near the end pins that case.
const todays = (p: string) => /^(?:apps|programs|packs|wip|legacy|packages|fixtures)\//.test(p);
const touched = (paths: readonly string[]) => paths.some(todays);

// 0174 narrowed this law: a merge queue's group left it, and follows its paths (below).
// 0175 narrowed it again: today's own checks follow the paths on main too. No path at all still
// runs everything.
it("main, and every event that is no pull request or merge queue's group, runs check, typecheck, test, next and field for every path list, and today's checks by its paths", () => {
  fc.assert(
    fc.property(list, fc.constantFrom("push", "workflow_dispatch", ""), (paths, event) => {
      const on = paths.length === 0 || touched(paths);
      expect(ci.classify(paths, event)).toEqual({ ...heavy, field: true, e2e: on, today: on });
    }),
    options,
  );
});

// 0174: a merge queue's run starts only the checks its changed files need.
it("property: a merge queue's group gets the flags a pull request gets for the same paths", () => {
  fc.assert(
    fc.property(fc.option(list, { nil: null }), (paths) => {
      expect(ci.classify(paths, "merge_group")).toEqual(ci.classify(paths, "pull_request"));
    }),
    {
      ...options,
      examples: [
        // pinned: Markdown alone, the one-file decision that started 18 of 18 jobs in the queue.
        [[".decisions/0174-a-queue-run-follows-its-paths.md"]],
        // pinned: next/ alone, where a pull request skips test and e2e.
        [["next/packages/libfabrika/src/a.ts"]],
      ],
    },
  );
});

it("scenario: a merge queue's group of Markdown skips the heavy jobs, and one of next/ files runs check and next", () => {
  // scenario: the two cases named in 0174, written out so the flags are read here and not only
  // compared with a pull request's.
  const quiet = { check: false, typecheck: false, test: false, next: false, e2e: false, field: false, today: false };
  expect(ci.jobs(["docs/a.md"], "merge_group", false)).toEqual({ ...quiet, build: false });
  // 0175: the build is today's library, so a group of next/ files alone no longer builds.
  expect(ci.jobs(["next/packages/libfabrika/src/a.ts"], "merge_group", false)).toEqual({
    ...heavy,
    test: false,
    e2e: false,
    field: false,
    today: false,
    build: false,
  });
});

it("skill prose and safe paths skip heavy jobs; field follows rows", () => {
  fc.assert(
    fc.property(fc.array(fc.oneof(safe, prose), { minLength: 1, maxLength: 12 }), (paths) => {
      expect(ci.classify(paths, "pull_request")).toEqual({
        check: false,
        typecheck: false,
        test: false,
        next: false,
        e2e: false,
        field: paths.some((p) => /^field\/[^/]+\.jsonl$/.test(p) || /^field\/(?:notes|runs|findings)\//.test(p)),
        today: false,
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
          today: false,
        });
        // A Markdown file beside a script is still script input, even though prose is quiet.
        expect(
          ci.classify(
            scripts.map((path) => path.replace(/\.[^.]+$/, ".md")),
            "pull_request",
          ),
        ).toEqual({ ...heavy, next: false, e2e: false, field: false, today: false });
        const flags = ci.classify([...scripts, ...others], "pull_request");
        expect(flags).toEqual({
          check: true,
          typecheck: true,
          test: true,
          next: others.some((p) => p.startsWith("next/")),
          e2e: others.some((p) => !p.startsWith("next/")),
          field: false,
          today: others.some((p) => !p.startsWith("next/")),
        });
      },
    ),
    options,
  );
});

// 0175 narrowed this law: e2e is today's app, so a skill-tree path no longer starts it.
it("other skill-tree paths still run check, typecheck, test and next, and none of today's checks", () => {
  fc.assert(
    fc.property(fc.array(otherSkill, { minLength: 1, maxLength: 12 }), (paths) => {
      expect(ci.classify(paths, "pull_request")).toMatchObject({ ...heavy, e2e: false, today: false });
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

// 0175 narrowed this law: today's checks start only when the Markdown is under today's trees.
it("Markdown a check reads runs check, typecheck, test and next, alone or beside safe paths, and today's checks by its tree", () => {
  fc.assert(
    fc.property(readMarkdown, fc.array(safe, { maxLength: 6 }), (read, paths) => {
      const expected = { ...heavy, e2e: todays(read), today: todays(read) };
      expect(ci.classify([read], "pull_request")).toMatchObject(expected);
      expect(ci.classify([...paths, read], "pull_request")).toMatchObject(expected);
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

// 0175 narrowed this law: a shared path that is no file of today's version, the lockfile among
// them, no longer starts today's checks.
it("shared paths run check, typecheck, test and next, and today's checks by the paths; adding paths never disables a job", () => {
  fc.assert(
    fc.property(fc.array(path, { minLength: 1, maxLength: 10 }), list, shared, (paths, more, unknown) => {
      expect(ci.classify([unknown], "pull_request")).toMatchObject({
        ...heavy,
        e2e: todays(unknown),
        today: todays(unknown),
      });
      const on = touched([...paths, unknown]);
      expect(ci.classify([...paths, unknown], "pull_request")).toMatchObject({ ...heavy, e2e: on, today: on });
      const before = ci.classify(paths, "pull_request");
      const after = ci.classify([...paths, ...more], "pull_request");

      for (const key of ["check", "typecheck", "test", "next", "e2e", "field", "today"] as const) {
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
        expect(ci.classify(old, "pull_request")).toMatchObject({ ...heavy, next: false, today: true });
        expect(ci.classify(fresh, "pull_request")).toMatchObject({
          ...heavy,
          test: false,
          e2e: false,
          today: false,
        });
        expect(ci.classify([...old, ...fresh], "pull_request")).toMatchObject({ ...heavy, today: true });
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
        today: false,
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
        today: false,
      });

      for (const root of ["next", "docs"]) {
        expect(ci.classify([[root, ...dirs, ".claude/skills", skill].join("/")], "pull_request")).toEqual({
          ...heavy,
          test: root !== "next",
          // 0175: neither root is today's version, so e2e stays off for both.
          e2e: false,
          field: false,
          today: false,
        });
      }
    }),
    options,
  );
});

// 0134's amendment (2026-11-11): a draft pull request runs only the fast jobs; marking it ready
// runs the rest on the same head. Plants caught: a draft that still runs test, main honoring the
// draft flag, a draft that skips typecheck, and a ready docs-only PR that builds (that one survived
// until the pinned example below).
const events = fc.constantFrom("pull_request", "push", "merge_group", "workflow_dispatch", "");
const paths = fc.option(list, { nil: null });

// 0175 narrowed this law: the build is today's library, so it follows `today`, no longer `check`.
it("property: a ready pull request and every other event run what classify says, build with today's checks", () => {
  fc.assert(
    fc.property(paths, events, fc.boolean(), (paths, event, draft) => {
      const flags = ci.classify(paths, event);
      const ready = event !== "pull_request" || !draft;
      fc.pre(ready);
      expect(ci.jobs(paths, event, draft)).toEqual({ ...flags, build: flags.today });
    }),
    // Lists where check is off are rare in `list`, so one is pinned: a docs-only ready PR builds nothing.
    { ...options, examples: [[["docs/a.md"], "pull_request", false]] },
  );
});

it("property: a draft keeps lint, typecheck and field as ready, and skips build, test, next and e2e", () => {
  fc.assert(
    fc.property(paths, (paths) => {
      const ready = ci.jobs(paths, "pull_request", false);
      expect(ci.jobs(paths, "pull_request", true)).toEqual({
        check: ready.check,
        typecheck: ready.typecheck,
        field: ready.field,
        today: ready.today,
        build: false,
        test: false,
        next: false,
        e2e: false,
      });
    }),
    options,
  );
});

// 0175 narrowed this law: main no longer runs every job, and the draft flag still changes nothing.
it("property: the draft flag never skips a job on main, which always runs check, typecheck, test, next and field", () => {
  fc.assert(
    fc.property(paths, fc.boolean(), (paths, draft) => {
      const ran = ci.jobs(paths, "push", draft);
      expect(ran).toEqual(ci.jobs(paths, "push", false));
      expect(ran).toMatchObject({ check: true, typecheck: true, test: true, next: true, field: true });
    }),
    options,
  );
});

// 0175: today's own checks (its tests, e2e and build) start only when a file of today's version
// changed, on every event. A file that reruns every test is not one.
const rerun = fc.constantFrom("pnpm-lock.yaml", "package.json", "tsconfig.json", "pnpm-workspace.yaml");

const tooling = fc.oneof(
  script,
  word.map((s) => `.github/ci/${s}.ts`),
  word.map((s) => `oxlint-plugins/${s}.mjs`),
  word.map((s) => `scripts/${s}.ts`),
  fc.constantFrom("vitest.shards.ts", "vitest.config.ts", ".github/workflows/check.yaml"),
);

const elsewhere = fc.oneof(safe, next, prose, tooling, otherSkill, rerun);
const todaysFile = fc.oneof(today, fc.constantFrom("packages/fabrika-design/src/colors.ts", "fixtures/toy/src/a.ts"));
const off = { today: false, e2e: false, build: false };

it("property: a push that touches no file of today's version starts none of today's checks, and still runs the rest", () => {
  fc.assert(
    fc.property(fc.array(elsewhere, { minLength: 1, maxLength: 12 }), (paths) => {
      expect(ci.jobs(paths, "push", false)).toEqual({ ...heavy, field: true, ...off });
    }),
    {
      ...options,
      examples: [
        // pinned: one decision file, the push that ran e2e and every test of today's packages.
        [[".decisions/0175-old-checks-follow-old-files.md"]],
        // pinned: next/ alone.
        [["next/packages/libfabrika/src/a.ts"]],
        // pinned: the lockfile reruns every test, and is still no file of today's version.
        [["pnpm-lock.yaml"]],
      ],
    },
  );
});

it("property: a push that touches a file of today's version starts every job", () => {
  fc.assert(
    fc.property(fc.array(elsewhere, { maxLength: 12 }), todaysFile, (paths, file) => {
      expect(Object.values(ci.jobs([...paths, file], "push", false)).every(Boolean)).toBe(true);
    }),
    options,
  );
});

it("property: a pull request or a merge queue's group of next/ files alone starts none of today's checks", () => {
  fc.assert(
    fc.property(
      fc.array(next, { minLength: 1, maxLength: 12 }),
      fc.constantFrom("pull_request", "merge_group"),
      (paths, event) => {
        expect(ci.jobs(paths, event, false)).toEqual({ ...heavy, test: false, field: false, ...off });
      },
    ),
    options,
  );
});

it("property: a tooling file starts the test job with today's tests off, on a pull request, a merge queue's group and a push", () => {
  fc.assert(
    fc.property(
      fc.array(tooling, { minLength: 1, maxLength: 12 }),
      fc.constantFrom("pull_request", "merge_group", "push"),
      (paths, event) => {
        expect(ci.jobs(paths, event, false)).toMatchObject({ test: true, ...off });
      },
    ),
    options,
  );
});

it("scenario: plain Markdown under today's trees is no file of today's version", () => {
  // scenario: an app's README is read by no check, so it starts none of today's, on any event.
  expect(ci.jobs(["apps/fabrika/README.md"], "pull_request", false)).toMatchObject({ test: false, ...off });
  expect(ci.jobs(["apps/fabrika/README.md"], "push", false)).toMatchObject({ test: true, ...off });
});

// 0174 narrowed this law: the group no longer runs every job, and it is still never a draft.
it("property: a merge queue's group runs what a ready pull request runs, and ignores the draft flag", () => {
  fc.assert(
    fc.property(paths, fc.boolean(), (paths, draft) => {
      expect(ci.jobs(paths, "merge_group", draft)).toEqual(ci.jobs(paths, "pull_request", false));
    }),
    {
      ...options,
      examples: [
        // pinned: a code group with the draft flag set, where a draft pull request would skip test.
        [["apps/fabrika/src/a.ts"], true],
        // pinned: a group of Markdown alone builds nothing, as a ready docs-only pull request.
        [["docs/a.md"], true],
      ],
    },
  );
});

it("scenario: a merge queue's group reads its paths from its base, as a push does", () => {
  const calls: string[][] = [];
  const run: Runner = (args) => {
    calls.push(args);
    return { status: 0, stdout: "docs/a.md\0" };
  };
  expect(ci.readPaths("b".repeat(40), "c".repeat(40), "merge_group", run)).toEqual(["docs/a.md"]);
  expect(calls).toEqual([["diff", "--no-renames", "--name-only", "-z", "b".repeat(40), "c".repeat(40), "--"]]);
});
