// Tuval's page start on Effect's browser runtime, next/: laws L2, L3 and L4 of the approved plan.
// Written before the build. The shape these laws hold the tab to, from the plan: the entry
// `src/entry/browser.tsx` hands its one program to `runMain` from `@kampus/tuval/browser`, Effect's
// `BrowserRuntime.runMain`. So a `pagehide` that is not entering the back/forward cache stops the
// program (React's root unmounts and the socket closes), a persisted one changes nothing, the page
// keeps running across a real back/forward cache round trip, and a failure of the program is
// reported on the console instead of dropped.
//
// Each file builds the real tab once with the app's own `build`, keeps its two assets in memory, and
// serves them from `context.route` at `http://127.0.0.1/`; the page's socket is answered by
// `context.routeWebSocket` with no brain behind it, so the window mounts and shows that it is
// connecting. "Up" means the root has children and a routed socket is open. "Stopped" means the root
// has no children and the page closed every socket it dialed. Every resource (temp folder, browser,
// context, page) is acquired in a scope (0061).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import * as fc from "fast-check";
import { type Browser, type BrowserContext, chromium, type LaunchOptions, type Page } from "playwright";
import { beforeAll, describe, expect, it } from "vitest";
import { build } from "../src/build.ts";

const SEED = 119120;
const ORIGIN = "http://127.0.0.1";
/** How a red law ends: at its first failing run, with its seed and path, and no shrinking. Each
 *  shrink step opens a page and waits out a 2 s bound again, which adds nothing to the counterexample. */
const RED = { endOnFailure: true } as const;
/** How long a stop or a report may take to show, in ms. The stop shows in 1.7 to 3.0 ms (the plan's
 *  probe 3), so two seconds is room for a slow CI machine without letting a page that never stops pass. */
const WITHIN = 2000;
/** How long "nothing happened" is read after a persisted event, in ms: about 80 times the slowest stop
 *  the plan's probe 3 measured, so a stop that did happen has shown by then. */
const QUIET = 250;
/** How long a page restored from the back/forward cache may take to dial again, in ms: the window's
 *  own redial backoff after Chromium closed its socket in the cache (the plan, L3). */
const REDIAL_WITHIN = 10_000;

type Assets = { readonly page: string; readonly script: string };
let assets: Assets;

beforeAll(async () => {
  assets = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const folder = yield* Effect.acquireRelease(
          Effect.sync(() => mkdtempSync(join(tmpdir(), "page-runtime-"))),
          (folder) => Effect.sync(() => rmSync(folder, { recursive: true, force: true })),
        );
        const built = yield* build({ out: join(folder, "dist"), ledger: [] });
        return { page: built.assets["/index.html"]!.body, script: built.assets["/window.js"]!.body };
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
}, 120_000);

const browser = (options: LaunchOptions = {}) =>
  Effect.acquireRelease(
    Effect.promise(() => chromium.launch({ headless: true, ...options })),
    (b) => Effect.promise(() => b.close()),
  );

/** One socket the page dialed: `closed` turns true when the page closes it. */
type Dial = { readonly at: number; readonly from: string; closed: boolean };

/** What one profile saw: each dial, and every console line with its type. */
type Seen = { readonly dials: Array<Dial>; readonly lines: Array<string> };

/** A fresh profile serving the built tab at `/`, a plain page of the same origin at `/away`, and a
 *  routed socket with no brain behind it. `init` runs in every page before the tab's script. */
const profile = (b: Browser, init?: { readonly script: (arg: string) => void; readonly arg: string }) =>
  Effect.gen(function* () {
    const context = yield* Effect.acquireRelease(
      Effect.promise(() => b.newContext()),
      (c) => Effect.promise(() => c.close()),
    );
    const seen: Seen = { dials: [], lines: [] };
    yield* Effect.promise(() =>
      context.route(`${ORIGIN}/**`, (route) => {
        const path = new URL(route.request().url()).pathname;

        if (path === "/window.js") {
          return route.fulfill({ contentType: "text/javascript; charset=utf-8", body: assets.script });
        }

        if (path === "/away") {
          return route.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><p>away</p>" });
        }

        return route.fulfill({ contentType: "text/html; charset=utf-8", body: assets.page });
      }),
    );
    yield* Effect.promise(() =>
      context.routeWebSocket(/^ws:\/\/127\.0\.0\.1\//, (ws) => {
        const dial: Dial = { at: Date.now(), from: ws.url(), closed: false };
        seen.dials.push(dial);
        ws.onClose(() => {
          dial.closed = true;
        });
      }),
    );

    if (init !== undefined) {
      yield* Effect.promise(() => context.addInitScript(init.script, init.arg));
    }

    return { context, seen };
  });

const tab = (context: BrowserContext, seen: Seen) =>
  Effect.acquireRelease(
    Effect.promise(() => context.newPage()),
    (page) => Effect.promise(() => page.close()),
  ).pipe(
    Effect.tap((page) =>
      Effect.sync(() =>
        page.on("console", (message) => {
          seen.lines.push(`${message.type()}: ${message.text()}`);
        }),
      ),
    ),
  );

const children = (page: Page) =>
  Effect.promise(() => page.evaluate(() => document.getElementById("root")?.childElementCount ?? -1));

const open = (seen: Seen) => seen.dials.filter((d) => !d.closed).length;

/** Waits until `check` holds or `within` ms pass, and answers whether it held. */
const until = (check: Effect.Effect<boolean>, within: number) =>
  Effect.gen(function* () {
    const end = Date.now() + within;

    for (;;) {
      if (yield* check) {
        return true;
      }

      if (Date.now() >= end) {
        return false;
      }

      yield* Effect.sleep("25 millis");
    }
  });

const isUp = (page: Page, seen: Seen) => Effect.map(children(page), (n) => n > 0 && open(seen) > 0);

const isStopped = (page: Page, seen: Seen) =>
  Effect.map(children(page), (n) => n === 0 && seen.dials.length > 0 && open(seen) === 0);

/** Opens the tab at `/` and waits until it is up. */
const up = (context: BrowserContext, seen: Seen) =>
  Effect.gen(function* () {
    const page = yield* tab(context, seen);
    yield* Effect.promise(() => page.goto(`${ORIGIN}/`));
    expect(yield* until(isUp(page, seen), 30_000), `the tab came up: ${JSON.stringify(seen)}`).toBe(true);
    return page;
  });

const pagehide = (page: Page, persisted: boolean) =>
  Effect.promise(() =>
    page.evaluate((p) => {
      globalThis.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: p }));
    }, persisted),
  );

const reported = (seen: Seen) => seen.lines.filter((line) => line.includes("ERROR"));

/** Runs in each page before its script: the page program's first DOM read throws `word`. */
const failQuery = (word: string) => {
  document.querySelector = () => {
    throw new Error(word);
  };
};

/** Runs in each page before its script: records every `pageshow`'s `persisted` flag. A page restored
 *  from the back/forward cache keeps its heap, so it holds the first load's flag and the restore's. */
const recordShows = () => {
  addEventListener("pageshow", (event) => {
    const shows: Array<boolean> = Reflect.get(globalThis, "__shows") ?? [];
    shows.push(event.persisted);
    Reflect.set(globalThis, "__shows", shows);
  });
};

describe("Tuval's page runs on Effect's browser runtime", () => {
  it("L2: for generated pagehide events, the page stays up while each is persisted and stops at the first that is not, reporting nothing", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const b = yield* browser();
          yield* Effect.promise(() =>
            fc.assert(
              fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }), (flags) =>
                Effect.runPromise(
                  Effect.scoped(
                    Effect.gen(function* () {
                      const { context, seen } = yield* profile(b);
                      const page = yield* up(context, seen);
                      let stoppedAt: number | null = null;

                      for (const [i, persisted] of flags.entries()) {
                        yield* pagehide(page, persisted);

                        if (stoppedAt !== null) {
                          yield* Effect.sleep(`${QUIET} millis`);
                          expect(yield* isStopped(page, seen), `event ${i} after the stop: still stopped`).toBe(true);
                          continue;
                        }

                        if (persisted) {
                          yield* Effect.sleep(`${QUIET} millis`);
                          expect(
                            yield* isUp(page, seen),
                            `event ${i}, persisted: still up ${JSON.stringify(seen)}`,
                          ).toBe(true);
                          continue;
                        }

                        expect(
                          yield* until(isStopped(page, seen), WITHIN),
                          `event ${i}, not persisted: stopped within ${WITHIN} ms ${JSON.stringify(seen)}`,
                        ).toBe(true);
                        stoppedAt = Date.now();
                      }

                      if (stoppedAt !== null) {
                        yield* Effect.sleep(`${QUIET} millis`);
                        expect(
                          seen.dials.filter((d) => d.at > stoppedAt!),
                          "no socket is dialed after the stop",
                        ).toEqual([]);
                        expect(yield* isStopped(page, seen), "the page stays stopped").toBe(true);
                      }

                      expect(reported(seen), "an interrupt is not reported").toEqual([]);
                    }),
                  ),
                ),
              ),
              { seed: SEED, numRuns: 12, ...RED },
            ),
          );
        }),
      ),
    );
  }, 300_000);

  it("L3 scenario: one real back/forward cache round trip keeps the window mounted, and it dials again; Chromium hands the listener the same persisted event on every trip, so more trips add no case", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          // The full Chromium, with Playwright's own `--disable-back-forward-cache` taken off: the
          // headless shell never restores a page from the cache (the plan's probe 5).
          const b = yield* browser({ channel: "chromium", ignoreDefaultArgs: ["--disable-back-forward-cache"] });
          const { context, seen } = yield* profile(b, { script: recordShows, arg: "" });
          const page = yield* up(context, seen);
          const before = seen.dials.length;
          yield* Effect.promise(() => page.goto(`${ORIGIN}/away`));
          // A page restored from the cache fires no `load`, so Back waits only for the commit, and
          // the law then waits for the `pageshow` the init script records.
          yield* Effect.promise(() => page.goBack({ waitUntil: "commit" }));
          const shows = Effect.promise((): Promise<ReadonlyArray<boolean>> =>
            page.evaluate(() => Reflect.get(globalThis, "__shows") ?? []).catch(() => []),
          );
          yield* until(
            Effect.map(shows, (s) => s.length > 0),
            30_000,
          );
          expect(yield* shows, "not restored: the page did not come back from the back/forward cache").toContain(true);
          expect(yield* children(page), "the window is still mounted after Back").toBeGreaterThan(0);
          expect(
            yield* until(
              Effect.sync(() => seen.dials.length > before),
              REDIAL_WITHIN,
            ),
            `the restored window dials again within ${REDIAL_WITHIN} ms`,
          ).toBe(true);
          expect(yield* children(page), "the window is still mounted once it dialed").toBeGreaterThan(0);
        }),
      ),
    );
  }, 120_000);

  it("L4: a generated failure of the page program is reported on the console", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const b = yield* browser();
          yield* Effect.promise(() =>
            fc.assert(
              fc.asyncProperty(fc.stringMatching(/^[a-z]{6,16}$/), (word) =>
                Effect.runPromise(
                  Effect.scoped(
                    Effect.gen(function* () {
                      const { context, seen } = yield* profile(b, { script: failQuery, arg: word });
                      const page = yield* tab(context, seen);
                      yield* Effect.promise(() => page.goto(`${ORIGIN}/`));
                      expect(
                        yield* until(
                          Effect.sync(() => reported(seen).some((line) => line.includes(word))),
                          WITHIN,
                        ),
                        `a console line with ERROR and "${word}" within ${WITHIN} ms: ${JSON.stringify(seen.lines)}`,
                      ).toBe(true);
                    }),
                  ),
                ),
              ),
              { seed: SEED, numRuns: 8, ...RED },
            ),
          );
        }),
      ),
    );
  }, 300_000);
});
