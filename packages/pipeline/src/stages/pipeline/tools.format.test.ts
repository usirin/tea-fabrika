import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MutationRunner } from "../mutation/services.ts";
import { TestsWork } from "../test-writer/program.ts";
import { ticketUrlOf } from "./hosts.ts";
import { LANE_REPO, makeLaneHome } from "./lane-fixture.ts";
import { laneTestsWork } from "./tools.ts";
import { LaneHome, LaneWork, laneWork } from "./work.ts";

// Today's version. Code formats what an agent writes before it commits it, with the repository's own
// formatter, as `[format] run` names it. A format slip is not a judgment, so it never costs an agent a
// turn. Self-fix PR 1.

/**
 * The toy repository's own formatter: each leading pair of spaces becomes a tab. It stands for
 * `node oxlint-plugins/format.ts {files}` here, and rewrites the files it is given in place.
 */
const FORMATTER = {
  path: "fmt.mjs",
  text: [
    'import {readFileSync, writeFileSync} from "node:fs";',
    "for (const file of process.argv.slice(2))",
    '\twriteFileSync(file, readFileSync(file, "utf8").replace(/^(?: {2})+/gm, (s) => "\\t".repeat(s.length / 2)));',
    "",
  ].join("\n"),
};

const SPACES =
  'import {expect, it} from "vitest";\nimport {lower} from "./lower.ts";\n\nit("lowers capitals", () => {\n  expect(lower("AB")).toBe("ab");\n});\n';

/** What the formatter makes of `SPACES`. */
const TABS =
  'import {expect, it} from "vitest";\nimport {lower} from "./lower.ts";\n\nit("lowers capitals", () => {\n\texpect(lower("AB")).toBe("ab");\n});\n';

const IDENTITY = {
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@fabrika.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@fabrika.invalid",
};

/** Main names its formatter: `[format] run`, with `{files}` for the paths, pushed as a commit of its own. */
const nameFormatter = (seed: string) => {
  appendFileSync(
    join(seed, ".fabrika", "fabrika.toml"),
    `\n[format]\nrun = ${JSON.stringify(["node", FORMATTER.path, "{files}"])}\n`,
  );
  const git = (...args: readonly string[]) =>
    execFileSync("git", args, { cwd: seed, env: { ...process.env, ...IDENTITY }, stdio: "pipe" });
  git("add", "-A");
  git("commit", "--quiet", "-m", "name the formatter");
  git("push", "--quiet", "origin", "main");
};

describe("what code commits of the test writer's files", () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-fmt-")));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("a test writer's file written with spaces is committed formatted", async () => {
    const { home, seed } = makeLaneHome({
      dir,
      nodeModules: join(dir, "no-modules"),
      mainFiles: [FORMATTER],
    });
    const work = laneWork.pipe(
      Layer.provide(Layer.succeed(LaneHome, { home, checkout: seed, briefs: "", person: "owner" })),
    );
    // The commit runs no test, so a runner that is asked for one is a fault here.
    const runner = Layer.succeed(MutationRunner, {
      tests: () => Effect.die("no test runs in a commit"),
      run: () => Effect.die("no mutant runs in a commit"),
    });
    const committed = await Effect.runPromise(
      Effect.gen(function* () {
        const lane = yield* LaneWork;
        const { base } = yield* lane.tree(1);
        // Named once the copy is made, as on ticket 117: the copy's install read main before.
        yield* Effect.sync(() => nameFormatter(seed));
        const head = yield* (yield* TestsWork).commit(ticketUrlOf(LANE_REPO, 1), base, [
          { path: "src/lower.test.ts", text: SPACES },
        ]);
        return yield* lane.show(head, "src/lower.test.ts");
      }).pipe(Effect.provide(Layer.provideMerge(laneTestsWork, Layer.merge(work, runner)))),
    );
    expect(committed).toBe(TABS);
  });
});
