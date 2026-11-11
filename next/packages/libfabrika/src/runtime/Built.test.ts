// P16, next/. The tables one built brain file carries: each program's compiled source with its
// hash, each window file with its route. Outside values decode through Effect with typed failures,
// malformed JSON included. Builder contract: `app/built.ts` exports `Built`, `BuiltProgram`,
// `Asset` and `decodeBuilt(raw)`, and a bad value fails as `BuildError`. P40: a program's key is
// its qualified identity, `pack/program`, and a table with any other key fails whole: no entry is
// dropped to make it pass.
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
  const file = join(import.meta.dirname, "Built.ts");
  assert(existsSync(file), "P16 not built: shared Built schemas and table validation absent");
  vi.resetModules();
  return vi.importActual<Api>(pathToFileURL(file).href);
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const types = ["text/javascript; charset=utf-8", "text/css; charset=utf-8"] as const;

const rows = fc.uniqueArray(
  fc.record({
    name: fc
      .tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 100 }))
      .map(([pack, n]) => `pack${pack}/program${n}`),
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
  it("L2: a table with one key that is not a qualified name fails whole, and a good table keeps every key", async () => {
    const api = await load();
    // Each break keeps the current key inside it, so a check on one end or one segment passes it.
    const breaks: ReadonlyArray<(key: string) => string> = [
      (key) => key.split("/")[1]!,
      (key) => key.split("/")[0]!,
      (key) => `/${key}`,
      (key) => `${key}/`,
      (key) => key.replace("/", "//"),
      (key) => `${key}/extra`,
      (key) => `../${key}`,
      (key) => key.replace("/", "/./"),
      (key) => key.replace("/", "."),
      (key) => key.replace("/", ":"),
      (key) => `${key} `,
      (key) => `${key}${"x".repeat(257 - key.length)}`,
    ];
    // The walk: start from a completed table, then each step either adds a program under a fresh
    // qualified key, which must decode with every key kept, or mutates one current key, which must
    // fail. A mutation never enters the state, so every later step starts from a good table.
    const tape = fc.array(fc.nat(), { minLength: 2, maxLength: 12 });
    await fc.assert(
      fc.asyncProperty(rows, tape, async (rows, tape) => {
        let programs: Record<string, Program> = Object.fromEntries(
          rows.map(({ name, source }) => [name, { hash: sha(source), source }]),
        );
        let added = 0,
          refused = 0;

        for (const [i, n] of tape.entries()) {
          const keys = Object.keys(programs);

          if (i % 2 === 0) {
            const key = `pack${n % 5}/added${i}`;
            programs = { ...programs, [key]: { hash: sha(key), source: key } };
            const decoded = await Effect.runPromise(api.decodeBuilt({ programs, assets: {} }));
            expect(Object.keys(decoded.programs).sort()).toEqual(Object.keys(programs).sort());
            expect(decoded.programs).toEqual(programs);
            added++;
          } else {
            const key = keys[n % keys.length]!;
            const bad = breaks[Math.floor(n / keys.length) % breaks.length]!(key);
            const { [key]: entry, ...rest } = programs;
            await failed(api, { programs: { ...rest, [bad]: entry }, assets: {} });
            refused++;
          }
        }

        expect(added).toBeGreaterThan(0);
        expect(refused).toBeGreaterThan(0);
      }),
      { ...runs, numRuns: 100 },
    );
  });
});
