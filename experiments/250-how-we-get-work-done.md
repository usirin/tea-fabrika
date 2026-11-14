---
date: "2026-11-10"
scripts: "none"
summary: "Reading, not a measurement; today's version as evidence, for `next/`'s pipeline (decision 0059). Redone on the teams that build coding agents and use them (Anthropic, OpenAI, Google, Cursor, Cognition), checked against Stripe, StrongDM, Ramp, single builders and METR, after the owner turned down the first draft's human-team lens (0059's ticket 645 amendment); that reading stays as background. Agents write most of the code at the labs (company claims), a person's attention is the scarce thing, reading moved to machines with people placed by risk (the biggest split), every miss becomes a check the same day, and the plumbing breaks next. Here, 236 step runs over 24 tickets on 11-09 and 11-10: 50% done, 22% sent back, 22% stuck; 16 of the test writer's 31 stuck runs were the tools' `fetch_failed`; no step asked the owner, and nothing records the owner's time. Ticket 574: about 100 minutes and $19.47, $8.81 on rounds that stalled. The draft's six principles tested, and seven proposed (F1 to F7); its path-based risk tier was wrong by experiment 252. No model, $0."
---

# 250. How do we get work done, before any pipeline?

Read 2026-11-10. **This is reading, not a measurement.** It is the study that decision
[0059](../.decisions/0059-pipeline-starts-from-the-work.md) asks for, in the five parts its first
amendment names, and it builds the proposed note
[How we get work done](../docs/direction/how-we-get-work-done.md). Ticket 574 is the running
example. The numbers about this repo come from `field/` as it stood on 2026-11-10 at `75c6fba8b`,
counted with `jq`.

**Redone on the teams where agents do most of the work.** The first draft read how human teams
work: factories, a kitchen, surgery, the cockpit. On 2026-11-10 the owner turned that lens down
(0059's amendment of ticket 645): the sources are the teams that build coding agents and use them,
and how human teams work is background only. This version looks first at those teams, then checks
them against companies running agent fleets, single builders, and measurements. The owner walked
it on 2026-11-10 (the labs walk). The first draft's reading stays near the end, as background.

Every claim about fabrika names its version. "Today" is today's version (`packages/`, `programs/`,
the lead's tooling under `.agents/`). "`next/`" is the new one, built on `docs/direction/`.

This area has no screen. So the guidelines skill's step 5 (3 or 4 designs, shot next to Linear)
does not apply, and there are no shots and no Design canvas. Ticket 574 traced through the loop is
the worked picture instead.

```text
the shape most frontier teams converged on by late 2026 (a sketch, not one team's code)

person    picks what matters, writes intent + how we'll know, owns the outcome
tracker   a ticket or thread is the unit; an agent run starts from it
agent     plans, builds, tests itself, opens a PR with proof (CI, screenshots, video)
machines  lint + types + tests + an agent reviewer + a security pass, every PR
risk      a classifier picks who must look: nobody / one person / two people
ship      merge queue or post-merge tests, flags, staged rollout, fast rollback
learn     every miss becomes a line in the agent's instructions, a skill, or a check
scarce    human attention, then CI and source control; not code
```

## The answer

1. **At the labs, agents now write most of the code, and the people who build the tools say the
   scarce thing is human attention.** Claude writes about 90% of Claude Code's code [a1]; Anthropic
   says about 80% across its engineering [a3]; Google says 75% of its new code [g1]; OpenAI's harness
   team wrote none by hand for five months [o1, secondary]. All are the companies' own claims.
2. **Review did not go away; reading moved to machines, and people review by risk.** Anthropic's
   Claude Code team runs seven layers of checks, and a classifier decides if zero, one or two
   people approve [a1]. OpenAI's harness team says most human review is now after merge [o2].
   Stripe still has a person review every minion PR [s1]. StrongDM forbids human review [f1].
   This is the biggest split.
3. **The unit of work is a ticket or a thread with intent, run by one agent to a pull request with
   proof.** OpenAI's Symphony maps each open tracker issue to one agent workspace [o4]. Stripe
   starts from a Slack thread [s1], Cognition from Slack, Linear or an alert [d3], Ramp from Slack,
   GitHub, Linear or mobile [r2].
4. **Every miss becomes a written rule, a skill or a check, the same day.** This is the one thing
   every source agrees on: Anthropic [a1], OpenAI [o3], Hashimoto [b2], Huntley [b1]. Anthropic adds
   the other half: take harness parts out when a newer model no longer needs them [a4].
5. **Many agents work best when one of them writes and the rest read, review or advise.**
   Cognition walked back its 2025 "don't build multi-agents" to exactly this [d1, d2]. Google
   Research measured independent agents amplifying errors 17.2x, against 4.4x with a central
   coordinator [g3]. Cursor and Anthropic's compiler run still had many writers, and accepted churn
   to get speed [c2, a5].
6. **The next bottleneck after code is the plumbing.** Anthropic replaced git for its monorepo
   after merges went from about 2,500 a day in May 2026 to over 30,000 in September [a2], and
   rebuilt test selection after CI jobs rose 25x in six months [a3]. Stripe built 10-second
   devboxes [s2].
7. **The labs are moving from steps to goals.** OpenAI says Symphony's early fixed transitions were
   too rigid and now hands agents objectives [o5, secondary]. Anthropic removed its sprint structure
   once Opus 4.6 could hold a longer build [a4]. This pulls against fabrika's bet that code holds
   the loop as explicit state machines ([0037](../.decisions/0037-implicit-state-machines-made-explicit.md)).
   Stripe's mix of fixed and agent steps is the counter-example that supports fabrika [s2].

**Here (today's version), the loop works but stalls in the middle, mostly on the tools.** Of 236
step runs on 2026-11-09 and 11-10, half ended `done`, 22% were sent back and 22% got stuck. 16 of
the test writer's 31 stuck runs were the tools failing to collect the step's commit. No step asked
the owner. Ticket 574 went from a bug seen on another ticket to a merged pull request in about 100
minutes, for $19.47 at list price, and about half its step spend went to rounds that stalled
([Part 5](#part-5-what-really-happens-here), [ticket 574](#todays-example-ticket-574)).

How the first draft's six principles fared, in one line each (detail in
[Part 6](#part-6-the-first-drafts-six-principles-tested)):

| Principle | Verdict |
|---|---|
| W1 one loop, six handoffs | changes shape: the parts stay, but check is many layers and learn runs all the time |
| W2 pull under a cap | changes shape: what is capped is human attention and infra, not work in flight |
| W3 shape first, amend in the open | holds, and changes: shape the intent and the check; redo is often cheaper than amend |
| W4 stop at the first defect, say whose | half breaks: "whose" holds; "stop at every defect" is walked back where a change can be undone |
| W5 ship small | holds, with "small" meaning cheap to undo and to check, not short in time |
| W6 a lesson lands in the written way | holds, strongest of the six; faster, and code beats prose |

The revised set is seven principles, F1 to F7 ([Part 7](#part-7-a-revised-set-from-the-frontier)).

## Part 1: the loop, in plain words

No fabrika words here, as 0059 asks. The loop starts at "decide what to work on next", the lead's
lean that the owner did not object to.

| Part | Who decides | What is handed over | What "done" means |
|---|---|---|---|
| Decide what to work on next | the person who owns the goals | one piece of work with a reason | it is picked, and someone has it |
| Shape it | the person who owns the goals, or someone they trust | a short plan: what changes, how we will know, how much time it is worth | the plan is agreed, and its limits are clear |
| Do it | the doer | the change, and what the doer saw on the way | the change exists and the doer thinks it meets the plan |
| Check it | someone other than the doer, and the rules | a yes, or a no with the reason | every check passes, or the work goes back with why |
| Ship it | whoever holds the gate | the change, live | people can use it |
| Learn from it | everyone who touched it | what broke, what cost too much, what worked | the lesson is in the written way of working, not only in a head |

Someone wants something before all of this. That want becomes a piece of work in the first part.

## Part 2: the harness builders

These are the teams that build a coding agent and use it to build itself. They get the most depth.
For each: how they work now, a dated timeline, what they say comes next, and what they do versus
what they sell.

### Anthropic (Claude Code team, and Anthropic engineering)

**How they work now (late 2026).**

- **Share of code.** "Claude writes about 90 percent of Claude Code's own code" [a1] (Oct 15, 2026).
  Across Anthropic engineering, Claude authors about 80% of code, and engineers ship about 8x as
  much per quarter as in 2021 to 2025 [a3] (Sep 14, 2026). Both are the company's own numbers.
  An outside estimate from October 2025 put the company-wide merged-line share near 50% [r1]; the
  definition of "written by AI" moves these numbers a lot.
- **Volume.** Merged pull requests in the Claude Code repo more than doubled from June to
  September 2026, and the share reverted fell by more than 40% [a1]. The monorepo went from about
  2,500 merged changes a day in May to over 30,000 in September [a1, a2].
- **Review, the seven layers** [a1]:
  1. Before the PR: Claude runs tests, build and lint; a subagent reviews the diff in a fresh
     context.
  2. Required CI, and a PR template that asks how it was tested and how to undo it.
  3. An agent reviewer on every PR: parallel bug hunters, verifier agents vote on each finding,
     findings tagged Important, Nit or Pre-existing.
  4. A separate security pass; open findings block merge.
  5. Human approval by risk: low risk (docs, copy, flagged additive changes) needs nobody once
     checks are green; medium needs one person; high needs two. A classifier sets the tier from the
     change, not the author. Some paths, such as CI files, always need a person. An agent's approval
     never counts as a person's.
  6. A merge queue that re-runs checks on current main, flags, employees first, `latest` before
     `stable`.
  7. Fast detection and rollback, with a weekly on-call.
- **What people still do** [a1]: decide whether to build a thing, review risky code and
  architecture, read the evidence, own the outcome. The person who prompted a change is a required
  reviewer. Nobody holds the whole codebase in their head; people ask Claude to explain a slice.
- **Direction.** Agents make a start cheap, so the team often closes a PR that points the wrong
  way; the time to say "different direction" is early, in the thread [a1].
- **Memory between runs.** The team keeps one shared `CLAUDE.md`, and a missed bug becomes a line
  there, a skill or a new check [a1]. Each mistake added to the shared file, and a personal file
  that only points to it, are **secondary** (third-party write-ups of the team lead's posts).
  Anthropic's November 6, 2026 post on agent memory describes notes the agent writes and an offline
  "dreaming" pass that tidies them; it could not be opened (404), so this is **secondary**.
- **One person, many agents.** Running about five local sessions plus five to ten cloud sessions is
  **secondary** (write-ups of the team lead's posts, January 2026). Claude Code's own "agent teams"
  (a lead, teammates, a shared task list, file-locked claiming, a mailbox per agent) are still
  "experimental and disabled by default", and the docs say to start with 3 to 5 teammates and to
  keep two teammates out of the same file [a9].

**Measured or stated failures, kept.**

- A review loop ran "more than fifty rounds of review and fixes overnight" on one PR; about 59% of
  what the reviewer kept flagging was old code. The fix: a three-round cap, diff-only re-review,
  no repeat findings. One-round passes rose from 65% to 78% [a1].
- No circuit breaker yet that tightens approval when reverts rise; the team wants one before more
  code merges with no person [a1].
- Spring 2026: three harness changes (lower default effort, a cache bug, a verbosity prompt) made
  Claude Code worse for weeks; internal use did not catch it because staff ran an internal build.
  The fixes: staff use the public build, every system prompt change gets per-model evals, soak
  periods and gradual rollout [a8].
- Long-running agents "declare victory on the entire project too early", or try to one-shot the
  whole app [a6].
- A generator praises its own mediocre work; a separate skeptical evaluator is easier to tune than
  a self-critical generator [a4].
- The plumbing broke under agent volume: a single-writer test-selection service lasted 70, then 29
  days per quick fix, then fell over daily [a3]; git mirrors could not keep up, so a seven-person
  team built a server-side version control system in five months [a2].
- Inside Anthropic, the December 2025 study found most staff could "fully delegate" only 0 to 20%
  of their work, and named a paradox: "supervising Claude requires the very coding skills that may
  atrophy" [a7].

**Timeline (from their own posts unless marked).**

```text
2025-02  Claude Code launches (secondary, press)
2025-03  forecast, CEO: AI writes 90% of code in 3 to 6 months (secondary [a13]); an outside
         estimate in Oct 2025 says ~50% company-wide, 90% on some teams [r1]
2025-04  "best practices for agentic coding" post [a11]
2025-06  multi-agent research system post [a11]
2025-07  "How Anthropic teams use Claude Code": Claude Code is the "first stop" [a10]
2025-08  internal data: tool calls in a row without a person 9.8 -> 21.2; human turns 6.2 -> 4.1 [a7]
2025-10  Agent Skills post; sandboxing "beyond permission prompts" [a11]
2025-11  long-running harness: initializer agent, progress file, feature list as JSON, one
         feature at a time, fresh sessions read the files [a6]
2026-02  16 parallel agents, a bash loop, no orchestrator, lock files in a folder, ~2,000
         sessions, ~$20,000, a C compiler [a5]
2026-03  planner / generator / evaluator harness; sprints and context resets removed as models
         improved [a4]; auto mode for permissions [a11]
2026-04  quality postmortem: three harness changes hurt users [a8]
2026-09  CI: jobs 25x in six months; test selection rebuilt [a3]
2026-10  source control rebuilt for always-online agents [a2]; Claude Code team's review post:
         ~90% of code by Claude, review by risk tier [a1]
2026-11  agent memory post, "dreaming" (secondary [a12])
```

**What they say comes next.** The line of what merges with no person "keeps moving" [a1]
(forecast). They expect their source control problems to reach the rest of the industry in six to
12 months [a2] (forecast). "The space of interesting harness combinations doesn't shrink as models
improve" [a4] (stated belief).

**Do versus sell.** What they do internally (risk tiers, a homegrown version control system,
classifier-set approval) is ahead of what they sell. Code Review, the product, posts findings but
does not approve PRs [a1]. Agent teams are sold as experimental [a9].

### OpenAI (Codex team, and the harness engineering team)

openai.com refused every fetch (403). The harness engineering post, the Symphony post and the
June 2026 usage report are known here only through other pages, so they are **secondary**. The
Symphony repo, a long podcast interview, a talk page and the 2025 PDF were read directly.

**How they work now.**

- **The harness team.** Three engineers growing to seven built an internal product of about a
  million lines over five months with no hand-written code, about 1,500 PRs, 3.5 PRs per engineer
  per day (all **secondary**, from summaries of the February 11, 2026 post [o1]).
- **Review after merge.** "Most of the human review is post merge at this point" [o2]. A reviewer
  agent is told to lean toward merging; a `$land` skill pushes, waits for review and CI, fixes
  flakes and merges through the queue. People still cut release branches and approve a smoke test
  [o2].
- **What people do.** "The only fundamentally scarce thing is the synchronous human attention of my
  team" [o2]. People set up observability, architecture boundaries and taste; the interviewee
  describes his role as a tech lead over a large organization rather than a PR reviewer [o2].
- **Making standards mechanical.** Tacit expectations become docs, decision records, lint rules,
  structural tests and reviewer agents; error messages say what to do next; a weekly "garbage
  collection day" turns repeated review comments into docs and checks; plans are reviewed on their
  own; agents may defer or reject a review comment [o3]. "Repository structure is part of the
  prompt" [o3].
- **Memory.** A short `AGENTS.md` as a table of contents pointing into `docs/` (secondary [o1];
  confirmed in shape by the interview [o2]). About six skills, and a new process gap goes into an
  existing skill first [o2]. Follow-up work was first a markdown file an agent worked through [o2].
- **The Codex product team.** About 40 people with one product manager and two designers; meetings
  are lean and come from real needs (**secondary**, an interview with the head of Codex [o8]). The
  head of Codex said "Verification definitely becomes a bottleneck", and that some on the team
  complain there is too much code to review; one engineer runs about 60 background automations
  (keep PRs mergeable, fix conflicts, find bugs in shipped PRs) [o7].
- **Symphony.** A spec, not a product: it "turns project work into isolated, autonomous
  implementation runs", so teams "manage work instead of supervising coding agents" [o4]. It polls
  the tracker, keeps one workspace per issue, runs with bounded concurrency, keeps the workflow
  prompt in-repo as `WORKFLOW.md`, and may end a run at a "Human Review" state rather than Done
  [o4]. The launch post says engineers could juggle about three to five interactive sessions before
  switching cost won, and some teams saw landed PRs rise about 500 to 600% in three weeks (both
  **secondary** [o5]).

**Failures, kept.**

- The first month and a half was about ten times slower than writing the code by hand [o2].
- Build times had to drop under a minute; the build system was redone several times [o2].
- Author and reviewer agents did not converge until their prompts were loosened [o2].
- Wiring the browser tool through MCP was dropped for a small command-line shim: the tool cost too
  many tokens and the agent forgot it after compaction [o2].
- Models still struggle with zero-to-one product work and the hardest refactors [o2].
- Early Symphony workflows with fixed transitions were too rigid; OpenAI moved to giving agents
  objectives (**secondary** [o5]).

**Timeline.**

```text
2025-05  Codex launches as a research preview (secondary; [o6] still calls it a research preview)
2025     "How OpenAI uses Codex": start with Ask mode for a plan, tasks of "about an hour"
         or a few hundred lines, AGENTS.md for what code can't show, best-of-N, a task queue as a
         backlog [o6]
2025-08  average OpenAI worker spent under 10% of tokens on Codex (secondary [o9])
2026-02  harness engineering post (secondary [o1]); Codex app; Symphony repo created Feb 26 [o4]
2026-04  Symphony post: human attention is the bottleneck (secondary [o5]); harness talk at AI
         Engineer Europe [o3]; long interview [o2]
2026-06  usage report: top 1% of users run 60+ hours of agent turns a day across parallel agents;
         25.6% of sampled users made a request judged over eight hours of human work (secondary [o9],
         task length judged by a model)
```

**What they say comes next** (forecasts): "ghost libraries", software shipped as specs that agents
rebuild; agents working with people in Slack and Linear; an enterprise platform for governed agents
[o2]. Symphony is called "the next step" after harness engineering [o4].

**Do versus sell.** Symphony is a "low-key engineering preview for testing in trusted environments"
[o4]; the internal practice (post-merge review, no human-written code) is further out than the
product's default of a human review state.

### Google (Antigravity, Jules, Gemini CLI)

Google publishes far less about how its own teams work. Most of this is the CEO's numbers and
product posts.

- **Share of code.** "75% of all new code at Google is now AI-generated and approved by engineers",
  up from about half last fall [g1] (Apr 22, 2026, company claim). A complex migration ran "six
  times faster" than a year earlier with engineers alone [g1]. Google is "now shifting to truly
  agentic workflows" [g1].
- **Products, late 2026.** Antigravity 2.0 (May 19, 2026) is a desktop app to run many agents in
  parallel, with subagents and scheduled background tasks; Gemini CLI users are told to move to the
  Antigravity CLI; a managed agent API runs on "the same agent harness powering Google's products"
  [g2]. Jules still exists as a cloud agent (secondary). An internal Antigravity build and an
  internal agent called "Agent Smith" are reported only by the press (**secondary** [g5]).
- **Research the labs can use.** A controlled study of 180 agent setups found centralized multiple
  agents gained 80.9% on a task that splits well, every multi-agent setup lost 39 to 70% on a
  strictly sequential task, and independent agents amplified errors 17.2x against 4.4x with a
  coordinator [g3] (Jan 28, 2026). Their 2025 migration report found review, not writing, became
  the bottleneck (**secondary** [g4]).

```text
2024-10  ~25% of new code AI-generated (secondary, press)
2025-01  migration report: review becomes the bottleneck (secondary [g4])
2025-10  ~50% (as stated in [g1])
2025-11  Antigravity 1.0 with an agent manager (secondary)
2026-01  scaling agent systems study [g3]
2026-04  75%; "truly agentic workflows" [g1]
2026-05  Antigravity 2.0; Gemini CLI folded into Antigravity CLI [g2]
```

**Do versus sell:** no first-hand account of a Google team's day was found. What Google sells
(parallel agents, background tasks) is all that is public.

### Other harness builders

- **Cursor** (an editor company that now trains models). Hundreds of agents on one codebase.
  Locks failed: "Twenty agents would slow down to the effective throughput of two or three" [c1].
  A flat team made "agents became risk-averse" [c1]. Planners, workers and a judge worked better;
  an integrator role was built and removed as a bottleneck; fresh starts fight drift [c1]. A month
  later they accepted "a small but stable rate of errors" instead of perfect commits, because
  demanding perfect commits serialized everything; peak about 1,000 commits an hour for a week,
  with state in a rewritten `scratchpad.md` and handoff notes [c2]. People supply taste, limits and
  read the logs [c2].
- **Cognition** (Devin). June 2025: "don't build multi-agents" [d1]. April 2026: what works is when
  "writes stay single-threaded" and other agents add review and advice; its review agent finds about
  2 bugs per PR (company claim); manager agents are too prescriptive and assume shared state [d2].
  Internally, the team merged 659 Devin PRs in one week of February 2026, against 154 in its best
  2025 week; anyone can start a task from Slack, Linear or an alert; "We review the PR, not the
  logs" [d3] (company claims).
- **xAI, Mistral, Meta.** Each ships a coding agent (Grok Build, Mistral Vibe, a Meta agent), but
  nothing first-hand was found on how their own teams work. **Guess** that they follow the same
  shape; nothing here supports it.

### Side by side

| Question | Anthropic | OpenAI | Google | Cursor / Cognition |
|---|---|---|---|---|
| Share by agents | ~90% Claude Code, ~80% eng [a1, a3] | 100% on the harness team (sec.) | 75% of new code [g1] | not given / 659 PRs a week [d3] |
| One long agent or many | many sessions per person; agent teams experimental [a9] | ticket per agent, many at once [o4] | many in parallel (product) [g2] | hundreds, planners and workers [c1] / one writer, many readers [d2] |
| Cloud or local | both; staff told to use the public build [a8] | both; Symphony runs per-issue workspaces [o4] | desktop app plus managed cloud agents [g2] | cloud |
| Who reviews | machines read; people by risk tier [a1] | mostly after merge [o2] | "approved by engineers" [g1] | a judge agent [c1] / review agent, then a person [d3] |
| Spec or chat | thread first; plan mode; planner writes spec in harness work [a4] | ticket plus `WORKFLOW.md`; plans reviewed alone [o3, o4] | not public | planner writes tasks [c1] |
| Memory | shared `CLAUDE.md`, skills, checks [a1] | short `AGENTS.md` as a map, `docs/`, skills [o2] | not public | scratchpad and handoffs [c2] / playbooks, wiki [d3] |

**Where the labs agree on their own way of working:** a person owns each change; every miss turns
into instructions or a check; the repo holds the agent's memory; proof of work comes with the PR;
human attention is the budget.

**Where they differ:** whether a person reads before or after merge (Anthropic by risk before;
OpenAI's harness team after); whether many agents write at once (Cursor yes; Cognition no); how
much structure the harness imposes (Stripe's fixed nodes versus OpenAI's goals).

## Part 3: the second ring

Used to confirm or challenge Part 2.

- **Stripe** confirms the ticket-to-PR unit and challenges "no human review". Minions start from a
  Slack thread, a doc or a CI flaky-test ticket; each run gets an isolated devbox in about 10
  seconds; local lint in under five seconds per push; "at most two rounds of CI", then back to a
  person; over 1,300 PRs a week with no human-written code, all reviewed by a person [s1, s2].
  Blueprints mix fixed nodes (lint, push) with agent nodes (implement, fix CI) because fixed steps
  save tokens and "reduce the chances for the agent to err" [s2]. Rule files are scoped by folder,
  not global [s2].
- **StrongDM** is the far end. "Code must not be reviewed by humans" [f1]. People write a seed
  (spec, a few sentences, a screenshot) and scenarios; scenarios live outside the codebase like a
  model's holdout set; satisfaction is the share of runs likely to satisfy a user, not a pass/fail;
  a "digital twin universe" clones Okta, Jira, Slack and Google apps for testing at volume [f1, f2].
  They "separate interactive work from fully specified work" [f2]. An outside visitor doubts the
  no-review rule and the cost of $1,000 of tokens per engineer per day [f3].
- **Ramp** confirms. Inspect wrote "74% of merged PRs" in the month before Oct 27, 2026; product
  and design start sessions too; every change goes to a person before it ships, with visual proof
  [r2] (company claim). Their stated bottleneck is which ideas to act on [r2].
- **Single builders.** Huntley's "ralph" loop is a bash loop over a prompt, specs one per file, and
  a plan file the agent regenerates; "One item per loop" [b1]; nondeterminism is its weak point,
  and senior judgment is still needed [b1]. Hashimoto runs one background agent at a time, turns
  off notifications, and adds an `AGENTS.md` line for each bad behavior [b2]. Gas Town, a
  many-role orchestrator, was built in about 17 days and is judged design fiction more than a tool;
  the bottleneck moves to design and planning [b3]. GitHub's Spec Kit "gives AI coding agents
  structured processes" and now offers bug-fix and idea-assessment flows beside spec-driven work
  [b4].
- **Measurements.**
  - METR's task length for top models: Opus 4.5 at about 320 minutes at the 50% mark, doubling
    every 89 to 131 days recently, with "very wide" intervals and a suite near saturation [m1].
  - METR: about half of test-passing agent patches on SWE-bench "would not be merged into main by
    repo maintainers"; by maintainer review one model's task length drops from about 50 to 8
    minutes [m2]. Passing tests is not the same as mergeable.
  - METR's 2026 productivity follow-up could not give a clean number: 30 to 50% of developers
    skipped tasks they did not want to do without AI (**secondary** [m3]).
  - Failed agent PRs on GitHub are larger, fail CI more, and suffer "lack of meaningful reviewer
    engagement, duplicate PRs" and unwanted features [m4]. Who submits a PR matters more than its
    content for whether it merges, and more review lowers the merge odds for agent PRs, unlike human
    ones [m5].
  - DORA 2025: AI raises throughput but makes delivery more fragile; small batches matter more
    with AI (**secondary** [g6]).

## Part 4: the eight questions, and where teams disagree

1. **Unit of work.** A ticket, thread or issue with intent, owned by a person, run by one agent
   to one PR [o4, s1, d3, r2]. At the far end, a seed plus hidden scenarios [f1]. Inside long runs,
   a planner agent writes the tasks [c1, a4]. People write the top unit; agents write the ones
   below it.
2. **What people do and stopped doing.** They decide what to build, set limits, review by risk,
   read evidence, own outcomes, and fix the harness [a1, o2, c2]. They mostly stopped reading every
   diff (Anthropic for low risk [a1]; OpenAI's harness team before merge [o2]; StrongDM entirely
   [f1]), and stopped holding the whole codebase in their heads [a1]. Stripe and Ramp still review
   every PR [s1, r2]. Lean meetings [o8, secondary]. No first-hand source on dropped standups,
   sprints or PRDs was found; treat "they dropped sprint planning" as a **guess**.
3. **How work is checked when nobody reads every diff.** The agent checks itself first, then CI,
   then an agent reviewer with voting verifiers, then security, then people by risk, then the merge
   queue, flags and rollback [a1]. Held-out scenarios and service twins [f1]. A separate skeptical
   evaluator [a4]. A known-good oracle (GCC) [a5]. Incidents become reviewer evals [a1]. Revert and
   incident rates are the guardrail [a1]. Mutation testing did not come up in any lab source.
4. **How many agents run.** One per ticket under bounded concurrency [o4]; planners and workers
   [c1]; one writer with readers [d2]; fresh sessions reading files [a5, a6]; shared task lists
   with file locks [a9, a5]. Merges: a queue on current main [a1], or post-merge tests and agents
   fixing conflicts "faster than humans can detect them" [a2]. Two CI rounds or three review rounds
   then a person [s1, a1].
5. **Knowledge between runs.** A short instructions file as a map, deeper docs, skills, plan and
   progress files, all in the repo [o2, a1, a6]. Scoped rule files by folder [s2]. Playbooks and an
   auto-built wiki [d3]. Agent-written memory with an offline tidy pass (secondary [a12]).
6. **What failed or was walked back.** Locks [c1]; an integrator [c1]; perfect commits [c2];
   flat swarms [c1, d2]; "don't build multi-agents" walked back to one writer [d2]; fixed workflow
   transitions [o5, secondary]; sprints and context resets as models improved [a4]; MCP for a
   browser tool [o2]; 50-round review loops [a1]; dogfooding an internal build [a8]; git and test
   selection at agent volume [a2, a3]; Gas Town's design [b3].
7. **Disagreements.** The five branches below.
8. **What they kept from human teams, and dropped.** Kept on purpose: a person accountable for
   every change, blameless incident review, small reversible changes, merge queues, flags, staged
   rollout, on-call [a1]; a tracker as the work queue [o4]. Dropped: reading every line [a1, o2];
   holding the codebase in one head [a1]; a central integrator [c1]; waiting for perfect before
   merge [c2]. Kept but reshaped: code review, now mostly machines; planning, now a planner agent or
   plan mode.

**Branch A: who reads code before it lands.**

```text
every PR, a person    Stripe [s1], Ramp [r2], Google "approved by engineers" [g1]
by risk tier          Anthropic Claude Code: nobody / one / two, set by a classifier [a1]
after merge           OpenAI harness team [o2]
never                 StrongDM [f1]
```

What each would undo for fabrika: "every PR, a person" fits today's rule that the lead reads every
diff (AGENTS.md); "by risk" would let low-risk pull requests land with no lead read; "never" would
undo [0014](../.decisions/0014-the-lead-merges-when-every-step-passed.md)'s owner read for real
loosening. Measured backing is thin on all sides: Anthropic's reverts fell 40% while volume doubled
[a1] (company claim); METR says passing checks still leaves about half unmergeable [m2].

**Branch B: one writer or many.**

```text
many writers, accept churn   Cursor [c1, c2], Anthropic compiler run [a5]
one writer, many readers     Cognition [d2], Google's error data [g3]
one agent per ticket         OpenAI Symphony [o4], Stripe [s1]
```

**Branch C: how much the harness fixes the path.**

```text
fixed steps around the agent   Stripe blueprints [s2], Anthropic's early harness [a6]
goals, not transitions          OpenAI Symphony (secondary [o5]); Anthropic removing sprints [a4]
remove parts as models improve  Anthropic [a4], Cursor switching models per role [c1]
```

**Branch D: spec first or thread first.** StrongDM's seed and hidden scenarios [f1], Spec Kit [b4]
and Huntley's spec files [b1] against Stripe's Slack thread [s1] and Anthropic's "raise it early in
the thread" [a1]. OpenAI sits between: tickets plus reviewed plans [o3, o4].

**Branch E: how hard to push one person.** OpenAI's top users run 60+ hours of agent turns a day
(secondary [o9]); StrongDM wants $1,000 of tokens per engineer per day [f1]; Hashimoto runs one
background agent [b2]; Anthropic's own staff fully delegate only 0 to 20% (Aug 2025 data [a7]).

## Part 5: what really happens here

All of this is today's version: the lead's tooling and today's lanes. `next/` has no pipeline yet.

### The rows

- `field/runs.jsonl` had 5,985 rows from 2026-10-10 to 2026-11-10. 44 are corrections, so 5,937 are
  live. Most are experiment replays (4,001 `triager` rows), not real work.
- The clean step data is the `drive.ts` rows: `role: "hand"` and a `why` that starts
  `drive.ts <step>`. There are 236, on 2026-11-09 and 11-10 only, over 24 tickets. Before that,
  step outcomes are free text in many spellings and cannot be counted cleanly.

| Step | done | send | stuck | ask | skip | all |
|---|---|---|---|---|---|---|
| tests | 49 | 12 | 31 | 9 | 0 | 101 |
| review | 22 | 28 | 8 | 0 | 0 | 58 |
| build | 21 | 8 | 8 | 0 | 0 | 37 |
| mutation | 21 | 3 | 4 | 0 | 6 | 34 |
| plan | 4 | 2 | 0 | 0 | 0 | 6 |
| all | 117 (50%) | 53 (22%) | 51 (22%) | 9 (4%) | 6 (3%) | 236 |

The verbs are mapped from the row's `outcome`: `pass` is done, `fail` is send, `stopped` is stuck,
`parked` is ask.

### Where work stalled

- **The test writer stalls most.** 31 of 101 runs got stuck. 16 of those are `fetch_failed`: the
  lane could not collect the step's commit out of its box. That is the tools, not the work, which
  is the frontier's point 6 at our size.
- **Review sends back most.** 28 of 58 reviews sent work back, 25 of them to the test writer, so a
  law needed fixing.
- **Retries need a judge.** On ticket 574, 9 small judgment agents decided what to do after a stuck
  step: 2 said send again, 7 said park for the lead.
- **Time lost is not recorded.** The median step takes about 4.5 minutes. Nothing records how long
  the lead spent unsticking a lane by hand.

### Where a person was needed

- **Steps never asked the owner.** All 9 `ask` rows from a step went to the lead
  (`ask:lead:question` 7 times).
- **89 of 554 notes say a person was needed** (`person: true`). By the notes' `stage` field: plan
  18, driver 16, harness 14, triage 9, ship 7. Read by hand, the newest 40 fall into four groups:
  design calls and plan approvals; the owner correcting how the lead worked; tooling knots only a
  person could untie (signing chains, a stack stranded by a squash); and outside limits.
- **The owner's time is not recorded anywhere.** So the frontier's scarce budget, a person's
  attention, cannot be counted here yet.

### What cost the most

- **List-price dollars on the `drive.ts` steps:** tests $117.91 (median $0.77 a run), review $65.55
  ($1.12), build $44.32 ($1.07), mutation $6.27 ($0.14), plan $5.38 ($1.12). About $239 over 24
  tickets. List price is from each row's `listUsd`; the runs were on subscriptions.
- **The test writer costs the most and stalls the most.** It is the same step.
- **Not trusted or missing:** `tokens` is null on 977 rows and `minutes` on 308; 582 rows have no
  dollars; `billing` is set on only 231. 36 rows are `driver_caused` and stay out of any baseline.

### Notes and findings

- **Notes by kind:** failure 202, friction 176, success 110, cost 32, plus 34 rows with kinds
  outside the schema.
- **Findings:** 50 rows and 46 ratings, all from 2026-11-09 and 11-10. 22 rated fix, 24 noise, 4
  not rated. The lead found 27 (14 fix), review 16 (7 fix).

## Today's example: ticket 574

Ticket 574 built decision [0052](../.decisions/0052-tests-never-depend-on-the-machine.md): tests
never read the home folder. It landed as [PR 787](https://github.com/usirin/tea-fabrika/pull/787).
Times are Pacific, on 2026-11-10. The sources are the PR, its 25 run rows (`t574-*`), notes
2026-11-10-24 and -25, and the lane's plan and chain files, which live outside the repo.

| Part | What happened | Who decided | What was handed over | Where it stalled |
|---|---|---|---|---|
| Decide | A test box on ticket 576 failed every suite: the test setup looked at the home folder, and a locked home refused it. The owner ruled the dependency goes. 0052 merged 11:50. Ticket 574 was filed to build it. | the owner (the rule), the lead (the ticket) | the decision and the ticket | who filed 574 and when is not recorded |
| Shape | A plan with laws L1 to L5, approved by the lead because it builds 0052. Amended twice: A1 at 11:52, when the test writer found the installed linter lacks the rule the plan named; A2 at about 12:38, when mutation got stuck twice because the code ran only at file load, so it had nothing to measure. | the lead | the plan file, signed again after each amendment | each amendment came from a later step |
| Do | The chain ran 11:48 to 13:18 with no lead agent holding it. Tests: 8 rounds, 4 done. Build: 7 rounds, 5 done; two made no commit because every law was already green. | each step's own agent | signed commits on the lane's branch, a brief per round | tests stuck twice on `fetch_failed`; collecting a stuck step's commit moved the lane's branch, and the next box was refused until the lead moved it back |
| Check | Mutation: 4 rounds, the last with 17 killed and no survivors. Review: round 1 sent back to tests (a law needed its `scenario:` label), round 2 done. The lead ran lint, typecheck and narrow tests outside the boxes, which cannot do some of it. `loosening.sh` flagged 2 removed laws; the lead's hand check found both rewritten stricter. | review's agent, then code; the lead for the hand check | review answers, `loosening.sh` output | the lead's own runs have no rows |
| Ship | PR opened 13:18, `catchup.sh` landed it 13:28 on green CI. No owner read, since nothing loosened ([0014](../.decisions/0014-the-lead-merges-when-every-step-passed.md)). 6 files, +289 and -48. | code, under the lead | the merged change | none |
| Learn | PR 789 added the run rows and note 2026-11-10-25. The note names four causes and leaves "branch move and box limits" to look at. No ticket or finding names them. | the lead | a field note | the lesson did not reach a ticket, a finding or a skill |

**Cost:** $18.31 for the steps and $1.16 for the judgments, $19.47 in all, at list price. 70 agent
minutes. 8.95M tokens in (7.89M cached) and 27.9k out. 9 of its 18 step rows, $8.81, were rounds
that stalled or were sent back.

**Not recorded, so it cannot be traced:** who filed 574 and when; who wrote the first plan and what
it cost; the first approved plan body (only the two signed-again copies are left); three rounds
with no rows (build 3, mutation 1 and 2); the lead's own time and runs; CI and the leak grep apart
from the PR comment; the owner's time.

### Ticket 574 against the seven principles

| Principle | 574 |
|---|---|
| F1 attention is the budget | half: the owner looked once, at the rule, and nothing else asked him; but no look by anyone was recorded |
| F2 a ticket with intent, one PR with proof | follows: one ticket, one plan, one PR; the proof was CI and `loosening.sh` in a PR comment |
| F3 check in layers, people by risk | half: mutation, review, CI, `loosening.sh` and the lead's hand check all ran; no tier, so the lead read it as it reads every PR |
| F4 every miss becomes a check the same day | breaks: the note names the tooling causes, and nothing picks them up |
| F5 the repo is the memory | half: each fresh step agent read the plan and the amendments; but the plan and chain files live outside the repo, and the first plan body is lost |
| F6 one writer per change | follows: tests and build wrote in turn on one branch; mutation and review only read |
| F7 code holds the edges | half: the chain ran the lane with no agent holding it; but at one edge, collecting a stuck commit moved the branch, and the lead fixed it by hand |

## Part 6: the first draft's six principles, tested

### W1: one loop, six handoffs, each with an owner and a "done"

**Changes shape.** The parts are all there at the frontier, but two move. "Check" is seven layers,
mostly machines, with people placed by risk [a1]. "Learn" is not a last step; it runs on every miss,
the same day [a1, o3]. Ownership also shifts: agents own "do" and most of "check"; a person owns
"decide", the risky checks and the outcome [a1]. Handoffs are tracker states in Symphony [o4] and
written handoffs in Cursor [c2], which supports recording each one. The doubt: OpenAI found fixed
transitions too rigid (secondary [o5]), so the six parts should be fixed facts on a ticket, not a
fixed path an agent walks.

### W2: pull new work only when there is room

**Changes shape.** No lab caps work in flight to protect flow. What they cap is the person:
three to five sessions before switching cost won (secondary [o5]), notifications off [b2], human
attention named as the scarce thing [o2]. Symphony has "bounded concurrency" [o4], but sized to
runtime, not a kanban limit. The next cap is the plumbing: CI 25x [a3], merges 12x [a2]. Kanban's
idea holds; what you count changes.

### W3: shape before you start, and change the plan in the open

**Holds, and changes.** Shaping is everywhere: plans reviewed on their own [o3], a planner agent
[a4, c1], a seed and scenarios [f1], spec files [b1], Ask mode before Code mode [o6]. Two changes.
The planner should say what to deliver, not technical detail, since detail errors spread [a4].
And because a start is cheap, a wrong PR is closed and redone rather than amended [a1]. "Amend in
the open" stays right for the plan; for the code, redo is often cheaper.

### W4: stop at the first defect, and say whose defect it is

**Half breaks.** "Say whose" holds and grows: the labs' biggest stalls were the tools and plumbing,
not the work [a2, a3, a8, o2]. "Stop at the first defect" is walked back where a change can be
undone: Cursor accepts a steady error rate because perfect commits serialized work [c2]; Anthropic
tests after merge and lets agents fix conflicts [a2]; OpenAI reviews after merge [o2]. Stops stay
where harm can't be undone: security findings block, risky paths need people [a1]; loops get caps
(two CI rounds [s1], three review rounds [a1]). This matches the proposed "can a later change undo
the harm?" question in [pipeline strategies](../docs/direction/pipeline-strategies.md).

### W5: ship small

**Holds.** Small, reversible changes [a1]; one feature per session [a6]; one item per loop [b1];
failed agent PRs are larger [m4]; small batches matter more with AI (secondary [g6]). The change:
task length is rising fast [m1; o9 secondary], so "small" should be measured by how cheap a change
is to check and undo, not by how long it took.

### W6: a lesson lands in the written way of working

**Holds, the strongest of the six.** Every source does it: a miss goes into `CLAUDE.md`, a skill or
a check [a1]; repeated comments become docs and checks on a weekly cleanup day [o3]; a line per bad
behavior [b2]; a "sign" per repeated mistake [b1]; incidents become reviewer evals [a1]. Two
changes: the frontier prefers a check over prose [o3], and it also deletes rules that no longer
carry weight when models improve [a4].

## Part 7: a revised set, from the frontier

Seven principles. Each says what fabrika does now, with the version named. Every path below was
checked on main on 2026-11-11. The note gives each one in full; these are the leans as walked.

### F1: spend people's attention as the scarce budget

- **Means:** design every step so a person looks only where their look changes the outcome, and
  count the looks.
- **Sources:** [o2], [o5] (secondary), [o7], [b2], [a1] (it tracks human approvals per PR, comments
  and wait time).
- **Disagreement:** how hard to push it (Branch E).
- **Fabrika today (today's version):** the owner's time is not recorded anywhere (Part 5). The
  12-agent cap is about the laptop, not about attention
  ([0012](../.decisions/0012-twelve-agents-at-once.md)). An ask has one shape with a hash of what
  the person saw ([one ask and one meter](../docs/direction/one-ask-and-one-meter.md), decided;
  `next/`).
- **Lean, 85%:** record every look by a person (who, when, on what, how long) as an event from day
  one, and make it the first measure the pipeline optimizes.
- **Doubt:** at two people, attention may matter less than taste. **Cost:** one event per look.

### F2: the unit is a ticket with intent and evidence, run to one PR with proof

- **Means:** a person writes what and why and how we will know; one agent run turns it into one
  pull request carrying proof (checks, shots, a short write-up).
- **Sources:** [o4], [s1], [d3], [r2], [f1].
- **Disagreement:** spec first or thread first (Branch D).
- **Fabrika today:** tickets in the tracker (today's `programs/tracker`); a plan file approved on
  line 1 (AGENTS.md); in `next/`, a plan with criteria and properties
  ([the plan note](../docs/direction/the-plan-stage.md)) and a commit as the unit of work
  ([a unit of work is a commit](../docs/direction/a-unit-of-work-is-a-commit.md),
  `next/apps/fabrika/src/exam/commits.ts`).
- **Lean, 80%:** keep this; add "proof of work" as a required part of the PR, not optional.
- **Doubt:** fabrika's plan step may be heavier than the frontier's (Stripe starts from a thread).
  **Cost:** proof costs tokens per PR.

### F3: check in layers, and place people by risk

- **Means:** machines read every change; a rule set from the change, not the author, decides
  whether nobody, one person or two must look; an agent's yes never counts as a person's.
- **Sources:** [a1], [s1], [o2], [f1], [m2].
- **Disagreement:** Branch A, the biggest one.
- **Fabrika today:** plan, tests, build, mutation and one review per PR, each by its own agent; the
  lead reads every diff, CI and the leak grep; the owner reads only real loosening (AGENTS.md;
  [0014](../.decisions/0014-the-lead-merges-when-every-step-passed.md);
  `.agents/skills/lead/scripts/loosening.sh`). "Nobody writes their own exam"
  ([the note](../docs/direction/nobody-writes-their-own-exam.md)) already matches the frontier's
  split of builder and checker [a4, f1]. No holdout scenarios exist: a search of `docs/direction/`
  and `.decisions/` for holdout or hidden tests found nothing.
- **Lean, 75%, as walked:** keep the exam rule; add a risk tier per PR set from the paths it
  touches; try one holdout set of scenarios the builder can't see.
- **Wrong, kept as wrong:** "a risk tier set from the paths it touches." The same day,
  [experiment 252](./252-risk-tiers-on-phoenix.md) replayed path tiers on 457 merged pull requests
  of kamp-us/phoenix: the high tier was not above the medium one in later fixes (7.4% against
  9.8%), while size alone separated them (1.3% at 50 lines or fewer, 11.6% over 400).
  [0079](../.decisions/0079-size-counts-governed-paths-name-who.md) took its place: size sets how
  many people look, governed paths set who.
- **Doubt:** under 80% because the evidence is company claims plus one METR warning. **Settled by:**
  tagging a month of merged PRs by tier and counting reverts per tier.
- **Cost:** a classifier and its false-alarm measurement (AGENTS.md asks for about 0% to block).

### F4: every miss becomes a check, a rule or a skill the same day; and stale rules leave

- **Means:** a mistake ends in code that prevents it where possible, prose only for judgment; when
  a model change makes a rule useless, delete it.
- **Sources:** [a1], [o3], [b1], [b2], [a4].
- **Disagreement:** almost none on adding; only Anthropic writes about removing [a4].
- **Fabrika today:** findings rows rated by a person
  ([0035](../.decisions/0035-outside-work-becomes-finding-rows.md)); "a rule in a prompt that could
  be code becomes code" (AGENTS.md); but a field note can name a cause and nothing picks it up
  (ticket 574, note 2026-11-10-25).
- **Lean, 85%:** link each failure note to the check, ticket or "no change" it led to; add a
  scheduled pass that lists rules to delete.
- **Doubt:** deletion needs evidence a rule is stale. **Cost:** one link per note, one pass a week.

### F5: the repo is the memory; the top file is a map

- **Means:** a fresh agent learns everything from files: a short top file that points to decisions,
  notes, plans and progress files.
- **Sources:** [o2], [o1] (secondary), [a1], [a6], [c2], [f2], [s2].
- **Disagreement:** written by people versus written by agents with a tidy pass ([a12],
  secondary).
- **Fabrika today:** this is already fabrika's habit (`.decisions/`, `docs/direction/`,
  `.glossary/`, one fresh agent per step reading a state file, AGENTS.md). But AGENTS.md is about
  685 lines on main today, and OpenAI's harness team keeps theirs a short map (secondary [o1]);
  Stripe scopes rules by folder [s2].
- **Lean, 75%:** cut AGENTS.md to a map and move rules into scoped files or checks.
- **Doubt:** no measurement here that a long file hurts. **Settled by:** run the same step with the
  long and the short file and compare.
- **Cost:** a rewrite of the most-read file.

### F6: one writer per change; other agents read, review and advise

- **Means:** a ticket's code has one writing agent at a time; parallel agents research, review or
  test.
- **Sources:** [d2], [g3], [a9], [c1], [a5].
- **Disagreement:** Branch B.
- **Fabrika today:** one lane per ticket, steps in a row, chained by
  `.agents/skills/lead/scripts/chain.ts` (a tea machine, today's lead tooling); test writer and
  builder are separate writers on one branch in turn.
- **Lean, 70%:** keep one writer at a time; allow parallel readers.
- **Doubt:** fabrika's two writers in turn (tests, then build) is a form the sources do not discuss.
  **Settled by:** comparing send-backs between them in `field/`.
- **Cost:** less parallel speed inside a ticket.

### F7: code holds the edges; the agent holds the path inside a step

- **Means:** code owns what must always happen (start, claim, checks, merge, stop, record); inside
  a step the agent gets a goal and the checks, not a script.
- **Sources:** [s2] (fixed nodes save tokens and errors), [o5] (secondary: fixed transitions too
  rigid), [a4] (remove structure as models improve), [c1].
- **Disagreement:** Branch C. This is the place where the frontier pulls hardest against fabrika.
- **Fabrika today:** every state machine is explicit and a tea machine
  ([0037](../.decisions/0037-implicit-state-machines-made-explicit.md),
  [0046](../.decisions/0046-one-tea-machine-per-file.md)); the lane's moves are pure code in
  `chain.ts` (today's version); steps answer in five verbs.
- **Lean, 70%:** keep explicit machines for the lane's edges, as Stripe does; do not script inside a
  step.
- **Doubt:** OpenAI's lesson is secondary, and fabrika's own data is two days. **Settled by:** the
  same tickets through today's fixed steps and through one goal-plus-checks agent, compared on
  send-backs, cost and owner looks.
- **Cost:** none to keep; an experiment to test.

### Also: treat the tools as a first-class source of defects

Not a separate principle, but the strongest fit with fabrika's own data. Anthropic's CI and source
control [a2, a3], its quality postmortem [a8], and OpenAI's build-time work [o2] all say the tools
break before the work does. Here, 16 of 31 stuck test-writer runs were `fetch_failed`, the tools
failing (Part 5, today's version). W4's "whose defect" belongs in F3's layers as its own stop
reason. The follow-up study, [experiment 254](./254-how-a-lane-should-stop.md), sorted about 35 of
41 stuck steps on the five longest lanes as tool faults, and
[0076](../.decisions/0076-a-lane-stops-at-its-budget.md) now has every stuck step say its fault,
`tool` or `work`.

## Part 8: the translation

Each name below was checked on main, in code or in a settled note. "Today" is today's version;
"`next/`" is the new one. The ledger's word for a recorded fact is now **event** (renamed
2026-11-08, `.glossary/TERMS.md`); today's code says fact and `kind`.

| Part | Who owns it today | In `next/`, by settled notes |
|---|---|---|
| Decide | The owner sets the order in `docs/plan/` (tiers). The lead picks lanes and files tickets in the tracker (`programs/tracker`, `programs/ticket`; `tracker_file`). A filed ticket is a `filed` fact (`packages/pipeline/src/stages/pipeline/lane-harness.ts:52`). The `triage` step exists in `STEPS` (`packages/pipeline/src/tickets/steps.ts:8`, which `routes.ts` re-exports) but is paused. | Not built. Settled: `ticket`, `tracker`, `triage` ([sort answers yes or no](../docs/direction/sort-answers-yes-or-no.md), [triage asks when worth is unclear](../.decisions/0377-triage-asks-when-worth-is-unclear.md)), `area` and `label`, and a label never routes ([label guidelines](../docs/direction/label-guidelines.md)). fabrika has no priority (the `tier` row). |
| Shape | The plan step's file, approved on its line 1 by the lead when it builds a decided note, or by the owner for a new design call (AGENTS.md). A plan check can send a plan back (`.agents/skills/plan/scripts/plancheck.sh`). | A `plan` with criteria and properties, approved by version and a hash of the ticket's text ([the plan note](../docs/direction/the-plan-stage.md), decided). |
| Do | `test_writer` and `build` steps, run by `drive.ts` and chained by `chain.ts`, which is a tea machine on the Effect engine (`.agents/skills/lead/scripts/chain.ts`, its header). Each step's agent runs in a box. A step signs its commit in a git note. | Steps are tea machines that answer in five verbs ([outcome names](../docs/direction/outcome-names.md)). A step's commit is an `attested` link, which `next/`'s exam already checks (`next/apps/fabrika/src/exam/commits.ts`), and a `committed` event is a settled name ([a unit of work is a commit](../docs/direction/a-unit-of-work-is-a-commit.md)). |
| Check | `mutation` (Stryker), `review`, CI, `leakgrep.sh` and `loosening.sh`, then the lead's hand check on a hit. | `mutation`, `review` and the `exam` ([nobody writes their own exam](../docs/direction/nobody-writes-their-own-exam.md)). A person is asked only for a `judgment` ([jidoka and andon](../docs/direction/jidoka-and-andon.md)). |
| Ship | `catchup.sh`, under the lead, once every step passed ([0014](../.decisions/0014-the-lead-merges-when-every-step-passed.md)). | `ship`, the one merge authority ([ship rules](../docs/direction/ship-stage-rules.md)). |
| Learn | `field/notes/`, `field/runs/` and `field/findings/` (a person rates each finding `fix` or `noise`), with the older rows in the `.jsonl` files, and `.decisions/` through `/adr`. | A `finding` stays a row until Tier 6 ([0035](../.decisions/0035-outside-work-becomes-finding-rows.md)). An `ask` is `asked` and `answered` events, with `needed` marked by a person ([one ask and one meter](../docs/direction/one-ask-and-one-meter.md)). |

Where a person judges, in both versions: the owner sets the goals and the tier order, makes each
new design call and reads real loosening of a law. The lead approves plans that build decided
notes and hand-checks `loosening.sh` hits. Nothing else waits on a person.

What is a tea machine today: today's lane and each step (`packages/pipeline/src/stages/`), and
`chain.ts`. In `next/` none of the loop is built. Its tea machines today are the runtime's, such
as the supervisor (`next/packages/libfabrika/src/runtime/internal/supervisor.ts`).

## What this tells us for fabrika

- The frontier's scarce thing is a person's attention, and here nothing records it. The first new
  fact to record is each look by a person (F1).
- The data here and at the labs agree that the tools break before the work: `fetch_failed`, moved
  branches, boxes that cannot run a check. A stop that cannot say whose defect it is sends a person
  to find out.
- Learning stops at the note. A note names a cause and nothing makes it a ticket, a finding or a
  check. Every frontier team closes that loop the same day (F4).
- fabrika already holds several frontier habits: the repo as memory (F5), one writer at a time
  (F6), a builder that never writes its own exam (F3). Where it pulls against the frontier is how
  much the harness fixes the path (F7), and every PR read by the lead (F3, Branch A).
- The steps record most of the "do" and "check" parts well, and the "decide" and "shape" parts
  barely: who filed, who wrote the plan, the first plan body.

## The first reading: human teams (background)

**Turned down as the lens on 2026-11-10** (0059's amendment of ticket 645), **kept as
background.** The first draft read eleven sources on how human teams get work done. Their tags
carry an `h` in front here so they do not clash with the frontier's. Every source was fetched on
2026-11-10.

```text
how each source does the loop, one line each
Toyota [ht1]        stop the line at the first defect; people do kaizen; by hand before a machine
Lean VSM [hl1]      map every step of the flow before you change one
Lean std work [hl2] write the best current way down; that is what kaizen improves
Shape Up [hs1]      shape and bound the work, bet on it for a fixed time, a circuit breaker ends it
Linear [hn1]        new work lands in triage; small projects, 1-3 people, 1-3 weeks; ship all the time
DORA [hd1]          small changes; count lead time and how often a change fails
Kanban [hk1]        cap work in flight; that cap makes a pull system
Kitchen [ho1]       tickets on a rail; every plate goes through one pass
Surgery [ho2]       the whole team stops at three fixed points: sign in, time out, sign out
Cockpit [ho3]       checklists are the base of crew standard work; do the flow, then confirm
SRE [hp1]           a blameless postmortem after any bad event
```

What they agreed on: stop at the first defect; limit what is in flight and pull new work only when
there is room; shape before you start; ship small; write the current way down and improve that;
learn as a habit and blame no one. The first draft's six principles, W1 to W6, came from that list.
Part 6 shows which of them the frontier keeps. The one clash it named still holds: Shape Up's
six-week bet and Linear's 1 to 3 week projects are sized for people, and an agent does a ticket in
hours.

## What it cannot tell us

- **Almost every frontier number is a company's own claim**, made in public by a company that sells
  the tool. Only METR [m1, m2], Google Research [g3] and the GitHub PR studies [m4, m5] are outside
  measurements, and none of them measures a team where agents write most code.
- **openai.com refused every fetch.** OpenAI's harness, Symphony and usage posts are known here only
  through other pages. Anthropic's November memory post returned 404.
- **Quotes were checked against the page as the fetch tool returned it**, which is a model's reading
  of the page, not the raw text. Each quote should be rechecked by hand before it is leaned on.
- **Google, xAI, Mistral and Meta say little about how their own teams work.** The side-by-side
  table is really Anthropic, OpenAI, Cursor and Cognition.
- **No source is a two-person team.** The labs have dozens to thousands of engineers; StrongDM's
  team was three. What carries over to two people is a judgment.
- **Nothing here measures whether fabrika's steps would be faster or cheaper** under any of these
  principles. F3, F5, F6 and F7 each name the experiment that would.
- **Dropped standups, sprints and PRDs**: no first-hand source was found; that part is a guess.
- **Not checked:** Shopify, Block (goose), Linear's agent work, Vercel, Cloudflare, Amp, Factory
  and Replit. Stripe's minions began as a fork of Block's goose [s1].
- **The clean step data here is two days and 24 tickets.** It may not hold for a month of work.
- **Ticket 574 is one ticket, and an easy one:** it built a decision already made.
- **The owner's time is not recorded anywhere**, so the cost of "a person was needed" is unknown.
- **The person-needed groups come from reading 40 notes by hand**, not from a field.

Dollars spent: $0 on paid model calls for the reading. The research agents and this write-up ran on
a subscription; their rows are in `field/runs/`.

## Sources

All read 2026-11-10. "Sec." means known only through another page.

| Tag | Source | Date | One short quote |
|---|---|---|---|
| a1 | [How the Claude Code team does code review](https://claude.dev/blog/solving-code-review-at-anthropic/) | 2026-10-15 | "We didn't remove review. But we did move most of the reading to machines." |
| a2 | [Redesigning source control at Anthropic](https://www.anthropic.com/engineering/redesigning-source-control) | 2026-10-13 | (numbers only) |
| a3 | [Agentic coding is straining CI](https://claude.com/blog/agentic-coding-is-straining-ci-heres-how-we-scaled-test-impact-analysis-at-anthropic) | 2026-09-14 | "Writing code is no longer the constraint." |
| a4 | [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) | 2026-03-24 | "encodes an assumption about what the model can't do on its own" |
| a5 | [Building a C compiler with a team of parallel Claudes](https://www.anthropic.com/engineering/building-c-compiler) | 2026-02-05 | "I don't use an orchestration agent" |
| a6 | [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | 2025-11-26 | "work on only one feature at a time" |
| a7 | [How AI is transforming work at Anthropic](https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic) | 2025-12 (Aug 2025 data) | "supervising Claude requires the very coding skills that may atrophy" |
| a8 | [An update on recent Claude Code quality reports](https://www.anthropic.com/engineering/april-23-postmortem) | 2026-04-23 | "We never intentionally degrade our models." |
| a9 | [Claude Code docs: agent teams](https://code.claude.com/docs/en/agent-teams) | live | "Agent teams are experimental and disabled by default." |
| a10 | [How Anthropic teams use Claude Code](https://claude.com/blog/how-anthropic-teams-use-claude-code) | 2025-07-24 | "first stop" |
| a11 | [Engineering at Anthropic, index](https://www.anthropic.com/engineering) | live | (dates only) |
| a12 | The components of agent memory, Anthropic | 2026-11-06 | sec.: page returned 404 |
| a13 | CEO forecast of 90% of code, via press | 2025-03 | sec. |
| r1 | [Is 90% of code at Anthropic being written by AIs?](https://blog.redwoodresearch.org/p/is-90-of-code-at-anthropic-being) | 2025-10-22 | (estimate ~50% company-wide) |
| o1 | Harness engineering, OpenAI; via [summary](https://rywalker.com/research/openai-harness) and [InfoQ](https://www.infoq.com/news/2026/02/openai-harness-engineering-codex) | 2026-02-11 | sec. |
| o2 | [Latent Space interview on harness engineering](https://latent.space/p/harness-eng) | 2026-04-07 | "Most of the human review is post merge at this point." |
| o3 | [AI Engineer Europe 2026 talk: Harness Engineering](https://ai.engineer/talks/harness-engineering) | 2026 | "Repository structure is part of the prompt." |
| o4 | [openai/symphony README and SPEC.md](https://github.com/openai/symphony) | repo created 2026-02-26 | "manage work instead of supervising coding agents" |
| o5 | Symphony launch post, via [The Decoder](https://the-decoder.com/openai-says-human-attention-is-the-bottleneck-so-it-built-a-system-to-let-agents-manage-themselves/) and [IT Brief](https://itbrief.co.uk/story/openai-launches-symphony-for-coding-agent-workflows) | 2026-04 / 05 | sec. |
| o6 | [How OpenAI uses Codex (PDF)](https://cdn.openai.com/pdf/6a2631dc-783e-479b-b1a4-af0cfbd38630/how-openai-uses-codex.pdf) | 2025 | "well-scoped tasks that would take you or a teammate about an hour" |
| o7 | [Every podcast: how the Codex team uses Codex](https://every.to/podcast/transcript-how-openai-s-codex-team-uses-their-coding-agent) | 2026-02-18 | "Verification definitely becomes a bottleneck." |
| o8 | [How OpenAI's Codex team works](https://newsletter.eng-leadership.com/p/how-openais-codex-team-works-and) | 2026-02-22 | sec. (interview) |
| o9 | How agents are transforming work, OpenAI, via search excerpts | 2026-06-25 | sec. |
| g1 | [Cloud Next '26, Sundar Pichai](https://blog.google/innovation-and-ai/infrastructure-and-cloud/google-cloud/cloud-next-2026-sundar-pichai/) | 2026-04-22 | "We're now shifting to truly agentic workflows." |
| g2 | [Developer highlights from I/O 2026](https://blog.google/innovation-and-ai/technology/developers-tools/google-io-2026-developer-highlights/) | 2026-05-19 | "We encourage Gemini CLI users to migrate to Antigravity CLI." |
| g3 | [Towards a science of scaling agent systems](https://research.google/blog/towards-a-science-of-scaling-agent-systems-when-and-why-agent-systems-work/) | 2026-01-28 | (numbers only) |
| g4 | [How is Google using AI for internal code migrations?](https://arxiv.org/abs/2501.06972) | 2025-01 | sec. (search summary) |
| g5 | Agent Smith and Jetski, press reports | 2026 | sec. |
| g6 | DORA 2025 report, via summaries | 2025-09 | sec. |
| c1 | [Cursor: Scaling long-running autonomous coding](https://cursor.com/blog/scaling-agents) | 2026-01-14 | "agents became risk-averse" |
| c2 | [Cursor: Towards self-driving codebases](https://cursor.com/blog/self-driving-codebases) | 2026-02-05 | "a small but stable rate of errors" |
| d1 | [Cognition: Don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents) | 2025-06-12 | "Actions carry implicit decisions, and conflicting decisions carry bad results" |
| d2 | [Cognition: Multi-agents, what's actually working](https://cognition.com/blog/multi-agents-working) | 2026-04-22 | "writes stay single-threaded" |
| d3 | [How Cognition uses Devin to build Devin](https://cognition.com/blog/how-cognition-uses-devin-to-build-devin) | 2026-02-27 | "We review the PR, not the logs" |
| s1 | [Stripe minions, part 1](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents) | 2026-02-09 | "at most two rounds of CI" |
| s2 | [Stripe minions, part 2](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2) | 2026-02-19 | "cattle, not pets" |
| f1 | [StrongDM software factory](https://factory.strongdm.ai/) | 2026-02-06 | "Code must not be reviewed by humans." |
| f2 | [StrongDM techniques](https://factory.strongdm.ai/techniques) and [principles](https://factory.strongdm.ai/principles) | 2026 | "Separate interactive work from fully specified work." |
| f3 | [Simon Willison on StrongDM](https://simonwillison.net/2026/Feb/7/software-factory/) | 2026-02-07 | "was always possible, but never economically feasible" |
| r2 | [Ramp: Introducing Inspect](https://ramp.com/blog/introducing-inspect) | 2026-10-27 | "74% of merged PRs" |
| b1 | [Huntley: Ralph](https://ghuntley.com/ralph/) | 2025-07-14 | "One item per loop." |
| b2 | [Hashimoto: My AI adoption journey](https://mitchellh.com/writing/my-ai-adoption-journey) | 2026-02-05 | (paraphrase only) |
| b3 | [Appleton: Gas Town](https://maggieappleton.com/gastown) | early 2026 | (paraphrase only) |
| b4 | [GitHub Spec Kit README](https://github.com/github/spec-kit) | live | "gives AI coding agents structured processes" |
| m1 | [METR: Time horizon 1.1](https://metr.org/blog/2026-01-29-time-horizon-1-1/) | 2026-01-29 | "These confidence intervals are still very wide" |
| m2 | [METR: many SWE-bench-passing PRs would not be merged](https://metr.org/notes/2026-03-10-many-swe-bench-passing-prs-would-not-be-merged-into-main/) | 2026-03-10 | "would not be merged into main by repo maintainers" |
| m3 | METR uplift update, via search excerpts | 2026-02-24 | sec. |
| m4 | [Where do AI coding agents fail? (arXiv 2601.15195)](https://arxiv.org/abs/2601.15195) | 2026-01-21 | "lack of meaningful reviewer engagement, duplicate PRs" |
| m5 | [Let's make every pull request meaningful (arXiv 2601.18749)](https://arxiv.org/abs/2601.18749) | 2026-01-26 | "submitter attributes dominate merge outcomes for both groups" |

Background, the first reading's links:

- [ht1] https://global.toyota/en/company/vision-and-philosophy/production-system/
- [hl1] https://www.lean.org/lexicon-terms/value-stream-mapping/
- [hl2] https://www.lean.org/lexicon-terms/standardized-work/
- [hs1] https://basecamp.com/shapeup/1.1-chapter-02, https://basecamp.com/shapeup/2.2-chapter-08, https://basecamp.com/shapeup/3.4-chapter-13
- [hn1] https://linear.app/method/scope-projects, https://linear.app/method/write-issues-not-user-stories, https://linear.app/docs/triage
- [hd1] https://dora.dev/guides/dora-metrics-four-keys/
- [hk1] https://kanbanguides.org/english/
- [hp1] https://sre.google/sre-book/postmortem-culture/
- [ho1] https://www.escoffier.edu/blog/culinary-arts/more-useful-examples-of-chef-jargon/
- [ho2] https://www.who.int/teams/integrated-health-services/patient-safety/research/safe-surgery/tool-and-resources
- [ho3] https://ntrs.nasa.gov/citations/19910017830
