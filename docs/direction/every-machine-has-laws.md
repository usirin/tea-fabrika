# Every machine has laws

Decided 2026-10-18.

*2026-10-22: one machine at a time is not enough on its own. A checker that
walks one machine cannot see a bug between machines, such as the hosted
lane's hang. The world search and a property test on the real parts found it
(experiments 115 and 116). How every check is made, for one machine or many,
is now [Five steps for every check](./five-steps-for-every-check.md).*

*2026-10-22, later: the checker moves out to its own package in demlik, and
the laws stay with their machines. See
[The checker is a tea package](./the-checker-is-a-tea-package.md).*

*2026-10-23: random walks, which are property tests, replace the walk through
every message order for new work (experiment 119). Every machine still has
laws, and every law is still seen to fail once. The walks do not yet fail a
suite when a message type is never sent, as the search does, so a law could
pass only because its breaking message never came. That check goes into the
walks before any new law relies on them.*

*2026-10-23, later: new laws use tea's `@demlik/tea/pbt`, and the checker
that tries every order is an experiment, fenced so nothing new imports it. See
[Property tests, not our own search engine](./property-tests-not-our-own-search.md).
tea's strict table, one generator per Msg type, makes a type that is never
generated a compile error.*

*2026-10-25: the rule held only where the suite looked. Its scan,
`packages/pipeline/src/laws/standard.test.ts`, reads `packages/pipeline` and
the agents, so six machines in the app, the programs and tsh slipped past:
the desk, the editor, the tracker, the counter, tsh's jobs and its small
machine. Only the desk has property tests, and they are not registered.
Lane 1 of the app changed tsh's jobs machine and added no law. The fix is a
wider scan, not a reminder. A first try at it was wrong: Lane 2 was told to
write the laws for the machines it changes, which breaks
[Nobody writes their own exam](./nobody-writes-their-own-exam.md). It was
stopped before it wrote any. The laws for every app machine come in a pull
request of their own, from an agent that did not write the code, and the
owner reads them. Also decided: this repo's main branch stays
without protection for now. It is the lab, and which checks block a merge in
kamp-us/fabrika, and which only advise, is tried here first.*

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
