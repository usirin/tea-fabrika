# 37. Jev spots a duplicate at filing

`37-dup-probe.ts`. When an issue is filed, can Jev tell which open issue it
repeats? Phoenix's triage closes duplicates with a comment ("Closing as a
duplicate of #N"); 167 such pairs were found by searching closed issues for
"duplicate of" in comments. In 143 of them the original was still open when the
duplicate was filed; the other 24 cannot be found by a check over open issues
and are left out. Thirty pairs, spread over the repo's history, each against
every issue open when it was filed (63 to 714). Ten controls: issues closed as
done, never as duplicates, against their own open pools. One `noul` per
candidate: could the new issue be closed and the open one worked without losing
anything? Titles and the first 3,000 characters of each body. 14,554 calls in
99s, well under a dollar (at most about 2,000 tokens a call; the "25 cents"
first written here priced it per call, the mistake section 36 explains).

The original ranked 1st in 26 of 30, top 5 in all 30. The 4 that ranked 2nd
lost to another duplicate of the same original (#3711, #5056, #6328 are each
closed as a duplicate of the same issue) or to a near-twin the record did not
link (#5786 against #5755, same title in other words). So read against
"is it the same request", Jev's first pick was right in 30 of 30.

The first 10 controls raised one flag (0.57), too few to trust a floor on, so
a second run widened them to 105 (`PAIRS=0 CONTROLS=70 BUSY=35`): 70 plain
issues spread over the repo's history and 35 filed in a burst, each the plain
issue filed closest to a duplicate, so it faces the same open pool as that
duplicate's twin. 35,374 calls in 243s, a dollar or two by token count (the
"60 cents" first written here priced it per call).

| Floor | Pairs flagged with a true twin | Wrong flags in pairs | Controls flagged (of 105) |
|---|---|---|---|
| 0.5 | 24 / 30 | 3 (0.54, 0.54, 0.59) | 11 (12 flags) |
| 0.6 | 20 / 30 | 0 | 3 (4 flags) |
| 0.7 | 19 / 30 | 0 | 2 (3 flags) |
| 0.8 | 16 / 30 | 0 | 0 |
| 0.9 | 3 / 30 | 0 | 0 |

"Wrong" in the pairs excludes other members of the same duplicate group and
the #5755 twin, all checked by hand; at 0.6 and above every pair flag was one
of those. The highest control score was 0.78. The three control flags at 0.7
are not plainly wrong either: #6995 against #5979 (0.78) have the same title
word for word, both closed as done, a twin the record never linked; #3062
(0.76, 0.75) is the cut-over task of the epic #3045 and of #3031, which are
themselves near-twins. Busy-week controls flagged no more often than spread
ones (1 of 35 against 1 of 70 at 0.7).

What it misses: in the 6 pairs under 0.5 the original still ranked 1st, but
Jev was not sure (#7612 at 0.07, #6058 at 0.25, #6706 at 0.24, three more just
under 0.5). Why those six score low was not read; the closing comments on
such cases often argue over several paragraphs that a wider issue covers a
narrower one, which is a judgment, not a match.

So a floor of 0.7 can say "this looks like a duplicate of #N, ask a person"
about two times in three, and asks about roughly 2 in 100 plain filings, both
of which here pointed at a real near-twin. A floor of 0.8 asks about none of
the 105 plain filings and still catches about half the duplicates. Since a
flag costs one look from a person, 0.7 is the better trade. Below the floor
the top three still hold the original every time, which is cheap context for
triage.

Caveats: 30 pairs is small. The ground truth is triage's own closing comments,
which miss twins (#5755, #5979). One repo, written mostly by agents, so
duplicates are often filed minutes apart in near-identical words. The "busy"
controls are near a duplicate in time, not picked for being on the same
subject. The titles-only variant (`TITLES=1`) was not run.
