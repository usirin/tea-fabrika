# dsh-superagent against tea-fabrika

Read 2026-10-31, at commit
[`6337fc8`](https://github.com/deepseek-ai/dsh-superagent-prototype/tree/6337fc823ce20251c8de8085948165c81aaa701e)
of the outside repo, and at `587059c` of our `main`. A study by reading only: nothing was
installed or run, and no model was called. Written up 2026-11-01, with every claim about our
repo checked again against `main` at `92740b7`, 27 commits later. Where `main` moved, the
text says so.

## The answer

**dsh-superagent is a narrower neighbor, not a rival. It is an agent teammate for one
GitHub repo. Code decides who may ask for work, and prompts run the work itself.**

- **They look right** on two things we have not designed well: treating a person's
  attention as a cost, and handling what people say after the work is out.
- **We look right** on checking a job and on keeping a bad text from doing harm. Their own
  docs say the agent has full access and that the wrappers are no security boundary.
- **The best single idea to take:** count a person's attention the way we count money. Our
  triage decision accepts about 130 to 190 asks a week with no budget yet. Their whole
  design exists to stop that.

```ts
// A sketch of the two shapes, on one small request.
// Theirs: code guards the door, then one agent carries the job to the end.
//   event -> gate (code) -> router agent -> Ticket + Mandate (code) -> one worker agent
//         worker: read, plan, build, test, self-review, push, PR, fix CI, answer reviews
//         code only records what the worker reports: {state: "ready", summary: "..."}
//
// Ours (today's version): code holds every step, and each agent does one bounded job.
//   ticket -> triage -> plan -> (owner yes) -> test writer -> build -> mutation
//          -> review -> push -> merge
//         each arrow is a machine's choice, and pass or fail is worked out by code
```

**A note on our two versions.** `next/` is not on `main` yet. It lives on the branch of
[PR 223](https://github.com/usirin/tea-fabrika/pull/223), still open and paused since
2026-10-31: 33 TypeScript files, whose program is a counter. It has no agents and no
pipeline yet. The Tier 1 plan for `next/` was approved on 2026-11-01 and is not started. So
below, "next" mostly means what `docs/direction` decided, and I say so. "Today's" means the
workspace packages. The study counted about 16,800 lines of stage code in
`packages/pipeline/src/stages` alone. On `92740b7` that folder holds about 23,600 lines
without its tests, most of the growth from pipeline v0
([PR 259](https://github.com/usirin/tea-fabrika/pull/259)), which landed after the study's
commit.

## 1. What is it?

A proactive coding agent for one GitHub repo, shipped as a plugin bundle for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), which supplies the
sessions, tools, jobs, compaction and web shell.

- **What it does.** It listens to GitHub and, if switched on, Feishu chats. Someone allowed
  asks for work. It opens a Ticket and works in its own session and folder. It answers in
  the same conversation, often with a pull request. A local web panel shows what needs a
  person.
- **What it says it solves.** An agent that acts for a team can waste the team's attention.
  It should act only when asked or when a written rule allows, and speak only when it must.
- **How far along.** A research prototype, by its own
  [README](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/README.md):
  it "may still contain bugs", and it differs from their internal version. One squashed
  commit, published the day it was read. 3,233 stars that day, which proves nothing yet.

| Part | Lines |
|---|---|
| `src/core` (the rules, no I/O) | 2,088 |
| `src/app`, `src/executor`, `src/sources`, `src/infra`, top level | about 9,080 |
| `src/client` (the panel) | 4,419 |
| `tests` (about 800 test cases by a rough search) | 14,960 |
| `prompts` and `skills` | 464 |
| `docs` | 1,973 |

**Real code versus doc.** The docs are unusually honest. I checked these by reading the code,
not by running it:

- **True in code:**
  - `src/core` has no I/O, no `async` and no Promise. Its only outside import is `node:crypto`,
    as the docs say.
  - The default accept mode is `observe`. A positive assessment outside `auto` becomes an
    ignore marked `would_accept` ([policy.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/policy.ts#L55-L58)).
  - The Engine rechecks an inferred accept against today's Policy
    ([evals.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/core/evals.ts#L152)).
  - Every session gets `danger-full-access`
    ([sessions.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/sessions.ts#L152)).
  - The guard against the router waiting exists, though it is a regular expression over the
    command text
    ([sessions.ts](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/sessions.ts#L69-L81)).
- **Only a prompt, and the docs mostly say so:**
  - Merging: "The host has no merge-specific decision logic"
    ([003](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/003-execution.md#L84)).
  - The router staying out of the code: "a prompt rule, not a tool restriction"
    ([007](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/007-architecture.md#L507)).
  - Testing, self-review and honest reports. "Stops by impact, not by effort" is also prompt
    text.
- **Not there:** some ideas in the article the README names. A trust model is listed as an
  [open question](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/007-architecture.md#L616-L617).
  Nothing deletes old records
  ([007](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/007-architecture.md#L484)).

**A size warning.** 15,000 lines of source looks small next to our 162,000 lines of
TypeScript, tests included, as the study counted them at `587059c`. On `92740b7` the
workspace packages (`packages`, `programs`, `packs`, `apps`, `wip`, `legacy`) hold about
217,000 lines of TypeScript with their tests. The study did not keep how it counted, so the
two numbers may not cover the same files. But the harness underneath does much of what our packages
do. The two numbers do not compare.

## 2. What does its philosophy say?

From [docs/000-philosophy.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/000-philosophy.md):

- **The core:** "Take as little human attention as possible, and give as much value as
  possible."
- **The test for everything:** "Every part of the project is judged by the attention it
  costs."
- **Acting:** "It acts only when asked, or when a written rule allows it."
- **Speaking:** "It speaks only when a person must act or can use a result."
- **Asking:** "It asks one concrete question at a time"
- **Stopping:** "It stops by impact, not by effort."
- **Noise:** "Do not add more messages to explain the noise."
- **Design:** "A business need becomes an attribute of one of them, or a prompt the agent
  follows."
- **The goal:** "The goal is the right help at the right time, and nothing at any other
  time."

Note what is missing. It says nothing about checking the agent's work, or about what the
agent could do if a text steers it. The philosophy is about attention, not about trust in
the worker.

## 3. Where do they differ from us?

| Topic | Who looks right | How sure |
|---|---|---|
| Who holds the loop | Us for the job; a tie at the door | 80% |
| How a job gets checked | Us | 90% |
| State and logs | Us for a team; them on some facts they record | 75% |
| Sandboxing and permissions | Us | 90% |
| Spawning and talking | Split: us on separation, them on follow-ups | 65% |
| The human's part | Them | 80% |
| UI or a shell | Can't compare; their three questions are worth taking | 60% |
| What the model is trusted with | Us, though we agree on authority | 85% |

### Who holds the loop

- **They:** a split.
  - Code holds the life of a work item: the [Engine](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/007-architecture.md#L46-L48), a two-second pass, a stored queue of outward work.
  - A long-lived model, the "main Session", routes every candidate.
  - One worker model holds the whole job: "investigation, implementation, relevant checks,
    self-review, commit, push and PR creation"
    ([work.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/prompts/work.md)).
- **We (today's):** code holds every step and each agent does one bounded job
  ([control lives in code](../docs/direction/control-in-code.md)). `next/` plans the same,
  and has built none of it yet.
- **Who looks right: us on the job.**
  - Their prompts show why. The delivery prompt tells the worker to run a long
    `git filter-branch` command to credit reviewers
    ([delivery.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/prompts/team/delivery.md#L19)).
    That is a fixed step written as prose, the exact case our note warns of.
  - Experiment 49 measured the other side: one real lane with 22 Cmds, and no tokens for the
    machine itself.
- **At the door, a tie.** Code decides who may ask and a model judges what they mean. That
  is our Check and Judge moves, built by someone else. Their judging model is huge, though:
  the test allows up to 59,000 characters of prompt and tools. A narrow question would cost
  less.

### How a job gets checked

- **They:**
  - The worker checks itself and then reports. `orchestrator_report` takes a
    [state and a summary](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/tools/executor.ts#L76-L85).
    Code checks the shape and the pull request's ownership, not the claim.
  - CI and reviews come back as messages to the same worker.
  - The real guard is the team's branch protection and people.
  - The docs admit it: "These instructions govern the agent, not GitHub's merge rules."
- **We:**
  - Today's: review is a separate agent, a finding must quote a real line, and code works
    out the verdict ([nobody grades their own work](../docs/direction/nobody-grades-their-own-work.md)).
    Seven law test files sat in the stage folders at `587059c`; on `92740b7` there are 11,
    after pipeline v0 added laws for the lane, the exam, push and the test writer. A test
    writer and a mutation step exist in the same tree.
  - `next/` adds the rule that the builder starts only after tests exist
    ([the steps](../docs/direction/next-is-a-pipeline-pre-run.md)).
- **Who looks right: us.** A worker that grades itself has every reason to pass. Their setup
  can work because it stays small and people review every pull request, so it does not free
  much review time.
- **The honest cost on our side:** a small change takes several agents. Our own note names
  this, sized at 2 to 4 agent hours for one rewrite, 50% sure.
- **One thing they check and we may not:**
  [`model-surface.spec.ts`](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/tests/model-surface.spec.ts#L36-L40)
  tests everything a model reads against the real tool schemas and the glossary, under a
  size budget per role. They check the exam paper, even with no examiner.

### State and logs

- **They:**
  - [One SQLite file](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/007-architecture.md#L452), one process, a folder lock.
  - A Trigger never changes. A Ticket is a JSON record that is saved over itself.
  - State changes and their outward work are stored in one transaction, and done after
    commit.
  - [One writer per kind of state](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/007-architecture.md#L259-L271).
- **We:** today's version has an append-only ledger behind one service, kept in SQLite. The
  decided direction for `next/` has signed writers, leases, and a referee
  ([the five layers](../docs/direction/a-local-first-sync-engine.md)).
- **Who looks right: us for several people and machines.** A row saved over itself loses its
  history, and one lock on one disk cannot be a team's referee.
- **Them on simplicity.** For one repo on one box, their answer is enough and has none of
  our moving parts. This is the sharpest question they put to our direction: how much of the
  five layers do two people need in the first year? I can't answer that from here.
- **Them on some write-time facts.** They record things that are lost forever if not written
  at the time:
  - each incoming event's fate (the `disposition` table);
  - which prompt revision each session used;
  - the Policy version and the basis of every Mandate.

  That is our own "data shape first" rule, applied well.

### Sandboxing and permissions

- **They:** nothing holds. Both roles run as the operator's OS user with full access and no
  approval.
  - "A worker can execute programs by path and read the operator's home directory"
    ([006](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/006-deployment.md#L19)).
  - "These wrappers and directories establish defaults, not a security boundary"
    ([003](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/003-execution.md#L80)).
  - The worker reads outside text, can read the operator's home directory, and can push. By the
    Rule of Two our notes cite, that is all three at once. The defense against steering is a
    prompt line.
  - Their advice is a dedicated OS account.
- **We (the decided direction; how much of today's version runs this way is a doubt below):**
  [programs run in a box](../docs/direction/programs-run-in-a-box.md). The GitHub key
  stays outside, Cmds cross the wall, and nothing is pushed before review.
- **Who looks right: us, clearly.** Their permissions are the known weak spot, and they say
  so.
- **Two doubts about us.**
  - That note later put the model login inside the box, and the cloud box has open internet.
    So a steered agent could still reach the model account. We are better, not clean.
  - I did not confirm that every live lane in today's version runs boxed.
- **Where they are ahead:** they say plainly who may start work.
  - Their Mandate records who asked, how, under which Policy version, and what scope was
    granted.
  - Before an ended Ticket resumes, it is
    [checked again](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/002-authorization.md#L131-L139).
  - We have a simpler answer: only ledger members write tickets, and an approval covers the
    text it saw ([tickets start in our tracker](../docs/direction/tickets-start-in-our-tracker.md)).
    Simpler is better here, as long as a stranger's text cannot reach an agent another way.
  - It can, in one place. Today's ship rule sends a bot's comment back to the builder
    (`send:builder:bot_comment` in `packages/pipeline/src/stages/ship/gate.ts`, still there on
    `92740b7`). I did not trace how the text reaches the agent, so check it.

### Spawning and talking

- **They:**
  - One long-lived router and one long-lived session per Ticket, kept even after the Ticket
    ends.
  - Workers never talk to each other. The router may pass a fact in a note of at most 100
    words.
  - A person's comment goes to the worker that did the work, which either handles it or
    [hands it back](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/002-authorization.md#L28-L34).
  - A message reaches a running worker at its next step. To make that fast, a foreground
    shell command moves to the background after
    [5 seconds](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/cordis.patch.yml#L44-L50).
  - One spare worker slot is
    [kept for a person's message](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/003-execution.md#L59).
- **We (today's, and the plan for `next/`):** a fresh agent per stage with a small brief, and each stage reads the facts for
  itself ([read fresh, run alone](../docs/direction/read-fresh-run-alone.md)). On a person's
  comment at ship, today's machine stops and asks that person
  (`ask:commenter:comment` in the same `gate.ts`).
- **Who looks right: split.**
  - Fresh agents keep builder and reviewer apart, and are cheap and easy to audit. Keep them.
  - But their follow-up model looks better than ours. A person says "also fix the label". They
    get an answer from the agent that knows the work. We ask the person who just spoke, which
    is the waste their philosophy names.
  - We do not know the cost of their way. A long session grows and compacts.
- **Doubt:** 65%. Ours may be fine for two people who rarely comment. Test 1 below settles it.

### The human's part

- **They:** attention is the budget.
  - One acknowledgement, then silence until a result, a decision or a stop.
  - One question at a time, in a [structured field](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/app/tools/executor.ts#L80), asked where the person wrote.
  - A hard limit of 100 words for chat, [in code](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/src/infra/text.ts#L12).
  - People merge by default. Unprompted work starts as a record of what the agent would have
    done.
- **We:**
  - The owner approves a plan's Properties and changes to the exam, and says yes before merge.
  - We ask for decisions, never facts ([that note](../docs/direction/ask-for-decisions-not-facts.md)).
  - [Triage asks when worth is unclear](../docs/direction/triage-asks-when-worth-is-unclear.md):
    about 130 to 190 asks a week, with no budget set.
  - [One way to ask](../docs/direction/one-ask-and-one-meter.md) (proposed) keeps a hash of what
    the person saw, which is better data than theirs. But it meters money, not attention.
- **Who looks right: them, on the idea.** We count every dollar and no minute of a person's
  day, yet the person is the scarcer of the two.
- **Where we should not copy them.** "When intent remains uncertain, ignore quietly"
  ([admission.md](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/prompts/admission.md))
  suits chatter in a team chat. It does not suit a ticket someone filed. Our owner also
  decides what gets built, which their team does not ask of anyone.

### How UI or a shell fits

- **They:** one [panel](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/005-panel.md) inside the harness's web app, on loopback only. Work starts where people already talk: GitHub and Feishu. There is no shell of their own. A person can step into a worker's session directly.
- **We:** today's is an Electron app with programs and `tsh`. The decided direction is tiles,
  windows that mirror one view, and a browser as a client from day one.
- **Who looks right: I can't compare.** We are building a place to work and they are building
  a thing to supervise.
- **Worth taking:** their test. Opening the panel answers "Does anything need me now?", then
  "Is the system healthy", then the history of one piece of work. Also: "A count equals the
  length of the list it links to."
- **A real choice to keep open.** They meet people where they talk. We bring tickets into our
  tracker. Ours is safer against strangers. Theirs costs a person less to start.

### What the model is trusted with

- **They:**
  - Not with authority. "Editing a part changes the instructions the model receives. It does
    not change the gate, Mandates, tool checks or account wrappers"
    ([004](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/004-prompts.md#L36)).
    A worker cannot even declare that a person asked it to stop.
  - But with everything else: scope, the approach, testing, honesty, judging its own readiness.
    With a merge CLI named, it also judges the auto-merge rules, such as
    [under 200 lines](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/prompts/team/delivery.md#L12).
- **We:** agents write, Jev answers narrow questions, code decides. No agent approves.
- **Who looks right: us for unattended work.** If a person reads every pull request, theirs is
  a fair trade and far cheaper to build.

## 4. Where do they agree with us without knowing it?

This is the best evidence in the study. A separate team, on another stack, landed in the same
places.

- **Authority lives in code, not prompts.** Same as
  [make the mistake impossible](../docs/direction/make-the-mistake-impossible.md).
- **Who waits for what is the main view.** "A label says whom a row waits for and what it needs."
  That is [every wait is a queue](../docs/direction/every-wait-is-a-queue.md), nearly word for word.
- **State comes from facts.** `ticketStage` works out a stage from stored reports, and nothing
  sets it by hand. Same as [the ticket is the lane's view](../docs/direction/the-ticket-is-the-lane-view.md).
- **The rules are pure, and I/O sits behind ports.** A state change and its outward work commit
  together, and the outward work runs afterward. That is Elm's update returning a model and
  Cmds, made durable. I did not check whether `next/` stores its Cmds in the same transaction.
  Worth a look.
- **The same tests on memory and on SQLite.** Like our one law suite against every runtime.
- **The agent sits behind one port, and the ticket keeps its own state.** "Defines its own state
  instead of following the Executor's." Same as
  [agents sit behind one service](../docs/direction/agents-behind-one-service.md).
- **One structured question, for a decision.** Same as our ask notes.
- **The agent does not merge its own work, and never approves for someone.** Same as our live
  run rules.
- **A restart checks before repeating an outside action.** Their recovery note says to check the
  directory, git and GitHub first. Same idea as read fresh.
- **Docs that are tested.** Their `docs.spec.ts` checks links and order. Our tutorials typecheck.
- **Few concepts, with rejected ones written down.** Their
  [rejected concepts table](https://github.com/deepseek-ai/dsh-superagent-prototype/blob/6337fc823ce20251c8de8085948165c81aaa701e/docs/001-domain.md#L45-L61)
  does what our "guesses stay in the record" does.

**How much weight to give this:** moderate. Good engineers reach for these patterns anyway. It
says the shape is common, not that it works at our scale.

## 5. What should we steal, test and leave?

Line counts and hours are my estimates. None has been tried.

### Steal

1. **Attention as a counted cost.**
   - What: one view per merged ticket: asks, messages a person got, and time from ask to answer.
     Add a budget to the triage ask decision. Add one rule: a design that asks a person says what
     it costs them per week.
   - Why: we chose 130 to 190 asks a week with no budget, and nothing tells us if it is too many.
   - Cost: 80 to 120 lines over the ask facts, about 1 agent hour. The note's rule is free.
   - **How sure: 85%.**
2. **A test of everything an agent reads.**
   - What: each brief and tool description is checked against the real tool schemas and the
     words of the repo, with a size budget per stage. Raising a budget needs a reason.
   - Why: briefs drift, and each extra character is paid on every call. A quick search found no
     such test on our side, so check first.
   - Cost: 150 to 250 lines, 2 to 3 agent hours, in a pull request of its own since it is exam.
   - **How sure: 85%.**
3. **Two write-time facts.**
   - What: each incoming event records its fate, and each agent run records the exact brief it
     ran under. At `587059c` the study found a prompt version only for experiments, not lane
     runs. **Half done since, in today's version:** pipeline v0
     ([PR 259](https://github.com/usirin/tea-fabrika/pull/259)) writes each step's brief name
     and hash on the run's `started` fact (`packages/pipeline/src/stages/pipeline/briefs.ts`).
     A quick search on `92740b7` found no record of an incoming event's fate.
   - Why: nothing can bring these back later. Our own rule says record them now.
   - Cost: 40 to 80 lines, about 1 agent hour, for both; less now that the brief half is in.
   - **How sure: 85%.**
4. **Observe mode as the rule for new automatic acts.**
   - What: before a stage may act on its own, it runs live and records `would: {...}` beside what
     people really did. A person reads those records and then switches it on.
   - Why: `replay/` tests old tickets. This tests today's traffic, at no risk. Triage closing
     tickets by itself is the first use.
   - Cost: 30 to 60 lines per stage, under 1 agent hour each.
   - **How sure: 80%.**
5. **A spare slot for a person's message.**
   - What: a rule in the queue design now, code when hands have a real queue.
   - Why: new work must never block someone correcting running work.
     [Every wait is a queue](../docs/direction/every-wait-is-a-queue.md) still has "how many at
     once" open.
   - Cost: 30 to 60 lines, under 1 agent hour, once the queue exists.
   - **How sure: 80%.**

### Test by experiment

1. **Who answers a person's comment on a pull request?**
   - Compare, on real demlik comments: (A) the same session that built it, resumed; (B) a fresh
     agent with the ticket's timeline; (C) today's stop and ask.
   - Measure: right action (fix, hand back or ignore), tokens, dollars, and asks to a person.
   - Why: this is the largest place they may be right and we wrong.
   - Cost: 300 to 400 lines, 3 to 5 agent hours, about $5 to $15 at list price.
   - **How sure the test is worth it: 75%.** My lean is B, at 55%. The doubt: A needs real session
     history, so each case must rebuild the work first. A pilot of 5 cases settles if that is
     affordable.
2. **Can a message reach a running agent at its next step?**
   - Try their 5-second rule on our Claude and Codex adapters: long commands go to the background,
     and new input lands at the next step. Measure how long a message waits. Experiment 43 already
     has a feedback mode to start from.
   - Why: it decides if a person can correct a running build, or must wait and pay for a rerun.
   - Cost: 150 to 250 lines, about 2 agent hours, about $2.
   - **How sure: 60%.** The doubts: whether both adapters allow it, and whether a person would
     actually use it. Field notes on how often someone wanted to interrupt would settle the second.
3. **What happens to triage under a hard ask cap?**
   - Re-score experiment 163 part 5 with a cap, say 30 asks a week, and see how wrong keeps move.
   - Why: it puts a real number on Steal 1 before anyone sets a budget.
   - Cost: about 100 lines, about 1 agent hour, $0 if the saved answers are enough.
   - **How sure: 70%.** The doubt: the saved results may not rank tickets in a way a cap can use.
     I saw only their top-level shape. Reading `results/163-fewer-asks.json` settles it.

### Leave

Leaving costs no lines and no hours.

- **Full access for agents that read outside text.** Why: the design note's bad-ticket test is lost
  outright. **95%.**
- **Merge rules and git rewrites in prompts.** Why: fixed steps belong in code, and this is the note
  we started from. **95%.**
- **A long-lived model as the router.** Why: in our tracker, tickets are already structured, and a
  narrow question is far cheaper than a 59,000-character role. **80%.**
- **A record saved over itself, under one process lock.** Why: it cannot grow past one machine, and
  it loses history. **85%.**
- **Building on one harness's plugin system.** Why: our agents sit behind our own service so that
  harnesses can swap. **85%.**
- **Proactive work from chat, for now.** Why: it is their riskiest path and we have no such traffic.
  **75%.** The doubt: "fix this" on a pull request could be a daily habit for two people. Counting
  such comments on demlik would settle it, and test 1 collects that count.

## 6. What this cannot tell us

- **Whether it works.** I ran nothing, by design: no install, no tests, no live run. All I know of its
  behavior comes from reading.
- **How well it does on real work.** The repo has no field data: no success rates, no costs, no
  counts of noise. I also found no per-ticket dollar record in the code, so their cost is unknown.
- **Why things are as they are.** One squashed commit hides the history, the failures and the
  reversals. Those are what I would most want to read.
- **What their real version does.** The public code differs from the internal one by its own
  statement.
- **The article.** I did not read *Exploring Super-agent Design*. I found only reposts, not an
  original, and did not rely on them.

What I did not read in full:

- `docs/006-deployment.md` and `docs/008-cookbook.md`: headings and the parts on permissions only.
  The cookbook is a how-to for adding a Source. `SETUP.md`: its first part.
- Most of `src/app`, `src/sources` and `src/client`: read by searching, and by the docs' map.
- Of the tests, only the opening of `tests/model-surface.spec.ts` and `tests/docs.spec.ts`.
- DeepSeek Harness itself: one permission doc and one search, at
  [`ce7073d`](https://github.com/deepseek-ai/deepseek-harness/tree/ce7073d51254c26cd63b22a60835b8f948deb447).
  So I believe, but did not prove, that the worker's `send_message` only reaches its own subagents,
  as the docs imply. The tool comes from the harness's subagent-control package.
- I did not trace that every Engine command queues its work in the same transaction. I read the doc
  and parts of the store.

On our side:

- I read the notes named in the brief and parts of about ten others. I did not read
  `the-ledger-goes-to-cloudflare.md`, `the-cloud-is-one-more-host.md` or
  `a-ticket-runs-from-the-app.md` in full.
- I did not read the experiment write-ups behind the index rows I cite (43, 49, 163).
- For `next/`, I read a file list, its README's opening and the size of a few files on PR 223's branch.
- The write-up checked counts, paths and named rules against `92740b7`. It did not reread every
  note it cites, so a note changed in those 27 commits may say more than this text does.
- The study's own agent hours and dollars were not recorded.
- My "who looks right" calls are judgment from design, not measurement. Neither system has been run
  against the other on the same ticket. That would be the real comparison, and it would need the
  harness set up on a throwaway repo.
