// P25 slice 1, next/: CI's check job checks the uncalled function.
import { Machine } from "@demlik/tea/effect";
import { expectTypeOf, it } from "@effect/vitest";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Program from "../runtime/Program.ts";
import * as Tools from "./Tools.ts";

const types = () => {
  const msg = Schema.Union([
    Schema.Struct({ type: Schema.Literal("check"), name: Schema.String, note: Schema.optionalKey(Schema.String) }),
    Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Int }),
  ]);
  const machine = Machine.make({
    model: Schema.Null,
    msg,
    cmds: [],
    init: () => [null, []],
    update: { check: (m) => [m, []], timer: (m) => [m, []] },
  });
  const program = Program.Program.make({
    name: "pack/checklist",
    machine,
    state: { v: 1, upgrades: [] },
    view: () => null,
    refuse: () => null,
    inputs: { check: "Check" },
    outputs: {},
    writes: {},
    wake: () => null,
  });
  const port = Program.port(program, "check");
  type PortValue = Option.Option.Value<typeof port>["Type"];
  expectTypeOf<PortValue>().toEqualTypeOf<{ readonly name: string; readonly note?: string }>();
  Tools.list([program]);
  // @ts-expect-error A tool list accepts checked Program values only.
  Tools.list([{}]);
  const outside: unknown = program;
  // @ts-expect-error Unknown data is not a checked Program.
  Tools.list([outside]);
  expectTypeOf(Tools.Call).toExtend<
    Schema.TaggedUnion<{
      ps: typeof Tools.Call.cases.ps;
      write: typeof Tools.Call.cases.write;
      query: typeof Tools.Call.cases.query;
      refused: typeof Tools.Call.cases.refused;
    }>
  >();
  expectTypeOf(Tools.Call.cases.ps.make({})).toEqualTypeOf<{ readonly _tag: "ps" }>();
  expectTypeOf(Tools.read([program], "checklist_check", {})).toEqualTypeOf<typeof Tools.Call.Type>();
};

void types;

// format: these compile-time checks run in CI; the function must stay uncalled.
it("format: T4 public type assertions are checked by CI", () => {
  expectTypeOf(types).toBeFunction();
});
