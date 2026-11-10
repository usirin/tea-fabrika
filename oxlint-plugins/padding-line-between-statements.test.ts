// `padding-line-between-statements` against generated files: where it fires, and what its fix
// writes. The planted files sit beside this one, so the repository's own .oxlintrc.json runs.
import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, relative} from "node:path";
import * as fc from "fast-check";
import {afterAll, expect, it} from "vitest";

const ROOT = join(import.meta.dirname, "..");
const OXLINT = join(ROOT, "node_modules", ".bin", "oxlint");
const CODE = "fabrika(padding-line-between-statements)";

const plant = mkdtempSync(join(import.meta.dirname, ".plant-"));
afterAll(() => rmSync(plant, {recursive: true, force: true}));

/** One top-level piece. `pair` pieces are a value and its same-name type, which stay together. */
type Kind = "import" | "one" | "many" | "pair" | "overloads";

/** The text of piece `n`, and whether its first and its last statement are one line each. */
const piece = (
	kind: Kind,
	n: number,
): {readonly text: string; readonly first: boolean; readonly last: boolean} => {
	switch (kind) {
		case "import":
			return {text: `import {a${n}} from "./m${n}.ts";`, first: true, last: true};
		case "one":
			return {text: `export const v${n} = ${n};`, first: true, last: true};
		case "many":
			return {text: `export const v${n} = {\n\ta: ${n},\n};`, first: false, last: false};
		case "pair":
			return {
				text: `export const S${n} = {\n\ta: ${n},\n};\nexport type S${n} = typeof S${n};`,
				first: false,
				last: true,
			};
		case "overloads":
			return {
				text: `export function f${n}(a: string): string;\nexport function f${n}(a: number): number;\nexport function f${n}(a: unknown) {\n\treturn a;\n}`,
				first: true,
				last: false,
			};
	}
};

const fires = (file: string): readonly number[] => {
	const out = spawnSync(OXLINT, ["--format=json", relative(ROOT, file)], {
		cwd: ROOT,
		encoding: "utf8",
	});
	const report = JSON.parse(out.stdout) as {
		readonly diagnostics: readonly {
			readonly code: string;
			readonly labels: readonly {readonly span: {readonly line: number}}[];
		}[];
	};
	return report.diagnostics
		.filter((d) => d.code === CODE)
		.flatMap((d) => (d.labels[0] === undefined ? [] : [d.labels[0].span.line]))
		.sort((a, b) => a - b);
};

const file = fc.array(
	fc.record({
		kind: fc.constantFrom<Kind>("import", "one", "many", "pair", "overloads"),
		blank: fc.boolean(),
		comment: fc.boolean(),
	}),
	{minLength: 1, maxLength: 8},
);

it("fires before each piece with no blank line above it, unless both sides are one line or imports, and its fix adds just that line", () => {
	let n = 0;
	fc.assert(
		fc.property(file, (pieces) => {
			let text = "";
			let line = 1;
			const expected: number[] = [];
			pieces.forEach(({kind, blank, comment}, i) => {
				const {text: body, first} = piece(kind, i);
				const lead = comment ? `// piece ${i}\n` : "";

				if (i > 0) {
					const prev = pieces[i - 1]!;
					const both = prev.kind === "import" && kind === "import";
					const short = piece(prev.kind, i - 1).last && first;

					if (blank) {
						text += "\n";
						line++;
					} else if (!both && !short) {
						expected.push(line + lead.split("\n").length - 1);
					}
				}

				text += `${lead}${body}\n`;
				line += `${lead}${body}`.split("\n").length;
			});
			const at = join(plant, `p${n++}.ts`);
			writeFileSync(at, text);
			expect(fires(at)).toEqual(expected);
			spawnSync(OXLINT, ["--fix", relative(ROOT, at)], {cwd: ROOT, encoding: "utf8"});
			const fixed = readFileSync(at, "utf8");
			expect(fires(at)).toEqual([]);
			expect(fixed.replaceAll(/\n\n+/g, "\n")).toBe(text.replaceAll(/\n\n+/g, "\n"));
			expect(fixed.split("\n").length - text.split("\n").length).toBe(expected.length);
		}),
		{seed: 119120, numRuns: 40},
	);
});

/** One statement in a function body: a plain one-line statement, or a control statement. */
type Inner = "plain" | "if" | "else" | "for" | "while" | "do" | "switch" | "try" | "labeled";

const inner = (kind: Inner, n: number): string => {
	switch (kind) {
		case "plain":
			return `\tx += ${n};`;
		case "if":
			return `\tif (x > ${n}) {\n\t\tx = 0;\n\t}`;
		case "else":
			return `\tif (x > ${n}) {\n\t\tx = 0;\n\t} else if (x < 0) {\n\t\tx = 1;\n\t} else {\n\t\tx = 2;\n\t}`;
		case "for":
			return `\tfor (const y of ys) {\n\t\tx += y;\n\t}`;
		case "while":
			return `\twhile (x > ${n}) {\n\t\tx--;\n\t}`;
		case "do":
			return `\tdo {\n\t\tx--;\n\t} while (x > ${n});`;
		case "switch":
			return `\tswitch (x) {\n\t\tcase ${n}:\n\t\t\tx = 0;\n\t}`;
		case "try":
			return `\ttry {\n\t\tx = f();\n\t} catch {\n\t\tx = 0;\n\t}`;
		case "labeled":
			return `\touter: for (const y of ys) {\n\t\tfor (const z of ys) {\n\t\t\tif (y > z) {\n\t\t\t\tcontinue outer;\n\t\t\t}\n\t\t}\n\t}`;
	}
};

const body = fc.array(
	fc.record({
		kind: fc.constantFrom<Inner>(
			"plain",
			"plain",
			"if",
			"else",
			"for",
			"while",
			"do",
			"switch",
			"try",
			"labeled",
		),
		blank: fc.boolean(),
	}),
	{minLength: 1, maxLength: 8},
);

it("inside a block, fires before and after each control statement with no blank line there, never at the block's ends, and its fix adds just that line", () => {
	let n = 0;
	fc.assert(
		fc.property(body, (statements) => {
			let text =
				"declare const ys: number[];\ndeclare const f: () => number;\n\nexport function g() {\n\tlet x = 0;\n";
			let line = 6;
			const expected: number[] = [];
			statements.forEach(({kind, blank}, i) => {
				const prev = i === 0 ? "plain" : statements[i - 1]!.kind;

				if (blank) {
					text += "\n";
					line++;
				} else if (prev !== "plain" || kind !== "plain") {
					expected.push(line);
				}

				const piece = inner(kind, i);
				text += `${piece}\n`;
				line += piece.split("\n").length;
			});
			text += "\treturn x;\n}\n";
			const last = statements.at(-1)!.kind;

			if (last !== "plain") {
				expected.push(line);
			}

			const at = join(plant, `b${n++}.ts`);
			writeFileSync(at, text);
			expect(fires(at)).toEqual(expected);
			spawnSync(OXLINT, ["--fix", relative(ROOT, at)], {cwd: ROOT, encoding: "utf8"});
			const fixed = readFileSync(at, "utf8");
			expect(fires(at)).toEqual([]);
			expect(fixed.replaceAll(/\n\n+/g, "\n")).toBe(text.replaceAll(/\n\n+/g, "\n"));
		}),
		{seed: 119120, numRuns: 40},
	);
});

it.each([
	[
		"scenario: an if first and last in its block needs no blank line",
		"export function g(x: number) {\n\tif (x) {\n\t\treturn 1;\n\t}\n}\n",
		[],
	],
	[
		"scenario: in a switch case, a statement after an if",
		"export function g(x: number) {\n\tswitch (x) {\n\t\tcase 1:\n\t\t\tif (x) {\n\t\t\t\tx++;\n\t\t\t}\n\t\t\tbreak;\n\t}\n\treturn x;\n}\n",
		[7, 9],
	],
	[
		"scenario: a comment above the if moves down with it",
		"export function g(x: number) {\n\tx++;\n\t// why\n\tif (x) {\n\t\tx++;\n\t}\n\treturn x;\n}\n",
		[4, 7],
	],
	[
		"scenario: class members, a method after a field",
		"export class A {\n\tx = 1;\n\tf() {\n\t\treturn 1;\n\t}\n\tg() {\n\t\treturn 2;\n\t}\n}\n",
		[3, 6],
	],
	["scenario: one-line class fields stay a group", "export class A {\n\tx = 1;\n\ty = 2;\n}\n", []],
	[
		"scenario: two statements on one line are oxfmt's",
		"export const a = {\n\tb: 1,\n}; export const c = 2;\n",
		[],
	],
	["scenario: a re-export list", 'export {a} from "./a.ts";\nexport * from "./b.ts";\n', []],
	[
		"scenario: a long import list stays one list",
		'import {\n\ta,\n\tb,\n} from "./a.ts";\nimport {c} from "./c.ts";\nexport {\n\ta,\n\tb,\n} from "./a.ts";\nexport const d = c;\n',
		[10],
	],
])("%s", (name, text, expected) => {
	const at = join(plant, `${name.replaceAll(/\W/g, "-")}.ts`);
	writeFileSync(at, text);
	expect(fires(at)).toEqual(expected);
});
