# 110. One ledger for the pipeline

The question: can the pipeline keep every record on tea-host's `Ledger`, with
no store of its own?

- Today (before this step) it has two: a JSONL file for operate's lanes and
  claims (`asks/ledger-disk.ts`), and an in-memory ledger for the desk.
- A claim there is a fact folded from the file. Nothing ever runs out, so a
  process that dies holding a ticket holds it for ever.

**Answer: yes.**

- Every pipeline fact now lives on tea-host streams, one name per ticket and
  one per plan. The folds in `asks/rules.ts` are unchanged, apart from the
  `claimed` case they no longer need.
- A claim is `register` plus the ledger's lease on the ticket's name. A lost
  lease fences the old holder.
- operate, the desk and the review record read the same ledger. The JSONL
  store and the desk's in-memory ledger are gone.
- 20 of 20 flows killed mid-way and started again fold the same state as an
  unkilled control.
- 50 of 50 claim races between two processes: exactly one winner.
- 5 of 5 freezes past the lease: 75 late writes tried, 0 accepted.

Confidence 85%. No model, no key, $0.

## The layout

```text
pipeline                                   never registered: a root, not a name
pipeline/ticket/<owner/repo#n>             registered by the first writer; claimed by a lane
  .../facts                                fenced: only the lease holder writes
  .../inbox                                open: anyone sends, deduped by message id
pipeline/plan/<owner/repo#n>               registered; never claimed
  .../inbox                                every plan fact is sent here
```

- **A fact's home.** `lane`, `released` and `ruling_needed` belong to the
  ticket. An `answered` belongs where its ask id says: `ruling:` to the
  ticket, `plan:` `stuck:` `check:` to the plan. Every other fact belongs to
  its plan.
- **An event is a fact.** Its kind is the fact's type and its data is the
  encoded fact. `readFacts` reads everything under `pipeline`, oldest first,
  and numbers the facts 1..N, so a fold still sees `at` 1..N.
- **A lane's id** is `L` plus the rev of its `lane` fact in the ticket's
  inbox: unique per ticket, the same when sent again under one message id.
- **A claim** (`asks/claims.ts`, the `Lanes` service):
  - `claim(name, lane, rev, ttl)`. One wins; the others are told `Held`.
  - The winner renews every third of the ttl from a fiber of its process.
  - A release is a fenced `released` fact, then a renew to 0 ms (etcd's
    LeaseRevoke): the next lane claims at once.
  - A lane started again after a crash has no fence. It waits its old lease
    out, then claims again as itself. The loop's door (`holding`) does the
    same, so a restarted operate run goes on.
- **tsh** keeps one node:sqlite file per repository (`*.sqlite` where the
  `.jsonl` was). The desk's facts now last from one `bin/tsh -c` to the next.

## The checks

### The pipeline's laws on three ledgers

`packages/fabrika/src/pipeline/asks/laws.ts`. Each law works on its own
ticket, so all five run at once on one ledger.

| Law | DO (Miniflare) | node:sqlite | memory |
|---|---|---|---|
| P1. every fact reads back once, in order, from its own name | pass | pass | pass |
| P2. a claimed lane refuses a write without its fence | pass | pass | pass |
| P3. a lost lease fences the old holder | pass | pass | pass |
| P4. one claim wins among 8 (10 rounds) | pass | pass | pass |
| P5. a release lets the next lane claim at once | pass | pass | pass |

Each plant was seen to fail its law:

- **No guard** (the ledger's own plant: an unfenced write under a name
  lands): P2 fails, 4 of 5 hold.
- **A misread** (rows of one ticket's stream handed back under the next
  ticket's name): P1 fails with "a fact of X read from Y", 4 of 5 hold.

### Kill and restart, 20 times

- **The flow** (`110-one-ledger-for-the-pipeline/child.ts flow`):
  - plan the ticket (experiment 89's first real plan)
  - approve the plan
  - start a lane
  - claim the ticket
  - a scripted review round: a `judged` and a `reviewed` fact, under the lease
  - let the ticket go
- **The set-up:**
  - Every step has a fixed message id.
  - The child reads the facts first, and stops when its lane let go already.
  - 150 ms between steps; lease ttl 1 s.
  - One Miniflare ledger in the harness process, a fresh Durable Object name
    per run.
- **Each run:**
  - SIGKILL the child's process group after step k (k = 1..5 in turn), plus
    0 to 150 ms.
  - Start it again and let it finish.
  - Compare its facts and its fold with the control's.

| | Result |
|---|---|
| Runs with the same fold as the control | 20 / 20 |
| Runs with the same facts, in the same order | 20 / 20 |
| Killed after step | 1, 2, 3, 4, 5, four times each |
| Control facts | 6: lane, planned, answered, judged, reviewed, released |
| Lease after the flow | free |
| Longest run | 2.6 s (a kill after the claim waits the 1 s lease out) |

### Claims across processes

- **Race:** two child processes, each told one start time, claim `o/r#r` at
  start + r × 40 ms, for 50 rounds, over HTTP.
  - 50 / 50 rounds have exactly one `claimed` event.
  - Both processes were told that lane every time.
  - 50 claims refused: one per round.
- **Freeze**, 5 times:
  - A child claims as L1 (ttl 1 s) and writes a fact under its fence every
    100 ms.
  - After 3 writes, SIGSTOP its group for 2.2 s.
  - Meanwhile the harness claims the ticket as L2.
  - SIGCONT, and let it write for 1.5 s.

| | Result |
|---|---|
| L2 took the ticket | 5 / 5 |
| Late writes the woken holder tried | 75 |
| Refused `Fenced` | 75 |
| Rows by L1 after L2's claim | 0 |

### The package's tests

All pipeline tests run on the in-memory tea-host Layer, apart from the
node:sqlite ones in `asks/ledger.test.ts`.

| | Before | After |
|---|---|---|
| Tests | 2029 | 2034 |
| Passed | 2025 | 2030 |
| Failed | 4 | 4 |

The 4 failures, before and after, are in `legacy/`
(`local.test.ts` ×2, `vetting.test.ts` ×2). They failed the same on the base commit before any change here, and they touch nothing changed here.

What changed, test by test:

- **`asks/ledger-disk.test.ts` (12) became `asks/ledger.test.ts` (9).**
  - Kept, on memory and a node:sqlite file:
    - the user's job (two runs, a fresh layer and a fresh process)
    - four processes × 40 rounds
    - the planted blind race
    - three layers on one file × 20
    - an unfit fact is never written
    - a row that is not a fact stops the read (now 4 cases, planted in the
      file with the ledger's own driver)
  - Merged: "empty" and "missing folder" into "a new file: no facts, the
    first fact is place 1". tsh now makes the folder (`fabrika-main.ts`).
  - Dropped, because the thing they test is gone:
    - the torn last line, and the last line with no newline: there are no
      lines. A sqlite transaction lands whole.
    - `appendAfter`: no such call. Its job, one compare-and-set, is the
      ledger's `claim` (`Stale`, `Held`), tested in `claims.test.ts` and in
      tea-host's law 3.
    - the lock a killed writer leaves: there is no lock. What replaces it is
      a lease that runs out, tested in `claims.test.ts` ("a lost lease").
  - New: a fact read back from another name breaks the read (3 cases); one
    message id writes a fact once.
- **`asks/claims.test.ts` (9) is rewritten (12).**
  - "A claim written blind after another" became "a claim on a held name, or
    at a rev the name has moved past, is refused by the ledger".
  - "Each new lane has an id of its own" is now per ticket.
  - New: a lost lease fences the old holder; a lane started again waits its
    old lease out; the door.
- **`asks/laws.test.ts`** is new (5): the laws above on all three ledgers,
  and the two plants.
- **`stages/operate/program.test.ts`**: the kill test now counts claims per
  ticket: [2, 2, 1]. A lane started again after a kill claims again, so two
  of the tickets have two `claimed` events, each by one lane. Every holder is
  free at the end.

## What went wrong on the way

- **A restarted operate run ended `stuck:ship`.** The resumed loop skips its
  claim, so it had no fence, and the door said no. Fix: the door, with no
  fence here, claims again as the same lane.
- **A test expected `Stale` and got `Held`.** The ledger checks `Held` before
  the rev. The test now checks `Stale` on a free name.
- **Bad data could not be planted through `append`.** The ledger encodes
  `data` as JSON itself. The bad-row tests write the rows into the sqlite
  file with the ledger's own driver instead.

## Open

- **Which ledger tsh uses, and where that is set.** Now: one sqlite file per
  repository, fixed. Lean: keep it, and make it a setting in S9.
- **Lane ids are unique per ticket, not across tickets.** Nothing needs more
  today.
- **A release that fails is not retried** until the lease runs out. That is
  the safe side: nobody else can take the ticket early.

## Run it

```sh
node experiments/110-one-ledger-for-the-pipeline.ts   # ONLY=laws|flow|race|freeze, KILLS=20, ROUNDS=50, FREEZES=5, TTL_MS=1000, PAUSE_MS=150
```

About 2.5 minutes. Results: `results/110-one-ledger-for-the-pipeline.json`.
