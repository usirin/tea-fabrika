# A local-first sync engine is the base

**A vision**, written down 2026-10-19. Not planned, not sized. It is here so
that what gets built now does not close the door on it.

## The picture

Several people work on one repo, each with their own agents. No two agents
ever take the same ticket, and nobody relies on the code host's permissions
to make that true. Every person's machine holds the whole record, so each one
can run their own desk, their own Tuval, offline if need be. Think of a notes
app with its sync service, but for a team's agents.

The piece underneath is not the ledger. It is a **sync engine**: a way to
share a growing, signed log between people and agents. The ledger is the
first log built on it.

- **Bottom, the sync engine.** Append-only logs, every line signed by whoever
  wrote it, peers that sync by gossip, and a lease for anything that needs
  one writer. It runs on a laptop, in a Cloudflare Durable Object, anywhere.
- **Middle, many logs.** fabrika's ledger is one. A team's shared knowledge,
  agent traces, and others are just different kinds of lines.
- **Top, views.** The owner's desk, Tuval, search, analysis. Every peer has
  all the state, so each person runs their own.

```ts
// The same Ledger service; only the Layer under it changes.
const solo = layerSqlite({ path: "~/.tsh/ledgers/github/acme/app.sqlite" }); // built 2026-10-21
const team = syncedLedger({ log: "acme/app", peers, referee });  // the vision
```

**Solo is a team of one.** Designing for a team covers the solo case for free;
the reverse is not true.

## The hard part: a claim

Sharing facts is easy: if two peers add the same harmless line, nothing
breaks. A claim is different. Two agents on one ticket is real money spent
twice. A claim needs "add this only if nothing new came in first", and gossip
has no single place that can say who was first.

- **Leases, not claims for ever.** A claim lasts some minutes and is renewed
  while the agent works. A dead lane's claim runs out by itself; nobody has to
  adopt it by hand, as today's fabrika needs.
- **A referee grants leases.** Any always-on peer can be it; the team picks
  which one, and another takes over when it is gone (leader election, kept
  small). Inside a Durable Object, one request at a time makes the referee
  free.
- **During a split, no new leases.** A peer cut off from the referee can read
  and plan, and cannot start an agent. That is the honest answer.

## Decided 2026-10-19

- **One ledger, a Durable Object, everywhere.** *(Changed 2026-10-20; the
  first version said two backends, a Durable Object for a team and a plain
  SQLite file for one person.)* One request at a time makes it the referee
  for free, and it brings SQLite, alarms (a lease running out) and sleeping
  WebSockets (the live tail). Two backends would mean building those twice.
  A team runs it on Cloudflare; one person runs the same class in
  Miniflare, Cloudflare's local runtime, its data kept on disk. A team that
  wants no Cloudflare runs the same bundle on a self-hosted runtime
  (workerd, celld). Which one a host uses is config; see
  [tea-host](./tea-host.md).
- **Experiment 93 backs it** ([write-up](../../experiments/93-ledger-miniflare.md)).
  All 10 laws hold in Miniflare. A 30-minute soak at about 100 times a
  team's load, killed every 5 minutes, lost no acknowledged write and made
  no gap or duplicate; each restart took about 200 ms. The object's data is
  a plain `.sqlite` file that node:sqlite can read, and the same SQL ran
  unchanged on node:sqlite, which stays the way out if this ever fails.
- **What the local host does around it:**
  - **Talks to workerd directly** (`unsafeDirectSockets`), skipping
    Miniflare's router worker, which the ledger does not need.
  - **Restarts workerd when its memory passes 500 MB.** workerd's memory
    grows with traffic and is not given back: about 4 MB a minute at a
    realistic mix, faster under heavy reads. Neither a V8 heap limit nor
    evicting the object frees it; only a restart does. At a realistic mix
    that is about 12 to 17 restarts a day, each about 200 ms, losing
    nothing. Talking directly cut the growth by 30 to 40%.
  - **Runs workerd in its own process group** and kills the group: a Node
    process killed alone leaves workerd serving.
  - **Keeps a small connection pool:** 200 new connections at once get
    reset.
- **One law suite runs against every runtime:** many claims at once, kills,
  restarts, lease expiry.
- **Words:** a **host** is a running process that hosts tea programs; one
  machine can run several, and a Durable Object is one. A role (referee,
  tracker, CI runner, builder) is a program on a host, and the shape a role
  needs is an **interface**: the plain type of a program.
- **Libraries checked first.** Effect's own event log and cluster modules do
  not fit (the first merges copies with no compare-and-set; the second needs
  one shared database every node reaches). No outside library has
  compare-and-set, leases, fencing and signed writers together. The closest
  journal is LiveStore's Cloudflare sync server; a short test decides whether
  it carries our journal or we copy its design.

## Decided 2026-10-30: four layers, central first

```ts
// A sketch. Bottom to top; each layer uses only the one below it.
//   app     tea programs, Cmds, the brain and the hands, windows
//   nodes   presence, inboxes, claims: streams on the ledger
//   data    the ledger: one log per project, a Durable Object
//   link    one framed, two-way channel: a WebSocket to the ledger
//
//   Mac hands  -- one socket -->  ledger  <-- one socket --  VM hands
//                                   ^
//                         programs (Durable Objects)
interface Data {
	append(stream: string, id: string, event: unknown): Effect.Effect<Rev>;
	read(stream: string, after: Rev): Stream.Stream<Entry>;
	wait(stream: string, after: Rev): Effect.Effect<Rev>; // the doorbell
}
```

- **Decided:**
  - **The layers are link, data, nodes and app.** Data sits under the
    network, the way log designs (Kafka, Temporal) and sync engines (Linear,
    Replicache, Zero, LiveStore) put it. LiveStore on Cloudflare is nearly the
    same picture: one Durable Object per store is the hub, and every client
    dials it.
  - **Central first.** Every peer reads from the one ledger. Central makes
    what is on screen easy to trust, and a screen that gets sloppy is the sign
    to change it. The data layer's calls (`append`, `read`, `wait`) leave room
    for a local copy later.
- **Proposed:**
  - **Split today's `Ledger` service by layer** (80%). It has about 25 calls
    that mix all three: data (`append`, `read`, `readStream`, `readLast`),
    nodes (`register`, `send`, `claim`, `renew`, `cancel`, `exit`, `monitor`,
    `link`, `trapExit`, `startChild`, `processInfo`, `lease`) and app
    (`hold`, `charge`, `setLimits`, `usage`). Three services, each on the one
    below. Cost: 15 to 25 files, 10 to 20 agent hours.
  - **One unrecorded lane on the same link** (75%), for "come read" pokes,
    who is online, and fast streams such as terminal bytes. Replicache calls it
    a poke, Yjs awareness, automerge-repo ephemeral messages. The doorbell
    already is one (`durable-object.ts`). The rule: no app state is ever built
    from it, so losing a frame breaks nothing.
  - **Messages change state; RPC only asks the hub** (85%). A change is a
    plain message with an id, written to the ledger, so a run can be replayed.
    A call is a send, a reply-to and a deadline (`call.ts`). No live callbacks
    across computers: Cap'n Web's own docs say saving one is like saving a file
    descriptor.
  - **A local read copy later** (70%), folded from the tail into SQLite, as
    every sync engine keeps. The doubt: whether a laptop ever needs to read
    offline enough to pay for it.
  - **Who is online comes from open sockets,** not from writes. "Down" is
    written once, when a socket closes and does not come back within a grace
    time.
- **A standard per layer, proposed:**

  | Layer | Use | How sure |
  |---|---|---|
  | link | WebSocket; JSON lines on a Unix socket for the local app | 90% |
  | version | the subprotocol `fabrika.v1`, then a hello that lists features | 75% |
  | identity | SSH keys and SSH signatures; a peer's id is its key fingerprint | 80% |
  | alive or not | WebSocket ping and pong, which do not wake the object | 80% |
  | message shape | CloudEvents (`id`, `source`, `type`, `time`), after a short look | 60% |
  | tracing | W3C `traceparent` in each message, OpenTelemetry out | 85% |
  | asking the hub | Effect RPC, in place of the hand-made door wire | 65% |
  | peer to peer calls | none: not Cap'n Web (no sleep, nothing saved), not A2A (needs a client it can dial) | 80% |

- **The pieces exist, on three links:** the app's link has a hello with
  versions and ports (`apps/fabrika/src/link.ts`), the door has real identity
  (`door.ts`), and the doorbell has a push that survives sleep. The node layer
  is mostly joining them into one link.
- **Experiments that settle it,** all $0 on Miniflare and a local VM:
  1. Three peers, one hub: Mac and VM each dial one object, 1,000 messages,
     the object killed every 100. Time, lost, doubled.
  2. Presence without writes: how fast the hub sees a stopped VM, and writes
     per hour against a 5 s lease.
  3. The unrecorded lane: a terminal's bytes as ledger appends against
     relayed frames. Keystroke echo time and the hub's CPU.
  4. A direct Mac-to-VM path, only if 3 shows the hub is too slow.
  5. Effect RPC on a sleeping socket, and a replay of one peer's frames into
     a fresh program.

## Why the design already allows it

- **The `Ledger` is a service** ([the ledger behind a
  service](./ledger-behind-a-service.md)) with three calls: `append`,
  `appendAfter` (add only if the ledger still ends where you last read) and
  `entries`. The memory and disk versions already share them; a synced one
  would be a third.
- **The `Ledger` has no GitHub in it**, and safety never rests on a code host's
  permissions ([North Star first](./north-star-first-harden-later.md)).
- **Data first** ([markdown is a view](./data-first-markdown-is-a-view.md)):
  state is folded from facts on every read, so a peer that receives new lines
  just folds again.

## What it asks of the work being done now

- **Every fact says who wrote it**: which person, and which of their agents.
  That is needed solo too ("you approved" is not "an agent approved"), and it
  is the first step toward signed lines.
- Claims, asks and the desk keep talking only to the `Ledger` service, never to
  the file under it.
- Nothing else moves early. The real run comes first.
  *Changed 2026-10-25: two people sharing one fabrika, with their agents
  talking across two machines, is now a core goal, so the shared ledger moves
  early. See [the ledger goes to Cloudflare](./the-ledger-goes-to-cloudflare.md).*

## Open

- **Ours or an existing one.** Hypercore and Automerge are the closest existing
  pieces; Linear, Replicache, Electric and Jazz show the shape as products.
  None is built for agents (signed per agent, leases on work). Before building
  our own, test the closest one on the hard case, a lease on a claim. The sync
  engine sits behind a protocol either way.
- How keys are given out and taken back, for people and for agents.
- Who sees what: one team's lessons should not sync to another team's peers.
- Search over a log, and how stale knowledge gets marked as replaced.
- What "always online" means for the referee when the team is small.
