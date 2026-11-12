// P13 slice 2, next/. Real SQLite files and ledger services for runtime's admission laws (0062).
import { DatabaseSync } from "node:sqlite"; // edge: Effect has no synchronous SQLite handle for referee transactions
import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, type Scope } from "effect";
import { TestClock } from "effect/testing";
import * as fc from "fast-check";
import { vi } from "vitest";
import type { Envelope } from "../access/SessionManager.ts";
import * as ProjectAuditTest from "../cloudflare/ProjectAuditTest.ts";
import type { ProjectDoorOptions } from "../cloudflare/runtime.ts";
import { Gateway } from "../gateway/Gateway.ts";
import * as Id from "../Id.ts";
import { Doorbell } from "../ledger/Ledger.ts";
import * as LedgerSql from "../ledger/LedgerSql.ts";
import * as LedgerTransactionSql from "../ledger/LedgerTransactionSql.ts";
import { nodeSql } from "../ledger/NodeSqlite.ts";
import { Mailbox } from "../processes/Mailbox.ts";
import { Owner, Recipient } from "../processes/Process.ts";
import { ProcessManager } from "../processes/ProcessManager.ts";
import type { Incoming } from "../runtime/Entry.ts";
import { Sent } from "../runtime/Runner.ts";
import * as RunnerAdmissionTest from "../runtime/RunnerAdmissionTest.ts";
import { BRAIN, type Harness } from "../runtime/RunnerRepliesTest.ts";
import { Written } from "../telemetry/Records.ts";

const quiet = Layer.succeed(Doorbell, { ring: () => Effect.void });

const files = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const folder = yield* fs.makeTempDirectoryScoped({ prefix: "p13-admission-" });
  return (name: string) =>
    Effect.acquireRelease(
      Effect.sync(() => new DatabaseSync(path.join(folder, `${name}.sqlite`))),
      (db) => Effect.sync(() => db.close()),
    ).pipe(Effect.map(nodeSql));
}).pipe(Effect.provide(NodeServices.layer), Effect.orDie);

const services: Harness["services"] = (inbox, manager) =>
  Layer.mergeAll(
    Mailbox.layer.pipe(
      Layer.provideMerge(LedgerSql.layer(inbox, { reader: "admission-fixture" }).pipe(Layer.provide(quiet))),
    ),
    ProcessManager.layer(
      {
        by: BRAIN,
        owner: Owner.cases.brain.make({}),
        recipient: Recipient.cases.client.make({ client: "fixture", session: "process_0000000000e008000000000003" }),
      },
      Id.Generator.use((ids) => ids.next(Id.Process)).pipe(Effect.provide(Id.Generator.layer), Effect.orDie),
    ).pipe(Layer.provide(LedgerTransactionSql.layer(manager).pipe(Layer.provide(quiet)))),
  );

const register = <A>(
  name: string,
  tape: fc.Arbitrary<Array<A>>,
  check: (cells: ReadonlyArray<A>) => Effect.Effect<void, unknown, Scope.Scope>,
  options: { readonly seed: number; readonly numRuns: number; readonly endOnFailure?: boolean },
  reached: Set<string>,
  required: ReadonlyArray<string>,
) => {
  it(
    name,
    async () => {
      await fc.assert(
        fc.asyncProperty(tape, (cells: Array<A>) =>
          Effect.runPromise(Effect.scoped(check(cells)).pipe(Effect.provide(TestClock.layer()))),
        ),
        options,
      );
      expect([...reached]).toEqual(expect.arrayContaining([...required]));
    },
    600_000,
  );
};

RunnerAdmissionTest.suite({ files, services }, register);

const environment: ProjectAuditTest.Harness["environment"] = (
  box: Parameters<ProjectAuditTest.Harness["environment"]>[0],
  accept: () => number,
) => {
  const unused = vi.fn((): never => {
    throw new Error("unused platform call");
  });
  const namespace = (getByName: ReturnType<typeof vi.fn> = vi.fn().mockImplementation(unused)) => ({
    getByName,
    newUniqueId: unused,
    idFromName: unused,
    idFromString: unused,
    get: unused,
    jurisdiction: unused,
  });
  return {
    PROJECT: namespace(),
    CONNECTION: namespace(),
    LOADER: {
      get: vi.fn().mockReturnValue({ getEntrypoint: vi.fn().mockReturnValue(box), getDurableObjectClass: unused }),
      load: unused,
    },
    PROCESS: namespace(
      vi.fn().mockReturnValue({
        configure: async () => undefined,
        msg: async (input: Incoming) => {
          if (!(await box.admit(input.envelope.input))) {
            return Sent.cases.refused.make({ reason: "bad_msg" });
          }

          const rev = accept();
          return Sent.cases.accepted.make({ rev, pos: rev });
        },
      }),
    ),
    RECORD: namespace(vi.fn().mockReturnValue({ write: async () => Written.cases.written.make({}) })),
    MEASUREMENTS: {
      head: unused,
      get: unused,
      put: unused,
      createMultipartUpload: unused,
      resumeMultipartUpload: unused,
      delete: unused,
      list: unused,
    },
  };
};

const door: ProjectAuditTest.Harness["door"] =
  (url: string, input: Parameters<ProjectAuditTest.Harness["door"]>[1]) => (options: ProjectDoorOptions) =>
    Gateway.pipe(
      Effect.provide(
        Gateway.layer({
          ...options,
          name: "p13-project",
          url,
          origins: ["https://fabrika.test"],
          versions: [1],
          location: "test",
          build: "build-a",
          waiting: { most: 20, ttl: 600_000 },
          ping: { min: 10_000, max: 60_000 },
          inputCap: 1000,
          spentCap: 1000,
          deliver: (
            pid: Parameters<ProjectDoorOptions["deliver"]>[0],
            _envelope: Envelope<typeof input.Type>,
            _span: { readonly traceId: string; readonly spanId: string },
            incoming: Parameters<ProjectDoorOptions["deliver"]>[1],
          ) => options.deliver(pid, incoming),
          inputs: {
            schema: input,
            raw: [],
            personOnly: [],
            name: (m: typeof input.Type) => m.type,
          },
          events: { personOnly: [] },
        }),
      ),
    );

ProjectAuditTest.suite(
  {
    open: files.pipe(Effect.flatMap((open: Effect.Success<typeof files>) => open("project-audit"))),
    environment,
    door,
  },
  register,
);
