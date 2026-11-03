# Naming sweep: the pipeline

**Proposed.** Part of [the naming sweep](./README.md), which holds the status,
the marks, every pick and the open list. This file holds the rows for
`packages/pipeline`, `packages/promises` and `packages/ledger-server`: 1281
rows, one `##` per module.

- Sections 1 to 9 are the first draft (2026-10-24), by stage. The 2026-10-28
  pass added the names the draft missed to the end of each matching table.
- The sections after section 9 are new ground from the 2026-10-28 pass:
  `laws/`, `tsh/`, `hosted/`, `asks/`, `catchup/`, `operate/`,
  `test-writer/`, `criteria/`, `tickets/`, the code hosts, settings and
  setup, and `ledger-server`.
- Picks keep their date: **picked 2026-10-24** or **picked 2026-10-28**.
- On the 2026-10-28 pass, some links were opened and some were written from
  known pages; a row says so where it matters.

## The ten worst clashes

From the first draft, 2026-10-24.

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
   Picked 2026-10-24: plan's is `scenario` now. Picked 2026-10-28: `job`
   stays for a tsh line, as in bash; the hosted inputs become `*Input`.
5. **`fold`** is reading the ledger into state (`foldLedger`, `Folded`) and a
   ticket joining a plan (`fold`, `foldsOf`), in the same file. Picked
   2026-10-28: `fold` stays for reading the ledger into state (a left fold).
   A ticket joining an open plan is "added to a plan" in the rebuilt
   pipeline; the old `fold` and `foldsOf` are rebuilt, not renamed.
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

## Ten more, from the 2026-10-28 pass

1. **`job`, four ideas.** The shell's job (picked 2026-10-28,
   `packages/fabrika/src/shell/jobs.ts`), every hosted stage's input
   (`hosted/stage.ts` `Stage.job`, `JOB_ID`, all eight `*Job`), plan's old
   `Job` (`stages/plan/plan.ts`) and the sandbox's `Job` (picked
   `SandboxCommand`). Lean: the draft's `*Input` and `input`, 80%.
2. **Names exported many times.** `Verdict` nine times (and `refine.ts`'s
   `verdict` is not pass or fail), `Row` nine, `Entry` eight, `Checked` five
   shapes, `Report` four; `Said`, `Settings`, `Brief`, `Facts` five or more
   each.
3. **`Property`, two ideas, and a record out of step.** `laws/ship-pbt.ts`
   (one law run as a fast-check property) vs the picked plan `Property`
   (`stages/test-writer/brief.ts`). And `packages/promises/src/record.ts`
   still says `promise`, `harm`, `covers`, `tool: property`.
4. **Clashes with built-ins.** `Result` (Effect's `Result`; also two ideas,
   `check-runs.ts` vs `controls.ts`), mutation's `Scope`, `Span` and `Path`
   (Effect), `Machine` (`laws/walk.ts`, shadows tea's), `File` (DOM, test
   writer).
5. **Words that clash with the six moves.** `Act` (`hosted/lane-trace.ts`, a
   TLA+ action), `Move` (`laws/world/search.ts`), `Check`
   (`tickets/ticket.ts`, a GitHub check run). TLA+ says action (90%); GitHub
   says `CheckRun` (85%).
6. **A broken law has four names, a model two.** `Broke`, `Found`,
   `Broken`, `LawBroken`; `World` vs `System`; `Law` with two shapes, plus
   `Safety`. TLA+ says error trace, fast-check says counterexample.
7. **`operate` vs `loop`.** The program and folder say `operate`; the
   machine and its types say `loop`. A stopped child is `stuck:build` there
   and `stuck:build_failed` in the lane.
8. **Two event vocabularies.** `tickets/ticket.ts` and the asks ledger
   (`asks/ledger.ts`) both define `planned`, `reviewed`, `answered`, with
   other shapes. The answer's hash is `saw` in one and `text` in the other.
9. **`desk` and `door`.** `desk` is the owner's ask list (`tsh/desk.ts`,
   `laws/world/laws.ts`) and the app's tile layout (`apps/fabrika/src/desk/`).
   `door` is the ledger server's sign-in, ship's re-read before a write, and a
   mode in the lanes world.
10. **Money and `run` after the picks.** `deliver` takes both `--budget` and
    `--usd`; `Budget` in `laws/sample.ts` is time, not money. `run` still
    means a draft run, a test run and a check run after run -> process, and
    the test writer uses `pid` for a property id (picked 2026-10-28: `propertyId`).

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
| `ask:owner:questions`, `skip:closed`, `stuck:read_failed`, `draft_failed`, `over_budget`, `cut_off` | plan's other outcomes | the five verbs ([outcome names](../direction/outcome-names.md)) | ok | **picked 2026-10-24:** `ask:owner:questions` goes. Plan has no ask of its own: it answers `done`, with the questions inside the plan, and the parent asks the owner once per plan version. The rest stay |
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
| `DraftStory` / `DraftTask` / `DraftGoal` / `RevisedTask` / `RevisedGoal` / `RevisedQuestion` / `PlanCriterion` / `PlanQuestion` | the parts of a plan as drafted, as revised, and with ids | draft, update input | ok | `PlanCriterion` beside `Criterion`, and `PlanQuestion` beside `Question`, read as two ideas; they are one idea with ids added. `Criterion` + `WithIds<Criterion>` after the `Numbered` → `WithIds` pick. 60% |
| `ENDS: pr, answer` | how a task ends: a pull request, or an answer | none standard | ok | |
| `HOWS: test, typecheck, run, read` | how a check is made | verification methods: test, analysis, demonstration, inspection ([NASA SE handbook, verification](https://www.nasa.gov/reference/5-3-product-verification/)) | ok | goes with plan's `Check` value (picked 2026-10-24) |
| `PlanMsg` (`services.ts`) / `PlanMachineMsg` (`machine.ts`) | the Draft's Msg, and the machine's Msg | Msg ([Elm guide, architecture](https://guide.elm-lang.org/architecture/)) | two-words | the machine's is `PlanMsg` in every other stage (`BuildMsg`, `ReviewMsg`); the Draft's would be `DraftedMsg`. 70% |
| `plan_ticket` / `plan_facts` (Cmd tags) / `plan_run` (Sub tag) | the wire names of `readTicket`, `readFacts`, the planner run | Cmd, Sub ([Elm guide, effects](https://guide.elm-lang.org/effects/)) | ok | `plan_facts` → `plan_code_context` already picked |
| `PlannerConfig` / `plannerOptions` / `namesBrief` / `promptFor` | how the live planner is set up and briefed | agent options ([Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-sessions)) | ok | |
| `githubPlanHost` / `planAtMain` / `noFacts` | the GitHub reader, a layer that reads at main, and a reader that says nothing | Effect Layer ([Effect, services](https://effect.website/docs/requirements-management/services/)) | ok | `noFacts` follows `Facts` → `CodeContext` |
| `planInterpret` / `planSubscribe` | the machine's handlers | interpreter | ok | build, review, ship and sort split `XReadInterpret` / `XWriteInterpret`; plan has one. Fine |
| `planMarkdown` (`render.ts`) | the plan as Markdown | render, view ([Elm guide, view](https://guide.elm-lang.org/architecture/)) | ok | |
| `planProblems` / `jobProblems` / `identifiersIn` (`check.ts`) | the Check over a plan, the scenario part, names a plan uses | validation | ok | `jobProblems` → `scenarioProblems`, following the `Job` → `scenario` pick |
| `linesOf` / `hasLine` / `changedLines` / `criteriaIn` (`lines.ts`) | the plan as keyed lines, and what moved between versions | diff | ok | `criteriaIn` is also exported by `review/pack.ts` for another idea: see Across notes |
| `textOf` / `storyText` / `sizeOf` (`plan.ts`) | a plan's text, a story's sentence, counts | none needed | ok | |

## 2. The verify writer and promises

Not built yet as a stage. The names come from
[Promises in the pipeline](../direction/promises-in-the-pipeline.md) and from
`packages/promises/`, the record and gate built in experiment 117, whose names
a promise stage would inherit.

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Promise` (sketch type) | a criterion that lasts after the ticket closes: what the code always does | a property, safety or liveness ([learn TLA+, temporal properties](https://learntla.com/core/temporal-logic.html)); JS's own `Promise` ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)) | collides | **picked 2026-10-24:** `Property`: a check a tool runs, which lasts as a test after the ticket closes. Its tool word is `"test"` now, so the clash with `tool: "property"` is gone (see that row) |
| promise vs law | a promise is a lasting rule on the code; a law is a rule a machine must always keep ([every machine has laws](../direction/every-machine-has-laws.md)), and the record's `check` runs a law | both are properties of the system | two-words | decide whether a property is "a law the owner approved". If yes, one word. 50%: a property can span machines, a law sits on one |
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
| verify writer | the agent, not the builder, that writes each check before the build | test generator in Meta's ACH ([Meta, 2025](https://arxiv.org/abs/2501.12862)); evaluator in an evaluator-optimizer loop ([Anthropic, building effective agents](https://www.anthropic.com/engineering/building-effective-agents)) | differs | **picked 2026-10-24:** test writer, outcome `send:test_writer:mutant_survived` ([The test writer](../direction/the-test-writer.md)) |
| `writeChecks` / `checks_write`, `checks_today`, `checks_hold`, `checks_kill_mutants` | the steps that write and run the property checks | tests or specs; "check" is also the move and a GitHub check run | two-ideas | **picked 2026-10-24:** `tests_write`, `tests_on_base`. "Check" is now only the move's name |
| red first | a new property's check fails on today's code | red, green, refactor ([Fowler, TDD](https://martinfowler.com/bliki/TestDrivenDevelopment.html)) | ok | |
| `in step` / `checks_in_step` | every record's prints match the code | no drift; none standard | ok | |
| `mutant`, kill, survived, equivalent mutant | mutation testing's words | the same ([Stryker, introduction](https://stryker-mutator.io/docs/stryker-js/introduction/)) | ok | |
| skip list | kinds of mutant left out, such as log text | Stryker ignorers ([Stryker, configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)); Google's arid nodes | differs | `ignore list`, Stryker's own word. 75% |
| disable comment | `// Stryker disable` on one line, with a reason | the same ([Stryker, disable mutants](https://stryker-mutator.io/docs/stryker-js/disable-mutants/)) | ok | |
| `ask:owner:already_kept`, `ask:owner:not_kept` | the plan was wrong about today's code | none found | differs | **picked 2026-10-24:** `ask:owner:already_passes`, `ask:owner:fails_on_base`, and a new `ask:owner:cannot_test` |
| `ask:owner:check_change` | a diff touches a check | change to the test oracle | ok | |
| `send:builder:promise_red` | ship found a property red or out of step | failed required check | differs | **follows the pick:** `property_red` |
| `@kampus/promises` (package) | records of formal checks tied to code, and their gate | none | two-ideas | after the `Property` pick the package name is the last big "promise". `@kampus/properties`. 65%: settle once the record picks land |
| `Tool: search, tla, property, proof` (values `search`, `proof`) | which kind of check: the explore checker, TLA+, PBT, a proof | model checking, PBT, proof | two-ideas | the 2026-10-24 pick is `test \| tla`; `search` (the in-repo checker) has no place in it. Pick: is `search` a `test`? Lean yes, 60% |
| `decodeEntry`, `decodeVerdict` | parse a record, a verdict | Effect's `decode` ([Effect, Schema basic usage](https://effect.website/docs/schema/getting-started/)) | ok | |
| `piecesOf` | every piece a record names | none needed | ok | |
| `FOLDER = "promises"` | where records live | none | ok | follows the package rename |
| `Refused` (`_tag: "Refused"`, `.why`) | the tool could not read, or will not write | an error | two-ideas | `Refused` is also review's tool refusal, the asks core's, and others (draft). `PromisesError`. 60% |
| `printOf`, `printsNow` | a piece's hash; every piece's hash now | fingerprint (draft's `Confirmed.prints`) | ok | |
| `readEntries`, `readEntriesAt` | records at the head; at a git ref | none | ok | |
| `runCheck` | run one check command, maybe with the plant | none | two-ideas | "check" is the move and the record's command (draft row, `command` 70%): `runCommand`. 60% |
| `Ran.kind: verdict, none` | the run printed a verdict, or not | none | ok | |
| `judgeAll`, `confirm` | the gate over all records; confirm one | none | ok | `judge` is draft's row (`gate`, 70%) |
| `ExamChange`, `examChanges` | what changed in the exam since the base | none | ok | follows draft's `exam` row |
| `Block` / `.name`, `.from`, `.to`, `.text`; `blocksOf`, `splitPiece`, `textOf` | a top-level statement of a TS file, by name | top-level statement (TypeScript AST, [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API)) | ok | |
| stack frame `kind: code, template` (blocks.ts, local) | the scanner's state | none | ok | |
| `listText`, `detailText`, `gateText` | the text a person reads | none | ok | |
| CLI `pnpm promises`, `gate`, `--base <ref>`, `confirm <id>` | list; CI gate against a base; re-confirm one | `--base` matches git's base ref ([GitHub Actions, `github.base_ref`](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/accessing-contextual-information-about-workflow-runs#github-context)) | ok | `gate` is a verb users type; fine |
| `GITHUB_STEP_SUMMARY` | where the gate writes in CI | job summary ([GitHub, workflow commands](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/workflow-commands-for-github-actions#adding-a-job-summary)) | ok | |

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
| build state `phase`: `idle`, `reading`, `copying`, `building`, `pushing`, `opening`, `over` | where the build is | Elm's Model ([Elm guide](https://guide.elm-lang.org/architecture/)) | ok | |
| `BuildCmd` / `BuildMsg` / `RunSub` / `runSub` | the machine's Cmds, Msgs, and the builder run Sub | Cmd, Sub, Msg ([Elm guide, effects](https://guide.elm-lang.org/effects/)) | ok | `RunSub` is exported by build, plan, review, sort, test writer; `TaskRunSub` in task. Name each by stage or none: `BuildRunSub`. 65% |
| `build_ticket` / `build_copy` / `build_push` / `build_open` (Cmd tags), `build_run` (Sub tag) | wire names of read, copy, push, open, run | Cmd | ok | |
| `buildReadInterpret` / `buildWriteInterpret` / `buildSubscribe` / `msgOf` | the handlers | interpreter | ok | `msgOf` is exported by build and review handlers too |
| `BuildHost` / `BuildWrites` / `.copy` | the read and write services build talks to | Effect service ([Effect, services](https://effect.website/docs/requirements-management/services/)) | ok | |
| `BuildConfig` / `.work` / `cloneIn` / `urlOf` / `gitHubBuild` / `INSTALL_BEFORE` | the GitHub-backed services and where they clone | clone ([git clone](https://git-scm.com/docs/git-clone)) | ok | |
| `pushBranch` (Cmd) / `Pushed` | push the round's commit | push ([git push](https://git-scm.com/docs/git-push)) | ok | |
| `bodyOf` / `messageOf` / `bodyText` / `messageText` | the pull request body and the commit message | commit message ([Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)) | ok | |
| `TicketUrl` / `TicketAt` / `.owner` / `.name` / `.number` / `ticketOf` / `openOf` | a ticket's url, parsed | issue url | ok | `TicketAt` holds no time and no place, only a ref; "at" is already five ideas (draft). `TicketRef`. 70% |
| `PLAN_STATES` | the plan states a ticket can be in | status | ok | |
| `Builder` / `.build` | the builder service | agent | ok | its tag string is `"BuildStageBuilder"`, not `"Builder"` |
| `BuildDrafted.answer: built, misfit, over_budget, broke` | what a builder run handed back | structured output | ok | `answer` is a tag key (tracker #32, not picked) |
| `BuilderConfig` / `builderOptions` / `builderDraft` / `draftLive` / `liveBuilder` / `carryOnOf` / `RulesShown: loaded, pasted` | the live SDK builder, and its "carry on" prompt after a restart | resume a session ([Claude Agent SDK, sessions](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-sessions)) | ok | |
| `AcpBuilder` / `AcpBuilderConfig` / `draftAcp` / `liveAcpBuilder` / `viaAcp` / `underGuard` | the builder over ACP | [Agent Client Protocol](https://agentclientprotocol.com/) | ok | |
| `ALLOWED` / `Call` / `.id` / `.tool` / `.status` | tools the ACP builder may call, and one tool call | tool call ([MCP, tools](https://modelcontextprotocol.io/docs/concepts/tools)) | ok | |
| `SdkResult` / `.subtype` / `.turns` / `.costUsd` / `sdkResultOf` / `TurnAsk` / `runTurn` / `Turn` | one SDK result message, one turn's input, one turn | result message, turn ([Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-sessions)) | two-words | `Turn` is also hosted/agent's `Turn` (draft). `TurnAsk` → `TurnInput` (the `*Input` pick). 75% |
| `checkedOf` | a tool call's verdict from the hook | hook decision ([Claude Code, hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)) | ok | |
| `SERVER = "report"` / `TOOL = "report_build"` / `REPORT_TOOL` / `reportServer` (`report.ts`) | the MCP server and tool the builder hands its form in on | MCP tool ([MCP, tools](https://modelcontextprotocol.io/docs/concepts/tools)) | two-words | review's `tools.ts` also exports `SERVER`: two consts with one name in two files. `REPORT_SERVER`. 70% |
| `Guarded` / `guarded` / `.spawn` / `.refused` / `WAIT_SECONDS` | a process started under the lock guard | file lock ([flock(1)](https://man7.org/linux/man-pages/man1/flock.1.html)) | ok | |
| `rowOf` / `Row` / `under` / `toStop` / `stopTree` / `parseArgs` (`guard.ts`) | the guard's process table and the tree it stops | process tree; `ps` rows ([ps(1)](https://man7.org/linux/man-pages/man1/ps.1.html)) | two-ideas | `Row` is exported in three more places (draft). `ProcessRow`. 75%. Uses the picked "process" word (2026-10-28) |
| `builtBy` / `scriptedBuilder` / `built` (`scripted.ts`) | a builder that answers from a script, for tests | test double, stub ([Fowler, mocks aren't stubs](https://martinfowler.com/articles/mocksArentStubs.html)) | ok | |
| task (the stage, `task` machine) | builds one task of a plan as a commit on the plan's branch | sub-task ([GitHub, sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)) | two-ideas | `Task` is also plan's `Task` (the data) and build's `Task` state. The machine: `taskBuild`. 65% |
| task state `phase`: `idle`, `reading`, `building`, `pushing`, `over` | where it is | Elm's Model | ok | |
| `readTask` (`task_read`) / `pushTask` (`task_push`) / `TaskCmd` / `TaskRunSub` (`task_run`) / `taskRunSub` | read the view, push the commit, run the builder | Cmd, Sub | ok | |
| `pushTask` input `round`, `branch`, `base`, `message` | where and what to push | push | ok | |
| Msg `task_built` / `task_failed` `.why: broke, misfit, over_budget` / `.error` / `.ran` | the builder's answer | structured output | ok | same three words as build's `Failed` (draft) |
| `TaskOutcome` / `TaskName` / `TASK_NAMES`; `done {head, changed}`; `skip: closed, not_approved, removed`; `stuck: read_failed, no_criteria, draft_failed, over_budget, push_failed` | the five verbs | five verbs ([outcome names](../direction/outcome-names.md)) | ok | `not_approved` vs build's `not_ready` is in the draft |
| `planNumberOf` / `issueOf` / `planCriteriaOf` (`view.ts`) | a plan's number, its issue url, its criteria | none needed | ok | |

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
| `MutationAsk` / `.ticket` / `.base` / `.head` / `.kept` / `.exam` / `.allowed` / `.seed` / `.most` | the input: the change, kept code refs, test files, the owner's allowed changes, the sample seed and cap | workflow input | differs | `MutationInput` (the `*Input` pick). `most` → `max`? `most` reads fine; `MAX_MUTANTS` already says max. 60% |
| `MAX_MUTANTS = 150` / `sampleOf` / `seed` | a seeded random sample of mutants | mutant sampling ([Wikipedia, mutation testing](https://en.wikipedia.org/wiki/Mutation_testing)) | ok | |
| `.exam` / `Scope.exam` / `Change.kind: exam` | the test files and the ignorer, the code that judges | test oracle | differs | the draft calls this "the test oracle" in `ask:owner:check_change`. "exam" is ours. `oracle` 55%: plain gloss works too |
| `readScope` (`mutation_scope`) / `runTests` (`mutation_tests`) / `runMutants` (`mutation_run`) / `MutationCmd` / `MutationMsg` | read the lines, run the tests at head, run Stryker | Cmd; `checkRun` is a Check move | ok | |
| state `Mutation` / `phase`: `idle`, `reading`, `testing`, `mutating`, `over` | where it is | Elm's Model | two-ideas | `Mutation` is the state type and `mutation` the machine, as `Review` / `review` (draft: `ReviewState`). `MutationState`. 80% |
| `MutationReport` / `.changes` / `.spans` / `.ran` | what the run saw | report ([Stryker, reporters](https://stryker-mutator.io/docs/stryker-js/configuration/)) | ok | |
| `MutationOutcome`; `done {}`; `send: test_writer: mutant_survived`; `ask: owner: check_change`; `skip: no_lines`; `stuck: read_failed, tests_red, run_failed` | the five verbs | survived, killed ([Stryker, mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)) | ok | |
| `outcomeOf` (`machine.ts`) | the outcome from a run | none needed | two-ideas | exported also by review `verdict.ts`, sort `writes.ts`, test-writer `mutants.ts`, and the draft's hosted `outcomeOf`. Fine as a local, but five exports of one name. Leave, or prefix by stage. 55% |
| `RunAsk` / `.head` / `.spans` / `.seed` / `.most` | one Stryker run's input | workflow input | differs | `RunInput` (the `*Input` pick) |
| `Ran` / `.found` / `.ran` / `.ignored` / `.compileErrors` / `.killed` / `.survived` | the run's counts | Stryker's states: Killed, Survived, Ignored, CompileError ([Stryker, mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)) | two-ideas | `Ran` is also review's `Ran` (an agent run's cost and tools) and the promises' `Ran` (draft). `MutantRun`. 75% |
| `CouldNotRun` (`_tag: could_not_run`) | Stryker or the tests could not start | none needed | ok | |
| `MutationRunner` / `.tests` / `.run`; `MutationScope` / `.read` | the services | Effect service | two-ideas | `MutationScope` beside `Scope` (data) reads as one idea; and `Scope` is Effect's ([Effect, Scope](https://effect.website/docs/resource-management/scope/)). See `Scope` |
| `MutantId` (`file:line:col:hash`) / `idOf` | a mutant's stable id | mutant id ([Stryker, mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)) | ok | `idOf` also in review `sheet.ts` |
| `Survived` / `.mutant` / `.mutator` / `.original` / `.replacement` | one mutant that lived | survived; mutator ([Stryker, supported mutators](https://stryker-mutator.io/docs/mutation-testing-elements/supported-mutators/)) | ok | |
| `Place` / `.file` / `.line` / `.column` / `.mutator` / `.replacement` (`mutant.ts`) | where a mutant is, to hash an id | location | two-ideas | review's `Place` is `{file, first, last}` (draft). `MutantAt`. 70% |
| `Span` / `.file` / `.from` / `.to` | a run of changed lines | hunk ([git diff](https://git-scm.com/docs/git-diff)); line range | collides | "span" is OpenTelemetry's word, used in `traced.ts` and `trace/`. `LineRange`. 80% |
| `Added` / `.file` / `.line` / `.text`; `Diff` / `.files` / `.added` | added lines from the diff | diff ([git diff](https://git-scm.com/docs/git-diff)) | ok | |
| `CodeRef` / `.file` / `.name` | a named function or test in a file | symbol reference | two-words | the test writer's `Property.code` holds the same `{file, name}` inline, unnamed. Reuse `CodeRef`. 85% |
| `Checksum` / `.file` / `.hash` / `hashOf` | a file's hash, `null` when gone | checksum | ok | |
| `Scope` / `.kept` / `.exam` / `spansOf` / `changesOf` / `isSource` / `unapproved` | which lines and which exam files the run covers | mutate scope ([Stryker, configuration `mutate`](https://stryker-mutator.io/docs/stryker-js/configuration/)) | collides | Effect's `Scope` is imported in the same package. `MutateScope` or `Targets`. 75% |
| `Change` / `.kind: disable, exam` | a disable comment, or an edit to the exam | disable comment ([Stryker, disable mutants](https://stryker-mutator.io/docs/stryker-js/disable-mutants/)) | two-ideas | review's `Change` is a pull request (draft). `ExamChange`. 80% |
| `IGNORER = "arid"` / `shouldIgnore` / `strykerPlugins` / `Path` / `.node` / `.parentPath` (`ignorer.ts`) | the Stryker ignorer that skips arid nodes | arid nodes ([Google, State of Mutation Testing](https://research.google/pubs/state-of-mutation-testing-at-google/)); NodePath ([Babel handbook, paths](https://github.com/jamiebuilds/babel-handbook/blob/master/translations/en/plugin-handbook.md)) | collides | `Path` shadows Effect's `Path` service by name. `NodePath`, Babel's own word. 85% |
| `StrykerSetup` / `.folder` / `.tests` / `.typecheck` / `strykerRunner` | how Stryker is started for a head | Stryker config ([Stryker, configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)) | ok | |
| `mutationInterpret` / `Script` / `fakes` / `drive` / `BASE` / `HEAD` / `ASK` / `SCOPE` / `SURVIVED` / `KILLED_ALL` / `ONE_SURVIVED` (`scripted.ts`) | handlers and test fixtures | fixture | ok | |

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
| review state `phase`: `idle`, `waiting`, `gathering`, `reviewing`, `judging`, `over` | where the review is | Elm's Model | ok | |
| `ReviewCmd` / `ReviewMsg` / `RunSub` / `ChecksSub` / `checksSub` / `review_checks` / `review_run` / `review_pack` / `review_file_note` | Cmds, Msgs, Subs, wire names | Cmd, Sub ([Elm guide, effects](https://guide.elm-lang.org/effects/)) | ok | |
| `checksClock` / `listen("timer")` | the wait beside the checks Sub | timer ([Temporal, timers](https://docs.temporal.io/workflows)) | two-words | "clock" in the name, "timer" in the tag. `checksTimer`. 70% |
| `ReviewConfig` / `.waits` / `.tries` / `createReview` | a review machine with other limits | options | ok | `tries` is tracker #32 |
| `Reviewer` / `ReviewerConfig` / `reviewerOptions` / `reviewerDraft` / `liveReviewer` / `reviewStream` | the live reviewer agent | agent | ok | |
| `noRun` / `fenced` / `sentBackForm` / `problemsOf` | an empty run, a code fence, the "your form was refused" message, the form's problems | code fence ([CommonMark, fenced code blocks](https://spec.commonmark.org/0.31.2/#fenced-code-blocks)) | ok | `problemsOf` is exported by test-writer `written.ts` too |
| `NOT_IN_THE_PACK` / `criteriaIn` / `deviationsIn` / `readRubric` / `isTextKind` | what the pack leaves out, and its parsers | none needed | ok | |
| `OPENED_NAMES` / `toolName` / `noteIdOf` / `SERVER` (`tools.ts`) | the tools the reviewer may call | MCP tool | two-words | see build's `SERVER` |
| `renderKind` (`render.ts`) | one kind's comment | render | ok | |
| `verdictsOf` / `rowsOf` (`verdict.ts`) | each kind's verdict, each criterion's row | review state ([GitHub REST, reviews](https://docs.github.com/en/rest/pulls/reviews)) | ok | |
| `USAGE` / `flagsOf` / `modeLine` / `Parts` (`launch.ts`) | the command line's help and parse | usage line ([POSIX, utility conventions](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap12.html)) | ok | `Parts` is also `stages/outcome.ts` `Parts` (an outcome's name parts): two-ideas. `Args`. 70% |
| program `review` outputs `verdict` (type `Reviewed`), `passed` (`Passed`), `note` (`Filed`); flags `rubrics`, `model`, `effort`, `budget`; input `pr` | what users pipe and type | program outputs | two-words | an output's name and its type say two words: `verdict` holds `Reviewed`, `note` holds `Filed`. Build says `built` / `Built`. One rule: the output is the type's word (`reviewed`, `filed`). 65% |
| `PR` / `HEADS` / `BASE` / `RUBRICS` / `WHOLE` / `Which` / `Answers` / `Script` / `recorded` / `recordedGh` / `recordedHost` / `scriptedReviewer` / `changed` (`scripted.ts`) | test fixtures | fixture ([xUnit patterns, fixture](http://xunitpatterns.com/test%20fixture%20-%20xUnit.html)) | ok | |

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
| `Landing: whole, part` / `landingOf` / `landed` / `landedAs` | whether the ticket has work left after the merge | none | differs | one ticket is one PR now ([done is per criterion](../direction/done-is-per-criterion.md)), so `part` goes, as the outcome names note says. 70% |
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
| ship (the stage) | puts a reviewed pull request in the merge queue, or merges it | merge queue ([GitHub, merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)); "ship" often means release or deploy | differs | keep `ship` with a gloss "merge, through the queue"; `merge` is the plainer word but is already the Cmd's name. 65%: settle by asking whether ship will ever deploy |
| ship state `phase`: `idle`, `reading`, `waiting`, `rerunning`, `enqueueing`, `queued`, `merging`, `finishing`, `over` | where the ship is | Elm's Model | ok | `queued` is a state, the others are actions in progress. Fine |
| `ShipCmd` / `ShipMsg` / `ChecksSub` / `QueueSub` / `checksSub` / `queueSub` / `ship_checks` / `ship_queue` / `ship_facts` / `ship_enqueue` / `ship_merge` / `ship_rerun_checks` / `ship_finish` | Cmds, Subs, wire names | Cmd, Sub | ok | `ChecksSub` is exported by review and ship for two Subs |
| `checksClock` / `queueClock` (`listen("timer")`) | the waits | timer | two-words | as review's |
| `ShipConfig` / `createShip` | a ship machine with other limits | options | ok | |
| `shipKind` / `shipProgram` / `createShipProgram` | the program and its machine kind | entity type ([Akka, cluster sharding](https://doc.akka.io/libraries/akka-core/current/typed/cluster-sharding.html)) | ok | `kind` is tracker #32 |
| `Told` (`program.ts`) | a bare url or review's `passed`, as the `pr` input takes it | message | ok | |
| program `ship` outputs `found` (type `Look`), `outcome` (`Shipped`), `answer` (`Answer`), `forgot` (`Forget`); inputs `pr`, `ask`, `forget`; flag `mode: read, write` | what users pipe and type | dry run ([kubectl, --dry-run](https://kubernetes.io/docs/reference/kubectl/generated/kubectl_apply/)) | two-words | `found` holds a `Look`; `outcome` holds `Shipped`. Same rule as review's outputs. Operate calls the same switch `ship: read, write`. 65% |
| `servicesOf` / `modeLine` / `shown` (`launch.ts`) | the services for a mode | none needed | ok | |
| `TICKET` / `ON_TIP` / `C1` / `C2` / `CRITERIA` / `BOOK` / `rowOn` / `filed` / `rowsAt` / `metAt` / `provenAt` / `readyAt` / `recordOf` (`scripted.ts`) | test fixtures | fixture | ok | |

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
| `Flow.version` / `.folds` | the plan version to make, and the tickets folded in | none | two-ideas | **picked 2026-10-28:** a ticket joining an open plan is "added to a plan" in the rebuilt pipeline; this key is rebuilt, not renamed. See `fold` in section 9 |
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
| `LaneCmd` / `LaneSub` / `LaneOutcome` / `LaneName` / `LANE_NAMES` | Cmds, Subs, outcome | Cmd, Sub | ok | lane vs parent is tracker #32, not picked |
| `lane_read` / `lane_start` / `lane_note` / `lane_open` / `lane_planned` (Cmd tags); `lane_child` / `lane_owner` (Sub tags) | wire names of `readLane`, `startChild`, `noteRound`, `openPr`, `notePlan` | Cmd | two-words | the tag and the function name differ: `startChild` / `lane_start`, `noteRound` / `lane_note`, `notePlan` / `lane_planned`. One stem each: `lane_start_child`, `lane_note_round`, `lane_note_plan`. 70% |
| lane `phase: running` / `.child` | a child machine is going | process ([POSIX, process](https://pubs.opengroup.org/onlinepubs/9799919799/basedefs/V1_chap03.html)) | ok | the 2026-10-28 run → process pick is for the shell; a child here is a machine, not a process. Keep |

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
| fold / `fold` (write `op`) / `plan:fold` | the ticket joins an open plan, which grows by one ticket | add a sub-issue ([GitHub, sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)) | collides | `fold` is also the event-sourcing word for reading a stream into state (`foldLedger`, `Folded`, `foldedPlanHost`), and both live in the asks core. **picked 2026-10-28:** `fold` stays for reading the ledger into state. In the rebuilt pipeline a ticket joining an open plan is "added to a plan"; this old `fold` is rebuilt, not renamed. The lean, `attach` or `join`, was not taken |
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
| `NO_RULES` / `NoRule` / `NoRuleId` / `NO_RULE_IDS` / `ruleOf` | the reasons triage may decline a ticket | resolution ([Jira, resolutions](https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-statuses-priorities-and-resolutions/)) | two-ideas | "rule" here is a decline reason; see `rules.ts`. After the `No` → `Decline` pick: `DECLINES` / `DeclineId`. 75% |
| `SortCmd` / `SortOutcome` / `SortName` / `SORT_NAMES` | Cmds and outcome | Cmd | differs | `sort` → `triage` already leaned in the draft; follows it |
| `sort_ticket` / `sort_context` / `sort_write` / `sort_run` | wire names | Cmd, Sub | differs | follows `sort` → `triage` |

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
| `Fact` / `.type` | one pipeline event on the ledger | event ([Fowler, event sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)); fact is Datomic's word ([Datomic, datoms](https://docs.datomic.com/whatis/data-model.html)) | differs | **picked 2026-10-28:** `Event`, everywhere, as event sourcing and the host ledger say. The old pipeline's `*Fact` names are rebuilt, not renamed |
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
| `foldsOf` / `PlanTrack.folds` | tickets triage folded into a plan | sub-issues | collides | `foldsOf` and `foldLedger` sit in one file and mean two things. **picked 2026-10-28:** "added to a plan" in the rebuilt pipeline; `foldsOf` is rebuilt, not renamed, and `foldLedger` keeps `fold` |
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
| host `jobs` table / `.kind: deadline, lease_expiry` / `.due_at` | the host's scheduled wake-ups | timers ([Temporal, timers](https://docs.temporal.io/workflows)); alarms ([Durable Objects, alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)) | two-ideas | `job` is also plan's criterion and every hosted stage's input. `timers`. 75%. Since **picked 2026-10-28** (a tsh line is one job), this table is the last wrong "job" |
| `Limits` / `.usd`, `.tokens`, `.wallMs`, `.children` | a run's caps | quotas | two-words | `usd` here, `budget` in Settings, `maxBudgetUsd` in the Agent SDK. Settle one money word. 65% |
| `Spend` / `.costUsd`, `.tokens`, `.context`, `.turns`, `.minutes` / `noSpend` | what a run cost | usage ([Anthropic API, usage](https://docs.anthropic.com/en/api/messages)) | two-words | `Usage`, `noUsage` (picked 2026-10-24) |
| `DraftRun.key`, `.id`, `.prompt`, `.session` (`id`, `continues`), `.agent`, `.folder` | one agent run | session ([Claude Agent SDK, sessions](https://docs.claude.com/en/docs/agent-sdk/sessions)) | ok | `key` follows the combo's `key` row |
| supervisor / `one_for_one` and the rest | OTP's supervisor as a program | supervisor ([Erlang, supervisor](https://www.erlang.org/doc/system/sup_princ.html)) | ok | |
| dead letters / `deadLetters` / `redrive` / `.strikes` | messages set aside after crashing a program | dead-letter queue and redrive ([AWS, SQS dead-letter queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)) | ok | |
| journal | a program's saved state on the ledger | journal | ok | |
| outbox | a pipe's never-lost send | transactional outbox ([microservices.io](https://microservices.io/patterns/data/transactional-outbox.html)) | ok | |
| kept / `program/kept.ts` | a machine run whose state is saved | durable; persisted | two-ideas | "kept" is also a property's `is: "kept"`, `keeps` an id, and a review note's state. `durable.ts`. 65% |
| tag keys: `kind`, `type`, `phase`, `answer`, `go`, `flow`, `ev`, `how`, `reading`, `step`, `do`, `on`, `op`, `at`, `for`, `is`, `sure`, `pass`, `_tag` | the key that tells a union's cases apart | discriminant ([TypeScript, discriminated unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions)); Effect's `_tag` | two-words | one key per role: `_tag` for errors (Effect), `type` for Msgs (Elm and Redux), `phase` for states, `kind` for every other data union. 60% |
| `keptCmd` / `keptAct` | the schema of a Cmd as a model stores it, so a restart can send it again | none in Elm: a Cmd is opaque and never stored ([Elm guide, effects](https://guide.elm-lang.org/effects/)); event sourcing calls a stored request a command ([Fowler, event sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)) | two-ideas | "kept" already has four meanings in the draft. `cmdSchema` / `actSchema`. 70% |
| `createJudge` / its `rule`, `handle`, `choices`, `criteria` | build one Judge: the Cmd, the floor rule, the handler | a classifier with a confidence threshold; none standard | two-ideas | `criteria` here is Jev's word for "what each choice means", not acceptance criteria. Rename the returned key `meanings`. 70% |
| `Judged.confidence` / floor | the score a Judge reads against its floor | confidence threshold; none standard | ok | |
| `refiningOf` | the schema of a refine loop's state | none needed | ok | |
| `Hash` / `hashOf` / `covers` | a `sha256:` text hash, and "does this answer still cover the text" | content hash ([Wikipedia, content-addressable storage](https://en.wikipedia.org/wiki/Content-addressable_storage)); stale approval ([GitHub, protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)) | two-words | the same three names are exported again in `tickets/ticket.ts:96` and `tickets/approval.ts:32,45`, with other shapes (a loose template type here, a checked 64-hex schema there; raw text here, a JSON title-and-body pair there). One module, one `Hash`. 80% |
| `Asking.phase: post_failed` | posting the question failed | none standard | ok | |
| `PullRequest` / `.number`, `.title`, `.url`, `.draft` | one open PR in a list | pull request ([GitHub REST, pulls](https://docs.github.com/en/rest/pulls/pulls)) | ok | |
| `PullRequest.at` | when it last changed, in ms | `updated_at` ([GitHub REST, pulls](https://docs.github.com/en/rest/pulls/pulls)) | differs | `at` is **held** for the glossary pass (draft). Lean `updated`. 55% |
| `CodeHost.rerunChecks` | start the failed jobs of this head's runs again | "re-run failed jobs" ([GitHub REST, workflow runs](https://docs.github.com/en/rest/actions/workflow-runs#re-run-failed-jobs-from-a-workflow-run)) | ok | the word "jobs" here is GitHub's; it is not the shell's job (**picked 2026-10-28**: a tsh line is one job). Say so in the doc comment |
| `JevCallFailed._tag: jev_call_failed` | Jev never answered | none needed | ok | |
| stage (the pipeline's: triage, plan, build, review, ship, and catchup, task, mutation, test writer) | one step of the pipeline, one machine | stage, a CI pipeline's ordered step ([GitLab CI, stages](https://docs.gitlab.com/ci/yaml/#stages)) | ok | not the shell job record's `stage` (dropped, picked 2026-10-28). Keep it here, glossed in the glossary as "pipeline stage" so the two are not read as one |
| `XOutcome` / `XName` / `X_NAMES` / `isXName` (one set per stage: `BuildOutcome`, `PlanOutcome`, `ReviewOutcome`, `ShipOutcome`, `SortOutcome`, `LaneOutcome`, `TaskOutcome`, `CatchupOutcome`, `MutationOutcome`, `TestWriterOutcome`, `LoopOutcome`, `MutantsOutcome`) | a stage's outcome schema, its printable name type, every name, and a guard | outcome; a Temporal workflow result ([Temporal, workflows](https://docs.temporal.io/workflows)) | ok | `isXName` exists for build, review, ship, mutation, test writer, loop, not for plan, sort, lane, task, catchup: one rule for all, or none |
| `queue` (machine) / `queueKind` / `workQueue` / `drop` (`queue.ts`) | a kept list of told values a program works one at a time | work queue ([client-go, workqueue](https://pkg.go.dev/k8s.io/client-go/util/workqueue)) | ok | |
| `Waiting` / `.items` / `.clearing` (`queue.ts`) | the queue's state: values not done, values whose tidy-up is owed | queue items; "processing" set in client-go | two-ideas | `Waiting` is also the asks core's `Waiting` and the phase `waiting` in review, ship, lane. `QueueState`. 75% |
| queue Msg `type: told, done, cleared, dropped` | a value put on, its work ended, its tidy-up ran, taken off | `Add`, `Done`, `Forget` ([client-go, workqueue](https://pkg.go.dev/k8s.io/client-go/util/workqueue)) | ok | `told` is ours, but plain and used in every input's doc |
| ack (`{ack: "manual"}` on a program input) | the queue says it has kept the value, not that the work is done | ack / delete after receive ([AWS SQS, visibility timeout](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)) | ok | |
| `endedAs` / `queueLine` / `reviewLine` / `shipLine` / `buildLine` / `loopLine` (`status.ts`) | each machine's one-line status, as `jobs` prints it | status ([Jira, statuses](https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-statuses-priorities-and-resolutions/)) | ok | |
| `buildDrawing` / `reviewDrawing` / `shipDrawing` / `loopDrawing` / `prName` / `prAttributes` (`traced.ts`) | how a machine shows in a trace: span name, step names, tags | span name, span attributes ([OpenTelemetry, traces](https://opentelemetry.io/docs/concepts/signals/traces/)) | differs | "drawing" is fabrika's word; the file says "tags", OpenTelemetry says "attributes". `prAttributes` already says it. Keep `drawing` (fabrika's own name, out of this scope); "tags" in comments → "attributes". 70% |
| `refOf` (`ref.ts`) | a GitHub url, short (`#12`) | issue reference ([GitHub, autolinked references](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls)) | ok | |
| `RULE_FILES` / `RuleFile` / `RepoRule` / `.file` / `.text` / `rulesAt` / `RuleBlob` / `repoRulesOf` / `MOST_RULE_CHARS` / `RULES_FIELDS` (`rules.ts`) | the repo's `CLAUDE.md` and `AGENTS.md` on the base branch | memory files ([Claude Code, memory](https://docs.anthropic.com/en/docs/claude-code/memory)); [AGENTS.md](https://agents.md/) | two-ideas | "rule" here is an agent instructions file; in sort it is a no-rule (`NO_RULES`), in review a rubric rule (`From.rule`), in the asks core a lasting ruling (`rule: lasting`). `RepoRule` → `Instructions` / `INSTRUCTION_FILES`. 60%: what would settle it is which word the agent SDK docs use for these files (they say "memory", which clashes with ours) |

## Renamed since the draft

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| verify writer → test writer (`stages/test-writer/`, `testWriter`, `TestWriter`, `TestWriterOutcome`) | the stage that writes a test per property before the build | test-first, "write a test, see it fail" ([Fowler, TDD](https://martinfowler.com/bliki/TestDrivenDevelopment.html)) | ok | renamed since the draft; plain and the industry's |
| `send:verify_writer:mutant_survived` → `send:test_writer:mutant_survived` (`mutation/outcome.ts`) | a mutant lived, so the test writer's mutants job answers it | survived mutant ([Stryker, mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)) | ok | renamed since the draft |
| `ask:owner:already_kept`, `ask:owner:not_kept` → `ask:owner:fails_on_base`, `already_passes`, `cannot_test` (`test-writer/outcome.ts`, `SURPRISES`) | the plan was wrong about today's code, or a property cannot be tested | none standard | ok | the 2026-10-24 pick, now in code |
| `writeChecks` / `checks_write` → `testsWrite` / `tests_write`; `checks_hold` → `tests_on_base` (`test-writer/written.ts`, `machine.ts`) | the Draft that writes the tests, and the run on the base | tests ([Fowler, TDD](https://martinfowler.com/bliki/TestDrivenDevelopment.html)) | ok | the 2026-10-24 pick, now in code |
| `Promise` (sketch) → `Property` (`test-writer/brief.ts`), keys `says` → `when` + `result`, `harm` → `why`, `is` → `behavior: new, existing`, `tool: "property"` → `tool: "test"`, `covers` → `code` | one behavior the change must keep or add | property ([fast-check, PBT](https://fast-check.dev/docs/introduction/what-is-property-based-testing/)) | ok | the 2026-10-24 pick, now in code. This schema has no `id` or `stories`: the id rides beside it as `property` (`PropertyId`, `p1`) |
| `Question.about` (combos, new key; draft row `Question / .where, .text, .who, .floor`) | the whole text an answer binds to, hashed | GitHub dismisses a stale approval when new commits land ([GitHub, protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)) | ok | add to the draft row |
| `Asking.saw` (combos, new key on every phase; draft row `Asking / .phase ...`) | the hash of `about` the answer was given against | same as above | two-words | the ticket fact `answered` calls the same hash `text` (`tickets/ticket.ts:192`). One word: `saw`. 80% |
| `CodeHost.pullRequests` / `PullRequest` (services, new) | the open PRs of one repo, as a list shows them | list pull requests ([GitHub REST, pulls](https://docs.github.com/en/rest/pulls/pulls)) | ok | add to the draft's `CodeHost` row |
| `*Job` inputs, `*Ask` inputs, `Promise` record words in `packages/promises` | not renamed: the 2026-10-24 picks (`*Input`, `why`, `code`, `tool: test, tla`) wait for the rename pass | see rows below | two-ideas | rename the promises record together with plan, or the two disagree |

## refine.ts (the older refine loop)

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `createRefine` vs `createRefineLoop` (combos) | the same Draft-and-Check loop, built twice: the writer as one Cmd here, as a Sub there | evaluator-optimizer loop ([Anthropic, building effective agents](https://www.anthropic.com/engineering/building-effective-agents)) | two-words | one idea, two names, two state shapes. Until `refine.ts` is gone, mark it as the old one: `createRefineCmd`. 65%. What would settle it: when triage and the lane move off it |
| `RefineRun` / `.brief`, `.session`, `.tries`, `.limit` | a run in progress | Temporal `maximumAttempts` ([Temporal, retry policies](https://docs.temporal.io/encyclopedia/retry-policies)) | ok | `tries` / `limit` are in the draft's open money-and-tries item (tracker #32): not picked here |
| `RefineState.phase: idle, writing, checking, write_failed, check_failed, out_of_tries, stopped, done` | where the loop stands | | two-words | `createRefineLoop` says `drafting` and `failed` for `writing` and `write_failed`; the writer here is a Draft. One set: `drafting`, `draft_failed`. 75% |
| `RefineState.stopped.reason` | why a use stopped the run early | `why` (AGENTS.md key rule) | differs | `why`. 80% |
| `RefineState.done.verdict` / `RefineConfig.verdict` | what the checker handed back: data about the draft, not pass or fail | a checker's output | two-ideas | `Verdict` means pass or fail in nine other exports. `checked`. 60%. What would settle it: whether `checkRun`'s `verdict` (primitives) is renamed with it |
| `RefineAnswer.kind: retry, more, accept` | a parent's answer to a stopped run | `accept`: Linear's word, kept by the 2026-10-24 rule | ok | |
| `RefineMsg.type: start, resume, answer` | the loop's Msgs | Elm Msg | ok | |
| `STOPPED` | the phases a run stops in for its parent | | ok | |
| `sentBack` | the default note when a draft fails its check | feedback | ok | |
| `RefineConfig.name`, `.brief`, `.draft`, `.problemsOf`, `.stopOf`, `.feedback` | one use's parts | | ok | |
| `enrich_write` / `enrich_check` (`<name>_write`, `<name>_check`) | the two Cmds a use makes | | two-words | `createRefineLoop`'s Draft is named by its own Cmd. Rides on the `createRefine` row |

## verdict.ts (today's fabrika verdict comments)

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `NAMESPACES` / `Namespace`: `review-code`, `review-doc`, `review-skill`, `review-ui`, `governance` | which review a verdict comment is | a required status check's context ([GitHub REST, commit statuses](https://docs.github.com/en/rest/commits/statuses)) | two-words | review's `Kind` / `TextKind` (draft, section 5) lists the same words. One name: `Kind`, once the `kind` question (#32) is settled. 60% |
| `Marker` / `parseMarker` | a verdict's first line | | two-ideas | `markOf` (criteria) and `markerOf` (idempotency, draft) are two other marks. `VerdictLine` / `parseVerdictLine`. 70% |
| `Marker.polarity: PASS, FAIL` | pass or fail | `conclusion: success, failure` ([GitHub REST, check runs](https://docs.github.com/en/rest/checks/runs)) | differs | `grade`, as the book's `Row.grade`. 65% |
| `Marker.head` / `.range` / `.range.base`, `.tip` | the commit or range a verdict binds to | head SHA; base and head of a compare ([GitHub REST, pulls](https://docs.github.com/en/rest/pulls/pulls)) | two-words | `tip` is GitHub's `head`. `head` is taken one level up, so keep `tip`. ok as it is, glossed. 55% |
| `Marker.clause` | the reviewer's one-line reason | | differs | `why`. 80% |
| `Verdict` (`verdict.ts:54`) / `.marker`, `.body`, `.superseded`, `.retiredOn` | one verdict inside a comment | | two-ideas | `Verdict` is exported nine times (book, promises, review, operate, builder-acp, here). `PostedVerdict`. 75% |
| `Verdict.superseded` / `.retiredOn` | retired by a later verdict | supersede ([MADR status](https://adr.github.io/madr/)) | two-words | one word: `supersededOn`. 75% |
| `verdictsIn` / `postedIn` / `verdictsBetween` / `findingsIn` | reads over comment text | | ok | |
| `CommentText` / `.id`, `.url`, `.at`, `.editedAt`, `.body` | a comment as the tracker serves it | `created_at`, `updated_at`, `body` ([GitHub REST, issue comments](https://docs.github.com/en/rest/issues/comments)) | ok | `at` held |
| `CommentVersion` / `.at`, `.body` | one earlier text of a comment | comment edit history; none standard in REST | ok | |
| `Posted` / `.commentId`, `.url`, `.marker`, `.body`, `.at` | one verdict as it was posted | | ok | |
| `FindingText` / `.title`, `.text`, `.blocking`, `.level` | one finding as the reviewer wrote it | SARIF `result` with `level` ([SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)) | ok | |
| `FindingText.from: section, item, row, paragraph` | how the splitter found it | | two-ideas | review's `From` / `.source` (draft) says where a finding came from. `shape`. 65% |

## ids.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `TicketId` / `ticketId` / `readTicketId` | `owner/repo#N` | issue reference ([GitHub, linking a PR to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)) | ok | |
| `PlanId` / `readPlanId` | a plan's id: the same text as its first ticket's | | ok | |
| `planOf` / `ticketOf` | ticket id to plan id, and back | | two-ideas | `planOf` is exported four times (review and ship `launch.ts`, fabrika `host/move.ts`); `ticketOf` three (build `ticket.ts`, `code-host-github.ts`). Keep these two; the draft already renames review's `planOf` to `argsOf`. `code-host-github.ts`'s is `ticketOfPr`. 75% |
| `StoryId` / `TaskId` (`t1`) / `CriterionId` (`c1`) / `QuestionId` (`q1`) / `VerdictId` (`v1`) / `LaneId` (`L1`) / `AskId` (`plan:...`) and their `make` / `read` pairs | branded ids, one per kind | branded type ([Effect, branded types](https://effect.website/docs/schema/advanced-usage/#branded-types)) | ok | `LaneId` follows the open lane-or-parent item (#32) |
| `Owner` = `TaskId` or `"plan"` / `PLAN` | whose a criterion is: one task's or the whole plan's | none standard | two-ideas | "owner" is the person (`who: "owner"`, `BY` `owner`, CODEOWNERS owners), in the same files. `Scope`. 60%. What would settle it: one reader test, or the glossary pass |

## entity.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `entity` / `value` | a ledger thing with an id, and one with none | entity and value object ([Fowler, Evans classification](https://martinfowler.com/bliki/EvansClassification.html); [Fowler, value object](https://martinfowler.com/bliki/ValueObject.html)) | ok | |
| `Id` (`entity.ts:31`) | a branded id schema of one kind | branded type ([Effect, branded types](https://effect.website/docs/schema/advanced-usage/#branded-types)) | two-ideas | `tickets/ticket.ts:54` exports an `Id` that is any one-line text with no kind. Rename that one (see tickets) |
| `make` / `read` | id from text: throws, or `null` | decode / `is` ([Effect Schema, basic usage](https://effect.website/docs/schema/basic-usage/)) | ok | |
| `kindOf` (`entity.ts:62`) | the id kind of a schema | | two-ideas | `stages/lane/machine.ts:114` exports a `kindOf` for a child's kind. `idKindOf`. 80% |
| `madeAs` | entity, value, or neither | | ok | |

## brief.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Brief` (`brief.ts:32`) / `defineBrief` / `BriefOf` | one role's brief: its schema, how it is filled, how it reads | prompt template ([LangChain, prompt templates](https://python.langchain.com/docs/concepts/prompt_templates/)) | two-ideas | `Brief` is exported six times; in plan, review gate and triage it is the filled data, here it is the definition. `BriefSpec` here, `Brief` for the data. 70% |
| `Brief.role` | whose brief | role prompting ([Anthropic, building effective agents](https://www.anthropic.com/engineering/building-effective-agents)) | ok | |
| `Brief.schema` / `.fill` / `.render` / `.prompt` | check a filled brief; make the first message; the refine prompt | template fill; Elm view ([Elm guide, architecture](https://guide.elm-lang.org/architecture/)) | ok | |
| `BriefSchema` | a schema whose two sides are one type | | ok | |
| `Only` | `I` with every extra field typed `never` | exact types ([TypeScript #12936](https://github.com/microsoft/TypeScript/issues/12936)) | differs | `Exact`. 75% |

## schema.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Plain` | a schema a Cmd may carry: Effect with one type both sides, or zod | Effect's `Schema<Type, Encoded>` with the two equal ([Effect Schema, getting started](https://effect.website/docs/schema/getting-started/)) | ok | |
| `Spec` / `isEffectSpec` / `zodCmd` | a move's Cmd spec; which library it is in; the zod path | | ok | |

## check-runs.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Result` (`check-runs.ts:26`) / `.name`, `.state: green, red` | how one check of a run ended | check run `conclusion: success, failure` ([GitHub REST, check runs](https://docs.github.com/en/rest/checks/runs)) | collides | Effect ships a `Result` module ([effect-smol, Result.ts](https://github.com/Effect-TS/effect-smol/blob/main/packages/effect/src/Result.ts)), and `controls.ts:27` exports another `Result` (`red`, `green` alone). `CheckResult`. 80% |
| `Ran` (`check-runs.ts:33`) / `.asked`, `.at`, `.results` | one finished run of the local checks | check suite ([GitHub REST, check suites](https://docs.github.com/en/rest/checks/suites)) | two-ideas | `Ran` is review's agent record and promises' run (draft). `CheckSuite`, GitHub's word for one run of many checks at a commit. 70% |
| `Ran.at` | the commit the copy stood at the whole run | `head_sha` ([GitHub REST, check suites](https://docs.github.com/en/rest/checks/suites)) | differs | `at` is held (draft). Lean `head`. 70% |
| `Runs` / `NONE` / `RunsMsg.type: ran` / `apply` / `checkRuns` | every run so far, as a fold and as a tea machine | reducer ([Redux, reducers](https://redux.js.org/usage/structuring-reducers/basic-reducer-structure)); `foldl` ([Elm core, List](https://package.elm-lang.org/packages/elm/core/latest/List#foldl)) | two-words | `NONE` here and `EMPTY` in the criteria book name one idea: the fold's start. `EMPTY`. 70% |
| `lastAt` / `checksAt` | the last run at a head; a head's checks as review reads them | | ok | |

## controls.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| controls / `createControls` / `controls` / `mustFail` / `mustPass` | a check is trusted only when red on a known break and green on good input | negative and positive controls ([Wikipedia, scientific control](https://en.wikipedia.org/wiki/Scientific_control)) | ok | |
| `Result` (`controls.ts:27`): `red`, `green` | what a check said on one input | | collides | see `Result` in check-runs. `Light`, or reuse `CheckResult["state"]`. 70% |
| `Controlled.kind: ok, missed, false_alarm, backwards` | the control's answer | false negative, false positive ([Wikipedia, scientific control](https://en.wikipedia.org/wiki/Scientific_control)) | ok | plain words for the two errors; keep, glossed |
| `Side: bad, good` / `Sides` | which control a run is for | negative and positive control | differs | lean `negative`, `positive`. 55%. What would settle it: whether a reader without lab words reads `bad` / `good` faster |
| `Run<C>` / `.at: asked, ran` / `.cmd` / `.result` | one side's run | | two-ideas | `run` → `process` is **picked 2026-10-28** for the shell; this `Run` is a check run, so `SideRun`. `at` as a tag key is the open tag-key item (#32). 70% |
| `Controlling.phase: running, done, could_not_run` / `.key`, `.sides`, `.answer`, `.side` | the child's state | | ok | |

## poll.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| Poll / `createPoll` / its `name`, `read` | wake on a clock, read, report only a change | polling ([Wikipedia, polling](https://en.wikipedia.org/wiki/Polling_(computer_science))); `Time.every` ([Elm time](https://package.elm-lang.org/packages/elm/time/latest/Time#every)) | ok | |
| `Pace` / `.every` | from the end of one read to the next tick | `periodSeconds` ([Kubernetes, probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)); `Time.every` | ok | |
| `Pace.limit` | how long a read may take | `timeoutSeconds` ([Kubernetes, probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)) | two-ideas | `limit` is the try cap in `RefineRun`, `Refining` and `Tried`. `timeout`. 80% |
| `Polling` (`poll.ts:51`) / `.phase: waiting, reading`, `.key`, `.tick`, `.last`, `.input` | a poll's state | | two-ideas | `code-host-github.ts:1162` exports a `Polling` that is the GitHub reader's wait settings. Rename that one (see code-host-github) |
| `Keyed` / `Tick` / `.tick` | the read Cmd with its key and tick; the clock's Msg | tick | ok | `Tick` also in `laws/world/lanes.ts:217` (outside this part) |
| `Changed` (`poll.ts:73`) / `.key`, `.tick`, `.value` | a read that differs, handed to the parent | Elm "out message" | two-ideas | plan's `Changed` (`stages/plan/lines.ts:91`, draft) is a diff of a plan's lines. `PollChanged`. 65% |
| `createPoll` config `.by` | the part of a read that counts for "changed" | a key selector ("distinct by key") | two-ideas | `by` is "who made it" in `BY`, `Asking.by`, `Entry.by`. `compareBy`. 65% |

## rate.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| Rate / `tallyOf` / `Tally` / `.fix`, `.noise`, `.open` / `countedAs` | count users' "fix" and "noise" ratings per rule | effective false positive ([Sadowski et al., Lessons from building static analysis tools at Google](https://research.google/pubs/lessons-from-building-static-analysis-tools-at-google/)) | ok | |
| `Finding` (`rate.ts:33`) / `.id`, `.rule` | a finding as the count sees it | SARIF `result` with `ruleId` ([SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)) | two-words | review exports another `Finding` (`stages/review/sheet.ts:119`) with other fields. One idea, two shapes: `FindingRef` here. 65% |
| `Says: fix, noise` / `Rating` / `.finding`, `.says` | what a click on a finding says | | ok | `says` is also review's text key (draft `Item.says`, `Row.says`); see the draft |
| `RatingRow` / `.writer`, `.rating` / `UserRating` / `.by` / `userRatings` | a rating with who wrote its row | | ok | |
| `Facts` (`rate.ts:53`) / `.ratings`, `.shipped` | what the count reads | | two-ideas | a sixth `Facts` (draft has five). `RateInput`. 70% |
| `Silence: noise, open` | what an unrated finding counts as once shipped | | ok | |
| `none` (`rate.ts:110`) | an empty tally | | two-words | `NONE` in check-runs, `EMPTY` in the book. `EMPTY_TALLY`. 60% |
| `Enough` | ratings a rule needs before it may block | | differs | `MinRatings`. 60% |
| `Mode: advise, block` / `modeOf` / `gateRate` | a rule's findings only advise, or they stop the work | ESLint severity `warn`, `error` ([ESLint, configure rules](https://eslint.org/docs/latest/use/configure/rules)); SARIF `level` | differs | keep `advise` / `block`: plain, and `error` would say "broken". 60%. `Mode` also in fabrika `shell/execute.ts:59` |

## settings.ts (`fabrika.toml`)

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `fabrika.toml` / `SETTINGS_FILE` / `settingsFrom` / `readSettings` / `DEFAULT_SETTINGS` | one settings file per repo | TOML ([TOML 1.0](https://toml.io/en/v1.0.0)) | ok | |
| `Settings` (`settings.ts:147`) | the file as written | | two-ideas | `Settings` is exported seven times (plan, review, triage). `FabrikaToml` or `RepoSettings`. 70% |
| `SettingsInvalid` / `._tag: settings_invalid` / `.why` | the file could not be read or does not fit | | ok | |
| `packs` / `pack."<name>"` | add-on packs, and each pack's own table | | ok | |
| `AGENT_STEPS: plan, build, review` / `AgentStep` / `[agents.<step>]` | the steps that run an agent | | two-words | `sandboxes.ts` calls the same things `Stage`. "step" or "stage" for one idea: `stage`, the word the pipeline's folder uses. 70% |
| `[agents.<step>].model`, `.effort` / `EFFORTS: low, medium, high` | which model, how hard it thinks | `effort` ([Anthropic, Messages API](https://docs.anthropic.com/en/api/messages)) | ok | |
| `[agents.<step>].usd` | the most one run may cost | | two-words | `tsh.toml`, `Local` and `AgentPick` say `budget` for the same cap. The money-cap word is open (#32): not picked |
| `[build].install` / `INSTALL` | run once in a fresh copy | `npm ci` / install step | ok | |
| `[build].checks` | the commands the builder is told to run | | two-ideas | `[checks]` and `[[checks.run]]` are the commands fabrika runs itself; `Setup.told` is this key. `[build].commands`. 60% |
| `[review].rubrics` / `.governed` / `.ui` | the rubrics folder; paths that need the governance or the rendered review | `governedRoots` in fabrika 0.9 | ok | |
| `[checks].github: every, required, none` | which of GitHub's checks count | required status checks ([GitHub, protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)) | ok | |
| `[[checks.run]]` / `.name`, `.run` | a command fabrika runs itself at each head | | two-ideas | `run` is both the list and each entry's command. `[[checks.command]]`, or the list `[[checks.local]]`. 60% |
| `[ship].approval: codeowners, none` | whose approval a change needs | code owners ([GitHub, about code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)) | ok | |
| `[ledger].at: local, sqlite` | where the ledger is kept | datasource `provider` ([Prisma, schema reference](https://www.prisma.io/docs/orm/reference/prisma-schema-reference)) | differs | `at` is held (draft), and here it is not a time. `[ledger].store`. 65% |
| `BUILD_GO_GONE` | the line a file with `build.go` fails with | | ok | |
| `picksThatSayNothing` | picks the run would not do as written | | ok | |
| `repoOf` (`settings.ts:247`) | the folder tsh starts in, or its repo root | `git rev-parse --show-toplevel` | two-ideas | `code-host-github.ts:1170` exports a `repoOf` from a URL to owner and name. `repoRootOf` here. 80% |

## settings-source.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Target` / `.name`, `.clone`, `.url` | the repository fabrika works on, as tsh.toml names it | | two-ideas | review's target (`ReviewTarget`, `taskTarget`, `bookTarget`) is a PR or a task. `TargetRepo`. 75% |
| `Where.from: repo, folder` / `Source.from` / `.found`, `.branch`, `.commit`, `.file` | where to read the file; where it was read | | ok | `from` as a tag key is the open tag-key item (#32). `Source` also in fabrika `shell/launch.ts:33`, `shell/check.ts:28` |
| `Loaded` / `.settings`, `.source`, `.holds` / `loadSettings` / `sourceLine` | the settings and where they came from | | ok | |

## setup.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Setup` / `setupOf` / `setupLines` | the picks of one run, printed one per line | | ok | |
| `ASKED` | the paths probed at the commit | | two-ideas | "ask" has five meanings (draft). `PROBED`. 70% |
| `Holds` / `.files`, `.rubrics` / `HOLDS_NOTHING` | what the repo holds at the commit | | two-ideas | `Hold` is a lease and `HOLDS` a pack table (draft, section 9). `RepoFiles`. 65% |
| `Local` / `.model`, `.effort`, `.budget`, `.rubrics` | this machine's fallbacks, from tsh.toml | | two-ideas | "local" is also the git-copy code host (`code-host-local.ts`), the checks fabrika runs on GitHub (`local-checks.ts`) and the on-machine ledger (`ledger.at = "local"`). `MachineDefaults`. 70% |
| `AGENT_DEFAULT` / `.model`, `.effort`, `.budget` | the code's own fallbacks | | ok | `budget` rides on the money-cap item (#32) |
| `From: fabrika.toml, tsh.toml, repo, default` / `Picked` / `.value`, `.from` | where a pick came from | | ok | `From` also in review `sheet.ts:83` (draft) |
| `AgentPick` / `.model`, `.effort`, `.budget` | one agent step's picks | | ok | |
| `RunCheck` / `.name`, `.run` | a command fabrika runs itself at each head | | two-words | the same `{name, run}` is `LocalCheck` (`code-host-local.ts:61`) and the settings' `Check`. One name: `CheckCommand`. 80% |
| `Setup.told` | the commands the builder is told to run | | two-words | the file calls it `[build].checks`. See that row |
| `Setup.kinds` | review rules where a side has no `.fabrika.jsonc` | | two-words | its type is `Rules`. `rules`. 70% |
| `Setup.github` / `.run` / `.approval` / `.ledger` / `.install` / `.rubrics` / `.agents` | the same picks as the file's keys | | ok | `.run` follows `[[checks.run]]` |
| `RubricPlaces` / `.shipped`, `.repo` / `shippedRubrics` / `writeRubrics` / `RUBRIC_FILES` | fabrika's own rubrics and the repo's | bundled files | two-ideas | "shipped" is also the ship stage's word and a rate fact (`Facts.shipped`). `bundled`. 65% |

## code-host-local.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `localCodeHost` | `CodeHost` over a git copy, with no PR | | two-ideas | see `Local`. `gitCodeHost`. 60% |
| `CodeHost.change(pr, ...)` read here with `pr` = a task or a plan | the review's "pull request" is a task target | | two-ideas | the `pr` parameter of `CodeHost` holds things that are not PRs. Name the parameter `target`. 70% |
| `taskTarget` (`<plan>/tasks/<task>`) / `bookTarget` (`<plan>/book`) / `taskOf` | a task, or the whole plan, as review names it | | ok | |
| `NOT_READ` (`code-host-local.ts:52`) | what this reader does not say | | ok | exported again in `code-host-github.ts:184`, with the same meaning per reader |
| `LocalCheck` / `.name`, `.run` | one check | | two-words | see `RunCheck` |
| `LocalSettings` / `.repo`, `.base`, `.checks` | the reader's settings | | ok | |

## local-checks.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `LocalChecks` (`local-checks.ts:46`) / `.work`, `.install`, `.checks`, `.github` | the repo's own checks, run beside GitHub's | | two-ideas | `hosted/review-local.ts:89` exports a `LocalChecks` service with another shape. `RepoChecks` here. 70% |
| `withLocalChecks` / `shipChecksOf` / `changeChecksOf` | GitHub's code host with the repo's checks joined in | | ok | |
| checks state `unknown` (review) vs `stuck` (ship), mapped by `SHIP_OF` | a check list that could not be read | | two-words | one idea, two words, mapped in code. `unknown`, the review's, as everywhere else that cannot read. 75% |

## code-host-github.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `gitHubCodeHost` / `codeHostOn` / `readPrFacts` / `readChange` / `readPullRequests` / `checksSettledNow` | the GitHub read side | | ok | |
| `prOf` / `repoOf` (`code-host-github.ts:1170`) | owner, name, number from a URL | | two-ideas | see `repoOf` in settings. Keep this one |
| `TicketRef` / `.link: closes_it, part_of_it` / `.owner`, `.name`, `.number` / `ticketIn` | the ticket a PR body names | closing keywords ([GitHub, linking a PR to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)) | ok | |
| `ticketOf` (`code-host-github.ts:240`) | the ticket a PR's body serves | | two-ideas | see `ticketOf` in ids. `ticketOfPr`. 75% |
| `parseJsonc` | `.fabrika.jsonc` read | JSON with comments ([VS Code, JSONC](https://code.visualstudio.com/docs/languages/json#_json-with-comments)) | ok | |
| `Rules` (`code-host-github.ts:280`) / `.governed`, `.ui` / `rulesOf` / `rulesOfBoth` | which paths need the governance or rendered review | | two-ideas | `rules` is CLAUDE.md and AGENTS.md in `BuildBrief.rules` and `Change.rules` (draft), and fabrika has its own `Rules` (`host/rules.ts:356`). `ReviewPaths`. 70% |
| `textKindOf` / `kindsNeeded` / `reviewKindsOf` / `verdictsAt` | a file's review kind; the reviews a change needs; their verdicts | | ok | `kind` is open (#32) |
| `approvalNeeded.kind: not_needed, unknown, one_of` / `.owners` / `approvedBy: given, missing` / `approvalDeclared` | whose approval a PR needs; was it given | code owner review ([GitHub, about code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)) | ok | |
| `Accounts` / `.own`, `.reviewers` | which accounts are ours, whose verdicts count | | ok | |
| `Declared` / `.approval`, `.kinds` | what fabrika.toml declares where a repo file is missing | | two-ideas | fabrika exports a `Declared` (`program/shape.ts:52`). `Fallbacks`. 60% |
| `factsOf` (`code-host-github.ts:517`) | the PR facts in one GraphQL answer | | two-ideas | `factsOf` is also the asks ledger's stream reader and the ticket fold's filter. `prFactsOf`. 80% |
| `Gh` / `answerOf` | one `gh` call; one decoded | GitHub CLI | ok | |
| `ask` (`code-host-github.ts:583`) | one GraphQL call, decoded | GraphQL query ([GitHub GraphQL, mutations](https://docs.github.com/en/graphql/reference/mutations#enqueuepullrequest)) | two-ideas | a sixth `ask`. `graphql`. 85% |
| `MOST_FILES` / `MOST_PULL_REQUESTS` | the most files or PRs read | `per_page` ([GitHub REST, pulls](https://docs.github.com/en/rest/pulls/pulls)) | two-words | the rest of the repo says `MAX_RUNS`, `MAX_WAITS`. `MAX_FILES`, `MAX_PULL_REQUESTS`. 75% |
| `Counted: required, every` / `checksOf` (`code-host-github.ts:785`) | which checks a review waits on; how they stand | required status checks | two-ideas | `checksOf` is also build's hook reader (`builder-acp.ts:381`, draft). `countedChecksOf`. 65% |
| `LeftQueue.reading: landed, ejected` / `.commit` | how a PR left the merge queue | merged; `RemovedFromMergeQueueEvent` ([GitHub GraphQL, objects](https://docs.github.com/en/graphql/reference/objects#removedfrommergequeueevent)) | differs | ship's `Merged.reading` says `merged` for the same end. `merged`, `removed`. 60%. What would settle it: whether "removed" reads too close to the book's `removed` |
| `QueueRead` / `.state: OPEN, CLOSED, MERGED`, `.inQueue`, `.commit`, `.events` | one read of the queue | GitHub's own enum | ok | |
| `QueueWatch` / `.before`, `.out` / `OPENED` / `queueStep` / `queueNow` | what one wait on the queue keeps | | two-ideas | review exports `OPENED` for its tools (draft). `QUEUE_START`. 75% |
| `OutLimits` / `.outPolls`, `.outMs` / `DEFAULT_OUT` | when "out of the queue" alone counts as thrown out | | ok | |
| `Polling` (`code-host-github.ts:1162`) / `.pollMs`, `.checks` | how the reader's two waits ask | | two-ideas | `poll.ts` exports `Polling` as a poll's state; `.pollMs` is `Pace.every`. `WaitSettings`, with `every`. 70% |

## code-host-github-writes.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `gitHubCodeHostWrites` / `codeHostWritesOn` | the GitHub write side | | ok | |
| `enqueueOn` / `ENQUEUE_READ` / `ENQUEUE_WRITE` | put the head in the merge queue | `enqueuePullRequest` ([GitHub GraphQL, mutations](https://docs.github.com/en/graphql/reference/mutations#enqueuepullrequest)) | ok | |
| `mergeOn` / `MERGE_READ` / `MERGE_WRITE` / pinned merge | merge with no queue, pinned to the tested main | merge; update a ref with `force: false` ([GitHub REST, git refs](https://docs.github.com/en/rest/git/refs)) | ok | |
| `rerunChecksOn` | re-run the failed jobs of a head's runs | re-run failed jobs ([GitHub, re-running workflows and jobs](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/re-running-workflows-and-jobs)) | ok | |

## codeowners.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `OwnerRow` / `.pattern`, `.owners` / `parseCodeowners` / `matcherFor` / `ownersOf` / `everyOwner` / `teamOf` | a CODEOWNERS row and its reads | CODEOWNERS ([GitHub, about code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)) | ok | |
| `guarded` (`codeowners.ts:68`) | the changed paths that need an owner's approval | protected files | two-ideas | build's `guard` / `guarded` (draft) is a write lock. `ownedPaths`. 70% |
| `CheckChange` / `checkChange` / `ask:owner:check_change` | a stage touched the exam: the owner is asked, with the files | | ok | the outcome is in the draft (section 2) |

## child.ts, sh.ts, worktrees.ts, comments.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `runChild` / `ChildOptions` / `.cwd`, `.env` | run one command to its end | child process ([Node, child_process](https://nodejs.org/api/child_process.html)); `Command` ([Effect, command](https://effect.website/docs/platform/command/)) | two-ideas | "child" is a tea child machine in `combos.ts` and the lane. `runCommand`. 75% |
| `Exited` / `.code`, `.out`, `.err` | how one command ended | exit status, stdout, stderr ([Node, child_process](https://nodejs.org/api/child_process.html)) | ok | fabrika exports another `Exited` (`host/ledger.ts:142`) for a program; different module, keep |
| `runLow` | the same under `nice -n 19` | `nice` ([POSIX, nice](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/nice.html)) | differs | `runNice`. 70% |
| `sh` | one command, its stdout, through `execFile` (no shell) | `execFile` ([Node, child_process](https://nodejs.org/api/child_process.html)) | differs | `sh` names the POSIX shell, which this never starts. `execFile`, or fold into `runChild`. 75% |
| `Worktrees` / `.make`, `.remove` | the lane's working copies | `git worktree add` / `remove` ([git-worktree](https://git-scm.com/docs/git-worktree)) | differs | `.add`, git's word. 60% |
| `isMachines` | is this comment a machine's, so nobody's reply | GitHub's bot accounts ([GitHub glossary](https://docs.github.com/en/get-started/learning-about-github/github-glossary)) | differs | ship's `PrFacts.comments.by: person, bot` (draft) says `bot`. `isBots`. 65% |

## sandboxes.ts, tsh.ts, bin, rubrics

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `STAGES: triage, plan, test_writer, build, mutation, review, push, merge` / `Stage` (`sandboxes.ts:21`) | every stage of a lane, in order | | two-ideas | the pipeline's stages say `sort` (code) and `ship`, where this says `triage` and `push` + `merge`; `Stage` is also exported in `hosted/stage.ts:23`, `tickets/ticket.ts:51` and fabrika `shell/check.ts:38`. Not the shell's stage (**picked 2026-10-28**: dropped there). One list of stage names for the pipeline. 75%. What would settle it: whether ship is split in two |
| `hasAgent` / `sandboxFor` / `mount: none, worktree, commit` / `credential` | what each stage's sandbox mounts and holds | | ok | the `Sandbox.Job` it returns is **picked 2026-10-28** as `SandboxCommand` |
| `NEEDS` (`tsh.ts:14`) | the optional peers tsh imports | `peerDependencies` ([npm, package.json](https://docs.npmjs.com/cli/v10/configuring-npm/package-json)) | differs | `PEERS`. 75% |
| `bin/tsh` | the package's command | `bin` ([npm, package.json](https://docs.npmjs.com/cli/v10/configuring-npm/package-json)) | ok | |
| `rubrics/code.md`, `doc.md`, `skill.md` | fabrika's default review rubrics | rubric | ok | |

## criteria/mark.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `markOf` / `readMark` | a criterion's `c3 v2` label in a ticket's box | | two-ideas | `Marker` (`verdict.ts`) and `markerOf` / `marked` (idempotency, draft) are two other marks. `stampOf` / `readStamp`. 55%. What would settle it: the glossary pass |
| `wordsOf` | words as they are compared | normalize | ok | |

## criteria/book.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Book` / `.next`, `.live`, `.retired`, `.verdicts` / `EMPTY` | a plan's criteria for life, with every wording and verdict | an event-sourced aggregate ([Fowler, event sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)) | differs | an in-house word, but short and used across direction notes. Keep, glossed. 60% |
| `criteria` (the machine, `book.ts`) / `apply` | the book as a tea machine; one event folded in | reducer | ok | |
| `Stated` | a criterion at one version | | ok | |
| `BY: plan, owner, review` / `By` | who made or changed a criterion | | ok | |
| `Wording` / `.version`, `.text`, `.by` | one wording | | ok | |
| `Entry` (`book.ts:55`) / `.task`, `.wordings` | one criterion with its history | | two-ideas | `Entry` is exported eight times (asks ledger, ticket fold, promises, fabrika `listed.ts`). `CriterionHistory`. 65% |
| `Row` (`book.ts:58`) / `.criterion`, `.version`, `.head`, `.grade: pass, fail`, `.proof` | a review's word on one criterion, before the book files it | | two-ideas | `Row` is exported nine times (fabrika ledger, ship ready, review sheet, build guard). `Grade`. 60% |
| `Verdict` (`book.ts:71`) | a row filed under `v<n>` | | two-ideas | see `Verdict` in verdict.ts. The book's is the one that should keep the name |
| `CriteriaMsg.type: added, reworded, removed, judged` | the four events | | two-words | `removed` sends an entry to `.retired`. One word: `retired`. 75% |
| `nextId` / `byReview` / `withRound` / `currentOf` / `standingAt` / `historyOf` | reads and folds | | ok | |
| `Round` (`book.ts:165`) / `.head`, `.proof`, `.rows`, `.found`, `.task` | one review round at one commit | | two-ideas | `stages/operate/stop.ts:57` exports `Round` for a build round, and the lane's "round" is a build try (draft). `ReviewRound`. 75% |
| `Current` / `.id`, `.version`, `.text`, `.task` | a criterion as it holds now | | ok | |
| `Standing` / `.state: met, open` / `.verdict` | a criterion met or open at a head | | two-ideas | the draft's local `Standing: wanted, withdrawn, unsaid` is another idea. `AtHead`. 55% |

## criteria/record.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `CriteriaRecord` / `.read`, `.judged` / `memoryRecord` / `ledgerRecord` | where criteria and verdicts are kept for the stages | | ok | |
| `Held` / `.criteria`, `.verdicts` / `heldOf` | what the record holds for one ticket | | two-ideas | fabrika exports `Held` (`host/ledger.ts:74`) for a lease. `Criteria`. 60% |
| `Judgement` / `.criteria`, `.rows`, `.found`, `.head`, `.proof` | what a review hands the record: one round | | two-words | the book's `Round` is the same round with `task`. One name: `ReviewRound`. 70% |
| `kept` / `keep` / `followed` / `followedThenKept` | the rows that hold; fold a round in; follow a ticket's criteria | | two-ideas | `kept` has four meanings in the draft. `holding` / `fileRound` / `follow`. 60% |

## tickets/ticket.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `TicketNumber` / `Title` / `Body` / `Sha` / `Count` | a ticket's fields | issue `number`, `title`, `body` ([GitHub REST, issues](https://docs.github.com/en/rest/issues/issues)) | ok | |
| `Said` (`ticket.ts:35`) | a comment's text with something in it | comment `body` | two-ideas | `Said` is exported four times (triage, review, fabrika shell). `CommentBody`. 80% |
| `Stage` (`ticket.ts:51`) | a stage's name as text | | two-ideas | see `Stage` in sandboxes. `StageName`. 75% |
| `Id` (`ticket.ts:54`) | any one-line id: a run's, an ask's, a task's | | two-ideas | `entity.ts`'s `Id` is a branded id of one kind. `Ref`. 60% |
| `Outcome` (`ticket.ts:63`) | a stage's answer, in the five verbs | `AnyOutcome` (draft) | two-words | the same shape as `AnyOutcome`, written again. Reuse it. 75% |
| `Check` (`ticket.ts:73`) / `.name`, `.status: queued, in_progress, completed`, `.conclusion: success, failure, ...` | one check on a PR, in GitHub's words | check run ([GitHub REST, check runs](https://docs.github.com/en/rest/checks/runs)) | two-ideas | `Check` is the move (draft #1). `CheckRun`, GitHub's own word. 85% |
| `PrState: draft, open, merged, closed` | a PR's state as the watcher read it | | ok | exported again in `stages/lane/view.ts:42` (draft) |
| `Asks: changes` / `commented.asks` | a comment that requests changes | `CHANGES_REQUESTED` ([GitHub, about PR reviews](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews)) | two-ideas | another `ask`. `requests: "changes"`. 65% |
| `TicketFact.type: filed, commented, closed, reopened` | the tracker's own four | `opened`, `commented`, `closed`, `reopened` ([GitHub, issue event types](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types)) | differs | `opened`, GitHub's word. 60% |
| `CodeFact.type: started` / `.run`, `.stage`, `.task`, `.log` | code started an agent run | span start ([OpenTelemetry, traces](https://opentelemetry.io/docs/concepts/signals/traces/)) | two-ideas | `run` is an agent run here; the 2026-10-28 pick (run → process) is the shell's, not this. Say so in the glossary. Not picked |
| `CodeFact.type: ended` / `.outcome`, `.usd`, `.input`, `.output`, `.turns` | the run ended, what it cost | `usage.input_tokens`, `output_tokens` ([Anthropic, Messages API](https://docs.anthropic.com/en/api/messages)) | differs | `inputTokens`, `outputTokens`, to match `Usage` (picked 2026-10-24). 70%. `usd` rides on the money item (#32) |
| `CodeFact.type: planned` / `.version`, `.tasks`; `reviewed` / `.head`, `.met`, `.of`, `.findings`; `answered` | lane facts on the ticket | | two-ideas | the asks ledger's `Fact.type` (draft, section 9) has its own `planned`, `reviewed` and `answered`, with other shapes. Two fact vocabularies share three words. Merge them or prefix one set. 70%. **picked 2026-10-28:** they are events, and the old names are rebuilt, not renamed |
| `CodeFact.type: pushed` / `.head`, `.commits` | build pushed commits | push event | ok | |
| `CodeFact.type: asked` / `.ask`, `.what`, `.picks` | a stage asks the owner something | | two-words | `Question.text` and the Judge's `choices` (combos, primitives) say `text` and `choices`. `text`, `choices`. 70% |
| `PrFact.type: pr` / `.url`, `.state`, `.head`, `.checks` | the watcher saw the PR change | | ok | |
| `PersonFact.type: answered` / `.ask`, `.pick`, `.note`, `.text` | a person answered an ask | | two-words | `pick` is `choice` in combos; `text` holds a hash (see `Asking.saw`). `choice`, `saw`. 75% |
| `PersonFact.type: rated` / `.finding`, `.says` | a person rated a finding | | ok | |
| `TicketFact` / `CodeFact` / `PrFact` / `PersonFact` / `LaneFact` / `Fact` / `FactOf` | who writes which facts | | two-ideas | `Fact` is also the asks ledger's (`asks/ledger.ts:49`). **picked 2026-10-28:** `Event`; these are rebuilt, not renamed |
| `WRITTEN_BY: anyone, person` / `mayWrite` | who may write each fact | | two-words | the writer's kind is `user` (`by.kind === "user"`). `user`. 75% |
| `Entry` (`ticket.ts:247`) / `.pos`, `.ticket`, `.by`, `.whose`, `.at`, `.fact` | one fact read back | timeline item ([GitHub REST, timeline](https://docs.github.com/en/rest/issues/timeline)) | two-ideas | see `Entry` in book. `TimelineEntry`. 70% |
| `State: open, closed` / `Ticket` / `.number`, `.title`, `.state`, `.timeline` | a ticket, folded | issue state; timeline ([GitHub REST, timeline](https://docs.github.com/en/rest/issues/timeline)) | two-ideas | build exports another `Ticket` (`stages/build/ticket.ts:61`, draft). Keep this one; rename build's |
| `ROOT` (`ticket.ts:271`) / `nameOf` | `tracker/ticket`; ticket N's stream name | | two-ideas | `nameOf` is the outcome printer (`stages/outcome.ts:86`); `ROOT` is also the asks ledger's. `streamOf`, `TICKETS_ROOT`. 80% |
| `Read.kind: entry, other, broken` / `readRow` | what one ledger row is to the tracker | | two-ideas | `Read` also in test-writer `checked.ts:51` and fabrika `shell/decode.ts:15`. `RowRead`. 65% |
| `Folded` / `.tickets`, `.problems` / `fold` / `factsOf` | fold entries onto tickets; the facts of one kind | `foldl` ([Elm core, List](https://package.elm-lang.org/packages/elm/core/latest/List#foldl)) | two-ideas | this `fold` is the right word, but `fold` also means a ticket joining a plan (the first ten, item 5), and `Folded` / `factsOf` are exported again by the asks ledger. **picked 2026-10-28:** this `fold` stays (a left fold); joining a plan becomes "added to a plan" |

## tickets/tickets.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Tickets` / `.read`, `.write` / `ticketsOnLedger` | the lane reads a ticket, writes a code fact | | ok | |
| `Watcher` / `.write` / `watcherOnLedger` | the PR watcher's one write | | ok | |
| `TicketsFailed` / `Why: unreachable, no_ticket, refused, not_yours, bad_fact` | why a read or write did not go through | | two-words | everywhere else "the backend did not answer" is `unknown`. `unknown`. 65% |
| write key (`r-1/started`) | a write's own key, from run and step | idempotency key | ok | |
| `Seeded` / memory Layers | test setup | | ok | |

## tickets/approval.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Text` / `.title`, `.body` / `textOf` | a ticket's text as a person reads it | | ok | |
| `sha256` / `hashOf` / `covers` | hash the text; does an approval still cover it | dismiss stale approvals ([GitHub, protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)) | two-words | see `Hash` / `hashOf` / `covers` in combos |
| `changesRequested` | did a person request changes after the approval | request changes ([GitHub, about PR reviews](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews)) | ok | |

## trace/viewing.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `FABRIKA_VIEWING` / `.wentWrong`, `.keptOut` | how fabrika's spans are shown: red when an outcome went wrong; dropped values | span status Error ([OpenTelemetry, traces](https://opentelemetry.io/docs/concepts/signals/traces/)) | ok | |

## catchup/

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| catchup (the stage, `catchup` machine) | merges main into the plan's branch, or reverts a dropped task's commits | update a branch from base ([GitHub, keeping your PR in sync](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/keeping-your-pull-request-in-sync-with-the-base-branch)); revert ([git revert](https://git-scm.com/docs/git-revert)) | two-ideas | one machine, two jobs keyed by `drop`. GitHub's word for the first is "update branch". `sync` for the merge (65%); the revert as its own Cmd path named `drop`. Lean, settle by how often each runs |
| `CatchupAsk` / `.plan` / `.drop` | the machine's input: which plan, and a task to take out or `null` | workflow input | differs | `CatchupInput` (the `*Input` pick) |
| `CatchupView` / `.branch` / `.main` / `.merged` / `.drops` | what it read: branch head, main head, whether main is in, commits to revert | none needed | ok | `drops` holds commit shas, `drop` a task id: two ideas, one stem. `reverts` (the push already says `reverts`). 75% |
| `Tried` / `.conflicts` / `.lockfile` | the trial merge: files in conflict, whether the lockfile must be made again | merge conflict ([git merge, conflicts](https://git-scm.com/docs/git-merge#_how_conflicts_are_presented)) | two-ideas | `Tried` is also the refine combo's `Tried` (draft, shared). `TrialMerge`. 75% |
| `Resolved` / `.path` / `.text` | one file as the resolver left it | resolved conflict ([git merge](https://git-scm.com/docs/git-merge)) | ok | |
| `readCatchup` (`catchup_read`) / `tryMerge` (`catchup_try`) / `pushCatchup` (`catchup_push`) / `ResolveSub` (`catchup_resolve`) / `resolveSub` / `CatchupCmd` / `CatchupMsg` | read, try, push, and the resolver run | Cmd, Sub | ok | |
| `pushCatchup` input `base`, `main`, `reverts`, `resolved`, `lockfile`, `message`; err `unknown`, `unresolved`, `lockfile_failed` | what is pushed | push | ok | |
| state `phase`: `idle`, `reading`, `trying`, `resolving`, `pushing`, `over`; keys `ask`, `base`, `main`, `asked`, `tried`, `outcome`, `problems`, `spend` | where it is | Elm's Model | ok | `ask` → `input`, `spend` → `usage` (the picks) |
| Msg `catchup_resolved` / `.files` / `.ran`; `catchup_unresolved` / `.why` | the resolver's answer | structured output | ok | |
| `CatchupOutcome`; `done {head, changed}`; `skip: up_to_date`; `stuck: read_failed, unresolved, lockfile_failed, draft_failed, push_failed` | the five verbs | git says "Already up to date." ([git merge](https://git-scm.com/docs/git-merge)) | ok | |
| `LOCKFILE = "pnpm-lock.yaml"` | the lockfile made again after a merge | lockfile ([pnpm, working with Git](https://pnpm.io/git)) | ok | |
| `branchOfPlan` / `mergeMessage` | `plan/<n>`, and the merge commit's message | none needed | two-words | `task/view.ts` exports `planBranchOf` for the same `plan/<n>`. One function, `planBranchOf`. 90% |

## test-writer/

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `PropertyId` (`p1`) | a property's id | none standard | ok | picked 2026-10-24 |
| `Property` | see "Renamed since the draft" | property | ok | |
| `Pointer` / `.at` / `.why` (`brief.ts`) | a file the writer may start from | see the draft's `Pointer` | differs | defined a second time here, the same as plan's `Pointer`. Import plan's. Name held for the glossary pass (draft) |
| `writer` / `WriterBrief` / `mutantsWriter` / `MutantsBrief` | the two briefs: write tests per property, answer mutants | brief, prompt | ok | |
| brief keys `ticket`, `plan {version, summary}`, `base`, `properties`, `pointers`, `includes`, `taken`; `head`, `survived` | what each brief carries | none needed | ok | `version` is held for the glossary pass (draft) |
| `TestsAsk` / `.tries` (and the brief keys) | the input | workflow input | differs | `TestsInput` (the `*Input` pick); `tries` is tracker #32 |
| `readTaken` (`tests_taken`) / `commitTests` (`tests_commit`) / `onBase` (`tests_on_base`) / `recordFacts` (`tests_record`) / `readChecked` (`tests_checked`) / `TestWriterCmd` / `runSub` / Msg `tests_write_tool` | read existing test names, commit, run on base, record facts, read them back | Cmd, Sub | two-words | `recordFacts` writes `checked` facts and its tag says `record`; a fact is an `Event` (**picked 2026-10-28**). `taken` = test names already used: `existing` reads plainer. 60% |
| `TestWriter` / `phase`: `idle`, `reading`, `writing`, `committing`, `running`, `recording`, `over`; keys `brief`, `refining`, `restarts`, `costUsd`, `commit`, `checked`, `found`, `remember` | the state | Elm's Model | two-ideas | `TestWriter` is the state type, `testWriter` the machine (as `Review`). `TestWriterState`. 80%. `costUsd` is tracker #32 (money) |
| `TestWriterReport` / `.written` / `.commit` / `.checked` / `.found` / `.problems` / `.tries` / `.costUsd` | what it reports | report | ok | money word and `tries`: tracker #32 |
| `MAX_RESTARTS = 1` | restarts allowed before `cut_off` | retry policy ([Temporal, retry policies](https://docs.temporal.io/encyclopedia/retry-policies)) | ok | tries: tracker #32 |
| `TestWriterOutcome`; `done {commit}`; `ask: owner: fails_on_base, already_passes, cannot_test`; `skip: no_properties`; `stuck: read_failed, draft_failed, unchecked, cut_off, commit_failed, run_failed, no_result, record_failed` | the five verbs | five verbs | ok | `unchecked` → `unfixed`, following the 2026-10-24 pick for plan and sort |
| `SURPRISES` / `Surprise` | the three asks, as data | none standard | ok | |
| `Results` / `.property` / `.result` | each property's red or green | check run conclusion ([GitHub REST, check runs](https://docs.github.com/en/rest/checks/runs)) | ok | |
| `Checked` / `.fact: "checked"` / `.property` / `.version` / `.head` / `.tool: "test"` / `.result` | the fact a test's result is | fact | two-ideas | build's `checksOf` / `Checked` (draft) is a hook's verdict. And this tag key is `fact`, the asks ledger's is `type` (tag key: tracker #32) |
| `TestsWritten` / `.fact: "tests_written"` / `.ticket` / `.commit` | the fact the tests landed | fact | ok | |
| `Found` / `.property` / `.for` | a surprise about one property | none | two-ideas | review's `Found` is a reviewer's finding (draft). `Surprised`. 70% |
| `Read` (`read: true \| false`) / `readRun` / `firstOf` / `shows` / `cannotOf` / `testsOf` | reading a run's results back | none needed | collides | `Read` as a type name is too bare, and `read` is a key in plan's `Criterion.read`. `ReadBack`. 60% |
| `File` / `.path` / `.text` | one test file the writer wrote | file | collides | shadows the DOM `File` global ([MDN, File](https://developer.mozilla.org/en-US/docs/Web/API/File)). `TestFile`. 85% |
| `Answer` / `.kind: test, cannot` / `.property` / `.file` / `.name` / `.why`; `TestAnswer` | the writer's answer per property | structured output | two-ideas | `Answer` is also ship's `Answer` and the asks core's (draft). `PropertyAnswer`. 75% |
| `Written` / `.files` / `.answers` / `DEFAULT_INCLUDES` / `includedBy` / `fileProblems` / `problemsOf` | the writer's form, and its Check | structured output | ok | |
| `MutantAnswer` / `.answer: test, cannot, noise` / `.mutant` / `.test` / `.file` / `.why`; `Answered` / `.files` / `.answers` | the writer's answer per mutant | structured output | two-words | the same shape as `Answer` but the tag key is `answer` there and `kind` here (tag key: tracker #32) |
| `noise` / `NOISE_RULE` / `NOISE_SILENCE` / `findingOf` / `ratedAs` | a mutant a test could see but should not lock | Google filters "irrelevant" mutants ([Google, Practical mutation testing at scale](https://research.google/pubs/practical-mutation-testing-at-scale-a-view-from-google/)); equivalent mutant is a different idea | differs | keep `noise` with a gloss, or `irrelevant`. 55%: settle by reading how Rate's "fix or noise" is shown to the owner |
| `mutantsAnswer` / `answeredProblems` / `answering` | the mutants Draft, its Check, its refine loop | none needed | ok | |
| `kills` / `Killing` / `startKills` / `killRan` | running each `test` answer red on the mutant and green on the original | killing a mutant ([Stryker, mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)) | ok | |
| `MutantsOutcome`; `done {findings}`; `ask: owner: disable`; `stuck: not_killed, run_failed` | the mutants job's verbs | five verbs | two-ideas | a second outcome type in one stage: the test writer has `TestWriterOutcome` and `MutantsOutcome`, and the mutation stage sends to `test_writer`, not to a "mutants" stage. Name the job in the send: `send:test_writer:mutant_survived` reads right, so keep, and gloss "the test writer's mutants job". 60% |
| `pid` / `P1` / `P2` / `BASE` / `COMMIT` / `ASK` / `TAKEN` / `GOOD` / `Script` / `drive` (`scripted.ts`) | test fixtures | fixture | collides | `pid` is the picked 2026-10-28 word for a process id. Here it makes a `PropertyId`. **picked 2026-10-28:** `propertyId` |

## operate/

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `operate` (program, folder) / `loop` (machine) / `Loop` / `LoopMsg` / `LoopCmd` / `LoopSettings` / `LoopOutcome` / `LoopName` / `LOOP_NAMES` / `isLoopName` / `loopLine` / `loopDrawing` | one ticket driven build, review, build, review, then ship | control loop ([Kubernetes, controllers](https://kubernetes.io/docs/concepts/architecture/controller/)) | two-words | the program says `operate`, everything inside says `loop`. Pick one: `loop` (the industry's "control loop"), program `loop`. 65%: `operate` is also fabrika's skill name, which may be why it stays |
| `Loop` (state) / `phase`: `idle`, `claiming`, `building`, `reviewing`, `posting`, `shipping`, `releasing`, `over` | where the loop is | Elm's Model | two-ideas | state type and machine share a word. `LoopState`. 80% |
| `LoopSettings` / `.rubrics` / `.model` / `.effort` / `.budget` / `.ship: read, write` / `.agents {build, review}` | the loop's flags | options | two-words | `ship: read, write` is ship's `mode: read, write`. `shipMode`. 75%. `budget` is tracker #32 |
| `claimTicket` (`loop_claim`) / `releaseTicket` (`loop_release`) | hold the ticket on the ledger, let it go | lease ([Kubernetes, leases](https://kubernetes.io/docs/concepts/architecture/leases/)) | ok | the draft's `claim` / `release` / `Lanes` rows |
| `runBuild` (`loop_build`) / `runReview` (`loop_review`) / `runShip` (`loop_ship`) / `postVerdicts` (`loop_post`) | start a stage as a child, or post the review comments | child workflow ([Temporal, workflows](https://docs.temporal.io/workflows)) | ok | |
| inputs `ticket`, `number`, `round`, `open`, `pr`, `rubrics`, `head`, `mode`, `posts`, `lane` | what each Act is handed | none needed | ok | |
| `Post` / `.verdict: pass, fail` / `.reason` / `.text` / `postsOf` | one review comment to post | review comment ([GitHub REST, issue comments](https://docs.github.com/en/rest/issues/comments)) | ok | |
| `Verdict` / `.pr` / `.head` / `.kind` / `.verdict` / `.reason` / `.text` / `markerOf` / `commentOf` (`writes.ts`) | one kind's verdict as a PR comment | review ([GitHub REST, reviews](https://docs.github.com/en/rest/pulls/reviews)) | two-ideas | the fifth `Verdict` (the draft counts four). `PostedVerdict` or reuse `Post` plus `pr`, `head`, `kind`. 75% |
| `ReviewWrites` / `.post` / `reviewWritesOn` / `gitHubLoopWrites` | posting comments, as a service | Effect service | ok | |
| `BuildEnd` / `.outcome` / `.name` / `.report`; `ShipEnd` / `.outcome` / `.said` | how a child stage ended, as the loop reads it | child result | ok | |
| `Round` / `.n` / `.built` / `.pr` / `.head` / `.changed` / `.reviewed` / `.open` / `.items` / `.shipped` / `.spend` / `.problems` | one build-and-review round | iteration | ok | `spend` → `usage` (the pick); `built`, `reviewed`, `shipped` hold outcome names, not data. `.n` is the only one-letter key in the area: `round`. 60% |
| `Next` / `.go: review, ship, build, end` / `.items` / `.head` / `.outcome` / `.said` (`stop.ts`) | the loop's next step | none needed | two-ideas | lane's `Next.go` has another list, and the asks core's `Next.do` another (draft). `LoopNext`. 70%. Tag key: tracker #32 |
| `openItems` / `afterBuild` / `afterReview` / `shipItems` / `afterShip` / `again` | the pure rules after each stage | none needed | ok | |
| `LoopOutcome`; `done {pr, head, rounds}`; `ask: owner: no_progress, no_change, ship`; `skip: closed, merged, not_ready, claimed`; `stuck: claim, build, review, post, ship` | the five verbs | five verbs | two-words | lane says `stuck:build_failed`, the loop says `stuck:build` for the same idea. `build_failed` and so on, as lane. 80% |
| `.said` (`Ended`, `ShipEnd`, `Next`) | the child outcome name that made the loop end | none needed | ok | |
| program `operate` input `ticket`; outputs `step` (`Step`), `ended` (`Ended`); flags `rubrics`, `model`, `effort`, `budget`, `ship`, `agents` | what users pipe and type | program outputs | ok | |
| `Step` / `.ticket` / `.round` / `.stage: build, review, post, ship` / `.name` / `.pr` / `.head` / `.open` / `.spend` / `.says` / `.problems` | each stage of each round, as an output | span or event per step | two-ideas | `Step` here is an output row; the machines' local `type Step = [State, Cmds]` is the update's return in every stage file. `RoundStep` or `StageEnded`. 70%. `.stage` is the pipeline's stage (ok, not the dropped shell word) |
| `Ended` / `.ticket` / `.name` / `.said` / `.rounds` | how the loop ended, once per ticket | completion event | ok | |

## hosted/stage.ts, hosted/agent.ts, hosted/children.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Stage.job` / `JOB_ID = "job"` / `jobOf` (lane.ts) / `decodeJob` | a hosted stage's one input, cast into its inbox under the id `job` | Temporal: workflow input ([Temporal, workflows](https://docs.temporal.io/workflows)); the shell's job is now a tsh line, as in bash ([bash, job control](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Basics.html)) | two-ideas | **picked 2026-10-28:** job is a tsh line. So the stage's `job` must move: `input` / `INPUT_ID = "input"`, with the draft's `*Input`. 80% |
| `buildTurn`, `planTurn`, `reviewTurn`, `resolveTurn`, `localReviewTurn` | the agent child's one turn on one ask, per stage | Claude Agent SDK and OpenAI call one model reply a turn; Temporal would call the child's work an activity ([Temporal, activities](https://docs.temporal.io/activities)) | ok | |
| `CHILD = ":agent"` / `stageOf` | the suffix that names a stage's agent child | none standard; OTP names children by id in a child spec ([OTP, supervisor](https://www.erlang.org/doc/system/sup_princ.html)) | ok | |
| `AgentNote.step: hold, turn, answered, limit, skipped, withdrawn` / `.usd` | what the agent child says per ask, for the harness | log events; none standard | ok | `.usd` is one more money word (see "money cap", #32, not picked) |
| `quiet` | the child's machine: keeps nothing, one `noop` Msg | Elm: a program with no model changes ([Elm guide](https://guide.elm-lang.org/architecture/)) | ok | |
| `Asking` (`id`, `fence`, `on`) | a stage's ask row: `on` true when it asks, false when it takes the ask back | none standard | two-ideas | `on` is a boolean here, and the tag key of `Told` and desk's `Heard` elsewhere. Lean `wanted: boolean`, 65%: settles with the tag-key pick (#32) |
| `childrenOf` stream `<parent>/children` | where a parent names its children | OTP: `supervisor:which_children` ([OTP, supervisor](https://www.erlang.org/doc/apps/stdlib/supervisor.html)) | ok | |

## hosted per-stage files (build, catchup, task, plan, review, review-local, sort, ship)

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `BuildJob.at` / `CatchupJob.at` / `TaskJob.at` | the commit's date in seconds, fixed so every host makes the same commit | `SOURCE_DATE_EPOCH` ([Reproducible Builds](https://reproducible-builds.org/docs/source-date-epoch/)); git `GIT_AUTHOR_DATE` ([git, environment variables](https://git-scm.com/book/en/v2/Git-Internals-Environment-Variables)) | two-ideas | `at` is also `Landing.at`, `Ask.at` and `Pointer.at` (draft: held for the glossary). Lean `date`, 70%: the glossary pass on `at` settles it |
| `*Job.usd` | the child's dollar cap | money cap, #32 | two-words | not picked (#32). Beside `settings.budget` in the same struct, two caps in one input |
| `PlanJob.tries` / `SortJob.tries` | how many drafts the stage may try | Temporal `maximumAttempts` ([Temporal, activities](https://docs.temporal.io/activities)) | two-words | not picked (tries, #32) |
| `CatchupJob.drop` | a task to drop from the branch before catching up, or null | none standard | ok | |
| `ResolveAsk` (`plan`, `base`, `main`, `conflicts`, `settings`) | catch-up's ask to its resolver child | GitHub: resolving a merge conflict ([GitHub](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/addressing-merge-conflicts/resolving-a-merge-conflict-on-github)) | two-ideas | `Ask` again (open, #32). Not picked |
| `PlanAskBody` / `Run` (plan.ts) | the plan child's ask body: one draft run and settings | none standard | two-ideas | `Ask`, and `Run` (the 2026-10-28 pick makes run the shell's process). Lean `DraftRun`, already the name in `primitives.ts`, 80% |
| `catchup_resolved` / `catchup_unresolved` Msgs, err `unresolved`, `lockfile_failed` | the resolver's answer: merged texts, or not | git: conflicts resolved ([GitHub](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/addressing-merge-conflicts/resolving-a-merge-conflict-on-github)) | ok | |
| `task_built` / `task_failed` `.why: broke, misfit, over_budget` | task stage's Msgs from its child | none standard | ok | draft covers `Failed` |
| `catchup` (the stage) / `hostedCatchup` | merge main into the plan's branch | GitHub: "update branch", keeping a PR in sync with its base ([GitHub](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/keeping-your-pull-request-in-sync-with-the-base-branch)) | differs | lean `sync` (GitHub's "in sync"), 60%: a reader search for "catch up" finds nothing; settle by checking which word the direction notes use |
| `shipWritesOf` | ship's three writes on its gate | see `writesOf` | ok | |
| `LocalReviewJob.task: Owner` (a task or `plan`) | which part of the book is reviewed | none standard | ok | `Owner` is outside this scope |

## hosted/outside.ts, hosted/issues.ts, hosted/idempotency.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Outside.branchHead` / `.prFrom` / `.hasComment` / `.landing` / `.remote` | the reads: is a write out there already? | the "look" half of an outbox relay ([microservices.io, outbox](https://microservices.io/patterns/data/transactional-outbox.html)) | ok | |
| `Outside.push` / `.open` / `.comment` / `.enqueue` / `.merge` / `.rerunChecks` | the writes, each with a key | GitHub merge queue ([GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)) | ok | |
| `gitHubOutside` | `Outside` on GitHub | adapter | ok | |
| `Issues.labels` / `.closed` / `.label` / `.close` / `.comment` / `.hasComment` | ticket reads and writes, each write with a key | GitHub REST, labels ([GitHub](https://docs.github.com/en/rest/issues/labels)) | ok | |
| `Failed` `{_tag: "unknown"}` (outside, issues, build, catchup, task) | any failed read or write | Effect: tagged errors ([Effect](https://effect.website/docs/error-management/yieldable-errors/)) | two-words | `Failed` is also build's `Failed: broke, misfit, over_budget`; the tag `unknown` is the err word of every move. Lean: one exported `Unknown` error, 60% |
| `Key.text` / `.name` / `.fence` / `.real` | an idempotency key, minted only by the gate | idempotency key ([Stripe](https://docs.stripe.com/api/idempotent_requests), [IETF draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)); fencing token ([Kleppmann](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)) | ok | |
| `Write.look` / `.send` | the look-before-send and the send | outbox relay ([microservices.io](https://microservices.io/patterns/data/transactional-outbox.html)) | ok | |
| `WriteNote.step: done_found, intent, found_out_there, send, sent, done, refused_fence, refused_lease, failed` | the gate's steps, for the harness | none standard | ok | |
| `GateOptions.marginMs` / `.planted: no_lease_check` | lease left needed to send; a planted bug | lease ([Kubernetes, leases](https://kubernetes.io/docs/concepts/architecture/leases/)); planted fault, FoundationDB "buggify" ([FoundationDB, testing](https://apple.github.io/foundationdb/testing.html)) | ok | |
| `Idempotency.stream` | the stream the rows are in | none | ok | |
| `Faults.at(point)` / point `agent-turn` | a named fault point | FoundationDB buggify ([FoundationDB](https://apple.github.io/foundationdb/testing.html)) | ok | |

## hosted/deliver.ts, hosted/deliver-program.ts (the `deliver` program)

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `deliver` (program name, a tsh word) | plan, build, review and ship each ticket's plan | continuous delivery; none for one program | ok | |
| `deliver` input `plan` (a ticket url) | the ticket a plan is named by | none | two-ideas | the input is a ticket url but is called `plan`. Lean `ticket`, 75%: settles by reading how a person types it on a tsh line |
| `deliver` output `delivered` | once per plan: how its lane ended | none | ok | |
| `--rubrics`, `--model`, `--effort` | CLI flags | Claude Code `--model`, `--effort` | ok | |
| `--budget` / `--usd` | dollars per agent run / dollars per child in all | money cap, #32 | two-words | not picked (#32). Both on one command line is the sharpest case |
| `--agents` | each step's own model, effort, budget | none | ok | |
| `holder` value `tsh-<hex>` | this start's name on the ledger | lease holder identity ([Kubernetes, leases](https://kubernetes.io/docs/concepts/architecture/leases/)) | ok | |
| `mostOneRun` / `Hosting.hold` | the cost a turn holds before it starts | authorization hold (card payments); none in agent tooling | differs | lean `reserve`, 55%: settle with the money-cap pick (#32) |
| `AGENTS`, `Ended` (deliver-program.ts) | the flag's schema; the lane's outcome row | none | ok | |

## hosted/lane.ts, hosted/lane-ends.ts, hosted/lane-trace.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `laneOf` (`lane:<n>`) / `LANE` / `startLane` / `fixedLane` / `hostedLane` | a plan's lane name; the lane under test | lane vs parent, #32 | two-words | not picked (#32) |
| `lane_child` / `lane_owner` Subs, `lane_read`, `lane_open`, `lane_planned` Cmds | the lane's Subs and Cmds as hosted wires them | Elm: Cmd and Sub ([Elm guide, effects](https://guide.elm-lang.org/effects/)) | ok | named in `stages/lane`; draft covers the Cmds by their machine names |
| `ChildPlan` (`ending`, `before`, `after`) | what a stand-in child does in a test | test double, stub | two-ideas | "plan" is the pipeline's plan. Lean `ChildScript`, 75% |
| `Pause` (`before`, `after`) | a stand-in child's waits | none | ok | |
| `Case` (`endings`, `variant`, `limitMs`, `capMs`, `pauses`, `settle`) | one property case | fast-check: one generated run ([fast-check](https://fast-check.dev/docs/introduction/)) | ok | |
| `Variant: today, fixed` | the lane as it is, or with the fixed child Sub | A/B variant | ok | |
| `worldOf` / `tick` / `endingsOf` / `rowsRead` / `traceCase` | the case's world, one clock step, the generator, a law, run with the log | Effect `TestClock.adjust` ([Effect](https://effect.website/docs/testing/testclock/)) | ok | |
| `stand-in-child` (program name) | a child that writes its row or not, then exits | stub | ok | |
| `Proc: none, up, down` | a child's process state in the TLA+ spec | TLA+ variable ([Specifying Systems](https://lamport.azurewebsites.net/tla/book.html)) | differs | **picked 2026-10-28:** run is process. `Proc` already says process, so it fits. Keep, spelled out as `Process` in TS, 70% |
| `Kind: none, done, stuck` (lane-trace.ts) | a child's outcome row in the spec | outcome verbs (`AnyOutcome.kind`) | two-ideas | `kind` (#32, not picked). Also a fourth exported `Kind` (review's `pack.ts`, fabrika's `program.ts`) |
| `SpecState` (`lane`, `cur`, `proc`, `row`, `exit`, `seen`) | the spec's six variables | TLA+ state ([Specifying Systems](https://lamport.azurewebsites.net/tla/book.html)) | ok | |
| `SpecState.lane: ready, running, over, gone` | the lane in the spec | none | ok | |
| `Act: Start, WriteRow, End, Deliver, SeeRow, SeeExit, Exit, Ended, TooMany` / `isLaneStep` | the spec's actions | TLA+ action; trace validation ([Cirstea et al., arXiv 2404.16075](https://arxiv.org/abs/2404.16075)) | collides | `Act` is one of the six moves (`act` in `primitives.ts`). Rename `Action`, TLA+'s word, 90% |
| `Step` (`act`, `k`, `pos`, `to`) / `stepsOf` / `initOf` | one step of a behaviour | TLA+ step and `Init` ([Specifying Systems](https://lamport.azurewebsites.net/tla/book.html)) | two-ideas | `Step` is also exported by `stages/operate/program.ts` and `laws/explore.ts`. Lean keep here (TLA+'s word), 70% |
| `Push` (`act: WriteRow, End`, `k`, `kind`, `after`) / `Script` (`pushes`, `laneSteps`) / `Driven` (`log`, `steps`, `stalled`) / `driveCase` | a driver's moves for the children on one path | none standard | two-ideas | `Push` is also `Outside.push` (git push) in the same folder. Lean `Nudge` or `Move`, 55%: settle once `Act` is `Action` (then `Move` is free only if "moves" stays out) |
| `Seen.ended`, `.outcome`, `.children`, `.ms` | what one case saw | none | ok | |

## asks/ask.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Ask` and every `*Ask` | a record waiting on a person | ask, #32 | two-ideas | not picked (#32) |
| `PlanAsk.problems` | what the plan's check still found | none | ok | |
| `StuckAsk.title` / `.criteria` (`Stated`) / `.open` | the task's title, its criteria now, open counts per round | none | ok | |
| `Attachment.label` / `.ref` | a file a check points at | GitHub check run "annotations"; email attachment | ok | |
| `PlanAnswer.kind: approve, change, no` | the plan answers | GitHub review: approve, request changes ([GitHub, environments](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment)) | ok | draft covers `.line`, `.to`, `.why` |
| `Next.version` / `.line` / `.to` / `.why` / `.task` / `.rounds` / `.criterion` / `.text` / `.record` / `.plan` / `.build` | the keys of each `Next` case | none | two-ideas | `Next.plan` is a boolean ("plan what it says to build") where `plan` is a `PlanId` everywhere else in asks. Lean `replan` or `plans: boolean`, 70%. `Next.criterion` on `rebuild` is the note text, on `reopen` an id: lean `note` for `rebuild`, 80% |
| `Next.do: ruled` with `record` | write a decision record | ADR ([adr.github.io](https://adr.github.io/)) | ok | |

## asks/ledger.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Fact` | the pipeline's facts | event ([Fowler, event sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)) | two-words | **picked 2026-10-28:** `Event` |
| `judged` fact `.task`, `.head`, `.proof`, `.rows`, `.found` | a review round's rows and what it found | review round | ok | `.proof` is also ship's `Proof` (a different struct). Not urgent |
| `reviewed` fact `.open` / `built` fact `.changes`, `.holds` / `cleared` and `check_raised` `.build`, `.by` | counts, files, holds, which build | none | ok | |
| `released` fact `.lane` / `lane` fact | a lane let its ticket go; a lane began | lease release ([Kubernetes, leases](https://kubernetes.io/docs/concepts/architecture/leases/)) | ok | |
| `WRITTEN_BY` `anyone, person` | who may write each fact | access rule | ok | |
| `Entry.seq` / `.fact` | a fact with its place | event sourcing: sequence number ([Fowler, event sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)) | ok | `Entry` is exported by four modules, draft covers that |
| `Hold.name` / `.fence` | a lease and its fence | lease and fencing token ([Kleppmann](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)) | two-ideas | `Hold` is a lease here, a cost reserve in `Hosting.hold`, and a build's wait in `holds`. Lean `Lease`, 80% |
| `steadyCall` / `Heard` / `askAgain` | `steady` for `Self` calls; an answer that is not "unreachable"; the backoff | retry with exponential backoff ([AWS](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/), [Effect, repetition](https://effect.website/docs/scheduling/repetition/)) | differs | `steady` is ours; Effect says `retry`. Lean `retryForever` / `retryCall`, 65%: the doubt is that `retry` hides "no limit" |
| `Ledger` (re-export) | the one ledger | event store | ok | |

## asks/program.ts (the `asks` program)

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `asks` (program) / flag `--holds` | the core of owner asks; how many listeners hold each build | Camunda user task ([Camunda](https://docs.camunda.io/docs/components/modeler/bpmn/user-tasks/)) | ok | |
| inputs `planned`, `revised`, `reviewed`, `ruling`, `answer`, `build`, `cleared`, `raise` | what the core is told | none | two-words | input `build` and output `built` both carry a finished build; `raise` (input) becomes the fact `check_raised`. Lean input `built`, 70% |
| outputs `ask`, `settled`, `refused`, `waiting`, `built`, `ship` | what the core says | none | ok | |
| `Raise` | a listener asks the owner to check one build | GitHub check run with `action_required` | ok | |
| `Told.on: fact, answer` / `idOf` / `factOf` | what came in; a fact's once-only message id | idempotent message id | ok | draft covers `Told` |

## asks/rules.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Stall` (`last`, `lowest`, `stalls`, `sinceLowest`) / `stallStep` / `asksOnStall` | the stall rule's count | none standard (searched Temporal, Kubernetes `progressDeadlineSeconds`) | ok | |
| `PlanTrack` (`versions`, `approved`, `closed`, `removed`, `book`, `planned`) | a plan as the fold reads it | event sourcing projection ([EventStore, projections](https://www.eventstore.com/blog/projections-1-theory)) | ok | |
| `BuildTrack.shipped` / `.rejected` | flags on a build | none | ok | |
| `TaskTrack` (`open`, `stall`, `grant`, `time`) | a task's rounds and keep-going grant | none | ok | |

## asks/claims.ts, asks/laws.ts, asks/cases.ts, asks/demo.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `LanesOptions.ttlMs` / `.graceMs` / `Lanes.hold` | lease length, grace past its end, the lease held | Kubernetes Lease `leaseDurationSeconds` ([Kubernetes](https://kubernetes.io/docs/concepts/architecture/leases/)) | ok | |
| `lawHome`, `lawUnfenced`, `lawLost`, `lawOneWins`, `lawRelease` / `P1`..`P5` / `runPipelineLaws` / `PipelineLawOptions` | the pipeline's ledger laws | property-based tests ([fast-check](https://fast-check.dev/docs/introduction/)) | two-words | `law` vs `Property` (draft's open overlap). Not repeated here |
| `demoFacts` | experiment 89's cases as facts | fixture | ok | |

## asks/packs.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Pack` (`program`, `listens`, `answers`, `layer`, `holds`, `shell`) | an add-on package wired to the core | plugin, extension ([VS Code, contribution points](https://code.visualstudio.com/api/references/contribution-points)) | differs | keep `pack` (already in docs and fabrika.toml), glossed "plugin", 70% |
| `Pack.listens` / `.answers` | which core outputs it hears, which core inputs it feeds | Elm ports, out and in ([Elm guide, ports](https://guide.elm-lang.org/interop/ports.html)) | ok | |
| `Platform` | the services a pack may ask for | Effect platform services | ok | |
| `Loaded` / `loadPacks` / `PackRefused` (`_tag: pack_refused`) / `misfit` | a found pack; loading; why not | plugin loading | ok | |
| `Wired` (`core`, `packs`) / `StartedPack.running` / `startWithPacks` | a started core with its packs | Elm ports wiring | two-ideas | **picked 2026-10-28:** wire becomes pipe in the shell. The packs' loop is not a pipe (`packs.ts:42` says a pipe cannot make it), so do not carry the rename here. Keep `Wired`, now the only wire, 70% |
| `Shell` (`typed`, `unread`, `replies`, `pages`) | what a pack offers a shell | none | collides | fabrika exports a `Shell` namespace that `tsh/fabrika-list.ts` imports beside it. Lean `ShellPart` or `Replies`, 75% |
| `Hosting` (`places`, `core`, `unread`) | what the host gives packs | none | two-ideas | also `hosted/deliver.ts:42` `Hosting`. Draft lists both; no new pick |
| `Places` (`folder`, `home`) | where a pack keeps files | none | two-ideas | also `tsh/config.ts:102` `Places` (`home`, `user`), a third meaning of `home`. Lean `PackPlaces`, 80% |
| `settingsOf` / `readerOf` / `HOLDS` | a pack's own settings; the pack that reads typed replies | none | ok | |

## tsh.ts, tsh/fabrika.ts, tsh/fabrika-main.ts, tsh/fabrika-list.ts, tsh/scripted-build.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `tsh` | the shell, with fabrika's programs | a shell, as bash ([bash manual](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Basics.html)) | ok | |
| `NEEDS` | optional peer packages tsh checks for | npm `peerDependencies` ([npm, package.json](https://docs.npmjs.com/cli/v10/configuring-npm/package-json)) | differs | lean `PEERS`, 75% |
| `programsOf` / `fabrikaEntries` / `scriptedBuildEntry` / `deskEntries` | the programs a tsh lists | fabrika's `Entry` | ok | |
| `review-scripted` / `build-scripted` (program names) / `reviewScripted` / `buildScripted` | a program with a scripted agent | stub, fake | ok | |
| `PLAN_TRIES = 3` | plan's drafts per ticket | tries, #32 | two-words | not picked (#32) |
| `TSH_HOME` / `TSH_SCRIPTED` (env) | tsh's home (default `~/.tsh`); turn on `build-scripted` | XDG base dirs ([freedesktop](https://specifications.freedesktop.org/basedir-spec/latest/)); bash keeps `~/.bash_history` ([bash, startup files](https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files.html)) | ok | |

## tsh/config.ts (`tsh.toml`)

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `CONFIG_FILE = "tsh.toml"` / `Config` / `defaultConfig` / `configFrom` / `readConfig` / `ConfigInvalid` (`_tag: config_invalid`) | this machine's settings file | TOML ([toml.io](https://toml.io/en/v1.0.0)) | two-words | `Config` here, `Settings` for fabrika.toml (`settings.ts`). Two words for "settings from a file" by which file. Lean keep both, glossed: config = this machine, settings = the repository, 65% |
| `repo`, `work`, `clone`, `rubrics`, `own`, `reviewers`, `model`, `effort`, `budget` (keys) | the file's keys | GitHub: `owner/name`; `work` like a runner's work folder ([GitHub, self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners)) | ok | `budget` is the money cap (#32) |
| `ship = "read" \| "write"` | say what ship would do, or ship | dry run | differs | lean `ship = "dry-run" \| "live"`, 60%: `read` and `write` read as permissions. Settle with ship's `Plan.mode` (draft) |
| gone `rounds`, moved `packs` / `pack` | keys refused with a reason | none | ok | |
| `Config.said` (`Local`) | the four fallbacks as the file wrote them | none | differs | lean `written`, 70% |
| `Places.home` / `.user` | tsh's home; the user's home | XDG | two-ideas | see `Places` in packs. Lean `TshPlaces` or fold into `Config`, 70% |
| `settingsWhere` / `ledgerFile` | where fabrika.toml is read; the ledger's file | none | ok | |

## tsh/ledger.ts

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `localLedger` (`persist`, `ledger`, `port`, `waitMs`) / `NoLocalLedger` | the Durable Object ledger in Miniflare on this machine | Durable Objects ([Cloudflare](https://developers.cloudflare.com/durable-objects/)) | ok | `persist` is Miniflare's own key |
| `portOf` | the ledger's port from the data folder (FNV-1a) | FNV hash ([Wikipedia, FNV](https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function)) | ok | |
| `ledgerNameOf` / `sqliteLedger` | a URL-safe ledger name; the sqlite way out | none | ok | |

## tsh/desk.ts (`desk`, `desk-demo`, `answer`)

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `desk` (program, `Desk`, `DeskSession`, `deskSession`, `DeskRefused`, `deskProgram`) | the owner's list of asks, and how to answer them | inbox, task list (Camunda Tasklist, [Camunda](https://docs.camunda.io/docs/components/modeler/bpmn/user-tasks/)) | two-ideas | the app's desk (`apps/fabrika/src/desk/`) is the tile layout. Lean `inbox` for this one, already its function name `inboxLines`, 75% |
| `desk-demo` / `deskDemoProgram` | the desk on experiment 89's cases | demo | ok | follows `desk` |
| `answer --ask <id> --reply "<reply>"` / `answerProgram` | a typed reply to one ask | none | two-ideas | `--ask` is an id here, an ask is a record elsewhere (#32). Lean `--id`, 60% |
| `plan ticket=<url> \| desk` / input `planned` | plans piped in, each an approval ask | a shell pipe ([POSIX, jobs](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/jobs.html)) | ok | |
| output `line` | one line of the desk | stdout line | ok | |
| `Running` (`demo`, `wired`, `scope`, `asks`, `heard`, `pages`) | a running desk | none | two-ideas | fabrika exports `Running` (a started program) and `.run` on it. **picked 2026-10-28:** run is process. Lean `OpenDesk`, 75% |
| `Heard.on: waiting, settled, refused` | what the host waits on | none | two-ideas | `Heard` is also a type in `asks/ledger.ts`, `review/tools.ts`, fabrika's `program.ts` and `agent/turn.ts`. Lean `Said`, 60% |
| `inboxLines` / `nextInWords` / `drain` / `folderName` | the desk's lines; a `Next` in words; close and wait | none | ok | |

## tsh/pty (words a person types, as the terminal checks run them)

These words are fabrika's shell (out of scope); they appear here because the checks type them.

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `jobs`, `%1`, `&`, `[1]` | the job table, a job spec, background, the job number | bash job control ([bash](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Basics.html), [POSIX `jobs`](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/jobs.html)) | ok | **picked 2026-10-28:** job stays |
| "run id" (`attach $run`, `tally:<hex>`, kept.exp:2) | one program's id in a job | process id ([bash, job control builtins](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Builtins.html)) | differs | **picked 2026-10-28:** run is process, run id is pid. kept.exp's comment and variable follow |
| `attach` / `detached` / `attached` | start a kept job again; its state | tmux `attach-session`, detached ([tmux](https://man7.org/linux/man-pages/man1/tmux.1.html)) | ok | |
| `tell %1 add 2` / `close %1 add` | send a value to an input; close an input | Erlang send ([OTP, processes](https://www.erlang.org/doc/system/ref_man_processes.html)); closing a pipe's write end | ok | |
| `[stopped]` (after Ctrl-C) | a foreground program ended by Ctrl-C | bash prints "Stopped" for SIGTSTP (Ctrl-Z), not for SIGINT ([bash](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Basics.html)) | differs | lean `[interrupted]`, 75%: bash's "Stopped" means paused and can be resumed |
| `ended` (`[1] ended tally`) | a job's end | bash prints "Done" ([bash](https://www.gnu.org/software/bash/manual/html_node/Job-Control-Basics.html)) | differs | lean `Done`, 60%: settle by checking that `done` is not read as the outcome verb |
| "1 job from an earlier tsh, not running" | kept jobs at start | tmux lists sessions | ok | |
| `(reverse-i-search)`, Tab, Up arrow, Ctrl-D, `exit 3` | readline history and line end | GNU Readline ([bash, history commands](https://www.gnu.org/software/bash/manual/html_node/Commands-For-History.html)) | ok | |
| `want` / `key` / `ended` (want.tcl) | expect helpers | Expect `expect`, `send` ([expect(1)](https://linux.die.net/man/1/expect)) | ok | |

## laws/explore.ts: the one-machine checker

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `explore` | walk every Msg order to a bound, breadth first, check each law each step | explicit-state model checking, as TLC does ([TLA+ tools, TLC](https://lamport.azurewebsites.net/tla/current-tools.pdf); [Wikipedia, model checking](https://en.wikipedia.org/wiki/Model_checking)) | ok | |
| `Step` / `.prev`, `.msg`, `.next`, `.cmds` | one reducer step | a step, a pair of states ([Learn TLA+, temporal logic](https://learntla.com/core/temporal-logic.html)); tea's own `@demlik/tea/pbt` exports a `Step` too | two-words | use tea/pbt's `Step` here if the shapes match, so one type exists. 70%: settle by diffing the two shapes |
| `Broke` / `broke` / `.why` | a law said no, with words | a violation; the run that shows it is an error trace ([Learn TLA+, invariants](https://learntla.com/core/invariants.html)) | two-words | `Violation`, one class for explore and ship-pbt. 70% |
| `Watch` / `.key`, `.step` | a law part way along one path, with its memory | a monitor in runtime verification ([Wikipedia, runtime verification](https://en.wikipedia.org/wiki/Runtime_verification)) | two-ideas | `Monitor` would clash with fabrika's host `Monitor` (laws/tea-host.ts imports it). Keep `Watch`, gloss "monitor". 60%; fabrika's `Watch` (host/monitor.ts:66, program/program.ts:330) means a different thing |
| `Law` / `.name`, `.begin` | a rule a machine must always keep, and how it starts watching | invariant (per state or step) or property (over a run) ([Hypothesis, stateful](https://hypothesis.readthedocs.io/en/latest/stateful.html); [Learn TLA+, temporal logic](https://learntla.com/core/temporal-logic.html)) | two-words | keep `Law` (a direction note, every-machine-has-laws.md, names it); gloss "an invariant or a trace property". One `Law` type, not two (see ship-pbt). 65% |
| `law` | a law that sees one step and remembers nothing | invariant, run after every step ([Hypothesis, stateful](https://hypothesis.readthedocs.io/en/latest/stateful.html)) | ok | |
| `watched` | a law with memory along the path | a trace property, checked by a monitor ([Wikipedia, runtime verification](https://en.wikipedia.org/wiki/Runtime_verification)) | ok | |
| `agree` | a law across paths: same key, same value | a 2-safety hyperproperty, as determinism ([Clarkson and Schneider, hyperproperties](https://www.cs.cornell.edu/fbs/publications/Hyperproperties.pdf)) | ok | gloss "a determinism check" |
| `World` / `.outside`, `.answers`, `.restart`, `.echoes` | what the outside may send: Msgs any time, every answer to a Cmd, restarts, repeats | the environment of a model; fast-check's model and commands ([fast-check, model based testing](https://fast-check.dev/docs/advanced/model-based-testing/)) | two-words | `World` and `System` (world/search.ts) are one idea. Keep `World` for both, `System` becomes `World` too. 65%: they differ in shape (Msgs vs moves) |
| `World.echoes` | an answer may come a second time | duplicate delivery, at-least-once ([AWS SQS, at-least-once delivery](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html)) | differs | `duplicates`. 60% |
| `MsgOf` | every Msg a machine takes | none needed | ok | |
| `Update` | one reducer step function | Elm's `update` ([Elm guide](https://guide.elm-lang.org/architecture/)) | ok | |
| `stepOf` | the real machine's own step | none needed | ok | |
| `Search` / `.init`, `.update`, `.world`, `.laws`, `.depth`, `.most` | one search's input | TLC's model: init, next, invariants, a depth bound ([TLA+ tools, TLC](https://lamport.azurewebsites.net/tla/current-tools.pdf)) | ok | `most` reads oddly: `maxStates`. 55% |
| `Found` / `.law`, `.why`, `.path` | the shortest path that breaks one law | counterexample, `counterexamplePath` ([fast-check, runners](https://fast-check.dev/docs/core-blocks/runners/)); error trace (TLC) | two-ideas | `Found` is also review's finding (stages/review/sheet.ts:113) and test-writer's (stages/test-writer/checked.ts:41). `Counterexample`. 70% |
| `Report` / `.states`, `.sent`, `.steps`, `.layers`, `.complete`, `.capped`, `.ms`, `.widest`, `.broken` | what one search found | TLC prints states generated, distinct states, depth, coverage ([TLA+ tools, TLC](https://lamport.azurewebsites.net/tla/current-tools.pdf)) | two-ideas | `Report` is exported again in world/search.ts:113 and in review and build. `SearchReport`. 70% |
| `Report.widest` | the most Msgs tried from one state | branching factor | differs | `branching`. 55% |
| `Report.layers` | new states at each depth | BFS levels; none standard in TLC output | ok | |
| `Followed` / `follow` | walk one given path by its printed lines | replay a counterexample (`replayPath`, [fast-check, model based testing](https://fast-check.dev/docs/advanced/model-based-testing/)) | differs | `replay`, `Replayed`. 60%: `replay` is also a review/ship report key |
| `pathText` | a path as numbered lines | none needed | ok | |

## laws/walk.ts, laws/sample.ts: random walks as property tests

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `walk` / `walkWorld` / `walkEnds` | one random path, picked by a list of numbers | a random walk / simulation mode in TLC ([TLA+ tools, TLC](https://lamport.azurewebsites.net/tla/current-tools.pdf)); a generated command sequence ([fast-check, model based testing](https://fast-check.dev/docs/advanced/model-based-testing/)) | two-ideas | `Walk` in specs.ts:70 is a search setup (world + depth), not a walk. Rename that one `SearchSetup`. 65% |
| `Walked` / `.broke`, `.path` | how one walk went | a run's result ([fast-check, runners](https://fast-check.dev/docs/core-blocks/runners/)) | ok | |
| `Machine` (walk.ts) / `.init`, `.update`, `.world`, `.laws`, `.show` | one machine as `explore` takes it | none; tea exports `Machine` for the real thing | collides | shadows `Machine` from `@demlik/tea`, imported in explore.ts and ship-pbt.ts. `Checkable` or `Subject`. 60% |
| `swarm` | first choice is a mask that turns Msg types off | swarm testing, the same word ([Groce et al. 2012](https://www.cs.utah.edu/~regehr/papers/swarm12.pdf)) | ok | |
| `ENDS` = "every lane ends" | the liveness law's name | liveness ([Learn TLA+, temporal logic](https://learntla.com/core/temporal-logic.html)) | two-ideas | `ENDS` is also lane.ts:112, a table of child ends. `EVERY_LANE_ENDS`. 75% |
| `sample` | draw walks until one breaks, then shrink | a property run with shrinking ([Effect, Arbitrary](https://effect.website/docs/schema/arbitrary/); [fast-check, runners](https://fast-check.dev/docs/core-blocks/runners/)) | two-ideas | `sample` in fast-check (`fc.sample`) only draws values, it checks nothing; ship-pbt.ts uses `fc.sample` that way. `checkWalks`. 65% |
| `Budget` / `.ms`, `.seed`, `.length`, `.batch` | how long to look, from which seed | fast-check's `Parameters`: `numRuns`, `seed`, `interruptAfterTimeLimit` ([fast-check, runners](https://fast-check.dev/docs/core-blocks/runners/)) | two-ideas | `budget` is a money cap everywhere else (tracker #32). `Parameters` or `Limits`. 70% |
| `Sampled` / `.caught`, `.ms`, `.runs`, `.path`, `.why` | what a property test found | `RunDetails`: `failed`, `counterexample` ([fast-check, runners](https://fast-check.dev/docs/core-blocks/runners/)) | ok | `path` vs `counterexample`, as in the draft's `Verdict.path` |
| `CHOICE` | one choice, 0 to 65535 | none needed | ok | |

## laws/specs.ts, laws/promise-check.ts: the list and the command

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Spec` / `spec` / `SPECS` / `.name`, `.file`, `.check` | one machine's laws, worlds and depths, run in the suite | a TLA+ specification plus its model config ([TLA+ tools, TLC](https://lamport.azurewebsites.net/tla/current-tools.pdf)) | ok | |
| `Checked` (specs.ts) / `.alphabet`, `.unsent`, `.broken`, `.complete`, `.states`, `.ms` | what one spec check found | TLC's action coverage report ([TLA+ tools, TLC](https://lamport.azurewebsites.net/tla/current-tools.pdf)) | two-ideas | exported again in tea-host.ts:1831 with another shape. `SpecResult`. 70% |
| `Checked.alphabet` | every Msg type with a cell | input alphabet ([Wikipedia, finite-state machine](https://en.wikipedia.org/wiki/Finite-state_machine)) | two-ideas | in world/search.ts `Report.alphabet` is a count, not a list. Make search's `alphabetSize`. 70% |
| `Checked.unsent` | alphabet types no search sent | coverage gap; QuickCheck's `cover` ([QuickCheck docs](https://hackage.haskell.org/package/QuickCheck/docs/Test-QuickCheck.html)) | ok | |
| `Walk` (specs.ts) / `.world`, `.depth` | one search setup | see `walk` | two-ideas | see `walk` |
| `promise-check.ts` (file) / CLI `node .../promise-check.ts <machine> "<law>"` | one law on one machine, printed as a `Verdict` | none | two-words | the file runs a law, not a promise; with the `Property` pick: `property-check.ts`. 60% |
| `PROMISE_PLANT` | env var naming the planted copy | already in the draft as `Plant` | ok | follows the draft's `Plant` row |
| `Machine` (promise-check.ts, local) / `.depth`, `.run`, `.show`; `MACHINES` | one checkable machine for the command | none | collides | same shadowing as walk.ts. Local, so cheap: `Runnable`. 60% |

## laws/ship-pbt.ts: ship's laws on tea's pbt

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `AnyShipMsg` | every Msg ship takes | none needed | ok | exported twice: ship.ts:39 and ship-pbt.ts:52 |
| `ShipStep` / `ShipUpdate` / `ShipLike` | a step, a step function, a machine or its planted copy | none needed | ok | |
| `planted` | wrap a mistaken step so tea's runners can step it | a hand-made mutant; fault seeding ([Wikipedia, bebugging](https://en.wikipedia.org/wiki/Bebugging)) | two-words | follows the draft's `Plant` row: "plant" and "mutant" for one idea |
| `PR`, `HEADS` | fixed pull request and heads | none needed | two-ideas | exported in three files (review.ts:41, ship.ts:43, ship-pbt.ts:90) with one meaning. Move to one shared fixture. 80% |
| `PROOFS: met, failed, other_head, old_version` | kinds of verdict rows a read finds | none needed | ok | |
| `facts`, `ready`, `msgs`, `table`, `WEIGHTS`, `LENGTH` | generators | arbitraries ([fast-check, arbitraries](https://fast-check.dev/docs/core-blocks/arbitraries/)); `MsgArbitraryTable` is tea's | ok | `facts` adds one more meaning of facts (draft's worst list, 3) |
| `Reach` / `reach` / `.runs`, `.steps`, `.sent`, `.acted`, `.phases`, `.outcomes` | what generated inputs reach, before trusting a pass | QuickCheck's `label`, `classify`, `cover` ([QuickCheck docs](https://hackage.haskell.org/package/QuickCheck/docs/Test-QuickCheck.html)); `fc.statistics` ([fast-check, runners](https://fast-check.dev/docs/core-blocks/runners/)) | differs | `Coverage`. 60% |
| `Broke` (ship-pbt.ts) | a law said no | see explore.ts `Broke` | two-words | one class, exported once |
| `Law` (ship-pbt.ts) / `.each`, `.along` | a law as a per-step check or a trace check | tea's `propertyInvariant` and `propertyTrace` | two-ideas | a second `Law` type beside explore.ts:58. `.each` and `.along` follow tea's words: `.invariant`, `.trace`. 65% |
| `LawBroken` / `.law`, `.why`, `.steps` | thrown so fast-check reports the law | an assertion error | two-words | fourth word for a break. `ViolationError`. 60% |
| `notReady` | what keeps facts from merging, in words | none needed | ok | exported twice: ship.ts:249 and ship-pbt.ts:367 |
| `TODAY`, `NEW`, `RUN_1`, `RUN_2` | the law lists of experiment 121's runs | none | differs | names an experiment's day, not the laws. `MOVED_LAWS`, `MISSING_LAWS`. 55% |
| `readyRuns` / `ReadyRun` / `landsWhenReady` / `lands` / `LANDS_WHEN_READY` | "a ready pull request lands" | liveness under a fair environment ([Learn TLA+, temporal logic](https://learntla.com/core/temporal-logic.html)) | ok | |
| `GIVES_ITS_OUTCOME` | which outcome a run gives | none | ok | |
| `savedState` / `saved` / `fromSaved` / `fromSavedState` / `SAVED` | a run started from a stored state | a persisted state, rehydrate ([Akka, persistence](https://doc.akka.io/libraries/akka-core/current/typed/persistence.html)) | ok | |
| `Opts` / `.numRuns`, `.seed` | fast-check's run settings | `Parameters` ([fast-check, runners](https://fast-check.dev/docs/core-blocks/runners/)) | ok | `Opts` vs `Options` (world/search.ts): one word. 60% |
| `holds` | one law as a property on a machine | `fc.assert` of a property | ok | |
| `Property` (ship-pbt.ts) / `.name`, `.run` | one law ready to run on a machine | a property ([fast-check, properties](https://fast-check.dev/docs/core-blocks/properties/)) | two-ideas | the owner picked `Property` (2026-10-24) for a plan's lasting check, exported in stages/test-writer/brief.ts:37. Rename this one `LawRun` or `Runnable`. 80% |

## laws/tea-host.ts: the host, call, supervisor and monitor laws

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `GRACE_MS` | grace past a lease's end before the host stops its program | lease duration and renew deadline ([Kubernetes, leases](https://kubernetes.io/docs/concepts/architecture/leases/)) | ok | |
| `LEASE_LAW` | the lease law's name | none needed | ok | |
| `HostView` / `.program`, `.renewing`, `.leaseClock` | how the laws see the host's Subs | none needed | ok | |
| `hostWorld`, `hostLaws`, `showHostMsg`, `checkHost` | the host's world, laws, printer, check | as in explore | ok | |
| `HOST_PLANTED`, `CALLER_PLANTED`, `SUPERVISOR_PLANTED`, `WATCHER_PLANTED` / `.name`, `.law`, `.update`, `.view`, `.strategy` | planted mistakes, each with the law that must catch it | hand-made mutants ([Stryker, mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)) | two-words | follows the draft's `Plant` row |
| `Caller` / `.calls`, `.last`, `.called`; `CallerMsg` (`call`); `callerInit`, `callerStep`, `callerWorld`, `callerLaws`, `showCallerMsg`, `checkCalls` | the call module in the smallest parent | none needed; fabrika's `Call` follows `gen_server:call` ([Erlang, gen_server](https://www.erlang.org/doc/apps/stdlib/gen_server.html)) | ok | `checkCalls` vs `callerWorld`: the module is "call", the harness "caller". Fine |
| `supervisorWorld`, `supervisorLaws`, `checkSupervisor`, `Strategy: one_for_one, one_for_all, rest_for_one`, `intensity`, `period` | the supervisor's laws per restart strategy | OTP's own words ([Erlang, supervisor principles](https://www.erlang.org/doc/system/sup_princ.html)) | ok | |
| `Watcher` / `.monitors`, `.last`; `watcherStep`, `watcherWorld`, `watcherLaws`, `checkMonitors` | the monitor module in the smallest parent | monitor ([Erlang, processes: monitors](https://www.erlang.org/doc/system/ref_man_processes.html)) | two-words | the module is `Monitor`, its harness `Watcher`, its check `checkMonitors`. `Monitoring` or `MonitorParent`. 65% |
| `Checked` (tea-host.ts) / `.machine`, `.states`, `.complete`, `.ms`, `.laws`, `.broken`, `.planted` (`name`, `law`, `caught`, `path`) | one host check's result | see specs.ts | two-ideas | `HostCheckResult`, or one shared `CheckResult` with specs.ts. 70% |
| `caught` (planted) | the law broke on the plant | killed ([Stryker, mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)) | differs | keep, matches promises' `not_caught` (draft). 60% |

## laws/<machine>.ts: per-machine worlds and laws

One file per machine: agent, build, catchup, check-runs, criteria, lane, loop, plan, queue, refine, review, session, ship, sort, task, test-writer, transcript. Each exports the same shape.

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `<m>World`, `<m>Laws`, `<m>Init`, `<m>Step`, `show<M>Msg`, `Any<M>Msg` | a machine's world, laws, first state, step, Msg printer, Msg type | Hypothesis's `initialize`, `rule`, `invariant` ([Hypothesis, stateful](https://hypothesis.readthedocs.io/en/latest/stateful.html)) | ok | |
| `runsWorld`, `runsLaws`, `runsInit`, `runsStep`, `showRunsMsg`, `AnyRunsMsg` (check-runs.ts) | the check-runs machine's | none | two-words | the file and machine are `checkRuns`; the exports say `runs`. `checkRuns*`. 75%; also `run -> process` (picked 2026-10-28) is the shell's run, a third "run" |
| `BUILTS`, `TASK_BUILTS`, `PLANS`, `DRAFTS`, `REPLIES`, `FORMS`, `DEVIATIONS`, `VIEWS`, `ENDS` (lane.ts), `ROWS` (world/hosted.ts), `SETTINGS` (loop.ts) | fixed answers the world may give | test fixtures ([Wikipedia, test fixture](https://en.wikipedia.org/wiki/Test_fixture)) | ok | `ENDS` clashes with walk.ts's law name (see walk.ts) |
| `closes` (build.ts) | the ticket refs a PR body closes | GitHub closing keywords ([GitHub, linking a PR to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)) | ok | |
| `factsAt` / `size: narrow, wide` (ship.ts) | the facts a read may answer, few or all | none | ok | |
| `ReviewWorldOptions` / `.heads`, `.forms`, `.echoes`; `ShipWorldOptions` / `.heads`, `.facts`, `.echoes`; `LoopWorldOptions` / `.heads`, `.reviews`, `.opens`, `.echoes` | knobs on a world | none | ok | `echoes` see explore |
| `Keeping` (ship.ts) / `.kept`, `.seen` | ship state plus what a plant keeps | none | ok | |
| `endsBy` (loop.ts) | a law: the loop ends by round N | a bounded liveness, or a variant ([Wikipedia, loop variant](https://en.wikipedia.org/wiki/Loop_variant)) | ok | |
| `Script` (lane.ts) / `.task`, `.finals`, `.ships` | what a desk run's children hand back | a scripted fake ([Fowler, test double](https://martinfowler.com/bliki/TestDouble.html)) | two-ideas | `Script` is exported also in stages/review/scripted.ts:132, stages/mutation/scripted.ts:74, stages/test-writer/scripted.ts:76, hosted/lane-trace.ts:206, each a different shape. Prefix by owner: `DeskScript`. 65% |
| `deskLaws`, `withTheDesk`, `DeskRun` / `.state`, `.broken`, `.noted`, `.waiting`, `.started` | the lane wired to the owner's desk | none | ok | `desk` is the owner's ask list here and tsh's `Desk` service elsewhere (see Across notes) |
| planted steps, ship.ts: `forgetsMissingReview`, `skipsTheRead`, `takesAnOldVersion`, `keepsAnOldPass`, `landsAnyHead`, `actsAfterTheEnd` | hand-made mutants of ship | hand-made mutants ([Stryker, mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)) | ok | names read as the bug; the "plant" word is the draft's row |
| planted steps, review.ts: `unseenIsMet`, `limitIsAPass`, `takesAnyHead`, `deviationExcuses`, `rewordsFromDeviations`, `judgesTheFirstVersion`, `actsAfterTheEnd` | mutants of review | as above | ok | |
| planted steps, loop.ts: `stuckIsPassed`, `forgetsTheOpenList`, `stallOffByOne`, `forgetsTheLowest`, `asksAtTheFirstStall`, `aCapPutBack`, `takesAnyAnswer`, `takesAnyClaim`, `keepsItsClaim`, `actsAfterTheEnd` | mutants of the operate loop | as above | ok | the machine is `loop` in `stages/operate/`: one idea, two words (operate vs loop); not this file's to fix |
| planted steps, lane.ts: `aCapPutBack`, `forgetsTheLastReviews`, `rawBody`, `opensBehind`, `forgetsTheRound` | mutants of the lane | as above | ok | |
| planted steps, plan.ts / test-writer.ts / sort.ts: `doneWithQuestions`, `takesAnyRun`, `dropsAFailedSpend`; `doneWithSurprise`, `commitsAnotherDraft`; `writesBeforeTheDoor`, `leavesANoOpen` | mutants | as above | two-words | `dropsAFailedSpend` keeps `spend`, picked 2026-10-24 to be `usage`: `dropsAFailedUsage`. 80%. `takesAnyRun`: "run" is picked to mean process in the shell (2026-10-28) |
| planted steps, build.ts / task.ts / catchup.ts / queue.ts / criteria.ts / transcript.ts / session.ts / check-runs.ts / refine.ts: `leftDescopes`, `actsAfterTheEnd`; `rawSummary`, `pushesFromMain`; `pushesUnresolved`, `resolvesTheLockfile`; `queuesTwice`, `dropsTheWorked`, `jumpsTheQueue`, `forgetsTheTidy`; `reusesIds`, `keysVerdictsByPlace`, `rewordKeepsVersion`, `passCarriesOver`, `rewordRevives`; `countsAStrayAnswer`, `overwritesTheLast`; `endsTheLast`; `filesUnderTheAskedHead`, `firstRunWins`; `passesUnchecked`, `retriesPastTheLimit` | mutants | as above | ok | `actsAfterTheEnd` is exported from five files under one name with five types; fine while each is imported as a namespace |
| `drafts`, `Refine`, `RefineCmd`, `AnyRefineMsg` (refine.ts) | a refine loop for its laws | none | ok | |
| `queueWorld` state `Waiting` / `.items`, `.clearing` (queue.ts) | the queue's state | a work queue | ok | `Waiting` is also the asks core's `Waiting` (draft section 9) |

## laws/world/search.ts: the many-machine checker

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `search` | breadth-first search of a world of many machines | model checking ([Wikipedia, model checking](https://en.wikipedia.org/wiki/Model_checking)) | two-ideas | `search` is also the promises `Tool` value for the explore checker, and draft's `laws/world/search` vs `explore`. Keep; gloss. 60% |
| `Move` / `.label`, `.lane`, `.touches`, `.fair`, `.rare`, `.next`, `.note` | one thing that can happen next | an action, or a transition ([Learn TLA+, temporal logic](https://learntla.com/core/temporal-logic.html)) | collides | clashes with the six moves (AGENTS.md). `Action`, TLA+'s word. 80% |
| `Move.fair` | its weak-fairness class | weak fairness ([Learn TLA+, temporal logic](https://learntla.com/core/temporal-logic.html)) | ok | |
| `Move.rare` | happens only finitely often (a restart) | none standard | ok | |
| `Move.touches` | parts it reads or writes | the dependency relation of partial-order reduction ([Wikipedia, partial order reduction](https://en.wikipedia.org/wiki/Partial_order_reduction)) | ok | |
| `System` / `.init`, `.lanes`, `.moves`, `.key`, `.canon`, `.mine`, `.face`, `.ended` | a world to search | a transition system ([Wikipedia, transition system](https://en.wikipedia.org/wiki/Transition_system)) | two-words | see explore's `World`. 65% |
| `System.canon` | the key up to renaming lanes | canonical form under symmetry ([Wikipedia, model checking](https://en.wikipedia.org/wiki/Model_checking)) | ok | |
| `System.face` | what a law across lanes sees of one lane | a view (TLC's `VIEW`, [TLA+ tools, TLC](https://lamport.azurewebsites.net/tla/current-tools.pdf)) | differs | `view`. 65% |
| `System.mine` | is a part touched only by this lane | local vs shared variable (POR) | ok | |
| `Safety` / `.name`, `.check` | a safety law on one step | safety property ([Learn TLA+, temporal logic](https://learntla.com/core/temporal-logic.html)) | two-words | it is a `Law` for a world: one idea, two words. `Law`, or name both `Invariant`. 60% |
| `Options` / `.laws`, `.depth`, `.most`, `.por`, `.symmetry`, `.eventually` | search knobs | partial-order reduction, symmetry, liveness | ok | `eventually` names the operator, not the check: `liveness`. 60% |
| `Broken` / `.law`, `.why`, `.path` | a safety law broken, shortest path | error trace / counterexample | two-words | see explore `Found`: one `Counterexample`. 70% |
| `Lasso` / `.lane`, `.prefix`, `.cycle` | a loop that never ends a lane | lasso-shaped counterexample of a liveness property ([Wikipedia, Büchi automaton](https://en.wikipedia.org/wiki/B%C3%BCchi_automaton)) | ok | |
| `Dead` / `.lane`, `.path` | nothing must happen and a lane is open | deadlock ([Wikipedia, deadlock](https://en.wikipedia.org/wiki/Deadlock_(computer_science))) | differs | `Deadlock`. 75% |
| `Report` (search.ts) / `.reduced`, `.lassos`, `.dead`, `.alphabet` (+ explore's keys) | what one world search found | see explore `Report` | two-ideas | exported twice in laws. `WorldReport`. 70% |

## laws/world/lanes.ts, hosted.ts, laws.ts: the worlds of many lanes

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Steps` / `.loop`, `.build`, `.review`, `.ship`; `REAL` | which reducers run: real or planted | none | ok | |
| `FormName: pass, fail 1, fail both` | the forms the reviewer may hand back | none | ok | values have spaces; fine for labels |
| `Claim: cas, none, read_then_write` | how the ledger answers a claim: real CAS or planted races | compare-and-swap ([Wikipedia, compare-and-swap](https://en.wikipedia.org/wiki/Compare-and-swap)) | two-ideas | `Claim` is held (draft, 2026-10-24) for the plan's claim; this one is a mode. `ClaimMode`. 75% |
| `Door: real, no_main, none` | which re-check ship does before a write | none | two-ideas | `door` is three ideas (see Across notes). `DoorMode`. 70% |
| `LanesOptions` / `.lanes`, `.tickets: own, same`, `.queue`, `.forms`, `.fails`, `.reviews`, `.red`, `.flaky`, `.clocks`, `.errors`, `.restarts`, `.claim`, `.door`, `.desk`, `.outsider`, `.idle`, `.upToDate`, `.eject`, `.steps` | the knobs of the lanes world | flaky test ([Google testing blog, flaky tests](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html)); merge queue ejection ([GitHub, merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)) | ok | `upToDate` is GitHub's "require branches to be up to date" ([GitHub, protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)) |
| `Pr` / `.head`, `.n`, `.base`, `.checks`, `.opened`, `.merged`, `.queued`, `.verdicts` | a ticket's branch and PR as GitHub has it | pull request ([GitHub, pulls](https://docs.github.com/en/rest/pulls/pulls)) | ok | `.n` is a count of pushes: `pushes`. 60% |
| `Tick` / `.pr`, `.record`, `.desk`, `.holder` | one ticket's world state | none | differs | reads as a clock tick (the world has clocks). `TicketState`. 80% |
| `Lane` (lanes.ts) / `.id`, `.ticket`, `.loop`, `.seen`, `.child`, `.flight`, `.restarts` | one lane in the world | none | two-ideas | `Lane` is also the lane machine's state type (stages/lane/machine.ts:238). `WorldLane`. 65% |
| `Lanes` / `.lanes`, `.tickets`, `.main`, `.outsider` | the whole world | none | ok | |
| `Landing` (lanes.ts) / `.lane`, `.ticket`, `.head`, `.tested`, `.onto`, `.verdict` | one merge onto main | none | two-ideas | third `Landing` (draft: ship's whole/part and hosted's none/queued/merged). `Merge`. 65% |
| `Note` / `.landings` | what a law may know about a move | none | two-ideas | `Note` is review's filed note (stages/review/tools.ts:36). `MoveNote`. 65% |
| `ticketOfName`, `planOfName`, `firstDesk`, `deskOf`, `busy`, `digest`, `lanesWorld`, `describeLanes` | helpers | none | ok | `digest` is exported again in hosted (draft section 7): two functions, one name |
| `SubWiring: today, fixed` (hosted.ts) | how the lane's child Sub ends | none | differs | `today`/`fixed` name a moment, not the behavior: `on_row`, `on_row_or_exit`. 65% |
| `ROWS`, `NO_OUTCOME` | rows a child may write; what the Sub gives for none | none | ok | |
| `HostedOptions` / `.sub`, `.rows`, `.errors`, `.always` | knobs | none | ok | `always` is vague: `rowBeforeExit`. 55% |
| `Child` (hosted.ts) / `.name`, `.alive`, `.row`, `.told` | one child as the host sees it | child process | two-ideas | `Child` is also combos.ts:456 and fabrika's supervisor `Child`. Local only. ok to keep, 60% |
| `Hosted` / `.booted`, `.lane`, `.asked`, `.children`, `.settled`, `.pr: none, open, merged` | the hosted lane world | none | ok | |
| `viewOf`, `hostedInit`, `EndOf`, `laneOver`, `notWaitingOnAChild`, `hostedWorld` | helpers | none | ok | |
| `LANE_LAWS` / `oneLaneATicket`, `testedWithMain`, `onlyPassedLands`, `asksReachTheOwner` | laws across lanes | mutual exclusion; "not rocket science" rule ([Graydon Hoare, bors](https://graydon2.dreamwidth.org/1597.html)) | ok | |
| `Desk` (laws.ts) / `.desk`, `.rounds`; `DeskOptions` / `.rounds`, `.counts`, `.fold`; `deskWorld`, `askLeavesByAnAnswer` | the owner's ask list alone | an inbox, a task list (Camunda's user task list, [Camunda, tasklist](https://docs.camunda.io/docs/components/tasklist/introduction-to-tasklist/)) | two-ideas | tsh's `Desk` (tsh/desk.ts:95) is the window layout service. One must change; this one is local: `AskList`. 70% |
| `mergesPastTheQueue`, `waitsForEver`, `ignoresAFailedPost`, `dropsAnAskOnProgress` | planted mistakes across lanes | hand-made mutants | ok | |

## packages/ledger-server

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `@kampus/ledger-server` | one project's ledger on Cloudflare | a Worker with a Durable Object ([Cloudflare, Durable Object namespace](https://developers.cloudflare.com/durable-objects/api/namespace/)) | ok | |
| ledger | the append-only log of events | event store ([EventStoreDB, streams](https://developers.eventstore.com/server/v24.10/features/streams.html)) | ok | **picked 2026-10-28:** a ledger entry is an `Event` |
| `ServerConfig` / `.name`, `.founder`, `.origin`; `decodeConfig` | the Worker's name, who made it, its public origin | Worker name ([Cloudflare, Workers configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)); origin ([MDN, origin](https://developer.mozilla.org/en-US/docs/Glossary/Origin)) | ok | |
| `founder` / `founded` fact | the first member, who invites others | owner of an organization ([GitHub, roles in an organization](https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/roles-in-an-organization)) | differs | `owner` is GitHub's; but "owner" already means the person who answers asks in the pipeline. Keep `founder`, gloss. 60% |
| `WorkerName`, `GitHubId` (`github:<id>`), `Origin` | schema checks | GitHub user id ([GitHub, users API](https://docs.github.com/en/rest/users/users)) | ok | |
| `serverDoor` / `kind: shared` / `keys: {kind: github}`; bindings `DOOR`, `FOUNDER`, `KEYS`, `EXPIRY_GRACE_MS` | the sign-in gate: SSH keys checked against GitHub's list | authentication ([Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/)); GitHub's user keys ([GitHub, keys](https://docs.github.com/en/rest/users/keys)) | two-ideas | `door` is also ship's re-check (stages/ship/door.ts:25) and fabrika's `Door` (host/door.ts:411, the same as this). Ship's should move: `recheck`. 65% |
| `ledgerStack` | the Alchemy stack: one Worker, one DO namespace | stack ([Alchemy](https://alchemy.run/)) | ok | |
| `--stage cloud` (Alchemy deploy flag) | Alchemy's deploy stage | stage, as in dev/prod ([Alchemy](https://alchemy.run/), page not checked for the word) | two-ideas | a pipeline stage (triage, plan, build, review, ship) is another idea. Alchemy's word, can't change; gloss in the README. 80% |
| `LEDGER` binding, class `Ledger` | the DO binding and class | binding ([Cloudflare, bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/)) | ok | |
| `LEDGER_NAME`, `LEDGER_FOUNDER`, `LEDGER_ORIGIN`, `LEDGER_GITHUB_TOKEN` -> secret `GITHUB_TOKEN` | deploy env vars | Worker secret ([Cloudflare, secrets](https://developers.cloudflare.com/workers/configuration/secrets/)) | ok | |
| `LEDGER_ENTRY`, `ledgerBindings`, `ledgerOptions`, `COMPATIBILITY_DATE` (from fabrika) | the Worker file and its config | compatibility date ([Cloudflare, compatibility dates](https://developers.cloudflare.com/workers/configuration/compatibility-dates/)) | ok | |
| twin / `startTwin` / `TwinOptions` / `.config`, `.persist`, `.port`, `.github`, `.cacheMs`; `TwinError` | the same Worker in Miniflare on the laptop | Cloudflare calls Miniflare "a simulator for developing and testing Cloudflare Workers" ([Cloudflare, Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/)) | differs | keep `twin` (the owner's word for "local twin of a cloud piece"), gloss "a local simulator". 60%: `local` or `dev` is the common word |
| CLI `pnpm twin --name --founder --persist --port` | start the twin | `wrangler dev --port --persist-to` ([Cloudflare, wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/)) | ok | |
| `.persist` | data folder or in memory | Miniflare's `persist` options | ok | |

## What the sweep could not settle

From the first draft. Each needed an owner's pick, or a fact the sweep did not have; a
settled one says so. The open list across every package is in [the README](./README.md).

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
  matter of taste. **Settled 2026-10-28,** another way: `fold` stays for reading the
  ledger into state, and a ticket joining an open plan is "added to a plan" in the
  rebuilt pipeline. The old `fold` and `foldsOf` are rebuilt, not renamed.
- **Money words.** `usd`, `budget`, `cost`, `costUsd`, `spend` and `maxBudgetUsd` name a cap
  or what was paid. The `Usage` pick covers what was paid. The cap still needs one word:
  `budget` (what it is) or `usd` (its unit).
- **Tries.** `tries`, `limit`, `MAX_RUNS`, `DEFAULT_TRIES`. Temporal says `maximumAttempts`.
  `attempts` would match it; `tries` is shorter and already the most used. 55%.
- **`Fact` or `Event`.** Datomic says fact, event sourcing says event, and the fabrika
  ledger says event. 65%: `Fact` is spread over many files and the direction notes.
  **Settled 2026-10-28:** `Event`, everywhere. The old pipeline's `*Fact` names are
  rebuilt, not renamed.
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
  `job` is its `scenario`. **Settled 2026-10-28 for the shell:** a tsh line is one job,
  as in bash. The hosted inputs and the host table are still not picked.

What this sweep cannot tell us:

- It renames nothing. No proposal is tested on a reader, so each confidence is one
  person's judgment, not a measure.
- It reads code, not the experiments' write-ups or the direction notes, except where a
  name comes from one. A name used only in prose is not here.
- This file covers `packages/pipeline`, `packages/promises` and `packages/ledger-server`.
  Fabrika's core is in [core.md](./core.md), the app, programs and packs in
  [app.md](./app.md). `wip`, `legacy` and `experiments` are not swept.
- A link was checked for an HTTP 200, and a few anchors that did not resolve were dropped.
  A page that moves later is not caught.
