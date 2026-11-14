---
state: "decided 2026-11-07"
summary: "Today's version first, in `apps/fabrika`'s tests and shot script; `next/` reads it for every window. Seven principles: check tokens, the machine, the tree and boxes before pixels, and pin each found bug at the lowest layer that can say it; block only what is measured near 0% false alarms, the rest advises; every check runs on eight layouts (the five from AGENTS.md, 200% text zoom, the smallest tile, 400% reflow) and each window's content states, in both looks; a check presses what a person presses, with Testing Library component tests under Playwright, and every promise in the window's words is tested; approved images, ARIA snapshots and suppressions are the exam, only the owner changes them; a model judge answers one narrow row, measured first, and advises; a person looks at what no law explains and at the critical tasks, and rates each finding. One `ui_checked` row per check. Tickets 143 and 144's five bugs, all found by eyes, are the running example. From experiment 192."
---

# UI verification

**Decided 2026-11-07.** The owner approved the seven principles, as leaned, after a walk of each,
with the changes to U3 and U4 below. The leans' confidence numbers stay as written. Proposed
2026-11-02. It stands on points the owner already
decided, named where they come up: nobody writes their own exam (2026-10-22), a check blocks only
at about 0% false alarms (AGENTS.md, Google CACM 2018), an unrated finding counts as noise once its
change ships (2026-10-24), every pull request shows screenshots at five layouts (AGENTS.md), color
principles 1, 3 and 8 (2026-11-01), the tile guidelines (2026-11-01), record wide (2026-11-01), and
a survivor advises and never blocks (2026-11-01).

Its decided rules are in: [0469](../../.decisions/0469-a-ui-check-reads-data-first.md),
[0470](../../.decisions/0470-a-ui-check-advises-until-measured.md),
[0471](../../.decisions/0471-ui-shots-cover-eight-layouts.md),
[0472](../../.decisions/0472-must-read-text-is-never-cut.md),
[0473](../../.decisions/0473-a-ui-check-presses-real-input.md),
[0474](../../.decisions/0474-ui-goldens-are-exam.md),
[0475](../../.decisions/0475-a-model-judge-advises-one-row.md),
[0476](../../.decisions/0476-the-owners-look-is-aimed.md).

Built from [experiment 192](../../experiments/192-ui-verification-guidelines.md), which checks the
seven layers of [experiment 191](../../experiments/191-ui-verification-research.md) against the
makers' own docs and tonight's two tickets, and a private page, "UI verification guidelines", with a
window you can break and check. Neither is a measurement. Source tags such as [m7] are experiment
192's.

```ts
// A sketch, today's version first. The five bugs tonight's shots found, each pinned at the
// lowest layer that can say it. A person found every one; after this, a law finds the next one.
const pins = [
	{bug: "explanation cut with … at 1024x700", layer: 4, law: "must-read text is never cut, at every layout"},
	{bug: "'esc leaves' at 2.14:1", layer: 1, law: "every color: var(--x) the CSS draws as text reads 4.5:1"},
	{bug: "'tab to it', but Tab never got there", layer: 3, law: "every part info mode explains is in the Tab order"},
	{bug: "focused title bar = resting title bar", layer: 1, law: "focused and resting differ by a step and a weight"},
	{bug: "a look switch garbled terminal glyphs", layer: 2, law: "a look change changes colors only: same text in every cell"},
] as const;
// Layers: 1 tokens, 2 machine, 3 DOM and ARIA, 4 layout, 5 golden images, 6 model judge, 7 a person.
```

```text
one change traced: ticket 143 adds "esc leaves" to info mode's bottom line
1 tokens     the contrast law reads every color: var(--x) in window.css   .quiet on --surface-sunken: 2.14:1
             blocks, in milliseconds; names the rule and both tokens      (ticket 144's law, fce0534d)
2 machine    desk laws: one focused tile, info on means the line says INFO   pass
3 DOM, ARIA  Tab walk at each layout: is every explained part reached?    "keys" never reached: advises until measured
4 layout     at 1024x700, is any must-read text cut?                      bottomline .left cut with …: advises until measured
5 golden     (not yet: experiment D first)                                skipped, and says so
6 judge      (not yet: experiment F first)                                skipped, and says so
7 a person   the owner sees only what 1 to 6 did not explain, rated fix or noise
```

## Which version

- **Today's version (`apps/fabrika`):** first. Layers 1 to 4 are laws in the app's own tests and
  its shot script, beside the code they check. Ticket 144's branch already holds layer 1
  (`themes.test.ts`) and a layer 2 law on real WebAssembly (`terminal.replay.test.ts`). Both tickets
  are the running example, read on their branches, not on main.
- **`next/`:** reads this as its rule for every window, from Tier 1's first screen. Tier 1 already
  asks "screenshots, the owner's yes" on each pull request ([tier 1](../plan/tier-1.md)); this note
  says what runs before that yes, so the owner looks at less. A pack that holds the layers waits for
  Tier 7, as packs do ([tiers](../plan/tiers.md)).

## The shape

One record per check run, and one per rating. Everything else is derived.

```ts
// A sketch, Effect Schema. One row per check, per state, per layout, per look.
const Layout = Schema.Literals(["one", "side-by-side", "stacked", "grid-2x2"]);
const Size = Schema.Literals(["default", "small"]); // 1440x900 and 1024x700
const Verdict = Schema.TaggedUnion({
	pass: {},
	breaks: {findings: Schema.Array(Finding)},
	cannot_tell: {why: Schema.String}, // a judge's honest exit; never counted as a pass
	skipped: {why: Schema.String}, //     a skipped check never looks clean
});
const Checked = Schema.TaggedStruct("ui_checked", {
	check: Schema.String, //        "layout.cut_text", "tokens.contrast", "judge.focus_in_words"
	layer: Schema.Literals([1, 2, 3, 4, 5, 6]),
	exam: Schema.String, //         sha256 of the law's file and its data: which version judged
	state: Schema.String, //        the seeded state's name, "info-on-explaining"
	layout: Layout,
	size: Size,
	look: Schema.Literals(["dark", "light"]),
	renderer: Renderer, //          chromium, electron, os, scale, fonts hash: lost if not kept now
	blocks: Schema.Boolean, //      what this check could do on this run
	verdict: Verdict,
	shots: Schema.Array(Schema.String), // content hashes; the images stay deletable
	ms: Schema.Number,
	judge: Schema.optional(JudgeRun), // model, prompt hash, typed answer, tokens, dollars
});
// A person's rating is its own row, as decided in every-finding-is-rated:
// {_tag: "rated", finding: "f-1", says: "fix"}
```

Checked by reading only: the types follow `every-finding-is-rated.md`'s rating fact and the
pipeline guidelines' "a skipped check never looks clean". Nothing compiled.

## The seven principles

### U1: check the data first, the pixels last

**Lean, 85%. Decided 2026-11-07.** Seven layers, cheapest and surest first, as experiment 191 lays them out. A bug is
pinned at the lowest layer that can say it in code.

```text
layer         reads                         catches tonight's            cost
1 tokens      window.css, themes.ts         esc leaves 2.14:1; title     ms
2 machine     the tea model, real wasm      glyphs after a look change   s
3 DOM, ARIA   the page's tree, Tab order    tab to it, never reached     s per state
4 layout      every part's box              explanation cut at 1024x700  s per layout
5 golden      pixels                        any drawn change             s, plus a person
6 judge       a shot, one rule row          rows no law states yet       ~1,500 tokens a shot
7 a person    everything                    taste, real use              minutes
```

- **What it means.** A check reads the most structured thing that can show the bug: a token before
  a tree, a tree before a box, a box before a pixel. A pixel check only says "different", never
  "wrong" (experiment 191, layer 5).
- **The pin rule.** When a person, a shot or a model finds a UI bug, its fix lands with a law at the
  lowest layer that would have caught it. Ticket 144 did this twice: the title bar became a token law
  (`themes.test.ts:611`), the glyphs a real-wasm law (`terminal.replay.test.ts:162`).
- **Why.** Barr et al.: with no oracle, "the final source" is the human, so the other layers exist
  to make that part small (191). Elm's own test library queries the view as a plain value:
  `Test.Html.Query.fromHtml` "is how queries typically begin" [m32], with no browser.
- **Relations where there is no right answer.** A look change changes colors only. A tile says the
  same facts at every layout. A state reached step by step draws the same as one loaded fresh
  (Metamong, GGPO's sync test, both in 191). Tonight's glyph bug breaks the first.
- **Linear.** No Linear answer: Linear publishes no test tooling. Its public practice is to fix fast,
  "low-priority bugs need to be addressed within 7 days, high-priority bugs within 2" [m26], and to
  train people's eyes [m25]. The pin rule is ours: a fix also leaves a law.
- **Elm or OTP.** Elm: the view is a pure function of the model, so test the model and the view's
  tree as data first ([elm first](./elm-first.md)). We leave Elm at layer 4: CSS lays out boxes the
  model cannot see, so layout needs a real page.
- **WCAG.** 1.4.3 and 1.4.11 at layer 1; 1.4.1 for the relations ("never color alone").
- **Holds it.** The review step's rule row: a fix for a UI bug names the law that pins it, or says
  why none can. A sketch; no code holds it yet.
- **Doubt.** Some bugs have no law cheaper than a golden. Experiment E (191) counts how many of 30
  planted breaks need one. Under 20% would lift this to 90%.
- **Cost.** Each pin is a test of 10 to 40 lines.
- **Today.** Half. Ticket 144 pins both its bugs at layers 1 and 2. Ticket 143 pins the cut text in
  e2e only (`e2e.ts:500`, a layer 4 check inside the slowest run), and its 2.14:1 hint has no law on
  its own branch: ticket 144's law, which reads every `color: var(--x)` (`themes.test.ts:402`), would
  catch it once both land.

### U2: block only what is measured near 0%; the rest advises

**Lean, 80%. Decided 2026-11-07. The bar itself is decided:** about 0% false alarms to block, up to 10% to advise
(AGENTS.md, Google CACM 2018).

```text
layer        today's state                 blocks when
1 tokens     deterministic                 now
2 machine    deterministic, when the law is right   now
3 axe, ARIA  axe "zero false positives" is the maker's goal [m12]   after experiment C, measured here
4 layout     ReDeCheck: 0 on collision and protrusion, 22% small-range (191)   per kind, after experiment B
5 golden     no public rate; 42% "no different" in GraphicsFuzz (191)   advises until experiment D shows ~0
6 judge      29% "not accurate" (Duan, 191)  advises at <=10% on our planted set; blocks never, for now
7 a person   decides                       always
```

- **What it means.** A check starts as advice. It is promoted to block one kind at a time, when its
  own record shows about 0 false alarms on our app (the smaller call C4 sets the count).
- **"Needs review" is not a fail.** axe returns "incomplete" where it "could not be certain, and
  manual review is needed" [m12]. Storybook splits `error` from `todo` [m6]. An incomplete result
  goes to the person as advice, never as a block.
- **A known issue is suppressed narrowly,** by a fingerprint "that contains only enough information
  to uniquely identify the issue" [m4], with Espresso's "narrowly scoped" matchers [m31]. A
  suppression is an exam change (U5).
- **Linear.** No Linear answer: nothing public on blocking checks.
- **Elm or OTP.** Erlang's Dialyzer was built for this bar: it gives "sound warnings without false
  positives" [e1], so a Dialyzer warning is always worth reading. A check that wants to block takes
  the same shape: report only what it is sure of.
- **WCAG.** All of them, through axe's tags (`wcag2aa`, `wcag22aa` [m13]); `best-practice` is not
  WCAG and only advises.
- **Holds it.** The check's own record: `blocks` is a field on every row, set from the check's
  measured count, never by the builder. Promoting a check is an exam change, the owner's call.
- **Doubt.** Our tile layouts are not responsive pages, so ReDeCheck's 0% may not carry. Experiment
  B settles it.
- **Cost.** Each promotion needs a measured run: about 1.5 to 3 agent hours, $0 (191's B to D).
- **Today.** Half. e2e blocks in CI, and its checks are deterministic. Shots advise a person. No
  check has a counted false alarm rate, since no rating is recorded.

### U3: eight layouts and the content states, both looks, every time

**Lean, 85%. Decided 2026-11-07,** grown from AGENTS.md's five layouts ("Shoot more than one
layout") to eight, plus content states.

```text
size            one tile   side by side   stacked   2x2
default 1440x900   shot       shot           shot      shot
small 1024x700     shot       shot           shot      shot
x dark and light, for every seeded state a change touches
```

- **The eight layouts.** The five from AGENTS.md: one tile, side by side, stacked, a 2x2 grid,
  and a small app window of about 1024x700. Then three more:
  - 200% text zoom on the 2x2 grid (WCAG 1.4.4 Resize Text).
  - The smallest tile the desk allows.
  - Reflow: one tile at 400% zoom in a 1280-wide window, which equals 320 CSS px, with no
    sideways scrolling (WCAG 1.4.10 Reflow,
    [Understanding 1.4.10](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)). A terminal
    tile is the exception: 1.4.10 exempts content that needs two dimensions to be used.
- **Content states are not layouts.** Each window's test lists its empty state, a very long name
  and a long list, and they run in the 2x2 grid.
- **Both looks** still apply to every layout and every content state.
- **What it means.** Layers 3 to 5 and the person's shots run on one fixed grid: the four tile
  layouts at the default window, and the same four at the small window (the smaller call C3). Both
  looks, now that ticket 144 brings a light one. A seeded state names what is open, never the size.
- **Must-read text is never cut.** An ellipsis is a cut. Text a person needs (an ask, a mode's way
  out, info mode's explanation) wraps or moves; only a part whose full text is said elsewhere (a long
  tile name, said in full in its region name) may end in "…".
- **Why.** WCAG 1.4.10 wants content "without loss of information or functionality" [m17]; its own
  example of a fine cut gives a way to reach the full text. 1.4.12's example: "Text fits within the
  bounds of its containing box without being cut off" [m18]. ReDeCheck found that common widths alone
  found 66% to 81% of its failures (191).
- **Linear.** No Linear answer: Linear says nothing public about the sizes it tests.
- **Elm or OTP.** Elm keeps the window size in the model (`Browser.Events.onResize`), so a layout is
  a state like any other, and the grid is a list of states.
- **WCAG.** 1.4.10 Reflow, 1.4.12 Text Spacing, 2.4.11 Focus Not Obscured (a sticky bottom line
  covering a focused part [m21]).
- **Holds it.** The shot script refuses to finish with a cell of the grid missing, and writes a
  `skipped` row for any cell a check did not reach.
- **Doubt.** Eight cells times two looks is 16 renders per state. If that passes the per-pull-request
  budget ([fast mutation](./fast-and-daily-mutation.md)), the small window drops to 2x2 only.
- **Cost.** About 40 lines in `shots.ts` (the tile guidelines' estimate), plus the cut-text law,
  about 30.
- **Today.** Breaks. `shots.ts:235` shoots 1440x900 only, dark only. Ticket 143's cut explanation
  sat at 1024x700 (`window.css:532`, `:733`), and only a person and a model saw it. Its branch adds
  one 1024x700 run inside e2e (`e2e.ts:447`).

### U4: a check presses what a person presses

**Lean, 80%. Decided 2026-11-07.**

```ts
// No: the test moves focus where the keyboard never could.
await bottomLine(page).getByRole("button", {name: /keys$/}).focus(); // e2e.ts:352, ticket 143
// Yes: the test reaches it the way the hint says a person can.
for (let i = 0; i < 40 && !(await focusedIs(page, "keys")); i++) await page.keyboard.press("Tab");
expect(await focusedIs(page, "keys"), "the hint says 'tab to it'").toBe(true);
```

- **What it means.** A check drives the window only through real input: keys, the pointer, the
  palette. No `.focus()`, no `dispatchEvent`, no `evaluate` that changes the page. And every promise
  the window makes in words ("tab to it", "esc leaves") has a check that does exactly that.
- **Why.** elm-program-test's `clickButton` "will find and click a `<button>` HTML node containing
  the given `buttonText`", and "If the button is disabled the test will fail" [e2]; its lower-level
  event call says to "prefer that instead" [e2]. A test that sets focus by hand tests the test.
- **Linear.** No Linear answer on tests. A guess: Linear is built for the keyboard, so its own team
  would press the keys.
- **Elm or OTP.** Elm: drive the program through the view's own handlers (elm-program-test), never
  by writing the model.
- **WCAG.** 2.1.1 Keyboard: "operable through a keyboard interface" [m19]; 2.4.7 Focus Visible
  [m20]; 2.4.3 Focus Order.
- **A component layer under it.** Component tests use Testing Library
  (`@testing-library/react` 16.3.3 with `@testing-library/user-event` 14.6.8), queried by role and
  name, in jsdom, run by `pnpm test`. A control with no accessible name fails the test. Layout,
  focus rings and the real accessibility tree stay with Playwright on Electron. Why jsdom, not a
  browser: our Playwright runs start Electron, one at a time on the laptop, while jsdom runs in
  milliseconds. The doubt: jsdom computes roles with a library, not a browser, and Playwright's
  ARIA snapshots catch where the two differ.
- **Holds it.** A lint rule on e2e and shot files that refuses `.focus(`, `.dispatchEvent(` and a
  page-changing `evaluate` (smaller call C5). A layer 3 law: a Tab walk at each layout reaches every
  part the window says can be reached.
- **Doubt.** Some states are slow to reach by keys. A seeded state is fine (the shot script already
  hands a desk in); moving focus by hand inside one is not.
- **Cost.** The lint rule, about 60 lines; the Tab walk, about 40.
- **Today.** Breaks. The hint promised "tab to it" (`frame.tsx:813` at 222b8470), and the test
  cheated with `.focus()` (`e2e.ts:352`). The fix took the promise out of the words
  (`frame.test.ts:761`, "promises no Tab it cannot keep"), but the `.focus()` call is still there at
  `e2e.ts:381`.

### U5: approved images and snapshots are the exam

**The rule is decided 2026-10-22** ([nobody writes their own exam](./nobody-writes-their-own-exam.md)).
**How it holds for UI files: lean, 85%. Decided 2026-11-07.**

```text
file                       who writes it                   who changes it
ARIA snapshot              the test writer, before the build    the owner, in its own change
layout spec, pair list     the test writer                      the owner
golden image               the run writes "received"            the owner approves it, nobody else
planted breaks             the test writer                      the owner
judge rule rows            the owner                            the owner
a suppression (fingerprint)  nobody but the owner               the owner
```

- **What it means.** Every file a UI check compares against is exam. A builder never writes, updates
  or suppresses one. An ARIA snapshot is text and says what the page must hold, so it can be written
  first, like any law. A golden can only be recorded after the build, so the run writes it as
  "received" and only the owner's approval makes it "approved" (ApprovalTests, 191).
- **Why.** Chromatic says it plainly: "No, you can't prevent people from auto-approving their own
  review" [m7]. Playwright creates a missing baseline and fails the test "so that the run does not
  silently pass in CI" [m2], but its `-u` flag "updates snapshots that do not match" for anyone who
  runs it [m3]. Chromium's Gold: an approval on a change "only applies to that CL until the CL is
  merged" [m29].
- **Linear.** No Linear answer. The common tool, Chromatic, lets an author approve their own; we
  differ on purpose.
- **Elm or OTP.** No Elm or OTP answer: Elm has no snapshot tests. The known way is ApprovalTests'
  received and approved split.
- **WCAG.** 4.1.2: an ARIA snapshot holds each part's name and role [m22].
- **Holds it.** The exam path list ([nobody writes their own exam](./nobody-writes-their-own-exam.md))
  gains the snapshot, golden, spec and suppression folders. CI runs with `updateSnapshots: "none"`.
  A draft that touches one ends as `ask:owner:check_change`.
- **Doubt.** A new screen needs a first golden, and the owner approves many at once. Skia Gold's
  "multiple baselines per test" [m29] keeps that down. Count approvals per week once goldens exist.
- **Cost.** One list entry per folder, and one CI setting.
- **Today.** Follows, by the pipeline's split: each ticket's red tests come first in their own commit
  (89c70f9e, a5613dde, f1b409b3 on ticket 143; 91178145, 74e55acd on 144). No golden or snapshot exists
  yet, so nothing guards one.

### U6: a model judge answers one narrow row, is measured first, and advises

**Lean, 70%. Decided 2026-11-07.**

```ts
// A sketch. The Judge move: one shot, one row, a typed answer.
type RowVerdict =
	| {_tag: "holds"}
	| {_tag: "breaks"; where: Box; why: string}
	| {_tag: "cannot_tell"}; // never counted as a pass
const rows = ["the focused tile says so without color", "no must-read word is cut", "an ask has its mark"];
```

- **What it means.** A model looks at one shot and answers one rule row, a narrow fact, never taste.
  It runs only after experiment F (191) measures it on 40 clean and 40 planted shots, and only rows
  under 10% false alarms advise. None blocks, for now.
- **When it is allowed.** On a row no law states yet. Once a law states it, the row leaves the judge
  (the pin rule, U1).
- **Why.** Narrow facts measure well (OwlEye, 85% precision), taste does not: designers agree at alpha
  0.37 and GPT-4V picked the better design 52% of the time (all in 191). Tonight a person and a model reviewer
  were the only ones to catch ticket 143's three bugs, so a judge earns its place, not its block.
- **Linear.** No Linear answer.
- **Elm or OTP.** Elm first: "the machine sees only typed answers" ([elm first](./elm-first.md)). An
  answer that does not decode is `cannot_tell`.
- **WCAG.** 1.4.1, through the row "said without color".
- **Holds it.** The Judge move's typed answer and its floor in `update`; `blocks: false` on every
  judge row until the owner promotes it.
- **Doubt.** Today's models are not 2024's. Experiment F, about $3.80 on Sonnet 5.5, settles it.
- **Cost.** About 1,500 tokens a shot; one PR with 8 states at 16 cells is 128 shots, about $0.45 on
  Sonnet 5.5 at list price (191's rates), per row.
- **Today.** Half. A model reviewer read the shots and caught bugs, as prose, with no row, no typed
  answer and no count.

### U7: a person looks at what no law explains, and at the critical tasks

**Lean, 75%. Decided 2026-11-07. "Numbers check, eyes pick" is decided** (color principles 8).

- **What it means.** The owner's look is aimed: the shots no layer explained, each with the layer
  that flagged it; every new screen; and a short list of critical tasks, where a slip does harm:
  approving the wrong pull request, missing an ask, typing into the wrong tile. Each look ends in a
  rating per finding, `fix` or `noise`, as a fact.
- **A screen reader run** is a person's job too: 4.1.3 status messages and what a region says on
  entering need VoiceOver, once per change to them (191's experiment G).
- **Why.** The FDA and IEC 62366 test the critical tasks hardest (191). Playwright: "many
  accessibility problems can only be discovered through manual testing" [m4]. axe finds about 57%
  [m6]. Apple's audit "is limited to the elements on the screen" [m30].
- **Linear.** Linear's answer is people: Quality Wednesdays train the eye, "you start noticing patterns
  and common pitfalls" [m25]. Ours aims the eye instead. Whether to add Linear's open weekly look is
  the smaller call C6, with no lean.
- **Elm or OTP.** OTP: a supervisor handles what it can and escalates the rest to its parent; the
  person is the top of the tree. Elm's debugger exports the exact Msgs, so a person's bug report
  replays (191).
- **WCAG.** All; 4.1.3 and 1.3.1 need a real screen reader.
- **Holds it.** The ask carries `flagged` and the shots; the rating is a fact
  ([every finding is rated](./every-finding-is-rated.md)).
- **Doubt.** An aimed look misses what nobody listed. Tonight's title bar was found by an open look
  at round 2's shots. Count, over a month, what open looks find that aimed ones miss.
- **Cost.** Minutes per change, fewer as laws grow.
- **Today.** Half. The owner looked and caught the title bar, so the look works. It is not aimed,
  and no rating is kept.

## The smaller calls

**C1. Where do layers 1 to 4 live first?** Lean, 80%: in today's app's tests and shot script, now.

```text
A (lean)  apps/fabrika tests and shots.ts, now; a pack reads them later
B         wait for a UI verification pack in next/ (Tier 7)
```

Why: two tickets tonight needed them, and ticket 144 already has layers 1 and 2. Cost: none moves
later; a pack can call the same laws. Doubt: none worth a test.

**C2. Golden images now, or after experiment D?** Lean, 70%: after D.

```text
A (lean)  shots go to the person as today; goldens start when D measures the flake rate
B         toHaveScreenshot now, advising, per platform
```

Why: no public pixel-diff false alarm rate exists (191), and Playwright says baselines hold only "in
the same environment where the baseline screenshots were generated" [m1]: our CI runs macOS. Cost of
A: a drawn change no law names reaches the person unflagged. Doubt: D is 1.5 agent hours, $0.

**C3. The small window: all four tile layouts, or 2x2 only?** Lean, 70%: all four.

Why: tonight's cut was in the bottom line, which every layout has. Cost: 8 more renders a state.
Doubt: the budget; time it on ticket 143's states.

**C4. What count lets a check block?** Lean, 70%: 0 false alarms in at least 300 clean checks, and
every planted break of its kind caught.

```text
A (lean)  0 in 300+ clean checks (95% upper bound about 1%, the rule of three) + all plants caught
B         0 in 100 (upper bound about 3%)
```

Why: the rule of three [s1, secondary] turns "none seen in n" into "under 3/n". 300 is 20 states at
16 cells, which experiment B renders anyway. Doubt: 300 seeded states are not 300 real changes.

**C5. How is "real input only" held?** Lean, 75%: an oxlint rule on e2e and shot files.

```text
A (lean)  a custom rule refuses .focus(, .dispatchEvent(, page-changing evaluate in e2e files
B         a review rule row only
```

Why: code over a prompt ([make the mistake impossible](./make-the-mistake-impossible.md)). Cost:
about 60 lines. Doubt: its false alarms are not measured, so it advises first, by the same rule.

**C6. Does the owner also take an open weekly look, as Linear's Quality Wednesdays?** No lean, the
owner picks.

```text
A  aimed looks only: unexplained shots, new screens, critical tasks
B  aimed looks, plus one open look a week at the full grid of one program
```

A is cheaper; B is how tonight's title bar was found. It clashes with Linear's way, so it is yours.

Decided 2026-11-11: A, in [0142](../../.decisions/0142-no-weekly-open-look.md).

## What the ledger records

One `ui_checked` row per check, state, layout, size and look, and one `rated` row per rating (the
shape above). Record wide, decided 2026-11-01.

- **Lost forever if not recorded now:** the renderer, Electron, OS, scale and fonts hash at the
  moment of the shot (a flake cannot be told from a change later); the exam's hash (which version of
  the law judged); which shots a person was shown, and when; a judge's model, prompt hash and raw
  typed answer; whether a check was skipped or passed.
- **Derived, so it can wait:** each check's false alarm rate (from ratings), the flake rate (from
  repeated hashes), coverage of states times layouts times looks, and time per pull request.
- **Kept out of the deciding code:** nothing in this row decides a merge by itself; `blocks` only
  says what the check could do, and the gate reads the check's own promoted state.
- **Deletable:** shot images are content, kept by hash, and stay deletable
  ([an agent run keeps its content](./an-agent-run-keeps-its-content.md)).

## A tryout in today's version

Offered, not filed. Each is small, from the five bugs:

- The cut-text law at 1024x700 in `shots.ts`, plus the four layouts at both sizes: about 70 lines,
  0.15 agent hours.
- The lint rule against `.focus()` in e2e files, and swap `e2e.ts:381` for a Tab walk: about 70
  lines, 0.15 agent hours.
- A Tab-walk law for info mode's explained parts: about 40 lines, 0.1 agent hours.
- One JSON line per check beside the shots, in `ui_checked`'s shape: about 60 lines, 0.1 agent hours.

**Size:** about 240 lines, about 0.5 agent hours. An estimate from reading the code.

## Where this differs from settled notes

- **The tile guidelines** list "layouts were not shot" as open. U3 closes it with a fixed grid at
  two sizes, which is more than AGENTS.md's one small window.
- **Experiment 191** lists layer 4's blocking kinds as ReDeCheck's collision and protrusions, and
  "cut text with no ellipsis". U3 counts an ellipsis on must-read text as a cut, which ReDeCheck
  does not.
- **`packs/ui-verification`** asks yes or no on every change a user sees. U7 asks only on what no
  layer explained, plus new screens and critical tasks.
- **Nothing walks back a decided note.**

## What it costs

- Layers 1 and 2: little; ticket 144 has the pattern.
- Layers 3 and 4: about 300 lines in the shot script and its laws, and experiments B and C, about
  4.5 agent hours, $0.
- Layer 6: experiment F, about $3.80 on Sonnet 5.5, then about $0.45 a pull request a row.
- The owner's minutes, fewer each week as pins grow.

## What it cannot tell us

- **Nothing ran.** Every false alarm number is someone else's (191). No check here has been measured
  on our app.
- **Five bugs are a small sample.** They came from two tickets on one night. A month of rated
  findings is the real test.
- **Ticket 143's wrap fix** was not on its branch at `ddc4d063` when read; its test (`e2e.ts:500`)
  was. The claims about it are about what the branch held then.
- **No screen reader ran.** What VoiceOver says on entering info mode is still open.
- **Linear publishes no UI test tooling,** so most Linear rows are "no answer", not a comparison.
