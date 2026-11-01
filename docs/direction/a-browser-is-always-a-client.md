# Protocols first, and a browser is always a client

**Decided 2026-10-30,** during the walk of the transport layer. Every protocol
fabrika speaks is written so that a browser tab could speak it too, even when
nobody builds the browser side yet. The protocol comes first; each
implementation (the Mac's hands, the VM's hands, a browser tab, a test) is one
client that speaks it.

*Changed 2026-10-31: this note said "peer". The word is gone; see
[brain, hands, window, agent](./brain-hands-window-agent.md).*

*Changed 2026-10-31 (T3): the window no longer talks to its own hands over a
Unix socket. Every window is a client, the Electron window too, and dials its
own gateway over a WebSocket with its own key (kept in the macOS Keychain in
Electron). The brain checks the page's origin. The window row below and the
"local shortcut" bullet are kept as the earlier answer. See
[the five layers](./a-local-first-sync-engine.md#layer-1-transport-decided-2026-10-30-t3-changed-2026-10-31).*

```ts
// A sketch. One protocol, many clients. Only the transport and the key store differ.
//   client         transport                      key kept in            has
//   Mac hands      WebSocket to gateway:mac       an SSH key file        git, files, agents
//   VM hands       WebSocket to gateway:vm        an SSH key file        git, files, docker
//   browser tab    WebSocket to gateway:<tab>     WebCrypto (Ed25519)    notify, clipboard
//   window         Unix socket to its own hands   (its hands sign)       the same messages, a local shortcut
{type: "hello", version: 1, key: "ed25519:...", signed: "...", has: ["notify"]}
"ping" // a text message; the gateway answers "pong" without running its code
```

## What was decided

- **A protocol may not need anything a browser lacks:** no Node, no Unix
  socket, no files, and no WebSocket-level frames (browser JavaScript cannot
  send a ping frame).
- **A local shortcut must carry the exact same messages.** The window talks to
  its own hands over a Unix socket because it is the same computer; what goes
  over it is the same as what a browser would send over a WebSocket.
- **Check every design question against it:** could a browser tab be this
  client? If not, the protocol changes, not the browser.

Three answers in the transport layer follow from it:

| Question | Before | Now |
|---|---|---|
| How many connections | one gateway object per computer | one gateway object per client: a computer's hands, a window or an agent |
| How a client proves who it is | its SSH key | a key pair that signs the hello; an SSH file on a Mac, WebCrypto Ed25519 in a browser, granted by its person as `fabrika post` grants an agent's key today |
| How we know a client is still there | WebSocket ping frames | a text `"ping"`, answered `"pong"` by the object's auto-response |

A browser is also a host, with capabilities of its own (show a notification, read
the clipboard). It says so in its `has` list, the same way the Mac says `git`, and
a Cmd that `needs` git never goes to it. That list, and not the word "window",
is what keeps a job away from a tab. See
[brain, hands, window, agent](./brain-hands-window-agent.md).

## Why

- **The backbone is cheap to keep open now and expensive to open later.** A
  protocol that leans on a Unix socket or a key file works until the first
  browser client, and then every layer above it changes.
- **The browser is the narrowest place a client can run.** A protocol a browser
  can speak runs in Node, in workerd, in a test, and on a phone, without
  changes.
- **It is not a general framework.** This is the backbone of an app two people
  use daily. The rule costs nothing extra today: each of the three changes
  above is the same amount of work as what it replaced.

## What was checked

- **The text ping works on local Miniflare.** Checked by hand on 2026-10-30
  with Miniflare 4.20260730.0: `setWebSocketAutoResponse` with the pair
  `("ping", "pong")` answered 20 of 20 pings, in about 1.3 ms each, and the
  object's `webSocketMessage` never ran. One message that was not a ping did
  run it.
- **Not checked locally: a sleeping object.** Miniflare never puts an object
  to sleep by itself, and `ctx.abort()` drops the socket (close code 1006),
  so "a ping does not wake the object" rests on
  [Cloudflare's docs](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server)
  for now. Waking costs money only on Cloudflare, so the gap is small.
- **Ed25519 in WebCrypto** ships in Chrome (137), Firefox and Safari (17)
  ([Chrome 137](https://blog.ipfs.tech/2025-08-ed25519/),
  [the engines' timeline](https://blogs.igalia.com/jfernandez/?p=1913)).
  Keeping the browser's key non-extractable has not been tried.

## How it is kept

A written rule does not stop a change that breaks it. Two checks do:

- **Built, in today's version: the top level is bundled for a browser.** `pnpm lint` bundles
  `@kampus/fabrika-old`'s top level for a browser and fails on a Node import. The
  protocol's schemas and the client's state machine live on that top level; a Node or
  Unix-socket transport goes on a subpath.
- **Proposed: a browser client in CI.** The CI job starts its own Miniflare and
  a headless browser (Playwright) on the CI machine itself; the browser
  connects, signs a hello, pings, sends one message and reads the answer.
  Both stop when the job ends. Nothing connects to anyone's computer. Every transport (WebSocket from Node, the Unix socket, memory) runs
  the same suite, as the Autobahn suite checks every WebSocket library. It is
  built with the protocol code itself, not before
  (the clean slate, https://github.com/usirin/tea-fabrika/pull/217).

## What it costs

- One more test job in CI, with a browser, once the protocol code exists.
- A browser client needs its person to grant its key. In `next/`, that flow is
  designed in [Tier 1's plan](../plan/tier-1.md): a code in the tab, a row in the
  menu bar, Approve and a finger. That plan was approved 2026-11-01, and this is
  not built.

**How sure:** 80%. The doubt is a protocol need that a browser truly cannot
meet, such as a client that must hold a file lock. What would settle it: the
browser-client suite passing on every transport question still open (version,
reconnect, message shape).

## What it cannot tell us

- Whether anyone will use fabrika from a browser soon. The browser window
  itself is not built now; only the protocol stays open for it.
- How a browser client behaves when its tab sleeps or the phone locks. Browsers
  throttle or close background tabs; reconnecting is the normal path for
  every client, but a browser's timing was not measured.
