import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Id } from "@kampus/libfabrika";
import type { LedgerCalls } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerRemote from "@kampus/libfabrika/ledger/LedgerRemote";
import * as OpenRepository from "@kampus/libfabrika/node/repositories/OpenRepository";
import * as RepositoriesGit from "@kampus/libfabrika/node/repositories/RepositoriesGit";
import * as Load from "@kampus/libfabrika/node/settings/Load";
import { watchPrograms } from "@kampus/libfabrika/node/watch";
import * as RepositoryTrustLedger from "@kampus/libfabrika/packs/RepositoryTrustLedger";
import * as Declarations from "@kampus/libfabrika/settings/Declarations";
import * as TomlParser from "@kampus/libfabrika/settings/TomlParser";
import { Config, Effect, FileSystem, Layer, Path, Schema, Stream } from "effect";
import { Command, Flag, Prompt } from "effect/cli";
import { Digest, SecureRandom } from "effect/crypto";
import { ChildProcess } from "effect/process";
import { build } from "./src/build.ts";
import { localInstance } from "./src/local-instance.ts";
import { Founding } from "./src/settings.ts";

class InstanceError extends Schema.TaggedError<InstanceError>()("InstanceError", {
  reason: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

const VERSION = "0.0.0";
const declarations = Declarations.all.declarations;

// Each declared setting is a flag at its own path, as --instance.port. --port stays the port's
// alias, for the commands and instance tests written before the setting.
const settings = Object.fromEntries(
  declarations.map((d) => {
    const flag = Flag.String(d.path);
    return [d.path, (d === Declarations.port ? Flag.withAlias(flag, "port") : flag).pipe(Flag.withDefault(undefined))];
  }),
);

// The saved state of a home: its founding facts. A port saved there by an older start is read
// only to say that it is no longer used.
const Saved = Schema.Struct({ ...Founding.fields, port: Schema.optionalKey(Declarations.port.schema) });

/** The entries that hold a value, as one record. */
const present = (entries: ReadonlyArray<readonly [string, string | undefined]>) =>
  Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry[1] !== undefined));

// The settings flags are one nested record, so the start reads each by its declared path.
const flags = {
  settings,
  repo: Flag.String("repo").pipe(Flag.withDefault(undefined)),
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
    (/^--(repo|port|name|person|founder|window|parent)$/.test(word) ||
      declarations.some((d) => word === `--${d.path}`)) &&
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
        // A person reads their file's name from ~ or FABRIKA_HOME, never as this machine's path.
        const person = {
          path: path.join(home, "fabrika.toml"),
          name: `${process.env.FABRIKA_HOME === undefined ? "~/.fabrika" : "$FABRIKA_HOME"}/fabrika.toml`,
        };
        const loadOptions = {
          person,
          flags: present(declarations.map((d) => [d.path, options.settings[d.path]])),
          env: present(declarations.map((d) => [d.env, process.env[d.env]])),
          version: VERSION,
        };
        const prepared =
          options.repo === undefined
            ? undefined
            : yield* OpenRepository.prepare(options.repo, loadOptions).pipe(
                Effect.provide(RepositoriesGit.layer({ person: home })),
                Effect.provide([TomlParser.layer, Digest.layerWebCrypto]),
              );
        // Settings are read once, before anything starts: with the selected repo's file at one
        // commit, or with no repo file when the start selects none.
        const loaded =
          prepared === undefined
            ? yield* Load.load(loadOptions).pipe(
                Effect.provide([TomlParser.layer, Digest.layerWebCrypto]),
                Effect.mapError((cause) => new InstanceError({ reason: "settings", cause })),
              )
            : { snapshot: prepared.settings, values: prepared.values };
        const { file, state } = yield* Effect.gen(function* () {
          yield* fs.makeDirectory(home, { recursive: true });
          const file = path.join(home, "instance.json");
          const saved = (yield* fs.exists(file))
            ? yield* fs
                .readFileString(file)
                .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Saved))))
            : undefined;

          if (saved?.port !== undefined) {
            yield* Effect.logWarning(
              `instance.json holds port ${saved.port}, which is no longer read. Set instance.port in ${person.name} instead.`,
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
        }).pipe(Effect.mapError((cause) => new InstanceError({ reason: "settings", cause })));
        yield* fs
          .writeFileString(file, JSON.stringify(state), { mode: 0o600 })
          .pipe(Effect.mapError((cause) => new InstanceError({ reason: "settings", cause })));
        const built = yield* build({ out: path.join(home, "build") });
        const instance = yield* localInstance(built, {
          name: state.name,
          founding: { person: state.person, founder: state.founder, window: state.window },
          settings: loaded.snapshot,
          // The start's record names the commit the repo's settings were read at.
          repo: prepared === undefined ? null : { revision: prepared.snapshot.commit },
          home,
          ...(state.limits === undefined ? {} : { limits: state.limits }),
          ...(state.mail === undefined ? {} : { mail: state.mail }),
        });

        if (prepared !== undefined) {
          const ids = yield* Id.Generator;
          const { append, read, wait } = instance.project(state.name);

          if (append === undefined || read === undefined || wait === undefined) {
            return yield* new InstanceError({ reason: "ledger_unavailable" });
          }

          const calls: LedgerCalls = { append, read, wait };
          const selected = yield* OpenRepository.open(prepared, {
            selection: yield* ids.next(Id.InputId),
            request: yield* ids.next(Id.InputId),
            actor: yield* Schema.decodeUnknownEffect(Id.Person)(state.person),
            by: "brain",
            build: built.build,
            interactive: process.stdin.isTTY === true,
            confirm: (snapshot) =>
              Prompt.Confirm({ message: `Trust ${snapshot.label} at ${snapshot.commit}?`, initial: false }),
          }).pipe(
            Effect.provide(
              RepositoryTrustLedger.layer.pipe(
                Layer.provide(LedgerRemote.layer(calls, { reader: "brain" })),
                Layer.provide(Digest.layerWebCrypto),
              ),
            ),
          );
          process.stdout.write(`${JSON.stringify(selected)}\n`);

          if (selected._tag === "refused") {
            return yield* new InstanceError({ reason: "repository_refused" });
          }
        }

        yield* Effect.forkScoped(
          Stream.runForEach(
            watchPrograms({ ...built.watch, install: instance.install, failed: instance.failed }).pipe(
              Stream.provideContext(instance.recording),
            ),
            (answer) =>
              Effect.sync(() => {
                if (answer._tag === "same") {
                  return;
                }

                if (answer._tag === "failed") {
                  process.stdout.write(
                    `${answer.program} did not load: ${answer.reason === "bundle" ? "syntax error" : answer.reason === "compiler" ? "compiler check failed" : answer.reason === "name" ? "the program name changed" : answer.reason === "too_large" ? "the bundle is too large" : "the module failed to load"}${answer.path === undefined ? "" : ` at ${answer.path}${answer.line === undefined ? "" : `:${answer.line}`}`}\n`,
                  );
                  return;
                }

                for (const { name, outcome } of answer.processes) {
                  const text =
                    outcome._tag === "swapped"
                      ? `${name} runs ${answer.hash.slice(0, 8)} now`
                      : outcome._tag === "refused"
                        ? `${name} stays on ${outcome.was.slice(0, 8)}: ${outcome.reason === "shape" ? "the new code can't read its state" : outcome.reason === "newer" ? "its state has a newer version" : "the new code could not load"}`
                        : outcome._tag === "not_now"
                          ? `${name} will try the new code at the next brain start`
                          : `${name} already runs this code`;
                  process.stdout.write(`${text}\n`);
                }
              }),
          ),
        );

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
    Effect.provide([NodeServices.layer, SecureRandom.layerWebCrypto, Id.Generator.layer]),
  ),
);
