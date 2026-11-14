---
date: "2026-10-04"
scripts: "none"
summary: "slugify went from 0 of 3 runs finishing to 5 of 5."
---

# 2. Tell the enricher how the judge reads

`src/claude.ts`, `JUDGE_BRIEF`

The enricher (the agent that rewrites a raw ticket) was told how its criteria
get judged: one claim each, about what the change makes true, never about what
is left untouched.

**Result:** slugify went from 0 of 3 runs finishing to 5 of 5.
