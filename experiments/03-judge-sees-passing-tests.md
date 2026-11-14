---
date: "2026-10-04"
summary: "`duration-open` went from 0 of 5 runs finishing to 8 of 10. An undone, untested criterion still came back \"not met\" at 0.99."
---

# 3. Show the judge the passing tests

The judge was first shown only the diff. Adding the names of the tests that
passed took `duration-open` from 0 of 5 runs finishing to 8 of 10.

`03-judge-rubber-stamp.mjs` checked the worry that it would now say "met" to
anything with green tests. It did not: for a criterion that was not done and
had no test, it said "not met" at 0.99.
