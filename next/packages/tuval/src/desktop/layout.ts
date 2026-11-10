// The fixed layout and its fold, next/ (Tier 1, P14; docs/direction/the-desktop-layer.md). The
// layout is one percentage tree the app supplies. Each window folds it to its own measured size,
// locally: the tree is never changed, and nothing about one tab's size reaches another. A tile that
// cannot be shown at `MINIMUM` folds; the rest share its room. Pure, so it runs the same on Node.
import { Schema } from "effect";

/**
 * The least size a tile is shown at, in CSS px. The tile rule is 220x120
 * (docs/direction/tile-guidelines.md, "Zoom"); P14 starts the width at 360 because the counter's
 * three actions sit on one line and need about 340px, read from the shots. Height 200 keeps the
 * title bar, the count and the actions in view.
 */
export const MINIMUM = { width: 360, height: 200 } as const;

const Tile = Schema.TaggedStruct("tile", { id: Schema.NonEmptyString, pid: Schema.NonEmptyString });

const Cut = {
  dir: Schema.Literals(["row", "col"]),
  /** Where the split falls, in percent of the parent: strictly between 0 and 100. */
  at: Schema.Number.check(Schema.isGreaterThan(0), Schema.isLessThan(100)),
};

const SplitHead = Schema.TaggedStruct("split", Cut);

/** A split: `a` takes `at` percent of the parent along `dir`, and `b` the rest. */
interface Split extends Readonly<typeof SplitHead.Type> {
  readonly a: Tree;
  readonly b: Tree;
}

export type Tree = typeof Tile.Type | Split;

const Split = Schema.TaggedStruct("split", {
  ...Cut,
  a: Schema.suspend((): Schema.Codec<Tree> => Node),
  b: Schema.suspend((): Schema.Codec<Tree> => Node),
});

const Node: Schema.Codec<Tree> = Schema.Union([Tile, Split]);

/** A tile showing `pid` under its own `id`. */
export const tile = (id: string, pid: string): Tree => Tile.make({ id, pid });

/** A split along `dir`: `a` takes `at` percent, `b` the rest. */
export const split = (dir: "row" | "col", at: number, a: Tree, b: Tree): Tree => Split.make({ dir, at, a, b });

/** Every tile, `{id, pid}`, in reading order. */
export const tilesIn = (tree: Tree): ReadonlyArray<{ readonly id: string; readonly pid: string }> =>
  tree._tag === "tile" ? [{ id: tree.id, pid: tree.pid }] : [...tilesIn(tree.a), ...tilesIn(tree.b)];

/** A checked layout: a percentage tree whose tile ids are each used once. */
export const Layout = Node.check(
  Schema.makeFilter((tree: Tree) => {
    const ids = tilesIn(tree).map((t) => t.id);
    return new Set(ids).size === ids.length ? undefined : "each tile id once";
  }),
);
export type Layout = Tree;

export type Size = { readonly w: number; readonly h: number };

export type Rect = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

type Box = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** The two parts of `box` a split makes, `a`'s share first. */
const cut = (box: Box, dir: "row" | "col", share: number): readonly [Box, Box] =>
  dir === "row"
    ? [
        { ...box, w: share },
        { ...box, x: box.x + share, w: box.w - share },
      ]
    : [
        { ...box, h: share },
        { ...box, y: box.y + share, h: box.h - share },
      ];

const place = (tree: Tree, box: Box, out: Array<Rect>): void => {
  if (tree._tag === "tile") {
    out.push({ id: tree.id, ...box });
    return;
  }

  const [a, b] = cut(box, tree.dir, ((tree.dir === "row" ? box.w : box.h) * tree.at) / 100);
  place(tree.a, a, out);
  place(tree.b, b, out);
};

/** One rectangle per tile: the tree laid out at its own percentages in `size`. */
export const rectangles = (tree: Tree, size: Size): ReadonlyArray<Rect> => {
  const out: Array<Rect> = [];
  place(tree, { x: 0, y: 0, w: size.w, h: size.h }, out);
  return out;
};

/** The least room a subtree needs to show every tile at `MINIMUM`. */
const need = (tree: Tree): Size => {
  if (tree._tag === "tile") {
    return { w: MINIMUM.width, h: MINIMUM.height };
  }

  const a = need(tree.a),
    b = need(tree.b);
  return tree.dir === "row" ? { w: a.w + b.w, h: Math.max(a.h, b.h) } : { w: Math.max(a.w, b.w), h: a.h + b.h };
};

const fits = (want: Size, box: Box): boolean => want.w <= box.w + 1e-9 && want.h <= box.h + 1e-9;

const holds = (tree: Tree, id: string | null): boolean => id !== null && tilesIn(tree).some((t) => t.id === id);

const foldInto = (tree: Tree, box: Box, focused: string | null, shown: Array<Rect>, folded: Array<string>): void => {
  if (tree._tag === "tile") {
    if (fits(need(tree), box)) {
      shown.push({ id: tree.id, ...box });
    } else {
      folded.push(tree.id);
    }

    return;
  }

  const length = tree.dir === "row" ? box.w : box.h;
  const wantA = need(tree.a),
    wantB = need(tree.b);
  const [a, b] = cut(box, tree.dir, (length * tree.at) / 100);

  if (fits(wantA, a) && fits(wantB, b)) {
    foldInto(tree.a, a, focused, shown, folded);
    foldInto(tree.b, b, focused, shown, folded);
    return;
  }

  // Both still fit if the split moves: move it as little as it takes, and keep every tile.
  const lo = tree.dir === "row" ? wantA.w : wantA.h;
  const hi = length - (tree.dir === "row" ? wantB.w : wantB.h);
  const cross = tree.dir === "row" ? box.h : box.w;
  const across = tree.dir === "row" ? Math.max(wantA.h, wantB.h) : Math.max(wantA.w, wantB.w);

  if (lo <= hi + 1e-9 && across <= cross + 1e-9) {
    const share = Math.min(Math.max((length * tree.at) / 100, lo), hi);
    const [a2, b2] = cut(box, tree.dir, share);
    foldInto(tree.a, a2, focused, shown, folded);
    foldInto(tree.b, b2, focused, shown, folded);
    return;
  }

  // Not both: the side that holds the focused tile keeps the room, else the larger share.
  const keepA = holds(tree.a, focused) || (!holds(tree.b, focused) && tree.at >= 50);
  const [keep, drop] = keepA ? [tree.a, tree.b] : [tree.b, tree.a];
  foldInto(keep, box, focused, shown, folded);

  for (const t of tilesIn(drop)) {
    folded.push(t.id);
  }
};

/**
 * The tree folded to this window's `size`: the tiles shown, as rectangles that fit `MINIMUM` and do
 * not overlap, and the ids of the tiles folded away. The focused tile keeps its place whenever any
 * arrangement shows it. Every tile is in exactly one of the two lists.
 */
export const fold = (
  tree: Tree,
  size: Size,
  focused: string | null,
): { readonly shown: ReadonlyArray<Rect>; readonly folded: ReadonlyArray<string> } => {
  const shown: Array<Rect> = [];
  const folded: Array<string> = [];
  foldInto(tree, { x: 0, y: 0, w: size.w, h: size.h }, focused, shown, folded);
  const order = tilesIn(tree).map((t) => t.id);
  folded.sort((p, q) => order.indexOf(p) - order.indexOf(q));
  return { shown, folded };
};
