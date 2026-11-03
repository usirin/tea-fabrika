// Experiment 195: the React Compiler with no Babel in the build. See 195-oxc-toolchain.md.
//
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY \
//     nice -n 19 node experiments/195-oxc-toolchain.ts [--babel <dir>] [--bundle]
//
// PR 223's head first, read-only: `git fetch origin pull/223/head:pr-223`. `--next <ref>` names
// another ref. `--out <file>` writes the results somewhere else (part 4 of the write-up uses it).
//
// The native Compiler is `oxc-transform-react` 0.156.0, oxc's Rust port, from this experiment's
// own workspace package (`195-oxc-toolchain/`), with Rolldown 1.2.13, Vite 8.3.2 and
// `@vitejs/plugin-react` 6.1.2. Not its latest: 6.2.1 came out today, inside pnpm's minimum
// release age. 6.1.2 asks for `oxc-transform-react` ^0.152.0 and gets 0.156.0, a peer pnpm warns
// about; part 4 checks its build still compiled. No Babel is in the lockfile. `--babel <dir>` names a scratch folder
// outside the repo that holds `babel-plugin-react-compiler` 1.0.0 and `@babel/core` 7.29.7, as
// experiment 194 ran them: the reference the native output is held against, never a build path.
//
// 1. Every window and program `.tsx` file on main, and the two in `next/` on PR 223's branch
//    (the ref `pr-223`, read with `git show`), through the native Compiler with its diagnostics on.
//    Which functions it compiled (a `_c(n)` cache at the top of the body) and which it skipped (a
//    diagnostic inside a function it did not compile). With `--babel`, the same through Babel with
//    a logger, and per function: same verdict, same cache size, same code once both are printed by
//    esbuild.
// 2. The same with the Compiler's purity check on, and the planted files of 194.
// 3. The skip check without Babel: the rule of 194's `pnpm lint:compiler`, built on the native
//    diagnostics and a parse for `"use no memo"`.
// 4. Time: per file, the native transform (the Compiler, types and JSX in one pass), Babel's
//    Compiler pass alone, and esbuild's transform. With `--bundle`, the window's bundle
//    (`apps/fabrika/src/window/desk.tsx`) five ways: esbuild as today, esbuild with the native
//    Compiler in `onLoad`, Rolldown alone, Rolldown with the native Compiler as a plugin, Vite 8 with
//    `react({compiler: true})`. Median of 3.
//
// Writes experiments/results/195-oxc-toolchain.json. No model, no network, no key, $0.

import {execFileSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {performance} from "node:perf_hooks";
import {pathToFileURL} from "node:url";

const root = join(import.meta.dirname, "..");
process.chdir(root);
const arg = (name: string) => {
	const at = process.argv.indexOf(name);
	return at === -1 ? null : (process.argv[at + 1] ?? null);
};
const babelDir = arg("--babel");
const bundleToo = process.argv.includes("--bundle");
const outFile = arg("--out") ?? "experiments/results/195-oxc-toolchain.json";
for (const key of ["TYPESAFE_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"])
	if (process.env[key] !== undefined) throw new Error(`run with ${key} unset`);

const harness = createRequire(join(import.meta.dirname, "195-oxc-toolchain/package.json"));
const load = (name: string) => import(pathToFileURL(harness.resolve(name)).href);
const oxc = await load("oxc-transform-react");
const {parseSync} = await load("oxc-parser");
const esbuild = harness("esbuild");

// The files: main's, as 194 read them, and next/'s from PR 223's branch.
const NEXT_BRANCH = arg("--next") ?? "pr-223";
const mainFiles = execFileSync("git", ["ls-files", "apps/fabrika/src/*.tsx", "programs/*.tsx"], {
	encoding: "utf8",
})
	.trim()
	.split("\n")
	.filter((f) => !f.includes(".test."));
const nextFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", NEXT_BRANCH, "next"], {
	encoding: "utf8",
})
	.trim()
	.split("\n")
	.filter((f) => f.endsWith(".tsx") && !f.includes(".test."));
const nextCommit = execFileSync("git", ["rev-parse", "--short", NEXT_BRANCH], {
	encoding: "utf8",
}).trim();
interface Source {
	readonly file: string;
	readonly version: "main" | "next";
	readonly text: string;
}
const sources: Source[] = [
	...mainFiles.map((file) => ({file, version: "main" as const, text: readFileSync(file, "utf8")})),
	...nextFiles.map((file) => ({
		file,
		version: "next" as const,
		text: execFileSync("git", ["show", `${NEXT_BRANCH}:${file}`], {encoding: "utf8"}),
	})),
];

// Functions, by a parse. A name is the function's own, or the variable or key it is bound to,
// through a `memo(...)` or `forwardRef(...)` call.
interface Fn {
	readonly name: string;
	readonly start: number;
	readonly end: number;
	readonly line: number;
	readonly node: any;
}
const FN_TYPES = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const lineAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length;
const functionsOf = (file: string, text: string): Fn[] => {
	const out: Fn[] = [];
	const walk = (node: any, bound: string | null) => {
		if (node === null || typeof node !== "object") return;
		if (Array.isArray(node)) {
			for (const n of node) walk(n, bound);
			return;
		}
		if (FN_TYPES.has(node.type)) {
			out.push({
				name: node.id?.name ?? bound ?? "(anonymous)",
				start: node.start,
				end: node.end,
				line: lineAt(text, node.start),
				node,
			});
		}
		for (const [key, child] of Object.entries(node)) {
			if (key === "type" || key === "start" || key === "end") continue;
			let name: string | null = null;
			if (node.type === "VariableDeclarator" && key === "init") name = node.id?.name ?? null;
			if (node.type === "Property" && key === "value") name = node.key?.name ?? null;
			if (node.type === "CallExpression" && key === "arguments") name = bound;
			walk(child, name);
		}
	};
	walk(parseSync(file, text, {}).program, null);
	return out;
};
/** The outermost function that holds an offset: the Compiler compiles top-level components and hooks. */
const outermost = (fns: readonly Fn[], at: number) =>
	fns.filter((f) => f.start <= at && at < f.end).sort((a, b) => a.start - b.start)[0] ?? null;

/** The compiled functions in an output: each starts with `const $ = _c(n)`. */
const compiledIn = (file: string, code: string) => {
	const fns = functionsOf(file.replace(/\.tsx$/, ".jsx"), code);
	const out: Record<string, {slots: number; text: string}> = {};
	for (const f of fns) {
		const first = f.node.body?.body?.[0];
		const init = first?.type === "VariableDeclaration" ? first.declarations?.[0]?.init : null;
		if (init?.type === "CallExpression" && init.callee?.name === "_c")
			out[f.name] = {
				slots: Number(init.arguments?.[0]?.value),
				text: code.slice(f.start, f.end),
			};
	}
	return out;
};

/**
 * Print both outputs the same way, so formatting is not counted as a difference: types out, white
 * space out (esbuild keeps a source's line breaks otherwise), names and order kept.
 */
const printed = (code: string) =>
	esbuild.transformSync(code, {
		loader: "tsx",
		jsx: "preserve",
		legalComments: "none",
		minifyWhitespace: true,
	}).code;

/** The UTF-8 byte offsets oxc-transform-react 0.156.0 reports, as the UTF-16 offsets JS uses. */
const utf16 = (text: string, byte: number) =>
	Buffer.from(text).subarray(0, byte).toString("utf8").length;

interface Verdict {
	readonly compiled: Record<string, {slots: number; text: string}>;
	readonly skipped: Record<string, string[]>;
	readonly diagnostics: number;
	readonly ms: number;
}
const native = (s: Source, environment: Record<string, unknown> = {}): Verdict => {
	const t0 = performance.now();
	const r = oxc.transformSync(s.file, s.text, {
		jsx: "preserve",
		reactCompiler: {panicThreshold: "none", reportDiagnostics: true, environment},
	});
	const ms = performance.now() - t0;
	if (r.fatal) throw new Error(`${s.file}: fatal ${JSON.stringify(r.errors)}`);
	const fns = functionsOf(s.file, s.text);
	const compiled = compiledIn(s.file, printed(r.code));
	const skipped: Record<string, string[]> = {};
	for (const e of r.errors) {
		const at = e.labels[0] === undefined ? -1 : utf16(s.text, e.labels[0].start);
		const fn = outermost(fns, at);
		const name = fn === null ? "(module)" : fn.name;
		if (compiled[name] !== undefined) continue;
		(skipped[name] ??= []).push(`${e.message} (line ${lineAt(s.text, at)})`);
	}
	return {compiled, skipped, diagnostics: r.errors.length, ms};
};

const babelRef = (() => {
	if (babelDir === null) return null;
	const from = createRequire(join(babelDir, "package.json"));
	const core = from("@babel/core");
	const plugin = from.resolve("babel-plugin-react-compiler");
	return (s: Source, environment: Record<string, unknown> = {}): Verdict => {
		const skipped: Record<string, string[]> = {};
		let diagnostics = 0;
		const fns = functionsOf(s.file, s.text);
		const lines = s.text.split("\n");
		/** Babel's line and column, as an offset, so a skip is named the way the native one is. */
		const offset = (loc: any) =>
			loc?.start === undefined
				? -1
				: lines.slice(0, loc.start.line - 1).reduce((n, l) => n + l.length + 1, 0) +
					loc.start.column;
		const t0 = performance.now();
		const out = core.transformSync(s.text, {
			filename: s.file,
			babelrc: false,
			configFile: false,
			parserOpts: {plugins: ["jsx", "typescript"]},
			plugins: [
				[
					plugin,
					{
						target: "19",
						panicThreshold: "none",
						environment,
						logger: {
							logEvent: (_f: string, e: any) => {
								if (e.kind === "CompileSuccess" || e.kind === "Timing") return;
								diagnostics += 1;
								const loc = e.fnLoc ?? e.detail?.loc ?? e.detail?.options?.loc ?? null;
								const name = e.fnName ?? outermost(fns, offset(loc))?.name ?? "(module)";
								const line = loc?.start?.line ?? null;
								const why = e.detail?.reason ?? e.detail?.options?.reason ?? e.reason ?? "";
								(skipped[name] ??= []).push(`${why} (line ${line})`);
							},
						},
					},
				],
			],
		});
		const ms = performance.now() - t0;
		const compiled = compiledIn(s.file, printed(String(out?.code ?? "")));
		for (const name of Object.keys(compiled)) delete skipped[name];
		return {compiled, skipped, diagnostics, ms};
	};
})();

// Part 1 and 2: the verdicts, file by file, and how they match.
const compare = (n: Verdict, b: Verdict | null) => {
	if (b === null) return null;
	const names = new Set([...Object.keys(n.compiled), ...Object.keys(b.compiled)]);
	const both: string[] = [];
	const nativeOnly: string[] = [];
	const babelOnly: string[] = [];
	const sameSlots: string[] = [];
	const sameCode: string[] = [];
	const differ: {name: string; native: number; babel: number}[] = [];
	const codeDiffers: {name: string; native: string; babel: string}[] = [];
	for (const name of names) {
		const x = n.compiled[name];
		const y = b.compiled[name];
		if (x === undefined) babelOnly.push(name);
		else if (y === undefined) nativeOnly.push(name);
		else {
			both.push(name);
			if (x.slots === y.slots) sameSlots.push(name);
			else differ.push({name, native: x.slots, babel: y.slots});
			if (x.text === y.text) sameCode.push(name);
			else {
				let i = 0;
				while (x.text[i] === y.text[i]) i += 1;
				codeDiffers.push({
					name,
					native: x.text.slice(Math.max(0, i - 40), i + 80),
					babel: y.text.slice(Math.max(0, i - 40), i + 80),
				});
			}
		}
	}
	return {
		both: both.length,
		nativeOnly,
		babelOnly,
		sameSlots: sameSlots.length,
		sameCode: sameCode.length,
		codeDiffers,
		differ,
		skipsNative: Object.keys(n.skipped).sort(),
		skipsBabel: Object.keys(b.skipped).sort(),
	};
};

const PURE = {validateNoImpureFunctionsInRender: true};
const perFile = sources.map((s) => {
	const n = native(s);
	const b = babelRef?.(s) ?? null;
	const np = native(s, PURE);
	const bp = babelRef?.(s, PURE) ?? null;
	return {
		file: s.file,
		version: s.version,
		lines: s.text.split("\n").length,
		native: {compiled: Object.keys(n.compiled).length, skipped: n.skipped},
		babel: b === null ? null : {compiled: Object.keys(b.compiled).length, skipped: b.skipped},
		match: compare(n, b),
		pure: {
			nativeSkipped: Object.keys(np.skipped).sort(),
			babelSkipped: bp === null ? null : Object.keys(bp.skipped).sort(),
		},
	};
});

const total = (version: "main" | "next") => {
	const rows = perFile.filter((r) => r.version === version);
	const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + pick(r), 0);
	return {
		files: rows.length,
		lines: sum((r) => r.lines),
		native: {
			compiled: sum((r) => r.native.compiled),
			skipped: sum((r) => Object.keys(r.native.skipped).length),
			skips: rows.flatMap((r) =>
				Object.entries(r.native.skipped).map(([fn, why]) => `${r.file} ${fn}: ${why.join("; ")}`),
			),
			pureSkipped: sum((r) => r.pure.nativeSkipped.length),
		},
		babel:
			babelRef === null
				? null
				: {
						compiled: sum((r) => r.babel?.compiled ?? 0),
						skipped: sum((r) => Object.keys(r.babel?.skipped ?? {}).length),
						pureSkipped: sum((r) => r.pure.babelSkipped?.length ?? 0),
					},
		match:
			babelRef === null
				? null
				: {
						both: sum((r) => r.match?.both ?? 0),
						sameSlots: sum((r) => r.match?.sameSlots ?? 0),
						sameCode: sum((r) => r.match?.sameCode ?? 0),
						nativeOnly: rows.flatMap((r) => r.match?.nativeOnly.map((f) => `${r.file} ${f}`) ?? []),
						babelOnly: rows.flatMap((r) => r.match?.babelOnly.map((f) => `${r.file} ${f}`) ?? []),
						codeDiffers: rows.flatMap(
							(r) => r.match?.codeDiffers.map((d) => ({file: r.file, ...d})) ?? [],
						),
						differ: rows.flatMap((r) => r.match?.differ.map((d) => ({file: r.file, ...d})) ?? []),
						pureDisagree: rows.flatMap((r) =>
							JSON.stringify(r.pure.nativeSkipped) === JSON.stringify(r.pure.babelSkipped)
								? []
								: [{file: r.file, native: r.pure.nativeSkipped, babel: r.pure.babelSkipped}],
						),
					},
	};
};
const totals = {main: total("main"), next: total("next")};
console.log("part 1, main:", JSON.stringify(totals.main, null, 1));
console.log("part 1, next (PR 223):", JSON.stringify(totals.next, null, 1));

// Part 2: 194's planted files, the ones whose answer the Compiler decides.
const PLANTED: Record<string, string> = {
	"frozen.tsx": `import {useSyncExternalStore} from "react";
const store = {version: 0, desk: "FIRST", listeners: new Set<() => void>()};
const subscribe = (l: () => void) => { store.listeners.add(l); return () => { store.listeners.delete(l); }; };
export function App() {
	useSyncExternalStore(subscribe, () => store.version);
	const desk = store.desk;
	return <p>{desk}</p>;
}
`,
	"memo-function.tsx": `import {memo} from "react";
export const Tile = memo(function Tile(props: {readonly name: string}) {
	return <p>{props.name}</p>;
});
`,
	"said-in-handler.tsx": `const Tile = (props: {readonly focus: () => void}) => <button type="button" onClick={props.focus} />;
export function Desk(props: {readonly tiles: readonly string[]; readonly go: (said: string) => void}) {
	const said = () => new Date().toISOString();
	const focus = (tile: string) => {
		props.go(\`\${tile} \${said()}\`);
	};
	return <main>{props.tiles.map((t) => <Tile key={t} focus={() => focus(t)} />)}</main>;
}
`,
	"now-in-render.tsx": `export function When() {
	return <time>{String(Date.now())}</time>;
}
`,
	"no-memo.tsx": `import {useRef} from "react";
export function Tip() {
	"use no memo";
	const id = useRef(\`tip-\${Math.random()}\`).current;
	return <p id={id} />;
}
`,
	"ref-in-render.tsx": `import {useRef} from "react";
export function Tip() {
	const id = useRef(\`tip-\${Math.random()}\`).current;
	return <p id={id} />;
}
`,
};
const planted = Object.entries(PLANTED).map(([file, text]) => {
	const s: Source = {file, version: "main", text};
	const shape = (v: Verdict | null) =>
		v === null
			? null
			: {
					compiled: Object.fromEntries(Object.entries(v.compiled).map(([k, c]) => [k, c.slots])),
					skipped: Object.keys(v.skipped),
					diagnostics: v.diagnostics,
				};
	return {
		file,
		native: shape(native(s)),
		babel: shape(babelRef?.(s) ?? null),
		nativePure: shape(native(s, PURE)),
		babelPure: shape(babelRef?.(s, PURE) ?? null),
	};
});
console.log("part 2, planted:");
for (const p of planted) console.log(" ", JSON.stringify(p));

// Part 3: the skip check, natively. A skip passes only with `"use no memo"` in that function and a
// row in the ledger naming it; a directive with no row fails, as 194's design says.
const directivesOf = (s: Source) =>
	functionsOf(s.file, s.text)
		.filter((f) =>
			(Array.isArray(f.node.body?.body) ? f.node.body.body : []).some(
				(st: any) => st.type === "ExpressionStatement" && st.directive === "use no memo",
			),
		)
		.map((f) => f.name);
// Two planted rows: one with its directive (passes), one with none (fails, and so does its skip).
const ledger: readonly {file: string; fn: string; why: string}[] = [
	{file: "no-memo.tsx", fn: "Tip", why: "planted: an opt-out with its row"},
	{file: "ref-in-render.tsx", fn: "Tip", why: "planted: a row with no directive"},
];
const check = (s: Source) => {
	const v = native(s);
	const noMemo = directivesOf(s);
	const row = (fn: string) => ledger.some((r) => r.file === s.file && r.fn === fn);
	const rows = ledger.filter((r) => r.file === s.file).map((r) => r.fn);
	return [
		...Object.keys(v.skipped)
			.filter((fn) => !noMemo.includes(fn))
			.map((fn) => `${s.file} ${fn}: skipped: ${v.skipped[fn]?.join("; ")}`),
		...noMemo.filter((fn) => !row(fn)).map((fn) => `${s.file} ${fn}: "use no memo" with no row`),
		...rows
			.filter((fn) => !noMemo.includes(fn))
			.map((fn) => `${s.file} ${fn}: a row with no "use no memo"`),
	];
};
const failures = [
	...sources.flatMap(check),
	...Object.entries(PLANTED).flatMap(([file, text]) => check({file, version: "main", text})),
];
console.log("part 3, the skip check without Babel, failures:");
for (const f of failures) console.log(" ", f);

// Part 4: time.
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const timeAll = (f: (s: Source) => unknown, runs = 5) =>
	median(
		Array.from({length: runs}, () => {
			const t0 = performance.now();
			for (const s of sources) if (s.version === "main") f(s);
			return performance.now() - t0;
		}),
	);
const full = (s: Source) =>
	oxc.transformSync(s.file, s.text, {jsx: {runtime: "automatic"}, reactCompiler: {}});
const plain = (s: Source) =>
	esbuild.transformSync(s.text, {loader: "tsx", jsx: "automatic", sourcefile: s.file});
full(sources[0] as Source);
plain(sources[0] as Source);
const ms = {
	nativeFull: Math.round(timeAll(full)),
	esbuild: Math.round(timeAll(plain)),
	babelCompilerOnly: babelRef === null ? null : Math.round(timeAll((s) => babelRef(s))),
};
console.log(`part 4, transform of main's ${mainFiles.length} files, median of 5:`, ms);

// Part 4, with --bundle: the window's bundle five ways, written to a temp folder that is removed.
const bundles = bundleToo ? await bundleTimes() : null;

async function bundleTimes() {
	const app = join(root, "apps/fabrika");
	const {bundlesOf, common} = await import(pathToFileURL(join(app, "bundles.ts")).href);
	const desk = bundlesOf((...p: string[]) => join(app, ...p)).find((b: any) =>
		String(b.outfile).endsWith("desk.js"),
	);
	const entry = join(app, "src/window/desk.tsx");
	const out = mkdtempSync(join(tmpdir(), "fabrika-195-"));
	const {rolldown} = await load("rolldown");
	const vite = await load("vite");
	const react = (await load("@vitejs/plugin-react")).default;
	const define = {"process.env.NODE_ENV": '"production"'};
	let compiledFns = 0;
	const compilerPlugin = {
		name: "react-compiler-native",
		transform: {
			filter: {id: {include: /\.tsx$/, exclude: /node_modules/}},
			handler(code: string, id: string) {
				const r = oxc.transformSync(id, code, {jsx: {runtime: "automatic"}, reactCompiler: {}});
				if (r.fatal) throw new Error(r.errors.map((e: any) => e.message).join("\n"));
				compiledFns += (r.code.match(/= _c\(\d+\)/g) ?? []).length;
				return {code: r.code, moduleType: "js"};
			},
		},
	};
	// ghostty-web's WebAssembly, as the bytes esbuild's `binary` loader gives.
	const wasmBinary = {
		name: "wasm-binary",
		load: {
			filter: {id: /\.wasm$/},
			handler(id: string) {
				const b64 = readFileSync(id).toString("base64");
				return {
					code: `export default Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));`,
					moduleType: "js",
				};
			},
		},
	};
	const runs = {
		esbuild: () => esbuild.build({...common(app), ...desk, outfile: join(out, "e.js")}),
		// Today's build, with the native Compiler in an `onLoad` plugin on the app's own .tsx files.
		esbuildCompiler: () =>
			esbuild.build({
				...common(app),
				...desk,
				outfile: join(out, "ec.js"),
				plugins: [
					{
						name: "react-compiler-native",
						setup(build: any) {
							build.onLoad({filter: /\.tsx$/}, (a: any) => {
								if (a.path.includes("node_modules")) return undefined;
								const r = oxc.transformSync(a.path, readFileSync(a.path, "utf8"), {
									jsx: {runtime: "automatic"},
									reactCompiler: {},
								});
								if (r.fatal) return {errors: r.errors.map((e: any) => ({text: e.message}))};
								return {contents: r.code, loader: "js"};
							});
						},
					},
				],
			}),
		rolldown: async (compiler: boolean) => {
			const b = await rolldown({
				input: entry,
				platform: "browser",
				cwd: app,
				logLevel: "silent",
				transform: {jsx: "react-jsx", target: "chrome140", define},
				plugins: compiler ? [compilerPlugin, wasmBinary] : [wasmBinary],
			});
			await b.write({file: join(out, compiler ? "rc.js" : "r.js"), format: "iife", minify: true});
			await b.close();
		},
		vite: async () => {
			await vite.build({
				configFile: false,
				root: join(app, "src/window"),
				logLevel: "silent",
				define,
				plugins: [{...wasmBinary, enforce: "pre"}, react({compiler: true})],
				build: {
					outDir: join(out, "vite"),
					emptyOutDir: true,
					target: "chrome140",
					minify: true,
					rolldownOptions: {input: entry, output: {format: "iife", entryFileNames: "v.js"}},
				},
			});
		},
	};
	const time = async (f: () => Promise<unknown>) => {
		await f();
		const xs: number[] = [];
		for (let i = 0; i < 3; i++) {
			const t0 = performance.now();
			await f();
			xs.push(performance.now() - t0);
		}
		return Math.round(median(xs));
	};
	const size = (f: string) => readFileSync(join(out, f)).length;
	const result = {
		esbuild: {ms: await time(runs.esbuild), bytes: size("e.js")},
		esbuildCompiler: {ms: await time(runs.esbuildCompiler), bytes: size("ec.js")},
		rolldown: {ms: await time(() => runs.rolldown(false)), bytes: size("r.js")},
		rolldownCompiler: {ms: await time(() => runs.rolldown(true)), bytes: size("rc.js")},
		vite: {ms: await time(runs.vite), bytes: size("vite/v.js")},
		cacheCallsInRolldownCompiler: (readFileSync(join(out, "rc.js"), "utf8").match(/\(\d+\)/g) ?? [])
			.length,
		compiledFnsPerBuild: compiledFns / 4,
		viteCompilerRan: /react\/compiler-runtime|useMemoCache/.test(
			readFileSync(join(out, "vite/v.js"), "utf8"),
		),
	};
	rmSync(out, {recursive: true, force: true});
	console.log("part 4, desk.tsx bundle, median of 3 after one warm-up:", result);
	return result;
}

writeFileSync(
	outFile,
	`${JSON.stringify(
		{
			at: new Date().toISOString(),
			main: execFileSync("git", ["rev-parse", "--short", "HEAD"], {encoding: "utf8"}).trim(),
			next: nextCommit,
			node: process.version,
			tools: {
				"oxc-transform-react": "0.156.0",
				"oxc-parser": "0.151.0",
				rolldown: "1.2.13",
				vite: "8.3.2",
				"@vitejs/plugin-react": "6.1.2",
				esbuild: harness("esbuild/package.json").version,
				babelReference:
					babelDir === null ? null : "babel-plugin-react-compiler 1.0.0, @babel/core 7.29.7",
			},
			totals,
			perFile: perFile.map((r) => ({...r, match: r.match})),
			planted,
			skipCheck: {ledger, failures},
			transformMs: ms,
			bundles,
		},
		null,
		"\t",
	)}\n`,
);
