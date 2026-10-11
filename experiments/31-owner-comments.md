# 31. The owner's comments

A comment the owner leaves while the work is under way can change what "done"
means. Before a lane finishes, it fetches the ticket's comments from a
`Tracker` and a `CommentReader` reads each one: does it change one of the
ticket's rules, add one, or change nothing? Only a sure "changes nothing"
(0.9) settles a comment on its own; anything else parks, with the comment and
the rule it may change side by side. A person notes it, makes it an example
(the tests are rewritten and the builder goes on), or tells the builder in
words. The owner changing their mind is not the builder's fault, so neither
spends an attempt. Comments never interrupt a build: one left mid-build is
read when that build is about to finish.

`31-comment-probe.ts`: 16 comments on the duration ticket, labelled by hand, 3
times each, through the real `jevCommentReader`.

| | Answers |
|---|---|
| Right | 27 of 48 |
| "Changes nothing" on a comment that changes something (passes unseen) | **0** |
| A harmless comment sent to a person | 3 (the bare link, 0.79 to 0.82) |
| Unsure, sent to a person | 21 |

Every harmless comment but the link was settled at 0.92 to 1.00, including
agreement that names a rule ("Yes, 1h30m giving 5400 is exactly what I need",
0.97). Clear changes were named with their rule ("throw instead of null",
0.99; "milliseconds, not seconds", 0.82 to 0.87). Most asks for new behaviour
(days, decimals, upper case) came back unsure, 0.28 to 0.64: safe, since a
person sees them, but the person gets no rule beside them.

Real run, fresh duration lane, the ticket holding two comments: "Thanks for
picking this up!" and "1h30 without the m ... should give null". Review and a
dispute took 4 attempts (the ticket gap again). Then the lane passed review,
fetched the comments, settled the thanks, and parked on the 1h30 one
(unsure). A person made it an example under the hours-and-minutes rule; the
tests were rewritten, the builder found the code already returned null, and
the lane finished: 4 attempts, 6 builds.

**Took from it:** the dangerous answer never happened, and the safe ones cost
a question each. The tracker, a folder of one JSON file per ticket, now hands
over the ticket itself too: the factory is filed with an id and reads the
rest, so GitHub becomes one more `Tracker` Layer.
