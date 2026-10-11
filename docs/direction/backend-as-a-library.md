# The backend is a library

Decided 2026-10-10.

## What was decided

In the next version, fabrika's backend (ticket state, the ledger, the guards,
the stops) is a library of typed Effect services that code imports. It is not a
command-line tool that drivers and agents start as a separate process.

That is why the operator machine talks to a typed `Fabrika` service. Today the
live implementation of that service wraps the existing command-line tool. That
wrapper is temporary; the service's types are the contract.

## Why

- In the first two live runs the machine started 60 and 83 separate
  command-line processes, more than half of them re-reading the same ticket
  state, and the wrapper had to map 31 exit codes by hand.
- The worker agents called the tool even more often than the machine did, and
  most of those calls asked for something the machine already knew.
- A typed call can be checked by the compiler and faked in a test. Printed text
  and exit codes cannot.

## Today's tool is already half of a state machine

Noted 2026-10-11. Look at any command of today's tool with its exit codes: it
takes an input and ends in one of a small, fixed set of outcomes. "Enqueue this
pull request" ends as armed, not mergeable, base conflicted, not ours, or
unknown. That is a command with a typed result, written as a process and a
number.

The other half is in the skills. Most of a skill's prose is a table: on this
exit code do that, on that one start over, on this one stop and name the
cause. That table is a state machine's step function, written in prose and
carried out by an agent. The commands that fold an event into a ticket's log
are step functions outright.

So the move to a library is smaller than it looks. The outcomes already exist;
they become a typed union instead of a number. The table already exists; it
becomes code instead of prose. What is left for an agent is the part of a
skill that was never a table.

## What it means for the work

- Design new pieces around service methods, not command-line verbs.
- What a skill does today by calling the tool becomes either a machine-side
  step (the machine already knows the answer) or a typed tool handed to the
  agent.
- When explaining a run, say plainly which parts are this repo's machine and
  which are today's fabrika behind the wrapper.

The first draft of the services, written from run logs, is in
[`docs/fabrika-sdk.md`](../fabrika-sdk.md).
