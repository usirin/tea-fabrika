import {BuildError, bundle, bundlePrograms, hash} from "@kampus/libfabrika/node/build";
import {Effect, FileSystem, Path, Schema} from "effect";
import type {Plugin} from "rolldown";
import {check, compile, Row} from "./exam/compiler.ts";

export type Built = {
	readonly build: string;
	readonly brain: string;
	readonly programs: Readonly<Record<string, {readonly hash: string; readonly source: string}>>;
};

type Options = {
	readonly out: string;
	readonly files?: ReadonlyArray<string>;
	readonly ledger?: ReadonlyArray<Row>;
	readonly programs?: Readonly<Record<string, string>>;
};

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
			if (!id.endsWith(".tsx")) {
				return;
			}

			files.set(path.relative(ROOT, id), code);
			const out = compile(id, code);
			return {code: out.code};
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
	const output = yield* bundle(path.join(APP, "src/brain.ts"), [
		compiler,
		{
			name: "fabrika-table",
			resolveId(id) {
				if (id === "./table.ts") {
					return "\0fabrika-table";
				}
			},
			load(id) {
				if (id === "\0fabrika-table") {
					return `export const programs = ${JSON.stringify(programs)};`;
				}
			},
		},
	]);
	// Spike (experiment 248): Alchemy's bridge brings a second chunk. Joined, the two declare the
	// same names twice, so each chunk stays its own file beside brain.mjs.
	const chunks = output.output.filter((o) => o.type === "chunk");
	const brain = chunks.map((o) => o.code).join("\n");
	const build = yield* hash(brain);

	// Include modules discovered by Rolldown, then check the whole ledger for stale rows.
	if (check(files, ledger).length) {
		return yield* new BuildError({reason: "compiler"});
	}

	yield* Effect.gen(function* () {
		const directory = path.dirname(options.out);

		if (!(yield* fs.exists(directory))) {
			yield* fs.makeDirectory(directory, {recursive: true});
		}

		const pending = yield* fs.makeTempDirectory({directory, prefix: ".fabrika-build-"});
		const backup = `${pending}.old`;
		yield* Effect.gen(function* () {
			for (const chunk of chunks) {
				yield* fs.writeFileString(path.join(pending, chunk.fileName), chunk.code);
			}

			for (const [file, text] of files) {
				yield* fs.writeFileString(
					path.join(pending, `${yield* hash(file)}.js`),
					compile(file, text).code,
				);
			}

			if (yield* fs.exists(options.out)) {
				yield* fs.rename(options.out, backup);
			}

			yield* fs.rename(pending, options.out).pipe(
				Effect.catch((error) =>
					Effect.gen(function* () {
						if (yield* fs.exists(backup)) {
							yield* fs.rename(backup, options.out);
						}

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
	return {build, brain: path.join(options.out, "brain.mjs"), programs} satisfies Built;
});
