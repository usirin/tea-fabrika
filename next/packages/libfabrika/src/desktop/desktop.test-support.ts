// P19, next/. Test-owned support for the desktop laws (plan "Tests before implementation"). Each
// piece is a typed stand-in for an outside effect: launchctl, P12's readiness, P12's journal and
// the clock-and-entropy source of IDs. None of them decides anything P19 decides. A test loads the
// product's modules itself, with a dynamic import, so a missing export fails that law alone, and
// hands them in here.
import {NodeServices} from "@effect/platform-node";
import type {Context, Scope} from "effect";
import {Effect, FileSystem, Layer, Option, Path, Ref, Schema} from "effect";
import * as fc from "fast-check";
import type {IdGenerator, IdSchema} from "../data/id.ts";
import {TEST_SEAL_HEAD, testSeal} from "../electron/keys.test-support.ts";
import type {BrainProbe, LaunchControl, LaunchdSpec, ServiceState} from "./brain-service.ts";
import type {DesktopDown, DesktopStore} from "./founding.ts";
import type {KeyStore, Seal} from "./keys.ts";
import type {DesktopObservation, DesktopRecording} from "./recording.ts";

export const SEED = 119120;
export {TEST_SEAL_HEAD};

type Why = DesktopDown["why"];
type Spec = typeof LaunchdSpec.Type;
type State = typeof ServiceState.Type;

// An ssh-ed25519 public line: RFC 4253's string "ssh-ed25519", then the 32 key bytes.
const u32 = (n: number): Uint8Array =>
	Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const field = (bytes: Uint8Array): Uint8Array => {
	const out = new Uint8Array(4 + bytes.length);
	out.set(u32(bytes.length), 0);
	out.set(bytes, 4);
	return out;
};
export const keyLineText = (key: Uint8Array): string => {
	const type = field(new TextEncoder().encode("ssh-ed25519"));
	const blob = new Uint8Array(type.length + 36);
	blob.set(type, 0);
	blob.set(field(key), type.length);
	return `ssh-ed25519 ${Buffer.from(blob).toString("base64")}`;
};
export const keyLineArb: fc.Arbitrary<string> = fc
	.uint8Array({minLength: 32, maxLength: 32})
	.map(keyLineText);

/** Names a person may type: nonblank, with spaces, accents and XML-sensitive marks. */
export const nameArb: fc.Arbitrary<string> = fc
	.string({minLength: 1, maxLength: 40, unit: "grapheme"})
	.filter((s) => s.trim().length > 0);
export const blankArb: fc.Arbitrary<string> = fc.constantFrom("", " ", "\t", "  \n ");

// UUIDv7 in Crockford base32, RFC 9562 5.7, the shape main's ProcessIdGenerator writes.
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const encode = (at: number, random: bigint): string => {
	const low62 = (1n << 62n) - 1n;
	let uuid =
		(BigInt(at) << 80n) | (7n << 76n) | ((random >> 62n) << 64n) | (2n << 62n) | (random & low62);
	let suffix = "";
	for (let i = 0; i < 26; i++) {
		suffix = ALPHABET[Number(uuid & 31n)] + suffix;
		uuid >>= 5n;
	}
	return suffix;
};

/** A TypeID as main's encoders write it: `<prefix>_` and 26 Crockford base32 characters. */
export const typeIdArb = (prefix: string): fc.Arbitrary<string> =>
	fc
		.tuple(fc.integer({min: 0, max: 2 ** 48 - 1}), fc.bigInt({min: 0n, max: (1n << 74n) - 1n}))
		.map(([at, random]) => `${prefix}_${encode(at, random)}`);

/** A window's canonical public key: 32 raw Ed25519 bytes in base64url, no padding (P14). */
export const windowKeyArb: fc.Arbitrary<string> = fc
	.uint8Array({minLength: 32, maxLength: 32})
	.map((bytes) => Buffer.from(bytes).toString("base64url"));

/** A public founding value, as the plan's `Founding` shape gives it, before any decode. */
export const foundingArb = fc.record({
	v: fc.constant(1 as const),
	person: typeIdArb("person"),
	name: nameArb,
	keys: fc.tuple(keyLineArb).map((keys): ReadonlyArray<string> => keys),
	window: windowKeyArb,
});
export type FoundingValue = typeof foundingArb extends fc.Arbitrary<infer A> ? A : never;

/** A stand-in IdGenerator from a fixed clock and counter, so a red run repeats. */
const testIds = (
	start = 1_800_000_000_000,
): Effect.Effect<Context.Service.Shape<typeof IdGenerator>> =>
	Effect.gen(function* () {
		const counter = yield* Ref.make(0n);
		return {
			next: <K extends string>(schema: IdSchema<K>) =>
				Ref.getAndUpdate(counter, (n) => n + 1n).pipe(
					Effect.flatMap((n) =>
						Schema.decodeUnknownEffect(schema)(`${schema.prefix}_${encode(start, n)}`),
					),
					Effect.orDie,
				),
		};
	});

/** P12's data under a home, as its branch writes it: ledger state a founding page must not hide. */
export const P12_DATA: ReadonlyArray<string> = ["stage.json", "brain.pending.jsonl", ".alchemy"];
/** Chromium's own cache, which alone never means a ledger exists. */
export const CHROMIUM_CACHE: ReadonlyArray<string> = ["userData/Cache", "userData/GPUCache"];

/** A short temp home, as the brief asks, removed when the scope closes. */
export const tempHome: Effect.Effect<string, never, Scope.Scope> = Effect.acquireRelease(
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return yield* fs.makeTempDirectory({directory: "/tmp", prefix: "fh."});
	}).pipe(Effect.orDie),
	(home) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* fs.remove(home, {recursive: true, force: true}).pipe(Effect.ignore);
		}),
).pipe(Effect.provide(NodeServices.layer));

/** Every file below `dir`, relative to it, sorted. */
export const filesBelow = (dir: string): Effect.Effect<ReadonlyArray<string>> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const all = yield* fs.readDirectory(dir, {recursive: true});
		const files: Array<string> = [];
		for (const name of all) {
			const info = yield* fs.stat(path.join(dir, name));
			if (info.type === "File") files.push(name);
		}
		return files.sort();
	}).pipe(Effect.orDie, Effect.provide(NodeServices.layer));

/** The product's modules a fixture composes, loaded by the test. */
export type Modules = {
	// `node/desktop-store.ts`'s export, typed here by the plan's contract, since a lower folder's
	// support may not name an upper folder's module.
	readonly fileDesktopStore: (options: {
		readonly home: string;
	}) => Layer.Layer<
		DesktopStore | KeyStore,
		never,
		Seal | IdGenerator | FileSystem.FileSystem | Path.Path
	>;
	readonly Seal: typeof Seal;
	readonly IdGenerator: typeof IdGenerator;
	readonly LaunchControl: typeof LaunchControl;
	readonly BrainProbe: typeof BrainProbe;
	readonly ServiceState: typeof ServiceState;
	readonly DesktopRecording: typeof DesktopRecording;
	readonly DesktopDown: typeof DesktopDown;
};

/** How the stand-ins answer, each list read in order, its last answer kept once it runs out. */
export type Script = {
	readonly loaded?: Option.Option<{
		readonly executable: string;
		readonly args: ReadonlyArray<string>;
	}>;
	/** How many `print`s still show the label after a `bootout` returns (experiment 214). */
	readonly lingers?: number;
	readonly bootstrap?: ReadonlyArray<Why | "ok">;
	readonly bootout?: ReadonlyArray<Why | "ok">;
	readonly print?: ReadonlyArray<Why | "ok">;
	readonly ready?: ReadonlyArray<boolean | Why>;
	readonly stopped?: ReadonlyArray<boolean | Why>;
	readonly record?: ReadonlyArray<Why | "ok">;
	readonly seal?: {readonly available?: boolean};
	/** The stand-in ID clock, so two fixtures on one home mint different IDs, as two processes would. */
	readonly idClock?: number;
};

export type Call = {readonly op: string; readonly label?: string; readonly plist?: string};

export const desktopFixture = (
	mods: Modules,
	script: Script = {},
	given?: string,
): Effect.Effect<
	{
		readonly home: string;
		readonly store: Layer.Layer<DesktopStore | KeyStore>;
		readonly seal: Layer.Layer<Seal>;
		readonly sealer: Effect.Success<ReturnType<typeof testSeal>>;
		readonly launch: Layer.Layer<LaunchControl>;
		readonly probe: Layer.Layer<BrainProbe>;
		readonly records: Layer.Layer<DesktopRecording>;
		readonly recorded: Effect.Effect<ReadonlyArray<typeof DesktopObservation.Type>>;
		readonly calls: Effect.Effect<ReadonlyArray<Call>>;
	},
	never,
	Scope.Scope
> =>
	Effect.gen(function* () {
		const home = given ?? (yield* tempHome);
		const log = yield* Ref.make<ReadonlyArray<Call>>([]);
		const call = (c: Call) => Ref.update(log, (all) => [...all, c]);
		const answers = new Map<string, Ref.Ref<number>>();
		const answer = <A>(name: string, list: ReadonlyArray<A> | undefined, fallback: A) =>
			Effect.gen(function* () {
				const at = answers.get(name) ?? (yield* Ref.make(0));
				answers.set(name, at);
				const n = yield* Ref.getAndUpdate(at, (i) => i + 1);
				return list === undefined || list.length === 0
					? fallback
					: (list[Math.min(n, list.length - 1)] ?? fallback);
			});
		const fail = (why: Why) => Effect.fail(new mods.DesktopDown({why}));

		const sealer = yield* testSeal(mods.DesktopDown, script.seal);
		const seal = Layer.succeed(mods.Seal, sealer.impl);
		const ids = Layer.succeed(mods.IdGenerator, yield* testIds(script.idClock));
		const store = mods
			.fileDesktopStore({home})
			.pipe(Layer.provide(Layer.mergeAll(seal, ids, NodeServices.layer)));

		const loaded = yield* Ref.make(script.loaded ?? Option.none());
		const lingering = yield* Ref.make(0);
		const state = (spec: Spec): Effect.Effect<State> =>
			Ref.get(loaded).pipe(
				Effect.map(
					Option.match({
						onNone: () => mods.ServiceState.cases.absent.make({}),
						onSome: (job) =>
							mods.ServiceState.cases.loaded.make({
								pid: 4242,
								executable: job.executable,
								args: [...job.args],
							}),
					}),
				),
				Effect.tap(() => call({op: "print", label: spec.label})),
			);
		const launch = Layer.succeed(mods.LaunchControl, {
			print: (spec) =>
				Effect.gen(function* () {
					const said = yield* answer("print", script.print, "ok" as const);
					if (said !== "ok") return yield* fail(said);
					const left = yield* Ref.getAndUpdate(lingering, (n) => Math.max(0, n - 1));
					if (left === 1) yield* Ref.set(loaded, Option.none());
					return yield* state(spec);
				}),
			bootstrap: (spec, plist) =>
				Effect.gen(function* () {
					yield* call({op: "bootstrap", label: spec.label, plist});
					const said = yield* answer("bootstrap", script.bootstrap, "ok" as const);
					if (said !== "ok") return yield* fail(said);
					yield* Ref.set(loaded, Option.some({executable: spec.executable, args: [spec.entry]}));
				}),
			bootout: (spec) =>
				Effect.gen(function* () {
					yield* call({op: "bootout", label: spec.label});
					const said = yield* answer("bootout", script.bootout, "ok" as const);
					if (said !== "ok") return yield* fail(said);
					const lingers = script.lingers ?? 0;
					if (lingers === 0) yield* Ref.set(loaded, Option.none());
					else yield* Ref.set(lingering, lingers + 1);
				}),
		});
		const probe = Layer.succeed(mods.BrainProbe, {
			ready: (spec) =>
				Effect.gen(function* () {
					yield* call({op: "ready", label: spec.label});
					const said = yield* answer("ready", script.ready, true);
					return typeof said === "boolean" ? said : yield* fail(said);
				}),
			stopped: (spec) =>
				Effect.gen(function* () {
					yield* call({op: "stopped", label: spec.label});
					const said = yield* answer("stopped", script.stopped, true);
					return typeof said === "boolean" ? said : yield* fail(said);
				}),
		});
		const rows = yield* Ref.make<ReadonlyArray<typeof DesktopObservation.Type>>([]);
		const records = Layer.succeed(mods.DesktopRecording, {
			put: (value) =>
				Effect.gen(function* () {
					yield* call({op: `record:${value.action}:${value.answer}`});
					const said = yield* answer("record", script.record, "ok" as const);
					if (said !== "ok") return yield* fail(said);
					yield* Ref.update(rows, (all) => [...all, value]);
				}),
			flush: call({op: "flush"}),
		});
		return {
			home,
			store,
			seal,
			sealer,
			launch,
			probe,
			records,
			recorded: Ref.get(rows),
			calls: Ref.get(log),
		};
	});
