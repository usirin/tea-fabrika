# @tea-fabrika/tea-host

Runs a tea program under a registered name, on one shared ledger. Any number of hosts can serve
the same name. One of them holds its lease and runs it. When that host dies or freezes, another
takes the name over and replays from the ledger. OTP's node, for tea programs.

```ts
import {Ledger} from "@tea-fabrika/tea-host";
import {cast, serve} from "@tea-fabrika/tea-host/host";
import {layerLocal} from "@tea-fabrika/tea-host/local";
import {whereis} from "@tea-fabrika/tea-host/observer";
import {Effect} from "effect";

const main = Effect.gen(function* () {
	const ledger = yield* Ledger;
	// Deny by default: nothing lands under a name until someone registers it.
	yield* ledger.register("counter:1", "setup");
	// Run it here. Start the same thing in two more processes, and they wait as standbys.
	yield* serve({name: "counter:1", holder: `host-a@${Date.now()}`, program: counterProgram});
	// gen_server:cast from anywhere: one message, sent again under the same id until it lands.
	yield* cast("counter:1", "m-1", {id: "m-1"}, "sender-1");
	// Read-only: who holds it, under which fence, until when.
	console.log(yield* whereis("counter:1"));
}).pipe(Effect.scoped);

// A local ledger: the Durable Object in Miniflare, in its own child process.
Effect.runPromise(main.pipe(Effect.provide(layerLocal({persist: ".ledger", ledger: "tea-host"}))));
```

`counterProgram` is a `tea-program` program. It asks for `Self` and runs its machine with
`self.run`. The host fills in where the state is saved and where errors go. The program cannot
pass either one: `self.run` types `store` and `onError` as `never`. See
`experiments/98-tea-host-package/counter.ts` for the whole program.

## Where it sits

- Above `packages/tea-program` in `layer-rules.json`. It imports that package, `@demlik/tea` as
  published, `effect`, `@effect/platform-node` and `miniflare`. Nothing else of this repo.
- tea does not change for it.

## What's in it

The `exports` map is the whole public part.

| Import | What it gives |
|---|---|
| `@tea-fabrika/tea-host` | `Ledger` (the service), its tagged errors, `Row`, `Lease`, `streams(name)`, `inboxOf` |
| `./local` | `layerLocal`: the ledger in a Miniflare child. Own process group, a fixed direct socket, restarted past 500 MB. `LocalLedger` is the handle on the child |
| `./http` | `layerHttp`: a `Ledger` over HTTP to any running ledger, with a small pool of connections |
| `./memory` | `layerMemory`: the rules written a second time over Maps, for tests |
| `./sqlite` | `layerSqlite`: the same SQL as the Durable Object, on a node:sqlite file |
| `./worker-options` | `ledgerOptions`: Miniflare options for the Durable Object, for a caller that runs it itself |
| `./rules` | The SQL and its migrations, shared by the Durable Object and node:sqlite |
| `./tail` | `tail`: a live read of one stream, in order, once each. `meter` counts what it read |
| `./host` | `serve`, `Self`, `cast`, `envelope`, `savedState`, and the host machine with its laws' inputs |
| `./call` | gen_server:call as a tea module: send, a reply-to, a deadline, a retry under the same id |
| `./monitor` | Monitors as a tea module: keep watching a name, monitor again after each DOWN, and report every death once (a `down`, or a `gap` of deaths no monitor was on) |
| `./supervisor` | OTP's `supervisor`, `one_for_one`, as a tea program: `supervisor(name, spec)` gives the program, or refuses the spec |
| `./observer` | `whereis` and `getState`: who holds a name, and its last saved state. Writes nothing |
| `./laws` | The ledger's law suite, `runLaws`, and `layerPlanted` (the SQL with one mistake) |

The rules, in short:

- A name is registered before anything is written under it. A write under a name nobody
  registered answers `UnknownName`.
- Only the lease's fence writes a registered name's streams. Anyone may send to its
  `<name>/inbox`, once per message id.
- A host stops its program when its lease is lost or its own lease clock runs out, whichever
  comes first.

## Monitors, links and the supervisor

OTP's names, on a durable ledger. Each call is one ledger transaction, fenced on the caller's own
lease, so it lands once or not at all.

```ts
const self = yield* Self;
self.incarnation                    // the run number: +1 per restart, the same across a takeover
yield* self.monitor("c:1#1", "c:1") // erlang:monitor: one DOWN in my inbox when c:1's run ends
yield* self.link("c:2")             // link/1, both ways: if one crashes, the other ends too,
yield* self.trapExit(true)          //   unless it traps exits: then it gets an EXIT message
yield* self.startChild("c:1", null) // register c:1 under me and link it, or start it again once down
yield* self.exit("normal", "done")  // end my own run on purpose
```

- **Down** means the program's run (its incarnation) ended: `crash` (its update or an Effect
  failed, or it died), `normal` (its main returned) or `shutdown` (it was told to stop, or a link
  took it down).
- **A host dying is not down.** Another host takes the name over and replays: same incarnation, no
  DOWN, no EXIT. A lease that runs out with no host to take over is not down either: restarting
  the program cannot fix a missing host (Orleans' virtual actor: a grain always exists, it is just
  not always active).
- A down name takes no claim until its parent starts it again. Only the parent may.
- **Poison messages.** When the same inbox message is the first unread one in three crashes in a
  row, the ledger sets it aside in `<name>/dead` (`dead_letter`), and hosts skip it. SQS's redrive
  policy and RabbitMQ's delivery limit do the same. `maxDeliveries: null` turns it off.
- **The supervisor** traps exits and starts a crashed child again (`permanent`, `transient`,
  `temporary`). More than `intensity` restarts within `periodMs` and it gives up: it exits
  `shutdown`, and its links take its children down with it.
- `supervisor(name, spec)` refuses a spec it knows cannot work: an `intensity` below
  `maxDeliveries` (one poison message would take the whole tree down before the ledger sets it
  aside), a `periodMs` of 0 or less, two children with one name, a child with the supervisor's
  own name.
- The ledger refuses an `append` that writes its own words (`exited`, `DOWN`, `EXIT`,
  `dead_letter` and the rest): only the ledger writes those.
- A monitor fires once, so between a DOWN and the next monitor a fast crash loop can end runs no
  monitor sees (OTP has the same hole). The monitor module closes it: incarnations only go up by
  one, so a monitor that lands on run 6 after a DOWN of run 3 proves runs 4 and 5 ended. It
  reports them as one `gap`.

## Tests

`pnpm test` runs the law suite on the Durable Object, node:sqlite and memory, every planted
mistake, a counter handed from one host to another, a supervisor restarting a child, setting a
poison message aside and giving up, and a watcher seeing one DOWN per death and none for a
takeover. The machine laws for the host, the supervisor and the monitor module are in
`wip/src/laws/tea-host.ts`. The long fault runs are in `experiments/98-tea-host-package.ts`
(killed hosts, a frozen host, a host in a Docker container) and
`experiments/99-monitors-supervisor.ts` (a supervisor, its children and a watcher on three hosts,
with kills, a freeze, crashes and a poison message).

## Not in it yet

- `one_for_all` and `rest_for_one`. Only `one_for_one`.
- `DynamicSupervisor.start_child` is a cast; the caller learns the child is up with a monitor.
- `terminate_child`, `which_children`, and a shutdown timeout. A child taken down by its
  supervisor ends at once.
- A deployed Durable Object. Only the local one has been run.
- A real agent. The agents test uses a stub.
- Laws for a parent machine that keeps a window of calls open. The call module has laws; the
  window around it in experiment 98 does not.
- An unregister, and a name's metadata (who may send to it).
