// P12, next/. Outside only: every law needs workerd, sockets and a fresh FABRIKA_HOME.
// Every wire law starts the real dev.ts, never a raw Miniflare substitute.
// CLI fixture contract: --name, --person, --founder (public SSH line), --window (public raw key),
// and the plan's --port. These are bootstrap settings, never a public signing capability.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Id } from "@kampus/libfabrika";
import { Entry, PAGE } from "@kampus/libfabrika/ledger/Log";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { heldPort } from "./port.test-support.ts";

const APP = resolve(import.meta.dirname, "..");
const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";
const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const SENT = "2026-11-08T04:00:00.000Z";

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

afterEach(async () => {
  for (const ws of sockets.splice(0)) {
    ws.close();
  }

  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) {
      continue;
    }

    child.kill("SIGTERM");
    await new Promise<void>((done) => child.once("exit", () => done()));
  }

  for (const h of homes.splice(0)) {
    rmSync(h, { recursive: true, force: true });
  }

  // Last, so the pair stays held until every instance that used its port is gone.
  for (const release of ports.splice(0)) {
    await Effect.runPromise(release);
  }
});

const unusedPort = async () => {
  const held = await Effect.runPromise(heldPort());
  ports.push(held.release);
  return held.port;
};

const instance = async (saved?: { key: ReturnType<typeof identity>; home: string; port: number }) => {
  readFileSync(join(APP, "dev.ts"), "utf8");
  const key = saved?.key ?? identity();
  const home = saved?.home ?? mkdtempSync(join(tmpdir(), "p12-w-"));
  homes.push(home);
  const port = saved?.port ?? (await unusedPort());
  const url = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, FABRIKA_HOME: home, DO_NOT_TRACK: "1" };
  delete env.TYPESAFE_API_KEY;
  delete env.FABRIKA_FOREGROUND;
  delete env.CLOUDFLARE_API_TOKEN;
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
    ],
    { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  children.push(child);
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

// Read only the named public metadata tables. Never inspect general storage or key rows.
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
  error?: { data?: { reason: string }; message?: string };
};

class Client {
  readonly frames: Array<Frame | string> = [];
  private serial = 0;
  // Node's WebSocket fires `error` on a failed upgrade (the proxy's 502 while workerd
  // restarts) but can stay CONNECTING with no `close`, so `error` counts as closed.
  private closed = false;
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
    this.ws.addEventListener("error", () => {
      this.closed = true;
    });
    this.ws.addEventListener("close", () => {
      this.closed = true;
    });
    this.ws.addEventListener("message", ({ data }) => {
      this.frames.push(data === "pong" ? "pong" : JSON.parse(String(data)));
    });
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

      await pause();
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

      await pause();
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
  return (started!.body as { process: string }).process;
};

const send = (c: Client, pid: string, letter: string, m: unknown = { type: "inc" }, seen = 0) =>
  c.call("process.send", { pid, letter, m, sentAt: SENT, seen, traceId: TRACE });

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
    const accepted: Array<{ rev: number; pos: number }> = [];

    for (let n = 0; n < PAGE + 3; n++) {
      accepted.push(placing(await send(c, pid, `page-${n}`)));
    }

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
  });
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
        by: s.key.fingerprint,
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

    // Only POST /grant and GET /grant/client/KEY reach the grant routes; the rest get the page.
    expect(await (await fetch(s.url)).text()).toBe("fabrika");
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
  it("scenario: p13/p81 plant: acknowledge before append or restart twice; retry a killed mid-burst once", async ({
    signal,
  }) => {
    const s = await instance(),
      c = await connected(s),
      pid = await counter(c);
    const first = (await read(c, "gateway/brain")).find((row) => row._tag === "started")!;
    const firstStart = (first.body as { start: string }).start;
    const accepted = new Map<string, { rev: number; pos: number }>();
    const pending = Array.from({ length: 20 }, (_, n) => {
      const id = `kill-${n}`;
      return send(c, pid, id)
        .then((r) => {
          accepted.set(id, placing(r));
        })
        .catch(() => undefined);
    });
    await pause(30);
    const rows = execFileSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" }).split("\n");
    const descendants = new Set([s.child.pid!]);

    for (let round = 0; round < rows.length; round++) {
      for (const row of rows) {
        const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(row);

        if (m && descendants.has(Number(m[2]))) {
          descendants.add(Number(m[1]));
        }
      }
    }

    const workerd = rows
      .filter((row) => /\/workerd(?:\s|$)/.test(row))
      .map((row) => Number(row.trim().split(/\s+/)[0]))
      .filter((p) => descendants.has(p));
    expect(workerd).toHaveLength(1);
    process.kill(workerd[0]!, "SIGKILL");
    await Promise.all(pending);
    let resumed: Client | undefined;

    for (;;) {
      try {
        resumed = await connected(s, "after-crash");
        break;
      } catch {
        await pause();
      }
    }

    for (let n = 0; n < 20; n++) {
      const id = `kill-${n}`,
        now = placing(await send(resumed, pid, id));

      if (accepted.has(id)) {
        expect(now).toEqual(accepted.get(id));
      }
    }

    const inbox = await read(resumed, "counter:1/inbox");
    expect(inbox).toHaveLength(20);
    expect(new Set(inbox.map((r) => r.id)).size).toBe(20);
    expect((await view(resumed, pid)).view.count).toBe(20);
    expect(await counter(resumed)).toBe(pid);
    let starts: Entry[] = [];

    // Replacement events arrive on the outbox's periodic flush, after traffic can recover.
    // The enclosing test's existing timeout bounds this wait.
    for (;;) {
      signal.throwIfAborted();
      starts = (await read(resumed, "gateway/brain")).filter((r) => r._tag === "started");

      if (starts.some((row) => (row.body as { after: string | null }).after === firstStart)) {
        break;
      }

      await pause();
    }

    expect(starts).toHaveLength(2);
    expect(starts[1]!.body).toMatchObject({
      after: firstStart,
      build: expect.any(String),
      reason: "crash",
    });
  });
});
