# 36. Jev finds the file a change forgot

`36-missing-probe.ts`. Can Jev spot a file the change should have touched and did
not? Nine merged phoenix PRs that close one issue. In each trial one file the
PR changed (and that existed before it) is hidden: Jev sees the ticket and the
PR's diff without that file, as if the builder had forgotten it. Then every
other file, as it was before the PR, gets one `noul` question: "does finishing
the ticket mean this file has to change too?" Code ranks the files by the yes.
The control hides nothing, so the diff is whole and any file at 0.5 or more is
a false alarm.

| Run | Trials | Calls | Hidden file 1st | Top 5 | Top 10 | Others at 0.5+ |
|---|---|---|---|---|---|---|
| PR's folders (~35 files) | 28 | 1,076 in 11s | 24 | 27 | 28 | median 0, max 1 |
| Whole package (268 to 1,591 files) | 28 | 36,171 in 367s | 22 | 26 | 27 | median 0, max 1 (5 trials) |
| Control, PR's folders | 9 | 345 | | | | 0 |
| Control, whole package | 9 | 11,786 | | | | 0 (highest 0.48) |

Read as a gate (flag a file at 0.5 or more), the package run catches 22 of 28
forgotten files, each ranked first, with 5 wrong flags in 28 trials and none
on the 9 complete changes.

The whole package cost about $20, not the $0.60 first written here: Jev bills
by the token, and each call carried a whole file and a diff, about 13,000
tokens. The day's bill was $21.31 for 508M tokens, about $0.04 a million. Most
of that bought nothing new: the folder run had already shown the hidden file is
found, and the open question (do 1,500 candidates bring noise?) was answered by
the control, about a quarter of the cost. Since then `lib/jev.ts` stops a run at
MAX_DOLLARS (default $5) and prints what it spent.

The 6 misses share a shape: the forgotten edit is a small knock-on, not the
ticket's subject. `port.ts` in #8770 ranked 15th of 268 (0.14); the two
`signatures` files of #7288 ranked 5th and 3rd at about 0.2; `prep-verb` in
#10088 ranked 2nd and 4th under 0.5; `command.ts` in #10500 ranked 6th. Jev
finds the file the ticket is about; it does not trace that a type moved and a
caller has to follow. Code (the typechecker, a reference search) is the better
owner of that kind.

Caveats: these tickets name their subject plainly, as in the scout probe of
experiment 34; the PRs are one repo's, and the hidden file is a real edit, so
"forgot a new file" is not tested.

**Now built** into review (`jevMissingReader` in `src/route.ts`, the probe's
question word for word). It runs beside the reviewer agent, over the packages
the change touched; a file at `review.missing_floor` (0.5) or more goes back to
the builder as a finding, unrouted, which it fixes by touching the file or
disputes. Over `review.missing_max_files` (2,000) candidates, or when the
reader fails, the check is skipped and the result says so; it never parks.
The real plug-in on #9611 (PR 9618) with `state-dir.ts` hidden: 911 files
asked in 15s, one flagged, the hidden one, at 0.95.
