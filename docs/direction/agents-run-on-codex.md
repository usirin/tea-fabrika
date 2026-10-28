# Stage agents run on GPT sol through Codex

Decided 2026-10-27 by the owner. It replaces
[agents run on opus, for now](./agents-run-on-opus-for-now.md) for every
stage but triage, which waits on experiment 159.

```ts
// A sketch: who runs on what, from today.
const stages = {
	triage: {harness: "claude", model: "opus"}, // until experiment 159 says GPT sol answers as well
	plan: {harness: "codex", model: "gpt-6.1-sol"},
	test_writer: {harness: "codex", model: "gpt-6.1-sol"},
	build: {harness: "codex", model: "gpt-6.1-sol"},
	review: {harness: "codex", model: "gpt-6.1-sol"},
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

- `AGENT_DEFAULT` in `packages/pipeline/src/setup.ts` (opus, effort medium)
  becomes a default per stage. Not built; it lands with the slices of the v1
  plan ([a ticket runs from the app](./a-ticket-runs-from-the-app.md)) that
  make each stage real.
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
