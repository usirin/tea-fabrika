import {posix} from "node:path";
import * as fc from "fast-check";
import {expect, it} from "vitest";
import {scriptReads} from "./script-reads.mjs";

// Today's tooling. No schemas describe source text. Graphs include cycles, unreferenced scripts,
// partial declarations and all naming/import forms. The oracle uses edges, never source matching.
// T375 source plants caught: direct reads only, ignoring dirname shell paths, reporting declared
// files. Deleting stepcommit.test.ts's own declaration also failed the real lint runner.
// Mutation kills retained: import spacing/quotes/newlines and tests counted as scripts.
// Review plant: an import inside a comment or a fixture string counts as declared.
// Mutation round 2 plants: omit the TypeScript loader; count dynamic imports as declarations.
const refs = fc.array(fc.nat({max: 19}), {maxLength: 3});

const model = fc.record({
	skills: fc.array(fc.array(refs, {minLength: 1, maxLength: 5}), {minLength: 1, maxLength: 4}),
	tests: fc.array(fc.record({refs, declared: fc.array(fc.boolean(), {maxLength: 3})}), {
		maxLength: 3,
	}),
	form: fc.integer({min: 0, max: 3}),
	importForm: fc.integer({min: 0, max: 6}),
	fixtureForm: fc.integer({min: 0, max: 4}),
	syntaxForm: fc.integer({min: 0, max: 2}),
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

const imports = (path: string, form: number, n: number) =>
	[
		`import value${n} from "${path}?raw";`,
		`import {one as one${n},\n two as two${n}} from "${path}?raw";`,
		`import  value${n}  from"${path}";`,
		`import  "${path}?raw";`,
		`import value${n} from '${path}';`,
		`const value${n} = import("${path}");`,
		`const value${n} = await import('${path}?raw');`,
	][form]!;

const syntax = (form: number, n: number) =>
	[
		"",
		`const count${n}: number = ${n};`,
		`interface Sample${n} { value: number }\nconst sample${n}: Sample${n} = { value: ${n} };`,
	][form]!;

const fixtures = (statement: string, form: number) =>
	[
		`// ${statement.replaceAll("\n", "\n// ")}`,
		`/* ${statement} */`,
		`${JSON.stringify(statement)};`,
		`'${statement.replaceAll("'", "\\'").replaceAll("\n", "\\n")}';`,
		`\`${statement}\`;`,
	][form]!;

it("reports exactly undeclared direct and transitive script reads", () => {
	for (const addFixtures of [false, true]) {
		fc.assert(
			fc.property(model, ({skills, tests, form, importForm, fixtureForm, syntaxForm}) => {
				const files = skills.flatMap((scripts, s) =>
					scripts.map((edges, i) => ({
						path: `.agents/skills/s${s}/scripts/s${s}file${i}.sh`,
						edges,
					})),
				);
				const tree = new Map<string, string>();
				const edges = files.map((f) => [...new Set(f.edges.map((n) => n % files.length))]);
				files.forEach((file, i) => {
					tree.set(file.path, edges[i]!.map((n) => forms(files[n]!.path, form)).join("\n"));
				});
				const expected: {test: string; path: string}[] = [];
				const reachable = new Map<string, Set<number>>();
				const withFixtures = new Map(tree);
				tests.forEach((test, i) => {
					const path = `.agents/skills/s0/scripts/check${i}.test.ts`;
					const roots = [...new Set(test.refs.map((n) => n % files.length))];
					// Imports name a subset of those same roots: at most three names per file.
					const imported = roots.filter((_, n) => test.declared[n]);
					// Dynamic imports read scripts but do not declare them for the affected walk.
					const declared = new Set(importForm < 5 ? imported : []);
					const statement = (n: number) =>
						imports(
							posix.relative(posix.dirname(path), files[n]!.path).replace(/^(?!\.)/, "./"),
							importForm,
							n,
						);
					tree.set(
						path,
						[
							...test.refs.map((n) => `// ${forms(files[n % files.length]!.path, form)}`),
							...imported.map(statement),
							syntax(syntaxForm, i),
							// A basename inside a longer word is not a script read.
							...files.map((f) => `// prefix${posix.basename(f.path)}suffix`),
							// Another test file's name is not a script read.
							`// check${(i + 1) % tests.length}.test.ts`,
						].join("\n"),
					);
					withFixtures.set(
						path,
						[
							tree.get(path),
							...roots
								.filter((n) => !declared.has(n))
								.map((n) => fixtures(statement(n), fixtureForm)),
						].join("\n"),
					);
					const reached = new Set(roots);

					for (const n of reached) {
						for (const edge of edges[n]!) {
							reached.add(edge);
						}
					}

					reachable.set(path, reached);

					for (const n of reached) {
						if (!declared.has(n)) {
							expected.push({test: path, path: files[n]!.path});
						}
					}
				});
				const got = scriptReads(addFixtures ? withFixtures : tree);
				const sort = (rows: {test: string; path: string}[]) =>
					rows.map(({test, path}) => `${test}:${path}`).sort();
				expect(sort(got)).toEqual(sort(expected));

				for (const row of got) {
					const via = files.findIndex((f) => f.path === row.via);
					const target = files.findIndex((f) => f.path === row.path);

					if (via < 0) {
						expect(row.via).toBe(row.test);
					} else {
						expect(reachable.get(row.test)!.has(via)).toBe(true);
						expect(edges[via]).toContain(target);
					}
				}
			}),
			{seed: 119120, numRuns: 100},
		);
	}
});
