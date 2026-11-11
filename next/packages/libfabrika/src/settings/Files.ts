// Both settings files are checked whole and strictly before any value is used (settings.md S5).
// The repo's `fabrika-version` is read first. Each file's Struct is derived from the declarations
// in its scope; a failure is explained at its key, with the line the Toml service gave.
import { Effect, Order, Predicate, Schema, SchemaAST, SchemaIssue } from "effect";
import * as Declarations from "./Declarations.ts";
import type * as Setting from "./Setting.ts";
import type { TomlDocument } from "./Toml.ts";

export class SettingsError extends Schema.TaggedError<SettingsError>()("SettingsError", {
  reason: Schema.Literals(["version", "syntax", "unknown", "scope", "invalid", "read"]),
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
}) {}

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
const leaf = (value: unknown, path: Path): Path => {
  const below = at(value, path);
  const key = Predicate.isObject(below) ? Object.keys(below)[0] : undefined;
  return key === undefined ? path : leaf(value, [...path, key]);
};

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

/** S5's first message: the key, its value, what it should be, and the stop. */
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

/** The Struct a file is decoded with: every table and leaf optional, each leaf as JSON. */
const struct = (declarations: ReadonlyArray<Declaration>, depth: number): Schema.Codec<unknown, unknown> =>
  Schema.Struct(
    Object.fromEntries(
      [...new Set(declarations.flatMap((d) => d.segments[depth] ?? []))].map((key) => {
        const below = declarations.filter((d) => d.segments[depth] === key);
        const own = below.find((d) => d.segments.length === depth + 1);
        return [key, Schema.optionalKey(own === undefined ? struct(below, depth + 1) : Schema.toCodecJson(own.schema))];
      }),
    ),
  );

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
      ? refused(located(place, path), d, JSON.stringify(at(place.document.value, path)))
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

const newer = Order.isGreaterThan(Order.Tuple([Order.Number, Order.Number, Order.Number]));

/** Refuse a repo that needs a newer fabrika, before anything else in either file is read. */
export const supported = Effect.fnUntraced(function* (repo: Place, version: string) {
  const d = Declarations.version;
  const wanted = repo.document.value[d.path];

  if (wanted === undefined) {
    return;
  }

  if (!Schema.is(d.schema)(wanted)) {
    return yield* refused(located(repo, d.segments), d, JSON.stringify(wanted));
  }

  if (newer(triple(wanted), triple(version))) {
    return yield* new SettingsError({
      reason: "version",
      message: `${located(repo, d.segments)}: This repo needs fabrika ${wanted} or newer. You have ${version}.\n  ${STOP}`,
    });
  }
});

export const validate = Effect.fnUntraced(function* <A>(
  group: Setting.Group<A>,
  files: Files,
  options: { readonly version: string },
) {
  yield* supported(files.repo, options.version);

  for (const file of ["repo", "person"] as const) {
    const schema = struct(
      group.declarations.filter((d) => d.scope.includes(file)),
      0,
    );
    yield* Schema.decodeUnknownEffect(schema)(files[file].document.value, { onExcessProperty: "error" }).pipe(
      Effect.mapError((error) => explain(group.declarations, files, file, error.issue)),
    );
  }
});
