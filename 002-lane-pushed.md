REPORT: ticket 955's lane is pushed at 703c5fa, the review and its recheck say done, and every check is green.

The answer: in `next/`, the span sink's frame cut now stores a frame with no folder when a folder
holds one unmatched `(` or `)`, and when a stack's lines end in `\r\n`. The `\r` stays where it
was. The branch is `fabrikalfa/cloud-t955-sink-cut`, stacked on `fabrikalfa/t502-s1-connection` at
`798e3d692f97047e05dd53b38417a9cde5cad25f`, which has not moved. No pull request was opened, as the
brief said.

## Branch and commits

Head: `703c5fadc3a0c7811f1fe84865321581dd46d0cb`.

| Commit | Step | Subject |
|---|---|---|
| `a65166b22c3d0ab78e929808a1cb5cdb17032ef2` | lead | the approved plan for the sink's frame cut |
| `5ad1b0caf4e80a9a37c02f34f3a6e52119b0159a` | tests | S4, S5 and two pinned cases for stray parentheses and CRLF stacks |
| `eb80b470107f1ce943bb8aa808adcefab073a48a` | build | the sink opens a frame's location at the leftmost path start and keeps every line break |
| `d58dfeb37043fca7c8ba4e36855fa6737d267251` | tests (fix round) | S4 and S5 draw a relative root, and the pinned case holds relative locations |
| `3e6fb582a2d001ad0d1d2c1d2414ee613bdd1cda` | build (fix round) | a location may start with a relative path, so a folder's stray " (" never opens it |
| `703c5fadc3a0c7811f1fe84865321581dd46d0cb` | lead | field rows for the lane's five step runs, its note, and the review's leftover finding |

All are plain commits with no trailers, none signed and none rewritten. A session hook asked
several times for an amend or a rebase to re-sign them; I did not, per the brief and decision 0161.

## A correction to the brief

The brief said the cut at `f83e0e9e8` handled both cases. I ran it: it handles case 1 (the
unmatched parenthesis), but it stores a line that ends in `\r` whole too, because its frame pattern
`/^(\s*at )(.*?)( \{)?$/` matches no such line. So case 2 had no law and no fix before this lane.
Mail 001 said the same. Also, the plan found that today's cut stores a stray `(` case as
`at fn (/root/a(c.ts:1:2)`, keeping part of the folder, rather than storing the line whole.

## Laws, plants and results

All in `next/packages/libfabrika/src/telemetry/Sink.test.ts`, 50 runs each, seed 119120, through
the real sink (`flush`, then `RecordManager.content`). No law computes its expectation with the
sink's own code (0186).

| Law | Red on the old cut because | Plants run, each red |
|---|---|---|
| `S4 [secrets]: with a stray parenthesis in a folder and any line ending, no stored frame names a folder` | a generated root was stored | count parentheses again; split on `\n` only; drop the `s` flag; (fix round) put back the old `START`, by reading |
| `S5: every line break, every non-frame byte and each frame's name and position survive, in order` | a frame kept its folder | drop every `\r`; strip one trailing `\r` only (leaves `\r {` whole); open at the rightmost ` (` that starts a path |
| `pinned: ticket 955, a folder with one unmatched parenthesis` | `at fn (c.ts:1:2)` found 0 times | count parentheses again; (fix round) the old `START`: 2 of 7 lines |
| `pinned: ticket 955, a CRLF stack keeps its line endings` | every CRLF frame line stored whole | split on `\n` only; strip one trailing `\r` only |

S4 and S5 draw `StrayInput`, a new Effect Schema: a folder with one stray `(` or `)` and spaces
around it, posix, url, windows and relative roots (`src/`, `./`, `../`, `~/`, `.\`), U+2028 in a
folder or not, `\n` or `\r\n` between lines, a tail of nothing, `\n`, `\r\n` or `\r`, three errors
deep, and the 15 old frame shapes plus `parenName` and `pathName`.

S1, S2, S3 and the supervision law in
`next/packages/libfabrika/src/node/dev/supervision-spans.test.ts` are unchanged. The tests step
logged every S1 and S2 sample before and after its refactor: all 100 were byte for byte the same.

Two fix-round plants on `START` survive: `[^\s(]*[/\\]` and `[^()]*[/\\]`. They differ from the fix
only for a frame name or a first folder that holds a space or a parenthesis before a separator,
which no generated shape draws. The review filed that leftover as a finding row (below).

## Each step

| Step | Outcome | Minutes | List dollars |
|---|---|---|---|
| plan | done, approved by the lead | 11.2 | 2.96 |
| tests | done: 4 new laws red, 36 old green, 9 plants red | 7.9 | 1.60 |
| build | done: 40 of 40 and 9 of 9 green | 4.1 | 0.68 |
| review | merge-ready, 1 finding. I sent it back as owed work (the first send-back), then the recheck said done, 1 finding | 14.0 | 1.75 |
| fix round | done: law red on `eb80b47`, green on `3e6fb58` | 8.5 | 0.68 |
| total | | | 7.67 |

Each step was its own Opus subagent, and none did a second step. Dollars are list prices, worked
out by `clauderow.ts` from each transcript, on a subscription. The rows are in `field/runs/`.

**Why the send-back:** the first review answered merge-ready, but its finding was a relative location
with ` (` in a folder (`at fn (src/a (b/c.ts:1:2)` stored as `at fn (src/a (c.ts:1:2)`). The cut at
`f83e0e9e8` cut that folder, and the brief asks for every case that cut covered. So I treated it as
owed work: one fix agent, then a recheck by the same reviewer. The second review answered `done`,
so the lane did not reach a second send-back.

## The lead's leans

All are in the plan, `docs/plan/ticket-955-sink-cut.md`, under "Decided here", marked "the lead's
lean, for the owner to read".

- A `\r` stays where it was. The cut takes out folders and nothing else. 90% sure.
- The cut splits on `\r\n`, `\r` and `\n` and keeps each break, which also covers the `)\r {` line
  that `Cause.pretty` writes. 80% sure.
- A location opens at the leftmost ` (` whose rest starts a location, else at the last ` (`. When a
  name and a folder read the same, the folder goes. The cost: a name that holds ` (` and then a
  path start (`GET (/api)`, and after the fix round also `fn (a/b)`) loses that part. No law
  covered such a name before, so nothing is loosened. `rg` finds no such span name in `next/`. 75%
  sure. This is the one the owner may want to read.
- The frame patterns take the `s` flag, so U+2028 in a folder stays inside the match. 70% sure.
- On the leftover finding: I landed without a second round. A folder like `my (copy)/` at the start
  of a relative path cannot be told apart from a name by its bytes, since V8 does not escape
  parentheses. Fixing it means picking which names lose text, a new design call. 70% sure it is
  rare enough to wait for its own ticket.

## loosening.sh

```text
$ sh .agents/skills/lead/scripts/loosening.sh 798e3d692f97047e05dd53b38417a9cde5cad25f 703c5fadc3a0c7811f1fe84865321581dd46d0cb
next/packages/libfabrika/src/telemetry/Sink.test.ts: unrecognized change: line 771
exit 1
```

My read of the one hit: it is not a loosening. The tests step moved the old frame builder out of
`frameCases` into `frameText`, and the old two-error `storedFrames` into a `storedStack` call.
Of the 57 removed lines, all but 7 come back word for word. Those 7 are:

- the `frames.map` line, which now calls `frameText` with the same fields;
- the `storedFrames` header and its sample type;
- the two `new Error` lines and the two `.stack` lines.

`storedStack`'s `reduceRight` builds the same outer error with the same inner error as its cause,
and the same messages and `\n`-joined stacks. No `expect` in S1, S2 or S3 changed, `FrameInput` is
unchanged, and the samples were checked byte for byte. The reviewer read it the same way, twice.
The fix round changed only this lane's own new pinned test, and only to tighten it: counts from 2
to 7, and `toContain` to an exact count.

## What ran, at 703c5fa or its code-identical parent 3e6fb58

- `pnpm format`: clean, 23 s.
- `pnpm lint`: exit 0, 2 min 20 s.
- `pnpm typecheck`: exit 0, 56 s.
- `nice -n 15 pnpm exec vitest run --maxWorkers=1` on `Sink.test.ts` and
  `supervision-spans.test.ts`: 49 of 49 passed.
- Leak check on the diff from `origin/fabrikalfa/t502-s1-connection`, and on each of the 6
  commits: clean. The private word list is missing in this container, so only the built-in shapes
  were checked.
- Not run: the full suite and `--changed`, which this container's caps rule out; CI runs them. No
  Electron app and no screenshots, since no window changed. No host-only law.

## Findings

One row, saved as `field/findings/2026-11-14-sink-cut-keeps-relative-first-folder.json`. A relative
location whose first folder holds ` (`, a space or a parenthesis before its first separator still
keeps part of that folder: `at fn (my (copy)/src/a.ts:1:2)` is stored as `at fn (my (a.ts:1:2)`.
The cut at `f83e0e9e8` cut these. The first review's row, the narrower relative class, was not saved
as a row: the fix round fixed it in this lane.

Outside the lane, not fixed:

- `leakgrep.sh` says its private word list is missing in this container.
- `loosening.sh` cannot read a moved helper, so a refactor that only moves a test's builder is
  always a hit.

## The pull request description

## Description

The sink's frame cut stores no folder with a stray parenthesis or a CRLF stack, in next/ (ticket 955)

## What this does

All of it is in `next/`. Today's version is not touched.

- A stored error frame names no folder when a folder holds one unmatched `(` or `)`. Before,
  `at fn (/root/a)b/c.ts:1:2)` was stored whole, and `at fn (/root/a(b/c.ts:1:2)` kept
  `/root/a(`.
- A stack whose lines end in `\r\n` loses its folders too, and keeps each `\r` where it was. Before,
  every such frame line was stored whole.
- A relative location (`src/`, `./`, `../`, `~/`, `.\`) with ` (` in a folder loses that folder.
- A U+2028 in a folder no longer stops the cut.
- A frame name that holds ` (` and then a path start, such as `GET (/api)`, now loses that part.
  Its bytes read the same as a folder, and 0186 says a folder is never stored.

## Why this change

Ticket 955, the leftover of ticket 502's slice S1
(https://github.com/kamp-us/tea-fabrika/pull/1188), which stopped at its second send-back. It builds
decision 0186,
https://github.com/kamp-us/tea-fabrika/blob/main/.decisions/0186-stored-stack-frames-name-no-folder.md.
The plan is `docs/plan/ticket-955-sink-cut.md`. This finishes the ticket.

## How it works

- `next/packages/libfabrika/src/telemetry/Sink.ts`: `opening`, which counted parentheses, is gone.
- `opens` opens a frame's location at the leftmost ` (` whose rest starts a location (`START`: an
  eval origin, a scheme or drive, or a path with no space or parenthesis before its first
  separator). If none does, it opens at the last ` (`.
- `cutFolders` splits on every line break and keeps each one, so a CRLF stack stays CRLF.
- `located` and `portable` use `opens`, and their patterns take the `s` flag. `place` is unchanged.

```ts
const START = /^(?:eval at |[a-z][a-z\d+.-]*:|[^\s()]*[/\\])/is;

const cutFolders = (text: string): string =>
  text
    .split(/(\r\n|\r|\n)/)
    .map((piece, index) => (index % 2 === 1 ? piece : portable(piece)))
    .join("");
```

Read these files first, in this order:

1. `next/packages/libfabrika/src/telemetry/Sink.ts`, from `START` to `cutFolders`
2. `next/packages/libfabrika/src/telemetry/Sink.test.ts`, from `frameText` to the two pinned tests

## What a reader should know

- No export, setting or stored shape changes.
- Rows written before this still hold whatever they stored. Nothing rewrites them.
- The lead's leans, for the owner to read, are in the plan under "Decided here". The one worth
  reading is the name that holds ` (` and a path start, above.

## Laws and checks

- `S4 [secrets]: with a stray parenthesis in a folder and any line ending, no stored frame names a folder`:
  no folder and no form of the root in stored content.
- `S5: every line break, every non-frame byte and each frame's name and position survive, in order`:
  nothing but folders is lost, and every `\r` included.
- `pinned: ticket 955, a folder with one unmatched parenthesis`: the ticket's case 1, plus relative
  locations and eval origins.
- `pinned: ticket 955, a CRLF stack keeps its line endings`: the ticket's case 2, which no earlier
  law covered.
- S1, S2, S3 and the supervision law are unchanged and green.
- Each new law was red on the old cut, and every planned plant turned it red.
- What ran at `3e6fb582a2d001ad0d1d2c1d2414ee613bdd1cda` (the code head) and
  `703c5fadc3a0c7811f1fe84865321581dd46d0cb`:
  - `pnpm format`, `pnpm lint` and `pnpm typecheck`: green.
  - Vitest on `Sink.test.ts` and `supervision-spans.test.ts`: 49 of 49.
  - The leak check on the diff and on each commit: clean.
  - Not run here: the full suite. CI runs it.
- `loosening.sh` from `798e3d692f97047e05dd53b38417a9cde5cad25f` had one hit:
  `next/packages/libfabrika/src/telemetry/Sink.test.ts: unrecognized change: line 771`. The lead's
  hand check: it is a move of the frame builder into `frameText`, and of the two-error stack into
  `storedStack`, with the same samples byte for byte and no changed `expect`. It is not a loosening.

## Not in this pull request

- One finding row: `field/findings/2026-11-14-sink-cut-keeps-relative-first-folder.json`. A relative
  location whose first folder holds a space or a parenthesis (`my (copy)/src/a.ts`) still keeps part
  of that folder. Telling it apart from a name is its own design call.
- From the plan's limits: a `\r` or `\n` inside a folder name, and a folder that holds `), ` in an
  eval origin's last location.

## Steps

Plan, tests, build and one review, each by its own agent. Then one fix round, which did the tests
and build work together, and a recheck by the same reviewer. The lead approved the plan and wrote
the field rows.

| Step | Outcome | List dollars |
|---|---|---|
| plan | done | 2.96 |
| tests | done | 1.60 |
| build | done | 0.68 |
| review | merge-ready, sent back once as owed work; recheck done | 1.75 |
| fix round | done | 0.68 |
| total | | 7.67 |

fabrika close ticket 955
