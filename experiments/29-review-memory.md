# 29. Review remembers what a person decided

Experiment 28's reviewer raised filed and withdrawn findings again in new
words. Two fixes, together:

- **Told:** the lane keeps every finding a person settled, filed as a note or
  withdrawn after a dispute, and review hands them to the reviewer with "do not
  raise these again, in any words".
- **Net:** when anything was decided, each new finding in the diff goes to a
  `Matcher` before the router: "does this make the same point as one of these?"
  Jev is the first plug-in, one choice question whose options are the decided
  findings plus "a different point", floor 0.9. A match is settled already and
  is not routed, so it cannot park; it stays on the result as `matched` for a
  person to check. Anything short of a sure match is routed like any new
  finding, so a miss costs a question, never a pass.

`29-match-probe.ts`: 12 new findings against the decided ones of their toy, five
of them word for word from experiment 28, labelled by hand, 3 times each.

| | Answers |
|---|---|
| Right | 28 of 36 |
| Missed a repeat (safe: routed as new) | 8 |
| Wrong match (passes unrouted) | 0 |

The real bare-number repeat matched 3 of 3 at 0.98 to 0.99. The misses were a
broad "goes beyond the issue" restatement (1 of 3 matched, at 0.90, the rest
at 0.88 to 0.89), a one-line upper-case point against that same broad finding
(0.83 to 0.84), and "runs of spaces become runs of dashes" against "two spaces
make two dashes" (0.64). The closest new points stayed new: rounding that hides
sub-second input, next to the decimals finding (0.82 to 0.83), and spaces at
the ends, next to the double-space one (0.74 to 0.77).

Real run, fresh duration lane (the old saved state predates the new fields):

1. Triage parked on audience again (0.40; five of five now). A person's sort.
2. Round 2 found float error (related), bare number read as seconds (related)
   and "beyond the issue, 1h90m accepted" (unsure: parked). A person filed it.
3. The builder fixed the float error and disputed the bare number with the
   required hidden test. A person withdrew it.
4. Round 4, told both decisions, raised neither. It raised one new point:
   rounding hides sub-second input and the comment says otherwise. The matcher
   called it new (0.96), the router related (0.95). Out of attempts; a person
   gave one more.
5. Round 5: the builder replaced rounding with 15 significant digits; the
   reviewer rechecked the rounding finding as fixed (file changed) and raised
   one new point: 15 digits change exact large totals. New (0.84), related
   (0.97). Out of attempts again. Stopped there.

**Took from it:** the memory works. No decided point came back in two rounds,
and the matcher never tied a new point to an old one. But review still does not
converge on this ticket: every fix opens a smaller, real finding (rounding,
then precision). Fabrika answers this with a freeze: past a round cap, a new
finding is filed as a comment and no longer fails the round. That is the next
gap, along with the ticket gap of experiment 28.
