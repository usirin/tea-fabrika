// Desk S1, next/: L1's rule. 0170's first rule says any member may start any program, and a smarter
// rule later changes only `mayStart`. The runner half of L1, a start caused by a member's letter on
// real runners, is in `runtime/StartChildTest.ts`; the real door's half is in
// `next/apps/fabrika/src/start-child.laws.test.ts`.
//
// The contract this law pins, from the approved plan's shape:
//   StartRule.ts: `mayStart(member, program): boolean`, true for every member and program.
import { expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import * as Id from "../Id.ts";
import { mayStart } from "./StartRule.ts";

const SEED = 119120;

it.prop(
  "L1: any member may start any program (0170's first rule)",
  {
    member: Arbitrary.schema(Id.Person),
    program: Arbitrary.schema(Schema.String),
  },
  ({ member, program }) => {
    expect(mayStart(member, program), `L1: ${member} may start ${JSON.stringify(program)}`).toBe(true);
  },
  { arbitrary: { runs: 200, seed: SEED } },
);
