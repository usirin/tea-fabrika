# The ledger goes to Cloudflare, for two people

**Proposed 2026-10-25.** Nothing here is built or deployed. The answer first:
put Cloudflare Access in front of one Worker, let the Worker stamp who wrote
each fact from the login, and give each repository one shared Durable Object.
Each person's desk stays on their own laptop. The ledger can split into one
object per lane later, and the code keeps that door open (section 9). The
first build step is the stamping, run locally in Miniflare. Nothing gets
deployed before that.

```ts
// A sketch. The whole idea: the login decides the writer, never the request body.
//
//   laptop (owner)   host ──┐                          ┌── Durable Object "acme/app"
//                           ├── HTTPS + WebSocket ──▶ Worker ─┤   tickets, asks, lanes, beats
//   laptop (second)  host ──┘    Cloudflare Access     (the door) └── R2: agent logs, by hash
//
//   each laptop keeps its own desk, tiles and history in its local ledger.

// At the door, before any ledger call:
const who = yield* door.check(request); // Access JWT → {kind: "user", id: "p2"}
//                                         service token → {kind: "agent", id: "p2.triage", for: "p2"}
ledger.append(stream, rev, {...event, writer: writerText(who)}); // the body's own `writer` is dropped
```

## What is already decided, and not argued again here

- One ledger, a Durable Object everywhere: Cloudflare for a team, Miniflare on
  a laptop ([the sync note](./a-local-first-sync-engine.md), decided
  2026-10-19).
- The ledger is a service, and it is tea-host's
  ([the ledger behind a service](./ledger-behind-a-service.md),
  [tea-host](./tea-host.md)).
- Tickets are facts in our own tracker, and only people on the ledger write
  them ([tickets start in our tracker](./tickets-start-in-our-tracker.md)).
- Which ledger a repository uses is `[ledger] at` in its `fabrika.toml`
  (experiment 107). Two people on one repository pick the same one.
- The host runs apart from the app, and everything the app keeps sits on the
  host's ledger
  ([the GUI note](./the-gui-is-electron-first.md#decided-2026-10-25-later-tuval-and-tmux-decide-the-host-runs-apart)).
  This note leans on that work and does not change it.

## What exists today, and what it lacks for two people

| Piece | What it covers | What it lacks for two people |
|---|---|---|
| `host/durable-object.ts` | The `Ledger` class: claims, fenced appends, inboxes, the alarm, OTP's calls, limits. A WebSocket tail that sleeps with the object. A plain HTTP face, `POST /<ledger>/<method>`. | No login at all. Every method is open to anyone who can reach it. `writer` and `holder` are arguments the caller fills in. Never deployed. |
| `host/rules.ts` | All the SQL, shared with node:sqlite. Refuses the ledger's own words (`DOWN`, `exited`) from callers. | It trusts the `writer` text it gets. No table of who may write which kind of fact. |
| `host/http.ts` | `layerHttp`: a `Ledger` over HTTP, a small pool, a 3 s timeout, and the doorbell (a WebSocket that rings on each write and on each reconnect). | Sends no login. Ready for a remote URL in every other way. |
| `host/local.ts`, `daemon.ts` | The Durable Object in Miniflare, in its own process group, restarted past 500 MB. | Serves on 127.0.0.1 with no login. Fine for one person, not as a shared door. |
| `host/sqlite.ts` | `layerSqliteSync`, what the fabrika app uses today. Sees other writers by polling. | One file on one laptop. Nobody else can reach it. |
| `host/ledger.ts` | The service, its tagged errors. `LedgerUnreachable` already says "send it again with its id". | Nothing for "who am I", which a host needs to stop picking its own writer. |
| `host/writer.ts` | `Writer`: `{kind: "user" \| "agent", id}`, stored as `user:<id>` or `agent:<id>`. | No link from an agent to its person. Nothing proves the text. |
| `programs/tracker` | Tickets as facts. Reads `by` from the row's `writer` column, never from the fact's body. Polls once a second. | Its `Author` service is filled by the host, and today the app hard-codes `{kind: "user", id: "owner"}` (`apps/fabrika/src/host.ts`). |

- **Has the Durable Object ledger ever run on real Cloudflare? No.**
  Experiment 93 says "Not run on Cloudflare itself". Experiments 94, 96, 98, 99,
  100 and 102 each list "a deployed Durable Object" as not done, and the host
  README lists it under "Not in it yet". There is no `wrangler` config in the
  repo. Every latency we have is workerd on 127.0.0.1, about 2 ms a call.
- **The good news.** The tracker already reads the writer from the row, not
  from the fact. So if the server stamps the row, the tracker needs no change
  to show the truth.

## 1. Who may reach it

```ts
// A sketch. The door: one check at the top of the Worker's fetch, before any ledger call.
const AccessClaims = Schema.Struct({
	aud: Schema.String, // must be this app's AUD tag
	iss: Schema.String, // must be the team's domain
	email: Schema.optional(Schema.String), // a person's login
	common_name: Schema.optional(Schema.String), // a service token's id (to check: see below)
});

const check = (req: Request) =>
	Effect.gen(function* () {
		const jwt = req.headers.get("Cf-Access-Jwt-Assertion");
		if (jwt === null) return yield* Effect.fail(new NoLogin());
		const claims = yield* verify(jwt, {jwks: `${TEAM}/cdn-cgi/access/certs`, aud: AUD, iss: TEAM});
		return yield* members.writerOf(claims); // unknown to the ledger → NotAMember
	});
```

- **Access in front, and the Worker checks the token again** → lean.
  - Access checks the login before a request reaches our code, on every route,
    workers.dev included. It is one switch on a Worker since 2025
    ([Cloudflare changelog](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/),
    [blog](https://blog.cloudflare.com/workers-protected-by-access/)).
  - The Worker still checks the `Cf-Access-Jwt-Assertion` header against the
    team's public keys and the app's `aud` tag. Cloudflare's own guide says to
    do this and shows it in a Worker
    ([Cloudflare](https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/)).
    Two checks, so a route where Access is off by mistake still fails closed.
  - People log in with the identity provider Access is set up with. A command
    line client gets a token with `cloudflared access login` and sends it as
    `cf-access-token`
    ([Cloudflare](https://developers.cloudflare.com/cloudflare-one/tutorials/cli/)).
  - Agents and machines use service tokens: two headers, `CF-Access-Client-Id`
    and `CF-Access-Client-Secret`, under a "Service Auth" policy. Each token
    has its own expiry and can be rotated with a grace period
    ([Cloudflare](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/)).
  - Free for under 50 users
    ([Cloudflare](https://www.cloudflare.com/plans/zero-trust-services/)).
- **Our own login in the Worker** (GitHub OAuth, sessions in the object) →
  works, but we would build and keep session code that Access already gives.
- **One shared secret in a header** → cheapest, and wrong: it names no person,
  so nothing can be stamped from it. One leaked copy opens everything.
- **A private network** (WireGuard, Tailscale) → a Worker is on the public
  internet, so this does not fit Cloudflare. It fits the other branch of
  [the services note](./services-and-our-own-ci.md#open-questions): the
  ledger on our own always-on machine.
- **Client certificates (mTLS)** → strong for machines, heavy for people.
  Kept in mind for runners.

**Lean: Access in front, the JWT checked again in the Worker.** Why: it is
the industry's answer for a small team's internal app, it costs nothing at two
people, and it gives a real person's identity to stamp. Cost: one Cloudflare
Zero Trust setup, and the app needs a way to log in (below). **How sure: 85%.**
The doubt is the desktop login. `cloudflared` is documented. Having Electron
open the Access login in a window and read the `CF_Authorization` cookie is a
guess, and needs a try.

## 2. Who wrote a fact, proven and not claimed

Today the caller names its own writer. On a shared ledger, anyone holding the
URL and a login could write a fact under the other person's name. That
includes an answer in a box. The design need is that **the writer comes from
the login, and only from the login**.

```ts
// A sketch. Writer gains `for`: an agent always belongs to one person.
const Id = Schema.String.check(Schema.isPattern(/^\S+$/));
export const Writer = Schema.Union([
	Schema.Struct({kind: Schema.Literal("user"), id: Id}),
	Schema.Struct({kind: Schema.Literal("agent"), id: Id, for: Id}), // "p2.triage", for "p2"
]);

// Members are facts on the ledger, in their own stream. The owner adds a person; a person adds
// the token their agents use. The first owner comes from a Worker secret, once.
const Member = Schema.Union([
	Schema.Struct({type: Schema.Literal("member"), id: Id, login: Schema.String}),       // by the owner
	Schema.Struct({type: Schema.Literal("agents"), for: Id, token: Schema.String}),     // by that person
	Schema.Struct({type: Schema.Literal("left"), id: Id}),                              // by the owner
]);

// The kinds only a person may write. The door refuses them from an agent's token.
const PersonOnly = Schema.Literals(["answered", "approved", "ruling", "member", "agents", "left"]);
```

- **The server stamps; the body cannot.**
  - The door turns the login into a `Writer`. Every argument that names who
    is filled from it: `writer` on an append or a send, `holder` on a claim
    (as `<writer>@<host>`), `writer` on `register`, `cancel`, `setLimits` and
    `redrive`. Anything the body says there is dropped.
  - This is the common pattern. Firebase rules compare `request.auth.uid` to
    the data, so a client cannot write as someone else
    ([Firebase](https://firebase.google.com/docs/rules/rules-and-auth)).
    Zero (Rocicorp) checks the client's `userID` against the token's `sub`
    ([Zero](https://zero.rocicorp.dev/docs/auth)). Replicache's launch list
    says to check that a client id belongs to the logged-in user
    ([Replicache](https://doc.replicache.dev/howto/launch)).
  - The Durable Object never learns a login. It gets a writer from the
    Worker, which is the only thing that can call it. The local door in
    Miniflare stamps the one person who owns the laptop.
- **An agent writes under its person, and only agent facts.**
  - Each person's host holds one service token for that person's agents. The
    person adds it with an `agents` fact. The door maps the token to
    `{kind: "agent", for: <person>}`, and the host names which of its own agents
    it is (`p2.triage`). A host can name its own agents. It cannot name the
    other person, or the other person's agents.
  - This is the shape of OAuth's token exchange: a token that says who acts
    (`act`) and for whom (`sub`), so the server knows "this is not the user
    itself" ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693)). We get the
    same two names from Access, with no token server of our own.
  - **A person's answer needs the person's own login.** The door refuses a
    `PersonOnly` kind from an agent's token, so an agent's write of an answer
    fails at the door. It does not depend on a check inside the stage. The same
    goes for the box itself: an answer must name an ask that is still open.
  - The agent's box never holds either credential
    ([programs run in a box](./programs-run-in-a-box.md)). The host keeps
    both, and uses the person's login only on the path where the window
    sends an answer.
- **Signed lines come later.** The sync note's signed facts and
  [the services note](./services-and-our-own-ci.md#a-machine-joins)'s machine
  keys sit on top of this. With one referee on Cloudflare, the login stamped
  at the door is the proof. Signatures matter once facts cross peers with no
  referee between them.

**Lean: the door stamps every writer; agents get a token under their person;
answers need a person's login.** Why: a writer that the client picks can be
forged by any member, and the one place every write passes is the door. Cost:
`Writer` gains `for` (stored as `agent:<person>.<name>`, so old rows still
read). Each ledger method that takes a writer or holder takes it from the door.
`Author` stops being a choice: the host asks the door who it is. **How sure:
80%.** The doubt: the host holds both the person's login and the agent token,
so a bug in the host could send an agent's text down the person's path. Two
things would settle it: a law test that walks every way a write leaves the
host, and later a step-up check on answers (a fresh login for each yes).

## 3. What syncs and what stays on each laptop

```ts
// A sketch. One Ledger service for the host; names pick where a row lives, as mounts do on Unix.
const ledger = mounts({
	"tracker/": remote, // shared: tickets, comments, asks and answers
	"pipeline/": remote, // shared: lanes, claims, stage facts, inboxes
	"runs/": remote, // shared: each run's beats, in a side stream the ticket's fold never reads
	"members/": remote, // shared: who is on the ledger, and their agents' tokens
	"ci/": remote, // shared: jobs, results, machines (the services note)
	"desk/": local, // this person's tiles, workspaces, focus
	"tsh/": local, // each tile's job table, the line editor's history
	"host/": local, // the host's own kept programs: the desk, tsh
});
```

| Kind of fact | Where | Why |
|---|---|---|
| Tickets: filed, edited, commented, closed, reopened | shared | Both people work the same tickets. |
| Asks and their answers, a yes and the text it covers | shared | Either person may answer; the answer must be stamped. |
| Lanes, claims (leases), fences, released | shared | The referee must be one place, or two agents take one ticket. |
| Stage facts and inboxes (`pipeline/ticket/…`) | shared | The ticket's timeline is the lane's one view, for both. |
| A run's beats (`runs/<run>/beats`) | shared | One small row per step: turns, last tool, waits on a person or not. Either person sees what an agent is doing, from any machine, later. The ticket's fold never reads them ([PR 86](https://github.com/usirin/tea-fabrika/pull/86)). |
| A run's full log | shared, in `Blobs` (R2), by hash | "Open log" works from any machine. A log is MBs; a Durable Object row stops at 2 MB ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)). The ledger keeps only the hash. |
| Spend and limits per ticket | shared | A cap must hold across both people's agents. |
| Members, agent tokens, joined machines | shared | The door reads them. |
| CI jobs and results | shared | Any runner may claim a job. |
| Desk layout, tiles, workspaces, focus | this laptop | It is one person's screen. It must come back with no network. |
| Each tile's tsh jobs, history, scrollback | this laptop | Same. A tile's tsh runs on this host only. |
| A half-written comment | this laptop | Not a fact until it is sent. |
| Who is online now | neither, for now | Live only, never a fact. Later, if needed. |

- **Lean: shared work on the remote ledger, the screen on the local one.**
  Why: the desk must come back offline (the restore lane), and the second
  person has no use for the owner's tiles. Cost: one host now talks to two
  ledgers. **How sure: 70%.** See "where it disagrees" below.
- **A name lives wholly in one place.** So a claim, its fence and its appends
  never cross. A `read` across both places has no single order: `pos` counts
  per ledger. So a read names one place's prefix, and the mount refuses a read
  that would span both.

## 4. One shared ledger, or one per person with sharing

- **One Durable Object per repository, both people on it** → lean.
  - tsh already keeps one ledger per repository
    (`ledgers/github/<owner>/<name>.sqlite`), and `[ledger] at` is the
    repository's pick. Moving it changes the place, not the shape.
  - One object is the referee for free: one request at a time.
  - Who sees what is simple: everyone on the ledger sees all of it. The
    Access policy for the Worker and the `members` stream say who is on it.
- **One ledger per person, shared by sync** → the vision in the sync note.
  It needs signed lines, gossip and a referee elected among peers. Too much
  for the first two people. Kept open, behind the same `Ledger` service.
- **One Durable Object per ticket** → fits Durable Objects well (many small
  objects), and spreads load. But the list of tickets, a new ticket's number
  and spend across tickets would each need a call to many objects. Not until
  one object is too busy. Its soft limit is 1,000 requests a second
  ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)),
  far above two people. Section 9 weighs this branch in full.
- **One ledger for the whole team, all repositories** → one more prefix
  level, and one repository's agents read every other's facts. No gain at two
  people.

**Lean: one Durable Object per repository, shared by both people.** Why: it
matches what tsh and `fabrika.toml` already do, and the referee needs no
election. Cost: no per-ticket privacy. Everyone on a repository's ledger sees
all of it. **How sure: 80%.** The doubt is "who sees what" across teams in the
sync note. That is a question for a second team, not for a second person.

## 5. Offline, or when Cloudflare is slow

```ts
// A sketch. What the window is told. The tracker's `Shown` already has `unreachable`.
type Link =
	| {state: "live"} // the tail is open; news arrives as it lands
	| {state: "slow"; ms: number} // calls answer, past 1 s at p99
	| {state: "away"; since: number; waiting: number}; // no answer; `waiting` writes held, by id
```

- **The live tail becomes the WebSocket doorbell, not a 1 s poll.**
  - The pieces exist. The object holds sleeping sockets and sends a small
    `{stream, rev, pos}` note after each write. `layerHttp`'s `watch` rings on
    each note and on each reconnect. The tracker's `tail` reads from its own
    cursor. A lost or doubled note costs a read, never a fact.
  - The poll costs money once it leaves the laptop. One poll a second is
    86,400 requests a day per open tracker. Two people are 172,800 a day.
    That is past the Free plan's 100,000 a day, and the bulk of a Paid bill
    (section 7). A socket costs one request to open. Messages out are free.
    Messages in are billed at 20 to 1
    ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)).
  - Linear's client works this way: a socket for changes, then it fetches
    what it missed by sync id when it falls behind. Linear has not published
    this; it comes from people taking the client apart
    ([reverse-linear-sync-engine](https://github.com/wzhudev/reverse-linear-sync-engine)).
  - A deploy restarts every object and drops every socket
    ([Cloudflare](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).
    The doorbell already reconnects and rings once on reconnect, so a write
    made during the gap is read.
- **When the ledger cannot be reached:**
  - **The window shows it, plainly.** "Can't reach the ledger since 14:02;
    2 writes waiting." Tickets stay on screen as last read, marked stale.
  - **Writes wait and go again under the same id.** A send is already
    deduped by message id, so sending twice lands once. The tracker keeps
    them in its `saving` list today; they go out when the link is back.
  - **No new claim, no new agent.** The sync note's rule for a split: read and
    plan, start nothing. A running lane whose lease runs out is fenced, as it
    is today. A lane loses its ticket after about 30 s away (the claim's ttl).
    That is honest, and costs a restart of that lane.
  - **The desk still works.** It is on the local ledger.
- **When it is slow:** each call already times out at 3 s and fails as
  `LedgerUnreachable`. The window says "slow" past a p99 we pick after
  measuring, not before.

**Lean: the tail on the WebSocket doorbell, writes held by id, no new work
while away.** Why: the code exists, it is the industry's shape, and the poll
is what costs money. Cost: the tracker's poll Sub moves to `tail`. The window
needs one "away" banner. A lane can lose its ticket on a long drop. **How
sure: 80%.** The doubt is a laptop that sleeps: how often its socket comes back
broken. The experiment below measures it.

## 6. Moving today's tickets

```ts
// A sketch. One call, on an empty object, by the owner only. Rows keep their pos, rev, at and writer.
const Imported = Schema.Struct({rows: Schema.Int, last: Schema.Int, hash: Schema.String});
ledger.import(batch); // refused unless the object is empty, or `last` is the batch's first pos - 1

// The check, on both sides: same count, same last pos, same hash over every row in pos order.
const hash = sha256(rows.map((r) => JSON.stringify([r.pos, r.stream, r.rev, r.writer, r.kind, r.at, r.data, r.id])));
```

- **Stop, copy, check, switch.** There are no live leases to move if every
  lane has stopped first.
  1. The owner stops every lane. The host stops. The laptop's file is now
     still.
  2. A script reads `events` in `pos` order, and the other tables
     (`names`, `leases`, `jobs`, `monitors`, `links`, `migrations`) as they
     are.
  3. It sends them in batches to an `import` call on the new object. One
     JSON array per call, read with `json_each`, since a call binds at most
     100 values but a value may be 2 MB
     ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)).
     Each batch is one transaction. A batch that does not follow the last one
     is refused, so a retry cannot leave a gap or a double.
  4. Both sides give a count, the last `pos`, and a hash over every row in
     order. They must match.
  5. `[ledger] at` in `fabrika.toml` changes to the Worker's URL. The old
     file stays, read-only, as the backup.
- **Old rows keep their writer.** `user:owner` stays `user:owner`. The owner's
  `member` fact maps that id to the owner's login, so old and new rows name
  the same person.
- **A way back.** A Durable Object's SQLite can be put back to any point in
  the last 30 days
  ([Cloudflare](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)).
  Not in local dev. And the same SQL runs on node:sqlite, so the laptop file
  stays usable.
- **Pick where the object lives.** It is placed near its first request and
  never moves. A `locationHint` on that first call picks the region
  ([Cloudflare](https://developers.cloudflare.com/durable-objects/reference/data-location/)).
  The first call must come from the import, with the hint set between the
  two people. It must not come from a test made from somewhere else.

**Lean: stop, copy in `pos` order, check by hash, switch.** Why: a still file
and an exact copy cannot lose a fact. Cost: every lane stops for minutes. One
`import` method, which must be off once the copy is done. **How sure: 85%.**
The doubt: no row has crossed from node:sqlite to a deployed object yet.

## 7. Cost

Assumed load, for two people. Each is a guess until the experiment counts it:

- 4 lanes at once per person, 8 hours a day. A lease renews every 10 s (ttl
  30 s, `claims.ts`): 23,000 renews a day.
- 20 agent runs a day in all, about 500 ledger calls each: 10,000 a day.
- One beat per tool call, at the high end of 50 to 200 per run: 4,000 a day.
- Two hosts on the doorbell, each reading after each ring: 28,000 reads a day.
- An agent's log: a few MB per run (a guess). 5 MB × 20 runs = 100 MB a day,
  in R2.

| Item | Per month | What is free | Bill |
|---|---|---|---|
| Workers Paid plan | | | $5.00, the floor ([Workers](https://developers.cloudflare.com/workers/platform/pricing/)) |
| Durable Object requests | about 2 M (65,000 a day) | 1 M | about $0.15 ($0.15 per M) |
| The same, with the 1 s poll kept | about 7 M | 1 M | about $0.95 |
| Worker requests | 2 to 7 M | 10 M | $0 |
| Object duration, awake all day | about 325,000 GB-s (128 MB × 30 days) | 400,000 GB-s | $0 |
| SQLite rows written | about 4 M (3 to 4 rows per write, a guess) | 50 M | $0 |
| SQLite storage | under 1 GB | 5 GB | $0 |
| R2, agent logs | 3 GB more each month | 10 GB-months | $0 for about three months, then $0.015 per GB-month ([R2](https://developers.cloudflare.com/r2/pricing/)) |
| Cloudflare Access | 2 people | under 50 users | $0 |

- **About $5 a month, nearly all of it the plan's floor.** Durable Object
  prices are from
  [Cloudflare's pricing page](https://developers.cloudflare.com/durable-objects/platform/pricing/).
- **Not the Free plan.** Its 100,000 rows written a day is under our guess
  of 130,000. A renew writes rows, and each `setAlarm` counts as one. With the
  poll kept, requests pass its 100,000 a day too.
- **What would change it.** Shorter ttls, more lanes, or a beat per token
  instead of per tool. The bill grows with requests, and requests stay cheap
  ($0.15 per M).

## 8. Where it slots in the app's build order

- **Lane 2, the host running apart,** is being built now. This note does not
  touch it. It needs one thing from it: the host is the only process that
  talks to the ledger, so the login lives in one place.
- **Lane 3, app state on the ledger and restore.** One ask of it: keep the
  app's own state under `desk/`, `tsh/` and `host/`, and never read across
  those and `tracker/` or `pipeline/` in one call. Then the mount in
  section 3 is a Layer change, not a rewrite.
- **The first build step, beside Lane 3: the writer comes from the door.**
  - A Worker entry in front of the `Ledger` class with a `Door` service.
    `Door.access` checks the Access JWT. `Door.local` stamps the laptop's one
    person for Miniflare.
  - Every method that takes a writer or holder takes it from the door. The
    body's own is dropped.
  - `Writer` gains `for`. The door refuses `PersonOnly` kinds from an agent.
  - `Author` in the app comes from asking the door, not a constant.
  - Tests run in Miniflare with a test key set: a forged writer is
    stamped over, an agent's answer is refused, an unknown login is refused.
    No deploy, no Cloudflare call, no money.
  - Why first: it closes the gap that matters most (anyone writing as anyone),
    it is useful even on one laptop, and it changes no shape Lane 2 or 3
    depends on.
- **Then** the experiment below, with the owner's yes. **Then** the tracker's
  poll moves to the tail, the mount Layer, the import, and the switch.
  **Lane 4, the jump list,** does not wait on any of it.

## 9. One object for the whole ledger, or one per lane

Section 4 picks one object per repository. This section asks whether each
lane, or each ticket, should get its own object with its own ledger, for real
data isolation. Cloudflare's own rules lean that way: "Create one Durable
Object per logical unit that needs coordination" and "Do not create a single
'global' Durable Object". One object handles about 500 to 1,000 simple
requests a second. For the shape, they say: "The parent coordinates and
tracks children, while children handle their own state independently"
([Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)).

```ts
// A sketch. The split, if it comes: a parent per repository, a child per lane.
//
//   repo object "acme/app"        the ticket list and each ticket's top line, ticket numbers,
//                                 "waits on you" across all tickets, members, spend caps
//   lane object "acme/app#t-41"   the lane's facts and inbox, its claim and lease, its beats
//
// The child tells the parent one small line after each write that changes the top line.
const TopLine = Schema.Struct({
	ticket: Schema.String,
	title: Schema.String,
	state: Schema.Literals(["open", "closed"]),
	waits: Schema.NullOr(Schema.Literals(["plan", "stuck", "ruling", "check"])), // an open ask
	rev: Schema.Int, // the child's rev it was made from: an old line never replaces a newer one
});
```

- **What lives in a lane's object.**
  - The lane's facts and inbox (`pipeline/ticket/<t>/facts`, `/inbox`), the
    tracker's ticket stream, its claim and lease, its fences, its beats.
  - The lease is one object's job, so the claim's compare-and-set still has
    one referee. Two agents on one ticket still cannot both win.
- **What needs a parent per repository.**
  - The ticket list and each ticket's top line. Today the tracker reads every
    ticket with one `read(after, PAGE, "tracker/")`. With a split, that read
    goes to the parent's index.
  - Ticket numbers. Today a new number is the first `tracker/ticket/<n>`
    nobody registered. With a split, the parent hands out numbers.
  - "Waits on you" across all tickets: the parent's index of open asks.
  - Members and agent tokens, which the door reads on every call.
  - Spend caps across tickets. Today a charge counts up the tree in one
    transaction. Across objects it becomes a message to the parent, so a cap
    can be passed by the turns in flight.
  - The cost: each write that moves a top line is two requests, not one. The
    parent's index can lag the child by one message.
- **A fact that spans two lanes.** A duplicate ("same as t-12"), a ruling for
  two tickets, a plan with child tasks.
  - **The fact has one home, and the other lane gets a send** → lean. That is
    today's shape already: every name has an open inbox, deduped by message
    id. The home writes its fact. The other lane gets a message with the same
    id, sent again until it lands. No transaction spans two objects.
  - **Both writes in one transaction** → not possible across Durable Objects.
    Each object is its own database.
  - **The parent holds it, the lanes read it** → fits a fact about many
    tickets at once, such as a project's plan. Not for a lane's own work.
- **An agent's key scoped to one lane.**
  - **Yes, at the door, even with one object.** On a claim, the door gives
    the lane a short-lived token. It names the lane's prefix and its fence,
    is signed with a secret only the Worker holds, and ends with the lease.
    The agent's writes go with it, and the door refuses any stream outside
    that prefix. It is a capability (a key that says what it opens), the idea
    of Google's macaroons
    ([Google Research](https://research.google/pubs/macaroons-cookies-with-contextual-caveats-for-decentralized-authorization-in-the-cloud/)).
  - Access service tokens cannot do this alone. They open a whole app, not one
    object. They stay the person's agents' login. The lane token sits on top.
  - With a split, the door also routes that token to the lane's object only.
    The agent cannot even name another lane's data.
- **Could today's `Ledger` route a stream to its own object, behind the same
  interface? Partly. It is a Layer change for most calls, but not for all.**
  I read `host/ledger.ts` and `host/rules.ts` for this.
  - **Routes by name, no change:** `register`, `append`, `send`, `claim`,
    `cancel`, `setLimits`, `usage`, `processInfo`, `readStream`, `readLast`,
    `lease`, `watch`. Each names its stream or name, and a name's streams
    share its prefix (`streams(name)`, `inboxOf`). A router Layer can pick the
    object from the name.
  - **Needs a change: calls that name only a fence.** `renew` names its name
    too, but `monitor`, `demonitor`, `link`, `unlink`, `trapExit`,
    `startChild`, `hold`, `charge` and `exitChild` take a bare `fence: number`.
    The rules look the name up from it (`SELECT stream FROM leases WHERE
    fence = ?`). A fence is a `pos` in one database. Across objects, two
    fences could be the same number. A fence would have to carry its home.
  - **Needs a change: reads in one global order.** `read(fromPos, limit,
    prefix)` walks `pos`, one counter per database. The tracker's list and
    `tail` over a prefix use it. Across objects there is no single `pos`.
  - **Needs a change: OTP's calls across names, in one transaction.** `exit`
    writes DOWN to every monitor's inbox and EXIT to every link. `charge`
    counts up the whole tree. `startChild` registers and links two names.
    Today each is one transaction. Across objects they become messages,
    delivered at least once, so the laws must be run again.
  - So the split is a Layer change plus three interface changes: fences that
    carry their home, a parent index in place of the global `read`, and OTP's
    cross-name writes as messages. **How sure: 85%,** from reading the code,
    not from trying it.

**Lean: start with one object per repository, and keep the door open to the
split.** Why: two people and their agents are far under one object's limit.
The code runs on one object today. The split costs three interface changes,
and the laws must hold again across objects. Write isolation, the part that
guards most, comes from the door's lane tokens with no split. **How sure:
75%.** The doubt is data isolation at rest. With one object, a bug in the
rules could let one lane read or write another's rows. Only a split stops
that.

| | Start with one object | Start split, one per lane |
|---|---|---|
| Build | The first step above, nothing more | The first step, plus fences with a home, a parent index, OTP's calls as messages, and the laws again |
| Requests | One per call | About two per write that moves a top line |
| Isolation | Writes, by lane tokens at the door. Data, shared in one database | Writes and data, each lane its own database |
| Moving later | One object's rows split out by prefix; `pos` changes, so keep the old one beside it | Nothing to move |
| Bill at two people | About $5 a month (section 7) | About the same: more objects, each asleep most of the time |

To keep a later split cheap, three rules now. They cost nearly nothing:

- A lane's facts stay under its own name's prefix. That is already true.
- A new read across tickets goes through one place (the tracker's list), so
  that place can become the parent's index.
- A fact about two lanes has one home and a send to the other, never two
  writes that must agree.

## The experiment that would settle the biggest doubt

The biggest doubt: nothing has run on a deployed Durable Object. We do not know
its latency from the owner's laptop, whether the tail holds up over a real
network and a sleeping laptop, or whether the laws hold with two writers far
apart.

```ts
// A sketch. One deploy of the existing class, Access in front, three parts.
// 1. Latency: from the owner's laptop, 10 min each of append, read, claim, renew.  → p50, p99
// 2. Tail: the same writes watched by a 1 s poll and by the doorbell, for 1 h,
//    with the laptop put to sleep twice.                       → delay to see a write; requests
// 3. Two writers: the law suite (`runLaws`) over `layerHttp` to the deployed URL, then a 2 h soak
//    from the laptop and from a second network (a container on a cloud machine, or the second
//    person's laptop), many claims on few tickets, one deploy halfway through.
//    → no gap, no double, one holder per ticket, every acknowledged write read back
```

- **Cost: about $6.** $5 for a month of Workers Paid. Under $1 of requests: a
  2 h soak at 50 calls a second is 360,000 requests, and the laws and latency
  runs add less. Access is free. No model calls.
- **Needs the owner's yes before any deploy.** It also needs a Cloudflare
  account, a Zero Trust team and a service token. None of those are in this
  repo, and none are read by this study.
- **It settles:** the 50 ms p99 bar in [tea-host](./tea-host.md) ("If a
  deployed ledger's p99 append is over about 50 ms, a direct host-to-host path
  comes next"); poll or tail; and whether a deploy mid-run loses anything.

## Where it disagrees with a decided note

- **[tea-host](./tea-host.md) says "every host uses exactly one ledger"**, and
  the GUI note says everything the app keeps is on the host's one ledger.
  Section 3 gives each host two places behind one `Ledger` service: a remote
  one for shared work and a local one for the screen. Programs still see one
  ledger. The host sees two. The owner picks:
  - **keep the rule** and put the desk on the shared object under each
    person's prefix (then the desk needs the network to come back, and the
    door must keep each person's prefix to that person), or
  - **change the rule** to "one ledger service a host, which may mount more
    than one place" (the lean, 70%).
- **[The services note](./services-and-our-own-ci.md#open-questions) asks
  where the ledger lives for one owner with two machines.** This note leans to
  Cloudflare. A second person on another network makes the always-on home
  machine need a private network for them too. Cloudflare needs only HTTPS
  out.

## What would change it

- A p99 append from the laptop far above 50 ms. Then local reads from a copy
  (a read cache) come before the switch.
- Access not working well from a desktop app. Then our own login in the
  Worker.
- A second team, or a person who should not see every ticket. Then "who sees
  what" comes back, and per-prefix rules at the door.

## What it cannot tell us

- Nothing here has run. No Worker, no door, no deploy. Every Cloudflare
  number is from its docs, read 2026-10-25, not measured.
- The load in section 7 is guessed: lanes at once, calls per run, beats per
  run, rows per write and MB per log. The bill is small enough that a guess
  twice too low still costs little. But the Free plan answer depends on it.
- The service token claim name (`common_name`) is from memory, not from
  the page read. The first build step checks it.
- The Electron login path is a guess.
- It says nothing about more than two people, people in far-apart regions, or
  a team that wants no Cloudflare. That team runs the same bundle on workerd,
  as the sync note says, and needs its own door.
