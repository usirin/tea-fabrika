import type { Sql } from "../Sql.ts";

export const cloudflareSql = (storage: DurableObjectStorage): Sql => ({
  exec: (query, ...params) => Array.from(storage.sql.exec(query, ...params)),
  transaction: (step) => storage.transactionSync(step),
  size: () => storage.sql.databaseSize,
});
