---
id: 0445
title: In today's version, the host decides what a key does, and the page holds keys until its answer, with no timer
status: accepted
date: 2026-10-25
tags: [app, keys, host, tmux, todays-version]
---

# 0445: In today's version, the host decides what a key does, and the page holds keys until its answer, with no timer

```text
page  {"type":"press","id":3,"key":"<c-b>"}   on the desk's port: a key the desk takes
host  {"type":"desk",...} then {"type":"answer","id":3,"took":true}
```

**What this decides:** where today's Ctrl-B table lives and how the page waits on it.

## Context

From [Tuval and tmux decide](../docs/direction/the-gui-is-electron-first.md#decided-2026-10-25-later-tuval-and-tmux-decide-the-host-runs-apart),
which replaced the page reading the prefix first. Today's code: `apps/fabrika/src/desk/hold.ts`.

## Decision

**The host sends the page its key table, and Ctrl-B and the key after it go to the host.**

- The page holds keys until the host answers, so `Ctrl-B |` never lands in a text box.
- The hold has no timer: the page waits for the answer, or for the link to drop.
- Typing in tsh goes to the host; typing in a program's text box stays in the page, as in Tuval.
- Ctrl-B w lists every workspace and tile, as tmux's does, and Enter goes there. Tuval's picker is
  not needed, since tsh starts programs.

## Consequences

- Each Ctrl-B costs a trip to the host.
- Not built yet: Ctrl-B w. Today's table has the jobs list on Ctrl-B J and workspaces on 1 to 9.
