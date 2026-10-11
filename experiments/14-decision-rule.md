# 14. Is there more in the answer than one confidence number?

`14-decision-rule.ts`. Jev gives every option a share: checks, does_not_check,
cannot_tell. The hope: a good test the judge is unsure about has its doubt in
"cannot tell", a bad one in "does not check", and a rule on the shares would
let more good tests through for free.

**No.** "Cannot tell" gets a share of about 0 on good and bad tests alike, so
the answer is one number in practice. Jev's docs give the formula: confidence
is the top share rescaled, `(p_max - 1/n) / (1 - 1/n)` for `n` options. Our
0.85 floor on three options is a top share of 0.90.

The rerun did add 618 answers to the record. Bad tests accepted at 0.85: 0 of
273. The closest was 0.83, for a test expecting 8010 from `"2H15M"` (the right
answer is 8100). Jev does not do arithmetic, so the margin over the floor is
thin: 0.02.
