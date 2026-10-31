# An object class stays thin

**Decided 2026-10-31,** from the plan for ticket 115. This is about `next/`.
Today's version does not change.

```ts
// A sketch, not built yet. All the logic is in ProgramRunner, which also runs on Node.
class ProcessObject extends DurableObject {
	msg(letter: Letter) {
		return this.runtime.runPromise(ProgramRunner.pipe(Effect.flatMap((r) => r.msg(letter))));
	}
}

// In a test, on Node: the same ProgramRunner, with the ledger on node:sqlite.
const sent = yield* runner.msg(letter);
```

The rule: **a Durable Object class holds only what the platform gives it, and
a one-line handoff into Effect.** Everything that decides anything is plain code
behind a service.

- **What stays in the class:**
  - its storage handle, its WebSocket, its alarm, its Worker Loader;
  - the one line that runs an Effect
    ([no Promises](./no-promises.md) names this edge).
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
  [mutation check](./promises-in-the-pipeline.md) at all.
- **Laws can run more cases.** Plain code runs in the test's own process, with no
  socket and no second process to start. We have not measured how much that saves.

## What it costs

- One more layer for each object: the class, and the service it calls.
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
