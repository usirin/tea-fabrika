# 11. Do hidden tests catch code that only learned the examples?

`11-hidden-tests.ts`. One visible test per criterion, asserting the criterion's
own example, leaves a hole: code can pass by handling just those inputs. Think
of a student who memorised the practice questions. The fix under test is the
teacher's: set different questions in the exam. The test-writer writes a second
file of tests with other inputs, which the builder never sees.

Claude wrote both files, three runs per toy. The cheats were written by hand,
eleven of them: a lookup table of the examples, lower-casing only the first
letter, collapsing exactly three spaces, removing only the punctuation seen in
the examples, and so on.

- 33 of 36 cheats passed every visible test. The hole is real: the lane as
  planned would have called all 33 done.
- Hidden tests caught 24 of the 33. slugify: 15 of 15. duration: 9 of 18.
- 0 of 90 hidden tests failed on the correct code, so none would have blocked
  an honest builder.

The 9 misses are three cheats, missed in every run, and all three break the
same thing: the seconds unit. No criterion mentions seconds. The writer was
told to test nothing the criteria do not promise, and it did not. Counting only
cheats against a rule some criterion states, hidden tests caught 24 of 24.

The judge is no use on hidden tests: at 0.85 it let through 8 of 90, all of
them sound. It is sure when a test uses the criterion's example, and a hidden
test by design does not.

**Took from it:** hidden tests close the "learned the examples" hole for rules
the ticket states. They cannot cover a rule the ticket never wrote down; that
is a gap in the criteria, and triage's to close. And hidden tests go unjudged,
so a wrong one would block a builder who cannot see why. None was wrong here.
