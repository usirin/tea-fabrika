import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {codexFolders} from "./adapter.ts";

// The lane starts Codex by the bare name `codex`. Its folders must come from the PATH, as the
// system finds it, or the box closes the binary its own tools run from.
describe("the folders Codex's own binary runs from", () => {
	let owner: string;

	beforeEach(() => {
		owner = realpathSync(mkdtempSync(join(tmpdir(), "codex-folders-")));
	});
	afterEach(() => {
		rmSync(owner, {recursive: true, force: true});
	});

	const program = (path: string) => {
		mkdirSync(join(path, ".."), {recursive: true});
		writeFileSync(path, "");
		chmodSync(path, 0o755);
	};

	it("finds a bare name on the PATH, through its link", () => {
		const target = join(owner, ".codex/packages/standalone/1/codex");
		program(target);
		const bin = join(owner, ".local/bin");
		mkdirSync(bin, {recursive: true});
		symlinkSync(target, join(bin, "codex"));
		expect(codexFolders("codex", owner, {PATH: `/nowhere:${bin}`})).toEqual([
			bin,
			join(owner, ".codex/packages"),
		]);
	});

	it("never opens the folder this process runs in", () => {
		const folders = codexFolders("codex", owner, {PATH: "/nowhere"});
		expect(folders).not.toContain(".");
		expect(folders).toEqual([]);
	});

	it("takes the first match on the PATH", () => {
		const first = join(owner, "first/bin");
		const second = join(owner, "second/bin");
		program(join(first, "codex"));
		program(join(second, "codex"));
		expect(codexFolders("codex", owner, {PATH: `${first}:${second}`})).toEqual([
			first,
			join(owner, "first"),
		]);
	});

	it("skips a PATH entry that is not absolute, which would mean this process's folder", () => {
		expect(codexFolders("codex", owner, {PATH: ".:bin"})).toEqual([]);
	});

	it("keeps a path it is given", () => {
		const given = join(owner, "tools/bin/codex");
		program(given);
		expect(codexFolders(given, owner, {PATH: ""})).toEqual([
			join(owner, "tools/bin"),
			join(owner, "tools"),
		]);
	});
});
