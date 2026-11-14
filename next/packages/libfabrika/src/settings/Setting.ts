/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
/**
 * Declares a setting once, and the declaration is the Config that reads it (0086).
 *
 * **Details**
 *
 * The Config keeps Effect's own prototype, so `yield*` and `parse(provider)` behave as Effect's do. The declaration's fields are added to that same object, never copied beside it. `group` joins declarations into one Config and refuses a set that cannot be read together.
 *
 * @stability unstable
 */
import { Config, Schema, String as Str } from "effect";

/**
 * The two settings files: the person's own, and the repo's.
 *
 * @stability unstable
 * @category models
 */
export type File = "person" | "repo";

/**
 * The files a setting may be set in, at least one.
 *
 * @stability unstable
 * @category models
 */
export type Scope = readonly [File, ...Array<File>];

/**
 * When a changed value takes effect: a `live` setting reaches a running process, and a `restart` setting waits for the next start.
 *
 * @stability unstable
 * @category models
 */
export type Reload = "live" | "restart";

/**
 * Whether a file holds native JSON values (`json`) or text decoded by Effect's StringTree codec (`text`).
 *
 * @stability unstable
 * @category models
 */
export type Format = "json" | "text";

/**
 * One declared setting: a Config of `A` that also carries what a person, a file and the generated reference need to know about it.
 *
 * **Details**
 *
 * `path` is the dotted key, `segments` its parts, and `env` the environment name derived from it. `schema` and `default` define the value, `format` says how a file spells it, `doc` is the sentence shown to a person, and `scope`, `reload` and `since` say where it may be set, when a change applies and which release introduced it.
 *
 * @stability unstable
 * @category settings
 */
export interface Setting<
  A,
  S extends Scope = Scope,
  C extends Schema.Codec<A, unknown> = Schema.Codec<A, unknown>,
> extends Config.Config<A> {
  /** The dotted path a person writes, as `instance.port`. */
  readonly path: string;
  /** The path's segments, as `["instance", "port"]`: what a provider is asked for. */
  readonly segments: ReadonlyArray<string>;
  /** The environment name, as `FABRIKA_INSTANCE_PORT`. */
  readonly env: string;
  readonly schema: C;
  readonly format: Format;
  readonly default: A;
  readonly doc: string;
  readonly scope: S;
  readonly reload: Reload;
  /** The release that introduced the key, as `0.1.0`: a release fact, never a person's choice. */
  readonly since: string;
}

/**
 * Declares one setting at a dotted path.
 *
 * **Details**
 *
 * The environment name is `FABRIKA_` and the constant-cased segments, and `format` defaults to `json`. Reading the result gives the default only when no source holds the key. A value that is present but refused by the schema, an empty container included, fails and never falls back to the default. A failure of the source itself also fails.
 *
 * @stability unstable
 * @category constructors
 */
export const make = <C extends Schema.Codec<any, unknown>, const S extends Scope>(
  path: string,
  options: {
    readonly schema: C;
    readonly default: NoInfer<C["Type"]>;
    readonly format?: Format;
    readonly doc: string;
    readonly scope: S;
    readonly reload: Reload;
    readonly since: string;
  },
): Setting<C["Type"], S, C> => {
  // Effect reads a string path as one key, so the dotted path is split here.
  const segments = path.split(".");
  const env = ["FABRIKA", ...segments.map(Str.configCase)].join("_");
  // Config treats a container supplied to a scalar schema as absent. Before defaulting,
  // check every provider shape so a present value, including [], stays a failure.
  const present = Schema.Union([Schema.String, Schema.Array(Schema.Never), Schema.Struct({})]);
  const config = Config.schema(options.schema, segments).pipe(
    Config.orElse((error) => {
      if (error.cause._tag === "SourceError") {
        return Config.fail(error.cause);
      }

      return Config.schema(present, segments).pipe(
        Config.flatMap(() => Config.fail(error.cause)),
        Config.withDefault(options.default),
      );
    }),
  );
  return Object.assign(config, { ...options, format: options.format ?? "json", path, segments, env });
};

/**
 * A Config of a whole record of settings, with its declarations beside it.
 *
 * **Details**
 *
 * `settings` keeps each declaration under the name it has in the record, and `declarations` lists them as plain declarations.
 *
 * @stability unstable
 * @category settings
 */
export interface Group<
  A,
  R extends Record<string, Setting<any>> = Record<string, Setting<any>>,
> extends Config.Config<A> {
  /** Each declaration by the name its value has in the group's record. */
  readonly settings: R;
  readonly declarations: ReadonlyArray<Setting<unknown>>;
}

const segment = /^[a-z0-9][a-z0-9-]*$/;

/** Why a set of declarations cannot be read together, or undefined when it can. */
const conflict = (declarations: ReadonlyArray<Setting<unknown>>) => {
  for (const [n, a] of declarations.entries()) {
    if (!a.segments.every((s) => segment.test(s))) {
      return `${a.path} is not a setting path`;
    }

    if (!Schema.is(a.schema)(a.default)) {
      return `${a.path} has a default its schema refuses`;
    }

    for (const b of declarations.slice(n + 1)) {
      const [short, long] = a.segments.length <= b.segments.length ? [a, b] : [b, a];

      if (short.segments.every((s, i) => long.segments[i] === s)) {
        return `${a.path} and ${b.path} are one path, or a value and its table`;
      }

      if (a.env === b.env) {
        return `${a.path} and ${b.path} share ${a.env}`;
      }
    }
  }

  return undefined;
};

/**
 * The record of values a group reads, inferred from Config and readonly like the generated value Struct.
 *
 * @stability unstable
 * @category models
 */
export type Values<R extends Record<string, Setting<any>>> = Readonly<Config.Success<ReturnType<typeof Config.all<R>>>>;

/**
 * Joins a record of settings into one group.
 *
 * **Gotchas**
 *
 * Throws an `Error` when the declarations cannot be read together: a path segment that is empty, or is not a lowercase letter or digit followed by lowercase letters, digits and hyphens, a default its own schema refuses, two paths that are equal or where one is a table of the other, or two paths with the same environment name.
 *
 * @stability unstable
 * @category constructors
 */
export const group = <const R extends Record<string, Setting<any>>>(settings: R): Group<Values<R>, R> => {
  const declarations = Object.values(settings);
  const refused = conflict(declarations);

  if (refused !== undefined) {
    throw new Error(`Settings cannot be declared: ${refused}.`);
  }

  return Object.assign(Config.all(settings), { settings, declarations });
};
