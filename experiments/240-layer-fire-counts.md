# 240. Frame layer lint fires checked by hand

Today's version, tracker ticket 204, layers PR 1. Run 2026-11-09 at lane head `4fc95eaf` with
Node 26.13.0 and stylelint 18.0.0. The script calls no model, reads no key and makes no network
request. Its cost is $0.

**The new `fabrika/frame-layers` rule has zero observed false fires. All 4 fires on the base are
real, and the PR 1 tree has none, so the rule stays at error as the plan says.** This is a count on
these files, not a claim that every CSS form is covered.

```text
              files   declarations   fires   false fires
base 9f126695     3          2,060       4             0
PR 1 tree         3          2,070       0             0
good fixture      1             15       0             0
bad fixture       1              6       6             0
```

## What was scanned

`node experiments/240-layer-fire-counts.ts --audit --assert-clean` reads every tracked `.css` file
under `apps`, `packages` and `programs`, once at the pinned base `9f126695` (main on 2026-11-08) and
once in the working tree. It also reads the rule's own good and bad fixtures, the bad one as a
program's stylesheet. The root stylelint config runs with no known-debt list, no ignore file and
disable comments ignored. Raw reports went to `runs/`, which git ignores. The summary is in
[`results/240-layer-fire-counts.json`](./results/240-layer-fire-counts.json).

## Each base fire, by hand

| Where on the base | What fired | Real? |
|---|---|---|
| `window.css`, whole file | No complete `fabrika-frame-layers` rank table | Yes: the base has none |
| `window.css:876` | `z-index: 10` | Yes: a raw layer choice outside the table |
| `window.css:1207` | `z-index: 9` | Yes |
| `window.css:1434` | `z-index: 20` | Yes |

The bad fixture's 6 fires are its 6 planted forms, one each. The good fixture and the PR 1 tree fire
nothing.

## What it cannot tell us

- Four base fires is a small sample. Zero false fires in 4 does not prove the rule never misfires.
- The inline-style rule (`fabrika/no-layer-style`, oxlint) is not counted here. Its plants are in
  `oxlint-plugins/plants.test.ts`, and the PR 1 tree passes `pnpm lint` with it on.
- Review 2 found escaped names and `@property` registrations that slipped past the first version.
  Tests 11 added plants for each. Other CSS forms nobody has listed may still slip past.
