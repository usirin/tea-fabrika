// P15 slice 1, next/. The reload laws' world: generated counter variants built with `Program.make`,
// a loader that serves each by its hash through the real Node execution, real runners over SQLite
// files that can be evicted and woken, and the history oracle that folds a process's own stream.
//
// Every folder, database and runner is acquired in a scope (0061): the world's folder lives as long
// as its scope, and each runner session has a child scope that an eviction closes.
import { DatabaseSync } from "node:sqlite"; // edge: Effect SQL has no synchronous SQLite handle for the runner's store
import { Outcome } from "@demlik/tea";
import { Machine, Cmd } from "@demlik/tea/effect";
import { NodeServices } from "@effect/platform-node";
import { Context, Deferred, Effect, Exit, FileSystem, Layer, Path, Result, Schema, Scope, Stream } from "effect";
import * as fc from "fast-check";
import { Mailbox, ProcessManager, ProcessStore, Writer } from "../coordination/index.ts";
import * as Id from "../Id.ts";
import { Doorbell, Ledger } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Owner, Recipient, Start } from "../processes/Process.ts";
import type { Sql } from "../Sql.ts";
import { hash } from "./Built.ts";
import { Alarm, CheckedWriter, type Loaded, ProgramLoader, Recording, type Update, WatcherManager } from "./Entry.ts";
import { Supervision } from "./internal/supervisor.ts";
import { Program, ProgramDown } from "./Program.ts";
import { recoveryStore } from "./RecoveryStore.ts";
import { ProgramRunner } from "./Runner.ts";

export const SEED = 119120;
/** P40: the counter's qualified name; its registered names stay `counter:N`. */
export const PROGRAM = "fabrika/counter";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const PERSON = Writer.cases.person.make({ key: "SHA256:person", for: "person" });

// --- Variants ---------------------------------------------------------------------------------

/** How a variant's schema reads a counter model. */
export type Shape = "same" | "widened" | "narrowed" | "field";

/** One generated counter: its `inc` step, its schema, its `v` and its upgrade chain. */
export type Spec = {
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
};

/** The real counter, as main builds it: `inc` adds one, `v` 1, no upgrades, no Cmd. */
export const BASE: Spec = { k: 1, shape: "same", min: 0, max: 0, v: 1, gaps: [], cmd: false };

export type CounterModel = { readonly count: number; readonly step?: number };

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
export const updateFor = (spec: Spec, model: CounterModel, m: { readonly type: string }): CounterModel =>
  m.type === "inc"
    ? { ...model, count: clamp(spec, model.count + spec.k) }
    : m.type === "dec"
      ? { ...model, count: clamp(spec, model.count - spec.k) }
      : m.type === "reset"
        ? { ...model, count: clamp(spec, 0) }
        : m.type === "ping_ok"
          ? { ...model, count: clamp(spec, model.count + 10 * spec.k) }
          : model;

/** The chain: one upgrade per number below `v`, except the gaps. A field variant's upgrades add `step`. */
export const upgradesFor = (spec: Spec) =>
  Array.from({ length: spec.v - 1 }, (_, i) => i + 1)
    .filter((from) => !spec.gaps.includes(from))
    .map((from) => ({
      name: `${spec.shape}_${from}`,
      from,
      run: (m: unknown): unknown =>
        spec.shape === "field" && typeof m === "object" && m !== null && !("step" in m) ? { ...m, step: 1 } : m,
    }));

const ping = Cmd.make("ping", { input: Schema.Struct({ n: Schema.Number }), ok: Schema.Number, err: [] });

const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("inc") }),
  Schema.Struct({ type: Schema.Literal("dec") }),
  Schema.Struct({ type: Schema.Literal("reset") }),
]);

/** The variant as a program, made with `Program.make` as a program author writes one. */
export const programFor = (spec: Spec) => {
  const model = schemaFor(spec);
  const machine = Machine.make({
    model: model as Schema.Codec<CounterModel>,
    msg: Msg,
    cmds: [ping],
    init: (loaded: CounterModel | null) => [
      loaded ?? (spec.shape === "field" ? { count: clamp(spec, 0), step: 1 } : { count: clamp(spec, 0) }),
      [],
    ],
    update: {
      inc: (s: CounterModel, m: typeof Msg.Type) => [updateFor(spec, s, m), spec.cmd ? [ping({ n: s.count })] : []],
      dec: (s: CounterModel, m: typeof Msg.Type) => [updateFor(spec, s, m), []],
      reset: (s: CounterModel, m: typeof Msg.Type) => [updateFor(spec, s, m), []],
      ping_ok: (s: CounterModel) => [updateFor(spec, s, { type: "ping_ok" }), []],
      ping_err: (s: CounterModel) => [s, []],
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
    writes: {},
    wake: () => null,
  });
};

/** A variant's hash: the SHA-256 of its spec, so one spec is one hash, as one bundle's bytes are. */
export const hashFor = (spec: Spec) => hash(JSON.stringify(spec));

/** What the oracle says a variant does with a model saved at `v`. */
export const fits = (spec: Spec, model: CounterModel, v: number): "fits" | "shape" | "newer" => {
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
export const climb = (spec: Spec, model: CounterModel, v: number): CounterModel => {
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
export const fcFitting = (model: CounterModel, v: number): fc.Arbitrary<Spec> =>
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
export const fcRefusing = (model: CounterModel, v: number): fc.Arbitrary<Spec> =>
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
export type Calls = {
  /** Each `init` the runner called, with the hash of the code it ran on. */
  readonly inits: Array<string>;
  /** Each hash `load` was asked for. */
  readonly loads: Array<string>;
};

/** The variants this world knows, by hash, and a gate a law may hold a step or a Cmd open with. */
export type Code = {
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

export const makeCode = Effect.fnUntraced(function* (specs: ReadonlyArray<Spec>) {
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
export const learn = Effect.fnUntraced(function* (code: Code, spec: Spec) {
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
      return {
        declaration: loaded.declaration,
        handler: loaded.handler,
        execution: {
          ...execution,
          init: (saved: unknown) =>
            Effect.suspend(() => {
              code.calls.inits.push(build);
              return execution.init(saved);
            }),
          step: (model: unknown, m: unknown) =>
            Effect.gen(function* () {
              const gate = code.stepGate;

              if (gate !== null) {
                code.stepGate = null;

                if (code.held !== null) {
                  yield* Deferred.succeed(code.held, undefined);
                }

                yield* Deferred.await(gate);
              }

              return yield* execution.step(model, m);
            }),
        },
      };
    }),
});

// --- The world --------------------------------------------------------------------------------

/** One registered name: its process, the build its descriptor names, and its watchers' updates. */
export type Name = {
  readonly name: string;
  readonly store: string;
  pid: string;
  readonly build: string;
  /** Every update each client was sent, in order, across every session. */
  readonly updates: Map<string, Array<Update>>;
  session: Session | null;
};

/** One open runner, with the services a law reads back through. */
export type Session = {
  readonly scope: Scope.Closeable;
  readonly runner: ProgramRunner["Service"];
  readonly run: <A, E>(
    work: Effect.Effect<A, E, ProgramRunner | Mailbox | Ledger | ProcessStore>,
  ) => Effect.Effect<A, E>;
  readonly sql: Sql;
};

export type World = {
  readonly folder: string;
  readonly code: Code;
  readonly names: Map<string, Name>;
  letters: number;
};

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

const brainFrom = (build: string) => ({
  by: "SHA256:brain",
  for: "brain",
  sentAt: "2026-11-11T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: TRACE,
  build,
});

/** A fresh folder for one walk, given back with its scope. */
export const world = (specs: ReadonlyArray<Spec>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const folder = yield* fs.makeTempDirectoryScoped({ prefix: "p15-reload-" });
    const code = yield* makeCode(specs);
    return { folder, code, names: new Map(), letters: 0 } satisfies World;
  }).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

const connection = (file: string) =>
  Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(file)),
    (db) => Effect.sync(() => db.isOpen && db.close()),
  ).pipe(Effect.map(nodeSql));

const nextProcess = Id.Generator.use((ids) => ids.next(Id.Process)).pipe(
  Effect.provide(Id.Generator.layer),
  Effect.orDie,
);

/** Opens a runner for `name`, starting it on `build` the first time, waking it after. */
export const open = Effect.fnUntraced(function* (w: World, name: string, build: string) {
  const path = yield* Path.Path;
  const known = w.names.get(name);
  const entry: Name = known ?? {
    name,
    store: `${name.replace(":", "_")}.db`,
    pid: "",
    build,
    updates: new Map(),
    session: null,
  };
  w.names.set(name, entry);
  const scope = yield* Scope.make();
  const sessionWork = Effect.gen(function* () {
    const ledgerSql = yield* connection(path.join(w.folder, "ledger.db"));
    const managerSql = yield* connection(path.join(w.folder, "manager.db"));
    const storeSql = yield* connection(path.join(w.folder, entry.store));
    const data = LedgerSql.layer(ledgerSql, { reader: "reload-law" }).pipe(Layer.provide(quiet));
    const manager = ProcessManager.layer(
      {
        by: "SHA256:brain",
        owner: Owner.cases.brain.make({}),
        recipient: Recipient.cases.client.make({ client: "brain", session: "process_0000000000e008000000000003" }),
      },
      nextProcess,
    ).pipe(Layer.provide(LedgerTransactionSql.layer(managerSql).pipe(Layer.provide(quiet))));
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
          append: (i: { id: string; envelope: { input: unknown }; sentAt: string; seen: number }) =>
            mailbox.send(name, i.id, i.envelope.input, {
              ...brainFrom(entry.build),
              by: PERSON.key,
              for: PERSON.for,
              sentAt: i.sentAt,
              seen: i.seen,
            }),
          commit: () => Effect.die("a counter variant has no write Cmd"),
          own: () => Effect.die("a counter variant has no own Cmd"),
        };
      }),
    );
    const services = Layer.mergeAll(
      Layer.succeedContext(managerContext),
      ProcessStore.layer(storeSql, { process: entry.pid }),
      checked,
      Layer.succeed(WatcherManager, {
        publish: (client: string, update: Update) =>
          Effect.sync(() => {
            entry.updates.set(client, [...(entry.updates.get(client) ?? []), structuredClone(update)]);
          }),
      }),
      Layer.succeed(Alarm, { set: () => Effect.void }),
      Layer.succeed(Recording, { flush: Effect.void }),
    ).pipe(Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data))));
    const layer = ProgramRunner.withLoader(
      { id: entry.pid, name, program: PROGRAM, build: entry.build, owner: PERSON },
      loader(w.code),
      { recovery: { sql: storeSql, name, capacity: 1024 ** 3 } },
    ).pipe(Layer.provideMerge(services));
    const context = yield* Layer.build(layer);
    const runner = Context.get(context, ProgramRunner);
    const session: Session = {
      scope,
      runner,
      run: (work) => Effect.provide(work, context),
      sql: storeSql,
    };
    return session;
  });
  const session = yield* sessionWork.pipe(Scope.provide(scope), Effect.provide(NodeServices.layer));
  entry.session = session;
  return session;
});

/** Evicts a name's object: its session's scope closes, its files stay. */
export const evict = Effect.fnUntraced(function* (w: World, name: string) {
  const entry = w.names.get(name);

  if (entry?.session != null) {
    yield* Scope.close(entry.session.scope, Exit.void);
    entry.session = null;
  }
});

/** The name's open session, waking it on its descriptor's build when it was evicted. */
export const session = Effect.fnUntraced(function* (w: World, name: string) {
  const entry = w.names.get(name);
  return entry?.session ?? (yield* open(w, name, entry?.build ?? (yield* hashFor(BASE))));
});

/** One press, as the door delivers it: a fresh letter id unless a law resends one. */
export const press = (w: World, type: "inc" | "dec" | "reset", letter?: number) => {
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
export type Fact = { readonly tag: string; readonly id: string; readonly body: Readonly<Record<string, unknown>> };

/** The name's process stream, every life of it, and its inbox, read through the open session. */
export const history = Effect.fnUntraced(function* (w: World, name: string) {
  const s = yield* session(w, name);
  const pid = w.names.get(name)?.pid ?? "";
  return yield* s.run(
    Effect.gen(function* () {
      const ledger = yield* Ledger;
      const mailbox = yield* Mailbox;
      const facts = (yield* Stream.runCollect(ledger.read(pid, 0))).map((e): Fact => ({
        tag: e._tag,
        id: e.id,
        body: e.body as Readonly<Record<string, unknown>>,
      }));
      const inbox = yield* Stream.runCollect(mailbox.read(name, 0));
      const checkpoint = yield* ProcessStore.use((store) => store.load);
      return { facts, inbox, checkpoint };
    }),
  );
});

/** The name's saved supervision journal. */
export const supervision = Effect.fnUntraced(function* (w: World, name: string) {
  const s = yield* session(w, name);
  return yield* recoveryStore(s.sql, { name, capacity: 1024 ** 3, schema: Supervision }).load;
});

/**
 * The history oracle: the model a process's own stream says it holds. Every `stepped` letter folds
 * on the code its entry names, every `code.swapped` climbs through the `state.upgraded` before it and
 * is read by the new code's schema, and a `code.refused` changes nothing. It answers the model, the
 * build the stream ends on, and every check it made on the way.
 */
export const replay = (
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
export const byTag = (facts: ReadonlyArray<Fact>, tag: string) => facts.filter((f) => f.tag === tag);
