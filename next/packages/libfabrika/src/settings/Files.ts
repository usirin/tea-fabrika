/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
/**
 * Checks both settings files whole and strictly before any value is used.
 *
 * **Details**
 *
 * The repo's `fabrika-version` is read first. Each file's schema is derived from the declarations whose scope includes that file. A failure is explained at its key, with the line the Toml service gave.
 *
 * @stability unstable
 */
import { Effect, Order, Predicate, Schema, SchemaAST, SchemaIssue } from "effect";
import * as Codec from "./Codec.ts";
import * as Declarations from "./Declarations.ts";
import type * as Setting from "./Setting.ts";
import type { TomlDocument } from "./Toml.ts";

/**
 * Error for a settings problem that stops the instance, with a message written for the person who must fix it.
 *
 * **Details**
 *
 * `reason` says which problem. This folder builds `version` (the repo needs a newer fabrika), `unknown` (no such setting, with a near-miss guess when one key is close), `scope` (the setting exists but not in this file), `invalid` (a value or table the schema refuses), and `read` (a source could not be read, or its value could not be traced to a declaration). `syntax` is built by the loader in `node/settings/Load.ts`, which turns a TOML error into it; that loader also builds `read` for a file it cannot read and `invalid` for a saved snapshot it cannot check. `cause` holds the underlying failure when there is one.
 *
 * @stability unstable
 * @category errors
 */
export class SettingsError extends Schema.TaggedError<SettingsError>()("SettingsError", {
  reason: Schema.Literals(["version", "syntax", "unknown", "scope", "invalid", "read"]),
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

/**
 * The closing sentence of every settings message: "The instance did not start."
 *
 * **Details**
 *
 * Other modules import it so their messages end the same way.
 *
 * @stability unstable
 * @category models
 */
export const STOP = "The instance did not start.";

type Declaration = Setting.Setting<unknown>;
type Path = ReadonlyArray<string>;

interface Place {
  /** The name a person reads, as `~/.fabrika/fabrika.toml`. */
  readonly file: string;
  readonly document: TomlDocument;
}

const owner = { person: "a person's", repo: "a repo's" } as const;
const same = (a: Path, b: Path) => a.length === b.length && a.every((s, n) => s === b[n]);
/** Whether `path` is the declaration's own path or one of its tables. */
const under = (d: Declaration, path: Path) => path.every((s, n) => d.segments[n] === s);

const at = (value: unknown, path: Path) =>
  path.reduce<unknown>((v, key) => (Predicate.isObject(v) ? v[key] : undefined), value);

/** The first key/value at or under `path`. */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
const leaf = (value: unknown, path: Path): Path => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  const below = at(value, path);
  const key = Predicate.isObject(below) ? Object.keys(below)[0] : undefined;
  return key === undefined ? path : leaf(value, [...path, key]);
};

/** A value as the message shows it: a scalar as written, an array or a table only by its shape. */
const shape = (value: unknown) =>
  Array.isArray(value) ? "[…]" : Predicate.isObject(value) ? "{…}" : JSON.stringify(value);

/** "file, line n" for the key at `path`, or for its nearest table with a line. */
const located = (place: Place, path: Path) => {
  for (let n = path.length; n > 0; n--) {
    const span = place.document.spans.find((s) => same(s.path, path.slice(0, n)));

    if (span !== undefined) {
      return `${place.file}, line ${span.line}`;
    }
  }

  return place.file;
};

/**
 * Builds the `invalid` error for a value a declaration's schema refuses.
 *
 * **Details**
 *
 * The message names the location, the key, the value as shown, the schema's title as what was expected, and its description as the rule. Without a title or description it falls back to "a valid value" and "fabrika settings lists every setting." The caller passes `shown`, the text printed for the value.
 *
 * @stability unstable
 * @category errors
 */
export const refused = (location: string, d: Declaration, shown: string) => {
  const expected = SchemaAST.resolveTitle(d.schema.ast) ?? "a valid value";
  const rule = SchemaAST.resolveDescription(d.schema.ast) ?? "fabrika settings lists every setting.";
  return new SettingsError({
    reason: "invalid",
    message: `${location}: ${d.path} = ${shown} is not ${expected}.\n  ${rule} ${STOP}`,
  });
};

/** Edits from one key to another, a swap of two letters counting as one. */
const distance = (a: string, b: string) => {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => i + j));
  const cell = (i: number, j: number) => rows[i]?.[j] ?? 0;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const swap = a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] && i > 1 && j > 1 ? cell(i - 2, j - 2) + 1 : Infinity;
      const edit = cell(i - 1, j - 1) + (a[i - 1] === b[j - 1] ? 0 : 1);
      rows[i]?.splice(j, 1, Math.min(cell(i - 1, j) + 1, cell(i, j - 1) + 1, edit, swap));
    }
  }

  return cell(a.length, b.length);
};

/** The Struct a file is decoded with: every table and leaf optional. */
const struct = (declarations: ReadonlyArray<Declaration>, depth: number): Schema.Codec<unknown, unknown> =>
  Schema.Struct(
    Object.fromEntries(
      [...new Set(declarations.flatMap((d) => d.segments[depth] ?? []))].map((key) => {
        const below = declarations.filter((d) => d.segments[depth] === key);
        const own = below.find((d) => d.segments.length === depth + 1);
        return [key, Schema.optionalKey(own === undefined ? struct(below, depth + 1) : Codec.file(own))];
      }),
    ),
  );

/**
 * Builds the schema of one settings file from the declarations whose scope includes that file.
 *
 * **Details**
 *
 * Validation and the editor's JSON Schema share this one schema. Declarations are sorted by path, so their order never shows. Every table and key is optional.
 *
 * **Gotchas**
 *
 * A file no declaration may be set in gets a schema that refuses every key, because Effect's empty Struct would take any object.
 *
 * @stability unstable
 * @category constructors
 */
export const schema = <A>(group: Setting.Group<A>, file: Setting.File): Schema.Codec<unknown, unknown> => {
  const own = group.declarations.filter((d) => d.scope.includes(file)).sort((a, b) => (a.path < b.path ? -1 : 1));
  return own.length === 0 ? Schema.Record(Schema.String, Schema.Never) : struct(own, 0);
};

/** The one message for the first issue in `file`. Unknown keys are named; their values never are. */
const explain = (
  declarations: ReadonlyArray<Declaration>,
  files: Files,
  file: Setting.File,
  issue: SchemaIssue.Issue,
) => {
  const place = files[file];
  const path = (SchemaIssue.makeFormatterStandardSchemaV1()(issue).issues[0]?.path ?? []).map(String);
  const own = declarations.filter((d) => d.scope.includes(file));

  if (own.some((d) => under(d, path))) {
    const d = own.find((d) => same(d.segments, path));
    return d !== undefined
      ? refused(located(place, path), d, shape(at(place.document.value, path)))
      : new SettingsError({
          reason: "invalid",
          message: `${located(place, path)}: ${path.join(".")} is a table of settings.\n  fabrika settings lists every setting. ${STOP}`,
        });
  }

  const key = leaf(place.document.value, path);
  const location = located(place, key);
  const other = declarations.find((d) => under(d, key));

  if (other !== undefined) {
    return new SettingsError({
      reason: "scope",
      message:
        `${location}: ${other.path} is ${owner[other.scope[0]]} setting, so ${owner[file]} file may not set it.\n` +
        `  Set it in ${other.scope.map((f) => files[f].file).join(" or ")}, as ${other.env}, or with --${other.path}. ${STOP}`,
    });
  }

  // A guess names only a key this file may set.
  const near = own.map((d) => d.path).find((p) => distance(p, key.join(".")) <= 2);
  return new SettingsError({
    reason: "unknown",
    message:
      `${location}: there is no setting ${key.join(".")}.${near === undefined ? "" : ` Did you mean ${near}?`}\n` +
      `  fabrika settings lists every setting. ${STOP}`,
  });
};

type Files = Readonly<Record<Setting.File, Place>>;

const triple = (version: string) => {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
  return [major, minor, patch] as const;
};

const greater = Order.isGreaterThan(Order.Tuple([Order.Number, Order.Number, Order.Number]));

/**
 * Returns whether release `a` is newer than release `b`.
 *
 * **Details**
 *
 * Both are split on dots and compared as three whole numbers, so `1.10.0` is newer than `1.9.0`. A missing or non-numeric part counts as zero or compares as `NaN`, so pass checked versions.
 *
 * @stability unstable
 * @category combinators
 */
export const newer = (a: string, b: string) => greater(triple(a), triple(b));

/**
 * Fails when the repo's file states a minimum fabrika version that is newer than the running one.
 *
 * **Details**
 *
 * Succeeds with nothing when the repo's file does not set `fabrika-version`. A value that the version schema refuses fails as `invalid`, and a newer one fails as `version`. Both messages carry the file and line.
 *
 * @stability unstable
 * @category combinators
 */
export const supported = Effect.fnUntraced(function* (repo: Place, version: string) {
  const d = Declarations.version;
  const wanted = repo.document.value[d.path];

  if (wanted === undefined) {
    return;
  }

  if (!Schema.is(d.schema)(wanted)) {
    return yield* refused(located(repo, d.segments), d, shape(wanted));
  }

  if (newer(wanted, version)) {
    return yield* new SettingsError({
      reason: "version",
      message: `${located(repo, d.segments)}: This repo needs fabrika ${wanted} or newer. You have ${version}.\n  ${STOP}`,
    });
  }
});

/**
 * Checks the repo's file, then the person's file, against the group's declarations.
 *
 * **Details**
 *
 * First runs `supported` on the repo's file. Then each file is decoded with excess keys refused, and the first issue becomes one `SettingsError`: `invalid`, `scope` or `unknown`. Unknown keys are named, and their values never are. It does not read any source other than the two files, so flags and environment values are not checked here.
 *
 * @stability unstable
 * @category combinators
 */
export const validate = Effect.fnUntraced(function* <A>(
  group: Setting.Group<A>,
  files: Files,
  options: { readonly version: string },
) {
  yield* supported(files.repo, options.version);

  for (const file of ["repo", "person"] as const) {
    yield* Schema.decodeUnknownEffect(schema(group, file))(files[file].document.value, {
      onExcessProperty: "error",
    }).pipe(Effect.mapError((error) => explain(group.declarations, files, file, error.issue)));
  }
});
