// Ticket 806, slice 1, next/: the checklist's laws on its real machine and declarations (0125).
// Every list is a walk: it folds the real reducer from its real `init` and picks each next move
// from the items that exist at that point, so a `check` names an item that is there, an `uncheck` a
// checked one, a `rename` a free name. L9 and L10 run at the runner, in `RunnerTest.ts`.
import { applyCell } from "@demlik/tea";
import { propertyInvariant } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { Program, Input, stepper } from "@kampus/libfabrika";
import { syncTest } from "@kampus/libfabrika/testing";
import { Result, Schema } from "effect";
import * as fc from "fast-check";
import { expectTypeOf } from "vitest";

const SEED = 119120;
const RUNS = 100;
// Loaded per law, so a missing export reds its law and not the file's collection.
const load = () => import("./program.ts");
type ChecklistMachine = Awaited<ReturnType<typeof load>>["checklistMachine"];

type State =
  | { readonly _tag: "new" }
  | { readonly _tag: "open"; readonly since: number }
  | { readonly _tag: "late"; readonly since: number }
  | { readonly _tag: "checked"; readonly note: string | null };

type Item = { readonly name: string; readonly state: State };
type Model = { readonly items: ReadonlyArray<Item> };

type Msg =
  | { readonly type: "add"; readonly name: string }
  | { readonly type: "rename"; readonly name: string; readonly to: string }
  | { readonly type: "remove"; readonly name: string }
  | { readonly type: "check"; readonly name: string }
  | { readonly type: "uncheck"; readonly name: string }
  | { readonly type: "timer"; readonly at: number };

type Fresh = Exclude<Msg, { readonly type: "timer" }>;

/** The plan's one day, written out here so the law does not read it from the code it checks. */
const DAY = 86_400_000;

/** Four names per run, the 1 and 80 character edges among them. */
const Pool = fc.uniqueArray(
  fc.oneof(fc.string({ minLength: 1, maxLength: 80 }), fc.constant("x"), fc.constant("n".repeat(80))),
  { minLength: 4, maxLength: 4 },
);

/** How far a timer moves the referee's clock: none, a little, or about a day. */
const Gap = fc.oneof(
  { arbitrary: fc.constant(0), weight: 1 },
  { arbitrary: fc.integer({ min: 1, max: 1000 }), weight: 4 },
  { arbitrary: fc.integer({ min: DAY - 2, max: DAY + 2 }), weight: 2 },
  { arbitrary: fc.integer({ min: 0, max: 3 * DAY }), weight: 1 },
);

const Move = fc.record({ kind: fc.nat({ max: 9 }), pick: fc.nat(), other: fc.nat(), gap: Gap });
type Move = typeof Move extends fc.Arbitrary<infer A> ? A : never;

const at = <A>(items: ReadonlyArray<A>, i: number): A | undefined => items[i % Math.max(items.length, 1)];

/** The next move, read off the model reached: a move that has nothing to act on is a timer. */
const choose = (m: Model, names: ReadonlyArray<string>, move: Move, clock: number): Msg => {
  const here = m.items.map((i) => i.name);
  const free = names.filter((n) => !here.includes(n));
  const unchecked = m.items.filter((i) => i.state._tag !== "checked").map((i) => i.name);
  const checked = m.items.filter((i) => i.state._tag === "checked").map((i) => i.name);
  const timer: Msg = { type: "timer", at: clock + move.gap };
  const name = at(here, move.pick);
  const fresh = at(free, move.other);

  switch (move.kind) {
    case 0:
    case 1:
    case 2:
      return fresh === undefined ? timer : { type: "add", name: fresh };
    case 3:
      return name === undefined || fresh === undefined ? timer : { type: "rename", name, to: fresh };
    case 4:
      return name === undefined ? timer : { type: "remove", name };
    case 5: {
      const one = at(unchecked, move.pick);
      return one === undefined ? timer : { type: "check", name: one };
    }
    case 6: {
      const one = at(checked, move.pick);
      return one === undefined ? timer : { type: "uncheck", name: one };
    }
    default:
      return timer;
  }
};

/** A walk: the Msg list and every model it reaches, folded through the real machine. */
const walked = (machine: ChecklistMachine, minLength = 0) =>
  fc
    .record({
      names: Pool,
      start: fc.integer({ min: 0, max: 2_000_000_000_000 }),
      moves: fc.array(Move, { minLength, maxLength: 40 }),
    })
    .map(({ names, start, moves }) => {
      const [first] = machine.init(null, {});
      let model: Model = first;
      let clock = start;
      const msgs: Array<Msg> = [];

      for (const move of moves) {
        const msg = choose(model, names, move, clock);
        clock = msg.type === "timer" ? msg.at : clock;
        msgs.push(msg);
        [model] = applyCell(machine, model, msg);
      }

      return { names, msgs, model, clock };
    });

/** The plan's table for slice 1 (A1), as an independent record: the expected next items. */
const expected = (prev: Model, msg: Msg): ReadonlyArray<Item> => {
  switch (msg.type) {
    case "add":
      return [...prev.items, { name: msg.name, state: { _tag: "new" } }];
    case "rename":
      return prev.items.map((i) => (i.name === msg.name ? { ...i, name: msg.to } : i));
    case "remove":
      return prev.items.filter((i) => i.name !== msg.name);
    case "check":
      return prev.items.map((i) =>
        i.name === msg.name && i.state._tag !== "checked"
          ? { name: i.name, state: { _tag: "checked", note: null } }
          : i,
      );
    case "uncheck":
      return prev.items.map((i) =>
        i.name === msg.name && i.state._tag === "checked" ? { name: i.name, state: { _tag: "new" } } : i,
      );
    case "timer":
      return prev.items.map((i) =>
        i.state._tag === "new"
          ? { name: i.name, state: { _tag: "open", since: msg.at } }
          : i.state._tag === "open" && msg.at >= i.state.since + DAY
            ? { name: i.name, state: { _tag: "late", since: i.state.since } }
            : i,
      );
  }
};

/** Items keyed by name, so a law reads what each item is, not where the list keeps it. */
const byName = (items: ReadonlyArray<Item>) =>
  JSON.stringify([...items].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));

/** What the plan's `refuse` sketch says of one fresh input (A1: no `verify`). */
const reason = (m: Model, msg: Fresh): string | null => {
  const has = (name: string) => m.items.some((i) => i.name === name);

  if (msg.type === "add") {
    return has(msg.name) ? "taken" : null;
  }

  if (msg.type === "rename") {
    return !has(msg.name) ? "missing" : has(msg.to) ? "taken" : null;
  }

  return has(msg.name) ? null : "missing";
};

/** A reached model and one fresh input over the same pool. The item it names is mostly one the model
 *  holds, the new name (`add`, `rename`'s `to`) any of the pool, so both sides of each refusal are drawn. */
const reached = (machine: ChecklistMachine) =>
  walked(machine, 4).chain(({ names, model }) => {
    const any = fc.constantFrom(...names);
    const here = model.items.map((i) => i.name);
    const name =
      here.length === 0
        ? any
        : fc.oneof({ arbitrary: fc.constantFrom(...here), weight: 3 }, { arbitrary: any, weight: 1 });
    return fc
      .record({ type: fc.constantFrom("add", "rename", "remove", "check", "uncheck"), name, to: any })
      .map(({ type, name, to }): { model: Model; msg: Fresh } => ({
        model,
        msg: type === "rename" ? { type, name, to } : type === "add" ? { type, name: to } : { type, name },
      }));
  });

const left = (m: Model) => m.items.filter((i) => i.state._tag !== "checked").length;

describe("ticket 806 the checklist's laws", () => {
  it("L1: every move follows the slice 1 table at every tea step, and no step returns a Cmd", async () => {
    const { checklistMachine } = await load();
    propertyInvariant(
      checklistMachine,
      {},
      walked(checklistMachine).map((w) => w.msgs),
      ({ prev, msg, next, cmds }) =>
        cmds.length !== 0
          ? `${msg.type} returned ${cmds.length} Cmds`
          : byName(next.items) === byName(expected(prev, msg)) || `${msg.type} broke the table`,
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("L2: every JSON cut keeps every later model and Cmd", async () => {
    const { checklist } = await load();
    fc.assert(
      fc.property(walked(checklist.machine), ({ msgs }) => {
        syncTest(
          checklist.machine,
          {},
          {
            msgs,
            encode: Schema.encodeSync(checklist.state.schema),
            decode: Schema.decodeUnknownSync(checklist.state.schema),
            equals: (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b),
            seed: SEED,
          },
        );
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("L3: refuse says taken exactly when the new name exists, missing exactly when the named item does not", async () => {
    const { checklist } = await load();
    fc.assert(
      fc.property(reached(checklist.machine), ({ model, msg }) => {
        expect(checklist.refuse(model, msg)?.reason ?? null).toBe(reason(model, msg));
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("L4: a refused Msg leaves the model, view and Cmds as they were, through the stepper", async () => {
    const { checklist } = await load();
    const loaded = stepper(checklist);
    expect(Result.isSuccess(loaded)).toBe(true);
    const p = Result.getOrThrow(loaded);
    const encode = Schema.encodeSync(checklist.state.schema);
    fc.assert(
      fc.property(reached(checklist.machine), ({ model, msg }) => {
        const saved = encode(model);
        const before = JSON.stringify(saved);
        const step = p.step(saved, msg);
        const no = reason(model, msg);
        const [next] = applyCell(checklist.machine, model, msg);
        expect(step).toEqual(
          no === null
            ? {
                _tag: "stepped",
                model: encode(next),
                view: checklist.view.select(next),
                cmds: [],
                wake: checklist.wake(next),
              }
            : { _tag: "refused", reason: no },
        );
        expect(JSON.stringify(saved), "a step never edits the model it was given").toBe(before);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("L5: wake is 0 while any item is new, else the oldest open since + LATE, else null", async () => {
    const { checklistMachine, checklist, LATE } = await load();
    expect(LATE).toBe(DAY);
    propertyInvariant(
      checklistMachine,
      {},
      walked(checklistMachine).map((w) => w.msgs),
      ({ next }) => {
        const since = next.items.flatMap((i) => (i.state._tag === "open" ? [i.state.since] : []));
        const want = next.items.some((i) => i.state._tag === "new")
          ? 0
          : since.length === 0
            ? null
            : Math.min(...since) + DAY;
        return checklist.wake(next) === want || `wake ${checklist.wake(next)}, want ${want}`;
      },
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("L6: a timer makes an open item late exactly when at >= since + LATE, and stamps every new item", async () => {
    const { checklistMachine } = await load();
    const Timed = walked(checklistMachine, 4).chain((w) =>
      fc
        .record({ pick: fc.nat(), offset: fc.oneof(fc.integer({ min: -3, max: 3 }), fc.integer()) })
        .map(({ pick, offset }) => {
          const open = w.model.items.flatMap((i) => (i.state._tag === "open" ? [i.state.since] : []));
          const since = at(open, pick) ?? w.clock;
          return { model: w.model, at: since + DAY + offset };
        }),
    );
    fc.assert(
      fc.property(Timed, ({ model, at: time }) => {
        const [next] = applyCell(checklistMachine, model, { type: "timer", at: time });

        for (const [n, item] of model.items.entries()) {
          const now = next.items.find((i) => i.name === item.name)?.state;
          const s = item.state;
          expect(now, `item ${n} after a timer at ${time}`).toEqual(
            s._tag === "new"
              ? { _tag: "open", since: time }
              : s._tag === "open" && time >= s.since + DAY
                ? { _tag: "late", since: s.since }
                : s,
          );
        }

        expect(next.items).toHaveLength(model.items.length);
      }),
      // Biased toward the edge: `offset` 0 is drawn on most runs.
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("L7: query left answers the count of items not checked, equal to view.left", async () => {
    const { checklistMachine, checklist } = await load();
    const port = checklist.inputs.left;
    // The query takes no input: its schema is `Null`, and its answer reads the view alone.
    expect(Schema.decodeUnknownSync(port.schema)(null)).toBeNull();
    propertyInvariant(
      checklistMachine,
      {},
      walked(checklistMachine).map((w) => w.msgs),
      ({ next }) => {
        const view = checklist.view.select(next);
        return (
          (view.left === left(next) && port.answer(view) === left(next)) ||
          `left ${view.left}, answer ${String(port.answer(view))}, want ${left(next)}`
        );
      },
      { seed: SEED, numRuns: RUNS },
    );
    expect(port._tag).toBe("read");
  });

  it("L8: finished is a Done exactly when there is an item and all are checked, and it decodes by Done", async () => {
    const { checklistMachine, finished, Done } = await load();
    const roundTrip = (d: unknown) => Schema.decodeUnknownSync(Done)(Schema.encodeUnknownSync(Done)(d));
    propertyInvariant(
      checklistMachine,
      {},
      walked(checklistMachine).map((w) => w.msgs),
      ({ next }) => {
        const done = next.items.length > 0 && next.items.every((i) => i.state._tag === "checked");
        const out = finished(next);

        if (!done) {
          return out === null || "finished before every item was checked";
        }

        return (
          (out !== null &&
            JSON.stringify(roundTrip(out)) === JSON.stringify(out) &&
            JSON.stringify([...out.items].sort()) === JSON.stringify(next.items.map((i) => i.name).sort())) ||
          `not finished, or not a Done of every item: ${JSON.stringify(out)}`
        );
      },
      { seed: SEED, numRuns: RUNS },
    );
  });

  it("L11 type: an input key that is no Msg type, or a query on a field the view lacks, does not compile", async () => {
    // A type law (plan, L11): the checks are the `@ts-expect-error` lines, read by the typecheck.
    const { checklist, checklistMachine } = await load();
    const spec = {
      name: checklist.name,
      machine: checklistMachine,
      state: { v: checklist.state.v, upgrades: checklist.state.upgrades },
      view: checklist.view.select,
      refuse: checklist.refuse,
      outputs: {},
      writes: {},
      wake: checklist.wake,
    };
    // @ts-expect-error `tick` is no Msg type of the checklist.
    Program.make({ ...spec, inputs: { tick: "Tick" } });
    // @ts-expect-error The checklist's view has no `done` field to read.
    Program.make({
      ...spec,
      inputs: {
        done: Input.cases.read.make({
          schema: Schema.Null,
          description: "Done",
          answer: (v: { done: number }) => v.done,
        }),
      },
    });
    expectTypeOf(checklist.view.select).returns.toHaveProperty("left").toEqualTypeOf<number>();
    expectTypeOf(checklist.inputs).toHaveProperty("left");
    expectTypeOf(checklist.inputs).not.toHaveProperty("timer");
    expect(Object.keys(checklist.inputs).sort()).toEqual(["add", "check", "left", "remove", "rename", "uncheck"]);
  });
});
