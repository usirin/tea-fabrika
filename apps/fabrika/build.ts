import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {layer as nodeFileSystem} from "@effect/platform-node/NodeFileSystem";
import {layer as nodePath} from "@effect/platform-node/NodePath";
import {runMain} from "@effect/platform-node/NodeRuntime";
import {Effect, FileSystem, Layer, Path} from "effect";
import {type BuildOptions, build} from "esbuild";
import {bundlesOf, common} from "./bundles.ts";

// Build the app into dist/, with esbuild: four bundles (bundles.ts) and the page's plain files.
//
//   dist/main.mjs      the main process: ESM for Electron's Node 24, with electron left out
//   dist/host.mjs      the host process: ESM for the same Node, run by Electron's binary as Node
//   dist/preload.cjs   the preload: CommonJS, as a sandboxed preload must be
//   dist/desk.js       the one page: the desk, ghostty-web with its WebAssembly, React and every
//                      program view it knows, for Chromium
//   dist/desk.html, dist/window.css   the page's stylesheet: Manti UI's, React Flow's base rules,
//                      then fabrika's theme on Manti's tokens and the app's own rules
//
// Every bundle gets the same build id, as the define `FABRIKA_BUILD` (src/build-id.ts): the first
// 12 hex of a SHA-256 over every source file the four bundles are made from, by name and bytes. So
// the same code builds to the same id, and any change to it, a dependency's too, to another. The
// host names it in its hello, and the app compares it with its own. esbuild says which files a
// bundle takes (its metafile), so the bundles are read once without writing, for the list, then
// built. Node's own `node:crypto` makes the hash, and `node:url` turns a resolved package file into a
// path: this script is an edge.
//
// The WebAssembly is in desk.js twice, about 560 KiB each: ghostty-web's own bundle holds it
// as a data: url, which the page cannot fetch, and the bytes the page compiles are a second copy
// (src/window/terminal.ts). It is read from disk, so the cost is size, not time on a network.
//
// `pnpm --filter @kampus/fabrika-app build`, or `start`, which builds and opens the app.

const here = import.meta.dirname;

/** React Flow's base rules: the map's canvas needs them, and the app's styles go on top. */
const FLOW_CSS = "@xyflow/react/dist/base.css";

/** Manti UI's stylesheet: its parts, in cascade layers, so the app's unlayered rules win. */
const MANTI_CSS = "@manti-ui/styles/index.css";

const bundle = (options: BuildOptions) =>
	Effect.tryPromise({
		try: () => build({...common(here), ...options}),
		catch: (cause) => new Error(`esbuild could not build ${options.outfile}`, {cause}),
	});

const program = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const at = (...parts: string[]) => path.join(here, ...parts);
	const bundles = bundlesOf(at);

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
			// One stylesheet, as the page's policy serves only that: Manti's, layered, then React
			// Flow's own rules for the map program's canvas, then fabrika's theme, which sets Manti's
			// tokens from the app's values, and the app's rules, which restyle the rest.
			Effect.gen(function* () {
				const read = (pkg: string) => fs.readFileString(fileURLToPath(import.meta.resolve(pkg)));
				const manti = yield* read(MANTI_CSS);
				const flow = yield* read(FLOW_CSS);
				const theme = yield* fs.readFileString(at("src/window/theme.css"));
				const own = yield* fs.readFileString(at("src/window/window.css"));
				yield* fs.writeFileString(at("dist/window.css"), `${manti}\n${flow}\n${theme}\n${own}`);
			}),
		],
		{concurrency: "unbounded", discard: true},
	);
	yield* Effect.logInfo(`fabrika app: built ${id}`);
}).pipe(Effect.provide(Layer.mergeAll(nodeFileSystem, nodePath)));

runMain(program);
