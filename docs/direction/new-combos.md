# Four new combos and two that grow, built now

Decided 2026-10-24: all six are built now, before any stage needs them. This
replaces the first proposal of the same day, which said to build each on its
second use. That proposal stays below, marked as replaced.

```ts
// A sketch. Four new combos and two that grow, all made from the six moves.
const mode = rate(rule, facts);                    // Rate: advise or block, from "fix" and "noise" counts
const result = controls(onBad, onGood);            // Controls: red where it must fail, green where it must pass
const brief = briefFor("reviewer", lane);          // Brief: one typed view per role
const ci = poll("ci", {every: "1m", read: checksOf, by: (c) => c.state}); // Poll: a fact only on change
const approval = ask(owner, plan);                 // ask, grown: the approval keeps a hash of what it saw
const touched = guarded(diff, rows);               // guarded files, grown: a change to the exam asks the owner
```

## What is proposed

- **No new move.** Gather, Act, Listen, Draft, Check and Judge cover every
  shape that came up on 2026-10-24.
- **The new shapes are combos,** like the five already in
  `packages/pipeline/src/combos.ts`: gate, remember, refine, ask and spawn.
- **Each gets its name now, in this note.** Design notes use these names from
  today.
- **All six are built now,** each with its tests, next to the combos already
  in `packages/pipeline/src/`. Then we see what the stages look like when they
  are made from them.

| Combo | Made of | Needed by |
|---|---|---|
| Rate | Gather, Check, gate | review findings, the test writer's `noise`, scheduled jobs |
| Controls | Check twice, gate | the test writer on the base, the mutation step, step 3 of every check |
| Brief | Gather, a schema per role | plan, test writer, builder, reviewer |
| Poll | Listen on the clock, Gather | pull request status, scheduled jobs, experiment 139's drift job |
| ask, grown | ask, plus a hash | the owner's approval of the plan, any later ask |
| guarded files, grown | the CODEOWNERS reader, ask | the exam: tests, `includes`, checks |

### Rate

- **What it is.** Code counts the "fix" and "noise" ratings on a rule's
  findings and says whether the rule may block or only advise.
- [Every finding is rated](./every-finding-is-rated.md) decided that a finding
  never rated counts as noise once its change ships. How many ratings a rule
  needs before it may block is still open there.
- Google's Tricorder turns an analyzer off when its findings are marked "not
  useful" too often
  ([Sadowski et al., CACM 2018](https://research.google/pubs/lessons-from-building-static-analysis-tools-at-google/)).
- **A rating counts only when its ledger row was written by a user.** The
  rating does not say who made it; the row's writer does, read as a user or
  an agent (`Writer` in `@kampus/fabrika`). A row an agent wrote, or one whose
  writer names neither, counts as never rated. Today the caller names its
  writer; the ledger stamping it from a signing key comes later
  ([a local-first sync engine](./a-local-first-sync-engine.md)).
- **Each rule says what silence means, with no default.** A check's finding
  never rated counts as noise once its change ships: the owner saw it and did
  not act. The test writer's `noise` answer stays open, shipped or not: it is
  the writer's own call, and only the owner's "noise" lets the mutant live
  ([the test writer](./the-test-writer.md)).

```ts
// A sketch. `enough` is the open question.
type Writer = {kind: "user"; id: string} | {kind: "agent"; id: string}; // a row keeps it as "user:<id>"
type Rating = {finding: string; says: "fix" | "noise"}; // no `by`: who rated is the row's writer
type RatingRow = {writer: string; rating: Rating};
type Silence = "noise" | "open"; // what a finding never rated counts as once shipped

const tally = tallyOf(findings, facts, (rule) => silence(rule)); // users' ratings only
type Mode = "advise" | "block";
const modeOf = (t: Tally, enough: Enough): Mode =>
	t.fix + t.noise >= enough && t.noise === 0 ? "block" : "advise";
```

### Controls

- **What it is.** A check is trusted only when it is red where it must fail
  and green where it must pass. Labs call these negative and positive
  controls ([scientific control](https://en.wikipedia.org/wiki/Scientific_control)).
- It already shows up three times:
  - **The test writer.** A new Property's test must be red on the base, where
    the feature is missing, and green after build. `already_passes` and
    `fails_on_base` are the two ways a control fails
    ([the test writer](./the-test-writer.md)).
  - **The mutation step.** A mutant is a known break, so the tests must go red
    on it. A mutant that lives is a failed control.
  - **Step 3 of [five steps for every check](./five-steps-for-every-check.md).**
    Plant a break the check must catch.

```ts
// A sketch.
type Controlled =
	| {kind: "ok"}
	| {kind: "missed"}       // green where it must fail: too weak, or it already works
	| {kind: "false_alarm"}; // red where it must pass: the check is wrong, or a bug today
const controls = (onBad: Result, onGood: Result): Controlled =>
	onBad === "green" ? {kind: "missed"} : onGood === "red" ? {kind: "false_alarm"} : {kind: "ok"};
```

### Brief

- **What it is.** Code builds each agent's first message from a schema for its
  role. What the schema has no slot for cannot reach the agent.
- **Writers get a full brief:** the ticket, the plan, and what triage or an
  earlier agent already found.
  - In [experiment 140](../../experiments/140-clairic-ticket-mentions.md),
    about two thirds of the files the planner cited are not named in the
    ticket. Only an earlier agent's finds can point at them.
  - Anthropic's research agents did each other's work twice when the brief
    was vague
    ([Anthropic 2025](https://www.anthropic.com/engineering/built-multi-agent-research-system)).
- **Checkers get a thin brief:** the diff, the criteria and the plan. No chat
  and no builder notes.
  - Cognition's review loop works best when the coding and review agents "do
    not share any context beforehand"
    ([Cognition 2026](https://cognition.com/blog/multi-agents-working)).
- `createRefineLoop` already takes a `brief`. This names how a stage builds
  one.

```ts
// A sketch, in Effect Schema. The reviewer's brief has no field for chat or the builder's notes.
const PlanBrief = Schema.Struct({ticket: Ticket, found: Schema.Array(Pointer)});
const ReviewBrief = Schema.Struct({diff: Diff, criteria: Criteria, plan: Plan});
```

### Poll

- **What it is.** A clock wakes the program, code reads something, and a fact
  is written only when the read changed. Elm's
  [`Time.every`](https://package.elm-lang.org/packages/elm/time/latest/Time#every)
  sends a tick the same way, and `update` decides what changed.
- **For things that send no event,** which Listen alone cannot hear.
- **Only on change,** so the ledger keeps no "still running" rows and each
  fact is one real event for the parent.
- **Needed by:**
  - pull request status: the tracker note leans to a watcher that reads each
    open pull request on an alarm and writes a `pr` fact when something
    changed ([tickets start in our tracker](./tickets-start-in-our-tracker.md));
  - [scheduled jobs](./scheduled-jobs-on-the-host.md);
  - the drift job [experiment 139](../../experiments/139-tla-trace-validation.md)
    proposes, which checks a kept spec against real runs.

```ts
// A sketch.
// Built: packages/pipeline/src/poll.ts. `by` names the part of a read that counts;
// `key` is already the child's id. The child hands back the change; the parent writes the fact.
// `limit` bounds each read: a read that never answers counts as failed, so polling never stops.
const ci = poll("ci", {every: "1m", limit: "20s", read: checksOf, by: (checks) => checks.state});
// tick 1: "pending", no fact yet  -> {fact: "pr", pr: 74, state: "pending"}
// tick 2: "pending" again         -> nothing
// tick 3: no answer in 20s        -> nothing, and tick 4 reads again
// tick 4: "green"                 -> {fact: "pr", pr: 74, state: "green"}
```

### ask, grown: an approval covers what it saw

- **Already decided** in
  [tickets start in our tracker](./tickets-start-in-our-tracker.md): the
  owner's approval records a hash of the text, and an edit after the approval
  needs a new approval. The plan stage's `approved` fact carries it.
- **What grows:** `createAsk` keeps the hash in its answer, so every ask
  works this way, not only the plan's.
- GitHub does the same with "Dismiss stale pull request approvals when new
  commits are pushed"
  ([GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)).

```ts
{fact: "approved", ticket: "demlik-1", plan: "demlik-1", version: 2, text: "sha256:9c1f…"}
// before build: the hash of the plan now equals `text`, or the ask goes out again
```

### guarded files, grown: a change to the exam asks the owner

- **Already decided** in
  [nobody writes their own exam](./nobody-writes-their-own-exam.md): a draft
  that touches the exam ends `ask:owner:check_change`. The test writer note
  adds that a diff changing `[test_writer] includes` asks the owner.
- **What grows:** `packages/pipeline/src/codeowners.ts` already reads
  `.github/CODEOWNERS` as protected files and their owners. The same reader
  can say which files are the exam, so one list says what is guarded.
- GitHub calls this "Require review from Code Owners" (same GitHub page as
  above).

```ts
// A sketch, from the exam note.
const touched = diff.files.filter((path) => ownersOf(rows, path).length > 0);
if (touched.length > 0) return {kind: "ask", who: "owner", for: "check_change", files: touched};
```

## Why build now

- **They are common enough.** Each one already has two or three uses written
  in decided notes, as the table shows.
- **Building them shows what we can make from them.** A stage written from
  six built combos shows its real size, and that is worth seeing before the
  stages are designed further.
- **Names give design talks shared words.** Several notes from 2026-10-24
  already use these shapes under other words.

**Cost:** six small pieces of code and their tests, built before any stage
uses them.

**The risk:** the common rule is to wait for the third copy before pulling
code out
([rule of three](https://en.wikipedia.org/wiki/Rule_of_three_(computer_programming))),
because the first shape is often wrong. Brief and Poll lean most on shapes
not built yet, the ledger's facts and the role briefs. If the first stage
built on one has to bend it, the combo changes there; each is small.

### Replaced: build on the second use

Proposed earlier on 2026-10-24 and replaced the same day: name all six now,
and build each one only when a second piece of code needs it, so a use tests
the shape instead of guessing it (75%). Replaced because the uses are already
known and building them shows what the stages can be made of.

## Still open

- **Where the guarded list lives:** in `.github/CODEOWNERS`, or in
  `fabrika.toml` beside `[test_writer] includes`.
- **How many ratings before a rule may block,** from
  [every finding is rated](./every-finding-is-rated.md).
- **Whose clock Poll uses:** the ledger's alarm, or each program's own, as
  scheduled jobs do.

## What it cannot tell us

- Nothing here is measured. The shapes come from one day of design talk and
  experiments 122, 124, 139 and 140.
- The table's uses are planned stages, not running code. A stage built
  another way changes the list.
