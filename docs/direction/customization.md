---
state: "proposed, D1 with D3 decided 2026-11-08"
summary: "Today's version first. A program offers, the person places, the frame draws. The top bar has one glance slot the person picks (lean); a program never adds itself to the bar (lean). The inbox is one list in two groups, Your turn then Messages, in its glance (a popover) and its tile; Space unfolds a look in place, and a person's place rule may float it; \"Open all\" is the inbox's command with its key. A program never says where it opens (lean). From experiment 206."
---

# Customization: a program offers, the person places, the frame draws

**Proposed 2026-11-08.** Decided by the owner on 2026-11-08: study 206's D1 with D3. The inbox
program has two views, its glance in the top bar's one slot and its tile. One list in two groups,
Your turn then Messages. Space unfolds a look in place under the row, and a person's place rule may
make it float (call 7 B). "Open all" is the inbox's own command with its key. The second group is
Messages: what an agent or a person sends you
([PR 496](https://github.com/usirin/tea-fabrika/pull/496)). The other leans below are open.

Its decided rules are in: [0480](../../.decisions/0480-the-inbox-is-one-program-two-views.md).

Built from [experiment 206](../../experiments/206-customization.md) and its step 5 shots. The Design
canvas "Customization guidelines" is not drawn yet. Neither is a measurement.

```ts
// A sketch, today's version. The person's choices are data the frame holds; a program only offers.
type Glance = {program: ProgramName}; // the one slot; "inbox" by default (decided 2026-11-06)
type Place = "beside" | "float"; // "beside" is G3's default; "float" is the person's opt-in
type Settings = {glance: Glance; place: Readonly<Record<ProgramName, Place>>};

// The inbox: one queue, two groups, one selection shared by both views.
type Row =
	| {_tag: "ask"; ask: AskId} // Your turn
	| {_tag: "stuck"; run: RunId} // Your turn
	| {_tag: "message"; from: Name; text: string}; // Messages: reply in the row
type Inbox = {rows: ReadonlyArray<Row>; selected: RowId | null; looking: RowId | null};

// "Open all" is a command, so it is a button with its key, a palette row and a tsh word.
const commands = {open: {send: {type: "open"}, keys: "<s-o>"}};
```

```text
one press, traced
a message from the builder on #7 lands     the glance's count goes 1 -> 2; nothing takes focus (4.1.3)
the person presses C-b a                   the glance opens: Your turn, then Messages
Down, Down, r                              the reply box opens inside the builder's row
types "go ahead", Enter                    the reply is sent; the row says so; the popover stays
Shift+O                                    the inbox tile opens beside, on that row
Space                                      the look unfolds under the row; focus stays on the list
```

## Which version

- **Today's version:** built now, by the foundations rule (2026-11-03, 2026-11-07). Two plans:
  the ask desk lands first (the answer path and the shared ask view), then the inbox (both views,
  the glance slot, Messages, Open all). Place rules come in the inbox's PR 2.
- **`next/`:** the same principles. The glance is a view a program definition may have, offered
  through the frame; `pg`'s group `glance` is the OTP shape (experiment 206).

## The five principles

### C1: one glance slot, and the person picks it

**Lean, 65%.** The owner's pick (D1) uses it; the slot count itself was not walked.

- The top bar has one slot. Any program whose definition has a `glance` view may fill it. The person
  picks, with a palette row or the settings file's `glance` line. The default is `inbox`.
- **Why:** VS Code: "Add more than one item (unless necessary)" (experiment 206, [v1]).
- **Linear as the builder:** the slot is a part every program gets for free (G7). Which program
  fills it is the person's, like a Linear favorite.
- **Elm or OTP:** the frame is the parent and calls the chosen program's `glance` view.
- **Holds it:** the frame's type has one `glance` field, not a list.
- **Doubt:** a second count (spend, runs) may earn its own slot. A week of use tells.
- **Today: breaks.** The asks item is the frame's own (`frame.tsx:260-275`).

### C2: a program offers; it never adds itself to the bar

**Lean, 70%.**

- A program's only way onto the bar is its `glance`, picked by the person.
- **Why:** every tool read that lets apps add to a shared bar also gives the person the last word.
  Linear lets apps add none. WCAG 3.2.3 wants a bar that keeps one order.
- **Holds it:** a program definition has no field that places a top bar item.
- **Today: passes,** by having no way for a program to add one.

### C3: the inbox is one list in two groups

**Decided 2026-11-08** (D1 with D3).

- Your turn (asks and stuck runs) on top, then Messages. The glance and the tile show the same rows,
  the same groups and one selection.
- **Why:** Linear's Priority tab keeps what needs you on top. A tab (D2) hid the second group behind
  a press, and a message nobody reads goes stale.
- **Accessibility:** the groups are labelled groups in the listbox; a new row is a status message,
  never a focus move (4.1.3). A VoiceOver run checks the group names are read.
- **Today: breaks.** `kind` is `"ask" | "stuck"` (`asks.ts:57`), and there is no tile.

### C4: "Open all" is a command

**Decided 2026-11-08** (D1).

- It is the inbox's `open` command: a button with its key printed, a palette row and a tsh word. The
  footer is not typed by hand. With a row selected, it opens the tile on that row.
- **Holds it:** G7 R1 builds the buttons from `commands`, so a command without a key cannot draw.
- **Today: breaks.** The footer is typed (`frame.tsx:426`), and there is no "Open all".

### C5: a program never says where; the person's rule may

**Lean, 70%,** for where a tile opens. **Decided 2026-11-08** for the look: it unfolds in place,
and a person's place rule may float it (call 7 B).

- The default is G3's beside. A place rule is keyed by program name, as i3's `for_window` and Zed's
  `dock` are, with a palette row that clears it.
- **Why:** G2 says a program "never names a tile, a size or a side"; layers says a float is the
  person's opt-in.
- **Accessibility:** 2.4.11, a float never hides the focused row. D4's default float covered the
  rows under the selected one at every layout.
- **Today: passes,** by having none: the desk always splits beside (`desk.ts:587-592`).

## What the ledger records

A message's reply is a fact with its writer's own `sentAt` and the referee's `arrivedAt`, as every
entry is. A switch of the glance slot or a place rule is a settings write, not a ledger fact. Lost
if not recorded now: when a reply was typed against when it arrived, which the inbox plan keeps.

## Where this differs from settled notes

- The ask desk's list-beside-detail tile gives way to D3's one list with the look in place.
- The ask desk's Q2 (Enter goes to the ticket's tile) holds for the tile. In the glance, Enter opens
  the inbox on that row; the lab's ticket jump came before the D1 + D3 pick.

## What it costs

Two today's-version plans: the ask desk PR 1 (6 to 8 agent hours) and the inbox PR 1 (about 8),
then the inbox's PR 2 for place rules (about 4). Confidence about 55%.

## What it cannot tell us

- The designs ran in headless Chromium on the built renderer, not in Electron, and no screen reader
  ran.
- Whether anyone switches the glance slot, and whether Messages crowds Your turn. A week of use
  tells.
- Whether "Open all" with Shift+O feels right; `o` was taken by the ask desk's "every pick".
