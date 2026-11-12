// ChecksGh.layer: the Checks service on GitHub's REST API, through `gh api`, the one way the lead
// tooling reaches GitHub. It reads; it never writes. A job is its check run at the head (an Actions
// job's check run id is its job id); a log is the job's own log endpoint. `gh run view --job <id>
// --log-failed` printed nothing for a red typecheck job on 2026-11-11 (gh 2.62.0, job 130712099126),
// so the log comes from the API, which served its 337 lines.
import { Effect, Layer, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Checks, ChecksError, Job } from "./Checks.ts";

/** The latest check run GitHub Actions made, as `Job`, or `null` when there is none yet. */
const LATEST =
  '[.check_runs[] | select(.app.slug == "github-actions")] | max_by(.id)' +
  " | if . == null then null else {id, status, conclusion} end";

const Answer = Schema.fromJsonString(Schema.NullOr(Job));

/** `repo` is `owner/name`. */
export const layer = (repo: string): Layer.Layer<Checks, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    Checks,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      /** One `gh api` call; any exit but 0 fails it with gh's own last line. */
      const api = Effect.fn("ChecksGh.api")(
        function* (args: ReadonlyArray<string>) {
          const handle = yield* ChildProcess.make("gh", ["api", ...args], { stdin: "ignore" });
          const [out, err, code] = yield* Effect.all(
            [
              Stream.mkString(Stream.decodeText(handle.stdout)),
              Stream.mkString(Stream.decodeText(handle.stderr)),
              handle.exitCode,
            ],
            { concurrency: 3 },
          );

          if (Number(code) !== 0) {
            const last = err.trim().split("\n").at(-1) ?? "";
            return yield* new ChecksError({ reason: `gh api ${args[0] ?? ""} exited ${code}: ${last}` });
          }

          return out;
        },
        Effect.scoped,
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(new ChecksError({ reason: `gh could not start: ${e.message}` })),
        ),
      );

      const job = Effect.fn("ChecksGh.job")(function* (head: string, name: string) {
        const path = `repos/${repo}/commits/${head}/check-runs`;
        const query = ["-X", "GET", "-f", `check_name=${name}`, "-f", "filter=latest", "--jq", LATEST];
        const out = yield* api([path, ...query]);
        const found = yield* Schema.decodeUnknownEffect(Answer)(out.trim() || "null").pipe(
          Effect.mapError(() => new ChecksError({ reason: `GitHub's check runs at ${head} did not parse` })),
        );
        return Option.fromNullOr(found);
      });

      const log = (id: number) => api([`repos/${repo}/actions/jobs/${id}/logs`]);

      return Checks.of({ job, log });
    }),
  );
