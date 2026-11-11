// P41 slice 1, L3, L4, L5, L6, L8 and L11 on a real store (0062): program mail's delivery, fencing
// and records, and no driver. A runner in the module that owns a driver calls
// `ProgramMailTest.suite(open)`; `open` acquires one store in a scope and gives it back when that
// scope closes.
//
// The contract these laws pin, from the plan's Files table (ticket 744):
//   ProgramMail.ts: the `ProgramMail` service, whose `deliver(delivery)` answers the accepted
//     `Receipt` or fails with `ProgramMailError`, whose `reason` is a `MailRefusal` or `storage`.
//   ProgramMailLedger.ts: `layer({ grants })`, the host's closed destinations for each source,
//     built over the ledger and its transaction.
// A receipt's ID is the dispatched command's `/mail` child, and that is also the inbox letter's ID.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Result, type Scope, Stream } from "effect";
import * as fc from "fast-check";
import type { Sql, SqlValue } from "../Sql.ts";
import { type From, Mailbox } from "./Mailbox.ts";
import { BRAIN, brain, copied, data, from, ids, PIDS, SHUTDOWN } from "./Process.test-support.ts";
import { Start } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";
import { type Grants, type MailRefusal, ProgramMail, ProgramMailError, type Receipt } from "./ProgramMail.ts";
import * as ProgramMailLedger from "./ProgramMailLedger.ts";

/** One real store. `reopen` closes it and opens the same database again, keeping only its rows. */
export type Store = { readonly sql: Sql; readonly reopen: Effect.Effect<void> };

const SEED = 119120;
const REQUESTER = "requester:1";
const RESPONDER = "responder:1";
/** Granted to the requester, registered only by a move. */
const HELPER = "helper:1";
/** Registered at boot and granted to nobody. */
const STRANGER = "stranger:1";
/** Granted to the requester and never registered. */
const GHOST = "ghost:1";
const SOURCES = [REQUESTER, RESPONDER] as const;
const NAMES = [REQUESTER, RESPONDER, HELPER, STRANGER, GHOST] as const;
const CODE = { program: "mail", hash: "build-a" };

/** The host's closed grant: each source reaches only the names listed for it. */
const GRANTS: Grants = { [REQUESTER]: [RESPONDER, HELPER, GHOST], [RESPONDER]: [REQUESTER] };
const granted = (source: string, to: string) => (Object.hasOwn(GRANTS, source) ? GRANTS[source] : []).includes(to);

type Delivery = Parameters<ProgramMail["Service"]["deliver"]>[0];

/** What the fold knows, from its own moves only: never read back from the product. */
type World = {
  /** Each registered name's current life. */
  readonly lives: Map<string, { process: string; live: boolean }>;
  /** Every life a name had before its current one, and every stopped life: none may send. */
  readonly stale: Array<{ readonly name: string; readonly process: string }>;
  /** Each accepted command, with the first delivery and the receipt it answered. */
  readonly sent: Map<string, { readonly delivery: Delivery; readonly receipt: Receipt }>;
  /** Deliveries a cut stopped: nothing of them may be on disk. */
  readonly cut: Array<Delivery>;
  /** Each inbox's letters in order: the delivery ID and the first delivery's facts. */
  readonly inbox: Map<string, Array<{ readonly id: string; readonly m: unknown; readonly from: From }>>;
  /** The target's lifecycle state at each acceptance, by command. */
  readonly targetState: Map<string, "live" | "ended">;
  next: number;
  pids: number;
};

/** Values Schema.Json refuses: a function, a bigint, a symbol, `undefined`. */
const BAD: ReadonlyArray<() => unknown> = [
  () => ({ type: "request", f: () => 1 }),
  () => [1n],
  () => undefined,
  () => ({ type: "request", s: Symbol("x") }),
];

const Cell = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  alt: fc.nat(),
  m: fc.jsonValue({ maxDepth: 2 }).map((m) => copied({ type: "request", body: m })),
  clock: fc.integer({ min: 0, max: 86_400_000 }),
  build: fc.constantFrom("build-a", "build-b", "build-c"),
  trace: fc.stringMatching(/^[0-9a-f]{32}$/),
});
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;
const Tape = fc.array(Cell, { minLength: 8, maxLength: 32, size: "max" });

type Move =
  | "send"
  | "bad"
  | "retry_same"
  | "retry_other"
  | "stop"
  | "restart"
  | "stale_send"
  | "register"
  | "cut"
  | "retry_cut"
  | "reopen";

/** A writer's own facts for one cell: its clock, build and trace vary, so a retry can differ. */
const said = (cell: Cell, over: Partial<From> = {}): From =>
  from({
    by: "SHA256:program-writer",
    sentAt: new Date(Date.UTC(2026, 10, 11) + cell.clock).toISOString(),
    build: cell.build,
    traceId: cell.trace,
    ...over,
  });

/** The store's Sql, with a cut that throws on the `after`-th INSERT of the next call. */
const cutting = (sql: Sql) => {
  const fault = { after: null as number | null, hit: false };
  const wrapped: Sql = {
    exec: (query, ...params) => {
      if (/^\s*INSERT\b/i.test(query) && fault.after !== null) {
        if (fault.after === 0) {
          fault.after = null;
          fault.hit = true;
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

/** Every row of every table, so "nothing was written" covers whatever table the receipt lives in. */
const snapshot = (sql: Sql): Record<string, ReadonlyArray<Record<string, SqlValue>>> => {
  const tables = sql
    .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, sql.exec(`SELECT * FROM "${table}"`)]));
};

const layer = (sql: Sql, next: Effect.Effect<string>) =>
  ProgramMailLedger.layer({ grants: GRANTS }).pipe(
    Layer.provideMerge(
      ProcessManager.layer({ ...brain(), by: BRAIN }, next).pipe(
        Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data(sql)))),
      ),
    ),
  );

/** A typed refusal: a ProgramMailError with this reason. */
const refused = (
  answer: Result.Result<unknown, unknown>,
  reason: typeof MailRefusal.Type | "storage",
  message: string,
) => {
  expect(Result.isFailure(answer), message).toBe(true);
  const failure = Result.isFailure(answer) ? answer.failure : answer;
  expect(failure, message).toBeInstanceOf(ProgramMailError);
  expect(failure, message).toMatchObject({ reason });
};

/** The item a tape cell's number picks; never called on an empty list. */
const choose = <A>(items: ReadonlyArray<A>, pick: number): A => {
  const item = items[pick % items.length];

  if (item === undefined) {
    throw new Error("a move chose from an empty list");
  }

  return item;
};

const liveSources = (world: World) =>
  SOURCES.flatMap((name) => {
    const life = world.lives.get(name);
    return life?.live === true ? [{ name, process: life.process }] : [];
  });

/** A target the source may reach and that is registered, live or not. */
const reachable = (world: World, source: string) => NAMES.filter((to) => granted(source, to) && world.lives.has(to));
const ended = (world: World) => [...world.lives].filter(([, life]) => !life.live).map(([name]) => name);
const stoppable = (world: World) => [...world.lives].filter(([, life]) => life.live).map(([name]) => name);

/** The moves possible in this world, each only when the world can take it. */
const possible = (world: World, moves: ReadonlyArray<Move>): ReadonlyArray<Move> => {
  const sources = liveSources(world);
  const can: Record<Move, boolean> = {
    send: sources.length > 0,
    bad: sources.some((s) => reachable(world, s.name).length > 0),
    retry_same: world.sent.size > 0,
    retry_other: world.sent.size > 0,
    stop: stoppable(world).length > 0,
    restart: ended(world).length > 0 && world.pids < PIDS.length - 1,
    stale_send: world.stale.some((s) => (SOURCES as ReadonlyArray<string>).includes(s.name)),
    register: !world.lives.has(HELPER) && world.pids < PIDS.length - 1,
    cut: sources.some((s) => reachable(world, s.name).length > 0),
    retry_cut: world.cut.length > 0,
    reopen: true,
  };
  return moves.filter((move) => can[move]);
};

/** The oracle: every inbox holds exactly the world's letters, in order, with their first facts. */
const check = Effect.fnUntraced(function* (world: World) {
  for (const name of NAMES) {
    const letters = yield* Mailbox.use((mail) => Stream.runCollect(mail.read(name, 0)));
    const expected = world.inbox.get(name) ?? [];
    expect(
      letters.map((l) => ({
        id: l.id,
        m: l.m,
        by: l.by,
        for: l.for,
        parent: l.parent,
        sentAt: l.sentAt,
        build: l.build,
        traceId: l.traceId,
      })),
      `${name}'s inbox holds each accepted delivery once, in order, with its first facts`,
    ).toEqual(
      expected.map(({ id, m, from }) => ({
        id,
        m,
        by: from.by,
        for: from.for,
        parent: from.parent,
        sentAt: from.sentAt,
        build: from.build,
        traceId: from.traceId,
      })),
    );
  }

  const ghost = yield* ProcessManager.use((p) => p.status(GHOST)).pipe(Effect.result);
  expect(Result.isFailure(ghost), "a send never registers a missing name").toBe(true);

  for (const [name, life] of world.lives) {
    const status = yield* ProcessManager.use((p) => p.status(name));
    expect(
      { process: status.state.process, state: status.state._tag },
      `${name} keeps the life its own moves gave it: a send never starts or restarts a process`,
    ).toEqual({ process: life.process, state: life.live ? "live" : "ended" });
  }
});

/**
 * Folds one tape through the real ledger on one store. Each cell reads the world the fold has
 * reached and picks a move that is possible there; the oracle checks every prefix.
 */
const walk = (open: Effect.Effect<Store, never, Scope.Scope>, moves: ReadonlyArray<Move>, done: Set<Move>) =>
  Effect.fnUntraced(function* (tape: ReadonlyArray<Cell>) {
    const store = yield* open;
    const { sql, fault } = cutting(store.sql);
    const next = ids(...PIDS);
    const world: World = {
      lives: new Map(),
      stale: [],
      sent: new Map(),
      cut: [],
      inbox: new Map(),
      targetState: new Map(),
      next: 0,
      pids: 0,
    };
    const run = <A, E>(effect: Effect.Effect<A, E, ProgramMail | ProcessManager | Mailbox>) =>
      effect.pipe(Effect.provide(layer(sql, next.next)), Effect.result);
    const deliver = (delivery: Delivery) => run(ProgramMail.use((mail) => mail.deliver(delivery)));
    const register = Effect.fnUntraced(function* (name: string) {
      const life = world.lives.get(name);
      const request =
        life === undefined
          ? Start.cases.first.make({ id: `start:${name}`, name, code: CODE })
          : Start.cases.again.make({
              id: `restart:${life.process}`,
              name,
              after: life.process,
              reason: "shutdown",
              code: CODE,
            });
      const answer = yield* run(ProcessManager.use((p) => p.start(request, from())));
      expect(Result.isSuccess(answer), `${name} starts`).toBe(true);
      world.lives.set(name, { process: choose(PIDS, world.pids++), live: true });
    });
    /** Accepts `delivery` in the world, after checking the receipt it answered. */
    const accepted = (delivery: Delivery, answer: Result.Result<Receipt, ProgramMailError>) => {
      expect(Result.isSuccess(answer), `a permitted delivery to ${delivery.to} is accepted`).toBe(true);
      const receipt = Result.getOrThrow(answer);
      const target = world.lives.get(delivery.to);
      expect(receipt).toMatchObject({
        id: `${delivery.command}/mail`,
        command: delivery.command,
        source: delivery.source,
        to: { name: delivery.to },
        m: delivery.m,
        from: delivery.from,
      });
      expect(receipt.to.state._tag, "the target's lifecycle state at acceptance").toBe(
        target?.live === true ? "live" : "ended",
      );
      expect(typeof receipt.arrivedAt, "the referee's clock is kept").toBe("number");
      world.sent.set(delivery.command, { delivery, receipt });
      world.targetState.set(delivery.command, target?.live === true ? "live" : "ended");
      const inbox = world.inbox.get(delivery.to) ?? [];
      inbox.push({ id: receipt.id, m: delivery.m, from: delivery.from });
      world.inbox.set(delivery.to, inbox);
    };

    for (const name of [REQUESTER, RESPONDER, STRANGER]) {
      yield* register(name);
    }

    for (const cell of tape) {
      const options = possible(world, moves);

      if (options.length === 0) {
        continue;
      }

      const move = choose(options, cell.move);
      const before = snapshot(store.sql);
      const unchanged = (message: string) => expect(snapshot(store.sql), message).toEqual(before);

      switch (move) {
        case "send": {
          const source = choose(liveSources(world), cell.pick);
          const to = choose(NAMES, cell.alt);
          const delivery = { command: `${source.process}/${++world.next}/0`, source, to, m: cell.m, from: said(cell) };
          const answer = yield* deliver(delivery);

          if (!granted(source.name, to)) {
            refused(answer, "forbidden", `${source.name} may not reach ${to}`);
            unchanged("a forbidden delivery writes nothing");
          } else if (!world.lives.has(to)) {
            refused(answer, "no_name", `${to} is not registered`);
            unchanged("a delivery to a missing name writes nothing, and creates no inbox");
          } else {
            accepted(delivery, answer);
          }

          break;
        }
        case "bad": {
          const source = choose(
            liveSources(world).filter((s) => reachable(world, s.name).length > 0),
            cell.pick,
          );
          const to = choose(reachable(world, source.name), cell.alt);
          const m = choose(BAD, cell.alt)();
          const answer = yield* deliver({
            command: `${source.process}/${++world.next}/0`,
            source,
            to,
            m,
            from: said(cell),
          });
          refused(answer, "bad_message", "a message that is not JSON is refused");
          unchanged("a malformed delivery writes nothing");
          break;
        }
        case "retry_same": {
          const [command, { delivery, receipt }] = choose([...world.sent], cell.pick);
          // Another attempt: later clocks, another build and trace, the same command and body.
          const again = { ...delivery, m: copied(delivery.m), from: said(cell, { seen: delivery.from.seen + 1 }) };
          const answer = yield* deliver(again);
          expect(Result.isSuccess(answer), `a repeat of ${command} answers its saved receipt`).toBe(true);
          expect(Result.getOrThrow(answer), "the first accepted receipt, unchanged").toEqual(receipt);
          unchanged("a repeat delivery appends nothing");
          break;
        }
        case "retry_other": {
          const [command, { delivery }] = choose([...world.sent], cell.pick);
          const others = NAMES.filter((to) => to !== delivery.to && granted(delivery.source.name, to));
          const changed =
            cell.alt % 2 === 0 || others.length === 0
              ? { ...delivery, m: { type: "request", body: ["changed", delivery.m] } }
              : { ...delivery, to: choose(others, cell.alt) };
          const answer = yield* deliver(changed);
          refused(answer, "id_reused", `${command} reused with another destination or body`);
          unchanged("a conflicting reuse appends nothing");
          break;
        }
        case "stop": {
          const name = choose(stoppable(world), cell.pick);
          const life = world.lives.get(name);

          if (life === undefined) {
            break;
          }

          const answer = yield* run(ProcessManager.use((p) => p.exit(life.process, SHUTDOWN, from())));
          expect(Result.isSuccess(answer), `${name} stops`).toBe(true);
          life.live = false;
          world.stale.push({ name, process: life.process });
          break;
        }
        case "restart": {
          yield* register(choose(ended(world), cell.pick));
          break;
        }
        case "stale_send": {
          const old = choose(
            world.stale.filter((s) => (SOURCES as ReadonlyArray<string>).includes(s.name)),
            cell.pick,
          );
          const to = choose(
            NAMES.filter((n) => granted(old.name, n)),
            cell.alt,
          );
          const answer = yield* deliver({
            command: `${old.process}/${++world.next}/0`,
            source: old,
            to,
            m: cell.m,
            from: said(cell),
          });
          refused(answer, "stale_sender", `${old.process} no longer acts for ${old.name}`);
          unchanged("a stale execution appends no new mail");
          break;
        }
        case "register": {
          yield* register(HELPER);
          break;
        }
        case "cut": {
          const source = choose(
            liveSources(world).filter((s) => reachable(world, s.name).length > 0),
            cell.pick,
          );
          const to = choose(reachable(world, source.name), cell.alt);
          const delivery = { command: `${source.process}/${++world.next}/0`, source, to, m: cell.m, from: said(cell) };
          fault.after = cell.alt % 2;
          fault.hit = false;
          const answer = yield* deliver(delivery);
          const hit = fault.hit;
          fault.after = null;

          if (hit) {
            refused(answer, "storage", "a storage fault is a retryable failure, never a refusal or a receipt");
            unchanged("a cut delivery commits neither its receipt nor its letter");
            world.cut.push(delivery);
          } else {
            // The cut fell past this delivery's writes: it is an ordinary accepted send.
            accepted(delivery, answer);
          }

          break;
        }
        case "retry_cut": {
          const delivery = choose(world.cut, cell.pick);
          world.cut.splice(world.cut.indexOf(delivery), 1);
          const answer = yield* deliver(delivery);
          const life = world.lives.get(delivery.source.name);

          if (life?.live === true && life.process === delivery.source.process) {
            accepted(delivery, answer);
          } else {
            refused(answer, "stale_sender", "a cut delivery retried after its sender stopped is fenced");
            unchanged("a fenced retry writes nothing");
          }

          break;
        }
        case "reopen":
          yield* store.reopen;
          break;
      }

      done.add(move);
      yield* check(world).pipe(Effect.provide(layer(sql, next.next)));
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
        yield* Effect.promise(() => fc.assert(property, { seed: SEED, numRuns: 40, includeErrorInReport: true }));
        // An empty flow cannot pass: every move the law is about ran at least once.
        expect([...done].sort()).toEqual(expect.arrayContaining([...required].sort()));
      }),
    120_000,
  );

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("P41 slice 1: program mail on a real store", () => {
    prop(
      "L3: a repeat delivery answers its first receipt and appends nothing; a conflicting reuse is refused",
      open,
      ["send", "retry_same", "retry_other", "reopen"],
      ["send", "retry_same", "retry_other", "reopen"],
    );
    prop(
      "L4: a delivery cut at any write commits neither its receipt nor its letter, and its retry delivers once",
      open,
      ["send", "cut", "retry_cut", "retry_same", "reopen"],
      ["cut", "retry_cut", "reopen"],
    );
    prop(
      "L5: a stopped or replaced sender appends no new mail, and its saved receipts stay readable",
      open,
      ["send", "stop", "restart", "stale_send", "retry_same"],
      ["send", "stop", "restart", "stale_send", "retry_same"],
    );
    prop(
      "L6: a stopped or restarted recipient keeps every committed letter in order, and a send starts nothing",
      open,
      ["send", "stop", "restart", "retry_same", "reopen"],
      ["send", "stop", "restart", "reopen"],
    );
    prop(
      "L8: only a granted, registered destination receives mail; a send never registers a name",
      open,
      ["send", "bad", "register", "stop", "restart"],
      ["send", "bad", "register"],
    );
    prop(
      "L11: the first accepted facts stay unchanged across retries with other clocks, builds and traces",
      open,
      ["send", "retry_same", "stop", "restart", "reopen"],
      ["send", "retry_same", "reopen"],
    );
  });
