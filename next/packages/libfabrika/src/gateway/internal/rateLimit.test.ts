// T843, next/. The independent account keeps admitted times, rather than the machine's used field.
import { applyCell } from "@demlik/tea";
import { propertyTrace } from "@demlik/tea/pbt";
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import * as RateLimit from "../RateLimit.ts";
import * as Rate from "./rateLimit.ts";

type Model = typeof Rate.machine.model.Type;
type Msg = typeof Rate.machine.msg.Type;

const Policy = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 })),
  window: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 1000 })),
});

const Tape = Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))).check(
  Schema.isMinLength(20),
  Schema.isMaxLength(80),
);

const trace = (initial: typeof Policy.Type, picks: typeof Tape.Type) => {
  let state = Rate.machine.init(null, {})[0];
  const messages: Array<Msg> = [];

  for (const pick of picks) {
    const live = state._tag !== "fresh";
    const p = live ? state.policy : initial;
    // Read the state before choosing a repeat, a backward clock, expiry, skipped windows or a policy change.
    const times = live ? [state.at, state.at - 1, state.until - 1, state.until, state.until + p.window * 3] : [18];
    const msg: Msg = {
      type: "take",
      at: times[pick % times.length]!,
      policy: pick % 7 === 0 ? (pick % 2 ? { ...p, window: p.window + 1 } : { ...p, limit: p.limit + 1 }) : p,
    };
    messages.push(msg);
    state = applyCell(Rate.machine, state, msg)[0];
  }

  return messages;
};

it.prop(
  "T843 machine: aligned budgets, fixed reset, policy changes and backward clocks match admitted-time history (50 runs)",
  { initial: Policy, picks: Tape },
  ({ initial, picks }) => {
    propertyTrace(
      Rate.machine,
      {},
      fc.constant(trace(initial, picks)),
      (steps) => {
        let admitted: Array<number> = [];
        let active: { limit: number; window: number } | undefined;
        let end = -Infinity;
        let trusted = -Infinity;

        for (const { msg, cmds, next } of steps) {
          if (msg.type !== "take") {
            return "the generated trace supplied an answer without a pending command";
          }

          const changed = active?.limit !== msg.policy.limit || active?.window !== msg.policy.window;
          const at = msg.at < end ? Math.max(msg.at, trusted) : msg.at;

          if (changed || at >= end) {
            active = msg.policy;
            end = (Math.floor(at / active.window) + 1) * active.window;
            admitted = [];
          }

          const allowed = admitted.length < msg.policy.limit;

          if (allowed) {
            admitted.push(at);
          }

          trusted = at;
          expect(cmds).toHaveLength(1);
          expect(cmds[0]!.decision).toEqual(
            allowed
              ? { _tag: "allowed", count: admitted.length, ttl: end - at }
              : { _tag: "refused", retryAfter: end - at },
          );
          expect(next._tag).not.toBe("fresh");

          if (next._tag === "fresh") {
            return "a take left the machine fresh";
          }

          expect(next.until).toBe(end);
          expect(next._tag).toBe(admitted.length === msg.policy.limit ? "full" : "open");

          if (next._tag === "open") {
            expect(next.used).toBe(admitted.length);
          }
        }

        return true;
      },
      { seed: 119120, numRuns: 1 },
    );
  },
  { arbitrary: { seed: 119120, runs: 50 } },
);

it.prop(
  "T843 arithmetic: an unrepresentable window end never becomes an allowed command (50 runs)",
  { window: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 1000 })) },
  ({ window }) => {
    const state = Rate.machine.init(null, {})[0];
    expect(() =>
      applyCell(Rate.machine, state, { type: "take", at: Number.MAX_SAFE_INTEGER, policy: { limit: 1, window } }),
    ).toThrow();
  },
  { arbitrary: { seed: 119120, runs: 50 } },
);

it("vector: expiry is half-open, just before, at and after the end", () => {
  // The plan pins the exact boundary as well as generating time walks above.
  let state = Rate.machine.init(null, {})[0];
  const take = (at: number) => {
    const result = applyCell(Rate.machine, state, { type: "take", at, policy: { limit: 1, window: 60 } });
    state = result[0];
    return result[1][0]!.decision;
  };
  expect(take(18)).toEqual({ _tag: "allowed", count: 1, ttl: 42 });
  expect(take(59)).toEqual({ _tag: "refused", retryAfter: 1 });
  expect(take(60)).toEqual({ _tag: "allowed", count: 1, ttl: 60 });
  expect(take(61)).toEqual({ _tag: "refused", retryAfter: 59 });
});

it("T843 policy: positive safe integers only (50 runs)", () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.integer({ max: 0 }),
        fc.double({ min: 0.01, max: 1e6, noNaN: true }).filter((n) => !Number.isInteger(n)),
        fc.constantFrom(Number.NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1),
      ),
      (bad) => {
        expect(Schema.is(RateLimit.Policy)({ limit: bad, window: 60 })).toBe(false);
        expect(Schema.is(RateLimit.Policy)({ limit: 1, window: bad })).toBe(false);
      },
    ),
    { seed: 119120, numRuns: 50 },
  );
});

// Compile-only: full cannot carry a growing used count; the reducer's schema defines the states.
const fullType = (model: Extract<Model, { _tag: "full" }>) => {
  // @ts-expect-error full represents exactly the policy limit and has no growing attempt counter.
  return model.used;
};

void fullType;
