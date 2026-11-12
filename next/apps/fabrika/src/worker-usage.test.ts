// next/, U9. Host/container only: only workerd can deliver loader tail events. This file must not
// replace a zero CPU reading with a weaker assertion. The build's probe runs before this scenario.
// edge: crypto supplies an ephemeral public identity; no person's key is read
import { generateKeyPairSync } from "node:crypto";
// edge: Node's SQLite driver opens only this test instance's health tables read-only
import { DatabaseSync } from "node:sqlite";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { Writer } from "@kampus/libfabrika/coordination";
import { InputId } from "@kampus/libfabrika/ledger/Log";
import { SpanRow } from "@kampus/libfabrika/telemetry/Trace";
import { Effect, FileSystem, Path, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { expect } from "vitest";
import { build } from "./build.ts";
import { localInstance } from "./local-instance.ts";
import { heldPort } from "./port.test-support.ts";

const PROJECT = "isolate-usage-test";
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

const FROM = {
  by: "SHA256:fixture",
  for: PERSON,
  sentAt: "2026-11-11T00:00:00Z",
  seen: 0,
  parent: null,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  build: "fixture",
};

const owner = Writer.cases.person.make({ key: FROM.by, for: PERSON });

const spinSource = [
  'import {Machine} from "@demlik/tea/effect";',
  'import {Schema} from "effect";',
  "const Model=Schema.Struct({checksum: Schema.Int});",
  'const Msg=Schema.Struct({type: Schema.Literals(["idle","spin"])});',
  "const machine=Machine.make({model: Model, msg: Msg, cmds: [], init: (s)=>[s??{checksum:0},[]], update: {idle:s=>[s,[]], spin:s=>{let checksum=s.checksum;for(let i=0;i<40000000;i++){checksum=(checksum+i)|0;}return [{checksum},[]];}}});",
  'export const program={name:"usage/spin",machine,state:{v:1,schema:Model,upgrades:[]},msg:Msg,view:{data:Model,select:s=>s},refuse:()=>null,inputs:{idle:{_tag:"write",schema:Msg,description:"Idle",personOnly:false},spin:{_tag:"write",schema:Msg,description:"Spin",personOnly:false}},outputs:{},writes:{},wake:()=>null};',
].join("\n");

const world = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "usage-worker-" });
  const oldAlchemy = process.env.ALCHEMY_HOME;
  const oldHome = process.env.FABRIKA_HOME;
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.env.FABRIKA_HOME = home;
    }),
    () =>
      Effect.sync(() => {
        if (oldHome === undefined) {
          delete process.env.FABRIKA_HOME;
        } else {
          process.env.FABRIKA_HOME = oldHome;
        }

        if (oldAlchemy === undefined) {
          delete process.env.ALCHEMY_HOME;
        } else {
          process.env.ALCHEMY_HOME = oldAlchemy;
        }
      }),
  );
  yield* fs.symlink(path.resolve(import.meta.dirname, "../node_modules"), path.join(home, "node_modules"));
  const file = path.join(home, "spin.ts");
  yield* fs.writeFileString(file, spinSource);
  const checklist = path.join(home, "checklist.ts");
  yield* fs.writeFileString(checklist, 'export { checklist as program } from "@kampus/checklist";');
  const built = yield* build({
    out: path.join(home, "dist"),
    programs: { "usage/spin": file, "fabrika/checklist": checklist },
  });
  const raw = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x;

  if (raw === undefined) {
    return yield* Effect.die("no public identity");
  }

  const field = (bytes: Buffer) => {
    const size = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length);
    return Buffer.concat([size, bytes]);
  };
  const line = Buffer.concat([field(Buffer.from("ssh-ed25519")), field(Buffer.from(raw, "base64url"))]).toString(
    "base64",
  );
  const port = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
  const instance = yield* localInstance(built, {
    home,
    name: PROJECT,
    person: PERSON,
    founder: `ssh-ed25519 ${line}`,
    window: raw,
    port: port.port,
  });
  return { instance, built, home };
});

const healthRows = (home: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const folders = [home];
    const found: Array<{ spanId: string; ms: number }> = [];

    for (let folder = folders.pop(); folder !== undefined; folder = folders.pop()) {
      for (const entry of yield* fs.readDirectoryEntries(folder)) {
        const file = path.join(folder, entry.name);

        if (entry.type === "Directory") {
          folders.push(file);
        }

        if (entry.type === "File" && /\.(sqlite|db)$/.test(entry.name)) {
          yield* Effect.acquireUseRelease(
            Effect.sync(() => new DatabaseSync(file, { readOnly: true })),
            (db) =>
              Effect.sync(() => {
                if (db.prepare("SELECT name FROM sqlite_master WHERE name='measurements'").get() !== undefined) {
                  for (const row of db.prepare("SELECT spanId, ms FROM measurements WHERE piece='isolate.cpu'").all()) {
                    found.push(
                      Schema.decodeUnknownSync(Schema.Struct({ spanId: Schema.String, ms: Schema.Number }))(row),
                    );
                  }
                }
              }),
            (db) => Effect.sync(() => db.close()),
          );
        }
      }
    }

    return found;
  });

const call = <A>(f: () => Promise<A>) => Effect.promise(f);

const invoke = (
  binding: Readonly<Record<string, (...args: ReadonlyArray<unknown>) => Promise<unknown>>>,
  method: string,
  ...args: ReadonlyArray<unknown>
) =>
  Effect.gen(function* () {
    const f = binding[method];

    if (f === undefined) {
      return yield* Effect.die(`missing trusted method ${method}`);
    }

    return yield* call(() => f(...args));
  });

const lifecycle = Schema.Array(
  Schema.Struct({
    _tag: Schema.String,
    body: Schema.Struct({ after: Schema.optionalKey(Schema.String), process: Schema.optionalKey(Schema.String) }),
  }),
);

it.live(
  "scenario: U9 real checklist step and replay fold each record CPU, and a spinning isolate exceeds idle CPU",
  () =>
    Effect.gen(function* () {
      const { instance, built, home } = yield* world;
      const start = (name: string, program: string) =>
        invoke(
          instance.project(PROJECT),
          "start",
          {
            _tag: "first",
            id: `start-${name}`,
            name,
            code: { program, hash: built.programs[program]?.hash ?? "missing" },
          },
          FROM,
        ).pipe(
          Effect.map((reply) => Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(reply).process),
        );
      const send = (process: string, id: string, input: unknown) =>
        invoke(instance.process(process), "msg", {
          id,
          envelope: {
            id: Schema.decodeUnknownSync(InputId)("input_0000000000e008000000000001"),
            by: owner,
            arrivedAt: 0,
            input,
          },
          sentAt: FROM.sentAt,
          seen: 0,
          span: { traceId: FROM.traceId, spanId: "00f067aa0ba902b7" },
        }).pipe(Effect.tap((reply) => Effect.sync(() => expect(reply).toMatchObject({ _tag: "accepted" }))));
      const read = (process: string) =>
        Effect.gen(function* () {
          // A later runner call flushes already delivered tails to the public JobRecord.
          yield* invoke(instance.process(process), "open", "usage-probe");
          const page = yield* invoke(
            instance.record(PROJECT, `job/${process}/0`),
            "read",
            { _tag: "job", process },
            0,
            0,
          ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ spans: Schema.Array(SpanRow) }))));
          return page.spans;
        });
      const until = <A>(look: Effect.Effect<A, unknown>, done: (value: A) => boolean) =>
        Effect.gen(function* () {
          for (let n = 0; n < 100; n++) {
            const value = yield* look;

            if (done(value)) {
              return value;
            }

            yield* Effect.sleep("100 millis");
          }

          return yield* Effect.die("tail rows did not arrive within 10 seconds");
        });
      const checklist = yield* start("checklist:1", "fabrika/checklist");
      yield* send(checklist, "add", { type: "add", name: "milk" });
      yield* send(checklist, "rename", { type: "rename", name: "milk", to: "bread" });
      yield* send(checklist, "remove", { type: "remove", name: "bread" });
      const cpu = (rows: ReadonlyArray<SpanRow>, method: string) =>
        rows.filter((row) => row.name === "isolate.cpu" && row.attributes["fab.isolate.method"] === method);
      const calls = (rows: ReadonlyArray<SpanRow>, method: string) =>
        rows.filter((row) => row.name === `execution.${method}`);
      const stepped = yield* until(
        read(checklist),
        (rows) => calls(rows, "step").length >= 3 && cpu(rows, "step").length === calls(rows, "step").length,
      );
      expect(cpu(stepped, "step")).toHaveLength(calls(stepped, "step").length);
      yield* invoke(instance.process(checklist), "restart", {
        id: "replay",
        build: built.programs["fabrika/checklist"]?.hash ?? "missing",
      });
      const started = yield* until(
        invoke(instance.project(PROJECT), "read", "processes/checklist:1", 0, "usage-probe").pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(lifecycle)),
        ),
        (rows) => rows.some((row: { body?: { after?: string } }) => row.body?.after === checklist),
      );
      const successor = started.find((row: { body?: { after?: string } }) => row.body?.after === checklist)?.body
        .process;

      if (successor === undefined) {
        return yield* Effect.die("restart recorded no successor");
      }

      const inbox = yield* invoke(instance.project(PROJECT), "read", "checklist:1/inbox", 0, "usage-probe").pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Unknown))),
      );
      const folded = yield* until(read(successor), (rows) => cpu(rows, "fold").length === inbox.length);
      expect(inbox.length).toBeGreaterThan(0);
      expect(cpu(folded, "fold")).toHaveLength(inbox.length);
      expect(calls(folded, "fold")).toHaveLength(inbox.length);

      for (const [process, spans] of [
        [checklist, stepped],
        [successor, folded],
      ] as const) {
        for (const span of spans.filter((row) => row.name === "isolate.cpu")) {
          expect(span.attributes["fab.process"]).toBe(process);
          expect(span.attributes["fab.isolate.outcome"]).toBe("ok");
        }
      }

      const spin = yield* start("spin:1", "usage/spin");
      yield* send(spin, "idle", { type: "idle" });
      const idle = yield* until(read(spin), (rows) => cpu(rows, "step").length === 1);
      yield* send(spin, "spin", { type: "spin" });
      const busy = yield* until(read(spin), (rows) => cpu(rows, "step").length === 2);
      const duration = (row: SpanRow) =>
        Number(BigInt(row.endTimeUnixNano) - BigInt(row.startTimeUnixNano)) / 1_000_000;
      const baseline = cpu(idle, "step").map(duration);
      const later = cpu(busy, "step").filter((row) => !idle.some((old) => old.spanId === row.spanId));
      expect(later).toHaveLength(1);
      const [spinning] = later;

      if (spinning === undefined) {
        return yield* Effect.die("no spinning step row");
      }

      expect(
        duration(spinning),
        "local cpuTime=0 is a failed measurement, never a reason to loosen U9",
      ).toBeGreaterThan(Math.max(...baseline));
      const health = yield* healthRows(home);

      for (const span of [...stepped, ...folded, ...busy].filter((row) => row.name === "isolate.cpu")) {
        expect(health.filter((row) => row.spanId === span.spanId)).toEqual([
          { spanId: span.spanId, ms: duration(span) },
        ]);
      }
    }).pipe(Effect.scoped, Effect.provide(SecureRandom.layerWebCrypto), Effect.provide(NodeServices.layer)),
  180_000,
);
