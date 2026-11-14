---
date: "2026-11-09"
scripts: "`238-local-stage-speed-bar.ts` (branch `fabrikalfa/exp241-script`), `results/241-one-file-build.json`"
summary: "`next/`, P16 (ticket 282); 238's bar rerun on main after P12 (`a1327577`) and on P16's one built file (`6c6b24c3`), four base and five head runs in one sitting. Medians, base then head: accepted send 13.2 and 11.8 ms, publication 8.9 and 7.3 ms, lost link noticed 4.5 and 4.5 ms (new reading: one client kept open across the workerd kill), replacement 412 and 402 ms, reconnect 236 and 67 ms, workerd RSS 136 and 129 MB, start 4.79 and 1.80 s. Every head median is under its cap. The caps are a guess: ticket-115's rule on the base runs (3 times for the small readings, 1.3 times for the fixed waits). The first two base runs at load 12 to 14 make the start and reconnect caps loose. Brain 1,503,580 to 1,504,648 bytes, programs 467,455, window 0 (no program exports one yet). No model, $0."
---

# 241. The local bar on one built file

The raw samples (every reading of every run) are kept privately. Every number below is in
`results/241-one-file-build.json`.

This is P16, ticket 282, in `next/`. It reruns experiment 238's bar on main after P12 (base
`a1327577`) and on P16's one built file (head `6c6b24c3`): four base runs, then five head runs, in
one sitting, with the same settings and no chaos. Medians, base then head:

| Reading | Base | Head | Cap |
|---|---:|---:|---:|
| Accepted send | 13.2 ms | 11.8 ms | 39.7 ms |
| Cross-client publication | 8.9 ms | 7.3 ms | 26.8 ms |
| Lost link noticed | 4.5 ms | 4.5 ms | 13.5 ms |
| Replacement after a killed workerd | 412 ms | 402 ms | 536 ms |
| Reconnect | 236 ms | 67 ms | 307 ms |
| workerd RSS | 136 MB | 129 MB | 177 MB |
| Start to listener ready | 4.79 s | 1.80 s | 6.23 s |

Every head median is under its cap, so the one-file build does not make the local stage slower.
The brain is 1,503,580 bytes on the base and 1,504,648 on the head (1,068 more). The programs
are 467,455 bytes. The window scripts are 0 bytes, because no program on main exports `./window`
yet. All five head runs ran a brain with the same SHA-256, `a3739d65…`, which matches a fresh build of
the head.

```ts
// The whole idea: 238's driver, plus one client kept open across the kill.
const [watcher, ...rest] = clients.splice(0);
for (const c of rest) c.close();
const killedAt = now();
process.kill(workerd.pid, "SIGKILL");               // Alchemy replaces it, same address
await until(() => fetch(url).ok && newWorkerd());   // replaceMs
await until(() => watcher.closedAt !== undefined, 10_000);
reading.lostLinkMs = watcher.closedAt - killedAt;  // the client sees its socket close
```

## What changed in the driver

The driver lives on branch `fabrikalfa/exp241-script`, not on main. Experiment 241 added three
things to 238's script:

- **A lost-link reading.** One client stays open when workerd is killed. The reading is the time
  until that client's socket closes. This is the reading PR 223 called "lost link noticed"
  (17 to 23 ms then).
- **The sitting's facts.** Each run records its session name, its settings, chaos on or off, and
  the SHA-256 of the brain it ran. The T10 law refuses a bar whose runs differ in any of these,
  or whose head brain is not the one under test.
- **A `bar` mode.** It reads the base and head runs and writes the bar file the T10 law reads,
  with the caps below.

## The caps are a guess

P12 recorded no caps, so there were none to reuse. The lead set them from this sitting's four
base runs with [ticket-115's rule](../docs/plan/ticket-115.md#properties):

- three times the base median for the small readings: accepted send, publication, lost link;
- 1.3 times the base median for the fixed waits: replacement, reconnect, start, RSS.

The caps block only on the laptop. In CI the T10 law prints that it skipped the cap check, and
the behavior laws still run.

## Wrong guesses

- The lead's first guess was that lost link takes 30 to 75 s, the brain's 75-second ping timeout.
  That is wrong for this reading. The timeout is how long the brain waits before it marks a
  quiet client away. When workerd dies, the client sees the close in about 5 ms.
- The first sitting of this rerun had no lost-link reading, because 238's driver had none. Its
  medians are close to these (start 1.99 and 2.54 s, send 13.6 and 13.8 ms, reconnect 61 and
  75 ms) and are kept privately, not used for the caps.

## What this cannot tell us

- **The base's start and reconnect caps are loose.** The first two base runs ran at load 12 to
  14 on 12 cores and took 10.0 and 4.8 s to start, with 236 and 245 ms reconnects. The last two
  took 1.8 and 1.9 s, with 67 and 74 ms. The law's median takes the upper middle of four, so the
  start cap is 6.2 s and the reconnect cap 307 ms. A head that doubled its start time would still
  pass. A rerun at a lower load would give tighter caps.
- **Lost link is the client's view only.** It times the socket close after a kill. It says
  nothing about the brain noticing a client that went quiet without a close, which is the 75 s
  timeout.
- **No window bytes.** With no program exporting a window, the build's window path is not timed
  here. P14 is where that first counts.
- **One laptop, one sitting, under load.** Load was 9.2 to 14.4 on 12 cores the whole time.
- **Rendered checks.** P14 is not on this base, so none ran.

No model, $0.
