# 163. The triage brief, made the tested way

The question: can we test a triage brief the way a brief-lab program would
(ticket #62), with one labelled set, a locked half, an owner's bar and one
scorer? Part 1 builds every piece and proves the harness on 5 cases. It does
not score the brief. [Part 2](#part-2-tune-and-lock) tunes the brief on the
open half and scores it once on the locked half. [Part 3](#part-3-triage-reads-the-code)
lets triage read the code and gets a brief ready for a fresh exam.
[Part 4](#part-4-triage-in-two-close-on-a-fact-ask-on-worth) splits triage in
two: close on a fact, ask the owner on worth.
[Part 5](#part-5-fewer-asks-without-looser-closes) tries three ways to ask
less, offline, on part 4's asks.

**Part 5's answer: none of the three gets near 50 asks a week without breaking
another line.** A code rule that sends every security ticket to the owner
fixes opus's one security close (#3361) for one more ask. Bundling asks by
area looks like 35% to 45% fewer decisions, but only 2 of 10 hand-checked
bundles were one decision, so it saves about 5% to 10%. Following earlier
rulings answers 0 of the 68 tickets it may answer (haiku and sonnet both).
Keeping every worth ask cuts asks to about 48 to 87 a week, but builds 42% to
48% of the tickets that should close (bar: 10%). It pays only if 30 s of the
owner is worth more than about $1.60. Matcher spend $4.22 at list price.

**Part 4's answer: wrong closes drop, and asks take their place.** Brief v6
closes only on a fact it shows and asks the owner on worth and on every
security ticket, with the pull requests open at filing in reach. On the 63
exam tickets GPT sol closed 1 of 32 built tickets (v5: 4) and opus 2 of 27
(v5: 10 of 32). But 48% to 66% of answers are asks: about 105 to 190 a week at
phoenix's filing rate. 12 of 15 sampled asks could be answered from the trace
alone. Neither set is blind any more; v6 ran once, as written. Opus $11.49
(stopped by the $12 cap at 51 of 63); GPT sol $25.37 at list price for 364
answers.

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
brief. Opus cost $17.96; GPT sol $8.38 at list price.

**Answer: the pieces are built and the harness works on both models. 119
labelled phoenix cases, split 58 open and 61 locked. Brief v1 is 388 words with
three close rules. On 5 open cases, opus got all 10 answers right; GPT sol got 8,
closing one built ticket as hardening in both runs. Opus cost $0.61, GPT sol
$0.34 at list price. The bar below waits for the owner.**

**On GPT sol's dollars:** it runs on the ChatGPT plan, which bills no call.
Every GPT sol dollar figure in this write-up is what the same tokens cost at
OpenAI's standard API price for `gpt-6.1-sol` (short context: $2.00 input,
$0.10 cached input, $10.00 output per 1M tokens; read 2026-10-30 from
https://developers.openai.com/api/docs/pricing; `lib/list-price.ts`). The
figures were added on 2026-10-30, after parts 1 to 4 ran. Their
`field/runs.jsonl` rows keep `costUsd: null` and carry the dollars in a new
`listUsd` field. Opus's dollars are the Agent SDK's own, at Anthropic's list
price.

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
  to $0.02 when the first had finished. GPT sol $0.34 at list price for 10
  answers (167k input tokens, 9k cached, 1.8k output); median about 8 s an
  answer, about 17k tokens.
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
- **What the plan really charges for GPT sol.** Its dollars here are list
  price for the same tokens; the plan bills no call.
- **Another day.** One Codex version, one model id, one SDK version.

## Part 2: tune and lock

Run on 2026-10-30, after the owner approved the bar as written.

**Answer: brief v3 fails the bar on opus, and the failure is the finding.**
Tuned on the open half, it closed 0 of 38 open built tickets and 26 of 28
hard-no answers. On the locked half it closed 9 of 40 built tickets and 1 of 5
security tickets. The two edits fit the 58 cases they were written from. GPT
sol has no locked score, because the lock refuses a second run of one brief
hash whatever the model. Opus cost $17.96 for 344 answers; GPT sol gave 338
answers for $8.38 at list price.

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
  on the plan (about $2.50 each at list price), and only the better one went
  to opus.
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

| Run | Answers | Dollars | Input tokens (cached) | Output tokens |
|---|---|---|---|---|
| v1, opus, open (53 new cases) | 106 | $5.14 | 1,141,029 (643,873) | 46,368 |
| v1, GPT sol, open | 106 | $3.03 list | 1,759,098 (360,192) | 19,297 |
| v2, GPT sol, open | 116 | $2.92 list | 1,943,095 (626,048) | 21,912 |
| v3, GPT sol, open | 116 | $2.43 list | 1,951,673 (883,328) | 20,501 |
| v3, opus, open | 116 | $6.29 | 1,295,000 (653,374) | 45,397 |
| v3, opus, locked | 122 | $6.53 | 1,450,458 (817,834) | 58,822 |
| all of part 2 | 682 | $17.96 opus, $8.38 GPT sol | 9,540,353 | 212,297 |

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

**Answer: v5 fails the blind exam on both models. On 63 fresh phoenix tickets
it never saw, two runs each, GPT sol fails 2 of 4 lines (security closed 1 of
10, hard no's closed 20 of 46) and opus fails 2 of 4 (bad closes 10 of 32,
security closed 4 of 10). The two models miss on opposite sides: GPT sol keeps
too much, opus closes code-read safety tickets that phoenix built. The tuned
score below (all four lines clear on GPT sol) did not carry over.**

Before the exam: with the code in reach the brief cleared every line of the bar
on GPT sol, but only as a tuned score. v5 on all 119 cases, two runs: 6 of 78
built tickets closed (8%), 0 of 10 security, 53 of 58 hard no's closed (91%),
118 of 119 the same both runs. The old locked half is spent: v4 and v5 were
written from misses on all 119. The owner approved the exam bar on 2026-10-30.

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
  (16.9M cached) and 126k output for round 2, $12.89 at list price ($0.054 an
  answer). Round 1 (v4): 21.4M input (16.2M cached) and 124k output, $13.35.

### The exam step

`STEP=exam FRESH=<path> MODEL=<opus|sol> BRIEF=triage-v5` scores one brief on
a fresh labelled set against `163-exam-bar.json`. It refuses to run on a bar
that is not approved.

The owner approved the exam bar on 2026-10-30, per model, on the point share
over 2 runs, with four shifts from `163-bar.json`: security closed now counts
only the 10 `security` tickets that got built (closing a `security-closed`
ticket is right); hard no's closed now means every close that is not a
duplicate (no, safety-closed, security-closed: at least 26 of 46 answers); bad
closes keep 13% and 163-bar.json's count (keep tickets closed in at least one
run, so at most 4 of 32), a harder line since 19 of the 32 keeps are safety
tickets; and a new info line, never pass or fail, gives bad closes on the 12
built-random tickets alone. Agreement stays at 90%, at least 57 of 63.

- **One shot per brief hash and model.** The exam book
  (`results/163-exam.json`) records each start. A finished pair refuses again.
  A stopped exam resumes only on the same set (its hash); calls that got no
  answer are retried, and the verdict is printed only when every case has its
  runs.
- **Fresh tickets are fetched** read-only (text, issue list, the main commit
  at their filing). `DRY=1` prints the opus estimate and stops.
- **The opus cap counts all of part 3**, tuning included: `MAX_USD`, default
  $25. It stops before a call that could cross it.
- **Tested on a fake set only:** `STEP=examtest`, 24 checks on a fake Sorter
  and a fake set in the real set's shape, one case of each of its 8 kinds
  (unapproved bar refused, done refused, other set refused, resume, retry, a
  case whose answer is not its kind's refused, each bar line's count, a
  security-closed close counted right, the duplicate kept out of hard no's,
  the info line printed without pass or fail, `STEP=decide FRESH=<set>`). All
  24 pass. The real fresh set was not opened, looked for or built in this run.

**Estimate for about 60 cases x 2 runs:**

| Model | Per answer | 120 answers | Room left |
|---|---|---|---|
| opus | about $0.20 (mean of 21 read-code calls) | about $23.50 | $20.88 of $25 |
| GPT sol | about $0.054 at list price (round 2's mean), about 20 s | about $6.50, about 40 min at 2 at once | ChatGPT plan weekly limit |

Opus 60 x 2 did not fit what was left. The owner raised part 3's opus cap to
$30 before the exam.

### The exam set (`163-exam-set.json`)

Another agent built it, outside the repo, so the brief's tuner never saw it.
It came into the repo only after both exams had run. 63 kamp-us/phoenix
tickets, none in `163-set.json`, `163-split.json`, 162's random 30 or 162's
66-ticket security read. Every label comes from what happened on the ticket,
not from a model. It holds URLs only, no ticket text and no names. Building it
cost $0 and wrote nothing to phoenix.

```ts
// One case, the fields 163-set.json has plus these:
{
	kind: "safety-built", right: "keep",
	safety: true,      // the first body: a fault found by reading code, nobody hit it yet
	security: false,   // 162's rule: who may see or do what, a secret, an injection
	fact: "https://github.com/kamp-us/phoenix/pull/...", // the merged PR, or the closing comment
	who: null,         // who closed it: "owner" | "filer" | null on keeps
	triageKept: false, // close cases: phoenix triage had typed and kept it first
	sha: "...",        // phoenix main at filing (commits API, sha=main, until=filed)
}
```

| Kind | Right | Count | What it is |
|---|---|---|---|
| built-random | keep | 12 | seeded draw (seed 1633) from 162's built pool |
| safety-built | keep | 9 | a code-read fault nobody hit, and a merged PR fixed it |
| security | keep | 10 | a security gap (162's rule), built |
| hard-yes | keep | 1 | phoenix triage closed it, a person reopened it, then it was built |
| safety-closed | close | 9 | a code-read fault nobody hit, and the owner ruled it not worth building |
| security-closed | close | 5 | a security gap the owner ruled acceptable and closed |
| duplicate | close | 8 | closed as a duplicate (5 by the owner, 3 by the filing session) |
| no | close | 9 | the owner ruled it not worth doing (churn, nits, premise false) |

33 tickets carry the safety flag (19 built, 14 closed); all 15 security
tickets are code-read findings too. Filed 2026-07-03 to 2026-09-27.

**How the tickets were picked:**

- **Keep: a merged PR closed it.** On every keep, `stateReason` is
  `COMPLETED` and the closing PR merged. All keeps also sit in 162's built
  pool.
- **Close: a person closed it unbuilt.** On every close, `NOT_PLANNED` and no
  merged PR. The fact is the owner's ruling, or the filer's own duplicate note.
- **Left out, with the reason:**
  - every triage-agent close on its own (a model's opinion); the one exception
    is a triage close the owner then ruled "stays closed";
  - folds into another ticket (the work is real and lives elsewhere);
  - bulk closes (a backlog purge, a sweep batch, an audit pass), since a batch
    rule weeks later says little about the ticket as filed;
  - moot closes (the product or tool was removed later);
  - decision tickets ruled "no", epics, maps, grilling sessions, planned epic
    children, crew ledgers and main alarms.
- **Safety was read by hand from the first body**, the oldest
  `userContentEdits` entry, since phoenix triage rewrites bodies (389 of 430
  built candidates had been edited). A ticket that reports a fault seen in a
  real run is not safety.

**What came up short:**

- **hard-yes: 1.** The old kind means "92b's brief closed it once"; there are no
  92b answers on new tickets. The real-world version is "triage closed it, a
  person reopened it, it was built". One ticket fits in all of phoenix.
- **No easy-no or hard-no kinds.** Both were defined by 92b's answers. They
  became one kind, `no`. 5 closes had been typed and kept by phoenix triage
  before the owner closed them, the nearest real "hard no", too few for a line.
- **Owner-closed safety: 14 in all.** The owner rarely rules on single
  code-read tickets; most such kills in phoenix are triage-agent closes. So the
  safety split is 19 built against 14 closed.
- **3 of the 8 duplicates are twin filings** closed by the session that filed
  them: easy cases.

**How the bar maps onto this set** (`163-exam-bar.json`, the owner's rulings
of 2026-10-30):

| Line | Bar | On this set |
|---|---|---|
| badClose | at most 13% | at most 4 of 32 keeps closed in at least one run |
| securityClosed | 0 | of the 10 built security tickets only; closing a security-closed ticket is right |
| hardNoClosed | at least 55% | every non-duplicate close (23 tickets): at least 26 of 46 answers |
| agreement | at least 90% | at least 57 of 63 tickets the same in both runs |
| info: badCloseBuiltRandom | none | bad closes on the 12 built-random tickets, never pass or fail |

- **badClose is harder here than in `163-bar.json`.** 19 of the 32 keeps are
  code-read safety tickets, the class part 2 failed on.
- **securityClosed changed meaning.** The owner closed 5 security gaps on
  purpose. That also shows the line's premise ("a closed security gap is the
  worst wrong close") does not match how the owner rules on trust-model gaps.
- **hardNoClosed changed meaning.** The doubt the owner kept: these closes may
  be easier than the old hard no's.
- **The no side changed source.** Every old close was a triage agent's; every
  new one is a person's. A brief tuned to agree with phoenix triage may score
  worse here for honest reasons.

**Odd things about the set, known before the exam ran:**

- 14 of the 31 closes landed on two days, one owner review pass. If one brief
  rule fits that pass, it can swing several cases at once.
- 6 owner closes were triage recommendations (kill or duplicate) held open for
  the owner. The triage comment is not in the first body, which is all the
  brief sees.
- One security-closed ticket was closed by an agent applying the owner's ruling
  on another ticket. It is the weakest close label in the set.
- `sha` is main at filing. Phoenix squash-merges, so that is close to the tree
  as it stood, but not to work still on an open branch (see the results).
- `triageKept` reads today's labels; the not-planned search caps at 1000, so a
  few tickets in one date window may be unread.

### The exam result

Brief v5 (`ecd004c38b58`), set `6c6bd8496ebf`, two runs a ticket, one shot per
model, run on 2026-10-30. No call failed and no resume was needed.

**GPT sol: FAIL.**

| Line | Count | 95% Wilson | Bar | |
|---|---|---|---|---|
| badClose | 4 of 32 (12.5%) | 5% to 28% | at most 13% | pass, by half a ticket |
| securityClosed | 1 of 10 | 2% to 40% | 0 | FAIL |
| hardNoClosed | 20 of 46 (43%) | 30% to 58% | at least 55% | FAIL |
| agreement | 61 of 63 (97%) | 89% to 99% | at least 90% | pass |
| info: badCloseBuiltRandom | 1 of 12 | 1% to 35% | none | |

**Opus: FAIL.**

| Line | Count | 95% Wilson | Bar | |
|---|---|---|---|---|
| badClose | 10 of 32 (31%) | 18% to 49% | at most 13% | FAIL |
| securityClosed | 4 of 10 | 17% to 69% | 0 | FAIL |
| hardNoClosed | 29 of 46 (63%) | 49% to 75% | at least 55% | pass |
| agreement | 60 of 63 (95%) | 87% to 98% | at least 90% | pass |
| info: badCloseBuiltRandom | 1 of 12 | 1% to 35% | none | |

Right answers overall: GPT sol 90 of 126, opus 87 of 126.

**The wrong closes (keeps closed), by ticket.** "1 of 2" means one run closed it.

- GPT sol, 4 tickets, 3 of them safety:
  - [#5643](https://github.com/kamp-us/phoenix/issues/5643), built-random, not safety: churn, both runs (a glossary note rewrite).
  - [#6467](https://github.com/kamp-us/phoenix/issues/6467), security, safety: hardening "not there", 1 of 2.
  - [#9122](https://github.com/kamp-us/phoenix/issues/9122), safety-built, safety: hardening "not there", 1 of 2.
  - [#9623](https://github.com/kamp-us/phoenix/issues/9623), safety-built, safety: hardening, a test that checks less than its name says, both runs.
- Opus, 10 tickets, 9 of them safety:
  - [#1890](https://github.com/kamp-us/phoenix/issues/1890), security: hardening "confirmed, harm small", both runs.
  - [#3361](https://github.com/kamp-us/phoenix/issues/3361), security: hardening "not there" (the file already used a safe random), both runs.
  - [#4208](https://github.com/kamp-us/phoenix/issues/4208), safety-built: hardening "not there", both runs; the code sat on an unmerged PR.
  - [#4313](https://github.com/kamp-us/phoenix/issues/4313), security: hardening "not there", both runs; the cited change was not on main yet.
  - [#4398](https://github.com/kamp-us/phoenix/issues/4398), safety-built: hardening "harm small", 1 of 2.
  - [#5117](https://github.com/kamp-us/phoenix/issues/5117), safety-built: hardening "already guarded", both runs.
  - [#5490](https://github.com/kamp-us/phoenix/issues/5490), safety-built: hardening "harm small, no run went wrong", both runs.
  - [#5643](https://github.com/kamp-us/phoenix/issues/5643), built-random, not safety: churn, both runs (as GPT sol).
  - [#6467](https://github.com/kamp-us/phoenix/issues/6467), security: hardening "not there", both runs; the code named did not exist at that commit.
  - [#9623](https://github.com/kamp-us/phoenix/issues/9623), safety-built: hardening "harm small", both runs (as GPT sol).

**Of the wrong closes, safety tickets are most:** GPT sol 3 of 4, opus 9 of
10. Both models closed one security ticket the same way (#6467). The one wrong
close outside the safety tickets is the same on both: #5643 as churn.

**The wrong keeps (closes kept), by ticket.** All both runs unless marked.

- GPT sol, 15 tickets:
  - duplicate: #3367, #6476.
  - no: #3782, #4206, #6529, #6542, #9710.
  - safety-closed: #6330, #6556, #7245.
  - security-closed: #6557, #8479, #9636, #9983, #10065 (all 5).
- Opus, 11 tickets:
  - duplicate: #6476; #3367 1 of 2.
  - no: #4206, #6529, #6542, #9710.
  - safety-closed: #10066 1 of 2.
  - security-closed: #8479, #9636, #9983, #10065.

**What the answers show:**

- **The two models fail on opposite sides.** GPT sol keeps nearly every
  confirmed fault, so it is safe on keeps and misses the no's. Opus applies
  v5's harm test, so it closes the no's and also 9 safety tickets phoenix
  built.
- **v5 never closes a security gap on GPT sol.** Its rule says hardening does
  not cover "holes in who may act", so all 5 security-closed tickets stay open.
  That is the rule working as written; the owner rules otherwise.
- **The code copy misses work in flight.** 2 of opus's 10 wrong closes say
  "not there" because the code the ticket names was on an open pull request,
  not on main at filing (#4208 and #4313 say so outright). A third (#6467, on
  both models) names functions absent at that commit, likely the same cause.
  The gap shows on closes too: on #9983 and #10065 both models note the files
  are absent and keep anyway. A ticket filed against an open epic's branch gets
  the wrong tree.
- **Phoenix triage's kept closes are hard for both.** Of the 5 closes phoenix
  triage had kept before the owner closed them, GPT sol kept 4 and opus 2.
- **The info line is the same on both: 1 of 12 (#5643).** On random built
  tickets v5 is near 163-bar.json's old slice. The safety tickets are what
  moves opus's bad closes from 1 of 12 to 10 of 32.

**What the exam cost:**

| Model | Answers | Dollars | Input tokens (cached) | Output tokens | Median an answer |
|---|---|---|---|---|---|
| GPT sol | 126 | $6.36 list | 10,826,218 (8,380,800) | 63,214 | 18.5 s, 3 reads |
| opus | 126 | $18.67 | 7,793,159 (6,193,578) | 224,481 | 15.1 s, 7 reads |

- Opus mean $0.15 an answer. DRY=1 said $24.74; real was 25% lower.
- Part 3's opus spend is now $22.79 ($4.12 tuning, $18.67 exam), under the $30 cap.
- Part 3's GPT sol, at list price: $32.60 ($13.35 round 1, $12.89 round 2,
  $6.36 exam), on the plan.
- Each model took about 20 minutes at 2 calls at once.
- `results/163-exam.json` holds every answer. No `why` named a person, so
  nothing needed masking.

### Who did what

- **This repo's harness:** the scorer, the code copies, the sandbox for both
  models, briefs v4 and v5, and the exam step. Written in this run.
- **Opus:** the Claude Agent SDK on its own login, `claude-opus-5-5`, Read,
  Grep and Glob in a read-only copy, the brief as its system prompt.
- **GPT sol:** `gpt-6.1-sol`, effort medium, through this repo's Codex adapter
  (codex-cli 0.165.0) on the ChatGPT plan, the folder read-only, the brief
  before the case, no OpenAI key.
- **The tuning labels are today's fabrika's**, as in parts 1 and 2. **The exam
  labels are not:** each is a merged PR or a person's closing comment, picked
  by another agent outside this repo. That agent read phoenix through `gh`
  only. Nothing was written to phoenix or to GitHub but this pull request, its
  adapter fix and tracker notes.

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

Written before the exam, kept as written, with what the exam said:

1. **Take v5 to the exam, on GPT sol first.** It is the only version that
   cleared all four lines anywhere, and the exam costs nothing on the plan
   (about $6.40 at list price, added later).
   Confidence 65% that it passes there: the numbers are tuned, and 6 of 78 is
   already half the bad-close line. **Wrong: it failed on GPT sol**, on hard
   no's (43%, against 91% tuned) and one security close.
2. **Opus needs a budget call before its exam.** One run fits; two do not.
   Agreement on opus has not been measured, so one run leaves that line open.
   The owner raised the cap to $30; opus agreement is 60 of 63.
3. **Reading the code is worth its cost.** On sol it moved hard no's closed
   from v3's text-only open-half 23 of 28 to 53 of 58 on all cases, at about
   20 s an answer. Confidence 70%; part 2's v3 never ran on all 119, so the
   comparison is across sets. **Not shown by the exam:** on fresh tickets GPT
   sol closed 20 of 46 hard no's. The tuned gain did not carry over.

After the exam:

1. **Do not ship v5 as an auto-closing triage.** It fails on both models, and
   the lines it fails differ by model. Confidence 90%: opus's 10 of 32 has a low
   end of 18%, past the 13% line; GPT sol's 20 of 46 has a high end of 58%,
   just over the 55% floor, so that miss is less sure.
2. **The tuning fit its 119 cases, again.** Part 2's lesson repeats with code
   in reach. The harm test is where it shows: on opus it closes 9 built safety
   tickets as "harm small" or "not there"; on GPT sol it barely fires.
   Confidence 80%; the doubt is that the two sets differ in who closed the
   no's (an agent then, a person now).
3. **Fix the tree before any next brief.** A ticket that names code on an open
   branch gets main at filing, and the model honestly says "not there". 2 or
   3 of opus's 10 wrong closes trace to that. Next step, cheap: give each case
   the tree of the PR or branch the ticket points at, when it points at one.
   Confidence 70% it matters; it explains some wrong closes, not most.
4. **The security line's premise is in doubt.** The owner closed 5 of 15
   security gaps on purpose, and v5's rule keeps every one. Whether triage
   should ever close a security gap is the owner's call, not a brief edit.
5. **When triage goes real (#53), it starts with a person confirming every
   close.** Nothing here changes that.

### What part 3 cannot tell us

- **Whether a different brief would pass.** This was one shot of v5. Any
  change written from these answers is tuned on the exam set too.
- **Whether 63 tickets is enough.** The intervals are wide: GPT sol's bad
  closes, 4 of 32, run from 5% to 28%. A pass or fail near a line (GPT sol's
  hard no's, its badClose at 12.5%) could flip on another sample.
- **Whether the owner's closes are "right" in a deeper sense.** They are what
  happened. Some closes the models kept might have been worth building.
- **Whether the safety tickets can be told apart from text and code at all.**
  Opus closed 9 built ones, GPT sol kept 8 closed ones; neither found the line.
- **Why the two models land on opposite sides.** Same brief, same trees, same
  tickets. It may be how each reads "harm small", or how far each reads.
- **Another day.** One run of each, one model id each, codex-cli 0.165.0.

## Part 4: triage in two (close on a fact, ask on worth)

Run on 2026-10-30, after the owner split triage in two: the model checks facts
in the code and closes only on a clear fact; when a real fault turns on worth,
it asks the owner, with its trace.

**Answer: wrong closes drop a lot, and the price is asks.** With brief v6,
written once and run as written, GPT sol closed 1 of 32 built exam tickets
(v5: 4) and opus 2 of the 27 it answered (v5: 10 of 32). Both models now ask
on #4208 and #4313, and cite the open pull requests that hold the code. But
48% to 66% of all answers are asks. At phoenix's filing rate that is about 105
to 190 asks a week. 12 of 15 sampled asks could be answered from the trace
alone.

```ts
// Part 4's shape: three answers, each with its trace, and the open pull requests in the copy.
type Triage =
  | { answer: "close"; why: "duplicate" | "fixed" | "absent" | "churn"; of: number | null; trace: string }
  | { answer: "keep";  why: "fault" | "feature"; trace: string }
  | { answer: "ask";   why: "worth" | "security" | "unclear"; trace: string; question: string };

const tree = treePool({ ..., extra: (c) => ({ key: `t${c.n}`, files: diffsOpenAt(c) }) });
// one answer from the exam, GPT sol, #4313 (a security ticket phoenix built):
{ answer: "ask", why: "security",
  trace: "comment.react broadcasts toComment(r.comment) unchanged at apps/web/worker/features/pano/mutations.ts:666-667 ... PR #4310 adds owner-scoped sandboxed to that read and shaper without stripping this broadcast",
  question: "Should the owner-scoped flag be stripped from comment.react broadcasts as latent privacy hardening: build or close?" }
```

### Neither set is blind any more

- **The 119** were tuned on in parts 2 and 3.
- **The 63** were seen once, in part 3's exam. Their answers and part 3's
  misses (#4208, #4313, the 5 owner-closed security gaps) shaped what the
  owner asked for in part 4.
- **So no tuning used them.** v6 was written once, from the owner's three
  answers and v5's fact rules, before any v6 answer came back. It ran once on
  each set, as written: a measure, not a tune. Two GPT sol answers on #4208 and
  #4313 were a harness check before the full run; they count as run 1 of those
  two tickets.

### What changed from part 3

- **Brief v6** (`163-briefs/triage-v6.md`, hash `35e71e146b92`, written fresh
  from the writing guide). Four steps: trace the claim to a live caller; check
  the open pull requests; pick the answer (a security ticket is always ask,
  then each close fact, then keep, then ask); write the trace so someone who
  has not read the code can check it.
  - **close** only on a fact: a duplicate (`of` names it), already fixed (file
    and line, or a merged PR), absent (the code the claim names does not exist
    and no open PR adds it), or churn (v5's factual rule).
  - **keep** a confirmed fault on a normal path with clear serious harm, or a
    feature with no fact against it.
  - **ask** on worth (a confirmed small or unseen fault), on every security
    ticket, and when the trace does not settle it. `question` ends in "build or
    close?".
- **The code copy now carries the pull requests open at filing.** Main at
  filing is kept, so a built ticket's own fix never shows. Next to it:
  - every PR whose `createdAt` is before the filing and that was still open
    then (from `gh pr list`, read-only; median 8 a ticket, at most 24);
  - each one at its newest own commit written before the filing (author date,
    because agents rebase and a rebase resets the committer date), its diff
    from the parent of its oldest own commit, so main's later work stays out;
  - the list in the prompt (number, title, files); each diff as a file in the
    copy, under `open-pull-requests-at-filing/`, cut at 3,000 lines.
  - Each case gets its own copy (`treePool`'s new `extra`). 593 PR heads were
    fetched into the clone copy (push off). 379 of 1,716 listings had no own
    commit from before the filing (a dependency bump, a release PR, or one
    rewritten later); those show the title only.
- **The check on #4208 and #4313 holds.** #4208's list has #4204 ("a path-only
  §CP answer can no longer read as not control plane", 11 files); #4313's has
  #4310 ("thread the owner-scoped sandboxed flag onto the Comment wire", 14
  files). Both models cite them in their traces and ask; in part 3 opus closed
  both as "not there".

### The numbers

GPT sol: 2 runs a ticket on both sets. Opus: 1 run on the 63, stopped by the
$12 cap at 51 tickets; the calls ran in a seeded order, so the 51 are a random
draw of the 63. "Tickets" counts a ticket once if any run gave that answer.

| | GPT sol, 63 | GPT sol, 119 | Opus, 51 of 63 |
|---|---|---|---|
| answers | 126 | 238 | 51 |
| wrong closes (built ticket closed) | 1 of 32 tickets, 2 answers | 6 of 78 tickets, 9 answers | 2 of 27 tickets, 2 answers |
| by fact | churn 2 | duplicate 5, absent 4 | fixed 1, churn 1 |
| wrong keeps (closed ticket kept) | 4 of 31 tickets, 7 answers | 0 of 41 | 1 of 24 tickets |
| right closes (answers) | 20 | 45 | 10 |
| asks | 83 (66%) | 114 (48%) | 32 (63%) |
| asks by why | worth 46, security 35, unclear 2 | worth 73, security 38, unclear 3 | worth 20, security 11, unclear 1 |
| asks, really built / closed | 48 / 35 | 77 / 37 | 19 / 13 |
| same answer both runs | 60 of 63 | 113 of 119 | (1 run) |

- **The wrong closes, by ticket:**
  - [#5643](https://github.com/kamp-us/phoenix/issues/5643), both models, churn:
    an agent-filed glossary rewrite phoenix built anyway. Same as part 3. By
    v6's own rule this is a right churn close; the label says otherwise.
  - [#3361](https://github.com/kamp-us/phoenix/issues/3361), opus, fixed: a
    security ticket. The trace is right (the file already used a safe random),
    but v6 says to always ask on security. One break of that rule in 13 opus
    security answers; GPT sol asked on all 50 of its own.
  - The 119 on GPT sol: duplicates #5416 (both runs, as in parts 2 and 3),
    #6003 and #3682 (both runs); absent #6314, #5092 and #8731. On those three
    the code the ticket names was on no PR listed: #6314's names are not in the
    one-PR epic run #6313 either. The work likely sat on a branch with no PR,
    or the ticket's premise was wrong and phoenix built something else.
- **The wrong keeps:** on the 63, GPT sol kept #3367 (a duplicate, as a
  feature, both runs), #6476 (a planning step a decision record asks for, as
  a feature), #6529 and #6542 (each with a real run going wrong, as faults,
  both runs). Opus kept #6476. On the 119, no wrong keep at all.
- **Security, always ask:** GPT sol asked on every security ticket (30 answers
  on the 63, 20 on the 119). Opus asked on 12 of 13 and closed #3361.
- **Asks split nearly evenly on what really happened.** Of GPT sol's 83 asks on
  the 63, phoenix built 48 and closed 35. That is the point of asking: the
  model cannot tell these apart, and phoenix did not decide them the same way
  either.

Against part 3's v5 on the same 63 tickets:

- GPT sol: wrong closes 4 tickets to 1; closed tickets kept 15 to 4; right
  closes 32 answers of 126 to 20 of 126.
- Opus: wrong closes 10 of 32 to 2 of 27; closed tickets kept 11 to 1; right
  closes 42 of 126 answers (33%) to 10 of 51 (20%).
- The rest became asks. v6 gives up some right closes to stop wrong ones.

### The ask load

`STEP=load`: GitHub's search counts 2,468 phoenix issues filed in the 60 days
to 2026-10-30, about 288 a week. In a read of the newest 1,000, 158 (16%) are
epics, decision tickets, spikes, grilling sessions, maps or main alarms, which
triage may skip.

| Run | Ask share | Asks a week at 288 |
|---|---|---|
| GPT sol, 63 | 66% | about 190 |
| GPT sol, 119 | 48% | about 138 |
| Opus, 51 of 63 | 63% | about 181 |
| GPT sol, random built tickets only (24 + 60 answers) | 50% and 47% | about 134 to 144 |
| Opus, random built tickets only | 36% | about 105 |

- **Both sets lean hard.** Half the 63 are code-read safety tickets, a sixth
  security. The random built tickets are the nearest thing to phoenix's real
  mix on the keep side, and they still ask 36% to 50% of the time.
- **So about 100 to 190 asks a week, 15 to 27 a day.** At 30 seconds each,
  that is about 50 to 95 minutes of the owner's week.

### Can the owner answer an ask from its trace?

15 asks, drawn with seed 1634 from all 229 asks across both models and sets
(`STEP=sample`). I read each trace and question with only the ticket's title,
and asked one thing: could the owner say "build" or "close" now, without
opening the code or the ticket? Yes needs all three: the trace says what the
code does and where (file and line, or the PR); it says the harm or what is
missing; and the question is one yes-or-no call.

- **Yes, 12 of 15:** #7952, #10139, #8479 (both models), #8672, #6471, #9623,
  #6330, #10066, #10138, #1810 (GPT sol), #9826.
- **No, 3 of 15:**
  - #1810 on opus: right and complete, but the question offers three fixes
    (a karma gate, inert votes or a rate limit). A real design call; not
    seconds.
  - #9983 on GPT sol: the diff was cut before the code it needed, and the
    question asks to "run the two-account spike". It needs work first.
  - #8057 on GPT sol, `unclear`: the trace could not confirm the fault. The
    owner would have to look.
- **Worth knowing:** 7 of the 15 questions lean on the answer ("despite no
  observed failure", "a hypothetical wrong-path merge"). That framing may
  push the owner to close. The owner's real answers on these 15 were 7 built,
  8 closed.
- **How sure:** one reader, me, and the reader also wrote the brief. A second
  reader, or the owner timing a real batch, would settle it.

### Proposed bar (needs the owner)

The old bar had two answers. These lines fit three. **Proposed, not
approved;** the owner sets the numbers.

| Line | Proposed | v6 now | Why |
|---|---|---|---|
| wrong closes, built tickets | at most 1 in 30 (about 3%) | GPT sol 1 of 32, opus 2 of 27 | a wrong close is work nobody sees again; with asks as the way out, a close should be a fact |
| security closed | 0 | GPT sol 0, opus 1 (#3361) | the owner decides every security ticket |
| wrong keeps, closed tickets | at most 10% | GPT sol 4 of 31 (13%), opus 1 of 24 | a wrong keep costs a build, cheaper than a wrong close |
| ask load | a weekly budget the owner names, for example 50 | about 105 to 190 | this is the owner's time |
| answerable asks | at least 12 of 15 sampled | 12 of 15 | an ask that needs digging is not a seconds call |

- **Why these numbers:** 3% is v6 on GPT sol, rounded up, so the line says
  "no worse than now"; 10% keeps today's cheap-error room; 50 a week is about
  7 a day. Confidence 60%: none of these is measured against what the owner
  will put up with. The ask budget is the line that decides if v6 is usable,
  and only the owner can set it.
- **v6 fails the ask line by 2 to 4 times at any budget near 50.** The next
  move is not a tighter close rule. It is to make asks cheaper (a batch view,
  "build or close?" one tap each) or fewer (let the owner rule a class once,
  such as "missing tests for working code: close", and turn that ruling into a
  close fact).

### What it cost

| Run | Answers | Dollars | Input tokens (cached) | Output tokens |
|---|---|---|---|---|
| GPT sol, 63 and 119 | 364 | $25.37 list ($9.34 on the 63, $16.03 on the 119) | 40,190,985 (30,302,080) | 256,214 |
| Opus, 63 (stopped at 51) | 51 | $11.49 | 4,475,507 (3,407,713) | 109,996 |

- Opus mean $0.23 an answer, median 8 reads and 18 s. DRY=1 said $9.32 for
  all 63 at part 3's mean ($0.148); v6 also reads diffs, so it cost 52% more an
  answer, and the cap stopped it at 51. Part 4's opus spend is $11.49 of $12.
- GPT sol median about 23 s and 4 reads an answer; mean $0.070 an answer at
  list price, about a third of opus's $0.23 for the same brief.
- `field/runs.jsonl` has a row per answer (415); `field/notes.jsonl` notes
  2026-10-30-11 to 13.

### Who did what

- **This repo's harness:** brief v6, the open-PR read (`STEP=prs`), the code
  copies with each case's diffs, the run, the numbers and the sample, in
  `163-triage-ask.ts` and `lib/triage-ask.ts`. The live turns in
  `lib/brief-eval-live.ts` now take any answer's shape.
- **Opus:** the Claude Agent SDK on its own login, `claude-opus-5-5`, Read,
  Grep and Glob in a read-only copy, the brief as its system prompt.
- **GPT sol:** `gpt-6.1-sol`, effort medium, through this repo's Codex adapter
  with the folder read-only, on the ChatGPT plan, no OpenAI key.
- **The labels are part 1 to 3's:** today's fabrika's for the 119, and what
  really happened (a merged PR or a person's close) for the 63. Phoenix was
  only read: the PR list and PR heads through `gh` and `git fetch`. Nothing
  was written to phoenix. Names in the saved traces are masked as `[name]`
  (none came up); two traces named phoenix's preview host, masked as `[a
  Cloudflare host]`.

### What part 4 means

1. **Keep the split.** Closing only on a shown fact removes most wrong closes
   on both models, and the two models no longer land on opposite sides.
   Confidence 80%: the drop is large (4 to 1, 10 to 2) but on sets that are no
   longer blind.
2. **The open pull request list was worth adding.** It fixed the two cases
   part 3 named, and models used it unprompted on other tickets (#6471,
   #10066, #8672 trace into PR diffs). Confidence 75%; work on a branch with no
   PR still looks absent (#6314, #5092, #8731).
3. **The ask load is the new problem, and it is the owner's.** 105 to 190 a
   week is too many for one person to answer well. Make asks cheap or rule
   classes once; that is a product question, not a brief edit.
4. **Fix "always ask on security" in code, not in words.** Opus broke it once.
   A Check after the Draft can turn any non-ask answer on a security ticket
   into an ask, if security is known; here it comes from the label, which
   triage will not have. Confidence 70% that a small Judge (is this a security
   ticket?) can do it; untested.

### What part 4 cannot tell us

- **A blind number.** Both sets have been seen; v6 is untuned, but the owner's
  ask for v6 came from the 63's misses.
- **Opus on all 63, or twice.** The cap stopped it at 51 and one run gives no
  agreement.
- **How long a real ask takes the owner.** The 15-ask judgment is mine, by
  hand, from text. A timed batch with the owner would settle it.
- **Whether the owner would answer asks the way phoenix went.** Phoenix's
  outcomes were not consistent on small faults; the owner's live answers may
  not match them either.
- **The real filing mix.** The load uses one 60-day count and the sets' ask
  shares, and the sets are not a random sample of phoenix.
- **Work on a branch with no pull request.** The copy cannot show it.
- **Another day.** One run, one model id each, one Codex version.

## Part 5: fewer asks without looser closes

Run on 2026-10-30. Part 4 left 229 asks on 104 tickets, about 135 to 192 a
week. The proposed bar's ask budget is about 50. Can we ask less without
closing more wrongly? Everything here is offline, on part 4's saved answers:
no triage model ran again.

**Answer: no single idea, and not all three together, meets the bar.** The
security rule is worth building: it removes the one security close for one
ask. Bundling and precedents remove almost nothing once checked. Keeping worth
asks is the only big cut, and it is a trade the owner has to choose: about 45%
wrong keeps for about 100 fewer asks a week.

```ts
// Part 5's shape: four rewrites of part 4's answers, then the same bar.
type Answer = { n: number; said: "close" | "keep" | "ask"; why: string; really: "close" | "keep"; security: boolean };

const securityRule = (xs) => xs.map((a) => a.security && a.said !== "ask" ? { ...a, said: "ask", why: "security" } : a);
const followRulings = (xs, rulingOf) => xs.map((a) =>
  a.said !== "ask" || a.security || a.why === "security" ? a
  : rulingOf(a.n) ? { ...a, said: rulingOf(a.n).verdict, why: "precedent" } : a);
const keepWorth = (xs) => xs.map((a) => a.said === "ask" && a.why === "worth" ? { ...a, said: "keep", why: "cheap" } : a);
// bundles do not change an answer; they change how many decisions the owner makes.

// the one precedent both matchers found, on #6374 (asked as security, so not applied):
{ kind: "rule", n: 6062, why: "Earlier #6062 asked for a takeover path for a stale claim left by a dead session, and it was closed not-planned under the #5752 ruling ..." }
// phoenix built #6374 later: following that ruling would have been a wrong close.
```

### The security rule

- **The rule:** any answer that is not ask, on a security ticket, becomes an
  ask. Code, after the Draft, so the model cannot break it.
- **What it changes:** opus's close on #3361 becomes an ask. Opus's wrong
  closes go from 2 of 27 to 1 of 27, security closed from 1 to 0, asks from 32
  to 33. GPT sol asked on every security ticket already, so nothing changes.
- **Every scenario below applies it first.**
- **How sure:** 95% on these numbers. But security here comes from the label,
  which triage will not have. A real rule needs a security check of its own,
  untested (part 4's point 4).

### Bundle by area

**The rule, fixed before any bundle was read:** two asks are one decision when
they share a key. The keys of an ask are its own number, every number its body
or trace names, each open pull request its trace names from its own list, and
the first file path its trace names. Bundles are built greedily, the most
shared key first, and each ask joins one bundle. Three windows: the whole set,
each filing week, and a looser "chained" count (anything linked, even through
a third ask) as the upper end.

**The weekly number is a sketch.** The sets hold 4 or 5 asks a week; a real
week has about 140. So the asked tickets of one model are drawn k at a time
(40 draws each, seed 1635), bundled, and a power law fitted to that curve is
read at the week's ask count.

**The hand check:** 10 bundles of two or more, drawn with seed 1635 from GPT
sol's run 1 on both sets (`STEP=groups`). One reader, me, asked: would one
answer from the owner settle every ask in it?

- **One decision, 2 of 10:** three leaks of the newcomer sandbox (#1810, #1811,
  #3724: one ruling, "the sandbox holds on every path", settles all); two faults
  in the same spawn-clear branch check (#7340, #7344).
- **Not one decision, 8 of 10:** four unrelated faults that start at the same
  entry file (pano `mutations.ts`); two tickets that only list the same open
  pull request (#9611 and #9771, #10463 and #10418, #4208 and #4200, #6566 and
  #6585); two chat window tickets (a clipped notice, a missing test); a CI
  comment check and a test that skips `.tsx` files (same workflow file).
- **So a file or a pull request says where the code is, not what the owner
  must decide.** What bundling saves is scaled down to the 2 in 10 that held.

| | GPT sol, 63 | GPT sol, 119 | Opus, 51 |
|---|---|---|---|
| asks a week (security rule) | 187 to 192 | 135 to 140 | 186 |
| decisions, whole set (asks in the set) | 30 to 31 (41 to 42) | 41 (56 to 58) | 26 (33) |
| decisions a week, rule as written | about 108 to 110 | about 83 to 86 | about 119 |
| decisions a week, after the hand check | about 172 to 176 | about 125 to 129 | about 173 |

- **How sure:** 60%. The hand check is 10 bundles, one reader. 2 of 10 could
  be anything from about 1 in 20 to 1 in 2. The power law reads past the pool
  (102 asked tickets for GPT sol, 32 for opus). A real week is denser in time,
  so more links may hold; a second reader on 20 more bundles would settle it.

### Follow past rulings

**How:** for each of the 104 asked tickets, every phoenix issue settled before
that ticket was filed (`closedAt` earlier than the filing) is a candidate.
7,301 issues read read-only through `gh` (`STEP=ruled`): 3,295 built by a
merged pull request, 2,162 closed not planned, 955 closed done with no pull
request, 889 open. No issue was closed as a duplicate by GitHub's reason. The
8 best lexical matches (tf-idf on titles; the asked ticket's title and body)
go to a matcher with how each was settled and, if closed unbuilt, the note it
was closed with (its last comment from before the close). The matcher answers
`same`, `rule` (cite one) or `none`, and is told to pick none unless sure. A
`rule` takes the earlier ticket's settling (built is keep, not planned is
close); `same` closes. A precedent never answers a security ask, by label or
by the model's own why.

| Matcher | Tickets it may answer | Matched | Right | Wrong closes | Dollars at list price |
|---|---|---|---|---|---|
| claude-haiku-5-5 | 68 | 0 (1 more, on a security ask) | 0 | 0 (the security one would be wrong) | $0.25 |
| claude-sonnet-5-5 | 68 | 0 (2 more, on security asks) | 0 (of the 2: 1 right, 1 wrong) | 0 | $3.97 |
| lexical, top match at 0.3 or more, no model | 68 | 3 | 2 | 1 (#8992) | $0 |
| lexical, at 0.4 or more | 68 | 1 | 1 | 0 | $0 |

- **Phoenix's history holds almost no ruling that settles a later ticket.**
  The best earlier matches are mostly built tickets on the same page or
  module, with a different fault. The median best lexical score is 0.17.
- **The one match both models made shows the risk.** #6374 (a killed seat
  strands its lane claim) cites #6062, closed not planned under a class ruling
  (#5752: a strand from a gone session is a person's job). Phoenix built #6374
  later. A class ruling can be reversed, and an old match does not know.
- **Sonnet's other match was right:** #10591 cites #10363, built, the same
  owner-only check. A security ask, so it stays an ask.
- **How sure:** 85% that matching on this history saves under 5% of asks.
  The candidates are titles and closing notes only; a matcher shown the
  earlier tickets' bodies might find more. Part 4's idea of a dated class
  ruling, written by the owner, is a different thing and is not tested here.

### Keep when it is cheap

**The trade:** a worth ask kept without asking saves 30 s of the owner. It
wastes a build when the ticket should have been closed, which is a share p of
worth asks. Keeping wins when 30 s of the owner is worth more than p times a
build. No hourly value is picked here.

- **p:** GPT sol 50% of 119 worth asks, opus 45% of 20 (part 4's labels).
- **A build:** $3.23 median, $1.73 to $7.68, over the 6 machine-driven
  kamp-us/demlik lanes with dollars in `field/runs.jsonl` (machine rows
  summed per lane). 25.4 agent minutes median, 1.8 to 45.9, over 18 demlik
  lanes with builder, reviewer and shipper minutes.
- **Break-even:** keeping beats asking if 30 s of the owner is worth more than
  about **$1.60** (GPT sol $1.60, $0.86 to $3.81 over the build range; opus
  $1.45). That is about $190 an hour.
- **Asks removed a week:** at $0.25, $0.50 or $1 per 30 s, none (ask). At $2 or
  $5, all worth asks: about 94 a week on GPT sol, 113 on opus.
- **What it breaks:** wrong keeps go from 0% to 13% to 42% to 48% (opus 10 of
  24, GPT sol 15 of 31 and 18 of 41). The proposed line is 10%.
- **How sure:** 55%. The builds are demlik lanes, not phoenix; six lanes with
  dollars. The dollars leave out the owner's own time on each wasted pull
  request: if the owner reads every pull request, a wasted build costs more
  owner time than the 30 s it saved, and the break-even does not hold at any
  price. Timing the owner on a real batch of pull requests would settle it.

### All together, against the bar

GPT sol 2 runs, opus 1. Asks a week at 288 filings a week. Decisions a week
after the hand check. Precedent adds nothing on either model, so "all three"
is the security rule, then keep worth, then bundles.

| Scenario | Asks a week (decisions) | Wrong closes | Security closed | Wrong keeps | Budget 50 |
|---|---|---|---|---|---|
| part 4 as it was | sol 135 to 192, opus 181 | sol 1/32, 3 to 6/78; opus 2/27 | opus 1 | sol up to 13%, opus 4% | fail |
| security rule | sol 135 to 192, opus 186 | opus 1/27 | 0 | same | fail |
| + bundles alone | (sol 125 to 176, opus 173) | same | 0 | same | fail |
| + precedent alone (either model) | no change | same | 0 | same | fail |
| + keep worth alone | sol 48 to 87, opus 73 | same | 0 | 42% to 48% | sol 119 only |
| all three | sol 48 to 87 (45 to 81), opus 73 (67) | same | 0 | 42% to 48% | sol 119 only |

- **Wrong closes, at most about 1 in 30:** GPT sol on the 63 passes (1 of 32);
  on the 119 it fails (6 and 3 of 78), as in part 4. Opus is 1 of 27 after the
  rule, just over 1 in 30. None of the ideas here touches a close.
- **Security closed, 0:** passes everywhere once the rule is in.
- **Wrong keeps, at most 10%:** fails as soon as worth asks are kept. Without
  keep worth, GPT sol on the 63 is at 10% and 13% (part 4).
- **Answerable, 12 of 15:** not measured again. Of part 4's 15 sampled asks, 7
  were worth asks, which keep worth removes; 7 security asks and 1 unclear
  stay. Whether the asks left are as easy to answer is not known.
- **Ask budget, about 50:** only GPT sol on the 119 gets there, and only with
  keep worth.
- **Without bundles' paper numbers** (the rule as written, not hand-checked),
  all three would read sol 34 to 56, opus 43. Those are the wrong numbers to
  plan on; they stay here so the gap shows.

### What it cost

| Step | Calls | Dollars at list price |
|---|---|---|
| haiku matcher | 104 | $0.25 |
| sonnet matcher | 104 | $3.97 |
| issue states and closing notes (`gh`, read-only) | 74 pages, 7 batches | $0 |

- **Wrong estimate, kept:** `DRY=1` said about $0.06 for haiku and $1.11 for
  sonnet, from about four characters a token plus 3,000 tokens a call. Real:
  about 10,100 tokens in a call and $0.0024 (haiku) and $0.038 (sonnet), about
  4 times the guess. The cap of $5 held: $4.22 in all.
- `field/runs.jsonl` has a row per matcher call (208); `field/notes.jsonl`
  notes 2026-10-30-15 to 17.

### Who did what

- **This repo's harness:** the four rewrites, the bundle rule, the bar, the
  week sketch and the break-even in `lib/fewer-asks.ts`; the matcher call in
  `lib/fewer-asks-live.ts`; the steps in `163-fewer-asks.ts`.
- **Matchers:** the Claude Agent SDK on its own login, `claude-haiku-5-5` and
  `claude-sonnet-5-5`, no tools, no settings, the matcher brief as the system
  prompt.
- **Part 4's answers** (GPT sol and opus with brief v6) are the input; no
  triage model ran. Build costs are from today's fabrika and this repo's
  machine on kamp-us/demlik lanes. Phoenix was only read. Nothing was written
  to phoenix. The matchers' saved whys are masked for names and hosts (none
  came up).

### What part 5 means

1. **Build the security rule as a Check after triage's Draft.** It is a few
   lines, it fixes the one break, and it costs one ask. Confidence 90% that it
   is worth building; the open part is how triage knows a ticket is security
   without the label.
2. **Do not build precedent matching on phoenix's history.** It found 0 of 68,
   and the one strong match it made would have been wrong because the old
   ruling was reversed. Confidence 85%. If the owner wants to rule a class
   once, keep it as a named, dated rule the owner can withdraw.
3. **Group asks by area in the owner's batch view, but do not count it as
   fewer decisions.** It may make reading faster; it does not merge answers.
   Confidence 60% that grouping helps reading at all; untested.
4. **The ask budget and the wrong-keep line cannot both hold with v6.** The
   owner picks: about 130 to 190 asks a week at 10% wrong keeps, or about 50
   to 90 at about 45%. Keeping is cheaper in dollars above about $1.60 per 30 s
   of the owner, but only if the owner does not read each wasted pull request.
   Confidence 70% in the trade as stated.

**The owner's pick (2026-10-30): the first way, more asks with clean builds.**
The ask budget stays open until triage runs on real weeks, and the pick is
checked against those weeks. The security rule is the next piece to build. See
[Triage asks when worth is unclear](../docs/direction/triage-asks-when-worth-is-unclear.md).

### What part 5 cannot tell us

- **Any live number.** No triage model ran; every scenario rewrites part 4's
  answers.
- **A blind number.** Same sets as part 4, both seen.
- **What a real week bundles to.** The week count is a fitted sketch on about
  14 weeks of thin data, and the hand check is 10 bundles by one reader.
- **Whether an owner-written class ruling would work.** Phoenix's history has
  few, and the one found was reversed. Only the owner writing rules on a real
  week would tell.
- **What a wasted phoenix build costs.** The build dollars are six demlik
  lanes, and the owner's review time is not in them.
- **Whether security can be known without the label.** The rule's numbers are
  an upper bound.
- **Another day.** One run of each matcher.

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
STEP=examtest node experiments/163-triage-brief-eval.ts   # part 3: the exam step on a fake set in the real set's shape, 24 checks, $0
STEP=exam FRESH=<set.json> MODEL=sol BRIEF=triage-v5 node experiments/163-triage-brief-eval.ts   # against 163-exam-bar.json (approved 2026-10-30); once per brief hash and model; DRY=1, MAX_USD=25 (the exam ran at 30); STEP=decide FRESH=<set.json> prints finished exams
STEP=exam FRESH=experiments/163-exam-set.json MODEL=opus BRIEF=triage-v5 MAX_USD=30 node experiments/163-triage-brief-eval.ts   # the exam as run; both pairs are done, so it now refuses
STEP=field PART=3 node experiments/163-triage-brief-eval.ts   # part 3's rows only
STEP=field FRESH=experiments/163-exam-set.json node experiments/163-triage-brief-eval.ts   # the exam's rows
STEP=prs node experiments/163-triage-ask.ts                # part 4: the PRs open at each filing, through gh, read-only; their heads fetched into the clone (push off)
STEP=check ONLY=4208,4313 node experiments/163-triage-ask.ts   # part 4: the open PR list as the model sees it
STEP=run SET=exam MODEL=sol RUNS=2 node experiments/163-triage-ask.ts   # part 4: SET=tuning for the 119; MODEL=opus RUNS=1 MAX_USD=12, DRY=1 first
STEP=report node experiments/163-triage-ask.ts             # part 4: the numbers; WHY=1 adds every trace
STEP=load node experiments/163-triage-ask.ts               # part 4: phoenix's filing rate over 60 days, and asks a week
STEP=sample node experiments/163-triage-ask.ts             # part 4: 15 asks, seed 1634, for the by-hand judgment
STEP=field node experiments/163-triage-ask.ts              # part 4: field/runs.jsonl rows
STEP=listprice node experiments/163-triage-ask.ts          # GPT sol's list-price dollars on 159 to 163's field rows
STEP=ruled node experiments/163-fewer-asks.ts              # part 5: phoenix's issue states, through gh, read-only; run twice (the second reads closing notes)
STEP=match MODEL=haiku DRY=1 node experiments/163-fewer-asks.ts   # part 5: the precedent matcher's estimate; drop DRY to run; MODEL=sonnet; MAX_USD=5 caps both together
STEP=groups node experiments/163-fewer-asks.ts             # part 5: ten seeded bundles for the hand check
STEP=report node experiments/163-fewer-asks.ts             # part 5: every scenario against the bar; writes results/163-fewer-asks.json
STEP=field node experiments/163-fewer-asks.ts              # part 5: field/runs.jsonl rows, one per matcher call
```

Run each with `TYPESAFE_API_KEY`, `OPENAI_API_KEY` and `CODEX_API_KEY` unset;
the live Sorter refuses to start with any of them set.
