---
id: 0502
title: A tile's states are words in its state slot, the close question as one alert, closing with a dashed edge, empty or loading as one word, never a spinner, and the status bar never holds a fact's only copy
status: accepted
date: 2026-11-01
tags: [ui, tiles, states, accessibility, today]
---

# 0502: A tile's states are words in its state slot, the close question as one alert, closing with a dashed edge, empty or loading as one word, never a spinner, and the status bar never holds a fact's only copy

**What this decides:** how a tile says what state it is in, in today's version.

## Context

States were drawn by color, a raised box or a spinner, with no words a screen reader could read.
From [tile guidelines](../docs/direction/tile-guidelines.md#closing-state), its parts.

## Decision

**A tile's state is said in words.**

- The close question is words in the state slot and the status bar, said once with `role="alert"`.
  Never an `alertdialog` (no dialog opens and no focus moves), never in the accent.
- A closing tile has a dashed edge at its own step and the word `closing`, with no extra box.
- An empty or loading tile shows one word where the content will start, never a spinner or a
  skeleton. The bar shows the program from the first frame.
- A zoomed tile says `zoomed` in its state slot and its accessible name, polite once.
- A lost link dims the tile and makes it `inert` together, and the top bar says why with
  `role="status"`.
- The status bar adds to the title and never holds the only copy of a fact.

## Consequences

- The note's "asking marker" is the question marker
  ([0493](0493-zoom-question-line-words.md)).
