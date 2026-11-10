// `no-hand-tag` (exam item 5): no hand-written `_tag` in next/; a read and a schema tool pass.
import { describe, expect, it } from "vitest";
import { plant } from "./plant.ts";

const CODE = "fabrika(no-hand-tag)";
const FIRES = "next/packages/libfabrika/src/coordination/fires.ts";
const PASSES = "next/packages/libfabrika/src/coordination/passes.ts";
const LOG = "next/packages/libfabrika/src/data/log.ts";

const fires = [
  'import {Schema} from "effect";', // 1
  'export const a = {_tag: "x"};', // 2
  'export type X = {readonly _tag: "x"};', // 3
  'export const S = Schema.Struct({_tag: Schema.Literal("x")});', // 4
  'export const b = {"_tag": "y"};', // 5
  'export class C { readonly _tag = "c"; }', // 6
  "export const d = (_tag: string) => ({_tag});", // 7
].join("\n");

const passes = [
  'import {Schema} from "effect";',
  "export const Fault = Schema.TaggedUnion({x: {}, abort: {name: Schema.String}});",
  'export const fault = Fault.cases.abort.make({name: "counter:1"});',
  "declare const value: typeof Fault.Type;",
  'export const a = value._tag === "x";',
  "export const {_tag} = value;",
  'export const b = {type: "plus"};',
  'export const Send = Schema.TaggedStruct("send", {m: Schema.Unknown});',
].join("\n");

describe("no-hand-tag", async () => {
  const all = await plant({
    [FIRES]: fires,
    [PASSES]: passes,
    [LOG]: fires,
    "next/packages/libfabrika/src/coordination/fires.test.ts": fires,
  });

  it("fires on a key, a type member and a class field named _tag", () => {
    expect(all(CODE, FIRES)).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it("passes a read, the schema tools, a maker and tea's `type`", () => {
    expect(all(CODE, PASSES)).toEqual([]);
  });

  it("leaves the log, its one edge, and tests alone", () => {
    expect(all(CODE, LOG)).toEqual([]);
    expect(all(CODE, "next/packages/libfabrika/src/coordination/fires.test.ts")).toEqual([]);
  });
});
