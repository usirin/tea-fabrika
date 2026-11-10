// The check is the only thing holding decision 0003 for workspace packages, so each case is
// planted and seen to fail or pass. Each runs the real script on a small git tree of its own.
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {afterAll, describe, expect, it} from "vitest";

const SCRIPT = join(import.meta.dirname, "workspace-reach.ts");
const home = mkdtempSync(join(tmpdir(), "workspace-reach-"));
afterAll(() => rmSync(home, {recursive: true, force: true}));

let trees = 0;

/** Runs the check on a new git tree holding these files, all staged. */
const run = (files: Readonly<Record<string, string>>) => {
	trees += 1;
	const tree = join(home, String(trees));
	mkdirSync(tree);
	spawnSync("git", ["init", "-q"], {cwd: tree});
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(tree, path)), {recursive: true});
		writeFileSync(join(tree, path), text);
		spawnSync("git", ["add", path], {cwd: tree});
	}
	const ran = spawnSync("node", [SCRIPT, tree], {encoding: "utf8"});
	return {status: ran.status, said: ran.stdout + ran.stderr};
};

const WORKSPACE = "packages:\n  - apps/*\n  - packages/*\n  - programs/*\n  - next/packages/*\n";

const pkg = (name: string, deps: readonly string[] = []) =>
	JSON.stringify({name, dependencies: Object.fromEntries(deps.map((d) => [d, "workspace:*"]))});

describe("a workspace package", () => {
	it("scenario: one an app depends on, and one that package depends on, are reached", () => {
		const {status, said} = run({
			"pnpm-workspace.yaml": WORKSPACE,
			"package.json": pkg("root"),
			"apps/app/package.json": pkg("app", ["lib"]),
			"packages/lib/package.json": pkg("lib", ["core"]),
			"packages/core/package.json": pkg("core"),
		});
		expect(said).toContain("3 packages, every one reached");
		expect(status).toBe(0);
	});

	it("scenario: one nothing depends on fails, named by folder and name", () => {
		const {status, said} = run({
			"pnpm-workspace.yaml": WORKSPACE,
			"package.json": pkg("root"),
			"apps/app/package.json": pkg("app"),
			"programs/old/package.json": pkg("old"),
		});
		expect(status).toBe(1);
		expect(said).toContain("programs/old (old): no app, tool or root reaches it");
	});

	it("scenario: one only an unreached package depends on fails too", () => {
		const {status, said} = run({
			"pnpm-workspace.yaml": WORKSPACE,
			"package.json": pkg("root"),
			"packages/dead/package.json": pkg("dead", ["deeper"]),
			"packages/deeper/package.json": pkg("deeper"),
		});
		expect(status).toBe(1);
		expect(said).toContain("packages/dead (dead)");
		expect(said).toContain("packages/deeper (deeper)");
	});

	it("scenario: the root package.json reaches what it names", () => {
		const {status} = run({
			"pnpm-workspace.yaml": WORKSPACE,
			"package.json": pkg("root", ["tool"]),
			"packages/tool/package.json": pkg("tool"),
		});
		expect(status).toBe(0);
	});

	it("scenario: next/ is left out while it grows, so a piece built before its app passes", () => {
		const {status} = run({
			"pnpm-workspace.yaml": WORKSPACE,
			"package.json": pkg("root"),
			"next/packages/early/package.json": pkg("early"),
		});
		expect(status).toBe(0);
	});

	it("scenario: a package.json outside the workspace globs is not a package", () => {
		const {status} = run({
			"pnpm-workspace.yaml": WORKSPACE,
			"package.json": pkg("root"),
			"fixtures/toy/package.json": pkg("toy"),
		});
		expect(status).toBe(0);
	});

	it("scenario: no pnpm-workspace.yaml is a read failure, never clean", () => {
		const {status} = run({"package.json": pkg("root")});
		expect(status).toBe(2);
	});
});
