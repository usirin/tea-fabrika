# 163. The triage brief, made the tested way (part 1)

The question: can we test a triage brief the way a brief-lab program would
(ticket #62), with one labelled set, a locked half, an owner's bar and one
scorer? Part 1 builds every piece and proves the harness on 5 cases. It does
not score the brief.

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

## What this means

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

## What it cannot tell us

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

## Run it

```
STEP=set node experiments/163-triage-brief-eval.ts        # step 1: 163-set.json from the truth files
STEP=split node experiments/163-triage-brief-eval.ts      # step 1: 163-split.json, seed 163; refuses if it exists
STEP=fetch node experiments/163-triage-brief-eval.ts      # first title and body of every case, through gh, read-only, into runs/exp-163-cache
STEP=bar node experiments/163-triage-brief-eval.ts        # step 2: the bar, as counts on the locked half
STEP=brief node experiments/163-triage-brief-eval.ts      # step 3: BRIEF=triage-v1, its rules, hash and text
STEP=selftest node experiments/163-triage-brief-eval.ts   # the scorer on a fake Sorter, $0
STEP=tune MODEL=opus SMOKE=1 node experiments/163-triage-brief-eval.ts   # step 4; MODEL=sol; ONLY=, RUNS=2, DRY=1, MAX_USD=2
STEP=lock MODEL=opus node experiments/163-triage-brief-eval.ts           # step 5: refuses until 163-bar.json is approved
STEP=decide node experiments/163-triage-brief-eval.ts     # step 6: the locked numbers against the bar
node experiments/163-triage-brief-eval.ts                 # the report; WHY=1 adds every answer's why
STEP=field node experiments/163-triage-brief-eval.ts      # field/runs.jsonl rows
```

Run each with `TYPESAFE_API_KEY`, `OPENAI_API_KEY` and `CODEX_API_KEY` unset;
the live Sorter refuses to start with any of them set.
