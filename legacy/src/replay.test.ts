import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {
	kindOf,
	packageOf,
	pathsOutside,
	ReplayIndex,
	ReplayIssue,
	rawIssueOf,
	testsFileFor,
	toFilingPath,
	toPrPath,
} from "./replay.ts";

const folder = join(import.meta.dirname, "..", "replay");
const load = (n: number) =>
	ReplayIssue.parse(JSON.parse(readFileSync(join(folder, "issues", `${n}.json`), "utf8")));
const all = readdirSync(join(folder, "issues")).map((file) =>
	load(Number(file.replace(".json", ""))),
);

describe("the replay set", () => {
	it("parses, every issue and the index", () => {
		expect(all).toHaveLength(23);
		const index = ReplayIndex.parse(JSON.parse(readFileSync(join(folder, "index.json"), "utf8")));
		expect(index.issues.map((r) => r.number).sort()).toEqual(all.map((r) => r.number).sort());
	});

	it("sorts every changed file into the kind the set gives it, by its path alone", () => {
		const wrong = all.flatMap((r) =>
			r.filesChanged.flatMap((f) =>
				kindOf(f.path, r.preMonorepoLayout) === f.kind ? [] : [`#${r.number} ${f.path}: ${f.kind}`],
			),
		);
		expect(wrong).toEqual([]);
	});
});

describe("the package an issue's tests go in", () => {
	it("is the root before the monorepo move", () => {
		expect(packageOf(load(296))).toBe(".");
	});

	it("is the package the PR changed most files of", () => {
		expect(packageOf(load(567))).toBe("packages/tea");
		expect(packageOf(load(565))).toBe("packages/code-graph");
	});

	it("on a tie, is the package the report names more often", () => {
		// Two files each in backlog-sweep and structure-sweep; the report is about structure-sweep.
		expect(packageOf(load(483))).toBe("packages/structure-sweep");
	});

	it("is the root when the issue was filed before the move, though the PR came after", () => {
		expect(packageOf(load(333))).toBe("packages/tea");
		expect(packageOf(load(333), true)).toBe(".");
		expect(toPrPath("src/agent/tool.ts", load(333), true)).toBe("packages/tea/src/agent/tool.ts");
		expect(toFilingPath("packages/tea/src/agent/tool.ts", load(333), true)).toBe(
			"src/agent/tool.ts",
		);
		// Before the move on both sides, nothing is moved.
		expect(toPrPath("src/pure/core.ts", load(296), true)).toBe("src/pure/core.ts");
	});

	it("puts the tests under test/ when the package keeps them there", () => {
		expect(testsFileFor("483", true)).toBe("test/fabrika-483.test.ts");
		expect(testsFileFor("567", false)).toBe("src/fabrika-567.test.ts");
	});
});

describe("what an agent read outside its clone", () => {
	it("is every absolute path its tools were given that is not under the clone", () => {
		const event = (input: Record<string, unknown>) =>
			JSON.stringify({
				type: "assistant",
				message: {content: [{type: "tool_use", name: "Read", input}]},
			});
		const transcript = [
			event({file_path: "/tmp/replay-7/packages/tea/src/a.ts"}),
			event({file_path: "packages/tea/src/b.ts"}),
			event({pattern: "**/*.ts", path: "/tmp/replay-7"}),
			event({file_path: "/home/someone/demlik/packages/tea/src/a.ts"}),
			event({pattern: "/tmp/replay-70/**"}),
			JSON.stringify({type: "user", message: {content: "plain text"}}),
			"",
		].join("\n");
		expect(pathsOutside(transcript, "/tmp/replay-7")).toEqual([
			"/home/someone/demlik/packages/tea/src/a.ts",
			"/tmp/replay-70/**",
		]);
	});
});

describe("the ticket triage starts from", () => {
	it("is the report as filed, and who filed it", () => {
		const raw = rawIssueOf(load(333));
		expect(raw).toMatchObject({id: "333", filedBy: "human"});
		expect(raw.body).toBe(load(333).rawReport);
	});

	it("is refused for an issue kept for the lane only", () => {
		expect(() => rawIssueOf(load(155))).toThrow(/not for replaying triage/);
	});
});
