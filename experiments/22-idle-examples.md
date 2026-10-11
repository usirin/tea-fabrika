# 22. Does Jev flag triage's own idle examples?

Experiment 18 found the one example question Jev answers well: does the input
touch the rule at all (idle inputs accepted 0 of 121). Those idle inputs were
made from a pool. `22-idle-examples.ts` asks the same question, word for word,
about triage's own examples from experiment 19's three runs, labelled by
running code: each rule maps by its words to the broken versions that break
it, and an example is idle when every one of them still passes it.

| | Idle | Shows its rule |
|---|---|---|
| Triage's examples (131) | 0 | 131 |
| Jev below 0.5 ("does not touch") | - | 5 |
| Jev below 0.9 | - | 13 |

Triage wrote no idle example, so there was nothing to catch. Jev's flags were
all false alarms, and four of the five below 0.5 were the plainest example
there is: `parseDuration("1.5h") -> 5400` for "A part's number may be a
decimal", at 0.26 to 0.44. (A first labelling run counted one idle example;
it was a slip in the labelling, the `s` in "issue's" matching the seconds
rule, and the fixed run has none.)

The weak examples of experiment 19's thin ticket, like
`typeof slugify("Hello World") -> "string"`, are not idle: they show their
rule ("slugify returns a string") perfectly. The weakness is in the rule, and
a question about the example cannot see it.

**Took from it:** no Jev slot on examples. Triage's examples already touch
their rules, and Jev's "no" would mostly send good ones back. A weak rule is
the ticket problem again.
