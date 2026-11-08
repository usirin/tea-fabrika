import type {Context} from "effect";
import {Clock, Effect, Exit, Ref, Schema, Scope, Stream} from "effect";
import * as Socket from "effect/socket/Socket";
import * as fc from "fast-check";
import {describe, expect, expectTypeOf, it, vi} from "vitest";
import type {ProcessId} from "../data/trace.ts";
import {checkHello} from "../transport/hello.ts";
import {Admission, Hello, Who} from "../transport/wire.ts";
import type {ClientKey} from "./key.ts";
import type {ClientId, MonitorId} from "./protocol.ts";
import type {MonitorRequest, DemonitorRequest} from "./protocol.ts";
import {p18Ids, p18Suffix, p18Values} from "./tile.test-support.ts";

const options = {seed: 119120, numRuns: 40};
const size = fc.record({
	width: fc.integer({min: 0, max: 4096}),
	height: fc.integer({min: 0, max: 4096}),
});
const bits = (text: string) =>
	[...text.slice(text.indexOf("_") + 1)].reduce(
		(n, c) => (n << 5n) | BigInt("0123456789abcdefghjkmnpqrstvwxyz".indexOf(c)),
		0n,
	);
const valid = (id: string, prefix: string) => {
	expect(id).toMatch(new RegExp(`^${prefix}_[0-7][0-9a-hjkmnp-tv-z]{25}$`));
	expect(Number((bits(id) >> 76n) & 15n)).toBe(7);
	expect(Number((bits(id) >> 62n) & 3n)).toBe(2);
};

// Plants: erase an ID brand; add privateKey or exportPrivate to ClientKey's public shape.
it("types: client and monitor brands differ; public ClientKey exposes only public operations", () => {
	expectTypeOf<typeof ClientId.Type>().not.toEqualTypeOf<typeof MonitorId.Type>();
	// This also exposes main's still-unbranded ProcessId. P14 must settle that upstream.
	expectTypeOf<typeof ClientId.Type>().not.toExtend<typeof ProcessId.Type>();
	expectTypeOf<typeof MonitorId.Type>().not.toExtend<typeof ProcessId.Type>();
	expectTypeOf<keyof Context.Service.Shape<typeof ClientKey>>().toEqualTypeOf<
		"identity" | "sign" | "replace" | "changes" | "persist"
	>();
});

// Plant: add to, client, session or by to a public request schema.
it("types: public monitor requests contain no recipient or writer", () => {
	// The plan leaves these schema export names open. These are the request names for P18.
	expectTypeOf<keyof typeof MonitorRequest.Type>().toEqualTypeOf<"pid" | "ref">();
	expectTypeOf<keyof typeof DemonitorRequest.Type>().toEqualTypeOf<"ref">();
});

describe("P18 platform contracts", () => {
	// Plants: reuse a reference, encode version 4, or generate the former combined input ID.
	it("generated allocations preserve prefix, UUIDv7 bits and uniqueness through clock rollback", async () => {
		const {Id, IdGenerator} = await import("../data/id.ts");
		await fc.assert(
			fc.asyncProperty(
				fc.integer({min: 0, max: 2 ** 40}),
				fc.uint8Array({minLength: 10, maxLength: 10}),
				fc.array(fc.constantFrom("client", "monitor", "input", "process"), {
					minLength: 2,
					maxLength: 30,
				}),
				async (at, entropy, prefixes) => {
					const random = vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
						if (array instanceof Uint8Array) array.set(entropy.slice(0, array.length));
						return array;
					});
					let clock = at;
					const testClock: Clock.Clock = {
						currentTimeMillisUnsafe: () => clock,
						currentTimeMillis: Effect.sync(() => {
							const now = clock;
							clock = Math.max(0, clock - 1);
							return now;
						}),
						currentTimeNanosUnsafe: () => BigInt(clock) * 1_000_000n,
						currentTimeNanos: Effect.sync(() => BigInt(clock) * 1_000_000n),
						monotonicTimeNanosUnsafe: () => 0n,
						monotonicTimeNanos: Effect.succeed(0n),
						sleep: () => Effect.void,
					};
					try {
						await Effect.runPromise(
							Effect.gen(function* () {
								const generator = yield* IdGenerator;
								const seen = new Set<string>();
								for (const prefix of prefixes) {
									const id = yield* generator.next(Id.make(prefix));
									valid(id, prefix);
									expect(seen.has(id)).toBe(false);
									seen.add(id);
								}
							}).pipe(
								Effect.provide(IdGenerator.layer),
								Effect.provideService(Clock.Clock, testClock),
							),
						);
					} finally {
						random.mockRestore();
					}
				},
			),
			options,
		);
	});

	// Plants: accept a mutated version/variant; throw instead of returning a typed decode failure.
	it("outside IDs reject wrong prefixes, length, alphabet, version and variant without throwing", async () => {
		const {ClientId, MonitorId} = await import("./protocol.ts");
		fc.assert(
			fc.asyncProperty(p18Suffix, fc.string(), async (suffix, junk) => {
				for (const [schema, prefix] of [
					[ClientId, "client"],
					[MonitorId, "monitor"],
				] as const) {
					valid(`${prefix}_${suffix}`, prefix);
					const v4 = (bits(`${prefix}_${suffix}`) & ~(15n << 76n)) | (4n << 76n);
					const encode = (value: bigint) =>
						Array.from(
							{length: 26},
							(_, n) =>
								"0123456789abcdefghjkmnpqrstvwxyz"[Number((value >> BigInt((25 - n) * 5)) & 31n)],
						).join("");
					for (const bad of [
						`other_${suffix}`,
						`${prefix}_${suffix.slice(1)}`,
						`${prefix}_${suffix}0`,
						`${prefix}_${suffix.slice(0, -1)}i`,
						`${prefix}_${encode(v4)}`,
						`${prefix}_${encode(bits(`${prefix}_${suffix}`) & ~(3n << 62n))}`,
						`in-process_${suffix}-7`,
						`junk-${junk}`,
					]) {
						if (bad === `${prefix}_${suffix}`) continue;
						const answer = await Effect.runPromise(
							Effect.exit(Schema.decodeUnknownEffect(schema)(bad)),
						);
						expect(Exit.isFailure(answer)).toBe(true);
					}
				}
			}),
			options,
		);
	});

	// Plants: generate on identity reads, sign another hello, or return the old key after replace.
	it("memory identity stays stable until replace and its signature passes actual checkHello", async () => {
		const {memoryKey} = await import("./memory.ts");
		const {ClientKey} = await import("./key.ts");
		const {TabId} = await import("./protocol.ts");
		await fc.assert(
			fc.asyncProperty(
				p18Suffix,
				fc.array(fc.boolean(), {minLength: 2, maxLength: 8}),
				fc.webUrl(),
				fc.uuid(),
				async (suffix, replacements, url, nonce) => {
					await Effect.runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								const key = yield* ClientKey;
								let identity = yield* key.identity;
								const tab = Schema.decodeUnknownSync(TabId)(`tab_${suffix}`);
								for (const replace of replacements) {
									if (replace) {
										const next = yield* key.replace;
										expect(next.key).not.toBe(identity.key);
										identity = next;
									}
									expect(yield* key.identity).toEqual(identity);
									const signed = yield* key.sign({nonce, url, tab});
									const hello = Hello.make({
										versions: [1],
										has: [],
										ping: "30s",
										key: identity.key,
										tab,
										nonce,
										signed,
										platform: "headless",
										os: "unknown",
										sentAt: "2026-11-08T00:00:00Z",
									});
									const answer = yield* checkHello({
										hello,
										url,
										tab,
										nonce,
										name: identity.fingerprint,
										versions: [1],
										ping: {min: 1, max: 30_000},
										consume: () => true,
										admit: () =>
											Effect.succeed(
												Admission.cases.admitted.make({
													who: Who.make({
														key: identity.fingerprint,
														person: "person",
														as: "window",
													}),
												}),
											),
									});
									expect(answer._tag).toBe("online");
									yield* key.persist;
								}
							}),
						).pipe(
							Effect.provide(memoryKey({tab: Schema.decodeUnknownSync(TabId)(`tab_${suffix}`)})),
						),
					);
				},
			),
			{...options, numRuns: 10},
		);
	});

	// Plants: a constant size, accepting NaN, or a subscriber that outlives its scope.
	it("memory screen reads supplied sizes, emits ordered changes and stops with its scope", async () => {
		const {memoryScreen} = await import("./memory.ts");
		const {Screen} = await import("./platform.ts");
		await fc.assert(
			fc.asyncProperty(
				size,
				fc.array(size, {minLength: 1, maxLength: 12}),
				fc.nat({max: 12}),
				async (initial, changes, cut) => {
					await Effect.runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								const memory = yield* memoryScreen(initial);
								const received = yield* Ref.make<ReadonlyArray<typeof initial>>([]);
								const scope = yield* Scope.make();
								const screen = yield* Screen.pipe(Effect.provide(memory.layer));
								expect(yield* screen.size).toEqual(initial);
								const listener = yield* Stream.runForEach(screen.resized, (s: typeof initial) =>
									Ref.update(received, (xs) => [...xs, s]),
								).pipe(Effect.forkIn(scope));
								yield* Effect.yieldNow;
								const before = changes.slice(0, cut);
								for (const next of before) {
									yield* memory.resize(next);
									yield* Effect.yieldNow;
									expect(yield* screen.size).toEqual(next);
								}
								expect(yield* Ref.get(received)).toEqual(before);
								yield* Scope.close(scope, Exit.void);
								for (const next of changes.slice(cut)) yield* memory.resize(next);
								expect(yield* Ref.get(received)).toEqual(before);
								expect(listener.pollUnsafe()).toBeDefined();
								for (const bad of [
									{width: Number.NaN, height: 1},
									{width: -1, height: 1},
									{width: 1, height: Infinity},
									null,
								])
									expect(yield* Effect.result(memory.resize(bad))).toMatchObject({
										_tag: "Failure",
										failure: {_tag: "ScreenDown", why: "bad_size"},
									});
							}),
						),
					);
				},
			),
			options,
		);
	});

	// Plants: claim seal in the browser, run a reserved binding, or mutate the configured table.
	// This public-only composition also catches a dependency on an app or Tuval helper.
	it("public headless composition retains only supplied capabilities and excludes reserved keys", async () => {
		// Deliberately public-only imports: a new client must need neither Tuval nor the app.
		const {Host, Screen, platformKeys} = await import("@kampus/libfabrika");
		const {headlessLayer, memoryScreen, memoryKey} = await import("@kampus/libfabrika/headless");
		await fc.assert(
			fc.asyncProperty(
				p18Ids,
				size,
				fc.uniqueArray(fc.constantFrom("screen", "seal", "clipboard")),
				fc.subarray(["Cmd+W", "Cmd+L", "Cmd+R"]),
				async (ids, initial, has, cannot) => {
					const host = {platform: "headless" as const, os: "unknown" as const, has, cannot};
					const table = {
						prefix: "Ctrl+B",
						ignore: [],
						tiles: {counter: {inc: ["+", ...cannot]}},
						error: null,
					};
					const saved = JSON.stringify(table);
					const effective = platformKeys(table, host);
					expect(JSON.stringify(table)).toBe(saved);
					expect(effective.table.tiles.counter.inc).toEqual(["+"]);
					expect(effective.unavailable).toEqual(
						cannot.map((keys) => ({program: "counter", does: "inc", keys})),
					);
					await Effect.runPromise(
						Effect.scoped(
							Effect.gen(function* () {
								const memory = yield* memoryScreen(initial);
								const layer = headlessLayer({
									host,
									screen: memory.layer,
									key: memoryKey({tab: ids.tileA.replace("tile_", "tab_")}),
									socket: Socket.layerWebSocketConstructorGlobal,
								});
								yield* Effect.gen(function* () {
									expect(yield* Host).toEqual(host);
									expect(yield* (yield* Screen).size).toEqual(initial);
								}).pipe(Effect.provide(layer));
							}),
						),
					);
				},
			),
			options,
		);
	});

	it("plants: constant ID, UUIDv4 and combined input ID fail the same ID check", () => {
		valid(p18Values.client, "client");
		for (const plant of [
			"input_in-process-7",
			"client_00000000008008000000000000",
			"client_0000000000e00c000000000000",
		])
			expect(() => valid(plant, "client")).toThrow();
	});
});
