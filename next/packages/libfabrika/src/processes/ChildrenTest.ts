// P42 slice 1, next/ (ticket 770): the start piece's laws L1 to L6, L11 and L13 on a real store
// (0062). A runner in the module that owns a driver calls `ChildrenTest.suite(open)`; `open` acquires
// one store in a scope and gives it back when that scope closes (0061).
//
// The contract these laws pin, from the approved plan's opening block and Files table:
//   Children.ts: `StartGrant` ({source, to}: programs), `Child` ({id, name, code, requester, input?}),
//     `Started` (started | already_started | already_present), `ChildrenError` with a `reason`, and the
//     `Children` service, whose `start(child, from)` answers `Started` or fails with `ChildrenError`.
//   ChildrenLedger.ts: `layer({ grants })`, over LedgerTransaction, ProcessManager and Mailbox.
// Only a fresh start saves anything: in one turn it registers the name, writes its `started` line at
// entry id `child.id` with the requester, and, when `input` is present, the first letter at
// `["start", child.id]` in `<name>/inbox`. An "already" answer and a refusal write nothing.
//
// Every oracle here is the walk's own model, or the store's raw rows read with SQL: never the
// product's fold.
import { describe, expect, it } from "@effect/vitest";
import {
  Cause,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Option,
  Result,
  Schema,
  type Scope,
  Stream,
  Tracer,
} from "effect";
import * as fc from "fast-check";
import { Doorbell, Ledger } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import { LedgerTransaction, type LedgerTurn } from "../ledger/LedgerTransaction.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import type { Entry } from "../ledger/Log.ts";
import type { Sql, SqlValue } from "../Sql.ts";
import { SpanSink } from "../telemetry/Sink.ts";
import { Children, ChildrenError, type Child, type StartGrant, Started } from "./Children.ts";
import * as ChildrenLedger from "./ChildrenLedger.ts";
import { type From, Mailbox } from "./Mailbox.ts";
import { Owner, Recipient, Start } from "./Process.ts";
import { ProcessManager } from "./ProcessManager.ts";

/** One real store. `reopen` closes it and opens the same file again; `probe.open` counts open handles. */
export type Store = {
  readonly sql: Sql;
  readonly reopen: Effect.Effect<void>;
  readonly probe: { readonly open: () => number };
};

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

const NORMAL = Reasons.cases.normal.make({});
const SHUTDOWN = Reasons.cases.shutdown.make({});
const CRASHED = Reasons.cases.crashed.make({ phase: "step", error: "Error" });

const SEED = 119120;
const HASH = "build-a";
const QUEUE = "queue";
const MERGER = "merger";
const WORKER = "worker";
const ROGUE = "rogue";
const PROGRAMS = [MERGER, MERGER, WORKER, QUEUE, ROGUE] as const;

/** The host's start grants, by program, duplicated and out of order: they are read as a set. */
const GRANTS: ReadonlyArray<typeof StartGrant.Type> = [
  { source: WORKER, to: MERGER },
  { source: QUEUE, to: MERGER },
  { source: QUEUE, to: QUEUE },
  { source: QUEUE, to: WORKER },
  { source: QUEUE, to: MERGER },
];

/** The model's own copy of the grant rule: never the product's. */
const granted = (source: string, to: string) => GRANTS.some((g) => g.source === source && g.to === to);

/** The names the boot registers, each a requester of its own program. */
const BOOT: ReadonlyArray<readonly [string, string]> = [
  ["queue:1", QUEUE],
  ["worker:9", WORKER],
  ["rogue:1", ROGUE],
];

/** Names a start may ask for, besides every name the walk has registered. */
const POOL = ["merger:1", "merger:2", "merger:3", "worker:1", "worker:2"] as const;

/** The ledger's row limit (`ledger/Log.ts`): a first letter over it is refused whole. */
const ROW_LIMIT = 2_000_000;

type Answer = Result.Result<typeof Started.Type, ChildrenError>;
type Reason = ChildrenError["reason"];

/** The first letter's entry id in `<name>/inbox`. */
const letterId = (id: string) => JSON.stringify(["start", id]);

/** The streams a start touches for `names`: the process table, each name's events and its inbox. */
const streamsFor = (names: Iterable<string>) => [
  "processes",
  ...[...new Set(names)].flatMap((name) => [`processes/${name}`, `${name}/inbox`]),
];

/** Every entry of those streams, through the ledger's own read: the oracle never asks the product's fold. */
const entries = (names: Iterable<string>) =>
  Effect.map(
    Effect.forEach(streamsFor(names), (stream) => Ledger.use((ledger) => Stream.runCollect(ledger.read(stream, 0))), {
      concurrency: 1,
    }),
    (all) => all.flatMap((part) => [...part]).sort((a, b) => a.rev - b.rev),
  );

/** The newest rev a turn can see in those streams. */
const headIn = (turn: LedgerTurn, names: Iterable<string>) =>
  Math.max(0, ...streamsFor(names).flatMap((stream) => [...turn.read(stream, 0)].map((e) => e.rev)));

/** Every row of every table, so "nothing was written" covers whatever table a start might use. */
const snapshot = (sql: Sql): Record<string, ReadonlyArray<Record<string, SqlValue>>> => {
  const tables = sql
    .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((row) => String(row.name));
  return Object.fromEntries(tables.map((table) => [table, sql.exec(`SELECT * FROM "${table}"`)]));
};

const body = (entry: Entry): Record<string, unknown> =>
  typeof entry.body === "object" && entry.body !== null && !Array.isArray(entry.body)
    ? (entry.body as Record<string, unknown>)
    : {};

/** The store's Sql with two cuts: on the next INSERT, or on the first transaction after an INSERT. */
const cutting = (sql: Sql) => {
  const fault = { insert: false, afterWrite: false, wrote: false, hit: false, message: "SQLITE_FULL planted" };
  const wrapped: Sql = {
    exec: (query, ...params) => {
      if (/^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+entries\b/i.test(query)) {
        if (fault.insert) {
          fault.insert = false;
          fault.hit = true;
          throw new Error(fault.message);
        }

        fault.wrote = true;
      }

      return sql.exec(query, ...params);
    },
    transaction: (step) => {
      if (fault.afterWrite && fault.wrote) {
        fault.afterWrite = false;
        fault.hit = true;
        throw new Error(fault.message);
      }

      return sql.transaction(step);
    },
    size: () => sql.size(),
  };
  const arm = (kind: "insert" | "afterWrite", message = "SQLITE_FULL planted") => {
    fault.insert = kind === "insert";
    fault.afterWrite = kind === "afterWrite";
    fault.wrote = false;
    fault.hit = false;
    fault.message = message;
  };
  const disarm = () => {
    const hit = fault.hit;
    fault.insert = false;
    fault.afterWrite = false;
    fault.hit = false;
    return hit;
  };
  return { sql: wrapped, arm, disarm };
};

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

/** A transaction gate: runs before every turn this layer opens, with the turn's index. */
type Gate = (turn: number) => Effect.Effect<void>;
/** Runs after every turn's own step, inside the turn. */
type Seen = (turn: LedgerTurn) => void;

/** The real ledger, the real process manager and the real start piece, all on one Sql. */
const layer = (sql: Sql, next: Effect.Effect<string>, gate?: Gate, seen?: Seen) => {
  const tx = LedgerTransactionSql.layer(sql).pipe(Layer.provide(quiet));
  const gated =
    gate === undefined && seen === undefined
      ? tx
      : Layer.effect(
          LedgerTransaction,
          Effect.gen(function* () {
            const real = yield* LedgerTransaction;
            let turns = 0;
            return LedgerTransaction.of({
              transact: <A>(step: (turn: LedgerTurn) => A) =>
                Effect.suspend(() => (gate === undefined ? Effect.void : gate(turns++))).pipe(
                  Effect.andThen(
                    real.transact((turn) => {
                      const out = step(turn);
                      seen?.(turn);
                      return out;
                    }),
                  ),
                ),
            });
          }),
        ).pipe(Layer.provide(tx));
  const data = Layer.merge(LedgerSql.layer(sql, { reader: "connection:test" }).pipe(Layer.provide(quiet)), gated);
  return ChildrenLedger.layer({ grants: GRANTS }).pipe(
    Layer.provideMerge(
      ProcessManager.layer({ ...brain(), by: BRAIN }, next).pipe(
        Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data))),
      ),
    ),
  );
};

/** A raw value under `tag`, never made by a schema, so it can hold a shape its schema refuses. */
const raw = (tag: string, fields: object): unknown =>
  // oxlint-disable-next-line fabrika/no-hand-tag -- invalid on purpose: no schema maker writes a shape its schema refuses
  ({ ...fields, _tag: tag });

/** The item a number picks; never called on an empty list. */
const choose = <A>(items: ReadonlyArray<A>, pick: number): A => {
  const item = items[pick % items.length];

  if (item === undefined) {
    throw new Error("a move chose from an empty list");
  }

  return item;
};

/** A copy with every object's keys in reverse order: equal values, another key order. */
const reorder = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(reorder)
    : typeof value === "object" && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([k, v]) => [k, reorder(v)]),
        )
      : value;

/** Equal JSON values, whatever their key order: the model's own comparison. */
const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sorted)
    : typeof value === "object" && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, v]) => [k, sorted(v)]),
        )
      : value;

const sameJson = (a: unknown, b: unknown) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

const Json = fc.jsonValue({ maxDepth: 2 }).map((m) => copied({ v: m }).v as Schema.Json);

const Cell = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  alt: fc.nat(),
  name: fc.nat(),
  program: fc.nat(),
  input: fc.nat(),
  m: Json,
  clock: fc.integer({ min: 0, max: 86_400_000 }),
  build: fc.constantFrom("writer-a", "writer-b"),
  trace: fc.stringMatching(/^[0-9a-f]{32}$/),
});
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;
type Walk = { readonly step: (cell: Cell) => Effect.Effect<void, unknown> };

const Tape = fc
  .commands(
    [
      Cell.map((cell): fc.AsyncCommand<object, Walk> => ({
        check: () => true,
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits one real service move
        run: (_model, real) => Effect.runPromise(real.step(cell)),
        toString: () => JSON.stringify(cell),
      })),
    ],
    { maxCommands: 28, size: "max" },
  )
  .filter((commands) => [...commands].length >= 8);

/** The input a cell picks: absent, `null`, `{}`, `[]`, or a generated JSON value. */
const inputFor = (cell: Cell): { readonly input?: Schema.Json } => {
  const kind = cell.input % 6;
  return kind === 0
    ? {}
    : { input: kind === 1 ? null : kind === 2 ? {} : kind === 3 ? [] : (copied({ v: cell.m }).v as Schema.Json) };
};

/** The writer's own facts for one call: its clock, build and trace vary; its person and parent do not. */
const said = (cell: Cell, parent: string): From =>
  from({
    by: "SHA256:program-writer",
    sentAt: new Date(Date.UTC(2026, 10, 11) + cell.clock).toISOString(),
    build: cell.build,
    traceId: cell.trace,
    parent,
  });

type Move =
  | "start"
  | "start_stale"
  | "retry_saved"
  | "retry_changed"
  | "retry_unsaved"
  | "exit"
  | "down"
  | "restart"
  | "bad"
  | "big"
  | "cut_write"
  | "cut_answer"
  | "exit_between"
  | "reopen";

type Held = {
  readonly program: string;
  readonly lives: Array<string>;
  current: string;
  state: "live" | "ended" | "down";
};

type Saved = {
  readonly child: Child;
  readonly from: From;
  readonly answer: { readonly process: string; readonly name: string; readonly rev: number };
};

/** What the walk knows, from its own moves only. */
type World = {
  /** Every registered name, with its program and each of its lives in order. */
  readonly names: Map<string, Held>;
  /** Each saved start id: the first start's caller fields and its `started` answer. */
  readonly saved: Map<string, Saved>;
  /** Ids answered "already" or refused: nothing was saved for them. */
  readonly unsaved: Map<string, Child>;
  /** Each name's first letters, in order. */
  readonly letters: Map<string, Array<{ readonly id: string; readonly m: Schema.Json }>>;
  n: number;
  big: number;
};

/** The model's own answer: a fresh start, an "already" answer naming a life, or a refusal. */
type Expected =
  | { readonly outcome: "fresh" }
  | { readonly outcome: "already_started" | "already_present"; readonly process: string }
  | { readonly outcome: "refused"; readonly reason: Reason };

const holder = (world: World, process: string) => {
  for (const [name, held] of world.names) {
    if (held.lives.includes(process)) {
      return { name, held };
    }
  }

  return undefined;
};

const liveProcesses = (world: World) =>
  [...world.names.values()].filter((held) => held.state === "live").map((held) => held.current);

const staleProcesses = (world: World) =>
  [...world.names.values()].flatMap((held) =>
    held.lives.filter((process) => process !== held.current || held.state !== "live"),
  );

const liveNames = (world: World) => [...world.names].filter(([, held]) => held.state === "live").map(([n]) => n);

const stoppedNames = (world: World) =>
  [...world.names].filter(([, held]) => held.state !== "live").map(([name]) => name);

/**
 * The model's answer for an id that is not saved, in the plan's order: the requester live, its
 * program granted the child's program, then whereis.
 */
const expected = (world: World, child: Child): Expected => {
  const requester = holder(world, child.requester.process);

  if (
    requester === undefined ||
    requester.held.current !== child.requester.process ||
    requester.held.state !== "live"
  ) {
    return { outcome: "refused", reason: "stale_sender" };
  }

  if (!granted(requester.held.program, child.code.program)) {
    return { outcome: "refused", reason: "forbidden" };
  }

  const held = world.names.get(child.name);

  if (held === undefined) {
    return { outcome: "fresh" };
  }

  if (held.program !== child.code.program) {
    return { outcome: "refused", reason: "name_taken" };
  }

  return { outcome: held.state === "live" ? "already_started" : "already_present", process: held.current };
};

/** An answer as a failure message shows it: its tag or reason, never a cause. */
const shown = (answer: Answer | undefined): string =>
  answer === undefined
    ? "no answer"
    : Result.isSuccess(answer)
      ? JSON.stringify(answer.success)
      : answer.failure instanceof ChildrenError
        ? `ChildrenError ${answer.failure.reason}`
        : String(answer.failure);

const refused = (answer: Answer, reason: Reason, message: string) => {
  expect(Result.isFailure(answer), `${message}; got ${shown(answer)}`).toBe(true);
  const failure = Result.isFailure(answer) ? answer.failure : answer;
  expect(failure, message).toBeInstanceOf(ChildrenError);
  expect(failure, message).toMatchObject({ reason });

  if (reason !== "storage") {
    expect((failure as ChildrenError).cause, `L6: a refusal (${reason}) carries no cause`).toBeUndefined();
  }
};

/** Every answer tag and refusal reason a walk saw, across runs. */
type Tally = Set<string>;

/**
 * Folds one tape through the real start piece on one store. Each cell reads the world the fold has
 * reached and picks a move possible there; the oracle checks every prefix.
 */
const walk = (
  open: Effect.Effect<Store, never, Scope.Scope>,
  moves: ReadonlyArray<Move>,
  done: Set<Move>,
  seen: Tally,
) =>
  Effect.fnUntraced(function* (tape: Iterable<fc.AsyncCommand<object, Walk>>) {
    const store = yield* open;
    const { sql, arm, disarm } = cutting(store.sql);
    const next = ids(...PIDS);
    const world: World = { names: new Map(), saved: new Map(), unsaved: new Map(), letters: new Map(), n: 0, big: 0 };
    const run = <A, E>(effect: Effect.Effect<A, E, Children | ProcessManager | Mailbox>, gate?: Gate) =>
      effect.pipe(Effect.provide(layer(sql, next.next, gate)), Effect.result);
    const rowsNow = (names: Iterable<string>) =>
      entries(names).pipe(Effect.provide(layer(sql, next.next)), Effect.orDie);
    const startChild = (child: Child, said: From, gate?: Gate) =>
      run(
        Children.use((c) => c.start(child, said)),
        gate,
      );
    const manager = <A>(f: (p: ProcessManager["Service"]) => Effect.Effect<A, unknown>) =>
      run(ProcessManager.use(f)).pipe(
        Effect.map((answer) => {
          expect(Result.isSuccess(answer), "a lifecycle move of the walk's own succeeds").toBe(true);
          return Result.getOrThrow(answer);
        }),
      );

    for (const [name, program] of BOOT) {
      const placed = yield* manager((p) =>
        p.start(Start.cases.first.make({ id: `boot:${name}`, name, code: { program, hash: HASH } }), from()),
      );
      world.names.set(name, { program, lives: [placed.process], current: placed.process, state: "live" });
    }

    /** A parent the ledger takes: an input of one known process. */
    const parentFor = () => `in-${PIDS[0]}-${++world.n}`;
    const childFor = (cell: Cell, requester: string): Child => ({
      id: `${requester}/${++world.n}/0`,
      name: choose([...POOL, ...world.names.keys()], cell.name),
      code: { program: choose(PROGRAMS, cell.program), hash: HASH },
      requester: Recipient.cases.process.make({ process: requester }),
      ...inputFor(cell),
    });

    /** Checks a fresh start's answer and rows, then saves it in the world. */
    const placed = (child: Child, said: From, answer: Answer, label: string) => {
      expect(Result.isSuccess(answer), `${label}: a free, granted name starts; got ${shown(answer)}`).toBe(true);
      const started = Result.getOrThrow(answer);
      expect(started._tag, `${label}: a fresh start answers started`).toBe("started");

      if (started._tag !== "started") {
        return;
      }

      expect(started.name).toBe(child.name);
      expect(holder(world, started.process), "L1: a fresh start makes a process nobody had").toBeUndefined();
      world.names.set(child.name, {
        program: child.code.program,
        lives: [started.process],
        current: started.process,
        state: "live",
      });
      world.saved.set(child.id, {
        child,
        from: said,
        answer: { process: started.process, name: started.name, rev: started.rev },
      });
      world.unsaved.delete(child.id);

      if (child.input !== undefined) {
        const letters = world.letters.get(child.name) ?? [];
        letters.push({ id: letterId(child.id), m: child.input });
        world.letters.set(child.name, letters);
      }
    };

    /** Asks an unsaved id and checks the answer against the model, then folds it in. */
    const ask = Effect.fnUntraced(function* (child: Child, said: From, label: string) {
      const want = expected(world, child);
      const before = snapshot(store.sql);
      const answer = yield* startChild(child, said);

      if (want.outcome === "fresh") {
        placed(child, said, answer, label);
        seen.add("started");
        return;
      }

      expect(snapshot(store.sql), `${label}: an answer that is not a fresh start writes nothing`).toEqual(before);
      world.unsaved.set(child.id, child);

      if (want.outcome === "refused") {
        refused(answer, want.reason, `${label}: ${want.reason}`);
        seen.add(want.reason);
        return;
      }

      expect(Result.isSuccess(answer), `${label}: ${want.outcome} is an answer, not a refusal`).toBe(true);
      expect(Result.getOrThrow(answer), `${label}: L1 ${want.outcome} names the name's current life`).toEqual(
        Started.cases[want.outcome].make({ process: want.process, name: child.name }),
      );
      const requester = holder(world, child.requester.process);
      seen.add(requester?.name === child.name ? "own_name" : want.outcome);
    });

    /** The oracle over the ledger's entries: lives, records and first letters are the world's. */
    const check = Effect.fnUntraced(function* () {
      const all = yield* rowsNow(world.names.keys());

      for (const [name, held] of world.names) {
        const lives = all.filter((e) => e.stream === `processes/${name}` && e._tag === "started");
        expect(
          lives.map((e) => body(e)["process"]),
          `${name}'s lives, in order`,
        ).toEqual(held.lives);
        const registered = all.filter(
          (e) => e.stream === "processes" && e._tag === "registered" && body(e)["name"] === name,
        );
        expect(registered.length, `${name} is registered once`).toBe(1);
        expect(body(registered[0] as Entry), "L5: the brain owns every registered name").toMatchObject({
          program: held.program,
          owner: Owner.cases.brain.make({}),
        });
        const letters = all.filter((e) => e.stream === `${name}/inbox` && e.id.startsWith('["start",'));
        expect(
          letters.map((e) => ({ id: e.id, m: body(e)["m"] })),
          `L1, L3: ${name}'s first letters, each once and written by its start`,
        ).toEqual(world.letters.get(name) ?? []);
      }

      for (const [id, { child, from: said, answer }] of world.saved) {
        const line = all.find((e) => e.stream === `processes/${child.name}` && e.id === id);
        expect(line, `the started line of ${id} is kept`).toBeDefined();

        if (line === undefined) {
          continue;
        }

        expect(line.rev, "L3: the saved start's rev").toBe(answer.rev);
        expect(body(line), "L5: the started line keeps its requester, its code and the call's parent").toMatchObject({
          process: answer.process,
          name: child.name,
          program: child.code.program,
          hash: child.code.hash,
          requester: Recipient.cases.process.make({ process: child.requester.process }),
        });
        expect(line.parent, "L5: the parent of the start is kept").toBe(said.parent);
        const letter = all.find((e) => e.stream === `${child.name}/inbox` && e.id === letterId(id));
        expect(letter === undefined, "L1: a letter exists exactly when the start had input").toBe(
          child.input === undefined,
        );

        // One turn, and nothing between: the name's registration, its started line and its letter sit
        // at neighboring revs. A sequential walk writes nothing else in between.
        const registration = all.find(
          (e) => e.stream === "processes" && e._tag === "registered" && body(e)["name"] === child.name,
        );
        const turn = [registration?.rev ?? 0, line.rev, ...(letter === undefined ? [] : [letter.rev])];
        expect(Math.max(...turn) - Math.min(...turn), "L1: registered, started and the first letter are one turn").toBe(
          turn.length - 1,
        );
      }

      const info = yield* manager((p) => p.info);
      expect(
        info.map((row) => [row.name, row.process]).sort(),
        "the live set is exactly the world's live lives",
      ).toEqual(
        [...world.names]
          .filter(([, held]) => held.state === "live")
          .map(([name, held]) => [name, held.current])
          .sort(),
      );
    });

    const options = (): ReadonlyArray<Move> => {
      // Every fresh write takes a process id; keep spare for the longest tape.
      const live = liveProcesses(world).length > 0;
      const spare = next.calls() < PIDS.length - 2;
      const can: Record<Move, boolean> = {
        start: live && spare,
        start_stale: staleProcesses(world).length > 0 && spare,
        retry_saved: world.saved.size > 0,
        retry_changed: world.saved.size > 0,
        retry_unsaved: world.unsaved.size > 0 && spare,
        exit: liveNames(world).length > 1,
        down: liveNames(world).length > 1,
        restart: stoppedNames(world).length > 0 && spare,
        bad: live,
        big: live && spare && world.big < 1,
        cut_write: live && spare,
        cut_answer: live && spare,
        exit_between: live && spare,
        reopen: true,
      };
      return moves.filter((move) => can[move]);
    };

    const step = Effect.fnUntraced(function* (cell: Cell) {
      const possible = options();

      if (possible.length === 0) {
        return;
      }

      const move = choose(possible, cell.move);
      const before = snapshot(store.sql);
      const unchanged = (message: string) => expect(snapshot(store.sql), message).toEqual(before);

      switch (move) {
        case "start": {
          const child = childFor(cell, choose(liveProcesses(world), cell.pick));
          yield* ask(child, said(cell, `in-${child.requester.process}-${world.n}`), "start");
          break;
        }
        case "start_stale": {
          const child = childFor(cell, choose(staleProcesses(world), cell.pick));
          yield* ask(child, said(cell, `in-${child.requester.process}-${world.n}`), "a stale requester");
          break;
        }
        case "retry_saved": {
          const [id, first] = choose([...world.saved], cell.pick);
          // The same caller fields, its input in another key order and copied, after a rebuild or not.
          const again: Child = {
            ...first.child,
            code: { program: first.child.code.program, hash: cell.alt % 2 === 0 ? HASH : "build-b" },
            ...(first.child.input === undefined ? {} : { input: reorder(copied(first.child.input)) as Schema.Json }),
          };
          const answer = yield* startChild(again, said(cell, first.from.parent ?? "none"));
          expect(Result.isSuccess(answer), `L3: a retry of saved ${id} answers`).toBe(true);
          expect(Result.getOrThrow(answer), `L3: a retry of saved ${id} answers its saved started`).toEqual(
            Started.cases.started.make(first.answer),
          );
          unchanged("L3: a retry of a saved start writes nothing");
          seen.add("retried");
          break;
        }
        case "retry_changed": {
          const [id, first] = choose([...world.saved], cell.pick);
          const field = cell.alt % 4;
          const others = [...POOL, ...world.names.keys()].filter((n) => n !== first.child.name);
          const processes = [...world.names.values()]
            .flatMap((h) => h.lives)
            .filter((p) => p !== first.child.requester.process);
          const changed: Child =
            field === 0 && others.length > 0
              ? { ...first.child, name: choose(others, cell.name) }
              : field === 1
                ? {
                    ...first.child,
                    code: { ...first.child.code, program: first.child.code.program === MERGER ? WORKER : MERGER },
                  }
                : field === 2 && processes.length > 0
                  ? {
                      ...first.child,
                      requester: Recipient.cases.process.make({ process: choose(processes, cell.pick) }),
                    }
                  : first.child.input === undefined
                    ? { ...first.child, input: {} }
                    : cell.input % 2 === 0
                      ? (({ input: _input, ...rest }) => rest)(first.child)
                      : { ...first.child, input: ["changed", first.child.input] };
          const answer = yield* startChild(changed, said(cell, first.from.parent ?? "none"));
          refused(answer, "id_reused", `L3: saved ${id} asked again with another caller field`);
          unchanged("L3: id_reused writes nothing");
          seen.add("id_reused");
          break;
        }
        case "retry_unsaved": {
          const [, child] = choose([...world.unsaved], cell.pick);
          yield* ask(
            { ...child, ...(child.input === undefined ? {} : { input: copied(child.input) }) },
            said(cell, parentFor()),
            "an unsaved id, asked afresh",
          );
          seen.add("asked_afresh");
          break;
        }
        case "exit": {
          const name = choose(liveNames(world), cell.pick);
          const held = world.names.get(name) as Held;
          yield* manager((p) => p.exit(held.current, cell.alt % 2 === 0 ? NORMAL : SHUTDOWN, from()));
          held.state = "ended";
          break;
        }
        case "down": {
          const name = choose(liveNames(world), cell.pick);
          const held = world.names.get(name) as Held;
          yield* manager((p) => p.exit(held.current, CRASHED, from()));
          yield* manager((p) =>
            p.down(held.current, { reason: "brake", crashes: 3, until: 1_800_000_000_000 }, from()),
          );
          held.state = "down";
          break;
        }
        case "restart": {
          const name = choose(stoppedNames(world), cell.pick);
          const held = world.names.get(name) as Held;
          const placed = yield* manager((p) =>
            p.start(
              Start.cases.again.make({
                id: `restart:${held.current}`,
                name,
                after: held.current,
                reason: "crashed",
                code: { program: held.program, hash: HASH },
              }),
              from(),
            ),
          );
          held.lives.push(placed.process);
          held.current = placed.process;
          held.state = "live";
          break;
        }
        case "bad": {
          // One field of a start off its schema, on a fresh id or on a saved one: decode comes first.
          const base =
            world.saved.size > 0 && cell.pick % 3 === 0
              ? choose([...world.saved.values()], cell.pick).child
              : childFor(cell, choose(liveProcesses(world), cell.pick));
          const names = ["", "m".repeat(257), "processes", "gateway", "Merger:1", "merger/1", "client:x", "-merger"];
          const kind = cell.alt % 7;
          const bad: { child: unknown; reason: Reason } =
            kind === 0
              ? { child: { ...base, name: choose(names, cell.name) }, reason: "bad_name" }
              : kind === 1
                ? // A bad name and a bad input at once: the name is judged first.
                  { child: { ...base, name: choose(names, cell.name), input: () => 1 }, reason: "bad_name" }
                : kind === 2
                  ? { child: { ...base, id: cell.name % 2 === 0 ? "" : "i".repeat(257) }, reason: "bad_input" }
                  : kind === 3
                    ? {
                        child: {
                          ...base,
                          code:
                            cell.name % 2 === 0
                              ? { program: "", hash: HASH }
                              : { program: base.code.program, hash: "" },
                        },
                        reason: "bad_input",
                      }
                    : kind === 4
                      ? {
                          child: { ...base, requester: raw("process", { process: "process_bad" }) },
                          reason: "bad_input",
                        }
                      : kind === 5
                        ? {
                            child: { ...base, input: choose([() => 1, 1n, Symbol("x"), { f: () => 1 }], cell.name) },
                            reason: "bad_input",
                          }
                        : { child: { ...base, input: { type: "land", deep: [1n] } }, reason: "bad_input" };
          const answer = yield* startChild(bad.child as Child, said(cell, parentFor()));
          refused(answer, bad.reason, `L6: ${bad.reason}`);
          unchanged(`L6: ${bad.reason} writes nothing`);
          seen.add(bad.reason);
          break;
        }
        case "big": {
          world.big++;
          const over = cell.alt % 2 === 0;
          const child: Child = {
            ...childFor(cell, choose(liveProcesses(world), cell.pick)),
            input: "x".repeat(over ? ROW_LIMIT + 1 : ROW_LIMIT - 10_000),
          };

          if (over) {
            const answer = yield* startChild(child, said(cell, parentFor()));
            refused(answer, "bad_input", "L6: a first letter over the row limit");
            unchanged("L6: a start whose letter is over the row limit writes nothing");
            seen.add("too_big");
          } else {
            yield* ask(child, said(cell, parentFor()), "a first letter under the row limit");
          }

          break;
        }
        case "cut_write": {
          const child = childFor(cell, choose(liveProcesses(world), cell.pick));
          const want = expected(world, child);
          arm("insert");
          const answer = yield* startChild(child, said(cell, parentFor()));
          const hit = disarm();

          if (hit) {
            refused(answer, "storage", "a cut write turn is a storage failure");
            unchanged("a cut write turn writes nothing");
            world.unsaved.set(child.id, child);
            seen.add("storage");
          } else {
            expect(want.outcome, "only a fresh start reaches a write").not.toBe("fresh");
            world.unsaved.set(child.id, child);
          }

          break;
        }
        case "cut_answer": {
          const child = childFor(cell, choose(liveProcesses(world), cell.pick));
          const want = expected(world, child);
          const call = said(cell, parentFor());
          arm("afterWrite");
          const answer = yield* startChild(child, call);
          const hit = disarm();

          if (want.outcome !== "fresh") {
            world.unsaved.set(child.id, child);
            break;
          }

          if (!hit) {
            placed(child, call, answer, "a start whose answer was not cut");
            break;
          }

          // The write landed and the answer was lost: the rows say what was saved.
          expect(Result.isFailure(answer), "a cut after the write turn fails").toBe(true);
          const line = (yield* rowsNow([child.name])).find(
            (e) => e.stream === `processes/${child.name}` && e.id === child.id,
          );
          expect(line, "L3: the write turn that committed keeps its start").toBeDefined();
          const process = String(body(line as Entry)["process"]);
          placed(
            child,
            call,
            Result.succeed(Started.cases.started.make({ process, name: child.name, rev: (line as Entry).rev })),
            "a cut answer",
          );
          seen.add("cut_answer");
          break;
        }
        case "exit_between": {
          // The requester exits before one of the start's own turns, or after all of them.
          const requester = choose(liveProcesses(world), cell.pick);
          const child = childFor(cell, requester);
          const want = expected(world, child);
          const held = holder(world, requester)?.held as Held;
          const at = cell.alt % 5;
          let fired = false;
          const exit = manager((p) => p.exit(requester, SHUTDOWN, from())).pipe(Effect.asVoid);
          const gate: Gate = (turn) =>
            turn === at
              ? Effect.suspend(() => {
                  fired = true;
                  return exit;
                })
              : Effect.void;
          const call = said(cell, parentFor());
          const answer = yield* startChild(child, call, gate);

          if (!fired) {
            // Every turn ran before the exit: the answer is as it was, and the exit comes after.
            if (want.outcome === "fresh") {
              placed(child, call, answer, "a start before its requester's exit");
            } else {
              world.unsaved.set(child.id, child);
              expect(Result.isSuccess(answer) ? answer.success._tag : answer.failure.reason).toBe(
                want.outcome === "refused" ? want.reason : want.outcome,
              );
            }

            yield* exit;
            held.state = "ended";
            seen.add("exit_after");
            break;
          }

          held.state = "ended";
          const exited = (yield* rowsNow([holder(world, requester)?.name ?? ""])).find(
            (e) => e._tag === "exited" && body(e)["process"] === requester && e.stream.startsWith("processes/"),
          ) as Entry;

          if (Result.isSuccess(answer) && answer.success._tag === "started") {
            // L4: started only when the requester's exit committed after the write turn.
            expect(want.outcome, "L4: only a fresh start can answer started").toBe("fresh");
            expect(exited.rev, "L4: a requester exit committed after the write turn leaves started").toBeGreaterThan(
              answer.success.rev,
            );
            placed(child, call, answer, "a start whose requester exited after its write turn");
            const life = world.names.get(child.name) as Held;
            expect(life.state, "L4: the child keeps running").toBe("live");
            seen.add("exit_late");
          } else {
            // The exit landed before the start's last turn: stale_sender, and nothing of the child.
            // The requester check comes before the grant and whereis, so this holds for any unsaved start.
            refused(answer, "stale_sender", "L4: a requester exit before the start's last turn");
            const written = yield* rowsNow([child.name]);
            expect(
              written.filter((e) => e.id === child.id || e.id === letterId(child.id)),
              "L4: a stale requester's start writes nothing",
            ).toEqual([]);
            world.unsaved.set(child.id, child);
            seen.add("exit_early");
          }

          break;
        }
        case "reopen":
          yield* store.reopen;
          break;
      }

      done.add(move);
      yield* check();
    });
    // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check owns the generated command walk
    yield* Effect.promise(() => fc.asyncModelRun(() => ({ model: world, real: { step } }), tape));
  });

const prop = (
  name: string,
  open: Effect.Effect<Store, never, Scope.Scope>,
  moves: ReadonlyArray<Move>,
  required: ReadonlyArray<Move>,
  answers: ReadonlyArray<string>,
  numRuns: number,
) =>
  it.effect(
    name,
    () =>
      Effect.gen(function* () {
        const done = new Set<Move>();
        const seen: Tally = new Set();
        const law = walk(open, moves, done, seen);
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
        const property = fc.asyncProperty(Tape, (tape) => Effect.runPromise(Effect.scoped(law(tape))));
        const checks = { seed: SEED, numRuns, includeErrorInReport: true, endOnFailure: true };
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, checks));
        // An empty walk cannot pass: every move and every answer the law is about was reached.
        expect([...done].sort(), "every move the law is about ran").toEqual(
          expect.arrayContaining([...required].sort()),
        );
        expect([...seen].sort(), "every answer the law is about was given").toEqual(
          expect.arrayContaining([...answers].sort()),
        );
      }),
    600_000,
  );

// --- L2: racing starts of one free name ---------------------------------------------------------

const REQUESTERS: ReadonlyArray<readonly [string, string]> = [
  ["queue:1", QUEUE],
  ["queue:1", QUEUE],
  ["worker:9", WORKER],
  ["rogue:1", ROGUE],
];

const Racer = fc.record({
  id: fc.nat(3),
  program: fc.constantFrom(MERGER, MERGER, MERGER, WORKER),
  requester: fc.nat(),
  same: fc.boolean(),
  input: fc.nat(),
  m: Json,
});

const Race = fc.record({
  name: fc.stringMatching(/^merger:[1-9][0-9]{0,2}$/),
  racers: fc.array(Racer, { minLength: 2, maxLength: 6 }),
  /** 0 exits the child once it exists; any other number exits one requester. */
  exits: fc.array(fc.nat(3), { maxLength: 3 }),
});
type Race = typeof Race extends fc.Arbitrary<infer A> ? A : never;

const race = (open: Effect.Effect<Store, never, Scope.Scope>, seen: Tally) =>
  Effect.fnUntraced(function* (s: fc.Scheduler, plan: Race) {
    const store = yield* open;
    const next = ids(...PIDS);
    const plain = <A, E>(effect: Effect.Effect<A, E, Children | ProcessManager | Mailbox | Ledger>) =>
      effect.pipe(Effect.provide(layer(store.sql, next.next)));
    const pids = new Map<string, string>();

    for (const [name, program] of BOOT) {
      const placed = yield* plain(
        ProcessManager.use((p) =>
          p.start(Start.cases.first.make({ id: `boot:${name}`, name, code: { program, hash: HASH } }), from()),
        ),
      ).pipe(Effect.orDie);
      pids.set(name, placed.process);
    }

    // Each racer's child: ids drawn from two shared slots and fresh ones; a shared id keeps the first
    // racer's content, or changes one field of it.
    const first = new Map<string, Child>();
    const children = plan.racers.map((r, index): { child: Child; requester: string } => {
      const id = r.id < 2 ? `race/${r.id}` : `race/u${index}`;
      const [requester] = choose(REQUESTERS, r.requester);
      const own: Child = {
        id,
        name: plan.name,
        code: { program: r.program, hash: HASH },
        requester: Recipient.cases.process.make({ process: pids.get(requester) as string }),
        ...inputFor({ input: r.input, m: r.m } as Cell),
      };
      const prior = first.get(id);

      if (prior === undefined) {
        first.set(id, own);
        return { child: own, requester };
      }

      return {
        child: r.same
          ? { ...prior, ...(prior.input === undefined ? {} : { input: reorder(copied(prior.input)) as Schema.Json }) }
          : r.input % 2 === 0
            ? { ...prior, input: ["changed", r.input] }
            : { ...prior, code: { ...prior.code, program: prior.code.program === MERGER ? WORKER : MERGER } },
        requester: [...pids].find(([, p]) => p === prior.requester.process)?.[0] as string,
      };
    });

    const log: Array<{ readonly racer: number; readonly head: number }> = [];
    const answers: Array<Answer | undefined> = children.map(() => undefined);
    let finished = 0;
    const total = children.length + plan.exits.length;
    const turn = (label: string) =>
      // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's scheduler releases each turn as a Promise
      Effect.promise(() => s.schedule(Promise.resolve(label), label)).pipe(Effect.asVoid);
    const tasks = [
      ...children.map(({ child }, index) =>
        Children.use((c) => c.start(child, from({ parent: `in-${PIDS[0]}-${index + 1}` }))).pipe(
          Effect.provide(
            layer(
              store.sql,
              next.next,
              () => turn(`racer ${index}`),
              (t) => log.push({ racer: index, head: headIn(t, [plan.name, ...BOOT.map(([n]) => n)]) }),
            ),
          ),
          Effect.result,
          Effect.tap((answer) =>
            Effect.sync(() => {
              answers[index] = answer;
            }),
          ),
        ),
      ),
      ...plan.exits.map((e) =>
        turn(`exit ${e}`).pipe(
          Effect.andThen(
            Effect.gen(function* () {
              const all = yield* plain(entries([plan.name, ...BOOT.map(([n]) => n)]));
              const child = all.find((x) => x.stream === `processes/${plan.name}` && x._tag === "started");
              const exited = (process: string) =>
                all.some((x) => x._tag === "exited" && body(x)["process"] === process);
              const [name] = choose(REQUESTERS, e);
              const target =
                e === 0 ? (child === undefined ? undefined : String(body(child)["process"])) : pids.get(name);

              if (target !== undefined && !exited(target)) {
                yield* plain(ProcessManager.use((p) => p.exit(target, e === 0 ? NORMAL : SHUTDOWN, from()))).pipe(
                  Effect.ignore,
                );
              }
            }),
          ),
        ),
      ),
    ];
    const fibers = yield* Effect.forEach(
      tasks,
      (task) => Effect.forkChild(task.pipe(Effect.ensuring(Effect.sync(() => finished++)))),
      { concurrency: 1 },
    );

    for (let round = 0; finished < total; round++) {
      expect(round, "the race settles").toBeLessThan(20_000);

      if (s.count() > 0) {
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's scheduler answers a Promise
        yield* Effect.promise(() => s.waitNext(1));
      } else {
        yield* Effect.sleep("1 millis");
      }
    }

    yield* Fiber.joinAll(fibers);

    // The oracle: the ledger's entries, cut at each racer's last turn by the revs the ledger gave.
    const all = yield* plain(entries([plan.name, ...BOOT.map(([n]) => n)]));
    const lives = all.filter((e) => e.stream === `processes/${plan.name}` && e._tag === "started");
    expect(lives.length, "L2: racing starts of one free name make at most one process").toBeLessThanOrEqual(1);
    const p = lives[0];
    const registered = all.find(
      (e) => e.stream === "processes" && e._tag === "registered" && body(e)["name"] === plan.name,
    );
    const exitedAt = (process: string) =>
      all.find((e) => e._tag === "exited" && body(e)["process"] === process)?.rev ?? Number.POSITIVE_INFINITY;
    const letter =
      p === undefined ? undefined : all.find((e) => e.stream === `${plan.name}/inbox` && e.id === letterId(p.id));
    let starts = 0;

    children.forEach(({ child, requester }, index) => {
      const answer = answers[index] as Answer;
      const last = log.filter((l) => l.racer === index).at(-1);
      expect(last, `racer ${index} ran a turn`).toBeDefined();
      const at = last?.head ?? 0;
      const label = `L2: racer ${index} (${child.id}, ${child.code.program}, ${requester}) at rev ${at}, answered ${shown(answer)}`;

      if (p !== undefined && p.rev <= at && child.id === p.id) {
        const same =
          child.code.program === body(p)["program"] &&
          child.requester.process === (body(p)["requester"] as { process?: string } | undefined)?.process &&
          ((child.input === undefined && letter === undefined) ||
            (child.input !== undefined && letter !== undefined && sameJson(child.input, body(letter)["m"])));

        if (same) {
          expect(Result.isSuccess(answer) ? answer.success : answer.failure, label).toEqual(
            Started.cases.started.make({ process: String(body(p)["process"]), name: plan.name, rev: p.rev }),
          );
          starts++;
          seen.add("started");
        } else {
          refused(answer, "id_reused", label);
          seen.add("id_reused");
        }

        return;
      }

      if (exitedAt(child.requester.process) <= at) {
        refused(answer, "stale_sender", label);
        seen.add("stale_sender");
        return;
      }

      const program = REQUESTERS.find(([n]) => n === requester)?.[1] as string;

      if (!granted(program, child.code.program)) {
        refused(answer, "forbidden", label);
        seen.add("forbidden");
        return;
      }

      expect(registered !== undefined && registered.rev <= at, `${label}: a racer never answers from a free name`).toBe(
        true,
      );

      if (body(registered as Entry)["program"] !== child.code.program) {
        refused(answer, "name_taken", label);
        seen.add("name_taken");
        return;
      }

      const tag = exitedAt(String(body(p as Entry)["process"])) <= at ? "already_present" : "already_started";
      expect(Result.isSuccess(answer) ? answer.success : answer.failure, label).toEqual(
        Started.cases[tag].make({ process: String(body(p as Entry)["process"]), name: plan.name }),
      );
      seen.add(tag);
    });

    if (starts > 1) {
      seen.add("shared_started");
    }
  });

// --- L11: secrets stay out of answers, spans and logs ---------------------------------------------

// Encoded forms differ on purpose; an alphanumeric sentinel alone cannot prove escaping checks.
const Secret = fc
  .tuple(fc.stringMatching(/^sk-[A-Za-z0-9]{24}$/), fc.constantFrom("", '"', "/%? ", "\n"))
  .map(([word, suffix]) => word + suffix);

/** Every form a secret could take in an output: raw, JSON-escaped and percent-encoded. */
const forms = (secret: string) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];

const capture = Effect.fnUntraced(function* (sql: Sql) {
  const context = yield* Layer.build(SpanSink.layer(sql, { object: "p42-secrets" }));
  const tracer = Context.get(context, Tracer.Tracer);
  const lines: Array<string> = [];
  const logger = Logger.make((options) => {
    lines.push(Logger.formatSimple.log(options), Logger.formatLogFmt.log(options), Logger.formatJson.log(options));
  });
  // Inspect the real sink's saved span and failure content, including nested storage causes.
  const exported = () => sql.exec("SELECT row, content FROM unsent").map((row) => JSON.stringify(row));
  return { tracer, logger, lines, exported };
});

const secrets = (open: Effect.Effect<Store, never, Scope.Scope>, seen: Tally) =>
  Effect.fnUntraced(function* (secret: string, kind: number) {
    const store = yield* open;
    const { sql, arm, disarm } = cutting(store.sql);
    const pids = ids(...PIDS);
    const mode = kind % 3;
    const next =
      mode === 2
        ? Effect.suspend(() => (pids.calls() >= 1 ? Effect.die(new Error(`defect ${secret}`)) : pids.next))
        : pids.next;
    const boot = yield* ProcessManager.use((p) =>
      p.start(
        Start.cases.first.make({ id: "boot:queue:1", name: "queue:1", code: { program: QUEUE, hash: HASH } }),
        from(),
      ),
    ).pipe(Effect.provide(layer(sql, next)), Effect.orDie);
    const seenBy = yield* capture(store.sql);
    const child: Child = {
      id: `${boot.process}/1/0`,
      name: "merger:1",
      code: { program: MERGER, hash: HASH },
      requester: Recipient.cases.process.make({ process: boot.process }),
      input: { type: "land", token: secret, nested: [`Bearer ${secret}`] },
    };

    if (mode === 1) {
      arm("insert", `SQLITE_FULL at ${secret}`);
    }

    const exit = yield* Children.use((c) => c.start(child, from())).pipe(
      Effect.provide(layer(sql, next)),
      Effect.withTracer(seenBy.tracer),
      Effect.provide(Logger.layer([seenBy.logger])),
      Effect.exit,
    );
    disarm();
    const outputs: Array<string> = [...seenBy.exported(), ...seenBy.lines];

    if (Exit.isSuccess(exit)) {
      outputs.push(JSON.stringify(exit.value));
      seen.add("answer");
    } else {
      const failure = Cause.findErrorOption(exit.cause);

      if (Option.isSome(failure) && failure.value instanceof ChildrenError) {
        const error = failure.value;
        // The cause is a value kept for the library caller; the error's own message and fields are output.
        outputs.push(error.message, String(error.reason), JSON.stringify({ ...error, cause: undefined }));
        seen.add(error.reason);
      } else {
        outputs.push(Cause.pretty(exit.cause));
        seen.add("defect");
      }
    }

    for (const output of outputs) {
      for (const form of forms(secret)) {
        expect(output.includes(form), `L11: a secret reached an output: ${output.slice(0, 200)}`).toBe(false);
      }
    }
  });

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("P42 slice 1: the start piece on a real store", () => {
    prop(
      "L1: an unsaved start of a free name starts one process in one turn; others answer name_taken, already_started or already_present and write nothing",
      open,
      ["start", "exit", "down", "restart", "retry_unsaved", "reopen"],
      ["start", "exit", "down", "restart", "retry_unsaved"],
      ["started", "name_taken", "already_started", "already_present", "own_name"],
      200,
    );

    it.effect(
      "L2: racing starts of one free name make at most one process, and every racer answers by its own last turn",
      () =>
        Effect.gen(function* () {
          const seen: Tally = new Set();
          const law = race(open, seen);
          const turns = fc.scheduler();
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each race
          const property = fc.asyncProperty(turns, Race, (s, p) => Effect.runPromise(Effect.scoped(law(s, p))));
          const checks = { seed: SEED, numRuns: 100, includeErrorInReport: true, endOnFailure: true };
          // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
          yield* Effect.promise(() => fc.assert(property, checks));
          expect([...seen].sort(), "every answer a race can give was given").toEqual(
            expect.arrayContaining(
              [
                "started",
                "shared_started",
                "id_reused",
                "already_started",
                "already_present",
                "name_taken",
                "stale_sender",
                "forbidden",
              ].sort(),
            ),
          );
        }),
      600_000,
    );

    prop(
      "L3: a saved start id retried with the same caller fields answers its saved started forever; another field is id_reused",
      open,
      [
        "start",
        "retry_saved",
        "retry_changed",
        "retry_unsaved",
        "exit",
        "down",
        "restart",
        "exit_between",
        "cut_answer",
        "reopen",
      ],
      ["start", "retry_saved", "retry_changed", "retry_unsaved", "exit", "down", "restart", "cut_answer", "reopen"],
      ["retried", "id_reused", "cut_answer", "asked_afresh"],
      200,
    );
    prop(
      "L4: a start needs a live requester whose program is granted the child's program, as of the start's last turn",
      open,
      ["start", "start_stale", "exit", "restart", "exit_between", "retry_unsaved"],
      ["start", "start_stale", "exit_between", "restart"],
      ["started", "stale_sender", "forbidden", "exit_early", "exit_late", "exit_after"],
      200,
    );
    prop(
      "L5: every started line keeps its requester, its parent and its code, under a name the brain owns",
      open,
      ["start", "exit", "restart", "retry_saved", "reopen"],
      ["start", "retry_saved"],
      ["started", "retried"],
      200,
    );
    prop(
      "L6: decode comes first: a bad name is bad_name, any other field off its schema or a letter over the row limit is bad_input, and nothing is written",
      open,
      ["start", "bad", "big", "retry_saved", "cut_write"],
      ["bad", "big", "cut_write"],
      ["bad_name", "bad_input", "too_big", "storage"],
      200,
    );

    it.effect(
      "L11: a secret in the input, a storage cause or a defect stays out of answers, error messages, spans and logs",
      () =>
        Effect.gen(function* () {
          const seen: Tally = new Set();
          const law = secrets(open, seen);
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each case
          const property = fc.asyncProperty(Secret, fc.nat(), (x, k) => Effect.runPromise(Effect.scoped(law(x, k))));
          const checks = { seed: SEED, numRuns: 100, includeErrorInReport: true, endOnFailure: true };
          // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
          yield* Effect.promise(() => fc.assert(property, checks));
          expect([...seen].sort()).toEqual(expect.arrayContaining(["answer", "storage", "defect"].sort()));
        }),
      600_000,
    );

    // scenario: L13. Resource lifetime is one path, not a space to walk: one run interrupted
    // mid-walk must still give back every database handle its scope opened.
    it.effect("scenario: L13: an interrupted walk gives back every handle its scope acquired", () =>
      Effect.gen(function* () {
        let probe: Store["probe"] | undefined;
        const held = Effect.scoped(
          Effect.gen(function* () {
            const store = yield* open;
            probe = store.probe;
            yield* Children.use((c) =>
              c.start(
                {
                  id: "l13/1/0",
                  name: "merger:1",
                  code: { program: MERGER, hash: HASH },
                  requester: Recipient.cases.process.make({ process: PIDS[0] as string }),
                },
                from(),
              ),
            ).pipe(Effect.provide(layer(store.sql, ids(...PIDS).next)), Effect.result);
            return yield* Effect.never;
          }),
        );
        const fiber = yield* Effect.forkChild(held);

        for (let turn = 0; turn < 1000 && probe === undefined; turn++) {
          yield* Effect.yieldNow;
        }

        yield* Fiber.interrupt(fiber);
        expect(probe, "the walk acquired its store").toBeDefined();
        expect(probe?.open(), "L13: no database handle outlives its scope").toBe(0);
      }),
    );
  });
