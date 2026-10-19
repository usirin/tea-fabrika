# Make the mistake impossible

Decided 2026-10-12. Parts of it were set earlier, on 2026-10-04 and 2026-10-05,
and written down here on 2026-10-18.

```ts
// Not protection: a sentence someone has to remember.
// "Only pass inputs that ack to workQueue."

// Protection: the wrong call does not compile. (A sketch of wip/src/stages/queue.ts.)
// workQueue takes a Stream<Delivery<string>>, and only an input declared
// { ack: "manual" } hands out deliveries.
workQueue(machines.queue, inputs.pr, shipOne, clearOne);   // pr acks: fine
workQueue(machines.queue, inputs.note, noteOne, clearOne); // note does not ack: type error
```

## What was decided

- **A rule future work must keep is held by the code**: a type, a refusal at
  run time, or a test that fails. Also called poka-yoke.
- **A warning, a doc line, a log line or a prompt is not protection.** Notes
  are where a rule starts. A rule that matters ends up in code (2026-10-05).
- **A guard ships with what it guards**, never after it. A risky form ships
  only in a version that cannot fail that way.
- **A prompt is not a fence** (2026-10-04). An agent is limited by what it can
  actually reach: its real tool list and its folder. Anything it must not read
  must not be anywhere it can reach, history included. Check what it did in
  the session log, not in the config.
- **A skipped check never looks like a clean one** (2026-10-05). If a limit or
  a failed reader switches a check off, the record says it was skipped and why.

## Where it already shows

- A kept program does not type-check without its id and storage
  ([tea-program](./tea-program.md)).
- `workQueue` takes only inputs that ack (2026-10-18).
- Every ledger shape is built on the entity base, or a test fails
  ([the smallest ledger](./smallest-ledger-proof-to-grow.md)).
- An outcome name is a type ([five verbs](./outcome-names.md)).
- A merge takes only a proof value that can exist only when every criterion is
  met at the head ([done is per criterion](./done-is-per-criterion.md)).
- A machine with no laws fails the suite ([laws](./every-machine-has-laws.md)).

## Why

- An agent, or a person in a hurry, takes the cheap path. A written rule is
  the kind that does not hold: today's fabrika had rules in prose against its
  review text growing, and the text grew anyway
  ([experiment 59](../../experiments/59-how-the-review-skill-grew.md)).
- In the first days, agents told in their prompt not to read deleted tests
  read them through the shell anyway, in most sessions. Only taking the shell
  away stopped it.

## What would change it

A guard that costs more to build and keep than the harm it stops, on a
mistake that has never happened.
