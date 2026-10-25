import {describe, expect, it} from "vitest";
import {
	checkChange,
	everyOwner,
	guarded,
	matcherFor,
	ownersOf,
	parseCodeowners,
	teamOf,
} from "./codeowners.ts";
import {nameOf} from "./stages/outcome.ts";

// A CODEOWNERS file as the list of protected files and their owners.

const rows = parseCodeowners(`
# The control plane.
/.github/          @example-org/control-plane
/biome.jsonc       @example-org/control-plane   # lint rules
**/lefthook*       @a-person
docs/*             @example-org/writers
/.github/README.md
`);

describe("reading the file", () => {
	it("keeps each row's pattern and owners, and drops comments and blank lines", () => {
		expect(rows).toEqual([
			{pattern: "/.github/", owners: ["@example-org/control-plane"]},
			{pattern: "/biome.jsonc", owners: ["@example-org/control-plane"]},
			{pattern: "**/lefthook*", owners: ["@a-person"]},
			{pattern: "docs/*", owners: ["@example-org/writers"]},
			{pattern: "/.github/README.md", owners: []},
		]);
		expect(everyOwner(rows)).toEqual([
			"@example-org/control-plane",
			"@a-person",
			"@example-org/writers",
		]);
	});

	it("tells a team from one account", () => {
		expect(teamOf("@example-org/control-plane")).toEqual({
			org: "example-org",
			team: "control-plane",
		});
		expect(teamOf("@a-person")).toBeNull();
	});
});

describe("who owns a path", () => {
	it.each<[string, readonly string[]]>([
		[".github/workflows/build.yaml", ["@example-org/control-plane"]],
		["biome.jsonc", ["@example-org/control-plane"]],
		// Anchored at the root: a file of the same name deeper down is not it.
		["packages/a/biome.jsonc", []],
		["lefthook.yml", ["@a-person"]],
		["packages/a/lefthook.yml", ["@a-person"]],
		// One level only.
		["docs/a.md", ["@example-org/writers"]],
		["docs/deep/a.md", []],
		// The last row that covers a path decides, and a row with no owner takes them away.
		[".github/README.md", []],
		["src/a.ts", []],
	])("%s", (path, owners) => {
		expect(ownersOf(rows, path)).toEqual(owners);
	});

	it("reads the pattern shapes GitHub has", () => {
		const covers = (pattern: string, path: string) => matcherFor(pattern).test(path);

		expect(covers("*", "any/file.ts")).toBe(true);
		expect(covers("*.md", "docs/deep/a.md")).toBe(true);
		expect(covers("/apps/", "apps/web/a.ts")).toBe(true);
		expect(covers("/apps/", "packages/apps/a.ts")).toBe(false);
		expect(covers("apps/", "packages/apps/a.ts")).toBe(true);
		expect(covers("/docs", "docs/a.md")).toBe(true);
		expect(covers("/docs", "docs.md")).toBe(false);
		expect(covers("/a/**/c.ts", "a/c.ts")).toBe(true);
		expect(covers("/a/**/c.ts", "a/b/b/c.ts")).toBe(true);
		expect(covers("/a.b/", "aXb/c")).toBe(false);
	});
});

describe("guarded files: a change to the exam asks the owner", () => {
	const changed = ["src/a.ts", ".github/workflows/build.yaml", ".github/README.md", "lefthook.yml"];

	it("keeps the changed paths a row covers with an owner, in the diff's order", () => {
		expect(guarded(rows, changed)).toEqual([".github/workflows/build.yaml", "lefthook.yml"]);
		expect(guarded([], changed)).toEqual([]);
	});

	it("ends as ask:owner:check_change with the files, and asks nothing when none are guarded", () => {
		const asked = checkChange(guarded(rows, changed));
		expect(asked).toEqual({
			kind: "ask",
			who: "owner",
			for: "check_change",
			files: [".github/workflows/build.yaml", "lefthook.yml"],
		});
		expect(asked === null ? null : nameOf(asked)).toBe("ask:owner:check_change");
		expect(checkChange(guarded(rows, ["src/a.ts"]))).toBeNull();
	});
});
