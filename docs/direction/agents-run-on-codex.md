---
state: "decided 2026-10-27; default model changed, recorded 2026-11-01; drivers and runners, 2026-11-08"
summary: "Today's version: plan, test writer, build and review run through Codex on `gpt-6-astra`, effort high, the default in the code; opus stays for the main session a person talks to. Triage stays on opus until experiment 159 says the Codex model answers as well. Hand-run steps (owner, 2026-11-08): Codex runs step work, a Claude agent runs a step that needs Electron or a socket, and one Claude driver per ticket starts one agent per step and merges only after all five steps ran, review merge-ready, CI green and a clean leak grep. The doubt: how many Codex jobs one person can run at once."
---

# Stage agents run on GPT sol through Codex

Decided 2026-10-27 by the owner. It replaces
agents run on opus, for now for every
stage but triage, which waits on experiment 159.

*Changed 2026-11-01, about today's version: the default model is now `gpt-6-astra`,
effort high. The list below is what `DEFAULTS` says in
`packages/pipeline/src/stages/pipeline/agents.ts`, landed with pipeline v0. The older
path's `AGENT_DEFAULT` in `packages/pipeline/src/setup.ts` still says opus, effort
medium. "GPT sol" below is the model this note was written about.*

```ts
// From the code. The budget is per run.
const DEFAULTS = {
	triage: {harness: "claude", model: "opus", effort: "medium", usd: 2},
	plan: {harness: "codex", model: "gpt-6-astra", effort: "high", usd: 10},
	exam: {harness: "codex", model: "gpt-6-astra", effort: "high", usd: 10},
	test_writer: {harness: "codex", model: "gpt-6-astra", effort: "high", usd: 10},
	build: {harness: "codex", model: "gpt-6-astra", effort: "high", usd: 10},
	review: {harness: "codex", model: "gpt-6-astra", effort: "high", usd: 10},
};
// The main session, the one a person talks to, stays on opus.
```

## What was decided

- **Every stage agent runs on GPT sol, through Codex.** Plan, test writer,
  build and review.
- **Opus stays for the main session.** That is the agent a person talks to,
  the one that decides and reports. Stages are bounded jobs inside a machine;
  the main session is not.
- **Triage stays on opus until experiment 159 answers.** It is the one stage
  where we measured that the model matters: in experiment 135 opus closed 32
  of 58 real "no" tickets where sonnet closed 6. Experiment 159 runs the same
  cases on GPT sol. If it matches opus, triage moves too.
- **The harness and model stay settings.** Each stage picks them in
  `fabrika.toml`, as [one fabrika.toml per repo](./one-fabrika-toml-per-repo.md)
  says. This note changes the defaults, not the shape.
- **How a hand-run step runs** (owner, 2026-11-08). Codex `gpt-6.1-sol`, effort xhigh,
  standard tier, beside Claude subagents, under the same caps as any code agent
  ([go easy on the machine](../../AGENTS.md#go-easy-on-the-machine)). Step agents (plan,
  exam, test writer, build, review, mutation fixes) run on Codex; the lead stays on Claude
  opus. *Replaced the same day, below: "Claude subagents only read and audit" no longer holds.
  A Claude agent runs a step that needs Electron or a socket, and one Claude driver carries each
  ticket.* *Changed the same day (owner): this line first said "priority tier", and the call
  below passed `-c service_tier=priority`. Runs now use the standard tier, since priority burns
  the subscription's quota.* The call, with the brief on stdin:

  ```sh
  codex exec -m gpt-6-astra -c model_reasoning_effort=medium \
    -s workspace-write -C <dir> --json -o <last.md> -
  # -p is a profile in codex, not a prompt
  ```

  *Changed 2026-11-09 (owner, [0022](../../.decisions/0022-codex-steps-run-on-astra-at-medium.md)):
  the default is now `gpt-6-astra` at effort `medium`, set in the lead's `env.sh`; it was
  `gpt-6.1-sol` at `xhigh`, and the call above first said so.*

- **How a Codex step commits** (owner, 2026-11-08, from P10 on). Codex's `workspace-write`
  sandbox keeps `.git` read-only, even with `--add-dir`. So each step gets its own clone whose
  git data sits outside any folder named `.git`, and the step commits and signs there itself.
  The lead only fetches from a step's clone and never runs git inside one. The lead pushes as
  the bot, with a 1-hour token that may push only to `fabrikalfa/*`
  ([agents commit as a bot](./agents-commit-as-a-bot.md)). *Until 2026-11-08 the step left its
  changes in the working copy and the lead committed them as the bot.*

- **Who runs which step, and one driver per ticket** (owner, 2026-11-08, later the same day).
  It replaces "Claude subagents only read and audit" above.
  - Codex runs step work: plan, tests, build, mutation and review, each its own agent.
  - A Claude agent runs any step that needs Electron or a socket: laws or shots that start the
    app, or that bind a socket. A Codex box can start neither, so a Codex step there comes back
    half checked. Still one agent per step. *Changed 2026-11-09
    ([0045](../../.decisions/0045-test-steps-run-in-containers.md)): a tool that binds a socket
    runs in a container with its own network, on no agent's sandbox row, starting with the mutation
    step's Stryker run. Electron stays on a Claude agent.*
  - One active Claude driver per ticket carries it until a wait. It starts one agent per step on
    the runner above, and never writes a step's code or tests itself. At a Codex box, parent build,
    CI, plan approval or owner-read wait, it saves completed field work and atomically replaces
    `$BOXES/state/<name>.md`, then ends its session. Background commands may keep running.
    Lead checks the saved clearing fact and starts a fresh driver with that file and brief.
    The fresh driver reads the current branch, SHA, reports and checks. It does not rerun completed
    steps or duplicate listed field rows. Missing or unclear state sends it back to those facts.
    A driver is not the lead session: every plan and amendment returns unsigned after the draft
    check, then waits for the lead session's own read and signature. See
    [the lead skill](../../.agents/skills/lead/SKILL.md).
  - The driver merges its own pull request only after plan, tests, build, mutation and one review
    all ran, each by its own agent, with the review saying `merge-ready`, CI green and a clean leak
    grep. No step is skipped. A new design call or an exam read goes back to the lead.
  - The steps and their scripts are the skills in `.agents/skills/`, with
    [the lead's skill](../../.agents/skills/lead/SKILL.md) for the driver.

## Why

- **The goal changed size.** fabrika should build fabrika all day, many lanes
  at once. On a subscription, Codex costs a flat fee; Claude at that volume
  costs far more.
- **Code holds each step tight.** A stage gets one job, a short prompt, a box
  and a check on its answer. That is the setting where a cheaper model can do
  as well. The 10-24 note already left the builder's seat open for this
  reason.
- **The path exists.** Experiment 156 settled the Codex adapter
  (`codex exec --json`), and 153 showed how to contain it.

**How sure: 75%.** The doubts:

- Nothing has run GPT sol on our own stages yet. Experiment 159 is the first
  measure, on triage.
- **How many Codex jobs one person can run at once.** Experiment 157 lends a
  person's Codex login to a box one job at a time, because the login rotates
  its refresh token. That caps the lanes a person can run in parallel.
  - *Checked 2026-10-27 against OpenAI's docs:* an API key bills at API
    rates, never against a plan
    ([Codex auth](https://learn.chatgpt.com/docs/auth#sign-in-with-an-api-key)).
    OpenAI says not to share one login file across parallel jobs or machines
    ([CI auth](https://learn.chatgpt.com/docs/auth/ci-cd-auth#operational-rules-that-matter)),
    and not to use that way for public repositories. Business and Enterprise
    workspaces get a Codex access token, `CODEX_ACCESS_TOKEN`, made for headless
    jobs ([access tokens](https://learn.chatgpt.com/docs/enterprise/access-tokens)).
    Personal plans have no such token. Which way we pick is still open.
  - *Lending a login stays safe only while no agent with it reads text a
    stranger wrote.* Tickets come from our own tracker, which only we write
    to. A stage agent that reads public pull request comments would break
    that, so one needs this note changed first.

## What it changes

- A default per stage. Built 2026-10-31 for pipeline v0, as `DEFAULTS` above.
  `AGENT_DEFAULT` in `packages/pipeline/src/setup.ts` (opus, effort medium) stays
  for the older path.
- Experiments that measure a stage run it on GPT sol first, with opus as the
  comparison.

## What would change it

- Experiment 159, or a later run on plan, build or review, where GPT sol
  misses what opus catches on the same cases.
- A Codex limit that keeps lanes from running in parallel, with no way
  around it.

## What it cannot tell us

- Whether GPT sol plans as well as opus. Plan's answers are long and judged
  by a person, so no saved set measures them yet.
- Cost on our own lanes. Nothing has run end to end on Codex here.
