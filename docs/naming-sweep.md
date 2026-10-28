# Naming sweep

**Proposed** 2026-10-24. A draft. It proposes names; it renames nothing. The
owner picks machine by machine, then one rename pass and a short glossary page
follow, as [Use the industry's names](./direction/use-the-industrys-names.md)
says. A row marked **picked 2026-10-24** is the owner's choice; the rename
pass has not run yet. A row marked **held 2026-10-24** has a weak lean the
owner kept for the glossary pass: not picked, not dropped.

```ts
// The whole idea, on one name.
type Row = {
	name: "Check";                       // the name in our code, or a schema key
	means: "a criterion's {how, what}";  // what it means here
	industry: "verification method";     // what others call it, with a source
	mark: "two-ideas";                   // ok | differs | two-ideas | two-words | collides
	proposal: "Verification, 55%";       // only where the mark is not ok
};
```

## The answer

626 names and schema keys, in nine sections. 394 are fine as they are. 232
are not:

| Mark | Rows |
|---|---|
| ok | 394 |
| two-ideas | 115 |
| differs | 61 |
| two-words | 51 |
| collides | 5 |

The big problem is not words that differ from the industry's. It is one word
used for two things inside this repo: 115 rows. Fixing those first gives the
most clarity per rename.

These counts are the names in the code when the sweep ran. The four rows added
on 2026-10-24 for the owner's plan picks (`Criterion.read`, `Property.id`,
`Property.stories`, the `checked` fact) are not in them, and `Line.key`, marked
two-ideas after the pick of `p1` for a property, is counted as ok.

## The ten worst clashes

1. **`Check`** is a move (code judges an output), plan's `{how, what}` on
   every criterion, the asks core's `CheckAsk`, and a record's `check` command.
   `planProblems` is typed `Check<PlanDraft, Known>` in the folder that exports
   the value `Check`. Picked 2026-10-24: plan's value goes, so in plan
   `Check` is only the move.
2. **`ask`** is an outcome verb, the ledger record waiting on a person, a
   question's text (`RulingAsk.ask`), the combo `createAsk`, and (until the
   pick) every machine's input type.
3. **`Facts` and `readFacts`.** `readFacts` is exported three times: plan's
   code facts, the ledger's events, and ship's PR facts. `prFacts` and the
   promise gate's facts make five meanings. Picked 2026-10-24: plan's are
   `CodeContext` now.
4. **`job`** is a task's first criterion in plan, every hosted stage's input
   (`PlanJob` is exported twice), and the host's `jobs` table of timers.
   Picked 2026-10-24: plan's is `scenario` now.
5. **`fold`** is reading the ledger into state (`foldLedger`, `Folded`) and a
   ticket joining a plan (`fold`, `foldsOf`), in the same file.
6. **The tag key.** Nineteen different keys tell union cases apart: `kind`,
   `type`, `phase`, `answer`, `go`, `flow`, `ev`, `how`, `reading`, `do`,
   `on`, `op` and more.
7. **Names exported more than once.** `Verdict` four times; `Built` three;
   `Reviewed`, `PlanState`, `PlanJob`, `Outside`, `Landing`, `Hosting`,
   `Shell`, `Entry`, `Fenced` twice each; `Row` in three places; `Settings` in
   five stages.
8. **`kind`** is every outcome's tag, fabrika's machine type, the ledger row's
   event type, and the lane's `ChildKind`.
9. **`Property`** (picked for `Promise`) clashes with the property's own
   `tool: "property"`, and now means what `law` means. Picked 2026-10-24: the
   tool word is `"test"`, so only the overlap with `law` is left.
10. **Money and tries.** `usd`, `budget`, `cost`, `costUsd`, `spend` name a cap
    or a cost; `tries`, `limit`, `MAX_RUNS`, `DEFAULT_TRIES` name one cap on
    attempts.

Close behind: `Revision` vs `Version`, `at` with five meanings, `kept` with
four, and `stuck:review_failed` vs `send:builder:review_failed`.

## What was picked

The owner picked these on 2026-10-24, and each row says so: `planDraft` →
`draftPlan`, `PlanAsk` → `PlanInput`, `Numbered` → `WithIds`, `Spent` and
`Spend` → `Usage`, `stuck:unchecked` → `stuck:unfixed`, `key` → `session`, and
`Promise` → `Property`. The sweep follows them: every `*Job` and `*Ask` input
becomes `*Input`, and every `spend` key becomes `usage`.

Later the same day the owner settled the rest of plan's names, with the plan
stage's shape ([The plan stage](./direction/the-plan-stage.md), once it
lands):

- Plan's `Check` value goes: `Check` is only the move. A check a tool runs is a
  `Property`; one a reviewer reads is a `Criterion`, with `read` where the
  check's `what` was.
- A property says `when` and `result`, as a criterion does, in place of `says`;
  `why` in place of `harm`; `behavior: "new" | "existing"` in place of
  `is: "new" | "kept"`; `tool: "test" | "tla"`; `stories` in place of
  `serves`; `code` in place of `covers`. Its id is `p1`, `p2`.
- A criterion's `serves` is `stories` too.
- A task's `job` is `scenario`, with a required `fixture`.
- `Facts` → `CodeContext`, `readFacts` → `readCodeContext`, `plan_facts` →
  `plan_code_context`.
- `Revision` stays.
- Held for the glossary pass: `pointers`, `goal`, `at`, `Claim`, and calling a
  revision's number `version`.

## The marks

- `ok`: ours is the industry's.
- `differs`: the industry has a different name for this.
- `two-ideas`: one word means two things in this repo.
- `two-words`: two words mean one idea.
- `collides`: it shadows or clashes with a JS, TypeScript or Effect built-in.

A proposal is given only where the mark is not `ok`. A confidence under 80%
is a lean, and the "could not settle" list at the end says what would lift it.
Every schema key a reader sees has its own row, written `Type.key`.

## 1. Plan

`packages/pipeline/src/stages/plan/`, and the criteria book's `Version` that
plan's ids use.

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Plan` | a ticket's plan, every task, criterion and question under its id | plan; a decomposed epic ([Atlassian, epics](https://www.atlassian.com/agile/project-management/epics)) | ok | |
| `Plan.summary` | the plan in one paragraph | summary; Jira calls the issue title "Summary" ([Atlassian, issue types](https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-types/)) | ok | |
| `Plan.stories` | who the ticket is for, never empty | user stories ([Mountain Goat](https://www.mountaingoatsoftware.com/agile/user-stories)) | ok | |
| `Plan.tasks` | the tasks, in the order they are done | tasks or sub-tasks ([GitHub, sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)) | ok | |
| `Plan.goal` | the plan's own job and criteria, held only when every task is in | epic-level acceptance criteria ([SAFe, epic](https://scaledagileframework.com/epic/)) | differs | see `Goal` |
| `Plan.pointers` | files a builder may start from | see `Pointer` | differs | see `Pointer` |
| `Plan.questions` | product calls the ticket leaves open | open questions ([MADR](https://adr.github.io/madr/)) | ok | |
| `PlanDraft` | the plan as the planner writes it, with no ids | draft | ok | |
| `planDraft` | the Draft move that writes a `PlanDraft`: told apart from the schema only by case | a Cmd is a verb in Elm ([Elm guide, commands](https://guide.elm-lang.org/effects/)) | two-ideas | **picked 2026-10-24:** `draftPlan` |
| `Revision` | a plan's next words, written by code that holds the last version | an update input ([Prisma, partial types](https://www.prisma.io/docs/orm/prisma-client/type-safety/operating-against-partial-structures-of-model-types)); elsewhere a revision is a saved version ([MediaWiki, revision](https://www.mediawiki.org/wiki/Manual:Revision_table)) | two-words | **picked 2026-10-24:** keep `Revision`: each `planned` fact stores one, and the fold gives it ids and makes the `Plan` (`asks/rules.ts`). The lean, `PlanUpdate`, was not taken |
| `Revision.keeps` (task, criterion, question) | the id a next version keeps | supersedes; none standard (searched event sourcing, Prisma, JSON Patch) | ok | |
| `Version` (criteria book) | which wording of a criterion: 1, then one more per reword | version, as an event stream's count ([Marten, appending events](https://martendb.io/events/appending.html)) | ok | keep for a criterion's wording. **held 2026-10-24:** a revision's number is called `version` too (`PlanAsk.version`, `Approved.version`); the glossary pass decides |
| `Story` | one kind of user the ticket touches | user story, "As a ‹role›, I want ‹goal›, so that ‹benefit›" ([Mountain Goat](https://www.mountaingoatsoftware.com/agile/user-stories)) | ok | |
| `Story.id` | `s1`, `s2`: short, stable | story key; none standard | ok | |
| `Story.who` | the role | role (same source) | ok | |
| `Story.want` | what they want | goal (same source) | ok | |
| `Story.why` | so that | benefit (same source) | ok | `why` is "reason" everywhere in the repo |
| `Story.from` | the ticket the story came from; absent, the plan's own | source issue; none standard | ok | |
| `Task` | one piece of a plan, done in order | task or sub-task ([Atlassian, issue types](https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-types/)) | two-ideas | the task machine's state type is also `Task`; that one moves (section 3) |
| `Task.id` | `t1`, `t2`, given by the criteria book | issue key | ok | |
| `Task.title` | the task in a line | title ([GitHub REST, issues](https://docs.github.com/en/rest/issues/issues)) | ok | |
| `Task.ends` | what the task ends in: `"pr"` or `"answer"` | a story vs a spike ([Extreme Programming, spike](http://www.extremeprogramming.org/rules/spike.html)) | differs | keep `ends`; `"answer"` → `"spike"`, so a reader finds the prior art. 60% |
| `Task.job` | the task's first criterion | see `Job` | two-ideas | **picked 2026-10-24:** `scenario`, see `Job` |
| `Task.criteria` | the single claims after the job | acceptance criteria ([Atlassian](https://www.atlassian.com/work-management/project-management/acceptance-criteria)) | ok | |
| `Criterion` | one observable claim, "When ‹when›, ‹result›" | acceptance criterion in Given/When/Then form ([Cucumber, Gherkin](https://cucumber.io/docs/gherkin/reference/)) | two-ideas | **picked 2026-10-24:** `Criterion` is a check a reviewer reads at review, and it ends with the ticket. A check a tool runs is a `Property` (section 2). Review's `pack.ts` still exports another `Criterion` (section 5) |
| `Criterion.id` | `c1`, `c2`, kept for life by the criteria book | none standard | ok | |
| `Criterion.version` | which wording it is at | see `Version` | ok | |
| `Criterion.when` | the trigger, without "When" | When (Gherkin) | ok | |
| `Criterion.result` | what someone can observe | Then (Gherkin) | differs | **picked 2026-10-24:** keep, and a `Property` says `when` and `result` too |
| `Criterion.check` | how someone will see it hold | see `Check` | two-ideas | **picked 2026-10-24:** goes with `Check`; `read` takes its place |
| `Criterion.read` | what the reviewer reads to see it hold: the old check's `what` | inspection, a verification method (NASA SE handbook, 5.3) | ok | **picked 2026-10-24:** new key |
| `Criterion.serves` | the stories it serves, never empty | traceability, "satisfies" ([Wikipedia, requirements traceability](https://en.wikipedia.org/wiki/Requirements_traceability)) | differs | **picked 2026-10-24:** `stories`, as a `Property` says. The lean, keep `serves`, was not taken |
| `Job` / `PlanJob` | a task's first criterion: the user's whole job on a realistic fixture | a scenario ([Cucumber, Scenario](https://cucumber.io/docs/gherkin/reference/#scenario)); the user's job is jobs-to-be-done ([HBR, 2016](https://hbr.org/2016/09/know-your-customers-jobs-to-be-done)) | two-ideas | **picked 2026-10-24:** key `scenario`, one main scenario per task. It is a `Property` when a tool can check it and a `Criterion` when only a reader can, with a `fixture`. So no `Job` type is left. The host's `jobs` table and every job queue ([BullMQ, jobs](https://docs.bullmq.io/guide/jobs)) mean a scheduled unit of work |
| `Job.fixture` | the realistic case it runs on | test fixture; Gherkin's Given ([Wikipedia, test fixture](https://en.wikipedia.org/wiki/Test_fixture)) | ok | **picked 2026-10-24:** keep, required on every scenario |
| `Check` | how someone will see a criterion hold | verification method: test, analysis, inspection, demonstration ([NASA SE handbook, 5.3](https://www.nasa.gov/reference/5-3-product-verification/)) | two-ideas | **picked 2026-10-24:** plan's `Check` goes; "Check" is only the move in `primitives.ts`. Who checks it says which type a check is: a tool, a `Property`; a reviewer, a `Criterion`. The lean, `Verification`, was not taken |
| `Check.how` | `test`, `typecheck`, `run` or `read` | the four methods (same source) | differs | **picked 2026-10-24:** goes with `Check`. `test` is a `Property`'s `tool`, `read` is a `Criterion`. `typecheck` and `run` have no place yet (not picked) |
| `Check.what` | what the check does; for `run`, the command | procedure | ok | **picked 2026-10-24:** a `Criterion`'s `read` |
| `Pointer` | a file, function or test a builder may start from; binds nobody | none found as a standard term (searched Agile, Linear, GitHub issue forms); "pointer" is a memory address in C | differs | `Hint`, key `hints`. 50%: no source for either. **held 2026-10-24** for the glossary pass |
| `Pointer.at` | the place | location | ok | |
| `Pointer.why` | why it matters | reason | ok | |
| `Question` | a product call the ticket leaves open, written with a lean | considered options and a recommendation ([MADR](https://adr.github.io/madr/)) | ok | |
| `Question.id` | `q1`, `q2`, never given twice | none | ok | |
| `Question.ask` | the question's words | the question | two-ideas | `text`: `ask` is also an outcome verb and the ledger's waiting question. 55% |
| `Question.options` | the choices | considered options (MADR) | ok | |
| `Question.lean` | the choice the plan is written with | recommendation; MADR's "decision outcome" | differs | keep: plain, and says it is not decided. 65% |
| `Question.why` | why that lean | rationale (MADR) | ok | |
| `Goal` | the plan's own job and criteria; absent on a one-task plan | epic-level acceptance criteria (SAFe); "goal" is the story template's "I want ‹goal›" | differs | `whole`, or keep `goal`. 45%: no clean industry word. **held 2026-10-24** for the glossary pass |
| `Goal.job` | the plan's whole job | scenario | two-ideas | **follows the pick:** `scenario`, as a task's. Not picked for the goal itself |
| `Goal.criteria` | the plan's single claims | acceptance criteria | ok | |
| `withIds` / `numbered` / `Numbered` | give every task, criterion and question its id | assign identity ([Fowler, Evans classification](https://martinfowler.com/bliki/EvansClassification.html)) | two-words | **picked 2026-10-24:** `Numbered` → `WithIds`; `withIds` stays, `numbered` folds into it |
| `Numbered.plan` / `.book` / `.events` | the plan under ids, the book after it, the events between | aggregate and its events ([Fowler, event sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)) | ok | |
| `revisionOf` / `revisionOfDraft` / `keptFrom` | turn a plan or a draft into a next version | follows `Revision` | differs | **follows the pick:** keep, as `Revision` is kept |
| `PlanAsk` | the plan machine's input | workflow input ([Temporal, workflow parameters](https://docs.temporal.io/workflows#parameters)); Elm's flags ([Elm guide, flags](https://guide.elm-lang.org/interop/flags.html)) | two-ideas | **picked 2026-10-24:** `PlanInput` |
| `PlanAsk.ticket` | the ticket's url | issue url | ok | |
| `PlanAsk.tries` | the most drafts the Check may send back for | attempts ([Temporal, retry policy](https://docs.temporal.io/encyclopedia/retry-policies)) | two-words | build says `MAX_RUNS`; pick one (section 3) |
| `Spent` (plan) / `Spend` (fabrika) | what the planner's runs cost | usage ([Anthropic API, messages](https://docs.anthropic.com/en/api/messages)) | two-words | **picked 2026-10-24:** both → `Usage`, one type, in fabrika |
| `Spent.costUsd` | dollars | cost; `total_cost_usd` in the Agent SDK result ([Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-typescript)) | ok | |
| `Spent.tokens` | tokens | tokens (same source) | ok | |
| `Spent.context` | the conversation's size at its last turn | context window ([Anthropic, context windows](https://docs.anthropic.com/en/docs/build-with-claude/context-windows)) | collides | `window`: only a key, but `Context` is Effect's service map. 50% |
| `Spent.turns` | agent turns | turns (`num_turns`, same SDK) | ok | |
| `Spent.minutes` | wall time | duration (`duration_ms`, same SDK) | ok | |
| `PlanReport` | what a run leaves besides its outcome | result ([Temporal, workflows](https://docs.temporal.io/workflows)) | ok | |
| `PlanReport.plan` | the plan that passed, or the last one | output | ok | |
| `PlanReport.problems` | what the Check still found, in sentences | problems ([VS Code, Problems panel](https://code.visualstudio.com/docs/editor/editingevolved#_errors-warnings)) | ok | |
| `PlanReport.tries` | drafts used | attempts | two-words | follows `tries` |
| `PlanReport.facts` | facts were gathered and handed over | see `Facts` | two-ideas | follows the `CodeContext` pick; the key's word is not picked |
| `PlanReport.spend` | what the runs cost | usage | two-words | follows the `Usage` pick: `usage`. 80% |
| `PlanTicket` | a ticket as the planner reads it | issue ([GitHub REST, issues](https://docs.github.com/en/rest/issues/issues)) | ok | decided 2026-10-24: the ticket comes from our tracker, a ledger fact, not a GitHub issue; its fields follow the tracker's ticket |
| `PlanTicket.url`, `.number`, `.state`, `.title`, `.body` | the issue's fields | the same names (same source) | ok | |
| `PlanTicket.at` | the commit to read the code at; `null`, the clone's own | a ref ([git glossary, ref](https://git-scm.com/docs/gitglossary)) | differs | `ref`. 50%. **held 2026-10-24** for the glossary pass |
| `Facts` / `PlanFacts` / `readFacts` | what the code says about the names and paths a ticket mentions | retrieved context ([Anthropic, contextual retrieval](https://www.anthropic.com/engineering/contextual-retrieval)); the ledger's facts are Datomic's word for stored events ([Datomic, data model](https://docs.datomic.com/whatis/data-model.html)) | two-ideas | **picked 2026-10-24:** `Facts` → `CodeContext`, `readFacts` → `readCodeContext`, the Cmd `plan_facts` → `plan_code_context`; the ledger keeps `Fact`. The service `PlanFacts` follows; its new name is not picked. The lean, `CodeFacts`, was not taken |
| `Facts.text` | what code found, as the planner reads it | none needed | ok | |
| `Facts.names` | the names a user of the published packages meets | public API names ([API Extractor](https://api-extractor.com/pages/overview/intro/)) | differs | follows `userNames` |
| `Settings` (plan; review has its own copy) | how the planner may run | run options | ok | one shared type would do |
| `Settings.model` | the model id | model ([Anthropic API, messages](https://docs.anthropic.com/en/api/messages)) | ok | |
| `Settings.effort` | `low`, `medium`, `high` | effort (Claude's effort setting) | ok | |
| `Settings.budget` | the dollars one run may cost | budget (`maxBudgetUsd`, Agent SDK) | ok | |
| `PlanHost` | reads the ticket (GitHub, or the replay set) | issue tracker; fabrika's `host` runs programs ([Erlang, applications](https://www.erlang.org/doc/system/applications.html)) | two-ideas | `PlanTickets` or `TicketSource`. 65%. It reads from our tracker now (decided 2026-10-24) |
| `Planner` / `livePlanner` | the one agent inside plan | planner, in plan-and-execute agents ([LangChain, planning agents](https://blog.langchain.dev/planning-agents/)) | ok | |
| `Brief` | what the planner is handed | prompt context | ok | |
| `Brief.ticket` | the ticket | issue | ok | |
| `Brief.facts` | what code found, as text; `null`, nothing | retrieved context | two-ideas | follows the `CodeContext` pick; the key's word is not picked |
| `Brief.names` | the user names a criterion may use | public names | differs | follows `userNames` |
| state `key` | the conversation's name, new each start | session id ([Claude Agent SDK, sessions](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-sessions)) | two-ideas | **picked 2026-10-24:** `session`, as build already says |
| state `phase`: `idle`, `reading`, `gathering`, `drafting`, `over` | where the machine is | state; Elm's Model ([Elm guide](https://guide.elm-lang.org/architecture/)) | ok | |
| state `ask`, `settings`, `ticket`, `asked`, `refining`, `facts`, `spend`, `restarts`, `outcome`, `report` | what each phase holds | none needed | ok | `ask` follows `PlanInput` (`input`); `spend` follows `Usage` |
| `restarts` / `MAX_RESTARTS` | times a restart started the planner over | restart intensity ([Erlang, supervisor](https://www.erlang.org/doc/system/sup_princ.html#maximum-restart-intensity)) | ok | |
| `stuck:unchecked` | the last plan still has problems and the tries are spent | none found; it was checked, and failed | differs | **picked 2026-10-24:** `stuck:unfixed` |
| `ask:owner:questions`, `skip:closed`, `stuck:read_failed`, `draft_failed`, `over_budget`, `cut_off` | plan's other outcomes | the five verbs ([outcome names](./direction/outcome-names.md)) | ok | **picked 2026-10-24:** `ask:owner:questions` goes. Plan has no ask of its own: it answers `done`, with the questions inside the plan, and the parent asks the owner once per plan version. The rest stay |
| `Planned` | how one plan ended | workflow result | ok | |
| `Planned.ticket`, `.outcome`, `.name` | the ticket, the outcome, its printed name | none needed | ok | |
| `planProgram`, `planToTheEnd` | the program, and a run to its end | workflow | ok | `planKind` is the `kind` question, section 9 |
| `Line` | one thing an owner can approve, change or name | none needed | ok | |
| `Line.key` | its id: `summary`, `s1`, `t1`, `c1`, `q1`, `p1` | key | two-ideas | `p1` is a pointer's line today, and a property's id is `p1` now (picked 2026-10-24). One of them moves; not picked |
| `Line.text` | its words | text | ok | |
| `Line.criterion` | the criterion it is, or `null` | none needed | ok | |
| `Changed` | what changed between two versions | a diff ([git diff](https://git-scm.com/docs/git-diff)) | ok | |
| `Changed.added` / `.removed` / `.reworded` / `.same` | lines added, removed, said otherwise, unchanged | added, deleted, modified (git) | ok | `reworded` is git's word for an edited message ([git rebase](https://git-scm.com/docs/git-rebase)) |
| `Reworded.key` / `.was` / `.now` | one criterion's old and new words | before and after | ok | |
| `userNames` / `Published` | every name a package shows its users | public API surface ([API Extractor](https://api-extractor.com/pages/overview/intro/)) | differs | `publicNames`. 60% |
| `Published.manifest` / `.docs` | the parsed `package.json`, and each doc page | manifest ([npm, package.json](https://docs.npmjs.com/cli/v10/configuring-npm/package-json)) | ok | |
| `Claim` (local) / `claimFields` / `claimProblems` | one criterion's words | assertion; the ledger's `claims.ts` means a held ticket (a lease) | two-ideas | `Statement`. Local type, low cost. 50%. **held 2026-10-24** for the glossary pass |
| `Known` | the user names known, or `null` | none needed | ok | |
| `PlanCmd`, `RunSub` | the machine's Cmds and its Sub | Cmd and Sub ([Elm guide, subscriptions](https://guide.elm-lang.org/effects/time.html)) | ok | |

## 2. The verify writer and promises

Not built yet as a stage. The names come from
[Promises in the pipeline](./direction/promises-in-the-pipeline.md) and from
`packages/promises/`, the record and gate built in experiment 117, whose names
a promise stage would inherit.

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Promise` (sketch type) | a criterion that lasts after the ticket closes: what the code always does | a property, safety or liveness ([learn TLA+, temporal properties](https://learntla.com/core/temporal-logic.html)); JS's own `Promise` ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)) | collides | **picked 2026-10-24:** `Property`: a check a tool runs, which lasts as a test after the ticket closes. Its tool word is `"test"` now, so the clash with `tool: "property"` is gone (see that row) |
| promise vs law | a promise is a lasting rule on the code; a law is a rule a machine must always keep ([every machine has laws](./direction/every-machine-has-laws.md)), and the record's `check` runs a law | both are properties of the system | two-words | decide whether a property is "a law the owner approved". If yes, one word. 50%: a property can span machines, a law sits on one |
| `Promise.says` | the property in one plain sentence | statement | two-words | **picked 2026-10-24:** `when` and `result`, the words a `Criterion` uses, so the two differ only in who checks them. The lean, `says`, was not taken |
| `Promise.harm` | what goes wrong for someone if it breaks | failure effect ([FMEA](https://en.wikipedia.org/wiki/Failure_mode_and_effects_analysis)) | ok | **picked 2026-10-24:** `why` |
| `Promise.is` | `"new"` or `"kept"` | none for the key; a discriminant is `kind` in our outcomes | differs | **picked 2026-10-24:** `behavior: "new" \| "existing"`. The lean, `kind`, was not taken |
| `"new"` | the ticket adds it; its check must be red on today's code | a new test written red first ([Fowler, TDD](https://martinfowler.com/bliki/TestDrivenDevelopment.html)) | ok | **picked 2026-10-24:** keep. Its test must fail on today's code first |
| `"kept"` | today's code must already keep it, and the ticket must not break it | a regression test ([Wikipedia](https://en.wikipedia.org/wiki/Regression_testing)); a characterization test ([Wikipedia](https://en.wikipedia.org/wiki/Characterization_test)) | two-ideas | **picked 2026-10-24:** `"existing"`. Its test must pass on today's code, and its lines are what the mutation step tests. The lean, `"regression"`, was not taken |
| `Promise.tool` | which kind of check keeps it: `property`, `tla`, `proof` (the record adds `search`) | model checking ([Wikipedia](https://en.wikipedia.org/wiki/Model_checking)), property-based testing ([fast-check](https://fast-check.dev/docs/core-blocks/properties/)), proof | ok | **picked 2026-10-24:** `"test" \| "tla"`. No `"proof"` until something runs proofs. Who picks the tool is open (experiment 139) |
| `tool: "property"` | a property-based test | property-based test (same source) | two-ideas | **picked 2026-10-24:** `"test"`. The lean, `"pbt"`, was not taken |
| `Promise.covers` / `Covers` / `Piece` | the code a property is about, by file and top-level name | coverage; Stryker's `coveredBy` ([Stryker, mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)) | ok | **picked 2026-10-24:** key `code` |
| `Property.id` | `p1`, `p2`: a property's id in the criteria book, kept across plan versions by `keeps`, as a criterion's is | none standard | ok | **picked 2026-10-24:** prefix `p`. It clashes with a pointer's line key `p1` (section 1, `Line.key`) |
| `Property.stories` | the stories it serves | traceability (section 1, `Criterion.serves`) | ok | **picked 2026-10-24:** `stories`, as a `Criterion` says |
| `checked` (fact) | a tool's result on one property: property, version, head, tool, result | a check run's conclusion ([GitHub REST, check runs](https://docs.github.com/en/rest/checks/runs)) | two-ideas | **picked 2026-10-24:** the fact, not a review row. Its `result` (how the check came out) and a property's `result` (what someone sees) are one word for two ideas; not picked |
| record `promise` | the sentence (the sketch's `says`) | statement | two-words | not picked. The plan's `Property` says it as `when` and `result` now, so the lean `says` matches nothing |
| record `harm`, `tool`, `covers` | as in the sketch | as above | ok | not picked. The plan's `Property` says `why`, `tool: "test" \| "tla"` and `code` now; the record's `tool` still has `search`, `property` and `proof` |
| record `check` | the command that runs the check | test command | two-ideas | `command`: `check` is also the move and plan's `Check`. 70% |
| record `plant` | the break planted to show the check can fail | see `Plant` | two-words | see `Plant` |
| record `exam` | the check itself: law, plant, world, checker; a change asks the owner | test oracle ([Wikipedia](https://en.wikipedia.org/wiki/Test_oracle)) | differs | keep: "nobody writes their own exam" is a rule people already quote. 60% |
| record `confirmed` | when someone last said the check still describes the code | snapshot update ([Jest, snapshot testing](https://jestjs.io/docs/snapshot-testing)) | ok | |
| `Confirmed.commit` | the commit the confirm ran at | commit | ok | |
| `Confirmed.prints` | one hash per piece | fingerprint ([Wikipedia](https://en.wikipedia.org/wiki/Fingerprint_(computing))) | ok | short for fingerprint |
| `Plant` / planted break / `PROMISE_PLANT` | a hand-written break that shows a check can fail | fault seeding, also bebugging ([Wikipedia](https://en.wikipedia.org/wiki/Bebugging)); a mutant when a tool makes it | two-words | `seeded fault` for the hand-made one, `mutant` for the tool's. 60% |
| `Plant.name` / `.what` | its name, and what it breaks | none needed | ok | |
| `Entry` (promises) | one property record | record; `Entry` is also in the criteria book and the ledger | two-ideas | `PropertyRecord`. 65% |
| `Verdict` (promises) | what a check command prints last | result | two-ideas | `CheckResult`. Three other `Verdict`s exist. 60% |
| `Verdict.held` | did the property hold | pass or fail | ok | |
| `Verdict.checked` | what it checked: a law's name | property name | ok | |
| `Verdict.plant` | the plant it ran on, or `null` | seeded fault | two-words | follows `Plant` |
| `Verdict.bound` | how far it looked | bound, as in bounded model checking ([Wikipedia, model checking](https://en.wikipedia.org/wiki/Model_checking)) | ok | |
| `Verdict.path` | the shortest breaking sequence | counterexample ([fast-check, properties](https://fast-check.dev/docs/core-blocks/properties/)) | differs | `counterexample`. 70% |
| `Verdict.why` | why it gave no clean answer | reason | ok | |
| `Ran` (promises) | how one run of a check command went | result | two-ideas | `Run`; review's `Ran` is a cost record. 55% |
| `Ran.kind`, `.verdict`, `.why`, `.ms` | verdict or none, the verdict, why none, how long | none needed | ok | |
| `Facts` (promises `judge.ts`) | what the gate read about one record | input | two-ideas | `Gathered`; a third meaning of facts. 55% |
| `Facts.id`, `.entry`, `.before`, `.now`, `.check`, `.plant` | the record's id, the record, the base record, prints at the head, the two runs | none needed | ok | `now` → `prints`, to match `Confirmed.prints`. 50% |
| `judge` / `Judged` | the pure gate over one record | gate; Judge is also a move (a small classifier) | two-ideas | `gate`, `Gated`. 70% |
| `Judged.id`, `.entry`, `.green`, `.problems`, `.exam`, `.moved`, `.check`, `.plant` | what the gate found on one record | none needed | ok | `moved` means "confirmed again": `reconfirmed`. 55% |
| `Problem.why`: `gone`, `stale`, `red`, `not_caught`, `no_verdict` | why a record fails the gate | Stryker's states: Killed, Survived, NoCoverage (same Stryker page) | ok | `not_caught` is Stryker's Survived for a plant |
| `Problem.pieces`, `.commit`, `.verdict`, `.which`, `.detail` | which pieces, since which commit, the verdict, which run, what went wrong | none needed | ok | |
| `Removed.id` / `.promise` | a property in the base and not at the head | none needed | ok | `promise` follows `says` |
| verify writer | the agent, not the builder, that writes each check before the build | test generator in Meta's ACH ([Meta, 2025](https://arxiv.org/abs/2501.12862)); evaluator in an evaluator-optimizer loop ([Anthropic, building effective agents](https://www.anthropic.com/engineering/building-effective-agents)) | differs | **picked 2026-10-24:** test writer, outcome `send:test_writer:mutant_survived` ([The test writer](./direction/the-test-writer.md)) |
| `writeChecks` / `checks_write`, `checks_today`, `checks_hold`, `checks_kill_mutants` | the steps that write and run the property checks | tests or specs; "check" is also the move and a GitHub check run | two-ideas | **picked 2026-10-24:** `tests_write`, `tests_on_base`. "Check" is now only the move's name |
| red first | a new property's check fails on today's code | red, green, refactor ([Fowler, TDD](https://martinfowler.com/bliki/TestDrivenDevelopment.html)) | ok | |
| `in step` / `checks_in_step` | every record's prints match the code | no drift; none standard | ok | |
| `mutant`, kill, survived, equivalent mutant | mutation testing's words | the same ([Stryker, introduction](https://stryker-mutator.io/docs/stryker-js/introduction/)) | ok | |
| skip list | kinds of mutant left out, such as log text | Stryker ignorers ([Stryker, configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)); Google's arid nodes | differs | `ignore list`, Stryker's own word. 75% |
| disable comment | `// Stryker disable` on one line, with a reason | the same ([Stryker, disable mutants](https://stryker-mutator.io/docs/stryker-js/disable-mutants/)) | ok | |
| `ask:owner:already_kept`, `ask:owner:not_kept` | the plan was wrong about today's code | none found | differs | **picked 2026-10-24:** `ask:owner:already_passes`, `ask:owner:fails_on_base`, and a new `ask:owner:cannot_test` |
| `ask:owner:check_change` | a diff touches a check | change to the test oracle | ok | |
| `send:builder:promise_red` | ship found a property red or out of step | failed required check | differs | **follows the pick:** `property_red` |

## 3. Build

`packages/pipeline/src/stages/build/` (one ticket, one pull request) and
`stages/task/` (one task of a plan, a commit on the plan's branch).

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Built` (`form.ts`) / `Built` (`program.ts`) | the builder's form at the end of its run; and the program's answer for one build | none for the pair: two exports, one name, two shapes | two-ideas | the form → `BuildForm`; the answer → `BuildResult`. 80% |
| form `summary` | what the change does: the pull request's text | PR description ([GitHub, about pull requests](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-pull-requests)) | ok | the same idea as plan's summary |
| form `deviations` | where the change departs from the ticket, and why | deviations | ok | |
| form `ran` | each command it ran, and whether it passed | test run | two-ideas | `commands`: `ran` in the report is a cost record. 65% |
| `ran.command` / `ran.passed` | the command, pass or fail | none needed | ok | |
| form `left` | what it could not do | known limitations | ok | |
| result `ticket`, `round`, `outcome`, `name` | the program answer's own keys | none needed | ok | |
| `PlanState` (`build/ticket.ts`) | how a ticket's plan stands on the ledger: `approved`, `not_approved`, `none`, `unknown` | approval status ([GitHub, review states](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews)) | two-ideas | `PlanApproval`. `PlanState` is also plan's machine state. 80% |
| `readTicket` | a Gather in plan and in build, and a plain read in `build/ticket.ts` | none needed | two-ideas | `planTicket`, `buildTicket` as Cmds; the helper stays `readTicket`. 60% |
| `BuildAsk` / `TaskAsk` | the machine's input | workflow input | two-ideas | `BuildInput`, `TaskInput`, after plan's pick. 85% |
| `BuildAsk.ticket`, `.number` | the ticket url and number | issue url and number | ok | |
| `BuildAsk.round` / `TaskAsk.round` | which review-and-build pass, 1 first | iteration; review round | ok | |
| `BuildAsk.open` / `TaskAsk.open` | what the last review left open | unresolved review threads | ok | |
| `TaskAsk.plan` / `.task` | the plan and task ids | none needed | ok | |
| `Build` / `Task` (state types) | the build and task machines' state | Elm's Model; plan says `PlanState` | two-ideas | `BuildState`, `TaskState`. `Task` is also plan's task schema. 85% |
| state `session` | the builder's conversation id | session id ([Claude Agent SDK, sessions](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-sessions)) | ok | |
| state `copied`, `built`, `ran`, `runs`, `criteria` | what each phase holds | none needed | ok | `ran` follows the `Ran` row |
| `Task` (the machine) | builds one task of an approved plan onto the plan's branch | a sub-task ([GitHub, sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)) | ok | keep, once the state type moves |
| `Item` | one thing a review left open, told to the next round | an unresolved review thread ([GitHub, commenting on a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/commenting-on-a-pull-request)); a finding | differs | `Finding`. 65% |
| `Item.criterion` | the criterion it is, or `null` | none needed | ok | |
| `Item.text` | the criterion's words | none needed | ok | |
| `Item.says` | why it is open, in the reviewer's words | comment body | ok | matches the property's `says` |
| `Item.where` | `file:first-last` | location (a review comment's `path` and `line`) | ok | |
| `Item.wants` | what has to be true for it to close | suggested change | ok | |
| `BuildBrief` / `briefOf` | what one builder run is handed | prompt context | ok | |
| `BuildBrief.ticket`, `.number`, `.title`, `.body` | the issue | the same names ([GitHub REST, issues](https://docs.github.com/en/rest/issues/issues)) | ok | |
| `BuildBrief.criteria` | the criteria to build to | acceptance criteria | ok | |
| `BuildBrief.round`, `.open` | as in the input | as above | ok | |
| `BuildBrief.rules` | the repo's own rules for agents | agent instructions, `AGENTS.md` ([agents.md](https://agents.md/)) | ok | |
| `BuildBrief.tree` | the working copy | working tree ([git glossary](https://git-scm.com/docs/gitglossary)) | ok | |
| `BuildBrief.branch` | the ticket's branch | branch | ok | |
| `BuildBrief.session` | the round's conversation | session id | ok | plan's `key` now follows this |
| `Ticket` (build) | the ticket, read whole | issue | ok | |
| `Ticket.url`, `.number`, `.state`, `.title`, `.body` | the issue's fields | the same names | ok | |
| `Ticket.criteria` | its criteria under their ids; `null` would need a guess | acceptance criteria | ok | |
| `Ticket.prs` | pull requests from its branch, newest first | linked pull requests | ok | |
| `Ticket.rules` | the repo's rules for agents | as above | ok | |
| `Ticket.plan` | how its plan stands | approval status | two-ideas | `approval`, after `PlanApproval`. 75% |
| `Opened` | a pull request from the branch | pull request | differs | `Pr`: "opened" is an event name. 55% |
| `Opened.url`, `.state`, `.head` | the PR's url, state (`open`, `closed`, `merged`), head commit | the same names ([GitHub REST, pulls](https://docs.github.com/en/rest/pulls/pulls)) | ok | |
| `Copied` / `copyTree` | a working copy made for one ticket | git worktree ([git worktree](https://git-scm.com/docs/git-worktree)) | ok | `copyTree` → `makeTree`, since it may find an old one. 50% |
| `Copied.tree`, `.branch` | where, on which branch | working tree, branch | ok | |
| `Copied.base` | the commit it stood at when the round began | base commit (a PR's `base`) | ok | |
| `Pushed.head` / `.changed` | the branch's commit after the push; whether a commit was added | head | ok | |
| `BuildReport` / `TaskReport` | what a build leaves besides its outcome | result | ok | |
| `BuildReport.pr`, `.head`, `.changed` | the PR, the head, whether this round added a commit | none needed | ok | |
| `BuildReport.built` | the builder's form | follows `BuildForm` | two-ideas | `form`. 70% |
| `BuildReport.ran` | what the builder's last run cost | usage | two-ideas | `usage`, after the `Usage` pick: today the form's `ran` is commands and this `ran` is cost. 75% |
| `BuildReport.runs` / `TaskReport.runs` | builder runs used | attempts | two-words | follows `MAX_RUNS` |
| `BuildReport.problems` / `TaskReport.problems` | why it stopped, in words | problems | ok | |
| `Ran` (review's, used by build) | a run's cost, tools, refusals and removed links | usage plus a tool log | two-ideas | `Run`. 55% |
| `Ran.spend` / `.tools` / `.refused` / `.links` | the cost, tools called, calls refused, symlinks removed before the run | usage; tool calls | two-words | `spend` → `usage`. 80% |
| `done` keys `pr`, `head`, `changed` (build); `head`, `changed` (task) | the outcome's own data | none needed | ok | |
| `Commit` | the commit message, as parts | commit message ([git commit](https://git-scm.com/docs/git-commit)) | ok | |
| `Commit.title`, `.round`, `.summary` | the ticket's title, the round, the builder's summary | subject and body | ok | |
| `Commit.refs` | the ticket, named without a closing word | issue reference ([GitHub, autolinked references](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls)) | ok | |
| `PrBody` | the pull request's text, as parts | PR description | ok | |
| `PrBody.closes` | the one ticket it closes | closing keyword ([GitHub, linking a PR to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)) | ok | |
| `PrBody.round`, `.summary`, `.deviations`, `.ran`, `.left` | as in the form | as above | ok | `ran` follows the form's pick |
| `answer` (in `BuildGate`, `BuildDrafted`) | the tag that says which case a union is | a discriminant: `_tag` in Effect ([Effect, Data](https://effect.website/docs/data-types/data/)); `kind` in outcomes | two-words | `kind`, as outcomes use. 60%: Effect's `_tag` is the other choice |
| `BuildGate` / `buildGate` / `TaskGate` / `taskGate` | a pure Check before work: go, or the one reason not to | a guard ([XState, guards](https://stately.ai/docs/guards)) | differs | keep `gate`: ship's gate is the same idea. 60% |
| `BuildGate.criteria` / `.outcome` | the criteria to go on with; the outcome to stop with | none needed | ok | |
| `guard` / `guarded` / `HOLD` / `HELD` / `lockOf` | a lock and a timeout around the builder's commands | a file lock or mutex ([Wikipedia, file locking](https://en.wikipedia.org/wiki/File_locking)) | two-ideas | `lock`, `locked`: "guard" is the state-machine word for a gate. 70% |
| `harness` / `HARNESSES: sdk, acp` / `builderHarness` | what runs the agent | agent harness | ok | |
| `Verdict` / `verdictOf` (`builder-acp.ts`) | how one permission ask was answered | permission decision ([ACP, tool calls](https://agentclientprotocol.com/protocol/tool-calls)) | two-ideas | `Permission` / `permissionOf`. A fourth `Verdict`. 75% |
| `Verdict.allow` / `.tool` / `.why` | allowed or not, which tool, why refused | `allow` / `deny` options (same source) | ok | |
| `answer` (`builder-acp.ts`) | reply to one permission ask | respond | two-ideas | `respond`. 55% |
| `HAND_IN` / `report_build` / `Report` | how the builder hands its form in, as a tool call | structured output via a tool ([Anthropic, tool use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview)) | ok | |
| `checksOf` / `hookSettings` / `Checked` / `builderCheck` / `builderRefusal` | commands the builder ran, logged by a hook; a refusal of a tool call | hooks ([Claude Code, hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)) | two-ideas | `ranOf`, `Ran`: runs, not the Check move. 55% |
| `MAX_RUNS` (build, task) vs `tries` (plan) | the most builder runs in a round | attempts ([Temporal, retry policy](https://docs.temporal.io/encyclopedia/retry-policies)) | two-words | one word everywhere: `tries`. 65% |
| `Failed: broke, misfit, over_budget` | how a builder run failed | crash, invalid output, budget | ok | |
| `inert` / `BREAK` | a zero-width space that stops an `@` mention from notifying | escaping | ok | |
| `branchOf` (`build/<n>`) / `planBranchOf` (`plan/<n>`) | the branch name for a ticket or a plan | branch | ok | |
| `TaskView` / `taskViewOf` | what the ledger says about one task | read model ([Microsoft, CQRS](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)) | ok | |
| `TaskView.ticket`, `.number`, `.title`, `.body`, `.criteria`, `.branch` | the plan's issue and the task's words | as for a ticket | ok | |
| `TaskView.approved` / `.live` / `.closed` | the plan is approved; the task is still in it; the plan was closed | approval; active | differs | `live` → `active`. 50% |
| `TaskView.base` | where the branch stands now, or main | base commit | ok | |
| `Heads.branch` / `.main` | the two heads | heads | ok | |
| `withPlan` / `planStateOf` / `planStateIn` | read how a ticket's plan stands | follows `PlanApproval` | differs | `planApprovalOf`. 75% |
| build `skip:not_ready`; task `skip:not_approved` | no approved plan yet | the same idea, two words | two-words | one word in both: `not_approved`. 75% |
| build `stuck`: `read_failed`, `no_criteria`, `criteria_unknown`, `copy_failed`, `draft_failed`, `over_budget`, `no_change`, `push_failed`, `open_failed` | how a build stops | the five verbs | ok | |
| `buildKind`, `buildProgram`, `buildToTheEnd` | the program and kind | see section 9 | ok | |

## 4. Mutation test

No code in the packages yet. The names come from experiments 119 and 121 to
124 (`experiments/119-mutation-testing.md`, `122-verify-writer-replay.md`,
`123-check-layer-timings.md`, `124-kill-every-survivor.md`) and the outcome
lines in the promises note. A word used only inside one experiment's script is
listed when a write-up or the direction note repeats it.

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| mutation test (the step) | after the build, a tool plants small edits and the checks must catch each | mutation testing ([Stryker, introduction](https://stryker-mutator.io/docs/stryker-js/introduction/)) | ok | |
| mutant / killed / survived | a planted edit; a check failed on it; nothing failed | the same ([Stryker, mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)) | ok | |
| survivor / uncaught | a mutant that lives: survived, or no test ran its line | undetected = Survived + NoCoverage (same Stryker page) | two-words | `undetected` for the set, `survived` for one state, as Stryker splits them. 75% |
| valid mutants | mutants left after the ones the typecheck refuses | valid = all but CompileError and RuntimeError (same Stryker page) | ok | |
| untellable / claimed / "cannot be told apart" / "no test can tell" | a mutant the writer says changes nothing a test can see | equivalent mutant ([Wikipedia, mutation testing](https://en.wikipedia.org/wiki/Mutation_testing)) | two-words | `equivalent`, the field's word, already in the promises note. `claimed` also clashes with the ledger's claim on a ticket. 85% |
| skip list / ignorer `arid` | kinds of mutant left out (error and log text) | Stryker ignorer plugins ([Stryker, configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)); arid nodes ([Google, 2021](https://arxiv.org/abs/2102.11378)) | differs | `ignore list`. 75% |
| disable comment | `// Stryker disable` with a reason; the owner approves it | the same ([Stryker, disable mutants](https://stryker-mutator.io/docs/stryker-js/disable-mutants/)) | ok | |
| round (124) | one Stryker run, then one writer run on what lived | iteration | ok | build's `round` is a review-and-build pass: a third kind of round. Say "writer round" where both meet |
| incremental / `--force` | reuse earlier results / run everything fresh | Stryker's own flags ([Stryker, incremental](https://stryker-mutator.io/docs/stryker-js/incremental/)) | ok | |
| coverage `perTest` | which tests run which mutant | per-test coverage analysis (same Stryker configuration page) | ok | |
| check layer / fast layer (123) | a group of checks run at one moment: every commit, or once a ticket | test levels; pre-commit vs nightly; the test pyramid ([Fowler, test pyramid](https://martinfowler.com/bliki/TestPyramid.html)) | collides | `check tier` or "every-commit checks": `Layer` is Effect's own type and used across the repo. 70% |
| repair round | a build round after a send-back | rework; follows build's `round` | ok | |
| plant (118, 119) | a hand-written break, before Stryker made the mutants | fault seeding ([Wikipedia, bebugging](https://en.wikipedia.org/wiki/Bebugging)) | two-words | see section 2's `Plant` row |
| arm A / arm B, "only ours" (119) | the two checkers compared | treatment arms | ok | only inside one experiment |
| mutation score | killed over valid | the same (Stryker metrics page) | ok | |
| `send:verify_writer:mutant_survived` | a mutant lives; back to the writer | Survived | ok | `verify_writer` follows section 2's pick |
| `ask:owner:check_change` (disable comment, skip list edit) | the diff changes the exam | change to the test oracle | ok | |
| `done` (every mutant killed) | nothing left alive | 100% mutation score | ok | |

## 5. Review

`packages/pipeline/src/stages/review/`.

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Criterion` (`pack.ts`) | one acceptance criterion as the ticket's checkbox shows it | acceptance criterion ([Atlassian](https://www.atlassian.com/work-management/project-management/acceptance-criteria)) | two-ideas | `TicketCriterion`: plan exports a different `Criterion` (when, result, check, serves). 75% |
| `Criterion.id` / `.version` / `.text` | id, wording, words | as in the criteria book | ok | |
| `Criterion.checked` | its box is ticked in the ticket today | task list item checked ([GitHub, task lists](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/about-task-lists)) | two-ideas | `ticked`: "checked" also reads as "the Check ran". 60% |
| `Criterion.evidence` | an `[evidence: …]` mark: where proof lives when the diff cannot show it | evidence | two-words | the finding's key is `proof`, and the book's row says `proof`. One word: `proof`. 60% |
| `Kind` / `TextKind` / `TEXT_KINDS: review-code, review-doc, review-skill` | a kind of review, by today's fabrika's names | review type; a required reviewer ([GitHub, CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)) | two-ideas | `ReviewKind` everywhere (ship's `facts.ts` already says it); `kind` is also the outcome tag and the program `kind`. 75% |
| `ChangedFile` / `.path` / `.kind` | one changed file and the review that reads it | changed file ([GitHub REST, pulls](https://docs.github.com/en/rest/pulls/pulls)) | ok | |
| `Deviations` / `.state: absent, none, listed` / `.text` | the PR text's `## Deviations` section | none standard | ok | |
| `Checks` | the checks the base branch requires, at the head | required status checks ([GitHub, protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)) | two-ideas | `RequiredChecks`: "check" is also the move. 65% |
| `Checks.state: green, red, pending, unknown` | the rolled-up state | combined status: success, failure, pending ([GitHub REST, commit statuses](https://docs.github.com/en/rest/commits/statuses)) | differs | keep: green and red are plain, and the team says them. 65% |
| `Checks.required` / `.name` / `.state` | each required check | check run name and conclusion ([GitHub REST, check runs](https://docs.github.com/en/rest/checks/runs)) | ok | |
| `Change` | what the code host knows about one PR at one commit | pull request | two-ideas | `PrAtHead`: plan's `Changed` is a diff between plan versions. 55% |
| `Change.pr` / `.head` | the PR url and the commit under review | head SHA ([GitHub REST, pulls](https://docs.github.com/en/rest/pulls/pulls)) | ok | |
| `Change.replay` | the caller named an older head | re-review | ok | |
| `Change.state: open, merged, closed, draft` | the PR's state | state and `draft` (same source) | ok | |
| `Change.ticket` / `.id` / `.link: closes_it, part_of_it` | the ticket the PR names | closing keyword ([GitHub, linking a PR](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)) | ok | |
| `Change.criteria` / `.files` / `.kinds` / `.diff` / `.deviations` / `.checks` / `.rules` | the parts of the pack | none needed | ok | `kinds` follows `ReviewKind` |
| `Rubric` / `.kind` / `.text` / `RUBRIC_FILE` | a review kind's rubric | rubric ([Wikipedia, rubric](https://en.wikipedia.org/wiki/Rubric_(academic))) | ok | |
| `Pack` / `readPack` / `gatherPack` / `.rubrics` | everything a reviewer needs, gathered first | review packet | ok | |
| `Ask` (`pack.ts`) `{pr, head, rubrics}` | what the machine is asked | workflow input | two-ideas | `ReviewInput`, after `PlanInput`. 85% |
| `askOf` | a url read as an input | input | two-ideas | `inputOf`. 80% |
| `ReviewTarget` | a PR url, or a PR url and a commit | target | ok | |
| `Brief` (review gate) | what one reviewer run is handed | prompt context | ok | the same idea as plan's `Brief` |
| `Brief.pr`, `.head`, `.ticket`, `.criteria`, `.files`, `.diff`, `.deviations`, `.checks`, `.rubrics`, `.rules` | as in the pack | as above | ok | |
| `Brief.kinds` / `.left` | the text reviews owed; the other kinds owed | required reviews | ok | `left` also means "could not do" in build's form. 50% |
| `ReviewGate` / `reviewGate` `answer: go, wait_for_checks, stop` | go, wait, or the one reason not to | a guard | two-words | `answer` → `kind`, as in build. 60% |
| `Form` | what the reviewer hands back | structured output | ok | build's own form is `Built`; `BuildForm` and `ReviewForm` would pair. 60% |
| `Form.rows` / `.findings` / `.skipped` | graded criteria, problems found, things not looked at | findings ([SonarQube, issues](https://docs.sonarsource.com/sonarqube-server/latest/user-guide/issues/introduction/)) | ok | |
| `Row` (review) | one criterion graded, as the reviewer writes it | review row | two-ideas | `GradedRow`; the criteria book also exports `Row`. 60% |
| `Row.id` | the criterion's id | none needed | ok | |
| `Row.grade: pass, fail, unseen` | the grade | pass or fail; `unseen` has no standard twin | two-words | `Verdict` in `verdict.ts` lists the same three words. One name: `grade`. 60% |
| `Row.where` | the lines that show it | location (`path`, `line` on [GitHub, review comments](https://docs.github.com/en/rest/pulls/comments)) | two-words | `Found.at` names a place too. One word: `at`. 55% |
| `Row.says` | how the reviewer knows | comment body | ok | |
| `Row.limit` | what a pass does not cover; anything but `null` sends the form back | caveat | ok | |
| `Graded` | a row after the Check: a pass is whole | none needed | ok | |
| `Place` / `.file` / `.first` / `.last` | lines of one file at the reviewed commit | `path`, `start_line`, `line` (same GitHub page) | ok | |
| `From` / `.source: criterion, check, rule, deviation` | where a finding came from | finding source | two-words | `source` here, `from` on the story and the judged criterion. One word: `from`. 55% |
| `From.id` / `.name` / `.about` / `.file` / `.rule` | the criterion, the rubric's check, the deviation, the rule file, the rule | none needed | ok | `source: "check"` is a rubric's standing check, one more "check". 50% |
| `Found` | a finding as the reviewer writes it | finding | ok | |
| `Found.kind` | the review kind it belongs to | review type | two-ideas | follows `ReviewKind` |
| `Found.from` | where it came from | see `From` | ok | |
| `Found.fault` | what is wrong | defect ([Wikipedia, software bug](https://en.wikipedia.org/wiki/Software_bug)) | ok | |
| `Found.at` | where the fault is | location | two-words | see `Row.where` |
| `Found.proof` | what shows it | evidence | two-words | see `Criterion.evidence` |
| `Found.wants` | what has to be true for it to close | acceptance condition | ok | |
| `Finding` / `.id` / `.state: open, closed` | a finding on the sheet | an unresolved conversation | ok | build's `Item` is the same idea once the parent passes it on: `Finding` there too. 65% |
| `Skipped` / `.what` / `.why` | something the reviewer did not look at | out of scope | ok | |
| `Sheet` / `.head` / `.rows` / `.findings` / `.skipped` | the form after code checked it, for one commit | review | ok | |
| `formProblems` / `readForm` / `ReadForm` | the pure Check over a form | validation | ok | |
| `Verdict` (`verdict.ts`) `pass, fail, unseen` | a kind's result | review state: approve, request changes ([GitHub, PR reviews](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews)) | two-ideas | keep `Verdict` here, review's own word; rename the other three. 60% |
| `KindVerdict` / `.kind` / `.verdict` | one verdict per review kind | none needed | ok | |
| `Judged` / `TicketJudged` / `ReviewJudged` | each criterion met or open, the ticket's and the review's | requirement status | two-ideas | `Judged` is also the promise gate's result. `CriterionStatus`. 55% |
| `Judged.from: ticket, review` | who made the criterion | none needed | two-words | the book says `by: plan, owner, review` for the same idea: one word, `by`. 55% |
| `Judged.state: met, open` | whether it is met | done or not done | two-words | the book says `met` too, `Row.grade` says pass: two scales on purpose, say so in the glossary. 50% |
| `Judged.id`, `.version`, `.text`, `.says`, `.where`, `.findings` | as above | as above | ok | |
| `Report` (review) | what a review leaves besides its outcome | result | two-ideas | `ReviewReport`, as plan says `PlanReport`; build's `Report` is a tool server. 75% |
| `Report.head`, `.replay`, `.ticket`, `.criteria`, `.rows`, `.verdicts`, `.left`, `.comments`, `.notes`, `.problems` | the review's own fields | none needed | ok | |
| `Report.refusals` | each form code refused, with its problems | validation errors | ok | |
| `Report.ran` | the last run's usage and tools | usage | two-ideas | follows build's `Ran` row |
| `Report.cost` | dollars over every run | cost | two-words | with `Usage`, one place for money. 60% |
| `Report.runs` | times the reviewer was started | attempts | two-words | follows `MAX_RUNS` |
| `Comment` / `.kind` / `.text` / `render` / `HEADINGS` | what would be posted for each kind | PR review comment | ok | |
| `Note` / `.title` / `.body` / `.at` / `file_note` / `fileNote` | a side issue the reviewer saw that this PR did not cause | a follow-up issue | ok | |
| `Kept` (note) / `.state: kept, failed` | a note as the report shows it | filed | two-ideas | `Filed` already exists for the same note, and this is the fourth idea of "kept". `.state: filed, failed`. 75% |
| `Filed` / `.pr`, `.id`, `.title`, `.body`, `.at` | a note as it is filed | issue | ok | |
| `OPENED` / `ToolName` / `Tools` / `openedTools` / `openedServer` | the tools the machine opens to the agent | MCP tools ([MCP, tools](https://modelcontextprotocol.io/docs/concepts/tools)) | ok | |
| `OPENED.*.says` | a tool's description | tool `description` (same source) | differs | `description`, MCP's own key. 60% |
| `Heard: taken, refused` | what a tool call hears back | tool result | ok | |
| `Refused` / `.tool` / `.why` | a tool call the Check refused | permission denied | ok | |
| `Spent` (review's copy) | a run's cost | usage | two-words | the plan pick: `Usage`, one type |
| `Said: note, ended` | what the reviewer's stream says | stream event | ok | |
| `Drafted` | how one reviewer run ended | run result | ok | build says `BuildDrafted`; `ReviewDrafted` pairs. 50% |
| `Settings` / `EFFORTS` / `DEFAULT_MODEL` / `DEFAULT_EFFORT` / `DEFAULT_BUDGET` | how the reviewer may run | run options | ok | a second copy of plan's `Settings` |
| `Waits.checksMs` / `MAX_WAITS` / `DEFAULT_WAITS` / `checksClock` | how long to wait for checks | a timer ([Temporal, timers](https://docs.temporal.io/workflow-execution/timers-delays)) | ok | |
| `DEFAULT_TRIES` / `MAX_RUNS` | forms one review may ask for; runs | attempts | two-words | one word with plan and build. 65% |
| `Review` (state type) | the machine's state | Elm's Model | two-ideas | `ReviewState`. 80% |
| `Reviewed` (`local.ts`) / `Reviewed` (`program.ts`) | an over state; the program's answer | result | two-ideas | exported twice with two shapes: `ReviewResult` for the program's. 80% |
| `Reviewed.pr`, `.outcome`, `.name` | the program answer's keys | none needed | ok | |
| `Plan` (`launch.ts`) `{prs, rubrics, repo, model, effort, budget}` | what a run was asked for on the command line | parsed arguments ([Effect, command](https://effect.website/docs/platform/command/)) | two-ideas | `Args`: `Plan` is the plan stage's main type. 85% |
| `planOf` (`launch.ts`) | read the command line | parse arguments | two-ideas | `argsOf`; `ids.ts` exports a `planOf` from ticket to plan id. 85% |
| `checked` (`launch.ts`) | check the arguments against the program's flags | validate | two-ideas | `validate`. 60% |
| `judgementOf` / `keepRows` | turn a report into the book's round | none needed | ok | `keepRows` → `saveRows`, away from "kept". 50% |
| `reviewTask` (`local.ts`) | run one review locally | none needed | two-ideas | `reviewLocal`: "task" is plan's task. 70% |
| `send:builder:review_failed`, `checks_red`, `no_ticket` | back to the builder | request changes | ok | |
| `skip:merged`, `closed`, `draft` | nothing to review | the PR states | ok | |
| `stuck:unseen` | nothing failed, but a criterion could not be seen | none found | ok | plain, and the grade's own word |
| `stuck:ticket_unknown`, `diff_unknown`, `kinds_unknown`, `rubric_unknown`, `checks_unknown` | a part of the pack could not be read | none found | differs | `stuck:<part>_unread`: "unknown" reads as "we do not know what it is". 50% |
| `stuck:checks_stuck` | a required check kept running past the limit | `timed_out` (same check runs page) | differs | `stuck:checks_timed_out`: "stuck" twice says nothing new. 70% |
| `done` `head`; `done:part` (in the comment) | every text review passed at `head` | approved | ok | the comment still names `done:part`, which the outcome names note says should go |

## 6. Ship

`packages/pipeline/src/stages/ship/`.

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `PrFacts` | what the code host knows about a PR at one commit | pull request ([GitHub REST, pulls](https://docs.github.com/en/rest/pulls/pulls)) | two-ideas | `PrAtHead`, shared with review's `Change`, which is the same idea. "Facts" is the ledger's word. 60% |
| `PrFacts.head` | the commit about to land | head SHA (same source) | ok | |
| `PrFacts.state: open, merged, closed, draft` | the PR's state | state, merged, draft (same source) | ok | |
| `PrFacts.ours` | opened by one of the repo's own accounts | author association ([GitHub GraphQL, CommentAuthorAssociation](https://docs.github.com/en/graphql/reference/enums#commentauthorassociation)) | ok | |
| `PrFacts.ticket` / `Serves` | the ticket the PR names: `none`, or id and link | closing keyword ([GitHub, linking a PR](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)) | two-ideas | `Serves` the type → `Linked`: plan's `serves` key is "the stories a criterion serves". 60% |
| `Serves.id` / `.link: closes_it, part_of_it` | the ticket and how it is named | closes, part of a parent | ok | |
| `PrFacts.approval: not_needed, given, missing, unknown` | an owner's approval on protected files | code owner review ([GitHub, CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)) | ok | |
| `PrFacts.reviews` / `ReviewKind` | each review kind needed, and how it stands | required reviews | ok | |
| `ReviewKind.kind` | `review-code`, `review-doc`, `review-skill`, `review-ui`, `governance` | review type | two-ideas | `kind` is also the outcome tag; with `ReviewKind` as the type name, the key reads well. ok as is |
| `ReviewKind.verdict: passed, failed, missing` | how it stands at the head | review state | two-words | review's own `Verdict` says `pass, fail, unseen`. One spelling: `pass, fail`, plus `missing`. 65% |
| `Reviews: passed, failed, missing, unknown` / `reviewsOf` | the reviews as one word | combined review decision ([GitHub GraphQL, PullRequestReviewDecision](https://docs.github.com/en/graphql/reference/enums#pullrequestreviewdecision)) | two-words | as above |
| `PrFacts.checks: green, red, pending, stuck` | the required checks, rolled up | combined status: success, failure, pending ([GitHub REST, commit statuses](https://docs.github.com/en/rest/commits/statuses)) | two-ideas | `stuck` → `timed_out`: `stuck` is also an outcome verb. 75% |
| `PrFacts.mergeable: clean, conflicts, unknown` | whether it merges cleanly | `mergeable_state`: clean, dirty, unknown ([GitHub REST, pulls](https://docs.github.com/en/rest/pulls/pulls)) | ok | `conflicts` is plainer than GitHub's `dirty` |
| `PrFacts.comments` / `.id` / `.by: person, bot` | unresolved comments, and who left each | unresolved review threads | ok | |
| `PrFacts.main` / `Main` | the base branch as two commits | merge base and tip ([git merge-base](https://git-scm.com/docs/git-merge-base)) | ok | |
| `Main.tested` | where the head left main | merge base (same source) | differs | keep: it says why it matters. 60% |
| `Main.tip` | where main is now | tip ([git glossary](https://git-scm.com/docs/gitglossary)) | ok | |
| `ShipFacts` / `readShipFacts` / `readFacts` (`handlers.ts`) | the PR facts plus the ledger's criteria and verdicts | facts; the third `readFacts` in the pipeline | two-ideas | `readShip`; see plan's `Facts` row. 60% |
| `ShipFacts.criteria` | the ticket's criteria as the ledger holds them now | acceptance criteria | ok | |
| `ShipFacts.verdicts` | every verdict row kept for them | review results | two-ideas | `rows`: `Row` and `Verdict` are one type here. 55% |
| `Criterion` (`ready.ts`) | the book's `Stated`, renamed | acceptance criterion | two-words | import `Stated` as itself: a third `Criterion` hides that it is the book's. 75% |
| `Row` (`ready.ts`) = `Verdict` (book) | one review row on one criterion | review result | two-words | one name for one type, in the book: `Row` or `Verdict`, not both. 80% |
| `Met` | a passing row | met | ok | |
| `Checks` (`ready.ts`) `{head, state}` | the checks at one head | combined status | two-ideas | a second `Checks`, differs from review's. `ChecksAt`. 60% |
| `Proof` | what `ReadyToMerge.of` needs: PR, head, tested, criteria, verdicts, checks | evidence bundle; "proof" also names a review's proof text and a formal proof (`tool: "proof"`) | two-ideas | `Evidence`. 60% |
| `Proof.pr`, `.head`, `.tested`, `.criteria`, `.verdicts`, `.checks` | as above | as above | ok | |
| `ReadyToMerge` / `readyToMerge` / `Ready` / `OnMain` | a value only code that checked every row can make: it may merge at this head | a branded type, a witness of "parse, don't validate" ([King, 2019](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)); Effect's `Brand` ([Effect, branded types](https://effect.website/docs/code-style/branded-types/)) | ok | |
| `ReadyToMerge.pr`, `.head`, `.tested`, `.criteria`, `.rows` | what the proof holds | as above | ok | |
| `Readiness` / `.ready` / `.refused` | ready, or every reason not | validation result | ok | |
| `Refusal.why: no_verdict, not_met, other_head, old_version, checks` | why one criterion is not proven | none standard | ok | |
| `Refusal.id`, `.head`, `.version`, `.state` | which criterion, at which head or version, or the checks' state | none needed | ok | |
| `ShipGate` / `shipGate` `answer: go, wait_for_checks, stop` | go, wait, or the one reason not to | a guard ([XState, guards](https://stately.ai/docs/guards)) | two-words | `answer` → `kind`, as in build and review. 60% |
| `ShipGate.ready` / `.landing` / `.head` / `.outcome` | what go carries; what wait and stop carry | none needed | ok | |
| `Door` / `MergeDoor` / `atTheDoor` / `atTheMergeDoor` | read the facts again right before the write; write only if the gate still says go | optimistic concurrency, a check at write time ([Wikipedia, optimistic concurrency control](https://en.wikipedia.org/wiki/Optimistic_concurrency_control)); compare-and-swap | differs | keep `door` as the plain word and add the gloss "optimistic concurrency check". 55% |
| `Door.write` / `.stale` / `.behind` | go with this proof; the read no longer holds; main moved on | stale read; out of date | ok | |
| `Landing: whole, part` / `landingOf` / `landed` / `landedAs` | whether the ticket has work left after the merge | none | differs | one ticket is one PR now ([done is per criterion](./direction/done-is-per-criterion.md)), so `part` goes, as the outcome names note says. 70% |
| `Cleanup: done, failed, not_run` / `finish` / `ship_finish` / `shipTidyTree` | the tidy-up after a merge | post-merge cleanup | two-words | three words, one step: `cleanup` for all (`ship_cleanup`, `cleanupTree`). 70% |
| `done.commit` / `done.cleanup` | the commit on the base branch; how the tidy-up went | merge commit | ok | |
| `Rerun` / `.run` / `.attempt` / `rerunChecks` | a check run started again | re-run, `run_attempt` ([GitHub Actions, re-running workflows](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/re-running-workflows-and-jobs)) | ok | |
| `enqueue` / `queued` | put the proven head in the merge queue | merge queue ([GitHub, merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)) | ok | |
| `enqueue` answers `head_moved`, `conflicts`, `no_queue`, `stale` | why it did not queue | none needed | ok | |
| `merge` / `Merged` / `MergeAnswer` | a straight merge, with no queue | merge | ok | |
| `Merged.reading: merged, head_moved, conflicts, behind, stale` | how the merge went | merge result | differs | `reading` is the tag: `kind`, as everywhere else. 70% |
| `Merged.commit` | the commit on the base branch | merge commit SHA | ok | |
| `MAX_MOVES` | how often the head may move under the tries to queue it | none needed | ok | |
| `Waits.checksMs` / `.queueMs` / `MAX_WAITS` / `checksClock` / `queueClock` | how long to wait | timers ([Temporal, timers](https://docs.temporal.io/workflow-execution/timers-delays)) | ok | |
| `Ship` (state type) | the machine's state | Elm's Model | two-ideas | `ShipState`. 80% |
| `Look` / `look` / `shown` | a read-only run: what the machine would do | dry run; `terraform plan` ([Terraform, plan](https://developer.hashicorp.com/terraform/cli/commands/plan)) | differs | `DryRun`. "Look" is plain but hides the prior art. 55% |
| `Look.pr`, `.facts`, `.outcome`, `.name` | the PR, what was read, what it would answer | none needed | ok | |
| `Look.wouldSend` / `.wouldWaitFor` | the write it would send; what it would wait on | planned actions | ok | |
| `Passed` (`program.ts`) `{pr, head}` | a PR at a reviewed head, as a pipe gives it | none | two-ideas | `Reviewed` is taken by review; `ReviewedHead`. Review's sheet also has a local `Passed` row. 60% |
| `PullRequestUrl` / `Commit` (`program.ts`) | a PR url; a commit SHA | url, SHA | two-ideas | `Sha`: build's `Commit` is a commit message. 75% |
| `keyOf` | the id a PR at a head is shipped under | idempotency key ([Stripe, idempotent requests](https://docs.stripe.com/api/idempotent_requests)) | ok | |
| `Shipped` / `.pr`, `.outcome`, `.name` | how one PR ended | result | ok | |
| `Ask` / `.id` / `.pr` (`program.ts`) | one request to ship, with the id its answer comes back under | request with a correlation id ([Enterprise Integration Patterns, correlation identifier](https://www.enterpriseintegrationpatterns.com/patterns/messaging/CorrelationIdentifier.html)) | two-ideas | `Request`. The fifth `Ask`. 75% |
| `Answer` / `.id`, `.pr`, `.outcome`, `.name` | the reply to one ask | reply (same source) | ok | `Reply`, if `Ask` becomes `Request`. 60% |
| `Forget` / `.id` | the asker has its answer; ship may drop it | acknowledgement ([AWS, SQS delete message](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)) | differs | `Ack`. 65% |
| `Plan` (`launch.ts`) `{prs, mode, own, reviewers}` / `planOf` / `checked` | the command line, read | parsed arguments | two-ideas | `Args`, `argsOf`, `validate`, as in review. 85% |
| `Plan.mode: read, write` | dry run or real | `--dry-run` | ok | |
| `Plan.own` / `.reviewers` | the repo's own accounts; whose verdicts count | none needed | ok | |
| `noWrites` | a code host that writes nothing | a no-op double | ok | |
| `send:builder:review_failed`, `checks_red`, `conflicts`, `ejected`, `bot_comment`, `behind` | back to the builder | request changes; removed from the merge queue | ok | |
| `send:reviewer:no_review` | a review is missing at this head | review required | ok | |
| `ask:owner:approval` / `ask:commenter:comment` | an owner must approve; a commenter must resolve | code owner review; resolve conversation | ok | |
| `skip:closed`, `draft`, `not_ours` | never shipped | none needed | ok | |
| `stuck:criteria_unknown`, `merge_unknown`, `approval_unknown`, `reviews_unknown` | a fact could not be read | none found | differs | `_unread`, as in review. 50% |
| `stuck:proof_refused` | the proof no longer holds, or none was made | none | ok | follows `Proof` |
| `stuck:checks_stuck` | checks still running at the limit | `timed_out` | differs | `stuck:checks_timed_out`. 70% |
| `stuck:queue_silent`, `head_moving`, `enqueue_failed`, `merge_failed`, `read_failed` | the other stops | none needed | ok | the outcome names note already asks whether `stuck` should cover writes that failed |

## 7. The parent, or lane

`packages/pipeline/src/stages/lane/` (the machine that takes an approved plan
to one pull request) and `packages/pipeline/src/hosted/` (each stage as a
program on the host).

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| lane / `lane` / `Lane` | the parent that takes one approved plan to one merged PR | a parent workflow ([Temporal, child workflows](https://docs.temporal.io/child-workflows)); a supervisor ([Erlang, supervisor](https://www.erlang.org/doc/system/sup_princ.html)); a Kanban swimlane is a row on a board | differs | keep `lane`, with the gloss "a plan's parent workflow". 55%: "parent" is the plainer word, and the docs already say it |
| `Lane` (state type) | the lane machine's state | Elm's Model | two-ideas | `LaneState`. 80% |
| state `phase`: `idle`, `reading`, `waiting`, `starting`, `running`, `noting`, `planning`, `opening`, `over` | where the lane is | state | ok | |
| state `lane`, `job`, `at`, `pr`, `asks`, `flow`, `child`, `asked`, `outcome`, `report` | what each phase holds | none needed | ok | `job` and `at` follow their rows below |
| `LaneJob` | the lane's input | workflow input | two-ideas | `LaneInput`, after `PlanInput`. "Job" is also plan's criterion and the host's scheduled job. 85% |
| `LaneJob.plan` | the plan id | none needed | ok | |
| `LaneJob.settings` / `.agents` / `.agents.plan`, `.build`, `.review` | the shared agent settings, and each step's own | per-step config | ok | |
| `LaneJob.usd` | one child's dollar cap | budget | two-words | `budget`, as `Settings.budget` says. 75% |
| `LaneJob.rubrics` | the rubric folder | rubric | ok | |
| `LaneJob.at` | the first commit date, in seconds | epoch seconds; a commit's author date ([git commit, date formats](https://git-scm.com/docs/git-commit)) | two-ideas | `epoch`: `at` is also a place (`Found.at`), a commit to read at (`PlanTicket.at`) and a file (`Pointer.at`). 70% |
| `LANE_STEPS: plan, build, review` / `LaneStep` | the steps that run an agent | none needed | ok | |
| `CHILDREN: plan, catchup, build, review, ship` / `ChildKind` / `kindOf` | the kinds of child a lane starts | child specs ([Erlang, supervisor child spec](https://www.erlang.org/doc/system/sup_princ.html#child-specification)) | two-ideas | `ChildType`: `kind` is the outcome tag, the review kind and the program kind. 55% |
| `childOf` / `offsetOf` / `jobFor` / `agentFor` | a child's name, its date offset, its input, its settings | none needed | ok | `jobFor` → `inputFor`, after the `*Job` pick |
| `Flow` / `.flow: round, final, drop, ship, plan` | where the lane is in one piece of work | none | differs | the tag key is `flow` here, `go` in `Next`, `answer` in gates, `kind` in outcomes. One key: `kind`. 65% |
| `Flow.task`, `.round`, `.open`, `.step`, `.head` | which task, which round, what is open, which step, at what head | none needed | ok | |
| `"final"` / `finals` | the last review over the whole book | a final review; acceptance review | ok | |
| `"drop"` / `dropped` | take a removed task's commits off the branch | revert ([git revert](https://git-scm.com/docs/git-revert)) | differs | `revert`, git's word. 70% |
| `Flow.run` / `ships` | which ship run | attempt | ok | |
| `Flow.version` / `.folds` | the plan version to make, and the tickets folded in | none | two-ideas | see `fold` in section 8 |
| catch-up / `catchup` | the branch takes main in, or a removed task's commits come out | update branch ([GitHub, keeping a PR in sync](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/keeping-your-pull-request-in-sync-with-the-base-branch)); rebase or merge from base | differs | `sync`, GitHub's own idea ("update branch"). 55% |
| `ChildEnd` / `.outcome` / `.outcome.kind` / `.outcome.why` / `.head` / `.open` | how a child ended, as the lane reads its row | exit reason ([Erlang, exit signals](https://www.erlang.org/doc/system/ref_man_processes.html)) | ok | |
| `readLane` / `startChild` / `noteRound` / `openPr` / `notePlan` | the lane's moves | none needed | ok | |
| `startChild` input `child`, `usd`, `job` | the child's name, cap, input | child spec | two-words | `usd` → `budget`; `job` → `input`. 75% |
| `startChild` answer `started` | it was started now, not found already there | none needed | ok | |
| `noteRound` input `plan`, `task`, `child`, `open` | one count for the stall rule | none needed | ok | |
| stall rule | stop a loop once the list of open things stops shrinking | none found (searched Temporal, OTP, Agile): a progress check | ok | the asks core's word, glossed |
| `openPr` input `plan`, `head`, `title`, `body` / answer `url` | open the plan's one PR | create a pull request ([GitHub REST, pulls](https://docs.github.com/en/rest/pulls/pulls)) | ok | |
| `notePlan` input `plan`, `child`, `folds` / err `no_plan` | keep a re-plan as the next version | none needed | ok | |
| `ChildSub` / `OwnerSub` / `childSub` / `ownerSub` | wait on a child's row; wait on the owner's answer | Sub ([Elm guide](https://guide.elm-lang.org/effects/time.html)) | ok | |
| `LaneMsg`: `start`, `resume`, `child_over`, `owner_moved` | what the lane hears | Msg; child exit; signal ([Temporal, signals](https://docs.temporal.io/sending-messages)) | ok | |
| `LaneReport` / `.rounds` / `.finals` / `.pr` / `.problems` | what a lane leaves besides its outcome | result | ok | |
| `LaneView` / `laneViewOf` | what the lane reads before each step | read model ([Microsoft, CQRS](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)) | ok | |
| `LaneView.approved`, `.closed` | the plan is approved; it was closed | none needed | ok | |
| `LaneView.waiting` | the plan's open asks, by id | pending human tasks | ok | |
| `LaneView.tasks` / `TaskState` / `.task` / `.settled` / `.open` | each live task and whether every criterion passed | none needed | two-ideas | `TaskState` is the name a task machine's state should take (section 3): `TaskStatus`. 70% |
| `LaneView.removed` | tasks the owner took out | none needed | ok | |
| `LaneView.planOpen` / `.planTodo` | the plan's own criteria failed, and not passed yet | none needed | ok | follows the `Goal` pick |
| `LaneView.head` / `.behind` / `.met` | the branch now; main has a commit it lacks; every live criterion passed at head | behind ([GitHub, compare](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/about-comparing-branches-in-pull-requests)) | ok | |
| `LaneView.pr` / `PrState` / `.url` / `.state` / `.head` | the plan's PR | pull request | ok | |
| `LaneView.tickets`, `.version`, `.folds`, `.title`, `.summary` | the tickets it closes, the newest version, unplanned folds, the words | none needed | ok | |
| `Outside` (`lane/view.ts`) / `Outside` (`hosted/outside.ts`) | what the code host says, as an interface; and the code host service | none | two-ideas | the service → `CodeHost`, which `services.ts` already names; the interface → `HostRead`. 75% |
| `LaneAt` / `START` | the counts a lane's children are named from | none | differs | `LaneCounts`: "at" says nothing here. 70% |
| `LaneAt.rounds`, `.finals`, `.fixedAt`, `.dropped`, `.ships` | rounds per task, last reviews, when a round went to the plan's own criteria, reverted tasks, ship runs | none needed | ok | |
| `Next` / `next` / `.go` | the one pure choice of the next step | a decider ([Chassaing, functional event sourcing decider](https://thinkbeforecoding.com/post/2021/12/17/functional-event-sourcing-decider)) | differs | tag key `go` → `kind`. 60% |
| `Next.go: done, skip, wait, plan, drop, round, final, open, ship, stuck` and keys `pr`, `head`, `why`, `asks`, `version`, `folds`, `task`, `round`, `open`, `fix`, `run` | each next step and what it carries | none needed | ok | |
| `prBody` | the plan's PR text | PR description | ok | |
| `done` `pr`, `head`; `skip:closed`, `skip:emptied` | the lane's endings | none needed | ok | |
| `stuck:read_failed`, `plan_failed`, `catchup_failed`, `build_failed`, `review_failed`, `ship_failed`, `open_failed` | how a lane stops | none needed | two-ideas | `stuck:review_failed` here means the review child got stuck; `send:builder:review_failed` in review and ship means a criterion failed. `stuck:review_stuck`, or `<step>_stuck` for all. 70% |
| `Stage` / `hostedStage` / `hosted<Stage>` | one pipeline stage as a program on the host | an activity worker; a durable entity | ok | |
| `Stage.kind` | the stage's name | entity type | two-ideas | see the `kind` row, section 9 |
| `Stage.job` | the codec for its input | input | two-ideas | `input`. 80% |
| `Stage.boot`, `.over`, `.idle`, `.start`, `.resume`, `.finish`, `.agent` | how to boot, end and start it | lifecycle callbacks | ok | `finish` is ship's tidy-up word too |
| `JOB_ID = "job"` | the id the input is cast in under | none | two-ideas | `INPUT_ID = "input"`. 80% |
| `BuildJob`, `CatchupJob`, `PlanJob` (hosted), `ReviewJob`, `LocalReviewJob`, `ShipJob`, `SortJob`, `TaskJob` | each hosted stage's input | workflow input | two-ideas | `<Stage>Input`. `PlanJob` is exported twice: plan's task criterion and hosted plan's input. 90% |
| `StageNote` / `AgentNote` / `WriteNote` / `.ev` | what a stage, agent or write says to the harness | log event | differs | tag key `ev` → `kind`, as the other tags. 55% |
| `fence` | the lease's fencing number | fencing token ([Kleppmann, 2016](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)) | ok | |
| `holder` / `ttlMs` (`Hosting`) | this host's name; the lease length | lease holder and TTL ([Kubernetes, leases](https://kubernetes.io/docs/concepts/architecture/leases/)) | ok | |
| `outcomeOf` / `readOutcome` / outcome row | the stream a stage's outcome row is in | result | ok | |
| `jsonJournal` / journal | a machine's saved state stream | journal; event log | ok | |
| `AgentAsk` / `.id` / `.brief` | one ask to an agent child | a request with a correlation id ([EIP, correlation identifier](https://www.enterpriseintegrationpatterns.com/patterns/messaging/CorrelationIdentifier.html)) | two-ideas | `AgentRequest`. 70% |
| `askAgent` / `Asked` / `.how: answered, limit` / `.answer` | send the ask, wait for its answer | request-reply | ok | `how` is one more tag key |
| `Turn` / `.answer` / `.cost` / `.agent: real, stub` | what one agent turn left | turn | ok | `cost` here, `spend` in `Ran`, `Usage` after the pick: one word. 70% |
| `agentOf` / `answersOf` / `askingOf` / `agentProgram` / `quiet` | the agent child's names, streams and program | child process | ok | |
| `Standing: wanted, withdrawn, unsaid` (local) | how the stage stands on an ask | cancelled ([Temporal, cancellation](https://docs.temporal.io/activities)) | ok | `Standing` is also the criteria book's export: a local type here |
| `digest` / `asWritten` | a hash of a text; a codec that takes text as written | digest | ok | |
| `Idempotency` / `gate` / `GateOptions` / `once` | every outside write goes out at most once per key, under the lease | idempotency key ([Stripe](https://docs.stripe.com/api/idempotent_requests)); outbox ([microservices.io, transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html)) | two-ideas | `gate` here is a write guard; build, review and ship call a pure readiness check a gate. `guardWrites`. 60% |
| `Key` / `.text` / `.name` / `.fence` / `KeyRefused` / `useKey` / `markerOf` / `marked` | a key only this gate can make, and its marker in a text | idempotency key | ok | |
| `Write` / `.op` / `.subject` / `.answer` / `writesOf` | one write that leaves the ledger | command ([Fowler, CQRS](https://martinfowler.com/bliki/CQRS.html)) | ok | |
| `intent:<key>` / `done:<key>` rows | before and after a send | write-ahead intent | ok | |
| `Faults` / `noFaults` / `faults` / `turnFaultMs` | named points where a planted fault may stop the process | fault injection; FoundationDB's Buggify ([FoundationDB, simulation](https://apple.github.io/foundationdb/testing.html)) | ok | |
| `Hosting` / `.agent` / `.hold` / `.say` / `.listen` | how a lane is served | none needed | ok | |
| `deliver` / `deliverProgram` / `liveDelivery` / `serveLane` / `Delivered` | serve one lane and its children until the scope ends | run a workflow | differs | `runLane` / `LaneResult`: "deliver" is a third verb for one lane run. 55% |
| `Delivered.plan`, `.outcome`, `.name` | the program answer's keys | none needed | ok | |
| `serveChildren` / `childrenOf` | the `<parent>/children` stream | children | ok | renamed from `kid` on 2026-10-22 |
| `Landing` (`hosted/outside.ts`) `.at: none, queued, merged` / `.commit` | where a PR stands after a ship write | none needed | two-ideas | ship's `Landing` is `whole` or `part`; this is a merge state: `MergeState`. Tag `at` → `kind`. 70% |
| `EnqueueAnswer` | the enqueue's answer | none needed | ok | ship's `enqueue` lists the same words plus `stale` |
| `Repo` / `repoText` / `repoOfPlan` | owner and name | repository ([GitHub REST, repos](https://docs.github.com/en/rest/repos/repos)) | ok | |
| `gitOn` / `Git` / `GIT_FIRST` / `branchHeadAt` / `pushWith` / `copyAt` / `commitEnv` | the git calls the hosted stages make | git | ok | |
| `Issues` / `CloseReason: not_planned, duplicate` / `gitHubIssues` | close an issue with a reason | `state_reason`: completed, not_planned, duplicate ([GitHub REST, issues](https://docs.github.com/en/rest/issues/issues)) | ok | |
| `BuildWork` / `BuildAnswer` / `ResolveAnswer` / `resolveTurn` | the hosted build's and catch-up's agent turns | none needed | ok | |
| `foldedPlanHost` / `childPlanner` / `childReviewer` / `childSorter` | stage services that read through the ledger's fold, or run under a child | none needed | ok | |
| `readingIn` / `localReviewTurn` / `LocalChecks` / `targetOf` | the local review's reads | none needed | ok | |
| `verdictOf` (`hosted/review.ts`) | the review's verdict from an over state | none needed | two-ideas | a second `verdictOf` (build's ACP permission answer): rename that one |
| `Ending: row_done, row_stuck, no_row` / `Variant: today, fixed` / `Seen` / `laneEnds` / `runCase` / `LIMIT_MS` | experiment 116's lane-end property and its stand-ins | a property-based test ([fast-check](https://fast-check.dev/docs/core-blocks/properties/)) | ok | |

## 8. Triage, still `sort` in code

`packages/pipeline/src/stages/sort/` and `hosted/sort.ts`: one new ticket in, one answer out
(duplicate, no, or yes with a next step).

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| sort / `sort` / `Sort*` | read one new ticket and answer duplicate, no, or yes with a route | triage ([Linear, triage](https://linear.app/docs/triage); GitHub's `needs-triage` habit) | differs | `triage`, the word every tracker uses; the docs already say "triage, still `sort` in code". 80% |
| `SortAsk` / `.ticket` / `.tries` | the stage's input | workflow input | two-ideas | `TriageInput`, after `PlanInput`. 85% |
| `readTicket` (`sort_ticket`) / `readContext` (`sort_context`) / `writeOne` (`sort_write`) | the stage's moves | none needed | ok | `readTicket` is also exported by other stages under the same name: fine inside each folder |
| `SortTicket` / `.url`, `.number`, `.state: open, closed`, `.title`, `.body` | the ticket as read | issue ([GitHub REST, issues](https://docs.github.com/en/rest/issues/issues)) | ok | |
| `Earlier` / `.number`, `.title`, `.state`, `.reason` | the repo's other tickets, to find a duplicate | none needed | ok | `reason` is the close comment; GitHub's own is `state_reason`. Fine |
| `OpenPlan` / `.number`, `.tickets`, `.summary`, `.approved` | an open plan the ticket may be part of | a parent issue ([GitHub, sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)) | ok | |
| `SortContext` / `.earlier` / `.plans` | what the sorter reads besides the ticket | none needed | ok | |
| `Settings` / `.model`, `.effort`, `.budget`, `.note` | the sorter's settings | none needed | ok | the same shape is exported by five stages as `Settings`: see section 9 |
| `SortAnswer` / `SortReply` / `.sort` | the answer, and the object the agent hands back holding it | structured output ([Claude Agent SDK, structured outputs](https://docs.claude.com/en/docs/agent-sdk/structured-outputs)) | ok | |
| `.answer: duplicate, no, yes` | the answer's tag | resolution ([GitHub, default labels](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels#about-default-labels): duplicate, invalid, wontfix) | ok | one more tag key; see section 9 |
| `Duplicate` / `.of` / `.why` | the same change or problem as an earlier ticket | duplicate ([GitHub, marking duplicates](https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/marking-issues-or-pull-requests-as-a-duplicate)) | ok | |
| `No` / `.rule` / `.reason` / `.why` | not worth doing, by one of the bar's rules | won't fix; close as not planned | ok | `reason` (the line on the ticket) and `why` (for the reader) sit side by side; a gloss is enough |
| bar / `NO_RULES` / `NoRule` / `NoRuleId` / `NO_RULE_IDS` / `ruleOf` | the repo's seven ways a ticket is a no | a definition of ready, turned around ([Agile Alliance, definition of ready](https://www.agilealliance.org/glossary/definition-of-ready/)) | ok | |
| `NoRule.id`, `.rule`, `.reason`, `.needsCode`, `.example` | each rule's id, words, reason line, whether code must show it, and an example | none needed | ok | |
| `already_fixed`, `target_removed`, `carried`, `replaced`, `settled_no`, `pipeline_tool`, `not_work` | the seven rule ids | won't fix reasons | differs | `carried` is a duplicate by another name; `pipeline_tool` names one tool: `upstream`, the word for a bug that belongs in another repo. 60% |
| `STILL_YES` / `.rule`, `.example` | four cases that look like a no and are a yes | none found (searched Linear, GitHub, Scrum guides) | ok | |
| `leadOf` / `barLines` | the reason's first words; the bar as brief lines | none needed | ok | |
| `YesPlan` / `.next: plan` / `.partOf` | worth doing, and a plan comes next; maybe as part of an open plan | a sub-issue's parent ([Linear, parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)) | ok | `partOf` is two words: `parent`, the trackers' word. 65% |
| `YesRuling` / `.next: ruling` / `.ask` / `.options` | the owner must choose first, with the question and its options | a decision ([MADR](https://adr.github.io/madr/)) | differs | `ruling` is a court word; trackers and ADRs say "decision". `decision`. 55%: "ruling" is plain English and the asks core uses it everywhere |
| `YesRuling.ask` | the question | question | two-ideas | `ask` is a verb, a ledger record and an input name already (section 1): `question`. 75% |
| `YesResearch` / `.next: research` / route `research` | worth doing, and it ends in a finding, not a PR | spike ([Extreme Programming, spike](http://www.extremeprogramming.org/rules/spike.html)) | differs | keep `research`: a spike is code you throw away, and research may only read. Gloss it as "a spike, or reading". 60% |
| `.next` | which route a yes takes | none | ok | |
| `ROUTES` / `plan`, `ruling`, `research` | the three routes, as the brief says them | none needed | ok | |
| `Said` / `saidOf` | an answer in one word: duplicate, no, fold, plan, ruling, research | none needed | ok | |
| fold / `fold` (write `op`) / `plan:fold` | the ticket joins an open plan, which grows by one ticket | add a sub-issue ([GitHub, sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)) | collides | `fold` is also the event-sourcing word for reading a stream into state (`foldLedger`, `Folded`, `foldedPlanHost`), and both live in the asks core. `attach`, or `join`. 75% |
| `Brief` / `.ticket`, `.context`, `.note` | what the sorter is told | prompt | ok | |
| `promptOf` / `promptFor` / `sortProblems` | the prompt, its retry form, and the Check | none needed | ok | |
| `sortDraft` / `refine` | the Draft and its refine loop | evaluator-optimizer ([Anthropic, building effective agents](https://www.anthropic.com/engineering/building-effective-agents)) | ok | see `createRefineLoop` in section 9 |
| `SortWrite` / `.op: comment, label, close, link, fold, ruling` | one write the answer makes | command | ok | `link` writes a comment on the plan: `comment_plan`, or fold it into `comment`. 55% |
| `SortWrite.ticket`, `.body`, `.label`, `.plan`, `.reason`, `.ask`, `.options`, `.why` | each write's fields | GitHub's field names | ok | `ask` follows `YesRuling.ask` |
| `close.reason: not_planned, duplicate` | GitHub's close reasons | `state_reason` ([GitHub REST, issues](https://docs.github.com/en/rest/issues/issues)) | ok | |
| labels `sort:duplicate`, `sort:no`, `sort:plan`, `sort:ruling`, `sort:research` | the label each answer leaves | triage labels | differs | a fold leaves `sort:plan`, so a reader cannot tell a fold from a new plan by label. Follows the `triage` rename. 60% |
| `issueUrl` / `writesFor` / `outcomeOf` | a ticket's url; an answer's writes; its outcome | none needed | ok | `outcomeOf` is also exported by `hosted/stage.ts` |
| `SortHost` / `.ticket` / `.earlier` / `SortPlans` / `.open` / `ledgerPlans` / `githubSortHost` / `reasonIn` | reads from the code host and the ledger | none needed | ok | |
| `Sorter` / `.run` / `liveSorter` / `sorterOptions` / `SorterConfig` / `.seen` / `.open` | the agent that sorts | agent ([Claude Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview)) | ok | follows `triage`: `Triager` |
| `SortWrites` / `.write` (`intent`) | the stage's one write service | none needed | ok | |
| `SortMsg` / `RunSub` (`sort_run`) / `runSub` | what the agent run says; the Sub that listens | Sub | ok | |
| `SortReport` / `.answer`, `.wrote`, `.problems`, `.tries`, `.spend` | what the stage leaves | result | two-words | `spend` → `usage`, after the `Usage` pick |
| `SortState` / `.phase: idle, reading, gathering, sorting, checking, writing, over` | where the stage is | state | ok | |
| `SortState` keys `ask`, `settings`, `key`, `ticket`, `context`, `refining`, `answer`, `tries`, `spend`, `writes`, `wrote`, `asked`, `outcome`, `report` | what each phase holds | none needed | two-words | `key` → `session` and `spend` → `usage`, after the picks; `ask` → `input` |
| `SortMachineMsg` / `.type: start, resume` | what the stage hears | Msg | differs | other stages tag their Msg with `type` too, outcomes with `kind`: see section 9 |
| `sort` (machine) / `sortReadInterpret` / `sortWriteInterpret` / `sortSubscribe` | the machine and its handlers | interpreter | ok | |
| `done:closed:no`, `done:closed:duplicate` (with `part`) | the ticket was closed | resolution | ok | |
| `send:plan:yes`, `send:plan:fold`, `send:research:yes` | who is next | none needed | ok | `fold` follows its row |
| `ask:owner:ruling` | the owner must choose | none needed | ok | |
| `skip:closed` | the ticket is closed already | none needed | ok | |
| `stuck:read_failed`, `draft_failed`, `over_budget`, `changed`, `write_failed` | how sort stops | none needed | ok | `changed` = the ticket's words moved; `ticket_changed` reads better. 55% |
| `stuck:unchecked` | its last answer still has problems and the tries are spent | none | differs | `stuck:unfixed`, as plan's (picked 2026-10-24) |
| `sortName` / `childSorter` / `sortTurn` / `sortWritesOf` / `hostedSort` / `SortJob` | the hosted triage | none needed | ok | `SortJob` → `TriageInput` (section 7) |

## 9. Shared

`primitives.ts`, `combos.ts`, `stages/outcome.ts`, `services.ts`, `asks/`, and the `@kampus/fabrika`
names the pipeline uses (program, host, ledger, agents).

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| moves / `primitives.ts` | the six moves every step is made of | none found for the set (searched Elm, Temporal, LangGraph); each move is a Cmd, a Sub or a pure function | two-words | AGENTS.md says "moves", the file says "primitives": rename the file `moves.ts`. 75% |
| `gather` | code reads the world | query ([Fowler, CQS](https://martinfowler.com/bliki/CommandQuerySeparation.html)) | ok | |
| `act` / `Intended` / `.intent` / `intentOf` | code writes the world, with its intent kept first | command; idempotency key | ok | |
| `listen` | wait on an outside event | Sub ([Elm guide](https://guide.elm-lang.org/effects/time.html)) | ok | |
| Draft / `createDraft` / `Draft` / `DraftMsg` / `DraftRun` | an agent produces within limits | an agent run | ok | |
| `Check` (type) / `checkRun` | code judges an output | a validator; a guard | two-ideas | it is also plan's `{how, what}` on every criterion, `CheckAsk` and the record's `check` command. **picked 2026-10-24:** keep the move; plan's value goes (section 1). `CheckAsk` and the record's `check` are not picked. The lean, plan's value → `Verify`, was not taken |
| Judge / `createJudge` | a small classifier answers one narrow question | LLM-as-a-judge ([Zheng et al., 2023](https://arxiv.org/abs/2306.05685)); a classifier | ok | |
| `Judged` / `.choice` / `.confidence` | the classifier's raw answer | prediction with a score | ok | |
| `Ruled` / `.sure` / `.choice` / `.best` / `.confidence` | the answer after the floor | thresholded prediction | two-ideas | "ruled" is also the owner's ruling (`ruled`, `RulingAsk`): `Floored`, or `Sure`. 65% |
| floor | the lowest confidence that counts | threshold | differs | `threshold`, the classifier word. 60% |
| `Gate` / `.pass` / `.why` / `pass` / `park` / `gateCheck` / `gateJudge` | the work goes on, or it parks with why | a guard ([XState, guards](https://stately.ai/docs/guards)) | two-ideas | `gate` is also the idempotency write guard (section 7). `park` is a sixth outcome-like verb: keep, glossed "stop and wait". 55% |
| `Remember` / `.step: writing, reading` / `.write` / `.read` / `remember` / `written` / `inFlight` | write, then read back, and count it done only when the read shows it | read-your-writes ([Jepsen, consistency models](https://jepsen.io/consistency/models/read-your-writes)) | differs | `writeThenRead`, or keep with the gloss. 50% |
| `sessionOf` | a conversation id made from a name | session id | ok | |
| `Tried` / `.go: done, again, out_of_tries` / `.tries` / `.note` / `.problems` / `nextTry` | the refine rule on its own | retry ([Temporal, retry policy](https://docs.temporal.io/encyclopedia/retry-policies)) | two-ideas | tag key `go` again; `out_of_tries` here, `unchecked` in outcomes (now `unfixed`): one word, `out_of_tries`. 60% |
| refine / `createRefineLoop` / `Refining` | draft, check, send the problems back, up to a limit | evaluator-optimizer ([Anthropic, building effective agents](https://www.anthropic.com/engineering/building-effective-agents)) | ok | |
| `Refining.phase: drafting, done, out_of_tries, failed` / `.brief`, `.run`, `.tries`, `.limit`, `.output`, `.session`, `.problems`, `.error` | where the loop is | none needed | two-words | `limit` here, `tries` in inputs, `MAX_RUNS` in build: one word |
| `createRefineLoop` config `draft`, `check`, `prompt`, `agent`, `folder` | the loop's parts | none needed | ok | |
| `key` (every child Cmd, Sub and Msg) | which child an answer is for | Elm's `Cmd.map` by data; correlation id ([EIP](https://www.enterpriseintegrationpatterns.com/patterns/messaging/CorrelationIdentifier.html)) | two-ideas | the `key` → `session` pick was for a stage's own state; here it routes children: `child`. 60% |
| `Reply` / `.id`, `.author`, `.body`, `.at` | one reply in a thread | comment ([GitHub REST, issue comments](https://docs.github.com/en/rest/issues/comments)) | ok | |
| `Thread` / `.post` (`where`, `text`, `intent`) / `.replies` | where a question is posted and replies are read | thread | ok | |
| `Question` / `.where`, `.text`, `.who`, `.floor` | a question to people, read by a Judge | none needed | ok | `floor` follows its row |
| `Asking` / `.phase: posting, waiting, reading, answered, post_failed` / `.key`, `.question`, `.asked`, `.thread`, `.after`, `.reply`, `.choice`, `.by: code, jev` | an ask in flight | human-in-the-loop interrupt ([LangGraph, interrupts](https://langchain-ai.github.io/langgraph/concepts/human_in_the_loop/)) | two-ideas | the combo's ask is a thread question; the asks core's `Ask` is a ledger record. `createQuestion`. 55% |
| `createAsk` / `RepliesDeps` | the ask combo | none needed | two-ideas | follows `Asking` |
| `Child` / `.slot` / `.state` / `Children` / `spawn` / `stepChild` / `allOver` / `slotSubs` | a child per item, each in a fixed Sub slot | spawn ([Erlang, processes](https://www.erlang.org/doc/system/ref_man_processes.html)); nested TEA | ok | |
| `AnyOutcome` / `.kind: done, send, ask, skip, stuck` | the five verbs | exit reason; none found for the set (outcome-names.md) | ok | |
| `AnyOutcome.part` | done in part | partial success | ok | |
| `AnyOutcome.to`, `.who`, `.for`, `.why` | who is next, which person, for what, why | none needed | ok | the AGENTS.md examples |
| `Words` / `.done`, `.send`, `.ask`, `.skip`, `.stuck` / `OutcomeOf` / `outcomesOf` | a stage's own words | none needed | ok | |
| `Name` / `nameOf` / `Parts` / `partsOf` (`verb`, `who`, `why`) / `wentWrong` | the printed name `verb:who:why` and its parts | none needed | ok | |
| `CodeHost` / `.prFacts` / `.change` / `.checksSettled` / `.leftQueue` | the code host, read side | forge API ([GitHub REST](https://docs.github.com/en/rest)) | two-ideas | `prFacts` is a fourth "facts": `pr`. 60% |
| `leftQueue` answer `.reading: landed, ejected` / `.commit` | how the PR left the merge queue | merged; removed from the queue ([GitHub, merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)) | differs | tag key `reading` → `kind`; `ejected` → `removed`, GitHub's word. 60% |
| `CodeHostWrites` / `.enqueue` / `.merge` / `.rerunChecks` | the code host, write side | enqueue; merge; re-run failed jobs ([GitHub REST, re-run failed jobs](https://docs.github.com/en/rest/actions/workflow-runs)) | ok | |
| `Jev` / `.call` / `JevCallFailed` (`_tag`, `cause`) | one HTTP call to the classifier | product name | ok | |
| `Ask` (asks core) | something waiting on the owner, under a stable id | a user task ([Camunda, user tasks](https://docs.camunda.io/docs/components/modeler/bpmn/user-tasks/)); an interrupt | two-ideas | `ask` has five meanings (section 1). Keep it here, the core's own word, and rename the others. 60% |
| `Ask.at` | its place in the ledger | sequence number | two-ideas | `seq`: `at` has five meanings. 70% |
| `Ask.for: plan, stuck, ruling, check` | which kind of ask | none needed | two-ideas | `for` is the outcome's "for what"; this is a tag: `kind`. 65% |
| `PlanAsk` (asks) / `.plan`, `.tickets`, `.version`, `.data`, `.since`, `.problems` | the owner approves building a plan | approval | ok | the stage input `PlanAsk` is now `PlanInput` (picked 2026-10-24), so this one stands alone |
| `Approved` / `.version` / `.data` | the last approved version, shown against a change | none needed | ok | |
| `StuckAsk` / `.task`, `.title`, `.criteria`, `.open` / `.why: no_progress, ran_out` / `.time` | a task the stall rule ran out on | none needed | ok | `time` is a count: `times`. 70% |
| `RulingAsk` / `.ticket`, `.ask`, `.options`, `.why` | a ticket triage sent to the owner | a decision request | two-ideas | `.ask` → `question`, as `CheckAsk` already says. 75% |
| `CheckAsk` / `.task`, `.build`, `.by`, `.question`, `.attachments` / `Attachment` (`label`, `ref`) | a yes or no look at one build | a manual check; a review request | two-ideas | `check` again: `LookAsk`, or `ReviewAsk`. 55% |
| `Answer` / `.answer` / `AnswerBody` / `KINDS` | the owner's answer under the ask's id | none needed | ok | `Answer.answer` reads twice: `body`. 60% |
| `PlanAnswer.kind: approve, change, no` / `.line`, `.to`, `.why` | the answers to a plan | approve; request changes ([GitHub, PR reviews](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews)) | ok | decided 2026-10-24: the plan ask also takes the owner's answers to the plan's questions, and an approval records the plan version and a hash of the ticket's title and body. The new answer's name is not picked |
| `StuckAnswer.kind: remove, keep_going, reword` / `.rounds`, `.criterion`, `.when`, `.result` | the answers to a stuck task | none needed | ok | `when` and `result` are the Gherkin halves (section 1) |
| `RulingAnswer.kind: rule` / `.answer`, `.rule: lasting, one_off`, `.build` | the answer to a ruling | ADR ([MADR](https://adr.github.io/madr/)) for a lasting one | ok | |
| `CheckAnswer.kind: yes, no` / `.why` | the answer to a check | none needed | ok | |
| `Next` (asks) / `.do: build, replan, close, remove_task, keep_going, reopen, ruled, ship, rebuild` | what the core does next with an answer | none needed | two-ideas | the lane exports a `Next` too, tagged by `go`; this one's tag is `do`. `AnswerNext`. 65% |
| `Settled` / `.ask`, `.answer`, `.next` / `Refused` (`id`, `why`) / `Waiting` (`asks`) / `titleOf` | an answer taken, one refused, and every ask waiting | none needed | two-ideas | `Settled` is also the review's "settled" check state and `TaskState.settled` in the lane. 55% |
| `Fact` / `.type` | one pipeline event on the ledger | event ([Fowler, event sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)); fact is Datomic's word ([Datomic, datoms](https://docs.datomic.com/whatis/data-model.html)) | differs | `Event`, as the fabrika ledger itself says (`claimed` event). 65% |
| `Fact.type: planned, judged, reviewed, folded, answered, built, cleared, check_raised, shipped, released` | the event names | past tense ([Microsoft, event sourcing](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)) | ok | |
| `Fact.type: ruling_needed`, `lane` | two event names not in the past tense | past tense | differs | `ruling_asked`, `lane_started`. 70% |
| `Fact.type: judged` vs `reviewed` | a review round's rows; a review round's count | none | two-words | one round, two events: `round_judged`, `round_counted`. 50% |
| fact keys `plan`, `tickets`, `data`, `problems`, `task`, `head`, `proof`, `rows`, `found`, `open`, `ticket`, `ask`, `options`, `why`, `changes`, `holds`, `build`, `by`, `question`, `attachments`, `lane` | each event's fields | none needed | ok | `ask` follows `RulingAsk.ask`; `holds` follows its row |
| `Entry` (asks ledger) / `Entry` (fabrika `program/listed.ts`) | a fact with its place; a listed run | none | two-ideas | asks one → `Logged`. 55% |
| `ROOT` / `ticketName` / `planName` / `homeOf` / `ensureName` | where a fact lives | stream name ([Kafka, topics](https://kafka.apache.org/documentation/)) | ok | `homeOf` is also a fabrika export of the same name |
| `factsOf` (`<name>/facts`) / `readFacts` / `sendFact` / `appendFact` / `factOfRow` / `memoryLedger` / `steady` | the lease holder's stream, and the reads and writes | append; read all | two-ideas | `readFacts` is exported three times (sections 1 and 6). Follows `Event`: `readEvents`. 70% |
| `Hold` (lease) / `BuildTrack.holds` / `HOLDS` (packs) | a lease on a name; how many listeners a build waits on | lease; a hold | two-ideas | `Hold` → `Lease`, the ledger's own word. 75% |
| `WriteOptions` | how a fact is written | none needed | ok | |
| stall rule / `Stall` / `.last`, `.lowest`, `.stalls`, `.sinceLowest` / `stallStep` / `asksOnStall` | stop when the open list stops shrinking | none found (searched Temporal, Erlang restart intensity, Agile) | ok | |
| `Folded` / `.plans`, `.asks`, `.answered`, `.superseded`, `.builds` / `foldLedger` | everything the facts say, as one state | projection ([Marten, projections](https://martendb.io/events/projections/)); fold | ok | |
| `foldsOf` / `PlanTrack.folds` | tickets triage folded into a plan | sub-issues | collides | `foldsOf` and `foldLedger` sit in one file and mean two things (section 8). 75% |
| `BuildTrack` / `.plan`, `.task`, `.build`, `.changes`, `.holds`, `.heard` / `readyBuilds` | one build and what holds it | none needed | ok | |
| `planAskId` / `stuckId` / `rulingId` / `checkId` / `criteriaOf` / `bookOf` / `latestOf` / `planFor` / `firstTaskOf` / `openAsks` / `problemWith` / `nextOf` | the fold's reads | none needed | ok | |
| `asksProgram` / `Reviewed` / `Revised` / `Ruling` / `Build` / `Built` / `BuildRef` / `Cleared` / `Raise` | the asks program's inputs | none needed | two-ideas | `Built` is now exported three times and `Reviewed` twice (sections 3 and 5). 70% |
| `Told` / `.on: fact, answer` | what the program heard | none needed | two-words | one more tag key, `on` |
| `Lanes` / `claim` / `release` / `holding` / `holderOf` / `newLane` / `layerLanes` | who holds a ticket | lease ([Kubernetes, leases](https://kubernetes.io/docs/concepts/architecture/leases/)) | ok | |
| pack / `Pack` / `loadPacks` / `startWithPacks` / `misfit` / `Loaded` / `PackRefused` / `Wired` / `StartedPack` / `readerOf` | an add-on program that hears the core | plugin; extension ([VS Code, extensions](https://code.visualstudio.com/api)) | differs | keep `pack`: the direction note picked it and "plugin" is taken by the Claude Code plugin. 60% |
| `Places` / `Typed` (`id`, `text`) / `Shell` (packs) / `Hosting` (packs) | a pack's folders, a typed answer, its shell, its hosting | none | two-ideas | `Shell` is also fabrika's shell; `Hosting` is also `hosted/deliver.ts`'s. 70% |
| laws / `lawHome` / `lawUnfenced` / `lawLost` / `lawOneWins` / `lawRelease` / `runPipelineLaws` | rules every run must keep | invariant ([TLA+](https://lamport.azurewebsites.net/tla/tla.html)); property ([fast-check](https://fast-check.dev/docs/core-blocks/properties/)) | two-words | with `Promise` → `Property` picked, "law" and "property" now name one idea. Keep `law` (every-machine-has-laws.md); gloss it. 50% |
| `RULINGS` / `Truth` / `changed` / `numberOf` / `plans86b` | the experiments' saved cases | fixtures | ok | |
| program / `defineProgram` / `.flags`, `.inputs`, `.outputs` | a long-running service a host serves | a durable entity ([Akka, entity](https://doc.akka.io/libraries/akka-core/current/typed/cluster-sharding.html)) | ok | |
| `kind` (fabrika) | a machine a program declares once | entity type (Akka `EntityTypeKey`, Effect `Entity.make`) | two-ideas | `kind` is also every outcome's tag and the ledger row's event type. The outcome tag is the most read: keep that, rename this one `type`. 50% |
| `Self` / `.name`, `.fence`, `.incarnation`, `.holder`, `.inbox`, `.reads` | the program's own handle | `self()` ([Erlang, processes](https://www.erlang.org/doc/system/ref_man_processes.html)) | ok | |
| `Ledger` / `Row` / `.pos`, `.stream`, `.rev`, `.writer`, `.kind`, `.at`, `.data`, `.id` | the one store under the host | an event store ([Marten, appending](https://martendb.io/events/appending.html)) | two-ideas | `Row` is also the criteria book's review row and ship's `Row`. Ledger one → `Record`. 60% |
| `Fenced` (error) / `Fenced` (`"fenced" \| "unreachable"`) | the lease is gone | fencing token ([Kleppmann, 2016](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)) | two-ideas | two exports of one name: the type → `FenceWord`. 60% |
| `Monitoring` / `Starting` / `Holding` / `Charging` / `.how` | the host call answers | monitor ([Erlang, monitors](https://www.erlang.org/doc/system/ref_man_processes.html)) | ok | `how` is one more tag key |
| host `jobs` table / `.kind: deadline, lease_expiry` / `.due_at` | the host's scheduled wake-ups | timers ([Temporal, timers](https://docs.temporal.io/workflows)); alarms ([Durable Objects, alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)) | two-ideas | `job` is also plan's criterion and every hosted stage's input. `timers`. 75% |
| `Limits` / `.usd`, `.tokens`, `.wallMs`, `.children` | a run's caps | quotas | two-words | `usd` here, `budget` in Settings, `maxBudgetUsd` in the Agent SDK. Settle one money word. 65% |
| `Spend` / `.costUsd`, `.tokens`, `.context`, `.turns`, `.minutes` / `noSpend` | what a run cost | usage ([Anthropic API, usage](https://docs.anthropic.com/en/api/messages)) | two-words | `Usage`, `noUsage` (picked 2026-10-24) |
| `DraftRun.key`, `.id`, `.prompt`, `.session` (`id`, `continues`), `.agent`, `.folder` | one agent run | session ([Claude Agent SDK, sessions](https://docs.claude.com/en/docs/agent-sdk/sessions)) | ok | `key` follows the combo's `key` row |
| supervisor / `one_for_one` and the rest | OTP's supervisor as a program | supervisor ([Erlang, supervisor](https://www.erlang.org/doc/system/sup_princ.html)) | ok | |
| dead letters / `deadLetters` / `redrive` / `.strikes` | messages set aside after crashing a program | dead-letter queue and redrive ([AWS, SQS dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)) | ok | |
| journal | a program's saved state on the ledger | journal | ok | |
| outbox | a pipe's never-lost send | transactional outbox ([microservices.io](https://microservices.io/patterns/data/transactional-outbox.html)) | ok | |
| kept / `program/kept.ts` | a machine run whose state is saved | durable; persisted | two-ideas | "kept" is also a property's `is: "kept"`, `keeps` an id, and a review note's state. `durable.ts`. 65% |
| tag keys: `kind`, `type`, `phase`, `answer`, `go`, `flow`, `ev`, `how`, `reading`, `step`, `do`, `on`, `op`, `at`, `for`, `is`, `sure`, `pass`, `_tag` | the key that tells a union's cases apart | discriminant ([TypeScript, discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)); Effect's `_tag` | two-words | one key per role: `_tag` for errors (Effect), `type` for Msgs (Elm and Redux), `phase` for states, `kind` for every other data union. 60% |

## What the sweep could not settle

Each of these needs an owner's pick, or a fact the sweep did not have.

- **The tag key.** Nineteen keys tell union cases apart. The proposal (one key per role) is
  60%. What would settle it: count how often each is read in code and tests, and check
  which key tea's own `Cmd`, `Sub` and Msg types use.
- **`Check`, the move and the value.** NASA's "verification method" fits plan's value. But
  the move's name is one of the six in AGENTS.md, so renaming the value is the cheap
  side. 70%: a reader may still mix up `Verify` and `Check`. **Settled 2026-10-24,** another
  way: plan's value goes, and a check is a `Property` or a `Criterion` by who checks it. The
  lean, `Verify`, was not taken.
- **`ask`.** Five meanings. No tracker or workflow engine has one word for "a record waiting
  on a person": Camunda says user task, LangGraph says interrupt, Temporal has none. The
  sweep keeps `Ask` for the asks core and renames the others. 60%.
- **`fold`.** GitHub and Linear say sub-issue and parent. A plan is not quite a parent
  issue: it is a design that covers tickets. `attach` or `join` is 75%; which one is a
  matter of taste.
- **Money words.** `usd`, `budget`, `cost`, `costUsd`, `spend` and `maxBudgetUsd` name a cap
  or what was paid. The `Usage` pick covers what was paid. The cap still needs one word:
  `budget` (what it is) or `usd` (its unit).
- **Tries.** `tries`, `limit`, `MAX_RUNS`, `DEFAULT_TRIES`. Temporal says `maximumAttempts`.
  `attempts` would match it; `tries` is shorter and already the most used. 55%.
- **`Fact` or `Event`.** Datomic says fact, event sourcing says event, and the fabrika
  ledger says event. 65%: `Fact` is spread over many files and the direction notes.
- **Lane or parent; sort or triage; ruling or decision; research or spike.** All four are
  plain words already in the direction notes. The sweep leans `triage` (80%) and keeps
  the other three, glossed. Each is the owner's word to keep or drop.
- **`Property` and `tool: "property"`.** The pick of `Property` makes the tool word read
  as the type. `"pbt"` is 70%; `"fast-check"` names a tool, not a method. **Settled
  2026-10-24:** `tool: "test" | "tla"`. The lean, `"pbt"`, was not taken.
- **`kind` in fabrika.** The program's machine kind follows Akka and Effect. The outcome's
  `kind` is read far more. Renaming fabrika's (50%) touches every program.
- **`job`.** Three meanings. Renaming the hosted inputs to `*Input` and the host table to
  `timers` leaves plan's `job` alone. Whether plan's first criterion should be called a job
  at all is a design question, not a naming one. **Settled 2026-10-24 for plan:** a task's
  `job` is its `scenario`. The hosted inputs and the host table are not picked.

What this sweep cannot tell us:

- It renames nothing. No proposal is tested on a reader, so each confidence is one
  person's judgment, not a measure.
- It reads code, not the experiments' write-ups or the direction notes, except where a
  name comes from one. A name used only in prose is not here.
- It covers `packages/pipeline` and the `@kampus/fabrika` names the pipeline imports. It
  does not cover `programs/*`, `packs/*`, `wip`, `legacy`, or fabrika's own internals.
- A link was checked for an HTTP 200, and a few anchors that did not resolve were dropped.
  A page that moves later is not caught.
