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
