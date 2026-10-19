# Every machine has laws

Decided 2026-10-18.

## What was decided

- **Every machine has laws:** short rules that must always hold ("a merge is
  only sent when every criterion is met at this head and CI is green").
- **A checker walks every message order** through the real reducer, up to a
  bound, and checks each law after every step. A broken law prints the
  shortest message sequence that breaks it.
- **It is enforced, not asked for.** A machine with no laws fails the test
  suite, and a law spec fails if any message type is never sent during the
  search, so a law cannot pass only because its breaking message never came.
- **Every law is seen to fail once,** on a planted mistake, before it is
  trusted.

## Why

- The owner approves plans, not PRs. Trust in a PR has to come from
  verification and from shapes that make a wrong state impossible.
- tea machines are pure reducers and every outside input is a message, so the
  real code can be checked directly. No separate model language, nothing to
  keep in sync.
- The first run (experiment 90) found five real breaks in the ship, review and
  loop machines, and caught all seventeen planted mistakes within seven
  messages. A normal check takes under two seconds per machine.

## What would change it

Machines whose state grows too fast to search at a useful depth, or laws that
keep passing while real runs go wrong.
