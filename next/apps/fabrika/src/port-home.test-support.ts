// next/, test support. The guard law 5's writer runs before it saves a home: every place in a
// folder that names a machine path, so a saved home that would leak one is never committed.
// Its law is port-home-guard.test.ts.
//
// It reads two ways, because a byte scan alone misses a cell. Every file's raw bytes are read, and
// every SQLite file is opened from a copy, read-only, and every text and blob cell of every table
// is read: a cell longer than a page is split across SQLite's overflow pages, so a path in it may
// never appear whole in the file's bytes. The folder it reads is never changed: a read-only open
// may still write a `-shm` file, so it opens the copy.
// edge: Effect SQL has no read-only open of a SQLite file, and the guard reads every cell of one
import { DatabaseSync } from "node:sqlite";
import { Effect, FileSystem, Path, Schema } from "effect";

/** Where in a file a machine path was found: a byte offset in a file's raw bytes, or one SQLite cell. */
export const Place = Schema.TaggedUnion({
  byte: { offset: Schema.Number },
  cell: { table: Schema.String, row: Schema.Number, column: Schema.String },
});

/** One machine path found: the file, relative to the folder read, the place in it, and the root it names. */
export const Hit = Schema.Struct({ file: Schema.String, place: Place, root: Schema.String });

class GuardError extends Schema.TaggedError<GuardError>()("GuardError", {
  file: Schema.String,
  cause: Schema.Defect(),
}) {}

const encoder = new TextEncoder();
const SQLITE = encoder.encode("SQLite format 3\0");

/** Every offset in `bytes` where `part` starts. */
const offsets = (bytes: Uint8Array, part: Uint8Array): Array<number> => {
  const found: Array<number> = [];
  let at = part.length === 0 ? -1 : bytes.indexOf(part[0] ?? 0);

  while (at !== -1 && at + part.length <= bytes.length) {
    if (part.every((byte, n) => bytes[at + n] === byte)) {
      found.push(at);
    }

    at = bytes.indexOf(part[0] ?? 0, at + 1);
  }

  return found;
};

const startsWith = (bytes: Uint8Array, head: Uint8Array) =>
  bytes.length >= head.length && head.every((byte, n) => bytes[n] === byte);

/** The forms a stored text could copy a root in: plain, JSON-escaped, and as a `file://` URL. */
const rootForms = Effect.fnUntraced(function* (root: string) {
  const path = yield* Path.Path;
  const url = yield* path.toFileUrl(root);
  return [...new Set([root, JSON.stringify(root).slice(1, -1), url.href])].map((text) => ({
    text,
    bytes: encoder.encode(text),
  }));
});

type Forms = ReadonlyArray<{
  readonly root: string;
  readonly forms: ReadonlyArray<{ text: string; bytes: Uint8Array }>;
}>;

/** One hit per copy of a root in `bytes`: a copy in one form that holds another form, as a URL
 *  holds the plain path, is one copy, at its first byte. */
const byteHits = (file: string, bytes: Uint8Array, roots: Forms): Array<typeof Hit.Type> =>
  roots.flatMap(({ root, forms }) => {
    const spans = forms
      .flatMap(({ bytes: form }) => offsets(bytes, form).map((start) => [start, start + form.length] as const))
      .sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged: Array<[number, number]> = [];

    for (const [start, end] of spans) {
      const last = merged.at(-1);

      if (last !== undefined && start < last[1]) {
        last[1] = Math.max(last[1], end);
      } else {
        merged.push([start, end]);
      }
    }

    return merged.map(([offset]) => ({ file, place: Place.cases.byte.make({ offset }), root }));
  });

/** Every text and blob cell of every table of the SQLite file at `copy` that holds a root. */
const cellHits = (file: string, copy: string, roots: Forms) =>
  Effect.acquireRelease(
    Effect.try({
      try: () => new DatabaseSync(copy, { readOnly: true }),
      catch: (cause) => new GuardError({ file, cause }),
    }),
    (db) => Effect.sync(() => db.close()),
  ).pipe(
    Effect.flatMap((db) =>
      Effect.try({
        try: () => {
          const hits: Array<typeof Hit.Type> = [];
          const tables = db.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table'`).all();

          for (const { name } of tables) {
            const table = String(name);
            const rows = db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`).all();

            for (const [row, cells] of rows.entries()) {
              for (const [column, value] of Object.entries(cells)) {
                for (const { root, forms } of roots) {
                  const holds =
                    typeof value === "string"
                      ? forms.some(({ text }) => value.includes(text))
                      : value instanceof Uint8Array && forms.some(({ bytes }) => offsets(value, bytes).length > 0);

                  if (holds) {
                    hits.push({ file, place: Place.cases.cell.make({ table, row, column }), root });
                  }
                }
              }
            }
          }

          return hits;
        },
        catch: (cause) => new GuardError({ file, cause }),
      }),
    ),
  );

/**
 * Every place under `folder` that names one of `roots`, in its plain, JSON-escaped or `file://`
 * form. A SQLite file reports its cells; a copy in its raw bytes is reported too when no cell of
 * that file names the same root, such as a deleted row still in a free page.
 */
export const machinePaths = Effect.fn("portHome.machinePaths")(function* (
  folder: string,
  roots: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const forms: Forms = yield* Effect.forEach(
    roots,
    (root) => rootForms(root).pipe(Effect.map((list) => ({ root, forms: list }))),
    { concurrency: 1 },
  );
  const hits: Array<typeof Hit.Type> = [];

  for (const file of (yield* fs.readDirectory(folder, { recursive: true })).sort()) {
    const full = path.join(folder, file);

    if ((yield* fs.stat(full)).type !== "File") {
      continue;
    }

    const bytes = yield* fs.readFile(full);
    const raw = byteHits(file, bytes, forms);

    if (!startsWith(bytes, SQLITE)) {
      hits.push(...raw);
      continue;
    }

    const cells = yield* Effect.scoped(
      Effect.gen(function* () {
        const copies = yield* fs.makeTempDirectoryScoped({ prefix: "port-home-guard-" });
        const copy = path.join(copies, "copy.sqlite");

        for (const side of ["", "-wal"]) {
          if (yield* fs.exists(`${full}${side}`)) {
            yield* fs.copyFile(`${full}${side}`, `${copy}${side}`);
          }
        }

        return yield* cellHits(file, copy, forms);
      }),
    );
    hits.push(...cells, ...raw.filter((hit) => !cells.some((cell) => cell.root === hit.root)));
  }

  return hits;
});
