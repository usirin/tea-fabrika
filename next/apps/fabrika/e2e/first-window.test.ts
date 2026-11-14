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
import { DatabaseSync } from "node:sqlite"; // edge: inspect the instance's persisted SQLite cells, including records outside access history
import { applyCell } from "@demlik/tea";
import { checklist, checklistMachine } from "@kampus/checklist";
import { checklistWindow } from "@kampus/checklist/window";
import { Sent } from "@kampus/libfabrika";
import { MemberEvent } from "@kampus/libfabrika/access/Access";
import { Row as LedgerRow, valueFor } from "@kampus/libfabrika/ledger/Log";
import { resolveName } from "@kampus/libfabrika/runtime/Client";
import { Chain } from "@kampus/libfabrika/telemetry/Trace";
import { Effect, Fiber, Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  browser,
  devServer,
  fault,
  grant,
  home,
  homeWithCredential,
  type Home,
  profile,
  reader,
  remove,
  type Row,
  rows,
  type Seen,
  suite,
  tab,
  target,
  tile,
  waiting,
} from "./p14.test-support.ts";

const SEED = 119120;
const NAME = "checklist:1";
/** How a red law ends: at its first failing run, with that run's seed, path and moves, and no
 *  shrinking. Each retry of a shrink starts a brain and a browser again and may wait 30 s for what
 *  never shows, so a shrink outlasts CI's job. The seed and the run counts stay as they are. */
const RED = { endOnFailure: true } as const;
/** How long a page may wait to hear of a close it started, in ms. Measured on the real `dev.ts` and
 *  Chromium, 2026-11-13: 4 ms when the brain answers the close frame, 10,027 ms when it does not (the
 *  browser's own wait for a closing socket, after which it reports 1006). Two seconds is 500 times
 *  the answered time, room for a CI machine that is slow or stalls, and a fifth of the unanswered
 *  one, so a brain that stops answering can never pass. */
const CLOSE_WITHIN = 2000;
/** Each law's own limit in ms, the stop for a run that hangs. Every wait inside a law has a bound of
 *  its own (30 s for what a tile shows, 60 s for a screen or an answer, 180 s for `dev.ts`), so a red
 *  law ends long before this. Measured green on a 12-core laptop under load, 2026-11-13: L11 9 to
 *  20 s, L14 11 s, L15 48 to 67 s, L17 101 s. The four limits add up to 16 minutes, inside the 17
 *  minutes CI gives the job that runs this file; they were 60 minutes. */
const LIMIT = { L11: 90_000, L14: 90_000, L15: 300_000, L17: 480_000 } as const;

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

/** Let the brain settle each press, then lose its first answer and the socket. The next dial
 *  must resend that press before the page can see its terminal answer. Each close the page starts
 *  is kept as the page is told of it: its code, whether it was clean, and how long it took. */
const loseFirstAnswers = () => {
  const NativeSocket = WebSocket;
  const observed: {
    groups: Array<{
      attempts: Array<{ dial: number; params: unknown }>;
      firstAnswer: unknown;
      result: unknown;
      closed: { code: number; clean: boolean; ms: number } | null;
    }>;
  } = {
    groups: [],
  };
  Reflect.set(globalThis, "__p14Resends", observed);
  let active: (typeof observed.groups)[number] | undefined;
  let dials = 0;
  globalThis.WebSocket = class extends NativeSocket {
    private readonly dial = ++dials;
    private readonly sends = new Map<unknown, (typeof observed.groups)[number]>();

    constructor(url: string | URL, protocols?: string | Array<string>) {
      super(url, protocols);
      this.addEventListener("message", (event) => {
        if (typeof event.data !== "string" || event.data === "pong") {
          return;
        }

        const frame = JSON.parse(event.data);
        const group = this.sends.get(frame.id);

        if (group === undefined || !["accepted", "refused"].includes(frame.result?._tag)) {
          return;
        }

        if (group.firstAnswer === null) {
          group.firstAnswer = frame.result;
          event.stopImmediatePropagation();
          const started = performance.now();
          this.addEventListener(
            "close",
            (end) => {
              group.closed = { code: end.code, clean: end.wasClean, ms: performance.now() - started };
            },
            { once: true },
          );
          this.close(4001, "lost answer");
        } else {
          group.result = frame.result;
          active = undefined;
        }
      });
    }

    // The DOM lib and the Workers types each declare `send`: this takes both overloads' data, and each branch below calls one.
    override send(data: string | Blob | ArrayBuffer | ArrayBufferView) {
      if (typeof data === "string" && data !== "ping") {
        const frame = JSON.parse(data);

        if (frame.method === "process.send") {
          if (active === undefined) {
            active = { attempts: [], firstAnswer: null, result: null, closed: null };
            observed.groups.push(active);
          }

          active.attempts.push({ dial: this.dial, params: frame.params });
          this.sends.set(frame.id, active);
        }
      }

      if (data instanceof Blob) {
        super.send(data);
      } else {
        super.send(data);
      }
    }
  };
};

const Resends = Schema.Struct({
  groups: Schema.Array(
    Schema.Struct({
      attempts: Schema.Array(
        Schema.Struct({
          dial: Schema.Int,
          params: Schema.Struct({
            pid: Schema.String,
            letter: Schema.String,
            m: checklist.msg,
            sentAt: Schema.String,
            seen: Schema.Int,
            traceId: Schema.optionalKey(Schema.String),
          }),
        }),
      ),
      firstAnswer: Schema.NullOr(Sent),
      result: Schema.NullOr(Sent),
      closed: Schema.NullOr(Schema.Struct({ code: Schema.Int, clean: Schema.Boolean, ms: Schema.Number })),
    }),
  ),
});

const resends = (page: import("playwright").Page) =>
  Effect.promise(() => page.evaluate(() => Reflect.get(globalThis, "__p14Resends"))).pipe(
    Effect.map(Schema.decodeUnknownSync(Resends)),
  );

/** Each move reads the selected tab's current rows, then presses a control enabled there. */
const useChecklist = (
  tabs: ReadonlyArray<Effect.Success<ReturnType<typeof tab>>>,
  moves: ReadonlyArray<Control>,
  pool: ReadonlyArray<string>,
  observe: Effect.Effect<unknown> = Effect.void,
  afterPress: (msg: Msg, at: number) => Effect.Effect<unknown> = () => Effect.void,
) =>
  Effect.gen(function* () {
    let model: Model = checklistMachine.init(null, {})[0];
    const words = tabs.map(() => "");
    yield* settle(tile(tabs[0]!.page, NAME).shown, (r) => r.length === 0, "a fresh brain's list is empty");

    for (const p of moves) {
      const at = p.tab % tabs.length;
      const t = tile(tabs[at]!.page, NAME);
      // A tab whose last answer was lost has dialed again: its tile takes no press until it is live.
      yield* t.live;
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
      yield* observe;
      yield* afterPress(msg, at);
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
    "scenario: the page starts one dial; closing the tab removes its connection at the brain",
    { timeout: fault?.kind === "timeout" ? (fault.at === "home" ? 500 : 60_000) : LIMIT.L11 },
    (context) =>
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
          // The real tab bundle uses production React. The entry location is checked in build.test.ts.
          expect(sockets, "one runtime dials once").toHaveLength(1);
          // L16's plain child also reaches the reader's socket.
          yield* online(h, page);
          const audit = yield* reader(h, dev);
          const leaves = Effect.map(
            audit.spans(),
            (spans) => spans.filter((span) => Reflect.get(Object(span), "name") === "connections.leave").length,
          );
          const before = yield* leaves;
          // Start observing before page.close, and observe the brain rather than a destroyed page handle.
          const closed = yield* Effect.forkScoped(
            Effect.gen(function* () {
              while ((yield* leaves) === before) {
                yield* Effect.sleep("100 millis");
              }
            }).pipe(Effect.timeout("10 seconds")),
          );
          yield* Effect.promise(() => page.close());
          yield* Fiber.join(closed);
        }),
        context,
      ),
  );
});

describe("L14: the first window (p29)", () => {
  it(
    "scenario: p29's whole flow on the real dev.ts: wait, grant, reload, two tabs, a stranger's grant, removal and Ask again",
    { timeout: LIMIT.L14 },
    (context) =>
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
          yield* Effect.promise(() => blocked.page.getByRole("heading", { name: "Blocked", exact: true }).waitFor());
          const blockedText = yield* Effect.promise(() => blocked.page.locator("body").innerText());
          expect(blockedText).toContain("QuotaExceededError");
          expect(blockedText).not.toContain("grant.ts client");
        }),
        context,
      ),
  );
});

describe("L15: use in two tabs (W2)", () => {
  it(
    "after any adds, checks, unchecks and removes in either tab, both tabs show the checklist's fold of the accepted letters, each tab shows its own refusals, and no letter lands twice",
    { timeout: LIMIT.L15 },
    async (context) => {
      await fc.assert(
        fc.asyncProperty(controls, (moves) =>
          suite(
            Effect.gen(function* () {
              const h = yield* home;
              const dev = yield* devServer(h);
              const b = yield* browser;
              const context = yield* profile(b);
              yield* Effect.promise(() => context.addInitScript(loseFirstAnswers));
              const tabs = [yield* tab(context, dev.url), yield* tab(context, dev.url)];
              yield* online(h, tabs[0]!.page);
              yield* Effect.forEach(
                tabs,
                (t) => Effect.promise(() => tile(t.page, NAME).field.waitFor({ timeout: 30_000 })),
                { concurrency: 1 },
              );
              const settled = tabs.map(() => 0);
              const accepted: Array<string> = [];
              const refused: Array<string> = [];
              const pressed = yield* useChecklist(tabs, moves, ["milk", "bread", "eggs"], Effect.void, (msg, at) =>
                Effect.gen(function* () {
                  const index = settled[at]!;
                  settled[at] = index + 1;
                  yield* settle(
                    resends(tabs[at]!.page),
                    (s) => s.groups[index]?.result != null,
                    "a lost terminal answer is recovered on the next dial",
                  );
                  const group = (yield* resends(tabs[at]!.page)).groups[index]!;
                  // The brain answers the page's close frame, so the page hears of its own close at once.
                  expect(group.closed, "the page's close comes back clean, with the code it sent").toMatchObject({
                    code: 4001,
                    clean: true,
                  });
                  expect(group.closed!.ms, "an answered close is reported at once").toBeLessThan(CLOSE_WITHIN);
                  expect(group.attempts.length, "the press was actually resent").toBeGreaterThanOrEqual(2);
                  const first = group.attempts[0]!;
                  expect(group.attempts.at(-1)!.dial, "the resend used a new socket").toBeGreaterThan(first.dial);
                  expect(first.params.m).toEqual(msg);
                  expect(group.result, "the brain returns the saved terminal answer on resend").toEqual(
                    group.firstAnswer,
                  );

                  for (const attempt of group.attempts) {
                    expect(attempt.params, "resends keep the whole body and letter id").toEqual(first.params);
                  }

                  if (group.result!._tag === "accepted") {
                    accepted.push(first.params.letter);
                  } else {
                    refused.push(first.params.letter);
                  }
                }),
              );
              // No letter id lands twice: a duplicated add could hide as a taken refusal.
              const r = yield* reader(h, dev);
              const inbox = yield* r.read(`${NAME}/inbox`);
              const ids = inbox.map((e) => e.id);
              expect(new Set(ids).size, "a letter landed twice").toBe(ids.length);
              expect(accepted.length, "the walk accepts a press").toBeGreaterThan(0);
              expect(accepted.length + refused.length, "every press has one terminal answer").toBe(pressed);
              const letters = new Set([...accepted, ...refused]);
              expect(new Set(accepted).size, "each accepted press has its own letter id").toBe(accepted.length);
              expect(ids.filter((id) => letters.has(id)).sort(), "exactly the accepted presses land once").toEqual(
                [...accepted].sort(),
              );

              for (const entry of inbox.filter((entry) => !letters.has(entry.id))) {
                expect(entry._tag, "inbox entries are mailbox sends").toBe("send");
                const { m } = Schema.decodeUnknownSync(Schema.Struct({ m: checklist.msg }))(entry.body);
                expect(m.type, "every remaining inbox entry is a runner timer").toBe("timer");
                expect(entry.id, "the runner timer has its own revision-scoped id").toMatch(/\/due\/\d+\/\d+$/);
              }
            }),
            context,
          ),
        ),
        { seed: SEED, numRuns: 5, ...RED },
      );
    },
  );
});

describe("L17: [secrets] no output copies a key, a signature or a credential", () => {
  it(
    "[secrets] for generated sentinel credentials in the instance's env, the page, rows, errors, URLs, console lines and sockets never copy one",
    { timeout: LIMIT.L17 },
    async (context) => {
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
                const h = yield* homeWithCredential(`person_${secret}`);
                const stranger = yield* homeWithCredential(`stranger_${secret}`);
                const dev = yield* devServer(h, {
                  FABRIKA_SENTINEL_TOKEN: `tok_${token}`,
                  FABRIKA_SENTINEL_SECRET: `sec_${secret}`,
                });
                const b = yield* browser;
                const context = yield* profile(b);
                const t = yield* tab(context, dev.url);
                const second = yield* tab(context, dev.url);
                const snapshots: Array<readonly [string, string]> = [];
                const observe = Effect.gen(function* () {
                  snapshots.push(...(yield* look(t.page, t.seen)), ...(yield* look(second.page, second.seen)));
                });
                const w = yield* waiting(t.page);
                const tt = yield* target(w);
                yield* observe;
                const grantErrors: Array<string> = [];

                if (failFirst) {
                  // A failed grant first: its output must not leak either.
                  const refused = yield* grant(stranger, w);
                  expect(refused.ok).toBe(false);

                  if (!refused.ok) {
                    grantErrors.push(refused.error);
                  }

                  yield* observe;
                }

                yield* grant(h, w);
                // A sentinel item name, added twice: the second add is refused `taken`. The name is
                // input text, so the page may show it but no row, record, URL or console line may.
                const field = tile(t.page, NAME).field;
                yield* Effect.promise(() => field.waitFor({ timeout: 30_000 }));
                yield* Effect.promise(() => tile(second.page, NAME).field.waitFor({ timeout: 30_000 }));
                yield* observe;
                yield* useChecklist([t, second], moves, ["milk", "bread", "eggs"], observe);

                for (let n = 0; n < 2; n++) {
                  yield* Effect.promise(() => field.fill(`itm_${item}`));
                  yield* Effect.promise(() => field.press("Enter"));

                  if (n === 0) {
                    yield* settle(
                      tile(t.page, NAME).shown,
                      (shown) => shown.some((row) => row.name === `itm_${item}`),
                      "the sentinel item lands",
                    );
                  } else {
                    yield* settle(
                      tile(t.page, NAME).refusal,
                      (words) => words === checklistWindow.refused!({ type: "add", name: `itm_${item}` }, "taken"),
                      "the duplicate sentinel is refused",
                    );
                  }

                  yield* observe;
                }

                yield* Effect.promise(() => t.page.reload());
                yield* Effect.promise(() => tile(t.page, NAME).field.waitFor({ timeout: 30_000 }));
                yield* observe;
                const r = yield* reader(h, dev);
                const revoked = yield* remove(h, dev, tt);
                expect(revoked.ok).toBe(true);
                yield* Effect.promise(() => t.page.getByText("This window was removed").waitFor());
                yield* observe;
                yield* Effect.promise(() => t.page.getByRole("button", { name: "Ask again" }).click());
                yield* waiting(t.page);
                yield* observe;
                const pid = resolveName(
                  yield* r.read(`processes/${NAME}`),
                  NAME,
                  (by) => by === "brain" || by.startsWith("brain:"),
                );
                expect(pid, "the checklist's live process has a span chain").not.toBeNull();
                const spans = [...(yield* r.spans()), ...(yield* r.spans(Chain.cases.job.make({ process: pid! })))];
                expect(
                  h.grants.flatMap((g) => g.signatures).length,
                  "the real grant signature was observed",
                ).toBeGreaterThan(0);
                const credentials = [`tok_${token}`, `sec_${secret}`, h.credential, stranger.credential];
                const signatures = [
                  ...[...h.grants, ...stranger.grants]
                    .flatMap((g) => g.signatures)
                    .flatMap((signature) => [
                      signature,
                      ...signature.split("\n").filter((line) => line.length > 20 && !line.startsWith("-----")),
                    ]),
                  ...revoked.armored.split("\n").filter((line) => line.length > 20 && !line.startsWith("-----")),
                ];
                const access = yield* r.read("gateway/access");
                const retained = access.filter((entry) => entry._tag === "granted" || entry._tag === "revoked");
                expect(
                  retained.some((entry) => entry._tag === "granted"),
                  "the signed grant stays in its history",
                ).toBe(true);
                expect(
                  retained.some((entry) => entry._tag === "revoked"),
                  "the signed removal stays in its history",
                ).toBe(true);
                const accessBodies = new Map<string, string>();
                const records = access.map((entry): readonly [string, string] => {
                  if (entry._tag !== "granted" && entry._tag !== "revoked") {
                    return ["access record", JSON.stringify(entry)];
                  }

                  const event = Schema.decodeUnknownSync(
                    Schema.Union([MemberEvent.cases.granted, MemberEvent.cases.revoked]),
                  )(valueFor(entry));

                  expect(
                    [...h.grants.flatMap((g) => g.signatures), revoked.armored],
                    "only the proof actually sent is retained",
                  ).toContain(event.signed.armored);
                  // Access.Signed keeps this proof by design. Check every other field for copies.
                  const object = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json));
                  const body = object(entry.body);
                  const { armored: _proof, ...signed } = object(body.signed);
                  accessBodies.set(JSON.stringify(body), JSON.stringify({ ...body, signed }));
                  return ["access record", JSON.stringify({ ...entry, body: { ...body, signed } })];
                });
                const proofs = [...[...h.grants, ...stranger.grants].flatMap((g) => g.signatures), revoked.armored];
                const disk = yield* stored(h.dir, accessBodies, proofs);
                const outputs: ReadonlyArray<readonly [string, string]> = [
                  ...snapshots,
                  ...(yield* look(t.page, t.seen)),
                  ...(yield* look(second.page, second.seen)),
                  ...grantErrors.map((error): readonly [string, string] => ["grant error", error]),
                  ...[...h.grants, ...stranger.grants].flatMap((g): ReadonlyArray<readonly [string, string]> => [
                    ["grant output", g.output],
                    ["grant urls", g.urls.join("\n")],
                  ]),
                  ["server console", dev.output()],
                  ["spans", JSON.stringify(spans)],
                  ...records,
                  ...disk.outputs,
                ];

                const checkedOutputs = outputs.flatMap(([output, text]): ReadonlyArray<readonly [string, string]> => [
                  [output, text],
                  [output, percentDecoded(text)],
                ]);
                const credentialOutputs = [
                  ...checkedOutputs,
                  ...disk.raw.flatMap(([output, text]): ReadonlyArray<readonly [string, string]> => [
                    [output, text],
                    [output, percentDecoded(text)],
                  ]),
                ];

                for (const [output, decoded] of credentialOutputs) {
                  expect(
                    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(decoded),
                    `${output} contains private key material`,
                  ).toBe(false);
                }

                for (const form of [`itm_${item}`, encodeURIComponent(`itm_${item}`)]) {
                  for (const [output, text] of checkedOutputs.filter(([o]) => o !== "page" && !o.startsWith("home"))) {
                    expect(text.includes(form), `${output} copies an item's name`).toBe(false);
                  }
                }

                // Every output that copies a secret is named, not only the first one found.
                const copies = new Set<string>();

                for (const s of [...credentials, ...signatures]) {
                  for (const form of [s, encodeURIComponent(s), btoa(s), JSON.stringify(s).slice(1, -1)]) {
                    const checked = signatures.includes(s) ? checkedOutputs : credentialOutputs;

                    for (const [output, text] of checked) {
                      if (text.includes(form)) {
                        copies.add(`${output} copies a ${signatures.includes(s) ? "signature" : "credential"}`);
                      }
                    }
                  }
                }

                expect([...copies], "an output copies a secret").toEqual([]);
              }),
              context,
            );
          },
        ),
        { seed: SEED, numRuns: 10, ...RED },
      );
    },
  );
});

/** Decode even partial or lowercase URL escapes, including a URL embedded in another URL. */
const percentDecoded = (text: string): string => {
  for (;;) {
    const decoded = text.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

    if (decoded === text) {
      return decoded;
    }

    text = decoded;
  }
};

/** Check every file and SQLite cell. Two places keep a signature on purpose, and only its `armored`
 *  text is omitted there: a verified access entry's signed.armored, and the gateway's replay rows.
 *  Checking cells too catches a copy of that entire body in another table or stream. */
const stored = (dir: string, accessBodies: ReadonlyMap<string, string>, proofs: ReadonlyArray<string>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const files = readdirSync(dir, { recursive: true, encoding: "utf8" })
        .map((name) => join(dir, name))
        .filter((file) => statSync(file).isFile() && file !== join(dir, "person") && file !== join(dir, "person.pub"));
      const raw: Array<readonly [string, string]> = files.map((file) => [
        `home ${file.slice(dir.length)}`,
        readFileSync(file).toString("latin1"),
      ]);
      const outputs: Array<readonly [string, string]> = [];
      const retained = new Map<string, Map<string, string>>();

      for (let n = 0; n < files.length; n++) {
        const file = files[n]!;
        const [label, bytes] = raw[n]!;

        if (!bytes.startsWith("SQLite format 3\0")) {
          continue;
        }

        const db = yield* Effect.acquireRelease(
          Effect.sync(() => new DatabaseSync(file, { readOnly: true })),
          (db) => Effect.sync(() => db.close()),
        );
        const allowed = new Map<string, string>();
        retained.set(file, allowed);
        const tables = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String })))(
          db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all(),
        );

        for (const { name } of tables) {
          const table = `"${name.replaceAll('"', '""')}"`;
          const keys = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String, pk: Schema.Int })))(
            db.prepare(`PRAGMA table_info(${table})`).all(),
          )
            .filter((column) => column.pk > 0)
            .map((column) => column.name);
          const select = db.prepare(`SELECT * FROM ${table}`);
          // The runtime's own tables hold 64-bit integers, such as an alarm's time in nanoseconds.
          select.setReadBigInts(true);

          for (const [at, read] of select.all().entries()) {
            // An integer a JavaScript number holds exactly is read as one, as before; a larger one stays whole.
            const row = Object.fromEntries(
              Object.entries(read).map(([column, value]) => [
                column,
                typeof value === "bigint" && value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER
                  ? Number(value)
                  : value,
              ]),
            );
            const key = keys.length === 0 ? `row ${at}` : `key ${keys.map((column) => String(row[column])).join(" ")}`;
            let cells = row;

            if (
              name === "entries" &&
              row.stream === "gateway/access" &&
              ["granted", "revoked"].includes(String(row._tag))
            ) {
              const entry = Schema.decodeUnknownSync(LedgerRow)(row);
              const body = JSON.stringify(entry.body);
              const replacement = Schema.decodeUnknownSync(Schema.String)(accessBodies.get(body));
              allowed.set(body, replacement);
              cells = { ...row, body: replacement };
            }

            // The gateway's replay rows keep a whole signed change on purpose, since P10, to answer a
            // repeated change id: `changePending/<id>` and `change/<id>` in `gateway_state`. The parent
            // plan lets a grant's signature stay "only in the ledger locations that deliberately preserve
            // that public evidence", and this is one. A signature is public evidence, not a secret, and
            // the access entry above holds the same one. Only `armored` is left out, and only when it is
            // a proof this run really sent: anything else there is checked like any cell. The row's other
            // fields are checked too, and the raw file below is still checked whole for a private key
            // and for every credential.
            if (name === "gateway_state" && /^(?:changePending|change)\//.test(String(row.name))) {
              const value = Schema.decodeUnknownSync(Schema.String)(row.value);
              const { armored, ...rest } = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
                JSON.parse(value),
              );

              if (typeof armored === "string" && proofs.includes(armored)) {
                const replacement = JSON.stringify(rest);
                allowed.set(value, replacement);
                cells = { ...row, value: replacement };
              }
            }

            for (const [column, value] of Object.entries(cells)) {
              outputs.push([
                `${label} table ${name} ${key} column ${column}`,
                value instanceof Uint8Array ? Buffer.from(value).toString("latin1") : String(value),
              ]);
            }
          }
        }
      }

      for (let n = 0; n < files.length; n++) {
        const file = files[n]!;
        const [label, bytes] = raw[n]!;
        // SQLite's journal repeats the same cells. No other file gets this exception. The raw bytes are
        // still scanned: only the exact text of an omitted cell is swapped for its checked form, so a
        // signature anywhere else in the file, under another key or in another table, is still found.
        const database = file.replace(/-(?:wal|shm|journal)$/, "");
        let checked = bytes;

        for (const [body, replacement] of retained.get(database) ?? []) {
          checked = checked.replaceAll(body, replacement);
        }

        outputs.push([label, checked]);
      }

      return { outputs, raw };
    }),
  );

/** Every named output of a tab: its page text and markup, its rows, console lines, errors, URLs and sockets. */
const look = (page: import("playwright").Page, seen: Seen) =>
  Effect.gen(function* () {
    const html = yield* Effect.promise(() => page.content());
    const values = yield* Effect.promise(() =>
      page
        .locator("input")
        .evaluateAll((inputs) => inputs.map((input) => (input instanceof HTMLInputElement ? input.value : ""))),
    );
    const stored = yield* rows(page);
    return [
      ["page", html + JSON.stringify(values)],
      ["rows", JSON.stringify(stored)],
      ["console", seen.console.join("\n")],
      ["errors", seen.errors.join("\n")],
      ["urls", seen.urls.join("\n")],
      ["sockets", seen.sockets.join("\n")],
    ] as const;
  });
