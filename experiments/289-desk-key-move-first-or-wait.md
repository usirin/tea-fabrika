# 289. When a person presses a desk key, should the window move first or wait for the brain?

**Summary.** `next/`, the desk (decision 0278). Answer: move first, and let the brain's answer win.
Every multiplayer system read here moves first and lets the server correct it; only Cloudflare's
plain chat demo waits. Measured in local workerd
(Miniflare 4.20260730.0): one focus key's round trip over one WebSocket to one Durable Object is
p50 0.16 ms, p95 0.26 ms, p99 0.65 ms. With two people moving focus on one desk at about 8 keys a
second each, a move-first window would see its own move overwritten mid-flight on about 1% of keys
over loopback, on 17 to 23% with a 20 ms round trip, and on 64% with 80 ms. A version check
refuses about as many. The Cloudflare-hosted half is not in yet. $0 beyond this session.

Run on 2026-11-14 (UTC) in a Claude cloud session: Linux, 4 cores, Node 22.23.4, Miniflare
4.20260730.0 with workerd 1.20260730.1, both from the repo's lockfile. No deploy, no key. Part 1
was read by one research agent on Opus; its quotes from tldraw, Liveblocks and Cloudflare's chat
demo were checked against the source here.

**The answer: move first, and let the brain's answer win.** That is what every system read does,
and for one person at a desk it costs nothing: nobody else moves the focus, so no key ever snaps
back. The cost shows only when two people steer one shared desk: at typing speed, the share of keys
that snap back grows with the round trip, from about 1% over loopback to about 20% at 20 ms and
about 64% at 80 ms. So the measurement also says: keep focus per person (Figma and Linear show each
person's own selection: a guess, not read in any source here), and let only truly shared changes (split, close) clash. How sure: about 75%. The doubts
are the deployed round trip, which the hosted half would measure, and what a snap looks like in a
real window, which only a window test can show.

```ts
// Sketch: the move-first desk window, in tea terms. The window keeps the brain's last state and
// its own keys still in flight, and draws the two together.
type View = { readonly confirmed: Desk; readonly pending: ReadonlyArray<{ id: string; key: Key }> };
const draw = (v: View): Desk => v.pending.reduce((d, p) => apply(d, p.key), v.confirmed);
// key pressed  -> pending += key, send { jsonrpc: "2.0", id, method: "desk.key", params: key }
// result(id)   -> confirmed = result, pending -= id
// error(id)    -> confirmed = error.data, pending -= id        (the snap back)
// desk.state   -> confirmed = params; pending stays on top     (the other person's move)
```

## Part 1: how others handle a user's own action

Read by the research agent through each project's public source and docs. Where only a search
summary was read, the line says so.

| System | Own action | How the server refuses or rewrites | What the user sees |
|---|---|---|---|
| tldraw sync | moves first: changes "are immediately applied for responsive UI, then sent to the server for validation" | each push gets `commit`, `discard` (read-only, denied access, failed check) or `rebaseWithDiff`; the client reverses its guesses, applies the server's results, then re-applies what is still pending | a discarded edit vanishes; only a version mismatch shows "please refresh the page" |
| PartyKit / PartyServer | no rule of its own; partysync's `useSync` can "optionally do an optimistic update"; Y-PartyServer is Yjs | no source found | no source found |
| Liveblocks | moves first; ops kept as unacknowledged until the server echoes their id | a remote op on a key with a pending local op is ignored "to preserve optimistic update"; the server can send `REJECT_STORAGE_OP` | no rollback for most ops (it is "hard/impossible"): it logs "Storage mutation rejection error", throws in development |
| Cloudflare chat demo (Durable Objects) | **waits**: it sends, and draws only what the server broadcasts | an error comes back as a message | a "* Error: ..." line |
| Cloudflare Agents SDK `useAgent().setState` | moves first: sets local state, then the server's `validateStateChange` runs | refused with `CF_AGENT_STATE_ERROR` to `onStateUpdateError` (search summary only) | the local state stays wrong until the next server state, unless the app handles it |
| Figma (2019 post) | moves first; the server is the authority (search summary only) | last write the server receives wins per property; the client drops incoming changes that clash with its unacknowledged ones | no source found |
| Linear (a reverse-engineering write-up, not Linear's own) | moves first; the model changes before `save()` | a rejected transaction runs its `rollback`; pending ones are rebased, last writer wins | not stated |
| Zero / Replicache (search summary only) | moves first; the same mutator runs on the client, then on the server | the server's run always wins; on an error "the mutation will be rolled back" | the app gets the error |

The common shape: keep the last state the server confirmed, draw the person's own pending changes
on top, and on each answer put the server's truth underneath and re-apply only what is still
pending. No source read names focus, navigation or destructive actions as ones that must wait.
The one that waits, Cloudflare's chat demo, is a log where order is the content.

Sources (each read in full by the research agent unless marked):

- tldraw: <https://raw.githubusercontent.com/tldraw/tldraw/main/packages/sync-core/src/lib/TLSyncClient.ts>,
  <https://raw.githubusercontent.com/tldraw/tldraw/main/packages/sync-core/src/lib/TLSyncRoom.ts>,
  <https://raw.githubusercontent.com/tldraw/tldraw/main/apps/docs/content/docs/sync.mdx>
- PartyKit: <https://raw.githubusercontent.com/cloudflare/partykit/main/README.md>,
  <https://raw.githubusercontent.com/cloudflare/partykit/main/packages/partysync/README.md>,
  <https://raw.githubusercontent.com/partykit/partykit/main/packages/y-partykit/README.md>
- Liveblocks: <https://raw.githubusercontent.com/liveblocks/liveblocks/main/packages/liveblocks-core/src/room.ts>,
  <https://raw.githubusercontent.com/liveblocks/liveblocks/main/packages/liveblocks-core/src/crdts/LiveObject.ts>,
  <https://raw.githubusercontent.com/liveblocks/liveblocks/main/packages/liveblocks-core/src/protocol/ServerMsg.ts>
- Cloudflare: <https://raw.githubusercontent.com/cloudflare/workers-chat-demo/main/src/chat.html>,
  <https://raw.githubusercontent.com/cloudflare/agents/main/packages/agents/src/react.tsx>,
  <https://raw.githubusercontent.com/cloudflare/agents/main/packages/agents/src/index.ts>; not
  opened: <https://developers.cloudflare.com/agents/api-reference/store-and-sync-state/>
- Figma, not opened: <https://www.figma.com/blog/how-figmas-multiplayer-technology-works/>
- Linear: <https://raw.githubusercontent.com/wzhudev/reverse-linear-sync-engine/main/README.md>
- Zero, not opened: <https://zero.rocicorp.dev/docs/custom-mutators>

The box's network allows GitHub's raw host but not `developers.cloudflare.com`, `www.figma.com`,
`tldraw.dev` or `zero.rocicorp.dev`, which is why some rows rest on search summaries.

## Part 2: the round trip and the clash rate, in local workerd

What ran: `desk-latency.mjs` (on the branch `fabrikalfa/x289-desk-script`, under
`experiments/289-desk-move-first/`) starts Miniflare with one Worker and one Durable Object,
`Desk`, which holds `{ focus, rev, tiles }`. The Worker hands every WebSocket to that one object.
The object uses the hibernation API (`acceptWebSocket`, `webSocketMessage`) and speaks JSON-RPC 2.0
over text frames:

```ts
// client -> brain
{ jsonrpc: "2.0", id: "k17", method: "desk.key", params: { _tag: "focus", tile: "t2", by: 0, base: 41 } }
// brain -> that client
{ jsonrpc: "2.0", id: "k17", result: { focus: "t2", rev: 42, tiles: ["t1", "t2", "t3", "t4"] } }
// brain -> every other client
{ jsonrpc: "2.0", method: "desk.state", params: { focus: "t2", rev: 42, tiles: [...], by: 0 } }
// with method "desk.key.checked", a stale base is refused
{ jsonrpc: "2.0", id: "k17", error: { code: 409, message: "stale", data: { focus: "t3", rev: 43, ... } } }
```

**Round trip, one client, 1,000 keys one after another** (after 50 warm-up keys):

| p50 | p95 | p99 | max |
|---|---|---|---|
| 0.16 ms | 0.26 ms | 0.65 ms | 36.5 ms |

A second run, during the 20 ms test below, gave p50 0.16, p95 0.20, p99 0.39 and max 3.8 ms. The
one 36.5 ms key in the first run is a single outlier in 1,000; it is the kind of pause a garbage
collection or the box's other work makes, and it was not traced.

**Two people on one desk.** Two clients, each pressing a random focus key every 125 ms on average
(jittered by plus or minus half), for 60 s. Run twice per setting: once where the last key the
brain gets wins, and once where the brain refuses a key whose `base` revision is stale.

- **Overwritten**: before a key's answer came back, a `desk.state` from the other person arrived.
  A move-first window had already drawn its own focus and must now show the other's: one snap.
- **Refused**: in the checked run, the brain answered 409 and sent its current state.

A network was simulated by holding each client's outgoing frame and each incoming frame for half
the round trip (`setTimeout`); workerd itself ran on loopback.

| Round trip | Last writer wins: overwritten | Version check: refused |
|---|---|---|
| loopback (about 0.2 ms) | 3 of 481 (0.6%), 6 of 485 (1.2%) | 7 of 477 (1.5%), 9 of 475 (1.9%) |
| 20 ms | 112 of 488 (23.0%), 82 of 480 (17.1%) | 80 of 477 (16.8%), 95 of 483 (19.7%) |
| 80 ms | 315 of 486 (64.8%), 306 of 479 (63.9%) | 262 of 491 (53.4%), 225 of 483 (46.6%) |

So the clash rate grows with the round trip. A simple estimate, the chance that the other
person's key lands while one's own is in flight, is 1 - e^(-8/s x RTT): 15% at 20 ms and 47% at
80 ms. The measured rate is near it at 20 ms and above it at 80 ms; why it is higher at 80 ms was
not worked out (a guess: at 80 ms a key in flight can be passed by more than one of the other's
states, and the jitter bunches keys). Over loopback the rate is not zero because both clients and
workerd share one box's scheduling. The round trip of the first test (p50 0.16 ms) was measured
with no simulated delay in all three runs: 0.16, 0.16 and 0.16 ms.

What it means for the desk:

- **Waiting costs nothing locally.** On the owner's Mac the brain is the same Worker in local
  workerd, and a key's round trip there is a fraction of a millisecond, far under one 60 Hz frame
  (16.7 ms). A window that waits would look the same as one that moves first.
- **Moving first costs snaps, and only when two people steer one desk.** With one person, no key
  is ever overwritten, since nobody else moves the focus. With two at typing speed, a share of keys
  equal to about their combined rate times the round trip snaps back.
- **The two are not exclusive.** The sketch above moves first and still lets the brain's answer
  win, which is tldraw's and Figma's shape.

## What a desk on the Cloudflare-hosted brain would add

Not measured yet: it waits on the owner's yes to deploy the same Worker. The deployed round trip
decides how far the 20 ms and 80 ms rows apply; a guess, unmeasured, is 20 to 80 ms from a home
connection to the nearest Cloudflare location and its Durable Object.

## What this cannot tell us

- The deployed round trip, and whether a Durable Object far from one of the two people changes the
  picture. That is the hosted half.
- What a snap back looks like to a person. No window was built; the counts say how often, not how
  bad.
- Whether two people really share one desk's focus. If each person's focus is their own (likely; that
  selection is per person in Figma and Linear is a guess, not sourced here), no focus key ever clashes, and only the
  shared parts (split, close) can.
- Split and close were not measured: only focus. A close that the brain refuses would bring a
  tile back, which may look worse than a focus that moves.
- Two clients in one Node process on one box are not two people on two networks. The simulated
  delay is a fixed half round trip each way, with no jitter and no loss.
- The probe's raw output is not kept; the numbers above are all of it.
