# A Durable Object works inside a wake, saves state for later, and sleeps

```mermaid
sequenceDiagram
  participant Runner
  participant WatchersSql
  participant SQL as Process storage
  participant Publish as Project Publish
  Runner->>WatchersSql: open(client, whole)
  WatchersSql->>SQL: transaction: load, open Msg, save
  WatchersSql->>Publish: deliver whole
  Note over Runner,SQL: Sleep discards runner memory; storage survives
  Runner->>WatchersSql: publish(patch) after wake
  WatchersSql->>SQL: load saved membership
  WatchersSql->>Publish: deliver to each held client
  Publish-->>WatchersSql: sent, gone, or unknown failure
  WatchersSql->>SQL: transaction: end Msg for confirmed gone
```

```ts
// next/packages/libfabrika/src/runtime/WatchersSql.ts:13
const stored = <A>(f: () => A) =>
  Effect.try({
    try: f,
    catch: (cause) => (Schema.is(WatchersError)(cause) ? cause : new WatchersError({ reason: new Storage({ cause }) })),
  });
```

This pattern describes `next/`. A wake handles a call, socket event or alarm and returns.
The platform can discard JavaScript memory between calls. Later work therefore uses saved state,
not a waiting fiber. The lifetime rule is [0105](../.decisions/0105-a-durable-object-never-stays-awake-on-its-own.md);
process-owned storage follows [Three homes for state](../docs/direction/the-cloud-is-one-more-host.md).

## Process-owned membership

`WatchersSql` reads one versioned row per registered name from `process_watchers`
(`next/packages/libfabrika/src/runtime/WatchersSql.ts:19`). The row holds build, name and the
membership machine's state. Invalid bytes or a future version fail as `BadRow`; they are never
replaced by an empty fallback. Storage exceptions pass through `stored` into the service's typed
error channel. The machine owns both `empty` and `watching`, refresh order, uniqueness and the
1,024-client bound (`next/packages/libfabrika/src/runtime/internal/watchers.ts:13`).

Opening steps and saves in a synchronous transaction before sending the whole view. Fanout loads
membership afresh, so a newly built runner sends the next patch without another open. All remote
calls occur outside the SQL transaction. No finalizer deletes membership
(`next/packages/libfabrika/src/runtime/WatchersSql.ts:81`).

`Publish` looks up the Project route and calls the existing Connection notification
(`next/packages/libfabrika/src/cloudflare/Publish.ts:10`). A missing route gives `gone`, and the
membership machine removes that client on the next publish. A failed RPC or malformed reply is
unknown and keeps the watch; fanout continues to other clients
(`next/packages/libfabrika/src/cloudflare/WatcherManagerRemote.ts:10`). In slice 1, a normal notify
return is `sent` even if no socket matched. This is neither acknowledged delivery nor a rendered
view. Process monitors and their `DOWN` messages remain separate.

## Other state that outlives a wake

The Process alarm saves `wake` before setting the platform alarm and reads it in the alarm handler
(`next/packages/libfabrika/src/cloudflare/runtime.ts:1341`, `:1399`). No interval is needed for that
wait. The platform hands the alarm to the Process object's Layer through Alchemy's `alarm` slot
(`next/packages/libfabrika/src/cloudflare/ProcessObject.ts`). The Layer builds the service on the
first call that needs it and starts no timer or fiber of its own, so an idle Process object sleeps. The Connection accepts hibernatable sockets, installs an automatic ping response, and keeps
identity in attachments (`next/packages/libfabrika/src/cloudflare/connection.ts:247`). The socket
cache is rebuilt by decoding those attachments (`connection.ts:45`).

The Process alarm handler still propagates a failed due call without catch-and-re-arm
(`cloudflare/runtime.ts:1399`). The `alarm` slot's type has no failure, so the Layer lets that
failure die: the bridge rejects, and the platform delivers the alarm again. Catching it there would
answer done and lose the wake.

## Where it applies

Durable Objects in `next/`, especially Process view delivery and Connection socket state. Node-only
work may keep fibers alive. Reconnect catch-up remains necessary for a lost notification; durable
membership preserves recipients, not delivery receipts.

## Why it is not obvious

A memory Set works across calls in a Node test but disappears on object sleep. Deterministic laws
must close the first runner's scope and reopen its database and every layer before publishing
(`next/packages/libfabrika/src/runtime/RunnerWatchersTest.ts:135`). The real browser scenario waits
past the local idle interval (`next/apps/fabrika/e2e/instance.test.ts`); that scenario needs the
host or CI and cannot prove production eviction timing.

> Derived from `@demlik/tea@0.25.0` and `effect@4.1.2`; re-verify on pin bump.
