// P16, next/. Executable browser fixtures prove packaging; P14 slice 1 adds the typed counter tab below.
// Builder contract: libfabrika's `build.ts` exports `build(options)` (see its own laws), and the
// brain serves every embedded window file from the one copied brain.mjs.
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { Effect, Exit, Result, Schema, Scope } from "effect";
import { SecureRandom } from "effect/crypto";
import * as fc from "fast-check";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import type { Built } from "../src/build.ts";
import { heldPort } from "../src/port.test-support.ts";
import * as RecordWireTest from "../src/record-wire.test-support.ts";

const APP = resolve(import.meta.dirname, ".."),
  ROOT = resolve(APP, "../../..");

type Asset = { readonly type: string; readonly body: string; readonly hash: string };

type Build = {
  readonly build: (options: {
    readonly root: string;
    readonly entry: string;
    readonly out: string;
    readonly programs: readonly {
      readonly name: string;
      readonly package: string;
      readonly export: string;
    }[];
    readonly chaos: boolean;
    readonly files: readonly string[];
    readonly ledger: readonly unknown[];
  }) => Effect.Effect<Built & { readonly assets: Readonly<Record<string, Asset>> }, unknown>;
};

const field = (v: string | Buffer) => {
  const b = Buffer.from(v),
    n = Buffer.alloc(4);
  n.writeUInt32BE(b.length);
  return Buffer.concat([n, b]);
};

describe("P16 real browser from a copied one-file build", () => {
  it("assets: generated secondary imports execute and CSS loads; blocking the secondary route kills the same check", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc
          .array(fc.constantFrom("雪", "🫖", "</script>", "\\", "'", '"', "\r\n"), {
            minLength: 1,
            maxLength: 6,
          })
          .map((v) => v.join("")),
        async (text) => {
          const home = mkdtempSync("/tmp/fh."),
            oldHome = process.env.FABRIKA_HOME;
          process.env.FABRIKA_HOME = home;
          delete process.env.TYPESAFE_API_KEY;
          const scope = Effect.runSync(Scope.make());
          let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

          try {
            // Try the real browser even when P16's library build has not been written yet.
            browser = await chromium.launch({ headless: true });
            mkdirSync(join(home, "node_modules/@p16"), { recursive: true });

            for (const name of ["@kampus", "@demlik", "effect", "@alchemy.run", "alchemy"]) {
              symlinkSync(join(APP, "node_modules", name), join(home, "node_modules", name));
            }

            writeFileSync(join(home, "package.json"), '{"type":"module"}');
            const pkg = join(home, "programs/browser");
            mkdirSync(pkg, { recursive: true });
            symlinkSync(pkg, join(home, "node_modules/@p16/browser"), "dir");
            writeFileSync(
              join(pkg, "package.json"),
              JSON.stringify({
                type: "module",
                exports: { ".": "./program.ts", "./window": "./window.tsx" },
              }),
            );
            writeFileSync(join(pkg, "program.ts"), 'export {counter as program} from "@kampus/counter";');
            writeFileSync(
              join(pkg, "window.tsx"),
              'import "./window.css"; globalThis.__p16Ready = import("./secondary.ts").then(({text})=>{const out=document.createElement("output");out.id="p16";out.textContent=text;document.body.append(out);return text;});',
            );
            writeFileSync(join(pkg, "secondary.ts"), `export const text=${JSON.stringify(text)};`);
            writeFileSync(join(pkg, "window.css"), "#p16 {color: rgb(12, 34, 56);}");
            cpSync(join(APP, "src"), join(home, "src"), {
              recursive: true,
              filter: (p) => !p.endsWith(".test.ts"),
            });
            const file = join(ROOT, "next/packages/libfabrika/src/node/build/build.ts");
            assert(existsSync(file), "P16 not built: reusable library build absent");
            const api = (await import(pathToFileURL(file).href)) as Build;
            const built = await Effect.runPromise(
              api
                .build({
                  root: home,
                  entry: join(home, "src/brain.ts"),
                  out: join(home, "dist"),
                  // The app's brain starts `counter:1` on the core pack's `fabrika/counter` (runtime.ts), so
                  // the build must hold that name, which is also the re-exported program's own.
                  programs: [{ name: "fabrika/counter", package: "@p16/browser", export: "program" }],
                  chaos: false,
                  files: [],
                  ledger: [],
                })
                .pipe(Effect.provide(NodeServices.layer)),
            );
            const alone = join(home, "alone");
            mkdirSync(alone);
            cpSync(built.brain, join(alone, "brain.mjs"));
            rmSync(join(home, "dist"), { recursive: true });
            rmSync(pkg, { recursive: true });
            // Held in the instance's own scope, opened before the instance, so it is given back after the
            // instance closes (finalizers run in reverse).
            const { port } = await Effect.runPromise(
              Effect.acquireRelease(heldPort(), (held) => held.release).pipe(Effect.provideService(Scope.Scope, scope)),
            );
            const raw = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x!;
            const { localInstance } = await import("../src/local-instance.ts");
            const { localState } = await import("alchemy/State/LocalState");
            const instance = await Effect.runPromise(
              localInstance(
                { ...built, brain: join(alone, "brain.mjs") },
                RecordWireTest.startupFixture({
                  home,
                  name: "p16-browser",
                  person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
                  founder: `ssh-ed25519 ${Buffer.concat([field("ssh-ed25519"), field(Buffer.from(raw, "base64url"))]).toString("base64")}`,
                  window: null,
                  port,
                }),
              ).pipe(
                Effect.provideService(Scope.Scope, scope),
                Effect.provide(localState()),
                Effect.provide(SecureRandom.layerWebCrypto),
                Effect.provide(NodeServices.layer),
              ),
            );
            const entry = Object.entries(built.assets).find(
              ([, a]) => a.type.startsWith("text/javascript") && a.body.includes("__p16Ready"),
            );
            assert(entry, "entry script missing");
            // P40: the window's entry route keeps its qualified program name.
            expect(entry[0]).toContain("fabrika/counter");
            const scripts = Object.entries(built.assets).filter(([, a]) => a.type.startsWith("text/javascript"));
            expect(scripts.length).toBeGreaterThan(1);
            const page = await browser.newPage();
            await page.goto(instance.url);

            for (const [route, asset] of Object.entries(built.assets)) {
              const response = await page.request.get(instance.url + route);
              expect(response.status()).toBe(200);
              expect(response.headers()["content-type"]).toBe(asset.type);
              expect(await response.text()).toBe(asset.body);
              expect(createHash("sha256").update(asset.body).digest("hex")).toBe(asset.hash);

              if (asset.type.startsWith("text/css")) {
                await page.addStyleTag({ url: instance.url + route });
              }
            }

            await page.addScriptTag({ url: instance.url + entry[0], type: "module" });
            await page.waitForSelector("#p16");
            expect(await page.locator("#p16").textContent()).toBe(text);
            expect(await page.locator("#p16").evaluate((e) => getComputedStyle(e).color)).toBe("rgb(12, 34, 56)");
            expect((await page.request.get(`${instance.url}/missing.js`)).status()).toBe(404);
            const planted = await browser.newPage();
            await planted.route("**/*.js", (route) =>
              new URL(route.request().url()).pathname === entry[0] ? route.continue() : route.abort(),
            );
            await planted.goto(instance.url);
            await planted.addScriptTag({ url: instance.url + entry[0], type: "module" });
            await expect(planted.evaluate("globalThis.__p16Ready")).rejects.toThrow();
            expect(await planted.locator("#p16").count()).toBe(0);
          } finally {
            await browser?.close();
            await Effect.runPromise(Scope.close(scope, Exit.void));
            rmSync(home, { recursive: true, force: true });

            if (oldHome === undefined) {
              delete process.env.FABRIKA_HOME;
            } else {
              process.env.FABRIKA_HOME = oldHome;
            }
          }
        },
      ),
      { seed: 119120, numRuns: 2 },
    );
  });
});

// P14 slice 1 (ticket 698): S1.5 and the scoped browser fixture S1.6 supervises. The real counter
// window, built into a tab by libfabrika's public build, served from the real local brain at `/`, in
// headless Chromium. Every resource is acquired in one Effect scope (0061): the temp home, the
// server, the browser, its context and its page, each released by the scope in reverse order.
//
// `resources.laws.test.ts` runs this file as a child process. It sets `P14_E2E_TRACE` to a file this
// fixture appends each acquisition (with its pid or port) and release to, and `P14_E2E_FAULT` to
// `{at, kind}`: right after acquiring `at`, fail setup (`setup`), fail the test (`test`), or wait to
// be interrupted (`hold`). Without them the fixture runs plainly.
declare global {
  // What the tab entry below puts on the page: the Msgs its view pressed, and a render for a view.
  var __p14: { readonly pressed: Array<unknown>; readonly render: (data: unknown) => void } | undefined;
}

const RESOURCES = ["home", "server", "browser", "context", "page"] as const;
type Resource = (typeof RESOURCES)[number];

const Fault = Schema.Struct({
  at: Schema.Literals(RESOURCES),
  kind: Schema.Literals(["setup", "test", "hold"]),
});

const fault =
  process.env.P14_E2E_FAULT === undefined
    ? undefined
    : Schema.decodeUnknownSync(Schema.fromJsonString(Fault))(process.env.P14_E2E_FAULT);

const trace = process.env.P14_E2E_TRACE;

class SetupFault extends Schema.TaggedError<SetupFault>()("SetupFault", { at: Schema.String }) {}

class Stopped extends Schema.TaggedError<Stopped>()("Stopped", { reason: Schema.String }) {}

const STOPS = ["SIGTERM", "SIGINT", "disconnect"] as const;

/** Fails once this worker is told to stop: a signal, or its vitest parent gone. vitest's main process
 *  exits at once on SIGTERM or SIGINT and its worker dies with it, so no scope would close. Raced
 *  against the fixture, this closes the scope first, as `NodeRuntime.runMain` does for a main. */
const stopped = Effect.callback<never, Stopped>((resume) => {
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

/** One owned resource: acquired, noted with its facts, released by the scope within 10 s, noted again. */
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

// The counter's own package provides React and React DOM for its window; the tab links the same copies.
const COUNTER = resolve(ROOT, "next/programs/counter/package.json");
const counterDependency = (name: string) => dirname(createRequire(COUNTER).resolve(`${name}/package.json`));

const TAB_ENTRY = `import { counterWindow } from "@kampus/counter/window";
import { Schema } from "effect";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

const root = createRoot(document.getElementById("root")!);
const pressed: Array<unknown> = [];
const decode = Schema.decodeUnknownSync(counterWindow.data);
const View = counterWindow.View;
Object.assign(globalThis, {
  __p14: {
    pressed,
    render: (data: unknown) => {
      const checked = decode(data);
      flushSync(() => root.render(<View data={checked} press={(m) => pressed.push(m)} />));
    },
  },
});
`;

/** The whole fixture in the caller's scope: home, the tab build, server, browser, context and page. */
const servedCounter = Effect.gen(function* () {
  const home = yield* owned(
    "home",
    Effect.sync(() => mkdtempSync("/tmp/fh.")),
    (h) => Effect.sync(() => rmSync(h, { recursive: true, force: true })),
    (h) => ({ home: h }),
  );
  mkdirSync(join(home, "node_modules"), { recursive: true });

  for (const name of ["@kampus", "@demlik", "effect", "@alchemy.run", "alchemy"]) {
    symlinkSync(join(APP, "node_modules", name), join(home, "node_modules", name));
  }

  for (const name of ["react", "react-dom"]) {
    symlinkSync(counterDependency(name), join(home, "node_modules", name));
  }

  writeFileSync(join(home, "package.json"), '{"type":"module"}');
  const tab = join(home, "tab");
  mkdirSync(tab);
  writeFileSync(join(tab, "entry.tsx"), TAB_ENTRY);
  writeFileSync(join(tab, "tab.css"), "output { color: rgb(12, 34, 56); }\n");
  cpSync(join(APP, "src"), join(home, "src"), { recursive: true, filter: (p) => !p.endsWith(".test.ts") });
  const api = (yield* Effect.promise(
    () => import(pathToFileURL(join(ROOT, "next/packages/libfabrika/src/node/build/build.ts")).href),
  )) as {
    readonly build: (
      options: Parameters<Build["build"]>[0] & { readonly tab: { readonly entry: string; readonly styles: string[] } },
    ) => ReturnType<Build["build"]>;
  };
  const built = yield* api
    .build({
      root: home,
      entry: join(home, "src/brain.ts"),
      out: join(home, "dist"),
      programs: [{ name: "fabrika/counter", package: "@kampus/counter", export: "counter" }],
      chaos: false,
      files: [],
      ledger: [],
      tab: { entry: join(tab, "entry.tsx"), styles: [join(tab, "tab.css")] },
    })
    .pipe(Effect.provide(NodeServices.layer));
  // Held in this scope, opened before the instance, so it is given back after the instance closes
  // (finalizers run in reverse).
  const { port } = yield* Effect.acquireRelease(heldPort(), (held) => held.release);
  const raw = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x!;
  const { localInstance } = yield* Effect.promise(() => import("../src/local-instance.ts"));
  const { localState } = yield* Effect.promise(() => import("alchemy/State/LocalState"));
  const instance = yield* owned(
    "server",
    localInstance(
      built,
      RecordWireTest.startupFixture({
        home,
        name: "p14-browser",
        person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
        founder: `ssh-ed25519 ${Buffer.concat([field("ssh-ed25519"), field(Buffer.from(raw, "base64url"))]).toString("base64")}`,
        window: null,
        port,
      }),
    ).pipe(
      Effect.provide(localState()),
      Effect.provide(SecureRandom.layerWebCrypto),
      Effect.provide(NodeServices.layer),
    ),
    // localInstance registers its own release on this scope; the instance's port is what must close.
    () => Effect.void,
    (s) => ({ port: Number(new URL(s.url).port) }),
  );
  // Headless always: the fixture opens no visible window.
  const server = yield* owned(
    "browser",
    Effect.promise(() => chromium.launchServer({ headless: true })),
    (s) => Effect.promise(() => s.close()),
    (s) => ({ pid: s.process().pid }),
  );
  const browser = yield* Effect.acquireRelease(
    Effect.promise(() => chromium.connect(server.wsEndpoint())),
    (b) => Effect.promise(() => b.close()).pipe(Effect.timeout("10 seconds"), Effect.ignore),
  );
  const context = yield* owned(
    "context",
    Effect.promise(() => browser.newContext()),
    (c) => Effect.promise(() => c.close()),
  );
  const page = yield* owned(
    "page",
    Effect.promise(() => context.newPage()),
    (p) => Effect.promise(() => p.close()),
  );
  return { built, instance, page };
});

describe("P14 slice 1: the typed counter view in a real tab", () => {
  it("S1.5 generated presses: the rendered counter shows its program's data and emits only its program's messages", async () => {
    const { stepper } = await import("@kampus/libfabrika");
    const { counter } = await import("@kampus/counter");
    const program = Result.getOrThrow(stepper(counter));
    const inputs = Object.keys(counter.inputs);
    const pressedTypes = new Set<string>();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { built, instance, page } = yield* servedCounter;
          yield* Effect.promise(async () => {
            if (fault?.kind === "test") {
              expect.fail(`scenario: a test that fails after ${fault.at} was acquired`);
            }

            // The real root serves the carried page, and the page alone loads the carried script.
            const root = await page.goto(`${instance.url}/`);
            expect(root?.status()).toBe(200);
            expect(root?.headers()["content-type"]).toBe("text/html; charset=utf-8");
            expect(await root?.text(), "/ is the carried page").toBe(built.assets["/index.html"]?.body);
            const script = await page.request.get(`${instance.url}/window.js`);
            expect(await script.text(), "/window.js is the carried script").toBe(built.assets["/window.js"]?.body);
            await page.waitForFunction(() => "__p14" in globalThis);
            const count = page.getByRole("status");
            const button = (input: string) =>
              page.getByRole("button", {
                name: Object.entries(counter.inputs).find(([name]) => name === input)![1].description,
              });
            const pressed = () => page.evaluate(() => globalThis.__p14?.pressed ?? []);
            const render = (view: unknown) => page.evaluate((data) => globalThis.__p14?.render(data), view);

            // Each walk starts at the program's real init; each step reads the folded model, picks an
            // input the program accepts from it, presses its button, then installs the stepped view.
            await fc.assert(
              fc.asyncProperty(fc.array(fc.nat(), { minLength: 1, maxLength: 10 }), async (picks) => {
                let step = program.init(null);
                assert(step._tag === "stepped");
                await render(step.view);
                const start = (await pressed()).length;
                expect(await count.textContent()).toBe(String((step.view as { count: number }).count));
                expect(await count.evaluate((e) => getComputedStyle(e).color), "the page's styles apply").toBe(
                  "rgb(12, 34, 56)",
                );

                for (const [n, pick] of picks.entries()) {
                  const model = step.model;
                  const available = inputs.filter((type) => program.step(model, { type })._tag === "stepped");
                  const type = available[pick % available.length]!;
                  pressedTypes.add(type);
                  await button(type).click();
                  const sent = (await pressed()).slice(start);
                  expect(sent, "each press emits one Msg, the program's own").toEqual([...sent.slice(0, n), { type }]);
                  expect(sent.every((m) => Exit.isSuccess(Schema.decodeUnknownExit(counter.msg)(m)))).toBe(true);
                  // The view never steps the program: until the next view arrives, the count stays.
                  expect(await count.textContent(), "a press alone changes nothing shown").toBe(
                    String((step.view as { count: number }).count),
                  );
                  step = program.step(model, { type });
                  assert(step._tag === "stepped");
                  await render(step.view);
                  expect(await count.textContent(), "the shown count is the program's").toBe(
                    String((step.view as { count: number }).count),
                  );
                }
              }),
              // Each step is a real click and render round trip in Chromium: 20 walks of up to 10 steps.
              { seed: 119120, numRuns: 20 },
            );
          });
        }),
      ).pipe(Effect.raceFirst(stopped)),
    );
    expect([...pressedTypes].sort(), "the walks pressed every input").toEqual([...inputs].sort());
  });
});
