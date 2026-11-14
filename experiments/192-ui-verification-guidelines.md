---
date: "2026-11-02"
scripts: "none; reading only"
summary: "Reading, not a measurement, built on 191. The makers agree: a person accepts a new picture, never the run (Playwright fails a test that writes a missing baseline; Chromatic alone lets an author approve their own); a picture holds only where it was made; fail and \"needs review\" are two answers (axe's incomplete, Storybook's todo); automation finds about half. Tickets 143 and 144 (today's version, on their branches) had five UI bugs, all found by a person or a model looking at shots, and each had a cheaper layer: two token laws, one machine law on real wasm, one Tab walk, one layout law at 1024x700; none needed a golden. Info mode's \"tab to it\" was never tested: e2e reached the button with `.focus()`. Seven principles for the proposed note, U1 to U7, with leans 70% to 85%. Linear and Figma publish nothing on UI tests. $0."
---

# How should fabrika check that a window looks and behaves right, and what did tonight's two tickets teach?

Read 2026-11-02. **This is reading, not a measurement.** Nothing was built, run or tested, and no
model was called. It builds on [experiment 191](./191-ui-verification-research.md), which holds the
research, the papers and the seven layers; this one does not redo it. It adds the makers' own docs,
read again for what 191 left open, and checks tonight's two tickets against each principle. It feeds
[UI verification](../docs/direction/ui-verification.md), a proposed note, and a private page, "UI
verification guidelines", with a window you can break and check.

**Which version.** Every "today" claim is about today's app, `apps/fabrika`. Tickets 143 and 144
are read on their branches, info mode at `ddc4d063` and the Radix theme at `d9625333`;
neither is on `main` yet. `main` was at `7e5011f8`. `next/` reads this as a lesson.

## The answer

The makers agree on four things.

1. **A person accepts a new picture, never the run.** Playwright fails the test that writes a missing
   baseline "so that the run does not silently pass in CI" [m2]. Chromium's Gold keeps an approval to
   one change until it merges [m29]. Chromatic is the one that says "you can't prevent people from
   auto-approving their own review" [m7], and fixes it with required reviewers.
2. **A picture holds only where it was made.** "Screenshots differ between browsers and platforms
   due to different rendering, fonts and more" [m1]. Gold keeps "multiple baselines per test" [m29].
3. **Fail and "needs review" are two answers.** axe returns violations and "incomplete" results,
   where "manual review is needed" [m12]. Storybook calls them `error` and `todo` [m6]. A known issue
   is suppressed by a narrow fingerprint, for a while [m4], [m31].
4. **Automation finds about half.** axe "catches up to 57% of WCAG issues" [m6]; "many accessibility
   problems can only be discovered through manual testing" [m4]; Apple's audit "is limited to the
   elements on the screen" [m30].

Tonight's two tickets follow the split of red tests before code, and the pin rule on ticket 144.
They break the layouts, real input, and the record:

- **Five bugs, all found by eyes.** A person looking at shots, and a model reviewer, found every one.
  No law caught any of them first.
- **Each has a cheaper layer.** Two are token laws (1), one a machine law on real WebAssembly (2), one
  a Tab walk (3), one a layout law at 1024x700 (4). None needed a golden image.
- **One test cheated.** Info mode's hint promised "tab to it", and the end-to-end test reached the
  button with `.focus()` (`e2e.ts:352`), so the promise was never tested.

```text
how each maker read does it, one line each
Playwright   a missing baseline is written and the test fails; -u updates any that differ
Storybook    every story is a visual test; a11y in error, todo or off
Chromatic    baselines follow branches; an author can approve their own; required reviewers fix it
axe-core     "zero false positives (bugs notwithstanding)"; incomplete means a person looks
Skia Gold    exact match first, many baselines, then inexact; contributors triage positive or negative
Apple        performAccessibilityAudit fails the test with no assertion; a handler ignores known issues
Android      Espresso's AccessibilityChecks; suppress only narrow, known results
Elm          Test.Html.Query reads the view as a value; elm-program-test clicks buttons by their text
Erlang       Dialyzer: "sound warnings without false positives"
Linear       nothing public on UI tests; Quality Wednesdays and a zero-bugs policy, by people
Figma        nothing public on visual tests; its renderer runs natively for "testing and debugging"
```

## What was read

The 13 makers' pages below, plus Dialyzer's docs, elm-program-test's source and one summary page for
the rule of three. Two research agents read the branches and the pages; the writer checked each quote
used here against what came back. Where the fetch tool returned a paraphrase, the text says so. All
read 2026-11-02.

## Snapshots and their baselines

| Maker | Missing baseline | Who updates | Per platform |
|---|---|---|---|
| Playwright 1.64 (the catalog's pin) [m1], [m2], [m3] | written, and the test fails, in `default` mode | anyone who runs `-u`; "updates snapshots that do not match" | yes: "run tests in the same environment where the baseline screenshots were generated" |
| Storybook [m5] | every story is a test | "Changes you accept as baselines in the addon will get auto-accepted as baselines in CI" | through Chromatic |
| Chromatic [m7], [m8], [m9] | inherited "from the commit it was branched off from" | the author can; a Reviewer role "Cannot run builds ... or approve their own changes" | per browser |
| Skia Gold, Chromium [m28], [m29] | exact match first, "multiple baselines per test" | "triage access is granted to Skia contributors"; positive or negative | per config |

- **Playwright's ARIA snapshots** match in part, "by omitting attributes or accessible names", and
  take regular expressions for changing text [m3]. So a snapshot can say only what must hold.
- **Chromatic's threshold** defaults to 0.063 and ignores anti-aliased pixels by default [m10]
  (partly a paraphrase). TurboSnap shoots "only of the stories associated with those changes" [m11].
- **No Chromatic page read says plainly that accept makes a new baseline.** Only search snippets do.

## Accessibility checks

- **axe-core:** "It returns zero false positives (bugs notwithstanding)." "axe-core will return
  elements as "incomplete" where axe-core could not be certain, and manual review is needed" [m12].
  Incomplete nodes "could neither be determined to definitively pass or definitively fail".
  `wcag22aa` is WCAG 2.2 AA; `best-practice` is "Common accessibility best practices", not WCAG [m13].
- **Playwright's accessibility page:** for known issues, "create a fingerprint of the violation(s)
  in question that contains only enough information to uniquely identify the issue"; excluding rules
  is "until you're able to fix the issues" [m4].
- **Storybook:** `todo` warns, `error` fails in the UI and in CI, `off` skips [m6].
- **Apple, WWDC23:** "There's no need for assertions: if any issues are found, your test
  automatically fails." The handler "lets me choose which issues to ignore and which issues to
  report"; "By default, issues should not be ignored" [m30].
- **Android:** `setSuppressingResultMatcher()` suppresses results; "use matchers that are narrowly
  scoped" [m31].

## The WCAG pages

| Criterion | The line that bears on us |
|---|---|
| 1.4.1 Use of Color [m14] | "Color is not used as the only visual means of conveying information" |
| 1.4.3 Contrast [m15] | inactive and decorative text "have no contrast requirement"; a hint is neither |
| 1.4.11 Non-text Contrast [m16] | "at least 3:1 against adjacent color(s)" for parts and states |
| 1.4.10 Reflow [m17] | "without loss of information or functionality"; its fine cut gives a link to the full text |
| 1.4.12 Text Spacing [m18] | "Text fits within the bounds of its containing box without being cut off" |
| 2.1.1 Keyboard [m19] | "All functionality ... operable through a keyboard interface" |
| 2.4.7 Focus Visible [m20] | "the keyboard focus indicator is visible" |
| 2.4.11 Focus Not Obscured [m21] | "not entirely hidden due to author-created content", such as "sticky footers" |
| 4.1.2 Name, Role, Value [m22] | "the name and role can be programmatically determined" |
| 4.1.3 Status Messages [m23] | told "without receiving focus" |

1.4.10 is written for 320 CSS pixels, and our small window is 1024 wide with tiles inside it. We
read its rule, no loss of information, as the bar for each tile, not its pixel number. That reading
is ours.

## Linear and Figma

- **Linear** publishes nothing on UI tests that we could find. Its public practice is people. Quality
  Wednesdays: "Since you train this muscle over time, you start noticing patterns and common
  pitfalls while building stuff" [m25]. The zero-bugs policy: "low-priority bugs need to be
  addressed within 7 days, high-priority bugs within 2" [m26].
- **Figma** publishes nothing on screenshot tests that we could find. Its WebGPU post says the
  renderer also builds as a native app "used for server-side rendering, as well as testing and
  debugging", and its start-up checks "try to render pixels to a texture, read the pixels back"
  [m27].
- So most Linear rows in the note say "no Linear answer". One clashes: Linear trains an open look
  every week, where U7 aims the look. That is the note's call C6, with no lean.

## Elm and Erlang

- **Elm:** `Test.Html.Query.fromHtml`: "This is how queries typically begin" [m32]. The view is a
  value, read with no browser. elm-program-test's `clickButton` "will find and click a `<button>`
  HTML node containing the given `buttonText`"; "If the button is disabled the test will fail"; and
  for its low-level event call, "prefer that instead, as you will get the benefit of better error
  messages" [e2].
- **Erlang:** Dialyzer "bases its analysis on the concept of success typings, ensuring sound warnings
  without false positives" [e1]. That is the CACM bar, built into a tool.

## Today's two tickets

Read on the branches. Both are today's version.

| What | Today | Where |
|---|---|---|
| Info mode's explanation | drawn in the bottom line's left item | `frame.tsx:809`, `:812` on main |
| Its cut at 1024x700 | `white-space: nowrap` and `text-overflow: ellipsis` | `window.css:532`, `:733`, same on the branch |
| The test that pins it | resizes to 1024x700, checks the item is "not cut off" | `e2e.ts:447`, `:500` at `ddc4d063` |
| "esc leaves" | `<span className="quiet">esc leaves</span>` | `frame.tsx:872` at `ddc4d063` |
| Its color | `.quiet { color: var(--wire) }`, `--n-8` on `--n-1`: about 2.14:1 | `window.css:598`, `:35`, `:16`, `:9`, `:160` |
| Its fix | `.quiet` takes `--text-faint`, slate a11 | ticket 144, `417270b7`, `window.css:602` |
| The law that covers it | every `color: var(--x)` in the CSS reads 4.5:1 | ticket 144, `themes.test.ts:402`, `:436` |
| "tab to it" | the hint "point at anything, or tab to it" | `frame.tsx:813` at `222b8470` |
| The cheat | `.focus()` on the keys button, then Shift+Tab | `e2e.ts:352` at `c50ae351`; still `:381` at `ddc4d063` |
| The hint's fix | the words drop the promise | `frame.test.ts:761` at `ddc4d063` |
| Focused title bar | the same as at rest; now pinned at slate 12 | `themes.test.ts:611`, `d9625333` |
| Glyphs after a look change | a new terminal kept a freed one's rows | fix `8ea61ad7`; law `terminal.replay.test.ts:162`, real wasm |
| Shots | 1440x900, scale 2, dark only | `shots.ts:235` on main |
| e2e | 100 `check(` lines, one screenshot a step, none compared | `e2e.ts:98` on main |
| axe, ARIA snapshots, goldens | none anywhere | `git grep` on main |
| The pack | asks yes or no with before and after pictures it does not take | `packs/ui-verification/src/index.ts:12`, `:38` |
| Field rows | none for 143 or 144 | `field/` on main and both branches |

The five bugs, and the lowest layer that could have caught each:

| Bug | Found by | Lowest layer | Its law | Cost |
|---|---|---|---|---|
| Explanation cut at 1024x700 | a person and a model, from shots | 4 layout | must-read text is never cut, ellipsis included | seconds a layout |
| "esc leaves" at 2.14:1 | a person and a model | 1 tokens | every text token reads 4.5:1 (exists on 144) | milliseconds |
| "tab to it" never reached | a person and a model | 3 DOM | a Tab walk reaches every part the words promise | seconds a state |
| Focused title bar looked at rest | the owner, round 2's shots | 1 tokens | focused and resting differ by a step and a weight | milliseconds |
| Garbled glyphs after a look switch | the shots | 2 machine | a look change changes colors only: same text in every cell | milliseconds |

Checked against the seven principles:

| Principle | Tickets 143 and 144 | Why |
|---|---|---|
| U1 data first, pin at the lowest layer | half | 144 pins both its bugs at layers 1 and 2; 143 pins its cut in e2e only, and its contrast waits for 144's law |
| U2 block only at about 0% | half | e2e blocks and is deterministic; shots only advise; no false alarm is counted anywhere |
| U3 five layouts, both looks | **breaks** | `shots.ts:235` shoots one size and one look; 143 adds one 1024x700 run in e2e |
| U4 press what a person presses | **breaks** | `.focus()` at `e2e.ts:352`, still at `:381`; the promise was taken out, not tested |
| U5 the exam | follows | red tests land first in their own commits; no golden exists to guard |
| U6 a judge, measured | half | a model reviewer found bugs, as prose, with no row and no count |
| U7 an aimed person, rated | half | the owner's look found the title bar; nothing aimed it and nothing rated it |

## What this tells us for fabrika

- **Pin, then look less.** All five bugs had a law cheaper than a golden. Every pin moves one kind of
  bug from the owner's eyes to milliseconds.
- **The contrast law reads the CSS, not a list.** Ticket 144's law takes its tokens from every
  `color: var(--x)` (`themes.test.ts:402`), which is why it would catch "esc leaves". A hand-written
  pair list would not have.
- **Words in the window are claims.** "tab to it" and "esc leaves" are promises; U4 makes each one a
  check that presses the keys.
- **An ellipsis is a cut.** ReDeCheck's "cut text" kind counts only text cut with no ellipsis (191).
  Tonight's bug had one.
- **Record now, count later.** No finding tonight was rated, so no layer's false alarms can be
  counted. The `ui_checked` and `rated` rows fix that from the first run.

## What it cannot tell us

- **Nothing ran.** No law above was built or measured here. The five-bug table is our reading of
  which law would have caught each, not a run of it.
- **Two tickets, one night.** A month of rated findings would say more than five bugs.
- **Ticket 143's wrap fix** was not on its branch at `ddc4d063` when read (`window.css` unchanged); its
  test was. A later commit may have it.
- **2.14:1 was worked out by hand** from the oklch values, not measured in the app.
- **The rule of three** is from a summary page [s1], not the 1983 paper, which has no abstract online.
- **Linear and Figma** publish nothing on UI tests, so their rows are about practice, not tools.
- No screen reader ran.

## Dollars

$0. No model was called, beyond the agents that read.

## Links

All read 2026-11-02.

- [m1] [Playwright, visual comparisons](https://playwright.dev/docs/test-snapshots)
- [m2] [Playwright, `updateSnapshots`](https://playwright.dev/docs/api/class-testconfig)
- [m3] [Playwright, ARIA snapshots](https://playwright.dev/docs/aria-snapshots)
- [m4] [Playwright, accessibility testing](https://playwright.dev/docs/accessibility-testing)
- [m5] [Storybook, visual tests](https://storybook.js.org/docs/writing-tests/visual-testing)
- [m6] [Storybook, accessibility tests](https://storybook.js.org/docs/writing-tests/accessibility-testing)
- [m7] [Chromatic, review](https://www.chromatic.com/docs/review/)
- [m8] [Chromatic, collaborators](https://www.chromatic.com/docs/collaborators/)
- [m9] [Chromatic, branching and baselines](https://www.chromatic.com/docs/branching-and-baselines/)
- [m10] [Chromatic, threshold](https://www.chromatic.com/docs/threshold/) (partly a paraphrase)
- [m11] [Chromatic, TurboSnap](https://www.chromatic.com/docs/turbosnap/)
- [m12] [axe-core](https://github.com/dequelabs/axe-core)
- [m13] [axe-core API](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md)
- [m14] [WCAG 2.2, 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
- [m15] [WCAG 2.2, 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [m16] [WCAG 2.2, 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- [m17] [WCAG 2.2, 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
- [m18] [WCAG 2.2, 1.4.12](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html)
- [m19] [WCAG 2.2, 2.1.1](https://www.w3.org/WAI/WCAG22/Understanding/keyboard.html)
- [m20] [WCAG 2.2, 2.4.7](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)
- [m21] [WCAG 2.2, 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html)
- [m22] [WCAG 2.2, 4.1.2](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html)
- [m23] [WCAG 2.2, 4.1.3](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
- [m24] [WCAG 2.2, 2.5.3](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html)
- [m25] [Linear, Quality Wednesdays](https://linear.app/blog/quality-wednesdays)
- [m26] [Linear, zero-bugs policy](https://linear.app/blog/zero-bugs-policy)
- [m27] [Figma, rendering powered by WebGPU](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/)
- [m28] [Skia Gold](https://skia.org/docs/dev/testing/skiagold/)
- [m29] [Chromium, GPU pixel testing with Gold](https://github.com/chromium/chromium/blob/main/docs/gpu/gpu_pixel_testing_with_gold.md) (a mirror; the googlesource page did not open)
- [m30] [Apple, WWDC23, "Perform accessibility audits for your app"](https://developer.apple.com/videos/play/wwdc2023/10035/)
- [m31] [Android, accessibility checking with Espresso](https://developer.android.com/training/testing/espresso/accessibility-checking)
- [m32] [elm-explorations/test, `Test.Html.Query`](https://raw.githubusercontent.com/elm-explorations/test/master/src/Test/Html/Query.elm) (the source; the package page did not open)
- [e1] [Erlang, Dialyzer](https://www.erlang.org/doc/apps/dialyzer/dialyzer.html)
- [e2] [elm-program-test, `ProgramTest.elm`](https://raw.githubusercontent.com/avh4/elm-program-test/main/src/ProgramTest.elm)
- [s1] [Rule of three (statistics)](https://en.wikipedia.org/wiki/Rule_of_three_(statistics)), **secondary**; Hanley and Lippman-Hand, "If nothing goes wrong, is everything all right?", JAMA 1983 ([record](https://pubmed.ncbi.nlm.nih.gov/6827763/), no abstract)
- Experiment 191 holds every other source: ReDeCheck, Duan et al., UIClip, GraphicsFuzz, Barr et al.,
  the FDA guidance, Metamong and the rest.
