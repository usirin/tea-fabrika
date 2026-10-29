# 165. A review bound to the diff, not the commit

The question: the owner keeps PR branches current by rebasing onto main and force-pushing.
Today the `reviewed` fact carries `head`, a commit sha
(`packages/pipeline/src/tickets/ticket.ts`). So every rebase makes a review look stale, even
when the code is the same. The proposal: tie the review to the diff instead, named by
`git patch-id --stable` of the PR's whole diff against its base. Does that hold up?

**Answer: tie it to the diff, yes. But not with plain `--stable`. Confidence 85% on the
direction, 70% on the exact rule.**

- **The sha throws every review away.** It changed on all 13 real force pushes in this repo,
  and was wrong on all 8 "should stay" cases.
- **Plain `--stable` has a hole.** patch-id drops all whitespace by default. A force push that
  only moves a YAML key out of its parent, or drops a space inside a string, keeps the same id.
  The approval carries over a real change. `--verbatim` closes this.
- **Context lines make false "stale" answers.** A clean rebase where main changed a line 2 or 3
  lines from the PR's hunk changes the id, while the PR's own lines did not change.
- **On real data, the context is the common case.** 4 of the 13 force pushes here kept the PR's
  own lines and changed only context: each PR adds a row at the end of `experiments/README.md`,
  and main gained a newer row first. Only a no-context id (`-U0`) keeps those 4.
- **A no-context id has its own hole.** The same added line, moved to another function in the
  same file, gets the same `-U0` id.
- **The safest test is not an id but a replay**, close to Gerrit's trivial rebase: apply the
  reviewed diff onto the new base with `git merge-tree`, and keep the review only if the new
  head's tree is exactly that. It made no wrong "same" in any case. It keeps 2 of the 13 real
  pushes, because git calls the README-row case a conflict.
- **The known catch is real, and no id or replay sees it.** Main renamed a function the PR
  calls. The PR's diff is the same, so the review carries over. Only a check run at the new head
  fails.
- **Squash merges keep the id.** 113 of 114 squash commits on main have the same `--stable` id
  as the PR's final diff. The other one differs only in context. All 31 merge commits match.

```ts
// The whole idea, as a sketch. Three answers when a reviewed PR gets a new head.
const carry = (r: Reviewed, head: Sha): "kept" | "glance" | "stale" => {
  const base = mergeBase("main", head);
  if (head === r.head || replays(r.head, r.base, head, base)) return "kept"; // trivial rebase
  if (diffId(base, head) === r.diff) return "glance"; // own lines same, context moved
  return "stale";                                     // review again
};
// diffId = git diff -U0 base head | git patch-id --verbatim
// merge needs "kept" AND checks green at the final head (the known catch, part 4)
```

Every case, scored by how many answers were right:

| group | sha | stable | verbatim | u0 | u0v | fn | replay |
|---|---|---|---|---|---|---|---|
| 1 | 0 of 8 | 8 of 8 | 8 of 8 | 8 of 8 | 8 of 8 | 8 of 8 | 8 of 8 |
| 2 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 | 5 of 5 |
| 3 | 7 of 17 | 11 of 17 | 13 of 17 | 13 of 17 | 16 of 17 | 15 of 17 | 15 of 17 |

## Who did what

- **This repo's code:** only the script, `165-review-binds-to-diff.ts`. Nothing in `packages/`
  changed. Its saved answers for part 5: `results/165-review-binds-to-diff.json`.
- **Today's fabrika:** nothing of it ran. No ledger, no lane, no agent, no real ticket changed.
- **git:** 2.40.1, with the user's git config switched off (`GIT_CONFIG_GLOBAL=/dev/null`), so
  a setting like `diff.renames` cannot change an answer.
- **GitHub:** read through `gh api graphql` (merged PRs, merge commits, force-push events) and
  one `git clone` plus `git fetch` of this repo into a temp folder. Read-only.
- **Research:** the docs of git, Gerrit, GitHub and GitLab, read on the web. Section 6.

## How it was measured

- **Parts 1 to 3** build 29 tiny repos in one temp folder, removed at the end. Each has
  `lib.js` (five small functions), `config.yaml`, `other.txt` and a binary `logo.bin` on main.
  Most PRs add one guard line to `div`. Each case makes two versions of a PR, then asks whether
  each way of naming the diff says "same" or "changed". Each case says beforehand which answer
  is right.
- **The diff** is always `git diff --no-ext-diff --full-index --binary -M <base> <head>`, where
  `<base>` is `git merge-base main <head>`: the same diff GitHub shows for a PR.
- **Six ways to judge two versions.** Five are ids, compared for equality. One is a check:

  ```ts
  const WAYS = {
    stable:   {diff: [],      id: ["--stable"]},   // the proposal
    verbatim: {diff: [],      id: ["--verbatim"]}, // keeps whitespace (implies --stable)
    u0:       {diff: ["-U0"], id: ["--stable"]},   // no context lines
    u0v:      {diff: ["-U0"], id: ["--verbatim"]}, // no context, whitespace kept
    fn:       {diff: ["-U0"], id: []},             // our own sha256: u0v plus the function name on each @@ line
  };
  // replay: git merge-tree --write-tree --merge-base=<old base> <new base> <old head>
  //         gives a tree; "same" when it equals the new head's tree, "changed" on a conflict
  ```
- **`sha`** is today's binding: "same" only when the two heads are the same commit.
- **`range-diff`** is what `git range-diff` says: how many commits it paired as equal.
- **Part 5** reads every merged PR of this repo. It compares the PR's final diff with the
  commit that landed on main, and the commit before and after each force push.

## 1. Kept when it should be

All six ways keep the review in all 8 cases. The sha loses it in all 8. `range-diff` pairs
commits one to one, so it cannot see that a squash is the same change ("0 of 4 =").

| case | should be | sha | stable | verbatim | u0 | u0v | fn | replay | range-diff |
|---|---|---|---|---|---|---|---|---|---|
| rebase, main changed another file | same | changed ✗ | same | same | same | same | same | same | 1 of 1 = |
| rebase, main changed the same file 12 lines up | same | changed ✗ | same | same | same | same | same | same | 1 of 1 = |
| squash 4 commits into 1 | same | changed ✗ | same | same | same | same | same | same | 0 of 4 = |
| rebase 1 of 3 in a row, against the first | same | changed ✗ | same | same | same | same | same | same | 1 of 1 = |
| rebase 2 of 3 in a row, against the first | same | changed ✗ | same | same | same | same | same | same | 1 of 1 = |
| rebase 3 of 3 in a row, against the first | same | changed ✗ | same | same | same | same | same | same | 1 of 1 = |
| amend the message only | same | changed ✗ | same | same | same | same | same | same | 0 of 1 = |
| rebase and squash at once | same | changed ✗ | same | same | same | same | same | same | 0 of 2 = |

## 2. Lost when it should be

All six ways drop the review in all 5 cases, and so does the sha. A conflict resolved
differently gives a different id, both against the version before the rebase and between two
resolutions.

| case | should be | sha | stable | verbatim | u0 | u0v | fn | replay | range-diff |
|---|---|---|---|---|---|---|---|---|---|
| force-push a real code change | changed | changed | changed | changed | changed | changed | changed | changed | 0 of 1 = |
| force-push one word in a string | changed | changed | changed | changed | changed | changed | changed | changed | 0 of 1 = |
| force-push with one more file | changed | changed | changed | changed | changed | changed | changed | changed | 1 of 2 = |
| conflict resolved, against before the rebase | changed | changed | changed | changed | changed | changed | changed | changed | 0 of 1 = |
| conflict resolved two different ways | changed | changed | changed | changed | changed | changed | changed | changed | 0 of 1 = |

## 3. Edge cases

This is where the ways differ.

- **Context lines (rows 1 to 6).** A change on the line right next to a hunk is a conflict to
  git. The script then makes the PR again on the new main, the way a person keeping both sides
  would. Changes 2 or 3 lines away rebase cleanly, but they sit inside the 3 context lines, so
  `stable` and `verbatim` say "changed": a false "stale". At 4 lines and more, every way is
  right. `u0` and `u0v` never see context. `replay` keeps the clean ones and drops the
  conflicts.
- **Whitespace (rows 8 to 10).** patch-id drops all whitespace unless told `--verbatim`. So
  under `stable` and `u0`, a force push that moves a YAML key out of its parent by its indent,
  or that drops a space inside a string, keeps the review. That is a real change carried over
  in silence. An everyday version of the same thing: a reviewed `rm -rf /tmp/build` becomes
  `rm -rf /tmp /build`.
- **A moved line (row 7).** The same added line, put in `mul` instead of `div`. `u0` and `u0v`
  see the same lines and say "same". The everyday version: a `requireAdmin()` line moved from
  `deleteUser` to `listUsers`. `stable`, `verbatim`, `fn` and `replay` catch it.
- **Renames, mode changes, binary files, empty diffs (rows 11 to 17):** every way is right.
  A rename to another name changes the id; `chmod +x` changes it. Two different new bytes in a
  binary file change it, with `--binary` and without it (the probe line under the table). The
  research says patch-id hashes a binary file by its blob ids, not its bytes (section 6). An
  empty diff has no patch-id at all; the script names it `empty`, so two empty PRs share it.
- **`fn`**, our own hash, fixed the moved line but broke on both conflict rows, and on one real
  push in part 5. The function name git prints is a guess from the line above, so it moves when
  main edits that line. Not worth keeping.

| case | should be | sha | stable | verbatim | u0 | u0v | fn | replay | range-diff |
|---|---|---|---|---|---|---|---|---|---|
| main changed the line right above the hunk (git: conflict) | same | changed ✗ | changed ✗ | changed ✗ | same | same | changed ✗ | changed ✗ | 0 of 1 = |
| main changed only spaces, right above the hunk (git: conflict) | same | changed ✗ | same | changed ✗ | same | same | changed ✗ | changed ✗ | 0 of 1 = |
| main changed a line 2 lines above, inside the context | same | changed ✗ | changed ✗ | changed ✗ | same | same | same | same | 0 of 1 = |
| main changed a line 3 lines above, inside the context | same | changed ✗ | changed ✗ | changed ✗ | same | same | same | same | 0 of 1 = |
| main changed a line 4 lines above, just outside the context | same | changed ✗ | same | same | same | same | same | same | 1 of 1 = |
| main changed a line 8 lines above | same | changed ✗ | same | same | same | same | same | same | 1 of 1 = |
| the same added line, in another function | changed | changed | changed | changed | same ✗ | same ✗ | changed | changed | 0 of 2 = |
| force-push: only the indent of a JS line | changed | changed | same ✗ | changed | same ✗ | changed | changed | changed | 0 of 1 = |
| force-push: a YAML key moved out by its indent | changed | changed | same ✗ | changed | same ✗ | changed | changed | changed | 0 of 1 = |
| force-push: one space gone inside a string | changed | changed | same ✗ | changed | same ✗ | changed | changed | changed | 0 of 1 = |
| a rename, rebased | same | changed ✗ | same | same | same | same | same | same | 1 of 1 = |
| a rename to another name | changed | changed | changed | changed | changed | changed | changed | changed | 0 of 2 = |
| same lines, one also chmod +x | changed | changed | changed | changed | changed | changed | changed | changed | 0 of 1 = |
| a mode change only, rebased | same | changed ✗ | same | same | same | same | same | same | 1 of 1 = |
| a binary file changed two ways | changed | changed | changed | changed | changed | changed | changed | changed | 0 of 1 = |
| an empty diff, rebased | same | changed ✗ | same | same | same | same | same | same | 1 of 1 = |
| an empty diff, against another empty one | same | changed ✗ | same | same | same | same | same | same | 0 of 2 = |

`Binary probe, two different new bytes: ids differ with --binary: true; without it: true.`

Whether the "git: conflict" rows should be "same" is a judgement call. The PR's own lines did
not change, but a person did resolve a conflict. Gerrit says no for a conflict (section 6). The
table marks them by the PR's own lines.

## 4. The known catch

Main renames `add` to `sum`. The PR adds `use.js`, which calls `add`. The rebase is clean. The
PR's diff is byte for byte the same, so every id and the replay say "same", and the review
carries over. The code is broken.

| version | diff id (stable) | `node use.js` at the head |
|---|---|---|
| before the rebase | 000dc77 | pass (prints 5) |
| after the rebase | 000dc77 | fail (SyntaxError: The requested module './lib.js' does not provide an export named 'add') |

`Same stable id: true; same under all five ids: true; a clean replay: true.`

This is not a flaw of the diff binding. A review reads the diff; the break is outside it. A sha
binding "catches" it only by throwing every review away. What catches it is running the checks
again at the final head before the merge. That rule has to stay, whatever the review binds to.

## 5. Real data: this repo's merged PRs

145 merged PRs read (all of them), each PR's final head and its commit on main fetched. None
was missing.

### 5a. The PR's final diff, against the commit main got

A squash commit's diff is against its one parent. A merge commit's is against its first parent,
main before the merge.

| landed as | PRs | stable | verbatim | u0 | u0v | fn | replay |
|---|---|---|---|---|---|---|---|
| squash commit | 114 | 113 | 113 | 114 | 114 | 114 | 114 |
| merge commit | 31 | 31 | 31 | 31 | 31 | 31 | 31 |

The one miss is
[#163](https://github.com/usirin/tea-fabrika/pull/163): main moved near its hunk between its
last push and the squash, so only context differs. `u0`, `u0v` and `replay` say "same".

### 5b. Force pushes: did the head change while the diff did not?

13 `head_ref_force_pushed` events on 12 PRs, from GitHub's timeline. Both shas fetched for all
13; **0 shas could not be fetched.** The sha binding would have thrown away all 13 reviews.

| PR | before | after | base moved | stable | verbatim | u0 | u0v | fn | replay | range-diff |
|---|---|---|---|---|---|---|---|---|---|---|
| [#35](https://github.com/usirin/tea-fabrika/pull/35) | 608ca40 | 479e182 | yes | changed | changed | same | same | same | changed | 0 of 1 = |
| [#36](https://github.com/usirin/tea-fabrika/pull/36) | 305e26a | 3544e58 | yes | changed | changed | same | same | same | changed | 2 of 3 = |
| [#37](https://github.com/usirin/tea-fabrika/pull/37) | 7cd2969 | 206d846 | yes | same | same | same | same | same | same | 2 of 2 = |
| [#39](https://github.com/usirin/tea-fabrika/pull/39) | c8d83c5 | 25682ed | yes | changed | changed | same | same | same | changed | 0 of 1 = |
| [#53](https://github.com/usirin/tea-fabrika/pull/53) | 8021473 | 3999cda | yes | same | same | same | same | same | same | 2 of 2 = |
| [#65](https://github.com/usirin/tea-fabrika/pull/65) | 20412b2 | 01abf32 | yes | changed | changed | same | same | changed | changed | 0 of 1 = |
| [#83](https://github.com/usirin/tea-fabrika/pull/83) | f1467fa | 9912649 | yes | changed | changed | changed | changed | changed | changed | 0 of 1 = |
| [#86](https://github.com/usirin/tea-fabrika/pull/86) | 32689fb | 03ad97d | yes | changed | changed | changed | changed | changed | changed | 1 of 2 = |
| [#88](https://github.com/usirin/tea-fabrika/pull/88) | 5e298b9 | 679b757 | yes | changed | changed | changed | changed | changed | changed | 0 of 1 = |
| [#93](https://github.com/usirin/tea-fabrika/pull/93) | a2132b6 | 9b7c20f | no | changed | changed | changed | changed | changed | changed | 2 of 5 = |
| [#93](https://github.com/usirin/tea-fabrika/pull/93) | 9b7c20f | 140771a | no | changed | changed | changed | changed | changed | changed | 5 of 7 = |
| [#96](https://github.com/usirin/tea-fabrika/pull/96) | 06e65e5 | 1bc54f8 | yes | changed | changed | changed | changed | changed | changed | 1 of 2 = |
| [#138](https://github.com/usirin/tea-fabrika/pull/138) | c3e9f69 | 2d41bd3 | yes | changed | changed | changed | changed | changed | changed | 1 of 2 = |

- **2 of 13 kept their diff** under the proposal (#37, #53), both rebases. Those are 2 reviews a
  sha binding threw away for nothing.
- **4 more (#35, #36, #39, #65) are false "stale" answers** under `stable`. I read the two diffs
  of each by hand. In each, the only lines that differ are context: the row above the PR's new
  row in `experiments/README.md`. Main had gained a newer row. git calls this a conflict, since
  both sides add at the end of the same table: `git merge-tree` reports `CONFLICT (content)` in
  that file for all 4. So `replay` drops them too.
- **The other 7 were real changes.** Every way agrees on them.

## 6. How others do it

- **`git range-diff`** compares two versions of a series commit by commit. It builds "a cost
  matrix between the commits in both commit ranges, then solve[s] the least-cost assignment",
  where the cost of a pair is the size of the diff between their diffs
  ([git docs](https://git-scm.com/docs/git-range-diff)). git's own contributor guide has
  `format-patch` put a range-diff against v1 into the cover letter of v2
  ([MyFirstContribution](https://git-scm.com/docs/MyFirstContribution)). The kernel tool b4
  "executes a `git range-diff` command that lets you compare the previously sent version of the
  series" ([b4 docs](https://b4.docs.kernel.org/en/latest/contributor/prep.html)). The kernel's
  own submitting-patches page asks only for a changelog against the previous version
  ([kernel.org](https://www.kernel.org/doc/html/latest/process/submitting-patches.html)); it
  does not name range-diff. It is a tool for a person to read, not a yes or no: it pairs
  commits, so a squash reads as all changed (sections 1 and 5).
- **`git patch-id`** is "a sum of SHA-1 of the file diffs associated with a patch, with line
  numbers ignored". With `--stable`, "All whitespace within the patch is ignored"; `--verbatim`
  does "not strip any whitespace" ([git docs](https://git-scm.com/docs/git-patch-id)).
  `--verbatim` is in git 2.39.0 and later. On git 2.40.1, `--stable --verbatim` together is an
  error; `--verbatim` alone implies `--stable`. The docs say nothing about mode lines, renames,
  binary files or the `index` line. Read from the source (medium confidence, not confirmed by a
  doc): `index` and `@@` lines are skipped, mode and rename lines are hashed, and a binary file
  is hashed by its blob ids ([patch-id.c](https://raw.githubusercontent.com/git/git/master/builtin/patch-id.c)).
  Section 3 agrees with that on every row.
- **Gerrit** copies a vote to a new patch set when the label's `copyCondition` query matches
  ([config-labels](https://gerrit-review.googlesource.com/Documentation/config-labels.html)).
  `changekind:TRIVIAL_REBASE` matches when the commit message is "same as in the previous patch
  set and if it has the same diff (including context lines)", and only if the rebase "did not
  require git to perform any conflict resolution". `changekind:NO_CODE_CHANGE` is the same tree
  and parent, only the message may differ. The old flags such as `copyAllScoresOnTrivialRebase`
  are deprecated in favour of these queries
  ([change](https://gerrit.googlesource.com/gerrit/+/3dba2fd36c0fc5618d32dcd03757892448c22fae%5E%21)).
  Our `replay` is the nearest thing we can build. **Unconfirmed:** how Gerrit computes "the same
  diff", and so whether it would keep the "2 lines above" case that `replay` keeps.
- **GitHub**: "GitHub records the state of the diff at the point when a pull request is
  approved", and dismisses the approval if the diff changes
  ([rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)).
  Since 2023: "Merge bases changing under a pull request will preserve approvals in most
  situations where no new changes are introduced"
  ([changelog](https://github.blog/changelog/2023-06-06-security-enhancements-to-required-approvals-on-pull-requests/)).
  **Unconfirmed:** how GitHub compares diffs; "in most situations" is not defined. A request to
  key approvals on a hash of the diff is still open
  ([discussion](https://github.com/orgs/community/discussions/12876)).
- **GitLab** does what the proposal says: "GitLab uses git patch-id to identify diffs in merge
  requests", so a rebase or a merge of the target need not reset approvals
  ([GitLab docs](https://docs.gitlab.com/user/project/merge_requests/approvals/settings/)).
  **Unconfirmed:** which patch-id mode it uses, and so whether it has the whitespace hole of
  section 3.

## 7. What to do

- **Bind the review to the diff, not the head.** Why: the sha threw away 13 of 13 real reviews
  and was wrong on 18 of 30 cases. It was never right on a "same" case. GitHub and GitLab
  already key on the diff. Cost: one git call per check, milliseconds. How sure: 90%.
- **Never use whitespace-blind patch-id.** Why: it carried a YAML indent change and a space
  inside a string (section 3). That is an approval carried over a real change, and an author or
  an agent can do it on purpose. Cost: none; `--verbatim` is one flag on git 2.39 and later.
  How sure: 95%.
- **Keep a review in silence only on a clean replay.** Why: it was right in every case except
  the two conflict rows, where it errs toward "stale". It made no wrong "same". It is close to
  Gerrit's trivial rebase. Cost: it keeps only 2 of the 13 real pushes, since the common
  README-row case is a git conflict. How sure: 80%.
- **When only the `-U0 --verbatim` id matches, ask for a glance, not a full review.** Why: in
  this repo that is 4 of 13 pushes, all harmless context. A full review again is a whole agent
  run. But `u0v` misses a moved line, so it must not keep a review in silence. A glance is the
  Judge move: one narrow question over the range-diff, which here is a few lines. Cost: one more
  answer to build and a cheap model call per such push. How sure: 65%. The doubt: 4 cases, one
  pattern, one repo. What would settle it: this script on a repo with many more force pushes
  (it takes `REPO=<url>`), counting `u0v`-only matches that hid a real change.
- **Merge needs the checks green at the final head, always.** Why: section 4. No binding sees a
  break that main brings in. Cost: a check run per rebase before merge, as today. How sure: 95%.

## 8. A sketch: what the review fact carries, and what push and merge check

**This is a sketch, not code in the repo.** It changes the `reviewed` fact in
`packages/pipeline/src/tickets/ticket.ts` and the rule in
[nothing is pushed before review](../docs/direction/push-after-review.md), which says only a
commit with a passing `reviewed` fact can be pushed.

```ts
// A sketch. The ledger still holds no code: only shas and one id (the claim check).
const DiffId = Schema.String.check(Schema.isPattern(/^([0-9a-f]{40}|empty)$/));

Schema.Struct({
  type: Schema.Literal("reviewed"),
  head: Sha,     // the commit the reviewer read: kept for the record and for the replay
  base: Sha,     // where it left main: git merge-base main <head>
  diff: DiffId,  // git diff -U0 <base> <head> | git patch-id --verbatim
  met: Count,
  of: Count,
  findings: Schema.Array(Id),
});

// One Gather, in code, run by push and by merge on the head they are about to send.
type Carry =
  | {kind: "kept"; why: "same_head" | "replayed"}
  | {kind: "glance"; range: string} // range-diff text, for one narrow question
  | {kind: "stale"};

const carry = (r: Reviewed, head: Sha): Carry => {
  if (head === r.head) return {kind: "kept", why: "same_head"};
  const base = mergeBase("main", head);
  if (replays(r.head, r.base, head, base)) return {kind: "kept", why: "replayed"};
  if (diffId(base, head) === r.diff) return {kind: "glance", range: rangeDiff(r, head)};
  return {kind: "stale"};
};
```

- **Push:** goes ahead on `kept`. On `glance`, a Judge answers "did only context change?" over
  the range-diff; a yes is written as a new `reviewed` fact for the new head, with the old
  verdict and findings. On `stale`, back to review.
- **Merge:** the same `carry` at the final head must be `kept` (or carried by a glance), **and**
  the checks must be green at that exact head. A review never stands in for the checks.
- **Example, #53 of this repo:** reviewed at `8021473`, force-pushed to `3999cda` after a
  rebase. The replay is clean, so `carry` returns `{kind: "kept", why: "replayed"}`. Today's
  fact would have needed a new review.
- **Example, #35:** `608ca40` to `479e182`. The replay conflicts, the `u0v` id matches, so
  `{kind: "glance"}`; the two diffs differ in one context row.

## 9. What it cannot tell us

- **One repo, 13 force pushes.** 4 of them are one pattern. A repo where people rebase daily
  would give a better count of false "stale" answers and of `u0v`-only matches.
- **Whether a glance is safe in practice.** No `u0v`-only match here hid a real change, but
  there were only 4. The moved-line hole is shown only on a made-up case.
- **The cases are small and made by hand.** Each tests one thing in a 20-line file. Real diffs
  mix many of these at once.
- **Context of 3 lines only.** `git diff` was left at its default. A wider or narrower context
  moves the false "stale" band; only `-U0` removes it.
- **How GitHub and Gerrit decide exactly.** Both are marked unconfirmed in section 6.
- **Part 4 is one example of a break that main brings in.** It shows the catch exists; it does
  not say how often it happens.
- **git 2.40.1 only.** `merge-tree --merge-base` needs 2.40; another git version, or another
  rename threshold under `-M`, could change a row.
- **Stacked PRs.** The script takes every base from main. A PR stacked on another PR would read
  the lower PR's lines as its own.

## Cost

$0. No model, no key. One run takes about 40 seconds: parts 1 to 4 a few seconds, part 5 a
clone of this repo, a fetch of every PR head, 3 GitHub GraphQL calls and a few hundred git
calls.

## How to run it

```sh
P='env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15'
$P node experiments/165-review-binds-to-diff.ts          # all parts
$P node experiments/165-review-binds-to-diff.ts cases    # parts 1 to 4, no network
$P node experiments/165-review-binds-to-diff.ts real     # part 5; WORK=<dir> keeps the clone, REPO=<url> reads another repo
```
