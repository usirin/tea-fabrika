---
date: "2026-11-11"
summary: "Draft, nothing measured yet; `next/`; $0. Only the `print` step ran: it wrote two files to a temp folder and changed nothing on the Mac. The plan: a `HandsService` resource writes a LaunchAgents plist and boots it with `launchctl`, so launchd restarts the hands and Alchemy does not have to. A plain deploy after a kill should then be right to say \"no change\". Follows 264, where a deploy said \"no change\" over a dead pid."
---

# 277. If a hands resource installs a launchd entry, does the Mac keep the hands alive, and does a deploy still say "no change" when it should?

2026-11-11. **Draft. Nothing has run yet.** It is about `next/`, against `alchemy` 2.0.0-beta.85
and `effect` 4.1.2, the installed versions. No account, no network, no key, no model: **$0**.
Only the `print` step ran: it wrote two files to a temp folder and changed nothing on the Mac.

Experiment [264](./264-hands-as-an-alchemy-resource.md) found that a resource can start a hands
process, but Alchemy never keeps it alive: after a kill, the next deploy said "no change" and
printed a dead pid. Its lean was to have the resource install the hands plus a caretaker's
instruction, launchd on a Mac. This experiment builds that and plans to measure it.

```ts
// The whole idea. Made up for this sketch: HandsService, its props and attrs.
const HandsServiceProvider = Provider.effect(HandsService, Effect.gen(function* () {
  return {
    read: ...,       // `launchctl print gui/<uid>/<label>`: loaded or not, and the pid (logged, not stored)
    diff: ...,       // a changed prop is "update"
    reconcile: ...,  // write ~/Library/LaunchAgents/<label>.plist, then `launchctl bootstrap gui/<uid> <plist>`;
                     // same plist and loaded: do nothing; changed: bootout, then bootstrap
    delete: ...,     // `launchctl bootout gui/<uid>/<label>`, remove the plist; fine if already gone
  };
}));

// launchd, not Alchemy, restarts the process. A plain deploy after a kill should then be right
// to say "no change".
const hands = yield* HandsService("LaptopHands", { label: "dev.fabrika.exp277.hands", home, node, every: 500 });
```

## What the script does

The script is `experiments/277-hands-launchd/hands-launchd.ts` on the branch
`fabrikalfa/exp-hands-resource`, with the same engine wiring as
264's `hands.ts`. It talks to `launchctl`, `kill` and `id` through Effect's `ChildProcess`, and to
files through `FileSystem` and `Path`. It has no `node:` import and no Promise.

The service runs a tiny node script that writes `{ pid, at }` to `heartbeat.json` every 500 ms, by
writing a temp file and renaming it, so a reader never sees half a file. The plist it installs,
squeezed to one key per line here (`print` shows the full text):

```xml
<!-- ~/Library/LaunchAgents/dev.fabrika.exp277.hands.plist; <home> is the temp folder,
     <node> the real node binary that ran the script -->
<dict>
  <key>Label</key>             <string>dev.fabrika.exp277.hands</string>
  <key>ProgramArguments</key>  <array>
    <string><node></string> <string><home>/hands/heartbeat.cjs</string>
    <string><home>/hands/heartbeat.json</string> <string>500</string>
  </array>
  <key>WorkingDirectory</key>  <string><home>/hands</string>
  <key>RunAtLoad</key>         <true/>
  <key>KeepAlive</key>         <true/>
  <key>ProcessType</key>       <string>Background</string>
  <key>Nice</key>              <integer>15</integer>
  <key>StandardOutPath</key>   <string><home>/hands/stdout.log</string>
  <key>StandardErrorPath</key> <string><home>/hands/stderr.log</string>
</dict>
```

`plutil -lint` says the printed plist is OK.

Four steps, one per call, against the same `HANDS_HOME`:

| Step | What it does | Changes the Mac? |
|---|---|---|
| `print` | writes the plist and the script under `<home>/print/` only; prints them and every `launchctl` command the other steps would run | no |
| `up` | deploys: `reconcile` writes the plist and runs `launchctl bootstrap gui/<uid> <plist>`; then waits for the first heartbeat | yes |
| `measure` | 5 times: `kill -KILL <heartbeat pid>`, then times how long until a beat from a new pid appears. Then one more deploy, and reads its plan: did it say no change? | yes |
| `down` | destroys: `launchctl bootout gui/<uid>/<label>`, removes the plist; then checks the plist is gone and `launchctl print` fails | yes |

To list the entry by hand: `launchctl print gui/$(id -u)/dev.fabrika.exp277.hands`. To remove it by
hand: `launchctl bootout gui/$(id -u)/dev.fabrika.exp277.hands` and then
`rm ~/Library/LaunchAgents/dev.fabrika.exp277.hands.plist`.

## launchd facts, from this Mac's man pages

From `man launchd.plist` and `man launchctl` on macOS 14 (Darwin 23.3.0):

- **KeepAlive true** keeps the job running without conditions, and "implicitly implies RunAtLoad".
  We set RunAtLoad too, so it reads plainly.
- **ThrottleInterval**: "by default, jobs will not be spawned more than once every 10 seconds."
  KeepAlive adds that jobs which "exit quickly and frequently" are throttled. **We do not set
  it.** We want the number a real install would get, and the default is what guards a Mac
  against a crash loop. So we expect a restart to wait until 10 s have passed since the last
  start. `measure` therefore takes `HANDS_GAP_MS`, how long each new process runs before the
  next kill. Run it twice: `HANDS_GAP_MS=0` (the crash-loop case, expect close to 10 s) and
  `HANDS_GAP_MS=12000` (a process that ran longer than the throttle, expect well under 1 s).
- **ProcessType Background** applies resource limits "intended to prevent them from disrupting
  the user experience". **Nice** sets the nice value. The man page says ProcessType is "preferable
  to using" Nice; we set both, as asked.
- **ProgramArguments**: the first element may be relative and is then looked up on a short
  standard PATH. So the plist names the real node binary (`process.execPath`), not a version
  manager's shim, which would also put a second process between launchd and the heartbeat.
- **`launchctl print`** output "is NOT API in any sense at all". So `read` trusts only its exit
  code for loaded or not, and reads `pid`, `state` and `runs` only for the log.
- **`bootstrap` and `bootout`** take a domain target and a plist path, or a service target.
  `gui/<uid>/<label>` is the per-person form.

## What will be measured

- Time from `kill -KILL` to the first beat from a new pid, 5 times, at both gaps. Also launchd's
  `runs` count after each kill, and whether launchd's pid matches the heartbeat's.
- Whether the deploy after the kills plans `noop` for `LaptopHands` (it should: nothing changed,
  and the process is alive again).
- After `down`: whether the plist is gone and `launchctl print` fails.
- What `up` and `down` cost in ms, from Alchemy's own render.

Results go to `<home>/measure-gap-<n>.json` and the console, kept in the owner's private archive
under `runs/277/`, not in git.

## What it cannot tell us

- Nothing has run but `print`. Every claim about restarts is from the man pages until `measure`
  runs.
- Sleep and wake, logging out and a reboot are not in the steps. 264's doubt was sleep and wake,
  and this draft does not settle it. A person has to sleep the Mac and run `read` after.
- Whether a person is shown a "background item added" notice when the plist lands, and how it
  looks in System Settings' Login Items, is not measured. The man page names
  `AssociatedBundleIdentifiers` for that list; we leave it out.
- The `node` path points into a version manager's folder. An upgrade that removes it would make
  launchd fail to start the job, and the throttle would retry it every 10 s. Not tried.
- One Mac, one tiny process. Linux's systemd is not touched.
- If an earlier run left the label loaded, Alchemy's first deploy calls `read` as a cold probe
  (264, `Plan.ts:1434`) and finds it. How beta.85 treats that with `adopt: false` is not checked.
- `bootout` may return before launchd lets the label go. The script waits up to 5 s for
  `launchctl print` to fail before a bootstrap; whether that is ever needed is not known yet.
