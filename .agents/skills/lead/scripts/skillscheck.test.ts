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

const script = process.env.T318_SKILLSCHECK_SCRIPT ?? join(import.meta.dirname, "skillscheck.sh");
// These fixtures are independent of the checker: deleting a checker clause must fail a law.
const exam = [
	"Every new or changed law is a property, or an example labeled vector, format, pinned or scenario with its reason.",
	"Zero hits from loosening.sh and the mutation arm-a vs arm-b comparison mean no owner read is needed.",
	"The lead records both outputs in the PR. A hit goes to the lead's hand check, with the hit list in the PR. Only real loosening waits on the owner.",
];
const check = [
	"Sweep, do not sample. For each law in the plan's table, list every way in: each public call, each cut point, and each saved or binding state. Check each one.",
	"A finding names its class and every case of it.",
	"A law written as examples over a class the plan names is a defect when a found case escapes those examples.",
	"On a re-review, read every line the last fixes changed and what calls them first. Then finish the remaining checks.",
	"Read every decided note the PR builds, following the plan's references and the change itself.",
	"Block only on a broken decision in docs/direction or AGENTS.md, lost data, or a broken law. Each blocker cites that source and shows the missed case.",
];
const answer = [
	"Start with merge-ready; tickets: <m> or changes: <n>; tickets: <m>.",
	"n counts blocking classes. Each class lists every affected case. m counts distinct confirmed tracker tickets linked in this answer.",
	"Give every finding in that answer, grouped by class, most serious first.",
	"Name each checked decided note and say where the change follows or breaks it.",
	'Use tracker_query to find an existing ticket, or tracker_file with value: {title, body, from: {_tag: "pr", url, step: "review"}}. Record the returned ID.',
	"If filing fails, include the exact pending payload for lead to retry. Do not count it as filed or start another review round for it.",
];
const handoff = [
	"A ticket's driver is not the lead session. Every plan and amendment returns unsigned.",
	"Before handing it to lead, the driver runs plancheck.sh --draft, saves the approval wait and ends.",
	"Only the lead session reads and signs each plan and amendment itself.",
];
const sections: Record<string, Record<string, string[]>> = {
	".agents/skills/review/SKILL.md": {"3. **Check:**": check, "4. **Answer**": answer},
	".agents/skills/lead/SKILL.md": {
		"## Review brief template": [
			"Ticket:",
			"Version:",
			"Approved plan:",
			"Parent base:",
			"Reviewed head:",
			"Decided notes:",
			"Last fixes:",
			...check,
			...answer,
		],
		"## Saved driver state": [
			"$BOXES/state/<name>.md",
			"Ticket or row:",
			"Branch and full SHA:",
			"Plan path:",
			"Parent branch and signed head:",
			"Children and merge method:",
			"Worktree and box names:",
			"Wait: kind, target, report or log path",
			"Cleared when: exact fact to read",
			"Next step:",
			"Field rows already written: run IDs, note IDs, commits",
			"Saved at:",
			"A Codex box, parent build, CI, plan approval or owner read is a wait.",
			"Before ending, save completed field work and replace a temporary sibling with this file. Then end the driver session.",
			"Lead checks the saved clearing condition and starts a fresh driver when it holds.",
			"The new driver reads the current branch, SHA, reports and checks again before acting. It does not rerun completed steps or duplicate listed field rows.",
			"Missing or unclear state sends it back to those facts.",
		],
		"## Driver brief template": handoff,
		"9. **Land it**": [
			"After a successful merge, retain the checked head under refs/keep/pr/<pr> in MAIN.",
			"Remove the registered catchup-<pr> worktree, exact-branch boxes through box.sh rm, and the driver's linked MAIN worktree on that exact branch. Never remove MAIN itself.",
			"Use git worktree remove without force. Keep dirty, locked, ambiguous or unreadable candidates and any box that fails its guard.",
			"Print one line per retained item and continue. Cleanup never changes a landed merge's success.",
			"Saved plans, reports, logs and state/ remain.",
			...exam,
		],
	},
	".agents/skills/plan/SKILL.md": {"## Scripts": handoff},
	"AGENTS.md": {
		"- **Every pull request, next/ or today's, goes through the pipeline's steps:**": exam,
	},
};
const tree = (dir: string, whitespace = " ", omit?: [string, string, number], outside = false) => {
	for (const [file, groups] of Object.entries(sections)) {
		const chunks = Object.entries(groups).map(
			([heading, clauses]) =>
				`${heading}\n${clauses
					.filter((_, i) => !(omit?.[0] === file && omit[1] === heading && omit[2] === i))
					.map((s) => s.split(" ").join(whitespace))
					.join("\n")}\n`,
		);
		if (outside && omit) chunks.push(`## Unrelated\n${sections[omit[0]]![omit[1]]![omit[2]]}\n`);
		mkdirSync(join(dir, file, ".."), {recursive: true});
		writeFileSync(join(dir, file), chunks.join("\n"));
		if (file !== "AGENTS.md") {
			const skill = file.split("/")[2]!;
			mkdirSync(join(dir, ".claude/skills"), {recursive: true});
			const alias = join(dir, ".claude/skills", skill);
			rmSync(alias, {recursive: true, force: true});
			symlinkSync(`../../.agents/skills/${skill}`, alias);
		}
	}
};
const run = (dir: string) =>
	spawnSync("sh", [script, dir], {
		encoding: "utf8",
		timeout: 5_000,
		env: {...process.env, TYPESAFE_API_KEY: undefined},
	});
const name = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/);
const states = ["relative", "absolute", "missing", "copy", "dangling", "wrong", "cycle"] as const;
type State = (typeof states)[number];

describe("skillscheck, today's tooling", () => {
	// Plant: keep the old owner-read clause, omit the new clause, or find it outside its section.
	it("T318 hit routing requires the lead hand check before a real loosening owner read", () => {
		fc.assert(
			fc.property(fc.constantFrom(" ", "\n  ", "\t"), (space) => {
				const dir = mkdtempSync(join(tmpdir(), "hit-routing-"));
				try {
					tree(dir, space);
					expect(run(dir).status).toBe(0);
					for (const file of [".agents/skills/lead/SKILL.md", "AGENTS.md"]) {
						for (const substitute of [
							"The lead records both outputs in the PR. Any hit waits on the owner.",
							"",
						]) {
							tree(dir, space);
							const path = join(dir, file);
							writeFileSync(
								path,
								`${readFileSync(path, "utf8").replace(
									exam[2]!.split(" ").join(space),
									substitute,
								)}\n## Unrelated\n${exam[2]}\n`,
							);
							const got = run(dir);
							expect(got.status, got.stderr).toBe(1);
							expect(got.stderr).toContain(`${file}: missing`);
						}
					}
				} finally {
					rmSync(dir, {recursive: true, force: true});
				}
			}),
			{seed: 31845, numRuns: 3, endOnFailure: true},
		);
	});

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
							tree(dir);
							const sources = join(dir, ".agents/skills");
							const aliases = join(dir, ".claude/skills");
							mkdirSync(sources, {recursive: true});
							mkdirSync(aliases, {recursive: true});
							for (const n of names) {
								mkdirSync(join(sources, n), {recursive: true});
								if (!["review", "lead", "plan"].includes(n))
									writeFileSync(join(sources, n, "SKILL.md"), `# ${n}\n`);
							}
							const actual: State[] = [];
							for (const [i, n] of names.entries()) {
								const state = chosen[i] ?? "relative";
								actual.push(state);
								const source = join(sources, n),
									alias = join(aliases, n);
								rmSync(alias, {recursive: true, force: true});
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
							if (!bad.length)
								expect(ran.stdout).toContain(
									`${new Set([...names, "review", "lead", "plan"]).size} shared skills`,
								);
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

	// Plants: delete any one required clause from the checker; search the whole file instead of its section.
	it("T318 wrapped clauses pass and each missing or misplaced clause fails independently", () => {
		let accepted = 0,
			refused = 0;
		fc.assert(
			fc.property(
				fc.record({
					space: fc.constantFrom(" ", "\n", "\n  ", "\t"),
					noise: name.filter((n) => !["review", "lead", "plan"].includes(n)),
				}),
				({space, noise}) => {
					const dir = mkdtempSync(join(tmpdir(), "clauses-"));
					try {
						tree(dir, space);
						mkdirSync(join(dir, ".claude/skills", noise), {recursive: true});
						writeFileSync(join(dir, ".claude/skills", noise, "SKILL.md"), `# ${noise}\n`);
						expect(run(dir).status).toBe(0);
						accepted++;
						for (const [file, groups] of Object.entries(sections)) {
							for (const [heading, clauses] of Object.entries(groups))
								for (const [i, clause] of clauses.entries()) {
									for (const outside of [false, true]) {
										tree(dir, space, [file, heading, i], outside);
										const got = run(dir);
										expect(got.status, `${file}: ${clause}\n${got.stderr}`).toBe(1);
										expect(got.stderr).toContain(`${file}: missing`);
										refused++;
									}
								}
							tree(dir, space);
							rmSync(join(dir, file));
							expect(run(dir).stderr).toContain(`${file}: missing required file`);
							refused++;
						}
					} finally {
						rmSync(dir, {recursive: true, force: true});
					}
				},
			),
			{seed: 318, numRuns: 3},
		);
		console.info(
			`T318 clauses: ${accepted} clean trees accepted, ${refused} independent refusals, 0 false alarms`,
		);
	});

	// Plants: accept the obsolete restriction or a numeric line cap; reject unrelated agent-count limits.
	it("T318 review restrictions fail while unrelated numbers and existing link checks survive", () => {
		fc.assert(
			fc.property(
				fc.record({cap: fc.integer({min: 1, max: 80}), space: fc.constantFrom(" ", "\n  ")}),
				({cap, space}) => {
					const dir = mkdtempSync(join(tmpdir(), "restrictions-"));
					try {
						for (const phrase of [
							"Only defects a real run could hit.",
							`At most ${cap} lines.`,
							`${cap}-line cap.`,
							`Line limit: ${cap}.`,
							`At most ${cap} agents.`,
							`Read ${cap} notes.`,
						]) {
							tree(dir, space);
							const file = join(dir, ".agents/skills/lead/SKILL.md");
							writeFileSync(
								file,
								readFileSync(file, "utf8").replace(
									"## Review brief template\n",
									`## Review brief template\n${phrase.split(" ").join(space)}\n`,
								),
							);
							const got = run(dir);
							expect(got.status, got.stderr).toBe(
								phrase.includes("agents") || phrase.includes("notes") ? 0 : 1,
							);
						}
					} finally {
						rmSync(dir, {recursive: true, force: true});
					}
				},
			),
			{seed: 319, numRuns: 4},
		);
	});
});
