# Plan for ticket 115: `next/` on Effect, with laws

**Replaced as a plan by [Tier 1](./tier-1.md), and kept because Tier 1 builds on it.** Tier 1 carries over its laws p1 to p24, its criteria c1 to c6, and part of its public interface. Where the two differ, Tier 1 wins. It was never built. Added here 2026-11-01, so an agent with only this repo can read it.

Old words, kept as written: `peer` is `client` now, Biome is oxlint, and `next/src/` is real packages under `next/`. "The owner approves" below was about this plan, and Tier 1's questions replace them.

Every claim here is about `next/` at PR 223's head, unless it says "today's version".

```ts
// The whole idea. Only the plumbing changes; what a person sees does not.
// Before, in the brain:
const place = await ledger.append("counter:1/inbox", id, line);
// After: the plumbing is Effect, and a Promise lives only in a one-line edge.
const place = yield* Mailbox.send("counter:1", id, m, from);       // Effect<Place, LedgerError>
append(stream, id, line) { return this.runtime.runPromise(/* ... */); } // the object's edge, one line
```

## Summary

- The brain's plumbing moves from async/await to small Effect services, one Layer per level (D6).
- The four machines and the pure code do not change at all. No Promise lives in them.
- Every machine gets laws, written by a separate agent, each seen to fail on a planted break.
- The real-browser run, with real kill -9, stays as the bar.
- Size, a guess: 500 to 700 product lines, 800 to 1,200 test lines, 2 to 4 agent hours. How sure of the size: 50%.
- **The biggest design call.** Today the brain's logic sits inside object classes, and those only run in workerd. Stryker cannot flip a mutant inside workerd. So the logic moves out to code Node can run (`ProgramRunner`, `answerFrame`), and the objects become thin edges. Why: otherwise the mutation step sees nothing there. Cost: two new modules. How sure: 85%.

## Stories

- **s1:** the owner wants the brain built on Effect, so nothing rests on Promises.
- **s2:** the owner wants laws he can read, so a green run means something without reading the diff.
- **s3:** a person at the window wants the same speed and the same recovery as before.

## The order of work

1. The owner approves this plan and answers the questions.
2. The exam PR lands, by an agent that is not the builder. See [The exam PR](#the-exam-pr-not-in-this-plan).
3. PR 223's head is rebased on it. That commit is **the base**.
4. The test writer adds its tests and runs them on the base.
5. The builder does T1 to T5, with local commits. It cannot touch the tests.
6. The mutation step, then one review of the whole diff by another agent.
7. Force-push to PR 223, then merge.

## The public interface

The tests compile against this block and nothing else of the new code. All of it passes through the Effect 4.0.6 and tea 0.21.0 names checked in the installed source.

```ts
// next/src/data/ledger.ts (new). log.ts stays: createLog, Sql, Line, Entry, Appended.
export type Rev = number;

export class LedgerError extends Schema.TaggedError<LedgerError>()("LedgerError", {
	why: Schema.Literals(["unreachable", "bad_row"]),
}) {}

/** What the project object answers across an object call. The one place Promises are typed. */
export type LedgerCalls = {
	append(stream: string, id: string, line: Line): Promise<Rev>;
	read(stream: string, after: Rev): Promise<readonly Entry[]>;
	wait(stream: string, after: Rev): Promise<Rev>;
};

export class Ledger extends Context.Service<Ledger, {
	readonly append: (stream: string, id: string, line: Line) => Effect.Effect<Rev, LedgerError>;
	readonly read: (stream: string, after: Rev) => Stream.Stream<Entry, LedgerError>;
	readonly wait: (stream: string, after: Rev) => Effect.Effect<Rev, LedgerError>;
}>()("next/Ledger") {
	/** The referee: in the object on workerd, or on node:sqlite in a test. `at` comes from Clock. */
	static readonly sql: (sql: Sql) => Layer.Layer<Ledger>;
	/** Any other object: wraps the stub. A rejected call becomes LedgerError "unreachable". */
	static readonly remote: (stub: LedgerCalls) => Layer.Layer<Ledger>;
}

// next/src/coordination/mailbox.ts
export type Place = {readonly rev: Rev; readonly pos: number};
export class Mailbox extends Context.Service<Mailbox, {
	readonly send: (to: string, id: string, m: unknown,
		from: {readonly by: string; readonly said: string}) => Effect.Effect<Place, LedgerError>;
	readonly receive: (name: string, after: Rev) => Stream.Stream<Entry, LedgerError>;
}>()("next/Mailbox") {
	static readonly layer: Layer.Layer<Mailbox, never, Ledger>;
}

// next/src/coordination/process-manager.ts
export class ProcessManager extends Context.Service<ProcessManager, {
	readonly start: (pid: string, code: {readonly program: string; readonly hash: string}) =>
		Effect.Effect<void, LedgerError>;
}>()("next/ProcessManager") {
	static readonly layer: Layer.Layer<ProcessManager, never, Ledger>;
}
export const CoordinationLayer: Layer.Layer<Mailbox | ProcessManager, never, Ledger>;

// next/src/app/program.ts: pure, added beside defineProgram. A refusal is plain data.
export type Stepped = {readonly model: unknown; readonly view: unknown};
export type Refused = {readonly why: "bad_msg"};
export const stepper: <S, M extends {readonly type: string}, V>(program: Program<S, M, V>) => {
	readonly init: () => Stepped;
	readonly step: (model: unknown, m: unknown) => Stepped | Refused;
};

// next/src/app/runner.ts (new): what the process object does, runnable on Node.
export class ProgramDown extends Schema.TaggedError<ProgramDown>()("ProgramDown", {}) {}
export type Sent =
	| {readonly rev: number; readonly pos: number; readonly ledger: number}
	| {readonly why: "no_program" | "bad_msg"};
export type Letter = {readonly id: string; readonly m: unknown; readonly by: string; readonly said: string};

export class ProgramLoader extends Context.Service<ProgramLoader, {
	readonly load: (pid: string) => Effect.Effect<Option.Option<{
		readonly program: string;
		readonly hash: string;
		readonly init: Effect.Effect<Stepped, ProgramDown>;
		readonly step: (model: unknown, m: unknown) => Effect.Effect<Stepped | Refused, ProgramDown>;
	}>, ProgramDown>;
}>()("next/ProgramLoader") {}

export class WatcherManager extends Context.Service<WatcherManager, {
	readonly add: (peer: string) => Effect.Effect<void>;
	readonly tell: (text: string) => Effect.Effect<void>;
	readonly tellOne: (peer: string, text: string) => Effect.Effect<void>;
}>()("next/WatcherManager") {}

export class ProgramRunner extends Context.Service<ProgramRunner, {
	readonly open: (peer: string) =>
		Effect.Effect<{readonly opened: string} | {readonly why: "no_program"}, LedgerError | ProgramDown>;
	readonly msg: (letter: Letter) => Effect.Effect<Sent, LedgerError | ProgramDown>;
}>()("next/ProgramRunner") {
	static readonly layer: (pid: string) =>
		Layer.Layer<ProgramRunner, never, Mailbox | ProcessManager | ProgramLoader | WatcherManager>;
}

// next/src/transport/answer.ts (new): one frame in, at most one frame out. Pure of workerd.
export type Attached = {readonly peer: string; readonly hello: boolean};
export type Answer = {readonly ok: unknown} | {readonly why: string};
export const sameOrigin: (headers: {readonly origin: string | null; readonly host: string | null}) => boolean;
export const answerFrame: <E>(
	text: string,
	attached: Attached,
	route: (method: string, params: unknown, peer: string) => Effect.Effect<Answer, E>,
) => Effect.Effect<{readonly send: string | null; readonly attached: Attached}>;
```

These stay exactly as they are at the base, and the tests may use them:

- `window/machine.ts`: `windowMachine`, `startWindow`, `Model`, `Msg`, `deskIn`, and the Cmd shape `{type: "send_text", text}`.
- `transport/link.ts`: `startLink`, `stepLink`, `linkTimer`, `backoff`. `transport/wire.ts`: `ask`, `ok`, `err`, `news`, `helloText`.
- `desktop/desk.ts`: `desk`, `tilesIn`, `DESK`, `DesktopSchema`. `programs/counter/program.ts`: `counter`. `app/patch.ts`: `diff`, `applyPatch`.
- **The outside of the brain:** `node next/dev.ts --port=N --data=<folder>`, its `brain up: {node, workerd, ms}` line, and the JSON-RPC methods `initialize`, `view.open`, `window.msg`, `ledger.read`, `ledger.wait`.

Choices inside that block:

- **`append` answers `Rev`, as D6 says.** A process needs `pos` too, and a resend must get the same answer. So `Mailbox.send` does one more read. Cost: one object call per press, which the speed bar watches. How sure: 75%. The doubt is only speed, and p17 settles it.
- **Numbers and the check share one sync block.** `Ledger.sql` keeps `createLog` and calls it inside one sync step, with `wait`'s head check and bell the same way. Effect may yield after 2048 steps (the installed default), so splitting that step would let another call in. A semaphore also works, but it adds a wait and a state where D1 has one plain step. How sure: 85%. p18 forces a yield on every step to test it.
- **`ProgramRunner` does need a one-permit Semaphore.** It waits on object calls between steps, as `serial` does today.
- **One `ManagedRuntime` per object, built in the constructor, with no finalizers.** A sleep or a kill -9 gives no notice. The state in `ProgramRunner` must also live across calls. How sure: 80%.
- **No Layer may fail at build.** I ran it: under `ManagedRuntime`, a failed build ran once and failed all three calls. So a bad build would hold until the object is evicted. Every Layer above has `never` as its error, and `createLog`'s table is made inside the first call's error channel. p20 holds this.
- **A refusal stays plain data across an object call.** In one local probe a tagged error's fields did cross an object call (`_tag` and `why`), but `message` came back empty, and I did not check `instanceof`. Cloudflare may differ, so nothing relies on it. Other failures become a tagged error on the caller's side.
- **The doorbell looks fine.** In one probe an Effect `Deferred` on workerd, waiting in one request and rung from another, woke and went on. One run on Miniflare, so p12 still tests it for real.

## Tasks

Which task owns which file:

| Task | Files |
|---|---|
| T1 the names | new `data/ledger.ts`, `app/runner.ts`, `transport/answer.ts`; added names in `coordination/mailbox.ts`, `coordination/process-manager.ts`, `app/program.ts`. Every body is `Effect.die("not built: tN")` |
| T2 data and coordination | `data/ledger.ts`, `data/project.ts`, `coordination/mailbox.ts`, `coordination/process-manager.ts`; the smallest bridge in `app/process.ts`, gone in T3 |
| T3 the process | `app/program.ts`, `app/runner.ts`, `app/entry.ts`, `app/process.ts` |
| T4 the door | `transport/answer.ts`, `transport/gateway.ts`, `brain.ts` |
| T5 the edges | `window/main.tsx`, `dev.ts`, `build.ts`, `brain-host.ts`, `package.json`, `pnpm-lock.yaml`, `README.md`, `docs/*.png`; deletes `e2e.ts` |
| No task: no edits | `window/machine.ts`, `window/page.ts`, `transport/wire.ts`, `transport/link.ts`, `app/patch.ts`, `data/log.ts`, `desktop/desk.ts`, `desktop/desk-entry.ts`, `desktop/fold.ts`, `programs/counter/*`, `workers.d.ts` unless a task must add a runtime name, and the seven old test files |

How each task goes red to green on its own:

- **After T1, everything compiles.** Each `new` test then fails on its "not built" message, not on a missing file. That is the right red.
- **Quick checks per task:** `pnpm --filter @fabrika/next typecheck`, `biome check` on that task's files only, and that task's own tests. Biome is per task because the no-Promises rule stays red until T5.
- **The whole `pnpm lint`,** with `lint:dead`, runs only in T5. T1's unused names would fail it earlier.
- **Each commit keeps the wire tests green.** That is why T2 has a bridge.
- **`T5.deletes e2e.ts`:** the test writer's `next/e2e.test.ts` replaces it. It is not on the exam list, so the delete does not stop the build.

### T1: the names

- `ends`: a local commit. Fixture: the base with the test writer's commit on it.
- **Scenario, c1.** When T1 lands, the typecheck passes with every test file in it, and every `new` test is red on its "not built" message. Read: the quick check's record.
- **Properties p1 to p9, p16.** The machines take no build work, so these sit here. They are green from the base on.

### T2: data and coordination

- `ends`: a local commit. Fixture: `Ledger.sql` on node:sqlite, in memory and in a file.
- **Scenario, p18.** Other Properties: p10, p11, p12, p13, p19, p20, p21. Criterion: c2.

### T3: the process

- `ends`: a local commit. Fixture: `ProgramRunner` over node:sqlite, with the real `counter` through `stepper`.
- **Scenario, p22.** Other Properties: p14, p25. Criteria: c2, c3.

### T4: the door

- `ends`: a local commit. Fixture: `answerFrame` with a route that answers, refuses or fails.
- **Scenario, p23.** Other Property: p15. Criterion: c2.

### T5: the edges

- `ends`: the pull request. Fixture: the whole `next/` tree, and two Chromium windows on a real brain.
- **Scenario, p24.** Other Property: p17. Criteria: c4, c5, c6.

## Properties

All have `tool: "test"`. Runtime says where it runs: **node** is plain vitest on Node, **miniflare** is the real gateway and objects in workerd, over the wire. `new` Properties fail on the base because the service or module does not exist yet, then fail on "not built" after T1.

### The machines: `existing`, on tea's pbt, real reducer, real init, node

Written as `next/src/<same path>.laws.test.ts`. Each uses `arbMsgSequence` with an online `prefix` half the time, since generators cannot yet answer only what was sent (demlik#745). A `foldEvents` check in each file shows the key states were reached (demlik#748), so no law passes because nothing came.

**p1, a letter is never lost.** s2, s3. `window/machine.ts#windowMachine`.
- When any Msgs come: a letter leaves the outbox only on an `ok` or `err` frame with its id. `written` grows by one per press, and ids never repeat.
- Why: a lost letter is a lost press.
- Plants: any `ok` clears the whole outbox; a press reuses an id.

**p2, what waited goes out (a good thing happens).** s3. `windowMachine`.
- When the link comes online: it asks for the desk, and sends every waiting letter once, in order. A press when online goes out at once. A press when not online sends nothing and waits.
- Why: this is the only path by which a press made offline ever lands.
- Plants: coming online sends no letters; a press offline is sent anyway.

**p3, views move only forward by one.** s3. `windowMachine`, `app/patch.ts#applyPatch`.
- When frames come: a patch at `rev + 1` applies, an older one does nothing, and a gap leaves the data and asks for a whole copy. A whole copy always replaces. Junk text changes nothing and never throws. After a whole plus patches made with real `diff`, the view equals the target.
- Why: a window that applies across a gap shows a wrong count with no sign of it.
- A whole copy may lower a rev on purpose: it is the brain's truth, for example after the data folder is deleted.
- Plants: apply across a gap; apply an old patch.

**p4, a window watches what its desk shows (a good thing happens).** s3. `windowMachine`.
- When the desk arrives: every pid its tiles show is opened once for this dial, and `opened` never holds a repeat. A new dial starts over from the desk.
- Why: a reconnected window would show stale counts for good.
- Plant: `opened` is not reset on coming online.

**p5, the link never sits still (a good thing happens).** s3. `transport/link.ts#stepLink`, `#linkTimer`, `#backoff`, through the window's Msgs.
- In any state: applying the Msg of its own `linkTimer` moves it. Closes and timers from an old dial or beat do nothing. Online means `tries` is 0. No wait is over 30 s.
- Why: a stuck link is a window that never comes back.
- Plants: `retry` is ignored when waiting; an old dial's close drops the link; no cap on the wait.

**p6, the desk's shape holds.** s2. `desktop/desk.ts#desk`, real `init`, and a `loaded` start with a second workspace.
- When any focus comes: focus names a tile of its own workspace, the layout never changes, and other workspaces do not move.
- Why: W1 and W4 rest on this.
- Plants: accept any tile; ignore `n`.

**p7, a focus lands (a good thing happens).** s3. `desk`.
- When a focus names a real tile of that workspace: that tile has focus next, and the last one wins.
- Why: a desk that does nothing passes p6.
- Plant: focus does nothing.

**p8, every press counts (a good thing happens).** s3. `programs/counter/program.ts#counter`.
- When any list of `plus` folds, with any `saw`: `n` is exactly how many, and the view is the model.
- Why: this is the program's whole promise.
- Plants: a stale `saw` is dropped; `+2`; `n` stays 0.

**p9, what a program must be.** s2. `app/program.ts#Program`, one suite run on `counter` and `desk`. `app/program.ts` holds no machine, so this is its law.
- For any reached state: `view.select` encodes through `view.data`, the model survives a JSON round trip and steps the same after it, and a Msg the schema refuses never reaches `update`.
- Why: the model crosses an object call as plain data with every step.
- Plants: a model holding a `Map`; a view its schema refuses.

### The ledger suite, as the sync-engine note asks: one suite, a driver per runtime

The suite takes a small driver: `append`, `read`, `wait`, `restart`. There are two drivers, wire and service. The wire driver imports no app code, so it runs the same on the base and after. On the wire, `append` is `window.msg` to `counter:N`, on a stream `counter:N/inbox`. `Ledger.remote` is covered by this path after the build too.

Plants run every time as broken drivers, which show the law can fail. They do not break real code. Once, by hand, the test writer also breaks the real code in a temp copy (see the gaps).

| Law | miniflare, wire: `existing` | node:sqlite, service: `new` |
|---|---|---|
| The same id is safe | p10 | p18 |
| Read is in order, rev grows | p11 | p18 |
| Wait wakes | p12 | p18 |
| A restart loses nothing | p13, real kill -9 of workerd | p18, a closed and reopened file |
| Many at once | p14 | p18, with `MaxOpsBeforeYield` set to 1 |

**p10, the same id is safe.** `existing`, miniflare. s2.
- When one id is sent twice: one line, the same answer, the first body kept.
- Why: every reconnect resends. Plant: a driver that saves twice.

**p11, read order, and rev grows.** `existing`, miniflare. s2.
- When two streams are written in turn: each read is in rev order, `pos` is 1, 2, 3 in its stream, and rev only grows across the log. `read` after a rev gives only what came later.
- Why: every fold depends on order. Plants: a driver that reverses; a driver that repeats a rev.

**p12, wait wakes.** `existing`, miniflare. s2.
- When a wait is pending and a line lands in that stream from another peer: it answers with a rev past `after`. With news already there, it answers at once. Another stream or a resend does not ring it.
- Why: the slice's e2e only tried the "at once" half.
- How sure this holds on the base: 70%. It has never run. A red here goes to the owner as `fails_on_base`. Plant: a driver that never rings, caught by a time limit.

**p13, a restart loses nothing.** `existing`, miniflare. s3.
- When workerd takes kill -9 in the middle of a burst of letters: every answered letter is there once, with no gap. An unanswered one resent under its id lands once.
- Why: the claim of this whole design. Plant: a driver that loses the last line.

**p14, many at once.** `existing`, miniflare. s3. `app/process.ts`, `app/runner.ts#ProgramRunner`.
- When two peers send a burst at once: all are saved, no rev or pos repeats, and each watcher hears patches with consecutive revs.
- Why: it pins `serial`, which the rewrite replaces. Plant: a driver whose revs skip.

**p15, the door.** `existing`, miniflare. s2. `brain.ts`, `transport/gateway.ts`.
- Before a hello, a method gets `no_hello`. A wrong Origin gets 403, and a wrong Host gets 421. `by` is the socket's peer, even if the params say another. A text `ping` gets a text `pong`.
- Why: this is all the safety the slice has (T3, T6).
- Plants: a driver that skips each refusal.

**p16, the old tests stay.** `existing`, node. s2.
- The seven old test files pass untouched: `layers`, `log`, `wire`, `link`, `patch`, `fold`, and `window/machine`'s. They are the same files, now part of the exam.
- Why: they are cheap, they hold the pure code, and all the code they import stays. Their author wrote the code too, so they count as extra, never as the laws.
- Plant: none needed; p1 to p9 hold the same ground.

**p17, a real browser, real kills.** `existing`, Chromium and miniflare. s3. Written new as `next/e2e.test.ts`, run with `node next/e2e.test.ts`, not in `pnpm test`.
- Every step of the slice passes, 5 of 5: two windows mirror, a press while lost waits and lands once, the narrow window folds alone, kill -9 of workerd, kill -9 of Node, a held restart, a hung brain, and a full stop and start on the same folder.
- Why: it is the one thing that shows a person would notice nothing.
- Plant: seen to fail once by hand, on a temp copy where the outbox never resends.

The bar. Baselines are 4 runs at PR 223's head, on one laptop, on Node 22. "Worse" means a median of 5 runs after the build over the cap, or a run that fails.

| Measure | PR's number | Seen in 4 runs | Worse means over |
|---|---|---|---|
| Click to count, same window | 16 ms | median 15 to 16, most 16 | 32 ms |
| Click to count, other window | 3 to 4 ms | median 3, most 6 | 10 ms |
| Worst single click | none | 30 to 46 | 100 ms |
| Reconnect after kill -9 | about 850 ms | 790 to 858 | 1,100 ms |
| Brain restart | about 130 ms | median 139 to 202, most 202 | 300 ms |
| Lost link noticed | none | 17 to 23 | 100 ms |
| Hang noticed | none | 10,876 to 10,951 | 12,000 ms |

- The caps are two to three times the small numbers and about 30% over reconnect, which is mostly a fixed retry wait. How sure they are right: 70%. Four runs is few, and one run already saw a 202 ms restart. Measure base and head in one sitting to compare fairly.
- Brain bundle, measured today: 624 KB, window 664 KB, counter 272 KB. Report the after numbers. They do not block, since no cap has been measured.

### New: what does not exist yet, node

**p18, the ledger suite on the service.** s1. `data/ledger.ts#Ledger`.
- All five laws above on `Ledger.sql`, including appends and waits racing as fibers with a yield forced on every step.
- Why: it is the risk of leaving one plain step. Plants: broken Layers that yield between number and insert, or check the head after the bell.

**p19, `read` is a Stream, `at` is the Clock.** s1. `Ledger`.
- Making the Stream reads nothing; `Stream.take(1)` works and stops. Under `TestClock`, `at` is that clock's time, and `said` stays as the writer gave it.
- Why: D6, and build-on-effect's rule on the clock. Plants: a Layer that reads early; a Layer that uses `Date`.

**p20, failures are typed, and pass.** s1. `Ledger`.
- A stub that rejects gives `LedgerError "unreachable"` on all three calls. A SQL failure on one call does not poison the next, under one `ManagedRuntime`. An interrupted `wait` ends and leaves no bell.
- Why: a Layer failure sticks (measured above). Plants: a Layer that fails at build; a rejection that dies instead.

**p21, the coordination services.** s1. `Mailbox`, `ProcessManager`, `CoordinationLayer`.
- `send` writes to `<name>/inbox`, and a resend gets the same `Place`. `receive` reads it back in order. `start` records the hash, once per hash.
- Why: `send` adds the read for `pos`. Plants: a `Place` from the wrong line; a new id on each `start`.

**p22, the process folds (scenario of T3).** s1, s3. `app/runner.ts#ProgramRunner`, `app/program.ts#stepper`.
- With real `counter`: a new runner on the same log wakes to the same model. Letters at once fold one at a time. A whole plus patches equals the model, for every watcher. A refused Msg leaves no line and gets `bad_msg`. An unknown program gets `no_program`.
- Why: this is the logic that leaves the object. Plants: no permit; a refused Msg saved anyway; a wake that skips the first letter.

**p23, a frame's answer (scenario of T4).** s1. `transport/answer.ts#answerFrame`, `#sameOrigin`.
- A route's answer is one frame, ok or err. A failed route sends nothing and still returns. Junk and news get nothing. No hello gets `no_hello`.
- Why: the window drops a letter on any `err`, so a failure sent as `err` would lose the press. Today's code sends nothing. This keeps it so. Plants: a failure sent as `err`; the hello check skipped.

**p24, no Promises in `next/` (scenario of T5).** s1. All of `next/`. Written as a test that runs Biome on `next/`.
- `biome check next/` reports nothing, and an edge line appears only in the files the exam PR lists.
- Why: the owner's ruling, held by code. On the base it fails, with about 60 lines of `async`, `await`, `new Promise`, `Promise.`, `.then`, `.catch` by a rough count: `app/process.ts` 23, `brain.ts` 11, `build.ts` 8, and the rest. The exact count comes from the exam PR.
- Plants: live in the exam PR.

**p25, a failure is not a refusal. Only if the owner says yes to Q1.** s3. `ProgramRunner`.
- When a program's isolate fails on a step: no answer, no line, and the letter is still waiting to resend. On a wake, the wake fails rather than skipping the letter. A real refusal still gets `bad_msg`, and old letters the new code refuses still count for nothing.
- Why it fails today: see Q1. Plants: a failure read as `bad_msg`; a failure skipped on a wake.
- If the owner says no: p25 becomes `existing`, and pins today's behavior instead.

## Criteria

Each ends with the ticket and is read at the one review.

- **c1, T1.** See T1's scenario. Read: T1's quick check record. s1.
- **c2, T2 to T4.** When a reader opens an object class: each method is one line into the runtime, with no logic. Read: `data/project.ts`, `app/process.ts`, `transport/gateway.ts`. s1.
- **c3, T3.** One `ManagedRuntime` per object, made in the constructor, no finalizers; all Layers have `never` as their build error. Read: those same files and the Layers. s1.
- **c4, T5.** The names follow D6 and the block above: no plural service, no `of` names, short keys, one Layer per level. Read: the diff against the block. s1.
- **c5, T5.** The README and the PR body drop "D6: plain Promises", name every edge line and why, and say what was measured. New screenshots from the rebuilt slice. Read: `next/README.md`, the PR body. s2.
- **c6, T5.** Each law has its own planted break in its file, with a good-thing law in every machine. The scan cannot read this. Read: the `*.laws.test.ts` files. s2.

## The mutation step

- **Tool:** Stryker 10.1.1 through today's `MutationRunner`, as a tool run from outside. `next/` imports none of it. Fixed sample: seed 115, at most 150. Runs under `nice -n 15`, `--maxWorkers=3`, concurrency 2.
- **Rules:** the repo's tests first. The typecheck is on: each mutant no test killed is put in alone, then `pnpm --filter @fabrika/next typecheck`. One it rejects does not count. Every survivor goes back to the test writer. The `arid` ignorer stays on (error and log text).
- **It covers:** the lines the build changed in `data/ledger.ts`, `coordination/*`, `app/runner.ts`, `app/program.ts`, `transport/answer.ts`, plus each `existing` Property's `code`: `window/machine.ts`, `transport/link.ts`, `transport/wire.ts`, `app/patch.ts`, `desktop/desk.ts`, `desktop/fold.ts`, `programs/counter/program.ts`, `data/log.ts`.
- **It must not count (Q2):** code that runs only in workerd or a browser or as a Node process. A mutant there is never switched on in the test's process, so it shows as no coverage. It would block for good, and say nothing. How sure of that mechanism: 90%; a first run shows it. Those lines are checked by p10 to p17 instead.
- **Cost, a guess:** 10 to 25 machine minutes, plus one test-writer round.

## The exam PR, not in this plan

An agent that is not the builder writes it. The owner reads it. It lands first, and it holds exactly:

1. `biome-plugins/no-promises.grit`, blocking. It refuses `async`, `await`, `new Promise`, `Promise.<anything>(...)`, `.then(...)`, `Effect.promise(...)`, and `.catch(...)` unless the object is an Effect module. Biome override: `next/**`, leaving out `**/*.test.ts`.
2. `biome-plugins/no-effect-run-outside-edge.grit`, blocking. It refuses `Effect.runPromise`, `<runtime>.runPromise` and `Effect.tryPromise` outside these files: `data/project.ts`, `data/ledger.ts` (the stub), `app/process.ts`, `transport/gateway.ts`, `brain.ts`, `build.ts`, `brain-host.ts`. `window/main.tsx` joins only if p24's route needs it (below).
3. `next/src/exam/no-promises.test.ts`: planted lines, each with whether the rules must fire, as `packages/fabrika/src/redacted-lint.test.ts` does. It includes `Effect.catch(...)`, which must not fire.
4. `next/src/exam/laws-scan.test.ts`: a new scan. It finds `defineMachine(` under `next/src`, and fails a file with no `.laws.test.ts` beside it, or one that does not use `@demlik/tea/pbt`. Plus its own planted folder. Today's scan cannot do this: it has no `next` group and it requires `const x = defineMachine(`, while `next/` makes machines inline. `next/` may not import it.
5. `vitest.config.ts`: the same `next/src/**/*.test.ts` line PR 223 has.
6. `.github/workflows/check.yaml`: a `next` job, run only when `next/package.json` exists: `pnpm exec vitest run next/`, install Chromium, `node next/e2e.test.ts`. It is needed because `vitest --changed` follows imports, and these tests spawn the brain or read files, so a pull request would never pick them up. Node 26.12, as CI uses. The slice has only run on 22, so that is the first real try.
7. The PR body: the count of each rule's fires on PR 223's tree, with each read by hand. No check blocks until its false alarms are measured.

**Where it runs:** `pnpm lint` for 1 and 2, `pnpm test` and the `next` job for 3 and 4.

**Exam files for the builder.** Any diff here stops the build and asks the owner: `next/**/*.test.ts`, `fixtures/next/**`, `next/src/exam/**`, `biome*`, `biome-plugins/**`, `vitest.config.ts`, `.github/**`, `layer-rules.json`. In this hand run, code checks it after each task: `git diff --name-only` from the test writer's commit.

**The order problems, all real:**

- **Plan before exam.** The edge list comes from this plan, so the exam PR cannot be written until it is approved.
- **The exam sees nothing on main.** `next/` is not on main, so both rules and the scan pass by finding nothing. That is why item 3 and item 7 exist.
- **PR 223 goes red the moment it is rebased.** Lint and the scan fail on the base. That is intended. It cannot merge until T5, and the test writer's on-base run only runs tests.
- **Not typechecked at first.** `next/src/exam/*` has no `tsconfig` on main until PR 223 lands. A small hole for a short time.
- **The other way was weighed:** merge PR 223 first with a shrink-only list of its Promise lines. Rules would then fire on real code at once, with no long branch. But the owner ruled exam first, and main would hold the code he rejected. How sure of exam first: 80%. The doubt is that the rule's first true test is the rebase.

## Not in this ticket

- D3's rule that deciding code never sees `said`, T5 keys, D4's poke, C2 to C5, A1: as PR 223 left them.
- T7 as a Sub with no `seed` or `backoff` in the machine (a tea Sub does turn off on null `deps`). A real improvement, but it changes `Model` and what p5 and `link.test.ts` pin. Its own ticket. The note's `Schedule.either` also does not exist in Effect 4.0.6, so that sketch needs fixing.
- Paging a long `read`. The Stream is one object call for now.
- **`window/main.tsx` is a try, not a promise.** `EffectRuntime` has `subscribe` and `getState`, and tea's `useRuntime` needs Promise verbs. So `useSyncExternalStore` with `Effect.runFork` should end the adapter. Untested. If it fails, the file joins the edge list by a change to the exam, asked of the owner. How sure: 75%.
- `defineMachine`, `applyCell` and `Sub` have no `/effect` form in tea 0.21.0, so machines keep importing from `@demlik/tea`.

## Pointers

- `packages/pipeline/src/stages/mutation/machine.laws.test.ts`: today's version, how a law and its plant read. Do not import.
- `packages/pipeline/src/stages/mutation/stryker.ts`: today's version, how the sample and typecheck run.
- `packages/fabrika/src/redacted-lint.test.ts`: today's version, how a lint rule is planted.
- `next/e2e.ts` at PR 223's head: what the slice checks, for the test writer to read and not copy.
- `docs/direction/a-local-first-sync-engine.md`, D1, D3, D6.

## Questions for the owner

**Q1. Should an isolate failure stop counting as a refused Msg?**
- Today, in `app/process.ts`, any failed `step` counts as `bad_msg`. The window then drops that press from its outbox. During a wake, the same failure counts the letter as nothing, so the model differs after that wake.
- **Lean: yes.** A failure gets logged with no answer, so the letter stays and resends with its id. A real refusal stays `bad_msg`.
- Why: a press should never be lost to a hiccup. Cost: it breaks "behavior does not change", and adds p25. A program whose `update` always throws gets resent on each reconnect until C2 comes, though it writes no line. How sure: 85%.

**Q2. Is this the mutation skip list?**
- By file: `data/project.ts`, `app/process.ts`, `app/entry.ts`, `transport/gateway.ts`, `brain.ts`, `desktop/desk-entry.ts`, `programs/counter/entry.ts`, `programs/counter/view.tsx`, `window/main.tsx`, `window/page.ts`, `dev.ts`, `build.ts`, `brain-host.ts`, `workers.d.ts`.
- **Lean: yes,** kept as a file list, with `arid` on. Why: none of these can be mutated by this tool, and p10 to p17 cover them. Cost: a wrong line in `brain.ts`'s route is only caught if a wire test sees it. How sure: 80%.

**Q3. Do the speed caps block only on your laptop?**
- **Lean: yes.** On the laptop, base and head in one sitting, they block the merge. In CI, p17 fails on behavior and only prints numbers.
- Why: CI machines have no measured numbers, and no check blocks without a measured bar. Cost: a slowdown shows only when someone runs it by hand. How sure: 80%.

## Pipeline gaps

What the pipeline's notes left unclear, missing or contradictory, and how I got past each.

**Contradictions**

1. **`red_on_base` against `existing`.** The one-review note's `TaskChecks` needs `red_on_base` true on every task, yet an `existing` test must be green on base. A task of only `existing` Properties could never finish. Blocked: the shape of task checks. Resolved: red first applies only to `new`.
2. **Who checks a criterion.** The one-review note says the test writer writes each criterion's tests. The plan-stage note says a reader checks a Criterion and a tool checks a Property. Blocked: splitting checks. Resolved: the newer plan-stage split, Properties get tests.
3. **Exam in its own PR against test writer's tests.** Nobody-writes-their-own-exam says a PR changing code and exam together fails. The test writer's commit ships in the same PR as the build. Blocked: what the CI half could even check. Resolved: the owner-reviewed rules go in the exam PR, the ticket's tests go with the build. The CI half is not built anyway.
4. **`ends: "pr"` per task against one PR a plan.** Blocked: `ends` on T1 to T4. Resolved: local commit for those, `pr` for T5. There is no word for it.
5. **The old notes' `Ledger`.** The sync-engine note's last part says `append`, `appendAfter`, `entries`; D6 says `append`, `read`, `wait`. Resolved: D6, as newer. Also D6's `Effect<Rev>` has no room for `pos`, which the slice's answer uses. Resolved: one more read in `Mailbox.send`.
6. **Today's scan rule against `next/`.** The scan demands a named `const`, and a part under a group folder. Rethink-do-not-port forbids reusing it anyway. Resolved: a new scan, in the exam PR.

**Unclear or missing**

7. **Where a task lists its Properties.** Not picked. Resolved: scenario, then "other Properties", then Criteria per task. It worked. Pick it.
8. **A Property with no task.** Machines that do not change have laws but no build work. Blocked: where p1 to p9 live. Resolved: on T1, a guess.
9. **What `existing` means when the file is rewritten.** Its test must pass before and after, so it cannot import the new names, and the old names go. Resolved: the tests use only what survives, the machines and the wire. That needs a rule in the note. It also means `code` must name what exists after the build, not on the base.
10. **How a rewrite goes red first.** A `new` test fails today for the wrong reason, a missing file. That shows nothing. Also `tsc` covers all test files, so no task could pass the typecheck until the last. Resolved: T1, a names-only commit with bodies that die. I would like the note to say a missing module does not count as red.
11. **Per-task lint with a rule that covers the whole tree.** Quick checks say "lint", but the rule stays red until the last task, and `lint:dead` fails on T1's names. Resolved: file-scoped per task, whole only at T5.
12. **No tool word for typecheck or lint.** The plan-stage note names this doubt, and it hit here: c1 is a tool's check dressed as a Criterion, and p24 is a test that runs Biome. Resolved by those two tricks. A `tool: "typecheck"` or `"lint"` would be cleaner.
13. **`includes` has no home for a shared test helper.** The drivers are used by several test files. A non-test helper in `next/` is outside `includes`, and a helper named `.test.ts` fails as an empty suite. Resolved: root `fixtures/next/`. It works, though Biome skips that folder.
14. **The builder must delete what the test writer replaces.** The test writer only adds files, and the slice's `e2e.ts` is its author's test. Nothing says who removes it. Resolved: left off the exam list, deleted in T5.
15. **Tests written by the code's author, inherited.** No note says if they join the exam. Resolved: p16 keeps them as extra, not as laws.
16. **"Planted break, run every time" on real processes.** Five-steps asks for it, but a plant on a wire test needs a changed bundle, and p17 takes 17 s a run. Resolved: broken drivers every time, real code broken once by hand. That is weaker: a driver plant shows the law can fail, not that it sees this code fail.
17. **Mutation on code outside the test's process.** Nothing says what happens for workerd-only code, though this whole design has it. It changed the design: the logic moved out of the objects. Resolved: a skip list by file, as Q2.
18. **A skip list by file.** Promises-in-the-pipeline names only "kinds of mutant". Resolved: put it to the owner.
19. **The 400-line lean.** One-review's lean says a plan past 400 changed lines splits. This one will pass it. I did not split, since no part is useful alone and it is one story, and the doubt in that note is exactly this guess. Worth watching in the review.
20. **`--changed` blind spot for new tests.** The test writer's process-spawning tests would be skipped on a PR. Found by reading `check.yaml`. No note warns about it. Resolved: the `next` job.
21. **No home yet for `checked` facts in a hand run.** Nothing is built to record them, and `next/` has no ledger for it. Blocked: nothing now, but the review needs them. Resolved: the test writer's report, then `field/` the same day, as AGENTS.md says.
22. **Thin-edge is not checkable as "one line".** The owner's rule says one line. A lint rule can name files, not lines. Resolved: Biome by file, c2 by a reader.

**Findings I checked and changed**

- `Schema.decodeUnknownEffect` does exist in Effect 4.0.6. It is a `function`, so a search for `const` misses it. Today's `stryker.ts` uses it.
- A failed Layer staying cached: true, run on the installed version.
- Typed errors crossing an object call: fields did cross in one local probe, so "they do not cross" is too strong. Still do not rely on it.
- The doorbell: worked in one local probe. p12 and p18 still test it.

## What this plan cannot tell us

- Nothing was built or tested for this plan. Three short probes and four e2e runs are all that ran. No probe ran on Cloudflare.
- Whether p1 to p15 all hold on the base. I read the code against each, and I did not run them. A surprise goes to the owner as `fails_on_base`.
- Whether Effect's cost shows at the window. The bar exists to find out.
- Whether the rule catches what it should without false alarms. Its first count comes with the exam PR.
