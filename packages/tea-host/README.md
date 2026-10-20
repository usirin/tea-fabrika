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
| `./observer` | `whereis` and `getState`: who holds a name, and its last saved state. Writes nothing |
| `./laws` | The ledger's law suite, `runLaws`, and `layerPlanted` (the SQL with one mistake) |

The rules, in short:

- A name is registered before anything is written under it. A write under a name nobody
  registered answers `UnknownName`.
- Only the lease's fence writes a registered name's streams. Anyone may send to its
  `<name>/inbox`, once per message id.
- A host stops its program when its lease is lost or its own lease clock runs out, whichever
  comes first.

## Tests

`pnpm test` runs the law suite on the Durable Object, node:sqlite and memory, every planted
mistake, and a counter handed from one host to another. The long fault runs (killed hosts, a
frozen host, a host in a Docker container) are in `experiments/98-tea-host-package.ts`.

## Not in it yet

- Supervisors, links and monitors. A name with no live host just waits.
- A deployed Durable Object. Only the local one has been run.
- A real agent. The agents test uses a stub.
- Laws for a parent machine that keeps a window of calls open. The call module has laws; the
  window around it in experiment 98 does not.
- An unregister, and a name's metadata (who may send to it).
