---
date: "2026-11-02"
summary: "Both versions, read and run; part 1 opened no window, part 2 ran `next/`'s. Cloudflare employs VoidZero's company and staff since 2026-06-04; the projects stay MIT and community-led, so it does not own them. One native Compiler is usable: `oxc-transform-react`, experimental, weekly. On main it compiles 103 of 105 functions and skips `Palette` and `useTip`, as Babel does; `next/` on PR 223 is 5 and 0. All 108 verdicts match Babel, 106 cache sizes, 105 codes. The skip check runs with no Babel: diagnostics carry a place, a parse names the function. About 55 ms for 11 files against Babel's 900; the window bundle stays at 200 to 330 ms every way. Its purity check carries oxlint's handler false alarm. Lean for `next/`: Rolldown from code with a 20-line Compiler plugin, no Vite dev server, 75%. For today's app: esbuild with the Compiler in `onLoad`, 85%. **Part 2, `next/` only:** the window built with Rolldown and the oxc Compiler runs right: PR 223's end-to-end test 3 of 3 on React's production build and 1 of 1 on its development build with Strict Mode, no console error, 5 compiled and 0 skipped, the compiled code is what runs, and Rolldown's brain and programs ran in workerd too. Nothing in the port broke. Page open to first draw 114 ms against 228 (median of 24 runs each); the window bundle 351 KB against 664 KB and each program 77 KB against 272 KB, mostly Effect shaken harder. The tile `memo`, on a 3 by 3 desk: on the slice as written nothing skips, compiled or not (21 renders a patch), since the desk passes new handlers; with stable props the Compiler skips a tile's inside (13), never the tile function; a hand `memo` skips nothing until the tile gets plain values (5). Lean for C6, 70%: no hand `memo`, plus a rule that a tile gets plain values and `dispatch`. The Rolldown lean goes to 85%. **Part 3, desks of 9, 30 and 60, timed:** tiles that read their own view through tea's hook on a narrow handle, with `App` and `Status` narrowed too, cost 3 renders a patch on every desk (the tile, its counter view, the status line); `flat` with no memo costs 13, 34, 64, and memo 5. Narrowing only the tiles saves nothing, since `App` still reads the whole model. Every patch median is 0.14 to 0.31 ms, p95 under 0.62; memo's 5 renders take the same time as 64, and only the narrow shape is faster (0.17 against 0.27 ms at 60). A heavy tile changes nothing: the Compiler caches its work on its data. In the narrow shape a tile sees only its own data and sends only `plus` or `focus` about itself. tea 0.21.0's and 0.22.0's hook take no selector, so the narrow handle fills 5 fields the hook never calls. Lean: the narrow shape, no hand memo, 75%. **Part 4, a view never reads the clock:** a press goes in with no time and the window machine asks for it with a `now` Cmd (tea's Effect `Cmd.define`, Effect's `Clock`), as Elm's `Time.now` does. The native purity check goes from 1 finding in `next/` (a false alarm) to 0; `now-in-render.tsx` is still refused; overall 8 findings, 0 false alarms. The check is narrower than the rule: a clock read straight in a click handler passes, so a lint rule should sit beside it. Render counts do not move (21, 13, 5, 3); e2e 1 of 1, vitest 67 of 67. Open call 2's lean becomes purity blocks, 80%. **Decided 2026-11-02, none built yet:** the desk is 3b through our stand-in hook with a selector (demlik 853 asks tea for one); views never read the clock and purity can block, once main's 6 real findings are fixed; how strict is a `[lint]` setting in each repo's `fabrika.toml` under React's rule name, `error` by default; the build owns the check and `lint:compiler` calls the same function; the yardstick is our planted files plus a real window run; today's app moves to Rolldown later (ticket 177), and Rolldown for `next/` stays a lean, 85%."
---

# The React Compiler with no Babel: which toolchain, and does it hold 194's numbers?

Read and run 2026-11-02. **Reading plus one spike, `195-oxc-toolchain.ts`, kept.** The spike runs
oxc's Rust port of the React Compiler over every window and program `.tsx` file on main and over
`next/`'s two on [PR 223](https://github.com/usirin/tea-fabrika/pull/223), holds each function
against Babel's Compiler, and times the window's bundle five ways. No window was opened, no
model was called, nothing in the app changed. It answers the open question in experiment 194
([PR 320](https://github.com/usirin/tea-fabrika/pull/320)) after the owner ruled out Babel.
**[Part 2: a real window](#part-2-a-real-window)**, the same day, built `next/`'s window this way
and ran it, and measured 194's tile `memo` question on it.
**[Part 3: a bigger desk, timed](#part-3-a-bigger-desk-timed)** tried a third way to draw tiles,
on desks of 9, 30 and 60, and timed each patch.
**[Part 4: a view never reads the clock](#part-4-a-view-never-reads-the-clock)** took the purity
check's one false alarm away the Elm way, so the check can block.

**Which version.** "Today" and "main" mean today's app (`apps/fabrika`, `programs/*`) at
`d691f694`. `next/` means PR 223's branch at `7c1d0730`. **Decided before this study (the owner,
2026-11-02): no Babel in the build.** This study does not weigh a Babel path. Babel appears only as
the yardstick, installed in a scratch folder outside the repo, as 194 ran it.

```ts
// The whole idea, for next/: Rolldown builds, oxc's Compiler runs inside it on our .tsx files.
import {rolldown} from "rolldown"; // 1.2.13, the version Alchemy already bundles Workers with
import {transformSync} from "oxc-transform-react"; // 0.156.0, oxc's Rust port of the Compiler

const reactCompiler = {
	name: "react-compiler",
	transform: {
		filter: {id: {include: /\.tsx$/, exclude: /node_modules/}},
		handler(code: string, id: string) {
			const out = transformSync(id, code, {jsx: {runtime: "automatic"}, reactCompiler: {}});
			if (out.fatal) throw new Error(out.errors.map((e) => e.message).join("\n"));
			return {code: out.code, moduleType: "js"};
		},
	},
};
const bundle = await rolldown({input: "src/window/main.tsx", platform: "browser", plugins: [reactCompiler]});
```

## Decided

**Decided 2026-11-02, by the owner, on the open calls below. None of it is built yet.** Each lean
keeps its number as written; the details are in [open calls](#open-calls-with-leans).

- **The desk shape is 3b** ([open call 5](#open-calls-with-leans)): each tile, `App` and `Status`
  read their own part through our stand-in hook with a selector. [demlik
  853](https://github.com/kamp-us/demlik/issues/853) asks tea's hook for a selector.
- **A view never reads the clock; the time comes through a Cmd, and the purity check can block**
  ([open call 2](#open-calls-with-leans)). The 6 real findings on main, in functions that compile,
  are fixed before the check blocks there.
- **How strict is a setting in each repo's `fabrika.toml`,** under React's own rule name and ESLint's
  severity words. The repo running the code decides. *Replaced 2026-11-03: the owner set the
  Compiler rules strict, so there is no knob; every finding fails the build, and the only exit is
  an owner-approved `compiler-ledger.json` row ([the note](../docs/direction/react-compiler.md)).*
- **The build owns the check** ([open call 3](#open-calls-with-leans)). One function compiles a file
  and returns its findings; the build and `pnpm lint:compiler` both call it.
- **The yardstick is our planted files plus a real window run, not Babel**
  ([open call 4](#open-calls-with-leans)).
- **Today's app moves to Rolldown later,** in ticket 177 ([open call 6](#open-calls-with-leans)).
  Rolldown for `next/` stays a lean, 85% ([open call 1](#open-calls-with-leans)).

## The answer

1. **Ownership: right about the company, wrong about the projects.** On 2026-06-04 Cloudflare
   wrote "VoidZero, the company behind Vite, Vitest, Rolldown, Oxc, and Vite+, is joining
   Cloudflare" and "all team members of VoidZero are joining Cloudflare, too" [s1]. The word is
   "joining", with no deal terms. The projects are not Cloudflare's: they "will remain open-source
   and MIT-licensed" [s2], and "Vite's roadmap continues to be driven by the broader Vite team and
   community" [s1]. So Cloudflare employs the people who lead the stack. Alchemy is not part of
   it: no Cloudflare ownership or backing was found [s3].
2. **One native Compiler is usable today: `oxc-transform-react` 0.156.0.** It is oxc's own port,
   "experimental" [s5], released weekly since 2026-08-08, and the engine behind
   `@vitejs/plugin-react` 6.x's `compiler: true` [s6]. swc has one too
   (`jsc.transform.reactCompiler`, `@swc/core` 1.15.43 and later) [s8], but nothing in our stack
   uses swc. React's own Rust port has "No builds available yet" [s7].
3. **On our code it matches Babel, function for function.** Main: 103 of 105 functions compile and
   2 skip (`Palette`, `useTip`), the same as 194. `next/`: 5 compile, 0 skip. Every one of the 108
   gets the same verdict as Babel's. 106 of 108 get the same cache size, and 105 the same code.
4. **The skip check runs without Babel.** The native Compiler has no logger, but with
   `reportDiagnostics: true` it returns each skip with its place in the file. A parse names the
   function. The check found the same two skips, and its three planted rules each fired.
5. **It is fast enough to stop counting.** Over main's 11 files: about 55 ms for the native
   Compiler, types and JSX in one pass, against about 900 ms for Babel's Compiler pass alone, and
   about 13 ms for esbuild with no Compiler. The whole window bundle stays between 200 and 330 ms
   every way it was built.

6. **Part 2: a window built this way runs right.** PR 223's own end-to-end test passes on it,
   in React's production build and in its development build with Strict Mode on, with no console
   error. Rolldown built the brain and both programs too, and they ran in workerd. The first draw
   halves, and the window bundle is about half the size.
7. **Part 2: the tile `memo` question has a split answer.** On a 3 by 3 desk, the Compiler alone
   skips what is inside a tile that did not change, but only once the tile gets stable props, and
   it never skips the tile function itself. A hand `memo` skips nothing until the tile's props are
   plain values. Details in [the tile memo](#the-tile-memo).
8. **Part 3: tiles that read their own state cost 3 renders a patch, on any desk size.** It
   works only once the top of the window stops reading the whole model too. Then only the tile
   that changed, its counter view and the status line run. Every way stays under 0.35 ms a patch
   at the median, so the case for it is renders and what a tile can reach, not time you can feel.
9. **Part 4: with the clock out of the views, the purity check has 0 false alarms.** A view
   dispatches a press with no time; the window machine asks for the time with a `now` Cmd, as Elm's
   `Time.now` does, and stamps `said` when it comes back. `next/` goes from 1 finding (a false
   alarm) to 0. `now-in-render.tsx` is still refused. Render counts do not move.

**Lean for `next/`, 85% after part 2 (was 75%): Rolldown as a library in `next/build.ts`, with the
Compiler as the 20-line plugin above, for the window and for the Workers. No Vite dev server and no
Cloudflare Vite plugin.** Vitest stays as it is. Why, cost and doubt are in
[the toolchain](#the-toolchain-what-the-makers-say-then-the-lean).

**Lean for today's app, 85%: keep esbuild and put the same Compiler in an `onLoad` plugin on the
window bundle only.** About 25 lines, no new bundler, and the four Node bundles do not change.

## What was read

| Source | What it says | Tag |
|---|---|---|
| Cloudflare blog, 2026-06-04, edited 2026-07-15 | VoidZero and all its staff join Cloudflare; the projects "stay open source, vendor-agnostic, and community-driven" | [s1] |
| VoidZero blog, 2026-06-04 | the five projects stay MIT; Vite+ went MIT too | [s2] |
| Alchemy README, no date | Apache-2.0; the one sponsor named runs its CI | [s3] |
| oxc blog, 2026-08-18 | the Compiler "remains in a separate optional package"; it "conforms to the latest experimental release of babel-plugin-react-compiler"; 100k+ files compiled "to the same output" | [s4] |
| oxc docs, React Compiler, no date | "This feature is experimental"; "Oxc vendors and maintains the compiler in-tree" | [s5] |
| `oxc-transform-react` 0.156.0 README and types, read from the package | no `logger`; `reportDiagnostics` gives "skipped functions, rule suppressions, lint findings"; a `workerd` WebAssembly export | [s5b] |
| `@vitejs/plugin-react` 6.2.1 README, changelog and code; 6.1.2 run | `compiler: true` uses `oxc-transform-react`, "experimental", since 6.1.0 (2026-08-19); peer range `>=0.152.0 <0.157.0`; the Compiler is skipped for server builds | [s6] |
| React PR 36173, merged 2026-06-09 | "No builds available yet"; sample crates for oxc and swc | [s7] |
| swc docs, no date | `jsc.transform.reactCompiler`, `@swc/core` 1.15.43 or later | [s8] |
| Next.js docs, updated 2026-10-02 and 2026-06-29 | `reactCompiler` "runs through a Babel plugin"; a Rust Compiler only behind an experimental Turbopack flag | [s9] |
| electron-vite 6.0.0 changelog, 2026-10-15 | moves to Vite 8; its docs still say 5.0 | [s10] |
| Electron Forge 8.0.1 release, 2026-09-29 | "The Vite plugin is promoted to stable… It now targets Vite 8" | [s11] |
| Cloudflare Vite plugin docs, updated 2026-10-18; 2.0 beta notes, 2026-10-15 | Worker code "runs inside a local workerd process"; 2.0 apps deploy with `cf deploy`, not Wrangler | [s12] |
| Alchemy docs, no date | its Vite tutorial is "not compatible with `@cloudflare/vite-plugin`"; local dev runs Workers in workerd, "No cloud calls" | [s13] |
| tsdown docs, 0.23.4 | Rolldown's own library bundler | [s14] |
| Vite 8 migration guide | "Oxc is now used for JavaScript transformation instead of esbuild" | [s15] |

Every npm version was read from the registry on 2026-11-02. The web pages were read through a fetch
tool that passes pages through a summarizer, so a quote may differ from the live page by a word.
A conformance percentage for the oxc port: **not found**. The only number seen, 1,635 of 1,717
fixtures, is from an early React PR commit (2026-03-21) and is stale.

## The native Compilers, side by side

| Compiler | Version | Who ships it | Maturity | Matches Babel? |
|---|---|---|---|---|
| `oxc-transform-react` | 0.156.0, weekly | oxc (VoidZero, now at Cloudflare) | "experimental" [s5] | 108 of 108 verdicts here; claims the experimental Babel release's output [s4] |
| oxlint's React rules | 1.90.0 | oxc, same repository | rules on by choice | 194: 9 findings, 1 false alarm |
| `@vitejs/plugin-react` `compiler` | 6.2.1 (6.1.2 run) | Vite | "experimental" [s6] | the same engine as the first row |
| swc `reactCompiler` | `@swc/core` 1.15.43+ | swc | not marked experimental [s8] | not run: no swc in our stack |
| React's Rust port | none on npm | React team | "work-in-progress", no builds [s7] | cannot be run |

Not in Rolldown's built-in transform, not in `oxc-transform`, not in Vite's `oxc` option:
"rather than adding it to Vite or Rolldown" [s4]. Checked in the installed Rolldown 1.2.13 too.

## The spike

`env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 19 node
experiments/195-oxc-toolchain.ts --babel <dir> --bundle`. The native tools come from this
experiment's own workspace package, `195-oxc-toolchain/`, pinned exact. `<dir>` holds
`babel-plugin-react-compiler` 1.0.0 and `@babel/core` 7.29.7, outside the repo. Results:
`results/195-oxc-toolchain.json`. One laptop, with another code agent running; times are a hint.

### Part 1: the verdicts

How a function is counted: compiled if its body starts with `const $ = _c(n)`, on both outputs,
read by a parse. Skipped if a diagnostic sits inside it and it did not compile. Babel's logger
sends four events for `useTip`; this counts functions, not events, as 194 did.

| | Main, native | Main, Babel | `next/`, native | `next/`, Babel |
|---|---|---|---|---|
| Files, lines | 11, 6,190 | same | 2, 252 | same |
| Compiled | 103 | 103 | 5 | 5 |
| Skipped | 2: `Palette` ("Cannot reassign variable after render completes", `pop.tsx:575`), `useTip` ("Cannot access refs during render", `pop.tsx:678`) | the same 2 | 0 | 0 |
| Same verdict | 105 of 105 | | 5 of 5 | |
| Same cache size | 101 of 103 | | 5 of 5 | |
| Same code, white space and types aside | 100 of 103 | | 5 of 5 | |

The three that differ, each read by hand:

- **`TopBar` (`frame.tsx`), 93 slots against 92.** The native one also watches
  `asks?.asks.filter` beside `asks?.asks`. One extra comparison, still correct, a little slower.
- **`Drawn` (`markdown/window.tsx`), 43 against 42.** In the `table` case the two group the
  memoized values differently. Both cache on the same inputs.
- **`Bar` (`map/window.tsx`).** Only a hoisted helper's name: `_temp10` against `_temp0`.

oxc says it matches the Compiler's latest **experimental** release [s4]; the yardstick here is
1.0.0, the `latest` tag. So some of these may be the Compiler moving on, not oxc drifting. Not
checked.

### Part 2: the purity check and the planted files

With `environment: {validateNoImpureFunctionsInRender: true}`, both refuse the same 8 functions on
main: `AsksList`, `ItemLines` (`frame.tsx`), `AskBox`, `HeadLine`, `ListPage`, `TimelineRow`
(`tracker`), and the two that skip anyway. **On `next/` they part:** the native check refuses
`Desk` in `main.tsx`, where `said` reads the clock inside a click handler; Babel does not. It is the
false alarm oxlint's `purity` gave in 194, and the planted `said-in-handler.tsx` repeats it. So the
native check carries oxlint's false alarm, which makes sense: oxlint's rules come from the same
oxc repository.

| Planted file (194's) | Native | Babel |
|---|---|---|
| `frozen.tsx`, the desk's store read | compiles, 1 slot | the same |
| `memo-function.tsx` | compiles, 2 slots | the same |
| `now-in-render.tsx` | compiles, 2 slots; refused with the purity check | the same |
| `said-in-handler.tsx`, with the purity check | **refused** | compiles, 9 slots |
| `no-memo.tsx`, `"use no memo"` | not compiled, one diagnostic | the same |
| `ref-in-render.tsx` | skipped, "Cannot access refs during render" | the same |

The freeze 194 found still compiles with no word from either. The `one-store-hook` rule 194 planned
is still needed.

### Part 3: the skip check, with no Babel

194's design: the check runs the Compiler as the build does and fails on any skip. The only exit is
`"use no memo"` plus a row in `compiler-ledger.json`. A directive with no row fails, and a row with
no directive fails. Natively it is:

```ts
// What the spike runs (part 3), in short. `functionsOf` is a parse with oxc-parser 0.151.0.
const out = transformSync(file, text, {jsx: "preserve", reactCompiler: {reportDiagnostics: true}});
const compiled = compiledIn(out.code); // functions whose body starts with `const $ = _c(n)`
const skipped = out.errors
	.map((e) => outermost(functionsOf(file, text), utf16(text, e.labels[0].start)))
	.filter((fn) => fn !== null && !compiled.has(fn.name));
```

What it printed, with two planted ledger rows (one with its directive, one without):

```text
apps/fabrika/src/window/pop.tsx Palette: skipped: Cannot reassign variable after render completes (line 575)
apps/fabrika/src/window/pop.tsx useTip: skipped: Cannot access refs during render (line 678)
ref-in-render.tsx Tip: skipped: Cannot access refs during render (line 3)
ref-in-render.tsx Tip: a row with no "use no memo"
```

`no-memo.tsx`, with its directive and its row, passed. Three things the Babel version did not need:

- **No `logger`.** The native binding takes no callbacks [s5b], so there is no `CompileSuccess`
  event. Compiled functions are read from the output instead. If a future version prints the cache
  another way, the count breaks loudly (0 compiled), not quietly.
- **No function name.** A diagnostic carries a place, not a name. The outermost function holding it
  is the one the Compiler skipped, since it compiles top-level components and hooks only.
- **Byte offsets.** `oxc-transform-react` 0.156.0 reports UTF-8 byte offsets, while JavaScript
  strings count UTF-16 units. 8 of the 11 files on main hold a non-ASCII character, so the check
  converts. oxc-parser itself reports UTF-16. A small bug to file with oxc.

**Is there an oxlint rule set for the Compiler's rules? Yes,** the 22 rules 194 read, in oxlint
1.90.0. They give the line and reason in the editor; the check above says what the build did. 194
kept both because Babel's engine and oxlint's could disagree. Now both are oxc's, so that reason
is gone. The check still earns its place: a lint finding is not a skip, and only the build knows
what it skipped.

### Part 4: time

| What | Median | Bytes |
|---|---|---|
| Transform, 11 files: native Compiler, types and JSX | 53 to 60 ms | |
| Transform, 11 files: Babel's Compiler pass alone | 855 to 983 ms | |
| Transform, 11 files: esbuild, no Compiler | 12 to 14 ms | |
| Window bundle: esbuild, as today | 195 to 266 ms | 3,081,494 |
| Window bundle: esbuild with the native Compiler in `onLoad` | 212 to 324 ms | 3,142,530 |
| Window bundle: Rolldown 1.2.13 | 203 to 235 ms | 2,636,647 |
| Window bundle: Rolldown with the Compiler plugin | 248 to 273 ms | 2,697,424 |
| Window bundle: Vite 8.3.2, `@vitejs/plugin-react` 6.1.2, `react({compiler: true})` | 277 to 304 ms | 2,669,192 |
| Today's whole `apps/fabrika` build, five bundles | 0.93 to 1.02 s | |

Each range is the medians of three or four runs of the script, on a busy laptop. The Vite row runs
`@vitejs/plugin-react` 6.1.2, not 6.2.1: 6.2.1 came out today, inside pnpm's minimum release age,
so the lockfile refuses it. 6.1.2 asks for `oxc-transform-react` 0.152 and got 0.156; its build
still compiled the window. The Compiler costs tens of milliseconds on the window
bundle, every way. Babel would have cost about 0.9 s. Every Compiler build compiled the same 103
functions. Rolldown's bundle is about 440 KB smaller than esbuild's, with the WebAssembly in both
three times. Why: **not found**. Better tree shaking is a guess, not checked. Nothing here loaded
either bundle in a window.

## The toolchain: what the makers say, then the lean

**What the makers recommend.** For a React app, Vite 8 with `@vitejs/plugin-react` and
`compiler: true` [s6]. For Electron, Vite again: electron-vite 6 [s10], or Electron Forge 8's Vite
plugin, stable since 2026-09-29 [s11]. For Workers, Cloudflare's Vite plugin runs workerd inside
`vite dev` [s12]. For a library, tsdown [s14]. Tests, Vitest on Vite 8, which already transforms
with oxc and not esbuild [s15].

**Where the plain way clashes with what `next/` settled.** Three lines:

- [Hot reload](../docs/direction/hot-reload.md): "a window does not take code from Vite". The
  hands bundle a program, the brain serves it by hash, and the window imports it. A dev server's
  hot reload is the job the brain already does.
- [The cloud is one more host](../docs/direction/the-cloud-is-one-more-host.md): the local stage is
  Alchemy's, and Alchemy's own Vite guide is "not compatible with `@cloudflare/vite-plugin`"
  [s13]. Its Workers bundle with Rolldown already (171).
- [The daily moment comes first](../AGENTS.md#changing-the-product): a design that needs a second
  server to start fails. `vite dev` beside the brain is one.

So the maker way fits a web app with a dev server. `next/` is not built that way, and moving to
Vite would undo the hot reload note. The owner may want that; it is a call to make in the open.

**Lean for `next/`, 85% after part 2 (75% before it): Rolldown as a library, the Compiler as a
plugin, one bundler for everything `next/build.ts` makes.**

- **Why:** `next/build.ts` already calls a bundler from code (esbuild today) for the brain, the
  window and each program. Rolldown does the same job with the same shape, and it is what Alchemy
  bundles Workers with, so the local stage and the cloud deploy build with one tool. Its plugin
  filter runs in Rust, so `.ts` files never cross into JavaScript. The plugin is the 20 lines on
  top, and the same function `pnpm lint:compiler` calls, so the check reads the build's own
  output.
- **Electron:** the window is a page. Main and preload are small Node bundles, which Rolldown
  builds with `platform: "node"`. Forge's Vite plugin waits until packaging is a real job.
- **Cost:** `next/build.ts` moves from esbuild to Rolldown, about 60 lines changed. The plugin, about
  20. `lint:compiler` on the native engine, about 120, plus a planted test of about 80. Three exact
  pins in the catalog: `rolldown`, `oxc-transform-react`, `oxc-parser`. About 0.5 to 0.8 agent
  hours, a little over 194's Ticket B (0.4 to 0.6), which it replaces.
- **The doubt, and what settles it:** the Compiler is experimental and releases weekly at 0.x.
  Here it matched Babel on 108 functions, but nobody has run a window built this way. PR 223's
  end-to-end run with a compiled window settles the first part. For the second: bump
  `oxc-transform-react` with oxlint, since they come from one repository, and let `lint:compiler`'s
  count be the alarm.
- **After part 2:** the first part is settled. The compiled window passed PR 223's end-to-end
  test, and the Workers built by Rolldown ran in workerd. What is left is the second part, a
  weekly 0.x port, on a slice of 5 functions. That doubt only shrinks as `next/` grows on it, with
  `lint:compiler`'s count and the end-to-end test as the alarms. Hence 85%, not more.
- **Not now:** Vite for `next/`'s window (it undoes the hot reload note); `@cloudflare/vite-plugin`
  (Alchemy's local stage is chosen, and the two do not mix); swc (a second engine beside oxlint's);
  React's port (nothing to install).

**Lean for today's app, 85%: esbuild stays, with the Compiler in one `onLoad` plugin on the window
bundle.**

- **Why:** today's version only takes fixes and tryouts, and it is deleted when `next/` takes over.
  The four Node bundles hold no React. Moving all five to Rolldown is porting work that gets thrown
  away.
- **Cost:** about 25 lines in `bundles.ts`, and `src/bundles.test.ts` already builds the bundles the
  same way. About 0.2 to 0.3 agent hours. The same `lint:compiler` serves both versions.
- **The doubt:** an `onLoad` plugin replaces esbuild's own TypeScript and JSX handling for those
  files. The spike built the bundle, but the app was not started with it.

## Open calls, with leans

1. **`next/`: Rolldown from code, or Vite 8?** Lean Rolldown, 85% after part 2, as above. Vite wins if
   the owner wants the dev server's hot reload over the brain's. **Not decided 2026-11-02:** it
   stays the lean, 85%, as written.
2. **Purity: 194 gave it to the Compiler's own check, with 0 false alarms.** That was Babel's
   check. The native one had the false alarm oxlint's `purity` had in 194 (1 of 9 findings, 11%).
   The lean was "advises", 70%. **After part 4 the lean is: purity blocks, 80%.** With the clock
   out of the views, the native check has 0 false alarms in 8 findings, under the 0% a block needs
   (Google, CACM 2018). The false alarm is gone by the rule "a view never reads the clock", not by
   a fix in oxc, so nothing waits on oxc. The doubt: the check is narrower than the rule. It let a
   clock read written straight into a click handler pass (part 4), so a small lint rule ("no clock
   in a view file") is what makes the rule whole. And today's app has 8 real findings, 6 of them in
   functions that compile, so it blocks on `next/` first and on main once those 6 are fixed.

   **Decided 2026-11-02: a view never reads the clock; the time comes through a Cmd, and the purity
   check can block.** The lean, 80%, is taken. The doubt stays: the check misses `new Date()`
   written straight in a click handler. The 6 real findings on main are fixed before the check is
   switched on to block there. **How strict is a setting, decided the same day,** in each repo's
   `fabrika.toml` ([one `fabrika.toml` per repo](../docs/direction/one-fabrika-toml-per-repo.md)),
   under React's own rule name ([`purity`](https://react.dev/reference/eslint-plugin-react-hooks/lints/purity))
   and ESLint's severity words:

   ```toml
   [lint]
   "react-hooks/purity" = "error"   # or "warn" or "off". "error" is the default.
   ```

   The repo running the code decides. A pack someone else wrote cannot turn your check off
   ([nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md)). Not built.
3. **Keep `lint:compiler` beside oxlint's rules?** Lean yes, 85%: the rules say what might skip,
   the check says what did.

   **Decided 2026-11-02: kept, and the build owns the check; `lint:compiler` calls the same step.**
   One function compiles a file and returns its findings. The build calls it on every rebuild and
   in CI, and an `"error"` finding fails the build. `pnpm lint` calls the same function with no
   bundle, about 55 ms for main's window files. The industry way is the React Compiler's
   [`panicThreshold`](https://react.dev/reference/react-compiler/panicThreshold) option, where
   `"all_errors"` fails the build on any diagnostic. React's docs recommend `"none"` for production;
   failing the build is our choice, so a finding is fixed or ledgered, never shipped quietly. The
   doubt, 80%: whether oxc's native port supports `panicThreshold`. If not, our function reads the
   skip list and fails the build itself. Not built.
4. **Which version is the yardstick?** oxc follows the Compiler's experimental release, Babel's
   `latest` is 1.0.0. Lean: hold the native output against our own planted files and a window
   run, not against Babel, 70%. A rerun of part 1 against the experimental Babel release would
   show whether the three differences close.

   **Decided 2026-11-02: our planted files plus a real window run, not Babel.** The lean, 70%, is
   taken. The doubt stays: a rerun against Babel's experimental release would show whether the one
   false alarm is a version lag.
5. **`next/`'s desk: which shape?** [Part 3's lean](#the-lean), 75%: way 3b, narrow the hook all the
   way up, so each tile, `App` and `Status` read their own part, with no hand memo.

   **Decided 2026-11-02: 3b, through our stand-in hook with a selector.** The lean is taken. tea's
   hook takes no selector yet; [demlik 853](https://github.com/kamp-us/demlik/issues/853) asks for
   one, and the stand-in goes when tea's lands. Not built.
6. **Today's app: esbuild with the Compiler in `onLoad`, or Rolldown?** The lean above was esbuild,
   85%.

   **Decided 2026-11-02, walked earlier: today's app moves to Rolldown later, in ticket 177.** Not
   built.

## What this cannot tell us

- Whether a window built this way runs right. No bundle was loaded and no window opened. **Part 2
  answers it for `next/`: yes.** Today's app was still not started with its compiled bundle.
- Fast Refresh and hot reload with the native Compiler. `jsx.refresh` exists; it was not tried.
- How often the port is wrong. 108 functions in 13 files is a small sample. oxc's 100k-file claim
  has no published percentage.
- Why Rolldown's bundle is 440 KB smaller. Part 2 found that on `next/` it is mostly Effect, which
  Rolldown shakes harder. Not checked on main.
- Build times on a quiet machine. Another agent was running, and the ranges overlap.
- Whether oxlint 1.90.0 holds the same Compiler code as `oxc-transform-react` 0.156.0. They share a
  repository; the versions were not matched.
- Whether the Compiler can run inside workerd. The package ships a `workerd` WebAssembly export,
  which could let a brain compile a program's view. Not tried.
- Whether the projects stay under their own GitHub organizations. Neither post says.

$0. No model was called and nothing was deployed. The native tools are in this experiment's
workspace package. Babel was installed in a scratch folder outside the repo and is not in the
lockfile.

## Part 2: a real window

Run 2026-11-02, the same day, on `next/` only. **`next/`'s window, built with Rolldown 1.2.13 and
oxc's Compiler from `oxc-transform-react` 0.156.0, runs right.** PR 223's own end-to-end test
passes on it: 3 of 3 on React's production build, 1 of 1 on its development build with Strict Mode
on. No page error, no console error, no warning. The Compiler compiles 5 functions and skips 0, and
the bundle that runs holds the compiled code. Rolldown also built the brain and both programs, and
they ran in workerd. **Nothing in the experimental port broke.**

**The tile `memo`: C6 holds for the inside of a tile, not for the tile.** On a 3 by 3 desk, the
Compiler alone never stops a tile's own function from running on a patch. It does skip what is
inside a tile that did not change, once the tile gets stable props. A hand `memo` skips nothing
until the tile's props are plain values; then a patch drops from 13 renders to 5.

```tsx
// What the memo answer turns on: the props the desk gives each tile (from the bench's shapes).
// The slice's own desk: new handlers on every render. Nothing skips, compiled or not.
<Tile tile={tile} focus={() => focus(tile.id)} press={(m) => dispatch(...)} ... />
// Plain values and `dispatch`: the Compiler skips the counter view inside; a memo skips the tile.
<FlatTile id={tile.id} shows={tile.shows} x={tile.x} y={tile.y} w={tile.w} h={tile.h}
	folded={tile.folded} focused={focused} data={data} n={workspace.n} dispatch={dispatch} />
```

### What was run

- A scratch worktree at PR 223's head, `7c1d0730`, detached. Nothing was pushed there, and it was
  removed after. `next/` on that branch starts workerd through Miniflare 4.20260730.0, not Alchemy's
  local stage, and serves its window as a web page. So the window here is a headless Chromium tab
  (Playwright 1.64.1), not Electron.
- `next/build.ts` got one switch, `BUILD=rolldown`: all four bundles through Rolldown, and part 1's
  Compiler plugin on the window's `.tsx` files. The default stays esbuild 0.28.2, the way that
  branch builds today. The whole change is `195-oxc-toolchain-window.patch`.
- `main.tsx` got `<StrictMode>` around the app; the slice does not turn it on. React's production
  build ignores Strict Mode, so the end-to-end test also ran on React's development build
  (`MODE=development`), where Strict Mode renders twice and runs each effect twice.
- PR 223's own checks, unchanged: `node next/e2e.ts` (two windows, clicks, mirroring, the fold,
  `kill -9` of workerd and of Node, a hung brain, a restart on the same data), and vitest over
  `next/` with one worker.
- The bench, `195-oxc-toolchain-window.ts`: experiment 176's devtools-hook probe, cut down, on the
  production build. Per run: build time, cold start, first draw, keys, the console, and renders on
  10 focus moves, 10 patches heard from the other window, and 10 presses in this window. 3 runs of
  each variant, interleaved. React 19.3.1, tea 0.21.0, Node 22.22.3. Results:
  `results/195-oxc-toolchain-window.json`.
- **Too few tiles to measure, so more were made.** The slice has 2 tiles, and a focus move changes
  both, so a `memo` can show nothing there. A build switch, `DESK_TILES=9`, gives the desk program
  a 3 by 3 first layout. Same code paths, 9 tiles.

`env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 19 node next/bench-195.ts
--out=<file> --runs=3`, from a PR 223 checkout set up as the script's header says. About 10
minutes for the 48 runs, with two other code agents on the laptop.

### Does it run right

| Check | esbuild, today's way | Rolldown and the oxc Compiler |
|---|---|---|
| `e2e.ts`, React production build | 3 of 3 | 3 of 3 |
| `e2e.ts`, development build, Strict Mode | 1 of 1 | 1 of 1 |
| vitest over `next/` | 67 of 67 | the same 67 |
| Page errors, console errors and warnings | 0 | 0 |
| A patch from the other window reaches the screen | every time | every time |
| Enter and Space on `+1`; Tab moves on | yes | yes |
| Compiler verdicts | none | 5 compiled, 0 skipped |

- **No console noise, in either React build.** The 0 covers the 48 bench runs and 3 more bench
  runs on React's development build, which warns about much more.
- **No frozen desk.** In every run of every variant, each count the other window changed was
  redrawn here. Click to count stayed 16 ms at the median in the end-to-end test, both ways.
- **The compiled code is what runs.** The 5 are `Tile`, `Status`, `Desk`, `App` and
  `CounterView`. The development bundle holds Rolldown's region for
  `react/cjs/react-compiler-runtime.development.js` and 5 calls of
  `(0, import_compiler_runtime.c)(n)`, one per compiled function. The production bundle is
  minified, so there the evidence is the renders below: compiled variants render differently.
- **vitest is no evidence for the build.** No test in `next/` imports `build.ts` or a `.tsx` file.
  The end-to-end test is the check that runs the built window.
- **Keys:** the slice has no keys of its own yet (W5 in PR 223's README), so this checks the
  browser's own. Enter and Space press a focused `+1`, and Tab moves to the next tile's button.
- One Rolldown 1.2.13 detail: `legalComments` prints a deprecation warning; `comments: {legal:
  false}` replaces it.

### Time and size

| What | esbuild | Rolldown and the Compiler |
|---|---|---|
| `buildAll`, all four bundles | 125 to 159 ms, median 141 | 101 to 112 ms, median 108 |
| Start to brain up: Node, build, Miniflare | 554 to 602 ms, median 578 | 516 to 563 ms, median 530 |
| Miniflare ready, inside that | 101 to 111 ms | 90 to 102 ms |
| Page open to all 9 counts drawn | 222 to 239 ms, median 228 | 111 to 130 ms, median 114 |
| Window bundle, minified | 664,017 B | 351,047 B |
| Brain | 624,067 B | 482,596 B |
| Each program, counter and desk | 271,765 and 272,430 B | 76,701 and 78,240 B |

24 runs each way, all shapes together. Byte counts are for the slice's own desk with no `memo`.

- **The first draw halves.** The page parses half as much script before it dials the brain.
- **Why the bundles are smaller: mostly Effect.** Before minifying, Effect is 916 KB of esbuild's
  window bundle and 558 KB of Rolldown's; React DOM is 642 KB against 537 KB. Rolldown drops about
  40% more of Effect. The end-to-end test passing is the only check that what it dropped was dead.
- **The programs shrink most, 272 KB to 77 KB.** Worker Loader loads a program by hash (173), so
  this should make a cold load cheaper. Not measured here.
- The build is faster too, but both are near 100 ms, and with other agents running the gap means
  little.

### The tile memo

Renders in the window that only hears, per moment, summed over every component. Counts were the
same in all 3 runs of every variant. One focus move is three commits (the press, its answer, the
desk's patch). A patch of 21 is 9 tile functions, 9 counter views, and `App`, `Desk`, `Status`.

| Desk shape | Build | No memo: focus, patch, press | Hand `memo`: focus, patch, press |
|---|---|---|---|
| `inline`, the slice's own | esbuild | 63, 21, 63 | 63, 21, 63 |
| `inline` | Rolldown and the Compiler | 63, 21, 63 | 63, 21, 63 |
| `stable`: `dispatch`, not handlers | esbuild | 63, 21, 63 | 63, 21, 63 |
| `stable` | Rolldown and the Compiler | 36, 13, 37 | 36, 13, 37 |
| `hoisted`: also the fold on its own line | Rolldown and the Compiler | 36, 13, 37 | 36, 13, 37 |
| `flat`: the tile as plain values | esbuild | 63, 21, 63 | 13, 5, 11 |
| `flat` | Rolldown and the Compiler | 36, 13, 37 | 11, 5, 11 |

`hoisted` on esbuild matched `stable` on esbuild. A patch of 13 is 9 tile functions, 1 counter view
(the one that changed) and 3 outside; 5 is 1 tile, 1 counter view and 3 outside, the least a patch
can cost.

- **On the slice as written, the Compiler saves nothing.** `Desk` passes
  `focus={() => focus(tile.id)}` and a `press` arrow, new on every render. The Compiler caches the
  whole `.map` as one value, and that value reads `model.views`, which every patch changes. So
  every tile and every counter view runs again, as with no Compiler.
- **With stable props, the Compiler skips the inside of a tile.** A tile that makes its own
  handlers from `dispatch` caches its `<CounterView>` element. A patch drops from 21 to 13, a
  focus move from 63 to 36. The 9 tile functions still run: each one checks its cache and returns.
- **A hand `memo` skips nothing until the props are plain.** `fold` makes a new object per tile on
  every call. Putting it on its own line did not help: the compiled `HoistedDesk` still calls
  `fold` inside the same cached block as the `.map`, so it runs again on every patch. Why the
  Compiler joins them is a guess: it cannot tell that `.map` leaves the array alone. Passing the
  tile as plain values lets `memo` compare: a patch drops from 13 to 5, compiled or not.
- **Against 176.** There, compiled with and without `memo` matched, and untouched tiles barely ran.
  Here they match too, but because `memo` cannot skip, not because the Compiler does. Today's desk
  must hand its tiles props that stay the same object; which ones was not checked.

**What it means for C6, lean 70%: keep "the Compiler memoizes, no hand `memo`", and add one rule
for whoever lists tiles: a tile gets plain values and `dispatch`, never a fresh handler or object.**

- **Why:** the props rule is what makes the Compiler's skip work at all (21 to 13), with or without
  `memo`. What `memo` adds on top is 8 tile functions per patch on 9 tiles, each a cache check. 176
  found the Compiler "saves renders, not milliseconds you can feel".
- **Cost:** none in code; the rule is a review point, or a lint rule later.
- **The doubt:** no time was measured, only renders, on 9 small tiles. On a desk of 30 tiles, or a
  tile whose own function is heavy, `memo` may earn its place. A second way, not tried: each tile
  reads its own view through the store hook, so `Desk` never reads `model.views` and the Compiler
  can keep every tile's element. Timing a patch on a 30-tile desk with and without `memo` settles
  the first; trying the second is a bench shape away.

### What part 2 cannot tell us

- How the window behaves in Electron. `next/` serves a page, so a Chromium tab ran it.
- Whether the oxc port is right on code bigger than 5 functions in a real window. Part 1 matched
  Babel on 108; only these 5 ran.
- Time per render, or whether 8 extra cache checks per patch can be felt. Only renders were counted.
- Hot reload and Fast Refresh, and Rolldown for Electron's main and preload. Not tried.
- Whether Rolldown's harder tree shaking ever drops code that was needed. Only this slice's tests
  say it did not.
- Times on a quiet machine. Two other code agents were running.

$0 again: no model, no deploy, no network beyond the npm registry for two packages. Rolldown and
`oxc-transform-react` were added only in the scratch worktree; nothing changed on main.

## Part 3: a bigger desk, timed

Run 2026-11-02, the same day, on `next/` only, with Rolldown and the Compiler. **The cheapest way
per patch is the third one: each tile reads its own view, and the top of the window reads only
the desk and the size.** A patch then costs 3 renders on 9, 30 or 60 tiles: the tile that changed,
its counter view, and the status line. Today's lean (`flat`, no `memo`) costs 13, 34 and 64. A
hand `memo` costs 5. **In time, nothing here can be felt:** every median is between 0.14 and 0.31
ms a patch, and every p95 is under 0.62 ms.

```tsx
// Way 3, the whole idea (a sketch): the tile holds its own handle, so it reads and sends its own.
function OwnTile(props: {id; shows; x; y; w; h; folded; focused; own: TileHandle}) {
	const [data, send] = useRuntime(props.own); // the same hook as App, on a narrow handle
	// ... draws `data`, and sends {type: "plus"} or {type: "focus"} through `send`
}
```

### What was run

- The same scratch worktree setup as part 2: PR 223 at `7c1d0730`, detached, with
  `195-oxc-toolchain-window.patch` applied and Rolldown 1.2.13 and `oxc-transform-react` 0.156.0
  added. React 19.3.1 production build, tea 0.21.0, headless Chromium from Playwright 1.64.1.
  Removed after.
- `DESK_TILES` now takes 9 (3 by 3), 30 (6 by 5) and 60 (10 by 6). The page is sized so no tile
  folds: 1280 by 800, 1600 by 900, 2560 by 1000. The bench checks it: 0 folded tiles in every run.
- Five shapes, each a build switch. 5 runs of each shape on each desk, interleaved, 40 patches, 10
  focus moves and 10 presses a run. 100 runs, 0 failures, 0 console lines, about 33 minutes.
- **Time:** each commit, from the store's first notify to React's commit hook, read with
  `performance.now()`. The page is cross-origin isolated for this (two headers on the page), so the
  clock reads to 5 µs, not 100. That counts the hook's fan-out, React's render and its commit, not
  the window machine's own `update`. 200 patches per cell.
- A heavy-tile variant on the 30 desk: each tile draw spins 300,000 loops on its own data, about
  1.9 ms.

The five shapes, by what each tile gets:

```tsx
// 1. `flat`, Compiler, no memo (part 2's lean). Desk reads model.views, hands each tile its data.
<FlatTile id x y w h folded focused data={model.views[tile.shows]?.data} n dispatch={dispatch} />
// 2. `flat` with memo: the same props, and `memo(FlatTile)`, as Elm's Html.Lazy does.
// 3a. `own`: the tile's own handle in place of data and dispatch. App still reads the whole model.
<OwnTile id x y w h folded focused own={tileHandle(root, n, tile.id, tile.shows)} />
// 3b. `narrow`: 3a, and App reads only {desk, size}, Status only its own line, each narrowed.
// 3c. `narrow` with memo, to see what memo still adds.
```

### The numbers

Renders per moment, summed over every component, the same in all 5 runs of each cell. Time is per
patch heard from the other window, one commit each.

| Shape | Desk | Renders: focus, patch, press | Patch ms, median | Patch ms, p95 |
|---|---|---|---|---|
| 1. `flat`, no memo | 9 | 36, 13, 37 | 0.16 | 0.33 |
| 1. `flat`, no memo | 30 | 99, 34, 100 | 0.19 | 0.36 |
| 1. `flat`, no memo | 60 | 189, 64, 190 | 0.27 | 0.55 |
| 2. `flat`, memo | 9 | 11, 5, 11 | 0.17 | 0.33 |
| 2. `flat`, memo | 30 | 11, 5, 11 | 0.19 | 0.30 |
| 2. `flat`, memo | 60 | 11, 5, 11 | 0.27 | 0.55 |
| 3a. `own`, App reads all | 9 | 36, 13, 37 | 0.18 | 0.34 |
| 3a. `own`, App reads all | 30 | 99, 34, 100 | 0.21 | 0.41 |
| 3a. `own`, App reads all | 60 | 189, 64, 190 | 0.31 | 0.62 |
| 3b. `narrow`, no memo | 9 | 14, 3, 5 | 0.14 | 0.28 |
| 3b. `narrow`, no memo | 30 | 35, 3, 5 | 0.14 | 0.26 |
| 3b. `narrow`, no memo | 60 | 65, 3, 5 | 0.17 | 0.28 |
| 3c. `narrow`, memo | 9 | 7, 3, 5 | 0.14 | 0.23 |
| 3c. `narrow`, memo | 30 | 7, 3, 5 | 0.14 | 0.25 |
| 3c. `narrow`, memo | 60 | 7, 3, 5 | 0.14 | 0.27 |

- **Way 3 as first written saves nothing (3a).** `App` reads the whole model, so it runs on every
  patch. It decodes the desk again, which hands `Desk` a new workspace object, and every tile runs.
  It is a little slower than way 1: 60 narrow handles each answer the notify.
- **With the top narrowed too (3b), a patch is 3 on every desk.** `App` and `Desk` do not run at
  all. A focus move still costs every tile (65 at 60 tiles), since the desk view moves and `Desk`
  makes new elements. Memo on top (3c) takes a focus move down to 7.
- **Memo's 5 does not buy time on a big desk.** At 60 tiles, way 2 renders 5 and way 1 renders 64,
  and both take 0.27 ms. Most likely the cost is in `Desk` (not timed apart): it runs `fold` and
  builds 60 elements on every patch, and memo then compares 60 sets of props. Way 3b skips `Desk`,
  and is the only way that gets faster than way 1, at 0.17 ms.
- All of these differences are a tenth of a millisecond. A frame is 16.7 ms.

### The floor, and do `App` and `Status` need to run

**The floor is 3, not 5.** Part 2's 5 was one tile, one counter view, and `App`, `Desk` and
`Status`. `App` and `Desk` ran only because they read the whole model; on a narrow handle they
stop. **`Status` does need to run:** it prints the ledger's rev, and every patch moves it. A status
line that showed no rev would bring the floor to 2.

### What a tile can see and send

| Way | What the tile sees | What the tile can send |
|---|---|---|
| 1 and 2, `flat` | its own view's data, as a prop; `Desk` holds every view | any window Msg, to any process: it holds the window's whole `dispatch` |
| 3, `own` and `narrow` | its own view's data only, through its handle | `{type: "plus"}` or `{type: "focus"}`, about itself only |

- The tile's send is bound to its own id, as Elm's `Html.map` does: the handle maps `plus` to a
  press on the tile's own process, and `focus` to a focus on the desk naming this tile.
- **How it stays the same function:** `tileHandle(root, n, id, shows)` makes each tile's handle once
  and keeps it in a map, keyed by root handle, workspace, tile and process. A patch or a focus move
  finds the same handle, so `send` is the same function on every draw. The Compiler sees a prop
  that never changes.
- The one leak: the handle's `subscribe` is the root's, so a tile hears that something changed
  anywhere, with no data. That is how `useSyncExternalStore` works; the tile then reads only its
  own part and stops.

### What tea 0.21.0's hook makes awkward

There is no selector. `useRuntime(handle)` is `useSyncExternalStore(subscribe, getState)` over the
whole model, so any component that calls it runs on every change. The bench uses the same one hook
and hands it a narrow handle instead:

```ts
// Shortened from the bench patch. The hook uses 3 of BootedRunHandle's 8 fields; 5 more are filled.
const narrow = <A, N extends {readonly type: string}>(
	root: BootedRunHandle<Model, Msg>,
	pick: (model: Model) => A, // the part, the same object while it holds
	same: (a: A, b: A) => boolean,
	send: (msg: N) => Msg, // Html.map
): BootedRunHandle<A, N> => ({
	getState, // pick, cached on the root model and on `same`
	subscribe: (listener) => root.subscribe(listener),
	dispatch: (msg) => root.dispatch(send(msg)),
	onBoot, on, stop, ready, // filled for the type; the hook never calls them
	observe: () => { throw new Error("a window Msg does not map back to a part's"); },
});
```

- `observe` cannot be honest: it would hand the part each window Msg, and a window Msg does not map
  back to a tile's. So it throws.
- tea 0.22.0, the version the plan moves to, has no selector either (read from its published
  typings). The known way is a selector on the hook, as React's own
  `useSyncExternalStoreWithSelector` and Redux's `useSelector` do. Then `narrow` shrinks to the
  `send` mapping.

### A heavy tile

30 tiles, each tile draw spins 300,000 loops on its own data.

| Shape | Renders: patch | Patch ms, median | Patch ms, p95 |
|---|---|---|---|
| 1. `flat`, no memo | 34 | 2.06 | 4.61 |
| 2. `flat`, memo | 5 | 2.32 | 4.69 |
| 3a. `own` | 34 | 2.33 | 4.72 |
| 3b. `narrow` | 3 | 2.07 | 4.60 |
| 3c. `narrow`, memo | 3 | 2.01 | 4.66 |

**A heavy tile does not tip it to memo.** The Compiler caches the heavy work on the tile's data, so
in every shape only the tile that changed redoes it. The 29 tiles that did not change still run
in way 1, and only check their cache. The spread between runs (1.8 to 4.5 ms medians) is the
machine, not the shape. Heavy work the Compiler cannot cache (a tile it skips) would act like part
2's esbuild rows, where every tile runs; that was not timed.

### The lean

**Lean, 75%: way 3b for `next/`'s desk. Each tile, `App` and `Status` read their own part through
tea's hook on a narrow handle, each tile holds a send bound to itself, and there is no hand memo.**

- **Why:** a patch costs 3 renders whatever the desk size, and it is the only way that got faster
  than today's lean. A tile sees only its own data and can send only about itself, which the other
  ways cannot give. C6 holds as written: the Compiler memoizes, no hand `memo`.
- **Cost:** about 60 lines in the file the store hook lives in (`narrow`, `tileHandle`), and the
  desk passes a handle in place of data and `dispatch`. About 0.3 agent hours.
- **What memo would add:** a focus move at 60 tiles drops from 65 renders to 7, at the same 0.15
  ms. Not worth a rule.
- **The doubt:** `narrow` is a hand adapter around tea's hook, with five fields filled only for the
  type and one that throws. A selector in tea's hook settles it; a tea issue would ask for one. And
  the time gaps are a tenth of a millisecond, so this rests on renders and on what a tile can
  reach, not on speed anyone feels.

### What part 3 cannot tell us

- Time on a slow device. This was a laptop with another code agent running, and no CPU slowdown.
  The gaps might grow on a slow phone; they start at a tenth of a millisecond.
- The cost of the window machine's `update` on a patch. It runs before the notify, the same in
  every shape, and was not timed. It decodes the desk on every patch.
- Real tiles. These are counters. A tile with its own children, or one the Compiler skips, was not
  run.
- Electron, and React's development build. Production build only, in a Chromium tab.
- Whether tea will take a selector. Not asked yet.

`env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 19 node next/bench-195.ts
--runs=5 --patches=40 --variants=<the 20 above>`, from a PR 223 checkout set up as the script's
header says. Results: `results/195-oxc-toolchain-part3.json`. $0: no model, no deploy.

## Part 4: a view never reads the clock

Run 2026-11-02, the same day, on `next/` only. **The purity check's one false alarm is gone, and
the check can block.** The alarm was `Desk` reading the clock in a click handler and passing that
handler down through `Tile`; the check cannot prove the tile never calls it while drawing. The fix
is Elm's: a view only sends a message, and `update` gets the time through a Cmd. After it, the
native check finds 0 in `next/`, still refuses `now-in-render.tsx`, and the render counts do not
move.

```ts
// The whole idea (a sketch; `writeLetter` stands for the cell's body). The view: a press, no time.
dispatch({type: "press", pid: tile.shows, m});
// update: keep the rev the person saw, and ask for the time. The Cmd carries the press.
press: (model, msg) => [model, [now({pid: msg.pid, m: withSaw(model, msg.pid, msg.m)})]],
// The answer writes the letter, with `said` from the clock.
now_ok: (model, msg) => writeLetter(model, msg.cmd.pid, msg.cmd.m, msg.value),
```

### What changed

All in the bench patch, on PR 223 at `7c1d0730`, as part 3 left it. The whole change is in
`195-oxc-toolchain-window.patch`; nothing was pushed to PR 223.

- **The view:** every `said: new Date().toISOString()` and the `said()` closure in `Desk` are gone,
  in all five desk shapes and in way 3's tile handle. A press is `{type: "press", pid, m}`.
- **The Cmd,** with tea's Effect `Cmd.define` and an Effect Schema:

  ```ts
  import {Cmd} from "@demlik/tea/effect";
  export const now = Cmd.define("now", {
  	input: Schema.Struct({
  		pid: Schema.String,
  		m: Schema.StructWithRest(Schema.Struct({type: Schema.String}), [
  			Schema.Record(Schema.String, Schema.Unknown),
  		]),
  	}),
  	ok: Schema.String, // the time, as ISO text
  	err: [],
  });
  ```

- **Where the clock is read:** once, in the window's interpret table, from Effect's `Clock`. No
  Promise.

  ```ts
  // Shortened: send_text also checks the socket is open.
  interpret: {
  	send_text: (cmd) => Effect.sync(() => socket?.send(cmd.text)),
  	now: () => Effect.map(DateTime.now, DateTime.formatIso),
  },
  ```

- **One knock-on:** a machine that declares `cmds` returns only defined Cmds, so `send_text` moved
  to `Cmd.define` too (`ok: Schema.Void`), and `update` takes `send_text_ok`, `send_text_err` and
  `now_err`. `now_err` drops the press and sets `refused`; the clock has no way to fail here.
- **The rev it saw** is taken at the press, not when the time comes back, so a patch landing in
  between does not change what the letter says the person saw.
- The window machine's two press tests now step the press and then `now.ok(cmd, time)`, and check
  that the press alone sends nothing and leaves the model as it was.

### Before and after

| Code checked | Refused with the purity check | False alarms |
|---|---|---|
| `next/` on PR 223 (part 1) | `Desk` | 1 |
| `next/` with part 3's bench patch | `Desk` | 1 |
| `next/` after part 4 | none | 0 |
| main, unchanged | the same 8 as part 1 | 0 |
| planted `now-in-render.tsx` | `When` | 0: it reads the clock while drawing |
| planted `said-in-handler.tsx` | `Desk` | 0 now: under the rule it is a real finding |

- **8 findings, 0 false alarms,** where part 1 had 9 and 1. The 8 are today's app, and Babel's check
  refuses the same 8.
- **The check is narrower than the rule.** Part 3's bench tiles (`StableTile`, `FlatTile`) read
  `new Date()` straight inside their own click handler, and the check let them pass both times. It
  refuses only a clock read it cannot place outside the draw, such as a function handed to a child.
  So "a view never reads the clock" needs a lint rule beside it to be whole: no `Date`,
  `Date.now` or `performance.now` in a view file.
- The planted `said-in-handler.tsx` keeps its row: it is now the test that the check refuses the
  pattern the rule bans.

### Does it run right, and do the counts move

- `node next/e2e.ts` on the Rolldown build: 1 of 1, click to count 16 ms, as in part 2. vitest over
  `next/`: 67 of 67.
- 12 bench runs on the 9 desk, 2 of each shape, 0 console lines. **The counts do not move:**
  `inline` 63, 21, 63 (esbuild and Rolldown), `stable` and `flat` 36, 13, 37, `flat` with memo 11,
  5, 11, part 3's `narrow` 14, 3, 5. A press still commits 3 times: the press itself changes nothing
  in the model, so asking for the time draws nothing.
- The Compiler compiles the same 12 and 1 functions with no diagnostic, as in part 3.

**Lean for open call 2, 80%: purity blocks.** Why, cost and doubt are in
[open calls](#open-calls-with-leans). The cost here is about 40 lines in the window machine and 1
in each view, about 0.3 agent hours, and it follows a settled note,
[Elm first](../docs/direction/elm-first.md).

### What part 4 cannot tell us

- Whether 0 false alarms holds as `next/` grows. 2 files in `next/` and 6 planted ones is a small
  set; the Google bar is about 0% over real use.
- What the lint rule for the clock would flag on today's app. Not written or run.
- Whether the brain should stamp the time instead. `said` is the writer's own clock on purpose
  (AGENTS: a ledger entry keeps it as `said`); this keeps that, only from `update`, not the view.
- How a real stage of the pipeline would run the check. Here the spike ran it by hand.

`env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 19 node
experiments/195-oxc-toolchain.ts --next <commit> --out <file>`, once on a scratch commit of part 3's
code and once on part 4's, both local and never pushed. Results:
`results/195-oxc-toolchain-part4.json`. $0: no model, no deploy.

## Links

- [s1] https://blog.cloudflare.com/voidzero-joins-cloudflare/
- [s2] https://voidzero.dev/posts/voidzero-cloudflare
- [s3] https://github.com/alchemy-run/alchemy
- [s4] https://oxc.rs/blog/2026-08-18-react-compiler-support
- [s5] https://oxc.rs/docs/guide/usage/transformer/react-compiler
- [s5b] https://github.com/oxc-project/oxc/blob/main/napi/transform-react/index.d.ts, and the npm
  package `oxc-transform-react` 0.156.0
- [s6] https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/CHANGELOG.md
- [s7] https://github.com/facebook/react/pull/36173
- [s8] https://swc.rs/docs/configuration/react-compiler
- [s9] https://nextjs.org/docs/app/api-reference/config/next-config-js/reactCompiler, and
  https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopackRustReactCompiler
- [s10] https://github.com/alex8088/electron-vite/blob/master/CHANGELOG.md
- [s11] https://github.com/electron/forge/releases/tag/v8.0.1
- [s12] https://developers.cloudflare.com/workers/vite-plugin/, and
  https://github.com/cloudflare/workers-sdk/releases/tag/@cloudflare%2Fvite-plugin@2.0.0-beta.v.0
- [s13] https://alchemy.run/tutorial/cloudflare/vite-spa/, and
  https://alchemy.run/concepts/local-development/
- [s14] https://tsdown.dev/guide/
- [s15] https://vite.dev/guide/migration
