# 46. A replay set: an answer key from closed tickets

Not an experiment, a data set. Until now we judged triage by eye on one
ticket, #558. [`replay/`](../replay/README.md) holds 23 closed kamp-us/demlik
issues, each fixed by one merged PR, read with `gh` only: no Jev, no Claude.

For each issue it keeps the report as filed, fabrika's triaged ticket, and
what the PR changed: files and their kind, the tests it added, the published
names it touched, the changeset, the base and merge commits, and a level
(type, runtime, docs or mixed). The mix is 13 bugs, 6 features and 4 chores;
13 runtime, 5 docs, 3 type and 2 mixed; 4 small and 19 medium.

22 of the 23 keep fabrika's "Original report (verbatim)" block, the text
`src/github.ts` starts triage from, and in all 22 it equals the first body
revision on GitHub. The one without it was filed already triaged, so it is
for the lane only.

What to watch: 20 of the reports were filed by agents and already name files,
19 of 23 are `p1`, and some scope was settled in comments the set does not
keep. The README has a scoring sketch for triage; nothing scores yet.
