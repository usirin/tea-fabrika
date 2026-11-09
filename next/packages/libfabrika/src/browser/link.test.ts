// P23, next/. No fake reducer: the holder and parsing below are the library's real exports.
import {describe, expect, it} from "@effect/vitest";
import {Effect, Option, Redacted, Schema} from "effect";
import {Bytes32, Operations, checks, leaks} from "../desktop/browser-link.test-support.ts";

const module = "./link.ts";
const load = () => Effect.promise((): Promise<typeof import("./link.ts")> => import(module));
const failedClear = (raw: string) => () => {
	throw new Error(raw);
};
describe("P23 fragment capture", () => {
	it.effect.prop(
		"clear happens before key loading or connecting; take succeeds once",
		{bytes: Bytes32, ops: Operations},
		({bytes, ops}) =>
			Effect.gen(function* () {
				const {BrowserPass} = yield* load();
				const raw = Buffer.from(bytes).toString("base64url");
				const calls: string[] = [];
				let hash = `#pass=${raw}`;
				const page = {
					hash: () => hash,
					clear: () => {
						calls.push("clear");
						hash = "";
					},
				};
				yield* Effect.gen(function* () {
					const holder = yield* BrowserPass;
					yield* holder.ready;
					calls.push("key", "connect");
					expect(hash).toBe("");
					expect(calls).toEqual(["clear", "key", "connect"]);
					const first = yield* holder.take;
					expect(Option.isSome(first)).toBe(true);
					expect(Redacted.value(Option.getOrThrow(first))).toBe(raw);
					for (const _op of ops) expect(Option.isNone(yield* holder.take)).toBe(true);
					expect(Option.isNone(yield* holder.take)).toBe(true);
				}).pipe(Effect.provide(BrowserPass.browser(page)));
				// Reload sees the cleared address and cannot recover the pass.
				yield* Effect.gen(function* () {
					const holder = yield* BrowserPass;
					yield* holder.ready;
					expect(Option.isNone(yield* holder.take)).toBe(true);
				}).pipe(Effect.provide(BrowserPass.browser(page)));
			}),
		checks,
	);
	it.effect.prop(
		"empty, unknown, duplicate and malformed fragments clear into ordinary code flow",
		{bytes: Bytes32, word: Schema.NonEmptyString},
		({bytes, word}) =>
			Effect.gen(function* () {
				const {takeBrowserPass} = yield* load();
				const raw = Buffer.from(bytes).toString("base64url");
				for (const fragment of [
					"",
					"#",
					`#unknown=${encodeURIComponent(word)}`,
					`#pass=${raw}&pass=${raw}`,
					`#pass=${raw}&extra=x`,
					"#pass=%ZZ",
					`#pass=${raw}=`,
					"#pass=",
				]) {
					let cleared = 0;
					const pass = yield* takeBrowserPass({
						hash: () => fragment,
						clear: () => {
							cleared++;
						},
					});
					expect(cleared).toBe(1);
					expect(Option.isNone(pass)).toBe(true);
				}
			}),
		checks,
	);
	it.effect.prop(
		"a failed clear stores only unavailable and never returns a secret",
		{bytes: Bytes32},
		({bytes}) =>
			Effect.gen(function* () {
				const {BrowserPass} = yield* load();
				const raw = Buffer.from(bytes).toString("base64url");
				yield* Effect.gen(function* () {
					const holder = yield* BrowserPass;
					for (const op of [holder.ready, holder.take, holder.take]) {
						const result = yield* Effect.result(op);
						expect(result).toMatchObject({_tag: "Failure", failure: {why: "unavailable"}});
						expect(leaks(raw, result)).toBe(false);
					}
				}).pipe(
					Effect.provide(
						BrowserPass.browser({
							hash: () => `#pass=${raw}`,
							clear: failedClear(raw),
						}),
					),
				);
			}),
		checks,
	);
	it.effect.prop(
		"native and headless clients never supply a browser pass",
		{ops: Operations},
		({ops}) =>
			Effect.gen(function* () {
				const {BrowserPass} = yield* load();
				yield* Effect.gen(function* () {
					const holder = yield* BrowserPass;
					yield* holder.ready;
					for (const _op of ["take", ...ops]) expect(Option.isNone(yield* holder.take)).toBe(true);
				}).pipe(Effect.provide(BrowserPass.none));
			}),
		checks,
	);
});
