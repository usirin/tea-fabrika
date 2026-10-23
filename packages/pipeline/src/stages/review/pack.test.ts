import {Effect} from "effect";
import {describe, expect, it} from "vitest";
import {checksOf, readChange} from "../../code-host-github.ts";
import {criterionId} from "../../ids.ts";
import {criteriaIn, deviationsIn, readPack} from "./pack.ts";
import {
	type Answers,
	BASE,
	changed,
	HEADS,
	PR,
	RUBRICS,
	recorded,
	recordedGh,
	recordedHost,
	type Which,
} from "./scripted.ts";

// The pack, against real text. The tickets under `fixtures/review/tickets/`
// are the bodies of three real public issues, whole. The answers the read is
// tested on were recorded from a real pull request (see `scripted.ts`).

const ticket = (n: number) => recorded(`tickets/${n}.md`);
const changeAt = (which: Which, answers: Answers = {}, head: string | null = HEADS[which]) => {
	const {gh, calls} = recordedGh(which, answers);
	return {read: Effect.runPromise(Effect.result(readChange(gh)(PR, head))), calls};
};
const change = async (which: Which, answers: Answers = {}, head: string | null = HEADS[which]) => {
	const result = await changeAt(which, answers, head).read;
	if (result._tag === "Failure") throw new Error("the read failed");
	return result.success;
};
const failure = async (which: Which, answers: Answers = {}, head: string | null = HEADS[which]) =>
	(await changeAt(which, answers, head).read)._tag;
const body = (text: string) =>
	changed(recorded("change-final.json"), (repo) => {
		repo.pullRequest.body = text;
	});

describe("the acceptance criteria of a real ticket", () => {
	it("reads five criteria, numbered in order, and nothing from the folded report under them", () => {
		const criteria = criteriaIn(ticket(625)) ?? [];
		// A list written before ids: each gets the id its place gives, at version 1.
		expect(criteria.map((c) => [c.id, c.version])).toEqual([
			["c1", 1],
			["c2", 1],
			["c3", 1],
			["c4", 1],
			["c5", 1],
		]);
		expect(criteria.every((c) => !c.checked && c.evidence === null)).toBe(true);
		expect(criteria[0]?.text).toMatch(
			/^A CI job can tell a crash from a miss by the exit code alone\./,
		);
		expect(criteria[4]?.text).toMatch(/pass from the repo root\.$/);
		// The ticket's `<details>` block has seven headings and a list of its own. None of it is a criterion.
		expect(ticket(625)).toContain("<details>");
		expect(criteria.some((c) => c.text.includes("Suggested next step"))).toBe(false);
	});

	it("keeps an evidence mark as a field of its own, out of the criterion's text", () => {
		const [first, second] = criteriaIn(ticket(623)) ?? [];
		expect(criteriaIn(ticket(623))).toHaveLength(7);
		expect(first?.evidence).toBe(
			'a "Fixture run" section in the PR body with the commands and their output',
		);
		expect(first?.text).not.toContain("[evidence");
		expect(first?.text).toMatch(/same output, same exit code\.$/);
		expect(second?.evidence).toBeNull();
	});

	it("stops at the next heading: the no-gos under the list are not criteria", () => {
		expect(ticket(623)).toMatch(/### No-gos\n\n- No change to the bump policy/);
		expect(criteriaIn(ticket(623))?.at(-1)?.text).toBe(
			"`pnpm typecheck && pnpm lint && pnpm test` pass from the root.",
		);
		expect(criteriaIn(ticket(622))).toHaveLength(11);
	});
});

describe("the acceptance criteria of a ticket written another way", () => {
	const read = (...lines: string[]) =>
		criteriaIn(["## What to build", "", "### Acceptance criteria", ...lines].join("\n"));
	const under = (...lines: string[]) => read(...lines) ?? [];
	const c = (id: string, version: number, text: string, checked = false) => ({
		id: criterionId(id),
		version,
		text,
		checked,
		evidence: null,
	});

	it("reads a list with no blank line under the heading, a ticked box, and any bullet", () => {
		expect(under("- [x] one", "* [X] two", "+ [ ] three")).toEqual([
			c("c1", 1, "one", true),
			c("c2", 1, "two", true),
			c("c3", 1, "three"),
		]);
	});

	it("reads each criterion under the id and version its box opens with, whatever its place", () => {
		expect(
			under(
				"- [ ] `c4 v1` a claim put in first",
				"- [x] `c1 v2` the job, said again",
				"  - _Serves s1. Check (test): a test_",
				"- [ ] `c3 v1` the last",
			),
		).toEqual([
			c("c4", 1, "a claim put in first"),
			c("c1", 2, "the job, said again", true),
			c("c3", 1, "the last"),
		]);
	});

	it("reads nothing it would have to guess: some boxes marked and some not, or one id twice, is no list", () => {
		expect(read("- [ ] `c1 v1` one", "- [ ] two")).toBeNull();
		expect(read("- [ ] `c1 v1` one", "- [ ] `c1 v2` one again")).toBeNull();
		// A box whose mark is no id the book could give is not marked.
		expect(read("- [ ] `c0 v1` one", "- [ ] `c2 v1` two")).toBeNull();
	});

	it("takes a criterion that wraps onto more lines as one, and a nested box as one of its own", () => {
		expect(
			under(
				"",
				"- [ ] the first line",
				"  goes on here",
				"  - [ ] a nested one",
				"",
				"- [ ] the last",
			).map((c) => c.text),
		).toEqual(["the first line goes on here", "a nested one", "the last"]);
	});

	it("does not take a plain bullet, a numbered item or a quote for part of a criterion", () => {
		expect(
			under("- [ ] one", "- a note, not a box", "1. a step", "> a quote", "- [ ] two").map(
				(c) => c.text,
			),
		).toEqual(["one", "two"]);
	});

	it("does not read a box inside a code fence, or a heading inside one", () => {
		expect(
			under(
				"",
				"- [ ] one",
				"",
				"```md",
				"### Not a heading",
				"- [ ] not a criterion",
				"```",
				"- [ ] two",
			).map((c) => c.text),
		).toEqual(["one", "two"]);
	});

	it("drops a hidden mark a tool left after a criterion, and keeps an evidence mark that names nothing", () => {
		expect(under("- [ ] one <!-- id: 7 -->", "- [ ] two [evidence: ]")).toEqual([
			c("c1", 1, "one"),
			c("c2", 1, "two [evidence: ]"),
		]);
	});

	it("answers with none when the ticket has no such heading, or no box under it", () => {
		expect(criteriaIn("## Scope\n\n- [ ] a box under another heading")).toEqual([]);
		expect(under("", "Nothing to check here.")).toEqual([]);
		// A heading in a folded block is the report as filed, never the contract.
		expect(
			criteriaIn("<details>\n\n### Acceptance criteria\n\n- [ ] from the old report\n\n</details>"),
		).toEqual([]);
	});

	it("finds the heading at any level, with a colon after it, in any case", () => {
		expect(criteriaIn("# ACCEPTANCE CRITERIA:\n- [ ] one")).toHaveLength(1);
	});
});

describe("the deviations section of a pull request's text", () => {
	it("reads the real one as written, without the line a tool signed the text with", () => {
		const text = JSON.parse(recorded("change-final.json")).data.repository.pullRequest
			.body as string;
		expect(text).toMatch(/Generated with \[Claude Code\]\(https:\/\/claude\.com\/claude-code\)\n$/);
		const deviations = deviationsIn(text);
		if (deviations.state !== "listed") throw new Error("not listed");
		expect(deviations.text.split("\n")).toHaveLength(2);
		expect(deviations.text).toMatch(/^- \*\*Declined guidance\*\*/);
		expect(deviations.text).toMatch(/leave the same line in the other modes\.$/);
	});

	it.each([
		["no such section", "A change.\n\nFixes #1", {state: "absent"}],
		["a heading with nothing under it", "## Deviations\n\n## Notes\n\ntext", {state: "absent"}],
		["the word alone", "## Deviations\n\nNone", {state: "none"}],
		[
			"the word, with the signing line and its link after it",
			"## Deviations\n\nNone.\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nhttps://example.com/session_1\n",
			{state: "none"},
		],
		["the word in bold", "### Deviations\n**None**", {state: "none"}],
		[
			"a sentence that starts with the word",
			"## Deviations\n\nNone that matter.",
			{state: "listed", text: "None that matter."},
		],
		[
			"a section that runs to the next heading of its level",
			"## Deviations\n\n- one\n\n### Why\n\nbecause\n\n## Notes\n\nmore",
			{state: "listed", text: "- one\n\n### Why\n\nbecause"},
		],
	])("%s", (_name, text, expected) => {
		expect(deviationsIn(text)).toEqual(expected);
	});
});

describe("the required checks of a commit", () => {
	const run = (conclusion: string | null, isRequired = true, status = "COMPLETED") => ({
		__typename: "CheckRun" as const,
		name: "build",
		status,
		conclusion,
		isRequired,
	});
	const status = (state: string) => ({
		__typename: "StatusContext" as const,
		context: "deploy",
		state,
		isRequired: true,
	});
	const rollup = (
		nodes: readonly (ReturnType<typeof run> | ReturnType<typeof status>)[],
		hasNextPage = false,
	) => ({contexts: {pageInfo: {hasNextPage}, nodes}});

	it.each([
		["no check has reported", null, "pending"],
		["checks ran, and none of them is required", rollup([run("FAILURE", false)]), "pending"],
		[
			"every required one is green",
			rollup([run("SUCCESS"), run("SKIPPED"), run("NEUTRAL"), status("SUCCESS")]),
			"green",
		],
		["one is still running", rollup([run("SUCCESS"), run(null, true, "IN_PROGRESS")]), "pending"],
		["a status is still expected", rollup([status("EXPECTED")]), "pending"],
		["one is red beside a running one", rollup([run(null, true, "QUEUED"), run("FAILURE")]), "red"],
		["a run timed out, was cancelled or wants a person", rollup([run("TIMED_OUT")]), "red"],
		["a status errored", rollup([run("SUCCESS"), status("ERROR")]), "red"],
		["a word this does not know", rollup([run("STALE")]), "pending"],
		[
			"the list was not read whole, and nothing read is red",
			rollup([run("SUCCESS")], true),
			"unknown",
		],
		["the list was not read whole, and one read is red", rollup([run("FAILURE")], true), "red"],
	] as const)("%s", (_name, read, expected) => {
		expect(checksOf(read).state).toBe(expected);
	});

	it("lists only the required ones, each by its name", () => {
		expect(
			checksOf(rollup([run("SUCCESS"), run("FAILURE", false), status("PENDING")])).required,
		).toEqual([
			{name: "build", state: "green"},
			{name: "deploy", state: "pending"},
		]);
	});

	it("on a repo that requires none, counting every check: a red one that is not required is red", () => {
		const none = rollup([run("SUCCESS", false), run("FAILURE", false)]);
		expect(checksOf(none).state).toBe("pending");
		expect(checksOf(none, "every").state).toBe("red");
		expect(checksOf(rollup([run("SUCCESS", false)]), "every").state).toBe("green");
	});
});

describe("one pull request at one commit, read from recorded answers", () => {
	it("reads the first reviewed head: the required check is red there", async () => {
		const read = await change("first");
		expect(read).toEqual({
			pr: PR,
			head: HEADS.first,
			replay: true,
			state: "merged",
			ticket: {id: "example/repo#625", link: "closes_it"},
			criteria: criteriaIn(ticket(625)),
			files: [
				{path: ".changeset/code-graph-api-crash-exit.md", kind: "review-doc"},
				{path: "packages/code-graph/SPEC.md", kind: "review-doc"},
				{path: "packages/code-graph/docs/reference/cli.md", kind: "review-doc"},
				{path: "packages/code-graph/src/api/cli.ts", kind: "review-code"},
				{path: "packages/code-graph/src/api/crash.test.ts", kind: "review-code"},
			],
			kinds: ["review-code", "review-doc"],
			diff: recorded("compare-first.diff"),
			deviations: deviationsIn(
				JSON.parse(recorded("change-first.json")).data.repository.pullRequest.body,
			),
			checks: {
				state: "red",
				required: [
					{name: "test-and-build", state: "red"},
					{name: "test-and-build", state: "red"},
				],
			},
			rules: [],
		});
		expect(read.criteria).toHaveLength(5);
	});

	it("reads the repository's own rules from the base branch, never the head, and leaves out a file that is not there", async () => {
		const rule = "A change that touches a package's published surface also needs a changeset.";
		const {read, calls} = changeAt("first", {
			change: changed(recorded("change-first.json"), (repo) => {
				repo.claudeMd = {text: `# repo\n\n${rule}\n`};
				repo.agentsMd = null;
			}),
		});
		const result = await read;
		if (result._tag === "Failure") throw new Error("the read failed");
		expect(result.success.rules).toEqual([{file: "CLAUDE.md", text: `# repo\n\n${rule}\n`}]);
		// Asked at the base the pull request merges into: a change cannot write its own rules.
		const second = calls[1] ?? [];
		expect(second).toContain("claudeMd=main:CLAUDE.md");
		expect(second).toContain("agentsMd=main:AGENTS.md");
		expect(second.some((arg) => arg.includes(`${HEADS.first}:CLAUDE.md`))).toBe(false);
	});

	it("cuts a rules file too long to hand an agent whole, and says where it was cut", async () => {
		const read = await change("first", {
			change: changed(recorded("change-first.json"), (repo) => {
				repo.claudeMd = {text: "x".repeat(50_000)};
				repo.agentsMd = {text: "   \n"};
			}),
		});
		expect(read.rules).toHaveLength(1);
		expect(read.rules[0]?.text.length).toBeLessThan(41_000);
		expect(read.rules[0]?.text).toContain("[cut here");
	});

	it("reads the head that merged: two more files, and the check is green", async () => {
		const read = await change("final");
		expect(read.head).toBe(HEADS.final);
		expect(read.files).toHaveLength(7);
		expect(read.diff).toBe(recorded("compare-final.diff"));
		expect(read.checks).toEqual({
			state: "green",
			required: [
				{name: "test-and-build", state: "green"},
				{name: "test-and-build", state: "green"},
			],
		});
	});

	it("asks for everything at the commit it was told, in five calls that only read", async () => {
		const {read, calls} = changeAt("first");
		await read;
		const plain = calls.map((call) => call.filter((arg) => !arg.startsWith("query=")).join(" "));
		const range = `repos/example/repo/compare/${BASE}...${HEADS.first}`;
		expect(plain).toEqual([
			"api graphql -f owner=example -f name=repo -F number=628 -f",
			`api graphql -f owner=example -f name=repo -F number=628 -f head=${HEADS.first} -f baseConfig=main:.fabrika.jsonc -f headConfig=${HEADS.first}:.fabrika.jsonc -f claudeMd=main:CLAUDE.md -f agentsMd=main:AGENTS.md -f`,
			"api graphql -f owner=example -f name=repo -F number=625 -f",
			`api ${range}`,
			`api ${range} -H Accept: application/vnd.github.diff`,
		]);
		const queries = calls.flatMap((call) => call.filter((arg) => arg.startsWith("query=")));
		expect(queries.some((query) => query.includes("mutation"))).toBe(false);
		expect(calls.some((call) => call.includes("-X") || call.includes("--method"))).toBe(false);
	});

	it("reads the head as it is now when no commit is named, and that is not a replay", async () => {
		const read = await change("final", {}, null);
		expect(read).toMatchObject({head: HEADS.final, replay: false, state: "merged"});
	});

	it("fails when the head moved between the first two calls, on a read that is not a replay", async () => {
		expect(await failure("final", {now: HEADS.first}, null)).toBe("Failure");
		// A replay names its commit, so where the head is now does not matter.
		expect(await failure("first", {now: BASE})).toBe("Success");
	});

	it.each([
		["the first call breaks", {now: "breaks"}],
		["the second call breaks", {change: "breaks"}],
		["the second answer is not JSON", {change: "<html>"}],
		[
			"the repo has no such commit",
			{
				change: changed(recorded("change-final.json"), (repo) => {
					repo.commit = null;
				}),
			},
		],
	] as const)("fails, and guesses nothing, when %s", async (_name, answers) => {
		expect(await failure("final", answers)).toBe("Failure");
	});

	it("fails on a commit that is not named whole, before any call", async () => {
		const {read, calls} = changeAt("final", {}, "b695a2a");
		expect((await read)._tag).toBe("Failure");
		expect(calls).toEqual([]);
	});

	it("gives no criteria when the ticket cannot be read, and keeps the rest", async () => {
		const read = await change("final", {ticket: "breaks"});
		expect(read.criteria).toBeNull();
		expect(read.ticket).toEqual({id: "example/repo#625", link: "closes_it"});
		expect(read.files).toHaveLength(7);
	});

	it("names no ticket, and asks for none, when the text has no closing line", async () => {
		const {read, calls} = changeAt("final", {change: body("A change.\n\nRefs #625")});
		expect(await read).toMatchObject({success: {ticket: "none", criteria: null}});
		expect(calls).toHaveLength(4);
	});

	it("asks another repo for the ticket when the text names one there", async () => {
		const {read, calls} = changeAt("final", {change: body("Part of other-org/tickets#12")});
		expect(await read).toMatchObject({
			success: {ticket: {id: "other-org/tickets#12", link: "part_of_it"}},
		});
		expect(calls[2]?.slice(0, 8)).toEqual([
			"api",
			"graphql",
			"-f",
			"owner=other-org",
			"-f",
			"name=tickets",
			"-F",
			"number=12",
		]);
	});

	it("answers with an empty list for a ticket that has no acceptance criteria", async () => {
		const read = await change("final", {
			ticket: JSON.stringify({data: {repository: {issue: {body: "Just a note."}}}}),
		});
		expect(read.criteria).toEqual([]);
	});

	it.each([
		["the list of files cannot be read", {files: "breaks"}],
		["the diff cannot be read", {diff: "breaks"}],
		[
			"there are 300 files or more, so the list may be cut",
			{
				files: JSON.stringify({
					files: Array.from({length: 300}, (_, at) => ({filename: `src/f${at}.ts`})),
				}),
			},
		],
	] as const)("gives no files and no diff when %s", async (_name, answers) => {
		const read = await change("final", answers);
		expect(read.files).toBeNull();
		expect(read.diff).toBeNull();
		// The kinds come from the list of files: known when that list was read whole, and only then.
		expect(read.kinds).toEqual("diff" in answers ? ["review-code", "review-doc"] : null);
		// The parts that were read are still there.
		expect(read.criteria).toHaveLength(5);
		expect(read.checks.state).toBe("green");
	});

	it("gives no kinds when the repo's rules cannot be read, and keeps the files", async () => {
		const read = await change("final", {
			change: changed(recorded("change-final.json"), (repo) => {
				repo.headConfig = null;
			}),
		});
		expect(read.kinds).toBeNull();
		expect(read.files).toHaveLength(7);
	});

	it("owes the governance review too when a governed file changed", async () => {
		const files = JSON.stringify({
			files: [
				{filename: "src/a.ts"},
				{filename: ".github/workflows/build.yaml"},
				{filename: "skills/x/SKILL.md"},
			],
		});
		const read = await change("final", {files});
		expect(read.kinds).toEqual(["review-code", "review-skill", "governance"]);
		expect(read.files?.map((file) => file.kind)).toEqual([
			"review-code",
			"review-code",
			"review-skill",
		]);
	});
});

describe("the whole pack", () => {
	const packOf = (which: Which, rubrics: string, answers: Answers = {}) =>
		Effect.runPromise(
			readPack({pr: PR, head: HEADS[which], rubrics}).pipe(
				Effect.provide(recordedHost(recordedGh(which, answers).gh)),
			),
		);

	it("adds one rubric per text review the change owes, read from the folder it was given", async () => {
		const pack = await packOf("final", RUBRICS);
		expect(pack.rubrics.map((rubric) => rubric.kind)).toEqual(["review-code", "review-doc"]);
		expect(pack.rubrics[0]?.text).toContain("A made-up code rubric");
		expect(pack.rubrics[1]?.text).toContain("A made-up doc rubric");
	});

	it("says so when a rubric is not in the folder, and never makes one up", async () => {
		const files = JSON.stringify({files: [{filename: "skills/x/SKILL.md"}]});
		expect((await packOf("final", RUBRICS, {files})).rubrics).toEqual([
			{kind: "review-skill", text: null},
		]);
		expect((await packOf("final", "/no/such/folder")).rubrics).toEqual([
			{kind: "review-code", text: null},
			{kind: "review-doc", text: null},
		]);
	});

	it("reads no rubric for a kind this stage does not do", async () => {
		const files = JSON.stringify({files: [{filename: ".github/workflows/build.yaml"}]});
		const pack = await packOf("final", RUBRICS, {files});
		expect(pack.kinds).toEqual(["review-code", "governance"]);
		expect(pack.rubrics.map((rubric) => rubric.kind)).toEqual(["review-code"]);
	});

	it("fails as the read does when the pull request cannot be read", async () => {
		const read = readPack({pr: PR, head: HEADS.final, rubrics: RUBRICS}).pipe(
			Effect.provide(recordedHost(recordedGh("final", {change: "breaks"}).gh)),
		);
		expect((await Effect.runPromise(Effect.result(read)))._tag).toBe("Failure");
	});
});
