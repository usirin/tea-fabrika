# 134. Docs drift: how often a true doc line goes false, and who notices

The question: a pull request adds a doc line that is true on the day it merges. How often does a
later change make that line false while the line stays put? And when it happens, does anyone
notice? This matters for the new pipeline: if drift is common and quiet, a ship or review stage
needs a "do the docs still hold" check. If it is rare and caught, it does not.

**Answer: drift was rare, and the drift that happened was caught fast. Confidence 70%.**

- **0 of 30 doc lines drifted** in kamp-us/demlik, 12 to 47 days after they merged (median 27).
  19 still hold. 11 are gone:
  - 8 left their page in one README rewrite (code-graph's, #592).
  - 3 were edited by the same PR that changed the code they describe.
  - Two of the 8 moved lines would have gone false had they stayed. The rewrite took them out
    first.
- **Tickets of the shape "the doc says X, the code does Y" are about 3 to 5 in 100 closed
  tickets.**
  - demlik: 18 of 392 closed (4.6 per 100). 10 of them are drift, 2.6 per 100. 6 were wrong from
    the day they were written.
  - kamp-us/phoenix: about 186 of 6,412 closed (2.9 per 100), from a seeded draw of 80 titles.
    Drift alone is 2.6 per 100 here too.
- **Someone noticed, and quickly.** In demlik, every drift ticket was filed the same day as the
  change that broke the doc, mostly by the lane that made the change. 17 of 18 were fixed. In
  phoenix, 3 of 11 were closed as not planned: seen, not fixed.
- **The sonnet reader cannot be the check.** It agreed with me on all 30 sampled lines, but there
  was no drift to find. On 3 known-false lines (controls), it said `drifted` on none. With whole
  code files instead of excerpts, it caught 1 of 3.
- **Spent: $2.29**, all on the reader, 36 calls. No Jev, no key.

```ts
// The whole idea (experiments/134-docs-drift.ts), as a sketch.
// One line a merged PR wrote, and my own read of it on demlik main of 2026-10-23.
type Statement = {
	id: string; // "491-cohesion"
	pr: number; // the PR that wrote it
	from: "86" | "draw" | "control";
	says: string; // the line, in the doc's own words
	doc: string; // where the PR wrote it
	now: string | null; // where that file is on main
	code: string[]; // the code it describes
	mine: "holds" | "drifted" | "gone" | "unsure"; // my read, the truth
	fate?: "moved" | "kept" | "removed"; // why it is gone
};

// A reader does a first pass, the way 92b runs its sorter: sonnet, no tools, one JSON answer.
// It sees the line, the doc today and the code today (20 lines around each search word).
const answer = await readOnce(promptOf(statement, main)); // {verdict: "holds", why: "..."}

// Part B: a closed ticket whose title names a doc, read by hand.
type Read = {n: number; kind: "drift" | "born" | "unclear" | "not"; fixed?: boolean};
```

## Who did what

- This repo's script, `experiments/134-docs-drift.ts`, fetched PR and ticket lists through `gh`
  (read-only), made the seeded draw, built each reader prompt from a local clone of demlik, called
  the reader and printed the tables.
- The reader is the Claude Agent SDK's `query` with sonnet and no tools, run the way 92b runs its
  sorter.
- I read every line and every ticket myself. My read is the truth. I made it before I saw any
  reader answer.
- No lane ran. Nothing of today's fabrika ran. Nothing was written to GitHub except this PR.

## How it was done

Part A, the doc lines:

- **The 86 set.** The PRs that closed the tickets behind experiment 86's plans: #399, #491, #505,
  #571 and #581. 9 lines.
- **The seeded draw.** demlik PRs merged before 2026-10-17 (a week before the check) that touched
  a README, a SPEC or a page under `docs/reference`, `docs/how-to` or `docs/tutorial`. Release PRs
  and index pages were left out. Shuffled with seed 134.
- **One line per PR.** The first claim about the package's own code, in the first doc that
  describes code. Six PRs had no such claim and were skipped: #127 and #12 (only links), #307 (an
  import across the monorepo), #626 (a TypeScript error message, not package code), #632 (wording)
  and #108 (a deletion). The draw was raised from 25 to 30 PRs to make up for them. 21 lines.
- **Verdicts.** `holds`: the doc still says it and the code agrees. `drifted`: the doc still says
  it and the code now does something else. `gone`: the doc no longer says it, or the code is gone.
  `unsure`: cannot tell.
- **Controls.** Three lines known to be false, each read at the commit just before its fix:
  structure-sweep's split-candidates line (fixed in #489), its `--redact` line about path aliases
  (#474), and the `interpret` type in a tea pattern doc (#366). They check that the reader can say
  `drifted` at all. They are not in the counts.

Part B, the tickets:

- All closed issues in demlik (392) and phoenix (6,412) on 2026-10-23, fetched with
  `gh issue list`.
- A title regex keeps titles that name a doc: README, docs, docblock, comment, JSDoc, SPEC,
  reference, how-to, tutorial, guide, glossary, CLAUDE.md, changelog, page, prose, pattern doc,
  ADR. demlik: 61 hits. phoenix: 1,356.
- I read all 61 in demlik. In phoenix I read a seeded draw of 80. I opened the body when the title
  did not settle it.
- Each is `drift` (true once, made false later), `born` (wrong from the day it was written),
  `unclear` (a mismatch, but the text does not say which) or `not` (not a doc-and-code mismatch).
- The rate per 100 scales the read share up to all hits, then divides by all closed tickets.
- Phoenix titles are not quoted here, only linked by number. A product name from phoenix's
  campaigns would be shown as `‹product›`; none was needed.

## Part A: the doc lines

| Group | Lines | Holds | Drifted | Gone | Unsure |
|---|---|---|---|---|---|
| Experiment 86 tickets | 9 | 4 | 0 | 5 | 0 |
| Seeded draw | 21 | 15 | 0 | 6 | 0 |
| All | 30 | 19 | 0 | 11 | 0 |

- **Gone by moving: 8.** #592 cut code-graph's 1,600-line README to a short page on 2026-10-08.
  Lines from #399, #505 (three), #571, #459, #526 and #589 left with it. Some live on in
  `docs/reference/boundaries.md` or `SPEC.md`; #399's B4 rule holds there.
- **Gone by editing: 3.** The PR that changed the code edited the line in the same diff:
  #362 (the `drive` import path), #683 and #687 (the list of rules a test file skips), #291 (the
  default Msg names). This is the pattern working.
- **Two near misses.** #526's line named door kinds B5, B9 and B13, which #683 later removed. #589's
  line named a `layout` key, which a later change also removed. Both lines had left the README by
  then. Had they stayed, they would have drifted.
- **demlik has lasting docs checks for code blocks, none for prose.** In the tea package, a page's
  code block must hold the compiled source (`src/docs/page-mirrors.ts`, #357), doc pages typecheck
  (#542, #581), links, import specifiers and JSDoc examples are checked, and the reference pages
  are generated and checked (`docs:reference:check`). Code-graph has none of these. No check
  anywhere reads a prose sentence.

The reader agreed with me on 27 of 33 (30 lines and 3 controls):

- On the 30 lines: 27 of 30. It said `holds` on the 3 "gone by editing" lines (#362, #683/#687,
  #291). In each, today's doc says the edited version, and the reader judged the edit too small to
  count. That is a fair reading of a fuzzy line between `holds` and `gone`. Nothing turns on it.
- On the 3 controls: `holds`, `unsure`, `holds`. It never said `drifted`.
  - Split candidates (#489's fix): at that commit the code's own doc comment repeated the same
    wrong definition. The reader trusted the comment.
  - `--redact` (#474's fix): the reader saw the resolver but not the code that rewrites an alias,
    and said `unsure`. That is honest. My control listed too little code.
  - `interpret` (#366's fix): the excerpt held comments, not the type. The reader went by the
    comments.
- **With whole code files** (`WHOLE=1`), the same three: `holds`, `holds`, `drifted`. It found the
  `interpret` drift once it saw the type. On split candidates it saw the gap and called it "a
  nuance". On `--redact` it misread the resolver.
- Cost: $1.55 for the 30 lines, $0.23 for the controls, $0.51 for the controls with whole files.
  Median 4.7 s a call.

## Part B: the tickets

| Repo | Closed | Titles that name a doc | Read | Mismatch | Drift | Born wrong | Unclear | Per 100 closed (drift) |
|---|---|---|---|---|---|---|---|---|
| kamp-us/demlik | 392 | 61 | 61 | 18 | 10 | 6 | 2 | 4.6 (2.6) |
| kamp-us/phoenix | 6,412 | 1,356 | 80 | 11 | 10 | 1 | 0 | 2.9 (2.6) |

- **demlik drift tickets:**
  [#537](https://github.com/kamp-us/demlik/issues/537),
  [#490](https://github.com/kamp-us/demlik/issues/490),
  [#339](https://github.com/kamp-us/demlik/issues/339),
  [#272](https://github.com/kamp-us/demlik/issues/272),
  [#102](https://github.com/kamp-us/demlik/issues/102),
  [#89](https://github.com/kamp-us/demlik/issues/89),
  [#88](https://github.com/kamp-us/demlik/issues/88),
  [#83](https://github.com/kamp-us/demlik/issues/83),
  [#81](https://github.com/kamp-us/demlik/issues/81),
  [#73](https://github.com/kamp-us/demlik/issues/73).
  - Most are one shape: a refactor closes or moves a public door (#46, #47, #48, #99, #324), and a
    how-to, tutorial, pattern doc or ADR still names the old one.
  - Each was filed the same day as the change that broke the doc. For example, #339 (pattern docs
    still say a Cmd handler returns one Msg) was filed the day #324 let it return a list.
  - 9 of 10 were fixed. #89 was closed as not planned.
- **demlik born-wrong tickets:**
  [#559](https://github.com/kamp-us/demlik/issues/559),
  [#116](https://github.com/kamp-us/demlik/issues/116),
  [#488](https://github.com/kamp-us/demlik/issues/488),
  [#518](https://github.com/kamp-us/demlik/issues/518),
  [#473](https://github.com/kamp-us/demlik/issues/473),
  [#356](https://github.com/kamp-us/demlik/issues/356).
  Unclear: [#542](https://github.com/kamp-us/demlik/issues/542),
  [#543](https://github.com/kamp-us/demlik/issues/543), page-against-source sweeps that fixed both
  kinds. Two of my controls came from this list (#488, #473): a born-wrong line is still a false
  line, so it still tests the reader.
- **phoenix drift tickets in the draw:**
  [#9741](https://github.com/kamp-us/phoenix/issues/9741),
  [#6795](https://github.com/kamp-us/phoenix/issues/6795),
  [#6706](https://github.com/kamp-us/phoenix/issues/6706),
  [#5275](https://github.com/kamp-us/phoenix/issues/5275),
  [#5260](https://github.com/kamp-us/phoenix/issues/5260),
  [#4284](https://github.com/kamp-us/phoenix/issues/4284),
  [#4199](https://github.com/kamp-us/phoenix/issues/4199),
  [#3042](https://github.com/kamp-us/phoenix/issues/3042),
  [#2524](https://github.com/kamp-us/phoenix/issues/2524),
  [#376](https://github.com/kamp-us/phoenix/issues/376).
  Born wrong: [#6946](https://github.com/kamp-us/phoenix/issues/6946).
  - Stale comments, stale README paths and names, and skill docs that still teach a rule a later
    ADR replaced.
  - 3 of 11 were closed as not planned (#6706, #5260, #4199): noticed, not fixed. 92b saw the same
    with its churn tickets.
- **92b's phoenix tickets.** Of its 9 churn-or-wrong-doc tickets, 7 are a false fact in a doc:
  [#7216](https://github.com/kamp-us/phoenix/issues/7216),
  [#8141](https://github.com/kamp-us/phoenix/issues/8141),
  [#8246](https://github.com/kamp-us/phoenix/issues/8246),
  [#8338](https://github.com/kamp-us/phoenix/issues/8338),
  [#8577](https://github.com/kamp-us/phoenix/issues/8577),
  [#9951](https://github.com/kamp-us/phoenix/issues/9951),
  [#10236](https://github.com/kamp-us/phoenix/issues/10236).
  They fit the same shape. They were not in the seeded draw, so they are not in the rate.
- **Part A drifts and their tickets.** Part A found no drift, so there was no ticket to look for.

## What it means

- A doc line in demlik rarely goes false while it stays on its page. Two things keep it so: the
  PR that changes the code usually edits the line too, and big rewrites take old lines away.
- When a line does go false, it is nearly always a door being closed or moved. The lane that
  closes it finds the stale docs the same day and files a ticket.
- So drift costs tickets more than it costs wrong docs on main: about 2.6 tickets in 100 in both
  repos.
- The code blocks in tea's docs are already held by lasting checks. Prose has none, and prose is
  where every drift ticket lived.

## Recommendation

**Do not add an agent "do the docs still hold" check to ship or review now.** Confidence 70%.

- Why: in this sample there was nothing for it to catch, and the reader missed every known drift
  it was shown. A check that blocks needs a measured false-alarm rate near 0 (Google, CACM 2018);
  this one has not shown it can find the true ones.
- What it costs to skip: about 2.6 drift tickets in 100 stay as follow-up tickets, filed by the
  lane that breaks the doc.
- **Do instead, cheaply:** when a PR removes or renames an exported name, grep the docs for the old
  name and list the hits in the PR. That is a Gather move, code only. It would have caught #73,
  #81, #88 and #89 before merge (removed subpaths, doors and paths). It would not catch #102 or
  #339, where a behaviour changed and no name did. It needs no model and has no false alarm worth
  measuring, since it only lists. It should advise, not block, until its hits are measured.
- What would lift my confidence: a bigger part A (100 lines or more, spread over code-graph,
  structure-sweep and tea), and the grep tried on the PRs behind demlik's 10 drift tickets.

## What this cannot tell us

- **Thirty lines found zero drifts.** That does not mean the rate is zero. With 0 of 30, the 95%
  upper bound is about 10% (the rule of three).
- **The lines are young.** 12 to 47 days, median 27. Drift grows with age. demlik is two months old.
- **One person read every line.** My read is the truth, and I made it alone. Where `holds` ends
  and `gone` begins is a judgement, as the 3 "gone by editing" lines show.
- **The reader test is small.** 3 controls, two of them weakly set up (one listed too little
  code, one where the code's own comment was wrong too). It shows the reader is not ready. It does
  not show how bad it is.
- **The ticket rate rests on a title regex.** A drift ticket whose title names no doc is missed.
  In phoenix the rate comes from 80 of 1,356 hits, so it is rough: 11 of 80 could be anywhere from
  about 7% to 23% of hits.
- **"Noticed" means a ticket was filed.** A doc that is false and that nobody filed a ticket for
  cannot show up in part B. Part A is the only look at those, and it found none.
- **How long a doc was wrong** was measured only for demlik's drift tickets (same day). For
  phoenix it was not measured.
