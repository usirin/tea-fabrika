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
import { Cmd, Machine } from "@demlik/tea/effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Decision, Policy } from "../RateLimit.ts";

const Integer = Schema.Int.check(
  Schema.isBetween({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
);

/**
 * x-ci-plant-2 middle: every line below this one moves down by three.
 */
const Positive = Integer.check(Schema.isGreaterThan(0));

/** @internal The saved budget schema retains its synchronous codecs. */
export const Model = Schema.TaggedUnion({
  fresh: {},
  open: { policy: Policy, until: Integer, at: Integer, used: Positive },
  full: { policy: Policy, until: Integer, at: Integer },
}).check(
  Schema.makeFilter((s) => s._tag === "fresh" || (s.until > s.at && (s._tag === "full" || s.used < s.policy.limit))),
);

const Msg = Schema.Struct({ type: Schema.Literal("take"), at: Integer, policy: Policy });
const report = Cmd.make("report", { input: Schema.Struct({ decision: Decision }), ok: Schema.Null, err: [] });
const times = Schema.decodeUnknownResult(Schema.Struct({ at: Integer, until: Integer, ttl: Positive }));

/** @internal One sender's saved budget. Time and policy enter only in a take message. */
export const machine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [report],
  init: (loaded) => [loaded ?? Model.cases.fresh.make({}), []],
  update: {
    take: (s, m) => {/** x-ci-plant-2 inner: defineMachine( and syncTest( in a function body. */ 
      const live = s._tag !== "fresh" && m.at < s.until;
      const at = live ? Math.max(m.at, s.at) : m.at;
      const same = s._tag !== "fresh" && s.policy.limit === m.policy.limit && s.policy.window === m.policy.window;
      const continuing = live && same;
      const until = continuing ? s.until : (Math.floor(at / m.policy.window) + 1) * m.policy.window;
      const checked = times({ at, until, ttl: until - at });

      if (Result.isFailure(checked)) {
        return [s, [report({ decision: Decision.cases.invalid.make({ cause: checked.failure }) })]];
      }

      const { ttl } = checked.success;

      if (continuing && s._tag === "full") {
        return [
          Model.cases.full.make({ policy: m.policy, until, at }),
          [report({ decision: Decision.cases.refused.make({ retryAfter: ttl }) })],
        ];
      }

      const used = continuing && s._tag === "open" ? s.used + 1 : 1;
      const next =
        used === m.policy.limit
          ? Model.cases.full.make({ policy: m.policy, until, at })
          : Model.cases.open.make({ policy: m.policy, until, at, used });
      return [next, [report({ decision: Decision.cases.allowed.make({ count: used, ttl }) })]];
    },
    report_ok: (s) => [s, []],
    report_err: (s) => [s, []],
  },
});
