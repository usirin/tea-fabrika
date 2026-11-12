// P42 slice 1, next/ (ticket 770): the built-in `start_child` and `exit` Cmds on real runners, laws
// L5 to L8, L11 and L13, and no driver. A runner in the module that owns a driver calls
// `StartChildTest.suite(open)`; `open` acquires real stores in a scope and gives them back when that
// scope closes (0061, 0062).
//
// The runner, ledger, process table, mailbox, program mail, start piece and test program are real.
// The contract these laws pin, from the approved plan's Files table:
//   StartChild.ts: `StartChildInput` ({program, name, input?}), `startChild`, `Cmd.make("start_child",
//     ...)` whose `ok` is `Started`, and `exit`, `Cmd.make("exit", ...)` with an empty strict input.
//   Runner.ts: a runner whose context holds `Children` performs both itself. `start_child` decodes
//     strictly (`bad_cmd`), resolves the program through its loader (`no_program`), then calls
//     `Children.start` with the Cmd's id and the running life as requester. `exit` writes `exited
//     {reason: normal}` for this life after the Cmds listed before it; none after it runs.
// The oracle is the walk's own model and the store's raw rows read with SQL, never the product's fold.
import { describe, expect, it } from "@effect/vitest";
import {
  Clock,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Option,
  Predicate,
  Result,
  Schema,
  Scope,
  Stream,
  Tracer,
} from "effect";
import * as fc from "fast-check";
import { InputId, Writer } from "../coordination/index.ts";
import { Ledger } from "../ledger/Ledger.ts";
import type { Entry } from "../ledger/Log.ts";
import { Children, Started } from "../processes/Children.ts";
import * as ChildrenLedger from "../processes/ChildrenLedger.ts";
import { type From, Mailbox } from "../processes/Mailbox.ts";
import { data as ledger, ids, NORMAL, PIDS } from "../processes/Process.test-support.ts";
import { Owner, Recipient, Start } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import { type Grants, ProgramMail } from "../processes/ProgramMail.ts";
import * as ProgramMailLedger from "../processes/ProgramMailLedger.ts";
import type { Sql } from "../Sql.ts";
import { Alarm, CheckedWriter, type Incoming, ProgramLoader, Recording, WatcherManager } from "./Entry.ts";
import { childStarter, Model } from "./internal/childStarter.test-support.ts";
import { ProcessStore } from "./ProcessStore.ts";
import { ProgramRunner } from "./Runner.ts";

/** Real stores. `sql(part)` is one database per part; `probe.open` counts the handles still open. */
export type Store = {
  readonly sql: (part: string) => Sql;
  readonly reopen: Effect.Effect<void>;
  readonly probe: { readonly open: () => number };
};

const SEED = 119120;
const BUILD = "p42-build-a";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
/** The brain's own session: a process ID no start in a walk reaches. */
const DOOR = PIDS.at(-1) ?? "";
/** The ledger's row limit (`ledger/Log.ts`). */
const ROW_LIMIT = 2_000_000;

const PROGRAMS: Record<string, unknown> = {
  starter: childStarter({ name: "starter", declare: true }),
  merger: childStarter({ name: "merger", declare: true }),
  plain: childStarter({ name: "plain", declare: false }),
};

/** Start grants, by program. `plain` is granted, but never declared the Cmds. */
const STARTS = [
  { source: "starter", to: "merger" },
  { source: "merger", to: "merger" },
  { source: "plain", to: "merger" },
];

/** The host's mail grant: `sender:1` mails both starters, so their steps run on another process's letter. */
const HOST: Grants = { "sender:1": ["starter:1", "starter:2"] };

/** Names the boot registers: two starters, one program that never declared the Cmds, and a sender. */
const BOOT: ReadonlyArray<readonly [string, string]> = [
  ["starter:1", "starter"],
  ["starter:2", "starter"],
  ["plain:1", "plain"],
  ["sender:1", "sender"],
];

/** Programs a runner steps here; `sender` is only a registered name that mails. */
const RUNS = new Set(["starter", "merger", "plain"]);

const person = Writer.cases.person.make({ key: "SHA256:person", for: PERSON });
const owner = Writer.cases.agent.make({ key: "SHA256:owner", for: PERSON });

const inputId = (n: number) =>
  Schema.decodeUnknownSync(InputId)(`input_0000000000e008${n.toString(16).padStart(12, "0")}`);

const brainFrom = (): From => ({
  by: "SHA256:brain",
  for: "brain",
  sentAt: "2026-11-11T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE,
  build: BUILD,
});

const decodeModel = Schema.decodeUnknownOption(Model);

/** Every entry of the process table, each name's events and each name's inbox, through the ledger's
 *  own read: the oracle never asks the product's fold. */
const entries = (names: Iterable<string>) =>
  Effect.map(
    Effect.forEach(
      ["processes", ...[...new Set(names)].flatMap((name) => [`processes/${name}`, `${name}/inbox`])],
      (stream) => Ledger.use((ledger) => Stream.runCollect(ledger.read(stream, 0))),
      { concurrency: 1 },
    ),
    (all) => all.flatMap((part) => [...part]).sort((a, b) => a.rev - b.rev),
  );

/** A value's case, read without naming the key in a literal. */
const tagged = (value: unknown): unknown => (Predicate.hasProperty(value, "_tag") ? value._tag : undefined);

/** A raw value under `tag`, never made by a schema, so it can hold a shape its schema refuses. */
const raw = (tag: string, fields: object = {}): unknown =>
  // oxlint-disable-next-line fabrika/no-hand-tag -- invalid on purpose: no schema maker writes a shape its schema refuses
  ({ ...fields, _tag: tag });

const body = (entry: Entry | undefined): Record<string, unknown> =>
  typeof entry?.body === "object" && entry.body !== null && !Array.isArray(entry.body)
    ? (entry.body as Record<string, unknown>)
    : {};

const choose = <A>(items: ReadonlyArray<A>, pick: number): A => {
  const item = items[pick % items.length];

  if (item === undefined) {
    throw new Error("a move chose from an empty list");
  }

  return item;
};

/** The ledger's Sql with one cut: the next INSERT of an `exited` line throws once. */
const faulting = (sql: Sql, fault: { exited: boolean; message: string }) => {
  const wrapped: Sql = {
    exec: (query, ...params) => {
      if (
        fault.exited &&
        /^\s*INSERT\b/i.test(query) &&
        params.some((p) => p === "exited" || (typeof p === "string" && p.includes('"exited"')))
      ) {
        fault.exited = false;
        throw new Error(fault.message);
      }

      return sql.exec(query, ...params);
    },
    transaction: (step) => sql.transaction(step),
    size: () => sql.size(),
  };
  return wrapped;
};

type Ask = {
  readonly program: unknown;
  readonly name: unknown;
  readonly input?: unknown;
  readonly extra?: Record<string, unknown>;
  readonly drop?: ReadonlyArray<string>;
};

type Name = { readonly program: string; pid: string; live: boolean };

/** What the walk knows, from its own moves only, except what a cut made unknown. */
type World = {
  readonly names: Map<string, Name>;
  /** Each start a `start_child` wrote: its Cmd id, the name, program, requester and first input. */
  readonly starts: Map<
    string,
    {
      readonly name: string;
      readonly program: string;
      readonly requester: string;
      readonly input?: unknown;
      readonly rev: number;
      readonly process: string;
    }
  >;
  /** Each child's first requester's name. */
  readonly parents: Map<string, string>;
  /** Live watches: who watches whom, under which ref. */
  readonly watches: Array<{ readonly watcher: string; readonly target: string; readonly ref: string }>;
  readonly fault: { exited: boolean; message: string };
  n: number;
};

/**
 * One life of the whole host in `scope`: the shared ledger, process table, program mail and start
 * piece, and one runner per process that a runner steps, built when first asked for.
 */
const host = Effect.fnUntraced(function* (store: Store, world: World, next: Effect.Effect<string>, scope: Scope.Scope) {
  const data = ledger(faulting(store.sql("ledger"), world.fault));
  const manager = ProcessManager.layer(
    {
      by: "SHA256:brain",
      owner: Owner.cases.brain.make({}),
      recipient: Recipient.cases.client.make({ client: "brain", session: DOOR }),
    },
    next,
  );
  const shared = Layer.mergeAll(
    ChildrenLedger.layer({ grants: STARTS }),
    ProgramMailLedger.layer({ grants: HOST }),
  ).pipe(Layer.provideMerge(manager), Layer.provideMerge(Mailbox.layer), Layer.provideMerge(data));
  const context = yield* Layer.buildWithScope(shared, scope);
  const runners = new Map<string, ProgramRunner["Service"]>();
  const runner = Effect.fnUntraced(function* (name: string) {
    const held = world.names.get(name);

    if (held === undefined || !RUNS.has(held.program)) {
      return yield* Effect.die(new Error(`no runner steps ${name}`));
    }

    const known = runners.get(held.pid);

    if (known !== undefined) {
      return known;
    }

    const checked = Layer.effect(
      CheckedWriter,
      Effect.gen(function* () {
        const mailbox = yield* Mailbox;
        return {
          append: (i: Incoming) =>
            mailbox.send(name, i.id, i.envelope.input, {
              by: i.envelope.by.key,
              for: i.envelope.by.for,
              sentAt: i.sentAt,
              seen: i.seen,
              parent: i.envelope.id,
              traceId: i.span.traceId,
              build: BUILD,
            }),
          commit: () => Effect.die("no write declared"),
          own: () => Effect.die("no write declared"),
        };
      }),
    );
    const own = Layer.mergeAll(
      ProgramLoader.layer(PROGRAMS, {}),
      ProcessStore.layer(store.sql(`process-${name}`), { process: held.pid }),
      Layer.succeed(Alarm, { set: () => Effect.void }),
      Layer.succeed(WatcherManager, { publish: () => Effect.void }),
      Layer.succeed(Recording, { flush: Effect.void }),
      checked,
    ).pipe(Layer.provideMerge(Layer.succeedContext(context)));
    const built = yield* Layer.buildWithScope(
      ProgramRunner.layer(
        { id: held.pid, name, program: held.program, build: BUILD, owner },
        { recovery: { sql: store.sql(`recovery-${name}`), name, capacity: 1024 ** 3 } },
      ).pipe(Layer.provide(own)),
      scope,
    );
    const made = Context.get(built, ProgramRunner);
    runners.set(held.pid, made);
    return made;
  });
  return { context, runner };
});

/** A process's saved model, read from its checkpoint without asking the runner. */
const savedModel = Effect.fnUntraced(function* (store: Store, name: string, pid: string) {
  const saved = yield* ProcessStore.use((s) => s.load).pipe(
    Effect.provide(ProcessStore.layer(store.sql(`process-${name}`), { process: pid })),
  );
  return Option.getOrUndefined(decodeModel(saved?.saved.model ?? null));
});

const Cell = fc.record({
  move: fc.nat(),
  pick: fc.nat(),
  alt: fc.nat(),
  shape: fc.nat(),
  m: fc.jsonValue({ maxDepth: 2 }),
  extra: fc.subarray(["requester", "owner", "process", "hash", "reason", "source"], { minLength: 1 }),
});
type Cell = typeof Cell extends fc.Arbitrary<infer A> ? A : never;
const Tape = fc.array(Cell, { minLength: 6, maxLength: 20, size: "max" });

type Move =
  | "door_start"
  | "mail_start"
  | "forged"
  | "bad"
  | "undeclared"
  | "exit"
  | "exit_extra"
  | "after_exit"
  | "watch"
  | "start_ended"
  | "retry_saved"
  | "cut_exit";

/** A forged operand for each extra field a program might add beside its Cmd. */
const forged = (field: string, world: World): unknown => {
  const sender = world.names.get("sender:1")?.pid ?? DOOR;
  return field === "requester"
    ? Recipient.cases.process.make({ process: sender })
    : field === "owner"
      ? Owner.cases.brain.make({})
      : field === "process" || field === "source"
        ? sender
        : field === "hash"
          ? "forged-hash"
          : "kill";
};

/**
 * Folds one tape through real runners. Each cell reads the world the fold has reached and picks a
 * move possible there; the oracle checks every prefix against the store's raw rows.
 */
const walk = (
  open: Effect.Effect<Store, never, Scope.Scope>,
  moves: ReadonlyArray<Move>,
  done: Set<Move>,
  seen: Set<string>,
) =>
  Effect.fnUntraced(function* (tape: ReadonlyArray<Cell>) {
    const store = yield* open;
    const next = ids(...PIDS);
    const world: World = {
      names: new Map(),
      starts: new Map(),
      parents: new Map(),
      watches: [],
      fault: { exited: false, message: "SQLITE_FULL planted at the exit" },
      n: 0,
    };
    const scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const life = yield* host(store, world, next.next, scope);
    const inContext = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.provide(life.context as Context.Context<never>)) as Effect.Effect<A, E, never>;
    const all = (extra: Iterable<string> = []) => inContext(entries([...world.names.keys(), ...extra]));
    const letter = (input: unknown): Incoming => {
      const n = ++world.n;
      return {
        id: `letter-${n}`,
        envelope: { id: inputId(n), by: person, arrivedAt: 1794099600000 + n, input },
        sentAt: "2026-11-11T01:00:00Z",
        seen: 0,
        span: { traceId: TRACE, spanId: "00f067aa0ba902b7" },
      };
    };
    /** A runner call that may refuse: it must answer, never hang. */
    const call = <A, E>(effect: Effect.Effect<A, E>, label: string) =>
      effect.pipe(
        Effect.result,
        Effect.timeoutOption("20 seconds"),
        Effect.map((answer) => {
          expect(Option.isSome(answer), `${label} answers`).toBe(true);
          return answer;
        }),
      );
    const door = Effect.fnUntraced(function* (name: string, input: unknown) {
      const runner = yield* life.runner(name);
      yield* call(runner.msg(letter(input)), `${name}'s letter`);
    });
    const answers = Effect.fnUntraced(function* (name: string) {
      const held = world.names.get(name) as Name;
      return (yield* inContext(savedModel(store, name, held.pid)))?.answers ?? [];
    });
    /** The last answer the program was told, once its own answer letter was folded. */
    const lastAnswer = Effect.fnUntraced(function* (name: string, before: number) {
      const told = yield* answers(name);
      expect(told.length, `${name} was told one answer`).toBe(before + 1);
      return told.at(-1) as { type: string; outcome: unknown };
    });

    /** Adds every start the store holds that the world has not seen; each must be one it asked for. */
    const sync = Effect.fnUntraced(function* (
      asked: ReadonlyArray<{ readonly name: string; readonly requester: string; readonly input?: unknown }>,
    ) {
      const rows = yield* all(asked.map((a) => a.name));

      for (const row of rows) {
        if (row._tag !== "started" || !row.stream.startsWith("processes/") || world.starts.has(row.id)) {
          continue;
        }

        const b = body(row);
        const requester = (b["requester"] as { process?: string } | undefined)?.process;

        if (requester === undefined) {
          continue;
        }

        const name = String(b["name"]);
        const ask = asked.find((a) => a.name === name);
        expect(ask, `L5: ${name} was started only by a Cmd the walk dispatched`).toBeDefined();
        expect(requester, "L5: the requester is the life that ran the step").toBe(ask?.requester);
        expect(row.id.startsWith(`${ask?.requester}/`), "L5: the start's id is the dispatched Cmd's id").toBe(true);
        expect(b["hash"], "L5: the hash is the loader's, never the program's").not.toBe("forged-hash");
        const registered = rows.find(
          (e) => e.stream === "processes" && e._tag === "registered" && body(e)["name"] === name,
        );
        expect(body(registered)["owner"], "L5: the brain owns a started child").toEqual(Owner.cases.brain.make({}));
        world.starts.set(row.id, {
          name,
          program: String(b["program"]),
          requester,
          ...(ask?.input === undefined ? {} : { input: ask.input }),
          rev: row.rev,
          process: String(b["process"]),
        });
        world.names.set(name, { program: String(b["program"]), pid: String(b["process"]), live: true });
        const parent = [...world.names].find(([, h]) => h.pid === requester)?.[0];

        if (parent !== undefined) {
          world.parents.set(name, parent);
        }
      }
    });
    const registered = (name: string) =>
      Effect.map(all(), (rows) =>
        rows.some((e) => e.stream === "processes" && e._tag === "registered" && body(e)["name"] === name),
      );
    const exitedRows = (pid: string) =>
      Effect.map(all(), (rows) => rows.filter((e) => e._tag === "exited" && body(e)["process"] === pid));
    // Built on each read: `all()` lists the streams of the names known at the time it is called.
    const head = Effect.suspend(() => Effect.map(all(), (rows) => Math.max(0, ...rows.map((e) => e.rev))));
    const fresh = (prefix = "merger") => `${prefix}:${1000 + ++world.n}`;
    const runnable = () =>
      [...world.names].filter(([, h]) => h.live && RUNS.has(h.program) && h.program !== "plain").map(([n]) => n);
    const starters = () => runnable();
    const ended = () => [...world.names].filter(([n, h]) => !h.live && world.parents.has(n)).map(([n]) => n);

    for (const [name, program] of BOOT) {
      const started = yield* inContext(
        ProcessManager.use((p) =>
          p.start(Start.cases.first.make({ id: `boot:${name}`, name, code: { program, hash: BUILD } }), brainFrom()),
        ),
      ).pipe(Effect.orDie);
      world.names.set(name, { program, pid: started.process, live: true });
    }

    for (const cell of tape) {
      const can: Record<Move, boolean> = {
        door_start: starters().length > 0 && next.calls() < PIDS.length - 6,
        mail_start:
          ["starter:1", "starter:2"].some((n) => world.names.get(n)?.live === true) && next.calls() < PIDS.length - 6,
        forged: starters().length > 0,
        bad: starters().length > 0,
        undeclared: world.names.get("plain:1")?.live === true,
        exit: runnable().length > 0 && next.calls() < PIDS.length - 6,
        exit_extra: runnable().length > 0,
        after_exit: [...world.names].some(([, h]) => !h.live && RUNS.has(h.program)),
        watch: runnable().length > 0,
        start_ended: starters().length > 0 && ended().length > 0,
        retry_saved: world.starts.size > 0,
        cut_exit: runnable().length > 0 && next.calls() < PIDS.length - 6,
      };
      const options = moves.filter((move) => can[move]);

      if (options.length === 0) {
        continue;
      }

      const move = choose(options, cell.move);

      switch (move) {
        case "door_start":
        case "mail_start": {
          const name =
            move === "mail_start"
              ? choose(
                  ["starter:1", "starter:2"].filter((n) => world.names.get(n)?.live === true),
                  cell.pick,
                )
              : choose(starters(), cell.pick);
          const held = world.names.get(name) as Name;
          const existing = [...world.names].filter(([n, h]) => h.program === "merger" && n !== name);
          const target = cell.alt % 3 === 0 && existing.length > 0 ? choose(existing, cell.alt)[0] : fresh();
          const was = world.names.get(target);
          const ask: Ask = {
            program: "merger",
            name: target,
            ...(cell.shape % 2 === 0 ? {} : { input: { type: "ping" } }),
          };
          const before = (yield* answers(name)).length;

          if (move === "door_start") {
            yield* door(name, { type: "start", ask });
          } else {
            // Another live process's letter: the requester must still be the life that steps it.
            const sender = world.names.get("sender:1") as Name;
            const sent = yield* inContext(
              ProgramMail.use((mail) =>
                mail.deliver({
                  command: `${sender.pid}/${++world.n}/0`,
                  source: { name: "sender:1", process: sender.pid },
                  to: name,
                  m: { type: "start", ask },
                  from: { ...brainFrom(), by: "SHA256:sender", for: PERSON },
                }),
              ),
            ).pipe(Effect.result);
            expect(Result.isSuccess(sent), "the sender's letter is delivered").toBe(true);
            const runner = yield* life.runner(name);
            yield* call(runner.due(yield* Clock.currentTimeMillis), `${name}'s drain`);
          }

          yield* sync([
            { name: target, requester: held.pid, ...(ask.input === undefined ? {} : { input: ask.input }) },
          ]);
          const told = yield* lastAnswer(name, before);

          if (was === undefined) {
            expect(told, `L5: a fresh start answers started`).toMatchObject({
              type: "start_child_ok",
              outcome: { name: target },
            });
            expect(tagged(told.outcome), "L5: a fresh start answers started").toBe("started");
            expect(
              world.starts.size > 0 && [...world.starts.values()].some((s) => s.name === target),
              "the child is recorded",
            ).toBe(true);
            seen.add(move === "mail_start" ? "mailed_start" : "started");
          } else {
            expect(told, "an existing name is an answer, and writes nothing").toMatchObject({
              type: "start_child_ok",
              outcome: Started.cases[was.live ? "already_started" : "already_present"].make({
                process: was.pid,
                name: target,
              }),
            });
            seen.add(was.live ? "already_started" : "already_present");
          }

          break;
        }
        case "forged": {
          const name = choose(starters(), cell.pick);
          const target = fresh();
          const extra = Object.fromEntries(cell.extra.map((field) => [field, forged(field, world)]));
          const before = (yield* answers(name)).length;
          yield* door(name, { type: "start", ask: { program: "merger", name: target, extra } });
          expect(yield* lastAnswer(name, before), "L5, L8: a Cmd with fields beyond its operands").toEqual({
            type: "start_child_err",
            outcome: "bad_cmd",
          });
          expect(yield* registered(target), "L5: a forged Cmd writes nothing").toBe(false);
          seen.add("forged");
          break;
        }
        case "bad": {
          const name = choose(starters(), cell.pick);
          const target = fresh();
          const kind = cell.shape % 8;
          const bad: { ask: Ask; reason: string; tag: string } =
            kind === 0
              ? { ask: { program: "merger", name: target, drop: ["program"] }, reason: "bad_cmd", tag: "missing" }
              : kind === 1
                ? { ask: { program: "merger", name: target, drop: ["name"] }, reason: "bad_cmd", tag: "missing" }
                : kind === 2
                  ? { ask: { program: 5, name: target }, reason: "bad_cmd", tag: "typed" }
                  : kind === 3
                    ? { ask: { program: "merger", name: ["x"] }, reason: "bad_cmd", tag: "typed" }
                    : kind === 4
                      ? {
                          ask: { program: `nope${cell.alt % 9}`, name: target },
                          reason: "no_program",
                          tag: "no_program",
                        }
                      : kind === 5
                        ? // The loader answers before the name is judged.
                          { ask: { program: "nope", name: "Bad Name" }, reason: "no_program", tag: "no_program" }
                        : kind === 6
                          ? {
                              ask: {
                                program: "merger",
                                name: choose(
                                  ["", "processes", "Merger:1", "merger/1", "client:x", "m".repeat(257)],
                                  cell.alt,
                                ),
                              },
                              reason: "bad_name",
                              tag: "bad_name",
                            }
                          : {
                              ask: { program: "merger", name: target, inputBytes: ROW_LIMIT + 1 },
                              reason: "bad_input",
                              tag: "bad_input",
                            };
          const before = (yield* answers(name)).length;
          const revBefore = yield* head;
          yield* door(name, { type: "start", ask: bad.ask });
          expect(yield* lastAnswer(name, before), `L6: ${bad.tag}`).toEqual({
            type: "start_child_err",
            outcome: bad.reason,
          });
          expect(
            (yield* all())
              .filter((e) => e.rev > revBefore)
              .filter((e) => e.stream.startsWith("processes") || e.id.startsWith('["start",')),
            `L6: ${bad.tag} writes nothing`,
          ).toEqual([]);
          seen.add(bad.tag);
          break;
        }
        case "undeclared": {
          const target = fresh();
          yield* door("plain:1", { type: "start", ask: { program: "merger", name: target } });
          expect(yield* registered(target), "L6, L8: a Cmd the program never declared writes nothing").toBe(false);
          seen.add("undeclared");
          break;
        }
        case "exit":
        case "cut_exit": {
          const name = choose(runnable(), cell.pick);
          const held = world.names.get(name) as Name;
          const before = Array.from({ length: cell.alt % 3 }, () => ({ program: "merger", name: fresh() }));
          const after = Array.from({ length: cell.shape % 3 }, () => ({ program: "merger", name: fresh() }));
          const twice = cell.shape % 2 === 0;
          const children = [...world.parents].filter(([, p]) => p === name).map(([c]) => c);

          if (move === "cut_exit") {
            world.fault.exited = true;
          }

          yield* door(name, { type: "end", before, after, twice });

          if (move === "cut_exit") {
            const hit = !world.fault.exited;
            world.fault.exited = false;
            const runner = yield* life.runner(name);

            // The cut exit is retried until it lands; it may never land twice.
            for (let round = 0; round < 4; round++) {
              const landed = (yield* exitedRows(held.pid)).length;
              expect(landed, "L7: a retried exit never writes twice").toBeLessThanOrEqual(1);

              if (landed > 0) {
                break;
              }

              yield* call(runner.due((yield* Clock.currentTimeMillis) + 1_000 * (round + 1)), `${name}'s retry`);
              yield* call(runner.msg(letter({ type: "ping" })), `${name}'s nudge`);
            }

            seen.add(hit ? "cut_exit" : "cut_missed");
          }

          yield* sync([...before, ...after].map((a) => ({ name: a.name, requester: held.pid })));
          const exits = yield* exitedRows(held.pid);
          expect(exits.length, `L7: ${name}'s exit writes one exited`).toBe(1);
          expect(body(exits[0])["reason"], "L7: exit ends its life with normal").toEqual(NORMAL);

          for (const a of before) {
            expect(yield* registered(a.name), "L7: a Cmd listed before exit is performed").toBe(true);
          }

          for (const a of after) {
            expect(yield* registered(a.name), "L7: a Cmd listed after exit is not performed").toBe(false);
          }

          held.live = false;
          const info = yield* inContext(ProcessManager.use((p) => p.info));
          expect(
            info.some((row) => row.process === held.pid),
            "L7: info drops an exited life",
          ).toBe(false);

          for (const child of children) {
            const status = yield* inContext(ProcessManager.use((p) => p.status(child)));
            const known = world.names.get(child) as Name;
            expect(status.state._tag, "L7: a requester's exit ends none of its children").toBe(
              known.live ? "live" : status.state._tag,
            );
          }

          for (const watch of world.watches.filter((w) => w.target === held.pid)) {
            const watcher = [...world.names].find(([, h]) => h.pid === watch.watcher)?.[0] as string;
            const downs = (yield* all()).filter(
              (e) =>
                e.stream === `${watcher}/inbox` &&
                JSON.stringify(body(e)["m"] ?? null).includes('"DOWN"') &&
                (body(e)["m"] as { ref?: string } | undefined)?.ref === watch.ref,
            );
            expect(downs.length, "L7: each live watch gets one DOWN").toBe(1);
            expect((body(downs[0])["m"] as { reason?: unknown }).reason, "L7: the DOWN says normal").toEqual(NORMAL);
            seen.add("down");
          }

          world.watches.splice(
            0,
            world.watches.length,
            ...world.watches.filter((w) => w.target !== held.pid && w.watcher !== held.pid),
          );
          const runner = yield* life.runner(name);
          yield* call(runner.due((yield* Clock.currentTimeMillis) + 60_000), `${name}'s alarm`);
          expect(
            (yield* all()).filter((e) => e._tag === "restarted" && body(e)["after"] === held.pid),
            "L7: nothing restarts a life that exited",
          ).toEqual([]);
          seen.add(before.length > 0 && after.length > 0 ? "exit_between_cmds" : "exit");

          if (children.length > 0) {
            seen.add("children_outlive");
          }

          break;
        }
        case "exit_extra": {
          const name = choose(runnable(), cell.pick);
          const held = world.names.get(name) as Name;
          const extra =
            cell.alt % 2 === 0
              ? { reason: choose(["kill", "shutdown", raw("crashed")], cell.shape) }
              : { [`x${cell.shape % 4}`]: cell.m };
          const before = (yield* answers(name)).length;
          yield* door(name, { type: "end", before: [], after: [], twice: false, extra });
          expect(yield* lastAnswer(name, before), "L8: exit's input takes no field").toEqual({
            type: "exit_err",
            outcome: "bad_cmd",
          });
          expect(yield* exitedRows(held.pid), "L8: a refused exit writes nothing").toEqual([]);
          seen.add("exit_extra");
          break;
        }
        case "after_exit": {
          const [name, held] = choose(
            [...world.names].filter(([, h]) => !h.live && RUNS.has(h.program)),
            cell.pick,
          );
          const stepped = (yield* inContext(savedModel(store, name, held.pid)))?.stepped;
          const runner = yield* life.runner(name);
          yield* call(runner.msg(letter({ type: "ping" })), `${name}'s late letter`);
          expect(
            (yield* inContext(savedModel(store, name, held.pid)))?.stepped,
            "L7: no letter is stepped after exit",
          ).toBe(stepped);
          seen.add("after_exit");
          break;
        }
        case "watch": {
          const target = choose(runnable(), cell.pick);
          const watchers = [...world.names].filter(([n, h]) => h.live && n !== target);

          if (watchers.length === 0) {
            break;
          }

          const [, watcher] = choose(watchers, cell.alt);
          const ref = `ref-${++world.n}`;
          const held = world.names.get(target) as Name;
          yield* ProcessManager.use((p) => p.monitor(ref, held.pid, brainFrom())).pipe(
            Effect.provide(
              ProcessManager.layer(
                {
                  by: "SHA256:brain",
                  owner: Owner.cases.process.make({ process: watcher.pid }),
                  recipient: Recipient.cases.process.make({ process: watcher.pid }),
                },
                next.next,
              ).pipe(Layer.provide(ledger(store.sql("ledger")))),
            ),
            Effect.orDie,
          );
          world.watches.push({ watcher: watcher.pid, target: held.pid, ref });
          break;
        }
        case "start_ended": {
          const name = choose(starters(), cell.pick);
          const target = choose(ended(), cell.alt);
          const was = world.names.get(target) as Name;
          const before = (yield* answers(name)).length;
          const revBefore = yield* head;
          yield* door(name, { type: "start", ask: { program: was.program, name: target } });
          expect(
            yield* lastAnswer(name, before),
            "L7: an unsaved id for an ended child answers already_present",
          ).toMatchObject({
            type: "start_child_ok",
            outcome: Started.cases.already_present.make({ process: was.pid, name: target }),
          });
          expect(
            (yield* all()).filter((e) => e.rev > revBefore).filter((e) => e.stream.startsWith("processes")),
            "already_present writes nothing",
          ).toEqual([]);
          seen.add("already_present");
          break;
        }
        case "retry_saved": {
          // A library caller asks a saved Cmd id again, after the child or the requester ended.
          const [id, saved] = choose([...world.starts], cell.pick);
          const answer = yield* inContext(
            Children.use((c) =>
              c.start(
                {
                  id,
                  name: saved.name,
                  code: { program: saved.program, hash: "another-build" },
                  requester: Recipient.cases.process.make({ process: saved.requester }),
                  ...(saved.input === undefined ? {} : { input: saved.input as Schema.Json }),
                },
                brainFrom(),
              ),
            ),
          ).pipe(Effect.result);
          expect(
            Result.isSuccess(answer) ? answer.success : answer.failure,
            "L7, L3: the saved id still answers started",
          ).toEqual(Started.cases.started.make({ process: saved.process, name: saved.name, rev: saved.rev }));
          seen.add("retried");
          break;
        }
      }

      done.add(move);
    }
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
        const seen = new Set<string>();
        const law = walk(open, moves, done, seen);
        // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each tape
        const property = fc.asyncProperty(Tape, (tape) => Effect.runPromise(Effect.scoped(law(tape))));
        // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
        yield* Effect.promise(() => fc.assert(property, { seed: SEED, numRuns, includeErrorInReport: true }));
        // An empty walk cannot pass: every move and every answer the law is about was reached.
        expect([...done].sort()).toEqual(expect.arrayContaining([...required].sort()));
        expect([...seen].sort()).toEqual(expect.arrayContaining([...answers].sort()));
      }),
    600_000,
  );

// --- L11: secrets stay out of Cmd answers, spans and logs ---------------------------------------

const capture = () => {
  const spans: Array<Tracer.NativeSpan> = [];
  const lines: Array<string> = [];
  const tracer = Tracer.make({
    span: (options) => {
      const span = new Tracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  // Each log line as Effect's own formatters write it, so an error's message renders as a sink would.
  const logger = Logger.make((options) => {
    lines.push(Logger.formatSimple.log(options), Logger.formatLogFmt.log(options), Logger.formatJson.log(options));
  });
  const exported = () =>
    spans.map((span) =>
      JSON.stringify({
        name: span.name,
        attributes: Object.fromEntries(span.attributes),
        events: span.events.map(([name, , attributes]) => ({ name, attributes })),
      }),
    );
  return { tracer, logger, lines, exported };
};

/** A secret-shaped sentinel: made up, never a real key. */
const Secret = fc.stringMatching(/^sk-[A-Za-z0-9]{24}$/);

const forms = (secret: string) => [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)];

const secrets = (open: Effect.Effect<Store, never, Scope.Scope>, seen: Set<string>) =>
  Effect.fnUntraced(function* (secret: string, kind: number) {
    const store = yield* open;
    const next = ids(...PIDS);
    const world: World = {
      names: new Map(),
      starts: new Map(),
      parents: new Map(),
      watches: [],
      fault: { exited: false, message: `SQLITE_FULL at ${secret}` },
      n: 0,
    };
    const scope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    const life = yield* host(store, world, next.next, scope);

    for (const [name, program] of BOOT) {
      const started = yield* ProcessManager.use((p) =>
        p.start(Start.cases.first.make({ id: `boot:${name}`, name, code: { program, hash: BUILD } }), brainFrom()),
      ).pipe(Effect.provide(life.context as Context.Context<ProcessManager>), Effect.orDie);
      world.names.set(name, { program, pid: started.process, live: true });
    }

    const seenBy = capture();
    const runner = yield* life.runner("starter:1");
    const mode = kind % 3;
    const input =
      mode === 0
        ? { type: "start", ask: { program: "merger", name: "merger:1", input: { type: "ping", token: secret } } }
        : mode === 1
          ? // A refused Cmd whose operands carry the secret: its err answer must not echo them.
            { type: "start", ask: { program: `nope-${secret}`, name: "merger:1" } }
          : { type: "end", before: [], after: [], twice: false };

    if (mode === 2) {
      world.fault.exited = true;
    }

    yield* runner
      .msg({
        id: "letter-1",
        envelope: { id: inputId(1), by: person, arrivedAt: 1794099600001, input },
        sentAt: "2026-11-11T01:00:00Z",
        seen: 0,
        span: { traceId: TRACE, spanId: "00f067aa0ba902b7" },
      })
      .pipe(Effect.withTracer(seenBy.tracer), Effect.provide(Logger.layer([seenBy.logger])), Effect.result);
    const cut = mode === 2 && !world.fault.exited;
    world.fault.exited = false;
    const pid = world.names.get("starter:1")?.pid as string;
    const answers =
      (yield* savedModel(store, "starter:1", pid).pipe(Effect.provide(life.context as Context.Context<never>)))
        ?.answers ?? [];
    const letters = (yield* entries(["starter:1"]).pipe(Effect.provide(life.context as Context.Context<never>)))
      .filter((e) => e.stream === "starter:1/inbox" && e.id.endsWith("/answer"))
      // tea's answer Msg echoes the program's own Cmd back to it as `cmd`; the answer is the rest.
      .map((e) => JSON.stringify({ ...body(e), m: { ...(body(e)["m"] as object), cmd: undefined } }));
    const outputs = [...seenBy.exported(), ...seenBy.lines, JSON.stringify(answers), ...letters];
    // Each case reached the path it is about: a started answer, a refusal, a storage cut at the exit.
    const told = answers.at(-1) as { type?: string; outcome?: unknown } | undefined;

    if (mode === 0) {
      expect(told?.type, "L11: the secret rode a start that answered").toBe("start_child_ok");
      expect(tagged(told?.outcome), "L11: the secret rode a start that answered").toBe("started");
    } else if (mode === 1) {
      expect(told, "L11: the secret rode a refused start").toEqual({ type: "start_child_err", outcome: "no_program" });
    } else {
      expect(cut, "L11: the exit's write met the planted storage failure").toBe(true);
    }

    seen.add(["answer", "refusal", "storage"][mode] as string);

    for (const output of outputs) {
      for (const form of forms(secret)) {
        expect(output.includes(form), `L11: a secret reached an output: ${output.slice(0, 200)}`).toBe(false);
      }
    }
  });

export const suite = (open: Effect.Effect<Store, never, Scope.Scope>) =>
  describe("P42 slice 1: start_child and exit on real runners", () => {
    prop(
      "L5: every start a start_child wrote keeps the life that ran the step as requester, never its letter's sender; extra fields are bad_cmd",
      open,
      ["door_start", "mail_start", "forged", "exit", "retry_saved"],
      ["door_start", "mail_start", "forged"],
      ["started", "mailed_start", "forged"],
      200,
    );
    prop(
      "L6: bad_cmd, then no_program, then bad_name, then bad_input, each writing nothing; an undeclared Cmd writes nothing",
      open,
      ["door_start", "bad", "undeclared"],
      ["bad", "undeclared"],
      ["missing", "typed", "no_program", "bad_name", "bad_input", "undeclared"],
      200,
    );
    prop(
      "L7: exit ends only its own life with normal, after the Cmds before it and none after; watchers get one DOWN; children outlive it",
      open,
      ["door_start", "exit", "cut_exit", "after_exit", "watch", "start_ended", "retry_saved"],
      ["door_start", "exit", "cut_exit", "after_exit", "watch", "start_ended", "retry_saved"],
      ["exit", "exit_between_cmds", "down", "children_outlive", "already_present", "after_exit", "retried", "cut_exit"],
      100,
    );
    prop(
      "L8: start_child and exit run only when declared, and both refuse extra fields as bad_cmd",
      open,
      ["forged", "exit_extra", "undeclared", "door_start"],
      ["forged", "exit_extra", "undeclared"],
      ["forged", "exit_extra", "undeclared"],
      100,
    );

    it.effect(
      "L11: a secret in a Cmd's operands or a storage cause stays out of Cmd answers, spans and logs",
      () =>
        Effect.gen(function* () {
          const seen = new Set<string>();
          const law = secrets(open, seen);
          // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check awaits each case
          const property = fc.asyncProperty(Secret, fc.nat(), (x, k) => Effect.runPromise(Effect.scoped(law(x, k))));
          // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check's async property answers a Promise
          yield* Effect.promise(() => fc.assert(property, { seed: SEED, numRuns: 100, includeErrorInReport: true }));
          expect([...seen].sort()).toEqual(["answer", "refusal", "storage"]);
        }),
      600_000,
    );

    // scenario: L13. Resource lifetime is one path, not a space to walk: one walk interrupted with
    // its runners built must still give back every database handle its scope opened.
    it.effect("scenario: L13: an interrupted walk gives back every store and runner its scope acquired", () =>
      Effect.gen(function* () {
        let probe: Store["probe"] | undefined;
        let opened = 0;
        const held = Effect.scoped(
          Effect.gen(function* () {
            const store = yield* open;
            const world: World = {
              names: new Map([["starter:1", { program: "starter", pid: PIDS[0] as string, live: true }]]),
              starts: new Map(),
              parents: new Map(),
              watches: [],
              fault: { exited: false, message: "" },
              n: 0,
            };
            const scope = yield* Scope.make();
            yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
            const life = yield* host(store, world, ids(...PIDS).next, scope);
            yield* ProcessManager.use((p) =>
              p.start(
                Start.cases.first.make({
                  id: "boot:starter:1",
                  name: "starter:1",
                  code: { program: "starter", hash: BUILD },
                }),
                brainFrom(),
              ),
            ).pipe(Effect.provide(life.context as Context.Context<ProcessManager>), Effect.orDie);
            const runner = yield* life.runner("starter:1");
            yield* runner
              .msg({
                id: "letter-1",
                envelope: { id: inputId(1), by: person, arrivedAt: 1794099600001, input: { type: "ping" } },
                sentAt: "2026-11-11T01:00:00Z",
                seen: 0,
                span: { traceId: TRACE, spanId: "00f067aa0ba902b7" },
              })
              .pipe(Effect.result);
            opened = store.probe.open();
            probe = store.probe;
            return yield* Effect.never;
          }),
        );
        const fiber = yield* Effect.forkChild(held);

        for (let turn = 0; turn < 1000 && probe === undefined; turn++) {
          yield* Effect.yieldNow;
        }

        yield* Fiber.interrupt(fiber);
        expect(probe, "the walk acquired its store and a runner").toBeDefined();
        expect(opened, "the walk had databases open when it was interrupted").toBeGreaterThan(0);
        expect(probe?.open(), "L13: no database handle outlives its scope").toBe(0);
      }),
    );
  });
