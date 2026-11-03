// The check is the only thing holding the rule, so each bad value is planted and seen to fail. Each
// runs the real script on a small git tree of its own, and its exit code is what is read.
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {afterAll, describe, expect, it} from "vitest";

const SCRIPT = join(import.meta.dirname, "exact-versions.ts");
const home = mkdtempSync(join(tmpdir(), "exact-versions-"));
afterAll(() => rmSync(home, {recursive: true, force: true}));

let trees = 0;
/** Runs the check on a new git tree holding these files, each staged unless listed in `untracked`. */
const run = (files: Readonly<Record<string, string>>, untracked: readonly string[] = []) => {
	trees += 1;
	const tree = join(home, String(trees));
	mkdirSync(tree);
	spawnSync("git", ["init", "-q"], {cwd: tree});
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(tree, path)), {recursive: true});
		writeFileSync(join(tree, path), text);
		if (!untracked.includes(path)) spawnSync("git", ["add", path], {cwd: tree});
	}
	const ran = spawnSync("node", [SCRIPT, tree], {encoding: "utf8"});
	return {status: ran.status, said: ran.stdout + ran.stderr};
};

const WORKSPACE = "catalog:\n  a: 1.2.3\n";
const inPackage = (field: string, version: string) =>
	run({
		"pnpm-workspace.yaml": WORKSPACE,
		"packages/one/package.json": JSON.stringify({[field]: {thing: version}}),
	});

const BAD = [
	"^1.2.3",
	"~1.2.3",
	">1.2.3",
	">=1.2.3",
	"<2.0.0",
	"<=2.0.0",
	"*",
	"x",
	"1.x",
	"1.2.x",
	"1.2",
	"1",
	"",
	"latest",
	"next",
	"1.2.3 || 2.0.0",
	"1.2.3 - 2.0.0",
	"=1.2.3",
	"v1.2.3",
	"workspace:^",
	"workspace:~",
	"workspace:1.2.3",
	"catalog:other",
	"git+https://example.com/a.git",
	"github:a/b",
	"file:../a",
	"link:../a",
	"https://example.com/a.tgz",
	"npm:other@1.2.3",
];

describe("a package.json", () => {
	it.each(BAD)("refuses %j, naming the file and the name", (version) => {
		const {status, said} = inPackage("dependencies", version);
		expect(status).toBe(1);
		expect(said).toContain(
			`packages/one/package.json: dependencies: thing: ${JSON.stringify(version)}`,
		);
	});

	it.each([
		"devDependencies",
		"peerDependencies",
		"optionalDependencies",
		"overrides",
		"resolutions",
	])("%s is read too", (field) => {
		const {status, said} = inPackage(field, "^1.2.3");
		expect(status).toBe(1);
		expect(said).toContain(`packages/one/package.json: ${field}: thing: "^1.2.3"`);
	});

	it("pnpm.overrides refuses a range", () => {
		const {status, said} = run({
			"package.json": JSON.stringify({pnpm: {overrides: {thing: "^1.2.3"}}}),
		});
		expect(status).toBe(1);
		expect(said).toContain('package.json: pnpm.overrides: thing: "^1.2.3"');
	});

	it("a nested override is refused, not skipped", () => {
		const {status, said} = run({
			"package.json": JSON.stringify({overrides: {thing: {other: "^1.2.3"}}}),
		});
		expect(status).toBe(1);
		expect(said).toContain("package.json: overrides: thing:");
	});

	it.each(["1.2.3", "2.0.0-beta.84", "4.20260730.0", "1.2.3+build.1", "catalog:", "workspace:*"])(
		"passes %j",
		(version) => {
			expect(inPackage("dependencies", version).status).toBe(0);
		},
	);

	it("a toy project's package.json counts the same", () => {
		const {status, said} = run({
			"fixtures/toy/repo/package.json": JSON.stringify({devDependencies: {thing: "^1.0.0"}}),
		});
		expect(status).toBe(1);
		expect(said).toContain("fixtures/toy/repo/package.json: devDependencies: thing:");
	});

	it("a file git does not track is left alone", () => {
		const {status} = run(
			{
				"package.json": "{}",
				"scratch/package.json": JSON.stringify({dependencies: {thing: "^1.0.0"}}),
			},
			["scratch/package.json"],
		);
		expect(status).toBe(0);
	});

	it("a file named like one is not one", () => {
		const {status} = run({
			"package.json": "{}",
			"results/98-package.json": JSON.stringify({dependencies: {thing: "^1.0.0"}}),
		});
		expect(status).toBe(0);
	});
});

describe("a pnpm-workspace.yaml", () => {
	it.each([
		["catalog", "catalog:\n  # a comment\n  '@a/b': ^1.2.3\n", 'catalog: @a/b: "^1.2.3"'],
		["overrides", "overrides:\n  'a@1>b': ~1.2.3\n", 'overrides: a@1>b: "~1.2.3"'],
		["catalogs", "catalogs:\n  old:\n    a: latest\n", 'catalogs.old: a: "latest"'],
		["a number", "catalog:\n  a: 1.2\n", "catalog: a: 1.2"],
		["an empty value", "catalog:\n  a:\n", "catalog: a: null"],
	])("%s is refused", (_name, text, line) => {
		const {status, said} = run({"pnpm-workspace.yaml": text});
		expect(status).toBe(1);
		expect(said).toContain(`pnpm-workspace.yaml: ${line}`);
	});

	it("reads a nested one too, as `video/` has", () => {
		const {status, said} = run({"video/pnpm-workspace.yaml": "overrides:\n  a: '*'\n"});
		expect(status).toBe(1);
		expect(said).toContain('video/pnpm-workspace.yaml: overrides: a: "*"');
	});

	it("passes exact versions, and settings it does not read", () => {
		const text = "packages:\n  - a\nsavePrefix: ''\ncatalog:\n  a: 1.2.3\noverrides:\n  b: 2.0.0\n";
		expect(run({"pnpm-workspace.yaml": text}).status).toBe(0);
	});
});

describe("what must never read as clean", () => {
	it("a package.json that is not JSON exits 2, naming it", () => {
		const {status, said} = run({"package.json": "{"});
		expect(status).toBe(2);
		expect(said).toContain("package.json: could not read");
	});

	it("a pnpm-workspace.yaml that is not YAML exits 2, naming it", () => {
		const {status, said} = run({"pnpm-workspace.yaml": "catalog: [\n"});
		expect(status).toBe(2);
		expect(said).toContain("pnpm-workspace.yaml: could not read");
	});

	it("a tree with no file to check exits 2", () => {
		expect(run({"README.md": "x"}).status).toBe(2);
	});

	it("a folder outside git exits 2", () => {
		const outside = mkdtempSync(join(home, "plain-"));
		expect(spawnSync("node", [SCRIPT, outside]).status).toBe(2);
	});
});
