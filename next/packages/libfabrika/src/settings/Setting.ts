// A setting is declared once, and the declaration is the Config that reads it (0086). The Config
// keeps Effect's own prototype, so `yield*` and `parse(provider)` behave as Effect's do; the
// declaration's fields are added to that same object, never copied beside it.
import { Config, Schema, String as Str } from "effect";

/** The two settings files: the person's own, and the repo's. */
export type File = "person" | "repo";

/** The files a setting may be set in, at least one. */
export type Scope = readonly [File, ...Array<File>];

/** A live setting reaches a running process; a restart setting waits for the next start. */
export type Reload = "live" | "restart";

/** Whether a file holds native JSON values or text decoded by Effect's StringTree codec. */
export type Format = "json" | "text";

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

/** The record a group reads, inferred from Config and readonly like the generated value Struct. */
export type Values<R extends Record<string, Setting<any>>> = Readonly<Config.Success<ReturnType<typeof Config.all<R>>>>;

/** One Config of the record, with its declarations beside it. Paths are checked as it is made. */
export const group = <const R extends Record<string, Setting<any>>>(settings: R): Group<Values<R>, R> => {
  const declarations = Object.values(settings);
  const refused = conflict(declarations);

  if (refused !== undefined) {
    throw new Error(`Settings cannot be declared: ${refused}.`);
  }

  return Object.assign(Config.all(settings), { settings, declarations });
};
