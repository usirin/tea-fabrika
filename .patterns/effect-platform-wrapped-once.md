---
where: "next/ platform edges"
when: "Calling a Promise, callback or throwing API from a platform or a library"
---

# A platform API is wrapped once, at its edge, and its errors keep their cause

```mermaid
flowchart LR
  platform["node:sqlite DatabaseSync"] --> nodeSql["nodeSql(db): Sql, one function"]
  nodeSql --> sql["Sql: our own interface"]
  sql --> store["ledgerStore: Effect.try at one border"]
  stub["a Durable Object stub"] --> call["call: one helper, one marked edge"]
  call --> ledger["Ledger service"]
  parser["toml-eslint-parser"] --> parse["Toml.parse: catch (cause)"]
  parse --> toml["Toml service"]
```

```ts
// next/packages/libfabrika/src/ledger/NodeSqlite.ts:3 and :15-32: the platform type, imported once
// and only as a type, becomes our `Sql` in one function. Nothing past it sees a DatabaseSync.
import type { DatabaseSync, SQLOutputValue, StatementSync } from "node:sqlite"; // edge: Effect SQL has no synchronous SQLite handle for the referee's transactions

export const nodeSql = (db: DatabaseSync): Sql => {
  const statements = new Map<string, StatementSync>();
  const prepared = (query: string): StatementSync => {
    // ... one prepared statement per query, kept
  };
  return {
    exec: (query, ...params) =>
      prepared(query)
        .all(...params)
        .map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, value(v)]))),

// next/packages/libfabrika/src/ledger/LedgerRemote.ts:24-26: a Promise stub, one helper for every method.
    const fail = () => new LedgerError({ reason: "unreachable" });
    // oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object stub answers with a Promise
    const io = Effect.tryPromise({ try: () => Reflect.apply(stub[name], stub, args), catch: fail });

// next/packages/libfabrika/src/settings/TomlParser.ts:30-37: a library that throws; the cause is kept.
      Effect.try({
        try: () => parseTOML(text),
        catch: (cause) =>
          new TomlError({
            message: cause instanceof Error ? cause.message : "The TOML could not be read.",
            line: cause instanceof ParseError ? cause.lineNumber : 1,
            cause,
          }),
```

A platform object (a database handle, a Durable Object stub, a library that throws, a Node API
with callbacks) meets our code in one place. That place turns it into our own interface or an
Effect service, and nothing past it sees the raw object.

Rules:

- **One wrapper per platform object, never one per call site.** `nodeSql` (`NodeSqlite.ts:15`) is
  the only code that touches `DatabaseSync`; the store speaks `Sql` (`ledger/internal/ledgerStore.ts:11`).
  `LedgerRemote.layer` sends every method through one `call` helper (`LedgerRemote.ts:14-33`), so
  three methods share one marked edge and one error mapper (`:36-38`).
- **The edge is one marked line.** A Promise gets `Effect.tryPromise` under
  `// oxlint-disable-next-line fabrika/no-promises -- edge: <why>` (`LedgerRemote.ts:25`). A platform
  import that Effect cannot replace says why on its own line (`NodeSqlite.ts:3`).
- **The error mapper keeps the cause.** `catch: (cause) => new X({ ..., cause })`
  (`TomlParser.ts:32-36`). A mapper with no parameter throws the reason away; see
  [effect-errors-keep-their-cause.md](./effect-errors-keep-their-cause.md).
- **A callback API takes `Effect.effectify`.** It wraps an error-first callback function once and
  maps its error with an `onError` argument (`effect/src/Effect.ts:26994`, stable in 4.1.2). Effect's
  Node file system wraps each Node call this way, once:
  `effectify(NFS.access, handleErrnoException("FileSystem", "access"), handleBadArgument("access"))`
  (`@effect/platform-node-shared/src/NodeFileSystem.ts:66-70`), and the mapper keeps the Node error
  as `cause` (`internal/utils.ts:50`). A callback that is not error-first takes `Effect.callback`
  (`Effect.ts:1897`). No `next/` product file uses either yet.
- **A synchronous throw crosses into Effect at one border.** `nodeSql`'s `transaction` throws, as a
  SQLite transaction must to roll back (`NodeSqlite.ts:33-49`). The store catches it once with
  `Effect.try` (`ledgerStore.ts:180`) and turns it into a `LedgerError`.

## Where it applies

Every platform object in `next/`: SQLite handles, Durable Object stubs, WebCrypto, `fetch`, Node
APIs and third-party parsers. Stops where Effect already ships the wrapper: use `FileSystem`,
`Path`, `ChildProcess`, `HttpClient` and `effect/crypto` instead of wrapping the platform again (see
[effect-reach-for-what-ships.md](./effect-reach-for-what-ships.md)).

## Not yet

- `next/packages/libfabrika/src/cloudflare/platform.ts` writes one `Effect.tryPromise` per stub
  method, each with its own edge comment, starting at `:20-41`, and every one fails with
  `catch: unreachable` (`:12`), which drops the cause. One helper over the stub's methods, like
  `LedgerRemote`'s `call`, replaces them. Whether that helper needs a type cast is not checked.
- `LedgerRemote`'s own mapper drops the cause too (`LedgerRemote.ts:24`, `:29`): `LedgerError` has
  no `cause` field yet (`ledger/Ledger.ts:10-18`).
- `ledgerStore.ts:189-192` keeps only the thrown error's `message`, not the error.

## Why it is not obvious

`Effect.tryPromise` is easy to write and reads clean, so an agent writes one per call. Each copy
needs its own edge comment and its own mapper, and the copies drift: one keeps the cause, the next
does not. A wrapper written once is the one place to fix.

## Holds it

- Lint, on: `fabrika/no-promises` refuses a Promise outside a marked edge, so a single helper needs
  one comment.
- No shipped check looks for a repeated wrapper shape. Review holds the rest.

## Decision

[0061](../.decisions/0061-resources-are-acquired-in-a-scope.md): a raw handle from the platform is
wrapped once, at the edge; [no Promises](../docs/direction/no-promises.md);
[0050](../.decisions/0050-a-ledger-step-is-a-plain-function.md) for why the SQLite edge is
synchronous.

> Derived from `effect@4.1.2` and `@effect/platform-node-shared@4.1.2`; re-verify on pin bump.
