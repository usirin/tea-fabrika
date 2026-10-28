# What a ticket's view shows

**Decided 2026-10-25: sections 1, 2, 3 and 5, as written. Section 4, the
bridge, is dropped.** *Built 2026-10-26: sections 1, 2 and 5, and the ask box,
in the tracker ("Built so far", below). Section 3, the live row, is the next
pull request.* It extends
[the ticket is the lane's one view](./the-ticket-is-the-lane-view.md).
*Read by the owner the same day. Two changes: beats and logs are on the shared
record (section 3), and no bridge for today's agents (section 4).*

```ts
// A sketch. The ticket's window, top to bottom. Every line is made from facts; nothing is typed.
//
//   #3 Login fails                          waits on you: approve plan v2
//   - filed                    user:owner   On main.
//   - triage: send plan        agent:triage feature, 3 criteria
//   - build started, task 1    agent:build  open log
//   - build: send review       agent:build  2 commits, $0.41
//   - PR #12 opened            watcher      checks running
//   * review running 3m        agent:review 9 turns, last: Read     open log   (live, not a fact)
//   [ approve plan v2 ]  [ change one line ]  [ no, because … ]                (the open ask's box)
const top = headOf(ticket.timeline); // the one line at the top
const rows = ticket.timeline.map(rowOf); // one short row per fact
const live = runningOf(ticket.timeline).map(liveRow); // one row per agent still running
```

The answer in five lines:

- **The top line** says one of seven things, and an open ask always wins.
- **A lane writes about nine kinds of fact.** Each shows as one short row.
- **A running agent is one live row,** updated in place. Its tool calls are
  never rows; "open log" opens the whole log in a tile.
- **No bridge for today's agents.** The view is built for lanes our pipeline
  runs, where code writes the start and end of each agent run. Until then,
  agents post plain comments on the ticket.
- **Done is a merged pull request with every criterion met.** Code says it,
  never an agent. A person can close a ticket without it being done.

## 1. The top of a ticket

One line: where the lane is, whether it is done, and what waits on the owner.

- **The branches, checked in this order.** The first that fits is the line.
  - its pull request merged: **"done: PR #12 merged"**.
  - the ticket has a `closed` fact after its last `reopened`, and no merged
    pull request: **"closed by you"**. Not done.
  - an ask is open: **"waits on you: approve plan v2"**. Two or more:
    "waits on you: 2 asks", and each has its box.
  - an agent run started and has not ended: **"build running, task 2 of 3"**.
  - the last stage answered `stuck`, and no ask came of it:
    **"stuck: read failed"**. It also waits on the owner.
  - nothing runs, nothing is asked, and the last fact is older than an hour:
    **"idle since 14:02"**. Nobody is driving it.
  - otherwise: **"next: review"**, from the last `send`.
- **Why closed and done come first.** Today's fabrika had a lane viewer that
  sorted what needs a person first. On 2026-08-20, nine of its first ten
  "waiting on a human" rows were for issues already closed, most shipped days
  before
  ([phoenix ADR 0322](https://github.com/kamp-us/phoenix/blob/main/.decisions/0322-closed-issue-lanes-demote-at-read-time.md)).
  An ask on a finished ticket is not waiting on anyone.
- **Why "idle" is a branch.** A lane that nobody drives looks the same as a
  lane that is fine, unless the view says so.

```ts
// A sketch, in Effect Schema. The fold from a ticket's facts to its top line. Pure.
const Head = Schema.Union([
	Schema.TaggedStruct("closed", {at: Schema.Finite}),
	Schema.TaggedStruct("done", {pr: Schema.String}),
	Schema.TaggedStruct("asks", {asks: Schema.Array(AskId)}),
	Schema.TaggedStruct("running", {stage: Stage, task: Schema.NullOr(Schema.String), since: Schema.Finite}),
	Schema.TaggedStruct("stuck", {stage: Stage, why: Schema.String}),
	Schema.TaggedStruct("idle", {since: Schema.Finite}),
	Schema.TaggedStruct("next", {stage: Stage}),
]);
type Head = typeof Head.Type;

const headOf = (timeline: readonly Entry[], now: number): Head => {
	const s = timeline.reduce(step, empty); // closed, merged pr, open asks, open runs, last outcome
	if (s.merged !== null) return {_tag: "done", pr: s.merged};
	if (s.closed !== null) return {_tag: "closed", at: s.closed};
	if (s.asks.length > 0) return {_tag: "asks", asks: s.asks};
	const run = s.runs.at(-1);
	if (run !== undefined) return {_tag: "running", stage: run.stage, task: run.task, since: run.at};
	if (s.last?.outcome.kind === "stuck") return {_tag: "stuck", stage: s.last.stage, why: s.last.outcome.why};
	if (now - (timeline.at(-1)?.at ?? now) > HOUR) return {_tag: "idle", since: timeline.at(-1)?.at ?? now};
	return {_tag: "next", stage: s.last?.outcome.kind === "send" ? s.last.outcome.to : "triage"};
};
```

- **The list of tickets shows the same line,** so the owner scans one column.
  Tickets that wait on the owner sort first, as today's viewer did.
- **Why:** one line answers the three questions without opening anything. It
  is a fold, so the window and an agent's brief read the same answer.
- **Cost:** one pure function and its tests. "Idle" needs the clock, so the
  line can change with no new fact; the window reads it again each minute.
- **How sure: 80%.** The doubt is the hour for "idle". A build round can run
  longer than an hour with no fact, which is why a running agent wins over
  idle. A week of real lanes would show the right number.

## 2. The fact kinds a lane writes

The tracker writes four today: `filed`, `commented`, `closed`, `reopened`. A
lane adds these. Each shows as one short row, and the writer shows beside it.

| Fact | Written by | Its row |
|---|---|---|
| `started` | code, when it starts an agent | build started, task 2 · open log |
| `ended` | code, when the run ends | build: send review · 2 commits, $0.41, 14 turns |
| `planned` | the plan stage | plan v2 · 3 tasks · what changed |
| `pushed` | the build stage | 2 commits · `a1b2c3d` Fix login redirect |
| `reviewed` | the review stage | review at `a1b2c3d`: 2 of 3 met · 1 finding |
| `pr` | the watcher, on a change only | PR #12 · checks failed (lint) |
| `asked` | the stage that asks | asks you: approve plan v2 (and the box) |
| `answered` | a user, never an agent | you approved plan v2 |
| `rated` | a user | you rated finding f-12: noise |

```ts
// A sketch. The lane's facts, beside the tracker's four. Keys are short words.
const Run = Schema.String; // one agent run's id: "r-7"
const LaneFact = Schema.Union([
	Schema.TaggedStruct("started", {run: Run, stage: Stage, task: Schema.NullOr(TaskId), log: Schema.NullOr(Schema.String)}),
	Schema.TaggedStruct("ended", {run: Run, stage: Stage, outcome: AnyOutcome, usd: Schema.Finite, input: Schema.Int, output: Schema.Int, turns: Schema.Int}),
	Schema.TaggedStruct("planned", {version: Schema.Int, tasks: Schema.Array(TaskId)}),
	Schema.TaggedStruct("pushed", {head: Schema.String, commits: Schema.Array(Schema.Struct({sha: Schema.String, title: Schema.String}))}),
	Schema.TaggedStruct("reviewed", {head: Schema.String, met: Schema.Int, of: Schema.Int, findings: Schema.Array(Schema.String)}),
	Schema.TaggedStruct("pr", {url: Schema.String, state: Schema.Literals(["draft", "open", "merged", "closed"]), head: Schema.String, checks: Checks}),
	Schema.TaggedStruct("asked", {ask: Ask}),
	Schema.TaggedStruct("answered", {ask: AskId, answer: AnswerBody}),
	Schema.TaggedStruct("rated", {finding: Schema.String, says: Schema.Literals(["fix", "noise"])}),
]);

// One row per fact. The outcome's name comes from nameOf, so the row and the logs spell it one way.
const rowOf = (e: Entry): Row => {
	switch (e.fact._tag) {
		case "ended":
			return {by: e.by, text: `${e.fact.stage}: ${endedAs(e.fact.outcome)}`, more: `$${e.fact.usd.toFixed(2)}, ${e.fact.turns} turns`};
		case "pr":
			return {by: e.by, text: `PR ${refOf(e.fact.url)} ${e.fact.state}`, more: checksLine(e.fact.checks)};
		// ...one short line for each of the others
	}
};
```

- **Stage outcomes are the five verbs.** `ended` carries the outcome as data,
  and its row prints it with `endedAs` from
  `packages/pipeline/src/stages/status.ts`, the same words `jobs` shows:
  "sent to review", "asks owner: approval", "stuck: read failed"
  ([outcome names](./outcome-names.md)).
- **Pull request and checks take GitHub's own words.** A check's status is
  `queued`, `in_progress` or `completed`, and a completed one has a conclusion
  such as `success`, `failure`, `cancelled` or `timed_out`
  ([GitHub check runs](https://docs.github.com/en/rest/checks/runs)). The `pr`
  fact folds them into one line: "checks running", "checks passed", "checks
  failed (lint)". The watcher writes a `pr` fact only when something changed,
  as [tickets start in our tracker](./tickets-start-in-our-tracker.md) leans.
- **An ask is two facts, `asked` and `answered`.** The box shows while an
  `asked` has no `answered`. A comment is never an answer.
- **A start and an end are two facts, not one.** A run that died leaves a
  `started` with no `ended`, and the view can say so: "build started 3h ago,
  never ended". With one fact at the end, a crash would leave nothing.
  - OpenTelemetry calls the same thing an `invoke_agent` span
    ([GenAI agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md)).
    The fact holds the run id the trace uses, so one opens the other.
- **GitHub's pull request page works this way:** `committed`, `reviewed`,
  `ready_for_review`, `merged`, each a typed event on one timeline
  ([GitHub timeline events](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types)).
- **Why:** each fact is data a stage already makes. A row is a view of it,
  and nothing reads the row back ([data first](./data-first-markdown-is-a-view.md)).
- **Cost:** nine schemas, nine rows, nine short lines for the agent's brief.
  Each new fact kind costs a row in both views.
- **How sure: 75%.** The doubt: whether `planned`, `pushed` and `reviewed`
  should be their own facts, or live inside `ended` as the stage's data. Own
  facts read more simply as rows; inside `ended` there are fewer kinds. Writing
  the first lane's facts both ways would settle it.

## 3. What it is doing right now

- **The branches.**
  - an agent is running: **one live row** at the bottom of the timeline,
    updated in place: stage, how long, turns so far, the last tool's name.
    "review running 3m · 9 turns · last: Read · open log".
  - the agent asks for something mid-run (a permission, a question): the live
    row turns into **"waiting on you"**, and the top line says so too.
  - the run ends: the live row goes, and the `ended` fact is its row.
  - the run dies with no end: after its process is gone, the row says
    **"build started 14:02, never ended"**. The top line says "stuck".
- **Tool calls are never timeline rows.** They are kept, but in the agent's
  own log. "open log" opens it in a tile next to the ticket
  ([tiles, like tmux](./the-gui-is-electron-first.md)).
- **What the live row is made from.** Not facts on the ticket. A short side
  stream per run, `runs/r-7/beats`, that the ticket's fold never reads. Only
  the newest beat matters.

```ts
// A sketch. A beat is the last thing a run did. The window shows the newest one; nothing folds them.
const Beat = Schema.Struct({run: Run, at: Schema.Finite, turns: Schema.Int, tool: Schema.NullOr(Schema.String), waits: Schema.Boolean});

const liveRow = (run: Started, beat: Beat | null, now: number): Row => ({
	by: run.by,
	text: beat?.waits ? `${run.stage} waits on you` : `${run.stage} running ${minutes(now - run.at)}m`,
	more: beat === null ? "" : `${beat.turns} turns, last: ${beat.tool ?? "thinking"}`,
	open: run.log, // the agent's own log, opened in a tile
});
```

- **How others keep the timeline readable.**
  - Linear: an agent's `thought` and `action` activities can be marked
    `ephemeral`. They "are displayed temporarily, and will be replaced when the
    next activity arrives"
    ([Linear](https://linear.app/developers/agent-interaction)). The beat is
    the same idea. Linear also lets a session carry `externalUrls`, shown as an
    "Open" button.
  - GitHub Copilot coding agent: the pull request shows one "Copilot started
    work" event with "View session"
    ([GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/troubleshoot-cloud-agent);
    this wording was read in a search excerpt, not on the page). The reasoning
    and tool calls live on the session's own page, and each commit links back
    to it
    ([GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/track-copilot-sessions)).
  - GitHub Actions: a check is one row on the pull request, and its log is
    its own page, with `::group::` to fold parts of it
    ([GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands)).
  - Devin: one unified view of shell commands, edits and browser, where a
    progress update opens to show its commands
    ([Devin](https://docs.devin.ai/work-with-devin/devin-session-tools)).
  - OpenHands: every tool call is a typed event in an append-only log
    ([OpenHands](https://docs.openhands.dev/sdk/arch/events)). How its window
    folds them is unknown.
  - This repo already does it for traces: an agent run's turns and tool calls
    fold into one span, "builder · 14 turns"
    (`packages/fabrika/src/shell/trace/view.ts`).
- **Why not every tool call on the ticket.** An agent reads the timeline as
  its context. Fifty tool calls a run would bury the facts it needs, against
  "the smallest possible set of high-signal tokens"
  ([Anthropic](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
- **Cost:** a second stream per run, and the window polls it while a run is
  live. The log a tile opens is whatever the agent wrote: a Claude Code
  transcript today, our trace later. Two readers until the pipeline runs.
- **How sure: 70%.** The doubt: whether the last tool's name is enough to
  tell "working" from "going in circles". The owner watching a few live runs
  would show it.
- **Decided the same day: beats and logs are on the shared record.** The
  first version left open whether beats live only in the host's memory. In
  memory, only the machine that runs the agent sees them, and only while it
  runs. The owner needs to see what an agent does from another machine and at
  another time, and a second person works the same tickets.
  - Beats go on the ledger, in the run's own side stream. The ticket's fold
    still never reads them.
  - The agent's whole log goes to the `Blobs` service
    ([services](./services-and-our-own-ci.md)), so "open log" works from any
    machine.
  - Counting beats per run now decides only whether old beats are trimmed
    after a run ends. They are kept until then.
  - *Proposed 2026-10-27:* beats move into the lane's own record, and nothing
    in it is trimmed or deleted
    ([a LaneRecord holds each lane's trace](./a-lane-record-holds-its-trace.md)).

## 4. The bridge until our pipeline runs lanes (dropped)

**Dropped 2026-10-25, by the owner.** Adding hooks only so today's Claude Code
agents can post to the ledger is not worth it.

- The view is built for lanes our pipeline runs. There, code starts each agent,
  so code writes `started` and `ended`, and nothing has to be bridged.
- Until then, an agent on a lane posts plain comments on its ticket, through
  the tracker. The ticket shows them as comments, not as lane facts.
- What this costs: tickets of lanes run today have no live row and no
  "open log". Their top line comes from the tracker's own four facts.
- The research below is kept as it was, in case the question comes back.

Today a lane is run by plain Claude Code subagents, outside our ledger. Four
ways they could write the facts above as `agent:` writers.

| Way | What it writes | Trust | Cost |
|---|---|---|---|
| A. Claude Code hooks | `started`, `ended`, beats | high for "a run started and ended"; none for what the run decided | a small command, a hooks file |
| B. The main session writes | stage answers, asks, plan, review | as good as the agent's memory | a line in each skill; misses on a crash |
| C. Read transcripts after | anything in the transcript | high for what happened; format is not public | a watcher on a format that can change |
| D. Claude Code's OpenTelemetry | tool calls, tokens, cost | high for cost and tools; knows no ticket | a collector on the host |

- **The hooks exist.** Claude Code's hooks include `SubagentStart` ("When a
  subagent is spawned"), `SubagentStop` and `PostToolUse`
  ([Claude Code hooks](https://code.claude.com/docs/en/hooks)).
  - Every hook gets `session_id`, `agent_id` and `agent_type`.
  - `SubagentStop` adds `agent_transcript_path`, the subagent's own log, and
    `last_assistant_message`. That path is what "open log" opens. Tuval read
    the same files for its subagent view
    (`packages/tuval-claude/src/agent/sidechain-store.ts` in
    [kamp-us/phoenix](https://github.com/kamp-us/phoenix)).
  - `PostToolUse` adds `tool_name` and `tool_response`: enough for a beat.
  - "Command hooks execute shell commands with your full user permissions."
- **Claude Code exports OpenTelemetry** when `CLAUDE_CODE_ENABLE_TELEMETRY=1`
  is set: events such as `claude_code.tool_result` and
  `claude_code.api_request`, and cost and token metrics
  ([Claude Code monitoring](https://code.claude.com/docs/en/monitoring-usage)).

- **The lean: A plus B, and the watcher for pull requests.**
  - Hooks write what the harness knows for sure: a run started, a run ended,
    its log, and beats. The model cannot skip them, because the harness fires
    them, not the model.
  - The main session writes what only it knows: the stage's answer in the five
    verbs, the plan, the review, an ask. One command, the same for every
    skill.
  - The `pr` fact comes from the watcher, never from an agent. A check's
    color is GitHub's word, not the agent's.
  - The ticket a run belongs to: the main session writes a `bound` fact
    (`{session, ticket}`) when it takes the lane, and the hook command looks
    the session up. A session not bound writes nothing.

```ts
// A sketch. The one command both a hook and the main session call. It talks to the host over its
// socket, through the Ledger service; it never writes a file of its own.
//   SubagentStart  ->  fabrika fact started  --session $session_id --agent $agent_id --stage build
//   SubagentStop   ->  fabrika fact ended    --session $session_id --agent $agent_id --log $agent_transcript_path
//   PostToolUse    ->  fabrika beat          --session $session_id --agent $agent_id --tool $tool_name
//   main session   ->  fabrika fact outcome  --ticket 3 --stage build --outcome send:review:built
const Bridged = Schema.Union([Started, Ended, Beat, Planned, Pushed, Reviewed, Asked, Commented]);
// Not in the list, on purpose: answered, rated, closed, reopened, filed. Those are a user's.
const write = (writer: Writer, fact: unknown) =>
	writer.kind === "agent" ? Schema.decodeUnknown(Bridged)(fact).pipe(Effect.flatMap(ledger.append)) : Effect.fail("not_an_agent");
```

- **What it can be trusted for, said plainly.**
  - Hooks run with the user's own rights, and today's subagents have a shell
    on the same machine. An agent could call the same command and write a
    false `ended: done`. So a bridge fact is an agent's claim, shown as one.
  - What keeps it from being worse: the bridge takes only agent writers and
    only the kinds above. It never takes `answered`. An agent cannot close an
    ask or say a ticket is done through it.
  - That still rests on the agent not reaching the host's socket another way.
    When this was written, the ledger took the writer the caller named
    (`packages/fabrika/src/host/writer.ts`). *Fixed later the same day:* the
    door now stamps the writer from a checked credential, and only a person's
    session may write `answered` (`PERSON_KINDS` in
    `packages/fabrika/src/host/door.ts`). Today's fabrika still has the hole:
    its agents act on GitHub with the owner's own login.
- **Why not B alone:** [`field/README.md`](../../field/README.md) already
  notes an agent-written row that says `minutes: 0` on every run, so the
  minutes are measured by hand. A step an agent must
  remember is a step it sometimes forgets, and a crash writes nothing.
- **Why not C:** the transcript's shape is Claude Code's own and is not
  promised to stay. It is fine to open in a tile; it is a weak thing to fold.
- **Why not D now:** it knows no ticket, and needs a collector. It is the
  better source of cost later, once a run carries the ticket as a resource
  attribute.
- **Cost:** one command, about six hook lines in the lane's project settings,
  and one line per skill for the outcome. Hooks only run in a trusted folder
  when a session is interactive; `-p` and SDK sessions run them.
- **How sure: 75%.** The doubts:
  - `SubagentStart` gets no prompt, so the hook cannot tell which stage the
    subagent is. `agent_type` (builder, reviewer) may be enough; a first lane
    would show it.
  - whether binding a session to a ticket holds when one session drives two
    lanes at once. Trying two lanes in one session would show it.

## 5. What "done" means, and who can say it

- **The branches.**
  - the ticket's pull request merged: **done**. Every criterion was met at
    its head, or ship would not have merged it
    ([done is per criterion](./done-is-per-criterion.md)). Code reads it off
    the `pr` fact the watcher wrote from GitHub.
  - the ticket needs no code (a decision, a ruling): **done** when the owner
    answers its last ask and closes it. The `closed` fact is a user's.
  - an agent says it is done, and nothing merged: **not done.** The row says
    "build: done" and the top line still says where the lane is. An agent's
    word is never the ticket's state.
  - a user closes it before anything merged: **"closed by you"**, not done.
    Won't do, duplicate, or moved.
  - triage thinks it is a duplicate: it **asks**. The owner's approval closes it.
  - a user reopens a done ticket: open again, and a new lane starts. The old
    pull request stays in the timeline.
- **Who can say it.** Nobody writes "done". It is a fold of two facts only
  code or a user writes: a merge, read from GitHub, or a user's close.
  - It fits the rule that only a user's answer closes an ask: an agent
    cannot close a ticket, answer its box or merge.
  - It fits [done is per criterion](./done-is-per-criterion.md): "a ticket
    never stays open after its PR merges".
- **Why:** the owner wants one place to check "is it done?". If an agent could
  write done, the owner would have to check the agent.
- **Cost:** the merge must reach the ticket. Until the watcher runs, a merged
  ticket stays open until the owner closes it.
  GitHub closes an issue on merge from a `Closes #N` line; here the watcher
  does the same work.
- **How sure: 85%.** The doubt is a plan that covers many tickets. Each of
  them is done when the one pull request merges, which matches
  `LaneView.tickets` in `packages/pipeline/src/stages/lane/view.ts`, but no
  lane has run that way yet.

## Built so far (2026-10-26)

The first slice is in `programs/tracker`. Nothing runs lanes yet, so every
lane fact on a ticket today comes from a test.

```ts
// programs/tracker/src/head.ts. The top line, pure, at the clock's last tick.
headOf(timeline, now); // {_tag: "asks", asks: [{ask: "a-1", what: "approve plan v2", picks: [...], ...}]}
lineOf(head, when); // "waits on you: approve plan v2"

// What the window sends when the owner clicks a pick in the ask's box.
{kind: "answer", ticket: 3, ask: "a-1", pick: "approve", note: ""}
// tracker/ticket/3/inbox gets {type: "answered", ask: "a-1", pick: "approve", note: ""} by user:owner
```

- **Section 2: the nine fact kinds** are in the ticket's `Fact` union
  (`src/ticket.ts`), with the fields above.
  - They keep the tracker's `type` key, not Effect's `_tag`, so the rows
    already on a ledger still read. `Head` is not stored, so it uses `_tag`.
  - `asked` is flattened to `{ask, what, picks}`; `answered` is
    `{ask, pick, note}`. The pipeline's own `Ask` is richer; mapping it to
    these is for the pipeline lane that writes them.
  - The fold refuses a fact that does not fit: an answer to an ask never asked,
    a second answer, a pick the ask did not offer, a run ended twice or never
    started.
- **Only a person writes `answered`,** held three times. The `WRITTEN_BY`
  table marks it `person`, which compiles only because the door refuses that
  kind from an agent (`PERSON_KINDS`). The tracker's save refuses it when its
  `Author` is an agent, for a ledger with no door. The fold keeps an agent's
  `answered` out of every ticket.
- **Section 1: the top line** is `headOf` in `src/head.ts`, in the decided
  order. Its laws (`src/head.laws.test.ts`, fast-check over random fact lists
  folded by the real fold) hold: an open ask always wins on an unfinished
  ticket; done only from a merge or a person's close; a comment never closes
  an ask; a run wins over idle; time moves the line only from next to idle.
  A planted swap of asks and running is caught.
  - The clock is a Sub, as Elm's `Time.every`: `tick` once a minute puts the
    time in the machine's state, so the view stays a pure function of it.
  - The list shows each ticket's line too. It does not yet sort the tickets
    that wait on the owner first.
- **The ask box.** While an `asked` has no `answered`, the ticket's page shows
  it with one button per pick and a note. A click sends `answer`. A comment is
  never an answer, and a test checks a comment that says "approve" leaves the
  box open.
- **Section 5: done** is read off a `pr` fact that says merged after the last
  reopen, or a person's close once every ask was answered (the no-code case).
  Any other close reads "closed by owner", or "closed by agent triage": the
  line names who closed, because the door still lets an agent write `closed`.
- **Rows** are made on the host (`src/rows.ts`), with the pipeline's
  `endedAs` for an outcome, so the window draws words and never imports the
  pipeline.

Left for the next pull request: section 3, the live row from beats, beats on
the ledger, the log in `Blobs`, and "never ended" for a run whose process is
gone.

## Still open

- How the window groups rows once a lane has many rounds: by task, by round,
  or folded like a GitHub Actions group.
- Whether a beat names a file ("last: Edit login.ts") or only the tool. A
  path says more and can leak more.
- How long "never ended" waits before it says so. The host knows when a
  process is gone.

## What it cannot tell us

- Sections 1, 2 and 5 are built, but no real lane has written a fact yet.
  Every lane fact the tracker has shown came from a test. Whether the rows read
  well on a long lane is unknown.
- The hour for "idle" is still a guess, now in code (`HOUR` in
  `programs/tracker/src/head.ts`).
- Done for a ticket with no code (a person's close once its asks are answered)
  is a reading of section 5, not a tested one. A duplicate closed after a
  "yes, it is one" also reads "done". A week of real tickets would show
  whether that is wrong.
- `closed` and `rated` are still "anyone" at the door. Section 5 says a close
  is a person's; the line names who closed until the door knows that kind.
- The window's ask box was typechecked, not clicked: no test draws it.
- No product's behaviour was tried by hand. Each claim above is what its
  public docs say. Unknown from the docs: how Linear draws activities inside
  an issue, how Cursor, Factory and Amp fold tool calls, and the exact draft
  pull request behaviour of Copilot's agent.
- The OpenTelemetry GenAI names are marked Development, so they may change.
- The hook fields are from Claude Code's docs today. Their shape has changed
  before and may again.
