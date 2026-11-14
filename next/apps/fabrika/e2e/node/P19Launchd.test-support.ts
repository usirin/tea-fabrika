import { createRequire } from "node:module"; // edge: Electron exports its executable through Node's require resolution
// P19 next/. Host-only. The guard is a separate process, so worker SIGKILL cannot skip cleanup.
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { BrainControl } from "@kampus/libfabrika/desktop/BrainControl";
import {
  BrainProbe,
  BrainProbeError,
  Unreachable,
  Cleanup,
  Readiness,
  Children,
} from "@kampus/libfabrika/desktop/BrainProbe";
import { BrainService } from "@kampus/libfabrika/desktop/BrainService";
import { BrainSpec } from "@kampus/libfabrika/desktop/BrainSpec";
import * as Native from "@kampus/libfabrika/node/launchd/BrainControlLaunchd";
import * as ServiceLaunchd from "@kampus/libfabrika/node/launchd/BrainServiceLaunchd";
import * as LaunchdStatus from "@kampus/libfabrika/node/launchd/LaunchdStatus";
import * as ProcessGroups from "@kampus/libfabrika/node/launchd/ProcessGroups.test-support";
import * as Declarations from "@kampus/libfabrika/settings/Declarations";
import * as Snapshot from "@kampus/libfabrika/settings/Snapshot";
import * as Sources from "@kampus/libfabrika/settings/Sources";
import { Written } from "@kampus/libfabrika/telemetry/Records";
import {
  Clock,
  Context,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  Redacted,
  Result,
  Schedule,
  Schema,
  Stream,
} from "effect";
import { Digest } from "effect/crypto";
import { FetchHttpClient, HttpClient } from "effect/http";
import { ChildProcess } from "effect/process";
import { rolldown, type PreRenderedChunk } from "rolldown";
import { build } from "../../src/build.ts";

class HostError extends Schema.TaggedError<HostError>()("HostError", {
  reason: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

const fail = (cause: unknown) => new HostError({ reason: "host-check", cause: Redacted.make(cause) });
const checked = (ok: boolean, reason: string) => (ok ? Effect.void : Effect.fail(new HostError({ reason })));

const command = Effect.fn("P19Host.command")(function* (executable: string, args: ReadonlyArray<string>) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(executable, args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const [code, stdout, stderr] = yield* Effect.all(
        [
          handle.exitCode,
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
        ],
        { concurrency: "unbounded" },
      );
      return { code: Number(code), stdout, stderr };
    }),
  );
});

const wait = Effect.fn("P19Host.wait")(function* <E, R>(condition: Effect.Effect<boolean, E, R>, duration: number) {
  yield* condition.pipe(
    Effect.repeat({ schedule: Schedule.spaced("100 millis"), until: (value) => value }),
    Effect.timeout(`${duration} millis`),
  );
});

const alive = (pid: number) =>
  Effect.sync(() => {
    // Effect has no non-owning probe for an OS process or process group.
    const result = Result.try(() => process.kill(pid, 0));
    return (
      Result.isSuccess(result) ||
      !(result.failure instanceof Error && "code" in result.failure && result.failure.code === "ESRCH")
    );
  });

const processes = Effect.fn("P19Host.processes")(function* () {
  const out = yield* command("ps", ["-axo", "pid=,ppid=,pgid="]);
  yield* checked(out.code === 0, "cannot-observe-processes");
  return yield* Schema.decodeUnknownEffect(Schema.Array(ProcessGroups.Row))(
    out.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [pid, parent, group] = line.trim().split(/\s+/).map(Number);
        return { pid, parent, group };
      }),
  );
});

/**
 * The one place a group is signaled. The group is decoded again here: a 0 or a 1 fails the test
 * and never reaches `kill`, where -1 means every process this user owns.
 */
const signal = Effect.fn("P19Host.signal")(function* (name: "TERM" | "KILL", group: number) {
  const owned = yield* Schema.decodeUnknownEffect(ProcessGroups.Owned)(group).pipe(
    Effect.mapError((cause) => new HostError({ reason: "refused-group", cause: Redacted.make(cause) })),
  );
  yield* command("kill", [`-${name}`, `-${owned}`]);
});

const Config = Schema.Struct({
  home: Schema.String,
  // One service, `gui/<uid>/<label>`. A bare domain would let `launchctl bootout` end the whole login.
  target: Schema.String.check(Schema.isPattern(/^gui\/[1-9][0-9]*\/[A-Za-z0-9][A-Za-z0-9._-]+$/u)),
  url: Schema.String,
  owner: Schema.Int,
  stopTimeout: Schema.Int,
  poll: Schema.Int,
});
type Config = typeof Config.Type;

const status = Effect.fn("P19Host.status")(function* (target: string) {
  const out = yield* command("launchctl", ["print", target]);
  return yield* LaunchdStatus.decode({
    target,
    code: out.code,
    stdout: Redacted.make(out.stdout),
    stderr: Redacted.make(out.stderr),
  });
});

const listening = (url: string) =>
  HttpClient.get(url).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
    Effect.provide(FetchHttpClient.layer),
  );

/** Registered before bootstrap. The parent waits for this process's ready file first. */
const guard = Effect.fn("P19Host.guard")(function* (file: string) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const config = yield* fs
    .readFileString(file)
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Config))));
  const groups = new Set<number>();
  const acquireGroups = Effect.gen(function* () {
    const loaded = yield* status(config.target);

    if (loaded._tag === "loaded" && loaded.pid !== null) {
      const rows = yield* processes();

      for (const group of ProcessGroups.descendants(rows, loaded.pid)) {
        groups.add(group);
      }

      yield* fs.writeFileString(`${config.home}/groups.json`, JSON.stringify([...groups]));
    }
  });
  const cleanup = Effect.gen(function* () {
    // An exact service target, then only groups observed as that service's descendants.
    yield* command("launchctl", ["bootout", config.target]);
    yield* wait(status(config.target).pipe(Effect.map((value) => value._tag === "absent")), config.stopTimeout);

    for (const group of groups) {
      if (yield* alive(-group)) {
        yield* signal("TERM", group);
      }
    }

    const gone = Effect.gen(function* () {
      for (const group of groups) {
        if (yield* alive(-group)) {
          return false;
        }
      }

      return !(yield* listening(config.url));
    });
    yield* wait(gone, config.stopTimeout).pipe(
      Effect.catch(() =>
        Effect.gen(function* () {
          for (const group of groups) {
            if (yield* alive(-group)) {
              yield* signal("KILL", group);
            }
          }
        }),
      ),
    );
    yield* wait(gone, config.stopTimeout);
    yield* fs.remove(`${config.home}/brain.plist`, { force: true });
    yield* fs.writeFileString(`${config.home}/guard.result`, JSON.stringify({ leftovers: [] }));
  });
  yield* Effect.acquireRelease(Effect.void, () =>
    cleanup.pipe(
      Effect.onExit((exit) =>
        Effect.gen(function* () {
          const result = JSON.stringify({ leftovers: Exit.isSuccess(exit) ? [] : ["cleanup-unconfirmed"] });
          yield* fs.writeFileString(`${config.home}/guard.result`, result);

          if (!(yield* alive(config.owner))) {
            const archive = path.resolve("runs/p19", `guard-${config.owner}.json`);
            yield* fs.makeDirectory(path.dirname(archive), { recursive: true });
            yield* fs.writeFileString(archive, result);

            if (Exit.isSuccess(exit)) {
              yield* fs.remove(config.home, { recursive: true });
            }
          }
        }),
      ),
      Effect.orDie,
    ),
  );
  yield* fs.writeFileString(`${config.home}/guard.ready`, "ready");
  yield* Effect.gen(function* () {
    yield* acquireGroups;
    return !(yield* alive(config.owner)) || (yield* fs.exists(`${config.home}/guard.stop`));
  }).pipe(Effect.repeat({ schedule: Schedule.spaced(`${config.poll} millis`), until: (done) => done }));
});

export const bundle = Effect.fn("P19Host.bundle")(function* (source: string, output: string, root: string) {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  const dependencies = new Map<string, string>();
  const compilation = yield* Effect.acquireRelease(
    // oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown opens a build through a Promise
    Effect.tryPromise({
      try: () =>
        rolldown({
          input: "p19:entry",
          cwd: root,
          platform: "node",
          external: [/^node:/],
          // The app's package.json says "sideEffects": false, which drops this helper's guard and controller mains.
          treeshake: { moduleSideEffects: [{ test: /P19Launchd\.test-support\.ts$/, sideEffects: true }] },
          plugins: [
            {
              name: "p19-entry",
              resolveId(id: string, importer: string | undefined) {
                if (id === "p19:entry") {
                  return id;
                }

                const from =
                  importer !== undefined && path.isAbsolute(importer)
                    ? importer
                    : path.join(root, "next/apps/fabrika/package.json");
                const outside = (resolved: string) => {
                  if (!dependencies.has(resolved)) {
                    dependencies.set(
                      resolved,
                      path.join(`${output}.dependencies`, String(dependencies.size), path.basename(resolved)),
                    );
                  }

                  return { id: resolved, external: true };
                };

                // Alchemy's packages find their own files beside themselves at run time and export ESM only,
                // so they stay outside the bundle too, found by Rolldown's resolver in place of require.
                if (/^(?:alchemy|@alchemy\.run\/[^/]+)(?:\/|$)/.test(id)) {
                  // oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown's resolver answers through a Promise
                  return this.resolve(id, from, { skipSelf: true }).then((found) =>
                    found === null ? undefined : outside(found.id),
                  );
                }

                if (
                  /\.node$/.test(id) ||
                  /^(?:miniflare|workerd|rolldown|lightningcss|oxc-parser|oxc-transform-react|fsevents)(?:\/|$)/.test(
                    id,
                  ) ||
                  /^@rolldown\//.test(id)
                ) {
                  return outside(createRequire(from).resolve(id));
                }

                return undefined;
              },
              load: (id: string) => (id === "p19:entry" ? source : undefined),
            },
          ],
        }),
      catch: fail,
    }),
    // oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown releases its build through a Promise
    (built) => Effect.tryPromise({ try: () => built.close(), catch: fail }).pipe(Effect.orDie),
  );

  // oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown writes JavaScript through a Promise
  yield* Effect.tryPromise({
    try: () =>
      compilation.write({
        dir: path.dirname(output),
        entryFileNames: (chunk: PreRenderedChunk) =>
          chunk.facadeModuleId === "p19:entry"
            ? path.basename(output)
            : `${path.basename(output)}.chunks/[name]-[hash].mjs`,
        chunkFileNames: `${path.basename(output)}.chunks/[name]-[hash].mjs`,
        assetFileNames: `${path.basename(output)}.assets/[name]-[hash][extname]`,
        format: "esm",
        codeSplitting: false,
        paths: (id: string) => dependencies.get(id) ?? id,
      }),
    catch: fail,
  });

  // Rolldown resolves imports during write. Link them before any controller or brain can start.
  for (const [resolved, link] of dependencies) {
    yield* fs.makeDirectory(path.dirname(link), { recursive: true });
    yield* fs.symlink(resolved, link);
  }

  return [...dependencies.values()];
});

/** A child controller releases only its own handles. It must leave the launchd brain running. */
const controller = Effect.fn("P19Host.controller")(function* (specFile: string, snapshotFile: string) {
  const fs = yield* FileSystem.FileSystem;
  const spec = yield* fs
    .readFileString(specFile)
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(BrainSpec))));
  const settings = yield* fs
    .readFileString(snapshotFile)
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Snapshot.Snapshot))));
  const native = Context.get(yield* Layer.build(Native.layer(spec, settings)), BrainControl);
  const probe = Layer.succeed(BrainProbe, {
    ready: Effect.gen(function* () {
      if (!(yield* fs.exists(`${spec.home}/ready.json`))) {
        return Readiness.cases.waiting.make({});
      }

      const Ready = Schema.Struct({ pid: Schema.Int, build: Schema.String });
      const ready = yield* fs
        .readFileString(`${spec.home}/ready.json`)
        .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Ready))));
      const current = yield* native.inspect;
      return ready.build === spec.build &&
        current._tag === "loaded" &&
        ready.pid === current.pid &&
        (yield* listening(spec.url))
        ? Readiness.cases.ready.make({})
        : Readiness.cases.waiting.make({});
    }).pipe(
      Effect.mapError(
        (cause: unknown) => new BrainProbeError({ reason: new Unreachable({ cause: Redacted.make(cause) }) }),
      ),
    ),
    cleanup: Effect.gen(function* () {
      const groups = (yield* fs.exists(`${spec.home}/groups.json`))
        ? yield* fs
            .readFileString(`${spec.home}/groups.json`)
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(ProcessGroups.Saved))))
        : [];

      for (const group of groups) {
        if (yield* alive(-group)) {
          return Children.cases.waiting.make({});
        }
      }

      return (yield* listening(spec.url)) ? Children.cases.waiting.make({}) : Children.cases.gone.make({});
    }).pipe(
      Effect.mapError(
        (cause: unknown) => new BrainProbeError({ reason: new Cleanup({ cause: Redacted.make(cause) }) }),
      ),
    ),
  });
  const context = yield* Layer.build(
    ServiceLaunchd.layer(
      spec,
      settings,
      probe,
      (_target: "record" | "bucket", _name: string, _method: string, _args: ReadonlyArray<unknown>) =>
        Effect.succeed(Written.cases.written.make({})),
    ),
  );
  const service = Context.get(context, BrainService);

  if (process.argv.includes("--stop")) {
    yield* service.stop;
    return;
  }

  yield* service.up;
  yield* fs.writeFileString(`${spec.home}/controller.ready`, "ready");

  if (!process.argv.includes("--release")) {
    return yield* Effect.never;
  }
});

export const check = Effect.fn("P19Host.check")(function* () {
  const fs = yield* FileSystem.FileSystem,
    path = yield* Path.Path;
  yield* checked(process.platform === "darwin" && process.env.FABRIKA_P19_HOST === "1", "host-opt-in-required");
  const app = path.resolve(import.meta.dirname, "../..");
  const root = path.resolve(app, "../../..");
  const temporary = yield* fs.makeTempDirectoryScoped({ directory: "/tmp", prefix: "p19-" });
  const home = yield* fs.realPath(temporary);
  const executable: string = createRequire(path.join(app, "package.json"))("electron");
  // The OS chooses a disposable listener only in this host check, never in BrainService policy.
  const chosen = Number(process.env.FABRIKA_P19_PORT);
  yield* checked(Number.isInteger(chosen) && chosen > 1024 && chosen < 65535, "supply-isolated-host-port");
  const url = `http://127.0.0.1:${chosen}`;
  yield* checked(!(yield* listening(url)), "host-port-is-already-owned");
  const resolved = yield* Sources.resolve(Declarations.all, {
    flags: Sources.flags({ "instance.port": String(chosen) }),
    env: Sources.env({}),
    repo: Sources.file("repo", { value: {}, spans: [] }),
    person: Sources.file("person", { value: {}, spans: [] }),
  });
  const settings = yield* Snapshot.make(Declarations.all, resolved).pipe(Effect.provide(Digest.layerWebCrypto));
  const built = yield* build({ out: `${home}/build` });
  const helper = path.resolve(import.meta.dirname, "P19Launchd.test-support.ts");
  const runtime = `${home}/brain.mjs`,
    controllerFile = `${home}/controller.mjs`,
    guardFile = `${home}/guard.mjs`;
  const boot = `import { NodeRuntime, NodeServices } from "@effect/platform-node"; import { Effect } from "effect"; import { Digest, SecureRandom } from "effect/crypto";`;
  yield* bundle(
    `${boot} import { localInstance } from ${JSON.stringify(path.join(app, "src/local-instance.ts"))}; import { FileSystem } from "effect"; NodeRuntime.runMain(Effect.scoped(Effect.gen(function*(){ const fs=yield* FileSystem.FileSystem; yield* localInstance(${JSON.stringify(built)}, { name:"p19-isolated", person:"person_01m6v5270hf3c8x2q7w9z4k5mn", founder:"public-host-test", window:null, rateLimit:{limit:${Number(settings.values["gateway.limit"])},window:${Number(settings.values["gateway.window"])}}, port:${chosen}, home:${JSON.stringify(home)} }); yield* fs.writeFileString(${JSON.stringify(`${home}/ready.json`)}, JSON.stringify({pid:process.pid,build:${JSON.stringify(built.build)},node:process.versions.node,electron:process.versions.electron})); yield* Effect.never; })).pipe(Effect.provide([NodeServices.layer, Digest.layerWebCrypto, SecureRandom.layerWebCrypto])));`,
    runtime,
    root,
  );
  yield* bundle(`import ${JSON.stringify(helper)};`, controllerFile, root);
  yield* bundle(`import ${JSON.stringify(helper)};`, guardFile, root);
  const spec = yield* Schema.decodeUnknownEffect(BrainSpec)({
    home,
    executable,
    args: [runtime, "spaces & <angles> 雪"],
    url,
    build: built.build,
  });
  yield* fs.writeFileString(`${home}/spec.json`, JSON.stringify(Schema.encodeSync(BrainSpec)(spec)));
  yield* fs.writeFileString(`${home}/snapshot.json`, JSON.stringify(Schema.encodeSync(Snapshot.Snapshot)(settings)));
  const native = yield* Layer.build(Native.layer(spec, settings));
  yield* Context.get(native, BrainControl).install;
  // plutil, not a hand-written XML parser, verifies the native compiler preserves checked values.
  const plist = yield* command("plutil", ["-convert", "json", "-o", "-", `${home}/brain.plist`]);
  yield* checked(plist.code === 0, "plist-does-not-compile");
  const job = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Struct({ Label: Schema.String, ProgramArguments: Schema.Array(Schema.String) })),
  )(plist.stdout);
  yield* checked(
    JSON.stringify(job.ProgramArguments) === JSON.stringify([executable, ...spec.args]),
    "plist-argv-changed",
  );
  const uid = yield* command("id", ["-u"]);
  const config = Config.make({
    home,
    target: `gui/${uid.stdout.trim()}/${job.Label}`,
    url,
    owner: process.pid,
    stopTimeout: Number(settings.values["desktop.brain-stop-timeout"]),
    poll: Number(settings.values["desktop.brain-poll"]),
  });
  yield* fs.writeFileString(`${home}/guard.json`, JSON.stringify(config));
  const watcher = yield* ChildProcess.make(process.execPath, [guardFile, "p19:guard", `${home}/guard.json`], {
    cwd: root,
    detached: true,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  yield* wait(fs.exists(`${home}/guard.ready`), config.stopTimeout);
  yield* Effect.addFinalizer(() =>
    fs
      .writeFileString(`${home}/guard.stop`, "stop")
      .pipe(Effect.andThen(wait(fs.exists(`${home}/guard.result`), config.stopTimeout * 3)), Effect.orDie),
  );
  const launch = Effect.fnUntraced(function* (mode?: string) {
    yield* fs.remove(`${home}/controller.ready`, { force: true });
    const child = yield* ChildProcess.make(
      process.execPath,
      [controllerFile, "p19:controller", `${home}/spec.json`, `${home}/snapshot.json`, ...(mode ? [mode] : [])],
      { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
    );

    if (mode === "--stop") {
      yield* checked((yield* child.exitCode) === 0, "stop-controller-failed");
    } else {
      yield* wait(fs.exists(`${home}/controller.ready`), Number(settings.values["desktop.brain-start-timeout"]));

      if (mode === "--release") {
        yield* checked((yield* child.exitCode) === 0, "controller-release-failed");
      }
    }

    return child;
  });
  const acknowledgedGroups = Effect.gen(function* () {
    const current = yield* status(config.target);

    if (current._tag !== "loaded" || current.pid === null) {
      return yield* new HostError({ reason: "no-process-to-observe" });
    }

    const expected = ProcessGroups.descendants(yield* processes(), current.pid);
    yield* checked(expected.length > 0, "no-owned-group");
    yield* wait(
      Effect.gen(function* () {
        if (!(yield* fs.exists(`${home}/groups.json`))) {
          return false;
        }

        const observed = yield* fs
          .readFileString(`${home}/groups.json`)
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(ProcessGroups.Saved))));
        return expected.every((group) => observed.includes(group));
      }),
      config.stopTimeout,
    );
  });
  const starts: Array<number> = [],
    stops: Array<number> = [];
  let replacementMs = 0;

  for (let n = 0; n < 4; n++) {
    const at = yield* Clock.currentTimeMillis;
    const client = yield* launch();
    starts.push((yield* Clock.currentTimeMillis) - at);
    yield* acknowledgedGroups;
    const first = yield* status(config.target);
    yield* checked(first._tag === "loaded" && first.pid !== null, "no-running-brain");
    yield* client.kill({ killSignal: "SIGKILL" });
    yield* checked(
      JSON.stringify(yield* status(config.target)) === JSON.stringify(first) && (yield* listening(url)),
      "controller-death-stopped-brain",
    );
    yield* launch("--release");
    yield* checked(
      JSON.stringify(yield* status(config.target)) === JSON.stringify(first),
      "reuse-started-another-brain",
    );

    if (n === 0) {
      const crashed = yield* Clock.currentTimeMillis;
      yield* command("launchctl", ["kill", "SIGKILL", config.target]);
      yield* wait(
        Effect.gen(function* () {
          const next = yield* status(config.target);
          const ready = yield* fs
            .readFileString(`${home}/ready.json`)
            .pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Struct({ pid: Schema.Int })))),
            );
          return (
            next._tag === "loaded" &&
            next.pid !== null &&
            first._tag === "loaded" &&
            next.pid !== first.pid &&
            ready.pid === next.pid &&
            (yield* listening(url))
          );
        }),
        Number(settings.values["desktop.brain-start-timeout"]),
      );
      replacementMs = (yield* Clock.currentTimeMillis) - crashed;
      yield* acknowledgedGroups;
    }

    const stopAt = yield* Clock.currentTimeMillis;
    yield* launch("--stop");
    stops.push((yield* Clock.currentTimeMillis) - stopAt);
    yield* checked(
      (yield* status(config.target))._tag === "absent" &&
        !(yield* listening(url)) &&
        !(yield* fs.exists(`${home}/brain.plist`)),
      "stop-left-a-resource",
    );
  }

  // The small job proves a successful exit is not restarted. The four starts above used the real brain.
  const fixture = `${home}/fixture.mjs`;
  yield* bundle(`import ${JSON.stringify(path.join(root, "fixtures/next/p19-launchd/brain.ts"))};`, fixture, root);
  const normal = yield* Schema.decodeUnknownEffect(BrainSpec)({ ...spec, args: [fixture] });
  yield* fs.writeFileString(`${home}/spec.json`, JSON.stringify(Schema.encodeSync(BrainSpec)(normal)));
  const normalContext = yield* Layer.build(Native.layer(normal, settings));
  const normalControl = Context.get(normalContext, BrainControl);
  yield* normalControl.install;
  yield* normalControl.start;
  yield* wait(fs.exists(`${home}/fixture-ready.json`), Number(settings.values["desktop.brain-start-timeout"]));
  const normalReady = yield* fs.readFileString(`${home}/fixture-ready.json`);
  yield* fs.writeFileString(`${home}/exit-normally`, "exit");
  yield* wait(
    status(config.target).pipe(Effect.map((value) => value._tag === "loaded" && value.pid === null)),
    config.stopTimeout,
  );
  const throttle = Number(settings.values["desktop.brain-throttle"]) * 1000;
  const until = (yield* Clock.currentTimeMillis) + throttle * 3;
  yield* Effect.gen(function* () {
    yield* checked((yield* fs.readFileString(`${home}/fixture-ready.json`)) === normalReady, "normal-exit-restarted");
    const current = yield* status(config.target);
    yield* checked(current._tag === "loaded" && current.pid === null, "normal-exit-restarted");
    return (yield* Clock.currentTimeMillis) >= until;
  }).pipe(Effect.repeat({ schedule: Schedule.spaced(`${config.poll} millis`), until: (done) => done }));
  yield* launch("--stop");
  const owned = yield* fs
    .readFileString(`${home}/groups.json`)
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(ProcessGroups.Saved))));
  yield* checked(owned.length > 0, "guard-observed-no-groups");

  for (const group of owned) {
    yield* checked(!(yield* alive(-group)), "stop-left-owned-group");
  }

  yield* fs.writeFileString(`${home}/guard.stop`, "stop");
  yield* wait(fs.exists(`${home}/guard.result`), config.stopTimeout * 3);
  yield* checked((yield* watcher.exitCode) === 0, "guard-reported-leftovers");
  const ready = yield* fs.readFileString(`${home}/ready.json`);
  yield* fs.makeDirectory(path.join(root, "runs/p19"), { recursive: true });
  yield* fs.writeFileString(
    path.join(root, "runs/p19/host.json"),
    JSON.stringify({
      starts,
      stops,
      replacementMs,
      // The groups the guard saved, each decoded as above 1, so a reader sees what a signal could reach.
      groups: owned,
      normalExitObservationMs: throttle * 3,
      executable,
      versions: yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(ready),
      settings,
    }),
  );
  const leftovers: ReadonlyArray<string> = [];
  return { starts, replacement: true, controllerDeath: true, normalExit: true, leftovers };
});

if (process.argv[2] === "p19:guard") {
  NodeRuntime.runMain(
    Effect.scoped(guard(process.argv[3] ?? "")).pipe(Effect.provide([NodeServices.layer, Digest.layerWebCrypto])),
  );
}

if (process.argv[2] === "p19:controller") {
  NodeRuntime.runMain(
    Effect.scoped(controller(process.argv[3] ?? "", process.argv[4] ?? "")).pipe(
      Effect.provide([NodeServices.layer, Digest.layerWebCrypto]),
    ),
  );
}
