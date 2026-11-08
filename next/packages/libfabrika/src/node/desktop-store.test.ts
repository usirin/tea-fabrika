// P19, next/. The file desktop store on a real temp home (plan "Founding data" and "Laws"): an
// empty home shows founding and anything else never does, Start seals two distinct keys before it
// publishes public data, an interrupted install is kept and reported, never replaced, repeated and
// concurrent starts make one identity, and a reopen keeps the person and keys.
//
// The seal is the stand-in (`electron/keys.test-support.ts`); the store, its files and its lock are
// real. Modules load per law, so a missing export fails that law alone.
import {chmodSync, mkdirSync, rmSync, truncateSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {NodeServices} from "@effect/platform-node";
import {describe, expect, it} from "@effect/vitest";
import type {Layer, Scope} from "effect";
import {Effect, Exit, Fiber, FileSystem} from "effect";
import * as fc from "fast-check";
import type * as IdModule from "../data/id.ts";
import type * as Brain from "../desktop/brain-service.ts";
import {
	CHROMIUM_CACHE,
	desktopFixture,
	filesBelow,
	nameArb,
	P12_DATA,
	SEED,
	tempHome,
	type Script,
} from "../desktop/desktop.test-support.ts";
import type * as FoundingModule from "../desktop/founding.ts";
import type * as KeysModule from "../desktop/keys.ts";
import type * as Recording from "../desktop/recording.ts";
import {TEST_SEAL_HEAD} from "../electron/keys.test-support.ts";
import type * as StoreModule from "./desktop-store.ts";

const load = async <T>(spec: string, path: string, names: ReadonlyArray<keyof T>): Promise<T> => {
	const mod: Partial<T> = await import(/* @vite-ignore */ spec).catch((cause: unknown) => {
		throw new Error(`P19 missing module ${path} (${String(cause)})`);
	});
	for (const name of names)
		if (mod[name] === undefined) throw new Error(`P19 missing export ${String(name)} from ${path}`);
	return mod as T;
};
const modules = async () => {
	const s = await load<typeof StoreModule>("./desktop-store.ts", "node/desktop-store.ts", [
		"fileDesktopStore",
	]);
	const f = await load<typeof FoundingModule>("../desktop/founding.ts", "desktop/founding.ts", [
		"DesktopStore",
		"DesktopDown",
		"Founding",
	]);
	const k = await load<typeof KeysModule>("../desktop/keys.ts", "desktop/keys.ts", [
		"Seal",
		"KeyStore",
	]);
	const b = await load<typeof Brain>("../desktop/brain-service.ts", "desktop/brain-service.ts", [
		"LaunchControl",
		"BrainProbe",
		"ServiceState",
	]);
	const r = await load<typeof Recording>("../desktop/recording.ts", "desktop/recording.ts", [
		"DesktopRecording",
	]);
	const ids = await load<typeof IdModule>("../data/id.ts", "data/id.ts (upstream P14)", [
		"IdGenerator",
	]);
	return {
		f,
		k,
		fixture: (script?: Script, home?: string) =>
			desktopFixture(
				{
					fileDesktopStore: s.fileDesktopStore,
					Seal: k.Seal,
					IdGenerator: ids.IdGenerator,
					LaunchControl: b.LaunchControl,
					BrainProbe: b.BrainProbe,
					ServiceState: b.ServiceState,
					DesktopRecording: r.DesktopRecording,
					DesktopDown: f.DesktopDown,
				},
				script,
				home,
			),
	};
};
type Mods = Awaited<ReturnType<typeof modules>>;

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope | FileSystem.FileSystem>) =>
	Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(NodeServices.layer)));
const inspect = (m: Mods, store: Layer.Layer<FoundingModule.DesktopStore>) =>
	Effect.exit(
		Effect.gen(function* () {
			return yield* (yield* m.f.DesktopStore).inspect;
		}).pipe(Effect.provide(store)),
	);
const found = (m: Mods, store: Layer.Layer<FoundingModule.DesktopStore>, name: string) =>
	Effect.gen(function* () {
		return yield* (yield* m.f.DesktopStore).found(name);
	}).pipe(Effect.provide(store));
const sealed = (home: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const out: Array<string> = [];
		for (const name of yield* filesBelow(home)) {
			const text = Buffer.from(yield* fs.readFile(join(home, name))).toString("latin1");
			if (text.startsWith(TEST_SEAL_HEAD)) out.push(name);
		}
		return out;
	}).pipe(Effect.orDie);

describe("P19 desktop store: what an opened home is", () => {
	const damage = fc.oneof(
		fc.constant({kind: "none" as const}),
		fc.nat().map((pick) => ({kind: "delete" as const, pick})),
		fc.nat().map((pick) => ({kind: "truncate" as const, pick})),
		fc.nat().map((pick) => ({kind: "unreadable" as const, pick})),
		fc.nat().map((pick) => ({kind: "partial" as const, pick})),
	);
	const home = fc.record({
		founded: fc.boolean(),
		damage,
		p12: fc.subarray([...P12_DATA]),
		cache: fc.boolean(),
		name: nameArb,
	});

	it("plant, treat an unreadable key or a missing manifest as empty: only a home with no identity and no ledger shows founding", async () => {
		const m = await modules();
		await fc.assert(
			fc.asyncProperty(home, async (h) => {
				await run(
					Effect.gen(function* () {
						const fx = yield* m.fixture();
						const founder = h.founded ? yield* found(m, fx.store, h.name) : null;
						const identity = yield* filesBelow(fx.home);
						const target =
							identity.length === 0
								? undefined
								: identity[(h.damage.kind === "none" ? 0 : h.damage.pick) % identity.length];
						if (target !== undefined && founder !== null) {
							const at = join(fx.home, target);
							if (h.damage.kind === "delete") rmSync(at);
							if (h.damage.kind === "truncate") truncateSync(at, 1);
							if (h.damage.kind === "unreadable") chmodSync(at, 0o000);
							if (h.damage.kind === "partial")
								// Keep one file of the identity only, as a cut install leaves it.
								for (const other of identity) if (other !== target) rmSync(join(fx.home, other));
						}
						for (const path of h.p12) {
							const at = join(fx.home, path);
							if (path.startsWith(".")) mkdirSync(at, {recursive: true});
							else writeFileSync(at, "{}\n");
						}
						for (const dir of h.cache ? CHROMIUM_CACHE : []) {
							mkdirSync(join(fx.home, dir), {recursive: true});
							writeFileSync(join(fx.home, dir, "data_0"), "cache");
						}
						const exit = yield* inspect(m, fx.store);
						if (target !== undefined) chmodSync(join(fx.home, target), 0o600);
						expect(Exit.hasDies(exit)).toBe(false);
						const empty = Exit.isSuccess(exit) && exit.value._tag === "empty";
						const clean = founder !== null && h.damage.kind === "none";
						if (founder === null && h.p12.length === 0)
							expect(empty, "a fresh home, cache or not").toBe(true);
						else expect(empty, "existing or partial data showed founding").toBe(false);
						if (founder === null && h.p12.length > 0)
							expect(JSON.stringify(exit)).toContain("existing_data");
						if (clean)
							expect(
								Exit.isSuccess(exit) && exit.value._tag === "ready" ? exit.value.founder : null,
							).toEqual(founder);
					}),
				);
			}),
			{seed: SEED, numRuns: 80},
		);
	});
});

describe("P19 desktop store: Start", () => {
	const cut = fc.oneof(
		fc.constant({kind: "none" as const}),
		fc.constantFrom(1, 2).map((n) => ({kind: "seal" as const, n})),
		fc.integer({min: 0, max: 40}).map((yields) => ({kind: "interrupt" as const, yields})),
	);

	it("plant, Start first, reuse one pair or publish a partial identity: two distinct sealed keys, then public data, and a cut install is kept and reported", async () => {
		const m = await modules();
		await fc.assert(
			fc.asyncProperty(nameArb, cut, async (name, c) => {
				await run(
					Effect.gen(function* () {
						const fx = yield* m.fixture();
						if (c.kind === "seal") {
							// Fail the first or second seal: neither key may be published.
							yield* fx.sealer.failNext("seal_unavailable", "encrypt", c.n - 1);
							const exit = yield* Effect.exit(found(m, fx.store, name));
							expect(Exit.isFailure(exit) && !Exit.hasDies(exit)).toBe(true);
							const after = yield* inspect(m, fx.store);
							expect(
								Exit.isSuccess(after) && after.value._tag === "ready",
								"a failed seal published an identity",
							).toBe(false);
							return;
						}
						if (c.kind === "interrupt") {
							const fiber = yield* Effect.forkChild(found(m, fx.store, name));
							for (let i = 0; i < c.yields; i++) yield* Effect.yieldNow;
							yield* Fiber.interrupt(fiber);
							const after = yield* inspect(m, fx.store);
							expect(Exit.hasDies(after)).toBe(false);
							if (Exit.isSuccess(after) && after.value._tag === "ready") {
								// A complete identity: both keys open and sign.
								const ks = yield* Effect.gen(function* () {
									return yield* m.k.KeyStore;
								}).pipe(Effect.provide(fx.store));
								yield* ks.sign("person", new Uint8Array([1]));
								yield* ks.sign("window", new Uint8Array([1]));
							}
							// Never silently replaced: a later Start answers the same identity or refuses.
							const again = yield* Effect.exit(found(m, fx.store, name));
							if (Exit.isSuccess(after) && after.value._tag === "ready" && Exit.isSuccess(again))
								expect(again.value).toEqual(after.value.founder);
							if (Exit.isFailure(after))
								expect(Exit.isSuccess(again), "a reported cut install was replaced").toBe(false);
							return;
						}
						const founder = yield* found(m, fx.store, name);
						const plains = yield* fx.sealer.plains;
						expect(plains).toHaveLength(2);
						expect(new Set(plains).size).toBe(2);
						expect(yield* sealed(fx.home)).toHaveLength(2);
						expect(founder.name).toBe(name);
						expect(founder.keys).toHaveLength(1);
						const ks = yield* Effect.gen(function* () {
							return yield* m.k.KeyStore;
						}).pipe(Effect.provide(fx.store));
						const person = yield* ks.publicKey("person");
						const window = yield* ks.publicKey("window");
						expect(founder.keys[0]).toBe(person.line);
						expect(founder.window).toBe(window.key);
						expect(person.key).not.toBe(window.key);
						const calls = yield* fx.sealer.calls;
						expect(calls.filter((x) => x === "encrypt")).toHaveLength(2);
						expect((yield* fx.calls).map((x) => x.op)).not.toContain("bootstrap");
					}),
				);
			}),
			{seed: SEED, numRuns: 60},
		);
	});

	it("plant, remove the lock or the fresh-state recheck: repeated and concurrent starts on one home make one identity", async () => {
		const m = await modules();
		await fc.assert(
			fc.asyncProperty(
				nameArb,
				fc.integer({min: 2, max: 6}),
				fc.boolean(),
				async (name, count, apart) => {
					await run(
						Effect.gen(function* () {
							const home = yield* tempHome;
							// Separate stores on one home, as separate app processes are, each with its own ID clock.
							const stores = yield* Effect.forEach(
								Array.from({length: count}, (_, i) => i),
								(i) => m.fixture({idClock: 1_800_000_000_000 + i * 1000}, home),
								{concurrency: 1},
							);
							const answers = yield* Effect.forEach(
								stores,
								(fx) => Effect.exit(found(m, fx.store, name)),
								{
									concurrency: apart ? 1 : "unbounded",
								},
							);
							const ok = answers.filter(Exit.isSuccess).map((e) => e.value);
							expect(ok.length).toBeGreaterThanOrEqual(1);
							for (const a of answers) expect(Exit.hasDies(a)).toBe(false);
							for (const a of ok) expect(a).toEqual(ok[0]);
							expect(yield* sealed(home)).toHaveLength(2);
							const after = yield* inspect(m, stores[0]!.store);
							expect(
								Exit.isSuccess(after) && after.value._tag === "ready" ? after.value.founder : null,
							).toEqual(ok[0]);
						}),
					);
				},
			),
			{seed: SEED, numRuns: 30},
		);
	});

	it("plant, generate on every open: close, reopen and retry keep the person, the keys and their files", async () => {
		const m = await modules();
		await fc.assert(
			fc.asyncProperty(
				nameArb,
				fc.array(fc.constantFrom("close", "reopen", "retry"), {maxLength: 8}),
				async (name, ops) => {
					await run(
						Effect.gen(function* () {
							const first = yield* m.fixture();
							const founder = yield* found(m, first.store, name);
							const files = yield* filesBelow(first.home);
							for (const [i, op] of ops.entries()) {
								const fx = yield* m.fixture({idClock: 1_900_000_000_000 + i}, first.home);
								const exit = yield* inspect(m, fx.store);
								expect(
									Exit.isSuccess(exit) && exit.value._tag === "ready" ? exit.value.founder : null,
								).toEqual(founder);
								if (op === "retry") expect(yield* found(m, fx.store, name)).toEqual(founder);
								const ks = yield* Effect.gen(function* () {
									return yield* m.k.KeyStore;
								}).pipe(Effect.provide(fx.store));
								expect((yield* ks.publicKey("person")).line).toBe(founder.keys[0]);
								expect((yield* ks.publicKey("window")).key).toBe(founder.window);
								expect(
									(yield* fx.sealer.calls).filter((c) => c === "encrypt"),
									`${op} made a key`,
								).toEqual([]);
								expect(yield* filesBelow(first.home)).toEqual(files);
							}
						}),
					);
				},
			),
			{seed: SEED, numRuns: 30},
		);
	});
});
