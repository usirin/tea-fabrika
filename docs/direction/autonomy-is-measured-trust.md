---
state: "decided 2026-11-03, measures proposed; M5 decided 2026-11-07; walked at Tier 6"
summary: "Both versions. A merge never waits on the owner; a break is fixed forward and names the step that missed it. Trust is a number our checks earn: one record per merge, one per break, and the change failure rate per step (DORA, Google SRE error budgets). A second measure, M5: asks per step that a person marked as needing them (`needed` on `answered`), against those the agent could have worked out."
---

# Autonomy is measured trust

**Decided 2026-11-03 by the owner:** the rule in [what was decided](#what-was-decided). The
measures under it are **proposed**: leans, each marked with how sure. Both versions. Walked when Tier 6 starts (owner, 2026-11-08): pipeline merge and failure measures.

```ts
// A sketch. One row per merge nobody approved by hand, written when the merge happens.
type MergeRow = {
	readonly pr: string; // "usirin/tea-fabrika#357"
	readonly head: string; // the full sha that merged
	readonly at: string; // the referee's time: GitHub's mergedAt
	readonly by: string; // "agent:claude", acting for the owner
	readonly passed: {
		readonly ci: boolean;
		readonly review: "merge_ready" | "none";
		readonly mutation: {readonly caught: number; readonly total: number} | null;
		readonly tests: "written_first" | "by_builder" | "none";
	};
};

// Written later, when someone finds that a merge broke something.
type BrokeRow = {
	readonly pr: string; // the merge that broke it
	readonly found: string; // when it was found
	readonly fix: string | null; // the pull request that fixed it
	readonly missed: "tests" | "mutation" | "review" | "ci" | "unknown"; // which step should have caught it
};

// Derived, never stored: the share of merges that broke something, per step that missed it.
const failRate = (merges: readonly MergeRow[], broke: readonly BrokeRow[]) => broke.length / merges.length;
```

## What was decided

- **A merge never waits on the owner.** Only two people use this today. A merge that breaks
  something is fixed by the next pull request, and the break is a finding.
- **The factory is autonomous because we trust it, and we trust it because we measured it.**
  Trust is not a feeling and not a setting. It is a number our own checks earn, the way
  every other claim here is earned: an experiment, a field row, a result.
- **A break hardens the pipeline.** Each break names the step that should have caught it, and
  that step gets the next fix.
- Still stops for the owner: an obvious security leak (the repo is public), and a new design
  or direction call. A merge is never one of those by itself.

## The known way

- **DORA's four keys.** The industry measures delivery with deployment frequency, lead time,
  change failure rate and time to restore. Fixing forward fast is safe when the failure rate is
  known and restore is quick. Source: Google Cloud's DORA research, the "Accelerate" book
  (Forsgren, Humble, Kim, 2018).
- **Google SRE error budgets.** A team ships without asking while it stays inside an agreed
  failure budget. When the budget is spent, it slows down and hardens. Source: "Site
  Reliability Engineering", chapter 3 (Google, 2016).
- Our version: the change failure rate per step is the budget. A step that misses too often
  gets hardened before it is trusted with more.

## Proposed measures

- **M1. A row per merge, written when it merges** (90% sure). The `MergeRow` above, in
  `field/`. What it checked is a fact that exists only at merge time. Write it now, or it is
  gone (record wide). Not built: no code writes it and `field/README.md` gives it no file or
  fields. After the merge today, `land.ts merged` only comments on each ticket it closes with the pull
  request and its merge commit (`.agents/skills/lead/scripts/pr/Queue.ts`).
- **M2. A row per break, written when it is found** (85% sure). The `BrokeRow` above. The
  `missed` field is what makes a break useful. It is the step to fix.
- **M3. Change failure rate, by step, derived** (80% sure). Never stored, rebuilt from the
  rows. A first look after about 30 merges.
- **M4. No budget number yet** (70% sure). A cutoff needs our own data first, the same rule as a
  check that blocks. After 30 merges we pick one from what we see. The doubt: 30 may be too few
  if breaks are rare. More merges would settle it.

## M5: asks that did not need a person

*Decided 2026-11-07 (owner).* A second measure beside change failure rate. Change failure rate
says how often a merge nobody approved went wrong. This one says how often a step asked a person
something it could have worked out itself. When a person answers an ask, they can mark it: it
really needed me, or the agent could have worked it out. The mark is `needed` on the `answered`
fact ([the ask desk](./ask-desk.md#did-this-ask-need-you)).

```ts
// A sketch. Derived, never stored. Per step, and the same fold per agent (the `asked` entry's `by`).
type AskCount = {
	readonly step: string; // the step that wrote `asked`
	readonly needed: number; // answers marked needed: true
	readonly avoidable: number; // answers marked needed: false
	readonly unmarked: number; // answers with no mark
};
```

- **What it is for.** A step with many avoidable asks asks too much. Its fix is the missing
  information in its brief, or a rule in code, the same way a break hardens the step that missed
  it.
- **Optional, so a sample.** An answer without a mark is fine. `unmarked` stays in the count, so a
  share is read against how many answers carried a mark.
- Nothing reads it yet. It is recorded now because an answer written before the field exists can
  never get it.

## What it means for the work

- Every merge an agent makes without a person is to get an M1 row. None is written yet, so what
  each merge so far passed is lost (finding 2026-11-10-f24).
- A break found later is to get an M2 row the same day, and a ticket on the step that missed it.
  No M2 row is written yet either.
- The pipeline itself leans the same way: it fixes forward, as in
  [jidoka and andon](./jidoka-and-andon.md). It does not add gates that wait on a person.

## What it cannot tell us yet

- A break nobody notices is never counted, so the rate is a floor, not the truth.
- Two people on one repo is a small sample. The rate on a stranger's repo may differ.
