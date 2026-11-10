---
id: 0060
title: An upstream issue we file for a gap we patch locally carries the exact patch, in a collapsible section
status: accepted
date: 2026-11-10
tags: [upstream, patch, pnpm-patch, issue, alchemy, demlik, tea, manti, effect]
---

# 0060: An upstream issue we file for a gap we patch locally carries the exact patch, in a collapsible section

**What this decides:** when we patch a package locally and file the upstream issue, the issue body
ends with the diff we apply, folded under a `<details>` section, so the maintainer can read and take
the exact change.

````markdown
<details><summary>The patch we apply locally</summary>

```diff
diff --git a/src/Workers/Worker.ts b/src/Workers/Worker.ts
--- a/src/Workers/Worker.ts
+++ b/src/Workers/Worker.ts
@@ ...
```

</details>
````

## Context

[Patch upstream locally](../docs/direction/patch-upstream-locally.md) says every local patch has an
upstream issue, filed the same day, and [0054](0054-read-upstream-before-patching-it.md) says the
read of the package comes first. Neither says what the issue holds. The issues filed so far described
the fix in words or in a short excerpt, while the full change sat in our `patches/` folder where the
maintainer cannot see it.

This refines both: their rules still hold, and this adds what the issue carries.

## Decision

**An upstream issue for a gap we patch locally ends with the patch itself, inside
`<details><summary>The patch we apply locally</summary>`, a fenced `diff` block, then `</details>`.**

- The block holds only the hunks that belong to this issue. A patch file that covers several issues
  is split, and each issue gets its own hunks.
- The diff is the package's own code as we changed it: no machine paths, names, keys or anything
  private. Read every line before posting.
- The rest of the issue stays as before: what happens, a repro, what we expected.
- An issue already filed when its patch lands, or before this decision, gets the section appended to
  its body. Only open issues; a closed one is left alone.
- 0042's six unreported Alchemy gaps stay unreported; this adds nothing to them.

## Consequences

- A maintainer can apply or copy the change without asking for it, and see that it is small.
- A patch that changes after the issue is filed means the section is edited too, or it drifts.
- Not decided here: whether we also open a pull request upstream. That stays a call per issue.
