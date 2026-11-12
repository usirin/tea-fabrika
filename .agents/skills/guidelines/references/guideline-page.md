# The guideline page

Step 7 writes one page per design area
([0136](../../../../.decisions/0136-guidelines-live-in-their-own-pages.md)). It holds the area's
rules together, read whole, and it is edited in place when a guideline changes. The long
reasoning, the leans, the Linear rows and the smaller calls stay in the experiment, and the page
links it.

```text
text area     docs/guidelines/<area>.md
visual area   docs/guidelines/<area>/README.md       the page
              docs/guidelines/<area>/shots/          real shots from the built app
                <state>.<layout>.<look>.png
```

A visual area is one a person judges by its look. Its shots come from the real built app (step 5),
never from a canvas, and they are product docs kept in the repo. The canvas and the walk page are
private: name them by title, never link them.

## The text form

```markdown
**Proposed 2026-11-11.** From [experiment NN](../../experiments/NN-<area>.md) and the Design
canvas "<Area> guidelines".

## X1: <name>

- **Kind:** law, lint or taste.
- **Means:** what a person or a program does, in one or two plain sentences.
- **Why:** a short quoted source, with its link.
- **Example:** real code or a real shot, never made up.
- **Held by:** the type, test, lint rule or refusal. A `law` or `lint` principle links its
  decision file and does not restate it. A `taste` principle names the shot a person judges it by.
- **Breaks today:** `file:line`, or "Nothing: today's <example> follows it, at `file:line`."
```

On the owner's yes, line one becomes
`**Approved DATE.** [NNNN](../../.decisions/NNNN-<area>-guidelines-approved.md)`.

## A filled principle

This is M4 from [modes](../../../../docs/direction/modes.md), cut to the page's shape. Its lines
were read on main on 2026-11-11.

```markdown
## M4: you always get out

- **Kind:** law.
- **Means:** Escape leaves every mode a program defines, beside any other key it picks. The prefix
  and F6 work in every mode. Leaving keeps your work, and no mode ends on a timer.
- **Why:** Tesler asks "How do I get out of this mode?". WCAG 2.1.2, no keyboard trap, and 2.2.1,
  no time limit.
- **Example:** info mode's own words, `apps/fabrika/src/window/frame.ts:947`:
  `"Info mode on. Escape leaves."`
- **Held by:** [0270](../../.decisions/0270-escape-always-leaves-a-mode.md); the key load refuses a
  mode with no way out (PR 282); the test "leaves on Escape, once what lies over the desk has
  closed, and says so", `apps/fabrika/src/window/frame.test.ts:1134`.
- **Breaks today:** Nothing: info mode leaves on Escape once what lies over the desk has closed,
  at `apps/fabrika/src/window/frame.ts:1042` (`escaped`).
```

## The visual form

A visual principle opens with a do and don't pair of shots, then the same fields, plus two more.
The names in angle brackets are placeholders, not real tokens or shots.

```markdown
## X2: <name>

| Do | Don't |
|---|---|
| ![<what the do shot shows>](shots/<state>.<layout>.do.png) | ![<what the don't shot shows>](shots/<state>.<layout>.dont.png) |

- **Kind:** taste.
- **Means:** ...
- **Why:** ...
- **Example:** the do shot above.
- **Tokens:** `<token>`, `<token>`, from `@kampus/fabrika-design`.
- **Checked by:** who looks, at which of the five layouts, beside which Linear screen.
- **Held by:** ...
- **Breaks today:** ...
```

The look in a shot's name is `do`, `dont` or a design's name. The layouts are step 5's five: one
tile, two side by side, two stacked, a 2x2 grid, and about 1024x700.

## Checklist

- [ ] Line one is the status: Proposed DATE with the experiment's link, or Approved DATE with the
  approval decision's link.
- [ ] Every principle is a `## X1: <name>` with Kind, Means, Why, Example, Held by and Breaks today.
- [ ] Every Why quotes a source and links it. Every Example is real code or a real shot.
- [ ] Every `law` and `lint` principle links its decision file and does not restate it.
- [ ] Every `file:line` was read on main the day the page was written.
- [ ] A visual principle opens with a do and don't pair, and names its Tokens and Checked by.
- [ ] No leans, no confidence numbers, no smaller calls: those stay in the experiment.
- [ ] Every relative link resolves.
