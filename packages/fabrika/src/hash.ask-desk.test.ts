import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {Effect} from "effect";
import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {hash} from "./hash.ts";
const {CANONICAL_INPUT, CANONICAL_TEXT} = JSON.parse(
	readFileSync(new URL("../../../fixtures/ask-desk/cases.json", import.meta.url), "utf8"),
);

// P3. Today's version. Chromium runs the same vector in e2e/ask-desk.ts.
const digest: (value: unknown) => Effect.Effect<string, unknown> = hash;
describe("ask desk P3: canonical display hash", () => {
	it("matches RFC 8785 bytes and an independent Node SHA-256", async () => {
		expect(await Effect.runPromise(digest(CANONICAL_INPUT))).toBe(
			`sha256:${createHash("sha256").update(CANONICAL_TEXT).digest("hex")}`,
		);
	});
	it("ignores object insertion order at every depth, but preserves array order and text", async () => {
		await fc.assert(
			fc.asyncProperty(fc.dictionary(fc.string(), fc.jsonValue()), async (object) => {
				const reversed = Object.fromEntries(Object.entries(object).reverse());
				expect(await Effect.runPromise(digest({outer: object, words: ["é", "e\u0301"]}))).toBe(
					await Effect.runPromise(digest({words: ["é", "e\u0301"], outer: reversed})),
				);
			}),
			{seed: 119120, numRuns: 100},
		);
		expect(await Effect.runPromise(digest(["a", "b"]))).not.toBe(
			await Effect.runPromise(digest(["b", "a"])),
		);
		expect(await Effect.runPromise(digest("é"))).not.toBe(
			await Effect.runPromise(digest("e\u0301")),
		);
	});
	it.each([Number.NaN, Infinity, undefined, {missing: undefined}])(
		"refuses non-JSON display data %j",
		async (value) => {
			expect(await Effect.runPromise(Effect.exit(digest(value)))).toMatchObject({_tag: "Failure"});
		},
	);
});
