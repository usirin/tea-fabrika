# 144. The ledger's real Durable Object on real Cloudflare, measured from a laptop

The question: the ledger is going to Cloudflare
([the-ledger-goes-to-cloudflare](../docs/direction/the-ledger-goes-to-cloudflare.md)). Nothing
had run on a deployed Durable Object yet. How fast is today's object from the owner's laptop?
What does a cold object cost? Does the doorbell work over a real network? Does a redeploy lose
or double a fact? Where does an object live, and can we choose? Does GitHub's keys list answer
a Worker? And how does the plain class fit Alchemy, the deploy tool the note picked?

**Answer: the real object works on Cloudflare as it is, and Alchemy deploys the plain class with
no change. Reads are fast. Writes are fast too, except for a slow tail. Three things need a
plan: that write tail, a redeploy that leaves a busy object on its old code for minutes, and
GitHub's keys list.**

- **Reads:** 28 ms at p50 and 55 ms at p99 from the laptop. The network alone is 19 and 40.
- **Writes:** an append is 56 ms at p50 and 74 ms at p95, but 426 ms at p99. About 1 write in
  100 waits 0.4 to 0.8 s inside Cloudflare. That is far over
  [tea-host](../docs/direction/tea-host.md)'s 50 ms bar. Reads have no such tail, so a read
  cache, the note's answer to a slow ledger, would not fix it.
- **Two writers for 10 minutes, a redeploy in the middle:** run twice, 5,670 and 5,342 facts,
  0 lost, 0 doubled. A redeploy reached the Worker within 1 s. A busy object kept its old code
  until it went quiet: 5 minutes in one run. So a new Worker calls an old object for a while,
  and the calls between them must work both ways.
- **Cold:** an object restarts after 10 s with no call, not after the 70 to 140 s the docs
  give for eviction. Waking costs about 100 to 300 ms. A brand-new object's first call costs
  0.3 to 1.4 s.
- **The doorbell:** the other client hears a write 59 ms after it was sent, at p50, and most
  often before the writer has its own answer. 0 of 310 rings were missed, even across restarts.
- **The law suite:** 24 of 27 laws passed on the deployed object the first time. The three
  that failed wait on the laptop's clock for a lease's end. A busy object's clock reads up to
  about 0.1 s old, as Cloudflare documents, so the object still saw the lease live. Alone, the
  three passed 9 times in 9. The ledger stays safe; the laws need a margin.
- **Placement:** `locationHint` puts a new object where asked, and only on its first call.
- **GitHub:** 18 of 50 unsigned reads of the keys list were refused. A Worker shares its
  outbound addresses, and their 60 calls an hour, with other Cloudflare users.

**How sure: 80%.** The numbers are one laptop, one afternoon, one Cloudflare site (SJC). The
doubt is the write tail: it is clear in every part, but this run cannot say what causes it.

```ts
// The whole idea. The ledger's own class, unchanged, deployed by Alchemy behind a door that
// wants the run's key; the laptop measures, then destroys everything.

// alchemy.run.ts
const worker = yield* Cloudflare.Worker("Ledger", {
	name: "tf-exp-144-ledger",
	main: "./worker.ts",
	env: {LEDGER: Cloudflare.DurableObject("Ledger"), KEY_HASH, ROUND},
});

// worker.ts
import face, {Ledger as RealLedger} from "../../packages/fabrika/src/host/durable-object.ts";
export class Ledger extends RealLedger {
	timed(method, args) {/* the real call, plus: is this instance new? */}
	where() {/* which Cloudflare site this object runs in */}
}
export default {
	fetch: (req, env) => (keyOk(req, env.KEY_HASH) ? face.fetch(req, env) : notFound()),
};

// 144-durable-objects-live.ts, on the laptop
try {
	deploy();
	for (const part of [latency, two, place, github, bell, cold, soak]) results[part] = part();
	// Three short runs after it, each on its own deploy: `code` (the law suite, then the soak
	// with a redeploy that changes the code), `switch` (when busy objects take new code) and
	// `clocks` (the object's clock, and the three laws that failed).
} finally {
	destroy();
	list(); // no tf-exp-144 Worker, no namespace
}
```

## Who did what

- **This repo's code:** all of it. The Durable Object is
  `packages/fabrika/src/host/durable-object.ts`, unchanged. `experiments/144-durable-objects-live/`
  holds a thin Worker in front of it and the Alchemy stack. `experiments/144-durable-objects-live.ts`
  deploys, measures and destroys. The writers, the law suite and half of part 1 go through the
  repo's own client, `layerHttp` from `@kampus/fabrika/http`.
- **Cloudflare:** the Workers Paid plan the account already pays for. Alchemy 2.0.0-beta.84
  deployed, redeployed and destroyed the Worker.
- **Today's fabrika:** nothing. No agent, no model, no Jev. $0 in model calls.

## Setup

- One laptop on a home network. Every request reached Cloudflare at SJC, and the Worker ran
  there every time.
- One Worker, `tf-exp-144-ledger`, on a workers.dev address, with the ledger's class bound as
  a SQLite-backed Durable Object namespace. Compatibility date 2026-07-01, the one the
  Miniflare tests use. Workers Logs off.
- **The door.** Each run makes a 32-byte random key in the script's memory. The Worker holds
  only its SHA-256 and answers 404 to any path that does not start with the key. A wrong key
  and no key both got 404. The key never reached a file, a log or Alchemy.
- All data is made up: notes of about 100 bytes, a desk layout, a comment.
- **Five runs.** Each deployed at its start and destroyed in its `finally`:
  - `smoke`: a few calls of each part, nothing saved (2.3 minutes).
  - `full`: parts 1 to 7 (22 minutes).
  - `code`: about 2 minutes after full. The package's law suite on the deployed object, then
    part 5 again with a redeploy that changes the code (10.4 minutes).
  - `switch`: the laptop's clock against the Worker's, then when busy objects take a
    redeploy's new code (84 s).
  - `clocks`: the object's own clock, idle and busy, and the three laws that failed, again
    (84 s).
- Timing: "laptop" is the whole round trip, as a host would see it. "Worker" is the time the
  Worker waited on the object, from the `x-worker-ms` header. Percentiles are nearest-rank.

## 1. One object: append and read

300 of each, one after the other, on one warm object, with a ping (the Worker alone, no object)
between them. All 900 answered 200.

| ms, n = 300 each | p50 | p95 | p99 | max | in the Worker, p50 / p99 |
|---|---|---|---|---|---|
| ping (no object) | 18.9 | 27.7 | 39.5 | 66.9 | 0 / 0 |
| readLast | 28.1 | 36.7 | 55.3 | 355.9 | 7 / 12 |
| append | 56.0 | 74.4 | 426.2 | 759.5 | 35 / 410 |
| `layerHttp` readLast | 26.4 | 34.0 | 57.7 | 75.6 | |
| `layerHttp` send | 54.7 | 88.9 | 591.4 | 1135.8 | |

- The network to SJC is about 19 ms. A read adds about 9. An append adds about 37.
- **The write tail is inside Cloudflare.** In the Worker, p95 is 43 ms and p99 is 410: at
  least 4 of the 300 appends waited over 400 ms on the object. Reads never waited over 12.
  - A likely reason, not measured here: an object holds its answer until the write is stored
    durably ("output gates",
    [Cloudflare's blog](https://blog.cloudflare.com/durable-objects-easy-fast-correct-choose-three/)).
    The tail would then be the storage's, not the network's.
- The same tail shows in every part that writes: part 3's saves, part 4's rings and part 5's
  writers.
- **Against tea-host's bar** ("If a deployed ledger's p99 append is over about 50 ms, a direct
  host-to-host path comes next"): the p99 is 426 ms, and even the p50, 56 ms, is over it.
  - The note's planned answer, a read cache on each laptop, is for slow reads. Reads are not
    slow here. What a host needs is to not wait on a write where a person is waiting.
  - **Lean:** keep the ledger on Cloudflare, and make the host's writes not block a person: show
    the change at once and settle the write behind it. Why: the tail is 1 call in 100, and a
    direct host-to-host path would add a second system to fix it. Cost: the host must show a
    pending write and handle a refused one. **How sure: 65%.** The doubt: one afternoon. A
    second run on another day, and one from a far network, would show whether the tail is
    steady.
- A brand-new object's first call was 444 ms.

## 2. A cold object

30 new objects, each called once, then left alone for 5 to 300 s, then called again. The object
reports whether the instance that answers is new.

| idle, s | 5 | 10 | 15 | 20 | 30 | 45 | 60 | 90 | 120 | 150 | 180 | 240 | 300 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| objects | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 3 | 3 | 3 |
| new instance | 0 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 3 | 3 | 3 |
| ms, laptop | 37, 51 | 36, 31 | 157, 84 | 135, 176 | 211, 158 | 234, 64 | 215, 187 | 362, 156 | 154, 189 | 171, 130, 94 | 181, 138, 97 | 195, 299, 101 | 189, 136, 111 |

- **An object restarts after 10 s with no call.** 28 of 28 probes after 10 s or more found a
  new instance. The docs give 70 to 140 s for eviction, but also say an object that can
  hibernate does so "after 10 seconds of no incoming request or event"
  ([lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)).
  The ledger accepts its sockets the hibernation way, so this is the rule it follows, even with
  no socket open.
- At 10 s the restart was cheap (31 to 36 ms, the same as warm): the isolate was still there.
  From 15 s on, it cost 64 to 362 ms from the laptop. Over the 28: p50 156, p95 299, p99 362.
  In the Worker: p50 74, p99 263.
- A brand-new object's first call (30 of them): p50 394 ms, p95 1,319, max 1,443. That is the
  object made and its tables written for the first time.
- What it means for a host: a ledger that a person pokes every minute pays about 0.1 to 0.3 s
  on most calls, not once a day. A host's heartbeat under 10 s keeps its object warm. Whether
  that is worth its requests is for 145 and the bill to say.

## 3. A project object and a person object in one call

The person object holds a claimed `desk` and saves the desk's state with a fenced append. The
project object holds a ticket's inbox, and the call reads its last 20 facts. One request to the
Worker does both, side by side (`Promise.all`) or one after the other. 300 of each way, 100 of
each call alone. All 800 answered 200, and all 600 fenced saves were taken.

| ms | laptop p50 | laptop p95 | laptop p99 | in the Worker p50 | in the Worker p99 |
|---|---|---|---|---|---|
| both, side by side | 40.8 | 70.8 | 977.2 | 21 | 960 |
| both, one after the other | 50.2 | 100.7 | 556.4 | 30 | 540 |
| the save alone | 40.7 | 117.2 | 688.6 | 21 | 669 |
| the read alone | 29.1 | 42.4 | 56.4 | 9 | 16 |

- Side by side costs what the slower call costs (the save). One after the other costs both:
  about 9 ms more at p50. So a host's call that touches two objects should send both at once.
- The tail is the save's tail, both ways.
- These objects' saves were faster than part 1's appends (21 against 35 ms in the Worker).
  Where each object landed was not measured here; part 6 shows that it varies.

## 4. The doorbell

Two clients watch one stream through the real `/tail` socket. Client A writes 300 facts, 200 ms
apart, then 10 more after 12 s of quiet each. The time is from A sending the write to B's
socket hearing it.

| ms | n | p50 | p95 | p99 | max | missed |
|---|---|---|---|---|---|---|
| A's write to B's ring, object warm | 300 | 59.3 | 191.4 | 446.6 | 781.3 | 0 |
| A's write to A's answer, object warm | 300 | 61.4 | 228.2 | 471.4 | 779.1 | |
| A's write to B's ring, after 12 s quiet | 10 | 200.5 | 441.5 | 441.5 | 441.5 | 0 |

- **B often hears the write before A has its answer:** 218 of 300 times. The object rings the
  sockets, then answers the call. B's ring came at most 15.8 ms after A's answer.
- After 12 s of quiet, every one of the 10 writes found a new instance of the object, and both
  sockets still heard every ring. A hibernated socket stays open while the object restarts.
- 0 socket closes in the whole part.

## 5. Two writers, a redeploy in the middle

Two writer processes, each through `layerHttp`, write for 600 s at 5 facts a second, spread
over three registered inboxes. Half are plain sends, half are compare-and-set appends (read the
last rev, append at it). Three reconnecting watchers listen. At 300 s the script redeploys.
Afterwards it reads every stream back and checks each acknowledged fact.

| | full run: a redeploy that changes a binding | code run: a redeploy that changes the code |
|---|---|---|
| facts acknowledged | 5,670 | 5,342 |
| rows read back | 5,670 | 5,342 |
| lost, doubled, wrong stream | 0, 0, 0 | 0, 0, 0 |
| written but never acknowledged | 0 | 0 |
| gaps in a stream's revs | 0 | 0 |
| redeploy took (Alchemy) | 6.8 s | 3.0 s |
| the Worker answered on the new version | within 2 s of the redeploy's end | 0.1 s after its end |
| the object answered on the new code | (code unchanged) | never, in the 297 s left |
| object restarts seen | not looked at | 0 in 286 looks |
| socket reconnects | 0 of 3 | 3 of 3, once each, after the last call |

- **Nothing was lost or doubled.** The writers' only refusals were `Stale` (37 and 49), from
  racing each other on compare-and-set. Each one retried and landed. No call failed to reach
  the ledger.
- Writer timings, both writers together: sends p50 59 ms, p95 123 to 182, p99 387 to 417.
  Compare-and-set (two calls) p50 91 to 93, p99 553 to 565.
- The longest pause between two acknowledgements was 2.7 s, for both writers at the same
  moment, at 125.7 s. That is far from the redeploy, and nothing failed in it: one slow
  stretch of the platform.
- **Sockets.** With a binding-only redeploy, no watcher dropped: each connected once and heard
  about 1,890 rings. Cloudflare says "Code updates disconnect all WebSockets"
  ([WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).
  A new binding value is a new version but not new code, so the code run tried that case.
- **The code run: a busy object keeps its old code.** The build number is written into the
  bundle, so the redeploy was real new code. The Worker answered with it 0.1 s after the
  redeploy ended. The object the writers used did not: a look every 2 s (286 looks) saw one
  instance, on the old build, from the first second to the last, 297 s after the redeploy.
  Cloudflare's lifecycle page says a deploy with code updates shuts objects down. While calls
  kept coming, that did not happen here.
- Code run writers: sends p50 39 to 40 ms, p99 682 to 780; compare-and-set p50 68 to 72, p99
  752 to 845. `Stale` 65 and 66 times, all retried and landed. The longest pause was 1.8 to
  1.9 s, for both writers at once, at 441 s: again far from the redeploy.
- **Code run sockets:** all three watchers closed at the same moment, at 602.2 s, with code
  1006, about 2 s after the last call. Each came back on its first try, in 280 to 295 ms. A
  guess, not measured: once quiet, the object was moved to the new code, and that closed its
  sockets. No look ran after 600.3 s to show it.

## 5c. When a busy object takes new code

The code run raised the question; the switch run asked it. Seven objects took turns, one write
each about every 0.8 s, 335 writes in all, with a watcher on each. A redeploy with new code ran
from 20.0 to 22.7 s. Writes went on until 42.8 s. Then each object was left alone for its own
quiet time and asked once, then asked again 15 s later.

| quiet before the ask, s | 0.5 | 1 | 2 | 3 | 5 | 8 | 12 |
|---|---|---|---|---|---|---|---|
| build while busy, after the redeploy | old | old | old | old | old | old | old |
| build after the quiet | old | old | old | old | old | old | new |
| build 15 s after that | new | new | new | new | new | old | new |

- The Worker answered with the new build at 23.5 s, within 1 s of the redeploy's end. No ping
  failed.
- While busy, every object stayed on the old build and on one instance, for the full 20 s after
  the redeploy. An object made after the redeploy got the new build at once.
- After the writes stopped: asked after 0.5 to 8 s of quiet, every object was still old.
  Asked after 12 s, it was new. An ask is a call too, so the next ask came after 15 s of quiet:
  five of the six were new by then, and the 8 s object was still old. So the move comes at
  about 10 s or more of quiet, and not every time.
- No watcher on any of the seven closed, even on objects that changed build. The full run's
  binding-only redeploy closed none either. So "code updates disconnect all WebSockets" held
  once (the code run) and not here. Objects that moved after more than 10 s of quiet had
  probably hibernated first, and a hibernated socket survives a restart (part 4); this run
  cannot say more.
- **What it means: for seconds to minutes after a deploy, the new Worker calls the old object.**
  Cloudflare's own advice is the same: make changes between a Durable Object and its Worker
  forwards and backwards compatible, with or without gradual deployments
  ([with Durable Objects](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/)).
  - **Lean:** the calls between the ledger's Worker and its object change in two deploys: add
    the new call or field first, and remove the old one a deploy later. Why: we saw five
    minutes of mixing with a light load, and the docs promise no bound. Cost: a rename takes
    two deploys. **How sure: 85%.** The doubt is only how long the mixing lasts, not whether it
    happens.

## 5b. The law suite on the deployed object

The package's own law suite (`runLaws`, 27 laws) ran over HTTP against the deployed object,
through `layerHttp`. It is the suite `laws.test.ts` runs on the same object in Miniflare, where
every law passes. The suite runs all its laws at once, on one object.

- **The code run: 24 of 27 passed, in 10.9 s.** Laws 3, 12 and 18 failed, the same way each
  time. The first call after a lease's end still found the lease live: a new claim got `held`,
  and an old fence was taken where it should have been `fenced`.
- All three wait with `past(expiresAt)`: they sleep until the laptop's clock passes the end the
  object wrote with its own clock, then call at once.
- **My first guess was wrong:** that the laptop's clock ran ahead of Cloudflare's. The switch
  run measured it 54 ms *behind* the Worker's (p50, 20 readings). A laptop behind would make
  these laws pass more easily, not fail.
- **The clocks run read the object's own clock**, from the Worker, just before and after
  calling it. Idle, then while a whole suite ran on that object, three times:

| | the object's clock less the Worker's, ms, p50 (lowest) | laws that failed |
|---|---|---|
| idle, 20 readings | +7 (+5) | |
| whole suite, round 1, 35 readings | -55 (-102) | 3, 18 |
| whole suite, round 2, 34 readings | -34 (-63) | none |
| whole suite, round 3, 36 readings | -39 (-64) | none |

- Idle, the object's clock read 5 to 10 ms after the Worker's, which is the trip between them.
  Busy, it read up to 102 ms *before* the Worker had even sent the call. So a busy object's
  `Date.now()` is up to about 0.1 s old.
- Cloudflare documents why: `Date.now()` "returns the time of the last I/O. It does not
  advance during code execution"
  ([security model](https://developers.cloudflare.com/workers/reference/security-model/)). A
  busy object runs one call after another, and its SQLite calls are not I/O. In local
  development "timers will increment regardless"
  ([performance](https://developers.cloudflare.com/workers/runtime-apis/performance/)), which
  is why Miniflare never showed it.
- **Alone, one after the other, the three laws passed 9 times in 9.** Over the four whole
  suites run on Cloudflare, 5 of 108 law runs failed (3, then 2, 0, 0), always among these
  three.
- **Is the ledger wrong? No, as far as this shows.** Every lease decision is made inside the one
  object, on its one clock. It never takes the old fence and gives the lease to a new claim at
  the same time. A late clock only lets a lease live a little past its end, up to about 0.1 s
  here: the old holder keeps it that long, and a new claim waits that long. For a lease, that
  is the safe side.
- It does matter wherever code compares a time the ledger wrote with another machine's clock:
  the laws, and a host that plans to claim again right at a lease's end.
- **Lean for the laws:** wait a margin past the end, still inside the 1 s grace before the
  alarm: `past(at + 250)`. Why: the worst measured was about 100 ms; 250 ms leaves room and
  still leaves 750 ms before the alarm. Cost: each of those laws runs 0.25 s longer, and the
  margin is a number from one afternoon. **How sure: 75%.** The doubt: under a heavier load a
  busy object's clock could fall further behind than 250 ms. A run with many more calls at once
  would settle it. Not tried here: whether an `await` on real I/O inside the object gives it a
  fresh clock.

## 6. Placement

A new object for each hint, 20 reads each. The object reads its own site from Cloudflare's
trace page, the way [where.durableobjects.live](https://where.durableobjects.live/) does.

| hint | object's site | ms in the Worker, p50 | ms from the laptop, p50 |
|---|---|---|---|
| none | LAX | 16 | 34.9 |
| wnam | SEA | 28 | 46.5 |
| enam | MIA | 83 | 103.1 |
| sam | EWR | 71 | 88.4 |
| weur | LHR | 141 | 167.3 |
| eeur | VIE | 166 | 186.8 |
| apac | HKG | 162 | 184.6 |
| apac-ne | KIX | 113 | 132.4 |
| apac-se | HKG | 160 | 180.6 |
| oc | SYD | 157 | 176.2 |
| afr | AMS | 162 | 185.7 |
| me | PRG | 168 | 189.1 |

- **The Worker always ran at SJC**, the laptop's nearest site. With no hint, the object was made
  at LAX, near but not in the same place. The smoke run, just before, did the same.
- Every hint moved a new object to a site in that region, except the three the docs say do
  not spawn locally: `sam` went to EWR (North America east), `afr` to AMS and `me` to PRG
  ([data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)).
- An existing object asked again with `apac` stayed at LAX. A hint counts on the first call
  only, as the docs say.
- For two people far apart, the object sits near whoever touched it first. The second person
  pays the distance on every call: from SJC, Europe is 140 to 170 ms each way in the Worker.

## 7. GitHub's keys list from the Worker

50 calls to `GET /users/octocat/keys`, unsigned, 200 ms apart, from the Worker.

- 32 answered 200 (octocat lists 0 keys), 18 answered 403. No `retry-after` header. The limit
  header said 60 an hour, resource `core`, every time. p50 23 ms when it answered.
- **The calls left from at least two addresses.** The `remaining` header ran down two counts at
  once: one from 15 to 0, one from 57 to 41. One address had used 45 of its 60 before we
  started. GitHub counts unsigned calls by address
  ([rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)),
  and a Worker's outbound addresses are shared with other Cloudflare users. The smoke run's
  first call was refused too.
- So an unsigned keys read from a Worker cannot be the login path. The note's own fallback
  fits: keep the keys seen at join, and read GitHub again only for a new key. A signed call
  (a GitHub token on the server) would have its own limit; that was not tried here.

## Alchemy: how the plain class fits

- **It fits as it is.** Alchemy's "async Worker" form takes a plain module: `main` names
  `worker.ts`, and Alchemy bundles it with rolldown. No Effect runs inside Cloudflare.
- The object is bound by its exported class name, `Cloudflare.DurableObject("Ledger")`, inside
  `env`. Alchemy makes the SQLite-backed namespace and the first migration
  (`new_sqlite_classes`) by itself.
- `worker.ts` subclasses the real class only to add the two measuring calls. The ledger's code
  is the same file the Miniflare tests run.
- Deploys: 4.3 s (smoke), 11.9 s (full), 7.6 s (code), 3.7 s (switch), 4.2 s (clocks).
  Redeploys 2.7 to 6.8 s. Destroys 1.4 to 3.4 s. Each through the CLI,
  `alchemy deploy --stage exp144 --yes --no-input`.
- A build number in the code, not only in a binding, takes a `define` in the build:
  `build: {input: {transform: {define: {__EXP_CODE__: ...}}}}`. Alchemy hands it to rolldown
  as it is.
- **Two things to know before a real deploy:**
  - Changing the Worker's `name` replaces it, and a replaced Worker loses its objects' data.
    Alchemy's own diff says so ("a Worker replace would also destroy its Durable Object
    storage"). The ledger's Worker name must never change.
  - Taking the class out of `env` sends a `deleted_classes` migration, which deletes its data.
    Renaming the class is tracked and sent as a rename.
- The experiment's folder installs alone (`pnpm install --ignore-workspace`, its own lockfile),
  so the beta stays out of everyone's install. Both packages are pinned exactly.

### The API next to phoenix's

| | phoenix (beta.77) | here (beta.84) |
|---|---|---|
| packages | `alchemy`, with `alchemy/Cloudflare` inside | `alchemy` and `@alchemy.run/cloudflare`, the same version |
| Worker | the Effect form: `Cloudflare.Worker<Self>()(id, props)` with `.make(...)` | the async form: `Cloudflare.Worker(id, {main, env})` |
| Durable Object | `Cloudflare.DurableObject<Shape>()(...)`, written as Effect | the plain class, bound by name in `env` |
| state | `Cloudflare.state()`, a state-store Worker on the account | `Alchemy.localState()`, files in `.alchemy/` |

- Workers Logs are on by default in beta.84. This run turned them off, so no log line holds a
  path with the key.
- The Worker cache setting phoenix once patched in is a native `cache` prop in both versions.
- `Cloudflare.state()` would have put a second Worker on the account for Alchemy's own state.
  A real deploy that two people run needs it, or something like it: local state lives on one
  laptop. This run did not try it.

### Phoenix's four patches on beta.84

phoenix keeps four local changes to Alchemy beta.77 (its `pnpm-workspace.yaml` lists them). On
beta.84:

1. **Flagship updates keep settings made in the dashboard:** still needed. beta.84 still
   compares and sends the serving settings (default, rules, on or off) on every update.
2. **Test hooks honor Vitest's `hookTimeout`:** still needed.
3. **A pre-made Worker answers an uncacheable 503 until its deploy ends:** upstream. beta.84's
   placeholder answers 503 with `Cache-Control: no-store`.
4. **D1 migrations:** partly upstream. Refusing a rewritten history is in `@alchemy.run/sql`
   now (`RewrittenMigrationHistoryError`). Reading phoenix's mixed flat and folder layout, and
   its explicit "adopt" step, are not. The patch has to be made again for the new package
   split, since the code moved out of `alchemy`.

None of the four touches what this experiment used.

### Effect

- This repo uses `effect` 4.0.6 and `@effect/platform-node` 4.0.6. beta.84 asks for
  `effect` ^4.0.5.
- The experiment's lockfile resolves one `effect`, 4.0.6, and `@effect/platform-node-shared`
  4.0.6. No second Effect came in.
- phoenix's beta.77 sits on `effect` 4.0.0-rc.112. For phoenix, beta.84 would also mean moving
  to `effect` 4.0.5 or later.

### What Alchemy's state folder holds

`.alchemy/` here held 6 files after the deploy. The run checked each one:

- **Holds:** the account id, the key's SHA-256 (it is a binding), and the workers.dev address.
  Alchemy keeps binding values in plain text, even ones it marks as redacted.
- **Does not hold:** the API token or the key itself.
- So the folder is private: it is git-ignored, never committed, and the script deletes it after
  a clean destroy. A real server's state needs the same care, or `Cloudflare.state()`.

## Cost

**$0 more on the bill, and about $0.02 if nothing were included.** $0 in model calls.

The estimate came first: the script prints it before each deploy, and stops at 100,000
requests. The account already pays for Workers Paid ($5 a month), which includes 10M Worker
requests, 1M object requests and 400,000 GB-s of object time a month.

| run | estimate, Worker requests | counted, Worker requests |
|---|---|---|
| smoke | 720 | 745 |
| full | 12,355 | 12,032 |
| code | 10,609 | 8,859, and the law suite's calls |
| switch | 1,020 | 457 |
| clocks | 3,560 | 130, and four law suites' calls |
| all five | 28,264 | 22,223, and at most 4,360 law calls |

- "Counted" is every request the script and its two writers sent. The law suite sends its own
  calls through `layerHttp`, so they are not in the count; the estimates allowed 1,000 a suite
  and 40 a law, on the high side.
- Object requests were about the same as Worker requests: a ping and a GitHub call touch no
  object, and a part 3 call touches two. Watchers only received rings, and outgoing socket
  messages are free.
- Object time: at most about 600 GB-s. That is under 40 minutes of runs with a few objects
  awake at once, at 128 MB.
- **If nothing were included:** 28,264 Worker requests at $0.30 a million is $0.008; about
  28,000 object requests at $0.15 a million is $0.004; 600 GB-s at $12.50 a million is $0.008.
  About $0.02 in all.
- **Actual: $0 more.** Month to date, with every Worker on the account: 185,802 Worker
  requests, 360,945 object requests and 230,966 GB-s. All are under what is included. At this
  pace the month ends near 286,000 GB-s, still under 400,000.
- The account's analytics could not single this run out. A deleted Worker's rows no longer
  show by name, the object usage has no Worker name to filter on, and the sampled totals moved
  both ways between two reads (object requests read 363,283 during the code run and 360,945
  after it). So the bill above is worked out from the script's own counts.
- **How sure of the $0: 90%.** The doubt: whether the billing month is the calendar month.
  Even if it is not, the account is far from every included amount.

## What Cloudflare's docs say

Read 2026-10-25.

- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/):
  1M requests a month included, then $0.15 a million. 400,000 GB-s of duration included, then
  $12.50 a million GB-s, billed on 128 MB. Usage is "rounded up to the next billable unit". An
  object that is idle and can hibernate "is not billed for duration". Incoming WebSocket
  messages count 20 to 1; outgoing ones are free.
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/): $5 a month
  minimum, 10M requests included, then $0.30 a million. Subrequests are not billed. An RPC
  call on an object's stub counts as a request.
- [Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/):
  hibernation after 10 s with no request or event, eviction after 70 to 140 s, and a new deploy
  with code updates shuts objects down.
- [WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/):
  "Code updates disconnect all WebSockets." Hibernation keeps sockets open and bills no duration.
- [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/):
  one object per logical unit (a chat room, a user's data), no global object, about 500 to
  1,000 requests a second per object.
- [Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/):
  objects do not move; a hint is best effort and counts on the first `get()` only.
- [Security model](https://developers.cloudflare.com/workers/reference/security-model/) and
  [performance](https://developers.cloudflare.com/workers/runtime-apis/performance/):
  `Date.now()` is the time of the last I/O and does not move while code runs; in local
  development it moves anyway.
- [Gradual deployments with Durable Objects](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/):
  only one version of an object runs at a time, and changes between an object and its Worker
  should be forwards and backwards compatible.
- [GitHub's rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api):
  60 an hour unsigned, counted by address; 403 or 429 past it.
- The site-reading trick comes from where.durableobjects.live's source: an object fetches
  `https://www.cloudflare.com/cdn-cgi/trace` and reads `colo=`. That page is community code,
  not Cloudflare's docs.

## What it cannot tell us

- **Nothing about the second person's location.** Every call came from one laptop through SJC.
  Part 6 shows what distance costs from the Worker's side, not what a person in Europe would
  see end to end.
- One afternoon, one home network. The write tail may be steadier, or worse, on another day.
- What causes the write tail. The output-gate reason is a likely guess, not a measurement.
- How long a busy object can stay on old code. Five minutes was the longest we saw, and only
  because the run ended. It may have no bound while calls keep coming.
- Why the code run's three sockets closed 2 s after the last call, when the switch run's
  objects changed code with no socket closing. One case each way is not a rule.
- How far behind a busy object's clock can fall under a real load. The worst here, about
  0.1 s, came from one law suite at a time.
- The laptop never slept. How often a sleeping laptop's socket comes back broken is still open.
- The load was small: two writers at 5 a second. Cloudflare's limit is about 500 to 1,000 a
  second per object; 145 looks at the shape with many objects.
- GitHub: one 50-call burst. How often a Worker's shared address is used up depends on other
  people, and changes by the hour.
- `Cloudflare.state()`, custom domains and a deploy called from code were not tried.

## How to run it

```sh
cd experiments/144-durable-objects-live && nice -n 15 pnpm install --ignore-workspace && cd ../..
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account> node experiments/144-durable-objects-live.ts smoke
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account> node experiments/144-durable-objects-live.ts full
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account> node experiments/144-durable-objects-live.ts code
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account> node experiments/144-durable-objects-live.ts switch
CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account> node experiments/144-durable-objects-live.ts clocks
```

The token needs Workers Scripts: Edit on one account. Run with `TYPESAFE_API_KEY` unset; the
script refuses otherwise. `smoke` prints and saves nothing. `full` writes
`results/144-durable-objects-live.json`; `code`, `switch` and `clocks` add their answers to the
same file, each under its own name. A new `full` drops them. Each run stops at 100,000
requests. `plan` shows what Alchemy would deploy and deploys nothing.
