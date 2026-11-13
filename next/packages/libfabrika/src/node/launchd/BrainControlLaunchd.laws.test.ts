// P19 next/. These unit laws replace only the native process boundary. Native XML is L13's check.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Cause, Context, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Outside from "../../desktop/BrainControl.test-support.ts";
import { BrainControl } from "../../desktop/BrainControl.ts";
import * as FilesTest from "../../desktop/BrainFilesTest.ts";
import { BrainProbe, Readiness, Children } from "../../desktop/BrainProbe.ts";
import { BrainService } from "../../desktop/BrainService.ts";
import * as Managed from "../../desktop/BrainServiceManaged.ts";
import type { BrainSpec } from "../../desktop/BrainSpec.ts";
import { Archive } from "../../telemetry/Archive.ts";
import { RecordManager } from "../../telemetry/Records.ts";
import { SpanSink } from "../../telemetry/Sink.ts";
import { SinkError, SpanRow } from "../../telemetry/Trace.ts";
import * as ServiceLaunchd from "./BrainServiceLaunchd.ts";
import * as LaunchdTest from "./Launchd.test-support.ts";

FilesTest.suite(LaunchdTest.nodeFiles);
const options = { arbitrary: { seed: 119120, runs: 100 } };
const Value = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9 &<>"雪]{1,30}$/));
const NativeValue = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9雪][a-zA-Z0-9 &<>雪]{0,28}[a-zA-Z0-9雪]$/));

const Signal = Schema.Literals([
  "SIGHUP",
  "SIGINT",
  "SIGQUIT",
  "SIGILL",
  "SIGTRAP",
  "SIGABRT",
  "SIGBUS",
  "SIGKILL",
  "SIGSEGV",
  "SIGPIPE",
  "SIGALRM",
  "SIGTERM",
  "SIGUSR1",
  "SIGUSR2",
]);

const Job = Schema.Struct({
  Label: Schema.NonEmptyString,
  ProgramArguments: Schema.Array(Schema.String),
  EnvironmentVariables: Schema.Record(Schema.String, Schema.String),
  RunAtLoad: Schema.Boolean,
  KeepAlive: Schema.Struct({ SuccessfulExit: Schema.Boolean }),
  ThrottleInterval: Schema.Int,
  AbandonProcessGroup: Schema.Boolean,
});

it.effect.prop(
  "L2/L5 removal at or after the stop deadline restores the real plist and can be retried",
  [Schema.Boolean, Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 }))],
  ([initiallyLoaded, late]) =>
    Effect.gen(function* () {
      const outside = yield* Outside.make({ job: initiallyLoaded ? Outside.loaded() : Outside.absent });
      const disk = yield* LaunchdTest.open(
        "none",
        Effect.fnUntraced(function* (args: ReadonlyArray<string>, spec: BrainSpec) {
          if (args.includes("bootout")) {
            yield* outside.observe({ job: Outside.absent });
          }

          if (!args.includes("print")) {
            return { code: 0, stdout: "", stderr: "" };
          }

          if ((yield* outside.read).job._tag === "absent") {
            return {
              code: 113,
              stdout: "",
              stderr: 'Could not find service "test.p19.brain" in domain for user gui: 501\n',
            };
          }

          return {
            code: 0,
            stderr: "",
            stdout: [
              `${args.at(-1)} = {`,
              "\tstate = running",
              `\tprogram = ${spec.executable}`,
              "\targuments = {",
              ...[spec.executable, ...spec.args].map((arg) => `\t\t${arg}`),
              "\t}",
              "\tenvironment = {",
              "\t\tELECTRON_RUN_AS_NODE => 1",
              `\t\tFABRIKA_HOME => ${spec.home}`,
              `\t\tFABRIKA_BUILD => ${spec.build}`,
              "\t}",
              "\tpid = 81",
              "}",
            ].join("\n"),
          };
        }),
      );
      yield* disk.control.install;
      const original = yield* disk.read;
      expect(original).not.toBeNull();
      const removalObservations: Array<string | null> = [];
      const removed = yield* Deferred.make<void>();
      const reply = yield* Deferred.make<void>();
      const control = Layer.succeed(BrainControl, {
        ...disk.control,
        remove: disk.control.remove.pipe(
          Effect.tap(() =>
            Effect.gen(function* () {
              removalObservations.push(yield* disk.read);

              // A native completion can arrive after its work succeeded but before the driver accepts its reply.
              if (removalObservations.length === 1) {
                yield* Deferred.succeed(removed, undefined);
                yield* Deferred.await(reply);
              }
            }),
          ),
          Effect.uninterruptible,
        ),
      });
      const context = yield* Layer.build(
        Managed.layer(disk.spec, disk.settings).pipe(
          Layer.provide(
            Layer.mergeAll(
              control,
              Layer.succeed(BrainProbe, {
                ready: Effect.succeed(Readiness.cases.ready.make({})),
                cleanup: Effect.succeed(Children.cases.gone.make({})),
              }),
              Layer.succeed(SpanSink, {
                batch: (work) => work,
                flush: Effect.succeed({ sent: 0 }),
                check: Effect.void,
                summaries: () => Effect.succeed([]),
                sums: () => Effect.succeed([]),
              }),
              RecordManager.memory(1_000_000),
              Archive.memory,
            ),
          ),
        ),
      );
      const brain = Context.get(context, BrainService);
      const stopping = yield* Effect.forkScoped(brain.stop);
      yield* Deferred.await(removed);
      yield* TestClock.adjust(Number(disk.settings.values["desktop.brain-stop-timeout"]) + late);
      yield* Deferred.succeed(reply, undefined);
      const expired = yield* Fiber.await(stopping);
      expect(Exit.isFailure(expired) ? Cause.squash(expired.cause) : null).toMatchObject({
        _tag: "BrainServiceError",
        reason: { _tag: "Timeout", action: "stop" },
      });
      expect(removalObservations).toEqual([null]);
      expect(yield* disk.read).toBe(original);
      expect(disk.seen.filter((call) => call.args.includes("bootout"))).toHaveLength(initiallyLoaded ? 1 : 0);
      const from = disk.seen.length;
      expect(Exit.isSuccess(yield* brain.stop.pipe(Effect.exit))).toBe(true);
      expect(disk.seen.slice(from).find((call) => call.executable.endsWith("launchctl"))?.args[0]).toBe("print");
      expect(removalObservations).toEqual([null, null]);
      expect(yield* disk.read).toBeNull();
      expect(disk.seen.filter((call) => call.args.includes("bootout"))).toHaveLength(initiallyLoaded ? 1 : 0);
    }).pipe(Effect.provide(NodeServices.layer)),
  options,
);

it.effect.prop(
  "L7 install compiles checked JSON with exact argv and a closed environment",
  [NativeValue],
  ([word]) =>
    Effect.gen(function* () {
      const disk = yield* LaunchdTest.open("none", undefined, { args: ["entry.mjs", word] });
      yield* disk.control.install;
      const job = yield* Schema.decodeUnknownEffect(Job)(disk.jobs.at(-1));
      expect(job.ProgramArguments).toEqual([disk.spec.executable, ...disk.spec.args]);
      expect(job.KeepAlive).toEqual({ SuccessfulExit: false });
      expect(job.RunAtLoad).toBe(true);
      expect(job.AbandonProcessGroup).toBe(false);
      expect(job.ThrottleInterval).toBe(disk.settings.values["desktop.brain-throttle"]);
      expect(job.ThrottleInterval).toBeGreaterThan(0);
      const fs = yield* FileSystem.FileSystem;
      expect((yield* fs.stat(`${disk.home}/brain.plist`)).mode & 0o777).toBe(0o600);
      expect(job.EnvironmentVariables).toEqual({
        ELECTRON_RUN_AS_NODE: "1",
        FABRIKA_HOME: disk.spec.home,
        FABRIKA_BUILD: disk.spec.build,
      });
      expect(disk.seen.some((call) => /(?:sh|bash|zsh)$/.test(call.executable))).toBe(false);
      const compile = disk.seen.find((call) => call.executable.endsWith("plutil"));
      expect(compile?.args).toContain("xml1");
      expect(compile?.options.shell).not.toBe(true);
      expect(disk.seen.every((call) => call.options.extendEnv === false)).toBe(true);
    }).pipe(Effect.provide(NodeServices.layer)),
  options,
);

it.effect.prop(
  "L3 process failures retain protected causes and observed native exit codes or signals",
  [Value, Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 255 })), Schema.Boolean, Schema.NullOr(Signal)],
  ([word, code, spawnFailure, signal]) =>
    Effect.gen(function* () {
      const secret = `sentinel-${word}/+&`;
      const disk = yield* LaunchdTest.open(spawnFailure ? "spawn" : "none", {
        code,
        stdout: secret,
        stderr: secret,
        ...(signal === null ? {} : { signal }),
      });
      const exit = yield* disk.control.inspect.pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
      expect(failure).toMatchObject({ _tag: "BrainControlError", reason: { cause: expect.anything() } });

      if (!spawnFailure) {
        expect(failure).toMatchObject({
          reason: { _tag: "Command", ...(signal === null ? { code } : { signal }) },
        });

        if (signal !== null) {
          expect(failure).not.toMatchObject({ reason: { code: expect.any(Number) } });
        }
      }

      for (const output of [
        JSON.stringify(failure),
        String(failure),
        Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "",
      ]) {
        expect(output).not.toContain(secret);
        expect(output).not.toContain(encodeURIComponent(secret));
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { seed: 119120, runs: 200 } },
);

it.effect.prop(
  "L7 a home deterministically owns one label and distinct homes do not share it",
  [Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 4 }))],
  ([count]) =>
    Effect.gen(function* () {
      const labels = new Set<string>();

      for (let n = 0; n < count; n++) {
        const disk = yield* LaunchdTest.open();
        yield* disk.control.install;
        const first = yield* Schema.decodeUnknownEffect(Job)(disk.jobs.at(-1));
        labels.add(first.Label);
        yield* disk.control.install;
        expect((yield* Schema.decodeUnknownEffect(Job)(disk.jobs.at(-1))).Label).toBe(first.Label);
        yield* disk.control.start;
        const start = disk.seen.find((call) => call.args.includes("bootstrap"));
        expect(start?.args).toEqual(["bootstrap", "gui/501", `${disk.home}/brain.plist`]);
      }

      expect(labels.size).toBe(count);
    }).pipe(Effect.provide(NodeServices.layer)),
  options,
);

const Rows = Schema.Array(Schema.Struct({ span: SpanRow, content: Schema.NullOr(Schema.String) }));

it.effect.prop(
  "L9 failed delivery survives reopening and keeps each action's facts until acknowledgement",
  [Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 })), Signal],
  ([attempts, observedSignal]) =>
    Effect.forEach(
      [null, observedSignal],
      (signal) =>
        Effect.scoped(
          Effect.gen(function* () {
            const disk = yield* LaunchdTest.open("none", {
              code: 113,
              stdout: "",
              stderr: 'Could not find service "test.p19.brain" in domain for user gui: 501\n',
              ...(signal === null ? {} : { signal }),
            });
            const delivered: Array<(typeof Rows.Type)[number]> = [];
            const refused = new Map<string, (typeof Rows.Type)[number]>();
            let available = false;
            const probe = Layer.succeed(BrainProbe, {
              ready: Effect.succeed(Readiness.cases.ready.make({})),
              cleanup: Effect.succeed(Children.cases.gone.make({})),
            });
            const forward = Effect.fnUntraced(function* (
              _target: "record" | "bucket",
              _name: string,
              method: string,
              args: ReadonlyArray<unknown>,
            ) {
              expect(method).toBe("write");
              const rows = yield* Schema.decodeUnknownEffect(Rows)(args[2]);

              if (!available) {
                for (const row of rows) {
                  refused.set(row.span.spanId, row);
                }

                return yield* new SinkError({ reason: "unreachable", held: 0, cause: "offline-test-destination" });
              }

              delivered.push(...rows);
              return { _tag: "written", count: rows.length };
            });
            const reopen = Effect.fnUntraced(function* (action: "up" | "stop" = "up") {
              const context = yield* Layer.build(
                ServiceLaunchd.layer(disk.spec, disk.settings, probe, forward).pipe(Layer.provide(disk.native)),
              );
              return yield* Context.get(context, BrainService)[action].pipe(Effect.exit);
            });

            for (let n = 0; n < attempts; n++) {
              expect(Exit.isFailure(yield* Effect.scoped(reopen()))).toBe(true);
            }

            expect(delivered).toEqual([]);
            expect(refused.size).toBeGreaterThan(0);
            available = true;
            expect(Exit.isSuccess(yield* Effect.scoped(reopen()))).toBe(signal === null);
            expect(Exit.isSuccess(yield* Effect.scoped(reopen("stop")))).toBe(signal === null);

            for (const [id, row] of refused) {
              expect(delivered.filter(({ span }) => span.spanId === id)).toEqual([row]);
            }

            expect(delivered.length).toBeGreaterThanOrEqual(attempts);
            const actions = delivered.filter(({ span }) => span.name.startsWith("BrainService."));
            expect(actions.length).toBeGreaterThanOrEqual(attempts);
            expect(actions.some(({ span }) => span.attributes["fab.result"] === "delivery_failed")).toBe(true);

            if (signal === null) {
              expect(
                actions.some(
                  ({ span }) =>
                    span.attributes["fab.action"] === "stop" && span.attributes["fab.confirmation"] === "removed",
                ),
              ).toBe(true);
            } else {
              const commands = delivered.filter(
                ({ span }) => span.name === "BrainService.command" && span.attributes["fab.result"] === "Command",
              );
              expect(commands.length).toBeGreaterThanOrEqual(attempts + 2);

              for (const { span } of commands) {
                expect(span.attributes["fab.native.signal"]).toBe(signal);
                expect(span.attributes["fab.native.code"]).toBeUndefined();
              }
            }

            for (const { span } of actions) {
              expect(span.attributes).toMatchObject({
                "fab.build": disk.spec.build,
                "fab.settings": disk.settings.hash,
              });
              expect(span.startTimeUnixNano).toMatch(/^\d+$/);
              expect(span.attributes["fab.action"]).toEqual(expect.any(String));
              expect(span.attributes["fab.cmd"]).toEqual(expect.any(String));
              expect(span.attributes["fab.sentAt"]).toEqual(expect.any(String));
              expect(span.attributes["fab.result"]).toEqual(expect.any(String));
              expect(span.attributes["fab.elapsed"]).toEqual(expect.any(Number));
            }
          }),
        ).pipe(Effect.provide(NodeServices.layer)),
      { discard: true, concurrency: 1 },
    ),
  options,
);

it.effect.prop(
  "L10 [secrets] native output and inherited env candidates never enter plist or durable files",
  [Value],
  ([word]) =>
    Effect.gen(function* () {
      const secret = `sentinel-${word}/+&=`;
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const previous = process.env.FABRIKA_P19_SENTINEL;
          process.env.FABRIKA_P19_SENTINEL = secret;
          return previous;
        }),
        (previous) =>
          Effect.sync(() => {
            if (previous === undefined) {
              delete process.env.FABRIKA_P19_SENTINEL;
            } else {
              process.env.FABRIKA_P19_SENTINEL = previous;
            }
          }),
      );
      const disk = yield* LaunchdTest.open("none", { code: 5, stdout: secret, stderr: secret });
      yield* disk.control.install;
      const sent: Array<unknown> = [];
      const probe = Layer.succeed(BrainProbe, {
        ready: Effect.succeed(Readiness.cases.ready.make({})),
        cleanup: Effect.succeed(Children.cases.gone.make({})),
      });
      const context = yield* Layer.build(
        ServiceLaunchd.layer(
          disk.spec,
          disk.settings,
          probe,
          (_target: "record" | "bucket", _name: string, _method: string, args: ReadonlyArray<unknown>) =>
            Effect.sync(() => {
              sent.push(args);
              return { _tag: "written" };
            }),
        ).pipe(Layer.provide(disk.native)),
      );
      const failed = yield* Context.get(context, BrainService).up.pipe(Effect.exit);
      expect(Exit.isFailure(failed)).toBe(true);
      const fs = yield* FileSystem.FileSystem;
      const outputs = [yield* disk.read, JSON.stringify(disk.jobs), JSON.stringify(sent), JSON.stringify(failed)];

      for (const name of yield* fs.glob("**/*", { root: disk.home })) {
        const stat = yield* fs.stat(`${disk.home}/${name}`);

        if (stat.type === "File") {
          outputs.push(new TextDecoder().decode(yield* fs.readFile(`${disk.home}/${name}`)));
        }
      }

      for (const output of outputs) {
        for (const form of [
          secret,
          encodeURIComponent(secret),
          JSON.stringify([...new TextEncoder().encode(secret)]),
        ]) {
          expect(output).not.toContain(form);
        }
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  options,
);

it.effect.prop(
  "L7 values launchctl print cannot represent are refused before publication or bootstrap",
  [
    NativeValue,
    Schema.Literals(["quote", "backslash", "brace", "leading", "trailing"]),
    Schema.Literals(["args", "executable", "build", "home"]),
  ],
  ([word, corruption, field]) =>
    Effect.gen(function* () {
      const value =
        corruption === "quote"
          ? `${word}"tail`
          : corruption === "backslash"
            ? `${word}\\tail`
            : corruption === "brace"
              ? `${word}{tail}`
              : corruption === "leading"
                ? ` ${word}`
                : `${word} `;
      const input =
        field === "args"
          ? { args: [value] }
          : field === "executable"
            ? { executable: corruption === "leading" ? `/test/${word} ` : `/test/${value}` }
            : field === "build"
              ? { build: value }
              : {};
      const opened: Array<Effect.Success<ReturnType<typeof LaunchdTest.open>>> = [];
      const exit = yield* Effect.gen(function* () {
        const disk = yield* LaunchdTest.open(
          "none",
          undefined,
          input,
          field === "home" ? (corruption === "leading" ? `${word} ` : value) : "",
        );
        opened.push(disk);
        yield* disk.control.install;
      }).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : null).toMatchObject({
        _tag: "BrainControlError",
        reason: { _tag: "Unsupported", cause: expect.anything() },
      });

      for (const disk of opened) {
        expect(yield* disk.read).toBeNull();
        expect(disk.seen.some((call) => call.args.includes("bootstrap"))).toBe(false);
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  options,
);
