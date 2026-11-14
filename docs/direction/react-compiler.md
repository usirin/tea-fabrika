---
state: "decided 2026-11-03"
summary: "`next/` from its first `.tsx` file; today's app as the owner's tryout. Strict: every Compiler finding fails the build, in every repo, always, with no setting and no advice level, as React's own Rules of React; the only exit is `\"use no memo\"` with an owner-approved `compiler-ledger.json` row, and a false alarm is a bug to fix. Six principles: render is pure, and a view never reads the clock, so the time comes through a Cmd and the Compiler's own purity check blocks; refs only in effects and handlers; nothing changes after render; one store hook, and its value is what you draw, held by a rule of ours since a dropped value compiles and freezes the app; the Compiler skips nothing that is not named, and the build owns that check, which `lint:compiler` also calls; memoizing is the Compiler's job, so no `memo` per tile, and tiles get plain values and read their own part. `react/refs`, `react/immutability`, `react/display-name` block; oxlint's `react/purity` stays off, since the build's check covers it. No Babel: oxc's native port of the Compiler runs in Rolldown (lean 85%). Lands in Tier 1's exam PR and PR A. From experiments 194, 195 and 176."
---

# React Compiler from day one

**Decided 2026-11-03.** The owner approved the six principles, the shape and the smaller calls
below, after a walk, and set them strict: every compiler finding blocks, and the only exit is an
owner-approved ledger row. The leans' confidence numbers stay as written.

Its decided rules are in: [0463](../../.decisions/0463-react-compiler-from-day-one.md),
[0464](../../.decisions/0464-every-compiler-finding-fails-the-build.md),
[0465](../../.decisions/0465-render-is-pure.md),
[0466](../../.decisions/0466-one-store-hook-no-hand-memo.md).

Decided before this note, by the owner on 2026-11-02, and not asked again: `next/` is React
Compiler compatible from day one, with the guidelines and rules that takes; and today's app follows
the same guidelines too, as a tryout whose lessons go to `next/` rethought. Decided the same day,
after this note's first version: **no Babel in the build**, and the calls in
[experiment 195's "Decided"](../../experiments/195-oxc-toolchain.md#decided). This note is how.

**Strict, decided 2026-11-03.** We follow React's Compiler rules as written, the same as React's
own Rules of React [r24], with no advice level. Every finding the Compiler, its checks or the React
rules below give is an error that fails the build, in every repo, always. There is no setting to
loosen it. The one way out is C5's: `"use no memo"` in the function plus an owner-approved row in
`compiler-ledger.json`. A false alarm is a bug to fix, in the rule or in the code, and never a
reason to make a rule advice. This replaces two things: the per-repo strictness knob in
`fabrika.toml` from experiment 195's call 2 (C1), and the block bar's path to advice for these
rules ([where this differs](#where-this-differs-from-settled-notes)).

Settled notes it stands on: [Elm first](./elm-first.md) (state in tea machines, no `useState`;
tea's own hook once it takes the Effect engine, and until then one `useSyncExternalStore`
stand-in; tea 0.23.0's `useRuntime` took it, so there is no stand-in), [UI on Manti](./ui-on-manti.md), [oxlint and oxfmt](./oxlint-and-oxfmt.md), and
[nobody writes their own exam](./nobody-writes-their-own-exam.md).

Built from [experiment 194](../../experiments/194-react-compiler.md), which read React's docs and
the tools and ran oxlint's React rules and the Compiler over today's window code;
[experiment 195](../../experiments/195-oxc-toolchain.md), which ran oxc's native port of the
Compiler on the same code, built `next/`'s window with it and ran it; and
[experiment 176](../../experiments/176-react-on-the-real-app.md), which compiled today's app on a
branch. Also a private page, "React Compiler guidelines", with a window whose components you can
break and compile. 194's probe and 195's spike are small, and 176 is one machine. None is a
benchmark.

```tsx
// A sketch. Today's tooltip (apps/fabrika/src/window/pop.tsx:675), in the shape this note asks.
// Today the Compiler skips it: "Cannot access refs during render" at :678.
export const useTip = (tip: Tip, quiet: boolean) => {
	const id = useId(); // C1, C2: was useRef(`tip-${Math.random()}`).current, read in render
	const [at, setAt] = useState<DOMRect | null>(null); // today's version only; in next/ the model holds it
	const shown = quiet ? null : at; // C1: derived in render, not set in an effect
	// show and hide, unchanged: refs are read only in handlers and effects (C2)
	return {on: {"aria-describedby": shown === null ? undefined : id /* ... */}, node: /* ... */ null};
};
```

```text
one build traced: the tooltip file, saved
oxlint             react/refs, react/immutability, react/display-name, one-store-hook: no finding
build              .tsx, so the bundler's plugin runs oxc's Compiler (oxc-transform-react) on it
compile step       reportDiagnostics: useTip compiled, Palette compiled, 0 skips, 0 purity findings
pnpm lint:compiler the same step, no bundle; compiler-ledger.json names no function; passes
DevTools           the components that use it show "Memo ✨"
today, before      useTip skipped ("Cannot access refs during render"), Palette skipped: 2 skips, fails
```

## Which version

- **`next/`:** all of it, from the first `.tsx` file. The rules and the skip check land in Tier 1's
  exam PR, and Rolldown with the Compiler in `build.ts` in PR A
  ([what changes in Tier 1](#what-changes-in-tier-1)).
- **Today's version (`apps/fabrika`, `programs/*`):** the same rules, as the owner's tryout. Two
  small tickets after ticket 117 ([today's app](#todays-app)). Today's app moves to Rolldown later,
  in ticket 177 (owner, 2026-11-02). What it teaches goes to `next/` as lessons, not copies.

## The six principles

React's "Rules of React" [r24] are the base. These six are what a window writer presses, with what
holds each one. C1 to C3 are React's own rules; C4 is ours; C5 and C6 are how we hold them.

### C1: render is pure, and a view never reads the clock

**Decided 2026-11-03.** A view never reads the clock; the time comes through a Cmd, and the purity
check blocks, with no setting. First decided 2026-11-02 (195, open call 2). Lean 80%, taken.

- **What it means:** the same props and the same model give the same output. No `Date.now()`,
  `new Date()`, `performance.now()` or `Math.random()` in a view, not in render and not in a
  handler the view makes. A view sends a Msg with no time. `update` asks for the time with a `now`
  Cmd, as Elm's `Time.now` does, and the answer lands in the model.

  ```ts
  // From experiment 195, part 4 (a sketch). The view: a press, no time.
  dispatch({type: "press", pid: tile.shows, m});
  // update keeps the rev the person saw, and asks for the time. The Cmd carries the press.
  press: (model, msg) => [model, [now({pid: msg.pid, m: withSaw(model, msg.pid, msg.m)})]],
  now_ok: (model, msg) => writeLetter(model, msg.cmd.pid, msg.cmd.m, msg.value),
  ```

- **Why:** "Components must be idempotent" and "Side effects must run outside of render" [r24].
  The Compiler caches a render's output; a clock read in render shows a stale time until a prop
  changes. 194: `now-in-render.tsx` compiles by default, and its time is cached. 195, part 4: with
  the clock out of the views, the native purity check has 0 false alarms in 8 findings, where it
  had 1 in 9 before (`Desk` passing a handler that read the clock down to `Tile`).
- **Linear:** no Linear answer: nothing public on the Compiler. An outside write-up says its state
  lives in MobX outside React (**secondary**), which fits a pure render.
- **Elm:** `view : Model -> Html Msg` is pure by type, and `Time.now` is a Task: `update` asks for
  it.
- **What holds it:** the Compiler's own purity check, `validateNoImpureFunctionsInRender: true`, in
  the build's compile step (C5). Every purity finding is an error that fails the build, in every
  repo, always; the only exit is C5's ledger row. Not built. oxlint's `react/purity` stays off, as
  194 had it, because the build's check covers it; that is not advice. Whether it now matches the
  build's check was not run.
- **Changed 2026-11-03: no strictness knob.** Experiment 195's call 2 (2026-11-02) put how strict
  this check is in each repo's `fabrika.toml`, `"error"` by default, with `"warn"` and `"off"`
  allowed. That knob is gone. The owner set the Compiler rules strict, with no advice, so there is
  nothing for a repo to set.
- **Doubt:** the check is narrower than the rule. 195's part 4 bench tiles read `new Date()`
  straight in their own click handler, and the check let them pass. A small lint rule, no `Date`,
  `Date.now` or `performance.now` in a view file, would make the rule whole; not written. Also,
  the purity check is an `environment` option that the React pages 194 read do not describe; a
  later version could rename it. The skip check's test plants a clock read, so a rename fails
  loudly.
- **Cost:** in `next/`, a `now` Cmd in the window machine: about 40 lines, and 1 in each view (195,
  part 4). Today, the 6 real findings in functions that compile are fixed before the check blocks
  there.
- **Today:** **breaks** in 8 places: `programs/tracker/src/window.tsx:406, 454, 575, 772, 797`,
  `apps/fabrika/src/window/frame.tsx:471, 554`, `pop.tsx:678`. 6 of the 8 functions compile; the
  other 2 are the two skips.

### C2: refs only in effects and handlers

**Decided 2026-11-03.** Lean, 85%.

- **What it means:** a ref holds something for later. Render never reads or writes `.current`. An
  id comes from `useId`.
- **Why:** "Reading or writing `ref.current` during render breaks React's expectations" [r25]; the
  Compiler skips the whole function.
- **Linear:** no Linear answer: nothing public.
- **Elm:** Elm has no refs; a DOM fact the view needs is in the model, from a port or a Sub.
- **What holds it:** `react/refs` blocks, in `next/**` and today's window and program `.tsx`
  files. 194: 1 of 1 right on main; 176: 1 of 1. The skip check holds it too: oxc's port skips
  `useTip` for it, as Babel's did (195).
- **Doubt:** n is 2. Every fire in the first `next/` landings is read by hand. A false alarm is a
  bug to fix in the rule or the code; the rule keeps blocking.
- **Cost:** none in `next/`. Today, one line.
- **Today:** **breaks** at `pop.tsx:678`.

### C3: nothing changes after render

**Decided 2026-11-03.** Lean, 85%.

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

**Decided 2026-11-03.** Lean, 85%.

*Changed 2026-11-05:* tea 0.23.0's `useRuntime` takes the Effect engine and a selector
([demlik PR 856](https://github.com/kamp-us/demlik/pull/856), [PR 859](https://github.com/kamp-us/demlik/pull/859)), so the one store hook is tea's
`useRuntime` and no `useModel` is written, as this note said it would go. `one-store-hook`'s import
half becomes: in `next/**`, `useSyncExternalStore` is imported nowhere. Its other half, a store
hook whose value is dropped, is unchanged and fires on `useRuntime`. `no-tea-react` was dropped on
2026-11-02, so the words below that it refuses tea's hooks are wrong.

- **What it means:** a window reads its model only through the one store hook (`useModel`, the
  stand-in until tea's own hook takes the Effect engine), and draws from the value it returns.
  Each part reads its own slice through a selector (C6). Never a module object read during render.
- **Why:** this is the one failure the Compiler does not report. Compiled, a component that calls
  the hook, drops its value and reads a module store keeps its first output forever. 176, pick 6:
  "the app never reaches its first prompt, even in 60 s". 194: the planted copy compiles with its
  output cached, and draws 0 lint findings from 24 rules. 195: oxc's port compiles it too, with no
  word.
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

### C5: the Compiler skips nothing that is not named, and the build owns the check

**Decided 2026-11-03.** The build owns the check; `pnpm lint:compiler` calls the same step; every
finding fails, and the ledger row is the only exit. First decided 2026-11-02 (195, open call 3).
Lean 85%, taken.

- **What it means:** one function compiles a file with oxc's Compiler and returns its findings:
  each function compiled or skipped, with the reason and the place, and each purity finding. The
  build calls it on every rebuild and in CI, and any finding fails the build. `pnpm lint` calls the
  same function with no bundle. The one way out of a finding is `"use no memo"` in that function,
  with a row in `compiler-ledger.json` that says why. The check fails on a directive with no row,
  and on a row with no directive. Adding a row is the owner's call, in a change of its own; the
  ledger starts empty and only shrinks, as `unreachable-ledger.json` does.

  ```ts
  // compiler-ledger.json: empty to start; a row is the owner's call, and rows only go away
  type Row = {readonly file: string; readonly fn: string; readonly why: string};
  ```

- **Why:** the Compiler skips silently [r3]. "Use no memo" is "a temporary debugging tool" and you
  should "Always document why" [r18], [r19]. Nobody adds their own exam
  ([the note](./nobody-writes-their-own-exam.md)). The industry's knob for a build that fails is
  the Compiler's [`panicThreshold`](https://react.dev/reference/react-compiler/panicThreshold)
  [r6], where `"all_errors"` fails the build on any diagnostic. Failing the build is our choice,
  so a finding is fixed or ledgered, never shipped quietly.
- **The clash, settled 2026-11-03:** React's `panicThreshold` docs recommend `"none"` for
  production builds. We fail every build, production too, on any finding, because the owner set
  the Compiler rules strict. Cost: a Compiler "Todo" blocks a merge until the code changes or the
  owner adds a row.
- **How it reads skips with no Babel (195, part 3):** the native port has no `logger`. With
  `reportDiagnostics: true` it returns each skip with its place. A function compiled if its body
  starts with `const $ = _c(n)`; a skip is the outermost function holding a diagnostic. The port
  reports UTF-8 byte offsets, so the step converts them (a small oxc bug to file). If a later
  version prints the cache another way, the count breaks loudly (0 compiled), not quietly.
  `oxc-transform-react` is pinned exact and bumped with oxlint, since both come from one
  repository.
- **Linear:** no Linear answer: nothing public, and no team found publishes how it blocks a skip.
- **Elm:** no Elm answer: Elm has no optimizer that can skip. The ledger is our dead-code ledger's
  shape.
- **What holds it:** the compile step and its test, which plants a skipped function, a named one,
  a directive with no row, a stale row, a clock read in render, and a clock read in a handler a
  view passes down (C1).
- **The false-alarm bar:** 2 of 2 skips on main were real breaks, each with a right lint finding
  inside, the same 2 in Babel's Compiler and oxc's (195). A Compiler "Todo" (syntax it cannot
  handle yet) would be a skip with nothing wrong in our code; none on main. That is the case the
  ledger is for. Sure of 0% false alarms: 70%, n is 2. A false alarm does not make the check
  advice: it is fixed in the check or the code, or the owner adds a row.
- **The check must read the directive itself:** a function with `"use no memo"` still gives a
  diagnostic and is not compiled (194 on Babel, 195 on oxc's port).
- **Doubt, 80% (195):** whether oxc's port supports `panicThreshold`. If not, our function reads
  the skip list and fails the build itself.
- **Cost:** about 120 lines for the step on the native engine and 80 for its planted test (195),
  and about 55 ms per run on today's 11 window files.
- **Today:** **breaks**: 2 functions skipped, nothing says so.

### C6: memoizing is the Compiler's job

**Decided 2026-11-03.** `next/`'s desk is way 3b, through our stand-in hook with a selector, with
no hand `memo`. First decided 2026-11-02 (195, open call 5). Lean 75%, taken.

*Changed 2026-11-05:* way 3b goes through tea 0.23.0's `useRuntime` with a selector, not a stand-in
([demlik 853](https://github.com/kamp-us/demlik/issues/853) closed). [Experiment
213](../../experiments/213-tea-react-select.md) ran it under Babel's Compiler on both engines:
three tiles, tile b clicked three times, drew a0 b3 c0, in 400 of 400 trials. The cost below, about
60 lines in the hook's file, is gone.

- **What it means:** new code writes no `useMemo`, `useCallback` or `memo` by default. The desk has
  no `memo` per tile. A tile's props are plain values: never a fresh handler or object made
  in render. Each tile, `App` and `Status` read their own part through the store hook
  with a selector, and each tile holds a send bound to itself, as Elm's `Html.map` does.

  ```tsx
  // Way 3b, from experiment 195, part 3 (a sketch). The tile reads and sends only its own part.
  const OwnTile = (props: {id; shows; x; y; w; h; folded; focused; own: TileHandle}) => {
  	const [data, send] = useRuntime(props.own); // the bench's narrow handle; decided: a selector
  	// ... draws `data`, and sends {type: "plus"} or {type: "focus"} through `send`
  };
  ```

- **Why:** "For new code, we recommend relying on the compiler for memoization" [r20]; "you can
  safely remove `React.memo`" [r22]. 195, part 2: on the slice as written, with a new arrow per
  tile, the Compiler saved nothing; with stable props a patch dropped from 21 renders to 13. Part 3:
  with way 3b, a patch costs 3 renders on 9, 30 and 60 tiles, with no hand `memo`. `memo` on top
  takes a focus move at 60 tiles from 65 renders to 7, at the same 0.15 ms: not worth a rule. A
  heavy tile does not tip it to `memo`.
- **Linear:** no Linear answer: nothing public.
- **Elm:** `Html.Lazy` is Elm's hand `memo`. The Compiler applies its equivalent to every component
  [r23], so the hand one is not needed. A tile's send bound to its own id is `Html.map`.
- **What holds it:** `react/display-name` blocks (176: 2 of 2 right; 0 on main, which has no
  `memo`). `memo(function X)` cannot stay: `pnpm format`'s `prefer-arrow-callback` fix turns it into
  an arrow (`.oxlintrc.json:149`), which `display-name` then refuses (194). The plain-values rule
  is a review point, or a lint rule later (195). No rule refuses `useMemo` or `useCallback`: a
  review reads them.
- **Doubt:** the time gaps are a tenth of a millisecond, so this rests on renders and on what a
  tile can reach, not on speed anyone feels. 195's narrow handle was a hand adapter around the
  hook, with fields filled only for the type and one that throws; a selector on our stand-in
  replaces it. [demlik 853](https://github.com/kamp-us/demlik/issues/853) asks tea's hook for a selector, and
  the stand-in goes when tea's lands. The tiles measured were counters, not real tiles.
- **Cost:** about 60 lines in the hook's file (`narrow`, `tileHandle`), and the desk passes a
  handle in place of data and `dispatch`. About 0.3 agent hours (195, part 3).
- **Today:** **follows**: main has no hand `memo`. `frame.tsx` has `useCallback`s, which stay
  (existing code keeps its memoization [r21]).

## The smaller calls

### How the build runs the Compiler

```ts
// A sketch, next/build.ts, from experiment 195. Rolldown builds; oxc's Compiler runs inside it.
import {rolldown} from "rolldown"; // 1.2.13, the version Alchemy already bundles Workers with
import {transformSync} from "oxc-transform-react"; // 0.156.0, oxc's Rust port of the Compiler

// The one step: the build and `pnpm lint:compiler` both call it, and read its findings (C5).
export const compile = (id: string, code: string) =>
	transformSync(id, code, {
		jsx: {runtime: "automatic"},
		reactCompiler: {reportDiagnostics: true, environment: {validateNoImpureFunctionsInRender: true}},
	});

const reactCompiler = {
	name: "react-compiler",
	transform: {
		filter: {id: {include: /\.tsx$/, exclude: /node_modules/}},
		handler(code: string, id: string) {
			const out = compile(id, code); // any finding fails here too; no knob, only a ledger row
			if (out.fatal) throw new Error(out.errors.map((e) => e.message).join("\n"));
			return {code: out.code, moduleType: "js"};
		},
	},
};
```

- **No Babel (owner, 2026-11-02).** The Compiler runs on oxc's native port,
  `oxc-transform-react`, "experimental" [r38], released weekly. On today's code it matches
  Babel's Compiler on every one of 108 functions' verdicts (195, part 1).
- **Lean, 85%, still a lean (195, open call 1): Rolldown as a library in `next/build.ts`, with the
  Compiler as the plugin above, for the window and for the Workers.** No Vite dev server and no
  Cloudflare Vite plugin. Why: `build.ts` already calls a bundler from code, and Alchemy bundles
  Workers with Rolldown, so the local instance and the cloud build with one tool. 195, part 2: PR
  223's own end-to-end test passes on a window built this way, in React's production build and in
  its development build with Strict Mode on; the first draw halves, and the window bundle is about
  half the size. Vite wins if the owner wants the dev server's hot reload over the brain's
  ([hot reload](./hot-reload.md)).
- **Cost:** `next/build.ts` moves from esbuild to Rolldown, about 60 lines changed; the plugin,
  about 20; three exact pins in the catalog: `rolldown`, `oxc-transform-react`, `oxc-parser`. About
  55 ms for the native Compiler on main's 11 files, against about 900 ms for Babel's.
- **Doubt:** a weekly 0.x port, run in a real window on 5 functions. That only shrinks as `next/`
  grows on it, with `lint:compiler`'s count and the end-to-end test as the alarms.
- **The yardstick is our planted files plus a real window run, not Babel** (owner, 2026-11-02;
  195, open call 4). The doubt stays: a rerun against Babel's experimental release would show
  whether the one false alarm was a version lag.
- **Today's app moves to Rolldown later, in ticket 177** (owner, 2026-11-02; 195, open call 6).
- The Compiler's defaults otherwise; no pick.

### Which rules are on

Every rule that is on blocks; no rule is set to `warn`. Each runs in oxlint 1.90.0, the version in
the lockfile.

| Rule | 194 on main, then 176 | Lean |
|---|---|---|
| `react/refs` | 1 of 1; 1 of 1 | block |
| `react/immutability` | 1 of 1; 1 of 1 | block |
| `react/display-name` | none; 2 of 2 | block |
| `one-store-hook` (ours) | 1 of 1, by a search | block |
| `react/purity` | 8 of 9, one wrong on PR 223 | off; the build's purity check holds C1 (0 of 8 wrong after 195, part 4) |
| `react/set-state-in-effect` | 1 of 2 | off |
| `react/exhaustive-effect-dependencies` | 0 of 7 | off; `react/exhaustive-deps` already blocks |
| the other Compiler-powered rules | no finding | off; the skip check holds what they find |

**Decided 2026-11-03.** Lean, 75%. Why: the skip check already fails on every skip, so a rule with
no data adds a second voice and no new catch. Since both now come from oxc, the rules say what
might skip, in the editor, and the check says what did (195). A rule that is off is off, never
advice; turning one on is a change of its own, as an error. Cost: a skip shows as a check failure,
not as a squiggle on the line. Doubt: the counts are tiny. Each fire in the first `next/` landings
is read by hand, and a false alarm is fixed in the rule or the code, never moved to advice.

### Where the rules apply today

**Lean, 85%:** one override in `.oxlintrc.json` for `apps/fabrika/src/window/**/*.tsx` and
`programs/*/src/**/*.tsx`, and one for `next/**/*.tsx`. Tests are left out: a test may plant a
broken component.

## What the ledger records

**Nothing new.** Which functions compiled is rebuilt from any commit by running the check again, so
no fact is lost. The `compiler-ledger.json` rows are files in git, with their history. The skip
check prints its counts in the pull request's checks.

## Today's app

The owner's tryout. From 176's real numbers and 194's and 195's counts on main. The ticket draft
is outside the repo until the owner files it.

- **Lean, 70%: two tickets, after ticket 117.** First the window code follows C1 to C4, with no
  build change. Then the Compiler in the build, the rules in `.oxlintrc.json`, and the skip check.
  Why two: compiling before the store hook lands freezes the app, so the order is the risk, and
  the first ticket is worth having alone. Cost: two lanes' overhead. Doubt: one lane could order
  the two tasks itself.
- **Ticket A:** the desk's one store hook (176, pick 2, about 30 edits); `Palette` numbers its rows
  before render; `useTip` takes `useId` and derives `quiet`; the time through the model, not the 8
  clock reads. About 120 to 180 lines and 60 to 100 test lines, 0.3 to 0.5 agent hours at 600 lines
  an hour.
- **Ticket B:** `oxc-transform-react` and `oxc-parser` in the catalog; the Compiler in the build on
  `.tsx` files only; the three rules and `one-store-hook`; `lint:compiler` and
  `compiler-ledger.json`. About 150 to 220 lines and 100 to 150 test lines, 0.4 to 0.6 agent hours,
  194's estimate, not redone. The move to Rolldown is ticket 177's.
- **Together:** about 10 files, 270 to 400 product lines, 0.7 to 1.1 agent hours, a `1` on the
  doubling scale. Sure: 55%.

## What changes in Tier 1

Decided with this note on 2026-11-03; the plan files say so in place.

- **The exam PR** gains the rules (`react/refs`, `react/immutability`, `react/display-name` and
  `one-store-hook`, blocking in `next/**/*.tsx`), `lint:compiler` on the compile step with its
  planted test under `next/apps/fabrika/src/exam/`, an empty `compiler-ledger.json`, and
  `oxc-transform-react` and `oxc-parser` in the catalog. Its PR body counts each fire on PR 223's
  tree: 194 found 0 for the three React rules, and 0 skips among 5 functions, which 195 repeated on
  oxc's port. `one-store-hook` is not written yet; PR 223 has no store hook to fire on.
- **PR A, T5:** the first `useModel`, under the rules, with a selector. *Changed 2026-11-05:* the
  first `useRuntime` from tea, with a selector; no `useModel`. **T6:** `build.ts` on
  Rolldown with the Compiler plugin, any finding failing the build, and the bundle time
  before and after in the PR body.
- **The window sketch** in Tier 1's detail has no `memo` per tile; the desk is way 3b (C6). PR B's
  T7 does not add `memo`.

## Where this differs from settled notes

- **The block bar in `AGENTS.md`** says a check needs about 0% false alarms, measured, to block,
  and up to 10% to advise. For the Compiler and the React rules here, the owner's 2026-11-03 call
  overrides it: they block from the start, as React's own rules, with no advice level. Their fires
  are still counted and read by hand; a false alarm is a bug to fix, not a step down to advice.
- **Experiment 195's call 2** (2026-11-02) set the purity check's strictness per repo in
  `fabrika.toml`. Replaced on 2026-11-03: no knob, every finding fails (C1).
- **Tier 1's window sketch** (`tier-1-detail.md`, "The window in React") had `memo` per tile,
  "Elm's Html.Lazy", approved with Tier 1 on 2026-11-01. It was dropped on 2026-11-02, and 195's
  way 3b takes its place.
- **194's leans** put Babel inside esbuild's `onLoad` and the skip check beside the build, with the
  build at `panicThreshold: "none"`. The owner's 2026-11-02 calls overrule both: no Babel, and the
  build owns the check.
- **194's C1** had time come from the model through a Sub. It now comes through a Cmd (195, part
  4).
- **176's write-up** blamed oxfmt for the `memo(function X)` clash. It is oxlint's
  `prefer-arrow-callback` fix, run by `pnpm format`.
- **176, pick 10** put `purity` among the rules that meet the block bar. PR 223's one false alarm
  moves oxlint's rule off; the build's check holds C1.

## What it costs

- In `next/`: four lint rows, one rule of ours (about 30 lines), the compile step and skip check
  (about 120) and its test (about 80), one ledger file, Rolldown in `build.ts` (about 60 lines
  changed) with the plugin (about 20), a `now` Cmd (about 40), the narrow tile handle (about 60),
  three packages.
- Build time on `.tsx` files: tens of milliseconds; about 55 ms on main's 11 window files.
- Today: the two tickets above, and ticket 177.

## What it cannot tell us

- Whether a compiled window is faster to a person. 176 and 195 counted renders; every way 195 timed
  stayed under 0.35 ms a patch at the median.
- False alarms past tiny counts: 2 skips, 8 purity findings, 1 or 2 fires per blocking rule. With
  no advice level, each false alarm blocks a merge until it is fixed or ledgered; how often that
  bites is not known.
- How often a weekly 0.x port is wrong on code bigger than 5 functions in a real window.
- Whether oxc's port supports `panicThreshold`.
- How the window behaves in Electron, and hot reload with the native Compiler: 195 ran a Chromium
  tab, and Fast Refresh was not tried.
- How other teams block a skip in CI, and what Linear does: nothing public was found.

[r3]: https://react.dev/learn/react-compiler/debugging
[r6]: https://react.dev/reference/react-compiler/panicThreshold
[r18]: https://react.dev/reference/react-compiler/directives/use-no-memo
[r19]: https://react.dev/reference/react-compiler/directives/use-no-memo
[r20]: https://react.dev/learn/react-compiler/introduction
[r21]: https://react.dev/learn/react-compiler/introduction
[r22]: https://react.dev/reference/react/memo
[r23]: https://react.dev/reference/react/memo
[r24]: https://react.dev/reference/rules
[r25]: https://react.dev/reference/eslint-plugin-react-hooks/lints/refs
[r38]: https://oxc.rs/docs/guide/usage/transformer/react-compiler
