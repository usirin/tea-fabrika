Draft, waits on the owner's yes to [keys editor](../direction/keys-editor.md). Builds its
principles E1 to E4 and E7 for the list (design A). `keys --map` (E5, E6) is the next plan.

Today's version (`apps/fabrika`). Ticket 278 found the look; this plan builds it.

## The whole idea

```tsx
// A sketch. `keys` stops borrowing the palette's box: it is a program whose window draws in its tile,
// like the tracker's. The editor machine (keys/machine.ts) does not change.
export const WINDOWS = new Map([
	// ...the six programs today
	known(keysProgram, KeysWindow), // KeysWindow draws the list: search, groups, rows, the keys line
]);

// C-b ? and the palette's "keys" both run the word `keys` in a new tile beside the focused one
// (smaller call 1, lean 60%). Typed in tsh, `keys` takes that tile, as `tracker` does.
case "keys": return said({kind: "split", to: "right", run: "keys"});
```

## The shape

- **No new types.** The editor's `Editor` and `EditorMsg` stay. The palette's `title: "keys"` case
  leaves `frame.ts`; `Over`'s palette is commands only again.
- **Where the editor's state lives moves.** Today the page holds `store.keysEditor` while the
  palette shows keys (`desk.tsx:356`). After the change, the keys program's view holds it, one
  editor for each `keys` window. Two `keys` tiles are two editors on one file, and the file's
  version check (keys PR 1) already refuses a stale save.
- **The look** is the one shot in round 2: `apps/fabrika/src/keys/looks.tsx`'s `ListLook` and its
  `.kl-*` styles, rewritten as the real window. Nothing is copied from the stand-in's portal code.

## One value, traced

```text
C-b ?        desk: split t1 to the right, run `keys` in t2; focus t2's search
type zoom    editor {query: "zoom"}; the list shows Tile · Zoom · ⌃B Z
Enter        editor.recording {_tag: "waiting", prefix: false}; the row listens
C-b |        editor.recording {_tag: "candidate", keys: [⌃B |]}; row: Takes it from Split · Save · Cancel
Enter        edit sent to the host; saved {version}; row: Zoom Changed ⌃B |
             under the list: Saved to keybindings.toml · Split lost ⌃B |  Undo
C-b x        t2 closes, its run ends, focus goes back to t1
```

## Properties the tests check

| Property | Principle | Kind |
|---|---|---|
| The keys window's box sits inside its tile's box, in every layout | E1 | e2e box check |
| `C-b ?` with one tile makes two; nothing is drawn over t1 | E1 | e2e |
| A row's accessible name is the command and its spoken keys, nothing else | E2 | unit (window.test.ts) |
| Names use `--font`; mono only in the search input | E2, E7 | lint on window.css |
| Enter on a row makes that row listen; Escape leaves it unchanged | E3 | unit |
| A press on Save or Cancel never selects the row again | E3 | unit (found in round 1) |
| After a save, the live region names what was lost, in words, and Undo restores it | E4 | unit, as today |
| The keycaps of one key are one image with the spoken name | E4 | unit |
| The tile's left, right and bottom edge pixel differs from 3px inside by 6 or more | E7 | e2e pixel check |
| `F6` prints as `F6` | E2 | unit (pop.test.ts) |

## Files and lines

| File | Change | Lines |
|---|---|---|
| `apps/fabrika/src/keys/window.tsx` | The list window, replacing today's Dialog body | ~250 changed |
| `apps/fabrika/src/keys/window.test.ts` | The properties above | ~120 |
| `apps/fabrika/src/keys/program.ts` | `keysRequest` goes; `keys` is one program with a window | ~-40 |
| `apps/fabrika/src/window/windows.tsx` | One `known(...)` row | ~2 |
| `apps/fabrika/src/window/desk.tsx` | The editor's state moves into the view; the null at `:667` goes | ~-30 / +20 |
| `apps/fabrika/src/window/frame.ts`, `frame.tsx` | The palette's keys case goes (`frame.tsx:1102`) | ~-40 |
| `apps/fabrika/src/desk/words.ts` | `C-b ?` runs `keys` in a split | ~10 |
| `apps/fabrika/src/window/window.css` | `.keys-dialog` goes; the list's styles, in tokens | ~-60 / +180 |
| `apps/fabrika/src/window/pop.ts`, `pop.test.ts` | Function keys print as capitals | ~4 |
| `apps/fabrika/e2e.ts` | The box and edge checks; shots | ~60 |
| `apps/fabrika/docs/keybindings/` | Shots at five layouts | images |

Shots, dark first, from the real built app: open, listening, the clash and saved, each at one tile,
two side by side, two stacked, a 2x2 grid and a 1024x700 window.

## Size

About 450 lines changed and 3 agent hours for the build, 75% sure. The doubt is moving the editor's
state from the page into the view: today the page owns it on purpose (focus comes back where it
was), and that may need more lines.

## What this cannot tell us

- No VoiceOver run is planned in the build; it is a separate check.
- Whether two `keys` tiles at once feel right. They work, but nobody has used it.

## Open questions

1. `C-b ?` opens a split beside the focused tile? Lean, 60%: yes. tmux takes over the pane instead.
2. Two `keys` windows at once: allowed? Lean, 70%: yes, the file's version check covers it.
