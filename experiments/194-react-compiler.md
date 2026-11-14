---
date: "2026-11-02"
summary: "Reading plus a probe on main and PR 223. The makers agree: the Compiler skips rule breaks silently, the lint rules are the gate, the build stays at `panicThreshold: \"none\"`, `\"use no memo\"` is temporary and says why, and new code leaves memoizing to the Compiler. On main it compiles 103 of 105 functions and skips 2 in `pop.tsx`, each with a right lint finding inside; 176's \"5 failed\" are these 2. oxlint's `refs` and `immutability` were right 1 of 1, `purity` 8 of 8 on main but wrong once on PR 223's `main.tsx:146`, a clock read only a click calls; the Compiler's own purity check refused the 8 and passed that one. The desk's store read compiles, caches forever and draws no finding from 24 rules, so it needs a rule of ours. `memo(function X)` becomes an arrow under `pnpm format`'s `prefer-arrow-callback`, then fails `display-name`; `memo(TileView)` passes both. Babel with the Compiler took about 0.9 s on 11 files, esbuild's transform 18 ms. Feeds the proposed React Compiler note, six principles at 70% to 85%. No model, $0."
---

# React Compiler from day one: how do the makers keep an app compilable, and what does today's window break?

Read and run 2026-11-02. **This is reading plus one small probe, `194-react-compiler.ts`, kept.**
The probe runs oxlint 1.90.0's React rules and the React Compiler 1.0.0 over every window and
program `.tsx` file on main, and over a few planted files. No window was opened, no model was
called, and nothing in the app or the lint settings changed. It feeds
[React Compiler from day one](../docs/direction/react-compiler.md), a proposed note, and a private
page, "React Compiler guidelines", with a window whose components you can break and compile.

**Which version.** Every "today" claim is about today's app (`apps/fabrika`, `programs/*`) on main
at `ffc23872`. `next/` is read on [PR 223](https://github.com/usirin/tea-fabrika/pull/223)'s branch: two `.tsx` files, 250 lines.
It builds on [experiment 176](./176-react-on-the-real-app.md), which tried the Compiler on a branch
of today's app, and brings its write-up to main in the same pull request.

**Decided before this study (the owner, 2026-11-02):** `next/` is React Compiler compatible from
day one, and today's app follows the same guidelines too, as a tryout whose lessons go to `next/`.
The study's job is how.

## The answer

The makers agree on five things.

1. **The Compiler skips what breaks the rules, silently.** "When it encounters code that might
   break these rules, it safely skips optimization rather than risk changing your app's behavior"
   [r3]. Nothing fails unless you ask.
2. **The lint rules are the gate.** "When the ESLint rule reports an error, it means the compiler
   will skip optimizing that specific component or hook" [r28]. oxlint ports them: its React
   Compiler rules are "Powered by the React Compiler, which runs once per file" [r35].
3. **The build never stops on a skip.** "Production builds should always use `'none'`" [r6]; higher
   thresholds "are only useful during development for debugging" [r7]. A `logger` sees every
   `CompileError` and `CompileSkip` [r8].
4. **`"use no memo"` is temporary and says why.** "It's intended as a temporary debugging tool, not
   a permanent solution" [r18], and "Always document why" [r19].
5. **New code leaves memoizing to the Compiler.** "For new code, we recommend relying on the
   compiler for memoization" [r20]; "you can safely remove `React.memo`" [r22].

**Today's window follows most of it already, and breaks it in three ways.** The Compiler compiles
103 of 105 functions on main and skips 2, both in `pop.tsx`. Eight renders read the clock, which the
Compiler compiles anyway and would keep stale. And the desk's store read (`desk.tsx:802-803`)
compiles with no error and freezes the app, which no lint rule and no Compiler check catches: the
probe's planted copy compiled with its output cached forever and drew 0 lint findings.

```text
how each tool holds it
React        Compiler skips silently; eslint-plugin-react-hooks 7.x recommended reports each skip as a lint error [r26-r29]
oxlint       22 React Compiler rules, the Compiler vendored into oxc, 12 in correctness [r36, r37]
Next.js 16   reactCompiler stable and opt-in, Babel only on "relevant files" [r45, r46]
Vite         plugin-react 6 drops Babel; reactCompilerPreset with a file filter, or oxc's native Compiler, experimental [r41-r44]
Expo SDK 54  "React Compiler is now enabled in the default template" [r53]
Meta         Quest Store loads up to 12% faster, some interactions 2.5x [r1]; 100,000+ components [r52]
Sanity       20-30% more frames a second; never had to turn it off [r54]
Linear       nothing public found
```

## What was read

### React's own docs

| Source | What it says | Tag |
|---|---|---|
| React Compiler 1.0 post, 2025-10-07 | stable; the old lint plugin can go | [r1], [r32] |
| npm registry | `babel-plugin-react-compiler` `latest` is 1.0.0; `eslint-plugin-react-hooks` 7.1.1 | [r2] |
| Debugging | skips code that might break the rules | [r3] |
| `panicThreshold` | `none` (default), `critical_errors`, `all_errors`; production uses `none` | [r5]-[r7] |
| `logger` | `CompileSuccess`, `CompileError`, `CompileDiagnostic`, `CompileSkip`, `PipelineError`, `Timing`; "Event structure may change between versions" | [r8], [r9] |
| `compilationMode` | `infer` by default, by naming; `all` "Not recommended" | [r10]-[r13] |
| `"use memo"`, `"use no memo"` | rarely needed; the opt-out is temporary and documented | [r16]-[r19] |
| Introduction, `memo` | rely on the Compiler in new code; keep existing memoization | [r20]-[r23] |
| Rules of React | pure and idempotent, side effects outside render, props, state, hook values and JSX values immutable, hooks at top level | [r24] |
| `refs` rule | "Reading or writing `ref.current` during render breaks React's expectations" | [r25] |
| `eslint-plugin-react-hooks` | 17 rules, compiler diagnostics "automatically surfaced"; 7.0 turned all compiler rules on | [r26]-[r31] |
| Installation | the Compiler runs first among Babel plugins; DevTools shows "Memo ✨" | [r40], [r48] |

The docs disagree with themselves once: the installation page puts the compiler rules in
`recommended-latest`, the 1.0 post and the 7.0.0 changelog in `recommended` too. This study uses
the changelog.

### Tools and bundlers

| Source | What it says | Tag |
|---|---|---|
| oxlint rule pages | `react/purity`, `react/immutability` added in 1.79.0 | [r34], [r35] |
| oxc blog, 2026-08 | 22 React Compiler rules; the Compiler vendored into oxc; "more than 10 times faster than Babel", preliminary | [r36]-[r38] |
| React PR 36173, merged 2026-06-09 | "an experimental, work-in-progress port of React Compiler to Rust" | [r39] |
| `@vitejs/plugin-react` 6 | Babel is gone from the plugin; native Compiler support "experimental" | [r41]-[r44] |
| Next.js `reactCompiler` | Babel, only on relevant files; not on by default "as we continue gathering build performance data" | [r45]-[r47] |
| esbuild | no official plugin; Babel inside `onLoad` is the community way (**secondary**) | [r1] |

### Who runs it

Meta [r50]-[r52], Expo [r53], Sanity [r54] and Wakelet [r55] report it in production. Nobody
found says how they block a skip in CI: **not found**. Linear: **not found**, on the Compiler or on
React at all; an outside write-up says Linear keeps state in MobX outside React (**secondary**,
from experiment 176's study).

## The probe

`node experiments/194-react-compiler.ts --compiler <dir>`, where `<dir>` holds
`babel-plugin-react-compiler` 1.0.0 and `@babel/core` 7.29.7 installed outside the repo, as 176 did.
Results: `results/194-react-compiler.json`. One machine, one run each; times are a hint.

### Part 1: oxlint's React rules on main

24 rules: all 22 the oxc post counts, plus `display-name`, `rules-of-hooks` and
`no-unstable-nested-components`, over 11 files and 6,190 lines. Every finding read by hand.

| Rule | Findings | False alarms | Where |
|---|---|---|---|
| `purity` | 8 | 0 | `tracker` 406, 454, 575, 772, 797; `frame.tsx` 471, 554; `pop.tsx` 678 |
| `refs` | 1 | 0 | `pop.tsx:678` |
| `immutability` | 1 | 0 | `pop.tsx:575` |
| `set-state-in-effect` | 2 | 1 | `frame.tsx:939` on purpose; `pop.tsx:687` |
| `exhaustive-effect-dependencies` | 7 | 7 | each a dep kept on purpose |

The other 19 rules, `display-name` among them, had no finding. Main has no `memo`, so
`display-name` had nothing to read; 176's branch, which had one per tile, gave 2 of 2 true.

**On PR 223's `next/`,** `purity` fires once, at `main.tsx:146`, and it is a false alarm: `said`
reads the clock, but only a click calls it. The planted `said-in-handler.tsx` repeats it: it fires
when the handler goes through a component of ours and a helper, and not on a plain `onClick`. So
`purity` is 8 right and 1 wrong across both versions, 11%. That is over the block bar, and over
the advice bar too.

### Part 2: the Compiler on main

| What | Count |
|---|---|
| Functions compiled | 103 |
| Functions skipped | 2: `Palette` (`pop.tsx:514`, "Cannot reassign variable after render completes"), `useTip` (`pop.tsx:675`, "Cannot access refs during render", 4 events) |
| Skips with a true lint finding inside | 2 of 2: `immutability`@575; `refs`@678 |
| Babel with the Compiler, 11 files | about 0.9 s, three runs 879 to 931 ms |
| esbuild's own transform, same files | about 18 ms |

- **176's "5 failed" are these 2 functions.** The logger sends one event per diagnostic, so
  `useTip` counts four times.
- **The Compiler's own purity check, off by default:** with
  `environment: {validateNoImpureFunctionsInRender: true}` it refuses the same 8 clock reads (as 7
  functions) and does not refuse `said-in-handler.tsx`. So it holds the rule with 0 false alarms
  here, where oxlint's port had 1.
- **Without that check,** `now-in-render.tsx` compiles, and the time it shows is cached until a
  prop changes.
- Babel is about 50 times slower than esbuild per file here. 176 measured the whole `desk.js` at
  4.0 to 5.1 s against 0.4 s, under load.

### Part 3: the planted files

| File | Lint | Compiler |
|---|---|---|
| `frozen.tsx`: today's `desk.tsx:802-803`, the hook's value dropped and a module object read | none | compiled; its `<p>` cached forever |
| `one-hook.tsx`: the model read through the hook's value | none | compiled |
| `memo-function.tsx`: `memo(function Tile ...)` | `prefer-arrow-callback`, whose safe fix makes it an arrow | compiled |
| `memo-arrow.tsx`: what that fix gives | `display-name` | compiled |
| `memo-named.tsx`: `const TileView = ...; memo(TileView)` | none | compiled |
| `said-in-handler.tsx` | `purity`, wrong | compiled, also with the purity check |
| `now-in-render.tsx` | `purity`, right | compiled; refused with the purity check |
| `no-memo.tsx`: `"use no memo"` on a ref read in render | `purity`, `refs` | `CompileError` logged, not compiled |

Two more, checked by hand and not in the script: a clean function with `"use no memo"` logs one
`CompileSkip`, and a broken one with the directive logs a `CompileError` but does not throw even at
`all_errors`. So a check on the logger must look for the directive itself.

**The oxfmt clash is not oxfmt's.** `pnpm format` runs `oxlint --fix`, and
`eslint/prefer-arrow-callback` (`.oxlintrc.json:149`) turns `memo(function X)` into an arrow. Then
`display-name` fires. A named const passed to `memo` passes both.

## Today's tooltip

The running example is `useTip`, the tooltip hook in today's desk (`apps/fabrika/src/window/pop.tsx:675-727`).

| What | Today | Where |
|---|---|---|
| Its id | `useRef(\`tip-${Math.random()...}\`).current`, read in render | `pop.tsx:678` |
| Hiding when `quiet` | `setState` inside an effect | `pop.tsx:687-689` |
| Its state | `useState` for where it sits | `pop.tsx:676` |
| When the last one went | a module `let`, written in a handler | `pop.tsx:654`, `:682` |
| Compiled | no: skipped, "Cannot access refs during render" | `pop.tsx:675` |

Checked against each principle of the note:

| Principle | Tooltip |
|---|---|
| C1 render is pure | **breaks**: `Math.random()` in render (`:678`) |
| C2 refs only in effects and handlers | **breaks**: `.current` read in render (`:678`); `useId` fixes both |
| C3 nothing changes after render | **follows**; its neighbor `Palette` breaks it (`:575`) |
| C4 one store hook, its value used | **half**: its `useState` breaks Elm first, not the Compiler; the desk breaks C4 (`desk.tsx:802`) |
| C5 no skip goes unnamed | **breaks**: skipped, and nothing says so |
| C6 memoizing is the Compiler's | **follows**: no hand memo |

## What this tells us for fabrika

- **Two checks, not one.** The lint rules give a line and a reason in the editor; the Compiler run
  with its logger tells what the build really did. Both block. React's own route is the lint alone
  [r28]; we add the run because our build uses Babel's Compiler while oxlint uses oxc's copy, and
  they disagreed once here.
- **The freeze needs a rule of our own.** It is the worst failure seen (176, pick 6: the app never
  reaches its first prompt), and nothing upstream catches it. In `next/` the store hook lives in one
  file, so the rule is an import rule, with about no false alarms.
- **Purity belongs to the Compiler's check, not to oxlint's port,** on 9 findings.
- **Today's app is close.** Two skips, eight clock reads, one store read. Sized in the note.
- **The build cost stays small by compiling only `.tsx` files,** as Next.js and Vite's filter do.

## What it cannot tell us

- Whether the compiled app is faster. 176 found fewer renders, not milliseconds you can feel.
- How the oxc copy of the Compiler and Babel's differ beyond the one purity case. One case is not a
  rate.
- False alarms for the 19 rules with no finding. 6,190 lines gave them nothing to misfire on.
- Anything about the 22-rule count past what the oxc post says: the installed binary lists the
  rules, not their origin.
- How any team blocks a skip in CI: nobody published it.
- Linear's practice.
- Build time on a quiet machine with the whole bundle; the probe times the transform only.

$0. No model was called. The Compiler and Babel were installed from npm's local cache into a
scratch folder, outside the repo, and the probe changes nothing in it.

## Links

- [r1] https://react.dev/blog/2025/10/07/react-compiler-1
- [r2] https://registry.npmjs.org/babel-plugin-react-compiler
- [r3] https://react.dev/learn/react-compiler/debugging
- [r4] https://react.dev/reference/eslint-plugin-react-hooks
- [r5], [r6], [r7], [r49] https://react.dev/reference/react-compiler/panicThreshold
- [r8], [r9] https://react.dev/reference/react-compiler/logger
- [r10] to [r13] https://react.dev/reference/react-compiler/compilationMode
- [r14], [r15] https://react.dev/reference/react-compiler/configuration
- [r16], [r17] https://react.dev/reference/react-compiler/directives/use-memo
- [r18], [r19] https://react.dev/reference/react-compiler/directives/use-no-memo
- [r20], [r21] https://react.dev/learn/react-compiler/introduction
- [r22], [r23] https://react.dev/reference/react/memo
- [r24] https://react.dev/reference/rules
- [r25] https://react.dev/reference/eslint-plugin-react-hooks/lints/refs
- [r26], [r27] https://react.dev/reference/eslint-plugin-react-hooks
- [r28], [r40], [r48] https://react.dev/learn/react-compiler/installation
- [r29] to [r31] https://github.com/facebook/react/blob/main/packages/eslint-plugin-react-hooks/CHANGELOG.md
- [r33] https://www.sanity.io/docs/help/react-compiler.md
- [r34], [r35] https://oxc.rs/docs/guide/usage/linter/rules/react/purity
- [r36] to [r38] https://oxc.rs/blog/2026-08-18-react-compiler-support
- [r39] https://github.com/facebook/react/pull/36173
- [r41] to [r43] https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/CHANGELOG.md
- [r44] https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md
- [r45] https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler
- [r46] https://nextjs.org/blog/next-16
- [r50] see [r1]
- [r51] https://react.dev/blog/2024/02/15/react-labs-what-we-have-been-working-on-february-2024
- [r52] https://react.dev/blog/2024/10/21/react-compiler-beta-release
- [r53] https://expo.dev/changelog/sdk-54
- [r54] https://github.com/reactwg/react-compiler/discussions/33
- [r55] https://github.com/reactwg/react-compiler/discussions/52

Quotes were read through a fetch tool that passes pages through a summarizer, so a quote may differ
from the live page by a word.
