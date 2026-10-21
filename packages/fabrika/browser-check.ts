// The top level runs anywhere: `@kampus/fabrika` bundled for a browser pulls
// in no platform. esbuild bundles `src/index.ts` with `platform: "browser"` and
// no Node shims, and every module the bundle reaches is listed. The check fails
// on any one of:
//
//   node:*, and Node's builtins by their bare names (`fs`, `path`, ...)
//   miniflare, cloudflare:*                          (the local ledger)
//   @anthropic-ai/*                                  (the Agent SDK)
//   @agentclientprotocol/*                           (ACP)
//   @opentelemetry/*, @effect/opentelemetry          (OpenTelemetry)
//   @effect/platform-node                            (Node's Effect layers)
//
// Each lives behind a subpath (`/local`, `/agents/claude`, `/agents/acp`,
// `/otel`, `/storage/node`, `/http`, `/sqlite`). A module is counted when the
// bundle reaches it at all, even if tree-shaking would drop it: a browser
// user would still have to install it. Experiment 103 made this a check, run
// by `pnpm lint` (`pnpm lint:browser`).
//
//   node packages/fabrika/browser-check.ts            # the top level
//   node packages/fabrika/browser-check.ts <entry>    # another entry, to look
//
// Node at the edge: it is a build-time script, and esbuild's API is Node's.
import {builtinModules} from "node:module";
import {relative} from "node:path";
import {build, type Plugin} from "esbuild";

const here = import.meta.dirname;
const entry = process.argv[2] ?? `${here}/src/index.ts`;

/** What the top level must not reach, each with the subpath it belongs on. */
const FORBIDDEN: readonly {readonly name: string; readonly test: (spec: string) => boolean}[] = [
	{
		name: "node:*",
		test: (spec) => spec.startsWith("node:") || builtinModules.includes(spec.split("/")[0] ?? ""),
	},
	{name: "miniflare", test: (spec) => spec === "miniflare" || spec.startsWith("cloudflare:")},
	{name: "@anthropic-ai/*", test: (spec) => spec.startsWith("@anthropic-ai/")},
	{name: "@agentclientprotocol/*", test: (spec) => spec.startsWith("@agentclientprotocol/")},
	{
		name: "@opentelemetry/*",
		test: (spec) => spec.startsWith("@opentelemetry/") || spec.startsWith("@effect/opentelemetry"),
	},
	{name: "@effect/platform-node", test: (spec) => spec.startsWith("@effect/platform-node")},
];

interface Hit {
	readonly rule: string;
	readonly spec: string;
	readonly importer: string;
}

const hits: Hit[] = [];
/** Who first imported each file the bundle reached: the chain back to the entry. */
const importedBy = new Map<string, string>();

const watch: Plugin = {
	name: "forbidden",
	setup(b) {
		b.onResolve({filter: /.*/}, (args) => {
			const rule = FORBIDDEN.find((f) => f.test(args.path));
			if (rule !== undefined) {
				hits.push({rule: rule.name, spec: args.path, importer: args.importer});
				// Kept out of the bundle, so one run lists every hit, not only the first.
				return {path: args.path, external: true};
			}
			return undefined;
		});
	},
};

const result = await build({
	entryPoints: [entry],
	bundle: true,
	platform: "browser",
	format: "esm",
	write: false,
	metafile: true,
	logLevel: "silent",
	plugins: [watch],
});

for (const [file, input] of Object.entries(result.metafile.inputs))
	for (const imported of input.imports)
		if (!importedBy.has(imported.path)) importedBy.set(imported.path, file);

const show = (file: string) => relative(process.cwd(), file) || file;
const chain = (file: string): string[] => {
	const seen: string[] = [];
	// The metafile names files from the working directory; esbuild's importer is absolute.
	let at: string | undefined = relative(process.cwd(), file);
	while (at !== undefined && !seen.includes(at)) {
		seen.push(at);
		at = importedBy.get(at);
	}
	return seen.map(show);
};

const modules = Object.keys(result.metafile.inputs).length;
const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
const counts = Object.fromEntries(
	FORBIDDEN.map((f) => [
		f.name,
		new Set(hits.filter((h) => h.rule === f.name).map((h) => h.spec)).size,
	]),
);
console.log(
	`browser bundle of ${show(entry)}: ${modules} modules, ${Math.round(bytes / 1024)} KB, ${result.errors.length} errors`,
);
console.log(
	Object.entries(counts)
		.map(([name, n]) => `${name}: ${n}`)
		.join(", "),
);
const seenSpecs = new Set<string>();
for (const hit of hits) {
	if (seenSpecs.has(hit.spec)) continue;
	seenSpecs.add(hit.spec);
	console.log(`  ${hit.spec}  <-  ${chain(hit.importer).join("  <-  ")}`);
}
process.exitCode = hits.length === 0 && result.errors.length === 0 ? 0 : 1;
