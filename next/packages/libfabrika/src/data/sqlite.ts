// node:sqlite as the referee's `Sql`, on its own subpath so the data layer's top level names no
// platform. For tests, never a ledger file of its own: the one ledger is a Durable Object. Tier 1, P6.
import type { DatabaseSync, SQLOutputValue, StatementSync } from "node:sqlite"; // edge: Effect SQL has no synchronous SQLite handle for the referee's transactions
import type { Sql, SqlValue } from "./referee.ts";

/** The ledger writes text, integers and nulls only. A blob or a big integer is a row it never wrote. */
const value = (column: SQLOutputValue): SqlValue => {
  if (typeof column === "string" || typeof column === "number" || column === null) {
    return column;
  }

  throw new TypeError(`a ${typeof column} column, which the ledger never writes`);
};

export const nodeSql = (db: DatabaseSync): Sql => {
  const statements = new Map<string, StatementSync>();
  const prepared = (query: string): StatementSync => {
    const known = statements.get(query);

    if (known !== undefined) {
      return known;
    }

    const statement = db.prepare(query);
    statements.set(query, statement);
    return statement;
  };
  return {
    exec: (query, ...params) =>
      prepared(query)
        .all(...params)
        .map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, value(v)]))),
    transaction: (step) => {
      db.exec("BEGIN IMMEDIATE");

      try {
        const done = step();
        db.exec("COMMIT");
        return done;
      } catch (error) {
        // SQLite rolls some failures back by itself, SQLITE_FULL among them; then there is none to
        // roll back, and a ROLLBACK would throw over the real error.
        if (db.isTransaction) {
          db.exec("ROLLBACK");
        }

        throw error;
      }
    },
    size: () => {
      const [count] = prepared("PRAGMA page_count").all();
      const [page] = prepared("PRAGMA page_size").all();
      return Number(count?.["page_count"] ?? 0) * Number(page?.["page_size"] ?? 0);
    },
  };
};
