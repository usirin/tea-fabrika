import {BuildError, bundle, bundlePrograms, hash} from "@kampus/libfabrika/node/build";
import {page, type Style} from "@kampus/tuval/page";
import {Effect, FileSystem, Path, Schema} from "effect";
import {type InputOptions, type Plugin, rolldown} from "rolldown";
import {check, compile, Row} from "./exam/compiler.ts";

export type Built = {
	readonly build: string;
	readonly brain: string;
	readonly programs: Readonly<Record<string, {readonly hash: string; readonly source: string}>>;
	/** The window's page, with every style text embedded in order (P14). A build always has it; a
	 *  stage given a brain alone serves no window. */
	readonly page?: string;
	/** The browser bundle the brain serves at `/window.js`. */
	readonly script?: string;
	readonly style?: ReadonlyArray<Style>;
};
type Options = {
	readonly out: string;
	readonly files?: ReadonlyArray<string>;
	readonly ledger?: ReadonlyArray<Row>;
	readonly programs?: Readonly<Record<string, string>>;
	/** The tab's entry module, through the same Compiler check. Default `src/entry/browser.tsx`. */
	readonly browser?: string;
};

/** The window's style texts in the order the page applies them: Manti's, then fabrika's tokens,
 *  then Tuval's own rules. */
const STYLES = [
	["manti", "@manti-ui/styles/index.css"],
	["tokens", "@kampus/fabrika-design/tokens.css"],
	["tuval", "@kampus/tuval/style.css"],
] as const;

/** Effect probes for Node's `async_hooks` through `globalThis.process`, which a tab never has. The
 *  probe is dead in a browser, so the tab's bundle drops it and names no Node module. */
const NODE_PROBE = 'globalThis.process?.getBuiltinModule?.("node:async_hooks")';
const browserOnly: Plugin = {
	name: "fabrika-browser-only",
	transform(code, id) {
		if (id.includes("/effect/dist/") && code.includes(NODE_PROBE))
			return {code: code.replace(NODE_PROBE, "undefined")};
	},
};

/** The browser bundle: one self-contained ES module, React in its production build. */
const browserBundle = Effect.fn("build.browser")(function* (input: string, plugins: Array<Plugin>) {
	const options: InputOptions = {
		input,
		plugins: [...plugins, browserOnly],
		// Rolldown notes each "use client" it drops; a bundle for one tab has no server half.
		onLog: (level, log, handler) => {
			if (log.code !== "MODULE_LEVEL_DIRECTIVE") handler(level, log);
		},
		platform: "browser",
		transform: {define: {"process.env.NODE_ENV": JSON.stringify("production")}},
	};
	const fail = (error: unknown) => new BuildError({reason: "bundle", message: String(error)});
	// oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown's build API returns a Promise
	const built = yield* Effect.tryPromise({try: () => rolldown(options), catch: fail});
	const output = yield* Effect.acquireUseRelease(
		Effect.succeed(built),
		(b) => {
			const fail = (error: unknown) => new BuildError({reason: "generate", message: String(error)});
			const options = {format: "esm" as const, codeSplitting: false, minify: true};
			// oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown generates through a Promise
			return Effect.tryPromise({try: () => b.generate(options), catch: fail});
		},
		// oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown closes through a Promise
		(b) => Effect.promise(() => b.close()),
	);
	return output.output
		.filter((o) => o.type === "chunk")
		.map((o) => o.code)
		.join("\n");
});
export const build = Effect.fn("build.build")(function* (options: Options) {
	const fs = yield* FileSystem.FileSystem,
		path = yield* Path.Path;
	const APP = path.resolve(import.meta.dirname, ".."),
		ROOT = path.resolve(APP, "../../..");
	const files = yield* Effect.gen(function* () {
		const inputs =
			options.files ??
			(yield* fs.glob("next/**/*.tsx", {root: ROOT})).filter(
				(p) => !p.includes("node_modules") && !p.includes(".test."),
			);
		return new Map(
			yield* Effect.forEach(
				inputs,
				Effect.fnUntraced(function* (file) {
					const absolute = path.resolve(ROOT, file);
					return [path.relative(ROOT, absolute), yield* fs.readFileString(absolute)] as const;
				}),
				{concurrency: 1},
			),
		);
	}).pipe(Effect.mapError(() => new BuildError({reason: "read"})));
	const ledger =
		options.ledger ??
		(yield* fs.readFileString(path.join(ROOT, "compiler-ledger.json")).pipe(
			Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Row)))),
			Effect.mapError(() => new BuildError({reason: "read"})),
		));
	const compiler: Plugin = {
		name: "fabrika-compiler",
		transform(code, id) {
			if (!id.endsWith(".tsx")) return;
			files.set(path.relative(ROOT, id), code);
			const out = compile(id, code);
			return {code: out.code};
		},
	};
	// The tab's TSX is checked like every other module, but it ships inside `window.js`, never as
	// a view module of its own.
	const browserFiles = new Map<string, string>();
	const browserCompiler: Plugin = {
		name: "fabrika-compiler",
		transform(code, id) {
			if (!id.endsWith(".tsx")) return;
			browserFiles.set(path.relative(ROOT, id), code);
			return {code: compile(id, code).code};
		},
	};
	const programs = yield* bundlePrograms({
		root: APP,
		plugins: [compiler],
		programs: Object.fromEntries(
			Object.entries({counter: "@kampus/counter", ...options.programs}).map(([name, path]) => [
				name,
				{
					module: path,
					name: name === "counter" && path === "@kampus/counter" ? "counter" : "program",
				},
			]),
		),
	});
	const script = yield* browserBundle(options.browser ?? path.join(APP, "src/entry/browser.tsx"), [
		browserCompiler,
	]);
	const style: ReadonlyArray<Style> = yield* Effect.forEach(
		STYLES,
		([source, module]) =>
			path.fromFileUrl(new URL(import.meta.resolve(module))).pipe(
				Effect.flatMap((file) => fs.readFileString(file)),
				Effect.map((css) => ({source, css})),
			),
		{concurrency: 1},
	).pipe(Effect.mapError(() => new BuildError({reason: "read"})));
	const html = page(style);
	const output = yield* bundle(path.join(APP, "src/brain.ts"), [
		compiler,
		{
			name: "fabrika-table",
			resolveId(id) {
				if (id === "./table.ts") return "\0fabrika-table";
			},
			load(id) {
				if (id === "\0fabrika-table")
					return `export const programs = ${JSON.stringify(programs)};\nexport const assets = ${JSON.stringify({page: html, script})};`;
			},
		},
	]);
	const brain = output.output
		.filter((o) => o.type === "chunk")
		.map((o) => o.code)
		.join("\n");
	const build = yield* hash(brain);
	// Include modules discovered by Rolldown, then check the whole ledger for stale rows.
	if (check(new Map([...browserFiles, ...files]), ledger).length)
		return yield* new BuildError({reason: "compiler"});
	yield* Effect.gen(function* () {
		const directory = path.dirname(options.out);
		if (!(yield* fs.exists(directory))) yield* fs.makeDirectory(directory, {recursive: true});
		const pending = yield* fs.makeTempDirectory({directory, prefix: ".fabrika-build-"});
		const backup = `${pending}.old`;
		yield* Effect.gen(function* () {
			yield* fs.writeFileString(path.join(pending, "brain.mjs"), brain);
			yield* fs.writeFileString(path.join(pending, "window.js"), script);
			yield* fs.writeFileString(path.join(pending, "page.html"), html);
			for (const [file, text] of files)
				yield* fs.writeFileString(
					path.join(pending, `${yield* hash(file)}.js`),
					compile(file, text).code,
				);
			if (yield* fs.exists(options.out)) yield* fs.rename(options.out, backup);
			yield* fs.rename(pending, options.out).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						if (yield* fs.exists(backup)) yield* fs.rename(backup, options.out);
						return yield* Effect.fail(error);
					}),
				),
			);
		}).pipe(
			Effect.onExit(() =>
				fs
					.remove(pending, {recursive: true, force: true})
					.pipe(Effect.onExit(() => fs.remove(backup, {recursive: true, force: true}))),
			),
			Effect.uninterruptible,
		);
	}).pipe(Effect.mapError(() => new BuildError({reason: "publish"})));
	return {
		build,
		brain: path.join(options.out, "brain.mjs"),
		programs,
		page: html,
		script,
		style,
	} satisfies Built;
});
