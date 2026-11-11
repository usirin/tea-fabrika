import { NodeRuntime, NodeServices } from "@effect/platform-node";
import * as Load from "@kampus/libfabrika/node/settings/Load";
import * as Declarations from "@kampus/libfabrika/settings/Declarations";
import * as TomlParser from "@kampus/libfabrika/settings/TomlParser";
import { Config, Effect, FileSystem, Path, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import { Digest, SecureRandom } from "effect/crypto";
import { ChildProcess } from "effect/process";
import { build } from "./src/build.ts";
import { localStage } from "./src/local-stage.ts";
import { Settings } from "./src/settings.ts";

class StageError extends Schema.TaggedError<StageError>()("StageError", {
  reason: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

const VERSION = "0.0.0";
const declarations = Declarations.all.declarations;

// Each declared setting is a flag at its own path, as --instance.port. --port stays the port's
// alias, for the commands and stage tests written before the setting.
const settings = Object.fromEntries(
  declarations.map((d) => {
    const flag = Flag.String(d.path);
    return [d.path, (d === Declarations.port ? Flag.withAlias(flag, "port") : flag).pipe(Flag.withDefault(undefined))];
  }),
);

// The saved state of a home: its founding facts. A port saved there by an older start is read
// only to say that it is no longer used.
const Saved = Settings.mapFields(({ port, ...fields }) => ({ ...fields, port: Schema.optionalKey(port) }));

/** The entries that hold a value, as one record. */
const present = (entries: ReadonlyArray<readonly [string, string | undefined]>) =>
  Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry[1] !== undefined));

const flags = {
  ...settings,
  child: Flag.Boolean("child").pipe(Flag.withDefault(false)),
  parent: Flag.String("parent").pipe(Flag.withDefault(undefined)),
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
  const flag =
    (/^--(port|name|person|founder|window|parent)$/.test(word) || declarations.some((d) => word === `--${d.path}`)) &&
    value !== undefined;
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
        return yield* new StageError({ reason: "parent_gone" });
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
        // A person reads their file's name from ~ or FABRIKA_HOME, never as this machine's path.
        const person = {
          path: path.join(home, "fabrika.toml"),
          name: `${process.env.FABRIKA_HOME === undefined ? "~/.fabrika" : "$FABRIKA_HOME"}/fabrika.toml`,
        };
        // Settings are read once, before anything starts. Only declared names are taken from the
        // environment, so no other variable reaches the snapshot. A dev start selects no repo, so
        // it reads no repo file.
        const loaded = yield* Load.load({
          person,
          flags: present(declarations.map((d) => [d.path, options[d.path]])),
          env: present(declarations.map((d) => [d.env, process.env[d.env]])),
          version: VERSION,
        }).pipe(
          Effect.provide([TomlParser.layer, Digest.layerWebCrypto]),
          Effect.mapError((cause) => new StageError({ reason: "settings", cause })),
        );
        const { file, state } = yield* Effect.gen(function* () {
          yield* fs.makeDirectory(home, { recursive: true });
          const file = path.join(home, "stage.json");
          const saved = (yield* fs.exists(file))
            ? yield* fs
                .readFileString(file)
                .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Saved))))
            : undefined;

          if (saved?.port !== undefined) {
            yield* Effect.logWarning(
              `stage.json holds port ${saved.port}, which is no longer read. Set instance.port in ${person.name} instead.`,
            );
          }

          const state = yield* Schema.decodeUnknownEffect(Saved)({
            name: options.name ?? saved?.name,
            person: options.person ?? saved?.person,
            founder: options.founder ?? saved?.founder,
            window: options.window ?? saved?.window ?? null,
            build: "pending",
            ...(saved?.limits === undefined ? {} : { limits: saved.limits }),
          });
          return { file, state };
        }).pipe(Effect.mapError((cause) => new StageError({ reason: "settings", cause })));
        yield* fs
          .writeFileString(file, JSON.stringify(state), { mode: 0o600 })
          .pipe(Effect.mapError((cause) => new StageError({ reason: "settings", cause })));
        const built = yield* build({ out: path.join(home, "build") });
        yield* localStage(built, { ...state, port: loaded.values.port, home });
        process.stdout.write(
          `${JSON.stringify({ ready: `http://127.0.0.1:${loaded.values.port}`, build: built.build })}\n`,
        );
        return yield* Effect.never;
      }),
    ),
  );
  const parent = Effect.scoped(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      // The installed Node spawner closes the detached group even after its leader exits.
      const stage = yield* ChildProcess.make(
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

      if ((yield* stage.exitCode) !== 0) {
        return yield* new StageError({ reason: "child_failed" });
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
