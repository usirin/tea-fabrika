// P15 slice 1, next/. The brain's code per program, one tea machine (0046): law L11 of the approved
// plan on the real `init` and reducer, and L20's type rows for the code facts' program names.
//
// L19, lint rows (A1): node imports and Promise edges are checked by .oxlintrc.json's
// fabrika/no-node-imports and fabrika/no-promises; package.json's lint:layers reads layer-rules.json.
// Review checks Code.ts's one machine/no I/O and CodeStore.ts's contract-only file. No existing
// lint rule enforces those two parts; ticket 509 owns the missing one-machine check.
//
// Test contract (the plan names the shapes; their export names are fixed here, and the builder
// follows them): `Code.ts` exports `From`, `CodeEvent` (`code.loaded`, `code.failed`), `Selected`
// (the machine's Model) and `code`, the one machine. Its Ctx is `{}`. Msgs, each with tea's `type`:
//   checked {id, program, hash, from}   a candidate passed its checks; nothing is selected yet
//   loaded {id, program, hash}          a `code.loaded` entry as the ledger holds it; `id` is the install's
// Cmds, each with tea's `type`:
//   append {id, event}                  `event` is one `code.loaded`; `id` names the install it answers
//   swap {load, program, hash}          `load` is the install's id
//
// Generator contract: a fast-check decision tape folded through the current model and the walk's own
// ledger of the `code.loaded` entries its appends asked for. Each cell picks a move possible now:
// a `checked` for a hash a program has selected, for a hash it has not, an install id seen before,
// or a `loaded` for an entry the ledger holds. The oracle is the walk's own selection, never the reducer.
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import { expectTypeOf } from "vitest";
import type { ProgramName } from "../packs/ProgramName.ts";
import * as Code from "./Code.ts";

const SEED = 119120;
const RUNS = 300;

type Model = typeof Code.Selected.Type;

/** Every Msg names the install it answers, its program and its hash; `checked` adds `from`. */
type Msg = {
  readonly type: "checked" | "loaded";
  readonly id: string;
  readonly program: string;
  readonly hash: string;
  readonly from?: From;
};

type Cmd = { readonly type: string; readonly [key: string]: unknown };

// 0135: the restated shapes below are pinned to the module's own types.
type Loaded = {
  readonly program: ProgramName;
  readonly hash: string;
  readonly was: string | null;
  readonly from: From;
};

type From = "watch" | "deploy" | "boot" | "restart";
type Selection = { readonly hash: string; readonly load: string };
expectTypeOf<Omit<(typeof Code.CodeEvent.cases)["code.loaded"]["Type"], "_tag">>().toEqualTypeOf<Loaded>();
expectTypeOf<typeof Code.From.Type>().toEqualTypeOf<From>();
expectTypeOf<Model[string]>().toEqualTypeOf<Selection>();

// L20 (type): both code facts take a program's qualified name; `code.failed`'s reason is closed.
expectTypeOf<(typeof Code.CodeEvent.cases)["code.loaded"]["Type"]["program"]>().toEqualTypeOf<ProgramName>();
expectTypeOf<(typeof Code.CodeEvent.cases)["code.failed"]["Type"]["program"]>().toEqualTypeOf<ProgramName>();

expectTypeOf<(typeof Code.CodeEvent.cases)["code.failed"]["Type"]["reason"]>().toEqualTypeOf<
  "bundle" | "compiler" | "load" | "name" | "too_large"
>();

expectTypeOf<(typeof Code.CodeEvent.Type)["_tag"]>().toEqualTypeOf<"code.loaded" | "code.failed">();

const step = (model: Model, msg: Msg): readonly [Model, ReadonlyArray<Cmd>] => {
  const [next, cmds] = applyCell(Code.code, model, msg as never);
  return [next, cmds as ReadonlyArray<Cmd>];
};

/** The selection as stored: encoded to JSON text, then decoded back from that text. */
const Stored = Schema.fromJsonString(Code.Selected);

const roundTrip = (model: Model): Model => Schema.decodeUnknownSync(Stored)(Schema.encodeSync(Stored)(model));

const hashes = fc.uint8Array({ minLength: 32, maxLength: 32 }).map((b) => Buffer.from(b).toString("hex"));
const names = fc.stringMatching(/^[a-z_][a-z0-9-]{0,7}\/[a-z_][a-z0-9-]{0,7}$/);
const froms = fc.constantFrom<From>("watch", "deploy", "boot", "restart");

const Cell = fc.record({
  move: fc.noBias(fc.nat()),
  pick: fc.noBias(fc.nat()),
  hash: hashes,
  from: froms,
});
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;
const tapes = fc.tuple(fc.uniqueArray(names, { minLength: 1, maxLength: 4 }), fc.array(Cell, { maxLength: 60 }));

/** What the walk knows from its own moves only. */
type World = {
  model: Model;
  /** The walk's own selection, program to {hash, load}. */
  selected: Map<string, Selection>;
  /** The `code.loaded` entries its appends asked for, as the ledger would hold them. */
  ledger: Array<{ readonly id: string; readonly program: string; readonly hash: string }>;
  /** Every hash the walk has made, per program, and every install id it has used. */
  seen: Map<string, Array<string>>;
  ids: Array<{ readonly id: string; readonly program: string; readonly hash: string }>;
  /** The append id each install id produced, so a repeat must produce the same one. */
  appendIds: Map<string, string>;
  reached: Set<string>;
};

type Move = { readonly name: string; readonly msg: Msg };

const nth = <A>(items: ReadonlyArray<A>, i: number): A => {
  const item = items[i % items.length];

  if (item === undefined) {
    throw new Error("a walk chose from an empty list");
  }

  return item;
};

/** The moves possible from the walk's current selection and ledger. */
const moves = (w: World, programs: ReadonlyArray<string>, cell: Cell, n: number): ReadonlyArray<Move> => {
  const program = nth(programs, cell.pick);
  const fresh = `install_${n}`;
  const options: Array<Move> = [
    { name: "checked_new", msg: { type: "checked", id: fresh, program, hash: cell.hash, from: cell.from } },
  ];
  const earlier = w.seen.get(program) ?? [];

  if (earlier.length > 0) {
    options.push({
      name: "checked_earlier",
      msg: { type: "checked", id: fresh, program, hash: nth(earlier, cell.pick), from: cell.from },
    });
  }

  const chosen = [...w.selected.entries()];

  if (chosen.length > 0) {
    const [p, s] = nth(chosen, cell.pick);
    options.push({
      name: "checked_selected",
      msg: { type: "checked", id: fresh, program: p, hash: s.hash, from: "watch" },
    });
  }

  if (w.ids.length > 0) {
    // A repeated install: the same id, program and hash the watcher sent before.
    const again = nth(w.ids, cell.pick);
    options.push({ name: "checked_repeat", msg: { type: "checked", ...again, from: cell.from } });
  }

  if (w.ledger.length > 0) {
    const entry = nth(w.ledger, cell.pick);
    options.push(
      { name: "loaded", msg: { type: "loaded", ...entry } },
      { name: "loaded", msg: { type: "loaded", ...entry } },
    );
  }

  return options;
};

const walk = (
  programs: ReadonlyArray<string>,
  tape: ReadonlyArray<Cell>,
  observe: (before: Model, move: Move, after: Model, cmds: ReadonlyArray<Cmd>, w: World) => void,
): World => {
  const w: World = {
    model: Code.code.init(null, {})[0],
    selected: new Map(),
    ledger: [],
    seen: new Map(),
    ids: [],
    appendIds: new Map(),
    reached: new Set(),
  };

  for (const [n, cell] of tape.entries()) {
    const move = nth(moves(w, programs, cell, n), cell.move);
    const before = w.model;
    const [after, cmds] = step(before, move.msg);
    w.reached.add(move.name);
    observe(before, move, after, cmds, w);
    account(move, cmds, w);
    w.model = after;
  }

  return w;
};

/** Keeps the walk's own account: its selection moves only on `loaded`, its ledger only on an append. */
const account = (move: Move, cmds: ReadonlyArray<Cmd>, w: World): void => {
  const { id, program, hash } = move.msg;
  w.seen.set(program, [...new Set([...(w.seen.get(program) ?? []), hash])]);

  if (move.msg.type === "loaded") {
    w.selected.set(program, { hash, load: id });
    return;
  }

  if (!w.ids.some((i) => i.id === id)) {
    w.ids.push({ id, program, hash });
  }

  for (const cmd of cmds) {
    if (cmd.type === "append" && !w.ledger.some((e) => e.id === id && e.hash === hash)) {
      w.ledger.push({ id, program, hash });
    }
  }
};

describe("P15 slice 1: the brain's code per program", () => {
  it("L11: the selection changes only on loaded; checked emits one append with the selected was, or nothing on the selected hash; loaded emits one swap", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(tapes, ([programs, tape]) => {
        const w = walk(programs, tape, (before, move, after, cmds, w) => {
          // The Model is legal and survives its own schema at every step.
          expect(Schema.is(Code.Selected)(after)).toBe(true);
          expect(roundTrip(after)).toEqual(after);
          const { id, program, hash } = move.msg;
          const current = w.selected.get(program);

          if (move.msg.type === "checked") {
            // A candidate that passed its checks selects nothing.
            expect(after, `${move.name} changed the selection`).toEqual(before);

            if (current?.hash === hash) {
              // p72: the hash already selected is nothing a reader sees.
              expect(cmds, "checked with the selected hash emits nothing").toEqual([]);
              seen.add("same");
              return;
            }

            expect(cmds.map((c) => c.type)).toEqual(["append"]);
            const [append] = cmds;
            const event = Schema.decodeUnknownSync(Code.CodeEvent)(append?.event);
            expect(event).toEqual(
              Code.CodeEvent.cases["code.loaded"].make({
                program,
                hash,
                was: current?.hash ?? null,
                from: move.msg.from ?? "watch",
              }),
            );
            // A repeated install id names the same entry, so the ledger appends it once.
            const appendId = String(append?.id);
            const prior = w.appendIds.get(id);
            expect(prior ?? appendId, "a repeated install id asks for the same entry").toBe(appendId);

            for (const [other, value] of w.appendIds) {
              if (other !== id) {
                expect(value, "two installs never share an entry id").not.toBe(appendId);
              }
            }

            w.appendIds.set(id, appendId);
            seen.add(current === undefined ? "first" : "was");
            return;
          }

          // loaded: the program selects the entry's hash under its load, and that one swap is pushed.
          expect(after).toEqual({ ...before, [program]: { hash, load: id } });
          expect(cmds).toEqual([{ type: "swap", load: id, program, hash }]);
          seen.add("loaded");
        });

        for (const name of w.reached) {
          seen.add(name);
        }

        // The machine's model is the walk's selection, whole.
        expect(w.model).toEqual(Object.fromEntries(w.selected));
      }),
      { seed: SEED, numRuns: RUNS },
    );

    for (const name of ["same", "first", "was", "loaded", "checked_repeat", "checked_earlier", "checked_selected"]) {
      expect(seen.has(name), `the walk reaches ${name}`).toBe(true);
    }
  });
});
