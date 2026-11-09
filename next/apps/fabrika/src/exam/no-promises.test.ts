import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {NodePath} from "@effect/platform-node";
import {Effect, Path} from "effect";
import * as fc from "fast-check";
import {API} from "typescript/unstable/sync";
// `no-promises` (exam item 1): every Promise shape fires in next/, Effect's own Promise calls with
// them, and the Effect ones pass. Both checks limit an edge comment to the next physical line.
import {describe, expect, it} from "vitest";
import {plant} from "./plant.ts";
import {checkPromiseTypes} from "./promise-types.ts";

const CODE = "fabrika(no-promises)";
const FIRES = "next/packages/libfabrika/src/app/fires.ts";
const PASSES = "next/packages/libfabrika/src/app/passes.ts";
const EDGE = "next/packages/libfabrika/src/data/project.ts";
const paths = Effect.runSync(Path.Path.pipe(Effect.provide(NodePath.layer)));

const typed = (files: Readonly<Record<string, string>>, workers = false) => {
	const root = mkdtempSync(join(tmpdir(), "p12-types-"));
	const api = new API({cwd: root});
	try {
		for (const [file, body] of Object.entries(files)) {
			mkdirSync(dirname(join(root, file)), {recursive: true});
			writeFileSync(join(root, file), body);
		}
		const config = join(root, "tsconfig.json");
		writeFileSync(
			config,
			JSON.stringify({
				compilerOptions: {
					strict: true,
					target: "ES2023",
					...(workers
						? {
								module: "preserve",
								moduleResolution: "bundler",
								// Effect's DOM declarations are not Workers globals; check our source here.
								skipLibCheck: true,
								paths: {
									effect: [
										paths.resolve(import.meta.dirname, "../../node_modules/effect/dist/index.d.ts"),
									],
									"effect/*": [
										paths.resolve(import.meta.dirname, "../../node_modules/effect/dist/*.d.ts"),
									],
								},
								lib: ["ES2023"],
								types: [
									paths.resolve(
										import.meta.dirname,
										"../../node_modules/@cloudflare/workers-types",
									),
								],
							}
						: {}),
				},
				include: ["**/*.ts"],
			}),
		);
		const snapshot = api.updateSnapshot({openProjects: [config]});
		try {
			const project = snapshot.getProject(config)!;
			expect(project.program.getSemanticDiagnostics()).toEqual([]);
			return checkPromiseTypes(project, root, paths);
		} finally {
			snapshot.dispose();
		}
	} finally {
		api.close();
		rmSync(root, {recursive: true, force: true});
	}
};

const wrappedEdge = (method: string, rule: string, indent: string, gap = 0) =>
	[
		"declare const platform: {read(): Promise<number>};",
		"declare const Effect: {",
		"  tryPromise(options: {try: () => Promise<number>; catch: () => Error}): number;",
		"  runPromise(value: number): Promise<number>;",
		"};",
		`// oxlint-disable-next-line ${rule} -- edge: the platform call enters or leaves Effect`,
		`export const edge = Effect.${method}(`,
		...(method === "runPromise" ? [`${indent}Effect.tryPromise(`] : []),
		`${indent}{`,
		`${indent}  try: () =>`,
		...Array.from({length: gap}, () => ""),
		`${indent}    platform.read(),`,
		`${indent}  catch: () => new Error("platform"),`,
		`${indent}}`,
		...(method === "runPromise" ? [`${indent})`] : []),
		");",
	].join("\n");

const markedEdge = fc.tuple(
	fc.constantFrom("tryPromise", "runPromise"),
	fc.constantFrom("fabrika/no-promises", "fabrika/no-effect-run-outside-edge"),
	fc.constantFrom(" ", "  ", "\t"),
);

const bridgeSpellings = [
	"module",
	"renamedModule",
	"namespace",
	"function",
	"renamedFunction",
	"computed",
	"parenthesized",
	"nonNull",
	"satisfies",
	"sameTypeAs",
	"localAlias",
	"destructured",
	"computedKey",
	"aliasChain",
	"renamedDestructured",
	"moduleAlias",
	"computedBridgeKeys",
] as const;

const rpcSource = (
	suffix: string,
	method: "tryPromise" | "promise",
	gap: number,
	marked: boolean,
	spelling: (typeof bridgeSpellings)[number] | "bare" | "unresolvedKey",
) => {
	const [setup, callee] = (
		{
			module: ['import {Effect} from "effect";', `Effect.${method}`],
			renamedModule: ['import {Effect as E} from "effect";', `E.${method}`],
			namespace: ['import * as Fx from "effect";', `Fx.Effect.${method}`],
			function: [`import {${method}} from "effect/Effect";`, method],
			renamedFunction: [`import {${method} as tp} from "effect/Effect";`, "tp"],
			computed: ['import {Effect} from "effect";', `Effect["${method}"]`],
			parenthesized: ['import {Effect} from "effect";', `(Effect.${method})`],
			nonNull: ['import {Effect} from "effect";', `Effect.${method}!`],
			satisfies: [
				'import {Effect} from "effect";',
				`(Effect.${method} satisfies typeof Effect.${method})`,
			],
			sameTypeAs: [
				'import {Effect} from "effect";',
				`(Effect.${method} as typeof Effect.${method})`,
			],
			localAlias: [`import {Effect} from "effect";\nconst tp = Effect.${method};`, "tp"],
			destructured: [`import {Effect} from "effect";\nconst {${method}} = Effect;`, method],
			computedKey: [`import {Effect} from "effect";\nconst k = "${method}";`, "Effect[k]"],
			aliasChain: [
				`import {Effect} from "effect";\nconst first = (Effect.${method})!;\nconst tp = first satisfies typeof first;`,
				"(tp)",
			],
			renamedDestructured: [
				`import {Effect} from "effect";\nconst {${method}: tp} = Effect;`,
				"tp",
			],
			moduleAlias: [`import {Effect} from "effect";\nconst E = Effect;`, `E.${method}`],
			computedBridgeKeys: [
				'import {Effect} from "effect";\ndeclare const k: "tryPromise" | "promise";',
				`(Effect[k] as typeof Effect.${method})`,
			],
			unresolvedKey: [
				`import {Effect} from "effect";\ndeclare const k: "${method}" | "sync";`,
				`(Effect[k] as typeof Effect.${method})`,
			],
			bare: ["", ""],
		} as const
	)[spelling];
	const inBridge = spelling !== "bare";
	// Installed workers-types: WorkerStub -> Fetcher<T> -> Rpc.Provider<T> ->
	// MethodOrProperty<V> -> Result<Awaited<R>> turns Promise<unknown> into never.
	const before = [
		...setup.split("\n"),
		`type Calls = Rpc.WorkerEntrypointBranded & {describe${suffix}(): Promise<unknown>};`,
		"declare const worker: WorkerStub;",
		"const rpc = worker.getEntrypoint<Calls>();",
		...(inBridge
			? [
					"// oxlint-disable-next-line fabrika/no-promises -- edge: the RPC call enters Effect",
					`export const edge = ${callee}(${method === "tryPromise" ? "{" : ""}`,
					...(method === "tryPromise" ? ["  try: () =>"] : ["  () =>"]),
				]
			: []),
		...Array.from({length: gap}, () => ""),
		...(marked
			? ["// oxlint-disable-next-line fabrika/no-promises -- edge: Worker RPC returns a Promise"]
			: []),
	];
	return {
		file: "next/rpc.ts",
		line: before.length + 1,
		source: [
			...before,
			`    rpc.describe${suffix}()${inBridge ? (method === "tryPromise" ? "," : "") : ";"}`,
			...(inBridge
				? method === "tryPromise"
					? ['  catch: () => new Error("rpc"),', "});"]
					: [");"]
				: []),
		].join("\n"),
	};
};

const fires = [
	'import {Effect, Schema, Stream} from "effect";', // 1
	"declare const p: Promise<number>;", // 2
	"export const a = async () => 1;", // 3
	"export async function b() { return 1; }", // 4
	"export const c = function* () { return 1; };", // 5: passes, a generator
	"export const d = async function () { await p; };", // 6: twice, async and await
	"export const e = new Promise<number>(() => undefined);", // 7
	"export const f = Promise.resolve(1);", // 8
	"export const g = Promise.all([p]);", // 9
	"export const h = p.then((x) => x);", // 10
	"export const i = p.catch(() => 0);", // 11
	"export const j = Effect.promise(() => p);", // 12
	'export const k = import("./passes.ts");', // 13
	"export const l = async () => { for await (const x of [p]) void x; };", // 14: twice
	"export const m = Stream.make(1);", // 15: passes
	"declare const S: typeof Schema.Number, it: AsyncIterable<number>, s: Stream.Stream<number>;", // 16
	"export const n = Effect.tryPromise(() => p);", // 17
	'export const o = Effect.tryPromise({try: () => p, catch: () => new Error("x")});', // 18
	"export const q = Effect.promise<number>(() => p);", // 19: a typed call counts
	'export const r = Effect.tryPromise<number, Error>({try: () => p, catch: () => new Error("x")});', // 20
	"export const s1 = Schema.decodePromise(S);", // 21
	"export const s2 = Schema.encodePromise(S);", // 22
	"export const s3 = Schema.decodeUnknownPromise(S);", // 23
	"export const s4 = Schema.encodeUnknownPromise(S);", // 24
	'export const s5 = Stream.fromAsyncIterable(it, () => new Error("x"));', // 25
	"export const s6 = Stream.toAsyncIterable(s);", // 26
	"export const s7 = Stream.toAsyncIterableWith(s, S);", // 27
	"export const s8 = Stream.toAsyncIterableEffect(s);", // 28
	'import {tryPromise} from "effect/Effect";', // 29
	"export const t = tryPromise(() => p);", // 30: imported by its own name
].join("\n");

const passes = [
	'import {Effect, Option} from "effect";',
	'import * as Stream from "effect/Stream";',
	"declare const thing: Effect.Effect<number, Error>;",
	"export const a = Effect.catch(thing, () => Effect.succeed(0));",
	"export const b = thing.pipe(Effect.catch(() => Effect.succeed(0)));",
	"export const c = Stream.catch(Stream.make(1), () => Stream.make(2));",
	"export const d = Option.some(1);",
	"export const e = Effect.gen(function* () { return yield* thing; });",
	"declare const other: {promise: () => number; tryPromise: () => number};",
	"export const f = other.promise() + other.tryPromise();",
].join("\n");

// Oxlint's syntax-only edge comment covers the next physical line.
const edges = [
	'import {Effect} from "effect";', // 1
	"declare const p: Promise<number>;", // 2
	"// oxlint-disable-next-line fabrika/no-promises -- edge: a Durable Object method must answer a Promise", // 3
	"export const a = Effect.tryPromise(() => p);", // 4: passes
	"// oxlint-disable-next-line fabrika/no-promises -- edge: the highlighter loads once, on first use", // 5
	'export const b = Effect.cached(Effect.tryPromise(() => import("./x.ts")));', // 6: two fires, one comment
	"// oxlint-disable-next-line fabrika/no-promises -- edge: a blank line comes between", // 7: unused
	"", // 8
	"export const c = Effect.tryPromise(() => p);", // 9: fires
	"// oxlint-disable-next-line fabrika/no-promises -- edge: a call over two lines", // 10
	"export const d = Effect.tryPromise({", // 11: passes
	"\ttry: async () => 1,", // 12: fires, the comment does not reach it
	'\tcatch: () => new Error("x"),', // 13
	"});", // 14
].join("\n");

describe("no-promises", async () => {
	it("refuses an unmarked mapped Workers RPC call in every resolved Effect bridge spelling", () => {
		fc.assert(
			fc.property(
				fc.stringMatching(/^[a-z]{1,8}$/),
				fc.constantFrom("tryPromise", "promise"),
				fc.nat({max: 8}),
				fc.boolean(),
				fc.constantFrom(...bridgeSpellings),
				(suffix, method, gap, marked, spelling) => {
					const {file, source, line} = rpcSource(suffix, method, gap, marked, spelling);
					expect(typed({[file]: source}, true).map((f) => ({file: f.file, line: f.line}))).toEqual(
						marked ? [] : [{file, line}],
					);
				},
			),
			{
				seed: 119120,
				numRuns: 12,
				// P12 review 7: the marker covered Effect.tryPromise, but not rpc.describe below it.
				// P12 review 8: renamed imports and computed access hid the same RPC call.
				// P12 review 9: wrappers and local aliases bypassed bridge recognition.
				examples: (["tryPromise", "promise"] as const).flatMap((method) =>
					bridgeSpellings.map(
						(spelling): [string, typeof method, number, boolean, typeof spelling] => [
							"",
							method,
							0,
							false,
							spelling,
						],
					),
				),
			},
		);
	});
	it.each(["tryPromise", "promise"] as const)(
		"pinned: P12 cannot identify Effect.%s through a key that may select sync",
		(method) => {
			// A cast does not prove which declaration a runtime key selects. Guessing would
			// flag synchronous calls too, so the unresolved RPC return is missed here.
			const {file, source} = rpcSource("", method, 0, false, "unresolvedKey");
			expect(typed({[file]: source}, true)).toEqual([]);
		},
	);
	it("pinned: P12 cannot distinguish a bare never-returning RPC from a synchronous throw", () => {
		// The installed Workers mapping erases Promise<unknown> to never. Without an
		// Effect bridge, catching it also flags the real synchronous throw helpers.
		const {file, source} = rpcSource("", "promise", 0, false, "bare");
		expect(typed({[file]: source}, true)).toEqual([]);
	});
	it("leaves declared never throw helpers outside a Promise bridge alone", () => {
		fc.assert(
			fc.property(fc.stringMatching(/^[a-z]{1,8}$/), (suffix) => {
				const file = "next/throw.ts";
				const source = [`declare function fail${suffix}(): never;`, `fail${suffix}();`].join("\n");
				expect(typed({[file]: source})).toEqual([]);
			}),
			{seed: 119120, numRuns: 12},
		);
	});
	it("leaves any, unknown, generic and unresolved calls outside Promise bridges alone", () => {
		fc.assert(
			fc.property(fc.stringMatching(/^[a-z]{1,8}$/), (suffix) => {
				const file = "next/sync.ts";
				expect(
					typed({
						[file]: [
							`declare function any${suffix}(): any;`,
							`declare function unknown${suffix}(): unknown;`,
							`declare function identity${suffix}<A>(value: A): A;`,
							`any${suffix}(); unknown${suffix}();`,
							`export function generic${suffix}<A>(value: A) { return identity${suffix}(value); }`,
							"// @ts-ignore -- plant: an unresolved name gives the checker an error type",
							`missing${suffix}();`,
						].join("\n"),
					}),
				).toEqual([]);
			}),
			{seed: 119120, numRuns: 12},
		);
	});
	it("recognizes Effect's bridge declarations rather than another module with the same names", () => {
		fc.assert(
			fc.property(
				fc.stringMatching(/^[a-z]{1,8}$/),
				fc.constantFrom("tryPromise", "promise"),
				fc.constantFrom(...bridgeSpellings),
				(suffix, method, spelling) => {
					const {file, source} = rpcSource(suffix, method, 0, false, spelling);
					expect(
						typed(
							{
								[file]: source
									.replaceAll('"effect/Effect"', '"./lookalike-functions"')
									.replaceAll('"effect"', '"./lookalike"'),
								"next/lookalike.ts": 'export * as Effect from "./lookalike-functions";',
								"next/lookalike-functions.ts": [
									"export declare const tryPromise: <A>(options: {try: () => PromiseLike<A>; catch: () => Error}) => number;",
									"export declare const promise: <A>(fn: () => PromiseLike<A>) => number;",
								].join("\n"),
							},
							true,
						),
					).toEqual([]);
				},
			),
			{seed: 119120, numRuns: 12},
		);
	});
	it("The edge comment covers the next line and only that line", () => {
		fc.assert(
			fc.property(markedEdge, fc.nat({max: 8}), ([method, rule, indent], gap) => {
				const file = "next/wrapped.ts";
				expect(
					typed({[file]: wrappedEdge(method, rule, indent, gap)}).map((f) => ({
						file: f.file,
						line: f.line,
					})),
				).toEqual([{file, line: (method === "runPromise" ? 11 : 10) + gap}]);
			}),
			{
				seed: 119120,
				numRuns: 12,
				// P12 wrapped-edge bug: a statement-wide marker hid later Promise calls.
				examples: [[["tryPromise", "fabrika/no-promises", "\t"], 0]],
			},
		);
	});
	it("refuses the unmarked statement immediately after a wrapped marked statement", () => {
		fc.assert(
			fc.property(markedEdge, fc.boolean(), ([method, rule, indent], sameLine) => {
				const file = "next/wrapped.ts";
				const before = wrappedEdge(method, rule, indent);
				const line = before.split("\n").length + (sameLine ? 0 : 1);
				const source = `${before}${sameLine ? " " : "\n"}platform.read();`;
				expect(typed({[file]: source}).map((f) => ({file: f.file, line: f.line}))).toEqual([
					{file, line: method === "runPromise" ? 11 : 10},
					{file, line},
				]);
			}),
			{seed: 119120, numRuns: 12},
		);
	});
	it("pinned: the P12 storage-method gap refuses unmarked returned Promises", () => {
		const file = "next/apps/fabrika/src/storage-method.ts";
		const findings = typed({
			[file]: [
				"declare const storage: {put(key: string, value: unknown): Promise<void>};",
				"export class Process {",
				'  configure(value: unknown) { return storage.put("descriptor", value); }',
				"}",
			].join("\n"),
		});
		expect(findings.filter((f) => f.file === file).map((f) => f.line)).toContain(3);
	});
	it("refuses Promise values, inferred returns, imported aliases and thunks outside one marked line", () => {
		fc.assert(
			fc.property(fc.stringMatching(/^[a-z]{1,8}$/), (suffix) => {
				const file = `next/case-${suffix}.ts`;
				const findings = typed({
					"next/binding.ts":
						"export type Later<T> = Promise<T>; export declare const platform: {read(): Later<number>};",
					[file]: [
						'import {platform, type Later} from "./binding";',
						"declare const p: Later<number>;",
						"const identity = (value: Later<number>) => value;",
						"const thunk = (send: () => Later<number>) => send;",
						"const inferred = () => platform.read();",
						"const take = <A>(send: () => Promise<A>) => send;",
						"identity(p);",
						"take(() => platform.read());",
						"thunk(platform.read);",
						"// oxlint-disable-next-line fabrika/no-promises -- edge: platform read enters Effect",
						"const edge = () => platform.read();",
						"const afterEdge = () => platform.read();",
						"// oxlint-disable-next-line fabrika/no-promises -- edge: covers only the next line",
						"const twoLines = () => {",
						"  return platform.read();",
						"};",
						"void [inferred, edge, afterEdge, twoLines];",
					].join("\n"),
					"next/allowed.ts":
						"export const read = (n: number) => n; export const f = () => read(1); export const domain = () => ({then: 1});",
					"next/runner.ts": [
						"declare const runner: {runPromise(n: number): Promise<number>};",
						"// oxlint-disable-next-line fabrika/no-effect-run-outside-edge -- edge: platform method returns a Promise",
						"export const run = () => runner.runPromise(1);",
					].join("\n"),
					"next/allowed.test.ts": "declare const p: Promise<number>; export const f = () => p;",
					"next/helper.test-support.ts":
						"declare const p: Promise<number>; export const f = () => p;",
					"packages/today.ts": "declare const p: Promise<number>; export const f = () => p;",
				});
				expect(findings.filter((f) => f.file === file).map((f) => f.line)).toEqual([
					3, 4, 5, 6, 7, 8, 9, 12, 15,
				]);
				expect(findings.filter((f) => f.file !== file)).toEqual([]);
			}),
			{seed: 119120, numRuns: 20},
		);
	});
	const all = await plant({
		[FIRES]: fires,
		[PASSES]: passes,
		[EDGE]: edges,
		"next/packages/libfabrika/src/app/fires.test.ts": "export const t = async () => await 1;",
		"packages/today/src/old.ts": "export const t = async () => 1;",
	});

	it("fires on every Promise shape", () => {
		expect(all(CODE, FIRES)).toEqual([
			3, 4, 6, 6, 7, 8, 9, 10, 11, 12, 13, 14, 14, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28,
			30,
		]);
	});

	it("passes a line under an edge comment, and only that line", () => {
		expect(all(CODE, EDGE)).toEqual([9, 12]);
		// The comment over the blank line silences nothing, so oxlint calls it unused.
		expect(all("", EDGE)).toEqual([7]);
	});

	it("passes Effect's own catch, a generator, a module named Stream and a `promise` not Effect's", () => {
		expect(all(CODE, PASSES)).toEqual([]);
	});

	it("leaves tests and today's code alone", () => {
		expect(all(CODE, "next/packages/libfabrika/src/app/fires.test.ts")).toEqual([]);
		expect(all(CODE, "packages/today/src/old.ts")).toEqual([]);
	});
});
