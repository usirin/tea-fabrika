// fabsh in a tile, slice 1, next/: the tile machine's laws L4 (0275's agreement), L5, L12 and L19 (the
// tile's half) of the approved plan (docs/plan/lanes/fabsh-PLAN.md, "Laws"). Written before `tile.ts`
// and `program.ts`, which the build creates; until it does, this file fails on its missing imports.
//
// The shape these laws hold `tile.ts` to, from the plan's "The tile" (the build may add more):
// - `tile`: one tea machine (`Machine.make` from `@demlik/tea/effect`). Its Model keeps the server
//   state and the pending edit apart: `echoed` (the newest echo, a Draft), `mine` (what the person's
//   input holds now, a Draft), `flight` (the `n` of the one frame in flight, or null), `queued`
//   (an edit came while a frame was in flight), and `frames`, `echoes`, `slowest` for the one client
//   row per line. Its init's `mine` and `echoed` are `{text: "", cursor: 0, n: 0}`.
// - `drawn(model)`: the line the tile draws, derived, never stored: `mine` while it has focus or any
//   edit is pending, else `echoed` (LiveView's rule).
// - Msgs: `edited {text, cursor}`, `tab {programs}`, `recall {to, history}`, `enter`, `echoed {value,
//   ms}`, `echo_refused {reason}`, `blurred`. `tab` and `recall` carry what they read from the view
//   (its programs, its history), since a tile machine reads no view of its own: this is the one
//   shape these laws add to the plan's list, and the report names it.
// - Cmds: `draft {m: Draft}` and `press {m: {type: "submitted", line}}`. The parent sends a draft as
//   one ephemeral frame and hands its answer back as `echoed` or `echo_refused`; a frame lost with
//   its dial comes back as `echo_refused` too.
// - `enter` presses the whole drawn line as typed, and starts the next line with one frame
//   `{text: "", cursor: 0, n}`.
//
// The walk starts at the real init, folds the real update, and picks each next move from what is
// possible now: an edit, a Tab, a recall, an Enter, a blur, or an answer to the frame really in
// flight (its echo, its refusal, a lost frame, a lost echo). The process beside it is the program's
// real draft check (`fabsh.draft`) and one value in memory, which a wake drops.
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import * as fc from "fast-check";
import { fabsh } from "./program.ts";
import { drawn, tile } from "./tile.ts";

const SEED = 119120;
/** A typed letter of a line is marked, so a row or a Model field that copies text shows. */
const MARK = "q~";

type Draft = { readonly text: string; readonly cursor: number; readonly n: number };
type Tile = typeof tile.model.Type;
type Msg = typeof tile.msg.Type;
type Cmd = { readonly type: string; readonly m?: unknown };

const EMPTY: Draft = { text: "", cursor: 0, n: 0 };

const decodeDraft = Schema.decodeUnknownResult(fabsh.draft!.schema);

/** The process's side of one frame: the program's real draft check, then the value kept in memory. */
const processTakes = (m: unknown): Draft | null => {
  const decoded = decodeDraft(m);
  return Result.isSuccess(decoded) && fabsh.draft!.refuse(decoded.success) === null ? (decoded.success as Draft) : null;
};

const choice = fc.record({
  move: fc.nat(),
  text: fc.oneof(
    fc.constantFrom("h", "he", "hel", "help", "hlep", "help x", "clear", "his", "history", ""),
    fc.string({ maxLength: 40 }).map((s) => s.replace(/\n/g, " ")),
    fc.stringMatching(/^[a-z ]{0,20}$/).map((s) => `${MARK}${s}`),
  ),
  at: fc.nat(),
  ms: fc.integer({ min: 0, max: 5_000 }),
  to: fc.constantFrom("back" as const, "forward" as const),
});

type Choice = typeof choice extends fc.Arbitrary<infer C> ? C : never;
const walks = fc.array(choice, { minLength: 1, maxLength: 80, size: "max" });

/** What the walk keeps beside the tile: the frame in flight, every frame sent, the process's memory. */
type World = {
  s: Tile;
  waiting: Array<Draft>;
  sent: Array<Draft>;
  memory: Draft | null;
  history: Array<string>;
  presses: Array<string>;
};

type Event = {
  readonly prev: Tile;
  readonly m: Msg;
  readonly next: Tile;
  readonly cmds: ReadonlyArray<Cmd>;
  readonly world: World;
  /** What this move was, beyond its Msg: a frame lost, an echo lost, or a wake. */
  readonly kind: "msg" | "echo" | "lost_frame" | "lost_echo" | "refused";
};

const moves = (w: World, c: Choice): ReadonlyArray<() => readonly [Msg, Event["kind"]]> => {
  const out: Array<() => readonly [Msg, Event["kind"]]> = [];
  const text = c.text;
  out.push(() => [{ type: "edited", text, cursor: c.at % (text.length + 1) }, "msg"]);
  out.push(() => [{ type: "edited", text, cursor: text.length }, "msg"]);
  out.push(() => [{ type: "tab", programs: [] }, "msg"]);
  out.push(() => [{ type: "recall", to: c.to, history: [...w.history] }, "msg"]);
  out.push(() => [{ type: "enter" }, "msg"]);
  out.push(() => [{ type: "blurred" }, "msg"]);

  const frame = w.waiting[0];

  if (frame !== undefined) {
    // The answer to the frame really in flight: the process takes it and echoes its newest draft.
    for (let i = 0; i < 3; i++) {
      out.push(() => {
        w.waiting.shift();
        const kept = processTakes(frame);

        if (kept === null) {
          return [{ type: "echo_refused", reason: "bad_draft" }, "refused"];
        }

        w.memory = kept;
        return [{ type: "echoed", value: kept, ms: c.ms }, "echo"];
      });
    }

    out.push(() => {
      // The frame is lost on its way (an at-most-once lane, or a dial that ended): the process never saw it.
      w.waiting.shift();
      return [{ type: "echo_refused", reason: "unreachable" }, "lost_frame"];
    });
    out.push(() => {
      // The echo is lost on its way back: the process took the frame, the tile never hears.
      w.waiting.shift();
      w.memory = processTakes(frame) ?? w.memory;
      return [{ type: "echo_refused", reason: "unreachable" }, "lost_echo"];
    });
  }

  // A process wake: its memory draft is gone, and nothing tells the tile.
  out.push(() => {
    w.memory = null;
    return [{ type: "blurred" }, "msg"];
  });

  return out;
};

const fold = (list: ReadonlyArray<Choice>, each: (e: Event) => void): World => {
  const [first, cmds0] = tile.init(null, {});
  expect(cmds0, "init sends nothing").toEqual([]);
  expect(drawn(first), "init draws an empty line").toEqual(EMPTY);
  const w: World = { s: first, waiting: [], sent: [], memory: null, history: [], presses: [] };

  for (const c of list) {
    const options = moves(w, c);
    const [m, kind] = options[c.move % options.length]!();
    const prev = w.s;
    const before = structuredClone(prev);
    const [next, cmds] = applyCell(tile, prev, m) as readonly [Tile, ReadonlyArray<Cmd>];
    expect(prev, "the old Model was changed").toEqual(before);

    for (const cmd of cmds) {
      if (cmd.type === "draft") {
        const d = cmd.m as Draft;
        w.waiting.push(d);
        w.sent.push(d);
      }

      if (cmd.type === "press") {
        const line = (cmd.m as { readonly line: string }).line;
        w.presses.push(line);
        w.history.push(line);
      }
    }

    w.s = next;
    each({ prev, m, next, cmds, world: w, kind });
  }

  return w;
};

const opts = { seed: SEED, numRuns: 300 };

describe("L5: a letter is drawn in the update that takes it", () => {
  it("L5: the drawn line after an edited Msg is that Msg's text and cursor, before any answer", () => {
    let edits = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ m, next, cmds }) => {
          if (m.type !== "edited") {
            return;
          }

          edits++;
          expect(drawn(next), "the letter is drawn at once").toMatchObject({ text: m.text, cursor: m.cursor });
          expect(
            cmds.filter((c) => c.type === "press"),
            "an edit presses nothing",
          ).toEqual([]);
        });
      }),
      { seed: SEED, numRuns: 200 },
    );
    expect(edits).toBeGreaterThan(0);
  });
});

describe("L4: 0275's agreement, the drawn letter and the process agree", () => {
  it("L4: for any run of edits, recalls, Tabs, Enters, lost frames, lost echoes and wakes, once the last edit is echoed the drawn line is the process's draft", () => {
    const seen = { settled: 0, lost: 0, wakes: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ m, next, world, kind }) => {
          seen.lost += kind === "lost_frame" || kind === "lost_echo" ? 1 : 0;

          if (kind !== "echo" || m.type !== "echoed") {
            return;
          }

          const settled = next.flight === null && !next.queued && next.echoed.n === next.mine.n;

          if (!settled) {
            return;
          }

          seen.settled++;
          expect(drawn(next), "the drawn line is the echo of the last edit").toEqual(m.value);
          expect(drawn(next), "the drawn line is what the process holds").toEqual(world.memory);
        });
      }),
      opts,
    );
    expect(seen.settled).toBeGreaterThan(0);
    expect(seen.lost).toBeGreaterThan(0);
  });

  it("L4: an echo of an older edit never moves the drawn line while a newer edit is pending", () => {
    let stale = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next }) => {
          if (m.type !== "echoed" || m.value.n >= prev.mine.n) {
            return;
          }

          stale++;
          expect(drawn(next), "a stale echo moved the drawn line").toEqual(drawn(prev));
        });
      }),
      opts,
    );
    expect(stale).toBeGreaterThan(0);
  });

  it("L13, the tile's half: Enter presses the whole drawn line as typed, and starts the next line empty", () => {
    let pressed = 0;
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ prev, m, next, cmds }) => {
          if (m.type !== "enter") {
            return;
          }

          const presses = cmds.filter((c) => c.type === "press");

          if (drawn(prev).text.trim() === "") {
            return;
          }

          pressed++;
          expect(presses, "Enter presses once").toEqual([
            { type: "press", m: { type: "submitted", line: drawn(prev).text } },
          ]);
          expect(drawn(next)).toMatchObject({ text: "", cursor: 0 });
          expect(next.mine.n, "the empty line is a new edit").toBeGreaterThan(prev.mine.n);
        });
      }),
      opts,
    );
    expect(pressed).toBeGreaterThan(0);
  });
});

describe("L12: at most one frame in flight, and the newest edit is the last frame sent", () => {
  it("L12: no Cmd sends a second frame while one is unanswered, and with none in flight the last frame sent is the newest edit", () => {
    const seen = { queued: 0, idle: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        fold(list, ({ next, cmds, world }) => {
          expect(cmds.filter((c) => c.type === "draft").length, "one step sends at most one frame").toBeLessThanOrEqual(
            1,
          );
          expect(world.waiting.length, "two frames in flight").toBeLessThanOrEqual(1);
          expect(next.flight === null, "the Model's flight is the frame really in flight").toBe(
            world.waiting.length === 0,
          );
          seen.queued += next.queued ? 1 : 0;

          if (world.waiting.length === 0) {
            seen.idle++;
            expect(
              world.sent.length === 0 ? EMPTY : world.sent.at(-1),
              "with no frame in flight, the newest edit was the last frame sent",
            ).toEqual(next.mine);
          }
        });
      }),
      opts,
    );
    expect(seen.queued, "some edits came while a frame was in flight").toBeGreaterThan(0);
    expect(seen.idle).toBeGreaterThan(0);
  });
});

describe("L19, the tile's half: the counts for the one draft row per line", () => {
  it("L19: frames, echoes and the slowest echo count since the last Enter, and the Model keeps no other copy of the text", () => {
    let lines = 0;
    fc.assert(
      fc.property(walks, (list) => {
        let since = { frames: 0, echoes: 0, slowest: 0 };
        fold(list, ({ m, next, cmds }) => {
          if (m.type === "enter" && cmds.some((c) => c.type === "press")) {
            lines++;
            since = { frames: 0, echoes: 0, slowest: 0 };
          }

          since.frames += cmds.filter((c) => c.type === "draft").length;

          if (m.type === "echoed") {
            since.echoes++;
            since.slowest = Math.max(since.slowest, m.ms);
          }

          expect({ frames: next.frames, echoes: next.echoes, slowest: next.slowest }).toEqual(since);
          const { echoed: _e, mine: _m, ...rest } = next;
          expect(JSON.stringify(rest).includes(MARK), "a Model field besides the two drafts holds typed text").toBe(
            false,
          );
        });
      }),
      opts,
    );
    expect(lines).toBeGreaterThan(0);
  });
});
