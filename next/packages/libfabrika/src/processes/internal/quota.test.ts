// P34c, next/. Test-first factory contract: make({ account, channel, limits }).
// propose carries a trusted bundle's exact deltas. advance never clears a saved fault.
// No caller constructs or edits the Model. Every candidate comes from init/applyCell.
import { applyCell } from "@demlik/tea";
import { propertyTrace } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import * as fc from "fast-check";
import { expectTypeOf } from "vitest";
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
          const fail = n === Math.floor(cells.length / 2);
          const byteFault = cells[0]!.pick % 2 === 0;
          const growth = fail && byteFault ? limits.bytes + 1 : limits.bytes;
          const writes = fail && !byteFault ? limits.writes + 1 : 1;
          const proposed = applyCell(machine, model, {
            type: "propose",
            at,
            operation: `recovery:${n}`,
            writes,
            bytes: growth,
            ahead: { writes: 0, bytes: 0 },
          })[0];

          if (!fail) {
            totalBytes += growth;
            totalWrites++;
            expect(proposed._tag).toBe("ready");
            expect(proposed.total).toEqual({ writes: totalWrites, bytes: totalBytes });
            expect(proposed.bytes).toBe(growth);
          } else {
            expect(proposed._tag).toBe("reserve_fault");
            expect(proposed.fault).toMatchObject({
              _tag: "RecoveryReserveExhausted",
              resource: byteFault ? "storage" : "writes",
            });
            expect(proposed.operation).toBe(`recovery:${n}`);
          }

          model = proposed;
        }

        expect(model._tag).toBe("reserve_fault");
        expectTypeOf<Extract<Quota.Model, { readonly _tag: "reserve_fault" }>["operation"]>().not.toBeNullable();
        expectTypeOf<Quota.Model["_tag"]>().toEqualTypeOf<"ready" | "reserve_fault">();
      }),
      options,
    );
  });

  // replay is supplied by trusted storage after checking the committed inbox and receipt.
  // Its letter/recovery pair identifies room used once; ordinary request data never reaches it.
  it("Q18 replay room is spent once per accepted letter and recovery, apart from the minute window", () => {
    fc.assert(
      fc.property(tape, (cells) => {
        const machine = Quota.make({ account: "alpha:1/process", channel: "recovery", limits });
        let model = machine.init(null, {})[0];
        const accepted: string[] = [];
        let bytes = 0;
        let writes = 0;

        for (const [n, c] of cells.entries()) {
          const letter = `accepted:${n}:${c.amount}`;
          accepted.push(letter);
          const next = applyCell(machine, model, {
            type: "propose",
            at: 1,
            operation: `replay:${n}`,
            writes: limits.letter.writes,
            bytes: limits.letter.bytes,
            ahead: { writes: 0, bytes: 0 },
            replay: { letter, recovery: "restart:1" },
          })[0];
          expect(next.decision._tag).toBe("admitted");
          writes += limits.letter.writes;
          bytes += limits.letter.bytes;
          expect(next.total).toEqual({ writes, bytes });
          // The generated history grows beyond both minute caps at the same arrival time.
          expect(next.writes).toBe(0);
          expect(next.bytes).toBe(0);
          model = machine.init(next, {})[0];
        }

        // Spend the entire fixed allowance, then try to spend an earlier letter's room again.
        model = applyCell(machine, model, {
          type: "propose",
          at: 1,
          operation: "fixed",
          writes: limits.writes,
          bytes: limits.bytes,
          ahead: { writes: 0, bytes: 0 },
        })[0];
        expect(model.decision._tag).toBe("admitted");
        const letter = accepted[cells[0]!.pick % accepted.length]!;
        const twice = applyCell(machine, model, {
          type: "propose",
          at: 1,
          operation: "replay:twice",
          writes: 1,
          bytes: 1,
          ahead: { writes: 0, bytes: 0 },
          replay: { letter, recovery: "restart:1" },
        })[0];
        expect(twice._tag).toBe("reserve_fault");
        expect(twice.total).toEqual(model.total);
        expect(twice.operation).toBe("replay:twice");
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
