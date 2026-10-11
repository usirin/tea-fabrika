# 26. What may the builder hear from a hidden test?

`26-hidden-feedback.ts` builds the duration toy from its hand-written ticket (3
rules) 15 times, 5 for each way a failed hidden test is answered: the runner's
`full` output, the failing tests' `name`s only, or `ticket`, where a triage
turn shown only the failing test's name writes the missing rule an example and
it joins the visible tests. The finished code is then scored on 20 held-out
tests: the hidden tests' rules with other values, never run during the build.
A stub that returns `null` scores 7 of them.

| Way | Passed the hidden tests | Builds (mean) | Held-out (mean) | Triage's examples right |
|---|---|---|---|---|
| full | 5/5 | 2.0 | 20/20 | - |
| name | 5/5 | 2.2 | 20/20 | - |
| ticket | 5/5 | 2.0 | 20/20 | 20/20 |

All three hit the ceiling, so the toy cannot tell them apart. Every hidden
test's name is its rule in words ("units can be upper case"), and every rule is
the obvious convention, so the name is all a builder needs and the leaked values
add nothing. In the ticket way, triage wrote the same four examples in all five
runs, all right.

What it does show: leaking the values did not make the builder copy answers
instead of learning rules, here. The case where the ways would split is a rule
whose specifics only the expected value carries, like a free-shipping line of
50 that no name or ticket mentions. There, full output passes by reading the
answer, and name or ticket cannot pass at all: the builder and triage would
both have to guess the 50.

**Took from it:** the leak is harmless when the test names state the rules, and
decisive when they do not. Whether it is cheating depends on what the hidden
tests are for. A repo's own tests are ordinary feedback: a person reads their
failures too. A held-out acceptance check stops being one the moment its values
are read.
