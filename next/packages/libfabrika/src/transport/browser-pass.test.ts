// P23, next/. The fixed pair is RFC 7636 Appendix B, not an invented example.
import {createHash} from "node:crypto";
import {describe, expect, expectTypeOf, it} from "@effect/vitest";
import {Effect, Redacted, Schema} from "effect";
import {Digest} from "effect/crypto";
import {Bytes32, checks, leaks, secretForms} from "../desktop/browser-link.test-support.ts";

const module = "./browser-pass.ts";
const load = () =>
	Effect.promise((): Promise<typeof import("./browser-pass.ts")> => import(module));
const text = (bytes: ReadonlyArray<number>) => Buffer.from(bytes).toString("base64url");

describe("P23 shared pass codec", () => {
	it.effect("vector: RFC 7636 Appendix B fixes the SHA-256 base64url format", () =>
		Effect.gen(function* () {
			const {PassSecret, passDigest} = yield* load();
			const pass = yield* Schema.decodeUnknownEffect(PassSecret)(
				"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
			);
			expect(yield* passDigest(pass).pipe(Effect.provide(Digest.layerWebCrypto))).toBe(
				"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
			);
		}),
	);
	it.effect.prop(
		"[secrets] generated passes are Redacted, unencodable and hashed from UTF-8 text",
		{bytes: Bytes32},
		({bytes}) =>
			Effect.gen(function* () {
				const {PassSecret, passDigest} = yield* load();
				const raw = text(bytes);
				const pass = yield* Schema.decodeUnknownEffect(PassSecret)(raw);
				expectTypeOf<typeof PassSecret.Type>().toEqualTypeOf<Redacted.Redacted<string>>();
				expect(Redacted.isRedacted(pass)).toBe(true);
				expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);
				expect(String(pass)).not.toContain(raw);
				expect(yield* Effect.result(Schema.encodeEffect(PassSecret)(pass))).toHaveProperty(
					"_tag",
					"Failure",
				);
				const expected = createHash("sha256").update(raw, "utf8").digest("base64url");
				const digest = yield* passDigest(pass).pipe(Effect.provide(Digest.layerWebCrypto));
				expect(digest).toBe(expected);
				expect(yield* passDigest(pass).pipe(Effect.provide(Digest.layerWebCrypto))).toBe(digest);
				// Plants: hashing decoded bytes, hex and padding are different formats.
				expect(createHash("sha256").update(Buffer.from(bytes)).digest("hex")).not.toBe(digest);
				expect(`${digest}=`).not.toBe(expected);
			}),
		checks,
	);
	it.effect.prop(
		"malformed input fails without retaining it in a cause",
		{bytes: Bytes32, extra: Schema.NonEmptyString},
		({bytes, extra}) =>
			Effect.gen(function* () {
				const {PassSecret, BrowserLinkError} = yield* load();
				const raw = text(bytes);
				for (const bad of [
					raw.slice(1),
					`${raw}=`,
					`${raw}!${extra}`,
					` ${raw}`,
					raw.replace(/./, "+"),
				]) {
					const result = yield* Effect.result(
						Schema.decodeUnknownEffect(PassSecret)(bad).pipe(
							Effect.mapError(() => new BrowserLinkError({why: "bad_pass"})),
						),
					);
					expect(result).toMatchObject({_tag: "Failure", failure: {why: "bad_pass"}});
					expect(leaks(raw, result)).toBe(false);
				}
			}),
		checks,
	);
	it.prop(
		"[secrets] plants catch each encoded output leak without allowing a diagnostic exception",
		{bytes: Bytes32},
		({bytes}) => {
			const raw = text(bytes);
			for (const destination of [
				"url",
				"redirect",
				"record",
				"span",
				"log",
				"error",
				"cmd",
				"frame",
				"model",
				"attachment",
				"capture",
			])
				for (const form of secretForms(raw)) {
					expect(() => expect(leaks(raw, {[destination]: form})).toBe(false)).toThrow();
				}
			expect(leaks(raw, {why: "open", secret: Redacted.make(raw)})).toBe(false);
		},
		checks,
	);
});
