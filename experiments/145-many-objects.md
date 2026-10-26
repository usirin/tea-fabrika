# 145. One ledger server, many objects

The question: a ledger server is now the whole storage layer, made of many Durable Objects from
the start. One object per project holds the shared work. One object per person holds that
person's desk: layout, workspaces, settings. Does that shape work with the package's ledger as it
is? Six parts: how a request finds its object, who may open which object, the desk in the
person's object, a start with the server out of reach, moving a whole server, and what breaks if
each lane gets its own object too.

**Answer: it works, on Miniflare, with the package's ledger unchanged inside every object.**

- **The router is the Worker reading the object's name from the path.** A host never routes.
  Its parent hands each program the ledger of one object, the Elm way. The same counter program
  ran unchanged on a project, a lane and a person.
- **The access rule holds.** 10 laws hold. 7 of 8 planted mistakes break a law alone. The 8th
  is a second wall: it breaks one when the first wall is down too.
- **A person's object opens to that person only, not to their agents.**
- **The desk saves in 0.7 ms and comes back in 0.5 ms**, through the router.
- **The offline start works.** The desk comes from a read copy in 0.3 ms, marked stale. A desk
  saved while offline waits under its id and lands once.
- **The read copy does not break "never both".** It takes no writes, and the server still
  judges every write.
- **A whole server moved in 0.24 s**: 27 objects, 1,561 rows, every hash equal. One object with
  10,010 rows moved in 0.36 to 0.39 s.
- **Lane objects are not worth it now.** With them, 11 of the 27 ledger laws break. With fences
  as bare numbers, one more breaks on some runs, and one fence can then write into another
  program's state.

**Start with project and person objects, and no lane objects.** How sure: 80%.

*Changed the same day: one Worker per project*
([the ledger goes to Cloudflare](../docs/direction/the-ledger-goes-to-cloudflare.md)). A server
holds one project's object, one object per person working on it, and the index.

- **Still holds:** the door, the access rule, the desk, the offline copy, the move, and no lane
  objects.
- **Simpler:** the router no longer picks a project, and a project's founder is the server's
  only founder. A person has one desk per project, as the same note says: each project in its own
  window, with its own desk.
- **Costs:** a person's things are kept once per project (their login, their sealed Claude
  token), and a view across all their projects asks each server.
- The code below still routes `project/<id>`, as it ran.

```ts
// The whole idea. The Worker picks the object by name; the object's door decides who gets in;
// behind the door is the package's ledger, as it is.
export default {
	async fetch(req: Request, env: Env) {
		const at = objectOf(new URL(req.url)); // "/person/1001/readLast" → {kind: "person", name: "person/1001"}
		if (at === null) return text(404, "no such object");
		const ns = env[BINDING[at.kind]]; // PROJECT, PERSON or LANE: one namespace per kind
		return ns.get(ns.idFromName(at.name)).fetch(req);
	},
};

// In the app: the parent hands each program the ledger of one object. The program never sees
// the address.
const shared = layerObject({url: origin, token}, "project/acme");
const desk = layerObject({url: origin, token}, "person/1001");
```

## Who did what

- **This repo's code:** all of it. A server in `experiments/145-many-objects/`, with the
  package's Durable Object (`@kampus/fabrika`'s `durable-object.ts` and `rules.ts`) unchanged
  behind a door in each object. Nothing in `packages/` changed.
- **Today's fabrika:** nothing. No lane, no agent, no model, no Jev, no key. No deploy and no
  Cloudflare account. It cost $0.

## Setup

- One laptop. Miniflare 4.20260730.0 (workerd), compatibility date 2026-07-01, in the test's own
  process. Each server listens on 127.0.0.1, its data in a temp folder or in memory.
- People are made-up GitHub ids: the operator `github:9000`, person A `github:1001`, person B
  `github:1002`, persons C and D. An agent is `github:1001.builder`, working for person A.
- Sessions are HMAC tokens minted with the server's secret. They stand in for the Door's SSH
  login (pull request 92). The objects check them the same way.
- Medians are of 50 calls. Every run is `nice -n 15`.
- `experiments/145-many-objects.ts` runs everything and writes
  `results/145-many-objects.json`. The tests beside the prototype check the same things with
  asserts: 20 tests in 6 files.

## 1. The router: how a request finds its object

The Elm answer first. In Elm a parent owns its children. It hands each child its own part of the
model and wraps each child's messages (`Html.map`), so a child never knows where it sits
([elm/html](https://package.elm-lang.org/packages/elm/html/latest/Html#map),
[direction: elm-first](../docs/direction/elm-first.md)). Here the app's main is the parent. It
hands each program one `Ledger`, the ledger of one object. No host keeps a list of program
prefixes, and no layer reads a stream name to pick an object.

```ts
// router.ts: what an id of each kind looks like. A path that fits none reaches no object.
const SHAPE: Record<Kind, RegExp> = {
	project: /^[a-z0-9][a-z0-9-]{0,62}$/,
	person: /^[1-9][0-9]{0,11}$/, // the GitHub id, never the login, which its owner can change
	lane: /^[a-z0-9][a-z0-9-]{0,62}~[a-z0-9_][a-z0-9_.-]{0,99}$/,
};

export const objectOf = (url: URL): Address | null => {
	const [, kind = "", id = "", ...rest] = url.pathname.split("/");
	if (!isKind(kind) || !SHAPE[kind].test(id)) return null;
	return {kind, id, name: `${kind}/${id}`, rest};
};

// client.ts: an address is the server's origin and the object's name.
export const layerObject = (server: Server, object: string) =>
	Layer.effect(Ledger, Effect.gen(function* () {
		return fromRaw(rawObject(server, object, yield* HttpClient.HttpClient));
	})).pipe(Layer.provide(httpLayer));
```

- **A program on a project** → the app hands it `layerObject(server, "project/acme")`.
- **The desk** → the app hands it `layerObject(server, "person/1001")`.
- **A program wants a name in another object** → it cannot reach it. Its parent wires a second
  program, or a message goes there (part 6).

The router's rules:

- **An address is the origin plus the object's name:** `https://<server>/person/1001`. The
  name is `<kind>/<id>`, and it is `idFromName`'s input.
- **Each kind has its own namespace** (`PROJECT`, `PERSON`, `LANE`). A person's object can never
  be reached as a project's.
- **Each object answers only to its own name.** It checks `idFromName(name).equals(ctx.id)`.
  That holds whether or not the runtime fills in `ctx.id.name`. Miniflare does fill it in
  (`person/1001` came back).
- **The door reads the request's body before any answer, a refusal too.** workerd closes a
  kept-alive connection when an answer leaves the body unread. The client's next call on it
  then fails, its connection reset.

| What ran | Count | Time |
|---|---|---|
| The counter of experiment 98, unchanged, 20 messages, on `project/acme` | 20 | 60 ms |
| The same, on `lane/acme~build` | 20 | 48 ms |
| The same, on `person/1001` | 20 | 49 ms |
| One `readLast` through the router and the door: project, lane, person | | 0.52, 0.48, 0.44 ms |
| The same read on the package's own local ledger: one object, no door | | 0.44 ms |

The door and the router cost under 0.1 ms a call here. A person's object costs nothing more than
the package's own. A project's door folds its member facts on each call, which is most likely
the 0.08 ms; it was not timed apart. A lane asks its project's object for the members over RPC
(Durable Objects' own method calls), and keeps the answer 5 s.

## 2. Access: who opens which object

```ts
// router.ts: the access rule, as the door runs it before any call. The lines that switch on a
// planted mistake are left out here.
export const mayOpen = (rules: Rules, at: Address, who: Who, members: Members | null): boolean => {
	if (at.kind === "person") {
		const owner = `github:${at.id}`;
		return who.kind === "user" && who.id === owner; // that person, never an agent
	}
	return members?.ids.includes(personOf(who)) ?? false; // members, and their agents
};
```

- **A person's object** → that person only.
- **A person's agent asks for the person's object** → refused. That is the lean, and why:
  - The desk holds the layout and settings. An agent's work needs neither.
  - An agent's key should open less than its person's. That is how narrowed tokens work: OAuth's
    token exchange ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html)), GitHub's
    fine-grained tokens
    ([GitHub docs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)),
    and macaroons
    ([Google Research](https://research.google/pubs/macaroons-cookies-with-contextual-caveats-for-decentralized-authorization-in-the-cloud/)).
  - A leaked agent key, or an agent talked into something by a ticket's text, then cannot read
    or change a person's desk.
  - The cost: an agent that needs a setting must be handed it by its person's app. How sure:
    85%. It would change if a real setting turns out to be one only agents read.
- **A project's object, and its lanes'** → its members, and the agents working for them.
- **The operator** (who runs the server) creates projects and moves the server, and is a member
  of nothing.

The door's rules for members:

- **A project's founder comes from its own `created` fact.** The operator writes that fact once,
  naming the founder. The founder never comes from the server's config. So one founder never
  spreads to another project.
- **Only the founder invites or removes.** A removed member is shut out at once.
- **Only the door writes the door's facts** (`door/members`). No ledger call may name a stream
  under `door`.
- **A path that names no object gets 404.** That covers `person/01001`, `person/someone`,
  `team/acme` and a method the door does not offer.

The 10 laws (`access.ts`) hold on the server. Each planted mistake changes one rule
(`PLANTED` in `router.ts`). Every plant breaks at least one law:

| Planted mistake | Laws it breaks |
|---|---|
| The Worker cuts a person's id to 3 digits: persons 1001 and 1002 share an object | 1, 2, 3, 9 |
| Any logged-in person opens any person's object | 2 |
| A person's agents open that person's object | 3 |
| Any session opens any project | 5, 8 |
| One founder for the whole server, from its config | 4, 5, 6, 7 |
| A removed member keeps their way in | 5 |
| A member may write the door's own facts | 8 |
| The name check off, alone | none |
| The name check off, with the 3-digit cut | 2: person B reads person A's rows |

- **The name check alone breaks no law, on purpose.** It is a second wall. With the router
  right, nobody can see it is gone. So the test plants it together with the router's mistake.
  Then person B reads person A's rows, and law 2 catches it.

## 3. The desk in the person's object

The desk is the app's own `Saved` shape (`apps/fabrika/src/desk/desk.ts`), copied, because the
app's package exports none of its modules. It is one event on `desk/saved`. The last one is the
desk.

```ts
// desk.ts: open the desk to write. One app at a time holds its lease; a second hears Held.
export const openDesk = (holder: string, ttlMs = 60_000) =>
	Effect.gen(function* () {
		const l = yield* Ledger;
		const reg = yield* l.register(DESK, holder);
		const last = yield* l.readLast(DESK, 1);
		const lease = yield* l.claim(DESK, holder, last[0]?.rev ?? reg.rev, ttlMs);
		const save = (desk: Saved, id: string) =>
			l.append(SAVED, "any", {kind: "saved", writer: holder, data: desk, id}, lease.fence);
		return {fence: lease.fence, save};
	});

export const restore = Effect.gen(function* () {
	const l = yield* Ledger;
	return yield* savedOf((yield* l.readLast(SAVED, 1))[0]); // null on a first start
});
```

- **A first start** → no desk, null.
- **A save, then a restore** → the same desk, whole.
- **A second app opens the desk** → `Held`, by the first app.
- **A save sent again under its id** → `dup`, written once.
- **Person B, or person A's agent, reads person A's desk** → 403.

| Desk | Size | Save | Restore |
|---|---|---|---|
| 3 workspaces, 6 tiles each | 2,132 bytes | 0.67 ms | 0.44 ms |
| 8 workspaces, 12 tiles each | 10,101 bytes | 0.69 ms | 0.47 ms |

## 4. A start with the server out of reach

The server is the one truth. The laptop keeps a read copy of the person's own object, and only
that one.

```ts
// cache.ts: the copy is rows the server sent, with the server's own pos and rev, and the
// server's address. A write while offline is not a row: it is held under its message id.
const Copy = Schema.Struct({server: Schema.String, object: Schema.String, pos: Schema.Number, at: Schema.Number, rows: Rows});
const HeldSave = Schema.Struct({id: Schema.String, desk: Saved});

type Restored =
	| {readonly from: "server"; readonly desk: Saved | null}
	| {readonly from: "copy"; readonly desk: Saved | null; readonly stale: true; readonly asOf: number};
```

- **The server answers** → the desk comes from the server, and the copy catches up.
- **The server is out of reach** → the desk comes from the copy, marked stale, with the time of
  the copy.
- **The person moves a tile while offline** → the new desk is held under its id, outside the
  copy. Held twice, it is kept once.
- **The server is back** → each held desk is sent under its id, then forgotten. It landed once.
  Sent again after a crash, it was answered `dup`. Then the copy caught up, and its last row was
  the held desk.
- **A copy of another server, or of another object** → no copy at all. LiveStore makes the same
  check with its `backendId`
  ([LiveStore](https://docs.livestore.dev/building-with-livestore/syncing/)).

| Restore | Median of 50 |
|---|---|
| From the server, through the router | 0.49 ms |
| From the copy, server out of reach (the failed call included) | 0.29 ms |

The copy of person A's object held 4 rows, two desks among them: 4,433 bytes.

**Does the copy break "never both"? No.** The rule says a project lives on one server, never a
local copy beside a remote one. It is there because two copies that both take writes must be
merged, and that is a sync engine, a separate idea. This copy takes no writes:

- Every row in it came from the server, with the server's own pos.
- A held write is not a row. It is a message waiting to be sent, and the server judges it like
  any other: the lease, the fence, the message id.
- So there is still one truth and one judge. It is git's `origin/main`: what the remote said
  last, kept to read, never pushed to.

The same shape is common:

- Replicache keeps pending writes beside the server's state, and the server is the authority
  ([Replicache](https://doc.replicache.dev/concepts/how-it-works)).
- Linear starts from its local copy and resends the writes it queued offline
  ([a reading of Linear's sync engine](https://github.com/wzhudev/reverse-linear-sync-engine)).
- Zero takes no offline writes at all, the stricter choice
  ([Zero](https://zero.rocicorp.dev/docs/connection)).

It would break the rule if the app showed a held desk as saved, or if the laptop decided on its
own which of two desks wins. How sure: 80%.

## 5. Moving a whole server

Cloudflare has no export of a namespace. It lists object ids, never their names. Its restore to
a point in time works one object at a time, and not in local development. Moving objects
between scripts works within one account only
([SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/),
[list objects](https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/subresources/objects/methods/list/),
[migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)).
So a move is our own code, with our own list of names.

```ts
// move.ts: one object. Every table, in pages; then both sides hash every row. Shortened: the
// decoding of each answer is left out.
for (const table of first.tables) {
	let after = 0;
	let sent = 0;
	for (;;) {
		const d = yield* door(from, object, `export?table=${table}&after=${after}&limit=${page}`);
		if (d.rows.length === 0) break;
		yield* door(to, object, "import", {table, columns: d.columns, rows: d.rows, from: sent});
		sent += d.rows.length;
		after = d.last;
		if (d.rows.length < page) break;
	}
}
const [a, b] = yield* Effect.all(
	[from, to].map((s) => door(s, object, "digest")),
	{concurrency: "unbounded"},
);
```

The move's rules:

- **The server keeps an index of its objects.** Each object adds its own name, over RPC, on its
  first allowed call.
- **A batch lands only right after the one before it.** Its `from` must equal the table's row
  count, so a retry leaves no gap and no double.
- **The hash is SHA-256 over every row of every table**, in table order, then row order.
- **The alarm is set again after each import.** A lease copied over still ran out on the new
  server, and the new server wrote its `lease_expired`.
- **Each server keeps its own secret.** Sessions are made again on the new one.

| Move | Objects | Rows | Time | Every hash equal |
|---|---|---|---|---|
| 6 projects, a lane, 20 persons with 50 desks each, pages of 500, 4 at once | 27 | 1,561 | 239 ms | yes |
| The same, pages of 100 | 27 | 1,561 | 266 ms | yes |
| One person's object with 10,000 small desks, pages of 500 | 1 | 10,010 | 394 ms | yes |
| The same, pages of 2,000 | 1 | 10,010 | 357 ms | yes |

- **One object moves at about 25,000 to 28,000 rows a second here.**
- **The filled server had a row in every table:** events, leases, jobs, names, monitors, links,
  the door's own table. A supervisor, its child, a monitor, a link and a spend were in it.
- **A batch sent twice is refused** ("out of order").
- **A move onto a server that has the object already is refused, not merged.**
- **A write after the copy shows up as a hash that does not match.** So the source must take no
  writes while it moves. The copy reads table by table, not one snapshot.

## 6. Lane objects: what breaks

PR 87's section 9 said one object per lane needs three interface changes:

- fences that carry their home;
- a parent index in place of the one global `read`;
- OTP's calls across names as messages.

The spike (`lanes.ts`) is a `Ledger` that sends each call to the object of the name it names:
`lane/<project>~<the name's first segment>`. A call that names only a fence goes to the fence's
object. It builds the first change two ways, and neither of the other two. Then the package's 27
ledger laws ran on it, three times each way.

- **One object, behind the door** → 27 of 27 laws hold.
- **Fences as bare numbers, a table in the client** → 16 hold. Law 28 also breaks on some runs:
  1 of 3 in the script, and on some test runs.
- **Fences that carry their home** (the object's fence times 2^20, plus a 20-bit hash of its
  name) → 16 hold, every run.

| Law | Why it breaks across objects | The change it needs |
|---|---|---|
| 2a. pos is unique | Each object counts its own log from 1: 50 appends, one distinct pos | A parent index; pos means "in this object" |
| 18. a reply into another program's inbox, fenced on the replier's lease | The inbox's object does not know the replier's fence | Cross-name writes as messages |
| 21. DOWN once per monitor | The watcher's object does not know the target: noproc at once | Messages |
| 22. links | The other name is in another object: noproc | Messages |
| 23, 24, 25, 29, 30. trees: start_child, crashes, exit_child, child counts, wall time | The child is registered in the parent's object; claiming it at its own object is "unknown" | Messages, and a child's home |
| 26, 27. spend up the tree | The same: the tree spans objects | Messages; a cap can be passed by the turns in flight |
| 28. a late charge only replaces its own hold (bare fences only) | Two objects gave out the same fence number | Fences that carry their home |

**Bare fences are not safe across objects, not only unroutable.** With bare numbers, law 18's
run had a write land in another program's state stream, and an old fence still worked after a
reclaim. Each object's fence was a different lease that happened to have the same number.

What the other changes would cost, from the spike and the package's line counts
(`rules.ts` 1,691 lines, of which about 750 are the process tree and limits; `laws.ts` 1,264):

- **Fences that carry their home:** about 100 to 150 lines. The spike's version is about 60.
- **A parent index:** about 200 to 300 lines. A parent object keeps each lane's top line. The
  tracker's list reads from it. Law 2a is written again for a pos that belongs to one object.
- **OTP's calls across names as messages:** about 900 to 1,300 lines. An outbox in each object,
  sent until it lands, deduped by id. Most of the 750 lines of the process tree change. Laws 18
  and 21 to 30 are written again for "at least once".

So about 1,200 to 1,750 lines, and every OTP law again. How sure: 60%. The number comes from
reading the code, not from building the changes.

## Alchemy

The server will be declared with Alchemy (`alchemy@2.0.0-beta.84`), as kamp-us/phoenix does.
As Alchemy objects, the router and the person objects would be one Worker and one Durable Object
class per kind:

```ts
// A sketch, from @alchemy.run/cloudflare 2.0.0-beta.84. A Worker's bindings go in `env`. The
// DurableObject doc comment in that package still says `bindings`, which the Worker ignores.
export const Server = Cloudflare.Worker("ledger", {
	main: "./server.ts",
	env: {
		PROJECT: Cloudflare.DurableObject<Project>("PROJECT", {className: "Project"}),
		PERSON: Cloudflare.DurableObject<Person>("PERSON", {className: "Person"}),
		INDEX: Cloudflare.DurableObject<Index>("INDEX", {className: "Index"}),
	},
});
```

A short try, outside the repo, with no Cloudflare account and no credentials: `alchemy dev` ran a
Worker with one Durable Object class on the laptop. `idFromName` worked. `ctx.id.name` came back.
Each object was one SQLite file under `.alchemy/local/`.

This experiment stays on Miniflare. Why:

- The tests start, stop and restart many servers in one process, on free ports, with planted
  rules. Miniflare's API does that. `alchemy dev` is a command with one port (1337).
- The server is built from the package's own module list (`ledgerOptions`), which Miniflare
  takes as it is.
- Alchemy's Cloudflare package added 58 packages and about 370 MB to a scratch install (workerd,
  sharp, a browser downloader). Adding that to this repo is experiment 146's call.

**One thing to watch:** the local folder of a namespace carries a 16-letter suffix
(`<stack>-ledger-<stage>-<suffix>-Person`). The suffix is kept only in Alchemy's state folder.
The try deleted `.alchemy/state` and started again. Alchemy made a second folder with a new
suffix, and `person/1001` came back empty: its count was 1 again, where it had been 2. The old
data was still on disk, but nothing pointed to it. So a laptop server on `alchemy dev` must keep
its state folder with its data, or a person's projects seem to vanish.

## Which objects to start with

**Start with one object per project, one per person, and the index. No lane objects yet.**

- **Why:** each project and each person is a unit that never needs a write across objects. The
  package's ledger runs unchanged in each, and all 27 laws hold there. Cloudflare's own rules
  advise one Durable Object per unit of work, such as one user, and no single global object
  ([Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)).
  LiveStore and PartyServer also route by name in the Worker and do auth there
  ([LiveStore](https://docs.livestore.dev/sync-providers/cloudflare/),
  [PartyServer](https://github.com/cloudflare/partykit/blob/main/packages/partyserver/README.md)).
- **What it costs:** the router and the access rule (`router.ts`, 192 lines with the plants), and
  the door, the index and the move's steps (`server.ts`, 376 lines). The whole prototype is about
  2,370 lines with its tests, and the script 290 more.
- **Lanes:** they stay names inside their project's object. A lane's writes are kept apart by
  lane tokens at the door (PR 87, section 9). Lane objects cost about 1,500 lines and every OTP
  law again.
- **How sure: 80%.** The doubts:
  - Real Cloudflare's latency and its `ctx.id.name`. Experiment 144 measures them.
  - One person's desk from two laptops at once. That was not tried.

## What surprised us

- **A refusal that leaves the body unread drops the connection.** The next call on that
  kept-alive connection fails, its connection reset. The fix is one line: read the body first.
  Experiment 144 may meet the same thing on Cloudflare.
- **Bare fence numbers across objects are a safety bug, not only a routing bug.** One lane's
  fence wrote into another program's state, because both objects gave out the same number.
- **pos stops meaning "the place in the log".** It means "the place in this object's log".
  Anything that compares a pos from two objects is wrong.
- **Losing Alchemy's state folder hides the laptop's data.** `alchemy dev` started on a new,
  empty folder, and the old data sat on disk with nothing pointing to it.

## Sources

- Cloudflare, [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/):
  one object per logical unit, no global object, the Worker does the auth.
- Cloudflare, [Durable Object ids](https://developers.cloudflare.com/durable-objects/api/id/) and
  the [changelog](https://developers.cloudflare.com/changelog/product/durable-objects/): `name` on an id.
- Cloudflare, [SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/):
  restore to a point in time is per object, and not in local development.
- Cloudflare, [list objects](https://developers.cloudflare.com/api/resources/durable_objects/subresources/namespaces/subresources/objects/methods/list/): ids only.
- Cloudflare, [migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/): transfers in one account.
- Cloudflare, [limits](https://developers.cloudflare.com/durable-objects/platform/limits/): 10 GB per object, 2 MB per row.
- Cloudflare, [Agents: calling agents](https://developers.cloudflare.com/agents/api-reference/calling-agents/):
  `/agents/{agent}/{instance}`, auth before the object, an object per user.
- Cloudflare, [SQLite in Durable Objects](https://blog.cloudflare.com/sqlite-in-durable-objects/).
- PartyServer, [README](https://github.com/cloudflare/partykit/blob/main/packages/partyserver/README.md):
  `/parties/:server/:name`, the name from the id.
- LiveStore, [Cloudflare sync](https://docs.livestore.dev/sync-providers/cloudflare/) and
  [syncing](https://docs.livestore.dev/building-with-livestore/syncing/): an object per store, the
  backend is the authority, `backendId`.
- Replicache, [how it works](https://doc.replicache.dev/concepts/how-it-works) and
  [push](https://doc.replicache.dev/reference/server-push): pending writes, ids already seen are ignored.
- Zero, [connection](https://zero.rocicorp.dev/docs/connection): no offline writes.
- Linear, [a reading of its sync engine](https://github.com/wzhudev/reverse-linear-sync-engine) and
  [the team's talk](https://linear.app/now/scaling-the-linear-sync-engine): a local start, writes queued offline.
- OAuth token exchange, [RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html); GitHub,
  [fine-grained tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens);
  [macaroons](https://research.google/pubs/macaroons-cookies-with-contextual-caveats-for-decentralized-authorization-in-the-cloud/).
- Elm, [`Html.map`](https://package.elm-lang.org/packages/elm/html/latest/Html#map).

## What it cannot tell us

- **Real Cloudflare.** Everything ran on Miniflare on one laptop. Times over the network, and
  whether Cloudflare fills in `ctx.id.name`, are for experiment 144. The router does not need it.
- **The login.** Sessions here are minted with the server's secret. The Door's SSH login
  (PR 92) was not run in front of these objects.
- **Who wrote a row.** The ledger keeps the `writer` the call gives. The door should stamp it from
  the session, as PR 87 says. That is the next step, and this prototype does not do it.
- **Two laptops of one person.** The desk lease lets one app write at a time. A desk held offline
  can still land after a newer one from another laptop. Sending the held desk with the rev it was
  based on would make the server answer `Stale`. Not tried.
- **A refusal that looks like being offline.** The prototype falls back to the copy on any failed
  read, a 403 too. A real app should fall back only when the server is out of reach.
- **A move under load.** The source must be quiet. Big objects near Cloudflare's 10 GB were not
  tried: 10,010 rows is small.
- **The lane line counts are estimates** from reading the code. The spike built one of the three
  changes, in the client only.
- **Alchemy was tried with one object class, not with this server.**
