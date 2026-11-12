// P14 slice 2, next/ (ticket 828): the first window on the real instance, laws L11, L14, L15 and L17 of
// the approved plan. Written before the tab's code. Each suite starts the real `dev.ts` in its own temp
// home on its own port and drives headless Chromium; every resource is acquired in one scope through
// `p14.test-support.ts`, and `resources.laws.test.ts` (L16) runs this file as its child.
//
// What these laws hold the page to, from the plan: `/` boots `startWindow` outside React and mounts
// `Window` under Strict Mode; the screens by link state are a waiting screen with the code, the
// fingerprint and the one `grant.ts client` line, the desk with one named tile region per tile (the
// checklist `checklist:1`: a box per item named by the item, a `Remove <name>` button per item, and a
// text field named by the add input's description, with its refusal words tied to it by
// `aria-describedby`), a removed screen with an Ask again button, and a blocked screen. A lost link dims
// the tile and makes it `inert`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { applyCell } from "@demlik/tea";
import { checklist, checklistMachine } from "@kampus/checklist";
import { checklistWindow } from "@kampus/checklist/window";
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
  reader,
  remove,
  type Row,
  rows,
  type Seen,
  stopped,
  tab,
  target,
  tile,
  waiting,
} from "./p14.test-support.ts";

const SEED = 119120;
const NAME = "checklist:1";

type Model = typeof checklistMachine.model.Type;
type Msg = typeof checklistMachine.msg.Type;

/** What a tab must show for `model`: each item's box, checked when the item is. */
const foldRows = (model: Model): ReadonlyArray<Row> =>
  model.items.map((i) => ({ name: i.name, checked: i.state._tag === "checked" }));

/** Polls until `check` holds, or fails with the last value it read after 30 s. */
const settle = <A>(read: Effect.Effect<A>, check: (a: A) => boolean, label: string) =>
  Effect.gen(function* () {
    let last: A = yield* read;

    for (let tries = 0; tries < 120 && !check(last); tries++) {
      yield* Effect.sleep("250 millis");
      last = yield* read;
    }

    expect(check(last), `${label}: ${JSON.stringify(last)}`).toBe(true);
  });

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

const control = fc.record({ tab: fc.nat(), control: fc.nat(), row: fc.nat(), name: fc.nat() });
type Control = typeof control extends fc.Arbitrary<infer A> ? A : never;
const controls = fc.array(control, { minLength: 1, maxLength: 6 });

/** Runs inside Chromium before the page script, where IndexedDB reports failure by throwing. */
const blockKeyStore = () => {
  indexedDB.open = () => {
    throw new DOMException("store refused", "QuotaExceededError");
  };
};

/** Each move reads the selected tab's current rows, then presses a control enabled there. */
const useChecklist = (
  tabs: ReadonlyArray<Effect.Success<ReturnType<typeof tab>>>,
  moves: ReadonlyArray<Control>,
  pool: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    let model: Model = checklistMachine.init(null, {})[0];
    const words = tabs.map(() => "");
    yield* settle(tile(tabs[0]!.page, NAME).shown, (r) => r.length === 0, "a fresh brain's list is empty");

    for (const p of moves) {
      const at = p.tab % tabs.length;
      const t = tile(tabs[at]!.page, NAME);
      const shown = yield* t.shown;
      const row = shown.length === 0 ? null : shown[p.row % shown.length]!;
      const pick = row === null ? 0 : p.control % 3;
      let msg: Msg;

      if (pick === 0) {
        const name = pool[p.name % pool.length]!;
        msg = { type: "add", name };
        yield* Effect.promise(() => t.field.fill(name));
        yield* Effect.promise(() => t.field.press("Enter"));
      } else if (pick === 1) {
        msg = { type: row!.checked ? "uncheck" : "check", name: row!.name };
        yield* Effect.promise(() => t.box(row!.name).click());
      } else {
        msg = { type: "remove", name: row!.name };
        yield* Effect.promise(() => t.remove(row!.name).click());
      }

      const refusal = checklist.refuse(model, msg);

      if (refusal === null) {
        model = applyCell(checklistMachine, model, msg)[0];
      }

      words[at] = refusal === null ? "" : checklistWindow.refused!(msg, refusal.reason);
      const want = foldRows(model);
      yield* settle(
        Effect.all([t.shown, t.refusal], { concurrency: 1 }),
        ([r, said]) => JSON.stringify(r) === JSON.stringify(want) && said === words[at],
        `tab ${at} after ${msg.type}`,
      );
    }

    for (const [at, t] of tabs.entries()) {
      const want = foldRows(model);
      yield* settle(
        Effect.all([tile(t.page, NAME).shown, tile(t.page, NAME).refusal], { concurrency: 1 }),
        ([r, said]) => JSON.stringify(r) === JSON.stringify(want) && said === words[at],
        `tab ${at} at the end`,
      );
    }

    return moves.length;
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
          yield* Effect.promise(() => tile(first.page, NAME).field.waitFor({ timeout: 30_000 }));
          yield* Effect.promise(() => tile(second.page, NAME).field.waitFor({ timeout: 30_000 }));
          expect(first.seen.sockets.length, "online without a new dial").toBe(before);
          expect(
            yield* Effect.promise(() => tile(first.page, NAME).region.getAttribute("inert")),
            "an online tile is live",
          ).toBeNull();
          // A reload uses the same key and needs no new grant.
          yield* Effect.promise(() => first.page.reload());
          yield* Effect.promise(() => tile(first.page, NAME).field.waitFor({ timeout: 30_000 }));
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
          // L3's store failures also reach the real blocked screen; they never become a fresh wait.
          const blockedProfile = yield* profile(b);
          yield* Effect.promise(() => blockedProfile.addInitScript(blockKeyStore));
          const blocked = yield* tab(blockedProfile, dev.url);
          yield* Effect.promise(() => blocked.page.getByRole("heading", { name: "This window is blocked" }).waitFor());
          const blockedText = yield* Effect.promise(() => blocked.page.locator("body").innerText());
          expect(blockedText).toContain("QuotaExceededError");
          expect(blockedText).not.toContain("grant.ts client");
        }),
      ),
  );
});

describe("L15: use in two tabs (W2)", () => {
  it(
    "after any adds, checks, unchecks and removes in either tab, both tabs show the checklist's fold of the accepted letters, each tab shows its own refusals, and no letter lands twice",
    { timeout: 900_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(controls, (moves) =>
          suite(
            Effect.gen(function* () {
              const h = yield* home;
              const dev = yield* devServer(h);
              const b = yield* browser;
              const context = yield* profile(b);
              const tabs = [yield* tab(context, dev.url), yield* tab(context, dev.url)];
              yield* online(h, tabs[0]!.page);
              yield* Effect.forEach(
                tabs,
                (t) => Effect.promise(() => tile(t.page, NAME).field.waitFor({ timeout: 30_000 })),
                { concurrency: 1 },
              );
              const pressed = yield* useChecklist(tabs, moves, ["milk", "bread", "eggs"]);
              // No letter id lands twice: a duplicated add could hide as a taken refusal.
              const r = yield* reader(h, dev);
              const inbox = yield* r.read(`${NAME}/inbox`);
              const ids = inbox.map((e) => e.id);
              expect(ids.length, "every accepted press reached the inbox").toBeGreaterThan(0);
              expect(ids.length).toBeLessThanOrEqual(pressed);
              expect(new Set(ids).size, "a letter landed twice").toBe(ids.length);
            }),
          ),
        ),
        { seed: SEED, numRuns: 5 },
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
            item: fc.stringMatching(/^[a-z]{24,40}$/),
            failFirst: fc.boolean(),
            moves: controls,
          }),
          async ({ token, secret, item, failFirst, moves }) => {
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
                const second = yield* tab(context, dev.url);
                const w = yield* waiting(t.page);
                const grantErrors: Array<string> = [];

                if (failFirst) {
                  // A failed grant first: its output must not leak either.
                  const refused = yield* grant(stranger, w);
                  expect(refused.ok).toBe(false);

                  if (!refused.ok) {
                    grantErrors.push(refused.error);
                  }
                }

                yield* grant(h, w);
                // A sentinel item name, added twice: the second add is refused `taken`. The name is
                // input text, so the page may show it but no row, record, URL or console line may.
                const field = tile(t.page, NAME).field;
                yield* Effect.promise(() => field.waitFor({ timeout: 30_000 }));
                yield* Effect.promise(() => tile(second.page, NAME).field.waitFor({ timeout: 30_000 }));
                yield* useChecklist([t, second], moves, [`itm_${item}`, "milk", "bread"]);

                for (let n = 0; n < 2; n++) {
                  yield* Effect.promise(() => field.fill(`itm_${item}`));
                  yield* Effect.promise(() => field.press("Enter"));
                  yield* Effect.sleep("2 seconds");
                }

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
                const outputs = [
                  ...(yield* look(t.page, t.seen)),
                  ...(yield* look(second.page, second.seen)),
                  ...grantErrors.map((error): readonly [string, string] => ["grant error", error]),
                  ...stored(h.dir),
                ];

                for (const form of [`itm_${item}`, encodeURIComponent(`itm_${item}`)]) {
                  for (const [output, text] of outputs.filter(([o]) => o !== "page" && !o.startsWith("home"))) {
                    expect(text.includes(form), `${output} copies an item's name`).toBe(false);
                  }
                }

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
