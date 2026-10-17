# 68a. Storage: one record per run, atomic writes, and a stale handle

```ts
// where a program's runs keep what must outlive the process: a Layer of Effect's KeyValueStore
const storage = fileStorage(dir);            // or memoryStorage(), or storageOf(anyKeyValueLayer)
const ship = yield* start(shipProgram, {mode: "write"}, {}, {id: `ship:${run}`, storage});

// inside start: one open per start, like fs.open; every write goes through the handle
const handle = yield* storage.open("ship:r1", {mode: "write"});
handle.found;                                 // the run's record: flags, closed inputs, machine runs, how it last ended
handle.store("ship", {id: "r1/1/ship", until: "forgotten"});         // an answer, kept until the asker forgets it
handle.store("ship", {id, until: (s) => s.phase === "over"});        // a bare run, dropped once it is over
yield* storage.open("ship:r1", flags);        // a newer open: the older handle's next write fails Stale

// the asker has its answer: it tells ship to forget it, and waits to hear it is gone
tell(ship.run, "forget", {id: intent});       // ship answers on `forgot` {id}
```

Experiment 66 added the shelf: a run's machine states and closed inputs, kept
across a crash, in one file per key through `node:fs`. It answered "can a
program survive a crash?" with yes, on fakes. It left four things open: a
crash during a shelf write, two processes on one run, nothing ever removed,
and Node inside the core. This is the reshape for those, and the rename.

## What changed

Shelf is now **storage**, everywhere but the write-ups of 63 to 67.

| Before (shelf) | Now (storage) |
|---|---|
| `memoryShelf()`, `fileShelf(dir)` on `node:fs` | `memoryStorage()` = `KeyValueStore.layerMemory`; `fileStorage(dir)` = `layerFileSystem` on Node's `FileSystem` and `Path`; `storageOf(layer)` for any other `KeyValueStore` layer |
| `start(…, {id, shelf})` | `start(…, {id, storage})` |
| `shelf.store(run, machine, key)` | `storage.open(run, flags)` answers a `Handle`; `handle.store(machine, {id, until})` |
| `shelf.keys(run, machine)`, a folder listing | the run's record keeps the index; `handle.left(machine)` |
| `shelf.closed(run)`, `shelf.close(run, input)` | `handle.found.closed`, `handle.close(input)` |
| none | `handle.find`, `handle.forget`, `handle.end(status)`, `storage.record(run)`, `storage.remove(run)` |
| `keep.store(name, key)` in `main` | `keep.store(name, {id, until})`, plus `keep.find` and `keep.forget` |
| `shelf_unreadable` | `Stale` (a newer open holds the run) or `StorageBroken` (the store failed), both `Schema.TaggedError` |
| ship: inputs `pr`, `ask` | ship: inputs `pr`, `ask`, `forget`; new output `forgot` |
| tsh: `~/.tsh/shelf`, `JobShelf` | tsh: `~/.tsh/storage`, `JobStorage` |

`src/program/storage.ts` uses only Effect modules. The one Node line is
`src/program/storage-node.ts`: `fileStorage(dir)` is `folderStorage(dir,
NodeFileSystem.layer)`. It sits apart so a browser `FileSystem`, or a SQL
`KeyValueStore`, can be handed in without Node in the import graph.

`@demlik/tea` is unchanged. Its `Store` is a thin adapter over the same
`KeyValueStore`, made by `handle.store`.

### One record per run

Each run has one record: the flags it was first started with, the inputs its
starter closed, how its last start ended, and an index of its machine runs. A
`KeyValueStore` cannot list its keys, so the record is the list. The record
also holds two fields the API never shows: the open count and a random name
for the newest open. Those are what fence a write.

The index is written in an order that keeps it safe across a crash: the index
line goes in before the data, and on a drop the data goes first, then the
line. An index line with no data behind it is pruned at the next `open`.

### Atomic writes

Effect's file layer writes in place: a crash in the middle leaves half a file.
So every value is kept in two slots, `a` and `b`. Each slot holds the value as
text, a checksum of it (`Hash.string`), the open count of the handle that
wrote it, and a write count. A write goes over the slot that does not hold the
newest value. A read takes the newest slot whose checksum holds, ordered by
open count and then write count. A torn write fails its checksum, or does not
parse, and the read falls back to the other slot: the value before that write.

### Fenced writes

Each `open` adds one to the run's open count and picks a new random name.
Every write through a handle first reads the record and checks that it still
names this handle's open. If a newer open has taken the run, the write fails
with `Stale`, the way NFS answers a stale file handle, and nothing is written.
No process id is used, so it works the same on a folder moved to another
machine, and on a store that is not a folder at all.

In one process, the check and the write are one step: every write of a
storage goes through one lock. Across processes, they are two steps. See
holes.

### How long things are kept

Nothing expires by time.

- An **answer** (`until: "forgotten"`) is kept until the asker says
  `forget`, or until the whole run is removed.
- A **bare run** (`until` a test on the state) is dropped by the save that
  makes the test true. Nothing of it is left.

Ship now forgets on its own any bare run that never started, when it starts
again. It takes `forget {id}` beside its asks, not queued behind them, and
answers `forgot {id}` once the drop is kept.

The operator waits for that `forgot` before it writes the lane line. Its turn
has a new phase, `forgetting`, that holds the answer. A crash there sends the
forget again on the restart. That costs one extra round trip to ship per lane.
It was not in the first plan. Without it, a lane that ended right after the
answer closed ship's scope before the forget was kept, and the answer stayed in
storage forever.

## The crash table

Experiment 66's kill points, now on a real folder (`fileStorage(mkdtemp)`) for
the kept program, plus four new points that tear a write in half. A torn point
writes half the value to disk, then kills the process. Every write after the
kill is dropped. The restart opens the same folder.

"Right" means: the lane ends in the right state with the right line, the pull
request was put in the queue once, one lane line was written, the operator
asked once, and **nothing is left in storage** for that lane.

| Kill point | landed | ejected |
|---|---|---|
| before enqueue | right | right |
| after enqueue | right | right |
| in queue | right | right |
| outcome sent | right | right |
| lane line in flight | right | right |
| torn: the run's record, made at the first open | right | right |
| torn: the record, as the ask's machine run is added to its index | right | right |
| torn: the machine run's state, as it saves `queued` | right | right |
| torn: the record, as the answered ask is dropped from its index | right | right |

18 of 18 right. In each torn cell, the test checks that one file on disk does
not parse after the kill, so the tear is real. The restart always started
cleanly: no error, no state from a half write.

66's own 28 cells (child, naive, kept, on memory) still give the same answers,
wrong cells included.

## The other tests

- **Two opens of one run** (`src/program/storage.test.ts`, on a folder and on
  memory): after a newer open, the older handle's save, close, forget and end
  all fail `Stale`, and nothing it tried is on disk. On ship
  (`src/stages/ship/program.test.ts`): two starts of one run at once, the older
  fails `Stale` with no writes, and the newer ships.
- **Repeat ask, forget, bare run**: an ask asked again after a restart is
  answered from storage, and nothing runs again. After `forget` the answer is
  gone, and the same id runs fresh. A bare run leaves an empty index.
- **Torn writes on their own**: a memory store that tears the next write, and
  a folder whose newest record slot is cut short on disk. Both read back the
  value before the tear, and the next open is clean.
- **tsh**: all its tests pass, including `kill -9` and reopen on a pty: the
  job is there, and attach by run id goes on from its total.

`pnpm typecheck`, `pnpm lint` (263 files) and `pnpm test` pass: 60 files,
1332 tests.

## Holes

1. **The fence has a window across processes.** A `KeyValueStore` has no
   compare-and-set. Two processes can both read the record, both see their own
   open, and then both write. In one process the lock closes this. Across
   processes it is open, for one write each.
2. **An answer can outlive its lane.** If ship ends before it takes a forget,
   the answer stays until the whole run is removed. Nothing removes runs yet:
   not `operate` (its `ship:<run>`), not tsh (a job's run when the job is
   dropped).
3. **The checksum is `Hash.string`.** It is 32 bits and it is Effect's, not a
   format we own. A torn write that happens to keep a valid checksum is about
   one in four billion. Worse: if Effect ever changed `Hash.string`, every
   slot would read as torn, and every run would start fresh with no error.
4. **Flags are kept from the first start, never compared.** A restart with
   other flags runs with the new ones, and the record keeps the old ones.
5. **Long names.** The file layer percent-encodes each key into one file
   name, and our keys are already encoded, so `%` grows to `%25`. A long run
   id or machine id can pass the usual 255-byte name limit.
6. **A save costs about four reads and one write.** The fence reads the
   record, the slots are read to find the newest, and a change to the index
   writes the whole record again. Fine for a lane; not for a hot loop.
7. **The layer's scope is never closed.** `storageOf(layer)` builds the layer
   once and keeps it until the process exits. For memory or a folder that
   is nothing. For a SQL layer, a pool would stay open.
8. **The old tsh folder is not moved.** `~/.tsh/shelf` is left as it was;
   tsh now reads `~/.tsh/storage`. A job table kept before this is not found.
9. **The type does not make a program use its storage.** As in 66, `start`
   needs a storage for a program with machines, but `main` can still run a
   machine without `keep.store`.

## Recommendations

- **Merge this as it stands.** Every test above passes, the crash table is
  right on a real folder, and the API is smaller to misuse than the shelf's:
  a write cannot skip the fence, since only a handle writes. About 85%. The
  doubt: none of it ran live.
- **Close the cross-process window with a store that has compare-and-set**
  (SQL under a `KeyValueStore`-like service with a conditional write) or a
  lock file next to the folder. About 70% that SQL is the better of the two:
  it also fixes holes 5 and 6. The lock file is less code, but it brings back a
  process-alive check, which this design left out on purpose.
- **Remove runs.** `operate` should remove `ship:<run>` when the lane closes,
  and tsh should remove a job's run when the job is dropped. That ends hole 2.
  About 80%.
- **Own the checksum.** Use a small hash written here, or a length plus a
  hash, so an Effect upgrade cannot wipe every run. About 75%; the cost is a
  few lines.
- **Refuse other flags on a restart**, with a clear error, rather than keep
  the old ones quietly. About 65%: a restart with new flags may be on purpose,
  and nobody has asked for it yet.

## What fought me

- **The forget raced the lane's end.** The first build forgot after the lane
  line, from inside a scope that closed when the lane ended. The forget was
  lost, and every crash cell left one answer behind. The fix was the operator's
  `forgetting` phase and ship's `forgot` output.
- **A dead process that still talks.** After the kill, saves still in flight
  failed loudly and became unhandled rejections. A killed world now drops every
  write without a word, and GitHub and fabrika calls hang, as they would in a
  dead process.
- **A tear before the first save.** When the very first record write is torn,
  the operator never saved, and a resume from nothing waits forever. The
  restart now sends `start` when the operator saved nothing, as `operate`
  would.
- **`found.status` read as `running`.** The record is rewritten at open, so it
  always said `running`. `found` now carries the status the last start ended
  with.
- **`KeyValueStore` is small.** No list, no compare-and-set, `modify` is a get
  and a set. The index, the two slots and the fence all exist because of that.

## What this cannot tell us

- **Nothing here ran live.** GitHub and fabrika are fakes, as in 66.
- **Two real processes.** The two-open tests run in one process, where the
  lock hides the window in hole 1. How often two processes hit it is not
  measured.
- **A disk that lies.** The tears here are clean cuts at half a value. A disk
  that reorders writes, or loses a write it said was done (no fsync), was not
  tried.
- **Other layers.** Only memory and a Node folder ran. A browser
  `FileSystem` or a SQL `KeyValueStore` should fit the same seam, but none was
  built.
- **One kill per test, one lane at a time.** Two kills in a row, or many
  lanes sharing one ship run, were not tried.
- **How big the index gets.** A ship run that lives for many lanes adds and
  drops index lines for each; a run kept for months was not measured.
