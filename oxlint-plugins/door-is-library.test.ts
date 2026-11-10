import { describe, expect, it } from "vitest";
import { plant } from "../next/apps/fabrika/src/exam/plant.ts";

const code = "fabrika(door-is-library)";

describe("P17a, the library owns the door", async () => {
  const files = {
    "next/apps/fabrika/src/door.ts": [
      'export {Door} from "@kampus/libfabrika/gateway/Gateway";',
      'export type {ConnectionId} from "@kampus/libfabrika/gateway/Gateway";',
      'export * from "@kampus/libfabrika/gateway/Gateway";',
      'export const guard = (key: string) => key !== "revoked";',
      'export {Door} from "./old-door.ts";',
      'import {Door} from "@kampus/libfabrika/gateway/Gateway";',
      'export {Door as Gate} from "@kampus/libfabrika/door";',
      'export {Waiting} from "@kampus/libfabrika/gateway/internal/waiting";',
      'export {Ledger} from "@kampus/libfabrika/ledger/Ledger";',
    ].join("\n"),
    "next/apps/fabrika/src/door-store.ts": [
      'export {doorStore} from "@kampus/libfabrika/gateway/GatewayStore";',
      "export const fold = (rows: unknown[]) => rows;",
    ].join("\n"),
    "next/apps/fabrika/src/door-nonce.ts": [
      'export {doorNonce} from "@kampus/libfabrika/gateway/GatewayNonce";',
      "export default function check() { return true; }",
    ].join("\n"),
    "next/packages/libfabrika/src/gateway/Gateway.ts": "export const guard = () => true;",
    "next/apps/fabrika/src/door.test.ts": "const guard = () => true;",
    "next/apps/fabrika/src/brain.ts": "export const wire = () => true;",
  };
  const linted = await plant(files);
  // The three fronts pass in any of the three retired files. The old barrel's name, a room's
  // internal file and another room's front do not.
  it("plants checks, folds, imports and a wrong re-export in each retired file", () => {
    expect(linted(code, "next/apps/fabrika/src/door.ts")).toEqual([4, 5, 6, 7, 8, 9]);
    expect(linted(code, "next/apps/fabrika/src/door-store.ts")).toEqual([2]);
    expect(linted(code, "next/apps/fabrika/src/door-nonce.ts")).toEqual([2]);
  });
  it("permits library logic, app wiring and tests", () => {
    for (const path of Object.keys(files).slice(3)) {
      expect(linted(code, path)).toEqual([]);
    }
  });
});
