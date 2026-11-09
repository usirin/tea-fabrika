import {createHash} from "node:crypto";
import {Effect, Path, Schema} from "effect";
import {rolldown, type Plugin} from "rolldown";
import type {ProgramSource} from "../app/execution.ts";

export class BuildError extends Schema.TaggedError<BuildError>()("BuildError", {
	why: Schema.String,
	message: Schema.optionalKey(Schema.String),
}) {}
export const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export const bundle = Effect.fn("build.bundle")(function* (input: string, plugins: Array<Plugin>) {
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

export const bundlePrograms = Effect.fn("build.bundlePrograms")(function* (options: {
	readonly root: string;
	readonly programs: Readonly<Record<string, {readonly module: string; readonly name: string}>>;
	readonly plugins: Array<Plugin>;
}) {
	const path = yield* Path.Path;
	const generated = path.join(options.root, "program.generated.ts");
	const programs: Record<string, ProgramSource> = {};
	for (const [name, entry] of Object.entries(options.programs)) {
		const code = `import {programBox} from "@kampus/libfabrika/box"; import {${entry.name} as program} from ${JSON.stringify(entry.module)}; export default programBox(program, ${JSON.stringify(name)});`;
		const output = yield* bundle("fabrika:program", [
			...options.plugins,
			{
				name: "fabrika-program",
				resolveId(id) {
					if (id === "fabrika:program") return generated;
				},
				load(id) {
					if (id === generated) return code;
				},
			},
		]);
		const source = output.output
			.filter((o) => o.type === "chunk")
			.map((o) => o.code)
			.join("\n");
		programs[name] = {hash: hash(source), source};
	}
	return programs;
});
