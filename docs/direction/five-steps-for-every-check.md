---
state: "decided; step 5's gate in CI (experiment 117); generated laws, four reason labels and K20, 2026-11-08"
summary: "Pick the riskiest promise; test the real code first (TLA+ only for a design with no code, a proof only past a bound); show each check failing on a planted break; a failure stays a failure; record what each check covers, and CI goes red when that code changes unchecked. Every law uses generated inputs unless it has a reason labeled `vector:`, `format:`, `pinned:` or `scenario:`. Review checks that the property or label is present and fits. A shape check is a lint rule or a type. K20 uses existing Schemas or their Effect Arbitraries for new properties, with fast-check for unsupported cases and edges."
---

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
     the code. A spec kept after that is checked against real runs in the
     drift job, and only advises (decided 2026-10-25,
     [experiment 139](../../experiments/139-tla-trace-validation.md)).
   - A promise that must hold at any size, where a bound is not enough: a
     proof.
3. **Show the check can fail.** Each check has a planted break it must catch,
   run every time ([Every machine has laws](./every-machine-has-laws.md)).
   *2026-11-11: for the tests step's laws in `next/`, a plant is run once and recorded, not kept
   ([0093](../../.decisions/0093-laws-walk-plants-run-once.md), a trial).*
4. **A failure stays a failure.** It is reported with its shortest bad run.
   Nobody loosens the check to make it pass
   ([Nobody writes their own exam](./nobody-writes-their-own-exam.md)).
5. **Write down what it covers.** A record names the covered code, with a
   fingerprint. CI goes red when covered code changes and nobody checks again.
   This matters most for a check that runs on a copy of the code.

## Every law is a property

Decided 2026-11-08 by the owner, after PR 516's laws were all example tests.

- **Every law is a property test over generated inputs, on the real code,** not only a machine's
  laws. A machine uses `@demlik/tea/pbt`; anything else uses fast-check or Effect's `Arbitrary`.
- **A hand-picked example stays only as a pinned case of a named past bug,** in fast-check's
  `examples`, with the bug named beside it.
- **A check on the shape of code is a lint rule or a type,** not a test.
- **Four kinds of law may be a fixed test, and the test's name says which** (owner, 2026-11-08).
  Anything else is a property. A hand-picked example that checks a general rule is a miss.

| Label | What it is | Example |
|---|---|---|
| `vector:` | A fixed input and answer from a spec | a TypeID from the TypeID spec's test vectors |
| `format:` | A fixed format the code must write or read exactly | the `keybindings.toml` a person would write by hand |
| `pinned:` | A named past bug, kept so it never comes back | the duplicate-id bug |
| `scenario:` | One scripted run against the outside world | a real Electron window opens; a real `git push` lands |

```ts
// A sketch: one law, with one pinned case of a named past bug.
fc.assert(
	fc.property(fc.array(fc.integer()), (xs) => isSorted(sortIds(xs))),
	{examples: [[[2, 1, 2]]]}, // the duplicate-id bug, pinned
);

// A sketch: the four fixed kinds, each named by its label.
it("vector: TypeID spec, the nil UUID", () => {/* ... */});
it("format: keys writes keybindings.toml as a person would", () => {/* ... */});
it("pinned: duplicate ids sort once (the duplicate-id bug)", () => {/* ... */});
it("scenario: the app opens a real window on a fresh home", () => {/* ... */});
```

[Claessen and Hughes's QuickCheck](https://www.cs.tufts.edu/~nr/cs257/archive/john-hughes/quick.pdf)
checks general rules with generated inputs.
[Hypothesis's `@example`](https://hypothesis.readthedocs.io/en/latest/tutorial/replaying-failures.html#using-example-to-run-a-specific-input)
keeps explicit inputs alongside generated cases, as fast-check's `examples` does for `pinned:`.
The four labels name why a fixed case exists; they do not claim that one example checks a general
rule.

The plan names the generator, or a label with its reason, for each law. The test writer keeps that
reason beside the check. The reviewer checks that the property or label is present and fits, and
does not reopen each test's merits.

## Effect test data, K20, 2026-11-08

Decided for new properties in both versions, including today's hand-run tooling.

For a new property, use `@effect/vitest`'s `it.prop` or `it.effect.prop` with an existing Schema,
or its own Effect Arbitrary exported beside it; write fast-check data only where Effect has
nothing or to push edge cases. Keep `@demlik/tea/pbt` for machine laws.

```ts
// A sketch: the property's inputs come from its existing domain Schema.
it.prop("keeps valid values", {value: ExistingSchema}, ({value}) => {
	expect(accepts(value)).toBe(true);
});
```

Effect and `@effect/vitest` 4.1.1 accept Schemas and Effect Arbitraries here. `effect/testing`
exports TestSchema helpers, not another generator. Some refinements exhaust discards, so keep
an unsupported generator with a nearby reason. This rule cannot prove generator coverage.

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
  *2026-10-25: experiment 139 looked for one on the hosted lane and found
  none in 46 planted bugs.*
- Records that cost more to keep up than the stale checks they catch.
