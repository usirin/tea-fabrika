---
id: 0041
title: In next/, a Durable Object class is written with Alchemy's Effect Durable Object model in its modular form, never as a plain cloudflare:workers class
status: accepted
date: 2026-11-09
tags: [durable-objects, alchemy, effect, object-class, brain, rpc, next]
---

# 0041: In next/, a Durable Object class is written with Alchemy's Effect Durable Object model in its modular form, never as a plain cloudflare:workers class

**What this decides:** in `next/`, everything is written in Effect where it can be, and that
includes the Durable Object classes themselves: each is an Alchemy Effect Durable Object, a class
that only names it plus a `.make()` Layer, and the logic stays in the plain services it already
hands off to.

## Context

`next/apps/fabrika/src/brain.ts` holds four plain classes, `Project`, `Process`, `Gateway` and
`RecordPart`. Each `extends DurableObject` from `cloudflare:workers`, and each method is one line
that runs an Effect and returns a Promise, about 50 edge comments in all.
[An object class stays thin](../docs/direction/object-classes-stay-thin.md) (decided 2026-10-31)
set that shape.

Alchemy ships an Effect model for the class itself. kamp-us/phoenix moved to it in
[its decision 0028](https://github.com/kamp-us/phoenix/blob/main/.decisions/0028-effect-durable-object-model.md),
took the modular form in
[0032](https://github.com/kamp-us/phoenix/blob/main/.decisions/0032-alchemy-beta45-and-dev-model.md),
and found the sibling rule in
[0033](https://github.com/kamp-us/phoenix/blob/main/.decisions/0033-mutual-do-layer-cycle-per-call-resolution.md).
Its [pattern doc](https://github.com/kamp-us/phoenix/blob/main/.patterns/alchemy-durable-objects.md)
shows the shape as it runs there.

The owner decided on 2026-11-09 to do the same here. "The library is a beta" is not a reason to
hand-write what it offers: `next/` already runs its whole stack on it, and a break is patched
locally ([patch upstream locally](../docs/direction/patch-upstream-locally.md)).

This amends [an object class stays thin](../docs/direction/object-classes-stay-thin.md) on one
point only, what the class is made of. Its rule, that the logic is plain code behind a service
that also runs on Node in tests, stands. It is a direction note with no decision file, so no
`status:` line changes. Nothing is built yet: tracker ticket 502's plan starts with a
spike.

## Decision

**A Durable Object class in `next/` is an Alchemy Effect Durable Object in the modular form: a
class that is only its name and contract, and a Layer from `.make()` that returns the methods of a
plain service.**

**Before:**

```mermaid
flowchart LR
  caller["caller: await stub.write(...)"] --> shell["RecordPart extends DurableObject, from cloudflare:workers"]
  shell -->|"one Effect.runPromise edge line per method"| service["recordWrite in workers/record.ts"]
  service --> storage["ctx.storage.sql"]
```

**After:**

```mermaid
flowchart LR
  caller["caller: yield* stub.write(...)"] --> shell["RecordPart.make(...), Alchemy's Effect model"]
  shell -->|"returns the service's Effects, Alchemy's bridge runs them"| service["recordWrite in workers/record.ts"]
  service --> storage["state.storage.sql"]
```

```ts
// before: next/apps/fabrika/src/brain.ts, as on main
export class RecordPart extends DurableObject<Env> {
	write(chain: Chain, at: number, rows: Rows) {
		// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Durable Object RPC returns a Promise
		return Effect.runPromise(
			settings(this.env).pipe(
				Effect.flatMap((s) => recordWrite(this.ctx, s.limits?.recordBytes, chain, at, rows)),
			),
		);
	}
}

// after: a sketch, not built. The names are from @alchemy.run/cloudflare 2.0.0-beta.84.
export class RecordPart extends Cloudflare.DurableObject<RecordPart, RecordShape>()("RecordPart") {}

export const RecordPartLive = RecordPart.make(
	Effect.gen(function* () {
		const state = yield* Cloudflare.DurableObjectState; // outer: the state reference only

		return Effect.gen(function* () {
			const record = yield* Record.make(state); // the plain service, as it runs on Node in tests
			return {write: record.write, read: record.read, content: record.content};
		});
	}),
);
```

The service box does not move. What changes is the class around it: the edge lines go, the
caller's stub answers with an Effect, and Alchemy's bridge is the one place a Promise is made.

- **The modular form.** The class is `Cloudflare.DurableObject<Self, Shape>()("Name")` with an
  empty body. The implementation is a separate `Live` Layer from `Self.make(impl)`. Never the
  inline form, where the implementation is the class's second argument: an object that imports
  another's class must not pull in its code.
- **The logic stays in plain services.** `.make()`'s body picks up what the platform gives
  (`Cloudflare.DurableObjectState`, the environment) and returns the methods of a service from
  `next/packages/libfabrika/src/workers/`. It decides nothing. A law still runs that service on
  Node, so the mutation step still reaches it.
- **Sibling objects are resolved per call.** An object that calls another resolves that other's
  namespace inside the method that needs it, never in `.make()`'s outer Effect. In phoenix, an
  eager pair ran the build out of memory on the inline form, and on the modular form two Layers
  that each need the other do not compose (its 0033). Our four objects call each other, so the
  rule applies here.
- **A gap in Alchemy is patched locally,** with `pnpm patch`, and the upstream issue is filed the
  same day. It is never a reason to go back to a plain class.

**Binding constraints**

- No new `class ... extends DurableObject` from `cloudflare:workers` in `next/`. The four in
  `brain.ts` stay until ticket 502's pull requests replace them, one object at a time.
- An existing law is ported before the object under it changes shape.
- A claim that a platform feature works on this model comes from a run on the installed version,
  not from this file or from phoenix's notes. phoenix wrote its notes on beta.44 to beta.59.

## What the installed version has

Read on 2026-11-09 in `@alchemy.run/cloudflare` 2.0.0-beta.84, under `src/Workers/`. Reading the
source shows a name exists. It does not show that it works for our objects.

| Asked | In beta.84's source |
|---|---|
| Modular form | Yes. `DurableObject<Self, Shape>()("Name")` has static `make` and `from` (`DurableObject.ts`). phoenix called it `DurableObjectNamespace`; that name is gone |
| Addressing | `getByName`, `idFromName`, `idFromString`, `get`, `newUniqueId` and `jurisdiction` are all on the namespace. phoenix had only `getByName` |
| WebSocket hibernation | `webSocketMessage`, `webSocketClose` and `webSocketError` slots, `Cloudflare.upgrade()`, and `acceptWebSocket`, `getWebSockets`, `getTags` and `setWebSocketAutoResponse` on the state |
| Alarms | An `alarm` slot, and `getAlarm`, `setAlarm` and `deleteAlarm` on `state.storage` |
| Storage SQL | `state.storage.sql.exec`, `databaseSize` and an Effect `transaction`. No `transactionSync`: the raw state is at `state.raw` |
| Abort | `state.abort(reason, options)` |

## Consequences

- **The edge lines in `brain.ts` go.** A Durable Object method is no longer an edge we write, so
  [no Promises](../docs/direction/no-promises.md) loses its largest group of edges once the port
  lands.
- **Calls between objects are typed Effects.** Whether the hand-written clients in
  `workers/platform.ts` shrink or go is the plan's to answer.
- **The host Worker changes too.** `.make()` registers the class through the host Worker's
  `export`, and Alchemy's source says a Worker with `bundle: false` does not get those exports.
  Our stack sets `bundle: false` today and bundles the brain itself, with the React Compiler
  plugin and the program table. So the port touches `alchemy.run.ts` and `build.ts`.
- **Cost:** the object classes join Alchemy's resource graph, a beta's breaking change can reach
  the brain's core, and one more library sits between a platform event and our service.

**Unknown, settled by ticket 502's spike on beta.84:**

- Whether Alchemy's own bundling can carry our compiler plugin and program table.
- How a per-call sibling lookup types and resolves in beta.84.
- Whether our alarm use holds: the bridge runs its own alarm callbacks before the `alarm` slot.
- Whether the Gateway's hibernation laws hold: each event gets a new wrapper around the raw socket.
- Whether a failed call between objects shows in the stub's error type. At run time it is an
  `RpcCallError`; phoenix found the declared type hid it.
- Whether the local stage and the exam twin (`exam/twin.ts`, which reads the stack's Alchemy
  imports) work unchanged.

**Not decided here:** `Control`, the `WorkerEntrypoint` class, and the Worker's default `fetch`;
whether calls between objects use the plain typed stub or `Cloudflare.RpcDurableObject` with a
schema; and merging objects into one, as phoenix later did. No table under
`docs/direction/follows/` covers this, so none changes.

*Pointer, 2026-11-09:* [0042](0042-platform-pieces-go-through-alchemy.md) extends this file to
every platform piece, `Control`, the `WorkerEntrypoint` class and the Worker's default `fetch`
included. Every rule above still holds.
