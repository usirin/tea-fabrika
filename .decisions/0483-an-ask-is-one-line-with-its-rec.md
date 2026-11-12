---
id: 0483
title: An ask is one line with the step's rec beside it as a labeled row and its evidence folded, and an ask with no rec says so in words and offers no y
status: accepted
date: 2026-11-02
tags: [ui, asks, rec, inbox]
---

# 0483: An ask is one line with the step's rec beside it as a labeled row and its evidence folded, and an ask with no rec says so in words and offers no y

```text
Approve plan version 2?
Recommended  Approve · 95% sure
3 open questions, each with a lean. The exam step runs next, about 4 agent minutes.
```

**What this decides:** how one ask reads, in both versions. Today's app built it (ticket 102).

## Context

An ask that buries the rec makes a person read the evidence first. From
[the ask desk](../docs/direction/ask-desk.md#a2-the-question-in-one-line-the-rec-beside-it-the-evidence-folded),
A2 and [the look](../docs/direction/ask-desk.md#the-look).

## Decision

**The question is one line, and the rec sits beside it.**

- The rec reads as a labeled row: Recommended, the pick, its percent sure. The reason is on its own
  line.
- The evidence is folded under the question, one press (`space`) to open, with the question still
  in view.
- An ask with no rec says so in words ("No rec: the price is unknown"), and `y` is not offered.

## Consequences

- The rec's type follows the text styles ([0457](0457-six-text-styles-set-every-size.md)).
