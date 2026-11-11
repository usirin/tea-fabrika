// P12, next/. The real instance reports each control failure through supplied platform layers.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeLifecycle } from "@alchemy.run/cloudflare-runtime/core/Runtime";
import { NodeServices } from "@effect/platform-node";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, PlatformError, Sink, Stream, Tracer } from "effect";
import { SecureRandom } from "effect/crypto";
import { ChildProcessSpawner } from "effect/process";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { expect, it, vi } from "vitest";
import { ProcessIdGenerator } from "../../processes/ProcessIdGenerator.ts";
import { rssLayer } from "./dev.fixture.ts";
import { startDev } from "./dev.ts";

const failure = (exit: Exit.Exit<unknown, unknown>, reason: string) => {
  expect(Exit.isFailure(exit)).toBe(true);
  const cause = Exit.isFailure(exit) ? exit.cause : Cause.empty;
  expect(Cause.hasDies(cause)).toBe(false);
  expect(Cause.findErrorOption(cause)).toMatchObject({
    _tag: "Some",
    value: { _tag: "ControlError", reason },
  });
};

const deploy = (port: number) => (local: Context.Context<never>) =>
  Effect.gen(function* () {
    const plugin = [...local.mapUnsafe.values()].find(
      (value) => typeof value === "object" && value !== null && "sockets" in value,
    ) as { start: (ports: Record<string, number>) => Effect.Effect<unknown> };
    Context.get(local, RuntimeLifecycle)({ type: "start", worker: "errors", pid: 27001 });
    yield* plugin.start({ "fabrika-control": port });
  });

for (const mode of ["offline", "unreachable", "json", "schema", "remote"] as const) {
  it(`instance ${mode} exit has its exact ControlError reason`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (id) => {
        const home = mkdtempSync(join(tmpdir(), "p12-err-"));
        vi.stubEnv("FABRIKA_HOME", home);
        const reason = mode === "json" || mode === "schema" ? "bad_row" : mode === "remote" ? `remote-${id}` : mode;
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
          if (mode === "unreachable") {
            throw new Error(id);
          }

          if (mode === "json") {
            return new Response(`{${id}`);
          }

          if (mode === "schema") {
            return Response.json({ error: { reason: [id] } });
          }

          return Response.json({ error: { reason } });
        });

        try {
          const exit = await Effect.runPromiseExit(
            Effect.scoped(
              startDev({ name: "errors", port: 18787, build: id, home }, deploy(mode === "offline" ? 0 : 27002)),
            ).pipe(
              Effect.provide(ProcessIdGenerator.layer),
              Effect.provide(SecureRandom.layerWebCrypto),
              Effect.provide(rssLayer(() => 0)),
              Effect.provide(NodeServices.layer),
            ),
          );
          failure(exit, reason);
          expect(fetch.mock.calls.length === 0).toBe(mode === "offline");
        } finally {
          fetch.mockRestore();
          vi.unstubAllEnvs();
          rmSync(home, { recursive: true, force: true });
        }
      }),
      { seed: 119120, numRuns: 10 },
    );
  });
}

it("instance reports start_timeout when deployment never opens the control listener", async () => {
  await fc.assert(
    fc.asyncProperty(fc.uuid(), async (build) => {
      const home = mkdtempSync(join(tmpdir(), "p12-time-"));
      vi.stubEnv("FABRIKA_HOME", home);

      try {
        const exit = await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const deployed = yield* Deferred.make<void>();
              const running = yield* Effect.forkChild(
                Effect.scoped(
                  startDev({ name: "errors", port: 18787, build, home }, () => Deferred.succeed(deployed, undefined)),
                ),
              );
              yield* Deferred.await(deployed);
              yield* TestClock.adjust("30 seconds");
              return yield* Fiber.await(running);
            }),
          ).pipe(
            Effect.provide(ProcessIdGenerator.layer),
            Effect.provide(SecureRandom.layerWebCrypto),
            Effect.provide(rssLayer(() => 0)),
            Effect.provide(NodeServices.layer),
            Effect.provide(TestClock.layer()),
          ),
        );
        failure(exit, "start_timeout");
      } finally {
        vi.unstubAllEnvs();
        rmSync(home, { recursive: true, force: true });
      }
    }),
    { seed: 119120, numRuns: 5 },
  );
});

for (const mode of ["exit", "spawn"] as const) {
  it(`instance returns sample reason to tracing when RSS ${mode} fails and keeps the brain alive`, async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 255 }), async (code) => {
        const home = mkdtempSync(join(tmpdir(), "p12-rss-"));
        vi.stubEnv("FABRIKA_HOME", home);
        const samples: Array<Exit.Exit<unknown, unknown>> = [];
        const tracer = Tracer.make({
          span: (...args) => {
            const span = Tracer.nativeTracer.span(...args);
            const end = span.end.bind(span);
            span.end = (time, exit) => {
              if (span.name === "brain.checkMemory") {
                samples.push(exit);
              }

              end(time, exit);
            };
            return span;
          },
        });
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => {
          const call = JSON.parse(String(options?.body));
          return Response.json({ value: call.method === "write" ? { _tag: "written" } : null });
        });
        const kill = vi.spyOn(process, "kill").mockReturnValue(true);
        const spawner = Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => {
            if (mode === "spawn") {
              return Effect.fail(
                PlatformError.systemError({
                  module: "ChildProcess",
                  method: "spawn",
                  _tag: "PermissionDenied",
                }),
              );
            }

            return Effect.succeed(
              ChildProcessSpawner.makeHandle({
                pid: ChildProcessSpawner.ProcessId(27003),
                exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
                isRunning: Effect.succeed(false),
                kill: () => Effect.void,
                stdin: Sink.drain,
                stdout: Stream.empty,
                stderr: Stream.empty,
                all: Stream.empty,
                getInputFd: () => Sink.drain,
                getOutputFd: () => Stream.empty,
                unref: Effect.succeed(Effect.void),
              }),
            );
          }),
        );

        try {
          const exit = await Effect.runPromiseExit(
            Effect.scoped(
              Effect.gen(function* () {
                yield* startDev({ name: "errors", port: 18787, build: "test", home }, deploy(27002));
                yield* TestClock.adjust("1 second");
              }),
            ).pipe(
              Effect.provide(ProcessIdGenerator.layer),
              Effect.provide(SecureRandom.layerWebCrypto),
              Effect.provide(spawner),
              Effect.provide(NodeServices.layer),
              Effect.provide(TestClock.layer()),
              Effect.withTracer(tracer),
            ),
          );
          expect(Exit.isSuccess(exit)).toBe(true);
          expect(kill).not.toHaveBeenCalled();
          expect(samples).toHaveLength(1);
          failure(samples[0]!, "sample");
        } finally {
          fetch.mockRestore();
          kill.mockRestore();
          vi.unstubAllEnvs();
          rmSync(home, { recursive: true, force: true });
        }
      }),
      { seed: 119120, numRuns: 5 },
    );
  });
}
