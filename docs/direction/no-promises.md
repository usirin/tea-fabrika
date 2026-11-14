---
state: "decided (2026-10-31); rules built in Tier 1's P2 and P35; five edges approved 2026-11-08; 0042's ports not built yet"
summary: "Effect all the way. A Promise appears only in a one-line edge the platform demands. Lint rules refuse the rest. The owner approved five edges on 2026-11-08, the WebCrypto calls in the door's `door.ts` and `door-nonce.ts`, each one `Effect.tryPromise` with a typed error, and a crypto failure gets the `why` `crypto`, not `storage`. From 2026-11-09 a platform call is not an edge we write: every platform piece is used through Alchemy ([0042](../../.decisions/0042-platform-pieces-go-through-alchemy.md))."
---

# Nothing in `next/` is built on Promises

**Decided 2026-10-31.** This is about `next/`. Today's version does not change.

```ts
// No: the plumbing is Promises, so errors have no type and nothing can be swapped.
const place = await ledger.append("counter:1/inbox", id, line);

// Yes: an Effect all the way, with its errors in the type.
const place = yield* Mailbox.send("counter:1", id, m, from); // Effect<Place, LedgerError>

// The one exception: a method the platform calls must answer with a Promise. One line.
append(stream, id, line) { return this.runtime.runPromise(/* ... */); }
```

- **`next/` is Effect all the way:** services and Layers, typed errors, Streams.
- **A Promise appears only at a thin edge the platform demands:** a Durable
  Object method, a browser event handler. It is one line of `Effect.runPromise` or
  `Effect.tryPromise`, and it holds no logic. *From 2026-11-09
  ([0041](../../.decisions/0041-object-classes-are-effect-objects.md)): a Durable Object class
  is written with Alchemy's Effect model, so once its port (ticket 502) lands, an object method
  is no longer an edge we write. Until then the edge lines in `brain.ts` stay.*
  *Also from 2026-11-09
  ([0042](../../.decisions/0042-platform-pieces-go-through-alchemy.md)): every platform piece,
  in the cloud and in the local instance, is used through Alchemy's Effect form, so a platform call
  is not an edge we write either. 130 edge comments sit on platform calls today (64
  `fabrika/no-promises`, 66 `fabrika/no-effect-run-outside-edge`); each goes with its port. An
  edge stays only where Alchemy has a gap that cannot be patched in reasonable size, and then its
  comment carries the upstream issue link. What is not the platform's stays an edge as before:
  WebCrypto, a browser event handler, Rolldown.*
- **"Simplest shape" never covers it.** A brief for `next/` says so. An agent's
  shortcut against this is a bug in the change, not a tradeoff to list at the end.
- **It is checked, not only written down.** Lint rules refuse Promises in `next/`
  outside tests, except on a line marked as an edge: `// oxlint-disable-next-line
  fabrika/no-promises -- edge: <why>`. A build that adds one asks the owner, one line
  at a time. *Changed 2026-11-05 (owner): this said a named list of edge files.* Before
  that change, it said: refuse Promises outside tests and a named list of edge files. *History: this said the rules would arrive in Tier 1's exam
  pull request, with planted lines that must fire, and that until then this note and
  [AGENTS.md](../../AGENTS.md) were the only guard. Tier 1's P2 and P35 built the rules.*

## Edges the owner has read

Each new edge comment is read by the lead at merge, one line at a time, and added here. A new kind
of edge, one that is not a one-line call the platform demands, is a new design call and goes to the
owner ([0014](../../.decisions/0014-the-lead-merges-when-every-step-passed.md)). *Changed
2026-11-09 (owner): the owner read each new edge.* The ones read so far:

| Where | The edge | Read |
|---|---|---|
| `next/apps/fabrika/src/door.ts` | two WebCrypto hashes (`crypto.subtle.digest`) | 2026-11-08, P10 ([PR 502](https://github.com/usirin/tea-fabrika/pull/502)) |
| `next/apps/fabrika/src/door-nonce.ts` | WebCrypto `importKey`, `sign` and `verify` | 2026-11-08, P10 ([PR 502](https://github.com/usirin/tea-fabrika/pull/502)) |

Decided by the owner, 2026-11-08: these five are approved as edges, each one `Effect.tryPromise`
with a typed error. A crypto failure gets its own `why`, `crypto`, not `storage`.

Why, as this note reads it: a hash that fails is not a storage fault. The `why` is what a reader
of the log acts on. Today four of the five say `storage` and one says `not_granted`. A build pull
request moves them to `crypto`.

## Why

- **Everything after a base copies its style.** The first slice in `next/`
  (pull request 223) used plain `async` and `await`, against decision D6 in
  [a local-first sync engine](./a-local-first-sync-engine.md). It was listed as a
  footnote, as if it were a chosen tradeoff. No check caught it. Reading the code did.
- **What Promises lose:** the type of an error, the ability to swap a service in a
  test, and clean stopping when a fiber is interrupted. These are the reasons for
  [building on Effect](./build-on-effect.md) at all.

## What it costs

- Effect's overhead on each step. Ticket 115 measures it against a bar on click
  time, and we do not know the answer yet.
- A rule the lint can only partly check: an edge comment covers one line, however
  long, so "one line that holds no logic" is checked by a reader, the lead, who reads
  each new edge at merge (0014; it said the owner). *Changed 2026-11-06 (Tier 1, P35): it said the rule names files, not
  lines.*
- `useMachine` and `useRuntime` in `@demlik/tea` expect Promise verbs, so the
  window may need its own small hook. *Updated 2026-11-01:* probes on tea's Effect
  engine showed one `useSyncExternalStore` hook working, 90% sure, and
  [Tier 1's plan](../plan/tier-1.md) uses it. Nothing is built yet.

**How sure: 95%** on the rule. The edge list is gone: an edge is a line with an edge comment,
and the lead reads each new one (owner, 2026-11-05, and 2026-11-09 for the lead; Tier 1's P35
builds it). *It said: 80% on
the edge list, which ticket 115 sets.*

## What it cannot tell us

- Whether Effect's cost shows at the window. It has not been measured.
- How the rule behaves on real code. *History: this said its first count of fires would
  come with the exam pull request. P2 and P35 built the
  rules.*
