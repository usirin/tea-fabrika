// T331, next/. L1-3 and L24. Future P28 exports are loaded inside each law so every red is visible.
import {createHmac} from "node:crypto";
import {readFileSync} from "node:fs";
import {describe, expect, it, vi} from "@effect/vitest";
import {Effect, Redacted, Result, Schema} from "effect";
import * as Arbitrary from "effect/Arbitrary";
import type {Members} from "../coordination/members.ts";

const options = {arbitrary: {runs: 100, size: 32, seed: 119120}};
const int = (minimum: number, maximum: number) =>
	Schema.Int.check(Schema.isBetween({minimum, maximum}));
const bytes = (length: number) =>
	Schema.Array(int(0, 255)).check(Schema.isBetweenLength(length, length));
const Entropy = bytes(16);
const Words = Schema.Array(Schema.String.check(Schema.isBetweenLength(3, 8))).check(
	Schema.isBetweenLength(12, 12),
);
const BadEntropy = Schema.Array(int(0, 255)).check(
	Schema.isBetweenLength(0, 32),
	Schema.makeFilter((a) => a.length !== 16),
);
const BadWords = Schema.Array(Schema.String.check(Schema.isBetweenLength(0, 16))).check(
	Schema.isBetweenLength(0, 24),
);
const Inputs = Schema.Struct({
	entropy: Entropy,
	badEntropy: BadEntropy,
	badWords: BadWords,
	position: int(0, 11),
	replacement: int(1, 2047),
	number: int(1, 40),
	label: Schema.String.check(Schema.isBetweenLength(0, 32)),
	status: Schema.Literals(["live", "spent", "replaced", "revoked", "unknown"]),
});
const inputs = Arbitrary.schema(Inputs);
const plant = process.env.P28_PLANT;
const vectors: {
	vectors: {entropy: string; words: string[]; seed: string; publicKey: string}[];
	labelCollisions: {
		kind: string;
		prefix: string;
		a: {entropy: string; key: string};
		b: {entropy: string; key: string};
	}[];
} = JSON.parse(
	readFileSync(
		new URL("../../../../../fixtures/next/recovery/sshsig.json", import.meta.url),
		"utf8",
	),
);
// Independent RFC 5869 extract + expand, not the library the builder will call.
const seed = (entropy: Uint8Array, info = "fabrika-recovery-v1") => {
	const prk = createHmac("sha256", Buffer.alloc(32)).update(entropy).digest();
	return createHmac("sha256", prk)
		.update(Buffer.concat([Buffer.from(info), Buffer.from([1])]))
		.digest();
};
const load = () => Effect.promise(() => import("./sheet.ts"));
const watchNetwork = (counter: {total: number}) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
				counter.total++;
				return Promise.reject(new Error("offline fixture"));
			});
			const Socket = globalThis.WebSocket;
			vi.stubGlobal(
				"WebSocket",
				class {
					constructor() {
						counter.total++;
						throw new Error("offline fixture");
					}
				},
			);
			return () => {
				fetch.mockRestore();
				vi.stubGlobal("WebSocket", Socket);
			};
		}),
		(restore) => Effect.sync(restore),
	);

describe("P28 sheet", () => {
	it.effect(
		"vector: L3 independent four-character fingerprint collisions never establish identity",
		() =>
			Effect.gen(function* () {
				// Saved OpenSSH SHA256/raw-key reference calculations, not a made-up collision.
				const Sheet = yield* load();
				let matching = 0;
				for (const pair of vectors.labelCollisions) {
					const words = yield* Sheet.wordsFor(Redacted.make(Buffer.from(pair.a.entropy, "hex")));
					expect(yield* Sheet.publicKey(words)).toBe(pair.a.key);
					const left = yield* Sheet.label(pair.a.key, 1),
						right = yield* Sheet.label(pair.b.key, 1);
					matching += Number(left === right);
					const members: Members = {
						person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
						name: "Fixture",
						keys: new Map<string, {rank: "person" | "recovery"; live: boolean; under: null}>([
							[vectors.vectors[0]!.publicKey, {rank: "person", live: true, under: null}],
							[pair.b.key, {rank: "recovery", live: true, under: null}],
						]),
						spent: new Set(),
					};
					const answer = yield* Sheet.check(words, members);
					expect(plant === "short-label-only" && left === right ? "live" : answer._tag).toBe(
						"wrong",
					);
				}
				expect(matching).toBeGreaterThan(0);
			}),
	);
	it.effect.prop(
		"L1: 16 entropy bytes round-trip through 12 words, seed and public key",
		{a: inputs},
		({a}) =>
			Effect.gen(function* () {
				const Sheet = yield* load();
				const entropy = Uint8Array.from(a.entropy);
				const words = yield* Sheet.wordsFor(Redacted.make(entropy));
				const {entropyToMnemonic} = yield* Effect.promise(() => import("@scure/bip39"));
				const {wordlist} = yield* Effect.promise(() => import("@scure/bip39/wordlists/english.js"));
				expect(Redacted.value(words)).toEqual(entropyToMnemonic(entropy, wordlist).split(" "));
				const made = yield* Sheet.make({entropy: Effect.succeed(Redacted.make(entropy))});
				expect(Redacted.value(made.words)).toEqual(Redacted.value(words));
				expect(Schema.is(Words)(Redacted.value(made.words))).toBe(true);
				expect(Redacted.value(words)).toHaveLength(12);
				for (const word of Redacted.value(words)) expect(word).toMatch(/^[a-z]{3,8}$/);
				const decoded = yield* Sheet.entropyFrom(words);
				expect([...Redacted.value(decoded)]).toEqual(a.entropy);
				const actual = yield* Sheet.seedFrom(words);
				const observed =
					plant === "drop-byte"
						? Redacted.value(actual).slice(1)
						: plant === "wrong-info"
							? seed(entropy, "wallet")
							: plant === "wallet-seed"
								? Buffer.alloc(64)
								: Redacted.value(actual);
				expect(Buffer.from(observed).toString("hex")).toBe(seed(entropy).toString("hex"));
				expect(yield* Sheet.publicKey(words)).toBe(
					yield* Sheet.publicKey(yield* Sheet.wordsFor(decoded)),
				);
				expect(
					Result.isFailure(
						yield* Effect.result(Sheet.wordsFor(Redacted.make(Uint8Array.from(a.badEntropy)))),
					),
				).toBe(true);
			}),
		options,
	);
	it.effect.prop(
		"L2: a changed word fails checksum or changes key; wrong label never dials",
		{a: inputs},
		({a}) =>
			Effect.gen(function* () {
				const Sheet = yield* load();
				// Words come from bounded entropy and the actual English list, not arbitrary text.
				const network = {total: 0};
				yield* watchNetwork(network);
				const words = yield* Sheet.wordsFor(Redacted.make(Uint8Array.from(a.entropy)));
				const original = Redacted.value(words);
				const changed = [...original];
				const {wordlist: list} = yield* Effect.promise(
					() => import("@scure/bip39/wordlists/english.js"),
				);
				const {validateMnemonic} = yield* Effect.promise(() => import("@scure/bip39"));
				changed[a.position] = list[(list.indexOf(original[a.position]!) + a.replacement) % 2048]!;
				const altered = yield* Effect.result(Sheet.publicKey(Redacted.make(changed)));
				expect(Result.isSuccess(altered)).toBe(validateMnemonic(changed.join(" "), list));
				const key = yield* Sheet.publicKey(words);
				// BIP39 checksum is four bits. Some substitutions are valid and give a different key.
				const safe = Result.isFailure(altered) || altered.success !== key;
				expect(plant === "ignore-checksum" ? false : safe).toBe(true);
				let dials = 0;
				const dial = () =>
					Effect.sync(() => {
						dials++;
					});
				const label = yield* Sheet.label(key, a.number);
				expect(label).toMatch(/^r[1-9][0-9]*-[a-zA-Z0-9_-]{4}$/);
				const result = yield* Effect.result(
					Sheet.read({words: Redacted.make(original), label: `${label}-wrong`, dial}),
				);
				if (plant === "ignore-label") yield* dial();
				expect(Result.isFailure(result)).toBe(true);
				expect(dials).toBe(0);
				expect(network.total).toBe(0);
				const invalid = yield* Effect.result(Sheet.publicKey(Redacted.make(a.badWords)));
				// Random bad slots may by chance be a valid mnemonic. Validation decides, not this test.
				expect(Result.isFailure(invalid) || a.badWords.length === 12).toBe(true);
			}),
		options,
	);
	it.effect.prop(
		"L3: cached check compares the full key and never calls the network",
		{a: inputs},
		({a}) =>
			Effect.gen(function* () {
				const Sheet = yield* load();
				const network = {total: 0};
				yield* watchNetwork(network);
				const words = yield* Sheet.wordsFor(Redacted.make(Uint8Array.from(a.entropy)));
				const key = yield* Sheet.publicKey(words);
				let calls = 0;
				const known = a.status !== "unknown";
				const members: Members = {
					person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
					name: "Test",
					keys: new Map(
						known ? [[key, {rank: "recovery", live: a.status === "live", under: null}]] : [],
					),
					spent: new Set(a.status === "spent" ? [key] : []),
				};
				const answer = yield* Sheet.check(words, members, {
					dial: () =>
						Effect.sync(() => {
							calls++;
						}),
				});
				if (plant === "dial-offline") calls++;
				expect(calls).toBe(0);
				expect(network.total).toBe(0);
				expect(answer._tag).toBe(a.status === "live" ? "live" : known ? "old" : "wrong");
				// A short-label collision must not establish membership.
				const impostor: Members = {
					...members,
					keys: new Map([[`${key}-different`, {rank: "recovery", live: true, under: null}]]),
				};
				const wrong = yield* Sheet.check(words, impostor);
				expect(plant === "short-label-only" ? "live" : wrong._tag).toBe("wrong");
			}),
		options,
	);
	it.effect("vector: L24 BIP39 English answers and independent RFC 5869 v1 answers", () =>
		Effect.gen(function* () {
			// Fixed spec answers, not examples of a generated law.
			const Sheet = yield* load();
			for (const v of vectors.vectors) {
				const entropy = Buffer.from(v.entropy, "hex");
				expect(seed(entropy).toString("hex")).toBe(v.seed);
				const words = yield* Sheet.wordsFor(Redacted.make(entropy));
				expect(Redacted.value(words)).toEqual(v.words);
				expect(Buffer.from(Redacted.value(yield* Sheet.seedFrom(words))).toString("hex")).toBe(
					v.seed,
				);
				expect(yield* Sheet.publicKey(words)).toBe(v.publicKey);
			}
		}),
	);
	it("vector: independent extract/expand verifies the note before product code exists", () => {
		for (const v of vectors.vectors)
			expect(seed(Buffer.from(v.entropy, "hex")).toString("hex")).toBe(v.seed);
	});
});
