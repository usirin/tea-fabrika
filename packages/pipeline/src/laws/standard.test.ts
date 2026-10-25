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
import {dirname, join, relative, sep} from "node:path";
import {afterAll, describe, expect, it} from "vitest";
import {SPECS} from "./specs.ts";

// The laws check is standard: every tea machine in the workspace has laws. A machine is found
// by how it is made, a call to `defineMachine(`, in every part of `apps`, `packages`, `programs`
// and `packs`. So a machine added anywhere fails this test until it has laws.
//
// A machine has laws in one of two ways:
//
//   beside it   `desk.ts` makes a machine, and `desk.laws.test.ts` beside it holds its laws, on
//               tea's pbt (`@demlik/tea/pbt`). The laws file names each machine the file makes,
//               by the name it is made under. This is the way for every new machine.
//   specs.ts    the machines on our own search engine, one spec per machine, each run below.
//               That list only shrinks (property-tests-not-our-own-search.md).
//
// A spec passes only when no law breaks and every Msg type the machine takes was sent at least
// once: a law that holds only because nothing tried to break it is not a law that holds. A laws
// file beside its machine holds itself to the same rule, through tea's strict Msg table.
//
// `wip`, `legacy` and `docs/tutorials` are left out: the first two only shrink, and a tutorial's
// machines are there to teach.
//
// Node's file reads, at this edge only: a test that lists source files. It reads the other parts
// as files to find machines in, never as code it imports.

/** The workspace groups searched, each a folder of parts. */
const GROUPS = ["apps", "packages", "programs", "packs"] as const;
/** Folders in a part that hold no source of its own. */
const SKIPPED = new Set(["node_modules", "dist"]);
/**
 * Each spec must keep the suite fast, measured in states so a busy machine cannot fail it (the
 * largest spec keeps about 10,000). Longer runs belong in experiment 90's script.
 */
const MOST_STATES = 20_000;

/** The top of the workspace: the folder above this one that holds `pnpm-workspace.yaml`. */
function workspaceOf(from: string): string {
	if (existsSync(join(from, "pnpm-workspace.yaml"))) return from;
	const up = dirname(from);
	if (up === from) throw new Error("no pnpm-workspace.yaml above this test");
	return workspaceOf(up);
}

/** Every source file under `dir`, tests and type files left out, by its path from `root`. */
function sources(root: string, dir: string): readonly string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, {withFileTypes: true}).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory())
			return SKIPPED.has(entry.name) || entry.name.startsWith(".") ? [] : sources(root, path);
		const source = /\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name);
		return source ? [relative(root, path).split(sep).join("/")] : [];
	});
}

/** The machines a file makes: how many, and the name each is made under (`const desk = defineMachine(`). */
export function machinesIn(text: string): {
	readonly count: number;
	readonly names: readonly string[];
} {
	const count = text.split("defineMachine(").length - 1;
	const names = [...text.matchAll(/\b(?:const|let)\s+(\w+)\s*=\s*defineMachine\(/g)].map(
		(m) => m[1] ?? "",
	);
	return {count, names};
}

/** The laws file beside a machine's file. */
const lawsFileOf = (file: string) => file.replace(/\.tsx?$/, ".laws.test.ts");

/**
 * What is wrong with the laws of the workspace at `root`, one line each: empty when every
 * machine has laws. `specs`: how many specs specs.ts has for each file, by its path from `root`.
 */
export function withoutLaws(root: string, specs: ReadonlyMap<string, number>): readonly string[] {
	const parts = GROUPS.flatMap((group) =>
		existsSync(join(root, group))
			? readdirSync(join(root, group), {withFileTypes: true})
					.filter((entry) => entry.isDirectory())
					.map((entry) => `${group}/${entry.name}`)
			: [],
	);
	const out: string[] = [];
	const made = new Set<string>();
	for (const part of parts)
		for (const file of sources(root, join(root, part))) {
			const {count, names} = machinesIn(readFileSync(join(root, file), "utf8"));
			if (count === 0) continue;
			made.add(file);
			const laws = lawsFileOf(file);
			if (!existsSync(join(root, laws))) {
				const specced = specs.get(file) ?? 0;
				if (specced !== count)
					out.push(
						`${file} makes ${count} machine(s) and has no ${laws} beside it` +
							(specced > 0 ? `, and ${specced} spec(s) in specs.ts` : ""),
					);
				continue;
			}
			if (!file.startsWith(`${part}/src/`))
				out.push(`${laws} is outside ${part}/src, where the test run does not look`);
			const text = readFileSync(join(root, laws), "utf8");
			if (!text.includes("@demlik/tea/pbt")) out.push(`${laws} does not use tea's pbt`);
			if (names.length !== count)
				out.push(`${file} makes a machine under no name, so its laws cannot name it`);
			for (const name of names)
				if (!new RegExp(`\\b${name}\\b`).test(text)) out.push(`${laws} does not name ${name}`);
		}
	for (const file of specs.keys())
		if (!made.has(file)) out.push(`specs.ts has a spec for ${file}, which makes no machine`);
	return out;
}

const ROOT = workspaceOf(import.meta.dirname);
const specCounts = (): ReadonlyMap<string, number> => {
	const counts = new Map<string, number>();
	for (const spec of SPECS) counts.set(spec.file, (counts.get(spec.file) ?? 0) + 1);
	return counts;
};

describe("every machine has laws", () => {
	it("finds the machines by how they are made, in every group of the workspace", () => {
		const found = GROUPS.filter((group) =>
			readdirSync(join(ROOT, group), {withFileTypes: true}).some(
				(part) =>
					part.isDirectory() &&
					sources(ROOT, join(ROOT, group, part.name)).some(
						(file) => machinesIn(readFileSync(join(ROOT, file), "utf8")).count > 0,
					),
			),
		);
		expect(found).toEqual([...GROUPS]);
	});

	it("has laws for every machine: a laws file beside it, or one spec per machine in specs.ts", () => {
		expect(withoutLaws(ROOT, specCounts())).toEqual([]);
	});

	it.each(SPECS.map((spec) => [spec.name, spec] as const))(
		"%s: no law broken, every Msg type sent, in a small search",
		(_, spec) => {
			const checked = spec.check();
			expect({broken: checked.broken, unsent: checked.unsent}).toEqual({broken: {}, unsent: []});
			expect(checked.states).toBeLessThan(MOST_STATES);
		},
	);
});

// The check itself, seen to fail: a small workspace in a fresh folder, with one mistake at a time.

describe("the laws check, on a planted workspace", () => {
	const made: string[] = [];
	afterAll(() => {
		for (const dir of made) rmSync(dir, {recursive: true, force: true});
	});

	/** A fresh workspace holding these files, by their path from its top. */
	const workspace = (files: Readonly<Record<string, string>>): string => {
		const root = mkdtempSync(join(tmpdir(), "laws-check-"));
		made.push(root);
		for (const [file, text] of Object.entries(files)) {
			mkdirSync(dirname(join(root, file)), {recursive: true});
			writeFileSync(join(root, file), text);
		}
		return root;
	};
	const MACHINE = "export const desk = defineMachine({});\n";
	const LAWS = 'import {propertyInvariant} from "@demlik/tea/pbt";\n// desk\n';
	const none = new Map<string, number>();

	it("passes a machine with its laws beside it, and ignores the parts it does not search", () => {
		const root = workspace({
			"apps/a/src/desk.ts": MACHINE,
			"apps/a/src/desk.laws.test.ts": LAWS,
			"apps/a/src/desk.test.ts": MACHINE,
			"apps/a/node_modules/x/m.ts": MACHINE,
			"legacy/src/old.ts": MACHINE,
		});
		expect(withoutLaws(root, none)).toEqual([]);
	});

	it("fails a machine with no laws, in each group", () => {
		for (const group of GROUPS) {
			const root = workspace({[`${group}/a/src/desk.ts`]: MACHINE});
			expect(withoutLaws(root, none)).toEqual([
				`${group}/a/src/desk.ts makes 1 machine(s) and has no ${group}/a/src/desk.laws.test.ts beside it`,
			]);
		}
	});

	it("fails a laws file that is not on tea's pbt, or does not name a machine", () => {
		const root = workspace({
			"programs/p/src/m.ts": `${MACHINE}const other = defineMachine({});\n`,
			"programs/p/src/m.laws.test.ts": "// desk\n",
		});
		expect(withoutLaws(root, none)).toEqual([
			"programs/p/src/m.laws.test.ts does not use tea's pbt",
			"programs/p/src/m.laws.test.ts does not name other",
		]);
	});

	it("fails a machine made under no name, and one outside src", () => {
		const root = workspace({
			"packs/k/src/m.ts": "export default defineMachine({});\n",
			"packs/k/src/m.laws.test.ts": LAWS,
			"packs/k/m.ts": MACHINE,
			"packs/k/m.laws.test.ts": LAWS,
		});
		expect(withoutLaws(root, none)).toEqual([
			"packs/k/m.laws.test.ts is outside packs/k/src, where the test run does not look",
			"packs/k/src/m.ts makes a machine under no name, so its laws cannot name it",
		]);
	});

	it("counts specs per machine, and fails a spec for a file that makes none", () => {
		const root = workspace({"packages/q/src/two.ts": `${MACHINE}${MACHINE}`});
		expect(withoutLaws(root, new Map([["packages/q/src/two.ts", 2]]))).toEqual([]);
		expect(withoutLaws(root, new Map([["packages/q/src/two.ts", 1]]))).toEqual([
			"packages/q/src/two.ts makes 2 machine(s) and has no packages/q/src/two.laws.test.ts beside it, and 1 spec(s) in specs.ts",
		]);
		expect(
			withoutLaws(
				root,
				new Map([
					["packages/q/src/two.ts", 2],
					["packages/q/src/gone.ts", 1],
				]),
			),
		).toEqual(["specs.ts has a spec for packages/q/src/gone.ts, which makes no machine"]);
	});
});
