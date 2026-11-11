// `no-of` (exam item 4): no bare `of` and no `xOf` name declared in next/; a use passes. A module's
// top-level exported `of` passes and a named import of `of` fires (0029).
import { describe, expect, it } from "vitest";
import { plant } from "./plant.ts";

const CODE = "fabrika(no-of)";
const FIRES = "next/packages/tuval/src/desktop/fires.ts";
const PASSES = "next/packages/tuval/src/desktop/passes.ts";
const TEST = "next/packages/tuval/src/desktop/fires.test.ts";
const LEASE = "next/packages/tuval/src/desktop/lease.ts";

const fires = [
  "export const colorsOf = (x: number) => x;", // 1
  "export type IconOf = {readonly name: string};", // 2
  "export const a = {of: 1};", // 3
  "export function sizeOf(n: number) { return n; }", // 4
  "export interface RowOf {readonly id: string}", // 5
  "export class URLOf {}", // 6
  "export const b = (of: number) => of;", // 7: the parameter
  "export const c = {partOf(x: number) { return x; }};", // 8
  "export type D = {readonly keyOf: string};", // 9
  "export class E { static fromOf() { return 1; } }", // 10
  "const {a: renamedOf} = {a: 1};", // 11
  "export const f = renamedOf;", // 12: passes, a use
  'import {of} from "./lease.ts";', // 13: a named import of `of`
  "export const g = of(1);", // 14: passes, a use
].join("\n");

const passes = [
  "declare const xs: readonly number[];",
  "export const a = xs.indexOf(1);",
  "export const b = () => { for (const x of xs) void x; };",
  'import {nameOf} from "./old.ts";',
  "export const c = nameOf(1);",
  "const {lastIndexOf} = xs;",
  "export const d = lastIndexOf;",
  "export const e = {nameOf};",
  "export const offer = 1;",
  "export const thereof = 1;",
  'import * as Lease from "./lease.ts";',
  "export const g = Lease.of(1);",
].join("\n");

const lease = [
  "export const of = (n: number) => n;", // 1: passes, the module's own top-level `of`
  "export function make(of: number) { return of; }", // 2: the parameter
].join("\n");

describe("no-of", async () => {
  const all = await plant({
    [FIRES]: fires,
    [PASSES]: passes,
    [TEST]: "export const helperOf = 1;",
    [LEASE]: lease,
    "next/packages/tuval/src/desktop/old.ts": "export const nameOf = (x: number) => x;",
  });

  it("fires on each declared name, of every kind", () => {
    expect(all(CODE, FIRES)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13]);
  });

  it("passes a use: indexOf, for...of, an import, a shorthand key, `Lease.of` under a namespace import", () => {
    expect(all(CODE, PASSES)).toEqual([]);
  });

  it("passes a module's top-level exported `of` and fires on its `of` parameter", () => {
    expect(all(CODE, LEASE)).toEqual([2]);
  });

  it("holds in tests too", () => {
    expect(all(CODE, TEST)).toEqual([1]);
  });
});
