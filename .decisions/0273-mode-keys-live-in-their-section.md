---
id: 0273
title: In the person's key file, a mode's command is written only in its [mode.<program>.<mode>.keys] section, and entering a mode is a flat row like any command, never an enter key
status: accepted
date: 2026-11-01
tags: [modes, keys, keybindings, settings, toml, next]
---

# 0273: In the person's key file, a mode's command is written only in its [mode.<program>.<mode>.keys] section, and entering a mode is a flat row like any command, never an enter key

**What this decides:** where a person writes a mode's keys in their own key file.

```toml
desk.info = "<prefix>i"       # entering is a flat row

[mode.desk.info.keys]
exit = ["escape", "q"]        # a mode's command lives only here
```

## Context

The owner approved option A, the lean, in [modes](../docs/direction/modes.md#the-persons-file). The
section itself was decided in [keybindings are configurable](../docs/direction/keybindings-are-configurable.md)
(K7, K8). `next/`; today's version is not changed.

## Decision

**The file says where a key works, so nobody guesses (70%).**

- A mode's command is written only in its `[mode.<program>.<mode>.keys]` section.
- The load refuses a flat row for a mode's command, and points at the section: "desk.exit works only
  in a mode; write it under [mode.desk.info.keys]."
- Entering a mode is a command like any other, a flat row, never an `enter` key in the mode's
  section. A mode may have several ways in.

## Consequences

- A command for several modes gets one row per section; the keys program shows them together.
