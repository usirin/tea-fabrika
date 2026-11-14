// P15 slice 1, next/. L1 to L6, L14 and L15 run through real runners. The node module
// supplies scoped SQLite stores and ledger wiring, so runtime never imports a driver or ledger.
import { Outcome } from "@demlik/tea";
import { Machine, Cmd } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import {
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Result,
  Schedule,
  Schema,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { expectTypeOf } from "vitest";
import { Appended, LedgerError, Mailbox, ProcessManager, ProcessStore, Writer } from "../coordination/index.ts";
import * as Id from "../Id.ts";
import { Start } from "../processes/Process.ts";
import type { Sql } from "../Sql.ts";
import { hash } from "./Built.ts";
import { Alarm, CheckedWriter, type Loaded, ProgramLoader, Recording, type Update, WatcherManager } from "./Entry.ts";
import { Supervision } from "./internal/supervisor.ts";
import { MailDelivery, MailDeliveryError } from "./MailDelivery.ts";
import type { RuntimeRecord } from "./ProcessStore.ts";
import { Program, ProgramDown, Write } from "./Program.ts";
import { recoveryStore } from "./RecoveryStore.ts";
import { ProgramRunner, type Swapped } from "./Runner.ts";
import { Queued, send } from "./Send.ts";

export type Store = { readonly sql: Sql; readonly reopen: Effect.Effect<void> };

export type Row = {
  readonly stream: string;
  readonly id: string;
  readonly event: string;
  readonly body: unknown;
  readonly build: string;
};

type StoreNeeds = ReturnType<typeof ProcessStore.layer> extends Layer.Layer<infer _A, infer _E, infer R> ? R : never;

export type Rig = {
  readonly open: Effect.Effect<Store, never, Scope.Scope>;
  readonly coordination: (
    ledger: Sql,
    manager: Sql,
    next: Effect.Effect<string>,
  ) => Layer.Layer<ProcessManager | Mailbox | StoreNeeds>;
  readonly rows: (sql: Sql) => ReadonlyArray<Row>;
};

const SEED = 119120;

/** fast-check's assertion rejected: a walk failed, and its counterexample is the cause. */
class PropertyFailure extends Schema.TaggedError<PropertyFailure>()("PropertyFailure", { cause: Schema.Defect() }) {}

const propertyFailure = (cause: unknown) => new PropertyFailure({ cause });
/** P40: the counter's qualified name; its registered names stay `counter:N`. */
const PROGRAM = "fabrika/counter";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const PERSON = Writer.cases.person.make({ key: "SHA256:person", for: "person" });

// --- Variants ---------------------------------------------------------------------------------

/** How a variant's schema reads a counter model. */
type Shape = "same" | "widened" | "narrowed" | "field";

/** One generated counter: its `inc` step, its schema, its `v` and its upgrade chain. */
type Spec = {
  readonly k: number;
  readonly shape: Shape;
  /** The narrowed schema's bounds; the other shapes ignore them. */
  readonly min: number;
  readonly max: number;
  readonly v: number;
  /** The upgrade `from` numbers this variant leaves out: a chain with a gap. */
  readonly gaps: ReadonlyArray<number>;
  /** Whether `inc` dispatches the variant's one Cmd, `ping`. */
  readonly cmd: boolean;
  readonly durable?: "write" | "send";
};

/** The real counter, as main builds it: `inc` adds one, `v` 1, no upgrades, no Cmd. */
const BASE: Spec = { k: 1, shape: "same", min: 0, max: 0, v: 1, gaps: [], cmd: false };

type CounterModel = { readonly count: number; readonly step?: number };

const schemaFor = (spec: Spec) =>
  spec.shape === "widened"
    ? Schema.Struct({ count: Schema.Number })
    : spec.shape === "narrowed"
      ? Schema.Struct({ count: Schema.Int.check(Schema.isBetween({ minimum: spec.min, maximum: spec.max })) })
      : spec.shape === "field"
        ? Schema.Struct({ count: Schema.Int, step: Schema.Int })
        : Schema.Struct({ count: Schema.Int });

/** A narrowed counter never leaves its bounds, so its own steps keep its model readable. */
const clamp = (spec: Spec, n: number) => (spec.shape === "narrowed" ? Math.min(spec.max, Math.max(spec.min, n)) : n);

/** The variant's update, as plain functions the oracle folds too. */
const updateFor = (spec: Spec, model: CounterModel, m: { readonly type: string }): CounterModel =>
  m.type === "inc"
    ? { ...model, count: clamp(spec, model.count + spec.k) }
    : m.type === "dec"
      ? { ...model, count: clamp(spec, model.count - spec.k) }
      : m.type === "reset"
        ? { ...model, count: clamp(spec, 0) }
        : m.type === "ping_ok" || m.type === "write_ok" || m.type === "send_ok"
          ? { ...model, count: clamp(spec, model.count + 10 * spec.k) }
          : model;

/** The chain: one upgrade per number below `v`, except the gaps. A field variant's upgrades add `step`. */
const upgradesFor = (spec: Spec) =>
  Array.from({ length: spec.v - 1 }, (_, i) => i + 1)
    .filter((from) => !spec.gaps.includes(from))
    .map((from) => ({
      name: `${spec.shape}_${from}`,
      from,
      run: (m: unknown): unknown =>
        spec.shape === "field" && typeof m === "object" && m !== null && !("step" in m) ? { ...m, step: 1 } : m,
    }));

const ping = Cmd.make("ping", { input: Schema.Struct({ n: Schema.Number }), ok: Schema.Number, err: [] });
const changed = Schema.TaggedStruct("changed", { count: Schema.Int });

const write = Cmd.make("write", {
  input: Schema.Struct({ stream: Schema.String, write: Write }),
  ok: Schema.Unknown,
  err: [],
});

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("inc") }),
  Schema.Struct({ type: Schema.Literal("dec") }),
  Schema.Struct({ type: Schema.Literal("reset") }),
]);

/** The variant as a program, made with `Program.make` as a program author writes one. */
const programFor = (spec: Spec) => {
  const model = schemaFor(spec);
  const machine = Machine.make({
    model: model as Schema.Codec<CounterModel>,
    msg: Msg,
    cmds: [ping, write, send],
    init: (loaded: CounterModel | null) => [
      loaded ?? (spec.shape === "field" ? { count: clamp(spec, 0), step: 1 } : { count: clamp(spec, 0) }),
      [],
    ],
    update: {
      inc: (s: CounterModel, m: typeof Msg.Type) => [
        updateFor(spec, s, m),
        spec.durable === "write"
          ? [write({ stream: "app/reload", write: Write.cases.own.make({ event: changed.make({ count: s.count }) }) })]
          : spec.durable === "send"
            ? [send({ to: "recipient:1", m: { type: "add", n: s.count } })]
            : spec.cmd
              ? [ping({ n: s.count })]
              : [],
      ],
      dec: (s: CounterModel, m: typeof Msg.Type) => [updateFor(spec, s, m), []],
      reset: (s: CounterModel, m: typeof Msg.Type) => [updateFor(spec, s, m), []],
      ping_ok: (s: CounterModel) => [updateFor(spec, s, { type: "ping_ok" }), []],
      ping_err: (s: CounterModel) => [s, []],
      write_ok: (s: CounterModel) => [updateFor(spec, s, { type: "write_ok" }), []],
      write_err: (s: CounterModel) => [s, []],
      send_ok: (s: CounterModel) => [updateFor(spec, s, { type: "send_ok" }), []],
      send_err: (s: CounterModel) => [s, []],
    },
  });
  return Program.make({
    name: PROGRAM,
    machine,
    state: { v: spec.v, upgrades: upgradesFor(spec) },
    view: (s: CounterModel) => ({ ...s }),
    refuse: () => null,
    inputs: { inc: "Add", dec: "Take away", reset: "Back to zero" },
    outputs: {},
    writes: { changed: { schema: changed, personOnly: false } },
    wake: () => null,
  });
};

/** A variant's hash: the SHA-256 of its spec, so one spec is one hash, as one bundle's bytes are. */
const hashFor = (spec: Spec) => hash(JSON.stringify(spec));

/** What the oracle says a variant does with a model saved at `v`. */
const fits = (spec: Spec, model: CounterModel, v: number): "fits" | "shape" | "newer" => {
  if (v > spec.v) {
    return "newer";
  }

  let m: unknown = model;

  for (let from = v; from < spec.v; from++) {
    const upgrade = upgradesFor(spec).find((u) => u.from === from);

    if (upgrade === undefined) {
      return "shape";
    }

    m = upgrade.run(m);
  }

  return Result.isSuccess(Schema.decodeUnknownResult(schemaFor(spec))(m)) ? "fits" : "shape";
};

/** The model a fitting swap keeps: climbed through the chain, then read by the new schema. */
const climb = (spec: Spec, model: CounterModel, v: number): CounterModel => {
  let m: unknown = model;

  for (let from = v; from < spec.v; from++) {
    // Only a variant that fits is climbed, so its chain has every step.
    m =
      upgradesFor(spec)
        .find((u) => u.from === from)
        ?.run(m) ?? m;
  }

  return Schema.encodeSync(schemaFor(spec))(Schema.decodeUnknownSync(schemaFor(spec))(m));
};

/** A variant that reads this model at this `v`, generated from them: the walk picks what fits now. */
const fcFitting = (model: CounterModel, v: number): fc.Arbitrary<Spec> =>
  fc
    .record({
      k: fc.integer({ min: 1, max: 5 }),
      shape: fc.constantFrom<Shape>("same", "widened", "narrowed", "field"),
      below: fc.integer({ min: 0, max: 20 }),
      above: fc.integer({ min: 0, max: 20 }),
      climb: fc.integer({ min: 0, max: 2 }),
    })
    .map(({ k, shape, below, above, climb }) => {
      // A field the model lacks needs an upgrade to add it, so its variant climbs at least one number.
      const up = shape === "field" && model.step === undefined ? Math.max(1, climb) : climb;
      return {
        k,
        shape,
        min: model.count - below,
        max: model.count + above,
        v: v + up,
        gaps: [],
        // Only L15's variants dispatch a Cmd: its answers are a letter the walk would have to fold.
        cmd: false,
      };
    });

/** A variant chosen against one model so that it does not read it: a bound it breaks, a missing
 *  field with no upgrade, a gap in the chain, or a `v` below the model's. */
const fcRefusing = (model: CounterModel, v: number): fc.Arbitrary<Spec> =>
  fc.oneof(
    fc
      .integer({ min: 1, max: 30 })
      .map((d) => ({ ...BASE, shape: "narrowed" as const, min: model.count + d, max: model.count + d + 10, v })),
    model.step === undefined
      ? fc.constant({ ...BASE, shape: "field" as const, v })
      : fc.constant({ ...BASE, shape: "narrowed" as const, min: model.count + 1, max: model.count + 1, v }),
    fc.integer({ min: 1, max: 2 }).map((up) => ({ ...BASE, v: v + up, gaps: [v] })),
    ...(v > 1 ? [fc.integer({ min: 1, max: v - 1 }).map((lower) => ({ ...BASE, v: lower }))] : []),
  );

// --- The loader -------------------------------------------------------------------------------

/** Everything the loader has been asked, so a law can count what ran on which code. */
type Calls = {
  /** Each `init` the runner called, with the hash of the code it ran on. */
  readonly inits: Array<string>;
  /** Each hash `load` was asked for. */
  readonly loads: Array<string>;
};

/** The variants this world knows, by hash, and a gate a law may hold a step or a Cmd open with. */
type Code = {
  readonly variants: Map<string, Spec>;
  readonly calls: Calls;
  /** While set, the next `step` waits for it; the law opens it. */
  stepGate: Deferred.Deferred<void> | null;
  /** Each `step` that waited, so a law knows a turn is held open. */
  held: Deferred.Deferred<void> | null;
  /** While set, the `ping` handler waits for it. */
  cmdGate: Deferred.Deferred<void> | null;
  cmdStarted: Deferred.Deferred<void> | null;
};

const makeCode = Effect.fnUntraced(function* (specs: ReadonlyArray<Spec>) {
  const code: Code = {
    variants: new Map(),
    calls: { inits: [], loads: [] },
    stepGate: null,
    held: null,
    cmdGate: null,
    cmdStarted: null,
  };

  for (const spec of specs) {
    yield* learn(code, spec);
  }

  return code;
});

/** Adds one variant and answers its hash. */
const learn = Effect.fnUntraced(function* (code: Code, spec: Spec) {
  const digest = yield* hashFor(spec);
  code.variants.set(digest, spec);
  return digest;
});

/** Serves a variant by the hash it is asked for, through the real in-process loader and Node
 *  execution. Only the gates and the counts are added around the box's calls. */
const loader = (code: Code) => ({
  load: (name: string, build?: string) =>
    Effect.gen(function* () {
      const spec = build === undefined ? undefined : code.variants.get(build);

      if (name !== PROGRAM || build === undefined || spec === undefined) {
        return yield* new ProgramDown({ reason: name === PROGRAM ? "load" : "no_program" });
      }

      code.calls.loads.push(build);
      const loaded: Loaded = yield* ProgramLoader.use((l) => l.load(name, build)).pipe(
        Effect.provide(
          ProgramLoader.layer(
            { [PROGRAM]: programFor(spec) },
            {
              ping: (cmd: unknown) =>
                Effect.gen(function* () {
                  if (code.cmdStarted !== null) {
                    yield* Deferred.succeed(code.cmdStarted, undefined);
                  }

                  if (code.cmdGate !== null) {
                    yield* Deferred.await(code.cmdGate);
                  }

                  const n = typeof cmd === "object" && cmd !== null && "n" in cmd ? Number(cmd.n) : 0;
                  return Outcome.ok(n);
                }),
            },
          ),
        ),
      );
      const { execution } = loaded;
      /** Holds a letter's step open while a law's gate is set, and says so on `held`. */
      const gated = Effect.gen(function* () {
        const gate = code.stepGate;

        if (gate !== null) {
          code.stepGate = null;

          if (code.held !== null) {
            yield* Deferred.succeed(code.held, undefined);
          }

          yield* Deferred.await(gate);
        }
      });
      return {
        stepper: loaded.stepper,
        declaration: loaded.declaration,
        handler: loaded.handler,
        execution: {
          ...execution,
          init: (saved: unknown) =>
            Effect.suspend(() => {
              code.calls.inits.push(build);
              return execution.init(saved);
            }),
          step: (model: unknown, m: unknown) => Effect.andThen(gated, execution.step(model, m)),
          // Main's runner steps an admitted letter through `update`, so the same gate holds it.
          update: (model: unknown, m: unknown) => Effect.andThen(gated, execution.update(model, m)),
        },
      };
    }),
});

// --- The world --------------------------------------------------------------------------------

/** One registered name: its process, the build its descriptor names, and its watchers' updates. */
type Name = {
  readonly name: string;
  readonly store: Store;
  pid: string;
  readonly build: string;
  /** Every update each client was sent, in order, across every session. */
  readonly updates: Map<string, Array<Update>>;
  session: Session | null;
};

/** One open runner, with the services a law reads back through. */
type Session = {
  readonly scope: Scope.Closeable;
  readonly runner: ProgramRunner["Service"];
  readonly alarms: Array<number | null>;
  readonly run: <A, E>(
    work: Effect.Effect<A, E, ProgramRunner | Mailbox | StoreNeeds | ProcessStore>,
  ) => Effect.Effect<A, E>;
  readonly sql: Sql;
};

type World = {
  readonly rig: Rig;
  readonly ledger: Store;
  readonly manager: Store;
  readonly scope: Scope.Scope;
  readonly code: Code;
  readonly names: Map<string, Name>;
  readonly cuts: { armed: string | null; readonly hits: Array<string> };
  letters: number;
  readonly durable: {
    blocked: boolean;
    readonly attempts: Array<string>;
    readonly completed: Set<string>;
  };
};

const brainFrom = (build: string) => ({
  by: "SHA256:brain",
  for: "brain",
  sentAt: "2026-11-11T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE,
  build,
});

const world = Effect.fnUntraced(function* (rig: Rig, specs: ReadonlyArray<Spec>) {
  const scope = yield* Scope.Scope;
  const ledger = yield* rig.open;
  const manager = yield* rig.open;
  const code = yield* makeCode(specs);
  return {
    rig,
    ledger,
    manager,
    scope,
    code,
    names: new Map<string, Name>(),
    letters: 0,
    cuts: { armed: null, hits: [] },
    durable: { blocked: false, attempts: [], completed: new Set<string>() },
  } satisfies World;
});

const nextProcess = Id.Generator.use((ids) => ids.next(Id.Process)).pipe(
  Effect.provide(Id.Generator.layer),
  Effect.orDie,
);

/** Opens a runner for `name`, starting it on `build` the first time, waking it after. */
const open = Effect.fnUntraced(function* (w: World, name: string, build: string) {
  const known = w.names.get(name);
  const entry: Name = known ?? {
    name,
    store: yield* w.rig.open.pipe(Scope.provide(w.scope)),
    pid: "",
    build,
    updates: new Map(),
    session: null,
  };
  w.names.set(name, entry);
  const scope = yield* Scope.fork(w.scope);
  const alarms: Array<number | null> = [];
  const sessionWork = Effect.gen(function* () {
    const storeSql = entry.store.sql;
    const manager = w.rig.coordination(w.ledger.sql, w.manager.sql, nextProcess);
    const managerContext = yield* Layer.build(manager);
    // The brain starts each name once, on the build its descriptor names; a wake finds it live.
    const status = yield* ProcessManager.use((m) =>
      m.status(name).pipe(
        Effect.catch(() =>
          m.start(
            Start.cases.first.make({ id: `boot:${name}`, name, code: { program: PROGRAM, hash: entry.build } }),
            brainFrom(entry.build),
          ),
        ),
        Effect.flatMap(() => m.status(name)),
      ),
    ).pipe(Effect.provide(managerContext), Effect.orDie);
    entry.pid = status.state.process;
    const checked = Layer.effect(
      CheckedWriter,
      Effect.gen(function* () {
        const mailbox = yield* Mailbox;
        return {
          append: Effect.fnUntraced(function* (i: {
            id: string;
            envelope: { input: unknown };
            sentAt: string;
            seen: number;
          }) {
            const cut = (at: string) =>
              Effect.suspend(() => {
                if (w.cuts.armed !== at) {
                  return Effect.void;
                }

                w.cuts.armed = null;
                w.cuts.hits.push(at);
                return Effect.fail(new LedgerError({ reason: "unreachable" }));
              });
            yield* cut("before_acceptance");
            const appended = yield* mailbox.send(name, i.id, i.envelope.input, {
              ...brainFrom(entry.build),
              by: PERSON.key,
              for: PERSON.for,
              sentAt: i.sentAt,
              seen: i.seen,
            });
            yield* cut("after_acceptance");
            return appended;
          }),
          commit: () => Effect.die("a counter variant has no write Cmd"),
          own: (id: string) =>
            Effect.gen(function* () {
              w.durable.attempts.push(id);

              if (w.durable.blocked) {
                return yield* new LedgerError({ reason: "unreachable" });
              }

              w.durable.completed.add(id);
              return Appended.cases.placed.make({ rev: 1, pos: 1 });
            }),
        };
      }),
    );
    const services = Layer.mergeAll(
      ProcessStore.layer(storeSql, { process: entry.pid }),
      checked,
      Layer.succeed(MailDelivery, {
        send: (mail) =>
          Effect.gen(function* () {
            w.durable.attempts.push(mail.command);

            if (w.durable.blocked) {
              return yield* new MailDeliveryError({ reason: "unavailable" });
            }

            w.durable.completed.add(mail.command);
            return Queued.make({ id: mail.command });
          }),
      }),
      Layer.succeed(WatcherManager, {
        publish: (client: string, update: Update) =>
          Effect.sync(() => {
            entry.updates.set(client, [...(entry.updates.get(client) ?? []), structuredClone(update)]);
          }),
      }),
      Layer.succeed(Alarm, { set: (at) => Effect.sync(() => void alarms.push(at)) }),
      Layer.succeed(Recording, { flush: Effect.void }),
    ).pipe(Layer.provideMerge(Layer.succeedContext(managerContext)));
    const layer = ProgramRunner.withLoader(
      { id: entry.pid, name, program: PROGRAM, build: entry.build, owner: PERSON },
      loader(w.code),
      {
        recovery: { sql: storeSql, name, capacity: 1024 ** 3 },
        fault: (cut) =>
          Effect.suspend(() => {
            if (w.cuts.armed !== cut) {
              return Effect.void;
            }

            w.cuts.armed = null;
            w.cuts.hits.push(cut);
            return Effect.fail(new LedgerError({ reason: "unreachable" }));
          }),
      },
    ).pipe(Layer.provideMerge(services));
    const context = yield* Layer.build(layer);
    const runner = Context.get(context, ProgramRunner);
    const session: Session = {
      scope,
      runner,
      alarms,
      run: (work) => Effect.provide(work, context),
      sql: storeSql,
    };
    return session;
  });
  const session = yield* sessionWork.pipe(Scope.provide(scope));
  entry.session = session;
  return session;
});

/** Evicts a name's object: its session's scope closes, its files stay. */
const evict = Effect.fnUntraced(function* (w: World, name: string) {
  const entry = w.names.get(name);

  if (entry?.session != null) {
    yield* Scope.close(entry.session.scope, Exit.void);
    entry.session = null;
    yield* entry.store.reopen;
  }
});

/** The name's open session, waking it on its descriptor's build when it was evicted. */
const session = Effect.fnUntraced(function* (w: World, name: string) {
  const entry = w.names.get(name);
  return entry?.session ?? (yield* open(w, name, entry?.build ?? (yield* hashFor(BASE))));
});

/** One press, as the door delivers it: a fresh letter id unless a law resends one. */
const press = (w: World, type: "inc" | "dec" | "reset", letter?: number) => {
  const n = letter ?? ++w.letters;
  return {
    n,
    input: {
      id: `press-${n}`,
      envelope: {
        id: `input_0000000000e00800000000${n.toString(16).padStart(4, "0")}`,
        by: PERSON,
        arrivedAt: n,
        input: { type },
      },
      sentAt: "writer clock",
      seen: 0,
      span: { traceId: TRACE, spanId: "00f067aa0ba902b7" },
    },
  };
};

// --- Reading back -----------------------------------------------------------------------------

/** One entry of a process's own stream, as the ledger holds it. */
type Fact = {
  readonly tag: string;
  readonly id: string;
  readonly body: Readonly<Record<string, unknown>>;
  readonly build: string;
};

/** The name's process stream, every life of it, and its inbox, read through the open session. */
const history = Effect.fnUntraced(function* (w: World, name: string) {
  const s = yield* session(w, name);
  const pid = w.names.get(name)?.pid ?? "";
  return yield* s.run(
    Effect.gen(function* () {
      const mailbox = yield* Mailbox;
      const facts = w.rig
        .rows(w.ledger.sql)
        .filter((e) => e.stream === pid)
        .map((e): Fact => ({
          tag: e.event,
          id: e.id,
          body: e.body as Readonly<Record<string, unknown>>,
          build: e.build,
        }));
      const inbox = yield* Stream.runCollect(mailbox.read(name, 0));
      const checkpoint = yield* ProcessStore.use((store) => store.load);
      return { facts, inbox, checkpoint };
    }),
  );
});

/** The name's saved supervision journal. */
const supervision = Effect.fnUntraced(function* (w: World, name: string) {
  const s = yield* session(w, name);
  return yield* recoveryStore(s.sql, { name, capacity: 1024 ** 3, schema: Supervision }).load;
});

/**
 * The history oracle: the model a process's own stream says it holds. Every `stepped` letter folds
 * on the code its entry names, every `code.swapped` climbs through the `state.upgraded` before it and
 * is read by the new code's schema, and a `code.refused` changes nothing. It answers the model, the
 * build the stream ends on, and every check it made on the way.
 */
const replay = (
  code: Code,
  start: string,
  facts: ReadonlyArray<Fact>,
  inbox: ReadonlyArray<{ readonly id: string; readonly m: unknown }>,
) => {
  let spec = code.variants.get(start) ?? BASE;
  let model: CounterModel = Schema.decodeUnknownSync(schemaFor(spec))(programFor(spec).machine.init(null, {})[0]);
  let v = spec.v;
  let build = start;
  let upgraded: { readonly ran: ReadonlyArray<string> } | null = null;
  const problems: Array<string> = [];

  for (const fact of facts) {
    const body = fact.body;

    if (fact.tag === "stepped") {
      if (body.build !== build) {
        problems.push(`${String(body.input)} stepped on ${String(body.build)} while the stream ran ${build}`);
      }

      const letter = inbox.find((l) => l.id === body.input);

      if (letter === undefined) {
        problems.push(`${String(body.input)} has no letter`);
        continue;
      }

      model = updateFor(code.variants.get(String(body.build)) ?? spec, model, letter.m as { type: string });
    } else if (fact.tag === "state.upgraded") {
      upgraded = { ran: (body.ran as ReadonlyArray<string>) ?? [] };
    } else if (fact.tag === "code.swapped") {
      const next = code.variants.get(String(body.hash));

      if (body.was !== build || next === undefined) {
        problems.push(`code.swapped from ${String(body.was)} while the stream ran ${build}`);
        continue;
      }

      const chain = upgradesFor(next).filter((u) => u.from >= v);

      if ((upgraded?.ran ?? []).join() !== chain.map((u) => u.name).join()) {
        problems.push(
          `code.swapped to ${String(body.hash)} ran ${String(upgraded?.ran)}, its chain is ${chain.map((u) => u.name)}`,
        );
      }

      model = climb(next, model, v);
      spec = next;
      v = next.v;
      build = String(body.hash);
      upgraded = null;
    }
  }

  return { model, build, v, problems };
};

/** Each fact of a tag, and how many of them answer each load. */
const byTag = (facts: ReadonlyArray<Fact>, tag: string) => facts.filter((f) => f.tag === tag);

const NAME = "counter:1";
// Each run opens real SQLite files and runners; 100 runs took about 10 to 40 s on a laptop.
const TIMEOUT = 300_000;

// The oracle's own answer shape, pinned to the public schema (0135).
const SwapAnswer = Schema.TaggedUnion({
  same: {},
  swapped: { was: Schema.String },
  refused: { was: Schema.String, reason: Schema.Literals(["shape", "newer", "load"]) },
  not_now: { state: Schema.String },
});

expectTypeOf<typeof SwapAnswer.Type>().toEqualTypeOf<Swapped>();

// L20 (type): a swap's answer is a closed union a caller must match whole.
expectTypeOf<Swapped["_tag"]>().toEqualTypeOf<"same" | "swapped" | "refused" | "not_now">();
expectTypeOf<(typeof Swapped.cases)["refused"]["Type"]["reason"]>().toEqualTypeOf<"shape" | "newer" | "load">();

// 0135: the swap request restated here is pinned to the runner's own parameter.
type SwapRequest = { readonly load: string; readonly program: string; readonly hash: string };
expectTypeOf<Parameters<Session["runner"]["swap"]>[0]>().toEqualTypeOf<SwapRequest>();

const swap = (s: Session, load: string, hash: string) => s.runner.swap({ load, program: PROGRAM, hash });

/** The walk's own account of one process: the code it runs, its model and `v`, and what it sent. */
type Account = {
  build: string;
  model: CounterModel;
  v: number;
  /** Every hash this process has run, oldest first. */
  ran: Array<string>;
  /** Accepted letters, in the order they were accepted. */
  accepted: Array<string>;
  swaps: number;
  loads: number;
};

const account = (build: string): Account => ({
  build,
  model: { count: 0 },
  v: 1,
  ran: [build],
  accepted: [],
  swaps: 0,
  loads: 0,
});

const pick = <A>(g: fc.GeneratorValue, items: ReadonlyArray<A>): A =>
  Option.getOrThrow(Option.fromNullishOr(items[g(fc.nat, { max: items.length - 1 })]));

/** One press on the process, folded into the walk's account by the code it runs now. */
const pressOnce = Effect.fnUntraced(function* (w: World, a: Account, g: fc.GeneratorValue, name = NAME) {
  const type = pick(g, ["inc", "inc", "dec", "reset"] as const);
  const { input } = press(w, type);
  const sent = yield* (yield* session(w, name)).runner.msg(input);
  expect(sent._tag, `press ${input.id}`).toBe("accepted");
  a.model = updateFor(Option.getOrThrow(Option.fromNullishOr(w.code.variants.get(a.build))), a.model, { type });
  a.accepted.push(input.id);
  return input;
});

/** A swap the walk expects to fit: the account climbs with it. */
const swapFitting = Effect.fnUntraced(function* (w: World, a: Account, spec: Spec, name = NAME) {
  const hash = yield* learn(w.code, spec);
  const load = `install_${++a.loads}`;
  const answer = yield* swap(yield* session(w, name), load, hash);

  if (hash === a.build) {
    expect(answer).toEqual(SwapAnswer.cases.same.make({}));
    return { hash, load, answer };
  }

  expect(answer, `swap to a fitting ${spec.shape} v${spec.v}`).toEqual(SwapAnswer.cases.swapped.make({ was: a.build }));
  a.model = climb(spec, a.model, a.v);
  a.v = spec.v;
  a.build = hash;
  a.ran.push(hash);
  a.swaps++;
  return { hash, load, answer };
});

/** The process's stream, read back and folded by the oracle; it must agree with the walk. */
const agrees = Effect.fnUntraced(function* (w: World, a: Account, start: string, name = NAME) {
  const { facts, inbox, checkpoint } = yield* history(w, name);
  const told = replay(w.code, start, facts, inbox);
  expect(told.problems).toEqual([]);
  expect(told.model, "the stream's fold").toEqual(a.model);
  expect(told.build).toBe(a.build);
  const view = (yield* (yield* session(w, name)).runner.open(`check-${w.letters}`)).view;
  expect(view, "the process's own view").toEqual(a.model);
  expect(checkpoint?.saved.build ?? start).toBe(a.build);

  if (checkpoint !== null) {
    expect(checkpoint.saved.model, "the saved model agrees with the stream and the live process").toEqual(a.model);
    expect(checkpoint.saved.v).toBe(a.v);
  }

  expect((yield* supervision(w, name))?.build, "the supervisor restarts on the running build").toBe(a.build);

  for (const fact of facts) {
    if (fact.tag === "code.swapped" || fact.tag === "state.upgraded") {
      expect(fact.build, "the fact belongs to the code that kept the model").toBe(
        fact.tag === "code.swapped" ? fact.body.hash : fact.body.build,
      );
    }
  }

  return { facts, inbox, checkpoint };
});

/** Runs one generated walk in a fresh world, every resource given back with its scope. */
const law = (body: (g: fc.GeneratorValue) => Effect.Effect<void, unknown, never>, runs = 100) =>
  Effect.gen(function* () {
    // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: fast-check requires a Promise callback
    const property = fc.asyncProperty(fc.gen(), (g) => Effect.runPromise(body(g)));
    // A walk of real runners is slow to shrink: report the first counterexample as found.
    const options = { seed: SEED, numRuns: runs, endOnFailure: true };
    // oxlint-disable-next-line fabrika/no-promises -- edge: fast-check runs an async property as a Promise
    yield* Effect.tryPromise({ try: () => fc.assert(property, options), catch: propertyFailure });
  });

const inWorld = <A, E>(rig: Rig, specs: ReadonlyArray<Spec>, body: (w: World) => Effect.Effect<A, E, never>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const w = yield* world(rig, specs);
      return yield* body(w);
    }),
  );

// Fact bodies are read back as JSON: these shapes are the plan's, pinned to the runtime record (0135).
type SwappedFact = { readonly program: string; readonly hash: string; readonly was: string };

type RefusedFact = {
  readonly program: string;
  readonly hash: string;
  readonly was: string;
  readonly reason: "shape" | "newer" | "load";
};

expectTypeOf<Omit<(typeof RuntimeRecord.cases)["code.swapped"]["Type"], "_tag">>().toEqualTypeOf<SwappedFact>();
expectTypeOf<Omit<(typeof RuntimeRecord.cases)["code.refused"]["Type"], "_tag">>().toEqualTypeOf<RefusedFact>();

/** Runs the reload laws over the driver module's real stores. */
export const suite = (rig: Rig): void => {
  describe("P15 slice 1: a saved program swaps into its running process", () => {
    // L1, p73. Plant: fold history with the newest code; keep the old Live after saving the new checkpoint.
    it.live(
      "L1: after presses and fitting swaps, the model is the fold of every letter on the code its stepped entry names; one code.swapped per swap",
      () =>
        Effect.gen(function* () {
          const seen = new Set<string>();
          yield* law((g) =>
            inWorld(rig, [BASE], (w) =>
              Effect.gen(function* () {
                const base = yield* hashFor(BASE);
                yield* open(w, NAME, base);
                const a = account(base);
                const steps = g(fc.integer, { min: 1, max: 12 });

                for (let n = 0; n < steps; n++) {
                  const back = a.ran.filter(
                    (h) =>
                      h !== a.build &&
                      fits(Option.getOrThrow(Option.fromNullishOr(w.code.variants.get(h))), a.model, a.v) === "fits",
                  );
                  const move = pick(g, ["press", "press", "swap", ...(back.length > 0 ? ["back"] : [])]);
                  seen.add(move);

                  if (move === "press") {
                    yield* pressOnce(w, a, g);
                  } else if (move === "swap") {
                    yield* swapFitting(
                      w,
                      a,
                      g(() => fcFitting(a.model, a.v)),
                    );
                  } else {
                    yield* swapFitting(
                      w,
                      a,
                      Option.getOrThrow(Option.fromNullishOr(w.code.variants.get(pick(g, back)))),
                    );
                  }

                  if (a.v > 1) {
                    seen.add("climbed");
                  }
                }

                const { facts } = yield* agrees(w, a, base);
                const swapped = byTag(facts, "code.swapped");
                expect(swapped, "one code.swapped per swap").toHaveLength(a.swaps);
                expect(new Set(swapped.map((f) => f.id)).size).toBe(a.swaps);

                for (const fact of swapped) {
                  expect(fact.id.startsWith("code.swapped:")).toBe(true);
                  expect(fact.body.program).toBe(PROGRAM);
                }
              }),
            ),
          );

          for (const move of ["press", "swap", "back", "climbed"]) {
            expect(seen.has(move), `the walk reaches ${move}`).toBe(true);
          }
        }),
      TIMEOUT,
    );

    // L2, p72. Plant: call `init` on a same-hash swap; publish a whole every time.
    it.live(
      "L2: a swap to the hash already running, or a repeated load, writes nothing, sends nothing, runs no init and changes no saved state",
      () =>
        Effect.gen(function* () {
          const seen = new Set<string>();
          yield* law((g) =>
            inWorld(rig, [BASE], (w) =>
              Effect.gen(function* () {
                const base = yield* hashFor(BASE);
                const s0 = yield* open(w, NAME, base);
                yield* s0.runner.open("watcher");
                const a = account(base);
                const loads: Array<string> = [];
                const steps = g(fc.integer, { min: 1, max: 10 });

                for (let n = 0; n < steps; n++) {
                  const move = pick(g, ["press", "swap", "same", "same", ...(loads.length > 0 ? ["repeat"] : [])]);

                  if (move === "press") {
                    yield* pressOnce(w, a, g);
                    continue;
                  }

                  if (move === "swap") {
                    const { load } = yield* swapFitting(
                      w,
                      a,
                      g(() => fcFitting(a.model, a.v)),
                    );
                    loads.push(load);
                    continue;
                  }

                  // The same hash again, under a new load id or one this walk already pushed.
                  const load = move === "same" ? `install_same_${n}` : pick(g, loads);
                  const before = yield* history(w, NAME);
                  const journal = yield* supervision(w, NAME);
                  const inits = w.code.calls.inits.length;
                  const updates = [...(w.names.get(NAME)?.updates.values() ?? [])].map((u) => u.length);
                  const answer = yield* swap(yield* session(w, NAME), load, a.build);
                  seen.add(move);
                  expect(answer).toEqual(SwapAnswer.cases.same.make({}));
                  const after = yield* history(w, NAME);
                  expect(after.facts, "no fact").toEqual(before.facts);
                  expect(after.checkpoint, "the checkpoint").toEqual(before.checkpoint);
                  expect(yield* supervision(w, NAME), "the supervisor").toEqual(journal);
                  expect(w.code.calls.inits.length, "no init").toBe(inits);
                  expect(
                    [...(w.names.get(NAME)?.updates.values() ?? [])].map((u) => u.length),
                    "no view notice",
                  ).toEqual(updates);
                }

                yield* agrees(w, a, base);
              }),
            ),
          );
          expect(seen.has("same") && seen.has("repeat")).toBe(true);
        }),
      TIMEOUT,
    );

    // L3, p71 and the permit. Plant: swap outside the permit (experiment 183's cut); step a resent letter twice.
    it.live(
      "L3: a swap sent while a step is held open runs after that turn; the next letter runs on the new code; each letter steps once, resends included",
      () =>
        Effect.gen(function* () {
          yield* law((g) =>
            inWorld(rig, [BASE], (w) =>
              Effect.gen(function* () {
                const base = yield* hashFor(BASE);
                yield* open(w, NAME, base);
                const a = account(base);
                const sent: Array<ReturnType<typeof press>["input"]> = [];
                const before = g(fc.integer, { min: 0, max: 4 });

                for (let n = 0; n < before; n++) {
                  sent.push(yield* pressOnce(w, a, g));
                }

                // The held turn: its step waits on a gate the law opens after the swap is sent.
                const s = yield* session(w, NAME);
                const gate = yield* Deferred.make<void>();
                const held = yield* Deferred.make<void>();
                w.code.stepGate = gate;
                w.code.held = held;
                const { input } = press(w, "inc");
                const turn = yield* Effect.forkChild(s.runner.msg(input));
                yield* Deferred.await(held);
                const spec = g(() =>
                  fcFitting(
                    updateFor(Option.getOrThrow(Option.fromNullishOr(w.code.variants.get(a.build))), a.model, {
                      type: "inc",
                    }),
                    a.v,
                  ),
                );
                const hash = yield* learn(w.code, spec);
                const swapping = yield* Effect.forkChild(swap(s, "install_held", hash));

                for (let n = 0; n < 20; n++) {
                  yield* Effect.yieldNow;
                }

                expect(swapping.pollUnsafe(), "the swap waits for the turn in flight").toBeUndefined();
                yield* Deferred.succeed(gate, undefined);
                expect((yield* Fiber.join(turn))._tag).toBe("accepted");
                a.model = updateFor(Option.getOrThrow(Option.fromNullishOr(w.code.variants.get(a.build))), a.model, {
                  type: "inc",
                });
                a.accepted.push(input.id);
                sent.push(input);
                const answer = yield* Fiber.join(swapping);
                w.code.held = null;

                if (hash === a.build) {
                  expect(answer).toEqual(SwapAnswer.cases.same.make({}));
                } else {
                  expect(answer).toEqual(SwapAnswer.cases.swapped.make({ was: a.build }));
                  a.model = climb(spec, a.model, a.v);
                  a.v = spec.v;
                  a.build = hash;
                  a.swaps++;
                }

                // The next letter runs on the new code; resends of letters this walk sent step nothing.
                const next = yield* pressOnce(w, a, g);
                const resends = g(fc.integer, { min: 0, max: Math.min(3, sent.length) });

                for (let n = 0; n < resends; n++) {
                  const again = pick(g, sent);
                  expect((yield* s.runner.msg(again))._tag).toBe("accepted");
                }

                const { facts } = yield* agrees(w, a, base);
                const stepped = byTag(facts, "stepped");
                expect(stepped.find((f) => f.body.input === next.id)?.body.build, "the next letter's code").toBe(hash);

                for (const id of a.accepted) {
                  expect(
                    stepped.filter((f) => f.body.input === id),
                    `${id} steps once`,
                  ).toHaveLength(1);
                }
              }),
            ),
          );
        }),
      TIMEOUT,
    );

    // L4, p70. Plants: save before acceptance; drop `after`; forget the prepared swap after its checkpoint write.
    it.live(
      "L4: no accepted letter and no answered fact is lost by a swap or an object restart after one, and they read back in order",
      () =>
        Effect.gen(function* () {
          const seen = new Set<string>();
          yield* law((g) =>
            inWorld(rig, [BASE], (w) =>
              Effect.gen(function* () {
                const base = yield* hashFor(BASE);
                yield* open(w, NAME, base);
                const a = account(base);
                const steps = g(fc.integer, { min: 1, max: 12 });

                for (let n = 0; n < steps; n++) {
                  const move = pick(g, [
                    "press",
                    "press",
                    "cut_press",
                    "swap",
                    "cut_swap",
                    ...(a.swaps > 0 ? ["restart"] : []),
                  ]);
                  seen.add(move);

                  if (move === "press") {
                    yield* pressOnce(w, a, g);
                  } else if (move === "cut_press") {
                    const s = yield* session(w, NAME);
                    const type = pick(g, ["inc", "dec", "reset"] as const);
                    const { input } = press(w, type);
                    const cut = pick(g, ["before_acceptance", "after_acceptance"]);
                    w.cuts.armed = cut;
                    expect(Exit.isFailure(yield* Effect.exit(s.runner.msg(input)))).toBe(true);
                    expect(w.cuts.armed).toBeNull();
                    seen.add(cut);

                    if (g(fc.boolean)) {
                      yield* evict(w, NAME);
                    }

                    expect((yield* (yield* session(w, NAME)).runner.msg(input))._tag).toBe("accepted");
                    a.model = updateFor(
                      Option.getOrThrow(Option.fromNullishOr(w.code.variants.get(a.build))),
                      a.model,
                      { type },
                    );
                    a.accepted.push(input.id);
                    yield* agrees(w, a, base);
                  } else if (move === "swap") {
                    yield* swapFitting(
                      w,
                      a,
                      g(() => fcFitting(a.model, a.v)),
                    );
                  } else if (move === "cut_swap") {
                    const s = yield* session(w, NAME);
                    const before = yield* history(w, NAME);
                    const client = `cut-watcher-${n}`;
                    yield* s.runner.open(client);
                    const updates = Option.getOrThrow(Option.fromNullishOr(w.names.get(NAME))).updates;
                    const notices = updates.get(client)?.length ?? 0;
                    // These are completed writes in an upgrade this model can take, not arbitrary cuts.
                    const spec = { ...g(() => fcFitting(a.model, a.v)), v: a.v + 1 };
                    const hash = yield* learn(w.code, spec);
                    const load = `install_${++a.loads}`;
                    const cut = pick(g, [
                      "after_swap_prepared",
                      "after_swap_checkpoint",
                      "after_swap_upgrade",
                      "after_swap_record",
                      "after_swap_alarm",
                      "after_swap_publish",
                      "after_swap_supervisor",
                    ]);
                    w.cuts.armed = cut;
                    const result = yield* Effect.exit(swap(s, load, hash));
                    expect(Exit.isFailure(result), `the call lost its answer at ${cut}`).toBe(true);
                    expect(w.cuts.armed, "the write was reached").toBeNull();
                    expect(w.cuts.hits.at(-1)).toBe(cut);
                    seen.add(cut);
                    a.model = climb(spec, a.model, a.v);
                    a.v = spec.v;
                    a.build = hash;
                    a.ran.push(hash);
                    a.swaps++;
                    // A lost answer is retried on the same object or after an eviction.
                    const reopen = g(fc.boolean);

                    if (reopen) {
                      yield* evict(w, NAME);
                    }

                    seen.add(reopen ? "cut_reopen" : "cut_retry");
                    const resumed = yield* session(w, NAME);
                    expect(yield* swap(resumed, load, hash)).toEqual(SwapAnswer.cases.same.make({}));

                    if (!reopen) {
                      const fresh = (updates.get(client) ?? []).slice(notices);
                      expect(fresh.length, "recovery finishes the view notice").toBeGreaterThan(0);
                      const rev = before.inbox.filter((l) => a.accepted.includes(l.id)).at(-1)?.pos ?? 0;
                      expect(fresh).toEqual(fresh.map(() => ({ type: "whole", rev, view: a.model })));
                    }

                    const after = yield* agrees(w, a, base);
                    expect(after.checkpoint?.saved.after, "the inbox position survives the swap").toBe(
                      before.checkpoint?.saved.after ?? 0,
                    );
                    const upgrade = after.facts.findIndex((f) => f.id === `state.upgraded:${load}`);
                    const swapped = after.facts.findIndex((f) => f.id === `code.swapped:${load}`);
                    expect(upgrade, "the upgrade is recorded before the swap").toBeGreaterThanOrEqual(0);
                    expect(swapped).toBeGreaterThan(upgrade);
                    expect(after.facts.filter((f) => f.id === `code.swapped:${load}`)).toHaveLength(1);
                    expect(after.facts.filter((f) => f.id === `state.upgraded:${load}`)).toHaveLength(1);
                    // The first later letter must use the recovered code and kept model.
                    yield* pressOnce(w, a, g);
                  } else {
                    yield* evict(w, NAME);
                  }
                }

                yield* evict(w, NAME);
                const { facts, inbox } = yield* agrees(w, a, base);
                // Every accepted letter is in the inbox, in the order it was accepted, and stepped once.
                const ids = inbox.map((l) => l.id).filter((id) => a.accepted.includes(id));
                expect(ids).toEqual(a.accepted);
                const revs = inbox.map((l) => l.rev);
                expect(revs).toEqual([...revs].sort((x, y) => x - y));
                const stepped = byTag(facts, "stepped").map((f) => f.body.input);
                expect(stepped).toEqual(a.accepted);
                expect(byTag(facts, "code.swapped")).toHaveLength(a.swaps);
              }),
            ),
          );

          for (const move of [
            "restart",
            "before_acceptance",
            "after_acceptance",
            "cut_retry",
            "cut_reopen",
            "after_swap_prepared",
            "after_swap_checkpoint",
            "after_swap_upgrade",
            "after_swap_record",
            "after_swap_alarm",
            "after_swap_publish",
            "after_swap_supervisor",
          ]) {
            expect(seen.has(move), `the walk reaches ${move}`).toBe(true);
          }
        }),
      TIMEOUT,
    );

    // L14. Plant: send a patch at the same rev; send nothing.
    it.live(
      "L14: after a swap every watcher gets one whole at the current rev with the new code's view; no patch has rev equal to its base",
      () =>
        Effect.gen(function* () {
          const seen = new Set<string>();
          yield* law((g) =>
            inWorld(rig, [BASE], (w) =>
              Effect.gen(function* () {
                const base = yield* hashFor(BASE);
                yield* open(w, NAME, base);
                const a = account(base);
                const watchers: Array<string> = [];
                const steps = g(fc.integer, { min: 1, max: 12 });

                for (let n = 0; n < steps; n++) {
                  const move = pick(g, ["press", "watch", "swap", "swap"]);
                  const s = yield* session(w, NAME);

                  if (move === "press") {
                    yield* pressOnce(w, a, g);
                  } else if (move === "watch") {
                    const client = `tab-${n}`;
                    yield* s.runner.open(client);
                    watchers.push(client);
                  } else {
                    const updates = Option.getOrThrow(Option.fromNullishOr(w.names.get(NAME))).updates;
                    const counts = new Map(watchers.map((c) => [c, updates.get(c)?.length ?? 0]));
                    const { answer } = yield* swapFitting(
                      w,
                      a,
                      g(() => fcFitting(a.model, a.v)),
                    );
                    const { inbox } = yield* history(w, NAME);
                    const rev = inbox.filter((l) => a.accepted.includes(l.id)).at(-1)?.pos ?? 0;

                    for (const client of watchers) {
                      const fresh = (updates.get(client) ?? []).slice(counts.get(client));
                      // A same-hash swap sends nothing (L2); a swap sends one whole at the current rev.
                      expect(fresh, `${client} after the swap`).toEqual(
                        answer._tag === "same" ? [] : [{ type: "whole", rev, view: a.model }],
                      );
                      seen.add(answer._tag === "same" ? "same" : "whole");
                    }
                  }
                }

                for (const [client, list] of Option.getOrThrow(Option.fromNullishOr(w.names.get(NAME))).updates) {
                  const same = list.filter((u) => u.type === "patch" && u.rev === u.base);
                  expect(same, `${client}'s patches at their own base`).toEqual([]);
                }
              }),
            ),
          );
          expect(seen.has("whole")).toBe(true);
        }),
      TIMEOUT,
    );

    // L15. Plant: rewrite the dispatched entry's build; fold the answer twice.
    it.live(
      "L15: a Cmd dispatched on the old code keeps its build on its dispatched entry; its answer folds once, on the code running when it arrives",
      () =>
        Effect.gen(function* () {
          const seen = new Set<string>();
          yield* law(
            (g) =>
              Effect.gen(function* () {
                const start: Spec = { ...BASE, cmd: true, k: g(fc.integer, { min: 1, max: 5 }) };
                yield* inWorld(rig, [start], (w) =>
                  Effect.gen(function* () {
                    const old = yield* hashFor(start);
                    const s = yield* open(w, NAME, old);
                    const a = account(old);
                    const gate = yield* Deferred.make<void>();
                    const started = yield* Deferred.make<void>();
                    w.code.cmdGate = gate;
                    w.code.cmdStarted = started;
                    const { input } = press(w, "inc");
                    const turn = yield* Effect.forkChild(s.runner.msg(input));
                    yield* Deferred.await(started);
                    a.model = updateFor(start, a.model, { type: "inc" });
                    a.accepted.push(input.id);
                    const late = g(fc.boolean);

                    if (!late) {
                      // The answer arrives before the swap: it folds on the old code.
                      yield* Deferred.succeed(gate, undefined);
                      yield* Fiber.join(turn);
                      a.model = updateFor(start, a.model, { type: "ping_ok" });
                    }

                    yield* swapFitting(w, a, { ...g(() => fcFitting(a.model, a.v)), cmd: true });

                    if (late) {
                      const { checkpoint } = yield* history(w, NAME);
                      const pending = (checkpoint?.cmds ?? []) as ReadonlyArray<{ readonly build?: string }>;
                      expect(
                        pending.map((c) => c.build),
                        "the dispatched entry keeps its build",
                      ).toEqual([old]);
                      yield* Deferred.succeed(gate, undefined);
                      yield* Fiber.join(turn);
                      a.model = updateFor(
                        Option.getOrThrow(Option.fromNullishOr(w.code.variants.get(a.build))),
                        a.model,
                        { type: "ping_ok" },
                      );
                    }

                    seen.add(late ? "late" : "early");
                    const { facts } = yield* agrees(w, a, old);
                    const answers = byTag(facts, "stepped").filter((f) => String(f.body.input).endsWith("/answer"));
                    expect(answers, "the answer folds once").toHaveLength(1);
                    expect(answers[0]?.body.build).toBe(late ? a.build : old);
                  }),
                );
              }),
            50,
          );
          expect(seen.has("late") && seen.has("early")).toBe(true);
        }),
      TIMEOUT,
    );
  });

  describe("P15 slice 1: pending Cmds survive swap recovery", () => {
    it.live(
      "L4/L15: normal and recovered swaps keep pending Cmds and their retry deadline; each answer folds once on the new code",
      () =>
        Effect.gen(function* () {
          const seen = new Set<string>();
          yield* law((g) => {
            const durable = pick(g, ["write", "send"] as const);
            const start = { ...BASE, durable, k: g(fc.integer, { min: 1, max: 5 }) };
            return inWorld(rig, [start], (w) =>
              Effect.gen(function* () {
                const old = yield* hashFor(start);
                let s = yield* open(w, NAME, old);
                const a = account(old);
                const steps = g(fc.integer, { min: 1, max: 4 });

                for (let n = 0; n < steps; n++) {
                  // Only an idle process with no unanswered Cmd starts the next round.
                  expect((yield* history(w, NAME)).checkpoint?.cmds ?? []).toEqual([]);
                  w.durable.blocked = true;
                  const { input } = press(w, "inc");
                  yield* Effect.exit(s.runner.msg(input));
                  const before = yield* history(w, NAME);
                  const pending = Option.getOrThrow(Option.fromNullishOr(before.checkpoint)).cmds;
                  expect(pending).toHaveLength(1);
                  const job = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, build: Schema.String }))(
                    pending[0],
                  );
                  expect(job.build).toBe(a.build);
                  expect(w.durable.attempts).toContain(job.id);
                  expect(w.durable.completed.has(job.id)).toBe(false);
                  a.model = updateFor(Option.getOrThrow(Option.fromNullishOr(w.code.variants.get(a.build))), a.model, {
                    type: "inc",
                  });
                  a.accepted.push(input.id);
                  const spec = { ...g(() => fcFitting(a.model, a.v)), durable };
                  const hash = yield* learn(w.code, spec);
                  const load = `pending_${n}`;
                  const cut = pick(g, [
                    "after_swap_prepared",
                    "after_swap_checkpoint",
                    "after_swap_record",
                    "after_swap_supervisor",
                  ]);
                  w.cuts.armed = cut;
                  expect(Exit.isFailure(yield* Effect.exit(swap(s, load, hash)))).toBe(true);
                  expect(w.cuts.armed).toBeNull();
                  const reopen = g(fc.boolean);

                  if (reopen) {
                    yield* evict(w, NAME);
                    s = yield* session(w, NAME);
                  }

                  w.durable.blocked = false;
                  yield* swap(s, load, hash);
                  yield* s.runner.open(`pending-reader-${n}`);
                  const finished = yield* Effect.suspend(() => Effect.succeed(w.durable.completed.has(job.id))).pipe(
                    Effect.repeat({ until: Boolean, schedule: Schedule.spaced("1 millis") }),
                    Effect.timeoutOption("100 millis"),
                  );
                  expect(Option.isSome(finished), "the next turn retries the dispatched job after swap recovery").toBe(
                    true,
                  );
                  yield* s.runner.open(`pending-reader-${n}`);
                  a.model = climb(spec, a.model, a.v);
                  a.model = updateFor(spec, a.model, { type: `${durable}_ok` });
                  a.v = spec.v;
                  a.build = hash;
                  a.ran.push(hash);
                  a.swaps++;
                  const after = yield* history(w, NAME);
                  expect(after.checkpoint?.cmds).toEqual([]);
                  expect(after.checkpoint?.saved.model).toEqual(a.model);
                  expect(
                    after.facts.filter((f) => f.tag === "stepped" && f.body.input === `${job.id}/answer`),
                  ).toHaveLength(1);
                  expect(
                    after.facts.find((f) => f.tag === "stepped" && f.body.input === `${job.id}/answer`)?.body.build,
                  ).toBe(hash);
                  expect(
                    after.facts.filter((f) => f.tag === "code.swapped" && f.id === `code.swapped:${load}`),
                  ).toHaveLength(1);
                  expect([...w.durable.completed]).toHaveLength(n + 1);
                  seen.add(durable);
                  seen.add(reopen ? "reopen" : "retry");
                  seen.add(cut);
                }
              }),
            );
          }, 100);

          for (const move of [
            "write",
            "send",
            "reopen",
            "retry",
            "after_swap_prepared",
            "after_swap_checkpoint",
            "after_swap_record",
            "after_swap_supervisor",
          ]) {
            expect(seen.has(move), `the walk reaches ${move}`).toBe(true);
          }

          // A successful swap must keep a failed Send's alarm without another client call.
          // Plant: omit sendRetry from finishSwap's alarm candidates.
          yield* law((g) => {
            const start: Spec = { ...BASE, durable: "send", k: g(fc.integer, { min: 1, max: 5 }) };
            return inWorld(rig, [start], (w) =>
              Effect.gen(function* () {
                const old = yield* hashFor(start);
                const s = yield* open(w, NAME, old);
                const a = account(old);
                const steps = g(fc.integer, { min: 1, max: 4 });

                for (let n = 0; n < steps; n++) {
                  expect((yield* history(w, NAME)).checkpoint?.cmds ?? []).toEqual([]);
                  w.durable.blocked = true;
                  const { input } = press(w, "inc");
                  yield* Effect.exit(s.runner.msg(input));
                  const before = yield* history(w, NAME);
                  const pending = Option.getOrThrow(Option.fromNullishOr(before.checkpoint)).cmds;
                  expect(pending).toHaveLength(1);
                  const job = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, build: Schema.String }))(
                    pending[0],
                  );
                  expect(job.build).toBe(a.build);
                  expect(w.durable.attempts).toContain(job.id);
                  expect(w.durable.completed.has(job.id)).toBe(false);
                  const deadline = Option.getOrThrow(Option.fromNullishOr(s.alarms.at(-1)));
                  const now = yield* Clock.currentTimeMillis;
                  expect(deadline).toBeGreaterThan(now);
                  a.model = updateFor(Option.getOrThrow(Option.fromNullishOr(w.code.variants.get(a.build))), a.model, {
                    type: "inc",
                  });
                  a.accepted.push(input.id);
                  yield* TestClock.setTime(g(fc.integer, { min: now + 1, max: deadline - 1 }));
                  const spec = g(() =>
                    fcFitting(a.model, a.v)
                      .map((variant) => ({ ...variant, durable: "send" as const }))
                      .filter((variant) => JSON.stringify(variant) !== JSON.stringify(w.code.variants.get(a.build))),
                  );
                  const hash = yield* learn(w.code, spec);
                  expect(hash).not.toBe(a.build);
                  const load = `normal_pending_${n}`;
                  expect(yield* swap(s, load, hash)).toEqual(SwapAnswer.cases.swapped.make({ was: a.build }));
                  expect(s.alarms.at(-1), "a normal swap preserves the original Send retry deadline").toBe(deadline);
                  expect((yield* history(w, NAME)).checkpoint?.cmds).toEqual(pending);
                  const attempts = w.durable.attempts.filter((id) => id === job.id).length;
                  w.durable.blocked = false;
                  yield* TestClock.setTime(deadline);
                  // The host fires only the alarm. No msg, open or mailed call nudges the runner.
                  yield* s.runner.due(deadline);
                  expect(w.durable.attempts.filter((id) => id === job.id)).toHaveLength(attempts + 1);
                  expect(w.durable.completed.has(job.id)).toBe(true);
                  a.model = updateFor(spec, climb(spec, a.model, a.v), { type: "send_ok" });
                  a.v = spec.v;
                  a.build = hash;
                  const after = yield* history(w, NAME);
                  expect(after.checkpoint?.cmds).toEqual([]);
                  expect(after.checkpoint?.saved.model).toEqual(a.model);
                  expect(after.checkpoint?.saved.build).toBe(hash);
                  const answers = after.facts.filter((f) => f.tag === "stepped" && f.body.input === `${job.id}/answer`);
                  expect(answers).toHaveLength(1);
                  expect(answers[0]?.body.build).toBe(hash);
                  expect(after.facts.filter((f) => f.id === `code.swapped:${load}`)).toHaveLength(1);
                  expect([...w.durable.completed]).toHaveLength(n + 1);
                  expect(s.alarms.at(-1), "the answered Send no longer needs an alarm").toBeNull();
                }
              }).pipe(Effect.provide(TestClock.layer())),
            );
          }, 50);
        }),
      TIMEOUT,
    );
  });

  describe("P15 slice 1: one program's processes, each with its own outcome", () => {
    /** Two to four processes of one program, each walked to its own count, some swapped up first. */
    const processes = Effect.fnUntraced(function* (w: World, g: fc.GeneratorValue) {
      const base = yield* hashFor(BASE);
      const total = g(fc.integer, { min: 2, max: 4 });
      const accounts = new Map<string, Account>();

      for (let p = 1; p <= total; p++) {
        const name = `counter:${p}`;
        yield* open(w, name, base);
        const a = account(base);
        accounts.set(name, a);
        const presses = g(fc.integer, { min: 0, max: 6 });

        for (let n = 0; n < presses; n++) {
          yield* pressOnce(w, a, g, name);
        }

        // Some processes climb to a higher `v` first, so a later variant may be below them.
        if (g(fc.boolean)) {
          yield* swapFitting(w, a, { ...BASE, v: 1 + g(fc.integer, { min: 1, max: 2 }) }, name);
        }
      }

      return { base, accounts };
    });

    /** One variant pushed to every process, generated so that one chosen process's model fails it. */
    const push = Effect.fnUntraced(function* (w: World, g: fc.GeneratorValue, accounts: Map<string, Account>) {
      const target = pick(g, [...accounts.values()]);
      const spec = g(() => fcRefusing(target.model, target.v));
      const hash = yield* learn(w.code, spec);
      const load = "install_push";
      const outcomes = new Map<string, "fits" | "shape" | "newer">();

      for (const [name, a] of accounts) {
        const expected = a.build === hash ? "same" : fits(spec, a.model, a.v);
        const answer = yield* swap(yield* session(w, name), load, hash);

        expect(answer, `${name}: ${expected}`).toEqual(
          expected === "same"
            ? SwapAnswer.cases.same.make({})
            : expected === "fits"
              ? SwapAnswer.cases.swapped.make({ was: a.build })
              : SwapAnswer.cases.refused.make({ was: a.build, reason: expected }),
        );

        if (expected === "same") {
          continue;
        }

        outcomes.set(name, expected);

        if (expected === "fits") {
          a.model = climb(spec, a.model, a.v);
          a.v = spec.v;
          a.build = hash;
          a.swaps++;
        }
      }

      // A repeated push of the same load writes nothing more.
      for (const name of accounts.keys()) {
        yield* swap(yield* session(w, name), load, hash);
      }

      return { spec, hash, load, outcomes };
    });

    // L5, p74. Plant: select before decoding; refuse every process when one fails; write the refusal twice on a repeated push.
    it.live(
      "L5: a variant that cannot read a process's model leaves it on its old hash and model with one code.refused per load; newer when its v is lower; a fitting sibling swaps",
      () =>
        Effect.gen(function* () {
          const seen = new Set<string>();
          yield* law((g) =>
            inWorld(rig, [BASE], (w) =>
              Effect.gen(function* () {
                const { base, accounts } = yield* processes(w, g);
                const { hash, load, outcomes } = yield* push(w, g, accounts);

                for (const [name, a] of accounts) {
                  // Before anything else runs, the saved checkpoint names the code the process holds now.
                  const pushed = yield* history(w, name);
                  expect(pushed.checkpoint?.saved.build ?? base, `${name}'s checkpoint after the push`).toBe(a.build);
                  // The next press runs on the code the process holds now: the new one, or its old one.
                  const input = yield* pressOnce(w, a, g, name);
                  const { facts } = yield* agrees(w, a, base, name);
                  expect(byTag(facts, "stepped").find((f) => f.body.input === input.id)?.body.build).toBe(a.build);
                  const refused = byTag(facts, "code.refused").filter((f) => f.id === `code.refused:${load}`);
                  const outcome = outcomes.get(name);
                  seen.add(outcome ?? "same");

                  if (outcome === "shape" || outcome === "newer") {
                    expect(refused, `${name}'s refusal, once`).toHaveLength(1);
                    expect(refused[0]?.body).toEqual({ program: PROGRAM, hash, was: a.build, reason: outcome });
                    expect(a.build, "it stays on its old hash").not.toBe(hash);
                  } else {
                    expect(refused).toHaveLength(0);
                  }
                }
              }),
            ),
          );

          for (const outcome of ["fits", "shape", "newer"]) {
            expect(seen.has(outcome), `the walk reaches ${outcome}`).toBe(true);
          }
        }),
      TIMEOUT,
    );

    // L6, the wake. Plant: load the descriptor's hash when a checkpoint exists.
    it.live(
      "L6: an evicted process wakes on the hash its checkpoint names with its kept model; a refused one on its old hash; one with no checkpoint on its descriptor's",
      () =>
        Effect.gen(function* () {
          const seen = new Set<string>();
          yield* law((g) =>
            inWorld(rig, [BASE], (w) =>
              Effect.gen(function* () {
                const { base, accounts } = yield* processes(w, g);
                yield* push(w, g, accounts);
                // A process that never stepped has no checkpoint: it runs its descriptor's code.
                const fresh = `counter:${accounts.size + 1}`;
                yield* open(w, fresh, base);
                accounts.set(fresh, account(base));

                for (const name of accounts.keys()) {
                  yield* evict(w, name);
                }

                for (const [name, a] of accounts) {
                  const input = yield* pressOnce(w, a, g, name);
                  const { facts } = yield* agrees(w, a, base, name);
                  const step = byTag(facts, "stepped").find((f) => f.body.input === input.id);
                  expect(step?.body.build, `${name} woke on the code that saved it`).toBe(a.build);
                  seen.add(a.build === base ? (a.accepted.length === 1 ? "descriptor" : "old") : "checkpoint");
                }
              }),
            ),
          );

          for (const tag of ["descriptor", "old", "checkpoint"]) {
            expect(seen.has(tag), `the walk reaches ${tag}`).toBe(true);
          }
        }),
      TIMEOUT,
    );
  });
};
