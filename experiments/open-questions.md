# Open questions

The list the log kept while experiments 1 to 20 were written (2026-10-04). It
has not been edited since experiment 20, and later write-ups answer some of
it. Back to [the index](./README.md).

- The narrow questions were tried on saved tests only. They need a fresh set
  of bad tests, as the broad question got in experiment 10.
- A throwaway reference catches wrong examples on toys (experiment 20). On
  real code a reference is much more work, and may be wrong more often than
  the example.
- Criteria as data fit pure functions only (experiment 19). What kinds of
  criteria are there, and which check owns each? The demlik reasons are a
  first list.
- The judge sends back about four good tests in ten. Asking the writer again
  will mostly give the same test. Where do they go: a stronger judge, a reworded
  criterion, or a lower floor for answers that are "checks"?
- Who checks a hidden test, if the judge cannot? Running it against nothing
  proves nothing, and the builder cannot see it to object.
- A rule the ticket never states is tested by nobody. From a thin ticket,
  triage finds about half the rules. Should it ask the person who filed it,
  guess and mark the guess, or park?
- The cheats were written by hand. A builder that cheats on its own may do it
  differently.
- None of this has run end to end: write tests, judge them, build, run.
