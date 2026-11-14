---
date: "2026-11-13"
summary: "`next/`; $0. Yes, on GitHub's `macos-15` runner (macOS 15.8.2, arm64, Electron 45.2.1). `setLoginItemSettings({ openAtLogin: true })` took the status to `enabled` for the bare Electron binary, for a copied bundle not signed again, and for an ad-hoc signed bundle; a bundle with its signature removed stayed `not-found`, and the call did not throw. macOS files the item under the signature's identifier, so only the bundle signed again got its own record. It cannot say whether the app opens at the next login: a runner never logs in again."
---

# 284. Can a build with no real code signature register itself as a macOS login item?

Run on 2026-11-13 (Pacific), on GitHub's hosted `macos-15` runner: macOS 15.8.2 (build 24H232),
arm64, user id 501, in a real login session (`launchctl managername` says `Aqua`). Electron 45.2.1,
the installed version. It is about `next/`, for the "open at login, menu bar icon only" setting. No
model, no key, no account: **$0**. Nothing ran on a person's Mac. This page was written on its
branch from its first line ([0128](../.decisions/0128-a-write-up-is-born-in-the-repo.md)).

**The answer: yes. macOS takes the registration from a build with no paid signature, as long as the
binary carries any signature at all, even the free ad-hoc one. A bundle with its signature removed
is refused, and Electron does not throw: it only prints to stderr.**

```js
// The whole idea: experiments/284-login-item-unsigned/main.mjs, with the printing left out.
import { app } from "electron";

await app.whenReady();
app.getLoginItemSettings().status;               // "not-found" or "not-registered"
app.setLoginItemSettings({ openAtLogin: true }); // Apple's SMAppService, on macOS 13 and later
app.getLoginItemSettings().status;               // "enabled" on three shapes, "not-found" on one
app.setLoginItemSettings({ openAtLogin: false });
app.getLoginItemSettings().status;               // "not-registered"
app.exit(0);
```

## What we ship today

There is no packaged `.app`, in either version. `next/apps/fabrika` has no Electron main file yet
and no packager in its `package.json`; its `build` script builds the brain. Today's app
(`apps/fabrika`) starts as `electron .`, Electron's own binary running our files. No
`electron-builder`, `@electron/packager` or forge is in any `package.json`. So the first shape below
is what runs today, and the other three are what a packaged build could be.
[0280](../.decisions/0280-the-app-starts-a-launchd-brain.md) has the app start the brain, so the
login item is the app's alone.

## What ran

The script is `experiments/284-login-item-unsigned/` (`main.mjs` and its driver `run.mjs`) on the
branch `fabrikalfa/exp-login-item`, with the workflow `.github/workflows/exp-login-item.yaml` that
runs only on that branch. The run:
[actions/runs/43537112711](https://github.com/kamp-us/tea-fabrika/actions/runs/43537112711), all
four steps green, about 10 s each. A second run on a fresh runner,
[actions/runs/43537646396](https://github.com/kamp-us/tea-fabrika/actions/runs/43537646396), gave
the same status at every step and the same records.

Each shape got five app starts: a full cycle (on, then off), then on, a read from a fresh process,
off, and a read again. `sudo -n sfltool dumpbtm` ran without a prompt and listed what macOS stored.
Every app start ended with exit code 0, and no status was ever `requires-approval`.

| Shape | `codesign` says | Status: before, after on, after off | What macOS stored |
|---|---|---|---|
| Bare Electron binary runs the script | `adhoc,linker-signed`, identifier `Electron`; `--verify` fails | `not-found`, `enabled`, `not-registered` | one record, `2.Electron`, name `Electron`, `[enabled, allowed, visible, notified]` |
| A copy of `Electron.app` with our bundle id and script, not signed again | the same as above: our edits did not touch the binary | `not-registered`, `enabled`, `not-registered` | **the same record**, `2.Electron`, now pointing at our bundle |
| The same bundle after `codesign -s - --force --deep` | `adhoc`, identifier `dev.fabrika.exp284.adhoc`; `--verify` passes | `not-found`, `enabled`, `not-registered` | its own record, `2.dev.fabrika.exp284.adhoc`, name `FabrikaExp284adhoc` |
| The same bundle after `codesign --remove-signature --deep` | `code object is not signed at all` | `not-found`, `not-found`, `not-found` | nothing |

- **A fresh process sees it.** With the setting on, a second start read `enabled` and
  `openAtLogin: true`, started directly and through `open -W`. After off, it read `not-registered`.
- **macOS tells the person.** The system log shows a notification request for the two shapes that
  made a new record: `"Electron" will open automatically when you log in` and the same for
  `FabrikaExp284adhoc`. It is the usual notice, not a question.
- **The refusal is quiet.** On the bundle with no signature, `setLoginItemSettings` returned as
  usual. Electron printed `Unable to set login item: ... Operation not permitted` to stderr, and
  the system log says `Register of <private> rejected by BTM` after
  `failed to construct identifier`. Only reading `status` back shows it failed.
- **Turning it off keeps the record.** The record stays, as `[disabled, allowed, visible, notified]`.
- **Gatekeeper's check plays no part here.** `spctl -a` rejected all four shapes, and three still
  registered.

## What it means for the build

1. **The setting can be built without a paid signature.** A packaged bundle with an ad-hoc
   signature registers, and gets a record under its own bundle id. 90% sure for macOS 15; it is two
   runs on one macOS version.
2. **The record's name comes from the signature, not from `Info.plist`.** The copied bundle had our
   bundle id in its `Info.plist`, and macOS still filed it as `2.Electron`, over the record the
   bare binary had just made. So any two apps that run on Electron's stock binary share one login
   item. A packaged build must sign again, ad hoc at least, to own its record. 85% sure: the two
   shapes ran one after the other on one runner, and no third Electron app was there to collide.
3. **Started as `electron .`, the setting would register Electron itself.** The record points at
   `Electron.app` inside `node_modules`, which would open with no app at login. This is a reading
   of the record, not a login we watched. The setting should do nothing in an unpackaged start.
4. **The code must read the status back.** A failed call does not throw, so "on" is true only when
   `getLoginItemSettings().status` says `enabled` afterwards.

Electron's docs say the app "should be code signed and notarized for login item settings to work
reliably". For registering, this run found less is needed. Whether less is enough for the login
itself is the open part below.

## What this cannot tell us

- **Whether the app really opens at the next login, and whether `wasOpenedAtLogin` is then true.**
  A runner never logs in again; every reading here says `wasOpenedAtLogin: false`. The test that
  settles it, on a real Mac: build the ad-hoc signed bundle, put it in `/Applications`, turn the
  setting on, log out and in again (and once more after a restart), and have the app write
  `getLoginItemSettings()` to a file at start. That test runs only under
  [0178](../.decisions/0178-host-only-laws-run-first.md): after the lead has read its lines and the
  owner has said yes.
- **A bundle that was downloaded.** Ours was made on the machine, so it had no quarantine mark. A
  build sent to the second person does, and Gatekeeper may block its start before any login item
  matters.
- **Other macOS versions.** Only 15.8.2 ran. macOS 13, 14 and 26 are untested, as is an Intel Mac.
- **A managed Mac.** A company profile can block or pre-approve login items. The runner has none.
- **What the person sees.** We read the notification request in the log; nobody saw the banner or
  the row in System Settings, under General, Login Items.
- **Why the bundle with no signature started at all.** An arm64 Mac is said to refuse unsigned
  code, and this one ran it with exit code 0. We did not look into it; no build we plan is unsigned
  in that way.
- **How steady it is.** Two runs, each on a fresh runner, agreed on every status. Two is a small
  number, and both were the same runner image on the same day.
