---
id: 0472
title: Must-read text is never cut, an ellipsis counts as a cut, and only text said in full elsewhere may end in an ellipsis
status: accepted
date: 2026-11-07
tags: [ui, verification, truncation, layouts]
---

# 0472: Must-read text is never cut, an ellipsis counts as a cut, and only text said in full elsewhere may end in an ellipsis

**What this decides:** what text may be cut to fit, in both versions.

## Context

An explanation was cut with an ellipsis at 1024x700, and a person had to catch it. From
[UI verification](../docs/direction/ui-verification.md#u3-eight-layouts-and-the-content-states-both-looks-every-time),
U3.

## Decision

**Must-read text is never cut, at any layout.**

- An ellipsis counts as a cut.
- Only text said in full somewhere else may end in an ellipsis, as a row's meta may
  ([0459](0459-a-label-never-wraps.md)).

## Consequences

- A layout law checks it at all eight layouts ([0471](0471-ui-shots-cover-eight-layouts.md)).
