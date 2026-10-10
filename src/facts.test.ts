import { execFileSync } from "node:child_process";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { localFacts, tiersOf } from "./code-facts.ts";
import { declares, type FactsPack, factsBrief, mentionsOf, signatureAt } from "./facts.ts";
import { Facts } from "./services.ts";

describe("what a report mentions", () => {
  it("reads names, paths and refs the way #558's report writes them", () => {
    const report = [
      "## Summary",
      "`run` lets a pure machine leave `ctx` out, but `replay` still makes the caller pass one.",
      "`replay` in `packages/tea/src/runtime-types.ts` types its options as `{ msgs: readonly M[]; ctx: Ctx }`.",
      "`run` takes `CtxArg<Ctx>`, which makes `ctx` optional (#182). The tutorial had to keep `replay(downloader, { msgs, ctx: undefined })`.",
      "`docs/how-to/replay-in-a-test.md` writes the same call.",
      "- `packages/tea/src/run-ctxless.test.ts`",
      "- #182, #545",
      "<sub>Filed by an agent · session `b550718d-741c-464f-9f2f-84a3ec4eda15` · branch `build/545-first-tutorial-setup-fa7e5d8f`</sub>",
    ].join("\n");

    expect(mentionsOf(report)).toEqual({
      names: ["run", "ctx", "replay", "CtxArg"],
      paths: ["packages/tea/src/runtime-types.ts", "docs/how-to/replay-in-a-test.md", "packages/tea/src/run-ctxless.test.ts"],
      refs: ["#182", "#545"],
    });
  });

  it("finds a path outside backticks, and leaves a URL, a keyword and a one-letter name alone", () => {
    const text = "See src/greet.ts:12 and https://example.com/a/b.ts, with `true`, `x`, `undefined` and `greet()`.";

    expect(mentionsOf(text)).toEqual({ names: ["greet"], paths: ["src/greet.ts"], refs: [] });
  });

  it("keeps a folder only when it ends in a slash, so a branch name is not read as a path", () => {
    expect(mentionsOf("`packages/tea/docs/` and `umut/some-branch`").paths).toEqual(["packages/tea/docs/"]);
  });
});

describe("a declaration, read by hand", () => {
  it("knows a declaration of the name from a use of it", () => {
    expect(declares("export function replay<S>(m: M): S {", "replay")).toEqual({ exported: true });
    expect(declares("export type CtxArg<Ctx> = [Ctx];", "CtxArg")).toEqual({ exported: true });
    expect(declares("  const ctx = makeCtx();", "ctx")).toEqual({ exported: false });
    expect(declares("export async function* runAll() {", "runAll")).toEqual({ exported: true });
    expect(declares("return replay(machine, opts);", "replay")).toBeNull();
    expect(declares("export function replayAll() {", "replay")).toBeNull();
  });

  it("is the declaration up to its body, on one line: a return type is kept, a type parameter's braces open nothing", () => {
    const text = [
      "/** Replay a machine. */",
      "export function replay<",
      "  S,",
      "  M extends { type: string },",
      ">(",
      "  machine: Machine<S, M>, // the machine",
      "  opts: { msgs: readonly M[]; ctx: Ctx },",
      "): {",
      "  state: S;",
      "} {",
      "  return run(machine);",
      "}",
    ].join("\n");

    expect(signatureAt(text, 2)).toBe(
      "export function replay<S, M extends {type: string}>(machine: Machine<S, M>, opts: {msgs: readonly M[]; ctx: Ctx}): {state: S;}",
    );
    expect(signatureAt("export type A<C> = [C] extends [never]\n  ? { a?: C }\n  : { a: C };\nconst x = 1;", 1)).toBe(
      "export type A<C> = [C] extends [never] ? {a?: C} : {a: C};",
    );
    expect(signatureAt("export const add = (a: number, b: number): number => {\n  return a + b;\n};", 1)).toBe(
      "export const add = (a: number, b: number): number =>",
    );
    expect(signatureAt(`export const long = "${"x".repeat(400)}";`, 1, 40)).toHaveLength(40);
  });
});

describe("a package's tier table", () => {
  it("reads a backticked subpath and its tier, and nothing else", () => {
    const text = ["| Subpath | Tier |", "|---|---|", "| `.` | stable | core |", "| `./jev` | battery | |", "| not a subpath | x |"].join("\n");

    expect([...tiersOf(text)]).toEqual([
      [".", "stable"],
      ["./jev", "battery"],
    ]);
  });
});

describe("the facts pack, as the enricher reads it", () => {
  it("says what was found, and what was not, one short block per name and one line per path", () => {
    const pack: FactsPack = {
      names: [
        {
          name: "greet",
          definitions: [
            {
              file: "src/greet.ts",
              line: 4,
              exported: true,
              signature: "export function greet(name: string): Greeting",
              package: "@toy/greet",
              published: [{ subpath: ".", tier: "stable" }],
              callers: { total: 3, sample: ["src/extra.ts:4", "src/extra.ts:8"] },
            },
          ],
          more: 0,
          mentionedIn: 3,
        },
        { name: "ctx", definitions: [], more: 52, mentionedIn: 239 },
        { name: "nope", definitions: [], more: 0, mentionedIn: 0 },
      ],
      paths: [
        { path: "src/greet.ts", exists: true, near: [] },
        { path: "greet.ts", exists: false, near: ["src/greet.ts"] },
      ],
      refs: ["#1"],
    };

    expect(factsBrief(pack).split("\n")).toEqual([
      '- `greet`: src/greet.ts:4, exported, in @toy/greet, published as "." (stable)',
      "    export function greet(name: string): Greeting",
      "    callers: 3, e.g. src/extra.ts:4, src/extra.ts:8, and 1 more",
      "- `ctx`: nothing exports it; declared locally in 52 places, a common local name; the word is in 239 file(s)",
      "- `nope`: nothing at HEAD declares it; the word is in 0 file(s)",
      "- `src/greet.ts`: exists",
      "- `greet.ts`: not at HEAD; maybe `src/greet.ts`",
      "- also referenced: #1 (not read)",
    ]);
  });
});

/** The facts fixture checked out into a fresh git repo, committed: what HEAD holds. */
async function factsRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tea-fabrika-facts-"));
  await cp(join(import.meta.dirname, "..", "fixtures", "facts", "repo"), dir, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  return dir;
}

const gather = (dir: string, text: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* Facts).gather(mentionsOf(text));
    }).pipe(Effect.provide(localFacts(dir))),
  );

describe("facts from a repo at HEAD, with git and code-graph", () => {
  it("finds where each name is declared, its signature, its callers and the subpaths that publish it", { timeout: 60_000 }, async () => {
    const dir = await factsRepo();
    const pack = await gather(
      dir,
      "`greet` in `packages/greet/src/greet.ts` returns a `Greeting`; `hidden` and `shout` too; `nope` is gone; see `greet.ts` and `packages/greet/src/missing.ts` (#3).",
    );
    const byName = Object.fromEntries(pack.names.map((n) => [n.name, n]));

    expect(byName.greet?.definitions).toEqual([
      {
        file: "packages/greet/src/greet.ts",
        line: 4,
        exported: true,
        signature: "export function greet(name: string, options: {loud?: boolean} = {}): Greeting",
        package: "@toy/greet",
        // `./extra` uses greet and does not re-export it.
        published: [{ subpath: ".", tier: "stable" }],
        callers: { total: 2, sample: ["packages/greet/src/extra.ts:4", "packages/greet/src/extra.ts:8"] },
      },
    ]);
    // A type: published, and out of the call graph.
    expect(byName.Greeting?.definitions[0]).toMatchObject({ line: 1, published: [{ subpath: ".", tier: "stable" }], callers: null });
    // Exported from its file, published by no subpath.
    expect(byName.hidden?.definitions[0]).toMatchObject({ exported: true, published: [], callers: { total: 0 } });
    // A local helper: shown, not checked for publication.
    expect(byName.shout?.definitions[0]).toMatchObject({ exported: false, published: null, line: 8 });
    expect(byName.nope).toEqual({ name: "nope", definitions: [], more: 0, mentionedIn: 0 });
    expect(pack.paths).toEqual([
      { path: "packages/greet/src/greet.ts", exists: true, near: [] },
      { path: "greet.ts", exists: false, near: ["packages/greet/src/greet.ts"] },
      { path: "packages/greet/src/missing.ts", exists: false, near: [] },
    ]);
    expect(pack.refs).toEqual(["#3"]);
  });

  it("leaves callers and publication unknown when code-graph is off, and still finds the rest", async () => {
    const dir = await factsRepo();
    const pack = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* Facts).gather({ names: ["greet"], paths: [], refs: [] });
      }).pipe(Effect.provide(localFacts(dir, { codeGraph: false }))),
    );

    expect(pack.names[0]?.definitions[0]).toMatchObject({ line: 4, package: "@toy/greet", published: null, callers: null });
  });

  it("fails as a whole outside a git repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tea-fabrika-not-git-"));
    const failed = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* (yield* Facts).gather({ names: ["greet"], paths: [], refs: [] });
      }).pipe(
        Effect.provide(localFacts(dir)),
        Effect.match({ onSuccess: () => "gathered", onFailure: (e) => e._tag }),
      ),
    );

    expect(failed).toBe("facts_failed");
  });
});
