import {createHash} from "node:crypto";
import {layer as nodeFileSystem} from "@effect/platform-node/NodeFileSystem";
import {layer as nodePath} from "@effect/platform-node/NodePath";
import {runMain} from "@effect/platform-node/NodeRuntime";
import {Effect, FileSystem, Layer, Path} from "effect";
import {type BuildOptions, build} from "esbuild";

// Build the app into dist/, with esbuild: four bundles and the page's plain files.
//
//   dist/main.mjs      the main process: ESM for Electron's Node 24, with electron left out
//   dist/host.mjs      the host process: ESM for the same Node, run by Electron's binary as Node
//   dist/preload.cjs   the preload: CommonJS, as a sandboxed preload must be
//   dist/desk.js       the one page: the desk, ghostty-web with its WebAssembly, React and every
//                      program view it knows, for Chromium
//   dist/desk.html, dist/window.css
//
// Every bundle gets the same build id, as the define `FABRIKA_BUILD` (src/build-id.ts): the first
// 12 hex of a SHA-256 over every source file the four bundles are made from, by name and bytes. So
// the same code builds to the same id, and any change to it, a dependency's too, to another. The
// host names it in its hello, and the app compares it with its own. esbuild says which files a
// bundle takes (its metafile), so the bundles are read once without writing, for the list, then
// built. Node's own `node:crypto` makes the hash: this script is an edge.
//
// The WebAssembly is in desk.js twice, about 560 KiB each: ghostty-web's own bundle holds it
// as a data: url, which the page cannot fetch, and the bytes the page compiles are a second copy
// (src/window/terminal.ts). It is read from disk, so the cost is size, not time on a network.
//
// `pnpm --filter @kampus/fabrika-app build`, or `start`, which builds and opens the app.

const here = import.meta.dirname;

/** Some of what the bundles hold is CommonJS and calls `require`; ESM has none of its own. */
const REQUIRE =
	'import {createRequire} from "node:module"; const require = createRequire(import.meta.url);';

const bundle = (options: BuildOptions) =>
	Effect.tryPromise({
		try: () =>
			build({
				bundle: true,
				logLevel: "warning",
				legalComments: "none",
				absWorkingDir: here,
				...options,
			}),
		catch: (cause) => new Error(`esbuild could not build ${options.outfile}`, {cause}),
	});

const program = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const at = (...parts: string[]) => path.join(here, ...parts);
	const bundles: readonly BuildOptions[] = [
		{
			entryPoints: [at("src/main.ts")],
			outfile: at("dist/main.mjs"),
			platform: "node",
			format: "esm",
			target: "node24",
			external: ["electron"],
			banner: {js: REQUIRE},
		},
		{
			entryPoints: [at("src/host/main.ts")],
			outfile: at("dist/host.mjs"),
			platform: "node",
			format: "esm",
			target: "node24",
			// Run as plain Node: nothing of Electron is there to be imported.
			banner: {js: REQUIRE},
		},
		{
			entryPoints: [at("src/preload.ts")],
			outfile: at("dist/preload.cjs"),
			platform: "node",
			format: "cjs",
			target: "node24",
			external: ["electron"],
		},
		{
			entryPoints: [at("src/window/desk.tsx")],
			outfile: at("dist/desk.js"),
			platform: "browser",
			format: "iife",
			target: "chrome140",
			jsx: "automatic",
			minify: true,
			loader: {".wasm": "binary"},
			define: {"process.env.NODE_ENV": '"production"'},
		},
	];

	// Which files the bundles are made from: read, not written.
	const metas = yield* Effect.all(
		bundles.map((b) => bundle({...b, write: false, metafile: true})),
		{concurrency: "unbounded"},
	);
	const inputs = [...new Set(metas.flatMap((m) => Object.keys(m.metafile?.inputs ?? {})))].sort();
	const hash = createHash("sha256");
	for (const input of inputs) {
		hash.update(`${input}\0`);
		// A name esbuild made up, with no file behind it, counts by its name alone.
		const file = path.resolve(here, input);
		if (yield* fs.exists(file)) hash.update(yield* fs.readFile(file));
	}
	const id = hash.digest("hex").slice(0, 12);

	yield* fs.makeDirectory(at("dist"), {recursive: true});
	yield* Effect.all(
		[
			...bundles.map((b) =>
				bundle({...b, define: {...b.define, FABRIKA_BUILD: JSON.stringify(id)}}),
			),
			fs.copyFile(at("src/window/desk.html"), at("dist/desk.html")),
			fs.copyFile(at("src/window/window.css"), at("dist/window.css")),
		],
		{concurrency: "unbounded", discard: true},
	);
	yield* Effect.logInfo(`fabrika app: built ${id}`);
}).pipe(Effect.provide(Layer.mergeAll(nodeFileSystem, nodePath)));

runMain(program);
