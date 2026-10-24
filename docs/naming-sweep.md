# Naming sweep

**Proposed** 2026-10-24. A draft. It proposes names; it renames nothing. The
owner picks machine by machine, then one rename pass and a short glossary page
follow, as [Use the industry's names](./direction/use-the-industrys-names.md)
says.

```ts
// The whole idea, on one name.
type Row = {
	name: "Check";                       // the name in our code
	means: "a criterion's {how, what}";  // what it means here
	industry: "verification method";     // what others call it, with a source
	mark: "two-ideas";                   // ok | differs | two-ideas | two-words | collides
	proposal: "Verification, 55%";       // only where the mark is not ok
};
```

## The worst clashes, first

*Filled in as the sections land. Plan's are here now.*

- **`Check`** is a move (code judges an output) and also plan's `{how, what}`
  value on every criterion. `planProblems` is typed `Check<PlanDraft, Known>`
  in the same folder that exports the value `Check`.
- **`readFacts`** is exported twice: plan's Gather of what the code says, and
  the ledger's read of its event log. `Facts` means "code facts" in plan and
  "events" in the ledger.
- **`job`** is a task's first criterion in plan, and a scheduled row in the
  host's `jobs` table (deadlines and lease expiry).
- **`PlanAsk`** is the plan machine's input, while `ask` is an outcome verb,
  `Ask` is a question waiting on a person, and `ask` is a question's text.
  One word, four ideas.
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

## 1. Plan

`packages/pipeline/src/stages/plan/`, and the criteria book's `Version` that
plan's ids use.

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Plan` | a ticket's plan, every task, criterion and question under its id | plan; a decomposed epic ([Atlassian, epics](https://www.atlassian.com/agile/project-management/epics)) | ok | |
| `PlanDraft` / `planDraft` | the schema the planner writes, and the Draft move that writes it: one word, two ideas, told apart by case | none for the pair; a Cmd is a verb in Elm ([Elm guide, commands](https://guide.elm-lang.org/effects/)) | two-ideas | keep `PlanDraft`; `planDraft` → `draftPlan`, a verb like `readTicket`. 70% |
| `Revision` | a plan's next words, written by code that holds the last version; a task or criterion may name the id it `keeps` | an update input ([Prisma, `UpdateInput` types](https://www.prisma.io/docs/orm/prisma-client/type-safety/operating-against-partial-structures-of-model-types)); a revision is a saved version elsewhere ([MediaWiki, revision](https://www.mediawiki.org/wiki/Manual:Revision_table)) | two-words | `PlanUpdate`, so "revision" and "version" stop meaning one thing. 55% |
| `Version` (criteria book) | which wording of a criterion: 1, then one more per reword | version, as an event stream's count ([Marten, appending events](https://martendb.io/events/appending.html)) | ok | keep; the comments say "version" for a plan's words too, so `Revision` is what moves |
| `Story` `{who, want, why}` | a kind of user the ticket touches | user story, "As a ‹role›, I want ‹goal›, so that ‹benefit›" ([Mountain Goat, user stories](https://www.mountaingoatsoftware.com/agile/user-stories)) | ok | |
| `from` (story) | the ticket a story came from | source issue; none standard | ok | |
| `Task` | one piece of a plan, done in order | task or sub-task ([Atlassian, issue types](https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-types/)) | two-ideas | the `stages/task/` machine also says task; settled in section 3 |
| `ends: "pr" \| "answer"` | what a task ends in: code lands, or written findings | a story vs a spike ([Extreme Programming, spike](http://www.extremeprogramming.org/rules/spike.html)) | differs | keep `ends`; `"answer"` → `"spike"`, so a reader finds the prior art. 60% |
| `Criterion` `{when, result, check, serves}` | one observable claim, "When ‹when›, ‹result›" | acceptance criterion in Given/When/Then form ([Cucumber, Gherkin](https://cucumber.io/docs/gherkin/reference/)) | ok | `result` stays: `then` would make it read as a Promise |
| `Job` / `PlanJob` / `job` | a task's first criterion: the user's whole job on a realistic fixture | a scenario ([Cucumber, Scenario](https://cucumber.io/docs/gherkin/reference/#scenario)); the user's job is jobs-to-be-done ([HBR, 2016](https://hbr.org/2016/09/know-your-customers-jobs-to-be-done)) | two-ideas | `scenario`. The host's `jobs` table, and every job queue ([BullMQ, jobs](https://docs.bullmq.io/guide/jobs)), mean a scheduled unit of work. 65% |
| `fixture` | the realistic case a job runs on | test fixture; Gherkin's Given ([Wikipedia, test fixture](https://en.wikipedia.org/wiki/Test_fixture)) | ok | |
| `Check` `{how, what}` | how someone will see a criterion hold | verification method: test, analysis, inspection, demonstration ([NASA SE handbook, 5.3](https://www.nasa.gov/reference/5-3-product-verification/)) | two-ideas | `Verification`, key `verify`. Check stays the move. 55%: "verify" may be taken by the verify writer |
| `HOWS`: `test`, `typecheck`, `run`, `read` | the four ways a check is seen | test, analysis, demonstration, inspection (same source) | differs | keep: our four words are plainer than the handbook's |
| `serves` | the stories a criterion serves | traceability, "satisfies" ([Wikipedia, requirements traceability](https://en.wikipedia.org/wiki/Requirements_traceability)) | differs | keep: plain, and reads as a sentence. 60% |
| `Pointer` / `pointers` `{at, why}` | a file a builder may start from; binds nobody | none found as a standard term (searched Agile, Linear, GitHub issue forms); "pointer" means a memory address in C | differs | `hints`. 50%: no source found for either |
| `Question` `{ask, options, lean, why}` | a product call the ticket leaves open, written with a lean | considered options and a recommendation ([MADR](https://adr.github.io/madr/)) | two-ideas | key `ask` → `text`: `ask` is also an outcome verb and the ledger's waiting question. `lean` stays. 55% |
| `PlanAsk` `{ticket, tries}` | the plan machine's input | workflow input ([Temporal, workflow parameters](https://docs.temporal.io/workflows#parameters)); Elm's flags ([Elm guide, flags](https://guide.elm-lang.org/interop/flags.html)) | two-ideas | `PlanInput`. 70% |
| `summary` | the plan in one paragraph | summary; Jira calls the issue title "Summary" | ok | |
| `Goal` / `goal` `{job, criteria}` | what holds only when every task is in; absent on a one-task plan | epic-level acceptance criteria ([SAFe, epic](https://scaledagileframework.com/epic/)); "goal" is the story template's "I want ‹goal›" | differs | `whole`, or keep `goal`. 45%: no clean industry word for the plan's own criteria |
| `keeps` | the id a next version keeps | supersedes / replaces; none standard | ok | |
| `withIds` / `numbered` / `Numbered` | give every task, criterion and question its id | assign identity ([Fowler, Evans classification](https://martinfowler.com/bliki/EvansClassification.html)) | two-words | `withIds` only; `Numbered` → `WithIds`. 75% |
| `revisionOf` / `revisionOfDraft` / `keptFrom` | turn a plan or a draft into a next version | follows `Revision` | differs | follows the `Revision` pick |
| `Facts` / `PlanFacts` / `readFacts` | what the code says about the names and paths a ticket mentions | retrieved context ([Anthropic, contextual retrieval](https://www.anthropic.com/engineering/contextual-retrieval)); the ledger's facts are Datomic's word for events ([Datomic, data model](https://docs.datomic.com/whatis/data-model.html)) | two-ideas | `CodeFacts`, `readCodeFacts`; the ledger keeps `Fact`. Not `Context`: Effect has one. 60% |
| `Spent` (plan) / `Spend` (fabrika) | what the planner's runs cost: dollars, tokens, turns, minutes | usage ([Anthropic API, usage](https://docs.anthropic.com/en/api/messages)) | two-words | `Usage`, one type, in fabrika. 70% |
| `context` (in `Spent`) | the conversation's size at its last turn | context window ([Anthropic, context windows](https://docs.anthropic.com/en/docs/build-with-claude/context-windows)) | collides | `window`: a key, so no real shadowing, but `Context` is Effect's service map. 50% |
| `tries` | the most drafts the Check may send back for | attempts ([Temporal, retry policy](https://docs.temporal.io/encyclopedia/retry-policies)) | ok | plain word for the same idea |
| `problems` | what the Check found, in sentences | problems ([VS Code, Problems panel](https://code.visualstudio.com/docs/editor/editingevolved#_errors-warnings)); diagnostics in LSP | ok | |
| `PlanReport` | what a run leaves besides its outcome | result ([Temporal, workflow result](https://docs.temporal.io/workflows)) | ok | |
| `PlanTicket` `{url, number, state, title, body, at}` | a ticket as the planner reads it; `at` is the commit to read code at | issue ([GitHub REST, issues](https://docs.github.com/en/rest/issues/issues)); a commit to read at is a ref | ok | `at` → `ref` would match git. 50% |
| `PlanHost` | reads the ticket (GitHub, or the replay set) | issue tracker; fabrika's `host` runs programs ([Erlang, applications](https://www.erlang.org/doc/system/applications.html)) | two-ideas | `PlanTickets` or `TicketSource`. 65% |
| `Planner` / `livePlanner` | the one agent inside plan | planner, in plan-and-execute agents ([LangChain, planning agents](https://blog.langchain.dev/planning-agents/)) | ok | |
| `Brief` | what the planner is handed | prompt context; brief is plain | ok | |
| `key` (machine) | the conversation's name, new each start | session id ([Claude Agent SDK, sessions](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-sessions)) | two-ideas | `session`. `Line.key` is a line's id in the same folder. 70% |
| `PlanState` phases `idle`, `reading`, `gathering`, `drafting`, `over` | where the machine is | state; Elm's Model ([Elm guide](https://guide.elm-lang.org/architecture/)) | ok | the State-or-Model question is shared, section 9 |
| `restarts` / `MAX_RESTARTS` | times a restart started the planner over | restart intensity ([Erlang, supervisor](https://www.erlang.org/doc/system/sup_princ.html#maximum-restart-intensity)) | ok | |
| `stuck:unchecked` | the last plan still has problems and the tries are spent | none found; it was checked, and failed | differs | `stuck:unfixed`. "Unchecked" reads as "never checked". 70% |
| `ask:owner:questions`, `skip:closed`, `stuck:read_failed`, `draft_failed`, `over_budget`, `cut_off` | plan's other outcomes | the five verbs ([outcome names](./direction/outcome-names.md)) | ok | |
| `Planned`, `planProgram`, `planToTheEnd` | the program's answer, the program, and a run to its end | workflow result | ok | `planKind` is the `kind` question, section 9 |
| `Line` / `linesOf` / `Changed` `{added, removed, reworded, same}` / `Reworded` `{was, now}` | a plan as lines an owner can point at, and what changed between two | a diff: added, deleted, modified ([git diff, `--diff-filter`](https://git-scm.com/docs/git-diff)) | ok | `reworded` is git's word for an edited message ([git rebase](https://git-scm.com/docs/git-rebase)) |
| `userNames` / `Published` | every name a package shows its users | public API surface ([API Extractor](https://api-extractor.com/pages/overview/intro/)) | differs | `publicNames`. 60% |
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
| `Promise` (sketch type) | a criterion that lasts after the ticket closes: what the code always does | a property, safety or liveness ([learn TLA+, temporal properties](https://learntla.com/core/temporal-logic.html)); an invariant ([learn TLA+, invariants](https://learntla.com/core/invariants.html)); JS's own `Promise` ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise)) | collides | `Guarantee`. `Invariant` misnames a liveness promise ("never waits forever"); `Property` clashes with the `property` tool. 55% |
| promise vs law | a promise is a lasting rule on the code; a law is a rule a machine must always keep ([every machine has laws](./direction/every-machine-has-laws.md)), and the record's `check` runs a law | both are properties of the system | two-words | decide whether a promise is "a law the owner approved". If yes, one word. 50%: the two may differ in scope (a promise can span machines) |
| `says` (sketch) / `promise` (record key) | the promise in one plain sentence | statement | two-words | `says` in both. 70% |
| `harm` | what goes wrong for someone if it breaks | failure effect ([FMEA](https://en.wikipedia.org/wiki/Failure_mode_and_effects_analysis)) | ok | plain word for the effect column |
| `is: "new" \| "kept"` | the ticket adds it, or today's code must already keep it | a new test written red first ([Fowler, TDD](https://martinfowler.com/bliki/TestDrivenDevelopment.html)) vs a regression test ([Wikipedia](https://en.wikipedia.org/wiki/Regression_testing)) or characterization test ([Wikipedia](https://en.wikipedia.org/wiki/Characterization_test)) | two-ideas | `"new" \| "regression"`. `kept` already means "persisted" in fabrika (`program/kept.ts`) and "keeps an id" in plan. 65% |
| `tool: "search" \| "tla" \| "property" \| "proof"` | which kind of check keeps it | model checking ([Wikipedia](https://en.wikipedia.org/wiki/Model_checking)), property-based testing ([fast-check](https://fast-check.dev/docs/core-blocks/properties/)), proof | ok | the sketch drops `search` (2026-10-23); the record still has it |
| `covers` / `Covers` / `Piece` | the code a promise is about, by file and top-level name | coverage; Stryker's `coveredBy` ([Stryker, mutant states](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)) | ok | |
| `exam` | the check itself: law, plant, world and checker; a change to it asks the owner | test oracle ([Wikipedia](https://en.wikipedia.org/wiki/Test_oracle)) | differs | keep: "nobody writes their own exam" is a rule people already quote. 60% |
| `Plant` / planted break / `PROMISE_PLANT` | a hand-written break that shows a check can fail | fault seeding, also bebugging ([Wikipedia](https://en.wikipedia.org/wiki/Bebugging)); a mutant when a tool makes it | two-words | `seeded fault` for the hand-made one, `mutant` for the tool's, and say which in each place. 60% |
| `prints` / `printOf` | a hash of each piece's code at the last confirm | fingerprint ([Wikipedia](https://en.wikipedia.org/wiki/Fingerprint_(computing))) | ok | short for fingerprint |
| `confirmed` / `confirm` | someone said the check still describes the code, at a commit | snapshot update ([Jest, snapshot testing](https://jestjs.io/docs/snapshot-testing)) | ok | |
| `in step` / `checks_in_step` | every record's prints match the code | drift, as in "no drift"; none standard | ok | |
| `Entry` (promises) | one promise record | record; also `Entry` in the criteria book and in the ledger | two-ideas | `PromiseRecord` (or `GuaranteeRecord`). 65% |
| `Verdict` `{held, checked, plant, bound, path, why}` | what a check command prints last | result; `path` is a counterexample ([fast-check, properties](https://fast-check.dev/docs/core-blocks/properties/)) or error trace | two-ideas | `CheckResult`; `path` → `counterexample`. The criteria book and review also export a `Verdict`. 60% |
| `Facts` (promises `judge.ts`) | what the gate read about one record | input | two-ideas | `Read` or `Gathered`; a third meaning of facts. 55% |
| `judge` / `Judged` | the pure gate over one record's facts | gate; Judge is also a move (a small classifier) | two-ideas | `gate`, `Gated`. 70% |
| `Problem.why`: `gone`, `stale`, `red`, `not_caught`, `no_verdict` | why a record fails the gate | Stryker's states: Killed, Survived, NoCoverage ([Stryker](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)) | ok | `not_caught` is Stryker's Survived for a plant; keep plain |
| verify writer | the agent, not the builder, that writes each check before the build | test generator in Meta's ACH ([Meta, 2025](https://arxiv.org/abs/2501.12862)); evaluator in an evaluator-optimizer loop ([Anthropic, building effective agents](https://www.anthropic.com/engineering/building-effective-agents)) | differs | `tester`, outcome `send:tester:mutant_survived`. 55%: "tester" may read as a person |
| `writeChecks` / `checks_write`, `checks_today`, `checks_hold`, `checks_kill_mutants` | the steps that write and run the promise checks | tests or specs; "check" is also the move and a GitHub check run | two-ideas | `tests_write`, `tests_today`, ... when the tool is a test; one word is open while TLA+ stays a tool. 50% |
| red first | a new promise's check fails on today's code | red, green, refactor ([Fowler, TDD](https://martinfowler.com/bliki/TestDrivenDevelopment.html)) | ok | |
| `mutant`, kill, survived, equivalent mutant | mutation testing's words | the same ([Stryker, introduction](https://stryker-mutator.io/docs/stryker-js/introduction/)) | ok | |
| skip list | kinds of mutant left out, such as log text | Stryker ignorers ([Stryker, configuration](https://stryker-mutator.io/docs/stryker-js/configuration/)); Google's arid nodes | differs | `ignore list`, Stryker's own word. 75% |
| disable comment | `// Stryker disable` on one line, with a reason | the same ([Stryker, disable mutants](https://stryker-mutator.io/docs/stryker-js/disable-mutants/)) | ok | |
| `ask:owner:already_kept`, `ask:owner:not_kept`, `ask:owner:check_change` | the plan was wrong about today's code, or a diff touches a check | none found | differs | follow the `new`/`kept` pick: `already_holds`, `regression`. 50% |
| `send:builder:promise_red` | ship found a promise red or out of step | failed required check | differs | follows the `Promise` pick |

## 3. Build

`packages/pipeline/src/stages/build/` (one ticket, one pull request) and
`stages/task/` (one task of a plan, a commit on the plan's branch).

| Name | Means here | Industry name | Mark | Proposal |
|---|---|---|---|---|
| `Built` (`form.ts`) / `Built` (`program.ts`) | the builder's form at the end of its run; and the program's answer for one build | none for the pair: two exports, one name, two shapes | two-ideas | the form → `BuildForm`; the program's answer → `BuildResult`. 80% |
| `PlanState` (`build/ticket.ts`) | how a ticket's plan stands on the ledger: `approved`, `not_approved`, `none`, `unknown` | approval status ([GitHub, review states](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews)) | two-ideas | `PlanApproval`. `PlanState` is also the plan machine's state type. 80% |
| `readTicket` | a Gather in plan and in build, and a plain read in `build/ticket.ts` | none needed | two-ideas | `planTicket`, `buildTicket` as Cmds; the read helper stays `readTicket`. 60% |
| `BuildAsk` / `TaskAsk` | the machine's input: ticket, round, what is still open | workflow input | two-ideas | `BuildInput`, `TaskInput`, with plan's pick. 70% |
| `Build` / `Task` (state types) | the build and task machines' state | Elm's Model; plan calls its own `PlanState` | two-ideas | `BuildState`, `TaskState`. `Task` is also plan's task schema. 85% |
| `Task` (the machine) | builds one task of an approved plan onto the plan's branch | a sub-task ([GitHub, sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)) | ok | keep: the same idea as plan's `Task`, once the state type moves |
| `round` | which review-and-build pass this is, 1 first | iteration; review round | ok | |
| `Item` / `open` | one thing a review left open, told to the next round | an unresolved review thread ([GitHub, resolving conversations](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/commenting-on-a-pull-request#resolving-conversations)); a finding | differs | `Finding`; key `open` stays. 65% |
| `says`, `where`, `wants` (in `Item`) | why it is open, where it shows, what would close it | comment body, location, suggested change | ok | `says` matches the promise's `says` |
| `BuildBrief` / `briefOf` | what one builder run is handed | prompt context | ok | |
| `session` (brief) | the builder's conversation id | session id ([Claude Agent SDK, sessions](https://docs.anthropic.com/en/docs/claude-code/sdk/sdk-sessions)) | ok | plan's `key` should follow this one |
| `tree` / `copyTree` / `Copied` | the working copy on the ticket's branch | working tree ([git glossary](https://git-scm.com/docs/gitglossary#def_working_tree)); a git worktree | ok | `copyTree` → `makeTree`, since it may find an old one. 50% |
| `summary`, `deviations`, `ran`, `left` (form) | what the change does, where it departs from the ticket, what it ran, what it could not do | PR description; deviations; known limitations | ok | `summary` is also plan's summary, the same idea |
| `answer` (in `BuildGate`, `BuildDrafted`) | the tag that says which case a union is | a discriminant: `_tag` in Effect ([Effect, Data.TaggedEnum](https://effect.website/docs/data-types/data/)); `kind` in outcomes | two-words | `kind`, as outcomes use. 60%: Effect's `_tag` is the other choice |
| `BuildGate` / `buildGate` / `taskGate` / `TaskGate` | a pure Check before work: go, or the one reason not to | a guard ([XState, guards](https://stately.ai/docs/guards)) | differs | keep `gate`: plain, and ship's "gate" is the same idea. But `guard` already means the process lock below. 60% |
| `guard` / `guarded` / `HOLD` / `HELD` / `lockOf` | a lock and a timeout around the builder's commands | a file lock or mutex ([Wikipedia, file locking](https://en.wikipedia.org/wiki/File_locking)) | two-ideas | `lock`, `locked`. "Guard" is the state-machine word for a gate. 70% |
| `harness` / `HARNESSES: sdk, acp` / `builderHarness` | what runs the agent | agent harness | ok | |
| `Verdict` / `verdictOf` (`builder-acp.ts`) | how one permission ask was answered: allow or refuse | permission decision ([ACP, request permission](https://agentclientprotocol.com/protocol/tool-calls#requesting-permission)) | two-ideas | `Permission` / `permissionOf`. A fourth `Verdict` in the repo. 75% |
| `answer` (`builder-acp.ts`) | reply to one permission ask | respond | two-ideas | `respond`. 55% |
| `HAND_IN` / `report_build` / `Report` | how the builder hands its form in, as a tool call | structured output via a tool ([Anthropic, tool use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview)) | ok | |
| `checksOf` / `hookSettings` / `Checked` / `builderCheck` / `builderRefusal` | commands the builder ran, logged by a hook; a refusal of a tool call | hooks ([Claude Code, hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)) | two-ideas | `ranOf`, `Ran`: these are runs, not the Check move. 55% |
| `MAX_RUNS` (build, task) vs `tries` (plan) | the most builder runs in a round | attempts ([Temporal, retry policy](https://docs.temporal.io/encyclopedia/retry-policies)) | two-words | one word: `tries`, or `attempts` everywhere. 65% |
| `Failed: broke, misfit, over_budget` | how a builder run failed | crash, invalid output, budget | ok | |
| `Commit` / `PrBody` / `messageText` / `bodyText` | the commit message and the pull request text | the same (git, GitHub) | ok | |
| `inert` / `BREAK` | a zero-width space that stops an `@` mention from notifying | escaping | ok | |
| `branchOf` (`build/<n>`) / `planBranchOf` (`plan/<n>`) | the branch name for a ticket or a plan | branch | ok | |
| `TaskView` / `taskViewOf` / `Heads` | what the ledger says about one task, with branch heads | read model ([Microsoft, CQRS](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)) | ok | |
| `withPlan` / `planStateOf` / `planStateIn` | read how a ticket's plan stands | follows `PlanApproval` | differs | `planApprovalOf`. 75% |
| build: `skip:not_ready`; task: `skip:not_approved` | no approved plan yet | the same idea, two words | two-words | one word in both, `not_approved`. 75% |
| build `stuck` names: `read_failed`, `no_criteria`, `criteria_unknown`, `copy_failed`, `draft_failed`, `over_budget`, `no_change`, `push_failed`, `open_failed` | how a build stops | the five verbs | ok | |
| `buildKind`, `buildProgram`, `buildToTheEnd` | the program and kind | see section 9 | ok | |
