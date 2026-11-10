import { Effect, Layer, Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { listed } from "../program/listed.ts";
import { defineProgram } from "../program/program.ts";
import { input } from "../program/shape.ts";
import { BUILTINS } from "../shell/grammar.ts";
import { programList } from "../shell/programs.ts";
import { JOB_TOOL } from "./job.ts";
// made up: `LINE_TOOL`, as stop.ts's `STOP_TOOL` (tracker 185b, PR 3).
import { LINE_TOOL } from "./line.ts";
// made up: `RESTART_TOOL`, as stop.ts's `STOP_TOOL` (185b PR 5).
import { RESTART_TOOL } from "./restart.ts";
// made up: `STOP_TOOL`, as job.ts's `JOB_TOOL`.
import { STOP_TOOL } from "./stop.ts";
import { type Tool, toolNameOf, toolsOf } from "./tools.ts";

// The laws over every tool an agent could be served (tracker 185b, PR 1 and PR 5, d2), for any
// program list:
//
// - an input only a person tells (`{personOnly: true}`) has no tool;
// - no host tool (`runs`, `job`, `stop`, `restart`, `line`) is named as a `<program>_<input>` tool could be: a host
//   tool's name has no `_`;
// - every tool that is not read-only is destructive, by MCP's hints (spec 2025-11-25, "Tools"):
//   `destructiveHint` true, or left out, which the spec reads as true. No tool that writes says it
//   is harmless.
//
// Today's version. Programs are made here with random inputs; nothing runs.

const OPTS = { numRuns: 200, seed: 119120 };

type Kind = "write" | "read" | "person";

interface Spec {
  readonly name: string;
  readonly inputs: ReadonlyArray<{ readonly name: string; readonly kind: Kind }>;
}

const arbInput = fc.record({
  name: fc.stringMatching(/^[a-z][a-z0-9_]{0,6}$/),
  kind: fc.constantFrom<Kind>("write", "read", "person"),
});

const arbProgram: fc.Arbitrary<Spec> = fc.record({
  name: fc.stringMatching(/^[a-z][a-z0-9-]{0,6}$/).filter((name) => !(BUILTINS as readonly string[]).includes(name)),
  inputs: fc.uniqueArray(arbInput, { selector: (i) => i.name, maxLength: 5 }),
});

const arbSpecs = fc.uniqueArray(arbProgram, { selector: (p) => p.name, maxLength: 5 });

const optionsOf = (kind: Kind) =>
  kind === "read" ? { writes: false as const } : kind === "person" ? { personOnly: true as const } : {};

const listOf = (specs: readonly Spec[]) =>
  programList(
    specs.map((spec) =>
      listed(
        defineProgram({
          name: spec.name,
          description: "A program made for the law.",
          inputs: Object.fromEntries(
            spec.inputs.map((i) => [i.name, input(Schema.Int, "A number.", optionsOf(i.kind))]),
          ),
          outputs: {},
          main: () => Effect.void,
        }),
        Layer.empty,
      ),
    ),
  );

/** Every tool an agent could be served: each program's, `runs`, and the host's `job`, `stop`, `restart` and `line`. */
const everyTool = (specs: readonly Spec[]): readonly Tool[] => [
  ...toolsOf(listOf(specs)),
  JOB_TOOL,
  STOP_TOOL,
  RESTART_TOOL,
  LINE_TOOL,
];

describe("the tools an agent is served, for any program list", () => {
  it("makes no tool for an input only a person tells", () => {
    fc.assert(
      fc.property(arbSpecs, (specs) => {
        const names = new Set(everyTool(specs).map((t) => t.name));
        const personOnly = specs.flatMap((spec) =>
          spec.inputs.filter((i) => i.kind === "person").map((i) => toolNameOf(spec.name, i.name)),
        );
        expect(personOnly.filter((name) => names.has(name))).toEqual([]);
      }),
      OPTS,
    );
  });

  it("names no host tool as a <program>_<input> tool could be named", () => {
    fc.assert(
      fc.property(arbSpecs, (specs) => {
        const programTools = new Set(specs.flatMap((spec) => spec.inputs.map((i) => toolNameOf(spec.name, i.name))));
        const host = everyTool(specs).filter((t) => !specs.some((spec) => t.name.startsWith(`${spec.name}_`)));
        expect(host.map((t) => t.name)).toEqual(expect.arrayContaining(["runs", "job", "stop", "restart", "line"]));

        for (const tool of host) {
          expect(tool.name).not.toContain("_");
          expect(programTools.has(tool.name)).toBe(false);
        }
      }),
      OPTS,
    );
  });

  it("marks every tool that is not read-only destructive", () => {
    fc.assert(
      fc.property(arbSpecs, (specs) => {
        const writes = everyTool(specs).filter((tool) => tool.annotations?.readOnlyHint !== true);
        // `stop`, `restart` and `line` at least: the host's own tools that write.
        expect(writes.map((tool) => tool.name)).toEqual(expect.arrayContaining(["stop", "restart", "line"]));
        // Left out, `destructiveHint` is true by the spec's default.
        expect(writes.filter((tool) => (tool.annotations?.destructiveHint ?? true) !== true)).toEqual([]);
      }),
      OPTS,
    );
  });

  it("marks a query's tool read-only, and an input that writes not read-only", () => {
    fc.assert(
      fc.property(arbSpecs, (specs) => {
        const byName = new Map(everyTool(specs).map((t) => [t.name, t]));
        const hintOf = (kind: Kind) =>
          specs.flatMap((spec) =>
            spec.inputs
              .filter((i) => i.kind === kind)
              .map((i) => {
                const tool = byName.get(toolNameOf(spec.name, i.name));
                return tool === undefined ? "no tool" : (tool.annotations?.readOnlyHint ?? false);
              }),
          );
        expect(hintOf("read").filter((hint) => hint !== true)).toEqual([]);
        expect(hintOf("write").filter((hint) => hint !== false)).toEqual([]);
      }),
      OPTS,
    );
  });
});
