// tezgah, next/: the window manager as a program, `fabrika/tezgah`, one process per person,
// `tezgah:<the person id's body>` (0274, 0491). It holds each workspace's layout and focus, and
// starts and stops the processes its tiles show, as a supervisor starts and ends its children
// (OTP's start_child and terminate_child). A pure tea machine: a split waits for its start, so a
// tile enters a layout only once its process exists, and a window never draws a tile with nothing
// behind it. Layout geometry is the library's (`tezgah/Layout.ts`), shared with every window.
import { Machine } from "@demlik/tea/effect";
import { Program, type Refusal, StartChild, type Started } from "@kampus/libfabrika";
import * as Layout from "@kampus/libfabrika/tezgah/Layout";
import {
  childName,
  Dir,
  type TezgahView,
  type Tile,
  TileId,
  Workspace,
  WorkspaceId,
  Tile as TileSchema,
} from "@kampus/libfabrika/tezgah/Workspace";
import { Schema } from "effect";

/** The program a new tile shows. A constant until programs read pack settings (P38 slice 5); then
 *  it is the pack's `tezgah.new`, and `fabrika/fabsh` its default once the shell lands. */
export const NEW_TILE = "fabrika/checklist";

/** Workspace 1's first tile shows the process the instance boots with; its start answers
 *  `already_started`, as OTP's whereis does. */
const FIRST = "checklist:1";

/** The keybindings note's Via: how a person gave the command. */
const Via = Schema.TaggedUnion({ key: { keys: Schema.String }, click: {}, word: {}, palette: {} });

const Msg = Schema.Union([
  /** A window's first look at workspace `workspace`: makes it, with `tile` first, when it is missing. */
  Schema.Struct({ type: Schema.Literal("attach"), workspace: Schema.Int, tile: TileId }),
  /** A split, given in tile `from`; `tile` is the new tile's id, minted by the window. */
  Schema.Struct({
    type: Schema.Literal("did"),
    does: Schema.Literals(["tezgah.split_right", "tezgah.split_down"]),
    from: TileId,
    via: Via,
    tile: TileId,
  }),
  /** A close of tile `from`. */
  Schema.Struct({ type: Schema.Literal("did"), does: Schema.Literal("tezgah.close"), from: TileId, via: Via }),
]);
type Msg = typeof Msg.Type;

/** A start tezgah asked for and waits on: a workspace's first tile, or a split's new tile. */
const Starting = Schema.TaggedUnion({
  attach: { workspace: Schema.Int, tile: TileId, name: Schema.String },
  split: { workspace: WorkspaceId, at: TileId, dir: Dir, tile: TileId, name: Schema.String },
});
type Starting = typeof Starting.Type;

const Model = Schema.Struct({
  workspaces: Schema.Array(Workspace),
  tiles: Schema.Array(TileSchema),
  /** The next tile's number, printed `t<n>`. */
  next: Schema.Int,
  starting: Schema.Array(Starting),
});
type Model = typeof Model.Type;

type Step = readonly [
  Model,
  ReadonlyArray<ReturnType<typeof StartChild.startChild> | ReturnType<typeof StartChild.stopChild>>,
];

const DIRS = { "tezgah.split_right": "row", "tezgah.split_down": "column" } as const;

const holding = (m: Model, tile: string) => m.workspaces.find((w) => Layout.order(w.layout).includes(tile as TileId));
const known = (m: Model, tile: string) => m.tiles.some((t) => t.id === tile) || m.starting.some((s) => s.tile === tile);

const exists = (m: Model, n: number) =>
  m.workspaces.some((w) => w.n === n) || m.starting.some((s) => s._tag === "attach" && s.workspace === n);

/** A workspace takes its first tile's id body: windows mint ids, and tezgah mints none. */
const workspaceId = Schema.decodeSync(WorkspaceId);

/** The tile a start's answer makes, numbered next. */
const made = (m: Model, s: Starting, answer: Started): Tile => ({
  id: s.tile,
  n: m.next,
  shows: answer.name,
  program: NEW_TILE,
  child: answer._tag === "started",
  keep: "failed",
  cursor: null,
});

/** A start answered: a first tile makes its workspace; a split's tile goes after its tile, or after
 *  the focused one when its tile closed while the start waited (plan amendment, 2026-11-14). */
const placed = (m: Model, s: Starting, answer: Started): Model => {
  const rest = { ...m, starting: m.starting.filter((x) => x !== s) };

  if (s._tag === "attach") {
    if (m.workspaces.some((w) => w.n === s.workspace)) {
      return rest;
    }

    const space = Workspace.make({
      id: workspaceId(`workspace_${s.tile.slice(s.tile.lastIndexOf("_") + 1)}`),
      n: s.workspace,
      layout: s.tile,
      focus: s.tile,
      recent: [s.tile],
    });
    return { ...rest, workspaces: [...m.workspaces, space], tiles: [...m.tiles, made(m, s, answer)], next: m.next + 1 };
  }

  const w = m.workspaces.find((x) => x.id === s.workspace);

  if (w === undefined) {
    return rest;
  }

  const at = Layout.order(w.layout).includes(s.at) ? s.at : w.focus;
  return {
    ...rest,
    workspaces: m.workspaces.map((x) => (x === w ? Layout.split(w, at, s.dir, s.tile) : x)),
    tiles: [...m.tiles, made(m, s, answer)],
    next: m.next + 1,
  };
};

export const tezgahMachine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [StartChild.startChild, StartChild.stopChild],
  init: (loaded) => [loaded ?? { workspaces: [], tiles: [], next: 1, starting: [] }, []],
  update: {
    attach: (m, msg): Step => {
      if (exists(m, msg.workspace)) {
        return [m, []];
      }

      const name = msg.workspace === 1 ? FIRST : childName(NEW_TILE, msg.tile);
      return [
        {
          ...m,
          starting: [...m.starting, Starting.cases.attach.make({ workspace: msg.workspace, tile: msg.tile, name })],
        },
        [StartChild.startChild({ program: NEW_TILE, name })],
      ];
    },
    did: (m, msg): Step => {
      const w = holding(m, msg.from);

      if (w === undefined) {
        return [m, []];
      }

      if (msg.does === "tezgah.close") {
        const shown = m.tiles.find((t) => t.id === msg.from);
        return [
          {
            ...m,
            workspaces: m.workspaces.map((x) => (x === w ? Layout.remove(w, msg.from) : x)),
            tiles: m.tiles.filter((t) => t.id !== msg.from),
          },
          shown?.child === true ? [StartChild.stopChild({ name: shown.shows })] : [],
        ];
      }

      const name = childName(NEW_TILE, msg.tile);
      const split = Starting.cases.split.make({
        workspace: w.id,
        at: msg.from,
        dir: DIRS[msg.does],
        tile: msg.tile,
        name,
      });
      return [{ ...m, starting: [...m.starting, split] }, [StartChild.startChild({ program: NEW_TILE, name })]];
    },
    start_child_ok: (m, msg): Step => {
      const s = m.starting.find((x) => x.name === msg.cmd.name);
      return s === undefined ? [m, []] : [placed(m, s, msg.value), []];
    },
    // A refused start drops what waited on it, and nothing else changes.
    start_child_err: (m, msg): Step => [{ ...m, starting: m.starting.filter((x) => x.name !== msg.cmd.name) }, []],
    stop_child_ok: (m): Step => [m, []],
    // `noproc`: the tile's process ended before its close; the tile is already gone.
    stop_child_err: (m): Step => [m, []],
  },
});

/** `no_workspace` before any workspace exists; `missing` for a `from` no workspace holds;
 *  `last_tile` for a close of a workspace's only tile; `id_reused` for a new tile's id that is
 *  already a tile's or a waiting start's. */
const refuse = (m: Model, msg: Msg): Refusal | null => {
  if (msg.type === "attach") {
    return !exists(m, msg.workspace) && known(m, msg.tile) ? { reason: "id_reused" } : null;
  }

  if (m.workspaces.length === 0) {
    return { reason: "no_workspace" };
  }

  const w = holding(m, msg.from);

  if (w === undefined) {
    return { reason: "missing" };
  }

  if (msg.does === "tezgah.close") {
    return Layout.order(w.layout).length === 1 ? { reason: "last_tile" } : null;
  }

  return known(m, msg.tile) ? { reason: "id_reused" } : null;
};

const view = (m: Model): TezgahView => ({ workspaces: m.workspaces, tiles: m.tiles });

export const tezgah = Program.make({
  name: "fabrika/tezgah",
  machine: tezgahMachine,
  state: { v: 1, upgrades: [] },
  view,
  refuse,
  inputs: {
    attach: "A window's first look at workspace `workspace`: makes it, with tile `tile` first, when it is missing",
    did: "A command given in tile `from`: `tezgah.split_right` or `tezgah.split_down` with the new `tile`, or `tezgah.close`",
  },
  outputs: {},
  writes: {},
  wake: () => null,
});
