import "./plancheck.sh?raw";
import "../../lead/scripts/leakgrep.sh?raw";
import "../../step-commit/scripts/exam.py?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
import "../../lead/scripts/box.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../lead/scripts/drive.ts?raw";
import "../../lead/scripts/fieldrow.py?raw";
import "../../lead/scripts/runplan.sh?raw";
import "../../lead/scripts/env.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../lead/scripts/gc.ts?raw";
import "../../lead/scripts/redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../lead/scripts/botpush.mjs?raw";
import "../../lead/scripts/clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../lead/scripts/lane.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../../../exam-paths.json?raw";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
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
		const words = join(folder, "words");
		writeFileSync(words, "private_generated\n");
		const ran = spawnSync("sh", [script, plan], {
			encoding: "utf8",
			timeout: 5_000,
			env: {...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined},
		});
		expect(ran.error).toBeUndefined();
		expect(ran.signal).toBeNull();
		return {code: ran.status, text: ran.stdout + ran.stderr};
	} finally {
		rmSync(folder, {recursive: true, force: true});
	}
};

const word = fc.stringMatching(/^[a-z][a-z0-9]{0,8}$/);

const handoff = (text: string, draft = false) => {
	const folder = mkdtempSync(join(tmpdir(), "pc-300-"));
	try {
		const plan = join(folder, "plan.md");
		writeFileSync(plan, text);
		const words = join(folder, "words");
		writeFileSync(words, "private_generated\n");
		const ran = spawnSync("sh", [script, ...(draft ? ["--draft"] : []), plan], {
			encoding: "utf8",
			timeout: 5_000,
			env: {...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined},
		});
		expect(ran.error).toBeUndefined();
		expect(ran.signal).toBeNull();
		return {code: ran.status, text: ran.stdout + ran.stderr};
	} finally {
		rmSync(folder, {recursive: true, force: true});
	}
};

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
	// Plants: accept a filled slot; accept a displaced marker. Fenced approvals are examples.
	it("T300 draft handoffs reserve line one and put the marker on line two", () => {
		fc.assert(
			fc.property(
				fc.record({
					first: fc.constantFrom("", "Approved by the lead agent, builds ticket 300.", "# Plan"),
					position: fc.integer({min: 0, max: 3}),
					approval: fc.boolean(),
					fenced: fc.boolean(),
					fence: fc.constantFrom("```md", "~~~md"),
				}),
				({first, position, approval, fenced, fence}) => {
					const lines = [first, "", "", ""];
					lines[position] = "Plancheck-Version: 2";
					const example = "Approved by the lead agent, builds a different plan.";
					const body = complete(
						`${approval ? (fenced ? `${fence}\n${example}\n${fence.slice(0, 3)}` : example) : ""}\n`,
					);
					const got = handoff(`${lines.join("\n")}\n${body}`, true);
					const pass = first === "" && position === 1 && (!approval || fenced);
					expect(got.code, got.text).toBe(pass ? 0 : 1);
				},
			),
			{
				...options,
				seed: 300,
				examples: [
					[{first: "", position: 1, approval: false, fenced: false, fence: "```md"}],
					[
						{
							first: "Approved by the lead agent, builds ticket 300.",
							position: 1,
							approval: false,
							fenced: false,
							fence: "```md",
						},
					],
					[{first: "", position: 2, approval: false, fenced: false, fence: "```md"}],
					[{first: "", position: 1, approval: true, fenced: false, fence: "```md"}],
					[{first: "", position: 1, approval: true, fenced: true, fence: "~~~md"}],
				],
			},
		);
	});

	// Plants: apply draft restrictions in normal mode; skip owners on legacy plans.
	it("T300 saved approved, draft and legacy plans keep their normal checks", () => {
		fc.assert(
			fc.property(
				fc.record({
					first: fc.constantFrom("", "Approved by the lead agent, builds ticket 300."),
					legacy: fc.boolean(),
					valid: fc.boolean(),
					owner: fc.constantFrom("tests", "build", ""),
				}),
				({first, legacy, valid, owner}) => {
					const text = `${first}\n${legacy ? "" : "Plancheck-Version: 2"}\n${laws(valid ? "fc.record" : "TBD")}\n\n${table(["File", "Owner step"], [["package.json", owner]])}\n`;
					const got = handoff(text);
					expect(got.code, got.text).toBe(owner === "tests" && (legacy || valid) ? 0 : 1);
				},
			),
			{...options, seed: 300},
		);
	});

	// Plant: accept a marked scenario-only row. Keep the parent's generator grammar intact.
	it("T300 secrets markers require a generated family in the same row", () => {
		fc.assert(
			fc.property(
				fc.record({
					marked: fc.boolean(),
					heads: fc.shuffledSubarray(["Law", "Generator", "Plant"], {minLength: 3, maxLength: 3}),
					generated: fc.constantFrom(
						"fc.record: flows",
						"fc.array: operations",
						"@demlik/tea/pbt.arbMsgSequence",
						"Effect Arbitrary: Flow",
					),
					label: fc.constantFrom("vector", "format", "pinned", "scenario"),
				}),
				({marked, heads, generated, label}) => {
					for (const [generator, family] of [
						[generated, true],
						[`${label}: outside run`, false],
						["lint", false],
						["type", false],
					] as const) {
						const row: Record<string, string> = {
							Law: `${marked ? "[secrets] " : ""}records hide passes`,
							Generator: generator,
							Plant: "write the pass",
						};
						const body = `${table(heads, [heads.map((h) => row[h]!)])}\n\n${laws("scenario: supplemental outside run")}`;
						const got = handoff(`\nPlancheck-Version: 2\n${body}\n`);
						expect(got.code, got.text).toBe(!marked || family ? 0 : 1);
					}
				},
			),
			{
				...options,
				seed: 300,
				examples: [
					[
						{
							marked: true,
							heads: ["Law", "Generator", "Plant"],
							generated: "fc.record: flows",
							label: "scenario",
						},
					],
				],
			},
		);
	});

	// Plant: mistake keyboard keys or leak detectors for an explicit secrets marker.
	it("T300 unmarked keyboard and leak-detector laws keep the ordinary grammar", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.tuple(
						fc.constantFrom(
							"keyboard key works",
							"key bindings",
							"leak detector reports",
							"ordinary law",
						),
						allowed,
					),
					{minLength: 1, maxLength: 4},
				),
				(rows) => {
					const got = handoff(
						`\nPlancheck-Version: 2\n${table(
							["Law", "Generator", "Plant"],
							rows.map(([law, generator]) => [law, generator, "break"]),
						)}\n`,
					);
					expect(got.code, got.text).toBe(0);
				},
			),
			{...options, seed: 300, examples: [[[["keyboard key works", "scenario: keyboard run"]]]]},
		);
	});
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
					// Amendment A9 lists every exam path named anywhere, so a prose mention is listed; it still
					// never decides the exit code. The listing law below covers it.
					expect(got.code, got.text).toBe(!owner || (root && owner !== "tests") ? 1 : 0);
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

	// Plant: list only backticked spans, as bb7d5a09 does; skip fenced blocks; read a link with a title
	// as one word; or keep `./` or a trailing period on a word.
	// Amendment A10: the listing reads no Markdown. It splits the whole file, fences and link titles
	// included, on whitespace and on punctuation that cannot sit in a repo path, so an exam path is
	// listed wherever it stands and whatever wraps it. A false listing is harmless; a miss is the defect.
	// Amendment A12 replaces A10's list: split on every character outside `A-Z a-z 0-9 . _ / -`, then
	// strip a leading `./`, leading `_`/`-` and trailing `_`/`-`/`.`; a leading `.` stays for dotfiles,
	// and a word also matches with its leading dots removed. Plant: split on a named list of marks, as
	// f9f57901 does, or strip a dotfile's leading `.`.
	it("every exam path anywhere in the plan is listed, in any context and any wrapping", () => {
		const globs = (
			JSON.parse(
				readFileSync(join(import.meta.dirname, "../../../../exam-paths.json"), "utf8"),
			) as {glob: string}[]
		).map((row) => row.glob);
		const literal = globs.filter((glob) => !glob.includes("*"));
		const starred = globs.filter((glob) => glob.includes("*"));
		expect(literal).toContain("package.json");
		expect(starred).toContain("next/apps/fabrika/src/exam/**");
		// A path under a glob: "**" becomes one or more segments, each "*" one word.
		const segments = fc.array(word, {minLength: 1, maxLength: 3}).map((w) => w.join("/"));
		const under = fc
			.tuple(fc.constantFrom(...starred), segments, fc.array(word, {minLength: 2, maxLength: 2}))
			.map(([glob, deep, [a, b]]) => glob.replaceAll("**", deep).replace("*", a!).replace("*", b!));
		// Dotfile exam paths, so a leading `.` must survive the stripping (A12).
		const dotfile = fc.oneof(
			fc.constantFrom(".oxlintrc.json", ".oxfmtrc.json"),
			word.map((w) => `.github/${w}.yaml`),
		);
		const examPath = fc.oneof(fc.constantFrom(...literal), under, dotfile);
		// Amendment A12: the wrapping is any character outside the path alphabet `A-Z a-z 0-9 . _ / -`,
		// drawn from all of Unicode, so no named mark is special. A few marks are weighted in.
		const pathChar = /^[A-Za-z0-9._/-]$/;
		const codePoint = (min: number, max: number) =>
			fc
				.integer({min, max})
				.filter((c) => c < 0xd800 || c > 0xdfff)
				.map((c) => String.fromCodePoint(c))
				.filter((c) => !pathChar.test(c));
		const outside = fc.oneof(
			fc.constantFrom("“", "”", "‘", "’", "~", "!", "#", "`", "<", ">", "|", " ", " ", "😀"),
			codePoint(0, 0x7f),
			codePoint(0x80, 0x10ffff),
		);
		const marks = fc.string({unit: outside, maxLength: 4});
		// Runs A12 strips from a word: leading `_` and `-`, trailing `_`, `-` and `.`.
		const leadRun = fc.string({unit: fc.constantFrom("_", "-"), maxLength: 3});
		const trailRun = fc.string({unit: fc.constantFrom("_", "-", "."), maxLength: 3});
		// How the wrapped word stands: a link's text, target or title, emphasis, an HTML comment.
		const forms = {
			plain: (t: string) => t,
			linkText: (t: string) => `[${t}](README.md)`,
			linkTarget: (t: string) => `[see](${t})`,
			linkAngle: (t: string) => `[see](<${t}>)`,
			linkTitle: (t: string) => `[see](README.md "${t}")`,
			linkTitleSingle: (t: string) => `[see](README.md '${t}')`,
			linkSelfTitle: (t: string, p: string) => `[${t}](${p} "manifest")`,
			emphasis: (t: string) => `*${t}*`,
			strong: (t: string) => `**${t}**`,
			// Amendment A11: a word's leading and trailing `_` are stripped; an inner `_` stays.
			underscore: (t: string) => `_${t}_`,
			doubleUnderscore: (t: string) => `__${t}__`,
			comment: (t: string) => `<!-- ${t} -->`,
		};
		type Form = keyof typeof forms;
		const fileTable = (cells: string[]) => table(["File", "Why", "Owner step"], [cells]);
		const place = {
			prose: (t: string) => `Before the build, ${t} changes once.`,
			bullet: (t: string) => `- ${t} keeps its owner.`,
			heading: (t: string) => `## Why ${t}`,
			fileCell: (t: string) => fileTable([t, "the fix", "build"]),
			whyCell: (t: string) => fileTable(["`src/plain.ts`", `touches ${t}`, "build"]),
			ownerCell: (t: string) => fileTable(["`src/plain.ts`", "the fix", `build, after ${t}`]),
			lawCell: (t: string) =>
				table(["Law", "Generator", "Plant"], [[`holds for ${t}`, "fc.string", "break it"]]),
			otherCell: (t: string) => table(["Law", "Note"], [["holds", `see ${t}`]]),
			fence: (t: string, lang: string) => `\`\`\`${lang}\ncat ${t}\n\`\`\``,
			tildeFence: (t: string, lang: string) => `~~~${lang}\n  "glob": ${t}\n~~~`,
		};
		type Place = keyof typeof place;
		// A pinned case's defaults: no wrapping at all.
		const bare = {
			ticks: false,
			dot: false,
			before: "",
			lead: "",
			dots: 0,
			trail: "",
			after: "",
			lang: "",
		};
		fc.assert(
			fc.property(
				fc.record({
					path: examPath,
					ticks: fc.boolean(),
					dot: fc.boolean(),
					before: marks,
					lead: leadRun,
					dots: fc.nat({max: 2}),
					trail: trailRun,
					after: marks,
					form: fc.constantFrom(...(Object.keys(forms) as Form[])),
					where: fc.constantFrom(...(Object.keys(place) as Place[])),
					lang: fc.oneof(fc.constantFrom("", "md", "sh", "json", "ts", "text"), word),
				}),
				({path, ticks, dot, before, lead, dots, trail, after, form, where, lang}) => {
					const tick = ticks ? "`" : "";
					// A `./` prefix, or a stripped run: leading `_`/`-`, then leading dots on a path that is
					// not a dotfile (A12 matches a word with its leading dots removed).
					const head = dot ? "./" : `${lead}${path.startsWith(".") ? "" : ".".repeat(dots)}`;
					const token = `${before}${tick}${head}${path}${trail}${tick}${after}`;
					const body = place[where](forms[form](token, path), lang);
					const got = check(body);
					expect(got.text, `${body}\n${got.text}`).toContain(`exam path named: ${path}\t`);
				},
			),
			{
				...options,
				numRuns: 96,
				examples: [
					// pinned: ticket 520 review round 6, a link title. The build-owned cell
					// [package.json](package.json "manifest") was missed by both checks at bb7d5a09.
					[{...bare, path: "package.json", form: "linkSelfTitle", where: "fileCell"}],
					// pinned: ticket 520 review round 6, a fenced block holding package.json was never
					// listed at bb7d5a09.
					[{...bare, path: "package.json", form: "plain", where: "fence", lang: "sh"}],
					// pinned: ticket 520 amendment A11, underscore emphasis around a path with an inner
					// underscore. _allowed_signers_ was not listed at bb7d5a09.
					[{...bare, path: "allowed_signers", form: "underscore", where: "prose"}],
					// pinned: ticket 520 review round 5, [`package.json`](package.json) in a build-owned
					// cell printed "no exam paths named" at 2e25c4e7.
					[
						{
							...bare,
							path: "package.json",
							ticks: true,
							before: "[",
							after: "](package.json)",
							form: "plain",
							where: "fileCell",
						},
					],
					// pinned: ticket 520 review round 7, three cells that printed "no exam paths named" at
					// f9f57901: ~~package.json~~, “package.json” and <!--package.json-->.
					[
						{
							...bare,
							path: "package.json",
							before: "~~",
							after: "~~",
							form: "plain",
							where: "fileCell",
						},
					],
					[
						{
							...bare,
							path: "package.json",
							before: "“",
							after: "”",
							form: "plain",
							where: "fileCell",
						},
					],
					[
						{
							...bare,
							path: "package.json",
							before: "<!",
							lead: "--",
							trail: "--",
							after: ">",
							form: "plain",
							where: "fileCell",
						},
					],
				],
			},
		);
	});

	// Plant: split a path cell on commas only, as the build did after bfd35fb0; drop a several-word item
	// with a bare non-exam name as a sentence, as ebb2cca5 does; ignore the possessive qualifier; keep
	// the punctuation around a word, or let any possessive trigger the exception, as d1686a3b does; read a
	// Markdown link as one word, as 2e25c4e7 does.
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
			// Markdown links, review round 5: the path in the link's text, its target, or both.
			linkCode: (w: string) => `[\`${w}\`](${w})`,
			linkSelf: (w: string) => `[${w}](${w})`,
			linkText: (w: string) => `[text](${w})`,
			linkDot: (w: string) => `[\`${w}\`](./${w})`,
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
					// pinned: ticket 520 review round 5, a Markdown link hid an exam path. The build-owned
					// cell [`package.json`](package.json) printed "no exam paths named" at 2e25c4e7.
					[
						{
							picked: [{path: "package.json", wrap: "linkCode"}],
							separators: [" ", " ", " ", " "],
							owner: "build",
							possessive: undefined,
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
		// Review round 5's cell: at 2e25c4e7 it printed "no exam paths named" and exited 0.
		const link = check(
			"| File | Lines | Owner step |\n| --- | --- | --- |\n| [`package.json`](package.json) | 20 | build |",
		);
		expect(link.code, link.text).toBe(1);
		expect(link.text).toContain("exam path named: package.json\t");
		expect(link.text).toContain("package.json is an exam path owned by build, not tests");
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

// T321 keeps normal saved-plan reads above. New structure checks run at the approval boundary.
const digest = (body: string) => createHash("sha256").update(Buffer.from(body)).digest("hex");

const complete = (extra = "") =>
	[
		"# Today's tooling",
		"",
		"```text",
		"plan -> check -> approve",
		"```",
		"",
		"## Laws",
		laws("fc.record: generated inputs"),
		"",
		"## Files",
		table(["File", "Owner step"], [["src/plain.ts", "build"]]),
		"",
		"## Size",
		"Size: 1 agent hour, 80 lines. Confidence: 85%.",
		"",
		"## What it records",
		"Approval digests and run IDs.",
		"",
		"## What it cannot tell us",
		"No live run was tried.",
		"",
		"## Open questions",
		"None.",
		extra,
	].join("\n");

const approved = (body: string, note = "the decided note") =>
	`Approved by the lead agent, builds ${note}; body ${digest(body).slice(0, 12)}\nPlancheck-Version: 2\n${body}`;

const modeCheck = (text: string, mode: "--draft" | "--approved") => {
	const folder = mkdtempSync(join(tmpdir(), "pc-321-"));
	try {
		const path = join(folder, "plan.md");
		writeFileSync(path, Buffer.from(text));
		const words = join(folder, "words");
		writeFileSync(words, "private_generated\n");
		const ran = spawnSync("sh", [script, mode, path], {
			encoding: "utf8",
			timeout: 5_000,
			env: {...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined},
		});
		expect(ran.error).toBeUndefined();
		expect(ran.signal).toBeNull();
		return {code: ran.status, text: ran.stdout + ran.stderr};
	} finally {
		rmSync(folder, {recursive: true, force: true});
	}
};

describe("T321 K11 sections and K2 approval, today's tooling", () => {
	// Plant: count required content inside fences. Each deletion is tried alone.
	it("K11 requires each section outside fences and a whole opening code block", () => {
		fc.assert(
			fc.property(word, fc.constantFrom("```", "~~~"), (title, fence) => {
				const body = complete(`\n${title}\n`);
				const good = modeCheck(`\nPlancheck-Version: 2\n${body}`, "--draft");
				expect(good.code, good.text).toBe(0);
				for (const part of [
					"```text\nplan -> check -> approve\n```\n",
					`## Laws\n${laws("fc.record: generated inputs")}\n`,
					`## Files\n${table(["File", "Owner step"], [["src/plain.ts", "build"]])}\n`,
					"Size: 1 agent hour, 80 lines. Confidence: 85%.",
					"## What it records\nApproval digests and run IDs.\n",
					"## What it cannot tell us\nNo live run was tried.\n",
					"## Open questions\nNone.",
				]) {
					const without = body.replace(part, "");
					expect(without).not.toBe(body);
					const decoy = part.startsWith("```")
						? "## Example\n```text\nlate opening block\n```"
						: `${fence}md\n${part}\n${fence}`;
					const bad = modeCheck(`\nPlancheck-Version: 2\n${without}\n${decoy}\n`, "--draft");
					expect(bad.code, `${part}\n${bad.text}`).toBe(1);
					expect(bad.text).not.toMatch(/usage:|Traceback|cannot read installed/);
				}
			}),
			{seed: 321, numRuns: 3},
		);
	});

	// Plant: accept one lean for several open questions, or a size with no percent.
	it("K11 checks each question's lean and percent, and the size confidence", () => {
		fc.assert(
			fc.property(fc.integer({min: 1, max: 99}), word, (percent, text) => {
				for (const questions of [
					"None.",
					`1. ${text}? Lean yes, ${percent}%.`,
					`1. ${text}? Lean yes, ${percent}%.\n2. Another? Lean no, ${percent}%.`,
				]) {
					const body = complete().replace("None.", questions);
					const good = modeCheck(`\nPlancheck-Version: 2\n${body}`, "--draft");
					expect(good.code, good.text).toBe(0);
				}
				for (const body of [
					complete().replace("85%", "sure"),
					complete().replace("None.", `1. ${text}? Lean yes, ${percent}%.\n2. Another?`),
					complete().replace("None.", `1. ${text}? ${percent}%.`),
					// Review round 1, finding 9: "None." followed by unnumbered questions.
					complete().replace("None.", `None.\n- ${text}?`),
					complete().replace("None.", `None.\n* ${text}?`),
					complete().replace("None.", `None.\n+ ${text}?`),
					complete().replace("None.", `None.\n${text}, and is it ready?`),
				]) {
					const bad = modeCheck(`\nPlancheck-Version: 2\n${body}`, "--draft");
					expect(bad.code, bad.text).toBe(1);
				}
			}),
			{seed: 321, numRuns: 3},
		);
	});

	// Plant: scan only table rows. These qualified exam paths appear in prose, lists and fences.
	it("K11 every exam path outside tables needs its own tests-owned files row", () => {
		fc.assert(
			fc.property(
				fc.constantFrom(
					".github/workflows/check.yaml",
					"oxlint-plugins/laws.ts",
					".agents/skills/lead/scripts/box.test.ts",
				),
				fc.constantFrom("prose", "list", "code"),
				(path, place) => {
					const mention =
						place === "code"
							? `\n\`\`\`text\n${path}\n\`\`\``
							: place === "list"
								? `\n- \`${path}\``
								: `\nChange \`${path}\` here.`;
					const body = complete(mention);
					const bad = modeCheck(`\nPlancheck-Version: 2\n${body}`, "--draft");
					expect(bad.code, bad.text).toBe(1);
					expect(bad.text).toContain(path);
					const withRow = body.replace(
						"| src/plain.ts | build |",
						`| src/plain.ts | build |\n| ${path} | tests |`,
					);
					const good = modeCheck(`\nPlancheck-Version: 2\n${withRow}`, "--draft");
					expect(good.code, good.text).toBe(0);
				},
			),
			{seed: 321, numRuns: 6},
		);
	});

	// Plants: hash line one; omit appended amendments; normalize CRLF, UTF-8 or the final LF.
	it("K2/K11 binds approval to exact bytes after the second LF, including amendments", () => {
		fc.assert(
			fc.property(
				fc.record({
					text: word,
					ending: fc.constantFrom("", "\n", "\r\n"),
					unicode: fc.constantFrom("é", "e\u0301", "猫", "🫖"),
				}),
				({text, ending, unicode}) => {
					const body = complete(`\n## Amendment 1\n${unicode} ${text}${ending}`);
					const draft = modeCheck(`\nPlancheck-Version: 2\n${body}`, "--draft");
					expect(draft.code, draft.text).toBe(0);
					expect(draft.text).toContain(digest(body));
					const good = modeCheck(approved(body), "--approved");
					expect(good.code, good.text).toBe(0);
					for (const edited of [
						`${body}\n`,
						body.replace(text, `${text}x`),
						body.replaceAll("\n", "\r\n"),
						`${body}\n## Amendment 2\nChanged.\n`,
					]) {
						const stale = `${approved(body).split("\n").slice(0, 2).join("\n")}\n${edited}`;
						const bad = modeCheck(stale, "--approved");
						expect(bad.code, bad.text).toBe(1);
						expect(bad.text).toMatch(/hash|digest|body|approval/);
						const renewed = modeCheck(approved(edited), "--approved");
						expect(renewed.code, renewed.text).toBe(0);
					}
				},
			),
			{seed: 321, numRuns: 3},
		);
	});

	// Plant: read line one with splitlines(), so a CRLF approval passes here and fails in box.sh
	// and stepcommit.sh. Review round 1, finding 7.
	it("K2 approved mode refuses a CRLF approval line, as the byte readers do", () => {
		fc.assert(
			fc.property(word, (text) => {
				const body = complete(`\n## Amendment 1\n${text}\n`);
				const crlf = approved(body).replace("\n", "\r\n");
				const bad = modeCheck(crlf, "--approved");
				expect(bad.code, bad.text).toBe(1);
				expect(bad.text).toMatch(/approval/);
			}),
			{seed: 321, numRuns: 3},
		);
	});

	// Plant: accept any approval-looking line or a duplicate lower in the body.
	it("K2 approved mode requires the exact lead approval grammar on line one", () => {
		fc.assert(
			fc.property(word, (note) => {
				const body = complete();
				const first = approved(body, note).split("\n")[0]!;
				const good = modeCheck(approved(body, note), "--approved");
				expect(good.code, good.text).toBe(0);
				for (const line of [
					"",
					first.replace("lead agent", "driver"),
					first.replace(`builds ${note};`, "builds ;"),
					first.replace("; body", "; digest"),
					first.replace(digest(body).slice(0, 12), digest(body).slice(0, 11)),
					`${first} extra`,
				]) {
					const bad = modeCheck(`${line}\nPlancheck-Version: 2\n${body}`, "--approved");
					expect(bad.code, bad.text).toBe(1);
				}
				const duplicate = `${body}\n${first}\n`;
				expect(modeCheck(approved(duplicate), "--approved").code).toBe(1);
			}),
			{seed: 321, numRuns: 3},
		);
	});
});

describe("T325 K6 plancheck, today's tooling", () => {
	// No domain Schema for draft text. Plant: skip the shared checker or ignore its refusal.
	it("checks every draft addition with leakgrep and preserves clean plans", () => {
		fc.assert(
			fc.property(
				fc.record({suffix: word, leak: fc.boolean(), draft: fc.boolean()}),
				({suffix, leak, draft}) => {
					const dir = mkdtempSync(join(tmpdir(), "pc-leak-"));
					try {
						const root = join(dir, "repo"),
							scripts = join(root, ".agents/skills");
						for (const part of ["plan", "lead", "step-commit"])
							mkdirSync(join(scripts, part, "scripts"), {recursive: true});
						for (const file of [
							"plan/scripts/plancheck.sh",
							"lead/scripts/leakgrep.sh",
							"step-commit/scripts/exam.py",
						])
							cpSync(join(import.meta.dirname, "../..", file), join(scripts, file));
						cpSync(
							join(import.meta.dirname, "../../../../exam-paths.json"),
							join(root, "exam-paths.json"),
						);
						symlinkSync(
							join(import.meta.dirname, "../../../../node_modules"),
							join(root, "node_modules"),
						);
						expect(spawnSync("git", ["init", "-q", root]).status).toBe(0);
						const privateWord = `private_${suffix}`;
						const words = join(dir, "words");
						writeFileSync(
							words,
							`${privateWord}\n${"https://github.com/usirin/tea-fabrika".split("/").slice(-2).join("\n")}\n`,
						);
						const plan = join(root, "plan.md");
						writeFileSync(
							plan,
							`${draft ? "" : "Approved by the lead agent, builds note."}\nPlancheck-Version: 2\n\n# Plan\n\n\`\`\`ts\nconst idea = 1;\n\`\`\`\n\n## Laws\n${laws("fc.record: text")}\n## Files\n${table(["File", "Owner step"], [["src/plain.ts", "build"]])}\n## Size\n2 files, 10 lines, 1 agent hour. Confidence: 90%.\n## What it records\nRefusals.\n## What it cannot tell us\nNo live push.\n## Open questions\nNone.\nhttps://github.com/usirin/tea-fabrika/pull/532\n${leak ? privateWord : "Safe text."}\n`,
						);
						const run = () =>
							spawnSync(
								"sh",
								[join(scripts, "plan/scripts/plancheck.sh"), ...(draft ? ["--draft"] : []), plan],
								{
									cwd: root,
									encoding: "utf8",
									timeout: 5_000,
									env: {...process.env, FABRIKA_LEAK_WORDS: words, TYPESAFE_API_KEY: undefined},
								},
							);
						const out = run();
						expect(out.error).toBeUndefined();
						expect(out.status, out.stdout + out.stderr).toBe(leak ? 1 : 0);
						writeFileSync(
							join(scripts, "lead/scripts/leakgrep.sh"),
							"#!/bin/sh\necho 'leakgrep: planted refusal' >&2\nexit 1\n",
						);
						expect(run().status).toBe(1);
					} finally {
						rmSync(dir, {recursive: true, force: true});
					}
				},
			),
			{seed: 325, numRuns: 6},
		);
	});
});
