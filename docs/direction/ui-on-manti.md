# The app's UI is built on Manti UI, with our own tokens

**Decided 2026-10-30 by the owner:** fabrika's UI is built on
[Manti UI](https://manti.design/getting-started/), the packages `@manti-ui/react`
and `@manti-ui/styles`. Manti is used for every part of the app's UI, and it
wears our own token values, never a theme of Manti's or of another project.

**Proposed** (open for the owner, marked where they come up): how the move is
split into pull requests, and four places where Manti's defaults clash with
[popovers.md](./popovers.md) (section 6).

The whole idea, in one block:

```css
/* apps/fabrika/dist/window.css, as build.ts writes it: */
@import "@manti-ui/styles/index.css"; /* Manti's parts, in its own cascade layers  */
/* React Flow's base rules                                                           */
/* src/window/theme.css: Manti's tokens, set from our names (unlayered, so it wins)  */
:root {
	--manti-font-sans: var(--font); /*  Inter, as the program windows               */
	--manti-text-sm: var(--fs-small); /* our px scale, never Manti's rem scale      */
	--manti-surface-raised: var(--surface-raised);
	--manti-accent-fill: var(--turn-fill); /* the accent means "your turn", as today */
}
/* src/window/window.css: the app's own rules and its token names                   */
```

```tsx
// A part of the app, before and after:
<span className="cap">⌃B</span>          // ours, styled by .cap
<Kbd>⌃B</Kbd>                             // Manti's: <kbd data-scope="kbd" data-part="root">
```

## 1. What Manti is

- **Behavior from Zag.js.** Each part is a [Zag.js](https://zagjs.com/) state
  machine: menu, dialog, tooltip, popover, combobox and more. Zag follows the
  WAI-ARIA patterns, so focus, roles and keys come with the part.
- **Look from tokens.** Every part draws from CSS custom properties in three
  tiers: base values, meaning (`--manti-surface-raised`, `--manti-text-muted`),
  and one set per part (`--manti-{component}-{property}`, such as
  `--manti-kbd-radius`).
- **Themes are attributes.** `data-theme`, `data-motion` and `data-radius` on an
  element switch a set of tokens under it.
- **Plain CSS.** The stylesheet sits in cascade layers: `manti.reset`,
  `manti.tokens`, `manti.theme`, `manti.base`, `manti.components`,
  `manti.motion`. Any rule outside a layer wins over all of them, so our theme
  needs no `!important`.
- **Another project uses Manti.** It was read only to see how Manti gets wired
  into an app. None of its tokens or its theme is taken.

## 2. Can we use it

| Question | Answer |
|---|---|
| License | MIT, both packages (`package.json` of 0.13.0). |
| Version | 0.13.0. It is 0.x, so a minor can break: the catalog pins it exact, with a comment. |
| React | Peer range `^18 \|\| ^19`; the app is on React 19.3.1. |
| Electron | The app is on Electron 45, a current Chromium. Manti's CSS uses cascade layers, `:where()`, `oklch()`, `color-mix()` and `light-dark()`; Chromium has had all of them since 2024. |
| Types | Manti's type files leave the `.js` off each relative import, so under our `NodeNext` resolution TypeScript sees none of its parts. `patches/@manti-ui__react@0.13.0.patch` adds the `.js` to 154 imports in 26 type files and changes no code. It goes when Manti ships full paths. |
| Accessibility | Zag's machines give roles, `aria-*` and keyboard handling per WAI-ARIA. Our own focus rules still apply on top (section 6). |
| Bundle | `desk.js` grows from 2,883,223 to 3,016,823 bytes (+130 KB, 4.6%) for `Kbd` alone. Manti's one index does not shake down to the part used. `dist/window.css` grows from 87 KB to 281 KB. |

The bundle cost is the one real price. Most of it is the Zag runtime, which the
menu, dialog and tooltip need anyway once they move, so it is paid once. It is
a desktop app that loads its files from disk, so the cost is parse time, not
download time. Nobody has timed the start with and without it yet.

## 3. Our values, set on Manti's tokens

`apps/fabrika/src/window/theme.css` sets Manti's tokens from the names in
`window.css`'s `:root`. A value lives once, in `window.css`; the theme only
points at it. So the type scale test still pins the px scale in one place, and
now also pins that Manti's text sizes are those same names.

```css
/* theme.css, abridged */
:root {
	--manti-font-sans: var(--font);          /* Inter                 */
	--manti-font-mono: var(--mono);          /* typed things only     */
	--manti-text-xs: var(--fs-micro);        /* 11px                  */
	--manti-text-sm: var(--fs-small);        /* 12px                  */
	--manti-text-base: var(--fs-body);       /* 13px                  */
	--manti-text-lg: var(--fs-prose);        /* 14px                  */
	--manti-text-xl: var(--fs-head);         /* 15px                  */
	--manti-text-2xl: var(--fs-title);       /* 22px                  */
	--manti-panel-tint: var(--pop-bg);       /* opaque, no glass      */
	--manti-panel-blur: none;
	--manti-radius-md: var(--r-lg);          /* 8px: a popover        */
	--manti-space-1: var(--s-1);             /* 4px: a popover's room */
	--manti-control-height-md: var(--row-h); /* 32px row              */
	--manti-control-height-lg: var(--row-2h);/* 44px row              */
	--manti-accent-fill: var(--turn-fill);   /* "your turn"           */
	--manti-danger-text: var(--stuck);
}

/* A part's own tokens are declared on the part, so they are set there too: */
[data-scope="kbd"][data-part="root"] {
	--manti-kbd-radius: var(--r-sm);
	--manti-kbd-font-size: var(--fs-micro);
	min-width: 17px;
	height: 17px;
	font-family: var(--manti-font-sans); /* Manti's default is mono */
}
```

```ts
// type-scale.test.ts, the new pin (abridged: the test reads the tokens out of theme.css's :root)
expect(mantiTextTokens).toEqual({
	"--manti-text-xs": "var(--fs-micro)",
	"--manti-text-sm": "var(--fs-small)",
	"--manti-text-base": "var(--fs-body)",
	"--manti-text-lg": "var(--fs-prose)",
	"--manti-text-xl": "var(--fs-head)",
	"--manti-text-2xl": "var(--fs-title)",
});
```

**Manti's reset is kept to Manti's parts.** Manti's reset sets
`box-sizing: border-box`, `margin: 0` and `canvas { max-width: 100% }` on every
element. On our desk that squashed the terminals' canvas and moved tiles by a
pixel or two. Manti's integration guide says to keep a reset off the other
side's parts; theme.css does it the other way round. Outside an element with
`data-scope` (a Manti part), each property the reset sets goes back to the
browser's own value, in `:where()` so any app rule still wins:

```css
:where(:not([data-scope], [data-scope] *)) { box-sizing: revert; margin: revert; }
:where(canvas, svg, img):where(:not([data-scope], [data-scope] *)) { display: revert; max-width: revert; }
```

The list shrinks to nothing as parts move onto Manti. After it, every screen
that has no Manti part draws pixel for pixel as on main.

**Dark first.** The app is dark only today. Light would need, per color, a
`light-dark(<light>, <dark>)` value with a light ramp for `--n-*` and `--a-*`,
and `color-scheme: dark` dropped from `window.css`. Manti's own parts follow
the tokens, so nothing in theme.css changes for light but the colors it points
at.

## 4. Every piece, mapped

The terminals (ghostty-web's canvas) stay out: they are not UI parts.

| Piece today | Becomes | PR |
|---|---|---|
| Keycaps (`.cap`, `kbd`, `.markdown-key`, `.tracker kbd`, `.view .kbd`) | Manti `Kbd`, one look | 1 |
| Asks list, jobs menu (`Menu` in `pop.tsx`) | Zag `menu` machine from `@manti-ui/folds`, on Manti's menu anatomy; our keys in `pop.ts` stay | 2 |
| Cmd-K palette, `C-b ?` keys panel (`Palette`) | Zag `dialog` as the modal shell; inside it our combobox and list, on Manti's tokens | 2 |
| Item lines panel (`Panel`) | Zag `popover` machine, on Manti's popover anatomy | 2 |
| Tooltips (`useTip`) | Zag `tooltip`, `openDelay: 700`, as popovers.md says | 2 |
| Buttons (ticket's Comment, Request changes; tracker's forms) | Manti `Button` | 3 |
| Inputs, the comment box | Manti `Input` and `Textarea` | 3 |
| Rows (tracker list, ticket timeline, runs tracks, trace waterfall) | Keep ours, styled from Manti's tokens: Manti has no row of this shape | 3 |
| Tabs (the map's and runs' headers) | Manti `Tabs` where a header switches views | 3 |
| Ticket, tracker, trace, runs, markdown, counter windows | Their buttons, inputs, tabs and keycaps as above; their layout stays ours | 3 |
| Map (React Flow) | Keep React Flow; its nodes take Manti's tokens | 3 |

Why the popovers are driven through Zag directly, not through Manti's React
`Menu`:

- **Manti's `Menu` needs a trigger.** Ours open by key (`C-b a`, `C-b J`) even
  with both bars hidden, so there is often no button to hang it on.
- **It has no J/K, no second action (`H` for later) and no fold.** Our `pop.ts`
  has all three, and they are tested.
- **Zag's machine takes `getAnchorRect`**, so it can sit under the bar's item,
  or at the screen's top edge with no item.
- So PR 2 runs `useMachine(menu.machine, {getAnchorRect, ...})` from
  `@zag-js/react` and spreads Manti's part props (`data-scope="menu"`,
  `data-part="content"`, `data-part="item"`), so Manti's CSS and tokens draw it.

```tsx
// sketch, PR 2
const service = useMachine(menu.machine, {
	id: "asks",
	open: over?.kind === "asks", // frame.ts still owns which one is open
	positioning: {getAnchorRect: () => itemRect ?? topEdge},
	onOpenChange: ({open}) => open || send({kind: "close"}),
});
const api = menu.connect(service, normalizeProps);
<div {...api.getPositionerProps()}><div {...api.getContentProps()}>{rows}</div></div>
```

Manti's `Combobox` and `Listbox` take string labels only. The palette's rows
have an icon, a title, a muted line and keycaps, so the palette keeps its own
list inside a Manti dialog.

## 5. The split

One change would touch every screen at once, and its review would be a wall
of pictures. Each PR below lands finished: no screen is half on Manti.

1. **The base, and every keycap.** The dependencies, the theme, Manti's
   stylesheet with its reset kept to Manti's parts, and every keycap in the app
   on Manti's `Kbd`. Five keycap looks become one (17px, 11px Inter, 1px
   `--border`, 4px radius, the one popovers.md settled). Every other screen
   draws as on main. Its shots are in each program's `docs/manti/` and in
   `apps/fabrika/docs/frame/manti/`.
2. **The popovers.** Menu, palette, panel and tooltip on Zag's machines, on
   Manti's anatomy.
3. **The program windows.** Buttons, inputs and tabs on Manti's parts; rows
   styled from Manti's tokens.

## 6. Where Manti's defaults clash with popovers.md (proposed)

| popovers.md says | Manti's default | Lean |
|---|---|---|
| Escape closes and puts focus back where it was, often the terminal | Focus goes back to the trigger | Keep ours: frame.ts restores what had focus before. With no trigger, Zag has nothing to send focus to. 85% sure. |
| One popover at a time | Each part is its own machine | Keep ours: frame.ts holds one `over`, and each machine runs with a controlled `open`. 90% sure. |
| No key reaches the terminal while it is open | Keys go to the focused part | Holds as is: focus is inside the popover. 90% sure. |
| Arrows move a highlight, with `aria-activedescendant` | Zag's menu does the same | Same answer: no clash. 95% sure. |

Two smaller points:

- **Escape is caught twice**, by Zag and by `desk.tsx`. PR 2 lets Zag close the
  machine and leaves `desk.tsx` to restore focus, with a test that one Escape
  closes once.
- **`Kbd` spells `⌘` as "Ctrl" off a Mac.** The app runs on Macs today, so the
  shots show `⌘`. On Linux the ticket's "`⌘` `↵` to send" would read
  "Ctrl `↵` to send", which is right there.

## What this cannot tell us yet

- Whether Manti 0.14 keeps the token names. It is 0.x; a bump is its own change,
  with the shots taken again.
- Whether Zag's menu takes `pop.ts`'s keys without a fight. PR 2 finds out; if
  it does not, the menu stays ours on Manti's anatomy and tokens, and that PR
  says so.
- What light looks like. Nobody has drawn it.
