// mutbox.ts: run the mutation step's Stryker sample in a container with its own network, so
// nothing is opened in the laptop sandbox (decision 0045). Today's lead tooling, not product.
//
//   node mutbox.ts run --checkout <repo> --ticket <n> --build <commit> --related <a.test.ts,b.test.ts>
//                      --out <folder> --lock <file> [--base <commit>] [--seconds <n>] [--plan <file>]
//   node mutbox.ts gc --lock <file>
//
// `run` prints one JSON line and writes the same value to <out>/mutbox.json: outcome `done` (exit
// 0), `skip` (40: the sampler found no product line) or `stuck` (30). It never runs the sample on
// the host: Docker missing, stopped or not linux/arm64 is `stuck`.
//
// Existing tools first (0040). The fence is Docker's own flags (`--network none`, `--cap-drop
// ALL`, `--memory`, `--cpus`, `--pids-limit`, `--rm`), the image is pnpm's own Docker recipe
// (https://pnpm.io/docker: `pnpm fetch` from the lockfile, an offline install later), the copy of
// the commit is `git fetch --depth 2`, and cleanup is `docker image prune`. Looked at and not
// used: Dev Containers (https://containers.dev) and Testcontainers
// (https://node.testcontainers.org), which both start a container with a network and are built
// to keep one around; Docker's own `docker sandbox` (https://docs.docker.com/ai/sandboxes/),
// which fences an agent, keeps its network on and is not in Docker 28.3.2. What is hand-written
// is the part no tool has: which commit goes in, the lock, the time limit and reading the report.
//
// Edge cases, each with a test in mutbox.test.ts:
//   1. Docker is not installed or not running      stuck docker_down, nothing runs on the host
//   2. the Docker server is not linux/arm64        stuck not_arm64 (only arm64 was measured)
//   3. the image is missing                        built from the commit's lockfile, then used
//   4. the image is stale against the lockfile     the tag is a hash of the lockfile, workspace
//                                                  file, patches, pnpm version, Dockerfile and
//                                                  entry script, so a change is a missing image
//   5. the commit's Node is not the image's        stuck node_mismatch
//   6. the time limit hits                         docker kill, stuck time_limit, no container left
//   7. the container is killed mid-run             stuck killed, no container left
//   8. two runs at once                            the second is stuck docker_busy (one Docker box)
//   9. a dead run left its lock or its container   the lock is taken over, the container removed
//  10. a path with spaces                          runs; a path Docker's --mount cannot take
//                                                  (a comma, a quote, a newline) is stuck bad_path
//  11. a related test that needs a window          left out, named with its reason in the report;
//                                                  read from its parsed imports, so an Electron
//                                                  import inside a planted string is not one
//  12. a related path that is not a test file      stuck bad_related, before Docker is asked
//  13. a link planted in the output folder         never followed: stuck bad_output
//  14. the sampler selects no range                skip
//  15. a related test fails before any mutant      stuck baseline_failed, naming the tests
//  16. no mutant got a real test result            stuck no_tested_mutant (a dry run is not proof)
//  17. every sampled mutant is static, so Ignored   skip static_only, with the count: with
//      (ignoreStatic stays on), and the run ended  ignoreStatic on, no test can judge it; a
//      with none unreached                          mix with any other status, none at all, or a
//                                                   capped run is still 16
//  18. the build's sampler gives no per-file reach  done no_reach:old_sampler, narrowing "unknown"
//  19. a base test fails on the build              left out of arm a, named in armA.dropped, since
//                                                  Stryker stops at a failing dry-run test
//  20. a base with none of the related tests, or   done no_arm_a:base_has_none or :none_pass,
//      none of them passes on the build            narrowing "unknown": the lead hand-checks
//  21. arm a was due and left no answer or failed  stuck arm_a_failed
//  22. with --plan, the sample reached none of     stuck no_build_reach, naming them; a plan
//      the plan's build-owned files that have      plancheck cannot read is stuck bad_plan
//      a mutant on their changed lines
//  23. a Docker call never answers                 stopped at its DOCKER_SECONDS bound (TERM,
//                                                  then KILL), stuck docker_timeout; in gc, one
//                                                  line and exit 0, so the chain goes on
// Every report carries `reach`, the line "the sample reached N of M changed files", naming each
// file with zero mutants (ticket 655).

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Option, Path, Schema, Stream } from "effect";
import { Command, Flag } from "effect/cli";
import { ChildProcess } from "effect/process";
import { parseSync, Visitor } from "oxc-parser";

/** Docker's own label on every image and container this script makes, so cleanup finds them. */
export const LABEL = "fabrika.mutbox=1";
/** Whose container it is: the lock file its run held. A sweep removes only its own lock's. */
export const OWNER = "fabrika.mutbox.lock";
export const PLATFORM = "linux/arm64";

/**
 * The container's limits. 4 of the laptop's 12 cores: a person is using it and up to 12 agents
 * run beside it, and lane t411's sample used 67 CPU seconds over 104 (under one core), so 4 is
 * room to spare. 4 GB: that run peaked at 1.9 GB, and Docker's own VM here has 8.
 */
export const LIMITS = { cpus: 4, memory: "4g", pids: 512 } as const;

/** One arm is run.sh's own 300 s cap plus the install and the baseline; two arms with a base. */
export const secondsFor = (base: boolean) => (base ? 900 : 480);

/**
 * How long one Docker call may take before it is stopped. On 2026-11-10 a `docker ps` in gc never
 * returned, and two lanes sat 1 h 50 min with no agent alive. No saved row times a single Docker
 * call; the bounds come from whole runs in the boxes folder's mutbox.json files. The shortest,
 * t589-mutation1, did every quick call (version, ps, image inspect, rm) and the container's own
 * sample in 22 s, so `call` is 30 s, past anything a working Docker gave us. The one image build
 * timed took 81 s (field note 2026-11-10-01), so `build` is 600 s. `prune` deletes image layers and
 * has no timing: 120 s is a guess. `docker run` keeps its own bound, secondsFor.
 */
export const DOCKER_SECONDS = { call: 30, prune: 120, build: 600 } as const;

/** After SIGTERM, a stopped command's time to exit before SIGKILL: a hung client may ignore TERM. */
export const KILL_GRACE_SECONDS = 2;

/**
 * The most `mutbox gc` can take with every call hung: version, ps, rm and prune, each with its
 * kill grace, plus 10 s to start and stop Node. gc.ts stops it past this, as a second guard.
 */
export const GC_SECONDS = 3 * DOCKER_SECONDS.call + DOCKER_SECONDS.prune + 4 * KILL_GRACE_SECONDS + 10;

class Stuck extends Schema.TaggedError<Stuck>()("Stuck", {
  reason: Schema.String,
  detail: Schema.String,
}) {}

/** A command passed its time limit and was stopped; nothing it would have said was read. */
export class CallTimeout extends Schema.TaggedError<CallTimeout>()("CallTimeout", {
  command: Schema.String,
  seconds: Schema.Number,
}) {}

/** The one line a timed-out call leaves in a report. Pure. */
export const timeoutLine = (e: CallTimeout) => `${e.command} passed its ${e.seconds} s limit and was stopped`;

/** The related test paths, or `null` when one is not a plain test file path. */
export const parseRelated = (text: string): ReadonlyArray<string> | null => {
  const paths = text
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const plain = (p: string) =>
    /^[A-Za-z0-9_@.][A-Za-z0-9_@.+/ -]*\.test\.tsx?$/.test(p) && !p.split("/").includes("..") && !p.startsWith("/");
  return paths.length > 0 && paths.every(plain) ? paths : null;
};

/** Docker's `--mount` reads a comma-separated list, so these three cannot be in a path it takes. */
export const mountable = (path: string) => path.startsWith("/") && !/[,"\n]/.test(path);

const WINDOWS = new Set(["electron", "playwright", "@playwright/test"]);

/**
 * The modules a source loads at run time, from its parsed syntax: value imports, re-exports,
 * `import("x")` and `require("x")` with a literal name. A type-only import loads nothing, and an
 * import inside a string (a lint rule's planted source) is not one (ticket 655).
 */
const loads = (file: string, source: string): ReadonlySet<string> => {
  const names = new Set<string>();
  const add = (node: { readonly type: string; readonly value?: unknown } | null | undefined) => {
    if (node?.type === "Literal" && typeof node.value === "string") {
      names.add(node.value);
    }
  };
  new Visitor({
    ImportDeclaration: (node) => (node.importKind === "type" ? undefined : add(node.source)),
    ExportNamedDeclaration: (node) => (node.exportKind === "type" ? undefined : add(node.source)),
    ExportAllDeclaration: (node) => (node.exportKind === "type" ? undefined : add(node.source)),
    ImportExpression: (node) => add(node.source),
    CallExpression: (node) =>
      node.callee.type === "Identifier" && node.callee.name === "require" ? add(node.arguments[0]) : undefined,
  }).visit(parseSync(file, source).program);
  return names;
};

/**
 * Why a test cannot run in this container, read from the modules it loads, or `null`. Electron
 * and a browser need a display, and the container has none.
 */
export const needsHost = (file: string, source: string): string | null =>
  [...loads(file, source)].some((name) => WINDOWS.has(name))
    ? "it starts an Electron or browser window, and this Linux container has no display"
    : null;

/** The base image's Node version, or `null` when the FROM line is not pinned by digest. */
export const baseNode = (dockerfile: string): string | null =>
  /^FROM node:(\d+\.\d+\.\d+)-[a-z]+@sha256:[0-9a-f]{64}$/m.exec(dockerfile)?.[1] ?? null;

/** The exact pnpm version a `packageManager` field names, or `null`. */
export const pnpmVersion = (packageManager: string): string | null =>
  /^pnpm@(\d+\.\d+\.\d+)$/.exec(packageManager)?.[1] ?? null;

export const imageTag = (hash: string) => `fabrika-mutbox:${hash.slice(0, 16)}`;

/** The whole `docker run` line. Everything the container may touch is named here. */
export const runArgs = (ask: {
  readonly name: string;
  readonly image: string;
  readonly input: string;
  readonly output: string;
  readonly ticket: string;
  readonly build: string;
  readonly related: ReadonlyArray<string>;
  readonly lock: string;
}): Array<string> => [
  "run",
  "--rm",
  "--init",
  "--platform",
  PLATFORM,
  "--network",
  "none",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges",
  "--user",
  "node",
  "--cpus",
  String(LIMITS.cpus),
  "--memory",
  LIMITS.memory,
  "--memory-swap",
  LIMITS.memory,
  "--pids-limit",
  String(LIMITS.pids),
  "--name",
  ask.name,
  "--label",
  LABEL,
  "--label",
  `${OWNER}=${ask.lock}`,
  "--mount",
  `type=bind,src=${ask.input},dst=/in,readonly`,
  "--mount",
  `type=bind,src=${ask.output},dst=/out`,
  "--env",
  `T=${ask.ticket}`,
  "--env",
  `BUILD=${ask.build}`,
  "--env",
  `RELATED=${ask.related.join(",")}`,
  ask.image,
  "nice",
  "-n",
  "15",
  "sh",
  "/usr/local/bin/mutbox-entry",
];

const Position = Schema.Struct({ line: Schema.Number, column: Schema.Number });

const mutantFields = {
  mutatorName: Schema.String,
  replacement: Schema.optional(Schema.String),
  status: Schema.String,
  location: Schema.Struct({ start: Position, end: Position }),
};

const Report = Schema.Struct({
  files: Schema.Record(Schema.String, Schema.Struct({ mutants: Schema.Array(Schema.Struct(mutantFields)) })),
});

const Tested = Schema.Struct({ ...mutantFields, fileName: Schema.String });

const Sample = Schema.Struct({
  seed: Schema.Number,
  ranges: Schema.Array(Schema.String),
  total: Schema.Number,
  selected: Schema.Number,
  left: Schema.Number,
  /** Every changed file's mutants and how many were selected; a sampler from before ticket 655 has none. */
  files: Schema.optional(
    Schema.Array(Schema.Struct({ file: Schema.String, total: Schema.Number, selected: Schema.Number })),
  ),
});

type FileReach = NonNullable<(typeof Sample.Type)["files"]>[number];

/** The report's reach line: how many changed files got a mutant, and each one that got none. Pure. */
export const reachLine = (files: ReadonlyArray<FileReach>): string => {
  const missed = files.filter((f) => f.selected === 0);
  const reason = (f: FileReach) =>
    f.total === 0 ? "no mutant on its changed lines" : `${f.total} mutants on its changed lines, none selected`;
  return [
    `the sample reached ${files.length - missed.length} of ${files.length} changed files`,
    ...(missed.length > 0 ? [`; zero mutants in ${missed.map((f) => `${f.file} (${reason(f)})`).join(", ")}`] : []),
  ].join("");
};

/**
 * Whether the plan gives a file to the build step: its own row, else the longest folder row
 * (`dir/`) above it, as the box's own owner check reads the same table. Pure.
 */
export const buildOwns = (owners: Readonly<Record<string, string>>, file: string): boolean => {
  const folders = Object.keys(owners).filter((key) => key.endsWith("/") && file.startsWith(key));
  const key = file in owners ? file : folders.sort((a, b) => b.length - a.length)[0];
  return key !== undefined && owners[key] === "build";
};

const Owners = Schema.Record(Schema.String, Schema.String);

const Baseline = Schema.Struct({
  testResults: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      assertionResults: Schema.Array(Schema.Struct({ fullName: Schema.String, status: Schema.String })),
    }),
  ),
});

const Manifest = Schema.Struct({
  packageManager: Schema.String,
  engines: Schema.Struct({ node: Schema.String }),
});

/** One mutant's answer, as the report gives it to a reader. */
const Row = Schema.Struct({
  file: Schema.String,
  line: Schema.Number,
  column: Schema.Number,
  endLine: Schema.Number,
  endColumn: Schema.Number,
  mutator: Schema.String,
  replacement: Schema.String,
  status: Schema.String,
});
type Row = typeof Row.Type;

const Arm = Schema.Struct({
  /** run.sh's exit code: 0, or 124 when its five minutes ran out. */
  exit: Schema.Number,
  /** `report`: Stryker finished. `events`: the cap stopped it, and this is what it kept. */
  from: Schema.Literals(["report", "events", "nothing"]),
  counts: Schema.Record(Schema.String, Schema.Number),
  tested: Schema.Number,
  /** Selected mutants the cap stopped before they were tested. */
  unreached: Schema.Number,
  survivors: Schema.Array(Row),
});
type Arm = typeof Arm.Type;

const Named = Schema.Struct({ path: Schema.String, reason: Schema.String });

const Summary = Schema.Struct({
  outcome: Schema.Literals(["done", "skip", "stuck"]),
  reason: Schema.String,
  detail: Schema.String,
  ticket: Schema.String,
  build: Schema.String,
  base: Schema.NullOr(Schema.String),
  image: Schema.NullOr(Schema.String),
  network: Schema.Literal("none"),
  limits: Schema.Struct({
    cpus: Schema.Number,
    memory: Schema.String,
    pids: Schema.Number,
    seconds: Schema.Number,
  }),
  seconds: Schema.Number,
  /** From the container's own cgroup: `memory.peak` and `cpu.stat`. */
  usage: Schema.NullOr(Schema.Struct({ memoryPeakBytes: Schema.Number, cpuSeconds: Schema.Number })),
  related: Schema.Array(Schema.String),
  /** Related tests left out before the run, each with why. They did not run. */
  excluded: Schema.Array(Named),
  /** Tests that skipped themselves inside the container (their own `skipIf`). They did not run. */
  skipped: Schema.Array(Schema.String),
  sample: Schema.NullOr(Sample),
  /** `reachLine` of the sample, or `null` when there is no sample or its sampler gives no reach. */
  reach: Schema.NullOr(Schema.String),
  /** Arm b: the branch's own tests. */
  b: Schema.NullOr(Arm),
  /** Arm a: the same sample against the base's tests, when a base was given and has them. */
  a: Schema.NullOr(Arm),
  /**
   * Mutants arm a kills that arm b lets live; `null` with no base; `"unknown"` when the reason
   * names a gap (`no_arm_a:<cause>`, `no_reach:old_sampler`) and the lead hand-checks the laws.
   */
  narrowing: Schema.NullOr(Schema.Union([Schema.Array(Row), Schema.Literal("unknown")])),
  /** With a base: each related test left out of arm a, and why. */
  armA: Schema.NullOr(Schema.Struct({ dropped: Schema.Array(Named) })),
});
type Summary = typeof Summary.Type;

const TESTED = new Set(["Killed", "Survived", "Timeout"]);

const mutantKey = (r: Row) =>
  [r.file, r.line, r.column, r.endLine, r.endColumn, r.mutator, r.replacement].join("\u0000");

const toRow = (
  file: string,
  m: typeof Tested.Type | (typeof Report.Type)["files"][string]["mutants"][number],
): Row => ({
  file: file.replace(/^\/repo\//, ""),
  line: m.location.start.line,
  column: m.location.start.column,
  endLine: m.location.end.line,
  endColumn: m.location.end.column,
  mutator: m.mutatorName,
  replacement: m.replacement ?? "",
  status: m.status,
});

/** One arm's answer from its mutants. Pure. */
export const tally = (exit: number, from: Arm["from"], rows: ReadonlyArray<Row>, selected: number): Arm => {
  const counts: Record<string, number> = {};

  for (const r of rows) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }

  return {
    exit,
    from,
    counts,
    tested: rows.filter((r) => TESTED.has(r.status)).length,
    unreached: Math.max(0, selected - rows.length),
    survivors: rows.filter((r) => r.status === "Survived"),
  };
};

/** The mutants arm a kills that arm b lets live. Pure. */
export const narrowed = (a: ReadonlyArray<Row>, b: ReadonlyArray<Row>): Array<Row> => {
  const killed = new Set(a.filter((r) => r.status === "Killed" || r.status === "Timeout").map(mutantKey));
  return b.filter((r) => (r.status === "Survived" || r.status === "NoCoverage") && killed.has(mutantKey(r)));
};

/** What the run comes to, from what the container left. Pure. */
export const judge = (seen: {
  readonly exit: number;
  readonly sample: typeof Sample.Type | null;
  readonly b: Arm | null;
  readonly failed: ReadonlyArray<string>;
  /**
   * With a base: arm a's answer, how many related tests the base has, and how many of those pass
   * on the build and so ran in arm a. `null`: no base.
   */
  readonly base: { readonly a: Arm | null; readonly has: number; readonly kept: number } | null;
  /** The plan's file owners, or `null` when no plan was given. */
  readonly owners: Readonly<Record<string, string>> | null;
}): Pick<Summary, "outcome" | "reason" | "detail"> => {
  if (seen.exit === 70) {
    return {
      outcome: "stuck",
      reason: "install_failed",
      detail: "the offline install failed in the container; see box/install.txt",
    };
  }

  if (seen.exit === 71) {
    return {
      outcome: "stuck",
      reason: "baseline_failed",
      detail: `related tests fail in the container before any mutant: ${seen.failed.slice(0, 5).join("; ") || "see box/baseline.txt"}`,
    };
  }

  if (seen.exit === 137) {
    return {
      outcome: "stuck",
      reason: "killed",
      detail: "the container was killed (exit 137), by a signal or its memory limit",
    };
  }

  if (seen.sample !== null && seen.sample.ranges.length === 0) {
    return {
      outcome: "skip",
      reason: "no_ranges",
      detail: "the sampler selected no mutation range: the build's diff has no product line",
    };
  }

  if (seen.b === null || seen.sample === null) {
    return {
      outcome: "stuck",
      reason: "no_report",
      detail: `the container exited ${seen.exit} and left no sample or report; see box/b/run.txt`,
    };
  }

  if (seen.b.exit !== 0 && seen.b.exit !== 124) {
    return {
      outcome: "stuck",
      reason: "run_failed",
      detail: `run.sh exited ${seen.b.exit} in the container; see box/b/run.txt and box/b/log.txt`,
    };
  }

  const ignored = seen.b.counts["Ignored"] ?? 0;

  if (
    seen.b.exit === 0 &&
    seen.b.tested === 0 &&
    seen.b.unreached === 0 &&
    ignored > 0 &&
    Object.keys(seen.b.counts).every((status) => status === "Ignored")
  ) {
    return {
      outcome: "skip",
      reason: "static_only",
      detail: `every sampled mutant is static and Stryker ignored it (Ignored ${ignored}): with ignoreStatic on, no test can judge them`,
    };
  }

  if (seen.b.tested === 0) {
    return {
      outcome: "stuck",
      reason: "no_tested_mutant",
      detail: `no mutant got a real test result (run.sh exit ${seen.b.exit}); see box/b/log.txt`,
    };
  }

  // Arm a was due to run and gave no clean answer: that is not a known state.
  if (seen.base !== null && seen.base.kept > 0 && (seen.base.a === null || ![0, 124].includes(seen.base.a.exit))) {
    return {
      outcome: "stuck",
      reason: "arm_a_failed",
      detail: `arm a, on the ${seen.base.kept} base test files that pass on the build, ${seen.base.a === null ? "left no answer" : `exited ${seen.base.a.exit}`}; see box/a/run.txt and box/a/log.txt`,
    };
  }

  const owners = seen.owners;
  const files = seen.sample.files;
  const owned =
    owners === null || files === undefined ? [] : files.filter((f) => f.total > 0 && buildOwns(owners, f.file));

  if (owned.length > 0 && owned.every((f) => f.selected === 0)) {
    return {
      outcome: "stuck",
      reason: "no_build_reach",
      detail: `the sample reached none of the plan's build-owned files: ${owned.map((f) => f.file).join(", ")}`,
    };
  }

  // Known gaps: the run is done, but what it cannot show is named, and narrowing is "unknown", so
  // the lead hand-checks the laws as for a loosening hit (ticket 655).
  const gaps = [
    ...(files === undefined
      ? [
          {
            reason: "no_reach:old_sampler",
            detail:
              "the build's sample.ts predates per-file reach (ticket 655), so nobody can see which changed files got a mutant",
          },
        ]
      : []),
    ...(seen.base !== null && seen.base.kept === 0
      ? [
          seen.base.has === 0
            ? {
                reason: "no_arm_a:base_has_none",
                detail: "the base has none of the related tests, so arm a had nothing to run",
              }
            : {
                reason: "no_arm_a:none_pass",
                detail: "none of the base's related tests pass on the build, so arm a had nothing to run",
              },
        ]
      : []),
    ...(seen.b.exit === 124
      ? [
          {
            reason: "capped",
            detail: `the five minutes ran out: ${seen.b.unreached} selected mutants were not reached`,
          },
        ]
      : []),
  ];
  const unknown = gaps.some((g) => g.reason !== "capped");
  return {
    outcome: "done",
    reason: gaps.map((g) => g.reason).join(","),
    detail: [
      ...gaps.map((g) => g.detail),
      ...(unknown ? ["narrowing is unknown: hand-check that no law got narrower"] : []),
    ].join("; "),
  };
};

/**
 * Each related test left out of arm a, and why: the base has no such file, or its tests fail on
 * the build (named from arm a's own vitest run), which would stop Stryker's dry run. Pure.
 */
export const droppedFromArmA = (
  related: ReadonlyArray<string>,
  onBase: ReadonlyArray<string>,
  kept: ReadonlyArray<string>,
  baseline: typeof Baseline.Type | null,
): Array<typeof Named.Type> =>
  related
    .filter((p) => !kept.includes(p))
    .map((p) => {
      const failed = (baseline?.testResults ?? [])
        .filter((file) => file.name.replace(/^\/repo\//, "") === p)
        .flatMap((file) => file.assertionResults.filter((t) => t.status === "failed").map((t) => t.fullName));
      return {
        path: p,
        reason: !onBase.includes(p)
          ? "the base has no such file"
          : failed.length > 0
            ? `its base version fails on the build: ${failed.slice(0, 5).join("; ")}`
            : "its base version does not pass on the build; see box/a-baseline.txt",
      };
    });

/** Whether a done's reason names a gap that leaves narrowing unknown. Pure. */
export const narrowingUnknown = (reason: string) =>
  reason.split(",").some((r) => r.startsWith("no_reach:") || r.startsWith("no_arm_a:"));

export const exitCode = (outcome: Summary["outcome"]) => (outcome === "done" ? 0 : outcome === "skip" ? 40 : 30);

const text = (stream: Stream.Stream<Uint8Array, unknown>) => stream.pipe(Stream.decodeText(), Stream.mkString);

/**
 * Run one command to its end. A command that cannot start answers 127. The child lives in this
 * call's scope: interrupted (a time limit), its process group gets SIGTERM, then SIGKILL after
 * KILL_GRACE_SECONDS, and the scope closes only once it is gone (0061).
 */
const sh = Effect.fnUntraced(
  function* (cmd: string, args: ReadonlyArray<string>, stdin?: string | Stream.Stream<Uint8Array>) {
    const ran = yield* ChildProcess.make(cmd, args, {
      extendEnv: true,
      // No hooks, no repo-set or user-set git helpers: nothing a checkout holds runs as us.
      env: { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" },
      forceKillAfter: `${KILL_GRACE_SECONDS} seconds`,
      ...(stdin === undefined
        ? {}
        : { stdin: typeof stdin === "string" ? Stream.make(new TextEncoder().encode(stdin)) : stdin }),
    });
    const [out, err, code] = yield* Effect.all([text(ran.stdout), text(ran.stderr), ran.exitCode], {
      concurrency: 3,
    });
    return { out, err, code: Number(code) };
  },
  Effect.scoped,
  Effect.catch(() => Effect.succeed({ out: "", err: "the command could not start", code: 127 })),
);

/**
 * Run one command, stopped past `seconds`: its child is killed as `sh` says, and the call fails
 * with CallTimeout. A Docker call never waits without a bound.
 */
export const bounded = (
  cmd: string,
  args: ReadonlyArray<string>,
  seconds: number,
  stdin?: string | Stream.Stream<Uint8Array>,
) =>
  sh(cmd, args, stdin).pipe(
    Effect.timeoutOrElse({
      duration: `${seconds} seconds`,
      orElse: () => Effect.fail(new CallTimeout({ command: [cmd, ...args.slice(0, 2)].join(" "), seconds })),
    }),
  );

/** One Docker call under its bound (DOCKER_SECONDS). */
const docker = (args: ReadonlyArray<string>, seconds: number = DOCKER_SECONDS.call) => bounded("docker", args, seconds);

const tail = (s: string) => s.trim().split("\n").slice(-3).join(" | ").slice(-400);

const alive = (pid: number) =>
  Effect.try({ try: () => process.kill(pid, 0), catch: () => "gone" }).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );

/** Whether a live process holds the lock; a lock whose owner is dead is removed. */
const heldBy = Effect.fnUntraced(function* (lock: string) {
  const fs = yield* FileSystem.FileSystem;
  const owner = Number(yield* fs.readFileString(lock).pipe(Effect.catch(() => Effect.succeed(""))));

  if (Number.isInteger(owner) && owner > 0 && (yield* alive(owner))) {
    return owner;
  }

  yield* fs.remove(lock, { force: true }).pipe(Effect.ignore);
  return null;
});

/** One Docker box at a time (0012): a lock file outside the container, holding our pid. */
const takeLock = Effect.fnUntraced(function* (lock: string) {
  const fs = yield* FileSystem.FileSystem;
  const write = fs.writeFileString(lock, String(process.pid), { flag: "wx" });
  yield* Effect.acquireRelease(
    write.pipe(
      Effect.catch(() =>
        Effect.gen(function* () {
          const owner = yield* heldBy(lock);

          if (owner !== null) {
            return yield* new Stuck({
              reason: "docker_busy",
              detail: `another Docker box is running (pid ${owner}); one at a time`,
            });
          }

          return yield* write.pipe(
            Effect.mapError(() => new Stuck({ reason: "docker_busy", detail: "the lock could not be taken" })),
          );
        }),
      ),
    ),
    () => fs.remove(lock, { force: true }).pipe(Effect.ignore),
  );
});

/** Every container a run under this lock made. Whoever holds the lock may remove them. */
const sweepContainers = Effect.fnUntraced(function* (lock: string) {
  const listed = yield* docker(["ps", "-aq", "--filter", `label=${OWNER}=${lock}`]);
  const ids = listed.out.split("\n").filter(Boolean);

  if (ids.length > 0) {
    yield* docker(["rm", "-f", ...ids]);
  }

  return ids.length;
});

const dockerReady = Effect.fnUntraced(function* () {
  const server = yield* docker(["version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"]);

  if (server.code !== 0) {
    return yield* new Stuck({
      reason: "docker_down",
      detail: "Docker is not installed or not running; the sample is never run on the host",
    });
  }

  if (server.out.trim() !== PLATFORM) {
    return yield* new Stuck({
      reason: "not_arm64",
      detail: `the Docker server is ${server.out.trim()}; only ${PLATFORM} was measured`,
    });
  }
});

/** A file under the output folder, as text; `null` when absent. A link out of the folder is refused. */
const readOut = Effect.fnUntraced(function* (box: string, name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(box, name);

  if (!(yield* fs.exists(file).pipe(Effect.catch(() => Effect.succeed(false))))) {
    return null;
  }

  const real = yield* fs.realPath(file).pipe(Effect.catch(() => Effect.succeed("")));

  if (real !== file) {
    return yield* new Stuck({
      reason: "bad_output",
      detail: `the output holds a link at ${name}; nothing was read through it`,
    });
  }

  return yield* fs.readFileString(file).pipe(Effect.catch(() => Effect.succeed(null)));
});

/** Decode one output file; text that does not fit is `null`, and never quoted anywhere. */
const decoded = <S extends Schema.Top>(schema: S, raw: string | null) =>
  raw === null
    ? Effect.succeed(null)
    : Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(raw).pipe(Effect.catch(() => Effect.succeed(null)));

const readArm = Effect.fnUntraced(function* (box: string, name: "a" | "b", selected: number) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const exit = Number((yield* readOut(box, `${name}/exit`)) ?? Number.NaN);

  if (!Number.isInteger(exit)) {
    return null;
  }

  const report = yield* decoded(Report, yield* readOut(box, `${name}/report.json`));

  if (report !== null) {
    const rows = Object.entries(report.files).flatMap(([file, f]) => f.mutants.map((m) => toRow(file, m)));
    return { arm: tally(exit, "report", rows, selected), rows };
  }

  const events = path.join(box, name, "events");
  const names = (yield* fs.readDirectory(events).pipe(Effect.catch(() => Effect.succeed([])))).filter((n) =>
    /^\d+-onMutantTested\.json$/.test(n),
  );
  const rows: Array<Row> = [];

  for (const n of names.sort()) {
    const tested = yield* decoded(Tested, yield* readOut(box, `${name}/events/${n}`));

    if (tested !== null) {
      rows.push(toRow(tested.fileName, tested));
    }
  }

  return { arm: tally(exit, rows.length > 0 ? "events" : "nothing", rows, selected), rows };
});

const readUsage = Effect.fnUntraced(function* (box: string) {
  const peak = Number((yield* readOut(box, "memory.peak")) ?? Number.NaN);
  const cpu = /^usage_usec (\d+)$/m.exec((yield* readOut(box, "cpu.stat")) ?? "")?.[1];
  return Number.isFinite(peak) && cpu !== undefined
    ? { memoryPeakBytes: peak, cpuSeconds: Math.round(Number(cpu) / 10_000) / 100 }
    : null;
});

interface Ask {
  readonly checkout: string;
  readonly ticket: string;
  readonly build: string;
  readonly related: string;
  readonly out: string;
  readonly lock: string;
  readonly base: string | undefined;
  readonly seconds: number | undefined;
  /** The approved plan, from the current folder, as drive reads it; its build-owned files must get a mutant. */
  readonly plan: string | undefined;
}

/** A run that ended before the container answered: what was asked, and why it is stuck. */
const stuckSummary = (ask: Ask, started: number, reason: string, detail: string): Summary => ({
  outcome: "stuck",
  reason,
  detail,
  ticket: ask.ticket,
  build: ask.build,
  base: ask.base ?? null,
  image: null,
  network: "none",
  limits: { ...LIMITS, seconds: ask.seconds ?? secondsFor(ask.base !== undefined) },
  seconds: Math.round((Date.now() - started) / 1000),
  usage: null,
  related: [],
  excluded: [],
  skipped: [],
  sample: null,
  reach: null,
  b: null,
  a: null,
  narrowing: null,
  armA: null,
});

/** The whole run. Fails with `Stuck` before the container answers; else gives the summary. */
const boxed = Effect.fnUntraced(function* (ask: Ask, started: number) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const here = import.meta.dirname;
  const limit = ask.seconds ?? secondsFor(ask.base !== undefined);
  const all = parseRelated(ask.related);

  if (all === null || !/^\d+$/.test(ask.ticket)) {
    return yield* new Stuck({
      reason: "bad_related",
      detail: "--related takes test file paths inside the repo, separated by commas, and --ticket a number",
    });
  }

  // The plan's owners, by plancheck's own table reader, the one the box's owner check uses.
  const owners =
    ask.plan === undefined
      ? null
      : yield* decoded(
          Owners,
          (yield* sh("sh", [
            path.join(here, "../../plan/scripts/plancheck.sh"),
            "--owners-json",
            path.resolve(ask.plan),
          ])).out,
        );

  if (ask.plan !== undefined && owners === null) {
    return yield* new Stuck({
      reason: "bad_plan",
      detail: "plancheck.sh --owners-json could not read the plan's files table",
    });
  }

  yield* fs.makeDirectory(ask.out, { recursive: true }).pipe(Effect.ignore);
  const out = yield* fs.realPath(ask.out).pipe(Effect.catch(() => Effect.succeed(ask.out)));
  const box = path.join(out, "box");
  const input = path.join(out, "in");

  if (!mountable(out)) {
    return yield* new Stuck({
      reason: "bad_path",
      detail: "the output folder's path holds a comma, a quote or a newline, which docker --mount cannot take",
    });
  }

  yield* dockerReady();
  yield* takeLock(ask.lock);
  yield* sweepContainers(ask.lock);

  // The copy that goes in: the build commit and its parent, fetched with git's own plumbing into
  // a fresh bare repo. Only committed files cross; nothing in the checkout runs.
  yield* fs.remove(box, { recursive: true, force: true }).pipe(Effect.ignore);
  yield* fs.remove(input, { recursive: true, force: true }).pipe(Effect.ignore);
  yield* Effect.addFinalizer(() => fs.remove(input, { recursive: true, force: true }).pipe(Effect.ignore));
  const repo = path.join(input, "repo.git");
  yield* fs.makeDirectory(repo, { recursive: true }).pipe(Effect.ignore);
  yield* fs.makeDirectory(box, { recursive: true }).pipe(Effect.ignore);
  // The container writes here as its `node` user. Docker Desktop maps a bind mount to whoever
  // runs it, but a Linux host keeps the folder's owner, so on a CI runner (another uid) the box
  // could not write a byte. Open to any user: it holds only what the container leaves.
  yield* fs.chmod(box, 0o777).pipe(Effect.ignore);
  const git = (...args: ReadonlyArray<string>) =>
    sh("git", ["--git-dir", repo, "-c", "core.hooksPath=/dev/null", ...args]);
  const resolve = Effect.fnUntraced(function* (ref: string) {
    const got = yield* sh("git", ["-C", ask.checkout, "rev-parse", "-q", "--verify", `${ref}^{commit}`]);
    return got.code === 0 ? got.out.trim() : null;
  });
  const build = yield* resolve(ask.build);
  const base = ask.base === undefined ? null : yield* resolve(ask.base);

  if (build === null || (ask.base !== undefined && base === null)) {
    return yield* new Stuck({
      reason: "bad_commit",
      detail: "--build or --base is not a commit in the checkout",
    });
  }

  yield* git("init", "-q", "--bare");
  const fetch = (sha: string, ref: string, depth: number) =>
    git(
      "fetch",
      "-q",
      "--no-tags",
      "--depth",
      String(depth),
      "--upload-pack",
      "git -c uploadpack.allowAnySHA1InWant=true upload-pack",
      ask.checkout,
      `${sha}:refs/heads/${ref}`,
    );
  const fetched = yield* fetch(build, "build", 2);
  const fetchedBase = base === null ? fetched : yield* fetch(base, "base", 1);

  if (fetched.code !== 0 || fetchedBase.code !== 0) {
    return yield* new Stuck({
      reason: "bad_commit",
      detail: `git fetch failed: ${tail(fetched.err + fetchedBase.err)}`,
    });
  }

  const show = Effect.fnUntraced(function* (file: string) {
    const got = yield* git("show", `refs/heads/build:${file}`);
    return got.code === 0 ? got.out : null;
  });

  // Tests this container cannot run are left out and named, never counted as run.
  const excluded: Array<typeof Named.Type> = [];
  const related: Array<string> = [];

  for (const p of all) {
    const source = yield* show(p);
    const reason = source === null ? "the build commit has no such file" : needsHost(p, source);

    if (reason === null) {
      related.push(p);
    } else {
      excluded.push({ path: p, reason });
    }
  }

  // Arm a runs the related tests the base has, as mutbox-entry.sh picks them.
  const onBase: Array<string> = [];

  for (const p of base === null ? [] : related) {
    if ((yield* git("cat-file", "-e", `refs/heads/base:${p}`)).code === 0) {
      onBase.push(p);
    }
  }

  if (related.length === 0) {
    return yield* new Stuck({
      reason: "no_tests",
      detail: `every related test was left out: ${excluded.map((e) => `${e.path} (${e.reason})`).join("; ")}`,
    });
  }

  // The image: missing or stale against the lockfile is the same thing, a tag that is not there.
  const dockerfile = yield* fs.readFileString(path.join(here, "mutbox.Dockerfile"));
  const entry = yield* fs.readFileString(path.join(here, "mutbox-entry.sh"));
  const manifest = yield* decoded(Manifest, yield* show("package.json"));
  const pnpm = manifest === null ? null : pnpmVersion(manifest.packageManager);
  const node = baseNode(dockerfile);

  if (manifest === null || pnpm === null || node === null) {
    return yield* new Stuck({
      reason: "bad_manifest",
      detail: "the commit's package.json names no exact pnpm and Node, or the Dockerfile's base has no digest",
    });
  }

  if (manifest.engines.node !== node) {
    return yield* new Stuck({
      reason: "node_mismatch",
      detail: `the commit runs Node ${manifest.engines.node} and the image's base is ${node}; change mutbox.Dockerfile`,
    });
  }

  const ids = yield* git("rev-parse", "build:pnpm-lock.yaml", "build:pnpm-workspace.yaml", "build:patches");
  const hash = yield* sh("git", ["hash-object", "--stdin"], [PLATFORM, pnpm, ids.out, dockerfile, entry].join("\n"));

  if (ids.code !== 0 || hash.code !== 0) {
    return yield* new Stuck({
      reason: "bad_manifest",
      detail: "the commit has no pnpm-lock.yaml, pnpm-workspace.yaml or patches folder",
    });
  }

  const image = imageTag(hash.out.trim());

  if ((yield* docker(["image", "inspect", "--format", "{{.Id}}", image])).code !== 0) {
    const context = yield* fs.makeTempDirectoryScoped({ prefix: "mutbox-" });
    const patches = (yield* git("ls-tree", "-r", "--name-only", "build", "patches/")).out.split("\n").filter(Boolean);
    yield* fs.makeDirectory(path.join(context, "patches"), { recursive: true });
    yield* fs.writeFileString(path.join(context, "Dockerfile"), dockerfile);
    yield* fs.writeFileString(path.join(context, "mutbox-entry.sh"), entry);

    for (const file of ["pnpm-lock.yaml", "pnpm-workspace.yaml", ...patches]) {
      yield* fs.makeDirectory(path.dirname(path.join(context, file)), { recursive: true });
      yield* fs.writeFileString(path.join(context, file), (yield* show(file)) ?? "");
    }

    // The only step with a network: Docker's builder, reading the lockfile's exact versions.
    const built = yield* docker(
      ["build", "--platform", PLATFORM, "--build-arg", `PNPM=${pnpm}`, "--label", LABEL, "--tag", image, context],
      DOCKER_SECONDS.build,
    );

    if (built.code !== 0) {
      return yield* new Stuck({ reason: "image_build_failed", detail: tail(built.err) });
    }
  }

  // The run. A finalizer removes the container whatever happens: a time limit, a signal, a crash.
  const name = `fabrika-mutbox-${ask.ticket}-${process.pid}`;
  // A hung rm here is stopped at its bound; gc's sweep finds the container by its label later.
  yield* Effect.addFinalizer(() => docker(["rm", "-f", name]).pipe(Effect.ignore));
  const ran = yield* sh(
    "docker",
    runArgs({
      name,
      image,
      input,
      output: box,
      ticket: ask.ticket,
      build,
      related,
      lock: ask.lock,
    }),
  ).pipe(Effect.timeoutOption(`${limit} seconds`));

  if (Option.isNone(ran)) {
    // The time limit is the answer; a hung kill is stopped at its bound, and the rm finalizer follows.
    yield* docker(["kill", name]).pipe(Effect.ignore);
    return yield* new Stuck({
      reason: "time_limit",
      detail: `the container passed ${limit} s and was killed; no report was read`,
    });
  }

  if (ran.value.code === 125 || ran.value.code === 127) {
    return yield* new Stuck({ reason: "docker_run_failed", detail: tail(ran.value.err) });
  }

  const sample = yield* decoded(Sample, yield* readOut(box, "b/sample.json"));
  const b = yield* readArm(box, "b", sample?.selected ?? 0);
  const a = yield* readArm(box, "a", sample?.selected ?? 0);
  const baseline = yield* decoded(Baseline, yield* readOut(box, "baseline.json"));
  const tests = (baseline?.testResults ?? []).flatMap((file) =>
    file.assertionResults.map((t) => ({
      name: `${file.name.replace(/^\/repo\//, "")}: ${t.fullName}`,
      status: t.status,
    })),
  );
  // Which base tests passed on the build and ran in arm a; the entry wrote them before arm a.
  const kept = ((yield* readOut(box, "a-kept")) ?? "")
    .trim()
    .split(",")
    .filter((p) => p !== "");
  const aBaseline = yield* decoded(Baseline, yield* readOut(box, "a-baseline.json"));
  const ended = judge({
    exit: ran.value.code,
    sample,
    b: b?.arm ?? null,
    failed: tests.filter((t) => t.status === "failed").map((t) => t.name),
    base: base === null ? null : { a: a?.arm ?? null, has: onBase.length, kept: kept.length },
    owners,
  });
  const summary: Summary = {
    ...stuckSummary(ask, started, "", ""),
    ...ended,
    build,
    base,
    image,
    usage: yield* readUsage(box),
    related,
    excluded,
    skipped: tests.filter((t) => t.status !== "passed" && t.status !== "failed").map((t) => `${t.name} (${t.status})`),
    sample,
    reach: sample?.files === undefined ? null : reachLine(sample.files),
    b: b?.arm ?? null,
    a: a?.arm ?? null,
    narrowing: narrowingUnknown(ended.reason) ? "unknown" : a === null || b === null ? null : narrowed(a.rows, b.rows),
    armA: base === null ? null : { dropped: droppedFromArmA(related, onBase, kept, aBaseline) },
  };
  return summary;
});

const encode = Schema.encodeSync(Schema.fromJsonString(Summary));

const run = Command.make(
  "run",
  {
    checkout: Flag.String("checkout"),
    ticket: Flag.String("ticket"),
    build: Flag.String("build"),
    related: Flag.String("related"),
    out: Flag.String("out"),
    lock: Flag.String("lock"),
    base: Flag.String("base").pipe(Flag.withDefault(undefined)),
    seconds: Flag.Int("seconds").pipe(Flag.withDefault(undefined)),
    plan: Flag.String("plan").pipe(Flag.withDefault(undefined)),
  },
  Effect.fn("mutbox.run")(function* (ask) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const started = Date.now();
    const summary = yield* boxed(ask, started).pipe(
      Effect.scoped,
      // Whatever went wrong, the answer is `stuck`: there is no other way to run the sample.
      Effect.catch((e) =>
        Effect.succeed(
          e._tag === "Stuck"
            ? stuckSummary(ask, started, e.reason, e.detail)
            : e._tag === "CallTimeout"
              ? stuckSummary(ask, started, "docker_timeout", timeoutLine(e))
              : stuckSummary(ask, started, "crash", "a file or folder the run needs could not be read or written"),
        ),
      ),
    );
    const line = encode(summary);
    yield* fs.makeDirectory(ask.out, { recursive: true }).pipe(Effect.ignore);
    yield* fs.writeFileString(path.join(ask.out, "mutbox.json"), `${line}\n`).pipe(Effect.ignore);
    yield* Console.log(line);
    process.exitCode = exitCode(summary.outcome);
  }),
);

/**
 * The lead's gc calls this: no container, and no image older than a week, is left to grow. It is
 * best effort: a Docker call past its bound ends it with one line and exit 0, so the chain goes on.
 */
const gc = Command.make(
  "gc",
  { lock: Flag.String("lock") },
  Effect.fn("mutbox.gc")(
    function* ({ lock }) {
      if ((yield* docker(["version", "--format", "{{.Server.Os}}"])).code !== 0) {
        return yield* Console.log("mutbox gc: Docker is not running; nothing checked");
      }

      const owner = yield* heldBy(lock);

      if (owner !== null) {
        return yield* Console.log(`keep mutbox: a run holds the Docker lock (pid ${owner})`);
      }

      const containers = yield* sweepContainers(lock);
      // Docker's own cleanup: images with our label that no container uses, made over a week ago.
      const pruned = yield* docker(
        ["image", "prune", "--all", "--force", "--filter", `label=${LABEL}`, "--filter", "until=168h"],
        DOCKER_SECONDS.prune,
      );
      const images = pruned.out.split("\n").filter((l) => l.startsWith("untagged: ")).length;
      yield* Console.log(`mutbox gc: removed ${containers} containers and ${images} images`);
    },
    Effect.catchTag("CallTimeout", (e) => Console.log(`mutbox gc: ${timeoutLine(e)}; the rest waits for the next gc`)),
  ),
);

const mutbox = Command.make("mutbox").pipe(Command.withSubcommands([run, gc]));

if (import.meta.main) {
  NodeRuntime.runMain(
    Command.runWith(mutbox, { version: "0.0.0" })(process.argv.slice(2)).pipe(Effect.provide(NodeServices.layer)),
  );
}
