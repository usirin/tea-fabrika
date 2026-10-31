// The bin's one line when a peer is missing. It reads the manifest beside it, so each case runs the
// real file, copied where no peer can be found, beside the manifest that case means.
import {spawnSync} from "node:child_process";
import {copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, expect, it} from "vitest";

const home = mkdtempSync(join(tmpdir(), "tsh-"));
afterAll(() => rmSync(home, {recursive: true, force: true}));

const said = (folder: string, version: string) => {
	const root = join(home, folder);
	mkdirSync(join(root, "src"), {recursive: true});
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({type: "module", peerDependencies: {"@agentclientprotocol/sdk": version}}),
	);
	copyFileSync(join(import.meta.dirname, "tsh.ts"), join(root, "src", "tsh.ts"));
	return spawnSync("node", [join(root, "src", "tsh.ts")], {encoding: "utf8"});
};

it("a pack's manifest holds a version, and the line names it for npm", () => {
	const ran = said("packed", "1.6.1");
	expect(ran.status).toBe(1);
	expect(ran.stderr).toContain("Install: npm install ");
	expect(ran.stderr).toContain('"@agentclientprotocol/sdk@1.6.1"');
});

it("this repo's manifest says `catalog:`, which is never printed for npm", () => {
	const ran = said("repo", "catalog:");
	expect(ran.status).toBe(1);
	expect(ran.stderr).toContain("Install: pnpm install");
	expect(ran.stderr).not.toContain("catalog:");
});
