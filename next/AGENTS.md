# next/

The new version of fabrika, built on [the five layers](../docs/direction/a-local-first-sync-engine.md).
The [root map](../AGENTS.md) holds for all of it; this page adds the rules that hold only here. It is
the lab until a person opens it for real work, so it may be rough. "No rough first versions" in the
root map applies from then on.

`@kampus/fabrika` (`next/apps/fabrika`) is the app and `@kampus/libfabrika`
(`next/packages/libfabrika`) is the library. Anyone can take libfabrika alone and build a client
that works exactly like fabrika; fabrika is one libfabrika client. So for any file in
`next/apps/fabrika`, ask: would a from-scratch client have to write it again? If yes, it belongs in
libfabrika
([why libfabrika exists](../docs/direction/where-each-piece-lives.md#why-libfabrika-exists-decided-2026-11-08)).

## Rethink, do not port

- Follow the decisions and `docs/direction`, not today's code. Read today's code and its tests to
  learn which jobs exist and what was learned, then rethink. Never import it and never copy it
  across ([0217](../.decisions/0217-next-grows-beside-today.md),
  [rethink, do not port](../docs/direction/rethink-do-not-port.md)).
- When `next/` takes a job over, the pull request that switches to it deletes the old part. Its
  tests or laws are ported first (0217).
- The shell is `fabsh`. `tsh` stays in today's version
  ([0432](../.decisions/0432-next-has-fabsh-rethought-from-tsh.md)).
- Hands, a window and an agent dial the brain, and `client` means any of them at the door
  ([brain, hands, window, agent](../docs/direction/brain-hands-window-agent.md)).
- In the planner step here, the lead's check of a plan's open questions becomes code. No merged
  pull request has been built this way yet
  ([where we are](../docs/plan/README.md#where-we-are-now)).

## What lint holds

`pnpm lint` refuses these in `next/**`, and each message says what to do. The rules are set in
[`.oxlintrc.json`](../.oxlintrc.json) and explained in
[`oxlint-plugins/README.md`](../oxlint-plugins/README.md).

| Rule | Check |
|---|---|
| Effect all the way: nothing is built on Promises | `fabrika/no-promises` |
| Effect's platform modules, not `node:` imports | `fabrika/no-node-imports`, `fabrika/no-node-filesystem` |
| An edge is one line under a marked comment with its reason | `fabrika/edge-comment` |
| No bare `of` and no `xOf` name; `Lease.of(...)` through its module is fine | `fabrika/no-of` |
| No hand-written `_tag`: Effect Schema writes it | `fabrika/no-hand-tag` |
| No question word as a name | `eslint/id-denylist`, `fabrika/no-question-word-key` |
| One exported tea machine, or one factory, per file | `fabrika/one-machine-per-file` |
| One store hook, tea's `useRuntime` | `fabrika/one-store-hook` |
| A module's files, names and `internal/` | `fabrika/modules`, `eslint/no-restricted-imports` |
| A module imports only from lower layers | `pnpm lint:layers`, from `layer-rules.json` |

A Promise edge the platform demands is one line, marked
`// oxlint-disable-next-line fabrika/no-promises -- edge: <why>`, and the lead reads each one at
merge ([no Promises](../docs/direction/no-promises.md)). A `node:` import stays only where Effect
has nothing, marked as an edge with its reason
([0250](../.decisions/0250-effect-modules-first-node-at-an-edge.md)).

## What lint does not hold yet

- **Use the platform through Alchemy, never directly,** in the cloud and on the laptop alike: no
  `cloudflare:*`, `miniflare`, `workerd`, `wrangler` or `@cloudflare/*` import, no raw platform
  type, and nothing that starts or talks to the local runtime except through Alchemy. A gap is
  patched locally with its upstream issue filed the same day; a direct use stays only as a marked
  edge with the issue link. The six gaps 0042 lists are patched without an issue. Today's direct
  uses move with their ports, and the lint rule is ticket 506
  ([0042](../.decisions/0042-platform-pieces-go-through-alchemy.md)).
- **A resource is acquired in a scope.** A child process, a test window, a database, a file handle,
  a socket, a temp folder, a timer or a subscription is opened with `Effect.acquireRelease` and
  offered as a `Layer` or a scoped Effect, so the scope gives it back. No `try/finally` and no
  `afterEach` that releases it, and no "remember to close" in prose. A raw handle from the platform
  is wrapped once, at the edge. A process killed with SIGKILL runs no finalizer, so a resource that
  must not outlive it needs a guard outside the process too
  ([0061](../.decisions/0061-resources-are-acquired-in-a-scope.md)).
- **A service file holds only its contract.** The service class, its own error and the types it
  speaks in, with its type written out: no layer, no SQL, nothing that runs. Each layer is a sibling
  file read through its module, as `LedgerSql.layer(...)`, and no service class has a static layer.
  A module keeps domain, application and infrastructure files apart, and a file that names a
  platform lives in `cloudflare/` or `node/`, so one platform's bundle holds no other's code
  ([0095](../.decisions/0095-a-service-file-holds-only-its-contract.md)).
- **An object class stays thin.** It holds what the platform gives it and a one-line handoff. The
  logic is plain code that also runs on Node in tests
  ([an object class stays thin](../docs/direction/object-classes-stay-thin.md),
  [0041](../.decisions/0041-object-classes-are-effect-objects.md)).
- **A folder of libfabrika is a module, and its rank is a layer,** like rooms on floors, which stays
  only the analogy ([0091](../.decisions/0091-modules-and-layers.md)). A module holds one subject,
  with front files and an `internal/` no other module imports, and it re-exports no other module's
  names. Its layer is one line in `layer-rules.json`: a module imports only from lower layers, never
  from its own. A module offers Effect services in its own types and errors, plus the shared names
  beside `Id.ts`: a lower module's error is translated at the service, with its cause kept, and
  `runtime/` never imports `ledger/`. A new file goes in its module now, before the move lands
  ([0043](../.decisions/0043-rooms-on-floors.md)).
- **Test files keep the layers too,** with no exemption: a module whose laws need a real database
  writes them as a suite, read through its module as `SinkTest.suite(nodeSql)`, and the module that
  owns the driver runs it; a helper two modules share sits on a layer both may import
  ([0062](../.decisions/0062-test-files-keep-the-floors.md)).
- **A window reads state through tea's own React hook.** State lives in a tea machine, never
  `useState` ([Elm first](../docs/direction/elm-first.md)). The hook is `useRuntime`: it takes an
  Effect-engine run, hands back a `send` that returns nothing, and reads one part through a
  selector, as in `useRuntime(run, (m) => m.views[id])`. No stand-in hook
  ([0466](../.decisions/0466-one-store-hook-no-hand-memo.md)).
- **Every state machine is explicit.** A stored value that changes and decides what is legal next is
  control state. It gets one named type with its transitions in one place, never flags, a position
  in code or an order two parties assume. A plan asks of new code: what are its states?
  ([0037](../.decisions/0037-implicit-state-machines-made-explicit.md)).
- **Every state machine is a tea machine.** No plain union with a transition function. The machine's
  Model, Msg and update live in its file, with no input or output code, and nothing outside it edits
  the Model by hand: it sends a Msg. A small private helper machine may share its parent's file. An
  `update` handler picks the next state with a plain conditional on `_tag`, not `Match` or `.match`.
  A file may export one machine factory in place of the machine, never both
  ([0046](../.decisions/0046-one-tea-machine-per-file.md)).

## Words

- A word means one thing ([0212](../.decisions/0212-one-meaning-one-way.md)). "Run" means an agent
  run only; one start of a program is a process, and a restart is a new process, as in OTP. A place,
  a path, a ref, a state, a reason or a total gets its own word (`location`, `path`, `ref`, `state`,
  `reason`, `total`). `rg` the word under `docs/direction/` and `next/` before you use it.
- An entry's two clocks have their own names: `arrivedAt` is the referee's, when the entry reached
  the ledger, and `sentAt` is the writer's own, when it wrote it (Kafka's LogAppendTime and
  CreateTime). A ledger entry keeps `sentAt` from day one, but leases and limits use only
  `arrivedAt`. Today's code says `at` and `said`.
- `kind` on ledger entries is `_tag` here too
  ([0214](../.decisions/0214-unions-are-tagged-with-tag.md)). Today's code keeps `kind` and `why`
  until that code goes.
