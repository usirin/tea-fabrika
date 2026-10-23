# Five steps for every check

Decided 2026-10-22. Step 5's gate is built in experiment 117 and runs in CI
as `pnpm promises`.

```ts
// A sketch: one promise as data, cut short from experiment 117's record.
{
	promise: "A lane never waits forever for a child.",
	harm: "A child that dies before its outcome row leaves the lane stuck, and nobody is told.",
	tool: "property test",                                    // step 2: the real code
	plant: "the wait ignores the child's EXIT",                // step 3: a break it must catch
	covers: ["packages/pipeline/src/hosted/lane.ts#handlers"], // step 5: what it covers
}
```

## What was decided

Every formal check in this repo follows five steps.

1. **Pick the riskiest promise.**
   - A promise the code makes, where a break hurts and normal tests rarely
     reach the case that breaks it.
   - The strongest one, not the easiest to check.
2. **Test the real code first.**
   - One machine: a property test on the real reducer, with tea's
     `@demlik/tea/pbt` (decided 2026-10-23,
     [Property tests, not our own search engine](./property-tests-not-our-own-search.md)).
     Our checker that tries every order (`explore.ts`,
     `laws/world/search.ts`) is an experiment now, fenced so nothing new
     uses it.
   - Parts working together, such as a stage and the host: a property test on
     the real code, with Effect's `Arbitrary`, as in experiment 116.
   - A design with no code yet: TLA+. Once the code exists, the check moves to
     the code.
   - A promise that must hold at any size, where a bound is not enough: a
     proof.
3. **Show the check can fail.** Each check has a planted break it must catch,
   run every time ([Every machine has laws](./every-machine-has-laws.md)).
4. **A failure stays a failure.** It is reported with its shortest bad run.
   Nobody loosens the check to make it pass
   ([Nobody writes their own exam](./nobody-writes-their-own-exam.md)).
5. **Write down what it covers.** A record names the covered code, with a
   fingerprint. CI goes red when covered code changes and nobody checks again.
   This matters most for a check that runs on a copy of the code.

## Why

- **Experiment 115:** a check on a hand-written copy of the lane found the
  hang, but nothing tied the copy to the code. It could go stale and stay
  green.
- **Experiment 116:** three tools found the same bug. Only the property test
  ran the real code. TLA+ printed the shortest run, but all of it is a copy.
- **Experiment 117:** a record with fingerprints, checked in CI, caught all
  five breaks done on purpose.
- **The shape comes from a public recipe for formal checks**
  (https://github.com/cursor/plugins/blob/main/pstack/skills/create-formal-verification-skill/SKILL.md).
  Its step 2 named TLA+ first for order bugs. Ours tests the real code first,
  because of experiment 116.

## What it costs

- Each check needs a planted break and a record.
- A property test samples. It runs one order of events for each input, so a
  bug that needs a rare order can slip past it. For one machine, our checker
  covers every order. *2026-10-23: on 569 Stryker mutants of ship
  (experiment 119), no break needed that; the loop machine was not tested.*
- **How sure:** 80%. The doubt is the rare order. Planting a few bugs that
  need one, and seeing whether a property test finds them, would settle it.

## What would change it

- A bug that property tests on the real code keep missing and TLA+ catches.
- Records that cost more to keep up than the stale checks they catch.
