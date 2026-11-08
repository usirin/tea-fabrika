// P19, next/. The two sealed keys (plan "Keys and sealing" and "Laws"): failed opens and rotation
// keep the old files and make no key, the person key opens only to sign, p44 against the real
// `ssh-keygen` both ways, and no private text or sealed byte reaches an output.
//
// The store runs for real (`fileDesktopStore`) on a short temp home, with the stand-in seal. With
// no `ssh-keygen` the p44 law fails loudly, never skips. Modules load per law, so a missing export
// fails that law alone.
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {NodeServices} from "@effect/platform-node";
import {describe, expect, it} from "@effect/vitest";
import type {Scope} from "effect";
import {Effect, Exit, FileSystem, Layer} from "effect";
import * as fc from "fast-check";
import type * as IdModule from "../data/id.ts";
import {checkSshsig, writeSshsig} from "../transport/sshsig.ts";
import type * as Brain from "./brain-service.ts";
import {
	desktopFixture,
	filesBelow,
	nameArb,
	SEED,
	type Modules,
	type Script,
	TEST_SEAL_HEAD,
} from "./desktop.test-support.ts";
import type * as FoundingModule from "./founding.ts";
import type * as KeysModule from "./keys.ts";
import type * as Recording from "./recording.ts";

const load = async <T>(spec: string, path: string, names: ReadonlyArray<keyof T>): Promise<T> => {
	const mod: Partial<T> = await import(/* @vite-ignore */ spec).catch((cause: unknown) => {
		throw new Error(`P19 missing module ${path} (${String(cause)})`);
	});
	for (const name of names)
		if (mod[name] === undefined) throw new Error(`P19 missing export ${String(name)} from ${path}`);
	return mod as T;
};
const modules = async () => {
	const keys = await load<typeof KeysModule>("./keys.ts", "desktop/keys.ts", [
		"Seal",
		"KeyStore",
		"PersonKey",
		"sealedPersonKey",
		"KeyRole",
	]);
	const f = await load<typeof FoundingModule>("./founding.ts", "desktop/founding.ts", [
		"DesktopStore",
		"DesktopDown",
	]);
	const b = await load<typeof Brain>("./brain-service.ts", "desktop/brain-service.ts", [
		"LaunchControl",
		"BrainProbe",
		"ServiceState",
	]);
	const r = await load<typeof Recording>("./recording.ts", "desktop/recording.ts", [
		"DesktopRecording",
	]);
	const s = await load<Pick<Modules, "fileDesktopStore">>(
		"../node/desktop-store.ts",
		"node/desktop-store.ts",
		["fileDesktopStore"],
	);
	const ids = await load<typeof IdModule>("../data/id.ts", "data/id.ts (upstream P14)", [
		"IdGenerator",
	]);
	return {
		keys,
		f,
		fixture: (script?: Script, home?: string) =>
			desktopFixture(
				{
					fileDesktopStore: s.fileDesktopStore,
					Seal: keys.Seal,
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

const run = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(NodeServices.layer)));

/** Each file below the home with its bytes, so a test can see that nothing changed. */
const snapshot = (home: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const out = new Map<string, string>();
		for (const name of yield* filesBelow(home))
			out.set(name, Buffer.from(yield* fs.readFile(`${home}/${name}`)).toString("base64"));
		return out;
	}).pipe(Effect.orDie);

const sealedFiles = (snap: ReadonlyMap<string, string>) =>
	[...snap].filter(([, b64]) =>
		Buffer.from(b64, "base64").toString("latin1").startsWith(TEST_SEAL_HEAD),
	);

/** Found a home, then hand back the open services over it. */
const founded = (m: Mods, name: string, script?: Script) =>
	Effect.gen(function* () {
		const fx = yield* m.fixture(script);
		const founder = yield* Effect.gen(function* () {
			return yield* (yield* m.f.DesktopStore).found(name);
		}).pipe(Effect.provide(fx.store));
		return {fx, founder};
	});

const keyStore = (m: Mods, store: Layer.Layer<KeysModule.KeyStore | FoundingModule.DesktopStore>) =>
	Effect.gen(function* () {
		return yield* m.keys.KeyStore;
	}).pipe(Effect.provide(store));

describe("P19 keys: failed opens and rotation", () => {
	const RUNS = {seed: SEED, numRuns: 25};
	const corruption = fc.oneof(
		fc.uint8Array({maxLength: 200}),
		fc.constant(new Uint8Array()),
		fc.nat({max: 63}).map((flip) => ({flip})),
	);

	it("plant, catch a decrypt failure by generating: a corrupt sealed key fails typed, keeps every file and mints no key", async () => {
		const m = await modules();
		await fc.assert(
			fc.asyncProperty(nameArb, corruption, fc.boolean(), async (name, bad, person) => {
				await run(
					Effect.gen(function* () {
						const fs = yield* FileSystem.FileSystem;
						const {fx} = yield* founded(m, name);
						const before = yield* snapshot(fx.home);
						const sealed = sealedFiles(before);
						expect(sealed.length, "two private halves, each sealed").toBe(2);
						const [target, b64] = sealed[person ? 0 : 1]!;
						const old = Buffer.from(b64, "base64");
						const next =
							bad instanceof Uint8Array
								? bad
								: Uint8Array.from(old, (byte, i) =>
										i === bad.flip % old.length ? byte ^ 1 : byte,
									);
						yield* fs.writeFile(`${fx.home}/${target}`, next);
						const damaged = yield* snapshot(fx.home);
						const ks = yield* keyStore(m, fx.store);
						const publics = yield* Effect.forEach(
							["person", "window"] as const,
							(role) => Effect.exit(ks.publicKey(role)),
							{concurrency: 1},
						);
						const signs = yield* Effect.forEach(
							["person", "window"] as const,
							(role) => Effect.exit(ks.sign(role, new Uint8Array([1, 2, 3]))),
							{concurrency: 1},
						);
						// Public halves read without opening; a sign over the damaged half fails typed.
						for (const exit of publics) expect(Exit.isSuccess(exit)).toBe(true);
						const failed = signs.filter(Exit.isFailure);
						expect(failed.length).toBeGreaterThanOrEqual(1);
						for (const exit of failed) {
							expect(Exit.hasDies(exit)).toBe(false);
							expect(JSON.stringify(exit)).toMatch(/bad_key|crypto|storage/);
						}
						expect(yield* snapshot(fx.home)).toEqual(damaged);
						expect((yield* fx.sealer.calls).filter((c) => c === "encrypt")).toHaveLength(2);
					}),
				);
			}),
			RUNS,
		);
	});

	it("plant, replace before sealing succeeds: a failed reseal on rotation leaves the old ciphertext, a good one keeps the same key", async () => {
		const m = await modules();
		const failure = fc.constantFrom("crypto", "storage", "seal_unavailable") as fc.Arbitrary<
			FoundingModule.DesktopDown["why"]
		>;
		await fc.assert(
			fc.asyncProperty(nameArb, fc.option(failure, {nil: null}), async (name, why) => {
				await run(
					Effect.gen(function* () {
						const {fx} = yield* founded(m, name);
						const ks = yield* keyStore(m, fx.store);
						const before = yield* snapshot(fx.home);
						const key = yield* ks.publicKey("person");
						yield* fx.sealer.rotateNext;
						const calls = (yield* fx.sealer.calls).length;
						if (why !== null) {
							// The decrypt answers rotate; the reseal after it fails.
							yield* fx.sealer.failNext(why, "encrypt");
							const signed = yield* Effect.exit(ks.sign("person", new Uint8Array([9])));
							expect(Exit.hasDies(signed)).toBe(false);
						} else yield* ks.sign("person", new Uint8Array([9]));
						const after = (yield* fx.sealer.calls).slice(calls);
						expect(after[0]).toBe("decrypt");
						expect(yield* snapshot(fx.home)).toEqual(before);
						expect((yield* ks.publicKey("person")).key).toBe(key.key);
						if (why === null) expect(after).toContain("encrypt");
					}),
				);
			}),
			RUNS,
		);
	});
});

describe("P19 keys: the person key opens only to sign", () => {
	type Op =
		| {readonly op: "public"; readonly role: "person" | "window"}
		| {readonly op: "line"}
		| {readonly op: "sign"; readonly role: "person" | "window"; readonly bytes: Uint8Array};
	const op: fc.Arbitrary<Op> = fc.oneof(
		fc.constantFrom("person", "window").map((role) => ({op: "public" as const, role})),
		fc.constant({op: "line" as const}),
		fc
			.tuple(fc.constantFrom("person", "window"), fc.uint8Array({maxLength: 64}))
			.map(([role, bytes]) => ({op: "sign" as const, role, bytes})),
	);

	it("plant, decrypt at startup or on a public read: no decrypt happens outside a sign, and each person sign opens it", async () => {
		const m = await modules();
		await fc.assert(
			fc.asyncProperty(nameArb, fc.array(op, {maxLength: 12}), async (name, ops) => {
				await run(
					Effect.gen(function* () {
						const {fx} = yield* founded(m, name);
						const startup = (yield* fx.sealer.calls).length;
						const ks = yield* keyStore(m, fx.store);
						const person = yield* Effect.gen(function* () {
							return yield* m.keys.PersonKey;
						}).pipe(Effect.provide(m.keys.sealedPersonKey.pipe(Layer.provide(fx.store))));
						expect((yield* fx.sealer.calls).slice(startup)).not.toContain("decrypt");
						for (const o of ops) {
							const from = (yield* fx.sealer.calls).length;
							if (o.op === "public") yield* ks.publicKey(o.role);
							else if (o.op === "line") yield* person.line;
							else if (o.role === "person") yield* person.sign(o.bytes);
							else yield* ks.sign("window", o.bytes);
							const opened = (yield* fx.sealer.calls).slice(from).filter((c) => c === "decrypt");
							if (o.op !== "sign") expect(opened, `${o.op} decrypted`).toEqual([]);
							if (o.op === "sign" && o.role === "person")
								expect(opened.length).toBeGreaterThanOrEqual(1);
						}
					}),
				);
			}),
			{seed: SEED, numRuns: 25},
		);
	});
});

describe("P19 keys: p44, the person key against the real ssh-keygen", () => {
	const SPACE = "fabrika-client";
	const keygen = (args: ReadonlyArray<string>, input?: string) => {
		const out = spawnSync("ssh-keygen", [...args], {input, encoding: "utf8"});
		if (out.error !== undefined) throw new Error(`p44 needs ssh-keygen: ${out.error.message}`);
		return out;
	};

	it("plant, wrong namespace or encoding: ssh-keygen verifies the person key's signatures, and checkSshsig takes ssh-keygen's", async () => {
		const m = await modules();
		const dir = mkdtempSync("/tmp/p44.");
		try {
			keygen(["-q", "-t", "ed25519", "-N", "", "-f", join(dir, "other"), "-C", ""]);
			const other = readFileSync(join(dir, "other.pub"), "utf8").trim();
			await fc.assert(
				fc.asyncProperty(nameArb, fc.string({maxLength: 120}), async (name, text) => {
					await run(
						Effect.gen(function* () {
							const {fx, founder} = yield* founded(m, name);
							const person = yield* Effect.gen(function* () {
								return yield* m.keys.PersonKey;
							}).pipe(Effect.provide(m.keys.sealedPersonKey.pipe(Layer.provide(fx.store))));
							const line = yield* person.line;
							expect(founder.keys).toContain(line);
							const armored = yield* writeSshsig({
								text,
								space: SPACE,
								line,
								sign: (bytes) => person.sign(bytes).pipe(Effect.orDie),
							});
							// Our signature, OpenSSH's verifier.
							writeFileSync(join(dir, "msg.sig"), armored);
							writeFileSync(join(dir, "signers"), `p19 ${line}\n`);
							const verify = (space: string) =>
								keygen(
									[
										"-Y",
										"verify",
										"-f",
										join(dir, "signers"),
										"-I",
										"p19",
										"-n",
										space,
										"-s",
										join(dir, "msg.sig"),
									],
									text,
								).status;
							expect(verify(SPACE)).toBe(0);
							expect(verify("fabrika-other")).not.toBe(0);
							// OpenSSH's signature, our checker: it names the other key, never the person.
							writeFileSync(join(dir, "msg"), text);
							keygen(["-Y", "sign", "-f", join(dir, "other"), "-n", SPACE, join(dir, "msg")]);
							const theirs = readFileSync(join(dir, "msg.sig"), "utf8");
							expect(
								yield* checkSshsig({text, armored: theirs, space: SPACE, signers: [line, other]}),
							).toEqual({
								signer: other,
							});
							expect(
								yield* checkSshsig({text, armored: theirs, space: SPACE, signers: [line]}),
							).toEqual({
								why: "bad_signature",
							});
							rmSync(join(dir, "msg.sig"), {force: true});
						}),
					);
				}),
				{seed: SEED, numRuns: 10},
			);
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});

describe("P19 keys: no private text or sealed byte in any output", () => {
	it("plant, log the decrypted value, the ciphertext or a failure's cause: errors, records, public files and answers hold none of them", async () => {
		const m = await modules();
		const why = fc.constantFrom("crypto", "storage", "bad_key") as fc.Arbitrary<
			FoundingModule.DesktopDown["why"]
		>;
		const step = fc.oneof(
			fc.constant({op: "public" as const}),
			fc.uint8Array({maxLength: 32}).map((bytes) => ({op: "sign" as const, bytes})),
			why.map((w) => ({op: "fail" as const, why: w})),
			fc.constant({op: "rotate" as const}),
		);
		await fc.assert(
			fc.asyncProperty(nameArb, fc.array(step, {maxLength: 10}), async (name, steps) => {
				await run(
					Effect.gen(function* () {
						const {fx, founder} = yield* founded(m, name);
						const ks = yield* keyStore(m, fx.store);
						const outputs: Array<string> = [JSON.stringify(founder)];
						for (const s of steps) {
							if (s.op === "fail") yield* fx.sealer.failNext(s.why);
							else if (s.op === "rotate") yield* fx.sealer.rotateNext;
							else {
								const exit = yield* Effect.exit(
									s.op === "public" ? ks.publicKey("window") : ks.sign("person", s.bytes),
								);
								outputs.push(JSON.stringify(exit), String(Exit.isFailure(exit) ? exit.cause : ""));
							}
						}
						outputs.push(JSON.stringify(yield* fx.recorded));
						const snap = yield* snapshot(fx.home);
						for (const [file, b64] of snap)
							if (!sealedFiles(new Map([[file, b64]])).length)
								outputs.push(Buffer.from(b64, "base64").toString("utf8"));
						const secrets = (yield* fx.sealer.plains).flatMap((plain) => [
							plain,
							Buffer.from(plain).toString("base64"),
						]);
						const sealed = sealedFiles(snap).map(([, b64]) => b64);
						expect(secrets.length).toBeGreaterThanOrEqual(2);
						for (const out of outputs)
							for (const secret of [...secrets, ...sealed])
								expect(out.includes(secret), "an output shows private material").toBe(false);
					}),
				);
			}),
			{seed: SEED, numRuns: 25},
		);
	});
});
