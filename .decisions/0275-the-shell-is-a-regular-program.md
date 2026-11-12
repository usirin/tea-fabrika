---
id: 0275
title: In next/, the shell is a regular program in the brain whose window echoes typed letters at once for the process to confirm, a submitted line is a Msg, and a real terminal is a pty on the hands that is never saved
status: accepted
date: 2026-10-31
tags: [desktop, fabsh, shell, local-echo, pty, hands, next]
---

# 0275: In next/, the shell is a regular program in the brain whose window echoes typed letters at once for the process to confirm, a submitted line is a Msg, and a real terminal is a pty on the hands that is never saved

**What this decides:** where the shell runs, and what of its typing is kept.

```ts
{port: "tile:t1", m: {type: "keys", data: "l"}}              // drawn now, speculatively
{rev: 88, patch: [{op: "add", path: "/line/-", value: "l"}]} // the process agrees
{type: "submitted", line: "jobs"}                            // a whole line is a Msg: in the log
```

## Context

Decided by the owner in [the desktop layer](../docs/direction/the-desktop-layer.md) (W2). In
`next/` the shell is `fabsh`; the note's `tsh` means it. Experiment 150 measured the echo at 14 ms
instead of 95 ms, at 80 ms of network delay.

## Decision

**The shell is a regular program.**

- A tile starts a `fabsh` process in the brain like any process, with its line editor state in its
  model. It is only the default process for a new tile.
- The window draws typed letters at once and the process confirms them: speculative local echo, as
  mosh does.
- A submitted line is a Msg in the process's log. Keys typed mid-line are not.
- A real terminal program in a tile (zsh, vim) is a pty on the hands, whose bytes stream through and
  are never saved.

## Consequences

- Every window does speculative echo, with a test that the drawn letter and the process agree.
- On Cloudflare, what you type crosses Cloudflare, as in any web terminal.
