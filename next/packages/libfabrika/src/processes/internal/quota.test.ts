// P34c, next/. Test-first factory contract: make({ account, channel, limits }).
// propose carries a trusted bundle's exact deltas. advance never clears a saved fault.
// No caller constructs or edits the Model. Every candidate comes from init/applyCell.
import { applyCell } from "@demlik/tea";
import { propertyTrace } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import * as fc from "fast-check";
import * as Quota from "./quota.ts";

const limits = { writes: 5, bytes: 31, letter: { writes: 3, bytes: 23 } };
const cell = fc.record({ move: fc.nat(), pick: fc.nat(), amount: fc.nat() });
const tape = fc.array(cell, { minLength: 12, maxLength: 60, size: "max" });
const options = { seed: 119120, numRuns: 100 };

describe("P34c quota machine", () => {
  it("Q1 and Q5 committed bundles alone spend room; failed proposals leave use unchanged", () => {
    fc.assert(
      fc.property(tape, (cells) => {
        const machine = Quota.make({ account: "sample/alpha", channel: "program", limits });
        let model = machine.init(null, {})[0];
        let at = 1;
        let bytes = 0;
        const history: Array<{ at: number; writes: number }> = [];
        const msgs: Array<Quota.Msg> = [];

        for (const [index, c] of cells.entries()) {
          // Every choice is rebuilt from this prefix, including after shrinking.
          const previous = history.at(-1)?.at ?? at;
          const moves = bytes > 0 ? ["grow", "replace", "release", "clock"] : ["grow", "clock"];
          const move = index < 7 ? "grow" : moves[c.move % moves.length]!;

          if (move === "clock") {
            at = [previous + 59_999, previous + 60_000, Math.max(0, at - 1)][c.pick % 3]!;
            const msg = { type: "advance", at } as const;
            msgs.push(msg);
            model = applyCell(machine, model, msg)[0];
            continue;
          }

          const arrival = Math.max(at, previous);
          const window = history.filter((h) => h.at > arrival - 60_000).reduce((s, h) => s + h.writes, 0);
          const delta =
            move === "release"
              ? -Math.min(bytes, 1 + (c.amount % bytes))
              : move === "replace"
                ? c.pick % 2 === 0
                  ? 0
                  : 1 + (c.amount % (limits.bytes - bytes + 2))
                : 1 + (c.amount % (limits.bytes - bytes + 2));
          const writes = move === "replace" && delta === 0 ? 0 : 1;
          const admitted = window + writes <= limits.writes && bytes + delta <= limits.bytes;
          const msg = {
            type: "propose",
            at,
            operation: `op:${index}`,
            writes,
            bytes: delta,
            ahead: { writes: 0, bytes: 0 },
          } as const;
          msgs.push(msg);
          const next = applyCell(machine, model, msg)[0];
          expect(next.decision._tag).toBe(admitted ? "admitted" : "refused");

          if (admitted) {
            bytes += delta;

            if (writes > 0) {
              history.push({ at: arrival, writes });
            }
          }

          expect(next.bytes).toBe(bytes);
          expect(next.writes).toBe(history.filter((h) => h.at > arrival - 60_000).reduce((s, h) => s + h.writes, 0));
          model = next;
          // Candidates that do not commit are discarded. Reopening gets the last committed state.
          const restored = machine.init(model, {})[0];
          expect(restored).toEqual(model);
        }

        // tea's own runner replays the exact messages through init and the real reducer.
        propertyTrace(
          machine,
          {},
          fc.constant(msgs),
          (_steps, final) => {
            expect(final).toEqual(model);
            return true;
          },
          { ...options, numRuns: 1 },
        );
      }),
      options,
    );
  });

  it("Q8 recovery bytes leave the rolling window, stay in totals, and clock movement cannot clear a fault", () => {
    fc.assert(
      fc.property(tape, (cells) => {
        const machine = Quota.make({ account: "alpha:1/project", channel: "recovery", limits });
        let model = machine.init(null, {})[0];
        let at = 1;
        let totalBytes = 0;
        let totalWrites = 0;

        for (const [n, c] of cells.entries()) {
          if (model._tag === "reserve_fault") {
            const fault = model.fault;
            const operation = model.operation;
            const advanced = applyCell(machine, model, { type: "advance", at: at + 60_001 + (c.amount % 100) })[0];
            expect(advanced._tag).toBe("reserve_fault");
            expect(advanced.fault).toEqual(fault);
            expect(advanced.operation).toEqual(operation);
            expect(advanced.total).toEqual({ writes: totalWrites, bytes: totalBytes });
            model = machine.init(advanced, {})[0];
            expect(model._tag).toBe("reserve_fault");
            continue;
          }

          // Repeated complete windows prove retained total is not a byte ceiling.
          at += 60_001;
          const growth = n < cells.length - 1 ? limits.bytes : limits.bytes + 1;
          const proposed = applyCell(machine, model, {
            type: "propose",
            at,
            operation: `recovery:${n}`,
            writes: 1,
            bytes: growth,
            ahead: { writes: 0, bytes: 0 },
          })[0];

          if (growth <= limits.bytes) {
            totalBytes += growth;
            totalWrites++;
            expect(proposed._tag).toBe("ready");
            expect(proposed.total).toEqual({ writes: totalWrites, bytes: totalBytes });
            expect(proposed.bytes).toBe(growth);
          } else {
            expect(proposed._tag).toBe("reserve_fault");
            expect(proposed.fault).toMatchObject({ _tag: "RecoveryReserveExhausted", resource: "storage" });
            expect(proposed.operation).toBe(`recovery:${n}`);
          }

          model = proposed;
        }

        expect(model._tag).toBe("reserve_fault");
      }),
      options,
    );
  });

  it("Q16 Process-local program accounting records exact deltas and has no minute limit", () => {
    fc.assert(
      fc.property(tape, (cells) => {
        const machine = Quota.make({ account: "alpha:1/process", channel: "local", limits });
        let model = machine.init(null, {})[0];
        let bytes = 0;
        let writes = 0;

        for (const [n, c] of cells.entries()) {
          const delta = bytes > 0 && c.pick % 3 === 0 ? -Math.min(bytes, c.amount % (bytes + 1)) : c.amount % 1000;
          const unchanged = delta === 0;
          const next = applyCell(machine, model, {
            type: "propose",
            at: 1,
            operation: `ordinary:${n}`,
            writes: unchanged ? 0 : 1,
            bytes: delta,
            ahead: { writes: 0, bytes: 0 },
          })[0];
          bytes += delta;

          if (!unchanged) {
            writes++;
          }

          expect(next.decision._tag).toBe("admitted");
          expect(next.total).toEqual({ writes, bytes });
          model = next;
        }
      }),
      options,
    );
  });
});
