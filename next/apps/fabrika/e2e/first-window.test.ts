// P14 slice 2, next/ (ticket 828): the first window on the real instance, laws L11, L14, L15 and L17 of
// the approved plan. Written before the tab's code. Each suite starts the real `dev.ts` in its own temp
// home on its own port and drives headless Chromium; every resource is acquired in one scope through
// `p14.test-support.ts`, and `resources.laws.test.ts` (L16) runs this file as its child.
//
// What these laws hold the page to, from the plan: `/` boots `startWindow` outside React and mounts
// `Window` under Strict Mode; the screens by link state are a waiting screen with the code, the
// fingerprint and the one `grant.ts client` line, the desk with one named tile region per tile (its
// count in the tile's own status, its buttons by the program's input descriptions), a removed screen
// with an Ask again button, and a blocked screen. A lost link dims the tile and makes it `inert`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  browser,
  devServer,
  fault,
  grant,
  home,
  type Home,
  profile,
  remove,
  rows,
  type Seen,
  stopped,
  tab,
  target,
  tile,
  waiting,
} from "./p14.test-support.ts";

const SEED = 119120;
const NAME = "counter:1";

const INPUTS = [
  ["inc", "Add one"],
  ["dec", "Take one away"],
  ["reset", "Back to zero"],
] as const;

const fold = (count: number, input: string) => (input === "inc" ? count + 1 : input === "dec" ? count - 1 : 0);

/** Runs one suite body in its own scope, racing the worker's stop, with the planted test fault. */
const suite = <A>(body: Effect.Effect<A, unknown, import("effect").Scope.Scope>) =>
  Effect.runPromise(
    Effect.scoped(
      body.pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (fault?.kind === "test") {
              expect.fail(`scenario: a test that fails after ${fault.at} was acquired`);
            }
          }),
        ),
      ),
    ).pipe(Effect.raceFirst(stopped)),
  );

const online = (h: Home, page: import("playwright").Page) =>
  Effect.gen(function* () {
    const w = yield* waiting(page);
    expect((yield* grant(h, w)).ok, "the grant line as shown grants").toBe(true);
    return w;
  });

describe("L11: boot", () => {
  it(
    "scenario: Strict Mode's double mount starts one runtime and one dial; closing the tab closes its socket",
    { timeout: 300_000 },
    () =>
      suite(
        Effect.gen(function* () {
          const h = yield* home;
          const dev = yield* devServer(h);
          const b = yield* browser;
          const context = yield* profile(b);
          const { page, seen } = yield* tab(context, dev.url);
          const sockets = seen.opened;
          yield* waiting(page);
          yield* Effect.sleep("2 seconds");
          // The entry mounts under Strict Mode, which mounts twice: one runtime still dials once.
          expect(sockets, "one runtime dials once").toHaveLength(1);
          const closed = Effect.promise(() =>
            sockets[0]!.isClosed() ? Promise.resolve(true) : sockets[0]!.waitForEvent("close").then(() => true),
          );
          yield* Effect.promise(() => page.close());
          expect(yield* closed.pipe(Effect.timeout("10 seconds")), "closing the tab closes its socket").toBe(true);
        }),
      ),
  );
});

describe("L14: the first window (p29)", () => {
  it(
    "scenario: p29's whole flow on the real dev.ts: wait, grant, reload, two tabs, a stranger's grant, removal and Ask again",
    { timeout: 600_000 },
    () =>
      suite(
        Effect.gen(function* () {
          const h = yield* home;
          const stranger = yield* home;
          const dev = yield* devServer(h);
          const b = yield* browser;
          const context = yield* profile(b);
          const first = yield* tab(context, dev.url);
          const second = yield* tab(context, dev.url);
          // A fresh profile waits with one code and one fingerprint, the same in both tabs.
          const w1 = yield* waiting(first.page);
          const w2 = yield* waiting(second.page);
          expect(w2.fingerprint, "two tabs of one profile share one key").toBe(w1.fingerprint);
          expect(w2.code, "two tabs of one profile show one code").toBe(w1.code);
          expect(w1.url).toBe(dev.url);
          // A grant signed by a key that is not the person's leaves it waiting.
          expect((yield* grant(stranger, w1)).ok).toBe(false);
          yield* waiting(first.page);
          const t = yield* target(w1);
          // The person's grant brings both tabs online on the same socket: no reload, no new dial.
          const before = first.seen.sockets.length;
          expect((yield* grant(h, w1)).ok).toBe(true);
          yield* Effect.promise(() => tile(first.page, NAME).count.waitFor({ timeout: 30_000 }));
          yield* Effect.promise(() => tile(second.page, NAME).count.waitFor({ timeout: 30_000 }));
          expect(first.seen.sockets.length, "online without a new dial").toBe(before);
          expect(
            yield* Effect.promise(() => tile(first.page, NAME).region.getAttribute("inert")),
            "an online tile is live",
          ).toBeNull();
          // A reload uses the same key and needs no new grant.
          yield* Effect.promise(() => first.page.reload());
          yield* Effect.promise(() => tile(first.page, NAME).count.waitFor({ timeout: 30_000 }));
          expect(
            yield* Effect.promise(() => first.page.locator("body").innerText()),
            "a reload shows no code",
          ).not.toContain(w1.code);
          // The person removes the key: the tab says the window was removed, and nothing dials.
          expect((yield* remove(h, dev, t)).ok).toBe(true);
          yield* Effect.promise(() => first.page.getByText("This window was removed").waitFor({ timeout: 30_000 }));
          const quiet = first.seen.sockets.length;
          yield* Effect.sleep("3 seconds");
          expect(first.seen.sockets.length, "a removed window does not dial").toBe(quiet);
          // Ask again makes a new key and a new wait.
          yield* Effect.promise(() => first.page.getByRole("button", { name: "Ask again" }).click());
          const again = yield* waiting(first.page);
          expect(again.fingerprint, "Ask again makes a new key").not.toBe(w1.fingerprint);
        }),
      ),
  );
});

describe("L15: presses in two tabs", () => {
  it(
    "after any presses in either tab, both tabs show the count the counter folds from the accepted letters",
    { timeout: 600_000 },
    async () => {
      await suite(
        Effect.gen(function* () {
          const h = yield* home;
          const dev = yield* devServer(h);
          const b = yield* browser;
          const context = yield* profile(b);
          const tabs = [yield* tab(context, dev.url), yield* tab(context, dev.url)];
          yield* online(h, tabs[0]!.page);
          yield* Effect.forEach(
            tabs,
            (t) => Effect.promise(() => tile(t.page, NAME).count.waitFor({ timeout: 30_000 })),
            { concurrency: 1 },
          );
          let count = Number(yield* Effect.promise(() => tile(tabs[0]!.page, NAME).count.innerText()));
          yield* Effect.promise(() =>
            fc.assert(
              fc.asyncProperty(
                fc.array(fc.record({ tab: fc.nat(), input: fc.nat() }), { minLength: 1, maxLength: 6 }),
                async (presses) => {
                  for (const p of presses) {
                    const t = tile(tabs[p.tab % tabs.length]!.page, NAME);
                    // Pick from the buttons enabled now, as a person can press only those.
                    const enabled: Array<(typeof INPUTS)[number]> = [];

                    for (const input of INPUTS) {
                      if (await t.button(input[1]).isEnabled()) {
                        enabled.push(input);
                      }
                    }

                    expect(enabled.length, "an online tile offers its inputs").toBeGreaterThan(0);
                    const [type, label] = enabled[p.input % enabled.length]!;
                    await t.button(label).click();
                    count = fold(count, type);
                  }

                  // Every letter lands once: both tabs settle on the counter's fold of every press.
                  for (const t of tabs) {
                    await tile(t.page, NAME)
                      .count.filter({ hasText: new RegExp(`^${count}$`) })
                      .waitFor({ timeout: 30_000 });
                  }
                },
              ),
              { seed: SEED, numRuns: 5 },
            ),
          );
        }),
      );
    },
  );
});

describe("L17: [secrets] no output copies a key, a signature or a credential", () => {
  it(
    "[secrets] for generated sentinel credentials in the instance's env, the page, rows, errors, URLs, console lines and sockets never copy one",
    { timeout: 1_800_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            token: fc.stringMatching(/^[A-Za-z0-9]{24,40}$/),
            secret: fc.stringMatching(/^[A-Za-z0-9_-]{24,40}$/),
            failFirst: fc.boolean(),
          }),
          async ({ token, secret, failFirst }) => {
            await suite(
              Effect.gen(function* () {
                const h = yield* home;
                const stranger = yield* home;
                const dev = yield* devServer(h, {
                  FABRIKA_SENTINEL_TOKEN: `tok_${token}`,
                  FABRIKA_SENTINEL_SECRET: `sec_${secret}`,
                });
                const b = yield* browser;
                const context = yield* profile(b);
                const t = yield* tab(context, dev.url);
                const w = yield* waiting(t.page);

                if (failFirst) {
                  // A failed grant first: its output must not leak either.
                  expect((yield* grant(stranger, w)).ok).toBe(false);
                }

                yield* grant(h, w);
                yield* Effect.promise(() => tile(t.page, NAME).count.waitFor({ timeout: 30_000 }));
                yield* Effect.promise(() => tile(t.page, NAME).button("Add one").click());
                yield* Effect.sleep("2 seconds");
                const tt = yield* target(w).pipe(Effect.orElseSucceed(() => null));
                const revoked = tt === null ? null : yield* remove(h, dev, tt);
                const personKey = yield* Effect.sync(() => readFileSync(h.key, "utf8"));
                const secrets = [
                  `tok_${token}`,
                  `sec_${secret}`,
                  ...personKey.split("\n").filter((l) => l.length > 20 && !l.startsWith("-----")),
                  ...(revoked === null
                    ? []
                    : revoked.armored.split("\n").filter((l) => l.length > 20 && !l.startsWith("-----"))),
                ];
                const outputs = [...(yield* look(t.page, t.seen)), ...stored(h.dir)];

                for (const s of secrets) {
                  for (const form of [s, encodeURIComponent(s), btoa(s)]) {
                    for (const [output, text] of outputs) {
                      expect(text.includes(form), `${output} copies a secret`).toBe(false);
                    }
                  }
                }
              }),
            );
          },
        ),
        { seed: SEED, numRuns: 10 },
      );
    },
  );
});

/** What the instance kept in its home, its records and spans among them, by file: never the key files. */
const stored = (dir: string): ReadonlyArray<readonly [string, string]> =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .map((name) => join(dir, name))
    .filter((file) => statSync(file).isFile() && !/[/]person(\.pub)?$/.test(file))
    .map((file) => [`home ${file.slice(dir.length)}`, readFileSync(file).toString("latin1")] as const);

/** Every named output of a tab: its page text and markup, its rows, console lines, errors, URLs and sockets. */
const look = (page: import("playwright").Page, seen: Seen) =>
  Effect.gen(function* () {
    const html = yield* Effect.promise(() => page.content());
    const stored = yield* rows(page);
    return [
      ["page", html],
      ["rows", JSON.stringify(stored)],
      ["console", seen.console.join("\n")],
      ["errors", seen.errors.join("\n")],
      ["urls", seen.urls.join("\n")],
      ["sockets", seen.sockets.join("\n")],
    ] as const;
  });
