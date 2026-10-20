# 95. An agent asks an agent in a container, through the shared ledger

The question: tea-host's second test ([tea-host](../docs/direction/tea-host.md)).
An agent on one host asks an agent on a second host, run in a Docker
container, a question and gets the answer, both hosts on one shared ledger.
The call has a timeout and is retried. Does every question get exactly one
answer, the right one, while the container is killed, taken over by a
second container, and the asking host is killed?

**Answer: yes, on every run. Three runs of 200 questions and one of 2,000,
each with the answerer's container killed twice (`docker kill`), one
takeover by a second container while the first was frozen (`docker pause`),
and one SIGKILL of the asking host on the Mac. Every question was answered
exactly once, with the right answer. No answer was produced twice. Every
reply in the asker's inbox came from the host that held `answerer:1` at the
time, and the frozen owner had 0 writes accepted after it woke. A call
round trip from the Mac to the container and back takes 11 ms at p50 and
20 to 21 ms at p99 with no faults (11 and 14 to 15 ms with both hosts on
the Mac). A container goes from `docker run` to owning `answerer:1` in 369
to 441 ms. A takeover takes the rest of the lease (ttl 1 s) plus 2 to 28 ms
for the claim and 11 to 61 ms more for the first answer. A container host
uses about 150 MiB (`docker stats`), 190 to 200 MB of Node RSS. One thing
the dedupe does not cover: the agent's work. In each run the frozen owner
finished one agent run after it woke; its answer was refused, and the new
owner had already asked its own agent the same question. The answer is
exactly once; the work is at least once. Confidence 80%.**

```ts
// A call is OTP's gen_server:call: one append, a reply-to, a timeout.
asker:1     append answerer:1/inbox  {id: "q-7", corr: "asker:1#7", replyTo: "asker:1/inbox", text}
            deadline runs out  ->  append again, the SAME id (tries 2, 3, ...)
answerer:1  id new      -> ask the agent, save {answered +1, last: {id, answer}}, then reply
            id on record -> reply with the saved answer, the agent is not asked (idempotency key)
asker:1     first reply for a pending corr answers the call; a later one is counted and dropped
// Every save and every reply is fenced on the writer's own registry lease (`fenceOn`).
// tea saves a step before its Cmds run, so a reply is sent only after its answer is on record.
```

## Who did what

- **The ledger:** experiment 93's `Ledger` Durable Object, copied to
  `95-agents-across-hosts/ledger/` with one change: `append` takes
  `fenceOn`, the stream whose lease the fence is checked against. Without
  it, 93's fence guards only the lease's own stream, and a reply into
  `asker:1/inbox` from a host that lost `answerer:1` could not be refused.
  `daemon.ts` runs it in Miniflare on workerd's direct socket, bound to
  127.0.0.1, in its own process group. Docker Desktop forwards a
  container's `host.docker.internal` to the Mac's loopback, so the ledger
  listens on no other address.
- **The ledger client (`client.ts`):** 94's Effect service, plus `fenceOn`
  and a `sender`: an append at the end of another program's inbox (a
  compare-and-set on a cached rev, retried on `stale`).
- **The call machine (`call-machine.ts`):** the asker's calls as a pure tea
  machine. Pending calls with their tries and deadlines, a window of 8, a
  cursor over its inbox. Deadlines come in as a Sub (`deadlines`), so the
  machine has no clock. A restart (`resume`) sends every pending call again
  under its id.
- **The answer machine (`answer-machine.ts`):** `answered` (a new answer:
  count it, put it on record, reply) and `repeat` (an id answered before:
  reply with the answer on record). Its program (`answerer.ts`) decides
  which, from the answers on record, and asks the agent only for a new id.
- **The hosts (`host.ts`):** 94's host machine, imported unchanged, runs
  either program by `PROGRAM=asker|answerer`. The same file runs on the
  Mac and in the container.
- **The container (`Dockerfile`, `install.sh`):** `node:26.12.0-slim` (the
  repo's Node), pnpm, and nothing else. The repo is mounted read-only at
  `/repo`; Linux `node_modules` come from a named volume filled once by
  `install.sh` (a frozen, production-only install). No source, no
  `node_modules` and no secret go into the image.
- **The agent (`agent.ts`):** a stub (arithmetic after `STUB_MS` of
  "thinking", checkable and free) for every run here, and Claude Code
  through the Agent SDK (no tools, no MCP, no settings, one turn) behind
  `REAL=1`.
- **The harness (`95-agents-across-hosts.ts`):** builds the image, fills
  the volume, starts the ledger, host B in a container and host A on the
  Mac, lands the faults, reads the whole ledger and checks it, then removes
  every container, image and volume it made (they carry the label
  `exp95`). Node at the edge: process groups, signals, `ps`, `docker`.
- **The laws (`laws.ts`):** both new machines walked by the repo's checker
  (`wip/src/laws/explore.ts`), each law seen to fail once on a planted
  mistake.
- Built and run by an agent (Claude) in one session, on one Mac.

## The run

- Host B (`answerer`, registered as `answerer:1`) starts first in a
  container; host A (`asker`, `asker:1`) then starts on the Mac.
- Faults, 3.5 s apart, starting 1.5 s in: `docker kill` the owner and
  `docker start` it 300 ms later, twice; start a second container `b2`,
  wait until it is up, `docker pause` the owner for 2.5 s (past its 1 s
  lease) and wake it; SIGKILL host A's process group and start it again
  300 ms later. Every fault lands while calls are open.
- small: 200 questions, the stub thinks 80 ms. large: 2,000 questions, 6 ms.
  Window 8, call timeout 1.5 s, lease ttl 1 s, renew every 250 ms.
- latency: 200 calls one at a time (window 1), the stub answers at once, no
  faults; once with the answerer in a container, once with it on the Mac.
- The checks read the ledger, not the hosts' word: the asker's saved
  states (each +1 names the call it answered), the answerer's saved states
  (each +1 names the id it answered), every question and reply event and
  who wrote it under which fence, and every claim.

## Acceptance

| Check | small 1 | small 2 | small 3 | large |
|---|---|---|---|---|
| Questions answered, right answer | 200/200 | 200/200 | 200/200 | 2,000/2,000 |
| A question answered twice, or not at all | 0 | 0 | 0 | 0 |
| Answers produced (each id once) | 200, 0 twice | 200, 0 twice | 200, 0 twice | 2,000, 0 twice |
| Replies not from the lease holder | 0 of 232 | 0 of 232 | 0 of 232 | 0 of 2,008 |
| Frozen owner's writes accepted after waking | 0 (2 refused) | 0 (2 refused) | 0 (2 refused) | 0 (2 refused) |
| Two believing owners, both with an accepted write | never | never | never | never |
| Retried calls (same id) / replies from the record | 32 / 32 | 32 / 32 | 32 / 32 | 8 / 8 |
| Agent runs / ids the agent ran twice | 201 / 1 | 201 / 1 | 201 / 1 | 2,001 / 1 |
| Finished after the first question | 21.1 s | 21.1 s | 21.1 s | 24.4 s |

- Every one of the four `pass` checks in the results file is true on every
  run. `pnpm typecheck && pnpm lint && pnpm test` pass from the root.
- The retries are the timeout doing its job: while host B is down (about
  1 s) and catching up, some calls pass 1.5 s and are sent again under the
  same id. Each repeat gets the answer on record, so the asker's inbox has
  two replies for those ids; the asker takes the first and counts the
  second as `extra`. Delivery is at least once; the answer is once.
- The agent ran twice for one id per run, each time in the takeover: the
  owner was frozen mid-answer, `b2` claimed and asked its own agent, and
  the woken owner finished its run, tried to save, and was refused
  (`stale`). It never replied: its save came first and failed, so its reply
  Cmd never ran. A run cut short by `docker kill` leaves no log line, so the
  real count of agent runs is at least the one shown.

## Measures

| Measure | Value |
|---|---|
| Call round trip, Mac to container to Mac, no faults (200 calls, two runs; the results file holds the second) | p50 11 ms, p99 20 to 21 ms, max 25 ms |
| The same with both hosts on the Mac | p50 11 to 12 ms, p99 14 to 15 ms |
| One question append (the send) | p50 0 to 1 ms, p99 2 to 7 ms |
| `docker run` to host up / to owning `answerer:1` | 355 to 426 ms / 369 to 441 ms |
| `docker start` (restart after a kill) to host up | 358 to 405 ms |
| The same host as a Mac process, start to owning | 292 to 324 ms |
| Kill of the owner to the new owner's claim | 993 to 1,033 ms (lease left 985 to 1,023 ms, so 2 to 13 ms after it ended) |
| Kill to the first answer under the new owner | 1,009 to 1,061 ms |
| Pause to `b2`'s claim (takeover) | 865 to 924 ms (7 to 28 ms after the lease ended) |
| Pause to `b2`'s first answer | 890 to 950 ms |
| SIGKILL of host A to its new claim / its first save | 829 to 854 ms / 851 to 866 ms, 8 calls pending, all resent |
| Replay at a takeover (registry and inbox) | 6 to 46 ms, 7 to 10 questions of backlog |
| The frozen owner notices it lost / its program stops | 27 to 39 ms / 26 to 40 ms after waking |
| Container host memory | `docker stats` 140 to 173 MiB; Node RSS in the container 191 to 223 MB |
| Host A on the Mac | 219 to 227 MB (298 MB on the large run) |
| workerd (the ledger) | 83 MB (latency), 155 to 161 MB (small), 381 MB (large) |
| Image build / volume fill, once | 0.2 to 0.4 s with the layer cache; 6.1 to 6.7 s for a fresh 765 MB volume (base image already pulled) |

- The round trip is mostly polling: each host reads the ledger's log every
  5 ms when it is idle, so a call waits up to 5 ms on each side. The
  container adds about nothing at p50 and about 6 ms at p99 over Docker
  Desktop's forwarding.
- In the faulted runs a call takes 690 ms at p50 (small) because 8 calls
  queue behind an 80 ms stub; p99 is 1.75 to 1.77 s, the calls caught in an
  outage.

## The laws

```
calls     13,789 states (depth 8, 515 ms), 9 laws hold, 8 of 8 planted mistakes caught
answerer  210 states (depth 6), 4 laws hold, 5 of 5 planted mistakes caught
host      370 states (depth 10, 94's machine and laws), 6 laws hold, 6 of 6 caught
```

- calls: a call is answered at most once; every send of a call carries the
  same message id; a call is sent only while pending; at most `window`
  pending; a reply at or behind the cursor changes nothing; a reply for a
  call not pending answers nothing; a call whose deadline ran out is sent
  again; a restart sends every pending call again; an answer is marked
  right only when it is.
- answerer: the cursor never goes back; a question at or behind the cursor
  changes nothing and sends nothing; a new answer counts once and is on
  record; each question past the cursor gets exactly one reply, to its
  caller, with its answer.
- Planted mistakes include "fresh id on retry", "forgets at restart",
  "counts a late reply", "replies twice", "answers twice on replay". All
  bounded, none complete.

## What went wrong, and surprises

- **93's fence did not reach another program's inbox.** A lease fences only
  writes to its own stream, so a host that lost `answerer:1` could still
  append a reply to `asker:1/inbox`. Fixed in this copy with `fenceOn` on
  `append` (`coalesce(?8, ?1)` in the lease check). 94 asked for a lease
  over a stream prefix; this run needed something wider, a fence over a
  write to any stream.
- **The first measure of takeover was off by one renew.** The harness read
  the lease before the fault, and a renew could land in between: the claim
  looked 257 ms late. Reading the lease after the fault lands put it at 2
  to 28 ms. A harness bug, fixed before the runs reported here.
- **A missing login looks like an answer.** With no login, Claude Code in
  the container returns a result of subtype `success` with the text "Not
  logged in · Please run /login", in 0.5 s. Only `is_error` says it failed.
  `agent.ts` now reads `is_error`. A run of the whole real path with a
  made-up login value gave one call, answered with "no answer: ...", judged
  wrong, in 4.3 s; nothing else changed.
- **Small things:** Node 26's image has no corepack, so the image installs
  pnpm with npm. Node names its main thread `node-MainThread` in `/proc`.
- **Another experiment ran on the same Mac** the whole time (its own Node
  and workerd processes). The numbers carry that noise.

## What this means

- **The call: OTP's `gen_server:call` fits a tea machine with no new
  shape.** Send, reply-to, correlation id and timeout are four fields of
  one append; the timeout is a deadline Sub; the retry is a Msg. Elm's
  answer (time comes in as a Sub, effects go out as Cmds) was enough, and
  the laws run on it as on any reducer. Recommendation: lift the call
  machine into tea-host as the one way to call another program. Why: the
  same-id retry and the restart resend are easy to get wrong (two planted
  mistakes) and now have laws. Cost: a shared module and its laws.
  Confidence 75%.
- **Timeouts:** a timeout shorter than a takeover (lease ttl plus about
  20 ms) makes retries during every outage, here 32 of 200 calls. That is
  safe, since retries are deduped, but each is an extra append and reply.
  A call timeout of about twice the ttl would retry only for real losses.
- **Dedupe: the message id is an idempotency key, and the record is the
  answerer's own saved state.** Because tea saves a step before its Cmds
  run, an answer is on record, under the fence, before anyone hears it, and
  a host that lost the name cannot reply at all. That holds the answer to
  once. It does not hold the work to once: an agent that is killed or
  frozen mid-run is run again by the next owner. For an agent with side
  effects (a commit, a comment, a payment), the idempotency key has to go
  into those tools too. That is the next thing to test with a real agent.
- **The fence over another stream (`fenceOn`) belongs in the ledger.**
  Recommendation: make "this write is fenced on that name's lease" a ledger
  feature, not a per-experiment copy. Why: every reply crosses into another
  program's stream, and without it a zombie's reply lands. Cost: one more
  argument on `append` and its laws in `sql.ts`. Confidence 80%.
- **Container hosts are cheap and ordinary.** The same `host.ts` ran in a
  container and on the Mac; a container owned its name 0.4 s after
  `docker run`, used about 150 MiB, and took `docker kill` and `docker
  pause` as faults the ledger already handles. No secret went into the
  image: the real agent's login is one variable passed by name at
  `docker run`. For CI on Linux, `host.docker.internal` maps to the bridge
  address (the harness passes `--add-host host.docker.internal:host-gateway`),
  so a ledger bound to 127.0.0.1 is not reachable there; the ledger would
  run in a container on the same network instead.

## A2A, side by side

- A2A's **Agent Card** (JSON at a well-known URL: name, skills, endpoint,
  auth) is our program's `defineProgram` name, description, inputs and
  outputs plus its registered address `answerer:1`.
- A2A's **Message** (`messageId`, role, parts, `contextId`, `taskId`) is our
  `ask` and `reply` events: its `messageId` is our message id (the spec
  also lets a server use it to spot duplicates), its `contextId` our `corr`.
- A2A's **Task** (server id; submitted, working, completed, failed...) has no
  match: our call is the whole task. A long agent job would want task
  states on the ledger too.
- A2A moves over HTTP (JSON-RPC `SendMessage`, poll `GetTask`, SSE, push
  webhooks); we move over ledger appends and a tail. A gateway at the edge
  could serve a tea-host program as an A2A server: `SendMessage` appends to
  the inbox, `GetTask` reads the reply. Not built.

## What this does not show

- **One Mac.** Docker Desktop's VM is the only "network"; no partitions,
  no clock skew, no second computer. The overlap check compares times from
  one clock.
- **No real agent ran.** Every answer came from the stub. The real path was
  run once with a made-up login, so only its wiring is shown: Claude Code
  starts in the container, reads the read-only repo, and its failure comes
  back as an answer.
- **The ledger was not faulted**, and runs on 127.0.0.1 only.
- **One name per host, one caller.** Many callers on one answerer, and an
  answerer calling back, are not tested.
- **Laws are bounded**, not complete.

## How to run it

```sh
node experiments/95-agents-across-hosts.ts
# ONLY=laws|latency|runs, RUNS=small,small,small,large (small: 200 questions, large: 2,000;
# each with 2 container kills, 1 takeover, 1 kill of host A), LATENCY=200, WINDOW=8,
# TIMEOUT_MS=1500, TTL_MS=1000, RENEW_MS=250, STOP_MS=2500, RESTART_MS=300,
# KEEP_LOGS=<a folder>, KEEP_IMAGE=1, SAVE_AS=runs. About 2.5 minutes. Needs Docker.
# No key, no model. Removes every container, image and volume it made (label exp95).

# The real agent: one fixed question ("What is 17 times 23?"), no faults. The login is
# read by name only; the harness never prints or stores it. Results go under `real`.
CLAUDE_CODE_OAUTH_TOKEN=... REAL=1 node experiments/95-agents-across-hosts.ts   # MODEL=haiku
```
