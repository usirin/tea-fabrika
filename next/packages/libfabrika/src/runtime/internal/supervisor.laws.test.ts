// P34c slice 2, next/. One saved recovery journal: the `supervisor` machine owns it whole (0037, 0046).
// Laws J1, J3, J8, J10, J11 and J13 of the approved plan, on the real `init` and reducer.
//
// Test contract (the plan names the Msgs; their fields are fixed here, and the builder follows them):
// `supervisor.ts` exports `supervisor`, its model schema `Supervision` (saved version 2), `Policy` and
// `defaultPolicy`. Ctx stays `{policy, process, name, build, at}`. The model's only control field is
// `journal`, one of `idle`, `stepping`, `writing_dead`, `writing_exit`, `writing_down`,
// `waiting_recovery`, `waiting_start` and `checkpointing`, with the payloads the plan's sketch gives.
// Completed person restarts are `requests`. Msgs, each with tea's `type`:
//   received {receipt}, compacted {letter, digest}, limited {maxDeliveries: n | null}
//   begin {process, letter, build, phase, at}, finished {seq}
//   threw {seq, error, reason, from}, interrupted {process, letter, build, reason, from, at}
//   dead_written {seq}, exit_written {process, restarts, at, program}, down_written {process}
//   due {at, program, from}, started {id, process, at}, checkpointed {after, process, restarts, at}
//   adopted {process, build, restarts}, restart_requested {id, build, live, process, program, from}
//   healthy {at}
// A completion whose identity does not match the open work changes nothing.
//
// Generator contract: a fast-check decision tape, folded through the current model and a small
// process authority of the fold's own. Each cell picks one of the moves possible now. The oracle is
// the fold's own account (crashes, restart times, receipts, captured attempts), never the reducer.
import { applyCell } from "@demlik/tea";
import { describe, expect, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import * as fc from "fast-check";
import { expectTypeOf } from "vitest";
import { A, ExitReason, fcErrorClass, from } from "../../processes/Process.test-support.ts";
import { syncTest } from "../../Testing.ts";
import { Policy, Supervision, supervisor } from "./supervisor.ts";

const SEED = 119120;
const RUNS = 100;
const NAME = "counter:1";
const PROGRAM = "counter";
const BUILD = "build-a";

type Model = typeof Supervision.Type;
type Journal = Model["journal"];
type Msg = { readonly type: string; readonly [key: string]: unknown };

const pid = (n: number): string => `process_0000000000e00800${String(n).padStart(10, "0")}`;

const policy = {
  maxDeliveries: 3,
  intensity: 5,
  periodMs: 5000,
  backoff: { minMs: 100, maxMs: 800, resetAfterMs: 5000 },
};

const ctx = (p: typeof Policy.Type = policy) => ({ policy: p, process: A, name: NAME, build: BUILD, at: 0 });

const step = (model: Model, msg: Msg): Model => applyCell(supervisor, model, msg as never)[0];

const valid = (model: unknown): boolean => Schema.is(Supervision)(model);
const roundTrip = (model: Model): unknown => JSON.parse(JSON.stringify(Schema.encodeSync(Supervision)(model)));

/** JSON text with sorted keys: a decoded copy may order its fields differently. */
const canon = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => a.localeCompare(b)))
      : v,
  );

const decodes = (raw: unknown): boolean => Result.isSuccess(Schema.decodeUnknownResult(Supervision)(raw));

/** Accepted policies: every brake reachable (the waits of one window fit inside it). */
const policies: fc.Arbitrary<typeof Policy.Type> = fc
  .record({
    intensity: fc.integer({ min: 1, max: 6 }),
    deliveries: fc.integer({ min: 1, max: 6 }),
    minMs: fc.integer({ min: 1, max: 200 }),
    spread: fc.integer({ min: 0, max: 800 }),
    slack: fc.integer({ min: 1, max: 3000 }),
    reset: fc.integer({ min: 1, max: 8000 }),
  })
  .map(({ intensity, deliveries, minMs, spread, slack, reset }) => {
    const maxMs = minMs + spread;
    let total = 0;

    for (let n = 0; n < intensity; n++) {
      total += Math.min(minMs * 2 ** n, maxMs);
    }

    return Schema.decodeUnknownSync(Policy)({
      maxDeliveries: Math.min(deliveries, intensity),
      intensity,
      periodMs: total + slack,
      backoff: { minMs, maxMs, resetAfterMs: reset },
    });
  });

// Unbiased picks: fast-check leans small numbers toward the first move otherwise.
const Cell = fc.record({
  move: fc.noBias(fc.nat()),
  pick: fc.noBias(fc.nat()),
  gap: fc.integer({ min: 0, max: 3000 }),
  error: fcErrorClass.filter((e) => e.length <= 40),
});
type Cell = typeof Cell.Type;
const tapes = fc.array(Cell, { minLength: 1, maxLength: 80 });

const LETTERS = ["l1", "l2", "l3"] as const;

const COMPLETIONS = new Set([
  "finished",
  "threw",
  "dead_written",
  "exit_written",
  "down_written",
  "started",
  "checkpointed",
]);

/** What the fold knows from its own moves only. */
type World = {
  model: Model;
  at: number;
  pids: number;
  /** The authority's process for the name, and whether it is live. */
  process: string;
  live: boolean;
  /** Successor start times, as the process ledger would report them. */
  restarts: Array<number>;
  crashes: number;
  healthyAt: number;
  /** Fresh failure classes per letter, and the limit each letter was judged by. */
  errors: Map<string, Array<string>>;
  /** Captured attempts: seq, and each observation the fold expects. */
  captured: Set<number>;
  observations: number;
  /** Every completion sent, for stale replays. */
  sent: Array<Msg>;
  requests: Map<string, string>;
  limit: number | null;
  reached: Set<string>;
};

type Move = {
  readonly name: string;
  readonly msg: Msg;
  readonly stale?: boolean;
  readonly apply?: () => void;
  /** How many tape values pick this move: crashes need several steps, so they weigh more. */
  readonly weight?: number;
};

/** Each move once per unit of its weight, so a tape value picks among them. */
const weighted = (options: ReadonlyArray<Move>): ReadonlyArray<Move> =>
  options.flatMap((option) => Array.from({ length: option.weight ?? 1 }, () => option));

const reasonFor = (phase: "fresh" | "saved", error: string) =>
  ExitReason.cases.crashed.make({ phase: phase === "fresh" ? "step" : "saved_letter", error });

const receiptFor = (letter: string, process: string) => ({
  letter,
  input: { id: letter, m: { type: "poison", key: letter } },
  digest: `sha256:${letter}`,
  errors: [],
  tries: 0,
  result: null,
  process,
});

/** The smallest time at or after `t` with room in the window, by the fold's own search. */
const roomAt = (restarts: ReadonlyArray<number>, t: number, p: typeof Policy.Type): number => {
  const candidates = [t, ...restarts.map((r) => r + p.periodMs + 1)].filter((c) => c >= t).toSorted((a, b) => a - b);
  return candidates.find((c) => restarts.filter((r) => r >= c - p.periodMs).length + 1 <= p.intensity) ?? t;
};

/** The moves possible from the current journal and the fold's world. */
const moves = (w: World, cell: Cell): ReadonlyArray<Move> => {
  const j = w.model.journal;
  const meta = from();
  const old = w.sent.filter((m) => COMPLETIONS.has(m.type) && !sameWork(j, m));
  const stale = old.length === 0 ? [] : [{ name: "stale", msg: old[cell.pick % old.length]!, stale: true }];
  const later = { name: "advance", msg: { type: "healthy", at: w.at + cell.gap }, apply: () => (w.at += cell.gap) };

  switch (j._tag) {
    case "idle": {
      const letter = LETTERS[cell.pick % LETTERS.length]!;
      const receipt = w.model.receipts.find((r) => r.letter === letter);
      const fresh: Array<Move> =
        receipt === undefined
          ? [{ name: "received", weight: 4, msg: { type: "received", receipt: receiptFor(letter, j.process) } }]
          : [];
      const request = `restart-${cell.pick % 3}`;
      const compactable = w.model.receipts.find((r) => r.tries === 0 && r.input !== null);
      return [
        ...fresh,
        ...(receipt !== undefined && receipt.result === null
          ? [
              {
                name: "begin_fresh",
                weight: 6,
                msg: { type: "begin", process: j.process, letter, build: w.model.build, phase: "fresh", at: w.at },
              },
            ]
          : []),
        {
          name: "begin_saved",
          weight: 2,
          msg: {
            type: "begin",
            process: j.process,
            letter: `saved-${letter}`,
            build: w.model.build,
            phase: "saved",
            at: w.at,
          },
        },
        later,
        { name: "healthy", msg: { type: "healthy", at: w.at } },
        {
          name: "interrupted_activity",
          msg: {
            type: "interrupted",
            process: j.process,
            letter: `marker-${letter}`,
            build: w.model.build,
            reason: ExitReason.cases.crashed.make({ phase: "interrupted" }),
            from: meta,
            at: w.at,
          },
        },
        {
          name: "restart",
          msg: {
            type: "restart_requested",
            id: request,
            build: w.requests.get(request) ?? `build-${cell.pick % 2}`,
            live: w.live,
            process: w.process,
            program: PROGRAM,
            from: meta,
          },
        },
        ...(compactable === undefined
          ? []
          : [
              {
                name: "compacted",
                msg: { type: "compacted", letter: compactable.letter, digest: `sha256:${compactable.letter}` },
              },
            ]),
        { name: "limited", msg: { type: "limited", maxDeliveries: cell.gap % 3 === 0 ? null : 1 + (cell.gap % 4) } },
        ...stale,
      ];
    }
    case "stepping": {
      const seq = j.attempt.seq;
      return [
        { name: "finished", msg: { type: "finished", seq } },
        {
          name: "threw",
          weight: 4,
          msg: { type: "threw", seq, error: cell.error, reason: reasonFor(j.attempt.phase, cell.error), from: meta },
        },
        {
          name: "interrupted_attempt",
          msg: {
            type: "interrupted",
            process: j.attempt.process,
            letter: `marker-${cell.pick}`,
            build: j.attempt.build,
            reason: ExitReason.cases.crashed.make({ phase: "interrupted" }),
            from: meta,
            at: w.at + cell.gap,
          },
        },
        ...stale,
      ];
    }
    case "writing_dead":
      return [{ name: "dead_written", msg: { type: "dead_written", seq: j.failure.seq } }, ...stale];
    case "writing_exit":
      return [
        {
          name: "exit_written",
          msg: { type: "exit_written", process: j.process, restarts: [...w.restarts], at: w.at, program: PROGRAM },
          apply: () => {
            w.live = false;
          },
        },
        ...stale,
      ];
    case "writing_down":
      return [{ name: "down_written", msg: { type: "down_written", process: j.recovery.process } }, ...stale];
    case "waiting_recovery":
      return [
        later,
        { name: "due", msg: { type: "due", at: w.at, program: PROGRAM, from: meta } },
        {
          name: "adopted",
          msg: { type: "adopted", process: pid(w.pids + 1), build: BUILD, restarts: [...w.restarts, w.at] },
        },
        ...stale,
      ];
    case "waiting_start": {
      const until = j.timing._tag === "scheduled" ? j.timing.until : w.at;
      const ready = w.at >= until;
      return [
        later,
        ready
          ? { name: "started", msg: { type: "started", id: j.request.id, process: pid(w.pids + 1), at: w.at } }
          : { name: "started_early", msg: { type: "started", id: j.request.id, process: pid(w.pids + 1), at: w.at } },
        ...(j.timing._tag === "scheduled"
          ? [
              {
                name: "adopted",
                msg: { type: "adopted", process: pid(w.pids + 1), build: BUILD, restarts: [...w.restarts, w.at] },
              },
            ]
          : []),
        ...stale,
      ];
    }
    case "checkpointing":
      return [
        {
          name: "checkpointed",
          msg: { type: "checkpointed", after: j.after, process: j.process, restarts: [...w.restarts], at: w.at },
        },
        ...stale,
      ];
  }
};

type Observer = (before: Model, move: Move, after: Model, w: World) => void;

/** Folds one tape through the real machine, calling each observer after every step. */
const walk = (p: typeof Policy.Type, tape: ReadonlyArray<Cell>, observe: Observer): World => {
  const w: World = {
    model: supervisor.init(null, ctx(p))[0],
    at: 0,
    pids: 0,
    process: A,
    live: true,
    restarts: [],
    crashes: 0,
    healthyAt: 0,
    errors: new Map(),
    captured: new Set(),
    observations: 0,
    sent: [],
    requests: new Map(),
    limit: null,
    reached: new Set(),
  };

  for (const cell of tape) {
    const options = weighted(moves(w, cell));
    const move = options[cell.move % options.length]!;
    const before = w.model;
    move.apply?.();
    const after = step(before, move.msg);
    w.reached.add(after.journal._tag);
    w.reached.add(move.name);
    account(before, move, after, w, p);
    w.model = after;
    observe(before, move, after, w);

    if (!move.stale && move.name !== "advance") {
      w.sent.push(move.msg);
    }
  }

  return w;
};

/** Keeps the fold's own account. It reads only its own moves and which way the journal went. */
const account = (before: Model, move: Move, after: Model, w: World, p: typeof Policy.Type): void => {
  if (move.stale) {
    return;
  }

  const msg = move.msg;

  switch (move.name) {
    case "limited":
      w.limit = msg.maxDeliveries === null ? null : Number(msg.maxDeliveries);
      return;
    case "threw":
    case "interrupted_attempt":
    case "interrupted_activity": {
      if (before.journal._tag === "stepping") {
        const attempt = before.journal.attempt;

        if (w.captured.has(attempt.seq)) {
          return;
        }

        w.captured.add(attempt.seq);

        if (move.name === "threw" && attempt.phase === "fresh") {
          w.errors.set(attempt.letter, [...(w.errors.get(attempt.letter) ?? []), String(msg.error)]);
        }
      }

      if (move.name === "interrupted_activity" && after.journal._tag === "idle") {
        return;
      }

      w.observations++;
      w.crashes++;
      return;
    }
    case "restart": {
      if (!w.requests.has(String(msg.id)) && after !== before) {
        w.requests.set(String(msg.id), String(msg.build));
      }

      return;
    }
    case "started":
    case "adopted": {
      w.pids++;
      w.process = pid(w.pids);
      w.live = true;
      w.restarts.push(w.at);
      return;
    }
    case "checkpointed":
      w.healthyAt = w.at;
      return;
    case "advance":
    case "healthy":
      if (before.journal._tag === "idle" && w.at - w.healthyAt >= p.backoff.resetAfterMs) {
        w.crashes = 0;
        w.healthyAt = w.at;
      }

      return;
  }
};

describe("P34c slice 2: one saved recovery journal", () => {
  // p80, kept from P34: a refused policy never changes the caller's bytes; the default decodes.
  it("p80: rejected settings leave the caller's bytes alone, for generated invalid policies", () => {
    const invalid = fc.oneof(
      fc.constantFrom(0, 33, 1.5).map((maxDeliveries) => ({ ...policy, maxDeliveries })),
      fc.integer({ max: 0 }).map((periodMs) => ({ ...policy, periodMs })),
      fc.integer({ min: 801, max: 5000 }).map((minMs) => ({ ...policy, backoff: { ...policy.backoff, minMs } })),
      fc.integer({ max: 0 }).map((resetAfterMs) => ({ ...policy, backoff: { ...policy.backoff, resetAfterMs } })),
      fc.integer({ min: 1, max: 2 }).map((intensity) => ({ ...policy, intensity })),
      fc.integer({ min: 1, max: 1500 }).map((periodMs) => ({ ...policy, periodMs })),
    );
    fc.assert(
      fc.property(invalid, (candidate) => {
        const bytes = JSON.stringify(candidate);
        expect(() => Schema.decodeUnknownSync(Policy)(candidate)).toThrow();
        expect(JSON.stringify(candidate)).toBe(bytes);
      }),
      { seed: SEED, numRuns: RUNS },
    );
    expect(Schema.decodeUnknownSync(Policy)(policy)).toEqual(policy);
  });

  // J1. Every reached and saved journal is legal; a mutation of a reached state is refused.
  // Plant: admit a dead state without its terminal receipt, or a checkpoint without its predecessor.
  it("J1: every reached journal decodes; a reached state with a broken tag, payload or identity is refused", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(policies, tapes, fc.nat(), (p, tape, pick) => {
        const reached: Array<Model> = [];
        const w = walk(p, tape, (_before, _move, after) => {
          expect(valid(after), `reached ${after.journal._tag}`).toBe(true);
          expect(decodes(roundTrip(after))).toBe(true);

          for (const field of ["pending", "attempt", "recovery", "restart"]) {
            expect(after, "the journal is the only control field").not.toHaveProperty(field);
          }

          reached.push(after);
        });

        for (const tag of w.reached) {
          seen.add(tag);
        }

        // Every reached state is mutated, so the rare ones (dead work, a checkpoint) are too.
        for (const target of reached) {
          for (const value of mutations(roundTrip(target), pick)) {
            expect(decodes(value), `mutated ${target.journal._tag} must be refused`).toBe(false);
          }
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );

    for (const tag of [
      "stepping",
      "writing_dead",
      "writing_exit",
      "writing_down",
      "waiting_recovery",
      "waiting_start",
      "checkpointing",
    ]) {
      expect(seen.has(tag), `the fold reaches ${tag}`).toBe(true);
    }
  });

  // J3. One captured attempt makes at most one observation and one delivery charge, however many
  // times its failure is reported (the Activity marker and the saved attempt both say stepping).
  // Plant: count Activity and the saved attempt separately.
  it("J3: one attempt, one observation and one charge; a repeated report of it changes nothing", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(policies, tapes, (p, tape) => {
        const w = walk(p, tape, (before, move, after, w) => {
          expect(after.observations, "observations match the captured attempts").toHaveLength(w.observations);

          for (const [letter, errors] of w.errors) {
            const receipt = after.receipts.find((r) => r.letter === letter);
            expect(receipt?.errors, `letter ${letter}'s classes`).toEqual(errors);
            expect(receipt?.tries).toBe(errors.length);
          }

          // p80: a fresh throw at its letter's limit writes dead for that exact failure, and only then.
          if (move.name === "threw" && before.journal._tag === "stepping" && before.journal.attempt.phase === "fresh") {
            const attempt = before.journal.attempt;
            const tries = w.errors.get(attempt.letter)?.length ?? 0;
            const terminal = tries >= (w.limit ?? p.maxDeliveries);
            const receipt = after.receipts.find((r) => r.letter === attempt.letter);
            expect(receipt?.result ?? null).toEqual(terminal ? { _tag: "refused", reason: "dead" } : null);
            expect(receipt?.process).toBe(attempt.process);
            expect(after.journal).toMatchObject(
              terminal
                ? {
                    _tag: "writing_dead",
                    failure: {
                      _tag: "fresh",
                      process: attempt.process,
                      letter: attempt.letter,
                      build: attempt.build,
                      seq: attempt.seq,
                      error: move.msg.error,
                    },
                  }
                : { _tag: "writing_exit", process: attempt.process, origin: { _tag: "crash" } },
            );
          }

          // A second report of a captured attempt, from either source, is a no-op.
          if (before.journal._tag === "stepping" && after.journal._tag !== "stepping" && move.name !== "finished") {
            const seq = before.journal.attempt.seq;
            const again = step(after, {
              type: "interrupted",
              process: before.journal.attempt.process,
              letter: before.journal.attempt.letter,
              build: before.journal.attempt.build,
              reason: ExitReason.cases.crashed.make({ phase: "interrupted" }),
              from: from(),
              at: w.at,
            });
            const threw = step(after, {
              type: "threw",
              seq,
              error: "TypeError",
              reason: reasonFor("fresh", "TypeError"),
              from: from(),
            });
            expect(again).toEqual(after);
            expect(threw).toEqual(after);
            const observation = after.observations.find((o) => o.seq === seq);
            expect(observation, "the journal's identity wins over the marker's").toMatchObject({
              letter: before.journal.attempt.letter,
              process: before.journal.attempt.process,
            });
          }
        });

        for (const tag of w.reached) {
          seen.add(tag);
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
    expect(seen.has("threw") && seen.has("interrupted_attempt") && seen.has("interrupted_activity")).toBe(true);
  });

  // J8 / p80. Backoff, brake, deadline and healthy reset are what they were before the journal.
  // Plant: start before the deadline, omit the counted window edge, or reset crashes early.
  it("J8: every wait is its backoff, down only at the brake, never a start before the deadline, reset only when healthy", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(policies, tapes, (p, tape) => {
        const w = walk(p, tape, (before, move, after, w) => {
          // The crash count is the fold's own: one per captured failure, back to 0 only after a
          // healthy interval while idle.
          expect(after.crashes, "crashes follow the fold's account").toBe(w.crashes);

          if (move.stale) {
            return;
          }

          if (move.name === "exit_written" && before.journal._tag === "writing_exit") {
            if (before.journal.origin._tag === "manual") {
              expect(after.journal).toMatchObject({ _tag: "waiting_start", timing: { _tag: "immediate" } });
              return;
            }

            const wait = Math.min(p.backoff.minMs * 2 ** Math.min(w.crashes - 1, 53), p.backoff.maxMs);
            const earliest = w.at + wait;
            const room = roomAt(w.restarts, earliest, p);

            if (room === earliest) {
              expect(after.journal, `crash ${w.crashes} is inside the budget`).toMatchObject({
                _tag: "waiting_start",
                timing: { _tag: "scheduled", until: earliest },
              });
            } else {
              expect(after.journal, `crash ${w.crashes} trips the brake`).toMatchObject({
                _tag: "writing_down",
                recovery: { process: before.journal.process, crashes: w.crashes, until: room },
              });
            }
          }

          if (move.name === "due" && before.journal._tag === "waiting_recovery") {
            const until = before.journal.recovery.until;
            expect(after.journal).toMatchObject(
              w.at >= until ? { _tag: "waiting_start", timing: { _tag: "scheduled", until } } : before.journal,
            );
          }

          if (move.name === "started_early" || (move.name === "advance" && before.journal._tag !== "idle")) {
            expect(after).toEqual(before);
          }
        });

        for (const tag of w.reached) {
          seen.add(tag);
        }
      }),
      {
        seed: SEED,
        numRuns: RUNS,
        // T271 decision check: one crash inside the budget wrote a down event.
        examples: [
          [
            Schema.decodeUnknownSync(Policy)({
              ...policy,
              maxDeliveries: 1,
              backoff: { ...policy.backoff, resetAfterMs: 1_000_000 },
            }),
            // received, begin fresh, threw (dead at limit 1), dead written, exit written.
            [0, 0, 1, 0, 0].map((move) => ({ move, pick: 0, gap: 0, error: "TypeError" })),
          ],
        ],
      },
    );

    for (const tag of ["writing_down", "waiting_recovery", "started", "started_early", "adopted"]) {
      expect(seen.has(tag), `the fold reaches ${tag}`).toBe(true);
    }
  });

  // J10. A stale or duplicate completion cannot advance another operation.
  // Plant: apply a completion without checking its identity.
  it("J10: a completion of earlier work, replayed against the current journal, changes nothing", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(policies, tapes, (p, tape) => {
        const w = walk(p, tape, (before, move, after) => {
          expect(
            move.stale === true && canon(after) !== canon(before),
            `a stale ${move.msg.type} changed the journal`,
          ).toBe(false);

          if (move.stale) {
            seen.add("stale_completion");
          }
        });

        for (const tag of w.reached) {
          seen.add(tag);
        }
      }),
      { seed: SEED, numRuns: RUNS },
    );
    expect(seen.has("stale_completion")).toBe(true);
  });

  // J11. Saving at any prefix and resuming equals the fold that never stopped.
  // Plant: omit origin, deadline or successor from the saved model.
  it("J11: the saved journal at every prefix resumes to the same models as the unbroken fold", () => {
    fc.assert(
      fc.property(policies, tapes, (p, tape) => {
        const msgs: Array<Msg> = [];
        walk(p, tape, (_before, move) => {
          msgs.push(move.msg);
        });
        syncTest(supervisor, ctx(p), {
          msgs: msgs as never,
          seed: SEED,
          encode: (model) => Schema.encodeSync(Supervision)(model),
          decode: (raw) => Schema.decodeUnknownSync(Supervision)(raw),
          equals: (a, b) => canon(a) === canon(b),
        });
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});

/** Invalid copies of one saved model: a wrong tag, a missing payload, an old version, a broken identity. */
const mutations = (saved: unknown, pick: number): ReadonlyArray<unknown> => {
  const raw = saved as { journal: Record<string, unknown>; receipts: Array<Record<string, unknown>> };
  const journal = raw.journal;
  const fields = Object.keys(journal).filter((key) => key !== "_tag");
  const dropped = fields[pick % Math.max(fields.length, 1)];
  const broken: Array<unknown> = [
    { ...raw, journal: { ...journal, _tag: "starting" } },
    { ...raw, journal: Object.fromEntries(Object.entries(journal).filter(([key]) => key !== dropped)) },
    { ...raw, v: 1 },
  ];

  if (journal._tag === "writing_dead") {
    const failure = journal.failure as { letter: string };
    // The exact fresh failure's receipt must be there, terminal and its own.
    broken.push({ ...raw, receipts: raw.receipts.filter((r) => r.letter !== failure.letter) });
    broken.push({
      ...raw,
      receipts: raw.receipts.map((r) => (r.letter === failure.letter ? { ...r, result: null } : r)),
    });
    broken.push({
      ...raw,
      receipts: raw.receipts.map((r) => (r.letter === failure.letter ? { ...r, process: pid(39) } : r)),
    });
  }

  if (journal._tag === "checkpointing") {
    broken.push({ ...raw, journal: Object.fromEntries(Object.entries(journal).filter(([key]) => key !== "after")) });
  }

  if (journal._tag === "stepping") {
    broken.push({ ...raw, journal: { ...journal, attempt: { ...(journal.attempt as object), seq: 0 } } });
  }

  return broken;
};

/** Whether a completion names the work the journal holds now. */
const sameWork = (j: Journal, msg: Msg): boolean => {
  switch (msg.type) {
    case "finished":
      return j._tag === "stepping" && j.attempt.seq === msg.seq;
    case "dead_written":
      return j._tag === "writing_dead" && j.failure.seq === msg.seq;
    case "exit_written":
      return j._tag === "writing_exit" && j.process === msg.process;
    case "down_written":
      return j._tag === "writing_down" && j.recovery.process === msg.process;
    case "started":
      return j._tag === "waiting_start" && j.request.id === msg.id;
    case "checkpointed":
      return j._tag === "checkpointing" && j.after === msg.after && j.process === msg.process;
    default:
      return false;
  }
};

// J13 (type). A journal case carries what it uses: tsc checks these uncalled lines.
// Plant: make the checkpoint's predecessor optional, or allow an attempt beside every state.
const j13 = () => {
  expectTypeOf<Extract<Journal, { _tag: "checkpointing" }>["after"]>().toEqualTypeOf<string>();
  expectTypeOf<Extract<Journal, { _tag: "checkpointing" }>["process"]>().toEqualTypeOf<string>();
  expectTypeOf<Model>().not.toHaveProperty("pending");
  expectTypeOf<Model>().not.toHaveProperty("attempt");
  expectTypeOf<Model>().not.toHaveProperty("recovery");
  expectTypeOf<Model>().not.toHaveProperty("restart");
  expectTypeOf<Extract<Journal, { _tag: "idle" }>>().not.toHaveProperty("attempt");
  expectTypeOf<Extract<Journal, { _tag: "writing_dead" }>["failure"]["_tag"]>().toEqualTypeOf<"fresh">();
};

void j13;
