// One of the shared names of 0043, on layer 0 (0091): a value every module may import, with no service
// and no error.
export type SqlValue = string | number | null;

/** workerd's SQLite and node:sqlite supply the same synchronous operations. */
export interface Sql {
  readonly exec: (query: string, ...params: ReadonlyArray<SqlValue>) => ReadonlyArray<Record<string, SqlValue>>;
  readonly transaction: <A>(step: () => A) => A;
  readonly size: () => number;
}
