import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {afterAll, describe, expect, it} from "vitest";

const ROOT = join(import.meta.dirname, "..");
const homes: string[] = [];
afterAll(() => {
	for (const home of homes) rmSync(home, {recursive: true, force: true});
});
const scan = (exports: unknown, source = true) => {
	const home = mkdtempSync("/tmp/p13-lint.");
	homes.push(home);
	const put = (path: string, text: string) => {
		mkdirSync(dirname(join(home, path)), {recursive: true});
		writeFileSync(join(home, path), text);
	};
	put("oxlint-plugins/index.ts", "export {};\n");
	put("next/programs/notes/package.json", JSON.stringify({name: "@kampus/notes", exports}));
	if (source) put("next/programs/notes/src/index.ts", "export {};\n");
	const result = spawnSync(
		join(ROOT, "node_modules/.bin/oxlint"),
		[
			"--config",
			join(ROOT, ".oxlintrc.json"),
			"--no-ignore",
			"--format=json",
			join(home, "oxlint-plugins/index.ts"),
		],
		{cwd: ROOT, encoding: "utf8"},
	);
	const report: {diagnostics: Array<{code?: string}>} = JSON.parse(result.stdout);
	return report.diagnostics.filter((row) => row.code === "fabrika(required-browser-entry)");
};

describe("required browser entry plants and false alarms", () => {
	it("plant: missing export, wrong subpath, missing file, directory and escaped target all fire", () => {
		for (const [entry, source] of [
			[undefined, true],
			[{"./window": "./src/index.ts"}, true],
			[{".": "./src/missing.ts"}, true],
			[{".": "./src"}, true],
			[{".": "./src/index.ts"}, false],
			[{".": "./../../oxlint-plugins/index.ts"}, true],
		] as const)
			expect(scan(entry, source)).toHaveLength(1);
	});
	it("accepts the real manifest's string and conditional browser entries without a window", () => {
		for (const entry of [
			"./src/index.ts",
			{".": "./src/index.ts"},
			{".": {import: "./src/index.ts"}},
			{".": {browser: "./src/index.ts", default: "./src/missing.ts"}},
		])
			expect(scan(entry)).toEqual([]);
	});
	it("plant: the enabled pure-notes import rule refuses platform, coordination, old and Markdown imports", () => {
		const source = [
			"node:fs",
			"@kampus/libfabrika/coordination",
			"@kampus/fabrika-old",
			"mdast-util-from-markdown",
		]
			.map((s) => `import ${JSON.stringify(s)};`)
			.join("\n");
		const home = mkdtempSync(join(import.meta.dirname, ".plant-"));
		homes.push(home);
		const path = join(home, "next/programs/notes/src/program.ts");
		mkdirSync(dirname(path), {recursive: true});
		writeFileSync(path, source);
		const ran = spawnSync(
			join(ROOT, "node_modules/.bin/oxlint"),
			["--config", join(ROOT, ".oxlintrc.json"), "--format=json", path],
			{cwd: ROOT, encoding: "utf8"},
		);
		const report: {diagnostics: Array<{code?: string}>} = JSON.parse(ran.stdout);
		expect(
			report.diagnostics.filter((row) => row.code === "eslint(no-restricted-imports)"),
		).toHaveLength(4);
	});
});
