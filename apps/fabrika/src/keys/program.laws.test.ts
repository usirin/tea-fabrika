import { propertyInvariant } from "@demlik/tea/pbt";
import * as fc from "fast-check";
import { describe, it } from "vitest";
import { keysProgram } from "./program.ts";

// The keys program's `session` machine (program.ts), on tea's pbt: it starts open, and `close`
// closes it for good. Nothing it hears opens it again, and it never asks for anything.
const session = keysProgram.machines.session.machine;

describe("today's keys session laws on tea's pbt", () => {
  it("once closed, a session stays closed, and no step sends a command", () => {
    propertyInvariant(
      session,
      undefined,
      fc.array(fc.constant({ type: "close" } as const), { minLength: 1, maxLength: 10 }),
      ({ next, cmds }) => next.open === false && cmds.length === 0,
      { numRuns: 50, seed: 1 },
    );
  });
});
