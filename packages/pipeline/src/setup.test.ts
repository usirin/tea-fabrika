import {describe, expect, it} from "vitest";
import {DEFAULT_SETTINGS, type Settings} from "./settings.ts";
import {HOLDS_NOTHING, type Holds, type Local, setupLines, setupOf} from "./setup.ts";

// The picks one run works by, from fabrika.toml, tsh.toml and what the
// repository holds, each said with where it came from. Pure.

const NOTHING_SAID: Local = {model: null, effort: null, budget: null, rubrics: null};
/** The repository's folder is handed in always: only fabrika.toml's pick says it is read. */
const PLACES = {shipped: "/fabrika/rubrics", repo: "/home/rubrics/c0ffee"};

/** A fresh npm repository: a lockfile and nothing else fabrika reads. */
const NPM: Holds = {files: new Set(["package-lock.json"]), rubrics: {}};

const linesOf = (settings: Settings, holds: Holds, local: Local = NOTHING_SAID) =>
	setupLines(setupOf(settings, holds, local, PLACES), holds, settings);
const lineOf = (lines: readonly string[], key: string) =>
	lines.filter((line) => line.startsWith(key)).join("\n");

describe("a repository that writes nothing", () => {
	const setup = setupOf(DEFAULT_SETTINGS, NPM, NOTHING_SAID, PLACES);
	const lines = linesOf(DEFAULT_SETTINGS, NPM);

	it("every pick is a named default, and the run says each one and why", () => {
		expect(setup.install).toEqual({value: ["npm", "ci"], from: "repo"});
		expect(setup.told).toEqual({value: [], from: "default"});
		expect(setup.rubrics).toEqual({value: "/fabrika/rubrics", from: "default"});
		expect(setup.kinds).toEqual({value: {governed: [], ui: []}, from: "default"});
		expect(setup.github.value).toBe("every");
		expect(setup.approval.value).toBe("codeowners");
		expect(setup.ledger.value).toBe("local");
		expect(setup.agents.build).toEqual({
			model: {value: "opus", from: "default"},
			effort: {value: "medium", from: "default"},
			budget: {value: 2, from: "default"},
		});
		expect(lineOf(lines, "build.install")).toBe(
			"build.install: npm ci (default: package-lock.json at main)",
		);
		expect(lineOf(lines, "review.rubrics")).toContain("the rubrics fabrika ships");
		expect(lineOf(lines, "rules")).toContain("CLAUDE.md none at main");
	});

	it("a pick that will stop the run later is said at the start, with the key that changes it", () => {
		expect(lineOf(lines, "ship.approval")).toContain("no .github/CODEOWNERS at main");
		expect(lineOf(lines, "ship.approval")).toContain('[ship] approval = "none"');
		expect(lineOf(lines, "checks.github")).toContain("checks wait for ever: add a [[checks.run]]");
	});

	it("a CODEOWNERS file GitHub would read elsewhere is named as not read", () => {
		const holds: Holds = {files: new Set(["CODEOWNERS"]), rubrics: {}};
		expect(lineOf(linesOf(DEFAULT_SETTINGS, holds), "ship.approval")).toContain(
			"(CODEOWNERS is not read)",
		);
	});

	it("no lockfile: nothing is installed, and the line says why", () => {
		expect(setupOf(DEFAULT_SETTINGS, HOLDS_NOTHING, NOTHING_SAID, PLACES).install.value).toEqual(
			[],
		);
		expect(lineOf(linesOf(DEFAULT_SETTINGS, HOLDS_NOTHING), "build.install")).toBe(
			"build.install: none (default: no lockfile at main)",
		);
	});
});

describe("the line a run prints about review kinds", () => {
	const JSONC: Holds = {files: new Set([".fabrika.jsonc"]), rubrics: {}};
	const NOT_READ =
		"review kinds: .fabrika.jsonc at main is not read: review rules are [review] in .fabrika/fabrika.toml";
	const NOTHING_NAMED =
		"review kinds: governed [] and ui [] (default), read at each change's base and head: text reviews only";
	const review = (rules: NonNullable<Settings["review"]>): Settings => ({
		...DEFAULT_SETTINGS,
		review: rules,
	});
	/** Every line a run prints about review kinds, whole and in order. */
	const kindsLines = (settings: Settings, holds: Holds = NPM) =>
		linesOf(settings, holds).filter((line) => line.startsWith("review kinds"));

	it("nothing named: empty lists, by default, and it says only text reviews run", () => {
		expect(kindsLines(DEFAULT_SETTINGS)).toEqual([NOTHING_NAMED]);
	});

	it("rules named: each list says all its entries, as the file's, and text reviews are not all it runs", () => {
		const rules = {
			governed: [".github/", "AGENTS.md"],
			ui: ["apps/web/src/", "apps/desk/src/"],
		};
		expect(kindsLines(review(rules))).toEqual([
			"review kinds: governed [.github/, AGENTS.md] and ui [apps/web/src/, apps/desk/src/] (from fabrika.toml), read at each change's base and head",
		]);
	});

	it.each<[string, NonNullable<Settings["review"]>, string]>([
		["governed alone", {governed: [".github/"]}, "governed [.github/] and ui []"],
		["ui alone", {ui: ["apps/web/src/"]}, "governed [] and ui [apps/web/src/]"],
	])("%s: the other is an empty list, and more than text reviews run", (_name, rules, says) => {
		expect(kindsLines(review(rules))).toEqual([
			`review kinds: ${says} (from fabrika.toml), read at each change's base and head`,
		]);
	});

	it("no .fabrika.jsonc at main: nothing is said about one", () => {
		expect(
			linesOf(DEFAULT_SETTINGS, NPM).filter((line) => line.includes(".fabrika.jsonc")),
		).toEqual([]);
	});

	it(".fabrika.jsonc at main: the run says it is not read, and where the rules are", () => {
		expect(kindsLines(DEFAULT_SETTINGS, JSONC)).toEqual([NOTHING_NAMED, NOT_READ]);
		expect(
			linesOf(DEFAULT_SETTINGS, JSONC).filter((line) => line.includes(".fabrika.jsonc")),
		).toEqual([NOT_READ]);
	});

	it(".fabrika.jsonc at main beside rules in the file: still said, since a person may think it counts", () => {
		expect(kindsLines(review({governed: [".github/"]}), JSONC)).toEqual([
			"review kinds: governed [.github/] and ui [] (from fabrika.toml), read at each change's base and head",
			NOT_READ,
		]);
	});
});

describe("where each agent setting comes from", () => {
	const settings: Settings = {...DEFAULT_SETTINGS, agents: {build: {model: "haiku", usd: 0.4}}};
	const local: Local = {model: "sonnet", effort: "high", budget: null, rubrics: null};

	it("fabrika.toml's step table first, then tsh.toml, then the code's own", () => {
		const setup = setupOf(settings, NPM, local, PLACES);
		expect(setup.agents.build).toEqual({
			model: {value: "haiku", from: "fabrika.toml"},
			effort: {value: "high", from: "tsh.toml"},
			budget: {value: 0.4, from: "fabrika.toml"},
		});
		expect(setup.agents.review).toEqual({
			model: {value: "sonnet", from: "tsh.toml"},
			effort: {value: "high", from: "tsh.toml"},
			budget: {value: 2, from: "default"},
		});
		expect(lineOf(linesOf(settings, NPM, local), "agents.build")).toBe(
			"agents.build: haiku (from fabrika.toml), effort high (from tsh.toml), at most $0.4 a run (from fabrika.toml)",
		);
	});
});

describe("a repository that names its own", () => {
	const settings: Settings = {
		...DEFAULT_SETTINGS,
		review: {rubrics: "docs/rubrics"},
		checks: {github: "none", run: [{name: "test", run: ["npm", "test"]}]},
		ship: {approval: "none"},
		ledger: {at: "sqlite"},
	};
	const holds: Holds = {files: new Set(["package-lock.json"]), rubrics: {"code.md": "# ours"}};
	const setup = setupOf(settings, holds, NOTHING_SAID, {shipped: "/fabrika/rubrics", repo: "/w/r"});
	const lines = setupLines(setup, holds, settings);

	it("[review] is what the start of a run prints as the kinds", () => {
		const named: Settings = {...DEFAULT_SETTINGS, review: {governed: [".github/"]}};
		expect(setupOf(named, holds, NOTHING_SAID, PLACES).kinds).toEqual({
			value: {governed: [".github/"], ui: []},
			from: "fabrika.toml",
		});
	});

	it("each of its picks is taken, and said to be its own", () => {
		expect(setup.told).toEqual({value: [["npm", "test"]], from: "fabrika.toml"});
		expect(setup.rubrics).toEqual({value: "/w/r", from: "fabrika.toml"});
		expect(setup.approval).toEqual({value: "none", from: "fabrika.toml"});
		expect(setup.ledger).toEqual({value: "sqlite", from: "fabrika.toml"});
		expect(lineOf(lines, "build.checks")).toBe(
			"build.checks: npm test (default: the [[checks.run]] commands)",
		);
	});

	it("a rubric its folder lacks is named, with the stop it leads to", () => {
		expect(lineOf(lines, "review.rubrics: doc.md")).toContain("rubric_unknown");
		expect(lineOf(lines, "review.rubrics: code.md")).toBe("");
	});

	it("a rubrics folder in tsh.toml wins over the repository's", () => {
		const local = {...NOTHING_SAID, rubrics: "/mine"};
		expect(setupOf(settings, holds, local, {shipped: "/s", repo: "/w/r"}).rubrics).toEqual({
			value: "/mine",
			from: "tsh.toml",
		});
	});
});
