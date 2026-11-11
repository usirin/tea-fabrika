// P34c slice 1, L1, L2, L3, L6 and L7 on a real store (0062): the laws, and no driver. A runner in
// the module that owns a driver calls `ExitReasonTest.suite(open)`; `open` acquires one store in a
// scope and gives it back when that scope closes.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Predicate, Result, Schema, type Scope, Stream } from "effect";
import * as fc from "fast-check";
import { Ledger } from "../ledger/Ledger.ts";
import { type Entry, valueFor } from "../ledger/Log.ts";
import type { Sql } from "../Sql.ts";
import { Mailbox } from "./Mailbox.ts";
import {
  BRAIN,
  brain,
  CODE,
  copied,
  data,
  DownReason,
  ExitReason,
  fcBadReason,
  fcExitReason,
  from,
  ids,
  NOPROC,
  PIDS,
  watcher,
} from "./Process.test-support.ts";
import { clientInbox, ProcessError, Recipient, Start } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";

/** One real store. `reopen` closes it and opens the same database again, keeping only its rows. */
export type Store = { readonly sql: Sql; readonly reopen: Effect.Effect<void> };

type Caller = ReturnType<typeof watcher>;

/** What the fold knows, from its own moves only: never read back from the product. */
type World = {
  readonly names: Array<{ readonly name: string; process: string; live: boolean; restarts: number }>;
  readonly exits: Map<string, ExitReason>;
  /** Every watch by its key: who is told, about which process, and whether it still waits. */
  readonly watches: Map<string, { readonly to: typeof Recipient.Type; readonly target: string; live: boolean }>;
  /** Each DOWN the fold expects, by its recipient's key and ref. */
  readonly downs: Map<string, unknown>;
  pids: number;
  refs: number;
};

const CLIENT = brain().recipient;

const toKey = (to: typeof Recipient.Type): string =>
  to._tag === "client" ? `client:${to.client}:${to.session}` : `process:${to.process}`;

/** Structural equality, field by field, as the ledger keeps a reason. */
const same = (a: ExitReason, b: ExitReason): boolean =>
  a._tag === b._tag && (a._tag !== "crashed" || (b._tag === "crashed" && a.phase === b.phase && a.error === b.error));

/** One tape cell: which move, which target, the reason and one invalid copy of it. */
const Cell = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  cut: fc.nat(),
  reason: fcExitReason,
  other: fcExitReason,
  bad: fc.nat(),
});
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

const Tape = fc
  .array(
    fcExitReason.chain((reason) =>
      fc.tuple(
        Cell.map((cell) => ({ ...cell, reason })),
        fcBadReason(reason),
      ),
    ),
    { minLength: 8, maxLength: 40, size: "max" },
  )
  .map((cells) => cells.map(([cell, bad]) => ({ ...cell, bad })));

type Step = Omit<Cell, "bad"> & { readonly bad: unknown };

type Move =
  | "start"
  | "restart"
  | "watch"
  | "watch_missing"
  | "cancel"
  | "exit"
  | "retry_equal"
  | "retry_other"
  | "bad"
  | "exit_noproc"
  | "cut"
  | "reopen";

const INSERT = /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+entries\b/i;

/** The store's Sql, with a cut that refuses the `after`-th insert of the next call. */
const cutting = (sql: Sql) => {
  const fault = { after: null as number | null };
  const wrapped: Sql = {
    exec: (query, ...params) => {
      if (INSERT.test(query) && fault.after !== null) {
        if (fault.after === 0) {
          throw new Error("SQLITE_FULL planted at a write boundary");
        }

        fault.after--;
      }

      return sql.exec(query, ...params);
    },
    transaction: (step) => sql.transaction(step),
    size: () => sql.size(),
  };
  return { sql: wrapped, fault };
};

const layer = (sql: Sql, caller: Caller, next: Effect.Effect<string>) =>
  ProcessManager.layer({ ...caller, by: BRAIN }, next).pipe(
    Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data(sql)))),
  );

const read = (sql: Sql, stream: string) =>
  Ledger.use((ledger) => Stream.runCollect(ledger.read(stream, 0))).pipe(Effect.provide(data(sql)));

/** Every lifecycle fact and signal the fold could have caused, in rev order. */
const facts = Effect.fnUntraced(function* (sql: Sql, world: World) {
  const streams = [
    "processes",
    clientInbox(CLIENT.client),
    ...world.names.flatMap(({ name }) => [`processes/${name}`, `${name}/inbox`]),
  ];
  const rows: Array<Entry> = [];

  for (const stream of streams) {
    rows.push(...(yield* read(sql, stream)));
  }

  return rows.sort((a, b) => a.rev - b.rev);
});

/** A typed refusal: a ProcessError, with `reason` when the law names one. */
const refused = (answer: Result.Result<unknown, unknown>, message: string, reason?: ProcessError["reason"]) => {
  const failure = Result.isFailure(answer) ? answer.failure : answer;
  expect(failure, message).toBeInstanceOf(ProcessError);
  expect(failure, message).toMatchObject(reason === undefined ? {} : { reason });
};

const decodeExit = Schema.decodeUnknownResult(ExitReason, { onExcessProperty: "error" });
const decodeDown = Schema.decodeUnknownResult(DownReason, { onExcessProperty: "error" });

/** The oracle: what the rows must say, checked against the fold's own world after every prefix. */
const check = (rows: ReadonlyArray<Entry>, world: World) => {
  const exited = rows.filter((row) => row._tag === "exited" && row.by === BRAIN);
  expect(exited.map((row) => (valueFor(row) as { process: string }).process).sort()).toEqual(
    [...world.exits.keys()].sort(),
  );

  for (const row of exited) {
    const { process, reason } = valueFor(row) as { process: string; reason: unknown };
    expect(
      Result.isSuccess(decodeExit(reason)),
      `a committed exit holds a valid fixed reason: ${JSON.stringify(reason)}`,
    ).toBe(true);
    expect(reason, "the reason read back equals the one the exit was given").toEqual(world.exits.get(process));
  }

  const downs = rows.filter((row) => row._tag === "send" && row.by === BRAIN);
  const seen = new Map<string, unknown>();

  for (const row of downs) {
    const { m } = valueFor(row) as { m: { ref: string; to: typeof Recipient.Type; reason: unknown } };
    expect(
      Result.isSuccess(decodeDown(m.reason)),
      `a DOWN holds an exit reason or noproc: ${JSON.stringify(m.reason)}`,
    ).toBe(true);
    const key = `${toKey(m.to)}|${m.ref}`;
    expect(seen.has(key), "one DOWN per watch").toBe(false);
    seen.set(key, m.reason);
  }

  expect(Object.fromEntries(seen)).toEqual(Object.fromEntries(world.downs));
};

const startRequest = (world: World, slot: number) => {
  const known = world.names[slot];

  if (known === undefined) {
    const name = `counter:${slot + 1}`;
    return { name, request: Start.cases.first.make({ id: `start:${name}`, name, code: CODE }) };
  }

  return {
    name: known.name,
    request: Start.cases.again.make({
      id: `restart:${known.process}`,
      name: known.name,
      after: known.process,
      reason: "crashed",
      code: CODE,
    }),
  };
};

const live = (world: World) => world.names.filter((n) => n.live);
const ended = (world: World) => world.names.filter((n) => !n.live);

/** The item a tape cell's number picks; never called on an empty list. */
const choose = <A>(items: ReadonlyArray<A>, pick: number): A => {
  const item = items[pick % items.length];

  if (item === undefined) {
    throw new Error("a move chose from an empty list");
  }

  return item;
};

/** The moves possible in this world, each only when the world can take it. */
const possible = (world: World, moves: ReadonlyArray<Move>): ReadonlyArray<Move> => {
  const ids = world.pids < PIDS.length - 1;
  const lives = live(world).length > 0;
  const can: Record<Move, boolean> = {
    start: world.names.length < 3 && ids,
    restart: ended(world).length > 0 && ids,
    watch: lives,
    exit: lives,
    bad: lives,
    exit_noproc: lives,
    cut: lives,
    watch_missing: true,
    cancel: [...world.watches.values()].some((w) => w.live),
    retry_equal: world.exits.size > 0,
    retry_other: world.exits.size > 0,
    reopen: true,
  };
  return moves.filter((move) => can[move]);
};

/**
 * Folds one tape through the real manager on one store. Each cell reads the world the fold has
 * reached and picks a move that is possible there; the oracle checks every prefix.
 */
const walk = (open: Effect.Effect<Store, never, Scope.Scope>, moves: ReadonlyArray<Move>, done: Set<Move>) =>
  Effect.fnUntraced(function* (tape: ReadonlyArray<Step>) {
    const store = yield* open;
    const { sql, fault } = cutting(store.sql);
    const next = ids(...PIDS);
    const world: World = { names: [], exits: new Map(), watches: new Map(), downs: new Map(), pids: 0, refs: 0 };
    const as = <A, E>(caller: Caller, call: (p: ProcessManager["Service"]) => Effect.Effect<A, E>) =>
      ProcessManager.use(call).pipe(Effect.provide(layer(sql, caller, next.next)), Effect.result);
    /** The writes one exit of `process` makes: its exit, a DOWN per live watch on it, a cancel per watch it holds. */
    const writes = (process: string) => {
      const watches = [...world.watches.values()].filter((w) => w.live);
      const inbound = watches.filter((w) => w.target === process).length;
      const outbound = watches.filter((w) => w.to._tag === "process" && w.to.process === process).length;
      return 1 + inbound + outbound;
    };

    for (const step of tape) {
      const options = possible(world, moves);

      if (options.length === 0) {
        continue;
      }

      const move = choose(options, step.move);
      const before = yield* facts(sql, world);

      switch (move) {
        case "start":
        case "restart": {
          const slot = move === "start" ? world.names.length : world.names.indexOf(choose(ended(world), step.pick));
          const { name, request } = startRequest(world, slot);
          const answer = yield* as(brain(), (p) => p.start(request, from()));
          expect(Result.isSuccess(answer), "a start the world allows is placed").toBe(true);
          const process = choose(PIDS, world.pids++);
          const known = world.names[slot];

          if (known === undefined) {
            world.names.push({ name, process, live: true, restarts: 0 });
          } else {
            known.process = process;
            known.live = true;
            known.restarts++;
          }

          break;
        }
        case "watch":
        case "watch_missing": {
          const target =
            move === "watch"
              ? choose(live(world), step.pick).process
              : choose([...world.exits.keys(), choose(PIDS, PIDS.length - 1)], step.pick);
          const watchers = [CLIENT, ...live(world).map((n) => Recipient.cases.process.make({ process: n.process }))];
          const to = choose(watchers, step.cut);
          const ref = `watch:${++world.refs}`;
          const caller = to._tag === "client" ? brain() : watcher(to.process);
          const answer = yield* as(caller, (p) => p.monitor(ref, target, from()));
          expect(Result.isSuccess(answer), "a monitor from a live recipient is placed").toBe(true);
          const key = `${toKey(to)}|${ref}`;

          if (live(world).some((n) => n.process === target)) {
            world.watches.set(key, { to, target, live: true });
          } else {
            // A missing target answers at once with the monitor result, never an exit reason.
            world.watches.set(key, { to, target, live: false });
            world.downs.set(key, NOPROC);
          }

          break;
        }
        case "cancel": {
          const [key, watch] = choose(
            [...world.watches.entries()].filter(([, w]) => w.live),
            step.pick,
          );
          const ref = key.slice(key.lastIndexOf("|") + 1);
          const caller = watch.to._tag === "client" ? brain() : watcher(watch.to.process);
          const answer = yield* as(caller, (p) => p.demonitor(ref, from()));
          expect(Result.isSuccess(answer), "a cancel of a live watch is placed").toBe(true);
          watch.live = false;
          break;
        }
        case "exit": {
          const target = choose(live(world), step.pick);
          const answer = yield* as(brain(), (p) => p.exit(target.process, copied(step.reason), from()));
          expect(Result.isSuccess(answer), "an exit with a valid reason commits").toBe(true);
          target.live = false;
          world.exits.set(target.process, step.reason);

          for (const [key, watch] of world.watches) {
            if (!watch.live) {
              continue;
            }

            if (watch.target === target.process) {
              world.downs.set(key, step.reason);
              watch.live = false;
            } else if (watch.to._tag === "process" && watch.to.process === target.process) {
              watch.live = false;
            }
          }

          break;
        }
        case "retry_equal":
        case "retry_other": {
          const [process, reason] = choose([...world.exits.entries()], step.pick);
          const sent = move === "retry_equal" ? copied(reason) : step.other;
          const answer = yield* as(brain(), (p) => p.exit(process, sent, from({ parent: null, for: "retry-person" })));

          if (same(sent, reason)) {
            expect(Result.isSuccess(answer), "an equal retry answers as the first exit did").toBe(true);
          } else {
            refused(answer, "a different reason for an ended process is refused", "ended");
          }

          expect(yield* facts(sql, world), "a retry writes nothing").toEqual(before);
          break;
        }
        case "bad": {
          const target = choose(live(world), step.pick);
          const answer = yield* as(brain(), (p) => p.exit(target.process, step.bad as ExitReason, from()));
          refused(answer, `invalid input is refused: ${JSON.stringify(step.bad)}`, "bad_text");
          expect(yield* facts(sql, world), "a refused exit leaves every lifecycle fact as it was").toEqual(before);
          const still = yield* as(brain(), (p) => p.isLive(target.process));
          expect(Result.getOrThrow(still), "the process still lives").toBe(true);
          break;
        }
        case "exit_noproc": {
          // noproc is what a monitor answers for a missing target; no process exits with it.
          const target = choose(live(world), step.pick);
          const answer = yield* as(brain(), (p) => p.exit(target.process, NOPROC as never, from()));
          refused(answer, "noproc is refused as an exit reason");
          expect(yield* facts(sql, world), "a refused noproc exit writes nothing").toEqual(before);
          break;
        }
        case "cut": {
          const target = choose(live(world), step.pick);
          fault.after = step.cut % writes(target.process);
          const answer = yield* as(brain(), (p) => p.exit(target.process, step.reason, from()));
          fault.after = null;
          expect(Result.isFailure(answer), "a cut exit fails").toBe(true);
          expect(yield* facts(sql, world), "a cut exit commits none of its writes").toEqual(before);
          const still = yield* as(brain(), (p) => p.isLive(target.process));
          expect(Result.getOrThrow(still), "the process still lives after the cut").toBe(true);
          break;
        }
        case "reopen":
          yield* store.reopen;
          break;
      }

      done.add(move);
      check(yield* facts(sql, world), world);

      // A live process is handed only its own watches' DOWNs, never one meant for its predecessor.
      for (const { process } of live(world)) {
        const letters = yield* as(brain(), (p) => Stream.runCollect(p.receive(process, 0)));
        expect(Result.isSuccess(letters), "a live process can receive").toBe(true);
        const downs = Result.isSuccess(letters)
          ? [...letters.success].flatMap(({ m }) =>
              Predicate.isObject(m) && Predicate.hasProperty(m, "_tag") && m._tag === "DOWN" ? [m] : [],
            )
          : [];

        for (const down of downs) {
          expect((down as { to: typeof Recipient.Type }).to, "a DOWN reaches only its own recipient").toEqual(
            Recipient.cases.process.make({ process }),
          );
        }
      }
    }
  });

const prop = (
  name: string,
  open: Effect.Effect<Store, never, Scope.Scope>,
  moves: ReadonlyArray<Move>,
  required: ReadonlyArray<Move>,
) =>
  it.effect(
    name,
    () =>
      Effect.gen(function* () {
        const done = new Set<Move>();
        const law = walk(open, moves, done);
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
        const property = fc.asyncProperty(Tape, (tape) => Effect.runPromise(Effect.scoped(law(tape))));
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, { seed: 119120, numRuns: 40, includeErrorInReport: true }));
        // An empty flow cannot pass: every move the law is about ran at least once.
        expect([...done].sort()).toEqual(expect.arrayContaining([...required].sort()));
      }),
    120_000,
  );

const LIFE: ReadonlyArray<Move> = ["start", "restart", "watch", "cancel", "exit", "reopen"];

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("P34c slice 1: structured exit reasons on a real store", () => {
    prop(
      "L1 / p112: every committed exit holds a valid fixed reason; text and unknown tags are refused before writing",
      open,
      [...LIFE, "bad"],
      ["exit", "bad"],
    );
    prop(
      "L2: an exit, its DOWNs and its watcher cleanup commit together or not at all",
      open,
      [...LIFE, "cut"],
      ["exit", "cut", "watch"],
    );
    prop(
      "L3: an equal exit retry writes nothing after serialization or reopening; a different reason is refused",
      open,
      [...LIFE, "retry_equal", "retry_other"],
      ["exit", "retry_equal", "retry_other", "reopen"],
    );
    prop(
      "L6: a DOWN carries the exit reason unchanged; a missing target yields only noproc",
      open,
      [...LIFE, "watch_missing", "exit_noproc"],
      ["exit", "watch", "watch_missing", "cancel", "exit_noproc", "restart"],
    );
    prop(
      "L7: invalid reason shapes and overlong classes leave every lifecycle fact unchanged",
      open,
      [...LIFE, "bad", "reopen"],
      ["bad", "exit"],
    );
  });
