// T753 L16 lane, slice 1: the ProcessManager keeps its last folded process table. These laws hold
// with or without that memo; they exist to turn a wrong memo red. A long-lived manager is one layer
// build kept for a whole history; a fresh one is built for a single call and folds from rev 0.
import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer } from "effect";
import * as fc from "fast-check";
import { Ledger } from "../ledger/Ledger.ts";
import { LedgerTransaction } from "../ledger/LedgerTransaction.ts";
import { type Entry, lineFor } from "../ledger/Log.ts";
import {
  BRAIN,
  brain,
  CLIENT,
  CODE,
  type ExitReason,
  fcExitReason,
  first,
  from,
  ids,
  KILL,
  manager,
  PIDS,
  storage,
  type Storage,
} from "./Process.test-support.ts";
import { clientInbox, Owner, ProcessEvent, ProcessTable, signalId, Start } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";

const NAMES = ["counter:0", "counter:1", "counter:2"] as const;
const REFS = ["ref-0", "ref-1", "ref-2"] as const;
/** A process id no generated history places: a call on it asks about a process that never lived. */
const NEVER = PIDS[39]!;
/** The name a rolled-back turn registers, which no committed history holds. */
const GHOST = "ghost:1";
/** The name Law B's refused exit is about, started and watched just before that exit. */
const WATCHED = "watched:1";
const PLACEABLE = PIDS.slice(0, 39);

type Call =
  | { readonly call: "first"; readonly n: number }
  | { readonly call: "again"; readonly n: number }
  | { readonly call: "exit"; readonly n: number; readonly reason: ExitReason }
  | { readonly call: "monitor"; readonly n: number; readonly ref: number }
  | { readonly call: "demonitor"; readonly ref: number }
  | { readonly call: "down"; readonly n: number; readonly crashes: number }
  | { readonly call: "status"; readonly n: number }
  | { readonly call: "isLive"; readonly n: number }
  | { readonly call: "resolve"; readonly n: number }
  | { readonly call: "info" };

// `n` is a choice, not an id: `aim` turns it into a target from the history's state so far, so most
// calls land where they can succeed (a free name, a live process, an ended one) and one in eight
// goes anywhere, a never-placed process included, to reach the refusals.
const n = fc.nat({ max: 63 });
const ref = fc.nat({ max: REFS.length - 1 });

const fcCall: fc.Arbitrary<Call> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ call: fc.constant("first" as const), n }) },
  { weight: 3, arbitrary: fc.record({ call: fc.constant("again" as const), n }) },
  { weight: 3, arbitrary: fc.record({ call: fc.constant("exit" as const), n, reason: fcExitReason }) },
  { weight: 2, arbitrary: fc.record({ call: fc.constant("monitor" as const), n, ref }) },
  { weight: 1, arbitrary: fc.record({ call: fc.constant("demonitor" as const), ref }) },
  { weight: 1, arbitrary: fc.record({ call: fc.constant("down" as const), n, crashes: fc.nat({ max: 9 }) }) },
  { weight: 3, arbitrary: fc.record({ call: fc.constant("status" as const), n }) },
  { weight: 2, arbitrary: fc.record({ call: fc.constant("isLive" as const), n }) },
  { weight: 1, arbitrary: fc.record({ call: fc.constant("resolve" as const), n }) },
  { weight: 1, arbitrary: fc.constant({ call: "info" as const }) },
);

const fcHistory = (minLength: number, maxLength: number) => fc.array(fcCall, { minLength, maxLength, size: "max" });

/** What the history did so far, as the long-lived manager answered it: placed processes and the live ones. */
type World = { readonly placed: Map<string, string>; readonly live: Set<string> };
const world = (): World => ({ placed: new Map(), live: new Set() });
const anyProcess = (state: World, n: number): string => [...state.placed.keys(), NEVER][n % (state.placed.size + 1)]!;

const among = (choices: ReadonlyArray<string>, n: number, fallback: string): string =>
  n % 8 === 7 || choices.length === 0 ? fallback : choices[n % choices.length]!;

const newest = (state: World, name: string): string =>
  [...state.placed].findLast(([, placedName]) => placedName === name)?.[0] ?? NEVER;

/** A concrete call: the target `aim` picked for a generated choice. */
type Aimed = { readonly step: Call; readonly name: string; readonly process: string };

const aim = (step: Call, state: World): Aimed => {
  const ended = [...state.placed.keys()].filter((process) => !state.live.has(process));
  const free = NAMES.filter((name) => ![...state.placed.values()].includes(name));
  const restartable = NAMES.filter((name) => newest(state, name) !== NEVER && !state.live.has(newest(state, name)));
  const registered = NAMES.filter((name) => !free.includes(name));
  const n = "n" in step ? step.n : 0;
  const name =
    step.call === "first"
      ? among(free, n, NAMES[n % NAMES.length]!)
      : step.call === "again"
        ? among(restartable, n, among(registered, n, NAMES[n % NAMES.length]!))
        : among(registered, n, NAMES[n % NAMES.length]!);
  const process =
    step.call === "again"
      ? newest(state, name)
      : step.call === "exit" || step.call === "monitor"
        ? among([...state.live], n, anyProcess(state, n))
        : step.call === "down"
          ? among(ended, n, anyProcess(state, n))
          : anyProcess(state, n);
  return { step, name, process };
};

/** Keeps the world in step with the long-lived manager's answer to a call. */
const note = (state: World, { step, name, process }: Aimed, kept: Answer) => {
  if (!("ok" in kept)) {
    return;
  }

  if (step.call === "first" || step.call === "again") {
    const placed = (kept.ok as { readonly process: string }).process;
    state.placed.set(placed, name);
    state.live.add(placed);
  }

  if (step.call === "exit") {
    state.live.delete(process);
  }
};

type Answer = { readonly ok: unknown } | { readonly refused: unknown };

/** A call's answer as plain data: its value, with the clock's `at` left out, or its refusal reason. */
const answer = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<Answer> =>
  Effect.map(Effect.exit(effect), (exit) => {
    if (Exit.isSuccess(exit)) {
      const value: unknown = exit.value;

      if (typeof value === "object" && value !== null && Object.hasOwn(value, "at")) {
        const { at: _at, ...rest } = value as { readonly at: unknown };
        return { ok: rest };
      }

      return { ok: value };
    }

    const error: unknown = Cause.squash(exit.cause);
    return { refused: typeof error === "object" && error !== null && "reason" in error ? error.reason : error };
  });

/** One call on whichever manager is in context. */
const run = ({ step, name, process }: Aimed) =>
  Effect.gen(function* () {
    const processes = yield* ProcessManager;

    switch (step.call) {
      case "first":
        return yield* answer(processes.start(first(`start:${name}`, name), from()));
      case "again": {
        const request = Start.cases.again.make({
          id: `restart:${process}`,
          name,
          after: process,
          reason: "crashed",
          code: CODE,
        });
        return yield* answer(processes.start(request, from()));
      }
      case "exit":
        return yield* answer(processes.exit(process, step.reason, from()));
      case "monitor":
        return yield* answer(processes.monitor(REFS[step.ref]!, process, from()));
      case "demonitor":
        return yield* answer(processes.demonitor(REFS[step.ref]!, from()));
      case "down":
        return yield* answer(
          processes.down(process, { reason: "crashed", crashes: step.crashes, until: 1000 }, from()),
        );
      case "status":
        return yield* answer(processes.status(name));
      case "isLive":
        return yield* answer(processes.isLive(process));
      case "resolve":
        return yield* answer(processes.resolve(process));
      case "info":
        return yield* answer(processes.info);
    }
  });

/** Every read the manager offers, over every name and process the history touched. */
const sweep = (state: World) =>
  Effect.gen(function* () {
    const processes = yield* ProcessManager;
    const out: Array<Answer> = [yield* answer(processes.info)];

    for (const name of [...NAMES, GHOST, WATCHED]) {
      out.push(yield* answer(processes.status(name)));
    }

    for (const process of [...state.placed.keys(), NEVER]) {
      out.push(yield* answer(processes.isLive(process)), yield* answer(processes.resolve(process)));
    }

    return out;
  });

/** A manager built for this one call over `store`, so its fold starts from nothing. */
const fresh = (store: Storage, next = ids().next) => manager(store, brain(), next);

/** The ledger as data, without the referee's wall clock, which differs between two stores. */
const rows = (store: Storage) => store.rows().map(({ arrivedAt: _arrivedAt, ...row }: Entry) => row);

/** A brain line, as the manager writes one. */
const line = (event: Parameters<typeof lineFor>[1]) =>
  lineFor({ ...from(), by: BRAIN }, { ...event, asked: from().by });

const check = <A, E, R>(arb: fc.Arbitrary<A>, law: (a: A) => Effect.Effect<void, E, R>) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    yield* Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(arb, (a) => Effect.runPromise(law(a).pipe(Effect.provideContext(context)))),
        { seed: 119120, numRuns: 100, includeErrorInReport: true },
      ),
    );
  });

describe("T753 L16 lane: a long-lived ProcessManager answers as a fresh one", () => {
  it.effect("every call over a generated history answers the same as a freshly built manager's", () =>
    check(fcHistory(4, 30), (calls) =>
      Effect.scoped(
        Effect.gen(function* () {
          // `left` is the ledger the long-lived manager writes, reads interleaved with writes. `twin`
          // gets the same calls, each from a manager built for that one call, with the same process ids.
          const left = storage();
          const twin = storage();
          const twinIds = ids(...PLACEABLE);
          const long = yield* Layer.build(manager(left, brain(), ids(...PLACEABLE).next));
          const state = world();

          for (const [at, step] of calls.entries()) {
            const aimed = aim(step, state);
            const kept = yield* run(aimed).pipe(Effect.provideContext(long));
            const built = yield* run(aimed).pipe(Effect.provide(fresh(twin, twinIds.next)));
            expect(kept, `call ${at}, ${step.call}: long-lived and fresh managers answer the same`).toEqual(built);

            // A read is asked again of a manager built fresh over the long-lived one's own ledger.
            if (step.call === "status" || step.call === "isLive" || step.call === "resolve" || step.call === "info") {
              const over = yield* run(aimed).pipe(Effect.provide(fresh(left)));
              expect(kept, `call ${at}, ${step.call}: same ledger, fresh fold`).toEqual(over);
            }

            note(state, aimed, kept);
          }

          expect(rows(left), "both ledgers hold the same lines").toEqual(rows(twin));
          const kept = yield* sweep(state).pipe(Effect.provideContext(long));
          expect(kept, "every read at the end").toEqual(yield* sweep(state).pipe(Effect.provide(fresh(left))));
        }),
      ),
    ),
  );

  it.effect("a turn that folds after its own append and then rolls back leaves no stale table", () =>
    check(
      fc.tuple(fcHistory(0, 12), fc.constantFrom("registers" as const, "ends" as const, "refused" as const)),
      ([calls, turn]) =>
        Effect.scoped(
          Effect.gen(function* () {
            const left = storage();
            const long = yield* Layer.build(manager(left, brain(), ids(...PLACEABLE).next));
            const state = world();

            for (const step of calls) {
              const aimed = aim(step, state);
              note(state, aimed, yield* run(aimed).pipe(Effect.provideContext(long)));
            }

            const live = [...state.live][0];

            if (turn === "refused") {
              // A checked call's own turn: `exit` appends `exited`, then its DOWN to the watcher is
              // refused, because another writer holds that letter's id, and the turn rolls back.
              const rolled = yield* Effect.gen(function* () {
                const processes = yield* ProcessManager;
                const { process } = yield* processes.start(first(`start:${WATCHED}`, WATCHED), from());
                state.placed.set(process, WATCHED);
                yield* processes.monitor("ref-b", process, from());
                const to = brain().recipient;
                yield* Ledger.use((ledger) =>
                  ledger.append(
                    clientInbox(to.client),
                    signalId(to, "ref-b", 1),
                    lineFor(from({ by: CLIENT, parent: null }), { _tag: "send", m: { held: true } }),
                  ),
                );
                return yield* answer(processes.exit(process, KILL, from()));
              }).pipe(Effect.provideContext(long));
              expect(rolled, "the exit's turn rolled back").toEqual({ refused: "refused" });
            } else {
              // A turn appends a new name's start, or ends a live process, folds, then throws.
              const rolled = yield* Effect.gen(function* () {
                const tx = yield* LedgerTransaction;
                const processes = yield* ProcessManager;
                return yield* Effect.exit(
                  tx.transact((ledger) => {
                    if (turn === "registers" || live === undefined) {
                      const owner = Owner.cases.brain.make({});
                      ledger.append(
                        ProcessTable.stream,
                        JSON.stringify(["registered", GHOST]),
                        line(ProcessEvent.cases.registered.make({ name: GHOST, program: CODE.program, owner })),
                      );
                      ledger.append(
                        ProcessTable.events(GHOST),
                        `start:${GHOST}`,
                        line(ProcessEvent.cases.started.make({ process: NEVER, name: GHOST, ...CODE })),
                      );
                    } else {
                      ledger.append(
                        ProcessTable.events(state.placed.get(live)!),
                        JSON.stringify(["exited", live]),
                        line(ProcessEvent.cases.exited.make({ process: live, reason: KILL })),
                      );
                    }

                    processes.table(ledger);
                    // oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- the turn's synchronous step must throw: that is how a turn rolls back
                    throw new Error("planted: the turn rolls back after its fold");
                  }),
                );
              }).pipe(Effect.provideContext(long));
              expect(Exit.isFailure(rolled), "the turn rolled back").toBe(true);
            }

            const kept = yield* sweep(state).pipe(Effect.provideContext(long));
            expect(kept, "every read after the rollback").toEqual(
              yield* sweep(state).pipe(Effect.provide(fresh(left))),
            );
          }),
        ),
    ),
  );
});
