---
state: "vision; ledger runtime decided; 2026-10-30: central first and one ephemeral lane, at-most-once (show it, never save it, never decide with it) decided; transport and data decided 2026-10-30, coordination 2026-10-31; 2026-10-31: five layers, not four, and every window dials the brain itself (T3 changed); the first pass's standard per layer replaced, marked in the note; 2026-11-07: a wait never blocks, it answers ready or parked, then a ring (from the owner's call of 2026-11-02); 2026-11-09: in libfabrika a folder is one subject and its layer is a rank in the rule file ([0043](../../.decisions/0043-rooms-on-floors.md)), named module and layer 2026-11-10 ([0091](../../.decisions/0091-modules-and-layers.md))"
summary: "Signed append-only logs that hosts sync, with leases for one-writer work. The ledger is the first log on it; solo is a team of one. The ledger is one Durable Object everywhere: on Cloudflare for a team, in Miniflare on a laptop (experiment 93), restarted when its memory passes a cap. First step now: every fact says who wrote it. Five layers, bottom to top: transport (one WebSocket per client, to its own gateway; JSON-RPC 2.0; a signed hello with versions; a text ping), data (the ledger: append, read, wait; poke, then pull), coordination (claims, inboxes, the process tree, following OTP), app and desktop; central first, and a browser is always a client. This note holds the lower three (T1 to T8, D1 to D6, C1 to C5)."
---

# A local-first sync engine is the base

**Part decided, part a vision. Not built.**

- **Decided 2026-10-19:** [one ledger, a Durable Object, everywhere](#decided-2026-10-19),
  and the local host around it.
- **Decided 2026-10-30 and 2026-10-31:** [the five layers](#decided-2026-10-30-and-2026-10-31-five-layers-central-first),
  and layers 1 to 3 written down here: transport (2026-10-30, T3 changed 2026-10-31),
  data (2026-10-30) and coordination (2026-10-31). They are planned: Tier 1 builds them
  ([Tier 1](../plan/tier-1.md)).
- **Still a vision, not planned and not sized:** [the picture](#the-picture) of hosts
  that sync by gossip, [why the design already allows it](#why-the-design-already-allows-it)
  and [open](#open). [The hard part](#the-hard-part-a-claim)'s leases were decided
  central first, as layer 3's C3. The first pass's W3C `traceparent` stays proposed.
- **Renamed 2026-11-10 for `next/`:** the per-client gateway object is now a connection, and the door is the gateway ([0051](../../.decisions/0051-gateway-connection-and-node-by-job.md)).

*Written 2026-11-05: this header said the whole note was "a vision ... not planned,
not sized", which was wrong for the parts above since 2026-10-19 and 2026-10-31.* It
was written down 2026-10-19 as a vision, so that what gets built now does not close
the door on it.

Keys renamed 2026-11-03 (short words keep one meaning): `at` became `location`.

*Changed 2026-10-31: the layers under it are decided. fabrika has five
layers: transport, data, coordination, app and desktop. The lower three are
written down here, in
[five layers, central first](#decided-2026-10-30-and-2026-10-31-five-layers-central-first).*

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
  wrote it, hosts that sync by gossip, and a lease for anything that needs
  one writer. It runs on a laptop, in a Cloudflare Durable Object, anywhere.
- **Middle, many logs.** fabrika's ledger is one. A team's shared knowledge,
  agent traces, and others are just different kinds of lines.
- **Top, views.** The owner's desk, Tuval, search, analysis. Every host has
  all the state, so each person runs their own.

```ts
// The same Ledger service; only the Layer under it changes.
const solo = layerSqlite({ path: "~/.tsh/ledgers/github/acme/app.sqlite" }); // built 2026-10-21
const team = syncedLedger({ log: "acme/app", hosts, referee });  // the vision
```

**Solo is a team of one.** Designing for a team covers the solo case for free;
the reverse is not true.

## The hard part: a claim

Sharing facts is easy: if two hosts add the same harmless line, nothing
breaks. A claim is different. Two agents on one ticket is real money spent
twice. A claim needs "add this only if nothing new came in first", and gossip
has no single place that can say who was first.

- **Leases, not claims for ever.** A claim lasts some minutes and is renewed
  while the agent works. A dead lane's claim runs out by itself; nobody has to
  adopt it by hand, as today's fabrika needs.
- **A referee grants leases.** Any always-on host can be it; the team picks
  which one, and another takes over when it is gone (leader election, kept
  small). Inside a Durable Object, one request at a time makes the referee
  free.
- **During a split, no new leases.** A host cut off from the referee can read
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
  tea-host.
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
  *Changed 2026-10-31: in the new version, a `host` is a place hands can run (a
  Mac, a VM or a browser profile) and the brain runs programs. See
  [brain, hands, window, agent](./brain-hands-window-agent.md).*
- **Libraries checked first.** Effect's own event log and cluster modules do
  not fit (the first merges copies with no compare-and-set; the second needs
  one shared database every node reaches). No outside library has
  compare-and-set, leases, fencing and signed writers together. The closest
  journal is LiveStore's Cloudflare sync server; a short test decides whether
  it carries our journal or we copy its design.

## Decided 2026-10-30 and 2026-10-31: five layers, central first

The owner walked the architecture one layer at a time on 2026-10-30 and
2026-10-31. It ended with five layers. Each one uses only the layer below it.

*Changed 2026-11-09 (owner, [0043](../../.decisions/0043-rooms-on-floors.md)): in
`next/packages/libfabrika/src` the layers are no longer folders. A folder is one subject, a module,
and its rank is a library layer: a line in `layer-rules.json` that says which modules a module may
import. A library layer is not one of the five below. There is no `coordination/` folder; its files
sit in `processes/`, `presence/`, `access/` and `runtime/`, and `data/` is `ledger/` and
`telemetry/`. The five layers below stay as the way the design is told. Renamed 2026-11-10 (owner,
[0091](../../.decisions/0091-modules-and-layers.md)): 0043 said room and floor, which stay only as
the analogy.*

```ts
// A sketch. Bottom to top. Ticket #7, one line per layer.
//   desktop       tiles, focus, keys          a tile shows build:7's process
//   app           programs, Cmds, windows     build:7 asks the Mac for a git commit
//   coordination  online, inboxes, claims     build:7 holds the claim on #7
//   data          the ledger                  the line "build:7 claimed #7" is saved
//   transport     one pipe per client         the Mac's hands keep one WebSocket open
//
//   Mac hands --WebSocket--> gateway:mac --object call--> project, build:7, ...
//   VM hands  --WebSocket--> gateway:vm  --object call--> project, ...
//   a window  --WebSocket--> gateway:w1  --object call--> desk, fabsh:t1, ...
```

Where each layer is written down:

| Layer | Its decisions | Written in |
|---|---|---|
| transport | T1 to T8 | this note, below |
| data | D1 to D6 | this note, below |
| coordination | C1 to C5 | this note, below |
| app | A1 to A5 | [the cloud is one more host](./the-cloud-is-one-more-host.md#decided-2026-10-31-the-app-layer) |
| desktop | W1 to W5 | [the desktop layer](./the-desktop-layer.md) |

The three lower layers are the sync engine this note is about, so they live
here. The app layer lives with the brain and the hands, since it is built from
them. The desktop has a note of its own. Config for every layer is one
`fabrika.toml` kind, in `~/.fabrika/` and in the repo's `.fabrika/`
([one fabrika.toml per repo](./one-fabrika-toml-per-repo.md)).

**Rules for every layer, decided:**

- **The names.** The bottom layer is **transport**, not link: "link layer"
  means Ethernet and Wi-Fi, and MCP, libp2p and gRPC say transport. The middle
  layer is **coordination**, not nodes: in Erlang a node is a running machine,
  and Kafka and ZooKeeper say coordinator for the same jobs. Three things dial
  the brain: hands, a window and an agent. `client` means any of them at the
  door ([brain, hands, window, agent](./brain-hands-window-agent.md)).
- **A browser is always a client.** No protocol may need Node, a Unix socket,
  files or WebSocket-level frames
  ([protocols first](./a-browser-is-always-a-client.md)).
- **Central first.** Every client reads from the one ledger. Central makes
  what is on screen easy to trust, and a screen that gets sloppy is the sign
  to change it. The data layer's calls (`append`, `read`, `wait`) leave room
  for a local copy later.
- **One object per thing:** a program, a job record, a desk, a gateway per
  client. One shared project object holds the ledger, plus claims, inboxes and
  the process tree (80%).
- **Two places for records.** The ledger keeps facts that someone decides
  with, for good. Monitoring keeps how things ran. *Changed 2026-11-07 (owner):
  it said monitoring, through tea's otel, keeps health signals for about a
  week, on the Mac locally and in Cloudflare's log storage there.* Now:
  - **A process's spans** go to its JobRecord, kept forever
    ([a JobRecord holds its trace](./a-job-record-holds-its-trace.md)). They
    come from Effect's own `Effect.fn`, since tea 0.23.0's otel traces
    agent runs only. *Changed 2026-11-07 (owner): it said `Effect.withSpan`; see
    [`Effect.fn` for traced functions](./effect-fn-for-traced-functions.md).*
  - **Health has two levels.** Raw health rows (each ring, each renew) are kept
    about 2 weeks. An hourly summary per piece (counts, errors, slowest times,
    lag) is kept forever. Anything someone decides with stays a ledger fact
    forever. Why: the trend is kept without the bulk, as record wide asks. The
    industry keeps raw data short and rollups long: Graphite's retentions run
    "from most-precise:least-history to least-precise:most-history"
    ([carbon](https://graphite.readthedocs.io/en/latest/config-carbon.html)),
    and Thanos keeps raw, 5-minute and 1-hour copies, each with its own
    retention flag ([compactor](https://thanos.io/tip/components/compact.md/)).
    The 2-week raw window is a guess the first real month settles (75%).
  - **The same on both instances.** Our own records, read by our own programs
    (`trace`, `ps`, later a dashboard program), on the laptop and on
    Cloudflare alike. Alchemy's local stage has no trace viewer. Cloudflare's
    own tracing is a second opinion, on the cloud only.
  - **What each piece records.** Every piece records RED: rate, errors and
    duration. Anything that delivers events also records consumer lag. For
    the ledger's doorbell: rings sent, reads per ring, each reader's lag
    behind the newest entry, and the time from a write to a reader seeing it.
  - **Each object records its own size**, `ctx.storage.sql.databaseSize`, as
    `{at, bytes}`, at most about once an hour and only when it is already
    awake. Why: Cloudflare shows a namespace's total, never one object's, and
    at 10 GB an object's writes fail with `SQLITE_FULL`
    ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).
    The log stays in the one project object (below; experiment 145). Moving
    old stretches of the log to R2, as Kafka's tiered storage (KIP-405) does,
    is a later-tier proposal, not decided.
- **Every question starts from local Miniflare** (workerd on the Mac), and
  Cloudflare is checked second. And every question asks of the data: what fact
  is lost for good if we do not record it now? A fact that exists only at write
  time goes in now; anything derived can wait, since it rebuilds from the log.
- **One ephemeral lane on the same transport,** for pokes ("come read"),
  presence (who is online, where) and fast streams such as terminal bytes.
  The names are the industry's: automerge-repo and Liveblocks say
  ephemeral, Replicache says poke, Supabase Realtime says broadcast and
  presence. Its delivery is at-most-once; a ledger send is at-least-once,
  made safe by its id. The doorbell already is one (`durable-object.ts`).
  The rule: **show it, never save it, never decide with it.** A window may
  draw who is online; no lane, claim or ledger write ever depends on a frame
  from this lane, so losing one breaks nothing. It is not local state: local
  state stays in one program on one computer, and this lane moves between
  computers. Neither goes in the ledger.

  ```ts
  // recorded: lands in the ledger, can be replayed
  {_tag: "send", to: "counter:1/inbox", id: "m-17", m: {type: "plus"}}
  // ephemeral: at-most-once, may be lost, nothing breaks
  {_tag: "poke", stream: "counter:1/inbox", rev: 41}
  {_tag: "presence", client, location: "tile:t1"}
  {_tag: "bytes", port: "tile:t1", data: "l"}
  ```

### Layer 1: transport (decided 2026-10-30; T3 changed 2026-10-31)

One two-way pipe between a client (a computer's hands, a window, an agent) and
the brain. Everything above rides on it: ledger writes, pokes, presence,
terminal bytes. Locally the brain is workerd on the Mac (Miniflare), with the
same objects and code as on Cloudflare. Only the URL changes: the Mac's hands
dial localhost, the VM's hands dial the Mac.

The wire has four steps. Any client speaks it.

```jsonc
// 1. Hello (T1, T2, T4, T5). The client dials its own gateway. The method is `initialize`, as LSP's
// and MCP's first request is (owner, 2026-11-05; this sketch said "hello"). "Hello" stays the plain word.
// client -> brain
{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
  "versions": [1, 2],          // every version it speaks
  "key": "ed25519:...",
  "signed": "...",             // the hello, signed with that key
  "has": ["git", "files", "agents"],
  "ping": "30s"}}
// brain -> client
{"jsonrpc": "2.0", "id": 1, "result": {
  "version": 2,                // the highest shared version
  "ping": "30s"}}              // clamped to the brain's min and max

// 2. Liveness (T6). Plain text, answered by the gateway without running its code.
//    client -> brain "ping", brain -> client "pong"; every 30 s; no pong in 10 s = dead, reconnect

// 3. Everything else (T8). A Cmd is a request; news is a notification, with no id.
{"jsonrpc": "2.0", "id": 7, "method": "git.push", "params": {"branch": "feat/x"}}
{"jsonrpc": "2.0", "id": 7, "error": {"code": 1, "message": "rejected", "data": {"why": "stale"}}}
{"jsonrpc": "2.0", "method": "ledger.appended", "params": {"rev": 412}}
```

```ts
// 4. Drops (T7). Retry once at once, then back off. Once back, catch up from the last rev seen.
const backoff = Schedule.min([
	Schedule.exponential("250 millis").pipe(Schedule.jittered), // each wait 80 to 120%, at random
	Schedule.spaced("30 seconds"), // never more than 30 s
]);
const reconnect = Schedule.recurs(1).pipe(Schedule.andThen(backoff));
connect.pipe(Effect.retry(reconnect));
```

- **T1, who dials:** the client always dials the brain, locally and on
  Cloudflare. A Worker cannot dial a laptop. Tunnels, polling and a private
  network were looked at; each still dials out underneath.
- **T2, how many pipes:** one WebSocket per client, to its own gateway object,
  which passes each message on to the right object with an object-to-object
  call. Pokes come back the same way. Every message names its tile, as
  `link.ts` does today: `{port: "tile:t3", m: {type: "keys", data: "l"}}`.
  - No terminal objects. A real shell (zsh, an agent's screen) is a process
    the hands own. Its bytes go window to brain to hands on one computer, or
    gateway to gateway across computers, never saved. The shell (`fabsh` in `next/`, named 2026-11-01) is a program, so it
    is a program object.
  - Only tiles on screen stream. Five workspaces with 20 tiles cost about
    what 4 visible tiles cost. Hidden tiles keep running and send nothing; a
    newly shown tile asks for one redraw, then a live stream, as tmux does.
- **T3, the window (changed 2026-10-31, 80%):** every window is a client and
  dials the brain over its own WebSocket, the Electron window too, the same as
  a browser tab. It signs its hello with its own key (T5; in Electron the key
  lives in the macOS Keychain). The brain checks the page's origin, so a
  website cannot open a socket to the local brain (cross-site WebSocket
  hijacking). Keys go window, brain, hands, shell; check them against
  [experiment 143](../../experiments/143-typing-latency.md)'s typing bar. The
  hands still run as a login service (launchd through SMAppService on the Mac,
  systemd on the VM) and own the local brain's life. The menubar is required,
  and Quit there stops the service.
  *Changed 2026-11-01, from [Tier 1's plan](../plan/tier-1.md), approved the same day
  and not built: Tier 1 has no hands, and the Electron app starts the brain itself as a plain
  launchd service, so nothing starts at login. The menu bar is part of that app. Quit
  stops the brain. Whether hands still run as a login service is for Tier 4.*
  - ~~The window talks only to its own hands, over a Unix socket~~ **Replaced
    2026-10-31.** [Experiment 172](../../experiments/172-hands-restart-time.md)
    leaned that way at 85%: a hands crash costs 0.4 to 0.8 s until the window
    is back and caught up. The number still holds; the window now reconnects
    to the brain instead.
- **T4, versions:** the hello lists the versions a client speaks; the brain
  speaks the current and the previous one and picks the highest shared, as
  Kafka does. Changes inside a version are additive only, and unknown fields
  and kinds are ignored. A schema diff in CI fails a breaking change without a
  version bump (like `buf breaking`). The brain deploys first; the window
  forces updates.
- **T5, identity:** one key pair per client signs the hello. The person's key
  grants each new client, as `fabrika post` grants agent keys today; revoking is
  one ledger entry. Nothing joins without its person saying so (Signal's
  linked devices, Tailscale's node approval). *Added 2026-11-05 (owner):* the person key
  signs each grant in SSHSIG's shape, and no key is ever let in because GitHub lists it
  ([a key per client](./a-key-per-client-and-no-github-trust.md)).
- **T6, liveness:** a text ping every 30 s, answered by the gateway's
  auto-response. The brain never checks on a timer; presence reads the last
  ping when asked, away after 75 s.
- **T7, drops (85%):** retry once at once, then exponential backoff with
  jitter, capped at 30 s. Catch up by revision. State changes wait in an
  outbox with ids; throwaway messages drop. The knobs live in `[transport]`.
- **T8, messages (75%):** JSON-RPC 2.0, as MCP, ACP and LSP use. A Cmd is
  `method` and `params`; ok is `result`; err is `error.data.why`; news is a
  notification. Cancel and progress copy MCP's notifications. CloudEvents was
  ruled out: it is one-way only.

What local Miniflare gives us, from our own experiments:

- WebSockets held by an object, asleep or awake: yes, the hibernation API
  runs locally ([experiment 96](../../experiments/96-ledger-mailbox.md)).
- An object going to sleep by itself: not seen locally; a test forces it with
  `ctx.abort()` ([experiment 148](../../experiments/148-remote-programs.md)).
- Restarts: about 12 to 17 a day at 500 MB of memory, and every connection
  drops ([experiment 93](../../experiments/93-ledger-miniflare.md)). That
  reconnects one socket per client, far below the limit of 200 opened at once
  that get reset. Reconnecting is the normal path, after a small random wait.
- Speed: an object call answers in about 10 ms (experiment 148).

**Open in transport:** the extra hop through the gateway on Cloudflare is not
measured (a keystroke-echo test would measure it). JSON-RPC's weight per
message is not measured. ~~How a browser gets its grant is open (lean: a QR code
from the Mac).~~ *Settled for `next/` by [Tier 1's plan](../plan/tier-1.md), approved 2026-11-01 and not built:* the
menu bar's row, Approve and a finger, on both instances; QR is in Tier 7. The owner already picked
two pieces of it: the menu bar in the first slice, and keeping the one-time link. Background browser tabs slow their timers, which may make a tab
look away.

### Layer 2: data (decided 2026-10-30)

The ledger is one log per project, kept in the project object, with three
calls. Writers append lines with an id, so a resend is saved once. Readers ask
for everything after a revision, or wait for the next one. It is the same on
the Mac and on Cloudflare: SQLite inside one object.

```ts
interface Data {
	append(stream: string, id: string, event: unknown): Effect.Effect<Rev>; // saved once, even if sent twice
	read(stream: string, after: Rev): Stream.Stream<Entry>;
	wait(stream: string, after: Rev): Effect.Effect<Waited>; // answers at once: ready, or parked until a ring
	// Wrong, changed 2026-11-07: wait(stream: string, after: Rev): Effect.Effect<Rev>; // the doorbell
}

// D3: one entry, EventStoreDB's fields in our short words, plus the writer's own time.
// The two clocks renamed by the owner 2026-11-05: `at` became `arrivedAt`, `said` became `sentAt`.
{
	id: "e-91",        // the writer's id: a resend is saved once
	stream: "build:7",
	pos: 3,            // place in its stream
	rev: 412,          // place in the whole log
	arrivedAt: "23:12:04", // the referee's clock, when it reached the ledger: leases, limits and order use only this
	by: "mac@owner",   // stamped by the door from the signed-in key
	sentAt: "23:10:01",    // the writer's own clock, when it wrote it: shown, never used to decide
	_tag: "claimed",   // `kind` until Tier 1's approval, 2026-11-01; today's code keeps `kind`
	body: {lease: "30s"},
}
```

*Changed 2026-11-07, from Tier 1's P6, building the owner's call of 2026-11-02 that a
wait is data ([Tier 1's detail, Cloudflare](../plan/tier-1-detail.md#cloudflare)): a
wait never blocks. It answers at once, `{_tag: "ready", rev}` with the stream's newest
rev, or `{_tag: "parked"}`. A parked wait leaves a ring, a row in the project object's
own SQLite, and the first append past its `after` rings the waiter once. It said `wait`
returns a `Rev` when news comes, a call that waits, which was wrong: an object sleeps
after about 10 s and drops what waits in memory.*

- **D1, who decides a race (2026-10-19):** the project's Durable Object is
  the referee. It handles one call at a time, so a claim checks and writes in
  one step: compare-and-set plus a lease
  ([experiment 110](../../experiments/110-one-ledger-for-the-pipeline.md):
  race 50 of 50, a stalled holder fenced 75 of 75). `append` stays plain, with
  the id check only. A conditional append waits for a case that needs it.
- **D2, streams:** one log per project, with named streams inside it
  (`build:7`, `desk`). Claims and inboxes are streams too.
- **D3, one entry:** as above. Each kind has its own Effect Schema and grows
  additively (T4); a reader skips a kind it does not know and keeps it.
  `sentAt` is in from day one, since a fact not recorded at write time is lost
  for good. The referee's code gets entries without it, so nothing can decide
  with it.
- **D4, hearing news:** poke, then pull (Replicache's shape). The brain sends
  `ledger.appended` with `{rev, streams}` on the ephemeral lane, at most once;
  the client pulls with `ledger.read` after the last rev it has. A lost poke
  costs nothing: the next poke or the reconnect catch-up pulls the same
  entries. Every client hears every poke in its project; per-stream
  subscriptions wait, since nothing is lost by adding them later. ~~`wait` stays
  for code that wants to block.~~ *Changed 2026-11-07: `wait` stays, and never
  blocks (above).*
- **D5, a local read copy:** later. Central first; the three calls leave
  room for a copy on each client, a browser too.
- **D6, the services:** today's `Ledger` (about 25 methods, all three layers
  mixed) splits into small services, one Effect Layer per level. A service
  name is never plural; one that holds many of a thing is `<Thing>Manager`. *Changed 2026-11-09:
  one that holds many is plural, as Effect names them (`Leases`;
  [0029](../../.decisions/0029-format-and-names-follow-effect.md)).*

  ```ts
  // data
  Ledger           append, read, wait
  // coordination: one Layer bundles the four
  Registry         register, whereis
  Mailbox          send, receive
  LeaseManager     claim, renew, release
  ProcessManager   start, exit, link, monitor, trapExit, info
  // app
  LimitManager     hold, charge, setLimits, usage   // A2
  ```

  Every table except the log is a view rebuilt from it; a test drops the
  views, replays the log and compares. Today some facts live only in
  overwritten rows, and each becomes an entry: process wiring (monitors,
  links, trap exit), logins after the first (who and when; the credential
  hash stays out), and a job's state slots. Stream names stay as experiments
  97 to 99 set them, with the dead-letter change below: a name owns `build:7`
  and `build:7/inbox`; only its lease writes the name's stream, and the inbox
  is the one open door. Each process start has `<pid>/dead`, written only by
  the brain.

### Layer 3: coordination (decided 2026-10-31)

The jobs that live on the ledger: claims, inboxes, the process tree, and who
is online. Claims, inboxes and the process tree live in the one project object,
because a crash changes all three at once.
[Experiment 145](../../experiments/145-many-objects.md) split them and broke 11
of 27 rules. Who is online is read from the gateways' last ping (T6), never
written, so it needs no table.

```ts
// A sketch. An agent goes over its limit. The app decides; coordination writes all three in one step.
yield* ProcessManager.exit("build:7", {why: "limit", charge}); // C1
//   -> the charge, build:7's exit, and mail in its parent's inbox: one write, or none
// A message that crashes its reader 3 times moves aside (C2):
const pid = "process_01jc9q4w7z3m8n5r2t6v0xkb4f";
{stream: `${pid}/dead`, _tag: "dead", body: {
	process: pid, program: "build", name: "build:7",
	tries: 3, limit: 3, m: "m-17", build: "build-a",
	errors: ["TypeError", "TypeError", "RangeError"],
}}
```

- **C1, stopping a job together with a note:** when the app sees an agent
  went over its limit, three things land at once: the charge, the job's exit,
  and mail to its parent. The app decides, then makes one call. Coordination
  never knows what money is; to it, an agent is one more running job.
- **C2, mail delivery:** at least once. After N crashes on one message, it
  moves to `<pid>/dead`, recording its process, program, registered name,
  tries, limit, letter id, build and each throw's error class. A message can
  arrive twice, so a job must handle a repeat. N is the delivery limit, 3 by
  default and from 1 to 32: the program's own `maxDeliveries` in its
  declaration wins, else the trusted wiring's `Policy.maxDeliveries`.
  *Fixed 2026-11-09 to match P34 ([PR 535](https://github.com/usirin/tea-fabrika/pull/535)).
  It said: N comes from `[coordination] max_deliveries = 3`, a config key the
  code does not have.*
  Owner decided 2026-11-08: one stream per process start, `<pid>/dead`; each entry carries `process`, `program` and `name`.
- **C3, leases (2026-10-25; renew logging 2026-10-31):** a claim lasts 30 s
  and is renewed every 10 s, a third, as etcd's keepalive. An old holder stays
  valid until a newer claim exists (Kafka's epoch rule), so a wrong clock
  cannot lose a job. Renews go to monitoring, never to the ledger. The ledger
  records only when a claim changes hands: claimed, expired, resumed,
  released.
- **C4, restarts:** keep the existing supervisor
  (`packages/fabrika/src/host/supervisor.ts`, experiments 99 to 102): OTP's
  strategies, restart types, restart intensity with escalation to the parent,
  Kubernetes-style backoff, and limits. Each restart is an entry.
  *As built 2026-11-09 (P34, [PR 535](https://github.com/usirin/tea-fabrika/pull/535), `next/`):*
  Tier 1 has no process that starts another, so P34 built a one-child
  supervisor in `next/packages/libfabrika/src/app/supervisor.ts`, rethought and
  not ported. It restarts the one crashed program inside an intensity window
  (5 in 5 s by default), with doubling backoff (100 ms to 800 ms). Past the
  brake it writes `down` with its `until`, and tries again then; nothing
  escalates to a parent. Strategies, restart types and escalation wait for
  Tier 4 ([Tier 1's slice](../plan/tier-1.md)). The decision above stands.
  *Amended 2026-11-09 (owner, [0016](../../.decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md)):*
  Tier 1's supervision is OTP's top-level supervisor. One root per brain, its children the
  brain's named programs, `one_for_one`, child specs with OTP's restart types, and OTP's
  intensity and period (1 in 5 s) unless a reason is written. A restart is at once: no
  Kubernetes-style backoff. Past intensity the root stops its children and itself; the brain marks
  the name `failed`, logs it and asks the person, and only a person restarts it. The `down {until}`
  retry above goes. P34c builds it. Sibling strategies, nested trees and links still wait for Tier 4.
  *Amended 2026-11-09 (owner, [0018](../../.decisions/0018-one-application-per-program.md)):* not one root per brain. Each program is its
  own OTP application with its own top-level supervisor, under the brain as the node. Past
  intensity only that program stops and asks the person; every other program keeps running. Fault
  isolation per program is required from the first version.
- **C5, which OTP calls stay:** coordination sits where OTP sits, so it
  follows OTP: registry, mailbox, links, monitors, trap exit, supervisors. A
  difference from OTP needs a written reason. A check that ours matches OTP is
  still owed, since experiment 99 came before experiment 107.
  *Done 2026-11-09 for Tier 1's slice: [experiment 239](../../experiments/239-supervision-vs-otp.md),
  with tickets 404 to 406 for what it found.*
  *Amended 2026-11-09 (owner, [0016](../../.decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md)):*
  each difference from OTP's supervisor is written with its reason in two places, here and in the
  opening table of P34c's plan. A reason comes from Durable Objects or from
  [a browser is always a client](./a-browser-is-always-a-client.md); code already written is not one.
- **The desk keeps its name;** workspaces are the numbered layouts inside it.
- **Limits** (money, turns, seconds, tokens) moved up to the app layer as
  `LimitManager` (A2).

Carried into the rebuild: today's code differs from OTP in six places, and the
new code fixes all six.

- A watcher that dies drops its monitors. `DOWN` gets a `to` field, as `EXIT`
  has, so a stale `DOWN` never lands in the restarted process.
- Linking to a process that is already gone writes an `EXIT` with
  `why: "noproc"`.
- A parent's `EXIT` ends the supervisor with the parent's reason, not always
  `shutdown`.
- `demonitor` can flush a `DOWN` that is already in the inbox.
- Ending a temporary child drops its spec.
- The restart window counts a restart that lands on its edge, as OTP does.

Two differences stay, each with its reason written in the code: names are
never freed (a name is a stream, and the log keeps every stream), and only the
parent sends exit signals (a job cannot kill a job it does not own).

Five more differences stay in `next/`. [Experiment 239](../../experiments/239-supervision-vs-otp.md)
found them with no written reason; these are the reasons. Paths are under
`next/packages/libfabrika/src/`.

- **The supervisor lives inside the program's own object,** not in a process of its own. It is a
  tea machine (`app/supervisor.ts:59`) that the runner steps (`app/runner.ts:310-431`). Its
  receipts and its pending action are saved in that object's own SQLite
  (`coordination/recovery-store.ts:18`), beside the step they guard, and it saves the pending
  action before it acts, so an eviction at any point resumes from what was saved. Its backoff and
  `down` deadlines sit on the object's one alarm (`app/runner.ts:292`). A supervisor elsewhere
  would keep that state one hop away from the step. C4 says why there is one child.
  *Walked back 2026-11-09 (owner, [0016](../../.decisions/0016-tier-1-supervision-is-otps-top-level-supervisor.md)):*
  the supervisor becomes one root per brain, in the project object beside the process tree, so a
  restart is counted in the same transaction as the `exited` and `started` facts it causes. The
  receipts and dead letters stay in the program's object. P34c writes the new reason.
  *Amended 2026-11-09 (owner, [0018](../../.decisions/0018-one-application-per-program.md)):* one top-level supervisor per program, not one
  per brain, so one program's crash loop never stops another.
- **`demonitor` always flushes.** OTP keeps a queued `DOWN` unless the caller asks for `flush`
  ([`demonitor/2`](https://www.erlang.org/doc/apps/erts/erlang.html#demonitor/2)). Here a
  canceled watch's `DOWN` is dropped every time (`coordination/process.ts:423-429`): once the
  watch is canceled, that `DOWN` serves nobody.
- **A `DOWN` is a letter, not a separate signal.** It lands in the inbox under a signal id that
  only the brain may write (`coordination/process.ts:61-72`, `:183-184`, `:415-430`). So there is
  one durable stream, kept like any other, and a browser reads its `DOWN`s from
  `client:<id>/inbox` like any letter. A browser has no pid and could not take an OTP signal.
- **No selective receive.** Every letter reaches the program in inbox order; none waits in the
  inbox for a later match. That is Elm's shape: one `update` takes every Msg
  ([Elm first](./elm-first.md)). A program may still say no to a letter with `refuse`, but it
  cannot leave one for later.
- **Exit is a fenced `brutal_kill` in Tier 1.** There is no shutdown timeout and no terminate
  step: `exited` is written at once (`coordination/process-manager.ts:182-214`). Steps run one at
  a time under one permit (`app/runner.ts:224`), and a retired process's later writes are refused
  (`door/door.ts:1350`, `:1356`), so nothing lands half-written. The doubt: once an agent run is
  a Cmd (Tiers 4 and 5), an exit mid-run may need a graceful stop that tells the agent to end and
  records what it cost. Nothing in Tier 1 runs one, so this is checked again then.

### What the first pass proposed, and what became of it

The first version of this section (2026-10-30) said four layers named link,
data, nodes and app, and proposed a standard per layer. The walk settled each
one. The guesses that did not hold stay here, marked.

- **Split today's `Ledger` by layer** (proposed, 80%): decided as D6.
- **A local read copy later** (proposed, 70%): decided as D5, later.
- **Messages change state; RPC only asks the hub** (proposed, 85%): kept in
  spirit. A change is a message with an id, written to the ledger; a Cmd is a
  JSON-RPC request (T8). No live callbacks across computers.
- ~~"Down" is written once, when a socket closes~~ **Wrong, 2026-10-31:**
  who is online is read from the last ping, never written (T6).
- ~~JSON lines on a Unix socket for the local app~~ **Replaced 2026-10-31:**
  every window dials the brain over a WebSocket (T3).
- ~~The subprotocol `fabrika.v1`~~ **Replaced:** the hello lists versions (T4).
- ~~SSH keys as identity~~ **Replaced:** a key pair per client signs the hello
  (T5). On a Mac it may still be an SSH key file; in a browser it is WebCrypto.
- ~~WebSocket ping and pong frames~~ **Wrong:** browser JavaScript cannot
  send a ping frame. A text ping instead (T6).
- ~~CloudEvents for the message shape~~ and ~~Effect RPC for asking the
  hub~~ **Replaced:** JSON-RPC 2.0 (T8).
- **W3C `traceparent` in each message** (proposed, 85%): not walked. Still
  proposed.
- **No direct calls between clients** (proposed, 80%): holds. Clients meet
  through the brain (T2).

**Cost and how sure.** The layers are a map for the rebuild, not code yet. The
decision log puts the transport at 75 to 85% per decision, the object layout at
80%, the T3 change at 80%. The biggest doubt is the extra gateway hop on
Cloudflare, which a keystroke-echo test would settle.

### What the five layers cannot tell us

- None of the new layer code is built. The numbers come from experiments 93,
  96, 110, 145, 148, 172 and 173, each run on Miniflare, not on Cloudflare.
- How a window feels when every key goes window, brain, hands, shell. That is
  experiment 143's question again, with one more hop.
- Whether one project object stays fast enough for a busy repo with many
  agents (see [the cloud is one more host](./the-cloud-is-one-more-host.md)).

## Why the design already allows it

- **The `Ledger` is a service** ([the ledger behind a
  service](./ledger-behind-a-service.md)) with three calls: `append`,
  `appendAfter` (add only if the ledger still ends where you last read) and
  `entries`. The memory and disk versions already share them; a synced one
  would be a third.
- **The `Ledger` has no GitHub in it**, and safety never rests on a code host's
  permissions ([North Star first](../../.decisions/0324-security-follows-the-goal.md)).
- **Data first** ([markdown is a view](./data-first-markdown-is-a-view.md)):
  state is folded from facts on every read, so a client that receives new lines
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
- Who sees what: one team's lessons should not sync to another team's hosts.
- Search over a log, and how stale knowledge gets marked as replaced.
- What "always online" means for the referee when the team is small.
