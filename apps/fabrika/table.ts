import {createRequire} from "node:module";
import {layer as nodeFileSystem} from "@effect/platform-node/NodeFileSystem";
import {layer as nodePath} from "@effect/platform-node/NodePath";
import {runMain} from "@effect/platform-node/NodeRuntime";
import {Effect, FileSystem, Layer, Path} from "effect";
import {Ghostty} from "ghostty-web";
import {packedFrom, probeAll} from "./src/editor/cells.probe.ts";
import {tableOf} from "./src/editor/cells.ts";

// Write src/editor/cells.table.ts: each code point's width and class, as ghostty-web's wasm
// answers them (src/editor/cells.probe.ts asks). Run it again when ghostty-web changes;
// src/editor/cells.test.ts fails until then.
//
//   pnpm --filter @kampus/fabrika-app table      about 8 seconds
//
// Node's `createRequire` finds the wasm in ghostty-web's package, as the laws find it.

const here = import.meta.dirname;

/** The rows of the table: whole runs, up to 96 characters a row, so a diff stays readable. */
const rowsOf = (table: string): string[] => {
	const rows: string[] = [];
	let row = "";
	for (const [run] of table.matchAll(/[0-9a-z]+[A-Z]{2}/g)) {
		if (row.length + run.length > 96) {
			rows.push(row);
			row = "";
		}
		row += run;
	}
	if (row !== "") rows.push(row);
	return rows;
};

const fileOf = (table: string): string =>
	[
		"// Made by ../../table.ts from ghostty-web's wasm. Do not edit: run `pnpm table` again.",
		"//",
		"// Runs of code points with the same facts, from U+0000 up: a run's length in base 36, then its",
		"// facts as two capitals (cells.ts, `runsOf`).",
		"",
		"export const TABLE = `",
		...rowsOf(table),
		"`;",
		"",
	].join("\n");

const program = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const wasm = yield* fs.readFile(
		createRequire(import.meta.url).resolve("ghostty-web/ghostty-vt.wasm"),
	);
	const compiled = yield* Effect.tryPromise({
		// A copy: WebAssembly takes bytes on an ArrayBuffer, and the type of `wasm` allows a shared one.
		try: () => WebAssembly.compile(new Uint8Array(wasm)),
		catch: (cause) => new Error("ghostty-web's wasm did not compile", {cause}),
	});
	const fresh = () => new Ghostty(new WebAssembly.Instance(compiled, {env: {log: () => {}}}));
	const table = yield* Effect.try({
		try: () => tableOf(packedFrom(probeAll(fresh))),
		catch: (cause) => new Error("ghostty-web's wasm failed a probe", {cause}),
	});
	yield* fs.writeFileString(path.join(here, "src/editor/cells.table.ts"), fileOf(table));
}).pipe(Effect.provide(Layer.mergeAll(nodeFileSystem, nodePath)));

runMain(program);
