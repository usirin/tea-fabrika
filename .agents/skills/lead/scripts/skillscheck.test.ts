import {spawnSync} from "node:child_process";
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
import {join, relative} from "node:path";
import fc from "fast-check";
import {describe, expect, it} from "vitest";

const script = join(import.meta.dirname, "skillscheck.sh");
const name = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/);
const states = ["relative", "absolute", "missing", "copy", "dangling", "wrong", "cycle"] as const;
type State = (typeof states)[number];

describe("skillscheck, today's tooling", () => {
	// Plants: accept an identical directory copy; accept a link to a different skill.
	it("T300 generated source trees require links resolving to their own source", () => {
		let clean = 0,
			refused = 0;
		fc.assert(
			fc.property(
				fc.record({
					names: fc.uniqueArray(name, {minLength: 2, maxLength: 4}),
					states: fc.array(fc.constantFrom(...states), {minLength: 1, maxLength: 4}),
					space: fc.boolean(),
				}),
				({names, states: generated, space}) => {
					// Each input also checks every refusal alone, so another bad alias cannot hide it.
					for (const chosen of [[...generated], ...states.map((s) => [s])]) {
						const dir = mkdtempSync(join(tmpdir(), space ? "skill tree " : "skill-tree-"));
						try {
							const sources = join(dir, ".agents/skills");
							const aliases = join(dir, ".claude/skills");
							mkdirSync(sources, {recursive: true});
							mkdirSync(aliases, {recursive: true});
							for (const n of names) {
								mkdirSync(join(sources, n));
								writeFileSync(join(sources, n, "SKILL.md"), skillText(n));
							}
							const actual: State[] = [];
							for (const [i, n] of names.entries()) {
								const state = chosen[i] ?? "relative";
								actual.push(state);
								const source = join(sources, n),
									alias = join(aliases, n);
								switch (state) {
									case "relative":
										symlinkSync(relative(aliases, source), alias);
										break;
									case "absolute":
										symlinkSync(source, alias);
										break;
									case "copy":
										cpSync(source, alias, {recursive: true});
										break;
									case "dangling":
										symlinkSync("../../.agents/skills/_absent", alias);
										break;
									case "wrong":
										symlinkSync(
											relative(aliases, join(sources, names[(i + 1) % names.length]!)),
											alias,
										);
										break;
									case "cycle":
										symlinkSync(n, alias);
										break;
									case "missing":
										break;
								}
							}
							// Source folders without SKILL.md and unrelated Claude-only skills are ignored.
							mkdirSync(join(sources, "_not-a-skill"));
							mkdirSync(join(aliases, "_claude-only"));
							writeFileSync(join(aliases, "_claude-only/SKILL.md"), "# Local\n");
							const ran = spawnSync("sh", [script], {
								cwd: dir,
								encoding: "utf8",
								timeout: 5_000,
								env: {...process.env, TYPESAFE_API_KEY: undefined},
							});
							expect(ran.error).toBeUndefined();
							expect(ran.signal).toBeNull();
							const bad = actual.flatMap((s, i) =>
								s === "relative" || s === "absolute" ? [] : [names[i]!],
							);
							expect(ran.status, ran.stdout + ran.stderr).toBe(bad.length ? 1 : 0);
							for (const n of bad) expect(ran.stderr).toContain(`.claude/skills/${n}:`);
							if (!bad.length) expect(ran.stdout).toContain(`${names.length} shared skills`);
							if (bad.length) refused++;
							else clean++;
						} finally {
							rmSync(dir, {recursive: true, force: true});
						}
					}
				},
			),
			{seed: 300, numRuns: 8},
		);
		console.info(
			`T300 skillscheck: ${clean} clean trees accepted, ${refused} bad trees refused, 0 false alarms`,
		);
	});
});

const clauses = [
	[
		"lead",
		"Scripts",
		"K19",
		"box.sh run and runplan.sh strip secret settings and redact saved output.",
	],
	["lead", "Scripts", "K1", "fetch --sign checks owners and signs missing notes in MAIN."],
	["step-commit", "", "K1", "fetch --sign checks owners and signs missing notes in MAIN."],
	["lead", "Steps", "K2", "box.sh new checks the approved plan, base and ticket."],
	["lead", "Steps", "K3", "box.sh run --step checks order and slots, and saves the run row."],
	[
		"step-commit",
		"",
		"K4",
		"stepcommit.sh checks named paths, owners, exam paths and staged formatting.",
	],
	[
		"plan",
		"",
		"K11",
		"plancheck.sh checks the draft; only the lead session reads and approves the whole plan and amendments.",
	],
] as const;
const skillText = (skill: string, omit = -1, wrap = " ") => {
	const sections = new Map<string, string[]>();
	for (const [i, [source, section, , text]] of clauses.entries()) {
		if (source !== skill || i === omit) continue;
		sections.set(section, [...(sections.get(section) ?? []), text.split(" ").join(wrap)]);
	}
	return `# ${skill}\n${[...sections].map(([section, texts]) => `${section ? `## ${section}\n` : ""}${texts.join("\n\n")}`).join("\n\n")}\n`;
};
const clauseTree = (f: (dir: string) => void, program = script) => {
	const dir = mkdtempSync(join(tmpdir(), "clauses-"));
	try {
		for (const n of ["lead", "plan", "step-commit"]) {
			mkdirSync(join(dir, ".agents/skills", n), {recursive: true});
			mkdirSync(join(dir, ".claude/skills"), {recursive: true});
			writeFileSync(join(dir, ".agents/skills", n, "SKILL.md"), skillText(n));
			symlinkSync(`../../.agents/skills/${n}`, join(dir, ".claude/skills", n));
		}
		f(dir);
		const ran = spawnSync("sh", [program, dir], {encoding: "utf8", timeout: 5_000});
		expect(ran.error).toBeUndefined();
		return {code: ran.status, text: ran.stdout + ran.stderr};
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
};

describe("T321 required clauses, today's tooling, slice 1a", () => {
	// Plant: require the retired mechanical sentence as well as its script pointer.
	it("accepts wrapping and removal of the named mechanical prose", () => {
		fc.assert(
			fc.property(fc.constantFrom(" ", "\n", " \n\t"), fc.boolean(), (wrap, old) => {
				const got = clauseTree((dir) => {
					for (const n of ["lead", "plan", "step-commit"]) {
						const retired = old
							? "Never rebase, force-push or update-branch.\nRun draft check; every exam path in the files table.\n"
							: "";
						writeFileSync(
							join(dir, ".agents/skills", n, "SKILL.md"),
							skillText(n, -1, wrap) + retired,
						);
					}
				});
				expect(got.code, got.text).toBe(0);
			}),
			{seed: 321, numRuns: 6},
		);
	});

	// Plant: accept a clause in a different section, code fence, or different skill.
	it("refuses each absent clause alone, including misplaced and fenced copies", () => {
		fc.assert(
			fc.property(
				// "removed": review round 1, finding 10, a deleted source dropped its clauses.
				fc.constantFrom("missing", "wrong-section", "fenced", "wrong-skill", "removed"),
				fc.constantFrom(" ", "\n"),
				(where, wrap) => {
					for (const [i, [skill, section, check, text]] of clauses.entries()) {
						const got = clauseTree((dir) => {
							let content = skillText(skill, i, wrap);
							if (where === "wrong-section" && section) content += `\n## Elsewhere\n${text}\n`;
							if (where === "fenced")
								content += `\n## ${section || "Example"}\n~~~md\n${text}\n~~~\n`;
							writeFileSync(join(dir, ".agents/skills", skill, "SKILL.md"), content);
							if (where === "removed") rmSync(join(dir, ".agents/skills", skill, "SKILL.md"));
							if (where === "wrong-skill")
								writeFileSync(
									join(dir, ".agents/skills", skill === "plan" ? "lead" : "plan", "SKILL.md"),
									`${skillText(skill === "plan" ? "lead" : "plan")}\n${text}\n`,
								);
						});
						expect(got.code, `${check}: ${got.text}`).toBe(1);
						expect(got.text).toContain(`${skill}/SKILL.md: ${check}`);
					}
				},
			),
			{seed: 321, numRuns: 10},
		);
	});

	// scenario: each exact hand plant runs once on a disposable copy, which is then deleted.
	it("scenario: kills the retired-clause and wrong-section plants", () => {
		const dir = mkdtempSync(join(tmpdir(), "clause-plants-"));
		try {
			const source = readFileSync(script, "utf8");
			for (const [plant, before, after] of [
				["retired clause", "bad = []", 'bad = ["retired mechanical prose required"]'],
				["wrong section", '.get(section, "")', '.get("", "")'],
			] as const) {
				expect(source).toContain(before);
				const planted = join(dir, "skillscheck.sh");
				writeFileSync(planted, source.replace(before, after));
				const got = clauseTree((tree) => {
					if (plant === "wrong section")
						writeFileSync(
							join(tree, ".agents/skills/lead/SKILL.md"),
							`${skillText("lead", 0)}\n## Elsewhere\n${clauses[0][3]}\n`,
						);
				}, planted);
				expect(got.code).toBe(plant === "retired clause" ? 1 : 0);
				// The law expects the opposite result for this same input.
				expect(() => expect(got.code).toBe(plant === "retired clause" ? 0 : 1)).toThrow();
				rmSync(planted);
			}
		} finally {
			rmSync(dir, {recursive: true, force: true});
		}
	});
});
