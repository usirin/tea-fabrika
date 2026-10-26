# 150. Does the desk work in a plain browser tab, with no Electron?

The question: pull request 90 made the host a process of its own, as tmux's server is, and the
Electron app one client of it. Could a plain browser tab be another client? What does it cost
in typing speed, and in safety on a local port? And how would a person log in from a browser?

**Answer: yes. The same page bundle (`desk.js`) runs in a headless Chromium tab, and the host
is not changed at all. Two small files do it: a 150-line `window.fabrika` over one WebSocket in
the page, and a 190-line relay ("the door") that pipes that WebSocket to the host's socket file,
bytes unread. 36 of the app's own end-to-end checks pass in the tab, first try. Four steps are
Electron's alone and do not fit a tab. Typing in the tab is as fast as in Electron on the same
laptop (16 ms to the frame after the draw). Over a network each key waits one round trip
more: 45 ms at 30 ms, 95 ms at 80 ms. Local echo (143's fix 4) brings a letter typed at the end
of the line back to 14 ms at any delay. On a local port the door needs its guards: Origin and a
cookie made from a one-time token, plus Host. With none, a page from any other server on the
laptop typed into tsh, even with Chromium's Local Network Access checks on. Confidence 85% on
the working part and the guards, 70% on the typing numbers. The doubts: headless has no
screen, and 4 of 34 page loads through the delay proxy never attached, for a reason not
found.**

```ts
// The whole idea. The page: the app's side of the link, run in the page, over one WebSocket.
const attach = Effect.gen(function* () {
	const socket = yield* Socket.makeWebSocket(`ws://${location.host}/link`, {openTimeout: "5 seconds"});
	const w = yield* appWire(socket, fromHost); // link.ts's handshake: a host of another version is refused
	yield* w.up;
	w.send({type: "page"}); // the host shows the page the desk, a port per tile
	return yield* w.ended;
}).pipe(Effect.scoped, Effect.provide(Socket.layerWebSocketConstructorGlobal));

// The door: a WebSocket in, the host's socket file out, nothing read in between.
if (request.url === "/link") {
	if (!origins.has(request.headers.origin)) return refuse("a foreign Origin");
	const ws = yield* request.upgrade;
	const unix = yield* NodeSocket.makeNet({path: paths.sock});
	yield* Effect.raceFirst(forward(ws, unix.writer), forward(unix, ws.writer));
}
```

## Who did what

All of it is this repo's code: the app at main's `2a7f305` (pull request 90 merged), built
from copies under `runs/`, and the experiment's own files. Today's fabrika had no part. No
agent, no model, no Jev, no key set, no network past 127.0.0.1. Cost: $0.

## Setup

- `experiments/150-browser-desk/web/` holds the experiment's three files:
  - `bridge.ts` is the page's `window.fabrika` over one WebSocket.
  - `door.ts` is the relay in front of the host's socket file.
  - `desk.html` is the app's page with `bridge.js` before `desk.js`.
- The patches are 143's own: its probes (`probes-pr90.patch`) and its fix 2 (row redraw),
  read from `experiments/143-typing-latency/`.
  - Fix 4 (local echo) is `experiments/150-browser-desk/fix4-local-echo.patch`: 143's patch,
    with its context moved off 143's fix 3, which is not used here.
- The script builds copies of `apps/fabrika/src` at the pinned commit, adds `web/` and the
  patches, and bundles them as `build.ts` does, plus `bridge.js` and `door.mjs`. `apps/` is
  not changed.
- The browser is Playwright's Chromium 156, headless: no window, and no focus taken.
- Electron 45 is Chromium 156 too, opened quiet, as 143 opened it: no Dock icon, never the key
  window.
- Each run gets a fresh `FABRIKA_HOME` in the temp folder. Its host and door are stopped by pid
  afterwards, and checked to be gone.

```sh
node experiments/150-browser-desk.ts build     # base (probes), f2 (+ row redraw), f24 (+ local echo)
node experiments/150-browser-desk.ts check     # the app's end-to-end flow, in a tab
node experiments/150-browser-desk.ts safety    # the door's guards, tried from outside
node experiments/150-browser-desk.ts typing    # key to screen: Electron and the tab, 0, 30 and 80 ms
node experiments/150-browser-desk.ts report    # writes results/150-browser-desk.json
```

## 1. It works: 36 of the app's checks pass in a tab

The page needs one thing from its window: `window.fabrika`, with `send`, `onMessage` and
`forget` (`bridge.ts` in the app). In Electron the preload makes it, and the main process
relays each port to the host. In the tab, `web/bridge.ts` makes the same three names. It runs
the app's own `appWire` from `wire.ts` over Effect's `Socket.makeWebSocket`, so the handshake,
the version check and the line limit are the app's own. The port names already multiplex the
link, so one socket carries every tile.

```ts
// web/bridge.ts, the part that differs from the preload: the host's lines, handed to the page.
const fromHost = (m: Down) => {
	switch (m.type) {
		case "port": if (m.port !== "desk") open(m.port); return; // the desk's port is the page's own
		case "to":   return hand(m.port, m.m);                     // in order, or held until it listens
		case "gone": lineOf(m.port).open = false; return;
		case "close": return location.reload(); // a tab cannot close itself: load again, a fresh tile
	}
};
```

**Host side: a relay, not a listener in the host.** Why:

- The host does not change at all. It keeps only its socket file, mode 0600, and holds no
  HTTP, cookie or token code. A tab is one more app attached, as `serve.ts` already allows.
- The door reads nothing of the link. It pipes bytes, one Unix socket connection per
  WebSocket. A bug in the door cannot break the host or the Electron app.
- The door is where a guard or a login goes, and it can be stopped or swapped while the host
  runs on. This is the "tiny relay in front" of question 3, so the answer there is yes.
- Its cost is one more process (about 1.3 MB of bundle) and one more copy of each line. That
  adds about 0.1 ms to a key's round trip (section 2).

`@effect/platform-browser` is not needed: its `BrowserSocket.layerWebSocket` is just
`Socket.layerWebSocketConstructorGlobal`, which is in `effect` itself.

The `check` step runs the app's own `e2e.ts` flow in a tab, with its own words, plus the tab's
own cases. All 36 pass:

- tiles, tsh, the Ctrl-B keys (split, move, zoom, close, Ctrl-B twice), a click to focus;
- counter and the tracker, Ctrl-C, closing busy and idle tiles, shared Up history;
- the page has `send`, `onMessage` and `forget` only, and no Node; messages that are not of
  the protocol tell tsh nothing;
- a reload draws the same desk, with nothing restarted; a second tab shows the same desk, and
  a click in one shows in the other;
- the tab closed and opened again, and the browser quit with the host running on; a new
  browser through the token url gets the same desk, with counter still running;
- closing the last tile loads the tab again, on one fresh tile;
- a host of another version: the page does not attach, says both versions, and that host
  runs on;
- nothing of the run is left running.

Four steps do not fit a tab:

| e2e step | Why it does not fit |
|---|---|
| A second copy quits, and the first keeps its one window | That is Electron's single-instance lock. A second tab is a second client of the same host, which was checked instead. |
| The page cannot navigate away | `main.ts` refuses navigation for its window. A tab may always navigate; the bridge goes with the page, and nothing is left attached. |
| `window.open` is refused | That is Electron's window-open handler. In a tab only the page's CSP and the browser's popup rules hold it. |
| The Dock icon and the macOS window rules | A tab has no app and no Dock. Closing the tab and opening the url again stands in for them. |

## 2. Typing speed

**Answer: on the same laptop the tab is as fast as Electron. Over a network each key waits one
more round trip, and local echo hides it: about 14 ms to the first draw at 30 ms or at 80 ms.**

The method is 143's. 250 letters are typed into t1, with Ctrl-U every 25 so the line stays on
one row, and seeded gaps of 30 to 90 ms. Each key waits for its echo before the next one. The
page's own probes time each key on one clock, from the key event's `timeStamp` to the frame
after the draw that shows it. Fix 4 draws twice: its own guess first, then tsh's echo. Both
are timed. The tab has the Electron window's size (1200 by 760) and pixel ratio (2). Both
draw at 60 Hz (a frame every 16.7 ms). The proxy holds each chunk half the round trip, each
way, in order. The page, its files and its WebSocket all go through it.

```ts
// What one key's row looks like, and what the table takes from it.
type Key = {
	first: number; // key event to the frame after the first draw that shows the letter
	host: number;  // key event to the frame after tsh's own echo is drawn
	trip: number;  // keys sent to the echo heard: the link, the door, the proxy and the host
	draw: number;  // the terminal's draw of tsh's echo
};
```

Key event to the frame after the draw, ms, p50 / p95 (first pass; the second is within 2 ms
at p50 in every cell, both are in the results file):

| Where | base | fix 2 (row redraw) | fix 2 + 4: first, the guess | fix 2 + 4: tsh's echo |
|---|---|---|---|---|
| Electron | 15.5 / 41.4 | 16.2 / 41.8 | 16.7 / 32.0 | 42.7 / 49.7 |
| Tab, same laptop | 16.4 / 31.7 | 15.8 / 32.0 | 14.2 / 31.3 | 43.7 / 50.3 |
| Tab, 30 ms round trip | 44.9 / 60.2 | 42.5 / 58.2 | 14.2 / 30.8 | 49.3 / 75.1 |
| Tab, 80 ms round trip | 94.8 / 107.8 | 92.0 / 104.5 | 13.8 / 31.2 | 97.2 / 116.5 |

What the table says:

- **Electron and the tab are the same.** The round trip is 0.8 ms in Electron and 1.0 ms in
  the tab: the door adds about 0.1 to 0.2 ms. The p95 is lower in the tab (32 against 41 ms),
  probably because a headless page has no real display to wait on. Do not read that as the
  tab being faster.
- **Without local echo, the network is added as it is.** 30 ms of round trip adds about 29 ms
  to a key, and 80 ms adds about 79.
- **Local echo takes the network away from what the person sees.** With fix 4, the letter is
  drawn in about 14 ms at any delay, in 100% of these keys: every letter here was typed at the
  end of a `tsh$` line, which is the one case fix 4 guesses.
- **Its cost: tsh's own echo comes about 11 ms later.** The guess's draw holds the page's
  thread when the echo arrives, so the echo waits for the next frame. On the same laptop that
  makes tsh's echo 43 ms against 16 ms. Nobody sees it, since it draws the same cells. But a
  wrong guess would stay that long, and longer over a network.
- **Fix 2 (row redraw) cuts the terminal's draw from 8.2 ms to 0.4 ms,** as 143 found. Here it
  moves the key's p50 by only 1 or 2 ms, because the wait for the next frame is most of it.
- 143 measured about 31 ms more from the end of the draw to the glass, at 60 Hz, in Electron.
  That part was not measured here (see what this cannot tell us).

**Is local echo worth it over a network? Yes, for a desk across a network: at 80 ms it makes a
letter appear in 14 ms instead of 95.** That is the gap between typing that feels local and
typing that feels like a slow ssh. mosh made the same choice for the same reason. On the same
laptop it buys nothing (14 against 16 ms) and delays tsh's echo by a frame. So turn it on only
when the round trip is long. Cost: fix 4 is about 20 lines in `terminal.ts`, and it guesses
only at the end of a `tsh$` line. A program that draws its own screen gets no guess. How sure:
80%. The doubt: no wrong guess was tried here, such as a key tsh refuses, or a line that wraps.

## 3. Safety on a local port

A port on 127.0.0.1 is not private. Any program of any user on the machine can connect to it.
Any web page the person opens can try to reach it too. A page that gets in can read every tile
and type into tsh. The `safety` step tries four kinds of page and six raw requests against
each set of guards:

- **same-site page**: a page served from 127.0.0.1 on another port, by a real local server;
- **cross-site page**: the same, served on `localhost`;
- **public page**: a page from `attacker.example`;
- **DNS rebinding**: a page from `rebind.test`, a name that resolves to 127.0.0.1, on the
  door's own port.

Each page opens `ws://<door>/link`, reads a screen, and types a `say` with a mark into t1's
tsh. The run checks t1 for the mark. Chromium 156 has Local Network Access (LNA) on, which
blocks a public page from reaching loopback. Safari and Firefox do not have it yet. So each set
is tried twice: as shipped, and with LNA off
(`--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets`), which
stands in for those browsers.

| Guards on (LNA off) | same-site | cross-site | public | rebinding |
|---|---|---|---|---|
| none | typed | typed | typed | typed, and read the files |
| Host only | typed | typed | typed | refused |
| cookie only | typed | refused | refused | refused |
| Origin only | refused | refused | refused | refused, but read the files |
| Origin and cookie | refused | refused | refused | refused |
| Host, Origin and cookie | refused | refused | refused | refused |

As shipped, with no guards, LNA stopped the public and rebinding pages. It did **not** stop
the same-site or the cross-site page: both typed into tsh. Loopback to loopback is not
"local network access", so a page served by any dev server on the laptop gets in.

What each guard holds:

- **Origin** on `/link` is the one that stops pages. A browser always sends it on a
  WebSocket, and a page cannot change it. Browsers do not apply CORS to WebSockets, so the
  door must check it itself.
- **The cookie** stops programs that do not have the url the door wrote. A program can forge
  Origin and Host, but it cannot guess 32 random bytes. The cookie does not stop a same-site
  page: cookies are not split by port, and `SameSite` counts 127.0.0.1 on any port as one
  site.
- **Host** stops DNS rebinding before anything is served. With Origin alone, a rebound page
  could still read the page's files (status 200). That is not a way in, but it is cheap to
  close.

Raw requests, all three guards on:

| Request | Answer |
|---|---|
| No cookie | 403 |
| The cookie | 101, attached |
| A foreign Host | 403 |
| No Origin | 403 |
| The files, with a foreign Host | 403 |
| A wrong token | 403 |

**Smallest guard that holds: Origin plus the token's cookie.** Host costs one line and closes
the file read, so keep all three. The token is made once per door start and stays valid until
the door stops, as Jupyter's does. It is swapped for an HttpOnly, SameSite=Strict cookie at
once, so it does not stay in the url or the browser history.

**Can the host keep only the socket file? Yes.** That is what this run did: the door is the
only thing on a port, and the host never learns a tab from an app. The door's url file is
mode 0600, in the home's `web/` folder, next to the socket. A program of the same user can
already open the socket file, so the token adds nothing against that user. It protects
against other users on the machine and against web pages.

## 4. Logging in from a browser (research only)

How others do it:

- **Jupyter**: a token is made at start and printed, as a url with `?token=`. The first visit
  swaps it for a cookie, and the token is not needed again until another browser or port.
  `jupyter server list` shows it again.
  ([Jupyter Server security](https://jupyter-server.readthedocs.io/en/latest/operators/security.html))
- **code-server**: a random password in `config.yaml`, or an Argon2 hash in
  `hashed-password`. Logins are limited to two a minute plus twelve an hour. Plain HTTP by
  default; the docs send people to a guide for exposing it safely.
  ([code-server FAQ](https://coder.com/docs/code-server/FAQ))
- **VS Code tunnels**: no listener on the machine. It dials out to Microsoft's dev tunnels
  relay. Both ends sign in with the same GitHub or Microsoft account, and SSH runs inside the
  tunnel. The CLI on a machine with no browser signs in with GitHub's device code.
  ([VS Code Remote Tunnels](https://code.visualstudio.com/docs/remote/tunnels))
- **ttyd**: basic auth (`--credential user:pass`), or an auth header from a reverse proxy;
  `--check-origin` is off by default; the terminal is read-only unless `--writable`.
  ([ttyd](https://github.com/tsl0922/ttyd))
- **Device code (RFC 8628)**: the device shows a code and a url; the person approves it on a
  device where they are signed in; the device polls until it gets a token. The RFC warns the
  flow can be started on a device the attacker holds, so the approving screen must say what
  is being approved. ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628))
- **Passkeys (WebAuthn)**: only in a secure context (https, or localhost), and the relying
  party is a domain, not an IP. A phone's passkey can sign in on a laptop through FIDO's
  cross-device flow. ([MDN Web Authentication API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API),
  [passkeys.dev terms](https://passkeys.dev/docs/reference/terms/))
- **Approve from a signed-in device (QR)**: WhatsApp and Signal link a new device by scanning
  a QR code from the phone that is already signed in, with a list of linked devices to log
  out. MITRE lists tricking people into scanning such a QR as a known attack.
  ([WhatsApp multi-device](https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/),
  [MITRE T1676](https://attack.mitre.org/techniques/T1676))

**Lean for two people: no password anywhere. A token url on the person's own laptop, and
approval from a signed-in fabrika for any other browser.** It comes in branches, one per case:

```ts
// A sketch: how a browser gets a session from the door, case by case.
type Login =
	| {kind: "token"}    // the person's own laptop: `fabrika open` reads <home>/web/url (0600) and opens it
	| {kind: "approve"; code: string} // any other browser: it shows a short code and a QR;
	                                  // the person approves it in their own fabrika, already signed in
	| {kind: "passkey"}  // later: a browser approved once keeps a passkey, once the door is on https

const onApprove = (code: string, by: GitHubLogin, browser: string) =>
	// The approving screen says which browser and from where (RFC 8628's warning), and each
	// session shows in a list the person can log out, as WhatsApp's linked devices do.
	({kind: "session", for: by, browser, until: "short"});
```

- **Why the token for the own laptop**: it is what this run did, and it held. It is
  Jupyter's way, which people know. `fabrika open` hides the url, so nobody copies a token by
  hand.
- **Why approval for any other browser**: the ledger already decided that a person proves who
  they are with their SSH key against the keys GitHub lists
  ([the ledger goes to Cloudflare](../docs/direction/the-ledger-goes-to-cloudflare.md)). A
  browser cannot sign with an SSH key, but the person's fabrika on their laptop already can.
  So the browser asks, and the signed-in fabrika answers. This is RFC 8628's device flow,
  turned around: the browser is the device. It is the same as approving a WhatsApp Web login
  from the phone.
- **Why not a password** (code-server, ttyd): it is one more secret to keep and to rotate,
  and it is not tied to a GitHub login, so the ledger's members list would not cover it.
- **Why passkeys later, not first**: they need https and a domain name. A door on
  `127.0.0.1:<port>` has neither for another machine. Once the cloud host has a real name,
  they are the best way to keep a browser signed in.
- **Cost**: a code screen in the page, an "approve" command in tsh and in the app, a short
  session list on the door. About a day of work over what this run built.
- **How sure: 70%.** The doubt: this run tested only the token, on one laptop. Approval was
  not built. What would settle it is building the approve branch against the cloud host,
  and trying the attack RFC 8628 warns about: a code from a browser the person does not own.

## What surprised me

- **Chromium's LNA does not cover loopback to loopback.** It stopped public pages, but a
  page from any other local server got in with no guards. That is the case most likely to
  happen: a dev server on the laptop running someone's package.
- **The cookie alone does not stop a local page.** Cookies are not split by port, and
  `SameSite` sees 127.0.0.1 on any port as one site. The Origin check is the guard that
  matters.
- **All 36 checks passed on the first run.** The link protocol, the port names and the
  page's three names were enough. The page bundle needed no change.
- **`@effect/platform-browser` has nothing needed here.** Its WebSocket layer is three lines
  over what `effect` already has.
- **Local echo slows tsh's own echo.** It shows the letter at once, but the real echo then
  lands a frame later than it would without the guess, even on the same laptop.
- **4 of 34 page loads through the delay proxy never showed a tile, even after 30 s.** Each
  came after at least one full 250-key run in the same process. The run stopped there, so
  those runs were done again. 12 short loads in a row afterwards all worked. The cause is not
  known. It could be the proxy, the bridge's 5 s open timeout on a busy machine, or a real
  fault in the page's attach. The script now saves a screenshot and the page's and the door's
  logs when this happens, but it did not happen again.

## What this cannot tell us

- **Headless has no screen.** "On screen" here is the frame after the draw, in both the tab
  and Electron. 143 measured the rest (the frame to the glass, about 31 ms at 60 Hz) with a
  trace, in Electron only. It is the same Chromium, but a headed browser on a real display
  was not measured.
- **One browser.** Safari and Firefox were not run. LNA-off Chromium stands in for their
  missing LNA, but their WebSocket and cookie rules were not checked.
- **A proxy is not a network.** It holds each chunk half the round trip, in order. It has no
  loss, no jitter and no bandwidth limit. A wifi drop is experiment 149's question.
- **No reconnect.** If the link drops, the tab says so and stays down until a reload, as the
  app does today.
- **A shared, busy laptop.** Other work ran at the same time: the one-minute load was 6 to
  30 on 12 cores during the typing runs. Both passes are kept, and each run's load is in the
  results file.
- **Login was researched, not built.** The lean in section 4 is a design, not a result.
