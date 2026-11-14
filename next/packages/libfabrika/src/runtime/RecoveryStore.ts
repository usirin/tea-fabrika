/**
 * Where one registered name's recovery journal is kept: the journal row, and its receipts in rows
 * of their own, in the object's SQLite.
 *
 * @stability unstable
 */
import { Context, Effect, Layer, Schema } from "effect";
import { type Sql } from "../Sql.ts";
import { changes, Receipt } from "./internal/recovery.ts";

/**
 * Reason for a journal that could not be read or written: the `Sql` threw, or a save would grow
 * the database past its capacity. A throw is kept as `cause`; a full database has none.
 *
 * @stability unstable
 * @category errors
 */
export class Storage extends Schema.TaggedError<Storage>()("Storage", { cause: Schema.Defect() }) {}

/**
 * Reason for a saved journal or receipt that does not decode, or that is stored under another
 * name or letter. The decoder's failure is kept as `cause`; a misplaced row has none.
 *
 * @stability unstable
 * @category errors
 */
export class BadRow extends Schema.TaggedError<BadRow>()("BadRow", { cause: Schema.Defect() }) {}

/**
 * Error for a recovery journal that could not be loaded or saved.
 *
 * @stability unstable
 * @category errors
 */
export class RecoveryStoreError extends Schema.TaggedError<RecoveryStoreError>()("RecoveryStoreError", {
  reason: Schema.Union([Storage, BadRow]),
}) {}

/** A saved row this store did not write under that name or letter: there is no lower fault to keep. */
const misplaced = () => new RecoveryStoreError({ reason: new BadRow({ cause: undefined }) });

/** What the store reads of a saved journal: whose it is, and the receipts it keeps apart. */
const Kept = Schema.Struct({ name: Schema.String, receipts: Schema.Array(Receipt) });
type Kept = typeof Kept.Type;
const kept = Schema.decodeUnknownSync(Kept);

/** The saved journal's own schema, given by its caller: the runner passes the machine's. */
type Journal<S extends Kept> = Schema.Codec<S, unknown> & {
  readonly fields: { readonly [x: PropertyKey]: Schema.ConstraintCodec<unknown, unknown> };
};

type Store<S extends Kept> = {
  /** The saved journal with every receipt merged back in, or null before the first save. */
  readonly load: Effect.Effect<S | null, RecoveryStoreError>;
  /** Checks the whole journal, then writes it and its changed receipts in one transaction. */
  readonly save: (value: unknown) => Effect.Effect<void, RecoveryStoreError>;
  /** The input one letter's receipt kept, or null. */
  readonly input: (letter: string) => Effect.Effect<Schema.Json | null, RecoveryStoreError>;
  /** One letter's receipt, or null. */
  readonly receipt: (letter: string) => Effect.Effect<Receipt | null, RecoveryStoreError>;
};

const decodeReceipt = Schema.decodeUnknownSync(Schema.fromJsonString(Receipt));

const receiptFor = (value: unknown, letter: unknown) => {
  const saved = decodeReceipt(value);

  if (saved.letter !== letter) {
    throw misplaced();
  }

  return saved;
};

const TABLES = [
  "CREATE TABLE IF NOT EXISTS process_recovery (name TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS process_receipts (name TEXT NOT NULL, letter TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (name, letter))",
  // Every save that writes a row, by any store, bumps its name's generation, so a store sees another's
  // save in the one row it reads.
  "CREATE TABLE IF NOT EXISTS process_recovery_generation (name TEXT PRIMARY KEY, generation INTEGER NOT NULL)",
];

/** The journal row, with its name's generation beside it: one row, or none before the first save. */
const JOURNAL =
  "SELECT r.value, g.generation FROM process_recovery r LEFT JOIN process_recovery_generation g ON g.name = r.name WHERE r.name=?";

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** A row's text column, or null when there is no row. */
const textIn = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** A row's generation, or null when there is no row or no save has counted one yet. */
const generationIn = (value: unknown): number | null => (typeof value === "number" ? value : null);

/**
 * Makes the store for one name's saved journal in `sql`, checked whole against its caller's schema
 * on every load and save.
 *
 * **Details**
 *
 * The journal row and its receipts live in separate rows; `load` merges them back, and `save`
 * writes only the receipts that changed, in one transaction. A save that would grow the database
 * past `capacity` fails with `storage` and keeps the old rows. A row that does not decode, or is
 * stored under another name, fails with `bad_row`.
 *
 * @stability unstable
 * @category constructors
 */
export const recoveryStore = <S extends Kept>(
  sql: Sql,
  options: { readonly name: string; readonly capacity: number; readonly schema: Journal<S> },
): Store<S> => {
  // The journal row keeps its receipts apart, so it is checked whole only once they are merged back.
  const Row = Schema.fromJsonString(Schema.Struct(options.schema.fields));
  const decodeRow = Schema.decodeUnknownSync(Row);
  const decode = (text: unknown) => {
    const row = decodeRow(text);
    return { ...row, ...kept(row) };
  };
  const encode = Schema.encodeUnknownSync(Row);
  const check = Schema.decodeUnknownSync(options.schema);
  const stored = <A>(f: () => A) =>
    Effect.try({
      try: () => {
        for (const query of TABLES) {
          sql.exec(query);
        }

        return f();
      },
      // The store's own error, thrown in the step, passes through; anything else is kept under a reason.
      catch: (error) =>
        Schema.is(RecoveryStoreError)(error)
          ? error
          : new RecoveryStoreError({
              reason: Schema.isSchemaError(error) ? new BadRow({ cause: error }) : new Storage({ cause: error }),
            }),
    });
  /**
   * What this store last read or wrote for its name: the generation it saw, null before any save
   * counted one, and each receipt row's text.
   */
  type Known = { readonly generation: number | null; readonly receipts: ReadonlyMap<string, string> };
  // A copy of committed rows, never control state: it only decides how many rows a save reads.
  let known: Known | null = null;
  /**
   * The known receipt rows, or one read of the name's receipt rows when none are known or any save
   * that wrote a row since, this store's or another's, moved the generation.
   */
  const rows = (generation: number | null): ReadonlyMap<string, string> =>
    known !== null && known.generation === generation
      ? known.receipts
      : new Map(
          sql
            .exec("SELECT letter, value FROM process_receipts WHERE name=?", options.name)
            .map((row) => [String(row.letter), String(row.value)]),
        );
  const readJournal = () => sql.exec(JOURNAL, options.name)[0];
  const snapshot = (row = readJournal()) => {
    if (row === undefined) {
      return null;
    }

    const saved = decode(row.value);

    if (saved.name !== options.name) {
      throw misplaced();
    }

    return saved;
  };
  const load = stored(() => {
    const journalRow = readJournal();
    const saved = snapshot(journalRow);

    if (saved === null) {
      return null;
    }

    const receipts = new Map(saved.receipts.map((r) => [r.letter, r]));
    const texts = new Map<string, string>();

    for (const row of sql.exec(
      "SELECT letter, value FROM process_receipts WHERE name=? ORDER BY rowid",
      options.name,
    )) {
      const receipt = receiptFor(row.value, row.letter);
      receipts.set(receipt.letter, receipt);
      texts.set(receipt.letter, String(row.value));
    }

    const loaded = check({ ...saved, receipts: [...receipts.values()] });
    known = { generation: generationIn(journalRow?.generation), receipts: texts };
    return loaded;
  });
  const receipt = Effect.fn("recovery.receipt")(function* (letter: string) {
    return yield* stored(() => {
      const [row] = sql.exec("SELECT value FROM process_receipts WHERE name=? AND letter=?", options.name, letter);

      // Read old single-row snapshots until their next atomic save splits the receipts.
      if (row === undefined) {
        return snapshot()?.receipts.find((r) => r.letter === letter) ?? null;
      }

      return receiptFor(row.value, letter);
    });
  });
  const save = (value: unknown) =>
    stored(() => {
      const saved = check(value);

      if (saved.name !== options.name) {
        throw misplaced();
      }

      const text = encode({ ...saved, receipts: [] });
      const committed = sql.transaction(() => {
        const old = readJournal();
        const journal = textIn(old?.value);
        const generation = generationIn(old?.generation);
        // Omitted receipts are retained, including during migration from the old snapshot.
        const receipts = new Map((old === undefined ? [] : decode(old.value).receipts).map((r) => [r.letter, r]));

        for (const receipt of saved.receipts) {
          receipts.set(receipt.letter, receipt);
        }

        const prior = rows(generation);
        const { changed, growth: added } = changes(options.name, prior, receipts.values());
        // A save that writes no row leaves the generation as it was, so it writes nothing at all.
        const writes = changed.length > 0 || journal !== text;
        // The first save that writes adds its generation row: the name, and an integer of up to 8 bytes.
        const counted = writes && generation === null ? bytes(options.name) + 8 : 0;
        const growth = bytes(text) - (journal === null ? 0 : bytes(journal)) + added + counted;
        const next: Known = {
          generation: writes ? (generation ?? 0) + 1 : generation,
          receipts: new Map([...prior, ...changed.map((c) => [c.letter, c.text] as const)]),
        };

        if (sql.size() + growth > options.capacity) {
          throw new RecoveryStoreError({ reason: new Storage({ cause: undefined }) });
        }

        for (const receipt of changed) {
          sql.exec(
            "INSERT INTO process_receipts (name,letter,value) VALUES (?,?,?) ON CONFLICT(name,letter) DO UPDATE SET value=excluded.value",
            options.name,
            receipt.letter,
            receipt.text,
          );
        }

        if (journal !== text) {
          sql.exec(
            "INSERT INTO process_recovery (name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
            options.name,
            text,
          );
        }

        if (writes) {
          sql.exec(
            "INSERT INTO process_recovery_generation (name,generation) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET generation=excluded.generation",
            options.name,
            next.generation,
          );
        }

        return next;
      });
      // Only rows that committed are kept, so a refused or cut save leaves `known` as it was.
      known = committed;
    });
  return {
    load,
    save: Effect.fn("recovery.save")(save),
    receipt,
    input: Effect.fn("recovery.input")(function* (letter: string) {
      return (yield* receipt(letter))?.input ?? null;
    }),
  };
};

/**
 * Service that keeps one registered name's recovery journal and its receipts in the object's own
 * SQLite.
 *
 * **Details**
 *
 * The journal is checked whole against its caller's schema on every load and save. A receipt that
 * a save leaves out stays stored.
 *
 * **Gotchas**
 *
 * It fails with `RecoveryStoreError`. A save that would grow the database past `capacity` fails
 * with reason `Storage` and keeps the old rows. A row that does not decode, or that is stored
 * under another name, fails with reason `BadRow`.
 *
 * @stability unstable
 * @category services
 */
export class RecoveryStore extends Context.Service<RecoveryStore, Store<Kept>>()(
  "@kampus/libfabrika/runtime/RecoveryStore",
) {
  static readonly layer = <S extends Kept>(
    sql: Sql,
    options: { readonly name: string; readonly capacity: number; readonly schema: Journal<S> },
  ): Layer.Layer<RecoveryStore> => Layer.succeed(RecoveryStore, recoveryStore(sql, options));
}
