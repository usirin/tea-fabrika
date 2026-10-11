# 23. Kill a real build, start it again

`src/restart.test.ts` kills the lane after every step with scripted agents.
This is the same with real Claude Code and real Jev: `pnpm demo` with
`AGENT=claude TOY=slugify RUN=<folder>`, a SIGINT five seconds after the
builder's `claude -p` started, then the same command again.

- The saved state said `building`, with the builder's conversation id picked
  before the build.
- The second run sent `resume`, and the lane sent the build again. Claude's own
  log of that conversation holds both turns: the killed one at 03:41:57 and the
  new one at 03:42:05. Claude had saved the conversation before the kill, so
  `--resume` found it and the fallback to `--session-id` was not needed.
- The lane then ran the tests and asked the judge, and parked: the judge was
  unsure (0.25) about "accented letters are dropped". That park is the judge's,
  not the restart's.

Two tries before it did not reach the kill. On `TOY=duration`, triage parked
first: Jev was unsure whether the ticket was for an agent (0.29), and a triage
park has no answer path yet. On a slugify run with a 20 second wait, the
build had already finished.

**Took from it:** the restart works with real agents. Still untested for real:
a kill before Claude saved anything, which takes the `--session-id` fallback.
Only the unit tests cover it. Triage parks need an answer, as lane parks have.
