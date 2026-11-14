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
// 0525: e2e ran today's end-to-end tests, which are gone, so it is off for every input.
const heavy = { check: true, typecheck: true, test: true, next: true, e2e: false };
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

// A file of today's version, which is frozen (0525). Written apart from frozen.mjs.
const today = fc
  .tuple(fc.constantFrom("apps", "programs", "packages/fabrika", "packages/pipeline", "bin"), word)
  .map(([dir, s]) => `${dir}/${s}.ts`);

const next = word.map((s) => `next/packages/libfabrika/src/${s}.ts`);

const shared = fc.oneof(
  word.map((s) => `unknown/${s}`),
  fc.constantFrom(
    "packages/fabrika-design/src/colors.ts",
    "packages-other/file.ts",
    "packs/file.ts",
    "legacy/file.ts",
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

// 0174 narrowed this law: a merge queue's group left it, and follows its paths (below).
// 0175 narrowed it again: a push to main left it too. What stays is every event that has no
// changed paths of its own to read.
it("every event that is no pull request, merge queue's group or push enables every job for every path list", () => {
  fc.assert(
    fc.property(list, fc.constantFrom("workflow_dispatch", "schedule", ""), (paths, event) => {
      expect(ci.classify(paths, event)).toEqual({ ...heavy, field: true });
    }),
    options,
  );
});

// 0174: a merge queue's run starts only the checks its changed files need. 0175: so does a push.
it("property: a merge queue's group and a push get the flags a pull request gets for the same paths", () => {
  fc.assert(
    fc.property(fc.option(list, { nil: null }), fc.constantFrom("merge_group", "push"), (paths, event) => {
      expect(ci.classify(paths, event)).toEqual(ci.classify(paths, "pull_request"));
    }),
    {
      ...options,
      examples: [
        // pinned: Markdown alone, the one-file decision that started 18 of 18 jobs in the queue.
        [[".decisions/0174-a-queue-run-follows-its-paths.md"], "merge_group"],
        // pinned: the same decision file as a push to main, which started every job after its merge.
        [[".decisions/0174-a-queue-run-follows-its-paths.md"], "push"],
        // pinned: next/ alone, where a pull request skips test and e2e.
        [["next/packages/libfabrika/src/a.ts"], "push"],
      ],
    },
  );
});

it("scenario: a merge queue's group of Markdown skips the heavy jobs, and one of next/ files runs check and next", () => {
  // scenario: the two cases named in 0174, written out so the flags are read here and not only
  // compared with a pull request's.
  const quiet = { check: false, typecheck: false, test: false, next: false, e2e: false, field: false };
  expect(ci.jobs(["docs/a.md"], "merge_group", false)).toEqual(quiet);
  expect(ci.jobs(["next/packages/libfabrika/src/a.ts"], "merge_group", false)).toEqual({
    ...heavy,
    test: false,
    field: false,
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
          field: false,
        });
        // A Markdown file beside a script is still script input, even though prose is quiet.
        expect(
          ci.classify(
            scripts.map((path) => path.replace(/\.[^.]+$/, ".md")),
            "pull_request",
          ),
        ).toEqual({ ...heavy, next: false, field: false });
        // 0525: a frozen path, like a skill script, starts no next run.
        const flags = ci.classify([...scripts, ...others], "pull_request");
        expect(flags).toEqual({
          check: true,
          typecheck: true,
          test: true,
          next: others.some((p) => p.startsWith("next/")),
          e2e: false,
          field: false,
        });
      },
    ),
    options,
  );
});

it("other skill-tree paths still run check, typecheck, test and next", () => {
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

it("Markdown a check reads runs check, typecheck, test and next, alone or beside safe paths", () => {
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

it("shared paths run check, typecheck, test and next; adding paths never disables a job", () => {
  fc.assert(
    fc.property(fc.array(path, { minLength: 1, maxLength: 10 }), list, shared, (paths, more, unknown) => {
      expect(ci.classify([unknown], "pull_request")).toMatchObject(heavy);
      expect(ci.classify([...paths, unknown], "pull_request")).toMatchObject(heavy);
      const before = ci.classify(paths, "pull_request");
      const after = ci.classify([...paths, ...more], "pull_request");

      for (const key of ["check", "typecheck", "test", "next", "e2e", "field"] as const) {
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
        expect(ci.classify(fresh, "pull_request")).toMatchObject({ ...heavy, test: false });
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
      expect(ci.classify([commits], "pull_request")).toEqual({ ...heavy, field: false });
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
      expect(ci.classify([`${prefix}/${script}`], "pull_request")).toEqual({ ...heavy, test: false, field: false });

      for (const root of ["next", "docs"]) {
        expect(ci.classify([[root, ...dirs, ".claude/skills", skill].join("/")], "pull_request")).toEqual({
          ...heavy,
          test: root !== "next",
          field: false,
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

it("property: a ready pull request and every other event run what classify says", () => {
  fc.assert(
    fc.property(paths, events, fc.boolean(), (paths, event, draft) => {
      const flags = ci.classify(paths, event);
      const ready = event !== "pull_request" || !draft;
      fc.pre(ready);
      expect(ci.jobs(paths, event, draft)).toEqual(flags);
    }),
    // Lists where check is off are rare in `list`, so one is pinned: a docs-only ready PR.
    { ...options, examples: [[["docs/a.md"], "pull_request", false]] },
  );
});

it("property: a draft keeps lint, typecheck and field as ready, and skips test, next and e2e", () => {
  fc.assert(
    fc.property(paths, (paths) => {
      const ready = ci.jobs(paths, "pull_request", false);
      expect(ci.jobs(paths, "pull_request", true)).toEqual({
        check: ready.check,
        typecheck: ready.typecheck,
        field: ready.field,
        test: false,
        next: false,
        e2e: false,
      });
    }),
    options,
  );
});

// 0175 narrowed this law: main no longer runs every job. A push is still never a draft.
it("property: a push runs what a ready pull request runs for the same paths, and ignores the draft flag", () => {
  fc.assert(
    fc.property(paths, fc.boolean(), (paths, draft) => {
      expect(ci.jobs(paths, "push", draft)).toEqual(ci.jobs(paths, "pull_request", false));
    }),
    {
      ...options,
      // pinned: a push of today's code with the draft flag set, where a draft would skip test.
      examples: [[["apps/fabrika/src/a.ts"], true]],
    },
  );
});

// 0175: the fallbacks. A run that cannot say what changed runs everything, e2e aside (0525).
const everyJob = (flags: Readonly<Record<string, boolean>>) =>
  Object.entries(flags).every(([job, on]) => (job === "e2e" ? !on : on));

it("property: unreadable history, no path at all, or an event with no paths of its own runs every job", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("pull_request", "merge_group", "push"),
      fc.constantFrom(null, []),
      list,
      fc.constantFrom("workflow_dispatch", "schedule", ""),
      fc.boolean(),
      (event, none, paths, other, draft) => {
        expect(everyJob(ci.jobs(none, event, false))).toBe(true);
        expect(everyJob(ci.jobs(paths, other, draft))).toBe(true);
      },
    ),
    options,
  );
});

it("scenario: a push with no commit before it reads no paths, so it runs every job", () => {
  // scenario: a first push has an all-zero `before`, and a hand-started run has none. No git runs.
  const run: Runner = () => {
    throw new Error("git must not run");
  };

  for (const base of ["0".repeat(40), ""]) {
    const read = ci.readPaths(base, "c".repeat(40), "push", run);
    expect(read).toBeNull();
    expect(everyJob(ci.jobs(read, "push", false))).toBe(true);
  }
});

it("property: a push of Markdown no check reads, field rows or skill prose starts no heavy job", () => {
  fc.assert(
    fc.property(fc.array(fc.oneof(safe, prose), { minLength: 1, maxLength: 12 }), (paths) => {
      expect(ci.jobs(paths, "push", false)).toMatchObject(quietJobs);
    }),
    // pinned: one decision file, the push that started every job.
    { ...options, examples: [[[".decisions/0175-every-run-follows-its-paths.md"]]] },
  );
});

// 0525: today's version is frozen, so no job runs for it. A file that reruns every test is
// tooling, not today's version.
const rerun = fc.constantFrom("pnpm-lock.yaml", "package.json", "tsconfig.json", "pnpm-workspace.yaml");

const tooling = fc.oneof(
  script,
  word.map((s) => `.github/ci/${s}.ts`),
  word.map((s) => `oxlint-plugins/${s}.mjs`),
  word.map((s) => `scripts/${s}.ts`),
  fc.constantFrom("vitest.shards.ts", "vitest.config.ts", ".github/workflows/check.yaml"),
);

const elsewhere = fc.oneof(safe, next, prose, tooling, otherSkill, rerun);
const scopedEvent = fc.constantFrom("pull_request", "merge_group", "push");
const quietJobs = { check: false, typecheck: false, test: false, next: false, e2e: false };
const JOBS = ["check", "typecheck", "test", "next", "e2e", "field"];

it("D3: classify and jobs give the six job flags and no other, and e2e is off for every input, unreadable history included", () => {
  fc.assert(
    fc.property(paths, events, fc.boolean(), (paths, event, draft) => {
      for (const flags of [ci.classify(paths, event), ci.jobs(paths, event, draft)]) {
        expect(Object.keys(flags).sort()).toEqual([...JOBS].sort());
        expect(flags.e2e).toBe(false);
      }
    }),
    {
      ...options,
      examples: [
        // pinned: the inputs that ran every job before 0525, e2e included.
        [null, "pull_request", false],
        [[], "push", false],
        [["apps/fabrika/src/a.ts"], "workflow_dispatch", false],
        [["programs/trace/src/a.ts"], "pull_request", false],
      ],
    },
  );
});

it("D3: next skips when every path is quiet, a skill script or a file of today's frozen version, and runs beside any other", () => {
  fc.assert(
    fc.property(
      fc.array(fc.oneof(safe, prose, script, today), { minLength: 1, maxLength: 12 }),
      fc.oneof(
        next,
        tooling.filter((p) => !/^\.agents\/skills\/[^/]+\/scripts\//.test(p)),
        rerun,
      ),
      scopedEvent,
      (paths, other, event) => {
        expect(ci.jobs(paths, event, false).next).toBe(false);
        expect(ci.jobs([...paths, other], event, false).next).toBe(true);
      },
    ),
    {
      ...options,
      // pinned: the design package is shared and live (0456), so it runs next.
      examples: [[["apps/fabrika/src/a.ts"], "packages/fabrika-design/src/colors.ts", "push"]],
    },
  );
});

it("D3: a file of today's frozen version alone runs check, typecheck and test, as any tooling path, and no next", () => {
  fc.assert(
    fc.property(fc.array(today, { minLength: 1, maxLength: 12 }), scopedEvent, (paths, event) => {
      expect(ci.jobs(paths, event, false)).toEqual({ ...heavy, next: false, field: false });
    }),
    options,
  );
});

it("property: a pull request, a merge queue's group or a push of next/ files alone runs check, typecheck and next", () => {
  fc.assert(
    fc.property(fc.array(next, { minLength: 1, maxLength: 12 }), scopedEvent, (paths, event) => {
      expect(ci.jobs(paths, event, false)).toEqual({ ...heavy, test: false, field: false });
    }),
    options,
  );
});

it("property: a tooling file starts the test job, on a pull request, a merge queue's group and a push", () => {
  fc.assert(
    fc.property(
      fc.array(fc.oneof(tooling, rerun), { minLength: 1, maxLength: 12 }),
      fc.constantFrom("pull_request", "merge_group", "push"),
      (paths, event) => {
        expect(ci.jobs(paths, event, false)).toMatchObject({ test: true, e2e: false });
      },
    ),
    options,
  );
});

it("property: a run of paths outside today's version still runs what it ran, e2e aside", () => {
  fc.assert(
    fc.property(fc.array(elsewhere, { minLength: 1, maxLength: 12 }), scopedEvent, (paths, event) => {
      expect(ci.jobs(paths, event, false)).toMatchObject({ e2e: false });
    }),
    {
      ...options,
      examples: [
        // pinned: next/ alone.
        [["next/packages/libfabrika/src/a.ts"], "push"],
        // pinned: the lockfile reruns every test.
        [["pnpm-lock.yaml"], "push"],
      ],
    },
  );
});

it("scenario: plain Markdown under today's trees starts no heavy job", () => {
  // scenario: an app's README is read by no check, on any event.
  expect(ci.jobs(["apps/fabrika/README.md"], "pull_request", false)).toMatchObject(quietJobs);
  expect(ci.jobs(["apps/fabrika/README.md"], "push", false)).toMatchObject(quietJobs);
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
