# Ship stage rules

Decided 2026-10-11, while designing the ship machine. One rule added
2026-10-18. The full design is [`docs/ship-machine.md`](../ship-machine.md).

## What was decided

- **A closed or draft pull request is never shipped.** It ends as a `skip`
  (`closed` or `draft`), and a person is told.
- **Open comments on a pull request:**
  - a person wrote or joined it → ask that person (`ask:commenter:comment`);
  - only a bot wrote it → back to the builder (`send:builder:bot_comment`).
  - Nothing is closed silently, and ship makes no judgment call. Count how
    often each happens; if bot comments are common, "real problem or nit?" is
    a narrow question for Jev.
- **Red checks are run again once per head** before the builder is called.
  Red again → `send:builder:checks_red`. A re-run that cannot be asked for
  counts as red.
- **A branch behind main ships as it is.** Ship trusts the code host's "can
  this merge" answer, and the merge queue tests it on top of main. The gate has
  no "behind" line, on purpose.
- **Checks still running are waited for, with a limit.** Pending is only early.
  At the limit it ends `stuck:checks_stuck`.
- **The merge-queue wait has a limit too.** At the limit it ends
  `stuck:queue_silent`, and says the pull request may still be in the queue.
  Ship never pulls a pull request out of the queue.
- **A repo with no merge queue** (2026-10-18) is one more step, not a design
  question: ship merges straight in, at the head the gate passed.

## Why

- A re-run costs minutes and no money. A builder run costs both, plus a new
  review. In the logs, 9 of 13 red-check stops shipped with no new code.
- 31 recorded runs stopped for "behind main", and 10 then shipped with nothing
  else done (experiment 55).
- A machine that waits costs nothing.
- In 3 recorded runs the queue never answered.

## What would change it

Real runs where a re-run of red checks rarely turns green, or where bot
comments sent back to the builder are mostly noise.
