# 24. The test-first lane, end to end

The lane no longer asks Jev whether a diff meets a criterion. Triage writes
each criterion as data (experiment 19's brief, plus the file and the function
to import), code writes the tests, they run once on the untouched code, and the
builder works against them locked. Experiments 1 to 18 measured the old prose
criteria; their scripts read `criterion.text` and run as they were at commit
`7c37230`.

One real run each, `AGENT=claude`, real Jev for the sort:

- **slugify:** triage wrote 6 rules, each with one example, and all 6 failed on
  the stub. The builder answered `done` on its first try, and the 6 tests plus
  the toy's own 3 passed. No person or model judged anything after triage.
- **duration:** triage wrote 3 rules (hours and minutes, `h`, `m`), then Jev
  sorted the ticket as for a person at 0.32 and triage parked, the same as in
  experiment 23 (0.29). Two runs, two parks: this ticket does not reach the
  lane until a triage park can take an answer.

**Took from it:** the loop runs on real agents with nothing but tests deciding
"done". The duration ticket, the one with hidden rules, is the test that
matters, and it is blocked on triage.
