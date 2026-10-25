import {layer as nodeFileSystem} from "@effect/platform-node/NodeFileSystem";
import {layer as nodePath} from "@effect/platform-node/NodePath";
import {runMain} from "@effect/platform-node/NodeRuntime";
import {Effect, FileSystem, Layer, Path} from "effect";
import {type BuildOptions, build} from "esbuild";

// Build the app into dist/, with esbuild: four bundles and the windows' plain files.
//
//   dist/main.mjs      the main process: ESM for Electron's Node 24, with electron left out
//   dist/preload.cjs   the preload: CommonJS, as a sandboxed preload must be. Both windows use it.
//   dist/terminal.js   the terminal window: ghostty-web, with its WebAssembly in the bundle
//   dist/program.js    a program's window: React and every program window it knows, for Chromium
//   dist/terminal.html, dist/program.html, dist/window.css
//
// The WebAssembly is in terminal.js twice, about 560 KiB each: ghostty-web's own bundle holds it
// as a data: url, which the page cannot fetch, and the bytes the page compiles are a second copy
// (src/window/terminal.ts). It is read from disk, so the cost is size, not time on a network.
//
// `pnpm --filter @kampus/fabrika-app build`, or `start`, which builds and opens the app.

const here = import.meta.dirname;

const bundle = (options: BuildOptions) =>
	Effect.tryPromise({
		try: () => build({bundle: true, logLevel: "warning", legalComments: "none", ...options}),
		catch: (cause) => new Error(`esbuild could not build ${options.outfile}`, {cause}),
	});

const program = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const at = (...parts: string[]) => path.join(here, ...parts);
	yield* fs.makeDirectory(at("dist"), {recursive: true});
	yield* Effect.all(
		[
			bundle({
				entryPoints: [at("src/main.ts")],
				outfile: at("dist/main.mjs"),
				platform: "node",
				format: "esm",
				target: "node24",
				external: ["electron"],
				// Some of what the host bundles is CommonJS and calls `require`; ESM has none of its own.
				banner: {
					js: 'import {createRequire} from "node:module"; const require = createRequire(import.meta.url);',
				},
			}),
			bundle({
				entryPoints: [at("src/preload.ts")],
				outfile: at("dist/preload.cjs"),
				platform: "node",
				format: "cjs",
				target: "node24",
				external: ["electron"],
			}),
			bundle({
				entryPoints: [at("src/window/terminal.ts")],
				outfile: at("dist/terminal.js"),
				platform: "browser",
				format: "iife",
				target: "chrome140",
				minify: true,
				loader: {".wasm": "binary"},
			}),
			bundle({
				entryPoints: [at("src/window/program.tsx")],
				outfile: at("dist/program.js"),
				platform: "browser",
				format: "iife",
				target: "chrome140",
				jsx: "automatic",
				minify: true,
				define: {"process.env.NODE_ENV": '"production"'},
			}),
			fs.copyFile(at("src/window/terminal.html"), at("dist/terminal.html")),
			fs.copyFile(at("src/window/program.html"), at("dist/program.html")),
			fs.copyFile(at("src/window/window.css"), at("dist/window.css")),
		],
		{concurrency: "unbounded", discard: true},
	);
}).pipe(Effect.provide(Layer.mergeAll(nodeFileSystem, nodePath)));

runMain(program);
