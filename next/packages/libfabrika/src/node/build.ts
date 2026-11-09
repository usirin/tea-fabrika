import {createRequire} from "node:module";
import {join} from "node:path";
import {Cause, Effect, Exit, Schema} from "effect";
import {rolldown, VERSION, type InputOption, type Plugin, type RolldownOutput} from "rolldown";
import {BuildError, sha256} from "../app/built.ts";
import type {ProgramSource} from "../app/execution.ts";

export {BuildError} from "../app/built.ts";
export const hash = sha256;

/** Which bundle of a build this is. Recorded on its span, with no path or content. */
export type Phase = "program" | "window" | "brain";
type Options = {
	readonly phase?: Phase;
	/** Where module ids are made relative, so the bytes never name the checkout. */
	readonly cwd?: string;
	/** Let the bundle emit secondary chunks (windows); a program or a brain stays one module. */
	readonly split?: boolean;
	readonly define?: Readonly<Record<string, string>>;
};

const effectVersion = Effect.try({
	try: (): unknown => createRequire(import.meta.url)("effect/package.json"),
	catch: () => new BuildError({why: "bundle"}),
}).pipe(
	Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({version: Schema.String}))),
	Effect.map((p) => p.version),
	Effect.mapError(() => new BuildError({why: "bundle"})),
);

/** The bytes a bundle emitted, chunks and assets alike. */
export const emitted = (output: RolldownOutput) =>
	output.output.reduce(
		(total, item) =>
			total +
			(item.type === "chunk"
				? Buffer.byteLength(item.code)
				: typeof item.source === "string"
					? Buffer.byteLength(item.source)
					: item.source.byteLength),
		0,
	);

export const bundle = Effect.fn("build.bundle")(function* (
	input: InputOption,
	plugins: Array<Plugin>,
	options: Options = {},
) {
	yield* Effect.annotateCurrentSpan({
		phase: options.phase ?? "bundle",
		"rolldown.version": VERSION,
		"effect.version": yield* effectVersion,
	});
	const generate = Effect.acquireUseRelease(
		// oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown's build API returns a Promise
		Effect.tryPromise({
			try: () =>
				rolldown({
					input,
					plugins,
					platform: "browser",
					external: ["cloudflare:workers"],
					...(options.cwd === undefined ? {} : {cwd: options.cwd}),
					...(options.define === undefined ? {} : {transform: {define: {...options.define}}}),
				}),
			catch: () => new BuildError({why: "bundle"}),
		}),
		(b) =>
			// oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown generates through a Promise
			Effect.tryPromise({
				try: () => b.generate({format: "esm", codeSplitting: options.split === true}),
				catch: () => new BuildError({why: "bundle"}),
			}),
		// oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown closes through a Promise
		(b) => Effect.promise(() => b.close()),
	);
	return yield* generate.pipe(
		Effect.onExit((exit) =>
			Effect.annotateCurrentSpan(
				Exit.isSuccess(exit)
					? {
							outcome: "success",
							"output.files": exit.value.output.length,
							"output.bytes": emitted(exit.value),
						}
					: {
							outcome: "failure",
							"error.type": Cause.hasInterruptsOnly(exit.cause) ? "interrupted" : "BuildError",
						},
			),
		),
	);
});

/** One program's sealed Worker Loader module: its declaration wrapped in libfabrika's box. */
export const bundlePrograms = Effect.fn("build.bundlePrograms")(function* (options: {
	/** The folder the generated entry sits in, so package names resolve from there. */
	readonly root: string;
	readonly cwd?: string;
	readonly programs: Readonly<Record<string, {readonly module: string; readonly name: string}>>;
	readonly plugins: Array<Plugin>;
}) {
	const programs: Record<string, ProgramSource> = {};
	const entry = join(options.root, "program.generated.ts");
	for (const [name, declared] of Object.entries(options.programs)) {
		const code = `import {programBox} from "@kampus/libfabrika/box"; import {${declared.name} as program} from ${JSON.stringify(declared.module)}; export default programBox(program, ${JSON.stringify(name)});`;
		const output = yield* bundle(
			"fabrika:program",
			[
				...options.plugins,
				{
					name: "fabrika-program",
					resolveId(id) {
						if (id === "fabrika:program") return entry;
					},
					load(id) {
						if (id === entry) return code;
					},
				},
			],
			{phase: "program", ...(options.cwd === undefined ? {} : {cwd: options.cwd})},
		);
		const source = output.output
			.filter((o) => o.type === "chunk")
			.map((o) => o.code)
			.join("\n");
		programs[name] = {hash: hash(source), source};
	}
	return programs;
});
