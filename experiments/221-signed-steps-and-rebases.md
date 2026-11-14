---
date: "2026-11-06"
summary: "`next/`, Tier 1's P32; reading of Gerrit, Chromium, AOSP, GitLab, GitHub, SLSA, gittuf, in-toto, gitsign, Sapling, ghstack, Phabricator, Graphite and Google, plus one local test. Nobody reuses a signature over bytes that changed: each binds its proof to an exact thing and reruns a check. The common one is Gerrit's trivial rebase (replay the old change onto the new parent, compare trees, a conflict carries nothing); gittuf binds to the merge tree. Locally the replay kept every commit across a cascading rebase and a bottom squash-merge, and caught an added line and a dropped commit. GitHub served all 28 force-pushed-away heads on this repo by sha (14 days, undocumented). Native stacks: conflict handling, signing key (its docs contradict themselves), notes and \"linear\" are unknown. Lean, 70%: sign the link (step, from tree, to tree), carry by replay, keep old heads; merge-only until then. Found: an older signed commit passes P32 as planned; the plan's \"rebase\" line contradicts the merge rule. No model, $0."
---

# Who signs each step of a change and still survives a rebase or a stack, and how?

This is reading, plus one local test. Read 2026-11-06 from primary sources: docs sources, code,
design docs, and GitHub's API on this repo, read only. The local test is
[`221-stacks-carry.sh`](./221-stacks-carry.sh), its output in
[`results/221-stacks-carry.txt`](https://github.com/usirin/tea-fabrika/blob/423fb9cf2b7d5affd7fd10bf131659a242f43510/experiments/results/221-stacks-carry.txt). No repo was created on GitHub,
no model ran, $0 (three research subagents, their tokens not logged). "Guess" marks what no source
says.

It is for `next/` only: Tier 1's P32, the commit check that builds
[a unit of work is a commit](../docs/direction/a-unit-of-work-is-a-commit.md). P32 has each
step's key sign a note per commit over its step, sha, parents, parent's tree and tree. A quick
test the same day showed a rebase changes every one of those fields. GitHub's native stacked pull
requests rebase upper branches. This asks what the world does about that. Today's version does
not change. It changes no note; the leans below are proposals for the owner.

```text
// The whole idea, as a sketch with made-up shas.
// Today P32 signs:  step build, commit b72d9e4, parents a1f0c3e, from 9e02a1c, to c7a8f55
// A rebase makes a new commit 5d0e1aa with parent 77c3b20 and tree 3f8e0d1. All four fields change.
//
// The known way (Gerrit, which Chromium and Android run): never carry a signature whose bytes
// changed. Carry the decision, by a check anyone can rerun:
//   merge-tree --merge-base=<old parent> <new parent> <old commit>  ==  tree of the new commit?
//   yes, and no conflict  -> kept: the step's signed change, replayed onto the new parent
//   no, or a conflict     -> stale: that step signs again
```

## The answer

- **Nobody reuses a signature over bytes that changed.** Not Gerrit, gittuf, GitLab, GitHub,
  SLSA's source-tool, Sapling or ghstack. Each keeps its proof bound to an exact thing, and
  decides by a check anyone can rerun whether that proof still covers the new thing.
- **The common check is Gerrit's trivial rebase.** Gerrit replays the old patch set onto the new
  parent with an in-memory three-way merge and compares the result with the new tree. A conflict
  means no carry. Chromium and AOSP carry Code-Review on it, and do not carry Verified or bot
  votes past `NO_CHANGE`. [A yes binds to the diff](../docs/direction/a-yes-binds-to-the-diff.md)
  already chose this check for reviews (`replayed`, line 33).
- **The other camp binds to the tree.** gittuf's reference authorization signs "the Git merge tree
  resulting from the change", so an approval survives any rebase, squash or merge shape that lands
  the same tree on the same base. gitsign's experimental `attest` has a tree mode "to preserve
  attestations for squash commits". P32's tree-to-tree link has this shape already.
- **SLSA avoids the question.** Its source track forbids force-push on the protected branch and
  binds review to "the final revision submitted". It says nothing about rebasing a pull
  request's own branch.
- **Lean for P32, 70%:** sign the link (`step`, `from` tree, `to` tree), not the commit, and carry
  it across a rebase by Gerrit's replay check, the old head kept under a kept ref. GitHub's
  force-push event is a cross-check only. Until that is built, P32 stays merge-only, which works
  today. But the signed text is a data-shape call: change it before the first real note, or every
  early note must be signed again.
- **A hole in P32 as planned, rebase or not.** A builder can push an older signed version of the
  test writer's commit, and p83 accepts it. Only a ledger rule closes it ("the step's newest
  `attested` for this lane"). The owner's read of every exam path holds it meanwhile.
- **Settled notes disagree on catching up.** [The plan](../docs/plan/README.md) line 137 says
  "rebase and force-push with a lease, never a merge commit".
  [Done is per criterion](../docs/direction/done-is-per-criterion.md) line 98 says "Catching up is
  a merge of main, never a rebase", [read fresh, run alone](../docs/direction/read-fresh-run-alone.md)
  lines 72 to 76 keep the merge, and P32's p86 says "never a rebase". For a pull request P32
  checks, the plan's line is the one that breaks the check.

## The systems

"Bound" is what the proof names. "Lost" is the trust that does not come along.

| System | Bound | Survives a rebase | Re-checked on a new version | Trust lost |
|---|---|---|---|---|
| Gerrit votes | a patch set (exact sha) inside a change | a vote, if the label's `copyCondition` matches, such as `changekind:TRIVIAL_REBASE` | three-way replay of the previous patch set onto the new parent, trees compared; a conflict is `REWORK` | the voter never saw the new sha; the rebased commit is made by the server and unsigned |
| Gerrit Change-Id | nothing: a random id the client writes into the message | yes, it pairs patch sets | repo, branch and Change-Id must match | anyone can reuse it; it pairs, it proves nothing |
| Gerrit signed push | pusher, ref, old sha to new sha, nonce | no: a server rebase has no push and no certificate | at push time only | the rebased patch set carries no person's signature |
| Chromium and AOSP | as Gerrit | Code-Review, Owners-Override, SLSA-Policy-Verified on a trivial rebase; Verified, Commit-Queue (parent project), Bot-Commit, Pure-Revert on `NO_CHANGE` only | as Gerrit | judgment carries; machine checks and bot votes do not |
| GitLab | each approval stores the `patch_id_sha` of its diff | approvals whose patch-id still matches | `git patch-id` of base..head on every push | patch-id ignores line numbers, so a moved hunk can keep an approval |
| GitHub reviews | "the state of the diff at the point when a pull request is approved" | an approval while the diff is the same | GitHub's own diff compare (method not public) | rebased commits are new and, from the web, unsigned |
| GitHub native stacks | as GitHub reviews | approvals, "even when the Dismiss stale pull request approvals ... rule is enabled", if the diff does not change | GitHub's diff compare | its docs disagree on whether rebased commits are signed |
| GitHub artifact attestations | a build artifact's digest; the provenance names the source commit | no, it names the old commit | n/a: it attests builds, not source | n/a |
| SLSA v1.2 source track | the revision (`gitCommit`, may add `gitTree`) on a protected branch | not meant to: force-push is banned, and continuity must be re-established after a lapse | review applies to "the final revision submitted" | anything on the PR branch before the final version |
| slsa source-tool | notes on `refs/notes/commits`, keyed by commit, signed by one CI workflow | nothing; a gap "requires the policy to be updated" | the prior commit's attestation, per push | n/a, rewrites are blocked |
| gittuf | RSL entries (its signed log of ref updates): ref and commit. Reference authorizations: from-commit and merge **tree** | an authorization, if the landed commit has the same tree on the same base (the key holds the base tip, so a moved main means re-issue: read from code, not prose) | the merge tree, recomputed and compared | force-pushed RSL entries are marked "skipped" by a later annotation |
| in-toto links | materials and products as digests (`gitCommit`, `gitTree`, `gitBlob` all defined) | yes, if products are named by tree | the layout's `MATCH` rules | n/a; no git-specific ITE exists |
| Sigstore gitsign | the commit object | no: git signs again as the rebaser if `commit.gpgsign` is set | n/a | the original signer; `attest --objtype tree` is the experimental way out |
| Sapling and ghstack | Sapling: local, unsigned "B amended A" records. ghstack: `ghstack-source-id`, a tree hash in a trailer | the pairing only | none | it never was trust |
| Phabricator | an accept, remembering its diff | yes: `differential.sticky-accept` defaults to true | none (it shows "accepted-older") | everything after the accept |
| Graphite | GitHub's reviews | it tells you to turn stale dismissal off, or use its action that compares `git range-diff` | range-diff, old against new | per its action |
| Google (Critique, BAB) | BAB (Binary Authorization for Borg): a signed provenance over the submitted revision and the build | n/a: the gate is at submit | provenance verified "at least once a day" | the review paper never says whether an LGTM sticks (unconfirmed) |
| git itself | notes keyed by sha; `notes.rewriteRef` "does not have a default value" | the note's text, copied, if configured | nothing | the note now names the wrong commit |

Sources, one line each:

- **Gerrit:** [copyCondition](https://gerrit-review.googlesource.com/Documentation/config-labels.html#label_copyCondition). `ChangeKindCacheImpl.java` at master `687e000e`, re-read by hand: "A trivial rebase can be detected by looking for the next commit having the same tree as would exist when the prior commit is cherry-picked onto the next commit's new first parent", then `merger.setBase(prior.getParent(0)); if (merger.merge(next.getParent(0), prior) && merger.getResultTreeId().equals(next.getTree()))`. [Rebase REST](https://gerrit-review.googlesource.com/Documentation/rest-api-changes.html#rebase-change): "If the change cannot be rebased, e.g. due to conflicts, the response is '409 Conflict'"; `allow_conflicts` is off by default; `on_behalf_of_uploader` is "only supported for trivial rebases". [Change-Id](https://gerrit-review.googlesource.com/Documentation/user-changeid.html).
- **Chromium and AOSP:** [Chromium's project.config](https://chromium.googlesource.com/chromium/+/refs/meta/config/project.config): Code-Review `copyCondition = changekind:NO_CHANGE OR changekind:NO_CODE_CHANGE OR changekind:TRIVIAL_REBASE OR (has:unchanged-files AND uploaderin:...) OR is:MIN`, Verified `changekind:NO_CHANGE`. AOSP from the "Copied Votes" messages on [a merged change](https://android-review.googlesource.com/c/platform/frameworks/base/+/3225362): Code-Review `(changekind:NO_CHANGE OR changekind:TRIVIAL_REBASE) OR is:MIN OR ...`; its raw config needs a login (unconfirmed). [Rubber Stamper](https://chromium.googlesource.com/infra/infra/+/refs/heads/main/go/src/infra/appengine/rubber-stamper/README.md): "The `Bot-Commit +1` label is not sticky".
- **GitLab:** [approval settings](https://gitlab.com/gitlab-org/gitlab/-/blob/master/doc/user/project/merge_requests/approvals/settings.md): "GitLab uses `git patch-id` to identify diffs in merge requests"; the code calls `approvals.with_invalid_patch_id_sha(patch_id_sha)`, re-read by hand. UI rebases: "Previously-signed commits in a branch become unsigned when ... The merge request is rebased from the GitLab UI".
- **GitHub:** sources in [github/docs](https://github.com/github/docs): `available-rules-for-rulesets.md`, `about-protected-branches.md`, `stacked-pull-requests.md`, `managing-stacked-pull-requests.md`, the `rebase_and_merge_verification` reusable ("GitHub doesn't have access to the committer's private signing keys, so it can't sign the commit"), and `artifact-attestations.md` ("Artifact attestations by itself provides SLSA v1.0 Build Level 2").
- **SLSA:** [v1.2 source requirements](https://slsa.dev/spec/v1.2/source-requirements): "the SCS MUST ensure that a Branch can only be updated to point to revisions that descend from the current revision. In git, this requires a technical control to prohibit `git push --force`"; "[Final revision approved] This requirement applies to the final revision submitted". The v1.1 page is a 404: the source track starts at v1.2. [source-tool's DESIGN.md](https://github.com/slsa-framework/source-tool/blob/main/docs/DESIGN.md).
- **gittuf:** [design document](https://github.com/gittuf/gittuf/blob/main/docs/design-document.md), re-read by hand: "For a change to a branch, `ToTargetID` pre-computes the Git merge tree resulting from the change being approved"; on force pushes, "these entries must be marked as 'skipped' in the RSL using an annotation entry".
- **The rest:** in-toto's [digest_set.md](https://github.com/in-toto/attestation/blob/main/spec/v1/digest_set.md); gitsign's [attest README](https://github.com/sigstore/gitsign/blob/main/internal/commands/attest/README.md), an "experimental demo"; Sapling's [visibility-and-mutation.md](https://github.com/facebook/sapling/blob/main/website/docs/dev/internals/visibility-and-mutation.md); ghstack's [README](https://github.com/ezyang/ghstack/blob/main/README.md), "a valid identifier would be the tree hash of the commit"; Phabricator's `DifferentialReviewer.php`, where `isAccepted` returns true `if ($is_sticky)`; Graphite's [GitHub configuration guidelines](https://graphite.com/docs/github-configuration-guidelines) and [dismiss-stale-approvals](https://github.com/withgraphite/dismiss-stale-approvals); the [BAB whitepaper](https://cloud.google.com/docs/security/binary-authorization-for-borg); Google's [code review paper](https://storage.googleapis.com/gweb-research2023-media/pubtools/4476.pdf). The CACM 2016 monorepo paper was not reachable.
- **git:** `git-config(1)` in 2.40.1 for `notes.rewriteRef`; [RelNotes 2.45.0](https://github.com/git/git/blob/master/Documentation/RelNotes/2.45.0.adoc): "git merge-tree has learned that the three trees involved in the 3-way merge only need to be trees, not necessarily commits." On 2.40.1 a tree argument fails with "expected commit type" (tried).

## What GitHub keeps after a force push

- **Old heads stay fetchable by sha.** This repo had 28 force-push events between 2026-10-23 and
  2026-11-06. On 2026-11-06 every `before` sha was still served by `git fetch <url> <sha>` and by
  `GET /repos/.../commits/<sha>`. The oldest was 14 days. 26 of the 28 are reachable from no
  branch and no `refs/pull/*/head` (checked with a commits-only fetch of every advertised ref).
- **How long is not documented.** GitHub's only text is in "Removing sensitive data": old commits
  stay reachable "directly via their SHA-1 hashes in cached views" and "through any pull requests
  that reference them" until Support runs a garbage collection on request. The same page names
  internal `refs/__gh__/pull` refs on Enterprise Server; that github.com pins old pull request heads
  the same way is a guess. Truffle Security (2024, secondary) says such data stays reachable while a
  fork exists, and GitHub answered that it works as designed. Long in practice, promised nowhere: a
  design must not depend on it, and a kept ref is the safe way.
- **The event exists.** REST issue and timeline events have `head_ref_force_pushed`. GraphQL's
  `HeadRefForcePushedEvent` (introspected live) has `actor`, `beforeCommit`, `afterCommit`,
  `createdAt` and `ref`. The REST docs list only the common properties for it (REST shape not
  checked). The `pull_request` webhook's `synchronize` action carries `before` and `after`
  (OpenAPI schema `webhook-pull-request-synchronize`).
- **Who can forge it.** No public API writes a timeline event (no such endpoint in the OpenAPI
  file). GitHub writes it when someone with push rights moves the head. So it is a true record of
  "the head moved from X to Y, by this account, at this time", and says nothing about how Y relates
  to X. Any account that can push, our bot included, makes real ones. It witnesses order, not
  content. One event here came back with `ref` null, after its branch was deleted.

## GitHub's native stacks

A public preview since 2026-07-30
([changelog](https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/):
rolling out "to all repositories"). The docs' reusable is tagged `fpt` and `ghec`, which covers
Free and personal accounts, and the rollout tutorial says it needs "no setup or enablement". So
personal repos are likely in, not seen on one.

| Question | Answer | Source |
|---|---|---|
| Does "Rebase stack" refuse on a conflict, or resolve it? | **Unknown.** The docs cover only the CLI: "`gh stack rebase` stops and lists the conflicted files". | `managing-stacked-pull-requests.md`, `troubleshooting-stacked-pull-requests.md` |
| Which key signs its commits? | **Unknown, and the docs contradict themselves.** The reference page: "Rebasing the stack generates signed commits." The how-to page: "Commits created by a server-side rebase are **not** signed. If your repository requires signed commits, rebase from GitHub CLI". If signed, GitHub's web-flow key is the guess. | `stacked-pull-requests.md` against `managing-stacked-pull-requests.md` |
| Does it keep git notes? | **Unknown**, no source names notes; the guess is no. The local `gh stack rebase` runs plain `git rebase`, overriding only `rebase.updateRefs`, `rebase.autoStash` and `maintenance.auto`, so it copies notes when the repo sets `notes.rewriteRef`. It also offers to turn on `rerere` with autoupdate, which can resolve a repeated conflict with no person there. | gh-stack `internal/git/git.go` lines 152 to 163, `gitops.go` lines 352 to 357, at `bd0a325` |
| Is a merge commit allowed on an upper branch? | **Unknown on the server.** The docs require "a fully linear history between its branches" and never define it. The API's 422 "The pull requests don't form a linear stack" is about base and head refs chaining, not git history. The CLI has two meanings: its stack view calls a branch linear when its base "is an ancestor" (a merge passes), and `gh stack modify` refuses a branch that "contains a merge commit". | `stacked-pull-requests.md`; the OpenAPI file; gh-stack `stackview/data.go` lines 82 to 85, `modify/preconditions.go` lines 169 to 209 |
| Can a script start a server rebase? | **No public endpoint.** The Stacks API has list, create, get, add and unstack. | OpenAPI, `/repos/{owner}/{repo}/stacks` and below |
| Do approvals survive a rebase? | Yes, if the diff does not change, even with stale dismissal on. | `stacked-pull-requests.md` |
| What happens after the bottom merges? | The upper pull requests "automatically rebase and retarget" on the server, so every upper branch gets server-made commits, button or not. | the changelog; `merging-stacked-pull-requests.md` |
| Which base do Actions see? | Workflows run "as if each pull request in the stack targets the base of the stack". Whether `pull_request_target` fires for a mid-stack pull request, and what `base.sha` is then, is **unknown**, and P32's `base..head` range depends on it. | `stacked-pull-requests.md` |

## The local test

Two stacked branches of two commits each, tests then build, in temp repos with git 2.40.1. A
signature is stood in by "the old commit is in the signed set"; the replay is what is tested.

| Case | The replay check said |
|---|---|
| main moves; cascading rebase of both branches | all four commits `kept` |
| the bottom is squash-merged; the upper is rebased `--onto main`, as GitHub does after a bottom merge | both `kept` |
| the builder adds one line to its own commit during the rebase | tests `kept`, build `stale` |
| the builder drops the tests commit during the rebase | `stale` (2 commits became 1) |
| main changed a line the build commit changed; the conflict resolved by hand | tests `kept`, build `stale`: only the step whose commit conflicted signs again |
| an older signed tests commit is used instead of the current one | `kept` when the attacker names the old head; `stale` when the old head comes from GitHub's event |

## The designs, ranked

### 1. Sign the link, carry it by replay, keep the old heads. Lean, 70%

```ts
// A sketch. The signed text drops `commit` and `parents`, so the note can be copied.
// fabrika-step attested v2 / step build / from 9e02a1c / to c7a8f55
type Link = {step: Step; from: Tree; to: Tree; sig: SshSig};

const credit = (n: Commit, link: Link): "direct" | "replayed" | "stale" => {
	if (link.from === n.parentTree && link.to === n.tree) return "direct";
	const t = mergeTree({base: link.from, ours: n.parentTree, theirs: link.to}); // git 2.45+ takes trees
	return t !== "conflict" && t === n.tree ? "replayed" : "stale";
};
// p84 runs again on the new commit's own diff. The checks rerun at the head, always.
```

- **What it proves.** The new commit's tree is exactly the step's signed change, replayed with no
  conflict onto a parent that is on main or already credited. It does not prove the step saw the
  new parent: Gerrit carries Code-Review on the same terms, and our checks rerun at the head.
- **It survives a rebase with no new signing.** With `notes.rewriteRef=refs/notes/fabrika`, a local
  rebase or `gh stack rebase` copies the note, and it still verifies. After a server rebase, the
  lead runs `git notes copy <old> <new>` per pair. Copying gives no trust: the replay decides, so a
  wrong pairing just reads `stale`.
- **The old trees.** git 2.45 or later replays from trees alone. The objects must exist: the lead
  keeps the old head under a kept ref, which [read fresh, run
  alone](../docs/direction/read-fresh-run-alone.md) (line 76) already asks of "a stage that must
  replace a branch". GitHub's retention is only a backup.
- **What a misbehaving builder could slip through.**
  - Nothing new inside a commit: an added line, a dropped commit or a new order reads `stale`, and
    it cannot sign as `tests`.
  - A clean replay that is wrong in meaning, such as main renaming what a test calls. The checks at
    the head catch what a test can see; experiment 165 named the same gap.
  - A signed link moved to another context: a `tests` link replayed onto an unrelated parent still
    credits `tests` with that diff. SLSA says moved content "still requires review". Naming the lane
    in the signed text closes it: a field to add now, since old notes can never gain it.
  - An older signed version of a step's commit, the hole in P32 above.
- **CI cost.** One `merge-tree` per rebased commit, plus a fetch of the kept ref. Likely
  milliseconds; not timed.
- **Notes it changes.** [A unit of work is a commit](../docs/direction/a-unit-of-work-is-a-commit.md)
  lines 43 to 47 (the note holds `step`, `from`, `to`, not "the commit ... its parent"), 95 to 97
  (merging main in becomes one of two ways) and 159 to 162 ("A rebase breaks every proof", now
  answered); [a yes binds to the diff](../docs/direction/a-yes-binds-to-the-diff.md) lines 31 to 37
  (one `replayed` test for a yes and for a step's link); P32's plan, p83's signed text and its
  plant "a note that names another commit", and p86's "never a rebase"; the plan's line 137.
- **Why not higher.** Nobody runs exactly this. Gerrit replays, but its votes are rows the server
  copies; gittuf signs trees, but against a fixed base. Joining the two is ours. It also needs git
  2.45 in CI, and the lane field is the owner's call.

### 2. Carry by replay with kept refs, the signed text unchanged. 55%

- The note still names the commit. CI pairs old and new commits in order from a kept ref the lead
  pushes, and replays each. The lead writes a `carried` row.
- Proves the same as design 1, and slips the same. On top of that, the attacker picks which old
  head the kept ref names: the stale-version case reads `kept`.
- Costs more: the kept ref becomes required, notes cannot be copied over, and the carry lives only
  in CI's walk and the `field/` row.

### 3. Carry by GitHub's force-push event, no kept refs. 40%

- CI reads `HeadRefForcePushedEvent`, fetches `beforeCommit` by sha and replays as in design 2:
  Gerrit's rule, with GitHub as the record of versions.
- It adds a little on order: the attacker cannot name an old version that was not the head just
  before. But it can first force-push the old version (a real event) and then rebase it, and p83
  takes the old version anyway. It does not close the hole.
- Weak points: retention is undocumented (28 of 28 kept, 14 days, one repo). Whether Rebase stack
  and the auto-rebase make this event at all, and with which actor, is unknown.
- Best used as a cross-check in design 1: record the event next to each `carried` fact, one API
  call.

### 4. Stay merge-only and skip native stacks. 80% as Tier 1's answer, not as the end

- What P32 plans now. A `lead` merge commit catches the branch up, nothing is rewritten, and every
  note stays true. It proves the most with no new code.
- It costs native stacks. After a bottom merge, GitHub rebases every upper branch itself, so each
  upper pull request reads `unsigned_commit` on every commit. And whether a merge commit is allowed
  inside a stack at all is unknown.
- Whichever design is picked, the contradiction on catching up (in the answer above) needs fixing.

### 5. One attestation per pull request instead of per commit. 15%

- SLSA's shape: one trusted signer, CI's own identity (a GitHub Actions token through artifact
  attestations, Sigstore's public log for a public repo), signs "this final revision passed these
  controls". Rebase-proof by construction.
- It loses the point of the note: it cannot say which step wrote which lines, so "the builder never
  touches the exam" goes back to being a claim. SLSA has no per-author rule to borrow, and it brings
  in Sigstore, which the note turned down.
- It changes [a unit of work is a commit](../docs/direction/a-unit-of-work-is-a-commit.md) at its
  core (lines 39 to 53): a new design call, not an option inside P32.

## The one scratch-repo test still needed

Only GitHub's server behavior is left; the local test settles git's. One personal public repo, two
accounts (the owner and the bot), about 1 to 2 agent hours, $0.

1. A repo with one file, a ruleset on `main` (pull request required, stale approvals dismissed),
   and a `pull_request_target` workflow that writes `github.event.pull_request.base.sha`,
   `.base.ref`, `.head.sha` and `.stack` to its step summary.
2. Locally, `notes.rewriteRef=refs/notes/fabrika`. PR1 with two commits, PR2 on top with two, a
   note on each commit, the notes ref pushed, then `gh stack init` and `gh stack submit`. Do stacks
   exist on a personal repo?
3. On PR2: did `pull_request_target` fire, and is `base.sha` main's head or PR1's?
4. The owner approves PR2 (the bot wrote it). A push to main in another file. Does the merge box
   show **Rebase stack**? Click it.
5. For each new sha: `gh api repos/O/R/commits/<sha> --jq .commit.verification`; the raw `gpgsig`
   from `git cat-file -p`, against `https://github.com/web-flow.gpg`; whether `refs/notes/fabrika`
   holds a note for it; each pull request's `HeadRefForcePushedEvent` list (before, after, actor);
   whether PR2's approval was kept.
6. main changes a line PR1 changes, then Rebase stack: does it refuse, show an error, or write
   conflict markers?
7. PR1's branch merged into PR2's (no rebase): does the merge box call the stack linear, and allow a
   merge? The same with main merged into PR1.
8. PR1 squash-merged: PR2's new shas, signed or not and by what, the event and its actor, and
   whether the old PR2 commits are still fetchable.
9. `221-stacks-carry.sh`'s replay over each old and new pair: `kept` expected for steps 4 and 8,
   `stale` for step 6's commit.
10. Every `before` sha written down and fetched again at 30, 60 and 90 days. Only time settles
    retention.

## What this cannot tell us

- **GitHub's server rebase is a black box.** Conflicts, the signing key, notes, the meaning of
  "linear" and the events it makes stay unknown until steps 5 to 8 run. Its docs contradict
  themselves on signing.
- **Retention is one repo, 14 days, 28 shas.** Not a promise.
- **The local test is small:** git 2.40.1, six hand-made cases. No renames, binary files, replayed
  merge commits (Gerrit's `MERGE_FIRST_PARENT_UPDATE`) or a stack three high. Experiment 165's
  1,281 cases tested the same replay for reviews, not for links.
- **A clean replay can still be wrong in meaning.** Gerrit takes that risk for Code-Review and
  refuses it for Verified. Our checks at the head cover only what a test can see.
- **The stale-version hole is real today,** rebase or not, and this did not design its fix.
- **The subagents' readings were spot-checked, not all re-read.** Gerrit's trivial-rebase code,
  gittuf's merge-tree line and GitLab's patch-id call were re-read by hand. The Chromium and AOSP
  configs, Sapling, ghstack, Phabricator and Graphite rest on one reading each. Graphite's ref
  format and AOSP's raw config stayed unconfirmed.
