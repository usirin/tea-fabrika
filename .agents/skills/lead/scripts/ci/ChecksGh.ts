// ChecksGh.layer: the Checks service on GitHub's REST API, through `gh api`, the one way the lead
// tooling reaches GitHub. It reads; it never writes. A job is its check run at the head (an Actions
// job's check run id is its job id); a log is the job's own log endpoint. `gh run view --job <id>
// --log-failed` printed nothing for a red typecheck job on 2026-11-11 (gh 2.62.0, job 130712099126),
// so the log comes from the API, which served its 337 lines.
//
// A poll of `job` is a conditional request: it sends the ETag of the last answer for that head and
// name as `If-None-Match`, and GitHub answers 304 with no body while nothing changed. A 304 does
// not count against the login's 5,000 calls an hour (GitHub's REST docs, "Best practices for using
// the REST API": use conditional requests), so a wait spends one call per change of the job, not
// one per poll. Measured here on 2026-11-12: 20 such 304s in 9 seconds moved the count by none.
import { Effect, Layer, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { Checks, ChecksError, type Job } from "./Checks.ts";

/** What `gh api -i` printed: the status line's code, the `ETag` header and the body under them. */
export type Response = { readonly status: number; readonly etag: string | null; readonly body: string };

/** Reads `gh api -i`'s output: a status line, the headers, an empty line, then the body. */
export const responseIn = (out: string): Response => {
  const [head = "", ...rest] = out.split(/\r?\n\r?\n/);
  const lines = head.split(/\r?\n/);
  const status = Number(/^HTTP\/\S+ (\d{3})\b/.exec(lines[0] ?? "")?.[1] ?? Number.NaN);
  const etag = lines.map((line) => /^etag:\s*(\S.*)$/i.exec(line)?.[1]?.trim()).find((e) => e !== undefined);
  return { status, etag: etag ?? null, body: rest.join("\n\n") };
};

const Runs = Schema.fromJsonString(
  Schema.Struct({
    check_runs: Schema.Array(
      Schema.Struct({
        id: Schema.Number,
        status: Schema.String,
        conclusion: Schema.NullOr(Schema.String),
        app: Schema.optional(Schema.NullOr(Schema.Struct({ slug: Schema.String }))),
      }),
    ),
  }),
);

/** The latest check run GitHub Actions made in a check-runs body, as `Job`; none when it lists none. */
export const latestIn = (body: string): Effect.Effect<Option.Option<Job>, Schema.SchemaError> =>
  Effect.map(Schema.decodeUnknownEffect(Runs)(body), ({ check_runs }) => {
    const ours = check_runs.filter((run) => run.app?.slug === "github-actions");
    const latest = ours.reduce<(typeof ours)[number] | undefined>(
      (max, run) => (max === undefined || run.id > max.id ? run : max),
      undefined,
    );
    return latest === undefined
      ? Option.none()
      : Option.some({ id: latest.id, status: latest.status, conclusion: latest.conclusion });
  });

/** `repo` is `owner/name`. */
export const layer = (repo: string): Layer.Layer<Checks, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    Checks,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      // The last answer per head and name, with its ETag: what a 304 stands for.
      const seen = new Map<string, { readonly etag: string; readonly found: Option.Option<Job> }>();

      /** One `gh api` call, run to its end: what it printed and its exit code. */
      const call = Effect.fn("ChecksGh.call")(
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
          return { out, err, code: Number(code) };
        },
        Effect.scoped,
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.catchTag("PlatformError", (e) =>
          Effect.fail(new ChecksError({ reason: `gh could not start: ${e.message}` })),
        ),
      );

      /** Any exit but 0 is a failure, with gh's own last line. */
      const exited = (args: ReadonlyArray<string>, ran: { readonly err: string; readonly code: number }) => {
        const last = ran.err.trim().split("\n").at(-1) ?? "";
        const path = args.find((a) => !a.startsWith("-")) ?? "";
        return new ChecksError({ reason: `gh api ${path} exited ${ran.code}: ${last}` });
      };

      const job = Effect.fn("ChecksGh.job")(function* (head: string, name: string) {
        const key = `${head} ${name}`;
        const before = seen.get(key);
        const path = `repos/${repo}/commits/${head}/check-runs`;
        const query = ["-X", "GET", "-f", `check_name=${name}`, "-f", "filter=latest"];
        const unless = before === undefined ? [] : ["-H", `If-None-Match: ${before.etag}`];
        const args = ["-i", path, ...query, ...unless];
        const ran = yield* call(args);
        const response = responseIn(ran.out);

        // Not modified: gh exits 1 on a 304, and the answer is the one that ETag came with.
        if (response.status === 304 && before !== undefined) {
          return before.found;
        }

        if (ran.code !== 0) {
          return yield* exited(args, ran);
        }

        const found = yield* latestIn(response.body).pipe(
          Effect.mapError(() => new ChecksError({ reason: `GitHub's check runs at ${head} did not parse` })),
        );

        if (response.etag === null) {
          seen.delete(key);
        } else {
          seen.set(key, { etag: response.etag, found });
        }

        return found;
      });

      const log = Effect.fn("ChecksGh.log")(function* (id: number) {
        const args = [`repos/${repo}/actions/jobs/${id}/logs`];
        const ran = yield* call(args);
        return ran.code === 0 ? ran.out : yield* exited(args, ran);
      });

      return Checks.of({ job, log });
    }),
  );
