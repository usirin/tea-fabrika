---
id: 0455
title: The owner reviews every change to the token files and their laws through a CODEOWNERS line, for now
status: accepted
date: 2026-11-07
tags: [design, tokens, codeowners, review]
---

# 0455: The owner reviews every change to the token files and their laws through a CODEOWNERS line, for now

**What this decides:** who must read a change to the design tokens, in the package both versions
share.

## Context

The token files hold every contrast floor, so a quiet change there loosens accessibility. From
[design language](../docs/direction/design-language.md#the-owners-calls), call 9.

## Decision

**The token files and their laws are owner-read, for now.**

- `.github/CODEOWNERS` lists `packages/fabrika-design/tokens/`, the token schema, the contrast
  check and their tests.
- It holds while the system settles. The owner may relax it later, by a decision.

## Consequences

- A pull request that touches a token file asks for the owner's review on GitHub.
- A loosened floor in a token file is a loosened law, which waits on the owner anyway
  ([0014](0014-the-lead-merges-when-every-step-passed.md)).
