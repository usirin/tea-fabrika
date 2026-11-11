import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Config, Effect, FileSystem, Path, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { SecureRandom } from "effect/crypto";
import { ChildProcess } from "effect/process";
import { build } from "./src/build.ts";
import { localInstance } from "./src/local-instance.ts";
import { Settings } from "./src/settings.ts";

class InstanceError extends Schema.TaggedError<InstanceError>()("InstanceError", { reason: Schema.String }) {}

const flags = {
  child: Flag.Boolean("child").pipe(Flag.withDefault(false)),
  parent: Flag.String("parent").pipe(Flag.withDefault(undefined)),
  port: Flag.String("port").pipe(Flag.withDefault(undefined)),
  name: Flag.String("name").pipe(Flag.withDefault(undefined)),
  person: Flag.String("person").pipe(Flag.withDefault(undefined)),
  founder: Flag.String("founder").pipe(Flag.withDefault(undefined)),
  window: Flag.String("window").pipe(Flag.withDefault(undefined)),
};

// A base64url key can start with "-". Keep each string flag's value in the same word.
const words: Array<string> = [];

for (let n = 2; n < process.argv.length; n++) {
  const word = process.argv[n] ?? "",
    value = process.argv[n + 1];
  const flag = /^--(port|name|person|founder|window|parent)$/.test(word) && value !== undefined;
  words.push(flag ? `${word}=${value}` : word);

  if (flag) {
    n++;
  }
}

process.env.DO_NOT_TRACK = "1";

const command = Command.make("dev", flags, (options) => {
  const guard = Effect.forever(
    Effect.gen(function* () {
      const owner = Number(options.parent);

      if (!Number.isSafeInteger(owner) || owner <= 1 || process.ppid !== owner) {
        return yield* new InstanceError({ reason: "parent_gone" });
      }

      yield* Effect.sleep("250 millis");
    }),
  );
  const child = Effect.scoped(
    Effect.raceFirst(
      guard,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem,
          path = yield* Path.Path;
        const home = process.env.FABRIKA_HOME ?? path.join(yield* Config.String("HOME"), ".fabrika");
        const { file, config } = yield* Effect.gen(function* () {
          yield* fs.makeDirectory(home, { recursive: true });
          const file = path.join(home, "instance.json");
          const saved = (yield* fs.exists(file))
            ? yield* fs
                .readFileString(file)
                .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Settings))))
            : undefined;
          const config = yield* Schema.decodeUnknownEffect(Settings)({
            ...saved,
            name: options.name ?? saved?.name,
            person: options.person ?? saved?.person,
            founder: options.founder ?? saved?.founder,
            window: options.window ?? saved?.window ?? null,
            port: Number(options.port ?? saved?.port ?? 18787),
            build: "pending",
          });
          return { file, config };
        }).pipe(Effect.mapError(() => new InstanceError({ reason: "settings" })));
        yield* fs
          .writeFileString(file, JSON.stringify(config), { mode: 0o600 })
          .pipe(Effect.mapError(() => new InstanceError({ reason: "settings" })));
        const built = yield* build({ out: path.join(home, "build") });
        yield* localInstance(built, { ...config, home });
        process.stdout.write(`${JSON.stringify({ ready: `http://127.0.0.1:${config.port}`, build: built.build })}\n`);
        return yield* Effect.never;
      }),
    ),
  );
  const parent = Effect.scoped(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      // The installed Node spawner closes the detached group even after its leader exits.
      const childProcess = yield* ChildProcess.make(
        process.execPath,
        [path.resolve(import.meta.dirname, "dev.ts"), ...process.argv.slice(2), "--child", `--parent=${process.pid}`],
        {
          detached: true,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          forceKillAfter: "3 seconds",
        },
      );

      if ((yield* childProcess.exitCode) !== 0) {
        return yield* new InstanceError({ reason: "child_failed" });
      }
    }),
  );
  return options.child ? child : parent;
});

NodeRuntime.runMain(
  Command.runWith(command, { version: "0.0.0" })(words).pipe(
    Effect.provide([NodeServices.layer, SecureRandom.layerWebCrypto]),
  ),
);
