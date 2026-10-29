# ticket: `@tea-fabrika/ticket`

One ticket in a tile of its own, laid out like a Linear issue: the title, one "your turn" card,
the body, a row per fact that opens in place, a comment box, and a properties panel on the right.
It reads the tickets with the tracker's own machine and cells, opened on one ticket, and writes
through them. An answer or a comment here is the same fact the tracker writes.

```ts
import {ticket, shownOf} from "@tea-fabrika/ticket";
import {trackerAtSeven} from "@tea-fabrika/tracker/seven";

shownOf(trackerAtSeven()).page?.steps.find((s) => s.state === "you");
// {step: "approval", state: "you", runs: 1, usd: 0, last: "approve plan v1"}

// tsh> ticket --ticket 7
// the window sends, on `do`, naming the ticket it was on:
// {kind: "answer", ticket: 7, ask: "a-1", pick: "approve", note: "", saw: {title, body}}
// tracker/ticket/7/inbox gets {type: "answered", ask: "a-1", pick: "approve", ...} by user:owner

// tsh> tracker | ticket | trace
// input `ticket` takes the tracker's pick: 7, then 3. The window shows #7, then #3.
// output `ticket` sends what it shows, once per change: 7, then 3, on to the trace.
```

## What's in it

| Import | File | What it gives |
|---|---|---|
| `@tea-fabrika/ticket` | `src/index.ts` | `ticket`, the program: flag `ticket` (left out, it waits), input `do` (answer, comment, ask for changes, close, reopen, quit), input `ticket` (a ticket to show now), output `ticket` (the ticket it shows), and its view. `writeOf` turns a `do` into the tracker's write, or `null` for a ticket never shown here. |
| | `src/view.ts` | `Shown` and `shownOf`: the page the window draws, with its nine steps, plan, pull request and cost. Pure. |
| `@tea-fabrika/ticket/window` | `src/window.tsx` | `TicketWindow`, the round 6 layout. |

- A write names the ticket the window was on when the person wrote it. A comment typed on #7
  lands on #7, even if #3 came down the pipe meanwhile. A write to a ticket this run never
  showed is dropped, with a warning.
- The window starts fresh for each ticket: a half-written comment does not follow to the next.
- When its input `ticket` ends, as when the tracker before it ends, it keeps showing the last
  ticket, and its window still writes there.
- Only a person answers. The tracker's save cell refuses an `answered` written by an agent, and
  this program uses that same cell.
- The panel's Runs and Made of rows name a command to type (`runs --ticket 7`,
  `map --ticket 7`), since a window cannot open a tile yet.

## Not done

- No assignee: the ticket facts have none, so the panel says who filed it.
- The plan shows its version and task count; the facts carry no plan hash yet.
- "You" is the writer's id (`owner`), not a name: the app has no profile yet.
