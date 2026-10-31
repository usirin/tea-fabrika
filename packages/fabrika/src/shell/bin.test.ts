// The bin's one line when a peer is missing. It reads the manifest two levels up, so each case runs
// the real file, copied where no peer can be found, beside the manifest that case means.
import {spawnSync} from "node:child_process";
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, expect, it} from "vitest";

const home = mkdtempSync(join(tmpdir(), "bin-"));
afterAll(() => rmSync(home, {recursive: true, force: true}));

const said = (folder: string, version: string) => {
	const root = join(home, folder);
	mkdirSync(join(root, "src", "shell"), {recursive: true});
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({type: "module", peerDependencies: {"@effect/opentelemetry": version}}),
	);
	copyFileSync(join(import.meta.dirname, "bin.ts"), join(root, "src", "shell", "bin.ts"));
	return spawnSync("node", [join(root, "src", "shell", "bin.ts")], {encoding: "utf8"});
};

it("a pack's manifest holds a version, and the line names it for npm", () => {
	const ran = said("packed", "4.0.6");
	expect(ran.status).toBe(1);
	expect(ran.stderr).toContain('Install: npm install "@effect/opentelemetry@4.0.6"');
});

it("this repo's manifest says `catalog:`, which is never printed for npm", () => {
	const ran = said("repo", "catalog:");
	expect(ran.status).toBe(1);
	expect(ran.stderr).toContain("Install: pnpm install");
	expect(ran.stderr).not.toContain("catalog:");
});
