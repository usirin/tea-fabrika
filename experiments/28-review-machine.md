# 28. Review as its own machine, with a real reviewer

Review moved out of the lane into `src/review.ts`, a child machine the lane
holds while it reviews (nested TEA, as the factory holds triage and the lane).
Its parts: code checks the scope; the router routes each extra change; a Claude
reviewer reads the diff and only finds, every finding quoting one line; code
throws away a finding whose quote is not on that line and files one on a line
the diff did not touch; the router routes the rest; a person decides what the
router is unsure about. An open finding is re-checked each round, and "fixed"
only counts once its file has changed since the finding was made. The builder
can answer `dispute` to a finding, which parks with both texts.

Real runs, `AGENT=claude`, Jev as the router:

- **slugify:** no findings, done in one build.
- **duration**, after a person's sort at triage (Jev at 0.25 on audience,
  four runs and four parks now). The hidden tests sent the first build back;
  the second passed every test, and the reviewer found 4 things, all quoting
  their lines exactly: a bare number read as seconds, decimals (`"1.1h"` gives
  `3960.0000000000005`), `Infinity` for a huge number, and case-insensitive
  units. The router said related to two (0.87, 0.89) and unsure to two (0.76,
  0.15), so review parked. Answered "file both unsure ones".
- The builder fixed the `Infinity` one, rounded the decimals, and disputed the
  decimals finding: "removing decimal support would break a required test".
  Answered "withdraw". The next review rechecked the `Infinity` finding as fixed,
  and code agreed, since the file had changed.
- That review then raised the same points again in new words (bare numbers,
  "goes beyond the issue"), plus a new real one (rounding hides sub-second
  input), and parked again.

**Took from it:** every part did its job on real output: no made-up quotes,
the dispute caught a finding that would have broken a test, and "fixed" was
backed by a changed file. Two problems showed up that the scripted tests could
not:

- **A fresh reviewer forgets what was decided.** Filed and withdrawn findings
  come back the next round in other words. It needs to be told what was already
  decided, or each new finding needs a "is this the same as one already
  decided?" check, which is a two-short-texts question of the kind Jev is good at.
- **The ticket is the real problem.** Three of the four findings are rules the
  hidden tests require and the ticket never states. The builder follows the
  tests, the reviewer follows the ticket, and both are right. Review will
  keep flagging them until the ticket says so: the "back to the ticket" route
  from experiment 26, needed for real.
