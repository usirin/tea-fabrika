# 133. Triage's fold, and whether it needs "ask the filer"

Two questions about triage (the step the code still calls `sort`, in
`packages/pipeline/src/stages/sort/`), which experiments 88, 92 and 92b never
measured:

1. **Fold.** Triage may answer `send:plan:fold`: a yes that is part of an open
   plan. Does today's sorter fold the tickets that really were folded, into
   the right plan, and leave alone the ones that were not?
2. **"Ask the filer for more".** Triage has no such answer. kamp-us/phoenix
   used a `status:needs-info` label for it. Does triage need a seventh answer?

**Answer 1: no, fold does not work yet. On 13 demlik tickets that triage
really folded into an open ticket, the sorter folded into the right one 2 times
out of 26. 13 answers gave the ticket a plan of its own, 4 called it a
duplicate of the right ticket, 6 folded it into a neighbour, and 1 asked for a
ruling. It almost never folds where it should not: 1 of 26 answers on 13
controls. So the sorter is cautious, not random. It folds when the code is the
same, while triage folded when one pull request could carry both. And 11 of
the 13 folds could not have been caught by today's design at all: their target
was not yet a plan when they were filed. Confidence 80%.**

**Answer 2: no seventh answer. Of 15 closed phoenix tickets that once had
`status:needs-info`, a missing fact would have changed triage's answer on 4,
and on all 4 the code held the fact. The filer never did. That is a scout's job
(a code read before sort answers), not a new answer. 7 of the 15 were not
waiting on a fact at all: triage already knew the ticket was a duplicate or
covered, and a rule kept it from closing a ticket with no agent footer.
Confidence 75%.** Cost: $2.66 for 82 sorts on sonnet.

## Who did what

- **The tickets, their closing comments and merged PRs:** today's fabrika, on
  kamp-us/demlik and kamp-us/phoenix, before this run. Every fold, every
  `status:needs-info` label and every answer to one was today's fabrika's
  triage, its agents and the owners.
- **The pick and the answer key (`133-truth.json`):** this run, by search, a
  seeded draw and a hand read of each closing comment, before any sort answer
  was seen.
- **Sort:** this repo's sort stage, run outside its machine. The brief and the
  Check are `promptFor` and `sortProblems` from
  `packages/pipeline/src/stages/sort/brief.ts`, the answer is `SortReply` from
  `answer.ts`, the Agent SDK options are `sorterOptions` from `sorter.ts`, and
  a second try is told what the Check found (`nextTry` from `combos.ts`), as
  the machine does with `tries: 2`. Claude `sonnet` at the SDK's default
  effort, no tools, as in 92b.
- **The script:** `133-triage-folds-and-needs-info.ts`. It reuses
  `firstVersion` and `REPO_NOTE` from `lib/sort.ts`. 92b's bar files are not
  used: today's brief carries its own bar (`bar.ts`).
- **Nothing was written to GitHub.** Every read went through `gh`, read-only.
  No lane ran.

## How it was done

```ts
// What the sorter is handed for one ticket: the world as it stood when the ticket was filed.
const brief: Brief = {
	ticket: { number: 389, state: "open", title, body },   // the first revision of the body
	context: {
		earlier: [ /* every issue filed before it, open or closed at that moment */ ],
		plans: [ /* every ticket open at that moment, as an open plan */
			{ number: 388, tickets: [388], approved: false,
			  summary: "backlog-sweep proposes closing issues Jev calls already_done, … (first 300 characters)" },
		],
	},
	note: REPO_NOTE,
};
const reply = await callOnce(promptFor(brief, null));    // the sorter, no tools
sortProblems(reply, brief);                                // [] passes; else one more try
saidOf(reply.sort);                                        // "fold" when partOf is set
```

### Part A: the folds

- **13 folds.** Found by searching every closing and triage comment on demlik
  for "folded into", "bundled with" and similar words, then read by hand.
- **The bar for a fold:**
  - the target was still open when this ticket was filed;
  - the work landed in the target's pull request.
- **Dropped on the hand read:**
  - 448, 304, 111, 28, 410, 438 to 440: folded into a ticket filed after them.
  - 69, 319, 89: folded as duplicates. Those are `duplicate`, not fold.
  - 313: folded into a ticket that was an owner's direction call; nothing of
    its own landed.
  - 289: moved to the pipeline tool's repo.
- **Two right targets in one case:** 424, 425 and 426 shipped bundled with
  #423, which was one stage of the open umbrella #422. A fold into either
  counts.
- **13 controls.**
  - A seeded draw (seed 133) from the 88 demlik tickets that name a ticket
    open at the time in their body (not an epic), and that got a merged PR of
    their own which closes no other ticket.
  - 430 was skipped on the hand read: #422's closing comment counts it as part
    of #422.
- **The world at filing time.**
  - The ticket is its first revision, as in 88.
  - "Earlier tickets" is every demlik issue filed before it, marked open or
    closed as it stood then. Titles are today's.
  - "Open plans" is every ticket open at that moment, each summed up by the
    first 300 characters of its own first revision: 4 to 36 plans, median 20.
    This is more generous than today's design, where a plan is a ticket sort
    already sent to plan. See below.

### Part B: needs-info

- **80 phoenix tickets ever had `status:needs-info`** (read from every
  issue's label events): 52 closed, 28 open.
- **15 of the 51 closed ones** (one triage self-test left out), by a seeded
  draw.
- **For each, by hand:** what the label waited on, whether anyone answered,
  who held the missing fact, and whether that fact moved the ticket away from
  what its own text asks for.
- **Sort sees** the first revision and the 200 issues filed just before it,
  as in 92b. No open plans: part B is not about fold.

### Cost and calls

- **Estimate first, then 3 tickets per part, then the rest.** The estimate was
  $1.76 for part A and $0.84 for part B before the prompt cache.
- **Spent: $1.80 for part A (52 sorts), $0.85 for part B (30 sorts), $2.66 in
  all.** 82 sorts, 82 calls: the Check passed every first answer, so no
  second try was needed. 1.22M tokens billed. Median 4.2 seconds a sort.
- One field row per sort in `field/runs.jsonl`, and notes 2026-10-24-01 and
  2026-10-24-02.

## Part A: what came back

| | Folds (13 tickets, 26 answers) | Controls (13 tickets, 26 answers) |
|---|---|---|
| Fold into the right ticket | 2 | |
| Fold into another ticket | 6 | 1 |
| Duplicate of the right ticket | 4 | 0 |
| A plan of its own | 13 | 25 |
| Ruling | 1 | 0 |

- **The two right folds** were one run each of #389 (into #388) and #425
  (into the umbrella #422). The other run of each said a plan of its own.
- **The 6 folds into another ticket were all into a neighbour, never into
  something unrelated:**
  - #390 into #389, twice. #389 was its batch sibling, itself folded into
    #388; all three landed in one PR. Close to right.
  - #444 into #397, twice. #444 reported a regression from #397's PR, and
    #397 was still open. Triage folded it into #412, which had the engine
    seam. Defensible.
  - #717 into #715, twice. #715 was the change whose gap #717 reported; its PR
    had merged and it closed 11 minutes later. Triage folded it into #714,
    whose PR was still open. A fold into a plan that is about to close would
    have been lost.
- **4 duplicates of the right ticket:** #21 into #20 and #494 into #493, both
  runs. The sorter saw the link and picked the wrong word. For #494 it said
  the idea "belongs on #493", which is what a fold is.
- **13 plans of their own.** Its reasons say the same thing each time: the
  sibling is "a different change in different code", or "separate work, like
  #423". Real triage folded on another rule: one PR can carry both.
- **The one false fold:** a run of #575 into #573. #575 was a follow-up to
  #573's fix, filed after that fix landed.
- **The bar's `carried` rule ("another open ticket already carries the same
  work") never fired:** 0 of 52 answers. Its reason line says "folded into
  another ticket". So the brief has two words for close to the same thing: a
  `no` by `carried` and a `fold`.
- **22 of 26 tickets gave the same answer both runs.**

### Most folds were a batch, and the design cannot see a batch

- **9 of the 13 folds were filed within 21 seconds of their target, by the
  same filer, in one batch:** 389 to 392 after 388, 413 after 411, 424 to 426
  after 423, 21 after 20.
- **In today's design an open plan is a ticket sort already sent to plan.**
  Sort runs one ticket at a time. When #389 is sorted, #388 has not been
  planned yet, so #388 is not in the list.
- **Only 2 of the 13 targets had been triaged when the fold ticket was
  filed:** #493 (for #494) and #714 (for #717). On those two the sorter said
  duplicate and folded into a neighbour. So under the design as written, the
  sorter caught 0 of the folds it could have seen.
- **The replay listed every open ticket as a plan.** That makes fold easier
  than in real life, not harder, and it still came out at 2 of 26.

```ts
// Sketch, not built: two ways the batch could be caught.
// (a) Sort a batch together: tickets filed by one filer within a minute go in one brief.
type SortAsk = { tickets: readonly string[]; tries: number };
// (b) Leave fold to the planner, which reads the code: sort says plan, the planner says
//     "this is part of plan #388" and the plan grows a ticket.
```

## Part B: what came back

| Who held what triage waited on | Tickets | Fact changed the end | Sort said (both runs alike) |
|---|---|---|---|
| The filer | 1 | 0 | no (`not_work`) |
| The code, or the GitHub API | 6 | 4 | plan 4, research 1, duplicate 1 |
| An owner's ruling | 1 | 0 | ruling |
| An owner's permission only | 7 | 0 | duplicate 5, research 1, ruling 1 |

- **The filer, once (#1919).** The body was a single external link. Nobody
  answered; it was closed minutes later. Sort said `no` by `not_work`, both
  runs, and noted it did not open the link. Asking the filer would have added
  nothing.
- **The code, 6 times.** In 4 the fact changed the end:
  - #4610: the doc's count was right for that file. The code shows it; sort
    said plan.
  - #5806: the GitHub API timeline showed both auto-closes worked the same.
    Sort said research, both runs: the research route is that scout.
  - #6363 and #6382: filed from a branch, and the premise does not hold on
    main. On main #6382 is part of the still-open #6296. Sort said plan.
  - In the other 2 the code only confirmed what the text said (#4017 stays a
    yes; #4065 is a duplicate of #4014, which sort found from the title).
- **An owner's ruling, once (#4934).** The ticket said itself that it was held
  for a ruling. Sort said ruling, both runs.
- **An owner's permission only, 7 times.** Triage already knew the ticket was
  a duplicate or covered. A rule (a ticket with no agent footer is never
  closed by triage) made it park the ticket instead of closing it. Sort said
  duplicate of the right ticket on 5. On the other 2 the ticket it needed was
  outside the 200-issue window: #5945 needed #5526 (sort said research) and
  #6062 needed the ruling on #5752 (sort said ruling).
- **Sort reached the ticket's real end on 8 of 15.** It missed 3 because it
  cannot read the code, 2 because of the window, and 2 (#4017, #5806) where
  its answer was the right next step and the ticket ended for another reason.
- **15 of 15 tickets gave the same answer both runs.**

So the missing fact was never the filer's to give. A scout that reads the code,
or the GitHub API, and asks "does this hold on main?" covers the 4 that
mattered. That fits how the pipeline is already shaped: a Gather before the
Draft, not a seventh verb.

```ts
// Sketch, not built: the scout is a Gather before sort, not a new answer.
const checkOnMain = gather("sort_premise", {
	input: Schema.Struct({ ticket: SortTicket }),
	ok: Schema.Struct({ holds: Schema.Literals(["yes", "no", "unknown"]), why: Schema.String }),
	err: ["unknown"],
});
// sort's answers stay six: done:closed:no, done:closed:duplicate,
// send:plan:yes, send:plan:fold, send:research:yes, ask:owner:ruling
```

## What this means

- **Fold, as written, does not earn its place yet.** Recommendation: before
  changing the brief, decide where folding belongs. Two options, and a lean:
  - Lean: leave fold to the planner, which reads the code and sees what one PR
    can carry. Sort keeps `partOf` only for a report on a plan that is already
    being built. Why: 9 of 13 real folds were batch siblings that sort cannot
    see one at a time, and the 4 others failed on "can one PR carry both",
    which is a code question. Cost: the planner's brief grows a "part of an
    open plan?" step. 70% sure. What would settle it: run the planner on the
    batch (#388 to #392) and see if it pulls the siblings in.
  - Or: sort takes a batch from one filer as one brief, and the brief says a
    fold is "one PR carries both". Cheaper to try, but it does not help the
    later reports (#444, #473, #494, #717).
- **Keep fold apart from duplicate and from `carried`.** The sorter used
  `duplicate` on 4 real folds, and the bar's `carried` rule says "folded" in
  its reason line. Whichever way fold goes, the brief should name one meaning
  each. 80% sure this confusion is real; 4 answers on 2 tickets is a small
  count.
- **No seventh answer for needs-info.** 85% sure for this record: 0 of 15
  needed the filer. What would lower it: a repo where people, not agents, file
  most tickets. Phoenix's filers are almost all agents, so a filer rarely
  knows less than the ticket says.
- **The scout is worth a measure of its own.** 4 of 15 needed a code read.
  Sort sent one of them to research, which is the scout; the other 3 went to
  plan, so the planner would have found it with the code in hand, one stage
  later and at a planner's cost.

## What it cannot tell us

- **The samples are small.** 13 folds, 13 controls, 15 needs-info tickets.
  One more right fold changes the rate by 4 points.
- **Part A has one repo and mostly one filer.** 9 of 13 folds came from four
  batches.
- **The open plans were made up from open tickets.** Real plans carry a plan
  text; these carry the first 300 characters of a ticket. A plan's real
  summary might make the "one PR" link easier to see. Or harder: the replay
  also listed tickets that would never be plans (grilling sessions, a
  standing readout).
- **The answer key is one reader's.** Each fold and each "who held the fact"
  is a hand read of the comments. "Changed" is the trickiest field: #4017's
  first triage was wrong and its second right, and it ended in a campaign kill
  that had nothing to do with either.
- **Part B read only closed tickets.** The 28 still open may be a different
  mix, for example more tickets that really wait on a filer.
- **The 200-issue window cost 2 of 15 in part B.** That is the replay's
  limit, not the brief's; a real host lists every ticket.
- **Titles are today's**, as in 88 and 92b. A title renamed after filing reads
  as renamed.
- **Sonnet at default effort only.** The pipeline's own runs have used haiku
  at low effort (experiment 111). That may fold even less.
