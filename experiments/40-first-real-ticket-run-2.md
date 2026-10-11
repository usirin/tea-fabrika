# 40. The first real ticket, run 2: what went wrong after triage

Not an experiment, a run. kamp-us/demlik#558 ("replay still requires ctx for
a machine that has none") again, filed from the original report on purpose,
so our enricher did the rewrite. Fabrika's own rewrite of the same issue was
kept beside the run to compare. Real Claude Code agents, real Jev.

**Triage.** The enricher read the code and parked on one open call: should
the testing helpers (`expectFinalState` and the others that share
`ReplayOpts`) drop `ctx` too, or only `replay`? Fabrika's triage had put them
in scope without asking. The owner said yes, and the rewrite came back with
14 criteria: 7 with examples, 7 unchecked (4 about types, 3 about doc pages).
Jev sorted it bug at 0.41 (the buildable side held, so it passed), p2 at
0.51, worth doing at 1.

**Prepare.** The lane parked on the 7 unchecked criteria, and a person said
skip. Of the 7 examples, 5 held on the untouched code and 2 failed. The bug is
in the types: at runtime `replay` already ran with `ctx` left out. Only the
two examples about the `{}` default could fail at runtime. A test of calls and
results can barely see a type-level bug.

**Build.** Three attempts. The enricher had written its examples with plain
object literals standing in for machines, such as
`expectCmdEmitted({ init: …, update: … }, …)`. That generated test did not
typecheck, so on attempt 2 the builder removed `NoInfer` from
`expectCmdEmitted`'s `cmd` parameter. Checked by hand: after that change,
`expectCmdEmitted(m, opts, { type: "typo" })` compiles, where before it was a
type error. A stable API was weakened to fit our generated test. Attempt 3
fixed a docs mirror test and passed every check, then the scope check sent it
back: it had changed the tutorial and the how-to page, which only unchecked
criteria named, and `kindOf` dropped an unchecked criterion's file, so no
criterion named them. That was the third attempt; a person gave one more.

**Review.** Attempt 4 listed the pages as deviations. The router called 4 of
the 5 extra files related and was unsure about the changeset, at 0.48, so the
round parked. Separately, the builder made `ctx` optional for a machine typed
`ctx: undefined` too. Fabrika's rewrite named exactly that widening as a
rabbit-hole to stay out of; our enricher wrote no limits at all, and its own
criterion listed `undefined` among the types that should allow it. The run
was dropped.

What changed after it:

- **Examples use the library as its users do.** The enricher is told to build
  a value a call takes with the library's own constructor, inline (a real
  machine made with its constructor, not a plain object), and to write only
  examples that typecheck against the code as the issue leaves it with no
  change the issue does not ask for. A criterion now lists the other names its
  calls `uses`, each with its file, and the test writer imports them beside the
  criterion's own name, so `replay(defineMachine({…}), {…}).state` can be one
  test. The builder is told to answer `contradiction` when an example can only
  pass, or only typecheck, by changing something the issue does not ask for.
- **Unchecked criteria keep their files.** The enricher lists the files an
  unchecked rule is about (or none), and the scope check counts them as named.
  A change to a doc page only an unchecked criterion names is no deviation.
  Saved runs read back with `uses: []` and `files: []`.
- **Triage on its own.** `UNTIL=triage` stops a real run once triage is done,
  before the lane touches the repo, and prints our whole rewrite. It is kept
  as `ours-enriched.md`, laid out like `fabrika-enriched.md`, to compare.
- **Set aside: a pitch.** Fabrika's rewrite also writes a pitch: the problem,
  an appetite, rabbit-holes, no-gos and a success line. Adding those to the
  enricher's one turn was proposed, then set aside: enrichment will be
  redesigned as several smaller steps, code and narrow model calls, instead of
  a bigger single turn.

Open: no criterion can name a changeset, whose file name is made up when it is
written, so the router judges it every time. And the limits the undefined
widening crossed still have no home until the enrichment redesign.
