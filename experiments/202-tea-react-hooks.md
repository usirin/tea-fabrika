---
date: "2026-11-02"
summary: "Library probes for `next/`, tea 0.22.0 only. Each saved Chromium row ran 20 times: the Promise hook folds through Strict Mode and Activity; an Effect run through `useRuntime` draws but its click leaves an Effect unrun (TypeScript rejects it); compiled `Dropped` freezes at 0 while `Drawn` reaches 3, with both compiling successfully. A sketch Effect hook starts once and stops on unmount; a bare fork after stop hides `Stopped` unless its fiber is read. The unmerged send branch (demlik `10425bb`, on the engine fix in demlik PR 855) folds Effect clicks and reports a reducer throw and a late send to `onError` once each, counted call by call. No model, $0."
---

# tea's React hooks: Strict Mode, the Effect engine and the React Compiler

**tea 0.22.0's Promise-engine hook keeps working through Strict Mode and an
`<Activity>` hide/show. Its Effect-engine gap is separate: `useRuntime` can read
the state, but its returned dispatch leaves an Effect unrun.** The React Compiler
adds another trap: a component that drops its hook's value and reads a module
object freezes even though compilation succeeds. Draw the value the hook returns.

```tsx
// The whole idea, on released tea 0.22.0 with the Promise engine.
const counter = defineMachine({
	types: {model: {}, msg: {}},
	init: (loaded) => [loaded ?? {count: 0}, []],
	update: {inc: (state) => [{count: state.count + 1}, []]},
});
const [state, dispatch] = useMachine(counter, {run, ctx: undefined});
return <button onClick={() => dispatch({type: "inc"})}>{state.count}</button>;
// Strict Mode + Activity: click -> 1; hide, show, click -> 2.
// With an Effect run passed to useRuntime, dispatch returns an Effect nobody runs.
```

Read and checked 2026-11-02. These are library probes for `next/`'s React boundary,
not changes to today's app or `next/`. P1–P5 use released `@demlik/tea` 0.22.0.
P6 uses the unmerged `can/tea-react-send` prototype from kamp-us/demlik, not a
released fix. No model, no key, no deploy, $0.

The saved browser runs use headless Chromium **153.0.8010.12**, React and React DOM
**19.3.1**, Effect **4.1.1**, and `babel-plugin-react-compiler` **1.0.0**.
Every saved Chromium row has **20 repetitions**. The scripts and exact dependencies
are in [`202-tea-react/`](https://github.com/usirin/tea-fabrika/tree/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/202-tea-react/), with the probe's dependency lockfile.
The original result files are copied
unchanged to [`results/202-tea-react/`](https://github.com/usirin/tea-fabrika/tree/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/results/202-tea-react/).

Context: [demlik PR 774](https://github.com/kamp-us/demlik/pull/774) is the
Strict Mode fix; [demlik issue 852](https://github.com/kamp-us/demlik/issues/852)
tracks the Effect-engine hook gap. [demlik issue 853](https://github.com/kamp-us/demlik/issues/853)
asks for a selector, which this experiment does not test. The Compiler settings
and principle 4 come from [tea-fabrika PR 320](https://github.com/usirin/tea-fabrika/pull/320).
The hook direction is recorded in [Elm first](../docs/direction/elm-first.md) and
[tea-fabrika PR 331](https://github.com/usirin/tea-fabrika/pull/331).
These links are context supplied with the study, not a fresh check of GitHub state.

## P1: does useMachine survive Strict Mode and Activity?

**Question.** With the Promise engine, does a click still fold under Strict Mode,
after an `<Activity>` hide/show, and with both together?

```tsx
import {run} from "@demlik/tea/promise";
import {useMachine} from "@demlik/tea/react";

function Counter() {
	const [state, dispatch] = useMachine(counter, {run, ctx: undefined});
	send = dispatch; // The harness calls this, then reads the rendered span.
	return <span>{state.count}</span>;
}
// The harness changes mode from visible to hidden to visible.
<StrictMode><Activity mode={mode}><Counter /></Activity></StrictMode>;
```

**Result.** In [`p1-p4-chromium.jsonl`](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/results/202-tea-react/p1-p4-chromium.jsonl):

| Mount | Saved answer | Repetitions |
|---|---|---|
| Plain | `ok 1` | 20 |
| Strict Mode | `ok 1` | 20 |
| Activity | `ok 1 \| show, ok 2` | 20 |
| Strict Mode + Activity | `ok 1 \| show, ok 2` | 20 |

**Meaning.** The counter retains its state and accepts the next message after
the lifecycle drill and hide/show. The installed hook starts its run from an
effect and retires it from insertion-effect cleanup, consistent with PR 774.
The probe checks visible behavior, not a start counter; P4 measures starts.
There are no Subs or Cmds here, so this says nothing about pausing them.

## P2: can useRuntime drive an Effect run?

**Question.** Can a run booted with `@demlik/tea/effect` be read and driven through
tea 0.22.0's `useRuntime`?

```tsx
// rt is an EffectRuntime, already booted in an open Effect scope.
const [state, dispatch] = useRuntime(rt);
dispatch({type: "inc"}); // Returns an Effect, without running it.
// A separate harness action:
await Effect.runPromise(rt.dispatch({type: "inc"})); // Now the count changes.
```

**Result.** All 20 repetitions in
[`p1-p4-chromium.jsonl`](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/results/202-tea-react/p1-p4-chromium.jsonl) first draw `0`,
stay at `0` after the hook's dispatch, then redraw `1` after the harness runs the
dispatch Effect itself. Reading and subscribing work; the click does nothing.

The typed version is deliberately rejected:

```ts
import type {EffectRuntime} from "@demlik/tea/effect";
import {useRuntime} from "@demlik/tea/react";
declare const rt: EffectRuntime<{count: number}, {type: "inc"}>;
export const tryIt = () => useRuntime(rt); // TS2345
```

[`p2-types.txt`](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/results/202-tea-react/p2-types.txt) says `EffectRuntime` is not
assignable to `BootedRunHandle`: `ready` is an Effect where the hook's type expects
a Promise. The installed JavaScript returns `[state, runtime.dispatch]` without
running what `dispatch` returns. The JavaScript probe bypasses the type rejection
to show that runtime boundary.

**Meaning.** Strict Mode being fixed does not make this Effect integration work.
This is the gap in [issue 852](https://github.com/kamp-us/demlik/issues/852).
It supports the existing `next/` stand-in hook in one file; it does not test a
released Effect-aware `useMachine`.

## P3: can a component drop its subscription value and read a module object?

**Question.** At PR 320's Compiler settings, will that component keep updating if
compilation succeeds?

```tsx
function Dropped() {
	useSyncExternalStore(subscribe, () => store.version);
	return <span>{store.count}</span>;
}
function Drawn({rt}) {
	const [state] = useRuntime(rt);
	return <span>{state.count}</span>;
}
const COMPILER = {
	target: "19",
	panicThreshold: "none",
	environment: {validateNoImpureFunctionsInRender: true},
};
```

**Result.** The harness increments both sources, then reads both spans. In all
20 repetitions of each row in
[`p1-p4-chromium.jsonl`](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/results/202-tea-react/p1-p4-chromium.jsonl):

| Build | Wanted | Observed |
|---|---|---|
| Without the Compiler | `dropped 3, drawn 3` | `dropped 3, drawn 3` |
| With the Compiler | `dropped 3, drawn 3` | `dropped 0, drawn 3` |

Running [`compile.mjs`](./202-tea-react/compile.mjs) reports
`CompileSuccess(Dropped), CompileSuccess(Drawn)`. The compiled `Dropped` reuses
its rendered span without a dependency on the discarded snapshot or the new
count. It can read `store.count` again and still return the cached output. The
hook still subscribes, but its return value does not reach the output.

**Meaning.** Successful compilation is not a behavior check. The guess that a
subscription alone keeps a separate module read fresh was wrong. Principle 4 of
[PR 320](https://github.com/usirin/tea-fabrika/pull/320) has a concrete example:
render the value returned by the hook. The `Drawn` case uses a Promise-engine
run, so this failure is independent of P2's Effect dispatch gap. This is a small
model of today's desk shape, not a run of the real desk.

## P4: can a sketch hook own an Effect run through these lifecycles?

**Question.** Can it start a run after render, keep it through Strict Mode and
Activity, and stop it on unmount?

```tsx
// Sketch, shortened from use-effect-machine.mjs.
const [mounted] = useState(() => new MountedEffectRun(machine, opts));
useInsertionEffect(() => () => mounted.retire(), [mounted]);
useEffect(() => mounted.connect(), [mounted]);
const state = useSyncExternalStore(
	mounted.subscribe, mounted.getSnapshot, mounted.getSnapshot,
);
// connect: fork an Effect scope, await run.ready, subscribe, then Effect.never.
// retire: interrupt that fiber, closing the scope and stopping the run.
```

**Result.** Both Activity and Strict Mode + Activity return
`1, show 2, starts 1, run stopped` in all 20 repetitions in
[`p1-p4-chromium.jsonl`](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/results/202-tea-react/p1-p4-chromium.jsonl).
The harness records the holder's start count and attempts a dispatch on its
runtime after unmount. That dispatch fails, which the probe labels `run stopped`.

**Meaning.** The lifecycle approach works for this Effect counter. It is not a
replacement adapter ready to ship. The sketch keeps Subs running while hidden,
has no changing-machine or changing-context handling, and drops sends after
retirement. Its forked dispatches also need the failure handling P5 examines.

## P5: where does a forked dispatch failure go after stop?

**Question.** Does a plain `Effect.runFork` make the failure visible to the caller?

```ts
const a = Effect.runFork(rt.dispatch({type: "inc"})); // rt has stopped.
// Inspecting Fiber.await(a) finds Failure / Stopped; the fork alone prints nothing.
const b = Effect.runFork(rt.dispatch({type: "inc"}).pipe(
	Effect.catchTag("Stopped", () => Effect.void),
	Effect.tapCause((cause) => Effect.sync(() => console.error(cause))),
));
```

**Result.** [`p5-errors.txt`](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/results/202-tea-react/p5-errors.txt), a Node probe:

```text
A: plain runFork after stop ->
   fiber ended: Failure, error tag: Stopped
B: runFork with Stopped caught, the rest reported ->
   fiber ended: Success
```

**Meaning.** The first failure still exists in the fiber. It is silent when the
event handler discards that fiber. Catching an expected `Stopped` makes the
second fiber succeed; `tapCause` provides an explicit reporting path for other
causes. This saved run exercises only `Stopped`, so it does not prove that a
different cause was reported. Swallowing `Stopped` is a choice for this sketch,
not a claim that every late click should be ignored.

## P6: does a void send on the loop's post path close the click gap?

**Question.** On the unmerged `can/tea-react-send` prototype, can the hook send
without returning a Promise or an unrun Effect, and still report failures?

```tsx
// Prototype only. useMachine here still uses the Promise engine.
const [state, send] = useMachine(counter, {
	run: promiseRun, ctx: undefined,
	onError: (error, context) => errors.push(`${context.phase}:${error.name}`),
});
const returned = send({type: "inc"}); // undefined; the loop folds the message.
// The prototype's useRuntime(effectRuntime) also supplies this void send.
// For an engine run it uses the internal post path; a hand-built handle falls
// back to its dispatch and reports a rejected Promise.
```

**Result.** In [`p6-chromium.jsonl`](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/results/202-tea-react/p6-chromium.jsonl),
all 20 repetitions of each row give:

| Case | Observed |
|---|---|
| useMachine + Activity | `returns undefined; 1, show 2; errors reduce:Error,discard:DispatchDiscardedError` |
| useMachine + Strict Mode + Activity | `returns undefined; 1, show 2; errors reduce:Error,discard:DispatchDiscardedError` |
| Effect run through useRuntime | `2` |
| Hand-built handle through useRuntime | `1` |

The machine rows send a message whose reducer throws, unmount, then send again.
The error list holds every `onError` call in order, with no de-duplication: the
reducer's throw reaches it exactly once, as `reduce:Error`, and the late send
once, as `discard:DispatchDiscardedError`. The Effect-runtime row sends twice; the
hand-built handle row sends once.

These rows ran against kamp-us/demlik commit `10425bb` on `can/tea-react-send`,
which sits on the engine fix in [demlik PR 855](https://github.com/kamp-us/demlik/pull/855)
(`8a4e2cc`). A first run on the earlier prototype, before that fix, printed the
error list through `new Set(errors)`; without the Set, the same throw also showed
up a second time as `follow-up` ([demlik issue 854](https://github.com/kamp-us/demlik/issues/854)).

**Meaning.** This prototype reaches the Effect run without asking React's event
handler to execute an Effect. It also preserves the hand-built Promise handle
path and routes a late send to `onError`, and each failure reaches it once. It is
evidence for a patch, not behavior shipped in tea 0.22.0.

## Reproduce it

Install the experiment's own dependencies, outside the pnpm workspace. From the
repository root:

```sh
cd experiments/202-tea-react
npm install
cd ../..
node experiments/202-tea-react/run-chromium.mjs
node experiments/202-tea-react/p5-errors.mjs
```

`run-chromium.mjs` compiles P3 automatically and prints P1–P4. Its optional first
argument is the repetition count, default 20. It uses Playwright's cached
headless browser unless `CHROMIUM_BIN` names another executable. If no browser
is installed, run `npx playwright install chromium` inside the experiment folder
when network access is available. To match the saved run, select Chromium
153.0.8010.12. Installing the JavaScript package alone does not pin the browser.
Generated `out-plain.mjs` and `out-compiled.mjs` are ignored; saved results are
never overwritten by these commands.

For P2's type rejection and an optional jsdom pass:

```sh
cd experiments/202-tea-react
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck \
  --module NodeNext --moduleResolution NodeNext --target ES2022 p2-types.ts
# Expected failure: TS2345, exit 2.
cd ../..
node experiments/202-tea-react/run-node.mjs 1
```

P6 additionally needs the prototype's source checkout, with its dependencies
already installed. This runner reads it without changing it:

```sh
DEMLIK=<prototype-checkout> CHROMIUM_BIN=<chromium-executable> \
  node experiments/202-tea-react/run-next-chromium.mjs
```

The runner aliases tea to that checkout's `packages/tea/src` and resolves React
and Effect from this experiment, so the bundle uses one copy of each. `DEMLIK`
can also be the second argument, after the repetition count. There is no assumed
checkout location. A regular released tea install cannot reproduce P6.

## Checks while packaging

The fresh jsdom pass, with 1 repetition per row, reproduced P1–P4's saved answers.
The compiler reported success for both components. The standalone P2 type check
reproduced TS2345, and P5 reproduced its saved output. These checks used the
already installed probe dependencies, linked locally into the experiment.

The Chromium runner compiled and bundled from the repository root. Its default
browser was absent; selecting the available cached binary reached launch, then
the sandbox blocked it with `EPERM` and `SIGTRAP`. No fresh Chromium result is
claimed. P6 also bundled from the supplied source checkout and hit the same
launch restriction. The browser findings above come from the saved files.

`env npm_config_manage_package_manager_versions=false pnpm format` passed:
`oxlint: 0 blocking, 146 advice`. The environment flag uses the installed pnpm
without trying to install the repository's pinned version into a protected cache.
It changes no repository setting. Formatting covers the added `.mjs`, `.jsx`,
`.ts` and `package.json`; Markdown and saved results are excluded by the repo's
config, and oxfmt ignores `package-lock.json` by default.

With the same flag, `pnpm lint` passed oxlint and the format check, then stopped
when its nested pnpm call tried to write Corepack's cache outside the sandbox.
Each remaining check was run directly with that flag: `pnpm -s lint:versions`,
`lint:layers`, `lint:boundaries`, `lint:browser` and `lint:dead`. All passed.
These check tracked version declarations, import layers, package boundaries,
the library's browser entry and unreachable code. The new manifest is untracked,
so its exact pins were also checked directly against the installed versions and
the lockfile. The experiment stays outside the workspace typecheck.

`npm install --package-lock-only --offline --ignore-scripts` with the experiment
as its prefix and a local cache passed. It validated the lock without downloading
packages; a fresh full dependency install was not run. The saved result files
match their originals, relative links resolve, and the added files contain no
machine paths. No app or library source changed.

## What this cannot tell us

- Browser results beyond headless Chromium 153.0.8010.12. jsdom is a separate
  environment; matching it does not replace the saved browser runs.
- Other machine shapes, real Cmds, Subs, stores, concurrent work or the real
  desktop app. These probes use a counter and harness calls to the returned
  send function, not pointer or keyboard events on a product button.
- Whether P4 is a complete hook. It is a sketch with deliberate lifecycle and
  error-handling gaps, including Subs continuing while hidden.
- Whether P6 will ship. It ran on an unmerged branch (`10425bb`); review may
  change it, and the saved rows hold no hash of their own beyond this note.
- P5 does not exercise a non-`Stopped` reporting case.
- Selector behavior from issue 853, production-build behavior, React releases
  beyond the pinned one, or a native Compiler port. P3 uses the pinned Babel
  plugin at PR 320's settings, in React's development build.
