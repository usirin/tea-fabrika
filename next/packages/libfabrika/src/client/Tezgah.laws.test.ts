// Desk S2a, next/ (the desk program fabrika/tezgah, ticket named by its title): law L11 of the
// approved plan, tezgah's view through the window's own tezgah child. Written before
// `client/Tezgah.ts` and `tezgah/Workspace.ts` exist. The program's half of L11 (every view tezgah
// steps decodes as a client reads it, `child` and all) is in `next/programs/tezgah/src/program.laws.test.ts`.
//
// The shape this law holds the build to, from the plan (the build may add more):
// - `tezgah/Workspace.ts` exports the Effect Schema `TezgahView`: {workspaces: [{id, n, layout,
//   focus, recent}], tiles: [{id, n, shows, program, child, keep, cursor}]}.
// - `client/Tezgah.ts` is the window's side of 0167: one tea machine, `tezgahMachine`, whose Model
//   is `TezgahClient` {workspace, serverState, rev, pendingMutations}. `init(null, {workspace})` has
//   no server state yet, at rev 0, with no pending mutation. Its Msg `server {rev, view}` carries a
//   view as the wire carries it, JSON; a view that decodes as `TezgahView` becomes the server state,
//   one that does not changes nothing. `optimisticState(model)` is derived from the server state
//   and the pending mutations, never stored: with none pending it is the server state.
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { diff } from "../runtime/Patch.ts";
import { TezgahView } from "../tezgah/Workspace.ts";
import { optimisticState, tezgahMachine } from "./Tezgah.ts";

const SEED = 119120;
/** JSON text, the only form a view takes on the wire. */
const Json = Schema.fromJsonString(Schema.Unknown);

/** A tile's fields as every client reads them off the wire: none may be left out. */
const FIELDS = ["id", "n", "shows", "program", "child", "keep", "cursor"] as const;

const step = (m: unknown, msg: unknown) => applyCell(tezgahMachine as never, m as never, msg as never)[0] as never;

describe("Desk S2a L11: tezgah's view in the window", () => {
  it.prop(
    "L11: tezgah's view round-trips through TezgahView in the window: the encoded wire keeps every tile's fields, child included, and the window's server state is the view",
    {
      view: Arbitrary.schema(TezgahView),
      rev: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1_000_000 }))),
    },
    ({ view, rev }) => {
      const wire: unknown = Schema.decodeSync(Json)(Schema.encodeSync(Json)(Schema.encodeSync(TezgahView)(view)));
      // The view as JSON carries it: JSON has no `-0`, which a schema's Arbitrary may make.
      const same = Schema.decodeUnknownSync(TezgahView)(wire);
      expect(JSON.stringify(Schema.encodeSync(TezgahView)(same)), "L11: the wire view decodes to the view it was").toBe(
        JSON.stringify(wire),
      );
      const tiles = (wire as { readonly tiles: ReadonlyArray<Record<string, unknown>> }).tiles;
      expect(tiles, "L11: one wire tile per tile").toHaveLength(view.tiles.length);

      for (const [i, tile] of tiles.entries()) {
        expect(Object.keys(tile).sort(), "L11: the wire tile keeps every field").toEqual(
          expect.arrayContaining([...FIELDS].sort()),
        );
        expect(tile["child"], "L11: the wire says whether tezgah started the tile").toBe(view.tiles[i]?.child);
        expect(typeof tile["child"], "L11: child is a boolean on the wire").toBe("boolean");
      }

      const [fresh] = tezgahMachine.init(null, { workspace: 1 });
      expect(fresh, "L11: a window's tezgah child starts with no server state").toMatchObject({
        workspace: 1,
        serverState: null,
        rev: 0,
        pendingMutations: [],
      });
      const after: { readonly serverState: unknown } = step(fresh, { type: "server", rev, view: wire });
      expect(after.serverState, "L11: the window's server state is tezgah's view").toEqual(same);
      expect(optimisticState(after as never), "L11: with nothing pending, the drawn state is the server's").toEqual(
        same,
      );

      // A wire view that drops `child` from a tile is not tezgah's view: the window keeps what it had.
      if (tiles.length > 0) {
        const dropped = { ...(wire as object), tiles: tiles.map(({ child: _child, ...rest }) => rest) };
        const kept: { readonly serverState: unknown } = step(after, { type: "server", rev: rev + 1, view: dropped });
        expect(kept.serverState, "L11: a view without child changes nothing").toEqual(same);
      }
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});

// Desk S2a, first review: a view patch in the window's tezgah child, as a program client takes one
// (`runtime/Client.ts`). A patch whose base is the shown revision and whose revision is one past it
// moves the server state to the patched view; any other patch past the shown revision keeps the
// shown view and asks for a whole one (one `ask` Cmd); a patch at or before the shown revision is
// old and changes nothing, asking for nothing. The walk folds the real machine from its real init:
// each step reads the revision it reached and makes a patch of one of those three kinds, or a whole
// view, from generated views and the real `diff`.
const Kind = Schema.Literals(["next", "next", "gap_base", "gap_rev", "old", "whole"]);

const PatchStep = Schema.Struct({
  kind: Kind,
  skew: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 })),
  to: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000 })),
});

const both = (
  m: unknown,
  msg: unknown,
): readonly [{ readonly serverState: unknown; readonly rev: number }, ReadonlyArray<{ readonly type: string }>] =>
  applyCell(tezgahMachine as never, m as never, msg as never) as never;

/** A view as the wire carries it, JSON. */
const onWire = (view: typeof TezgahView.Type): unknown =>
  Schema.decodeSync(Json)(Schema.encodeSync(Json)(Schema.encodeSync(TezgahView)(view)));

const text = (state: unknown) =>
  state === null ? "null" : Schema.encodeSync(Json)(Schema.encodeSync(TezgahView)(state as never));

describe("Desk S2a L11: a tezgah view patch in the window", () => {
  it.prop(
    "L11: a patch from the shown rev to one past it applies, a gap asks for a whole view and keeps the shown one, an old rev changes nothing",
    {
      // One view from the schema; the walk's other views are cut from it (tiles and workspaces dropped,
      // reordered, or none), since two independent draws of tezgah's view exhaust fast-check's discards.
      first: Arbitrary.schema(TezgahView),
      steps: Arbitrary.array(Arbitrary.schema(PatchStep), { minLength: 4, maxLength: 16 }),
      start: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 6, maximum: 1_000_000 }))),
    },
    ({ first, steps, start }) => {
      const wires = [
        first,
        { workspaces: first.workspaces.slice(1), tiles: first.tiles.slice(1) },
        { workspaces: [...first.workspaces].reverse(), tiles: [...first.tiles].reverse() },
        { workspaces: [], tiles: [] },
      ].map(onWire);
      const [fresh] = tezgahMachine.init(null, { workspace: 1 });
      let [m] = both(fresh, { type: "server", rev: start, view: wires[0] });
      let shown = wires[0];
      expect(text(m.serverState), "L11: the first whole view is shown").toBe(
        text(Schema.decodeUnknownSync(TezgahView)(shown)),
      );
      const seen = { applied: 0, asked: 0, old: 0 };

      // Each walk takes every kind once first, so each is walked; then the generated steps.
      const walk = [
        { kind: "next" as const, skew: 1, to: 1 },
        { kind: "gap_base" as const, skew: 1, to: 0 },
        { kind: "gap_rev" as const, skew: 2, to: 0 },
        { kind: "old" as const, skew: 1, to: 0 },
        ...steps,
      ];

      for (const { kind, skew, to } of walk) {
        const target = wires[to % wires.length];
        const rev = m.rev;
        const msg =
          kind === "whole"
            ? { type: "server", rev: rev + skew, view: target }
            : kind === "next"
              ? { type: "patch", base: rev, rev: rev + 1, patch: diff(shown, target) }
              : kind === "gap_base"
                ? { type: "patch", base: rev - skew, rev: rev + 1, patch: diff(shown, target) }
                : kind === "gap_rev"
                  ? { type: "patch", base: rev, rev: rev + 1 + skew, patch: diff(shown, target) }
                  : { type: "patch", base: rev - skew - 1, rev: rev - skew + 1, patch: diff(shown, target) };
        const [next, cmds] = both(m, msg);
        const asks = cmds.filter((c) => c.type === "ask").length;

        if (kind === "next" || kind === "whole") {
          seen.applied++;
          expect(text(next.serverState), `L11: ${kind} shows the new view`).toBe(
            text(Schema.decodeUnknownSync(TezgahView)(target)),
          );
          expect(next.rev, `L11: ${kind} moves the shown rev`).toBe(msg.rev);
          expect(asks, `L11: ${kind} asks for nothing`).toBe(0);
          shown = target;
        } else {
          seen[kind === "old" ? "old" : "asked"]++;
          expect(text(next.serverState), `L11: ${kind} keeps the shown view`).toBe(text(m.serverState));
          expect(next.rev, `L11: ${kind} keeps the shown rev`).toBe(rev);
          expect(
            asks,
            kind === "old" ? "L11: an old patch asks for nothing" : `L11: ${kind} asks for a whole view`,
          ).toBe(kind === "old" ? 0 : 1);
        }

        m = next;
      }

      expect(seen.applied + seen.asked + seen.old, "L11: every step was one of the three").toBe(walk.length);
      expect(Math.min(seen.applied, seen.asked, seen.old), "L11: the walk applied, asked and ignored").toBeGreaterThan(
        0,
      );
    },
    { arbitrary: { seed: SEED, runs: 200 } },
  );
});
