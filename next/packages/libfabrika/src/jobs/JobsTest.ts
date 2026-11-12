// P39 slice 1, L1 to L8 on a real store (0062): the laws, and no driver. A runner in the module that
// owns a driver calls `JobsTest.suite(open)`; `open` acquires one store in a scope and gives it back
// when that scope closes. Each law walks a decision tape (0093): every cell is read against the jobs
// the fold has saved so far, so a retry names a saved request, a start names a real assignment and a
// cut lands on a transition that is legal there. The oracle is this file's own record of what each
// call was given and answered, never the product's machine.
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Result as R, type Scope, Schema, Arbitrary, Stream } from "effect";
import * as fc from "fast-check";
import * as Id from "../Id.ts";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import { LedgerStreams, LedgerStreamsError, Storage } from "../ledger/LedgerStreams.ts";
import * as LedgerStreamsSql from "../ledger/LedgerStreamsSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import type { Sql } from "../Sql.ts";
import { Command, type Executor, type Job, Request, Recorded, Result, State } from "./Job.ts";
import { Jobs, JobsError } from "./Jobs.ts";
import * as JobsLedger from "./JobsLedger.ts";

/** One real store. `reopen` closes it and opens the same database again, keeping only its rows. */
export type Store = { readonly sql: Sql; readonly reopen: Effect.Effect<void> };

// ---------------------------------------------------------------------------------------------
// Generated values, shared with the pure laws beside this file. Nothing here is key material: a
// key is named by a made-up fingerprint, made when the law runs.

const B32 = "[0-9a-hjkmnp-tv-z]";

/** A canonical UUIDv7 TypeID for `prefix`, as `Id.make(prefix)` accepts it. */
export const fcTypeId = (prefix: string): fc.Arbitrary<string> =>
  fc.stringMatching(new RegExp(`^${prefix}_[0-7]${B32}{9}[ef]${B32}{2}[89abrstv]${B32}{12}$`));

const fcWord = fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/);
const fcTraceId = fc.stringMatching(/^[0-9a-f]{32}$/).filter((text) => !/^0+$/.test(text));
const fcHash = fc.stringMatching(/^[0-9a-f]{16}$/);

/** A made-up public key fingerprint, in OpenSSH's `SHA256:` form. */
export const fcFingerprint = fc.stringMatching(/^SHA256:[A-Za-z0-9+/]{43}$/);

/** Capabilities a host may advertise. `git` is the one `git_version` needs. */
export const CAPABILITIES = ["git", "docker", "node"] as const;

const fcNeeds = fc.uniqueArray(fc.constantFrom(...CAPABILITIES), { minLength: 1, maxLength: 3 });

export const fcResult: fc.Arbitrary<Result> = fc.oneof(
  fc
    .record({ code: fc.integer({ min: -255, max: 255 }), version: fc.string({ maxLength: 40 }) })
    .map((fields) => Result.cases.exited.make(fields)),
  fc.constantFrom("unavailable", "spawn_failed", "output_limit").map((reason) => Result.cases.failed.make({ reason })),
  fc.constant(Result.cases.unknown.make({ reason: "interrupted" })),
);

/** A request for the one command, from a generated process, to one of `targets`. */
export const fcRequest = (targets: ReadonlyArray<string>): fc.Arbitrary<Request> =>
  fc
    .record({
      process: fcTypeId("process"),
      pos: fc.integer({ min: 1, max: 9999 }),
      index: fc.integer({ min: 0, max: 9 }),
      name: fcWord,
      pack: fcWord,
      program: fcWord,
      needs: fcNeeds,
      target: fc.constantFrom(...targets),
      build: fcHash,
      settings: fc.option(fcHash, { nil: null }),
      parent: fc.option(fcTypeId("input"), { nil: null }),
      traceId: fcTraceId,
    })
    .map(({ process, pos, index, name, pack, program, ...rest }) => ({
      id: `${process}/${pos}/${index}`,
      process,
      name,
      program: `${pack}/${program}`,
      command: Command.cases.git_version.make({}),
      ...rest,
    }));

/** One executor: its key, the connection it came on, what it advertises and its build. */
export const fcExecutor = (keys: ReadonlyArray<string>): fc.Arbitrary<Executor> =>
  fc.record({
    key: fc.constantFrom(...keys),
    connection: fcTypeId("connection"),
    has: fc.uniqueArray(fc.constantFrom(...CAPABILITIES), { maxLength: 3 }),
    build: fcHash,
  });

/** What a writer says about one call, with `seen` filled in from the log the fold has reached. */
export const fcRecorded = fc.record({
  by: fc.constantFrom("brain", "gateway:hands", "gateway:window"),
  for: fcTypeId("person"),
  sentAt: fc.integer({ min: 1_700_000_000_000, max: 1_900_000_000_000 }).map((at) => new Date(at).toISOString()),
  parent: fc.option(fcTypeId("input"), { nil: null }),
  traceId: fcTraceId,
  build: fcHash,
});

export type Said = Omit<Recorded, "seen">;

/** A value as it comes back from JSON: equal in every field, never the same object. */
export const copied = <A>(value: A): A => JSON.parse(JSON.stringify(value)) as A;

/** The item a tape number picks; never called on an empty list. */
export const choose = <A>(items: ReadonlyArray<A>, pick: number): A => {
  const item = items[pick % items.length];

  if (item === undefined) {
    throw new Error("a move chose from an empty list");
  }

  return item;
};

/** One field of a request changed to another valid value: same id, different bytes. */
export const changedRequest = (request: Request, pick: number, other: Request): Request => {
  const field = choose(["target", "process", "name", "program", "needs", "build", "settings", "parent"] as const, pick);
  const differs = <A>(a: A, b: A, fallback: A): A => (JSON.stringify(a) === JSON.stringify(b) ? fallback : b);

  if (field === "target") {
    return { ...request, target: differs(request.target, other.target, `${request.target}x`) };
  }

  if (field === "process") {
    const flipped = request.process.replace(/.$/, (last) => (last === "0" ? "1" : "0"));
    return { ...request, process: differs(request.process, other.process, flipped) };
  }

  if (field === "name") {
    return { ...request, name: `${request.name}-changed` };
  }

  if (field === "program") {
    return { ...request, program: `${request.program}-changed` };
  }

  if (field === "needs") {
    return { ...request, needs: request.needs.length === 1 ? [...CAPABILITIES] : request.needs.slice(0, 1) };
  }

  if (field === "build") {
    return { ...request, build: `${request.build}0` };
  }

  if (field === "settings") {
    return { ...request, settings: request.settings === null ? "changed" : null };
  }

  if (request.parent === null && other.parent === null) {
    return { ...request, build: `${request.build}1` };
  }

  return { ...request, parent: request.parent === null ? other.parent : null };
};

/** A value one field away from valid: wrong type, empty text or a missing key. */
export const broken = (value: object, pick: number, bad: ReadonlyArray<readonly [string, unknown]>): unknown => {
  const [key, replacement] = choose(bad, pick);

  if (replacement === MISSING) {
    const { [key]: _gone, ...rest } = value as Record<string, unknown>;
    return rest;
  }

  return { ...value, [key]: replacement };
};

export const MISSING = Symbol("missing");

/** Invalid replacements for each field a request decodes, one per pick. */
export const BAD_REQUEST: ReadonlyArray<readonly [string, unknown]> = [
  ["id", ""],
  ["id", MISSING],
  ["process", "not-a-process"],
  ["process", 7],
  ["name", ""],
  ["program", ""],
  ["program", MISSING],
  // A command case the closed schema does not have, written as JSON would bring it.
  ["command", JSON.parse('{"_tag":"shell","text":"rm -rf ."}')],
  ["command", "git --version"],
  ["needs", "git"],
  ["needs", [""]],
  ["target", ""],
  ["target", MISSING],
  ["build", ""],
  ["settings", 5],
  ["settings", MISSING],
  ["parent", "not-an-input"],
  ["parent", MISSING],
  ["traceId", "0".repeat(32)],
  ["traceId", "XYZ"],
];

export const BAD_EXECUTOR: ReadonlyArray<readonly [string, unknown]> = [
  ["key", ""],
  ["key", MISSING],
  ["connection", ""],
  ["has", "git"],
  ["has", [""]],
  ["build", MISSING],
];

export const BAD_RESULT: ReadonlyArray<readonly [string, unknown]> = [
  ["_tag", "succeeded"],
  ["_tag", MISSING],
  ["code", 1.5],
  ["code", "0"],
  ["reason", "boom"],
];

export const BAD_RECORDED: ReadonlyArray<readonly [string, unknown]> = [
  ["by", ""],
  ["for", ""],
  ["for", MISSING],
  ["sentAt", 5],
  ["seen", -1],
  ["seen", 1.5],
  ["parent", "not-an-input"],
  ["traceId", "nope"],
  ["build", ""],
];

/** A result one field away from valid, for the case it has. */
export const brokenResult = (result: Result, pick: number): unknown => {
  const fits = BAD_RESULT.filter(
    ([key]) =>
      key === "_tag" || (key === "code" ? result._tag === "exited" : key === "reason" && result._tag !== "exited"),
  );
  return broken(result, pick, fits);
};

// ---------------------------------------------------------------------------------------------
// The walk on a real store.

/** One tape cell: which move, which job, which variant, and fresh values to use if the move needs them. */
const Cell = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  variant: fc.nat(),
  said: fcRecorded,
  seen: fc.nat(),
  result: fcResult,
  other: fcResult,
  connection: fcTypeId("connection"),
  build: fcHash,
});
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;

/** A tape: three made-up keys, a pool of requests to them, and the cells. Only the first two keys hold `git`. */
const Tape = fc.uniqueArray(fcFingerprint, { minLength: 3, maxLength: 3 }).chain((keys) =>
  fc.record({
    keys: fc.constant(keys),
    requests: fc.uniqueArray(fcRequest(keys.slice(0, 2)), { minLength: 4, maxLength: 6, selector: (r) => r.id }),
    cells: fc.array(Cell, { minLength: 12, maxLength: 40, size: "max" }),
  }),
);
type Tape = typeof Tape extends fc.Arbitrary<infer A> ? A : never;

type Move =
  | "request_new"
  | "request_equal"
  | "request_changed"
  | "take_ok"
  | "take_again"
  | "take_other"
  | "take_lacking"
  | "start_ok"
  | "start_again"
  | "start_wrong"
  | "finish_ok"
  | "finish_equal"
  | "finish_other"
  | "finish_wrong"
  | "out_of_order"
  | "unknown_id"
  | "bad"
  | "cut_before"
  | "cut_after"
  | "reopen";

type Phase = "requested" | "assigned" | "started" | "finished";
type Receipt = { readonly rev: number; readonly arrivedAt: number };
type Event = "requested" | "taken" | "started" | "finished";

/** What the fold knows of one job, from its own calls and their answers. */
type Saved = {
  readonly request: Request;
  phase: Phase;
  executor?: Executor;
  execution?: string;
  result?: Result;
  taken?: Receipt & { readonly execution: string };
  readonly receipts: Map<Event, Receipt>;
  readonly events: Array<Recorded & Receipt & { readonly event: Event }>;
};

type World = { readonly jobs: Map<string, Saved>; head: number; next: number };

const INSERT = /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+entries\b/i;

/** The store's Sql with one planted fault: refuse the next entry insert, or the statement after it. */
const cutting = (sql: Sql) => {
  const fault = { at: null as "before" | "after" | null, armed: false };
  const wrapped: Sql = {
    exec: (query, ...params) => {
      if (fault.at === "before" && INSERT.test(query)) {
        fault.at = null;
        throw new Error("SQLITE_FULL planted before an append");
      }

      if (fault.at === "after" && fault.armed) {
        fault.at = null;
        fault.armed = false;
        throw new Error("SQLITE_IOERR planted after an append");
      }

      if (fault.at === "after" && INSERT.test(query)) {
        fault.armed = true;
      }

      return sql.exec(query, ...params);
    },
    // A fault armed by the last statement fails the turn as it commits, so the append rolls back.
    transaction: (step) =>
      sql.transaction(() => {
        const answer = step();

        if (fault.at === "after" && fault.armed) {
          fault.at = null;
          fault.armed = false;
          throw new Error("SQLITE_IOERR planted after an append");
        }

        return answer;
      }),
    size: () => sql.size(),
  };
  return { sql: wrapped, fault };
};

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

const layer = (sql: Sql) =>
  JobsLedger.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        LedgerSql.layer(sql, { reader: "connection:jobs-test" }),
        LedgerTransactionSql.layer(sql),
        LedgerStreamsSql.layer(sql),
      ).pipe(Layer.provide(quiet)),
    ),
    Layer.provide(Id.Generator.layer),
  );

const refused = (answer: R.Result<unknown, unknown>, message: string, reason?: string) => {
  expect(R.isFailure(answer), message).toBe(true);
  const failure = R.isFailure(answer) ? answer.failure : undefined;
  expect(failure, message).toBeInstanceOf(JobsError);
  expect(failure, message).toMatchObject(reason === undefined ? {} : { reason });
};

const success = <A>(answer: R.Result<A, unknown>, message: string): A => {
  if (R.isFailure(answer)) {
    expect.fail(`${message}: ${String(answer.failure)}`);
  }

  return answer.success;
};

/** The job the oracle expects `read` to answer: its state, and one event per accepted call. */
const expected = (saved: Saved): Job => {
  const { request, executor, execution, result } = saved;
  const assignment = executor === undefined || execution === undefined ? undefined : { execution, executor };
  const state =
    saved.phase === "requested"
      ? State.cases.requested.make({ request })
      : saved.phase === "assigned" && assignment !== undefined
        ? State.cases.assigned.make({ request, assignment })
        : saved.phase === "started" && assignment !== undefined
          ? State.cases.started.make({ request, assignment })
          : assignment !== undefined && result !== undefined
            ? State.cases.finished.make({ request, assignment, result })
            : expect.fail("the fold reached a phase without its facts");
  return { state, events: saved.events } as Job;
};

const at = (world: World, phases: ReadonlyArray<Phase>) =>
  [...world.jobs.values()].filter((j) => phases.includes(j.phase));

/** The moves possible in this world, each only when the world can take it. */
const possible = (world: World, tape: Tape, moves: ReadonlyArray<Move>): ReadonlyArray<Move> => {
  const any = world.jobs.size > 0;
  const fresh = world.next < tape.requests.length;
  const requested = at(world, ["requested"]).length > 0;
  const assigned = at(world, ["assigned"]).length > 0;
  const started = at(world, ["started"]).length > 0;
  const finished = at(world, ["finished"]).length > 0;
  const owned = at(world, ["assigned", "started", "finished"]).length > 0;
  const can: Record<Move, boolean> = {
    request_new: fresh,
    request_equal: any,
    request_changed: any,
    take_ok: requested,
    take_again: owned,
    take_other: any,
    take_lacking: any,
    start_ok: assigned,
    start_again: started || finished,
    start_wrong: owned,
    finish_ok: started,
    finish_equal: finished,
    finish_other: finished,
    finish_wrong: owned,
    out_of_order: requested || assigned,
    unknown_id: true,
    bad: any || fresh,
    cut_before: fresh || requested || assigned || started,
    cut_after: fresh || requested || assigned || started,
    reopen: true,
  };
  return moves.filter((move) => can[move]);
};

/** An executor for `job` that may take it: its target key, holding every capability it needs. */
const able = (saved: Saved, cell: Cell): Executor => ({
  key: saved.request.target,
  connection: cell.connection,
  has: [...new Set([...saved.request.needs, ...CAPABILITIES.slice(0, cell.variant % 2)])],
  build: cell.build,
});

/** Another execution identity than the saved one, close to it on purpose. */
const otherExecution = (execution: string, variant: number): string =>
  choose([`${execution}x`, execution.slice(0, -1) || "e", `other-${execution}`], variant);

/** A move, or a move in the one phase of the job it was played on. */
type Done = Move | `${Move}@${Phase}`;

const walk = (open: Effect.Effect<Store, never, Scope.Scope>, moves: ReadonlyArray<Move>, done: Set<Done>) =>
  Effect.fnUntraced(function* (tape: Tape) {
    const store = yield* open;
    const { sql, fault } = cutting(store.sql);
    const world: World = { jobs: new Map(), head: 0, next: 0 };
    // One service for the life of the store, built again on reopen as a restarted brain would.
    let life = yield* Layer.build(layer(sql));
    const jobs = <A>(call: (jobs: Jobs["Service"]) => Effect.Effect<A, JobsError>) =>
      Jobs.use(call).pipe(Effect.provide(life), Effect.result);
    const said = (cell: Cell): Recorded => ({ ...cell.said, seen: cell.seen % (world.head + 1) });
    /** Keep an accepted call's receipt as the oracle's next event, and move the log head. */
    const keep = (saved: Saved, event: Event, recorded: Recorded, receipt: Receipt) => {
      expect(receipt.rev, "an accepted call is placed past every earlier one").toBeGreaterThan(world.head);
      world.head = receipt.rev;
      saved.receipts.set(event, receipt);
      saved.events.push({ ...recorded, event, rev: receipt.rev, arrivedAt: receipt.arrivedAt });
    };
    /** Every saved job reads as the oracle kept it, and every request not yet saved reads as absent. */
    const unchanged = Effect.fnUntraced(function* (message: string) {
      for (const request of tape.requests) {
        const saved = world.jobs.get(request.id);
        const answer = yield* jobs((j) => j.read(request.id));

        if (saved === undefined) {
          refused(answer, `${message}: an id nobody saved reads as not found`, "not_found");
        } else {
          expect(success(answer, `${message}: read ${request.id}`), message).toEqual(expected(saved));
        }
      }
    });

    for (const cell of tape.cells) {
      const options = possible(world, tape, moves);

      if (options.length === 0) {
        continue;
      }

      const move = choose(options, cell.move);
      const recorded = said(cell);
      /** The job a move is played on, and the phase it was in then. */
      const on = (phases: ReadonlyArray<Phase>) => {
        const saved = choose(at(world, phases), cell.pick);
        done.add(`${move}@${saved.phase}`);
        return saved;
      };

      switch (move) {
        case "request_new": {
          const request = choose(tape.requests, world.next++);
          const receipt = success(yield* jobs((j) => j.request(copied(request), recorded)), "a new request is saved");
          const saved: Saved = { request, phase: "requested", receipts: new Map(), events: [] };
          world.jobs.set(request.id, saved);
          keep(saved, "requested", recorded, receipt);
          break;
        }
        case "request_equal": {
          const saved = choose([...world.jobs.values()], cell.pick);
          const answer = yield* jobs((j) => j.request(copied(saved.request), recorded));
          expect(success(answer, "an equal request retry succeeds"), "it answers the first receipt").toEqual(
            saved.receipts.get("requested"),
          );
          break;
        }
        case "request_changed": {
          const saved = choose([...world.jobs.values()], cell.pick);
          const other = choose(tape.requests, cell.variant);
          const changed = changedRequest(saved.request, cell.variant, other);
          refused(yield* jobs((j) => j.request(changed, recorded)), "changed bytes under a saved id", "conflict");
          break;
        }
        case "take_ok": {
          const saved = choose(at(world, ["requested"]), cell.pick);
          const executor = able(saved, cell);
          const taken = success(yield* jobs((j) => j.take(saved.request.id, copied(executor), recorded)), "a take");
          expect(taken.execution.length, "the take allocates an execution identity").toBeGreaterThan(0);
          saved.phase = "assigned";
          saved.executor = executor;
          saved.execution = taken.execution;
          saved.taken = taken;
          keep(saved, "taken", recorded, taken);
          break;
        }
        case "take_again": {
          // The take reply was lost: the same key, maybe on a new connection, gets its saved assignment,
          // whether or not the job has started or finished since.
          const saved = on(["assigned", "started", "finished"]);
          const executor = able(saved, cell);
          const taken = success(yield* jobs((j) => j.take(saved.request.id, executor, recorded)), "a repeated take");
          expect(taken, "a repeated take answers the first assignment").toEqual(saved.taken);
          break;
        }
        case "take_other": {
          const saved = choose([...world.jobs.values()], cell.pick);
          const key = choose(
            tape.keys.filter((k) => k !== saved.request.target),
            cell.variant,
          );
          const executor = { ...able(saved, cell), key, has: [...CAPABILITIES] };
          refused(yield* jobs((j) => j.take(saved.request.id, executor, recorded)), "another key's take", "not_target");
          break;
        }
        case "take_lacking": {
          const saved = on(["requested", "assigned", "started", "finished"]);
          const missing = choose(saved.request.needs, cell.variant);
          const executor = { ...able(saved, cell), has: CAPABILITIES.filter((c) => c !== missing) };
          refused(
            yield* jobs((j) => j.take(saved.request.id, executor, recorded)),
            "a take without a needed capability",
            "lacks_capability",
          );
          break;
        }
        case "start_ok": {
          const saved = choose(at(world, ["assigned"]), cell.pick);
          const execution = saved.execution ?? expect.fail("an assigned job has an execution");
          const receipt = success(
            yield* jobs((j) => j.started(saved.request.id, execution, recorded)),
            "a start by the assignment",
          );
          saved.phase = "started";
          keep(saved, "started", recorded, receipt);
          break;
        }
        case "start_again": {
          // A lost start acknowledgement, retried even after the finish: it never moves the job back.
          const saved = on(["started", "finished"]);
          const execution = saved.execution ?? expect.fail("a started job has an execution");
          const answer = yield* jobs((j) => j.started(saved.request.id, `${execution}`, recorded));
          expect(success(answer, "a repeated start"), "it answers the first start").toEqual(
            saved.receipts.get("started"),
          );
          break;
        }
        case "start_wrong":
        case "finish_wrong": {
          const saved = choose(at(world, ["assigned", "started", "finished"]), cell.pick);
          const wrong = otherExecution(saved.execution ?? "", cell.variant);
          const answer =
            move === "start_wrong"
              ? yield* jobs((j) => j.started(saved.request.id, wrong, recorded))
              : yield* jobs((j) => j.finish(saved.request.id, wrong, cell.result, recorded));
          refused(answer, "an unrelated execution identity", "wrong_execution");
          break;
        }
        case "out_of_order": {
          // Before a take nothing may start or finish; an assigned job may not finish, even by its own execution.
          const saved = on(["requested", "assigned"]);
          const execution = saved.execution ?? "any-execution";
          const answer =
            saved.phase === "requested" && cell.variant % 2 === 0
              ? yield* jobs((j) => j.started(saved.request.id, execution, recorded))
              : yield* jobs((j) => j.finish(saved.request.id, execution, cell.result, recorded));
          refused(answer, "a start or a finish out of order", "wrong_state");
          break;
        }
        case "finish_ok": {
          const saved = choose(at(world, ["started"]), cell.pick);
          const execution = saved.execution ?? expect.fail("a started job has an execution");
          const receipt = success(
            yield* jobs((j) => j.finish(saved.request.id, execution, copied(cell.result), recorded)),
            "a finish by the assignment",
          );
          saved.phase = "finished";
          saved.result = cell.result;
          keep(saved, "finished", recorded, receipt);
          break;
        }
        case "finish_equal": {
          const saved = choose(at(world, ["finished"]), cell.pick);
          const answer = yield* jobs((j) =>
            j.finish(saved.request.id, saved.execution ?? "", copied(saved.result ?? cell.result), recorded),
          );
          expect(success(answer, "an equal finish retry"), "it answers the first finish").toEqual(
            saved.receipts.get("finished"),
          );
          break;
        }
        case "finish_other": {
          const saved = choose(at(world, ["finished"]), cell.pick);
          const other =
            JSON.stringify(cell.other) === JSON.stringify(saved.result)
              ? Result.cases.exited.make({ code: 1, version: `${JSON.stringify(cell.other)}-other` })
              : cell.other;
          refused(
            yield* jobs((j) => j.finish(saved.request.id, saved.execution ?? "", other, recorded)),
            "a conflicting result for a finished job",
            "conflict",
          );
          break;
        }
        case "unknown_id": {
          // A request's id with one more part: a well-formed id that nobody requested.
          const id = `${choose(tape.requests, cell.pick).id}/0`;
          const executor = {
            key: choose(tape.keys, cell.pick),
            connection: cell.connection,
            has: [...CAPABILITIES],
            build: cell.build,
          };
          const calls: ReadonlyArray<() => Effect.Effect<R.Result<unknown, JobsError>>> = [
            () => jobs((j) => j.read(id)),
            () => jobs((j) => j.take(id, executor, recorded)),
            () => jobs((j) => j.started(id, "any-execution", recorded)),
            () => jobs((j) => j.finish(id, "any-execution", cell.result, recorded)),
          ];
          refused(yield* choose(calls, cell.variant)(), "a call on an id nobody requested", "not_found");
          break;
        }
        case "bad": {
          const answer = yield* badCall(world, tape, cell, recorded, jobs);
          refused(answer, "a call with one invalid field", "bad_input");
          break;
        }
        case "cut_before":
        case "cut_after": {
          fault.at = move === "cut_before" ? "before" : "after";
          fault.armed = false;
          const answer = yield* legalCall(world, tape, cell, recorded, jobs);
          fault.at = null;
          fault.armed = false;
          refused(answer, "a call whose transaction is cut fails", "storage");
          break;
        }
        case "reopen":
          yield* store.reopen;
          life = yield* Layer.build(layer(sql));
          break;
      }

      done.add(move);
      // After every prefix, every saved job reads as the oracle kept it, and nothing else was written.
      yield* unchanged(`after ${move}`);
    }
  });

type Call = <A>(call: (jobs: Jobs["Service"]) => Effect.Effect<A, JobsError>) => Effect.Effect<R.Result<A, JobsError>>;

/** One legal transition the world allows here, called and left uncounted: the cut moves use it. */
const legalCall = (world: World, tape: Tape, cell: Cell, recorded: Recorded, jobs: Call) => {
  const options: Array<() => Effect.Effect<R.Result<unknown, JobsError>>> = [];

  if (world.next < tape.requests.length) {
    // The request stays fresh: the next request_new still sends it, after the cut.
    const request = choose(tape.requests, world.next);
    options.push(() => jobs((j) => j.request(request, recorded)));
  }

  for (const saved of world.jobs.values()) {
    const id = saved.request.id;
    const execution = saved.execution ?? "";

    if (saved.phase === "requested") {
      options.push(() => jobs((j) => j.take(id, able(saved, cell), recorded)));
    } else if (saved.phase === "assigned") {
      options.push(() => jobs((j) => j.started(id, execution, recorded)));
    } else if (saved.phase === "started") {
      options.push(() => jobs((j) => j.finish(id, execution, cell.result, recorded)));
    }
  }

  return choose(options, cell.pick)();
};

/** A call that would be legal here, with one field of its input or its record made invalid. */
const badCall = (world: World, tape: Tape, cell: Cell, recorded: Recorded, jobs: Call) => {
  const saved = [...world.jobs.values()];
  const which = cell.variant % 4;
  const badRecord = broken(recorded, cell.pick, BAD_RECORDED) as Recorded;

  if (which === 0 || saved.length === 0) {
    const request = choose(tape.requests, world.next < tape.requests.length ? world.next : cell.pick);
    return cell.pick % 3 === 0
      ? jobs((j) => j.request(request, badRecord))
      : jobs((j) => j.request(broken(request, cell.pick, BAD_REQUEST) as Request, recorded));
  }

  const job = choose(saved, cell.pick);
  const execution = job.execution ?? "any-execution";

  if (which === 1) {
    return cell.pick % 3 === 0
      ? jobs((j) => j.take(job.request.id, able(job, cell), badRecord))
      : jobs((j) => j.take(job.request.id, broken(able(job, cell), cell.pick, BAD_EXECUTOR) as Executor, recorded));
  }

  if (which === 2) {
    return jobs((j) => j.started(job.request.id, execution, badRecord));
  }

  return cell.pick % 3 === 0
    ? jobs((j) => j.finish(job.request.id, execution, cell.result, badRecord))
    : jobs((j) => j.finish(job.request.id, execution, brokenResult(cell.result, cell.pick) as Result, recorded));
};

const prop = (
  name: string,
  open: Effect.Effect<Store, never, Scope.Scope>,
  moves: ReadonlyArray<Move>,
  required: ReadonlyArray<Done>,
) =>
  it.effect(
    name,
    () =>
      Effect.gen(function* () {
        const done = new Set<Done>();
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

const LIFE: ReadonlyArray<Move> = ["request_new", "take_ok", "start_ok", "finish_ok", "reopen"];

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("P39 slice 1: the durable job service on a real store", () => {
    prop(
      "L1: a request keeps every fact it was given, and each event its writer's record and arrival, through reopen",
      open,
      LIFE,
      ["request_new", "take_ok", "start_ok", "finish_ok", "reopen"],
    );
    prop(
      "L2: an equal request retry answers the first receipt; changed bytes under that id are refused",
      open,
      [...LIFE, "request_equal", "request_changed"],
      ["request_new", "request_equal", "request_changed", "reopen"],
    );
    prop(
      "L3: only the target key holding every need takes a request, and its first execution identity stays",
      open,
      [...LIFE, "take_again", "take_other", "take_lacking"],
      [
        "take_ok",
        "take_other",
        "reopen",
        "take_lacking@requested",
        ...(["assigned", "started", "finished"] as const).flatMap((phase) => [
          `take_again@${phase}` as const,
          `take_lacking@${phase}` as const,
        ]),
      ],
    );
    prop(
      "L4: a start or a finish needs the saved execution identity",
      open,
      [...LIFE, "start_again", "start_wrong", "finish_wrong", "out_of_order", "unknown_id"],
      [
        "start_ok",
        "start_wrong",
        "finish_wrong",
        "unknown_id",
        "start_again@started",
        "start_again@finished",
        "out_of_order@requested",
        "out_of_order@assigned",
      ],
    );
    prop(
      "L5: an equal terminal retry is harmless; a conflicting result never replaces the first",
      open,
      [...LIFE, "finish_equal", "finish_other"],
      ["finish_ok", "finish_equal", "finish_other", "reopen"],
    );
    prop(
      "L6: a transaction cut before or after its append leaves no part of its transition",
      open,
      [...LIFE, "cut_before", "cut_after"],
      ["cut_before", "cut_after", "take_ok", "start_ok"],
    );
    prop(
      "L7: reopening after any committed prefix reads back the same jobs",
      open,
      [...LIFE, "request_equal", "take_again", "start_again", "finish_equal"],
      ["reopen", "start_ok", "finish_ok"],
    );
    prop(
      "L8: a call with one invalid field is refused and changes no job",
      open,
      [...LIFE, "bad"],
      ["bad", "request_new", "take_ok"],
    );
  });

// A5: IDs intentionally disagree with request.process; the saved request decides membership.
export const discoverySuite = (open: Effect.Effect<Store, never, Scope.Scope>) => {
  it.effect(
    "A5: process discovery keeps every saved job through page crossings and reopen",
    () =>
      Effect.gen(function* () {
        const done = new Set<string>();
        const measured = { scans: 0, queries: 0, rows: 0, jobs: 0 };
        const tape = Schema.Struct({
          request: Schema.Struct({ ...Request.fields, process: Id.Process }),
          recorded: Recorded,
          cells: Schema.Array(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).check(
            Schema.isMinLength(8),
            Schema.isMaxLength(40),
          ),
          total: Schema.Int.check(Schema.isGreaterThanOrEqualTo(257), Schema.isLessThanOrEqualTo(530)),
        });
        const check = Effect.fnUntraced(function* (a: typeof tape.Type) {
          const raw = yield* open;
          const work = { queries: 0, rows: 0 };
          const sql: Sql = {
            exec: (query, ...params) => {
              const rows = raw.sql.exec(query, ...params);
              work.queries++;
              work.rows += rows.length;
              return rows;
            },
            transaction: (step) => raw.sql.transaction(step),
            size: () => raw.sql.size(),
          };
          const store = { ...raw, sql };
          let life = yield* Layer.build(layer(store.sql));
          const call = <A, E>(f: (j: Jobs["Service"]) => Effect.Effect<A, E>) => Jobs.use(f).pipe(Effect.provide(life));
          const wanted = a.request.process;
          const other = wanted.replace(/.$/, (last) => (last === "0" ? "1" : "0"));
          const said = { ...a.recorded, seen: 0 };
          const expected = new Map<string, Job>();

          for (let n = 0; n < a.total; n++) {
            const request = { ...a.request, id: `opaque-${n}`, process: n % 3 === 0 ? other : wanted };
            yield* call((j) => j.request(request, said));
            expected.set(request.id, yield* call((j) => j.read(request.id)));
          }

          for (const choice of a.cells) {
            const owned = [...expected.entries()].filter(([, j]) => j.state._tag === "requested");
            const move = choice % (owned.length > 0 ? 3 : 2);

            if (move === 0) {
              yield* store.reopen;
              life = yield* Layer.build(layer(store.sql));
              done.add("reopen");
            } else if (move === 2) {
              const [id, saved] = choose(owned, choice);

              if (saved.state._tag === "requested") {
                yield* call((j) =>
                  j.take(
                    id,
                    {
                      key: saved.state._tag === "requested" ? saved.state.request.target : "",
                      connection: "discovery",
                      has: saved.state._tag === "requested" ? saved.state.request.needs : [],
                      build: "hands",
                    },
                    said,
                  ),
                );
                expected.set(id, yield* call((j) => j.read(id)));
                done.add("taken");
              }
            }

            for (const process of [wanted, other]) {
              const before = { ...work };
              const actual = yield* call((j) => Stream.runCollect(j.forProcess(process)));
              measured.scans++;
              measured.queries += work.queries - before.queries;
              measured.rows += work.rows - before.rows;
              measured.jobs += a.total;
              const rows = [...actual];
              const selected = [...expected.values()].filter(
                (j) => j.state._tag !== "absent" && j.state.request.process === process,
              );
              const ids = (jobs: ReadonlyArray<Job>) =>
                jobs.map((j) => (j.state._tag === "absent" ? "" : j.state.request.id)).sort();
              expect(ids(rows)).toEqual(ids(selected));
              expect(new Set(ids(rows)).size).toBe(rows.length);

              for (const job of rows) {
                expect(job).toEqual(expected.get(job.state._tag === "absent" ? "" : job.state.request.id));
              }
            }
          }
        });
        const result = yield* Arbitrary.checkEffect(
          Arbitrary.schema(tape),
          (a) =>
            Effect.scoped(check(a)).pipe(
              Effect.as(true),
              Effect.catchCause((cause) => Effect.fail(cause)),
            ),
          { seed: 119120, runs: 60, concurrency: 1 },
        );
        expect(result._tag, Arbitrary.formatCheckFailure(result)).toBe("Passed");
        expect(done).toEqual(new Set(["reopen", "taken"]));
        yield* Effect.logInfo("P39 process discovery work", measured);
      }),
    120_000,
  );
  it.effect.prop(
    "A13: Jobs discovery keeps its own error and the lower cause",
    { cause: Schema.String },
    ({ cause }) =>
      Effect.gen(function* () {
        const store = yield* open;
        const lower = new LedgerStreamsError({ reason: new Storage({ cause }) });
        const dependencies = Layer.mergeAll(
          Layer.succeed(LedgerStreams, { list: () => Stream.fail(lower) }),
          LedgerSql.layer(store.sql, { reader: "jobs-discovery-error" }).pipe(Layer.provide(quiet)),
          LedgerTransactionSql.layer(store.sql).pipe(Layer.provide(quiet)),
          Id.Generator.layer,
        );
        const result = yield* Jobs.use((jobs) =>
          Stream.runCollect(jobs.forProcess("process_01m6v5270hetdrt4r8h9vvjwjs")),
        ).pipe(Effect.provide(JobsLedger.layer.pipe(Layer.provide(dependencies))), Effect.result);
        expect(R.isFailure(result)).toBe(true);

        if (R.isFailure(result)) {
          expect(result.failure).toBeInstanceOf(JobsError);
          expect(result.failure.cause).toBe(lower);
        }
      }).pipe(Effect.scoped),
    { arbitrary: { seed: 119120, runs: 100 } },
  );
};
