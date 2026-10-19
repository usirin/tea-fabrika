# 92. Sort with the repo's bar for what is worth doing

The question: once sort's brief carries the repo's bar for what is worth
doing, does it say "no" where triage said no, without closing good tickets?
And does Jev give the same answers for far less?

**Answer: partly. A bar drafted only from demlik's record did not catch a
single one of experiment 88's three "no"s. demlik's record holds almost no
closures for worth, and the few it has were the held-out test tickets. Adding
the three clauses today's pipeline already has in writing (ceremony, churn,
hardening with no incident) caught both "hardening" tickets every time. On
the 45 tickets, real "no"s closed went from 2 of 16 answers to 8 of 16. It
closed no good ticket in 132 answers on real yeses, and the route went from
56 to 58 of 66. Every "no" it still missed needed the code or a run. Jev
agreed on the route and the duplicate check most of the time, but it never
said "no" where Claude did (0 of 6), and its few confident misses would close
a good ticket. Confidence 70%: the "no" side rests on 8 tickets. $5.11 for
Claude, about 6 cents for Jev.**

## Who did what

- **The tickets, labels, rulings and closing comments:** today's fabrika on
  kamp-us/demlik, before this run.
- **The drafted bar (`92-value-bar.json`):** a separate agent, from demlik's
  own record, with every test ticket kept from it (below).
- **The written clauses (`92-written-bar.json`):** the value bar the triage
  step of today's pipeline states (the fabrika plugin's triage skill, in
  kamp-us/phoenix), put in plain words. Not written here.
- **The added answer key (`92-truth.json`):** a reader, from each ticket's
  closing comment, before any answer was seen.
- **Sort's code (`92-sort-bar.ts`, `lib/sort.ts`):** tea-fabrika. `lib/sort.ts`
  is experiment 88's answer shape, fetch, brief and call, moved out so both
  scripts share it. 88's tables and prompts come out the same, byte for byte.
- **Sort:** Claude (`sonnet`) through the Agent SDK, no tools, one turn.
- **Jev:** `jev-latest`, three questions in one call.
- Nothing was written to GitHub. No lane ran.

## The bar, as drafted

**A draft for the owner to check. It is not a ruling.**

### When a ticket is a no (drafted from demlik's record)

- **Already fixed on main.** The fix or bump it asks for has already
  merged. Needs the code. Example: #223, a version bump already added the
  verbs.
- **The target was removed.** The code or page it is about has since been
  deleted. Needs the code. Example: #193, a viewer bug after the viewer was
  deleted.
- **Another ticket already carries the work.** Fold it in. Example: #89, a
  doc sweep an earlier sweep ticket covered.
- **A later design replaced it.** Example: #414, replaced by a staged
  pipeline.
- **It re-asks a settled no.** An ADR or an owner ruling already said no,
  and the ticket brings no new fact. Example: #268, the owner dropped the
  wrapper layer.
- **It is a bug in the pipeline tool itself.** It goes to the tool's own
  repo; only a pin bump or a config line is work here. Example: #222.
- **It is not a work item.** A standing readout or tracking page. Example:
  #3.

### Still a yes, even when it looks like a no (drafted)

- **It only looks done.** Close as done only when a merged change is found.
  Example: #388.
- **A host's first ask of tea.** The owner rules on it; even "no new API"
  ships a how-to page. Example: #317.
- **Not now is not no.** Right work that no campaign needs yet stays open.
  Example: #322.
- **One user's gap can still be basic.** A gap every host needs, or a real
  bug or wrong doc in what a package ships. Example: #314.

### The written clauses (today's pipeline, not drafted here)

- **Process ceremony.** It only makes a record nobody acts on.
- **Self-made churn.** An agent's ticket against our own output that changes
  no behavior.
- **Hardening with no incident.** Has this ever failed in real use? If not,
  no. A missing test for a check that already works is this.
- **Still a yes:** a ticket a person filed by hand is never closed by these
  alone.

## How it was done

### Keeping the test tickets out of the bar

- **The bar was drafted by a separate agent**, not by the one running the
  test. It never saw experiment 88's write-up, its results or this brief.
- **It was given the numbers of all 45 test tickets** and told not to open
  them, their comments, or any comment or ruling about them.
  - It reported what it skipped: the rounds of one grilling session (325)
    about four test tickets, a roadmap line, three ADRs that rule on test
    tickets, and mentions in other tickets' comments.
- **It was told not to read the pipeline's own skills or this repo.** So the
  written clauses could not reach the drafted bar.
- **The drafted bar is general.** Each rule names a kind of ticket and points
  at non-test evidence.
- **What leaked anyway, said plainly:**
  - The runner knew experiment 88's result and the phrase "hardening with no
    incident". That is why the written clauses are a separate brief, taken
    word for word in meaning from a skill written before any test ticket.
  - The written clauses are general, but triage used them to close #295 and
    #633. So the second brief is close to the answer key for those two. It
    tests whether sort applies a stated rule, not whether a rule can be
    found.

### The tickets

- **Experiment 88's 40**, the same first title and body, the same answer key,
  with 88's two corrections kept.
- **5 added "no"s.** Every other demlik ticket closed as not planned whose
  "no" the filed text could show:
  - #654, hardening with no incident;
  - #61, an owner's "no ticket needed" for a person's own read;
  - #286, not a work item (a bot's readout home);
  - #289 and #348, bugs in the pipeline tool, sent to its own repo.
- **Left out:** duplicates and folds (88 tested those), tickets whose target
  was deleted later, tickets a later fix made moot, and plans replaced later.
  Sort could not see any of those at filing time.
- So the "no" side is 8 tickets: 88's three (#295, #633, #615) and these five.

### The briefs

- **No bar:** experiment 88's brief. Its answers for the 40; a fresh run for
  the 5 added.
- **Drafted bar:** 88's brief plus the drafted bar, after the "is it worth
  doing?" line. Nothing else changed.
- **Both:** the drafted bar plus the written clauses.
- Each ticket sorted twice with each brief. The full first body, as 88's
  main run.

### How it was scored

- **Yes/no right:** a duplicate counts as a no.
- **Real "no" closed:** on the 8 "no" tickets, answered no or duplicate.
- **False no:** a no or duplicate on a ticket that really went to plan,
  ruling or research. The cost that matters most.
- **Route:** right by `next` on the tickets that really were a yes, as in 88.

## What came back

| | No bar (88) | Drafted bar | Both |
|---|---|---|---|
| Yes/no right, 88's 40 tickets (80 answers) | 71 (89%) | 70 (88%) | 74 (93%) |
| Real "no" closed, 88's 3 (6 answers) | 0 | 0 | 4 |
| Real "no" closed, the 5 added (10 answers) | 2 | 4 | 4 |
| False no, real yeses (66 answers) | 0 | 0 | 0 |
| Route right, real yeses (66 answers) | 56 (85%) | 57 (86%) | 58 (88%) |
| Same answer both runs, all tickets | 42 of 45 | 44 of 45 | 45 of 45 |
| Cost | $1.95 + $0.23 | $2.39 | $2.49 |

### The "no" side, ticket by ticket

- **#295 and #633, hardening:** plan with no bar and with the drafted bar.
  With the written clauses, "not now: hardening with no incident", all four
  answers.
- **#348, a pipeline-tool bug:** plan with no bar; "won't do here: a bug in
  the pipeline tool itself" with either bar, all four answers. The one
  drafted rule that caught a held-out ticket.
- **#286, the readout home:** a duplicate of #3 with every brief. Right to
  close, by another road.
- **#654, hardening, missed every time.** Its own body names #633's closure
  as hardening, then argues this one differs because the path exists today.
  Sort agreed. Triage closed it only after running the case: the tests
  already catch it. A reporter who knows the bar can argue past it; the
  clause's "has it ever failed?" is a fact only the code answers.
- **#615, "working as designed", missed every time.** Triage ran a fixture to
  see it. Needs the code.
- **#289, a pipeline-tool bug, research every time.** Sort said nobody knows
  yet whether the path list is the tool's or the repo's, and someone has to
  read the tool. That is the step triage really took before closing it. Not
  a wrong answer for a sort with no code.
- **#61, a person's cold read, research every time.** No rule says "a task
  for a person needs no ticket". The written "ceremony" clause did not fire.

### False "no"s

- **None, with any brief, in 198 answers on real yeses.**
- The drafted "still a yes" rules did their job on the hard cases:
  - #320 and #323, which an owner later ruled out, went to ruling, not no.
  - #319 said "no" once with no bar; with a bar it went to ruling.

### The route

- **Up by one or two answers, steadier.** 58 of 66 with both, against 88's 56.
- **What moved:**
  - #316, #320, #323 went from plan to ruling, which is right. The "host's
    first ask: the owner rules" rule did it.
  - #147 went from plan to ruling, which is wrong: the same rule read a new
    API ask as an owner's call.
  - #248 went to ruling both times (88: once).
  - #272, #604, #173 missed as in 88, for the same reasons.

### Jev on the same answers

- **Three questions in one call:** is it a duplicate, is it worth doing by
  the bar, and the route. Same state as Claude's: repo note, bar, ticket,
  earlier titles. Twice per ticket, per brief. The largest call was 12k
  tokens.
- **Agreement with Claude, both brief, run by run (90 pairs):**
  - **Duplicate:** 82 of 90 (91%). At 0.8 or above, 62 of 64 (97%); 71% of
    answers clear the floor.
  - **Yes/no** (neither said duplicate): 72 of 76 (95%).
  - **Route** (both said yes): 64 of 72 (89%). At 0.8 or above, 37 of 38;
    only 53% clear the floor.
  - **Whole answer:** 70 of 90 (78%).
- **The yes/no agreement is all on "yes".** Where Claude said no, Jev said no
  0 of 6 times: #295 got yes at 0.95 or more, and #633 a weak duplicate. The
  drafted-bar run was the same: 0 of 2.
- **Where they differ, across both briefs:**
  - Jev calls a good ticket a duplicate: #273, #361, #554, #633, #654.
    **#361 cleared the floor** (0.81 to 0.84): at the floor, Jev would close
    a ticket that was really built.
  - Jev sends plain fixes to ruling: #529, #575, #166.
  - With the drafted bar, Jev said "no" to #289 twice (0.56, 0.58, under the
    floor), which was right, where Claude said research.
- **Cost and time:** about $0.0003 a call against Claude's $0.028 (about 90
  times less); 0.13 s against 4.5 s median (about 35 times faster).
- **This matches** [Jev: the same answer, cheaper](../docs/direction/jev-same-answer-cheaper.md):
  its wrong answers lean toward closing without a person.

## What it means

- **Sort needs the bar in writing, and the written clauses are what did the
  work.** demlik's own record could not teach the "hardening" rule: the
  repo's only closures for it were the test tickets themselves.
- **The drafted bar still earns its place, on two counts:**
  - its "still a yes" rules kept sort off the owner-ruled tickets and sent
    them to ruling;
  - "a pipeline-tool bug goes upstream" caught #348.
- **What sort can close from text alone:** a rule that the ticket's own words
  show. Everything else needs a step with the code. That is a "research"
  route, which sort gave #289 by itself.
- **A reporter who knows the bar can argue past it (#654).** The bar's
  factual clauses ("has it ever failed?") need a check, not a reading.
- **Jev is not ready for sort's "no".** It agrees on the easy majority and
  misses every case where the answer matters. Its confident misses close
  good tickets.

## What this does not show

- **The "no" side is small.** 8 tickets, 16 answers per brief. Two of the
  hits (#295, #633) come from clauses triage used to close them.
- **The bar is a draft no owner has read.** Its rules may not be the owner's.
- **One model, one repo, one prompt shape.** demlik's reports are agent-filed
  and long; a person's short report may sort worse.
- **The answer key for the 5 added was read by one reader**, from closing
  comments.
- **Jev's agreement is mostly agreement on yes.** The two classes this
  experiment cares about (no, duplicate) are where it disagreed.

## Run it

```
node experiments/92-sort-bar.ts                          # the tables
STEP=fetch node experiments/92-sort-bar.ts               # first versions, through gh, read-only
STEP=sort VARIANT=bar|both|nobar node experiments/92-sort-bar.ts    # DRY=1, ONLY=, RUNS=, MAX_USD=, MODEL=
STEP=jev VARIANT=bar|both node experiments/92-sort-bar.ts           # needs TYPESAFE_API_KEY; DRY=1, ONLY=, RUNS=
STEP=field VARIANT=bar|both|nobar node experiments/92-sort-bar.ts   # field/runs.jsonl rows
```
