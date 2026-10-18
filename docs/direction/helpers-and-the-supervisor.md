# Helpers, and one supervisor that starts everything

Decided 2026-10-12, written down 2026-10-18.

## What was decided

- **A stage that lacks a fact calls a helper; it does not hand work to another
  stage.** Fixing code goes to the builder because that is building. Getting a
  fact never does. No ping-pong between the main stages.
- **The first helper is a scout:** a small child machine built from the same
  moves. One question in, one fact out: `found` with the raw output it saw, or
  `cannot` with why. It never says pass or fail. A "run this one command"
  question needs no scout: it is a plain Gather.
- **An agent may ask for a helper at any moment, through one tool.** Deciding
  to ask stays with the agent: noticing, timing, the brief, follow-ups.
- **Only the supervisor starts anything.** One supervisor starts every machine
  and every agent run, picks the harness and model per job from the repo's
  configuration, holds the budget and the record, and can say no. An agent's
  tool call is a request to it.
- **No shell allow-lists.** Our own typed reads (show a ticket, a file's
  history, a change's checks) become tools an agent calls directly. Anything
  nobody foresaw goes to a scout. A scout whose answer was one command is the
  proof for a new typed read.
- **Harness adapters are ours and small.** Our contract is for a job, not a
  chat: start with a prompt, tools and a folder; get a typed answer, the cost,
  a way to resume, and the one "ask" tool. Other projects that wrap several
  harnesses are a map of what differs, not a dependency.
- **Asks are counted per run,** because an agent can over-ask.

## Why

- A reviewer with no shell could not see a line that needed a command, and the
  first idea was to send it back to the builder. That moves a fact-finding job
  to the wrong stage and starts a loop between two agents.
- With the pipeline held in code, the harness is something you swap per job.
  If agents ran the pipeline from inside a harness, every harness would need
  its own plugin and copy of the rules.

## Still open

- Whether stage code may name a harness at all (lean: no; Claude is one runner
  behind the door).
- What kinds of helper exist besides a scout, and what keeps the scout from
  becoming a catch-all.
- An ask that does not stop the asker while the helper runs.

## What would change it

A reviewer that often grades lines it could not have seen, because asking was
too costly.
