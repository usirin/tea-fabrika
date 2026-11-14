// P12, next/. Project and Connection use their real composition and SQLite services.
// Only platform handles are supplied here. No sockets or substitute authority rules.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Descriptor, Incoming, Sent } from "@kampus/libfabrika";
import { SigningRefused } from "@kampus/libfabrika/access/SessionManager";
import { revokeText } from "@kampus/libfabrika/access/Text";
import { BrainEvent } from "@kampus/libfabrika/brain-event";
import { Child, type StartGrant } from "@kampus/libfabrika/processes/Children";
import { type From } from "@kampus/libfabrika/processes/Mailbox";
import { Recipient, Start } from "@kampus/libfabrika/processes/Process";
import * as Audit from "@kampus/libfabrika/runtime/Audit";
import * as StartsTest from "@kampus/libfabrika/settings/StartsTest";
import { nodeSql } from "@kampus/libfabrika/sqlite";
import type { SpanRow } from "@kampus/libfabrika/telemetry/Trace";
import { Attached } from "@kampus/libfabrika/transport/Wire";
import { ConnectionService, connectionRuntime } from "@kampus/libfabrika/workers/gateway";
import { ProjectService, bucketCalls } from "@kampus/libfabrika/workers/runtime";
import { Cause, Deferred, Effect, Exit, Layer, Option, Schedule, Schema, Tracer } from "effect";
import * as fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as RecordWireTest from "./record-wire.test-support.ts";
import { projectRuntime, settings, type Env } from "./runtime.ts";
import { Settings } from "./settings.ts";

const table = vi.hoisted(() => ({ programs: {} as Record<string, { hash: string; source: string }> }));
vi.mock("./table.ts", () => table);
// P16: the brain reads its embedded tables from the build's generated module
// (libfabrika's build-modules.d.ts). Mocking both keeps these laws on either wiring.
vi.mock("virtual:fabrika-built", () => ({ ...table, assets: {} }));

vi.mock("effect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("effect")>();
  return { ...actual, Layer: { ...actual.Layer } };
});

const built = (source: string) => ({ hash: createHash("sha256").update(source).digest("hex"), source });
const counterCode = built("counter");
const checklistCode = built("checklist");
const approvalCode = built("approvals");

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SENT = "2026-11-08T04:00:00.000Z";

const field = (value: Buffer | string) => {
  const body = Buffer.from(value),
    size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return Buffer.concat([size, body]);
};

const identity = () => {
  const pair = generateKeyPairSync("ed25519"),
    raw = pair.publicKey.export({ format: "jwk" }).x!;
  const bytes = Buffer.from(raw, "base64url"),
    blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
  return {
    raw,
    line: `ssh-ed25519 ${blob.toString("base64")}`,
    fingerprint: `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`,
    proof: (text: string) => {
      const payload = Buffer.concat([
        Buffer.from("SSHSIG"),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(createHash("sha512").update(text).digest()),
      ]);
      const version = Buffer.alloc(4);
      version.writeUInt32BE(1);
      const packet = Buffer.concat([
        Buffer.from("SSHSIG"),
        version,
        field(blob),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(Buffer.concat([field("ssh-ed25519"), field(sign(null, payload, pair.privateKey))])),
      ]);
      return `-----BEGIN SSH SIGNATURE-----\n${packet
        .toString("base64")
        .match(/.{1,70}/g)!
        .join("\n")}\n-----END SSH SIGNATURE-----\n`;
    },
  };
};

const closers: Array<() => Promise<void>> = [];

const generated = fc.record({
  letter: fc.uuid(),
  write: fc.uuid(),
  trace: fc.uint8Array({ minLength: 16, maxLength: 16 }).map((bytes) => Buffer.from(bytes).toString("hex")),
  build: fc.uuid(),
  rev: fc.integer({ min: 1, max: 1_000_000 }),
});

const prepareInput = {
  letter: "prepare",
  write: "write-1",
  trace: TRACE,
  build: "counter-b",
  rev: 1,
};

const approveInput = { ...prepareInput, letter: "approve" };

const law = (name: string, check: (input: ReturnType<typeof generated.generate>["value"]) => Promise<void>) =>
  it(name, async () => {
    await fc.assert(
      fc.asyncProperty(generated, async (input) => {
        try {
          await check(input);
        } finally {
          for (const close of closers.splice(0).reverse()) {
            await close();
          }
        }
      }),
      { seed: 119120, numRuns: 20, examples: [[prepareInput], [approveInput]] },
    );
  });

afterEach(async () => {
  for (const close of closers.splice(0).reverse()) {
    await close();
  }
});

const storage = (db: DatabaseSync) => {
  const sql = nodeSql(db),
    values = new Map<string, unknown>();
  return {
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
};

/** Ticket 762 A2: the build forks its own configure calls, so a law that counts `configured` waits
 *  for the Project's record of them, `dev_descriptors.pending`, to clear first. */
const settled = (db: DatabaseSync) =>
  Effect.runPromise(
    Effect.suspend(() =>
      Number(db.prepare("SELECT COUNT(*) AS n FROM dev_descriptors WHERE pending=1").get()!.n) === 0
        ? Effect.void
        : Effect.fail("a start is not yet delivered to its object"),
    ).pipe(Effect.retry(Schedule.spaced("5 millis")), Effect.timeout("5 seconds")),
  );

/** A fake object's configure that calls back into the Project, as a new process's init asks
 *  `status` (amendment A2). It gives up after this, so a build that waits on it still ends. */
const CALLBACK_GIVES_UP = "6 seconds";

const world = async (
  trace = TRACE,
  build = "counter-b",
  options: { readonly callback?: boolean; readonly starts?: ReadonlyArray<typeof StartGrant.Type> } = {},
) => {
  // P40: the core counter's code is `fabrika/counter`; its registered name stays `counter:1`.
  table.programs["fabrika/counter"] = counterCode;
  // P14 slice 2: the app boots `checklist:1` after `counter:1`, so the table holds its program too.
  table.programs["fabrika/checklist"] = checklistCode;
  table.programs["p12/approvals"] = approvalCode;
  const home = mkdtempSync(join(tmpdir(), "p12-r-")),
    key = identity();
  const db = new DatabaseSync(join(home, "project.db"));
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node fixture implements the platform members Project reads; only workerd can construct a full DurableObjectState
  const ctx = {
    id: { name: "project-test" },
    storage: storage(db),
    exports: { IsolateTail: () => ({ fetch: async () => new Response() }) },
  } as unknown as DurableObjectState;
  const descriptors = new Map<string, Descriptor>(),
    configured: Descriptor[] = [],
    received: Incoming[] = [],
    recorded: SpanRow[] = [],
    statuses: unknown[] = [];
  let onMessage: (pid: string, input: Incoming) => Promise<Sent> = async (_pid, input) => {
    received.push(input);
    return { _tag: "accepted", rev: 1, pos: 1 };
  };
  let onRing: () => Promise<void> = async () => {};
  // oxlint-disable-next-line fabrika/no-type-assertions -- Node binding doubles implement only the RPC methods this composition calls, without workerd's nominal brands
  const env = {
    INSTANCE: JSON.stringify(
      RecordWireTest.settingsFixture({
        name: "project-test",
        person: PERSON,
        founder: key.line,
        window: key.raw,
        port: 18787,
        build: "brain-test",
        ...(options.starts === undefined ? {} : { starts: options.starts }),
      }),
    ),
    PROCESS: {
      // Ticket 402 keys a Process object by its registered name, so the stub key may be a
      // name: descriptors are keyed by their own process ID, and delivery names that ID.
      getByName: (name: string) => {
        const [, storageKey] = JSON.parse(name) as [string, string];
        const owned = () =>
          descriptors.get(storageKey) ?? [...descriptors.values()].findLast((d) => d.name === storageKey);
        return {
          configure: async (descriptor: Descriptor) => {
            if (options.callback === true) {
              // The runtime's own build is awaited before its Effect runs, so the bound sits outside.
              const status = await Effect.runPromise(
                Effect.promise(() =>
                  runtime.runPromise(ProjectService.pipe(Effect.flatMap((p) => p.processStatus(descriptor.name)))),
                ).pipe(Effect.timeoutOption(CALLBACK_GIVES_UP)),
              );

              if (Option.isSome(status)) {
                statuses.push(status.value);
              }
            }

            descriptors.set(descriptor.id, descriptor);
            configured.push(descriptor);
          },
          descriptor: async () => owned(),
          msg: (input: Incoming) => onMessage(owned()?.id ?? storageKey, input),
        };
      },
    },
    CONNECTION: {
      getByName: () => ({ ring: () => onRing(), notify: async () => {}, probe: async () => 42 }),
    },
    RECORD: {
      getByName: () => ({
        write: async (_chain: unknown, _part: number, rows: ReadonlyArray<{ span: SpanRow }>) => {
          recorded.push(...rows.map((row) => row.span));
          return { _tag: "written" };
        },
      }),
    },
    MEASUREMENTS: {},
    LOADER: {
      get: (id: string) => ({
        getEntrypoint: () => ({
          audit: async (message: unknown) =>
            Audit.Answer.cases.ok.make({
              value: Schema.decodeUnknownSync(Schema.Struct({ type: Schema.String }))(message),
            }),
          describe: async () =>
            id.startsWith(`${approvalCode.hash}/`)
              ? {
                  name: "p12/approvals",
                  v: 1,
                  writes: { answered: { personOnly: true } },
                  inputs: {
                    prepare: { write: true, personOnly: false },
                    approve: { write: true, personOnly: true },
                  },
                  cmds: [],
                }
              : {
                  name: "fabrika/counter",
                  v: 1,
                  writes: {},
                  inputs: { inc: { write: true, personOnly: false } },
                  cmds: [],
                },
        }),
      }),
    },
  } as unknown as Env;
  const span = Tracer.externalSpan({ traceId: trace, spanId: "00f067aa0ba902b7" });
  const buildLayer = Layer.buildWithMemoMap;
  // The shared holder builds consumers on first entry, after the outer runtime starts.
  const startup = vi
    .spyOn(Layer, "buildWithMemoMap")
    .mockImplementation((layer, memo, scope) => buildLayer(layer.pipe(Layer.withParentSpan(span)), memo, scope));
  let runtime = projectRuntime(ctx, env);
  const run = <A, E>(work: Effect.Effect<A, E, ProjectService>) => runtime.runPromise(work);
  closers.push(async () => {
    await runtime.dispose();
    db.close();
    rmSync(home, { recursive: true, force: true });
  });
  let p: ProjectService["Service"];

  try {
    p = await run(ProjectService);
  } finally {
    startup.mockRestore();
  }

  await settled(db);
  const from: From = {
    by: key.fingerprint,
    for: PERSON,
    sentAt: SENT,
    seen: 0,
    parent: null,
    traceId: trace,
    build: "brain-test",
  };
  const client = await run(p.connect()),
    nonce = await run(p.challenge(client));
  expect(
    await run(
      p.initialize(
        client,
        {
          versions: [1],
          has: ["seal"],
          ping: "30s",
          key: key.raw,
          tab: "tab-a",
          nonce,
          platform: "headless",
          os: "linux",
          sentAt: SENT,
          signed: key.proof(`fabrika-hello\nhttp://127.0.0.1:18787\ntab-a\n${nonce}`),
        },
        { url: "http://127.0.0.1:18787", tab: "tab-a", name: key.fingerprint },
      ),
    ),
  ).toMatchObject({ _tag: "online" });
  return {
    p,
    run,
    settingsRead: (start: string) => runtime.settingsRead(start),
    span,
    key,
    env,
    ctx,
    db,
    from,
    descriptors,
    configured,
    received,
    recorded,
    statuses,
    start: async () =>
      (
        await run(
          p.start(
            Start.cases.first.make({
              id: "approvals:1",
              name: "approvals:1",
              code: { program: "p12/approvals", hash: approvalCode.hash },
            }),
            from,
          ),
        )
      ).process,
    send: (pid: string, type: string, letter = type) =>
      run(p.route(client, "process.send", { pid, letter, m: { type }, sentAt: SENT, seen: 0 })),
    revoke: () => {
      const text = revokeText({
        id: "revoke-1",
        key: key.raw,
        for: PERSON,
        to: "project-test",
        saw: { label: "fixture", location: "local", method: "command", check: "none" },
        sentAt: SENT,
      });
      return run(p.grant({ text, armored: key.proof(text) }));
    },
    message: (f: typeof onMessage) => {
      onMessage = f;
    },
    ring: (f: typeof onRing) => {
      onRing = f;
    },
    reopen: async () => {
      await runtime.dispose();
      table.programs["fabrika/counter"] = built(`changed counter:${build}`);
      runtime = projectRuntime(ctx, env);
      const reopened = await run(ProjectService);
      await settled(db);
      return reopened;
    },
    reopenExit: async () => {
      await runtime.dispose();
      runtime = projectRuntime(ctx, env);
      return runtime.runPromiseExit(ProjectService);
    },
  };
};

// The L4/L8 world is a scoped resource: its release closes what `world()` opened (0061).
const openWorld = (starts?: ReadonlyArray<typeof StartGrant.Type>) =>
  Effect.acquireRelease(
    Effect.promise(() => world(TRACE, "counter-b", starts === undefined ? {} : { starts })),
    () =>
      Effect.promise(async () => {
        for (const close of closers.splice(0).reverse()) {
          await close();
        }
      }),
  );

const opened = openWorld();

StartsTest.law(
  "L4 child grants pass through the recorded start to ChildrenLedger without entering ledger entries or receipts",
  fc.tuple(fc.uuid(), fc.array(fc.nat(), { minLength: 8, maxLength: 25 })),
  ([word, choices]) =>
    Effect.gen(function* () {
      const grants = [
        { source: "fabrika/counter", to: "p12/approvals" },
        { source: `unused-${word}`, to: `unused-target-${word}` },
      ];
      const w = yield* openWorld(grants);
      let project = w.p;
      const [boot] = yield* Effect.promise(() => w.run(project.info));
      expect(boot).toBeDefined();
      const requester = Recipient.cases.process.make({ process: boot!.process });
      const saved: Array<Child> = [];
      const start = (child: Child) => Effect.promise(() => w.run(project.processChild(child, w.from)));
      const checkSaved = Effect.fnUntraced(function* () {
        const rows = w.db.prepare("SELECT * FROM entries").all();
        expect(rows.some((row) => row._tag === "instance_started")).toBe(true);

        for (const row of rows) {
          const body = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(row.body);
          expect(body).not.toHaveProperty("starts");
          expect(JSON.stringify(row)).not.toContain(`unused-${word}`);
          expect(JSON.stringify(row)).not.toContain(`unused-target-${word}`);
        }

        const input = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Settings))(w.env.INSTANCE);
        const receipt = yield* w.settingsRead(input.start);
        expect(receipt).toMatchObject({ _tag: "ok" });
        expect(receipt).not.toHaveProperty("value.starts");
        expect(JSON.stringify(receipt)).not.toContain(`unused-${word}`);
      });

      for (const [index, choice] of choices.entries()) {
        const moves = saved.length === 0 ? ["start"] : ["start", "repeat", "refuse", "reopen"];
        const move = moves[choice % moves.length];

        if (move === "reopen") {
          project = yield* Effect.promise(() => w.reopen());
        } else if (move === "repeat") {
          expect(yield* start(saved[choice % saved.length]!)).toMatchObject({ _tag: "ok", value: { _tag: "started" } });
        } else {
          const child = Child.make({
            id: `child-${word}-${index}`,
            name: `child:${index}`,
            code: { program: move === "refuse" ? `ungranted-${word}` : "p12/approvals", hash: approvalCode.hash },
            requester,
          });
          const before = w.db.prepare("SELECT count(*) AS total FROM entries").get();
          const reply = yield* start(child);

          if (move === "refuse") {
            expect(reply).toMatchObject({ _tag: "ChildrenError", reason: "forbidden" });
            expect(w.db.prepare("SELECT count(*) AS total FROM entries").get()).toEqual(before);
          } else {
            expect(reply).toMatchObject({ _tag: "ok", value: { _tag: "started", name: child.name } });
            saved.push(child);
          }
        }

        yield* checkSaved();
      }
    }),
);

// Ways to bend a registered name toward a program identity. Each holds a slash.
const bends: ReadonlyArray<(name: string) => string> = [
  () => "fabrika/counter",
  (name) => `fabrika/${name}`,
  (name) => `${name}/x`,
  (name) => name.replace(/[:.]/, "/"),
];

// The walk: from the brain's own bootstrap, each step starts the core code under a fresh valid
// registered name, or tries a current name bent into a slashed one, which is refused.
const walk = async (w: Awaited<ReturnType<typeof world>>, tape: ReadonlyArray<number>) => {
  const names = ["counter:1"];
  // P14 slice 2: the boot's second entry. The walk starts only the counter's code, so this stays
  // the one process of another program, under its own name.
  const other = { name: "checklist:1", program: "fabrika/checklist" };
  const others = (list: ReadonlyArray<{ readonly name: string; readonly program: string }>) =>
    list.filter((p) => p.program !== "fabrika/counter").map((p) => ({ name: p.name, program: p.program }));
  let refused = 0;
  expect(w.configured.map((d) => ({ name: d.name, program: d.program }))).toEqual([
    { name: "counter:1", program: "fabrika/counter" },
    other,
  ]);
  const [started] = await w.run(w.p.read("processes/counter:1", 0, "audit"));
  expect(JSON.stringify(started)).toContain('"fabrika/counter"');

  for (const [i, n] of tape.entries()) {
    const code = { program: "fabrika/counter", hash: counterCode.hash };

    if (i % 2 === 0) {
      const name = n % 2 === 0 ? `counter:${names.length + 1}` : `tally-${n % 97}.${names.length}`;
      await w.run(w.p.start(Start.cases.first.make({ id: `p40-${i}`, name, code }), w.from));
      names.push(name);
    } else {
      const bent = bends[n % bends.length]!(names[Math.floor(n / bends.length) % names.length]!);
      const result = await w.run(
        Effect.result(w.p.start(Start.cases.first.make({ id: `p40-${i}`, name: bent, code }), w.from)),
      );
      expect(result, `${bent} is refused`).toMatchObject({ _tag: "Failure" });
      refused++;
    }

    const info = await w.run(w.p.info);
    expect(info.map((p) => p.name).sort()).toEqual([...names, other.name].sort());
    expect(others(info)).toEqual([other]);
    expect(others(w.configured)).toEqual([other]);
    expect(w.configured.every((d) => !d.name.includes("/"))).toBe(true);
  }

  expect(refused).toBeGreaterThan(0);
};

describe("P40 the core counter's identity in the brain", () => {
  it("L4 and L8: the bootstrap runs fabrika/counter as counter:1, and no start turns a program identity into a registered name", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.nat(), { minLength: 2, maxLength: 8 }), (tape) =>
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const w = yield* opened;
              yield* Effect.promise(() => walk(w, tape));
            }),
          ),
        ),
      ),
      { seed: 119120, numRuns: 10 },
    );
  });
});

describe("P12 Project authority", () => {
  law("the bootstrap entry keeps the caller's span trace", async ({ trace }) => {
    const w = await world(trace);
    const [row] = await w.run(w.p.read("processes/counter:1", 0, "audit"));
    expect(row).toMatchObject({ traceId: w.span.traceId, rev: w.p.boot.rev });
  });
  law("a brain lifecycle entry keeps the caller's span trace", async ({ trace, write }) => {
    const w = await world();
    const event = BrainEvent.cases.stopped.make({ id: write, start: write, at: 1, reason: "stop" });
    await w.run(
      w.p.brain(event).pipe(Effect.withParentSpan(Tracer.externalSpan({ traceId: trace, spanId: "00f067aa0ba902b7" }))),
    );
    const [row] = await w.run(w.p.read("gateway/brain", 0, "audit"));
    const { _tag, ...body } = event;
    expect(row).toMatchObject({ traceId: trace, id: write, _tag, body });
  });
  law("reopening an exited bootstrap reads its first placing without starting it again", async ({ trace, build }) => {
    const w = await world(trace, build);
    const first = w.p.boot;
    const before = await w.run(w.p.read("processes/counter:1", 0, "audit"));
    await w.run(w.p.exit(first.process, { _tag: "normal" }, w.from));
    const configured = w.configured.length;
    const reopened = await w.reopen();
    expect(reopened.boot).toEqual(first);
    expect(w.configured).toHaveLength(configured);
    const entries = await w.run(reopened.read("processes/counter:1", 0, "audit"));
    expect(entries[0]).toEqual(before[0]);
    expect(entries).toHaveLength(2);
  });
  law("a program's person-only events require its own person-only input", async ({ letter, write }) => {
    const w = await world(),
      pid = await w.start();
    await w.send(pid, "prepare", letter);
    const parent = w.received[0]!.envelope.id;
    const result = await w.run(Effect.exit(w.p.sign(pid, write, parent, "answered")));
    expect(result).toMatchObject({ _tag: "Failure" });
    const failure = Option.getOrThrow(Exit.findErrorOption(result));
    expect(failure).toBeInstanceOf(SigningRefused);
    expect(failure).toMatchObject({ reason: "person_only" });
  });
  law("a program's declared person-only input authorizes its person-only event", async ({ letter, write }) => {
    const w = await world(),
      pid = await w.start();
    await w.send(pid, "approve", letter);
    const result = await w.run(Effect.exit(w.p.sign(pid, write, w.received[0]!.envelope.id, "answered")));
    expect(result).toMatchObject({ _tag: "Success", value: { by: { _tag: "person" } } });
    // The saved delivery is independent evidence of the declaration used at admission.
    const saved = w.db.prepare("SELECT saved FROM gateway_sessions WHERE parent=?").get(w.received[0]!.envelope.id);
    expect(JSON.parse(String(saved!.saved))).toMatchObject({
      input: { personOnly: true, process: pid },
    });
  });
  law("input permission is checked again at the final append", async ({ letter }) => {
    const w = await world(),
      pid = w.p.boot.process;
    const entered = await Effect.runPromise(Deferred.make<void>()),
      release = await Effect.runPromise(Deferred.make<void>());
    w.message(async (_pid, input) => {
      w.received.push(input);
      await Effect.runPromise(Deferred.succeed(entered, undefined));
      await Effect.runPromise(Deferred.await(release));
      const result = await w.run(w.p.inbox(pid, input));
      return result._tag === "placed"
        ? { _tag: "accepted", rev: result.rev, pos: result.pos }
        : { _tag: "refused", reason: result.reason };
    });
    const pending = w.send(pid, "inc", letter).then(
      (answer) => ({ answer }),
      (error: unknown) => ({ error }),
    );
    await Effect.runPromise(Deferred.await(entered));

    try {
      expect(await w.revoke()).toMatchObject({ _tag: "applied" });
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
    }

    await pending;
    expect(await w.run(w.p.read("counter:1/inbox", 0, "audit"))).toEqual([]);
  });

  for (const operation of ["own", "inbox", "start", "exit"] as const) {
    law(`the Project releases its write permit before notifying ${operation}`, async ({ write, letter }) => {
      const w = await world(),
        pid = w.p.boot.process;
      const stream =
        operation === "own"
          ? "events"
          : operation === "inbox"
            ? "counter:1/inbox"
            : operation === "start"
              ? "processes/approvals:1"
              : "processes/counter:1";
      const after = (await w.run(w.p.read(stream, 0, "audit"))).at(-1)?.rev ?? 0;
      await w.run(w.p.wait(stream, after, "gateway-test"));
      let reentered = false;
      let inside = false;
      w.ring(async () => {
        if (inside) {
          return;
        }

        inside = true;
        const answer = await w.run(
          w.p
            .start(
              Start.cases.first.make({
                id: `nested:${write}`,
                name: `nested:${write}`,
                code: { program: "fabrika/counter", hash: counterCode.hash },
              }),
              w.from,
            )
            .pipe(Effect.timeoutOption("150 millis")),
        );
        reentered = Option.isSome(answer);
      });

      if (operation === "own") {
        await w.run(w.p.own(pid, write, "events", { _tag: "noted" }));
      } else if (operation === "start") {
        await w.start();
      } else if (operation === "exit") {
        await w.run(w.p.exit(pid, { _tag: "normal" }, w.from));
      } else {
        await w.send(pid, "inc", letter);
        await w.run(w.p.inbox(pid, w.received[0]!));
      }

      expect(reentered, "a ring can reenter Project without waiting on its caller").toBe(true);
    });
  }

  law("reopening a project restores its process when the available bundle changes", async ({ build }) => {
    const w = await world(TRACE, build),
      before = await w.run(w.p.info),
      configured = w.configured.length;
    const result = await Effect.runPromise(
      Effect.tryPromise({
        try: w.reopen,
        catch: (cause) => new Error("project reopen failed", { cause }),
      }).pipe(Effect.exit),
    );
    expect(result).toMatchObject({ _tag: "Success" });

    if (Exit.isSuccess(result)) {
      expect(await w.run(result.value.info)).toEqual(before);
      expect(w.configured).toHaveLength(configured);
      expect(await w.run(result.value.read("processes/counter:1", 0, "audit"))).toHaveLength(1);
    }
  });

  // scenario: one fixed order, the Project's build and then a callback from its bootstrap's object,
  // so nothing is drawn (ticket 762, L10). A build that waits on that configure waits on itself.
  it("scenario: the Project's build never waits on its bootstrap's configure calling back into it", async () => {
    const building = world(TRACE, "counter-b", { callback: true });
    const built = await Effect.runPromise(Effect.promise(() => building).pipe(Effect.timeoutOption("3 seconds")));
    const w = await building;
    expect(Option.isSome(built), "the Project's build waited on its own bootstrap's configure").toBe(true);
    expect(w.configured.filter((d) => d.id === w.p.boot.process)).toHaveLength(1);
    // P14 slice 2: the boot is a list, so each entry's configure calls back once, in the list's order.
    expect(w.statuses, "each boot entry's configure saw the Project answer its status").toMatchObject([
      { _tag: "ok", value: { name: "counter:1", state: { process: w.p.boot.process } } },
      { _tag: "ok", value: { name: "checklist:1" } },
    ]);
  }, 15_000);

  for (const field of ["writer", "trace"] as const) {
    law(`an own write retains its process ${field}`, async ({ trace, write }) => {
      const w = await world(trace),
        pid = w.p.boot.process;
      await w.run(
        w.p
          .own(pid, write, "events", { _tag: "noted" })
          .pipe(Effect.withParentSpan(Tracer.externalSpan({ traceId: trace, spanId: "00f067aa0ba902b7" }))),
      );
      const [row] = await w.run(w.p.read("events", 0, "audit"));
      expect(row).toMatchObject(
        field === "writer" ? { by: w.descriptors.get(pid)!.owner.key, for: PERSON, parent: null } : { traceId: trace },
      );
    });
  }
});

describe("P12 Project saved and wire readers", () => {
  const malformed = fc.jsonValue().filter((value) => typeof value !== "string");
  const typed = (exit: Exit.Exit<unknown, unknown>) => {
    expect(Exit.isFailure(exit)).toBe(true);
    const cause = Exit.isFailure(exit) ? exit.cause : Cause.die("unexpected success");
    expect(Cause.hasDies(cause)).toBe(false);
    expect(Cause.hasFails(cause)).toBe(true);
    expect(Cause.findErrorOption(cause)).toMatchObject({
      _tag: "Some",
      value: { _tag: "LedgerError", reason: "bad_row" },
    });
  };
  it("saved instance settings fail through the Project runtime's typed error channel", async () => {
    const encoded = Schema.fromJsonString(Settings);
    const invalid = fc
      .oneof(
        fc.string(),
        fc.jsonValue().map((value) => JSON.stringify(value)),
      )
      .filter((value) => !Schema.is(encoded)(value));
    await fc.assert(
      fc.asyncProperty(invalid, async (raw) => {
        let runtime: ReturnType<typeof projectRuntime> | undefined;

        try {
          const w = await world();
          typed(
            await Effect.runPromiseExit(
              Effect.suspend(() => {
                runtime = projectRuntime(w.ctx, { ...w.env, INSTANCE: raw });
                return runtime.contextEffect;
              }),
            ),
          );
        } finally {
          await runtime?.dispose();

          for (const close of closers.splice(0).reverse()) {
            await close();
          }
        }
      }),
      { seed: 119120, numRuns: 20, examples: [["{"], ["{}"], ["null"]] },
    );
  });

  for (const reader of ["bootstrap", "own descriptor", "pending descriptor", "own event"] as const) {
    it(`${reader} rejects malformed saved or wire values with LedgerError, never a defect`, async () => {
      const event = Schema.Struct({ _tag: Schema.String });
      const values = reader === "own event" ? fc.jsonValue().filter((value) => !Schema.is(event)(value)) : malformed;
      await fc.assert(
        fc.asyncProperty(values, async (raw) => {
          try {
            const w = await world(),
              pid = w.p.boot.process;

            if (reader === "bootstrap") {
              // An unrelated event at the stable bootstrap ID passes the generic ledger schema.
              // ProcessTable ignores its unknown tag; the bootstrap reader must check its body.
              w.db
                .prepare('UPDATE entries SET "_tag"=?, body=? WHERE stream=? AND id=?')
                .run("noted", JSON.stringify({ process: raw }), "processes/counter:1", "counter:1");
              typed(await w.reopenExit());
            } else if (reader === "own event") {
              typed(await w.run(Effect.exit(w.p.own(pid, "invalid-event", "events", raw))));
            } else {
              w.db
                .prepare("UPDATE dev_descriptors SET value=?, pending=? WHERE process=?")
                .run(JSON.stringify(raw), reader === "pending descriptor" ? 1 : 0, pid);
              const exit =
                reader === "pending descriptor"
                  ? await w.reopenExit()
                  : await w.run(Effect.exit(w.p.own(pid, "invalid-descriptor", "events", { _tag: "noted" })));
              typed(exit);
            }
          } finally {
            for (const close of closers.splice(0).reverse()) {
              await close();
            }
          }
        }),
        { seed: 119120, numRuns: 20, examples: [[null], [{}], [17]] },
      );
    });
  }
});

describe("P12 WebCrypto failures", () => {
  const failure = fc.oneof(
    fc.anything(),
    fc.string().map((message) => new Error(message)),
    fc.constant(new DOMException("digest refused", "OperationError")),
  );

  for (const edge of ["fingerprint", "archive checksum"] as const) {
    it(`${edge} refuses every thrown or rejected failure with reason crypto`, async () => {
      await fc.assert(
        fc.asyncProperty(failure, fc.boolean(), fc.uint8Array(), async (value, throws, body) => {
          const w = edge === "fingerprint" ? await world() : null;
          const digest = vi.spyOn(crypto.subtle, "digest").mockImplementation(() => {
            if (throws) {
              throw value;
            }

            return Promise.reject(value);
          });
          const put = vi.fn(async () => null);

          try {
            if (w !== null) {
              const result = await w.run(Effect.exit(w.p.online(w.key.fingerprint)));
              expect(result).toMatchObject({ _tag: "Failure" });
              expect(Option.getOrThrow(Exit.findErrorOption(result))).toMatchObject({
                _tag: "LedgerError",
                reason: "crypto",
              });
            } else {
              // oxlint-disable-next-line fabrika/no-type-assertions -- the digest must fail before any R2 method runs
              const bucket = { put } as unknown as R2Bucket;
              await expect(bucketCalls(bucket).put("measurements", body, "0".repeat(64))).rejects.toMatchObject({
                _tag: "LedgerError",
                reason: "crypto",
              });
              expect(put).not.toHaveBeenCalled();
            }

            expect(digest).toHaveBeenCalled();
          } finally {
            digest.mockRestore();

            for (const close of closers.splice(0).reverse()) {
              await close();
            }
          }
        }),
        { seed: 119120, numRuns: 20 },
      );
    });
  }
});

// A window's socket, attached online with the world's key, as the gateway stores it.
const online = (w: Awaited<ReturnType<typeof world>>, client: string): typeof Attached.Type =>
  Attached.cases.online.make({
    client,
    identity: { key: w.key.fingerprint, person: PERSON, as: "window" },
    version: 1,
    waits: [],
    watching: false,
    busy: false,
  });

describe("P12 Connection recording", () => {
  for (const operation of ["ring", "probe", "close", "notify"] as const) {
    law(`an authenticated ${operation} records through the project's sink`, async ({ letter, rev }) => {
      const w = await world(),
        db = new DatabaseSync(":memory:");
      let attached = online(w, letter);
      const ws = {
        deserializeAttachment: () => attached,
        serializeAttachment: (a: typeof Attached.Type) => {
          attached = a;
        },
        send: () => {
          if (operation === "notify") {
            throw new Error("delivery failed");
          }
        },
        close: () => {},
      };
      // oxlint-disable-next-line fabrika/no-type-assertions -- Node fixture supplies the hibernating socket and SQL members consumed by Connection
      const ctx = {
        id: { name: "gateway-test" },
        storage: storage(db),
        getWebSockets: () => [ws],
        getTags: () => ["session-test", "tab-a", w.key.fingerprint],
        getWebSocketAutoResponseTimestamp: () => new Date(42),
      } as unknown as DurableObjectState;
      // oxlint-disable-next-line fabrika/no-type-assertions -- this Node RPC double has no workerd namespace brand
      const project = {
        getByName: () => ({
          settingsStart: async () => StartsTest.reply(await Effect.runPromise(settings(w.env))),
          leave: async () => {},
          disconnect: async () => {},
        }),
      } as unknown as Env["PROJECT"];
      // oxlint-disable-next-line fabrika/no-type-assertions -- Node socket double implements attachment, send and close without workerd's socket brand
      const socket = ws as unknown as WebSocket;
      const config = await Effect.runPromise(settings(w.env));
      const runtime = connectionRuntime(ctx, { ...w.env, PROJECT: project }, config);

      try {
        const gateway = await runtime.runPromise(ConnectionService),
          before = w.recorded.length;
        const action: Effect.Effect<unknown, unknown> =
          operation === "ring"
            ? gateway.ring("events", rev)
            : operation === "probe"
              ? gateway.probe("session-test")
              : operation === "close"
                ? gateway.close(socket)
                : gateway.notify(letter, { method: "view.patch", params: {} });
        await runtime.runPromise(Effect.exit(action));
        const rows = w.recorded.slice(before);
        expect(rows.some((row) => row.name === `connection.${operation}`)).toBe(true);

        if (operation === "notify") {
          expect(rows.some((row) => !row.ok)).toBe(true);
        }
      } finally {
        await runtime.dispose();
        db.close();
      }
    });
  }

  // Ticket 646: a call whose project route rejects answers its sender at once, and the cause is kept
  // on a failed span, never on the wire.
  class WireFault extends Error {
    override name = "WireFault";
  }

  const rejected = fc.constantFrom(
    { name: "Error", make: (message: string): Error => new Error(message) },
    { name: "TypeError", make: (message: string): Error => new TypeError(message) },
    { name: "WireFault", make: (message: string): Error => new WireFault(message) },
  );
  const FRAME = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32000, message: "unreachable", data: { reason: "unreachable" } },
  });

  const refusedCall = async (fault: Error) => {
    const w = await world(),
      db = new DatabaseSync(":memory:"),
      sent: string[] = [];
    let attached = online(w, "client-test");
    const ws = {
      deserializeAttachment: () => attached,
      serializeAttachment: (a: typeof Attached.Type) => {
        attached = a;
      },
      send: (text: string) => {
        sent.push(text);
      },
      close: () => {},
    };
    // oxlint-disable-next-line fabrika/no-type-assertions -- Node fixture supplies the hibernating socket and SQL members consumed by Gateway
    const ctx = {
      id: { name: "gateway-test" },
      storage: storage(db),
      getWebSockets: () => [ws],
      getTags: () => ["session-test", "tab-a", w.key.fingerprint],
      getWebSocketAutoResponseTimestamp: () => new Date(42),
    } as unknown as DurableObjectState;
    // oxlint-disable-next-line fabrika/no-type-assertions -- this Node RPC double has no workerd namespace brand
    const project = {
      getByName: () => ({
        settingsStart: async () => StartsTest.reply(await Effect.runPromise(settings(w.env))),
        route: async () => {
          throw fault;
        },
      }),
    } as unknown as Env["PROJECT"];
    // oxlint-disable-next-line fabrika/no-type-assertions -- Node socket double implements attachment, send and close without workerd's socket brand
    const socket = ws as unknown as WebSocket;
    const runtime = connectionRuntime(ctx, { ...w.env, PROJECT: project }, await Effect.runPromise(settings(w.env)));

    try {
      const gateway = await runtime.runPromise(ConnectionService),
        before = w.recorded.length;
      const frame = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ledger.read", params: { stream: "x", after: 0 } });
      await runtime.runPromise(gateway.message(socket, frame));
      return { sent, spans: w.recorded.slice(before) };
    } finally {
      await runtime.dispose();
      db.close();

      for (const close of closers.splice(0).reverse()) {
        await close();
      }
    }
  };

  it("a call whose project route fails answers exactly refused unreachable, and none of the failure's text reaches the client", async () => {
    await fc.assert(
      fc.asyncProperty(
        rejected,
        fc.string({ minLength: 8, maxLength: 64 }).filter((text) => !FRAME.includes(text)),
        async (kind, text) => {
          const { sent } = await refusedCall(kind.make(text));
          expect(sent).toEqual([FRAME]);
          expect(sent.join("")).not.toContain(text);
        },
      ),
      { seed: 119120, numRuns: 20 },
    );
  });

  it("that call records one failed gateway.refused span whose error.type is the rejected error's name, and no text of it in a tag", async () => {
    await fc.assert(
      fc.asyncProperty(rejected, fc.string({ minLength: 8, maxLength: 64 }), async (kind, text) => {
        const { spans } = await refusedCall(kind.make(text));
        const refused = spans.filter((row) => row.name === "gateway.refused");
        expect(refused).toHaveLength(1);
        expect(refused[0]).toMatchObject({ ok: false, attributes: { "error.type": kind.name } });
        // Failure text is deletable content (P37), never a span tag.
        expect(
          Object.values(refused[0]!.attributes).filter((tag) => typeof tag === "string" && tag.includes(text)),
        ).toEqual([]);
      }),
      { seed: 119120, numRuns: 20 },
    );
  });
});
