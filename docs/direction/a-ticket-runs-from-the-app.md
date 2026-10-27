# A ticket runs from the app

**Proposed 2026-10-27.** Nothing here is built. It is the plan for the next big
step: a person files a ticket in the app's tracker, presses start, and our own
pipeline carries it to a merged pull request inside the app's host, with every
step written onto the ticket.

```ts
// A sketch. The whole idea, from one press to a merge.
//
//   the window   [ start ]                     -> {type: "delegated"} by user:owner   (a person's fact)
//   the host     `lanes` sees it, starts `lane 3` on this person's host, on this person's login
//   lane 3       reads ticket 3 fresh, steps its children, writes each step as a fact:
//                started plan · ended plan · planned v1 · asked "approve plan v1"
//   the window   [ approve ] [ no ]            -> {type: "answered"} by user:owner
//   lane 3       started build t-1 · pushed · reviewed 3 of 3 · pr open · pr merged
//   top line     "done: PR #12 merged"         (a fold of facts; no agent wrote "done")
const lane = (ticket: TicketNumber) => parent({read: Tickets.read(ticket), children: [plan, build, review, ship]});
```

The answer in seven lines:

- **What runs:** one new parent program, `lane`, written by hand. It steps the
  existing stage machines as its children. Plan, build, review and ship are in
  v1. Sort and the test writer wait.
- **The first slice is a walking skeleton with fakes:** `lane 3` typed in the
  app's tsh, every agent the fake provider, the local code host, $0. It proves
  the wiring before any money is spent.
- **Facts:** the lane writes the nine lane facts onto the ticket's own stream
  through a new `Tickets` service. An ask is an `asked` fact; the answer is the
  person's `answered` fact, read by a Listen.
- **Agents:** every stage calls the `Agents` service. Each sends a system
  prompt of its own: Claude Code's preset plus a short stage part for the
  three coding stages.
- **Start** is a person's fact, `delegated`. A small `lanes` program on each
  person's host starts lanes for that person's starts only.
- **The core sweep barely meets this work:** 0 of the host's clock reads, 0
  dead lines, 0 picked renames land in the core files it edits. Skip it for v1.
- **Nine slices,** each one pull request.

## What was read first

- The decided notes this rests on: [Elm first](./elm-first.md),
  [control in code](./control-in-code.md),
  [read fresh, run alone](./read-fresh-run-alone.md),
  [outcome names](./outcome-names.md),
  [one parent, stages as slots](./one-parent-stages-as-slots.md),
  [sweep the core](./sweep-the-core-rebuild-the-pipeline.md),
  [a project is a parent plan](./a-project-is-a-parent-plan.md),
  [the plan stage](./the-plan-stage.md),
  [ship stage rules](./ship-stage-rules.md),
  [the ticket is the lane view](./the-ticket-is-the-lane-view.md),
  [what a ticket shows](./what-a-ticket-shows.md),
  [tickets start in our tracker](./tickets-start-in-our-tracker.md),
  [agents behind one service](./agents-behind-one-service.md),
  [push after review](./push-after-review.md).
- Older than experiment 107, so tested here and not taken on trust: the slot
  idea of 2026-10-11, the "ship, review, build, triage" order, and read fresh.
  Read fresh still holds: experiment 107 used it for the pinned merge. The slot
  order does not: v1 needs every slot at once, so the order becomes the order
  in which fakes are swapped for real agents (section 6).
- What exists today, and where it falls short:

| Piece | Where | What it lacks for this step |
|---|---|---|
| The app's host | `apps/fabrika/src/host/` | Runs only the programs tsh lists (`apps/fabrika/src/tsh.ts`: counter and tracker). Starts nothing by itself. |
| The tracker | `programs/tracker/src/` | Shows the nine lane facts, the top line and the ask box. Only tests write lane facts. No start button. |
| The stage machines | `packages/pipeline/src/stages/` | Plan, build, review, ship, sort and the test writer exist. They read GitHub issues (`TicketUrl` in `build/ticket.ts`, `PlanHost` in `plan/services.ts`, sort's `services.ts`), not tracker tickets. |
| Two parents | `stages/operate/`, `stages/lane/` with `hosted/` | `operate` pushes every round before review, against [push after review](./push-after-review.md). `lane` matches the decisions but runs as hosted children on tea-host, a shape the 10-22 note says the rebuild drops. |
| `Agents` | `packages/fabrika/src/agents/agent/` | Built in experiment 156. No stage uses it. Its `Turn` has no system prompt field. |

## 1. What runs

**Elm's answer:** a parent written by hand that holds each child's model, steps
it with the child's own `update`, and hears the child's result as a typed
message (nested TEA, with the OutMsg the five verbs already are). No pipeline
language. As a program, it is a tea-program the host runs, like the tracker.

```ts
// A sketch, in Effect Schema. The lane's state: where it is, and the one child running now.
const At = Schema.Union([
	Schema.TaggedStruct("reading", {}),
	Schema.TaggedStruct("running", {child: Child, run: RunId}), // a Sub hears the child's end
	Schema.TaggedStruct("asking", {ask: AskId, for: Schema.Literals(["plan", "stuck"])}), // a Listen on the ticket
	Schema.TaggedStruct("over", {outcome: LaneOutcome}),
]);
const Lane = Schema.Struct({
	ticket: TicketNumber,
	at: At,
	plan: Schema.NullOr(PlanRef), // the approved version, read again before build
	head: Schema.NullOr(Sha), // the local commit review read; nothing pushed before it passed
});

// A sketch. The step function. `next` is pure and reads the ticket's facts fresh each time.
const update = (s: Lane, m: LaneMsg): [Lane, Cmd[]] => {
	switch (m.type) {
		case "read": {
			const go = next(m.ticket, m.facts); // closed, planned, approved, built, reviewed, pr
			if (go.kind === "over") return [{...s, at: {_tag: "over", outcome: go.outcome}}, [write(s.ticket, ended(go))]];
			if (go.kind === "ask") return [{...s, at: {_tag: "asking", ask: go.ask.ask, for: go.for}}, [write(s.ticket, go.ask)]];
			return [{...s, at: {_tag: "running", child: go.child, run: m.run}}, [write(s.ticket, started(go.child, m.run))]];
		}
		case "child_ended": // one of the five verbs, from the child; then read again, fresh
			return [{...s, at: {_tag: "reading"}}, [write(s.ticket, endedFact(m)), readTicket(s.ticket)]];
		case "answered": // only a user's `answered` reaches here (the Listen filters by writer)
			return [{...s, at: {_tag: "reading"}}, [readTicket(s.ticket)]];
	}
};
```

- **Which stages are in v1.**
  - **plan: yes.** Decided for every ticket, and the owner's yes on the plan is
    the build gate (experiment 107). A small ticket gets a one-task plan.
  - **build, review: yes.** The job itself. Review is a different agent from
    build ([nobody grades their own work](./nobody-grades-their-own-work.md)).
  - **ship: yes.** Code only, no agent. The best tested machine here.
  - **sort (triage): not in v1's first slices.** A person who presses start
    has already said "worth doing" as a ledger member. Sort's other answers
    (duplicate, escalate) still matter, so it stays a slot, filled after the
    loop runs. How sure: 65%. The doubt: whether the owner wants an agent's
    "duplicate?" check on every start. One week of starts would show how often
    a started ticket was a duplicate.
  - **test writer: not in v1.** It is decided, but has no program, and it
    needs the plan's Properties end to end first. It joins as the slot between
    the yes and build.
- **Where the code lives:** a new folder, `packages/pipeline/src/lanes/`
  (a working name), one program `lane` and one program `lanes`. No `hosted/`
  part. The stage machines are taken in as they are, as `operate` takes them
  (`stages/operate/program.ts` runs them "as libraries"). Each child's state is
  kept under its intent in the run's storage, as `operate` does, so a restart
  starts no child twice.
- **Which parent is the model:** `stages/lane/` (experiment 105). It already
  does one local commit per task, review on the local code host
  (`code-host-local.ts`), and one pull request only once every criterion
  passed. The new parent keeps its `next` rules and drops its tea-host children.
- **Why:** one program in the same host as the tracker is the smallest thing
  that runs a ticket. It needs no new host feature.
- **Cost:** one parent of perhaps 400 lines with its laws, plus a `Tickets`
  read in each stage that today reads GitHub.
- **How sure: 75%.** The doubt: whether the old stage machines fit a parent
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
// tracker/ticket/3/inbox  {type: "answered", ask: "a-1", pick: "approve", note: ""}   user:owner
```

- **Who writes what.** Each fact goes to `tracker/ticket/<n>/inbox`, the stream
  the tracker already folds and polls once a second. The lane writes as an
  agent writer (`agent:lane`, or the stage's name), on the host of the person
  who pressed start. The door stamps it (PR 130).

| Fact | Written in the lane by |
|---|---|
| `started`, `ended` | the parent, around each child it starts |
| `planned` | the parent, from plan's `done` |
| `asked` | the parent: once per plan version, and on a `stuck` |
| `pushed` | the parent, after review passed and the push went out |
| `reviewed` | the parent, from review's outcome |
| `pr` | the parent, from ship's own reads of the code host, on a change only |
| `answered`, `rated` | never the lane: a person, in the window |

- **The `pr` fact from ship's reads** is a change from the note, which names a
  PR watcher as its writer. The rule behind it holds: the state is GitHub's
  word, read by code, never an agent's. A watcher for pull requests outside any
  lane comes later.
- **The schemas move down.** Programs sit above the pipeline in
  `layer-rules.json`, so the pipeline cannot import the tracker. The nine lane
  facts move from `programs/tracker/src/ticket.ts` into the pipeline, and the
  tracker imports them. The tracker keeps its own four.
- **One ask system for the new lane.** The pipeline also has `asks/` and the
  owner's desk. The new lane asks only through the ticket's box, as decided.
  The desk stays with the old pipeline.
- **The ask box needs no change** for v1: plan's ask is "approve" or "no", and
  a `stuck` is "try again" or "stop". A "no" carries its note to the next plan
  run.
- **Industry practice:** Linear's agents ask the user with an `elicitation`
  activity, "Requests clarification or confirmation from the user", on the
  issue itself ([Linear](https://linear.app/developers/agent-interaction)).
  GitHub's deployment reviewers answer in a box on the run's own page
  ([GitHub](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments)).
- **Why:** the ticket is already the lane's one view. Writing there means the
  window works with no new code.
- **Cost:** one service with two Layers (ledger, memory), and the move of nine
  schemas. That move touches the tracker's files, so it waits for PR 130.
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

- **What each stage sends.**

| Stage | `system` | Why |
|---|---|---|
| plan | `maker` + "You plan; you change no file; hand back one PlanDraft" | it reads code with tools |
| build | `maker` + "One task; never touch the criteria; 'cannot meet as written' is a fine answer" | it edits code |
| review | `maker` + "You only find; quote each line you cite; you approve nothing" | it reads a diff with tools |
| sort | `own`: a short prompt and the bar | it has no tools; 27,000 characters of tool advice would be noise |

- **Why the preset for the coding stages.** Anthropic's guide: with no
  `systemPrompt`, the SDK "uses a minimal prompt that covers tool calling but
  omits the rest of the `claude_code` preset's content, including its security
  and safety instructions", and "unattended coding automation, like a CI job
  that fixes lint errors or reviews diffs, still fits the preset"
  ([Anthropic](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)).
  Experiment 158 found our stages send none today.
- **Codex** has `developer_instructions`, "Additional developer instructions
  injected into the session", and `model_instructions_file`, a "replacement for
  built-in instructions"
  ([OpenAI](https://learn.chatgpt.com/docs/config-file/config-reference)).
- **The stage part is short.** The long part of each stage's text stays in its
  prompt, as today. The system part holds only the role and the hand-back rule.
  The repository's own `AGENTS.md` and `CLAUDE.md` load the normal way
  ([agents read rules the normal way](./agents-read-rules-the-normal-way.md)).
- **Each stage moves to `Agents` when its slot goes real** (slices 5 to 7):
  `planner.ts`, `builder.ts` and `reviewer.ts` call the Agent SDK directly
  today. The move rewrites each one's call as a `turnOf` for `agentRunner`.
  The builder's three holds (the OS sandbox, the guard, the short environment)
  stay as they are, through the Claude adapter's options.
- **The provider is a setting,** `[agents.<step>] provider` in `fabrika.toml`,
  with Claude the named default.
- **Cost:** one field, three adapters, four stage texts. Then one run per
  stage with and without the preset, as 158 did for its toy job, about $1 each.
- **How sure: 70%.** The doubt is in 158 itself: on its toy job the preset did
  not change how often the model wandered. Our stages' own prompts are long,
  and the effect there is untested. The runs in slices 5 to 7 measure it.

## 4. What "start" is, and what the person sees

**Elm's answer:** the button's click is a Msg; its Cmd writes one fact. On the
host side it is OTP's: an application starts its supervisor's children at boot
([tea-host](./tea-host.md)). The `lanes` program is that child. It listens to
the ledger, and for each new start written by its own person, it starts `lane
<n>` in the background.

```ts
// A sketch. The start fact. Only a person writes it: a row in WRITTEN_BY, and the door's PERSON_KINDS.
Schema.Struct({type: Schema.Literal("delegated")});

// A sketch. `lanes`: one per host, started by the host at boot. It starts only its own person's lanes,
// so a second person's host never runs the first person's ticket on the wrong login.
const lanes = Stream.filter(Tickets.tail, (e) => e.fact.type === "delegated" && e.by.id === me.id).pipe(
	Stream.runForEach((e) => startJob(`lane ${e.ticket}`)), // a claim on lane/ticket/<n> first: one lane a ticket
);
```

- **The word.** Linear calls it delegating an issue to an agent: it "creates
  an `AgentSession`" ([Linear](https://linear.app/developers/agent-interaction)).
  `delegated` takes that word. The plain gloss: handed to the pipeline.
- **The button shows** on an open ticket with no lane running: no `delegated`
  since the last lane's end. It is gone while a lane runs.
- **Stop in v1 is close.** The lane reads fresh before each child; a closed
  ticket ends it as `skip:closed`. A child already running is stopped by the
  `Agents` stop. A separate stop button is an open question.
- **What the person sees, from facts the tracker already shows:**
  - the row "you started this", then "plan running" in the top line;
  - "plan: done", "plan v1, 2 tasks", and the box "approve plan v1";
  - after a yes: "build running, task t-1", "2 commits", "review at a1b2c3d: 3
    of 3 met";
  - "PR #12 open, checks running", then "PR #12 merged" and the top line
    "done: PR #12 merged";
  - a `stuck` shows as "stuck: <why>" with a box: try again, or stop.
- **The live row** ("review running 3m, 9 turns, last: Read, open log") is the
  tracker's own next pull request (section 3 of
  [what a ticket shows](./what-a-ticket-shows.md)). This plan gives it real
  runs to show. It does not build it.
- **Why a fact, not a call:** the start is on the shared ledger, so both people
  see who started what. The tracker never needs to know the pipeline exists.
  It matches the host rule that a send is a ledger append.
- **Cost:** one fact kind, one door line, one button, one small program, and a
  host that starts one program at boot. That last part is new in
  `apps/fabrika/src/host/run.ts`, which PR 130 also changes.
- **How sure: 75%.** The doubt: two hosts of one person (two laptops) would
  both start the lane. The claim on `lane/ticket/<n>` lets one win; the other
  ends `skip:claimed`. That is the lease rule from
  [the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md), not yet
  tried with two hosts on one login.

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
  would count more carefully.
- **Core files the lane runs through but does not edit:** the ledger's
  `host/rules.ts` has 1 clock read (a migration's time, not a lease);
  `host/durable-object.ts`, the shared ledger of PR 130, has 14. The rest of
  the host's clock reads (`host.ts` 6, `supervisor.ts` 4, `journal.ts` 2,
  `monitor.ts`, `observer.ts`, `call.ts`) sit in tea-host's supervisor, which a
  plain program in the app's host does not use.
- **Picked renames that land elsewhere:** triage's answers (`YesPlan` and the
  rest to `Accept`) are 4 lines in one pipeline file, `stages/sort/answer.ts`.
  Sort is not in v1's first slices. `kind` in tea-program is not picked yet;
  each new program calls it once.
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

Each line is one pull request. The money starts at slice 5.

1. **`Tickets` and the move of the lane facts.** The nine schemas move into the
   pipeline; the tracker imports them. `Tickets` with a ledger Layer and a
   memory Layer. Proves: a pipeline program writes `started` and the tracker's
   window shows "plan running". Waits for PR 130. $0.
2. **A system prompt on the `Turn`.** The `System` field, three adapters, the
   fake records it. Proves: each provider gets the prompt it was given, and no
   turn can go out with none. $0.
3. **The walking skeleton.** `lane 3` in the app's tsh, the new parent, every
   slot a fake: the fake provider, the local code host, a fixture repository
   from `fixtures/`, a local merge at the end. Proves: the parent runs as a
   program in the host, writes all nine kinds, waits on the ask box and goes on
   after a click, ends "done", and a host killed during the ask resumes with no
   child run twice. Laws on the parent's `next`. $0. This is a walking
   skeleton, Alistair Cockburn's name (in his book *Crystal Clear*, 2004) for
   a thin build that runs end to end through the main parts; the page was not
   read for this note.
4. **Start.** The `delegated` fact, its door line, the button, `lanes`, and the
   host starting `lanes` at boot. Proves: the start comes from the window, an
   agent cannot start a lane, and a second person's host does not take the
   first person's start. $0.
5. **Plan goes real.** `planner.ts` on `Agents` with its system prompt;
   `PlanHost` reads from `Tickets`. A sandbox repository. Proves: a real plan
   and its ask from a tracker ticket, and the plan stage's preset run. About
   $1 to $3.
6. **Build and review go real.** Both on `Agents`, review on the local code
   host. Still a local merge. Proves: a real commit that a different agent
   reviewed, with nothing pushed before it passed. About $2 to $5.
7. **Ship goes real.** Push after review, the pull request, CI, the ship
   machine's merge on a sandbox GitHub repository; `pr` facts. Proves: the first
   merged pull request started from the app. About $1 on top.
8. **demlik.** One small real ticket, filed in the tracker, started, merged
   through demlik's own merge rules. Logged in `field/` the same day. Proves:
   the v1 goal for one person.
9. **Two people.** On PR 130's shared ledger: one person files, the other
   comments, the starter's host runs the lane on the starter's login. Proves:
   the v1 goal.

After v1: the sort slot, the test writer slot, the PR watcher for pull requests
outside lanes, and moving the lane into a box
([programs run in a box](./programs-run-in-a-box.md)).

- **Why this order:** fakes first, so the wiring is proven at $0 and its tests
  stay in CI with no key. Then the real pieces go in the order of the lane
  itself, so each paid run stands on a proven one.
- **Cost:** nine pull requests, about $5 to $12 of agent runs before demlik.
- **How sure: 75%.** The doubt is slice 3's size. If the old stage machines need
  much change to read tracker tickets, slice 3 splits in two: the parent, then
  the stages' ticket reads.

## Open questions for the owner

- Sort out of v1's first slices: yes?
- Test writer after v1: yes?
- Stop in v1 is "close the ticket", with no stop button: yes?
- Only the person who pressed start may answer that lane's asks: yes?
- The `pr` fact from ship's own reads, until the watcher exists: yes?
- `delegated` as the start fact's name: yes?

## What it cannot tell us

- Nothing is built or run. Every number above is a count of today's code, not a
  measurement.
- Whether the old stage machines take a tracker ticket without large change.
  Slice 3 shows it.
- Whether the preset helps our stages. 158 tested a toy job only.
- How the window reads on a long lane with many rounds. No real lane has
  written its facts yet.
- What a lane costs end to end from the app. The estimates come from
  experiments 85, 105 and 107, run from scripts.
- The dead-code count is a text search, not `code-graph`'s reachability walk,
  and may miss a name used only by a type.
