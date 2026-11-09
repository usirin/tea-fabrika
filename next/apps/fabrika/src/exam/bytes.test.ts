// P8, next/, p61/p64. P12 owns the real Rolldown config and brain entry. Temporary bundles below
// test the inspector. They are not a second product build and prove nothing about workerd.
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join, relative, resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {Effect} from "effect";
import {rolldown, type InputOptions} from "rolldown";
import {afterAll, describe, expect, it, vi} from "vitest";

type Graph = {
	readonly modules: readonly string[];
	readonly edges: readonly string[];
	readonly chunks: readonly {
		readonly file: string;
		readonly bytes: number;
		readonly modules: readonly string[];
		readonly imports: readonly string[];
		readonly dynamic: readonly string[];
	}[];
};
const inspect = async (options: InputOptions): Promise<Graph> => {
	const modules = new Set<string>(),
		edges = new Set<string>();
	const bundle = await rolldown({
		...options,
		plugins: [
			options.plugins,
			{
				name: "p8-module-exam",
				moduleParsed(info) {
					modules.add(info.id);
					for (const id of [...info.importedIds, ...info.dynamicallyImportedIds]) edges.add(id);
				},
				buildEnd() {
					for (const id of this.getModuleIds()) {
						modules.add(id);
						const info = this.getModuleInfo(id);
						if (info)
							for (const edge of [...info.importedIds, ...info.dynamicallyImportedIds])
								edges.add(edge);
					}
				},
			},
		],
	});
	try {
		const output = await bundle.generate({format: "es", minify: true});
		const chunks = output.output.flatMap((o) =>
			o.type === "chunk"
				? [
						{
							file: o.fileName,
							bytes: Buffer.byteLength(o.code),
							modules: o.moduleIds,
							imports: o.imports,
							dynamic: o.dynamicImports,
						},
					]
				: [],
		);
		return {modules: [...modules].sort(), edges: [...edges].sort(), chunks};
	} finally {
		await bundle.close();
	}
};
const brain = (id: string) => /(?:^|\/)@modelcontextprotocol\//.test(id.replaceAll("\\", "/"));
const notes = (id: string) =>
	/(?:^|\/)(?:micromark[^/]*|mdast[^/]*|@pierre\/[^/]+|react(?:-dom)?|@kampus\/tuval)(?:\/|$)/.test(
		id.replaceAll("\\", "/"),
	);
const check = (graph: Graph, forbidden: (id: string) => boolean) => {
	const ids = [
		...graph.modules,
		...graph.edges,
		...graph.chunks.flatMap((c) => [...c.modules, ...c.imports, ...c.dynamic]),
	];
	for (const id of ids) expect(forbidden(id), `forbidden dependency reached: ${id}`).toBe(false);
};
const top = realpathSync(mkdtempSync(join(tmpdir(), "p8-bytes-")));
afterAll(() => rmSync(top, {recursive: true, force: true}));
const file = (root: string, path: string, text: string) => {
	mkdirSync(dirname(join(root, path)), {recursive: true});
	writeFileSync(join(root, path), text);
};
const plant = (pkg: string, how: "used" | "transitive" | "external" | "dynamic") => {
	const root = mkdtempSync(join(top, "b-"));
	file(
		root,
		`node_modules/${pkg}/package.json`,
		JSON.stringify({name: pkg, type: "module", exports: "./index.js"}),
	);
	file(root, `node_modules/${pkg}/index.js`, "export const leak = 'used forbidden value';");
	file(root, "middle.js", `export {leak} from '${pkg}';`);
	const text =
		how === "transitive"
			? "export {leak} from './middle.js';"
			: how === "dynamic"
				? `export const load = () => import('${pkg}');`
				: `export {leak} from '${pkg}';`;
	file(root, "entry.js", text);
	return {
		root,
		options: {input: join(root, "entry.js"), ...(how === "external" ? {external: [pkg]} : {})},
	};
};
const print = (graph: Graph, root: string) => {
	console.info(
		JSON.stringify({
			modules: graph.modules.map((s) => (s.startsWith(root) ? relative(root, s) : s)),
			edges: graph.edges.map((s) => (s.startsWith(root) ? relative(root, s) : s)),
			scripts: graph.chunks.map(({file, bytes}) => ({file, bytes})),
		}),
	);
};
describe("real Rolldown inspection, temporary entries only", () => {
	it("clean control includes the resolved modules and prints sizes without a cap", async () => {
		const root = mkdtempSync(join(top, "clean-"));
		file(root, "entry.js", "export const clean = 42;");
		const graph = await inspect({input: join(root, "entry.js")});
		check(graph, brain);
		check(graph, notes);
		expect(graph.modules).toContain(join(root, "entry.js"));
		expect(graph.chunks).toHaveLength(1);
		print(graph, root);
	});
	for (const how of ["used", "transitive", "external", "dynamic"] as const)
		for (const [pkg, forbidden] of [
			["@modelcontextprotocol/server", brain],
			["react", notes],
		] as const)
			it(`plant: ${how} ${pkg} is a dependency leak`, async () => {
				const p = plant(pkg, how),
					graph = await inspect(p.options);
				print(graph, p.root);
				expect(() => check(graph, forbidden)).toThrow(/forbidden dependency reached/);
				if (how === "dynamic") expect(graph.chunks.some((c) => c.dynamic.length > 0)).toBe(true);
				if (how === "external")
					expect(graph.chunks.some((c) => c.imports.includes(pkg))).toBe(true);
			});
	for (const pkg of [
		"micromark",
		"mdast-util-from-markdown",
		"@pierre/highlights",
		"react-dom",
		"@kampus/tuval",
	])
		it(`plant: notes core imports ${pkg}`, async () => {
			const p = plant(pkg, "used"),
				graph = await inspect(p.options);
			expect(() => check(graph, notes)).toThrow(/forbidden dependency reached/);
		});
});

// Discovery decides absence before import. Once any code exists, absent entries, missing exports,
// undeclared dependencies and module-load failures are failures, not a "not built" result.
const sources = (dir: string): string[] =>
	!existsSync(dir)
		? []
		: readdirSync(dir, {withFileTypes: true}).flatMap((e) =>
				e.isDirectory() && e.name !== "node_modules"
					? sources(join(dir, e.name))
					: /\.(ts|tsx|js|mjs)$/.test(e.name) && !/\.test\./.test(e.name)
						? [join(dir, e.name)]
						: [],
			);
const target = (dir: string, entry: string): string | null => {
	if (sources(dir).length === 0) return null;
	if (!existsSync(join(dir, entry))) throw new Error(`incomplete target: ${entry}`);
	return join(dir, entry);
};
const load = async (dir: string, entry: string) => {
	const found = target(dir, entry);
	if (found === null) return null;
	const loaded: unknown = await import(pathToFileURL(found).href);
	if (
		typeof loaded !== "object" ||
		loaded === null ||
		!("binding" in loaded) ||
		typeof loaded.binding !== "function"
	)
		throw new Error("incomplete target: missing binding export");
	return loaded.binding;
};
describe("exam coverage", () => {
	it("absence is reported, an incomplete directory fails", async () => {
		const dir = mkdtempSync(join(top, "target-"));
		expect(await load(dir, "entry.mjs")).toBeNull();
		file(dir, "partial.ts", "export const partial=1;");
		await expect(load(dir, "entry.mjs")).rejects.toThrow("incomplete target");
	});
	it("clean complete binding loads", async () => {
		const dir = mkdtempSync(join(top, "target-"));
		file(dir, "entry.mjs", "export const binding=() => 42;");
		expect(await load(dir, "entry.mjs")).toBeTypeOf("function");
	});
	for (const [name, source, why] of [
		["missing export", "export const wrong=1;", /missing binding/],
		["broken adapter", "throw new Error('broken adapter');", /broken adapter/],
		[
			"missing dependency",
			"import 'p8-undeclared-dependency'; export const binding=() => 1;",
			/p8-undeclared-dependency/,
		],
	] as const)
		it(`plant: ${name} cannot be swallowed as absence`, async () => {
			const dir = mkdtempSync(join(top, "target-"));
			file(dir, "entry.mjs", source);
			await expect(load(dir, "entry.mjs")).rejects.toThrow(why);
		});
});
const next = resolve(import.meta.dirname, "../../../..");

const capture = vi.hoisted((): {graphs: Graph[]} => ({graphs: []}));
vi.mock("rolldown", async (importOriginal) => {
	const sdk = await importOriginal<typeof import("rolldown")>();
	return {
		...sdk,
		rolldown: async (options: InputOptions) => {
			const modules = new Set<string>(),
				edges = new Set<string>();
			return sdk.rolldown({
				...options,
				plugins: [
					options.plugins,
					{
						name: "p25-real-build-exam",
						moduleParsed(info) {
							modules.add(info.id);
							for (const id of [...info.importedIds, ...info.dynamicallyImportedIds]) edges.add(id);
						},
						generateBundle(_options, output) {
							capture.graphs.push({
								modules: [...modules],
								edges: [...edges],
								chunks: Object.values(output).flatMap((o) =>
									o.type === "chunk"
										? [
												{
													file: o.fileName,
													bytes: Buffer.byteLength(o.code),
													modules: o.moduleIds,
													imports: o.imports,
													dynamic: o.dynamicImports,
												},
											]
										: [],
								),
							});
						},
					},
				],
			});
		},
	};
});

it("L29 real P12 brain and P13 core bundle graphs exclude MCP on external/dynamic edges", async () => {
	const graphs = capture.graphs;
	graphs.length = 0;
	const out = mkdtempSync(join(top, "real-"));
	{
		const {build} = await import("../build.ts");
		await Effect.runPromise(build({out, programs: {notes: "@kampus/notes"}}));
		expect(graphs.length).toBeGreaterThanOrEqual(2);
		for (const graph of graphs) {
			check(graph, brain);
			print(graph, next);
		}
		const notesGraph = graphs.find((g) => g.modules.some((id) => id.includes("/programs/notes/")));
		expect(notesGraph).toBeDefined();
		check(notesGraph!, notes);
		const core = await inspect({
			input: resolve(next, "packages/libfabrika/src/index.ts"),
			platform: "browser",
		});
		check(core, brain);
	}
});
