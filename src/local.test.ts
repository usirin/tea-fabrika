import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { type Issue, testNames } from "./issue.ts";
import { checkoutToy, localWorkspace } from "./local.ts";
import { Workspace } from "./services.ts";
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
