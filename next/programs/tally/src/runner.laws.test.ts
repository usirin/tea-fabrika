// Tally, next/: its state survives a restart. Copied from the counter's runner law, the only
// example of a runner wired by hand: real Ledger.sql and ProcessStore.sql, no Cmd handlers.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Id } from "@kampus/libfabrika";
import { Writer } from "@kampus/libfabrika/access/SessionManager";
import { Doorbell, Ledger } from "@kampus/libfabrika/ledger/Ledger";
import { LedgerTransaction } from "@kampus/libfabrika/ledger/LedgerTransaction";
import { Mailbox } from "@kampus/libfabrika/processes/Mailbox";
import { Owner, Recipient, Start } from "@kampus/libfabrika/processes/Process";
import { ProcessManager } from "@kampus/libfabrika/processes/ProcessManager";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import { Effect, Layer, Schema, Stream } from "effect";

const PROCESS: string = Effect.runSync(
  Id.Generator.use((ids) => ids.next(Id.Process)).pipe(Effect.provide(Id.Generator.layer)),
);

const NAME = "tally:1";
const LIBRARY = "@kampus/libfabrika"; // Missing P11 exports must not prevent collecting the laws.
const folder = mkdtempSync(join(tmpdir(), "tally-"));
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

describe("tally in the runner", () => {
  it("scenario: after a restart, every watcher and a new one see the same counters", async () => {
    const { tally } = await import("./program.ts");
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
    const expected = Schema.Struct({
      counters: Schema.Array(Schema.Struct({ name: Schema.String, count: Schema.Int })),
    });
    const data = () =>
      Ledger.sql(nodeSql(ledgerDb), { reader: "tally-law" }).pipe(
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
                build: "tally-build",
              }),
            commit: () => Effect.die("tally has no write Cmd"),
            own: () => Effect.die("tally has no own Cmd"),
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
        build: "tally-build",
      };
      const manager = Layer.effectDiscard(
        ProcessManager.use((m) =>
          m.status(NAME).pipe(
            Effect.catch(() =>
              m.start(
                Start.cases.first.make({
                  id: `boot:${NAME}`,
                  name: NAME,
                  code: { program: "tally", hash: "tally-build" },
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
          program: "tally",
          build: "tally-build",
          owner: Writer.cases.person.make({ key: "SHA256:person", for: "person" }),
        },
        { recovery: { sql: nodeSql(storeDb), name: NAME, capacity: 1024 ** 3 } },
      ).pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            manager,
            A.ProgramLoader.layer({ tally }, {}),
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
            id: `tally-${n}`,
            envelope: {
              id: `input_0000000000e0080000000000${n.toString(16).padStart(2, "0")}`,
              by: Writer.cases.person.make({ key: "SHA256:person", for: "person" }),
              arrivedAt: n,
              input: n === 1 ? { type: "add", name: "cups" } : { type: "bump", name: "cups", by: 1 },
            },
            sentAt: "writer clock",
            seen: 0,
            span: { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" },
          });

          for (const state of seen.values()) {
            expect(Schema.decodeUnknownSync(expected)(state.view)).toEqual({
              counters: [{ name: "cups", count: n - 1 }],
            });
          }
        }

        // An agent may bump, but adding is a person's: the runner refuses an agent's add.
        expect(
          yield* r.msg({
            id: "tally-agent-1",
            envelope: {
              id: "input_0000000000e008000000000100",
              by: Writer.cases.agent.make({ key: "SHA256:agent", for: "agent" }),
              arrivedAt: 100,
              input: { type: "add", name: "plates" },
            },
            sentAt: "writer clock",
            seen: 0,
            span: { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7" },
          }),
        ).toMatchObject({ _tag: "refused", reason: "bad_msg" });
        expect((yield* r.open("inspect")).view).toEqual({ counters: [{ name: "cups", count: 11 }] });
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
        expect((yield* r.open("after-wake")).view).toEqual({ counters: [{ name: "cups", count: 11 }] });
      }).pipe(Effect.provide(layer())),
    );
  });
});
