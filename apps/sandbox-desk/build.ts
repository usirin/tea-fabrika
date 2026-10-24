// Node edge: make the browser-independent host portable without copying a macOS dependency tree.
import {cp, mkdir} from "node:fs/promises";
import {build} from "esbuild";

await mkdir("dist/app/src", {recursive: true});
await build({
	entryPoints: ["../browser-desk/src/main.ts"],
	outfile: "dist/app/src/main.mjs",
	bundle: true,
	platform: "node",
	format: "esm",
	external: ["@lydell/node-pty"],
	banner: {
		js: 'import {createRequire} from "node:module"; const require = createRequire(import.meta.url);',
	},
});
await build({
	entryPoints: [
		new URL("./sqlite-worker.ts", import.meta.resolve("@kampus/fabrika/sqlite")).pathname,
	],
	outfile: "dist/app/src/sqlite-worker.ts",
	bundle: true,
	platform: "node",
	format: "esm",
});
await cp("../browser-desk/index.html", "dist/app/index.html");
await cp("../browser-desk/dist", "dist/app/dist", {recursive: true});
await build({
	entryPoints: ["src/runtime.ts"],
	outfile: "dist/runtime.mjs",
	platform: "node",
	format: "esm",
});
