# 16. Correction: the agents had a shell

Every agent turn was started with `--allowedTools Read Glob Grep` (plus the
edit tools for writers). That flag pre-approves tools. It does not take the
others away. The agents kept a shell, and where a toy's own test file had been
deleted from the folder they ran `git show HEAD:slugify.test.js` and read it
out of history.

The session logs say how often:

| Agent | Sessions | Looked at git or the test files |
|---|---|---|
| Test-writer | 63 | 46 |
| Triage (enricher) | 73 | 50 |
| Builder | 40 | 1 |

So wherever this log says an agent "never saw the toy's own tests", that was
not true for most runs of experiments 7, 9, 10, 11, 12 and 13.

Fixed in `src/claude.ts` (`--tools` names the only tools an agent has; checked:
it reports no shell) and in `checkoutToy`, which can now leave files out before
the first commit, so they are not in the history at all.

Rerun with the shell gone:

| Experiment | Before | After |
|---|---|---|
| 9. Test-writer, hand-written criteria: good tests | 48 of 48 | 48 of 48 |
| 11. Hidden tests: cheats caught | 24 of 33 | 27 of 36 |
| 11. Hidden tests wrong on correct code | 0 of 90 | 0 of 90 |
| 13. Triage may read the toy's tests: broken versions caught | 33 of 33 | 33 of 33 |
| 13. Triage has only the ticket: criteria written | not run | 32 |
| 13. Triage has only the ticket: broken versions caught | not run | 18 of 33 |

The test-writer and the hidden tests hold up: given good criteria, the writer
did not need to copy. The same three cheats slip past the hidden tests, all on
the seconds unit no criterion mentions.

Triage is the one that changes. From the ticket alone ("parseDuration always
gives null. i need it to turn things like 1h30m into seconds") it wrote half as
many criteria, and the tests caught 13 of 15 broken slugify versions and 5 of
18 duration ones. Two of its tests failed on the reference code: it decided a
title that is already a slug stays as it is, and the reference drops the dash.
Neither is wrong; the ticket does not say.

Everything about the judge stands as written. Those runs score Jev on tests
with known answers, and who wrote the tests does not change the score.

**Took from it:** the chain from criteria to tests to code is sound. What goes
in is the limit: a thin ticket gives thin criteria, and no later stage can add
a rule nobody wrote down. And check what a tool flag does before trusting an
experiment to it.
