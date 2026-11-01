import {readdirSync, readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {reader} from "@kampus/fabrika-old/agents/claude";
import {Option, type Schema} from "effect";
import {describe, expect, it} from "vitest";
import {DraftProperty} from "../plan/plan.ts";
import {Form} from "../review/sheet.ts";
import {RULE_FILES} from "../rules.ts";
import {Written} from "../test-writer/written.ts";
import {fenced, fill, hashOfBrief, parseBrief} from "./briefs.ts";

// Today's version. The step briefs as they are on disk, and the small parts that fill them.

const FOLDER = fileURLToPath(new URL("../../../../../programs/pipeline/briefs/", import.meta.url));
const FILES = readdirSync(FOLDER).filter((file) => file.endsWith(".md"));

describe("the step briefs on disk", () => {
	it("one file for each step that runs an agent", () => {
		expect([...FILES].sort()).toEqual([
			"build.md",
			"exam.md",
			"plan.md",
			"review.md",
			"test-writer-mutants.md",
			"test-writer.md",
			"triage.md",
		]);
	});

	it.each(FILES)("%s declares every slot its text uses", (file) => {
		const brief = parseBrief(file, readFileSync(`${FOLDER}${file}`, "utf8"));
		expect(brief.body.length).toBeGreaterThan(0);
		for (const [, slot] of brief.body.matchAll(/\{([a-z_]+)\}/g))
			expect(brief.slots).toContain(slot);
	});

	it("a slot is used, but for a note, which comes back as a turn of its own", () => {
		const unused = FILES.flatMap((file) => {
			const brief = parseBrief(file, readFileSync(`${FOLDER}${file}`, "utf8"));
			return brief.slots.flatMap((slot) =>
				slot === "note" || brief.body.includes(`{${slot}}`) ? [] : [`${file}: ${slot}`],
			);
		});
		expect(unused).toEqual([]);
	});
});

// Today's version. What a brief tells its agent, and what code does with the answer, say one thing.
describe("a brief says what is so", () => {
	const brief = (file: string) => readFileSync(`${FOLDER}${file}`, "utf8");

	// P12
	it("plan.md says what a story's `from` is: a ticket id, or null", () => {
		const lines = brief("plan.md")
			.split("\n")
			.filter((line) => line.includes("`from`"));
		expect(lines.filter((line) => /#\d/.test(line) && /null/.test(line))).not.toEqual([]);
	});

	// P14
	it.each([
		"plan.md",
		"build.md",
		"review.md",
		"test-writer.md",
		"test-writer-mutants.md",
		"exam.md",
	])("%s says its box has no network", (file) => {
		expect(brief(file)).toMatch(/box has no network/i);
	});

	// P17
	it("test-writer.md counts a test that cannot import a new file yet as a red, as `resultsOf` does", () => {
		const text = brief("test-writer.md");
		expect(text).not.toMatch(/a missing import or a setup error is not that/i);
		expect(text).toMatch(/plain import/i);
		// A typo stays no red.
		expect(text).toMatch(/typo/i);
	});
});

describe("what a brief offers, its schema takes", () => {
	const brief = (file: string) => readFileSync(`${FOLDER}${file}`, "utf8");
	const fitsForm = (form: unknown) => Option.isSome(reader(Form)(form));

	// P21
	it("review.md offers a finding's mark against a decision, and the form takes it only with the question's id", () => {
		const finding = (from: unknown) => ({
			rows: [],
			findings: [
				{
					kind: "review-code",
					from,
					fault: "It loses a letter.",
					at: null,
					proof: "Read from the code.",
					wants: "The letter stays.",
					seen: "read",
				},
			],
			skipped: [],
			gaps: [],
		});
		expect(brief("review.md")).toMatch(/`source: "decision"`/);
		expect(fitsForm(finding({source: "decision", id: "q1"}))).toBe(true);
		expect(fitsForm(finding({source: "decision"}))).toBe(false);
	});

	// P20
	it.each(["review.md", "test-writer.md", "test-writer-mutants.md"])(
		"%s has a `decided` slot, in its text",
		(file) => {
			const read = parseBrief(file, brief(file));
			expect(read.slots).toContain("decided");
			expect(read.body).toContain("{decided}");
		},
	);

	// P20
	it("review.md says a decision is not a finding, and where a disagreement goes", () => {
		expect(brief("review.md")).toMatch(/not a finding/i);
	});

	it("plan.md offers only a `tool` and a `behavior` a Property can hold", () => {
		const plan = brief("plan.md");
		const offered = (pattern: RegExp) =>
			[...plan.matchAll(pattern)].flatMap(([line = ""]) =>
				[...line.matchAll(/"(\w+)"/g)].map(([, word = ""]) => word),
			);
		const tools = offered(/^- `tool`:.*$/gm);
		const behaviors = offered(/^- `behavior: "\w+"`/gm);
		expect(tools).toContain("test");
		expect(behaviors).toEqual(["new", "existing"]);
		const takes = (schema: Schema.Codec<string, unknown>) => (word: string) =>
			Option.isSome(reader(schema)(word));
		expect(tools.filter((word) => !takes(DraftProperty.fields.tool)(word))).toEqual([]);
		expect(behaviors.filter((word) => !takes(DraftProperty.fields.behavior)(word))).toEqual([]);
	});

	it("test-writer.md asks for `plants` in the shape its schema reads", () => {
		const asksForRows = /^- `plants`:.*`name`.*law/m.test(brief("test-writer.md"));
		const rows = reader(Written)({
			files: [],
			answers: [],
			plants: [{name: "a plant's test", law: "the law it must break"}],
			gaps: [],
		});
		expect(asksForRows && Option.isNone(rows)).toBe(false);
	});

	it("review.md says which rule file a finding may name and that a pass row holds a `limit`, or the form takes them", () => {
		const finding = (file: string) => ({
			rows: [],
			findings: [
				{
					kind: "review-code",
					from: {source: "rule", file, rule: "a rule"},
					fault: "It breaks a rule.",
					at: null,
					proof: "Read from the code.",
					wants: "It keeps the rule.",
					seen: "read",
				},
			],
			skipped: [],
			gaps: [],
		});
		expect(fitsForm(finding("AGENTS.md"))).toBe(true);
		const toldFiles = RULE_FILES.every((file) => brief("review.md").includes(file));
		expect(fitsForm(finding("docs/rules.md")) || toldFiles).toBe(true);

		const row = {id: "c1", grade: "pass", where: [], says: "It holds."};
		const form = (rows: readonly unknown[]) => ({rows, findings: [], skipped: [], gaps: []});
		expect(fitsForm(form([{...row, limit: null}]))).toBe(true);
		const toldLimit = /`limit`: null/.test(brief("review.md"));
		expect(fitsForm(form([row])) || toldLimit).toBe(true);
	});
});

// Each of these agents runs in a box that refuses a write to its folder (`access: "read"`, agents.ts).
describe("a brief asks only what its box allows", () => {
	const brief = (file: string) => readFileSync(`${FOLDER}${file}`, "utf8");

	it("review.md does not tell a reviewer to break a line and put it back", () => {
		expect(brief("review.md")).not.toMatch(/break a line/i);
	});

	it.each(["test-writer.md", "test-writer-mutants.md"])(
		"%s says its folder is read-only, so its new tests cannot be run there",
		(file) => {
			expect(brief(file)).toMatch(/read-only/i);
		},
	);
});

describe("a brief's parts", () => {
	const TEXT =
		"---\nstep: plan\nslots:\n  ticket: its text\n  rules: the rules\n---\nDo {ticket} by {rules}. {other}\n";

	it("reads the slots and the body, and hashes the whole file", () => {
		const brief = parseBrief("plan.md", TEXT);
		expect(brief.slots).toEqual(["ticket", "rules"]);
		expect(brief.body).toBe("Do {ticket} by {rules}. {other}");
		expect(brief.hash).toBe(hashOfBrief(TEXT));
		expect(brief.hash).not.toBe(hashOfBrief(`${TEXT} `));
	});

	it("a value is never read as a slot, a missing one says so, and other braces stay", () => {
		const brief = parseBrief("plan.md", TEXT);
		expect(fill(brief, {ticket: "{rules}"})).toBe("Do {rules} by (none). {other}");
	});

	it("a fence outlasts the backticks inside it, so a ticket's text cannot close it", () => {
		expect(fenced("a ``` b", "text")).toBe("````text\na ``` b\n````");
	});
});
