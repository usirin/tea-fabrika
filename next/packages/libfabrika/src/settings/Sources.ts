// The four sources in their order, flag, env, repo, person, with each declaration's default last
// (0086). Each source is an Effect ConfigProvider beside the Origin it names for a leaf it holds.
// The origin of a key is the first source that holds it, never a guess from equal values.
import type { Config } from "effect";
import { ConfigProvider, Effect, Schema, SchemaIssue, String as Str } from "effect";
import { refused, SettingsError, STOP } from "./Files.ts";
import type * as Setting from "./Setting.ts";
import type { TomlDocument } from "./Toml.ts";

export const Origin = Schema.TaggedUnion({
  default: {},
  flag: { name: Schema.String },
  env: { name: Schema.String },
  file: { file: Schema.String, line: Schema.Int },
});
export type Origin = typeof Origin.Type;

export interface Source {
  readonly provider: ConfigProvider.ConfigProvider;
  readonly origin: (path: ReadonlyArray<string>) => Origin;
}

export interface Slots {
  readonly flags: Source;
  readonly env: Source;
  readonly repo: Source;
  readonly person: Source;
}

export interface Resolved<A> {
  readonly values: A;
  /** Per dotted path, the source that supplied the value, or `default`. */
  readonly origins: Readonly<Record<string, Origin>>;
}

/** Flag values keyed by dotted path, as `{ "instance.port": "18800" }`. An empty value is kept. */
export const flags = (record: Readonly<Record<string, string>>): Source => ({
  provider: ConfigProvider.make((path) => {
    const value = record[path.join(".")];
    return Effect.succeed(value === undefined ? undefined : ConfigProvider.makeValue(value));
  }),
  origin: (path) => Origin.cases.flag.make({ name: `--${path.join(".")}` }),
});

/** An explicit environment, read as `FABRIKA_` and the constant-cased path. */
export const env = (record: Readonly<Record<string, string>>): Source => ({
  provider: ConfigProvider.fromEnv({ env: { ...record }, preserveEmptyStrings: true }).pipe(
    ConfigProvider.nested("fabrika"),
    ConfigProvider.constantCase,
  ),
  origin: (path) => Origin.cases.env.make({ name: ["FABRIKA", ...path.map(Str.configCase)].join("_") }),
});

/** A parsed settings file, named as a person reads it. */
export const file = (name: string, document: TomlDocument): Source => ({
  provider: ConfigProvider.fromUnknown(document.value, { preserveEmptyStrings: true }),
  origin: (path) =>
    Origin.cases.file.make({
      file: name,
      line:
        document.spans.find((s) => s.path.length === path.length && s.path.every((p, n) => p === path[n]))?.line ?? 0,
    }),
});

const location = (origin: Origin) =>
  origin._tag === "file" ? `${origin.file}, line ${origin.line}` : origin._tag === "default" ? "default" : origin.name;

export const resolve = Effect.fnUntraced(function* <A>(group: Setting.Group<A>, slots: Slots) {
  const order = [slots.flags, slots.env, slots.repo, slots.person];
  const origins: Record<string, Origin> = {};
  const supplied: Record<string, string> = {};

  for (const d of group.declarations) {
    origins[d.path] = Origin.cases.default.make({});

    for (const source of order) {
      const node = yield* source.provider
        .load(d.segments)
        .pipe(
          Effect.mapError(
            (cause) => new SettingsError({ reason: "read", message: `${d.path} could not be read.\n  ${STOP}`, cause }),
          ),
        );

      if (node !== undefined) {
        origins[d.path] = source.origin(d.segments);
        supplied[d.path] = node.value ?? "";
        break;
      }
    }
  }

  const provider = [slots.env, slots.repo, slots.person].reduce(
    (chain, source) => chain.pipe(ConfigProvider.orElse(source.provider)),
    slots.flags.provider,
  );
  const values = yield* group.parse(provider).pipe(
    Effect.mapError((error: Config.ConfigError) => {
      const issue = error.cause instanceof Schema.SchemaError ? error.cause.issue : undefined;
      const path =
        issue === undefined ? [] : (SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues[0]?.path ?? []);
      const d = group.declarations.find((d) => d.segments.join(".") === path.join("."));
      return d === undefined
        ? new SettingsError({ reason: "read", message: `The settings could not be read.\n  ${STOP}`, cause: error })
        : refused(location(origins[d.path] ?? Origin.cases.default.make({})), d, supplied[d.path] ?? "");
    }),
  );
  const resolved: Resolved<A> = { values, origins };
  return resolved;
});
