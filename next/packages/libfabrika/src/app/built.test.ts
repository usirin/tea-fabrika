// P16, next/. Outside metadata must fail through typed Effect errors, including malformed JSON.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {Effect, Schema} from "effect";
import * as fc from "fast-check";
import {describe, expect, it, vi} from "vitest";

type Program = {readonly hash: string; readonly source: string};
type Asset = {readonly hash: string; readonly type: string; readonly body: string};
type Built = {
	readonly programs: Readonly<Record<string, Program>>;
	readonly assets: Readonly<Record<string, Asset>>;
};
type Api = {
	readonly Built: Schema.Codec<Built>;
	readonly Asset: Schema.Codec<Asset>;
	readonly BuiltProgram: Schema.Codec<Program>;
	readonly decodeBuilt: (raw: unknown) => Effect.Effect<Built, {_tag: string; why: string}>;
};
const load = async () => {
	const file = join(import.meta.dirname, "built.ts");
	assert(existsSync(file), "P16 not built: shared Built schemas and table validation absent");
	vi.resetModules();
	return vi.importActual<Api>(pathToFileURL(file).href);
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const rows = fc.uniqueArray(
	fc.record({
		name: fc.integer({min: 0, max: 100}).map((n) => `program${n}`),
		source: fc.string({minLength: 1, maxLength: 40}),
	}),
	{minLength: 2, maxLength: 4, selector: (r) => r.name},
);
const runs = {seed: 119120, numRuns: 20};

describe("P16 checked built tables", () => {
	it("table: generated programs and assets round-trip with checked hashes and schemas", async () => {
		await fc.assert(
			fc.asyncProperty(rows, async (rows) => {
				const api = await load();
				const raw: Built = {
					programs: Object.fromEntries(
						rows.map(({name, source}) => [name, {hash: sha(source), source}]),
					),
					assets: {
						"/window.js": {
							hash: sha(rows[0]!.source),
							body: rows[0]!.source,
							type: "text/javascript; charset=utf-8",
						},
					},
				};
				expect(await Effect.runPromise(api.decodeBuilt(raw))).toEqual(raw);
				expect(await Effect.runPromise(Schema.decodeUnknownEffect(api.Built)(raw))).toEqual(raw);
				for (const program of Object.values(raw.programs))
					expect(
						await Effect.runPromise(Schema.decodeUnknownEffect(api.BuiltProgram)(program)),
					).toEqual(program);
				expect(
					await Effect.runPromise(Schema.decodeUnknownEffect(api.Asset)(raw.assets["/window.js"])),
				).toEqual(raw.assets["/window.js"]);
			}),
			runs,
		);
	});
	it("table plants: mismatched source/hash, bad routes, MIME types and malformed metadata are typed failures", async () => {
		await fc.assert(
			fc.asyncProperty(rows, fc.jsonValue(), async (rows, junk) => {
				const api = await load(),
					source = rows[0]!.source;
				const good = {programs: {counter: {hash: sha(source), source}}, assets: {}};
				for (const raw of [
					null,
					junk === null ? [] : {programs: junk, assets: null},
					"{malformed JSON",
					{...good, programs: {counter: {hash: sha(`${source}changed`), source}}},
					{
						...good,
						assets: {
							"/window.js": {
								hash: sha(source),
								body: `${source}changed`,
								type: "text/javascript; charset=utf-8",
							},
						},
					},
					{...good, assets: {"../escape": {hash: sha(source), body: source, type: "text/html"}}},
				]) {
					const result = await Effect.runPromise(Effect.result(api.decodeBuilt(raw)));
					expect(result).toMatchObject({_tag: "Failure", failure: {_tag: "BuildError"}});
				}
			}),
			runs,
		);
	});
});
