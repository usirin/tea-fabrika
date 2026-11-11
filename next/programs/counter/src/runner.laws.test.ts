// p22's real counter belongs here: the library's exam forbids importing a program from a library test.
// Uses P11's same injected contracts, actual Ledger.sql and ProcessStore.sql, and no Cmd handlers.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Id } from "@kampus/libfabrika";
import { Writer } from "@kampus/libfabrika/access/SessionManager";
import { Doorbell } from "@kampus/libfabrika/ledger/Ledger";
import * as LedgerSql from "@kampus/libfabrika/ledger/LedgerSql";
import { LedgerTransaction } from "@kampus/libfabrika/ledger/LedgerTransaction";
import { Mailbox } from "@kampus/libfabrika/processes/Mailbox";
import { Owner, Recipient, Start } from "@kampus/libfabrika/processes/Process";
import { ProcessManager } from "@kampus/libfabrika/processes/ProcessManager";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Effect, Layer, Result, Schema, Stream } from "effect";
import * as fc from "fast-check";

const PROCESS: string = Effect.runSync(
  Id.Generator.use((ids) => ids.next(Id.Process)).pipe(Effect.provide(Id.Generator.layer)),
);

const NAME = "counter:1";
// P40: the counter's program identity in the core pack (0083). Its registered name stays NAME.
const PROGRAM = "fabrika/counter";
const LIBRARY = "@kampus/libfabrika"; // Missing P11 exports must not prevent collecting the laws.
const SEED = 119120;
const folder = mkdtempSync(join(tmpdir(), "p11-counter-"));
const opened: DatabaseSync[] = [];

afterAll(() => {
  for (const db of opened) {
    if (db.isOpen) {
      db.close();
    }
  }

  rmSync(folder, { recursive: true, force: true });
});

type Update =
  | { type: "whole"; rev: number; view: unknown }
  | {
      type: "patch";
      base: number;
      rev: number;
      patch: ReadonlyArray<{ op: string; path: string; value?: unknown }>;
    };

type Runner = {
  readonly open: (client: string) => Effect.Effect<{ rev: number; view: unknown }, unknown>;
  readonly msg: (input: unknown) => Effect.Effect<{ _tag: string; reason?: string }, unknown>;
};

const reconstruct = (before: unknown, change: Update): unknown => {
  if (change.type === "whole") {
    return structuredClone(change.view);
  }

  let root = structuredClone(before);

  for (const p of change.patch) {
    if (p.path === "") {
      root = structuredClone(p.value);
      continue;
    }

    const keys = p.path
      .slice(1)
      .split("/")
      .map((k) => k.replaceAll("~1", "/").replaceAll("~0", "~"));
    let target = root;

    for (const key of keys.slice(0, -1)) {
      target = Reflect.get(Object(target), key);
    }

    if (p.op === "remove") {
      Reflect.deleteProperty(Object(target), keys.at(-1)!);
    } else {
      Reflect.set(Object(target), keys.at(-1)!, structuredClone(p.value));
    }
  }

  return root;
};

describe("p22 real counter in the runner", () => {
  it("loads a constructed counter and returns typed load failures for broken modules", async () => {
    const { counter } = await import("./program.ts");
    const { ProgramDown, ProgramLoader }: typeof import("@kampus/libfabrika") = await import(LIBRARY);
    const malformed = fc.option(
      fc.oneof(
        fc
          .constantFrom("name", "machine", "state", "msg", "view", "refuse", "inputs", "outputs", "writes", "wake")
          .map((field) => {
            const raw: Record<string, unknown> = { ...counter };
            delete raw[field];
            return raw;
          }),
        fc.jsonValue().map((bad) => ({ ...counter, msg: bad })),
        fc
          .tuple(fc.constantFrom("refuse", "wake"), fc.jsonValue())
          .map(([field, bad]) => ({ ...counter, [field]: bad })),
      ),
      { nil: null },
    );
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          name: fc.string().map((s) => `broken-${s}`),
          count: fc.integer(),
          broken: malformed,
        }),
        async ({ name, count, broken }) => {
          await Effect.runPromise(
            Effect.gen(function* () {
              const loader = yield* ProgramLoader;
              const healthy = yield* loader.load(PROGRAM);
              expect(healthy.stepper.program.machine).toBe(counter.machine);
              expect(healthy.stepper.init({ count })).toMatchObject({ _tag: "stepped", view: { count } });
              const result = yield* Effect.result(loader.load(name));
              expect(Result.isFailure(result)).toBe(true);

              if (Result.isFailure(result)) {
                expect(Schema.is(ProgramDown)(result.failure)).toBe(true);
                expect(result.failure.reason).toBe("load");
              }
            }).pipe(Effect.provide(ProgramLoader.layer({ [PROGRAM]: counter, [name]: broken }, {}))),
          );
        },
      ),
      { seed: SEED, numRuns: 100 },
    );
  });
  it("plant, skip first letter or patch the wrong base: wake and every watcher reproduce the counter", async () => {
    const { counter } = await import("./program.ts");
    const A: typeof import("@kampus/libfabrika") = await import(LIBRARY);
    const C = await import("@kampus/libfabrika/runtime/ProcessStore");
    let ledgerDb = new DatabaseSync(join(folder, "ledger.db"));
    opened.push(ledgerDb);
    let storeDb = new DatabaseSync(join(folder, "process.db"));
    opened.push(storeDb);
    // Ticket 402: the brain's process table, in its own ledger, survives the wake too.
    let managerDb = new DatabaseSync(join(folder, "manager.db"));
    opened.push(managerDb);
    const seen = new Map<string, { rev: number; view: unknown }>();
    const expected = Schema.Struct({ count: Schema.Int });
    const data = () =>
      LedgerSql.layer(nodeSql(ledgerDb), { reader: "counter-law" }).pipe(
        Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
      );
    const layer = () => {
      const checked = Layer.effect(
        A.CheckedWriter,
        Effect.gen(function* () {
          const mailbox = yield* Mailbox;
          return {
            append: (i: { id: string; envelope: { input: unknown }; sentAt: string; seen: number }) =>
              mailbox.send(NAME, i.id, i.envelope.input, {
                by: "SHA256:person",
                for: "person",
                sentAt: i.sentAt,
                seen: i.seen,
                parent: null,
                traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
                build: "counter-build",
              }),
            commit: () => Effect.die("counter has no write Cmd"),
            own: () => Effect.die("counter has no own Cmd"),
          };
        }),
      );
      // Ticket 402: every runner is supervised. The real manager's first start names PROCESS; a
      // wake finds it already live. Receipts live in the same Sql as ProcessStore.
      const from = {
        by: "SHA256:brain",
        for: "brain",
        sentAt: "2026-11-08T00:00:00Z",
        seen: 0,
        parent: null,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        build: "counter-build",
      };
      const manager = Layer.effectDiscard(
        ProcessManager.use((m) =>
          m.status(NAME).pipe(
            Effect.catch(() =>
              m.start(
                Start.cases.first.make({
                  id: `boot:${NAME}`,
                  name: NAME,
                  code: { program: PROGRAM, hash: "counter-build" },
                }),
                from,
              ),
            ),
          ),
        ).pipe(Effect.orDie),
      ).pipe(
        Layer.provideMerge(
          ProcessManager.layer(
            {
              by: "SHA256:brain",
              owner: Owner.cases.brain.make({}),
              recipient: Recipient.cases.client.make({ client: "brain", session: PROCESS }),
            },
            Effect.succeed(PROCESS),
          ),
        ),
        Layer.provide(
          LedgerTransaction.layer(nodeSql(managerDb)).pipe(
            Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
          ),
        ),
      );
      return A.ProgramRunner.layer(
        {
          id: PROCESS,
          name: NAME,
          program: PROGRAM,
          build: "counter-build",
          owner: Writer.cases.person.make({ key: "SHA256:person", for: "person" }),
        },
        { recovery: { sql: nodeSql(storeDb), name: NAME, capacity: 1024 ** 3 } },
      ).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            manager,
            A.ProgramLoader.layer({ [PROGRAM]: counter }, {}),
            C.ProcessStore.layer(nodeSql(storeDb), { process: PROCESS }),
            checked,
            Layer.succeed(A.WatcherManager, {
              publish: (client: string, update: Update) =>
                Effect.sync(() => {
                  const prior = seen.get(client);
                  expect(update.type === "whole" || update.base === prior?.rev).toBe(true);
                  seen.set(client, { rev: update.rev, view: reconstruct(prior?.view, update) });
                }),
            }),
            Layer.succeed(A.Alarm, { set: () => Effect.void }),
            Layer.succeed(A.Recording, { flush: Effect.void }),
          ).pipe(Layer.provideMerge(Mailbox.layer.pipe(Layer.provideMerge(data())))),
        ),
      );
    };
    await Effect.runPromise(
      Effect.gen(function* () {
        const r: Runner = yield* A.ProgramRunner;
        yield* r.open("a");

        for (let n = 1; n <= 12; n++) {
          if (n === 5) {
            yield* r.open("b");
          }

          yield* r.msg({
            id: `counter-${n}`,
            envelope: {
              id: `input_0000000000e0080000000000${n.toString(16).padStart(2, "0")}`,
              by: Writer.cases.person.make({ key: "SHA256:person", for: "person" }),
              arrivedAt: n,
              input: { type: "inc" },
            },
            sentAt: "writer clock",
            seen: 0,
            span: { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" },
          });

          for (const state of seen.values()) {
            expect(Schema.decodeUnknownSync(expected)(state.view)).toEqual({ count: n });
          }
        }

        expect((yield* r.open("inspect")).view).toEqual({ count: 12 });
        expect(yield* Stream.runCollect((yield* Mailbox).receive(NAME, 0))).toHaveLength(12);
      }).pipe(Effect.provide(layer())),
    );
    ledgerDb.close();
    storeDb.close();
    managerDb.close();
    ledgerDb = new DatabaseSync(join(folder, "ledger.db"));
    opened.push(ledgerDb);
    storeDb = new DatabaseSync(join(folder, "process.db"));
    opened.push(storeDb);
    managerDb = new DatabaseSync(join(folder, "manager.db"));
    opened.push(managerDb);
    await Effect.runPromise(
      Effect.gen(function* () {
        const r: Runner = yield* A.ProgramRunner;
        expect((yield* r.open("after-wake")).view).toEqual({ count: 12 });
      }).pipe(Effect.provide(layer())),
    );
  });
  it.effect.prop(
    "plant, guess a program: the in-process loader returns no_program",
    { generated: Schema.String.check(Schema.makeFilter((name) => name !== PROGRAM && name !== "counter")) },
    ({ generated }) =>
      Effect.forEach(
        ["missing", generated],
        (value) =>
          Effect.promise(async () => {
            const { counter } = await import("./program.ts");
            const { ProgramLoader }: typeof import("@kampus/libfabrika") = await import(LIBRARY);
            await Effect.runPromise(
              Effect.gen(function* () {
                const loader = yield* ProgramLoader;
                expect(yield* Effect.flip(loader.load(value))).toMatchObject({
                  reason: "no_program",
                });
              }).pipe(Effect.provide(ProgramLoader.layer({ [PROGRAM]: counter }, {}))),
            );
          }),
        { concurrency: 1, discard: true },
      ),
    { arbitrary: { seed: 119120, runs: 12 } },
  );
});

// P40 slice 1. The counter runs under its declared identity: the loader's key and every recorded
// process fact name `counter.name`, which is `fabrika/counter`, while its registered name stays a
// process name. The folders and databases below are opened in a scope and given back by it.
const scopedFolder = Effect.acquireRelease(
  Effect.sync(() => mkdtempSync(join(tmpdir(), "p40-counter-"))),
  (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
);

const scopedDb = (file: string) =>
  Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(file)),
    (db) => Effect.sync(() => db.isOpen && db.close()),
  );

const brainFrom = {
  by: "SHA256:brain",
  for: "brain",
  sentAt: "2026-11-11T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "counter-build",
};

const nextProcess = Id.Generator.use((ids) => ids.next(Id.Process)).pipe(Effect.provide(Id.Generator.layer));

const managerLayer = (db: DatabaseSync) =>
  ProcessManager.layer(
    {
      by: "SHA256:brain",
      owner: Owner.cases.brain.make({}),
      recipient: Recipient.cases.client.make({ client: "brain", session: PROCESS }),
    },
    nextProcess,
  ).pipe(
    Layer.provide(
      LedgerTransaction.layer(nodeSql(db)).pipe(Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void }))),
    ),
  );

describe("P40 the counter under its qualified identity", () => {
  it("L7: the counter keeps its inputs and count across every reopen, recorded as fabrika/counter", async () => {
    const { counter } = await import("./program.ts");
    const A: typeof import("@kampus/libfabrika") = await import(LIBRARY);
    const C = await import("@kampus/libfabrika/runtime/ProcessStore");
    // One session of the runner over the folder's saved files: the declared identity is what the
    // loader serves and what the process is started with, as the brain's bootstrap does.
    const session = (folder: string) =>
      Effect.gen(function* () {
        const ledgerDb = yield* scopedDb(join(folder, "ledger.db"));
        const storeDb = yield* scopedDb(join(folder, "process.db"));
        const managerDb = yield* scopedDb(join(folder, "manager.db"));
        const checked = Layer.effect(
          A.CheckedWriter,
          Effect.gen(function* () {
            const mailbox = yield* Mailbox;
            return {
              append: (i: { id: string; envelope: { input: unknown }; sentAt: string; seen: number }) =>
                mailbox.send(NAME, i.id, i.envelope.input, {
                  ...brainFrom,
                  by: "SHA256:person",
                  for: "person",
                  sentAt: i.sentAt,
                  seen: i.seen,
                }),
              commit: () => Effect.die("counter has no write Cmd"),
              own: () => Effect.die("counter has no own Cmd"),
            };
          }),
        );
        const manager = Layer.effectDiscard(
          ProcessManager.use((m) =>
            m.status(NAME).pipe(
              Effect.catch(() =>
                m.start(
                  Start.cases.first.make({
                    id: `boot:${NAME}`,
                    name: NAME,
                    code: { program: counter.name, hash: "counter-build" },
                  }),
                  brainFrom,
                ),
              ),
            ),
          ).pipe(Effect.orDie),
        ).pipe(Layer.provideMerge(managerLayer(managerDb)));
        const process = yield* Effect.gen(function* () {
          const m = yield* ProcessManager;
          return (yield* m.status(NAME)).state.process;
        }).pipe(Effect.provide(manager), Effect.orDie);
        return A.ProgramRunner.layer(
          {
            id: process,
            name: NAME,
            program: counter.name,
            build: "counter-build",
            owner: Writer.cases.person.make({ key: "SHA256:person", for: "person" }),
          },
          { recovery: { sql: nodeSql(storeDb), name: NAME, capacity: 1024 ** 3 } },
        ).pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              managerLayer(managerDb),
              A.ProgramLoader.layer({ [counter.name]: counter }, {}),
              C.ProcessStore.layer(nodeSql(storeDb), { process }),
              checked,
              Layer.succeed(A.WatcherManager, { publish: () => Effect.void }),
              Layer.succeed(A.Alarm, { set: () => Effect.void }),
              Layer.succeed(A.Recording, { flush: Effect.void }),
            ).pipe(
              Layer.provideMerge(
                Mailbox.layer.pipe(
                  Layer.provideMerge(
                    LedgerSql.layer(nodeSql(ledgerDb), { reader: "counter-law" }).pipe(
                      Layer.provide(Layer.succeed(Doorbell, { ring: () => Effect.void })),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
      });
    const inputs = ["inc", "dec", "reset"] as const;
    // The walk: each step sends an input the counter declares, or, once a process has started,
    // reopens it from its saved files. The count the person expects is the counter's own rule.
    await fc.assert(
      fc.asyncProperty(fc.array(fc.nat(), { minLength: 2, maxLength: 24 }), async (tape) => {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const folder = yield* scopedFolder;
              let count = 0,
                sent = 0,
                reopened = 0,
                at = 0;

              while (at < tape.length || reopened === 0 || sent === 0) {
                // One session runs until the walk asks to reopen.
                yield* Effect.scoped(
                  Effect.gen(function* () {
                    const r: Runner = yield* A.ProgramRunner;
                    expect((yield* r.open(`open-${reopened}`)).view, "the saved count comes back").toEqual({ count });

                    for (; at < tape.length;) {
                      const n = tape[at++]!;

                      if (sent > 0 && n % 4 === 3) {
                        break;
                      }

                      const type = inputs[n % 3]!;
                      sent++;
                      yield* r.msg({
                        id: `p40-${sent}`,
                        envelope: {
                          id: `input_0000000000e0080000000000${sent.toString(16).padStart(2, "0")}`,
                          by: Writer.cases.person.make({ key: "SHA256:person", for: "person" }),
                          arrivedAt: sent,
                          input: { type },
                        },
                        sentAt: "writer clock",
                        seen: 0,
                        span: { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" },
                      });
                      count = type === "inc" ? count + 1 : type === "dec" ? count - 1 : 0;
                      expect((yield* r.open(`after-${sent}`)).view).toEqual({ count });
                    }

                    if (sent === 0) {
                      sent++;
                      yield* r.msg({
                        id: `p40-${sent}`,
                        envelope: {
                          id: `input_0000000000e0080000000000${sent.toString(16).padStart(2, "0")}`,
                          by: Writer.cases.person.make({ key: "SHA256:person", for: "person" }),
                          arrivedAt: sent,
                          input: { type: "inc" },
                        },
                        sentAt: "writer clock",
                        seen: 0,
                        span: { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" },
                      });
                      count++;
                    }

                    expect(yield* Stream.runCollect((yield* Mailbox).receive(NAME, 0))).toHaveLength(sent);
                    // The process facts name the qualified program under the registered name.
                    const info = yield* (yield* ProcessManager).info;
                    expect(info.map((p) => ({ name: p.name, program: p.program }))).toEqual([
                      { name: NAME, program: PROGRAM },
                    ]);
                  }).pipe(Effect.provide(yield* session(folder))),
                );
                reopened++;
              }

              expect(reopened).toBeGreaterThan(0);
              expect(sent).toBeGreaterThan(0);
            }),
          ),
        );
      }),
      { seed: SEED, numRuns: 20 },
    );
  });
  it("L8: a registered name stays a process name, whatever the program identity", async () => {
    const { counter } = await import("./program.ts");
    // Ways to bend a current registered name toward a program identity. Each holds a slash.
    const bends: ReadonlyArray<(name: string) => string> = [
      () => counter.name,
      () => PROGRAM,
      (name) => `fabrika/${name}`,
      (name) => `${name}/x`,
      (name) => name.replace(/[:.]/, "/"),
      () => `${counter.name}:1`,
    ];
    // The walk: each step starts the counter's code under a fresh valid registered name, or tries
    // a current name bent into a slashed one. A bent start is refused and records nothing.
    await fc.assert(
      fc.asyncProperty(fc.array(fc.nat(), { minLength: 2, maxLength: 16 }), async (tape) => {
        await Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const m = yield* ProcessManager;
              const names: string[] = [];
              let refused = 0;

              for (const [i, n] of tape.entries()) {
                if (i % 2 === 0 || names.length === 0) {
                  const name = n % 2 === 0 ? `counter:${names.length + 1}` : `tally-${n % 97}.${names.length}`;
                  yield* m.start(
                    Start.cases.first.make({ id: `start-${i}`, name, code: { program: counter.name, hash: "h" } }),
                    brainFrom,
                  );
                  names.push(name);
                } else {
                  const bent = bends[n % bends.length]!(names[Math.floor(n / bends.length) % names.length]!);
                  const result = yield* Effect.result(
                    m.start(
                      Start.cases.first.make({
                        id: `start-${i}`,
                        name: bent,
                        code: { program: counter.name, hash: "h" },
                      }),
                      brainFrom,
                    ),
                  );
                  expect(result, `${bent} is refused`).toMatchObject({
                    _tag: "Failure",
                    failure: { _tag: "ProcessError", reason: "bad_name" },
                  });
                  refused++;
                }

                const info = yield* m.info;
                expect(info.map((p) => p.name).sort()).toEqual([...names].sort());
                expect(info.every((p) => p.program === PROGRAM)).toBe(true);
              }

              expect(names.length).toBeGreaterThan(0);
              expect(refused).toBeGreaterThan(0);
            }).pipe(Effect.provide(Layer.unwrap(scopedDb(":memory:").pipe(Effect.map(managerLayer))))),
          ),
        );
      }),
      { seed: SEED, numRuns: 50 },
    );
  });
});
