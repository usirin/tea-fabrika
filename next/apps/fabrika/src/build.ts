import {
	existsSync,
	globSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";
import {BuildError, bundle, bundlePrograms, hash} from "@kampus/libfabrika/node/build";
import {Effect, Schema} from "effect";
import type {Plugin} from "rolldown";
import {check, compile, Row} from "./exam/compiler.ts";

const APP = resolve(import.meta.dirname, "..");
const ROOT = resolve(APP, "../../..");
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
	const files = yield* Effect.try({
		try: () =>
			new Map(
				(
					options.files ??
					globSync("next/**/*.tsx", {cwd: ROOT})
						.filter((p) => !p.includes("node_modules") && !p.includes(".test."))
						.map((p) => join(ROOT, p))
				).map((file) => [
					relative(ROOT, resolve(ROOT, file)),
					readFileSync(resolve(ROOT, file), "utf8"),
				]),
			),
		catch: () => new BuildError({why: "read"}),
	});
	const ledger =
		options.ledger ??
		Schema.decodeUnknownSync(Schema.Array(Row))(
			JSON.parse(readFileSync(join(ROOT, "compiler-ledger.json"), "utf8")),
		);
	const compiler: Plugin = {
		name: "fabrika-compiler",
		transform(code, id) {
			if (!id.endsWith(".tsx")) return;
			files.set(relative(ROOT, id), code);
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
	const output = yield* bundle(join(APP, "src/brain.ts"), [
		compiler,
		{
			name: "fabrika-table",
			resolveId(id) {
				if (id === "./table.ts") return "\0fabrika-table";
			},
			load(id) {
				if (id === "\0fabrika-table") return `export const programs = ${JSON.stringify(programs)};`;
			},
		},
	]);
	const brain = output.output
		.filter((o) => o.type === "chunk")
		.map((o) => o.code)
		.join("\n");
	const build = hash(brain);
	// Include modules discovered by Rolldown, then check the whole ledger for stale rows.
	if (check(files, ledger).length) return yield* new BuildError({why: "compiler"});
	yield* Effect.try({
		try: () => {
			mkdirSync(dirname(options.out), {recursive: true});
			const pending = mkdtempSync(join(dirname(options.out), ".fabrika-build-"));
			const backup = `${pending}.old`;
			try {
				writeFileSync(join(pending, "brain.mjs"), brain);
				for (const [file, text] of files)
					writeFileSync(join(pending, `${hash(file)}.js`), compile(file, text).code);
				if (existsSync(options.out)) renameSync(options.out, backup);
				try {
					renameSync(pending, options.out);
				} catch (error) {
					if (existsSync(backup)) renameSync(backup, options.out);
					// oxlint-disable-next-line fabrika/no-throw-in-effect-gen -- filesystem rollback rethrows into Effect.try's typed publish error
					throw error;
				}
			} finally {
				rmSync(pending, {recursive: true, force: true});
				rmSync(backup, {recursive: true, force: true});
			}
		},
		catch: () => new BuildError({why: "publish"}),
	});
	return {build, brain: join(options.out, "brain.mjs"), programs} satisfies Built;
});
