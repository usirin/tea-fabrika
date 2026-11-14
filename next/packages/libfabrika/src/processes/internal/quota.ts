import { Machine } from "@demlik/tea/effect";
import * as Schema from "effect/Schema";
import { Exceeded, RecoveryReserveExhausted, type Allowance } from "../Quotas.ts";

const Amount = Schema.Struct({ writes: Schema.Number, bytes: Schema.Number });
const Decision = Schema.TaggedUnion({ admitted: {}, refused: { reason: Exceeded } });

const Fields = {
  account: Schema.String,
  channel: Schema.Literals(["program", "recovery", "local"]),
  at: Schema.Number,
  writes: Schema.Number,
  bytes: Schema.Number,
  total: Amount,
  ahead: Amount,
  groups: Schema.Array(Schema.Struct({ at: Schema.Number, ...Amount.fields })),
  replay: Schema.Struct({ recovery: Schema.String, letters: Schema.Array(Schema.String) }),
  decision: Decision,
};

/** @internal */
export const Model = Schema.TaggedUnion({
  ready: Fields,
  reserve_fault: { ...Fields, fault: RecoveryReserveExhausted, operation: Schema.String },
});

/** @internal */
export type Model = typeof Model.Type;

const Msg = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("propose"),
    at: Schema.Number,
    operation: Schema.String,
    ...Amount.fields,
    ahead: Amount,
    replay: Schema.optionalKey(Schema.Struct({ letter: Schema.String, recovery: Schema.String })),
  }),
  Schema.Struct({ type: Schema.Literal("advance"), at: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("resume"), at: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("restore"), model: Model }),
  Schema.Struct({ type: Schema.Literal("settle"), bytes: Schema.Number, ahead: Amount }),
]);

/** @internal */
export type Msg = typeof Msg.Type;

const advance = (s: Model, at: number): Model => {
  const now = Math.max(s.at, at);
  const groups = s.groups.filter((g) => g.at > now - 60_000);
  return {
    ...s,
    writes: groups.reduce((n, g) => n + g.writes, 0),
    bytes: s.channel === "recovery" ? groups.reduce((n, g) => n + g.bytes, 0) : s.bytes,
  };
};

/** @internal */
export const make = (options: {
  readonly account: string;
  readonly channel: Model["channel"];
  readonly limits: Allowance;
}) =>
  Machine.make({
    model: Model,
    msg: Msg,
    cmds: [],
    init: (saved) => [
      saved ??
        Model.cases.ready.make({
          account: options.account,
          channel: options.channel,
          at: 0,
          writes: 0,
          bytes: 0,
          ahead: { writes: 0, bytes: 0 },
          total: { writes: 0, bytes: 0 },
          groups: [],
          replay: { recovery: "", letters: [] },
          decision: Decision.cases.admitted.make({}),
        }),
      [],
    ],
    update: {
      restore: (_s, m) => [m.model, []],
      settle: (s, m) => [
        {
          ...s,
          bytes: s.bytes + m.bytes - m.ahead.bytes,
          total: { ...s.total, bytes: s.total.bytes + m.bytes },
          ahead: { writes: s.ahead.writes - m.ahead.writes, bytes: s.ahead.bytes - m.ahead.bytes },
          decision: Decision.cases.admitted.make({}),
        },
        [],
      ],
      advance: (s, m) => [advance(s, m.at), []],
      resume: (s, m) => {
        const { _tag: _case, ...fields } = advance(s, m.at);
        return [Model.cases.ready.make(fields), []];
      },
      propose: (previous, m) => {
        const s = advance(previous, m.at);

        if (s._tag === "reserve_fault") {
          return [s, []];
        }

        const replay =
          m.replay !== undefined &&
          (s.replay.recovery !== m.replay.recovery || !s.replay.letters.includes(m.replay.letter)) &&
          m.writes <= options.limits.letter.writes &&
          Math.max(0, m.bytes) <= options.limits.letter.bytes;
        const writes = replay ? 0 : m.writes + m.ahead.writes;
        const bytes = replay ? 0 : Math.max(0, m.bytes + m.ahead.bytes);
        const usedWrites = s.writes + writes;
        const usedBytes = s.channel === "recovery" ? s.bytes + bytes : s.bytes + m.bytes + m.ahead.bytes;
        const resource = usedWrites > options.limits.writes ? "writes" : "storage";
        const exceeded =
          s.channel !== "local" && (usedWrites > options.limits.writes || usedBytes > options.limits.bytes);

        if (exceeded) {
          if (s.channel === "recovery") {
            const { _tag: _case, ...fields } = s;
            return [
              Model.cases.reserve_fault.make({
                ...fields,
                operation: m.operation,
                fault: new RecoveryReserveExhausted({
                  resource,
                  location: s.account.endsWith("/project") ? "project" : "process",
                  process: s.account,
                  required: resource === "writes" ? writes : bytes,
                  remaining: resource === "writes" ? options.limits.writes - s.writes : options.limits.bytes - s.bytes,
                  cause: null,
                }),
              }),
              [],
            ];
          }

          return [
            {
              ...s,
              decision: Decision.cases.refused.make({
                reason: new Exceeded({
                  resource,
                  used: resource === "writes" ? usedWrites : usedBytes,
                  limit: resource === "writes" ? options.limits.writes : options.limits.bytes,
                  cause: null,
                }),
              }),
            },
            [],
          ];
        }

        if (m.writes === 0 && m.bytes === 0 && m.ahead.writes === 0 && m.ahead.bytes === 0) {
          return [{ ...s, decision: Decision.cases.admitted.make({}) }, []];
        }

        const at = Math.max(s.at, m.at);
        const groups = s.groups.filter((g) => g.at > at - 60_000);
        const last = groups.at(-1);

        if (writes !== 0 || bytes !== 0) {
          if (last?.at === at) {
            groups[groups.length - 1] = { at, writes: last.writes + writes, bytes: last.bytes + bytes };
          } else {
            groups.push({ at, writes, bytes });
          }
        }

        return [
          {
            ...s,
            at,
            groups,
            writes: usedWrites,
            bytes: usedBytes,
            total: { writes: s.total.writes + m.writes, bytes: s.total.bytes + m.bytes },
            ahead: { writes: s.ahead.writes + m.ahead.writes, bytes: s.ahead.bytes + m.ahead.bytes },
            replay:
              replay && m.replay !== undefined
                ? {
                    recovery: m.replay.recovery,
                    letters: [...(s.replay.recovery === m.replay.recovery ? s.replay.letters : []), m.replay.letter],
                  }
                : s.replay,
            decision: Decision.cases.admitted.make({}),
          },
          [],
        ];
      },
    },
  });
