// fabsh in a tile, slice 1, next/: laws L17 and L18 of the approved plan (docs/plan/lanes/
// fabsh-PLAN.md, "Laws"). One suite (`fabsh.test-support.ts`), run on a real local instance of its
// own: once in a Chromium tab and once with the library's headless client, through the same public
// start, as `client-protocol.test.ts` runs L9. The tab's draft echoes pass through a route that can
// hold them, so a letter is seen drawn before its echo. Written before `@kampus/fabsh` and the
// `fabsh:1` tile; until the build adds them, it fails on its missing import. It needs Alchemy, workerd
// and Chromium, so it runs in CI's end-to-end job. L18, the same suite on the real built Electron app,
// is host-only and owed to P19 slice 3's Electron client (0178).
import { ClientKeyError } from "@kampus/libfabrika/transport/ClientKey";
import { KeyLine } from "@kampus/libfabrika/transport/Sshsig";
import { Effect, Schema } from "effect";
import type { BrowserContext, Locator, Page } from "playwright";
import { describe, expect, it } from "vitest";
import { type Backend, FABSH, headlessBackend, type Lined, typeAndRun } from "./fabsh.test-support.ts";
import { browser, type Dev, devServer, home, profile, suite, tab, waiting } from "./p14.test-support.ts";

/** Each run's own limit in ms: a dev.ts start (up to 180 s), a grant and the typed line. */
const LIMIT = 300_000;

const Frame = Schema.Struct({ id: Schema.optionalKey(Schema.Unknown), method: Schema.optionalKey(Schema.String) });
const decodeFrame = Schema.decodeUnknownOption(Schema.fromJsonString(Frame));

/** The tab's socket through a route: every frame passes, and draft answers wait while `held`. */
const route = (context: BrowserContext) =>
  Effect.gen(function* () {
    // `delivered` counts draft answers handed to the tab since the last hold.
    const state = { held: false, drafts: new Set<unknown>(), waiting: [] as Array<() => void>, delivered: 0 };
    yield* Effect.promise(() =>
      context.routeWebSocket(/\/client\//, (ws) => {
        const server = ws.connectToServer();
        ws.onMessage((m) => {
          const f = decodeFrame(String(m));

          if (f._tag === "Some" && f.value.method === "process.draft") {
            state.drafts.add(f.value.id);
          }

          server.send(m);
        });
        server.onMessage((m) => {
          const f = decodeFrame(String(m));

          if (f._tag === "Some" && state.drafts.has(f.value.id) && state.held) {
            state.waiting.push(() => ws.send(m));
            return;
          }

          if (f._tag === "Some" && state.drafts.has(f.value.id)) {
            state.delivered++;
          }

          ws.send(m);
        });
      }),
    );
    return state;
  });

/** The text of every element the line's `aria-describedby` names. */
const describedBy = (page: Page) =>
  Effect.promise(() =>
    page
      .getByRole("region", { name: FABSH })
      .getByRole("textbox")
      .evaluate((el) =>
        (el.getAttribute("aria-describedby") ?? "")
          .split(/\s+/)
          .filter((id) => id !== "")
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim(),
      ),
  );

/**
 * Where the layer draws each character, against where the input draws it. The input's own text is
 * clear, so its place is measured with its own font on a canvas, from its text box's left edge less
 * its scroll; each layer character's place is its range box. A character with no box is not drawn.
 */
const measure = (field: Locator, line: string) =>
  Effect.promise(() =>
    field.evaluate((input: HTMLInputElement, line): Lined => {
      const layer = input.closest("form")?.querySelector("[aria-hidden='true']:has(> [data-role])") ?? null;

      if (layer === null) {
        return { drawn: "", off: [], seen: 0, scrolled: 0 };
      }

      const style = getComputedStyle(input);
      const ctx = document.createElement("canvas").getContext("2d");

      if (ctx === null) {
        return { drawn: "", off: [], seen: 0, scrolled: input.scrollLeft };
      }

      ctx.font = style.font;
      ctx.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
      const box = input.getBoundingClientRect();
      const from = box.left + Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft);
      const to = box.right - Number.parseFloat(style.borderRightWidth) - Number.parseFloat(style.paddingRight);
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      let drawn = "";
      let at = 0;
      let seen = 0;
      const off: Array<number> = [];

      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.textContent ?? "";

        for (let i = 0; i < text.length; i++, at++) {
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const rect = range.getClientRects()[0];

          if (rect === undefined || rect.width === 0) {
            continue;
          }

          drawn += text[i];
          const want = from - input.scrollLeft + ctx.measureText(line.slice(0, at)).width;

          if (want >= from && want + rect.width <= to) {
            seen++;

            if (Math.abs(rect.left - want) > 1) {
              off.push(at);
            }
          }
        }
      }

      return { drawn, off, seen, scrolled: input.scrollLeft };
    }, line),
  );

/** A Chromium tab of a fresh profile, open at the instance, its socket routed. */
const browserBackend = (context: BrowserContext, dev: Dev) =>
  Effect.gen(function* () {
    const held = yield* route(context);
    const { page } = yield* tab(context, dev.url);
    const region = page.getByRole("region", { name: FABSH });
    const field = region.getByRole("textbox");
    const run = <A>(f: () => Promise<A>) => Effect.promise(f);
    const backend: Backend = {
      name: "browser",
      waiting: waiting(page),
      online: run(() => region.and(page.locator(":not([inert])")).waitFor({ timeout: 60_000 })),
      hold: Effect.sync(() => {
        held.held = true;
        held.delivered = 0;
      }),
      release: Effect.sync(() => {
        held.held = false;

        for (const send of held.waiting.splice(0)) {
          send();
        }
      }),
      key: (letter) => run(() => field.press(letter)),
      retype: (line) => run(() => field.fill(line)),
      enter: run(() => field.press("Enter")),
      // The span layer by the contract L3 holds: the aria-hidden element whose children carry `data-role`.
      // A tile's frame has aria-hidden parts of its own (its dot), so "the first aria-hidden" is not it.
      drawn: run(() => region.locator("[aria-hidden='true']:has(> [data-role])").innerText()).pipe(
        Effect.map((t) => t.trim()),
      ),
      // The tab writes its frame after the key's update, and holds one frame in flight per tile, so
      // a newer letter may send none yet: read whether any echo reached the tab, not whether one
      // happens to be waiting. Wait first until one answer is held, so the hold is really in the way.
      unechoed: Effect.gen(function* () {
        for (let n = 0; n < 100 && held.waiting.length === 0; n++) {
          yield* Effect.sleep("100 millis");
        }

        return held.waiting.length > 0 && held.delivered === 0;
      }),
      description: describedBy(page),
      scroll: run(() => region.getByRole("log").innerText()).pipe(
        Effect.map((t) =>
          t
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l !== ""),
        ),
      ),
      // The key's update reaches the input on the tab's next render, after `press` resolves, so read
      // the recalled line once it is drawn (at most 10 s), and an empty line if history held nothing.
      recall: Effect.gen(function* () {
        yield* run(() => field.press("ArrowUp"));
        let value = "";

        for (let n = 0; n < 100 && value === ""; n++) {
          value = yield* run(() => field.inputValue());

          if (value === "") {
            yield* Effect.sleep("100 millis");
          }
        }

        return value;
      }),
      reload: run(() => page.reload()).pipe(Effect.asVoid),
      lined: (line) =>
        Effect.gen(function* () {
          // A person's key at the end of the line: the input scrolls its caret into view on a key,
          // and a `fill` alone moves no caret.
          yield* run(() => field.fill(line.slice(0, -1)));
          yield* run(() => field.press("End"));
          yield* run(() => field.press(line.slice(-1)));

          // The tile draws the line on its next render, after `fill` resolves (at most 10 s).
          for (let n = 0; n < 100 && (yield* run(() => field.inputValue())) !== line; n++) {
            yield* Effect.sleep("100 millis");
          }

          return yield* measure(field, line);
        }),
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

describe("fabsh L17: one suite, browser and headless, on a real local instance", () => {
  for (const [name, make] of Object.entries(backends)) {
    it(
      `scenario: L17 the ${name} client types hlep key by key, each letter drawn before its echo, sees the reason, fixes it, runs help, and keeps it over a reload`,
      { timeout: LIMIT },
      (context) =>
        suite(
          Effect.gen(function* () {
            const h = yield* home;
            const dev = yield* devServer(h);
            const backend = yield* make(dev);
            const run = yield* typeAndRun(h, dev, backend);
            expect(run.before, `${name}: each letter is drawn before its echo`).toEqual([true, true, true, true]);
            expect(run.reason, `${name}: the reason names the word`).toContain("hlep");
            expect(run.letters, `${name}: one letter, the whole line, the one thing that decides`).toEqual(["help"]);
            expect(run.typed, `${name}: the keys typed mid-line are never saved`).toBe(false);
            expect(run.recalled, `${name}: history survives a reload`).toBe("help");

            if (backend.lined !== undefined) {
              // pinned: the layer dropped every space between spans, as a flex row drops a text run
              // of spaces, and never scrolled with the input, so a line wider than the field lost
              // its letters past the edge (the review of b7df197).
              const long = `help ${"this-is-a-long-line ".repeat(12).trim()}`;

              for (const line of ["hlep x", long]) {
                const lined = yield* backend.lined(line);
                const said = JSON.stringify(line);
                expect(lined.drawn, `${name}: the layer draws ${said} exactly`).toBe(line);
                expect(lined.seen, `${name}: some of ${said} is inside the field`).toBeGreaterThan(0);
                expect(lined.off, `${name}: each drawn letter of ${said} sits where the input draws it`).toEqual([]);
                expect(lined.scrolled > 0, `${name}: ${said} scrolls the field`).toBe(line === long);
              }
            }
          }),
          context,
        ),
    );
  }
});

/** The host's own opt-in, as `electron-launchd.test.ts` reads it: a GUI-domain Mac, never CI. */
const host = process.platform === "darwin" && process.env.FABRIKA_P19_HOST === "1" && !process.env.CI;

describe("fabsh L18: the same suite on the real built Electron app (host-only)", () => {
  it.skipIf(!host)("scenario: L18 the Electron client runs L17's suite, owed to P19 slice 3's Electron client", () => {
    // A skipped run is not L18 evidence. P19 slice 3 brings the Electron backend; until it is on this
    // branch, a host run fails here and names what it waits for, rather than passing on nothing.
    expect.fail(
      "L18 is owed: P19 slice 3's Electron client is not on this branch (docs/plan/lanes/fabsh-PLAN.md, host-only laws)",
    );
  });
});
