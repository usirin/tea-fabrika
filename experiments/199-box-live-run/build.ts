// Experiment 199's build: the Worker, one file, dist/worker.mjs, which the stack hands Alchemy.
// It imports nothing from the repo, so esbuild only strips the types and keeps the platform's names.
import {mkdirSync} from "node:fs";
import {join} from "node:path";
import {build} from "esbuild";

const here = import.meta.dirname;

export const buildWorker = async () => {
	const out = join(here, "dist", "worker.mjs");
	mkdirSync(join(here, "dist"), {recursive: true});
	const r = await build({
		entryPoints: [join(here, "worker.ts")],
		outfile: out,
		bundle: true,
		platform: "neutral",
		format: "esm",
		target: "es2024",
		external: ["cloudflare:*"],
		metafile: true,
		logLevel: "warning",
	});
	return {bytes: Object.values(r.metafile.outputs).reduce((n, o) => n + o.bytes, 0)};
};
