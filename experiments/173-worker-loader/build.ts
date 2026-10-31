// Part 2's hands side: the three ways to build a program for Worker Loader.
//
//   single   part 1: one module, Effect and tea inside it (esbuild drops what is not used)
//   split    design A: Effect, tea and fabrika as modules of their own, named by their content
//            (`effect@4.0.6-<sha256 12>.js`), and the program a small module that imports them
//   pure     design B: the program alone, with `effect` replaced by ./effect-stub.ts
//
// A module's name carries its content's hash, so the core can say which ones it already holds
// and the hands send only the rest.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {build, type Plugin} from "esbuild";

export const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export interface Built {
	readonly code: string;
	readonly bytes: number;
	readonly gzip: number;
	readonly ms: number;
	/** The output's bytes by package, biggest first. */
	readonly parts: Record<string, number>;
}

const versionOf = (pkg: string) =>
	(
		JSON.parse(readFileSync(here(`node_modules/${pkg}/package.json`), "utf8")) as {
			version: string;
		}
	).version;

const packageOf = (path: string) => {
	const m = path.match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/);
	if (m?.[1]) return m[1];
	if (path.includes("effect-stub")) return "the stub";
	if (path.startsWith("stub:")) return "stubbed names";
	if (path.includes("packages/fabrika")) return "@kampus/fabrika";
	if (path.includes("packages/pipeline")) return "@kampus/pipeline";
	if (path.includes("programs/")) return "the program";
	return "own code";
};

type Entry = {readonly path: string} | {readonly contents: string};

/** One ES module, the way Worker Loader takes it: `cloudflare:*` left to the runtime. */
export const bundle = async (entry: Entry, plugins: Plugin[] = []): Promise<Built> => {
	const t0 = performance.now();
	const out = await build({
		...("path" in entry
			? {entryPoints: [here(entry.path)]}
			: {stdin: {contents: entry.contents, resolveDir: here("."), sourcefile: "entry.js"}}),
		bundle: true,
		write: false,
		format: "esm",
		platform: "neutral",
		target: "es2022",
		mainFields: ["module", "main"],
		conditions: ["workerd", "worker", "browser", "import"],
		external: ["cloudflare:workers", "cloudflare:sockets"],
		minify: true,
		legalComments: "none",
		logLevel: "silent",
		metafile: true,
		plugins,
	});
	const ms = performance.now() - t0;
	const code = out.outputFiles[0]?.text ?? "";
	const by: Record<string, number> = {};
	for (const o of Object.values(out.metafile.outputs))
		for (const [path, {bytesInOutput}] of Object.entries(o.inputs)) {
			const name = packageOf(path);
			by[name] = (by[name] ?? 0) + bytesInOutput;
		}
	const parts = Object.fromEntries(Object.entries(by).sort((a, b) => b[1] - a[1]));
	return {code, bytes: Buffer.byteLength(code), gzip: gzipSync(code).length, ms: round(ms), parts};
};

/** A module's name: what it is, its version, and the first 12 hex of its content's sha256. */
const nameOf = (lib: string, version: string, code: string) =>
	`${lib}@${version}-${sha256(code).slice(0, 12)}.js`;

/** Imports of the shared libraries point at their modules; anything else is bundled in. */
const shared = (to: Record<string, string>): Plugin => ({
	name: "shared",
	setup(b) {
		b.onResolve(
			{filter: /^(effect|@demlik\/tea|@kampus\/fabrika|\.\/shared-probe\.ts)(\/.*)?$/},
			(a) => {
				const name = to[a.path];
				if (name) return {path: `./${name}`, external: true};
				if (a.path.startsWith("effect/")) throw new Error(`no shared module for ${a.path}`);
				return undefined;
			},
		);
	},
});

/** `effect/process` is exported from the Effect module as `part_process`. */
const partKey = (spec: string) => `part_${spec.slice("effect/".length).replaceAll(/\W/g, "_")}`;

/** A module that re-exports one part of a shared module under the part's own import name. */
const facade = async (lib: string, key: string, spec: string): Promise<Built> => {
	const keys = Object.keys(await import(spec)).filter((k) => k !== "default");
	// `export {x as catch}`: some names (`Effect.catch`) are words a `const` cannot take.
	const local = keys.map((k, i) => `${JSON.stringify(k)}: _${i}`).join(", ");
	const out = keys.map((k, i) => `_${i} as ${k}`).join(", ");
	const code = `import {${key} as m} from "./${lib}";\nconst {${local}} = m;\nexport {${out}};\n`;
	const bytes = Buffer.byteLength(code);
	return {code, bytes, gzip: gzipSync(code).length, ms: 0, parts: {facade: bytes}};
};

/** The parts of Effect (`effect/<part>`) that the shared libraries and the programs import. */
const effectPartsOf = async (): Promise<string[]> => {
	const found = new Set<string>();
	const record: Plugin = {
		name: "record",
		setup(b) {
			b.onResolve({filter: /^effect\/.+/}, (a) => {
				found.add(a.path);
				return {path: a.path, external: true};
			});
		},
	};
	for (const entry of [
		{contents: `export * from "@demlik/tea"; export * from "@demlik/tea/effect";`},
		{contents: `export * from "@kampus/fabrika";`},
		{path: "program.ts"},
		{path: "counter-entry.ts"},
	])
		await bundle(entry, [record]);
	return [...found].sort();
};

export interface Split {
	/** Every shared module, by name. */
	readonly libs: Record<string, Built>;
	/** Where an import goes: `effect` to `effect@4.0.6-<hash>.js`. */
	readonly to: Record<string, string>;
}

/**
 * Design A's shared modules. Effect is all of `effect`, not only what one program uses: the same
 * bytes must serve every program. tea's two entries share code (one `Cmd`, one `NoCellError`),
 * so tea is one module and `@demlik/tea/effect` a small module that re-exports its part.
 */
export const splitLibs = async (): Promise<Split> => {
	const libs: Record<string, Built> = {};
	const to: Record<string, string> = {};
	const add = (spec: string, lib: string, version: string, built: Built) => {
		const name = nameOf(lib, version, built.code);
		libs[name] = built;
		to[spec] = name;
	};
	const effect = versionOf("effect");
	// Effect's own parts (`effect/process`, ...) share its core files, so they go in its module,
	// each with a small module that re-exports its part, as for tea's engine below.
	const parts = await effectPartsOf();
	add(
		"effect",
		"effect",
		effect,
		await bundle({
			contents: [
				`export * from "effect";`,
				...parts.map((p) => `export * as ${partKey(p)} from "${p}";`),
			].join("\n"),
		}),
	);
	for (const p of parts)
		add(
			p,
			`effect-${p.slice("effect/".length)}`,
			effect,
			await facade(to.effect ?? "", partKey(p), p),
		);
	const tea = versionOf("@demlik/tea");
	add(
		"@demlik/tea",
		"tea",
		tea,
		await bundle(
			{
				contents: `export * from "@demlik/tea"; export * as engine from "@demlik/tea/effect";`,
			},
			[shared(to)],
		),
	);
	add(
		"@demlik/tea/effect",
		"tea-effect",
		tea,
		await facade(to["@demlik/tea"] ?? "", "engine", "@demlik/tea/effect"),
	);
	add(
		"@kampus/fabrika",
		"fabrika",
		"0.0.0",
		await bundle({contents: `export * from "@kampus/fabrika";`}, [shared(to)]),
	);
	add("./shared-probe.ts", "probe", "0", await bundle({path: "shared-probe.ts"}));
	return {libs, to};
};

/** A program as design A sends it: its own code, importing the shared modules by name. */
export const splitProgram = (entry: string, split: Split) =>
	bundle({path: entry}, [shared(split.to)]);

/** A package name as a literal piece of a RegExp. */
const literal = (s: string) => s.replaceAll(/[/\\^$*+?.()|[\]{}]/g, "\\$&");

/**
 * `effect`, and any `effect/<part>`, as the inert names of ./effect-stub.ts; and so for any other
 * package named in `also` (for example `@kampus/fabrika`), to see if the update calls it.
 */
const stub = (also: readonly string[]): Plugin => ({
	name: "stub",
	setup(b) {
		const filter = new RegExp(`^(${["effect", ...also].map(literal).join("|")})(\\/.*)?$`);
		b.onResolve({filter}, (a) => ({path: a.path, namespace: "stub"}));
		b.onLoad({filter: /.*/, namespace: "stub"}, async (a) => {
			const keys = Object.keys(await import(a.path)).filter((k) => k !== "default");
			const lines = keys.map(
				(k) => `export const ${k} = inert(${JSON.stringify(`${a.path}:${k}`)});`,
			);
			return {
				contents: `import {inert} from ${JSON.stringify(here("effect-stub.ts"))};\n${lines.join("\n")}\n`,
				loader: "js",
				resolveDir: here("."),
			};
		});
	},
});

/** A program as design B sends it: the update and what it calls, and no Effect. */
export const pureProgram = (entry: string, also: readonly string[] = []) =>
	bundle({path: entry}, [stub(also)]);

/** A content-addressed name for a program module, as for the shared ones. */
export const programName = (code: string) => nameOf("program", "0", code);
