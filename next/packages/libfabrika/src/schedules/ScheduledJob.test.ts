import { applyCell, type CmdValue } from "@demlik/tea";
import { Cmd } from "@demlik/tea/effect";
import { arbGuidedSequence, propertyTrace, stubCtxThrowingProxy } from "@demlik/tea/pbt";
import { Result, Schema } from "effect";
import fc from "fast-check";
import { expect, it } from "vitest";
import * as ScheduledJob from "./ScheduledJob.ts";

const write = Cmd.make("write", {
  input: Schema.Struct({ due: Schema.Number, period: Schema.Int }),
  ok: Schema.Json,
  err: ["not_delivered", "ended", "spent"],
});

const make = (period: number) =>
  ScheduledJob.make({ period, cmd: write, work: (due, ms) => write({ due, period: ms }) });

const ctx = stubCtxThrowingProxy<unknown>();
const period = fc.integer({ min: 1, max: 1_000_000_000 });

// Fast-check supplies boundary times and invalid durations; there is no domain schema for them.
// The plan gives no run count. Keep the shared seed and use 150 walks of up to 100 moves.
const walks = period.chain((ms) => {
  const { machine } = Result.getOrThrow(make(ms));
  return arbGuidedSequence(
    machine,
    ctx,
    {
      outside: {
        timer: fc.record({ type: fc.constant("timer" as const), at: fc.oneof(fc.constant(0), fc.nat()) }),
        // A stale answer is an outside input, not the answer to a waiting Cmd.
        write_ok: fc
          .nat()
          .map((at) => ({ type: "write_ok" as const, cmd: write({ due: 0, period: ms }), value: null, at })),
        write_err: fc.nat().map((at) => ({
          type: "write_err" as const,
          cmd: write({ due: 0, period: ms }),
          error: { _tag: "spent" as const },
          at,
        })),
      },
      answers: {
        write: {
          draw: fc.record({ ok: fc.boolean(), at: fc.nat() }),
          make: (cmd, answer) =>
            answer.ok
              ? { type: "write_ok" as const, cmd, value: null, at: answer.at }
              : { type: "write_err" as const, cmd, error: { _tag: "spent" as const }, at: answer.at },
        },
      },
    },
    { maxLength: 100 },
  ).map((messages) => ({ ms, messages }));
});

const options = { seed: 119120, numRuns: 150 };

it("L1: only a due idle scheduled job emits work; answers while idle do nothing", () => {
  fc.assert(
    fc.property(walks, ({ ms, messages }) => {
      const { machine } = Result.getOrThrow(make(ms));
      propertyTrace(
        machine,
        ctx,
        fc.constant(messages),
        (steps, _final, initial) => {
          expect(initial).toEqual([]);
          let outstanding = 0;

          for (const { prev, msg, next, cmds } of steps) {
            if (msg.type !== "timer") {
              outstanding = 0;
            }

            outstanding += cmds.length;
            expect(outstanding).toBeLessThanOrEqual(1);

            if (msg.type === "timer" && prev._tag === "idle" && msg.at >= prev.next) {
              expect(cmds).toEqual([write({ due: msg.at, period: prev.period })]);
              expect(next).toEqual({ _tag: "running", due: msg.at, period: prev.period });
            } else {
              expect(cmds).toEqual([]);
            }

            if (prev._tag === "idle") {
              const [due, jobs] = applyCell<ScheduledJob.Model, { type: "timer"; at: number }, CmdValue<typeof write>>(
                machine,
                prev,
                { type: "timer", at: prev.next },
              );
              expect(due).toEqual({ _tag: "running", due: prev.next, period: prev.period });
              expect(jobs).toEqual([write({ due: prev.next, period: prev.period })]);
            }

            if (msg.type !== "timer" && prev._tag === "idle") {
              expect(next).toEqual(prev);
            }
          }

          return true;
        },
        { seed: 119120, numRuns: 1 },
      );
    }),
    options,
  );
});

it("L2: wake is next while idle, null while running, and answers re-arm from their own time", () => {
  fc.assert(
    fc.property(walks, ({ ms, messages }) => {
      const { machine } = Result.getOrThrow(make(ms));
      const [initial] = machine.init(undefined, ctx);
      expect(initial).toEqual({ _tag: "idle", next: 0, period: ms });
      expect(ScheduledJob.wake(initial)).toBe(0);
      propertyTrace(
        machine,
        ctx,
        fc.constant(messages),
        (steps) => {
          for (const { prev, msg, next } of steps) {
            expect(ScheduledJob.wake(next)).toBe(next._tag === "idle" ? next.next : null);
            expect(next.period).toBe(ms);

            if (prev._tag === "running" && msg.type !== "timer") {
              expect(next).toEqual({ _tag: "idle", next: msg.at + prev.period, period: prev.period });
            }
          }

          return true;
        },
        { seed: 119120, numRuns: 1 },
      );
    }),
    options,
  );
});

it("L3: early and repeated timers leave the model and commands unchanged", () => {
  fc.assert(
    fc.property(walks, ({ ms, messages }) => {
      const { machine } = Result.getOrThrow(make(ms));
      propertyTrace(
        machine,
        ctx,
        fc.constant(messages),
        (steps) => {
          for (const { prev, msg, next, cmds } of steps) {
            // Choose the refusal from the state reached by this generated walk.
            const at = prev._tag === "idle" ? prev.next - 1 : prev.due;
            const [unchanged, sent] = applyCell<
              ScheduledJob.Model,
              { type: "timer"; at: number },
              CmdValue<typeof write>
            >(machine, prev, { type: "timer", at });
            expect(unchanged).toEqual(prev);
            expect(sent).toEqual([]);
            const ignored = msg.type === "timer" && (prev._tag === "running" || msg.at < prev.next);
            expect(ignored ? next : prev).toEqual(prev);
            expect(ignored ? cmds : []).toEqual([]);
          }

          return true;
        },
        { seed: 119120, numRuns: 1 },
      );
    }),
    options,
  );
});

const invalid = fc.oneof(
  fc.constant(0),
  fc.integer({ max: 0 }),
  fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Number.isInteger(n)),
);

it("L4: only positive whole millisecond periods succeed", () => {
  fc.assert(
    fc.property(invalid, period, (bad, good) => {
      const rejected = make(bad);
      expect(Result.isFailure(rejected)).toBe(true);

      if (Result.isFailure(rejected)) {
        expect(rejected.failure).toMatchObject({ _tag: "ScheduledJobError", reason: "bad_period" });
      }

      expect(Result.isSuccess(make(good))).toBe(true);
    }),
    options,
  );
});
