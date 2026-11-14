---
date: "2026-10-31"
scripts: "`174-effect-on-cloudflare/` (a workspace package: `run.ts` runs one part, `harness.ts`, `door.ts` the hibernating Protocol, `alarm-engine.ts` the `WorkflowEngine`, and `s1` to `s5` with their entries), `results/174-effect-on-cloudflare/`"
summary: "Mostly steal, build on two things, skip the cluster. In Miniflare, Effect's RPC server runs over hibernating sockets and a bare Chromium tab speaks it (woken call 6.4 to 14 ms, awake 2.3 to 4.8 ms at p50; pings wake nothing), but it saves no lines over the plan's door. A stream fiber dies silently when the object sleeps, so a waiting call must be data in the socket's attachment: parked chunks arrive after a wake in 6 to 29 ms. Cluster runs in one object but needs its polls (first call about 220 ms, tuned away it timed out at 20 s), 316 KB. Eventlog runs but has no author, a binary wire, and a client that retries refusals forever. Effect's `Workflow` on a 161-line alarm engine ran a durable turn through a clock, a kill and an approval. Effect 4.1.1 broke the cluster spike by dropping `effect/Crypto`; the rest ran unchanged. Miniflare does sleep objects, so a direction note is wrong, and locally timers do not hold an object as Cloudflare's docs say. Lean: keep the plan's door and put waits in the attachment, 85% (taken into Tier 1 on 2026-11-02); Workflow for Tier 5, 65% (overruled 2026-11-02 by [tea is the engine](../docs/direction/tea-is-the-engine.md)). $0, nothing deployed."
---

# 174. Can `next/` steal from or build on Effect's cluster and friends, on Cloudflare?

Everything here is about `next/`. Nothing touches today's packages. All runs are local, in
Miniflare. Nothing was deployed, and no model was called. Cost: $0.

**Answer: mostly steal, build on two things, and skip the cluster.**

- **Cluster runs inside one Durable Object, but it is the wrong tool.** It needs its polling
  loops: with them tuned away, the first call timed out at 20 s. With them, the first call takes
  about 220 ms and the bundle is 316 KB. Cloudflare's docs say timers stop an object from
  hibernating. Skip it. Sure: 85%.
- **Eventlog runs too, and it is also wrong for us.** Its entries have no author, its wire is
  binary, and its client retries a refused write forever. Skip it. Sure: 85%.
- **Effect's RPC server works on a sleeping object, and a bare tab can speak it.** That was the
  big open question, and it is now settled for local. But it saves no lines over the plan's own
  door in Tier 1. Keep the plan's door, steal the sleep tricks. Sure: 72%.
- **The biggest win is Tier 5.** Effect's `Workflow` API, on our own 161-line engine over one
  alarm and SQLite, ran a whole durable agent turn. It slept under a clock, survived a kill and
  waited for an approval. Sure: 65%, because it sits beside tea rather than inside it.
  **Overruled 2026-11-02:** see [the owner's ruling](#the-owners-ruling-2026-11-02).

**One thing to change in the Tier 1 plan.** A call that waits must be data on the socket, not a
fiber in memory. The spike shows why: a stream fiber dies silently when the object sleeps. The
client hears nothing, not even a close, until the object next wakes.

```ts
// Sketch. What the socket's attachment holds, so the object can sleep under every wait.
// The plan's Attached already holds who said hello. Add the waits.
type Attached = {
	readonly client: string;
	readonly who: Who | null;
	readonly row: Row | null; // a waiting row, so a tab need not knock every 5 s
	readonly waits: ReadonlyArray<{readonly id: string; readonly stream: string; readonly after: number}>;
	readonly watching: boolean; // door.watch
};

// On append: no fiber, no timer. Read the sockets and answer the ones whose wait is now met.
const answerWaits = (state: DurableObjectState, stream: string, rev: number) => {
	for (const ws of state.getWebSockets()) {
		const a = ws.deserializeAttachment() as Attached;
		const due = a.waits.filter((w) => w.stream === stream && w.after < rev);
		if (due.length === 0) continue;
		for (const w of due) ws.send(JSON.stringify({jsonrpc: "2.0", id: w.id, result: {rev}}));
		ws.serializeAttachment({...a, waits: a.waits.filter((w) => !due.includes(w))});
	}
};
```

## The owner's ruling, 2026-11-02

Two decisions, both settled.

- **A. tea is the engine.** Anything that replaces a tea machine is banned, so Effect's `Workflow`
  does not come in, for agent turns or anything else. Cluster may come later, not now. This
  overrules the Tier 5 lean above (Workflow, 65%), the Tier 5 row in [Branch by branch](#branch-by-branch),
  the "Agent turns, 65%" doubt, and [the boldest honest design](#the-boldest-honest-design). They
  stay below as they were written, marked, since a wrong guess stays in the record. The rule and
  its reasons: [tea is the engine](../docs/direction/tea-is-the-engine.md).
- **B. Tier 1 takes this experiment's one change.** A call that waits is data on the socket's
  attachment, not a fiber in memory, and a waiting tab no longer repeats `door.knock` every 5 s.
  The knock itself stays. [Tier 1's plan](../docs/plan/tier-1-detail.md#cloudflare) now says how.

## What we ran

Effect 4.0.6 (the repo's version then), Miniflare 4.20260730.0, compatibility date 2026-07-01,
Node 26. Then repeats: parts 1, 3 and 4 on Effect 4.1.1, and parts 1 and 5 on workerd 1.20261101.1
with date 2026-10-30. Parts ran at the same time, so small timings are noisy.

The repo moved to Effect 4.1.1 before this landed. This experiment's package holds 4.0.6 on its
own, so each part runs as it did. On 2026-11-02, part 1 ran once more, alone, before landing. Every
yes and no came out the same: the socket stayed open through sleep, pings woke nothing (0
activations, 20 of 20 answered at 2.1 ms p50), and the parked chunk arrived after a wake. Timings
were a little faster with nothing else running: a woken call 5.9 ms, a parked chunk 4.7 ms after
the wake. The results file keeps the first run.

| Part | Question | Result |
|---|---|---|
| 1 | Effect's RPC server over hibernating sockets | Works, 158 KB (53 KB gzip). A woken call took 6.4 to 14 ms, an awake one 2.3 to 4.8 ms at p50, over three runs |
| 1 | Does a ping wake it? | No. 20 of 20 answered at about 2.5 ms, 0 activations. A socket pinged every 5 s still slept |
| 1 | A plain Effect stream, object sleeps | The fiber dies. No frame, no close. Close 1012 only at the next wake |
| 1 | The same stream, held by `waitUntil` | Object stays awake, 1 wake, chunk arrives. It costs awake time |
| 1 | A stream parked as data | Object sleeps, chunk arrives after the wake in 6 to 29 ms. Effect's own `RpcClient` reads it as a normal stream, even when an alarm sends it |
| 1 | A real Chromium tab with nothing installed | Append, refusal, ping and parked chunk all work with plain JSON |
| 2 | Cluster in one object | Runs. First call about 220 ms, then 2 to 9 ms. 26 SQL statements at start, 5 tables, 49 KB. Same-id dedup works, also after a kill |
| 2 | Cluster with reply polling tuned to 1 hour | First call timed out at 20 s |
| 3 | A durable turn on alarms | Clock, kill, approval, post all work. Engine 161 lines, bundle 131 KB (44 KB gzip) |
| 4 | Eventlog server in one object | Runs on `sql-sqlite-do`. Write p50 2.2 to 4.15 ms. One of 5 racers won once the handler did a compare-and-set |
| 5 | What holds an object with no socket? | Nothing, locally. Plain, timer, `waitUntil` and cluster were all evicted within 200 s on both runtimes |

Speed, over three runs: Effect's append took p50 2.7 to 3.0 ms and p95 6.9 to 7.5 ms. The same
append with no Effect took p50 about 2.5 ms and p95 4.5 to 4.9 ms. So Effect costs up to 0.5 ms at
p50 and 2 to 3 ms at p95, which a person will not feel.

## The findings that change something

**Miniflare does sleep objects.** An object with one open socket went to sleep within 16 s, and the
socket stayed open. So `docs/direction/a-browser-is-always-a-client.md`, line 74, is wrong where it
says Miniflare never puts an object to sleep by itself, and "a ping does not wake it" is now checked
locally. This run did not edit that note. *Fixed 2026-11-02, when this write-up landed.*

**The sleep is a trap for any fiber.** Whatever is in memory goes when the object sleeps. A client
that sent `ledger.wait` keeps waiting. The plan's way out is the 5 s `door.knock`, which holds the
object awake only for a waiting row. Parked data removes that knock, and also covers `ledger.wait`
and `door.watch`, where the plan does not say how a wait survives. The attachment holds 16,384 bytes
([Cloudflare docs](https://developers.cloudflare.com/durable-objects/api/websockets/), updated
2026-10-30, read 2026-10-31).

**The wire is close to JSON-RPC, not quite it.** Calls and plain answers are real JSON-RPC 2.0. But:

```jsonc
// A failure, from Effect's layerJsonRpc. Code 0 for everything, the error buried in a Cause.
{"jsonrpc": "2.0", "id": 2, "error": {"_tag": "Cause", "code": 0, "message": "[...]",
  "data": [{"_tag": "Fail", "error": {"_tag": "Conflict", "top": 1}}]}}
// An unknown method is a Die with code 0, not -32601.
// A stream chunk is not JSON-RPC at all. The next chunk waits for a client's Ack.
{"jsonrpc": "2.0", "id": 3, "chunk": true, "result": [{"n": 1}]}
{"jsonrpc": "2.0", "method": "@effect/rpc/Ack", "params": {"requestId": 3}}
```

The plan's refusals as plain data dodge the first two. A server message that is not a reply was
ignored by Effect's client, without harm. It was not delivered, so the plan's news frames would
need a parked stream on an Effect client.

**A minor release broke one spike.** Effect 4.1.1 has no `effect/Crypto`, so part 2's entry fails at
start with `(void 0) is not a function`. Cluster now wants `crypto/Digest`. Parts 1, 3 and 4 ran on
4.1.1 unchanged. Every module sampled is marked `@stability unstable`, and 228 entries differ
between the two versions.

**The docs and the local runtime disagree on eviction.** Cloudflare's lifecycle page says timers
and pending work keep an object in memory. Locally, even on the newest runtime with a current date,
an object with a 1 s `setInterval` and one with an unfinished `waitUntil` were evicted within 200 s.
Our laptop runs are kinder than the cloud may be. Only a real cloud run can price this.

## Branch by branch

Costs are lines and agent hours. "Effect changes it" says what we would have to redo.

| Piece | Verdict | Why | Cost | If Effect changes it | Sure |
|---|---|---|---|---|---|
| Door protocol | STEAL | Alchemy's `RpcWebSocket.ts`: attachment, close 1012 on a lost call, one ping pair. RpcServer is proven but its door was 163 lines plus about 70 more, against about 320 hand lines, 218 of them already in an open pull request | Under 1 hour on the plan | Nothing, we copy ideas | 72% |
| Hello | KEEP | The plan's `Attached` is already the pattern Alchemy and effect-cf use | 0 | Nothing | 90% |
| Facts and append | KEEP, on raw `sql.exec` | The check and the number need one sync block. Eventlog drops author and clock. Steal the `WriteAck` shape, which the plan's `Rev` already matches | 0 | Nothing | 85% |
| Tail and `ledger.wait` | NEW, parked data | Part 1. Steal effect-cf's resume idea | About 40 lines, 1 hour | Nothing | 85% |
| Per-program storage | BUILD ON `ctx.storage`; `sql-sqlite-do` where a program wants `SqlClient` | One layer call. Its transactions had bugs, closed 2026-10-21 | About 5 lines | Small | 75% |
| Reconnect and catch-up | KEEP | `after` caught up rows 2 and 3 in part 1. The tea `link.ts` stays the client | 0 | Nothing | 85% |
| Queue and leases (Tier 4) | STEAL semantics, ADAPT to alarms | `PersistedQueue` is 2214 lines of polling. Take its at-least-once, take window and dead letter. One alarm wakes on the next due time | 200 to 300 lines, 3 to 5 hours | Nothing | 70% |
| Durable agent turns (Tier 5) | ADAPT `WorkflowEngine` (overruled 2026-11-02: a turn is a tea machine) | Part 3. `Activity`, `DurableClock`, `DurableDeferred` stay Effect's. We own the engine | 300 to 560 lines, 4 to 8 hours | We redo the engine against its `Encoded` type, 1 to 2 hours per break | 65% |
| Cluster | SKIP | Part 2. Steal the request-id dedup from `SqlMessageStorage` | 0 | Nothing | 85% |
| Eventlog | SKIP | Part 4 and the reading above | 0 | Nothing | 85% |
| MCP bridge (Tier 5) | Try Effect's `McpServer` | Would remove a Promise edge. Not run | 1 hour to try | Medium | 70% |
| `platform-browser`, atom, `sql-d1` | SKIP | A tab needs only `WebSocket`. A plain `useSyncExternalStore` does the same | 0 | Nothing | 80% |
| Rate limiter | STEAL | Its store has memory and Redis only. Fixed window on SQLite | About 30 lines | Nothing | 75% |
| Encoding and signatures | BUILD ON `Base64Url` now; read `effect/crypto/Signature` (4.1) for hello's Ed25519 after a bump | It wraps the same WebCrypto. Not run. Not in 4.0.6 | 1 hour to try | Small | 65% |
| Tracing | Not inside an object yet | The OTLP exporter holds a timer forever ([issue 10234](https://github.com/Effect-TS/effect/issues/10234), open 2026-10-31) | Flush by hand | Watch that issue | 80% |

Under 80%, the doubts:

- **Door, 72%.** Hands in Tier 4 may want a typed client. Settle it there: write the hands' methods
  both ways and count. About 2 agent hours. As long as door methods are single answers with
  refusals as data, the frames match, so the swap stays cheap. Plan ids are strings and part 1 used
  numbers, so that needs one check.
- **Agent turns, 65%.** `Workflow` replays Effect code, and tea is a state machine. That is two
  durable models side by side, and it breaks the Elm answer unless a turn counts as one bounded
  Cmd seen from outside. Settle it by porting one real turn both ways, then deleting the loser.
  **Overruled 2026-11-02:** settled without the port. A turn is a tea machine.
- **Queue, 70%.** Alarm retries stop after about 6 tries, so the engine needs its own watchdog. No
  run measured that.

## The boldest honest design

**Overruled 2026-11-02** by [tea is the engine](../docs/direction/tea-is-the-engine.md). Kept as
it was written.

Every object is an Effect `RpcServer` over a parked-stream Protocol. One typed `RpcGroup` is shared
by Effect clients and bare tabs. Turns are Effect Workflows on alarms, and their activity results
are ledger facts instead of rows in a private table.

```ts
// Sketch. About 500 lines of ours, the rest is Effect's.
export class Project extends DurableObject {
	webSocketMessage = (ws: WebSocket, text: string) => run(door.message(ws, text)); // one line
	alarm = () => run(engine.fire()); // one line
}
const Door = RpcGroup.make(
	Rpc.make("ledger.append", {payload: Append, success: AppendAnswer}), // AppendAnswer holds refusals
	Rpc.make("ledger.tail", {payload: Tail, success: Rows, stream: true}), // parked, not a fiber
);
const Turn = Workflow.make("Turn", {payload: TurnInput, success: TurnAnswer, idempotencyKey: (t) => t.id});
```

What it buys: typed calls on both ends, retries and middleware without writing them, and an agent
turn that reads top to bottom. What it costs: our wire is then defined by a module marked unstable,
the frame shapes above become our protocol, and each Effect upgrade needs a law run by a bare tab.
Sure: 60%. It is a fair bet for Tier 5, not yet for Tier 1. Nothing in Tier 1 blocks it.

## What others have done

Searched 2026-10-31.

- **Someone shipped this (published libraries; we did not find who runs them in production):**
  [effect-cf](https://github.com/danieljvdm/effect-cf) (last commit 2026-10-29) has a hibernating
  RPC transport and resumable streams.
  [Alchemy](https://alchemy.run/cloudflare/compute/hibernatable-websockets) has a Protocol and a
  `WorkflowEngine` on a Durable Object.
- **Cluster on a Durable Object, shipped:** found nothing. Searches of GitHub code found nothing
  either. Effect's community chat is not indexed, so it could hold more.
- **Someone wrote a demo:** [cevr/gent](https://github.com/cevr/gent) runs `SingleRunner` on
  `sql-sqlite-do` over a fake `DurableObjectStorage` in a test, with a next-wake query over the
  cluster's message table. No real object.
  [durable-effect](https://github.com/backpine/durable-effect) (experimental),
  [liminal](https://github.com/crosshatch/liminal) (actors over hibernating sockets),
  [effect-tea-durable](https://github.com/fgaudo/effect-tea-durable) (Elm for entities, not on
  Cloudflare).
- **Someone said it might work:** a maintainer says HTTP APIs work on Cloudflare with
  `toWebHandler` and that many use it
  ([effect-smol 2459](https://github.com/Effect-TS/effect-smol/issues/2459)).

Cloudflare's own rules:
[lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
(updated 2026-10-30),
[alarms](https://developers.cloudflare.com/durable-objects/api/alarms/),
[code updates](https://developers.cloudflare.com/changelog/post/2026-10-30-durable-objects-deferred-code-updates/)
(sockets on the hibernation API stay connected over new code, best effort),
[limits](https://developers.cloudflare.com/workers/platform/limits/) (64 MiB, so our bundle sizes
are fine).

## What fact is lost forever if we pick wrong

- **Eventlog as the ledger:** `by` and `said`. `Entry` holds only id, event, primary key and payload.
  Those facts exist only at write time.
- **A workflow's private tables as the record:** what each attempt did and how many there were, once
  a run is cleaned up. So write activity results to the ledger too.
- **Parked waits and the door's choice:** nothing. Both are rebuilt from the ledger and a reconnect.

## Can a tab still speak it?

Yes for the door in every recommended branch, with nothing installed, as part 1 shows. Effect's
client is optional, at 50 KB gzip. Eventlog is the one no: its wire is binary and its client code is
not a small thing to copy. One local catch: Miniflare refuses a socket from a foreign origin, so a
test page must come from the same origin. That guard is Miniflare's, not our door's.

## What this cannot tell us

- **Nothing ran on Cloudflare.** Sleep, wake times, alarm retries and code updates are Miniflare's.
  Bills are unknown. Part 5 shows local and docs differ on eviction, so a cloud run could change the
  cluster's case and any cost number. It could not rescue the cluster's first-call time.
- **The plan runs on Alchemy's local stage**, and these runs used plain Miniflare. They share
  workerd, but that was not checked.
- **Part 2 did not run on 4.1.1.** We stopped at the missing module. Fixing it is a few lines.
- **Part 4 ran the server only.** Client behavior comes from reading the code.
- **The engine is 161 lines of lab code.** It has no cleanup, no versioning and no watchdog. Its
  300-to-560-line estimate leans on Alchemy's 558, not on a build.
- **The door was not load tested.** One to a few sockets per object. A real one may scan many
  sockets per append. That is a small loop, but it was not measured.
- **Guess that was wrong:** we expected a tuned cluster to run with its polls turned down. It timed
  out. We also expected the newest runtime to keep a timer object in memory. It did not.
