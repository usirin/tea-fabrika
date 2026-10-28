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
// the window sends, on `do`:
// {kind: "answer", ask: "a-1", pick: "approve", note: "", saw: {title, body}}
// tracker/ticket/7/inbox gets {type: "answered", ask: "a-1", pick: "approve", ...} by user:owner
```

## What's in it

| Import | File | What it gives |
|---|---|---|
| `@tea-fabrika/ticket` | `src/index.ts` | `ticket`, the program: flag `ticket`, input `do` (answer, comment, ask for changes, close, reopen, quit), and its view. `writeOf` turns a `do` into the tracker's write. |
| | `src/view.ts` | `Shown` and `shownOf`: the page the window draws, with its nine steps, plan, pull request and cost. Pure. |
| `@tea-fabrika/ticket/window` | `src/window.tsx` | `TicketWindow`, the round 6 layout. |

- A write never names a ticket. The flag does, once, so this window cannot write to another
  ticket.
- Only a person answers. The tracker's save cell refuses an `answered` written by an agent, and
  this program uses that same cell.
- The panel's Trace and Made of rows name a command to type (`trace --ticket 7`,
  `map --ticket 7`), since a window cannot open a tile yet.

## Not done

- No assignee: the ticket facts have none, so the panel says who filed it.
- The plan shows its version and task count; the facts carry no plan hash yet.
- "You" is the writer's id (`owner`), not a name: the app has no profile yet.
