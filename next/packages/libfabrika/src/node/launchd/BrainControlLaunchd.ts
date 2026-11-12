import * as Digest from "effect/crypto/Digest";
/**
 * Scoped native commands and exclusive home-owned plist publication.
 *
 * @stability unstable
 */
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import {
  BrainControl,
  BrainControlError,
  Command,
  Conflict,
  Storage,
  Unsupported,
} from "../../desktop/BrainControl.ts";
import { BrainSpec } from "../../desktop/BrainSpec.ts";
import * as Declarations from "../../settings/Declarations.ts";
import type * as Snapshot from "../../settings/Snapshot.ts";
import * as LaunchdStatus from "./LaunchdStatus.ts";

const Job = Schema.Struct({
  Label: Schema.NonEmptyString,
  ProgramArguments: Schema.Array(LaunchdStatus.Scalar),
  EnvironmentVariables: Schema.Struct({
    ELECTRON_RUN_AS_NODE: Schema.Literal("1"),
    FABRIKA_HOME: LaunchdStatus.Scalar,
    FABRIKA_BUILD: LaunchdStatus.Scalar,
  }),
  RunAtLoad: Schema.Literal(true),
  KeepAlive: Schema.Struct({ SuccessfulExit: Schema.Literal(false) }),
  ThrottleInterval: Declarations.brainThrottle.schema,
  AbandonProcessGroup: Schema.Literal(false),
});

const storage = (cause: unknown) => new BrainControlError({ reason: new Storage({ cause: Redacted.make(cause) }) });
const conflict = (cause: unknown) => new BrainControlError({ reason: new Conflict({ cause: Redacted.make(cause) }) });

const commandError = (cause: unknown, code?: number) =>
  new BrainControlError({
    reason: new Command({ ...(code === undefined ? {} : { code }), cause: Redacted.make(cause) }),
  });

const unsupported = (cause: unknown) =>
  new BrainControlError({ reason: new Unsupported({ cause: Redacted.make(cause) }) });

const make = Effect.fnUntraced(function* (spec: BrainSpec, settings: Snapshot.Snapshot) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const digest = yield* Digest.Digest;
  const label = `fabrika.brain.${yield* digest.digestHex(Digest.sha256, new TextEncoder().encode(spec.home))}`;
  const plist = path.join(spec.home, "brain.plist");
  const throttle = yield* Schema.decodeUnknownEffect(Declarations.brainThrottle.schema)(
    settings.values["desktop.brain-throttle"],
  ).pipe(Effect.mapError(unsupported));
  const job = yield* Schema.decodeUnknownEffect(Job)({
    Label: label,
    ProgramArguments: [spec.executable, ...spec.args],
    EnvironmentVariables: { ELECTRON_RUN_AS_NODE: "1", FABRIKA_HOME: spec.home, FABRIKA_BUILD: spec.build },
    RunAtLoad: true,
    KeepAlive: { SuccessfulExit: false },
    ThrottleInterval: throttle,
    AbandonProcessGroup: false,
  }).pipe(Effect.mapError(unsupported));

  const run = Effect.fnUntraced(function* (executable: string, args: ReadonlyArray<string>) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(
          ChildProcess.make(executable, args, { extendEnv: false, env: {}, stdin: "ignore" }),
        );
        const text = (stream: typeof handle.stdout) =>
          stream.pipe(
            Stream.decodeText(),
            Stream.runFold(
              () => Redacted.make(""),
              // oxlint-disable-next-line fabrika/no-redacted-value -- edge: join native output only into another protected value
              (all, chunk) => Redacted.make(Redacted.value(all) + chunk),
            ),
          );
        const [code, stdout, stderr] = yield* Effect.all([handle.exitCode, text(handle.stdout), text(handle.stderr)], {
          concurrency: "unbounded",
        });
        return { code: Number(code), stdout, stderr };
      }),
    ).pipe(Effect.mapError(commandError));
  });
  const success = Effect.fnUntraced(function* (executable: string, args: ReadonlyArray<string>) {
    const response = yield* run(executable, args);

    if (response.code !== 0) {
      return yield* commandError(response, response.code);
    }

    return response;
  });
  const domain = Effect.gen(function* () {
    const response = yield* success("/usr/bin/id", ["-u"]);
    const uid = yield* Schema.decodeUnknownEffect(Schema.String.check(Schema.isPattern(/^(?:0|[1-9][0-9]*)\n$/u)))(
      // oxlint-disable-next-line fabrika/no-redacted-value -- edge: decode only the numeric UID from protected native output
      Redacted.value(response.stdout),
    ).pipe(Effect.mapError(unsupported));
    return `gui/${uid.trimEnd()}`;
  });
  const inspect = Effect.gen(function* () {
    const target = `${yield* domain}/${label}`;
    return yield* LaunchdStatus.decode({ target, ...(yield* run("/bin/launchctl", ["print", target])) });
  });
  const owned = Effect.gen(function* () {
    const status = yield* inspect;

    if (status._tag === "loaded" && !BrainSpec.matches(spec, status)) {
      return yield* conflict("job ownership");
    }

    return status;
  });
  const canonical = Effect.gen(function* () {
    const home = yield* fs.realPath(spec.home).pipe(Effect.mapError(storage));

    if (home !== spec.home) {
      return yield* conflict("home is not canonical");
    }
  });
  const existing = Effect.gen(function* () {
    const stat = yield* fs.lstat(plist).pipe(
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(null)),
      Effect.mapError(storage),
    );

    if (stat === null) {
      return null;
    }

    if (stat.type !== "File" || (stat.mode & 0o777) !== 0o600) {
      return yield* conflict("plist ownership");
    }

    return yield* fs.readFileString(plist).pipe(Effect.mapError(storage));
  });
  const compile = Effect.fnUntraced(function* () {
    const dir = yield* fs
      .makeTempDirectoryScoped({ directory: spec.home, prefix: ".brain-" })
      .pipe(Effect.mapError(storage));
    const json = path.join(dir, "job.json"),
      xml = path.join(dir, "job.plist");
    yield* fs.writeFileString(json, JSON.stringify(job), { mode: 0o600 }).pipe(Effect.mapError(storage));
    yield* success("/usr/bin/plutil", ["-convert", "xml1", "-o", xml, json]);
    yield* fs.chmod(xml, 0o600).pipe(Effect.mapError(storage));
    const file = yield* fs.open(xml, { flag: "r+", noFollow: true }).pipe(Effect.mapError(storage));
    yield* file.sync.pipe(Effect.mapError(storage));
    return { xml, bytes: yield* fs.readFileString(xml).pipe(Effect.mapError(storage)) };
  });
  const syncHome = Effect.scoped(
    Effect.gen(function* () {
      const directory = yield* fs.open(spec.home, { flag: "r" }).pipe(Effect.mapError(storage));
      yield* directory.sync.pipe(Effect.mapError(storage));
    }),
  );
  const install = Effect.scoped(
    Effect.gen(function* () {
      yield* canonical;
      const compiled = yield* compile();
      const before = yield* existing;

      if (before !== null) {
        if (before !== compiled.bytes) {
          return yield* conflict("plist configuration");
        }

        // A prior publication may have failed while syncing this directory.
        yield* syncHome;
        return;
      }

      yield* fs.link(compiled.xml, plist).pipe(
        Effect.catchReason("PlatformError", "AlreadyExists", () =>
          Effect.gen(function* () {
            if ((yield* existing) !== compiled.bytes) {
              return yield* conflict("competing plist configuration");
            }
          }),
        ),
        Effect.mapError((cause) => (cause._tag === "BrainControlError" ? cause : storage(cause))),
      );
      yield* syncHome;
    }),
  );
  const start = Effect.scoped(
    Effect.gen(function* () {
      yield* canonical;
      const compiled = yield* compile();

      if ((yield* existing) !== compiled.bytes) {
        return yield* conflict("plist changed before bootstrap");
      }

      yield* success("/bin/launchctl", ["bootstrap", yield* domain, plist]);
    }),
  ).pipe(Effect.asVoid);
  const stop = Effect.gen(function* () {
    if ((yield* owned)._tag === "absent") {
      return;
    }

    yield* success("/bin/launchctl", ["bootout", `${yield* domain}/${label}`]);
  }).pipe(Effect.asVoid);
  const remove = Effect.scoped(
    Effect.gen(function* () {
      yield* canonical;
      const before = yield* existing;

      if (before === null) {
        return;
      }

      const compiled = yield* compile();

      if (before !== compiled.bytes || (yield* existing) !== before) {
        return yield* conflict("plist changed before removal");
      }

      // A cancelled removal keeps the matching plist available for inspection and retry.
      yield* Effect.acquireRelease(
        fs.link(plist, `${compiled.xml}.previous`).pipe(Effect.mapError(storage)),
        (_, exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : fs.link(`${compiled.xml}.previous`, plist).pipe(
                Effect.catchReason("PlatformError", "AlreadyExists", () => Effect.void),
                Effect.mapError(storage),
                Effect.orDie,
              ),
      );
      yield* fs.remove(plist).pipe(
        Effect.catchReason("PlatformError", "NotFound", () => Effect.void),
        Effect.mapError(storage),
      );
      yield* syncHome;
    }),
  );
  return BrainControl.of({ inspect, install, start, stop, remove });
});

/**
 * Controls the exact GUI-domain job derived from the canonical home.
 *
 * @stability unstable
 * @category layers
 */
export const layer = (spec: BrainSpec, settings: Snapshot.Snapshot) => Layer.effect(BrainControl, make(spec, settings));
