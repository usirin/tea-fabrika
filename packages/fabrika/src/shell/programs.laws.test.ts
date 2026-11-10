import { Effect, Layer, Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { listed } from "../program/listed.ts";
import { defineProgram, type Inputs } from "../program/program.ts";
import { flag, input, output } from "../program/shape.ts";
import { BUILTINS } from "./grammar.ts";
import { forAgent, type ProgramList, programList } from "./programs.ts";

// The law over the program list an agent is handed (tracker 185b, PR 2, d8), for any list:
// `forAgent(list)` takes every input only a person tells (`{personOnly: true}`) out of each
// program, and leaves the rest whole. The MCP door is handed it (apps/fabrika/src/host/agents.ts),
// and so is the agent's tsh (PR 3), so no path an agent has reaches `answer` or `rate_duplicate`:
// not a tool, a `tell`, a pipe, or a window's press.
//
//   tracker's inputs        {query, file, answer (person only), ...}
//   forAgent's tracker      {query, file, ...}: no answer; the others the same declarations
//
// Today's version. Programs are made here with random inputs; nothing runs.

const OPTS = { numRuns: 200, seed: 119120 };

interface InputSpec {
  readonly name: string;
  readonly personOnly: boolean;
  readonly writes: boolean;
  readonly control: boolean;
}

interface Spec {
  readonly name: string;
  readonly flags: readonly string[];
  readonly inputs: readonly InputSpec[];
  readonly outputs: readonly string[];
}

const arbName = fc.stringMatching(/^[a-z][a-z0-9_]{0,6}$/);

const arbInput: fc.Arbitrary<InputSpec> = fc.record({
  name: arbName,
  personOnly: fc.boolean(),
  writes: fc.boolean(),
  control: fc.boolean(),
});

const arbProgram: fc.Arbitrary<Spec> = fc.record({
  name: fc.stringMatching(/^[a-z][a-z0-9-]{0,6}$/).filter((name) => !(BUILTINS as readonly string[]).includes(name)),
  // `help` is refused as a flag by `programList`.
  flags: fc.uniqueArray(
    arbName.filter((name) => name !== "help"),
    { maxLength: 3 },
  ),
  inputs: fc.uniqueArray(arbInput, { selector: (i) => i.name, maxLength: 6 }),
  outputs: fc.uniqueArray(arbName, { maxLength: 3 }),
});

const arbSpecs = fc.uniqueArray(arbProgram, { selector: (p) => p.name, maxLength: 5 });

const declaredOf = (i: InputSpec) =>
  input(Schema.Int, "A number.", {
    ...(i.personOnly ? { personOnly: true as const } : {}),
    ...(i.writes ? {} : { writes: false as const }),
    ...(i.control ? { control: true as const } : {}),
  });

const listOf = (specs: readonly Spec[]): ProgramList =>
  programList(
    specs.map((spec) =>
      listed(
        defineProgram({
          name: spec.name,
          description: "A program made for the law.",
          flags: Object.fromEntries(spec.flags.map((name) => [name, flag(Schema.Int, "A number.", { default: 0 })])),
          inputs: Object.fromEntries(spec.inputs.map((i) => [i.name, declaredOf(i)])),
          outputs: Object.fromEntries(spec.outputs.map((name) => [name, output(Schema.Int, "A number.")])),
          main: () => Effect.void,
        }),
        Layer.empty,
      ),
    ),
  );

describe("forAgent, for any program list", () => {
  it("leaves no input only a person tells, in any program", () => {
    fc.assert(
      fc.property(arbSpecs, (specs) => {
        const agents = forAgent(listOf(specs));
        const left = [...agents.values()].flatMap((entry) =>
          Object.entries<Inputs[string]>(entry.program.inputs)
            .filter(([, declared]) => declared.personOnly)
            .map(([name]) => `${entry.program.name}.${name}`),
        );
        expect(left).toEqual([]);
      }),
      OPTS,
    );
  });

  it("keeps every other input whole, in the same order", () => {
    fc.assert(
      fc.property(arbSpecs, (specs) => {
        const list = listOf(specs);
        const agents = forAgent(list);

        for (const [name, entry] of list) {
          const theirs = agents.get(name);
          expect(theirs).toBeDefined();
          const kept = Object.entries<Inputs[string]>(entry.program.inputs).filter(
            ([, declared]) => !declared.personOnly,
          );
          const got = Object.entries(theirs?.program.inputs ?? {});
          expect(got.map(([input]) => input)).toEqual(kept.map(([input]) => input));

          for (const [i, [input, declared]] of kept.entries()) {
            expect(got[i]?.[0]).toBe(input);
            // Whole: its shape, ack, control and hints as they were.
            expect(got[i]?.[1]).toEqual(declared);
          }
        }
      }),
      OPTS,
    );
  });

  it("keeps every program, by its name, with its flags, outputs and description", () => {
    fc.assert(
      fc.property(arbSpecs, (specs) => {
        const list = listOf(specs);
        const agents = forAgent(list);
        expect([...agents.keys()]).toEqual([...list.keys()]);

        for (const [name, entry] of list) {
          const theirs = agents.get(name)?.program;
          expect(theirs?.name).toBe(entry.program.name);
          expect(theirs?.description).toBe(entry.program.description);
          expect(theirs?.flags).toEqual(entry.program.flags);
          expect(theirs?.outputs).toEqual(entry.program.outputs);
        }
      }),
      OPTS,
    );
  });
});
