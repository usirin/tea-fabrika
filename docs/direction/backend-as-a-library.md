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

## What it means for the work

- Design new pieces around service methods, not command-line verbs.
- What a skill does today by calling the tool becomes either a machine-side
  step (the machine already knows the answer) or a typed tool handed to the
  agent.
- When explaining a run, say plainly which parts are this repo's machine and
  which are today's fabrika behind the wrapper.

The first draft of the services, written from run logs, is in
[`docs/fabrika-sdk.md`](../fabrika-sdk.md).
