import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { type Given, type Now, carry } from "./carry.ts";
import { makeLaneHome } from "./lane-fixture.ts";
import { LaneHome, LaneWork, laneWork } from "./work.ts";

// Today's version. A yes binds to the diff, not the commit (self-fix PR 10, Part 4;
// docs/direction/a-yes-binds-to-the-diff.md). One pure function answers, for any yes the lane keeps:
//
//   kept     the same head; or the reviewed diff replays cleanly onto the base now to exactly the
//            new tree; or the base's formatter, run on the replayed tree, gives exactly the new tree
//   glance   only `git diff -U0 base head | git patch-id --verbatim` matches
//   stale    everything else
//
// The pure table first, then each case on real git: the lane's own Gather reads `Given` when a yes is
// said (`LaneWork.given(head, onto)`) and `Now` at a later head (`LaneWork.now(given, head)`). Both
// read commits the remote holds under any branch, and fetch first. `onto` is the branch the pull
// request goes into: main, or a parent's branch for a stacked one (165's part 6b).

const A = "a".repeat(40);
const B = "b".repeat(40);
const GIVEN: Given = { head: A, onto: "main", base: "1".repeat(40), diff: "d".repeat(40) };

const now = (over: Partial<Now>): Now => ({
  head: B,
  tree: "7".repeat(40),
  replayed: "conflict",
  formatted: null,
  diff: "e".repeat(40),
  range: "1:  aaaaaaa = 1:  bbbbbbb rule changes",
  ...over,
});

describe("carry, the pure answer", () => {
  it("the same head keeps the yes, whatever else reads", () => {
    expect(carry(GIVEN, now({ head: A }))).toEqual({ _tag: "kept", why: "same_head" });
  });

  it("a clean replay to exactly the new tree keeps it", () => {
    expect(carry(GIVEN, now({ replayed: "7".repeat(40) }))).toEqual({
      _tag: "kept",
      why: "replayed",
    });
  });

  it("the base's formatter giving exactly the new tree keeps it", () => {
    expect(carry(GIVEN, now({ formatted: "7".repeat(40) }))).toEqual({
      _tag: "kept",
      why: "formatted",
    });
  });

  it("only the -U0 diff id matching asks for a glance, with the range-diff", () => {
    const read = now({ diff: GIVEN.diff });
    expect(carry(GIVEN, read)).toEqual({ _tag: "glance", range: read.range });
  });

  it("anything else is stale", () => {
    expect(carry(GIVEN, now({}))).toEqual({ _tag: "stale" });
    // A replay that conflicts, or one that gives another tree, never keeps it.
    expect(carry(GIVEN, now({ replayed: "8".repeat(40) }))).toEqual({ _tag: "stale" });
    expect(carry(GIVEN, now({ formatted: "8".repeat(40) }))).toEqual({ _tag: "stale" });
  });

  it("a clean replay wins over a glance: no question is asked when the tree is the same", () => {
    expect(carry(GIVEN, now({ replayed: "7".repeat(40), diff: GIVEN.diff }))).toEqual({
      _tag: "kept",
      why: "replayed",
    });
  });
});

// ---------------------------------------------------------------- on real git

const IDENTITY = {
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@fabrika.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@fabrika.invalid",
};

/** The toy repository's own formatter: each leading pair of spaces becomes a tab. */
const FORMATTER = {
  path: "fmt.mjs",
  text: [
    'import {readFileSync, writeFileSync} from "node:fs";',
    "for (const file of process.argv.slice(2))",
    '\twriteFileSync(file, readFileSync(file, "utf8").replace(/^(?: {2})+/gm, (s) => "\\t".repeat(s.length / 2)));',
    "",
  ].join("\n"),
};

const README = [
  "# Toy",
  "",
  "| name | what |",
  "|---|---|",
  "| slug | cuts a name on its spaces |",
  "| lower | lowers a name |",
  "",
].join("\n");

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The lane's home over a toy repository, and git in the person's checkout of it, which pushes to the remote. */
const scene = (mainFiles: readonly { readonly path: string; readonly text: string }[] = []) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "carry-")));
  dirs.push(dir);
  const { home, seed } = makeLaneHome({ dir, nodeModules: join(dir, "no-modules"), mainFiles });
  const git = (...args: readonly string[]) =>
    execFileSync("git", args, { cwd: seed, env: { ...process.env, ...IDENTITY }, stdio: "pipe" })
      .toString()
      .trim();
  const write = (files: readonly { readonly path: string; readonly text: string }[]) => {
    for (const { path, text } of files) {
      mkdirSync(dirname(join(seed, path)), { recursive: true });
      writeFileSync(join(seed, path), text);
    }
  };
  /** `files` committed on `branch` as it is now, pushed. Answers the commit. */
  const commit = (
    branch: string,
    files: readonly { readonly path: string; readonly text: string }[],
    message: string,
  ) => {
    git("checkout", "--quiet", branch);
    write(files);
    git("add", "-A");
    git("commit", "--quiet", "-m", message);
    git("push", "--quiet", "--force", "origin", branch);
    return git("rev-parse", "HEAD");
  };
  /** A new branch at `from`. */
  const branch = (name: string, from: string) => git("checkout", "--quiet", "-B", name, from);
  /** `name` moved to `to`, pushed. */
  const reset = (name: string, to: string) => {
    git("checkout", "--quiet", "-B", name, to);
    git("push", "--quiet", "--force", "origin", name);
  };
  /** Main names its formatter: `[format] run`, pushed as a commit of its own. */
  const nameFormatter = () => {
    git("checkout", "--quiet", "main");
    appendFileSync(
      join(seed, ".fabrika", "fabrika.toml"),
      `\n[format]\nrun = ${JSON.stringify(["node", FORMATTER.path, "{files}"])}\n`,
    );
    git("add", "-A");
    git("commit", "--quiet", "-m", "name the formatter");
    git("push", "--quiet", "origin", "main");
  };
  const work = laneWork.pipe(
    Layer.provide(Layer.succeed(LaneHome, { home, checkout: seed, briefs: "", person: "owner" })),
  );
  const run = <A, E>(effect: Effect.Effect<A, E, LaneWork>) => Effect.runPromise(effect.pipe(Effect.provide(work)));
  /** What `carry` says of a yes said at `said` onto `onto`, once the head is `head`, both read by the lane's Gather. */
  const carried = (said: string, head: string, onto = "main") =>
    run(
      Effect.gen(function* () {
        const lane = yield* LaneWork;
        const given = yield* lane.given(said, onto);
        return carry(given, yield* lane.now(given, head));
      }),
    );
  return { seed, git, commit, branch, reset, nameFormatter, run, carried };
};

/** A file in the toy repository, as the pull request writes it. */
const X = (text: string) => ({ path: "src/x.ts", text });

describe("carry, on real git, through the lane's Gather", () => {
  it("the head the yes was said at: kept, same_head", async () => {
    const { branch, commit, carried } = scene();
    branch("pr", "main");
    const a = commit("pr", [X('export const x = "one";\n')], "the change");
    expect(await carried(a, a)).toEqual({ _tag: "kept", why: "same_head" });
  });

  it("records what it read: the head, the branch it goes into, the base it left, and the -U0 verbatim id", async () => {
    const { seed, branch, commit, git, run } = scene();
    branch("pr", "main");
    const a = commit("pr", [X('export const x = "one";\n')], "the change");
    const base = git("merge-base", "origin/main", a);
    const id = execFileSync("git", ["patch-id", "--verbatim"], {
      cwd: seed,
      input: execFileSync("git", ["diff", "-U0", base, a], { cwd: seed }),
    })
      .toString()
      .split(" ")[0];
    const given = await run(Effect.flatMap(LaneWork, (lane) => lane.given(a, "main")));
    expect(given).toEqual({ head: a, onto: "main", base, diff: id });
  });

  // Ticket 117's shape: the exam writer's file landed with spaces, and a person pushed a commit that
  // only formats it. The base's formatter, run on the reviewed diff, gives exactly that tree.
  it("a commit that only formats: kept, formatted", async () => {
    const { branch, commit, nameFormatter, carried } = scene([FORMATTER]);
    nameFormatter();
    branch("pr", "main");
    const a = commit("pr", [X("export function x() {\n  return 1;\n}\n")], "the change");
    const b = commit("pr", [X("export function x() {\n\treturn 1;\n}\n")], "format");
    expect(await carried(a, b)).toEqual({ _tag: "kept", why: "formatted" });
  });

  it("replayed: main moves in another file and the branch is rebased onto it: kept, replayed", async () => {
    const { branch, commit, git, reset, carried } = scene([{ path: "README.md", text: README }]);
    branch("pr", "main");
    const a = commit("pr", [X('export const x = "one";\n')], "the change");
    const moved = commit("main", [{ path: "README.md", text: README.replace("# Toy", "# The toy") }], "main moves");
    reset("pr", moved);
    git("cherry-pick", a);
    git("push", "--quiet", "--force", "origin", "pr");
    const b = git("rev-parse", "HEAD");
    expect(await carried(a, b)).toEqual({ _tag: "kept", why: "replayed" });
  });

  // 165's #35 shape: main changed only the README row above the pull request's own row. The replay
  // conflicts, and the pull request's own lines are the same: a question of meaning, so a glance.
  it("glance: only the README row above the pull request's row changed", async () => {
    const { branch, commit, reset, carried } = scene([{ path: "README.md", text: README }]);
    const row = "| upper | raises a name |";
    branch("pr", "main");
    const a = commit(
      "pr",
      [
        {
          path: "README.md",
          text: README.replace("| lower | lowers a name |\n", `| lower | lowers a name |\n${row}\n`),
        },
      ],
      "add a row",
    );
    const changed = README.replace("| lower | lowers a name |", "| lower | lowers a name, in one form |");
    const moved = commit("main", [{ path: "README.md", text: changed }], "main moves");
    reset("pr", moved);
    const b = commit(
      "pr",
      [
        {
          path: "README.md",
          text: changed.replace(
            "| lower | lowers a name, in one form |\n",
            `| lower | lowers a name, in one form |\n${row}\n`,
          ),
        },
      ],
      "add a row",
    );
    const answer = await carried(a, b);
    expect(answer._tag).toBe("glance");
  });

  describe("stale", () => {
    it("a real one-word change", async () => {
      const { branch, commit, carried } = scene();
      branch("pr", "main");
      const a = commit("pr", [X('export const greeting = "hello";\n')], "the change");
      const b = commit("pr", [X('export const greeting = "goodbye";\n')], "one word");
      expect(await carried(a, b)).toEqual({ _tag: "stale" });
    });

    // Plain `--stable` drops all whitespace, so it would read these two as the same diff.
    it("a YAML key moved out by its indent", async () => {
      const CONFIG = "server:\n  port: 8080\n";
      const { branch, commit, carried } = scene([{ path: "config.yml", text: CONFIG }]);
      branch("pr", "main");
      const a = commit("pr", [{ path: "config.yml", text: `${CONFIG}  debug: true\n` }], "debug");
      const b = commit("pr", [{ path: "config.yml", text: `${CONFIG}debug: true\n` }], "debug");
      expect(await carried(a, b)).toEqual({ _tag: "stale" });
    });

    // 165's part 6b, case 3a, smallest: a child stacked on its parent's branch. The parent gets a
    // commit that changes a line the child changed, and the restack keeps the child's side. Read
    // against main, nothing looks changed; read against the parent, the child now undoes its line.
    it("165's 6b smallest: a restack that undoes the parent's new line", async () => {
      const FILE = {
        path: "src/lines.txt",
        text: "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n",
      };
      const { branch, commit, git, reset, carried } = scene([FILE]);
      branch("parent", "main");
      const p1 = commit(
        "parent",
        [{ path: FILE.path, text: FILE.text.replace("eight", "eight, parent") }],
        "the parent",
      );
      branch("child", p1);
      const child = FILE.text.replace("eight", "eight, parent").replace("two", "two, child");
      const c = commit("child", [{ path: FILE.path, text: child }], "the child");
      commit(
        "parent",
        [
          {
            path: FILE.path,
            text: FILE.text.replace("eight", "eight, parent").replace("two", "two, parent"),
          },
        ],
        "the parent's new line",
      );
      // The restack, resolved with the child's side: the child's tree, now on the parent's new tip.
      reset("child", git("rev-parse", "origin/parent"));
      const restacked = commit("child", [{ path: FILE.path, text: child }], "the child");
      expect(await carried(c, restacked, "parent")).toEqual({ _tag: "stale" });
    });

    // The formatter comes from the base. Here the pull request also rewrites the formatter so that,
    // run from the head, it would write the new line itself and excuse the edit.
    it("a pull request that changes the formatter so that it excuses an edit", async () => {
      const { branch, commit, nameFormatter, carried } = scene([FORMATTER]);
      nameFormatter();
      const SAFE = "export function x() {\n\treturn 1;\n}\n";
      const EXCUSE = [
        'import {readFileSync, writeFileSync} from "node:fs";',
        "for (const file of process.argv.slice(2)) {",
        '\tif (file.endsWith("fmt.mjs")) writeFileSync(file, readFileSync(new URL(import.meta.url), "utf8"));',
        '\telse if (!readFileSync(file, "utf8").includes("danger();"))',
        '\t\twriteFileSync(file, readFileSync(file, "utf8") + "danger();\\n");',
        "}",
        "",
      ].join("\n");
      branch("pr", "main");
      const a = commit(
        "pr",
        [X(SAFE), { path: FORMATTER.path, text: `${FORMATTER.text}// kept as it is\n` }],
        "the change",
      );
      const b = commit("pr", [X(`${SAFE}danger();\n`), { path: FORMATTER.path, text: EXCUSE }], "format");
      expect(await carried(a, b)).toEqual({ _tag: "stale" });
    });
  });

  // The known catch: no id and no replay sees it. Main renames a function the pull request calls, the
  // replay is clean, and `carry` keeps the yes. What stops the merge is code's checks at the final
  // head, which run after every carry: ship's gate ends `send:builder:checks_red` on red checks
  // before it reads any approval (stages/ship/gate.ts, pinned in gate.test.ts).
  it("the known catch: main renames a function the pull request calls, and carry still says kept", async () => {
    const LIB = { path: "src/lib.ts", text: "export function old(): number {\n\treturn 1;\n}\n" };
    const { branch, commit, git, reset, carried } = scene([LIB]);
    branch("pr", "main");
    const a = commit(
      "pr",
      [{ path: "src/caller.ts", text: 'import {old} from "./lib.ts";\n\nexport const n = old();\n' }],
      "call it",
    );
    const moved = commit("main", [{ path: LIB.path, text: LIB.text.replace("old", "renamed") }], "rename it");
    reset("pr", moved);
    git("cherry-pick", a);
    git("push", "--quiet", "--force", "origin", "pr");
    expect(await carried(a, git("rev-parse", "HEAD"))).toEqual({ _tag: "kept", why: "replayed" });
  });
});
