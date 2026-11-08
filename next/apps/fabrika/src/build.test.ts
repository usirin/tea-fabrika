// P15a, next/. Preserve build/Compiler plants through the move out of the app's exam folder.
import * as fc from "fast-check";
import {expect, it} from "vitest";

it("build uses the same strict Compiler check for every changed view", async () => {
	const path = "@kampus/libfabrika/build";
	const {check, compile} = await import(path);
	await fc.assert(
		fc.asyncProperty(
			fc.constantFrom("View", "Counter", "Preview"),
			fc.integer({min: 0, max: 8}),
			async (name, lines) => {
				const file = `next/programs/counter/src/${name}.tsx`;
				const prefix = "// changed view\n".repeat(lines);
				const good = `${prefix}export const ${name} = (p: {count: number}) => <b>{p.count}</b>;`;
				const bad = `${prefix}export const ${name} = () => <b>{Date.now()}</b>;`;
				expect(check(new Map([[file, good]]), [])).toEqual([]);
				expect(compile(file, good).errors).toEqual([]);
				expect(check(new Map([[file, bad]]), []).length).toBeGreaterThan(0);
				expect(compile(file, bad).errors.length).toBeGreaterThan(0);
			},
		),
		{seed: 119120, numRuns: 12},
	);
});
