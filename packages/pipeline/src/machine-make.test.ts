import { applyCell, defineMachine, formOf, replay, type Settled, type Sub } from "@demlik/tea";
import { Cmd, Machine, run } from "@demlik/tea/effect";
import {
  arbConstantMsg,
  arbMsg,
  arbMsgSequence,
  arbRecordMsg,
  type MsgArbitraryTable,
  propertyInvariant,
  stubCtxThrowingProxy,
} from "@demlik/tea/pbt";
import { drive } from "@demlik/tea/testing/effect";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";

// `Machine.make` and `Cmd.make` from `@demlik/tea/effect`, the local patch of tea 0.23.0 that
// demlik issues 870 and 871 ask for upstream. A machine names its model and its Msgs as Effect
// schemas, and every cell is typed from them with no annotation. What comes back is tea's own
// Machine, so `replay`, the laws, a parent and the Effect engine take it as they take one from
// `defineMachine`. These tests stay after the bump to the release and prove it does the same.

const Ticket = Schema.Struct({ id: Schema.String, title: Schema.String });
type Ticket = typeof Ticket.Type;
const Id = Schema.Struct({ id: Schema.String });
const readTicket = Cmd.make("ticket_read", { input: Id, ok: Ticket, err: ["unknown"] });
type ReadTicket = ReturnType<typeof readTicket>;

const Model = Schema.Struct({ selected: Schema.NullOr(Schema.String), open: Schema.NullOr(Ticket) });
type Model = typeof Model.Type;

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("open"), id: Schema.String }),
  Schema.Struct({ type: Schema.Literal("close") }),
]);
type Msg = typeof Msg.Type;
/** Every Msg the picker takes: its own, and the two its Cmd settles with. */
type Every = Msg | Settled<typeof readTicket>;

/** Pick one ticket, read it, and show it. An answer for a ticket no longer picked is dropped. */
const picker = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [readTicket],
  init: (loaded) => [loaded ?? { selected: null, open: null }, []],
  update: {
    open: (_, m) => [{ selected: m.id, open: null }, [readTicket({ id: m.id })]],
    close: () => [{ selected: null, open: null }, []],
    ticket_read_ok: (s, m) => [s.selected === m.value.id ? { ...s, open: m.value } : s, []],
    ticket_read_err: (s, m) => [s.selected === m.cmd.id ? { selected: null, open: null } : s, []],
  },
});

/** The same machine through `defineMachine`, its two types named by hand. */
const twin = defineMachine({
  types: { model: {} as Model, msg: {} as Msg },
  cmds: [readTicket],
  init: picker.init,
  update: picker.update,
});

const empty: Model = { selected: null, open: null };
const ticket: Ticket = { id: "T-1", title: "Fix login" };

describe("the types come from the two schemas, with no annotation", () => {
  it("is the very Machine `defineMachine` gives for the same model and Msgs, and not `any`", () => {
    expectTypeOf(picker).not.toBeAny();
    expectTypeOf(picker).toEqualTypeOf<
      typeof twin & {
        readonly model: Schema.Schema<Model>;
        readonly msg: Schema.Schema<Msg>;
      }
    >();
    expectTypeOf(replay(picker, { msgs: [], ctx: undefined }).state).toEqualTypeOf<Model>();
    expectTypeOf(replay(picker, { msgs: [], ctx: undefined }).cmds).toEqualTypeOf<ReadTicket[]>();
    expect(typeof picker.init).toBe("function");
  });

  it("types `init`'s saved state and each cell's state and Msg", () => {
    const typed = Machine.make({
      model: Model,
      msg: Msg,
      cmds: [readTicket],
      init: (loaded) => {
        expectTypeOf(loaded).toEqualTypeOf<Model | null>();
        return [loaded ?? empty, []];
      },
      update: {
        open: (s, m) => {
          expectTypeOf(s).toEqualTypeOf<Model>();
          expectTypeOf(m).toEqualTypeOf<Extract<Msg, { type: "open" }>>();
          return [s, []];
        },
        close: (s) => [s, []],
        ticket_read_ok: (s, m) => {
          expectTypeOf(m.value).toEqualTypeOf<Ticket>();
          expectTypeOf(m.cmd).toEqualTypeOf<ReadTicket>();
          return [s, []];
        },
        ticket_read_err: (s, m) => {
          expectTypeOf(m.error._tag).toEqualTypeOf<"unknown" | "malformed_result">();
          return [s, []];
        },
      },
    });

    expect(replay(typed, { msgs: [{ type: "close" }], ctx: undefined }).state).toEqual(empty);
  });

  it("refuses a misspelled cell, a missing cell, a field the Msg lacks, an undeclared Cmd and a wrong State", () => {
    const dropTicket = Cmd.make("ticket_drop", { input: Id, ok: Schema.Null, err: [] });
    const { open, ticket_read_ok, ticket_read_err } = picker.update;

    const misspelled = () =>
      Machine.make({
        model: Model,
        msg: Msg,
        cmds: [readTicket],
        init: () => [empty, []],
        update: {
          open,
          // @ts-expect-error there is no `clos` Msg
          clos: (s) => [s, []],
          ticket_read_ok,
          ticket_read_err,
        },
      });
    const missing = () =>
      Machine.make({
        model: Model,
        msg: Msg,
        cmds: [readTicket],
        init: () => [empty, []],
        // @ts-expect-error `close` has no cell
        update: { open, ticket_read_ok, ticket_read_err },
      });
    const noSuchField = () =>
      Machine.make({
        model: Model,
        msg: Msg,
        cmds: [readTicket],
        init: () => [empty, []],
        update: {
          // @ts-expect-error an `open` Msg has `id`, not `idx`
          open: (s, m) => [{ ...s, selected: m.idx }, []],
          close: (s) => [s, []],
          ticket_read_ok,
          ticket_read_err,
        },
      });
    const undeclaredCmd = () =>
      Machine.make({
        model: Model,
        msg: Msg,
        cmds: [readTicket],
        init: () => [empty, []],
        update: {
          open,
          // @ts-expect-error `ticket_drop` is not in `cmds`
          close: (s) => [s, [dropTicket({ id: "T-1" })]],
          ticket_read_ok,
          ticket_read_err,
        },
      });
    const wrongStateFromCell = () =>
      Machine.make({
        model: Model,
        msg: Msg,
        cmds: [readTicket],
        init: () => [empty, []],
        update: {
          open,
          // @ts-expect-error `selected` is a string or null
          close: () => [{ selected: 1, open: null }, []],
          ticket_read_ok,
          ticket_read_err,
        },
      });
    const wrongStateFromInit = () =>
      Machine.make({
        model: Model,
        msg: Msg,
        cmds: [readTicket],
        // @ts-expect-error the model has an `open` too
        init: () => [{ selected: null }, []],
        update: picker.update,
      });

    expect(
      [misspelled, missing, noSuchField, undeclaredCmd, wrongStateFromCell, wrongStateFromInit].every(
        (f) => typeof f === "function",
      ),
    ).toBe(true);
  });

  it("needs `model`, `msg` and `cmds`, and keeps `types` for the Subs and the context only", () => {
    // Each body below would type with the slot left out, so the missing slot is the only error.
    const noModel = () =>
      // @ts-expect-error `model` is a schema the machine must name
      Machine.make({
        msg: Msg,
        cmds: [],
        init: (loaded) => [loaded, []],
        update: { open: (s) => [s, []], close: (s) => [s, []] },
      });
    const noMsg = () =>
      // @ts-expect-error so is `msg`
      Machine.make({ model: Model, cmds: [], init: (loaded) => [loaded ?? empty, []], update: {} });
    const noCmds = () =>
      // @ts-expect-error a machine with no Cmds says `cmds: []`
      Machine.make({
        model: Model,
        msg: Msg,
        init: (loaded) => [loaded ?? empty, []],
        update: { open: (s) => [s, []], close: (s) => [s, []] },
      });
    const modelInTypes = () =>
      Machine.make({
        model: Model,
        msg: Msg,
        cmds: [readTicket],
        // @ts-expect-error the model's type comes from its schema, never from `types`
        types: { model: {} as Model },
        init: () => [empty, []],
        update: picker.update,
      });

    expect([noModel, noMsg, noCmds, modelInTypes].every((f) => typeof f === "function")).toBe(true);
  });

  it("takes a schema with a brand or a transformation, and the cells see its type side", () => {
    const TicketId = Schema.String.pipe(Schema.brand("TicketId"));
    const Counted = Schema.Struct({ id: Schema.NullOr(TicketId), n: Schema.FiniteFromString });
    const counted = Machine.make({
      model: Counted,
      msg: Schema.Struct({ type: Schema.Literal("pick"), id: TicketId }),
      cmds: [],
      init: () => [{ id: null, n: 0 }, []],
      update: {
        pick: (s, m) => {
          expectTypeOf(m.id).toEqualTypeOf<typeof TicketId.Type>();
          expectTypeOf(s.n).toEqualTypeOf<number>();
          return [{ id: m.id, n: s.n + 1 }, []];
        },
      },
    });
    const id = TicketId.make("T-1");
    const { state } = replay(counted, { msgs: [{ type: "pick" as const, id }], ctx: undefined });

    expectTypeOf(state).toEqualTypeOf<typeof Counted.Type>();
    expect(state).toEqual({ id: "T-1", n: 1 });
  });

  it("types `subs` and the built-in timer from `types.sub`, and `init`'s context from `types.ctx`", () => {
    type Watch = Sub<"watch", { readonly path: string }>;
    const Path = Schema.Struct({ path: Schema.NullOr(Schema.String), since: Schema.Number });
    const Tick = Schema.Struct({ type: Schema.Literal("tick") });
    const watcher = Machine.make({
      model: Path,
      msg: Tick,
      cmds: [],
      types: { sub: {} as Watch, ctx: {} as { readonly now: number } },
      // The timer's `deps` takes its argument, unused: see the door below.
      init: (loaded, ctx) => [loaded ?? { path: "src", since: ctx.now }, []],
      update: { tick: (s) => [s, []] },
      subs: [
        { type: "watch", deps: (s) => (s.path === null ? null : { path: s.path }) },
        { type: "timer", deps: (_) => ({ ms: 10, msg: { type: "tick" } }) },
      ],
    });
    const bare = Machine.make({
      model: Path,
      msg: Tick,
      cmds: [],
      init: (loaded) => [loaded ?? { path: null, since: 0 }, []],
      update: { tick: (s) => [s, []] },
      subs: [{ type: "timer", deps: (_) => ({ ms: 10, msg: { type: "tick" } }) }],
    });
    const undeclared = () =>
      Machine.make({
        model: Path,
        msg: Tick,
        cmds: [],
        init: () => [{ path: null, since: 0 }, []],
        update: { tick: (s) => [s, []] },
        // @ts-expect-error a machine that names no Sub in `types` has only the timer
        subs: [{ type: "watch", deps: () => ({ path: "src" }) }],
      });

    expectTypeOf(watcher.__sub).toEqualTypeOf<readonly [Watch] | undefined>();
    expectTypeOf(bare.__sub).toEqualTypeOf<readonly [Sub<never>] | undefined>();
    expectTypeOf(watcher.init).parameter(1).toEqualTypeOf<{ readonly now: number }>();
    expect(replay(watcher, { msgs: [], ctx: { now: 7 } }).subs).toMatchObject([
      { type: "watch", deps: { path: "src" } },
      { type: "timer", deps: { ms: 10 } },
    ]);
    expect(typeof undeclared).toBe("function");
  });
});

describe("what comes back is tea's own Machine", () => {
  const pick = fc.constantFrom("T-1", "T-2");
  const table: MsgArbitraryTable<Every> = {
    open: arbRecordMsg("open", { id: pick }),
    close: arbConstantMsg("close"),
    ticket_read_ok: pick.map((id) => ({
      type: "ticket_read_ok" as const,
      cmd: readTicket({ id }),
      value: { id, title: `title of ${id}` },
      at: 0,
    })),
    ticket_read_err: pick.map((id) => ({
      type: "ticket_read_err" as const,
      cmd: readTicket({ id }),
      error: { _tag: "unknown" as const },
      at: 0,
    })),
  };
  const lists = arbMsgSequence(arbMsg(table), { maxLength: 30 });
  /** The shared seed (AGENTS.md), so a failure comes back the same. */
  const OPTS = { seed: 119120, numRuns: 200 };

  it("folds any list of Msgs to the same State and Cmds as its `defineMachine` twin", () => {
    fc.assert(
      fc.property(lists, (msgs) => {
        expect(replay(picker, { msgs, ctx: undefined })).toEqual(replay(twin, { msgs, ctx: undefined }));
      }),
      OPTS,
    );
  });

  it("holds its laws on tea's pbt: an open asks for its one ticket, and what is shown is what is picked", () => {
    propertyInvariant(
      picker,
      stubCtxThrowingProxy<unknown>(),
      lists,
      ({ msg, next, cmds }) =>
        (next.open === null || next.open.id === next.selected) &&
        (msg.type !== "open" || (cmds.length === 1 && cmds[0]?.id === msg.id)),
      OPTS,
    );
  });

  // tea 0.24.0's own `Machine.make` hands its spec to `defineMachine`, which returns the object it
  // was given, so `model`, `msg` and `types` stay on it as on any `defineMachine` machine. The
  // patch this test was first written against stripped them; tea promises a plain Machine, not
  // a set of keys.
  it("is stamped with its update form, out of sight", () => {
    const Door = Schema.Union([
      Schema.Struct({ type: Schema.Literal("shut") }),
      Schema.Struct({ type: Schema.Literal("ajar"), by: Schema.String }),
    ]);
    const door = Machine.make({
      model: Door,
      msg: Schema.Union([
        Schema.Struct({ type: Schema.Literal("push"), by: Schema.String }),
        Schema.Struct({ type: Schema.Literal("pull") }),
      ]),
      cmds: [],
      types: { ctx: undefined },
      // Each function here takes its argument, used or not. TypeScript types a function with
      // none before it reads the schemas, so its `"shut"` would widen to `string`.
      init: (loaded) => [loaded ?? { type: "shut" }, []],
      update: {
        shut: { push: (_, m) => [{ type: "ajar", by: m.by }, []] },
        ajar: { pull: (_) => [{ type: "shut" }, []] },
      },
    });

    expect(Object.getOwnPropertyDescriptor(picker, "__form")).toMatchObject({
      value: "reducer",
      enumerable: false,
    });
    expect(Object.getOwnPropertyDescriptor(door, "__form")).toMatchObject({
      value: "transitions",
      enumerable: false,
    });
    expect(formOf(door)).toBe("transitions");
    expect(Object.keys(picker)).not.toContain("__form");
    expect(Object.keys(door)).not.toContain("__form");
    expect(picker.cmds).toEqual([readTicket]);
    expect(replay(door, { msgs: [{ type: "push", by: "ann" }], ctx: undefined }).state).toEqual({
      type: "ajar",
      by: "ann",
    });
  });

  it("leaves the caller's spec as it was, and hands back a new object", () => {
    const types = { ctx: undefined };
    const spec = {
      model: Model,
      msg: Msg,
      cmds: [readTicket],
      types,
      init: picker.init,
      update: picker.update,
    };
    const before = { ...spec };

    const made = Machine.make(spec);

    expect(spec).toStrictEqual(before);
    expect(spec.model).toBe(Model);
    expect(spec.msg).toBe(Msg);
    expect(spec.types).toBe(types);
    expect(made).not.toBe(spec);
  });

  it("is held and stepped by a parent, whose own schema holds the child's", () => {
    const step = (s: Model, m: Every) => applyCell<Model, Every, ReadTicket>(picker, s, m);
    const Side = <const T extends "left" | "right">(side: T) => Schema.Struct({ type: Schema.Literal(side), msg: Msg });
    const pair = Machine.make({
      model: Schema.Struct({ left: Model, right: Model }),
      msg: Schema.Union([Side("left"), Side("right")]),
      cmds: [readTicket],
      init: () => [{ left: empty, right: empty }, []],
      update: {
        left: (s, m) => {
          const [left, cmds] = step(s.left, m.msg);
          return [{ ...s, left }, cmds];
        },
        right: (s, m) => {
          const [right, cmds] = step(s.right, m.msg);
          return [{ ...s, right }, cmds];
        },
        ticket_read_ok: (s, m) => [{ left: step(s.left, m)[0], right: step(s.right, m)[0] }, []],
        ticket_read_err: (s, m) => [{ left: step(s.left, m)[0], right: step(s.right, m)[0] }, []],
      },
    });
    const two: Ticket = { id: "T-2", title: "Fix logout" };

    const { state, cmds } = replay(pair, {
      msgs: [
        { type: "left", msg: { type: "open", id: "T-1" } },
        { type: "right", msg: { type: "open", id: "T-2" } },
        { type: "ticket_read_ok", cmd: readTicket({ id: "T-2" }), value: two, at: 0 },
      ],
      ctx: undefined,
    });

    expect(state).toEqual({
      left: { selected: "T-1", open: null },
      right: { selected: "T-2", open: two },
    });
    expect(cmds).toEqual([readTicket({ id: "T-1" }), readTicket({ id: "T-2" })]);
  });
});

describe("on the Effect engine, a `Cmd.make` Cmd's answer reaches `update`", () => {
  /** What the world answers: T-404 is gone, and T-500 comes back in the wrong shape. */
  const interpret = {
    ticket_read: (c: ReadTicket) =>
      c.id === "T-404"
        ? Effect.fail({ _tag: "unknown" as const })
        : Effect.succeed((c.id === "T-500" ? { id: c.id } : { ...ticket, id: c.id }) as Ticket),
  };
  const driven = (id: string) =>
    Effect.runPromise(drive(picker, empty, { type: "open", id }, interpret, { clock: () => 0 }));
  const settled = (trace: Awaited<ReturnType<typeof driven>>["trace"]) =>
    trace.flatMap((entry) => (entry.kind === "msg" && entry.msg.type.startsWith("ticket_read_") ? [entry.msg] : []));

  it("runs under `run`: the Cmd goes out, its answer settles, and the cell shows the ticket", async () => {
    const program = Effect.gen(function* () {
      const handle = yield* run(picker, {
        ctx: undefined,
        interpret,
        terminal: (s) => s.open !== null,
      });
      const runtime = yield* handle.ready;
      yield* runtime.dispatch({ type: "open", id: "T-1" });
      return yield* runtime.done();
    });

    expect(await Effect.runPromise(program.pipe(Effect.scoped))).toEqual({
      selected: "T-1",
      open: ticket,
    });
  });

  it("settles `ticket_read_ok` with the answer and the Cmd it answers", async () => {
    const { state, trace } = await driven("T-1");

    expect(state).toEqual({ selected: "T-1", open: ticket });
    expect(settled(trace)).toEqual([{ type: "ticket_read_ok", cmd: readTicket({ id: "T-1" }), value: ticket, at: 0 }]);
  });

  it("settles `ticket_read_err` with the declared tag, and with `malformed_result` when the answer misses the `ok` schema", async () => {
    const gone = await driven("T-404");
    const wrong = await driven("T-500");

    expect(gone.state).toEqual(empty);
    expect(settled(gone.trace)).toMatchObject([{ type: "ticket_read_err", error: { _tag: "unknown" } }]);
    expect(wrong.state).toEqual(empty);
    expect(settled(wrong.trace)).toMatchObject([
      { type: "ticket_read_err", error: { _tag: "malformed_result", issues: [{ path: "title" }] } },
    ]);
  });
});
