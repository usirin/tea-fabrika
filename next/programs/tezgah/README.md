# tezgah

`fabrika/tezgah`, the window manager of `next/`, the new version of fabrika, as a program in the
brain (0274). It holds each workspace's layout and focus, and it starts and stops the processes its
tiles show. Read [`src/program.ts`](./src/program.ts) beside this page.

Each person has one tezgah process, `tezgah:<the person id's body>`: the brain boots the founder's.
Every window of that person reads the same tezgah, so two windows on one workspace see one layout
and one focus. The shapes a window reads, and the layout's geometry, are the library's:
`@kampus/libfabrika/tezgah/Workspace` and `@kampus/libfabrika/tezgah/Layout`.

```ts
// What a window sends, and what it reads back.
{ type: "attach", workspace: 1, tile: "tile_01j..." }
{ type: "did", does: "tezgah.split_right", from: "tile_01j...", via: { _tag: "key", keys: "ctrl+b %" }, tile: "tile_01k..." }
{ type: "did", does: "tezgah.close", from: "tile_01k...", via: { _tag: "key", keys: "ctrl+b x" } }
// The view: { workspaces: [{ id, n, layout, focus, recent }], tiles: [{ id, n, shows, program, child, keep, cursor }] }
```

## What it does

| Input | What it does |
|---|---|
| `attach {workspace, tile}` | A window's first look. A missing workspace asks for one start for its first tile, and the workspace exists once that start answers. Workspace 1's first tile shows `checklist:1`, the process the instance boots with. A workspace that exists changes nothing. |
| `did tezgah.split_right` / `tezgah.split_down` | Asks for one start of a new `fabrika/checklist` named `checklist:<the tile id's body>`. When it answers, the new tile goes after `from` with half its share (right or below) and takes focus. If `from` closed while the start waited, the tile goes after the focused tile. A refused start drops the split. |
| `did tezgah.close` | Removes `from` at once. Its share goes to the part before it. When it had focus, focus goes to the next tile in reading order, else the one before. When tezgah started the tile's process (`child`), it stops it with `stop_child`, which ends it with `shutdown`. |

Layout changes wait for the brain; a window never adds a tile itself (0167). A split names its new
tile's id, minted by the window, so the window that asked can find it.

## `refuse`

- `no_workspace`: a `did` while tezgah has no workspace yet.
- `missing`: `from` is on no workspace.
- `last_tile`: a close of a workspace's only tile. The last tile never closes.
- `id_reused`: a new tile's id is already a tile's, or a waiting start's.

A refusal changes nothing.

## What is a constant for now

`NEW_TILE` is the program a new tile shows, `fabrika/checklist`, the one finished program. It
becomes the pack setting `tezgah.new` once programs read pack settings, and `fabrika/fabsh` its
default once the shell lands.

## Its laws

- `src/program.laws.test.ts` walks the program through the library's `stepper`: splits wait for
  their start (L6), the last tile never closes and focus goes to the next tile (L7), a close stops
  only tezgah's own child (L8), and what names nothing is refused (L9).
- `src/RunnerTest.ts` holds L8 on a real local instance. The app runs it, with L12, in
  `next/apps/fabrika/src/tezgah-runner.laws.test.ts`.
- The layout's tidiness (L5) is in `next/packages/libfabrika/src/tezgah/Layout.laws.test.ts`.
