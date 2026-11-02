# React Compiler from day one

**Proposed 2026-11-02.** Decided before this note, by the owner on 2026-11-02, and not asked again:
`next/` is React Compiler compatible from day one, with the guidelines and rules that takes; and
today's app follows the same guidelines too, as a tryout whose lessons go to `next/` rethought.
This note is how. Settled notes it stands on: [Elm first](./elm-first.md) (one
`useSyncExternalStore` hook, state in tea machines, no `useState`, no tea `useMachine`),
[UI on Manti](./ui-on-manti.md), [oxlint and oxfmt](./oxlint-and-oxfmt.md), and the block bar in
`AGENTS.md`: about 0% false alarms, measured, to block; up to 10% to advise.

Built from [experiment 194](../../experiments/194-react-compiler.md), which read React's docs and
the tools and ran oxlint's React rules and the Compiler over today's window code, and
[experiment 176](../../experiments/176-react-on-the-real-app.md), which compiled today's app on a
branch; and a private page, "React Compiler guidelines", with a window whose components you can
break and compile. 194's probe is small and 176 is one machine. Neither is a benchmark.

```tsx
// A sketch. Today's tooltip (apps/fabrika/src/window/pop.tsx:675), in the shape this note asks.
// Today the Compiler skips it: "Cannot access refs during render" at :678.
export const useTip = (tip: Tip, quiet: boolean) => {
	const id = useId(); // C1, C2: was useRef(`tip-${Math.random()}`).current, read in render
	const [at, setAt] = useState<DOMRect | null>(null); // today's version only; in next/ the model holds it
	const shown = quiet ? null : at; // C1: derived in render, not set in an effect
	// show and hide, unchanged: refs and the clock are read only in handlers and effects (C2)
	return {on: {"aria-describedby": shown === null ? undefined : id /* ... */}, node: /* ... */ null};
};
```

```text
one build traced: the tooltip file, saved
oxlint             react/refs, react/immutability, react/display-name, one-store-hook: no finding
build.ts           .tsx, so Babel with the Compiler first, then esbuild; about 90 ms for pop.tsx
Compiler logger    CompileSuccess useTip, CompileSuccess Palette ... 0 CompileError
pnpm lint:compiler 0 skips; compiler-ledger.json names no function; passes
DevTools           the components that use it show "Memo ✨"
today, before      CompileError useTip (4 events), CompileError Palette: lint:compiler fails, 2 skips
```

## Which version

- **`next/`:** all of it, from the first `.tsx` file. The rules and the skip check land in Tier 1's
  exam PR, and the Compiler in `build.ts` in PR A ([what changes in Tier 1](#what-changes-in-tier-1)).
- **Today's version (`apps/fabrika`, `programs/*`):** the same rules, as the owner's tryout. Two
  small tickets after ticket 117 ([today's app](#todays-app)). What it teaches goes to `next/` as
  lessons, not copies.

## The six principles

React's "Rules of React" [r24] are the base. These six are what a window writer presses, with what
holds each one. C1 to C3 are React's own rules; C4 is ours; C5 and C6 are how we hold them.

### C1: render is pure

**Lean, 80%.**

- **What it means:** the same props and the same model give the same output. No `Date.now()`,
  `Math.random()`, `new Date()` or read of something that changes, during render. Time comes from
  the model, through a Sub, as Elm's `Time.every`.
- **Why:** "Components must be idempotent" and "Side effects must run outside of render" [r24].
  The Compiler caches a render's output; a clock read in render shows a stale time until a prop
  changes. 194: `now-in-render.tsx` compiles by default, and its time is cached.
- **Linear:** no Linear answer: nothing public on the Compiler. An outside write-up says its state
  lives in MobX outside React (**secondary**), which fits a pure render.
- **Elm:** `view : Model -> Html Msg` is pure by type. A time in the view comes from the model.
- **What holds it:** the Compiler's own purity check, `validateNoImpureFunctionsInRender: true`,
  inside the skip check (C5). It refused all 8 clock reads on main and passed PR 223's handler.
  oxlint's `react/purity` stays off: 8 right and 1 wrong in 194 (`next/src/window/main.tsx:146` on
  PR 223, a clock read only a click calls), 11%, over both bars.
- **Doubt:** the purity check is an `environment` option that the React pages 194 read do not
  describe; a later version could rename it. The skip check's test plants a clock read, so a rename fails loudly.
- **Cost:** a `now` in the model wherever a window shows a time. Today, one ticking `now` read once
  and passed down.
- **Today:** **breaks** in 8 places: `programs/tracker/src/window.tsx:406, 454, 575, 772, 797`,
  `apps/fabrika/src/window/frame.tsx:471, 554`, `pop.tsx:678`.

### C2: refs only in effects and handlers

**Lean, 85%.**

- **What it means:** a ref holds something for later. Render never reads or writes `.current`. An
  id comes from `useId`.
- **Why:** "Reading or writing `ref.current` during render breaks React's expectations" [r25]; the
  Compiler skips the whole function.
- **Linear:** no Linear answer: nothing public.
- **Elm:** Elm has no refs; a DOM fact the view needs is in the model, from a port or a Sub.
- **What holds it:** `react/refs` blocks, in `next/**` and today's window and program `.tsx`
  files. 194: 1 of 1 right on main; 176: 1 of 1. The skip check holds it too.
- **Doubt:** n is 2. Every fire in the first `next/` landings is read by hand; one false alarm
  sends it to advice.
- **Cost:** none in `next/`. Today, one line.
- **Today:** **breaks** at `pop.tsx:678`.

### C3: nothing changes after render

**Lean, 85%.**

- **What it means:** props, the model, a hook's value and anything passed to JSX are never changed
  once drawn. A render does not keep a counter that its callbacks bump.
- **Why:** "Props and state are immutable", "Values are immutable after being passed to JSX" [r24].
- **Linear:** no Linear answer: nothing public.
- **Elm:** values are immutable; tea's update makes a new model.
- **What holds it:** `react/immutability` blocks. 194: 1 of 1 right. The skip check holds it too.
- **Doubt:** n is 1, as C2.
- **Cost:** number the rows before render.
- **Today:** **breaks** at `pop.tsx:575` (`Palette`'s `i += 1` inside `map`), so the Compiler skips
  `Palette` (`pop.tsx:514`).

### C4: one store hook, and its value is what you draw

**Lean, 85%.**

- **What it means:** a window reads its model only through the one `useSyncExternalStore` hook
  (`useModel`), and draws from the value it returns. Never a module object read during render.
- **Why:** this is the one failure the Compiler does not report. Compiled, a component that calls
  the hook, drops its value and reads a module store keeps its first output forever. 176, pick 6:
  "the app never reaches its first prompt, even in 60 s". 194: the planted copy compiles with its
  output cached, and draws 0 lint findings from 24 rules.
- **Linear:** no Linear answer on the Compiler. Its components subscribe to an outside store
  (**secondary**), which is this shape.
- **Elm:** `view model`. The model is the only input.
- **What holds it:** a rule of ours, `one-store-hook`. In `next/**`: `useSyncExternalStore` is
  imported only by `window/use-model.ts` (`no-tea-react` already refuses tea's hooks). In both
  versions: a store hook called as a statement, its value dropped, fires. Not written yet; a search
  for that shape on main finds one, right (`apps/fabrika/src/window/desk.tsx:802`), and passes
  `programs/markdown/src/window.tsx:143`, which uses its value.
- **Doubt:** a module object read in render through a helper, with the hook's value used for
  something else, passes the rule. In `next/` the import rule leaves no such module store. Today it
  could; the planted test covers the one shape seen.
- **Cost:** about 30 lines for the rule and its test. Today, 176's pick 2: about 30 small edits.
- **Today:** **breaks** at `desk.tsx:802-803`. Compiling before this is fixed freezes the app.

### C5: the Compiler skips nothing that is not named

**Lean, 80%.**

- **What it means:** a check runs the Compiler as the build does, reads its logger, and fails on
  any `CompileError` or `PipelineError`. The one way out is `"use no memo"` in that function, with a
  row in `compiler-ledger.json` that says why. The check fails on a directive with no row, and on a
  row with no directive. Adding a row is the owner's call, in a change of its own; the ledger only
  shrinks, as `unreachable-ledger.json` does.
- **Why:** the Compiler skips silently [r3], and React keeps the build at `panicThreshold: "none"`
  [r6]. So the check sits beside the build, in `pnpm lint`, not in it. "Use no memo" is "a temporary
  debugging tool" and you should "Always document why" [r18], [r19]. Nobody adds their own exam
  ([the note](./nobody-writes-their-own-exam.md)).
- **Linear:** no Linear answer: nothing public, and no team found publishes how it blocks a skip.
- **Elm:** no Elm answer: Elm has no optimizer that can skip. The ledger is our dead-code ledger's
  shape.
- **What holds it:** `pnpm lint:compiler` and its test, which plants a skipped function, a named
  one, a directive with no row, a stale row and a clock read in render (C1).
- **The false-alarm bar:** 2 of 2 skips on main were real breaks, each with a right lint finding
  inside. A Compiler "Todo" (syntax it cannot handle yet) would be a skip with nothing wrong in our
  code; none on main. That is the case the ledger is for. Sure of 0% false alarms: 70%, n is 2.
- **The check must read the directive itself:** a broken function with `"use no memo"` still logs a
  `CompileError` and does not throw even at `all_errors` (194). Event fields "may change between
  versions" [r9], so the Compiler stays pinned exact, and the test catches a change.
- **Cost:** about 80 lines for the check, 60 for its test, and about 0.9 s per run on today's 11
  files.
- **Today:** **breaks**: 2 functions skipped, nothing says so.

### C6: memoizing is the Compiler's job

**Lean, 70%.**

- **What it means:** new code writes no `useMemo`, `useCallback` or `memo` by default. One comes
  back with a measured reason in a comment. When `memo` is used, it wraps a named const,
  `memo(TileView)`, never an inline function.
- **Why:** "For new code, we recommend relying on the compiler for memoization" [r20]; "you can
  safely remove `React.memo`" [r22]. 176, pick 6: compiled, the tile `memo` was not needed (same
  renders per tile with and without it, one run).
- **Linear:** no Linear answer: nothing public.
- **Elm:** `Html.Lazy` is Elm's hand `memo`. The Compiler applies its equivalent to every component
  [r23], so the hand one is not needed.
- **What holds it:** `react/display-name` blocks (176: 2 of 2 right; 0 on main, which has no
  `memo`). `memo(function X)` cannot stay: `pnpm format`'s `prefer-arrow-callback` fix turns it into
  an arrow (`.oxlintrc.json:149`), which `display-name` then refuses. `memo(TileView)` passes both
  (194). No rule refuses `useMemo` or `useCallback`: a review reads them.
- **Doubt:** the study 176 built on found a compiled tile still called once per patch from a
  `.map`, so `memo` still mattered. 176's real file says the opposite, in one run. A second run of
  176's bench on the first `next/` desk settles it.
- **Cost:** none; less code.
- **Today:** **follows**: main has no hand `memo`. `frame.tsx` has `useCallback`s, which stay
  (existing code keeps its memoization [r21]).

## The smaller calls

### How the build runs the Compiler

```ts
// A sketch, next/build.ts's forBrowser. Babel only on .tsx outside node_modules, the Compiler first.
const reactCompiler: Plugin = {
	name: "react-compiler",
	setup: (b) =>
		b.onLoad({filter: /\.tsx$/}, ({path}) =>
			path.includes("node_modules") ? undefined : {contents: compile(path), loader: "tsx"}),
};
const COMPILER = {target: "19", panicThreshold: "none", environment: {validateNoImpureFunctionsInRender: true}};
```

- **Lean, 80%: Babel inside esbuild's `onLoad`, on `.tsx` files only.** esbuild has no plugin of
  its own, and Next.js and Vite both filter to the files that need it [r44], [r45]. Every `.ts`
  file stays on esbuild alone. Hot reload compiles only the saved file.
- **Not now:** oxc's native Compiler, "more than 10 times faster than Babel" [r38], is
  "experimental" in Vite [r44], and React's Rust port is "work-in-progress" [r39]. Revisit when it
  is stable. Not Vite: `next/` builds with esbuild.
- **The cost:** 194: about 0.9 s of Babel for 11 files and 6,190 lines, against 18 ms for esbuild's
  transform. 176: `desk.js` 4.0 to 5.1 s against 0.4 s, under load. In `next/` Tier 1, the window
  `.tsx` files are a few hundred lines, so tens of milliseconds. Sure: 75%; the whole build is
  timed in PR A's body.
- **`target: "19"`, `compilationMode: "infer"`:** React's defaults for React 19; no pick.

### Which rules block, which advise

| Rule | 194 on main, then 176 | Lean |
|---|---|---|
| `react/refs` | 1 of 1; 1 of 1 | block |
| `react/immutability` | 1 of 1; 1 of 1 | block |
| `react/display-name` | none; 2 of 2 | block |
| `one-store-hook` (ours) | 1 of 1, by a search | block |
| `react/purity` | 8 of 9, one wrong on PR 223 | off; the Compiler's purity check holds C1 |
| `react/set-state-in-effect` | 1 of 2 | off |
| `react/exhaustive-effect-dependencies` | 0 of 7 | off; `react/exhaustive-deps` already blocks |
| the other Compiler-powered rules | no finding | off; the skip check holds what they find |

**Lean, 75%.** Why: block only what is measured; the skip check already fails on every skip, so a
rule with no data adds a second voice and no new catch. Cost: a skip shows as a check failure, not
as a squiggle on the line. Doubt: the counts are tiny. Each fire in the first `next/` landings is
read by hand, and a rule moves when its count says so.

### Where the rules apply today

**Lean, 85%:** one override in `.oxlintrc.json` for `apps/fabrika/src/window/**/*.tsx` and
`programs/*/src/**/*.tsx`, and one for `next/**/*.tsx`. Tests are left out: a test may plant a
broken component.

## What the ledger records

**Nothing new.** Which functions compiled is rebuilt from any commit by running the check again, so
no fact is lost. The `compiler-ledger.json` rows are files in git, with their history. The skip
check prints its counts in the pull request's checks.

## Today's app

The owner's tryout. From 176's real numbers and 194's count on main. The ticket draft is outside the
repo until the owner files it.

- **Lean, 70%: two tickets, after ticket 117.** First the window code follows C1 to C4, with no
  build change. Then the Compiler in `apps/fabrika/build.ts`, the rules in `.oxlintrc.json`, and the
  skip check. Why two: compiling before the store hook lands freezes the app, so the order is the
  risk, and the first ticket is worth having alone. Cost: two lanes' overhead. Doubt: one lane
  could order the two tasks itself.
- **Ticket A:** the desk's one store hook (176, pick 2, about 30 edits); `Palette` numbers its rows
  before render; `useTip` takes `useId` and derives `quiet`; one ticking `now` instead of the 8 clock
  reads. About 120 to 180 lines and 60 to 100 test lines, 0.3 to 0.5 agent hours at 600 lines an
  hour.
- **Ticket B:** `babel-plugin-react-compiler` 1.0.0 and `@babel/core` 7.29.7 in the catalog; the
  Compiler in `build.ts` on `.tsx` files only; the three rules and `one-store-hook`; `lint:compiler`
  and `compiler-ledger.json`. About 150 to 220 lines and 100 to 150 test lines, 0.4 to 0.6 agent
  hours.
- **Together:** about 10 files, 270 to 400 product lines, 0.7 to 1.1 agent hours, a `1` on the
  doubling scale. Sure: 55%.

## What changes in Tier 1

Proposed with this note; the plan files say so in place.

- **The exam PR** gains the rules (`react/refs`, `react/immutability`, `react/display-name` and
  `one-store-hook`, blocking in `next/**/*.tsx`), `lint:compiler` with its planted test under
  `next/apps/fabrika/src/exam/`, an empty `compiler-ledger.json`, and the two Babel packages in
  the catalog. Its PR body counts each fire on PR 223's tree: 194 found 0 for the three React rules,
  and 0 skips among 5 functions. `one-store-hook` is not written yet; PR 223 has no store hook to
  fire on.
- **PR A, T5:** the first `useModel`, under the rules. **T6:** the Compiler in `build.ts`'s
  `forBrowser`, and the bundle time before and after in the PR body.
- **The window sketch** in Tier 1's detail drops `memo` per tile (C6). PR B's T7 no longer adds it.

## Where this differs from settled notes

- **Tier 1's window sketch** (`tier-1-detail.md`, "The window in React") has `memo` per tile, "Elm's
  Html.Lazy". C6 drops it as a default. Approved with Tier 1 on 2026-11-01; this is a walk-back the
  owner picks.
- **176's write-up** blamed oxfmt for the `memo(function X)` clash. It is oxlint's
  `prefer-arrow-callback` fix, run by `pnpm format`.
- **176, pick 10** put `purity` among the rules that meet the block bar. PR 223's one false alarm
  moves it off.

## What it costs

- In `next/`: four lint rows, one rule of ours (about 30 lines), the skip check (about 80) and its
  test (about 60), one ledger file, a Babel step in `build.ts` (about 25 lines), two packages.
- Build time on `.tsx` files: about 50 times esbuild's per file, tens of milliseconds in Tier 1.
- Today: the two tickets above.

## What it cannot tell us

- Whether a compiled window is faster to a person. 176 found fewer renders, not felt milliseconds.
- False alarms past tiny counts: 2 skips, 1 or 2 fires per blocking rule.
- How oxc's copy of the Compiler (in oxlint) and Babel's differ, past one purity case.
- Whether the tile `memo` matters under the Compiler: one run said no, a toy said yes.
- How other teams block a skip in CI, and what Linear does: nothing public was found.

[r3]: https://react.dev/learn/react-compiler/debugging
[r6]: https://react.dev/reference/react-compiler/panicThreshold
[r9]: https://react.dev/reference/react-compiler/logger
[r18]: https://react.dev/reference/react-compiler/directives/use-no-memo
[r19]: https://react.dev/reference/react-compiler/directives/use-no-memo
[r20]: https://react.dev/learn/react-compiler/introduction
[r21]: https://react.dev/learn/react-compiler/introduction
[r22]: https://react.dev/reference/react/memo
[r23]: https://react.dev/reference/react/memo
[r24]: https://react.dev/reference/rules
[r25]: https://react.dev/reference/eslint-plugin-react-hooks/lints/refs
[r38]: https://oxc.rs/blog/2026-08-18-react-compiler-support
[r39]: https://github.com/facebook/react/pull/36173
[r44]: https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md
[r45]: https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler
