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
// The span sink's control state as one tea machine (0037, 0046): spans held after a write that
// could not land, a failure no flush has reported yet, and the newest hour sized. Memory only, as
// before: a new sink starts clean and unchecked. No Cmds: `Sink.ts` runs the SQL and sends its
// outcome.
import { Machine } from "@demlik/tea/effect";
import { Array as Arr, Schema } from "effect";
import { Chain, Measurements, SpanRow } from "../Trace.ts";

/** What one ended span writes: its health row and its unsent row, worked out before any write. */
const Ended = Schema.Struct({
  health: Measurements,
  chain: Chain,
  row: SpanRow,
  content: Schema.NullOr(Schema.String),
});
/** @internal */
export type Ended = typeof Ended.Type;

/** `clean` and `failed` hold no spans, `holding` and `reported` hold at least one. A failure awaits
 *  a flush in `failed` and `holding`. `checked` is the newest hour a sized commit reached. */
/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
const Model = Schema.TaggedUnion({
  clean: { checked: Schema.Number },
  failed: { checked: Schema.Number },
  holding: { checked: Schema.Number, spans: Schema.NonEmptyArray(Ended) },
  reported: { checked: Schema.Number, spans: Schema.NonEmptyArray(Ended) },
});
type Model = typeof Model.Type;

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("commit_failed"), more: Schema.Array(Ended) }),
  Schema.Struct({ type: Schema.Literal("committed"), hour: Schema.Number, sized: Schema.Boolean }),
  Schema.Struct({ type: Schema.Literal("flush_checked") }),
]);

/** @internal The spans a Model holds, oldest first. */
export const held = (model: Model): ReadonlyArray<Ended> =>
  model._tag === "holding" || model._tag === "reported" ? model.spans : [];

/** @internal */
export const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: () => [Model.cases.clean.make({ checked: Number.NEGATIVE_INFINITY }), []],
  update: {
    commit_failed: (s, m) => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
      const spans = [...held(s), ...m.more];
      return [
        Arr.isReadonlyArrayNonEmpty(spans)
          ? Model.cases.holding.make({ checked: s.checked, spans })
          : Model.cases.failed.make({ checked: s.checked }),
        [],
      ];
    },
    committed: (s, m) => {
      const checked = m.sized && m.hour > s.checked ? m.hour : s.checked;
      return [
        s._tag === "failed" || s._tag === "holding"
          ? Model.cases.failed.make({ checked })
          : Model.cases.clean.make({ checked }),
        [],
      ];
    },
    flush_checked: (s) => [
      s._tag === "holding" || s._tag === "reported"
        ? Model.cases.reported.make({ checked: s.checked, spans: s.spans })
        : Model.cases.clean.make({ checked: s.checked }),
      [],
    ],
  },
});
