// P15 slice 1, next/. The brain installs and selects a program's code: laws L8, L9 and L12 of the
// approved plan, on the real Project composition and SQLite. Only the platform's handles are
// supplied: storage over node:sqlite, each Process object as a recorder of what the brain pushed, and
// Worker Loader as a double that answers `describe()` from the candidate's source and counts every
// call made on each isolate. The door is a stub: no law here goes through it.
//
// Test contract (the plan's shapes): `ProjectService` gains
//   codeInstall({id, program, hash, source, from}) -> Installed   (`same`, `failed {reason}`, `loaded {processes}`)
//   codeFailed({program, hash: null, reason, path?, line?})      -> void, appends one `code.failed`
//   code(hash)                                                   -> {hash, source} | null
// both written on `gateway/code` by the brain, and each live process of the program is pushed
// `swap({load, program, hash})` on its Process object. `control.ts` allows `codeInstall` and
// `codeFailed` on the project target only. A source that does not hash to its name fails the call
// with nothing stored. The Project's own boot appends `code.loaded {from: "boot", was: null}` for a
// built-in program with no selection, and pushes the selected hash to live processes on other code.
//
// Generator contract: every walk starts from a booted Project and reads what it has made so far (the
// selected spec, the hashes that failed, the live processes) to pick the next move and its
// parameters: an install generated from the current source, one of the five failures made from it,
// a repeat, a new process, or a Project restart.
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Machine } from "@demlik/tea/effect";
import { describe, expect, it } from "@effect/vitest";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Option,
  Redacted,
  Schedule,
  Schema,
  Scope,
} from "effect";
import * as fc from "fast-check";
import { expectTypeOf, vi } from "vitest";
import { lineFor } from "../ledger/Log.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Start } from "../processes/Process.ts";
import { hash, type BuiltProgram } from "../runtime/Built.ts";
import { CodeEvent } from "../runtime/Code.ts";
import { ProgramLoader } from "../runtime/Entry.ts";
import { Program } from "../runtime/Program.ts";
import type { Descriptor } from "../runtime/Runner.ts";
import * as StartsTest from "../settings/StartsTest.ts";
import type { GatewayCalls, ProcessBinding } from "./bindings.ts";
import { control } from "./control.ts";
import { type Env, type ProjectDoorOptions, ProjectService, projectLayer } from "./runtime.ts";

vi.mock("cloudflare:workers", () => ({ WorkerEntrypoint: class {}, DurableObject: class {} }));

const SEED = 119120;

/** A Promise the law awaited rejected: fast-check's failed assertion, or a Response body that did not read. */
class Rejected extends Schema.TaggedError<Rejected>()("Rejected", { cause: Schema.Defect() }) {}

const rejected = (cause: unknown) => new Rejected({ cause });

const ProcessKey = Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String]));

const EntryBody = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const PROGRAM = "fabrika/counter";
const BRAIN_BUILD = "brain-build-test";
const TOKEN = "control-token-test";

// Main's T753: the Project reads its start from the INSTANCE binding and records it in its own ledger.
const START = StartsTest.fixture(
  {
    name: "project-test",
    person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
    // A public key line made from 32 fixed bytes: no private key exists for it.
    founder: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcH",
    window: null,
    port: 18787,
    build: BRAIN_BUILD,
  },
  (algorithm, data) => createHash(algorithm.name.replaceAll("-", "").toLowerCase()).update(data).digest(),
);

/** Cloudflare's SQLite row limit, from the plan: a source over it is refused as too large. */
const MOST = 2 * 1024 * 1024;

// L12 (type): the door the Project hands its gateway has no code calls.
expectTypeOf<GatewayCalls>().not.toHaveProperty("codeInstall");
expectTypeOf<GatewayCalls>().not.toHaveProperty("codeFailed");

/** A candidate as Worker Loader would run it: its declared name and `v`, or a throw as it loads. */
const Fixture = Schema.Struct({
  name: Schema.String,
  v: Schema.Int,
  k: Schema.Int,
  throws: Schema.Boolean,
  inputPersonOnly: Schema.Boolean,
  eventPersonOnly: Schema.Boolean,
});
type Fixture = typeof Fixture.Type;

/** A fixture's source: plain module text that names its declaration; `pad` makes it as big as asked. */
const sourceFor = (f: Fixture, pad = 0) => `export default {};\n// fixture ${JSON.stringify(f)}\n${"/".repeat(pad)}`;

const readFixture = (source: string): Fixture =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Fixture))(source.split("\n")[1]!.slice("// fixture ".length));

const declaration = (f: Fixture) => {
  const model = Schema.Struct({ count: Schema.Int });
  const machine = Machine.make({
    model,
    msg: Schema.Struct({ type: Schema.Literal("inc") }),
    cmds: [],
    init: (kept) => [kept ?? { count: 0 }, []],
    update: { inc: (s) => [{ count: s.count + f.k }, []] },
  });
  const program = Program.make({
    name: f.name,
    machine,
    state: { v: f.v, upgrades: [] },
    view: (s) => s,
    refuse: () => null,
    inputs: { inc: f.inputPersonOnly ? { description: "Add", personOnly: true as const } : "Add" },
    outputs: {},
    writes: {
      changed: { schema: Schema.TaggedStruct("changed", { count: Schema.Int }), personOnly: f.eventPersonOnly },
    },
    wake: () => null,
  });
  return ProgramLoader.use((loader) => loader.load(f.name)).pipe(
    Effect.provide(ProgramLoader.layer<never>({ [f.name]: program }, {})),
    Effect.map((loaded) => loaded.declaration),
  );
};

/** What the brain pushed to one Process object, and what that object answers. */
type Pushed = { readonly name: string; readonly load: string; readonly program: string; readonly hash: string };
expectTypeOf<Omit<Pushed, "name">>().toEqualTypeOf<Parameters<ProcessBinding["swap"]>[0]>();

/** One booted Project over one SQLite file, with every platform handle recorded. */
const instance = Effect.fnUntraced(function* (builtIn: Fixture, others: ReadonlyArray<Fixture> = []) {
  const parent = yield* Scope.Scope;
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(":memory:")),
    (db) => Effect.sync(() => db.close()),
  );
  const sql = nodeSql(db);
  const values = new Map<string, unknown>();
  const storage = {
    sql: {
      exec: sql.exec,
      get databaseSize() {
        return sql.size();
      },
    },
    transactionSync: sql.transaction,
    get: async (key: string) => values.get(key),
    put: async (key: string, value: unknown) => {
      values.set(key, value);
    },
  };
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node fixture implements the platform members Project reads; only workerd can construct a full DurableObjectState
  const ctx = {
    id: { name: "project-test" },
    storage,
    exports: { IsolateTail: () => ({ fetch: () => Promise.resolve(new Response()) }) },
  } as unknown as DurableObjectState;
  const source = sourceFor(builtIn);
  const builtHash = yield* hash(source);
  let bundled = { hash: builtHash, source };
  const pushed: Array<Pushed> = [];
  const completed: Array<Pushed> = [];
  const loadedAtPush: Array<ReadonlyArray<string>> = [];
  const swapGates = new Map<string, Effect.Effect<void>>();
  const swapReplies = new Map<
    string,
    Effect.Effect<void, Effect.Error<ReturnType<ProjectService["Service"]["append"]>>>
  >();
  const descriptors = new Map<string, Pick<Descriptor, "id" | "name" | "build" | "program">>();
  const running = new Map<string, string>();
  const refusing = new Set<string>();
  /** Names whose object cannot be reached: a start to one is saved by the Project and stays pending. */
  const unreachable = new Set<string>();
  /** A delivery to a name waits on its gate, as a `configure` still on its way. */
  const configureGates = new Map<string, Effect.Effect<void>>();
  /** Every call on every isolate, by its Worker Loader id. */
  const isolates = new Map<string, Array<string>>();
  const sources = new Map<string, string>([[builtHash, source]]);
  const otherPrograms: Record<string, BuiltProgram> = {};

  for (const f of others) {
    const source = sourceFor(f);
    const digest = yield* hash(source);
    otherPrograms[f.name] = { hash: digest, source };
    sources.set(digest, source);
  }

  let project: ProjectService["Service"] | undefined;
  let context: Context.Context<ProjectService>;
  let scope: Scope.Closeable;
  let doorPolicy: ProjectDoorOptions["policy"];
  const run = <A, E>(work: Effect.Effect<A, E, ProjectService>) => Effect.suspend(() => Effect.provide(work, context));
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node binding doubles implement only the RPC methods this composition calls, without workerd's nominal brands
  const env = {
    INSTANCE: JSON.stringify(START),
    PROJECT: {
      getByName: () => ({
        codeInstall: (install: unknown) =>
          Effect.runPromise(run(Effect.flatMap(ProjectService, (p) => p.codeInstall(install)))),
        codeFailed: (fact: unknown) =>
          Effect.runPromise(run(Effect.flatMap(ProjectService, (p) => p.codeFailed(fact)))),
        processObject: (pid: string) =>
          Effect.runPromise(run(Effect.flatMap(ProjectService, (p) => p.processObject(pid)))),
      }),
    },
    PROCESS: {
      getByName: (key: string) => {
        const [, name] = Schema.decodeUnknownSync(ProcessKey)(key);
        return {
          configure: async (d: Pick<Descriptor, "id" | "name" | "build" | "program">) => {
            if (unreachable.has(name)) {
              throw new Error("the Process object is unreachable");
            }

            const gate = configureGates.get(name);

            if (gate !== undefined) {
              await Effect.runPromise(gate);
            }

            descriptors.set(name, d);

            if (!running.has(d.id)) {
              running.set(d.id, d.build);
            }
          },
          descriptor: async (pid?: string) => {
            const d = descriptors.get(name)!;
            return { ...d, id: pid ?? d.id, build: running.get(pid ?? d.id) ?? d.build };
          },
          msg: async () => ({ _tag: "accepted", rev: 1, pos: 1 }),
          swap: async (request: Omit<Pushed, "name">) => {
            pushed.push({ name, ...request });
            loadedAtPush.push(
              sql
                .exec("SELECT body FROM entries WHERE stream='gateway/code' AND _tag='code.loaded'")
                .map(
                  (row) =>
                    Schema.decodeUnknownSync(
                      Schema.fromJsonString(Schema.Struct({ hash: CodeEvent.cases["code.loaded"].fields.hash })),
                    )(String(row.body)).hash,
                ),
            );
            const gate = swapGates.get(request.hash);

            if (gate !== undefined) {
              await Effect.runPromise(gate);
            }

            const pid = descriptors.get(name)!.id;
            const was = running.get(pid) ?? builtHash;
            completed.push({ name, ...request });

            if (request.hash === was) {
              return { _tag: "same" };
            }

            if (refusing.has(name)) {
              return { _tag: "refused", was, reason: "shape" };
            }

            running.set(pid, request.hash);
            const reply = swapReplies.get(request.hash);

            if (reply !== undefined) {
              await Effect.runPromise(reply);
            }

            return { _tag: "swapped", was };
          },
        };
      },
    },
    CONNECTION: { getByName: () => ({ ring: async () => {}, notify: async () => {}, probe: async () => 42 }) },
    RECORD: { getByName: () => ({ write: async () => ({ _tag: "written" }) }) },
    MEASUREMENTS: {},
    LOADER: {
      get: (id: string, factory: () => { readonly modules: Readonly<Record<string, string>> }) => {
        const text = factory().modules["program.js"]!;
        const calls = isolates.get(id) ?? [];
        isolates.set(id, calls);
        const fixture = readFixture(text);
        const record =
          (method: string) =>
          async (..._args: ReadonlyArray<unknown>) => {
            calls.push(method);
            return null;
          };
        return {
          getEntrypoint: () => ({
            describe: async () => {
              calls.push("describe");

              if (fixture.throws) {
                throw new Error("a module that throws as it loads");
              }

              return Effect.runPromise(declaration(fixture));
            },
            init: record("init"),
            step: record("step"),
            fold: record("fold"),
            upgrade: record("upgrade"),
            reply: record("reply"),
            admit: record("admit"),
            check: record("check"),
          }),
        };
      },
    },
  } as unknown as Env;
  const door = Object.fromEntries(
    [
      "connect",
      "challenge",
      "initialize",
      "target",
      "route",
      "knock",
      "grant",
      "disconnect",
      "sign",
      "append",
      "retire",
      "checkDelivery",
    ].map((method) => [
      method,
      () => (method === "retire" ? Effect.void : Effect.die(`the door is not under test: ${method}`)),
    ]),
  );
  const boot = Effect.fnUntraced(function* () {
    // The real composition, as the app's brain wires it; only the door is stubbed.
    scope = yield* Scope.fork(parent);
    context = yield* Layer.build(
      projectLayer(ctx, env, {
        programs: { [PROGRAM]: bundled, ...otherPrograms },
        bootstrap: [{ name: "counter:1", id: "counter:1", program: PROGRAM }],
        door: (options) => {
          doorPolicy = options.policy;
          return Effect.succeed(door as never);
        },
      }),
    ).pipe(Scope.provide(scope));
    project = Context.get(context, ProjectService);
    // The build forks its configure calls (ticket 762), so a law that reads `descriptors` waits
    // for the Project's record of them, `dev_descriptors.pending`, to clear first.
    yield* Effect.suspend(() =>
      sql.exec("SELECT process FROM dev_descriptors WHERE pending>0").length === 0
        ? Effect.void
        : Effect.fail("a start is not yet delivered to its object"),
    ).pipe(Effect.retry(Schedule.spaced("5 millis")), Effect.timeout("5 seconds"), Effect.orDie);
    return project;
  });
  yield* boot();
  return {
    db,
    env,
    builtHash,
    pushed,
    completed,
    loadedAtPush,
    swapGates,
    swapReplies,
    descriptors,
    running,
    refusing,
    unreachable,
    configureGates,
    policy: (pid: string) => Effect.suspend(() => doorPolicy(pid)),
    isolates,
    sources,
    run,
    get p() {
      return project!;
    },
    /** The Project object restarts: its runtime is given back and built again on the same storage. */
    restart: Effect.gen(function* () {
      yield* Scope.close(scope, Exit.void);
      yield* boot();
    }),
    reopen: Effect.fnUntraced(function* (replacement: Fixture) {
      yield* Scope.close(scope, Exit.void);
      const source = sourceFor(replacement);
      bundled = { hash: yield* hash(source), source };
      sources.set(bundled.hash, source);
      yield* boot();
    }),
    /** `gateway/code` and every other stream, as the ledger holds them, in log order. */
    entries: () =>
      sql.exec("SELECT stream, id, rev, _tag, body, build FROM entries ORDER BY rev").map((row) => ({
        stream: String(row.stream),
        id: String(row.id),
        rev: Number(row.rev),
        tag: String(row._tag),
        build: String(row.build),
        body: Schema.decodeUnknownSync(EntryBody)(String(row.body)),
      })),
  };
});

type Instance = Effect.Success<ReturnType<typeof instance>>;

const code = (i: Instance) => i.entries().filter((e) => e.stream === "gateway/code");

const install = Effect.fnUntraced(function* (i: Instance, id: string, f: Fixture, pad = 0, from = "watch") {
  const source = sourceFor(f, pad);
  const digest = yield* hash(source);
  i.sources.set(digest, source);
  const answer = yield* i.run(i.p.codeInstall({ id, program: PROGRAM, hash: digest, source, from: from as never }));
  return { digest, answer };
});

const checkPolicies = Effect.fnUntraced(function* (i: Instance, n: number, phase: "before" | "after") {
  for (const [name, descriptor] of i.descriptors) {
    const code = i.running.get(descriptor.id)!;
    const kept = readFixture(i.sources.get(code)!);
    const expected = {
      inputs: kept.inputPersonOnly ? ["inc"] : [],
      events: kept.eventPersonOnly ? ["changed"] : [],
    };
    expect(yield* i.policy(descriptor.id), `${name}'s running code decides its policy`).toEqual(expected);
    const id = `policy-own:${n}:${phase}:${name}`;
    yield* i.run(i.p.own(descriptor.id, id, `app/${name}`, { _tag: "changed" }));
    expect(i.entries().find((e) => e.id === id)?.build).toBe(code);
  }
});

const fixtures = fc.record({
  k: fc.integer({ min: 1, max: 9 }),
  v: fc.integer({ min: 1, max: 3 }),
  inputPersonOnly: fc.boolean(),
  eventPersonOnly: fc.boolean(),
});

const baseFixture = (): Fixture => ({
  name: PROGRAM,
  v: 1,
  k: 1,
  throws: false,
  inputPersonOnly: false,
  eventPersonOnly: false,
});

const origin: Parameters<ProjectService["Service"]["start"]>[1] = {
  by: "SHA256:brain",
  for: "brain",
  sentAt: "2026-11-11T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: BRAIN_BUILD,
};

const law = (body: (g: fc.GeneratorValue) => Effect.Effect<void, unknown, Scope.Scope>, runs: number) =>
  Effect.gen(function* () {
    // edge: fast-check owns the Promise callback; each generated run owns a fresh Effect scope.
    const property = fc.asyncProperty(fc.gen(), (g) => Effect.runPromise(Effect.scoped(body(g))));
    const options = { seed: SEED, numRuns: runs, endOnFailure: true };
    // edge: fast-check answers its assertion through a Promise.
    yield* Effect.tryPromise({ try: () => fc.assert(property, options), catch: rejected });
  });

/** A walk over one booted Project: installs, failures made from the current source, starts and restarts. */
const walk = Effect.fnUntraced(function* (g: fc.GeneratorValue, steps: number, presses: boolean) {
  const builtIn = baseFixture();
  const i = yield* instance(builtIn);
  const failed = new Set<string>();
  const seen = new Set<string>();
  let selected = i.builtHash;
  let current = builtIn;
  let names = 1;

  for (let n = 0; n < steps; n++) {
    const moves = [
      "good",
      "good",
      "same",
      "bundle",
      "compiler",
      "load",
      "name",
      "too_large",
      "restart",
      ...(presses ? ["start", "start", ...(i.descriptors.size > 0 ? ["own"] : [])] : []),
    ];
    const move = moves[g(fc.nat, { max: moves.length - 1 })]!;
    seen.add(move);
    const before = code(i).length;
    const pushes = i.pushed.length;
    const next = { ...current, ...g(() => fixtures) };

    if (move === "good") {
      const { digest, answer } = yield* install(i, `install_${n}`, next);

      if (digest === selected) {
        expect(answer).toEqual({ _tag: "same" });
        continue;
      }

      expect(answer).toMatchObject({ _tag: "loaded" });
      const added = code(i).slice(before);
      expect(added.map((e) => [e.tag, e.body.hash, e.body.was, e.body.from])).toEqual([
        ["code.loaded", digest, selected, "watch"],
      ]);
      const live = [...i.descriptors.keys()];
      expect(i.pushed.slice(pushes).map((p) => [p.name, p.hash, p.program])).toEqual(
        live.map((name) => [name, digest, PROGRAM]),
      );
      selected = digest;
      current = next;
    } else if (move === "same") {
      const { answer } = yield* install(i, `install_${n}`, current);
      expect(answer).toEqual({ _tag: "same" });
      expect(code(i)).toHaveLength(before);
      expect(i.pushed).toHaveLength(pushes);
    } else if (move === "bundle" || move === "compiler") {
      // The watcher's own failures: no bytes reached the brain, so no hash.
      const line = g(fc.integer, { min: 1, max: 400 });
      yield* i.run(
        i.p.codeFailed({
          program: PROGRAM,
          hash: null,
          reason: move,
          path: "next/programs/counter/src/program.ts",
          line,
        }),
      );
      const added = code(i).slice(before);
      expect(added.map((e) => [e.tag, e.body.reason, e.body.hash])).toEqual([["code.failed", move, null]]);
    } else if (move === "restart") {
      const expected = [...i.descriptors.values()]
        .filter((d) => i.running.get(d.id) !== selected)
        .map((d) => [d.name, selected, d.program]);
      yield* i.restart;
      expect(
        i.pushed
          .slice(pushes)
          .map((p) => [p.name, p.hash, p.program])
          .sort(),
      ).toEqual(expected.sort());
    } else if (move === "own") {
      const live = [...i.descriptors.values()];
      const descriptor = live[g(fc.nat, { max: live.length - 1 })]!;
      yield* i.run(i.p.own(descriptor.id, `record_${n}`, `app/${descriptor.id}`, { _tag: "changed", count: n }));
      expect(i.entries().find((e) => e.id === `record_${n}`)?.build).toBe(i.running.get(descriptor.id));
    } else if (move === "start") {
      const name = `counter:${++names}`;
      yield* i.run(
        i.p.start(Start.cases.first.make({ id: `start:${name}`, name, code: { program: PROGRAM, hash: selected } }), {
          by: "SHA256:brain",
          for: "brain",
          sentAt: "2026-11-11T00:00:00Z",
          seen: 0,
          parent: null,
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          build: BRAIN_BUILD,
        }),
      );
      // A new process starts on the selected code, never on a failed one.
      expect(i.descriptors.get(name)?.build).toBe(selected);
    } else {
      const bad: Fixture =
        move === "load" ? { ...next, throws: true } : move === "name" ? { ...next, name: "fabrika/other" } : next;
      const pad = move === "too_large" ? MOST + 1 : 0;
      const { digest, answer } = yield* install(i, `install_${n}`, bad, pad);
      expect(answer).toEqual({ _tag: "failed", reason: move });
      const added = code(i).slice(before);
      expect(added.map((e) => [e.tag, e.body.reason, e.body.hash])).toEqual([["code.failed", move, digest]]);
      expect(i.pushed, "a failed hash reaches no process").toHaveLength(pushes);
      failed.add(digest);

      if (move === "too_large") {
        expect(yield* i.run(i.p.code(digest)), "nothing stored").toBeNull();
      }
    }

    // Never selected, never pushed, never started on: a failed hash, also after a restart.
    for (const p of i.pushed) {
      expect(failed.has(p.hash), `pushed failed ${p.hash}`).toBe(false);
    }

    for (const d of i.descriptors.values()) {
      expect(failed.has(d.build), `${d.name} started on a failed hash`).toBe(false);
    }

    // The candidate check calls only describe(), never init, a step or a Cmd.
    for (const [id, calls] of i.isolates) {
      if (id.endsWith("/check")) {
        expect(
          calls.filter((c) => c !== "describe"),
          `${id} ran more than describe`,
        ).toEqual([]);
      }
    }
  }

  return { i, seen, selected, failed };
});

// edge: the control boundary answers with a platform Response.
const json = (response: Response) =>
  Effect.tryPromise({ try: (): Promise<unknown> => response.json(), catch: rejected });

describe("P15 slice 1: the brain installs and selects code", () => {
  it.live(
    "L4/L9: boot pushes finish before a later install so a delayed old push cannot replace the newly selected code",
    () =>
      law(
        (g) =>
          Effect.gen(function* () {
            const i = yield* instance(baseFixture());
            const pid = i.descriptors.get("counter:1")!.id;
            let current = baseFixture();
            const rounds = g(fc.integer, { min: 1, max: 4 });

            for (let n = 0; n < rounds; n++) {
              // Keep the process behind the selection so boot has a real swap to push.
              current = { ...current, k: current.k + g(fc.integer, { min: 1, max: 9 }) };
              i.refusing.add("counter:1");
              const { digest: was } = yield* install(i, `before_boot_order_${n}`, current);
              i.refusing.delete("counter:1");
              const entered = yield* Deferred.make<void>();
              const release = yield* Deferred.make<void>();
              i.swapGates.set(was, Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))));
              yield* i.restart;
              yield* Deferred.await(entered).pipe(Effect.timeout("1 second"));
              const before = i.completed.length;
              current = { ...current, k: current.k + g(fc.integer, { min: 1, max: 9 }) };
              const digest = yield* hash(sourceFor(current));
              const arrived = yield* Deferred.make<void>();
              i.swapGates.set(digest, Deferred.succeed(arrived, undefined).pipe(Effect.asVoid));
              const installing = yield* Effect.forkScoped(install(i, `boot_order_${n}`, current));
              const early = yield* Deferred.await(arrived).pipe(Effect.timeoutOption("30 millis"));
              expect(Option.isNone(early), "a later install cannot push while the boot push is held").toBe(true);
              yield* Deferred.succeed(release, undefined);
              const answer = yield* Fiber.join(installing);
              yield* Effect.suspend(() => Effect.succeed(i.completed.slice(before).some((p) => p.hash === was))).pipe(
                Effect.repeat({ until: Boolean, schedule: Schedule.spaced("1 millis") }),
                Effect.timeout("1 second"),
              );
              expect(answer.answer._tag).toBe("loaded");
              expect(i.completed.slice(before).map((p) => p.hash)).toEqual([was, digest]);
              expect(i.running.get(pid), "the last installed build keeps running after boot's delayed push").toBe(
                digest,
              );
              expect(code(i).at(-1)?.body.hash).toBe(digest);
              i.swapGates.delete(was);
              i.swapGates.delete(digest);
            }
          }),
        100,
      ),
    300_000,
  );

  // L4, lost push (A-Boot-Push), with ticket 762's pending starts. Plant: push the boot's swap to a
  // start before it is delivered; drop a failed boot swap without a log line.
  it.live(
    "L4: a start still pending at boot is delivered and then swapped to the selected code exactly once, and a swap that fails at boot is logged with its process and healed by the next boot",
    () =>
      law(
        (g) =>
          Effect.gen(function* () {
            const i = yield* instance(baseFixture());
            const start = (name: string) =>
              i.run(
                i.p.start(
                  Start.cases.first.make({ id: `start:${name}`, name, code: { program: PROGRAM, hash: i.builtHash } }),
                  origin,
                ),
              );
            // Starts the Project saved while their objects could not be reached: each stays pending.
            const late = Array.from({ length: g(fc.integer, { min: 1, max: 3 }) }, (_, n) => `late:${n}`);

            for (const name of late) {
              i.unreachable.add(name);
              expect(Exit.isFailure(yield* Effect.exit(start(name))), `${name}'s start is not delivered`).toBe(true);
            }

            for (let n = g(fc.integer, { min: 0, max: 2 }); n > 0; n--) {
              yield* start(`ready:${n}`);
            }

            // Saves that land while those starts are pending. An install may fail on a pending
            // object; the selection it wrote is what every process must reach.
            let current = baseFixture();
            let selected = i.builtHash;

            for (let n = g(fc.integer, { min: 1, max: 3 }); n > 0; n--) {
              current = { ...current, k: current.k + g(fc.integer, { min: 1, max: 9 }) };
              yield* Effect.exit(install(i, `pending_save_${n}`, current));
              selected = yield* hash(sourceFor(current));
            }

            expect(code(i).at(-1)?.body.hash, "the last save is selected").toBe(selected);
            // Every process the Project holds, read from its own table: a pending start has no object yet.
            const held = () =>
              i.db
                .prepare("SELECT process, value FROM dev_descriptors")
                .all()
                .map((row) => ({
                  pid: String(row["process"]),
                  name: Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ name: Schema.String })))(
                    row["value"],
                  ).name,
                }));
            const behind = () => held().filter(({ pid }) => i.running.get(pid) !== selected);
            const settled = (done: () => boolean, label: string) =>
              Effect.suspend(() => (done() ? Effect.void : Effect.fail(label))).pipe(
                Effect.retry(Schedule.spaced("5 millis")),
                Effect.timeoutOrElse({ duration: "5 seconds", orElse: () => Effect.die(new Error(label)) }),
              );
            const lines: Array<string> = [];
            const logged = Logger.layer([
              Logger.make((options) => {
                lines.push(Logger.formatJson.log(options));
              }),
            ]);
            i.unreachable.clear();
            const left = behind();
            expect(
              left.map(({ name }) => name),
              "every pending start is behind the selection",
            ).toEqual(expect.arrayContaining(late));
            const down = g(fc.boolean);

            if (down) {
              // Every swap of this boot fails. Each process left behind is named in a log line.
              i.swapGates.set(selected, Effect.die("the swap did not arrive"));
            }

            // The boot's deliveries are held on their way, so its swaps have time to overtake them.
            const entered = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();

            for (const name of late) {
              i.configureGates.set(
                name,
                Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
              );
            }

            const before = i.completed.length;
            const pushes = i.pushed.length;
            const restarting = yield* Effect.forkScoped(i.restart.pipe(Effect.provide(logged)));
            yield* Deferred.await(entered).pipe(
              Effect.timeoutOrElse({
                duration: "5 seconds",
                orElse: () => Effect.die(new Error("the boot never sent a pending start to its object")),
              }),
            );
            yield* Effect.sleep("30 millis");
            expect(
              i.pushed
                .slice(pushes)
                .filter((p) => late.includes(p.name))
                .map((p) => p.name),
              "no swap reaches a start before its delivery",
            ).toEqual([]);
            yield* Deferred.succeed(release, undefined);
            yield* Fiber.join(restarting);
            i.configureGates.clear();

            if (down) {
              yield* settled(
                () => left.every(({ pid }) => lines.some((line) => line.includes(pid))),
                "a failed boot swap left no log line for its process",
              );
              expect(behind(), "a failed swap leaves each process on its old code").toEqual(left);
              i.swapGates.delete(selected);
              yield* i.restart;
            }

            yield* settled(() => behind().length === 0, "a process stayed on its old code after the boot");
            expect(
              i.completed
                .slice(before)
                .map((p) => [p.name, p.hash])
                .toSorted(),
              "each process behind the selection is swapped once, a start pending at boot after its delivery",
            ).toEqual(left.map(({ name }) => [name, selected]).toSorted());
          }),
        50,
      ),
    300_000,
  );

  it.live(
    "L9/L12: first starts choose the current selection and retries keep their first answer and current policy across installs and reopens",
    () =>
      law(
        (g) =>
          Effect.gen(function* () {
            expect.hasAssertions();
            const i = yield* instance(baseFixture());
            let selected = i.builtHash;
            let current = baseFixture();
            const starts = new Map<
              string,
              {
                request: typeof Start.cases.first.Type;
                answer: Effect.Success<ReturnType<ProjectService["Service"]["start"]>>;
              }
            >();
            const steps = g(fc.integer, { min: 8, max: 20 });

            for (let n = 0; n < steps; n++) {
              const moves = ["install", "start", ...(starts.size > 0 ? ["retry", "reused", "reopen"] : [])];
              const move = moves[g(fc.nat, { max: moves.length - 1 })]!;

              if (move === "install") {
                current = {
                  ...current,
                  k: current.k + g(fc.integer, { min: 1, max: 9 }),
                  inputPersonOnly: !current.inputPersonOnly,
                  eventPersonOnly: !current.eventPersonOnly,
                };
                selected = (yield* install(i, `start_install_${n}`, current)).digest;
              } else if (move === "start") {
                const name = `fresh:${n}`;
                // A client still knows the built-in hash. The brain chooses the selection in its turn.
                const request = Start.cases.first.make({
                  id: `first_${n}`,
                  name,
                  code: { program: PROGRAM, hash: i.builtHash },
                });
                const answer = yield* i.run(i.p.start(request, origin));
                starts.set(name, { request, answer });
                expect(i.descriptors.get(name)?.build).toBe(selected);
                const entry = i.entries().find((e) => e.rev === answer.rev)!;
                expect(entry).toMatchObject({ tag: "started", body: { program: PROGRAM, hash: selected } });
                expect(code(i).some((e) => e.body.hash === selected && e.rev < answer.rev)).toBe(true);
              } else if (move === "reopen") {
                yield* i.restart;
              } else {
                const { request, answer } = [...starts.values()][g(fc.nat, { max: starts.size - 1 })]!;
                const before = i.entries();

                if (move === "retry") {
                  expect(yield* i.run(i.p.start(request, origin))).toEqual(answer);
                } else {
                  // Reusing the id with a different valid request must still be refused after selection changes.
                  const changed = Start.cases.first.make({ ...request, name: `${request.name}-other` });
                  expect(yield* i.run(i.p.start(changed, origin)).pipe(Effect.flip)).toMatchObject({
                    reason: "id_reused",
                  });
                }

                expect(i.entries()).toEqual(before);
              }

              yield* checkPolicies(i, n, "after");
            }
          }),
        100,
      ),
    300_000,
  );

  it.live(
    "L9/L12: a swapped fact publishes the running build and policy before a delayed install reply or a later process write",
    () =>
      law(
        (g) =>
          Effect.gen(function* () {
            const i = yield* instance(baseFixture());
            const pid = i.descriptors.get("counter:1")!.id;
            let current = baseFixture();
            const facts: Array<{ id: string; line: Parameters<ProjectService["Service"]["append"]>[2] }> = [];
            const steps = g(fc.integer, { min: 2, max: 5 });

            for (let n = 0; n < steps; n++) {
              const was = i.running.get(pid)!;
              current = {
                ...current,
                k: current.k + g(fc.integer, { min: 1, max: 9 }),
                inputPersonOnly: !current.inputPersonOnly,
                eventPersonOnly: !current.eventPersonOnly,
              };
              const digest = yield* hash(sourceFor(current));
              const published = yield* Deferred.make<void>();
              const reply = yield* Deferred.make<void>();
              const id = `code.swapped:publish_${n}`;
              const line = lineFor(
                { ...origin, build: digest },
                {
                  _tag: "code.swapped",
                  program: PROGRAM,
                  hash: digest,
                  was,
                },
              );
              i.swapReplies.set(
                digest,
                Effect.gen(function* () {
                  expect(yield* i.run(i.p.append(pid, id, line))).toMatchObject({ _tag: "placed" });
                  yield* Deferred.succeed(published, undefined);
                  yield* Deferred.await(reply);
                }),
              );
              const pending = yield* Effect.forkScoped(install(i, `publish_${n}`, current));
              yield* Deferred.await(published).pipe(Effect.timeout("2 seconds"));
              // The Process has changed code, but its swap RPC has not answered the Project yet.
              yield* checkPolicies(i, n, "before");

              if (facts.length > 0 && g(fc.boolean)) {
                const old = facts[g(fc.nat, { max: facts.length - 1 })]!;
                yield* i.run(i.p.append(pid, old.id, old.line));
                yield* checkPolicies(i, n, "after");
              }

              facts.push({ id, line });
              yield* Deferred.succeed(reply, undefined);
              expect((yield* Fiber.join(pending)).answer._tag).toBe("loaded");
              expect(i.entries().filter((e) => e.id === id)).toHaveLength(1);
              i.swapReplies.delete(digest);
            }
          }),
        100,
      ),
    300_000,
  );

  it.live(
    "L10: installing a program pushes only its live processes, leaving every other program's running hash alone",
    () =>
      law(
        (g) =>
          Effect.gen(function* () {
            const other = {
              ...baseFixture(),
              ...g(() => fixtures),
              name: `p15/${g(() => fc.stringMatching(/^[a-z]{1,8}$/))}`,
            };
            const i = yield* instance(baseFixture(), [other]);
            const variants = new Map([
              [PROGRAM, baseFixture()],
              [other.name, other],
            ]);
            const count = g(fc.integer, { min: 2, max: 4 });

            for (let n = 1; n < count; n++) {
              const program = [...variants.keys()][g(fc.nat, { max: variants.size - 1 })]!;
              const source = sourceFor(variants.get(program)!);
              yield* i.run(
                i.p.start(
                  Start.cases.first.make({
                    id: `sibling_${n}`,
                    name: `sibling:${n}`,
                    code: { program, hash: yield* hash(source) },
                  }),
                  {
                    by: "SHA256:brain",
                    for: "brain",
                    sentAt: "2026-11-11T00:00:00Z",
                    seen: 0,
                    parent: null,
                    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                    build: BRAIN_BUILD,
                  },
                ),
              );
            }

            // Always give the second program a process too. The remaining generated names may use either.
            yield* i.run(
              i.p.start(
                Start.cases.first.make({
                  id: "other_boot",
                  name: "other:1",
                  code: { program: other.name, hash: yield* hash(sourceFor(other)) },
                }),
                {
                  by: "SHA256:brain",
                  for: "brain",
                  sentAt: "2026-11-11T00:00:00Z",
                  seen: 0,
                  parent: null,
                  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                  build: BRAIN_BUILD,
                },
              ),
            );
            const steps = g(fc.integer, { min: 1, max: 5 });

            for (let n = 0; n < steps; n++) {
              const program = [...variants.keys()][g(fc.nat, { max: variants.size - 1 })]!;
              const previous = variants.get(program)!;
              const next = { ...previous, k: previous.k + g(fc.integer, { min: 1, max: 9 }) };
              const source = sourceFor(next);
              const digest = yield* hash(source);
              i.sources.set(digest, source);
              const before = new Map(i.running);
              const pushes = i.pushed.length;
              const answer = yield* i.run(
                i.p.codeInstall({ id: `isolated_${n}`, program, hash: digest, source, from: "watch" }),
              );
              expect(answer._tag).toBe("loaded");
              const matching = [...i.descriptors.values()].filter((d) => d.program === program);
              expect(
                i.pushed
                  .slice(pushes)
                  .map((p) => p.name)
                  .toSorted(),
              ).toEqual(matching.map((d) => d.name).toSorted());

              for (const d of i.descriptors.values()) {
                expect(i.running.get(d.id)).toBe(d.program === program ? digest : before.get(d.id));
              }

              variants.set(program, next);
            }
          }),
        20,
      ),
    300_000,
  );

  it.live(
    "L3/L4: an install waiting for a process turn lets that turn finish its Project write, then both calls answer once",
    () =>
      law(
        (g) =>
          Effect.gen(function* () {
            const i = yield* instance(baseFixture());
            const pid = i.descriptors.get("counter:1")!.id;
            let current = baseFixture();
            const steps = g(fc.integer, { min: 1, max: 4 });

            for (let n = 0; n < steps; n++) {
              const was = i.running.get(pid)!;
              current = { ...current, k: current.k + g(fc.integer, { min: 1, max: 9 }) };
              const digest = yield* hash(sourceFor(current));
              const waiting = yield* Deferred.make<void>();
              const finished = yield* Deferred.make<void>();
              // A Process RPC waits for its in-flight turn. That turn must still call Project.own.
              i.swapGates.set(
                digest,
                Deferred.succeed(waiting, undefined).pipe(Effect.andThen(Deferred.await(finished))),
              );
              const pending = yield* Effect.forkScoped(install(i, `concurrent_${n}`, current));
              yield* Deferred.await(waiting).pipe(Effect.timeout("2 seconds"));
              const id = `turn_finished_${n}`;
              const result = yield* i
                .run(i.p.own(pid, id, `app/${pid}`, { _tag: "changed", count: n }))
                .pipe(
                  Effect.ensuring(Deferred.succeed(finished, undefined)),
                  Effect.andThen(Fiber.join(pending)),
                  Effect.timeoutOption("1 second"),
                );
              expect(
                Option.isSome(result),
                "install must not hold the Project turn while awaiting a Process turn",
              ).toBe(true);

              if (Option.isNone(result)) {
                return;
              }

              expect(result.value.answer).toEqual({
                _tag: "loaded",
                processes: [{ name: "counter:1", outcome: { _tag: "swapped", was } }],
              });
              expect(i.entries().filter((e) => e.id === id)).toHaveLength(1);
              expect(code(i).filter((e) => e.id === `concurrent_${n}`)).toHaveLength(1);
              expect(i.running.get(pid)).toBe(digest);
              i.swapGates.delete(digest);
            }
          }),
        100,
      ),
    300_000,
  );

  it.live(
    "L6/L9: reopening with changed built-ins keeps every recorded hash readable, including an initial bundle a process refused to leave",
    () =>
      law(
        (g) =>
          Effect.gen(function* () {
            const i = yield* instance(baseFixture());
            let selected = i.builtHash;
            let current = baseFixture();
            const steps = g(fc.integer, { min: 1, max: 5 });

            for (let n = 0; n < steps; n++) {
              // Only hashes that this Project has loaded can be selected or kept by a Process.
              if (g(fc.boolean)) {
                i.refusing.add("counter:1");
                current = { ...current, k: current.k + g(fc.integer, { min: 1, max: 9 }) };
                const next = yield* install(i, `before_reopen_${n}`, current);
                expect(next.answer._tag).toBe("loaded");
                selected = next.digest;
              }

              const replacement = { ...current, k: current.k + g(fc.integer, { min: 10, max: 99 }) };
              const before = code(i);
              const pushes = i.pushed.length;
              const expected = i.running.get(i.descriptors.get("counter:1")!.id) === selected ? [] : [selected];
              // Check persistence before reopening too, so a missing bundle reports its cause.
              const recorded = new Set(before.filter((e) => e.tag === "code.loaded").map((e) => String(e.body.hash)));

              for (const digest of recorded) {
                expect(
                  yield* i.run(i.p.code(digest)),
                  "every loaded bundle is kept by hash before the built-in table changes",
                ).toEqual({
                  hash: digest,
                  source: i.sources.get(digest),
                });
              }

              yield* i.reopen(replacement);
              expect(code(i)).toEqual(before);
              expect(i.pushed.slice(pushes).map((p) => p.hash)).toEqual(expected);

              for (const digest of recorded) {
                expect(yield* i.run(i.p.code(digest))).toEqual({ hash: digest, source: i.sources.get(digest) });
              }

              const kept = i.running.get(i.descriptors.get("counter:1")!.id)!;
              expect(recorded.has(kept)).toBe(true);
              yield* checkPolicies(i, n, "after");
            }
          }),
        100,
      ),
    300_000,
  );

  // L8, p75. Plant: select before describe; call init on the candidate; keep a failed hash after a reopen.
  it.live(
    "L8: each of the five failures writes one code.failed with its closed reason and is never selected, pushed or started on, also after a restart; the check calls only describe()",
    () =>
      Effect.gen(function* () {
        const seen = new Set<string>();
        yield* law(
          (g) =>
            Effect.gen(function* () {
              const { seen: reached } = yield* walk(g, g(fc.integer, { min: 1, max: 10 }), false);

              for (const move of reached) {
                seen.add(move);
              }
            }),
          50,
        );

        for (const move of ["good", "same", "bundle", "compiler", "load", "name", "too_large", "restart"]) {
          expect(seen.has(move), `the walk reaches ${move}`).toBe(true);
        }
      }),
    300_000,
  );

  // L9, p76. Plant: step before code.loaded is appended; stamp the brain's build on a process record.
  it.live(
    "L9: every build a process starts on or is pushed has an earlier code.loaded, from boot or watch; the brain's own entries keep the brain's build",
    () =>
      law(
        (g) =>
          Effect.gen(function* () {
            const { i } = yield* walk(g, g(fc.integer, { min: 1, max: 10 }), true);

            const entries = i.entries();
            const loaded = entries.filter((e) => e.stream === "gateway/code" && e.tag === "code.loaded");

            for (const e of loaded) {
              expect(["boot", "watch"]).toContain(e.body.from);
            }

            const earlier = (digest: string, rev: number) => loaded.some((l) => l.body.hash === digest && l.rev < rev);

            // The built-in program's first load is from the boot, with nothing before it.
            expect(loaded[0]?.body).toMatchObject({ program: PROGRAM, hash: i.builtHash, was: null, from: "boot" });

            for (const e of entries) {
              const start = e.body.code as { readonly hash?: string } | undefined;

              if (e.stream.startsWith("processes/") && typeof start?.hash === "string") {
                expect(earlier(start.hash, e.rev), `${e.stream} ${e.id} starts on ${start.hash}`).toBe(true);
              }

              if (e.stream.startsWith("gateway/")) {
                expect(e.build, `${e.stream} ${e.id} is the brain's own entry`).toBe(BRAIN_BUILD);
              } else if (e.stream.startsWith("app/")) {
                expect(earlier(e.build, e.rev), "a process record's build was loaded first").toBe(true);
              }
            }

            for (const [index, p] of i.pushed.entries()) {
              expect(
                i.loadedAtPush[index],
                `pushed ${p.hash} already has a code.loaded when the Process receives it`,
              ).toContain(p.hash);
            }
          }),
        50,
      ),
    300_000,
  );

  // L12. Plant: trust the caller's hash; route `codeInstall` through the door.
  it.live(
    "L12: install and failed answer only on the control socket's project target; a source that does not hash to its name stores nothing; a program's gateway write is refused; a repeated install id appends once and policies follow each process's checkpoint after a restart",
    () =>
      Effect.gen(function* () {
        const seen = new Set<string>();
        yield* law(
          (g) =>
            Effect.gen(function* () {
              const builtIn = baseFixture();
              const i = yield* instance(builtIn);

              const steps = g(fc.integer, { min: 1, max: 8 });

              for (let n = 0; n < steps; n++) {
                const moves = ["control", "wrong_target", "no_token", "mismatch", "gateway_write", "repeat", "policy"];
                const move = moves[g(fc.nat, { max: moves.length - 1 })]!;
                seen.add(move);
                const fixture = { ...builtIn, ...g(() => fixtures) };
                const source = sourceFor(fixture);
                const digest = yield* hash(source);
                i.sources.set(digest, source);
                const before = code(i).length;
                const body = { id: `install_${n}`, program: PROGRAM, hash: digest, source, from: "watch" };
                const ask = (target: string, method: string, bearer: string | null) =>
                  control(
                    new Request("http://127.0.0.1/control", {
                      method: "POST",
                      headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
                      body: JSON.stringify({ target, project: "project-test", name: "", method, args: [body] }),
                    }),
                    i.env,
                    Redacted.make(TOKEN),
                    {},
                  );

                if (move === "control") {
                  const response = yield* ask("project", "codeInstall", TOKEN);
                  expect(response.status).toBe(200);
                  const answer = ((yield* json(response)) as { value: { _tag: string } }).value;
                  expect(["loaded", "same"]).toContain(answer._tag);
                } else if (move === "wrong_target") {
                  const target = g(() => fc.constantFrom("process", "record"));
                  const method = g(() => fc.constantFrom("codeInstall", "codeFailed"));
                  const response = yield* ask(target, method, TOKEN);
                  expect(yield* json(response)).toEqual({ error: { reason: "unknown_method" } });
                  expect(code(i)).toHaveLength(before);
                } else if (move === "no_token") {
                  // A header value a client can send: printable token characters, or no header at all.
                  const bearer = g(() =>
                    fc.option(
                      fc.stringMatching(/^[A-Za-z0-9._~-]{1,40}$/).filter((s) => s !== TOKEN),
                      { nil: null },
                    ),
                  );
                  expect((yield* ask("project", "codeInstall", bearer)).status).toBe(403);
                  expect(code(i)).toHaveLength(before);
                } else if (move === "mismatch") {
                  // A real hash from another source: the bytes do not hash to the name they carry.
                  const other = yield* hash(sourceFor({ ...fixture, k: fixture.k + 100 }));
                  const exit = yield* i.run(Effect.exit(i.p.codeInstall({ ...body, hash: other, from: "watch" })));
                  expect(Exit.isFailure(exit), "the install is refused").toBe(true);
                  expect(yield* i.run(i.p.code(other)), "nothing stored").toBeNull();
                  expect(code(i), "no fact").toHaveLength(before);
                } else if (move === "gateway_write") {
                  const info = yield* i.run(i.p.info);
                  const pid = info[0]!.process;
                  const stream = g(() => fc.constantFrom("gateway/code", "gateway/brain", "gateway/x"));
                  const exit = yield* i.run(
                    Effect.exit(
                      i.p.own(pid, `own_${n}`, stream, { _tag: "code.loaded", program: PROGRAM, hash: digest }),
                    ),
                  );
                  expect(Exit.isFailure(exit), `a program's write to ${stream}`).toBe(true);
                  expect(code(i)).toHaveLength(before);
                } else if (move === "policy") {
                  // Two names can keep different code for one program: one accepts and one refuses.
                  if (i.descriptors.size < 2) {
                    yield* i.run(
                      i.p.start(
                        Start.cases.first.make({
                          id: "policy_sibling",
                          name: "counter:2",
                          code: { program: PROGRAM, hash: i.builtHash },
                        }),
                        {
                          by: "SHA256:brain",
                          for: "brain",
                          sentAt: "2026-11-11T00:00:00Z",
                          seen: 0,
                          parent: null,
                          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                          build: BRAIN_BUILD,
                        },
                      ),
                    );
                  }

                  const names = [...i.descriptors.keys()];
                  const refuses = names[g(fc.nat, { max: names.length - 1 })]!;
                  const previous = new Map(i.running);
                  i.refusing.add(refuses);
                  const refusedId = i.descriptors.get(refuses)!.id;
                  const kept = readFixture(i.sources.get(i.running.get(refusedId)!)!);
                  const next = {
                    ...fixture,
                    k: n + 100,
                    inputPersonOnly: !kept.inputPersonOnly,
                    eventPersonOnly: !kept.eventPersonOnly,
                  };
                  const installed = yield* install(i, `policy_${n}`, next);
                  expect(installed.answer._tag).toBe("loaded");

                  for (const [name, descriptor] of i.descriptors) {
                    expect(i.running.get(descriptor.id)).toBe(
                      name === refuses ? previous.get(descriptor.id) : installed.digest,
                    );
                  }

                  yield* checkPolicies(i, n, "before");
                  yield* i.restart;
                  yield* checkPolicies(i, n, "after");
                  i.refusing.clear();
                  seen.add("policy_reopen");
                } else {
                  const id = `install_again_${n}`;
                  yield* i.run(i.p.codeInstall({ ...body, id, from: "watch" }));
                  const after = code(i).length;
                  expect(yield* i.run(i.p.codeInstall({ ...body, id, from: "watch" }))).toEqual({
                    _tag: "same",
                  });
                  expect(code(i)).toHaveLength(after);
                }

                // Whoever called, every entry on gateway/code is the brain's own.
                expect(code(i).filter((e) => e.build !== BRAIN_BUILD)).toEqual([]);
              }
            }),
          100,
        );

        for (const move of [
          "control",
          "wrong_target",
          "no_token",
          "mismatch",
          "gateway_write",
          "repeat",
          "policy_reopen",
        ]) {
          expect(seen.has(move), `the walk reaches ${move}`).toBe(true);
        }
      }),
    300_000,
  );
});
