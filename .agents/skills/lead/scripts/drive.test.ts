// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pgrep.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./boxnode.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./codexexec.ts?raw";
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
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/BoxGit.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/BoxGitProcess.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/Remove.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/Runs.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./box/RunsProcess.ts?raw";
import "./keepruns.sh?raw";
import "./leakgrep.sh?raw";
import "./fieldrow.py?raw";
import "./runplan.sh?raw";
import "./env.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./boxfiles.ts?raw";
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
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gcloop.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./flow/Beat.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pr/Publish.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pr/PullRequestsGh.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pr/PushesProcess.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./publish.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pr/PullRequests.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pr/Pushes.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./pr/command.ts?raw";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@kampus/fabrika-old";
import { nameOf } from "@kampus/pipeline/stages/outcome";
import { Effect, Exit, Schema, Stream } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Answer, answerFor, NO_SPENT, sendsFrom } from "./agents.ts";
import {
  AGENT_CAP,
  agentCapFull,
  agentsDraft,
  agentTail,
  ownedHead,
  boxChanges,
  caseRenames,
  changedFiles,
  commitSubject,
  type MutboxRun,
  mutationDraft,
  mutboxAnswer,
  mutboxTail,
  mutationTail,
  relatedIn,
  commitsSaid,
  decide,
  dockerHolder,
  endName,
  FINISH,
  firstEventAt,
  freeLane,
  holdLane,
  holdsElectron,
  laneRunning,
  machine,
  NO_ESCALATION,
  phasesIn,
  reportOf,
  rowOf,
  runNames,
  startedOf,
  STEPS,
  tailFor,
} from "./drive.ts";
import { boxTree } from "./lane.ts";
import * as RunId from "./runid.ts";

// Today's tooling. The machine is pure and stepped by hand here; nothing runs an agent.
const options = { seed: 119120, numRuns: 300 };

const ask = {
  lane: "l",
  step: "build" as const,
  agent: "codex" as const,
  model: "gpt-6-astra",
  effort: "medium",
  ticket: "1",
  plan: "p",
  branch: "fabrikalfa/l",
  base: "b".repeat(40),
  root: "b".repeat(40),
  box: "l-build1",
  run: "r",
  prompt: "",
  report: "",
  events: "",
  err: "",
  minutes: 60,
  started: 0,
};

const answer = fc.constantFrom(
  "answer: done laws: green",
  "answer: send tests a law looks wrong",
  "answer: send plan",
  "answer: ask which version",
  "answer: skip no product file changed",
  "answer: stuck no network",
  "no answer at all",
);

const left = fc.array(fc.constantFrom("10 uncommitted files", "2 commits off fabrikalfa/l"), {
  maxLength: 2,
});

type Recorded = { keep: boolean; reason: string; plants?: unknown };

/** The record command the machine ends on, stepping through the backup push when it asks one. */
const recorded = (
  report: string,
  commits: number,
  held: readonly string[],
  typed: Answer | null = null,
  pushed = true,
) => {
  const value = {
    head: commits > 0 ? "c".repeat(40) : ask.base,
    commits,
    unsigned: [],
    exam: [],
    leaks: [],
    left: held,
    manifests: [],
    plancheck: null,
    changed: 0,
    report,
    problem: null,
  };
  const [read, cmds] = machine.update.step_read_ok({ phase: "reading", ask, answer: typed, spent: NO_SPENT }, {
    type: "step_read_ok",
    value,
  } as never);

  if (read.phase !== "pushing") {
    return { state: read, cmd: cmds[0] as Recorded };
  }

  const [state, after] = machine.update.backup_push_ok(read, {
    type: "backup_push_ok",
    value: { ok: pushed, detail: pushed ? "" : "rejected" },
  } as never);
  return { state, cmd: after[0] as Recorded };
};

describe("drive keeps a box that holds work, today's tooling", () => {
  // Plant: keep only a stuck box, as before. layers build2, 2026-11-09: a send back removed a box
  // with 10 uncommitted files (field note 2026-11-09-42).
  it("never removes a box with uncommitted or unpushed work, whatever the step answered", () => {
    fc.assert(
      fc.property(answer, fc.nat({ max: 2 }), left, (report, commits, held) => {
        const { state, cmd } = recorded(report, commits, held);
        expect(state.phase).toBe("recording");

        if (state.phase !== "recording") {
          return;
        }

        const stuck = state.outcome.kind === "stuck";
        expect(cmd.keep).toBe(stuck || held.length > 0);
        expect(state.kept).toBe(cmd.keep);

        // The outcome line's reason says what was kept.
        for (const message of held) {
          expect(cmd.reason).toContain(message);
        }

        if (held.length === 0) {
          expect(cmd.reason).not.toContain("box kept");
        }
      }),
      options,
    );
  });

  // 0093: the plants a step's typed answer names reach its record, so its field row, whatever the
  // outcome. Plants run once, both red: drop them on the backup push; drop them on a failed push.
  it("records the plants the typed answer names, through a push or a failed one, and none when it names none", () => {
    const plant = fc.record({ law: fc.string(), plant: fc.string(), result: fc.constantFrom("red", "green") });
    const typed = fc.record({
      verb: fc.constantFrom("done", "send", "ask", "skip", "stuck"),
      reason: fc.string(),
      plants: fc.option(fc.array(plant, { maxLength: 6 }), { nil: undefined }),
    });
    fc.assert(
      fc.property(typed, fc.nat({ max: 2 }), left, fc.boolean(), (said, commits, held, pushed) => {
        const to = said.verb === "send" ? "tests" : null;
        const { plants, ...rest } = said;
        const answer: Answer = { ...rest, to, laws: "a.test.ts", ...(plants && { plants }) };
        const { state, cmd } = recorded("", commits, held, answer, pushed);
        expect(state.phase).toBe("recording");
        expect(cmd.plants).toEqual(plants);
        expect("plants" in cmd).toBe(plants !== undefined);
      }),
      options,
    );
  });
});

describe("drive takes a skip answer, today's tooling", () => {
  const reason = fc.stringMatching(/^[a-z][a-z ]{0,30}[a-z]$/);
  const steps = fc.constantFrom("tests", "build", "mutation", "review") as fc.Arbitrary<
    "tests" | "build" | "mutation" | "review"
  >;
  const read = (step: "tests" | "build" | "mutation" | "review", report: string) =>
    machine.update.step_read_ok({ phase: "reading", ask: { ...ask, step }, answer: null, spent: NO_SPENT }, {
      type: "step_read_ok",
      value: {
        head: ask.base,
        commits: 0,
        unsigned: [],
        exam: [],
        leaks: [],
        left: [],
        manifests: [],
        plancheck: null,
        changed: 0,
        report,
        problem: null,
      },
    } as never);

  // Plant: drop skip from the answer line, so it reads as no_answer and is stuck (t374 mutation1,
  // 2026-11-09: "answer: skip no product file changed" was recorded as stuck:no_answer).
  it("a skip answer is a skip outcome with exit 40 and the step's why, and the box goes", () => {
    fc.assert(
      fc.property(steps, reason, fc.constantFrom("", "`", "**"), (step, text, wrap) => {
        const [s, cmds] = read(step, `report body\n\n${wrap}answer: skip ${text}${wrap}`);
        expect(s.phase).toBe("recording");

        if (s.phase !== "recording") {
          return;
        }

        expect(s.outcome).toEqual({ kind: "skip", why: "step_said" });
        expect(s.reason).toBe(text);
        expect(s.kept).toBe(false);
        const cmd = cmds[0] as { outcome: string; exit: number; keep: boolean };
        expect(cmd.outcome).toBe("skip:step_said");
        expect(cmd.exit).toBe(40);
        expect(cmd.keep).toBe(false);
      }),
      options,
    );
  });

  // Plant: map skip to stopped, so box.sh's review order check refuses a skipped mutation step.
  it("a skip's field row says skip, and no other outcome's does", () => {
    const names = [
      "done",
      "send:tests:exam_paths",
      "send:build:step_said",
      "ask:lead:question",
      "skip:step_said",
      "stuck:no_answer",
      "stuck:record_failed",
    ];

    for (const name of names) {
      const want = { done: "pass", send: "fail", ask: "parked", skip: "skip" }[name.split(":")[0] as "done"];
      expect(rowOf(name)).toBe(want ?? "stopped");
    }

    expect(names.filter((n) => rowOf(n) === "skip")).toEqual(["skip:step_said"]);
  });

  // Plant: give skip the stuck code. Each verb keeps an exit code of its own.
  it("each answer verb gets its own exit code", () => {
    const exits = new Map<string, number>();

    for (const line of [
      "answer: done",
      "answer: send tests x",
      "answer: send build x",
      "answer: send plan x",
      "answer: ask x",
      "answer: skip x",
      "answer: stuck x",
    ]) {
      // A review's done also needs its merge-ready verdict line (ticket 557), so this reads a mutation step.
      const [, cmds] = read("mutation", line);
      exits.set(line, (cmds[0] as { exit: number }).exit);
    }

    expect(new Set(exits.values()).size).toBe(exits.size);
    expect(exits.get("answer: skip x")).toBe(40);
    expect(exits.get("answer: stuck x")).toBe(30);
  });
});

describe("T557 drive reads exactly one answer line, today's tooling", () => {
  // The edge cases of the reading, each generated below: no answer line, two or more, one that names
  // no verb, marks around the line (` and **), upper case, a line inside a code fence, a fence that
  // never closes, and a review whose verdict line is not merge-ready.
  type Step = "mutation" | "review";
  const steps = fc.constantFrom<Step>("mutation", "review");
  const reason = fc.stringMatching(/^[a-z][a-z ]{0,20}[a-z]$/);
  const wrap = fc.constantFrom("", "`", "**");
  const spell = fc.constantFrom(
    (l: string) => l,
    (l: string) => l.toUpperCase(),
  );
  const readable = fc.constantFrom(
    ["done", "done"],
    ["send tests", "send:tests:step_said"],
    ["send build", "send:build:step_said"],
    ["send plan", "send:plan:step_said"],
    ["ask", "ask:lead:question"],
    ["skip", "skip:step_said"],
    ["stuck", "stuck:step_said"],
  );
  const line = fc.oneof(
    {
      arbitrary: fc.tuple(readable, reason).map(([[verb, name], text]) => ({ text: `answer: ${verb} ${text}`, name })),
      weight: 4,
    },
    {
      arbitrary: fc
        .constantFrom("answer:", "answer: maybe", "answer: finished", "answer: send review x", "answer: merge-ready")
        .map((text) => ({ text, name: null })),
      weight: 1,
    },
  );
  const lines = fc.array(fc.tuple(line, wrap, spell), { maxLength: 4 });
  const ready = fc.constantFrom(
    "merge-ready; findings: 0",
    "**merge-ready; findings: 2**",
    "# merge-ready; findings: 1",
  );
  const back = fc
    .tuple(fc.integer({ min: 1, max: 12 }), fc.nat({ max: 3 }), fc.constantFrom("", "**", "`", "# "))
    .map(([n, m, mark]) => `${mark}changes: ${n}; findings: ${m}${mark === "# " ? "" : mark}`);
  const verdict = fc.oneof(ready, back, fc.constantFrom("", "The review", "changes: 0; findings: 1"));
  const chatter = fc.constantFrom("", "what I checked", "the answer is below", "it says answer: done in the brief");

  const ended = (step: Step, report: string) => {
    const [state, cmds] = machine.update.step_read_ok(
      { phase: "reading", ask: { ...ask, step }, answer: null, spent: NO_SPENT },
      {
        type: "step_read_ok",
        value: {
          head: ask.base,
          commits: 0,
          unsigned: [],
          exam: [],
          leaks: [],
          left: [],
          manifests: [],
          plancheck: null,
          report,
          problem: null,
        },
      } as never,
    );
    expect(state.phase).toBe("recording");
    return cmds[0] as { outcome: string; exit: number; keep: boolean; reason: string };
  };

  const written = (first: string, said: readonly string[], between: string) =>
    [first, "report body", ...said.flatMap((l) => [between, l])].join("\n\n");

  // Plants: take the last answer line again; take the first; let a line with no known verb fall
  // through to an older line; let a review's verdict line stand in for a missing answer line; drop
  // the verdict check on a review's done. p16b review7, 2026-11-10 (finding 2026-11-10-f28).
  it("the step's own outcome needs exactly one answer line that reads; any other count is stuck:no_answer", () => {
    fc.assert(
      fc.property(steps, verdict, lines, chatter, (step, first, said, between) => {
        const texts = said.map(([l, w, f]) => `${w}${f(l.text)}${w}`);
        const cmd = ended(step, written(first, texts, between));
        const one = said.length === 1 ? said[0]![0].name : null;
        const sentBack = step === "review" && !/merge-ready/.test(first);

        if (one === null || (one === "done" && sentBack)) {
          expect(cmd.outcome).toBe("stuck:no_answer");
          expect(cmd.exit).toBe(30);
          expect(cmd.keep).toBe(true);
        } else {
          expect(cmd.outcome).toBe(one);
        }

        expect(cmd.outcome === "done").toBe(one === "done" && !sentBack);
      }),
      options,
    );
  });

  // Plants: read only the first line for the verdict; count `changes: 0` only; skip the check when
  // the one answer line says done.
  it("a review with a changes: n line, n above 0, is never done, whatever its answer lines say", () => {
    fc.assert(
      fc.property(back, lines, fc.boolean(), fc.option(ready, { nil: "" }), (sent, said, top, other) => {
        const texts = said.map(([l, w, f]) => `${w}${f(l.text)}${w}`);
        const report = top ? written(sent, texts, other) : written(other, texts, sent);
        expect(ended("review", report).outcome).not.toBe("done");
      }),
      options,
    );
  });

  // Plant: count the lines inside a code fence. A plan or a report quotes code with an `answer:`
  // field, and drive's own prompt lists six answer lines.
  it("an answer line inside a code fence is not the step's answer, and a fence left open hides the rest", () => {
    fc.assert(
      fc.property(
        steps,
        lines,
        line,
        fc.constantFrom("```", "~~~", "```ts"),
        fc.boolean(),
        (step, quoted, own, fence, closed) => {
          const block = [
            fence,
            ...quoted.map(([l]) => l.text),
            "\tanswer: Schema.Json,",
            closed ? fence.slice(0, 3) : "",
          ];
          const cmd = ended(step, ["merge-ready; findings: 0", ...block, own.text].join("\n"));
          expect(cmd.outcome).toBe(closed && own.name !== null ? own.name : "stuck:no_answer");
        },
      ),
      options,
    );
  });

  // Plant: guard only the line answer's done, so a typed done skips the verdict check (PR 691's
  // typed answer comes first).
  it("a review's typed done is done only under a merge-ready verdict, whatever its answer lines say", () => {
    fc.assert(
      fc.property(verdict, lines, chatter, (first, said, between) => {
        const texts = said.map(([l, w, f]) => `${w}${f(l.text)}${w}`);
        const read = {
          head: ask.base,
          commits: 0,
          unsigned: [],
          exam: [],
          leaks: [],
          left: [],
          manifests: [],
          plancheck: null,
          changed: 0,
          report: written(first, texts, between),
          problem: null,
        };
        const judged = decide({ ...ask, step: "review" }, read, { verb: "done", to: null, reason: "", laws: null });
        const ready = /merge-ready/.test(first);
        expect(nameOf(judged.outcome)).toBe(ready ? "done" : "stuck:no_answer");
      }),
      options,
    );
  });

  it("pinned: p16b review7's two answer lines under changes: 1 are stuck, not done (2026-11-10)", () => {
    const report = [
      "changes: 1; tickets: 2",
      "",
      "One thing blocks.",
      "",
      "answer: send tests the rule misses two cases",
      "answer: done",
    ].join("\n");
    const cmd = ended("review", report);
    expect(cmd.outcome).toBe("stuck:no_answer");
    expect(cmd.exit).toBe(30);
    expect(cmd.reason).toContain("2 answer lines");
  });
});

describe("T428 a start check's no is a refusal, not a stuck step, today's tooling", () => {
  const checks = ["plan_unapproved", "base_not_signed", "shared_ticket", "root_not_ancestor"] as const;
  const check = fc.constantFrom(...checks);
  const detail = fc.stringMatching(/^[a-z0-9](?:[a-z0-9 /|.-]{0,40}[a-z0-9])?$/);
  const noise = fc.array(fc.stringMatching(/^[a-z ]{0,20}$/), { maxLength: 3 });
  const boxNewOk = (value: ReturnType<typeof startedOf>) =>
    machine.update.box_new_ok({ phase: "starting", ask: { ...ask, step: "tests" } }, {
      type: "box_new_ok",
      value,
    } as never);

  // Plants: read any non-zero exit as a refusal; take a check name box.sh never prints; drop the
  // detail. 28 of 72 stuck results on 2026-11-09 were box.sh new saying no before any agent ran.
  it("box.sh new's exit 3 with a refused line names the check; any other failure is the box failing", () => {
    fc.assert(
      fc.property(check, detail, noise, fc.constantFrom(0, 1, 2, 3, 127), (c, d, before, code) => {
        const err = [...before, `refused ${c}: ${d}`, ""].join("\n");
        const got = startedOf(code, err);

        if (code === 0) {
          expect(got).toEqual({ _tag: "made" });
        } else if (code === 3) {
          expect(got).toEqual({ _tag: "refused", check: c, detail: d });
        } else {
          expect(got._tag).toBe("failed");
        }

        // A stuck line, or an unknown check, is never a refusal.
        expect(startedOf(3, `stuck ${c}: ${d}\n`)._tag).toBe("failed");
        expect(startedOf(3, `refused not_a_check_${c}: ${d}\n`)._tag).toBe("failed");
      }),
      options,
    );
  });

  // Plants: record a refusal as stuck:box_failed, give it the stuck exit, keep its box, or let it
  // move the lane's head. The stuck rate then counts steps no agent ran.
  it("a refusal ends at once as refused:<check>, exit 3, nothing kept, and never reads as stuck", () => {
    fc.assert(
      fc.property(check, detail, (c, d) => {
        const [state, cmds] = boxNewOk({ _tag: "refused", check: c, detail: d });
        expect(state.phase).toBe("recording");
        const cmd = cmds[0] as {
          outcome: string;
          exit: number;
          keep: boolean;
          reason: string;
        };
        expect(cmd.outcome).toBe(`refused:${c}`);
        expect(cmd.outcome.startsWith("stuck")).toBe(false);
        expect(cmd.exit).toBe(3);
        expect(cmd.keep).toBe(false);
        expect(cmd.reason).toBe(d);
        expect(rowOf(cmd.outcome)).not.toBe("pass");
      }),
      options,
    );
  });

  // Plant: let a refusal swallow a real box failure (a clone or install that broke).
  it("a box that failed to start is still stuck:box_failed and kept for the lead", () => {
    fc.assert(
      fc.property(detail, (d) => {
        const [, cmds] = boxNewOk({ _tag: "failed", detail: d });
        const cmd = cmds[0] as { outcome: string; exit: number; keep: boolean };
        expect(cmd.outcome).toBe("stuck:box_failed");
        expect(cmd.exit).toBe(30);
        expect(cmd.keep).toBe(true);
      }),
      options,
    );
  });

  // Plant: give drive's own refusals and box.sh's checks names that clash with a step outcome.
  it("format: every refusal prints as refused:<check>, apart from the five step verbs", () => {
    for (const c of [...checks, "agent_cap", "low_disk", "branch_checked_out", "docker_busy"] as const) {
      const name = endName({ kind: "refused", check: c });
      expect(name).toBe(`refused:${c}`);
      expect(name.split(":")[0]).not.toMatch(/^(done|send|ask|skip|stuck)$/);
    }
  });
});

describe("the agent cap refuses a start once 12 agents run (0012), today's tooling", () => {
  // Plants: compare with > instead of >=; keep the old cap of 8.
  it("property: a start is refused exactly when the agents running reach AGENT_CAP", () => {
    fc.assert(
      fc.property(fc.nat({ max: 40 }), (agents) => {
        expect(agentCapFull(agents)).toBe(agents >= AGENT_CAP);
      }),
      options,
    );
  });

  it("pinned: the cap is 12, decision 0012's at most 12 code agents at once", () => {
    expect(AGENT_CAP).toBe(12);
    expect(agentCapFull(11)).toBe(false);
    expect(agentCapFull(12)).toBe(true);
  });
});

describe("T566 a mutation step while another Docker box runs is refused before its box, today's tooling", () => {
  const pid = fc.integer({ min: 1, max: 99_999 });
  const lock = fc.oneof(
    pid.map(String),
    pid.map((n) => ` ${n}\n`),
    fc.constantFrom("", "abc", "-4", "0", "1.5"),
  );

  // Plants: count a dead run's lock as busy; count an absent or garbled lock as busy; drop the pid.
  it("property: busy exactly when the lock names a positive pid that is alive, and it names that pid", () => {
    fc.assert(
      fc.property(fc.option(lock, { nil: null }), fc.boolean(), (text, alive) => {
        const asked: number[] = [];
        const holder = dockerHolder(text, (p) => {
          asked.push(p);
          return alive;
        });
        const n = Number(text?.trim());
        const named = text !== null && Number.isInteger(n) && n > 0;
        expect(holder).toBe(named && alive ? n : null);
        expect(asked).toEqual(named ? [n] : []);
      }),
      options,
    );
  });

  it("scenario: layout-mutation3 on 2026-11-10, pid 97351 alive, is refused:docker_busy", () => {
    expect(dockerHolder("97351", () => true)).toBe(97351);
    expect(endName({ kind: "refused", check: "docker_busy" })).toBe("refused:docker_busy");
  });
});

describe("T569 a review reads the lane's newest mutation report in its prompt, today's tooling", () => {
  const stepName = fc.constantFrom("plan", "tests", "build", "mutation", "review");
  const path = fc.stringMatching(/^\/b\/[a-z0-9]{1,6}\.md$/);
  const row = fc.record({ step: stepName, report: fc.option(path, { nil: null }) });

  // Plants: give it to every step; take the oldest mutation; drop the text; say nothing when none.
  it("property: only a review gets it, the newest mutation row's report whole, else a plain note", () => {
    fc.assert(
      fc.property(stepName, fc.array(row, { maxLength: 8 }), fc.boolean(), (step, steps, readable) => {
        const text = (p: string) => `report of ${p}`;
        const tail = mutationTail(step, steps, (p) => (readable ? text(p) : null));
        const newest = steps.filter((s) => s.step === "mutation" && s.report !== null).at(-1);

        const whole = step === "review" && newest?.report !== undefined && newest.report !== null && readable;
        expect(tail === "").toBe(step !== "review");
        expect(tail.includes(text(newest?.report ?? "none"))).toBe(whole);
        expect(tail.includes("cannot read outside itself")).toBe(whole);
        expect(tail.includes("no mutation report")).toBe(step === "review" && !whole);
      }),
      options,
    );
  });

  it("scenario: p34w-review1 on 2026-11-10 gets ../p34w-mutation3.md's text, not mutation2's", () => {
    const steps = [
      { step: "mutation", report: "/b/p34w-mutation2.md" },
      { step: "mutation", report: "/b/p34w-mutation3.md" },
      { step: "tests", report: "/b/p34w-tests10.md" },
    ];
    const tail = mutationTail("review", steps, (p) => `text of ${p}`);
    expect(tail).toContain("text of /b/p34w-mutation3.md");
    expect(tail).not.toContain("mutation2");
  });
});

describe("T429 drive names the commits check's rule and commit, today's tooling", () => {
  const rule = fc.constantFrom("unsigned_commit", "build_touched_exam", "broken_chain", "stale_link");
  const answer = fc.record({
    reason: rule,
    sha: fc.stringMatching(/^[0-9a-f]{40}$/),
    step: fc.option(fc.constantFrom("tests", "build", "lead"), { nil: undefined }),
  });
  const lane = new Set(["tests", "build"]);
  const held = (a: { reason: string; step: string | undefined }) =>
    !(a.reason === "stale_link" && !(a.step !== undefined && lane.has(a.step)));

  // Plants: print only the last lines of JSON; drop the commit; name a waived stale link.
  it("each held answer is named as rule, commit and step, and a waived stale link is not", () => {
    fc.assert(
      fc.property(fc.array(answer, { minLength: 1, maxLength: 7 }), (answers) => {
        const out = answers.map((a) => JSON.stringify({ _tag: "stuck", ...a })).join("\n");
        const said = commitsSaid({ code: 1, out, err: "commits: stuck ..." }, lane);
        const named = answers
          .filter(held)
          .map((a) => `${a.reason} ${a.sha.slice(0, 8)}${a.step ? ` step ${a.step}` : ""}`);

        if (named.length === 0) {
          expect(said).toMatch(/^commits check exit 1: /);
          return;
        }

        const more = named.length > 5 ? `; and ${named.length - 5} more` : "";
        expect(said).toBe(`commits check: ${named.slice(0, 5).join("; ")}${more}`);
      }),
      options,
    );
  });
});

describe("drive asks the lead for the lockfile, today's tooling", () => {
  const read = (report: string, manifests: readonly string[]) =>
    machine.update.step_read_ok({ phase: "reading", ask, answer: null, spent: NO_SPENT }, {
      type: "step_read_ok",
      value: {
        head: "c".repeat(40),
        commits: 1,
        unsigned: [],
        exam: [],
        leaks: [],
        left: [],
        manifests,
        plancheck: null,
        changed: 0,
        report,
        problem: null,
      },
    } as never)[0];
  const manifest = fc.constantFrom("package.json", "apps/fabrika/package.json", "pnpm-workspace.yaml");

  // Plant: trust the step's own answer. themes build2 (ticket 385): a box could not refresh the
  // lockfile, answered send tests, and the lane looped build -> tests -> build.
  it("a lockfile left behind is an ask for the lead, whatever the step answered, and names each manifest", () => {
    fc.assert(
      fc.property(answer, fc.uniqueArray(manifest, { minLength: 1 }), (report, paths) => {
        const s = read(report, paths);
        expect(s.phase).toBe("pushing");

        if (s.phase !== "pushing") {
          return;
        }

        // oxlint-disable-next-line eslint/id-denylist -- today's outcome keeps its who key until that shape changes (0081)
        expect(s.outcome).toEqual({ kind: "ask", who: "lead", for: "lockfile" });

        for (const p of paths) {
          expect(s.reason).toContain(p);
        }

        expect(s.reason).toContain("fabrikalfa/l-wip");
      }),
      options,
    );
  });

  // Plant: ask on every step. With nothing behind, the step's own answer decides as before.
  it("with no manifest behind, no answer becomes a lockfile ask", () => {
    fc.assert(
      fc.property(answer, (report) => {
        const s = read(report, []);
        expect(["pushing", "recording"]).toContain(s.phase);
        const outcome = s.phase === "pushing" || s.phase === "recording" ? s.outcome : null;
        // oxlint-disable-next-line eslint/id-denylist -- today's outcome keeps its who key until that shape changes (0081)
        expect(outcome).not.toEqual({ kind: "ask", who: "lead", for: "lockfile" });
      }),
      options,
    );
  });
});

describe("the box's changes are read from its status, today's tooling", () => {
  it("each NUL-ended status entry is one file with its letters, so a deleted one is told apart", () => {
    const out = " M a.ts\0?? b/c.ts\0 D gone.ts\0";
    expect(changedFiles(out)).toEqual([
      { xy: " M", path: "a.ts" },
      { xy: "??", path: "b/c.ts" },
      { xy: " D", path: "gone.ts" },
    ]);
    expect(changedFiles("")).toEqual([]);
  });

  it("a review that left a changed file is stuck:review_committed, whatever it answered", () => {
    fc.assert(
      fc.property(answer, fc.integer({ min: 1, max: 9 }), (report, changed) => {
        const read = {
          head: ask.base,
          commits: 0,
          unsigned: [],
          exam: [],
          leaks: [],
          left: [],
          manifests: [],
          plancheck: null,
          changed,
          report,
          problem: null,
        };
        const j = decide({ ...ask, step: "review" }, read);
        expect(nameOf(j.outcome)).toBe("stuck:review_committed");
      }),
      options,
    );
  });

  it("the typed answer wins over the report's answer line, and a build with no commit needs its laws", () => {
    const read = {
      head: ask.base,
      commits: 0,
      unsigned: [],
      exam: [],
      leaks: [],
      left: [],
      manifests: [],
      plancheck: null,
      changed: 0,
      report: "answer: stuck no network",
      problem: null,
    };
    expect(nameOf(decide(ask, read, { verb: "done", to: null, reason: "", laws: null }).outcome)).toBe(
      "stuck:no_commit",
    );
    expect(decide(ask, read, { verb: "done", to: null, reason: "", laws: "a.test.ts" }).outcome).toEqual({
      kind: "done",
      part: false,
      head: ask.base,
    });
    const sent = decide(ask, read, { verb: "send", to: "tests", reason: "a law", laws: null });
    expect(nameOf(sent.outcome)).toBe("send:tests:step_said");
    expect(sent.reason).toBe("a law");
    expect(nameOf(decide(ask, read).outcome)).toBe("stuck:step_said");
  });

  // Ticket 850: a review asked for plant records that already ran, the tests step answered them with
  // no file change, and the gate ended it stuck:no_commit until the budget stopped the lane
  // (acpcancel and sjob1, 2026-11-11). Plants run once, all red: drop the plants check (no plants
  // passes); drop the clean-tree check (changed files pass); keep the old stuck for every tests step.
  it("property: a tests step with no commit is done only when it names plants and left its tree clean", () => {
    const plant = fc.record({
      law: fc.constantFrom("L1", "L2", "A4"),
      plant: fc.string({ maxLength: 20 }),
      result: fc.constantFrom("red" as const, "green" as const),
    });
    fc.assert(
      fc.property(fc.array(plant, { maxLength: 4 }), fc.nat({ max: 3 }), (plants, changed) => {
        const read = {
          head: ask.base,
          commits: 0,
          unsigned: [],
          exam: [],
          leaks: [],
          left: [],
          manifests: [],
          plancheck: null,
          changed,
          report: "",
          problem: null,
        };
        const said: Answer = { verb: "done", to: null, reason: "the records", laws: null, plants };
        const j = decide({ ...ask, step: "tests" }, read, said);
        const records = plants.length > 0 && changed === 0;
        expect(nameOf(j.outcome)).toBe(records ? "done" : "stuck:no_commit");
        expect(j.reason.includes("the records")).toBe(records);
      }),
      options,
    );
  });
});

describe("T341 a step commit's subject says what the step did, today's tooling", () => {
  const text = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ,.]{0,100}[a-z]$/);
  const step = fc.constantFrom("tests", "build", "mutation") as fc.Arbitrary<"tests" | "build" | "mutation">;

  // The dry run of 2026-11-10 (ticket 522): a report that was the JSON answer alone gave the
  // subject "the step's work", which says nothing in the log.
  // Plants: skip the answer's reason; take the JSON line as the subject; let the subject run long.
  it("is the report's first prose line, else the answer's reason, on one line that names the ticket and step", () => {
    fc.assert(
      fc.property(text, text, step, fc.boolean(), (prose, reason, s, alone) => {
        const answer = JSON.stringify({ verb: "done", to: null, reason, laws: null });
        const subject = commitSubject(
          { ticket: "7", step: s },
          alone ? `${answer}\n` : `\n## ${prose}\n\nmore\n${answer}\n`,
        );
        expect(subject).toBe(`T7 ${s}: ${(alone ? reason : prose).slice(0, 72)}`);
        expect(subject).not.toContain("\n");
        expect(subject).not.toContain("{");
      }),
      options,
    );
  });

  it("pinned: a report with no prose and no answer still gets a subject", () => {
    // pinned: an agent that ended with nothing to say (the turn's report is empty).
    expect(commitSubject({ ticket: "7", step: "build" }, "")).toBe("T7 build: the step's work");
  });
});

describe("T341 drive reads what a box holds from outside it, today's tooling", () => {
  const root = mkdtempSync(join(tmpdir(), "drive-box-"));
  const env = { BOXES: root };
  const git = (...args: string[]) =>
    spawnSync(
      "git",
      [
        `--git-dir=${join(root, "b-gitdata")}`,
        `--work-tree=${boxTree(root, "b")}`,
        "-c",
        "user.email=t@example.com",
        "-c",
        "user.name=t",
        ...args,
      ],
      { encoding: "utf8" },
    );

  // scenario: a real box with its git data beside it, as box.sh new makes one. The agent cannot
  // commit any more, so the files it left are all the work a box holds, and each must be named for
  // collect to copy it. It takes over from the removed "counts edited and untracked files, and
  // commits the step's branch lacks", which read a real box the same way.
  // Plants: drop --untracked-files=all; read through the box's own `.git` file; call a box whose
  // data is gone a box with no changes.
  it("scenario: every edited, deleted and new file is named, a new folder file by file, whatever the box's `.git` file says", () => {
    const box = boxTree(root, "b");
    spawnSync("git", ["init", "-q", "--separate-git-dir", join(root, "b-gitdata"), box]);
    writeFileSync(join(box, "a.ts"), "1\n");
    writeFileSync(join(box, "gone.ts"), "1\n");
    git("add", "a.ts", "gone.ts");
    git("commit", "-q", "-m", "base");
    expect(boxChanges(env, "b")).toMatchObject({ code: 0, changes: [] });

    writeFileSync(join(box, "a.ts"), "2\n");
    rmSync(join(box, "gone.ts"));
    mkdirSync(join(box, "new", "deep"), { recursive: true });
    writeFileSync(join(box, "new", "deep", "c.ts"), "3\n");
    writeFileSync(join(box, "new", "d.ts"), "4\n");
    // The agent can rewrite this file; drive reads the data folder by name and never follows it.
    writeFileSync(join(box, ".git"), `gitdir: ${join(root, "nowhere")}\n`);
    const read = boxChanges(env, "b");
    expect(read.code).toBe(0);
    expect(read.changes.toSorted((x, y) => x.path.localeCompare(y.path))).toEqual([
      { xy: " M", path: "a.ts" },
      { xy: " D", path: "gone.ts" },
      { xy: "??", path: "new/d.ts" },
      { xy: "??", path: "new/deep/c.ts" },
    ]);

    // A box whose data cannot be read is a failed read, which drive keeps as stuck.
    const lost = boxChanges(env, "no-such-box");
    expect(lost.code).not.toBe(0);
    expect(lost.changes).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  // scenario: case-only renames, one with a text change and one without, as a move PR leaves
  // them (ticket 573). On a disk that ignores case, git status reads the first as a modified old
  // name and the second as nothing; on one that keeps case, as a delete and a new file. Either
  // way the new name must be named and the old one must not survive as a plain edit.
  // Plants: read only git status; take a file whose folder differs; name the old path as edited.
  it("scenario: a case-only rename is named by its new name, on a disk that ignores case or keeps it", () => {
    const top = mkdtempSync(join(tmpdir(), "drive-case-"));
    const box = boxTree(top, "c");
    const cgit = (...args: string[]) =>
      spawnSync(
        "git",
        [
          `--git-dir=${join(top, "c-gitdata")}`,
          `--work-tree=${box}`,
          "-c",
          "user.email=t@example.com",
          "-c",
          "user.name=t",
          ...args,
        ],
        { encoding: "utf8" },
      );
    spawnSync("git", ["init", "-q", "--separate-git-dir", join(top, "c-gitdata"), box]);
    mkdirSync(join(box, "src"));

    for (const f of ["src/id.ts", "src/answer.ts", "src/keep.ts"]) {
      writeFileSync(join(box, f), "1\n");
    }

    cgit("add", ".");
    cgit("commit", "-q", "-m", "base");
    // The agent's case-only renames: by a temporary name, as on a Mac.
    renameSync(join(box, "src/id.ts"), join(box, "src/tmp"));
    renameSync(join(box, "src/tmp"), join(box, "src/Id.ts"));
    writeFileSync(join(box, "src/Id.ts"), "2\n");
    renameSync(join(box, "src/answer.ts"), join(box, "src/tmp"));
    renameSync(join(box, "src/tmp"), join(box, "src/Answer.ts"));
    const ignoresCase = existsSync(join(box, "src/ID.TS"));
    const read = boxChanges({ BOXES: top }, "c");
    expect(read.code).toBe(0);
    const named = read.changes.map((c) => c.path);
    expect(named).toContain("src/Id.ts");
    expect(named).toContain("src/Answer.ts");
    expect(named).not.toContain("src/keep.ts");

    if (ignoresCase) {
      expect(read.changes.toSorted((x, y) => x.path.localeCompare(y.path))).toEqual([
        { xy: "R ", from: "src/answer.ts", path: "src/Answer.ts" },
        { xy: "R ", from: "src/id.ts", path: "src/Id.ts" },
      ]);
    } else {
      expect(
        read.changes
          .filter((c) => c.xy === " D")
          .map((c) => c.path)
          .toSorted(),
      ).toEqual(["src/answer.ts", "src/id.ts"]);
    }

    expect(caseRenames(box, ["src/keep.ts", "src/gone.ts"])).toEqual([]);
    rmSync(top, { recursive: true, force: true });
  });
});

describe("T341 a step's agent runs in its own box, on the row its step allows, today's tooling", () => {
  const dir = mkdtempSync(join(tmpdir(), "drive-row-"));
  const env = {
    MAIN: join(dir, "main"),
    BOXES: join(dir, "boxes"),
    GH_REPO: "",
    CODEX_MODEL: "",
    CODEX_EFFORT: "",
  };
  const prompt = join(dir, "prompt.md");
  writeFileSync(prompt, "do the step\nRELATED=a.test.ts\n");
  // A mutation step's container run, already done: it left its report and said so.
  const boxed: MutboxRun = (args) =>
    Effect.sync(() => {
      const out = args[args.indexOf("--out") + 1] ?? "";
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, "mutbox.json"), "{}\n");
      return { code: 0, out: JSON.stringify({ outcome: "done", reason: "", detail: "" }) };
    });
  const steps = fc.constantFrom("plan", "tests", "build", "mutation", "review") as fc.Arbitrary<
    "plan" | "tests" | "build" | "mutation" | "review"
  >;
  const agent = fc.constantFrom("codex", "claude") as fc.Arbitrary<"codex" | "claude">;
  const lane = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,20}$/);
  const drafted = (step: "plan" | "tests" | "build" | "mutation" | "review", agent: "codex" | "claude", box: string) =>
    Effect.gen(function* () {
      const rows = {
        codex: Agent.fakeAdapter(() => Agent.saying("done")),
        "codex-read": Agent.fakeAdapter(() => Agent.saying("done")),
        claude: Agent.fakeAdapter(() => Agent.saying("done")),
      };
      const agents = Agent.makeAgents({
        adapters: rows,
        sessions: Agent.memorySessions(),
        reaper: Agent.noReaper,
      });
      const sub = {
        deps: {
          ...ask,
          step,
          agent,
          box,
          prompt,
          events: join(dir, "events.jsonl"),
          report: join(dir, "report.md"),
        },
      };
      yield* Stream.runDrain(agentsDraft(env, agents, boxed)(sub as never));
      return rows;
    });

  // The harness closes everything beside the folder a turn names (packages/fabrika/src/agents/acp/
  // harness.test.ts, "the folder's siblings closed"), so the folder drive names is what keeps an
  // agent out of BOXES/state, the lock, the step keys and the other boxes. These take over from the
  // removed "never lets the box write the lock or anything else in BOXES/state" and "pinned: the
  // profile allows writes only to the box, its git data and the caches", which read drive's own
  // sandbox profile; drive has none now.
  // Plants: run every step in BOXES; run a plan in a box; run a review on the row that writes.
  it("a plan reads the main checkout and every other step works in its own box, never in a folder above it", () =>
    fc.assert(
      fc.asyncProperty(steps, agent, lane, fc.integer({ min: 1, max: 99 }), (step, agent, name, n) =>
        drafted(step, agent, `${name}-${step}${n}`).pipe(
          Effect.tap((rows) =>
            Effect.sync(() => {
              const started = Object.values(rows).flatMap((row) => row.seen.started);
              expect(started.length).toBe(1);
              const folder = started[0]?.folder ?? "";
              expect(folder).toBe(step === "plan" ? env.MAIN : boxTree(env.BOXES, `${name}-${step}${n}`));
              expect(env.BOXES.startsWith(folder)).toBe(false);
              expect(folder.startsWith(join(env.BOXES, "state"))).toBe(false);
            }),
          ),
          Effect.asVoid,
          Effect.runPromise,
        ),
      ),
      options,
    ));

  it("on Codex a plan and a review start on the row that only reads, and a Claude step never starts on a Codex row", () =>
    fc.assert(
      fc.asyncProperty(steps, agent, lane, (step, agent, name) =>
        drafted(step, agent, `${name}-${step}1`).pipe(
          Effect.tap((rows) =>
            Effect.sync(() => {
              const count = (row: keyof typeof rows) => rows[row].seen.started.length;

              if (step === "plan" || step === "review") {
                expect(count("codex")).toBe(0);
              }

              expect(count("claude")).toBe(agent === "claude" ? 1 : 0);
              expect(count("codex") + count("codex-read")).toBe(agent === "codex" ? 1 : 0);
            }),
          ),
          Effect.asVoid,
          Effect.runPromise,
        ),
      ),
      options,
    ));
});

describe("T383 drive never passes off an older run's report, today's tooling", () => {
  // Plants: count only the box folders; reuse the highest number taken. p12 review5, 2026-11-09: box.sh refused the run, and drive returned p12-review5.md from
  // 2026-11-08, written for another head, as the step's report (field note 2026-11-09-205).
  it("property: the next run id is held by no file an older run of that lane and step left", () => {
    const left = fc.array(fc.tuple(fc.integer({ min: 1, max: 6 }), fc.constantFrom(...RunId.FILES)));
    fc.assert(
      fc.property(fc.constantFrom("plan", "review", "build"), left, (step, files) => {
        const taken = new Set(files.map(([i, suffix]) => `p12-${step}${i}${suffix}`));
        const box = RunId.next("p12", step, taken);

        for (const suffix of RunId.FILES) {
          expect(taken.has(`${box}${suffix}`)).toBe(false);
        }
      }),
      options,
    );
  });

  // Plants: read only the boxes folder, so a tree under BOXES/box is missed and its id taken again.
  it("scenario: a box's tree under BOXES/box holds its run id, beside the files in the boxes folder", () => {
    const boxes = mkdtempSync(join(tmpdir(), "drive-names-"));
    const empty = RunId.next("p12", "build", runNames(boxes, "p12"));
    mkdirSync(boxTree(boxes, "p12-build2"), { recursive: true });
    writeFileSync(join(boxes, "p12-build1.md"), "old\n");
    const next = RunId.next("p12", "build", runNames(boxes, "p12"));
    rmSync(boxes, { recursive: true, force: true });
    expect(empty).toBe("p12-build1");
    expect(next).toBe("p12-build3");
  });

  // Plants: return the path whenever the file exists; compare to the ms without the whole second.
  it("gives a report only when this run wrote it, never one from before its start", () => {
    const started = fc.integer({ min: 1_000_000, max: 2_000_000_000_000 });
    const mtime = fc.option(fc.integer({ min: -10_000_000, max: 10_000_000 }), { nil: null });
    fc.assert(
      fc.property(started, mtime, (at, offset) => {
        const written = offset === null ? null : at + offset;
        const got = reportOf("r.md", at, written);
        const second = Math.floor(at / 1000) * 1000;
        expect(got).toBe(written !== null && written >= second ? "r.md" : null);

        if (written !== null && written >= at) {
          expect(got).toBe("r.md");
        }

        if (written !== null && written < second) {
          expect(got).toBeNull();
        }
      }),
      options,
    );
  });
});

describe("T388 drive accepts a step once its backup push lands, today's tooling", () => {
  // Plants: a landed push still recorded stuck; the head left at the base; a refused push accepted.
  // ci375 build, 2026-11-09: a signed, green build came back stuck:push_failed on a notes race
  // that botpush now retries once, so the push result alone decides the step.
  it("records the step's own answer at the pushed head, and stuck:push_failed when refused", () => {
    fc.assert(
      fc.property(answer, fc.integer({ min: 1, max: 3 }), fc.boolean(), (report, commits, landed) => {
        const value = {
          head: "c".repeat(40),
          commits,
          unsigned: [],
          exam: [],
          leaks: [],
          left: [],
          manifests: [],
          plancheck: null,
          changed: 0,
          report,
          problem: null,
        };
        const [read] = machine.update.step_read_ok({ phase: "reading", ask, answer: null, spent: NO_SPENT }, {
          type: "step_read_ok",
          value,
        } as never);

        // A stuck answer is never pushed.
        if (read.phase !== "pushing") {
          expect(read.phase === "recording" && read.outcome.kind).toBe("stuck");
          return;
        }

        const [state, cmds] = machine.update.backup_push_ok(read, {
          type: "backup_push_ok",
          value: { ok: landed, detail: landed ? "pushed" : "botpush: push refused" },
        } as never);
        const cmd = cmds[0] as { outcome: string; head: string };
        expect(state.phase).toBe("recording");
        expect(cmd.head).toBe(value.head);

        if (landed) {
          expect(cmd.outcome).toBe(nameOf(read.outcome));
        } else {
          expect(cmd.outcome).toBe("stuck:push_failed");
        }
      }),
      options,
    );
  });
});

describe("a step is told its owned paths first, today's tooling (ticket 430)", () => {
  const steps = fc.constantFrom("plan", "tests", "build", "mutation", "review") as fc.Arbitrary<
    "plan" | "tests" | "build" | "mutation" | "review"
  >;
  const owner = fc.constantFrom("tests", "build", "mutation", "lead");
  const owners = fc.dictionary(fc.stringMatching(/^[a-z]{1,6}\/[a-z]{1,6}\.ts$/), owner, { maxKeys: 6 });

  // Plants: list a path another step owns, drop one this step owns, keep mutation off tests' paths,
  // or tell a plan or review step anything.
  it("property: lists exactly the paths stepcommit lets the step commit, and asks for any other", () => {
    fc.assert(
      fc.property(steps, owners, (step, given) => {
        const head = ownedHead(step, given);

        if (step === "plan" || step === "review") {
          expect(head).toBe("");
          return;
        }

        const listed = [...head.matchAll(/^- (\S+)$/gm)].map((m) => m[1]);
        const allowed = Object.keys(given).filter(
          (p) => given[p] === step || (step === "mutation" && given[p] === "tests"),
        );
        expect(listed).toEqual(allowed.toSorted());
        expect(head).toContain("answer ask");
        expect(head.endsWith("---\n\n")).toBe(true);
      }),
      options,
    );
  });

  it("scenario: no plan drive can read tells the step nothing", () => {
    expect(ownedHead("build", null)).toBe("");
  });
});

// 2026-11-11: a tests step on Codex answered send tests round after round, listing as unfinished
// what no tests box can do. Plants: offer a step its own name; keep the static tests | build | plan
// tail; leave the finish rule out of a boxed step's prompt.
describe("a step is never offered itself as a send's to, today's tooling", () => {
  const steps = fc.constantFrom(...STEPS);

  it("property: the tail and the answer schema offer every send target but the step itself", () => {
    fc.assert(
      fc.property(steps, (step) => {
        const offered = ["tests", "build", "plan"].filter((to) => to !== step);
        expect(sendsFrom(step)).toEqual(offered);
        expect(tailFor(step)).toContain(`  to:   ${offered.join(" | ")} when the verb is send, else null`);
        const decode = Schema.decodeUnknownExit(answerFor(step));
        const answer = (to: string) => ({ verb: "send", to, reason: "r", laws: null });
        expect(Exit.isFailure(decode(answer(step)))).toBe(true);

        for (const to of offered) {
          expect(Exit.isSuccess(decode(answer(to)))).toBe(true);
        }
      }),
      options,
    );
  });

  it("property: every boxed step's prompt carries the finish rule, and the plan's does not", () => {
    fc.assert(
      fc.property(steps, fc.boolean(), (step, electron) => {
        expect(agentTail({ step, ticket: "1" }, electron).includes(FINISH)).toBe(step !== "plan");
      }),
      options,
    );
    expect(FINISH).toContain('"after build" or "lead runs it"');
    expect(FINISH).toContain("does not block `done`");
    expect(FINISH).toContain("never for work still to do");
  });

  // 2026-11-11: every Codex ask in the boxes folder ended its turn `cancelled`. Plant: leave the
  // rule out of any step's tail, the plan's included.
  it("property: every step's prompt, the plan's included, says never to ask to run outside the box", () => {
    fc.assert(
      fc.property(steps, fc.boolean(), (step, electron) => {
        expect(agentTail({ step, ticket: "1" }, electron).includes(NO_ESCALATION)).toBe(true);
      }),
      options,
    );
    expect(NO_ESCALATION).toContain("`require_escalated`");
    expect(NO_ESCALATION).toContain("ends your turn");
  });
});

describe("drive holds the Electron lock outside the box, today's tooling", () => {
  const steps = fc.constantFrom("plan", "tests", "build", "mutation", "review") as fc.Arbitrary<
    "plan" | "tests" | "build" | "mutation" | "review"
  >;

  it("holds it for mutation always, and for any other step only when started with --electron", () => {
    fc.assert(
      fc.property(steps, fc.boolean(), (step, flagged) => {
        expect(holdsElectron(step, flagged)).toBe(step === "mutation" || flagged);
      }),
      options,
    );
  });

  it("tells the agent the lock is held exactly when drive holds it", () => {
    fc.assert(
      fc.property(steps, fc.boolean(), (step, flagged) => {
        const told = agentTail({ step, ticket: "1" }, flagged).includes("state/electron.lock");
        expect(told).toBe(holdsElectron(step, flagged));
      }),
      options,
    );
  });

  it("scenario: --electron on a Codex box is refused before anything starts", () => {
    const dir = mkdtempSync(join(tmpdir(), "drive-electron-"));
    const brief = join(dir, "brief.md");
    writeFileSync(brief, "brief");
    const r = spawnSync(process.execPath, [join(import.meta.dirname, "drive.ts"), "l", "build", brief, "--electron"], {
      encoding: "utf8",
      env: { ...process.env, BOXES: join(dir, "boxes") },
    });
    rmSync(dir, { recursive: true, force: true });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--electron is for --agent claude");
  });
});

describe("one live process drives a lane, today's tooling", () => {
  // Plants: never read the lock's owner; keep a dead owner's lock; free a lock another holds.
  // p39s1, 2026-11-11: a second chain started 18 s after the first, and both took p39s1-tests2.
  it("scenario: the lane is taken, refused to a live owner, taken over from a dead one, freed only by its own", () => {
    const boxes = mkdtempSync(join(tmpdir(), "drive-lane-"));
    const lock = join(boxes, "state", "l.lock");
    const dead = spawnSync(process.execPath, ["-e", ""]).pid;
    const live = process.ppid;

    expect(holdLane(boxes, "l")).toBeNull();
    expect(readFileSync(lock, "utf8")).toBe(String(process.pid));
    expect(holdLane(boxes, "l")).toBeNull();
    writeFileSync(lock, String(live));
    expect(holdLane(boxes, "l")).toBe(live);
    freeLane(boxes, "l");
    expect(readFileSync(lock, "utf8")).toBe(String(live));
    writeFileSync(lock, String(dead));
    expect(holdLane(boxes, "l")).toBeNull();
    freeLane(boxes, "l");
    const gone = existsSync(lock);
    rmSync(boxes, { recursive: true, force: true });
    expect(gone).toBe(false);
  });

  it("scenario: a step started while another process drives its lane is refused before any box is made", () => {
    const dir = mkdtempSync(join(tmpdir(), "drive-lane-"));
    const boxes = join(dir, "boxes");
    const brief = join(dir, "brief.md");
    writeFileSync(brief, "brief");
    mkdirSync(join(boxes, "state"), { recursive: true });
    writeFileSync(join(boxes, "state", "l.lock"), String(process.pid));
    const r = spawnSync(process.execPath, [join(import.meta.dirname, "drive.ts"), "l", "tests", brief], {
      encoding: "utf8",
      env: { ...process.env, BOXES: boxes },
    });
    const made = readdirSync(boxes);
    const still = readFileSync(join(boxes, "state", "l.lock"), "utf8");
    rmSync(dir, { recursive: true, force: true });
    expect(r.status).toBe(3);
    expect(JSON.parse(r.stdout)).toMatchObject({
      outcome: "refused:lane_running",
      reason: laneRunning("l", process.pid),
    });
    expect(made).toEqual(["state"]);
    expect(still).toBe(String(process.pid));
  });
});

describe("drive runs a mutation step's Stryker in the container first, today's tooling", () => {
  const paths = fc.array(fc.stringMatching(/^[a-z]{1,8}(\/[a-z]{1,8}){0,2}\.test\.ts$/), {
    minLength: 1,
    maxLength: 3,
  });

  // Plant: read RELATED from the middle of a sentence, so prose that names it starts a run.
  it("the brief's related tests are one RELATED= line of its own, or none", () => {
    fc.assert(
      fc.property(paths, fc.constantFrom("", "Use the mutation skill.\n"), (tests, before) => {
        const line = `RELATED=${tests.join(",")}`;
        expect(relatedIn(`${before}${line}\nSeed 119120.\n`)).toBe(tests.join(","));
        expect(relatedIn(`${before}Set ${line} first.\n`)).toBeUndefined();
        expect(relatedIn(`${before}RELATED: ${tests.join(", ")}\n`)).toBeUndefined();
      }),
      options,
    );
  });

  // Plant: read a missing or broken answer as done, so the agent starts with no report.
  it("only mutbox's own done, skip or stuck line counts; anything else is stuck", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("done", "skip", "stuck"),
        fc.string(),
        fc.string(),
        fc.string(),
        (outcome, reason, detail, noise) => {
          const line = JSON.stringify({ outcome, reason, detail, ticket: "1" });
          expect(mutboxAnswer(`${noise.replaceAll("\n", " ")}\n${line}\n`).outcome).toBe(outcome);
          expect(mutboxAnswer(JSON.stringify({ outcome: "passed", reason, detail })).outcome).toBe("stuck");
          expect(mutboxAnswer(`${line}\nnot json`).outcome).toBe("stuck");
          expect(mutboxAnswer(line.slice(0, -1)).outcome).toBe("stuck");
          expect(mutboxAnswer("").outcome).toBe("stuck");
        },
      ),
      options,
    );
  });

  // Plant: leave the report's path out, or tell the agent to run Stryker itself.
  it("the agent is told where the report is, not to run Stryker, and when to answer skip", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\/[a-z/]{1,20}\.json$/), fc.boolean(), (report, skip) => {
        const told = mutboxTail(report, skip);
        expect(told).toContain(report);
        expect(told).toContain("Do not run Stryker");
        expect(told.includes("answer: skip")).toBe(skip);
      }),
      options,
    );
  });

  const dir = mkdtempSync(join(tmpdir(), "drive-mutation-"));
  const env = { MAIN: join(dir, "main"), BOXES: join(dir, "boxes"), GH_REPO: "", CODEX_MODEL: "", CODEX_EFFORT: "" };
  const sha = fc.stringMatching(/^[0-9a-f]{40}$/);
  const box = fc.stringMatching(/^[a-z0-9]{1,8}-mutation[1-9]$/);
  const text = fc.stringMatching(/^[A-Za-z0-9 _.,:-]{0,40}$/);
  const line = (outcome: string, reason: string, detail: string) => JSON.stringify({ outcome, reason, detail });
  // One mutation draft against a prompt file and a stand-in for mutbox.ts: what the turn ended as,
  // the agents it started, the command lines mutbox got and the report file the step left.
  const drafted = (
    mutbox: MutboxRun,
    name: string,
    brief: string,
    heads = { base: "b".repeat(40), root: "a".repeat(40) },
  ) =>
    Effect.gen(function* () {
      const row = Agent.fakeAdapter(() => Agent.saying("done"));
      const agents = Agent.makeAgents({
        adapters: { codex: row, "codex-read": row, claude: row },
        sessions: Agent.memorySessions(),
        reaper: Agent.noReaper,
      });
      const calls: ReadonlyArray<string>[] = [];
      const prompt = join(dir, `${name}-prompt.md`);
      const report = join(dir, `${name}.md`);
      mkdirSync(env.BOXES, { recursive: true });
      writeFileSync(prompt, brief);
      rmSync(report, { force: true });
      const turned = yield* mutationDraft((args) => {
        calls.push(args);
        return mutbox(args);
      })(env, agents, {
        ...ask,
        ...heads,
        step: "mutation",
        agent: "claude",
        box: name,
        prompt,
        report,
        events: join(dir, `${name}.jsonl`),
      });
      return {
        turned,
        started: row.seen.started,
        calls,
        report: existsSync(report) ? readFileSync(report, "utf8") : null,
        saved: readFileSync(prompt, "utf8"),
      };
    });
  // What the reads find after such a step: the box untouched, no commit, no report of an agent's.
  const readNothing = {
    head: ask.base,
    commits: 0,
    unsigned: [],
    exam: [],
    leaks: [],
    left: [],
    manifests: [],
    plancheck: null,
    changed: 0,
    report: "",
    problem: null,
  };
  const written = (out: string, summary: string) => {
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "mutbox.json"), summary);
  };

  // Decision 0045: Docker missing, a second Docker box or a failed run ends the step stuck, and the
  // sample never runs anywhere else. The report file is what the chain's judgment reads.
  // Plants: start the agent after a stuck run; trust exit 0 over a stuck line; read a run that
  // printed nothing as done; drop mutbox's own reason.
  it("a run that exits 30, says stuck or says nothing ends the step stuck with its reason, and no agent starts", () =>
    fc.assert(
      fc.asyncProperty(
        box,
        fc.constantFrom("docker_down", "docker_busy", "baseline_failed", "time_limit"),
        text,
        fc.constantFrom("line", "exit", "silent"),
        fc.constantFrom(0, 1, 30, 137),
        (name, reason, detail, method, exit) => {
          const said =
            method === "line"
              ? { code: exit, out: `noise\n${line("stuck", reason, detail)}\n` }
              : method === "exit"
                ? { code: 30, out: `${line("done", "", "")}\n` }
                : { code: exit, out: "not a line" };
          return drafted(
            (args) =>
              Effect.sync(() => {
                // Even with a report on disk, a stuck run hands nothing to an agent.
                written(args[args.indexOf("--out") + 1] ?? "", "{}\n");
                return said;
              }),
            name,
            "Use the mutation skill.\nRELATED=a.test.ts\n",
          ).pipe(
            Effect.tap((ran) =>
              Effect.sync(() => {
                expect(ran.started).toEqual([]);
                expect(ran.calls.length).toBe(1);
                expect(ran.turned._tag).toBe("ended");

                if (ran.turned._tag !== "ended") {
                  return;
                }

                expect(ran.turned.stop).toBe("end_turn");
                expect(ran.turned.spent).toEqual(NO_SPENT);
                expect(ran.turned.answer?.verb).toBe("stuck");
                expect(ran.turned.answer?.reason).toContain("mutbox");
                expect(ran.report).toContain(ran.turned.answer?.reason ?? "no reason");

                if (method === "line") {
                  expect(ran.turned.answer?.reason).toContain(reason);
                  expect(ran.turned.answer?.reason).toContain(detail);
                }

                expect(nameOf(decide({ ...ask, step: "mutation" }, readNothing, ran.turned.answer).outcome)).toBe(
                  "stuck:step_said",
                );
              }),
            ),
            Effect.asVoid,
            Effect.runPromise,
          );
        },
      ),
      options,
    ));

  // `prepare` refuses such a brief first (the scenario below); the draft holds the same line, so a
  // brief changed after the start still cannot run the whole suite or start an agent with no report.
  // Plants: run mutbox with an empty --related; start the agent anyway.
  it("a brief with no RELATED= line of its own runs no container and starts no agent", () =>
    fc.assert(
      fc.asyncProperty(box, paths, fc.constantFrom("", "Set RELATED=", "RELATED: "), (name, tests, before) =>
        drafted(
          () => Effect.succeed({ code: 0, out: line("done", "", "") }),
          name,
          `Use the mutation skill.\n${before === "" ? "" : `${before}${tests.join(",")} first.\n`}`,
        ).pipe(
          Effect.tap((ran) =>
            Effect.sync(() => {
              expect(ran.calls).toEqual([]);
              expect(ran.started).toEqual([]);
              expect(ran.turned._tag === "ended" ? ran.turned.answer?.verb : null).toBe("stuck");
              expect(ran.report).toContain("RELATED=<paths>");
            }),
          ),
          Effect.asVoid,
          Effect.runPromise,
        ),
      ),
      options,
    ));

  // The agent's box reads nothing outside itself, so the report must ride in the prompt, whole.
  // Plants: hand the agent only the report's path; cut the report; lose the brief; run mutbox on
  // another commit or with other tests; leave the skip note out.
  it("a done or skip run starts one agent in the box, with the brief and the whole mutbox.json text in its prompt", () =>
    fc.assert(
      fc.asyncProperty(
        box,
        paths,
        sha,
        sha,
        fc.dictionary(fc.stringMatching(/^[a-z]{1,8}$/), text, { minKeys: 1, maxKeys: 6 }),
        fc.boolean(),
        (name, tests, base, root, summary, skip) => {
          const report = `${JSON.stringify({ outcome: skip ? "skip" : "done", ...summary })}\n`;
          const brief = `Use the mutation skill.\nRELATED=${tests.join(",")}\nSeed 119120.\n`;
          return drafted(
            (args) =>
              Effect.sync(() => {
                written(args[args.indexOf("--out") + 1] ?? "", report);
                return { code: skip ? 40 : 0, out: `${line(skip ? "skip" : "done", "", "")}\n` };
              }),
            name,
            brief,
            { base, root },
          ).pipe(
            Effect.tap((ran) =>
              Effect.sync(() => {
                const out = join(env.BOXES, `${name}-mutbox`);
                expect(ran.calls).toEqual([
                  [
                    "run",
                    "--checkout",
                    env.MAIN,
                    "--ticket",
                    ask.ticket,
                    "--build",
                    base,
                    "--base",
                    root,
                    "--related",
                    tests.join(","),
                    "--out",
                    out,
                    "--lock",
                    join(env.BOXES, "state", "docker.lock"),
                    "--plan",
                    ask.plan,
                  ],
                ]);
                expect(ran.started.length).toBe(1);
                expect(ran.started[0]?.folder).toBe(boxTree(env.BOXES, name));
                const prompt = ran.started[0]?.prompt ?? "";
                expect(prompt).toContain(brief);
                expect(prompt).toContain(report);
                expect(prompt).toContain("Do not run Stryker");
                expect(prompt.includes("answer: skip")).toBe(skip);
                expect(prompt.indexOf(brief)).toBeLessThan(prompt.indexOf(report));
                // What the agent was asked is kept: the saved prompt file holds the report too.
                expect(ran.saved).toContain(report);
                expect(prompt).toContain(ran.saved);
                expect(ran.turned._tag).toBe("ended");
              }),
            ),
            Effect.asVoid,
            Effect.runPromise,
          );
        },
      ),
      options,
    ));

  // scenario: a run that says done but left no report gives the agent nothing to read.
  // Plant: start the agent with an empty report.
  it("scenario: a done run with no mutbox.json is stuck, and no agent starts", () =>
    drafted(() => Effect.succeed({ code: 0, out: line("done", "", "") }), "gone-mutation1", "RELATED=a.test.ts\n").pipe(
      Effect.tap((ran) =>
        Effect.sync(() => {
          expect(ran.started).toEqual([]);
          expect(ran.turned._tag === "ended" ? ran.turned.answer?.verb : null).toBe("stuck");
          expect(ran.report).toContain("no report");
        }),
      ),
      Effect.asVoid,
      Effect.runPromise,
    ));

  // scenario: the real command line, since the refusal happens before any pure function.
  // Plant: start the agent when the brief names no related tests.
  it("scenario: a mutation step with no related tests is a usage error before anything starts", () => {
    const dir = mkdtempSync(join(tmpdir(), "drive-mutbox-"));
    const brief = join(dir, "brief.md");
    writeFileSync(brief, "Use the mutation skill. RELATED: a.test.ts\n");
    const r = spawnSync(
      process.execPath,
      [join(import.meta.dirname, "drive.ts"), "l", "mutation", brief, "--agent", "claude"],
      { encoding: "utf8", env: { ...process.env, BOXES: join(dir, "boxes") } },
    );
    rmSync(dir, { recursive: true, force: true });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("RELATED=<paths>");
  });
});

describe("T673 a step's start is timed, today's tooling", () => {
  // The start's sweep left with 0101: no start runs box.sh gc, so gcDue and its two laws went.
  // Plant: drop a phase line, reorder them, or read a line that only starts like one.
  it("T673 phasesIn reads every phase line box.sh prints, in order, and nothing else", () => {
    const name = fc.stringMatching(/^[a-z_]{1,12}$/);
    const noise = fc.constantFrom("", "refused shared_ticket: 1 on x", "phase Bad 1", "phase x 1 more", "stuck y");
    fc.assert(
      fc.property(fc.array(fc.tuple(name, fc.nat(), noise)), (parts) => {
        const text = parts.map(([n, ms, junk]) => `${junk}\nphase ${n} ${ms}`).join("\n");
        expect(phasesIn(text)).toEqual(parts.map(([n, ms]) => ({ name: n, ms })));
      }),
      options,
    );
  });

  // format: the first line of an agent's event log, as agents.ts writes it, or none.
  it("T673 format: firstEventAt reads the first event's time, and null from an empty or untimed log", () => {
    const line = '{"at":"2026-11-11T08:21:58.342Z","_tag":"started","session":"s"}';
    expect(firstEventAt(`${line}\n{"at":"2026-11-11T09:00:00.000Z"}\n`)).toBe(Date.parse("2026-11-11T08:21:58.342Z"));
    expect(firstEventAt("")).toBeNull();
    expect(firstEventAt("null\n")).toBeNull();
    expect(firstEventAt('{"_tag":"started"}\n')).toBeNull();
  });
});
