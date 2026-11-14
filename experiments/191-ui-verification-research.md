---
date: "2026-11-02"
scripts: "none; reading only"
summary: "Reading, not a measurement, and no decision. A UI verification pack checks the UI the way we check machines: most checks are pure laws over tokens, the tea model and the view's tree, and few look at pixels. Seven layers, cheapest first: token laws, machine laws, DOM and ARIA laws, layout laws at the five tile layouts, golden images, a measured model judge, a person. Only the first four can block, each once its false alarms are measured here; ReDeCheck's overlap and protrusion kinds had 0 false positives, its small-range kind 22%. No public false alarm rate exists for pixel diffs or vendor AI review; vision judges were \"not accurate\" on 29% of findings, and designers agree at alpha 0.37. A golden or ARIA snapshot is exam, so no builder updates one. Best ideas from other fields: plant UI breaks to measure the checks (chip design), check the few must-see marks per frame (car displays), accept many approved images and replay recorded traces (Skia Gold, Mesa). Eight small experiments next, seven at $0. No model, $0."
---

# 191: UI verification, research and prior work

Read 2026-11-02, against `main` at `912fac43`. A study by reading only: nothing was built or run,
no test, no app, and no model was called. Four research agents and the writer opened each source
and checked the claim against it. A source marked *(could not open)* rests on search results or
metadata only. This is research for a future UI verification pack, not a decision.

**Which version.** Every "today" claim is about today's app, `apps/fabrika`, and today's pack
stand-in, `packs/ui-verification`. `next/` reads this as a lesson.

## The answer in 5 lines

1. Check the UI the way we check machines: most checks are pure laws over data (tokens, the tea
   model, the view's tree), and only a few look at pixels.
2. Seven layers, cheapest and surest first: token laws, model-based tests on the tea machine, DOM
   and ARIA laws, layout laws across the five tile layouts, golden images, a measured model judge,
   and a person.
3. Under our CACM rule only the first four can block, and each only after its false alarms are
   measured in our own runs. Golden images and the model judge advise until their numbers say
   otherwise.
4. Where there is no right answer to compare against, use relations instead: the same facts in
   words at every layout, the same boxes in every theme, and the same picture whether a state was
   reached step by step or loaded fresh.
5. A golden image or an ARIA snapshot is part of the exam, so a builder never updates one. The
   person's part shrinks to what no law explains, as Skia Gold's triage and IEC 62366's critical
   tasks do.

```ts
// A sketch. The whole pack as moves: five Checks, one Judge, then a person only when needed.
const verifyUi = (change: Change) => [
	check(tokenLaws, change.themes), //          1  pure, ms, blocks
	check(machineLaws, change.machines), //      2  tea pbt, s, blocks
	check(domAndAria, change.pages), //          3  headless page, s, blocks once measured
	check(layoutLaws, change.pages, LAYOUTS), // 4  boxes at 5 layouts, s, blocks once measured
	check(goldens, change.pages, LAYOUTS), //    5  pixels, advises until its flake rate is ~0
	judge(ruleRows, change.shots), //            6  a model, advises, measured first
	ask("owner", "look", unexplained), //        7  only what no law explained
];
```

## Where today's app stands

- **The end-to-end run** (`apps/fabrika/e2e.ts`). Playwright drives the built Electron app on a
  macOS CI runner on every pull request. It checks behavior with about 100 `check(...)` lines (focus,
  keys, asks, the palette) and takes one screenshot per step. A person looks at the shots; no code
  compares them.
- **The shot script** (`apps/fabrika/shots.ts`). The built renderer in headless Chromium, handed a
  desk and its views with no host. It shoots at 1440x900 only, so the stacked, 2x2 and small-window
  layouts that AGENTS.md asks for are not shot yet ([tile guidelines](../docs/direction/tile-guidelines.md),
  "Not yet shot").
- **Laws over the stylesheet, with no page.** `src/window/type-scale.test.ts` reads `window.css` and
  works out each font size as the browser would. The contrast law, `src/themes.test.ts`, holds every
  text token to 4.5:1 and every needed line to 3:1, in both looks. It is on tracker ticket 144's
  branch, not on `main` yet.
- **Laws over the desk machine** (`src/desk/desk.laws.test.ts`). tea's `propertyInvariant` sends any
  list of keys, clicks, resizes and host messages to the real `update`, and checks laws after every
  step.
- **Frame tests** (`src/window/frame.test.ts`). 37 tests of the frame's words and its `update`.
- **The pack** (`packs/ui-verification`, [experiment 89](./89-owner-desk.md)). A stand-in: when a
  change touches a file a user sees, it asks the owner yes or no with before and after pictures. It
  names the pictures and takes none.
- **Today's fabrika skills** have a `review-ui` gate: an agent answers PASS, FAIL or N/A per design
  rule row. The skill map says to build that lane last.
- **Not there at all:** axe or any accessibility scan, ARIA snapshots, layout laws, golden images,
  a model judge, and any screen reader run. The [tile guidelines](../docs/direction/tile-guidelines.md)
  list "no screen reader ran" and "layouts were not shot" as open.

## The layered sketch

Cheapest and surest first. "False alarms" is the share of reports that were not real problems,
from the best source we found. None of these numbers was measured on our app.

| Layer | Catches | Misses | False alarms known | Cost | Block or advise | Move |
|---|---|---|---|---|---|---|
| 1. Token laws | contrast, a raw color, a step used for the wrong job | anything drawn | about 0, deterministic | ms | blocks | Check |
| 2. Machine laws | a wrong state, a fact with no word, two focused tiles | layout, pixels | about 0 when the law is right | seconds | blocks | Check |
| 3. DOM and ARIA laws | missing names and roles, one `main`, axe's rules | what a screen reader really says | axe aims at 0; nobody outside measured it | seconds | blocks, once measured | Check |
| 4. Layout laws | overlap, a part out of its tile, cut text, at each layout | color, taste | ReDeCheck: 0 on overlap and protrusion, 22% on small-range | seconds per layout | blocks the 0% kinds, once measured | Gather, Check |
| 5. Golden images | any drawn change | why it changed, whether it is fine | none published; 42% by human rating in GraphicsFuzz's histogram oracle | seconds, plus a person per change | advises | Check, then Ask |
| 6. Model judge | a rule row broken in a shot | anything off its rows | 29% "not accurate" (Duan, CHI 2024) | about 1,500 tokens a shot | advises | Judge |
| 7. A person | taste, real use, a screen reader | what they do not look at | designers agree with each other at alpha 0.37 (UIClip) | minutes | decides | Ask |

### Layer 1: laws over tokens

- **What it is.** A theme is data. Laws run over every theme, both looks and every pair of text and
  background, with no page. Today's contrast law and type-scale law have this shape.
- **Catches:** a pair under 4.5:1 or 3:1; a raw hex in a stylesheet; a value that is not a Radix
  step; two pipe colors too close; a state color reused for a pipe
  ([color principles](../docs/direction/color-principles.md), 2 and 5).
- **Misses:** anything that depends on what is drawn where: a token used on the wrong background,
  alpha stacked twice, a part covered by another.
- **False alarms:** about 0. A wrong report means the law is wrong, and the exam's own change fixes
  that.
- **Cost:** milliseconds. **Blocks.** Move: Check.
- **Industry:** Atlassian's `ensure-design-token-usage` flags raw values and can fix them, "otherwise
  when switching between themes, unexpected incidents can occur"; GitHub's Primer has stylelint
  rules for colors, spacing and type. Shopify archived `stylelint-polaris` on 2026-09-11.

```ts
// A sketch. Layer 1: every theme, both looks, every pair; plus no raw color anywhere.
for (const theme of THEMES)
	for (const look of LOOKS)
		for (const [fg, bg, bar] of PAIRS) {
			const r = ratio(tokenIn(theme, look, fg), tokenIn(theme, look, bg));
			expect(r, `${theme} ${look}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(bar); // 4.5 or 3
		}
expect(rawColorsIn(CSS)).toEqual([]); // only var(--token), as Atlassian's rule says
```

### Layer 2: model-based tests on the tea machine

- **What it is.** The state is a tea machine and the view is a pure function of it. So the strongest
  UI checks need no browser: random lists of Msgs through the real `update`, then laws on the model
  and on what the view will say.
- **Catches:** two focused tiles, a tile with no name in words, an ask that is never shown, a fold
  that loses a tile, a state the view cannot draw.
- **Metamorphic laws fit here** (see [the oracle problem](#the-oracle-problem)): a state reached step
  by step equals the same state saved and loaded (GGPO's sync test, already run in
  [experiment 190](./190-saved-state.md)); Metamong's "step by step looks the same as fresh".
- **Misses:** layout, pixels, and anything the view does outside the model (CSS).
- **False alarms:** about 0 when the law is right. A law that passes because nothing happens is the
  known gap ([nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md)), so
  some laws must say something good happens.
- **Cost:** seconds. **Blocks.** Move: Check.
- **Industry:** Quickstrom (LTL over web apps) found faults in 20 of 43 TodoMVC versions; QuickCheck's
  state machines found over 200 issues in AUTOSAR at Volvo; fast-check's `fc.commands` and
  `scheduledModelRun`; elm-program-test's simulated effects.

```ts
// A sketch. Layer 2: the desk's real update, any Msgs, laws on what the view will say.
propertyInvariant(deskMachine, stubCtxThrowingProxy(), arbMsgSequence(table), ({next}) => {
	const shown = tilesOf(next).map((t) => tileWords(next, t)); // the words the view will draw
	return (
		shown.filter((s) => s.focused).length <= 1 && //  one focused tile at most
		shown.every((s) => s.name !== "") && //           every tile says its name in words
		shown.every((s) => s.asking === false || s.mark !== "") // an ask always has its mark
	);
});
```

### Layer 3: DOM and ARIA laws in a headless page

- **What it is.** Render each seeded state in headless Chromium the way `shots.ts` already does, then
  run axe-core, our own role laws, and an ARIA snapshot.
- **Catches:** a control with no name, a missing landmark, a region count that does not match the
  open tiles, `aria-hidden` on something focusable, axe's WCAG rules.
- **Misses:** what VoiceOver really says and when (live regions, focus moves). Deque's own study says
  automated tests find 57% of issues by volume; gov.uk found the best tool caught 41% of 143 barriers.
- **False alarms:** axe promises zero false positives and logs any as a bug. That is the maker's
  goal, not an outside measurement, so we measure ours before it blocks.
- **Cost:** seconds per state. **Blocks, once measured.** Move: Check.
- **An ARIA snapshot is a golden.** It is part of the exam: a builder never rewrites one. Playwright
  fails a test that writes a new snapshot by default, which helps.

```ts
// A sketch. Layer 3: one page per seeded state, as shots.ts builds it.
const page = await deskPage(seed); // the built dist/, no host, no window
const scan = await new AxeBuilder({page}).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
expect(scan.violations).toEqual([]);
expect(await page.getByRole("main").count()).toBe(1);
expect(await page.getByRole("region").count()).toBe(openTiles(seed));
await expect(page.getByRole("region", {name: /^tracker, t2/})).toMatchAriaSnapshot(`
  - heading "tracker" [level=2]
`); // an exam file: only the owner changes it
```

### Layer 4: layout laws across the tile layouts

- **What it is.** For each of the five layouts (one tile, side by side, stacked, 2x2, a 1024x700
  window), read every part's box with `getBoundingClientRect`, then check ReDeCheck's failure kinds
  as laws. Galen's spec words (`inside`, `near`, `above`) are the same idea, written per size.
- **Catches:** two parts on top of each other, a part out of its tile, a part out of the window, text
  cut with no ellipsis, a title bar too narrow to hold its name and id.
- **Metamorphic laws fit here too:** a tile says the same facts in words at every layout (only how
  many fit may change), and a theme swap moves no box.
- **Misses:** color, taste, and anything that looks wrong while every box is in place.
- **False alarms:** in ReDeCheck's paper the collision, protrusion and viewport-protrusion detectors
  had 0 false positives over 35 true ones; small-range had 43 of 195 (22%), wrapping 5 of 15. So the
  first three are candidates to block, and the other two are not even fit to advise as written.
- **Cost:** seconds per layout. **Blocks the 0% kinds, once measured on our app.** Moves: Gather (the
  boxes), Check (the laws).

```ts
// A sketch. Layer 4: ReDeCheck's kinds as laws, at each tile layout.
const LAYOUTS = ["one", "side-by-side", "stacked", "grid-2x2", "small-window"] as const;
type Box = {id: string; x: number; y: number; w: number; h: number; cut: boolean; ellipsis: boolean};

const broken = (tile: Box, parts: readonly Box[], window: Box): string[] => [
	...pairsOf(parts).filter(([a, b]) => overlaps(a, b)).map(([a, b]) => `collision ${a.id} ${b.id}`),
	...parts.filter((p) => !inside(p, tile)).map((p) => `out of tile ${p.id}`),
	...parts.filter((p) => !inside(p, window)).map((p) => `out of window ${p.id}`),
	...parts.filter((p) => p.cut && !p.ellipsis).map((p) => `cut text ${p.id}`),
];
// Metamorphic: the same facts at every layout.
for (const layout of LAYOUTS) expect(factsSaid(await boxesAt(seed, layout))).toEqual(factsOf(seed));
```

### Layer 5: golden images

- **What it is.** One picture per state, layout and look, compared with approved pictures. Skia
  Gold's shape fits best: many approved images per test, an exact hash first, then a fuzzy match
  with a pixel count and a color step, then a person triages what is left.
- **Catches:** any drawn change, including ones no law names.
- **Misses:** whether the change is fine. A golden says "different", never "wrong".
- **False alarms:** no vendor or paper publishes a pixel-diff false alarm rate. The nearest numbers:
  Google saw 1.5% of all test runs flaky and 16% of tests with some flakiness; in GraphicsFuzz, 407
  of 975 image pairs flagged by a histogram oracle were judged no different by two of three people
  (42%). Fonts, animation, anti-aliasing and the platform are the known causes, so baselines are
  kept per platform.
- **Cost:** seconds to shoot, plus a person for every real change. Visual tests on Chromatic pull
  requests went with 3.8 times longer to merge and 10 times more comments (Watanabe et al., 2026;
  those pull requests were also larger, so it is not all the tests' fault).
- **Advises,** until our own flake rate is measured near 0 on one pinned renderer.
- **The baseline is the exam.** Chromatic says it cannot stop a person approving their own review.
  We can: a new approved image is the owner's change, never a builder's.
- Moves: Check (the diff), then Ask (the owner rates).

```ts
// A sketch. Layer 5: Skia Gold's shape. Many approved images; exact first, then fuzzy, then a person.
type Golden = {
	readonly key: {state: string; layout: Layout; look: Look; renderer: string};
	readonly approved: readonly Hash[]; // the exam: only the owner adds one
	readonly fuzzy: {maxPixels: number; delta: number}; // set from measured runs, never a default
};
const compare = (g: Golden, shot: Png) =>
	g.approved.includes(hashOf(shot)) ? {_tag: "same"}
	: g.approved.some((a) => fuzzyEqual(shot, imageOf(a), g.fuzzy)) ? {_tag: "close"}
	: {_tag: "ask", who: "owner", for: "look", shot};
```

### Layer 6: a measured model judge

- **What it is.** A vision model looks at one shot and answers one rule row at a time: "the focused
  tile says so without color", "no word is cut". A typed answer, never free text, and a floor applied
  in `update` (the Judge move).
- **Catches:** rule rows no code states yet, at any layout.
- **Misses:** what is not on a row; small details at screen scale (UICrit's box placement scored
  0.004 IoU from a screenshot alone).
- **False alarms, measured elsewhere:** GPT-4 doing heuristic review was "not accurate" on 29% of its
  findings, rising to 35% when reused (Duan et al., CHI 2024); 87% of Gemini's raw critiques were
  invalid (UICrit); GPT-4V picked the better of two designs 52% of the time, near chance, where the
  tuned UIClip got 75%. Narrow factual questions do better: OwlEye spots display issues at 85%
  precision.
- **The ceiling is people.** Designers agree with each other at Krippendorff's alpha 0.37 (UIClip)
  and Fleiss' kappa 0.29 (UICrit). A judge of taste cannot reach 0% against a ground truth that
  people do not share. A judge of a narrow fact can.
- **Cost:** a screenshot is about 1,000 to 1,800 tokens on Claude. **Advises,** and only after it is
  measured on our own planted set: up to 10% to advise, about 0% to block.

```ts
// A sketch. Layer 6: one rule row per call, a typed answer, measured before it is trusted.
type RowVerdict =
	| {_tag: "holds"}
	| {_tag: "breaks"; where: Box; why: string}
	| {_tag: "cannot_tell"}; // the honest exit; never counted as a pass
const rows = ["focus is said without color", "no word is cut", "an ask has its mark"] as const;
// Advice only, until 40 planted and 40 clean shots show its false alarms under 10%.
```

### Layer 7: a person

- **What it is.** The owner looks, and the person who needs it most tries it: a screen reader user,
  a low-vision user, someone color-blind. [Color principles](../docs/direction/color-principles.md)
  already says it: numbers check, eyes pick.
- **Catches:** taste, real use, what a screen reader says out loud, what was never written down.
- **Misses:** whatever they do not look at, and they tire.
- **Barr et al.'s survey ends here too:** the final source of test oracle information remains the
  human. So the other six layers exist to make this part small and aimed.
- **Aim it the medical way:** IEC 62366 and the FDA's guidance test the critical tasks hardest, the
  ones where a use error does harm. Ours: approving the wrong pull request, missing an ask, typing
  into the wrong tile.
- **Decides.** Move: Ask. Each rating is a fact, so each layer's false alarms can be counted
  ([every finding is rated](../docs/direction/every-finding-is-rated.md)).

```ts
// A sketch. Layer 7: the person gets only what no law explained, with the layer that flagged it.
{_tag: "ask", who: "owner", for: "look", shots: unexplained, flagged: ["golden", "judge"]}
// the answer is a rating per finding: "fix" or "noise", so each layer's false alarm rate is counted
```

## Prior work

### The oracle problem

- **The survey.** Barr, Harman, McMinn, Shahbaz and Yoo (IEEE TSE 2015) sort test oracles into
  specified, derived, implicit, and none at all. With none, the oracle is a person, and the cost is
  split into how much they must check and how hard it is to read
  ([PDF](https://web.eecs.umich.edu/~weimerw/2018-481/readings/testoracles.pdf)).
  - For us: layer 1 and 2 laws are specified oracles, layer 4 and the metamorphic laws are derived,
    "no crash, no axe error" is implicit, and layer 7 is the human oracle.
- **Metamorphic testing.** When the right output is unknown, check a relation between two runs.
  Two surveys cover it: Chen et al. (ACM CSUR 2018) and Segura et al. (IEEE TSE 2016), each over
  about 119 papers *(both could not open; counts from search results)*.
- **GraphicsFuzz** (Donaldson, Evrard, Lascu, Thomson, OOPSLA 2017,
  [PDF](https://www.doc.ic.ac.uk/~afd/homepages/papers/pdfs/2017/OOPSLA.pdf)).
  - Rewrite a shader so its meaning stays the same, render both, and treat a different picture as
    a likely bug.
  - 17 GPU and driver setups, every major GPU maker, more than 60 distinct bugs, each maker fixed at
    least one. Two were security bugs (a Chrome WebGL leak, a Windows 10 crash from a web page).
  - Of 975 flagged image pairs, 407 (42%) were judged no different by two of three people. "Is this
    difference fine?" is hard even for people.
  - Google bought GraphicsFuzz in 2018 ([VentureBeat](https://venturebeat.com/mobile/google-acquires-graphicsfuzz-for-its-mobile-graphics-card-benchmarking));
    its tests went into the Vulkan conformance suite
    ([CTS 1.1.6.0 notes, a mirror](https://fuchsia.googlesource.com/third_party/vulkan-cts/+/refs/tags/vulkan-cts-1.1.6.0)).
- **Metamorphic checks of rendering and GUIs.**
  - Janus (ICSE 2025): a small HTML change should change every browser's picture or none. 34 bugs,
    26 confirmed ([page](https://conf.researchr.org/details/icse-2025/icse-2025-research-track/6/Janus-Detecting-Rendering-Bugs-in-Web-Browsers-via-Visual-Delta-Consistency)).
  - Metamong (ESEC/FSE 2023): a page built step by step should look the same as the page built at
    once. 19 new bugs, all confirmed ([page](https://2023.esec-fse.org/details/fse-2023-research-papers/95/Metamong-Detecting-Render-update-Bugs-in-Web-Browsers-through-Fuzzing)).
    This is the closest fit to a tea app.
  - Mozilla's fuzzer (2012) compares a snapshot right after DOM changes with one after a forced
    relayout, with no idea of the right picture ([post](https://www.squarefree.com/2012/03/03/fuzzing-for-consistent-rendering/)).
  - Genie (OOPSLA 2021): Android mutant tests that should keep app properties. 34 new non-crash bugs,
    a 40.9% true positive rate ([page](https://2021.splashcon.org/details/splash-2021-oopsla/60/Fully-Automated-Functional-Fuzzing-of-Android-Apps-for-Detecting-Non-crashing-Logic-B)).

### Visual regression and snapshot tests

- **Playwright `toHaveScreenshot`.** Defaults: `threshold` 0.2, animations off, caret hidden. Options
  `maxDiffPixels`, `maxDiffPixelRatio`, `mask`. Baselines are stored per browser and platform,
  because pictures differ with OS, fonts, hardware and headless mode
  ([docs](https://playwright.dev/docs/test-snapshots)).
- **pixelmatch** ignores anti-aliased pixels by default; v8 moved its color distance from YIQ to OKLab
  ([repo](https://github.com/mapbox/pixelmatch), [releases](https://github.com/mapbox/pixelmatch/releases)).
  **SSIM** compares local structure after normalizing light and contrast
  ([Wang et al. 2004](https://www.cns.nyu.edu/pub/eero/wang03-reprint.pdf)). **LPIPS** uses deep
  features and beats older metrics against human judgments
  ([Zhang et al. 2018](https://arxiv.org/abs/1801.03924)).
- **Chromatic and Storybook.** Default threshold 0.063; a flake filter renders each test more than
  once and drops unstable ones; TurboSnap shoots only stories whose code changed; baselines per
  browser; fonts loaded in more than one pass cause unstable shots
  ([threshold](https://www.chromatic.com/docs/threshold/), [flake filter](https://www.chromatic.com/docs/flake-filter/),
  [TurboSnap](https://www.chromatic.com/docs/turbosnap/), [fonts](https://www.chromatic.com/docs/font-loading/)).
  Its review cannot stop a person approving their own change ([review](https://www.chromatic.com/docs/review/)).
- **Percy** says its review agent makes reviews "up to 3x faster" and filters up to 40% of changes:
  vendor claims with no method ([release note](https://www.browserstack.com/release-notes/en/introducing-percys-visual-review-agent-iqB3J3UT)).
  Its own docs warn the AI "may occasionally miss or misinterpret changes"
  ([docs](https://www.browserstack.com/docs/percy/ai-agents/visual-review-agent/overview)).
- **Applitools** match levels: Strict, Layout, Ignore Colors, Dynamic, Exact
  ([docs](https://applitools.com/docs/eyes/concepts/best-practices/match-levels)). "99.9999%
  accuracy" and "zero variance" are marketing with no method.
- **BackstopJS** renders in Docker because environments draw the same page differently;
  `misMatchThreshold` defaults to 0.1% ([repo](https://github.com/garris/BackstopJS)).
- **Flakiness.**
  - Google, 2016: 1.5% of test runs flaky, 16% of tests flaky at least once, 84% of pass-to-fail
    changes involved a flaky test ([post](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html)).
  - Romano et al. (ICSE 2021), 235 flaky UI tests: async waits 45.1% (animation timing 11.1%),
    environment 18.7%. Turning animations off fixed only 1.7% ([paper](https://ar5iv.labs.arxiv.org/html/2103.02669)).
- **Review cost.**
  - Saab and Siemens (Alégroth et al., IST 2016): visual GUI scripts took 252 minutes each to write;
    at Siemens upkeep took up to 60% of weekly testing time ([paper](https://ar5iv.labs.arxiv.org/html/1602.01226)).
  - Spotify used visual GUI tests for years, then moved to a test interface that does not test the
    GUI as shown ([EMSE 2017](https://research.chalmers.se/en/publication/252532)).
  - Watanabe et al. (2026): 307 Chromatic pull requests across 103 repos took 3.8 times longer to
    resolve and had 10 times more comments than pull requests with only images; they were also 1.75
    to 4.5 times larger ([arXiv](https://arxiv.org/abs/2608.07020)).
  - "Beyond Pixel Diffs" (2026): pixel diffs treat noise and defects the same, and the ML tools lack
    public evaluation ([arXiv](https://arxiv.org/abs/2607.01728)).
- **Snapshot and approval tests.**
  - ApprovalTests: output goes to `.received`, a person renames it to `.approved`
    ([repo](https://github.com/approvals/ApprovalTests.Java)).
  - The critique: people "nuke the snapshot and record a fresh passing one"; keep snapshots small
    ([Kent C. Dodds](https://kentcdodds.com/blog/effective-snapshot-testing), quoting Justin Searls).
  - Fujita et al. (ICSME 2023): in about 1,500 repos, 8.2% of commits change snapshot files
    ([summary](https://sdlab.naist.jp/en/post/fujita-icsme2023/); full paper not read).
- **How teams keep false alarms down:** baselines per platform, rendering in a container, animations
  and caret off, masks over changing parts, local fonts, anti-aliasing ignored, re-rendering to find
  flakes, and one component per test.

### Layout failures

- **ReDeCheck** (Walsh, Kapfhammer, McMinn, ISSTA 2017,
  [PDF](https://eprints.whiterose.ac.uk/id/eprint/116989/10/c50-3.pdf)).
  - No expected layout needed: it checks a page stays consistent across a range of widths.
  - A responsive layout graph: parts as nodes, alignment and containment as edges, each with the
    widths where it holds.
  - Five kinds: element collision, element protrusion, viewport protrusion, small-range layout,
    wrapping.
  - 33 distinct failures in 16 of 26 real pages. Raw reports: 197 true, 48 false, 83 that no person
    could see. Precision about 80%, or 60% if the unseen ones count as noise (our arithmetic; the
    paper states none).
  - The false ones were all small-range (43) and wrapping (5): parts that lined up by chance at a few
    widths. Collision and both protrusions had none.
  - Checking only common device widths found 66 to 81% of what it found.
- **Follow-ups.** ASE 2015 found 91% of planted layout faults
  ([PDF](https://gregorykapfhammer.netlify.app/download/research/papers/key/Walsh2015-paper.pdf)).
  STVR 2020 compares the layout graphs of two versions ([record](https://eprints.whiterose.ac.uk/id/eprint/163400)).
  Viser (ICST 2019) confirms a DOM report by changing opacity and comparing pixels, 87.2% agreement
  with people ([PDF](https://eprints.whiterose.ac.uk/id/eprint/230100/1/althomali2019.pdf)). Verve
  (STVR 2021) classifies 469 reports, 86.3% agreement on collision and protrusion
  ([record](https://eprints.whiterose.ac.uk/id/eprint/165542/)).
- **Cross-browser.** XFix (ISSTA 2017) repairs layout issues by searching CSS and fixed 86% across 15
  pages ([PDF](https://eprints.whiterose.ac.uk/116990/7/c48.pdf)). X-PERT (ICSE 2013) finds them
  ([page](https://2013.icse-conferences.org/content/x-pert-accurate-identification-cross-browser-issues-web-applications.html);
  its 76% precision and 95% recall *could not open*). WebSee (ICST 2015) finds presentation failures
  with computer vision *(could not open)*.
- **Galen** states layout per size in words: `near`, `above`, `inside`, `width`, `aligned`, with
  `@on mobile` tags, run at a given size ([spec](https://galenframework.com/docs/reference-galen-spec-language-guide/),
  [command line](https://galenframework.com/docs/reference-working-in-command-line/)).
- **Constraint layouts.** Cassowary solves linear equalities and inequalities incrementally, with
  UI examples like inside, above and left-of ([TOCHI paper](https://constraints.cs.washington.edu/solvers/cassowary-tochi.pdf));
  its page says it became the Mac's layout engine in 2011 ([page](https://constraints.cs.washington.edu/cassowary/)).
  Apple writes each constraint as `item1.attr = multiplier * item2.attr + constant`, with priorities
  1 to 1000 ([Auto Layout guide](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/AutolayoutPG/AnatomyofaConstraint.html)).
  - For us: the same relations a layout engine solves can be checked afterward as laws.
- **Newer.** ReFLAIR (FSE 2026) checks reflowed pages with a generative model
  ([project](https://ics.uci.edu/~seal/projects/ReFLAIR/)). XBIDetective (2025) uses a tuned vision
  model on 1,052 sites, 79% accuracy on cross-browser differences ([arXiv](https://arxiv.org/abs/2512.15804)).

### Model-based and property-based UI tests

- **Quickstrom** (O'Connor and Wickström, PLDI 2022): properties in a temporal logic over web app
  states. Faults in 20 of 43 TodoMVC versions, one of them doubtful ([arXiv](https://arxiv.org/abs/2203.11532)).
- **QuickCheck state machines.** Over 3,000 pages of AUTOSAR spec modeled, over 200 issues found
  ([Arts et al. 2015](https://research.chalmers.se/en/publication/219899); also
  [Hughes 2016](https://research.chalmers.se/en/publication/232550)).
- **fast-check.** `fc.commands`, `modelRun`, `asyncModelRun`, `scheduledModelRun` for races, and
  `fc.scheduler()`. The docs warn the model should not be a copy of the system
  ([model-based](https://fast-check.dev/docs/advanced/model-based-testing/), [races](https://fast-check.dev/docs/advanced/race-conditions/)).
- **Elm.** elm-program-test drives a whole program with `clickButton` and `expectViewHas`, with
  effects simulated ([repo](https://github.com/avh4/elm-program-test), [effects](https://elm-program-test.netlify.app/cmds.html)).
  elm-test fuzzes 100 runs by default ([repo](https://github.com/elm-explorations/test)). Elm's
  debugger imports and exports the exact list of events, and says why an old history no longer fits
  ([post](https://elm-lang.org/news/the-perfect-bug-report)). Redux DevTools replays, reorders and
  can generate tests from actions ([repo](https://github.com/reduxjs/redux-devtools)).
- **Crawljax** clicks through an AJAX app and builds a state graph
  ([TWEB 2012](https://people.ece.ubc.ca/amesbah/resources/papers/tweb-final.pdf)); its invariants
  as oracles caught 8 of 10 planted faults on one app; the 2 missed never touched the DOM
  ([TSE 2012](https://people.ece.ubc.ca/amesbah/resources/papers/tse11.pdf)).
- **Android.** Monkey sends seeded random events ([docs](https://developer.android.com/studio/test/other-testing-tools/monkey)),
  and on 68 apps it beat six research tools on coverage and failures found
  ([Choudhary et al. 2015](https://ar5iv.labs.arxiv.org/html/1503.07217)). Sapienz found 558 new crashes
  in 1,000 popular apps and won ISSTA's most influential paper award in 2026
  ([Meta](https://engineering.fb.com/2026/10/15/developer-tools/sapienz-issta-2026-impact-paper-award-meta/));
  at Facebook, "75 percent of Sapienz reports are actionable" ([Meta](https://engineering.fb.com/developer-tools/sapienz-intelligent-automated-software-testing-at-scale/)).
  Stoat learns a model of screens with odds per move: 3 times Monkey's unique crashes on 93 apps
  ([PDF](https://tingsu.github.io/files/fse17-stoat.pdf)). DroidBot builds a transition graph as it
  goes ([repo](https://github.com/honeynet/droidbot)).
- **What fits a tea app.** The machine is already the model, so there is no copy to keep in step. The
  generators exist (`@demlik/tea/pbt`, one per Msg type). What Crawljax and Monkey add is the drawn
  page: run the same random Msgs, then render and check layers 3 and 4 at the end of each list.

### Accessibility checks

- **axe-core** promises "zero false positives (bugs notwithstanding)" and says it finds on average 57%
  of WCAG issues ([repo](https://github.com/dequelabs/axe-core), [Deque](https://www.deque.com/axe/axe-core/)).
- **Deque's study** (2021): over 2,000 audits, 13,000 pages, nearly 300,000 issues; 57% by volume,
  pushed up by a few very common kinds. Deque ran it and sells the tool
  ([post](https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/)).
  The often-repeated "tools check 20 to 30% of success criteria" has no primary source we could find.
- **gov.uk** (2017): 143 barriers, 10 tools. The best found 41%, all together 71%, and 29% were
  missed by every tool ([post](https://accessibility.blog.gov.uk/2017/02/24/what-we-found-when-we-tested-tools-on-the-worlds-least-accessible-webpage/)).
- **Playwright** has ARIA snapshots in YAML, with partial matching
  ([docs](https://playwright.dev/docs/aria-snapshots)), and axe through `@axe-core/playwright`, with
  the warning that automated tests cannot find every WCAG violation
  ([docs](https://playwright.dev/docs/accessibility-testing)).
- **Screen readers.** Guidepup drives VoiceOver, NVDA and Orca from one API
  ([repo](https://github.com/guidepup/guidepup)); its virtual screen reader follows the W3C name
  rules over the DOM and adds to real runs, not replaces them
  ([repo](https://github.com/guidepup/virtual-screen-reader)). W3C's AT Driver, a WebSocket protocol
  to drive a screen reader and capture what it says, is an Editor's Draft of 2026-09-05
  ([draft](https://w3c.github.io/at-driver/)). ARIA-AT tests screen reader support for ARIA patterns
  ([repo](https://github.com/w3c/aria-at); [site](https://aria-at.w3.org/) *could not open*).
- **Contrast.** WCAG 2.2: 4.5:1 for text, 3:1 for large text, needed lines and states
  ([1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html),
  [1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)). WCAG 3's draft of
  2026-09-10 says its contrast measure is "yet to be determined" ([draft](https://www.w3.org/TR/wcag-3.0/)).
  APCA was taken out of the WCAG 3 draft in 2023 ([a blog, not a W3C record](https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html));
  its own levels are Lc 75 minimum for body text, 60 other text, 45 headlines
  ([APCA in a nutshell](https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell)).
  [Themes](../docs/direction/themes.md) lists WCAG or APCA as open; this says WCAG 2 stays the bar.
- **Color vision.** Machado, Oliveira and Fernandes (2009) model all degrees of color deficiency
  ([paper](https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html)).
  Chrome's emulation uses their matrices, full deficiency only ([Chrome](https://developer.chrome.com/blog/cvd)).

### Models as UI judges

- **Rico** (UIST 2017): 72,219 screens from 9,772 Android apps per the paper; the site now says over
  66,000 ([chapter](https://bardiadoosti.github.io/Papers/aiforhci/rico.pdf), [site](https://interactionmining.org/rico)).
- **UICrit** (UIST 2024): 3,059 critiques of 983 screens by 7 designers. Few-shot and visual prompts
  lifted critique quality from 0.31 to 0.48 (55%), people scored 0.75, and experts preferred the
  human set 81% of the time. Only 13.1% of 5,927 raw Gemini comments were valid
  ([arXiv](https://arxiv.org/html/2407.08850)).
- **UIClip** (2024; the venue is not on the arXiv page): picks the better design 75.12% of the time;
  GPT-4V 51.58%. Designers agree at alpha 0.37 ([arXiv](https://arxiv.org/html/2404.12500)).
- **Duan et al.** (CHI 2024), GPT-4 heuristic review in a Figma plugin: 52% accurate, 19% partly,
  29% not; precision 0.60 and recall 0.38 against experts' 0.83 and 0.34; worse on reuse
  ([arXiv](https://arxiv.org/html/2403.13139v1)).
- **ScreenAI** (Google, 2024), about 5B parameters, best on several screen QA sets
  ([arXiv](https://arxiv.org/abs/2402.04615)). **Ferret-UI** and **Ferret-UI 2** (Apple, 2024) point
  at and find parts of a screen ([1](https://arxiv.org/abs/2404.05719), [2](https://arxiv.org/abs/2410.18967);
  abstracts only, no numbers read).
- **Display issue detection.** OwlEye (ASE 2020): 85% precision, 84% recall; 57 new issues, 26
  confirmed ([arXiv](https://arxiv.org/abs/2009.01417)). Nighthawk (IEEE TSE 2022): 0.84 and 0.84; 151
  new, 75 confirmed ([arXiv](https://arxiv.org/abs/2205.13945)).
- **GUI agent benchmarks ship checkers.** WebArena checks the end state through database queries,
  APIs and selectors; its GPT-4 fuzzy match agreed with people on 39 of 40
  ([arXiv](https://arxiv.org/html/2307.13854)). VisualWebArena adds a model asked about a screenshot
  and an SSIM match ([arXiv](https://arxiv.org/html/2401.13649)). OSWorld has 134 scoring functions
  for 369 tasks; people 72.36%, best model then 12.24% ([arXiv](https://arxiv.org/abs/2404.07972)).
  - For us: score the end state with code (the model, the DOM), and use a model only for what code
    cannot read.
- **Judge reliability.** GPT-4 as a text judge agrees with people over 80%, as people do with each
  other, with position, length and self biases ([arXiv](https://arxiv.org/abs/2306.05685)). As a
  vision judge, GPT-4V does well on pairs (0.77 without ties) and badly on scores (Pearson 0.49);
  longer answers scored higher ([arXiv](https://arxiv.org/html/2402.04788)).

### Agent-built UI, 2024 to 2026

| Work | What is checked | Numbers | Measured or marketing |
|---|---|---|---|
| [Design2Code](https://arxiv.org/html/2403.03163) (2024) | a page built from a screenshot | 484 pages; 49% judged exchangeable | measured |
| [WebGen-Bench](https://arxiv.org/abs/2505.03733) (2025) | an agent clicks through the built site | 647 tests; best 27.8% | measured |
| [Interaction2Code](https://arxiv.org/abs/2411.03292) (2025) | interactions, not only static pages | 127 pages, 374 interactions, 10 failure kinds | measured |
| [FrontendBench](https://arxiv.org/abs/2506.13832) (2025) | test scripts in a sandbox | 148 cases; 90.54% agreement with experts | measured |
| [ArtifactsBench](https://arxiv.org/abs/2507.04952) (2025) | a model judge with a checklist per task and screenshots | 1,825 tasks; 94.4% model ranking match, over 90% pairwise | measured; the 94.4% ranks models, not items |
| [v0](https://vercel.com/blog/v0-composite-model-family) | errors fixed mid-stream, then a linter | 93.87% "error-free" | the maker's own eval; error-free is not right |
| Percy, Applitools | AI review of diffs | "3x", "40%", "100% reproducible" | marketing |

- Anthropic's computer use docs warn the model "sometimes acts as if its actions succeeded" and
  suggest a screenshot after each step ([docs](https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/computer-use-tool)).
- Playwright MCP gives agents accessibility snapshots instead of pictures
  ([repo](https://github.com/microsoft/playwright-mcp)).
- The pattern in the measured work: scripted checks first, then a judge held to a checklist, and the
  judge's agreement with people measured before it was scaled.

## What other fields teach us

*Intuition, marked as intuition. Each idea links to the source it grew from; how well it carries
over to fabrika is a guess until an experiment below tries it.*

| Field | What they do | What we could borrow | Why |
|---|---|---|---|
| Chip design | measure the checks with planted faults (Certitude) | UI mutants: plant breaks and count which layer catches each | a block at 100% coverage had a checker that "was never enabled" |
| Games and graphics | Skia Gold, Mesa trace replay, sync tests | many approved images per state, replay recorded Msgs, the same result twice before trust | accepts honest variation, makes flake a bug |
| Cars | a signature over a few named regions, plus freeze detection | a per-frame check of the few must-see marks: your turn, an ask, focus | aimed at what can hurt, cheap, exact |
| Cockpits | ARINC 661 widgets as data; a qualified generator | check the parts and tokens once, keep screens as data | a screen built from checked parts needs fewer checks |
| Medical devices | critical tasks first; at least 15 users per group | name our few critical tasks and test those with people | ranks checks by harm, not screen count |
| Print | named, versioned preflight profiles; fewer false positives | a named UI profile per screen, with its false alarms counted | noisy checks get ignored |
| Film | a reference chart through the same pipeline | one swatch page every theme must draw | pins edge cases beside real content |
| Design systems | token lint with auto-fix | no raw color, size or space, fixed in place | the cheapest check there is |

- **Chip design: measure the checks, not the coverage.**
  - Verification takes about half of a chip project's time, unchanged since 2012 (53% in 2018,
    [Siemens](https://blogs.sw.siemens.com/verificationhorizons/2019/01/29/part-8-the-2018-wilson-research-group-functional-verification-study/)).
    The often-quoted 70% is not in this study. Only 14% of projects got first silicon right in 2024
    ([Siemens](https://resources.sw.siemens.com/de-CH/white-paper-2024-wilson-research-group-ic-asic-functional-verification-trend-report/)).
  - Analog Devices injected faults with Certitude: teams at 100% code and functional coverage found
    up to 30% of faults were seen by no checker, and one checker "was never enabled"
    ([DVCon paper](https://dvcon-proceedings.org/wp-content/uploads/whos-watching-the-watchmen-the-time-has-come-to-objectively-measure-the-quality-of-your-verification-environment.pdf)).
  - Our intuition: screenshots taken and nobody comparing them is the same gap. Planted UI breaks
    (a token swapped, a word dropped, a box pushed out) measure the layers the way
    [fast mutation](../docs/direction/fast-and-daily-mutation.md) measures tests. Functional coverage
    maps too: a list of states times layouts times looks, and a count of which ones any check reached.
  - Assertions bound to the design (SVA, PSL) are our laws; UVM is a standard testbench
    ([IEEE 1800.2](https://accellera.org/news/press-releases/239-ieee-1800-2-for-uvm-approved-as-an-ieee-standard)).
- **Games and graphics: accept variation, refuse drift.**
  - Skia Gold allows many approved images per test, tries an exact hash first, then a fuzzy match by
    pixel count and step, and a person triages the rest
    ([Skia](https://skia.org/docs/dev/testing/skiagold/), [Chromium](https://chromium.googlesource.com/chromium/src/+/main/ui/base/test/skia_gold_matching_algorithm.h),
    [fuzzy](https://pkg.go.dev/go.skia.org/infra/gold-client/go/imgmatching/fuzzy)). One mode allows
    one image only and calls that a known trade: owners see every change, at a higher upkeep.
  - Mesa CI replays recorded app traces per driver and compares each frame's checksum; public traces
    fail the pipeline, restricted ones may fail ([Mesa CI](https://docs.mesa3d.org/ci/index.html),
    [traces](https://docs.mesa3d.org/ci/local-traces.html)).
  - GGPO's sync test rolls back and re-runs frames, then compares checksums
    ([GGRS docs](https://docs.rs/crate/ggrs/0.12.0/source/docs/sessions.md); GGPO's own docs *could not open*).
  - King trained a network on real player moves to judge a level's difficulty in under a minute,
    where human playtests took 7 days for 15 levels ([paper](https://www.gwern.net/doc/reinforcement-learning/imitation-learning/2018-gudmundsson.pdf)).
    EA's agents add to scripted bots and do not replace them ([arXiv](https://arxiv.org/abs/2307.11105)).
  - Our intuition: the ledger is our trace. Replaying a real day's Msgs through today's view and
    tomorrow's, and diffing what each says, is Mesa's job on our data.
- **Cars: check the few marks that matter, every frame.**
  - TI's display hardware runs a signature over up to four safety regions per output, checking the
    pixels are right and the picture is not frozen, built for ASIL-B
    ([TI](https://www.ti.com/document-viewer/lit/html/SPRAD00/GUID-DC7F1113-0B61-466A-ABB2-6A5686C9FDA4),
    [SDK](https://software-dl.ti.com/mcu-plus-sdk/esd/AM62PX/10_00_00_14/exports/docs/api_guide_am62px/DRIVERS_DSS_PAGE.html)).
  - NHTSA's proposed rule: glances under 2 seconds, 12 seconds off the road per task at most, judged
    against a reference task ([Federal Register 2012](https://www.govinfo.gov/content/pkg/FR-2012-02-24/pdf/2012-4017.pdf)).
    ISO 15005 sets dialogue rules for a moving driver ([summary](https://ccn-scc.ca/standardsdb/standards/8161815)).
  - Our intuition: "your turn", an ask's mark and the focused tile are our telltales. Each gets its
    own small check per state at every layout, apart from the whole-picture golden.
- **Cockpits: check the generator, keep screens as data.**
  - ARINC 661 keeps each application's widget tree in a definition file, loaded by the display
    system at start, so the display changes without new code there
    ([summary](https://en.wikipedia.org/wiki/ARINC_661); the standard is paywalled).
  - SCADE Display's code generator is qualified under DO-178C and DO-330, so its output needs less
    checking ([vendor](https://ansys.synopsys.com/products/embedded-software/ansys-scade-display)).
    DO-330 asks more of a tool whose output replaces other checks than of one that only adds evidence
    ([LDRA brief](https://ldra.com/wp-content/uploads/ldra/DO-330-Test-Tool-Qualification-Technical-Briefing-v2.0.pdf)).
  - Our intuition: check Manti's parts and our tokens once, deeply, and keep each screen a thin tree
    of checked parts. DO-330's line is our block-or-advise line: a check that lets a pull request
    skip a person needs the 0% proof; a check that only adds a note does not.
- **Medical devices: rank by harm.**
  - The FDA's human factors guidance, reissued 2026-08-03, names critical tasks (a wrong or missed one
    could cause serious harm), uses formative rounds to find problems, and asks at least 15 people per
    user group in the final test ([FDA](https://www.fda.gov/media/80481/download)). IEC 62366-1 sets the
    process ([IEC](https://webstore.iec.ch/en/publication/21863)).
  - Our intuition: the owner's minutes go to a short list of critical tasks, not to every screen.
- **Print: a named profile, and fewer false positives.**
  - PDF/X (ISO 15930) fixes what a print file must hold: embedded fonts, a declared output intent
    ([summary](https://en.wikipedia.org/wiki/PDF/X)). The Ghent Workgroup's 2022 work aimed at fewer
    flags "which will not cause production problems" ([trade press](https://printbusiness.co.uk/?p=17678);
    gwg.org, Acrobat and callas docs *could not open*).
  - Our intuition: a screen declares the profile it meets ("WCAG 2.2 AA, five layouts, both looks"),
    and the pack checks that profile. Print learned our CACM rule the hard way.
- **Film: a chart beside the content.**
  - ACES ships reference images to run through your pipeline and compare
    ([ACES](https://acescentral.com/knowledge-base-2/using-aces-reference-images/)); OpenColorIO manages
    color across the tools ([OCIO](https://opencolorio.org/)).
  - Our intuition: one swatch page that draws every token in every theme, shot at each layout, is a
    cheap golden that catches theme breaks before any real screen.
- **Design systems: lint at write time.** Atlassian, Primer and (until 2026) Polaris lint raw values
  ([Atlassian](https://atlassian.design/components/eslint-plugin-design-system/ensure-design-token-usage/usage),
  [Primer](https://github.com/primer/stylelint-config), [Polaris](https://github.com/Shopify/polaris/tree/main/stylelint-polaris)).
  We found no published numbers on what they catch.

## Experiments to run next

Each is small. No paid run now. Costs are guesses at
[600 lines an agent hour](../docs/direction/agent-hours.md). Model prices are list prices from
[Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing), read 2026-11-02:
Sonnet 5.5 at $2 a million tokens in and $10 out, Opus 5.5 at $4 and $20.

| # | Experiment | What it settles | Agent hours | Dollars |
|---|---|---|---|---|
| A | UI mutants: plant about 30 breaks (a token, a word, a box, a role) and run today's checks | how much today's checks miss, Certitude's question | 2 | $0 |
| B | Layout laws at the five layouts and 1024x700 in `shots.ts`, on 20 seeded states, with 10 planted CSS breaks | layer 4's catches and false alarms on our app | 3 | $0 |
| C | axe and ARIA laws on the same pages, both looks; rate each finding by hand | layer 3's false alarms; whether axe's 0% holds here | 1.5 | $0 |
| D | Golden flake rate: one state shot 100 times locally and 100 on CI's macOS runner; exact hash and pixelmatch | whether layer 5 can ever block | 1.5 | $0 |
| E | Metamorphic laws: same words at every layout, same boxes in every theme, step by step against fresh | how many of A's breaks need no golden | 2 | $0 |
| F | Model judge on 40 clean and 40 planted shots, 8 rule rows, 640 calls | layer 6's false alarms and catches per row | 2 | about $3.80 on Sonnet 5.5, $7.60 on Opus 5.5 |
| G | Virtual screen reader, then one VoiceOver run with Guidepup, on one tile region | what VoiceOver says; how far the virtual one gets | 3 | $0 |
| H | UI state coverage: list states, layouts and looks; count what e2e and shots reach | the size of the gap, chip-style | 1 | $0 |

- **F's cost, worked out:** 640 calls at about 1,800 image tokens plus 400 prompt tokens in, 150
  out: 1.4 million in and 0.1 million out. That is $2.80 plus $1.00 on Sonnet 5.5, and twice that
  on Opus 5.5. Set a stop at $10. Try 10 calls first and look at the answers.
- **Order:** A first, since it is free and tells every other experiment what to aim at. Then B and C
  together, D, E, and F last. G needs the owner's Mac and its accessibility permission.
- **Load:** B, C and D render pages. Run them under `nice -n 15`, one browser at a time, with a test
  `FABRIKA_HOME` of their own.

## What this cannot tell us

- **Nothing here ran on our app.** Every false alarm number is someone else's, on someone else's
  pages. Our layouts are tiles inside one window, not responsive pages, so ReDeCheck's numbers may
  not carry over.
- **No independent false alarm numbers exist for the big visual tools.** Percy, Applitools and
  Chromatic publish claims, not methods.
- **The model judge numbers are old models on other tasks.** GPT-4V in 2024 is not today's models,
  and none of the studies asked narrow rule rows like ours. Experiment F settles our case.
- **People disagree.** With designers at alpha 0.37, a "right answer" for taste does not exist to
  measure against. Only narrow, factual rows can have a false alarm rate near 0.
- **Accessibility shares are by issue count, not by harm.** 57% and 41% say nothing about whether the
  missed issues were the ones that block a person.
- **Gaps in the reading:** the two metamorphic testing surveys, the full Sapienz papers, X-PERT's and
  WebSee's numbers, ARIA-AT's site, GGPO's own docs, ISO 26262 and ISO 2575 on telltales, Renesas'
  display checks, the final NHTSA guidelines, Chromatic's AI features, the Salesforce lint, and Figma
  Variables were not opened. Ferret-UI was read as abstracts only.
- **Where a pack lands is not decided.** Today's `packs/ui-verification` is a stand-in, packs in
  `next/` wait for Tier 7, and the desk and `themes` programs arrive in Tier 2
  ([tiers](../docs/plan/tiers.md)). Layers 1 to 4 could start in today's app's tests long before any
  pack exists.

## Sources

Opened unless marked. Grouped as above.

**The oracle problem**

- Barr et al. 2015, https://web.eecs.umich.edu/~weimerw/2018-481/readings/testoracles.pdf
- Chen et al. 2018, https://dl.acm.org/doi/10.1145/3143561 *(could not open)*
- Segura et al. 2016, https://eprints.whiterose.ac.uk/110335/1/segura16-tse.pdf *(could not open)*
- GraphicsFuzz, https://www.doc.ic.ac.uk/~afd/homepages/papers/pdfs/2017/OOPSLA.pdf
- GraphicsFuzz bought, https://venturebeat.com/mobile/google-acquires-graphicsfuzz-for-its-mobile-graphics-card-benchmarking
- GraphicsFuzz repo, https://github.com/google/graphicsfuzz
- Vulkan CTS 1.1.6.0, https://fuchsia.googlesource.com/third_party/vulkan-cts/+/refs/tags/vulkan-cts-1.1.6.0
- Janus, https://conf.researchr.org/details/icse-2025/icse-2025-research-track/6/Janus-Detecting-Rendering-Bugs-in-Web-Browsers-via-Visual-Delta-Consistency
- Metamong, https://2023.esec-fse.org/details/fse-2023-research-papers/95/Metamong-Detecting-Render-update-Bugs-in-Web-Browsers-through-Fuzzing
- Consistent rendering fuzzing, https://www.squarefree.com/2012/03/03/fuzzing-for-consistent-rendering/
- Genie, https://2021.splashcon.org/details/splash-2021-oopsla/60/Fully-Automated-Functional-Fuzzing-of-Android-Apps-for-Detecting-Non-crashing-Logic-B

**Visual regression and snapshots**

- Playwright screenshots, https://playwright.dev/docs/test-snapshots
- Playwright assertions, https://playwright.dev/docs/api/class-pageassertions
- pixelmatch, https://github.com/mapbox/pixelmatch and https://github.com/mapbox/pixelmatch/releases
- SSIM, https://www.cns.nyu.edu/pub/eero/wang03-reprint.pdf
- LPIPS, https://arxiv.org/abs/1801.03924 and https://github.com/richzhang/PerceptualSimilarity
- Chromatic, https://www.chromatic.com/docs/threshold/, https://www.chromatic.com/docs/flake-filter/,
  https://www.chromatic.com/docs/turbosnap/, https://www.chromatic.com/docs/browsers/,
  https://www.chromatic.com/docs/font-loading/, https://www.chromatic.com/docs/delay/,
  https://www.chromatic.com/docs/review/
- Storybook visual tests, https://storybook.js.org/docs/writing-tests/visual-testing
- Percy, https://www.browserstack.com/percy/ai-agents,
  https://www.browserstack.com/docs/percy/ai-agents/visual-review-agent/overview,
  https://www.browserstack.com/release-notes/en/introducing-percys-visual-review-agent-iqB3J3UT
- Applitools, https://applitools.com/docs/eyes/concepts/best-practices/match-levels,
  https://applitools.com/blog/visual-functional-autonomous-testing-all-in-one/,
  https://applitools.com/introducing-autonomous-by-applitools/
- BackstopJS, https://github.com/garris/BackstopJS
- Google flaky tests, https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html
- Romano et al. 2021, https://ar5iv.labs.arxiv.org/html/2103.02669
- Alégroth et al. 2016, https://ar5iv.labs.arxiv.org/html/1602.01226
- Alégroth and Feldt 2017, https://research.chalmers.se/en/publication/252532
- Watanabe et al. 2026, https://arxiv.org/abs/2608.07020
- Beyond Pixel Diffs, https://arxiv.org/abs/2607.01728
- ApprovalTests, https://github.com/approvals/ApprovalTests.Java
- Effective snapshot testing, https://kentcdodds.com/blog/effective-snapshot-testing
- Fujita et al. 2023, https://sdlab.naist.jp/en/post/fujita-icsme2023/
- LLMShot, https://arxiv.org/html/2507.10062v1

**Layout**

- ReDeCheck, https://eprints.whiterose.ac.uk/id/eprint/116989/10/c50-3.pdf and https://eprints.whiterose.ac.uk/116991/
- Walsh 2015, https://gregorykapfhammer.netlify.app/download/research/papers/key/Walsh2015-paper.pdf
- Walsh 2020, https://eprints.whiterose.ac.uk/id/eprint/163400
- Viser, https://eprints.whiterose.ac.uk/id/eprint/230100/1/althomali2019.pdf
- Verve, https://eprints.whiterose.ac.uk/id/eprint/165542/
- XFix, https://eprints.whiterose.ac.uk/116990/7/c48.pdf
- X-PERT, https://2013.icse-conferences.org/content/x-pert-accurate-identification-cross-browser-issues-web-applications.html (numbers *could not open*)
- WebSee *(could not open)*
- Galen, https://galenframework.com/docs/reference-galen-spec-language-guide/ and https://galenframework.com/docs/reference-working-in-command-line/
- Cassowary, https://constraints.cs.washington.edu/solvers/cassowary-tochi.pdf and https://constraints.cs.washington.edu/cassowary/
- Auto Layout, https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/AutolayoutPG/AnatomyofaConstraint.html
- ReFLAIR, https://ics.uci.edu/~seal/projects/ReFLAIR/
- XBIDetective, https://arxiv.org/abs/2512.15804

**Model-based and property-based**

- Quickstrom, https://arxiv.org/abs/2203.11532
- QuickCheck, https://research.chalmers.se/en/publication/219899 and https://research.chalmers.se/en/publication/232550
- fast-check, https://fast-check.dev/docs/advanced/model-based-testing/ and https://fast-check.dev/docs/advanced/race-conditions/
- elm-program-test, https://github.com/avh4/elm-program-test and https://elm-program-test.netlify.app/cmds.html
- elm-test, https://github.com/elm-explorations/test
- Elm debugger, https://elm-lang.org/news/the-perfect-bug-report
- Redux DevTools, https://github.com/reduxjs/redux-devtools
- Crawljax, https://people.ece.ubc.ca/amesbah/resources/papers/tweb-final.pdf and https://people.ece.ubc.ca/amesbah/resources/papers/tse11.pdf
- Monkey, https://developer.android.com/studio/test/other-testing-tools/monkey
- Choudhary et al. 2015, https://ar5iv.labs.arxiv.org/html/1503.07217
- Sapienz, https://engineering.fb.com/2026/10/15/developer-tools/sapienz-issta-2026-impact-paper-award-meta/ and
  https://engineering.fb.com/developer-tools/sapienz-intelligent-automated-software-testing-at-scale/ (full papers *could not open*)
- Stoat, https://tingsu.github.io/files/fse17-stoat.pdf
- DroidBot, https://github.com/honeynet/droidbot

**Accessibility**

- axe-core, https://github.com/dequelabs/axe-core and https://www.deque.com/axe/axe-core/
- Deque study, https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/
- gov.uk, https://accessibility.blog.gov.uk/2017/02/24/what-we-found-when-we-tested-tools-on-the-worlds-least-accessible-webpage/
- Playwright, https://playwright.dev/docs/aria-snapshots and https://playwright.dev/docs/accessibility-testing
- Guidepup, https://github.com/guidepup/guidepup and https://github.com/guidepup/virtual-screen-reader
- AT Driver, https://w3c.github.io/at-driver/
- ARIA-AT, https://github.com/w3c/aria-at (https://aria-at.w3.org/ *could not open*)
- WCAG 2.2, https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html and https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- WCAG 3, https://www.w3.org/TR/wcag-3.0/
- APCA, https://adrianroselli.com/2026/04/wcag3-contrast-as-of-april-2026.html and https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell
- Color vision, https://www.inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html,
  https://developer.chrome.com/blog/cvd, https://developer.chrome.com/blog/new-in-devtools-83

**Models as judges**

- Rico, https://bardiadoosti.github.io/Papers/aiforhci/rico.pdf and https://interactionmining.org/rico (ACM page *could not open*)
- UICrit, https://arxiv.org/html/2407.08850
- UIClip, https://arxiv.org/html/2404.12500
- Duan et al. 2024, https://arxiv.org/html/2403.13139v1
- ScreenAI, https://arxiv.org/abs/2402.04615
- Ferret-UI, https://arxiv.org/abs/2404.05719 and https://arxiv.org/abs/2410.18967
- OwlEye, https://arxiv.org/abs/2009.01417
- Nighthawk, https://arxiv.org/abs/2205.13945
- WebArena, https://arxiv.org/html/2307.13854
- VisualWebArena, https://arxiv.org/html/2401.13649
- OSWorld, https://arxiv.org/abs/2404.07972 and https://osworld-v1.xlang.ai/
- LLM as judge, https://arxiv.org/abs/2306.05685
- MLLM as judge, https://arxiv.org/html/2402.04788

**Agent-built UI**

- Design2Code, https://arxiv.org/html/2403.03163
- WebGen-Bench, https://arxiv.org/abs/2505.03733
- Interaction2Code, https://arxiv.org/abs/2411.03292
- FrontendBench, https://arxiv.org/abs/2506.13832
- ArtifactsBench, https://arxiv.org/abs/2507.04952
- v0, https://vercel.com/blog/v0-composite-model-family
- Computer use, https://platform.claude.com/docs/en/docs/agents-and-tools/tool-use/computer-use-tool
- Claude Code best practices, https://code.claude.com/docs/en/best-practices
- Playwright MCP, https://github.com/microsoft/playwright-mcp
- Pricing, https://platform.claude.com/docs/en/about-claude/pricing

**Other fields**

- EA SEED, https://arxiv.org/abs/2103.15819, https://arxiv.org/abs/2103.13798, https://arxiv.org/abs/2307.11105
- King, https://www.gwern.net/doc/reinforcement-learning/imitation-learning/2018-gudmundsson.pdf
- Ubisoft La Forge, https://www.ubisoft.com/en-us/studio/laforge/publications
- Skia Gold, https://skia.org/docs/dev/testing/skiagold/,
  https://chromium.googlesource.com/chromium/src/+/main/ui/base/test/skia_gold_matching_algorithm.h,
  https://pkg.go.dev/go.skia.org/infra/gold-client/go/imgmatching/fuzzy
- Mesa CI, https://docs.mesa3d.org/ci/index.html and https://docs.mesa3d.org/ci/local-traces.html
- GGRS, https://docs.rs/crate/ggrs/0.12.0/source/docs/sessions.md (GGPO's own docs *could not open*)
- Factorio, https://wiki.factorio.com/Desynchronization
- Overwatch talks, https://gdcvault.com/play/1024001/-Overwatch-Gameplay-Architecture-and and
  https://gdcvault.com/play/1024053/Replay-Technology-in-Overwatch-Kill (abstracts only)
- Wilson study, https://blogs.sw.siemens.com/verificationhorizons/2019/01/29/part-8-the-2018-wilson-research-group-functional-verification-study/,
  https://blogs.sw.siemens.com/verificationhorizons/2022/12/12/part-8-the-2022-wilson-research-group-functional-verification-study/,
  https://resources.sw.siemens.com/de-CH/white-paper-2024-wilson-research-group-ic-asic-functional-verification-trend-report/
- UVM, https://accellera.org/news/press-releases/239-ieee-1800-2-for-uvm-approved-as-an-ieee-standard
- Certitude at Analog Devices, https://dvcon-proceedings.org/wp-content/uploads/whos-watching-the-watchmen-the-time-has-come-to-objectively-measure-the-quality-of-your-verification-environment.pdf
- ARINC 661, https://en.wikipedia.org/wiki/ARINC_661 (secondary)
- DO-330, https://ldra.com/wp-content/uploads/ldra/DO-330-Test-Tool-Qualification-Technical-Briefing-v2.0.pdf
- SCADE Display, https://ansys.synopsys.com/products/embedded-software/ansys-scade-display
- NHTSA 2012, https://www.govinfo.gov/content/pkg/FR-2012-02-24/pdf/2012-4017.pdf (final guidelines *could not open*)
- ISO 15005, https://ccn-scc.ca/standardsdb/standards/8161815
- ISO 26262 ASIL, https://en.wikipedia.org/wiki/Automotive_Safety_Integrity_Level (secondary; ISO 2575 *could not open*)
- TI display safety, https://www.ti.com/document-viewer/lit/html/SPRAD00/GUID-DC7F1113-0B61-466A-ABB2-6A5686C9FDA4 and
  https://software-dl.ti.com/mcu-plus-sdk/esd/AM62PX/10_00_00_14/exports/docs/api_guide_am62px/DRIVERS_DSS_PAGE.html
- FDA human factors, https://www.fda.gov/media/80481/download
- IEC 62366-1, https://webstore.iec.ch/en/publication/21863
- PDF/X, https://en.wikipedia.org/wiki/PDF/X (secondary)
- Ghent Workgroup 2022, https://printbusiness.co.uk/?p=17678 (trade press; gwg.org, Acrobat and callas *could not open*)
- ACES, https://acescentral.com/knowledge-base-2/using-aces-reference-images/
- OpenColorIO, https://opencolorio.org/
- Atlassian, https://atlassian.design/components/eslint-plugin-design-system/ensure-design-token-usage/usage
- Primer, https://github.com/primer/stylelint-config and https://github.com/primer/eslint-plugin-primer-react
- Polaris, https://github.com/Shopify/polaris/tree/main/stylelint-polaris
