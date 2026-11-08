import {createHash} from "node:crypto";
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
import {Effect, Schema} from "effect";
import {rolldown, type Plugin} from "rolldown";
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
class BuildError extends Schema.TaggedError<BuildError>()("BuildError", {
	why: Schema.String,
	message: Schema.optionalKey(Schema.String),
}) {}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const bundle = Effect.fnUntraced(function* (input: string, plugins: Array<Plugin>) {
	// oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown's build API returns a Promise
	const built = yield* Effect.tryPromise({
		try: () => rolldown({input, plugins, platform: "browser", external: ["cloudflare:workers"]}),
		catch: (error) => new BuildError({why: "bundle", message: String(error)}),
	});
	return yield* Effect.acquireUseRelease(
		Effect.succeed(built),
		(b) =>
			// oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown generates through a Promise
			Effect.tryPromise({
				try: () => b.generate({format: "esm", codeSplitting: false}),
				catch: (error) => new BuildError({why: "generate", message: String(error)}),
			}),
		// oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown closes through a Promise
		(b) => Effect.promise(() => b.close()),
	);
});

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
	const programs: Record<string, {hash: string; source: string}> = {};
	for (const [name, path] of Object.entries({counter: "@kampus/counter", ...options.programs})) {
		const entry = `import {programBox} from "@kampus/libfabrika/box"; import {${name === "counter" && path === "@kampus/counter" ? "counter" : "program"} as program} from ${JSON.stringify(path)}; export default programBox(program, ${JSON.stringify(name)});`;
		const output = yield* bundle("fabrika:program", [
			compiler,
			{
				name: "fabrika-program",
				resolveId(id) {
					if (id === "fabrika:program") return join(APP, "program.generated.ts");
				},
				load(id) {
					if (id === join(APP, "program.generated.ts")) return entry;
				},
			},
		]);
		const source = output.output
			.filter((o) => o.type === "chunk")
			.map((o) => o.code)
			.join("\n");
		programs[name] = {hash: hash(source), source};
	}
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
