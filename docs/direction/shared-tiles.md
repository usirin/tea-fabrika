# Shared tiles: summon an agent into your tile, and see who is there

**Proposed 2026-11-04.** The owner decided these during the walk of the Design canvas "Shared tile
guidelines" on 2026-11-04, and each is marked decided below:

- **Decided, one kind of tile.** A tile holds the person and any agent they summon. The "agent's
  own tile" goes as a kind, for good.
- **Decided, any agent.** `summon` takes any agent that speaks the agent link (`fabrika mcp --as
  <name>`), not only claude.
- **Decided, never twice, never elsewhere.** The same thing is never shown twice on screen (two
  tiles of ticket #7), and the person is never sent to another tile to act. So the line "Only you
  can answer this. Open #7 in your own tile." goes from every design.
- **Decided, follow is out.** Design B (follow the agent's tile, Zed's way) keeps the split: you
  watch in your tile and act only by leaving it.
- **Decided, how writes are signed:** [inputs carry their sender](./inputs-carry-their-sender.md).
- **Decided 2026-11-05, `@claude` is how you summon.** There is no `summon claude` word. A plain line
  in tsh is a command; `@claude <words>` talks to claude. With no claude on the desk, the `@` starts it
  first and says so, since that starts a paid run.
- **Decided 2026-11-05, no presence label on a card a step writes.** The plan step runs its own agent,
  not the summoned claude, so a "✦ claude" tag on the plan card names the wrong writer. The label goes
  only where claude itself writes: its lines in tsh, a button it presses. The intent stays: claude's
  presence (its avatar, or the label on its own line) opens a box to talk to it, like a doc comment
  ([talk where you work](./talk-where-you-work.md)).
- **Decided 2026-11-05, no arrow pointer.** It is dropped everywhere. Agents have no cursor, so the
  presence label alone marks where an agent's job writes.

Proposed, leaned in the walk but not settled: the presence design (P2 plus P4, below), its
color, and the per-writer swatch.

Built from [experiment 209](../../experiments/209-talking-to-agents-in-place.md), the shared tile
study behind it, and the Design canvas "Shared tile guidelines", where every design was drawn.
Neither is a measurement.

```ts
// A sketch, today's version. Ticket #7 in t1, the owner's tile.
desk.step({type: "summon", agent: "claude", tile: "t1"}); // a tea Msg keeps `type`; focus stays
// presence: show it, never save it, never decide with it. Today it is desk state;
// in next/ it rides the five layers' ephemeral lane.
{_tag: "presence", client: "agent:claude for:github:42", location: "tile:t1", writing: "ticket:7/ask/a-1"}
```

```text
One sitting, traced (today's version, after the build):
1. The owner types `@claude run the pipeline for #7` in t1's tsh. claude is not on the desk, so t1
   says it is starting it and that this starts a paid run. t1's title bar gains a 12px rounded square
   with a ✦.
2. claude sends `pipeline --ticket 7 | ticket`. It shows whole in t1, after a "✦ claude" label.
   The owner's half-typed line stays where it was.
3. The lane asks "approve plan v1". The ticket window shows "Your turn" and the Approve button.
   The plan card has no "✦ claude" label: the plan step's own agent writes it, not claude.
4. The owner presses Approve, there. The row lands by the owner (cause
   in-3f9a12c0-41). claude cannot press
   it: it has no `answer` tool.
5. Ctrl-C stops claude's foreground job, and t1 says "claude stopped by owner".
```

## Which version

- **Today's version** (`apps/fabrika`, `packages/fabrika/src/host/`, `programs/`): this note. It
  replaces plan 185b's agent's own tile ([PR 381](https://github.com/usirin/tea-fabrika/pull/381))
  and its hidden person-only controls ([PR 383](https://github.com/usirin/tea-fabrika/pull/383),
  on hold) with one kind of tile. PR 381 is planned to land as it is (the lead agent's call), so
  ticket 117 can start through its `line` tool; the shared tile replaces its own-tile kind after.
- **`next/`:** reads it as a lesson. In `next/`, presence rides on the five layers' ephemeral lane,
  whose sketch already has `{_tag: "presence", client, location}` ([the five
  layers](./a-local-first-sync-engine.md)).

## The rules (proposed)

These build on the decided points above; the rules' wording is not settled.

1. **A tile holds people and agents; a job has one owner; a write has one signer.** Each line's
   job is its sender's. The tile has no writer of its own.
2. **"Only a person" is checked on the input's sender, by the host and the door,** never by which
   tile it is in and never by hiding a button. So "Your turn" is true in a shared tile. Linear's
   agents "cannot generate a `prompt`"; GitHub's agent "cannot approve or merge a pull request";
   two vendors (VS Code Copilot, Cursor) call their own client-side allowlists "not a security
   boundary".
3. **The prompt is the person's.** An agent never types into the editor. It sends whole lines,
   shown whole under its name as they begin. No typing animation. Warp's agent types live, so Warp
   needs a Takeover key; ours has no key path, so there is nothing to freeze.
4. **The person always has control.** Ctrl-C stops the foreground job, whoever's it is; `stop`
   stops any; `dismiss claude` sends the agent away. Neither the agent's arrival nor its lines move
   focus. A handover is said in one line each way.
5. **Presence says who is here, and where they work** (below).

## Presence: the avatar says who, the presence label says where

Four louder options were drawn after the walk found the state word too quiet. P2 plus P4 was
leaned in the walk (proposed).

| Option | What it is | Out or in, and why |
|---|---|---|
| P1 | `✦ claude · running %12` in the title bar's state slot | Out: the same gray as every title, the easiest to miss in a 2x2. |
| P2 | An avatar at the title bar's right: a rounded square with a ✦ for an agent, a circle for a person | In: a shape, not a word, and it still shows on an unfocused tile. Says who. |
| P3 | The tile's whole edge marked, plus a name tab (Zed's collaborator pane) | Out: the edge already means focus, and one edge cannot hold two agents. |
| P4 | A presence label on the exact thing the agent's job is writing now | In: says what the agent does, not only that it is here. Needs P2 for "here, idle". |

- **The avatar.** 12px, in the title bar, by the id. An agent is a rounded square with a drawn
  four-point star; a person is a circle. This is our own rule for identity marks. Shape plus name,
  never color alone ([WCAG 1.4.1](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)).
  The name is in the tile's accessible name and a tooltip.
- **No glow and no ring.** The canvas drew a ring while the agent works. The presence label already
  says where work happens, so the ring goes.
- **The presence label.** A small "✦ claude" name tag on the thing an agent's job is writing now: a
  line it sent, a button it presses. Never a card a step's own agent writes (decided 2026-11-05). It
  fades after. Lean: once it fades, the name stays as plain
  gray text beside the write, so who wrote it still shows, and the log keeps the signer either way.
  The owner's word, picked for being plain. Not "flag": a flag is already a command option, such as
  `--all`.
- **No cursor, no arrow pointer (decided 2026-11-05).** The arrow pointer is dropped everywhere.
  Agents send whole writes and have no cursor, so the presence label alone marks where an agent's
  job writes. Liveblocks' examples draw an agent cursor from presence data; we chose not to fake
  one.
- **Shown once.** The presence label replaces the `claude>` writer label on a line, so the name
  shows once. A tile where claude's job writes, but claude is not, gets the label and no avatar.

### Color

- **One agent hue, Radix orange, only inside the avatar and the presence label.** Never on the tile
  edge: the edge means focus only.
- **Why orange:** the widest free gap on the hue wheel. Pipes hold the cool and purple-pink side
  (sky, pink, teal, violet, lime, plum), states are green, amber and red, and the accent is indigo.
- **Measured on the canvas, dark look:** orange 8 on the tile ground 3.58:1, on the desk 3.69:1, on
  the focused title wash 3.02:1 (1.4.11 asks 3:1). Orange 11 text on orange 3, 7.83:1 (1.4.3 asks
  4.5:1).
- **The doubt:** orange sits 22 degrees from red (stuck) and 39 from amber (running). At step 8 it
  is 0.047 from amber in OKLab, closer than the pipes' tightest pair (pink and plum, 0.055). At step
  11 it is 0.081 from red and 0.119 from amber. A shot of a running ticket beside an orange avatar
  settles it. Lean 65%.
- **It bends a decided rule.** [Color principles](./color-principles.md) say a color is neutral, a
  state or a pipe. An agent becomes a fourth kind. The owner said on 2026-11-04 that "the accent
  only for asks you" predates the design system study and may bend to solve a real problem; the
  color note is revisited in the foundations work.
- **Later, each writer picks a color** from an accessible swatch. Lean: store a swatch name, never a
  hex value; the swatch leaves out the status hues; a default comes from the name, so nobody has to
  pick. Shape and name stay the first cue.

```ts
// A sketch. What a writer's mark holds. The swatch is a name; the theme maps it to steps.
const Swatch = Schema.Literals(["orange", "teal", "plum", "sky"]); // made up; no status hue
const Mark = Schema.TaggedUnion({
	person: {name: Schema.String, swatch: Schema.optionalKey(Swatch)}, // a circle
	agent: {name: Schema.String, swatch: Schema.optionalKey(Swatch)}, // a rounded square with ✦
});
```

## The smaller calls (leans)

1. **How the person summons.** Decided 2026-11-05: `@claude <words>` in tsh, or the `@` menu in a
   shared text field. Still a lean: the palette's "Summon claude here" too, and a key later, from the
   keys file. 70%; the doubt is whether the palette row earns its place once `@` exists.
2. **An agent's line with no summon.** It opens an ordinary shared tile beside, never a special
   kind. The agent never waits on the person to start. 70%; the doubt is a stray tile the person did
   not ask for.
3. **An agent's line while the person's foreground job runs.** Refused unless it ends with `&`, as
   plan 185b's call B. 70%; the doubt is
   an agent that is blocked for as long as the person's job runs.
4. **The agent's link drops.** It stays summoned, and its avatar says "away" in words. 65%; the
   doubt is how long "away" lasts before it should be dismissed.
5. **The ticket shows the agent's activity too** (design C beside this one): claude's lines in the
   tile, and its activity rows on ticket #7. This is not the same thing twice: the tile shows the
   lines claude sent, and the ticket shows what its jobs did to the ticket. Leaned in the walk, not
   decided.

## Linear as the builder

Linear puts an agent on the issue as a delegate, with its own mark and a state in words, and the
person stays the assignee. Built as fabrika programs: the tile is where the agent acts, so presence
is a frame part every tile gets for free, not a program's. The host owns the stamp, so every
program gets "who" for free. Where we differ: Linear has no terminal, so "the prompt stays the
person's" is ours, with a shell's `[1]+ Done` line above the prompt as the model.

## Elm and OTP

Presence is model (the desk's `agents`), and the title bar is a view of it. The editor is a child
the agent's Msgs never reach. The person is the supervisor: `dismiss` is a `shutdown` to the
agent's link in the tile, and its jobs stay in the table, told.

## Accessibility

- 1.4.1: the shape and the name carry it, the color only adds.
- 1.4.11: 3:1 for the avatar's line, measured above.
- 4.1.2: the tile's accessible name gains "with claude".
- 4.1.3: one polite message per agent line, never per output line.
- 2.3.3: the presence label's fade has a still twin under reduced motion.
- 3.2.1 and 3.2.5: no focus move when an agent arrives.
- Needs a real screen reader run: VoiceOver on the accessible name as claude's state changes, and
  whether a polite message per line is too chatty during a lane.

## Where this differs from settled notes

- **Plan 185b PR 3a:** "a person's line in an agent's tile is refused" goes. The tile is shared.
- **Plan 185b call C:** hiding person-only controls goes.
- **[Tile guidelines](./tile-guidelines.md#title-bar):** the title bar gains an avatar by the id.
- **[Color principles](./color-principles.md):** a fourth color kind, an agent's (above).
- **[An agent is a program](./agents-are-programs.md)** (proposed): see
  [talk where you work](./talk-where-you-work.md), which drops the chat window.

## What it costs

A guess from reading. The shared tile in today's version, about 600 to 900 lines with tests, 1 to
1.5 agent hours at 600 lines an hour ([agent hours](./agent-hours.md)), with the signing note's
part inside it. Presence (avatar, presence label, the orange steps), about 250 more. Sure of the
size: 55%. The doubt is the host's part: how much of today's writer code must change to sign each
line by its sender. A plan that reads `packages/fabrika/src/host/` settles it.

## Made up here

`summon` as a Msg and its fields, the "starting it · this starts a paid run" line, `writing`,
`Mark`, `Swatch` and its four names, "away", "claude stopped by owner", job `%12`, the id
`in-3f9a12c0-41`, and the account number `42` in the writer text.

## What it cannot tell us

- Whether a person watches an agent's lines at all, or tunes them out. Only a week of use says.
- Whether two writers in one scrollback is noise at 1024x700. Only 1440x900 was drawn.
- Whether a 12px avatar is enough in a 2x2. A shot of the real app settles it.
- How long a presence label should stay, and how a person finds a write after it fades. No study.
- No screen reader run.
