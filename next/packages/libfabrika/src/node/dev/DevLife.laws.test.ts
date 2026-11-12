// T708, next/. The dev server's life is one tea machine; every law walks its real reducer from init.
// The walk reads the folded state before it picks each move (0093), and an independent reference
// written from the plan's transition table checks each step.
import { applyCell } from "@demlik/tea";
import { Predicate, Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { DevState } from "./DevLife.ts";
import { address, devLife, pending, target } from "./DevLife.ts";

const SEED = 119120;
type State = typeof DevState.Type;
type Msg = typeof devLife.msg.Type;
type Phase = State["_tag"];
type Case<T extends Phase> = Extract<State, { readonly _tag: T }>;

// Type law, checked by tsc: only a running process holds a pid, and a replacement token lives only
// where an exit put it. The negative checks are not vacuous: the positive ones name the same fields.
expectTypeOf<Case<"spawned">>().toHaveProperty("pid");
expectTypeOf<Case<"online">>().toHaveProperty("pid");
expectTypeOf<Case<"starting">>().not.toHaveProperty("pid");
expectTypeOf<Case<"listening">>().not.toHaveProperty("pid");
expectTypeOf<Case<"exited">>().not.toHaveProperty("pid");
expectTypeOf<Case<"waiting">>().not.toHaveProperty("pid");
expectTypeOf<Case<"braked">>().not.toHaveProperty("pid");
expectTypeOf<Case<"stopping">>().not.toHaveProperty("pid");
expectTypeOf<Case<"stopped">>().not.toHaveProperty("pid");
expectTypeOf<Parameters<typeof DevState.cases.exited.make>[0]>().not.toHaveProperty("pid");
expectTypeOf<Parameters<typeof DevState.cases.waiting.make>[0]>().not.toHaveProperty("pid");
expectTypeOf<Parameters<typeof DevState.cases.braked.make>[0]>().not.toHaveProperty("pid");
expectTypeOf<Case<"exited">>().toHaveProperty("replacement");
expectTypeOf<Case<"waiting">>().toHaveProperty("replacement");
expectTypeOf<Case<"starting">>().not.toHaveProperty("replacement");
expectTypeOf<Case<"listening">>().not.toHaveProperty("replacement");
expectTypeOf<Case<"braked">>().not.toHaveProperty("replacement");
expectTypeOf<Case<"stopped">>().not.toHaveProperty("replacement");
expectTypeOf(address).returns.toEqualTypeOf<number | null>();
expectTypeOf(target).returns.toEqualTypeOf<number | null>();
expectTypeOf(pending).returns.toEqualTypeOf<string | null>();

// Disjoint ranges, so a number found in a state names what it is.
const PIDS = { min: 30_000, max: 39_999 };
const PORTS = { min: 40_000, max: 49_999 };

const Choice = fc.record({
  pick: fc.nat(),
  // One move in ten is a late message of any kind, legal in this state or not.
  late: fc.integer({ min: 0, max: 9 }),
  port: fc.oneof(fc.constant(0), fc.integer(PORTS)),
  pid: fc.integer(PIDS),
  build: fc.string({ maxLength: 6 }).map((text) => `build:${text}`),
  at: fc.integer({ min: 1_000_000_000, max: 1_999_999_999 }),
  until: fc.integer({ min: 2_000_000_000, max: 2_999_999_999 }),
  reason: fc.constantFrom("intensity", "restart_failed", "stop"),
});
type Choice = typeof Choice extends fc.Arbitrary<infer A> ? A : never;

const Walk = fc.record({
  last: fc.option(
    fc.integer({ min: 0, max: 99 }).map((n) => `last-${n}`),
    { nil: null },
  ),
  choices: fc.array(Choice, { minLength: 1, maxLength: 60 }),
});
type Walk = typeof Walk extends fc.Arbitrary<infer A> ? A : never;

type Kind = Msg["type"];
const kinds: ReadonlyArray<Kind> = ["listened", "started", "exited", "waiting", "braked", "stop", "stopped"];

// The plan's table, as the moves each state can really receive. Stop and brake are rarer, so a walk
// reaches deep states before it ends.
const legal: Record<Phase, ReadonlyArray<readonly [Kind, number]>> = {
  starting: [
    ["listened", 4],
    ["started", 4],
    ["braked", 1],
    ["stop", 1],
  ],
  listening: [
    ["listened", 4],
    ["started", 4],
    ["braked", 1],
    ["stop", 1],
  ],
  spawned: [
    ["listened", 4],
    ["started", 1],
    ["exited", 4],
    ["braked", 1],
    ["stop", 1],
  ],
  online: [
    ["listened", 2],
    ["started", 1],
    ["exited", 4],
    ["braked", 1],
    ["stop", 1],
  ],
  exited: [
    ["listened", 3],
    ["started", 3],
    ["waiting", 4],
    ["braked", 2],
    ["stop", 1],
  ],
  waiting: [
    ["listened", 3],
    ["started", 4],
    ["braked", 2],
    ["stop", 1],
  ],
  braked: [
    ["listened", 2],
    ["stop", 2],
  ],
  stopping: [
    ["listened", 1],
    ["stopped", 3],
  ],
  stopped: [],
};

const message = (kind: Kind, c: Choice, index: number): Msg => {
  if (kind === "listened") {
    return { type: "listened", port: c.port };
  }

  if (kind === "started") {
    return { type: "started", start: `start-${index}`, pid: c.pid, build: c.build, at: c.at };
  }

  if (kind === "exited") {
    return { type: "exited", replacement: `token-${index}` };
  }

  if (kind === "waiting") {
    return { type: "waiting", until: c.until, reason: c.reason };
  }

  if (kind === "braked") {
    return { type: "braked", reason: c.reason };
  }

  return { type: kind };
};

const choose = (phase: Phase, c: Choice, index: number): Msg => {
  const moves = legal[phase];

  if (c.late === 0 || moves.length === 0) {
    return message(kinds[c.pick % kinds.length]!, c, index);
  }

  const total = moves.reduce((sum, [, weight]) => sum + weight, 0);
  let left = c.pick % total;

  for (const [kind, weight] of moves) {
    if (left < weight) {
      return message(kind, c, index);
    }

    left -= weight;
  }

  return message(moves[0]![0], c, index);
};

// The reference: what each state means, written from the plan's table and main's behavior.
type Ref = {
  readonly phase: Phase;
  readonly port: number | null;
  readonly pid: number | null;
  readonly token: string | null;
  readonly start: string | null;
  readonly after: string | null;
  readonly last: string | null;
};

type Settled = "completed" | "failed" | "discarded" | null;

const active = (phase: Phase) => phase !== "braked" && phase !== "stopping" && phase !== "stopped";
const known = (port: number) => (port === 0 ? null : port);

const reference = (ref: Ref, msg: Msg): readonly [Ref, Settled] => {
  const { phase } = ref;

  if (msg.type === "listened") {
    const port = known(msg.port);
    // Main's callback completes any pending replacement, whatever the phase, zero port included.
    const done = ref.token === null ? null : "completed";

    if (phase === "starting" || phase === "listening") {
      return [{ ...ref, phase: port === null ? "starting" : "listening", port }, null];
    }

    if (phase === "spawned" || phase === "online") {
      return [{ ...ref, phase: port === null ? "spawned" : "online", port, token: null }, done];
    }

    if (phase === "stopped") {
      return [ref, null];
    }

    return [{ ...ref, port, token: null }, done];
  }

  if (msg.type === "started") {
    if (!active(phase)) {
      return [ref, null];
    }

    // The event links to the start before it, or to the last durable start the driver read.
    const up = ref.port === null ? "spawned" : "online";
    return [{ ...ref, phase: up, pid: msg.pid, start: msg.start, after: ref.start ?? ref.last }, null];
  }

  if (msg.type === "exited") {
    return phase === "spawned" || phase === "online"
      ? [{ ...ref, phase: "exited", pid: null, token: msg.replacement }, null]
      : [ref, null];
  }

  if (msg.type === "waiting") {
    return phase === "exited" ? [{ ...ref, phase: "waiting" }, null] : [ref, null];
  }

  if (msg.type === "braked") {
    return active(phase)
      ? [{ ...ref, phase: "braked", pid: null, token: null }, ref.token === null ? null : "failed"]
      : [ref, null];
  }

  if (msg.type === "stop") {
    return phase === "stopping" || phase === "stopped" ? [ref, null] : [{ ...ref, phase: "stopping", pid: null }, null];
  }

  return phase === "stopping"
    ? [{ ...ref, phase: "stopped", token: null }, ref.token === null ? null : "discarded"]
    : [ref, null];
};

// Every number and string a state holds, whatever its field names.
const leaves = (value: unknown): ReadonlyArray<unknown> =>
  Predicate.isObject(value) ? Object.values(value).flatMap(leaves) : [value];

const pids = (s: State) => leaves(s).filter((v) => Predicate.isNumber(v) && v >= PIDS.min && v <= PIDS.max);

type Step = {
  readonly index: number;
  readonly prev: State;
  readonly msg: Msg;
  readonly next: State;
  readonly before: Ref;
  readonly ref: Ref;
  readonly settled: Settled;
  readonly choice: Choice;
};

const isState = Schema.is(devLife.model);

// The one shared walk: each move is chosen from the state the fold has reached.
const walk = (w: Walk, visit: (step: Step) => void) => {
  const [initial, cmds] = devLife.init(null, { last: w.last });
  expect(cmds).toEqual([]);
  expect(isState(initial)).toBe(true);
  let s = initial;
  let ref: Ref = { phase: "starting", port: null, pid: null, token: null, start: null, after: null, last: w.last };

  for (const [index, choice] of w.choices.entries()) {
    const msg = choose(s._tag, choice, index);
    const [next, out] = applyCell(devLife, s, msg);
    expect(out).toEqual([]);
    const [after, settled] = reference(ref, msg);
    visit({ index, prev: s, msg, next, before: ref, ref: after, settled, choice });
    s = next;
    ref = after;
  }
};

const coverage = () => ({
  partial: 0,
  callback: 0,
  failed: 0,
  late: 0,
  stopped: 0,
});

const covered = (seen: ReturnType<typeof coverage>) => {
  for (const [name, count] of Object.entries(seen)) {
    expect(count, `walks reached ${name}`).toBeGreaterThan(0);
  }
};

const count = (seen: ReturnType<typeof coverage>, step: Step) => {
  if (step.ref.phase === "listening" || step.ref.phase === "spawned") {
    seen.partial++;
  }

  if (step.settled === "completed") {
    seen.callback++;
  }

  if (step.settled === "failed") {
    seen.failed++;
  }

  if (step.before.phase === "stopping" && step.msg.type !== "stopped" && step.msg.type !== "listened") {
    seen.late++;
  }

  if (step.ref.phase === "stopped") {
    seen.stopped++;
  }
};

describe("T708 dev life laws", () => {
  it("every transition preserves the state-specific fields and sampling eligibility", () => {
    const seen = coverage();
    fc.assert(
      fc.property(Walk, (w) => {
        walk(w, (step) => {
          count(seen, step);
          const { next, ref } = step;
          expect(isState(next)).toBe(true);
          expect(next._tag).toBe(ref.phase);

          // A finished stop may forget its listener; every other state answers calls with it.
          if (ref.phase !== "stopped") {
            expect(address(next)).toBe(ref.port);
          }

          expect(pending(next)).toBe(ref.token);
          // Only a live process is a sample target, and no other state hides its pid.
          expect(target(next)).toBe(ref.phase === "spawned" || ref.phase === "online" ? ref.pid : null);
          expect(pids(next)).toEqual(ref.phase === "spawned" || ref.phase === "online" ? [ref.pid] : []);

          // A process keeps its start and the start before it for the driver's events.
          if (ref.start !== null && ref.phase !== "stopped") {
            expect(leaves(next)).toContain(ref.start);
          }

          if ((ref.phase === "spawned" || ref.phase === "online") && ref.after !== null) {
            expect(leaves(next)).toContain(ref.after);
          }
        });
      }),
      { seed: SEED, numRuns: 100 },
    );
    covered(seen);
  });

  it("either startup order yields the same usable process and listener", () => {
    let both = 0;
    fc.assert(
      fc.property(Walk, (w) => {
        walk(w, ({ index, prev, choice }) => {
          if (!active(prev._tag)) {
            return;
          }

          both++;
          const started = message("started", choice, index);
          const listened = message("listened", choice, index);
          const [first] = applyCell(devLife, applyCell(devLife, prev, started)[0], listened);
          const [second] = applyCell(devLife, applyCell(devLife, prev, listened)[0], started);
          const usable = (s: State) => ({ _tag: s._tag, address: address(s), target: target(s), pending: pending(s) });
          expect(usable(first)).toEqual(usable(second));
          expect(usable(first)).toEqual({
            _tag: choice.port === 0 ? "spawned" : "online",
            address: known(choice.port),
            target: choice.pid,
            pending: null,
          });
        });
      }),
      { seed: SEED, numRuns: 100 },
    );
    expect(both).toBeGreaterThan(0);
  });

  it("replacement completion belongs to the listener callback; braking fails the pending wait once", () => {
    const seen = coverage();
    fc.assert(
      fc.property(Walk, (w) => {
        const settled = new Set<string>();
        walk(w, (step) => {
          count(seen, step);
          const { prev, msg, next } = step;
          const was = pending(prev);
          const now = pending(next);
          expect(now).toBe(step.ref.token);

          if (msg.type === "started" || msg.type === "waiting" || msg.type === "stop") {
            // A start notification is not the replacement's listener.
            expect(now).toBe(was);
          }

          if (was !== null && now !== was) {
            // Only the listener completes, a brake fails, a finished stop discards, and a new exit
            // replaces the token as main does.
            const ways: Partial<Record<Kind, Settled>> = {
              listened: "completed",
              braked: "failed",
              stopped: "discarded",
              exited: null,
            };
            const way = ways[msg.type];
            expect(way).not.toBeUndefined();
            expect(step.settled).toBe(way);
            // One settlement per token: a late brake or listener finds nothing left to settle.
            expect(settled.has(was)).toBe(false);
            settled.add(was);
          }

          if (msg.type === "braked" && active(prev._tag)) {
            expect(now).toBeNull();
          }
        });
      }),
      { seed: SEED, numRuns: 100 },
    );
    covered(seen);
  });

  it("shutdown blocks queued lifecycle work and sampling while preserving final recording", () => {
    const seen = coverage();
    fc.assert(
      fc.property(Walk, (w) => {
        walk(w, (step) => {
          count(seen, step);
          const { prev, msg, next, before } = step;
          // Only a stop enters shutdown, and nothing leaves it but its own finish.
          expect(next._tag === "stopping" || next._tag === "stopped").toBe(
            msg.type === "stop" || before.phase === "stopping" || before.phase === "stopped",
          );

          if (msg.type === "stop" && before.phase !== "stopping" && before.phase !== "stopped") {
            expect(next._tag).toBe("stopping");
            // The final stopped event needs the last start and the listener the calls still use.
            expect(address(next)).toBe(address(prev));

            if (before.start !== null) {
              expect(leaves(next)).toContain(before.start);
            }
          }

          if (prev._tag === "stopping" || prev._tag === "stopped") {
            expect(target(next)).toBeNull();

            if (msg.type !== "listened" && !(prev._tag === "stopping" && msg.type === "stopped")) {
              // Queued lifecycle work and a second stop change nothing.
              expect(next).toEqual(prev);
            }
          }
        });
      }),
      { seed: SEED, numRuns: 100 },
    );
    covered(seen);
  });
});
