// The freeze guard (decision 0525). Covers freeze.mjs, with frozen.mjs's list. The guard's own
// answer is written apart here: a path is frozen when it starts with one of the four roots and is
// not in the design package both versions share.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as fc from "fast-check";
import { afterAll, expect, it } from "vitest";
import { readEntries, refused } from "./freeze.mjs";

const options = { seed: 119120, numRuns: 200 };
const FREEZE = fileURLToPath(new URL("./freeze.mjs", import.meta.url));

/** The guard's answer for one path, written apart from frozen.mjs. */
const frozenPath = (path: string) =>
  /^(?:apps|programs|packages|bin)\//.test(path) && !path.startsWith("packages/fabrika-design/");

const segment = fc.stringMatching(/^[a-z0-9][a-z0-9._-]{0,10}$/);
const tail = fc.array(segment, { minLength: 1, maxLength: 4 }).map((parts) => parts.join("/"));

const root = fc.constantFrom(
  "apps/",
  "programs/",
  "packages/",
  "bin/",
  "packages/fabrika-design/",
  "next/",
  "next/apps/",
  ".github/ci/",
  "oxlint-plugins/",
  "fixtures/",
  "docs/",
  "",
  "appsx/",
  "packages-old/",
  "packages/fabrika-design-old/",
);

const path = fc.tuple(root, tail).map(([at, rest]) => `${at}${rest}`);
const status = fc.constantFrom("A", "M", "D", "T", "C");
const entry = fc.record({ status, path });

it("F1: the guard refuses exactly the entries that are not deletes on a frozen path, in their order", () => {
  fc.assert(
    fc.property(fc.array(entry, { maxLength: 20 }), (entries) => {
      expect(refused(entries)).toEqual(entries.filter((e) => e.status !== "D" && frozenPath(e.path)));
    }),
    {
      ...options,
      // pinned: the plan's traced pull request, an edit, a delete, a move in and a design change.
      examples: [
        [
          [
            { status: "M", path: "programs/counter/src/view.ts" },
            { status: "D", path: "programs/counter/src/view.test.ts" },
            { status: "D", path: "next/x.ts" },
            { status: "A", path: "apps/fabrika/x.ts" },
            { status: "M", path: "packages/fabrika-design/src/themes.ts" },
          ],
        ],
      ],
    },
  );
});

const frozenRoot = fc.constantFrom("apps/", "programs/", "packages/", "bin/", "packages/fabrika-design/");

it("F2: a delete is never refused, at any path", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.oneof(
          fc.tuple(frozenRoot, tail).map(([at, rest]) => `${at}${rest}`),
          path,
        ),
        { minLength: 1, maxLength: 20 },
      ),
      (paths) => {
        expect(refused(paths.map((p) => ({ status: "D", path: p })))).toEqual([]);
      },
    ),
    options,
  );
});

it("F3: the design package is never refused, and a folder whose name only starts the same is", () => {
  const suffix = fc.stringMatching(/^[a-z0-9._-]{1,8}$/);
  fc.assert(
    fc.property(tail, suffix, status, (rest, more, how) => {
      fc.pre(how !== "D");
      expect(refused([{ status: how, path: `packages/fabrika-design/${rest}` }])).toEqual([]);
      const lookalike = { status: how, path: `packages/fabrika-design${more}/${rest}` };
      expect(refused([lookalike])).toEqual([lookalike]);
      const other = { status: how, path: `packages/fabrikadesign/${rest}` };
      expect(refused([other])).toEqual([other]);
    }),
    options,
  );
});

const temps: string[] = [];

afterAll(() => {
  for (const at of temps) {
    rmSync(at, { recursive: true, force: true });
  }
});

/** A throwaway repo outside this checkout, with its own history. */
const repo = () => {
  const at = mkdtempSync(join(tmpdir(), "freeze-"));
  temps.push(at);
  const git = (...args: string[]) => {
    const out = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
      cwd: at,
      encoding: "utf8",
    });
    expect(out.status, out.stderr).toBe(0);
    return out.stdout.trim();
  };
  const put = (file: string, text: string) => {
    mkdirSync(dirname(join(at, file)), { recursive: true });
    writeFileSync(join(at, file), text);
  };
  git("init", "-q", "-b", "main");
  return { at, git, put, head: () => git("rev-parse", "HEAD") };
};

const guard = (at: string, base: string, head: string, event = "push") =>
  spawnSync(process.execPath, [FREEZE], {
    cwd: at,
    encoding: "utf8",
    env: { ...process.env, BASE: base, HEAD: head, EVENT: event, GITHUB_STEP_SUMMARY: "" },
  });

it("F4: scenario: a move into a frozen path fails the guard and names the new path; a move out of one passes", () => {
  // scenario: renames are what `--no-renames` exists for, so a real git history is the input.
  const r = repo();
  r.put("next/x.ts", "export const x = 1;\n");
  r.put("apps/fabrika/old.ts", "export const old = 1;\n");
  r.git("add", "-A");
  r.git("commit", "-q", "-m", "one");
  const first = r.head();
  r.git("mv", "next/x.ts", "apps/fabrika/x.ts");
  r.git("commit", "-q", "-m", "in");
  const moved = r.head();
  const into = guard(r.at, first, moved, "pull_request");
  expect(into.status).toBe(1);
  expect(`${into.stdout}${into.stderr}`).toContain("frozen: A apps/fabrika/x.ts");
  expect(`${into.stdout}${into.stderr}`).not.toContain("next/x.ts");
  r.git("mv", "apps/fabrika/old.ts", "next/old.ts");
  r.git("commit", "-q", "-m", "out");
  const out = guard(r.at, moved, r.head(), "pull_request");
  expect(out.status, `${out.stdout}${out.stderr}`).toBe(0);
  expect(
    readEntries(moved, r.head(), "push", (args) => {
      const ran = spawnSync("git", args, { cwd: r.at, encoding: "utf8" });
      return { status: ran.status, stdout: ran.stdout };
    }),
  ).toEqual([
    { status: "D", path: "apps/fabrika/old.ts" },
    { status: "A", path: "next/old.ts" },
  ]);
});

it("F5: scenario: main exits 1 naming every refused path, 0 on deletes alone, 1 on a base that is no SHA", () => {
  // scenario: the three ends of main, each on a real history.
  const r = repo();
  r.put("programs/counter/src/view.ts", "export const v = 1;\n");
  r.put("programs/counter/src/view.test.ts", "export const t = 1;\n");
  r.put("bin/tsh", "#!/bin/sh\n");
  r.git("add", "-A");
  r.git("commit", "-q", "-m", "one");
  const first = r.head();
  r.put("programs/counter/src/view.ts", "export const v = 2;\n");
  r.put("packages/pipeline/new.ts", "export const n = 1;\n");
  r.put("packages/fabrika-design/src/themes.ts", "export const t = 1;\n");
  r.git("rm", "-q", "programs/counter/src/view.test.ts");
  r.git("add", "-A");
  r.git("commit", "-q", "-m", "edit");
  const edited = r.head();
  const red = guard(r.at, first, edited);
  const said = `${red.stdout}${red.stderr}`;
  expect(red.status).toBe(1);
  expect(said).toContain("frozen: M programs/counter/src/view.ts");
  expect(said).toContain("frozen: A packages/pipeline/new.ts");
  expect(said).not.toContain("view.test.ts");
  expect(said).not.toContain("fabrika-design");

  r.git("rm", "-q", "bin/tsh");
  r.git("commit", "-q", "-m", "delete");
  const deleted = guard(r.at, edited, r.head());
  expect(deleted.status, `${deleted.stdout}${deleted.stderr}`).toBe(0);

  for (const base of ["", "--bad", "0".repeat(40), "abc"]) {
    expect(guard(r.at, base, r.head()).status, base).toBe(1);
  }
});
