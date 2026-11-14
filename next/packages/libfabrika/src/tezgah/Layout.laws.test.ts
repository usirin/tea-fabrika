// Desk S2a, next/ (the desk program fabrika/tezgah, ticket named by its title): law L5 of the
// approved plan, on the real `Layout.ts` and `Workspace.ts`. Written before both exist.
//
// The shape this law holds the build to, from the plan's "The shape" (the build may add more):
// - `Workspace.ts` exports the Effect Schemas `TileId` (Id.make("tile")), `WorkspaceId`
//   (Id.make("workspace")) and `Workspace`: {id, n, layout, focus, recent}. A layout is a tile id or
//   a container {dir: "row" | "column", parts: [{percent, inner}]}, `percent` on each part (0277).
// - `Layout.ts` is pure: `split(w, at, dir, tile)` gives the new tile half of `at`'s share, after
//   it; `remove(w, tile)` gives the tile's share to the part before and settles the tree; `order`
//   is the layout's reading order; `check(w)` lists every violation of a tidy workspace, empty when
//   it is tidy.
// - Tidy means (0505, read through 0277): each tile once; a container's parts' percents sum to
//   100; no container with one part; a container nested in another runs the other direction; focus
//   and every `recent` id name a live tile, and `recent` names each at most once.
//
// The walk is fc.commands from one tile: split right, split down and close on a live tile the
// model picks, a close only while two or more are live (the last tile is the program's refusal,
// L7). After every command the law reads the tree three ways: `Layout.check`, the law's own
// tidiness oracle written here from the plan's words, and the live set the model kept.
// The second property breaks a walked, tidy workspace in one named way and asks `check` to see it,
// so `check` is itself a checked oracle, as 0505's "a check that refuses a broken tree" asks.
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import * as Layout from "./Layout.ts";
import { TileId, Workspace } from "./Workspace.ts";

const SEED = 119120;
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** A canonical UUIDv7 TypeID for `n`, made here so the law does not lean on the generator it checks. */
const typeId = (prefix: string, n: number): string => {
  let uuid = (BigInt(n) << 80n) | (7n << 76n) | (2n << 62n) | BigInt(n % 4096);
  let suffix = "";

  for (let i = 0; i < 26; i++) {
    suffix = ALPHABET[Number(uuid & 31n)] + suffix;
    uuid >>= 5n;
  }

  return `${prefix}_${suffix}`;
};

type Node = string | { readonly dir: string; readonly parts: ReadonlyArray<{ percent: number; inner: Node }> };

type Space = {
  readonly id: string;
  readonly n: number;
  readonly layout: Node;
  readonly focus: string;
  readonly recent: ReadonlyArray<string>;
};

/** The workspace as the wire shows it: what every client reads. */
const encode = (w: unknown): Space => Schema.encodeUnknownSync(Workspace)(w) as Space;
const decode = (w: Space) => Schema.decodeUnknownSync(Workspace)(w);
const tileId = (id: string) => Schema.decodeUnknownSync(TileId)(id);

/** Reading order, written here: a container's parts in order, depth first. */
const order = (node: Node): ReadonlyArray<string> =>
  typeof node === "string" ? [node] : node.parts.flatMap((p) => order(p.inner));

/** Every way a workspace is untidy, by the plan's words; empty when tidy. */
const untidy = (w: Space): ReadonlyArray<string> => {
  const out: Array<string> = [];
  const walk = (node: Node, parent: string | null): void => {
    if (typeof node === "string") {
      return;
    }

    if (node.dir !== "row" && node.dir !== "column") {
      out.push(`direction ${node.dir}`);
    }

    if (node.parts.length < 2) {
      out.push(`a ${node.dir} of ${node.parts.length} part`);
    }

    if (parent === node.dir) {
      out.push(`a ${node.dir} inside a ${parent}`);
    }

    const sum = node.parts.reduce((total, p) => total + p.percent, 0);

    if (Math.abs(sum - 100) > 1e-6) {
      out.push(`parts sum to ${sum}`);
    }

    for (const p of node.parts) {
      if (!(p.percent > 0)) {
        out.push(`a part of ${p.percent}%`);
      }

      walk(p.inner, node.dir);
    }
  };
  walk(w.layout, null);
  const tiles = order(w.layout);
  const live = new Set(tiles);

  if (live.size !== tiles.length) {
    out.push(`a tile twice in ${JSON.stringify(tiles)}`);
  }

  if (!live.has(w.focus)) {
    out.push(`focus ${w.focus} is not live`);
  }

  for (const id of w.recent) {
    if (!live.has(id)) {
      out.push(`recent ${id} is not live`);
    }
  }

  if (new Set(w.recent).size !== w.recent.length) {
    out.push("recent names a tile twice");
  }

  return out;
};

type Model = { live: Array<string>; next: number };
type Real = { w: ReturnType<typeof decode> };

const after = (m: Model, r: Real, label: string) => {
  const shown = encode(r.w);
  expect(Layout.check(r.w), `L5: check after ${label}`).toEqual([]);
  expect(untidy(shown), `L5: the tree after ${label}`).toEqual([]);
  expect([...order(shown.layout)].sort(), `L5: the live tiles after ${label}`).toEqual([...m.live].sort());
  expect(Layout.order(r.w.layout), `L5: reading order after ${label}`).toEqual(order(shown.layout));
};

const Split = (dir: "row" | "column", pick: number): fc.Command<Model, Real> => ({
  check: (m) => m.live.length > 0 && m.live.length < 24,
  run: (m, r) => {
    const at = m.live[pick % m.live.length]!;
    const tile = typeId("tile", m.next++);
    r.w = Layout.split(r.w, tileId(at), dir, tileId(tile));
    m.live.push(tile);
    after(m, r, `split ${dir} at ${at}`);
  },
  toString: () => `split ${dir} ${pick}`,
});

const Close = (pick: number): fc.Command<Model, Real> => ({
  check: (m) => m.live.length > 1,
  run: (m, r) => {
    const tile = m.live[pick % m.live.length]!;
    r.w = Layout.remove(r.w, tileId(tile));
    m.live = m.live.filter((t) => t !== tile);
    after(m, r, `close ${tile}`);
  },
  toString: () => `close ${pick}`,
});

const commands = fc.commands(
  [
    fc.nat().map((pick) => Split("row", pick)),
    fc.nat().map((pick) => Split("column", pick)),
    fc.nat().map((pick) => Close(pick)),
  ],
  { maxCommands: 60, size: "max" },
);

/** One workspace of one tile, as tezgah makes workspace 1. */
const first = () => {
  const t1 = typeId("tile", 1);
  return decode({ id: typeId("workspace", 1), n: 1, layout: t1, focus: t1, recent: [t1] });
};

/** One named break of a tidy workspace, or null when this tree has no place for it. */
const BREAKS = ["one_part", "same_direction", "sum", "twice", "focus", "recent"] as const;

const broken = (w: Space, kind: (typeof BREAKS)[number], pick: number): Space | null => {
  const root = w.layout;
  const ghost = typeId("tile", 9_000 + pick);

  switch (kind) {
    case "one_part":
      return { ...w, layout: { dir: "row", parts: [{ percent: 100, inner: root }] } };
    case "same_direction":
      return typeof root === "string"
        ? null
        : {
            ...w,
            layout: {
              dir: root.dir,
              parts: [
                { percent: 50, inner: root },
                { percent: 50, inner: ghost },
              ],
            },
          };
    case "sum":
      return typeof root === "string"
        ? null
        : {
            ...w,
            layout: { ...root, parts: root.parts.map((p, i) => (i === 0 ? { ...p, percent: p.percent + 1 } : p)) },
          };
    case "twice": {
      const tiles = order(root);
      const dir = typeof root === "string" ? "row" : root.dir === "row" ? "column" : "row";
      return {
        ...w,
        layout: {
          dir,
          parts: [
            { percent: 50, inner: root },
            { percent: 50, inner: tiles[pick % tiles.length]! },
          ],
        },
      };
    }
    case "focus":
      return { ...w, focus: ghost };
    case "recent":
      return { ...w, recent: [...w.recent, ghost] };
  }
};

describe("Desk S2a L5: the layout stays tidy", () => {
  it("L5: after any sequence of splits and closes, Layout.check finds nothing: each tile once, parts sum to 100, no one-part split, directions alternate, focus and recent name only live tiles", () => {
    fc.assert(
      fc.property(commands, (cmds) => {
        const t1 = typeId("tile", 1);
        fc.modelRun(() => ({ model: { live: [t1], next: 2 }, real: { w: first() } }), cmds);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });

  it("L5: check refuses a walked tree broken in any one way: one part, the same direction nested, a wrong sum, a tile twice, a dead focus, a dead recent", () => {
    fc.assert(
      fc.property(commands, fc.constantFrom(...BREAKS), fc.nat(), (cmds, kind, pick) => {
        const t1 = typeId("tile", 1);
        const real = { w: first() };
        fc.modelRun(() => ({ model: { live: [t1], next: 2 }, real }), cmds);
        const bad = broken(encode(real.w), kind, pick);

        if (bad === null) {
          return;
        }

        expect(untidy(bad).length, `the law's own oracle sees ${kind}`).toBeGreaterThan(0);
        const w = Schema.decodeUnknownOption(Workspace)(bad);

        // A schema that refuses the broken shape outright is stricter still.
        if (w._tag === "Some") {
          expect(Layout.check(w.value).length, `L5: check sees ${kind} in ${JSON.stringify(bad)}`).toBeGreaterThan(0);
        }
      }),
      { seed: SEED, numRuns: 300 },
    );
  });
});
