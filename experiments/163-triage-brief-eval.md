# 163. The triage brief, made the tested way

The question: can we test a triage brief the way a brief-lab program would
(ticket #62), with one labelled set, a locked half, an owner's bar and one
scorer? Part 1 builds every piece and proves the harness on 5 cases. It does
not score the brief. [Part 2](#part-2-tune-and-lock) tunes the brief on the
open half and scores it once on the locked half. [Part 3](#part-3-triage-reads-the-code)
lets triage read the code and gets a brief ready for a fresh exam.

**Part 3's answer: reading the code helps, and v5 is ready for the exam.**
With read-only access to phoenix's code as it was on the day each ticket was
filed, brief v5 on GPT sol closed 6 of 78 built tickets (bar: at most 13%),
0 of 10 security tickets, 53 of 58 hard no's (bar: at least 55%) and gave the
same verdict twice on 118 of 119. These are tuned numbers on all 119 cases, so
the old locked half is spent and they are an upper bound. On opus, a 16-case
sample got 14 right for $3.33. The exam on a fresh set has not run.

**Part 2's answer: the tuned brief failed the bar.** Brief v3 was perfect on
the open half on opus and closed 9 of 40 locked built tickets (bar: at most 5)
and 1 of 5 locked security tickets (bar: 0). It fit the 58 cases it was tuned
on. GPT sol has no locked score: the lock refused a second model on the same
brief. Opus cost $17.96.

**Answer: the pieces are built and the harness works on both models. 119
labelled phoenix cases, split 58 open and 61 locked. Brief v1 is 388 words with
three close rules. On 5 open cases, opus got all 10 answers right; GPT sol got 8,
closing one built ticket as hardening in both runs. Opus cost $0.61. The bar
below waits for the owner.**

```ts
// The whole shape: six steps, each a file in and a file out.
const set   = readJson("163-set.json", LabelledSet);        // step 1: the labelled set
const split = readJson("163-split.json", Split);            //         its halves, seed 163, per kind
const bar   = readJson("163-bar.json", Bar);                // step 2: the owner's bar (proposed)
const brief = briefOf(read("163-briefs/triage-v1.md"));     // step 3: the brief, with id and hash
const open  = await score({brief, model, cases: openHalf, half: "open", runs: 2, ...}); // step 4
// step 5: STEP=lock refuses until bar.status is "approved"; step 6: verdictOf(bar, summarize(...))
```

## Which piece is which program step

| Program step | Piece here | In | Out |
|---|---|---|---|
| 1. Build a labelled set | `STEP=set`, `STEP=split`; `LabelledSet`, `Split`, `splitOf` | 92b-truth.json, 162-truth.json | `163-set.json`, `163-split.json` |
| 2. Get the owner's pass bar | `STEP=bar`; `Bar` | `163-bar.json` (by hand) | the bar in counts on the locked half |
| 3. Draft the brief | `163-briefs/triage-v1.md`; `Brief`, `briefOf` | the writing guide | the brief, its rules and hash |
| 4. Tune on the open half | `STEP=tune`; `score`, `Sorter`, `RunRecord` | brief, model, open cases | `results/163-triage-brief-eval.json` |
| 5. Score once on the locked half | `STEP=lock` | an approved bar | the same results file, `half: "locked"` |
| 6. Decide | `STEP=decide`; `summarize`, `verdictOf` | locked records, bar | pass or fail per bar line |

The reusable parts are in `lib/brief-eval.ts` (schemas, the `Sorter` service, a
fake of it, the scoring and the numbers, no platform import) and
`lib/brief-eval-live.ts` (the live Sorter). A program can use them as they are:

```ts
// The service a program swaps: live for a real run, fake for a test at $0.
class Sorter extends Context.Service<Sorter, {
  readonly sort: (brief: Brief, model: Model, c: Case) => Effect.Effect<Said>
}>()("exp-163/Sorter") {}

const records = yield* score({brief, model: "sol", cases, half: "open", runs: 2,
  have: [], concurrency: 2, kept: save, stop: () => false});
// provided by liveSorter(world), or by fakeSorter({"kamp-us/phoenix#8577": {answer: "keep", why: "..."}})

// One answer, as a record: the shape a ledger fact could take.
{ case: "kamp-us/phoenix#6457", half: "open", brief: "triage-v1", hash: "2ccebff3e7c1",
  model: "sol", modelId: "gpt-6.1-sol", run: 1, said: "close", rule: "hardening", of: null,
  why: "...", right: false, usd: null, ms: 7600, tokens: {...}, error: null, at: "2026-10-28T..." }
```

`STEP=selftest` runs `score` and `summarize` on the fake over the 58 open
cases, with three planted mistakes, and checks every number: 9 of 9 pass, $0.

## Who did what

- **The labels:** today's fabrika on kamp-us/phoenix, before this run.
  Phoenix's triage closed the no's; its builders and shippers merged the built
  tickets. 92b and 162 read them into their truth files.
- **The set, the split, brief v1, the bar and the scorer:** this run.
- **Opus:** the Claude Agent SDK on its own login, `TYPESAFE_API_KEY` unset, no
  tools. Brief v1 as the system prompt. The alias resolved to `claude-opus-5-5`.
- **GPT sol:** this repo's Codex adapter through 162's `codexTurn`, model
  `gpt-6.1-sol`, effort medium, on the laptop's ChatGPT plan, no OpenAI key.
  Brief v1 goes before the case, as 162 did with its system line. Each turn's
  Codex home and the empty work folder were removed after.
- **Nothing was written to GitHub.** Every read went through `gh`, read-only.
- **Nothing was copied from today's fabrika triage skill.** Brief v1 was written
  fresh, from the writing guide and the labelled whys.

## How it was done

### The labelled set

The question is yes or no: does triage close the ticket (a no or a duplicate),
or keep it? Every case has an id, a source, a kind, the right answer and a
short why.

| Kind | Cases | Open | Locked | From |
|---|---|---|---|---|
| hard-no | 29 | 14 | 15 | 92b's no's its brief missed at least once |
| easy-no | 6 | 3 | 3 | 92b's no's its brief closed both times |
| duplicate | 6 | 3 | 3 | 92b's duplicates |
| hard-yes | 5 | 2 | 3 | 135's built tickets 92b's brief closed |
| built | 33 | 16 | 17 | the rest of 92b's built tickets |
| built-random | 30 | 15 | 15 | 162's random draw |
| security | 10 | 5 | 5 | 162's held-out security tickets |
| all | 119 | 58 | 61 | |

- **"The 58 hard no's" are 29 tickets.** 135, 159 and 161 ran each twice; 58 is
  the answers. The set counts tickets.
- **The split:** each kind sorted by id, shuffled with seed 163 (the seeded
  shuffle 135 and 162 used), first half rounded down open, the rest locked.
  `STEP=split` refuses to run twice.
- **Left out, with the reason in `163-set.json` (`left`):**
  - demlik's 88 and 92 (45 tickets): another repo with another bar. Its no's are
    "already fixed on main", "the target was removed" and "a settled no asked
    again", which need the code and which brief v1 has no rule for. They want
    their own set.
  - 133's 13 folds: a fold's right answer is neither close nor keep. The work is
    real and lands in another open ticket's plan, so a yes-or-no answer cannot be
    scored on it. Its 13 controls only exist to test folds.
  - 133's 15 needs-info cases: the right answer is a third outcome, asking the
    filer.

### Brief v1

`163-briefs/triage-v1.md`, id `triage-v1`, hash `2ccebff3e7c1`. In one line:
*test the ticket against three close rules (duplicate, hardening, churn), each
with a test and its "keep instead" cases; keep is the safe answer.*

- **Shape, from the writing guide:** two steps, each with a done condition
  ("done when all three rules are tested", "done when `why` quotes the
  evidence"); one heading per rule; the targets stated, not the bans.
- **Each rule has a test and its exceptions.** The exceptions are 162's lessons:
  an epic's part, a takeover or a failed fix is not a duplicate; a real bug or a
  security gap is not hardening.
- **The answer is data the brief defines.** A close must name one of the
  brief's own rules: `answerOf(brief)` builds the schema from the `## close:`
  headings, so a close with no rule cannot be written.

```ts
{ triage: { answer: "close", rule: "duplicate" | "hardening" | "churn", of: number | null, why: string }
        | { answer: "keep", why: string } }
```

### The scorer

- `score` runs every case up to its runs through the `Sorter` and saves each
  record as it comes, so a stopped job goes on where it was.
- `summarize` gives the numbers, each with a Wilson 95% interval:
  - **bad closes:** built tickets (every case whose right answer is keep)
    closed at least once, on tickets; and on answers.
  - **security closed:** security tickets closed at least once.
  - **hard no's closed** and **all no's closed**, on answers.
  - **missed no's:** close cases kept at least once, on tickets.
  - **agreement:** tickets whose runs all gave the same verdict.
- Intervals on tickets, not answers, where the two runs of one ticket are not
  independent (162 found them the same almost every time).

### The proposed bar (`163-bar.json`, status `proposed`)

Per model, on the locked half, read on the point share:

| Line | Bar | On the locked half | Why |
|---|---|---|---|
| bad closes | at most 13% | at most 5 of 40 built tickets | opus on 92b's brief in 162: 4 of 30 random built tickets. A wrong close is work nobody sees again |
| security closed | 0% | 0 of 5 | the worst wrong close; both models closed 2 of 10 in 162 |
| hard no's closed | at least 55% | at least 17 of 30 answers | a floor: opus on 92b's brief closed 32 of 58 in 135. Below it, the brief buys nothing |
| agreement | at least 90% | at least 55 of 61 tickets | in 162 opus was the same both runs on 29 of 30, GPT sol 30 of 30 |

- **Why the point share and not the interval:** on 40 built tickets, even 0
  closes gives an upper bound near 9%, and 5 closes gives 5% to 26%. No size we
  can label proves 13%; the bar says "no worse than what we have, on this
  sample".
- **This bar is stricter than 162's number.** 13% was on random built tickets
  only. The locked built half also holds 3 hard-yes tickets, picked because a
  brief closed them. Confidence 70% that 13% is the right line; the doubt is
  those 3. Counting bad closes on random and security tickets only would match
  162 exactly, at the cost of 20 tickets instead of 40.
- **The locked half stays shut until the owner approves.** `STEP=lock` refuses
  while the status is `proposed`, and refuses a second run of the same brief
  hash. I ran it once to check: it refused.

### The smoke run

5 open cases, one of each kind below, the first in the split's order, two runs
each, once per model. `STEP=tune SMOKE=1`.

## What came back

| Case | Kind, right answer | Opus | GPT sol |
|---|---|---|---|
| #8577 | hard-no, close | close: churn, twice | close: churn, twice |
| #6262 | duplicate, close | close: duplicate of #6197, twice | close: duplicate of #6197, twice |
| #6457 | hard-yes, keep | keep, twice | **close: hardening, twice (wrong)** |
| #7043 | built-random, keep | keep, twice | keep, twice |
| #2325 | security, keep | keep, twice | keep, twice |

- **The harness works end to end on both models.** 20 answers, none missing,
  no tool run. Every close named one of the brief's rules, and every `why`
  quoted its evidence.
- **The one wrong answer is the one 162 predicted.** #6457 is a cost a feature
  flag would cause once it is turned on. GPT sol read "nothing is slow yet" as
  hardening; opus read the same text as a real change to behaviour and said the
  fit was borderline, so keep. The hardening rule's "works today" test lets a
  model read a known future cost as no failure. That is a lead for brief v2, on
  one case.
- **#2325 shows the security exception working.** Both models said the
  credential-scanning ticket is a guard with no incident, then kept it because it
  names a security gap. Opus did that in both runs; in 162, on 92b's brief, it
  closed this ticket once.
- **Agreement:** every ticket the same both runs, on both models (5 of 5).
- **Cost:** opus $0.61 for 10 answers (the estimate was $0.64; the cap was $1
  for the smoke, $2 for part 1). A first call cost $0.07 to $0.10, a second $0.01
  to $0.02 when the first had finished. GPT sol on the plan, no price; median
  about 8 s an answer, about 17k tokens.
- **One edit to the saved answers:** the script replaces a long dash in a
  model's `why` with a colon before it saves, so the public file holds none.
  GPT sol wrote some in the smoke.

## What part 1 means

1. **The shape is ready for the program.** Every step has its own file in and
   out, the data has a schema, the scorer is a service with a fake, and a record
   is plain data. Confidence 85%. The doubt: the Sorter answers one case at a
   time; a program that wants to watch a run live may want a stream of records
   instead of the `kept` callback. Cheap to change.
2. **Approve the bar, or change it, before part 2.** The four lines and their
   counts are above. My lean is to keep them as written. Confidence 70%; the
   doubt is the hard-yes tickets inside the bad-close count.
   **Approved as written by the owner on 2026-10-30** (`163-bar.json`). The
   locked half may now run once per brief hash.
3. **Do not read anything into the 5 cases.** They prove the harness, not the
   brief. One GPT sol miss on 2 built tickets says nothing about its rate.

## What part 1 cannot tell us

- **How good brief v1 is.** 5 cases, by design.
- **Whether the labels are right.** Built means merged, not worth building, and
  every "no" is phoenix's own triage's call, made under today's fabrika bar. The
  set measures agreement with what happened, and brief v1's three rules map to
  the reasons that bar gave.
- **Demlik.** Left out; brief v1 is a phoenix brief.
- **Whether the open half is big enough to tune on.** 58 cases, 2 hard-yes and
  5 security among them. Tuning on so few security tickets can fit them by luck.
- **The cost of GPT sol.** The plan gives no price.
- **Another day.** One Codex version, one model id, one SDK version.

## Part 2: tune and lock

Run on 2026-10-30, after the owner approved the bar as written.

**Answer: brief v3 fails the bar on opus, and the failure is the finding.**
Tuned on the open half, it closed 0 of 38 open built tickets and 26 of 28
hard-no answers. On the locked half it closed 9 of 40 built tickets and 1 of 5
security tickets. The two edits fit the 58 cases they were written from. GPT
sol has no locked score, because the lock refuses a second run of one brief
hash whatever the model. Opus cost $17.96 for 344 answers; GPT sol gave 338
answers on the plan.

```ts
// A sketch of the STEP calls part 2 made, in order. Every version and every answer is kept.
tune({brief: "triage-v1", model: "opus" | "sol", half: "open", runs: 2}); // 58 cases
tune({brief: "triage-v2", model: "sol", half: "open", runs: 2});          // opus skipped: the budget
tune({brief: "triage-v3", model: "sol" | "opus", half: "open", runs: 2});
lock({brief: "triage-v3", model: "opus"});  // once: 61 cases x 2
lock({brief: "triage-v3", model: "sol"});   // refused: "triage-v3 (a2c5afb17bfe) already ran on the locked half"
decide();  // triage-v3 on opus: FAIL (badClose 23%, securityClosed 20%)
```

### The open half, per version and model

58 cases, 2 runs each. Bad closes and security count tickets closed at least
once; hard no's count answers; agreement counts tickets with the same verdict
both runs. The bar's lines are in bold where a version misses them.

| Brief, model | Bad closes (of 38) | Security (of 5) | Hard no's closed (of 28) | Agreement (of 58) |
|---|---|---|---|---|
| v1, opus | 3 (8%) | 0 | **15 (54%)** | 56 (97%) |
| v1, GPT sol | **5 (13.2%)** | 0 | **8 (29%)** | 57 (98%) |
| v2, GPT sol | 3 (8%) | 0 | 22 (79%) | 55 (95%) |
| v3, GPT sol | 1 (3%) | 0 | 23 (82%) | 56 (97%) |
| v3, opus | 0 (0%) | 0 | 26 (93%) | 58 (100%) |

- **v1 missed the hard-no floor on both models.** Opus kept 7 hard no's at
  least once, GPT sol 10 (and 2 easy no's). Most of them name a fault the filer found by reading
  the code, and say it is narrow, low harm or unconfirmed (#7344, #8259,
  #8327, #8501). v1's hardening rule says to keep "something broken today ...
  even if no user has hit it yet", and both models did. GPT sol also kept two
  agent-filed removals of unused code (#10144, #10214): v1's churn rule covers
  words and records only.
- **v1's wrong closes:** #2561 (a rate limit from a security audit), #2713 (a
  type-only slice of a wider ticket), #8174 (a numbered story of an epic), and
  on GPT sol also #6457 (a cost that lands when a flag turns on, as in part 1)
  and #6003 (closed once as a duplicate).
- **v2 changes the hardening rule only**, each line from those cases:
  - a fault found only by reading the code, or one the ticket calls narrow,
    low harm, non-blocking, unconfirmed or one that may never fire, has not
    happened (#7344, #8259, #8327, #8501);
  - keep when the ticket shows something going wrong in a real run, named or
    with the steps (the old "broken today" line, made stricter);
  - keep a cost that lands for sure once a planned change ships (#6457);
  - keep a planned part of larger work: an epic's child, a numbered story, one
    slice of a wider ticket (#2713, #8174);
  - the security line also covers "nothing that bounds how much one user may
    do" (#2561).
- **v2 on GPT sol** closed far more hard no's (8 to 22) and fewer built
  tickets (5 to 3), but closed two new built tickets as hardening: #8992 (a
  fence a merged change took away) and #9196 (a false PASS a real gate run
  only just did not post). It still kept #10144 and #10214.
- **v3 adds three lines, from v2's misses:** keep a near miss in a real run
  (#9196); keep a guard that a landed change took away (#8992); and churn also
  covers an agent removing code, an export or an option nothing uses (#10144,
  #10214).
- **v2 never ran on opus.** At about $6 an open-half run, v1, v2 and v3 on
  opus plus the lock would have passed $20. v2 and v3 went to GPT sol first,
  for free, and only the better one went to opus.
- **Every version is kept:** `163-briefs/triage-v1.md` (2ccebff3e7c1),
  `triage-v2.md` (9efb4899ddae), `triage-v3.md` (a2c5afb17bfe), and every
  answer in `results/163-triage-brief-eval.json`.

### Why v3 was the final brief

- **It was best on every line, on both models.** Against v1: hard no's 15 to
  26 on opus and 8 to 23 on GPT sol, bad closes 3 to 0 and 5 to 1, agreement
  the same or better.
- **The doubt, named before the lock:** v2 and v3 were written from the open
  half's misses and scored on the same cases, so their open numbers are an
  upper bound. Five new lines on 58 cases can fit those cases. The lock was
  the test of that doubt. v1 was the other choice: untuned, but under the
  hard-no floor on both models, so it would have failed a bar line for sure.

### The locked half: v3 on opus, against the bar

61 cases, 2 runs each, run once. `STEP=decide`: **FAIL.**

| Line | Bar | v3 on opus | Point share, Wilson 95% | Verdict |
|---|---|---|---|---|
| bad closes | at most 13% (5 of 40) | 9 of 40 built tickets | 23%, 12% to 38% | fail |
| security closed | 0% (0 of 5) | 1 of 5 | 20%, 4% to 62% | fail |
| hard no's closed | at least 55% (17 of 30) | 23 of 30 answers | 77%, 59% to 88% | pass |
| agreement | at least 90% (55 of 61) | 60 of 61 tickets | 98%, 91% to 100% | pass |

- **8 of the 9 wrong closes are hardening, and every one leans on the line v2
  added.** The model quotes "found by reading the code", "Uncertain", "may be no bug at
  all", "No live hole today", "latent rather than live", and closes. Phoenix
  built these tickets: 2 of 17 built, 2 of 3 hard-yes, 3 of 15 random built,
  and the security ticket, #3341 (CodeQL alerts, "not a production user-data
  exposure"). The ninth, #5416, was closed as a duplicate of an earlier
  ticket with the same fault in its title.
- **So the open half's code-reading findings were mostly closed by phoenix,
  and the locked half's were mostly built.** Nothing in the text separates
  the two, which part 1's "needs the code" label already hinted. The edits
  that won opus 11 more hard-no answers on the open half cost 8 built tickets
  here.
- **The locked misses on the other side:** 4 hard no's kept at least once
  (#7216, a wrong comment, kept under churn's "wrong in substance"; #7986, a
  guard a change removed, kept under v3's new line; #8826 and #8246), and one
  duplicate kept because it is a numbered story (#2103).
- **No tuning after this.** These numbers were read only after both lock
  steps had run.

### GPT sol's lock was refused

`STEP=lock MODEL=sol` stopped at once with "triage-v3 (a2c5afb17bfe) already
ran on the locked half: it is scored once". The guard checks the brief and
its hash, not the model, so the first model's lock shuts the half for the
second. The bar is per model, so this is a harness gap, not a rule. It was not
worked around (field note 2026-10-30-03). Matching the model too is one more
condition in the guard; that change to the exam's lock is the owner's call.
It does not change the decision: a brief that fails on one model is not taken.

### Two harness fixes on the way

- **GPT sol failed on every call at first** (field note 2026-10-30-01). Since v1
  slice 2, an agent turn must name its system prompt, and
  `lib/triage-codex.ts` did not; experiments are outside the typecheck, so
  nothing caught it. All 106 calls failed in 0 s with no spend. `codexTurn` now
  passes `{_tag: "append", text: ""}`: Codex's own instructions and nothing
  added, as 162 and part 1 ran. The 106 error records were taken out of the
  results file, because a held record, even a failed one, stops a rerun from
  asking again.
- **Names in the saved answers:** five `why`s quoted a person's name from
  ticket text (a test fixture and a database name). They are masked as
  `[name]` in the results file.

### What it cost

| Run | Answers | Opus dollars | Input tokens (cached) | Output tokens |
|---|---|---|---|---|
| v1, opus, open (53 new cases) | 106 | $5.14 | 1,141,029 (643,873) | 46,368 |
| v1, GPT sol, open | 106 | plan | 1,759,098 (360,192) | 19,297 |
| v2, GPT sol, open | 116 | plan | 1,943,095 (626,048) | 21,912 |
| v3, GPT sol, open | 116 | plan | 1,951,673 (883,328) | 20,501 |
| v3, opus, open | 116 | $6.29 | 1,295,000 (653,374) | 45,397 |
| v3, opus, locked | 122 | $6.53 | 1,450,458 (817,834) | 58,822 |
| all of part 2 | 682 | $17.96 | 9,540,353 | 212,297 |

- **The estimate was high by about 20%.** DRY=1 said $6.73 for v1's open run
  ($5.14 real) and $7.92 for the lock ($6.53 real). The whole plan as first
  estimated, three versions on opus and the lock, was about $29; running v2
  on GPT sol only kept it under $20.
- **Median time an answer:** opus about 4 s, GPT sol about 10 s.
- `field/runs.jsonl` has one row per answer (682), with `tokens` and `billed`
  both the call's input plus output: one call, no tools, so the two measures
  are the same.

### Who did what

- **This repo's harness:** the set, the split, the bar check, the scorer, the
  lock and the decide step, unchanged from part 1 but for the Codex fix. Briefs
  v2 and v3 were written in this run, from the open half's misses only. The
  locked half's cases, labels and answers were not opened until both lock
  steps had run.
- **Opus:** the Claude Agent SDK on its own login, `claude-opus-5-5`, no tools,
  the brief as its system prompt, `TYPESAFE_API_KEY` unset.
- **GPT sol:** `gpt-6.1-sol`, effort medium, through this repo's Codex adapter
  (codex-cli 0.165.0) on the ChatGPT plan, the brief before the case, no
  OpenAI key.
- **The labels are today's fabrika's:** phoenix's own triage closed the no's,
  its builders built the rest. Nothing was written to GitHub but this pull
  request; the tracker ticket got a note at the start and one at the end.

### What part 2 means

1. **Do not take v3.** It fails two lines, and the worse one is the line the
   bar calls the one that matters most. Confidence 90%: 9 of 40 is well past
   5, and the low end of its interval, 12%, is near the line itself.
2. **v1 is not a pass either.** On the open half it was under the hard-no
   floor on both models. It was never scored on the locked half. The guard
   would still let v1's hash run there once, but the choice to run it now is
   made with v3's locked answers in view, so that is the owner's call. Any v4
   written from here is not clean: the locked half's cases have been read.
3. **The next brief needs a bigger or fresher set, not a third edit.** The
   lesson is the classic one: tuning on 58 cases with 5 new lines fit those
   cases. A next try should hold back part of the open half as its own check
   before the lock, or add newly closed phoenix tickets as a fresh locked set.
   Confidence 75%; the doubt is whether any text-only brief can tell the
   code-reading findings phoenix closed from the ones it built.
4. **Even a pass would mean less than it sounds.** On 40 to 61 tickets a pass
   means "no worse than today on this sample", not "safe": 0 of 40 still
   leaves an upper bound near 9%. When triage goes real (#53), it starts with
   a person confirming every close.

### What part 2 cannot tell us

- **How GPT sol does on the locked half.** The lock refused it.
- **How v2 does on opus.** It was skipped to stay in budget; v3 holds all of
  v2's lines.
- **Whether v1 would pass.** Its open numbers say no on the hard-no floor; the
  locked half is spent for clean tuning now.
- **Whether the labels draw a line text can see.** The open and locked halves
  disagree on code-reading findings. Either phoenix's triage was not
  consistent there, or the line needs the code.
- **Another day.** One run of each, one model id each, one Codex version.

## Part 3: triage reads the code

**Answer: yes, with the code in reach the brief clears every line of the bar on
GPT sol, but only as a tuned score. v5 on all 119 cases, two runs: 6 of 78
built tickets closed (8%), 0 of 10 security, 53 of 58 hard no's closed (91%),
118 of 119 the same both runs. The old locked half is spent: v4 and v5 were
written from misses on all 119. A fresh labelled set (another agent builds it)
is the real test. The exam step is built and tested on a fake set, and it
waits for the owner to approve its bar.**

```ts
// Part 3's shape: the same scorer, a code copy per case, and a one-shot exam.
const brief = briefOf(read("163-briefs/triage-v5.md"));    // front matter "code: read"
const at    = mainAt(ticket.createdAt);                     // last first-parent main commit before the ticket
const tree  = yield* trees.get(at);                         // git archive, untarred, chmod a-w, in tmpdir
const said  = yield* sorter.sort({brief, model, ticket, tree}); // opus: Read, Grep, Glob; sol: Codex, read-only
// STEP=exam FRESH=<set>: examGate(book, examBar, brief, model, setHashOf(set))
//   refuses an unapproved bar, a second shot for one brief hash and model, or a different set
```

### What changed from part 2

- **Triage may read the code.** Part 2's rule "a fault found only by reading
  the code has not happened" is gone. Each case gets phoenix as it was on
  main when the ticket was filed, the way experiment 136 did. Opus gets Read,
  Grep and Glob in that folder only (the sandbox hook from
  `@kampus/fabrika/agents/sandbox`, read-only, at most 30 turns and $0.60).
  GPT sol runs through Codex with the folder read-only and a 600 s limit.
- **Each copy is cleaned before the model sees it.** Links, phoenix's own
  triage skill and triager agent, and its top `AGENTS.md` and `CLAUDE.md` are
  removed, so the brief under test is the only triage rule in reach. The
  copies live in the system temp folder: Codex reads `AGENTS.md` from parent
  folders, and a copy inside this repo would have handed it this repo's rules.
- **A probe checked that the brief arrives.** One GPT sol turn quoted the
  sentence after "Keep is the safe answer." from the brief, saw the rules,
  read a file, and failed to write (`Operation not permitted`).
- **Tuning used all 119 cases.** The owner's call, made after part 2's lock
  read the locked half anyway. Each half is still scored with its own label.

### The rounds

| Round | Brief | Model | Bad closes (built) | Security closed | Hard no's closed | Agreement |
|---|---|---|---|---|---|---|
| smoke | v4 | opus | 0 of 3 | 0 of 1 | 1 of 1 | (1 run) |
| 1 | v4 | GPT sol | 4 of 78 (5%) | 0 of 10 | 30 of 58 (52%) FAIL | 113 of 119 (95%) |
| 2 | v5 | GPT sol | 6 of 78 (8%, 95% 4% to 16%) | 0 of 10 | 53 of 58 (91%) | 118 of 119 (99%) |
| sample | v5 | opus | 1 of 6 | none in sample | 5 of 6 | (1 run) |

Bar: bad closes at most 13%, security 0, hard no's at least 55%, agreement at
least 90%. Two of the three allowed rounds were used.

- **v4** (674 words) has three steps. First trace the claim to a live caller
  and label it confirmed, not there, unreached or no code, with file and
  line. Then test the close rules. Then answer, with a why that gives the
  trace. "When the trace is unclear, keep." Hardening closes only when the
  trace is not there or unreached and no run went wrong. Churn as in v3, plus
  "for a removal, a search finds no use".
- **v4's misses** were small faults the code confirmed and phoenix closed
  anyway: a missing test for working code, a docblock, a message's wording, a
  path that fires only after another failure. v4 kept them all, so it missed
  the hard-no floor.
- **v5** (801 words) adds a harm test. A confirmed fault still closes as
  hardening when the harm is small: a missing or weak test, a fault behind
  another failure, wording, a log line, a trace's parent, two places that each
  work but differently. It keeps when the harm is serious: data lost,
  duplicated or wrong; a feature failing on its normal path; a run or lane
  stuck; a wrong verdict passed on. Churn now covers wrong docs, docblocks,
  comments, decision records and agent instructions, kept only when a person
  filed it or a step-by-step guide's step fails.
- **v5's wrong closes:** 3047, 6314, 7750 (a hard yes), 7894 and 8672 as
  hardening, 5416 as a duplicate, each in both runs. 7894 was closed as
  "unreached" and 6314 as "not there", so the trace itself was wrong there;
  3047 was a confirmed test gap that phoenix built. Of v3's 9 wrong locked
  closes in part 2, v5 still closes 5 (5416, 6314, 7750, 7894, 8672); v4
  closed 2.
- **v5's wrong keeps:** 6818 (a duplicate), 8826 and 10138 (hard no's), both
  runs.
- **Opus on v5** ran a seeded sample of 20 cases (seed 1633, 10 keep and 10
  close), one run. It stopped after 16 answers at its $5 run limit: 14 right,
  wrong on 8826 (kept a hard no after 22 reads) and 5416 (the same duplicate
  close). Median 9 reads and 16 s an answer, mean $0.21.
- **GPT sol's cost:** median 20 s and 3 reads an answer; 21.9M input tokens
  (16.9M cached) and 126k output for round 2, on the ChatGPT plan, no dollars.

### The exam step

`STEP=exam FRESH=<path> MODEL=<opus|sol> BRIEF=triage-v5` scores one brief on
a fresh labelled set against `163-exam-bar.json`. The same four lines as
`163-bar.json`, status `proposed`: it refuses to run until the owner approves
it.

- **One shot per brief hash and model.** The exam book
  (`results/163-exam.json`) records each start. A finished pair refuses again.
  A stopped exam resumes only on the same set (its hash); calls that got no
  answer are retried, and the verdict is printed only when every case has its
  runs.
- **Fresh tickets are fetched** read-only (text, issue list, the main commit
  at their filing). `DRY=1` prints the opus estimate and stops.
- **The opus cap counts all of part 3**, tuning included: `MAX_USD`, default
  $25. It stops before a call that could cross it.
- **Tested on a fake set only:** `STEP=examtest`, 14 checks on a fake Sorter
  and a 3-case fake set (unapproved bar refused, done refused, other set
  refused, resume, retry, verdict). All 14 pass. The real fresh set was not
  opened, looked for or built in this run.

**Estimate for about 60 cases x 2 runs:**

| Model | Per answer | 120 answers | Room left |
|---|---|---|---|
| opus | about $0.20 (mean of 21 read-code calls) | about $23.50 | $20.88 of $25 |
| GPT sol | 0 dollars, about 20 s | about 40 min at 2 at once | ChatGPT plan weekly limit |

Opus 60 x 2 does not fit what is left. One run on opus (about $12), or a
raised cap, would.

### Who did what

- **This repo's harness:** the scorer, the code copies, the sandbox for both
  models, briefs v4 and v5, and the exam step. Written in this run.
- **Opus:** the Claude Agent SDK on its own login, `claude-opus-5-5`, Read,
  Grep and Glob in a read-only copy, the brief as its system prompt.
- **GPT sol:** `gpt-6.1-sol`, effort medium, through this repo's Codex adapter
  (codex-cli 0.165.0) on the ChatGPT plan, the folder read-only, the brief
  before the case, no OpenAI key.
- **The labels are today's fabrika's**, as in parts 1 and 2. Nothing was
  written to phoenix or to GitHub but this pull request, its adapter fix and
  tracker notes.

### Odd things found

- **Codex's `:workspace` profile ignores a folder marked "read".** The first
  probe ran `chmod u+w . ; touch probe.txt` in a folder our config called
  read-only, and it worked. The fix: a read turn extends `:read-only`
  instead. It is in the shared adapter (`codexConfig`'s new `access`), with
  its own test, in its own pull request.
- **Codex looks for `AGENTS.md` in every parent folder.** A copy under the
  home folder failed with `Operation not permitted` on one; a copy in this
  repo would have read this repo's rules.
- **Phoenix was not consistent on small faults the code confirms.** Some
  test gaps and wording fixes were closed, others built. v5's harm test is a
  guess at the line; the 6 wrong closes sit right on it.

### What part 3 means

1. **Take v5 to the exam, on GPT sol first.** It is the only version that
   cleared all four lines anywhere, and the exam costs nothing on the plan.
   Confidence 65% that it passes there: the numbers are tuned, and 6 of 78 is
   already half the bad-close line.
2. **Opus needs a budget call before its exam.** One run fits; two do not.
   Agreement on opus has not been measured, so one run leaves that line open.
3. **Reading the code is worth its cost.** On sol it moved hard no's closed
   from v3's text-only open-half 23 of 28 to 53 of 58 on all cases, at about
   20 s an answer. Confidence 70%; part 2's v3 never ran on all 119, so the
   comparison is across sets.

### What part 3 cannot tell us

- **How v5 does on cases it was not tuned on.** All 119 were seen; these
  numbers are an upper bound. The exam answers this.
- **Opus on all cases, and opus agreement.** Only 21 opus calls ran.
- **Whether the labels are consistent.** The wrong closes sit where phoenix
  itself went both ways.
- **Another day.** One run of each, one model id each, one Codex version.

## Run it

```
STEP=set node experiments/163-triage-brief-eval.ts        # step 1: 163-set.json from the truth files
STEP=split node experiments/163-triage-brief-eval.ts      # step 1: 163-split.json, seed 163; refuses if it exists
STEP=fetch node experiments/163-triage-brief-eval.ts      # first title and body of every case, through gh, read-only, into runs/exp-163-cache
STEP=bar node experiments/163-triage-brief-eval.ts        # step 2: the bar, as counts on the locked half
STEP=brief node experiments/163-triage-brief-eval.ts      # step 3: BRIEF=triage-v1, its rules, hash and text
STEP=selftest node experiments/163-triage-brief-eval.ts   # the scorer on a fake Sorter, $0
STEP=tune MODEL=opus SMOKE=1 node experiments/163-triage-brief-eval.ts   # step 4; MODEL=sol; ONLY=, RUNS=2, DRY=1, MAX_USD=2
STEP=tune MODEL=sol BRIEF=triage-v3 RUNS=2 CONCURRENCY=2 node experiments/163-triage-brief-eval.ts   # part 2: the whole open half
STEP=lock MODEL=opus node experiments/163-triage-brief-eval.ts           # step 5: refuses until 163-bar.json is approved, and a second run of one brief hash
STEP=decide node experiments/163-triage-brief-eval.ts     # step 6: the locked numbers against the bar
node experiments/163-triage-brief-eval.ts                 # the report; WHY=1 adds every answer's why
STEP=field node experiments/163-triage-brief-eval.ts      # field/runs.jsonl rows, every record (part 2 added only its own date's rows)
STEP=trees node experiments/163-triage-brief-eval.ts      # part 3: each case's main commit at filing, from a phoenix clone in runs/exp-163-cache (push off)
STEP=probe BRIEF=triage-v5 node experiments/163-triage-brief-eval.ts     # part 3: one GPT sol turn: the brief arrives, the folder stays read-only
STEP=tune ALL=1 MODEL=sol BRIEF=triage-v5 RUNS=2 node experiments/163-triage-brief-eval.ts   # part 3: all 119 cases with the code; MODEL=opus with DRY=1 first
STEP=examtest node experiments/163-triage-brief-eval.ts   # part 3: the exam step on a 3-case fake set, 14 checks, $0
STEP=exam FRESH=<set.json> MODEL=sol BRIEF=triage-v5 node experiments/163-triage-brief-eval.ts   # refuses until 163-exam-bar.json is approved; once per brief hash and model; DRY=1, MAX_USD=25
STEP=field PART=3 node experiments/163-triage-brief-eval.ts   # part 3's rows only
```

Run each with `TYPESAFE_API_KEY`, `OPENAI_API_KEY` and `CODEX_API_KEY` unset;
the live Sorter refuses to start with any of them set.
