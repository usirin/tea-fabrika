# runs: `@tea-fabrika/runs`

One ticket's runs laid out in time, in a tile of its own, like tracks in a music editor. One track
per step, one clip per run, the waits on a person striped, answers marked on the ruler, and a cost
meter on each track. A playhead replays the facts up to a time: drag it back and the tile shows
the ticket as it was then.

It was the `trace` program until 2026-10-28. Since the job record
([a JobRecord holds each host job](../../docs/direction/a-job-record-holds-its-trace.md)),
`trace` opens one job's spans and steps ([`programs/trace`](../trace/README.md)). This one stays
the ticket's view over all its runs, read from the ticket's facts, with no record needed.

```ts
import {traceOf} from "@tea-fabrika/runs";
import {atSeven, SEVEN, SEVEN_NOW} from "@tea-fabrika/tracker/seven";

traceOf(SEVEN, SEVEN_NOW).tracks.map((t) => t.name);
// ["ticket", "triage", "plan", "approval", "test_writer", "build", "mutation", "review", "push", "merge"]

traceOf(SEVEN, SEVEN_NOW, atSeven(10, 5)).tracks[2]?.clips;
// [{run: "r-2", from: 10:03, to: 10:05, open: true, ...}]: at 10:05 the plan was still running

// tsh> runs --ticket 7
// tsh> runs --ticket 7 | trace     a run picked here: its trace id goes out on `id`, and trace reads it
// tsh> tracker | ticket | runs     input `ticket` takes each ticket sent: the runs follow it
traceIdOf(SEVEN, "r-2");          // SEVEN_TRACE: the trace id plan's `started` holds
```

With no flag it waits for a ticket on its input. When that input ends, it keeps the last ticket.

## What's in it

| Import | File | What it gives |
|---|---|---|
| `@tea-fabrika/runs` | `src/index.ts` | `runs`, the program: flag `ticket` (left out, it waits), input `in` (`choose` a run, `quit`), input `ticket` (a ticket to lay out now), output `id`: the trace id of each run picked that has one. `traceIdOf` reads it off the run's `started`. Its view is the ticket's facts and the clock (`One`). |
| | `src/trace.ts` | `traceOf`, `axisOf`, `placeOf`, `ticksOf`, `stopsOf`: the facts folded into tracks up to a time. Pure. |
| `@tea-fabrika/runs/window` | `src/window.tsx` | `RunsWindow`: the tracks, the ruler and the playhead. ← and → step from fact to fact; Home and End jump. |

## Why no timeline library

A small component of our own (about 380 lines, and 220 for its fold), after looking at the MIT and Apache ones:

- `react-calendar-timeline` (MIT) is shaped like a calendar: groups and items on a date axis,
  with `moment` as a dependency. It has no wait stripes, markers or playhead. Bending it into a
  music editor's look would cost more than the component.
- `@xzdarcy/react-timeline-editor` (MIT) is the closest in look, but it allows React up to 18
  only (this repo uses 19) and has had few changes lately.
- The fold is the hard part, and it is ours anyway: `traceOf` is pure and tested. The window
  only places boxes at a percentage.

Confidence about 75%. A library would pay off once the trace needs zoom, scroll over hours, or
many tickets at once.

## Not done

- The playhead replays only this window. In the mockup it moves every tile to that time; that
  needs a desk-wide clock the desk does not have.
- The mockup names a model per track. The facts carry no model, so a track says agent, code or a
  person.
