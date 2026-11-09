// P24, next/. Disposable inputs only. No selector, reducer, signer or program constructor.
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {join, resolve} from "node:path";
import {Effect, Schema} from "effect";

export const SEED = 119120;
export const runs = {arbitrary: {seed: SEED, runs: 100, size: 100}};
export const StageName = Schema.Literals(["local", "cloud", "drill"]);
export const LedgerName = Schema.NonEmptyString.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,30}$/));
export type ProgramEntry = {
	readonly name: string;
	readonly package: string;
	readonly export: string;
};
// P16's entry/files/ledger remain here until the builder reconciles its landed signature.
// The approved P24 BuildSpec omits the caller's brain entry. It cannot replace P16's entry yet.
export type BuildSpec = {
	readonly root: string;
	readonly out: string;
	readonly entry: string;
	readonly files: readonly string[];
	readonly ledger: readonly never[];
	readonly programs: readonly ProgramEntry[];
	readonly windows: readonly {readonly route: string; readonly entry: string}[];
	readonly chaos: {readonly _tag: "off"} | {readonly _tag: "real"; readonly typed: string};
};
export type Built = {
	readonly brain: string;
	readonly sha256: string;
	readonly bytes: number;
	readonly programs: readonly {readonly name: string; readonly hash: string}[];
	readonly assets: readonly {
		readonly route: string;
		readonly sha256: string;
		readonly bytes: number;
	}[];
};

export const buildFixture = Effect.fn("test.p24.buildFixture")(function* () {
	const root = yield* Effect.acquireRelease(
		Effect.sync(() => mkdtempSync("/tmp/fh.")),
		(path) => Effect.sync(() => rmSync(path, {recursive: true, force: true})),
	);
	const app = resolve(import.meta.dirname, "../../../../apps/fabrika");
	yield* Effect.sync(() => {
		mkdirSync(join(root, "node_modules/@p24"), {recursive: true});
		for (const name of ["@kampus", "@demlik", "effect"])
			symlinkSync(join(app, "node_modules", name), join(root, "node_modules", name));
		cpSync(join(app, "src"), join(root, "src"), {
			recursive: true,
			filter: (path) => !path.includes("/exam") && !path.endsWith(".test.ts"),
		});
		writeFileSync(join(root, "package.json"), JSON.stringify({type: "module"}));
		writeFileSync(join(root, "compiler-ledger.json"), "[]");
		const chaos = join(root, "node_modules/@p24/chaos");
		mkdirSync(chaos, {recursive: true});
		writeFileSync(
			join(chaos, "package.json"),
			JSON.stringify({type: "module", exports: "./missing.ts"}),
		);
	});
	const entries: readonly ProgramEntry[] = [
		{name: "counter", package: "@kampus/counter", export: "counter"},
		// Resolving this poison entry proves selection happened too late.
		{name: "chaos", package: "@p24/chaos", export: "chaos"},
	];
	const spec: BuildSpec = {
		root,
		out: join(root, "out"),
		entry: join(root, "src/brain.ts"),
		files: [],
		ledger: [],
		programs: entries,
		windows: [],
		chaos: {_tag: "off"},
	};
	return {
		spec,
		entries,
		read: (built: Built) => Effect.sync(() => new Uint8Array(readFileSync(built.brain))),
	};
});
