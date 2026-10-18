# 72. Kept state first: one way to start a kept machine

```sh
pnpm vitest run src/program/kept.test.ts
pnpm vitest run src/stages/ship/program.test.ts src/stages/review/program.test.ts -t "killed"
```

## The bug

Experiment 69, finding 5. When a kept machine is loaded from storage, tea
opens the Listens its kept state asks for at once, at boot. A Listen that
answers fast can move the machine on before the starter sends `resume`.
`resume` then finds the machine in a later phase and sends that phase's
write again.

In 69 a build was killed in `building`. On restart the builder's Listen
opened, finished, and moved the machine to `pushing`. The starter then saw
`pushing`, sent `resume`, and `resume` pushed a second time. The test caught
it.

69 fixed build and operate by hand: `resume` carried a `from` phase, and
operate had a `goOn` guard. The review and ship programs still read the
state after start.

## The helper: `keep.run`

`keep` is what `main` already gets for its machines. It now has `run`, and it
lost `store`:

```ts
const runtime = yield* keep.run(
  "ship",
  {id, until: "forgotten"},
  {ctx: undefined, interpret, subscribe, terminal},
  (kept) => (kept === null || kept.phase === "idle" ? {type: "start", pr} : {type: "resume"}),
);
const end = yield* runtime.done();
```

`keep.run` does three things, in order (`src/program/kept.ts`):

1. It reads the kept state before the machine exists. `first(kept)` says
   which Msg goes first: `start`, `resume`, or `null` for none.
2. It boots the machine with every Listen and every timer held shut, behind
   one Effect `Latch`. Each Sub runner is wrapped as
   `Stream.unwrap(latch.await.pipe(Effect.map(() => runner(sub))))`. tea's
   built-in timer is replaced by the same timer, held.
3. It dispatches the first Msg to quiescence, then opens the latch. The
   Listens open on the state that Msg left.

So the first Msg a machine folds after a restart is always the starter's,
decided from the state as it was kept.

**Why the name.** It is tea's `run`, kept, on the word `keep` this API
already uses. `first` is the Msg that goes first. `runKept` is the function
under it.

**Why it cannot be gone around (poka-yoke).** `keep.store` is gone. A
program has no other way to hand a machine its storage, so it cannot start a
kept machine and read the state later. `keep.run` needs `first`, and its
options type refuses a `store`. All three are compile errors, tested with
`@ts-expect-error` in `src/program/kept.test.ts`.

**Every starter moved:** build (`buildToTheEnd`), operate (the loop, and its
review and ship stages), review (now kept, and it takes on its unfinished
runs at start like ship does), ship, and tsh's `tally`. 69's hand fixes are
gone: build's `resume` lost `from`, and operate lost `goOn`.

## Canon checked

- **Elm.** `init : flags -> (Model, Cmd Msg)`. No Msg reaches `update` before
  `init` returns, and subscriptions are read from the model `init` gave.
  `keep.run` gives the same promise: the kept state plus `first` act as
  `init`, and no Listen runs before them.
- **tea.** `init(loaded)` must return `[loaded, []]` on a reload: no Cmds.
  tea's docs say state-dependent resume is "a boot Msg the host dispatches
  once after `run(...)`". But tea starts Subs at boot, so its own advice has
  the race. tea has no option to hold Subs. tea is unchanged.
- **Effect.** `Latch` is the gate: made shut, every held runner awaits it,
  `open` lets them all through at once. `Stream.unwrap` puts off building
  the runner's stream until the gate opens. A `Deferred` would do the same;
  `Latch` says it plainer.

## Proofs

| Test | Where | Shows |
|---|---|---|
| Bare tea run + store, `resume` sent after boot | `src/program/kept.test.ts` | The bug: the Listen answers, the write goes out, `resume` sends it again. Writes `[1, 1]`. |
| Same kept state, through `keep.run` | same | Run 1's Listen never starts. `resume` makes run 2, it answers once, one write: `[2]`. |
| Three lives, each killed as it works | same | Each life starts the work once (`[2]`, `[3]`, `[4]`). Only the last writes, once. |
| Can't compile | same | No `keep.store`; no `keep.run` without `first`; no `store` in options. |
| Ship killed twice in `waiting`, then let run | `src/stages/ship/program.test.ts` | Checks re-run once (life 1). Life 2: no read, no write. Life 3: one read, one enqueue. |
| Ship killed in the merge queue | same | Next start: no read, no second enqueue; done. |
| Review killed in `reviewing` after a note | `src/stages/review/program.test.ts` | Next start: no gather again (zero `gh` calls), the reviewer starts once (run 2), the note is not sent again, one verdict with the one note. |

A kill here is kill -9 inside the process: `src/program/mortal.ts` is a
shared disk where a killed life's writes never land, so no finalizer (a
run's `stopped`, a last save) is kept.

**The helper is what makes them pass.** With the latch taken out (runners
started at once), four go red: the `keep.run` toy (run 1's stale answer
writes), the three-lives toy (`[1, 2]`, `[2, 3]`, `[3]`), ship killed in
`waiting` (an extra read), and build's restart test. The review test stays
green either way: its race is one of timing, and the scripted reviewer is
slower than `resume`.

Gates: `pnpm typecheck && pnpm lint && pnpm test`, 1435 tests, green. The
touched tests ran five times in a row, green.

No live run. The change is in how a run starts; the tests above drive the
real stage programs with fakes only.

## Findings

1. **The first Msg must settle before the Listens open, not only be
   folded.** With `dispatchOnce`, a review run's `done()` resolved early: tea
   sets the state, then saves, then tells listeners. `done()` reads the state
   as soon as it is set, so the run ended before the view saw `over`.
   `keep.run` dispatches to quiescence.
2. **The wasted second builder start from 69 is gone.** 69's trace showed
   two builder runs 12 ms apart on reattach: run N's Listen at boot, then run
   N+1 after `resume`. Now run N's Listen never starts.
3. **One guard covers every machine.** 69 needed a `from` field per machine
   and a guard per stage. `keep.run` holds every Sub of every machine, so no
   machine needs a guard of its own.
4. **Generic methods break `Keep<Big>` → `Keep<Small>`.** TypeScript's
   variance check for the new generic `run` refuses it; `Keep<out Ms>` fails
   too. `buildToTheEnd` takes `Pick<Keep<BuildMachines>, "run">`, which is
   compared by shape.

## Recommendations

1. **Merge this** (85%). Every starter is on one helper, the race is gone by
   type, and 69's hand fixes are deleted. The doubt is finding 1's flip side
   (hole 3). What would raise it: a live kill -9 + attach on the sandbox.
2. **tea could hold Subs until a host's boot Msg is folded** (75%). For
   example a `run` option that takes the first Msg, or Subs held until the
   first dispatch. That puts the fix where the race is, for every host, and
   makes tea's own resume advice safe. Owner: tea. Not done here: tea is not
   edited from this repo.
3. **tea's `done()` could resolve after the terminal state is saved** (70%).
   Today it can resolve before the save and the listeners run (finding 1).
   Owner: tea.
4. **Move tsh's jobs machine onto `keep.run` or `runKept`** (65%). It still
   uses `Handle.store` directly. It has no Subs, so there is no race today.
   Owner: tsh.

## Holes

1. **tea starts Subs at boot.** Any host that runs a kept machine with tea's
   `run` and a store, and not through `keep.run`, still has the race. Inside
   a tea-program `main` that cannot happen; outside it (older modules,
   `src/tsh/shell.ts`) it can. Layer: tea (rec 2), tsh (rec 4).
2. **`done()` before the save** (rec 3). Layer: tea.
3. **Listens and timers wait for the first Msg's whole chain.** If `resume`
   sends a slow Act, every Listen waits for it. A timer meant as a deadline
   for an Act in that first chain would be held too. No machine here does
   that. Layer: tea-program.
4. **A bare review run loses its verdict on a crash after `over`.** It is
   kept `until: over`, so the save that finds it over drops it, before the
   verdict is sent. Ship's bare `pr` has the same gap; ship's `ask` does not.
   Layer: tea-program (review has no ask and answer yet).
5. **Review notes are at least once.** A note whose Act was out at the kill
   is sent again on `resume`. A posted note would need its id checked on the
   other side. Layer: the review stage.
6. **The fence's cross-process window** from 68a still holds. Layer:
   tea-program.

## Not done

- No live kill -9 + attach on `kamp-us/tea-fabrika-sandbox`.
- Build's own program does not take on kept builds at start; operate does.
  Same as 69.
- tsh's jobs machine (rec 4).
