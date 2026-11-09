import {spawnSync} from "node:child_process";
import {cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
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
								writeFileSync(join(sources, n, "SKILL.md"), `# ${n}\n`);
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
