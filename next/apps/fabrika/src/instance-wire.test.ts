// P12, next/. Outside only: every law needs workerd, sockets and a fresh FABRIKA_HOME.
// Every wire law starts the real dev.ts, never a raw Miniflare substitute.
// CLI fixture contract: --name, --person, --founder (public SSH line), --window (public raw key),
// and the plan's --port. These are bootstrap settings, never a public signing capability.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "@effect/vitest";
import { checklistView } from "@kampus/checklist";
import { Id } from "@kampus/libfabrika";
import { Entry, PAGE } from "@kampus/libfabrika/ledger/Log";
import { resolveName } from "@kampus/libfabrika/runtime/Client";
import { Clock, Deferred, Effect, Fiber, Schema } from "effect";
import { afterEach, describe, expect } from "vitest";
import { devServer, home, reader, suite } from "../e2e/p14.test-support.ts";
import { heldPort } from "./port.test-support.ts";
import { killedMoment, killWorkerd } from "./workerd.test-support.ts";

const APP = resolve(import.meta.dirname, "..");
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SENT = "2026-11-08T04:00:00.000Z";
// A bound on one wait for an observable fact after a kill, as worker-supervision's WAIT is.
const WAIT = 25_000;

it(
  "pinned: checklist stays reachable after its first add on the real dev.ts, including a later subscriber",
  { timeout: 240_000 },
  (context) =>
    suite(
      Effect.gen(function* () {
        const h = yield* home;
        const dev = yield* devServer(h);
        const first = yield* reader(h, dev);
        const name = "checklist:1";
        const pid = resolveName(
          yield* first.read(`processes/${name}`),
          name,
          (by) => by === "brain" || by.startsWith("brain:"),
        );
        expect(pid).not.toBeNull();
        const View = Schema.Struct({ result: Schema.Struct({ rev: Schema.Int, view: checklistView }) });
        yield* first.call("view.open", { pid });

        for (const [n, item] of ["milk", "bread"].entries()) {
          expect(
            yield* first.call("process.send", {
              pid,
              letter: `progress_${n}`,
              m: { type: "add", name: item },
              sentAt: SENT,
              seen: 0,
            }),
            `send ${n + 1} to the original process`,
          ).toMatchObject({ result: { _tag: "accepted" } });
          yield* Effect.sleep("100 millis");
          const second = yield* reader(h, dev);
          const opened = Schema.decodeUnknownSync(View)(yield* second.call("view.open", { pid }));
          expect(opened.result.view.items.map((row) => row.name)).toEqual(["milk", "bread"].slice(0, n + 1));
        }

        const inbox = yield* first.read(`${name}/inbox`);
        expect(inbox.filter((row) => row.id.startsWith("progress_")).map((row) => row.id)).toEqual([
          "progress_0",
          "progress_1",
        ]);
      }),
      context,
    ),
);

const field = (a: string | Buffer) => {
  const bytes = typeof a === "string" ? Buffer.from(a) : a;
  const size = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  return Buffer.concat([size, bytes]);
};

const identity = () => {
  const pair = generateKeyPairSync("ed25519");
  const raw = pair.publicKey.export({ format: "jwk" }).x!;
  const bytes = Buffer.from(raw, "base64url");
  const blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
  const fingerprint = `SHA256:${createHash("sha256").update(bytes).digest("base64").replace(/=+$/, "")}`;
  return {
    raw,
    fingerprint,
    line: `ssh-ed25519 ${blob.toString("base64")}`,
    proof: (text: string) => {
      const digest = createHash("sha512").update(text).digest();
      const signed = Buffer.concat([
        Buffer.from("SSHSIG"),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(digest),
      ]);
      const signature = Buffer.concat([field("ssh-ed25519"), field(sign(null, signed, pair.privateKey))]);
      const version = Buffer.alloc(4);
      version.writeUInt32BE(1);
      const packet = Buffer.concat([
        Buffer.from("SSHSIG"),
        version,
        field(blob),
        field("fabrika-client"),
        field(""),
        field("sha512"),
        field(signature),
      ]);
      return `-----BEGIN SSH SIGNATURE-----\n${packet
        .toString("base64")
        .match(/.{1,70}/g)!
        .join("\n")}\n-----END SSH SIGNATURE-----\n`;
    },
  };
};

const pause = (ms = 20) => new Promise<void>((done) => setTimeout(done, ms));

// Node's fetch drops a custom Host header (a forbidden header in the Fetch spec), so the
// wrong-host check sends its request with node:http, which sends the header as given.
const statusWithHost = (url: string, host: string) =>
  new Promise<number>((done, fail) => {
    const sent = request(url, { headers: { host } }, (response) => {
      response.resume();
      done(response.statusCode ?? 0);
    });
    sent.once("error", fail);
    sent.end();
  });

const children: Array<ChildProcess> = [];
const homes: Array<string> = [];
const ports: Array<Effect.Effect<void>> = [];
const sockets: Array<WebSocket> = [];

// What one instance holds: its dev.ts children, its homes and its held ports. The older cases share one
// set that `afterEach` gives back; a case written with `Effect.acquireRelease` owns its own.
type Held = { children: Array<ChildProcess>; homes: Array<string>; ports: Array<Effect.Effect<void>> };

const shared: Held = { children, homes, ports };

const giveBack = async (held: Held) => {
  for (const child of held.children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) {
      continue;
    }

    child.kill("SIGTERM");
    await new Promise<void>((done) => child.once("exit", () => done()));
  }

  for (const h of held.homes.splice(0)) {
    rmSync(h, { recursive: true, force: true });
  }

  // Last, so the pair stays held until every instance that used its port is gone.
  for (const release of held.ports.splice(0)) {
    await Effect.runPromise(release);
  }
};

afterEach(async () => {
  for (const ws of sockets.splice(0)) {
    ws.close();
  }

  await giveBack(shared);
});

const unusedPort = async (held: Held) => {
  const port = await Effect.runPromise(heldPort());
  held.ports.push(port.release);
  return port.port;
};

type Saved = { key: ReturnType<typeof identity>; home: string; port: number };

const launch = async (
  held: Held,
  saved?: Saved,
  rateLimit = { limit: 100_000, window: 60_000 },
  source: "flags" | "env" | "file" = "flags",
) => {
  readFileSync(join(APP, "dev.ts"), "utf8");
  const key = saved?.key ?? identity();
  const home = saved?.home ?? mkdtempSync(join(tmpdir(), "p12-w-"));
  held.homes.push(home);
  const port = saved?.port ?? (await unusedPort(held));
  const url = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, FABRIKA_HOME: home, DO_NOT_TRACK: "1" };
  delete env.TYPESAFE_API_KEY;
  delete env.FABRIKA_FOREGROUND;
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.FABRIKA_GATEWAY_LIMIT;
  delete env.FABRIKA_GATEWAY_WINDOW;

  if (source === "env") {
    env.FABRIKA_GATEWAY_LIMIT = String(rateLimit.limit);
    env.FABRIKA_GATEWAY_WINDOW = String(rateLimit.window);
  }

  if (source === "file") {
    writeFileSync(join(home, "fabrika.toml"), `[gateway]\nlimit = ${rateLimit.limit}\nwindow = ${rateLimit.window}\n`);
  }

  const child = spawn(
    process.execPath,
    [
      join(APP, "dev.ts"),
      "--port",
      String(port),
      "--name",
      "p12-wire",
      "--person",
      PERSON,
      "--founder",
      key.line,
      "--window",
      key.raw,
      ...(source === "flags"
        ? ["--gateway.limit", String(rateLimit.limit), "--gateway.window", String(rateLimit.window)]
        : []),
    ],
    { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  held.children.push(child);
  let output = "";
  child.stdout!.on("data", (b: Buffer) => {
    output += b.toString();
  });
  child.stderr!.on("data", (b: Buffer) => {
    output += b.toString();
  });

  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`P12 dev.ts did not start: ${output}`);
    }

    try {
      // The page is served while startup is still flushing the lifecycle outbox.
      // dev.ts emits ready only after that flush. Read history after its ready message.
      if (output.includes(`{"ready":${JSON.stringify(url)},"build":`) && (await fetch(url)).ok) {
        break;
      }
    } catch {
      /* Listener is not ready. */
    }

    await pause();
  }

  return { key, url, home, child, port, output: () => output };
};

const instance = (saved?: Saved) => launch(shared, saved);

// Read only the named public metadata tables. Never inspect general storage or key rows. The crash cases
// read two more rows through `killedMoment`: the name's `process_recovery` row and its object's `activity` row.
const savedRows = (home: string, table: "gateway_bindings" | "dev_clients") => {
  const rows: Array<Record<string, unknown>> = [];

  for (const entry of readdirSync(home, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(sqlite|db)$/.test(entry.name)) {
      continue;
    }

    const db = new DatabaseSync(join(entry.parentPath, entry.name), { readOnly: true });

    try {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) {
        continue;
      }

      rows.push(
        ...db
          .prepare(
            table === "gateway_bindings"
              ? "SELECT letter,value FROM gateway_bindings"
              : "SELECT client,connection FROM dev_clients",
          )
          .all(),
      );
    } finally {
      db.close();
    }
  }

  return rows;
};

type Frame = {
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: { data?: { reason: string; retryAfter?: number }; message?: string };
};

class Client {
  readonly frames: Array<Frame | string> = [];
  private serial = 0;
  // Node's WebSocket fires `error` on a failed upgrade (the proxy's 502 while workerd
  // restarts) but can stay CONNECTING with no `close`, so `error` counts as closed.
  private closed = false;
  // A caller waits on the socket's own events (open, frame, error, close), never on a timer.
  private readonly waiting: Array<() => void> = [];
  private readonly ws: WebSocket;
  private readonly base: string;
  private readonly key: ReturnType<typeof identity>;
  private readonly tab: string;

  constructor(base: string, key: ReturnType<typeof identity>, tab: string) {
    this.base = base;
    this.key = key;
    this.tab = tab;
    this.ws = new WebSocket(`${base.replace("http", "ws")}/client/${encodeURIComponent(key.fingerprint)}/${tab}`);
    sockets.push(this.ws);
    this.ws.addEventListener("open", () => this.wake());
    this.ws.addEventListener("error", () => {
      this.closed = true;
      this.wake();
    });
    this.ws.addEventListener("close", () => {
      this.closed = true;
      this.wake();
    });
    this.ws.addEventListener("message", ({ data }) => {
      this.frames.push(data === "pong" ? "pong" : JSON.parse(String(data)));
      this.wake();
    });
  }

  private wake() {
    for (const done of this.waiting.splice(0)) {
      done();
    }
  }

  /** The socket's next event: it opened, a frame arrived, or it closed. */
  private changed() {
    return new Promise<void>((done) => this.waiting.push(done));
  }

  async next(test: (f: Frame | string) => boolean): Promise<any> {
    for (;;) {
      const at = this.frames.findIndex(test);

      if (at >= 0) {
        return this.frames.splice(at, 1)[0];
      }

      if (this.closed || this.ws.readyState === WebSocket.CLOSED) {
        throw new Error("wire closed before answer");
      }

      await this.changed();
    }
  }

  async challenge() {
    return (await this.next((f) => typeof f !== "string" && f.method === "challenge")).params.nonce as string;
  }

  hello(nonce?: string, overrides: object = {}) {
    const challenge = nonce === undefined ? Effect.promise(() => this.challenge()) : Effect.succeed(nonce);
    return challenge.pipe(
      Effect.flatMap((n) =>
        Effect.promise(() =>
          this.call("initialize", {
            versions: [1],
            has: ["seal"],
            ping: "30s",
            key: this.key.raw,
            tab: this.tab,
            nonce: n,
            platform: "headless",
            os: "linux",
            sentAt: SENT,
            signed: this.key.proof(`fabrika-hello\n${this.base}\n${this.tab}\n${n}`),
            ...overrides,
          }),
        ),
      ),
    );
  }

  async call(method: string, params: unknown): Promise<Frame> {
    const id = ++this.serial;

    while (this.ws.readyState === WebSocket.CONNECTING) {
      if (this.closed) {
        throw new Error("wire closed before open");
      }

      await this.changed();
    }

    this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return this.next((f) => typeof f !== "string" && f.id === id);
  }

  ping() {
    this.ws.send("ping");
    return this.next((f) => f === "pong");
  }

  close() {
    this.ws.close();
  }
}

const connected = async (s: Awaited<ReturnType<typeof instance>>, tab = "tab-a") => {
  const client = new Client(s.url, s.key, tab);
  const hello = await Effect.runPromise(client.hello());
  expect(hello.error).toBeUndefined();
  return client;
};

const read = async (client: Client, stream: string, after = 0): Promise<ReadonlyArray<typeof Entry.Type>> => {
  const response = await client.call("ledger.read", { stream, after });
  expect(response.error).toBeUndefined();
  return Schema.decodeUnknownSync(Schema.Array(Entry))(response.result.entries);
};

const counter = async (c: Client) => {
  const rows = await read(c, "processes/counter:1");
  const started = rows.findLast((r) => r._tag === "started" && (r.body as { name?: string }).name === "counter:1");
  expect(started, "instance must start the real counter:1").toBeDefined();
  // P40: the registered name stays `counter:1`; the code it runs is the core pack's `fabrika/counter`.
  expect(started!.body).toMatchObject({ program: "fabrika/counter" });
  return (started!.body as { process: string }).process;
};

const send = (c: Client, pid: string, letter: string, m: unknown = { type: "inc" }, seen = 0) =>
  c.call("process.send", { pid, letter, m, sentAt: SENT, seen, traceId: TRACE });

const ratePolicy = { limit: 4, window: 1000 };
type Call = { sent: number; replied: number; reply: Frame };

const timed = Effect.fnUntraced(function* (c: Client, pid: string, letter: string) {
  const sent = yield* Clock.currentTimeMillis;
  const reply = yield* Effect.promise(() => send(c, pid, letter));
  return { sent, replied: yield* Clock.currentTimeMillis, reply };
});

const spent = Effect.fnUntraced(function* (c: Client, pid: string, letter: string) {
  const allowed: Array<Call> = [];

  for (let n = 0; n < 10 * ratePolicy.limit; n += ratePolicy.limit + 1) {
    const sent = yield* Clock.currentTimeMillis;
    // The socket is already open. Send the whole batch before waiting for any reply.
    const pending = yield* Effect.sync(() =>
      Array.from({ length: Math.min(ratePolicy.limit + 1, 10 * ratePolicy.limit - n) }, () => send(c, pid, letter)),
    );
    const calls = yield* Effect.forEach(
      pending,
      (reply) =>
        Effect.gen(function* () {
          const answer = yield* Effect.promise(() => reply);
          return { sent, replied: yield* Clock.currentTimeMillis, reply: answer };
        }),
      { concurrency: "unbounded" },
    );
    // Drain every reply: calls after the first refusal can still spend a later window's budget.
    allowed.push(...calls.filter((call) => !call.reply.error));
    const refused = calls.find((call) => call.reply.error);

    if (refused) {
      const last = calls.reduce((last, call) => (call.replied > last.replied ? call : last), refused);
      return { allowed, refused, last };
    }
  }

  return yield* Effect.die(new Error(`no refusal in ${10 * ratePolicy.limit} sends`));
});

const retryAfter = (call: Call) => {
  const delay = call.reply.error?.data?.retryAfter;
  expect(delay).toBeGreaterThan(0);
  expect(delay).toBeLessThanOrEqual(ratePolicy.window);
  return delay!;
};

const placing = (r: Frame) => {
  expect(r.error).toBeUndefined();
  expect(r.result).toMatchObject({
    _tag: "accepted",
    rev: expect.any(Number),
    pos: expect.any(Number),
  });
  return r.result as { rev: number; pos: number };
};

const view = async (c: Client, pid: string) => {
  const response = await c.call("view.open", { pid });
  expect(response.error).toBeUndefined();
  return response.result as { rev: number; view: { count: number } };
};

type Launched = Awaited<ReturnType<typeof instance>>;
type Placing = { rev: number; pos: number };

const range = (n: number) => Array.from({ length: n }, (_, at) => at);

/** A real dev.ts of its own, with its home and port, given back when the test's scope closes. */
const launched = Effect.acquireRelease(
  Effect.gen(function* () {
    const held: Held = { children: [], homes: [], ports: [] };
    const s = yield* Effect.promise(() => launch(held)).pipe(
      Effect.onError(() => Effect.promise(() => giveBack(held))),
    );
    return { s, held };
  }),
  ({ held }) => Effect.promise(() => giveBack(held)),
).pipe(Effect.map(({ s }) => s));

/** A signed-in socket on `s`, closed when the test's scope closes. */
const client = (s: Launched, tab: string) =>
  Effect.acquireRelease(
    Effect.promise(() => connected(s, tab)),
    (c) => Effect.sync(() => c.close()),
  );

// Only a real instance proves each settings source reaches the gateway across a reconnect.
// The module properties carry the generated limit and window behavior with 50 runs each.
it.live.each(["flags", "env", "file"] as const)(
  "scenario: T843 instance settings from %s survive reconnect and recover the same letter after its delay",
  (source) =>
    Effect.gen(function* () {
      const held: Held = { children: [], homes: [], ports: [] };
      const s = yield* Effect.acquireRelease(
        Effect.promise(() => launch(held, undefined, ratePolicy, source)),
        () => Effect.promise(() => giveBack(held)),
      );
      const c = yield* client(s, "budget-one");
      const pid = yield* Effect.promise(() => counter(c));
      const letter = `t843-${source}`;
      const settled = yield* spent(c, pid, letter);
      expect(settled.allowed.length).toBeGreaterThan(0);
      const accepted = settled.allowed[0]!.reply;
      placing(accepted);
      expect(settled.refused.reply.error?.data?.reason).toBe("rate_limited");
      yield* Effect.sleep(retryAfter(settled.refused) + 5);
      let previous = settled.last;
      const rounds: Array<string> = [];
      const times = ({ sent, replied, reply }: Call) => ({ sent, replied, retryAfter: reply.error?.data?.retryAfter });
      const round = yield* Effect.gen(function* () {
        for (;;) {
          const { allowed, refused } = yield* spent(c, pid, letter);
          const delay = retryAfter(refused);
          const second = yield* client(s, "budget-two");
          const again = yield* timed(second, pid, letter);
          rounds.push(
            JSON.stringify({
              previous: times(previous),
              allowed: allowed.map(times),
              refused: times(refused),
              again: times(again),
            }),
          );
          expect(allowed.length).toBeGreaterThan(0);

          // These bounds use the refusal's window, including the time spent waiting for each reply.
          // The last earlier call must precede its start: a discarded round's second socket can spend the next budget.
          if (
            previous.replied < refused.sent + delay - ratePolicy.window &&
            allowed[0]!.sent >= refused.replied + delay - ratePolicy.window &&
            again.replied < refused.sent + delay
          ) {
            return { allowed, refused, second, again };
          }

          previous = again;
          const last = again.reply.error?.data?.reason === "rate_limited" ? again : refused;
          const until = last.replied + retryAfter(last);
          yield* Effect.sleep(Math.max(0, until - (yield* Clock.currentTimeMillis)) + 5);
          second.close();
        }
      }).pipe(
        Effect.timeoutOrElse({
          duration: WAIT,
          orElse: () => Effect.die(new Error(`no single-window round in ${WAIT} ms; rounds: [${rounds.join(",")}]`)),
        }),
      );
      expect(round.allowed).toHaveLength(ratePolicy.limit);

      for (const call of round.allowed) {
        expect(call.reply.error).toBeUndefined();
        expect(call.reply.result).toEqual(accepted.result);
      }

      for (const refused of [round.refused, round.again]) {
        expect(refused.reply.error?.data?.reason).toBe("rate_limited");
        retryAfter(refused);
      }

      yield* Effect.logInfo(`T843 ${source}: ${rounds.length} rounds`, { rounds });
      yield* Effect.sleep(retryAfter(round.again) + 5);
      const recovered = yield* Effect.promise(() => send(round.second, pid, letter));
      expect(recovered.error).toBeUndefined();
      expect(recovered.result).toEqual(accepted.result);
      const inbox = yield* Effect.promise(() => read(round.second, "counter:1/inbox"));
      expect(inbox).toHaveLength(1);
    }),
);

/** The same, once workerd is back: tries a new socket until the hello is answered. No hello in WAIT
 *  fails the test with the last error, so a workerd that never comes back is a failure, never a hang. */
const reconnected = (s: Launched, tab: string) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const end = Date.now() + WAIT;
      let last: unknown = null;

      while (Date.now() < end) {
        try {
          return await connected(s, tab);
        } catch (error) {
          last = error;
          await pause();
        }
      }

      throw new Error(`no hello answered in ${WAIT} ms after the kill; last ${String(last)}`);
    }),
    (c) => Effect.sync(() => c.close()),
  );

const sendPlaced = (c: Client, pid: string, letter: string) =>
  Effect.promise(async () => placing(await send(c, pid, letter)));

/** A send settles as accepted, or as cut by the kill (the socket closed before its answer). Nothing else. */
type Settled = { _tag: "accepted"; placing: Placing } | { _tag: "cut" };

const sendSettled = (c: Client, pid: string, letter: string, answered: Deferred.Deferred<void>) =>
  Effect.promise(async (): Promise<Settled> => {
    const reply = await send(c, pid, letter).then(
      (r) => r,
      (error: unknown) => {
        if (error instanceof Error && error.message === "wire closed before answer") {
          return null;
        }

        throw error;
      },
    );
    return reply === null ? { _tag: "cut" } : { _tag: "accepted", placing: placing(reply) };
  }).pipe(Effect.tap((settled) => (settled._tag === "accepted" ? Deferred.succeed(answered, undefined) : Effect.void)));

/** Waits, with `ledger.wait` after the last rev seen, for a `restarted {after}` row. None in WAIT fails
 *  the test with the tags it saw, so a missing restart is a failure, never a hang. */
const restartedAfter = (c: Client, stream: string, after: string) =>
  Effect.promise(async () => {
    const end = Date.now() + WAIT,
      tags: Array<string> = [];
    let seen = 0;

    while (Date.now() < end) {
      const rows = await read(c, stream, seen);
      tags.push(...rows.map((row) => row._tag));
      const hit = rows.find((row) => row._tag === "restarted" && (row.body as { after?: string }).after === after);

      if (hit !== undefined) {
        return hit;
      }

      if (rows.length > 0) {
        seen = rows.at(-1)!.rev;
      } else {
        const waited = await c.call("ledger.wait", { stream, after: seen });

        if (waited.error !== undefined) {
          throw new Error(`waiting on ${stream}: ${waited.error.message}`);
        }
      }
    }

    throw new Error(`no restarted after ${after} on ${stream} in ${WAIT} ms; saw ${JSON.stringify(tags)}`);
  });

const restartedRows = (rows: ReadonlyArray<typeof Entry.Type>) => rows.filter((row) => row._tag === "restarted");

const crashStarts = (c: Client, firstStart: string) =>
  Effect.promise(async (signal) => {
    // Replacement events arrive on the outbox's periodic flush, after traffic can recover.
    // The test's time limit bounds this wait.
    for (;;) {
      signal.throwIfAborted();
      const starts = (await read(c, "gateway/brain")).filter((r) => r._tag === "started");

      if (starts.some((row) => (row.body as { after: string | null }).after === firstStart)) {
        return starts;
      }

      await pause();
    }
  });

describe("P12 real dev.ts wire", () => {
  it("scenario: a new dev command links its lifecycle event to the previous runtime", async () => {
    const first = await instance(),
      c = await connected(first);
    const starts = (await read(c, "gateway/brain")).filter((row) => row._tag === "started");
    expect(starts).toHaveLength(1);
    c.close();
    first.child.kill("SIGTERM");
    await new Promise<void>((done) => first.child.once("exit", () => done()));
    const second = await instance(first),
      reopened = await connected(second, "reopened");
    const now = (await read(reopened, "gateway/brain")).filter((row) => row._tag === "started");
    expect(now).toHaveLength(2);
    expect(now[1]!.body).toMatchObject({ after: (starts[0]!.body as { start: string }).start });
  });
  it("scenario: p10 plant: save twice or accept changed content; return the original placing", async () => {
    const s = await instance(),
      c = await connected(s),
      pid = await counter(c);
    const first = placing(await send(c, pid, "once"));
    expect(placing(await send(c, pid, "once"))).toEqual(first);
    const changed = await send(c, pid, "once", { type: "dec" });
    expect(changed.error?.data?.reason ?? changed.result?.reason).toBe("id_reused");
    const rows = await read(c, "counter:1/inbox");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "once", rev: first.rev, pos: first.pos });
    expect((await view(c, pid)).view).toEqual({ count: 1 });
    const otherKey = identity(),
      other = new Client(s.url, otherKey, "other-key");
    expect((await Effect.runPromise(other.hello())).error?.data?.reason).toBe("not_granted");
    const knocked = await other.call("gateway.knock", { label: "Other client" });
    const { grantText } = await import("@kampus/libfabrika/access/Text");
    const text = grantText({
      id: "grant-other",
      key: otherKey.raw,
      for: PERSON,
      to: "p12-wire",
      as: "window",
      saw: {
        code: knocked.result.code,
        label: "Other client",
        location: "local",
        method: "command",
        check: "none",
        has: [],
      },
      sentAt: SENT,
    });
    const granted = await fetch(`${s.url}/grant`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, armored: s.key.proof(text) }),
    });
    expect(granted.ok).toBe(true);
    const notification = await other.next((f) => typeof f !== "string" && f.method === "client.granted");
    expect((await Effect.runPromise(other.hello(notification.params.nonce))).error).toBeUndefined();
    const identityChanged = await send(other, pid, "once");
    expect(identityChanged.error?.data?.reason ?? identityChanged.result?.reason).toBe("id_reused");
    expect(await read(c, "counter:1/inbox")).toHaveLength(1);
  });
  it("scenario: p11 plant: reverse or repeat a page, or stop at the first page", async () => {
    const s = await instance(),
      c = await connected(s),
      pid = await counter(c);
    // T890, L8. The PAGE + 3 sends start in order on one socket and are awaited together.
    // Three plants, each at the gateway's ledger read for a page, run once on a laptop and restored:
    // reverse a page (red: the second page has 256 entries, 3 expected); repeat a page, so the read
    // ignores `after` (red: 256 entries, 3 expected); stop at the first page (red: the second page
    // is empty, 3 expected).
    // Tried and survived: the same sends from two sockets, turn by turn, passed 3 runs of 3. Both
    // local sockets deliver in sending order, so this scenario cannot tell one socket from two and
    // claims nothing about the order of two.
    const accepted = (await Promise.all(Array.from({ length: PAGE + 3 }, (_, n) => send(c, pid, `page-${n}`)))).map(
      placing,
    );

    const first = await read(c, "counter:1/inbox");
    expect(first).toHaveLength(PAGE);
    const second = await read(c, "counter:1/inbox", first.at(-1)!.rev);
    expect(second).toHaveLength(3);
    expect([...first, ...second].map(({ rev, pos }) => ({ rev, pos }))).toEqual(
      accepted.map(({ rev, pos }) => ({ rev, pos })),
    );
    expect(accepted.map((a) => a.pos)).toEqual(Array.from({ length: PAGE + 3 }, (_, n) => n + 1));
    expect(accepted.every((a, n) => n === 0 || a.rev > accepted[n - 1]!.rev)).toBe(true);
    // Gateway input events occupy the intervening global revisions.
    expect(accepted.some((a, n) => n > 0 && a.rev > accepted[n - 1]!.rev + 1)).toBe(true);
    // The limit, from measured times. The time is the law's own work: a second page needs PAGE + 3 real
    // sends, and the gateway answers one socket's sends one at a time (sent all at once they took as long).
    // On main's CI, in 22 runs from 43365290308 to 43529835092, all while the client still polled for its
    // replies, this took 32.2 s at its fastest (43365290308) and 50.1 s at the median (43470989655), and was
    // cut at 60 s in 43489825701 and 43529835092. In the last of these the scenario before it took 13.9 s
    // against 6.6 s in 43528965610, 2.1 times, which puts this one near 112 s there. 180 s is 1.6 times
    // that, and what the real-workerd scenarios beside it have.
  }, 180_000);
  it("scenario: a parked wire wait receives the next append and a ready wait answers now", async () => {
    const s = await instance(),
      c = await connected(s),
      other = await connected(s, "tab-b"),
      pid = await counter(c);
    const first = placing(await send(c, pid, "before-wait"));
    const waiting = c.call("ledger.wait", { stream: "counter:1/inbox", after: first.rev });
    await other.call("ledger.read", { stream: "counter:1/inbox", after: 0 });
    expect(await send(other, pid, "bad-wait", { type: "unknown" })).toMatchObject({
      result: { _tag: "refused" },
    });
    expect(placing(await send(other, pid, "before-wait"))).toEqual(first);
    const next = placing(await send(other, pid, "wake-wait"));
    expect(await waiting).toMatchObject({ result: { rev: next.rev } });
    expect(await c.call("ledger.wait", { stream: "counter:1/inbox", after: 0 })).toMatchObject({
      result: { rev: next.rev },
    });
  });
  it("scenario: p14 wire plant: drop placing or use global revisions as patch positions", async () => {
    const s = await instance(),
      a = await connected(s),
      b = await connected(s, "tab-b"),
      pid = await counter(a);
    expect(await view(a, pid)).toEqual({ rev: 0, view: { count: 0 } });
    const replies = await Promise.all(Array.from({ length: 12 }, (_, n) => send(n % 2 ? a : b, pid, `burst-${n}`)));
    const placed = replies.map(placing).sort((x, y) => x.pos - y.pos);
    expect(placed.map((p) => p.pos)).toEqual(Array.from({ length: 12 }, (_, n) => n + 1));
    let count = 0;

    for (let pos = 1; pos <= 12; pos++) {
      const news = await a.next((f) => typeof f !== "string" && f.method === "view.patch");
      expect(news.params).toMatchObject({ base: pos - 1, rev: pos });

      for (const p of news.params.patch) {
        if (p.path === "/count") {
          count = p.value;
        } else if (p.path === "") {
          count = p.value.count;
        } else {
          throw new Error("unexpected counter patch");
        }
      }

      expect(count).toBe(pos);
    }

    expect((await view(b, pid)).view.count).toBe(12);
    expect(await read(a, "counter:1/inbox")).toHaveLength(12);
  });
  it("scenario: unauthenticated connections leave no input or span records", async () => {
    const s = await instance(),
      c = await connected(s);
    expect(await statusWithHost(s.url, "wrong.test")).toBe(421);
    expect((await fetch(s.url, { headers: { origin: "https://foreign.test" } })).status).toBe(403);
    // Every routed call is recorded, so reader c's own reads add rows here. Only rows
    // written by anyone other than c's key could come from a stranger.
    const notC = (rows: ReadonlyArray<typeof Entry.Type>) => rows.filter((r) => r.by !== s.key.fingerprint);
    const before = await read(c, "gateway/inputs");
    const traces = await c.call("spans.read", { chain: { _tag: "spans" }, after: 0 });
    const strangerKey = identity(),
      unknownKey = identity(),
      badKey = identity();
    const stranger = new Client(s.url, strangerKey, "pre-hello");
    await stranger.challenge();
    expect((await stranger.call("ledger.read", { stream: "processes", after: 0 })).error?.data?.reason).toBe(
      "no_hello",
    );
    const unknown = new Client(s.url, unknownKey, "ungranted");
    expect((await Effect.runPromise(unknown.hello())).error?.data?.reason).toBe("not_granted");
    const bad = new Client(s.url, badKey, "invalid-proof");
    const nonce = await bad.challenge();
    expect((await Effect.runPromise(bad.hello(nonce, { signed: "not a proof" }))).error?.data?.reason).toBe(
      "bad_signature",
    );
    const inputs = await read(c, "gateway/inputs");
    expect(inputs.length).toBeGreaterThan(before.length);
    expect(notC(inputs)).toEqual(notC(before));
    const after = await c.call("spans.read", { chain: { _tag: "spans" }, after: 0 });
    const keys = [strangerKey, unknownKey, badKey];
    const connections = savedRows(s.home, "dev_clients").filter((row) =>
      keys.some((key) => String(row.connection).includes(encodeURIComponent(key.fingerprint))),
    );
    expect(connections).toHaveLength(3);
    const identities = [
      ...keys.flatMap((key) => [key.raw, key.fingerprint]),
      ...connections.map((row) => String(row.client)),
    ];
    const attributed = (row: unknown) => identities.some((id) => JSON.stringify(row).includes(id));
    expect(after.result.spans.filter(attributed)).toEqual([]);
    // A planted unauthorized record with either identity must be found by this same predicate.
    expect(attributed({ attributes: { "fab.client": connections[0]!.client } })).toBe(true);
    expect(attributed({ attributes: { "fab.key": unknownKey.fingerprint } })).toBe(true);
    expect(traces.error).toBeUndefined();
    expect(await c.ping()).toBe("pong");
  });
  it("scenario: delivery and retry retain the original saved binding and nonzero seen revision", async () => {
    const s = await instance(),
      c = await connected(s),
      pid = await counter(c);
    const seen = placing(await send(c, pid, "seed")).rev;
    expect(seen).toBeGreaterThan(0);
    const accepted = placing(await send(c, pid, "metadata", { type: "inc" }, seen));
    const original = savedRows(s.home, "gateway_bindings").find((row) => row.letter === `${pid}/metadata`);
    expect(original).toBeDefined();
    const binding = JSON.parse(String(original!.value));
    // P17a saves the completed answer before replying; a retry reuses this settled binding.
    expect(binding).toMatchObject({
      by: { key: s.key.fingerprint },
      process: pid,
      seen,
      sentAt: SENT,
      state: { _tag: "settled", result: accepted },
    });
    await send(c, pid, "later", { type: "dec" });
    expect(placing(await send(c, pid, "metadata", { type: "inc" }, seen))).toEqual(accepted);
    expect(savedRows(s.home, "gateway_bindings").find((row) => row.letter === `${pid}/metadata`)).toEqual(original);
    const rows = await read(c, "counter:1/inbox");
    const row = rows.find((r) => r.id === "metadata")!;
    expect(row).toMatchObject({
      sentAt: SENT,
      seen,
      by: s.key.fingerprint,
      parent: binding.id,
      traceId: binding.span.traceId,
    });
    expect(row.traceId).toMatch(/^[0-9a-f]{32}$/);
    const inputs = await read(c, "gateway/inputs");
    expect(inputs.find((r) => r.id === row.parent)).toMatchObject({ traceId: row.traceId });
    const records = await c.call("spans.read", { chain: { _tag: "job", process: pid }, after: 0 });
    expect(records.result.spans.some((r: any) => r.traceId === row.traceId && r.name.includes("runner"))).toBe(true);
  });
  it("scenario: sealed program plant: unknown programs never fall back to a host import", async () => {
    const s = await instance(),
      c = await connected(s);
    // The trusted process API is exercised by instance-records, including an outbound probe program.
    const pid = Effect.runSync(
      Id.Generator.use((ids) => ids.next(Id.Process)).pipe(Effect.provide(Id.Generator.layer)),
    );
    const missing = await c.call("view.open", { pid });
    expect(missing.error).toBeDefined();

    for (const method of ["project.sign", "project.append", "process.start", "signer.sign"]) {
      const response = await c.call(method, {
        process: "counter:1",
        personOnly: false,
      });
      expect(response.error?.data?.reason).toBe("unknown_method");
    }
  });
  it("scenario: dev.ts plant: hide the ready line, grant on any POST, or exit 0 when the instance child fails", async () => {
    const s = await instance();
    const ready = `${JSON.stringify({ ready: s.url }).slice(0, -1)},"build":`;

    for (let n = 0; !s.output().includes(ready); n++) {
      expect(n, `no ready line on dev.ts stdout: ${s.output()}`).toBeLessThan(500);
      await pause();
    }

    // Only POST /grant and GET /grant/client/KEY reach the grant routes. P14 slice 2 (ticket 828): the
    // app's build carries its tab, so `/` is the built page and `/window.js` the script it loads, each
    // with its type and its ETag over the real wire; a write elsewhere still gets the plain answer.
    const root = await fetch(s.url);
    expect(root.status).toBe(200);
    expect(root.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const page = await root.text();
    expect(page, "/ is the tab's page").toContain('<script type="module" src="/window.js"></script>');
    expect(root.headers.get("etag")).toBe(`"${createHash("sha256").update(page).digest("hex")}"`);
    const script = await fetch(`${s.url}/window.js`);
    expect(script.status).toBe(200);
    expect(script.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    const scriptBody = await script.text();
    expect(script.headers.get("etag")).toBe(`"${createHash("sha256").update(scriptBody).digest("hex")}"`);
    expect(page, "the page names the script it loads by its build").toContain(
      `<meta name="fabrika-build" content="${createHash("sha256").update(scriptBody).digest("hex")}">`,
    );
    const posted = await fetch(`${s.url}/elsewhere`, { method: "POST", body: "{}" });
    expect(await posted.text()).toBe("fabrika");
    const home = mkdtempSync(join(tmpdir(), "p12-w-"));
    homes.push(home);
    const env: NodeJS.ProcessEnv = { ...process.env, FABRIKA_HOME: home, DO_NOT_TRACK: "1" };
    delete env.TYPESAFE_API_KEY;
    delete env.FABRIKA_FOREGROUND;
    delete env.CLOUDFLARE_API_TOKEN;
    const key = identity();
    // Port 0 is outside the settings range, so the instance child fails before it builds.
    const failed = spawn(
      process.execPath,
      [
        join(APP, "dev.ts"),
        "--port",
        "0",
        "--name",
        "p12-wire",
        "--person",
        PERSON,
        "--founder",
        key.line,
        "--window",
        key.raw,
      ],
      { cwd: APP, env, stdio: ["ignore", "ignore", "ignore"] },
    );
    children.push(failed);
    const code = await new Promise<number | null>((done) => failed.once("exit", (c) => done(c)));
    expect(code).not.toBe(0);
  });
  it.effect(
    "scenario: p13/p81 plant (acknowledge before append, restart on an idle marker, restart twice): workerd killed between steps loses nothing, restarts no process and keeps its pid",
    () =>
      // scenario reason: the only real dev.ts and real workerd with a real SIGKILL at a moment no step runs:
      // each answer follows its step's `idle` write, so the kill misses every step (ticket 646).
      Effect.gen(function* () {
        const s = yield* launched;
        const c = yield* client(s, "tab-a");
        const pid = yield* Effect.promise(() => counter(c));
        const firstStart = (yield* Effect.promise(() => read(c, "gateway/brain"))).find(
          (row) => row._tag === "started",
        )!;
        const accepted = new Map<string, Placing>();
        yield* Effect.forEach(
          range(10),
          (n) =>
            sendPlaced(c, pid, `kill-${n}`).pipe(Effect.tap((p) => Effect.sync(() => accepted.set(`kill-${n}`, p)))),
          { concurrency: "unbounded" },
        );
        yield* killWorkerd(s.child.pid!);
        const resumed = yield* reconnected(s, "after-crash");
        // Every answer was in before the kill, so the rows the wake reads say no step was cut.
        expect(yield* killedMoment(s.home, "counter:1", pid)).toEqual({ _tag: "between" });

        for (const n of range(20)) {
          const id = `kill-${n}`,
            now = yield* sendPlaced(resumed, pid, id);

          if (accepted.has(id)) {
            expect(now).toEqual(accepted.get(id));
          }
        }

        const inbox = yield* Effect.promise(() => read(resumed, "counter:1/inbox"));
        expect(inbox).toHaveLength(20);
        expect(new Set(inbox.map((r) => r.id)).size).toBe(20);
        expect((yield* Effect.promise(() => view(resumed, pid))).view.count).toBe(20);
        expect(yield* Effect.promise(() => counter(resumed))).toBe(pid);
        // The kill missed every step, so no process restarted.
        expect(restartedRows(yield* Effect.promise(() => read(resumed, "processes/counter:1")))).toEqual([]);
        const starts = yield* crashStarts(resumed, (firstStart.body as { start: string }).start);
        expect(starts).toHaveLength(2);
        expect(starts[1]!.body).toMatchObject({
          after: (firstStart.body as { start: string }).start,
          build: expect.any(String),
          reason: "crash",
        });
      }),
  );
  it.effect(
    "scenario: p13/p81 plant (refuse a live name, resend on any error, acknowledge before append): workerd killed mid-burst at an uncontrolled moment loses nothing",
    () =>
      // scenario reason: the only real-workerd kill with letters part way through the gateway and the runner.
      // The kill lands when the first answer of a 20-letter burst arrives, so where it cuts is not
      // controlled; the law is the invariants below, which hold wherever it lands (ticket 646).
      Effect.gen(function* () {
        const s = yield* launched;
        const c = yield* client(s, "tab-a");
        const pid = yield* Effect.promise(() => counter(c));
        const firstStart = (yield* Effect.promise(() => read(c, "gateway/brain"))).find(
          (row) => row._tag === "started",
        )!;
        const firstAnswer = yield* Deferred.make<void>();
        const fibers = yield* Effect.forEach(
          range(20),
          (n) => Effect.forkScoped(sendSettled(c, pid, `kill-${n}`, firstAnswer)),
          {
            concurrency: 1,
          },
        );
        yield* Deferred.await(firstAnswer);
        yield* killWorkerd(s.child.pid!);
        const before = yield* Effect.forEach(fibers, Fiber.join, { concurrency: "unbounded" });
        const resumed = yield* reconnected(s, "after-crash");
        // The old workerd is gone and nothing has called the object yet: read where the kill landed, from the
        // same committed rows the wake reads. The moment decides which of the two laws below this run must meet.
        const moment = yield* killedMoment(s.home, "counter:1", pid);
        const refused: Array<{ call: string; retry: Frame }> = [];
        // A refusal is the name restarting; the refused call's one retry waits for the fact that says so.
        const answered = (call: string, first: Frame, again: () => Promise<Frame>) =>
          Effect.gen(function* () {
            if (first.error === undefined) {
              return first;
            }

            expect(moment, `${call} refused after a kill between steps`).toMatchObject({ _tag: "inside" });
            expect(
              refused.map((r) => r.call),
              "exactly one call meets a refusal",
            ).toEqual([]);
            expect(first.error.data?.reason).toBe("unreachable");
            yield* restartedAfter(resumed, "processes/counter:1", pid);
            const retry = yield* Effect.promise(again);
            refused.push({ call, retry });
            return retry;
          });

        for (const n of range(20)) {
          const id = `kill-${n}`;
          const reply = yield* answered(id, yield* Effect.promise(() => send(resumed, pid, id)), () =>
            send(resumed, pid, id),
          );
          const now = placing(reply);
          const was = before[n]!;

          if (was._tag === "accepted") {
            expect(now).toEqual(was.placing);
          }
        }

        const inbox = yield* Effect.promise(() => read(resumed, "counter:1/inbox"));
        expect(inbox).toHaveLength(20);
        expect(new Set(inbox.map((r) => r.id)).size).toBe(20);
        // When the gateway answered every resend (each letter settled or held), the view is the first call
        // into the object: it wakes a cut step and is the one refusal, so it too waits for the fact.
        const opened = yield* answered(
          "view.open",
          yield* Effect.promise(() => resumed.call("view.open", { pid })),
          () => resumed.call("view.open", { pid }),
        );
        expect(opened.error).toBeUndefined();
        const live = yield* Effect.promise(() => counter(resumed));
        expect((yield* Effect.promise(() => view(resumed, live))).view.count).toBe(20);
        const restarted = restartedRows(yield* Effect.promise(() => read(resumed, "processes/counter:1"))).filter(
          (row) => (row.body as { after?: string }).after === pid,
        );

        if (moment._tag === "between") {
          // The kill missed every step: every resend and the view were accepted on the first try.
          expect(refused).toEqual([]);
          expect(restarted).toEqual([]);
          expect(live).toBe(pid);
        } else {
          // The kill cut a step: one call was refused, one restart followed, and its one retry was accepted.
          expect(refused.map((r) => r.call)).toHaveLength(1);
          expect(refused[0]!.retry.error).toBeUndefined();
          expect(restarted).toHaveLength(1);
          expect(live).toBe((restarted[0]!.body as { process: string }).process);
          expect(live).not.toBe(pid);
        }

        const starts = yield* crashStarts(resumed, (firstStart.body as { start: string }).start);
        expect(starts).toHaveLength(2);
        expect(starts[1]!.body).toMatchObject({
          after: (firstStart.body as { start: string }).start,
          build: expect.any(String),
          reason: "crash",
        });
      }),
  );
});
