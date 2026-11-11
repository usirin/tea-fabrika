// P16, next/. P14 is absent. Executable browser fixtures prove packaging, not its future UI.
// Builder contract: libfabrika's `build.ts` exports `build(options)` (see its own laws), and the
// brain serves every embedded window file from the one copied brain.mjs.
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { NodeServices } from "@effect/platform-node";
import { Effect, Scope, Exit } from "effect";
import { SecureRandom } from "effect/crypto";
import * as fc from "fast-check";
import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import type { Built } from "../src/build.ts";
import { heldPort } from "../src/port.test-support.ts";

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

            for (const name of ["@kampus", "@demlik", "effect", "@alchemy.run"]) {
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
                  programs: [{ name: "p16/browser", package: "@p16/browser", export: "program" }],
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
            // Held in the stage's own scope, opened before the stage, so it is given back after the
            // stage closes (finalizers run in reverse).
            const { port } = await Effect.runPromise(
              Effect.acquireRelease(heldPort(), (held) => held.release).pipe(Effect.provideService(Scope.Scope, scope)),
            );
            const raw = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x!;
            const { localStage } = await import("../src/local-stage.ts");
            const { localState } = await import("alchemy/State/LocalState");
            const stage = await Effect.runPromise(
              localStage(
                { ...built, brain: join(alone, "brain.mjs") },
                {
                  home,
                  name: "p16-browser",
                  person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
                  founder: `ssh-ed25519 ${Buffer.concat([field("ssh-ed25519"), field(Buffer.from(raw, "base64url"))]).toString("base64")}`,
                  window: null,
                  port,
                },
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
            expect(entry[0]).toContain("p16/browser");
            const scripts = Object.entries(built.assets).filter(([, a]) => a.type.startsWith("text/javascript"));
            expect(scripts.length).toBeGreaterThan(1);
            const page = await browser.newPage();
            await page.goto(stage.url);

            for (const [route, asset] of Object.entries(built.assets)) {
              const response = await page.request.get(stage.url + route);
              expect(response.status()).toBe(200);
              expect(response.headers()["content-type"]).toBe(asset.type);
              expect(await response.text()).toBe(asset.body);
              expect(createHash("sha256").update(asset.body).digest("hex")).toBe(asset.hash);

              if (asset.type.startsWith("text/css")) {
                await page.addStyleTag({ url: stage.url + route });
              }
            }

            await page.addScriptTag({ url: stage.url + entry[0], type: "module" });
            await page.waitForSelector("#p16");
            expect(await page.locator("#p16").textContent()).toBe(text);
            expect(await page.locator("#p16").evaluate((e) => getComputedStyle(e).color)).toBe("rgb(12, 34, 56)");
            expect((await page.request.get(`${stage.url}/missing.js`)).status()).toBe(404);
            const planted = await browser.newPage();
            await planted.route("**/*.js", (route) =>
              new URL(route.request().url()).pathname === entry[0] ? route.continue() : route.abort(),
            );
            await planted.goto(stage.url);
            await planted.addScriptTag({ url: stage.url + entry[0], type: "module" });
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
