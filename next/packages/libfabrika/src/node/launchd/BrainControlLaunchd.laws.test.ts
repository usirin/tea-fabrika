// P19 next/. These unit laws replace only the native process boundary. Native XML is L13's check.
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Cause, Context, Effect, Exit, FileSystem, Layer, Schema } from "effect";
import * as FilesTest from "../../desktop/BrainFilesTest.ts";
import { BrainProbe, Readiness, Children } from "../../desktop/BrainProbe.ts";
import { BrainService } from "../../desktop/BrainService.ts";
import { SinkError, SpanRow } from "../../telemetry/Trace.ts";
import * as ServiceLaunchd from "./BrainServiceLaunchd.ts";
import * as LaunchdTest from "./Launchd.test-support.ts";

FilesTest.suite(LaunchdTest.nodeFiles);
const options = { arbitrary: { seed: 119120, numRuns: 100 } };
const Value = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9 &<>"雪]{1,30}$/));

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
  "L7 install compiles checked JSON with exact argv and a closed environment",
  [Value],
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
    }).pipe(Effect.provide(NodeServices.layer)),
  options,
);

it.effect.prop(
  "L3 process failures and permission failures retain protected causes",
  [Value, Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 255 })), Schema.Boolean],
  ([word, code, spawnFailure]) =>
    Effect.gen(function* () {
      const secret = `sentinel-${word}/+&`;
      const disk = yield* LaunchdTest.open(spawnFailure ? "spawn" : "none", { code, stdout: secret, stderr: secret });
      const exit = yield* disk.control.inspect.pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
      const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null;
      expect(failure).toMatchObject({ _tag: "BrainControlError", reason: { cause: expect.anything() } });

      for (const output of [
        JSON.stringify(failure),
        String(failure),
        Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "",
      ]) {
        expect(output).not.toContain(secret);
        expect(output).not.toContain(encodeURIComponent(secret));
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  { arbitrary: { seed: 119120, numRuns: 200 } },
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
  [Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4 }))],
  ([attempts]) =>
    Effect.gen(function* () {
      const disk = yield* LaunchdTest.open("none", {
        code: 113,
        stdout: "",
        stderr: 'Could not find service "test.p19.brain" in domain for user gui: 501\n',
      });
      const delivered: Array<(typeof Rows.Type)[number]> = [];
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
        if (!available) {
          return yield* new SinkError({ reason: "unreachable", held: 0, cause: "offline-test-destination" });
        }

        expect(method).toBe("write");
        const rows = yield* Schema.decodeUnknownEffect(Rows)(args[2]);
        delivered.push(...rows);
        return { _tag: "written", count: rows.length };
      });
      const reopen = Effect.fnUntraced(function* (action: "up" | "stop" = "up") {
        const context = yield* Layer.build(
          ServiceLaunchd.layer(disk.spec, disk.settings, probe, forward).pipe(Effect.provide(disk.native)),
        );
        return yield* Context.get(context, BrainService)[action].pipe(Effect.exit);
      });

      for (let n = 0; n < attempts; n++) {
        expect(Exit.isFailure(yield* Effect.scoped(reopen()))).toBe(true);
      }

      expect(delivered).toEqual([]);
      available = true;
      expect(Exit.isSuccess(yield* Effect.scoped(reopen()))).toBe(true);
      expect(Exit.isSuccess(yield* Effect.scoped(reopen("stop")))).toBe(true);
      expect(delivered.length).toBeGreaterThanOrEqual(attempts);
      const actions = delivered.filter(({ span }) => span.name.startsWith("BrainService."));
      expect(actions.length).toBeGreaterThanOrEqual(attempts);

      expect(
        actions.some(
          ({ span }) => span.attributes["fab.action"] === "stop" && span.attributes["fab.confirmation"] === "removed",
        ),
      ).toBe(true);

      for (const { span } of actions) {
        expect(span.attributes).toMatchObject({ "fab.build": disk.spec.build, "fab.settings": disk.settings.hash });
        expect(span.startTimeUnixNano).toMatch(/^\d+$/);
        expect(span.attributes["fab.action"]).toEqual(expect.any(String));
        expect(span.attributes["fab.cmd"]).toEqual(expect.any(String));
        expect(span.attributes["fab.sentAt"]).toEqual(expect.any(String));
        expect(span.attributes["fab.result"]).toEqual(expect.any(String));
        expect(span.attributes["fab.elapsed"]).toEqual(expect.any(Number));
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  options,
);

it.effect.prop(
  "L10 [secrets] native output and inherited env candidates never enter plist or durable files",
  [Value],
  ([word]) =>
    Effect.gen(function* () {
      const secret = `sentinel-${word}/+&=`;
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
        ).pipe(Effect.provide(disk.native)),
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
