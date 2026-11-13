// Today's lead tooling. The unlisted check's laws (0134): its edge cases on memory, each one a law
// (pr/Unlisted.ts lists them), then the trial merge on real git in a temp folder. Nothing here asks
// GitHub or touches the checkout.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { type Branch, Branches } from "./Branches.ts";
import * as BranchesGit from "./BranchesGit.ts";
import * as BranchesTest from "./BranchesTest.ts";
import type { PullRequest } from "./PullRequests.ts";
import * as PullRequestsTest from "./PullRequestsTest.ts";
import * as Unlisted from "./Unlisted.ts";

const branch = (name: string, tip: string, location: Branch["location"] = "origin"): Branch => ({
  name,
  location,
  tip,
});

const pr = (number: number, head: string, state: PullRequest["state"], oid = ""): PullRequest => ({
  number,
  head,
  oid,
  state,
  draft: false,
});

const checked = (model: BranchesTest.Model, prs: ReadonlyArray<PullRequest>, failing: PullRequestsTest.Failing = {}) =>
  Unlisted.check().pipe(
    Effect.provide(
      Layer.mergeAll(BranchesTest.layer(model), PullRequestsTest.layer(PullRequestsTest.world(prs), failing)),
    ),
  );

const names = (r: Unlisted.Report) => ({
  unlisted: r.unlisted.map((u) => `${u.branch.location} ${u.branch.name}`),
  landed: r.landed.map((l) => `${l.branch.location} ${l.branch.name}`),
});

describe("the unlisted check's edge cases, each a law (0134, 0040)", () => {
  // scenario: 2, a branch at main's tip, or behind it, holds nothing to keep.
  it.effect("scenario: 2, a branch with no commit that origin/main lacks is not listed", () =>
    Effect.map(checked({ branches: [branch("old", "a")], ahead: { a: 0 }, empty: [] }, []), (r) =>
      expect(names(r)).toEqual({ unlisted: [], landed: [] }),
    ),
  );

  // scenario: 3, the lane's branch and its -wip backup are one lane; one open PR lists both.
  it.effect("scenario: 3, an open PR on the branch or on its lane covers it, draft or not", () => {
    const model = {
      branches: [branch("fabrikalfa/x", "a"), branch("fabrikalfa/x-wip", "b"), branch("fabrikalfa/y", "c")],
      ahead: { a: 2, b: 3, c: 1 },
      empty: [],
    };
    const prs = [pr(1, "fabrikalfa/x", "OPEN"), { ...pr(2, "fabrikalfa/y-wip", "OPEN"), draft: true }];
    return Effect.map(checked(model, prs), (r) => expect(names(r)).toEqual({ unlisted: [], landed: [] }));
  });

  // scenario: 4, a squash merge whose lines main changed later conflicts in a trial merge.
  it.effect("scenario: 4, a MERGED PR on the same name at this very tip is landed, whatever main did since", () =>
    Effect.map(
      checked({ branches: [branch("fabrikalfa/x", "a")], ahead: { a: 4 }, empty: [] }, [
        pr(912, "fabrikalfa/x", "MERGED", "a"),
      ]),
      (r) => {
        expect(names(r)).toEqual({ unlisted: [], landed: ["origin fabrikalfa/x"] });
        expect(Unlisted.lines(r)[0]).toBe("safe to delete: origin fabrikalfa/x, PR 912 merged at this head");
      },
    ),
  );

  // scenario: 5, a cherry-pick or a squash merged under another branch name.
  it.effect("scenario: 5, a branch whose trial merge changes nothing is landed with no PR at all", () =>
    Effect.map(checked({ branches: [branch("y", "b", "local")], ahead: { b: 1 }, empty: ["b"] }, []), (r) => {
      expect(names(r)).toEqual({ unlisted: [], landed: ["local y"] });
      expect(Unlisted.lines(r)[0]).toBe("safe to delete: local y, its changes are on main already");
    }),
  );

  // scenario: 6, a branch pushed again after its PR merged, and one whose PR was closed unmerged.
  it.effect(
    "scenario: 6, commits after a merged PR, or a closed PR, still need a pull request, and it is named",
    () => {
      const model = { branches: [branch("x", "new"), branch("z", "c")], ahead: { new: 1, c: 2 }, empty: [] };
      return Effect.map(checked(model, [pr(5, "x", "MERGED", "old"), pr(6, "z", "CLOSED", "c")]), (r) =>
        expect(Unlisted.lines(r)).toEqual([
          "no pull request: origin x, 1 commit not on main, at new; PR 5 was merged at another head",
          "no pull request: origin z, 2 commits not on main, at c; PR 6 was closed at another head",
          "unlisted: 2 with no pull request, 0 safe to delete",
        ]),
      );
    },
  );

  // scenario: 7, a local branch with commits never pushed, beside its pushed twin.
  it.effect("scenario: 7, the laptop's branch and origin's are two lines, since either can hold more", () => {
    const model = { branches: [branch("x", "a", "local"), branch("x", "b")], ahead: { a: 3, b: 2 }, empty: ["b"] };
    return Effect.map(checked(model, []), (r) =>
      expect(names(r)).toEqual({ unlisted: ["local x"], landed: ["origin x"] }),
    );
  });

  // scenario: 8, git or gh cannot run; the check must not print an empty list it did not read.
  it.effect("scenario: 8, a read that fails fails the whole check", () =>
    Effect.gen(function* () {
      const ok = { branches: [branch("x", "a")], ahead: { a: 1 }, empty: [] };
      const git = yield* Effect.flip(checked({ ...ok, broken: true }, []));
      expect(git._tag).toBe("BranchesError");
      const gh = yield* Effect.flip(checked(ok, [], { all: "gh: offline" }));
      expect(gh._tag).toBe("PullRequestsError");
    }),
  );

  const Name = Schema.Literals(["a", "b", "a-wip", "c"]);
  const Tip = Schema.Literals(["t1", "t2", "t3"]);
  const Count = Schema.Literals([0, 1, 2, 3]);
  const World = Schema.Struct({
    branches: Schema.Array(Schema.Struct({ name: Name, tip: Tip, location: Schema.Literals(["local", "origin"]) })),
    ahead: Schema.Struct({ t1: Count, t2: Count, t3: Count }),
    empty: Schema.Array(Tip),
    prs: Schema.Array(Schema.Struct({ head: Name, oid: Tip, state: Schema.Literals(["OPEN", "CLOSED", "MERGED"]) })),
  });

  it.effect.prop(
    "property: every branch ahead of main with no open PR on its lane is in exactly one list",
    { w: World },
    ({ w }) =>
      Effect.gen(function* () {
        const prs = w.prs.map((p, i) => pr(i + 1, p.head, p.state, p.oid));
        const r = yield* checked(w, prs);
        const openLanes = new Set(prs.filter((p) => p.state === "OPEN").map((p) => Unlisted.laneName(p.head)));
        const due = w.branches.filter((b) => w.ahead[b.tip] > 0 && !openLanes.has(Unlisted.laneName(b.name)));
        const key = (b: Branch) => JSON.stringify([b.name, b.location, b.tip]);
        const found = [...r.unlisted.map((u) => u.branch), ...r.landed.map((l) => l.branch)];
        expect(found.map(key).toSorted()).toEqual(due.map(key).toSorted());
        expect(r.unlisted.every((u) => !w.empty.includes(u.branch.tip as "t1"))).toBe(true);
      }),
  );

  it.prop(
    "property: the last line counts both lists",
    { u: Schema.Literals([0, 1, 2, 4]), l: Schema.Literals([0, 1, 3]) },
    ({ u, l }) => {
      const at = (i: number) => branch(`b${i}`, `t${i}`);
      const r: Unlisted.Report = {
        unlisted: Array.from({ length: u }, (_, i) => ({ branch: at(i), ahead: 1, earlier: null })),
        landed: Array.from({ length: l }, (_, i) => ({ branch: at(i), merged: null })),
      };
      const out = Unlisted.lines(r);
      return out.length === u + l + 1 && out.at(-1) === `unlisted: ${u} with no pull request, ${l} safe to delete`;
    },
  );
});

describe("BranchesGit on real git: the refs it lists and the trial merge", () => {
  // vector: `for-each-ref --format='%(refname) %(objectname)'` lines as git prints them.
  it("vector: 1, main and origin's HEAD are no branch; heads and origin's branches are", () => {
    expect(BranchesGit.fromRefLine("refs/heads/fabrikalfa/x 1a")).toEqual(branch("fabrikalfa/x", "1a", "local"));
    expect(BranchesGit.fromRefLine("refs/remotes/origin/y 2b")).toEqual(branch("y", "2b"));
    expect(BranchesGit.fromRefLine("refs/heads/main 3c")).toBeNull();
    expect(BranchesGit.fromRefLine("refs/remotes/origin/main 3c")).toBeNull();
    expect(BranchesGit.fromRefLine("refs/remotes/origin/HEAD 3c")).toBeNull();
    expect(BranchesGit.fromRefLine("refs/tags/v1 4d")).toBeNull();
    expect(BranchesGit.fromRefLine("")).toBeNull();
  });

  /** A repo where `squashed` was squash-merged, `fresh` holds new work and `clash` conflicts with main. */
  const fixture = (dir: string) => {
    const env = {
      PATH: process.env.PATH ?? "",
      HOME: dir,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.test",
      GIT_COMMITTER_NAME: "fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.test",
    };
    const git = (...args: string[]) => {
      const r = spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout.trim();
    };
    const commit = (file: string, text: string) => {
      writeFileSync(join(dir, file), text);
      git("add", file);
      git("commit", "-q", "-m", file);
      return git("rev-parse", "HEAD");
    };
    git("init", "-q", "-b", "main");
    commit("a.txt", "one\n");
    git("checkout", "-q", "-b", "squashed");
    commit("b.txt", "two\n");
    const squashed = commit("c.txt", "three\n");
    git("checkout", "-q", "main");
    git("merge", "-q", "--squash", "squashed");
    git("commit", "-q", "-m", "squash");
    git("checkout", "-q", "-b", "fresh");
    const fresh = commit("d.txt", "four\n");
    git("checkout", "-q", "-b", "clash", "squashed");
    const clash = commit("b.txt", "two, said again\n");
    git("checkout", "-q", "main");
    // Main moves on in a file the squashed branch never touched.
    commit("a.txt", "one, changed on main\n");
    git("update-ref", "refs/remotes/origin/main", "main");
    return { squashed, fresh, clash };
  };

  // scenario: the three roads the check must tell apart, on a real repo with origin/main.
  it.effect("scenario: a squash-merged branch lands empty; new work, or a conflict with main, does not", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "unl-" });
      const tips = fixture(dir);
      const got = yield* Effect.gen(function* () {
        const branches = yield* Branches;
        return [
          yield* branches.landsEmpty(tips.squashed),
          yield* branches.landsEmpty(tips.fresh),
          yield* branches.landsEmpty(tips.clash),
          yield* branches.ahead(tips.squashed),
        ];
      }).pipe(Effect.provide(BranchesGit.layer(dir)));
      expect(got).toEqual([true, false, false, 2]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
