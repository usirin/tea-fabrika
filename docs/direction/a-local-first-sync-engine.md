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
const solo = diskLedger("~/.tsh/ledgers/github/acme/app.jsonl"); // built 2026-10-19
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

- **Two ledger backends, and no more.** A team's ledger is a Durable Object:
  one request at a time makes it the referee for free, and it brings SQLite,
  alarms (a lease running out) and sleeping WebSockets (the live tail). A solo
  ledger is a local file, so a person alone needs no infrastructure. Anyone
  who wants a team without Cloudflare runs the same Durable Object bundle on
  a self-hosted runtime (workerd, celld); that is not a third backend.
- **The local ledger moves to SQLite, with the same SQL as the Durable
  Object.** The journal table, the compare-and-set append and the lease
  query are one piece of code with two drivers. SQLite is still just a file;
  its locks die with the process (no stale lock file), a compare-and-set is
  one transaction, a crash cannot tear the last line, and reads use indexes
  instead of replaying everything. A dump to JSONL is the view for reading
  it by eye.
- **One law suite runs against both:** many claims at once, kills, restarts,
  lease expiry.
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
