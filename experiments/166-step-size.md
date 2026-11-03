# 166: How a job's record keeps a machine's steps

**Answer: as a JSON Patch of the step before, with a whole state once the
patches since the last whole state would outweigh one, and at most 100 patches
in a row.** That is Mercurial's revlog rule. On a 100 KB tracker-shaped state
it keeps 200 steps in 235 KB, where a whole state every step takes 20 MB. On a
state that changes a fifth of itself each step, it never needs to read more
than two states' worth of bytes to rebuild one step.

- **Tally's state is too small to patch.** `{"total":6}` is 11 bytes; the patch
  that makes it is about 45. The record writes it whole every time, under every
  rule. 100 steps take 1,340 bytes.
- **A run costs about 8 calls to its record per Msg.** `seq --to 3 | tally`
  made 55 calls (42 reads, 10 writes, 3 steps). Each takes 0.25 to 0.5 ms on
  this laptop. Over a real network, those round trips are the cost, not the
  bytes.
- **Reading a record back gives every step's whole state.** For the tracker
  that is a 20 MB answer, 80 to 150 ms here. The read shape is fine for small
  states; a big one will want a lighter read.

```ts
// The rule, from packages/fabrika/src/host/job-rules.ts, shortened.
const patch = head === null || head.since + 1 >= keyframe ? null : JSON.stringify(diff(head.state, state));
const fits = patch !== null && head.chain + patch.length < whole.length;
const [kind, body] = fits ? ["patch", patch] : ["full", whole];
// head.since: patches since the last whole state. head.chain: their bytes, all told.
```

## Who did what

All of it is this repo's code: the `JobRecord` Durable Object, its SQL, the
`jobStorage` the runs write through, and the script. It ran on the ledger's
Miniflare twin in one process, every call through the door over HTTP. No
part of today's fabrika was used. Nothing was deployed. $0.

## The machine

Each Msg a machine folds becomes one row in the record's `steps` table: the
Msg, the Cmds it started, and the state after it. `kept.ts` hooks tea's
`observe`, refolds the Msg from the state before it to get its Cmds, and
queues the row. The record turns the state into a patch or keeps it whole.

```ts
// One step, as it crosses the door (traces.ts, JobCall).
{op: "step", run: "tally-5d02c7a1", machine: "count", id: "total",
 at: 1761000000000, msg: {type: "add", n: 2}, state: {total: 3}, cmds: []}

// The row it leaves (job-rules.ts, the steps table).
{run: "tally-5d02c7a1", machine: "count", id: "total", n: 2,
 msg: '{"type":"add","n":2}', cmds: "[]", kind: "full", body: '{"total":3}', by: "user:owner"}
```

Reading a record rebuilds each state from its last whole state and the patches
after it, in one pass over the rows.

## The workloads

| Workload | What | Whole state |
|---|---|---|
| `tally3`, `tally100` | the real `seq --to N \| tally`, both programs kept in the record | 11 to 14 bytes |
| `tracker` | 200 steps of a state shaped like `programs/tracker`'s `Tracker`: 75 tickets of 4 timeline entries, then comments land, tickets open, close and reopen, a search is typed, writes queue and land | 100 KB median |
| `churn` | 200 steps of 50 slots of 400 characters, 10 slots rewritten each step | 20 KB |

The tracker and churn text is made up. Their steps go straight to the record
as `step` calls, as `jobStorage` sends them.

## What came back

Bytes kept for 200 steps, by the most patches allowed in a row (N). "Count"
is the first version: a whole state every N steps, whatever the sizes, and a
patch in between unless it is no smaller. "Bytes" is the rule kept. "Rebuild"
is the most bytes read to rebuild any one step: its whole state and every
patch after it.

| N | tracker, count | tracker, bytes | churn, count | churn, bytes | churn rebuild, count | churn rebuild, bytes |
|---|---|---|---|---|---|---|
| 1 | 20.0 MB | 20.0 MB | 4.03 MB | 4.03 MB | 20 KB | 20 KB |
| 5 | 4.04 MB | 4.04 MB | 1.52 MB | 1.52 MB | 38 KB | 38 KB |
| 20 | 1.04 MB | 1.04 MB | 1.05 MB | 1.52 MB | 105 KB | 38 KB |
| 100 | 235 KB | 235 KB | 923 KB | 1.52 MB | 463 KB | 38 KB |

- **On the tracker the two rules write the same bytes.** Its patches average
  237 bytes against a 100 KB state, so the bytes rule never comes first; N does.
- **On churn the count rule grows the rebuild without bound.** At N = 100 a
  step can need 463 KB read, 23 whole states, for 40% fewer bytes kept. The
  bytes rule writes a whole state every 5 steps and caps the rebuild at 38 KB.
- **The record's own bytes equal the simulated bytes rule** in all 8 runs, to
  the byte. The script runs both rules on the same steps with the same `diff`.
- The tracker's worst rebuild at N = 100 is 123 KB, 1.2 states.

## Time and writes

Time per call, median and 95th percentile, N = 100, through the door on this
laptop:

| Call | How many | Median | p95 | Slowest |
|---|---|---|---|---|
| `get` (tally100) | 624 | 0.25 ms | 0.32 ms | 2.2 ms |
| `set` (tally100) | 107 | 0.33 ms | 0.41 ms | 0.6 ms |
| `step` (tally100) | 100 | 0.35 ms | 0.43 ms | 1.4 ms |
| `step` (tracker, 100 KB) | 200 | 1.8 ms | 2.4 ms | 9.8 ms |
| `step` (churn, 20 KB) | 200 | 0.7 ms | 1.0 ms | 3.1 ms |
| `read` (tracker, 200 steps, 20 MB answer) | 10 | 81 ms | 83 ms | 83 ms |
| `read` (tally100, 16 KB answer) | 10 | 2.0 ms | 3.0 ms | 3.0 ms |

An earlier run of the same script, before the bytes rule, gave the same
picture with more spread: a slowest `get` of 40 ms and tracker reads up to
186 ms. One laptop, other work running, so read the slow tails loosely.

- A tracker step costs about 1.8 ms whatever N is: the record makes the patch
  and the whole state's text every time, to compare them.
- **Writes per run.** `seq --to 3 | tally`: 55 calls. `seq --to 100 | tally`:
  831, of which 624 reads. Each save of a machine's state reads the key's two
  slots and the run's record twice (the fence), then writes: 5 calls. Each
  step reads the fence again, then writes: 3 calls. Both runs together took
  257 to 302 ms for 100 numbers here.

## Recommendation

**Keep the bytes rule with N = 100 as the default.** Why: it keeps the
tracker-shaped state 85 times smaller than whole states, it bounds how much a
reader must rebuild for any state, and it leaves tiny states whole, where a
patch would be bigger. It is the rule Mercurial's revlog has used for years
for the same trade. Cost: on a state that changes a lot each step it keeps up
to 65% more than the count rule, and it takes the whole state's text on every
step to compare (1.8 ms at 100 KB). How sure: 85%. The doubt is the workloads:
two of the four are made up. What would settle it: a week of real lane
records, measured with this same script's `sizes`.

**Next, cut the round trips, not the bytes.** About 8 calls per Msg is fine
on a laptop and slow across a network: at a 30 ms round trip, `seq --to 100 |
tally` would spend about 25 s waiting. A `Storage` that knows it is a record
could send one call per save, with the fence and the slot write done inside
the record's transaction. Cost: a second `Storage` beside the one every
storage shares, so its laws must run on both. How sure it is needed: 90%. How
sure of the fix: 70%; the doubt is whether the fence can move into the record
without the slot laws changing.

**Later, a lighter read for big states.** The trace tile reads every step's
whole state. Steps without their states, and one state on ask, would make the
tracker's 20 MB answer some tens of KB (a guess: its Msgs and Cmds are 9 KB,
plus each row's names). Not now: the tile is being built on today's shape,
and no record has a big state yet.

## What it cannot tell us

- How a real Cloudflare Durable Object times these calls. Miniflare runs
  workerd on this laptop, with no network between the host and the record.
- Whether real tracker steps look like these. The shape is the real schema's,
  but the mix of Msgs is a guess.
- What the steps of an agent-driven lane cost. None ran here.
- Whether a record grows past what one Durable Object should hold. 235 KB per
  200 tracker steps is far from it, but nothing is ever deleted.

## Files and how to run

- `166-step-size.ts`, the script. `results/166-step-size.json`, its answers.
- `packages/fabrika/src/host/job-rules.ts`, the rule. `job-record.ts`, the
  Durable Object. `program/json-patch.ts`, the patch, and its law test.

```sh
env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 node experiments/166-step-size.ts
```

It takes about 12 seconds and prints one line per N.
