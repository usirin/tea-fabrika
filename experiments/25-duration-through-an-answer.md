# 25. Duration through a person's answer

Parks take typed answers now, triage's as well as the lane's. The duration run
parked at triage again (audience, 0.33: three runs, three parks), and the same
command run again with `ANSWER` set to a person's sort carried it on.

- Triage wrote 3 rules, all about `h` and `m`. The toy's hidden tests hold 8,
  so 6 of them were rules nobody wrote down: `s`, spaces, upper case, decimals,
  a bare number, the order of units.
- The 3 example tests failed on the stub, the builder answered `done`, and the
  hidden tests sent it back with 6 failures. Its second try passed everything.
- **The hidden tests are not hidden.** The feedback is the test runner's
  output, and that holds each failing assertion's expected value. The builder
  said so itself: "I worked out these rules from the failing test names and
  expected values." It passed by reading the answers off the failure report,
  not by being told the rules.

**Took from it:** answers work, and a person's sort is all the duration ticket
needed. But a hidden test that sends back its output is an exam that hands
back the answer key with the grade. What the builder may hear from a hidden
test is open: nothing, the test's name, or the rule it stands for.
