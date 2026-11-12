---
id: 0442
title: In today's version, the fabrika app is one Electron app, one copy at a time, safe by Electron's own checklist, and its message types are the protocol, never the port that carries them
status: accepted
date: 2026-10-24
tags: [app, electron, security, protocol, window, todays-version]
---

# 0442: In today's version, the fabrika app is one Electron app, one copy at a time, safe by Electron's own checklist, and its message types are the protocol, never the port that carries them

**What this decides:** what today's desktop app is built on and how its window is kept safe.

## Context

A local web page needed a port, a secret and an `Origin` check; Electron needs none. From
[the GUI is an Electron app first](../docs/direction/the-gui-is-electron-first.md#what-was-decided),
which replaced the local web page note. Today's code: `apps/fabrika/src/main.ts` and `preload.ts`.
For `next/`, [the desktop layer](../docs/direction/the-desktop-layer.md) governs.

## Decision

**The fabrika app is an Electron app from the start.**

- Only one copy runs: a second start brings the first one's window forward and quits
  (`app.requestSingleInstanceLock()`), since two copies would write the same saved state.
- Safety is [Electron's own checklist](https://www.electronjs.org/docs/latest/tutorial/security):
  - the window runs sandboxed, with context isolation and no Node;
  - the preload hands the window a few named calls and nothing else of Electron or Node;
  - the main process checks the sender of every message;
  - the app loads only its own files, over its own protocol, never `file://` or a remote site.
- The message types are the protocol. A MessagePort is one way to carry them; a socket or a
  WebSocket may carry the same types.
- A program's window code is built into the app's bundle for now. Once a program comes from
  outside the build, it is loaded at run time, with an import map handing every window the one
  React ([how a program's window code gets in](../docs/direction/the-gui-is-electron-first.md#how-a-programs-window-code-gets-in)).

## Consequences

- The window is tested through Playwright's Electron support; the host and programs keep plain
  tests.
- Packaging, signing and updates wait until the app goes to someone else.
- A window someone else wrote may need its own sandboxed frame; that comes with the first one.
