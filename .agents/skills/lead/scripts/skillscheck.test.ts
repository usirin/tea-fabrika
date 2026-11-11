// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./land.ts?raw";
import "./catchup.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./freshmain.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.ts?raw";
import "./mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.Dockerfile?raw";
import "../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/limit.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/sample.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/scope.ts?raw";
import "./skillscheck.sh?raw";
import "./leakgrep.sh?raw";
import "./loosening.sh?raw";
import "./box.sh?raw";
import "./keepruns.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./agents.ts?raw";
import "./fieldrow.py?raw";
import "./runplan.sh?raw";
import "./env.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gc.ts?raw";
import "./redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
import "./clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./lane.ts?raw";
import "../../plan/scripts/plancheck.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./sizecap.ts?raw";
import "../../step-commit/scripts/exam.py?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

const script = process.env.T318_SKILLSCHECK_SCRIPT ?? join(import.meta.dirname, "skillscheck.sh");

// These fixtures are independent of the checker: deleting a checker clause must fail a law.
const exam = [
  "Every new or changed law is a property, or an example labeled vector, format, pinned or scenario with its reason.",
  // pinned: 0066, mutation left the pull request's steps, so loosening.sh alone is the zero-hit check.
  "Zero hits from loosening.sh mean no owner read is needed.",
  "The lead records its output in the PR. A hit goes to the lead's hand check, with the hit list in the PR. Only real loosening waits on the owner.",
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
  "Start with merge-ready; findings: <m> or changes: <n>; findings: <m>.",
  "n counts blocking classes. Each class lists every affected case. m counts the finding rows in this answer.",
  "Give every finding in that answer, grouped by class, most serious first.",
  "Name each checked decided note and say where the change follows or breaks it.",
  "Any other actionable finding is one finding row with proof: never a ticket, a fix or only a mention, and never a security hole.",
  "Give each row as one JSON line in the answer. The lead saves it unchanged as its own file in field/findings/. Do not start another review round for it.",
  "End with exactly one answer: line, as the last line.",
];

const sections: Record<string, Record<string, string[]>> = {
  ".agents/skills/review/SKILL.md": { "3. **Check:**": check, "4. **Answer**": answer },
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
    "9. **Land it**": [
      "After a successful merge, retain the checked head under refs/keep/pr/<pr> in MAIN.",
      "Remove the registered catchup-<pr> worktree, exact-branch boxes through box.sh rm, and the driver's linked MAIN worktree on that exact branch. Never remove MAIN itself.",
      "Use git worktree remove without force. Keep dirty, locked, ambiguous or unreadable candidates and any box that fails its guard.",
      "Print one line per retained item and continue. Cleanup never changes a landed merge's success.",
      "Saved plans, reports, logs and state/ remain.",
      ...exam,
    ],
    "## Lane brief template": ["End with `node .agents/skills/lead/scripts/land.ts ready <lane> --tree <path>`."],
  },
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

    if (outside && omit) {
      chunks.push(`## Unrelated\n${sections[omit[0]]![omit[1]]![omit[2]]}\n`);
    }

    mkdirSync(join(dir, file, ".."), { recursive: true });
    // A skill file also holds slice 1a's clauses, so both checks read one whole tree.
    const own = file === "AGENTS.md" ? "" : `\n${mainText(file.split("/")[2]!)}`;
    writeFileSync(join(dir, file), chunks.join("\n") + own);

    if (file !== "AGENTS.md") {
      const skill = file.split("/")[2]!;
      mkdirSync(join(dir, ".claude/skills"), { recursive: true });
      const alias = join(dir, ".claude/skills", skill);
      rmSync(alias, { recursive: true, force: true });
      symlinkSync(`../../.agents/skills/${skill}`, alias);
    }
  }

  // The other clause sources hold only the slice 1a and 1b clauses.
  for (const skill of new Set(allClauses.map(([s]) => s).filter((s) => s !== "lead"))) {
    mkdirSync(join(dir, ".agents/skills", skill), { recursive: true });
    writeFileSync(join(dir, ".agents/skills", skill, "SKILL.md"), mainText(skill));
    rmSync(join(dir, ".claude/skills", skill), { recursive: true, force: true });
    symlinkSync(`../../.agents/skills/${skill}`, join(dir, ".claude/skills", skill));
  }
};

const run = (dir: string) =>
  spawnSync("sh", [script, dir], {
    encoding: "utf8",
    timeout: 5_000,
    env: { ...process.env, TYPESAFE_API_KEY: undefined },
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
            for (const substitute of ["The lead records both outputs in the PR. Any hit waits on the owner.", ""]) {
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
          rmSync(dir, { recursive: true, force: true });
        }
      }),
      { seed: 31845, numRuns: 3, endOnFailure: true },
    );
  });

  // Plants: accept an identical directory copy; accept a link to a different skill.
  it("T300 generated source trees require links resolving to their own source", () => {
    let clean = 0,
      refused = 0;
    fc.assert(
      fc.property(
        fc.record({
          names: fc.uniqueArray(name, { minLength: 2, maxLength: 4 }),
          states: fc.array(fc.constantFrom(...states), { minLength: 1, maxLength: 4 }),
          space: fc.boolean(),
        }),
        ({ names, states: generated, space }) => {
          // Each input also checks every refusal alone, so another bad alias cannot hide it.
          for (const chosen of [[...generated], ...states.map((s) => [s])]) {
            const dir = mkdtempSync(join(tmpdir(), space ? "skill tree " : "skill-tree-"));

            try {
              tree(dir);
              const sources = join(dir, ".agents/skills");
              const aliases = join(dir, ".claude/skills");
              mkdirSync(sources, { recursive: true });
              mkdirSync(aliases, { recursive: true });

              for (const n of names) {
                mkdirSync(join(sources, n), { recursive: true });

                if (!["review", "lead", "plan"].includes(n)) {
                  writeFileSync(join(sources, n, "SKILL.md"), skillText(n));
                }
              }

              const actual: State[] = [];

              for (const [i, n] of names.entries()) {
                const state = chosen[i] ?? "relative";
                actual.push(state);
                const source = join(sources, n),
                  alias = join(aliases, n);
                rmSync(alias, { recursive: true, force: true });

                switch (state) {
                  case "relative":
                    symlinkSync(relative(aliases, source), alias);
                    break;
                  case "absolute":
                    symlinkSync(source, alias);
                    break;
                  case "copy":
                    cpSync(source, alias, { recursive: true });
                    break;
                  case "dangling":
                    symlinkSync("../../.agents/skills/_absent", alias);
                    break;
                  case "wrong":
                    symlinkSync(relative(aliases, join(sources, names[(i + 1) % names.length]!)), alias);
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
                env: { ...process.env, TYPESAFE_API_KEY: undefined },
              });
              expect(ran.error).toBeUndefined();
              expect(ran.signal).toBeNull();
              const bad = actual.flatMap((s, i) => (s === "relative" || s === "absolute" ? [] : [names[i]!]));
              expect(ran.status, ran.stdout + ran.stderr).toBe(bad.length ? 1 : 0);

              for (const n of bad) {
                expect(ran.stderr).toContain(`.claude/skills/${n}:`);
              }

              if (!bad.length) {
                expect(ran.stdout).toContain(
                  `${new Set([...names, "review", ...allClauses.map(([s]) => s)]).size} shared skills`,
                );
              }

              if (bad.length) {
                refused++;
              } else {
                clean++;
              }
            } finally {
              rmSync(dir, { recursive: true, force: true });
            }
          }
        },
      ),
      { seed: 300, numRuns: 8 },
    );
    console.info(`T300 skillscheck: ${clean} clean trees accepted, ${refused} bad trees refused, 0 false alarms`);
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
        ({ space, noise }) => {
          const dir = mkdtempSync(join(tmpdir(), "clauses-"));

          try {
            tree(dir, space);
            mkdirSync(join(dir, ".claude/skills", noise), { recursive: true });
            writeFileSync(join(dir, ".claude/skills", noise, "SKILL.md"), `# ${noise}\n`);
            expect(run(dir).status).toBe(0);
            accepted++;

            for (const [file, groups] of Object.entries(sections)) {
              for (const [heading, clauses] of Object.entries(groups)) {
                for (const [i, clause] of clauses.entries()) {
                  for (const outside of [false, true]) {
                    tree(dir, space, [file, heading, i], outside);
                    const got = run(dir);
                    expect(got.status, `${file}: ${clause}\n${got.stderr}`).toBe(1);
                    expect(got.stderr).toContain(`${file}: missing`);
                    refused++;
                  }
                }
              }

              tree(dir, space);
              rmSync(join(dir, file));
              expect(run(dir).stderr).toContain(`${file}: missing required file`);
              refused++;
            }
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      { seed: 318, numRuns: 3 },
    );
    console.info(`T318 clauses: ${accepted} clean trees accepted, ${refused} independent refusals, 0 false alarms`);
  });

  // Plants: accept the obsolete restriction or a numeric line cap; reject unrelated agent-count limits.
  it("T318 review restrictions fail while unrelated numbers and existing link checks survive", () => {
    fc.assert(
      fc.property(
        fc.record({ cap: fc.integer({ min: 1, max: 80 }), space: fc.constantFrom(" ", "\n  ") }),
        ({ cap, space }) => {
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
              expect(got.status, got.stderr).toBe(phrase.includes("agents") || phrase.includes("notes") ? 0 : 1);
            }
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      { seed: 319, numRuns: 4 },
    );
  });
});

describe("skillscheck brief templates, today's tooling", () => {
  // Ticket 652: the permission check refuses a subagent the lead key, so a brief template that
  // hands an agent a lead-only step stops the lane. Each lead-only command, in any template, fails;
  // an unsigned lead commit and the ready handover stay allowed.
  it("T652 property: a lead-only step in any brief template fails, and the unsigned lead commit passes", () => {
    fc.assert(
      fc.property(
        fc.record({
          template: fc.constantFrom("## Review brief template\n", "## Lane brief template\n"),
          space: fc.constantFrom(" ", "\n  "),
        }),
        ({ template, space }) => {
          const dir = mkdtempSync(join(tmpdir(), "templates-"));

          try {
            for (const [phrase, code] of [
              ["pnpm commits sign --step lead --ticket 1 --key k", 1],
              ["Read ~/.fabrika/step-keys/lead first.", 1],
              ["node .agents/skills/lead/scripts/botpush.mjs . fabrikalfa/x", 1],
              ["sh .agents/skills/lead/scripts/catchup.sh 1 1", 1],
              ["node .agents/skills/lead/scripts/land.ts run lane 1", 1],
              ["stepcommit.sh lead 1 subject file", 1],
              ["stepcommit.sh --commit-only lead 1 subject file", 0],
              ["Say ready to land with the state file.", 0],
            ] as const) {
              tree(dir, space);
              const file = join(dir, ".agents/skills/lead/SKILL.md");
              writeFileSync(
                file,
                readFileSync(file, "utf8").replace(template, `${template}${phrase.split(" ").join(space)}\n`),
              );
              const got = run(dir);
              expect(got.status, `${phrase}: ${got.stderr}`).toBe(code);
            }
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      { seed: 652, numRuns: 4 },
    );
  });
});

const clauses = [
  ["lead", "Scripts", "K19", "box.sh run and runplan.sh strip secret settings and redact saved output."],
  ["lead", "Scripts", "K1", "fetch --sign checks owners and signs missing notes in MAIN."],
  ["step-commit", "", "K1", "fetch --sign checks owners and signs missing notes in MAIN."],
  ["lead", "Steps", "K2", "box.sh new checks the approved plan, base and ticket."],
  ["lead", "Steps", "K3", "box.sh run --step checks order and slots, and saves the run row."],
  ["step-commit", "", "K4", "stepcommit.sh checks named paths, owners, exam paths and staged formatting."],
  [
    "plan",
    "",
    "K11",
    "plancheck.sh checks the draft; only the lead session reads and approves the whole plan and amendments.",
  ],
] as const;

const slice1bClauses = [
  ["lead", "Scripts", "K6", "leakgrep.sh checks added text; private words stay outside the repo."],
  ["plan", "Scripts", "K6", "leakgrep.sh checks added text; private words stay outside the repo."],
  [
    "guidelines",
    "10. Open a docs-only pull request",
    "K6",
    "leakgrep.sh checks added text; private words stay outside the repo.",
  ],
  ...["tests", "build", "mutation"].map(
    (skill) =>
      [
        skill,
        "Go easy on the machine",
        "K9",
        "The test config and typecheck.sh hold worker, home and typecheck limits.",
      ] as const,
  ),
  [
    "tests",
    "Steps",
    "K20",
    "For a new property, use `@effect/vitest`'s `it.prop` or `it.effect.prop` with an existing Schema, or its own Effect Arbitrary exported beside it; write fast-check data only where Effect has nothing or to push edge cases.",
  ],
  // Ticket 523, decision 0035: each step skill and the lead skill say the finding rule once.
  ...["plan", "tests", "build", "mutation", "lead"].map(
    (skill) =>
      [
        skill,
        "Outside your task",
        "K21",
        "Something wrong that your task does not cover is one finding row with proof, then keep going: never a fix, a ticket or only a mention, and never a security hole.",
      ] as const,
  ),
] as const;

const allClauses = [...clauses, ...slice1bClauses];

const mainText = (skill: string, omit = -1, wrap = " ") => {
  const sections = new Map<string, string[]>();

  for (const [i, [source, section, , text]] of allClauses.entries()) {
    if (source !== skill || i === omit) {
      continue;
    }

    sections.set(section, [...(sections.get(section) ?? []), text.split(" ").join(wrap)]);
  }

  return `# ${skill}\n${[...sections].map(([section, texts]) => `${section ? `## ${section}\n` : ""}${texts.join("\n\n")}`).join("\n\n")}\n`;
};

// A skill file also holds T318's sections, so both checks read one whole tree.
const t318Text = (skill: string) =>
  Object.entries(sections[`.agents/skills/${skill}/SKILL.md`] ?? {}).map(
    ([heading, texts]) => `${heading}\n${texts.join("\n")}\n`,
  );

const skillText = (skill: string, omit = -1, wrap = " ") =>
  [...t318Text(skill), mainText(skill, omit, wrap)].join("\n");

const clauseTree = (f: (dir: string) => void, program = script) => {
  const dir = mkdtempSync(join(tmpdir(), "clauses-"));

  try {
    // T318's files (review, AGENTS.md) come from its own tree.
    tree(dir);

    // Every clause source exists, so one table covers both slices (1b review round 2, finding 5).
    for (const n of new Set(allClauses.map(([skill]) => skill))) {
      mkdirSync(join(dir, ".agents/skills", n), { recursive: true });
      writeFileSync(join(dir, ".agents/skills", n, "SKILL.md"), skillText(n));
      const alias = join(dir, ".claude/skills", n);
      rmSync(alias, { recursive: true, force: true });
      symlinkSync(`../../.agents/skills/${n}`, alias);
    }

    f(dir);
    const ran = spawnSync("sh", [program, dir], { encoding: "utf8", timeout: 5_000 });
    expect(ran.error).toBeUndefined();
    return { code: ran.status, text: ran.stdout + ran.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
            writeFileSync(join(dir, ".agents/skills", n, "SKILL.md"), skillText(n, -1, wrap) + retired);
          }
        });
        expect(got.code, got.text).toBe(0);
      }),
      { seed: 321, numRuns: 6 },
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

              if (where === "wrong-section" && section) {
                content += `\n## Elsewhere\n${text}\n`;
              }

              if (where === "fenced") {
                content += `\n## ${section || "Example"}\n~~~md\n${text}\n~~~\n`;
              }

              writeFileSync(join(dir, ".agents/skills", skill, "SKILL.md"), content);

              if (where === "removed") {
                rmSync(join(dir, ".agents/skills", skill, "SKILL.md"));
              }

              if (where === "wrong-skill") {
                writeFileSync(
                  join(dir, ".agents/skills", skill === "plan" ? "lead" : "plan", "SKILL.md"),
                  `${skillText(skill === "plan" ? "lead" : "plan")}\n${text}\n`,
                );
              }
            });
            expect(got.code, `${check}: ${got.text}`).toBe(1);
            expect(got.text).toContain(`${skill}/SKILL.md: ${check}`);
          }
        },
      ),
      { seed: 321, numRuns: 10 },
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
          if (plant === "wrong section") {
            writeFileSync(
              join(tree, ".agents/skills/lead/SKILL.md"),
              `${skillText("lead", 0)}\n## Elsewhere\n${clauses[0][3]}\n`,
            );
          }
        }, planted);
        expect(got.code).toBe(plant === "retired clause" ? 1 : 0);
        // The law expects the opposite result for this same input.
        expect(() => expect(got.code).toBe(plant === "retired clause" ? 0 : 1)).toThrow();
        rmSync(planted);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("T325 slice 1b required clauses, today's tooling", () => {
  // No domain Schema for Markdown wrapping. Plants: search the whole file, or demand retired prose.
  it("accepts wrapping and the named cuts, but refuses each absent or misplaced clause alone", () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: 2, max: 9 }),
          indent: fc.constantFrom("", "  ", "\t"),
          fenced: fc.boolean(),
        }),
        ({ width, indent, fenced }) => {
          const dir = mkdtempSync(join(tmpdir(), "clauses-"));

          try {
            // T318's files (review, AGENTS.md) come from its own tree.
            tree(dir);
            const sources = join(dir, ".agents/skills"),
              aliases = join(dir, ".claude/skills");
            mkdirSync(aliases, { recursive: true });
            const wrap = (text: string) =>
              text
                .split(" ")
                .map((w, i) => `${i && i % width === 0 ? `\n${indent}` : i ? " " : ""}${w}`)
                .join("");

            for (const skill of new Set(allClauses.map(([s]) => s))) {
              const source = join(sources, skill);
              mkdirSync(source, { recursive: true });
              rmSync(join(aliases, skill), { recursive: true, force: true });
              symlinkSync(relative(aliases, source), join(aliases, skill));
              const sections = new Map<string, string[]>();

              for (const [s, heading, , clause] of allClauses) {
                if (s !== skill) {
                  continue;
                }

                sections.set(heading, [...(sections.get(heading) ?? []), wrap(clause)]);
              }

              const text = `${[...t318Text(skill), ""].join("\n")}# ${skill}\n${[...sections].map(([heading, texts]) => `${heading ? `## ${heading}\n` : ""}${texts.join("\n\n")}`).join("\n\n")}\n`;
              writeFileSync(join(source, "SKILL.md"), text);
            }

            const run = () => spawnSync("sh", [script, dir], { encoding: "utf8", timeout: 5_000 });
            expect(run().status).toBe(0);

            for (const [skill, heading, , clause] of slice1bClauses) {
              const file = join(sources, skill, "SKILL.md"),
                text = readFileSync(file, "utf8");
              writeFileSync(file, text.replace(wrap(clause), ""));
              const absent = run();
              expect(absent.status).toBe(1);
              expect(absent.stderr).toContain(`${skill}/SKILL.md:`);
              expect(absent.stderr).toContain(heading);
              writeFileSync(
                file,
                `${text.replace(wrap(clause), "")}\n## Other\n${fenced ? `\`\`\`md\n${wrap(clause)}\n\`\`\`` : wrap(clause)}\n`,
              );
              expect(run().status).toBe(1);
              writeFileSync(file, text);
              expect(run().status).toBe(0);
            }
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      ),
      { seed: 325, numRuns: 4 },
    );
  });
});
