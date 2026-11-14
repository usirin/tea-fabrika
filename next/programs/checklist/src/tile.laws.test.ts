// P14 slice 2, next/ (ticket 828): the checklist tile's own machine, law L22 of the approved plan.
// Written before `tile.ts`.
//
// The shape this law holds `tile.ts` to, from the plan (the build may add more):
// - `tile`: one tea machine (`Machine.make` from `@demlik/tea/effect`). Its Model is `{draft}`, a string
//   of at most 80 characters, and its init is `{draft: ""}`.
// - Msgs by `type`: typed{text} and submit{}. Its one Cmd is `press {m}`, which the window parent reads
//   and sends on as a letter; no engine runs it.
// - typed sets the draft (capped at 80); submit with an empty draft does nothing; submit with text
//   empties the draft and returns exactly one `press {m: {type: "add", name: draft}}`.
//
// The walk starts at the real init, folds the real update, and picks each next move from the folded
// draft: a typed text (empty, short, at the cap or past it), or a submit of what is there now.
import { applyCell } from "@demlik/tea";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import type { checklistMachine } from "./program.ts";
import { tile } from "./tile.ts";

const SEED = 119120;
const CAP = 80;

// The exam's own statement of the tile's Model, pinned to the schema's type (0135).
type Tile = { readonly draft: string };
expectTypeOf<Tile>().toEqualTypeOf<typeof tile.model.Type>();

type Msg = { readonly type: "typed"; readonly text: string } | { readonly type: "submit" };
expectTypeOf<Msg>().toEqualTypeOf<typeof tile.msg.Type>();
type Cmd = { readonly type: string; readonly m?: unknown };
/** The program's own add, so a press the tile hands up is a Msg the checklist takes. */
type Add = Extract<typeof checklistMachine.msg.Type, { readonly type: "add" }>;

const step = (s: Tile, m: Msg): readonly [Tile, ReadonlyArray<Cmd>] => applyCell(tile, s, m);

const choice = fc.record({
  move: fc.nat(),
  text: fc.oneof(
    fc.constant(""),
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.string({ minLength: CAP - 2, maxLength: CAP + 20 }),
    fc.string({ unit: "grapheme", minLength: 1, maxLength: 40 }),
  ),
});

type Choice = typeof choice extends fc.Arbitrary<infer C> ? C : never;

/** The moves the folded draft allows: type over it, or submit what it holds now. */
const moves = (s: Tile, c: Choice): ReadonlyArray<Msg> =>
  s.draft === ""
    ? [{ type: "typed", text: c.text }, { type: "submit" }]
    : [{ type: "submit" }, { type: "typed", text: c.text }];

const walk = (
  list: ReadonlyArray<Choice>,
  each: (prev: Tile, m: Msg, next: Tile, cmds: ReadonlyArray<Cmd>) => void,
) => {
  const [first, cmds0] = tile.init(null, {});
  expect(first).toEqual({ draft: "" });
  expect(cmds0).toEqual([]);
  let s: Tile = first;

  for (const c of list) {
    const options = moves(s, c);
    const m = options[c.move % options.length]!;
    const before = structuredClone(s);
    const [next, cmds] = step(s, m);
    expect(s, "the old Model was changed").toEqual(before);
    each(s, m, next, cmds);
    s = next;
  }
};

const walks = fc.array(choice, { minLength: 1, maxLength: 40 });
const opts = { seed: SEED, numRuns: 200 };

describe("L22: the checklist tile", () => {
  it("typed sets the draft, capped at 80, and returns no Cmd", () => {
    const seen = { short: 0, long: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        walk(list, (_prev, m, next, cmds) => {
          if (m.type !== "typed") {
            return;
          }

          expect(cmds).toEqual([]);
          expect(next.draft.length, "the draft passes the cap").toBeLessThanOrEqual(CAP);
          expect(m.text.startsWith(next.draft), "the draft is what was typed, from its start").toBe(true);
          seen[m.text.length <= CAP ? "short" : "long"]++;
          expect(m.text.length <= CAP ? next.draft : null).toBe(m.text.length <= CAP ? m.text : null);
        });
      }),
      opts,
    );
    expect(seen.short).toBeGreaterThan(0);
    expect(seen.long, "the walks typed past the cap").toBeGreaterThan(0);
  });

  it("submit with an empty draft does nothing; with text it empties the draft and hands up exactly one press add", () => {
    const seen = { empty: 0, sent: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        walk(list, (prev, m, next, cmds) => {
          if (m.type !== "submit") {
            return;
          }

          if (prev.draft === "") {
            seen.empty++;
            expect([next, cmds], "an empty submit sent something").toEqual([prev, []]);
            return;
          }

          seen.sent++;
          const add: Add = { type: "add", name: prev.draft };
          expect(next).toEqual({ draft: "" });
          expect(cmds).toHaveLength(1);
          expect(cmds[0]).toMatchObject({ type: "press", m: add });
        });
      }),
      opts,
    );
    expect(seen.empty).toBeGreaterThan(0);
    expect(seen.sent).toBeGreaterThan(0);
  });

  it("the Model round-trips its schema at every step", () => {
    const decode = Schema.decodeUnknownSync(Schema.toType(tile.model));
    const encode = Schema.encodeSync(Schema.toType(tile.model));
    fc.assert(
      fc.property(walks, (list) => {
        walk(list, (_prev, _m, next) => {
          expect(decode(encode(next))).toEqual(next);
        });
      }),
      opts,
    );
  });
});
