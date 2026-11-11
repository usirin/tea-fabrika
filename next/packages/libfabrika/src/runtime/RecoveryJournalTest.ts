// P34c slice 2, J2, J4, J5, J6, J7, J9 and J12 on real stores (0062): the laws, and no driver. The
// module that owns a driver calls `RecoveryJournalTest.suite(rig)`; `rig.open` acquires one store in
// a scope and gives it back when that scope closes (0061).
//
// Generator contract: a fast-check decision tape, folded through the runner's public calls. Each cell
// reads the fold's account (letters and their tries, the live process, saved requests, an armed cut)
// and picks a move possible now. After every move the fold settles recovery through `open` and `due`,
// then checks committed lifecycle rows, receipts, inbox, checkpoints and execution counts against its
// own account, never against the runner's saved model.
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import { Clock, type Context, Effect, Exit, Layer, Option, Schema, type Scope } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { InputId, LedgerError, type Sql, Writer } from "../coordination/index.ts";
import { ExitReason } from "../processes/ExitReason.ts";
import { type From, Mailbox } from "../processes/Mailbox.ts";
import { Activity, Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, WatcherManager } from "./Entry.ts";
import { ProcessStore } from "./ProcessStore.ts";
import { Input, ProgramDown } from "./Program.ts";
import { RecoveryStore } from "./RecoveryStore.ts";
import { ProgramRunner, Sent } from "./Runner.ts";

/** One real store. `reopen` closes it and opens the same database again, keeping only its rows. */
export type Store = { readonly sql: Sql; readonly reopen: Effect.Effect<void> };

/** A committed ledger entry, as the driver's module reads it back: stream, id, event case and body. */
export type Row = { readonly stream: string; readonly id: string; readonly event: string; readonly body: unknown };

/** What a process store reads through: the ledger the driver's module wires. */
type StoreNeeds = ReturnType<typeof ProcessStore.layer> extends Layer.Layer<infer _A, infer _E, infer R> ? R : never;

/** What the driver's module gives: stores, the coordination over a ledger store, and its rows. */
export type Rig = {
  readonly open: Effect.Effect<Store, never, Scope.Scope>;
  readonly coordination: (sql: Sql, next: Effect.Effect<string>) => Layer.Layer<ProcessManager | Mailbox | StoreNeeds>;
  readonly rows: (sql: Sql) => ReadonlyArray<Row>;
};

const NAME = "counter:1";
const BUILD = "build-a";
const SEED = 119120;
const RUNS = 40;
const CUTS = ["after_observation", "after_dead", "after_exit", "after_start", "after_checkpoint"] as const;
const pid = (n: number): string => `process_0000000000e00800${String(n).padStart(10, "0")}`;

const from = (): From => ({
  by: "SHA256:brain",
  for: "person_01m6v5270hf3c8x2q7w9z4k5mn",
  sentAt: "2026-11-07T21:10:01.204Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "writer-build",
});

const person = Writer.cases.person.make({ key: "SHA256:person", for: from().for });

const Model = Schema.Struct({ count: Schema.Int });

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("add"), n: Schema.Int }),
  Schema.Struct({ type: Schema.Literal("poison"), key: Schema.String }),
]);

/** An Error whose class is named `name`, as a program's own error class would be. */
const thrown = (name: string): Error => {
  const named = { [name]: class extends Error {} }[name] ?? Error;
  return new named("private failure text");
};

/** One item of a list, chosen by a tape value. Each caller offers the move only when the list has one. */
const nth = <A>(items: ReadonlyArray<A>, pick: number): A =>
  Option.getOrThrow(Option.fromNullishOr(items[pick % Math.max(items.length, 1)]));

/** The answer and saved result of a dead letter. */
const DEAD = Sent.cases.refused.make({ reason: "dead" });

type Move =
  | "fresh"
  | "resend"
  | "add"
  | "saved"
  | "transport"
  | "interrupt"
  | "restart"
  | "restart_again"
  | "restart_conflict"
  | "foreign"
  | "save_fail"
  | "lost_observation"
  | "lost_write"
  | "reopen";

const Cell = fc.record({
  move: fc.noBias(fc.nat()),
  pick: fc.noBias(fc.nat()),
  cut: fc.option(fc.constantFrom(...CUTS), { nil: null }),
  error: fc.stringMatching(/^[A-Z][A-Za-z0-9_]{0,15}$/),
});
type Cell = typeof Cell.Type;

const Limits = fc.record({
  wiring: fc.option(fc.integer({ min: 1, max: 4 }), { nil: undefined }),
  program: fc.option(fc.integer({ min: 1, max: 4 }), { nil: undefined }),
});

const Tape = fc.array(Cell, { minLength: 2, maxLength: 8 });

/** What the fold knows from its own moves alone. */
type Account = {
  process: string;
  pids: number;
  letters: Map<string, { errors: Array<string>; dead: string | null; accepted: boolean }>;
  saved: Array<string>;
  exits: Array<{ process: string; reason: ExitReason }>;
  successors: number;
  requests: Map<string, string>;
  steps: Map<string, number>;
  /** A person's restart starts fresh; a crash recovery carries the checkpoint. */
  freshInit: boolean | null;
};

const world = Effect.fnUntraced(function* (rig: Rig, limits: typeof Limits.Type) {
  const ledger = yield* rig.open;
  const state = yield* rig.open;
  const controls = {
    throws: false,
    error: "TypeError",
    savedThrows: false,
    transport: false,
    cut: "" as string,
    hits: [] as Array<string>,
    /** Fail every write to the state store while set: the recovery save cannot commit. */
    saveFail: false,
    /** The store goes down the moment the step throws: its observation cannot commit. */
    dropStore: false,
    /** Fail the next ledger entry insert after skipping this many: a lifecycle write is lost. */
    loseEntry: null as number | null,
    steps: new Map<string, number>(),
    inits: [] as Array<unknown>,
  };
  let alarm: number | null = null;
  let n = 0;
  const next = Effect.sync(() => pid(++n));
  const ledgerSql: Sql = {
    exec: (query, ...params) => {
      if (controls.loseEntry !== null && /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+entries\b/i.test(query)) {
        if (controls.loseEntry === 0) {
          controls.loseEntry = null;
          throw new Error("SQLITE_IOERR planted before a lifecycle write");
        }

        controls.loseEntry--;
      }

      return ledger.sql.exec(query, ...params);
    },
    transaction: (step) => ledger.sql.transaction(step),
    size: () => ledger.sql.size(),
  };
  const stateSql: Sql = {
    exec: (query, ...params) => {
      if (controls.saveFail && /^\s*(INSERT|UPDATE|REPLACE|DELETE)/i.test(query)) {
        throw new Error("SQLITE_FULL planted on the state store");
      }

      return state.sql.exec(query, ...params);
    },
    transaction: (step) => state.sql.transaction(step),
    size: () => state.sql.size(),
  };
  const coordination = rig.coordination(ledgerSql, next);
  const program = {
    name: "counter",
    ...(limits.program === undefined ? {} : { maxDeliveries: limits.program }),
    machine: Machine.make({
      model: Model,
      msg: Msg,
      cmds: [],
      init: (loaded) => {
        controls.inits.push(loaded ?? null);
        return [loaded ?? { count: 0 }, []];
      },
      update: {
        add: (s, m) => {
          if (controls.savedThrows) {
            throw thrown(controls.error);
          }

          return [{ count: s.count + m.n }, []];
        },
        poison: (s, m) => {
          controls.steps.set(m.key, (controls.steps.get(m.key) ?? 0) + 1);

          if (controls.throws) {
            controls.saveFail = controls.saveFail || controls.dropStore;
            throw thrown(controls.error);
          }

          return [{ count: s.count + 1 }, []];
        },
      },
    }),
    state: { v: 1, schema: Model, upgrades: [] },
    msg: Msg,
    view: { data: Model, select: (s: typeof Model.Type) => s },
    refuse: () => null,
    inputs: {
      add: Input.cases.write.make({ schema: Msg, description: "Add", personOnly: false }),
      poison: Input.cases.write.make({ schema: Msg, description: "Poison", personOnly: false }),
    },
    outputs: {},
    writes: {},
    wake: () => null,
  } as const;
  const layer = () => {
    const loader = Layer.effect(
      ProgramLoader,
      Effect.gen(function* () {
        const real = yield* ProgramLoader;
        return {
          load: (name: string, build?: string) =>
            Effect.map(real.load(name, build), (loaded) => ({
              ...loaded,
              execution: {
                ...loaded.execution,
                // Transport loss decides nothing about the input: the program never sees it.
                step: (model: unknown, msg: unknown) =>
                  controls.transport
                    ? Effect.fail(new ProgramDown({ reason: "step", source: "rpc" }))
                    : loaded.execution.step(model, msg),
              },
            })),
        };
      }),
    ).pipe(Layer.provide(ProgramLoader.layer({ counter: program }, {})));
    const checked = Layer.effect(
      CheckedWriter,
      Effect.map(Mailbox, (mailbox) => ({
        append: (i: Incoming) =>
          mailbox.send(NAME, i.id, i.envelope.input, { ...from(), by: i.envelope.by.key, parent: i.envelope.id }),
        commit: () => Effect.die("no write declared"),
        own: () => Effect.die("no write declared"),
      })),
    );
    return ProgramRunner.layer(
      { id: A0, name: NAME, program: "counter", build: BUILD, owner: person },
      {
        policy: {
          ...(limits.wiring === undefined ? {} : { maxDeliveries: limits.wiring }),
          intensity: 32,
          periodMs: 1_000_000,
          backoff: { minMs: 1, maxMs: 1, resetAfterMs: 1_000_000 },
        },
        recovery: { sql: stateSql, name: NAME, capacity: 1024 ** 3 },
        fault: (cut) =>
          Effect.suspend(() => {
            if (controls.cut !== cut) {
              return Effect.void;
            }

            controls.cut = "";
            controls.hits.push(cut);
            return Effect.fail(new LedgerError({ reason: "unreachable" }));
          }),
      },
    ).pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          loader,
          checked,
          ProcessStore.layer(stateSql, { process: A0 }),
          Layer.succeed(WatcherManager, { publish: () => Effect.void }),
          Layer.succeed(Alarm, {
            set: (at) =>
              Effect.sync(() => {
                alarm = at;
              }),
          }),
          Layer.succeed(Recording, { flush: Effect.void }),
        ).pipe(Layer.provideMerge(coordination)),
      ),
    );
  };
  /** One live runner, as an object keeps one between calls; a reopen ends it and builds another. */
  let live: Context.Context<ProgramRunner> | null = null;
  const current = Effect.suspend(() =>
    live !== null
      ? Effect.succeed(live)
      : Effect.tap(Layer.build(layer()), (built) =>
          Effect.sync(() => {
            live = built;
          }),
        ),
  );
  const runner = <A, E>(f: (r: ProgramRunner["Service"]) => Effect.Effect<A, E>) =>
    Effect.flatMap(current, (built) => ProgramRunner.use(f).pipe(Effect.provide(built), Effect.exit));
  const manager = <A, E>(f: (p: ProcessManager["Service"]) => Effect.Effect<A, E>) =>
    ProcessManager.use(f).pipe(Effect.provide(coordination));
  const store = <A, E>(f: (s: ProcessStore["Service"]) => Effect.Effect<A, E>) =>
    ProcessStore.use(f).pipe(
      Effect.provide(ProcessStore.layer(stateSql, { process: A0 }).pipe(Layer.provide(coordination))),
    );
  const recovery = <A, E>(f: (s: RecoveryStore["Service"]) => Effect.Effect<A, E>) =>
    RecoveryStore.use(f).pipe(Effect.provide(RecoveryStore.layer(stateSql, { name: NAME, capacity: 1024 ** 3 })));
  const reopen = Effect.andThen(ledger.reopen, state.reopen).pipe(
    Effect.andThen(
      Effect.sync(() => {
        live = null;
      }),
    ),
  );
  /** Places a letter behind the live process's checkpoint, as an accepted turn the next load folds. */
  const place = (process: string, id: string) =>
    Effect.gen(function* () {
      const own = yield* (yield* ProcessStore).select(process);
      const saved = yield* own.load;

      if (saved === null) {
        return false;
      }

      const sent = yield* Mailbox.use((box) => box.send(NAME, id, { type: "add", n: 1 }, from()));

      if (sent._tag !== "placed") {
        return false;
      }

      yield* own.save(saved, [{ id, rev: sent.rev, pos: sent.pos }]);
      return true;
    }).pipe(
      Effect.provide(ProcessStore.layer(stateSql, { process: A0 }).pipe(Layer.provideMerge(coordination))),
      Effect.orDie,
    );
  /** Drives recovery to a live, loaded successor: open resumes saved work, due runs a due wait. */
  const settle = Effect.gen(function* () {
    for (let round = 0; round < 12; round++) {
      const opened = yield* runner((r) => r.open(`settle-${round}`));
      const status = yield* manager((p) => p.status(NAME));

      if (Exit.isSuccess(opened) && status.state._tag === "live") {
        return;
      }

      if (alarm !== null) {
        const now = yield* Clock.currentTimeMillis;
        const at = Math.max(now, alarm);
        yield* TestClock.setTime(at);
        yield* runner((r) => r.due(at));
      }
    }

    expect.fail("recovery did not settle to a live successor");
  });
  const input = (id: string, m: unknown): Incoming => ({
    id,
    envelope: {
      id: Schema.decodeUnknownSync(InputId)(`input_0000000000e008${(++inputs).toString(16).padStart(12, "0")}`),
      by: person,
      arrivedAt: 0,
      input: m,
    },
    sentAt: "2099-01-01T00:00:00Z",
    seen: 0,
    span: { traceId: from().traceId, spanId: "00f067aa0ba902b7" },
  });
  let inputs = 0;
  const bodies = new Map<string, Incoming>();
  /** The same delivery each time a letter is resent: its id and its body. */
  const letter = (id: string, m: unknown): Incoming => {
    const known = bodies.get(id) ?? input(id, m);
    bodies.set(id, known);
    return known;
  };
  return {
    controls,
    rows: () => rig.rows(ledgerSql),
    runner,
    manager,
    store,
    recovery,
    reopen,
    settle,
    letter,
    place,
    boot: manager((p) =>
      p.start(
        Start.cases.first.make({ id: "start:counter:1", name: NAME, code: { program: "counter", hash: BUILD } }),
        from(),
      ),
    ),
  };
});

const A0 = pid(1);

const law = (
  rig: Rig,
  name: string,
  moves: ReadonlyArray<Move>,
  required: ReadonlyArray<Move | (typeof CUTS)[number]>,
) =>
  it.effect(
    name,
    () =>
      Effect.gen(function* () {
        const done = new Set<string>();
        const law = (limits: typeof Limits.Type, tape: ReadonlyArray<Cell>) =>
          Effect.scoped(walk(rig, limits, tape, moves, done)).pipe(Effect.provide(TestClock.layer()));
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
        const property = fc.asyncProperty(Limits, Tape, (limits, tape) => Effect.runPromise(law(limits, tape)));
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, { seed: SEED, numRuns: RUNS, includeErrorInReport: true }));
        // An empty flow cannot pass: each move and cut this law is about ran.
        expect([...done]).toEqual(expect.arrayContaining([...required]));
      }),
    600_000,
  );

const walk = (
  rig: Rig,
  limits: typeof Limits.Type,
  tape: ReadonlyArray<Cell>,
  allowed: ReadonlyArray<Move>,
  done: Set<string>,
) =>
  Effect.gen(function* () {
    const w = yield* world(rig, limits);
    yield* w.boot;
    const limit = limits.program ?? limits.wiring ?? 3;
    const a: Account = {
      process: A0,
      pids: 1,
      letters: new Map(),
      saved: [],
      exits: [],
      successors: 0,
      requests: new Map(),
      steps: new Map(),
      freshInit: null,
    };
    // One good letter, so the live process has a checkpoint a saved letter can sit behind.
    expect(Exit.isSuccess(yield* w.runner((r) => r.msg(w.letter("good-0", { type: "add", n: 1 }))))).toBe(true);
    a.letters.set("good-0", { errors: [], dead: null, accepted: true });
    /** A recovery the runner performs: the next process ID is its successor. */
    const recovered = () => {
      a.successors++;
      a.process = pid(++a.pids);
    };
    const crashed = (phase: "step" | "saved_letter", error: string) => ExitReason.cases.crashed.make({ phase, error });

    for (const [index, cell] of tape.entries()) {
      const open = [...a.letters].filter(([id, l]) => id.startsWith("poison") && l.dead === null);
      const dead = [...a.letters].filter(([, l]) => l.dead !== null);
      const options = allowed.filter(
        (move) =>
          (move !== "resend" || open.length + dead.length > 0) &&
          (move !== "restart_again" && move !== "restart_conflict" ? true : a.requests.size > 0),
      );
      const move = nth(options, cell.move);
      const cut = cell.cut;
      w.controls.cut = cut ?? "";
      w.controls.error = cell.error;

      switch (move) {
        case "fresh":
        case "resend": {
          const pool = move === "fresh" ? [] : [...open, ...dead];
          const id = move === "fresh" ? `poison-${index}` : nth(pool, cell.pick)[0];
          const known = a.letters.get(id) ?? { errors: [], dead: null, accepted: false };
          a.letters.set(id, known);
          w.controls.throws = true;
          const before = w.controls.steps.get(id) ?? 0;
          const sent = yield* w.runner((r) => r.msg(w.letter(id, { type: "poison", key: id })));
          w.controls.throws = false;

          if (known.dead !== null) {
            // A resend of a dead letter answers its saved result: no try, no dead entry, no exit.
            expect(Exit.isSuccess(sent) ? sent.value : sent, "a dead letter's resend answers dead").toEqual(DEAD);
            expect(w.controls.steps.get(id) ?? 0).toBe(before);
            break;
          }

          known.errors.push(cell.error);
          a.steps.set(id, (a.steps.get(id) ?? 0) + 1);
          a.exits.push({ process: a.process, reason: crashed("step", cell.error) });

          if (known.errors.length >= limit) {
            known.dead = a.process;
          }

          yield* w.settle;
          recovered();
          break;
        }
        case "add": {
          const id = `add-${index}`;
          const sent = yield* w.runner((r) => r.msg(w.letter(id, { type: "add", n: 1 })));

          if (Exit.isSuccess(sent)) {
            a.letters.set(id, { errors: [], dead: null, accepted: true });
          } else {
            yield* w.settle;
          }

          break;
        }
        case "saved": {
          const id = `saved-${index}`;

          if (!(yield* w.place(a.process, id))) {
            break;
          }

          // The saved letter's fold throws when the reopened process catches up: a saved-letter crash.
          w.controls.savedThrows = true;
          yield* w.reopen;
          yield* w.runner((r) => r.open("saved"));
          w.controls.savedThrows = false;
          a.saved.push(id);
          a.exits.push({ process: a.process, reason: crashed("saved_letter", cell.error) });
          yield* w.settle;
          recovered();
          break;
        }
        case "transport": {
          const id = open.length > 0 && cell.pick % 2 === 0 ? nth(open, cell.pick)[0] : `poison-${index}`;
          const known = a.letters.get(id) ?? { errors: [], dead: null, accepted: false };
          a.letters.set(id, known);
          w.controls.transport = true;
          w.controls.cut = "";
          const sent = yield* w.runner((r) => r.msg(w.letter(id, { type: "poison", key: id })));
          w.controls.transport = false;
          expect(Exit.isFailure(sent), "transport loss fails the call, and decides nothing").toBe(true);
          break;
        }
        case "interrupt": {
          const marker = Activity.cases.stepping.make({ process: a.process, letter: `cut-${index}`, build: BUILD });
          const process = a.process;
          yield* w.store((s) => Effect.flatMap(s.select(process), (own) => own.activity(marker)));
          yield* w.reopen;
          a.exits.push({ process: a.process, reason: ExitReason.cases.crashed.make({ phase: "interrupted" }) });
          yield* w.settle;
          recovered();
          break;
        }
        case "restart": {
          const id = `restart-${index}`;
          const build = cell.pick % 2 === 0 ? BUILD : "build-b";
          a.requests.set(id, build);
          w.controls.inits.length = 0;
          yield* w.runner((r) => r.restart({ id, build }));
          a.exits.push({ process: a.process, reason: ExitReason.cases.shutdown.make({}) });
          yield* w.settle;
          recovered();
          a.freshInit = true;
          break;
        }
        case "restart_again": {
          // An equal retry answers from saved work: no second exit, no second successor.
          const [id, build] = nth([...a.requests], cell.pick);
          w.controls.cut = "";
          expect(Exit.isSuccess(yield* w.runner((r) => r.restart({ id, build })))).toBe(true);
          break;
        }
        case "restart_conflict": {
          const [id, build] = nth([...a.requests], cell.pick);
          w.controls.cut = "";
          const refused = yield* w.runner((r) => r.restart({ id, build: `${build}-other` }));
          expect(Exit.isFailure(refused), "a request ID reused with another build is refused").toBe(true);
          break;
        }
        case "foreign": {
          // Crash, then another starter places a successor while this recovery waits.
          const id = `poison-${index}`;
          a.letters.set(id, { errors: [cell.error], dead: limit <= 1 ? a.process : null, accepted: false });
          a.steps.set(id, 1);
          w.controls.throws = true;
          w.controls.cut = "";
          yield* w.runner((r) => r.msg(w.letter(id, { type: "poison", key: id })));
          w.controls.throws = false;
          a.exits.push({ process: a.process, reason: crashed("step", cell.error) });
          const status = yield* w.manager((p) => p.status(NAME));

          if (status.state._tag !== "live") {
            yield* w.manager((p) =>
              p.start(
                Start.cases.again.make({
                  id: `foreign:${index}`,
                  name: NAME,
                  after: a.process,
                  reason: "crashed",
                  code: { program: "counter", hash: BUILD },
                }),
                from(),
              ),
            );
            done.add("adopted");
          }

          w.controls.cut = cut ?? "";
          yield* w.settle;
          recovered();
          break;
        }
        case "save_fail": {
          // Nothing the failed save described is durable, and nothing of it is installed.
          const id = `poison-${index}`;
          const before = yield* w.recovery((s) => s.load);
          w.controls.saveFail = true;
          w.controls.throws = true;
          const sent = yield* w.runner((r) => r.msg(w.letter(id, { type: "poison", key: id })));
          w.controls.saveFail = false;
          w.controls.throws = false;
          expect(Exit.isFailure(sent), "a failed recovery save fails the call").toBe(true);
          expect(yield* w.recovery((s) => s.load), "the durable journal is unchanged").toEqual(before);
          expect(w.controls.steps.get(id) ?? 0, "an unsaved attempt never runs").toBe(0);
          w.controls.cut = "";
          yield* w.settle;
          break;
        }
        case "lost_observation": {
          // The step throws as the store goes down. Its class was never captured, so no fact may claim
          // it; the saved attempt stays, and reopening records one interruption for it.
          const id = `poison-${index}`;
          const lost = `Lost${index}`;
          a.letters.set(id, { errors: [], dead: null, accepted: false });
          a.steps.set(id, 1);
          w.controls.cut = "";
          w.controls.error = lost;
          w.controls.dropStore = true;
          w.controls.throws = true;
          const sent = yield* w.runner((r) => r.msg(w.letter(id, { type: "poison", key: id })));
          w.controls.throws = false;
          w.controls.dropStore = false;
          w.controls.saveFail = false;
          expect(Exit.isFailure(sent)).toBe(true);
          // The same live runner goes on; then the object restarts.
          yield* w.runner((r) => r.open("after-lost-save"));
          yield* w.reopen;
          a.exits.push({ process: a.process, reason: ExitReason.cases.crashed.make({ phase: "interrupted" }) });
          yield* w.settle;
          recovered();
          const receipt = yield* w.recovery((s) => s.receipt(id));
          expect(JSON.stringify([w.rows(), receipt]).includes(lost), "an uncaptured class survives nowhere").toBe(
            false,
          );
          break;
        }
        case "lost_write": {
          // The dead or exit write of this crash fails before it commits; recovery writes it once.
          const id = `poison-${index}`;
          const known = { errors: [cell.error], dead: limit <= 1 ? a.process : null, accepted: false };
          a.letters.set(id, known);
          a.steps.set(id, 1);
          w.controls.loseEntry = cell.pick % 2;
          w.controls.throws = true;
          yield* w.runner((r) => r.msg(w.letter(id, { type: "poison", key: id })));
          w.controls.throws = false;
          w.controls.loseEntry = null;
          a.exits.push({ process: a.process, reason: crashed("step", cell.error) });
          yield* w.reopen;
          yield* w.settle;
          recovered();
          break;
        }
        case "reopen":
          yield* w.reopen;
          yield* w.settle;
          break;
      }

      done.add(move);

      for (const hit of w.controls.hits) {
        done.add(hit);
      }

      w.controls.hits.length = 0;
      w.controls.cut = "";
      yield* w.settle;
      yield* check(w, a, limit);
    }
  });

const check = Effect.fnUntraced(function* (w: Effect.Success<ReturnType<typeof world>>, a: Account, limit: number) {
  const rows = w.rows();
  const lifecycle = rows.filter((row) => row.stream === `processes/${NAME}`);
  const exits = lifecycle
    .filter((row) => row.event === "exited")
    .map((row) => row.body as { process: string; reason: unknown })
    .map(({ process, reason }) => ({ process, reason }));
  // J2, J12: each exit once, in order, with its producer's reason, through every cut and retry.
  expect(exits, "each exit is written once with its slice-1 reason").toEqual(a.exits);
  // J2, J6, J7: one successor per recovery; a cut start or transfer never starts another.
  expect(
    lifecycle.filter((row) => row.event === "restarted"),
    "one successor per recovery",
  ).toHaveLength(a.successors);
  const status = yield* w.manager((p) => p.status(NAME));
  expect([status.state._tag, status.state.process], "the live process is the one recovery reached").toEqual([
    "live",
    a.process,
  ]);

  // J4: exact per-letter accounting and the dead letter's own process.
  const dead = rows.filter((row) => row.stream.endsWith("/dead"));
  const expectedDead = [...a.letters].filter(([, l]) => l.dead !== null);
  expect(dead, "one dead entry per dead letter").toHaveLength(expectedDead.length);

  for (const [id, l] of a.letters) {
    const receipt = yield* w.recovery((s) => s.receipt(id));

    if (l.accepted) {
      // J9: an accepted letter keeps only its digest.
      expect(receipt, `accepted ${id}`).toMatchObject({ input: null, tries: 0, result: null });
      continue;
    }

    if (l.errors.length > 0) {
      expect(receipt, `letter ${id}'s receipt`).toMatchObject({
        errors: l.errors,
        tries: l.errors.length,
        result: l.dead === null ? null : DEAD,
      });
      // J9: a failed delivery keeps its original input.
      expect((receipt as { input: unknown } | null)?.input, `letter ${id} keeps its input`).not.toBeNull();
    }

    expect(w.controls.steps.get(id) ?? 0, `letter ${id} runs once per counted try`).toBe(a.steps.get(id) ?? 0);

    if (l.dead !== null) {
      expect(l.errors.length).toBeLessThanOrEqual(limit);
      expect(
        dead.filter((row) => row.stream === `${l.dead}/dead`).map((row) => row.body),
        `dead ${id}`,
      ).toEqual([expect.objectContaining({ m: id, errors: l.errors, tries: l.errors.length })]);
    }
  }

  // J5: a saved letter stays in the inbox and is never a dead letter.
  const inbox = rows.filter((row) => row.stream === `${NAME}/inbox`).map((row) => row.id);

  for (const id of a.saved) {
    expect(inbox).toContain(id);
    expect(dead.some((row) => (row.body as { m?: unknown }).m === id)).toBe(false);
  }

  // J6: a person's restart starts its successor fresh; a crash recovery carries the checkpoint.
  if (a.freshInit === true) {
    expect(w.controls.inits[0], "a person's restart initializes from nothing").toBeNull();
    a.freshInit = null;
  }
});

/** J2, J4, J5, J6, J7, J9 and J12 over one real store. */
export const suite = (rig: Rig): void => {
  describe("P34c slice 2: the runner drives one saved journal through real stores", () => {
    law(
      rig,
      "J2: every durable cut, lost write and reopen resumes without losing work or duplicating a lifecycle fact",
      ["fresh", "resend", "interrupt", "restart", "lost_write", "reopen"],
      ["fresh", "lost_write", "reopen", "after_observation", "after_exit", "after_start", "after_checkpoint"],
    );
    law(
      rig,
      "J4 / p80: fresh throws keep exact per-letter accounting and the dead letter's own process, across replacements",
      ["fresh", "resend", "add"],
      ["fresh", "resend", "add", "after_dead"],
    );
    law(
      rig,
      "J5 / p80: saved failures keep every saved letter; transport loss spends no delivery",
      ["saved", "transport", "fresh", "add"],
      ["saved", "transport", "fresh"],
    );
    law(
      rig,
      "J6: a person's restart completes once per request, refuses a conflicting reuse, and starts fresh",
      ["restart", "restart_again", "restart_conflict", "fresh", "reopen"],
      ["restart", "restart_again", "restart_conflict", "after_exit", "after_checkpoint"],
    );
    law(
      rig,
      "J7: checkpointing keeps one specific successor, the runner's own or an adopted one",
      ["foreign", "fresh", "restart", "add"],
      ["foreign", "adopted", "after_start", "after_checkpoint"],
    );
    law(
      rig,
      "J9: a failed save leaves the durable and installed journal unchanged; split receipts stay whole",
      ["save_fail", "lost_observation", "fresh", "add", "resend", "reopen"],
      ["save_fail", "lost_observation", "add", "fresh"],
    );
    law(
      rig,
      "J12: slice-1 reasons and captured classes survive cut and retried recovery writes",
      ["fresh", "saved", "interrupt", "restart", "lost_write"],
      ["fresh", "saved", "interrupt", "restart", "after_exit"],
    );
  });
};
