// P12, next/. A browser protocol driver, not P14's window or P19's Electron test.
// The key is nonextractable and lives in real IndexedDB. grant.ts alone signs with a key path.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { chromium, type Browser, type Page } from "playwright";
import { afterEach, describe, expect, it } from "vitest";
import { heldPort } from "../src/port.test-support.ts";

interface BrowserDriver {
  readonly frames: Array<any>;
  readonly call: (method: string, params: unknown) => Promise<any>;
  readonly connections: () => number;
}

declare global {
  interface Window {
    readonly p12: BrowserDriver;
  }
}

const APP = resolve(import.meta.dirname, "..");

const children: Array<ChildProcess> = [],
  homes: Array<string> = [],
  ports: Array<Effect.Effect<void>> = [],
  browsers: Array<Browser> = [];

const pause = () => new Promise<void>((done) => setTimeout(done, 25));

afterEach(async () => {
  for (const b of browsers.splice(0)) {
    await b.close();
  }

  for (const c of children.splice(0)) {
    if (c.exitCode === null && c.signalCode === null) {
      c.kill("SIGTERM");
      await new Promise<void>((done) => c.once("exit", () => done()));
    }
  }

  for (const h of homes.splice(0)) {
    rmSync(h, { recursive: true, force: true });
  }

  // Last, so the pair stays held until the instance that used its port is gone.
  for (const release of ports.splice(0)) {
    await Effect.runPromise(release);
  }
});

const start = async () => {
  // Fail on the missing planned command before trying a socket the agent box may block.
  readFileSync(join(APP, "dev.ts"), "utf8");
  const home = mkdtempSync(join(tmpdir(), "p12-e-"));
  homes.push(home);
  const key = join(home, "person");
  execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]);
  const publicKey = readFileSync(`${key}.pub`, "utf8").trim();
  const at = await Effect.runPromise(heldPort());
  ports.push(at.release);
  const url = `http://127.0.0.1:${at.port}`;
  const env: NodeJS.ProcessEnv = { ...process.env, FABRIKA_HOME: home, DO_NOT_TRACK: "1" };
  delete env.TYPESAFE_API_KEY;
  delete env.FABRIKA_FOREGROUND;
  delete env.CLOUDFLARE_API_TOKEN;
  const child = spawn(
    process.execPath,
    [
      join(APP, "dev.ts"),
      "--port",
      String(at.port),
      "--name",
      "p12-browser",
      "--person",
      "person_01m6v5270hf3c8x2q7w9z4k5mn",
      "--founder",
      publicKey,
      "--window",
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ],
    { env, cwd: APP, stdio: ["ignore", "pipe", "pipe"] },
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
      if ((await fetch(url)).ok) {
        break;
      }
    } catch {
      /* Not listening yet. */
    }

    await pause();
  }

  const browser = await chromium.launch({ headless: true });
  browsers.push(browser);
  const context = await browser.newContext();
  // P12 has no window yet. The driver loads the instance's own plain `/`, only for its real
  // origin: Chromium blocks a WebSocket from a page faked with route.fulfill.
  return { home, key, url, env, child, context, output: () => output };
};

const driver = async (page: Page, url: string, tab: string) => {
  await page.goto(url);
  return page.evaluate(
    async ({ url, tab }) => {
      const bytes = (s: string) => new TextEncoder().encode(s);
      const concat = (...parts: Array<Uint8Array>) => {
        const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let at = 0;

        for (const part of parts) {
          result.set(part, at);
          at += part.length;
        }

        return result;
      };
      const field = (data: string | Uint8Array) => {
        const body = typeof data === "string" ? bytes(data) : data,
          n = new Uint8Array(4);
        new DataView(n.buffer).setUint32(0, body.length);
        return concat(n, body);
      };
      const b64 = (data: Uint8Array) => btoa(String.fromCharCode(...data));
      const db = await new Promise<IDBDatabase>((done, fail) => {
        const open = indexedDB.open("p12-client", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("keys");
        open.onsuccess = () => done(open.result);
        open.onerror = () => fail(open.error);
      });
      let pair = await new Promise<CryptoKeyPair | undefined>((done, fail) => {
        const get = db.transaction("keys").objectStore("keys").get("window");
        get.onsuccess = () => done(get.result);
        get.onerror = () => fail(get.error);
      });

      if (!pair) {
        pair = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]);
        await new Promise<void>((done, fail) => {
          const tx = db.transaction("keys", "readwrite");
          tx.objectStore("keys").put(pair, "window");
          tx.oncomplete = () => done();
          tx.onerror = () => fail(tx.error);
        });
      }

      db.close();
      const publicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
      const raw = b64(publicBytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
      const fingerprint = `SHA256:${b64(new Uint8Array(await crypto.subtle.digest("SHA-256", publicBytes))).replace(
        /=+$/,
        "",
      )}`;
      const key = pair.privateKey;
      const proof = async (text: string) => {
        const blob = concat(field("ssh-ed25519"), field(publicBytes));
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-512", bytes(text)));
        const payload = concat(bytes("SSHSIG"), field("fabrika-client"), field(""), field("sha512"), field(digest));
        const signed = new Uint8Array(await crypto.subtle.sign("Ed25519", key, payload));
        const version = new Uint8Array(4);
        new DataView(version.buffer).setUint32(0, 1);
        const packet = concat(
          bytes("SSHSIG"),
          version,
          field(blob),
          field("fabrika-client"),
          field(""),
          field("sha512"),
          field(concat(field("ssh-ed25519"), field(signed))),
        );
        return `-----BEGIN SSH SIGNATURE-----\n${b64(packet)
          .match(/.{1,70}/g)!
          .join("\n")}\n-----END SSH SIGNATURE-----\n`;
      };
      let serial = 0,
        connections = 0;
      const frames: Array<any> = [];
      let socket: WebSocket;
      const pending = new Map<number, (frame: any) => void>();
      const call = (method: string, params: unknown) =>
        new Promise<any>((done) => {
          const id = ++serial;
          pending.set(id, done);
          socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        });
      const hello = async (nonce: string) =>
        call("initialize", {
          versions: [1],
          has: ["seal"],
          ping: "30s",
          key: raw,
          tab,
          nonce,
          platform: "browser",
          os: "linux",
          sentAt: "2026-11-08T04:00:00.000Z",
          signed: await proof(`fabrika-hello\n${url}\n${tab}\n${nonce}`),
        });
      const connect = () =>
        new Promise<any>((done, fail) => {
          socket = new WebSocket(`${url.replace("http", "ws")}/client/${encodeURIComponent(fingerprint)}/${tab}`);
          connections++;
          socket.onerror = () => fail(new Error("WebSocket failed"));
          socket.onclose = () => {
            for (const reply of pending.values()) {
              reply({ closed: true });
            }

            pending.clear();
          };
          socket.onmessage = async ({ data }) => {
            if (data === "pong") {
              frames.push("pong");
              return;
            }

            const frame = JSON.parse(String(data));
            frames.push(frame);

            if (frame.method === "challenge") {
              done(await hello(frame.params.nonce));
            }

            if (frame.method === "client.granted") {
              frames.push({ method: "reinitialized", result: await hello(frame.params.nonce) });
            }

            if (typeof frame.id === "number") {
              pending.get(frame.id)?.(frame);
              pending.delete(frame.id);
            }
          };
        });
      const first = await connect();
      Object.assign(globalThis, {
        p12: {
          call,
          connect,
          frames,
          fingerprint,
          raw,
          connections: () => connections,
          close: () => socket.close(),
        },
      });
      return { first, fingerprint, raw, extractable: key.extractable };
    },
    { url, tab },
  );
};

const state = (page: Page) => page.evaluate(() => window.p12.frames);

const rpc = (page: Page, method: string, params: unknown) =>
  page.evaluate(async ({ method, params }) => window.p12.call(method, params), {
    method,
    params,
  });

describe("P12 real browser protocol", () => {
  it("scenario: p29 instance plant: notify the wrong key, issue one code per tab, or require reconnect after command grant", async () => {
    const s = await start(),
      a = await s.context.newPage(),
      b = await s.context.newPage();
    const first = await driver(a, s.url, "tab-a"),
      second = await driver(b, s.url, "tab-b");
    expect(first.extractable).toBe(false);
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.first.error.data.reason).toBe("not_granted");
    expect(second.first.error.data.reason).toBe("not_granted");
    const firstKnock = await rpc(a, "gateway.knock", { label: "Chromium" });
    const secondKnock = await rpc(b, "gateway.knock", { label: "Chromium" });
    const code = firstKnock.result.code;
    expect(secondKnock.result.code).toBe(code);
    const output = execFileSync(
      process.execPath,
      [
        join(APP, "grant.ts"),
        "client",
        s.url,
        first.fingerprint,
        `--code=${code}`,
        "--label=Chromium",
        `--key=${s.key}`,
      ],
      { env: s.env, cwd: APP, encoding: "utf8" },
    );
    expect(output).not.toContain("PRIVATE KEY");

    for (const page of [a, b]) {
      await page.waitForFunction(() => window.p12.frames.some((f: any) => f.method === "reinitialized"));
      const reinitialized = (await state(page)).find((f: any) => f.method === "reinitialized");
      expect(reinitialized.result.error).toBeUndefined();
      expect(await page.evaluate(() => window.p12.connections())).toBe(1);
    }

    const processes = await rpc(a, "ledger.read", { stream: "processes/counter:1", after: 0 });
    const started = processes.result.entries.find((r: any) => r._tag === "started" && r.body.name === "counter:1");
    // P40: the registered name stays `counter:1`; the code it runs is the core pack's `fabrika/counter`.
    expect(started.body.program).toBe("fabrika/counter");
    const pid = started.body.process;
    expect((await rpc(a, "view.open", { pid })).result).toEqual({ rev: 0, view: { count: 0 } });
    // W8 scenario: only a real clock can let the local runtime evict an idle Process.
    await a.waitForTimeout(15_000);
    const waiting = rpc(b, "ledger.wait", { stream: "counter:1/inbox", after: 0 });
    const accepted = await rpc(a, "process.send", {
      pid,
      letter: "browser-once",
      m: { type: "inc" },
      sentAt: "2026-11-08T04:00:00.000Z",
      seen: 0,
    });
    expect(accepted.result).toMatchObject({ _tag: "accepted", pos: 1 });
    expect((await waiting).result).toMatchObject({ rev: accepted.result.rev });
    // The original connection must receive the patch before a reload or another view.open.
    await a.waitForFunction(() => window.p12.frames.some((f: any) => f.method === "view.patch"));
    const idlePatch = (await state(a)).find((f: any) => f.method === "view.patch");
    expect(idlePatch.params).toMatchObject({ base: 0, rev: accepted.result.pos });
    expect(await a.evaluate(() => window.p12.connections())).toBe(1);
    const reloaded = await driver(a, s.url, "tab-a");
    expect(reloaded.fingerprint).toBe(first.fingerprint);
    expect(reloaded.first.error).toBeUndefined();
    const retry = await rpc(a, "process.send", {
      pid,
      letter: "browser-once",
      m: { type: "inc" },
      sentAt: "2026-11-08T04:00:00.000Z",
      seen: 0,
    });
    expect(retry.result).toEqual(accepted.result);
    expect((await rpc(a, "view.open", { pid })).result.view).toEqual({ count: 1 });
    expect(s.output()).not.toContain("PRIVATE KEY");
  });
});
