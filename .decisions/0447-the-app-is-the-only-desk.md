---
id: 0447
title: In today's version, the app is the only desk for now, the host keeps only its 0600 socket file and never listens on a port, and a browser desk waits for a device with no app
status: accepted
date: 2026-10-25
tags: [app, host, socket, browser, security, desk, todays-version]
---

# 0447: In today's version, the app is the only desk for now, the host keeps only its 0600 socket file and never listens on a port, and a browser desk waits for a device with no app

```text
your laptop   the app -> the host's socket file (0600). No port, so no web page can try.
a cloud host  the app -> that host's one door, signed in with the person's SSH key.
a browser     later: only for a device with no fabrika on it, such as a phone or a tablet.
```

**What this decides:** how a desk reaches today's host, and why a browser tab does not yet.

## Context

In [experiment 150](../experiments/150-browser-desk.md), with no guards, a page served by any other
local server typed into tsh. No port holds better than three guards. From
[no browser desk for now](../docs/direction/the-gui-is-electron-first.md#decided-2026-10-25-later-still-no-browser-desk-for-now).
In `next/`, a browser tab is an equal client
([a browser is always a client](../docs/direction/a-browser-is-always-a-client.md)); this file is
today's version only.

## Decision

**The app is the only desk, and the host listens on nothing but its socket file.**

- The socket is mode 0600, in a 0700 folder, as tmux's is: no port, so no secret.
- A browser desk comes back only for a device with no fabrika app, with experiment 150's three
  guards: `Origin`, a cookie from a one-time token, and `Host`.

## Consequences

- No desk on a phone, a tablet or a borrowed computer.
- Kept for later: local echo for a cloud host, and a page that needs nothing of Electron.
