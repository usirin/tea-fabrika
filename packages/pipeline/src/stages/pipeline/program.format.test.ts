import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ledger, streams } from "@kampus/fabrika-old";
import { Duration, Effect, Fiber, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryLedger } from "../../asks/ledger.ts";
import { hashOf, textOf } from "../../tickets/approval.ts";
import { factsOf, nameOf } from "../../tickets/ticket.ts";
import { Tickets, ticketsOnLedger } from "../../tickets/tickets.ts";
import { fakeEnv, makeLaneHome } from "./lane-fixture.ts";
import { laneLayer, runLane } from "./layer.ts";

// Today's version. Before a build round, an exam file that fails the repository's format check gets a
// code commit of its own, so the builder starts on it and its own diff never holds it. On ticket 117 the
// test writer's file failed the check, and the builder may not change an exam file: lint stayed red for
// every round. Self-fix PR 1.
//
// One ticket through the whole lane, as the lane tests run it (./lane-harness.ts): the real
// machines over the fake `codex`, real git on a bare remote, real vitest and Stryker. Main names its formatter only after round
// 1's build, as ticket 117's restart would find it, so round 1's test is still as its writer wrote it.

const MODULES = fileURLToPath(new URL("../../../node_modules", import.meta.url));
const BRIEFS = fileURLToPath(new URL("../../../../../programs/pipeline/briefs", import.meta.url));
const OWNER = "user:owner";
const NUMBER = 1;

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

const EXAM = "src/lower.test.ts";

const SPACES =
  'import {expect, it} from "vitest";\nimport {lower} from "./lower.ts";\n\nit("lowers capitals", () => {\n  expect(lower("AB")).toBe("ab");\n});\n';

/** What the formatter makes of `SPACES`. */
const TABS =
  'import {expect, it} from "vitest";\nimport {lower} from "./lower.ts";\n\nit("lowers capitals", () => {\n\texpect(lower("AB")).toBe("ab");\n});\n';

const ROUND_2_TEST = "p1: folds ß to ss";

/** Round 2: a review finding, a new test that is red on round 1's head, and the builder's fix. */
const FINDING = {
  kind: "review-code",
  from: { source: "check", name: "tests-prove-it" },
  fault: "ß is kept as it is, so two forms of one name do not match.",
  at: { file: "src/lower.ts", first: 2, last: 2 },
  proof: "Read from the code.",
  wants: "ß folds to ss.",
  seen: "read",
};

const FOLDS = {
  path: "src/lower.ts",
  text: 'export function lower(name: string): string {\n\treturn name.trim().toLowerCase().replaceAll("ß", "ss");\n}\n',
};

/** What the fake `codex` says, as fixtures/pipeline-lane/codex.mjs reads `script.json`. */
const FAKE = {
  answers: {
    // Round 1's writer indents with spaces. Its answers stay the plain ones, which name this file.
    tests: [
      { with: { files: [{ path: EXAM, text: SPACES }] } },
      {
        with: {
          files: [
            {
              path: "src/lower.folds.test.ts",
              text: `import {expect, it} from "vitest";\nimport {lower} from "./lower.ts";\n\nit(${JSON.stringify(ROUND_2_TEST)}, () => {\n\texpect(lower("Straße")).toBe("strasse");\n});\n`,
            },
          ],
          answers: [{ property: "p1", kind: "test", file: "src/lower.folds.test.ts", name: ROUND_2_TEST }],
          plants: [],
          gaps: [],
        },
      },
    ],
    review: [{ with: { findings: [FINDING] } }],
  },
  // Round 2's builder fixes the code, and also formats the exam file itself, as one that ran the
  // repository's formatter would. With the format commit under it, that write changes nothing.
  writesAt: { build: { 1: [FOLDS, { path: EXAM, text: TABS }] } },
};

const IDENTITY = {
  GIT_AUTHOR_NAME: "fixture",
  GIT_AUTHOR_EMAIL: "fixture@fabrika.invalid",
  GIT_COMMITTER_NAME: "fixture",
  GIT_COMMITTER_EMAIL: "fixture@fabrika.invalid",
};

/** Main names its formatter: `[format] run`, with `{files}` for the paths, pushed as a commit of its own. */
const nameFormatter = (seed: string, formatter = FORMATTER.path) => {
  appendFileSync(
    join(seed, ".fabrika", "fabrika.toml"),
    `\n[format]\nrun = ${JSON.stringify(["node", formatter, "{files}"])}\n`,
  );
  const git = (...args: readonly string[]) =>
    execFileSync("git", args, { cwd: seed, env: { ...process.env, ...IDENTITY }, stdio: "pipe" });
  git("add", "-A");
  git("commit", "--quiet", "-m", "name the formatter");
  git("push", "--quiet", "origin", "main");
};

const read = Effect.gen(function* () {
  return yield* (yield* Tickets).read(NUMBER);
}).pipe(Effect.provide(ticketsOnLedger({ kind: "agent", id: "reader", for: "owner" })));

const file = Effect.gen(function* () {
  const ledger = yield* Ledger;
  yield* ledger.register(nameOf(NUMBER), OWNER);
  yield* ledger.send(streams(nameOf(NUMBER)).inbox, `file-${NUMBER}`, {
    kind: "filed",
    writer: OWNER,
    data: { type: "filed", title: "Read names in one form", body: "Lower case, no spaces around." },
  });
});

/** Answers every ask as a person, with `picks[kind]` or its first pick, until the fiber is stopped. */
const answering = (picks: Readonly<Record<string, string>>) =>
  Effect.gen(function* () {
    const ledger = yield* Ledger;
    const done = new Set<string>();

    for (;;) {
      const ticket = yield* read;

      for (const entry of ticket.timeline) {
        const fact = entry.fact;

        if (fact.type !== "asked" || done.has(fact.ask)) {
          continue;
        }

        done.add(fact.ask);
        yield* ledger.send(streams(nameOf(NUMBER)).inbox, `answer-${fact.ask}`, {
          kind: "answered",
          writer: OWNER,
          data: {
            type: "answered",
            ask: fact.ask,
            pick: picks[fact.ask.split("-")[1] ?? ""] ?? fact.picks[0],
            note: "",
            text: yield* hashOf(textOf(ticket)),
          },
        });
      }

      yield* Effect.sleep("50 millis");
    }
  });

/** A build's own line: how it ended, and not the reason said after it. */
const builtLine = (said: string) => said.startsWith("build: ") && !said.startsWith("build: why");

describe("an exam file that fails the format check before a build round", () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-fmt-")));
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CODEX_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it(
    "before round 2 gets a code commit, the builder's head is on it, and its diff does not count it as exam_touched",
    { timeout: 300_000 },
    async () => {
      const { home, seed } = makeLaneHome({
        dir,
        nodeModules: MODULES,
        reads: [dirname(dirname(dirname(MODULES)))],
        mainFiles: [FORMATTER],
      });
      writeFileSync(join(dir, "script.json"), JSON.stringify(FAKE));

      for (const [key, value] of Object.entries(fakeEnv(dir))) {
        vi.stubEnv(key, value);
      }

      const lines: string[] = [];
      let named = false;
      const say = (said: string) =>
        Effect.sync(() => {
          lines.push(said);

          if (!named && said.startsWith("build: done")) {
            named = true;
            nameFormatter(seed);
          }
        });
      // Round 2's build is all this needs, so the lane stops once it has ended.
      const over = () =>
        lines.filter(builtLine).length >= 2 || lines.some((said) => said.startsWith(`#${NUMBER} ended`));
      const timeline = await Effect.runPromise(
        Effect.gen(function* () {
          yield* file;
          yield* Effect.forkScoped(answering({ step: "go_on", merge: "no" }));
          const running = yield* Effect.forkScoped(
            runLane(NUMBER, say).pipe(
              Effect.provide(laneLayer({ home, checkout: seed, briefs: BRIEFS, person: "owner" })),
            ),
          );
          yield* Effect.gen(function* () {
            while (!over()) {
              yield* Effect.sleep("50 millis");
            }
          }).pipe(Effect.timeoutOption(Duration.seconds(240)));
          yield* Fiber.interrupt(running);
          return (yield* read).timeline;
        }).pipe(Effect.scoped, Effect.provide(Layer.fresh(memoryLedger().layer))),
      );

      const tree = join(home, "work", "trees", String(NUMBER));
      const git = (...args: readonly string[]) =>
        execFileSync("git", args, { cwd: tree, encoding: "utf8", stdio: "pipe" }).trim();
      const said = lines.join("\n");

      // The writer's commit, then the code's format commit: the builder's head holds both.
      const touching = git("log", "--format=%H", "HEAD", "--", EXAM).split("\n");
      expect(touching, said).toHaveLength(2);
      const [formatted = ""] = touching;
      expect(git("show", "--format=", "--name-only", formatted).split("\n")).toEqual([EXAM]);
      expect(git("show", `${formatted}:${EXAM}`)).toBe(TABS.trim());
      // The builder's own commit is on it, and holds its fix and not the exam file.
      expect(git("rev-parse", "HEAD")).not.toBe(formatted);
      const built = git("show", "--format=", "--name-only", "HEAD").split("\n");
      expect(built).toContain(FOLDS.path);
      expect(built).not.toContain(EXAM);

      const builds = factsOf(timeline, "ended")
        .filter((ended) => ended.stage === "build")
        .map((ended) => JSON.stringify(ended.outcome));
      expect(builds, said).toHaveLength(2);
      expect(builds.filter((outcome) => outcome.includes("exam_touched"))).toEqual([]);
      expect(builds.at(-1)).toContain('"done"');
    },
  );
});

/** The test the fake's mutants answer writes, as fixtures/pipeline-lane/codex.mjs names it. */
const ANSWER = "src/lower-spaces.test.ts";

const ANSWER_SPACES =
  'import {expect, it} from "vitest";\nimport {lower} from "./lower.ts";\n\nit("cuts spaces", () => {\n  expect(lower(" Ab ")).toBe("ab");\n});\n';

/** What the formatter makes of `ANSWER_SPACES`. */
const ANSWER_TABS = ANSWER_SPACES.replace("\n  expect", "\n\texpect");

/**
 * `FORMATTER`, but the first time it is handed `ANSWER` it fails and writes nothing, as one that crashed
 * would. So the answers' own commit keeps the file as written, and only the format after it can fix it.
 * What it has met is kept in `seen`, outside the working copy.
 */
const crashesOnce = (seen: string) => ({
  path: "fmt-once.mjs",
  text: [
    'import {appendFileSync, existsSync, readFileSync, writeFileSync} from "node:fs";',
    'import {normalize} from "node:path";',
    `const seen = ${JSON.stringify(seen)};`,
    "const files = process.argv.slice(2).map((file) => normalize(file));",
    `if (files.includes(${JSON.stringify(ANSWER)}) && !(existsSync(seen) && readFileSync(seen, "utf8").includes(${JSON.stringify(ANSWER)}))) {`,
    `\tappendFileSync(seen, ${JSON.stringify(`${ANSWER}\n`)});`,
    '\tprocess.stderr.write("crashed\\n");',
    "\tprocess.exit(1);",
    "}",
    "for (const file of files)",
    '\twriteFileSync(file, readFileSync(file, "utf8").replace(/^(?: {2})+/gm, (s) => "\\t".repeat(s.length / 2)));',
    "",
  ].join("\n"),
});

describe("a test the mutants' writer adds that fails the format check", () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-fmt-")));
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CODEX_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it("gets a code commit after the answers, and the review is handed that head", { timeout: 300_000 }, async () => {
    const formatter = crashesOnce(join(dir, "seen"));
    const { home, seed } = makeLaneHome({
      dir,
      nodeModules: MODULES,
      reads: [dirname(dirname(dirname(MODULES)))],
      mainFiles: [formatter],
    });
    nameFormatter(seed, formatter.path);
    writeFileSync(
      join(dir, "script.json"),
      JSON.stringify({
        answers: { mutants: [{ with: { files: [{ path: ANSWER, text: ANSWER_SPACES }] } }] },
      }),
    );

    for (const [key, value] of Object.entries(fakeEnv(dir))) {
      vi.stubEnv(key, value);
    }

    const lines: string[] = [];
    const say = (said: string) => Effect.sync(() => void lines.push(said));
    const log = join(dir, "codex.log");
    // The review's brief is all this needs, so the lane stops once the review has started.
    const over = () =>
      (existsSync(log) && readFileSync(log, "utf8").includes('"step":"review"')) ||
      lines.some((said) => said.startsWith(`#${NUMBER} ended`));
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* file;
        yield* Effect.forkScoped(answering({ step: "go_on", merge: "no" }));
        const running = yield* Effect.forkScoped(
          runLane(NUMBER, say).pipe(
            Effect.provide(laneLayer({ home, checkout: seed, briefs: BRIEFS, person: "owner" })),
          ),
        );
        yield* Effect.gen(function* () {
          while (!over()) {
            yield* Effect.sleep("50 millis");
          }
        }).pipe(Effect.timeoutOption(Duration.seconds(240)));
        yield* Fiber.interrupt(running);
      }).pipe(Effect.scoped, Effect.provide(Layer.fresh(memoryLedger().layer))),
    );

    const said = lines.join("\n");
    const tree = join(home, "work", "trees", String(NUMBER));
    const git = (...args: readonly string[]) =>
      execFileSync("git", args, { cwd: tree, encoding: "utf8", stdio: "pipe" }).trim();
    // The answers' commit as written, then the code's format commit, which holds that file alone.
    const touching = git("log", "--format=%H", "HEAD", "--", ANSWER).split("\n");
    expect(touching, said).toHaveLength(2);
    const [formatted = "", answered = ""] = touching;
    expect(git("show", `${answered}:${ANSWER}`)).toBe(ANSWER_SPACES.trim());
    expect(git("show", "--format=", "--name-only", formatted)).toBe(ANSWER);
    expect(git("show", `${formatted}:${ANSWER}`)).toBe(ANSWER_TABS.trim());

    // The review's diff holds the formatted test, not the one as written.
    const review = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((row) => JSON.parse(row) as { readonly step: string; readonly diff: string | null })
      .find((run) => run.step === "review");
    expect(review?.diff, said).toContain('+\texpect(lower(" Ab ")).toBe("ab");');
    expect(review?.diff).not.toContain('+  expect(lower(" Ab ")).toBe("ab");');
  });
});
