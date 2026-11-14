// L17's scan of an instance's home (P14 slice 2, ticket 828), in a file of its own so its law in
// `stored.test.ts` can run it on a folder that a writer changes under it.
import { DatabaseSync } from "node:sqlite"; // edge: inspect the instance's persisted SQLite cells, including records outside access history
import { Row as LedgerRow } from "@kampus/libfabrika/ledger/Log";
import { Effect, FileSystem, Path, type PlatformError, Schema } from "effect";

/** An instance's home, and the stop that ends every process that writes in it. */
export type Instance<E> = { readonly dir: string; readonly stop: Effect.Effect<void, E> };

/** Check every file and SQLite cell, twice: once while the instance runs, and once after its stop.
 *
 *  Each pass needs the other. The running pass sees what only a running instance keeps on disk: the
 *  span queue `brain.records.sqlite` is in WAL mode (libfabrika's `node/dev/dev-recording.ts`), and
 *  a row queued and then deleted once delivered (`telemetry/Sink.ts`) stays in its `-wal` file only
 *  until the clean stop's `db.close()` folds that file into the database and deletes it. The running
 *  pass may pass over a listed file that is gone before it is read, since a running brain writes
 *  each file to `<name>.tmp` and renames it over `<name>` (`durableWrite` in `node/dev/local-dev.ts`),
 *  and any other error fails it. The stopped pass reads a home nothing writes to any more: every file
 *  the instance left, its stop's own writes included, and any error fails it.
 *
 *  Two places keep a signature on purpose, and only its `armored` text is omitted there: a verified
 *  access entry's signed.armored, and the gateway's replay rows. Checking cells too catches a copy of
 *  that entire body in another table or stream. */
export const stored = <E>(
  instance: Instance<E>,
  accessBodies: ReadonlyMap<string, string>,
  proofs: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const running = yield* scan(instance.dir, "running", accessBodies, proofs);
    yield* instance.stop;
    const stopped = yield* scan(instance.dir, "stopped", accessBodies, proofs);
    return {
      outputs: [...running.outputs, ...stopped.outputs],
      raw: [...running.raw, ...stopped.raw],
      /** The files the running pass read, each by its path under the home, as `/brain.last.json`. */
      running: running.files,
    };
  });

/** One pass over the home. Its labels start with `home`, and the running pass's say so. */
const scan = (
  dir: string,
  pass: "running" | "stopped",
  accessBodies: ReadonlyMap<string, string>,
  proofs: ReadonlyArray<string>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path;
      // Only the running pass passes over a file renamed or deleted between its listing and its read.
      const gone = (error: PlatformError.PlatformError) => pass === "running" && error.reason._tag === "NotFound";
      const keys = [path.join(dir, "person"), path.join(dir, "person.pub")];
      const read: Array<{ readonly file: string; readonly label: string; readonly bytes: string }> = [];

      for (const name of yield* fs.readDirectory(dir, { recursive: true })) {
        const file = path.join(dir, name);
        const info = yield* fs.stat(file).pipe(Effect.catchIf(gone, () => Effect.succeed(undefined)));

        if (info === undefined || info.type !== "File" || keys.includes(file)) {
          continue;
        }

        const bytes = yield* fs.readFile(file).pipe(Effect.catchIf(gone, () => Effect.succeed(undefined)));

        if (bytes !== undefined) {
          const label = `home${pass === "running" ? " (running)" : ""} ${file.slice(dir.length)}`;
          read.push({ file, label, bytes: Buffer.from(bytes).toString("latin1") });
        }
      }

      const raw = read.map(({ label, bytes }): readonly [string, string] => [label, bytes]);
      const files = read.map(({ file }) => file.slice(dir.length));
      const outputs: Array<readonly [string, string]> = [];
      const retained = new Map<string, Map<string, string>>();

      for (const { file, label, bytes } of read) {
        if (!bytes.startsWith("SQLite format 3\0")) {
          continue;
        }

        const db = yield* Effect.acquireRelease(
          Effect.sync(() => new DatabaseSync(file, { readOnly: true })),
          (db) => Effect.sync(() => db.close()),
        );
        const allowed = new Map<string, string>();
        retained.set(file, allowed);
        const tables = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })))(
          db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all(),
        );

        for (const { name } of tables) {
          const table = `"${name.replaceAll('"', '""')}"`;
          const keys = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String, pk: Schema.Int })))(
            db.prepare(`PRAGMA table_info(${table})`).all(),
          )
            .filter((column) => column.pk > 0)
            .map((column) => column.name);
          const select = db.prepare(`SELECT * FROM ${table}`);
          // The runtime's own tables hold 64-bit integers, such as an alarm's time in nanoseconds.
          select.setReadBigInts(true);

          for (const [at, read] of select.all().entries()) {
            // An integer a JavaScript number holds exactly is read as one, as before; a larger one stays whole.
            const row = Object.fromEntries(
              Object.entries(read).map(([column, value]) => [
                column,
                typeof value === "bigint" && value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER
                  ? Number(value)
                  : value,
              ]),
            );
            const key = keys.length === 0 ? `row ${at}` : `key ${keys.map((column) => String(row[column])).join(" ")}`;
            let cells = row;

            if (
              name === "entries" &&
              row.stream === "gateway/access" &&
              ["granted", "revoked"].includes(String(row._tag))
            ) {
              const entry = Schema.decodeUnknownSync(LedgerRow)(row);
              const body = JSON.stringify(entry.body);
              const replacement = Schema.decodeUnknownSync(Schema.String)(accessBodies.get(body));
              allowed.set(body, replacement);
              cells = { ...row, body: replacement };
            }

            // The gateway's replay rows keep a whole signed change on purpose, since P10, to answer a
            // repeated change id: `changePending/<id>` and `change/<id>` in `gateway_state`. The parent
            // plan lets a grant's signature stay "only in the ledger locations that deliberately preserve
            // that public evidence", and this is one. A signature is public evidence, not a secret, and
            // the access entry above holds the same one. Only `armored` is left out, and only when it is
            // a proof this run really sent: anything else there is checked like any cell. The row's other
            // fields are checked too, and the raw file below is still checked whole for a private key
            // and for every credential.
            if (name === "gateway_state" && /^(?:changePending|change)\//.test(String(row.name))) {
              const value = Schema.decodeUnknownSync(Schema.String)(row.value);
              const { armored, ...rest } = Schema.decodeUnknownSync(
                Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json)),
              )(value);

              if (typeof armored === "string" && proofs.includes(armored)) {
                const replacement = JSON.stringify(rest);
                allowed.set(value, replacement);
                cells = { ...row, value: replacement };
              }
            }

            for (const [column, value] of Object.entries(cells)) {
              outputs.push([
                `${label} table ${name} ${key} column ${column}`,
                value instanceof Uint8Array ? Buffer.from(value).toString("latin1") : String(value),
              ]);
            }
          }
        }
      }

      for (const { file, label, bytes } of read) {
        // SQLite's journal repeats the same cells. No other file gets this exception. The raw bytes are
        // still scanned: only the exact text of an omitted cell is swapped for its checked form, so a
        // signature anywhere else in the file, under another key or in another table, is still found.
        const database = file.replace(/-(?:wal|shm|journal)$/, "");
        let checked = bytes;

        for (const [body, replacement] of retained.get(database) ?? []) {
          checked = checked.replaceAll(body, replacement);
        }

        outputs.push([label, checked]);
      }

      return { outputs, raw, files };
    }),
  );
