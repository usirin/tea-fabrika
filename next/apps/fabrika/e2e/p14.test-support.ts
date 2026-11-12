// P14 slice 2, next/ (ticket 828): the first-window suite's resources, each acquired in one Effect scope
// before any setup step can fail (0061). The temp home with its person key, the port, the real `dev.ts`
// instance, the headless browser, each profile (a browser context) and each tab (a page), released by
// the scope in reverse order.
//
// `resources.laws.test.ts` (L16) runs `first-window.test.ts` as a child process. It sets
// `P14_E2E_TRACE` to a file the fixture appends each acquisition (with its pid, port or home) and
// release to, and `P14_E2E_FAULT` to `{at, kind}`: right after acquiring `at`, fail setup (`setup`),
// fail the test (`test`), or wait to be interrupted (`hold`). Without them the fixture runs plainly.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { revokeText } from "@kampus/libfabrika/access/Text";
import { Effect, Schema } from "effect";
import { type Browser, type BrowserContext, chromium, type Page, type WebSocket } from "playwright";
import { heldPort } from "../src/port.test-support.ts";

const APP = resolve(import.meta.dirname, "..");
export const PERSON = "person_01m6v5270hf3c8x2q7w9z4k5mn";

export const RESOURCES = ["home", "server", "browser", "context", "page"] as const;
type Resource = (typeof RESOURCES)[number];

const Fault = Schema.Struct({
  at: Schema.Literals(RESOURCES),
  kind: Schema.Literals(["setup", "test", "hold"]),
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

const note = (row: Readonly<Record<string, unknown>>) =>
  Effect.sync(() => {
    if (trace !== undefined) {
      appendFileSync(trace, `${JSON.stringify(row)}\n`);
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
  Effect.acquireRelease(acquire.pipe(Effect.tap((a) => note({ acquired: at, ...facts(a) }))), (a) =>
    release(a).pipe(Effect.timeout("10 seconds"), Effect.ignore, Effect.andThen(note({ released: at }))),
  ).pipe(
    Effect.tap(() =>
      fault?.at !== at
        ? Effect.void
        : fault.kind === "setup"
          ? Effect.fail(new SetupFault({ at }))
          : fault.kind === "hold"
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
export const home = owned(
  "home",
  Effect.sync(() => {
    const dir = mkdtempSync("/tmp/fw.");
    const key = join(dir, "person");
    execFileSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]);
    return { dir, key, publicKey: readFileSync(`${key}.pub`, "utf8").trim() };
  }),
  (h) => Effect.sync(() => rmSync(h.dir, { recursive: true, force: true })),
  (h) => ({ home: h.dir }),
);

export type Home = Effect.Success<typeof home>;

/** The real `dev.ts` on a held port in `h`, ready when `/` answers. `env` adds to its environment. */
export const devServer = (h: Home, env: Readonly<Record<string, string>> = {}) =>
  Effect.gen(function* () {
    const { port } = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
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
      (c: ChildProcess) =>
        Effect.callback<void>((resume) => {
          if (c.exitCode !== null || c.signalCode !== null) {
            return resume(Effect.void);
          }

          c.once("exit", () => resume(Effect.void));
          c.kill("SIGTERM");
        }),
      (c) => ({ pid: c.pid, port }),
    );
    // Ready when the real root answers; a child that exits first fails with what it said.
    yield* Effect.gen(function* () {
      for (;;) {
        if (child.exitCode !== null) {
          return yield* new DevFailed({ output: out.join("") });
        }

        // oxlint-disable-next-line fabrika/no-promises -- edge: the readiness probe is one HTTP fetch
        const ok = yield* Effect.tryPromise(() => fetch(url)).pipe(
          Effect.map((r) => r.ok),
          Effect.orElseSucceed(() => false),
        );

        if (ok) {
          return;
        }

        yield* Effect.sleep("250 millis");
      }
    }).pipe(Effect.timeout("180 seconds"));
    return { url, port, output: () => out.join("") };
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
  readonly opened: Array<WebSocket>;
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

/** Runs the waiting screen's line with `key` in place of its placeholder: the person's grant. */
export const grant = (h: Home, w: Waiting, key = h.key) =>
  Effect.sync(() => {
    try {
      execFileSync(
        process.execPath,
        [join(APP, "grant.ts"), "client", w.url, w.fingerprint, "--code", w.code, "--key", key],
        {
          cwd: APP,
          env: childEnv(h.dir, {}),
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: String(error) };
    }
  });

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

/** The tile of `name`, its count and its buttons, found by role as a person or a screen reader finds them. */
export const tile = (page: Page, name: string) => {
  const region = page.getByRole("region", { name: new RegExp(name.replace(/[:]/g, "\\:")) });
  return {
    region,
    count: region.getByRole("status"),
    button: (label: string) => region.getByRole("button", { name: label }),
  };
};
