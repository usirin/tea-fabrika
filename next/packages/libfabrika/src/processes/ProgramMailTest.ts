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
//
// P42 slice 1 (ticket 770) adds L14: a child and the program that started it may mail each other
// with no host grant, the right read from the requester on the child's first `started` line. The
// start piece records that right on the child's first start.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Result, Schema, type Scope, Stream } from "effect";
import * as fc from "fast-check";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import type { Sql, SqlValue } from "../Sql.ts";
import { Children } from "./Children.ts";
import * as ChildrenLedger from "./ChildrenLedger.ts";
import { type From, Mailbox } from "./Mailbox.ts";
import { Owner, Recipient, Start } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";
import { type Grants, type MailRefusal, ProgramMail, ProgramMailError, type Receipt } from "./ProgramMail.ts";
import * as ProgramMailLedger from "./ProgramMailLedger.ts";

/** One real store. `reopen` closes it and opens the same database again, keeping only its rows. */
export type Store = { readonly sql: Sql; readonly reopen: Effect.Effect<void> };

const PIDS: ReadonlyArray<string> = Array.from(
  { length: 40 },
  (_, n) => `process_0000000000e00800${String(n).padStart(10, "0")}`,
);

const ids = (...values: ReadonlyArray<string>) => {
  let calls = 0;
  return {
    next: Effect.sync(() => {
      const value = values[calls++];

      if (value === undefined) {
        throw new Error("test exhausted its process IDs");
      }

      return value;
    }),
    calls: () => calls,
  };
};

const BRAIN = "SHA256:brain";

const brain = () => ({
  owner: Owner.cases.brain.make({}),
  recipient: Recipient.cases.client.make({ client: "window-a", session: PIDS[3] as string }),
  by: BRAIN,
});

const from = (over: Partial<From> = {}): From => ({
  by: BRAIN,
  for: "person_01m6v5270hf3c8x2q7w9z4k5mn",
  sentAt: "2026-11-07T21:10:01.204Z",
  seen: 0,
  parent: `in-${PIDS[0]}-41`,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "writer-build",
  ...over,
});

const copied = <A>(value: A): A => JSON.parse(JSON.stringify(value));

const Reasons = Schema.TaggedUnion({
  normal: {},
  shutdown: {},
  crashed: { phase: Schema.Literal("step"), error: Schema.String },
});

const SHUTDOWN = Reasons.cases.shutdown.make({});

const data = (sql: Sql) =>
  Layer.mergeAll(LedgerSql.layer(sql, { reader: "connection:test" }), LedgerTransactionSql.layer(sql)).pipe(
    Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
  );

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
const granted = (source: string, to: string) => Object.hasOwn(GRANTS, source) && GRANTS[source]?.includes(to) === true;

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
        const checks = { seed: SEED, numRuns: 40, includeErrorInReport: true, endOnFailure: true };
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, checks));
        // An empty flow cannot pass: every move the law is about ran at least once.
        expect([...done].sort()).toEqual(expect.arrayContaining([...required].sort()));
      }),
    120_000,
  );

// --- L14: a child and its starter mail each other (P42 slice 1) ---------------------------------

/** The host's closed grant, by registered name: the only right L14's walk gives besides parenthood. */
const HOST: Grants = { "queue:1": ["helper:1"] };

/** Start grants, by program: queues and workers start mergers, a merger starts a worker. */
const STARTS = [
  { source: "queue", to: "merger" },
  { source: "worker", to: "merger" },
  { source: "merger", to: "worker" },
];

const startsTo = (program: string) => STARTS.filter((g) => g.source === program).map((g) => g.to);

/** Names the boot registers, with no requester: `merger:0` is a child nobody started. */
const FAMILY_BOOT: ReadonlyArray<readonly [string, string]> = [
  ["queue:1", "queue"],
  ["queue:2", "queue"],
  ["worker:9", "worker"],
  ["rogue:1", "rogue"],
  ["helper:1", "helper"],
  ["merger:0", "merger"],
];

type Family = {
  /** Each registered name: its program, its current life and whether it is live. */
  readonly names: Map<string, { readonly program: string; process: string; live: boolean }>;
  /** Each started child's first requester, by registered name. */
  readonly first: Map<string, string>;
  /** Pairs whose start answered "already": no right. */
  readonly already: Set<string>;
  /** Pairs whose start was refused: no right. */
  readonly refusedPairs: Set<string>;
  readonly restarted: Set<string>;
  n: number;
};

const pair = (a: string, b: string) => JSON.stringify([a, b].sort());

/** The model's mail rule: the host grant lists the pair, or one is the other's first requester. */
const mayMail = (family: Family, source: string, to: string) =>
  (Object.hasOwn(HOST, source) && HOST[source]?.includes(to) === true) ||
  family.first.get(to) === source ||
  family.first.get(source) === to;

/** Why a pair may or may not mail, for the walk's tally of what it reached. */
const relation = (family: Family, source: string, to: string): string => {
  if (Object.hasOwn(HOST, source) && HOST[source]?.includes(to) === true) {
    return "host";
  }

  const restarted = family.restarted.has(source) || family.restarted.has(to);

  if (family.first.get(to) === source) {
    return restarted ? "after_restart" : "to_child";
  }

  if (family.first.get(source) === to) {
    return restarted ? "after_restart" : "to_starter";
  }

  const up = (name: string) => family.first.get(name);

  if (up(source) !== undefined && up(source) === up(to)) {
    return "sibling";
  }

  if (up(up(to) ?? "") === source || up(up(source) ?? "") === to) {
    return "grandparent";
  }

  if (family.already.has(pair(source, to))) {
    return "already";
  }

  if (family.refusedPairs.has(pair(source, to))) {
    return "refused_start";
  }

  if (source === "merger:0" || to === "merger:0") {
    return "no_requester";
  }

  const program = (name: string) => family.names.get(name)?.program;
  const starter = up(to) ?? up(source);

  if (starter !== undefined && (program(source) === program(starter) || program(to) === program(starter))) {
    return "same_program";
  }

  return "unrelated";
};

const FamilyCell = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  alt: fc.nat(),
  clock: fc.integer({ min: 0, max: 86_400_000 }),
});
type FamilyCell = typeof FamilyCell extends fc.Arbitrary<infer A> ? A : never;
type FamilyWalk = { readonly step: (cell: FamilyCell) => Effect.Effect<void, unknown> };

const FamilyTape = fc
  .commands(
    [
      FamilyCell.map((cell): fc.AsyncCommand<object, FamilyWalk> => ({
        check: () => true,
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits one real service move
        run: (_model, real) => Effect.runPromise(real.step(cell)),
        toString: () => JSON.stringify(cell),
      })),
    ],
    { maxCommands: 32, size: "max" },
  )
  .filter((commands) => [...commands].length >= 8);

type FamilyMove = "start_child" | "start_again" | "start_forbidden" | "exit" | "restart" | "mail";

const FAMILY_MOVES: ReadonlyArray<FamilyMove> = [
  "start_child",
  "start_again",
  "start_forbidden",
  "exit",
  "restart",
  "mail",
  "mail",
  "mail",
];

const family = (open: Effect.Effect<Store, never, Scope.Scope>, seen: Set<string>, done: Set<FamilyMove>) =>
  Effect.fnUntraced(function* (tape: Iterable<fc.AsyncCommand<object, FamilyWalk>>) {
    const store = yield* open;
    const next = ids(...PIDS);
    const world: Family = {
      names: new Map(),
      first: new Map(),
      already: new Set(),
      refusedPairs: new Set(),
      restarted: new Set(),
      n: 0,
    };
    const stack = ProgramMailLedger.layer({ grants: HOST }).pipe(
      Layer.provideMerge(ChildrenLedger.layer({ grants: STARTS })),
      Layer.provideMerge(
        ProcessManager.layer({ ...brain(), by: BRAIN }, next.next).pipe(
          Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data(store.sql)))),
        ),
      ),
    );
    const run = <A, E>(effect: Effect.Effect<A, E, ProgramMail | ProcessManager | Mailbox | Children>) =>
      effect.pipe(Effect.provide(stack), Effect.result);
    const must = <A, E>(effect: Effect.Effect<A, E, ProcessManager>, label: string) =>
      Effect.map(run(effect), (answer) => {
        expect(Result.isSuccess(answer), label).toBe(true);
        return Result.getOrThrow(answer);
      });
    const parent = () => `in-${PIDS[0]}-${++world.n}`;

    for (const [name, program] of FAMILY_BOOT) {
      const placed = yield* must(
        ProcessManager.use((p) =>
          p.start(Start.cases.first.make({ id: `boot:${name}`, name, code: { program, hash: "build-a" } }), from()),
        ),
        `${name} boots`,
      );
      world.names.set(name, { program, process: placed.process, live: true });
    }

    const live = () => [...world.names].filter(([, n]) => n.live).map(([name]) => name);
    const starters = () => live().filter((name) => startsTo(world.names.get(name)?.program ?? "").length > 0);

    const step = Effect.fnUntraced(function* (cell: FamilyCell) {
      const can: Record<FamilyMove, boolean> = {
        start_child: starters().length > 0 && next.calls() < PIDS.length - 2,
        start_again: starters().some((s) =>
          [...world.names.entries()].some(
            ([n, h]) => n !== s && startsTo(world.names.get(s)?.program ?? "").includes(h.program),
          ),
        ),
        start_forbidden: world.names.get("rogue:1")?.live === true,
        exit: live().length > 2,
        restart: [...world.names.values()].some((n) => !n.live) && next.calls() < PIDS.length - 2,
        mail: live().length > 0,
      };
      const options = FAMILY_MOVES.filter((m) => can[m]);

      if (options.length === 0) {
        return;
      }

      const move = choose(options, cell.move);
      const before = snapshot(store.sql);

      switch (move) {
        case "start_child": {
          const starter = choose(starters(), cell.pick);
          const self = world.names.get(starter) as { program: string; process: string };
          const program = choose(startsTo(self.program), cell.alt);
          const name = `${program}:${100 + ++world.n}`;
          const answer = yield* run(
            Children.use((c) =>
              c.start(
                {
                  id: `${self.process}/${++world.n}/0`,
                  name,
                  code: { program, hash: "build-a" },
                  requester: Recipient.cases.process.make({ process: self.process }),
                  input: { type: "land", ref: `r${world.n}` },
                },
                from({ parent: parent() }),
              ),
            ),
          );
          expect(Result.isSuccess(answer) && Result.getOrThrow(answer)._tag, `${starter} starts ${name}`).toBe(
            "started",
          );
          const started = Result.getOrThrow(answer);
          world.names.set(name, { program, process: started.process, live: true });
          world.first.set(name, starter);
          break;
        }
        case "start_again": {
          const starter = choose(
            starters().filter((s) =>
              [...world.names.entries()].some(
                ([n, h]) => n !== s && startsTo(world.names.get(s)?.program ?? "").includes(h.program),
              ),
            ),
            cell.pick,
          );
          const self = world.names.get(starter) as { program: string; process: string };
          const [name, held] = choose(
            [...world.names.entries()].filter(([n, h]) => n !== starter && startsTo(self.program).includes(h.program)),
            cell.alt,
          );
          const answer = yield* run(
            Children.use((c) =>
              c.start(
                {
                  id: `${self.process}/${++world.n}/0`,
                  name,
                  code: { program: held.program, hash: "build-a" },
                  requester: Recipient.cases.process.make({ process: self.process }),
                },
                from({ parent: parent() }),
              ),
            ),
          );
          expect(Result.isSuccess(answer) && Result.getOrThrow(answer)._tag, `${starter} asks for ${name} again`).toBe(
            held.live ? "already_started" : "already_present",
          );

          if (world.first.get(name) !== starter && world.first.get(starter) !== name) {
            world.already.add(pair(starter, name));
          }

          break;
        }
        case "start_forbidden": {
          const self = world.names.get("rogue:1") as { program: string; process: string };
          const name = choose(
            [...world.names.keys()].filter((n) => n !== "rogue:1"),
            cell.pick,
          );
          const answer = yield* run(
            Children.use((c) =>
              c.start(
                {
                  id: `${self.process}/${++world.n}/0`,
                  name,
                  code: { program: world.names.get(name)?.program ?? "merger", hash: "build-a" },
                  requester: Recipient.cases.process.make({ process: self.process }),
                },
                from({ parent: parent() }),
              ),
            ),
          );
          expect(Result.isFailure(answer), "an ungranted program's start is refused").toBe(true);

          if (world.first.get(name) !== "rogue:1" && world.first.get("rogue:1") !== name) {
            world.refusedPairs.add(pair("rogue:1", name));
          }

          break;
        }
        case "exit": {
          const name = choose(live(), cell.pick);
          const held = world.names.get(name) as { process: string; live: boolean };
          yield* must(
            ProcessManager.use((p) => p.exit(held.process, SHUTDOWN, from())),
            `${name} stops`,
          );
          held.live = false;
          break;
        }
        case "restart": {
          const [name, held] = choose(
            [...world.names.entries()].filter(([, h]) => !h.live),
            cell.pick,
          );
          const placed = yield* must(
            ProcessManager.use((p) =>
              p.start(
                Start.cases.again.make({
                  id: `restart:${held.process}`,
                  name,
                  after: held.process,
                  reason: "shutdown",
                  code: { program: held.program, hash: "build-a" },
                }),
                from(),
              ),
            ),
            `${name} restarts`,
          );
          held.process = placed.process;
          held.live = true;
          world.restarted.add(name);
          break;
        }
        case "mail": {
          const source = choose(live(), cell.pick);
          const to = choose(
            [...world.names.keys()].filter((n) => n !== source),
            cell.alt,
          );
          const self = world.names.get(source) as { process: string };
          const answer = yield* run(
            ProgramMail.use((mail) =>
              mail.deliver({
                command: `${self.process}/${++world.n}/0`,
                source: { name: source, process: self.process },
                to,
                m: { type: "request", ref: `m${world.n}` },
                from: from({ by: "SHA256:program-writer", parent: parent() }),
              }),
            ),
          );
          const reason = relation(world, source, to);

          if (mayMail(world, source, to)) {
            expect(Result.isSuccess(answer), `L14: ${source} may mail ${to} (${reason})`).toBe(true);
          } else {
            refused(answer, "forbidden", `L14: ${source} may not mail ${to} (${reason})`);
            expect(snapshot(store.sql), "L14: a forbidden letter writes nothing").toEqual(before);
          }

          seen.add(`${mayMail(world, source, to) ? "may" : "may_not"}:${reason}`);
          break;
        }
      }

      done.add(move);
    });
    // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check owns the generated command walk
    yield* Effect.promise(() => fc.asyncModelRun(() => ({ model: world, real: { step } }), tape));
  });

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
    it.effect(
      "L14: a child and the program that started it mail each other with no grant, across restarts; nobody else gains a right",
      () =>
        Effect.gen(function* () {
          const seen = new Set<string>();
          const done = new Set<FamilyMove>();
          const law = family(open, seen, done);
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
          const property = fc.asyncProperty(FamilyTape, (tape) => Effect.runPromise(Effect.scoped(law(tape))));
          const checks = { seed: SEED, numRuns: 200, includeErrorInReport: true, endOnFailure: true };
          // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
          yield* Effect.promise(() => fc.assert(property, checks));
          // An empty walk cannot pass: every move ran, and every relation the law names was mailed across.
          expect([...done].sort()).toEqual(
            expect.arrayContaining(["exit", "mail", "restart", "start_again", "start_child", "start_forbidden"]),
          );
          expect([...seen].sort()).toEqual(
            expect.arrayContaining(
              [
                "may:to_child",
                "may:to_starter",
                "may:after_restart",
                "may:host",
                "may_not:sibling",
                "may_not:grandparent",
                "may_not:already",
                "may_not:refused_start",
                "may_not:no_requester",
                "may_not:same_program",
              ].sort(),
            ),
          );
        }),
      600_000,
    );
  });
