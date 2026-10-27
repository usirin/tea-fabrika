# A ticket runs from the app

**Proposed 2026-10-27, reworked the same day** to match the decided notes on
triage, the test writer, the mutation step and the PR watcher. Nothing here is
built. It is the plan for the next big step: a person files a ticket in the
app's tracker, and our own pipeline carries it to a merged pull request inside
the app's host, with every step written onto the ticket.

```ts
// A sketch. The whole idea, from one filed ticket to a merge.
//
//   the window   [ file ]                  -> {type: "filed", to: "github:7"} by user:owner   (to: the assignee)
//   github:7's host   `lanes` sees a ticket assigned to its person, claims lane/ticket/3, starts `lane 3`
//   lane 3       triage: accept, to plan   (in its box, on opus)
//                plan: planned v1 · asked "approve plan v1"
//   the window   [ approve ] [ no ]        -> {type: "answered"} by user:owner
//   lane 3       test writer: 3 tests, red and green on the base as the plan says
//                build t-1 · mutation step: 0 lived · reviewed 3 of 3 · pushed
//   the watcher  PR #12 open · PR #12 merged   (read from GitHub, never written by the lane)
//   top line     "done: PR #12 merged"         (a fold of facts; no agent wrote "done")
const lane = (ticket: TicketNumber) =>
	parent({
		read: Tickets.read(ticket),
		children: [triage, plan, testWriter, build, mutation, review, ship],
	});
```

The answer in nine lines:

- **What runs:** one new parent program, `lane`, written by hand. It steps the
  stage machines as its children, in the decided order: triage, plan, the
  owner's yes, test writer, build, mutation step, review, ship.
- **A filed ticket starts it.** There is no start button. Triage is the entry
  point. Its accept starts plan at once; build waits for the owner's yes on the
  plan.
- **A ticket has an assignee, and the assignee's host runs it** (the owner's
  ruling, 2026-10-27). A small `lanes` program on each host takes only the
  tickets assigned to its person, and claims each on the ledger first, so two
  hosts of one person never both run it.
- **The first slice is a walking skeleton with fakes:** every child a fake,
  the local code host, $0. It proves the wiring before any money is spent.
- **Facts:** the lane writes its facts onto the ticket's own stream through a
  new `Tickets` service. The `pr` fact is the PR watcher's, never the lane's,
  so the watcher is a slice of v1.
- **Agents:** every stage calls the `Agents` service, with a system prompt of
  its own.
- **Boxes:** triage, the test writer and everything that runs the code run in
  a box, as decided. One slice builds the box.
- **The core sweep barely meets this work.** Skip it for v1.
- **Fourteen slices,** each one pull request.

## What was read first

- The decided notes this rests on: [Elm first](./elm-first.md),
  [control in code](./control-in-code.md),
  [read fresh, run alone](./read-fresh-run-alone.md),
  [outcome names](./outcome-names.md),
  [one parent, stages as slots](./one-parent-stages-as-slots.md),
  [sweep the core](./sweep-the-core-rebuild-the-pipeline.md),
  [triage's answers](./sort-answers-yes-or-no.md),
  [a project is a parent plan](./a-project-is-a-parent-plan.md),
  [the plan stage](./the-plan-stage.md),
  [the test writer](./the-test-writer.md),
  [promises in the pipeline](./promises-in-the-pipeline.md),
  [every finding is rated](./every-finding-is-rated.md),
  [new combos](./new-combos.md),
  [property tests](./property-tests-not-our-own-search.md),
  [push after review](./push-after-review.md),
  [ship stage rules](./ship-stage-rules.md),
  [the ticket is the lane view](./the-ticket-is-the-lane-view.md),
  [what a ticket shows](./what-a-ticket-shows.md),
  [tickets start in our tracker](./tickets-start-in-our-tracker.md),
  [scheduled jobs on the host](./scheduled-jobs-on-the-host.md),
  [programs run in a box](./programs-run-in-a-box.md),
  [agents run on opus](./agents-run-on-opus-for-now.md),
  [agents behind one service](./agents-behind-one-service.md),
  [the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md).
- Older than experiment 107, so tested here and not taken on trust: the slot
  idea of 2026-10-11, the "ship, review, build, triage" order, and read fresh.
  Read fresh still holds: experiment 107 used it for the pinned merge. The slot
  order does not: v1 needs every slot at once, so the order becomes the order
  in which fakes are swapped for real agents (section 6).
- What exists today, and where it falls short:

| Piece | Where | What it lacks for this step |
|---|---|---|
| The app's host | `apps/fabrika/src/host/` | Runs only the programs tsh lists (`apps/fabrika/src/tsh.ts`: counter and tracker). Starts nothing by itself. |
| The tracker | `programs/tracker/src/` | Shows the nine lane facts, the top line and the ask box. Only tests write lane facts. A comment has no "request changes", and a yes keeps no hash of the text it saw. |
| The stage machines | `packages/pipeline/src/stages/` | `sort` (triage's code, not renamed yet), `plan`, `test-writer`, `task`, `catchup`, `review`, `ship`. They read GitHub issues (`TicketUrl` in `build/ticket.ts`, `PlanHost` in `plan/services.ts`, `SortHost` in `sort/services.ts`), not tracker tickets. |
| The test writer | `stages/test-writer/` (PR 79) | The machine, its laws, a scripted drive and the code side of its mutants job are built. Its handlers (read the base, commit, run the tests) are not, and neither Draft is on `Agents`. |
| The plan's Properties | `stages/plan/` | The plan hands back criteria. The Property shape of [the plan stage](./the-plan-stage.md) is not built, and the test writer needs it. |
| The mutation step | nowhere | No machine. Only experiments 119, 121 and 124 ran StrykerJS. |
| The PR watcher | nowhere | No program writes `pr` facts. |
| The box | experiments 128 and 137 | No `Sandbox` service in the packages. The builder has only its harness holds. |
| Two parents | `stages/operate/`, `stages/lane/` with `hosted/` | `operate` pushes every round before review, against [push after review](./push-after-review.md). `lane` matches the decisions but runs as hosted children on tea-host, a shape the 10-22 note says the rebuild drops. |
| `Agents` | `packages/fabrika/src/agents/agent/` | Built in experiment 156. No stage uses it. Its Claude adapter always sends Claude Code's preset (PR 127); a `Turn` cannot ask for another prompt. |

## 1. What runs

**Elm's answer:** a parent written by hand that holds each child's model, steps
it with the child's own `update`, and hears the child's result as a typed
message (nested TEA, with the OutMsg the five verbs already are). No pipeline
language. As a program, it is a tea-program the host runs, like the tracker.

```ts
// A sketch, in Effect Schema. The lane's state: where it is, and the one child running now.
const Child = Schema.Literals(["triage", "plan", "test_writer", "build", "mutation", "review", "ship"]);
const At = Schema.Union([
	Schema.TaggedStruct("reading", {}),
	Schema.TaggedStruct("running", {child: Child, run: RunId}), // a Sub hears the child's end
	Schema.TaggedStruct("asking", {ask: AskId}), // a Listen on the ticket: a person's `answered` only
	Schema.TaggedStruct("over", {outcome: LaneOutcome}),
]);
const Lane = Schema.Struct({
	ticket: TicketNumber,
	at: At,
	plan: Schema.NullOr(PlanRef), // the version the owner said yes to, and the hash of the text that yes saw
	tests: Schema.NullOr(Sha), // the test writer's local commit on the plan's base
	head: Schema.NullOr(Sha), // the local commit review read; nothing pushed before it passed
});

// A sketch. `next` is pure: it reads the ticket's facts fresh each time and names one step.
const next = (t: Ticket, f: Facts): Go => {
	if (t.closed) return over("skip:closed"); // stop in v1 is a close
	const open = openAsk(f);
	if (open) return wait(open); // only a person's answer moves the lane on
	if (!triaged(f)) return run("triage");
	if (!planned(f) || changesAsked(f)) return run("plan"); // "request changes" after a yes: plan again
	if (!yesCovers(f, t)) return ask(approve(latestPlan(f))); // the yes names the text it saw
	if (!testsWritten(f)) return run("test_writer");
	if (!built(f)) return run("build"); // one task a round, catch-up first, local commits only
	const m = mutated(f); // "not_yet" | "lived" | "killed"
	if (m === "not_yet") return run("mutation");
	if (m === "lived") return run("test_writer"); // its mutants job, then the mutation step again
	if (!reviewed(f)) return run("review"); // review's send:builder makes `built` false again
	return run("ship"); // push after review, open the PR, merge by the repo's own rules
};

// A sketch. The step function around it.
const update = (s: Lane, m: LaneMsg): [Lane, Cmd[]] => {
	switch (m.type) {
		case "read": {
			const go = next(m.ticket, m.facts);
			if (go.kind === "over") return [{...s, at: {_tag: "over", outcome: go.outcome}}, [write(s.ticket, ended(go))]];
			if (go.kind === "ask") return [{...s, at: {_tag: "asking", ask: go.ask.ask}}, [write(s.ticket, go.ask)]];
			return [{...s, at: {_tag: "running", child: go.child, run: m.run}}, [write(s.ticket, started(go.child, m.run))]];
		}
		case "child_ended": // one of the five verbs, from the child; then read again, fresh
			return [{...s, at: {_tag: "reading"}}, [write(s.ticket, endedFact(m)), readTicket(s.ticket)]];
		case "answered": // only a user's `answered` reaches here (the Listen filters by writer)
			return [{...s, at: {_tag: "reading"}}, [readTicket(s.ticket)]];
	}
};
```

- **Every stage is in v1.** Each row says which machine today the lane takes
  in, and whether it goes in as it is.

| Step | Code today | Taken in as it is? | Slices |
|---|---|---|---|
| triage | `stages/sort` | No. Renamed to triage, its answers renamed, fold and `carried` taken out, reads and writes on `Tickets`, on opus, in its box | 3 with a scripted sorter, 8 real |
| plan | `stages/plan` | The machine, yes. `PlanHost` reads from `Tickets`, and the plan must hand back Properties | 3 scripted, 9 real |
| test writer | `stages/test-writer` | The machine, yes: `scripted.ts` drives it in slice 3. Its handlers and both Drafts are new | 3 scripted, 10 real |
| build | `stages/task`, `stages/catchup` | Yes, as the hosted lane steps them, pushing only to the local code host | 3 scripted, 11 real |
| mutation step | none | New machine, code only | a stand-in in 3, built in 5 |
| review | `stages/review` | Yes, on the local code host (`review/local.ts`) | 3 scripted, 11 real |
| ship | `stages/ship` | Yes | 3 scripted, 12 real |
| the parent | `stages/lane` | Its `next` rules, yes. Its hosted children and its fold branch, no | 3 |

- **The branches, child by child.** Each is an outcome in the five verbs, and
  `next` turns it into the lane's next step.
  - **triage** reads the ticket whole, comments included
    ([the ticket is the lane view](./the-ticket-is-the-lane-view.md)), and
    answers one of four ([triage's answers](./sort-answers-yes-or-no.md)):
    - `accept`, to plan: plan starts at once.
    - `accept`, to research: no research stage exists. The lane ends there as
      `send:research`, and the top line says so. A research stage is after v1.
      A lean, 70%.
    - `decline`: code closes the ticket with its one-line reason, written as
      `agent:triage`. The tracker already reads that as "closed by agent
      triage".
    - `duplicate`: it asks, and the owner's yes closes it
      ([what a ticket shows](./what-a-ticket-shows.md), section 5). Triage's
      own note says a duplicate closes the ticket; this plan follows the later
      note, of 2026-10-25.
    - `escalate`: `ask:owner:ruling`, a box with triage's options. After the
      answer, triage runs again and reads the answer in the timeline. A lean,
      65%; the ruling route does not say who picks its branch.
  - **plan** ends `done`, and the parent asks for the yes: a box with
    "approve" and "no". A plan with open questions ends
    `ask:owner:questions`, and they block until the owner answers
    ([a project is a parent plan](./a-project-is-a-parent-plan.md)). A "no"
    carries its note to the next plan run. A user's "request changes"
    comment after a yes stops build and asks for a new plan or a new yes
    ([tickets start in our tracker](./tickets-start-in-our-tracker.md)). An
    agent's comment never does.
  - **test writer** ([the test writer](./the-test-writer.md)): `done` or
    `skip:no_properties` goes on to build. `already_passes`, `fails_on_base`
    and `cannot_test` are boxes with three picks each. A pick that changes the
    plan counts as the owner's yes for the new version, so nobody approves
    twice.
  - **build**: one task a round, a fresh builder each, catch-up first. A
    builder that cannot meet a criterion as written sends it back to plan with
    evidence ([a project is a parent plan](./a-project-is-a-parent-plan.md)).
  - **mutation step**: `done` goes on to review.
    `send:test_writer:mutant_survived` sends each mutant that lived to the test
    writer's mutants job. A diff that adds a disable comment or edits the skip
    list asks the owner (`ask:owner:check_change`).
  - **review**: a pass goes on to ship; a send back goes to build.
  - **ship**: pushes after review passed, opens the pull request, and merges
    by the repo's own rules. Done is read off the watcher's `pr` fact.
  - **any `stuck`**: a box with "try again" and "stop".
- **Do survivors block? What the notes say:**
  - [Promises in the pipeline](./promises-in-the-pipeline.md), decided
    2026-10-24: every mutant that lives blocks the pull request and goes back
    to the writer.
  - [The test writer](./the-test-writer.md), decided 2026-10-24: the writer
    answers each one `test`, `cannot` or `noise`. `cannot` asks the owner about
    a disable comment. `noise` becomes a finding the owner rates: "fix" sends
    it back for a test, "noise" lets it live.
  - [Every finding is rated](./every-finding-is-rated.md), 2026-10-25: a
    `noise` answer stays open until the owner rates it, "shipped or not". Read
    as written, an unrated `noise` does not hold the pull request. Its
    proposed part would reopen the block rule once rating counts exist; until
    then "that decision stands".
  - [New combos](./new-combos.md): a mutant that lives is a failed control.
    [Property tests](./property-tests-not-our-own-search.md): the grader stays
    StrykerJS with the repo's own tests, with no spec arm.
  - This plan builds it as written. It decides nothing new here.
- **Where the code lives:** a new folder, `packages/pipeline/src/lanes/`
  (a working name), one program `lane` and one program `lanes`. No `hosted/`
  part. The stage machines are taken in as libraries, as `operate` takes them
  (`stages/operate/program.ts`). Each child's state is kept under its intent
  in the run's storage, on the host's one ledger, so a restart starts no child
  twice.
- **Which parent is the model:** `stages/lane/` (experiment 105). It already
  does one commit per task on the local code host (`code-host-local.ts`),
  review there, and one pull request only once every criterion passed. The new
  parent keeps its `next` rules and drops its tea-host children.
- **Why:** one program in the same host as the tracker is the smallest thing
  that runs a ticket. It needs no new host feature.
- **Cost:** one parent of perhaps 500 lines with its laws, a `Tickets` read in
  each stage that reads GitHub today, and one new machine, the mutation step.
- **How sure: 70%.** The doubt: whether the old stage machines fit a parent
  that reads tracker tickets without more change than expected. Slice 3 shows
  it with fakes, at no cost.

## 2. How a stage writes facts, and how an ask comes back

**Elm's answer:** a write is a Cmd (the Act move). A wait for a person is a Sub
(the Listen move). The person's click is a Msg in the tracker, whose Cmd writes
`answered`. The lane hears it on its Sub. Nobody calls anybody.

```ts
// A sketch. The service the pipeline reads and writes tickets through. Its Layer is on the Ledger.
class Tickets extends Context.Service<Tickets, {
	readonly read: (n: TicketNumber) => Effect.Effect<{ticket: Ticket; facts: readonly Entry[]}, TicketsFailed>;
	readonly write: (n: TicketNumber, fact: LaneFact) => Effect.Effect<void, TicketsFailed>; // as the host's writer
	readonly answers: (n: TicketNumber, ask: AskId) => Stream.Stream<Answered>; // a user's only
	readonly tail: Stream.Stream<Entry>; // every new fact on every ticket, for `lanes` (section 4)
}>()("Tickets") {}

// The ask, as the lane writes it, and the answer, as the window writes it.
yield* Tickets.write(3, {type: "asked", ask: "a-1", what: "approve plan v1", picks: ["approve", "no"]});
// tracker/ticket/3/inbox  {type: "answered", ask: "a-1", pick: "approve", note: "", text: "sha256:9c1f…"}  user:owner

// A comment that asks for changes, after a yes. Only a user's stops build.
// tracker/ticket/3/inbox  {type: "commented", body: "Skip part 2.", asks: "changes"}  user:owner
```

- **Who writes what.** Each fact goes to `tracker/ticket/<n>/inbox`, the stream
  the tracker already folds and polls once a second. The lane writes as an
  agent writer (`agent:lane`, or the stage's name), on the host that holds the
  ticket's claim. The door stamps it (PR 130).

| Fact | Written by |
|---|---|
| `started`, `ended` | the parent, around each child it starts |
| `planned` | the parent, from plan's `done` |
| `asked` | the parent, from any child's `ask`, and on a `stuck` |
| `pushed` | the parent, after review passed and the push went out |
| `reviewed` | the parent, from review's outcome |
| `pr` | the PR watcher, on a change only. Never the lane, ship or an agent |
| `answered`, `rated` | a person, in the window. Never the lane |

- **The `pr` fact is the watcher's** ([what a ticket shows](./what-a-ticket-shows.md),
  section 5, decided 2026-10-25;
  [scheduled jobs on the host](./scheduled-jobs-on-the-host.md)). Done is a
  merge read from GitHub by code, so v1 needs the watcher: slice 7. Until it
  runs, a merged ticket stays open until the owner closes it.
- **The watcher must know which pull request is the ticket's.** Linking a pull
  request to a ticket is a fact on the ticket's stream, "next, not yet" in
  [tickets start in our tracker](./tickets-start-in-our-tracker.md). Lean: the
  Act that opens the pull request writes that link. It names which pull
  request, never its state. How sure: 70%. The doubt: the tracker may want a
  person to link pull requests by hand too; one writer for both would be
  simpler.
- **Only a person answers an ask** (decided,
  [tickets start in our tracker](./tickets-start-in-our-tracker.md)). The door
  refuses `answered` from an agent (`PERSON_KINDS`), and the fold keeps an
  agent's out of every ticket. Any person on the ledger may answer; nothing
  ties an ask to one person.
- **A yes covers the text it saw** (same note). The window's answer to a plan
  ask carries the hash of the title and body it showed. An edit after the yes
  needs a new yes before build.
- **The schemas move down.** Programs sit above the pipeline in
  `layer-rules.json`, so the pipeline cannot import the tracker. The nine lane
  facts move from `programs/tracker/src/ticket.ts` into the pipeline, and the
  tracker imports them. The tracker keeps its own four.
- **One ask system for the new lane.** The pipeline also has `asks/` and the
  owner's desk. The new lane asks only through the ticket's box, as decided.
  The desk stays with the old pipeline.
- **The ask box itself needs no change.** It takes any list of picks: plan's
  two, the test writer's three, a ruling's options, a `stuck`'s two.
- **Industry practice:** Linear's agents ask the user with an `elicitation`
  activity, "Requests clarification or confirmation from the user", on the
  issue itself ([Linear](https://linear.app/developers/agent-interaction)).
  GitHub's deployment reviewers answer in a box on the run's own page
  ([GitHub](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments)).
- **Why:** the ticket is already the lane's one view. Writing there means the
  window works with almost no new code.
- **Cost:** one service with two Layers (ledger, memory), the move of nine
  schemas, a "request changes" button on the comment form, and the hash on a
  yes. PR 130 has merged, so nothing waits.
- **How sure: 80%.** The doubt is from
  [what a ticket shows](./what-a-ticket-shows.md): whether `planned`, `pushed`
  and `reviewed` stay facts of their own. The first lane written both ways
  settles it.

## 3. How a stage reaches an agent, and its system prompt

**Elm's answer:** an agent run is a Sub, since it keeps talking
([Elm first](./elm-first.md)). `agentRunner` in
`packages/fabrika/src/agents/agent/draft.ts` already turns an `Agents` run into
the Draft Sub every stage uses. The system prompt is data on the turn, not a
new shape.

```ts
// A sketch. The one field the Turn gains. Two cases, so "no prompt at all" cannot be picked by mistake.
const System = Schema.Union([
	Schema.TaggedStruct("maker", {add: Schema.String}), // the maker's coding prompt, then ours
	Schema.TaggedStruct("own", {text: Schema.String}), // ours alone, for a stage with no tools
]);
interface Turn<A> { /* ...provider, session, folder, prompt, answer, model, effort, limits */ readonly system: System }

// Each adapter maps it to its maker's own way:
// Claude:  {type: "preset", preset: "claude_code", append: add}   or the string `text`
// Codex:   `developer_instructions = add`                          or `model_instructions_file`
// fake:    records it, so a test sees which prompt each stage sent
```

- **What each stage sends.** The mutation step runs no agent.

| Stage | `system` | Why |
|---|---|---|
| triage | `own`: a short prompt and the bar | it has no tools; 27,000 characters of tool advice would be noise |
| plan | `maker` + "You plan; you change no file; hand back one PlanDraft" | it reads code with tools |
| test writer | `maker` + "You only add test files the list allows; you never touch product code" | it reads code and writes tests |
| build | `maker` + "One task; never touch the criteria or the tests; 'cannot meet as written' is a fine answer" | it edits code |
| review | `maker` + "You only find; quote each line you cite; you approve nothing" | it reads a diff with tools |

- **Why the preset for the coding stages.** Anthropic's guide: with no
  `systemPrompt`, the SDK "uses a minimal prompt that covers tool calling but
  omits the rest of the `claude_code` preset's content, including its security
  and safety instructions", and "unattended coding automation, like a CI job
  that fixes lint errors or reviews diffs, still fits the preset"
  ([Anthropic](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)).
  Experiment 158 found our adapter sent none. Since PR 127 the `Agents` Claude
  adapter always sends the preset; the stages that still call the Agent SDK
  directly send none.
- **Codex** has `developer_instructions`, "Additional developer instructions
  injected into the session", and `model_instructions_file`, a "replacement for
  built-in instructions"
  ([OpenAI](https://learn.chatgpt.com/docs/config-file/config-reference)).
- **The stage part is short.** The long part of each stage's text stays in its
  prompt, as today. The system part holds only the role and the hand-back rule.
  The repository's own `AGENTS.md` and `CLAUDE.md` load the normal way
  ([agents read rules the normal way](./agents-read-rules-the-normal-way.md)).
- **Models:** triage, plan, the test writer and review on opus; build on opus
  at effort medium until a run says otherwise
  ([agents run on opus](./agents-run-on-opus-for-now.md)). Triage joins
  `AGENT_STEPS` with its rename, so it gets that default.
- **Each stage moves to `Agents` when its slot goes real** (slices 8 to 11):
  `sorter.ts`, `planner.ts`, `builder.ts` and `reviewer.ts` call the Agent SDK
  directly today, and the test writer has no runner yet. The move rewrites each
  one's call as a `turnOf` for `agentRunner`. The builder's three holds (the OS
  sandbox, the guard, the short environment) stay as a second layer, through
  the Claude adapter's options; the box is the fence
  ([programs run in a box](./programs-run-in-a-box.md)).
- **The provider is a setting,** `[agents.<step>] provider` in `fabrika.toml`,
  with Claude the named default.
- **Cost:** one field, three adapters, five stage texts. Then one run per
  stage with and without the preset, as 158 did for its toy job, about $1 each.
- **How sure: 70%.** The doubt is in 158 itself: on its toy job the preset did
  not change how often the model wandered. Our stages' own prompts are long,
  and the effect there is untested. The runs in slices 8 to 11 measure it.

## 4. What starts a lane, and who runs it

**Elm's answer:** a filed ticket is a fact on the ledger, and `lanes` hears it
on a Sub. On the host side it is OTP's: an application starts its supervisor's
children at boot ([tea-host](./tea-host.md)). The `lanes` program is that
child. For each new `filed`, `reopened` or `assigned` whose assignee is its
own person, it tries the ticket's claim, and the host that wins starts
`lane <n>` in the background.

```ts
// A sketch. The assignee is part of the ticket from the start: a ticket with nobody on it cannot exist.
Schema.Struct({type: Schema.Literal("filed"), title: Schema.String, body: Schema.String, to: PersonId});
Schema.Struct({type: Schema.Literal("assigned"), to: PersonId}); // a person's fact only, like `answered`

// A sketch. `lanes`: one per host, started by the host at boot. It hears only its own person's tickets.
const mine = (e: Entry) => assigneeOf(e.ticket) === me.person; // the fold of `filed` and `assigned`
const starts = Stream.filter(
	Tickets.tail,
	(e) => ["filed", "reopened", "assigned"].includes(e.fact.type) && mine(e),
);
const lanes = starts.pipe(
	Stream.runForEach((e) =>
		claim(`lane/ticket/${e.ticket}`, {who: me, can: myProviders}).pipe( // one lane a ticket
			Effect.flatMap((held) => (held ? startJob(`lane ${e.ticket}`) : Effect.void)), // lost: another host has it
		),
	),
);
// At boot it also reads open tickets whose last lane never ended, and claims them the same way.
```

- **A filed ticket starts a lane.** Any ledger member may file one: a person,
  or a scheduled job as an agent writer
  ([scheduled jobs on the host](./scheduled-jobs-on-the-host.md)). Work only
  flows report, triage, plan, build
  ([a project is a parent plan](./a-project-is-a-parent-plan.md)). Nothing past
  triage needs a start of its own: triage's accept starts plan, and the
  owner's yes starts the test writer and build.
- **There is no start button and no `delegated` fact.** The earlier draft of
  this note had both, and left triage out of v1 because "a person who presses
  start already said worth doing". That was wrong: triage is the entry point,
  and it is the step that says whether a ticket is worth doing.
- **A reopen starts a new lane** ([what a ticket shows](./what-a-ticket-shows.md),
  section 5). The old pull request stays in the timeline.
- **One lane a ticket, claimed on the ledger.** The claim and its lease are the
  ones the pipeline has (`asks/claims.ts`): a 30 s lease, renewed every 10 s.
  The fence rule is from
  [the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md): a fenced
  write is good until someone newer claims. A host that goes away loses the
  ticket after about 30 s; another host of the same person may claim it, read
  fresh and go on.
  Each child's state is kept under its intent, so the new holder starts no
  child twice. Experiment 151 landed nothing twice in 1,090 runs. It has not
  been tried with two app hosts on one ticket.
- **Whose host runs it: the assignee's** (the owner's ruling, 2026-10-27).
  Every ticket has one assignee, a person. Their host claims the lane and runs
  it on their own login, as
  [agents behind one service](./agents-behind-one-service.md) says: each
  person runs their own agents and asks another person's agents for work
  through the ledger. Assigning a ticket to the other person is that ask.
  - The known way: Linear has an assignee on every issue and lets you delegate
    one to an agent; GitHub lets you assign tasks to Copilot, which then works
    them ([Linear](https://linear.app/developers/agent-interaction),
    [GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent)).
  - **Who is assigned when a ticket is filed:** the form picks the filer, and
    the filer may pick the other person instead. A ticket a scheduled job files
    goes to the person whose agent the job is (`agent:x for:github:<id>`).
  - **Reassigning:** an `assigned` fact, written by a person. The running lane
    reads fresh before each child, sees it is no longer its person's, and ends
    `skip:reassigned`; the new assignee's host claims the ticket and goes on.
    Each child's state is kept under its intent, so nothing runs twice.
  - Why: each person pays for and sees only their own agents' work, and a row
    always shows whose agent ran it (PR 130's label).
  - Cost: one field on `filed`, one fact kind, one door line (only a person
    writes `assigned`), and a picker in the form. A ticket waits while its
    assignee's machines are all off; the cloud host is the later answer
    ([the cloud is one more host](./the-cloud-is-one-more-host.md)).
- **Stop in v1 is close.** The lane reads fresh before each child; a closed
  ticket ends it as `skip:closed`. A child already running is stopped by the
  `Agents` stop. No note asks for a stop button; one waits for a run that
  needs it.
- **What the person sees, from facts the tracker already shows:**
  - "filed", then "triage running", then "triage: send plan";
  - "plan: done", "plan v1, 2 tasks", and the box "approve plan v1";
  - after a yes: "test writer: done", "build running, task t-1", "mutation: 0
    lived", "review at a1b2c3d: 3 of 3 met", "2 commits";
  - from the watcher: "PR #12 open, checks running", then "PR #12 merged" and
    the top line "done: PR #12 merged";
  - a `stuck` shows as "stuck: <why>" with a box: try again, or stop.
- **The live row** ("review running 3m, 9 turns, last: Read, open log") is the
  tracker's own next pull request (section 3 of
  [what a ticket shows](./what-a-ticket-shows.md)). This plan gives it real
  runs to show. It does not build it.
- **Why a fact, not a call:** the filed ticket is on the shared ledger, so
  the assignee's hosts see it and the claim picks one. The tracker never needs to know
  the pipeline exists. It matches the host rule that a send is a ledger
  append.
- **Cost:** one small program, the claim per ticket, and a host that starts
  one program at boot. That last part is new in `apps/fabrika/src/host/run.ts`.
  The assignee adds one field, one fact kind, one door line and a picker.
- **How sure: 75%** for the shape. The doubt is the claim across two hosts on a
  slow link, which slice 4 tests on the laptop twin and slice 14 for real.

## 5. The order question: sweep first?

**Counted on 2026-10-27, over the core files this plan edits.** The sweep is
"remove what nothing uses, fix the clock, rename to the industry's words", over
the core: program, host, shell, agents, ledger.

| Core file this plan edits | Lines | Clock reads | Dead code | Picked renames |
|---|---|---|---|---|
| `agents/agent/turn.ts` | 249 | 0 | 0 lines; `AgentFailedWhy` exported, used only in its file | 0 |
| `agents/agent/core.ts` | 243 | 0 | 0 lines; `lastFit` the same | 0 |
| `agents/agent/draft.ts` | 85 | 0 | 0 | 0 |
| `agents/agent/fake.ts` | 63 | 0 | 0 lines; `FakeSeen` the same | 0 |
| `agents/claude/adapter.ts` | 200 | 0 | 0 | 0 |
| `agents/codex/adapter.ts` | 274 | 0 | 0 lines; `CodexAdapterConfig` the same | 0 |
| `host/door.ts` | 797 | 0 | 0 | 0 |
| `host/writer.ts` | 55 | 0 | 0 | 0 |
| **8 files** | **1,966** | **0** | **4 `export` words** | **0** |

- **How it was counted.** Clock reads: `Date.now()` and `new Date()`. Dead
  code: every exported name in these files, searched across the repo's code; a
  name used only in its own file counts as an extra `export`, not dead code.
  `@demlik/code-graph --unreachable` was not run, to keep the laptop free; it
  would count more carefully. The counts are from before PR 130 merged, which
  changed `host/door.ts` by 14 lines.
- **Core files the lane runs through but does not edit:** the ledger's
  `host/rules.ts` has 1 clock read (a migration's time, not a lease);
  `host/durable-object.ts`, the shared ledger of PR 130, has 14. The rest of
  the host's clock reads (`host.ts` 6, `supervisor.ts` 4, `journal.ts` 2,
  `monitor.ts`, `observer.ts`, `call.ts`) sit in tea-host's supervisor, which a
  plain program in the app's host does not use.
- **Picked renames that land elsewhere:** triage's answers (`YesPlan` and the
  rest to `Accept`) are 4 lines in one pipeline file, `stages/sort/answer.ts`.
  They land in slice 8, with the rename from sort to triage and fold taken
  out, as [triage's answers](./sort-answers-yes-or-no.md) asks. `kind` in
  tea-program is not picked yet; each new program calls it once.
- **Recommendation: skip the sweep for v1.** Do the 4 `export` words if a slice
  touches the line anyway. New code reads time only through Effect's `Clock`,
  as [build on Effect](./build-on-effect.md) asks, so it adds no clock debt.
  - Why: the sweep and this plan barely meet. Sweeping first would delay the v1
    goal for no gain in the files v1 needs.
  - Cost: the host's clock reads stay, and so do their slow tests (a one-hour
    lease in experiment 116). Not this plan's tests.
  - How sure: 85%. The doubt: a slice may find it needs tea-host's supervisor
    after all, for restarts. Then its clock reads come into scope, and they get
    swept as that slice touches them.
- **The clash with the 10-22 note, in one line:** that note says sweep the core
  first, then rebuild the pipeline on it; this starts the rebuild first,
  because the parts do not overlap, and it takes the old stage machines in as
  they are, which that note's own "what would change it" allows.

## 6. The order of work

Each line is one pull request. The money starts at slice 8.

1. **`Tickets` and the move of the lane facts.** The nine schemas move into the
   pipeline; the tracker imports them. `Tickets` with a ledger Layer and a
   memory Layer. The comment form gets "request changes", and a yes carries
   the hash of the text it saw. Proves: a pipeline program writes `started`
   and the window shows "triage running"; an agent's "request changes"
   stops nothing. $0.
2. **A system prompt on the `Turn`.** The `System` field, three adapters, the
   fake records it. Proves: each provider gets the prompt it was given, and no
   turn can go out with none. $0.
3. **The walking skeleton.** `lane 3` in the app's tsh, the new parent, every
   child a fake: triage on `sort` with a scripted sorter, plan scripted, the
   test writer through its `scripted.ts`, `task` and `catchup` scripted, a
   stand-in mutation step, review scripted, ship on the local code host, a
   fixture repository from `fixtures/`, a local merge, and a stand-in watcher
   that writes `pr` from the local code host. Proves: every branch of
   section 1, the ask box and a click going on, "done" at the end, and a host
   killed during an ask resumes with no child run twice. Laws on `next`. $0.
   This is a walking skeleton, Alistair Cockburn's name (in his book *Crystal
   Clear*, 2004) for a thin build that runs end to end through the main parts;
   the page was not read for this note. If it grows too big, it splits: triage
   to the yes first, then the rest.
4. **A filed ticket starts a lane on its assignee's host.** The `to` field on
   `filed`, the `assigned` fact and its door line, the picker in the form,
   `lanes`, the claim, and the host starting `lanes` at boot. Proves: on the
   laptop twin, a ticket assigned to one person starts exactly one lane over
   that person's two hosts and none on the other person's; a reassign ends it
   `skip:reassigned` and the new assignee's host goes on with no child run
   twice; an agent cannot write `assigned`. $0.
5. **The mutation step.** A new machine, code only: StrykerJS over the lines
   the build changed and the lines each kept Property covers, the repo's own
   tests first, typecheck-refused mutants not counted, the skip list, and
   `send:test_writer:mutant_survived` or `ask:owner:check_change`
   ([promises in the pipeline](./promises-in-the-pipeline.md)). The test
   writer's mutants job gets its Draft, on a fake. Proves: a planted weak test
   lets a mutant live, it goes back to the writer, and a disable comment asks
   the owner. $0, only CPU time.
6. **The box.** A `Sandbox` service with its `none` and `os` layers, from
   experiments 128 and 137. Triage's box holds nothing; the test writer's,
   build's checks and the mutation step's hold a copy of the code
   ([programs run in a box](./programs-run-in-a-box.md)). Proves, with the
   fake provider: a ticket's planted `env | curl` line finds no GitHub key in
   any box. $0.
7. **The PR watcher.** Its own program on a Durable Object alarm, with its
   local twin in Miniflare, reading through `CodeHost` and writing `pr` on a
   change only ([tickets start in our tracker](./tickets-start-in-our-tracker.md)).
   The link fact from the Act that opens a pull request. Proves: on a sandbox
   GitHub repository, a merged pull request makes its ticket "done" with no
   lane writing it. $0.
8. **Triage goes real.** The rename from sort, its answers renamed, fold and
   `carried` taken out, reads and writes on `Tickets`, the `own` prompt, opus,
   in its box. A first triage is about $0.11 on opus (experiment 135); a
   handful of tickets, about $1.
9. **Plan goes real.** `planner.ts` on `Agents` with its system prompt;
   `PlanHost` reads from `Tickets`; the plan hands back Properties
   ([the plan stage](./the-plan-stage.md)). Proves: a real plan and its ask
   from a tracker ticket. About $1 to $3.
10. **The test writer goes real.** Its handlers, both Drafts on `Agents`, in
    its box. Experiment 124 answered mutants for $0.86 over three tickets.
    About $1 to $2.
11. **Build and review go real.** Both on `Agents`, review on the local code
    host. Still a local merge. Proves: a real commit that a different agent
    reviewed, with nothing pushed before it passed. About $2 to $5.
12. **Ship goes real.** Push after review, the pull request, CI, the ship
    machine's merge on a sandbox GitHub repository, and the watcher's `pr`
    facts. Proves: the first merged pull request from a filed ticket. About $1
    on top.
13. **demlik.** One small real ticket, filed in the tracker, merged through
    demlik's own merge rules. Logged in `field/` the same day. Proves: the v1
    goal for one person.
14. **Two people.** On PR 130's shared ledger: one person files a ticket and
    assigns it to the other, who comments; the assignee's host runs the lane
    on the assignee's login. Proves: the v1 goal.

After v1: a research stage for `accept` to research, a lasting ruling's
decision record, the live row (the tracker's own), and the cloud host
([the cloud is one more host](./the-cloud-is-one-more-host.md)).

- **Why this order:** fakes first, so the wiring is proven at $0 and its tests
  stay in CI with no key. The box and the watcher come before any paid run, so
  no real agent ever runs unboxed and done is never an agent's word. Then the
  real pieces go in the order of the lane itself, so each paid run stands on a
  proven one.
- **Cost:** fourteen pull requests, about $6 to $12 of agent runs before
  demlik.
- **How sure: 70%.** The doubts: slice 3's size, if the old stage machines need
  much change to read tracker tickets; slice 6, since sandbox-runtime has run
  only in experiments; slice 9, since the plan's Properties are not built and
  the test writer cannot run without them.

## Open questions for the owner

None. The last one, whose host runs a ticket, was ruled on 2026-10-27: the
assignee's (section 4).

## What it cannot tell us

- Nothing is built or run. Every number above is a count of today's code, not a
  measurement.
- Whether the old stage machines take a tracker ticket without large change.
  Slice 3 shows it.
- How long the mutation step takes on a real ticket, or how often its boxes
  come up. Experiments 119 to 124 ran it on few tickets.
- Whether the preset helps our stages. 158 tested a toy job only.
- How the window reads on a long lane with many rounds. No real lane has
  written its facts yet.
- What a lane costs end to end from the app. The estimates come from
  experiments 85, 105, 107, 124 and 135, run from scripts.
- The dead-code count is a text search, not `code-graph`'s reachability walk,
  and may miss a name used only by a type.
