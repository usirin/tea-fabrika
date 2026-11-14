---
state: "decided (2026-10-31), built as plain classes in Tier 1's P12; amended 2026-11-09 by 0041, whose port is ticket 502 and not built yet; from 0042 the same day, what a class holds from the platform comes from Alchemy's services"
summary: "In `next/`, a Durable Object class holds only what the platform gives it and a one-line handoff into Effect. The logic is plain code that also runs on Node in tests, so the mutation step can reach it. The brain stays on workerd. From 2026-11-09 the class itself is an Alchemy Effect Durable Object, a class plus a `.make()` Layer ([0041](../../.decisions/0041-object-classes-are-effect-objects.md))."
---

# An object class stays thin

**Decided 2026-10-31,** from the plan for ticket 115. This is about `next/`.
Today's version does not change.

**Amended 2026-11-09 (owner,
[0041](../../.decisions/0041-object-classes-are-effect-objects.md)):** the class itself is
written with Alchemy's Effect Durable Object model, a class that only names it plus a `.make()`
Layer, not as a plain `cloudflare:workers` class. Only what the class is made of changes. The
rule below stands: the logic is plain code behind a service, and it also runs on Node in tests.
The port is tracker ticket 502 and is not built yet, so `brain.ts` still has the plain classes.

```ts
// A sketch from 0041, not built yet. All the logic is in ProgramRunner, which also runs on Node.
class ProcessObject extends Cloudflare.DurableObject<ProcessObject, ProcessShape>()("Process") {}

const ProcessObjectLive = ProcessObject.make(
	Effect.gen(function* () {
		const state = yield* Cloudflare.DurableObjectState;

		return Effect.gen(function* () {
			const runner = yield* ProgramRunner.make(state);
			return {msg: runner.msg};
		});
	}),
);

// In a test, on Node: the same ProgramRunner, with the ledger on node:sqlite.
const sent = yield* runner.msg(letter);
```

*It said, until 2026-11-09: `class ProcessObject extends DurableObject`, with
`msg(letter) { return this.runtime.runPromise(...) }` as its one line.*

The rule: **a Durable Object class holds only what the platform gives it, and
a one-line handoff into Effect.** Everything that decides anything is plain code
behind a service.

- **What stays in the class** (from 2026-11-09, in its `.make()` Layer):
  - its storage handle, its WebSocket, its alarm, its Worker Loader. *From 2026-11-09
    ([0042](../../.decisions/0042-platform-pieces-go-through-alchemy.md)): each of these comes
    from Alchemy's Effect service for it, such as `Cloudflare.DurableObjectState` and
    `Cloudflare.WorkerLoader`, never as a raw platform type. The services below take those, so
    they still run on Node in tests. Not built yet: today's services take the raw
    `DurableObjectState`;*
  - the one line that hands a method to the service. *Changed 2026-11-09 (0041): the line
    returns the service's Effect, and Alchemy's bridge runs it. It said: the one line that runs
    an Effect ([no Promises](./no-promises.md) names this edge).*
- **What moves out:**
  - `ProgramRunner`: what a process does with a letter (`next/src/app/runner.ts`);
  - `answerFrame`: one frame in, at most one frame out
    (`next/src/transport/answer.ts`);
  - the ledger's rules, behind `Ledger.sql`, which takes any SQL driver.
- **The brain still runs on workerd everywhere.** Node runs this code only in
  tests. Nothing here changes
  [the cloud is one more host](./the-cloud-is-one-more-host.md): the laptop and
  Cloudflare run the same bundle.

## Why

- **The mutation step cannot reach inside workerd.** StrykerJS flips a line in
  the test's own process. A test that reaches the code through Miniflare runs it
  in another process, so the flip never gets there and the mutant looks unanswered.
  Logic left in a class would get no
  mutation check at all.
- **Laws can run more cases.** Plain code runs in the test's own process, with no
  socket and no second process to start. We have not measured how much that saves.

## What it costs

- One more layer for each object: the class, and the service it calls.
- From 0041: the classes join Alchemy's resource graph, so a breaking change in a beta can reach
  them. A gap is patched locally ([patch upstream locally](./patch-upstream-locally.md)).
- A wrong line in a shell is caught only by a test over the real wire, never by
  the mutation step. Those files go on the mutation skip list, one by one.
- A test on `node:sqlite` is not a test on workerd's SQLite. So the ledger suite
  runs one set of laws with a driver per runtime, and real wire tests stay.

**How sure: 85%.** The doubt: nobody has built it yet. A shell may grow, since
each object has its own platform quirks. The first mutation run on ticket 115
would settle it, by showing how many mutants are left in the shells.

## What it cannot tell us

- How thin a shell stays over many objects. Only one slice exists.
- Whether Effect's overhead shows up at the window. Ticket 115 measures this,
  with a bar on click time.
- Nothing here has run on Cloudflare yet. It uses no feature that differs there,
  as far as we know.
