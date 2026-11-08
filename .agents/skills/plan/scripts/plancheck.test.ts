import {spawnSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import fc from "fast-check";
import {describe, expect, it} from "vitest";

// Today's tooling. Run each plant in a disposable copy of the script beside this test.
const script = join(import.meta.dirname, "plancheck.sh");
const options = {seed: 520, numRuns: 24};
const table = (heads: string[], rows: string[][]) =>
	[heads, heads.map(() => "---"), ...rows].map((row) => `| ${row.join(" | ")} |`).join("\n");
const laws = (cell: string) => table(["Law", "Generator", "Plant"], [["holds", cell, "break it"]]);
const check = (body: string, marker = "Plancheck-Version: 2") => {
	const folder = mkdtempSync(join(tmpdir(), "pc-"));
	try {
		const plan = join(folder, "plan.md");
		writeFileSync(plan, `Approved by the lead agent, builds ticket 520.\n\n${marker}\n\n${body}\n`);
		const ran = spawnSync("sh", [script, plan], {encoding: "utf8", timeout: 5_000});
		expect(ran.error).toBeUndefined();
		expect(ran.signal).toBeNull();
		return {code: ran.status, text: ran.stdout + ran.stderr};
	} finally {
		rmSync(folder, {recursive: true, force: true});
	}
};
const word = fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/);
const constructor = fc.constantFrom(
	"boolean",
	"integer",
	"nat",
	"bigInt",
	"float",
	"double",
	"string",
	"array",
	"uniqueArray",
	"tuple",
	"record",
	"oneof",
	"option",
	"constantFrom",
	"dictionary",
	"anything",
	"jsonValue",
	"uint8Array",
	"shuffledSubarray",
);
const allowed = fc.oneof(
	fc.constantFrom("lint", "type"),
	fc
		.tuple(constructor, fc.boolean(), word)
		.map(([name, described, why]) => `fc.${name}${described ? `: ${why}` : ""}`),
	fc
		.tuple(
			fc.constantFrom("arbMsg", "arbRecordMsg", "arbMsgSequence", "arbGuidedSequence"),
			fc.boolean(),
			word,
		)
		.map(([name, described, why]) => `@demlik/tea/pbt.${name}${described ? `: ${why}` : ""}`),
	fc.tuple(word, word).map(([a, b]) => `Effect Arbitrary: ${a}.${b}`),
	fc
		.tuple(fc.constantFrom("vector", "format", "pinned", "scenario"), word)
		.map(([label, why]) => `${label}: ${why}`),
);
const refused = fc.oneof(
	fc.constantFrom("example-based", "examples(3)", "TBD", "todo", "?", "hand-picked", "", "none"),
	word.map((name) => `fc.unknown_${name}`),
	constructor.map((name) => `some text fc.${name}`),
	constructor.map((name) => `fc.${name}()`),
	fc.constantFrom(
		"vector:",
		"format:  ",
		"pinned: !!!",
		"scenario: ?",
		"FC.string",
		"Effect Arbitrary: x + y",
		"@demlik/tea/pbt.unknown",
		"fc.string trailing text",
	),
);
const wrap = fc.constantFrom("", "`", "**", "_");
const cell = fc.oneof(
	allowed.map((text) => ({text, pass: true})),
	refused.map((text) => ({text, pass: false})),
);

describe("plancheck, today's tooling", () => {
	// Plant: accept an unknown constructor, or restore the old deny-list.
	it("permitted cells pass and other families fail", () => {
		fc.assert(
			fc.property(cell, wrap, ({text, pass}, around) => {
				const got = check(laws(` ${around}${text}${around} `));
				expect(got.code, `${text}\n${got.text}`).toBe(pass ? 0 : 1);
			}),
			{
				...options,
				// pinned: ticket 520's exact broken Generator cells.
				examples: [
					[{text: "example-based", pass: false}, ""],
					[{text: "examples(3)", pass: false}, ""],
					[{text: "TBD", pass: false}, ""],
				],
			},
		);
	});

	// Plant: split every pipe. Odd backslash runs keep a pipe inside a cell; even runs do not.
	it("escaped pipes preserve columns, empty cells and line numbers", () => {
		fc.assert(
			fc.property(
				fc.array(fc.tuple(word, fc.integer({min: 0, max: 3})), {minLength: 1, maxLength: 4}),
				fc.shuffledSubarray(["Law", "Generator", "Plant", "Note"], {minLength: 4, maxLength: 4}),
				fc.boolean(),
				(parts, heads, valid) => {
					const description = parts
						.map(([text, n]) => `${text}${"\\".repeat(n * 2 + 1)}|tail`)
						.join(" ");
					const row: Record<string, string> = {
						Law: description,
						Generator: valid ? "fc.array: Markdown cells" : "TBD",
						Plant: "split pipes",
						Note: "",
					};
					// Two backslashes leave a real column boundary, then an empty cell.
					const even =
						"| Law | Note | Generator | Plant |\n| --- | --- | --- | --- |\n| slash\\\\| | fc.string | break |";
					const body = `${table(heads, [heads.map((head) => row[head]!)])}\n\n\`\`\`md\n${laws("TBD")}\n\`\`\`\n\n${even}`;
					const got = check(body);
					expect(got.code, got.text).toBe(valid ? 0 : 1);
					if (!valid) expect(got.text).toContain("line 7:");
				},
			),
			{
				...options,
				// pinned: ticket 520's escaped \| cell must not move the Generator column.
				examples: [[[["left", 0]], ["Law", "Generator", "Plant", "Note"], false]],
			},
		);
	});

	// Plant: enforce generators on legacy plans, or skip version 2.
	it("only versioned plans get generator checks and bad markers stop", () => {
		fc.assert(
			fc.property(
				fc.record({
					marker: fc.constantFrom(
						"",
						"Plancheck-Version: 2",
						"Plancheck-Version: 1",
						"Plancheck-Version: TBD",
						"Plancheck-Version:",
						"Plancheck-Version: 2\nPlancheck-Version: 2",
					),
					cells: fc.array(cell, {minLength: 1, maxLength: 3}),
				}),
				({marker, cells}) => {
					const rows = cells.map((c) => ["holds", c.text, "break"]);
					if (!marker) rows.push(["legacy law", "none", "old law"]);
					const body = table(["Law", "Generator", "Plant"], rows);
					const got = check(body, marker);
					const pass =
						marker === "" || (marker === "Plancheck-Version: 2" && cells.every((c) => c.pass));
					expect(got.code, got.text).toBe(pass ? 0 : 1);
					expect(got.text.split("legacy plan: generator checks skipped").length - 1).toBe(
						marker === "" ? 1 : 0,
					);
				},
			),
			options,
		);
	});

	// Plant: classify every basename as root, or ignore a root files row.
	it("root exam paths retain owners without treating mentions as files", () => {
		fc.assert(
			fc.property(
				fc.record({
					path: fc.constantFrom(
						"package.json",
						"./package.json",
						"vitest.config.ts",
						"./exam-paths.json",
						"packages/pipeline/package.json",
						"packages/fabrika/package.json",
						"edit package.json after install",
						"README.md",
					),
					owner: fc.constantFrom("tests", "build", "lead", ""),
					mention: fc.constantFrom("package.json", "./package.json", "vitest.config.ts"),
				}),
				({path, owner, mention}) => {
					const root = [
						"package.json",
						"./package.json",
						"vitest.config.ts",
						"./exam-paths.json",
					].includes(path);
					const body = `A bare \`${mention}\` mention is prose.\n\n${table(["File", "Why", "Owner step"], [[`\`${path}\``, `mentions ${mention}`, owner]])}`;
					const got = check(body);
					expect(got.code, got.text).toBe(!owner || (root && owner !== "tests") ? 1 : 0);
					if (!root) expect(got.text).not.toContain(`exam path named: ${mention}\t`);
				},
			),
			{
				...options,
				// pinned: ticket 520's bare package.json mention is not a root files row.
				examples: [
					[{path: "packages/pipeline/package.json", owner: "build", mention: "package.json"}],
				],
			},
		);
	});

	// Plant: return early for legacy plans, skipping the owner check too.
	it("file-owner checks survive every plan version", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						path: fc.constantFrom(
							".github/workflows/check.yaml",
							"vitest.config.ts",
							"oxlint-plugins/laws.ts",
							"src/plain.ts",
						),
						owner: fc.constantFrom("tests", "build", ""),
					}),
					{minLength: 1, maxLength: 3},
				),
				(rows) => {
					const bad = rows.some(
						(r) => !r.owner || (r.path !== "src/plain.ts" && r.owner !== "tests"),
					);
					for (const marker of ["", "Plancheck-Version: 2"]) {
						const got = check(
							table(
								["Path", "Writer"],
								rows.map((r) => [r.path, r.owner]),
							),
							marker,
						);
						expect(got.code, got.text).toBe(bad ? 1 : 0);
						const missing = check(
							table(
								["File", "Lines"],
								rows.map((r) => [r.path, "12"]),
							),
							marker,
						);
						expect(missing.code, missing.text).toBe(1);
					}
				},
			),
			options,
		);
	});
});
