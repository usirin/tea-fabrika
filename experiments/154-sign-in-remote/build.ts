// Experiment 154's build: the box as one file, box/box.mjs, and its image, the local twin of the
// Cloudflare container.
//
//   node experiments/154-sign-in-remote/build.ts          bundle, then `docker build`
//
// Once first: `pnpm install --ignore-workspace` in this folder, for esbuild and wrangler. Effect,
// tea and @kampus/fabrika resolve from the repo's root, one copy each (experiment 148's trick).
// Node at the edge: child_process for `docker build`.
import {execFileSync} from "node:child_process";
import {join, resolve} from "node:path";
import {build} from "esbuild";

const here = import.meta.dirname;
const root = resolve(here, "../..");

export const IMAGE = "exp154-box:local";

export const buildBox = async () => {
	const out = join(here, "box", "box.mjs");
	await build({
		entryPoints: [join(here, "box.ts")],
		outfile: out,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node26",
		logLevel: "warning",
		// A bundled CommonJS dependency may still call require.
		banner: {
			js: "import {createRequire as exp154Require} from 'node:module'; const require = exp154Require(import.meta.url);",
		},
		plugins: [
			{
				name: "exp154",
				setup(b) {
					b.onResolve({filter: /^(effect|@effect\/|@demlik\/|@kampus\/)/}, async (args) => {
						if (args.pluginData === "exp154") return undefined;
						const r = await b.resolve(args.path, {
							kind: args.kind,
							resolveDir: root,
							pluginData: "exp154",
						});
						return r.errors.length > 0 ? undefined : {path: r.path};
					});
				},
			},
		],
	});
	return out;
};

if (import.meta.main) {
	await buildBox();
	execFileSync("docker", ["build", "-q", "-t", IMAGE, "--label", "exp154=1", join(here, "box")], {
		stdio: "inherit",
	});
}
