# demlik is the first real repo

Decided 2026-10-18.

## What was decided

- **Real lanes run on [kamp-us/demlik](https://github.com/kamp-us/demlik).**
  That is where the machine meets real rules: branch protection, CI, the merge
  queue, its own rules for agents.
- **Today's fabrika is the fallback.** It can redo anything the machine leaves
  half done.
- **The sandbox-only rule is gone.** From 2026-10-17 the machine could write to
  one sandbox repo only. That lock was removed on 2026-10-18 (experiment 83).
- The live-run rules in [`AGENTS.md`](../../AGENTS.md) still hold: the target
  repo's merge rules apply, and a change lands only through the ship stage.

## Why

- A sandbox has no real constraints, so it cannot show what breaks.

## Still to do

- The proof a merge carries should name the main it was tested on, so a repo
  with no merge queue cannot land on a main nothing tested.

## What would change it

A run on demlik that does harm today's fabrika would not have done.
