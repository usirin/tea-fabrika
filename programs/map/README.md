# map: `@tea-fabrika/map`

A map of today's programs in a tile of its own, drawn with React Flow (`@xyflow/react`, MIT). Each
box is a real program with its real input and output names and types. A wire is drawn only where
one program's output is piped into another's input in code today. The ledger is a service, not a
program, so the boxes that call it get a dotted line, not a wire. Inside operate, the plan's
nine steps sit as spots. Dashed means one thing only: nothing does that step yet. A step that
lives outside operate is solid, with a tag naming where it lives, like `in plan`.

```ts
import {PROGRAMS, WIRES, SPOTS} from "@tea-fabrika/map";

WIRES.map((w) => `${w.from.join(".")} -> ${w.into.join(".")}`);
// ["plan.planned -> asks.planned", "build.opened -> review.pr", "review.passed -> ship.pr"]

SPOTS.push;
// {kind: "missing", note: "build pushes today"}

// tsh> map --ticket 7      the boxes light up with ticket 7's facts: "a-1 approve plan v1" in asks
```

## What's in it

| Import | File | What it gives |
|---|---|---|
| `@tea-fabrika/map` | `src/index.ts` | `map`, the program: flag `ticket`, input `quit` (`null`). Its view is the ticket's facts and the clock (`One`). |
| | `src/map.ts` | `PROGRAMS`, `WIRES`, `LEDGER_CALLS`, `SPOTS`, `familyOf`: the map as data. |
| `@tea-fabrika/map/window` | `src/window.tsx` | `MapWindow`: the React Flow canvas, its boxes, wires and legend. |

- `src/map.test.ts` holds the map to the code. It imports each real program and checks every
  name, every port name, and that each port's type fits the real schema (`fit` from
  `@kampus/fabrika`). It checks that each wire's two ends fit each other too. A renamed input
  fails the test, so the map cannot drift from the code.
- The page cannot import the programs (they use Node), so `map.ts` holds the names as data and
  the test is what keeps them true.
- The box positions are hand-placed (`AT` in `window.tsx`), in the round 6 layout.

## Not done

- No live run state on the wires: they show what is piped in code, not what flows now.
- A box does not open its program. That needs a window to open a tile, which the desk has no
  message for yet.
