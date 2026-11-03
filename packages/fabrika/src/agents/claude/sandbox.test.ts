import {mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync} from "node:fs";
import {homedir, tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {gitOf, inside, opens, toolchain, toolRoot} from "./sandbox.ts";

const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), "sandbox-")));

describe("inside", () => {
	it.each([
		["/a", "/a"],
		["/a", "/a/b"],
		["/a", "/a/..y"],
		["/a", "/a/..y/z"],
		["/a", "/a/.. y"],
		["/a", "/a/..."],
	])("%s holds %s", (folder, path) => {
		expect(inside(folder, path)).toBe(true);
	});

	it.each([
		["/a", "/"],
		["/a", "/b"],
		["/a", "/a-b"],
		["/a", "/..y"],
		["/a/b", "/a/..y"],
	])("%s does not hold %s", (folder, path) => {
		expect(inside(folder, path)).toBe(false);
	});

	it("reads a login folder's child named `..y` as in the login", () => {
		expect(opens("/h/.ssh/..y", "/h", [".ssh"])).toBe(true);
	});
});

describe("the folder a program opens", () => {
	const home = "/made/up/home";

	it.each([
		["a version manager's own folder", ".volta/bin/node", ".volta"],
		["a version's folder", ".nvm/versions/node/v22/bin/node", ".nvm/versions/node/v22"],
		[
			"a package's folder",
			".npm-global/lib/node_modules/c/bin/c.js",
			".npm-global/lib/node_modules/c",
		],
		["the holder, under home", "bin/codex", "bin"],
		["the holder, under pnpm's folder on a Mac", "Library/pnpm/codex", "Library/pnpm"],
		["the holder, under `.local`", ".local/bin/codex", ".local/bin"],
		["the holder, under XDG's data", ".local/share/pnpm/codex", ".local/share/pnpm"],
		["the holder, under `.config`", ".config/tool/codex", ".config/tool"],
		[
			"the holder, under a Mac's app data",
			"Library/Application Support/x/codex",
			"Library/Application Support/x",
		],
		["the holder, in a folder that holds a login by name", ".cargo/bin/codex", ".cargo/bin"],
		["the holder, in a login", ".ssh/bin/codex", ".ssh/bin"],
	])("is %s", (_, program, root) => {
		expect(toolRoot(join(home, program), home)).toBe(join(home, root));
	});

	it("is home for a program right in it, which opens nothing", () => {
		expect(toolRoot(join(home, "codex"), home)).toBe(home);
	});

	it("is the folder above, outside home", () => {
		expect(toolRoot("/opt/tool/bin/codex", home)).toBe("/opt/tool");
	});

	it.each(["credentials", "credentials.toml", "credentials.json", ".npmrc", ".netrc", "auth.json"])(
		"is the holder when the folder above holds a file named %s",
		(login) => {
			const made = scratch();
			mkdirSync(join(made, ".tool", "bin"), {recursive: true});
			expect(toolRoot(join(made, ".tool", "bin", "codex"), made)).toBe(join(made, ".tool"));
			writeFileSync(join(made, ".tool", login), "");
			expect(toolRoot(join(made, ".tool", "bin", "codex"), made)).toBe(join(made, ".tool", "bin"));
		},
	);

	it("gives the toolchain the same answer: `.cargo` is not opened for `.cargo/bin`", () => {
		const env = {PATH: "", PNPM_HOME: "/opt/pnpm"};
		expect(toolchain(env, join(homedir(), ".cargo", "bin", "node"))).toEqual([
			join(homedir(), ".cargo", "bin"),
		]);
		expect(toolchain(env, join(homedir(), "Library", "pnpm", "node"))).toEqual([
			join(homedir(), "Library", "pnpm"),
		]);
	});
});

describe("the clone a worktree's copy reads", () => {
	/** The layout `git worktree add` makes: `<root>/clone/.git/worktrees/1`, and the tree `<root>/trees/1`. */
	const layout = () => {
		const root = scratch();
		const common = join(root, "clone", ".git");
		const own = join(common, "worktrees", "1");
		const tree = join(root, "trees", "1");
		mkdirSync(own, {recursive: true});
		mkdirSync(tree, {recursive: true});
		writeFileSync(join(tree, ".git"), `gitdir: ${own}\n`);
		writeFileSync(join(own, "commondir"), "../..\n");
		writeFileSync(join(own, "gitdir"), `${join(tree, ".git")}\n`);
		return {root, common, own, tree};
	};

	it("is the clone's git folder, for a real worktree", () => {
		const {common, tree} = layout();
		expect(gitOf(tree)).toEqual([common]);
	});

	it("follows a link in the worktree's own record of where it is", () => {
		const {root, own, tree, common} = layout();
		symlinkSync(join(root, "trees"), join(root, "spelled"));
		writeFileSync(join(own, "gitdir"), `${join(root, "spelled", "1", ".git")}\n`);
		expect(gitOf(tree)).toEqual([common]);
	});

	it("is nothing for a plain clone, or for no git", () => {
		const made = scratch();
		expect(gitOf(made)).toEqual([]);
		mkdirSync(join(made, ".git"));
		expect(gitOf(made)).toEqual([]);
	});

	it.each(["", "not a line git writes", "gitdir:", "gitdir: /nowhere/at/all"])(
		"is nothing for a `.git` file that says %j",
		(text) => {
			const made = scratch();
			writeFileSync(join(made, ".git"), `${text}\n`);
			expect(gitOf(made)).toEqual([]);
		},
	);

	// The agent may write this file, and the next turn's table is made from it. So what it names has to
	// be a worktree of this very tree, or a turn could open any folder it likes for the next one.
	it("is nothing when the `.git` file names another tree's worktree record", () => {
		const {root, tree} = layout();
		const other = join(root, "other", ".git", "worktrees", "9");
		mkdirSync(other, {recursive: true});
		writeFileSync(join(other, "commondir"), "../..\n");
		writeFileSync(join(other, "gitdir"), "/elsewhere/tree/.git\n");
		writeFileSync(join(tree, ".git"), `gitdir: ${other}\n`);
		expect(gitOf(tree)).toEqual([]);
	});

	it.each(["../../..", "../../../..", "../../../../..", "/made/up/secret", ".", ".."])(
		"is nothing when a record made in the tree says its common folder is %s",
		(common) => {
			const {tree} = layout();
			const fake = join(tree, "fake", "worktrees", "x");
			mkdirSync(fake, {recursive: true});
			writeFileSync(join(fake, "commondir"), `${common}\n`);
			writeFileSync(join(fake, "gitdir"), `${join(tree, ".git")}\n`);
			writeFileSync(join(tree, ".git"), `gitdir: ${fake}\n`);
			expect(gitOf(tree)).toEqual([]);
		},
	);

	it("is nothing when the record is not in a `worktrees` folder", () => {
		const {tree} = layout();
		const fake = join(tree, "fake", "other", "x");
		mkdirSync(fake, {recursive: true});
		writeFileSync(join(fake, "commondir"), "../..\n");
		writeFileSync(join(fake, "gitdir"), `${join(tree, ".git")}\n`);
		writeFileSync(join(tree, ".git"), `gitdir: ${fake}\n`);
		expect(gitOf(tree)).toEqual([]);
	});
});
