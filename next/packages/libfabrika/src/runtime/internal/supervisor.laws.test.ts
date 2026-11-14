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
//   swapped {process, build} (P15 slice 1): the process took new code while idle
// A completion whose identity does not match the open work changes nothing.
//
// Generator contract: a fast-check decision tape, folded through the current model and a small
// process authority of the fold's own. Each cell picks one of the moves possible now. The oracle is
// the fold's own account (crashes, restart times, receipts, captured attempts), never the reducer.
import { applyCell } from "@demlik/tea";
import { propertyTrace } from "@demlik/tea/pbt";
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
/** A process no fold creates. */
const FOREIGN = pid(9_999_999_999);

const policy = {
  maxDeliveries: 3,
  intensity: 5,
  periodMs: 5000,
  backoff: { minMs: 100, maxMs: 800, resetAfterMs: 5000 },
};

const ctx = (p: typeof Policy.Type = policy) => ({ policy: p, process: A, name: NAME, build: BUILD, at: 0 });

const step = (model: Model, msg: Msg): Model => applyCell(supervisor, model, msg as never)[0];

const valid = (model: unknown): boolean => Schema.is(Supervision)(model);

const roundTrip = (model: Model): unknown =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(JSON.stringify(Schema.encodeSync(Supervision)(model)));

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
    intensity: fc.integer({ min: 1, max: 8 }),
    deliveries: fc.integer({ min: 1, max: 6 }),
    minMs: fc.integer({ min: 1, max: 200 }),
    spread: fc.integer({ min: 0, max: 800 }),
    slack: fc.integer({ min: 1, max: 5000 }),
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
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;
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

/** The moves possible from the current journal and the fold's world, with P15's `swapped` when asked. */
const moves = (w: World, cell: Cell, swaps = false): ReadonlyArray<Move> => {
  const all = journalMoves(w, cell);

  if (!swaps) {
    return all;
  }

  // The runner begins a fresh step only for a letter not yet accepted; a compacted receipt was
  // (finding 2026-11-11-supervisor-walk-begins-compacted-letter), so this walk does not offer it.
  const base = all.filter(
    (m) => m.name !== "begin_fresh" || w.model.receipts.some((r) => r.letter === m.msg.letter && r.input !== null),
  );

  // A swap names the process the journal holds, or one it does not, with a build the fold makes.
  const j = w.model.journal;
  const own =
    j._tag === "idle"
      ? j.process
      : j._tag === "stepping"
        ? j.attempt.process
        : j._tag === "writing_exit"
          ? j.process
          : w.process;
  const build = `build-swap-${cell.pick % 4}`;
  return [
    ...base,
    { name: "swapped", weight: 3, msg: { type: "swapped", process: own, build } },
    { name: "swapped_foreign", msg: { type: "swapped", process: FOREIGN, build } },
  ];
};

const journalMoves = (w: World, cell: Cell): ReadonlyArray<Move> => {
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
    case "swapping":
      return [{ name: "swap_completed", msg: { type: "swap_completed", load: j.change.load } }, ...stale];
    case "checking":
      return [
        {
          name: "admitted",
          msg: { type: "admitted", seq: j.attempt.seq, receipt: receiptFor(j.attempt.letter, j.attempt.process) },
        },
        {
          name: "check_threw",
          weight: 4,
          msg: {
            type: "check_threw",
            seq: j.attempt.seq,
            receipt: receiptFor(j.attempt.letter, j.attempt.process),
            error: cell.error,
            reason: reasonFor("fresh", cell.error),
            from: meta,
          },
        },
        ...stale,
      ];
    case "writing_reply":
      return [{ name: "reply_written", msg: { type: "reply_written", seq: j.attempt.seq } }, ...stale];
    case "clearing_attempt":
      return [{ name: "attempt_cleared", msg: { type: "attempt_cleared", seq: j.attempt.seq } }, ...stale];
    case "writing_dead":
      return [{ name: "dead_written", msg: { type: "dead_written", seq: j.failure.seq } }, ...stale];
    case "writing_exit": {
      // The exit lands 0 to 50 ms after the throw, so a wait counted from the throw shows.
      const late = cell.gap % 51;
      return [
        {
          name: "exit_written",
          msg: {
            type: "exit_written",
            process: j.process,
            restarts: [...w.restarts],
            at: w.at + late,
            program: PROGRAM,
          },
          apply: () => {
            w.live = false;
            w.at += late;
          },
        },
        ...stale,
      ];
    }
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
const walk = (p: typeof Policy.Type, tape: ReadonlyArray<Cell>, observe: Observer, swaps = false): World => {
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
    const options = weighted(moves(w, cell, swaps));
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
    case "check_threw":
    case "interrupted_attempt":
    case "interrupted_activity": {
      if (before.journal._tag === "stepping" || before.journal._tag === "checking") {
        const attempt = before.journal.attempt;

        if (w.captured.has(attempt.seq)) {
          return;
        }

        w.captured.add(attempt.seq);

        if ((move.name === "threw" || move.name === "check_threw") && attempt.phase === "fresh") {
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
      fc.integer({ max: 0 }).map((minMs) => ({ ...policy, backoff: { ...policy.backoff, minMs } })),
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
      {
        seed: SEED,
        numRuns: RUNS,
        // pinned: P34's list refused a zero first wait; a zero backoff would restart in a hot loop.
        examples: [[{ ...policy, backoff: { ...policy.backoff, minMs: 0 } }]],
      },
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
          if ("origin" in target.journal) {
            seen.add(`${target.journal.origin._tag} ${target.journal._tag}`);
          }

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
      "crash writing_exit",
      "crash writing_down",
      "crash waiting_recovery",
      "crash waiting_start",
      "crash checkpointing",
      "manual waiting_start",
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
          if (
            (move.name === "threw" || move.name === "check_threw") &&
            (before.journal._tag === "stepping" || before.journal._tag === "checking") &&
            before.journal.attempt.phase === "fresh"
          ) {
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
          if (
            (before.journal._tag === "stepping" || before.journal._tag === "checking") &&
            after.journal._tag !== "stepping" &&
            after.journal._tag !== "checking" &&
            move.name !== "finished"
          ) {
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
            // Backoff and the brake's deadline count from the exit's time, never the throw's.
            expect(move.msg.at, "the fold's clock is the exit's").toBe(w.at);

            if (before.journal.origin._tag === "manual") {
              expect(after.journal).toMatchObject({ _tag: "waiting_start", timing: { _tag: "immediate" } });
              return;
            }

            const wait = Math.min(p.backoff.minMs * 2 ** Math.min(w.crashes - 1, 53), p.backoff.maxMs);
            const earliest = w.at + wait;
            const opening = roomAt(w.restarts, earliest, p);

            if (opening === earliest) {
              expect(after.journal, `crash ${w.crashes} is inside the budget`).toMatchObject({
                _tag: "waiting_start",
                timing: { _tag: "scheduled", until: earliest },
              });
            } else {
              expect(after.journal, `crash ${w.crashes} trips the brake`).toMatchObject({
                _tag: "writing_down",
                recovery: { process: before.journal.process, crashes: w.crashes, until: opening },
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
          // pinned: healthy for exactly resetAfterMs resets the crash count (P34 compares with >=).
          // begin saved, threw, exit written, wait out the backoff, started, checkpointed, then
          // two idle advances that end exactly resetAfterMs after the checkpoint.
          [
            Schema.decodeUnknownSync(Policy)(policy),
            [
              { move: 4, gap: 0 },
              { move: 1, gap: 0 },
              { move: 0, gap: 0 },
              { move: 0, gap: policy.backoff.minMs },
              { move: 1, gap: 0 },
              { move: 0, gap: 0 },
              { move: 6, gap: policy.backoff.resetAfterMs / 2 },
              { move: 6, gap: policy.backoff.resetAfterMs / 2 },
            ].map((cell) => ({ ...cell, pick: 0, error: "TypeError" })),
          ],
        ],
      },
    );

    for (const tag of ["writing_down", "waiting_recovery", "started", "started_early", "adopted"]) {
      expect(seen.has(tag), `the fold reaches ${tag}`).toBe(true);
    }
  });

  // J8 / p80, the brake's reach, kept from P34: every accepted policy, delivery limits 1 to 32 and
  // intensity to 44, trips its brake on crash intensity + 1 and never before. Each cycle's moves are
  // chosen from the journal it is in; the tape picks the letter, the time alive and the error class.
  // Plant: an unreachable brake, or a down before the window is full.
  it("J8: every generated policy trips its brake at crash intensity + 1, and a letter goes dead at its limit", () => {
    const G = 50;
    const Cycle = fc.record({
      // Mostly a held letter, so high delivery limits are reached too.
      reuse: fc.integer({ min: 0, max: 7 }).map((n) => n > 0),
      pick: fc.noBias(fc.nat()),
      alive: fc.integer({ min: 0, max: G }),
      // The exit lands this long after the throw: backoff counts from the exit.
      exit: fc.integer({ min: 0, max: G }),
      late: fc.integer({ min: 0, max: G }),
      error: fcErrorClass.filter((e) => e.length <= 40),
    });
    const cases = fc
      .record({
        deliveries: fc.integer({ min: 1, max: 32 }),
        extra: fc.integer({ min: 1, max: 12 }),
        minMs: fc.integer({ min: 1, max: 200 }),
        spread: fc.integer({ min: 0, max: 800 }),
        slack: fc.integer({ min: 0, max: 5000 }),
      })
      .chain(({ deliveries, extra, minMs, spread, slack }) => {
        const intensity = deliveries + extra;
        const maxMs = minMs + spread;
        let total = 0;

        // Every wait up to the tripping crash, and the most time the tape spends alive, exiting or late,
        // fit in one window, so the brake must trip on crash intensity + 1.
        for (let n = 0; n <= intensity; n++) {
          total += Math.min(minMs * 2 ** n, maxMs);
        }

        const accepted = Schema.decodeUnknownSync(Policy)({
          maxDeliveries: deliveries,
          intensity,
          periodMs: total + 3 * intensity * G + 1 + slack,
          backoff: { minMs, maxMs, resetAfterMs: 1_000_000_000 },
        });
        return fc.tuple(fc.constant(accepted), fc.array(Cycle, { minLength: intensity + 1, maxLength: intensity + 1 }));
      });
    const seen = new Set<string>();

    fc.assert(
      fc.property(cases, ([p, cycles]) => {
        let model = supervisor.init(null, ctx(p))[0];
        let at = 0;
        let pids = 0;
        let crashes = 0;
        const restarts: Array<number> = [];
        const tries = new Map<string, number>();
        const send = (msg: Msg): Model => {
          const after = step(model, msg);
          expect(after, `${msg.type} from ${model.journal._tag} moved the journal`).not.toEqual(model);
          model = after;
          return after;
        };

        for (const cycle of cycles) {
          // From idle: a letter the fold still holds open, or a new one.
          const open = [...tries].filter(([, n]) => n < p.maxDeliveries).map(([letter]) => letter);
          const letter = cycle.reuse && open.length > 0 ? open[cycle.pick % open.length]! : `letter-${tries.size + 1}`;
          expect(model.journal._tag).toBe("idle");
          const process = model.journal._tag === "idle" ? model.journal.process : A;

          if (!tries.has(letter)) {
            send({ type: "received", receipt: receiptFor(letter, process) });
            tries.set(letter, 0);
          }

          at += cycle.alive;
          send({ type: "begin", process, letter, build: model.build, phase: "fresh", at });
          const seq = model.seq;
          send({ type: "admitted", seq, receipt: receiptFor(letter, process) });
          send({ type: "threw", seq, error: cycle.error, reason: reasonFor("fresh", cycle.error), from: from() });
          crashes++;
          tries.set(letter, tries.get(letter)! + 1);

          if (tries.get(letter) === p.maxDeliveries) {
            expect(model.journal, `letter ${letter} goes dead on try ${p.maxDeliveries}`).toMatchObject({
              _tag: "writing_dead",
            });
            seen.add(`dead:${p.maxDeliveries}`);
            send({ type: "dead_written", seq });
          }

          expect(model.journal._tag).toBe("writing_exit");
          at += cycle.exit;
          send({ type: "exit_written", process, restarts: [...restarts], at, program: PROGRAM });
          const earliest = at + Math.min(p.backoff.minMs * 2 ** (crashes - 1), p.backoff.maxMs);

          if (crashes === p.intensity + 1) {
            // Down holds until the first restart of the full window leaves it, past the window itself.
            const until = Math.max(earliest, restarts[0]! + p.periodMs + 1);
            expect(until).toBeGreaterThan(p.periodMs);
            expect(model.journal, `crash ${crashes} trips the brake`).toMatchObject({
              _tag: "writing_down",
              recovery: { process, crashes, until },
            });
            seen.add(`brake:${p.intensity}`);
            return;
          }

          const j = model.journal;
          expect(j, `crash ${crashes} of ${p.intensity} restarts`).toMatchObject({
            _tag: "waiting_start",
            timing: { _tag: "scheduled", until: earliest },
          });

          if (j._tag !== "waiting_start" || j.timing._tag !== "scheduled") {
            return;
          }

          at = j.timing.until + cycle.late;
          pids++;
          send({ type: "started", id: j.request.id, process: pid(pids), at });
          restarts.push(at);
          send({ type: "checkpointed", after: process, process: pid(pids), restarts: [...restarts], at });
        }

        expect.unreachable(`the tape of ${cycles.length} crashes ended before the brake`);
      }),
      { seed: SEED, numRuns: RUNS },
    );

    const brakes = [...seen].filter((s) => s.startsWith("brake:")).map((s) => Number(s.slice(6)));
    const deads = [...seen].filter((s) => s.startsWith("dead:")).map((s) => Number(s.slice(5)));
    expect(Math.max(...brakes), "intensity coverage reaches past 32").toBeGreaterThan(32);
    expect(Math.max(...deads), "delivery limits past 16 go dead").toBeGreaterThan(16);
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

  // L7 (P15 slice 1). `swapped` while idle on that process moves the journal's build, so a crash
  // restart starts on the code the process runs now (P34, OTP's supervisor); in any other journal,
  // or for another process, it changes nothing. The Model round-trips its schema at every step.
  // Plant: leave `s.build` on the old hash; apply `swapped` while stepping.
  it("L7: swapped while idle moves the build a crash restart starts on; in any other journal it changes nothing", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(policies, tapes, (p, tape) => {
        // The fold's own account of the build the process runs now.
        let build = BUILD;
        walk(
          p,
          tape,
          (before, move, after) => {
            expect(valid(after), `reached ${after.journal._tag}`).toBe(true);
            expect(decodes(roundTrip(after))).toBe(true);

            if (move.msg.type === "swapped") {
              const j = before.journal;

              if (j._tag === "idle" && j.process === move.msg.process) {
                expect(after).toEqual({ ...before, build: move.msg.build });
                build = String(move.msg.build);
                seen.add("swapped_idle");
              } else {
                expect(after, `swapped in ${j._tag} for ${move.name}`).toEqual(before);
                seen.add(j._tag === "idle" ? "swapped_foreign" : "swapped_busy");
              }
            } else if (!move.stale && move.name === "checkpointed" && before.journal._tag === "checkpointing") {
              const origin = before.journal.origin;
              build = origin._tag === "manual" ? origin.request.build : build;
            } else if (!move.stale && move.name === "adopted" && after !== before) {
              build = String(move.msg.build);
            }

            expect(after.build, `after ${move.name}`).toBe(build);
            const j = after.journal;

            if (j._tag === "waiting_start" && j.origin._tag === "crash" && move.name !== "stale") {
              expect(j.request.code.hash, "a crash restart starts on the code the process runs now").toBe(build);

              if (build !== BUILD) {
                seen.add("crash_after_swap");
              }
            }
          },
          true,
        );
      }),
      { seed: SEED, numRuns: 300 },
    );

    for (const tag of ["swapped_idle", "swapped_busy", "swapped_foreign", "crash_after_swap"]) {
      expect(seen.has(tag), `the fold reaches ${tag}`).toBe(true);
    }
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

  // A crash origin names the process its journal replaces; a foreign failure process is refused.
  const origin = journal.origin as { _tag: string; failure?: object; request?: { id: string; build: string } };

  if (origin?._tag === "crash") {
    const failure = { ...origin.failure, process: FOREIGN };
    broken.push({ ...raw, journal: { ...journal, origin: { ...origin, failure } } });
  }

  // A person's restart starts with its own saved request ID and build.
  if (journal._tag === "waiting_start" && origin._tag === "manual") {
    const request = journal.request as { id: string; code: Record<string, unknown> };
    broken.push({ ...raw, journal: { ...journal, request: { ...request, id: `${request.id}:other` } } });
    broken.push({
      ...raw,
      journal: {
        ...journal,
        request: { ...request, code: { ...request.code, hash: `${String(request.code.hash)}:other` } },
      },
    });
  }

  // A checkpoint's successor is never its predecessor.
  if (journal._tag === "checkpointing") {
    broken.push({ ...raw, journal: { ...journal, after: journal.process } });
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

describe("P13 A11 saved admission work", () => {
  it("A11: checking, admission, reply and cleanup survive every JSON cut; stale completion cannot close work", () => {
    const reached = new Set<string>();
    const paths = tapes.map((tape) => {
      let model = supervisor.init(null, ctx())[0];
      let letters = 0;
      const messages: Array<typeof supervisor.msg.Type> = [];
      const send = (msg: Msg) => {
        const checked = Schema.decodeUnknownSync(Schema.toType(supervisor.msg))(msg);
        messages.push(checked);
        model = applyCell(supervisor, model, checked)[0];
      };

      for (const cell of tape) {
        const j = model.journal;

        if (j._tag === "idle") {
          send({
            type: "begin",
            process: j.process,
            letter: `fresh-${++letters}`,
            build: BUILD,
            phase: "fresh",
            at: cell.gap,
          });
        } else if (j._tag === "checking") {
          const choices = ["admitted", "refused", "abandoned"];
          const move = choices[cell.move % choices.length]!;
          const seq = j.attempt.seq;

          if (move === "admitted") {
            send({ type: move, seq, receipt: receiptFor(j.attempt.letter, j.attempt.process) });
          } else if (move === "refused") {
            send({
              type: move,
              seq,
              reply: {
                name: NAME,
                id: j.attempt.letter,
                parent: "input_0000000000e008000000000001",
                by: from().by,
                for: from().for,
                digest: `sha256:${j.attempt.letter}`,
                answer: { _tag: "refused", reason: "changed_elsewhere", now: cell.gap },
              },
            });
          } else {
            send({ type: move, seq });
          }
        } else if (j._tag === "stepping") {
          send({ type: cell.move % 2 === 0 ? "finished" : "abandoned", seq: j.attempt.seq });
        } else if (j._tag === "writing_reply") {
          send({ type: "reply_written", seq: j.attempt.seq });
        } else if (j._tag === "clearing_attempt") {
          send({ type: "attempt_cleared", seq: j.attempt.seq });
        }
      }

      return messages;
    });
    propertyTrace(
      supervisor,
      ctx(),
      paths,
      (steps) => {
        for (const trace of steps) {
          const before = trace.prev;
          const after = trace.next;
          const message = trace.msg;
          reached.add(message.type);
          expect(after.crashes).toBe(0);
          expect(after.observations).toEqual([]);

          if (message.type === "begin") {
            expect(after.journal).toMatchObject({
              _tag: "checking",
              attempt: { letter: message.letter, phase: "fresh" },
            });
            expect(after.receipts).toEqual(before.receipts);
          }

          if (message.type === "admitted") {
            expect(after.journal).toMatchObject({ _tag: "stepping", attempt: { seq: message.seq } });
            expect(after.receipts.find((r) => r.letter === message.receipt.letter)?.input).toEqual(
              message.receipt.input,
            );
            expect(
              decodes({ ...(roundTrip(after) as object), receipts: [] }),
              "fresh stepping without the admitted input cannot load",
            ).toBe(false);
          }

          if (message.type === "refused") {
            expect(after.journal).toMatchObject({ _tag: "writing_reply", reply: message.reply });
            expect(after.receipts).toEqual(before.receipts);
          }

          if (
            after.journal._tag === "checking" ||
            after.journal._tag === "writing_reply" ||
            after.journal._tag === "clearing_attempt"
          ) {
            expect(step(after, { type: "finished", seq: after.journal.attempt.seq })).toEqual(after);
          }

          if ("attempt" in after.journal) {
            for (const type of [
              "admitted",
              "refused",
              "reply_written",
              "abandoned",
              "attempt_cleared",
              "check_threw",
            ]) {
              const stale = {
                ...message,
                type,
                seq: after.journal.attempt.seq + 1000,
                receipt: receiptFor("stale", A),
                reply: {
                  name: NAME,
                  id: "stale",
                  parent: "input_0000000000e008000000000001",
                  by: from().by,
                  for: from().for,
                  digest: "stale",
                  answer: { _tag: "refused", reason: "stale" },
                },
                error: "TypeError",
                reason: reasonFor("fresh", "TypeError"),
                from: from(),
              };
              expect(step(after, stale)).toEqual(after);
            }
          }
        }

        syncTest(supervisor, ctx(), {
          msgs: steps.map((s) => s.msg),
          encode: Schema.encodeSync(Supervision),
          decode: Schema.decodeUnknownSync(Supervision),
          equals: (a, b) => canon(a) === canon(b),
          seed: SEED,
        });
        return true;
      },
      { seed: SEED, numRuns: 100 },
    );
    expect([...reached]).toEqual(
      expect.arrayContaining([
        "begin",
        "admitted",
        "refused",
        "abandoned",
        "finished",
        "reply_written",
        "attempt_cleared",
      ]),
    );
  });
});
