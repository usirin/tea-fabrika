// Experiment 194: React Compiler from day one. Three probes on today's version (main), no window,
// no key, no model, $0. Changes no lint setting and no build.
//
//   node experiments/194-react-compiler.ts                       part 1 and the planted lint cases
//   node experiments/194-react-compiler.ts --compiler <dir>      all three parts
//
// <dir> holds `babel-plugin-react-compiler` 1.0.0 and `@babel/core` 7.29.7, installed outside the
// repo (`npm i --save-exact` in a scratch folder), as experiment 176 did. They are not in the
// lockfile.
//
// 1. The rules. Every React rule oxlint 1.90.0 ports from the Compiler, plus `display-name` and
//    `rules-of-hooks`, over every window and program `.tsx` file on main. Each finding is read by
//    hand: READING below holds the verdicts. A finding no verdict covers prints as "unread".
// 2. The Compiler. Each file through Babel with the Compiler, `panicThreshold: "none"`, and a
//    logger. Which functions it compiled and which it skipped, and why; then, for each skip,
//    whether a lint finding sits inside the skipped function. Babel and esbuild timed per file.
// 3. The planted cases. Five small files: the store shape that froze today's desk, its fix, a
//    `memo(function X)`, a `memo(X)` and a `"use no memo"`. What lints, and what compiles.
//
// Writes experiments/results/194-react-compiler.json.

import {execFileSync, spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {performance} from "node:perf_hooks";

const root = join(import.meta.dirname, "..");
process.chdir(root);
const flag = process.argv.indexOf("--compiler");
const compilerDir = flag === -1 ? null : process.argv[flag + 1];

const RULES = [
	"purity",
	"refs",
	"immutability",
	"set-state-in-render",
	"set-state-in-effect",
	"static-components",
	"use-memo",
	"void-use-memo",
	"preserve-manual-memoization",
	"incompatible-library",
	"globals",
	"error-boundaries",
	"unsupported-syntax",
	"todo",
	"syntax",
	"rule-suppression",
	"hooks",
	"capitalized-calls",
	"memo-dependencies",
	"exhaustive-effect-dependencies",
	"no-deriving-state-in-effects",
	"no-unstable-nested-components",
	"display-name",
	"rules-of-hooks",
];

type Verdict = "true" | "false";
interface Read {
	readonly verdict: Verdict;
	readonly why: string;
}
const ALL = (verdict: Verdict, why: string) => (): Read => ({verdict, why});

/** The reading, by rule, with the one rule whose findings differ by file. */
const READING: Record<string, (file: string) => Read> = {
	"react(purity)": ALL(
		"true",
		"Date.now or Math.random in render; a compiled render would keep the old value",
	),
	"react(refs)": ALL("true", "reads ref.current in render; useId is the plain answer"),
	"react(immutability)": ALL(
		"true",
		"a counter of the render changed inside a map callback; the Compiler skips the function",
	),
	"react(set-state-in-effect)": (file) =>
		file.endsWith("frame.tsx")
			? {verdict: "false", why: "the clock starts the moment it starts moving; on purpose"}
			: {verdict: "true", why: "hides a tip when a prop says so: derivable in render"},
	"react(exhaustive-effect-dependencies)": ALL(
		"false",
		"a dep kept on purpose as the trigger, or a helper that only touches refs and setters",
	),
};

const lintConfig = (rules: readonly string[]) => {
	const file = join(mkdtempSync(join(tmpdir(), "fabrika-194-")), "react.json");
	writeFileSync(
		file,
		JSON.stringify({
			plugins: ["react", "eslint"],
			categories: {correctness: "off"},
			rules: Object.fromEntries(rules.map((r) => [r, "warn"])),
		}),
	);
	return file;
};

interface Finding {
	readonly rule: string;
	readonly file: string;
	readonly line: number;
	readonly text: string;
}
const lint = (config: string, files: readonly string[]): Finding[] => {
	const out = spawnSync("pnpm", ["exec", "oxlint", "-c", config, "-f", "json", ...files], {
		encoding: "utf8",
		maxBuffer: 2 ** 28,
	}).stdout;
	const found = JSON.parse(out.slice(out.indexOf("{"))).diagnostics;
	return found.map((d: any) => {
		const line = d.labels?.[0]?.span?.line ?? 0;
		const text = readFileSync(d.filename, "utf8").split("\n")[line - 1]?.trim() ?? "";
		return {rule: d.code, file: d.filename, line, text: text.slice(0, 100)};
	});
};

// Part 1: the rules on main.
const files = execFileSync("git", ["ls-files", "apps/fabrika/src/*.tsx", "programs/*.tsx"], {
	encoding: "utf8",
})
	.trim()
	.split("\n")
	.filter((f) => !f.includes(".test."));
const lines = files.reduce((n, f) => n + readFileSync(f, "utf8").split("\n").length, 0);
const findings = lint(lintConfig(RULES.map((r) => `react/${r}`)), files).map((f) => ({
	...f,
	...(READING[f.rule]?.(f.file) ?? {verdict: "unread", why: ""}),
}));
const tally: Record<string, {findings: number; right: number; wrong: number; unread: number}> = {};
for (const f of findings) {
	const t = (tally[f.rule] ??= {findings: 0, right: 0, wrong: 0, unread: 0});
	t.findings += 1;
	if (f.verdict === "true") t.right += 1;
	else if (f.verdict === "false") t.wrong += 1;
	else t.unread += 1;
}
const quiet = RULES.filter((r) => tally[`react(${r})`] === undefined);
console.log(`part 1: ${files.length} files, ${lines} lines, ${RULES.length} rules`);
console.table(tally);
console.log(`no finding: ${quiet.join(" ")}`);

// Part 3's files, written to a temp folder. The first is the shape of today's desk.tsx:801-803.
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
	"one-hook.tsx": `import {useSyncExternalStore} from "react";
type Model = {readonly desk: string};
let model: Model = {desk: "FIRST"};
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const read = () => model;
export const set = (m: Model) => { model = m; for (const l of listeners) l(); };
export function App() {
	const m = useSyncExternalStore(subscribe, read, read);
	return <p>{m.desk}</p>;
}
`,
	"memo-function.tsx": `import {memo} from "react";
export const Tile = memo(function Tile(props: {readonly name: string}) {
	return <p>{props.name}</p>;
});
`,
	"memo-named.tsx": `import {memo} from "react";
const TileView = (props: {readonly name: string}) => <p>{props.name}</p>;
export const Tile = memo(TileView);
`,
	"memo-arrow.tsx": `import {memo} from "react";
export const Tile = memo((props: {readonly name: string}) => <p>{props.name}</p>);
`,
	// The shape of PR 223's next/src/window/main.tsx:146: the time is read in a handler, not in render.
	// The handler goes to a component of ours, as there; a handler on a DOM element does not fire.
	"said-in-handler.tsx": `const Tile = (props: {readonly focus: () => void}) => <button type="button" onClick={props.focus} />;
export function Desk(props: {readonly tiles: readonly string[]; readonly go: (said: string) => void}) {
	const said = () => new Date().toISOString();
	const focus = (tile: string) => {
		props.go(\`\${tile} \${said()}\`);
	};
	return <main>{props.tiles.map((t) => <Tile key={t} focus={() => focus(t)} />)}</main>;
}
`,
	"said-on-button.tsx": `export function Desk(props: {readonly go: (said: string) => void}) {
	const said = () => new Date().toISOString();
	return <button type="button" onClick={() => props.go(said())} />;
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
};
const plantedDir = mkdtempSync(join(tmpdir(), "fabrika-194-planted-"));
for (const [name, text] of Object.entries(PLANTED)) writeFileSync(join(plantedDir, name), text);
const plantedFiles = Object.keys(PLANTED).map((n) => join(plantedDir, n));
const plantedLint = lint(
	lintConfig([...RULES.map((r) => `react/${r}`), "eslint/prefer-arrow-callback"]),
	plantedFiles,
).map((f) => ({rule: f.rule, file: f.file.replace(`${plantedDir}/`, ""), line: f.line}));
console.log("part 3, lint on planted files:");
console.table(plantedLint);

// Part 2: the Compiler, when its folder is given.
interface Event {
	readonly file: string;
	readonly kind: string;
	readonly fn: string | null;
	readonly line: number | null;
	readonly endLine: number | null;
	readonly reason: string;
}
const compiled: {
	events: Event[];
	ms: Record<string, {babel: number; esbuild: number}>;
	planted: Record<string, {events: Event[]; cacheSlots: number | null}>;
	pure: Event[];
} | null = compilerDir === null ? null : {events: [], ms: {}, planted: {}, pure: []};
if (compiled !== null && compilerDir !== null) {
	const from = createRequire(join(compilerDir, "package.json"));
	const babel = from("@babel/core");
	const plugin = from.resolve("babel-plugin-react-compiler");
	const esbuild = createRequire(join(root, "apps/fabrika/package.json"))("esbuild");
	// `pure`: also the Compiler's own check for Date.now and Math.random in render, which its
	// default leaves off (the lint rule `purity` is the same check).
	const run = (path: string, label: string, pure = false) => {
		const source = readFileSync(path, "utf8");
		const events: Event[] = [];
		const t0 = performance.now();
		const out = babel.transformSync(source, {
			filename: path,
			babelrc: false,
			configFile: false,
			parserOpts: {plugins: ["jsx", "typescript"]},
			plugins: [
				[
					plugin,
					{
						target: "19",
						panicThreshold: "none",
						environment: pure ? {validateNoImpureFunctionsInRender: true} : {},
						logger: {
							logEvent: (_f: string, e: any) => {
								const loc = e.fnLoc ?? e.detail?.loc ?? null;
								events.push({
									file: label,
									kind: e.kind,
									fn: e.fnName ?? null,
									line: loc?.start?.line ?? null,
									endLine: loc?.end?.line ?? null,
									reason: String(
										e.detail?.reason ?? e.detail?.options?.reason ?? e.reason ?? e.data ?? "",
									).slice(0, 160),
								});
							},
						},
					},
				],
			],
		});
		const babelMs = performance.now() - t0;
		const t1 = performance.now();
		esbuild.transformSync(source, {loader: "tsx", jsx: "automatic"});
		const esbuildMs = performance.now() - t1;
		return {events, babelMs, esbuildMs, code: String(out?.code ?? "")};
	};
	// One warm-up, so Babel's first load is not counted against the first file.
	run(files[0] ?? "", "warm-up");
	for (const f of files) {
		const r = run(f, f);
		compiled.events.push(...r.events);
		compiled.ms[f] = {babel: Math.round(r.babelMs), esbuild: Math.round(r.esbuildMs * 10) / 10};
	}
	for (const f of plantedFiles) {
		const name = f.replace(`${plantedDir}/`, "");
		const r = run(f, name);
		compiled.planted[name] = {
			events: r.events,
			cacheSlots: (r.code.match(/_c\((\d+)\)/g) ?? []).length,
		};
		compiled.planted[`${name}, pure`] = {
			events: run(f, name, true).events,
			cacheSlots: null,
		};
	}
	// The same files with the Compiler's purity check on: which renders it now refuses.
	compiled.pure = files.flatMap((f) =>
		run(f, f, true).events.filter((e) => e.kind !== "CompileSuccess"),
	);
	console.log("part 2, with the purity check, not compiled:");
	for (const e of compiled.pure)
		console.log(`  ${e.file}:${e.line} ${e.fn ?? ""}: ${e.reason.slice(0, 80)}`);
	const kinds: Record<string, number> = {};
	for (const e of compiled.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
	console.log("part 2, Compiler events on main:", kinds);
	const skips = compiled.events.filter((e) => e.kind !== "CompileSuccess");
	for (const s of skips) {
		const inside = findings.filter(
			(f) =>
				f.file === s.file &&
				s.line !== null &&
				s.endLine !== null &&
				f.line >= s.line &&
				f.line <= s.endLine &&
				f.verdict === "true",
		);
		console.log(
			`${s.kind} ${s.file}:${s.line} ${s.fn ?? ""}: ${s.reason.slice(0, 90)} | lint inside: ${inside.map((i) => `${i.rule}@${i.line}`).join(", ") || "none"}`,
		);
	}
	const total = Object.values(compiled.ms).reduce(
		(a, m) => ({babel: a.babel + m.babel, esbuild: a.esbuild + m.esbuild}),
		{babel: 0, esbuild: 0},
	);
	console.log(
		`part 2, time over ${files.length} files: Babel ${total.babel} ms, esbuild transform ${Math.round(total.esbuild)} ms`,
	);
	for (const [name, p] of Object.entries(compiled.planted))
		console.log(
			`part 3, ${name}: ${p.events.map((e) => e.kind).join(", ") || "no event"}; functions with a memo cache ${p.cacheSlots ?? "not counted"}`,
		);
}

writeFileSync(
	"experiments/results/194-react-compiler.json",
	`${JSON.stringify(
		{
			at: new Date().toISOString(),
			commit: execFileSync("git", ["rev-parse", "HEAD"], {encoding: "utf8"}).trim(),
			oxlint: "1.90.0",
			compiler:
				compilerDir === null ? null : "babel-plugin-react-compiler 1.0.0, @babel/core 7.29.7",
			files,
			lines,
			rules: RULES,
			tally,
			quiet,
			findings,
			plantedLint,
			compiled,
		},
		null,
		"\t",
	)}\n`,
);
