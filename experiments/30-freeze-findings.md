# 30. Freeze the list of findings at the last round

Fabrika's answer to experiment 29, copied: the last round the budget allows
(`FREEZE_ROUND`, round 3) is frozen. Open findings must still be fixed; a new
one is filed and blocks nothing. Neither the matcher nor the router is asked
about it, since nothing they say could block. If the round fails anyway, the
builder sees the late ones as "not required". The freeze round does not move
when a person grants more attempts. Fabrika freezes at the same round
(`CAP_ROUND` in its `retry-budget.ts`).

The same change closes the limit hole of experiment 29: a person's answer that
says the builder was wrong (a finding stands, an example stands, a blocked
builder told what to do) spends an attempt and parks at the limit. One that
says the builder was right (an example fixed, a finding withdrawn) builds
again on the same attempt.

Two real duration runs:

1. Triage parked on audience (0.46). Round 2 raised four findings, all "goes
   beyond the issue" (bare number, decimals, `s` unit and spaces, upper case),
   routed unsure (0.04 to 0.67). Every one is required by a hidden test, so a
   person filed all four. Done in 2 attempts; the freeze was never reached.
2. Triage parked on audience (0.04). The builder answered blocked on attempt 2:
   the hidden tests want rules the ticket leaves open. A person said build
   them, which spent attempt 3. Round 3 was frozen: `inspect_ok` went straight
   to done, no matcher, no router, no park, and both findings were filed.

**Took from it:** the freeze ends the loop, as it does in fabrika. Its price is
visible on this run: one filed finding is a real bug ("1h30" reads as 1h 30s,
3630, instead of 5400 or null) and it did not block. It is on the result, not
lost, but a person has to read the notes. Both runs also show the ticket gap of
experiment 28 again: the rules the hidden tests hold are not in the ticket, so
the reviewer calls them out of scope and the builder calls itself blocked.
