# The plan stage

Decided 2026-10-24. Who picks a property's tool is still open: it waits on
experiment 139. Nothing here is built yet.

```ts
// A sketch: one plan in the names picked 2026-10-24, with the ids the fold gives.
// The ticket: a child that exits with no outcome row leaves the hosted lane
// waiting for good (experiments 115 and 116).
const plan = {
	summary: "The hosted lane ends a child that exits with no row.",
	stories: [
		{id: "s1", who: "an owner", want: "a lane that ends when its children have ended", why: "so one crashed child never holds the lane"},
	],
	tasks: [
		{
			id: "t1",
			title: "End a child that is down",
			ends: "pr",
			// The main scenario: a Property, because a tool can check it.
			scenario: {
				id: "p1",
				when: "a child exits with no outcome row",
				result: "the lane ends that child as stuck:no_outcome within 5 s",
				why: "today the lane waits for that row for good",
				behavior: "new", // its test must fail on today's code first
				tool: "test",
				stories: ["s1"],
				code: [], // filled in once the code exists
				fixture: "a lane with one child that exits before it writes a row",
			},
			// Where a task lists its other checks is not picked: these two lists are a sketch.
			properties: [
				{
					id: "p2",
					when: "a child writes a done row and exits",
					result: "the lane reads that row and moves on",
					why: "the fix must not end a healthy child as stuck",
					behavior: "existing", // its test must pass on today's code
					tool: "test",
					stories: ["s1"],
					code: [{file: "packages/pipeline/src/hosted/lane.ts", name: "handlers"}],
				},
			],
			criteria: [
				{
					id: "c1",
					when: "a reader opens the lane's child Sub",
					result: "a comment says why a child that is down is read once more",
					read: "the comment above `child` in packages/pipeline/src/hosted/lane.ts",
					stories: ["s1"],
				},
			],
		},
	],
	pointers: [{at: "packages/pipeline/src/hosted/lane-ends.ts", why: "experiment 116's property test of this hang"}],
	questions: [],
};
```

## What was decided

### 1. Checks split by who checks them

- **A Property is checked by a tool.** It lasts as a test after the ticket
  closes.
- **A Criterion is read by a reviewer at review.** It ends with the ticket.
- **The plan's `Check` type goes.** Today it is `{how, what}`, with
  `how: "test" | "typecheck" | "run" | "read"` (`stages/plan/plan.ts`).
  - "Check" now names only the move in `packages/pipeline/src/primitives.ts`.
  - A Criterion says what the reviewer reads in `read`, in place of
    `check.what`.

```ts
// A sketch of the two types. Ids are given by the criteria book (decision 5).
type Property = {
	id: PropertyId; // p1, p2, ...
	when: string;
	result: string;
	why: string; // what goes wrong if it breaks
	behavior: "new" | "existing";
	tool: "test" | "tla";
	stories: readonly StoryId[];
	code: readonly {file: string; name: string}[]; // a file and a top-level name in it
};

type Criterion = {
	id: CriterionId; // c1, c2, ...
	when: string;
	result: string;
	read: string; // what the reviewer reads
	stories: readonly StoryId[];
};
```

### 2. A Property's shape

Against the `Promise` of
[Promises in the pipeline](./promises-in-the-pipeline.md), and today's plan
criterion for `serves`:

| Was | Now | What it means |
|---|---|---|
| `says` | `when` and `result` | the same two halves a criterion has |
| `harm` | `why` | what goes wrong if it breaks |
| `is: "new" \| "kept"` | `behavior: "new" \| "existing"` | does the ticket add it, or must today's code already do it |
| `tool: "property" \| "tla" \| "proof"` | `tool: "test" \| "tla"` | which tool checks it |
| `serves` (on a criterion) | `stories` | the stories it is for |
| `covers` | `code` | the file and top-level name it checks |

- **A new property's test must fail on today's code first.** That is red
  first, as in test-driven development
  ([Fowler, TDD](https://martinfowler.com/bliki/TestDrivenDevelopment.html)).
- **An existing property's test must pass on today's code.** It pins what the
  code already does, a characterization test
  ([Wikipedia](https://en.wikipedia.org/wiki/Characterization_test)). Its
  `code` is what the mutation step tests, as
  [Promises in the pipeline](./promises-in-the-pipeline.md) describes.
- **No `"proof"` until something runs proofs.** A tool word with nothing behind
  it is a choice the planner cannot keep
  ([Make the mistake impossible](./make-the-mistake-impossible.md)).
- **`"tla"` stays.** In experiment 116, TLC found the hosted lane's hang in 3
  steps and 118 states, in about 1 second. That write-up still said "do not
  adopt TLA+ now": its spec was a hand copy, and it is worth it only with trace
  validation.
- **Who picks `tool` is open.** Experiment 139, still running, tries TLA+ trace
  validation and tests made from a spec. Its answer may move the pick.

### 3. A Criterion's `serves` becomes `stories` too

- Property and Criterion use the same key for the same idea.

### 4. One main scenario per task

```ts
// A sketch. The key was `job`; the fixture was already required, and stays so.
type Scenario = (Property | Criterion) & {fixture: string};
type Task = {id: TaskId; title: string; ends: "pr" | "answer"; scenario: Scenario /* , its other checks */};
```

- **Each task has one main scenario, under `scenario`.** It is a Property when
  a tool can check it, and a Criterion when only a reader can.
- **Its `fixture` is required.** It says the setup the scenario runs on.
- **The evidence is experiment 86b.** Its 6 plans have 1 task each. In 5 the
  main scenario was checked by a test. In
  [demlik #490](https://github.com/kamp-us/demlik/issues/490), a reworded
  comment, only a reader could check it.

### 5. Properties get ids in the criteria book

- **A property's id is `p<n>`.** It is kept across revisions by `keeps`, the
  way a criterion's `c<n>` is (`packages/pipeline/src/criteria/book.ts`).
- **A property's result comes from a tool, as a `checked` fact.** It never
  comes from a review row, so no agent grades it
  ([Nobody grades their own work](./nobody-grades-their-own-work.md)).

```ts
// A sketch. One tool run on one property, at one version and one commit.
{type: "checked", plan: "demlik-1", property: "p1", version: 1, head: "a1b2c3d", tool: "test", result: "pass"}
```

- **Open:** whether a property's lasting id, after the ticket closes, is the
  name of its record in `promises/`.

### 6. Names

| Was | Now |
|---|---|
| `Facts`, `readFacts`, Cmd `plan_facts` | `CodeContext`, `readCodeContext`, Cmd `plan_code_context` |
| `planDraft` (the Draft move) | `draftPlan` |
| `PlanAsk` (the plan machine's input, `stages/plan/machine.ts`) | `PlanInput` |
| `Numbered` | `WithIds` |
| `Spent` (plan) and `Spend` (fabrika) | `Usage`, one type |
| `stuck:unchecked` | `stuck:unfixed` |
| state key `key` | `session` |

- **`Revision` is kept.** Each `planned` fact stores one. The fold in
  `packages/pipeline/src/asks/rules.ts` gives it ids and makes the `Plan`.
- **Held for a later glossary pass:** `pointers`, `goal`, `at`, `Claim`, and
  calling a revision's number `version`. Each has a weak lean in
  [the naming sweep](../naming-sweep.md); none is picked or dropped.

### 7. Plan has no ask of its own

```ts
// A sketch of the plan stage's words (stages/plan/outcome.ts), after.
const plan = outcomesOf({
	done: {}, // the plan, its questions inside it
	send: {},
	ask: {}, // was {owner: ["questions"]}
	skip: ["closed"],
	stuck: ["read_failed", "draft_failed", "over_budget", "unfixed", "cut_off"],
});
```

- **`ask:owner:questions` goes.** A plan with open questions ends `done`, with
  the questions in the plan.
- **The parent asks the owner once per plan version.** The owner approves it,
  answers its questions, or changes it.
- **A plan with open questions always goes to the owner.**
- **Plan answers only `done`, `skip:closed` or `stuck:*`.**

### 8. Plan runs in a box

- **Inside the box, on a read-only copy of the code:** the planner, its Check,
  and the code reading (`readCodeContext`).
- **Outside the box:** reading the ticket, the fetch at main, and the ledger
  write. Each is a Cmd passed out, as
  [Programs run in a box](./programs-run-in-a-box.md) says.

```ts
// A sketch. Same machine; only the interpret entries for the outside Cmds change.
run(plan, {interpret: {plan_ticket: outside, plan_code_context: readCodeContext, plan_run: draftPlan}});
answer({plan_ticket: readTicketAndFetchMain}); // in the app, with its own key
// the `planned` fact is written outside too, by whoever hears the program's `planned` output
```

### 9. Plan writes only its `planned` fact

- **No markdown is posted anywhere.** The readable plan shows only in the
  tracker's window, on the ticket's timeline
  ([The ticket is the lane's one view](./the-ticket-is-the-lane-view.md),
  [Data first; markdown is a view](./data-first-markdown-is-a-view.md)).
- **The owner's yes records the plan version and a hash of the ticket's title
  and body.** The hash is over a JSON pair. Experiment 138 showed that a plain
  join lets "ab" + "c" and "a" + "bc" share a hash.

```ts
// A sketch, in the shape of the tracker note's `approved` fact, with the version added.
// That note names the plan "p-1". Here it is named by its first ticket, as ids.ts names
// plans, so it is not read as a property's id.
{fact: "approved", ticket: "demlik-1", plan: "demlik-1", version: 2, text: "sha256:9c1f…"}
const covers = (yes: Approved, now: Ticket) => yes.text === sha256(JSON.stringify([now.title, now.body]));
```

### 10. The ticket comes from our tracker

- **The plan stage reads the ticket as a ledger fact, not a GitHub issue**
  ([Tickets start in our tracker](./tickets-start-in-our-tracker.md)).

## What this changes in Promises in the pipeline

That note is still proposed. These parts of it no longer hold:

- **"A promise" is now a Property,** with the keys in decision 2.
- **`tool` is not "picked by code from the promise's kind".** Who picks it is
  open (experiment 139).
- **`"proof"` and `"property"` are gone as tool words.** The words are
  `"test"` and `"tla"`.
- **"New or kept" is now `new` or `existing`.**
- **Its answers list says `plan  promises drafted  ask:owner:approval`.** The
  plan stage now answers `done`, and the parent raises the owner's ask.

These parts stand: red first for a new property, green on today's code for an
existing one, the mutation step after the build, and the owner approving the
properties with the plan. The verify writer's asks, `ask:owner:already_kept`
and `ask:owner:not_kept`, keep their old words: their new names are not
picked.

[Five steps for every check](./five-steps-for-every-check.md) still names "a
proof only past a bound". Under this note, that step has no tool word until
something runs proofs.

## Why

- **Who checks a check decides what it needs.** A tool needs a setup and code
  to run against. A reader needs a place to read. One `Check {how, what}`
  held both.
  - In experiment 86b's 6 plans, the 40 checks (main scenarios included) were
    24 `test`, 15 `read`, 1 `run` and 0 `typecheck`. So the split covers 39 of
    40.
- **A property lasts, a criterion ends.** Before this, the lasting part had its
  own `Promise` type with other words (`says`, `harm`) than a criterion's
  (`when`, `result`). Now both use the same halves.
- **An id must outlive a reword.** The criteria book already gives `c<n>` from
  a counter for that reason. A property needs the same, so a `checked` fact
  can name it across revisions.
- **The ask was already the parent's.** Today the lane treats a plan that ends
  `done` and one that ends `ask:owner:questions` the same way: it writes
  `planned` and waits for the owner (`afterChild`, case `"plan"`, in
  `packages/pipeline/src/stages/lane/machine.ts`). The ledger's fold already
  raises one plan ask per `planned` fact, under the id
  `plan:<plan>@<version>` (`planAskId` in `asks/rules.ts`). A second ask from
  the plan stage said nothing new.
- **The planner reads text a person wrote.** Today it runs on a `git archive`
  copy behind a Claude Code hook (`guardHook` in `stages/plan/planner.ts`).
  The box note says no fence lives inside a harness, and nothing counts on
  one, so the box goes around the program.
- **The yes must cover what the owner saw.** A version alone does not catch an
  edit to the ticket after the yes. The hash does, and the JSON pair keeps two
  different tickets from sharing one (experiment 138).

## What it costs

- **About 15 files in `packages/pipeline/src` build plans in the old shape**
  (`check`, `serves`, `job`). They include `stages/plan/plan.ts`, `check.ts`,
  `ids.ts`, the laws in `laws/plan.ts` and `laws/lane.ts`, and their tests.
- **20 saved answers in `experiments/results/` use the old shape.** They stay
  as they were recorded. A replay over them needs a reader for the old shape.
- **A chore still pays for a fixture.** Experiment 86b found that on #490 the
  required fixture turned a comment reword into work by hand: $0.47 against
  $0.13. A Criterion scenario keeps the fixture, so this cost stays.
- **The `checked` fact is a new fact kind,** and the book needs a second
  counter for `p<n>`.

## How sure

About 80% that the split and the shapes hold once built. The doubts:

- **The tool pick.** Until experiment 139 reports, a plan can say `"tla"` with
  no rule for when. What would settle it: 139's results on whether a spec can
  be tied to the code.
- **The chore fixture.** One ticket in six (#490) did not fit a fixture well.
  What would settle it: a run of the plan stage on a handful of chores.
- **`typecheck` and `run` have no place.** 86b had one `run` check (#367, "pnpm
  test repeated") and no `typecheck`. If real tickets need them, the split
  needs a third kind or a tool word for them.

## Still open

- Who picks a property's `tool` (experiment 139).
- Whether a property's lasting id after close is its record's name in
  `promises/`.
- Where a task lists its other properties and criteria (the sketch's
  `properties` and `criteria` lists are a guess).
- Whether the plan's `goal` gets a `scenario` too.
- What the owner's answer to the questions is: a yes on this version, or the
  start of a new one.
- Whether the plan answer `no` stays beside approve, answer and change.
- Whether a plan that ends `stuck:unfixed` still writes `planned` (today
  `factOf` in `asks/program.ts` writes it, with its problems).
- The new name of the `PlanFacts` service.
- Whether the naming rules for data keys also apply to a property's own words.
- The held names: `pointers`, `goal`, `at`, `Claim`, and a revision's
  `version`.

## Where today's code says otherwise

Nothing here is built. These parts of the code contradict a decision:

- `stages/plan/plan.ts`: the `Check` type with four `how` words; `serves`;
  the key `job`.
- `stages/plan/outcome.ts` and `machine.ts`: `ask:owner:questions` and
  `stuck:unchecked`.
- `stages/plan/lines.ts`: a pointer's line key is `p1`, `p2`, ..., the same
  spelling as a property's id. A "change p1" answer would mean two things.
- `ids.ts`: `TicketId` and `PlanId` are `owner/name#N`, a GitHub issue. There
  is no `PropertyId`.
- `stages/plan/ids.ts`: `nextTaskOf` gives the next task id as one more than
  any task a criterion in the book was under. A task whose scenario is a
  Property, with no criterion, leaves no mark there, so its id could be given
  again.
- `stages/plan/services.ts`, `at-main.ts` and `program.ts`: the ticket is read
  from GitHub, and the program's input is the issue's url.
- `stages/plan/planner.ts`: a harness hook over an unboxed copy, not a box.
- `asks/ask.ts`: `PlanAnswer` is approve, change or no. Approve records no
  hash, and there is no answer to the questions.
- `packages/promises/src/record.ts`: `Tool` is `search`, `tla`, `property`
  and `proof`, and the keys are `promise`, `harm` and `covers`. Both records
  in `promises/` say `"search"`.

## What this cannot tell us

- **Nothing is built.** The shapes are sketches. A field may move when the
  code is written.
- **The evidence is small.** Experiment 86b is 6 tickets on one repository.
- **Experiment 139 has not reported.** Its result may change who picks the
  tool, or whether `"tla"` is worth keeping.
- **Whether properties written by a planner are good tests.** No run has yet
  had a planner write properties and a tool check them on real code.
