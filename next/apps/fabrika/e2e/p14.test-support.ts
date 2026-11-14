// P14 slice 2, next/ (ticket 828): the first-window suite's resources, each acquired in one Effect scope
// before any setup step can fail (0061). The temp home with its person key, the port, the real `dev.ts`
// instance, the headless browser, each profile (a browser context) and each tab (a page), released by
// the scope in reverse order.
//
// `resources.laws.test.ts` (L16) runs `first-window.test.ts` as a child process. It sets
// `P14_E2E_TRACE` to a file the fixture appends each acquisition (with its pid, port or home) and
// release to, and `P14_E2E_FAULT` to `{at, kind}`: right after acquiring `at`, fail setup (`setup`),
// fail the test (`test`), or wait to be interrupted (`hold`). Without them the fixture runs plainly.
import { type ChildProcess as NodeChildProcess, execFileSync, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { checklist } from "@kampus/checklist";
import { revokeText } from "@kampus/libfabrika/access/Text";
import { Entry, PAGE } from "@kampus/libfabrika/ledger/Log";
import { Chain } from "@kampus/libfabrika/telemetry/Trace";
import { Effect, FileSystem, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { type Browser, type BrowserContext, chromium, type Page, type WebSocket as PageSocket } from "playwright";
import type { TestContext } from "vitest";
import { heldPort } from "../src/port.test-support.ts";

const APP = resolve(import.meta.dirname, "..");
export const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

export const RESOURCES = ["home", "port", "server", "browser", "context", "page", "socket"] as const;
type Resource = (typeof RESOURCES)[number];

const Fault = Schema.Struct({
  at: Schema.Literals(RESOURCES),
  kind: Schema.Literals(["setup", "test", "hold", "timeout", "trace"]),
});

/** The fault the supervisor planted for this child, if any. */
export const fault =
  process.env.P14_E2E_FAULT === undefined
    ? undefined
    : Schema.decodeUnknownSync(Schema.fromJsonString(Fault))(process.env.P14_E2E_FAULT);

const trace = process.env.P14_E2E_TRACE;

class SetupFault extends Schema.TaggedError<SetupFault>()("SetupFault", { at: Schema.String }) {}

class Stopped extends Schema.TaggedError<Stopped>()("Stopped", { reason: Schema.String }) {}

class DevFailed extends Schema.TaggedError<DevFailed>()("DevFailed", { output: Schema.String }) {}

class KeygenFailed extends Schema.TaggedError<KeygenFailed>()("KeygenFailed", { exitCode: Schema.Number }) {}

const STOPS = ["SIGTERM", "SIGINT", "disconnect"] as const;

/** Fails once this worker is told to stop, so a race against the suite closes its scope first. */
export const stopped = Effect.callback<never, Stopped>((resume) => {
  const stops = STOPS.map((reason) => {
    const stop = () => resume(Effect.fail(new Stopped({ reason })));
    process.once(reason, stop);
    return () => process.off(reason, stop);
  });
  return Effect.sync(() => {
    for (const off of stops) {
      off();
    }
  });
});

/** Vitest aborts its signal on timeout. Wait for that interruption's finalizers before the worker exits. */
export const suite = <A>(body: Effect.Effect<A, unknown, import("effect").Scope.Scope>, context: TestContext) => {
  // oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: Vitest starts this scoped Effect with its cancellation signal
  const running = Effect.runPromise(
    Effect.scoped(
      body.pipe(
        Effect.tap(() =>
          fault?.kind === "test" ? Effect.die(new Error(`test fault after ${fault.at}`)) : Effect.void,
        ),
      ),
    ).pipe(Effect.raceFirst(stopped)),
    { signal: context.signal },
  );
  const finished = () =>
    // oxlint-disable-next-line fabrika/no-promises -- edge: Vitest cleanup waits for the same Promise after a timeout or failure
    running.then(
      () => {},
      () => {},
    );
  context.onTestFinished(finished, 90_000);
  return running;
};

const note = (row: Readonly<Record<string, unknown>>) =>
  Effect.sync(() => {
    if (trace !== undefined) {
      appendFileSync(trace, `${JSON.stringify(row)}\n`);
    }

    if (fault?.kind === "trace" && row.acquired === fault.at) {
      throw new SetupFault({ at: fault.at });
    }
  });

/** One owned resource: acquired, noted, then the planted fault if it names this one; released within
 *  10 s by the scope and noted again. The release is registered before the fault can fire. */
const owned = <A, E, R>(
  at: Resource,
  acquire: Effect.Effect<A, E, R>,
  release: (a: A) => Effect.Effect<unknown, unknown>,
  facts: (a: A) => Readonly<Record<string, unknown>> = () => ({}),
) =>
  Effect.acquireRelease(acquire, (a) =>
    release(a).pipe(Effect.timeout("10 seconds"), Effect.ignore, Effect.andThen(note({ released: at }))),
  ).pipe(
    Effect.tap((a) => note({ acquired: at, ...facts(a) })),
    Effect.tap(() =>
      fault?.at !== at
        ? Effect.void
        : fault.kind === "setup"
          ? Effect.fail(new SetupFault({ at }))
          : fault.kind === "hold" || fault.kind === "timeout"
            ? note({ holding: at }).pipe(Effect.andThen(Effect.never))
            : Effect.void,
    ),
  );

/** The env a child of the suite gets: the person's own, minus anything that could spend or deploy. */
const childEnv = (home: string, extra: Readonly<Record<string, string>>) => {
  const env: Record<string, string | undefined> = { ...process.env, FABRIKA_HOME: home, DO_NOT_TRACK: "1", ...extra };
  delete env.TYPESAFE_API_KEY;
  delete env.FABRIKA_FOREGROUND;
  delete env.CLOUDFLARE_API_TOKEN;
  return env;
};

/** A temp home with its own person key, made by ssh-keygen as a person makes one. */
export const homeWithCredential = (credential: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const dir = yield* owned(
      "home",
      fs.makeTempDirectory({ directory: "/tmp", prefix: "fw." }),
      (dir) => fs.remove(dir, { recursive: true, force: true }),
      (dir) => ({ home: dir }),
    );
    const key = join(dir, "person");
    const child = yield* spawner.spawn(
      ChildProcess.make("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", credential, "-f", key], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      }),
    );
    const exitCode = yield* child.exitCode;

    if (exitCode !== 0) {
      return yield* new KeygenFailed({ exitCode });
    }

    return {
      dir,
      key,
      credential,
      publicKey: (yield* fs.readFileString(`${key}.pub`)).trim().split(/\s+/).slice(0, 2).join(" "),
      grants: [] as Array<GrantSeen>,
    };
  }).pipe(Effect.provide(NodeServices.layer));

export const home = homeWithCredential("p14-test");

export type Home = Effect.Success<typeof home>;

/** Sends dev.ts SIGTERM and waits for it to exit, or answers at once when it has. dev.ts exits only
 *  once its scope has ended its detached child's process group (SIGTERM, then SIGKILL after 3 s), and
 *  that child's own scope ends the runtime it started, so after this the instance's home stays still. */
const stop = (c: NodeChildProcess) =>
  Effect.callback<void>((resume) => {
    if (c.exitCode !== null || c.signalCode !== null) {
      return resume(Effect.void);
    }

    c.once("exit", () => resume(Effect.void));
    c.kill("SIGTERM");
  });

/** The real `dev.ts` on a held port in `h`, ready when `/` answers. `env` adds to its environment. */
export const devServer = (h: Home, env: Readonly<Record<string, string>> = {}) =>
  Effect.gen(function* () {
    const { port } = yield* owned(
      "port",
      heldPort(),
      (held) => held.release,
      (held) => ({ port: held.port - 1 }),
    );
    const url = `http://127.0.0.1:${port}`;
    const out: Array<string> = [];
    const child = yield* owned(
      "server",
      Effect.sync(() => {
        const c = spawn(
          process.execPath,
          [
            join(APP, "dev.ts"),
            "--port",
            String(port),
            "--name",
            "p14-first",
            "--person",
            PERSON,
            "--founder",
            h.publicKey,
          ],
          { env: childEnv(h.dir, env), cwd: APP, stdio: ["ignore", "pipe", "pipe"] },
        );
        c.stdout?.on("data", (b: Buffer) => out.push(b.toString()));
        c.stderr?.on("data", (b: Buffer) => out.push(b.toString()));
        return c;
      }),
      stop,
      (c) => ({ pid: c.pid, port }),
    );
    // Ready when the real root answers; a child that exits first fails with what it said.
    yield* Effect.gen(function* () {
      for (;;) {
        if (child.exitCode !== null) {
          return yield* new DevFailed({ output: out.join("") });
        }

        // oxlint-disable-next-line fabrika/no-promises -- edge: the readiness probe is one HTTP fetch
        const ok = yield* Effect.tryPromise({
          try: () => fetch(url),
          catch: (cause) => new DevFailed({ output: String(cause) }),
        }).pipe(
          Effect.map((r) => r.ok),
          Effect.orElseSucceed(() => false),
        );

        if (ok) {
          return;
        }

        yield* Effect.sleep("250 millis");
      }
    }).pipe(Effect.timeout("180 seconds"));
    // A law that reads the whole home stops the instance first, within the 10 s its release gets.
    return { url, port, output: () => out.join(""), stop: stop(child).pipe(Effect.timeout("10 seconds")) };
  });

export type Dev = Effect.Success<ReturnType<typeof devServer>>;

/** The headless browser, as a server process whose pid the supervisor can watch. */
export const browser = Effect.gen(function* () {
  const server = yield* owned(
    "browser",
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright's launch is a Promise
    Effect.promise(() => chromium.launchServer({ headless: true })),
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright's close is a Promise
    (s) => Effect.promise(() => s.close()),
    (s) => ({ pid: s.process().pid }),
  );
  return yield* Effect.acquireRelease(
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright's connect is a Promise
    Effect.promise(() => chromium.connect(server.wsEndpoint())),
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright's close is a Promise
    (b) => Effect.promise(() => b.close()).pipe(Effect.timeout("10 seconds"), Effect.ignore),
  );
});

/** One browser profile: a context of its own, so its IndexedDB and its key are its own. */
export const profile = (b: Browser) =>
  owned(
    "context",
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright's newContext is a Promise
    Effect.promise(() => b.newContext()),
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright's close is a Promise
    (c) => Effect.promise(() => c.close()),
  );

/** Everything one tab shows or says, kept for L17's leak checks: console lines, page errors and every
 *  URL it asked for. */
export type Seen = {
  readonly console: Array<string>;
  readonly errors: Array<string>;
  readonly urls: Array<string>;
  readonly sockets: Array<string>;
  readonly opened: Array<PageSocket>;
};

/** One tab of a profile, open at `url`, with what it says recorded from its first instant. */
export const tab = (context: BrowserContext, url: string) =>
  Effect.gen(function* () {
    const seen: Seen = { console: [], errors: [], urls: [], sockets: [], opened: [] };
    const page = yield* owned(
      "page",
      // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright's newPage is a Promise
      Effect.promise(() => context.newPage()).pipe(
        Effect.tap((p) =>
          Effect.sync(() => {
            p.on("console", (m) => seen.console.push(m.text()));
            p.on("pageerror", (e) => seen.errors.push(`${e.name}: ${e.message}`));
            p.on("request", (r) => seen.urls.push(r.url()));
            p.on("websocket", (ws) => {
              seen.sockets.push(ws.url());
              seen.opened.push(ws);
            });
          }),
        ),
      ),
      // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright's close is a Promise
      (p) => Effect.promise(() => p.close()),
    );
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright's goto is a Promise
    yield* Effect.promise(() => page.goto(`${url}/`));
    return { page, seen };
  });

/** What the waiting screen shows: the line to run, read as the person copies it. */
export type Waiting = {
  readonly line: string;
  readonly url: string;
  readonly fingerprint: string;
  readonly code: string;
};

/** format: the waiting screen's grant line, `node next/apps/fabrika/grant.ts client <url> <fingerprint>
 *  --code <code> --key <key>`, which a person runs as it stands. */
const LINE = /node next\/apps\/fabrika\/grant\.ts client (\S+) (\S+) --code[ =](\S+) --key[ =](\S+)/;

/** Waits for the tab's waiting screen and reads its line. */
export const waiting = (page: Page) =>
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright's waitForFunction is a Promise
  Effect.promise(() =>
    page.waitForFunction((source) => new RegExp(source).exec(document.body.innerText)?.[0] ?? false, LINE.source, {
      timeout: 60_000,
    }),
  ).pipe(
    // oxlint-disable-next-line fabrika/no-promises -- edge: a Playwright handle's value is a Promise
    Effect.flatMap((handle) => Effect.promise(() => handle.jsonValue())),
    Effect.map((value): Waiting => {
      const line = String(value);
      const [, url = "", fingerprint = "", code = ""] = LINE.exec(line) ?? [];
      return { line, url, fingerprint, code };
    }),
  );

type GrantSeen = {
  readonly urls: ReadonlyArray<string>;
  readonly signatures: ReadonlyArray<string>;
  readonly output: string;
};

// Observe the CLI's HTTP edge through a separate pipe, never its signing key. The wire signature
// is a forbidden output value; the signed request itself is its intended recipient.
const GRANT_OBSERVER = `import { writeSync } from "node:fs";
const real = globalThis.fetch;
globalThis.fetch = (url, options) => {
  const signature = options?.body ? JSON.parse(options.body).armored : undefined;
  writeSync(3, JSON.stringify({url: String(url), signature}) + "\\n");
  return real(url, options);
};`;

const GrantWire = Schema.Struct({ url: Schema.String, signature: Schema.optionalKey(Schema.String) });

/** Runs the waiting screen's CLI with its own scoped process, recording output even on a refusal. */
export const grant = (h: Home, w: Waiting, key = h.key) =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(
        process.execPath,
        [
          "--import",
          `data:text/javascript,${encodeURIComponent(GRANT_OBSERVER)}`,
          join(APP, "grant.ts"),
          "client",
          w.url,
          w.fingerprint,
          "--code",
          w.code,
          "--key",
          key,
        ],
        {
          cwd: APP,
          env: childEnv(h.dir, {}),
          stdin: "ignore",
          additionalFds: { fd3: { type: "output" } },
        },
      );
      const [code, out, err, wire] = yield* Effect.all(
        [
          child.exitCode,
          Stream.mkString(Stream.decodeText(child.stdout)),
          Stream.mkString(Stream.decodeText(child.stderr)),
          Stream.mkString(Stream.decodeText(child.getOutputFd(3))),
        ],
        { concurrency: 4 },
      );
      const sent = wire
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => Schema.decodeUnknownSync(Schema.fromJsonString(GrantWire))(line));
      const seen: GrantSeen = {
        urls: sent.map((row) => row.url),
        signatures: sent.flatMap((row) => (row.signature === undefined ? [] : [row.signature])),
        output: out + err,
      };
      h.grants.push(seen);
      return code === 0 ? { ok: true as const } : { ok: false as const, error: seen.output };
    }),
  ).pipe(Effect.provide(NodeServices.layer));

/** The door's own record of what is waiting for `w`: the client's raw key, its person and project. */
const Target = Schema.Struct({ key: Schema.String, for: Schema.String, to: Schema.String });

/** Reads the grant target while the tab waits, so the key can be removed later. */
export const target = (w: Waiting) => {
  const url = `${new URL(w.url).origin}/grant/client/${encodeURIComponent(w.fingerprint)}?code=${encodeURIComponent(w.code)}`;
  // oxlint-disable-next-line fabrika/no-promises -- edge: the door's target is one HTTP fetch
  return Effect.promise(() => fetch(url)).pipe(
    // oxlint-disable-next-line fabrika/no-promises -- edge: an HTTP body is a Promise
    Effect.flatMap((r) => Effect.promise(() => r.json())),
    Effect.flatMap(Schema.decodeUnknownEffect(Target)),
    Effect.orDie,
  );
};

/** Removes the client key `t` with the person's key, as the door takes a revocation: the tab's socket
 *  is closed with 4003. */
export const remove = (h: Home, dev: Dev, t: typeof Target.Type) =>
  Effect.gen(function* () {
    const text = revokeText({
      id: `revoke_${Date.now()}`,
      key: t.key,
      for: t.for,
      to: t.to,
      saw: { label: "first-window", location: "local", method: "command", check: "none" },
      sentAt: new Date().toISOString(),
    });
    const armored = execFileSync("ssh-keygen", ["-Y", "sign", "-n", "fabrika-client", "-f", h.key], {
      input: text,
    }).toString();
    const body = JSON.stringify({ text, armored });
    // oxlint-disable-next-line fabrika/no-promises -- edge: the signed revocation is posted over HTTP
    const r = yield* Effect.promise(() =>
      fetch(`${dev.url}/grant`, { method: "POST", headers: { "content-type": "application/json" }, body }),
    );
    return { ok: r.ok, text, armored };
  });

/** What the tab keeps in IndexedDB, read in the page: every value but its keys, as source text so the
 *  page's own Promises stay in the page. */
const ROWS = `(async () => {
  const out = [];
  const isKey = (v) => v instanceof CryptoKey || (typeof v === "object" && v !== null && Object.values(v).some((x) => x instanceof CryptoKey));
  for (const info of await indexedDB.databases()) {
    const db = await new Promise((ok, no) => { const open = indexedDB.open(info.name); open.onsuccess = () => ok(open.result); open.onerror = () => no(open.error); });
    for (const name of db.objectStoreNames) {
      const all = await new Promise((ok, no) => { const req = db.transaction(name, "readonly").objectStore(name).getAll(); req.onsuccess = () => ok(req.result); req.onerror = () => no(req.error); });
      out.push(...all.filter((v) => !isKey(v)));
    }
    db.close();
  }
  return out;
})()`;

/** The tab's own rows store, read back: every row it kept for the door. */
export const rows = (page: Page): Effect.Effect<ReadonlyArray<unknown>> =>
  // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright's evaluate is a Promise
  Effect.promise(() => page.evaluate<ReadonlyArray<unknown>>(ROWS));

/** One row of a checklist tile as a person or a screen reader meets it: its box's name and state. */
export type Row = { readonly name: string; readonly checked: boolean };

/** format: Playwright's ARIA snapshot lines for a checkbox, `- checkbox "<name>"` with `[checked]`. */
const BOX = /^\s*- checkbox "((?:[^"\\]|\\.)*)"(.*)$/;

/** The checklist tile of `name`, found by role: its region, its add field, a row's box and remove
 *  button, the rows it shows now, and the words tied to the field. */
export const tile = (page: Page, name: string) => {
  const region = page.getByRole("region", { name: new RegExp(name.replace(/[:]/g, "\\:")) });
  const field = region.getByRole("textbox", { name: checklist.inputs.add.description });
  return {
    region,
    field,
    /** Waits until a person can use the tile: its region is not `inert`. A lost link makes the tile
     *  inert until its view opens again on the next dial, and a press in between is dropped on
     *  purpose, so a press waits for this as a person waits for the tile to come back. */
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright's waitFor is a Promise
    live: Effect.promise(() => region.and(page.locator(":not([inert])")).waitFor({ timeout: 30_000 })),
    /** A row's box as a person presses it: the label around the checkbox named `item`. The checkbox
     *  itself is a hidden one-pixel input under the drawn box, so a pointer never lands on it; a
     *  click on its label is the browser's own way to it. */
    box: (item: string) =>
      region.locator("label").filter({ has: page.getByRole("checkbox", { name: item, exact: true }) }),
    remove: (item: string) => region.getByRole("button", { name: `Remove ${item}`, exact: true }),
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright's ariaSnapshot is a Promise
    shown: Effect.promise(() => region.ariaSnapshot()).pipe(
      Effect.map((yaml): ReadonlyArray<Row> =>
        yaml.split("\n").flatMap((line) => {
          const m = BOX.exec(line);
          const [, item = "", state = ""] = m ?? [];
          return m === null ? [] : [{ name: item.replace(/\\(.)/g, "$1"), checked: state.includes("[checked]") }];
        }),
      ),
    ),
    /** The text of every element the field's `aria-describedby` names: its refusal words, or "". */
    // oxlint-disable-next-line fabrika/no-promises -- edge: Playwright's evaluate is a Promise
    refusal: Effect.promise(() =>
      field.evaluate((el) =>
        (el.getAttribute("aria-describedby") ?? "")
          .split(/\s+/)
          .filter((id) => id !== "")
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim(),
      ),
    ),
  };
};

// --- A reader of the instance's streams ----------------------------------------------------------

const field = (value: Buffer | string) => {
  const body = Buffer.from(value),
    size = Buffer.alloc(4);
  size.writeUInt32BE(body.length);
  return Buffer.concat([size, body]);
};

/** A client key of the reader's own, signing as the door's hello and SSHSIG ask. */
const identity = () => {
  const pair = generateKeyPairSync("ed25519"),
    bytes = Buffer.from(pair.publicKey.export({ format: "jwk" }).x ?? "", "base64url"),
    blob = Buffer.concat([field("ssh-ed25519"), field(bytes)]);
  return {
    raw: bytes.toString("base64url"),
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
      const lines = packet.toString("base64").match(/.{1,70}/g) ?? [];
      return `-----BEGIN SSH SIGNATURE-----\n${lines.join("\n")}\n-----END SSH SIGNATURE-----\n`;
    },
  };
};

class WireClosed extends Schema.TaggedError<WireClosed>()("WireClosed", {}) {}

const Frame = Schema.Struct({
  id: Schema.optionalKey(Schema.Unknown),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Unknown),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Unknown),
});
type Frame = typeof Frame.Type;

const Entries = Schema.Struct({
  entries: Schema.Array(Entry),
});

/** A client of the instance with a key of its own, granted by the person as the tab is, through the
 *  waiting code and `grant.ts client`. Its socket is acquired in the caller's scope. `read(stream)`
 *  answers every entry of `stream`, page by page. */
export const reader = (h: Home, dev: Dev) =>
  Effect.gen(function* () {
    const key = identity();
    const tab = "p14-reader";
    const frames: Array<Frame> = [];
    let closed = false;
    const ws = yield* owned(
      "socket",
      Effect.sync(() => {
        const socket = new WebSocket(
          `${dev.url.replace("http", "ws")}/client/${encodeURIComponent(key.fingerprint)}/${tab}`,
        );
        socket.addEventListener("message", ({ data }) => {
          const text = String(data);

          if (text !== "pong") {
            frames.push(Schema.decodeUnknownSync(Schema.fromJsonString(Frame))(text));
          }
        });
        socket.addEventListener("close", () => {
          closed = true;
        });
        socket.addEventListener("error", () => {
          closed = true;
        });
        return socket;
      }),
      (socket) =>
        Effect.callback<void>((resume) => {
          if (socket.readyState === WebSocket.CLOSED) {
            return resume(Effect.void);
          }

          socket.addEventListener("close", () => resume(Effect.void), { once: true });
          socket.close();
        }),
    );
    const next = (test: (f: Frame) => boolean) =>
      Effect.gen(function* () {
        for (;;) {
          const at = frames.findIndex(test);

          const [frame] = at >= 0 ? frames.splice(at, 1) : [];

          if (frame !== undefined) {
            return frame;
          }

          if (closed) {
            return yield* new WireClosed();
          }

          yield* Effect.sleep("20 millis");
        }
      }).pipe(Effect.timeout("60 seconds"), Effect.orDie);
    let serial = 0;
    const call = (method: string, params: unknown) =>
      Effect.gen(function* () {
        while (ws.readyState === WebSocket.CONNECTING) {
          yield* Effect.sleep("20 millis");
        }

        const id = ++serial;
        ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
        return yield* next((f) => f.id === id);
      });
    const hello = (nonce: string) =>
      call("initialize", {
        versions: [1],
        has: ["seal"],
        ping: "30s",
        key: key.raw,
        tab,
        nonce,
        platform: "headless",
        os: "linux",
        sentAt: new Date().toISOString(),
        signed: key.proof(`fabrika-hello\n${dev.url}\n${tab}\n${nonce}`),
      });
    const nonceIn = (f: Frame) => String(Reflect.get(Object(f.params), "nonce"));
    const first = yield* hello(nonceIn(yield* next((f) => f.method === "challenge")));
    expectWaiting(first);
    const knocked = yield* call("gateway.knock", { label: "p14 reader" });
    const code = String(Reflect.get(Object(knocked.result), "code"));
    const granted = yield* grant(h, { line: "", url: dev.url, fingerprint: key.fingerprint, code });

    if (!granted.ok) {
      return yield* Effect.die(new Error("the person could not grant the reader"));
    }

    const again = yield* hello(nonceIn(yield* next((f) => f.method === "client.granted")));

    if (again.error !== undefined) {
      return yield* Effect.die(new Error("the granted reader was not admitted"));
    }

    /** The answer's `result`. A refused call (the door's rate limit, say) fails here by name, with
     *  what the door said, before any decode can blame the frame's shape. */
    const answered = (method: string, params: unknown) =>
      Effect.flatMap(call(method, params), (frame) =>
        frame.error === undefined && frame.result !== undefined
          ? Effect.succeed(frame.result)
          : Effect.die(new Error(`the door refused ${method}: ${JSON.stringify(frame.error ?? frame)}`)),
      );

    return {
      call,
      /** Every span the chain held when the walk's last page was read. A chain is read in the order
       *  it was written, and each `spans.read` writes spans of its own into the `spans` chain, so no
       *  page is ever empty there: the walk ends at the first page the door did not fill. A page
       *  that is not full reached the chain's end as it stood at that read, so every span written
       *  before the walk began is in `all`. */
      spans: (chain: Chain = Chain.cases.spans.make({})) =>
        Effect.gen(function* () {
          const all: Array<unknown> = [];
          let after = 0;

          for (;;) {
            const value = yield* Schema.decodeUnknownEffect(
              Schema.Struct({ spans: Schema.Array(Schema.Unknown), next: Schema.Int }),
            )(yield* answered("spans.read", { chain, after })).pipe(Effect.orDie);
            all.push(...value.spans);

            if (value.spans.length < PAGE || value.next <= after) {
              return all;
            }

            after = value.next;
          }
        }),
      read: (stream: string) =>
        Effect.gen(function* () {
          const all: Array<(typeof Entries.Type.entries)[number]> = [];

          for (;;) {
            const result = yield* answered("ledger.read", { stream, after: all.at(-1)?.rev ?? 0 });
            const { entries } = yield* Schema.decodeUnknownEffect(Entries)(result).pipe(Effect.orDie);

            if (entries.length === 0) {
              return all;
            }

            all.push(...entries);
          }
        }),
    };
  });

/** The door's first answer to a key it has not granted: not admitted, so the reader must knock. */
const expectWaiting = (f: Frame) => {
  if (f.error === undefined) {
    throw new Error("the reader's fresh key was admitted without a grant");
  }
};
