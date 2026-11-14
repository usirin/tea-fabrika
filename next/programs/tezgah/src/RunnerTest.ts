// Desk S2a, next/ (the desk program fabrika/tezgah, ticket named by its title): law L8's real half,
// a suite the part that owns a real local instance runs (0062): `RunnerTest.suite(open)`. A program
// imports only the library's front, so the instance, its door and its process table are the app's
// (`next/apps/fabrika/src/tezgah-runner.laws.test.ts`); this file holds the law. L8's pure half, on
// every generated layout, is in `program.laws.test.ts`.
//
// What the law holds the real instance to (plan amendment, 2026-11-14): a close of a tile tezgah
// started stops that tile's process with `shutdown` through the Worker's `stop_child`; a close of a
// tile tezgah did not start, such as workspace 1's boot tile `checklist:1`, stops nothing; and no
// close stops another tile's process. Each run of the walk takes a workspace of its own: the first
// run takes workspace 1, whose first tile is the boot list's `checklist:1`, and each later run a new
// workspace, whose first tile tezgah starts itself. Every move is picked from tezgah's view as it
// stands: a split from a live tile, a close of a live tile.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Predicate, Schema, type Scope } from "effect";
import * as fc from "fast-check";

const SEED = 119120;
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
/** How long a wait on the instance may take before the law fails with what it last saw. */
const WAIT = 60;

/** A canonical UUIDv7 TypeID for `n`, made here so the law does not lean on the generator it checks. */
const typeId = (prefix: string, n: number): string => {
  let uuid = (BigInt(n) << 80n) | (7n << 76n) | (2n << 62n);
  let suffix = "";

  for (let i = 0; i < 26; i++) {
    suffix = ALPHABET[Number(uuid & 31n)] + suffix;
    uuid >>= 5n;
  }

  return `${prefix}_${suffix}`;
};

/** What the part that owns the instance supplies, in its scope: one real local instance with one
 *  founder, whose door letters it sends. `send` is one founder's letter to tezgah's process, and
 *  its answer's tag; `view` is tezgah's view now, as `view.open` gives it; `process` is a name's
 *  state: whether it is live now, and the exit reasons of its lives that exited. */
export type Open = Effect.Effect<
  {
    readonly send: (m: unknown) => Effect.Effect<unknown>;
    readonly view: Effect.Effect<unknown>;
    readonly process: (
      name: string,
    ) => Effect.Effect<{ readonly live: boolean; readonly exited: ReadonlyArray<unknown> }>;
  },
  never,
  Scope.Scope
>;

/** A letter's answer as the door gives it: taken, or refused for a reason. */
const Answer = Schema.TaggedUnion({
  accepted: {},
  refused: { reason: Schema.String },
  error: { reason: Schema.String },
});

const answered = (u: unknown) => Schema.decodeUnknownSync(Answer)(u);

/** The keybindings note's Via, as the window sends it. */
const Via = Schema.TaggedUnion({ key: { keys: Schema.String } });

/** What the law reads of tezgah's view: each workspace's tiles in reading order, and each tile. */
const View = Schema.Struct({
  workspaces: Schema.Array(Schema.Struct({ n: Schema.Int, layout: Schema.Unknown })),
  tiles: Schema.Array(Schema.Struct({ id: Schema.String, shows: Schema.String, child: Schema.Boolean })),
});
type View = typeof View.Type;

const order = (node: unknown): ReadonlyArray<string> =>
  Predicate.isString(node)
    ? [node]
    : Predicate.hasProperty(node, "parts") && Array.isArray(node.parts)
      ? node.parts.flatMap((p: unknown) => (Predicate.hasProperty(p, "inner") ? order(p.inner) : []))
      : [];

const tilesOn = (v: View, n: number) => {
  const space = v.workspaces.find((w) => w.n === n);
  return space === undefined ? [] : order(space.layout).flatMap((id) => v.tiles.filter((t) => t.id === id));
};

const via = Schema.encodeSync(Via)(Via.cases.key.make({ keys: "ctrl+b x" }));
let minted = 0;
const fresh = () => typeId("tile", 70_000 + ++minted);

type Live = Effect.Success<Open>;

/** Polls `look` once a second until `done`, then answers it; past WAIT it fails with what it last saw. */
const until = <A>(label: string, look: Effect.Effect<A>, done: (a: A) => boolean) =>
  Effect.gen(function* () {
    let last: A | undefined;

    for (let n = 0; n < WAIT; n++) {
      last = yield* look;

      if (done(last)) {
        return last;
      }

      yield* Effect.sleep("1 second");
    }

    return yield* Effect.die(new Error(`${label}: no answer in ${WAIT} s; last saw ${JSON.stringify(last)}`));
  });

const readView = (live: Live) => Effect.map(live.view, (v) => Schema.decodeUnknownSync(View)(v));

/** One move of the walk on workspace `n`: a split from a live tile, or a close of one. */
type Move = { readonly kind: "split_right" | "split_down" | "close"; readonly pick: number };

const step = Effect.fnUntraced(function* (live: Live, n: number, m: Move) {
  const before = yield* readView(live);
  const tiles = tilesOn(before, n);
  const from = tiles[m.pick % tiles.length];

  if (from === undefined) {
    return;
  }

  if (m.kind !== "close") {
    const tile = fresh();
    const does = m.kind === "split_right" ? "tezgah.split_right" : "tezgah.split_down";
    expect(answered(yield* live.send({ type: "did", does, from: from.id, via, tile }))._tag).toBe("accepted");
    yield* until(`the split's ${tile} on workspace ${n}`, readView(live), (v) =>
      tilesOn(v, n).some((t) => t.id === tile),
    );
    return;
  }

  const was = yield* live.process(from.shows);
  const answer = answered(yield* live.send({ type: "did", does: "tezgah.close", from: from.id, via }));

  if (tiles.length === 1) {
    expect(answer, "the last tile of a workspace never closes").toEqual(
      Answer.cases.refused.make({ reason: "last_tile" }),
    );
    return;
  }

  expect(answer._tag).toBe("accepted");
  yield* until(`the close of ${from.id}`, readView(live), (v) => !tilesOn(v, n).some((t) => t.id === from.id));
  const others = before.tiles.filter((t) => t.id !== from.id);

  if (from.child) {
    const ended = yield* until(`${from.shows} ends`, live.process(from.shows), (p) => !p.live);
    expect(ended.exited.length, `L8: one more exit for ${from.shows}`).toBe(was.exited.length + 1);
    expect(
      Predicate.isTagged(ended.exited.at(-1), "shutdown"),
      `L8: ${from.shows}, a tile tezgah started, ends with shutdown, not ${JSON.stringify(ended.exited.at(-1))}`,
    ).toBe(true);
  } else {
    // A stop takes its turn within a second on a quiet instance; give it three before reading.
    yield* Effect.sleep("3 seconds");
    const kept = yield* live.process(from.shows);
    expect(kept.live, `L8: ${from.shows}, a tile tezgah did not start, keeps running`).toBe(true);
    expect(kept.exited, `L8: ${from.shows} has no new exit`).toEqual(was.exited);
  }

  for (const other of others) {
    expect((yield* live.process(other.shows)).live, `L8: closing ${from.id} leaves ${other.shows} running`).toBe(true);
  }
});

const Moves = fc.array(
  fc.record({ kind: fc.constantFrom<Move["kind"]>("split_right", "split_down", "close", "close"), pick: fc.nat() }),
  { minLength: 3, maxLength: 7 },
);

/** Runs on the instance cost seconds each, so the walk takes four seeded samples of the generator, one
 *  workspace each, in place of a shrinking property: each sample is still a generated walk. */
const RUNS = 4;

export const suite = (open: Open) =>
  describe("Desk S2a L8 on the real instance", () => {
    it.live(
      "L8: a close of a tile tezgah started stops that process; a close of any other tile stops nothing",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const live = yield* open;

            for (const [i, moves] of fc.sample(Moves, { seed: SEED, numRuns: RUNS }).entries()) {
              const n = i + 1;
              expect(answered(yield* live.send({ type: "attach", workspace: n, tile: fresh() }))._tag).toBe("accepted");
              const first = yield* until(`workspace ${n}`, readView(live), (v) => tilesOn(v, n).length === 1);

              if (n === 1) {
                expect(tilesOn(first, 1), "workspace 1's first tile is the boot list's checklist:1").toMatchObject([
                  { shows: "checklist:1", child: false },
                ]);
              }

              // Each walk splits once first, so a close has a tile to take.
              yield* step(live, n, { kind: "split_right", pick: 0 });

              for (const m of moves) {
                yield* step(live, n, m);
              }
            }
          }),
        ),
      { timeout: 900_000 },
    );
  });
