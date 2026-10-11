# 10. Bad tests written to fool the judge

`10-bad-tests.ts`. The 0.85 floor was picked after seeing the data, so it needed
bad tests it had not been tuned on. Claude was asked to write tests that look
honest and are not, aimed at a reviewer who skims: an input that almost
exercises the rule, an expected value that is nearly right, an assertion that
is slightly too loose. Each had to fail on the starting code, so running it
first would not give it away.

90 tests came back. Running them settled which were really bad: 56 were (34
fail on correct code, 22 pass on code that breaks the criterion). In the other
34 the adversary slipped and wrote a test that does check its criterion.

Each test was shown to the judge three times:

| Floor | Bad accepted | Bad refused | Bad unsure |
|---|---|---|---|
| 0.80 | 0 of 168 | 60 | 108 |
| 0.85 | 0 of 168 | 43 | 125 |
| 0.90 | 0 of 168 | 28 | 140 |

The judge did say "checks" to bad tests, but never with confidence. The
highest was 0.79, for a test that expected `"mcdonald-s-menu"` from
`"McDonald's Menu"`.

**Took from it:** 0.85 holds on a fresh set, with a margin of 0.06 over the
worst miss. 0.80 held too, but by 0.01, and it failed in experiment 6. Unsure is
the judge's usual answer to a bad test, so "unsure" must send the test back,
never wave it through.

One limit: "bad" here means bad against one broken version of the code per
criterion. A test could pass that check and still be too weak in another way.
