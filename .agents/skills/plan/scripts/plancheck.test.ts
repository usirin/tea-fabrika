import {spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
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

	// Plant: classify every basename as root, or ignore a root files row. Amendment A8: a sentence in a
	// path cell that names a root exam file counts; the same words in prose or another column do not.
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
						"edit package.json after install",
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
					// pinned: ticket 520 amendment A8, a sentence in a path cell that names a root exam file
					// counts. ebb2cca5 read it as prose and passed this build-owned row.
					[{path: "edit package.json after install", owner: "build", mention: "package.json"}],
				],
			},
		);
	});

	// Plant: split a path cell on commas only, as the build did after bfd35fb0; drop a several-word item
	// with a bare non-exam name as a sentence, as ebb2cca5 does; ignore the possessive qualifier; keep
	// the punctuation around a word, or let any possessive trigger the exception, as d1686a3b does.
	// Amendment A8: every exam path in a path cell counts, whatever words surround it, unless the cell
	// names another package with a possessive (`<name>'s`); then only qualified paths (with a "/") count.
	// Amendment A9: punctuation around a word is stripped first, and a possessive of a word meaning this
	// repository does not trigger the exception.
	it("every exam path in a path cell counts unless a possessive names another package", () => {
		// Extensionless exam paths come from the exam list itself: every glob with no "." and no "/".
		const globs = (
			JSON.parse(
				readFileSync(join(import.meta.dirname, "../../../../exam-paths.json"), "utf8"),
			) as {
				glob: string;
			}[]
		).map((row) => row.glob);
		const bare = globs.filter((glob) => !/[./]/.test(glob));
		expect(bare).toContain("allowed_signers");
		const exam = [
			"package.json",
			"vitest.config.ts",
			"exam-paths.json",
			".github/workflows/check.yaml",
			"oxlint-plugins/laws.ts",
			...bare,
		];
		const plainPaths = [
			"src/plain.ts",
			"README.md",
			"tsconfig.json",
			"packages/pipeline/package.json",
			"Makefile",
			"LICENSE",
		];
		// Generated plain words cannot be an exam path: no ".", "/", "_" or "'".
		const term = fc.oneof(fc.constantFrom(...exam, ...plainPaths), word);
		// A9's punctuation, each kind put around one word.
		const wraps = {
			none: (w: string) => w,
			backticks: (w: string) => `\`${w}\``,
			brackets: (w: string) => `[${w}]`,
			parentheses: (w: string) => `(${w})`,
			doubleQuotes: (w: string) => `"${w}"`,
			singleQuotes: (w: string) => `'${w}'`,
			comma: (w: string) => `${w},`,
			semicolon: (w: string) => `${w};`,
			colon: (w: string) => `${w}:`,
			period: (w: string) => `${w}.`,
		};
		type Wrap = keyof typeof wraps;
		const wrap = fc.constantFrom(...(Object.keys(wraps) as Wrap[]));
		// Any letter case, as a plan writer might type it.
		const anyCase = (base: fc.Arbitrary<string>) =>
			fc
				.tuple(base, fc.array(fc.boolean(), {minLength: 12, maxLength: 12}))
				.map(([w, ups]) =>
					[...w].map((c, i) => (ups[i] ? c.toUpperCase() : c.toLowerCase())).join(""),
				);
		const thisRepo = [
			"repository",
			"repo",
			"root",
			"project",
			"workspace",
			"monorepo",
			"top-level",
		];
		const ownerName = fc.oneof(
			anyCase(fc.constantFrom("Counter", "Libfabrika", "pipeline")),
			anyCase(word.filter((w) => !thisRepo.includes(w))),
		);
		fc.assert(
			fc.property(
				fc.record({
					picked: fc.uniqueArray(fc.record({path: term, wrap}), {
						minLength: 1,
						maxLength: 5,
						selector: (entry) => entry.path,
					}),
					separators: fc.array(
						fc.constantFrom(", ", ",", "; ", ";", " and ", " ", ", and ", "<br>", " for the "),
						{minLength: 4, maxLength: 4},
					),
					owner: fc.constantFrom("tests", "build", "lead", "mutation"),
					// A possessive put before one of the words: another package's, as in "Counter's
					// package.json", or this repository's, as in "the repository's package.json".
					possessive: fc.option(
						fc.oneof(
							fc.record({repo: fc.constant(false), name: ownerName, at: fc.nat({max: 4})}),
							fc.record({
								repo: fc.constant(true),
								name: anyCase(fc.constantFrom(...thisRepo)),
								at: fc.nat({max: 4}),
							}),
						),
						{nil: undefined},
					),
					why: fc.constantFrom(
						"the fix",
						"edit package.json",
						"`vitest.config.ts` and allowed_signers",
					),
				}),
				({picked, separators, owner, possessive, why}) => {
					const words = picked.map(({path, wrap}) => wraps[wrap](path));
					if (possessive) {
						const at = possessive.at % words.length;
						words[at] = `${possessive.name}'s ${words[at]}`;
					}
					const other = possessive !== undefined && !possessive.repo;
					const cell = words.reduce((joined, p, i) => `${joined}${separators[i - 1]}${p}`);
					const counted = picked
						.map((e) => e.path)
						.filter((p) => exam.includes(p) && (!other || p.includes("/")));
					const wrong = owner !== "tests";
					const line = (p: string) => `${p} is an exam path owned by ${owner}, not tests`;
					const ran = check(table(["File", "Why", "Owner step"], [[cell, why, owner]]));
					expect(ran.code, `${cell}\n${ran.text}`).toBe(wrong && counted.length > 0 ? 1 : 0);
					for (const {path} of picked) {
						expect(ran.text.includes(line(path)), `${path} in ${cell}\n${ran.text}`).toBe(
							wrong && counted.includes(path),
						);
					}
				},
			),
			{
				...options,
				examples: [
					// pinned: ticket 520 review round 4, semicolon-separated paths in a path cell. The old
					// script (bfd35fb0) refused this build-owned cell; the comma-only split passed it.
					[
						{
							picked: [
								{path: "package.json", wrap: "backticks"},
								{path: "vitest.config.ts", wrap: "backticks"},
							],
							separators: ["; ", "; ", "; ", "; "],
							owner: "build",
							possessive: undefined,
							why: "the fix",
						},
					],
					// pinned: ticket 520 review round 2 of the build, an extensionless exam path in an "and"
					// list. Main refused `allowed_signers` and `package.json` owned by build; 7010d22a passed it.
					[
						{
							picked: [
								{path: "allowed_signers", wrap: "backticks"},
								{path: "package.json", wrap: "backticks"},
							],
							separators: [" and ", " and ", " and ", " and "],
							owner: "build",
							possessive: undefined,
							why: "the fix",
						},
					],
					// pinned: ticket 520 review round 3, `Makefile and package.json` owned by build passed
					// at ebb2cca5 because the bare Makefile made the item read as a sentence.
					[
						{
							picked: [
								{path: "Makefile", wrap: "none"},
								{path: "package.json", wrap: "none"},
							],
							separators: [" and ", " and ", " and ", " and "],
							owner: "build",
							possessive: undefined,
							why: "build",
						},
					],
					// pinned: ticket 520 review round 4, punctuation hid an exam path. `Makefile and
					// (package.json)` owned by build passed at d1686a3b (amendment A9).
					[
						{
							picked: [
								{path: "Makefile", wrap: "none"},
								{path: "package.json", wrap: "parentheses"},
							],
							separators: [" and ", " and ", " and ", " and "],
							owner: "build",
							possessive: undefined,
							why: "the fix",
						},
					],
					// pinned: ticket 520 review round 4, any possessive triggered the other-package exception.
					// `the repository's package.json` owned by build passed at d1686a3b (amendment A9).
					[
						{
							picked: [
								{path: "the", wrap: "none"},
								{path: "package.json", wrap: "none"},
							],
							separators: [" ", " ", " ", " "],
							owner: "build",
							possessive: {repo: true, name: "repository", at: 1},
							why: "the fix",
						},
					],
				],
			},
		);
	});

	// pinned: ticket 520. Review round 3's cell must fail; the original false alarm, two rows from an
	// old plan whose package.json is another package's own, must pass (amendment A8).
	it("pinned: ticket 520's real path cells", () => {
		const head = "| File | Why | Lines | Owner step |\n| --- | --- | --- | --- |";
		const makefile = check(
			"| File | Lines | Owner step |\n| --- | --- | --- |\n| Makefile and package.json | 20 | build |",
		);
		expect(makefile.code, makefile.text).toBe(1);
		expect(makefile.text).toContain("package.json is an exam path owned by build, not tests");
		const old = check(
			[
				head,
				"| Counter's `src/program.ts`, `tsconfig.json`, `package.json` | Complete pure counter package | 100 | build |",
				"| Libfabrika's `package.json`, `pnpm-lock.yaml` | `.` and `./testing`, tea dependency | 20 | build |",
			].join("\n"),
		);
		expect(old.code, old.text).toBe(0);
		expect(old.text).not.toContain("is an exam path owned by");
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
