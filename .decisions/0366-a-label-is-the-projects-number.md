---
id: 0366
title: In next/'s tracker, a label is the project's, held by number, made, renamed, merged, archived and applied by a person, never deleted, and an agent only guesses at filing
status: accepted
date: 2026-11-06
tags: [tracker, labels, numbers, person-only, guess, archive, next]
---

# 0366: In next/'s tracker, a label is the project's, held by number, made, renamed, merged, archived and applied by a person, never deleted, and an agent only guesses at filing

**What this decides:** labels are the project's shared words, kept by number, and only a person
changes them or puts one on a ticket.

```ts
// A sketch from the note, next/. tracker/labels: every fact is a person's, a personOnly event.
const LabelFact = Schema.TaggedUnion({
  group_made: { group: GroupNumber, name: LabelName, pick: Schema.Literals(["one", "many"]), guess: Schema.Boolean },
  group_renamed: { group: GroupNumber, name: LabelName },
  label_made: { label: LabelNumber, name: LabelName, group: Schema.optionalKey(GroupNumber) },
  label_renamed: { label: LabelNumber, name: LabelName },
  label_merged: { label: LabelNumber, into: LabelNumber },
  label_archived: { label: LabelNumber },
});
// On the ticket: filed gains `guess: Array<LabelNumber>`, any writer; labeled {add, drop}, a person.
```

## Context

The owner decided L5, "archive, not delete" and call 5 on 2026-11-06
([label guidelines, L5](../docs/direction/label-guidelines.md#l5-a-label-is-a-number-with-a-name-people-make-it-agents-guess),
[the shape](../docs/direction/label-guidelines.md#the-shape),
[call 5](../docs/direction/label-guidelines.md#5-who-sees-a-label)). It extends today's areas
([0356](0356-an-area-is-a-persons-data.md)) to every label. `next/`.

## Decision

**A label is a number with a name, and people own it.**

- A ticket holds a label's number, so a rename touches no ticket and a merge moves every ticket at
  once.
- A person makes, renames, merges, archives and applies labels. Those facts and `labeled` are
  `personOnly` events, refused when an agent writes one.
- An agent may write a `guess` when it files, for groups made guessable. It never applies a label.
- A label is archived, never deleted: it stays on its tickets and leaves the menu.
- Every label belongs to the project and everyone on it, never to one person. A person's own marks
  are pins and saved views on their desk.
- A label's color is never the only cue: its name always shows.

## Consequences

- A law: a rename changes no ticket's labels and a merge moves all of them.
- Offering an unused label for archive is a later call.
