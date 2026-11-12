# The inbox program

The thin inbox program for `next/`, built on [0151](../../../.decisions/0151-a-thin-inbox-is-a-tier-1-row.md).
Slice 1 holds notices from the brain as rows in a program view. It shows nothing on screen and
has no boot entry.

[`src/program.ts`](./src/program.ts) holds one pure tea machine and its `Program.make` declaration,
named `fabrika/inbox`. The package is `@kampus/inbox`.

## Rows and letters

The model is `{ rows }`. An `added` letter carries the fact's `id`, its ledger address
`fact: { stream, rev }`, the new device's `window` key, `method: "email"`, its claimed `location`
and the fact's `arrivedAt` time. A row keeps all those fields with `_tag: "added"`.

A new id appends one row. A repeated id keeps the first row, even if the later letter has different
fields. Rows stay in first-arrival order. The view is `{ rows }`, checked by `inboxView`.

The runner saves and loads the model with `state: { v: 1, upgrades: [] }`. A fresh model has no
rows. The machine returns no Cmds and asks for no wake time.

## Who may send

`inputs: {}` declares no port. A person, an agent and a recovered device cannot send `added`
through `process.send`. The brain supplies saved letters through the ledger's inbox, and the
runner folds them into the model. The program writes no facts and has no outputs.

Slice 1 does not connect email recovery to these letters. The gateway's delivery and the boot
entry belong to slice 3. The window and dismissal saved on each device belong to slice 2.
Asks, messages, replies, the top bar glance and the phone view stay in later tiers.

## Laws

[`src/program.laws.test.ts`](./src/program.laws.test.ts) checks I1, one row per fact; I3, no input
names; and I4, the view schema. [`src/RunnerTest.ts`](./src/RunnerTest.ts) checks I2 at the real
runner. The app runs that suite over SQLite in
[`inbox-runner.laws.test.ts`](../../apps/fabrika/src/inbox-runner.laws.test.ts).
