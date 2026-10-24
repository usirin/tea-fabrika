# Naming sweep

**Proposed** 2026-10-24. A draft. It proposes names; it renames nothing. The
owner picks machine by machine, then one rename pass and a short glossary page
follow, as [Use the industry's names](./direction/use-the-industrys-names.md)
says. A row marked **picked 2026-10-24** is the owner's choice; the rename
pass has not run yet.

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

## The worst clashes, first

*Filled in as the sections land.*

- **`Check`** is a move (code judges an output) and also plan's `{how, what}`
  value on every criterion. `planProblems` is typed `Check<PlanDraft, Known>`
  in the same folder that exports the value `Check`.
- **`readFacts`** is exported twice: plan's Gather of what the code says, and
  the ledger's read of its event log. `Facts` means "code facts" in plan,
  "events" in the ledger, and "what the gate read" in `packages/promises`.
- **`job`** is a task's first criterion in plan, and a scheduled row in the
  host's `jobs` table (deadlines and lease expiry).
- **`ask`** is an outcome verb, the ledger's question waiting on a person, a
  plan question's text, and (until the pick) the machines' input type.
- **`Verdict`** is exported four times: the criteria book's review row, the
  promise check's printed result, review's verdict, and the ACP builder's
  permission answer.
- **`Built`** is exported twice in build, with two shapes; **`PlanState`** is
  both plan's machine state and build's "is the plan approved".
- **`Property`** (picked for `Promise`) now clashes with the promise's own
  `tool: "property"`.
- **`Revision` vs `Version`:** a revision is a plan's next words written by
  code; a version is a criterion's wording number. Each version of a plan is
  also called a version in the comments.

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
| `Revision` | a plan's next words, written by code that holds the last version | an update input ([Prisma, partial types](https://www.prisma.io/docs/orm/prisma-client/type-safety/operating-against-partial-structures-of-model-types)); elsewhere a revision is a saved version ([MediaWiki, revision](https://www.mediawiki.org/wiki/Manual:Revision_table)) | two-words | `PlanUpdate`, so "revision" and "version" stop meaning one thing. 55% |
| `Revision.keeps` (task, criterion, question) | the id a next version keeps | supersedes; none standard (searched event sourcing, Prisma, JSON Patch) | ok | |
| `Version` (criteria book) | which wording of a criterion: 1, then one more per reword | version, as an event stream's count ([Marten, appending events](https://martendb.io/events/appending.html)) | ok | keep; `Revision` is what moves |
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
| `Task.job` | the task's first criterion | see `Job` | two-ideas | see `Job` |
| `Task.criteria` | the single claims after the job | acceptance criteria ([Atlassian](https://www.atlassian.com/work-management/project-management/acceptance-criteria)) | ok | |
| `Criterion` | one observable claim, "When ‹when›, ‹result›" | acceptance criterion in Given/When/Then form ([Cucumber, Gherkin](https://cucumber.io/docs/gherkin/reference/)) | two-ideas | review's `pack.ts` exports another `Criterion` (section 5) |
| `Criterion.id` | `c1`, `c2`, kept for life by the criteria book | none standard | ok | |
| `Criterion.version` | which wording it is at | see `Version` | ok | |
| `Criterion.when` | the trigger, without "When" | When (Gherkin) | ok | |
| `Criterion.result` | what someone can observe | Then (Gherkin) | differs | keep: a key `then` makes an object read as a Promise. 85% |
| `Criterion.check` | how someone will see it hold | see `Check` | two-ideas | see `Check` |
| `Criterion.serves` | the stories it serves, never empty | traceability, "satisfies" ([Wikipedia, requirements traceability](https://en.wikipedia.org/wiki/Requirements_traceability)) | differs | keep: plain, and reads as a sentence. 60% |
| `Job` / `PlanJob` | a task's first criterion: the user's whole job on a realistic fixture | a scenario ([Cucumber, Scenario](https://cucumber.io/docs/gherkin/reference/#scenario)); the user's job is jobs-to-be-done ([HBR, 2016](https://hbr.org/2016/09/know-your-customers-jobs-to-be-done)) | two-ideas | `Scenario`, key `scenario`. The host's `jobs` table and every job queue ([BullMQ, jobs](https://docs.bullmq.io/guide/jobs)) mean a scheduled unit of work. 65% |
| `Job.fixture` | the realistic case it runs on | test fixture; Gherkin's Given ([Wikipedia, test fixture](https://en.wikipedia.org/wiki/Test_fixture)) | ok | |
| `Check` | how someone will see a criterion hold | verification method: test, analysis, inspection, demonstration ([NASA SE handbook, 5.3](https://www.nasa.gov/reference/5-3-product-verification/)) | two-ideas | `Verification`, key `verify`. Check stays the move. 55%: "verify" may be taken by the verify writer |
| `Check.how` | `test`, `typecheck`, `run` or `read` | the four methods (same source) | differs | keep the four plain words |
| `Check.what` | what the check does; for `run`, the command | procedure | ok | |
| `Pointer` | a file, function or test a builder may start from; binds nobody | none found as a standard term (searched Agile, Linear, GitHub issue forms); "pointer" is a memory address in C | differs | `Hint`, key `hints`. 50%: no source for either |
| `Pointer.at` | the place | location | ok | |
| `Pointer.why` | why it matters | reason | ok | |
| `Question` | a product call the ticket leaves open, written with a lean | considered options and a recommendation ([MADR](https://adr.github.io/madr/)) | ok | |
| `Question.id` | `q1`, `q2`, never given twice | none | ok | |
| `Question.ask` | the question's words | the question | two-ideas | `text`: `ask` is also an outcome verb and the ledger's waiting question. 55% |
| `Question.options` | the choices | considered options (MADR) | ok | |
| `Question.lean` | the choice the plan is written with | recommendation; MADR's "decision outcome" | differs | keep: plain, and says it is not decided. 65% |
| `Question.why` | why that lean | rationale (MADR) | ok | |
| `Goal` | the plan's own job and criteria; absent on a one-task plan | epic-level acceptance criteria (SAFe); "goal" is the story template's "I want ‹goal›" | differs | `whole`, or keep `goal`. 45%: no clean industry word |
| `Goal.job` | the plan's whole job | scenario | two-ideas | follows `Job` |
| `Goal.criteria` | the plan's single claims | acceptance criteria | ok | |
| `withIds` / `numbered` / `Numbered` | give every task, criterion and question its id | assign identity ([Fowler, Evans classification](https://martinfowler.com/bliki/EvansClassification.html)) | two-words | **picked 2026-10-24:** `Numbered` → `WithIds`; `withIds` stays, `numbered` folds into it |
| `Numbered.plan` / `.book` / `.events` | the plan under ids, the book after it, the events between | aggregate and its events ([Fowler, event sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)) | ok | |
| `revisionOf` / `revisionOfDraft` / `keptFrom` | turn a plan or a draft into a next version | follows `Revision` | differs | follows the `Revision` pick |
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
| `PlanReport.facts` | facts were gathered and handed over | see `Facts` | two-ideas | follows `Facts` |
| `PlanReport.spend` | what the runs cost | usage | two-words | follows the `Usage` pick: `usage`. 80% |
| `PlanTicket` | a ticket as the planner reads it | issue ([GitHub REST, issues](https://docs.github.com/en/rest/issues/issues)) | ok | |
| `PlanTicket.url`, `.number`, `.state`, `.title`, `.body` | the issue's fields | the same names (same source) | ok | |
| `PlanTicket.at` | the commit to read the code at; `null`, the clone's own | a ref ([git glossary, ref](https://git-scm.com/docs/gitglossary)) | differs | `ref`. 50% |
| `Facts` / `PlanFacts` / `readFacts` | what the code says about the names and paths a ticket mentions | retrieved context ([Anthropic, contextual retrieval](https://www.anthropic.com/engineering/contextual-retrieval)); the ledger's facts are Datomic's word for stored events ([Datomic, data model](https://docs.datomic.com/whatis/data-model.html)) | two-ideas | `CodeFacts`, `readCodeFacts`; the ledger keeps `Fact`. Not `Context`: Effect has one. 60% |
| `Facts.text` | what code found, as the planner reads it | none needed | ok | |
| `Facts.names` | the names a user of the published packages meets | public API names ([API Extractor](https://api-extractor.com/pages/overview/intro/)) | differs | follows `userNames` |
| `Settings` (plan; review has its own copy) | how the planner may run | run options | ok | one shared type would do |
| `Settings.model` | the model id | model ([Anthropic API, messages](https://docs.anthropic.com/en/api/messages)) | ok | |
| `Settings.effort` | `low`, `medium`, `high` | effort (Claude's effort setting) | ok | |
| `Settings.budget` | the dollars one run may cost | budget (`maxBudgetUsd`, Agent SDK) | ok | |
| `PlanHost` | reads the ticket (GitHub, or the replay set) | issue tracker; fabrika's `host` runs programs ([Erlang, applications](https://www.erlang.org/doc/system/applications.html)) | two-ideas | `PlanTickets` or `TicketSource`. 65% |
| `Planner` / `livePlanner` | the one agent inside plan | planner, in plan-and-execute agents ([LangChain, planning agents](https://blog.langchain.dev/planning-agents/)) | ok | |
| `Brief` | what the planner is handed | prompt context | ok | |
| `Brief.ticket` | the ticket | issue | ok | |
| `Brief.facts` | what code found, as text; `null`, nothing | retrieved context | two-ideas | follows `Facts` |
| `Brief.names` | the user names a criterion may use | public names | differs | follows `userNames` |
| state `key` | the conversation's name, new each start | session id ([Claude Agent SDK, sessions](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-sessions)) | two-ideas | **picked 2026-10-24:** `session`, as build already says |
| state `phase`: `idle`, `reading`, `gathering`, `drafting`, `over` | where the machine is | state; Elm's Model ([Elm guide](https://guide.elm-lang.org/architecture/)) | ok | |
| state `ask`, `settings`, `ticket`, `asked`, `refining`, `facts`, `spend`, `restarts`, `outcome`, `report` | what each phase holds | none needed | ok | `ask` follows `PlanInput` (`input`); `spend` follows `Usage` |
| `restarts` / `MAX_RESTARTS` | times a restart started the planner over | restart intensity ([Erlang, supervisor](https://www.erlang.org/doc/system/sup_princ.html#maximum-restart-intensity)) | ok | |
| `stuck:unchecked` | the last plan still has problems and the tries are spent | none found; it was checked, and failed | differs | **picked 2026-10-24:** `stuck:unfixed` |
| `ask:owner:questions`, `skip:closed`, `stuck:read_failed`, `draft_failed`, `over_budget`, `cut_off` | plan's other outcomes | the five verbs ([outcome names](./direction/outcome-names.md)) | ok | |
| `Planned` | how one plan ended | workflow result | ok | |
| `Planned.ticket`, `.outcome`, `.name` | the ticket, the outcome, its printed name | none needed | ok | |
| `planProgram`, `planToTheEnd` | the program, and a run to its end | workflow | ok | `planKind` is the `kind` question, section 9 |
| `Line` | one thing an owner can approve, change or name | none needed | ok | |
| `Line.key` | its id: `summary`, `s1`, `t1`, `c1`, `q1`, `p1` | key | ok | |
| `Line.text` | its words | text | ok | |
| `Line.criterion` | the criterion it is, or `null` | none needed | ok | |
| `Changed` | what changed between two versions | a diff ([git diff](https://git-scm.com/docs/git-diff)) | ok | |
| `Changed.added` / `.removed` / `.reworded` / `.same` | lines added, removed, said otherwise, unchanged | added, deleted, modified (git) | ok | `reworded` is git's word for an edited message ([git rebase](https://git-scm.com/docs/git-rebase)) |
| `Reworded.key` / `.was` / `.now` | one criterion's old and new words | before and after | ok | |
| `userNames` / `Published` | every name a package shows its users | public API surface ([API Extractor](https://api-extractor.com/pages/overview/intro/)) | differs | `publicNames`. 60% |
| `Published.manifest` / `.docs` | the parsed `package.json`, and each doc page | manifest ([npm, package.json](https://docs.npmjs.com/cli/v10/configuring-npm/package-json)) | ok | |
| `Claim` (local) / `claimFields` / `claimProblems` | one criterion's words | assertion; the ledger's `claims.ts` means a held ticket (a lease) | two-ideas | `Statement`. Local type, low cost. 50% |
| `Known` | the user names known, or `null` | none needed | ok | |
| `PlanCmd`, `RunSub` | the machine's Cmds and its Sub | Cmd and Sub ([Elm guide, subscriptions](https://guide.elm-lang.org/effects/time.html)) | ok | |

## 2. The verify writer and promises

Not built yet as a stage. The names come from
[Promises in the pipeline](./direction/promises-in-the-pipeline.md) and from
`packages/promises/`, the record and gate built in experiment 117, whose names
a promise stage would inherit.

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Promise` (sketch type) | a criterion that lasts after the ticket closes: what the code always does | a property, safety or liveness ([learn TLA+, temporal properties](https://learntla.com/core/temporal-logic.html)); JS's own `Promise` ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)) | collides | **picked 2026-10-24:** `Property`. It now clashes with `tool: "property"`, see that row |
| promise vs law | a promise is a lasting rule on the code; a law is a rule a machine must always keep ([every machine has laws](./direction/every-machine-has-laws.md)), and the record's `check` runs a law | both are properties of the system | two-words | decide whether a property is "a law the owner approved". If yes, one word. 50%: a property can span machines, a law sits on one |
| `Promise.says` | the property in one plain sentence | statement | two-words | the record calls it `promise`; `says` in both. 70% |
| `Promise.harm` | what goes wrong for someone if it breaks | failure effect ([FMEA](https://en.wikipedia.org/wiki/Failure_mode_and_effects_analysis)) | ok | plain word for the effect column |
| `Promise.is` | `"new"` or `"kept"` | none for the key; a discriminant is `kind` in our outcomes | differs | `kind`, so it reads like every other tagged value. 55% |
| `"new"` | the ticket adds it; its check must be red on today's code | a new test written red first ([Fowler, TDD](https://martinfowler.com/bliki/TestDrivenDevelopment.html)) | ok | |
| `"kept"` | today's code must already keep it, and the ticket must not break it | a regression test ([Wikipedia](https://en.wikipedia.org/wiki/Regression_testing)); a characterization test ([Wikipedia](https://en.wikipedia.org/wiki/Characterization_test)) | two-ideas | `"regression"`. `kept` already means "persisted" in fabrika (`program/kept.ts`) and "keeps an id" in plan. 65% |
| `Promise.tool` | which kind of check keeps it: `property`, `tla`, `proof` (the record adds `search`) | model checking ([Wikipedia](https://en.wikipedia.org/wiki/Model_checking)), property-based testing ([fast-check](https://fast-check.dev/docs/core-blocks/properties/)), proof | ok | |
| `tool: "property"` | a property-based test | property-based test (same source) | two-ideas | with the type now `Property`, `tool: "property"` reads "a property kept by a property". `"pbt"`, as tea's own `@demlik/tea/pbt` says. 70% |
| `Promise.covers` / `Covers` / `Piece` | the code a property is about, by file and top-level name | coverage; Stryker's `coveredBy` ([Stryker, mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)) | ok | |
| record `promise` | the sentence (the sketch's `says`) | statement | two-words | `says`. 70% |
| record `harm`, `tool`, `covers` | as in the sketch | as above | ok | |
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
| verify writer | the agent, not the builder, that writes each check before the build | test generator in Meta's ACH ([Meta, 2025](https://arxiv.org/abs/2501.12862)); evaluator in an evaluator-optimizer loop ([Anthropic, building effective agents](https://www.anthropic.com/engineering/building-effective-agents)) | differs | `tester`, outcome `send:tester:mutant_survived`. 55%: "tester" may read as a person |
| `writeChecks` / `checks_write`, `checks_today`, `checks_hold`, `checks_kill_mutants` | the steps that write and run the property checks | tests or specs; "check" is also the move and a GitHub check run | two-ideas | `tests_write`, `tests_today`, ... while the tool is a test. 50% |
| red first | a new property's check fails on today's code | red, green, refactor ([Fowler, TDD](https://martinfowler.com/bliki/TestDrivenDevelopment.html)) | ok | |
| `in step` / `checks_in_step` | every record's prints match the code | no drift; none standard | ok | |
| `mutant`, kill, survived, equivalent mutant | mutation testing's words | the same ([Stryker, introduction](https://stryker-mutator.io/docs/stryker-js/introduction/)) | ok | |
| skip list | kinds of mutant left out, such as log text | Stryker ignorers ([Stryker, configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)); Google's arid nodes | differs | `ignore list`, Stryker's own word. 75% |
| disable comment | `// Stryker disable` on one line, with a reason | the same ([Stryker, disable mutants](https://stryker-mutator.io/docs/stryker-js/disable-mutants/)) | ok | |
| `ask:owner:already_kept`, `ask:owner:not_kept` | the plan was wrong about today's code | none found | differs | follow the `kept` pick: `already_holds`, `regression`. 50% |
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
