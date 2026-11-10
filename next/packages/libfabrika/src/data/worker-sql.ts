import type { Sql } from "./referee.ts";

export const workerSql = (storage: DurableObjectStorage): Sql => ({
  exec: (query, ...params) => Array.from(storage.sql.exec(query, ...params)),
  transaction: (step) => storage.transactionSync(step),
  size: () => storage.sql.databaseSize,
});
