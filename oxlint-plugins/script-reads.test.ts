import {posix} from "node:path";
import * as fc from "fast-check";
import {expect, it} from "vitest";
import {scriptReads} from "./script-reads.mjs";

// Today's tooling. No schemas describe source text. Graphs include cycles, unreferenced scripts,
// partial declarations and all four naming forms. The oracle uses edges, never source matching.
// T375 source plants caught: direct reads only, ignoring dirname shell paths, reporting declared
// files. Deleting stepcommit.test.ts's own declaration also failed the real lint runner.
const refs = fc.array(fc.nat({max: 19}), {maxLength: 3});
const model = fc.record({
	skills: fc.array(fc.array(refs, {minLength: 1, maxLength: 5}), {minLength: 1, maxLength: 4}),
	tests: fc.array(fc.record({refs, declared: fc.array(fc.boolean(), {maxLength: 3})}), {
		maxLength: 3,
	}),
	form: fc.integer({min: 0, max: 3}),
});
const forms = (path: string, form: number) => {
	const name = posix.basename(path);
	return [
		`"${name}"`,
		`join(import.meta.dirname, "${name}")`,
		`$(dirname "$0")/${name}`,
		`../../${path.split("/").slice(2).join("/")}`,
	][form]!;
};

it("reports exactly undeclared direct and transitive script reads", () => {
	fc.assert(
		fc.property(model, ({skills, tests, form}) => {
			const files = skills.flatMap((scripts, s) =>
				scripts.map((edges, i) => ({path: `.agents/skills/s${s}/scripts/s${s}file${i}.sh`, edges})),
			);
			const tree = new Map<string, string>();
			const edges = files.map((f) => [...new Set(f.edges.map((n) => n % files.length))]);
			files.forEach((file, i) => {
				tree.set(file.path, edges[i]!.map((n) => forms(files[n]!.path, form)).join("\n"));
			});
			const expected: {test: string; path: string}[] = [];
			const reachable = new Map<string, Set<number>>();
			tests.forEach((test, i) => {
				const path = `.agents/skills/s0/scripts/check${i}.test.ts`;
				const roots = [...new Set(test.refs.map((n) => n % files.length))];
				// Declarations name a subset of those same roots: at most three names per file.
				const declared = new Set(roots.filter((_, n) => test.declared[n]));
				tree.set(
					path,
					[
						...test.refs.map((n) => forms(files[n % files.length]!.path, form)),
						...[...declared].map(
							(n) =>
								`import "${posix.relative(posix.dirname(path), files[n]!.path).replace(/^(?!\.)/, "./")}?raw";`,
						),
						// A basename inside a longer word is not a script read.
						...files.map((f) => `prefix${posix.basename(f.path)}suffix`),
					].join("\n"),
				);
				const reached = new Set(roots);
				for (const n of reached) for (const edge of edges[n]!) reached.add(edge);
				reachable.set(path, reached);
				for (const n of reached)
					if (!declared.has(n)) expected.push({test: path, path: files[n]!.path});
			});
			const got = scriptReads(tree);
			const sort = (rows: {test: string; path: string}[]) =>
				rows.map(({test, path}) => `${test}:${path}`).sort();
			expect(sort(got)).toEqual(sort(expected));
			for (const row of got) {
				const via = files.findIndex((f) => f.path === row.via);
				const target = files.findIndex((f) => f.path === row.path);
				if (via < 0) expect(row.via).toBe(row.test);
				else {
					expect(reachable.get(row.test)!.has(via)).toBe(true);
					expect(edges[via]).toContain(target);
				}
			}
		}),
		{seed: 119120, numRuns: 100},
	);
});
