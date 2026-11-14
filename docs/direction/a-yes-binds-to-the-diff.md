---
state: "decided in pieces, see the note"
summary: "Both versions. A review's verdict, a person's yes and the lane's stand-in carry to a new head by one rule: `kept` on the same head, a clean replay of the reviewed diff onto the base branch (Gerrit's trivial rebase), or a format-only change; `glance` when only the `-U0 --verbatim` patch-id matches; `stale` otherwise. Diffs are read against the pull request's base branch. Checks always run again at the final head. 13 places in today's code bind to a sha or to no head. From experiment 165."
---

# A yes binds to the diff, not the commit

**Decided, in pieces:**

- Decided to build 2026-11-02, below, settled when built.
- Built in today's version: `git patch-id` in `packages/pipeline/src/stages/pipeline/carry.ts`.

Its decided rules are in: [0394](../../.decisions/0394-a-yes-carries-by-one-rule.md),
[0395](../../.decisions/0395-a-yes-records-its-head-and-base.md).

**Proposed.** Decided by the owner on 2026-11-02 to build, in today's version and in `next/`
alike. It is settled when it is built. From
[experiment 165](../../experiments/165-review-binds-to-diff.md), whose lean was never written down
as a decision until now.

```ts
// A sketch. One rule for every yes the pipeline keeps and later checks against a head:
// a review's verdict, a person's yes, and the lane's own stand-in approval.
const Carry = Schema.Union([
	Schema.TaggedStruct("kept", {why: Schema.Literals(["same_head", "replayed", "formatted"])}),
	Schema.TaggedStruct("glance", {range: Schema.String}), // git range-diff: the few lines to look at
	Schema.TaggedStruct("stale", {}),
]);
type Carry = typeof Carry.Type;

// What a yes keeps when it is given. `onto`: the branch the pull request targets then, not always main.
type Given = {readonly head: Sha; readonly onto: string; readonly base: Sha; readonly diff: DiffId};

// What one Gather read from git for the new head. Pure from here on: nothing below runs git.
type Now = {
	readonly head: Sha;
	readonly tree: Tree; // the new head's tree
	readonly replayed: Tree | "conflict"; // git merge-tree: the given diff, replayed onto `onto` now
	readonly formatted: Tree | null; // the repo's formatter on the replayed tree's changed paths
	readonly diff: DiffId; // git diff -U0 <base now> <head> | git patch-id --verbatim
	readonly range: string; // git range-diff, old diff against new
};

const carry = (given: Given, now: Now): Carry => {
	if (now.head === given.head) return {_tag: "kept", why: "same_head"};
	if (now.replayed === now.tree) return {_tag: "kept", why: "replayed"}; // Gerrit's trivial rebase
	if (now.formatted === now.tree) return {_tag: "kept", why: "formatted"}; // only the formatter moved it
	if (now.diff === given.diff) return {_tag: "glance", range: now.range}; // own lines same, context moved
	return {_tag: "stale"}; // review again
};
// Merge needs `kept` (or a glance that said yes) AND the checks green at the final head. Always.
```

Ticket 117 on 2026-11-02, as it would have gone (a sketch):

```text
exam/117 reviewed and said yes at   A   (the lane's stand-in row, and the person's merge)
a person pushes a format-only commit B
today      ship: other_head -> send:reviewer:no_review, the lane stops
this rule  replay of A's diff onto main: tree of A; the formatter on it: tree of B
           carry -> {_tag: "kept", why: "formatted"}; checks run again at B; merge
```

## What was decided

- **A kept yes carries to a new head by one rule, `carry`, with three answers.**
  - **`kept`** when the new head is the reviewed head; or when the reviewed diff replays cleanly
    onto the pull request's base branch as it is now (`git merge-tree`) and gives exactly the new
    head's tree; or when the repository's formatter, run on that replayed tree, gives exactly the
    new tree (a format-only change).
  - **`glance`** when only `git diff -U0 base head | git patch-id --verbatim` matches: the pull
    request's own lines are the same, and only the lines around them moved.
  - **`stale`** otherwise. The yes does not carry. Review again, or ask the person again.
- **The checks always run again at the final head.** No `carry` answer stands in for them. This is
  experiment 165's known catch: main renames a function the pull request calls, the diff is byte
  for byte the same, and only a check run at the new head fails.
- **Every diff is read against the pull request's base branch, not main.** For a stacked pull
  request that is the parent's branch, and main once the parent merges (165, part 6b).
- **Never whitespace-blind patch-id.** `--verbatim`, not plain `--stable`. Plain `--stable` kept a
  yes over a YAML indent change and a space gone inside a string (165, section 3).
- **A yes records what `carry` needs, from the day it is given.** The `reviewed` fact, a verdict
  row and a person's merge answer each keep `head`, `onto`, `base` and `diff`. `base` is the one
  that cannot be rebuilt later: the base branch moves, and a parent's branch can be squashed away.
- **A carry is a fact of its own.** Code writes `carried` with `from`, `to` and `why`, so the record
  shows every yes that moved, and why. A review never moves silently.
- **The formatter is the base branch's.** The command comes from the base's `.fabrika/fabrika.toml`,
  as the reviewer reads main's rules, and runs only on the paths the reviewed diff touched. A pull
  request cannot bring the formatter that excuses it.

This changes one line of [nothing is pushed before review](../../.decisions/0391-the-ledger-holds-the-commit-hash.md): "only a commit
with a passing `reviewed` fact can be pushed" becomes "only a commit whose `reviewed` fact carries
to it as `kept`, or through a glance that said yes".

## Why

- **The sha throws every review away.** On all 13 real force pushes in this repo the sha changed,
  and it was wrong on all 8 hand-made "should stay" cases (165, sections 1 and 5).
- **The replay never said a wrong "same".** In 1,281 generated cases on one pull request and 303
  stacked ones read against the base branch, it made no wrong answer either way (165, part 6).
- **The `-U0 --verbatim` id is right on the common real case, and wrong on a moved line.** It kept
  4 of the 13 real pushes, where only the row above the pull request's own row in
  `experiments/README.md` changed. It also said "same" on 31 of 54 generated moved lines, such as
  a `requireAdmin()` moved from one function to another. So it earns a glance, never a silent yes.
- **It broke a live lane today.** On ticket 117's exam pull request, a format-only commit moved the
  head. The lane's stand-in approval and the ship gate's rows were tied to the old sha, so ship
  ended `send:reviewer:no_review` and the lane stopped. The meaning had not changed.

## The known way

- **Gerrit** copies a vote to a new patch set when the label's `copyCondition` query matches
  ([config-labels](https://gerrit-review.googlesource.com/Documentation/config-labels.html#label_copyCondition)).
  `changekind:TRIVIAL_REBASE` matches "a new patch set ... that is a trivial rebase": the same
  diff, and no conflict resolution. `changekind:NO_CODE_CHANGE` matches "the same parent tree as
  the previous patch set and the same code diff". Our `replayed` is the nearest thing to the first;
  `same_head` and a message-only amend fall under the second.
- **GitLab** keys approvals on `git patch-id`, so a rebase need not reset them
  ([GitLab docs](https://docs.gitlab.com/user/project/merge_requests/approvals/settings/)).
- **GitHub** records "the state of the diff at the point when a pull request is approved"
  ([rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)).
- **Today's fabrika** already writes `content:<digest>` on its verdict markers, taken over the
  bound range, so a verdict survives a branch update that leaves the diff and every changed file
  byte for byte the same. This repo's parser reads past it (`verdict.ts:36`).
- **`formatted` is ours.** None of the three names a format-only rule. It is the narrow case that
  stopped ticket 117, and it adds no new trust: the formatter only rewrites lines a reviewer
  already read.

## What `glance` means for a person

A glance is one short look at a few lines, not a full review. The range-diff shows the old diff
beside the new one; on this repo's 4 real cases it was one moved context row.

- **For a review's verdict, the lane's review step looks, in a short mode.** One narrow question
  over the range-diff: "did only the lines around the change move, and do its own lines still do
  what was reviewed?" It is the Judge move. A yes writes `carried` with `why: "glanced"`. A no, or
  any doubt, is `stale` and a full review. **Lean, 65% sure**, 165's own number. The doubt: 4 real
  cases, one pattern, one repo. What would settle it: 165's script on a repo with many more force
  pushes (`REPO=<url>`), counting `-U0` matches that hid a real change.
- **For a person's yes, the person looks.** No agent answers for a person. The ask shows the few
  lines and the same picks; it is a glance because it is short, not because someone else gives it.
  **Lean, 80% sure.** The doubt: how often it comes up for a person at all.

## Where it applies

All of this is today's version, read on 2026-11-02 at `origin/main`. Paths are under
`packages/pipeline/src/`. Each row binds a yes to a sha, or to no head at all, and moves to `carry`.

| Place | What it binds today |
|---|---|
| `stages/ship/ready.ts:74-87` (`rowFor`) and `:148` (`isReady`) | A verdict row counts only at `v.head === p.head`; any other head is `other_head`. |
| `stages/ship/gate.ts:33-34`, `:84`, `:88` | `other_head` is `unjudged`, and a missing review is too: both end `send:reviewer:no_review`, the stop on ticket 117. |
| `stages/pipeline/github.ts:35-50` (`laneFactsOver`) | When GitHub's head is not the head the lane pushed, every review row reads `missing`. |
| `stages/pipeline/pulls.ts:211-221` (`reviewsFrom`) | An exam pull reads `governance: passed` at any head. A lane pull's verdicts carry no head, and `open` at `:137-146` moves the row's head and keeps them: a silent carry with no check. |
| `stages/pipeline/pulls.ts:179-208` (`said`, `mergeAnswered`) | A person's `merge` binds to the newest ask, and to no head at all. |
| `stages/pipeline/pulls.ts:410-449` (`laneRecord`) | The exam's stand-in criterion passes at the side tree's head when it is read. |
| `criteria/book.ts:264-270` (`standingAt`) | A criterion is met only by a verdict at `v.head === head`. |
| `stages/lane/view.ts:120-123` | The window's "met" uses the same rule. |
| `tickets/ticket.ts:308-315` (`reviewed`) | The fact keeps `head` only: no `onto`, `base` or `diff`. |
| `code-host-github.ts:315-332` (`verdictsAt`) | A GitHub verdict marker counts only at the head; its `content:<digest>` is dropped. |
| `code-host-github.ts:368`, `:397-413` (`approvedBy`) | A GitHub approval, or an owner's `control-plane-self-approval @ <sha>` comment, counts only at that sha. |
| `stages/operate/stop.ts:176-190` (`afterReview`) | The operate loop ships only when the review passed the very head the round built. |
| `stages/pipeline/machine.ts:1256-1259` | After main is merged into a pushed branch, the lane always goes back to review. |

13 places. Two of them (`pulls.ts:137-146` and `:179-208`) are holes the other way: a yes that
carries over anything. Giving every yes a head and running `carry` closes both.

These stay bound to the exact sha, on purpose. They bind the checks or a write, not a yes:

- the checks at the head: `stages/ship/ready.ts:161`, `stages/pipeline/github.ts:131-134`,
  `stages/pipeline/machine.ts:902-903`, `stages/mutation/machine.ts:143`,
  `stages/test-writer/checked.ts:101`;
- the merge and queue writes: `stages/ship/door.ts:46`, `stages/pipeline/pulls.ts:393`,
  `code-host-github-writes.ts:68-71` and `:163-173`.

The laws that encode the old rule change with it: `laws/ship-pbt.ts:111-122` (the `other_head`
proof) and `:549-553`.

In `next/` nothing is built yet. Its review entry and its merge answer keep `head`, `onto`, `base`
and `diff` from the first entry written.

## The cost doubt

Each push to a reviewed pull request now costs git work: one `merge-tree`, one diff and patch-id,
one range-diff, and sometimes a formatter run in a checkout of the replayed tree. 165 called it
"milliseconds" but never timed one call; its whole first part, a few hundred git calls and a clone,
took about 40 seconds. The formatter run is the costly part, and it runs only when the replay is
clean and not already equal.

What would settle it: time `carry` on this repo's 13 real force pushes and on its 145 merged pull
requests, median and slowest, with and without the formatter, on a laptop under `nice`. **How sure
the cost is small: 75%.**

## What it cannot tell us

- **`formatted` was never measured.** 165 tested ids and the replay, not a formatter. It rests on
  a formatter keeping meaning; a formatter bug that changes meaning would carry a yes over it. The
  fast-check law in the build plan plants exactly that break.
- **The replay keeps few real pushes.** 2 of 13 here; the common case, a table row added at the end
  of the same file, is a git conflict. Most of the saving comes from `glance`, the least sure part.
- **Gerrit refuses a conflict** for a trivial rebase. Our `glance` goes further than Gerrit does,
  and 165 could not confirm how Gerrit computes "the same diff".
- **Stacked pull requests, in part.** 165 did not test a parent force-pushed under its child, a
  stack merged child into parent first, or three pull requests high. A base branch that gains
  unreviewed lines is safe only if its own pull request goes under this same rule.
- **One repo, one git (2.40.1).** `merge-tree --merge-base` needs 2.40 or later.
- **How often main breaks a pull request it does not touch.** 165 showed the catch exists, not
  how often. The checks rerun covers it either way.

What would change our mind: a `glance` or a `formatted` that hid a real change, on any real run.
One would move that answer to `stale`.
