# 92b. The value bar on a repo it was not drafted from

The question: experiment 92's bar for what is worth doing was drafted from
demlik's record, and its "no" side rested on 8 tickets. On a different repo,
with many real "no"s, does sort still close them without closing built work?
And does Jev say "no" where Claude does?

**Answer: no, it does not carry over well. On 35 kamp-us/phoenix tickets that
triage closed under the value bar, the drafted bar alone closed none (0 of 70
answers). With the pipeline's three written clauses added, it closed 18 of 70
(26%; demlik: 8 of 16). And it said "no" to built tickets this time: 8 of 76
answers on tickets a merged PR closed (demlik: 0 of 132). Unlike 92, most
misses did not need the code: in 18 of the 29 missed tickets the filer says
plainly that nothing failed or nothing changes, and sort still said yes,
calling it "a real bug" or "a real wrong doc". 9 more sit on a line the bar's
words do not draw; only 2 needed the code. The same clause, read loosely,
also closed built work. Jev agreed with
Claude's "no" 2 times out of 18, never said "no" at or above the 0.8 floor, and
never said "no" to a built ticket. Confidence 75%. $12.37 for Claude, about 5
cents for Jev.**

## Who did what

- **The tickets, labels, closing comments and merged PRs:** the fabrika
  pipeline on kamp-us/phoenix, before this run.
- **The bar:** experiment 92's two files, unchanged. `92-value-bar.json`
  (drafted from demlik's record) and `92-written-bar.json` (the clauses the
  pipeline's triage skill states).
- **The pick and the answer key (`92b-truth.json`):** this run, by a seeded
  draw and a hand read of each closing comment, before any sort answer was
  seen.
- **Sort's code:** `92b-sort-bar-phoenix.ts`, on `lib/sort.ts` and
  `lib/sort-bar.ts`. The bar's brief, Jev's questions and the scores moved out
  of `92-sort-bar.ts` into `lib/sort-bar.ts`, so 92 and 92b share one copy.
  92's and 88's tables came out byte for byte the same after the move.
- **Sort:** Claude (`sonnet`) through the Agent SDK, no tools, one turn.
- **Jev:** `jev-latest`, three questions in one call, as in 92.
- **The reading of each miss:** a separate agent, after the run, from the
  ticket as filed, triage's closing comment and sort's reason.
- **Nothing was written to GitHub.** Every read went through `gh`, read-only.
  No lane ran.

## How it was done

### The tickets

- **79 closed phoenix tickets.** Their text is what each was when filed (the
  oldest revision of the body, the title before any rename), as in 88 and 92.
- **35 real "no"s.**
  - Closed not planned by triage, with the `closed-by-triage` label.
  - The closing comment names exactly one value-bar clause.
  - It does not fold, supersede or duplicate the ticket into another one, and
    it is not a campaign-wide kill.
  - A seeded draw of 18 per clause: "hardening with no incident" and
    "self-generated churn". One churn ticket was dropped on the hand read: its
    closing comment folds it into an open ticket.
  - The third clause, "process ceremony", could not be drawn. Only a handful
    of closures name it, and most of those are a campaign kill that mentions
    the word.
  - All 35 carry the agent-filed footer.
- **6 duplicates.** The closing comment opens with "duplicate of #N", and #N
  is among the 200 tickets listed before it.
- **38 built tickets as "yes" controls.**
  - A seeded draw from tickets filed in July 2026 or later, closed completed
    by a merged PR. No epics.
  - `next` comes from triage's type label: a decision is ruling (6), an
    investigation is research (2), the rest plan (30).
  - Phoenix has very few investigations closed by a merged PR, so research
    has only 2 tickets.
- **Why the answer key holds:**
  - A "no" is triage's own closure, under a clause the brief states.
  - A "yes" is a ticket someone built and merged.
  - The route for a yes is triage's label, read before the run. That is
    weaker than 88's hand reading.

### The briefs

- **The same three as 92:** no bar (88's brief), the drafted bar, and "both"
  (drafted bar plus the written clauses).
- **Two changes for phoenix, nothing else:**
  - The repo note says what phoenix is: the kamp.us site, fabrika (the
    pipeline, whose home is this repo), Tuval, small packages.
  - The bar's examples keep their words but lose their demlik issue numbers.
    On phoenix, "#223" would name a different ticket.
- **The earlier-ticket list is the 200 filed just before the ticket**, not all
  of them. Phoenix has over 7,000 issues; the full list would make each call
  about 100k tokens. Every duplicate's original falls inside the 200.
- **Each ticket sorted twice with each brief.**

### How it was scored

- Same as 92. A duplicate counts as a no.
- **Real "no" closed:** on the 35 "no" tickets, answered no or duplicate.
- **False no:** a no or duplicate on a built ticket.
- **Route:** right by `next`, on the built tickets.

## What came back

| | No bar | Drafted bar | Both |
|---|---|---|---|
| Yes/no right (158 answers) | 86 (54%) | 84 (53%) | 96 (61%) |
| Real "no" closed (70 answers) | 0 | 0 | 18 (26%) |
| of which hardening (36) | 0 | 0 | 12 (33%) |
| of which churn (34) | 0 | 0 | 6 (18%) |
| False no on built tickets (76 answers) | 0 | 2 (3%) | 8 (11%) |
| Route right on built tickets (76 answers) | 64 (84%) | 63 (83%) | 55 (72%) |
| Duplicates right (12 answers) | 8 | 8 | 8 |
| Same answer both runs (79 tickets) | 77 | 76 | 70 |
| Cost | $3.76 | $4.17 | $4.44 |

### Beside demlik (experiment 92, "both")

- **Real "no"s closed:** 8 of 16 on demlik, 18 of 70 here.
- **False "no"s:** 0 of 132 on demlik, 8 of 76 here.
- **Stability:** 45 of 45 on demlik, 70 of 79 here. The bar makes sort
  waver on phoenix: most of the 9 split tickets are "no" once, "plan" once.

### The drafted bar did nothing on phoenix

- **0 real "no"s closed, with or without it.** None of its seven no-rules
  matched a value-bar closure. They are about demlik's kinds of "no": already
  fixed, target removed, a settled ruling, a bug in the pipeline tool.
- **"A bug in the pipeline tool goes to the tool's repo" did not misfire.**
  The repo note says the tool lives here, and sort never used the rule.
- **Its 2 false "no"s are one ticket**, a flaky-test investigation (#2915)
  read as a duplicate of an earlier flake report. A fair reading; triage kept
  it apart.

### The false "no"s with both

- **Four built tickets, 7 answers of "hardening with no incident", and the
  same #2915 duplicate once.**
  - #2563, a security gap with no exploit seen (both runs).
  - #2792, regex patterns open to slow input, with no alert active (one run).
  - #6457, two extra database reads per page behind a dark flag (both runs).
  - #7750, tests for four refusal paths that already work (both runs). This
    is almost word for word the clause's own example. Phoenix triage built it
    anyway.
- **Two of the four were filed before the clauses existed.** Phoenix's first
  closure under either clause is from 2026-08-18. #2563 and #2792 were
  triaged before that, so "built" there may only mean "no bar yet".
- **The other two were triaged under the same clauses and still built**
  (#6457, #7750). On the 16 built tickets filed after the clauses began,
  sort said "no" 4 times in 32 answers.
- **So the clause, read as written, closes things phoenix's triage chose to
  build.** Triage's real line is narrower than its words.

### The misses

- **29 of the 35 "no" tickets were missed at least once with both.** 23 were
  missed both times, 6 once.
- **Each miss was read by a separate agent**, against the ticket as filed,
  triage's closing comment and sort's own reason. Three kinds:
  - **The text shows it (18):** the filer says nothing has failed, nothing
    breaks today, or nothing changes, and sort said yes anyway.
    - Hardening (10): #7318, #7344, #8242, #8259, #8320, #8327, #8501,
      #9727, #10138, #10142. Example: #9727's body says "nothing in the tree
      does this today"; sort called it "a concrete bug in a shipped guard".
    - Churn (8): #8496, #8587, #8785, #8826, #9890, #10128, #10144, #10214.
      Dead exports, an unread field, a refactor with no behavior change.
      #8826 is almost word for word the clause's own example.
  - **A line the bar does not draw (9):** the facts are in the text, but
    whether it is churn or "a real wrong doc" is a call the words leave open.
    - Churn (7): #7216, #8141, #8246, #8338, #8577, #9951, #10236. Each is a
      comment, record or doc pointer that states a false fact. Sort read the
      drafted "a real bug or wrong doc in what a package ships is still a
      yes"; triage read "a docblock nit is churn".
    - Hardening (2): #8537 (wrong trace parents, "not a correctness bug"),
      #10463 (a wrong hint in shipped CLI output).
  - **Needs the code (2):** #7986 and #10139. The body argues a real
    failure; only reading the code and history showed it was not one.
- **Why sort said yes on text that shows a "no":** its reasons repeat two
  moves.
  - "A concrete defect sits in the code" is taken as if it were an incident.
  - "Not a docblock nit, it is a real wrong doc / real dead code" is used to
    step out of the churn clause. Dead code and refactors are not in the
    clause's list of examples.
- **This is the opposite of 92.** On demlik every miss needed the code or a
  run. Here almost none did: sort had what it needed and did not apply it.

### The route

- **No bar and drafted bar route about the same**: 84% and 83% right on built
  tickets, near 88's 85% on demlik.
- **"Both" drops to 72%**, mostly because 7 answers went to "no". When it
  said yes, it was right 55 of 68 times (81%).
- **The same misses with every brief:** #6580 and #6759 (bugs read as
  rulings), #2156 (a flaky test read as research), #6314 and #4976 (labelled
  decisions read as plain fixes). The last two may be the label's fault more
  than sort's.

### Duplicates

- **4 of 6 right with every brief.** The bar did not change them.
- #6262 was named a duplicate of a different earlier ticket every time, one
  the closing comment calls related.
- #6818 was always "plan". Its original is an open ticket whose title does
  not show the overlap.

### Jev on the same answers ("both")

- **Agreement with Claude, run by run (158 pairs):**
  - **Duplicate:** 149 of 158 (94%). At 0.8 or above, 125 of 125.
  - **Yes/no** (neither said duplicate): 115 of 138 (83%).
  - **Route** (both said yes): 83 of 113 (73%). Only 56% clear the floor.
  - **Whole answer:** 96 of 158 (61%).
- **The "no" side, split as 92 could not:**
  - **On real "no" tickets:** Claude said no 18 times; Jev agreed 2 times.
    Jev said no only 2 times in all, both under the floor.
  - **On built tickets:** Claude said no 7 times; Jev said no 0 times. Jev
    never once said "no" to a built ticket.
  - So Jev does not repeat Claude's false "no"s, but it does not catch the
    real ones either. It reads the bar as "yes" almost always.
- **Jev's own false closes are duplicates, all under the floor.** It called 5
  built tickets duplicates at 0.52 to 0.73. At the floor, none would close.
- **Cost and time:** about $0.0003 a call against Claude's $0.028; 0.12 s
  against 4.4 s median.

## What it means

- **The bar does not carry over as text.** On demlik it closed half the real
  "no"s with no false "no". On phoenix it closed a quarter and hit built work.
- **The drafted bar is demlik's own.** Its rules name the kinds of "no" demlik
  has. They found nothing on phoenix, and they harmed nothing either.
- **The written clauses are the part that moves "no"s.** All 18 closes came
  from "hardening with no incident" and "churn".
- **But sort applies them loosely, in both directions.**
  - It keeps tickets whose own text says nothing failed (18 tickets), by
    calling a defect in the code "a real bug".
  - It closes built tickets whose text says nothing failed yet (a security
    gap, a cost behind a dark flag, a test gap), by reading the same clause
    word for word.
  - The 9 tickets that flip between runs are this same wobble.
- **The words of the bar are not the owner's line.** What phoenix's triage
  did is narrower and sharper than the clauses say:
  - a false fact in our own comment, record or doc pointer is churn, not "a
    real wrong doc";
  - dead code and a refactor with no behavior change are churn;
  - a code path nobody hits is hardening, even when it is a real defect;
  - but a security gap, a real cost, or a test the owner asked for gets
    built.
  - The drafted "a real bug or wrong doc in what a package ships is still a
    yes" pulls the other way on every churn ticket.
- **Most misses are fixable in the brief, not only by giving sort the code.**
  Only 2 of 29 needed the code. That is the opposite of 92.
- **Sort from text alone should not close on these clauses yet.** Its "no"
  is right about 2 times in 3 here (18 real against 8 false). A "hardening"
  or "churn" match is a proposed close for a person or a code-reading step,
  not a close.
- **Jev is not ready for sort's "no" on either repo.** It agrees on the easy
  "yes" and misses nearly every "no", now on 70 answers instead of 6.

## What this does not show

- **The "no" side is two clauses.** "Process ceremony" had no clean
  closures to draw from.
- **The route key for built tickets is triage's label**, not a hand reading
  of each history.
- **The earlier list is 200 tickets, not all.** A duplicate older than that
  could not be found. All 6 here were inside it.
- **Built is not the same as worth building.** A ticket closed by a merged PR
  says someone chose to build it, not that the owner would choose it today.
  Two of the four false "no"s predate the clauses.
- **The miss reading is one agent's**, from the ticket, the closing comment
  and sort's reason. "Text shows it" and "a line the bar does not draw" can
  blur.
- **One model, one prompt shape, two runs.**
- **Phoenix's tickets are agent-filed and long, like demlik's.** A person's
  short report may sort differently.
- **A quirk in the shared brief, kept as it is:** the earlier list is headed
  "newest first", but `promptOf` reverses `gh`'s newest-first list, so it
  prints oldest first. That is true of 88 and 92 too. It was left as it is so
  their briefs stay byte for byte the same.

## Run it

```
node experiments/92b-sort-bar-phoenix.ts                               # the tables; REASONS=1 adds each "no" reason, WHY=1 each miss's why
STEP=fetch node experiments/92b-sort-bar-phoenix.ts                    # first versions, through gh, read-only
STEP=sort VARIANT=nobar|bar|both node experiments/92b-sort-bar-phoenix.ts   # DRY=1, PROMPT=1, ONLY=, RUNS=, MAX_USD=, MODEL=
STEP=jev VARIANT=bar|both node experiments/92b-sort-bar-phoenix.ts     # needs TYPESAFE_API_KEY; DRY=1, ONLY=, RUNS=
STEP=field VARIANT=nobar|bar|both node experiments/92b-sort-bar-phoenix.ts  # field/runs.jsonl rows
```
