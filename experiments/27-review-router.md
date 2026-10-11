# 27. Jev as the review's router

The lane's review now checks scope in code: a changed file no criterion names
must be listed by the builder with a reason, or the work is sent back. Each
listed reason goes to a `Router` service with one question, "does this change
serve the ticket's goal?", and Jev is the first plug-in (floor 0.8; below it,
`unsure`, which parks).

`27-route-probe.ts` asks it about 12 reasons, labelled by hand, 3 times each:

| | Answers |
|---|---|
| Right | 30 of 36 |
| Unsure | 6 |
| Wrong, letting an unrelated change through | 0 |
| Wrong, sending a related change back | 0 |

Every answer was the same across its three repeats. All six unsure answers were
on two changes that support the ticket without doing its work: a type comment
and a README example (0.45 to 0.54). The clearly related ones were 0.96 to 0.99,
the clearly unrelated ones 0.98 to 1.00.

The labels are mine, and the cases are clean on purpose, so this says Jev reads
the obvious cases right, not where the line sits on hard ones. The unsure band
is where a person decides, which is the design.

**Took from it:** Jev fits this slot: two short texts, "about the same thing?",
and the lane only routes on it. Docs and types that go along with a change are
exactly what it leaves to a person.
