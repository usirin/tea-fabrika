# Every finding is rated

Decided 2026-10-24: **a finding the user never rated counts as noise once its
change ships.** The rest of this note is **proposed**.

```ts
// A sketch. A user rates a finding with one of two buttons, as a fact of its own.
{fact: "rated", finding: "f-12", by: "owner", says: "fix"} // or "noise"

// How one finding counts toward its rule's noise.
const counted = (finding: Finding, facts: Facts): "fix" | "noise" | null => {
	const rated = ratingOf(finding, facts); // the user's click, if there is one
	if (rated !== null) return rated;
	return shipped(finding, facts) ? "noise" : null; // seen, never acted on: noise
};

// For each program and rule: how often it was noise.
const noise = (rule: Rule) => count(rule, "noise") / (count(rule, "fix") + count(rule, "noise"));
```

## What was decided

- **A skipped finding is a false alarm.** A finding that was shown to the
  user, got no rating, and whose change then shipped counts as noise.
- **Each case, and what it counts as:**
  - "fix": counts as fix.
  - "noise": counts as noise.
  - no click, and the change ships: counts as noise.
  - no click, and the lane is still open: not counted yet.
- **Code never writes a rating.** Only a user does. "Counts as noise" is
  worked out from the facts when the count is made; nothing is written for it.

## Why

- **Google counts the same way.** A warning a person saw and did not act on is
  an "effective false positive" (Sadowski et
  al., "Lessons from Building Static Analysis Tools at Google", CACM 2018,
  as quoted in [experiment 125](../../experiments/125-check-audit.md)). Its
  Tricorder turns a check off when its "Not useful" clicks pass 10%.
- **People skip noise instead of marking it.** If a skip counted for nothing,
  a noisy check would look clean, and could earn the right to block.
- **A wrong count is cheap this way round.** A good check that looks noisy
  goes on advising a while longer. A bad check that looks clean would block
  real work.

**Cost:** a busy week of skips makes every check look noisy, so none earns
the right to block.

**How sure: 80%.** The doubt is how often the user skips. A week of real
tickets would show it.

## Proposed, not decided

- **One shape for every checking program.** Review, mutation and the
  scheduled jobs all make findings, and all need their false alarms counted.
  The core would follow SARIF's `result`
  ([OASIS SARIF 2.1.0](https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html)),
  the format CodeQL and GitHub's code scanning use, and live in
  `@kampus/fabrika`, so each program gets the two buttons and the count.

  ```ts
  // A sketch. Each program names its own rules.
  const Finding = Schema.Struct({
  	id: Schema.String, // given by code
  	by: Schema.String, // which program: "review", "mutation", "docs_drift"
  	rule: Schema.String, // SARIF's ruleId: "scope", "criterion", "survived"
  	at: Schema.NullOr(Place), // null when something is missing, so no line holds it
  	says: Schema.String, // what is wrong, in a sentence
  	head: Schema.String, // the commit it is about
  });
  ```

  - **Fitted by hand (2026-10-24):** 7 real review findings (experiments 112
    and 112b) and 6 live mutants (experiments 124 and 139). The six fields fit
    both, but they are not enough to rate from the window:
    - a review finding also needs its `proof` and `wants`
      (`packages/pipeline/src/stages/review/sheet.ts`);
    - a mutant needs the code before and after, whether a test ran it at
      all (Stryker's `Survived` or `NoCoverage`), its column, and the promise
      it was checked against.
  - So each program brings its own detail, the way SARIF's `properties` bag
    holds a tool's own fields. `relatedLocations` fits one fault in several
    files.

    ```ts
    // A sketch. The core is shared; `detail` is each program's own.
    const findingOf = <B extends string, D extends Schema.Top>(by: B, detail: D) =>
    	Schema.Struct({
    		id: Schema.String,
    		by: Schema.Literal(by),
    		rule: Schema.String, // from the program's closed list
    		at: Schema.NullOr(Place),
    		also: Schema.Array(Place), // SARIF's relatedLocations
    		says: Schema.String,
    		head: Schema.String,
    		same: Schema.Record(Schema.String, Schema.String), // SARIF's partialFingerprints
    		detail,
    	});
    ```
  - **A rule must come from a closed list,** or the count says nothing. A
    mutator name works: 11 names over 53 live mutants. Review's `check` names
    work: 3 over 39. A criterion id such as `c9` belongs to one ticket, and
    every deviation's text was unique, so those count as `criterion` and
    `deviation`. A repo rule is the agent's own wording, so one rule splits
    in two.
  - **The same finding must be matched across rounds,** or one fault counts
    twice. Review's `idOf` hashes the fault's words today, so a reworded
    fault gets a new id. A mutant can be matched by file, mutator, and the code
    before and after; Stryker's own number holds for one run only. A review
    finding needs a looser key, such as rule and file, then a Judge for "the
    same fault?". How sure: 55%; no Judge has been tried for it.
- **While a rule advises, the click is the route.** A finding waits in the
  ticket's window, and only "fix" sends it back to its writer. A rule earns
  the right to block when its noise stays near 0; Google holds a check that
  stops the build to "no effective false positives". Then code sends its
  findings back by itself, and the user rates a sample.
- **This is how the mutation rule would be reopened.**
  [Promises in the pipeline](./promises-in-the-pipeline.md) decided that every
  live mutant blocks. These counts would show whether that holds, rule by
  rule. Until they exist, that decision stands.

## Still open

- **How many ratings before a rule may block.** With no noise in `n` rated
  findings, the noise rate is under about `3 / n` at 95% (the rule of three).
  So "under 1%" needs about 300 ratings of one rule.
- **A finding sent back by code, in a rule that blocks.** The writer changing
  the code does not show the finding was right: an agent "fixes" noise too.
  Only the user's sample counts, for now.
- **A finding that a later round made stale.** It was about an older commit.
  Whether it counts at all is not settled.

## What would change it

- A skip rate so high that the counts say nothing.
- A check whose findings the user cannot judge from the window alone.

## What it cannot tell us

No finding has been rated yet. Google's numbers come from thousands of
engineers; here one person rates, so one bad week moves every count.
