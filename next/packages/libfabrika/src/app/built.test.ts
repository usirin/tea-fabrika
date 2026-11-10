// P16, next/. The tables one built brain file carries: each program's compiled source with its
// hash, each window file with its route. Outside values decode through Effect with typed failures,
// malformed JSON included. Builder contract: `app/built.ts` exports `Built`, `BuiltProgram`,
// `Asset` and `decodeBuilt(raw)`, and a bad value fails as `BuildError`.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, it, vi } from "vitest";

type Program = { readonly hash: string; readonly source: string };
type Asset = { readonly hash: string; readonly type: string; readonly body: string };

type Built = {
  readonly programs: Readonly<Record<string, Program>>;
  readonly assets: Readonly<Record<string, Asset>>;
};

type Api = {
  readonly Built: Schema.Codec<Built>;
  readonly Asset: Schema.Codec<Asset>;
  readonly BuiltProgram: Schema.Codec<Program>;
  readonly decodeBuilt: (raw: unknown) => Effect.Effect<Built, { _tag: string; reason: string }>;
};

const load = async () => {
  const file = join(import.meta.dirname, "built.ts");
  assert(existsSync(file), "P16 not built: shared Built schemas and table validation absent");
  vi.resetModules();
  return vi.importActual<Api>(pathToFileURL(file).href);
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const types = ["text/javascript; charset=utf-8", "text/css; charset=utf-8"] as const;

const rows = fc.uniqueArray(
  fc.record({
    name: fc.integer({ min: 0, max: 100 }).map((n) => `program${n}`),
    source: fc.string({ minLength: 1, maxLength: 40, unit: "grapheme" }),
  }),
  { minLength: 2, maxLength: 4, selector: (r) => r.name },
);

const routes = fc.uniqueArray(
  fc.record({
    route: fc
      .array(fc.stringMatching(/^[\w-][\w.-]{0,8}$/), { minLength: 1, maxLength: 3 })
      .filter((parts) => parts.every((p) => p !== "." && p !== ".."))
      .map((parts) => `/${parts.join("/")}`),
    type: fc.constantFrom(...types),
    body: fc.string({ maxLength: 40, unit: "grapheme" }),
  }),
  { minLength: 1, maxLength: 4, selector: (a) => a.route },
);

const runs = { seed: 119120, numRuns: 20 };

const failed = async (api: Api, raw: unknown) => {
  // A throwing decode rejects here instead of returning a typed Failure.
  const result = await Effect.runPromise(Effect.result(api.decodeBuilt(raw)));
  expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "BuildError" } });
};

describe("P16 checked built tables", () => {
  it("table: generated programs and assets round-trip with checked hashes and schemas", async () => {
    const api = await load();
    await fc.assert(
      fc.asyncProperty(rows, routes, async (rows, assets) => {
        const raw: Built = {
          programs: Object.fromEntries(rows.map(({ name, source }) => [name, { hash: sha(source), source }])),
          assets: Object.fromEntries(assets.map(({ route, type, body }) => [route, { hash: sha(body), type, body }])),
        };
        expect(await Effect.runPromise(api.decodeBuilt(raw))).toEqual(raw);
        expect(await Effect.runPromise(Schema.decodeUnknownEffect(api.Built)(raw))).toEqual(raw);

        for (const program of Object.values(raw.programs)) {
          expect(await Effect.runPromise(Schema.decodeUnknownEffect(api.BuiltProgram)(program))).toEqual(program);
        }

        for (const asset of Object.values(raw.assets)) {
          expect(await Effect.runPromise(Schema.decodeUnknownEffect(api.Asset)(asset))).toEqual(asset);
        }
      }),
      runs,
    );
  });
  it("table plants: one program's hash on another's source, bad routes, MIME types and malformed metadata are typed failures", async () => {
    const api = await load();
    await fc.assert(
      fc.asyncProperty(
        rows,
        routes,
        fc.jsonValue(),
        fc.constantFrom("../escape", "/./x.js", "/a/../b.js", "no-slash.js", "", "/a//b.js"),
        fc.constantFrom("text/html", "application/json", "text/javascript"),
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)),
        async (rows, assets, junk, route, type, other) => {
          const [a, b] = rows as [(typeof rows)[0], (typeof rows)[0]];
          const asset = assets[0]!;
          const good = {
            programs: { [a.name]: { hash: sha(a.source), source: a.source } },
            assets: { [asset.route]: { hash: sha(asset.body), type: asset.type, body: asset.body } },
          };
          await expect(Effect.runPromise(api.decodeBuilt(good))).resolves.toEqual(good);

          for (const raw of [
            null,
            junk,
            "{malformed JSON",
            { programs: junk, assets: null },
            { ...good, programs: { [a.name]: { hash: sha(b.source), source: a.source } } },
            { ...good, programs: { "": { hash: sha(a.source), source: a.source } } },
            {
              ...good,
              assets: {
                [asset.route]: { hash: sha(asset.body), type: asset.type, body: `${asset.body}x` },
              },
            },
            {
              ...good,
              assets: { [route]: { hash: sha(asset.body), type: asset.type, body: asset.body } },
            },
            { ...good, assets: { [asset.route]: { hash: sha(asset.body), type, body: asset.body } } },
            // A missing or non-text source or body fails even when the hash is its text's.
            { ...good, programs: { [a.name]: { hash: sha("") } } },
            { ...good, programs: { [a.name]: { hash: sha(String(other)), source: other } } },
            { ...good, assets: { [asset.route]: { hash: sha(""), type: asset.type } } },
            {
              ...good,
              assets: { [asset.route]: { hash: sha(String(other)), type: asset.type, body: other } },
            },
          ]) {
            if (raw === junk && typeof junk === "object" && junk !== null) {
              continue;
            }

            await failed(api, raw);
          }
        },
      ),
      runs,
    );
  });
});

// P14 (A10): the tab's page rides in the same table, as the asset at `/index.html` typed
// `text/html; charset=utf-8`, beside P16's scripts and stylesheets. Every P16 law above stays: a
// bare `text/html` and any other type are still refused.
describe("P14 the page in the built tables", () => {
  const page = "text/html; charset=utf-8";
  it("a page asset round-trips with its checked hash beside generated scripts and stylesheets", async () => {
    const api = await load();
    await fc.assert(
      fc.asyncProperty(rows, routes, fc.string({ maxLength: 80, unit: "grapheme" }), async (rows, assets, html) => {
        const raw: Built = {
          programs: Object.fromEntries(rows.map(({ name, source }) => [name, { hash: sha(source), source }])),
          assets: {
            ...Object.fromEntries(assets.map(({ route, type, body }) => [route, { hash: sha(body), type, body }])),
            "/index.html": { hash: sha(html), type: page, body: html },
          },
        };
        expect(await Effect.runPromise(api.decodeBuilt(raw))).toEqual(raw);
        const asset = raw.assets["/index.html"]!;
        expect(await Effect.runPromise(Schema.decodeUnknownEffect(api.Asset)(asset))).toEqual(asset);
        // Plant: the page's hash on another body is still refused.
        await failed(api, { ...raw, assets: { ...raw.assets, "/index.html": { ...asset, body: `${html}x` } } });
      }),
      runs,
    );
  });
});
