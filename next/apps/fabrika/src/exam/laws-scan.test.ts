// Every machine has laws (docs/direction/every-machine-has-laws.md), in `next/`: a file that makes a
// machine with `defineMachine(` has a laws file beside it that uses tea's `@demlik/tea/pbt`. The
// laws file is `<name>.laws.test.ts`, or `<name>.<more>.laws.test.ts`, since a later law goes in a
// new file rather than a bigger old one. Machines made inline count too, so the scan reads text,
// not a named `const`. Item 7 of the detail's exam; written by the exam (Tier 1, P1). It reads all
// of `next/`, not `next/src`, which goes away.
//
// This file stands alone, with its own small reader, since a shared helper file would export names
// only tests call, which `pnpm lint:dead` refuses.
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {basename, dirname, join, relative, resolve, sep} from "node:path";
import {afterAll, describe, expect, it} from "vitest";

const NEXT = resolve(import.meta.dirname, "../../../..");
const PBT = "@demlik/tea/pbt";

/** Every `.ts` and `.tsx` file below `dir`, leaving out `node_modules`, `dist` and dot folders. */
const codeFiles = (dir: string): ReadonlyArray<string> =>
	!existsSync(dir)
		? []
		: readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
				const path = join(dir, entry.name);
				if (!entry.isDirectory()) return /\.tsx?$/.test(entry.name) ? [path] : [];
				const skip = ["node_modules", "dist"].includes(entry.name) || entry.name.startsWith(".");
				return skip ? [] : codeFiles(path);
			});

/** The names a file imports from, read from lines that start with `import` and name a `from`. */
const importsOf = (file: string): ReadonlyArray<string> =>
	[
		...readFileSync(file, "utf8").matchAll(/^[ \t]*import\b[^;]*?\bfrom\s*["']([^"']+)["']/gm),
	].flatMap((m) => (m[1] === undefined ? [] : [m[1]]));

/** Each file under `next` that makes a machine and has no laws file beside it using tea's pbt. */
const lawless = (next: string): ReadonlyArray<string> => {
	const files = codeFiles(next);
	return files
		.filter(
			(file) =>
				!/\.test\.tsx?$/.test(file) && readFileSync(file, "utf8").includes("defineMachine("),
		)
		.filter((machine) => {
			const stem = basename(machine).replace(/\.tsx?$/, "");
			const laws = files.filter(
				(file) =>
					dirname(file) === dirname(machine) &&
					basename(file).startsWith(`${stem}.`) &&
					basename(file).endsWith(".laws.test.ts"),
			);
			return !laws.some((file) => importsOf(file).includes(PBT));
		})
		.map((file) => relative(next, file).split(sep).join("/"))
		.sort();
};

describe("the real next/", () => {
	it("has laws beside every machine", () => {
		expect(lawless(NEXT)).toEqual([]);
	});
});

describe("planted machines", () => {
	const root = mkdtempSync(join(tmpdir(), "next-exam-"));
	afterAll(() => rmSync(root, {recursive: true, force: true}));
	const planted: Readonly<Record<string, string>> = {
		"a/machine.ts": "export const m = defineMachine({init, update});",
		"a/machine.laws.test.ts": 'import {forAll} from "@demlik/tea/pbt";',
		"b/link.ts": "export const link = defineMachine({init, update});",
		"c/view.ts": "export const view = defineMachine({init, update});",
		"c/view.laws.test.ts": 'import {it} from "vitest";',
		"d/runner.ts": "export const runner = defineMachine({init, update});",
		"d/runner.replay.laws.test.ts": 'import {forAll} from "@demlik/tea/pbt";',
		"e/inline.tsx": "export const parts = {a: defineMachine({init, update})};",
		"e/inline-other.laws.test.ts": 'import {forAll} from "@demlik/tea/pbt";',
		"f/helper.test.ts": "const m = defineMachine({init, update});",
		"g/plain.ts": "export const plain = 1;",
	};
	for (const [path, text] of Object.entries(planted)) {
		mkdirSync(dirname(join(root, path)), {recursive: true});
		writeFileSync(join(root, path), `${text}\n`);
	}

	it("fires on a machine with no laws, laws without pbt, and an inline machine whose laws are another file's", () => {
		expect(lawless(root)).toEqual(["b/link.ts", "c/view.ts", "e/inline.tsx"]);
	});
});
