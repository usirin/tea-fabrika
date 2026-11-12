// BoxTest: the laws of the box command, as suites a world runs (0062). A world makes MAIN and one clean box
// in a fresh temp folder and gives the layers rm runs on: `BoxTest.memory` answers Git and the runs/
// move from memory, `BoxTestGit.world` uses real git and keepruns.sh, so the memory one stays honest.
//
//   BoxTest.rm.suite("memory", BoxTest.memory, run, { numRuns: 300, seed: 119120 })
//
// Each case is a generated plan: one box, then what is planted in it. The oracle below names the
// verdict the old Python rm gave that plan, check by check in its order.
import { Effect, FileSystem, Layer, type Path, type Scope } from "effect";
import type { ChildProcessSpawner } from "effect/process";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { BoxGit } from "./BoxGit.ts";
import * as BoxGitTest from "./BoxGitTest.ts";
import * as Remove from "./Remove.ts";
import type { Runs } from "./Runs.ts";
import * as RunsTest from "./RunsTest.ts";

/** What one case plants in a clean box before rm runs. */
export type Plan = {
  /** The box's own name; `asked` is what rm is given, the same name unless the case plants a bad one. */
  readonly name: string;
  readonly asked: string;
  readonly pair: "both" | "none" | "work-only" | "data-only" | "work-link" | "data-link";
  readonly pointer: "ok" | "outside" | "malformed";
  readonly head: "ok" | "bad";
  readonly shallow: boolean;
  /** An operation's file, such as MERGE_HEAD, beside the ordinary metadata. */
  readonly operation: boolean;
  /** `lost`: a commit only ORIG_HEAD saves. */
  readonly origHead: "none" | "head" | "lost" | "bad";
  readonly reflog: "ok" | "bad";
  readonly fetchHead: "none" | "ok" | "bad";
  readonly index: "plain" | "flagged" | "submodule";
  readonly dirty: boolean;
  /** Whether MAIN keeps the box's tip. */
  readonly retained: boolean;
  readonly failing: "none" | "ls-files" | "status";
  readonly runs: "none" | "moved" | "stuck";
};

/** A made box: where it lives, the commit only ORIG_HEAD can save, and the layers rm runs on. */
export type Made = {
  readonly main: string;
  readonly boxes: string;
  readonly tip: string;
  readonly lost: string;
  readonly layer: Layer.Layer<BoxGit | Runs>;
};

/** What a world and a law need from the platform; the test file provides it. */
type Platform = FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope;

/** Makes MAIN and the clean box `plan.name` under `dir`, with what only it can plant: index, changes, retention. */
export type World = {
  readonly make: (dir: string, plan: Plan) => Effect.Effect<Made, unknown, Platform>;
};

const TIP = "1".repeat(40);
const LOST = "2".repeat(40);
const OTHER = "3".repeat(40);

/** The world in memory: files written by hand, Git and the runs/ move answered from the plan. */
export const memory: World = {
  make: Effect.fnUntraced(function* (dir: string, plan: Plan) {
    const fs = yield* FileSystem.FileSystem;
    const main = `${dir}/main`;
    const boxes = `${dir}/boxes`;
    const work = `${boxes}/${plan.name}`;
    const data = `${work}-gitdata`;

    for (const folder of [
      `${main}/.git/objects`,
      `${main}/.git/refs/heads`,
      `${data}/objects`,
      `${data}/refs/heads`,
      `${data}/logs`,
      work,
    ]) {
      yield* fs.makeDirectory(folder, { recursive: true });
    }

    for (const [path, text] of [
      [`${main}/.git/HEAD`, "ref: refs/heads/main\n"],
      [`${main}/.git/refs/heads/main`, `${plan.retained ? TIP : OTHER}\n`],
      [`${work}/.git`, `gitdir: ${data}\n`],
      [`${work}/tracked`, "base\n"],
      [`${data}/HEAD`, "ref: refs/heads/main\n"],
      [`${data}/index`, "DIRC"],
      [`${data}/config`, "[core]\n"],
      [`${data}/refs/heads/main`, `${TIP}\n`],
      [`${data}/logs/HEAD`, `${"0".repeat(40)} ${TIP} Fixture <fixture@example.test> 0 +0000\tclone\n`],
    ] as const) {
      yield* fs.writeFileString(path, text);
    }

    const flag = { plain: "H", flagged: "h", submodule: "H" }[plan.index];
    const mode = plan.index === "submodule" ? "160000" : "100644";
    const git = BoxGitTest.layer({
      index: [`${flag} ${mode} ${TIP} 0\ttracked`],
      dirty: plan.dirty,
      refs: [
        { ref: "refs/heads/main", oid: TIP },
        { ref: "refs/remotes/origin/main", oid: OTHER },
      ],
      objects: { HEAD: TIP },
      retained: [plan.retained ? TIP : OTHER],
      reachable: plan.retained ? [TIP, OTHER] : [OTHER],
      failing: plan.failing === "none" ? [] : [plan.failing],
    });
    const runs = RunsTest.layer(
      plan.runs === "stuck"
        ? { said: "", kept: false }
        : { said: plan.runs === "moved" ? `kept runs of ${plan.name} at runs/${plan.name}\n` : "", kept: true },
    );
    const layer: Layer.Layer<BoxGit | Runs> = Layer.mergeAll(git, runs);
    return { main, boxes, tip: TIP, lost: LOST, layer };
  }),
};

/** The verdict the old Python rm gave a plan, its checks in their order: the first that holds names it. */
export const expected = (plan: Plan): Remove.Verdict => {
  const kept = (reason: string, code: 1 | 2 = 1) => Remove.Verdict.cases.kept.make({ reason, code });

  if (plan.asked !== plan.name) {
    return kept("invalid name", 2);
  }

  const order: ReadonlyArray<readonly [boolean, string]> = [
    [plan.pair === "work-link" || plan.pair === "data-link", "symlinked target"],
    [plan.pair === "work-only" || plan.pair === "data-only", "missing or invalid pair"],
    [plan.pointer === "malformed", "invalid gitdir pointer"],
    [plan.pointer === "outside", "gitdir pointer does not name this pair"],
    [plan.head === "bad", "unsupported HEAD"],
    [plan.shallow, "unsupported shared, shallow or graft metadata"],
    [plan.operation, "operation, linked worktree or unknown metadata"],
    [plan.origHead === "bad", "unsupported ORIG_HEAD"],
    [plan.reflog === "bad", "unsupported reflog entry"],
    [plan.fetchHead === "bad", "unsupported fetch metadata"],
    [plan.failing === "ls-files", "Git inspection failed"],
    [plan.index === "flagged", "unsupported index flags"],
    [plan.index === "submodule", "unsupported submodule metadata"],
    [plan.failing === "status", "Git inspection failed"],
    [plan.dirty, "tracked changes"],
    [!plan.retained || plan.origHead === "lost", "tip not retained in MAIN"],
    [plan.runs === "stuck", "could not keep its runs/"],
  ];

  if (plan.pair === "none") {
    return Remove.Verdict.cases.absent.make({});
  }

  const first = order.find(([holds]) => holds);
  return first === undefined ? Remove.Verdict.cases.removed.make({}) : kept(first[1]);
};

/** Plant the parts of a plan that are only files, the same in every world. */
const plant = Effect.fnUntraced(function* (dir: string, made: Made, plan: Plan) {
  const fs = yield* FileSystem.FileSystem;
  const work = `${made.boxes}/${plan.name}`;
  const data = `${work}-gitdata`;
  const outside = `${dir}/outside`;
  yield* fs.makeDirectory(outside);
  yield* fs.writeFileString(`${outside}/keep`, "outside");
  const drop = (path: string) => fs.remove(path, { recursive: true, force: true });

  if (plan.pointer !== "ok") {
    yield* fs.writeFileString(`${work}/.git`, plan.pointer === "outside" ? `gitdir: ${outside}\n` : "gitdir:");
  }

  if (plan.head === "bad") {
    yield* fs.writeFileString(`${data}/HEAD`, "not git metadata");
  }

  if (plan.shallow) {
    yield* fs.writeFileString(`${data}/shallow`, `${made.tip}\n`);
  }

  if (plan.operation) {
    yield* fs.writeFileString(`${data}/MERGE_HEAD`, `${made.tip}\n`);
  }

  yield* drop(`${data}/ORIG_HEAD`);
  const original = { none: null, head: `${made.tip}\n`, lost: `${made.lost}\n`, bad: "zz\n" }[plan.origHead];

  if (original !== null) {
    yield* fs.writeFileString(`${data}/ORIG_HEAD`, original);
  }

  if (plan.reflog === "bad") {
    const log = yield* fs.readFileString(`${data}/logs/HEAD`);
    yield* fs.writeFileString(`${data}/logs/HEAD`, `${log}garbage\n`);
  }

  yield* drop(`${data}/FETCH_HEAD`);
  const fetched = { none: null, ok: `${made.tip}\t\tbranch 'main' of origin\n`, bad: "nonsense\n" }[plan.fetchHead];

  if (fetched !== null) {
    yield* fs.writeFileString(`${data}/FETCH_HEAD`, fetched);
  }

  if (plan.runs === "moved") {
    yield* fs.makeDirectory(`${work}/runs/sample`, { recursive: true });
    yield* fs.writeFileString(`${work}/runs/sample/answers.jsonl`, "{}\n");
  }

  if (plan.runs === "stuck") {
    yield* fs.writeFileString(`${work}/runs`, "a file, not a folder");
  }

  for (const [kind, path] of [
    ["work", work],
    ["data", data],
  ] as const) {
    const gone =
      plan.pair === "none" || plan.pair === `${kind === "work" ? "data" : "work"}-only` || plan.pair === `${kind}-link`;

    if (gone) {
      yield* drop(path);
    }

    if (plan.pair === `${kind}-link`) {
      yield* fs.symlink(outside, path);
    }
  }
});

const word = fc.stringMatching(/^[a-z]{2,8}$/);

/** Plans that reach every check: each fault is rare enough that the later checks still run. */
export const plans: fc.Arbitrary<Plan> = fc
  .record({
    name: fc.tuple(word, fc.boolean()).map(([w, space]) => (space ? `${w} with space` : w)),
    bad: fc.option(fc.constantFrom("", ".", "..", "../x", "x/y", "x\\y", "x\n", "x\t", "x\u0001"), { freq: 8 }),
    pair: fc.oneof(
      { weight: 12, arbitrary: fc.constant("both" as const) },
      { weight: 1, arbitrary: fc.constantFrom("none", "work-only", "data-only", "work-link", "data-link") },
    ),
    pointer: fc.oneof({ weight: 14, arbitrary: fc.constant("ok" as const) }, fc.constantFrom("outside", "malformed")),
    head: fc.oneof({ weight: 14, arbitrary: fc.constant("ok" as const) }, fc.constant("bad" as const)),
    shallow: fc.oneof({ weight: 14, arbitrary: fc.constant(false) }, fc.constant(true)),
    operation: fc.oneof({ weight: 14, arbitrary: fc.constant(false) }, fc.constant(true)),
    origHead: fc.oneof(
      { weight: 10, arbitrary: fc.constantFrom("none", "head") },
      { weight: 1, arbitrary: fc.constantFrom("lost", "bad") },
    ),
    reflog: fc.oneof({ weight: 14, arbitrary: fc.constant("ok" as const) }, fc.constant("bad" as const)),
    fetchHead: fc.oneof({ weight: 10, arbitrary: fc.constantFrom("none", "ok") }, fc.constant("bad" as const)),
    index: fc.oneof({ weight: 12, arbitrary: fc.constant("plain" as const) }, fc.constantFrom("flagged", "submodule")),
    dirty: fc.oneof({ weight: 8, arbitrary: fc.constant(false) }, fc.constant(true)),
    retained: fc.oneof({ weight: 6, arbitrary: fc.constant(true) }, fc.constant(false)),
    failing: fc.oneof({ weight: 14, arbitrary: fc.constant("none" as const) }, fc.constantFrom("ls-files", "status")),
    runs: fc.oneof({ weight: 6, arbitrary: fc.constantFrom("none", "moved") }, fc.constant("stuck" as const)),
  })
  .map(({ bad, ...plan }) => ({ ...plan, asked: bad ?? plan.name }));

/** Whether a path is there, a link counted as there even when it leads nowhere. */
const present = (fs: FileSystem.FileSystem, path: string) =>
  fs.lstat(path).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );

/** One case: make the world, plant the plan, run rm, and hold it to the oracle and the disk. */
const law = Effect.fnUntraced(function* (world: World, plan: Plan) {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "box-rm-" });
  const made = yield* world.make(dir, plan);
  yield* plant(dir, made, plan);
  const work = `${made.boxes}/${plan.name}`;
  const data = `${work}-gitdata`;
  const before = [yield* present(fs, work), yield* present(fs, data)];
  const removal = yield* Remove.remove(plan.asked, { boxes: made.boxes, main: made.main }).pipe(
    Effect.provide(made.layer),
  );
  const verdict = expected(plan);
  const removed = verdict._tag === "removed";
  expect(removal.verdict, JSON.stringify(plan)).toEqual(verdict);
  expect(Remove.exitCode(removal.verdict)).toBe(verdict._tag === "kept" ? verdict.code : 0);
  expect(removal.runs).toBe(removed && plan.runs === "moved" ? `kept runs of ${plan.name} at runs/${plan.name}` : "");
  expect([yield* present(fs, work), yield* present(fs, data)]).toEqual(removed ? [false, false] : before);
  expect(yield* fs.readFileString(`${dir}/outside/keep`)).toBe("outside");

  if (plan.asked === plan.name) {
    expect(Remove.line(removal)).toBe(
      verdict._tag === "kept"
        ? `kept box ${plan.name}: ${verdict.reason}`
        : `${verdict._tag === "removed" ? "removed" : "absent"} box ${plan.name}`,
    );
  } else {
    expect(Remove.line(removal)).toMatch(/^kept box '.*': invalid name$/s);
  }
});

/** How a test file runs a suite's Effects: one edge, so no law runs a Promise itself. */
export type Run = (law: Effect.Effect<void, unknown, Platform>) => Promise<void>;

export const rm = {
  /**
   * The rm laws on one world. `run` provides the platform and the scope. Every plan's verdict is the
   * oracle's; a box rm keeps is left exactly as it was, and one it removes is gone, folder and git data.
   */
  suite: (name: string, world: World, run: Run, options: { readonly numRuns: number; readonly seed: number }) =>
    describe(`box rm on ${name}`, () => {
      it("property: every plan gets the verdict the Python rm gave it, and only a removed pair leaves the disk", () =>
        fc.assert(
          fc.asyncProperty(plans, (plan) => run(law(world, plan))),
          options,
        ));

      // vector: one case per check, so each reason is reached on every world, whatever the sample.
      const clean: Plan = {
        name: "clean",
        asked: "clean",
        pair: "both",
        pointer: "ok",
        head: "ok",
        shallow: false,
        operation: false,
        origHead: "none",
        reflog: "ok",
        fetchHead: "ok",
        index: "plain",
        dirty: false,
        retained: true,
        failing: "none",
        runs: "moved",
      };
      const vectors: ReadonlyArray<Partial<Plan>> = [
        {},
        { asked: "../clean" },
        { pair: "none" },
        { pair: "work-only" },
        { pair: "data-link" },
        { pointer: "malformed" },
        { pointer: "outside" },
        { head: "bad" },
        { shallow: true },
        { operation: true },
        { origHead: "bad" },
        { origHead: "lost" },
        { reflog: "bad" },
        { fetchHead: "bad" },
        { failing: "ls-files" },
        { index: "flagged" },
        { index: "submodule" },
        { failing: "status" },
        { dirty: true },
        { retained: false },
        { runs: "stuck" },
      ];

      it.each(
        vectors.map((planted) => ({
          planted: JSON.stringify(planted),
          plan: { ...clean, ...planted },
          reason: Remove.line({ shown: "clean", runs: "", verdict: expected({ ...clean, ...planted }) }),
        })),
      )("vector: $planted gives $reason", ({ plan }) => run(law(world, plan)));
    }),
};
