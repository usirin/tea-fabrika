# 18. Does this example show what the sentence claims?

`18-example-fits-claim.ts`. If the example is exact data, code writes the visible
test and the judge's job shrinks to this one question. So it was measured
before building on it.

Truth came from running code. For a claim and an input, an example is good when
its result is what the correct code returns and the code that breaks that claim
returns something else. 201 examples were made that way from a pool of inputs,
with no hand-labelling, and Claude wrote 50 more meant to fool the judge,
labelled the same way. Two narrow yes/no questions and one broad one:

| Kind of example | Count | `has_feature` | `rule_applied` | broad |
|---|---|---|---|---|
| Good: right result, and the claim is why | 29 | 0.93 | 0.78 | 0.77 |
| Bad: the input never touches the rule | 121 | 0.29 | 0.25 | 0.17 |
| Bad: the result is what broken code gives | 29 | 0.91 | 0.30 | 0.24 |
| Bad: a result that is slightly off | 22 | 0.96 | 0.64 | 0.62 |
| Bad: written by the fooler | 44 | 0.75 | 0.57 | 0.51 |

Accepting an example when both narrow answers reach a cut:

| Cut | Good accepted | Bad accepted |
|---|---|---|
| 0.5 | 30 of 35 | 47 of 216 |
| 0.7 | 20 of 35 | 31 of 216 |
| 0.9 | 7 of 35 | 1 of 216 |

There is no cut that works. Half of this question Jev answers well and half it
cannot answer.

- **Does the input touch the rule?** Yes, reliably. An example whose input has
  nothing for the rule to act on was accepted 0 of 121 times at every cut.
- **Is the result right?** No. `parseDuration("1.5h") -> 4500` scored 0.89, and
  `slugify("naïve approach") -> "naive-approach"` 0.88. Telling 5400 from 4500
  means doing the sum, and Jev's own notes say it does not do arithmetic: "keep
  the arithmetic in code".

**Took from it:** Jev can check that an example is about the claim. It cannot
check that the example is correct, and nothing that only reads can. An example
is the specification. A wrong one has to be caught by something that disagrees
with it: a second example worked out separately, or code that cannot satisfy
both.
