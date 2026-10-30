# trace: `@tea-fabrika/trace`

One job's trace in a tile of its own. It reads the job's record through the `Traces` service and
draws it as a waterfall: one bar per span, nested by parent, one colour per program, and the
events as dots. Every row that groups others opens, down to one step. A step shows its Msg, the
state before and after, what changed, and the Cmds it started. The models are Elm's debugger,
Redux DevTools, and Jaeger's span detail. The design is
[A JobRecord holds each host job](../../docs/direction/a-job-record-holds-its-trace.md).

```ts
// tsh> seq --to 3 | tally            job 1: two runs, one trace
// tsh> trace --id <its trace id>     the trace takes over the tile
// tsh> runs --ticket 7 | trace       no flag: "pick a run" until an id comes on `id`; a newer one replaces it

// What the window sends, input by input, and what the tile shows after:
toggle {row: "span:<tally's span>"}   // tally opens: "count total"
toggle {row: "machine:[…]"}           // count total opens: add 1, add 2, add 3
choose {row: "step:[…, 2]"}           // add 2's detail:
// {msg: {type: "add", n: 2}, before: {kind: "kept", state: {total: 1}},
//  after: {total: 3}, changes: [{op: "replace", path: "/total", before: 1, after: 3}], cmds: []}
```

## The program, types first

The Elm answer: a Model, Msgs, an update, and a view of the Model. Which rows are open is in the
Model, as Elm keeps it, so a second window on the same run shows the same rows open.

```ts
// src/machine.ts
type Read =
	| {at: "waiting"}
	| {at: "reading"; id: TraceId}
	| {at: "read"; trace: JobTrace}
	| {at: "unread"; id: TraceId; why: string};

type Model = {read: Read; open: RowKey[]; chosen: RowKey | null};

type TraceMsg =
	| {type: "look"; id: string}           // read a record: from the flag, then each id on `id`; a newer one replaces it
	| {type: "toggle"; row: string}        // open or close a row that groups others
	| {type: "choose"; row: string | null} // show one row's detail; null closes it
	// and read_ok, read_err: the answers of its one Cmd
	;

const read = Cmd.define("read", {input: {id: TraceId}, ok: JobTrace, err: ["unread"]});
```

A row is named by a key from `treeOf(trace)` (`src/tree.ts`): `job`, `span:<id>`, `run:<run>`,
`turns:<span>`, `machine:[run, machine, id]`, `step:[run, machine, id, n]`. A toggle of a row
that groups nothing, or that the record does not hold, changes nothing. So does a choose of a
row the record does not hold.

The tree, as the `seq --to 3 | tally` fixture makes it:

```text
job   seq --to 3 | tally        the tsh line's span
  run seq                       a run's span, coloured by program
  run tally
    machine count total         tally's machine run, timed by its own span
      step add 1                each Msg it took
      step add 2
      step add 3
```

- A span nests under its parent. A span whose parent never came sits under the job.
- A run with no span still gets a row, so nothing in the record is left out.
- An agent's `chat` and `execute_tool` spans fold into one "N turns" row inside the span they
  ran in.
- A span with an error status, a failed run or a failed job is drawn red.

## What's in it

| Import | File | What it gives |
|---|---|---|
| `@tea-fabrika/trace` | `src/index.ts` | `trace`, the program: flag `id` (may be left out), inputs `toggle` (`{row}`), `choose` (`{row}`, or `{row: null}`), `quit` (`null`) and `id` (a trace id, as `runs` sends). Its view is `Shown`. |
| | `src/machine.ts` | `trace`, the machine, and `read`, its one Cmd. Pure. |
| | `src/tree.ts` | `treeOf`, `nodesOf`, `groupsOf`, `findOf`: the record as rows. Pure. |
| | `src/view.ts` | `shownOf`: the rows open, placed in time, and the chosen row's detail. `changesOf`: a JSON Patch of two states. Pure. |
| `@tea-fabrika/trace/memory` | `src/memory.ts` | `memoryTraces(records)`: `Traces` over records in memory. |
| `@tea-fabrika/trace/tally` | `src/tally.ts` | `TALLY_TRACE`, `TALLY_ID`: the `seq --to 3 \| tally` job, in the record's shape. |
| `@tea-fabrika/trace/window` | `src/window.tsx` | `TraceWindow`: the waterfall as a treegrid. |

## The keyboard

The rows are a WAI-ARIA treegrid. One row holds the focus at a time.

- ↑ and ↓ move. Home and End go to the first and last row.
- → opens a closed row, or moves into an open one. ← closes an open row, or moves to its parent.
- Enter and Space do what a click does: a grouped row opens or closes and shows its detail, a
  leaf shows its detail, and a second press hides it.

## Not done

- The app reads the fixture through `memoryTraces`, not the job's record. The host does not
  hand programs the record yet. When it does, the app provides `layerTraces` instead and nothing
  here changes.
- A record is read once, when its id comes. A job still running shows what was there then.
- `runs --ticket 7 | trace` wires, but one tile shows one window: today runs covers it, and
  trace is not drawn. What a line with two windows shows is not decided.
- The record holds no ticket, so the trace draws no link to one. Opening the ticket program from
  a trace needs a way to start another program from a window, which the desk does not have.
- The fixture's spans are written by hand in the record's shape, not caught from a real run.
- The colours are six fixed hues, given out to programs in the order they first appear. A job
  with more than six programs reuses them.
