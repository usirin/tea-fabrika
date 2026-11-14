// P18 slice 1, next/ (ticket 290): law L9 of the approved plan, the P18 row's "browser client in CI".
// One suite, run twice on a real local instance of its own: once in a Chromium tab and once with the
// library's headless client, through the same public start. Each backend dials, waits, is granted,
// signs the hello, pings in text, opens the checklist, submits one `add` and reads its checked view
// and its ledger input. It needs Alchemy, workerd and Chromium, so it runs in CI's end-to-end job,
// never on a laptop step. Every resource is acquired in the scope of `p14.test-support.ts`'s `suite`.
import { ClientKeyError } from "@kampus/libfabrika/transport/ClientKey";
import { KeyLine } from "@kampus/libfabrika/transport/Sshsig";
import { Effect, Schema } from "effect";
import type { BrowserContext } from "playwright";
import { describe, expect, it } from "vitest";
import { type Backend, headlessBackend, NAME, roundTrip, SuiteError } from "./client-protocol.test-support.ts";
import { browser, type Dev, devServer, home, profile, suite, tab, tile, waiting } from "./p14.test-support.ts";

/** Each run's own limit in ms: a dev.ts start (up to 180 s), a grant, a 12 s ping wait and a round trip. */
const LIMIT = 300_000;

/** A Chromium tab of a fresh profile, open at the instance. */
const browserBackend = (context: BrowserContext, dev: Dev) =>
  Effect.gen(function* () {
    const { page, seen } = yield* tab(context, dev.url);
    const t = tile(page, NAME);
    const backend: Backend = {
      name: "browser",
      waiting: waiting(page),
      online: t.live,
      live: Effect.tryPromise({
        try: () => page.getByRole("status").innerText(),
        catch: () => new SuiteError({ waited: "browser: the status line" }),
      }).pipe(
        Effect.map((text) => text.startsWith("Online")),
        Effect.orDie,
      ),
      add: (name) =>
        Effect.tryPromise({
          try: () => t.field.fill(name).then(() => t.field.press("Enter")),
          catch: () => new SuiteError({ waited: "browser: the add field" }),
        }).pipe(Effect.orDie),
      shown: t.shown,
      dials: () => seen.sockets.length,
    };
    return backend;
  });

/** A key of the headless client's own, made in WebCrypto as a browser makes one. */
const headlessKey = Effect.gen(function* () {
  const failed = () => new ClientKeyError({ op: "make", error: "OperationError" });
  const pair = yield* Effect.tryPromise({
    try: () => crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]),
    catch: failed,
  });
  const raw = new Uint8Array(
    yield* Effect.tryPromise({ try: () => crypto.subtle.exportKey("raw", pair.publicKey), catch: failed }),
  );
  const field = (bytes: Uint8Array) => [...new Uint8Array(new Uint32Array([bytes.length]).buffer).reverse(), ...bytes];
  const blob = new Uint8Array([...field(new TextEncoder().encode("ssh-ed25519")), ...field(raw)]);
  // The door hashes the 32 raw key bytes, as the browser key and the P14 client do; the line keeps the blob.
  const digest = new Uint8Array(
    yield* Effect.tryPromise({ try: () => crypto.subtle.digest("SHA-256", raw), catch: failed }),
  );
  return {
    fingerprint: `SHA256:${btoa(String.fromCharCode(...digest)).replace(/=+$/, "")}`,
    raw: btoa(String.fromCharCode(...raw))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, ""),
    line: Schema.decodeUnknownSync(KeyLine)(`ssh-ed25519 ${btoa(String.fromCharCode(...blob))}`),
    found: "created" as const,
    sign: (bytes: Uint8Array) =>
      Effect.tryPromise({
        try: () => crypto.subtle.sign("Ed25519", pair.privateKey, new Uint8Array(bytes)),
        catch: () => new ClientKeyError({ op: "sign", error: "OperationError" }),
      }).pipe(Effect.map((b) => new Uint8Array(b))),
  };
});

const backends = {
  browser: (dev: Dev) =>
    Effect.gen(function* () {
      const b = yield* browser;
      return yield* browserBackend(yield* profile(b), dev);
    }),
  headless: (dev: Dev) => Effect.flatMap(headlessKey, (key) => headlessBackend(dev, key)),
} as const;

describe("P18 L9: one client, two backends, one real round trip", () => {
  for (const [name, make] of Object.entries(backends)) {
    it(
      `scenario: the ${name} client dials, waits, is granted, pings in text, opens the checklist, submits one add and reads it back, through the library's one start`,
      { timeout: LIMIT },
      (context) =>
        suite(
          Effect.gen(function* () {
            const h = yield* home;
            const dev = yield* devServer(h);
            const backend = yield* make(dev);
            const trip = yield* roundTrip(h, dev, backend);
            expect(trip.first, `${name} dials once before its grant`).toBe(1);
            expect(trip.kept, `${name} stays online on its one dial: its text pings are answered`).toBe(true);
            expect(trip.sent, `${name}'s add reached the ledger once`).toBe(1);
          }),
          context,
        ),
    );
  }
});
