/**
 * The hourly mutation run's heartbeat: is a merge on main waiting more than two hours for a passing
 * run? Today's lead tooling. The run has no clock of its own: a scheduler session dispatches it each
 * hour (0067), and when that session dies, or every run fails, nothing says so. On 2026-11-11 no
 * run started for three hours while about twenty merges landed, and three of the first four runs
 * failed. `.github/workflows/mutation-heartbeat.yaml` runs this each hour and goes red when late:
 *
 *   node .agents/skills/mutation/scripts/heartbeat.ts
 *   mutation heartbeat: late: 21 merges since the last passing run (2026-11-11T05:40:24Z), the oldest 3.1 h ago
 *
 * It starts no run and reads no artifact; it only reads the list of runs and main's commits, with
 * `gh api`, in the repo `GH_REPO` names (gh's own setting).
 *
 * Two hours: a merge lands just after a dispatch and waits up to one hour for the next, then the run
 * takes up to the workflow's 45-minute limit; the rest is slack. A skipped run (no test beside a
 * changed file) passes, so a quiet range never reads as late.
 *
 * Hand-written, since no tool here does it (0040): GitHub's own scheduled-run failure mail needs
 * a scheduled run, and 0067 keeps mutation.yaml dispatch-only; healthchecks.io-style dead-man
 * switches are a paid or outside account, which AGENTS.md rules out. Its edge cases, each in the
 * test:
 *
 * - No merge since the last passing run: ok, however old that run is (no merge, no run, 0067).
 * - Merges all younger than two hours: ok.
 * - A merge exactly two hours old: not yet late; one millisecond more is.
 * - No passing run ever: late once any listed merge is two hours old.
 * - A merge stamped in the future (a skewed clock): never late on its own.
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Clock, Console, Effect, Schema, Stream } from "effect";
import { ChildProcess } from "effect/process";

/** How long a merge may wait for a passing run, in ms. */
export const LATE = 2 * 60 * 60 * 1000;

export const Beat = Schema.TaggedUnion({
  ok: { lastPass: Schema.NullOr(Schema.Number), merges: Schema.Number },
  late: { lastPass: Schema.NullOr(Schema.Number), merges: Schema.Number, oldest: Schema.Number },
});
export type Beat = typeof Beat.Type;

/** The heartbeat at `now`, from the last passing run's start and the merges on main since. Pure. */
export const beat = (now: number, lastPass: number | null, merges: ReadonlyArray<number>): Beat => {
  const oldest = Math.min(...merges);
  return merges.length > 0 && now - oldest > LATE
    ? Beat.cases.late.make({ lastPass, merges: merges.length, oldest })
    : Beat.cases.ok.make({ lastPass, merges: merges.length });
};

const iso = (ms: number | null) => (ms === null ? "none" : new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z"));
const hours = (ms: number) => `${(ms / 3_600_000).toFixed(1)} h`;

/** The one line it prints. Pure. */
export const line = (now: number, b: Beat): string =>
  b._tag === "late"
    ? `mutation heartbeat: late: ${b.merges} merges since the last passing run (${iso(b.lastPass)}), the oldest ${hours(now - b.oldest)} ago`
    : `mutation heartbeat: ok: ${b.merges} merges since the last passing run (${iso(b.lastPass)})`;

const Runs = Schema.fromJsonString(
  Schema.Struct({ workflow_runs: Schema.Array(Schema.Struct({ created_at: Schema.String })) }),
);

const Commits = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ commit: Schema.Struct({ committer: Schema.Struct({ date: Schema.String }) }) })),
);

/** A `gh api` read that failed, with its stderr. */
class ReadFailed extends Schema.TaggedError<ReadFailed>()("ReadFailed", {
  path: Schema.String,
  reason: Schema.String,
}) {}

/** The heartbeat is late; its line is already printed. */
class Late extends Schema.TaggedError<Late>()("Late", {}) {}

/** One `gh api` read: its stdout, or a failure with its stderr. */
const gh = Effect.fn("heartbeat.gh")(function* (path: string) {
  const handle = yield* ChildProcess.make("gh", ["api", path]);
  const [out, err, code] = yield* Effect.all(
    [
      Stream.mkString(Stream.decodeText(handle.stdout)),
      Stream.mkString(Stream.decodeText(handle.stderr)),
      handle.exitCode,
    ],
    { concurrency: 3 },
  );
  return Number(code) === 0 ? out : yield* new ReadFailed({ path, reason: err.trim() });
}, Effect.scoped);

const main = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const runs = yield* Schema.decodeUnknownEffect(Runs)(
    yield* gh("repos/{owner}/{repo}/actions/workflows/mutation.yaml/runs?status=success&per_page=1"),
  );
  const passed = runs.workflow_runs[0];
  const lastPass = passed === undefined ? null : Date.parse(passed.created_at);
  const since = lastPass === null ? "" : `&since=${iso(lastPass)}`;
  const commits = yield* Schema.decodeUnknownEffect(Commits)(
    yield* gh(`repos/{owner}/{repo}/commits?sha=main&per_page=100${since}`),
  );
  const b = beat(
    now,
    lastPass,
    commits.map((c) => Date.parse(c.commit.committer.date)),
  );
  yield* Console.log(line(now, b));

  if (b._tag === "late") {
    return yield* new Late();
  }
});

// Exit 0 when ok, 1 when late or when a read failed; the line, or the failure, says which.
if (import.meta.main) {
  NodeRuntime.runMain(
    main.pipe(
      Effect.tapError((error) => (error._tag === "Late" ? Effect.void : Console.error(`mutation heartbeat: ${error}`))),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
