import { Cmd, Machine } from "@demlik/tea/effect";
import { Schema } from "effect";
import { canRestart, Start } from "../coordination/process.ts";
import { Failure, Policy, Recovery, Supervision } from "../coordination/recovery.ts";

export { Policy };

export const defaultPolicy: Policy = {
  maxDeliveries: 3,
  intensity: 5,
  periodMs: 5000,
  backoff: { minMs: 100, maxMs: 800, resetAfterMs: 5000 },
};

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("threw"), failure: Failure, at: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("exited"), at: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("due"), at: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("started"), process: Schema.String, at: Schema.Number }),
  Schema.Struct({ type: Schema.Literal("healthy"), at: Schema.Number }),
]);

export type SupervisorMsg = typeof Msg.Type;

type Ctx = {
  readonly policy: Policy;
  readonly process: string;
  readonly name: string;
  readonly build: string;
  readonly at: number;
};

const exit = Cmd.make("exit", {
  input: Schema.Struct({ process: Schema.String, id: Schema.String }),
  ok: Schema.Null,
  err: [],
});

const down = Cmd.make("down", {
  input: Schema.Struct({ process: Schema.String }),
  ok: Schema.Null,
  err: [],
});

const start = Cmd.make("start", {
  input: Schema.Struct({ process: Schema.String, until: Schema.Number }),
  ok: Schema.Null,
  err: [],
});

const pending = (s: Supervision) => [s, []] as const;

const crashWhy = (failure: Failure) =>
  failure._tag === "saved" ? "saved_letter" : failure._tag === "fresh" ? "step" : "interrupted";

/** The successor's start request, after the process that crashed. */
const again = (s: Supervision, after: string, why: string) =>
  Recovery.cases.starting.make({
    after,
    request: Start.cases.again.make({
      id: `recover:${after}:${s.seq}`,
      name: s.name,
      after,
      why,
      code: { program: s.name.split(":")[0] ?? s.name, hash: s.build },
    }),
  });

export const supervisor = Machine.make({
  model: Supervision,
  msg: Msg,
  cmds: [exit, down, start],
  types: { ctx: {} as Ctx },
  init: (saved, ctx) => [
    saved ??
      Supervision.make({
        v: 1,
        name: ctx.name,
        policy: Schema.decodeUnknownSync(Policy)(ctx.policy),
        seq: 0,
        recovery: Recovery.cases.live.make({ process: ctx.process }),
        pending: null,
        attempt: null,
        build: ctx.build,
        restarts: [],
        observations: [],
        receipts: [],
        crashes: 0,
        healthyAt: ctx.at,
      }),
    [],
  ],
  update: {
    threw: (s, m) => {
      const action = exit({
        process: m.failure.process,
        id: `exit:${m.failure.process}`,
      });
      return [
        {
          ...s,
          seq: Math.max(s.seq, m.failure.seq),
          crashes: (s.crashes ?? 0) + 1,
          recovery: Recovery.cases.ending.make({ process: m.failure.process, failure: m.failure }),
          pending: action,
          attempt: null,
        },
        [action],
      ];
    },
    exited: (s, m) => {
      if (s.recovery._tag !== "ending") {
        return [s, []];
      }

      const { failure, process } = s.recovery;
      const crashes = s.crashes ?? 1;
      const wait = Math.min(s.policy.backoff.minMs * 2 ** Math.min(crashes - 1, 53), s.policy.backoff.maxMs);
      const until = m.at + wait;
      const why = crashWhy(failure);

      // Inside the restart budget the successor waits its backoff, and nothing goes down.
      if (canRestart(s.restarts, until, s.policy.periodMs, s.policy.intensity)) {
        const pending = start({ process, until });
        return [{ ...s, recovery: again(s, process, why), pending }, [pending]];
      }

      // The brake: N crashes in T. Down waits until the window has room again.
      const times = s.restarts.filter((at) => at >= until - s.policy.periodMs).toSorted((a, b) => a - b);
      const edge = times[times.length - s.policy.intensity];
      const held = edge === undefined ? until : Math.max(until, edge + s.policy.periodMs + 1);
      const pending = down({ process });
      return [
        {
          ...s,
          recovery: Recovery.cases.down.make({ process, why, crashes, until: held }),
          pending,
        },
        [pending],
      ];
    },
    due: (s, m) => {
      if (s.recovery._tag !== "down" || m.at < s.recovery.until) {
        return [s, []];
      }

      const pending = start({ process: s.recovery.process, until: s.recovery.until });
      return [{ ...s, recovery: again(s, s.recovery.process, s.recovery.why), pending }, [pending]];
    },
    started: (s, m) => [
      {
        ...s,
        recovery: Recovery.cases.live.make({ process: m.process }),
        pending: null,
        restarts: [...s.restarts, m.at],
        healthyAt: m.at,
      },
      [],
    ],
    healthy: (s, m) => [
      s.recovery._tag === "live" && m.at - (s.healthyAt ?? m.at) >= s.policy.backoff.resetAfterMs
        ? { ...s, crashes: 0, healthyAt: m.at }
        : s,
      [],
    ],
    // The runner advances the journal with checked lifecycle Msgs, after durability.
    exit_ok: pending,
    exit_err: pending,
    down_ok: pending,
    down_err: pending,
    start_ok: pending,
    start_err: pending,
  },
});
