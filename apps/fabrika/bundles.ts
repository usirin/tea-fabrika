import type {BuildOptions} from "esbuild";

// The app's four bundles, as esbuild builds them (build.ts says what each one is). Their own
// file, so build.ts builds them and src/bundles.test.ts builds them the same way, without writing:
// a page that reaches Node's own modules fails the test, not the app's start.

/**
 * Some of what the bundles hold is CommonJS and calls `require`; ESM has none of its own. The
 * import takes a name of its own: esbuild does not read a banner, so a bundled file that imports
 * `createRequire` itself (@effect/platform-node's http client does) would declare it twice, and
 * the bundle would not load.
 */
const REQUIRE =
	'import {createRequire as bannerRequire} from "node:module"; const require = bannerRequire(import.meta.url);';

/** The bundles. `at`: a path inside the app's folder, made whole. */
export const bundlesOf = (at: (...parts: string[]) => string): readonly BuildOptions[] => [
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

/** What every bundle shares. `here`: the app's folder. */
export const common = (here: string): BuildOptions => ({
	bundle: true,
	logLevel: "warning",
	legalComments: "none",
	absWorkingDir: here,
});
