// One load of fabrika's settings at a process start: read both files, check them whole, resolve
// the four sources and make the snapshot the process keeps. It returns all of that or one
// SettingsError, so nothing starts on settings that were not checked.
import { Effect, FileSystem, Predicate } from "effect";
import * as Declarations from "../../settings/Declarations.ts";
import * as Files from "../../settings/Files.ts";
import * as Snapshot from "../../settings/Snapshot.ts";
import * as Sources from "../../settings/Sources.ts";
import { Toml } from "../../settings/Toml.ts";

const REPO = ".fabrika/fabrika.toml";

interface Place {
  /** Where the file is read from. */
  readonly path: string;
  /** The name a person reads, as `~/.fabrika/fabrika.toml`. */
  readonly name: string;
}

export const load = Effect.fnUntraced(function* (options: {
  readonly person: Place;
  /** A start that selects no repo reads none, and the repo's file counts as empty. */
  readonly repo?: { readonly name: string; readonly text: string | null };
  readonly flags: Readonly<Record<string, string>>;
  readonly env: Readonly<Record<string, string>>;
  /** The running fabrika's version, which the repo's `fabrika-version` is checked against. */
  readonly version: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const toml = yield* Toml;
  // A missing file is an empty one; any other read failure stops the start.
  const read = (place: Place) =>
    fs.readFileString(place.path).pipe(
      Effect.catchTag("PlatformError", (cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed("")
          : Effect.fail(
              new Files.SettingsError({
                reason: "read",
                message: `${place.name} could not be read.\n  ${Files.STOP}`,
                cause,
              }),
            ),
      ),
      Effect.flatMap(toml.parse),
      Effect.mapError((cause) =>
        cause._tag === "TomlError"
          ? new Files.SettingsError({
              reason: "syntax",
              message: `${place.name}, line ${cause.line}: ${cause.message}\n  ${Files.STOP}`,
              cause,
            })
          : cause,
      ),
      Effect.map((document) => ({ file: place.name, document })),
    );
  const repo = {
    file: options.repo?.name ?? REPO,
    document:
      options.repo?.text == null
        ? { value: {}, spans: [] }
        : yield* toml.parse(options.repo.text).pipe(
            Effect.mapError(
              (cause) =>
                new Files.SettingsError({
                  reason: "syntax",
                  message: `${options.repo?.name ?? REPO}, line ${cause.line}: ${cause.message}\n  ${Files.STOP}`,
                  cause,
                }),
            ),
          ),
  };
  // A repo that needs a newer fabrika is refused before the person's file is read.
  yield* Files.supported(repo, options.version);
  const person = yield* read(options.person);
  yield* Files.validate(Declarations.all, { repo, person }, { version: options.version });
  const resolved = yield* Sources.resolve(Declarations.all, {
    flags: Sources.flags(options.flags),
    env: Sources.env(options.env),
    repo: Sources.file(repo.file, repo.document),
    person: Sources.file(person.file, person.document),
  });
  // The repo's own minimum, as its file states it, before a flag or the environment overrides it.
  const minimum = repo.document.value[Declarations.version.path];
  const context =
    options.repo === undefined
      ? {}
      : { repo: { minimum: Predicate.isString(minimum) ? minimum : Declarations.version.default } };
  const saved = yield* Snapshot.make(Declarations.all, resolved);
  const checked = yield* Snapshot.read(Declarations.all, saved).pipe(
    Effect.mapError(
      (cause) =>
        new Files.SettingsError({
          reason: "invalid",
          message: `The saved settings could not be checked.\n  ${Files.STOP}`,
          cause,
        }),
    ),
  );
  return { ...checked, ...context };
});
