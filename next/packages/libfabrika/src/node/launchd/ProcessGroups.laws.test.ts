// L13 guard, next/. A host test never signals a group it does not own, and never group 0 or 1.
// Plants: drop `row.group > 1`; drop the leader check; let a root of 1 through.
import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as fc from "fast-check";
import * as ProcessGroups from "./ProcessGroups.test-support.ts";

const id = fc.integer({ min: -2, max: 40 });
const rows = fc.array(fc.record({ pid: id, parent: id, group: id }), { maxLength: 60 });

it("property: no table and no root yields a group of 1 or below", () => {
  fc.assert(
    fc.property(rows, id, (table, root) => {
      expect(ProcessGroups.descendants(table, root).filter((group) => group <= 1)).toEqual([]);
    }),
  );
});

it("property: every group returned is led by the root or by a process beneath it", () => {
  fc.assert(
    fc.property(rows, id, (table, root) => {
      // Walks up from a pid to the root, the other way from the code under test.
      const beneath = (pid: number, seen: ReadonlyArray<number> = []): boolean =>
        pid === root ||
        (!seen.includes(pid) && table.some((row) => row.pid === pid && beneath(row.parent, [...seen, pid])));

      for (const group of ProcessGroups.descendants(table, root)) {
        expect(beneath(group)).toBe(true);
      }
    }),
  );
});

it("property: a root of 1 or below owns nothing, whatever the table holds", () => {
  fc.assert(
    fc.property(rows, fc.integer({ min: -5, max: 1 }), (table, root) => {
      expect(ProcessGroups.descendants(table, root)).toEqual([]);
    }),
  );
});

it("vector: the 2026-11-13 run, a service caught in launchd's group 1, keeps only its own groups", () => {
  // The saved list that day was [65831, 66680, 67964, 70410, 71425, 1, 72448].
  const table = [
    { pid: 1, parent: 0, group: 1 },
    { pid: 501, parent: 1, group: 501 },
    { pid: 72440, parent: 1, group: 1 },
    { pid: 72448, parent: 72440, group: 72448 },
  ];
  expect(ProcessGroups.descendants(table, 72440)).toEqual([72448]);
});

it("scenario: a service that leads its own group, with a child in it and a child that left it", () => {
  const table = [
    { pid: 1, parent: 0, group: 1 },
    { pid: 900, parent: 1, group: 900 },
    { pid: 901, parent: 900, group: 900 },
    { pid: 902, parent: 900, group: 902 },
    { pid: 950, parent: 1, group: 950 },
  ];
  expect([...ProcessGroups.descendants(table, 900)].sort()).toEqual([900, 902]);
});

it("property: a saved list that holds a group of 1 or below does not decode", () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 2, max: 99_999 })), fc.integer({ min: -9, max: 1 }), (good, bad) => {
      const decode = Schema.decodeUnknownSync(Schema.fromJsonString(ProcessGroups.Saved));
      expect(decode(JSON.stringify(good))).toEqual(good);
      expect(() => decode(JSON.stringify([...good, bad]))).toThrow();
    }),
  );
});
