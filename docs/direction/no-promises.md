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
  `Effect.tryPromise`, and it holds no logic.
- **"Simplest shape" never covers it.** A brief for `next/` says so. An agent's
  shortcut against this is a bug in the change, not a tradeoff to list at the end.
- **It is checked, not only written down.** Lint rules refuse Promises in `next/`
  outside tests and a named list of edge files. They arrive in ticket 115's exam
  pull request, along with planted lines that must fire. Until then, this note and
  [AGENTS.md](../../AGENTS.md) are the only guard.

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
- A rule the lint can only partly check: it names files, not lines. "One line" is
  checked by a reader.
- `useMachine` and `useRuntime` in `@demlik/tea` expect Promise verbs, so the
  window may need its own small hook. That way out is untested (75%).

**How sure: 95%** on the rule. **80%** on the edge list, which ticket 115 sets.

## What it cannot tell us

- Whether Effect's cost shows at the window. It has not been measured.
- How the rule behaves on real code. Its first count of fires comes with the exam
  pull request.
