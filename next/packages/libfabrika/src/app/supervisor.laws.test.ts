// P34, next/. Pure rules own policy validation and saved-machine equivalence.
// Proposed test contract: supervisor is a tea machine; context supplies policy/process/build/at.
// threw -> ending/exit; exited -> starting inside the restart budget, down only at the brake;
// due -> starting/start from down; started -> live.
// A pending action belongs in the saved model, even after its Cmd has been emitted.
import { existsSync } from "node:fs";
import { applyCell, type Machine } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import { A, B } from "../coordination/process.test-support.ts";
import { Supervision } from "../coordination/recovery.ts";
import { syncTest } from "../testing.ts";

const SEED = 119120;

const policy = {
  maxDeliveries: 3,
  intensity: 5,
  periodMs: 5000,
  backoff: { minMs: 100, maxMs: 800, resetAfterMs: 5000 },
};

type Policy = typeof policy;
type Msg = { readonly type: string; readonly [key: string]: unknown };

type Model = {
  readonly recovery: { readonly _tag: string; readonly until?: number };
  readonly pending: unknown;
  readonly [key: string]: unknown;
};

type Ctx = { policy: Policy; process: string; name: string; build: string; at: number };

type Supervisor = {
  readonly Policy: Schema.Codec<Policy>;
  readonly supervisor: Machine<Model, Msg, Msg, never, Ctx>;
};

const modulePath = "./supervisor.ts";

const subject = async (): Promise<Supervisor> => {
  expect(existsSync(new URL(modulePath, import.meta.url)), "P34 has no supervision machine yet").toBe(true);
  return await import(modulePath);
};

const ctx: Ctx = { policy, process: A, name: "counter:1", build: "build-a", at: 0 };

/** The saved wait: a down's own `until`, else the pending start action's. */
const savedWait = (model: Model): number | undefined => {
  if (model.recovery._tag === "down") {
    return model.recovery.until;
  }

  const pending = model.pending as { readonly type?: unknown; readonly until?: unknown } | null;
  return pending?.type === "start" && typeof pending.until === "number" ? pending.until : undefined;
};

const thrown = (seq: number, at: number, process = A): Msg => ({
  type: "threw",
  at,
  failure: { _tag: "fresh", process, letter: "poison", build: "build-a", seq, error: "TypeError" },
});

describe("P34 policy and saved supervision laws", () => {
  it("p80 plant, clamp invalid policy: rejected settings leave the caller's bytes alone", async () => {
    const s = await subject();

    for (const invalid of [
      { ...policy, maxDeliveries: 0 },
      { ...policy, maxDeliveries: 33 },
      { ...policy, maxDeliveries: 1.5 },
      { ...policy, intensity: 2 },
      { ...policy, periodMs: 0 },
      { ...policy, backoff: { ...policy.backoff, minMs: 801 } },
      { ...policy, backoff: { ...policy.backoff, minMs: 0 } },
      { ...policy, backoff: { ...policy.backoff, resetAfterMs: 0 } },
      { ...policy, periodMs: 100 },
    ]) {
      const bytes = JSON.stringify(invalid);
      expect(() => Schema.decodeUnknownSync(s.Policy)(invalid)).toThrow();
      expect(JSON.stringify(invalid)).toBe(bytes);
    }

    expect(Schema.decodeUnknownSync(s.Policy)(policy)).toEqual(policy);
  });

  it("p80 plant, unreachable brake: every generated accepted policy can exhaust its window", async () => {
    const s = await subject();
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 32 }), fc.integer({ min: 1, max: 12 }), (deliveries, extra) => {
        const intensity = deliveries + extra;
        const candidate = {
          ...policy,
          maxDeliveries: deliveries,
          intensity,
          periodMs: intensity * 800 + 1,
        };
        const accepted = Schema.decodeUnknownSync(s.Policy)(candidate);
        let [model] = s.supervisor.init(null, { ...ctx, policy: accepted });
        let at = 0;

        for (let n = 1; n <= intensity + 1; n++) {
          [model] = applyCell(s.supervisor, model, {
            ...thrown(n, at),
            failure: {
              _tag: "fresh",
              process: A,
              letter: `letter-${n}`,
              build: "build-a",
              seq: n,
              error: "TypeError",
            },
          });
          [model] = applyCell(s.supervisor, model, { type: "exited", at });
          const until = savedWait(model);
          expect(until).toBeTypeOf("number");

          if (n === intensity + 1) {
            expect(model.recovery._tag).toBe("down");
            expect(until).toBeGreaterThan(accepted.periodMs);
          } else {
            expect(model.recovery._tag).toBe("starting");
            at = until!;
            [model] = applyCell(s.supervisor, model, { type: "due", at });
            [model] = applyCell(s.supervisor, model, { type: "started", process: B, at });
          }
        }
      }),
      { seed: SEED, numRuns: 32 },
    );
  });

  it("p80 plant, down after one crash: a down event only on the crash that trips the brake, and every start waits its backoff", async () => {
    const s = await subject();
    const policies = fc
      .record({
        intensity: fc.integer({ min: 1, max: 8 }),
        minMs: fc.integer({ min: 1, max: 200 }),
        spread: fc.integer({ min: 0, max: 800 }),
        slack: fc.integer({ min: 1, max: 5000 }),
      })
      .map(({ intensity, minMs, spread, slack }) => {
        const maxMs = minMs + spread;
        let total = 0;

        for (let n = 0; n < intensity; n++) {
          total += Math.min(minMs * 2 ** n, maxMs);
        }

        return {
          maxDeliveries: 1,
          intensity,
          periodMs: total + slack,
          backoff: { minMs, maxMs, resetAfterMs: 1_000_000 },
        };
      });
    const crashes = fc.array(
      fc.record({ live: fc.integer({ min: 0, max: 3000 }), exit: fc.integer({ min: 0, max: 50 }) }),
      { minLength: 1, maxLength: 20 },
    );
    fc.assert(
      fc.property(policies, crashes, (candidate, plan) => {
        const accepted = Schema.decodeUnknownSync(s.Policy)(candidate);
        let [model] = s.supervisor.init(null, { ...ctx, policy: accepted });
        let process = A;
        let at = 0;
        const restarts: number[] = [];
        const step = (msg: Msg) => {
          const [next, cmds] = applyCell(s.supervisor, model, msg);
          model = next;
          return cmds;
        };

        for (const [index, crash] of plan.entries()) {
          const n = index + 1;
          at += crash.live;
          const threwCmds = step(thrown(n, at, process));
          expect(threwCmds.filter((cmd) => cmd.type === "down")).toEqual([]);
          const exitAt = at + crash.exit;
          const exitedCmds = step({ type: "exited", at: exitAt });
          const wait = Math.min(accepted.backoff.minMs * 2 ** Math.min(n - 1, 53), accepted.backoff.maxMs);
          const earliest = exitAt + wait;
          const inBudget = restarts.filter((t) => t >= earliest - accepted.periodMs).length + 1 <= accepted.intensity;
          const downs = exitedCmds.filter((cmd) => cmd.type === "down");
          let until: number;

          if (inBudget) {
            expect(downs, `crash ${n} is inside the restart budget`).toEqual([]);
            expect(model.recovery._tag).toBe("starting");
            expect(savedWait(model), "the saved wait is the backoff").toBe(earliest);
            until = earliest;
          } else {
            expect(downs, `crash ${n} trips the brake`).toHaveLength(1);
            expect(model.recovery._tag).toBe("down");
            until = savedWait(model)!;
            expect(until).toBeGreaterThanOrEqual(earliest);
          }

          const dueCmds = [
            ...step({ type: "due", at: until - 1 }),
            ...step({ type: "due", at: until }),
            ...step({ type: "due", at: until }),
          ];
          const starts = [...exitedCmds, ...dueCmds].filter((cmd) => cmd.type === "start");
          expect(starts, "one start, never sooner than the wait").toMatchObject([{ until }]);
          expect(dueCmds.filter((cmd) => cmd.type === "down")).toEqual([]);
          process = process === A ? B : A;
          expect(step({ type: "started", process, at: until })).toEqual([]);
          restarts.push(until);
          at = until;
        }
      }),
      {
        seed: SEED,
        numRuns: 100,
        // T271 decision check: one crash inside the budget wrote a down event.
        examples: [
          [
            {
              maxDeliveries: 1,
              intensity: 5,
              periodMs: 5000,
              backoff: { minMs: 100, maxMs: 800, resetAfterMs: 1_000_000 },
            },
            [{ live: 0, exit: 0 }],
          ],
        ],
      },
    );
  });

  it("p80 plant, reset streak while down: waits double to the cap across replacement IDs", async () => {
    const s = await subject();
    let [model] = s.supervisor.init(null, ctx);
    let at = 0;

    for (const [n, wait] of [100, 200, 400, 800, 800].entries()) {
      [model] = applyCell(s.supervisor, model, thrown(n + 1, at, n === 0 ? A : B));
      expect(model.recovery._tag).toBe("ending");
      [model] = applyCell(s.supervisor, model, { type: "exited", at });
      expect(model.recovery._tag).toBe("starting");
      expect(savedWait(model)).toBe(at + wait);
      at += wait;
      [model] = applyCell(s.supervisor, model, { type: "due", at });
      [model] = applyCell(s.supervisor, model, { type: "started", process: B, at });
    }
  });

  it("p80 plant, early restart or duplicate start: deadline gates one saved action", async () => {
    const s = await subject();
    let [model] = s.supervisor.init(null, ctx);
    [model] = applyCell(s.supervisor, model, thrown(1, 0));
    const [exited, exitedCmds] = applyCell(s.supervisor, model, { type: "exited", at: 0 });
    expect(exited.recovery._tag).toBe("starting");
    expect(savedWait(exited)).toBe(100);
    const [early, earlyCmds] = applyCell(s.supervisor, exited, { type: "due", at: 99 });
    expect(early).toEqual(exited);
    expect(earlyCmds).toEqual([]);
    const [due, cmds] = applyCell(s.supervisor, early, { type: "due", at: 100 });
    expect(due.recovery._tag).toBe("starting");
    expect(due.pending).toBeDefined();
    expect(due.pending).not.toBeNull();
    const [, duplicate] = applyCell(s.supervisor, due, { type: "due", at: 100 });
    const starts = [...exitedCmds, ...earlyCmds, ...cmds, ...duplicate].filter((cmd) => cmd.type === "start");
    expect(starts).toMatchObject([{ until: 100 }]);
  });

  it("S2 p88 plant, omit pending Cmds: every saved cut resumes the same recovery", async () => {
    const s = await subject();
    const msgs: Msg[] = [
      thrown(1, 0),
      { type: "exited", at: 0 },
      { type: "due", at: 99 },
      { type: "due", at: 100 },
      { type: "due", at: 100 },
      { type: "started", process: B, at: 100 },
      thrown(2, 101, B),
      { type: "exited", at: 101 },
      { type: "due", at: 301 },
    ];
    syncTest(s.supervisor, ctx, {
      msgs,
      seed: SEED,
      encode: (model) => model,
      decode: (raw) => {
        if (!Schema.is(Supervision)(raw)) {
          throw new Error("invalid saved supervision");
        }

        return raw;
      },
      equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    });
    let [model] = s.supervisor.init(null, ctx);
    let pending = 0;

    for (const msg of msgs) {
      [model] = applyCell(s.supervisor, model, msg);

      if (model.pending !== null && model.pending !== undefined) {
        pending++;
      }
    }

    expect(pending).toBeGreaterThan(0);
  });

  it("p80 plant, healthy reset never happens: a full healthy interval resets backoff only while live", async () => {
    const s = await subject();
    let [model] = s.supervisor.init(null, ctx);

    for (const msg of [
      thrown(1, 0),
      { type: "exited", at: 0 },
      { type: "due", at: 100 },
      { type: "started", process: B, at: 100 },
      { type: "healthy", at: 5100 },
    ]) {
      [model] = applyCell(s.supervisor, model, msg);
    }

    [model] = applyCell(s.supervisor, model, thrown(2, 5101, B));
    [model] = applyCell(s.supervisor, model, { type: "exited", at: 5101 });
    expect(model.recovery._tag).toBe("starting");
    expect(savedWait(model)).toBe(5201);
  });
});
