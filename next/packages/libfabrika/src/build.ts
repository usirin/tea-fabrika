// The one-file build (Tier 1, P12 and P16): every selected program as a sealed Worker Loader module,
// every window script, chunk and stylesheet, and the brain that carries them all as text. Nothing
// is published until every bundle and the Compiler check pass; a failure keeps the last good file.
import {readFileSync} from "node:fs";
import {basename, dirname, isAbsolute, relative, resolve} from "node:path";
import {Effect, Exit, FileSystem, Option, Schema} from "effect";
import type {OutputAsset, OutputChunk, Plugin} from "rolldown";
import {
	Asset,
	type AssetType,
	Built as Tables,
	BuildError,
	type BuiltProgram,
	sha256,
} from "./app/built.ts";
import {check, compile, Row} from "./compiler.ts";
import {bundle, bundlePrograms} from "./node/build.ts";

export {BuildError} from "./app/built.ts";

/** One program the client selects: its package, and the export that holds its declaration. */
export type Selection = {readonly name: string; readonly package: string; readonly export: string};
export type Built = {
	/** The SHA-256 of the brain file's bytes. */
	readonly build: string;
	readonly brain: string;
	readonly programs: Readonly<Record<string, BuiltProgram>>;
	readonly assets: Readonly<Record<string, Asset>>;
};
export type Options = {
	readonly out: string;
	/** Where the Compiler ledger lives, and what its paths and the bundles' module ids are relative to. */
	readonly root: string;
	/** The brain's entry module. Package names resolve from its folder. */
	readonly entry: string;
	readonly programs: ReadonlyArray<Selection>;
	/** `.tsx` files the Compiler checks beyond those the bundles reach. Only brain.mjs is published. */
	readonly files?: ReadonlyArray<string>;
	/** The Compiler ledger. Read from `<root>/compiler-ledger.json` when absent. */
	readonly ledger?: ReadonlyArray<Row>;
	readonly chaos: boolean;
};

/** The module the brain imports its tables from (`build-modules.d.ts`). */
const BUILT_MODULE = "virtual:fabrika-built";
const TEXT = "\0fabrika-text:";
const WINDOW = "fabrika:window:";
const NAME = /^[A-Za-z_][\w-]*$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const Manifest = Schema.Struct({
	exports: Schema.optionalKey(
		Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.Unknown)]),
	),
});
const fail = (why: BuildError["why"]) => () => new BuildError({why});

// The window a selected package exports, if any. A path, not a package name, has no manifest.
const findWindow = Effect.fn("build.manifest")(function* (from: string, selected: string) {
	if (selected.startsWith(".") || isAbsolute(selected)) return Option.none<string>();
	const fs = yield* FileSystem.FileSystem;
	for (let dir = from; ; dir = dirname(dir)) {
		const file = resolve(dir, "node_modules", selected, "package.json");
		if (yield* fs.exists(file).pipe(Effect.mapError(fail("table")))) {
			const manifest = yield* fs
				.readFileString(file)
				.pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Manifest))),
					Effect.mapError(fail("table")),
				);
			const exports = manifest.exports;
			return typeof exports === "object" && Object.hasOwn(exports, "./window")
				? Option.some(`${selected}/window`)
				: Option.none<string>();
		}
		if (dirname(dir) === dir) return Option.none<string>();
	}
});

const contentType = (file: string): AssetType | undefined =>
	file.endsWith(".js")
		? "text/javascript; charset=utf-8"
		: file.endsWith(".css")
			? "text/css; charset=utf-8"
			: undefined;

// Each emitted window file, under its own route. Two files on one route stop the build.
const collect = Effect.fn("build.collect")(function* (
	output: ReadonlyArray<OutputChunk | OutputAsset>,
) {
	const assets: Record<string, Asset> = {};
	for (const item of output) {
		const route = `/${item.fileName}`,
			type = contentType(item.fileName);
		if (type === undefined || Object.hasOwn(assets, route))
			return yield* new BuildError({why: "bundle"});
		const body =
			item.type === "chunk"
				? item.code
				: typeof item.source === "string"
					? item.source
					: new TextDecoder().decode(item.source);
		assets[route] = yield* Asset.makeEffect({hash: sha256(body), type, body}).pipe(
			Effect.mapError(fail("output")),
		);
	}
	return assets;
});

// A stylesheet a window imports becomes an asset of its own; the script keeps no trace of it.
// Rolldown calls this hook outside Effect, so it reads the file directly; a throw fails the bundle.
const stylesheets: Plugin = {
	name: "fabrika-css",
	load(id) {
		if (!id.endsWith(".css")) return;
		this.emitFile({type: "asset", name: basename(id), source: readFileSync(id, "utf8")});
		return {code: "", moduleType: "js"};
	},
};

// The brain's tables, with every compiled body as a text module: embedded, never parsed as code.
const embed = (tables: Tables): Plugin => {
	const texts: Array<string> = [];
	const text = (body: string) => `t${texts.push(body) - 1}`;
	const programs = Object.entries(tables.programs).map(
		([name, p]) =>
			`${JSON.stringify(name)}: {hash: ${JSON.stringify(p.hash)}, source: ${text(p.source)}}`,
	);
	const assets = Object.entries(tables.assets).map(
		([route, a]) =>
			`${JSON.stringify(route)}: {hash: ${JSON.stringify(a.hash)}, type: ${JSON.stringify(a.type)}, body: ${text(a.body)}}`,
	);
	const imports = texts.map((_, n) => `import t${n} from ${JSON.stringify(`${TEXT}${n}`)};`);
	const code = [
		...imports,
		`export const programs = {${programs.join(", ")}};`,
		`export const assets = {${assets.join(", ")}};`,
	].join("\n");
	return {
		name: "fabrika-built",
		resolveId(id) {
			if (id === BUILT_MODULE) return `\0${BUILT_MODULE}`;
			if (id.startsWith(TEXT)) return id;
		},
		load(id) {
			if (id === `\0${BUILT_MODULE}`) return code;
			if (id.startsWith(TEXT))
				return {code: texts[Number(id.slice(TEXT.length))] ?? "", moduleType: "text"};
		},
	};
};

const recorded = <A, E, R>(work: Effect.Effect<A, E, R>) =>
	work.pipe(
		Effect.onExit((exit) =>
			Effect.annotateCurrentSpan(
				Exit.isSuccess(exit)
					? {outcome: "success"}
					: {outcome: "failure", "error.type": "BuildError"},
			),
		),
	);

// Write the brain beside `out`, then swap it in: all or nothing.
const publish = Effect.fn("build.emit")(function* (
	out: string,
	brain: string,
	sizes: {readonly programs: number; readonly window: number},
) {
	const fs = yield* FileSystem.FileSystem;
	const digest = sha256(brain);
	yield* Effect.annotateCurrentSpan({
		"brain.hash": digest,
		"brain.bytes": Buffer.byteLength(brain),
		"programs.bytes": sizes.programs,
		"window.bytes": sizes.window,
	});
	const swap = Effect.gen(function* () {
		yield* fs.makeDirectory(dirname(out), {recursive: true});
		const pending = yield* fs.makeTempDirectory({
			directory: dirname(out),
			prefix: ".fabrika-build-",
		});
		const backup = `${pending}.old`;
		yield* Effect.gen(function* () {
			yield* fs.writeFileString(resolve(pending, "brain.mjs"), brain);
			const had = yield* fs.exists(out);
			if (had) yield* fs.rename(out, backup);
			yield* fs
				.rename(pending, out)
				.pipe(Effect.tapError(() => (had ? fs.rename(backup, out) : Effect.void)));
		}).pipe(
			Effect.ensuring(
				Effect.all(
					[
						fs.remove(pending, {recursive: true, force: true}),
						fs.remove(backup, {recursive: true, force: true}),
					],
					{concurrency: 1},
				).pipe(Effect.ignore),
			),
		);
	});
	yield* recorded(swap.pipe(Effect.mapError(fail("output"))));
	return digest;
});

export const build = Effect.fn("build.build")(function* (options: Options) {
	const fs = yield* FileSystem.FileSystem;
	yield* Effect.annotateCurrentSpan({chaos: options.chaos, programs: options.programs.length});
	const names = options.programs.map((p) => p.name);
	if (
		new Set(names).size !== names.length ||
		!options.programs.every((p) => NAME.test(p.name) && IDENTIFIER.test(p.export))
	)
		return yield* new BuildError({why: "table"});
	const root = yield* fs.realPath(options.root).pipe(Effect.mapError(fail("table")));
	const entry = yield* fs.realPath(options.entry).pipe(Effect.mapError(fail("table")));
	const from = dirname(entry);
	const ledger =
		options.ledger ??
		(yield* fs
			.readFileString(resolve(root, "compiler-ledger.json"))
			.pipe(
				Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Row)))),
				Effect.mapError(fail("compiler")),
			));
	// Listed files and every file a bundle reaches go through the one Compiler check.
	const files = new Map<string, string>();
	// A listed file keeps the path it was listed by, as the ledger's rows name it.
	for (const listed of options.files ?? []) {
		const file = resolve(options.root, listed),
			path = relative(options.root, file);
		const text = yield* fs.readFileString(file).pipe(Effect.mapError(fail("compiler")));
		files.set(path, text);
	}
	const compiler: Plugin = {
		name: "fabrika-compiler",
		transform(code, id) {
			if (!id.endsWith(".tsx")) return;
			files.set(relative(root, id), code);
			return {code: compile(id, code).code};
		},
	};
	const windows: Record<string, string> = {};
	for (const p of options.programs) {
		const found = yield* findWindow(from, p.package);
		if (Option.isSome(found)) windows[p.name] = found.value;
	}
	const programs = yield* bundlePrograms({
		root: from,
		cwd: root,
		plugins: [compiler],
		programs: Object.fromEntries(
			options.programs.map((p) => [p.name, {module: p.package, name: p.export}]),
		),
	});
	const generated = (name: string) => resolve(from, `window.${name}.generated.ts`);
	const entries: Plugin = {
		name: "fabrika-window",
		resolveId(id) {
			if (id.startsWith(WINDOW)) return generated(id.slice(WINDOW.length));
		},
		load(id) {
			for (const [name, module] of Object.entries(windows))
				if (id === generated(name)) return `export * from ${JSON.stringify(module)};`;
		},
	};
	const assets = Object.keys(windows).length
		? yield* bundle(
				Object.fromEntries(Object.keys(windows).map((name) => [name, `${WINDOW}${name}`])),
				[entries, compiler, stylesheets],
				{
					phase: "window",
					cwd: root,
					split: true,
					define: {"process.env.NODE_ENV": JSON.stringify("production")},
				},
			).pipe(Effect.flatMap((o) => collect(o.output)))
		: {};
	const tables = yield* Tables.makeEffect({programs, assets}).pipe(Effect.mapError(fail("output")));
	const output = yield* bundle(entry, [compiler, embed(tables)], {phase: "brain", cwd: root});
	const brain = output.output
		.filter((o) => o.type === "chunk")
		.map((o) => o.code)
		.join("\n");
	// Every module a bundle reached is in `files` now: check them all, and the ledger for stale rows.
	if (check(files, ledger).length) return yield* new BuildError({why: "compiler"});
	const size = (bodies: ReadonlyArray<string>) =>
		bodies.reduce((total, body) => total + Buffer.byteLength(body), 0);
	const digest = yield* publish(options.out, brain, {
		programs: size(Object.values(programs).map((p) => p.source)),
		window: size(Object.values(assets).map((a) => a.body)),
	});
	return {
		build: digest,
		brain: resolve(options.out, "brain.mjs"),
		programs: tables.programs,
		assets: tables.assets,
	} satisfies Built;
});
