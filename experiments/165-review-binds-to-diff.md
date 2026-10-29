# 165. A review bound to the diff, not the commit

The question: the owner keeps PR branches current by rebasing onto main and force-pushing.
Today the `reviewed` fact carries `head`, a commit sha
(`packages/pipeline/src/tickets/ticket.ts`). So every rebase makes a review look stale, even
when the code is the same. The proposal: tie the review to the diff instead, named by
`git patch-id --stable` of the PR's whole diff against its base. Does that hold up?

**Answer: tie it to the diff, yes. But not with plain `--stable`, and read the diff against
the PR's base branch, not main. Confidence 85% on the direction, 75% on the exact rule (70%
before part 6).**

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
- **2000 generated cases agree with all of that** (part 6a, fast-check, seed 165). The replay
  made no wrong answer in 1281 scored cases. `-U0 --verbatim` kept the review over 31 moved
  lines, plain `--stable` over 10 whitespace changes that matter.
- **Stacked PRs need the PR's base branch, not main** (part 6b). Read against main, no id
  survives the parent's squash-merge (0 of 129), and a restack that quietly undoes the
  parent's new commit keeps every id and the replay. Read against the base branch, every way
  keeps the review across a squash-merge, with no wrong "same" in 53 cases.

```ts
// The whole idea, as a sketch. Three answers when a reviewed PR gets a new head.
const carry = (r: Reviewed, head: Sha, onto: Branch): "kept" | "glance" | "stale" => {
  const base = mergeBase(onto, head); // onto: the PR's base branch now, a parent or main (6b)
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
  changed. Its saved answers for part 5: `results/165-review-binds-to-diff.json`; for part 6:
  `results/165-review-binds-to-diff-gen.json` and `results/165-review-binds-to-diff-stack.json`.
- **Today's fabrika:** nothing of it ran. No ledger, no lane, no agent, no real ticket changed.
- **git:** 2.40.1, with the user's git config switched off (`GIT_CONFIG_GLOBAL=/dev/null`), so
  a setting like `diff.renames` cannot change an answer.
- **GitHub:** read through `gh api graphql` (merged PRs, merge commits, force-push events) and
  one `git clone` plus `git fetch` of this repo into a temp folder. Read-only.
- **Research:** the docs of git, Gerrit, GitHub and GitLab, read on the web. Section 7.

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
- **Part 6** makes cases at random with fast-check, from a fixed seed, and knows each answer by
  how the case was made. Section 6 says how.

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
  research says patch-id hashes a binary file by its blob ids, not its bytes (section 7). An
  empty diff has no patch-id at all; the script names it `empty`, so two empty PRs share it.
- **`fn`**, our own hash, fixed the moved line but broke on both conflict rows, and on one real
  push in part 5. (**Wrong in part**, found by part 6a: it fixes a line moved to another
  function only. A line moved inside the same function keeps its id.) The function name git prints is a guess from the line above, so it moves when
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
not change, but a person did resolve a conflict. Gerrit says no for a conflict (section 7). The
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

## 6. Generated cases

Parts 1 to 3 only find the holes someone thought to look for. Part 6 makes cases at random
with fast-check and knows each answer by how the case was made. The seed is 165, fixed in the
script, so a rerun makes the very same cases.

- **The file.** One `file.txt` of 2 to 5 blocks, 10 to 40 lines. A block is a small function
  (tab, 2 or 4 spaces, sometimes a nested `if`) or a YAML-ish map (2, 3 or 4 spaces, sometimes
  a nested key). Lines repeat on purpose: many `}`, blank lines and `return a + b;`.
- **The PR.** 1 to 3 edits: change a line, delete a line, or add 1 or 2 lines. A change adds a
  word, a number or a comment, or changes only whitespace: the indent, a space inside a string,
  a space between words, a space at the end.
- **The new head.** Either a rebase over 1 or 2 edits on main, or the PR made again: the same,
  split into 2 commits, one of its lines changed, one more edit, an added line moved to another
  spot, or one edit dropped. A PR made again is also rebased when main moved.
- **Each answer is known by construction.** "Far" means at least 3 untouched lines between two
  edits: outside git's 3 lines of context. A case whose answer would be a guess is skipped and
  counted:

  ```ts
  // A sketch of how build() labels a case; the script has every rule.
  if (rebase) {
    if (mainChangedTheWordsOfAPrLine) return "changed"; // resolved 3 ways: PR's, main's, both
    if (anyMainEditWithin3Lines) return "skip";          // the part 3 band: a judgement call
    return "same";
  }
  // made again: the two PRs applied to the same base file
  if (sameText(before, after)) return "same";
  if (wordsDiffer(before, after)) return "changed";      // any non-whitespace difference
  if (whitespaceInYamlIndentOrString(before, after)) return "changed";
  return "skip";                                         // whitespace where it means nothing
  ```
- **For each wrong "same"**, `fc.check` finds one again from the same seed and shrinks it to
  the smallest case that still fails. The smallest cases are below, as the script prints them.
- **Gentle on the machine.** 6a stores commits with plumbing only (`hash-object`, `mktree`,
  `commit-tree`) in one bare repo; 6b runs real `git rebase` in one work repo. Both sit in a temp
  folder, removed at the end, under `nice -n 15`. 6a takes about 4 minutes, 6b about 2.

### 6a. One PR on main

2000 made, 719 skipped, 1281 scored: 605 should stay the same, 676 should change. Skipped: 540
had a main edit 1 to 3 lines from a PR edit, 93 changed only whitespace where it means nothing,
86 had both sides make the same change.

| way | wrong "same" (of 676) | wrong "stale" (of 605) | the wrong "same" cases |
|---|---|---|---|
| sha | 0 | 605 | |
| stable | 10 | 2 | all whitespace in a YAML indent or a string |
| verbatim | 0 | 2 | |
| u0 | 41 | 0 | 31 moved lines, 10 whitespace |
| u0v | 31 | 0 | all moved lines |
| fn | 9 | 20 | all moved lines, inside one function |
| replay | 0 | 0 | |
| range-diff | 0 | 158 | |

- **The replay made no wrong answer**, either way, in 1281 cases.
- **`verbatim` made no wrong "same".** It made 2 wrong "stale" answers, as `stable` did. The
  smallest (the script prints it) has this shape: the PR deleted one of two equal lines, and
  git's diff shows the other one deleted. That moves the hunk by a line, so main's edit, 4
  lines from the line the PR deleted, lands inside the context of the hunk git shows. The
  answer "same" is right: git just picked the other of two equal diffs. I did not read the
  second case.
- **`u0v`'s hole is the moved line, and generated code hits it often:** 31 of the 54 "moved"
  cases. The smallest:

  ```diff
  should be: changed (force push: move, words)
  reviewed PR, against its base:
  @@ -1,3 +1,4 @@
  +	check(a);
   function add(a, b) {
   	return a + b;
   }
  new head, against its base:
  @@ -1,4 +1,5 @@
   function add(a, b) {
  +	check(a);
   	return a + b;
   }
  ```

  `check(a)` moved from outside the function to inside it. The `-U0` diff is one added line in
  both, so the id is the same. `u0` has the same smallest case.
- **`fn` has the same hole, inside one function.** Part 3 said it fixed the moved line; that
  holds only for a move to another function (marked in part 3). The smallest:

  ```diff
  should be: changed (force push: move, words)
  reviewed PR, against its base:
  @@ -1,4 +1,6 @@
  +	check(a);
   function add(a, b) {
  +	check(a);
   	return a + b;
   }
  new head, against its base:
  @@ -1,5 +1,7 @@
  +	check(a);
   function add(a, b) {
   	return a + b;
  +	check(a);
   }
  ```

  Both moved lines sit under `function add(a, b) {`, so git prints the same function name on
  their `@@` lines.
- **`stable`'s hole, the smallest:** the PR renames a YAML key; the new head also indents it,
  which makes it a child of the key above.

  ```diff
  should be: changed (force push: tweak, whitespace in YAML indent or a string)
  reviewed PR, against its base:
  @@ -3,6 +3,6 @@ function add(a, b) {
   	return a + b;
   }
   
  -add:
  +addx:
     port: 8080
  new head, against its base:
  @@ -3,6 +3,6 @@ function add(a, b) {
   	return a + b;
   }
   
  -add:
  +  addx:
     port: 8080
  ```
- **`range-diff` never said a wrong "same"**, but it threw away 158 of 605: all 121 split
  pushes, since it pairs commits one to one, plus 37 rebases.

### 6b. A child PR stacked on a parent PR

A child PR sits on the parent PR's branch, and its diff is read against the parent. Five kinds
of case. The restacks are real `git rebase` runs:

- **1a, same.** The parent gets a new commit, far from the child's lines. On the child:
  `git rebase --update-refs parent`.
- **1b, same.** Main moves, far from both PRs. On the child: `git rebase --update-refs main`,
  which restacks the parent too.
- **2, same.** The parent is squash-merged into main, sometimes after a last fix far from the
  child's lines. On the child: `git rebase --onto main <old parent tip>`. The child's base
  branch is now main.
- **3a, changed.** The parent's new commit changes the words of a line the child changed. The
  restack stops on a conflict; it is resolved 3 ways: the child's side, the parent's, or both.
- **3b, changed.** The same, but the parent's last fix is squash-merged and the child moves to
  main.

On a conflict the script writes the file the case expects, as a person would, and goes on. If
git's own result were not that file, the case would be skipped. That never happened: all 250
cases of 1a, 1b and 2 restacked cleanly, and all 53 of 3a and 3b stopped on a conflict.

Every way is asked twice. **main:** each base is `git merge-base main <head>`, as in parts 1 to
5 and 6a. **branch:** each base is taken from the PR's base branch at that moment: the parent
while the child is stacked, main once the parent is merged.

600 made, 297 skipped (164 where nothing moved, 104 with an edit 1 to 3 lines away, 29 with
the same change on both sides), 303 scored. How often each way said "same" (right in 1a, 1b
and 2; wrong in 3a and 3b):

| way | 1a (68) | 1b (53) | 2: squash-merge (129) | 3a (22) | 3b (31) |
|---|---|---|---|---|---|
| sha | 0 | 0 | 0 | 0 | 0 |
| stable, main | 0 | 53 | 0 | 5 ✗ | 0 |
| stable, branch | 68 | 53 | 128 | 0 | 0 |
| verbatim, main | 0 | 53 | 0 | 5 ✗ | 0 |
| verbatim, branch | 68 | 53 | 128 | 0 | 0 |
| u0v, main | 0 | 53 | 0 | 5 ✗ | 0 |
| u0v, branch | 68 | 53 | 129 | 0 | 0 |
| fn, branch | 65 | 53 | 127 | 0 | 0 |
| replay, main | 0 | 53 | 91 | 5 ✗ | 0 |
| replay, branch | 68 | 53 | 129 | 0 | 0 |
| range-diff, main | 0 | 51 | 0 | 0 | 0 |
| range-diff, branch | 64 | 52 | 122 | 0 | 0 |

`u0` reads like `u0v`, and `fn` against main like `stable` against main (one fewer in 1b); the
script prints every row.

- **Across a parent's squash-merge, every way keeps the review when read against the base
  branch:** `u0`, `u0v` and the replay 129 of 129, `stable` and `verbatim` 128, `fn` 127,
  `range-diff` 122. Against main, no id keeps it (0 of 129), and the replay keeps 91: before
  the merge, the child's diff against main holds the parent's lines too; after it, only its own.
- **Against main is not only wasteful, it is unsafe.** Every way but `range-diff` said a wrong
  "same" in 5 of the 22 3a cases, all resolved with the child's side. The restack quietly undid
  the parent's new commit. Against main, the child's diff is the parent's lines plus its own,
  before and after, so nothing looks changed. Against the parent, the new diff removes the
  parent's new line, and every way sees it. The smallest:

  ```diff
  should be: changed (3a. parent's new commit changed a child line; kept the child's side)
  parent PR, against main:
  @@ -1,4 +1,4 @@
  -function add(a, b) {
  +functionx add(a, b) {
   	return a + b;
   }
  child PR as reviewed, against the parent:
  @@ -1,5 +1,5 @@
   functionx add(a, b) {
  -	return a + b;
  +	return a + b; // edited
   }
   
   function add(a, b) {
  the parent's new commit:
  @@ -1,5 +1,5 @@
   functionx add(a, b) {
  -	return a + b;
  +	returnx a + b;
   }
   
   function add(a, b) {
  child's new head, against its base branch (parent):
  @@ -1,5 +1,5 @@
   functionx add(a, b) {
  -	returnx a + b;
  +	return a + b; // edited
   }
   
   function add(a, b) {
  ```

  The everyday version: the parent PR adds `requireAdmin()` in a new commit, on a line the child
  also edits. The child's restack keeps its own version of the line. Against main, the child's
  review carries over the lost `requireAdmin()`; no one reviews its loss.
- **Against the base branch, no way said a wrong "same"** in the 53 cases. Wrong "stale"
  answers: `stable` and `verbatim` 1, `fn` 5, `range-diff` 12, `u0`, `u0v` and the replay 0.
  The smallest under `verbatim` shows a gap in the generator, not in git: it counts "far" on
  the file before the parent's edits. The parent deleted a line, so in the parent's file the
  child's edit and the parent's new edit sat 2 lines apart, inside each other's context. The
  answer "same" stays right; the gap costs only false "stale" answers.
- **So the fingerprint must be taken against the PR's base branch**, the one the PR targets at
  that moment, not `origin/main`. When the parent merges and the child is moved to main, the
  check reads it against main.

## 7. How others do it

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

## 8. What to do

**What part 6 changed:** one new rule (read every diff against the PR's base branch), the
replay's confidence up from 80% to 85%, and no change to the other leans. Their numbers below
now include part 6.

- **Bind the review to the diff, not the head.** Why: the sha threw away 13 of 13 real reviews
  and was wrong on 18 of 30 cases. It was never right on a "same" case. GitHub and GitLab
  already key on the diff. Cost: one git call per check, milliseconds. How sure: 90%.
- **Never use whitespace-blind patch-id.** Why: it carried a YAML indent change and a space
  inside a string (section 3), and 10 more such changes in 6a. That is an approval carried
  over a real change, and an author or an agent can do it on purpose. Cost: none;
  `--verbatim` is one flag on git 2.39 and later. How sure: 95%.
- **Read every diff against the PR's base branch, never always main.** New with part 6. Why:
  for a stacked PR, main as the base makes every id and the replay keep a review over a restack
  that undid the parent's new commit (5 of 22 cases), and throws away every review when the
  parent is squash-merged (0 of 129 kept). Against the base branch: no wrong "same" in 53
  cases, and 122 to 129 of 129 kept across the squash-merge. GitHub shows a stacked PR's diff
  against its base branch too. Cost: the check needs the PR's base branch at that moment, one
  field the PR already has; a moved base (the parent merged, the child moved to main) is just
  the new base. How sure: 85%. The doubt: a base branch that is not reviewed the same way. If
  the parent's branch gains lines no one reviewed, the child's diff against it does not show
  them; those lines reach main only through the parent's own PR, which must then be reviewed
  under the same rule. Part 6b does not test a parent that is force-pushed, or a stack merged
  child into parent first. What would settle it: those two kinds of case, added to 6b.
- **Keep a review in silence only on a clean replay.** Why: it was right in every case except
  the two conflict rows, where it errs toward "stale". It made no wrong "same". In part 6 it
  made no wrong answer at all, either way: 1281 cases in 6a, 303 in 6b against the base
  branch. It is close to Gerrit's trivial rebase. Cost: it keeps only 2 of the 13 real pushes,
  since the common README-row case is a git conflict. How sure: 85% (80% before part 6). The
  doubt: part 6 is one generator of my own making, on one file; it cannot make a rename, a
  binary file or two files at once.
- **When only the `-U0 --verbatim` id matches, ask for a glance, not a full review.** Why: in
  this repo that is 4 of 13 pushes, all harmless context. A full review again is a whole agent
  run. But `u0v` misses a moved line (31 of 54 generated moves in 6a), so it must not keep a
  review in silence. A glance is the
  Judge move: one narrow question over the range-diff, which here is a few lines. Cost: one more
  answer to build and a cheap model call per such push. How sure: 65%. The doubt: 4 cases, one
  pattern, one repo. What would settle it: this script on a repo with many more force pushes
  (it takes `REPO=<url>`), counting `u0v`-only matches that hid a real change.
- **Merge needs the checks green at the final head, always.** Why: section 4. No binding sees a
  break that main brings in. Cost: a check run per rebase before merge, as today. How sure: 95%.

## 9. A sketch: what the review fact carries, and what push and merge check

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
  base: Sha,     // where it left its base branch: git merge-base <base branch> <head> (6b)
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

// onto: the branch the PR targets now. A parent while stacked, main once the parent merged.
const carry = (r: Reviewed, head: Sha, onto: Branch): Carry => {
  if (head === r.head) return {kind: "kept", why: "same_head"};
  const base = mergeBase(onto, head);
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

## 10. What it cannot tell us

- **One repo, 13 force pushes.** 4 of them are one pattern. A repo where people rebase daily
  would give a better count of false "stale" answers and of `u0v`-only matches.
- **Whether a glance is safe in practice.** No `u0v`-only match here hid a real change, but
  there were only 4. The moved-line hole is shown only on made-up cases, by hand and generated.
- **The cases are small.** Parts 1 to 3 test one thing each in a 20-line file. Part 6 mixes
  several edits, but in one file of 10 to 40 lines, from a generator I wrote. It finds only the
  holes that generator can make: no renames, binary files, mode changes or second files.
- **Part 6's answers are my rules.** A whitespace change in a code indent, or between words, is
  skipped, not scored (93 cases), and so is a main edit 1 to 3 lines from a PR edit (540): the
  band where part 3 already showed the ways differ. "Far" is counted on the base file, not on
  the parent's file in 6b, which made a few false "stale" answers but no wrong labels I found.
  I read the smallest case of each wrong answer, and a dozen random cases while building it,
  not all of them.
- **Context of 3 lines only.** `git diff` was left at its default. A wider or narrower context
  moves the false "stale" band; only `-U0` removes it.
- **How GitHub and Gerrit decide exactly.** Both are marked unconfirmed in section 7.
- **Part 4 is one example of a break that main brings in.** It shows the catch exists; it does
  not say how often it happens.
- **git 2.40.1 only.** `merge-tree --merge-base` needs 2.40; another git version, or another
  rename threshold under `-M`, could change a row.
- **Stacked PRs, only in part.** Parts 1 to 5 take every base from main; 6b shows that is
  wrong for a stacked PR. 6b covers one child on one parent, restacked by rebase. It does not
  cover a parent force-pushed under the child, a stack merged child into parent first, three
  PRs high, or a PR moved to an unrelated branch.

## Cost

$0. No model, no key. Parts 1 to 5 take about 40 seconds: parts 1 to 4 a few seconds, part 5
a clone of this repo, a fetch of every PR head, 3 GitHub GraphQL calls and a few hundred git
calls. Part 6 takes about 6 minutes on a laptop: 6a about 4 (1741 cases asked of git,
counting the ones fast-check tried while shrinking), 6b about 2. No network.

## How to run it

```sh
P='env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15'
$P node experiments/165-review-binds-to-diff.ts          # all parts
$P node experiments/165-review-binds-to-diff.ts cases    # parts 1 to 4, no network
$P node experiments/165-review-binds-to-diff.ts real     # part 5; WORK=<dir> keeps the clone, REPO=<url> reads another repo
$P node experiments/165-review-binds-to-diff.ts gen      # part 6a, no network; RUNS=<n> cases, 2000 by default
$P node experiments/165-review-binds-to-diff.ts stack    # part 6b, no network; STACK_RUNS=<n> cases, 600 by default
```

The seed is 165 in both. A rerun with the same git and the same counts prints the same tables.
