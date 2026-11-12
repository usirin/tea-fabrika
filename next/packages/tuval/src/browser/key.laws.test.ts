// P14 slice 2, next/ (ticket 828): the browser's key store, law L3 of the approved plan, in headless
// Chromium. Written before `browser/key.ts`.
//
// The shape this law holds the browser layer to, from the plan (the build may add more):
// - `@kampus/tuval/browser` exports `browserKey`, a Layer of libfabrika's `ClientKey` on IndexedDB and
//   WebCrypto. `current(rejected)` answers the profile's one identity {fingerprint, found, ...}: made
//   once (`created`), read again (`reused`), or, when `rejected` names the key still stored, replaced
//   (`replaced`); a key another tab already replaced is adopted. A store failure is a
//   `ClientKeyError {op, error}`, `error` a platform class from `ErrorClass`, and never a new key.
//   `claimPersist` is true for one claim per profile. The private key is a nonextractable Ed25519
//   CryptoKey; no private bytes are stored.
//
// A browser context is one profile and each page in it a tab. Each generated move is chosen from the
// key the profile stores now: a read by a tab, a removal and Ask again by a tab with the removed key,
// a stale Ask again that names a key no longer stored, a read while the store fails, and a persistence
// claim. The browser, each context and each page are acquired in a scope (0061).
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as fc from "fast-check";
import { type Browser, chromium, type Page } from "playwright";
import { rolldown } from "rolldown";

const SEED = 119120;
const ORIGIN = "http://fabrika.test";
const ENTRY = "\0key-laws-entry";
const HERE = new URL(".", import.meta.url).pathname;

/** The page's handle on the real layer: each call one Effect run in the tab, its answer as data. */
const PAGE_ENTRY = `
import { Cause, Effect, Exit } from "effect";
import { ClientKey } from "@kampus/libfabrika/transport/ClientKey";
import { browserKey } from ${JSON.stringify(`${HERE}index.ts`)};
const run = (work) =>
  Effect.runPromiseExit(work.pipe(Effect.provide(browserKey))).then((exit) => {
    if (Exit.isSuccess(exit)) return { ok: exit.value };
    const e = Cause.squash(exit.cause);
    return { err: { _tag: e?._tag ?? null, op: e?.op ?? null, error: e?.error ?? null } };
  });
globalThis.__key = {
  current: (rejected) =>
    run(ClientKey.use((k) => k.current(rejected)).pipe(Effect.map((i) => ({ fingerprint: i.fingerprint, found: i.found })))),
  claim: () => run(ClientKey.use((k) => k.claimPersist)),
};
`;

/** The page script, built once from the real layer with the tab's own bundler. */
const bundled = Effect.gen(function* () {
  const bundle = yield* Effect.acquireRelease(
    Effect.promise(() =>
      rolldown({
        input: ENTRY,
        cwd: HERE,
        platform: "browser",
        plugins: [
          {
            name: "key-laws-entry",
            resolveId: (id) => (id === ENTRY ? ENTRY : null),
            load: (id) => (id === ENTRY ? PAGE_ENTRY : null),
          },
        ],
      }),
    ),
    (bundle) => Effect.promise(() => bundle.close()),
  );
  const { output } = yield* Effect.promise(() => bundle.generate({ format: "esm" }));
  return output[0].code;
});

const browser = Effect.acquireRelease(
  Effect.promise(() => chromium.launch({ headless: true })),
  (b) => Effect.promise(() => b.close()),
);

/** One profile: a fresh context whose origin serves an empty page with the layer's script. */
const profile = (b: Browser, script: string) =>
  Effect.acquireRelease(
    Effect.promise(() => b.newContext()),
    (context) => Effect.promise(() => context.close()),
  ).pipe(
    Effect.tap((context) =>
      Effect.promise(() =>
        context.route(`${ORIGIN}/**`, (route) =>
          route.request().url().endsWith("/key.js")
            ? route.fulfill({ contentType: "text/javascript", body: script })
            : route.fulfill({
                contentType: "text/html",
                body: `<!doctype html><script type="module" src="/key.js"></script>`,
              }),
        ),
      ),
    ),
  );

const tab = (context: Awaited<ReturnType<Browser["newContext"]>>) =>
  Effect.acquireRelease(
    Effect.promise(() => context.newPage()),
    (page) => Effect.promise(() => page.close()),
  ).pipe(
    Effect.tap((page) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => page.goto(`${ORIGIN}/`));
        yield* Effect.promise(() => page.waitForFunction(() => "__key" in globalThis));
      }),
    ),
  );

type Answer<A> = {
  readonly ok?: A;
  readonly err?: { readonly _tag: string; readonly op: string; readonly error: string };
};

type Key = { readonly fingerprint: string; readonly found: "created" | "reused" | "replaced" };

const current = (page: Page, rejected: string | null) =>
  Effect.promise((): Promise<Answer<Key>> =>
    page.evaluate((r) => Reflect.get(globalThis, "__key").current(r), rejected),
  );

const claim = (page: Page) =>
  Effect.promise((): Promise<Answer<boolean>> => page.evaluate(() => Reflect.get(globalThis, "__key").claim()));

/** Every value the profile's IndexedDB holds, described: private keys by their extractability, bytes and
 *  strings as hex, so the law can say no private material is stored. */
const stored = (page: Page) =>
  Effect.promise(() =>
    page.evaluate(async () => {
      const out: Array<{ kind: string; extractable?: boolean; exported?: boolean; hex?: string }> = [];
      const hex = (b: ArrayBufferLike | ArrayBufferView) =>
        [...new Uint8Array(ArrayBuffer.isView(b) ? b.buffer : b)].map((x) => x.toString(16).padStart(2, "0")).join("");
      const walk = async (v: unknown): Promise<void> => {
        if (v instanceof CryptoKey) {
          const exported = await crypto.subtle.exportKey("pkcs8", v).then(
            () => true,
            () => false,
          );
          out.push({ kind: `key:${v.type}`, extractable: v.extractable, exported });
        } else if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
          out.push({ kind: "bytes", hex: hex(v) });
        } else if (typeof v === "string") {
          out.push({
            kind: "string",
            hex: [...new TextEncoder().encode(v)].map((x) => x.toString(16).padStart(2, "0")).join(""),
          });
        } else if (typeof v === "object" && v !== null) {
          for (const one of Object.values(v)) {
            await walk(one);
          }
        }
      };

      for (const info of await indexedDB.databases()) {
        const db = await new Promise<IDBDatabase>((ok, no) => {
          const open = indexedDB.open(info.name!);
          open.onsuccess = () => ok(open.result);
          open.onerror = () => no(open.error);
        });

        for (const name of db.objectStoreNames) {
          const all = await new Promise<Array<unknown>>((ok, no) => {
            const req = db.transaction(name, "readonly").objectStore(name).getAll();
            req.onsuccess = () => ok(req.result);
            req.onerror = () => no(req.error);
          });

          for (const v of all) {
            await walk(v);
          }
        }

        db.close();
      }

      return out;
    }),
  );

/** Makes the tab's IndexedDB refuse to open, as private mode, a full quota or a block does. */
const failStore = (page: Page, name: string) =>
  Effect.promise(() =>
    page.evaluate((n) => {
      const real = indexedDB.open.bind(indexedDB);
      Reflect.set(globalThis, "__realOpen", real);
      indexedDB.open = () => {
        throw new DOMException("refused", n);
      };
    }, name),
  );

const healStore = (page: Page) =>
  Effect.promise(() => page.evaluate(() => (indexedDB.open = Reflect.get(globalThis, "__realOpen"))));

/** Ed25519's PKCS #8 prefix: private bytes stored in the clear would start with it. */
const PKCS8_ED25519 = "302e020100300506032b657004220420";

const move = fc.record({
  kind: fc.nat(),
  tab: fc.nat(),
  error: fc.constantFrom("QuotaExceededError", "InvalidStateError", "SecurityError"),
});

describe("L3: the browser key store", () => {
  it.live(
    "tabs share one key, private bytes never leave or rest, failures are typed, Ask again replaces only the removed key",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const b = yield* browser;
          const script = yield* bundled;
          const seen = { created: 0, adopted: 0, failed: 0, claimed: 0 };
          yield* Effect.promise(() =>
            fc.assert(
              fc.asyncProperty(
                fc.integer({ min: 1, max: 3 }),
                fc.array(move, { minLength: 1, maxLength: 10 }),
                (tabs, moves) =>
                  Effect.runPromise(
                    Effect.scoped(
                      Effect.gen(function* () {
                        const context = yield* profile(b, script);
                        const pages = yield* Effect.forEach(Array.from({ length: tabs }), () => tab(context), {
                          concurrency: 1,
                        });
                        // A fresh profile: every tab asks at once, and all get the one stored key.
                        const first = yield* Effect.forEach(pages, (p) => current(p, null), {
                          concurrency: "unbounded",
                        });
                        const prints = new Set(first.map((a) => a.ok?.fingerprint));
                        expect(prints.size, "racing tabs made more than one key").toBe(1);
                        expect(first.filter((a) => a.ok?.found === "created")).toHaveLength(1);
                        seen.created++;
                        let stored_ = first[0]!.ok!.fingerprint;
                        const removed: Array<string> = [];
                        let claims = 0;

                        for (const m of moves) {
                          const page = pages[m.tab % pages.length]!;
                          const kind = m.kind % 5;

                          if (kind === 0) {
                            const a = yield* current(page, null);
                            expect(a.ok, "a read of the stored key").toEqual({ fingerprint: stored_, found: "reused" });
                          } else if (kind === 1) {
                            // The door removed the stored key: Ask again replaces it, once, for every tab.
                            const a = yield* current(page, stored_);
                            expect(a.ok?.found).toBe("replaced");
                            expect(a.ok?.fingerprint).not.toBe(stored_);
                            removed.push(stored_);
                            const other = pages[(m.tab + 1) % pages.length]!;
                            const b2 = yield* current(other, stored_);
                            expect(b2.ok?.fingerprint, "a second tab adopts the first one's replacement").toBe(
                              a.ok?.fingerprint,
                            );
                            seen.adopted += pages.length > 1 ? 1 : 0;
                            stored_ = a.ok!.fingerprint;
                          } else if (kind === 2 && removed.length > 0) {
                            // Ask again naming a key no longer stored replaces nothing.
                            const a = yield* current(page, removed[m.tab % removed.length]!);
                            expect(a.ok).toEqual({ fingerprint: stored_, found: "reused" });
                          } else if (kind === 3) {
                            yield* failStore(page, m.error);
                            const a = yield* current(page, null);
                            yield* healStore(page);
                            seen.failed++;
                            expect(a.ok, "a failed store made a key").toBeUndefined();
                            expect(a.err).toMatchObject({ _tag: "ClientKeyError", error: m.error });
                            expect(["open", "read", "write", "make", "sign"]).toContain(a.err?.op);
                            const after = yield* current(page, null);
                            expect(after.ok?.fingerprint, "the failure replaced the key").toBe(stored_);
                          } else {
                            const a = yield* claim(page);
                            expect(a.err).toBeUndefined();
                            claims += a.ok === true ? 1 : 0;
                            seen.claimed++;
                            expect(claims, "persistence was claimed more than once").toBeLessThanOrEqual(1);
                          }
                        }

                        const rest = yield* stored(pages[0]!);
                        expect(rest.filter((v) => v.kind === "key:private").length).toBeGreaterThan(0);

                        for (const v of rest) {
                          expect(
                            v.kind === "key:private" ? [v.extractable, v.exported] : [false, false],
                            "a private key can leave",
                          ).toEqual([false, false]);
                          expect(v.hex?.includes(PKCS8_ED25519) ?? false, "private bytes are stored").toBe(false);
                        }
                      }),
                    ),
                  ),
              ),
              { seed: SEED, numRuns: 25 },
            ),
          );
          expect(seen.failed).toBeGreaterThan(0);
          expect(seen.claimed).toBeGreaterThan(0);
          expect(seen.adopted).toBeGreaterThan(0);
        }),
      ),
    300_000,
  );
});
