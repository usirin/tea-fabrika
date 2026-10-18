import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {afterAll, describe, expect, it} from "vitest";
import {builderRefusal, fencedEnv, filesOf, toolchain} from "./check";

// What the builder may read: its check on Read, Grep and Glob, and the folders
// the sandbox opens to its commands. No agent runs here.

const TREE = "/work/trees/1";
const refused = (tool: string, input: Record<string, unknown>) =>
	builderRefusal(TREE, [], tool, input);

describe("a Glob's pattern stays in the copy", () => {
	it.each([
		"/srv/elsewhere/**/.env",
		"/work/trees/2/*.ts",
		"~/code/**",
		"../2/**",
		"src/../../2/*",
		"**/..",
	])("a pattern that leaves it is refused: %s", (pattern) => {
		expect(refused("Glob", {pattern})).not.toBeNull();
	});

	it.each(["**/*.ts", "src/**/*.test.ts", `${TREE}/src/*.ts`, "{a,b}/*.md"])(
		"a pattern inside it is not: %s",
		(pattern) => {
			expect(refused("Glob", {pattern})).toBeNull();
		},
	);
});

describe("a link in the copy is followed", () => {
	const root = mkdtempSync(join(tmpdir(), "tea-fabrika-check-"));
	const tree = join(root, "tree");
	const away = join(root, "away");
	mkdirSync(join(tree, "src"), {recursive: true});
	mkdirSync(away);
	writeFileSync(join(away, ".env"), "TOKEN=x\n");
	writeFileSync(join(tree, "src", "a.ts"), "export {};\n");
	symlinkSync(join(away, ".env"), join(tree, "env"));
	symlinkSync(away, join(tree, "out"));
	afterAll(() => rmSync(root, {recursive: true, force: true}));
	const check = (tool: string, input: Record<string, unknown>) =>
		builderRefusal(tree, [], tool, input);

	it("a read through a link that points out of the copy is refused", () => {
		expect(check("Read", {file_path: join(tree, "env")})).toContain("outside your working copy");
		expect(check("Read", {file_path: "out/.env"})).toContain("outside your working copy");
		expect(check("Grep", {pattern: "TOKEN", path: "out"})).toContain("outside your working copy");
	});

	it("a plain file in the copy is still read", () => {
		expect(check("Read", {file_path: join(tree, "src", "a.ts")})).toBeNull();
		expect(check("Read", {file_path: "src/new.ts"})).toBeNull();
	});
});

describe("what the sandbox lets the builder's commands read", () => {
	const home = homedir();
	const tree = join(home, "work", "trees", "1");
	const files = filesOf(
		tree,
		["/private/tmp"],
		[join(home, ".volta"), home, join(home, ".config"), join(home, ".ssh", "keys")],
	);

	it("home is unreadable but for the copy, the temp folder and the toolchain", () => {
		expect(files.denyRead).toEqual([home]);
		expect(files.allowRead).toEqual([tree, "/private/tmp", join(home, ".volta")]);
		expect(files.allowWrite).toEqual([tree, "/private/tmp"]);
	});

	it("no folder that would open home or a login file is let in", () => {
		for (const login of [".ssh", ".config/gh", ".aws", ".netrc"].map((f) => join(home, f)))
			for (const open of files.allowRead) {
				expect(login.startsWith(`${open}/`)).toBe(false);
				expect(open.startsWith(`${login}/`) || open === login).toBe(false);
			}
	});

	it("a worktree's copy opens the clone's git folder it shares, and nothing above it", () => {
		const root = mkdtempSync(join(tmpdir(), "tea-fabrika-git-"));
		const own = join(root, "clone", ".git", "worktrees", "1");
		mkdirSync(own, {recursive: true});
		mkdirSync(join(root, "trees", "1"), {recursive: true});
		writeFileSync(join(root, "trees", "1", ".git"), `gitdir: ${own}\n`);
		writeFileSync(join(own, "commondir"), "../..\n");
		const read = filesOf(join(root, "trees", "1"), [], []).allowRead;
		rmSync(root, {recursive: true, force: true});
		expect(read).toEqual([join(root, "trees", "1"), join(root, "clone", ".git")]);
	});
});

describe("the toolchain", () => {
	const home = homedir();
	// pnpm's folder outside home, so each case below shows the node part alone.
	const env = {PATH: "", PNPM_HOME: "/opt/pnpm"};

	it("is the version manager's folder that holds the running node", () => {
		const node = join(home, ".fakevm", "versions", "22", "bin", "node");
		expect(toolchain(env, node)).toEqual([join(home, ".fakevm", "versions", "22")]);
	});

	it("is only the holding folder where the one above is shared by many programs", () => {
		expect(toolchain(env, join(home, ".local", "bin", "node"))).toEqual([
			join(home, ".local", "bin"),
		]);
	});

	it("is nothing for a node outside home: the system's folders stay readable anyway", () => {
		expect(toolchain(env, "/usr/local/bin/node")).toEqual([]);
	});

	it("holds pnpm's folder, where the pnpm version a repo pins is kept", () => {
		const pnpm = join(home, ".pnpm-home");
		expect(toolchain({PATH: "", PNPM_HOME: pnpm}, "/usr/local/bin/node")).toEqual([pnpm]);
	});
});

describe("the environment the builder's commands get", () => {
	const home = homedir();
	const tools = [join(home, ".volta")];
	const env = fencedEnv(
		{
			PATH: [join(home, "bin"), join(home, ".volta", "bin"), "/usr/bin", "relative"].join(":"),
			USER: "u",
		},
		tools,
	);

	it("keeps only the PATH folders they may read: one in home they may not ends the lookup", () => {
		expect(env.PATH).toBe([join(home, ".volta", "bin"), "/usr/bin"].join(":"));
	});

	it("points git and other programs at no user config, and keeps the rest", () => {
		expect(env.GIT_CONFIG_GLOBAL).toBe("/dev/null");
		expect(env.NPM_CONFIG_USERCONFIG).toBe("/dev/null");
		expect(env.XDG_CONFIG_HOME).toBe("/var/empty");
		expect(env.USER).toBe("u");
	});
});
