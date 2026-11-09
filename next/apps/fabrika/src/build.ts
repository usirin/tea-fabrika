// The app's build: its selected programs and its brain entry, handed to libfabrika's one-file build.
import {globSync} from "node:fs";
import {join, resolve} from "node:path";
import {NodeServices} from "@effect/platform-node";
import {BuildError, build as buildOne, type Selection} from "@kampus/libfabrika/build";
import type {Row} from "@kampus/libfabrika/compiler";
import {Effect} from "effect";
import {programs as selected} from "./table.ts";

export type {Built} from "@kampus/libfabrika/build";

const APP = resolve(import.meta.dirname, "..");
const ROOT = resolve(APP, "../../..");
type Options = {
	readonly out: string;
	/** `.tsx` files the Compiler checks. Every `.tsx` file under `next/` by default. */
	readonly files?: ReadonlyArray<string>;
	readonly ledger?: ReadonlyArray<Row>;
	/** More programs by name, each a module that exports `program`. */
	readonly programs?: Readonly<Record<string, string>>;
	readonly chaos?: boolean;
};

export const build = Effect.fn("build.app")(function* (options: Options) {
	const extra = options.programs ?? {};
	const programs: ReadonlyArray<Selection> = [
		...selected.filter((p) => !Object.hasOwn(extra, p.name)),
		...Object.entries(extra).map(([name, module]) => ({name, package: module, export: "program"})),
	];
	const files =
		options.files ??
		(yield* Effect.try({
			try: () =>
				globSync("next/**/*.tsx", {cwd: ROOT})
					.filter((p) => !p.includes("node_modules") && !p.includes(".test."))
					.map((p) => join(ROOT, p)),
			catch: () => new BuildError({why: "compiler"}),
		}));
	return yield* buildOne({
		out: options.out,
		root: ROOT,
		entry: join(APP, "src/brain.ts"),
		programs,
		files,
		...(options.ledger === undefined ? {} : {ledger: options.ledger}),
		chaos: options.chaos ?? false,
	}).pipe(Effect.provide(NodeServices.layer));
});
