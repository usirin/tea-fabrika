# 117. Promises that stay in step with their code

The question: can we keep every formal check tied to the code it describes, so a check can
never go stale while it stays green?

**Answer: yes, for the code a record names.** Each check now has a record that names the code it
covers, by file and block name, with a print of that code. CI runs every check and its planted
break on every push, and fails when covered code changed and nobody confirmed the check again.
All five breaks done on purpose did what they should; what it cannot see is code the record does
not name.

- Built: the package `@kampus/promises`, two records in `promises/`, the command
  `pnpm promises`, and a new CI step.
- Tested: 5 breaks plus 2 extra cases in scratch commits on a throwaway worktree, and 16 unit
  tests. `pnpm test` went from 2170 to 2186 tests, all passing.
- Spent: $0. No key, no network, no model. The CI step adds about 2 seconds.
- Confidence 85% that it does what it says. 70% that "a top-level block" is the right size of
  name (see below).

## The idea in one picture

What a person reads first, from `pnpm promises` on this branch:

```
Promises: 2, 2 green

  green  review-form-for-another-head-never-counts  search    confirmed at f777f30
  green  ship-ended-run-sends-nothing               search    confirmed at f777f30
```

And one record, `promises/ship-ended-run-sends-nothing.json`, cut short:

```json
{
	"promise": "Once a ship run has ended, it sends nothing more: no read, no enqueue, no merge.",
	"harm": "A run that already said done or stuck could read again and merge a pull request a second time, after nobody is watching it.",
	"tool": "search",
	"check": "node packages/pipeline/src/laws/promise-check.ts ship \"an ended run sends nothing\"",
	"plant": {"name": "actsAfterTheEnd", "what": "A restart after the end reads again, as if the run were still going."},
	"covers": ["packages/pipeline/src/stages/ship/machine.ts#createShip", "...#over", "...#stay", "...#revived", "...#ship"],
	"exam": ["packages/pipeline/src/laws/ship.ts", "packages/pipeline/src/laws/explore.ts", "packages/pipeline/src/laws/promise-check.ts"],
	"confirmed": {
		"commit": "f777f30654417c8d99b02d5b1f97d314b00db925",
		"prints": {"packages/pipeline/src/stages/ship/machine.ts#createShip": "...", "...": "..."}
	}
}
```

The gate, as a sketch of what `judge.ts` does for each record:

```ts
// green = in step && the check held && the plant was caught
const stale = pieces.filter((p) => printNow(p) !== record.confirmed.prints[p]);
const check = run(record.check);                                   // must hold
const plant = run(record.check, {PROMISE_PLANT: record.plant.name}); // must break
if (stale.length > 0 || !check.held || plant.held) fail();
if (examChanged(record, recordAtBase)) tellTheOwner();               // marked, not failed
```

## The story

Think of the sticker a lift inspector leaves in a lift.

- The sticker says what was checked ("doors, brakes, cables"), and the date.
- If someone swaps the cables after that date, the sticker is still on the wall, still green.
  It now lies.
- Our checks had the same problem. Experiment 115 checked the lane with a model copied by hand
  from `hosted/lane.ts`. Nothing tied the model to that code.
- A promise record is a sticker that knows when it lies.
  - It lists the parts it checked, by name: `machine.ts#createShip`.
  - It keeps a print of each part as it was when checked: a short hash of the text.
  - CI compares each print with the code now. If the cables changed, the sticker turns red, and
    stays red until someone checks the lift again and puts up a new sticker.
- The idea comes from pstack's recipe for formal checks
  (https://github.com/cursor/plugins/blob/main/pstack/skills/create-formal-verification-skill/SKILL.md),
  which asks for a coverage record and a "sync commit". Here the code holds it, not a prompt
  ([Make the mistake impossible](../docs/direction/make-the-mistake-impossible.md)).

## The five steps, and what each means here

1. **Pick the riskiest promise.** One plain sentence per record (`promise`), and who gets hurt
   if it breaks (`harm`).
2. **Let the question pick the tool.** `tool` says which: `search` (every order of messages, our
   `explore.ts`), `tla`, `property` or `proof`. Both records today are `search`.
3. **Show the check can fail.** `plant` names a planted break. The runner runs the same command
   with `PROMISE_PLANT=<name>`, and the check must break, on the same law.
4. **A failure stays a failure.** A red check fails the gate, and the gate says "never loosen the
   check to pass". A change to the check is listed for the owner.
5. **Write down what it covers.** `covers` and `exam` name the code; `confirmed` holds the prints
   and the commit. Covered code that changed fails CI until `pnpm promises confirm` runs green.

## How covered code is named

- **A name, not a line range.** `file.ts#createShip` is every top-level statement that declares
  `createShip`. `file.ts` alone is the whole file.
  - Why: lines shift whenever someone adds an import. A name moves with its code. A test shows
    a block keeps its print when ten lines are added above it.
  - A name that declares two things (a schema and its type, `const Kept` and `type Kept`) covers
    both.
- **A print** is the first 16 hex characters of the sha256 of the block's text.
- **How a block is found:** a small scanner in `blocks.ts`. It skips strings, template strings
  and comments, counts brackets, and starts a new block at each line that begins at column 0 at
  the top level. Biome formats this repo, so every top-level statement starts at column 0.
- **Why not the TypeScript parser:** the repo's `typescript` is the native one (version 7) and
  has no JavaScript API to call. The scanner is 60 lines and has a test with a template string
  that holds a `}` at column 0.
- **Two lists, two meanings.**
  - `covers`: the code the promise is about. Changed alone, it needs a fresh confirm, and that
    is all.
  - `exam`: the check itself (the law file, the checker, the check command). Changed, it also
    goes on the owner's list ([Nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md)).

## Why prints, and not only the commit

- pstack's recipe keeps a commit: "the check was last confirmed at commit C".
- Pull requests here are squash-merged. The branch commits, C among them, do not reach main.
  A gate that asks git "did this code change since C?" would break on main after every merge.
- So the record keeps both:
  - `commit`, for people: `git diff <commit> -- <file>` shows what changed, while that commit
    is still around.
  - `prints`, for the gate: they survive squash, rebase and cherry-pick.
- `pnpm promises confirm` refuses to run while a file it names has changes that are not
  committed, so `commit` always holds the code that was checked.

## One whole example, start to end

The real promise `ship-ended-run-sends-nothing`, record as above.

**1. Someone changes covered code.** In a scratch commit, inside `createShip`:

```diff
-			resume: (s): Step => ("asked" in s ? [s, [s.asked]] : stay(s)),
+			resume: (s): Step => (s.phase !== "over" && "asked" in s ? [s, [s.asked]] : stay(s)),
```

The promise still holds. But nobody has said so yet.

**2. CI runs the gate.** It prints:

```
Gate: 2 promises, against cb1c0bf
  ok   review-form-for-another-head-never-counts: in step, check held, plant caught
  FAIL ship-ended-run-sends-nothing: covered code changed since f777f30

  Changed since it was confirmed at f777f30:
    packages/pipeline/src/stages/ship/machine.ts#createShip
  Look: git diff f777f30 -- packages/pipeline/src/stages/ship/machine.ts
  Read the promise against the new code. If it still says what the code does,
  run: pnpm promises confirm ship-ended-run-sends-nothing
  If it does not, change the check first: that is an exam change, for the owner.

Exam changes for the owner: none
Gate: FAIL, 1 of 2 promises
```

Note what it did not flag: the review promise, whose code did not change.

**3. The agent does what it says.**

- It reads the diff, and the promise: "once a run has ended, it sends nothing more". The new
  code sends even less after the end. The promise still fits.
- It runs `pnpm promises confirm ship-ended-run-sends-nothing`. That runs the check and the
  planted break at the head:

```
ship-ended-run-sends-nothing: green
  check    held: "an ended run sends nothing", every order of messages up to 8, 165 states (… ms)
  plant    actsAfterTheEnd: A restart after the end reads again, as if the run were still going.
           caught: "an ended run sends nothing", every order of messages up to 8, 201 states (… ms)
           1. start
           2. read at A: review-code failed
           3. restart, then resume
  ...
Confirmed ship-ended-run-sends-nothing at aba4f3e.
```

- It commits the record. The record now holds the new prints and the commit.

**4. CI runs the gate again.**

```
Gate: 2 promises, against cb1c0bf
  ok   review-form-for-another-head-never-counts: in step, check held, plant caught
  ok   ship-ended-run-sends-nothing: in step, check held, plant caught, confirmed again in this change

Exam changes for the owner: none
Gate: pass
```

**5. What the owner sees.** "Confirmed again in this change", and no exam change. The check did
not move, so there is nothing for the owner to approve. Had the agent also changed the law, the
owner would see this line instead (break 4 below):

```
Exam changes for the owner (the owner says yes to these, never the builder):
  - ship-ended-run-sends-nothing: packages/pipeline/src/laws/ship.ts was changed
```

(The commit hashes in step 3 differ from run to run: each scratch run makes new commits. The
saved output is in `results/117-promises-stay-in-step.json`.)

## The five breaks

Each ran in scratch commits on a worktree made from this branch's head and removed at the end.
`node experiments/117-promises-stay-in-step.ts` runs them all in about 20 seconds.

| Break | What was done | What it printed | Right? |
|---|---|---|---|
| 1 | Changed `createShip`, record not moved | `FAIL ship-ended-run-sends-nothing: covered code changed since f777f30`, exit 1 | yes |
| 2 | Changed `DEFAULT_WAITS` (15 to 20 minutes), in the same file, not covered | `Gate: pass`, exit 0 | yes |
| 3 | Wrote the planted mistake into `createShip`, then wrote new prints and a new commit into the record by hand | `FAIL ship-ended-run-sends-nothing: the check broke` / `The promise broke at this head: ship_facts after the run ended.` / `Never loosen the check to pass.`, exit 1 | yes |
| 4 | Changed `createShip` and the law's report text, ran `confirm`, committed | `confirmed again in this change`, then `Exam changes for the owner ...: packages/pipeline/src/laws/ship.ts was changed`, `Gate: pass`, exit 0 | yes |
| 5a | Made the law look for a phase that never comes, so it cannot fail | list: `red  ship-ended-run-sends-nothing ... (covered code changed since f777f30; the planted break was not caught)`; detail: `NOT CAUGHT, still held`; `confirm` refused: `Not confirmed: ship-ended-run-sends-nothing is red.` | yes |
| 5b | Took the planted break out of the check command's list | list: `(covered code changed since f777f30; the plant gave no verdict)`; detail: `gave no verdict: exit 2, no planted break named "actsAfterTheEnd"` | yes |

Two extra cases ran too:

- **0, nothing changed:** `Gate: pass`.
- **2b, a covered block renamed** (`revived` to `revive`): `points at code that is gone:
  packages/pipeline/src/stages/ship/machine.ts#revived; covered code changed since f777f30`. A
  rename cannot quietly drop coverage.

What the breaks taught:

- **Break 3 is caught by running, not by the record.** Moving the record by hand is easy: the
  prints are just hashes. What stops it is that the gate runs every check at the head, every
  time, and does not trust the record's word.
- **Break 5b also turned the review promise red**, because both records list the check command
  as part of their exam. That is right: the shared checker changed.
- **Break 2 shows the edge of coverage.** `DEFAULT_WAITS` is used by `createShip`, and is not
  covered. Here it does not matter to the promise. But the same rule would let a change to an
  uncovered helper through, if the record forgot to list it.

## How experiment 115's lane promise would join

Pull request 34 of this repository (experiment 115, not merged yet) adds a world search of the hosted lane, a model
copied by hand from `hosted/lane.ts`. When it merges, its record would look like this (a sketch:
the law and plant names are 115's to pick):

```json
{
	"promise": "Every child the lane starts answers, and the lane ends.",
	"harm": "A lane waits forever on a child that died, and the plan never ships.",
	"tool": "search",
	"check": "node packages/pipeline/src/laws/promise-check.ts hosted-lane \"every child that starts answers\"",
	"plant": {"name": "dropsTheAnswer", "what": "A child's end is never read back."},
	"covers": ["packages/pipeline/src/hosted/lane.ts#handlers"],
	"exam": ["packages/pipeline/src/laws/world/hosted.ts", "packages/pipeline/src/laws/explore.ts", "packages/pipeline/src/laws/promise-check.ts"]
}
```

- `promise-check.ts` gets one more entry in its list of machines.
- **This is where records matter most.** Ship and review are checked on the real reducer: if
  the code breaks the promise, the check itself goes red. 115's world is a copy. If the lane code
  changes, the copy does not, and the check stays green while it describes code that is gone.
  The record is the only thing that notices.
- **Found here: a top-level name is too coarse for it.** The lines 115 copied (`lane.ts:217-234`)
  are `const kid`, inside `handlers`, which runs from line 75 to 265. The record can only name
  `handlers`, so any change in those 190 lines asks for a fresh confirm. The next step is a
  dotted name, `lane.ts#handlers.kid`, for a statement one level in.
- **Today 115's law fails on main**: the hang is a real finding. Step 4 says a failure stays a
  failure, so the record would turn CI red until the hang is fixed. The record should join with
  the fix, not before. I am not sure that is right: a finding with no record has no sticker at
  all. One answer is a `known` field that names the issue and keeps the check red but not
  failing. That needs the owner's call.

## Words a newcomer may not know

- **Model:** a small copy of how a piece of code behaves, written to be checked. It is smaller
  than the code, so a checker can try every case.
- **Law:** one rule a machine must keep, written as code that looks at each step, like "an ended
  run sends nothing". `packages/pipeline/src/laws/` holds them.
- **Promise:** a law, said in one plain sentence for a person, with the harm if it breaks. Here
  one record in `promises/`.
- **Planted break:** a copy of the machine with one mistake put in on purpose. If the check does
  not catch it, the check cannot catch anything like it, and its green means nothing.
- **Lasso:** the shape of a "this never ends" counterexample: a path (the string) that leads into
  a loop (the noose) that goes round forever. 115's lane hang is one.
- **Coverage:** which code a check speaks for. Here, the list of named blocks in `covers`.
- **Confirmed commit:** the commit at which someone last ran the check and said it still
  describes the code. Here it is a pointer for people; the prints do the work.
- **TLA+:** a language for writing a model of a system and a checker (TLC) that tries every
  order of its steps. Good for "steps in a bad order". Experiment 116 is trying it.
- **Property test:** a test that makes many random inputs and checks one rule holds for each, on
  the real code. Good for "every input".

## What it costs

- **Time in CI:** each check and each plant runs once per push. Two promises: about 2 seconds.
  It grows with each promise; about 0.4 seconds each for searches of this size.
- **Time for people:** a covered change needs one more step, `pnpm promises confirm <id>`, and a
  commit. That is the point, but it will annoy.
- **False alarms:** a comment changed inside a covered block counts as a change. A wide block,
  like `createShip` or 115's `handlers`, asks for a confirm on changes far from the promise.
- **Money:** none.

## How sure I am

- **85% that the mechanism does what it says.** Every break did the right thing, the unit tests
  cover each problem kind, and the gate runs the checks instead of trusting the record.
  - The doubt: CI has not run it yet. The CI step fetches the base by commit, which GitHub
    allows, but I have not seen it run there. The first CI run on this pull request settles it.
- **70% that a top-level block is the right size of name.** It worked for ship and review. It is
  too coarse for 115's lane. A week of real pull requests would show how often it asks for a
  confirm nobody needed.

## What it cannot tell us

- **Whether anyone read the promise.** `confirm` proves the check is green and the plant caught
  at the new code. It cannot prove someone read the promise against the code. An agent can run
  `confirm` without thinking. The owner sees "confirmed again", not what was read.
- **Code the record does not name.** Break 2 passed on purpose. A helper the promise depends on,
  left out of `covers`, can change with no flag. For a check on the real code a real break still
  turns it red; for a copied model, it does not.
- **Whether the search still reaches the new code.** A new message type the world never sends
  can leave a law green by never testing it. The record flags that the code changed; it does not
  check the world sends every message. (`explore.ts` reports `sent`, which could feed a later
  check.)
- **It only marks exam changes.** It does not stop a pull request that changes code and its exam
  together. The CI half of [Nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md)
  is still proposed. The build stage does not read these records yet either.
- **The scanner is not a parser.** A regular expression literal with an unmatched bracket would
  throw the block edges off. None in the covered files today.
- **Only one tool so far.** Both records are `search`. A `tla` or `property` record only needs a
  check command that prints the verdict line and honours `PROMISE_PLANT`; none exists yet.
- **A record's `check` runs as a shell command in CI.** A pull request could put any command
  there. That is no new hole: a pull request can already change the CI file. But it is worth
  knowing.
