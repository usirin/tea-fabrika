---
date: "2026-11-05"
summary: "`next/`; the Tier 1 plan's spike P4, on Electron 45.2.1 as npm ships it (signed `adhoc`, no team), macOS 14.3.1, five runs that agreed. All four are yes, so none of T8's ways out is needed for this pass. launchd: the app bootstraps a plist from its temp home as a `gui/<uid>` agent running its own binary as Node; the brain outlives a `SIGKILL` of the app, and `bootout` stops it, though `launchctl print` still finds the label right after `bootout` returns, so Quit must wait. `safeStorage`'s async API works under `_electron.launch` with a temp `userData`, but on the real login Keychain: Playwright's `--use-mock-keychain` does not reach it, so a sealing test makes a real `<productName> Safe Storage` item and must name its app and delete the item, or seal through a test Layer. The Keychain: seal, first open and second open never blocked (7 to 12 ms, 30-second limit), so no prompt held a call; a rebuilt or re-signed binary was not tried and may still ask. `canPromptTouchID()` is true; `promptTouchID` was never called. Each run removes its label, plist and Keychain item. No model, $0."
---

# T8's four unknowns on a Mac: launchd, safeStorage, the Keychain, Touch ID

Run 2026-11-05. **About `next/`.** This is the Tier 1 plan's spike P4, the four unknowns that
[the detail's T8](../docs/plan/tier-1-detail.md) and
[the desktop layer](../docs/direction/the-desktop-layer.md) name before the app is built. It ran on
a throwaway Electron app (`214-mac-app-four-unknowns/app`), never the real fabrika app and never a
real home. Electron 45.2.1, the repo's pinned version, as npm ships it: signed `adhoc`, no team, so
an unsigned dev build. macOS 14.3.1 on a laptop with Touch ID. No model, no network, $0.

**The answer: all four are yes, so none of T8's ways out is needed for this pass.**

| Question | Answer | T8's way out | Needed? |
|---|---|---|---|
| 1. launchd from an unsigned build | Yes: starts, outlives an app crash, stops clean | `childBrain` | No |
| 2. `safeStorage` async under Playwright, temp `userData` | Yes, but it uses the real Keychain | a mock keychain flag | The flag does not work; see below |
| 3. Does the Keychain ask on open? | No call blocked: seal, first open, second open | window key in WebCrypto in a hidden page | No, for this binary |
| 4. `canPromptTouchID()` | `true` | the plain click | No, as far as the check goes |

```ts
// What the runner saw, from experiments/results/214-mac-app-four-unknowns.json (one of five
// runs; all five agreed).
launchd.start           = { bootstrap: 0, beat: true, ms: 335, state: "running" }
launchd.afterAppKilled  = { beatAdvanced: true, state: "running" }   // same pid as before
launchd.stop            = { bootout: 0, plistLeft: false }
brainAliveAfterStop     = false
keychain.runs           = [seal 8 ms, open 11 ms, open 11 ms]           // none blocked, limit 30 s
playwright (fresh home) = seal ok, open ok, and the real Keychain item now exists
touchID                 = { canPromptTouchID: true }
cleanup                 = { labelLoaded: false, plistLeft: false, itemsLeft: [] }
```

## How it ran

`run.ts` drives everything, one Electron app at a time. The app (`app/main.mjs`) opens no window.
It does one job picked by `SPIKE_MODE`, prints one `SPIKE {json}` line and quits. Its home is a
fresh temp folder, and `userData` sits inside it.

```sh
nice -n 19 node experiments/214-mac-app-four-unknowns/run.ts
```

A `finally` always boots the label out, deletes the plist, kills any app left, and deletes only
the Keychain items this run made (it checks which existed before). After each run: no label
loaded, no plist, no Keychain item, no process.

## 1. launchd from an unsigned build: yes

The app writes `brain.plist` into its temp home and runs `launchctl bootstrap gui/<uid>` on it,
under a random label `dev.fabrika.spike.<hex>`. The plist never goes into
`~/Library/LaunchAgents`, as [the desktop layer](../docs/direction/the-desktop-layer.md) says: nothing
starts at login.

```xml
<key>ProgramArguments</key>
<array>
	<string><!-- the app's own Electron binary --></string>
	<string><!-- app/brain.mjs --></string>
	<string><!-- <home>/beat.json --></string>
</array>
<key>EnvironmentVariables</key>
<dict><key>ELECTRON_RUN_AS_NODE</key><string>1</string></dict>
<key>RunAtLoad</key><true/>
```

- The brain runs on the app's own Electron binary as Node (`ELECTRON_RUN_AS_NODE=1`), so it needs
  no Node on the machine. It writes a counter twice a second.
- `bootstrap` returned 0, and the first beat came in about 0.2 to 0.7 seconds.
- The runner then killed the app with `SIGKILL`, standing in for a crash. The brain kept beating,
  with the same pid, and `launchctl print` still said `running`.
- A second launch of the app ran `launchctl bootout` and deleted the plist. The brain's pid was
  gone half a second later.
- **One catch for the build:** right after `bootout` returned, `launchctl print` from inside the
  app still found the label. Half a second later it did not (exit 113). `bootout` returns before
  the job is fully gone, so the app's Quit should wait for `print` to fail before it says the
  brain stopped.

`childBrain` is not needed for this pass.

## 2. safeStorage's async API under Playwright: yes, on the real Keychain

Electron 45 has `isAsyncEncryptionAvailable`, `encryptStringAsync` and `decryptStringAsync`; the
sync calls are marked deprecated in its own `electron.d.ts`. Under `_electron.launch` with a temp
`userData`, a first launch sealed a dummy value into `userData/sealed.bin`, and a second launch
opened it back (`match: true`, `shouldReEncrypt: false`).

The surprise: Playwright's Electron loader adds `--use-mock-keychain` (and
`--password-store=basic`) to every launch, so T8 guessed "a mock keychain flag may be needed".
That flag does not reach the async API.

- Run first, before any item existed, the Playwright launch **made a real item**,
  `fabrika-spike-214 Safe Storage`, in the login Keychain.
- A Playwright launch opened a file a plain launch had sealed. A mock key could not have.
- Dropping the switch by hand (`app.commandLine.removeSwitch("use-mock-keychain")`) changed nothing.

So an Electron test that seals touches the person's real login Keychain. The item is named after
the app's `productName`, and a temp home does not change that. For the app's tests:

```ts
// A sketch for P19's tests, not built.
// 1. Every test app gets a productName of its own, so its item never collides with the real
//    app's "fabrika Safe Storage".
// 2. The test deletes that item after: security delete-generic-password -s "<name> Safe Storage"
// 3. Or the test never seals: the seal sits behind a service with a test Layer, as
//    `PersonCheck` does.
```

Lean: 3 for most tests and 1 plus 2 for the one law that must seal for real. Sure: 75%. The doubt
is CI: a CI Mac's Keychain may be locked, and this run did not try one.

## 3. Does the Keychain ask on open? Not that we could detect

Three plain launches (no Playwright): seal, open, open. Each call had 30 seconds. A Keychain
dialog holds the call until someone clicks, so a prompt would show as a block. None blocked:
each took 7 to 12 ms over the five runs, and the whole launch took about 160 ms.

This matches how the Keychain works: the item's access list names the app that made it, and the
same signed binary reads it back without asking. Here the same npm `Electron.app` made the item and
read it.

The way out in T8 (the window key as a WebCrypto key in a hidden local page) is not needed for
this binary. **It may still be needed for the built app.** The access list of an `adhoc` signed
binary pins its exact code hash. A rebuild, or a build signed later with the self-made card, is a
different binary to the Keychain, and the first open after that may ask. This run did not try
that, on purpose, since it could leave a dialog on the person's screen. That is the case the owner's
"open the built app twice" check in T8 tests.

## 4. Touch ID: `canPromptTouchID()` is true

From the unsigned build, `systemPreferences.canPromptTouchID()` returned `true`.
`promptTouchID` was never called; it needs a person. The plain click is not needed as far as this
check goes. The check only says the machine has Touch ID and a finger enrolled; it does not say a
prompt from an `adhoc` build shows and returns.

## What this cannot tell us

- **What a person would see on screen.** No call blocked, so no Keychain dialog held one. But a
  notification that does not block, such as macOS's "Background Items Added" for a launch agent,
  would not show up here. Whether `bootstrap` from a plist outside `~/Library/LaunchAgents` raises
  one needs a person watching.
- **A rebuilt or re-signed app.** Every run used one binary. The Keychain may ask once the app's
  code hash or signature changes. T8's "open the built app twice" check covers that.
- **Whether `promptTouchID` works from an `adhoc` build.** Only the check ran.
- **A locked Keychain, a CI Mac, another macOS.** One laptop, unlocked, macOS 14.3.1.
- **Whether IndexedDB holds a non-extractable key in a local page.** T8's way out for question 3;
  not needed, so not tried.
- **launchd over a real login, a reboot, or a brain that crashes.** The plist has no `KeepAlive`,
  and the run did not log out or reboot.

Cost: no model, $0. The agent's own tokens were not logged.
