// P12, next/. The Compiler checks actual bundle inputs and the committed ledger's path format.
import {createHash} from "node:crypto";
import fs, {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {syncBuiltinESMExports} from "node:module";
import {tmpdir} from "node:os";
import {join, relative, resolve} from "node:path";
import {Effect, Exit} from "effect";
import {afterEach, describe, expect, it, vi} from "vitest";
import {build} from "./build.ts";
import {check} from "./exam/compiler.ts";

const ROOT = resolve(import.meta.dirname, "../../../..");
const homes: Array<string> = [];
const home = () => {
	const h = mkdtempSync(join(tmpdir(), "p12-inputs-"));
	homes.push(h);
	const modules = join(h, "node_modules");
	mkdirSync(modules);
	for (const name of ["@demlik", "@kampus", "effect"])
		symlinkSync(resolve(import.meta.dirname, "../node_modules", name), join(modules, name));
	const react = readdirSync(join(ROOT, "node_modules/.pnpm")).find((name) =>
		name.startsWith("react@"),
	);
	if (react === undefined) throw new Error("installed React is required by Compiler fixtures");
	symlinkSync(
		join(ROOT, "node_modules/.pnpm", react, "node_modules/react"),
		join(modules, "react"),
	);
	return h;
};
const snapshot = (folder: string) =>
	readdirSync(folder)
		.sort()
		.map((file) => [
			file,
			createHash("sha256")
				.update(readFileSync(join(folder, file)))
				.digest("hex"),
		]);
afterEach(() => {
	vi.restoreAllMocks();
	syncBuiltinESMExports();
	for (const h of homes.splice(0)) rmSync(h, {recursive: true, force: true});
});
describe("P12 complete Compiler inputs", () => {
	it.each([
		["purity", "export const Tip = () => <b>{Date.now()}</b>;"],
		[
			"skipped function",
			'import {useRef} from "react"; export const Tip = () => {const r = useRef(1); return <b>{r.current}</b>;}',
		],
		["directive", 'export const Tip = () => {"use no memo"; return <b>ok</b>;}'],
	])("every reachable TSX module passes the full Compiler check: %s", async (_case, invalid) => {
		const h = home(),
			tsx = join(h, "hidden.tsx"),
			entry = join(h, "program.ts"),
			out = join(h, "dist");
		writeFileSync(tsx, "export const Tip = () => <b>ok</b>;");
		writeFileSync(
			entry,
			`import {Tip} from "./hidden.tsx"; import {counter} from ${JSON.stringify(resolve(import.meta.dirname, "../../../programs/counter/src/program.ts"))}; export const program = {...counter, fixture: Tip};`,
		);
		const options = {out, files: [], ledger: [], programs: {counter: entry}};
		await Effect.runPromise(build(options));
		const before = snapshot(out);
		expect(check(new Map([[relative(ROOT, tsx), invalid!]]), [])).not.toEqual([]);
		writeFileSync(tsx, invalid!);
		const result = await Effect.runPromise(Effect.exit(build(options)));
		expect
			.soft(Exit.isFailure(result), "files: [] cannot exempt a module reached by Rolldown")
			.toBe(true);
		expect(snapshot(out)).toEqual(before);
	});
	it("approved Compiler rows match discovery using repo-relative paths", async () => {
		const h = home(),
			file = join(h, "view.tsx"),
			source = 'export const Tip = () => {"use no memo"; return <b>ok</b>;}';
		writeFileSync(file, source);
		const path = relative(ROOT, file);
		const ledger = [{file: path, fn: "Tip", why: "test approval"}];
		expect(check(new Map([[path, source]]), ledger)).toEqual([]);
		vi.spyOn(fs, "globSync").mockReturnValue([path]);
		syncBuiltinESMExports();
		const result = await Effect.runPromise(Effect.exit(build({out: join(h, "dist"), ledger})));
		expect(result).toMatchObject({_tag: "Success"});
	});
});
