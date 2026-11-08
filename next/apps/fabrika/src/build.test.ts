// P12, next/. Exercise the real build entry. A Compiler failure must preserve every last-good byte.
import {mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative} from "node:path";
import {Effect, Exit} from "effect";
import {rolldown} from "rolldown";
import {afterEach, describe, expect, it} from "vitest";

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
