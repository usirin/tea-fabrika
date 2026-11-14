// L17's scan of an instance's home (P14 slice 2, ticket 828), in a file of its own so its law in
// `stored.test.ts` can run it on a folder that a writer changes under it.
import { DatabaseSync } from "node:sqlite"; // edge: inspect the instance's persisted SQLite cells, including records outside access history
import { Row as LedgerRow } from "@kampus/libfabrika/ledger/Log";
import { Effect, FileSystem, Path, Schema } from "effect";

/** An instance's home, and the stop that ends every process that writes in it. */
export type Instance<E> = { readonly dir: string; readonly stop: Effect.Effect<void, E> };

/** Check every file and SQLite cell. Two places keep a signature on purpose, and only its `armored`
 *  text is omitted there: a verified access entry's signed.armored, and the gateway's replay rows.
 *  Checking cells too catches a copy of that entire body in another table or stream.
 *
 *  The scan stops the instance first. A running brain writes each file to `<name>.tmp` and renames
 *  it over `<name>` (`durableWrite` in libfabrika's `node/dev/local-dev.ts`), and SQLite adds and
 *  drops its journals, so a live folder changes between the listing and the reads: a listed file is
 *  gone, or a file read before a rename misses the bytes the rename brings. A stopped instance's
 *  folder holds every file it left, its stop's own writes included, and nothing changes it. */
export const stored = <E>(
  instance: Instance<E>,
  accessBodies: ReadonlyMap<string, string>,
  proofs: ReadonlyArray<string>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem,
        path = yield* Path.Path;
      const { dir } = instance;
      yield* instance.stop;
      const keys = [path.join(dir, "person"), path.join(dir, "person.pub")];
      const files: Array<string> = [];

      for (const name of yield* fs.readDirectory(dir, { recursive: true })) {
        const file = path.join(dir, name);

        if ((yield* fs.stat(file)).type === "File" && !keys.includes(file)) {
          files.push(file);
        }
      }

      const read: Array<{ readonly file: string; readonly label: string; readonly bytes: string }> = [];

      for (const file of files) {
        const bytes = Buffer.from(yield* fs.readFile(file)).toString("latin1");
        read.push({ file, label: `home ${file.slice(dir.length)}`, bytes });
      }

      const raw = read.map(({ label, bytes }): readonly [string, string] => [label, bytes]);
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

      return { outputs, raw };
    }),
  );
