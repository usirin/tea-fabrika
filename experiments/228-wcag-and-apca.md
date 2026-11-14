---
date: "2026-11-07"
scripts: "`228-wcag-and-apca.ts`, `228-wcag-and-apca/`, `results/228-wcag-and-apca-pairs.jsonl`, `results/228-wcag-and-apca.md`"
summary: "Today's version; 387 pairs from the two contrast tests, apca-w3 0.1.9. Text: 365 pairs, 1 WCAG fail (the known ticket 153 exception), 19 pass WCAG and fail Lc 60, all dark: status colors on hovered or selected rows, one button label, 4 terminal colors. Non-text: 22 pairs, all pass Lc 15 (the script's Lc 30 was a wrong lean). Fed the two floors decided in [themes](../docs/direction/themes.md). No model, $0."
---

# 228. Do today's color pairs pass APCA as well as WCAG 2.2?

Measured 2026-11-07. About today's version: the pairs that
`packages/fabrika-design/src/themes.test.ts` and `apps/fabrika/src/window/colors.test.ts` pass to
their `under` check, on main. Scored with WCAG 2.2's contrast ratio and APCA's Lc from apca-w3
0.1.9. No model, no network, $0. The floors this fed were decided the same day in
[themes](../docs/direction/themes.md) ("The contrast math: two floors, both always").

**Answer: WCAG and APCA mostly agree; 19 text pairs pass WCAG and fail APCA Lc 60, all in the dark
look.**

```text
text:     365 pairs; WCAG fail 1; APCA fail 19; both pass 345; pass WCAG but fail APCA 19; reach Lc 75 186
non-text:  22 pairs; WCAG fail 0; APCA fail 10 (at Lc 30); both pass 12
```

- **The 19 text gaps** are status colors (`--stuck`, `--alert`, `--turn`, `--done`, `--open`) on
  hovered or selected rows (Lc 54.2 to 59.7), one button label (`--text-secondary` on `--line`,
  Lc 59.5), and 4 terminal palette colors on `--surface` (Lc 35.8 to 45.2). Every one passes WCAG
  4.5:1, some by a lot: palette 2 is 6.22:1 and only Lc 44.5.
- **The one WCAG fail** is the known exception: `--turn-fg` on `--turn-fill-hover` in the dark look,
  4.28:1 (ticket 153). APCA passes it at Lc 74.8.
- **Non-text.** The script scored non-text against Lc 30, and 10 pairs failed it (Lc 20.1 to 29.6:
  focus rings and `--turn-fill` on the dark surfaces). That floor was a wrong lean. APCA's own
  non-text minimum is Lc 15, which themes decided, and every non-text pair passes Lc 15.
- **About half the text pairs (186 of 365) reach Lc 75,** APCA's level for body text.

## How it ran

```sh
(cd experiments/228-wcag-and-apca && pnpm install --ignore-workspace)   # once, installs apca-w3 0.1.9
nice -n 15 node experiments/228-wcag-and-apca.ts
```

- **Input:** `results/228-wcag-and-apca-pairs.jsonl`, one row per pair the two tests check, with
  the test's floor as `bar`: 4.5 marks text, 3 marks non-text. The script adds the dark
  hovered-turn exception and drops duplicates.
- **Compositing:** a see-through foreground is laid over its ground, the way the tests do, before
  either score is taken.
- **Output:** `results/228-wcag-and-apca.md`, every pair with both scores. A rerun from the repo
  gave the same counts.

## What this cannot tell us

- **The pairs list was pulled from the tests by hand once** and saved as JSONL. If the tests gain a
  pair, this list does not. The token build that themes decided reads the same pairs from the token
  files, and replaces this list.
- **Light versus dark is guessed** from the ground's luminance (under 0.18 is dark). It matched
  every row read by hand, but it is not read from the theme.
- **APCA is a draft.** apca-w3 0.1.9 is the version WCAG 3's drafts point at today; a later APCA
  could move the numbers.
- **No person read these pairs.** Lc and the ratio are both models of reading. Whether a 55 status
  color on a selected row is hard to read for real people was not tested.
