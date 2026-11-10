// Ticket 402 (P34 on the Worker path), next/. Outside only: real workerd, sockets, object storage,
// alarms and the private local stage capability, set up the way P12's stage-records test is.
// No directly constructed runner and no raw Miniflare instance stand in for the stage.
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import type { From } from "@kampus/libfabrika/coordination";
import { Effect, Schema } from "effect";
import { SecureRandom } from "effect/crypto";
import { describe, expect, it } from "vitest";

const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const SENT = "2026-11-09T04:00:00.000Z";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const PROJECT = "p34-workers";
const PROGRAM = "poison-fixture";
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

type Stage = any;

type Fixture = {
  readonly from: From;
  readonly hash: string;
  readonly start: (name: string) => Promise<string>;
};

const world = async (test: (stage: Stage, key: Key, fixture: Fixture) => Promise<void>) => {
  process.env.DO_NOT_TRACK = "1";
  const { localState } = await import("alchemy/State/LocalState");
  const { build } = await import("./build.ts");
  const { localStage } = await import("./local-stage.ts");
  // A short home: a socket path has a 103-byte limit.
  const home = mkdtempSync(join(tmpdir(), "p34w-")),
    key = identity();
  const previousHome = process.env.FABRIKA_HOME;
  process.env.FABRIKA_HOME = home;

  try {
    const listener = createServer();
    await new Promise<void>((done, fail) => {
      listener.once("error", fail);
      listener.listen(0, "127.0.0.1", done);
    });
    const at = listener.address();

    if (at === null || typeof at === "string") {
      throw new Error("no TCP port");
    }

    await new Promise<void>((done) => listener.close(() => done()));
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
        const stage = yield* localStage(built, {
          home,
          name: PROJECT,
          person: PERSON,
          founder: key.line,
          window: key.raw,
          port: at.port,
        });
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
          test(stage, key, {
            from,
            hash: code!.hash,
            start: async (name) => {
              const started = await Reflect.get(stage.project(PROJECT), "start")(
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
    // localStage closed with its scope before its durable files go.
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
const until = async <A>(what: string, look: () => Promise<A>, done: (value: A) => boolean, ms = WAIT): Promise<A> => {
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

  throw new Error(`${what}: no answer in ${ms} ms; last observed ${JSON.stringify(last)}`);
};

/** A real WebSocket client at the door, initialized with a signed hello. */
const wire = async (stage: Stage, key: Key, tab: string) => {
  const name = `/client/${encodeURIComponent(key.fingerprint)}/${tab}`;
  const socket = new WebSocket(stage.url.replace("http", "ws") + name);
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
        signed: key.proof(`fabrika-hello\n${stage.url}\n${tab}\n${nonce}`),
      })
    ).error,
  ).toBeUndefined();
  return { call, close: () => socket.close() };
};

const facts = async (stage: Stage, stream: string) =>
  ((await stage.project(PROJECT).read(stream, 0, "audit")) as Array<any>).map((row) => ({
    ...row.body,
    _tag: row._tag,
  }));

const restarts = async (stage: Stage, name: string) =>
  (await facts(stage, `processes/${name}`)).filter((fact) => fact._tag === "restarted");

const livePid = async (stage: Stage, name: string): Promise<string | undefined> =>
  ((await stage.project(PROJECT).info()) as Array<any>).find((row) => row.name === name)?.process;

const send = (pid: string, letter: string, type: "throw" | "inc") => ({
  pid,
  letter,
  m: { type },
  sentAt: SENT,
  seen: 0,
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
  // scenario: ticket 402, recovery through the real local stage. A fixed case: it checks platform
  // composition, object storage, Worker RPC and real alarms, which generated Node laws cannot.
  it("scenario: ticket 402 plant (omit recovery options, fresh storage per successor, old writer pid): poison mail reaches dead, refuses its sender, restarts and accepts healthy mail", async () => {
    await world(async (stage, key, fixture) => {
      const name = "poison:1";
      const first = await fixture.start(name);
      const c = await wire(stage, key, "supervision");

      try {
        // 1. The first throw fails delivery. It is not accepted and writes no dead row.
        const poison = send(first, "poison", "throw");
        const one = await c.call("process.send", poison);
        expect(one.result?._tag, "a throwing step is never accepted").not.toBe("accepted");
        expect(await facts(stage, `${first}/dead`)).toEqual([]);

        // 2. The real alarm restarts it: one restarted fact naming the old ID and a new live ID.
        const [restarted] = await until(
          "one restarted fact after the first throw",
          () => restarts(stage, name),
          (rows) => rows.length >= 1,
        );
        const second = String(restarted.process);
        expect(restarted).toMatchObject({ _tag: "restarted", after: first, name });
        expect(second).not.toBe(first);
        expect(await restarts(stage, name)).toHaveLength(1);
        await until(
          "the successor is the live process",
          () => livePid(stage, name),
          (pid) => pid === second,
        );

        // 3. The same logical letter, resent through the door after replacement, throws at the
        // limit: one dead row on the failing process's stream, with its checked fields.
        const two = await c.call("process.send", poison);
        // 4. The sender is refused with dead.
        expect(two).toMatchObject({ error: { data: { why: "dead" } } });
        const dead = await until(
          "one dead row on the failing process's stream",
          () => facts(stage, `${second}/dead`),
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
        expect(await facts(stage, `${first}/dead`)).toEqual([]);
        // A further resend gives the same answer without another step or dead row.
        expect(await c.call("process.send", poison)).toMatchObject({
          error: { data: { why: "dead" } },
        });
        expect(await facts(stage, `${second}/dead`)).toHaveLength(1);

        // 5. The next alarm finishes recovery. The new live ID accepts a healthy letter.
        const rows = await until(
          "a second restarted fact after the dead letter",
          () => restarts(stage, name),
          (found) => found.length >= 2,
        );
        expect(rows[1]).toMatchObject({ _tag: "restarted", after: second, name });
        const third = String(rows[1].process);
        expect(new Set([first, second, third]).size).toBe(3);
        await until(
          "the third process is live",
          () => livePid(stage, name),
          (pid) => pid === third,
        );
        const accepted = await healthy(c, third, "healthy");
        expect(accepted.count).toBe(1);
        const inbox = (await facts(stage, `${name}/inbox`)).length;

        // Abort and reopen the object: counts and accepted history survive.
        await stage
          .process(third)
          .abort()
          .catch(() => undefined);
        expect(await c.call("process.send", poison)).toMatchObject({
          error: { data: { why: "dead" } },
        });
        expect(await c.call("process.send", send(third, "healthy", "inc"))).toMatchObject({
          result: { _tag: "accepted", rev: accepted.rev },
        });
        expect(await c.call("view.open", { pid: third })).toMatchObject({
          result: { view: { count: 1 } },
        });
        expect(await facts(stage, `${second}/dead`)).toHaveLength(1);
        expect(await facts(stage, `${name}/inbox`)).toHaveLength(inbox);
        expect(await restarts(stage, name)).toHaveLength(2);
        expect(await livePid(stage, name)).toBe(third);
      } finally {
        c.close();
      }
    });
  }, 180_000);

  // scenario: ticket 402 tests the complete trusted Process RPC chain and its saved request.
  it("scenario: ticket 402 plant (omit one handoff, init in the loader box, repeat the start): trusted restart through the Process binding starts the new init once per request ID", async () => {
    await world(async (stage, key, fixture) => {
      const name = "restart:1";
      const first = await fixture.start(name);
      const c = await wire(stage, key, "restart");

      try {
        // Change the model, so the re-folded state is visible.
        await healthy(c, first, "before-restart");
        expect(await c.call("view.open", { pid: first })).toMatchObject({
          result: { view: { count: 1 } },
        });
        const request = { id: "restart-1", build: fixture.hash };
        await stage.process(first).restart(request);
        const [restarted] = await until(
          "one restarted fact after a trusted restart",
          () => restarts(stage, name),
          (rows) => rows.length >= 1,
        );
        const second = String(restarted.process);
        expect(restarted).toMatchObject({ _tag: "restarted", after: first, name });
        expect(second).not.toBe(first);
        await until(
          "the restarted process is live",
          () => livePid(stage, name),
          (pid) => pid === second,
        );
        // The new init re-folds the accepted letter (P34, runner-supervision.test.ts), then a
        // healthy letter is accepted on the new ID.
        expect(await c.call("view.open", { pid: second })).toMatchObject({
          result: { view: { count: 1 } },
        });
        await healthy(c, second, "after-restart");
        // Repeating the request ID makes no second replacement.
        await stage.process(second).restart(request);
        await stage.process(first).restart(request);
        await pause(1_500);
        expect(await restarts(stage, name)).toHaveLength(1);
        expect(await livePid(stage, name)).toBe(second);
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
    await world(async (stage, key, fixture) => {
      const name = "abort:1";
      const first = await fixture.start(name);
      const c = await wire(stage, key, "abort");

      try {
        await healthy(c, first, "before-abort");
        await stage.process(first).activity({
          _tag: "stepping",
          process: first,
          letter: "cut",
          build: fixture.hash,
        });
        await stage
          .process(first)
          .abort()
          .catch(() => undefined);
        // Any call wakes the object; the stored marker, not this call, causes the recovery.
        await c.call("view.open", { pid: first });
        const [restarted] = await until(
          "one restarted fact after the interrupted step",
          () => restarts(stage, name),
          (rows) => rows.length >= 1,
        );
        const second = String(restarted.process);
        expect(restarted).toMatchObject({ _tag: "restarted", after: first, name });
        expect(second).not.toBe(first);
        await until(
          "the successor is live",
          () => livePid(stage, name),
          (pid) => pid === second,
        );
        await healthy(c, second, "after-abort");
        // Aborting again does not count the same interrupted attempt twice.
        await stage
          .process(second)
          .abort()
          .catch(() => undefined);
        await c.call("view.open", { pid: second });
        await pause(1_500);
        expect(await restarts(stage, name)).toHaveLength(1);
        expect(await livePid(stage, name)).toBe(second);
        expect(await facts(stage, `${first}/dead`)).toEqual([]);
      } finally {
        c.close();
      }
    });
  }, 180_000);
});
