# counter: `@tea-fabrika/counter`

The smallest program with a window. It counts presses of +1 until done, and says the count. The
fabrika app ([`apps/fabrika`](../../apps/fabrika/README.md)) lists it, so `counter` typed in the
app's tsh takes over the window.

```ts
import {call, memoryStorage, readInput, viewOf} from "@kampus/fabrika";
import {counter} from "@tea-fabrika/counter";

viewOf(counter)?.of({n: 2});
// {n: 2}: what its window is shown

readInput(counter, {type: "press", value: "plus"});
// {kind: "read", msg: {type: "press", value: "plus"}}: what its window may send

yield* call(counter, {}, {told: {press: ["plus", "plus", "done"]}, keeping: {id: "c", storage: memoryStorage()}});
// {kind: "called", heard: [{name: "n", value: 2}], ...}
```

## What's in it

| Import | File | What it gives |
|---|---|---|
| `@tea-fabrika/counter` | `src/index.ts` | `counter`, the program: input `press` (`plus` or `done`), output `n`, one machine `count`, and its `view`. No React. |
| `@tea-fabrika/counter/window` | `src/window.tsx` | `CounterWindow`, its window: a React component that shows the count and sends `press`. |

- Its window is typed by the program: `WindowProps<typeof counter>` gives `view: {n: number}`
  and a `send` that takes only `{type: "press", value: "plus" | "done"}`.
- The window holds no state. It draws what it is handed and sends presses; the count lives in the
  program's machine.
- Run with no window, as in tsh in a terminal, it still works: tell it presses.

## Why a counter, not the owner's desk

The owner's desk ([`packs/owner-desk`](../../packs/owner-desk/README.md)) was the first choice
for the app's first window. It was not used, for three reasons:

- Its view changes only when the pipeline's core settles an ask, so with no core running a click
  changes nothing.
- It imports `@kampus/pipeline`, whose ask packs load through Node's `createRequire`, into the
  app's main bundle.
- It needs a `DeskView` service the app has no maker for yet.

A counter shows the whole loop (a view, a click, a new view, an end) with none of that.

## Commands

```sh
pnpm --filter @tea-fabrika/counter typecheck
pnpm exec vitest run programs/counter
```
