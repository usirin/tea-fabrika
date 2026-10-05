import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { type Issue, testNames } from "./issue.ts";
import { checkoutToy, localRepo, localWorkspace, TOY_BASE } from "./local.ts";
import { Repo, Workspace } from "./services.ts";
import { TESTS_FILE } from "./tests.ts";

/** Run one Workspace call against a real checkout. */
const using = <A, E>(dir: string, call: (workspace: Workspace["Service"]) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* call(yield* Workspace);
    }).pipe(Effect.provide(localWorkspace(dir, { test: ["node", "--test"] }))),
  );

const fixed = `export function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/ +/g, "-");
}
`;

describe("a local repo", () => {
  const git = (dir: string, ...args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, encoding: "utf8" }).trim();
  const repo = <A, E>(dir: string, call: (r: Repo["Service"]) => Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* call(yield* Repo);
      }).pipe(Effect.provide(localRepo(dir, { test: ["node", "--test"], base: TOY_BASE }))),
    );
  /** Someone else's work landing in the base while the lane runs: a commit on `main`, made in a folder of its own. */
  const landElsewhere = (dir: string, file: string, text: string) => {
    const other = `${dir}-other`;
    git(dir, "worktree", "add", "-q", other, TOY_BASE);
    execFileSync("node", ["-e", `require("node:fs").writeFileSync(${JSON.stringify(file)}, ${JSON.stringify(text)})`], { cwd: other });
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", "someone else's work");
    git(dir, "worktree", "remove", "--force", other);
  };
  /** A lane whose fix passed its checks, ready to ship. */
  const readyLane = async () => {
    const toy = await checkoutToy("slugify");
    await using(toy.dir, (w) => w.prepare(toy.issue));
    await writeFile(join(toy.dir, "slugify.js"), fixed);
    await using(toy.dir, (w) => w.check());
    return toy.dir;
  };

  it("seals the change without moving the lane's branch, and lands it in the base", async () => {
    const dir = await readyLane();
    const lane = git(dir, "rev-parse", "HEAD");

    const { head, stat } = await repo(dir, (r) => r.seal("slugify makes slugs"));
    const landed = await repo(dir, (r) => r.land(head));

    expect(stat).toContain("slugify.js");
    expect(landed).toEqual({ kind: "landed", sha: head });
    expect(git(dir, "rev-parse", TOY_BASE)).toBe(head);
    expect(git(dir, "rev-parse", "HEAD")).toBe(lane);
  });

  it("merges with a base that moved, and the merge passes its tests on a fresh copy", async () => {
    const dir = await readyLane();
    const { head } = await repo(dir, (r) => r.seal("slugify makes slugs"));
    landElsewhere(dir, "README.md", "someone else's readme\n");

    const behind = await repo(dir, (r) => r.land(head));
    const merged = await repo(dir, (r) => r.catchUp(head));
    const merge = merged.kind === "merged" ? merged.head : "";
    const retested = await repo(dir, (r) => r.retest(merge));
    const landed = await repo(dir, (r) => r.land(merge));

    expect(behind).toEqual({ kind: "behind" });
    expect(merged.kind).toBe("merged");
    expect(retested.passed).toBe(true);
    expect(landed).toEqual({ kind: "landed", sha: merge });
    // The base holds both: the change and the work that landed first.
    expect(git(dir, "show", `${TOY_BASE}:README.md`)).toBe("someone else's readme");
    expect(git(dir, "show", `${TOY_BASE}:slugify.js`)).toContain("replace(/ +/g");
  });

  it("names the files that conflict with a base that moved", async () => {
    const dir = await readyLane();
    const { head } = await repo(dir, (r) => r.seal("slugify makes slugs"));
    landElsewhere(dir, "slugify.js", "export function slugify(title) {\n  return title.trim();\n}\n");

    const merged = await repo(dir, (r) => r.catchUp(head));

    expect(merged).toEqual({ kind: "conflicted", files: ["slugify.js"] });
    // Nothing moved: the base is still the other work.
    expect(git(dir, "log", "-1", "--format=%s", TOY_BASE)).toBe("someone else's work");
  });
});

describe("a local workspace", () => {
  it("writes the issue's tests, and every one fails on the untouched stub", async () => {
    const toy = await checkoutToy("slugify");
    const prepared = await using(toy.dir, (w) => w.prepare(toy.issue));

    expect(prepared.passing).toEqual([]);
    expect([...prepared.failing].sort()).toEqual([...testNames(toy.issue)].sort());
  });

  it("puts a changed test back, says so, and keeps it out of the diff", async () => {
    const toy = await checkoutToy("slugify");
    await using(toy.dir, (w) => w.prepare(toy.issue));
    await writeFile(join(toy.dir, "slugify.js"), fixed);
    const original = await readFile(join(toy.dir, TESTS_FILE), "utf8");
    await writeFile(join(toy.dir, TESTS_FILE), "// emptied by the builder\n");

    const checked = await using(toy.dir, (w) => w.check());

    expect(checked.touched).toEqual([TESTS_FILE]);
    expect(await readFile(join(toy.dir, TESTS_FILE), "utf8")).toBe(original);
    expect(checked.passed).toBe(true);
    expect(checked.diff).toContain("slugify.js");
    expect(checked.diff).not.toContain(TESTS_FILE);
  });

  it("fails a fresh copy of a change that needs a file git ignores, and leaves the folder as it was", async () => {
    const toy = await checkoutToy("slugify");
    await using(toy.dir, (w) => w.prepare(toy.issue));
    // The fix keeps its pattern in a file git is told to ignore: it is there in the folder only.
    await writeFile(join(toy.dir, ".gitignore"), "local-pattern.js\n");
    await writeFile(join(toy.dir, "local-pattern.js"), "export const NOT_SLUG = /[^a-z0-9 ]/g;\n");
    await writeFile(
      join(toy.dir, "slugify.js"),
      fixed
        .replace("/[^a-z0-9 ]/g", "NOT_SLUG")
        .replace("export function", 'import { NOT_SLUG } from "./local-pattern.js";\nexport function'),
    );
    const head = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: toy.dir, encoding: "utf8" });
    const before = head();

    const checked = await using(toy.dir, (w) => w.check());
    const fresh = await using(toy.dir, (w) => w.freshCheck());

    expect(checked.passed).toBe(true);
    expect(fresh.passed).toBe(false);
    expect(fresh.output).toContain("local-pattern.js");
    // The branch did not move, so the diff still reads from where the work started.
    expect(head()).toBe(before);
    expect((await using(toy.dir, (w) => w.check())).diff).toContain("slugify.js");
  });

  it("installs what the tests need into a fresh copy before running them", async () => {
    const toy = await checkoutToy("slugify");
    const ws = (install?: readonly [string, ...string[]]) =>
      localWorkspace(toy.dir, { test: ["node", "--test"], ...(install === undefined ? {} : { install }) });
    const run = <A, E>(layer: ReturnType<typeof ws>, call: (w: Workspace["Service"]) => Effect.Effect<A, E>) =>
      Effect.runPromise(Effect.gen(function* () { return yield* call(yield* Workspace); }).pipe(Effect.provide(layer)));
    await run(ws(), (w) => w.prepare(toy.issue));
    // A stand-in for a package: ignored by git, made by the install step, needed by the fix.
    await writeFile(join(toy.dir, ".gitignore"), "vendor/\n");
    const makeVendor = `require("node:fs").mkdirSync("vendor");require("node:fs").writeFileSync("vendor/pattern.js","export const NOT_SLUG = /[^a-z0-9 ]/g;\\n")`;
    execFileSync("node", ["-e", makeVendor], { cwd: toy.dir });
    await writeFile(
      join(toy.dir, "slugify.js"),
      fixed
        .replace("/[^a-z0-9 ]/g", "NOT_SLUG")
        .replace("export function", 'import { NOT_SLUG } from "./vendor/pattern.js";\nexport function'),
    );
    await run(ws(), (w) => w.check());

    const without = await run(ws(), (w) => w.freshCheck());
    const withInstall = await run(ws(["node", "-e", makeVendor]), (w) => w.freshCheck());
    const brokenInstall = await run(ws(["node", "-e", "process.exit(1)"]), (w) =>
      w.freshCheck().pipe(Effect.match({ onSuccess: () => "ran", onFailure: (error) => error._tag })),
    );

    expect(without.passed).toBe(false);
    expect(withInstall.passed).toBe(true);
    // An install that fails is not the change's fault: the lane parks instead of sending it back.
    expect(brokenInstall).toBe("could_not_run");
  });

  it("passes a fresh copy of a change that git holds whole", async () => {
    const toy = await checkoutToy("slugify");
    await using(toy.dir, (w) => w.prepare(toy.issue));
    await writeFile(join(toy.dir, "slugify.js"), fixed);

    await using(toy.dir, (w) => w.check());
    const fresh = await using(toy.dir, (w) => w.freshCheck());

    expect(fresh).toMatchObject({ passed: true });
  });

  it("reports an example whose call does not parse as neither passing nor failing", async () => {
    const toy = await checkoutToy("slugify");
    const broken: Issue = {
      ...toy.issue,
      criteria: [
        ...toy.issue.criteria,
        { kind: "example", id: "broken", rule: "x", file: "slugify.js", name: "slugify", examples: [{ call: `slugify("a"`, result: `"a"` }] },
      ],
    };
    const prepared = await using(toy.dir, (w) => w.prepare(broken));
    const ran = new Set([...prepared.passing, ...prepared.failing]);

    // A call that does not parse takes the whole file down with it.
    expect(testNames(broken).filter((name) => !ran.has(name))).toContain(`broken: slugify("a"`);
  });
});
