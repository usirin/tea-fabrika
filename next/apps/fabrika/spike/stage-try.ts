// Experiment 248 spike: start the real local stage with the ported RecordPart, call it, stop.
import {mkdtempSync, readdirSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {NodeServices} from "@effect/platform-node";
import {Effect} from "effect";
import {SecureRandom} from "effect/crypto";

import {generateKeyPairSync} from "node:crypto";

const pair = generateKeyPairSync("ed25519"),
	rawKey = pair.publicKey.export({format: "jwk"}).x!;

const field = (value: Buffer | string) => {
	const body = Buffer.from(value),
		n = Buffer.alloc(4);
	n.writeUInt32BE(body.length);
	return Buffer.concat([n, body]);
};

const line = `ssh-ed25519 ${Buffer.concat([field("ssh-ed25519"), field(Buffer.from(rawKey, "base64url"))]).toString("base64")}`;
process.env.DO_NOT_TRACK = "1";
const home = mkdtempSync(join(tmpdir(), "fh-"));
process.env.FABRIKA_HOME = home;
const {localState} = await import("alchemy/State/LocalState");
const {build} = await import("../src/build.ts");
const {localStage} = await import("../src/local-stage.ts");
const t0 = Date.now();

const main = Effect.gen(function* () {
	const built = yield* build({out: join(home, "dist")});
	const t1 = Date.now();
	const stage = yield* localStage(built, {
		home,
		name: "spike",
		person: "person_01m6v5270hf3c8x2q7w9z4k5mn",
		founder: line,
		window: rawKey,
		port: Number(process.env.SPIKE_PORT ?? 18941),
	} as never);
	console.log(JSON.stringify({probe: "stage.started", buildMs: t1 - t0, startMs: Date.now() - t1}));
	const info = yield* Effect.promise(() => Reflect.get(stage.project("spike"), "info")());
	console.log(JSON.stringify({probe: "project.info", value: info}).slice(0, 300));
	const record = stage.record("spike", "spans/0") as Record<
		string,
		(...a: Array<unknown>) => Promise<unknown>
	>;
	const read = yield* Effect.promise(() =>
		record.read!({_tag: "spans"}, 0, 0).then(
			(value) => ({value}),
			(error) => ({error: String(error)}),
		),
	);
	console.log(JSON.stringify({probe: "record.read", value: read}).slice(0, 400));
	const bad = yield* Effect.promise(() =>
		record.read!({_tag: "spans"}, 7, 0).then(
			(value) => ({value}),
			(error) => ({error: String(error)}),
		),
	);
	console.log(JSON.stringify({probe: "record.read.wrong-part", value: bad}).slice(0, 400));
}).pipe(
	Effect.scoped,
	Effect.provide(localState()),
	Effect.provide(SecureRandom.layerWebCrypto),
	Effect.provide(NodeServices.layer),
);

await Effect.runPromise(main).catch((error) => {
	console.log(
		JSON.stringify({
			probe: "failed",
			value: String(error).slice(0, 400),
			json: JSON.stringify(error)?.slice(0, 600),
		}),
	);
	const dir = join(home, ".alchemy/log/local");

	for (const f of readdirSync(dir, {recursive: true}) as Array<string>) {
		try {
			console.log("LOG", f, readFileSync(join(dir, f), "utf8").slice(-1800));
		} catch {}
	}
});

process.exit(0);
