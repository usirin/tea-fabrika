# A ticket runs from the app

**Proposed 2026-10-27, brought up to date the same day** with the owner's
calls: push and merge are two steps, one review per plan, the cloud host in
v1, stage agents on Codex, and every stage in a box. Nothing here is built.

A person files a ticket in the app. Our own pipeline takes it all the way to a
merged pull request, and writes each step onto the ticket so the person can
watch it go.

```ts
// A sketch. The whole idea, from one filed ticket to a merge.
//
//   the window   [ file ]                  -> {type: "filed", to: "github:7"} by user:owner   (to: the assignee)
//   github:7's host   `lanes` sees a ticket assigned to its person, claims lane/ticket/3, starts `lane 3`
//   lane 3       triage: accept, to plan   (in its box, on opus)
//                plan: planned v1 · asked "approve plan v1"
//   the window   [ approve ] [ no ]        -> {type: "answered"} by user:owner
//   lane 3       test writer: 3 tests, red and green on the base as the plan says
//                build t-1, t-2: quick checks green · mutation step: 0 lived · one review: 3 of 3 met
//                push: leak check clean, pushed a1b2c3d, PR #12 opened, link fact written
//                merge: CI green, merged by the repo's own rules
//   the watcher  PR #12 open · PR #12 merged   (read from GitHub, never written by the lane)
//   top line     "done: PR #12 merged"         (a fold of facts; no agent wrote "done")
const lane = (ticket: TicketNumber) =>
	parent({
		read: Tickets.read(ticket),
		children: [triage, plan, testWriter, build, mutation, review, push, merge],
	});
```

## The short version

- **One new program, `lane`, written by hand.** It runs the stages as its
  children, one at a time: triage, plan, the owner's yes, test writer, build,
  mutation step, review, push, merge.
- **Filing a ticket starts it.** There is no start button. Triage is the front
  door.
- **The assignee's host runs it.** Every ticket has one person on it. Their
  host claims it on the ledger, so it never runs twice. Their cloud host
  counts too, so a shut laptop stops nothing.
- **Quick checks per task, one review per plan.** Each task runs typecheck,
  lint and its own tests. Review reads the whole diff once, at the end.
- **Push and merge are two steps.** Push opens the PR. Merge waits on CI and
  merges. Today's ship code becomes merge.
- **Every stage runs in a box.** The model login goes in the box the way
  GitHub Actions does it. The GitHub key never does: a Cmd that needs it goes
  out to the host.
- **Stage agents run on GPT sol through Codex.** Triage stays on opus for now.
- **Everything lands on the ticket as a fact.** The tracker already shows
  facts. "Done" comes from GitHub, through a watcher. No agent can write it.
- **Fakes first.** Slices 1 to 7 wire everything up for $0. Real agents come
  in after that, one stage at a time.
- **Sixteen slices,** each one pull request. Section 8 says what changed today
  and why.

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
  [agents run on Codex](./agents-run-on-codex.md),
  [agents behind one service](./agents-behind-one-service.md),
  [the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md),
  [the cloud is one more host](./the-cloud-is-one-more-host.md),
  [one review a plan, and the cloud host in v1](./one-review-a-plan-and-the-cloud-in-v1.md)
  ([PR 145](https://github.com/usirin/tea-fabrika/pull/145)).
- Older than experiment 107, so tested here and not taken on trust: the slot
  idea of 2026-10-11, the "ship, review, build, triage" order, read fresh, and
  a review per task. Read fresh still holds: experiment 107 used it for the
  pinned merge. The slot order does not: v1 needs every slot at once, so the
  order becomes the order in which fakes are swapped for real agents
  (section 7). A review per task gives way to one review per plan (section 8).
- What exists today, and where it falls short:

| Piece | Where | What it lacks for this step |
|---|---|---|
| The app's host | `apps/fabrika/src/host/` | Runs only the programs tsh lists (`apps/fabrika/src/tsh.ts`: counter and tracker). Starts nothing by itself. |
| The tracker | `programs/tracker/src/` | Shows the nine lane facts, the top line and the ask box. Only tests write lane facts. A comment has no "request changes", and a yes keeps no hash of the text it saw. |
| The stage machines | `packages/pipeline/src/stages/` | `sort` (triage's code, not renamed yet), `plan`, `test-writer`, `task`, `catchup`, `review`, `ship`. They read GitHub issues (`TicketUrl` in `build/ticket.ts`, `PlanHost` in `plan/services.ts`, `SortHost` in `sort/services.ts`), not tracker tickets. |
| The test writer | `stages/test-writer/` ([PR 79](https://github.com/usirin/tea-fabrika/pull/79)) | The machine, its laws, a scripted drive and the code side of its mutants job are built. Its handlers (read the base, commit, run the tests) are not, and neither Draft is on `Agents`. |
| The plan's Properties | `stages/plan/` | The plan hands back criteria. The Property shape of [the plan stage](./the-plan-stage.md) is not built, and the test writer needs it. |
| The mutation step | nowhere | No machine. Only experiments 119, 121 and 124 ran StrykerJS. |
| Push | nowhere | No program. Today's `stages/ship` takes an open PR; nothing pushes after review. |
| The PR watcher | nowhere | No program writes `pr` facts. |
| The box | experiments 128, 137 and 148 | No `Sandbox` service in the packages. The builder has only its harness holds. |
| Two parents | `stages/operate/`, `stages/lane/` with `hosted/` | `operate` pushes every round before review, against [push after review](./push-after-review.md). `lane` matches the decisions but runs as hosted children on tea-host, a shape the 10-22 note says the rebuild drops. |
| `Agents` | `packages/fabrika/src/agents/agent/` | Built in experiment 156. No stage uses it. Its Claude adapter always sends Claude Code's preset ([PR 127](https://github.com/usirin/tea-fabrika/pull/127)); a `Turn` cannot ask for another prompt. |

## 1. The whole trip of one ticket

Three places take part: the person's window, the assignee's host, and GitHub.

- **The lane stops at the owner's box and waits.** Nothing after plan runs
  until a person says yes.
- **Two loops are normal.** A mutant that lived sends the test writer back,
  and review can send build back.
- **Each task runs quick checks.** Typecheck, lint and its own tests, then a
  commit on this machine.
- **Review runs once,** over the whole diff, after the mutation step. Nothing
  leaves the machine before it passes.
- **Then push opens the PR, and merge takes it from there.** If CI goes red,
  merge sends the lane back to build, and review reads the new commit.
- **Any step can end stuck.** The person gets a box with two picks: try
  again, or stop.

## 2. The lane, one parent written by hand

**Elm's answer:** a parent holds one child at a time, steps it with the
child's own `update`, and hears its result as a typed message (nested TEA,
with the OutMsg the five verbs already are). There is no pipeline language.
As a program, it is a tea-program the host runs, like the tracker. The lane
has four states.

```ts
// A sketch, in Effect Schema. The lane's state: where it is, and the one child running now.
const Child = Schema.Literals(["triage", "plan", "test_writer", "build", "mutation", "review", "push", "merge"]);
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
	if (!built(f)) return run("build"); // one task a round, catch-up first, quick checks, local commits only
	const m = mutated(f); // "not_yet" | "lived" | "killed"
	if (m === "not_yet") return run("mutation");
	if (m === "lived") return run("test_writer"); // its mutants job, then the mutation step again
	if (!reviewed(f)) return run("review"); // one review, the whole diff; send:builder makes `built` false again
	if (!pushed(f)) return run("push"); // leak check, push the commit review read, open the PR
	return run("merge"); // wait on CI and comments, then merge; a red CI sends it back to build
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
		case "answered": // only a person's `answered` reaches here (the Listen filters by writer)
			return [{...s, at: {_tag: "reading"}}, [readTicket(s.ticket)]];
	}
};
```

- **`next` names one step, and the top rule that matches wins.** Since it is
  pure, slice 3 can test it with laws and no agents: any set of facts gives
  exactly one step.
- **Every way back goes through "reading".** The lane drops its guess and
  reads the ticket again. So a restarted host just starts at "reading".
- **Which old code each step takes in:**

| Step | Code today | Taken in as it is? | Slices |
|---|---|---|---|
| triage | `stages/sort` | No. Renamed to triage, its answers renamed, fold and `carried` taken out, reads and writes on `Tickets`, in its box | 3 with a scripted sorter, 8 real |
| plan | `stages/plan` | The machine, yes. `PlanHost` reads from `Tickets`, and the plan must hand back Properties | 3 scripted, 9 real |
| test writer | `stages/test-writer` | The machine, yes: `scripted.ts` drives it in slice 3. Its handlers and both agent calls are new | 3 scripted, 10 real |
| build | `stages/task`, `stages/catchup` | Yes, as the hosted lane steps them, pushing only to the local code host, with quick checks per task | 3 scripted, 11 real |
| mutation step | none | New machine, code only, no agent | a stand-in in 3, built in 5 |
| review | `stages/review` | Yes, on the local code host (`review/local.ts`), once per plan | 3 scripted, 11 real |
| push | none | New. A small program: leak check, push, open the PR, write the link fact and `pushed` | 3 on the local code host, 12 real |
| merge | `stages/ship` | Yes. Renamed to merge in slice 12 | 3 on the local code host, 12 real |
| the parent | `stages/lane` (experiment 105) | Its `next` rules, yes. Its hosted children and its fold branch, no | 3 |

- **The branches, child by child.** Each is an outcome in the five verbs, and
  `next` turns it into the lane's next step.
  - **triage** reads the ticket whole, comments included
    ([the ticket is the lane view](./the-ticket-is-the-lane-view.md)), and
    answers one of four ([triage's answers](./sort-answers-yes-or-no.md)):
    - `accept`, to plan: plan starts at once.
    - `accept`, to research: no research stage exists. The lane ends there as
      `send:research`, and the top line says so. A research stage comes after
      v1. A lean, 70%.
    - `decline`: code closes the ticket with its one-line reason, written as
      `agent:triage`. The tracker already reads that as "closed by agent
      triage".
    - `duplicate`: it asks, and the owner's yes closes it
      ([what a ticket shows](./what-a-ticket-shows.md), section 5). Triage's
      own note says a duplicate closes the ticket; this plan follows the later
      note, of 2026-10-25.
    - `escalate`: `ask:owner:ruling`, a box with triage's options. After the
      answer, triage runs again and reads the answer in the timeline. A lean,
      65%: the ruling route does not say who picks its branch.
  - **plan** ends `done`, and the parent asks for the yes: a box with
    "approve" and "no". A plan with open questions ends
    `ask:owner:questions`, and they block until the owner answers
    ([a project is a parent plan](./a-project-is-a-parent-plan.md)). A "no"
    carries its note to the next plan run.
  - **test writer** ([the test writer](./the-test-writer.md)): `done` or
    `skip:no_properties` goes on to build. `already_passes`, `fails_on_base`
    and `cannot_test` are boxes with three picks each. A pick that changes the
    plan counts as the owner's yes for the new version, so nobody approves
    twice.
  - **build**: one task a round, a fresh builder each, catch-up first. Each
    round ends with the task's quick checks: `done` when all pass,
    `send:builder:checks_red` for the same task again, `stuck` when they
    could not run. A builder that cannot meet a criterion as written sends it
    back to plan with evidence
    ([a project is a parent plan](./a-project-is-a-parent-plan.md)).
  - **mutation step**: `done` goes on to review.
    `send:test_writer:mutant_survived` sends each mutant that lived to the
    test writer's mutants job. A diff that adds a disable comment or edits
    the skip list asks the owner (`ask:owner:check_change`).
  - **review**: one review of the whole diff at the head. A pass goes on to
    push. A send back names the tasks it is about, and only those go round
    again.
  - **push**: the leak check, then the push of the very commit review read,
    then the PR. It writes the link fact and `pushed`.
  - **merge**: waits on CI and comments, then merges by the repo's own rules.
    A red CI sends the lane back to build. Done is read off the watcher's
    `pr` fact.
  - **any `stuck`**: a box with "try again" and "stop".
- **Do survivors block? What the notes say:**
  - [Promises in the pipeline](./promises-in-the-pipeline.md), decided
    2026-10-24: every mutant that lives blocks the pull request and goes back
    to the writer.
  - [The test writer](./the-test-writer.md), decided 2026-10-24: the writer
    answers each one `test`, `cannot` or `noise`. `cannot` asks the owner
    about a disable comment. `noise` becomes a finding the owner rates: "fix"
    sends it back for a test, "noise" lets it live.
  - [Every finding is rated](./every-finding-is-rated.md), 2026-10-25: a
    `noise` answer stays open until the owner rates it. Read as written, an
    unrated `noise` does not hold the pull request. Its proposed part would
    reopen the block rule once rating counts exist; until then "that decision
    stands".
  - [New combos](./new-combos.md): a mutant that lives is a failed control.
    [Property tests](./property-tests-not-our-own-search.md): the grader
    stays StrykerJS with the repo's own tests, with no spec arm.
  - This plan builds it as written. It decides nothing new here.
- **Where the code lives:** a new folder, `packages/pipeline/src/lanes/` (a
  working name), with two programs, `lane` and `lanes`. No `hosted/` part. The
  stage machines are taken in as libraries, as `operate` takes them
  (`stages/operate/program.ts`). Each child's state is kept under its intent
  in the run's storage, on the host's one ledger, so a restart starts no child
  twice.
- **Which parent is the model:** `stages/lane/` (experiment 105). It already
  does one commit per task on the local code host (`code-host-local.ts`),
  review there, and one pull request only once every criterion passed. The
  new parent keeps its `next` rules and drops its tea-host children.
- **Why:** one program in the same host as the tracker is the smallest thing
  that runs a ticket. It needs no new host feature.
- **Cost:** one parent of about 500 lines with its laws, a `Tickets` read in
  each stage that reads GitHub today, and two new programs, the mutation step
  and push.
- **How sure: 70%.** The doubt: whether the old stage machines can read
  tracker tickets without much change. Slice 3 shows it with fakes, for $0.

## 3. Facts, and who writes each one

**Elm's answer:** a write is a Cmd (the Act move). A wait for a person is a
Sub (the Listen move). The person's click is a Msg in the tracker, whose Cmd
writes `answered`. The lane hears it on its Sub. Nobody calls anybody.

```ts
// A sketch. The service the pipeline reads and writes tickets through. Its Layer is on the Ledger.
class Tickets extends Context.Service<Tickets, {
	readonly read: (n: TicketNumber) => Effect.Effect<{ticket: Ticket; facts: readonly Entry[]}, TicketsFailed>;
	readonly write: (n: TicketNumber, fact: LaneFact) => Effect.Effect<void, TicketsFailed>; // as the host's writer
	readonly answers: (n: TicketNumber, ask: AskId) => Stream.Stream<Answered>; // a person's only
	readonly tail: Stream.Stream<Entry>; // every new fact on every ticket, for `lanes` (section 4)
}>()("Tickets") {}

// The ask, as the lane writes it, and the answer, as the window writes it.
yield* Tickets.write(3, {type: "asked", ask: "a-1", what: "approve plan v1", picks: ["approve", "no"]});
// tracker/ticket/3/inbox  {type: "answered", ask: "a-1", pick: "approve", note: "", text: "sha256:9c1f…"}  by a person

// A comment that asks for changes, after a yes. Only a person's stops build.
// tracker/ticket/3/inbox  {type: "commented", body: "Skip part 2.", asks: "changes"}  by a person
```

- **Everything lands on one stream per ticket,** `tracker/ticket/<n>/inbox`.
  The tracker already reads that stream once a second, so the window needs
  almost no new code. The lane writes as an agent writer (`agent:lane`, or
  the stage's name), on the host that holds the ticket's claim. The door
  stamps it ([PR 130](https://github.com/usirin/tea-fabrika/pull/130)).

| Fact | Written by |
|---|---|
| `started`, `ended` | the parent, around each child it starts |
| `planned` | the parent, from plan's `done` |
| `asked` | the parent, from any child's `ask`, and on a `stuck` |
| `reviewed` | the parent, from review's outcome |
| `pushed`, the link fact | push, after the leak check, the push and the PR open |
| `pr` | the PR watcher, on a change only. Never the lane, push, merge or an agent |
| `answered`, `rated`, `commented` | a person, in the window. Never the lane |

- **Only a person answers a box** (decided,
  [tickets start in our tracker](./tickets-start-in-our-tracker.md)). The
  door refuses an `answered` from an agent (`PERSON_KINDS`), and the fold
  keeps an agent's out of every ticket. Anyone on the ledger can answer;
  nothing ties a box to one person.
- **A yes covers the text it saw** (same note). The approve click carries a
  hash of the title and body the person read. An edit after the yes needs a
  new yes before build.
- **"Request changes" is a new button on a comment.** When a person clicks
  it, build stops and plan runs again. An agent's comment can't do this.
- **The `pr` fact is the watcher's** ([what a ticket shows](./what-a-ticket-shows.md),
  section 5, decided 2026-10-25;
  [scheduled jobs on the host](./scheduled-jobs-on-the-host.md)). Done is a
  merge read from GitHub by code, so v1 needs the watcher: slice 7.
- **The watcher finds the PR through a link fact.** Push writes it when it
  opens the PR. It names the PR, never its state. Linking a PR to a ticket is
  "next, not yet" in
  [tickets start in our tracker](./tickets-start-in-our-tracker.md). How
  sure: 70%. The doubt: people may also want to link PRs by hand, and one
  writer for both would be simpler.
- **The lane facts move into the pipeline.** Programs sit above the pipeline
  in `layer-rules.json`, so the pipeline cannot import the tracker. The nine
  lane facts move from `programs/tracker/src/ticket.ts` into the pipeline, and
  the tracker imports them back. The tracker keeps its own four.
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
  [what a ticket shows](./what-a-ticket-shows.md): whether `planned`,
  `pushed` and `reviewed` stay facts of their own. The first lane written
  both ways settles it.

## 4. Who runs a lane

**The owner ruled it on 2026-10-27: the assignee's host.** Every host runs a
small `lanes` program from boot. It hears every new ticket and keeps only its
own person's. **Elm's answer:** a filed ticket is a fact on the ledger, and
`lanes` hears it on a Sub. On the host side it is OTP's: an application
starts its supervisor's children at boot ([tea-host](./tea-host.md)).

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

- **One lane per ticket, held by a claim on the ledger.** It is the same 30 s
  lease the pipeline already uses (`asks/claims.ts`), renewed every 10 s. The
  fence rule is from
  [the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md): a
  fenced write is good until someone newer claims. Experiment 151 landed
  nothing twice in 1,090 runs. It has not been tried with two app hosts on
  one ticket.
- **Who's assigned.** The filing form picks the filer, and the filer can pick
  the other person instead. A ticket a scheduled job files goes to whoever
  that agent belongs to (`agent:x for:github:<id>`).
- **A host goes away.** After about 30 s, another host of the same person can
  claim the ticket, read fresh and carry on. Each child keeps its state under
  its intent, so no child runs twice.
- **Reassigning.** A person writes `assigned`. The running lane sees it before
  its next child and ends with `skip:reassigned`. The new assignee's host
  picks it up.
- **Stopping, in v1, means closing.** A closed ticket ends the lane as
  `skip:closed`, and `Agents` stops whatever agent is running. A stop button
  waits until a real run needs one.
- **Every laptop is off.** Then the cloud host runs the lane. That is in v1
  now, as slices 6c and 4c, with the laptop as its twin
  (section 8, and [the cloud is one more host](./the-cloud-is-one-more-host.md)).
- **A filed ticket starts a lane, and nothing past triage needs a start of
  its own.** Any ledger member may file one: a person, or a scheduled job as
  an agent writer ([scheduled jobs on the host](./scheduled-jobs-on-the-host.md)).
  Triage's accept starts plan, and the owner's yes starts the test writer and
  build. A reopen starts a new lane, and the old PR stays in the timeline
  ([what a ticket shows](./what-a-ticket-shows.md), section 5).
- **There is no start button and no `delegated` fact.** An earlier draft of
  this note had both, and left triage out of v1 because "a person who presses
  start already said worth doing". That was wrong: triage is the front door,
  and it is the step that says whether a ticket is worth doing.
- **Why the assignee's host:** each person runs their own agents on their own
  login, and asks another person's agents for work through the ledger
  ([agents behind one service](./agents-behind-one-service.md)). Assigning a
  ticket to the other person is that ask. Each person pays for and sees only
  their own agents' work, and a row always shows whose agent ran it (PR 130's
  label). The known way: Linear has an assignee on every issue and lets you
  delegate one to an agent; GitHub lets you assign tasks to Copilot, which
  then works them ([Linear](https://linear.app/developers/agent-interaction),
  [GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent)).
- **What the person sees, from facts the tracker already shows:**
  - "filed", then "triage running", then "triage: send plan";
  - "plan: done", "plan v1, 2 tasks", and the box "approve plan v1";
  - after a yes: "test writer: done", "build running, task t-1", "mutation: 0
    lived", "review at a1b2c3d: 3 of 3 met", "pushed a1b2c3d";
  - from the watcher: "PR #12 open, checks running", then "PR #12 merged" and
    the top line "done: PR #12 merged";
  - a `stuck` shows as "stuck: <why>" with a box: try again, or stop.
- **The live row** ("review running 3m, 9 turns, last: Read, open log") is the
  tracker's own next pull request (section 3 of
  [what a ticket shows](./what-a-ticket-shows.md)). This plan gives it real
  runs to show. It does not build it.
- **Cost:** one small program, the claim per ticket, and a host that starts
  one program at boot, which is new in `apps/fabrika/src/host/run.ts`. The
  assignee adds one field on `filed`, one fact kind, one door line (only a
  person writes `assigned`) and a picker in the form.
- **How sure: 75%** for the shape. The doubt is the claim between two hosts
  on a slow link. Slice 4 tests it on the laptop twin, 4c between a laptop and
  the cloud host, and slice 14 for real.

## 5. Agents and boxes

Every stage reaches an agent through one `Agents` service, with a short
system prompt of its own. The coding stages keep the maker's coding prompt
and add one line. Every program runs in a box. A Cmd that needs the GitHub
key is the only thing that leaves it, and the host runs that one Cmd.

**Elm's answer:** an agent run is a Sub, since it keeps talking
([Elm first](./elm-first.md)). `agentRunner` in
`packages/fabrika/src/agents/agent/draft.ts` already turns an `Agents` run
into the Draft Sub every stage uses. The system prompt is data on the turn,
not a new shape.

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

| Stage | System prompt | Its box holds | Model |
|---|---|---|---|
| triage | `own`: short, with the bar. No tools | no code, only the model login | opus, through Claude Code |
| plan | `maker` + "You plan; you change no file; hand back one PlanDraft" | a copy of the code | GPT sol, through Codex |
| test writer | `maker` + "Only add tests the list allows; never touch product code" | a copy of the code | GPT sol, through Codex |
| build | `maker` + "One task; never touch the criteria or the tests; 'cannot meet as written' is a fine answer" | a copy of the code | GPT sol, through Codex |
| mutation | none, it's code only | a copy of the code | none |
| review | `maker` + "You only find; quote each line you cite; you approve nothing" | the commit, read only | GPT sol, through Codex |
| push | none, it's code only | the commit; push and open PR go out to the host | none |
| merge | none, it's code only | nothing; every GitHub call goes out to the host | none |

- **Every stage runs in a box,** plan and review included. That is the
  owner's call of 2026-10-24 ([programs run in a box](./programs-run-in-a-box.md)).
  Slice 6 makes the box a real `Sandbox` service, and slice 6c puts it on
  Cloudflare.
- **The model login goes in the box, the way GitHub Actions runs Claude
  Code** (ruled 2026-10-26,
  [where a person's login lives](./agents-behind-one-service.md#where-a-persons-login-lives)).
  Claude Code takes the person's own token as `CLAUDE_CODE_OAUTH_TOKEN`.
  Codex takes `auth.json`, lent for one job and taken back after, as
  OpenAI's CI page says. Our Worker never sees a real token. There is no
  relay: it was dropped on 2026-10-25.
- **The GitHub key never goes in a box.** Push's and merge's GitHub Cmds are
  marked `outside`. The host checks each one with the Cmd's own schema, does
  it with the key, and sends the answer back in.
- **An env dump in a box does find the model login.** That is the price of
  the GitHub Actions way, and the owner took it knowingly on 2026-10-26. It
  still never finds the GitHub key. Jobs run on private repositories only, as
  OpenAI's page asks.
- **The box comes before any paid run.** In this plan, no real agent ever
  runs outside one.
- **Stage agents run on GPT sol through Codex**
  ([agents run on Codex](./agents-run-on-codex.md), the owner's call of
  2026-10-27). Opus is only for the main session a person talks to. This
  replaces opus for plan, the test writer, build and review in
  [agents run on opus](./agents-run-on-opus-for-now.md).
- **Triage stays on opus** until experiment 159 (tracker ticket 42) says
  otherwise. It is the front door, and a wrong answer there sends the whole
  run the wrong way. It joins `AGENT_STEPS` with its rename.
- **Each stage picks its provider in `fabrika.toml`,** `[agents.<step>]
  provider`. Codex for plan, the test writer, build and review; Claude for
  triage.
- **Why the coding stages keep the maker's prompt.** Anthropic's guide: with
  no `systemPrompt`, the SDK "uses a minimal prompt that covers tool calling
  but omits the rest of the `claude_code` preset's content, including its
  security and safety instructions", and "unattended coding automation, like
  a CI job that fixes lint errors or reviews diffs, still fits the preset"
  ([Anthropic](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)).
  Experiment 158 found our adapter sent none. Since PR 127 the `Agents`
  Claude adapter always sends the preset; the stages that still call the
  Agent SDK directly send none. Codex keeps its own built-in instructions and
  takes ours as `developer_instructions`, "Additional developer instructions
  injected into the session"; `model_instructions_file` is a "replacement for
  built-in instructions"
  ([OpenAI](https://learn.chatgpt.com/docs/config-file/config-reference)).
- **The system prompt has two cases.** It is either maker plus a line, or
  own. So nobody can pick "no prompt" by mistake.
- **The stage part is short.** The long part of each stage's text stays in
  its prompt, as today. The system part holds only the role and the hand-back
  rule. The repository's own `AGENTS.md` and `CLAUDE.md` load the normal way
  ([agents read rules the normal way](./agents-read-rules-the-normal-way.md)).
- **Each stage moves to `Agents` when its slot goes real** (slices 8 to 11).
  `sorter.ts`, `planner.ts`, `builder.ts` and `reviewer.ts` call the Agent
  SDK directly today, and the test writer has no runner yet. The move rewrites
  each one's call as a `turnOf` for `agentRunner`. The builder's three holds
  (the OS sandbox, the guard, the short environment) may stay as a second
  layer; the box is the fence.
- **Cost:** one field, three adapters, five stage texts. Then one run per
  stage with and without the maker's prompt, as 158 did for its toy job,
  about $1 each.
- **How sure: 70%** that the maker's prompt helps our stages. Experiment 158
  saw no difference on a toy job, and only on Claude. Our stages' own prompts
  are long, and most stages now run on Codex, so the effect there is
  untested. Slices 8 to 11 measure it.

## 6. Skip the core sweep for v1

The 10-22 note says to sweep the core first, then rebuild. So the core files
this plan touches were counted, on 2026-10-27. The sweep is "remove what
nothing uses, fix the clock, rename to the industry's words", over the core:
program, host, shell, agents, ledger.

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

- **The sweep and this plan barely overlap.** Sweeping first would hold up v1
  and change nothing in the files v1 needs. Do the 4 `export` words if a
  slice touches the line anyway.
- **New code reads time only through Effect's `Clock`,** as
  [build on Effect](./build-on-effect.md) asks, so it adds no new clock debt.
- **The clock reads that are left live in tea-host's supervisor.** The
  ledger's `host/rules.ts` has 1 (a migration's time, not a lease);
  `host/durable-object.ts`, the shared ledger of PR 130, has 14. The rest
  (`host.ts` 6, `supervisor.ts` 4, `journal.ts` 2, `monitor.ts`,
  `observer.ts`, `call.ts`) sit in tea-host's supervisor, which a plain
  program in the app's host doesn't use.
- **How it was counted.** Clock reads: `Date.now()` and `new Date()`. Dead
  code: every exported name in these files, searched across the repo's code;
  a name used only in its own file counts as an extra `export`, not dead
  code. `@demlik/code-graph --unreachable` was not run, to keep the laptop
  free; it would count more carefully. The counts are from before PR 130
  merged, which changed `host/door.ts` by 14 lines.
- **Picked renames that land elsewhere:** triage's answers (`YesPlan` and the
  rest to `Accept`) are 4 lines in one pipeline file, `stages/sort/answer.ts`.
  They land in slice 8, with the rename from sort to triage and fold taken
  out, as [triage's answers](./sort-answers-yes-or-no.md) asks. The rename of
  `stages/ship` to merge lands in slice 12. `kind` in tea-program is not
  picked yet; each new program calls it once.
- **The clash with the 10-22 note, in one line:** that note says sweep the
  core first, then rebuild the pipeline on it; this starts the rebuild first,
  because the parts do not overlap, and it takes the old stage machines in as
  they are, which that note's own "what would change it" allows.
- **Cost:** the host's clock reads stay, and so do their slow tests (a
  one-hour lease in experiment 116). Not this plan's tests.
- **How sure: 85%.** The doubt: a slice may find it needs tea-host's
  supervisor after all, for restarts. Then its clock reads come into scope,
  and they get swept as that slice touches them.

## 7. The order of work

Sixteen pull requests. Four slices start together. Slice 7 waits on the first
step of [PR 142](https://github.com/usirin/tea-fabrika/pull/142)'s host shape,
which starts only once the owner accepts that draft. Two new cloud slices, 6c
and 4c, put lanes on the cloud host inside v1. Agent money starts at slice 8.

| Slice | Needs | Can start in round | Cost |
|---|---|---|---|
| 1 Tickets and the lane facts | none | 1 | $0 |
| 2 A system prompt on the Turn | none | 1 | $0 |
| 5 The mutation step | none | 1 | $0 |
| 6 The box | none | 1 | $0 |
| 3 The walking skeleton | 1 | 2 | $0 |
| PR 142's first step: host Durable Object and timer | the owner's yes on 142 | 1 | $0 |
| 4 A filed ticket starts a lane | 1, 3 | 3 | $0 |
| 7 The PR watcher, on the cloud first | 1, PR 142's first step | 2 | $0 |
| 6c The box on Cloudflare | 6 | 2 | box time |
| 4c Lanes on the cloud host | 4, 6c | 4 | box time |
| 8 Triage goes real | 2, 3, 6 | 3 | about $1 |
| 9 Plan goes real | 8 | 4 | $1 to $3 |
| 10 The test writer goes real | 5, 9 | 5 | $1 to $2 |
| 11 Build and one review go real | 10 | 6 | $2 to $5 |
| 12 Push and merge go real | 7, 11 | 7 | about $1 |
| 13 First real ticket: a tea-fabrika ticket | 4, 12 | 8 | a few $ |
| 14 Two people | 13 | 9 | a few $ |

1. **Tickets and the lane facts.** The nine fact schemas move into the
   pipeline; the tracker imports them. A `Tickets` service, with a ledger
   Layer and a memory one. "Request changes" on comments, and a hash on each
   yes. Done when a pipeline program writes `started` and the window shows
   "triage running", and an agent's "request changes" stops nothing. $0.
2. **A system prompt on the `Turn`.** The two-case `System` field, three
   adapters, and a fake that records what it got. Done when each provider
   gets exactly what it was given, and no turn goes out without a prompt. $0.
3. **The walking skeleton.** `lane 3` in the app's tsh, the new parent, every
   child faked: triage on `sort` with a scripted sorter, plan scripted, the
   test writer through its `scripted.ts`, `task` and `catchup` scripted with
   their quick checks, a stand-in mutation step, one scripted review, push
   and merge on the local code host, a fixture repository from `fixtures/`, a
   local merge, and a stand-in watcher that writes `pr` from the local code
   host. Done when every branch in section 2 runs, the ask box and a click work,
   "done" shows at the end, and a host killed mid-ask comes back without
   running any child twice. Laws on `next`. $0. A walking skeleton is
   Alistair Cockburn's name (in his book *Crystal Clear*, 2004) for a thin
   build that runs end to end through the main parts; the page was not read
   for this note. If it gets too big, it splits, with the owner's yes: triage
   to the yes first, then the rest.
4. **A filed ticket starts a lane on its assignee's host.** The `to` field on
   `filed`, the `assigned` fact and its door line, the picker in the form,
   `lanes`, the claim, and a host that starts `lanes` at boot. Done when, on
   the laptop twin, one lane runs across a person's two hosts and none on the
   other person's, a reassign ends it `skip:reassigned` and the new
   assignee's host goes on with no child run twice, and no agent can write
   `assigned`. $0.
5. **The mutation step.** A new machine with no agent: StrykerJS over the
   lines the build changed and the lines each kept Property covers, the
   repo's own tests first, typecheck-refused mutants not counted, the skip
   list, and `send:test_writer:mutant_survived` or `ask:owner:check_change`
   ([promises in the pipeline](./promises-in-the-pipeline.md)). The test
   writer's mutants job gets its Draft, on a fake. Done when a planted weak
   test lets a mutant live, the mutant goes back to the writer, and a disable
   comment asks the owner. $0, only CPU time.
6. **The box.** A `Sandbox` service with a `none` and an `os` version, from
   experiments 128 and 137. Triage's box holds nothing but the login; the
   other stages' hold a copy of the code or the commit (section 5). Done
   when, with the fake agent, a planted `env | curl` line finds no GitHub key
   in any box. $0.
7. **The PR watcher, on the cloud first.** Its own program on a Durable
   Object alarm, reading through `CodeHost` and writing `pr` only when
   something changes ([tickets start in our tracker](./tickets-start-in-our-tracker.md)).
   It goes to Cloudflare first, with its Miniflare twin on the laptop. It
   needs no box, only GitHub reads. Done when a merged PR on a sandbox repo
   makes its ticket "done" without any lane writing it. $0.
   - 6c. **The box on Cloudflare.** New. The same `Sandbox` service with a
     Cloudflare container version: one container a job, open internet, the
     login the GitHub Actions way, as ruled on 2026-10-26. Experiment 148
     started such a box on Cloudflare. Done when the fake agent runs in a
     cloud box and the planted `env | curl` line finds no GitHub key. Box
     time.
   - 4c. **Lanes on the cloud host.** New. `lanes` runs on the cloud host
     too, with the same claim. Done when a ticket whose assignee has every
     laptop off still gets its lane, and a laptop that wakes up doesn't run
     it again. Box time.
8. **Triage goes real.** Renamed from sort, its answers renamed, fold and
   `carried` taken out. It reads tickets from the tracker, with its own
   prompt, on opus, in its box. A first triage cost about $0.11 in experiment
   135; a handful of tickets, about $1.
9. **Plan goes real.** `planner.ts` on `Agents`, on Codex, reading from
   `Tickets`, handing back Properties ([the plan stage](./the-plan-stage.md)).
   Done when a real plan and its box come out of a tracker ticket. About $1
   to $3.
10. **The test writer goes real.** Its handlers and both agent calls, on
    Codex, in its box. Experiment 124 answered mutants for $0.86 over three
    tickets. About $1 to $2.
11. **Build and one review go real.** Both on `Agents`, on Codex, still
    merging on this machine. Quick checks per task, one review for the whole plan.
    The same ticket runs both ways, one review against a review per task, and
    the run compares what each catches and what it costs. Done when a
    different agent has reviewed a real diff, and nothing went out before it
    passed. About $2 to $5.
12. **Push and merge go real.** Changed, was "ship". Push is a new small
    program: the leak check, the push, the PR. Merge is today's ship code,
    renamed. They run on a sandbox GitHub repo, with CI and the watcher's
    `pr` facts. Done when a filed ticket ends in its first merged PR. About
    $1.
13. **First real ticket: a tea-fabrika ticket.** Changed from demlik. One
    small real ticket in this repo, filed in the app, merged by this repo's
    rules, and logged in `field/` the same day. Done when fabrika has built a
    piece of itself. A few dollars.
14. **Two people.** On the shared ledger of PR 130. One person files a ticket
    and assigns it to the other, who comments. The assignee's host runs the
    lane on their own login. Done when that works, which is the v1 goal. A
    few dollars.

After v1: a research stage for `accept` to research, a decision record for
lasting rulings, the live "running now" row (the tracker's own), demlik as
the next real repo, and a release canary: a new fabrika build goes to one
host first, is watched, then goes to the rest. Google's SRE workbook calls a
canary "a partial and time-limited deployment of a change" and its
evaluation ([Canarying Releases](https://sre.google/workbook/canarying-releases/)).

- **Why this order:** fakes first, so the wiring is proven at $0 and its tests
  stay in CI with no key. The box and the watcher come before any paid run,
  so no real agent ever runs outside a box and done is never an agent's word.
  Then the real pieces go in the order of the lane itself, so each paid run
  stands on a proven one.
- **Cost:** sixteen pull requests, about $6 to $12 of agent runs before the
  first real ticket, plus box time on Cloudflare.
- **How sure: 70%.** The doubts: slice 3's size, if the old stage machines
  need much change to read tracker tickets; slice 6, since sandbox-runtime
  has run only in experiments; slice 9, since the plan's Properties are not
  built and the test writer cannot run without them; slice 7, since PR 142 is
  still a draft.

## 8. What changed on 2026-10-27, and why

### One review per plan, quick checks per task

- **What:** a review per task reads small pieces and misses how they fit
  together. One review over the whole diff, after the mutation step, sees the
  change the way a person would. Each task still runs typecheck, lint and its
  own tests, so a broken task stops early. Written up in
  [one review a plan](./one-review-a-plan-and-the-cloud-in-v1.md)
  ([PR 145](https://github.com/usirin/tea-fabrika/pull/145)), as proposed.
- **Cost:** one review agent per ticket instead of one per task, so it's
  cheaper. The catch is size, since a big plan makes a big diff. Past about
  400 changed lines, the plan splits.
- **How sure: 70%.** The doubt: whether one review catches as much as many.
  Slice 11 settles it by running the same ticket both ways.

### Push and merge, instead of one ship step

- **What:** the earlier draft had ship push, open the PR and merge. Today's
  ship code only does the last part: it takes an open PR, waits on CI and
  comments, and merges. [Push after review](./push-after-review.md) left
  "who pushes" open, and the draft filled that gap without asking.
- So push becomes its own small program. It runs the leak check, pushes the
  commit review read, and opens the PR. Like every program it runs in a box.
  Its two GitHub Cmds are marked `outside`, and the host does them with the
  GitHub key ([programs run in a box](./programs-run-in-a-box.md)).
- Merge is today's ship code, renamed. "Merge" is the word GitHub and every
  merge queue already use. "Ship" stays off the push step on purpose, because
  old notes and field logs use "ship" for the merge step. No code is renamed
  before slice 12.

```ts
// A sketch. `push`, run in a box. Only its two GitHub Cmds leave the box.
run(push, {
	interpret: {
		leak_check: leakCheck, // in the box: the commit holds none of the app's own keys as text
		commit_push: outside, // the host pushes the commit review read, with the GitHub key
		pr_open: outside, // the host opens the PR and sends back its number
		ticket_write: write, // the link fact, then `pushed`
	},
});
```

- **Cost:** one small program, plus renaming `stages/ship` and its note.
- **How sure: 85%.** The owner agreed today, and the only open part was the
  name.

### The cloud host is in v1

- **What:** a lane shouldn't wait because a laptop lid is shut. Since the
  owner's ruling of 2026-10-26, the box can hold the login the way GitHub
  Actions does, so nothing blocks a box on Cloudflare. Written up in PR 145.
- **Cost:** two new slices, 6c and 4c, and box time on Cloudflare. The laptop
  stays the twin, so every test still runs with no key and no network.
- **How sure: 75%.** The doubt: the claim between a cloud host and a laptop
  on a slow link, and many boxes at once for hours, which experiment 148 did
  not try. Slice 4c tests the claim.

### Slice 13 runs a tea-fabrika ticket, not a demlik one

- **What:** v1 is about fabrika starting to build itself. This repo is where
  the work happens every day, and its tickets are the best known. A miss here
  is cheap to see and fix.
- It clashes with earlier notes, which name demlik as the first real repo
  ([demlik is the first real repo](./demlik-is-the-first-real-repo.md)).
  demlik moves to right after v1.
- **There is one catch.** This repo's main has no review rule, so "merge by
  the repo's own rules" would mean merging with nobody's yes. The fix is one
  GitHub rule on main that needs a person's approval, set before slice 13.
- **Cost:** one repo rule and one line in the plan.
- **How sure: 75%.** The doubt: a lane editing the pipeline's own code. It
  works in a box on a copy, and the running app is a built copy, so it can't
  break itself mid-run. Slice 13 confirms it.

### Start slices 1, 2, 5 and 6 together

- **What:** none of them needs another. They live in different folders: the
  tracker and the pipeline facts, the agents package, a new mutation machine,
  and a new `Sandbox` service.
- **Cost:** four agents at once and $0 in model spend. They share one laptop,
  so their test runs stay light and staggered.
- **How sure: 85%.** A small doubt: 1 and 5 both add files under the
  pipeline. Different folders, so any clash would be small.

### Slice 7, the PR watcher, is the first program on the new host shape

- **What:** the owner asked for the watcher to be the first proof of one host
  shape on Durable Object alarms. That shape is the
  [PR 142](https://github.com/usirin/tea-fabrika/pull/142) draft, so slice 7
  waits on 142's first step. It goes to the cloud first, with its Miniflare
  twin on the laptop.
- **Cost:** slice 7 lands a round later than a plain timer would. Nothing
  needs it until slice 12, so v1 doesn't slip.
- **How sure: 70%.** PR 142 is still a draft with open questions. If it
  drags, a plain host timer keeps slice 12 on time, and the watcher moves onto
  the alarm later.

## One question for the owner

Merge PR 131 and PR 145 with the six changes in section 8, and start slices
1, 2, 5 and 6 today? Yes or no.

## What it cannot tell us

- Nothing is built or run yet. Every number here counts today's code. None of
  them is a measurement.
- Whether the old stage machines take a tracker ticket without big changes.
  Slice 3 shows it.
- Slice 9 has a gap. The plan's Properties aren't built, and the test writer
  can't run without them.
- The OS sandbox in slice 6 has only run in experiments, and the Cloudflare
  box in 6c only for a handful of starts in experiment 148.
- How long the mutation step takes on a real ticket, or how often its boxes
  come up. Experiments 119 to 124 ran it on only a few.
- Whether GPT sol through Codex does each stage as well as opus did. No stage
  has run on it yet; slices 9 to 11 are the first runs.
- How the window reads for a long lane with many rounds. No real lane has
  written facts yet.
- What a lane costs end to end from the app. The estimates come from scripts
  in experiments 85, 105, 107, 124 and 135, mostly on Claude.
- The dead-code count is a text search, not `code-graph`'s reachability walk,
  and may miss a name used only by a type.
