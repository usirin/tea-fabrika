---
state: "decided 2026-11-07"
summary: "Both versions. When our work needs a change in a package we do not own (tea, Manti, Effect), we `pnpm patch` it, file the upstream issue the same day, and keep building; the bump that takes the release deletes the patch. A patch goes through the pipeline's steps like any change."
---

# Patch upstream locally, and never wait for a release

**Decided 2026-11-07 (owner).** Both versions. Amended in part by
[0054](../../.decisions/0054-read-upstream-before-patching-it.md): read the package's decisions,
patterns and source first, and patch only a gap or bug that read proved.

```sh
# Our work needs a change in a package we do not own. Do all three, the same day:
pnpm patch @demlik/tea@0.23.0          # 1. make the change in the copy pnpm opens
pnpm patch-commit <the folder it printed>   #    it lands in patches/ and pnpm-workspace.yaml
gh issue create -R kamp-us/demlik ...  # 2. file the same change upstream
# 3. keep building on the patched package. Drop the patch in the pull request that takes the release.
```

## What it says

- **An upstream gap never blocks our work.** tea, Manti, Effect or any other package: when we need a
  change there, we patch our installed copy with `pnpm patch` and keep going. "Waits on upstream" is
  never a plan's answer.
- **Every patch has an upstream issue.** The pull request that adds the patch links it. A fix we keep
  only for ourselves helps nobody else and drifts on each release.
  - **The issue carries the patch (owner, 2026-11-10):** its body ends with our diff for it, folded in
    `<details><summary>The patch we apply locally</summary>` ([0060](../../.decisions/0060-upstream-issue-carries-the-patch.md)).
  - **One exception (owner, 2026-11-09):** the six Alchemy gaps listed in 0042 are patched and not
    reported as a batch
    ([0042's amendment](../../.decisions/0042-platform-pieces-go-through-alchemy.md#amendments)).
    Each such patch carries, at its `patchedDependencies` row, a comment with the gap's name and
    `not reported, 0042 amendment 2026-11-09`, so a later bump still knows why the patch exists.
  - **One proved bug per issue (owner, 2026-11-09):** an upstream issue reports one bug we proved,
    with its repro. A list of missing features found by reading is patched locally and not reported
    in bulk.
- **A patch stays small and goes when the release lands.** The pull request that bumps to the version
  with the fix deletes the patch file, and its tests prove the fix still holds.
- **The patch is a change like any other.** It goes through the pipeline's steps: tests first, then the
  patch, then the mutation step and one review.

## Why

- The repo already worked this way for Manti ([UI on Manti](./ui-on-manti.md): "tried first with a
  `pnpm patch`") and holds three patches in `patches/`. This note makes it the rule for every package.
- Two tea changes (`Machine.make` and `Cmd.make`, demlik issues 870 and 871) looked like they would
  hold up a sketch of how a program is written. A release is someone else's schedule; our own work
  should not wait on it.
- pnpm's own docs give `pnpm patch` and `pnpm patch-commit` for exactly this.

## Where this differs from settled notes

- **tea stays small** (AGENTS.md) still holds: a patch to tea adds what we asked for in its issue, in
  tea's own words, and nothing that only fits us. If upstream says no, the patch is rethought, not kept
  forever.

## What it costs

- Each patch is re-applied on every install and can break on a version bump. pnpm fails the install
  when a patch no longer applies, so the break is loud.
- A patch can drift from what upstream finally ships. The bump pull request reads the release and
  rewrites our call sites to match.

## What would change our mind

- A patch that keeps breaking on bumps, or upstream refusing the change. Then we either carry the code
  as our own small module or drop the need.
