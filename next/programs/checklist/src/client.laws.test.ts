// P14 slice 2, next/ (ticket 828): the checklist through libfabrika's real program client, law L23 of
// the approved plan. Written before `Client.ts`, `checklistView` and `window.tsx`.
//
// The shape this law holds the code to, from the plan (the build may add more):
// - `./program.ts` exports `checklistView`, the schema of what `checklist.view` returns.
// - `./window.tsx` exports `checklistWindow`, whose `data` is `checklistView`.
// - `@kampus/libfabrika` exports `clientMachineFor({decode})`, the program client machine, whose
//   `notice {pid, note}` installs a whole `{type: "whole", rev, view}` or a patch
//   `{type: "patch", base, rev, patch}` when the pid's own decoder passes, and keeps it in
//   `views[pid] = {rev, view}`; and `diff`, the brain's own patch maker.
//
// The walk starts at the checklist's real init and folds its real update. Each step reads the folded
// model and picks a Msg legal there: add a new name or one on the list (refused, so nothing changes),
// rename, remove, check or uncheck an item it holds, or a timer at a later time. Each accepted change
// reaches the client as the brain sends it, a whole view or the real `diff` of the two views.
import { applyCell } from "@demlik/tea";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { clientMachineFor, diff } from "@kampus/libfabrika";
import { Exit, Schema } from "effect";
import * as fc from "fast-check";
import { checklist, checklistMachine, checklistView } from "./program.ts";
import { checklistWindow } from "./window.tsx";

const SEED = 119120;
const PID = "process_01m6v5270hf3c8x2q7w9z4k5mn";
const DAY = 86_400_000;

// The exam's own statement of the view, pinned to the schema's type (0135).
type View = {
  readonly items: ReadonlyArray<{
    readonly name: string;
    readonly state: "new" | "open" | "late" | "checked";
    readonly note: string | null;
  }>;
  readonly left: number;
};

expectTypeOf<View>().toEqualTypeOf<typeof checklistView.Type>();

type Model = typeof checklistMachine.model.Type;
type Msg = typeof checklistMachine.msg.Type;

const decode = Schema.decodeUnknownSync(checklistWindow.data);
const client = clientMachineFor({ decode: () => decode });
type ClientModel = ReturnType<typeof client.init>[0];

const POOL = ["milk", "bread", "eggs", "tea", "a".repeat(80)] as const;

const choice = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  name: fc.constantFrom(...POOL),
  later: fc.integer({ min: 0, max: 2 * DAY }),
  whole: fc.boolean(),
});

type Choice = typeof choice extends fc.Arbitrary<infer C> ? C : never;

/** The Msgs the folded model allows now, each with the item it names read off the model. */
const moves = (m: Model, now: number, c: Choice): ReadonlyArray<Msg> => {
  const names = m.items.map((i) => i.name);
  const held = names.length === 0 ? null : names[c.pick % names.length]!;
  const out: Array<Msg> = [
    { type: "add", name: c.name },
    { type: "timer", at: now + c.later },
  ];

  if (held !== null) {
    out.push(
      { type: "add", name: held },
      { type: "rename", name: held, to: c.name },
      { type: "remove", name: held },
      { type: "check", name: held },
      { type: "uncheck", name: held },
    );
  }

  return out;
};

type Step = {
  readonly msg: Msg;
  readonly refused: boolean;
  readonly view: View;
  readonly shown: { readonly rev: number; readonly view: unknown } | undefined;
};

/** Folds a walk on the program and the client side by side, handing each step to `each`. */
const walk = (list: ReadonlyArray<Choice>, each: (s: Step) => void) => {
  let model: Model = checklistMachine.init(null, {})[0];
  let now = 1_000_000;
  let rev = 0;
  let view: View = checklist.view.select(model);
  const [c0] = client.init(null, {});
  let shown: ClientModel = applyCell(client, c0, {
    type: "notice",
    pid: PID,
    note: { type: "whole", rev, view },
  })[0];
  expect(shown.views[PID]).toEqual({ rev, view });

  for (const c of list) {
    const options = moves(model, now, c);
    const msg = options[c.move % options.length]!;
    const refused = checklist.refuse(model, msg) !== null;

    if (!refused) {
      const before = view;
      model = applyCell(checklistMachine, model, msg)[0];
      now = msg.type === "timer" ? msg.at : now;
      view = checklist.view.select(model);
      rev += 1;
      const note = c.whole
        ? { type: "whole", rev, view }
        : { type: "patch", base: rev - 1, rev, patch: diff(before, view) };
      shown = applyCell(client, shown, { type: "notice", pid: PID, note })[0];
    }

    each({ msg, refused, view, shown: shown.views[PID] });
  }
};

const walks = fc.array(choice, { minLength: 1, maxLength: 40 });

describe("L23: the checklist through the real client", () => {
  it("after every step the client's shown view is the program's own view at that revision", () => {
    const seen = { refused: 0, patched: 0, removed: 0, late: 0 };
    fc.assert(
      fc.property(walks, (list) => {
        walk(list, (s) => {
          seen.refused += s.refused ? 1 : 0;
          seen.patched += s.refused ? 0 : 1;
          seen.removed += !s.refused && s.msg.type === "remove" ? 1 : 0;
          seen.late += s.view.items.some((i) => i.state === "late") ? 1 : 0;
          expect(s.shown?.view, `after ${JSON.stringify(s.msg)}`).toEqual(s.view);
        });
      }),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.refused, "some moves were refused").toBeGreaterThan(0);
    expect(seen.patched).toBeGreaterThan(0);
    expect(seen.removed, "the walks removed items").toBeGreaterThan(0);
    expect(seen.late, "the walks reached a late item").toBeGreaterThan(0);
  });

  it("checklistWindow.data is checklistView: it passes every view the program makes and refuses the counter's", () => {
    expect(checklistWindow.data).toBe(checklistView);
    const pass = Schema.decodeUnknownExit(checklistWindow.data);
    fc.assert(
      fc.property(walks, fc.integer(), (list, count) => {
        walk(list, (s) => {
          expect(pass(s.view)).toEqual(Exit.succeed(s.view));
        });
        // The counter's view, `{count}`, is another program's data.
        expect(Exit.isFailure(pass({ count })), "the counter's view passed").toBe(true);
      }),
      { seed: SEED, numRuns: 200 },
    );
  });
});
