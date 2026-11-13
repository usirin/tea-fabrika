---
id: 0149
title: The 35 notes and drawing laws leave the Tier 1 exam, and the page content policy goes with them
status: accepted
date: 2026-11-12
tags: [tier-1, exam, checklist, notes, markdown, content-policy]
---

# 0149: The 35 notes and drawing laws leave the Tier 1 exam, and the page content policy goes with them

**What this decides:** in `next/`, the exam blocks that test notes and Markdown drawing are removed
from Tier 1's exam, and the page's content policy (p62) leaves Tier 1 with them; both come back in
Tier 2 with notes.

## Context

[0137](0137-tier-1s-program-is-the-checklist.md) made the checklist Tier 1's program and moved
notes (P20) and drawing a note (P22) to Tier 2. The exam still held their laws. The plan for ticket
839 listed 35 blocks and one fixture that test code Tier 1 no longer has, and held their removal as
its slice 2, because removing a law waits on the owner's read
([0014](0014-the-lead-merges-when-every-step-passed.md)). It also asked one question: does the
content policy, which came with P22 to guard agent-written Markdown in a tab, leave too? The owner
answered on 2026-11-12: yes to both.

## Decision

**The 35 blocks and the fixture leave the Tier 1 exam, and the content policy (p62) leaves Tier 1
with drawing.**

- What leaves, as the plan for ticket 839 lists it: 9 blocks of `notes-contract.test.ts` (5 leave
  whole; 4 come back in the same slice as the checklist's own laws, with their replace-row,
  duplicate and lost-metadata plants), all 4 of `notes-fixture.test.ts` with
  `fixtures/next/notes-letters.jsonl`, all 9 of `notes.laws.test.ts`, all 7 of `markdown.test.tsx`,
  all 9 of `highlight.test.ts`, and 1 of `bytes.test.ts`.
- What stays: the 26 blocks the plan names as not about notes, pointed at the checklist where they
  named notes.
- The content policy is not built in Tier 1. The checklist draws plain React text, so no HTML is
  drawn.
- Tier 2 owes all of it back with notes: Markdown drawing and its safety laws, the stale-base "two
  writers" laws, the frozen letters of real note text, the 1,000 and 10,000 save wake numbers, and
  the content policy.

**Binding constraints**

- This is a yes to this list only. Any other removed or narrowed law still waits on the owner.
- The pull request that removes them carries `loosening.sh`'s list, and the lead checks it against
  the plan's list block by block before the merge.
- If the checklist ever draws anything but plain text in Tier 1, the content policy comes back in
  that same pull request.

## Consequences

- Slice 2 of ticket 839 can be built and merged by the usual steps.
- Until Tier 2, no test guards Markdown drawing or a page's content policy. No real note was ever
  written, so no saved fact is lost.
- The cost named at the time: a content policy also guards against bugs, not only against agents,
  and it would have been about 20 lines in the browser page. That guard is absent until Tier 2.
- Not decided here: how notes and drawing are built in Tier 2.

## Amendments

- 2026-11-12: the count is 39, not 35. The list in this file is unchanged and is what was approved:
  9 + 4 + 9 + 7 + 9 + 1 blocks, which sums to 39. The "35" in the title and text was a wrong sum
  in the plan for ticket 839. The review of the pull request for ticket 885 counted 39 removed,
  26 kept and 16 re-pointed, and the lead's hand check found every kept law on the branch.
