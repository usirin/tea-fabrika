// P17b slice 2, next/. Plants for the new machine run after build, once each, then restore by copy.
// Drop saved PRNG state; burst on a late timer; lose a saved deadline/Asked; ignore stop in
// starting/checking; accept an old experiment's reply; turn a failed check into done.
import { applyCell } from "@demlik/tea";
import { arbGuidedSequence, arbMsgSequence, propertyInvariant } from "@demlik/tea/pbt";
import { expect, it } from "@effect/vitest";
import * as Fabrika from "@kampus/libfabrika";
import { syncTest } from "@kampus/libfabrika/testing";
import { Result, Schema } from "effect";
import * as fc from "fast-check";
import { expectTypeOf } from "vitest";
import { chaos } from "./program.ts";

const SEED = 119120;
const RUNS = 100;
const options = { seed: SEED, numRuns: RUNS };
type ChaosProgram = typeof chaos;
type Model = typeof Fabrika.ChaosMachine.Model.Type;
type Msg = typeof Fabrika.ChaosMachine.Msg.Type;
type Command = ReturnType<ChaosProgram["machine"]["init"]>[1][number];

const id = (n: number) =>
  Schema.decodeUnknownSync(Fabrika.Chaos.ExperimentId)(`chaos_0000000000e008${n.toString(16).padStart(12, "0")}`);

const process = Schema.decodeUnknownSync(Fabrika.Id.Process)("process_0000000000e008000000000000");

const target = Fabrika.Chaos.Target.make({
  program: "fabrika/checklist",
  name: "checklist:1",
  process,
  client: "client:1",
  key: "public:1",
});

// tea's guided cells take fast-check data, not Effect Arbitrary. Keep real UUIDv7 bits in the IDs.
const starts = fc.record({
  id: fc.nat({ max: 10000 }).map(id),
  seed: fc.integer({ min: 1, max: 0xffffffff }),
  target: fc.nat({ max: 10000 }).map((n) =>
    Fabrika.Chaos.Target.make({
      ...target,
      name: `checklist:${n}`,
      client: `client:${n}`,
      key: `public:${n}`,
      process: Schema.decodeUnknownSync(Fabrika.Id.Process)(
        `process_0000000000e008${n.toString(16).padStart(12, "0")}`,
      ),
    }),
  ),
  most: fc.integer({ min: 1, max: 12 }),
  gap: fc.integer({ min: 1, max: 10000 }),
});

const report = Fabrika.Chaos.Report.make({
  letters: 0,
  doubled: 0,
  gaps: 0,
  stream: "inbox/checklist:1",
  boundary: 0,
  processStream: "processes/checklist:1",
  processBoundary: 0,
  restarts: [],
});

const fired = Fabrika.Chaos.Fired.cases.fired.make({ hit: null });
const json = (value: unknown) => JSON.stringify(value);

const answer = (cmd: Command, at: number): Msg => {
  const { now, fire, inspect } = Fabrika.ChaosMachine;

  switch (cmd.type) {
    case "now":
      return now.ok(cmd, at, at);
    case "fire":
      return fire.ok(cmd, fired, at);
    case "inspect":
      return inspect.ok(cmd, report, at);
  }
};

const guided = (chaos: ChaosProgram) =>
  arbGuidedSequence(
    chaos.machine,
    {},
    {
      outside: {
        start: starts.map((start) => ({ type: "start" as const, ...start })),
        timer: fc.integer({ min: 0, max: 1_000_000 }).map((at) => ({ type: "timer" as const, at })),
        stop: fc.constant({ type: "stop" as const }),
      },
      answers: {
        now: {
          draw: fc.integer({ min: 0, max: 1_000_000 }),
          make: (cmd, at) => Fabrika.ChaosMachine.now.ok(cmd, at, at),
        },
        fire: { draw: fc.constant(fired), make: (cmd, value) => Fabrika.ChaosMachine.fire.ok(cmd, value, 1_000_000) },
        inspect: {
          draw: fc.constant(report),
          make: (cmd, value) => Fabrika.ChaosMachine.inspect.ok(cmd, value, 1_000_000),
        },
      },
    },
    { maxLength: 100, size: "max" },
  );

// Complete answers are conditional input to the termination promise, not a scheduler assumption.
const completed = (
  chaos: ChaosProgram,
  start: typeof Fabrika.Chaos.Start.Type,
  late: ReadonlyArray<number>,
  saved: Model | null = null,
  missing: number | null = null,
) => {
  let [model] = chaos.machine.init(saved, {});
  const msgs: Array<Msg> = [];
  const commands: Array<Command> = [];
  const ticks: Array<{ readonly at: number; readonly cmds: ReadonlyArray<Command>; readonly model: Model }> = [];
  const step = (msg: Msg) => {
    msgs.push(msg);
    const [next, out] = applyCell(chaos.machine, model, msg);
    model = next;
    commands.push(...out);
    return out;
  };
  let pending = [...step({ type: "start", ...start })];
  let clock = 100;

  for (let turn = 0; turn < start.most * 4 + 10; turn++) {
    if (pending.length > 0) {
      const [cmd, ...rest] = pending;
      pending = rest;

      if (cmd !== undefined) {
        if (cmd.type === "fire" && cmd.ordinal === missing) {
          continue;
        }

        pending.push(...step(answer(cmd, clock)));
      }

      continue;
    }

    const wake = chaos.wake(model);

    if (wake === null) {
      break;
    }

    clock = Math.max(clock, wake) + (late[turn % Math.max(1, late.length)] ?? 0);
    const out = step({ type: "timer", at: clock });
    ticks.push({ at: clock, cmds: out, model });
    pending.push(...out);
  }

  return { model, msgs, commands, ticks };
};

it("brands and public Model/Msg schemas stay exact through the program", () => {
  expectTypeOf<Model>().toEqualTypeOf<typeof chaos.state.schema.Type>();
  expectTypeOf<Extract<Msg, { type: "start" }>["id"]>().toEqualTypeOf<typeof Fabrika.Chaos.ExperimentId.Type>();
  expectTypeOf<typeof Fabrika.Incoming.Type.envelope.id>().toEqualTypeOf<typeof Fabrika.Id.Input.Type>();
  // Slice 1's ProcessId is still a checked string, pending the shared ID conversion.
  expectTypeOf<Extract<Msg, { type: "start" }>["target"]>().toEqualTypeOf<typeof Fabrika.Chaos.Target.Type>();
  fc.assert(
    fc.property(starts, (start) => {
      expect(Schema.is(Fabrika.ChaosMachine.Msg)({ type: "start", ...start })).toBe(true);
      expect(Schema.is(Fabrika.ChaosMachine.Msg)({ type: "start", ...start, id: process })).toBe(false);
    }),
    options,
  );
});

it("same seed/version/target draws the same bounded faults after every saved cut", () => {
  fc.assert(
    fc.property(starts, fc.array(fc.nat({ max: 10000 }), { minLength: 1, maxLength: 12 }), (start, late) => {
      const a = completed(chaos, start, late);
      const b = completed(chaos, { ...start, id: id(20000) }, late.toReversed());
      const faults = (cs: ReadonlyArray<Command>) => cs.flatMap((cmd) => (cmd.type === "fire" ? [cmd.fault] : []));
      expect(faults(a.commands)).toHaveLength(start.most);
      expect(faults(a.commands)).toEqual(faults(b.commands));
      syncTest(
        chaos.machine,
        {},
        {
          msgs: a.msgs,
          encode: Schema.encodeSync(chaos.state.schema),
          decode: Schema.decodeUnknownSync(chaos.state.schema),
          equals: (x, y) => json(x) === json(y),
          seed: SEED,
        },
      );
    }),
    options,
  );
});

it("cap, actual-turn gap, one fault per timer, pure wake and answered termination hold", () => {
  propertyInvariant(
    chaos.machine,
    {},
    guided(chaos),
    ({ prev, next, msg, cmds }) => {
      const before = json(next);
      expect(chaos.wake(structuredClone(next))).toBe(chaos.wake(next));
      expect(json(next), "wake leaves saved control state alone").toBe(before);
      expect(cmds.filter((cmd) => cmd.type === "fire").length).toBeLessThanOrEqual(msg.type === "timer" ? 1 : 0);

      if (msg.type === "timer") {
        const due = chaos.wake(prev);

        if (due === null || msg.at < due) {
          expect(cmds, "an early or canceled alarm has no work").toEqual([]);
          expect(next).toEqual(prev);
        }
      }

      if (msg.type === "start" && ["starting", "active", "checking"].includes(prev.phase._tag)) {
        expect(next).toEqual(prev);
        expect(cmds).toEqual([]);
      }

      return true;
    },
    options,
  );
  fc.assert(
    fc.property(starts, fc.array(fc.nat({ max: 50000 }), { minLength: 1, maxLength: 20 }), (start, late) => {
      const run = completed(chaos, start, late);
      const firings = run.ticks.filter((t) => t.cmds.some((cmd) => cmd.type === "fire"));
      expect(firings).toHaveLength(start.most);

      for (let n = 1; n < firings.length; n++) {
        expect((firings[n]?.at ?? 0) - (firings[n - 1]?.at ?? 0)).toBeGreaterThanOrEqual(start.gap);
      }

      expect(run.commands.filter((cmd) => cmd.type === "inspect")).toHaveLength(1);
      expect(run.model.phase._tag).toBe("done");
      expect(chaos.wake(run.model)).toBeNull();
    }),
    options,
  );
});

it("stop wins at every reached cut and late, duplicate or unrelated replies emit no new work", () => {
  fc.assert(
    fc.property(starts, fc.array(fc.nat({ max: 1000 }), { minLength: 1, maxLength: 10 }), (start, late) => {
      const run = completed(chaos, start, late);
      let [model] = chaos.machine.init(null, {});

      for (let cut = 0; cut <= run.msgs.length; cut++) {
        const [stopped, out] = applyCell(chaos.machine, model, { type: "stop" });
        expect(out).toEqual([]);
        expect(chaos.wake(stopped)).toBeNull();
        const replies = run.msgs.filter((m) => m.type.endsWith("_ok") || m.type.endsWith("_err"));
        const tail = arbMsgSequence(
          fc.constantFrom<Msg>({ type: "timer", at: 10_000_000 }, { type: "stop" }, ...replies),
          { minLength: 10, maxLength: 20 },
        );
        // Each cut is reached by folding the real machine; the tail names its actual old Cmds.
        fc.assert(
          fc.property(tail, (msgs) => {
            let current = stopped;

            for (const msg of msgs) {
              const [next, cmds] = applyCell(chaos.machine, current, msg);
              expect(cmds).toEqual([]);
              expect(chaos.wake(next)).toBeNull();

              if (
                current.phase._tag === "stopped" &&
                (msg.type === "fire_ok" || msg.type === "fire_err") &&
                msg.cmd.id === current.phase.start.id &&
                current.phase.asked.some((asked) => asked.ordinal === msg.cmd.ordinal) &&
                !current.phase.answers.some((did) => did.ordinal === msg.cmd.ordinal)
              ) {
                expect(next.phase).toMatchObject({
                  answers: expect.arrayContaining([expect.objectContaining({ ordinal: msg.cmd.ordinal, at: msg.at })]),
                });
              }

              current = next;
            }
          }),
          { seed: SEED, numRuns: 1 },
        );
        const next = run.msgs[cut];

        if (next !== undefined) {
          [model] = applyCell(chaos.machine, model, next);
        }
      }
    }),
    options,
  );
});

it("a missing fire answer at any ordinal, including the last, never yields a clean verdict", () => {
  fc.assert(
    fc.property(starts, fc.nat(), (start, pick) => {
      const missing = (pick % start.most) + 1;
      const run = completed(chaos, start, [0], null, missing);
      expect(run.commands.filter((cmd) => cmd.type === "fire")).toHaveLength(start.most);
      expect(run.commands.filter((cmd) => cmd.type === "inspect")).toHaveLength(1);
      expect(run.model.phase._tag).toBe("incomplete");
      expect(chaos.wake(run.model)).toBeNull();
      syncTest(
        chaos.machine,
        {},
        {
          msgs: run.msgs,
          encode: Schema.encodeSync(chaos.state.schema),
          decode: Schema.decodeUnknownSync(chaos.state.schema),
          equals: (x, y) => json(x) === json(y),
          seed: SEED,
        },
      );
    }),
    options,
  );
});

it("every reachable JSON cut preserves the complete model and later Cmds", () => {
  fc.assert(
    fc.property(guided(chaos), (msgs) => {
      syncTest(
        chaos.machine,
        {},
        {
          msgs,
          encode: Schema.encodeSync(chaos.state.schema),
          decode: Schema.decodeUnknownSync(chaos.state.schema),
          equals: (x, y) => json(x) === json(y),
          seed: SEED,
        },
      );
    }),
    options,
  );
});

it("a previous experiment or duplicate reply cannot consume a new request", () => {
  fc.assert(
    fc.property(starts, (start) => {
      const old = completed(chaos, start, [0]);
      const fresh = completed(chaos, { ...start, id: id(30000) }, [0], old.model);
      let current = old.model;

      for (const msg of fresh.msgs) {
        for (const cmd of old.commands) {
          const [next, out] = applyCell(chaos.machine, current, answer(cmd, 100000));
          expect(next).toEqual(current);
          expect(out).toEqual([]);
        }

        [current] = applyCell(chaos.machine, current, msg);

        if (msg.type.endsWith("_ok") || msg.type.endsWith("_err")) {
          const [again, extra] = applyCell(chaos.machine, current, msg);
          expect(again).toEqual(current);
          expect(extra).toEqual([]);
        }
      }

      expect(current).toEqual(fresh.model);
      expect(current.phase._tag).toBe("done");
    }),
    options,
  );
});

it("unsafe deadline arithmetic ends incomplete and produces no fire or unsafe wake", () => {
  fc.assert(
    fc.property(starts, fc.integer({ min: 1, max: 10000 }), (start, gap) => {
      const initial = chaos.machine.init(null, {})[0];
      const [starting, cmds] = applyCell(chaos.machine, initial, { type: "start", ...start, gap });
      const cmd = cmds[0];
      expect(cmd?.type).toBe("now");

      if (cmd === undefined) {
        throw new Error("start did not request time");
      }

      const [model, out] = applyCell(chaos.machine, starting, answer(cmd, Number.MAX_SAFE_INTEGER));
      const [after, effects] = applyCell(chaos.machine, model, { type: "timer", at: Number.MAX_SAFE_INTEGER });
      expect([...out, ...effects].some((c) => c.type === "fire")).toBe(false);
      expect(chaos.wake(after)).toBeNull();
      expect(after.phase._tag).toBe("incomplete");
    }),
    options,
  );
});

it("the public stepper refuses a second active start without saving it", () => {
  fc.assert(
    fc.property(starts, (start) => {
      const pure = Result.getOrThrow(Fabrika.stepper(chaos));
      const first = pure.step(pure.init(null).model, { type: "start", ...start });
      expect(first._tag).toBe("stepped");

      if (first._tag !== "stepped") {
        throw new Error("valid start was refused");
      }

      const before = json(first.model);
      const second = pure.step(first.model, { type: "start", ...start, id: id(40000) });
      expect(second._tag).toBe("refused");
      expect(json(first.model)).toBe(before);
    }),
    options,
  );
});
