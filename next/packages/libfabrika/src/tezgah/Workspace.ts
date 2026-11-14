/**
 * tezgah's wire contract: the shapes any client reads of `fabrika/tezgah`'s view, and the one
 * place a tezgah process name or a tile's process name is written. A from-scratch client needs
 * these, so they live in the library, not in the program (0277, the plan's "Placement").
 *
 * A layout is a tile, or a container that runs in one of two directions and holds its parts in
 * order, each with its own `percent` of the container (0277, from AeroSpace's tree in 0505).
 *
 * @stability unstable
 */
import { Schema } from "effect";
import * as Id from "../Id.ts";
import { ProcessName } from "../processes/Process.ts";

/**
 * Schema for a tile's id. A window mints it, as it mints a letter's id (0211).
 *
 * @stability unstable
 * @category schemas
 */
export const TileId = Id.make("tile");

/**
 * A tile's id, as `TileId` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type TileId = typeof TileId.Type;

/**
 * Schema for a workspace's id.
 *
 * @stability unstable
 * @category schemas
 */
export const WorkspaceId = Id.make("workspace");

/**
 * Schema for the stable key a view gives the element that had focus in a tile, so a return to the
 * tile lands there (0165).
 *
 * @stability unstable
 * @category schemas
 */
export const CursorKey = Schema.String.check(Schema.isMaxLength(80));

/**
 * Schema for the two directions a container runs in: `row` lays its parts left to right, `column`
 * top to bottom.
 *
 * @stability unstable
 * @category schemas
 */
export const Dir = Schema.Literals(["row", "column"]);

/**
 * The direction a container runs in, as `Dir` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Dir = typeof Dir.Type;

/**
 * Schema for when a tile keeps its process after the process ends (0276): never, only after a
 * failure, or always.
 *
 * @stability unstable
 * @category schemas
 */
export const Keep = Schema.Literals(["never", "failed", "always"]);

/**
 * Schema for one tile: its id, its number (printed `t<n>` by tezgah only, never parsed), the
 * registered name of the process it shows, the program that draws it, whether tezgah started that
 * process (`child`, so a close stops it), its `keep` and its cursor (null: never focused).
 *
 * @stability unstable
 * @category schemas
 */
export const Tile = Schema.Struct({
  id: TileId,
  n: Schema.Int,
  shows: ProcessName,
  program: Schema.String,
  child: Schema.Boolean,
  keep: Keep,
  cursor: Schema.NullOr(CursorKey),
});

/**
 * One tile, as `Tile` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Tile = typeof Tile.Type;

/**
 * A layout: a tile, or a container of parts in reading order.
 *
 * @stability unstable
 * @category models
 */
export type Layout = TileId | Container;

/**
 * A container: its direction and its parts, each with its percent of the container.
 *
 * @stability unstable
 * @category models
 */
export type Container = {
  readonly dir: Dir;
  readonly parts: ReadonlyArray<Part>;
};

/**
 * One part of a container: its share of the container in percent, and what it holds.
 *
 * @stability unstable
 * @category models
 */
export type Part = {
  readonly percent: number;
  readonly inner: Layout;
};

/** A layout as the wire carries it. */
type LayoutWire = string | { readonly dir: Dir; readonly parts: ReadonlyArray<PartWire> };
type PartWire = { readonly percent: number; readonly inner: LayoutWire };

/**
 * Schema for a layout. It decodes any tree: `Layout.check` says whether a tree is tidy.
 *
 * @stability unstable
 * @category schemas
 */
export const LayoutSchema: Schema.Codec<Layout, LayoutWire> = Schema.Union([
  TileId,
  Schema.Struct({
    dir: Dir,
    parts: Schema.Array(
      Schema.Struct({
        percent: Schema.Number.check(Schema.isFinite()),
        inner: Schema.suspend((): Schema.Codec<Layout, LayoutWire> => LayoutSchema),
      }),
    ),
  }),
]);

/**
 * Schema for one workspace: its id, its number, its layout, the focused tile, and the tiles it had
 * focus on, newest first (`recent[1]` is the one before the focused one).
 *
 * @stability unstable
 * @category schemas
 */
export const Workspace = Schema.Struct({
  id: WorkspaceId,
  n: Schema.Int,
  layout: LayoutSchema,
  focus: TileId,
  recent: Schema.Array(TileId),
});

/**
 * One workspace, as `Workspace` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type Workspace = typeof Workspace.Type;

/**
 * Schema for tezgah's view, what every window reads: its workspaces and every tile they hold.
 *
 * @stability unstable
 * @category schemas
 */
export const TezgahView = Schema.Struct({ workspaces: Schema.Array(Workspace), tiles: Schema.Array(Tile) });

/**
 * tezgah's view, as `TezgahView` decodes it.
 *
 * @stability unstable
 * @category models
 */
export type TezgahView = typeof TezgahView.Type;

/** An id's body: what follows its fixed prefix. A process name allows no `_`, so a name carries
 *  only the body, and the fixed prefix of each kind keeps it whole. */
const body = (id: string, prefix: string): string => (id.startsWith(`${prefix}_`) ? id.slice(prefix.length + 1) : id);

/**
 * Returns the registered name of a person's tezgah, `tezgah:<the person id's body>`: one tezgah
 * process per person, so two people never share one.
 *
 * @stability unstable
 * @category getters
 */
export const tezgahName = (person: string): string => `tezgah:${body(person, "person")}`;

/**
 * Returns the registered name of the process tezgah starts for a new tile: the program's own name
 * after its pack, then the tile id's body, as `checklist:<body>` for `fabrika/checklist`.
 *
 * @stability unstable
 * @category getters
 */
export const childName = (program: string, tile: TileId): string =>
  `${program.slice(program.lastIndexOf("/") + 1)}:${body(tile, "tile")}`;
