// Ticket 402 (P34 on the Worker path), next/. Outside only: real workerd, sockets, object storage,
// alarms and the private local instance capability, set up the way P12's instance-records test is.
// No directly constructed runner and no raw Miniflare stands in for the instance.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import type { From } from "@kampus/libfabrika/processes/Mailbox";
import { Effect, Layer, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { describe, expect } from "vitest";
import { heldPort } from "./port.test-support.ts";
import * as RecordWireTest from "./record-wire.test-support.ts";
import { killedMoment, killWorkerd } from "./workerd.test-support.ts";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const SENT = "2026-11-09T04:00:00.000Z";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const PROJECT = "p34-workers";
const PROGRAM = "p34/poison-fixture";
// The fixture declares its own limit; the Worker's default policy says 3.
const LIMIT = 2;
// Bounded waits tied to observable facts. Backoff is 100 to 800 ms, so this is generous.
const WAIT = 25_000;

const field = (value: Buffer | string) => {
  const body = Buffer.from(value),
    n = Buffer.alloc(4);
  n.writeUInt32BE(body.length);
  return Buffer.concat([n, body]);
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
      const v = Buffer.alloc(4);
      v.writeUInt32BE(1);
      const packet = Buffer.concat([
        Buffer.from("SSHSIG"),
        v,
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

type Key = ReturnType<typeof identity>;

// A small program that throws a TypeError on "throw" and counts on "inc". It declares
// maxDeliveries, so the box's declaration must carry the program's own limit.
const poisonSource = [
  'import {Machine} from "@demlik/tea/effect";',
  'import {Schema} from "effect";',
  "const Model = Schema.Struct({count: Schema.Int});",
  'const Msg = Schema.Union([Schema.Struct({type: Schema.Literal("throw")}), Schema.Struct({type: Schema.Literal("inc")})]);',
  'const machine = Machine.make({model: Model, msg: Msg, cmds: [], init: (loaded) => [loaded ?? {count: 0}, []], update: {throw: () => {throw new TypeError("private failure P34");}, inc: (s) => [{count: s.count + 1}, []]}});',
  `export const program = {name: ${JSON.stringify(PROGRAM)}, maxDeliveries: ${LIMIT}, machine, state: {v: 1, schema: Model, upgrades: []}, msg: Msg, view: {data: Model, select: (s) => s}, refuse: () => null, inputs: {throw: {_tag: "write", schema: Msg, description: "Fail", personOnly: false}, inc: {_tag: "write", schema: Msg, description: "Count", personOnly: false}}, outputs: {}, writes: {}, wake: () => null};`,
].join("\n");

type Instance = any;

type Fixture = {
  readonly from: From;
  readonly hash: string;
  readonly start: (name: string) => Promise<string>;
};

const world = async (test: (instance: Instance, key: Key, fixture: Fixture) => Promise<void>) => {
  process.env.DO_NOT_TRACK = "1";
  const { localState } = await import("alchemy/State/LocalState");
  const { build } = await import("./build.ts");
  const { localInstance } = await import("./local-instance.ts");
  // A short home: a socket path has a 103-byte limit.
  const home = mkdtempSync(join(tmpdir(), "p34w-")),
    key = identity();
  const previousHome = process.env.FABRIKA_HOME;
  process.env.FABRIKA_HOME = home;

  try {
    symlinkSync(resolve(import.meta.dirname, "../node_modules"), join(home, "node_modules"));
    const poison = join(home, "poison.ts");
    writeFileSync(poison, poisonSource);
    const built = await Effect.runPromise(
      build({ out: join(home, "dist"), programs: { [PROGRAM]: poison } }).pipe(Effect.provide(NodeServices.layer)),
    );
    const code = built.programs[PROGRAM];
    expect(code, "the fixture program must be built").toBeDefined();
    await Effect.runPromise(
      Effect.gen(function* () {
        // Held until the scope closes, after the instance that binds it (finalizers run in reverse).
        const at = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
        const instance = yield* localInstance(
          built,
          RecordWireTest.startupFixture({
            home,
            name: PROJECT,
            person: PERSON,
            founder: key.line,
            window: key.raw,
            port: at.port,
          }),
        );
        const from: From = {
          by: key.fingerprint,
          for: PERSON,
          sentAt: SENT,
          seen: 0,
          parent: null,
          traceId: TRACE,
          build: built.build,
        };
        yield* Effect.promise(() =>
          test(instance, key, {
            from,
            hash: code!.hash,
            start: async (name) => {
              const started = await Reflect.get(instance.project(PROJECT), "start")(
                {
                  _tag: "first",
                  id: `start-${name}`,
                  name,
                  code: { program: PROGRAM, hash: code!.hash },
                },
                from,
              );
              return Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(started).process;
            },
          }),
        );
      }).pipe(
        Effect.scoped,
        Effect.provide(localState()),
        Effect.provide(SecureRandom.layerWebCrypto),
        Effect.provide(NodeServices.layer),
      ),
    );
  } finally {
    // localInstance closed with its scope before its durable files go.
    rmSync(home, { recursive: true, force: true });

    if (previousHome === undefined) {
      delete process.env.FABRIKA_HOME;
    } else {
      process.env.FABRIKA_HOME = previousHome;
    }
  }
};

const pause = (ms = 50) => new Promise<void>((done) => setTimeout(done, ms));

/** Polls an observable fact. A timeout fails with the last observed state. */
const until = async <A>(
  message: string,
  look: () => Promise<A>,
  done: (value: A) => boolean,
  ms = WAIT,
): Promise<A> => {
  const end = Date.now() + ms;
  let last: { value: A } | { error: string } | null = null;

  while (Date.now() < end) {
    try {
      const value = await look();
      last = { value };

      if (done(value)) {
        return value;
      }
    } catch (error) {
      last = { error: String(error) };
    }

    await pause();
  }

  throw new Error(`${message}: no answer in ${ms} ms; last observed ${JSON.stringify(last)}`);
};

/** A real WebSocket client at the door, initialized with a signed hello. */
const wire = async (instance: Instance, key: Key, tab: string) => {
  const name = `/client/${encodeURIComponent(key.fingerprint)}/${tab}`;
  const socket = new WebSocket(instance.url.replace("http", "ws") + name);
  const frames: any[] = [];
  let closeCode: number | undefined,
    serial = 0;
  socket.addEventListener("message", (event) => {
    if (event.data !== "pong") {
      frames.push(JSON.parse(String(event.data)));
    }
  });
  socket.addEventListener("close", (event) => {
    closeCode = event.code;
  });
  socket.addEventListener("error", () => {
    closeCode ??= 1006;
  });
  const next = async (match: (frame: any) => boolean) => {
    const end = Date.now() + WAIT;

    while (Date.now() < end) {
      const index = frames.findIndex(match);

      if (index >= 0) {
        return frames.splice(index, 1)[0];
      }

      if (closeCode !== undefined) {
        throw new Error(`closed ${closeCode}`);
      }

      await pause(20);
    }

    throw new Error(`no frame in ${WAIT} ms; last frames ${JSON.stringify(frames.slice(-3))}`);
  };
  const call = async (method: string, params: unknown) => {
    const id = ++serial;
    socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return next((frame) => frame.id === id);
  };
  const hello = async () => {
    const nonce = (await next((frame) => frame.method === "challenge")).params.nonce;
    expect(
      (
        await call("initialize", {
          versions: [1],
          has: ["seal"],
          ping: "30s",
          key: key.raw,
          tab,
          nonce,
          platform: "headless",
          os: "linux",
          sentAt: SENT,
          signed: key.proof(`fabrika-hello\n${instance.url}\n${tab}\n${nonce}`),
        })
      ).error,
    ).toBeUndefined();
  };
  // A socket whose hello fails is closed here: no caller holds it to close.
  await hello().catch((error: unknown) => {
    socket.close();
    throw error;
  });
  return { call, close: () => socket.close() };
};

const facts = async (instance: Instance, stream: string) =>
  ((await instance.project(PROJECT).read(stream, 0, "audit")) as Array<any>).map((row) => ({
    ...row.body,
    _tag: row._tag,
  }));

const restarts = async (instance: Instance, name: string) =>
  (await facts(instance, `processes/${name}`)).filter((fact) => fact._tag === "restarted");

const livePid = async (instance: Instance, name: string): Promise<string | undefined> =>
  ((await instance.project(PROJECT).info()) as Array<any>).find((row) => row.name === name)?.process;

const send = (pid: string, letter: string, type: "throw" | "inc") => ({
  pid,
  letter,
  m: { type },
  sentAt: SENT,
  seen: 0,
});

const range = (n: number) => Array.from({ length: n }, (_, at) => at);

/** The same instance `world` builds, with every resource acquired in the test's scope: a home,
 *  FABRIKA_HOME, a held port, the platform layers and the local instance. They are given back in the
 *  opposite order, so the instance closes before its port and its durable files go. */
const worldScoped = Effect.gen(function* () {
  const home = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "p34w-"))),
    (dir) => Effect.sync(() => rmSync(dir, { recursive: true, force: true })),
  );
  yield* Effect.acquireRelease(
    Effect.sync(() => {
      const previous = process.env.FABRIKA_HOME;
      process.env.FABRIKA_HOME = home;
      process.env.DO_NOT_TRACK = "1";
      return previous;
    }),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) {
          delete process.env.FABRIKA_HOME;
        } else {
          process.env.FABRIKA_HOME = previous;
        }
      }),
  );
  const { localState } = yield* Effect.promise(() => import("alchemy/State/LocalState"));
  const { build } = yield* Effect.promise(() => import("./build.ts"));
  const { localInstance } = yield* Effect.promise(() => import("./local-instance.ts"));
  const key = identity();
  // Held until the scope closes, after the instance that binds it (finalizers run in reverse).
  const at = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
  symlinkSync(resolve(import.meta.dirname, "../node_modules"), join(home, "node_modules"));
  const poison = join(home, "poison.ts");
  writeFileSync(poison, poisonSource);
  const built = yield* build({ out: join(home, "dist"), programs: { [PROGRAM]: poison } }).pipe(
    Effect.provide(NodeServices.layer),
  );
  const code = built.programs[PROGRAM];
  expect(code, "the fixture program must be built").toBeDefined();
  const context = yield* Layer.build(
    localState().pipe(Layer.provideMerge(SecureRandom.layerWebCrypto), Layer.provideMerge(NodeServices.layer)),
  );
  const instance: Instance = yield* localInstance(
    built,
    RecordWireTest.startupFixture({
      home,
      name: PROJECT,
      person: PERSON,
      founder: key.line,
      window: key.raw,
      port: at.port,
    }),
  ).pipe(Effect.provideContext(context));
  const from: From = {
    by: key.fingerprint,
    for: PERSON,
    sentAt: SENT,
    seen: 0,
    parent: null,
    traceId: TRACE,
    build: built.build,
  };
  const fixture: Fixture = {
    from,
    hash: code!.hash,
    start: async (name) => {
      const started = await Reflect.get(instance.project(PROJECT), "start")(
        { _tag: "first", id: `start-${name}`, name, code: { program: PROGRAM, hash: code!.hash } },
        from,
      );
      return Schema.decodeUnknownSync(Schema.Struct({ process: Schema.String }))(started).process;
    },
  };
  return { instance, key, fixture, home };
});

/** A real WebSocket client at the door, closed when the test's scope closes. */
const wired = (instance: Instance, key: Key, tab: string) =>
  Effect.acquireRelease(
    Effect.promise(() => wire(instance, key, tab)),
    (c) => Effect.sync(() => c.close()),
  );

/** The same, once workerd is back: a new socket until the hello is answered (the proxy refuses while it
 *  restarts). A socket whose hello fails is closed by `wire`; no answer in WAIT fails the test. */
const reconnected = (instance: Instance, key: Key, tab: string) =>
  Effect.acquireRelease(
    Effect.promise(() =>
      until(
        "a hello answered after the kill",
        () => wire(instance, key, tab),
        () => true,
      ),
    ),
    (c) => Effect.sync(() => c.close()),
  );

/** The raw rows of a stream, as the audit reader gives them: id, tag and body. */
const rows = async (instance: Instance, stream: string) =>
  (await instance.project(PROJECT).read(stream, 0, "audit")) as Array<{ id: string; _tag: string; body: any }>;

/** Waits with `ledger.wait` after the last rev seen for `restarted {after}` on a process name. No such
 *  fact in WAIT fails the test with the rows it saw, so a missing restart is a failure, never a hang. */
const restartedAfter = (c: Awaited<ReturnType<typeof wire>>, name: string, after: string) =>
  Effect.promise(async () => {
    const end = Date.now() + WAIT,
      seenRows: Array<unknown> = [];
    let seen = 0;

    while (Date.now() < end) {
      const read = await c.call("ledger.read", { stream: `processes/${name}`, after: seen });
      expect(read.error, `reading processes/${name}`).toBeUndefined();
      const found = (read.result.entries as Array<any>).find(
        (entry) => entry._tag === "restarted" && entry.body.after === after,
      );

      if (found !== undefined) {
        return found as { _tag: string; rev: number; body: { process: string; after: string; name: string } };
      }

      if (read.result.entries.length > 0) {
        seenRows.push(...read.result.entries.map((entry: any) => entry._tag));
        seen = read.result.entries.at(-1).rev;
      } else {
        expect((await c.call("ledger.wait", { stream: `processes/${name}`, after: seen })).error).toBeUndefined();
      }
    }

    throw new Error(`no restarted after ${after} on ${name} in ${WAIT} ms; saw ${JSON.stringify(seenRows)}`);
  });

/** Live means it also accepts a healthy input: an info row alone is not enough. */
const healthy = async (
  c: Awaited<ReturnType<typeof wire>>,
  pid: string,
  letter: string,
): Promise<{ rev: number; count: number }> => {
  const before = await c.call("view.open", { pid });
  expect(before.error, `view.open on ${pid}`).toBeUndefined();
  const sent = await c.call("process.send", send(pid, letter, "inc"));
  expect(sent, `healthy letter ${letter} on ${pid}`).toMatchObject({ result: { _tag: "accepted" } });
  const after = await c.call("view.open", { pid });
  expect(after).toMatchObject({ result: { view: { count: before.result.view.count + 1 } } });
  return { rev: sent.result.rev, count: after.result.view.count };
};

describe("ticket 402: P34 supervision on the real Worker path", () => {
  // scenario: ticket 402, recovery through the real local instance. A fixed case: it checks platform
  // composition, object storage, Worker RPC and real alarms, which generated Node laws cannot.
  it("scenario: ticket 402 plant (omit recovery options, fresh storage per successor, old writer pid): poison mail reaches dead, refuses its sender, restarts and accepts healthy mail", async () => {
    await world(async (instance, key, fixture) => {
      const name = "poison:1";
      const first = await fixture.start(name);
      const c = await wire(instance, key, "supervision");

      try {
        // 1. The first throw fails delivery. It is not accepted and writes no dead row.
        const poison = send(first, "poison", "throw");
        const one = await c.call("process.send", poison);
        expect(one.result?._tag, "a throwing step is never accepted").not.toBe("accepted");
        expect(await facts(instance, `${first}/dead`)).toEqual([]);

        // 2. The real alarm restarts it: one restarted fact naming the old ID and a new live ID.
        const [restarted] = await until(
          "one restarted fact after the first throw",
          () => restarts(instance, name),
          (rows) => rows.length >= 1,
        );
        const second = String(restarted.process);
        expect(restarted).toMatchObject({ _tag: "restarted", after: first, name });
        expect(second).not.toBe(first);
        expect(await restarts(instance, name)).toHaveLength(1);
        await until(
          "the successor is the live process",
          () => livePid(instance, name),
          (pid) => pid === second,
        );

        // 3. The same logical letter, resent through the door after replacement, throws at the
        // limit: one dead row on the failing process's stream, with its checked fields.
        const two = await c.call("process.send", poison);
        // 4. The sender is refused with dead.
        expect(two).toMatchObject({ error: { data: { reason: "dead" } } });
        const dead = await until(
          "one dead row on the failing process's stream",
          () => facts(instance, `${second}/dead`),
          (rows) => rows.length >= 1,
        );
        expect(dead).toEqual([
          {
            _tag: "dead",
            process: second,
            program: PROGRAM,
            name,
            tries: LIMIT,
            limit: LIMIT,
            m: "poison",
            build: fixture.hash,
            errors: ["TypeError", "TypeError"],
            // The brain writes the row; `asked` keeps the key that asked for it (process-manager.ts).
            asked: expect.stringMatching(/^SHA256:/),
          },
        ]);
        expect(await facts(instance, `${first}/dead`)).toEqual([]);
        // A further resend gives the same answer without another step or dead row.
        expect(await c.call("process.send", poison)).toMatchObject({
          error: { data: { reason: "dead" } },
        });
        expect(await facts(instance, `${second}/dead`)).toHaveLength(1);

        // 5. The next alarm finishes recovery. The new live ID accepts a healthy letter.
        const rows = await until(
          "a second restarted fact after the dead letter",
          () => restarts(instance, name),
          (found) => found.length >= 2,
        );
        expect(rows[1]).toMatchObject({ _tag: "restarted", after: second, name });
        const third = String(rows[1].process);
        expect(new Set([first, second, third]).size).toBe(3);
        await until(
          "the third process is live",
          () => livePid(instance, name),
          (pid) => pid === third,
        );
        const accepted = await healthy(c, third, "healthy");
        expect(accepted.count).toBe(1);
        const inbox = (await facts(instance, `${name}/inbox`)).length;

        // Abort and reopen the object: counts and accepted history survive.
        await instance
          .process(third)
          .abort()
          .catch(() => undefined);
        expect(await c.call("process.send", poison)).toMatchObject({
          error: { data: { reason: "dead" } },
        });
        expect(await c.call("process.send", send(third, "healthy", "inc"))).toMatchObject({
          result: { _tag: "accepted", rev: accepted.rev },
        });
        expect(await c.call("view.open", { pid: third })).toMatchObject({
          result: { view: { count: 1 } },
        });
        expect(await facts(instance, `${second}/dead`)).toHaveLength(1);
        expect(await facts(instance, `${name}/inbox`)).toHaveLength(inbox);
        expect(await restarts(instance, name)).toHaveLength(2);
        expect(await livePid(instance, name)).toBe(third);
      } finally {
        c.close();
      }
    });
  }, 180_000);

  // scenario: ticket 402 tests the complete trusted Process RPC chain and its saved request.
  it("scenario: ticket 402 plant (omit one handoff, init in the loader box, repeat the start): trusted restart through the Process binding starts the new init once per request ID", async () => {
    await world(async (instance, key, fixture) => {
      const name = "restart:1";
      const first = await fixture.start(name);
      const c = await wire(instance, key, "restart");

      try {
        // Change the model, so the re-folded state is visible.
        await healthy(c, first, "before-restart");
        expect(await c.call("view.open", { pid: first })).toMatchObject({
          result: { view: { count: 1 } },
        });
        const request = { id: "restart-1", build: fixture.hash };
        await instance.process(first).restart(request);
        const [restarted] = await until(
          "one restarted fact after a trusted restart",
          () => restarts(instance, name),
          (rows) => rows.length >= 1,
        );
        const second = String(restarted.process);
        expect(restarted).toMatchObject({ _tag: "restarted", after: first, name });
        expect(second).not.toBe(first);
        await until(
          "the restarted process is live",
          () => livePid(instance, name),
          (pid) => pid === second,
        );
        // The new init re-folds the accepted letter (P34, runner-supervision.test.ts), then a
        // healthy letter is accepted on the new ID.
        expect(await c.call("view.open", { pid: second })).toMatchObject({
          result: { view: { count: 1 } },
        });
        await healthy(c, second, "after-restart");
        // Repeating the request ID makes no second replacement.
        await instance.process(second).restart(request);
        await instance.process(first).restart(request);
        await pause(1_500);
        expect(await restarts(instance, name)).toHaveLength(1);
        expect(await livePid(instance, name)).toBe(second);
        expect(await c.call("view.open", { pid: second })).toMatchObject({
          result: { view: { count: 2 } },
        });
      } finally {
        c.close();
      }
    });
  }, 180_000);

  // scenario: workerd eviction must exercise the actual stored marker. The marker is written
  // through Process.activity, which syncs storage, and the platform abort cuts just before the step.
  it("scenario: ticket 402 plant (ignore the marker, use a timer fiber, count one attempt twice): a saved stepping marker becomes one interrupted recovery after a platform abort", async () => {
    await world(async (instance, key, fixture) => {
      const name = "abort:1";
      const first = await fixture.start(name);
      const c = await wire(instance, key, "abort");

      try {
        await healthy(c, first, "before-abort");
        await instance.process(first).activity({
          _tag: "stepping",
          process: first,
          letter: "cut",
          build: fixture.hash,
        });
        await instance
          .process(first)
          .abort()
          .catch(() => undefined);
        // Any call wakes the object; the stored marker, not this call, causes the recovery.
        await c.call("view.open", { pid: first });
        const [restarted] = await until(
          "one restarted fact after the interrupted step",
          () => restarts(instance, name),
          (rows) => rows.length >= 1,
        );
        const second = String(restarted.process);
        expect(restarted).toMatchObject({ _tag: "restarted", after: first, name });
        expect(second).not.toBe(first);
        await until(
          "the successor is live",
          () => livePid(instance, name),
          (pid) => pid === second,
        );
        await healthy(c, second, "after-abort");
        // Aborting again does not count the same interrupted attempt twice.
        await instance
          .process(second)
          .abort()
          .catch(() => undefined);
        await c.call("view.open", { pid: second });
        await pause(1_500);
        expect(await restarts(instance, name)).toHaveLength(1);
        expect(await livePid(instance, name)).toBe(second);
        expect(await facts(instance, `${first}/dead`)).toEqual([]);
      } finally {
        c.close();
      }
    });
  }, 180_000);

  // scenario: workerd killed inside a step (ticket 646). The marker a mid-step kill leaves is written through
  // Process.activity, as test 402's abort case does, and read back before a real SIGKILL, so the moment is
  // certain every run. It refuses the one letter that first wakes the name, restarts once, and accepts its resend.
  // It runs on the real clock (it.live): the runtime waits a moment before it starts the new workerd, and
  // it.effect's test clock never moves, so under it the restart never comes.
  it.live(
    "scenario: ticket 646 plant (ignore the marker, refuse a live name, count one attempt twice): workerd killed inside a step refuses one letter, restarts once and accepts its one resend",
    () =>
      Effect.gen(function* () {
        const { instance, key, fixture, home } = yield* worldScoped;
        const name = "kill:1";
        const first = yield* Effect.promise(() => fixture.start(name));
        const before = yield* wired(instance, key, "before");
        const letter = (n: number) => send(first, `k-${n}`, "inc");
        const placed = new Map<number, { rev: number; pos: number }>();

        for (const n of range(10)) {
          const sent = yield* Effect.promise(() => before.call("process.send", letter(n)));
          expect(sent, `k-${n} before the kill`).toMatchObject({ result: { _tag: "accepted" } });
          placed.set(n, { rev: sent.result.rev, pos: sent.result.pos });
        }

        yield* Effect.promise(() =>
          instance.process(first).activity({ _tag: "stepping", process: first, letter: "k-10", build: fixture.hash }),
        );
        // recover reads storage and wakes nothing, so the marker is on disk before the kill.
        expect(yield* Effect.promise(() => instance.process(first).recover())).toMatchObject({
          _tag: "interrupted",
          letter: "k-10",
        });
        yield* killWorkerd(process.pid);
        const after = yield* reconnected(instance, key, "after");
        // Before the first send, the rows the wake reads say the kill cut k-10, the marker recover() read.
        expect(yield* killedMoment(home, name, first)).toEqual({ _tag: "inside", letter: "k-10" });

        // Settled letters are answered from the door's saved bindings and never wake the Process object.
        for (const n of range(10)) {
          expect(yield* Effect.promise(() => after.call("process.send", letter(n)))).toMatchObject({
            result: { _tag: "accepted", ...placed.get(n) },
          });
        }

        // k-10 is the first call into the object: it sees the marker and is the one refusal.
        expect(yield* Effect.promise(() => after.call("process.send", letter(10)))).toMatchObject({
          error: { data: { reason: "unreachable" } },
        });
        const restarted = yield* restartedAfter(after, name, first);
        const second = restarted.body.process;
        expect(restarted).toMatchObject({ _tag: "restarted", body: { after: first, name } });
        expect(second).not.toBe(first);

        for (const n of range(10).map((at) => at + 10)) {
          expect(
            yield* Effect.promise(() => after.call("process.send", letter(n))),
            `k-${n} after the restart`,
          ).toMatchObject({
            result: { _tag: "accepted" },
          });
        }

        const inbox = yield* Effect.promise(() => rows(instance, `${name}/inbox`));
        expect(inbox).toHaveLength(20);
        expect(new Set(inbox.map((row) => row.id)).size).toBe(20);
        expect(yield* Effect.promise(() => restarts(instance, name))).toHaveLength(1);
        expect(yield* Effect.promise(() => livePid(instance, name))).toBe(second);
        expect(yield* Effect.promise(() => after.call("view.open", { pid: second }))).toMatchObject({
          result: { view: { count: 20 } },
        });
        expect(yield* Effect.promise(() => facts(instance, `${first}/dead`))).toEqual([]);
        expect(yield* Effect.promise(() => facts(instance, `${second}/dead`))).toEqual([]);
      }),
    180_000,
  );
});
