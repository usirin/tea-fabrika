// Experiment 148's build: the Worker, one file, dist/worker.mjs, which the stack hands Alchemy.
//
//   node experiments/148-remote-programs/build.ts
//
// esbuild bundles worker.ts for workerd: the host (host/session.ts), tsh and its programs from
// @kampus/fabrika, the counter from programs/counter, and the ledger's Durable Object from
// packages/fabrika. Effect, tea and @kampus/fabrika resolve from the repo's root, so there is one
// copy of each. Anything the bundle still imports from node: is listed in dist/meta.json: that is
// what in the host code does not fit a Durable Object as it is.
import {mkdirSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {build} from "esbuild";

const here = import.meta.dirname;
const root = resolve(here, "../..");

export const buildWorker = async () => {
	const out = join(here, "dist", "worker.mjs");
	mkdirSync(dirname(out), {recursive: true});
	const result = await build({
		entryPoints: [join(here, "worker.ts")],
		outfile: out,
		bundle: true,
		platform: "neutral",
		format: "esm",
		target: "es2024",
		conditions: ["workerd", "worker", "browser"],
		mainFields: ["module", "main"],
		external: ["cloudflare:*", "node:*"],
		metafile: true,
		logLevel: "warning",
		plugins: [
			{
				name: "exp148",
				setup(b) {
					b.onResolve({filter: /^@tea-fabrika\/counter$/}, () => ({
						path: join(root, "programs", "counter", "src", "index.ts"),
					}));
					// One copy of each: resolved from the repo's root, whoever imports it.
					b.onResolve({filter: /^(effect|@effect\/|@demlik\/|@kampus\/)/}, async (args) => {
						if (args.pluginData === "exp148") return undefined;
						const r = await b.resolve(args.path, {
							kind: args.kind,
							resolveDir: root,
							pluginData: "exp148",
						});
						return r.errors.length > 0 ? undefined : {path: r.path};
					});
				},
			},
		],
	});
	const nodeImports = new Set<string>();
	for (const o of Object.values(result.metafile.outputs))
		for (const i of o.imports) if (i.path.startsWith("node:")) nodeImports.add(i.path);
	const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
	const meta = {bytes, nodeImports: [...nodeImports].sort()};
	writeFileSync(join(here, "dist", "meta.json"), JSON.stringify(meta, null, "\t"));
	return {out, ...meta};
};

if (import.meta.main) {
	console.log(JSON.stringify(await buildWorker()));
}
