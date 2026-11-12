// Today's lead tooling. ChecksGh's polls are conditional requests; no test here reaches GitHub: a
// spawner in memory stands in for `gh`.
import { Effect, Layer, Option, type Result, Sink, Stream } from "effect";
import { ChildProcessSpawner } from "effect/process";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Checks, type ChecksError, type Job } from "./Checks.ts";
import * as ChecksGh from "./ChecksGh.ts";

const options = { seed: 119120, numRuns: 300 };

/** What one made-up `gh` run prints and how it exits. */
type Ran = { readonly out: string; readonly err?: string; readonly code: number };

const run = (id: number, status: string, conclusion: string | null, slug = "github-actions") => ({
  id,
  name: "typecheck",
  status,
  conclusion,
  app: { slug },
});

const body = (runs: ReadonlyArray<unknown>) => JSON.stringify({ total_count: runs.length, check_runs: runs });

// `gh api -i`, as gh 2.62.0 prints it: the status line ends in a bare newline, each header in CRLF.
const ok = (etag: string, runs: ReadonlyArray<unknown>): Ran => ({
  out: `HTTP/2.0 200 OK\nContent-Type: application/json\r\nEtag: ${etag}\r\nX-Ratelimit-Used: 7\r\n\r\n${body(runs)}`,
  code: 0,
});

const unchanged: Ran = {
  out: "HTTP/2.0 304 Not Modified\nX-Ratelimit-Used: 7\r\n\r\n",
  err: "gh: HTTP 304",
  code: 1,
};

/** A `gh` that answers each call with the next of `answers` and keeps each call's arguments. */
const gh = (answers: ReadonlyArray<Ran>) => {
  const calls: Array<ReadonlyArray<string>> = [];
  const text = (s: string) => Stream.make(new TextEncoder().encode(s));
  const layer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        const answer = answers[calls.length] ?? { out: "", err: "no answer left", code: 1 };
        calls.push(command._tag === "StandardCommand" ? command.args.map(String) : []);
        return ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(27000),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(answer.code)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: text(answer.out),
          stderr: text(answer.err ?? ""),
          all: text(answer.out),
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        });
      }),
    ),
  );
  return { calls, layer };
};

const head = "c".repeat(40);

/** What the polls found, each an answer or a failure, and each call `gh` got. */
type Polled = {
  readonly found: ReadonlyArray<Result.Result<Option.Option<Job>, ChecksError>>;
  readonly calls: ReadonlyArray<ReadonlyArray<string>>;
};

/** One read of the typecheck job at each of `heads`, in order, on one layer; `law` checks them. */
const polled = (answers: ReadonlyArray<Ran>, heads: ReadonlyArray<string>, law: (p: Polled) => void) => {
  const fake = gh(answers);
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest awaits the Promise a test hands back
  return Effect.runPromise(
    Effect.gen(function* () {
      const checks = yield* Checks;
      const found = yield* Effect.forEach(heads, (at) => Effect.result(checks.job(at, "typecheck")), {
        concurrency: 1,
      });
      law({ found, calls: fake.calls });
    }).pipe(Effect.provide(Layer.provide(ChecksGh.layer("example/repo"), fake.layer))),
  );
};

/** The ETag each call sent, `null` for a call with none. */
const sent = (calls: Polled["calls"]) => calls.map((args) => args.find((a) => a.startsWith("If-None-Match: ")) ?? null);

describe("gh api -i's output, today's tooling", () => {
  it("format: the status, the ETag and the body are read from gh's own layout", () => {
    expect(ChecksGh.responseIn(ok('W/"abc"', []).out)).toEqual({ status: 200, etag: 'W/"abc"', body: body([]) });
    expect(ChecksGh.responseIn(unchanged.out)).toEqual({ status: 304, etag: null, body: "" });
  });

  it("pinned: output with no status line has no status, so it never reads as a 304", () => {
    expect(ChecksGh.responseIn("").status).toBeNaN();
    expect(ChecksGh.responseIn('{"message":"Not Found"}').status).toBeNaN();
  });

  it("property: the latest job is GitHub Actions' own run with the highest id, whatever the order", () => {
    const one = fc.record({
      id: fc.integer({ min: 1, max: 2 ** 40 }),
      status: fc.constantFrom("queued", "in_progress", "completed"),
      conclusion: fc.constantFrom(null, "success", "failure"),
      slug: fc.constantFrom("github-actions", "someone-else"),
    });
    fc.assert(
      fc.property(fc.uniqueArray(one, { selector: (r) => r.id, maxLength: 6 }), (runs) => {
        const text = body(runs.map((r) => run(r.id, r.status, r.conclusion, r.slug)));
        const ours = runs.filter((r) => r.slug === "github-actions").toSorted((a, b) => b.id - a.id)[0];
        const want =
          ours === undefined
            ? Option.none()
            : Option.some({ id: ours.id, status: ours.status, conclusion: ours.conclusion });
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: a fast-check property is synchronous
        expect(Effect.runSync(ChecksGh.latestIn(text))).toEqual(want);
      }),
      options,
    );
  });
});

describe("a poll of a job is a conditional request, today's tooling", () => {
  it("scenario: the first poll sends no ETag; each later one sends the last answer's", () =>
    polled(
      [ok('W/"a"', []), unchanged, ok('W/"b"', [run(9, "in_progress", null)]), unchanged],
      [head, head, head, head],
      ({ found, calls }) => {
        expect(sent(calls)).toEqual([null, 'If-None-Match: W/"a"', 'If-None-Match: W/"a"', 'If-None-Match: W/"b"']);
        expect(calls[0]).toEqual([
          "api",
          "-i",
          `repos/example/repo/commits/${head}/check-runs`,
          "-X",
          "GET",
          "-f",
          "check_name=typecheck",
          "-f",
          "filter=latest",
        ]);
        const running = Option.some({ id: 9, status: "in_progress", conclusion: null });
        expect(found.map((r) => (r._tag === "Success" ? r.success : r.failure))).toEqual([
          Option.none(),
          Option.none(),
          running,
          running,
        ]);
      },
    ));

  it("scenario: a 304 answers with what that ETag came with, a finished job included", () =>
    polled([ok('W/"a"', [run(9, "completed", "success")]), unchanged], [head, head], ({ found }) => {
      const want = Option.some({ id: 9, status: "completed", conclusion: "success" });
      expect(found.map((r) => (r._tag === "Success" ? r.success : null))).toEqual([want, want]);
    }));

  it("scenario: another head has its own ETag, so its first poll is unconditional", () =>
    polled([ok('W/"a"', []), ok('W/"z"', []), unchanged], [head, "d".repeat(40), head], ({ calls }) =>
      expect(sent(calls)).toEqual([null, null, 'If-None-Match: W/"a"']),
    ));

  it("scenario: a failed call is a ChecksError with gh's last line, and the next poll still asks", () =>
    polled(
      [{ out: "", err: "gh: HTTP 502", code: 1 }, ok('W/"a"', [run(9, "queued", null)])],
      [head, head],
      ({ found, calls }) => {
        expect(found[0]).toMatchObject({
          _tag: "Failure",
          failure: { reason: `gh api repos/example/repo/commits/${head}/check-runs exited 1: gh: HTTP 502` },
        });
        expect(found[1]).toMatchObject({ _tag: "Success" });
        expect(sent(calls)).toEqual([null, null]);
      },
    ));

  it("scenario: a 304 nobody asked for is a failure, never an answer", () =>
    polled([unchanged], [head], ({ found }) => expect(found[0]).toMatchObject({ _tag: "Failure" })));

  it("scenario: a body that is not check runs fails the poll and keeps no ETag", () =>
    polled(
      [{ out: 'HTTP/2.0 200 OK\nEtag: W/"x"\r\n\r\n{"message":"odd"}', code: 0 }, ok('W/"a"', [])],
      [head, head],
      ({ found, calls }) => {
        expect(found[0]).toMatchObject({
          _tag: "Failure",
          failure: { reason: `GitHub's check runs at ${head} did not parse` },
        });
        expect(sent(calls)).toEqual([null, null]);
      },
    ));
});
