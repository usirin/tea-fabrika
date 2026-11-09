// P12, next/. Exercise the real build entry. A Compiler failure must preserve every last-good byte.
import fs from "node:fs";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {join, relative, resolve} from "node:path";
import {Effect, Exit} from "effect";
import * as fc from "fast-check";
import {rolldown} from "rolldown";
import {afterEach, describe, expect, it, vi} from "vitest";

const homes: Array<string> = [];
afterEach(() => {
	for (const h of homes.splice(0)) rmSync(h, {recursive: true, force: true});
});
const home = () => {
	const h = mkdtempSync(join(tmpdir(), "p12-b-"));
	homes.push(h);
	return h;
};
const snapshot = (dir: string): ReadonlyArray<readonly [string, string]> =>
	readdirSync(dir, {recursive: true, withFileTypes: true})
		.filter((f) => f.isFile())
		.map(
			(f) =>
				[
					relative(dir, join(f.parentPath, f.name)),
					readFileSync(join(f.parentPath, f.name)).toString("base64"),
				] as const,
		)
		.sort(([a], [b]) => a.localeCompare(b));
const clean = "export const Tip = (p: {text: string}) => <b>{p.text}</b>;";
const plants = [
	[
		"skipped function",
		'import {useRef} from "react"; export const Tip = () => {const r = useRef(1); return <b>{r.current}</b>;}',
	],
	["purity error", "export const Tip = () => <b>{Date.now()}</b>;"],
	["unlisted directive", 'export const Tip = () => {"use no memo"; return <b>ok</b>;}'],
] as const;

describe("P12 Rolldown build", () => {
	it.each(plants)(
		"every reachable TSX input passes the Compiler check: %s",
		async (_name, source) => {
			const {build} = await import("./build.ts");
			const folder = home(),
				file = join(folder, "hidden.tsx"),
				program = join(folder, "program.ts"),
				out = join(folder, "dist");
			mkdirSync(join(folder, "node_modules"));
			symlinkSync(
				resolve(
					import.meta.dirname,
					"../../../../node_modules/.pnpm/react@19.3.1/node_modules/react",
				),
				join(folder, "node_modules/react"),
			);
			writeFileSync(file, clean);
			writeFileSync(
				program,
				`import {Tip} from "./hidden.tsx"; import {counter} from ${JSON.stringify(resolve(import.meta.dirname, "../../../programs/counter/src/program.ts"))}; export const program = {...counter, fixture: Tip};`,
			);
			const options = {out, files: [], ledger: [], programs: {counter: program}};
			await Effect.runPromise(build(options));
			const before = snapshot(out);
			writeFileSync(file, source);
			const failed = await Effect.runPromise(Effect.exit(build(options)));
			expect(Exit.isFailure(failed), "reachable input is checked even with files: []").toBe(true);
			expect(snapshot(out)).toEqual(before);
		},
	);
	it("Compiler ledger rows use the same repo-relative paths as discovered inputs", async () => {
		const {build} = await import("./build.ts");
		const folder = home(),
			file = join(folder, "view.tsx"),
			root = resolve(import.meta.dirname, "../../../..");
		writeFileSync(file, 'export const Tip = () => {"use no memo"; return <b>approved</b>;}');
		const path = relative(root, file);
		const found = vi.spyOn(fs, "globSync").mockReturnValue([path]);
		syncBuiltinESMExports();
		try {
			const result = await Effect.runPromise(
				Effect.exit(
					build({
						out: join(folder, "dist"),
						ledger: [{file: path, fn: "Tip", why: "fixture approval"}],
					}),
				),
			);
			expect(result).toMatchObject({_tag: "Success"});
		} finally {
			found.mockRestore();
			syncBuiltinESMExports();
		}
	});
	it("default discovery checks a view without publishing siblings and custom modules export program", async () => {
		await fc.assert(
			fc.asyncProperty(fc.integer({min: 0, max: 10000}), async (n) => {
				const {build} = await import("./build.ts");
				const parent = home(),
					folder = join(parent, `owned${n}`),
					view = join(folder, "view.tsx"),
					program = join(folder, "program.ts"),
					out = join(folder, "dist");
				mkdirSync(folder);
				writeFileSync(view, `export const label = ${JSON.stringify(`view-built-${n}`)};`);
				writeFileSync(
					program,
					`export {counter as program} from ${JSON.stringify(resolve(import.meta.dirname, "../../../programs/counter/src/program.ts"))};`,
				);
				const found = vi
					.spyOn(fs, "globSync")
					.mockReturnValue([relative(resolve(import.meta.dirname, "../../../.."), view)]);
				syncBuiltinESMExports();
				chmodSync(parent, 0o500);
				try {
					const built = await Effect.runPromise(build({out, programs: {counter: program}}));
					expect(built.programs.counter?.hash).toMatch(/^[a-f0-9]{64}$/);
					// P16 replaces P12's loose view files. Discovery must still reach the real Compiler.
					const before = snapshot(out);
					writeFileSync(view, plants[1][1]);
					const failed = await Effect.runPromise(
						Effect.exit(build({out, programs: {counter: program}})),
					);
					expect(Exit.isFailure(failed), "default discovery must check its TSX inputs").toBe(true);
					expect(snapshot(out)).toEqual(before);
					expect(readdirSync(out)).toEqual(["brain.mjs"]);
				} finally {
					chmodSync(parent, 0o700);
					found.mockRestore();
					syncBuiltinESMExports();
				}
			}),
			{seed: 119120, numRuns: 3},
		);
	});
	it("Compiler plant: calling compile without check publishes a skipped or impure rebuild", async () => {
		const {build} = await import("./build.ts");
		const h = home(),
			file = join(h, "view.tsx"),
			out = join(h, "dist");
		writeFileSync(file, clean);
		const options = {out, files: [file], ledger: []};
		const good = await Effect.runPromise(build(options));
		expect(good).toMatchObject({build: expect.any(String)});
		const before = snapshot(out);
		expect(before.length).toBeGreaterThan(0);
		for (const [name, source] of plants) {
			writeFileSync(file, source);
			const failed = await Effect.runPromise(Effect.exit(build(options)));
			expect(Exit.isFailure(failed), name).toBe(true);
			expect(snapshot(out), name).toEqual(before);
		}
	});
	it("Compiler plant: checking transformed files misses a stale ledger row or deleted input", async () => {
		const {build} = await import("./build.ts");
		const h = home(),
			file = join(h, "view.tsx"),
			out = join(h, "dist");
		writeFileSync(file, clean);
		await Effect.runPromise(build({out, files: [file], ledger: []}));
		const before = snapshot(out);
		for (const stale of [file, join(h, "gone.tsx")]) {
			const result = await Effect.runPromise(
				Effect.exit(
					build({
						out,
						files: [file],
						ledger: [{file: stale, fn: "Tip", why: "test plant"}],
					}),
				),
			);
			expect(Exit.isFailure(result)).toBe(true);
			expect(snapshot(out)).toEqual(before);
		}
	});
	it("sealed program plant: generated source must execute without host imports or ambient bindings", async () => {
		const {build} = await import("./build.ts");
		const built = await Effect.runPromise(build({out: join(home(), "dist")}));
		expect(built.brain).toEqual(expect.any(String));
		expect(built.programs.counter).toMatchObject({
			hash: expect.any(String),
			source: expect.any(String),
		});
		// The native Worker entry may import cloudflare:workers. Its execution is checked on workerd.
		const file = join(home(), "program.mjs");
		writeFileSync(file, built.programs.counter!.source);
		const bundle = await rolldown({
			input: file,
			platform: "browser",
			external: ["cloudflare:workers"],
		});
		try {
			const generated = await bundle.generate({format: "esm"});
			expect(
				generated.output.some((o) => o.type === "chunk" && o.exports.includes("default")),
			).toBe(true);
		} finally {
			await bundle.close();
		}
		expect(built.build.length).toBeGreaterThan(0);
	});
});
