// P19, next/. IDs, outside values and a client built from libfabrika alone (plan "Constructors and
// IDs", "Founding data" and "Laws"). Founding's own machine laws are in `founding.laws.test.ts`.
//
// Modules are loaded per law with a dynamic import, so a missing export fails that law alone, as
// a missing-export failure, never a type error in the test.
import {NodeServices} from "@effect/platform-node";
import {describe, expect, it} from "@effect/vitest";
import {Effect, Exit, Layer, Schedule, Schema} from "effect";
import * as fc from "fast-check";
import type * as IdModule from "../data/id.ts";
import {
	blankArb,
	desktopFixture,
	foundingArb,
	keyLineArb,
	nameArb,
	SEED,
	typeIdArb,
	windowKeyArb,
} from "./desktop.test-support.ts";
import type * as FoundingModule from "./founding.ts";

const load = async <T>(spec: string, path: string, names: ReadonlyArray<keyof T>): Promise<T> => {
	const mod: Partial<T> = await import(/* @vite-ignore */ spec).catch((cause: unknown) => {
		throw new Error(`P19 missing module ${path} (${String(cause)})`);
	});
	for (const name of names)
		if (mod[name] === undefined) throw new Error(`P19 missing export ${String(name)} from ${path}`);
	return mod as T;
};
const founding = () =>
	load<typeof FoundingModule>("./founding.ts", "desktop/founding.ts", [
		"PersonId",
		"Founding",
		"Home",
		"DesktopDown",
	]);
const ids = () =>
	load<typeof IdModule>("../data/id.ts", "data/id.ts (upstream P14)", ["Id", "IdGenerator"]);
const RUNS = {seed: SEED, numRuns: 200};
const TYPEID = /^([a-z]+)_[0-9abcdefghjkmnpqrstvwxyz]{26}$/;

/** UUIDv7's version nibble and RFC 9562 variant, read back out of the 26-character suffix. */
const uuidBits = (id: string): {readonly version: number; readonly variant: number} => {
	const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
	const n = [...id.slice(id.indexOf("_") + 1)].reduce(
		(acc, ch) => (acc << 5n) | BigInt(alphabet.indexOf(ch)),
		0n,
	);
	return {version: Number((n >> 76n) & 15n), variant: Number((n >> 62n) & 3n)};
};

describe("P19 IDs: one TypeID per thing", () => {
	it("plant, use a key fingerprint as the person ID: IdGenerator.next(PersonId) mints person_<UUIDv7>, all distinct", async () => {
		const {PersonId} = await founding();
		const {IdGenerator} = await ids();
		// P14's live clock-and-entropy source, as main's ProcessIdGenerator.layer is.
		const live: unknown = Reflect.get(IdGenerator, "layer");
		if (!Layer.isLayer(live))
			throw new Error("P19 missing export IdGenerator.layer from data/id.ts");
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 1, max: 40}), async (count) => {
				const minted = await Effect.runPromise(
					Effect.gen(function* () {
						const gen = yield* IdGenerator;
						return yield* Effect.forEach(Array.from({length: count}), () => gen.next(PersonId), {
							concurrency: 1,
						});
					}).pipe(Effect.provide(live as Layer.Layer<IdModule.IdGenerator>)),
				);
				expect(new Set(minted).size).toBe(count);
				for (const id of minted) {
					expect(id).toMatch(TYPEID);
					expect(TYPEID.exec(id)?.[1]).toBe("person");
					expect(uuidBits(id)).toEqual({version: 7, variant: 2});
				}
			}),
			{seed: SEED, numRuns: 30},
		);
	});

	it("plant, accept malformed text or the old input spelling: outside IDs fail as typed errors, never a throw", async () => {
		const {PersonId} = await founding();
		const {Id} = await ids();
		const InputId = Id.make("input");
		const bad = fc.oneof(
			fc.string(),
			typeIdArb("tab"),
			typeIdArb("person").map((id) => id.toUpperCase()),
			typeIdArb("person").map((id) => id.slice(0, -1)),
			fc
				.uint8Array({minLength: 32, maxLength: 32})
				.map((b) => `SHA256:${Buffer.from(b).toString("base64").replace(/=+$/, "")}`),
			fc.tuple(typeIdArb("process"), fc.nat()).map(([p, n]) => `in-${p}-${n}`),
		);
		fc.assert(
			fc.property(bad, typeIdArb("person"), typeIdArb("input"), (text, person, input) => {
				const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(PersonId)(text));
				const ok = TYPEID.exec(text)?.[1] === "person";
				expect(Exit.isSuccess(exit)).toBe(ok);
				if (Exit.isFailure(exit)) expect(Exit.hasDies(exit)).toBe(false);
				expect(
					Exit.isSuccess(Effect.runSyncExit(Schema.decodeUnknownEffect(PersonId)(person))),
				).toBe(true);
				expect(Exit.isSuccess(Effect.runSyncExit(Schema.decodeUnknownEffect(InputId)(input)))).toBe(
					true,
				);
				expect(
					Exit.isFailure(Effect.runSyncExit(Schema.decodeUnknownEffect(InputId)(person))),
				).toBe(true);
			}),
			{
				...RUNS,
				// The old door wrote `in-process_<id>-<n>`; new inputs never use it (one-id-per-thing.md).
				examples: [
					[
						"in-process_01m6v5270hf3c8x2q7w9z4k5mn-3",
						"person_01m6v5270hf3c8x2q7w9z4k5mn",
						"input_01m6v5270hf3c8x2q7w9z4k5mn",
					],
				],
			},
		);
	});
});

describe("P19 outside values decode through the typed path", () => {
	/** One field of a valid founding value replaced by a wrong-typed or invalid one. */
	const corrupted = fc
		.tuple(
			foundingArb,
			fc.constantFrom("v", "person", "name", "keys", "window", "extra-missing"),
			fc.oneof(fc.jsonValue(), blankArb, typeIdArb("tab"), fc.constant([]), keyLineArb),
		)
		.map(([value, key, junk]) => {
			const copy: Record<string, unknown> = {...value};
			if (key === "extra-missing") delete copy["person"];
			else copy[key] = key === "name" && typeof junk === "string" ? junk.trim() : junk;
			return {copy, key, junk};
		});

	it("plant, call .make on outside input or let a SchemaError escape: any JSON decodes to Founding or a typed failure, never a defect", async () => {
		const {Founding, Home} = await founding();
		fc.assert(
			fc.property(fc.jsonValue(), foundingArb, (json, good) => {
				for (const schema of [Founding, Home] as const) {
					const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(schema)(json));
					expect(Exit.hasDies(exit)).toBe(false);
				}
				expect(Exit.isSuccess(Effect.runSyncExit(Schema.decodeUnknownEffect(Founding)(good)))).toBe(
					true,
				);
			}),
			RUNS,
		);
	});

	it("plant, accept a corrupted field: one bad field fails the whole founding value", async () => {
		const {Founding} = await founding();
		fc.assert(
			fc.property(corrupted, ({copy, key, junk}) => {
				const exit = Effect.runSyncExit(Schema.decodeUnknownEffect(Founding)(copy));
				const stillValid =
					key !== "extra-missing" &&
					Exit.isSuccess(
						Effect.runSyncExit(
							Schema.decodeUnknownEffect(
								Schema.Struct({
									v: Schema.Literal(1),
									person: Schema.String.check(Schema.isPattern(/^person_[0-9a-hjkmnp-tv-z]{26}$/)),
									name: Schema.NonEmptyString.check(Schema.makeFilter((s) => s.trim().length > 0)),
									keys: Schema.Array(Schema.String).check(Schema.isMinLength(1)),
									window: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{43}$/)),
								}),
							)(copy),
						),
					);
				expect(Exit.hasDies(exit)).toBe(false);
				if (!stillValid)
					expect(Exit.isFailure(exit), `${key} := ${JSON.stringify(junk)}`).toBe(true);
			}),
			RUNS,
		);
	});

	it("plant, a founding with no person key: keys must hold the initial person key", async () => {
		const {Founding} = await founding();
		fc.assert(
			fc.property(foundingArb, windowKeyArb, (value, window) => {
				const empty = {...value, keys: []};
				const notALine = {...value, keys: [window]};
				for (const bad of [empty, notALine])
					expect(
						Exit.isFailure(Effect.runSyncExit(Schema.decodeUnknownEffect(Founding)(bad))),
					).toBe(true);
			}),
			RUNS,
		);
	});
});

describe("P19 a client from libfabrika alone", () => {
	it("plant, require a Tuval or app helper: public desktop exports alone found, sign, start and stop", async () => {
		const desktop = await load<typeof import("@kampus/libfabrika/desktop")>(
			"@kampus/libfabrika/desktop",
			"@kampus/libfabrika/desktop",
			[
				"DesktopStore",
				"KeyStore",
				"Seal",
				"PersonKey",
				"sealedPersonKey",
				"BrainService",
				"launchdBrain",
				"LaunchControl",
				"BrainProbe",
				"ServiceState",
				"DesktopRecording",
				"DesktopDown",
				"Founding",
				"LaunchdSpec",
			],
		);
		const node = await load<typeof import("@kampus/libfabrika/node/desktop-store")>(
			"@kampus/libfabrika/node/desktop-store",
			"@kampus/libfabrika/node/desktop-store",
			["fileDesktopStore"],
		);
		const {IdGenerator} = await ids();
		const {checkSshsig, writeSshsig} = await import("@kampus/libfabrika/transport");
		await fc.assert(
			fc.asyncProperty(nameArb, async (name) => {
				await Effect.runPromise(
					Effect.scoped(
						Effect.gen(function* () {
							const fx = yield* desktopFixture({
								fileDesktopStore: node.fileDesktopStore,
								Seal: desktop.Seal,
								IdGenerator,
								LaunchControl: desktop.LaunchControl,
								BrainProbe: desktop.BrainProbe,
								ServiceState: desktop.ServiceState,
								DesktopRecording: desktop.DesktopRecording,
								DesktopDown: desktop.DesktopDown,
							});
							const founder = yield* Effect.gen(function* () {
								const store = yield* desktop.DesktopStore;
								return yield* store.found(name);
							}).pipe(Effect.provide(fx.store));
							expect(founder.name).toBe(name);
							const person = yield* Effect.gen(function* () {
								const key = yield* desktop.PersonKey;
								const line = yield* key.line;
								const armored = yield* writeSshsig({
									text: "p19 alone",
									space: "fabrika-client",
									line,
									sign: (bytes) => key.sign(bytes).pipe(Effect.orDie),
								});
								return {line, armored};
							}).pipe(Effect.provide(desktop.sealedPersonKey.pipe(Layer.provide(fx.store))));
							expect(
								yield* checkSshsig({
									text: "p19 alone",
									armored: person.armored,
									space: "fabrika-client",
									signers: founder.keys,
								}),
							).toEqual({signer: person.line});
							const spec = Schema.decodeUnknownSync(desktop.LaunchdSpec)({
								label: "dev.fabrika.test.alone",
								home: fx.home,
								executable: process.execPath,
								entry: `${fx.home}/brain.js`,
								uid: 501,
								port: 4387,
								throttle: 5,
								founder: Schema.encodeSync(desktop.Founding)(founder),
							});
							yield* Effect.gen(function* () {
								const brain = yield* desktop.BrainService;
								const {url} = yield* brain.up;
								expect(url).toContain("4387");
								yield* brain.stop;
							}).pipe(
								Effect.provide(
									desktop
										.launchdBrain(spec, {poll: Schedule.spaced("1 millis")})
										.pipe(Layer.provide(Layer.mergeAll(fx.launch, fx.probe, fx.records))),
								),
							);
							expect((yield* fx.calls).map((c) => c.op)).toEqual(
								expect.arrayContaining(["bootstrap", "bootout"]),
							);
						}),
					).pipe(Effect.provide(NodeServices.layer)),
				);
			}),
			{seed: SEED, numRuns: 5},
		);
	});
});
