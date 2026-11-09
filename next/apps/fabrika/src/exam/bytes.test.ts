// P8, next/. p61/p64/p65. Observe P12's actual build, including its embedded program bundles.
// Source: next/apps/fabrika/src/build.test.ts at 9b48d622b5d4. Existing p65 laws stay intact.
import {NodeServices} from "@effect/platform-node";
import {expect, it} from "@effect/vitest";
import {bundle, bundlePrograms} from "@kampus/libfabrika/node/build";
import {Arbitrary, Effect, FileSystem, Path, Schema} from "effect";
import type {Plugin} from "rolldown";
import {vi} from "vitest";
import {build} from "../build.ts";

type Module = {
	readonly id: string;
	readonly imports: ReadonlyArray<string>;
	readonly dynamic: ReadonlyArray<string>;
	readonly external: boolean;
	readonly code: string;
};
type Chunk = {
	readonly file: string;
	readonly code: string;
	readonly imports: ReadonlyArray<string>;
	readonly dynamic: ReadonlyArray<string>;
	readonly modules: ReadonlyArray<string>;
};
type Observed = {
	readonly input: unknown;
	readonly modules: ReadonlyArray<Module>;
	readonly chunks: ReadonlyArray<Chunk>;
};
const observations = vi.hoisted(() => ({builds: [] as Observed[]}));
// This wrapper calls the actual Rolldown API. The only clean-build option change is the observer.
vi.mock("rolldown", async (original) => {
	const real = await original<typeof import("rolldown")>();
	return {
		...real,
		rolldown: (options: Parameters<typeof real.rolldown>[0]) => {
			const observer: Plugin = {
				name: "p8-passive-observer",
				generateBundle(_options, output) {
					const ids = new Set(this.getModuleIds());
					const modules = [...ids].map((id) => {
						const info = this.getModuleInfo(id);
						if (info === null) throw new Error(`Rolldown omitted module info: ${id}`);
						return {
							id,
							imports: [...info.importedIds],
							dynamic: [...info.dynamicallyImportedIds],
							external: false,
							code: info.code ?? "",
						};
					});
					const chunks = Object.values(output).flatMap((o) =>
						o.type === "chunk"
							? [
									{
										file: o.fileName,
										code: o.code,
										imports: [...o.imports],
										dynamic: [...o.dynamicImports],
										modules: Object.keys(o.modules),
									},
								]
							: [],
					);
					// Rolldown 1.2.13 has no Rollup isExternal field. Its external edges have no
					// parsed module; retain those resolved IDs alongside emitted imports.
					for (const id of new Set([
						...modules.flatMap((m) => [...m.imports, ...m.dynamic]),
						...chunks.flatMap((c) => [...c.imports, ...c.dynamic]),
					])) {
						if (!ids.has(id))
							modules.push({id, imports: [], dynamic: [], external: true, code: ""});
					}
					observations.builds.push({input: options.input, modules, chunks});
				},
			};
			return real.rolldown({...options, plugins: [...(options.plugins ?? []), observer]});
		},
	};
});
const options = {arbitrary: {seed: 119120, runs: 20, size: 128, concurrency: 1}};
const names = (graph: Observed) => [
	...graph.modules.flatMap((m) => [m.id, ...m.imports, ...m.dynamic]),
	...graph.chunks.flatMap((c) => [...c.imports, ...c.dynamic, ...c.modules]),
];
const mcp = (id: string) =>
	/(?:^|[/\\])@modelcontextprotocol(?:[/\\+]|$)|[/\\]libfabrika[/\\]src[/\\]mcp(?:[/.]|$)/i.test(
		id,
	);
const drawing = (id: string) =>
	/(?:^|[/\\])(?:micromark(?:[-/\\@]|$)|mdast(?:[-/\\@]|$)|@pierre(?:[/\\+]|$)|react(?:[-/\\@]|$)|(?:@kampus[/\\+])?tuval(?:[/\\@]|$))/i.test(
		id,
	);
const clean = (graph: Observed, forbidden: (id: string) => boolean) => {
	expect(graph.modules.length).toBeGreaterThan(0);
	expect(graph.chunks.length).toBeGreaterThan(0);
	expect(names(graph).filter(forbidden)).toEqual([]);
};
const realBrain = (all: ReadonlyArray<Observed>) => {
	const found = all.find((b) => typeof b.input === "string" && b.input.endsWith("/src/brain.ts"));
	if (found === undefined) throw new Error("no actual P12 brain build observed");
	expect(found.modules.some((m) => m.id.endsWith("/src/brain.ts"))).toBe(true);
	expect(found.modules.some((m) => m.id === "\0fabrika-table")).toBe(true);
	return found;
};

it.effect("scenario: P12's real emitted brain and embedded counter source contain no MCP", () =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem,
			path = yield* Path.Path;
		const folder = yield* fs.makeTempDirectoryScoped({prefix: "p8-bytes-"});
		const start = observations.builds.length;
		const built = yield* build({out: path.join(folder, "out")});
		const observed = observations.builds.slice(start),
			brain = realBrain(observed);
		for (const graph of observed) clean(graph, mcp);
		const bytes = yield* fs.readFileString(built.brain);
		expect(bytes).toBe(brain.chunks.map((c) => c.code).join("\n"));
		for (const [name, program] of Object.entries(built.programs)) {
			expect(observed.some((g) => g.chunks.map((c) => c.code).join("\n") === program.source)).toBe(
				true,
			);
			expect(brain.modules.find((m) => m.id === "\0fabrika-table")?.code).toContain(
				JSON.stringify(program.source),
			);
			process.stdout.write(
				`P8 program ${name}: ${new TextEncoder().encode(program.source).byteLength} bytes\n`,
			);
		}
		const root = path.resolve(import.meta.dirname, "../../../../..");
		process.stdout.write(
			`P8 brain: ${new TextEncoder().encode(bytes).byteLength} bytes; modules=${JSON.stringify(observed.flatMap((g) => g.modules.map((m) => (path.isAbsolute(m.id) ? path.relative(root, m.id) : m.id))))}\n`,
		);
		// Plant against the graph of this actual build, never against a substitute entry.
		const planted: Observed = {
			...brain,
			modules: [
				...brain.modules,
				{
					id: "@modelcontextprotocol/client/stdio",
					imports: [],
					dynamic: [],
					external: true,
					code: "",
				},
			],
		};
		expect(() => clean(planted, mcp)).toThrow();
		expect(() => realBrain(observed.filter((g) => g !== brain))).toThrow("no actual P12 brain");
	}).pipe(Effect.provide(NodeServices.layer)),
);

const int = (min: number, max: number) =>
	Schema.Int.check(Schema.isBetween({minimum: min, maximum: max}));
const BundleGraphs = Arbitrary.schema(
	Schema.Struct({
		modules: int(1, 8),
		depth: int(0, 3),
		imports: int(0, 2),
		text: Schema.String.check(Schema.isMinLength(0), Schema.isMaxLength(128)),
	}),
);
// Finite styles all run on every generated graph, including wrapper and dynamic/external edges.
it.effect.prop(
	"checker controls: real Rolldown catches transitive, dynamic and external forbidden imports",
	{g: BundleGraphs},
	({g}) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem,
				path = yield* Path.Path;
			const folder = yield* fs.makeTempDirectoryScoped({prefix: "p8-graph-"});
			for (const style of ["static", "dynamic", "external"] as const) {
				const start = observations.builds.length;
				const depth = Math.min(g.depth, 2);
				const modules = Math.min(
					g.modules,
					g.imports === 0 ? 1 : g.imports === 1 ? depth + 1 : 2 ** (depth + 1) - 1,
				);
				for (let i = 0; i < modules; i++) {
					const children = (g.imports === 2 ? [i * 2 + 1, i * 2 + 2] : [i + 1]).filter(
						(child) => child < modules,
					);
					const next = children
						.map((child) =>
							style === "dynamic"
								? `export const next${child} = () => import("./m${child}.ts");`
								: `export {text as next${child}} from "./m${child}.ts";`,
						)
						.join("\n");
					yield* fs.writeFileString(
						path.join(folder, `m${i}.ts`),
						`export const text = ${JSON.stringify(g.text)}; ${next}`,
					);
				}
				yield* bundle(path.join(folder, "m0.ts"), []);
				const graph = observations.builds[start];
				if (!graph) return yield* Effect.die("observer did not see graph");
				clean(graph, mcp);
				clean(graph, drawing);
				for (const forbidden of [
					"@modelcontextprotocol/client/stdio",
					"micromark/lib/parse",
					"mdast-util-from-markdown",
					"@pierre/highlights",
					"react/jsx-runtime",
					"@kampus/tuval",
				]) {
					// The edge is deliberately external, so tree shaking cannot conceal its package name.
					const leaf = path.join(folder, `m${modules - 1}.ts`);
					yield* fs.writeFileString(
						leaf,
						`export const text = ${JSON.stringify(g.text)}; ${style === "dynamic" ? `export const bad = () => import(${JSON.stringify(forbidden)});` : `export * from ${JSON.stringify(forbidden)};`}`,
					);
					const n = observations.builds.length;
					yield* bundle(path.join(folder, "m0.ts"), [
						{
							name: "p8-forbidden-external",
							resolveId(id) {
								if (id === forbidden) return {id, external: true};
							},
						},
					]);
					const bad = observations.builds[n];
					if (!bad) return yield* Effect.die("no planted graph");
					expect(() =>
						clean(bad, forbidden.startsWith("@modelcontextprotocol") ? mcp : drawing),
					).toThrow();
				}
			}
		}).pipe(Effect.provide(NodeServices.layer)),
	options,
);

it.effect(
	"not built: P13 / notes top level through P12's programBox has no drawing dependencies",
	(ctx) =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem,
				path = yield* Path.Path;
			const root = path.resolve(import.meta.dirname, "../..");
			const notes = path.resolve(root, "../../programs/notes");
			if (!(yield* fs.exists(notes))) ctx.skip("not built: P13 notes core bytes");
			// Any partial package or failed import fails here. P13 declares this dependency in its tests step.
			const start = observations.builds.length;
			const programs = yield* bundlePrograms({
				root,
				programs: {notes: {module: "@kampus/notes", name: "program"}},
				plugins: [],
			});
			for (const graph of observations.builds.slice(start)) {
				clean(graph, drawing);
				clean(graph, mcp);
			}
			expect(programs.notes?.source.length).toBeGreaterThan(0);
			process.stdout.write(
				`P8 notes core: ${new TextEncoder().encode(programs.notes?.source ?? "").byteLength} bytes\n`,
			);
		}).pipe(Effect.provide(NodeServices.layer)),
);
