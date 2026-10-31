# trace: `@tea-fabrika/trace`

One job's trace in a tile of its own. It reads the job's record through the `Traces` service and
draws it as a waterfall: one bar per span, nested by parent, one colour per program, and the
events as dots. Every row that groups others opens, down to one step. A step shows its Msg, the
state before and after, what changed, and the Cmds it started. The models are Elm's debugger,
Redux DevTools, and Jaeger's span detail. The design is
[A JobRecord holds each host job](../../docs/direction/a-job-record-holds-its-trace.md).

```ts
// tsh> seq --to 3 | tally | trace    no flag: its own line's job, followed live as it goes
// tsh> trace --id <a trace id>       that job's record, followed while the job runs
// tsh> runs --ticket 7 | trace       its own line's job until an id comes on `id`; a newer one replaces it

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
	| {at: "read"; trace: JobTrace; now: number | null} // now: the latest tick, while the job runs
	| {at: "unread"; id: TraceId; why: string};

type Model = {read: Read; open: RowKey[]; chosen: RowKey | null};

type TraceMsg =
	| {type: "look"; id: string}           // follow a record: its own job's, or the flag's, then each id on `id`
	| {type: "got"; trace: JobTrace}       // the record, read again after a write to it
	| {type: "lost"; id: string; why: string} // it could not be read
	| {type: "toggle"; row: string}        // open or close a row that groups others
	| {type: "choose"; row: string | null} // show one row's detail; null closes it
	| {type: "tick"; now: number}          // the time, while the job runs
	;

// No Cmd. The record changes while its job runs, so it is a Sub, as Elm's `Time.every` is:
type FollowSub = Sub<"follow", {id: string}>;
// followed(model): {id} while it reads or shows a record, null (no Sub) while waiting or unread
// The time changes too, and that one is `Time.every`:
type TickSub = Sub<"tick", {id: string}>;
// ticking(model): {id} while the record read says `job.ended` is null, null once it says how it ended
```

A job that has not ended says `running` in the head, and its time grows once a second (`TICK`). An
earlier tick keeps the later time, so a clock that steps back never moves it back. Its row runs to
now, and the axis with it. With no run, span or step in the record yet there is no axis and no bar:
one line says so, as Linear's empty states do. With only the line's span in (`tally &`), its row is
drawn, running to now. An ended job shows its final time, with no tick, and that time covers the
job's own, however early the line's span ended.

The job's row keeps the job's line as its name from start to end. It is tsh's row from the start,
so `tsh` stays first in the legend and each program keeps its color when the line's span comes in.

The runner reads the record through `Traces.watch`: at once, then after each write to it. A host's
own records ring on each write; records behind the door are read again every second. It stops
following 5 seconds after the job ended (`SETTLE`), once the last spans are in.

A later `got` keeps the rows open and the detail chosen, if the new record still has them. Once the
record shown says its job ended, a later `got` keeps that end and the rest of that read applies, so
a stale read never makes a job look like it runs again. A `got` for an id the machine no longer
follows is dropped, so a slow answer never replaces a newer pick.

## Its inputs

| Input | Takes | Why |
|---|---|---|
| `toggle` | `{row}` | The window opens or closes a row that groups others |
| `choose` | `{row}`, or `{row: null}` | The window shows one row's detail, or none |
| `quit` | `null` | The window stops the run |
| `id` | a trace id | What `runs` sends when a run is picked |
| `any` | anything (`anyInput`) | Lets trace sit at the end of any line, as `pv` sits in a Unix pipe. What comes is let go unread |

tsh feeds `any` only when no typed input fits, and then with the source's first output, as a Unix
pipe carries stdout and not stderr. So `runs | trace` still goes to `id`, and `seq --to 3 | tally
| trace` sends tally's `total` to `any`. The Elm answer is `Json.Decode.value`: a value nobody
decodes. See [An input can take anything](../../docs/direction/an-input-can-take-anything.md).

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
| `@tea-fabrika/trace` | `src/index.ts` | `trace`, the program: flag `id` (left out: its own line's job), inputs `toggle` (`{row}`), `choose` (`{row}`, or `{row: null}`), `quit` (`null`), `id` (a trace id, as `runs` sends) and `any` (anything else on a pipe, let go), the `follow` runner over `Traces.watch`, and the `tick` runner. Its view is `Shown`. |
| | `src/machine.ts` | `trace`, the machine, and `followed` and `ticking`, the deps of its two Subs. Pure. |
| | `src/tree.ts` | `treeOf`, `nodesOf`, `groupsOf`, `findOf`: the record as rows. Pure. |
| | `src/view.ts` | `shownOf`: the rows open, placed in time, and the chosen row's detail. `changesOf`: a JSON Patch of two states. Pure. |
| `@tea-fabrika/trace/memory` | `src/memory.ts` | `memoryTraces(records)`: `Traces` over records in memory, for tests and shots. A watch reads once. |
| `@tea-fabrika/trace/tally` | `src/tally.ts` | `TALLY_TRACE`, `TALLY_ID`: the `seq --to 3 \| tally` job, in the record's shape. |
| `@tea-fabrika/trace/window` | `src/window.tsx` | `TraceWindow`: the waterfall as a treegrid. |

## The keyboard

The rows are a WAI-ARIA treegrid. One row holds the focus at a time.

- ↑ and ↓ move. Home and End go to the first and last row.
- → opens a closed row, or moves into an open one. ← closes an open row, or moves to its parent.
- Enter and Space do what a click does: a grouped row opens or closes and shows its detail, a
  leaf shows its detail, and a second press hides it.

## Not done

- The laptop's records hold no runs (`JobTrace.runs` is empty): a run's state lives in the
  host's file storage. The steps and spans are there.
- A home connected to a ledger server still keeps its records on the laptop.
- trace open in its own line keeps that job running, so the follow stays live until trace quits.
- A host that dies with a job running writes no end, so that record says `running`, and its time
  grows, for as long as it is shown.
- `runs --ticket 7 | trace` opens both windows side by side. A run picked whose job ran on
  another host, or whose record this laptop never kept, shows an empty record.
- The record holds no ticket, so the trace draws no link to one. Opening the ticket program from
  a trace needs a way to start another program from a window, which the desk does not have.
- The fixture's spans are written by hand in the record's shape, not caught from a real run.
- The colours are six fixed hues, given out to programs in the order they first appear. A job
  with more than six programs reuses them.
