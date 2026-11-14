---
id: 0182
title: In next/, the app file and start at login are built inside the Electron app's Tier 1 row (P19), never on today's app and never in a later tier
status: accepted
date: 2026-11-13
tags: [app, electron, packaging, login, menu-bar, tier-1, next]
---

# 0182: In next/, the app file and start at login are built inside the Electron app's Tier 1 row (P19), never on today's app and never in a later tier

**What this decides:** what start at login is, and where it and the packaged app it needs are built.

```ts
// A sketch of the whole idea, in the Electron app's main code. Not built.
if (app.isPackaged && settings.startAtLogin) {
  app.setLoginItemSettings({ openAtLogin: true }); // never throws on a refusal
  const on = app.getLoginItemSettings().status === "enabled"; // so the status is read back
}
// Opened at login: only the menu bar extra, and no window until the person asks for one.
const quiet = app.getLoginItemSettings().wasOpenedAtLogin;
```

## Context

[0280](0280-the-app-starts-a-launchd-brain.md) decided that a person only opens the app, and the app
starts the brain as a launchd service whose plist sits in the app's home, "so nothing starts at
login".

On 2026-11-13 the owner said yes to start at login on the laptop, after a test: the app opens at
login and shows only its menu bar extra, behind one setting that is off by default.

[Experiment 284](../experiments/284-login-item-unsigned.md) ran that test the same day, on GitHub's
`macos-15` runner. What it found:

- macOS takes the registration from a build with no paid signature, as long as the app carries any
  signature, even the free ad-hoc one. A bundle with no signature is refused, and the call does not
  throw.
- macOS files the login item under the signature's identifier, not the bundle id in `Info.plist`.
  An app on Electron's stock binary shares one record, named `Electron`, with every other such app.
- Started as `electron .`, the setting would register Electron itself.

So start at login needs an app file: a `.app` bundle with its own bundle id, signed again, ad hoc at
least. Neither version has one. Today's app starts as `electron .`, and `next/` has no Electron app
on main: P19's first slice is a draft.

The owner ruled the same day: the Electron app is Tier 1 work already
([0159](0159-fabsh-pipes-summon-join-first.md)'s third amendment), so the app file and start at
login fold into it.

## Decision

**The app file and start at login are built in `next/`, inside P19, the Electron app's row.**

- **The app file.** P19's Electron app is built into a `.app` bundle with its own bundle id, signed
  again, ad hoc at least, so macOS files what it stores under fabrika's own identifier.
- **Start at login is one setting, off by default.** Turned on, the app registers itself as a login
  item. Opened at login, it shows only the menu bar extra, and no window until the person asks for
  one.
- **The setting does nothing outside the app file.** A start as `electron .` never registers.
- **The app reads the status back** after it asks, and says so when macOS refused.
- **Nothing of this is built on today's app,** and it does not wait for a later tier.
- **P19's plan says which slice carries it.**

This amends one line of 0280. "Nothing starts at login" becomes "nothing starts at login unless the
person turned the setting on, and then only the app". The brain is still started by the app, and no
launchd entry of ours runs at login.

## Consequences

- No paid Apple signature is needed for this. Apple signing and auto-update stay where
  [the tiers](../docs/plan/tiers.md) put them.
- The app's signature starts to matter in Tier 1. P19's sealed keys live in the Keychain, and what
  macOS asks a person there depends on what signed the app. P19's plan checks, by a run, what an
  ad-hoc signature that changes with each build does to that prompt.
- Owed before start at login counts as done: a real login on a real Mac. The app file goes in
  `/Applications`, the setting is turned on, and the person logs out and in, and once more after a
  restart, on macOS 14 and 15. That is a host-only check
  ([0178](0178-host-only-laws-run-first.md)).
- The cost: P19 grows by about one slice.
- Not decided here: the packaging tool, which P19's plan picks from the makers' own; how the second
  person gets the app file, since a downloaded copy is quarantined; and anything about another
  machine that only runs jobs.
