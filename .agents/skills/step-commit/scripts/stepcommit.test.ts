// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../lead/scripts/mutbox.ts?raw";
import "../../lead/scripts/mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../lead/scripts/mutbox.Dockerfile?raw";
import "../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/limit.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/sample.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/scope.ts?raw";
import "./stepcommit.sh?raw";
import "../../lead/scripts/leakgrep.sh?raw";
import "./exam.py?raw";
import "../../plan/scripts/plancheck.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../lead/scripts/sizecap.ts?raw";
import "../../lead/scripts/box.sh?raw";
import "../../lead/scripts/keepruns.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../lead/scripts/drive.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../lead/scripts/pgrep.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../lead/scripts/agents.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../lead/scripts/codexexec.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../lead/scripts/boxnode.ts?raw";
import "../../lead/scripts/fieldrow.py?raw";
import "../../lead/scripts/runplan.sh?raw";
import "../../lead/scripts/env.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../lead/scripts/gc.ts?raw";
import "../../lead/scripts/redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../lead/scripts/botpush.mjs?raw";
import "../../lead/scripts/clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../lead/scripts/lane.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../../../exam-paths.json?raw";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

// Today's tooling. Git and oxfmt are real. Signing is recorded by a local stub: K1's real-key
// properties test the signatures; K4 tests which changes may reach a commit at all.
const root = resolve(import.meta.dirname, "../../../..");
const script = join(import.meta.dirname, "stepcommit.sh");
const word = fc.stringMatching(/^[a-z][a-z0-9]{1,8}$/);
const options = { seed: 321, numRuns: 3, endOnFailure: true };

const each = <A>(values: readonly A[], check: (value: A) => void) => {
  const errors: Error[] = [];

  for (const value of values) {
    try {
      check(value);
    } catch (cause) {
      errors.push(
        new Error(`${JSON.stringify(value)}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause }),
      );
    }
  }

  if (errors.length) {
    throw new AggregateError(errors, errors.map((e) => e.message).join("\n"));
  }
};

type Owner = "tests" | "build" | "lead" | "mutation";

/** gh's answer to stepcommit's open-PR query. */
const open = (nodes: unknown[], totalCount = nodes.length) => ({
  data: { repository: { pullRequests: { totalCount, nodes } } },
});

const put = (path: string, value: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
};

const withRepo = (owners: Array<[string, string]>, f: (r: Repo) => void) => {
  const r = new Repo(owners);

  try {
    f(r);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
};

class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), "sc321-"));
  readonly boxes = join(this.dir, "boxes");
  readonly repo = join(this.boxes, "one");
  readonly env: NodeJS.ProcessEnv;
  readonly base: string;

  constructor(owners: Array<[string, string]>) {
    const bin = join(this.dir, "bin");
    mkdirSync(this.repo, { recursive: true });
    mkdirSync(bin);
    this.env = {
      HOME: this.dir,
      PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      TMPDIR: this.dir,
      MAIN: this.repo,
      BOXES: this.boxes,
      FABRIKA_COAUTHOR: "Person <person@example.test>",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.test",
      GIT_COMMITTER_NAME: "fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.test",
      T321_CALLS: join(this.dir, "calls"),
      T321_OXFMT: join(root, "node_modules/.bin/oxfmt"),
      T390_PRS: join(this.dir, "prs.json"),
    };
    const stub = String.raw`
const fs=require("node:fs"),cp=require("node:child_process");
const args=process.argv.slice(2);
fs.appendFileSync(process.env.T321_CALLS,JSON.stringify(args)+"\n");
if(args[0]==="commits"&&args[1]==="sign") process.exit(0);
if(args[0]==="exec"&&args[1]==="oxfmt") {
 const r=cp.spawnSync(process.env.T321_OXFMT,args.slice(2),{encoding:"utf8"});
 process.stdout.write(r.stdout||""); process.stderr.write(r.stderr||""); process.exit(r.status??2);
}
console.error("fixture refuses package or network command"); process.exit(97);
`;
    writeFileSync(join(bin, "pnpm"), `#!${process.execPath}\n${stub}`, { mode: 0o755 });
    // gh answers the open-PR query from T390_PRS, a JSON file (no file: no open PRs; "fail": exit 1).
    const gh = String.raw`
const fs=require("node:fs");
fs.appendFileSync(process.env.T321_CALLS,JSON.stringify(["gh",...process.argv.slice(2)])+"\n");
const f=process.env.T390_PRS;
const prs=f&&fs.existsSync(f)?fs.readFileSync(f,"utf8"):JSON.stringify({data:{repository:{pullRequests:{totalCount:0,nodes:[]}}}});
if(prs.trim()==="fail"){console.error("gh: offline");process.exit(1);}
process.stdout.write(prs);
`;
    writeFileSync(join(bin, "gh"), `#!${process.execPath}\n${gh}`, { mode: 0o755 });
    symlinkSync(join(root, "node_modules/.bin/oxfmt"), join(bin, "oxfmt"));
    this.git("init", "-q", "-b", "fabrikalfa/one", `--separate-git-dir=${join(this.dir, "gitdata")}`);
    put(join(this.repo, "exam-paths.json"), readFileSync(join(root, "exam-paths.json"), "utf8"));
    put(join(this.repo, ".oxfmtrc.json"), '{"useTabs":true,"printWidth":100}\n');

    for (const path of [
      "src/owned.ts",
      "src/owned.tsx",
      "src/foreign.ts",
      "src/old.ts",
      ".agents/skills/lead/scripts/fixture.test.ts",
    ]) {
      put(join(this.repo, path), 'export const value = "before";\n');
    }

    this.git("add", "--all");
    this.git("commit", "-q", "-m", "base");
    this.base = this.git("rev-parse", "HEAD").trim();
    const body = `# Today's tooling\n\n\`\`\`text\ncommit -> fetch\n\`\`\`\n\n## Files\n| File | Owner step |\n| --- | --- |\n${owners.map(([path, owner]) => `| ${path} | ${owner} |`).join("\n")}\n\n## Laws\n| Law | Generator | Plant |\n| --- | --- | --- |\n| holds | fc.record: paths | break |\n\n## Size\n1 agent hour. Confidence: 90%.\n\n## What it records\nCommits.\n\n## What it cannot tell us\nNo live run.\n\n## Open questions\nNone.\n`;
    const hash = createHash("sha256").update(body).digest("hex");
    const plan = join(this.dir, "plan.md");
    put(
      plan,
      `Approved by the lead agent, builds the decided note; body ${hash.slice(0, 12)}\nPlancheck-Version: 2\n${body}`,
    );
    put(
      join(this.boxes, "state/one.box"),
      `ticket: 321\nbranch: fabrikalfa/one\nbase: ${this.base}\nplan: ${plan}\nplan-sha256: ${hash}\n`,
    );
  }

  call(cmd: string, args: string[]) {
    const r = spawnSync(cmd, args, {
      cwd: this.repo,
      env: this.env,
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(r.error).toBeUndefined();
    return { code: r.status, text: r.stdout + r.stderr, stdout: r.stdout };
  }

  git(...args: string[]) {
    const r = this.call("/usr/bin/git", args);
    expect(r.code, r.text).toBe(0);
    return r.stdout;
  }

  commit(step: Owner, paths: string[], only = false) {
    return this.call("sh", [
      script,
      ...(only ? ["--commit-only"] : []),
      step,
      "321",
      `T321 ${step}: fixture`,
      ...paths,
    ]);
  }

  changed(path: string, text = 'export const value = "changed";\n') {
    put(join(this.repo, path), text);
  }

  signs(): string[][] {
    return existsSync(join(this.dir, "calls"))
      ? readFileSync(join(this.dir, "calls"), "utf8")
          .trim()
          .split("\n")
          .map((s) => JSON.parse(s))
          .filter((a: string[]) => a[0] === "commits")
      : [];
  }

  asked(): boolean {
    return existsSync(join(this.dir, "calls")) && readFileSync(join(this.dir, "calls"), "utf8").includes('["gh",');
  }

  /** An open PR on `branch` whose one commit carries a note for `ticket`. */
  openPr(branch: string, ticket: string) {
    this.git("notes", "--ref=fabrika", "add", "-f", "-m", JSON.stringify({ step: "build", ticket }), this.base);
    put(
      join(this.dir, "prs.json"),
      JSON.stringify(
        open([
          {
            number: 609,
            headRefName: branch,
            commits: { totalCount: 1, nodes: [{ commit: { oid: this.base } }] },
          },
        ]),
      ),
    );
  }
}

describe("T321 K4 named paths, ownership and format, today's tooling", () => {
  // Plants: read the first .box on the branch; read a stale file whose box folder is gone.
  // themes tests, 2026-11-09: a stale themes-tests3.box on the same branch, with an old plan
  // hash, refused the commits of the box that was really running.
  it("K4 reads the facts of the box it runs in, never a stale box on the same branch", () => {
    each(["own", "stale-only", "live-other"] as const, (kind) =>
      withRepo([["src/owned.ts", "tests"]], (r) => {
        const facts = readFileSync(join(r.boxes, "state/one.box"), "utf8");
        const stale = facts.replace(/plan-sha256: .*/, `plan-sha256: ${"0".repeat(64)}`);

        for (const name of ["a", "b", "c", "zz"]) {
          put(join(r.boxes, `state/${name}.box`), stale);
        }

        if (kind !== "own") {
          rmSync(join(r.boxes, "state/one.box"));
        }

        if (kind === "live-other") {
          mkdirSync(join(r.boxes, "live"));
          put(join(r.boxes, "state/live.box"), facts);
        }

        r.changed("src/owned.ts");
        const got = r.commit("tests", ["src/owned.ts"]);
        // stale-only: no live box on the branch, so there is no plan to check, as outside a box.
        expect(got.code, got.text).toBe(0);
        expect(got.text).not.toMatch(/hash mismatch/);
      }),
    );
  });

  // scenario: a case-only rename, as a box agent leaves one on a Mac's disk (ticket 573): git keeps
  // the index's old name, so without care the commit still holds `src/old.ts`. Plants: skip the
  // old entry's removal; drop a tracked file whose name only looks alike.
  it("scenario: a case-only rename, with or without a text change, commits the new name and drops the old", () => {
    each(["same text", "new text"] as const, (kind) =>
      withRepo(
        [
          ["src/old.ts", "tests"],
          ["src/Old.ts", "tests"],
        ],
        (r) => {
          const text = readFileSync(join(r.repo, "src/old.ts"), "utf8");
          rmSync(join(r.repo, "src/old.ts"));
          r.changed("src/Old.ts", kind === "same text" ? text : 'export const value = "moved";\n');
          const got = r.commit("tests", ["src/Old.ts"]);
          expect(got.code, got.text).toBe(0);
          const tree = r.git("ls-tree", "-r", "--name-only", "HEAD", "--", "src").trim().split("\n");
          expect(tree).toContain("src/Old.ts");
          expect(tree).not.toContain("src/old.ts");
          expect(tree).toContain("src/owned.ts");
          expect(r.git("diff", "--cached", "--name-only")).toBe("");
        },
      ),
    );
  });

  // Plant: drop the staged-index refusal. Both routes must preserve the index and checkout.
  it("K4 refuses an occupied index with exit 4 before staging or signing", () => {
    fc.assert(
      fc.property(word, (name) => {
        each([false, true], (only) =>
          withRepo(
            [
              ["src/owned.ts", "tests"],
              ["src/foreign.ts", "tests"],
            ],
            (r) => {
              r.changed("src/foreign.ts", `export const value = "staged-${name}";\n`);
              r.git("add", "--", "src/foreign.ts");
              r.changed("src/owned.ts");
              const index = r.git("write-tree");
              const diff = r.git("diff");
              const got = r.commit("tests", ["src/owned.ts"], only);
              expect(got.code, got.text).toBe(4);
              expect(r.git("rev-parse", "HEAD").trim()).toBe(r.base);
              expect(r.git("write-tree")).toBe(index);
              expect(r.git("diff")).toBe(diff);
              expect(r.signs()).toEqual([]);
            },
          ),
        );
      }),
      { ...options, seed: 119120 },
    );
  });

  // Plant: match owners by prefix, allowing owned.tsx via the owned.ts row; skip unknown paths.
  it("K4 commits only paths owned by this step, including normalized ./ names", () => {
    fc.assert(
      fc.property(
        word,
        fc.constantFrom("tests" as Owner, "build" as Owner, "lead" as Owner),
        fc.boolean(),
        (name, step, dot) => {
          each(["owned", "foreign", "prefix", "unknown"], (kind) =>
            withRepo(
              [
                ["src/owned.ts", step],
                ["src/foreign.ts", step === "tests" ? "build" : "tests"],
              ],
              (r) => {
                const path =
                  kind === "owned"
                    ? "src/owned.ts"
                    : kind === "foreign"
                      ? "src/foreign.ts"
                      : kind === "prefix"
                        ? "src/owned.tsx"
                        : `src/${name}-unknown.ts`;
                r.changed(path);
                const got = r.commit(step, [(dot ? "./" : "") + path]);
                expect(got.code).not.toBeNull();

                if (kind === "owned") {
                  expect(got.code, got.text).toBe(0);
                  expect(r.git("show", "--format=", "--name-only", "HEAD").trim()).toBe(path);
                } else {
                  expect(got.code, got.text).not.toBe(0);
                  expect(got.text).toMatch(/not_owner|owner|unknown/);
                  expect(r.git("rev-parse", "HEAD").trim()).toBe(r.base);
                  expect(r.signs()).toEqual([]);
                }
              },
            ),
          );
        },
      ),
      options,
    );
  });

  // Plant: exact-only lookup (refuses a shot under the docs/ row), a plain string prefix
  // (docs/shots/ also owning docs/shotsx/), or a '..' part escaping the row.
  it("K4 a row ending in / owns every file under it, and nothing beside it", () => {
    fc.assert(
      fc.property(word, fc.constantFrom("tests" as Owner, "build" as Owner, "lead" as Owner), (name, step) => {
        each(["under", "deeper", "beside", "escape"], (kind) =>
          withRepo(
            [
              ["docs/shots/", step],
              ["src/foreign.ts", step === "tests" ? "build" : "tests"],
            ],
            (r) => {
              const path =
                kind === "under"
                  ? `docs/shots/${name}.png`
                  : kind === "deeper"
                    ? `docs/shots/${name}/one.png`
                    : kind === "beside"
                      ? `docs/shotsx/${name}.png`
                      : "docs/shots/../src/foreign.ts";
              r.changed(kind === "escape" ? "src/foreign.ts" : path);
              const got = r.commit(step, [path]);
              expect(got.code).not.toBeNull();

              if (kind === "under" || kind === "deeper") {
                expect(got.code, got.text).toBe(0);
                expect(r.git("show", "--format=", "--name-only", "HEAD").trim()).toBe(path);
              } else {
                expect(got.code, got.text).not.toBe(0);
                expect(r.git("rev-parse", "HEAD").trim()).toBe(r.base);
                expect(r.signs()).toEqual([]);
              }
            },
          ),
        );
      }),
      options,
    );
  });

  // Plant: accept folders or '.', silently include an unrelated edit, or let -A become an option.
  it("K4 refuses dot, -A and folders before staging anything", () => {
    fc.assert(
      fc.property(word, (name) => {
        each([".", "-A", "src", "./src/", `src/${name}/`], (path) =>
          withRepo(
            [
              ["src/owned.ts", "tests"],
              ["-A", "tests"],
            ],
            (r) => {
              r.changed("src/owned.ts");
              r.changed("-A");
              r.changed(`src/${name}/other.ts`);
              const got = r.commit("tests", [path]);
              expect(got.code, got.text).not.toBe(0);
              expect(got.text).toMatch(/named|path|folder|directory/);
              expect(r.git("rev-parse", "HEAD").trim()).toBe(r.base);
              expect(r.git("diff", "--cached", "--name-only")).toBe("");
            },
          ),
        );
      }),
      options,
    );
  });

  // Plant: ask the file system whether a path is a folder. Review round 1, finding 8: with no
  // .box state, a deleted src/ is no folder on disk, so "src" committed every deletion under it.
  it("K4 refuses a folder git tracks even after its files are deleted, in both modes", () => {
    fc.assert(
      fc.property(fc.constantFrom("src", "./src"), fc.boolean(), (path, only) =>
        withRepo([["src/owned.ts", "tests"]], (r) => {
          rmSync(join(r.boxes, "state/one.box"));
          rmSync(join(r.repo, "src"), { recursive: true });
          const got = r.commit("tests", [path], only);
          expect(got.code, got.text).not.toBe(0);
          expect(got.text).toMatch(/named|folder/);
          expect(r.git("rev-parse", "HEAD").trim()).toBe(r.base);
          expect(r.git("diff", "--cached", "--name-only")).toBe("");
        }),
      ),
      { ...options, numRuns: 4 },
    );
  });

  // Plant: check the working file instead of the staged bytes, or skip staged formatting.
  it("K4 refuses unformatted staged content and accepts formatted content", () => {
    fc.assert(
      fc.property(word, (name) => {
        each([false, true], (formatted) =>
          withRepo([["src/owned.ts", "tests"]], (r) => {
            r.changed(
              "src/owned.ts",
              formatted ? `export const value = "${name}";\n` : `export   const value={name:'${name}',other: 1}\n`,
            );
            const got = r.commit("tests", ["src/owned.ts"]);
            expect(got.code, got.text).toBe(formatted ? 0 : 1);

            if (!formatted) {
              expect(got.text).toMatch(/not_formatted|format/);
              expect(r.git("rev-parse", "HEAD").trim()).toBe(r.base);
              expect(r.signs()).toEqual([]);
            }
          }),
        );
      }),
      options,
    );
  });

  // Plant: run oxfmt against the working file, ignoring the bytes git add actually staged.
  it("K4 a formatted working file cannot hide unformatted staged bytes", () => {
    fc.assert(
      fc.property(word, (name) => {
        each([false, true], (only) =>
          withRepo([["src/owned.ts", "tests"]], (r) => {
            const filter = join(r.dir, "unformat");
            writeFileSync(
              filter,
              `#!${process.execPath}\nprocess.stdout.write(${JSON.stringify(`export   const value={name:'${name}'}\n`)});\n`,
              { mode: 0o755 },
            );
            r.git("config", "filter.fixture.clean", filter);
            r.git("config", "filter.fixture.required", "true");
            put(join(r.repo, ".gitattributes"), "src/owned.ts filter=fixture\n");
            r.changed("src/owned.ts", `export const value = "${name}";\n`);
            const got = r.commit("tests", ["src/owned.ts"], only);
            expect(got.code, got.text).not.toBe(0);
            expect(got.text).toMatch(/not_formatted|format/);
            expect(r.git("rev-parse", "HEAD").trim()).toBe(r.base);
            expect(r.signs()).toEqual([]);
          }),
        );
      }),
      options,
    );
  });

  // Plant: inspect only rename destinations, skip deleted paths, or validate one path at a time.
  it("K4 refuses mixed owners and checks deletion plus both rename sides before commit", () => {
    fc.assert(
      fc.property(fc.constantFrom("mixed", "delete", "rename", "exam-rename"), (kind) => {
        const exam = ".agents/skills/lead/scripts/fixture.test.ts";
        withRepo(
          [
            ["src/owned.ts", "build"],
            ["src/foreign.ts", "tests"],
            ["src/old.ts", "tests"],
            ["src/new.ts", "build"],
            [exam, "build"],
          ],
          (r) => {
            r.changed("src/owned.ts");
            let paths = ["src/owned.ts", "src/foreign.ts"];

            if (kind === "mixed") {
              r.changed("src/foreign.ts");
            } else if (kind === "delete") {
              rmSync(join(r.repo, "src/old.ts"));
              paths = ["src/old.ts"];
            } else {
              const from = kind === "exam-rename" ? exam : "src/old.ts";
              r.git("mv", from, "src/new.ts");
              r.git("restore", "--staged", "--", from, "src/new.ts");
              paths = [from, "src/new.ts"];
            }

            const got = r.commit("build", paths);
            expect(got.code, got.text).not.toBe(0);
            expect(got.text).toMatch(/not_owner|owner|exam/);
            expect(r.git("rev-parse", "HEAD").trim()).toBe(r.base);
            expect(r.signs()).toEqual([]);
          },
        );
      }),
      // pinned: the plants where K4's owner check lets a path through: one side of a rename,
      // its exam-path form, a deletion and mixed owners.
      { ...options, numRuns: 4, examples: [["rename"], ["exam-rename"], ["delete"], ["mixed"]] },
    );
  });

  // Plant: --commit-only skips the gates, signs anyway, or makes more than one commit.
  // T321, 2026-11-08: all 30 repos took 69 s alone. Allow 180 s on the shared laptop;
  // keep the run count, input sizes and fresh repo per case.
  it("K4 --commit-only shares every gate and makes one unsigned commit; legacy calls still sign", () => {
    fc.assert(
      fc.property(word, (name) => {
        each([false, true], (only) =>
          each(["owned", "foreign", "folder", "format", "exam"], (kind) => {
            const exam = ".agents/skills/lead/scripts/fixture.test.ts";
            withRepo(
              [
                ["src/owned.ts", "build"],
                ["src/foreign.ts", "tests"],
                [exam, "build"],
              ],
              (r) => {
                const path = kind === "foreign" ? "src/foreign.ts" : kind === "exam" ? exam : "src/owned.ts";
                r.changed(
                  path,
                  kind === "format" ? `export const value={name:'${name}'}\n` : `export const value = "${name}";\n`,
                );
                const got = r.commit("build", [kind === "folder" ? "src" : path], only);
                expect(got.code).not.toBeNull();

                if (kind === "owned") {
                  expect(got.code, got.text).toBe(0);
                  expect(r.git("rev-list", "--count", `${r.base}..HEAD`).trim()).toBe("1");
                  expect(r.signs()).toHaveLength(only ? 0 : 1);
                } else {
                  expect(got.code, got.text).not.toBe(0);
                  expect(got.text).toMatch(/owner|exam|path|folder|format/);
                  expect(r.git("rev-parse", "HEAD").trim()).toBe(r.base);
                  expect(r.signs()).toEqual([]);
                }
              },
            );
          }),
        );
      }),
      options,
    );
  }, 180_000);

  // Plant: make the new flag an alias for the legacy commit-and-sign path.
  it("K4 --commit-only makes a named owned commit without invoking the signer", () => {
    fc.assert(
      fc.property(word, fc.boolean(), (name, dot) =>
        withRepo([["src/owned.ts", "tests"]], (r) => {
          r.changed("src/owned.ts", `export const value = "${name}";\n`);
          const got = r.commit("tests", [dot ? "./src/owned.ts" : "src/owned.ts"], true);
          expect(got.code, got.text).toBe(0);
          expect(r.git("rev-list", "--count", `${r.base}..HEAD`).trim()).toBe("1");
          expect(r.signs()).toEqual([]);
        }),
      ),
      options,
    );
  });
});

describe("T390 a lead link never lands on another branch's open PR ticket, today's tooling", () => {
  // Plants: drop the check; compare the branch without its -wip; check --commit-only or other
  // steps; pass when gh cannot be read. PRs 609, 614, 615 and 617, 2026-11-09: field-row PRs signed
  // lead under a lane's ticket, and the lane's own lead links read as stale_link.
  it("T390 refuses a signed lead commit exactly when another branch's open PR holds the ticket", () => {
    // scenario: every head place for a signed lead commit on the PR's ticket, then one change at a
    // time (another ticket, another step, --commit-only), since sampling missed the -wip plant.
    type Case = {
      where: "other" | "same" | "own-wip" | "none";
      ticket: string;
      step: Owner;
      only: boolean;
    };
    const lead = { ticket: "321", step: "lead" as Owner, only: false };
    const cases: Case[] = [
      ...(["other", "same", "own-wip", "none"] as const).map((where) => ({ ...lead, where })),
      { ...lead, where: "other", ticket: "999" },
      { ...lead, where: "other", step: "build" },
      { ...lead, where: "other", only: true },
    ];
    each(cases, ({ where, ticket, step, only }) =>
      withRepo([["src/owned.ts", step]], (r) => {
        const head = {
          other: "fabrikalfa/lane",
          same: "fabrikalfa/one",
          "own-wip": "fabrikalfa/one-wip",
        };

        if (where !== "none") {
          r.openPr(head[where], ticket);
        }

        r.changed("src/owned.ts");
        const got = r.commit(step, ["src/owned.ts"], only);
        const refused = step === "lead" && !only && where === "other" && ticket === "321";

        if (refused) {
          expect(got.code, got.text).toBe(5);
          expect(got.text).toContain("stale_link: ticket 321's open PR 609 is on fabrikalfa/lane");
          expect(got.text).toContain("Sign under a lead ticket");
          expect(r.git("rev-parse", "HEAD").trim()).toBe(r.base);
          expect(r.git("diff", "--cached", "--name-only")).toBe("");
          expect(r.signs()).toEqual([]);
        } else {
          expect(got.code, got.text).toBe(0);
          expect(r.signs()).toHaveLength(only ? 0 : 1);
        }

        expect(r.asked()).toBe(step === "lead" && !only);
      }),
    );
  }, 180_000);

  // scenario: gh fails, more than 100 open PRs, or a PR with more than 250 commits.
  it("T390 refuses a signed lead commit when open PRs cannot be read whole", () => {
    const commits = { totalCount: 251, nodes: [] };
    each(
      [
        "fail\n",
        JSON.stringify(open([], 101)),
        JSON.stringify(open([{ number: 1, headRefName: "fabrikalfa/lane", commits }])),
      ],
      (answer) =>
        withRepo([["src/owned.ts", "lead"]], (r) => {
          put(join(r.dir, "prs.json"), answer);
          r.changed("src/owned.ts");
          const got = r.commit("lead", ["src/owned.ts"]);
          expect(got.code, got.text).toBe(5);
          expect(got.text).toContain("open PRs cannot be read");
          expect(r.git("rev-parse", "HEAD").trim()).toBe(r.base);
          expect(r.signs()).toEqual([]);
        }),
    );
  });
});
