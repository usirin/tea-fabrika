// The check is the only thing holding the repo's shape, so each stray thing is planted and seen to
// fail. Each runs the real script on a small git tree of its own, and its exit code is what is read.
import {spawnSync} from "node:child_process";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {afterAll, describe, expect, it} from "vitest";

const SCRIPT = join(import.meta.dirname, "repo-shape.ts");
const home = mkdtempSync(join(tmpdir(), "repo-shape-"));
afterAll(() => rmSync(home, {recursive: true, force: true}));

let trees = 0;
/** Runs the check on a new git tree holding these files, each staged. */
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

const OK = {"README.md": "x"};

describe("repo-shape", () => {
	it("passes a tree of listed root entries", () => {
		expect(run({...OK, "packages/one/src/a.ts": "x"}).status).toBe(0);
	});

	it("refuses a top-level entry that is not listed, folder or file", () => {
		for (const path of ["scratch.md", "junk/a.ts"]) {
			const ran = run({...OK, [path]: "x"});
			expect(ran.status, path).toBe(1);
			expect(ran.said).toContain(`root: ${path.split("/")[0]}`);
		}
	});

	it("refuses a build or run leftover anywhere in the tree", () => {
		for (const path of [
			"packages/a/dist/index.js",
			"apps/a/out/x.txt",
			"coverage/lcov.info",
			"packages/a/node_modules/x/index.js",
			"docs/.DS_Store",
			"field/run.log",
			"docs/a.out",
			"packages/a/tsconfig.tsbuildinfo",
		]) {
			const ran = run({...OK, [path]: "x"});
			expect(ran.status, path).toBe(1);
			expect(ran.said, path).toContain(`made: ${path}`);
		}
	});

	it("lets a saved run under experiments/results be", () => {
		expect(run({...OK, "experiments/results/178-lane-rehearsal/x.out": "x"}).status).toBe(0);
	});

	it("refuses a non-image file over 1 MB that is not listed, and lets an image be", () => {
		const bigText = "x".repeat(1_000_001);
		const refused = run({...OK, "docs/big.json": bigText});
		expect(refused.status).toBe(1);
		expect(refused.said).toContain("big: docs/big.json");
		expect(run({...OK, "docs/big.png": bigText}).status).toBe(0);
		expect(run({...OK, "docs/small.json": "x".repeat(1_000_000)}).status).toBe(0);
	});

	it("lets a listed big record be", () => {
		expect(run({...OK, "field/runs.jsonl": "x".repeat(1_000_001)}).status).toBe(0);
	});

	it("exits 2, not 0, when git finds no files", () => {
		expect(run({}).status).toBe(2);
	});
});
