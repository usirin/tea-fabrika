---
date: "2026-11-08"
summary: "`next/`, P33 step 1 (ticket 252); Miniflare 4.20260730.0, workerd 1.20260730.1, with `next/`'s own `recoverActivity`. Yes when the marker is on disk: 16 cases, 13 pass. The constructor ran on every wake, idle ones too (evict, 15 s idle, idle abort, both restarts), so \"constructor ran, so it crashed\" was wrong 7 times. A `stepping` marker survived a mid-step abort, a 10 ms gap, `storage.sync()` and a SIGKILL of workerd, and woke as `interrupted`. Lost twice: `ctx.abort()` right after an awaited put, or in the same turn, woke as `idle`. A thrown step does not rebuild the object. Evict let a 30 s step finish (my `interrupted` guess was wrong). Not P33's code but the plan's assumption: P11 must `sync()` the marker before the step works (85%). Cloudflare untested. No model, $0."
---

# 231. When a program's object is built again, does its saved marker tell sleep from interrupted work?

Run 2026-11-08 on the laptop: Miniflare 4.20260730.0 with workerd 1.20260730.1, Node v26.13.0,
for `next/`'s P33 (ticket 252, plan step 1). One throwaway Durable Object; the recovery answer
came from `next/`'s own `recoverActivity`. No network, no key, no model. $0.

**Answer: yes, when the marker is on disk. The constructor tells us nothing. But a marker can be
lost: `await ctx.storage.put()` returns before the write is durable, and an abort right after it
rolls the marker back.**

- **The constructor ran on every wake, idle ones included.** It ran again after workerd's evict
  (65 ms), after 15 s with no request, after `ctx.abort()` while idle, and after both workerd
  restarts. In each the saved marker said `idle` with the same process ID, and `recoverActivity`
  answered `idle`. "A constructor ran, so it crashed" was wrong 7 times in 16 cases.
- **A marker on disk gave the right answer every time.** Abort from a second request mid-step,
  abort 10 ms after the put, abort after `storage.sync()`, and SIGKILL of workerd mid-step all
  woke to `stepping`, and `recoverActivity` answered `interrupted` with the letter and build. A
  marker missing its fields woke to `bad_row`.
- **A marker can be lost.** `ctx.abort()` right after an awaited put, or in the same turn as an
  unawaited one, woke to `idle`: the `stepping` write was gone. With 10 ms between the put and
  the abort, or with `await ctx.storage.sync()` first, it was kept.
- **A step that throws does not rebuild the object.** The request failed, the constructor did
  not run, and the marker still said `stepping`. Nothing wakes to recover it, so the runner's own
  failure path must replace the marker.
- **workerd's evict did not cut a running step.** The 30 s step finished (the event took
  30,007 ms), wrote `idle`, and only then was the object rebuilt. My expectation said
  `interrupted`; that guess was wrong, and the case shows as FAIL in the output.

```ts
// The whole idea, as it ran. One object plays `counter:1`.
// worker: put("activity", {_tag: "stepping", process, letter, build}); ...work...; put(idle)
// event:  evict | wait 15 s | ctx.abort() | throw | dispose + new Miniflare | SIGKILL workerd
// read:   recoverActivity(await storage.get("activity"))   // next/'s own code
//   idle marker      -> {_tag: "idle", process}            same ID, no exited, no DOWN
//   stepping marker  -> {_tag: "interrupted", ..., why: "interrupted"}
//   broken marker    -> LedgerError {why: "bad_row"}
```

## Does this contradict what P33 built?

Not P33's code. P33 built `Activity` and `recoverActivity` in
`next/packages/libfabrika/src/coordination/process.ts`. On every case where the marker reached
disk, its answer was right, and it never looked at the constructor.

It does contradict one assumption in the plan. The plan reads "a saved unfinished step means
interrupted work" as enough on its own. The probe shows the writer has a window where the step
has started but the marker is not saved: two cases woke to `idle` while a step was running.
P33 does not write the marker; P11 does. So the fix lands in P11's runner, not in P33:

```ts
// Sketch, for P11. Make the marker durable before the step does anything.
yield* storage.put("activity", Activity.cases.stepping.make({process, letter, build}));
yield* storage.sync(); // ran here: the marker survived an abort right after it
// ...the step's work...
```

Losing the marker together with the step's own uncommitted writes is honest: neither happened.
It turns wrong only if the step's effect reached outside the object before the marker was
saved. Cloudflare documents output gates, which hold outgoing messages until writes commit;
this probe did not test them, so `sync()` is the lean (85%: measured here, cheap, and it does
not lean on an untested rule).

## The cases

Second run, the one with the two follow-ups. The first run gave the same answers on its 14 cases
(11 rule passes); the follow-ups were added after it lost the marker.

| Case | Constructor ran | Saved marker on wake | `recoverActivity` | Expected | Rule |
|---|---|---|---|---|---|
| Plain request, no wake | no | idle | idle | idle | pass |
| Idle, workerd's evict | yes | idle | idle | idle | pass |
| Idle, 15 s with no request | yes | idle | idle | idle | pass |
| Idle, `ctx.abort()` | yes | idle | idle | idle | pass |
| Step done normally | no | idle | idle | idle | pass |
| Mid-step, abort from a second request | yes | stepping | interrupted | interrupted | pass |
| Mid-step, evict | yes | idle | idle | interrupted (wrong guess) | FAIL |
| Step throws | no | stepping | interrupted | interrupted | pass |
| Abort after an awaited put | yes | idle (lost) | idle | interrupted | FAIL |
| Abort in the same turn as the put | yes | idle (lost) | idle | interrupted | FAIL |
| Abort 10 ms after an awaited put | yes | stepping | interrupted | interrupted | pass |
| Abort after put and `storage.sync()` | yes | stepping | interrupted | interrupted | pass |
| Idle, workerd restart (dispose, new Miniflare) | yes | idle | idle | idle | pass |
| Idle, workerd SIGKILL | yes | idle | idle | idle | pass |
| Mid-step, workerd SIGKILL | yes | stepping | interrupted | interrupted | pass |
| Broken marker saved, then evict | yes | stepping, no letter | bad_row | bad_row | pass |

Totals printed by the script: 16 cases, 13 rule passes, the plant right in 9. Two of the three
FAILs are the lost marker. The third is my wrong guess about evict.

## How it was run

```sh
env -u TYPESAFE_API_KEY nice -n 15 node --no-warnings experiments/231-process-wakes.ts
```

About 50 s, most of it the 15 s idle wait and the 30 s step evict waited for. The object is
SQLite-backed (`useSQLite: true`), persisted in a temp folder removed at the end. Evict is
Miniflare's `unsafeEvictDurableObject`, which calls workerd's own `evict`. The restart is
`dispose()` and a new `Miniflare` on the same folder; the kill is SIGKILL to the workerd child
of the script, found with `ps`. The script imports `process.ts` directly: the coordination index
pulls in a file Node's type stripping cannot run.

## What it cannot tell us

- **Cloudflare itself.** This is workerd on a laptop. Real hibernation, eviction times and
  shutdowns stay P24's stage check.
- **How wide the loss window is.** It was lost at 0 ms and kept at 10 ms, once each. The
  boundary was not measured, and on Cloudflare a commit is a network round trip, likely wider.
- **Output gates.** Whether an outgoing fetch after the put waits for the commit was not tested.
- **WebSocket hibernation.** No socket was held, so the hibernation path with sockets did not run.
- **Real P11 code.** No runner writes the marker yet; the worker is a stand-in.
- **The cause of a kill.** As the plan says, recovery can only say `interrupted`.
