# What opens over the desk: popovers, menus, the palette

**Proposed 2026-10-30.** Two parts are settled by the owner on 2026-10-30:

- **One font and one set of tokens.** What opens over the desk uses the same font,
  size scale and colors as the program windows: `--font`, `--fs-*` and the
  window tokens in `apps/fabrika/src/window/window.css`. Monospace (`--mono`) is
  only for what a person types.
- **The bars stay as they are.** The top bar and the bottom line keep their
  monospace, tmux-like look. They are out of scope for this note.

Everything else below is a recommendation.

The whole idea, in one block:

```css
/* The frame: a terminal-like status line, like tmux. Settled: stays mono. */
.topbar,
.bottomline { font: 400 var(--fs-small) / 1 var(--mono); }

/* What opens over it: the product's own UI, in the windows' own font and sizes. */
.pop, .palette, .tooltip, .dialog { font: 400 var(--fs-body) / 1.4 var(--font); }

/* Inside them, mono only for typed things: a command, a path, a hash, a branch. */
.pop code { font-family: var(--mono); }
```

It holds together because the two layers are different things:

- **The bars are the frame.** They act like a terminal's status line, so they look
  like one, beside terminals that are mono too.
- **What opens over the frame is the product.** A list of asks, a palette, a
  tooltip: these are app screens, so they look like the program windows, which
  already use `--font`.
- Ghostty draws the same line: the terminal grid is mono, and its tabs, splits
  and error messages are native UI ([Ghostty, about](https://ghostty.org/docs/about)).

The owner looks at mockups first (the asks popover before and after, its
states, the Cmd-K palette and the `C-b ?` panel). Nothing in the app changes
before that; the change that builds it carries real screenshots, as every
program change does.

## 1. Why today's asks list reads as terminal text

Today's list (from [PR 199](https://github.com/usirin/tea-fabrika/pull/199),
`AsksList` in `apps/fabrika/src/window/frame.tsx`):

```text
asks · 2 live
t2 ticket #1 · approve plan · later
ticket #2 · stuck: checks red · later
1 later
ticket #3 · is it a duplicate of #1? · bring back
Only you answer these: in the ticket's own tile.
```

- **The whole page starts in mono.** `:root` in `window.css` sets
  `font-family: var(--mono)`, and `.over` sets it again. PR 199 chose this "to
  match the terminals in the tiles".
- **It is smaller than it looks in the code.** `:root` also sets
  `font-size: 14px`, so `1rem` is 14px, not 16px. `--fs-small` (0.75rem) draws
  at 10.5px. The program windows use the same scale, so they are small too (see
  section 8).
- **An ask is a run of words, not a row.** Three underlined links and `·`
  between them. No icon, no ticket title, no time. `later` sits on the same line
  as the main action and looks as loud.
- **The keyboard does not reach it.** It opens with `C-b a`, and `Escape` closes
  it. Focus never moves in, so the arrow keys still go to the focused tile's
  terminal. A click outside does not close it.

## 2. What Linear and the standards do

Linear's own writing names the goals but gives no menu numbers:

- Headings in Inter Display, the rest in regular Inter; colors in LCH, with
  levels "for our surfaces (e.g. background, foreground, panels, dialogs, and
  modals)" ([how we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)).
- 2026: "Don't compete for attention you haven't earned" and "Structure should
  be felt not seen": fewer and softer separators, fewer and smaller icons
  ([a calmer interface](https://linear.app/now/behind-the-latest-design-refresh)).
- Inbox: `J` `K` move, `U` read or unread, `H` snooze, `Backspace` delete
  ([Inbox docs](https://linear.app/docs/inbox)). `?` shows every shortcut, in a
  searchable list ([navigating Linear](https://linear.app/enablement/guide/navigating-linear),
  [changelog 2021-03-25](https://linear.app/changelog/2021-03-25-keyboard-shortcuts-help)).

The numbers come from the stylesheet of linear.app, read on 2026-10-30. It holds
the site's own command menu and context menus, built on the same tokens. The
logged-in app was not measured.

| Part | Linear (linear.app CSS) | fabrika, proposed |
|---|---|---|
| Font | `"Inter Variable", "SF Pro Display", -apple-system, …` | `--font` (settled) |
| Mono | `"Berkeley Mono", ui-monospace, …`, used only on `pre`, `code`, a git branch line and one chip | `--mono`, typed things only |
| Menu box | `min-width: 220px`, radius 8px, padding 4px, 1px line, layered shadow | `--r-lg` (8px), `--s-1` (4px), `--border` |
| Menu row | 32px tall, 13px, highlight inset with radius 6px | 32px one line, 44px two lines, `--r` (6px) |
| Command menu | `max-width: 720px`, top 13vh, radius 12px, input 46px tall, group heading 30px, item 46px, page dimmed | 620px, `--r-xl` (12px), input 46px, heading 28px, item 34px, scrim |
| Key hints | keycap 20px tall, 11px, weight 510, 1px border, radius 3px, same sans as the UI | 17px, `--fs-micro`, 500, `--border`, `--r-sm` |
| Motion | menu in and out 100ms, scale 0.9 to 1 and fade; command menu 175ms, scale 0.96; row highlight on at once, off in 150ms | `--fast` (120ms), `--ease-out`, scale 0.96 |

Two notes on the table:

- `--ease-out` in `window.css` is already `cubic-bezier(0.23, 1, 0.32, 1)`, the
  same curve as Linear's `--ease-out-quint`.
- Linear's layers, low to high: popover 600, command menu 650, dialog 700,
  toasts 800, tooltip 1100, context menu 1200.

Where other tools draw mono:

- **VS Code:** the workbench on a Mac is
  `-apple-system, BlinkMacSystemFont, sans-serif`
  ([style.css](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/media/style.css));
  the editor and terminal have their own mono setting.
- **Zed:** two settings, `ui_font_family` (`.ZedSans`, IBM Plex Sans) and
  `buffer_font_family` (`.ZedMono`)
  ([default settings](https://github.com/zed-industries/zed/blob/main/assets/settings/default.json)).
- **Warp:** its font setting is "the monospace font used in the terminal"; a
  pull request on per-pane sizes keeps "UI chrome (banners, menus …)" on the
  global size ([settings](https://docs.warp.dev/terminal/settings/all-settings/),
  [PR 9705](https://github.com/warpdotdev/warp/pull/9705)).
- **Tuval** (the old GUI, evidence only): its status line and window bars use
  its body sans at 12px; mono only for keycaps, the command line and ids.
- **Raycast:** not confirmed. Only third-party style guides were found, and they
  disagree.

The behavior side, from the standards:

- **Menu** ([APG menu and menubar](https://www.w3.org/WAI/ARIA/apg/patterns/menubar/),
  [menu button](https://www.w3.org/WAI/ARIA/apg/patterns/menubutton/)): focus
  goes to the first item on open; arrows move; a typed letter jumps to the next
  item that starts with it; Enter acts and closes; Escape closes and "returns
  focus to the element that opened it"; Tab leaves and closes.
- **Listbox** ([APG listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)):
  for picking options; it "does not support interacting with elements inside of
  an option". So no buttons inside a row of a listbox.
- **Dialog** ([APG modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)):
  focus moves in, Tab stays inside, Escape closes, focus returns to the opener.
- **HTML popover** ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using)):
  `popover="auto"` closes on a click outside or Escape; "only one `auto` popover
  can be shown at a time"; on close by keyboard, focus goes back to the opener.
- **Radix and Ariakit:** non-modal by default; Escape closes and focus goes back
  to the trigger ([Radix popover](https://www.radix-ui.com/primitives/docs/components/popover));
  Ariakit's defaults are `hideOnEscape`, `hideOnInteractOutside`,
  `autoFocusOnShow` and `autoFocusOnHide`, all `true`
  ([Ariakit reference](https://ariakit.com/reference/popover)). Radix tooltips
  wait 700ms, then 300ms between neighbors, open on focus and close on Escape
  ([Radix tooltip](https://www.radix-ui.com/primitives/docs/components/tooltip)).
- **Apple** ([HIG popovers](https://developer.apple.com/design/human-interface-guidelines/popovers)):
  "a small amount of information or functionality"; "Show one popover at a
  time"; nothing on top of a popover but an alert; never a warning in a popover.
  macOS body text is 13pt
  ([HIG typography](https://developer.apple.com/design/human-interface-guidelines/typography)).

## 3. The rule

- **One font, one set of tokens** (settled 2026-10-30). Everything that opens
  over the desk uses `--font`, the `--fs-*` scale and the window colors. No
  token of its own for type or color.
- **Mono only for typed things.** A tsh command (`runs --ticket 1`), a path, a
  hash, a branch name, code. A ticket number (`#1`), a tile name (`t2`), a key
  and a time are not typed text: they use `--font` with tabular digits. Linear's
  keycaps take the UI sans too: its `kbd` inherits the font.
- **The bars stay mono** (settled 2026-10-30). The frame is the terminal layer;
  the rule covers only what opens over it.
- **A popover is a raised box of rows.** `--surface-raised`, 1px `--border`,
  `--r-lg`, 4px padding, a layered shadow. Rows are 32px for one line, 44px for
  two. The active row is `--surface-hover`, inset, `--r`.
- **One row says one thing.** An icon for its state (never color alone), a title
  in sentence case at weight 500, one muted line under it, and the time or the
  row's keys at the right.
- **Keys are keycaps,** in `--font`, with the Mac's glyphs: `⌃B` `A`. A key that
  belongs to a row sits on that row; a key no row shows sits in the footer.
- **It behaves like the standard it is.** Pick the role by the content: a
  `menu` for rows that each do something, a `combobox` with a `listbox` in a
  `dialog` for the palette, a `dialog` when it has fields, a `tooltip` for a
  name. Focus moves in; arrows move; Enter acts; Escape closes and puts focus
  back where it was; a click outside closes it; one at a time.
- **Calm motion.** In over `--fast` with a fade and a 0.96 scale from the
  anchor; out faster, fade only. With reduced motion, fade only.
- **Never a blank box.** No rows means one calm line and what to expect.

Why, cost and confidence:

- **Why:** Linear, VS Code, Zed, Warp and Ghostty all keep mono for the text a
  person types and the sans for the app around it. The settled ruling already
  says the font; the rest is how Linear and the standards build the same parts.
- **Cost:** `window.css` (the `.over` and `.palette` rules), `AsksList` and
  `Palette` in `frame.tsx`, a key handler while a popover is open, and the
  screenshots. About 300 changed lines and one agent session. The bars and the
  programs do not change.
- **Confidence:** 85% on the type and box rules (the ruling plus three tools
  agree). 70% on the asks popover's second action (section 5). Under 80%: the
  doubt is screen readers, and a test with VoiceOver would settle it.

## 4. The tokens

Built from the window tokens. The only new values are the shadow and the scrim.

```css
:root {
	--pop-bg: var(--surface-raised);
	--pop-edge: var(--border);
	--pop-shadow: 0 0 0 1px rgb(0 0 0 / 0.25), 0 2px 6px rgb(0 0 0 / 0.3),
		0 12px 32px rgb(0 0 0 / 0.45);
	--pop-pad: var(--s-1); /* 4px */
	--row-h: 32px; /* one line */
	--row-2h: 44px; /* title and a line under it */
	--row-hi: var(--surface-hover); /* the active row */
	--row-on: var(--surface-selected); /* the picked row in the palette */
	--pop-in: var(--fast) var(--ease-out); /* 120ms */
	--scrim: rgb(0 0 0 / 0.35); /* behind the palette only */
}

.pop {
	padding: var(--pop-pad);
	border: 1px solid var(--pop-edge);
	border-radius: var(--r-lg);
	background: var(--pop-bg);
	box-shadow: var(--pop-shadow);
	font: 400 var(--fs-body) / 1.4 var(--font);
	font-variant-numeric: tabular-nums;
}

kbd {
	min-width: 17px;
	height: 17px;
	padding: 0 4px;
	border: 1px solid var(--border);
	border-radius: var(--r-sm);
	font: 500 var(--fs-micro) / 1 var(--font);
	color: var(--text-muted);
}
```

## 5. The parts, as a type

A sketch. Each kind holds only what it can show, so a tooltip with rows or a
palette with no query cannot be written.

```ts
type Key = string; // one keycap: "⌃B", "A", "↵", "Esc"

type Icon = "ask" | "stuck" | "set-aside" | "done";

interface Row {
	readonly icon: Icon;
	readonly title: string; // sentence case: the view capitalizes the first letter
	readonly sub: string | null; // one muted line
	readonly side: string | null; // a time, at the right
	readonly keys: readonly Key[]; // the row's own shortcut, as a palette row has
	readonly second: {readonly name: string; readonly key: Key} | null; // shown on the active row
}

interface Group {
	readonly title: string | null;
	readonly folded: boolean;
	readonly rows: readonly Row[];
}

type Over =
	| {kind: "menu"; label: string; groups: readonly Group[]; foot: readonly [Key[], string][]; empty: string}
	| {kind: "palette"; label: "Commands" | "Keyboard shortcuts"; query: string; groups: readonly Group[]; at: number}
	| {kind: "dialog"; label: string /* its fields are its own */}
	| {kind: "tooltip"; name: string; keys: readonly Key[]};
```

The asks popover, with the seeded home of PR 199's screenshots: #1 and #2 count, #3
was set aside.

```ts
const asks: Over = {
	kind: "menu",
	label: "Asks",
	groups: [
		{title: "Asks", folded: false, rows: [
			{icon: "ask", title: "Approve plan", sub: "#1 Login fails on Safari · t2", side: "11:13",
				keys: [], second: {name: "Later", key: "H"}},
			{icon: "stuck", title: "Stuck: checks red", sub: "#2 Dark mode resets on reload", side: "11:13",
				keys: [], second: {name: "Later", key: "H"}},
		]},
		{title: "Later", folded: false, rows: [
			{icon: "set-aside", title: "Is it a duplicate of #1?", sub: "#3 Login broken in Safari 18",
				side: "11:13", keys: [], second: {name: "Bring back", key: "H"}},
		]},
	],
	foot: [[["↑", "↓"], "Move"], [["↵"], "Open"], [["H"], "Later"], [["Esc"], "Close"]],
	empty: "Nothing waits on you",
};
```

Every field comes from `Ask` in `apps/fabrika/src/asks.ts` (`ticket`, `title`,
`what`, `kind`, `at`) and the tile that shows the ticket. Nothing is made up.

How a row's second action stays valid for a screen reader:

- The row is a `menuitem` with `aria-keyshortcuts="H"`, so `H` is announced.
- The `Later` button on the active row is for the pointer only. It mirrors `H`
  and is not a second focus stop, since a menu item holds no buttons.
- Doubt: whether VoiceOver reads `aria-keyshortcuts` well enough. If not, the
  known way out is a right-arrow submenu with Open and Later (APG menu), at the
  cost of one more step.

## 6. Keys in the asks popover

Opened with `C-b a` or a click on `2 ask you`:

| Key | Does |
|---|---|
| `↑` `↓`, or `J` `K` as in Linear's Inbox | Move the active row |
| A letter | Jump to the next row whose title starts with it |
| `↵` | Open: focus the tile that shows the ticket, and close |
| `H` | Later, or Bring back on a set-aside row (Linear snoozes with `H`) |
| `↵` on the "Later" heading | Fold or unfold the set-aside rows |
| `Esc` | Close; focus goes back where it was before |
| `Tab`, or a click outside | Close |

## 7. Keys in the palette and the keys panel

The palette (Cmd-K) and the keys panel (`C-b ?`) are one component with two
names, as Linear's command menu and its `?` list are two. Its rows are grouped
(Tile, Focus, Workspace), and the focused tile is named on top (`t2 · ticket #1`),
since the commands act on it.

| Key | Does |
|---|---|
| Typing | Narrows the list; the matched letters are drawn bold |
| `↑` `↓` | Move the picked row |
| `↵` | Run the command as its key would, and close |
| `Esc` | Close; focus goes back to the tile |

Tooltips: the name and its keys (`Asks` `⌃B` `A`), after 700ms, 300ms between
neighbors, as Radix does; they also open on keyboard focus.

## 8. What it cannot tell us

- **Linear's numbers are from its website,** not the logged-in app. The site's
  command menu and menus share the tokens, but the app may differ in places.
- **Inter is not shipped.** `--font` names Inter first, but the app bundles no
  Inter file. On a Mac without Inter installed, every window and popover draws
  in SF Pro through `system-ui`. The mockups did too. The ruling stands either
  way; bundling Inter is a separate question.
- **The size scale is 12.5% smaller than its names.** With a 14px root,
  `--fs-body` is 11.4px and `--fs-small` 10.5px, under macOS's 13pt body and
  Linear's 13px. The popover follows the windows, so it is as small as they
  are. Moving the root to 16px would fix both at once, and change every window.
- **The ask whose ticket no tile shows** (#2 in the shots) has no action today.
  The lean is that `↵` opens the ticket in a new tile beside the focused one,
  as Linear opens an Inbox item. That is new behavior with its own ticket.
- **Two spellings of one key.** Keycaps say `⌃B` `A`; the bottom line keeps
  `C-b a`. The owner may want one spelling.
- **Who asked is not in the data.** `Ask` has no stage, so a row cannot say
  "plan asks" without a new field.
- **Apple says title case for menus; Linear uses sentence case.** This note
  follows Linear. Not tested with anyone.
- **Motion is not in the mockups.** They are still pictures.
- **Raycast** stays unconfirmed.
