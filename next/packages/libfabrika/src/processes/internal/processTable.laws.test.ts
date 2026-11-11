// Ticket 704, next/. The process table's fold is one tea machine (0037, 0046). Every law walks it
// (0093): each choice is read against the state folded so far, so it names a process, watch or
// name the fold has reached, or one it has not, on purpose. The expected state is this file's own
// reading of the plan's transition table, never the machine or its driver.
import { applyCell } from "@demlik/tea";
import { describe, expect, expectTypeOf, it } from "@effect/vitest";
import { Option, Result, Schema } from "effect";
import * as fc from "fast-check";
import { LedgerError } from "../../ledger/Ledger.ts";
import { type Entry, lineFor } from "../../ledger/Log.ts";
import {
  A,
  B,
  BRAIN,
  CLIENT,
  CODE,
  CRASHED,
  ExitReason,
  from,
  NORMAL,
  PIDS,
  SHUTDOWN,
  X,
} from "../Process.test-support.ts";
import { Activity, Down, Owner, ProcessEvent, ProcessTable, Recipient, signalId, Start, State } from "../Process.ts";
import { processTableFor } from "./processTable.ts";

const RUNS = { seed: 119120, numRuns: 100 };
const NAMES = ["counter:1", "counter:2", "echo:1"];
const REFS = ["watch-a", "watch-b"];
const REASONS = ["crashed", "normal", "shutdown"] as const;

/** Each text reason as the exit it names; restarts and downs keep the text. */
const EXITS: Record<(typeof REASONS)[number], ExitReason> = {
  crashed: CRASHED,
  normal: NORMAL,
  shutdown: SHUTDOWN,
};

const sameExit = Schema.toEquivalence(ExitReason);
const BRAIN_OWNER = Owner.cases.brain.make({});
const OWNERS = [BRAIN_OWNER, Owner.cases.process.make({ process: A })];
const CLIENT_TO = Recipient.cases.client.make({ client: "window-a", session: X });
const T0 = 1_762_500_000_000;

type Machine = ReturnType<typeof processTableFor>;
type Model = Machine["model"]["Type"];
type Registered = typeof ProcessEvent.cases.registered.Type;
type To = typeof Recipient.Type;
type Owned = typeof Owner.Type;

type Life = {
  readonly name: string;
  readonly state: typeof State.Type;
  readonly request: Start;
  readonly from: Entry;
  readonly rev: number;
  readonly exited?: ExitReason;
};

type Watch = {
  readonly tag: "live" | "canceled";
  readonly ref: string;
  readonly process: string;
  readonly to: To;
  readonly round: number;
};

/** The plan's Model, as this file folds it by hand. */
type Folded = {
  readonly names: ReadonlyMap<string, Registered>;
  readonly lives: ReadonlyMap<string, Life>;
  readonly watches: ReadonlyMap<string, Watch>;
  readonly current: ReadonlyMap<string, string>;
  readonly restarts: ReadonlyMap<string, ReadonlyArray<number>>;
};

const empty: Folded = {
  names: new Map(),
  lives: new Map(),
  watches: new Map(),
  current: new Map(),
  restarts: new Map(),
};

const put = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> => new Map(map).set(key, value);

/** The canonical recipient key, byte for byte as main writes it. */
const keyFor = (to: To, ref: string): string =>
  JSON.stringify([to._tag === "process" ? { _tag: "process", process: to.process } : { ...CLIENT_TO, ...to }, ref]);

const sameOwner = (a: Owned | undefined, b: Owned): boolean =>
  a !== undefined && a._tag === b._tag && (a._tag === "brain" || (b._tag === "process" && a.process === b.process));

/** One step of a walk: the entry offered, and what the transition table says it does. */
type Step =
  | { readonly effect: "applied" | "ignored"; readonly entry: Entry; readonly after: Folded }
  | { readonly effect: "bad_row" | "malformed"; readonly entry: Entry };

const Choice = fc.record({
  move: fc.nat(99),
  pick: fc.nat(),
  other: fc.nat(),
  reason: fc.constantFrom(...REASONS),
  gap: fc.nat(5_000),
  crashes: fc.integer({ min: 1, max: 9 }),
  until: fc.nat(),
});
type Choice = typeof Choice extends fc.Arbitrary<infer T> ? T : never;

/** A walk with replay cuts: the cuts index into the walk's accepted entries. */
const Walk = fc.record({
  choices: fc.array(Choice, { minLength: 1, maxLength: 30 }),
  cuts: fc.array(fc.nat(), { minLength: 1, maxLength: 4 }),
});

const at = <T>(list: ReadonlyArray<T>, n: number): T | undefined => list[n % Math.max(list.length, 1)];

/** Folds a walk by the transition table. Each choice reads the state reached so far. */
const walk = (choices: ReadonlyArray<Choice>): ReadonlyArray<Step> => {
  const steps: Array<Step> = [];
  let s = empty;
  let rev = 0;
  let clock = T0;
  let fresh = 0;

  const entryFor = (
    value: typeof ProcessEvent.Type | typeof Activity.Type,
    by = BRAIN,
    body?: Entry["body"],
  ): Entry => {
    rev++;
    const line = lineFor(from({ by }), value);
    return {
      ...line,
      body: body ?? line.body,
      id: `entry:${rev}`,
      stream: "processes",
      pos: rev,
      rev,
      arrivedAt: clock,
    };
  };

  for (const c of choices) {
    clock += c.gap;
    const lives = [...s.lives.keys()];
    const watches = [...s.watches.values()];
    const unused = PIDS.filter((pid) => !s.lives.has(pid));
    const absent = at(unused, c.pick) ?? X;
    // A known process, or, one time in five or when none exists, one the fold never started.
    const target = c.other % 5 === 0 || lives.length === 0 ? absent : (at(lives, c.pick) ?? absent);
    const life = s.lives.get(target);
    const name = at(NAMES, c.pick) ?? "counter:1";
    const move = c.move;

    if (move < 10) {
      const owner = at(OWNERS, c.other) ?? BRAIN_OWNER;
      const event = ProcessEvent.cases.registered.make({
        name,
        program: c.other % 3 === 0 ? "echo" : "counter",
        owner,
      });
      const entry = entryFor(event);
      s = { ...s, names: put(s.names, name, event) };
      steps.push({ effect: "applied", entry, after: s });
    } else if (move < 25) {
      // A start again for a known life, else a process this walk has not used.
      const process = c.other % 3 === 0 && life !== undefined ? target : (unused[fresh++ % unused.length] ?? absent);
      const code = { program: c.other % 2 === 0 ? CODE.program : "echo", hash: `build-${c.pick % 3}` };
      const entry = entryFor(ProcessEvent.cases.started.make({ process, name, ...code }));
      const started: Life = {
        name,
        state: State.cases.live.make({ process, code }),
        request: Start.cases.first.make({ id: entry.id, name, code }),
        from: entry,
        rev: entry.rev,
      };
      s = { ...s, lives: put(s.lives, process, started), current: put(s.current, name, process) };
      steps.push({ effect: "applied", entry, after: s });
    } else if (move < 55) {
      const restartName = c.other % 4 === 0 ? name : (life?.name ?? name);
      const event =
        move < 35
          ? ProcessEvent.cases.restarted.make({
              process: target,
              after: at(PIDS, c.other) ?? A,
              name: restartName,
              reason: c.reason,
              build: "build-b",
            })
          : move < 45
            ? ProcessEvent.cases.exited.make({ process: target, reason: EXITS[c.reason] })
            : ProcessEvent.cases.down.make({ process: target, reason: c.reason, crashes: c.crashes, until: c.until });
      const entry = entryFor(event);

      if (life === undefined) {
        steps.push({ effect: "bad_row", entry });
        continue;
      }

      if (event._tag === "restarted") {
        const request = Start.cases.again.make({
          id: life.request.id,
          name: event.name,
          code: life.state.code,
          after: event.after,
          reason: event.reason,
        });
        s = {
          ...s,
          lives: put(s.lives, target, { ...life, request }),
          restarts: put(s.restarts, event.name, [...(s.restarts.get(event.name) ?? []), entry.arrivedAt]),
        };
      } else {
        const code = life.state.code;
        s =
          event._tag === "exited"
            ? {
                ...s,
                lives: put(s.lives, target, {
                  ...life,
                  exited: event.reason,
                  state: State.cases.ended.make({ process: target, code, reason: event.reason }),
                }),
              }
            : {
                ...s,
                lives: put(s.lives, target, {
                  ...life,
                  state: State.cases.down.make({
                    process: target,
                    code,
                    reason: c.reason,
                    crashes: c.crashes,
                    until: c.until,
                  }),
                }),
              };
      }

      steps.push({ effect: "applied", entry, after: s });
    } else if (move < 75) {
      // A repeat of a watch the fold holds, live or canceled, else a new recipient and ref.
      const old = c.other % 2 === 0 ? at(watches, c.pick) : undefined;
      const watched = old !== undefined && c.other % 4 !== 0 ? old.process : target;
      const to =
        old?.to ?? (c.pick % 3 === 0 ? CLIENT_TO : Recipient.cases.process.make({ process: at(lives, c.other) ?? B }));
      const ref = old?.ref ?? at(REFS, c.other) ?? "watch-a";
      const entry = entryFor(ProcessEvent.cases.monitored.make({ ref, process: watched, to }));
      const key = keyFor(to, ref);
      const round = (s.watches.get(key)?.round ?? 0) + 1;
      s = { ...s, watches: put(s.watches, key, { tag: "live", ref, process: watched, to, round }) };
      steps.push({ effect: "applied", entry, after: s });
    } else if (move < 85) {
      const old = c.other % 5 === 0 ? undefined : at(watches, c.pick);
      const to = old?.to ?? Recipient.cases.process.make({ process: absent });
      const ref = old?.ref ?? "watch-gone";
      const reason = c.other % 2 === 0 ? "canceled" : "watcher_exited";
      const entry = entryFor(ProcessEvent.cases.demonitored.make({ ref, to, reason }));

      if (old !== undefined) {
        s = { ...s, watches: put(s.watches, keyFor(to, ref), { ...old, tag: "canceled" }) };
      }

      steps.push({ effect: "applied", entry, after: s });
    } else if (move < 92) {
      // A foreign writer's process event, sometimes with a body no schema would decode.
      const event = ProcessEvent.cases.exited.make({ process: absent, reason: EXITS[c.reason] });
      steps.push({
        effect: "ignored",
        entry: entryFor(event, CLIENT, c.other % 2 === 0 ? { process: 7 } : undefined),
        after: s,
      });
    } else if (move < 97) {
      // The brain's own row of a case the process table does not know, sometimes malformed.
      const event = Activity.cases.idle.make({ process: target });
      steps.push({
        effect: "ignored",
        entry: entryFor(event, BRAIN, c.other % 2 === 0 ? { process: [] } : undefined),
        after: s,
      });
    } else {
      // A known brain case whose body does not decode: the same failure as main.
      steps.push({
        effect: "malformed",
        entry: entryFor(ProcessEvent.cases.exited.make({ process: target, reason: CRASHED }), BRAIN, { reason: 7 }),
      });
    }
  }

  return steps;
};

/** The machine's Model in this file's shape: a watch's case read from its `_tag`. */
const folded = (model: Model): Folded => ({
  names: model.names,
  lives: model.lives,
  current: model.current,
  restarts: model.restarts,
  watches: new Map(
    [...model.watches].map(([key, w]) => [
      key,
      { tag: w._tag, ref: w.ref, process: w.process, to: w.to, round: w.round } satisfies Watch,
    ]),
  ),
});

const init = (machine: Machine): Model => machine.init(null, undefined)[0];

const record = (machine: Machine, model: Model, entry: Entry): Model =>
  applyCell(machine, model, { type: "recorded", entry })[0];

const thrown = (run: () => unknown): unknown => {
  const result = Result.try(run);
  return Result.isFailure(result) ? result.failure : undefined;
};

/** The public projection of a live watch, as main returns it. */
const shown = (w: Watch) => ({
  ...ProcessEvent.cases.monitored.make({ ref: w.ref, process: w.process, to: w.to }),
  canceled: false,
  round: w.round,
});

const parent = (s: Folded, process: string, owner: Owned) => {
  const life = s.lives.get(process);
  return life === undefined ? "ended" : sameOwner(s.names.get(life.name)?.owner, owner) ? life : "not_parent";
};

const answer = <A, E extends { readonly reason: string }>(result: Result.Result<A, E>): A | string =>
  Result.isFailure(result) ? result.failure.reason : result.success;

/** A start's answer: a refusal, the saved process to retry, or undefined for a fresh write. */
const started = <A, E extends { readonly reason: string }>(result: Result.Result<Option.Option<A>, E>) =>
  Result.isFailure(result) ? result.failure.reason : Option.getOrUndefined(result.success);

/** The pids a query is asked about: every life the fold holds, and one it does not. */
const pids = (s: Folded): ReadonlyArray<string> => [...s.lives.keys(), PIDS.find((pid) => !s.lives.has(pid)) ?? X];

/** Every query answer, for one reached state, through the public table. */
const answers = (table: ProcessTable, s: Folded) => {
  const caller = (owner: Owned) => ({ owner, recipient: CLIENT_TO });
  const lifecycle = pids(s).map((p) => ({
    life: Option.getOrUndefined(table.life(p)),
    live: table.isLive(p),
    collision: table.collision(p),
    parents: OWNERS.map((owner) => answer(table.parent(p, owner))),
    exits: REASONS.map((reason) => answer(table.exit(p, EXITS[reason], BRAIN_OWNER))),
    downs: answer(table.down(p, "crashed", BRAIN_OWNER)),
    inbound: table.inbound(p),
    outbound: table.outbound(p),
  }));
  const statuses = NAMES.map((name) => OWNERS.map((owner) => answer(table.status(name, owner))));
  const starts = [...s.lives.values()].flatMap((life) => [
    started(table.start(life.request, caller(s.names.get(life.name)?.owner ?? BRAIN_OWNER), life.from)),
    started(table.start({ ...life.request, name: "renamed:1" }, caller(BRAIN_OWNER), life.from)),
  ]);
  const fresh = NAMES.flatMap((name) => [
    started(
      table.start(Start.cases.first.make({ id: `fresh:${name}`, name, code: CODE }), caller(BRAIN_OWNER), from()),
    ),
    ...OWNERS.map((owner) =>
      started(
        table.start(
          Start.cases.again.make({
            id: `again:${name}`,
            name,
            code: CODE,
            after: s.current.get(name) ?? A,
            reason: "crashed",
          }),
          caller(owner),
          from(),
        ),
      ),
    ),
  ]);
  const watches = [
    ...s.watches.values(),
    { tag: "live", ref: "watch-none", process: A, to: CLIENT_TO, round: 0 } as const,
  ].map((w) => ({
    demonitor: Option.getOrUndefined(table.demonitor(w.ref, w.to)),
    monitor: [w.process, B].map((process) => {
      const result = table.monitor(w.ref, process, w.to);
      return Result.isFailure(result) ? result.failure.reason : Option.getOrUndefined(result.success);
    }),
    deliver: deliveries(w).map(({ entry, m, receiver }) => table.deliver(entry, m, receiver)),
  }));
  return { lifecycle, statuses, starts, fresh, watches, info: table.info };
};

/** The signal letters a query asks about for one watch: rounds, targets, writers and receivers. */
const deliveries = (w: Watch) =>
  [...new Set([1, w.round - 1, w.round, w.round + 1])]
    .filter((n) => n >= 1)
    .flatMap((n) =>
      [w.process, B].flatMap((process) =>
        [BRAIN, CLIENT].flatMap((by) =>
          [w.to._tag === "process" ? w.to.process : A, X].map((receiver) => ({
            n,
            by,
            receiver,
            target: process,
            m: Down.make({ ref: w.ref, process, reason: CRASHED, to: w.to }),
            entry: {
              ...lineFor(from({ by }), Down.make({ ref: w.ref, process, reason: CRASHED, to: w.to })),
              id: signalId(w.to, w.ref, n),
              stream: "watcher/inbox",
              pos: 1,
              rev: 1,
              arrivedAt: T0,
            } as Entry,
          })),
        ),
      ),
    );

/** The same answers, read from the transition table alone. */
const expected = (s: Folded) => {
  const live = (p: string) => s.lives.get(p)?.state._tag === "live";
  const liveWatches = [...s.watches.values()].filter((w) => w.tag === "live");
  const lifecycle = pids(s).map((p) => {
    const owned = parent(s, p, BRAIN_OWNER);
    return {
      life: s.lives.get(p),
      live: live(p),
      collision: s.lives.has(p),
      parents: OWNERS.map((owner) => parent(s, p, owner)),
      exits: REASONS.map((reason) =>
        typeof owned === "string"
          ? owned
          : owned.state._tag !== "live" && (owned.exited === undefined || !sameExit(owned.exited, EXITS[reason]))
            ? "ended"
            : owned,
      ),
      downs: typeof owned === "string" ? owned : owned.state._tag === "live" ? "alive" : owned,
      inbound: liveWatches.filter((w) => w.process === p).map(shown),
      outbound: liveWatches.filter((w) => w.to._tag === "process" && w.to.process === p).map(shown),
    };
  });
  const statuses = NAMES.map((name) =>
    OWNERS.map((owner) => {
      const process = s.current.get(name);
      const owned = process === undefined ? "ended" : parent(s, process, owner);
      return typeof owned === "string" ? owned : { name, state: owned.state, restarts: s.restarts.get(name) ?? [] };
    }),
  );
  const lives = [...s.lives.values()];
  // A retry of a saved request answers with its process once the caller owns its name; the same
  // id with another request is reused.
  const starts = lives.flatMap((life) => {
    const retry = parent(s, life.state.process, s.names.get(life.name)?.owner ?? BRAIN_OWNER);
    return [typeof retry === "string" ? retry : { process: life.state.process, rev: life.rev }, "id_reused"];
  });
  const fresh = NAMES.flatMap((name) => {
    const reserved = s.names.get(name);
    return [
      reserved === undefined ? undefined : "name_taken",
      ...OWNERS.map((owner) => {
        const after = s.current.get(name) ?? A;
        return reserved === undefined || !sameOwner(reserved.owner, owner)
          ? "not_parent"
          : reserved.program !== CODE.program
            ? "name_taken"
            : s.current.get(name) !== after
              ? "stale"
              : live(after)
                ? "alive"
                : undefined;
      }),
    ];
  });
  const watches = [
    ...s.watches.values(),
    { tag: "live", ref: "watch-none", process: A, to: CLIENT_TO, round: 0 } as const,
  ].map((w) => {
    const held = s.watches.get(keyFor(w.to, w.ref));
    return {
      demonitor: held?.tag === "live" ? shown(held) : undefined,
      monitor: [w.process, B].map((process) =>
        held !== undefined && held.process !== process
          ? "bad_ref"
          : held?.tag === "live"
            ? undefined
            : w.to._tag === "process" && !live(w.to.process)
              ? "ended"
              : (held?.round ?? 0) + 1,
      ),
      deliver: deliveries(w).map(({ n, by, target, receiver }) =>
        by !== BRAIN || held === undefined || held.process !== target || n > held.round
          ? "mail"
          : n === held.round && held.tag === "live" && held.to._tag === "process" && held.to.process === receiver
            ? "signal"
            : "drop",
      ),
    };
  });
  const info = lives
    .filter((life) => life.state._tag === "live")
    .map((life) => ({
      process: life.state.process,
      name: life.name,
      program: life.state.code.program,
      build: life.state.code.hash,
      restarts: s.restarts.get(life.name)?.length ?? 0,
    }));
  return { lifecycle, statuses, starts, fresh, watches, info };
};

/** Runs a walk through the machine and the table, step by step, and hands each step to `law`. */
const replay = (
  steps: ReadonlyArray<Step>,
  law: (step: Step, log: ReadonlyArray<Entry>, before: Model, machine: Machine) => Model,
): ReadonlyArray<Model> => {
  const machine = processTableFor(BRAIN);
  const models = [init(machine)];
  const log: Array<Entry> = [];

  for (const step of steps) {
    const before = models.at(-1) ?? init(machine);
    const after = law(step, log, before, machine);

    if (step.effect === "applied" || step.effect === "ignored") {
      log.push(step.entry);
      models.push(after);
    }
  }

  return models;
};

describe("ticket 704: the process table's fold is one tea machine", () => {
  it("only known brain events affect state; ignored malformed rows are not decoded", () =>
    fc.assert(
      fc.property(Walk, ({ choices }) => {
        const steps = walk(choices);
        replay(steps, (step, log, before, machine) => {
          if (step.effect === "malformed") {
            const fromMachine = thrown(() => record(machine, before, step.entry));
            const fromTable = thrown(() => new ProcessTable([...log, step.entry], BRAIN));
            expect(fromMachine, "a known brain case with a bad body fails to decode").toBeDefined();
            expect(fromMachine).not.toBeInstanceOf(LedgerError);
            expect(fromTable).toBeDefined();
            expect(fromTable).not.toBeInstanceOf(LedgerError);
            return before;
          }

          if (!("after" in step)) {
            return before;
          }

          const after = record(machine, before, step.entry);
          const table = new ProcessTable([...log, step.entry], BRAIN);

          if (step.effect === "ignored") {
            expect(after, "an ignored row leaves the Model as it was").toEqual(before);
          }

          expect(folded(after)).toEqual(step.after);
          const got = answers(table, step.after);
          expect(got).toEqual(expected(step.after));

          if (step.effect === "ignored") {
            expect(got, "the table answers as if the row were not there").toEqual(
              answers(new ProcessTable(log, BRAIN), step.after),
            );
          }

          return after;
        });
      }),
      RUNS,
    ));

  it("lifecycle folds retain reservation, request, full entry, revision, current pointer, code, reasons and restart times", () =>
    fc.assert(
      fc.property(Walk, ({ choices }) => {
        const steps = walk(choices);
        replay(steps, (step, log, before, machine) => {
          if (!("after" in step)) {
            return before;
          }

          const after = record(machine, before, step.entry);
          const model = folded(after);
          expect(model.names).toEqual(step.after.names);
          expect(model.lives).toEqual(step.after.lives);
          expect(model.current).toEqual(step.after.current);
          expect(model.restarts).toEqual(step.after.restarts);

          for (const [process, life] of step.after.lives) {
            expect(after.lives.get(process)?.from, "the original entry, every field kept").toEqual(life.from);
          }

          const table = new ProcessTable([...log, step.entry], BRAIN);
          const got = answers(table, step.after);
          const want = expected(step.after);
          expect(got.lifecycle.map((p) => p.life)).toEqual(want.lifecycle.map((p) => p.life));
          expect(got.statuses).toEqual(want.statuses);
          expect(got.info).toEqual(want.info);
          return after;
        });
      }),
      RUNS,
    ));

  it("missing lifecycle dependencies fail with bad_row; a missing demonitor is harmless", () =>
    fc.assert(
      fc.property(Walk, ({ choices }) => {
        const steps = walk(choices);
        replay(steps, (step, log, before, machine) => {
          if (step.effect === "bad_row") {
            const fromMachine = thrown(() => record(machine, before, step.entry));
            const fromTable = thrown(() => new ProcessTable([...log, step.entry], BRAIN));
            expect(fromMachine).toBeInstanceOf(LedgerError);
            expect(fromMachine).toMatchObject({ reason: "bad_row" });
            expect(fromTable).toBeInstanceOf(LedgerError);
            expect(fromTable).toMatchObject({ reason: "bad_row" });
            return before;
          }

          if (!("after" in step)) {
            return before;
          }

          const after = record(machine, before, step.entry);
          expect(folded(after)).toEqual(step.after);
          const table = new ProcessTable([...log, step.entry], BRAIN);
          expect(answers(table, step.after)).toEqual(expected(step.after));
          return after;
        });
      }),
      RUNS,
    ));

  it("watches retain identity and count every monitored event; cancellation retains its round", () =>
    fc.assert(
      fc.property(Walk, ({ choices }) => {
        const steps = walk(choices);
        replay(steps, (step, log, before, machine) => {
          if (!("after" in step)) {
            return before;
          }

          const after = record(machine, before, step.entry);
          const model = folded(after);
          expect(model.watches).toEqual(step.after.watches);
          expect([...model.watches.keys()], "insertion order of watches").toEqual([...step.after.watches.keys()]);
          const table = new ProcessTable([...log, step.entry], BRAIN);
          const got = answers(table, step.after).watches;
          const want = expected(step.after).watches;
          expect(got.map((w) => [w.demonitor, w.monitor])).toEqual(want.map((w) => [w.demonitor, w.monitor]));
          return after;
        });
      }),
      RUNS,
    ));

  it("queries preserve refusals, retry answers, insertion order and signal classification", () =>
    fc.assert(
      fc.property(Walk, ({ choices }) => {
        const steps = walk(choices);
        replay(steps, (step, log, before, machine) => {
          if (!("after" in step)) {
            return before;
          }

          const table = new ProcessTable([...log, step.entry], BRAIN);
          expect(answers(table, step.after)).toEqual(expected(step.after));
          return record(machine, before, step.entry);
        });
      }),
      RUNS,
    ));

  it("earlier Models stay unchanged, and replaying a prefix then its suffix equals one replay", () =>
    fc.assert(
      fc.property(Walk, ({ choices, cuts }) => {
        const steps = walk(choices);
        const kept: Array<{ readonly model: Model; readonly copy: Model }> = [];
        const models = replay(steps, (step, _log, before, machine) => {
          if (!("after" in step)) {
            return before;
          }

          kept.push({ model: before, copy: structuredClone(before) });
          return record(machine, before, step.entry);
        });

        for (const { model, copy } of kept) {
          expect(model, "a Model already returned never changes").toEqual(copy);
        }

        const log = steps.flatMap((step) =>
          step.effect === "applied" || step.effect === "ignored" ? [step.entry] : [],
        );
        const last = models.at(-1);
        const machine = processTableFor(BRAIN);

        for (const cut of cuts) {
          const n = cut % (log.length + 1);
          const resumed = log
            .slice(n)
            .reduce((model, entry) => record(machine, model, entry), models[n] ?? init(machine));
          expect(resumed, `resumed after ${n} entries`).toEqual(last);
        }

        const other = processTableFor(BRAIN);
        expect(log.reduce((model, entry) => record(other, model, entry), init(other))).toEqual(last);
        const end = steps.findLast((step) => step.effect === "applied" || step.effect === "ignored");
        const state = end !== undefined && "after" in end ? end.after : empty;
        expect(answers(new ProcessTable(log, BRAIN), state), "a rebuilt table gives the same answers").toEqual(
          expected(state),
        );
      }),
      RUNS,
    ));
});

// Type laws: a Model's collections expose no update operation, and a watch has no canceled flag.
type Held = Model["watches"] extends ReadonlyMap<string, infer W> ? W : never;
type Times = Model["restarts"] extends ReadonlyMap<string, infer T> ? T : never;
expectTypeOf<Model>().toEqualTypeOf<Readonly<Model>>();
expectTypeOf<Model["names"]>().not.toHaveProperty("set");
expectTypeOf<Model["lives"]>().not.toHaveProperty("set");
expectTypeOf<Model["watches"]>().not.toHaveProperty("set");
expectTypeOf<Model["watches"]>().not.toHaveProperty("delete");
expectTypeOf<Model["current"]>().not.toHaveProperty("set");
expectTypeOf<Model["restarts"]>().not.toHaveProperty("set");
expectTypeOf<Times>().not.toHaveProperty("push");
// Each case on its own: `keyof` of a union keeps only the keys every case shares.
type Fields<T> = T extends unknown ? keyof T : never;
expectTypeOf<"canceled" extends Fields<Held> ? true : false>().toEqualTypeOf<false>();
expectTypeOf<Held["_tag"]>().toEqualTypeOf<"live" | "canceled">();
