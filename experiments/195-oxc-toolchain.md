# The React Compiler with no Babel: which toolchain, and does it hold 194's numbers?

Read and run 2026-11-02. **Reading plus one spike, `195-oxc-toolchain.ts`, kept.** The spike runs
oxc's Rust port of the React Compiler over every window and program `.tsx` file on main and over
`next/`'s two on [PR 223](https://github.com/usirin/tea-fabrika/pull/223), holds each function
against Babel's Compiler, and times the window's bundle five ways. No window was opened, no
model was called, nothing in the app changed. It answers the open question in experiment 194
([PR 320](https://github.com/usirin/tea-fabrika/pull/320)) after the owner ruled out Babel.

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

**Lean for `next/`, 75%: Rolldown as a library in `next/build.ts`, with the Compiler as the
20-line plugin above, for the window and for the Workers. No Vite dev server and no Cloudflare Vite
plugin.** Vitest stays as it is. Why, cost and doubt are in
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

**Lean for `next/`, 75%: Rolldown as a library, the Compiler as a plugin, one bundler for
everything `next/build.ts` makes.**

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

1. **`next/`: Rolldown from code, or Vite 8?** Lean Rolldown, 75%, as above. Vite wins if the owner
   wants the dev server's hot reload over the brain's.
2. **Purity: 194 gave it to the Compiler's own check, with 0 false alarms.** That was Babel's
   check. The native one has the false alarm oxlint's `purity` had in 194 (1 of 9 findings, 11%). Lean: purity
   advises and does not block, until oxc fixes the handler case, 70%. Filing that case with oxc
   settles it.
3. **Keep `lint:compiler` beside oxlint's rules?** Lean yes, 85%: the rules say what might skip,
   the check says what did.
4. **Which version is the yardstick?** oxc follows the Compiler's experimental release, Babel's
   `latest` is 1.0.0. Lean: hold the native output against our own planted files and a window
   run, not against Babel, 70%. A rerun of part 1 against the experimental Babel release would
   show whether the three differences close.

## What this cannot tell us

- Whether a window built this way runs right. No bundle was loaded and no window opened.
- Fast Refresh and hot reload with the native Compiler. `jsx.refresh` exists; it was not tried.
- How often the port is wrong. 108 functions in 13 files is a small sample. oxc's 100k-file claim
  has no published percentage.
- Why Rolldown's bundle is 440 KB smaller.
- Build times on a quiet machine. Another agent was running, and the ranges overlap.
- Whether oxlint 1.90.0 holds the same Compiler code as `oxc-transform-react` 0.156.0. They share a
  repository; the versions were not matched.
- Whether the Compiler can run inside workerd. The package ships a `workerd` WebAssembly export,
  which could let a brain compile a program's view. Not tried.
- Whether the projects stay under their own GitHub organizations. Neither post says.

$0. No model was called and nothing was deployed. The native tools are in this experiment's
workspace package. Babel was installed in a scratch folder outside the repo and is not in the
lockfile.

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
