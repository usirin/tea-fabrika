// P15a, next/. This imports P14's planned launcher and runs P12's real dev.ts.
// Missing p14.test-support.ts/dev.ts is upstream absence, not a P15 red or green.
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {helloText, KeyLine, writeSshsig} from "@kampus/libfabrika/transport";
import {Context, Effect, Layer, Schema, Scope, Stream} from "effect";
import {startP12Stage, type StageDriver, StageTestDown} from "./p14.test-support.ts";

const ROOT = resolve(import.meta.dirname, "../../../..");
export const startReloadStage = (options: {
	readonly home: string;
	readonly port: number;
}): Effect.Effect<
	StageDriver & {
		readonly editProgram: (program: string, source: string) => Effect.Effect<void, StageTestDown>;
	},
	StageTestDown,
	Scope.Scope
> =>
	Effect.gen(function* () {
		const stage = yield* startP12Stage(options);
		const originals = new Map<string, string>();
		yield* Effect.addFinalizer(() =>
			Effect.forEach(
				[...originals],
				([path, source]) =>
					Effect.tryPromise({
						try: () => writeFile(path, source),
						catch: () => new StageTestDown({message: "restore test program"}),
					}),
				{concurrency: 1},
			).pipe(Effect.orDie),
		);
		return {
			...stage,
			editProgram: (program, source) =>
				Effect.gen(function* () {
					if (!/^[a-z][a-z0-9-]*$/.test(program))
						return yield* new StageTestDown({message: "invalid test program name"});
					const path = resolve(ROOT, "next/programs", program, "src/program.ts");
					if (!originals.has(path))
						originals.set(
							path,
							yield* Effect.tryPromise({
								try: () => readFile(path, "utf8"),
								catch: () => new StageTestDown({message: "read test program"}),
							}),
						);
					yield* Effect.tryPromise({
						try: () => writeFile(path, source),
						catch: () => new StageTestDown({message: "edit test program"}),
					});
				}),
		};
	});

/** A real P14 connection in Node. The key is generated in memory, never read from a key file. */
export const headless = (stage: StageDriver) =>
	Effect.gen(function* () {
		const {ClientKey, ClientConnection, IdGenerator, TabId} = yield* Effect.promise(
			() => import("@kampus/libfabrika"),
		);
		const browserEntry = "@kampus/libfabrika/browser";
		const {browserConnection} = yield* Effect.promise(() => import(browserEntry));
		const generated = yield* Effect.promise(() =>
			crypto.subtle.generateKey({name: "Ed25519"}, false, ["sign", "verify"]),
		);
		const Pair = Schema.declare(
			(value): value is CryptoKeyPair =>
				typeof value === "object" &&
				value !== null &&
				"publicKey" in value &&
				"privateKey" in value,
		);
		const pair = yield* Schema.decodeUnknownEffect(Pair)(generated).pipe(Effect.orDie);
		const raw = new Uint8Array(
			yield* Effect.promise(() => crypto.subtle.exportKey("raw", pair.publicKey)),
		);
		const field = (bytes: Uint8Array) => {
			const size = Buffer.alloc(4);
			size.writeUInt32BE(bytes.length);
			return Buffer.concat([size, bytes]);
		};
		const blob = Buffer.concat([field(new TextEncoder().encode("ssh-ed25519")), field(raw)]);
		const line = Schema.decodeUnknownSync(KeyLine)(`ssh-ed25519 ${blob.toString("base64")}`);
		const fingerprint = `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/, "")}`;
		const identity = {
			key: Buffer.from(raw).toString("base64url"),
			fingerprint,
			tab: Schema.decodeUnknownSync(TabId)("tab_01j0000000e0080000000000001"),
		};
		const key = Layer.succeed(ClientKey, {
			identity: Effect.succeed(identity),
			replace: Effect.succeed(identity),
			changes: Stream.empty,
			persist: Effect.void,
			sign: (hello) =>
				writeSshsig({
					text: helloText(hello),
					space: "fabrika-client",
					line,
					sign: (bytes) =>
						Effect.promise(
							async () =>
								new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, bytes)),
						),
				}).pipe(Effect.orDie),
		});
		const scope = yield* Scope.Scope;
		const context = yield* Layer.build(
			browserConnection(stage.url).pipe(
				Layer.provideMerge(key),
				Layer.provideMerge(IdGenerator.layer),
			),
		).pipe(Effect.provideService(Scope.Scope, scope));
		const connection = Context.get(context, ClientConnection);
		yield* Effect.addFinalizer(() => connection.close);
		// Start the real hello before the driver's public waiting-key grant.
		yield* Effect.forkChild(connection.request("window.open", {}).pipe(Effect.exit));
		yield* stage.grant(fingerprint);
		return connection;
	});

export const source = () => readFile(resolve(ROOT, "next/programs/counter/src/program.ts"), "utf8");
export const countView = Schema.Struct({
	pid: Schema.String,
	hash: Schema.String,
	update: Schema.Struct({
		type: Schema.Literal("whole"),
		rev: Schema.Int,
		ledger: Schema.Int,
		view: Schema.Struct({count: Schema.Int}),
	}),
});

// No timer polling. Completion is a checked notification on the actual connection.
export const changed = (
	connection: {
		readonly news: Stream.Stream<{readonly method: string; readonly params: Schema.Json}, unknown>;
	},
	pid: string,
) =>
	connection.news.pipe(
		Stream.filter(
			(n) =>
				n.method === "view.changed" &&
				typeof n.params === "object" &&
				n.params !== null &&
				"pid" in n.params &&
				n.params.pid === pid,
		),
		Stream.take(1),
		Stream.runCollect,
	);
