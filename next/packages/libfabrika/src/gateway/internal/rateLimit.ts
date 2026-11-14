/**
 * x-ci-plant-1: a comment-only plant for experiment 288, never merged.
 *
 * Line 01 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 02 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 03 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 04 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 05 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 06 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 07 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 08 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 09 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 10 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 11 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 12 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 13 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 14 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 15 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 16 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 17 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 18 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 19 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 20 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 21 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 22 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 23 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 * Line 24 of a doc block that only grows the file: it moves every line below it down, and an unminified bundle keeps it.
 */
import { Cmd, Machine } from "@demlik/tea/effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { Decision, Policy } from "../RateLimit.ts";

const Integer = Schema.Int.check(
  Schema.isBetween({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
);

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
    take: (s, m) => {
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
