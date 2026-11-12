// Experiment 275, lab code. A headless Node client of next/'s door: the same WebSocket, signed hello
// and JSON-RPC that next/apps/fabrika/e2e/instance.test.ts drives from a browser tab. Every door
// below (A, B and C) reaches the brain only through `Door.call`.
import { execFileSync } from "node:child_process";
import { createHash, webcrypto } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const subtle = webcrypto.subtle;
const enc = new TextEncoder();

const concat = (...parts: Array<Uint8Array>) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;

  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }

  return out;
};

const field = (data: string | Uint8Array) => {
  const body = typeof data === "string" ? enc.encode(data) : data;
  const n = new Uint8Array(4);
  new DataView(n.buffer).setUint32(0, body.length);
  return concat(n, body);
};

const b64 = (d: Uint8Array) => Buffer.from(d).toString("base64");

type Key = { readonly jwk: webcrypto.JsonWebKey; readonly pub: string };

/** The client's own key, made once and kept in the run's folder (a test key, never a person's). */
export const loadKey = async (file: string): Promise<Key> => {
  if (existsSync(file)) {
    return JSON.parse(readFileSync(file, "utf8"));
  }

  const pair = (await subtle.generateKey("Ed25519", true, ["sign", "verify"])) as webcrypto.CryptoKeyPair;
  const key = {
    jwk: await subtle.exportKey("jwk", pair.privateKey),
    pub: b64(new Uint8Array(await subtle.exportKey("raw", pair.publicKey))),
  };
  writeFileSync(file, JSON.stringify(key), { mode: 0o600 });
  return key;
};

export class DoorDown extends Error {}

export class Door {
  private socket: WebSocket | undefined;
  private serial = 0;
  private pending = new Map<number, (frame: any) => void>();
  readonly fingerprint: string;
  readonly raw: string;
  readonly url: string;
  readonly tab: string;
  private readonly key: webcrypto.CryptoKey;
  private readonly publicBytes: Uint8Array;

  private constructor(url: string, key: webcrypto.CryptoKey, publicBytes: Uint8Array, tab: string) {
    this.url = url;
    this.key = key;
    this.publicBytes = publicBytes;
    this.tab = tab;
    this.raw = b64(publicBytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
    this.fingerprint = `SHA256:${createHash("sha256").update(publicBytes).digest("base64").replace(/=+$/, "")}`;
  }

  static async make(url: string, key: Key, tab: string) {
    const priv = await subtle.importKey("jwk", key.jwk, "Ed25519", false, ["sign"]);
    return new Door(url, priv, new Uint8Array(Buffer.from(key.pub, "base64")), tab);
  }

  private async proof(text: string) {
    const blob = concat(field("ssh-ed25519"), field(this.publicBytes));
    const digest = new Uint8Array(await subtle.digest("SHA-512", enc.encode(text)));
    const payload = concat(enc.encode("SSHSIG"), field("fabrika-client"), field(""), field("sha512"), field(digest));
    const signed = new Uint8Array(await subtle.sign("Ed25519", this.key, payload));
    const version = new Uint8Array(4);
    new DataView(version.buffer).setUint32(0, 1);
    const packet = concat(
      enc.encode("SSHSIG"),
      version,
      field(blob),
      field("fabrika-client"),
      field(""),
      field("sha512"),
      field(concat(field("ssh-ed25519"), field(signed))),
    );
    return `-----BEGIN SSH SIGNATURE-----\n${(b64(packet).match(/.{1,70}/g) ?? []).join(
      "\n",
    )}\n-----END SSH SIGNATURE-----\n`;
  }

  private hello = async (nonce: string) =>
    this.call("initialize", {
      versions: [1],
      has: ["seal"],
      ping: "30s",
      key: this.raw,
      tab: this.tab,
      nonce,
      platform: "browser",
      os: "linux",
      sentAt: new Date().toISOString(),
      signed: await this.proof(`fabrika-hello\n${this.url}\n${this.tab}\n${nonce}`),
    });

  /** Opens the socket and says hello. Resolves with the hello's answer. */
  connect(onGranted?: () => void): Promise<any> {
    return new Promise((done, fail) => {
      const socket = new WebSocket(
        `${this.url.replace("http", "ws")}/client/${encodeURIComponent(this.fingerprint)}/${this.tab}`,
      );
      this.socket = socket;
      socket.onerror = () => fail(new DoorDown("socket"));
      socket.onclose = () => {
        for (const reply of this.pending.values()) {
          reply({ closed: true });
        }

        this.pending.clear();
        this.socket = undefined;
      };
      socket.onmessage = async ({ data }) => {
        if (data === "pong") {
          return;
        }

        const frame = JSON.parse(String(data));

        if (frame.method === "challenge") {
          done(await this.hello(frame.params.nonce));
        }

        if (frame.method === "client.granted") {
          await this.hello(frame.params.nonce);
          onGranted?.();
        }

        if (typeof frame.id === "number") {
          this.pending.get(frame.id)?.(frame);
          this.pending.delete(frame.id);
        }
      };
    });
  }

  get open() {
    return this.socket !== undefined && this.socket.readyState === WebSocket.OPEN;
  }

  close() {
    this.socket?.close();
  }

  call(method: string, params: unknown): Promise<any> {
    const socket = this.socket;

    if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new DoorDown("closed"));
    }

    return new Promise((done, fail) => {
      const id = ++this.serial;
      this.pending.set(id, (frame) => (frame.closed ? fail(new DoorDown("closed")) : done(frame)));
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }
}

/** Knocks, then grants this key with the founder's key through next/'s own grant.ts. */
export const grant = async (door: Door, founderKey: string, repo: string) => {
  let hello: Promise<unknown> = Promise.resolve();
  const granted = new Promise<void>((done) => {
    hello = door.connect(done);
  });
  // Knock once the first hello is answered (not_granted).
  await hello;
  const knock = await door.call("gateway.knock", { label: "exp-275" });

  if (knock.result === undefined) {
    throw new Error(`knock: ${JSON.stringify(knock)}`);
  }

  execFileSync(
    process.execPath,
    [
      join(repo, "next/apps/fabrika/grant.ts"),
      "client",
      door.url,
      door.fingerprint,
      `--code=${knock.result.code}`,
      "--label=exp-275",
      `--key=${founderKey}`,
    ],
    { cwd: join(repo, "next/apps/fabrika"), stdio: "ignore" },
  );
  await granted;
};
