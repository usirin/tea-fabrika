// Node edge: esbuild bundles the same-package React windows and their CSS for the browser.
import {build} from "esbuild";

await build({
	entryPoints: ["src/client.tsx"],
	bundle: true,
	outdir: "dist",
	platform: "browser",
	format: "esm",
	jsx: "automatic",
	sourcemap: true,
	minify: true,
	define: {"process.env.NODE_ENV": '"production"'},
	metafile: true,
}).then(async (result) => {
	const {writeFile} = await import("node:fs/promises");
	await writeFile("dist/meta.json", JSON.stringify(result.metafile, null, 2));
});
