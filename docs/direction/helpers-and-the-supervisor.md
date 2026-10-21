# Helpers, and one supervisor that starts everything

Decided 2026-10-12, written down 2026-10-18. The supervisor part was replaced
2026-10-20; the title is kept so links still work.

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
- ~~**Only the supervisor starts anything.** One supervisor starts every machine
  and every agent run, picks the harness and model per job from the repo's
  configuration, holds the budget and the record, and can say no. An agent's
  tool call is a request to it.~~ **Replaced 2026-10-20: there is no fabrika
  supervisor.** Its jobs are split by layer:
  - starting a run is tea-host's `DynamicSupervisor` (`start_child`); an
    agent's ask for a helper is a request to it;
  - restarting a crashed run is tea-host's OTP supervisor (experiments 99,
    100);
  - the harness and model are the child spec, filled from `fabrika.toml`;
  - the record is the ledger;
  - ~~saying no is a program's `limits`, enforced by its host
    ([tea-program](./tea-program.md)).~~ **Changed 2026-10-21 by experiment
    102:** saying no is `limits` on the child spec (a top-level name gets them
    from `setLimits`), counted and enforced by the ledger; the host only
    reports what it spent and checks before each turn. A host can die
    mid-spend, so only the ledger can keep the count.
  "Supervisor" now means OTP's only.
- **No shell allow-lists.** Our own typed reads (show a ticket, a file's
  history, a change's checks) become tools an agent calls directly. Anything
  nobody foresaw goes to a scout. A scout whose answer was one command is the
  proof for a new typed read.
- **Our contract with a harness is ACP** (decided 2026-10-19), the Agent
  Client Protocol: a standard comes before one of our own. The job on top of
  it stays ours: start with a prompt, tools and a folder; get a typed answer,
  the cost, a way to resume, and the one "ask" tool.
- **Each harness's ACP adapter comes from, in this order** (2026-10-19):
  - the official adapter, pinned and at least two weeks old, if it can be
    contained (its real tools and folder, nothing from the user's own setup);
  - otherwise our own, small, built from the per-harness code Tuval already
    has (`tuval-codex`, `tuval-pi`, `tuval-agy` each translate a harness into
    one shape);
  - never a community wrapper. Projects that wrap many harnesses are a map of
    what differs, not a dependency.
  - Where things stand: Claude has an official adapter we ran (experiments 76
    and 77). Codex's official one could not be contained. pi and agy have
    only community ones, so theirs would be ours; agy's terms may forbid
    wrapping its CLI at all.
- **Asks are counted per run,** because an agent can over-ask.
- **MCP is the tools protocol** (decided 2026-10-18). Tools reach an agent
  over MCP; tsh will serve each listed program as one
  ([tsh](./tsh-a-shell-for-tea-programs.md)). A standard protocol comes before
  one of our own.

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
- When ACP becomes the default path. Experiments 76 and 77 put it behind
  `--harness acp`; the Agent SDK path is still the default.

## What would change it

A reviewer that often grades lines it could not have seen, because asking was
too costly.
