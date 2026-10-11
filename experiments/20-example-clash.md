# 20. Does anything catch a wrong example?

A wrong example becomes a wrong visible test, and the builder codes to it.
Jev cannot tell a right result from a wrong one (experiment 18). The idea:
something written from the rules alone, without seeing the examples, disagrees
with a wrong one. `20-example-clash.ts` plants 20 wrong examples over the two
toys, of three kinds:

- **skips the rule**: `slugify("Hello") -> "Hello"`, `parseDuration("30m1h") -> 5400`
- **misreads the rule**: `slugify("héllo") -> "hello"` (accents turned into
  plain letters), `parseDuration("90") -> 5400` (a bare number as minutes)
- **off value**: `parseDuration("1.5h") -> 4500`, `slugify("héllo") -> "hll"`

and tries three detectors on each, three runs apiece:

- **reference**: an agent writes a throwaway implementation from the rules,
  and the example's call is run on it
- **hidden**: an agent writes hidden tests from the rules, run on code that
  follows the wrong example (and on what a real builder wrote)
- **builder**: the builder, shown rules and examples, may answer
  "contradiction" instead of coding to an example

The rules come in two wordings: `clear`, and `loose`, the way a person might
file them ("Spaces between words become dashes", "A plain number works too").
Every detector also ran on the correct examples to count false alarms. The
whole thing ran twice, the second time with the builder shown the loose rules
(`BUILD=loose`); the references and hidden tests in both runs agree.

| Detector | Clear rules: wrong caught | Clear: false alarms | Loose rules: wrong caught | Loose: false alarms |
|---|---|---|---|---|
| Reference, any of 3 | 20 of 20 | 0 of 10 | 19 of 20 | 1 of 10 |
| Hidden tests on code following the example | 13 of 13 | 0 | 10 or 11 of 13 | 0 |
| Builder says "contradiction" | 19 of 20 | 0 of 6 | 16 of 20 | 0 of 6 |

(The hidden row counts only the 13 wrong examples that some general code
follows; an off value has none. No hidden test, 180 per run, failed on the
correct code.)

With clear rules, the throwaway reference catches every wrong example and
raises no false alarm. Every reference disagreed, not just one of three. The
builder nearly matches it for free, since it is there anyway. The off value
the builder let through, `"hll"`, it did not code to: it wrote correct code,
so the visible test would fail on honest code and the lane would see it.

With loose rules, the misses are all misreadings, and the same three every
time: `a---b`, `hello` for `héllo`, `5400` for `"90"`. The references, the
hidden-test writer and the builder made the same mistake as the wrong example.
But the loose rules really do allow those readings: "spaces become dashes"
does not say one dash per run. The one false alarm points the same way: the
loose references turned `é` into `e`, so they disagreed with the correct
`"hllo"`. Nothing that reads only the ticket can settle what the ticket does
not say.

One caveat: the references are not good code. Only 3 of 12 passed the toy's
full test suite; they agreed with every correct example here, but on other
inputs they may not. A reference is a check on the examples, never an oracle.

**Took from it:** a wrong result in an example is caught, and cheaply: one
throwaway implementation from the rules, plus the builder's "contradiction"
answer. A disagreement goes to a person with both answers side by side. A
gap in the ticket is not caught; it comes back as agents agreeing on a guess.
That is the thin-ticket problem again, and only the person who filed it can
answer it.
