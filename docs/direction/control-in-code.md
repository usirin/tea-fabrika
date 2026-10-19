# Control lives in code

Decided 2026-10-11. The idea has been there since the start of the repo; this
note states it as the rule.

## What was decided

The whole experiment is one change: take control away from agents and give it
to code.

- **Code holds the loop.** Which step comes next, what to wait for, when to
  stop, when to ask a person.
- **An agent does one bounded job inside the loop.** It writes code, or writes
  review findings, or writes a ticket. It does not decide what the pipeline
  does next.
- **Every agent stage becomes a machine.** Today the operator machine starts
  fabrika's own builder, reviewer and shipper agents. That is a stand-in. The
  goal is a builder machine, a reviewer machine and a ship machine, where code
  does every fixed step and the agent's job shrinks to the part that needs one.

## Who owns what

Three kinds of part, each with its own job:

- **The machine owns the loop and the facts.** Which step we are on, whether
  the tests passed, how many tries are left. It is built on
  [`@demlik/tea`](https://github.com/kamp-us/demlik), on its Effect engine.
- **Agents own the writing.** Rewriting a rough ticket, writing code. Each
  sits behind a small service, so Claude Code can be swapped for another
  agent, or for a script in tests.
- **Jev owns narrow calls.** A small classifier answers one multiple-choice
  question with a confidence. The machine acts on the answer only above a
  floor. See [Jev: the same answer, cheaper](./jev-same-answer-cheaper.md).

## Why

- A stage written as prose can only be carried out by an agent, even when
  every step in it is fixed. The shipper is the plain case: in two measured
  runs it made the same ten calls in the same order with nothing to decide,
  and spent most of its time inside one waiting command.
- Code is cheap, fast, testable and the same every time. An agent is none of
  those.
- Pulling a stage apart into steps shows what is essential in it and what is
  only support.

## What it means for the work

- Treat every agent still in the loop as a stage waiting to become a machine,
  not as the design.
- When choosing what to build next, prefer the step that pulls a decision or a
  wait out of an agent: the wait for checks, the wait for the merge queue, the
  bookkeeping calls.
- A stage does not have to be converted in one go. It can lose one step at a
  time while the pipeline keeps working.

## What would change this

A stage where the steps turn out not to be fixed: where real tickets keep
needing judgment that no rule and no narrow question covers. Then that stage
keeps an agent, and the note should say which one and why.

See also [Rethink, do not port](./rethink-do-not-port.md) and
[One parent, stages as slots](./one-parent-stages-as-slots.md).
