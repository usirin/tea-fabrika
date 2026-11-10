import {Effect, Path, Schema} from "effect";
import {Digest} from "effect/crypto";
import {rolldown, type Plugin} from "rolldown";
import type {ProgramSource} from "../app/execution.ts";

export class BuildError extends Schema.TaggedError<BuildError>()("BuildError", {
	reason: Schema.String,
	message: Schema.optionalKey(Schema.String),
}) {}

export const hash = Effect.fn("build.hash")((text: string) =>
	Digest.Digest.use((digest) =>
		digest.digestHex(Digest.sha256, new TextEncoder().encode(text)),
	).pipe(Effect.provide(Digest.layerWebCrypto)),
);

export const bundle = Effect.fn("build.bundle")(function* (input: string, plugins: Array<Plugin>) {
	const options = {input, plugins, platform: "browser" as const, external: ["cloudflare:workers"]};
	const fail = (error: unknown) => new BuildError({reason: "bundle", message: String(error)});
	// oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown's build API returns a Promise
	const built = yield* Effect.tryPromise({try: () => rolldown(options), catch: fail});
	return yield* Effect.acquireUseRelease(
		Effect.succeed(built),
		(b) => {
			const fail = (error: unknown) => new BuildError({reason: "generate", message: String(error)});
			const options = {format: "esm" as const, codeSplitting: false};
			// oxlint-disable-next-line fabrika/no-promises -- edge: Rolldown generates through a Promise
			return Effect.tryPromise({try: () => b.generate(options), catch: fail});
		},
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
					if (id === "fabrika:program") {
						return generated;
					}
				},
				load(id) {
					if (id === generated) {
						return code;
					}
				},
			},
		]);
		const source = output.output
			.filter((o) => o.type === "chunk")
			.map((o) => o.code)
			.join("\n");
		programs[name] = {hash: yield* hash(source), source};
	}

	return programs;
});
