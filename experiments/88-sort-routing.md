# 88. Sort routes a "yes" with no ticket-kind label

The question: can sort's "yes" also say what the ticket needs next, so the
ledger needs no kind label (bug, feature, chore, decision, investigation,
epic)? The three routes:

- **plan**: something gets built. Bug, feature, chore, epic.
- **ruling**: an owner must choose first. Never goes to a builder.
- **research**: nobody knows the answer yet. Ends in a finding, no PR.

**Answer: yes, the route holds. On the tickets that really were a yes, sort
picked the step they really took 56 of 66 times (85%), and 58 of 66 (88%) with
the reporter's "suggested next step" cut out. Every miss was the line between
ruling and plan, or history sort could not see. No miss needed a fact a kind
label carries, and the labels today's triage set were wrong as often. The
weak part is not the route but the "no": sort said no once in 160 answers,
and never on the 3 tickets triage closed as not worth it. Confidence in the
claim: 80%, up from 65%. $3.40 in all, about 4 seconds an answer.**

## Who did what

- **The tickets, the labels, the rulings, the PRs:** today's fabrika on
  kamp-us/demlik, before this run.
- **Sort's prompt, schema and runs (`88-sort-routing.ts`):** tea-fabrika, new
  here. It reuses `reader` and `jsonSchema` from `wip/src/schema.ts`, the same
  code a Draft uses to hand an agent its schema and read the answer back.
- **Sort:** Claude (`sonnet`) through the Agent SDK, no tools, one turn.
- **What really happened (`88-truth.json`):** a reader, from each ticket's
  labels, comments and closing PR.
- Nothing was written to GitHub. No lane ran.

## How it was done

### The forty tickets

- Picked from demlik's 382 closed issues, spread across kinds, and weighted
  toward the cases most likely to break the claim.
- **Plan, 15:** 4 bugs (68, 202, 529, 221), 3 features (147, 316, 468),
  2 chores (361, 575), 3 epics (273, 538, 604), and the 3 p0s (54, 113, 166).
- **Decisions, all 9 closed ones:** 6 were ruled and then a PR wrote the
  ruling down or built it (163, 272, 612, 635, 640, 693); 3 ended at the
  ruling (182, 197, 672). Plus one grilling session (554).
- **Research, 5:** the one closed investigation (384, which shipped its
  findings as a PR), two spikes (659, 662), a question answered by another
  ticket's benchmark (381), and a map question answered by reading code (248).
- **No, 6:** two closed on "hardening with no incident" (295, 633), one
  "working as designed" (615), two features an owner later ruled out (320,
  323), and an epic planned and then replaced (657).
- **Duplicates, 4:** 69 of 68, 173 of 24, 394 of 393, 319 of 308. demlik has
  no issue closed with GitHub's "duplicate" reason; these four say so in
  their closing comment.

### What sort saw

- **The first title and the first body.** GitHub keeps every revision of an
  issue body. When a body was edited, the oldest revision is the text as
  filed, and its time matched the filing time on all 22 edited tickets. A
  title renamed later would be put back from its first rename; none was.
- **So no stripping by pattern was needed.** Triage's "In plain words"
  rewrites, plan blocks and dated amendments all came after the first
  revision, and are simply not in it.
- **Where it is still not clean:**
  - Most reports were filed by agents that knew the kind labels. 26 of 40 end
    in a "Suggested next step (non-binding)" that often says "decide",
    "spike" or "fix". A follow-up run cut it (below).
  - Some tickets were filed by the pipeline itself, already shaped: epic
    children with criteria (612), spikes titled "spike:" (659, 662), map
    questions (248), a grilling session (554).
  - 202 was filed after its ruling, and the ruling is in the first body.
  - 173 and 319 needed the code to see they were duplicates; sort had no code.
- **For the duplicate check:** the number and title of every issue filed
  before the ticket, open or closed, as titles stand today. No labels,
  states, comments or PRs.
- **A short note on the repo:** the four packages in one line each, and that
  agents build and owners rule.

### What sort answered

- Data with a schema, read back by the same code a Draft uses:
  - `{answer: "yes", next: "plan" | "ruling" | "research", why}`
  - `{answer: "no", reason, duplicateOf?, why}`
- A yes without a route, or a no without a reason, cannot be written: the two
  are a union, not one shape with optional fields.
- All 160 answers fit the schema the first time.
- Each ticket was sorted twice. A follow-up ("bare") sorted each ticket twice
  more with the suggested-next-step section and the filing footer cut.

### How it was scored

- **`next`:** the first step the ticket really took after triage. A decision
  that was ruled and then written down by a PR scores `ruling`.
- **`end`:** the brief's mapping from the end state: merged PR is plan, ruling
  with no PR is ruling, finding with no PR is research, closed not planned is
  no, duplicate is a duplicate of the right number.
- `next` is the main score. `end` calls every ruled decision "plan", which is
  what the claim says a route should not do.
- **Two `next` values were put right after the run.** The blind reading said
  plan for 68 and 316. Reading their history on the miss showed a ruling
  before each PR: on 68 an owner picked option (b) of the three the report
  listed, two minutes after triage; 316's PR says it builds ruling R1.1. Both
  readings are in the tables.

## What came back

| | Main run | Bare run |
|---|---|---|
| Right by `next`, all 80 answers | 60 (75%) | 62 (78%) |
| Right by the blind reading of `next` | 58 (73%) | 58 (73%) |
| Right by `end` | 46 (58%) | 46 (58%) |
| Route right, on the 33 tickets that really were a yes (66 answers) | 56 (85%) | 58 (88%) |
| Yes or no right | 71 (89%) | 70 (88%) |
| Same answer both runs | 37 of 40 | 39 of 40 |
| Cost | $1.95 | $1.45 |

- **Research was never confused.** 9 of 10 research answers right in the main
  run (one map question said ruling once), 10 of 10 bare. Nothing else was
  ever called research.
- **Every ruled decision went to ruling but one.** 16 of 18 answers; the two
  misses are both 272 (below).
- **The bug that was really a decision went to ruling.** 68 was labelled a bug
  and listed three fixes; sort said ruling both times, and the owner did rule.
- **The investigation that turned into a PR went to research.** 384 asked for
  a measured spike before any rewrite; sort said research both times. Its
  "PR" was the findings file.
- **The suggested next step did not carry the route.** With it cut, the score
  went up by 2, and the answers got steadier (39 of 40 the same both times).

### Each miss, and what it was

Main run first; the bare run had the same misses except where said.

- **272, plan twice (really ruling).** The ruling was already made on another
  ticket (268), and the report says so. A builder then refused it because no
  ruling was recorded on this ticket, and the ruling was copied over. Messy
  history: sort was right that nothing was left to choose.
- **320 and 323, plan twice each (really ruling, then no).** Both were ruled
  out later in a batch grilling session on another ticket. Nothing in the
  report hints at it. Sort could not know; the "feature" label triage gave
  them routed the same way.
- **604, ruling twice (really plan).** The epic's body asks the owners outright
  whether the tool belongs in code-graph or in its own package. The real plan
  asked that question in its grilling session. Defensible: under
  [a project is a parent plan](../docs/direction/a-project-is-a-parent-plan.md)
  a plan holds open questions with a lean, so "plan" covers it. This is the
  one real gap the run found: sort needs a rule for an open question that the
  plan can carry.
- **248, ruling once (really research).** A map question ("one Store, or one
  per engine?") answered by reading the code. The line between "find out" and
  "choose" is thin here; it went to research the other three times, both
  bare answers included.
- **316, plan once (really ruling).** The blind reading also said plan. The
  report offers two shapes for a public contract. Sort right half the time
  here, and both times bare.
- **173, plan twice (really a duplicate of 24).** Sort saw that 24 named a
  different script and called them different. Triage folded them after
  looking at the code. Sort wrong, for lack of the code.
- **319, ruling once and no once (really a duplicate of 308).** The "no" named
  308 in its reason but did not set `duplicateOf`. Triage folded it after
  reading the code. Bare run: plan once, ruling once. Sort wrong, for lack of
  the code.
- **295, 633, 615, plan twice each (really no).** Triage closed the first two
  on its value bar ("hardening with no incident") and the third as "working
  as designed", after running a fixture. Sort had no value bar and no code,
  and said plan. Not a routing miss: the route was never asked for.

### Did any miss need a kind label?

- **No.** A miss that needs a label would be one where the label carried a
  fact the text did not. Here every label was set by a triager reading the
  same text.
- **The labels were no better.** Read as routes (decision is ruling;
  investigation and spike are research; the rest plan), the labels triage set
  were wrong on 68, 316, 320 and 323. Sort was wrong on 272, 320, 323 and
  604, and half wrong on 248 and 316.
- **What a label added was a check, not a route.** On 272 the builder refused
  a "decision" with no ruling recorded on it. A ledger with routes can hold
  the same check: a ticket routed to ruling is not built before a ruling is
  recorded.

### The "no" side

- Sort said no once in 160 answers, outside the duplicates.
- The three tickets triage really said no to went to plan in all 12 answers.
- Sort's brief named no value bar: only "worth doing?". The repo's own bar
  ("hardening with no incident" is a no) belongs in sort's brief, the way the
  repo note is. Without it, sort is a router that says yes.
- Duplicates by title: 2 of 4 caught, with the right number, every time. The
  two missed needed the code.

### The three p0s

- 54, 113 and 166 went to plan in all 12 answers.
- They were closed 1.0, 0.3 and 0.2 hours after filing. A person drove each
  straight to a lane; 166's fix PR was open before the ticket was filed.
- Where time went: 113 lost a few minutes when the build refused it for
  having no criteria, and all three waited at the approval step.
- **"yes + plan" would not have made them faster.** A plan stage closes 113's
  refusal, since every ticket gets criteria, but it adds a step of its own.
  What made them fast was a person starting them at once. That belongs to the
  on-call add-on, as expected.

## What it means

- **The ledger can drop the kind label.** A yes with `next` routes as well as
  the labels did, from the text alone, steadily.
- **Two rules for sort's brief, from the misses:**
  - An open question the plan can carry, with a lean, is plan. Ruling is for a
    choice that must be made before anything can be planned.
  - The repo's value bar, so a "no" can happen.
- **Two things sort cannot do from text alone:** see a ruling made elsewhere
  later, and see a duplicate that only the code shows. Both are a reopen or a
  fold later, as the sort note already says.

## What this does not show

- Every report here was written by an agent that knew the labels, and in a
  fixed shape. A person's short, messy report may route worse. The bare run
  takes out the most leading section, not the style.
- One model (`sonnet`), one prompt, forty tickets from one repo.
- The truth was read by one reader, and two of its values were put right
  after seeing the misses. The blind reading is in the tables.
- 33 of the 40 were a yes; the "no" side rests on 7 tickets.

## Run it

```
node experiments/88-sort-routing.ts                      # the tables
VARIANT=bare node experiments/88-sort-routing.ts         # the bare run's tables
STEP=fetch node experiments/88-sort-routing.ts           # first versions, through gh, read-only
STEP=sort RUNS=2 node experiments/88-sort-routing.ts     # DRY=1, ONLY=, MAX_USD=, MODEL=, VARIANT=bare
```
