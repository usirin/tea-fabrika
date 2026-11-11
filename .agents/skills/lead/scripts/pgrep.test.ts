import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PgrepAnswer, pgrepAnswer, skipLine } from "./pgrep.ts";

const pids = fc.array(fc.integer({ min: 1, max: 99_999 }), { minLength: 1, maxLength: 20 });

describe("pgrepAnswer", () => {
  it("exit 0 counts one process per pid line", () =>
    fc.assert(
      fc.property(pids, (list) => {
        expect(pgrepAnswer(0, `${list.join("\n")}\n`)).toEqual(PgrepAnswer.cases.listed.make({ count: list.length }));
      }),
    ));

  it("exit 1 is nothing running, whatever it printed", () =>
    fc.assert(
      fc.property(fc.string(), (out) => {
        expect(pgrepAnswer(1, out)).toEqual(PgrepAnswer.cases.listed.make({ count: 0 }));
      }),
    ));

  it("any other exit is refused, never a count", () =>
    fc.assert(
      fc.property(
        fc.integer({ min: -1, max: 255 }).filter((code) => code !== 0 && code !== 1),
        fc.string(),
        (code, out) => {
          expect(pgrepAnswer(code, out)).toEqual(PgrepAnswer.cases.refused.make({}));
        },
      ),
    ));

  it("format: the skip line names the guard it skips, on one line", () =>
    fc.assert(
      fc.property(fc.constantFrom("agent cap", "one-typecheck wait"), (guard) => {
        expect(skipLine(guard)).toContain(guard);
        expect(skipLine(guard)).not.toContain("\n");
      }),
    ));
});
