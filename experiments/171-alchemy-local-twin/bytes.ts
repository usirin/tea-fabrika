// Experiment 171, question 5: does the local stage run the same bytes a deploy would upload?
// Nothing is deployed and no credential is read. Alchemy's own bundler is called the two ways its
// two providers call it, with the options both build from the same Worker props:
//
//   - deploy (WorkerProvider.ts, `prepareBundle`):           bundler.build(options)
//   - local stage (LocalWorkerProvider.ts, `runWorker`):     bundler.watch(options), first bundle
//   - `bundle: false` (both providers, Sources/Prebuilt.ts): readPrebuiltWorkerBundle({main})
//
// Then today's twin's bundle (esbuild, packages/fabrika/src/host/worker-options.ts) for scale.
// Writes the deploy bundle's files to BYTES_OUT, for the twin to serve with `bundle: false`.
// Prints one JSON line: per path, its files with their size and SHA-256, and its time.
//
//   BYTES_OUT=<temp folder> node experiments/171-alchemy-local-twin/bytes.ts
import {createHash} from "node:crypto";
import {mkdirSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {getCompatibility} from "@alchemy.run/cloudflare/Workers/Compatibility";
import {readPrebuiltWorkerBundle} from "@alchemy.run/cloudflare/Workers/Sources/Prebuilt";
import {WorkerBundle} from "@alchemy.run/cloudflare/Workers/Sources/Rolldown";
import {layer as NodeServices} from "@effect/platform-node/NodeServices";
import {COMPATIBILITY_DATE, LEDGER_ENTRY} from "@kampus/fabrika/local";
import {Effect, Option, Stream} from "effect";
import type * as Esbuild from "esbuild";

const out = process.env.BYTES_OUT;
if (out === undefined) throw new Error("BYTES_OUT is the driver's temp folder");

type File = {readonly path: string; readonly content: string | Uint8Array};
const bytesOf = (c: string | Uint8Array) => (typeof c === "string" ? Buffer.from(c) : c);
const sha = (c: string | Uint8Array) => createHash("sha256").update(bytesOf(c)).digest("hex");
const summary = (files: readonly File[]) =>
	files.map((f) => ({path: f.path, bytes: bytesOf(f.content).length, sha256: sha(f.content)}));

// The Worker's props, as `ledgerStack` declares them. A Worker declared by its props alone is an
// "external" one (alchemy src/Platform.ts sets `isExternal: true`), so no Effect entry is added.
const props = {main: LEDGER_ENTRY, compatibility: {date: COMPATIBILITY_DATE}, isExternal: true};
const optionsAt = (stage: string) => ({
	id: "Ledger",
	main: LEDGER_ENTRY,
	compatibility: getCompatibility(props),
	entry: {kind: "external" as const},
	stack: {name: "fabrika-tf-exp-171", stage},
	extraOptions: undefined,
});

const timed = <A, E, R>(eff: Effect.Effect<A, E, R>) =>
	Effect.gen(function* () {
		const t = performance.now();
		const a = yield* eff;
		return {a, ms: Math.round(performance.now() - t)};
	});

const program = Effect.gen(function* () {
	const bundler = yield* WorkerBundle;
	const deploy = yield* timed(bundler.build(optionsAt("cloud")));
	const local = yield* timed(
		bundler.watch(optionsAt("local")).pipe(
			Stream.filter((e) => e._tag === "Success"),
			Stream.runHead,
			Effect.map(Option.getOrThrow),
		),
	);
	// The deploy bundle, written as files, for `bundle: false`.
	for (const f of deploy.a.files) {
		const at = join(out, f.path);
		mkdirSync(dirname(at), {recursive: true});
		writeFileSync(at, bytesOf(f.content));
	}
	const first = deploy.a.files[0];
	if (first === undefined) return yield* Effect.die("the deploy bundle has no files");
	const prebuilt = yield* timed(readPrebuiltWorkerBundle({main: join(out, first.path)}));
	return {
		deploy: {ms: deploy.ms, hash: deploy.a.hash, files: summary(deploy.a.files)},
		local: {ms: local.ms, hash: local.a.output.hash, files: summary(local.a.output.files)},
		prebuilt: {ms: prebuilt.ms, hash: prebuilt.a.hash, files: summary(prebuilt.a.files)},
		entry: first.path,
	};
});

const alchemy = await Effect.runPromise(program.pipe(Effect.scoped, Effect.provide(NodeServices)));

// Today's twin: esbuild, the options worker-options.ts gives it.
const esbuild: typeof Esbuild = createRequire(import.meta.url)("esbuild");
const t = performance.now();
const today = await esbuild.build({
	entryPoints: [LEDGER_ENTRY],
	bundle: true,
	format: "esm",
	platform: "neutral",
	target: "es2023",
	external: ["cloudflare:*"],
	write: false,
	logLevel: "silent",
});
await esbuild.stop();
const todayMs = Math.round(performance.now() - t);
const text = today.outputFiles[0]?.text ?? "";

process.stdout.write(
	`${JSON.stringify({
		...alchemy,
		today: {
			ms: todayMs,
			files: [{path: "(one module)", bytes: Buffer.byteLength(text), sha256: sha(text)}],
		},
	})}\n`,
);
