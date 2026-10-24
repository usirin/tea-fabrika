# Agents run on opus, for now

Decided 2026-10-24 by the owner.

```ts
// Sketch: who runs on what today.
const today = {
	triage: {model: "opus"},  // the entry point: no cheap model here
	plan:   {model: "opus"},  // AGENT_DEFAULT in packages/pipeline/src/setup.ts
	review: {model: "opus"},
	build:  {model: "opus"},  // the one open seat: builder-type agents may move later
};
// Cheaper comes from a narrow question asked of Jev, not from a smaller LLM.
judge("is_duplicate", {ticket, candidates}); // one Judge call instead of part of an agent turn
```

## What was decided

- **Every agent that reasons runs on opus for now.** Triage, plan and review.
- **Builder-type agents are the exception.** A builder mostly follows
  instructions, so a model that reasons less may do. Which one is open, and
  today's default for build (opus, effort medium) stays until a run says
  otherwise.
- **Triage runs on opus.** It is the entry point: every ticket passes through
  it, and a wrong answer there sends the whole run the wrong way.
- **Cheaper is Jev's job, not a smaller LLM's.** Jev is a classifier built for
  narrow decisions. No haiku or sonnet answers one of those cheaper or faster
  than it does. So a cost cut is a narrow question taken out of an agent's
  turn and asked of Jev, measured as [Jev: the same answer,
  cheaper](./jev-same-answer-cheaper.md) says.
- **Other setups are tried later, by experiment,** once the Codex backend
  runs: other models, other harnesses, the builder's seat first.

## What it changes

- **Triage gets a default.** Today `AGENT_STEPS` is `plan`, `build` and
  `review` (`packages/pipeline/src/settings.ts`), so triage has no default and
  takes whatever it is handed. Experiment 111 handed it haiku at low effort to
  test the wiring, and that was later read as the machine's setting. Triage
  joins `AGENT_STEPS` with the rename from sort, and so gets opus.
- **Experiment 135's fifth point is overruled.** It said to keep haiku for
  triage, at 60%. The write-up stays as it is; its haiku numbers still say
  how a small model reads triage's bar.
- **Experiment 138 was stopped before any paid call.** It would have tested
  haiku against sonnet on 88's 66 yes tickets. With triage on opus, that
  question no longer matters.

## Why

- Triage reads the least trusted and least shaped text in the pipeline, and
  On real "no" tickets sonnet had missed, 135 showed opus closing 32 of 58
  answers where sonnet closed 6, with no more "no" to built work.
- The money is small next to a wrong start. A first triage costs about $0.11
  on opus against $0.06 on sonnet (135), and a ticket sent the wrong way costs
  a plan, a build and the owner's time.

**How sure: 85%** that opus is right for triage today. The doubt is cost at
scale, which Jev is meant to answer, and the builder's seat, which is open on
purpose.

## What would change it

- A run where another model or harness matches opus on the same cases, as
  measured on the Codex backend.
- A Jev question that agrees with opus well enough to take a decision out of
  triage's turn.
