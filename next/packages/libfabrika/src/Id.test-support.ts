/**
 * x-ci-plant-2: trap text in a comment, for experiment 288, never merged.
import { spawn } from "node:child_process";
import { Plant } from "../../../x-ci-plant-not-a-file.ts";
export { Plant } from "@kampus/libfabrika/gateway/Gateway";
 * defineMachine({ id: "x-ci-plant" }) and defineProgram( and syncTest( and Effect.runPromise(
 * person:x-ci-plant p8-clean-window p8-mcp-marker node:fs node:child_process
 * imports "../access/Access.ts" and new Promise( and process.env.X_CI_PLANT
 * paths: ./next/apps/fabrika/src/x-ci-plant.ts ../../x-ci-plant/secret.txt /etc/x-ci-plant
 * a url: https://example.invalid/x-ci-plant and a line pin: x-ci-plant.ts:1:1
 */
import { Arbitrary, Effect, Schema } from "effect";
import * as fc from "fast-check";
import * as Id from "./Id.ts";

const maxClock = 2 ** 48 - 1;

export const processClocks = Arbitrary.schema(
  Schema.Union([Schema.Literals([0, maxClock]), Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: maxClock }))]),
);

// Encode independently of Id.Generator so these laws also catch an encoder or decoder mistake.
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
const encodeProcess = (at: number, random: ReadonlyArray<number>): string => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
  const bytes = Uint8Array.from([
    ...Array.from({ length: 6 }, (_, i) => Number((BigInt(at) >> BigInt((5 - i) * 8)) & 255n)),
    ...random.map((byte, i) => (i === 0 ? (byte & 15) | 0x70 : i === 2 ? (byte & 63) | 0x80 : byte)),
  ]);
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  const bits = `00${[...bytes].map((byte) => byte.toString(2).padStart(8, "0")).join("")}`;
  const suffix = Array.from({ length: 26 }, (_, i) => alphabet[Number.parseInt(bits.slice(i * 5, i * 5 + 5), 2)]).join(
    "",
  );
  return `process_${suffix}`;
};

// Generate the remaining UUIDv7 bits even at both clock limits, where the suffix starts with 0 or 7.
export const processIds = Arbitrary.all({
  at: processClocks,
  random: Arbitrary.array(Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 }))), {
    minLength: 10,
    maxLength: 10,
  }),
}).pipe(Arbitrary.map(({ at, random }) => encodeProcess(at, random)));

// The same exact UUIDv7 process ids for laws written with fast-check.
export const fcProcessIds: fc.Arbitrary<string> = fc
  .tuple(
    fc.oneof(fc.constantFrom(0, maxClock), fc.integer({ min: 0, max: maxClock })),
    fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 10, maxLength: 10 }),
  )
  .map(([at, random]) => encodeProcess(at, random));

export const inputParents = Arbitrary.all({
  process: processIds,
  count: Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }))),
}).pipe(Arbitrary.map(({ process, count }) => `in-${process}-${count}`));

// Keep PR 1's fixtures unbranded, like data/trace.ts's ProcessId.
export const processId: Effect.Effect<string> = Id.Generator.use((ids) => ids.next(Id.Process)).pipe(
  Effect.orDie,
  Effect.provide(Id.Generator.layer),
);
