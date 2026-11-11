// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.ts?raw";
import "./mutbox-entry.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./mutbox.Dockerfile?raw";
import "../../mutation/scripts/run.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "../../mutation/scripts/sample.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./chain.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./agents.ts?raw";
import "./catchup.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./freshmain.ts?raw";
import "./box.sh?raw";
import "./keepruns.sh?raw";
import "./leakgrep.sh?raw";
import "./loosening.sh?raw";
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
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@kampus/fabrika-old";
import { Effect, Schema } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { Answer, listUsd, NO_SPENT, runTurn, type Spent, stepRow } from "./agents.ts";
import {
  backstopFrom,
  briefOf,
  type Budget,
  ChainRecord,
  estimateIn,
  type Limits,
  type Mark,
  markFrom,
  stopReason,
  roundsIn,
  exitOf,
  judgedOf,
  type Line,
  lineOf,
  looseningEnd,
  makeMachine,
  judgedMove,
  lacks,
  LANE_STEPS,
  moveFrom,
  moveOf,
  providers,
  RetriesExhausted,
  sectionsOf,
  slotRefusal,
  slotSchedule,
  STEPS,
  type StepName,
  stepsTable,
} from "./chain.ts";
import { FAULTS, faultFrom } from "./drive.ts";

// Today's tooling. The lane machine is pure and stepped by hand here; nothing runs an agent.
const options = { seed: 119120, numRuns: 300 };
// Every step the chain can start at, and the lane's own steps (0066: no mutation step).
const step = fc.constantFrom(...STEPS);
const laneStep = fc.constantFrom(...LANE_STEPS);
const sha = fc.stringMatching(/^[0-9a-f]{40}$/);
const word = fc.stringMatching(/^[a-z][a-z ]{0,30}[a-z]$/);

const outcome = fc.oneof(
  fc.constant("done"),
  fc.constant("skip:step_said"),
  fc.constantFrom("send:tests:step_said", "send:build:step_said", "send:tests:exam_paths", "send:mutation:step_said"),
  fc.constant("send:plan:plancheck"),
  fc.constantFrom("ask:lead:question", "ask:lead:lockfile"),
  fc.constantFrom("refused:agent_cap", "refused:low_disk"),
  fc.constantFrom("refused:plan_unapproved", "refused:shared_ticket", "refused:branch_checked_out"),
  fc.constantFrom("stuck:timeout", "stuck:no_answer", "stuck:crash", "stuck:fetch_failed"),
);

const line = (o: string, head: string, reason = "why", listUsd: number | null = null): Line => ({
  outcome: o,
  head,
  reason,
  fault: faultFrom(o, reason),
  report: null,
  box: "b",
  exit: 0,
  listUsd,
});

/** The machine's limits: 0076's intensity of 3 in 5, and a backstop only when one is given. */
const limits = (maxSteps: number, backstop: Budget | null = null, maxStucks = 3): Limits => ({
  maxSteps,
  maxStucks,
  intensity: { count: 3, within: 5 },
  backstop,
});

describe("T341 the chain's moves follow the five verbs, today's tooling", () => {
  // 0066: a lane's steps are tests -> build -> review; a mutation step (a lane started there)
  // hands to review. Plants: build hands to mutation; mutation hands to build; skip stops the walk.
  it("property: done walks tests -> build -> review -> open; a started mutation goes to review; skip walks the same way", () => {
    const walk: Record<StepName, string> = {
      tests: "build",
      build: "review",
      mutation: "review",
      review: "open",
    };
    fc.assert(
      fc.property(step, fc.constantFrom("done", "skip:step_said"), word, (s, o, why) => {
        const m = moveOf(s, line(o, "h", why), 0, 3);
        expect(m._tag === "step" ? m.step : m._tag).toBe(walk[s]);

        if (m._tag === "step") {
          expect(m.note).toBe("");
          expect(m.step).not.toBe("mutation");
        }
      }),
      options,
    );
  });

  it("property: a send goes to the lane step it names with the sender's word; a send to plan or mutation parks", () => {
    fc.assert(
      fc.property(step, laneStep, word, (from, to, why) => {
        const m = moveOf(from, line(`send:${to}:step_said`, "h", why), 0, 3);
        expect(m).toMatchObject({ _tag: "step", step: to });

        if (m._tag === "step") {
          expect(m.note).toContain(why);
        }

        expect(moveOf(from, line("send:plan:plancheck", "h", why), 0, 3)._tag).toBe("park");
        const toMutation = moveOf(from, line("send:mutation:step_said", "h", why), 0, 3);
        expect(toMutation._tag).toBe("park");

        if (toMutation._tag === "park") {
          expect(toMutation.reason).toContain(why);
        }
      }),
      options,
    );
  });

  it("a question goes to judgment, a lockfile ask parks with drive's own words", () => {
    fc.assert(
      fc.property(step, word, (s, why) => {
        expect(moveOf(s, line("ask:lead:question", "h", why), 0, 3)._tag).toBe("judge");
        const m = moveOf(s, line("ask:lead:lockfile", "h", why), 0, 3);
        expect(m).toEqual({ _tag: "park", reason: why });
      }),
      options,
    );
  });

  it("a slot refusal is the one outcome the schedule retries; any refusal that reaches the moves parks", () => {
    fc.assert(
      fc.property(step, outcome, (s, o) => {
        const [verb, check] = o.split(":");
        const slot = verb === "refused" && (check === "agent_cap" || check === "low_disk");
        expect(slotRefusal(o)).toBe(slot ? check : null);

        if (verb === "refused") {
          expect(moveOf(s, line(o, "h"), 0, 3)._tag).toBe("park");
        }
      }),
      options,
    );
  });

  it("the slot schedule is spaced by the wait, and running out is a typed RetriesExhausted", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 60 }), word, (minutes, why) => {
        expect(slotSchedule(minutes)).toBeDefined();
        const e = new RetriesExhausted({
          schedule: `slotSchedule(${minutes} minutes)`,
          times: 7,
          reason: why,
        });
        expect(e._tag).toBe("RetriesExhausted");
        expect(e.reason).toBe(why);
      }),
      options,
    );
  });

  it("a stuck goes to judgment until MaxStucks in a row on one step, then parks", () => {
    fc.assert(
      fc.property(step, fc.nat({ max: 6 }), fc.integer({ min: 1, max: 5 }), word, (s, stucks, max, why) => {
        const m = moveOf(s, line(`stuck:${why.replaceAll(" ", "_")}`, "h", why), stucks, max);
        expect(m._tag).toBe(stucks >= max ? "park" : "judge");
      }),
      options,
    );
  });

  it("every outcome has exactly one move, never a throw", () => {
    fc.assert(
      fc.property(step, outcome, fc.nat({ max: 4 }), fc.integer({ min: 1, max: 8 }), (s, o, stucks, max) => {
        const m = moveOf(s, line(o, "h"), stucks, max);
        expect(["step", "judge", "open", "park"]).toContain(m._tag);
      }),
      options,
    );
  });
});

describe("T341 the judgment agent's answer, today's tooling", () => {
  it("reads the last answer line: a send names a lane step and carries its note; park carries its why", () => {
    fc.assert(
      fc.property(laneStep, word, word, (s, note, chatter) => {
        const sent = judgedOf(`${chatter}\n\nanswer: send ${s} ${note}\n`);
        expect(sent).toMatchObject({ _tag: "step", step: s });

        if (sent._tag === "step") {
          expect(sent.note).toContain(note);
        }

        expect(judgedOf(`answer: send ${s} old\n${chatter}\nanswer: park ${note}`)).toEqual({
          _tag: "park",
          reason: note,
        });
      }),
      options,
    );
  });

  it("no answer line, or one naming a step that is not a lane step, parks", () => {
    expect(judgedOf("I think the build should run again").toString()).toBe(judgedOf("").toString());
    expect(judgedOf("answer: send plan fix it")._tag).toBe("park");
    expect(judgedOf("")._tag).toBe("park");
    // pinned: 0066, a lane has no mutation step, so an older answer that names one parks.
    expect(judgedOf("answer: send mutation rerun it")).toEqual({ _tag: "park", reason: "rerun it" });
  });
});

describe("T341 the lane brief is cut into one brief per step, today's tooling", () => {
  const laneBrief = [
    "Shared: ticket 7, today's tooling.",
    "## tests",
    "Write the laws.",
    "## build",
    "Make them green.",
    "## mutation",
    "Run stryker.",
    "## review",
    "Sweep.",
    "## pr",
    "# T7 the title",
    "What changed.",
  ].join("\n");

  it("each step gets the shared head, its own section, and the lane's facts", () => {
    fc.assert(
      fc.property(step, sha, sha, fc.nat({ max: 20 }), word, (s, head, root, round, note) => {
        const cut = sectionsOf(laneBrief);
        const text = briefOf(cut, s, {
          ticket: "7",
          branch: "fabrikalfa/x",
          plan: "p.md",
          root,
          head,
          round,
          heads: { tests: head },
          note,
        });
        expect(text).toContain("Shared: ticket 7");
        expect(text).toContain(cut.sections[s] ?? "nothing");

        for (const other of STEPS) {
          if (other !== s) {
            expect(text).not.toContain(cut.sections[other] ?? "nothing");
          }
        }

        expect(text).not.toContain("What changed.");
        expect(text).toContain(`round ${round}`);
        expect(text).toContain(`Last round: ${note}`);
        expect(text).toContain(head.slice(0, 8));

        // A review gets the two full SHAs its template needs; a mutation its build range.
        if (s === "review") {
          expect(text).toContain(`Reviewed head: fabrikalfa/x-wip at ${head}`);
          expect(text).toContain(`Parent base: origin/main at ${root}`);
        }

        if (s === "mutation") {
          expect(text).toContain("T=7, BUILD=");
        }
      }),
      options,
    );
  });

  it("format: the pr section's first line is the title; a heading's case does not matter", () => {
    const cut = sectionsOf(laneBrief.replace("## pr", "## PR"));
    expect(cut.sections.pr?.split("\n")[0]).toBe("# T7 the title");
    expect(Object.keys(cut.sections).toSorted()).toEqual([...STEPS, "pr"].toSorted());
  });

  // 0066: a brief needs no `## mutation`; an older one that has it is accepted. Plants: demand
  // every STEPS section; refuse a brief that has mutation; drop pr from the needed list.
  it("property: a brief lacks only what its start needs: lane steps and pr always, mutation only to start there", () => {
    const sections = fc.subarray([...STEPS, "pr"]);
    fc.assert(
      fc.property(sections, step, (have, start) => {
        const text = ["Shared.", ...have.flatMap((k) => [`## ${k}`, `body of ${k}`])].join("\n");
        const needed = [...LANE_STEPS, ...(start === "mutation" ? ["mutation"] : []), "pr"];
        expect(lacks(sectionsOf(text), start).toSorted()).toEqual(needed.filter((k) => !have.includes(k)).toSorted());
      }),
      options,
    );
    const withoutMutation = laneBrief.replace("## mutation\nRun stryker.\n", "");
    expect(sectionsOf(withoutMutation).sections.mutation).toBeUndefined();

    for (const start of LANE_STEPS) {
      expect(lacks(sectionsOf(withoutMutation), start)).toEqual([]);
      expect(lacks(sectionsOf(laneBrief), start)).toEqual([]);
    }

    expect(lacks(sectionsOf(withoutMutation), "mutation")).toEqual(["mutation"]);
  });
});

describe("T341 drive's last line is what the chain reads, today's tooling", () => {
  it("takes the last JSON line with an outcome, over gc chatter before it, and none is null", () => {
    fc.assert(
      fc.property(outcome, sha, word, fc.integer({ min: 0, max: 40 }), (o, head, reason, exit) => {
        const out = `keep box x: busy\n${JSON.stringify({ outcome: "plan-only" })}\n${JSON.stringify({ outcome: o, head, reason, report: null, box: "b", exit })}\n`;
        expect(lineOf(out, 1)).toEqual({
          outcome: o,
          head,
          reason,
          fault: faultFrom(o, reason),
          report: null,
          box: "b",
          exit,
          listUsd: null,
        });
        expect(lineOf("nothing here\n", 30)).toBeNull();
      }),
      options,
    );
  });
});

describe("T341 the lane machine, stepped by hand, today's tooling", () => {
  const machine = makeMachine(limits(16));
  const start = () => {
    const [idle] = machine.init(null, undefined);
    return machine.update.start(idle, { type: "start", step: "tests" });
  };
  const ran = (m: ReturnType<typeof start>[0], l: Line) =>
    machine.update.step_run_ok(m, { type: "step_run_ok", value: l } as never);

  it("scenario: a clean lane runs tests, build and review, opens the PR, runs loosening.sh and lands it, with exit 0", () => {
    let [m, cmds] = start();
    expect(cmds[0]).toMatchObject({ type: "step_run", step: "tests", round: 1 });
    const heads: string[] = [];

    for (const [i, s] of LANE_STEPS.entries()) {
      expect(m).toMatchObject({ phase: "stepping", step: s });
      const head = String(i + 1).repeat(40);
      heads.push(head);
      [m, cmds] = ran(m, line("done", head));
    }

    expect(m.phase).toBe("opening");
    expect(cmds[0]).toMatchObject({ type: "pr_open", head: heads[2] });
    [m, cmds] = machine.update.pr_open_ok(m, {
      type: "pr_open_ok",
      value: { pr: 42, detail: "opened" },
    } as never);
    expect(cmds[0]).toMatchObject({ type: "loosen", pr: 42, head: heads[2] });
    [m, cmds] = machine.update.loosen_ok(m, {
      type: "loosen_ok",
      value: { code: 0, text: "loosening: 0 hits in 0 exam files" },
    } as never);
    expect(cmds[0]).toMatchObject({ type: "land", pr: 42 });
    [m] = machine.update.land_ok(m, {
      type: "land_ok",
      value: { ok: true, detail: "merged" },
    } as never);
    expect(m.phase).toBe("over");

    if (m.phase === "over") {
      expect(m.end.kind).toBe("done");
      expect(exitOf(m.end)).toBe(0);
      expect(m.lane.heads).toEqual({
        tests: heads[0],
        build: heads[1],
        review: heads[2],
      });
    }
  });

  // 0066. Plants: route build's done to mutation; let a judgment or a send start mutation.
  it("property: no path from a lane started at tests, build or review ever runs mutation", () => {
    const answer = fc.oneof(
      outcome.map((o) => ({ _tag: "line" as const, o })),
      fc
        .constantFrom(
          "answer: send mutation rerun",
          JSON.stringify({ _tag: "step", step: "mutation", note: "rerun" }),
          "answer: send build fix",
          "answer: send review again",
        )
        .map((text) => ({ _tag: "judged" as const, text })),
    );
    fc.assert(
      fc.property(laneStep, fc.array(answer, { maxLength: 20 }), (first, answers) => {
        const [idle] = machine.init(null, undefined);
        let [m, cmds] = machine.update.start(idle, { type: "start", step: first });
        const started: string[] = cmds.flatMap((c) => (c.type === "step_run" ? [c.step] : []));

        for (const a of answers) {
          if (m.phase === "stepping" && a._tag === "line") {
            [m, cmds] = ran(m, line(a.o, "c".repeat(40)));
          } else if (m.phase === "judging" && a._tag === "judged") {
            [m, cmds] = machine.update.judge_ok(m, { type: "judge_ok", value: { text: a.text } } as never);
          } else {
            continue;
          }

          started.push(...cmds.flatMap((c) => (c.type === "step_run" ? [c.step] : [])));
          expect(m.phase === "stepping" || m.phase === "judging" ? m.step : "none").not.toBe("mutation");
        }

        expect(started).not.toContain("mutation");
      }),
      options,
    );
  });

  it("property: after a done build the lane runs review, whatever ran before", () => {
    fc.assert(
      fc.property(fc.constantFrom("tests", "build"), sha, (first, head) => {
        const [idle] = machine.init(null, undefined);
        let [m, cmds] = machine.update.start(idle, { type: "start", step: first });

        if (first === "tests") {
          [m, cmds] = ran(m, line("done", head));
        }

        expect(m).toMatchObject({ phase: "stepping", step: "build" });
        [m, cmds] = ran(m, line("done", head));
        expect(m).toMatchObject({ phase: "stepping", step: "review" });
        expect(cmds).toEqual([expect.objectContaining({ type: "step_run", step: "review" })]);
      }),
      options,
    );
  });

  // A lane parked inside its mutation step before 0066 is not stranded. Plants: refuse a mutation
  // start; send a started mutation's done to build; run mutation twice.
  it("property: a lane started at mutation runs that one step, then review", () => {
    fc.assert(
      fc.property(fc.constantFrom("done", "skip:step_said"), sha, (o, head) => {
        const [idle] = machine.init(null, undefined);
        let [m, cmds] = machine.update.start(idle, { type: "start", step: "mutation" });
        expect(cmds).toEqual([expect.objectContaining({ type: "step_run", step: "mutation", round: 1 })]);
        [m, cmds] = ran(m, line(o, head));
        expect(m).toMatchObject({ phase: "stepping", step: "review" });
        expect(cmds).toEqual([expect.objectContaining({ type: "step_run", step: "review", round: 2 })]);
        [m, cmds] = ran(m, line("done", head));
        expect(m.phase).toBe("opening");
      }),
      options,
    );
  });

  it("a send back reruns the named step with the sender's word in its note", () => {
    fc.assert(
      fc.property(laneStep, word, (to, why) => {
        let [m, cmds] = start();
        [m, cmds] = ran(m, line("done", "a".repeat(40)));
        [m, cmds] = ran(m, line(`send:${to}:step_said`, "b".repeat(40), why));
        expect(m).toMatchObject({ phase: "stepping", step: to });
        expect(cmds[0]).toMatchObject({ type: "step_run", step: to, round: 3 });

        if (cmds[0]?.type === "step_run") {
          expect(cmds[0].note).toContain(why);
        }
      }),
      options,
    );
  });

  it("a stuck asks for judgment; the judgment's send reruns that step, its park ends as ask (exit 20)", () => {
    fc.assert(
      fc.property(laneStep, word, (to, why) => {
        let [m, cmds] = start();
        [m, cmds] = ran(m, line("stuck:timeout", "", why));
        expect(m.phase).toBe("judging");
        expect(cmds[0]).toMatchObject({ type: "judge", step: "tests" });
        const [sent, after] = machine.update.judge_ok(m, {
          type: "judge_ok",
          value: { text: `answer: send ${to} ${why}` },
        } as never);
        expect(sent).toMatchObject({ phase: "stepping", step: to });
        expect(after[0]).toMatchObject({ type: "step_run", step: to });
        const [parked] = machine.update.judge_ok(m, {
          type: "judge_ok",
          value: { text: `answer: park ${why}` },
        } as never);
        expect(parked).toMatchObject({ phase: "over", end: { kind: "ask", reason: why } });

        if (parked.phase === "over") {
          expect(exitOf(parked.end)).toBe(20);
        }
      }),
      options,
    );
  });

  it("a RetriesExhausted on the step's err channel ends the lane as stuck (exit 30), naming the schedule", () => {
    fc.assert(
      fc.property(word, fc.integer({ min: 1, max: 9 }), (why, times) => {
        const [m] = start();
        const [over] = machine.update.step_run_err(m, {
          type: "step_run_err",
          error: {
            _tag: "RetriesExhausted",
            schedule: "slotSchedule(5 minutes)",
            times,
            reason: why,
          },
        } as never);
        expect(over).toMatchObject({ phase: "over", end: { kind: "stuck" } });

        if (over.phase === "over") {
          expect(over.end.reason).toContain("slotSchedule(5 minutes)");
          expect(over.end.reason).toContain(why);
          expect(exitOf(over.end)).toBe(30);
          // Nothing moved: the lane's head is where it was.
          expect(over.lane.head).toBe("");
        }
      }),
      options,
    );
  });

  it("the step cap parks the lane as ask, never loops forever", () => {
    const small = makeMachine(limits(2));
    const [idle] = small.init(null, undefined);
    let [m] = small.update.start(idle, { type: "start", step: "tests" });
    [m] = small.update.step_run_ok(m, {
      type: "step_run_ok",
      value: line("done", "a".repeat(40)),
    } as never);
    [m] = small.update.step_run_ok(m, {
      type: "step_run_ok",
      value: line("send:tests:step_said", "b".repeat(40)),
    } as never);
    expect(m).toMatchObject({ phase: "over", end: { kind: "ask" } });
  });
});

describe("T590 loosening.sh runs after review and before catch-up, today's tooling", () => {
  const machine = makeMachine(limits(16));
  // A lane whose review said merge-ready and whose PR is open: the loosening Cmd is next.
  const opened = (pr: number, head: string) => {
    const [idle] = machine.init(null, undefined);
    let [m] = machine.update.start(idle, { type: "start", step: "tests" });

    for (const _ of LANE_STEPS) {
      [m] = machine.update.step_run_ok(m, { type: "step_run_ok", value: line("done", head) } as never);
    }

    return machine.update.pr_open_ok(m, { type: "pr_open_ok", value: { pr, detail: "opened" } } as never);
  };
  const pr = fc.integer({ min: 1, max: 99_999 });
  const hits = fc
    .array(word, { minLength: 1, maxLength: 5 })
    .map((ws) => ws.map((w) => `a.test.ts: removed law: ${w}`));

  it("an open PR runs loosening.sh on the reviewed head before any catch-up", () => {
    fc.assert(
      fc.property(pr, sha, (n, head) => {
        const [m, cmds] = opened(n, head);
        expect(m).toMatchObject({ phase: "loosening", pr: n });
        expect(cmds).toEqual([expect.objectContaining({ type: "loosen", pr: n, head })]);
      }),
      options,
    );
  });

  it("zero hits lands; any hit parks as ask (exit 20) with every hit; any other exit is stuck (exit 30)", () => {
    fc.assert(
      fc.property(pr, sha, hits, fc.integer({ min: -1, max: 255 }), (n, head, list, code) => {
        const [m] = opened(n, head);
        const [clean, landCmds] = machine.update.loosen_ok(m, {
          type: "loosen_ok",
          value: { code: 0, text: "loosening: 0 hits in 2 exam files" },
        } as never);
        expect(clean).toMatchObject({ phase: "landing", pr: n });
        expect(landCmds).toEqual([expect.objectContaining({ type: "land", pr: n })]);

        const [hit, none] = machine.update.loosen_ok(m, {
          type: "loosen_ok",
          value: { code: 1, text: list.join("\n") },
        } as never);
        expect(none).toEqual([]);
        expect(hit).toMatchObject({ phase: "over", end: { kind: "ask" } });

        if (hit.phase === "over") {
          expect(exitOf(hit.end)).toBe(20);

          for (const h of list) {
            expect(hit.end.reason).toContain(h);
          }
        }

        const other = code === 0 || code === 1 ? 2 : code;
        const [broke, nothing] = machine.update.loosen_ok(m, {
          type: "loosen_ok",
          value: { code: other, text: "loosening: bad ref" },
        } as never);
        expect(nothing).toEqual([]);
        expect(broke).toMatchObject({ phase: "over", end: { kind: "stuck" } });
        expect(looseningEnd(n, { code: other, text: "x" })?.kind).toBe("stuck");
        const [threw] = machine.update.loosen_err(m, { type: "loosen_err", error: { _tag: "unknown" } } as never);
        expect(threw).toMatchObject({ phase: "over", end: { kind: "stuck" } });
      }),
      options,
    );
  });

  it("scenario: a loosening answer outside the loosening phase changes nothing", () => {
    const [idle] = machine.init(null, undefined);
    const [same, cmds] = machine.update.loosen_ok(idle, { type: "loosen_ok", value: { code: 0, text: "" } } as never);
    expect(same).toBe(idle);
    expect(cmds).toEqual([]);
  });
});

describe("T341 the pull request's steps table, today's tooling", () => {
  it("one row per step with its list dollars by run, and a total", () => {
    const rows = stepsTable("/nonexistent/rows.jsonl", [
      { step: "tests", outcome: "done", box: "l-tests1", run: "t1-tests" },
      { step: "build", outcome: "done", box: "l-build1", run: "t1-build" },
    ]);
    expect(rows).toHaveLength(5);
    expect(rows[2]).toContain("| tests | l-tests1 | done |");
    expect(rows.at(-1)).toBe("| total | | | 0.00 |");
  });

  // 0066: a lane that ran no mutation step claims none. Plants: always name mutation; name a
  // Claude step that never ran.
  it("property: the body names Claude only for steps the lane ran on it, mutation only when it ran", () => {
    fc.assert(
      fc.property(fc.subarray([...STEPS]), fc.subarray([...STEPS]), (ran, claude) => {
        const text = providers(ran, new Set(claude));
        expect(text.startsWith("Codex in a box")).toBe(true);
        expect(text.includes("mutation")).toBe(ran.includes("mutation"));

        for (const s of LANE_STEPS) {
          expect(text.includes(s)).toBe(ran.includes(s) && claude.includes(s));
        }
      }),
      options,
    );
  });
});

describe("T341 the chain record is a Schema value, today's tooling", () => {
  it("a step's record round-trips through encode and decode, before and after the step", () => {
    fc.assert(
      fc.property(step, fc.nat({ max: 20 }), outcome, sha, word, (s, round, o, head, why) => {
        const started = {
          round,
          step: s,
          note: why,
          startedAt: "t",
          endedAt: null,
          line: null,
          judged: null,
        };
        const before = { lane: "l", pr: null, landed: null, steps: [started] };
        const after = {
          ...before,
          pr: 7,
          steps: [
            {
              ...started,
              endedAt: "u",
              line: line(o, head, why),
              judged: { box: "b", answer: why },
            },
          ],
        };

        for (const r of [before, after]) {
          expect(
            Schema.decodeUnknownSync(ChainRecord)(JSON.parse(JSON.stringify(Schema.encodeSync(ChainRecord)(r)))),
          ).toEqual(r);
        }
      }),
      options,
    );
  });
});

describe("T341 the judgment agent's typed answer is a move, today's tooling", () => {
  it("send with a step runs that step again with the note; park, or a send with no step, parks", () => {
    expect(judgedMove({ answer: "send", step: "build", note: "fix the law" })).toEqual({
      _tag: "step",
      step: "build",
      note: "the lead's judgment: fix the law",
    });
    expect(judgedMove({ answer: "park", step: null, note: "a decision is needed" })).toEqual({
      _tag: "park",
      reason: "a decision is needed",
    });
    expect(judgedMove({ answer: "send", step: null, note: "" })).toEqual({
      _tag: "park",
      reason: "the judgment agent parked the lane with no why",
    });
  });

  it("the judge Cmd's answer reads back as the move it chose, and an older text by its answer line", () => {
    fc.assert(
      fc.property(laneStep, word, (s, note) => {
        const move = { _tag: "step" as const, step: s, note };
        expect(moveFrom(JSON.stringify(move))).toEqual(move);
        expect(moveFrom(JSON.stringify({ _tag: "park", reason: note }))).toEqual({
          _tag: "park",
          reason: note,
        });
        expect(moveFrom(`answer: send ${s} ${note}`)).toEqual(judgedOf(`answer: send ${s} ${note}`));
      }),
      options,
    );
  });
});

describe("T341 a lane started again keeps its earlier rounds, today's tooling", () => {
  // The dry run of 2026-11-10 (ticket 522): `--start review` began at round 1 again and wrote its
  // review over the record of the tests step, which also was round 1.
  // Plants: start every run at round 1; count the steps instead of taking the highest round.
  it("no new round is a round the record already holds", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 40 }), { maxLength: 12 }),
        fc.integer({ min: 1, max: 16 }),
        step,
        (rounds, next, s) => {
          const record = {
            lane: "l",
            pr: null,
            landed: null,
            steps: rounds.map((round) => ({
              round,
              step: s,
              note: "",
              startedAt: "t",
              endedAt: null,
              line: null,
              judged: null,
            })),
          };
          expect(rounds).not.toContain(roundsIn(record) + next);
          expect(roundsIn({ ...record, steps: [] })).toBe(0);
        },
      ),
      options,
    );
  });
});

describe("T341 a turn runs through the agents package on the fake adapter, today's tooling", () => {
  const dir = mkdtempSync(join(tmpdir(), "chain-turn-"));
  // Each turn writes its own events file.
  let turns = 0;
  const turn = (script: Agent.FakeScript) =>
    Effect.gen(function* () {
      const fake = Agent.fakeAdapter(() => script);
      const agents = Agent.makeAgents({
        adapters: { claude: fake },
        sessions: Agent.memorySessions(),
        reaper: Agent.noReaper,
      });
      turns += 1;
      const events = join(dir, `${turns}.jsonl`);
      const report = `${events}.md`;
      const turned = yield* runTurn(agents, {
        provider: "claude",
        session: "s",
        folder: dir,
        prompt: "do the step",
        system: "you are the step",
        answer: Answer,
        model: null,
        effort: null,
        minutes: 1,
        events,
        report,
      });
      return {
        turned,
        fake,
        events: readFileSync(events, "utf8"),
        report: readFileSync(report, "utf8"),
      };
    });
  // Vitest awaits the Promise a test hands back: the one place a law's Effect is run.
  const ran = <A>(law: Effect.Effect<A>) => law.pipe(Effect.runPromise);

  it("the last message is the report, its JSON object is the typed answer, and every update is one event line", () =>
    ran(
      Effect.gen(function* () {
        const said = 'The laws are green.\n{"verb":"done","to":null,"reason":"all green","laws":null}';
        const { turned, fake, events, report } = yield* turn({
          raws: [
            { _tag: "tool", id: "t1", title: "pnpm test", status: "in_progress" },
            { _tag: "tool", id: "t1", title: "pnpm test", status: "completed" },
            { _tag: "said", text: said },
            { _tag: "tokens", tokens: { input: 100, cached: 40, output: 10 }, whole: true },
            { _tag: "ended", stop: "end_turn", structured: undefined, usd: 0.5, requests: 2 },
          ],
        });
        expect(report).toBe(said);
        expect(turned._tag).toBe("ended");

        if (turned._tag !== "ended") {
          return;
        }

        expect(turned.answer).toEqual({ verb: "done", to: null, reason: "all green", laws: null });
        expect(turned.spent).toEqual({
          input: 100,
          cached: 40,
          output: 10,
          counted: "turn",
          usd: 0.5,
          requests: 2,
          tools: 1,
        });
        const lines = events
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l) as { _tag: string });
        expect(lines.map((l) => l._tag)).toEqual(["started", "tool", "tool", "said", "tokens", "ended"]);
        // The prompt reached the adapter with the schema's form appended, and the system prompt named.
        expect(fake.seen.started[0]?.prompt).toContain("do the step");
        expect(fake.seen.started[0]?.system).toEqual({ _tag: "append", text: "you are the step" });
      }),
    ));

  it("a harness that breaks is a failed turn with its reason, never a thrown error", () =>
    ran(
      Effect.gen(function* () {
        const { turned } = yield* turn({ raws: [{ _tag: "said", text: "half" }] });
        expect(turned._tag).toBe("failed");

        if (turned._tag === "failed") {
          expect(turned.reason).toBe("broke");
        }
      }),
    ));

  it("an agent that says nothing fitting ends with a null answer and an empty report", () =>
    ran(
      Effect.gen(function* () {
        const { turned, report } = yield* turn(Agent.saying("no json here"));
        expect(report).toBe("no json here");
        expect(turned._tag === "ended" && turned.answer).toBeNull();
        rmSync(dir, { recursive: true, force: true });
      }),
    ));
});

describe("T341 the field row prices a turn by its provider, today's tooling", () => {
  const spent: Spent = {
    input: 1_000_000,
    cached: 500_000,
    output: 100_000,
    counted: "last",
    usd: 1.25,
    requests: 3,
    tools: 4,
  };

  it("Claude's row takes the SDK's dollars; a Codex row is priced by the table, or not at all", () => {
    expect(listUsd("claude", "sonnet", spent)).toBe(1.25);
    // 500k uncached at $10, 500k cached at $1, 100k out at $50, per million.
    expect(listUsd("codex", "gpt-6-astra", spent)).toBe(5 + 0.5 + 5);
    expect(listUsd("codex", "gpt-unknown", spent)).toBeNull();
    expect(listUsd("codex", "gpt-6-astra", NO_SPENT)).toBeNull();
  });

  it("format: one JSON line in fieldrow.py's shape, with the tokens and a why that says how they were counted", () => {
    const row = JSON.parse(
      stepRow({
        run: "t1-build",
        ticket: "1",
        step: "build",
        provider: "codex",
        model: "gpt-6-astra",
        effort: "medium",
        outcome: "pass",
        reason: "done.",
        started: new Date("2026-11-09T10:00:00Z"),
        ended: new Date("2026-11-09T10:30:00Z"),
        spent,
        redacted: 0,
      }),
    ) as Record<string, unknown>;
    expect(row).toMatchObject({
      run: "t1-build",
      ticket: "1",
      step: "build",
      role: "hand",
      model: "gpt-6-astra",
      effort: "medium",
      outcome: "pass",
      tokens: null,
      tools: 4,
      minutes: 30,
      costUsd: null,
      listUsd: 10.5,
      billed: 1_100_000,
      inputTokens: 1_000_000,
      cachedTokens: 500_000,
      outputTokens: 100_000,
      billing: "subscription",
      redacted: 0,
    });
    expect(String(row.why)).toContain("ticket 485");
    expect(Object.keys(row)).toContain("date");
  });
});

describe("T675 a lane stops at its budget (0076), today's tooling", () => {
  const big = 1_000;
  const stepOn = (limit: Limits) => {
    const machine = makeMachine(limit);
    const [idle] = machine.init(null, undefined);
    return { machine, first: machine.update.start(idle, { type: "start", step: "tests" }) };
  };
  const again = JSON.stringify({ _tag: "step", step: "tests", note: "again" });

  // vector: the sort, reason by reason, read from the stuck rows in the boxes folder on 2026-11-11.
  it("vector: each stuck reason drive writes gets its fault, and an agent's own stuck reads its reason", () => {
    const cases: readonly (readonly [string, string, "tool" | "work"])[] = [
      ["stuck:fetch_failed", "fetch: stepcommit: not_owner: a.test.ts", "tool"],
      ["stuck:agent_failed", "codex contain: Codex's box would need 1188 lines", "tool"],
      ["stuck:box_failed", "box.sh new: stuck base_not_signed", "tool"],
      ["stuck:no_answer", "no answer line in the report", "tool"],
      ["stuck:push_failed", "botpush: rejected", "tool"],
      ["stuck:record_failed", "redact.sh failed", "tool"],
      ["stuck:crash", "Error: boom", "tool"],
      ["stuck:worktree_unreadable", "git worktree list failed", "tool"],
      ["stuck:RetriesExhausted", "agent_cap: 8 agents", "tool"],
      ["stuck:step_said", "mutbox: docker_busy: another Docker box is running (pid 4038); one at a time", "tool"],
      ["stuck:step_said", "both laws test files fail in this sandbox with `listen EPERM 127.0.0.1`", "tool"],
      ["stuck:step_said", "Network is blocked, so `pnpm patch` could not run", "tool"],
      ["stuck:step_said", "cannot verify the required typecheck guard because pgrep cannot list processes", "tool"],
      ["stuck:step_said", "typecheck fails at door.test.ts:2989: string is not assignable to SinkError", "work"],
      ["stuck:step_said", "approved plan ownership must cover both files before stepcommit can commit them", "work"],
      ["stuck:unsigned", "commits check: stale_link 62865b7f step lead; stale_link d1ea03a7 step lead", "tool"],
      ["stuck:unsigned", "commits check: stale_link 62865b7f step lead; and 5 more", "tool"],
      ["stuck:unsigned", "and 5 more", "work"],
      ["stuck:unsigned", "commits check: build_touched_exam a7ff4ee8 next/apps/fabrika/tsconfig.json", "work"],
      ["stuck:unsigned", "commits check: stale_link 62865b7f step lead; build_touched_exam a7ff4ee8 x", "work"],
      ["stuck:unsigned", "3fda8c62 has no step note", "work"],
      ["stuck:timeout", "stopped after 60 minutes", "work"],
      ["stuck:no_commit", "answered done with no commit", "work"],
      ["stuck:leak", "added lines leak, nothing pushed", "work"],
      ["stuck:review_committed", "the review left 2 files changed in its box", "work"],
      ["stuck:something_new", "a stuck name nobody sorted", "work"],
    ];

    for (const [outcome, reason, fault] of cases) {
      expect([outcome, reason, faultFrom(outcome, reason)]).toEqual([outcome, reason, fault]);
    }
  });

  // Plants: give a send or a done a fault; let a stuck with an odd reason have none.
  it("property: only a stuck outcome has a fault, and every stuck outcome has one of the two", () => {
    fc.assert(
      fc.property(outcome, fc.string({ maxLength: 80 }), (o, reason) => {
        const fault = faultFrom(o, reason);
        expect(fault === null).toBe(!o.startsWith("stuck"));

        if (fault !== null) {
          expect(FAULTS).toContain(fault);
        }
      }),
      options,
    );
  });

  it("property: a step's mark is send for a send, its fault for a stuck, and pass for anything else", () => {
    fc.assert(
      fc.property(outcome, word, (o, reason) => {
        const l = line(o, "h", reason);
        const mark = markFrom(l);
        const [verb] = o.split(":");
        expect(mark).toBe(verb === "send" ? "send" : verb === "stuck" ? l.fault : "pass");
      }),
      options,
    );
  });

  // The steps a run may feed, with the mark each makes. None is a done, so the lane never opens a PR.
  const fed = fc.constantFrom(
    { o: "send:tests:step_said", reason: "a law misses a case", mark: "send" as Mark },
    { o: "send:build:step_said", reason: "a law is red", mark: "send" as Mark },
    { o: "ask:lead:question", reason: "which form?", mark: "pass" as Mark },
    { o: "stuck:fetch_failed", reason: "fetch failed", mark: "tool" as Mark },
    { o: "stuck:step_said", reason: "mutbox: docker_busy: another Docker box", mark: "tool" as Mark },
    { o: "stuck:no_commit", reason: "answered done with no commit", mark: "work" as Mark },
  );

  // Plants: count tool stucks; check the window only after a judgment; keep the whole lane, not its
  // last 5; stop at 2 in 5 or 3 in 6.
  it("property: the chain stops at the first step where 3 of the last 5 were sent back or stuck on the work, never on tool stucks", () => {
    fc.assert(
      fc.property(fc.array(fed, { minLength: 1, maxLength: 30 }), (steps) => {
        const { machine, first } = stepOn(limits(big, null, big));
        let [m] = first;
        const marks: Mark[] = [];
        const trips = (i: number) =>
          marks.slice(Math.max(0, i - 4), i + 1).filter((k) => k === "send" || k === "work").length >= 3;
        const expected = steps.findIndex((_, i) => {
          marks[i] = steps[i]?.mark ?? "pass";
          return trips(i);
        });

        for (const [i, s] of steps.entries()) {
          expect(m.phase).toBe("stepping");
          [m] = machine.update.step_run_ok(m, { type: "step_run_ok", value: line(s.o, "", s.reason) } as never);

          if (i === expected) {
            expect(m).toMatchObject({ phase: "over", end: { kind: "ask", stop: { _tag: "intensity" } } });
            return;
          }

          expect(m.phase).not.toBe("over");

          if (m.phase === "judging") {
            [m] = machine.update.judge_ok(m, { type: "judge_ok", value: { text: again, listUsd: 0 } } as never);
          }
        }

        expect(expected).toBe(-1);
      }),
      options,
    );
  });

  it("scenario: a stop's question holds the counts, the tool stucks it left out and what was spent", () => {
    const { machine, first } = stepOn(limits(big, null, big));
    let [m] = first;
    const run = [
      line("send:build:step_said", "", "a law is red", 1.5),
      line("stuck:fetch_failed", "", "fetch failed", 0.5),
      line("send:tests:step_said", "", "a law misses a case", 2),
      line("stuck:no_commit", "", "answered done with no commit", 1),
    ];

    for (const l of run) {
      [m] = machine.update.step_run_ok(m, { type: "step_run_ok", value: l } as never);

      if (m.phase === "judging") {
        [m] = machine.update.judge_ok(m, { type: "judge_ok", value: { text: again, listUsd: 0.25 } } as never);
      }
    }

    expect(m.phase).toBe("over");

    if (m.phase === "over") {
      expect(exitOf(m.end)).toBe(20);
      expect(m.end.stop).toEqual({
        _tag: "intensity",
        count: 3,
        within: 5,
        window: ["send", "tool", "send", "work"],
        steps: 4,
        dollars: 5.25,
      });
      expect(m.end.reason).toBe(
        "intensity: 3 of the last 4 steps were sent back or stuck on the work (2 sent back, 1 stuck on the work; 1 stuck on a tool, not counted; the limit is 3 in 5). Spent so far: 4 steps, $5.25. Answer redo, cut scope or drop (0076).",
      );
    }
  });

  // Plants: check the backstop after the step starts; count only steps or only dollars; keep MaxSteps
  // over the backstop.
  it("property: with a backstop, the chain stops before the next step or judgment once the lane ran its steps or spent its dollars", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 40 }),
        fc.array(fc.integer({ min: 0, max: 900 }), { minLength: 1, maxLength: 30 }),
        (steps, dollars, cents) => {
          const backstop = { steps, dollars };
          // MaxSteps of 1 would park at once; with a backstop it does not hold.
          const { machine, first } = stepOn(limits(1, backstop, big));
          let [m] = first;
          let spent = 0;

          for (const [i, c] of cents.entries()) {
            spent += c / 100;
            [m] = machine.update.step_run_ok(m, {
              type: "step_run_ok",
              value: line("ask:lead:question", "", "which form?", c / 100),
            } as never);
            const round = i + 1;

            if (round >= steps || spent >= dollars) {
              expect(m).toMatchObject({
                phase: "over",
                end: { kind: "ask", stop: { _tag: "backstop", passed: round >= steps ? "steps" : "dollars" } },
              });
              return;
            }

            expect(m.phase).toBe("judging");
            [m] = machine.update.judge_ok(m, { type: "judge_ok", value: { text: again, listUsd: 0 } } as never);
            expect(m.phase).toBe("stepping");
          }
        },
      ),
      options,
    );
  });

  it("property: an estimate line in steps and dollars is read wherever it sits, and the backstop is twice it", () => {
    fc.assert(
      fc.property(
        fc.array(word, { maxLength: 6 }),
        fc.array(word, { maxLength: 6 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 1, max: 500 }),
        (before, after, steps, dollars) => {
          const text = [...before, `Estimate: ${steps} steps, $${dollars}, 70% sure`, ...after].join("\n");
          expect(estimateIn(text)).toEqual({ steps, dollars });
          expect(backstopFrom({ steps, dollars }, 2)).toEqual({ steps: 2 * steps, dollars: 2 * dollars });
          expect(estimateIn([...before, ...after].join("\n"))).toBeNull();
        },
      ),
      options,
    );
  });

  // format: the one form the chain reads; a plan in agent hours alone has no estimate for it.
  it("format: an estimate in hours, or one without steps or dollars, is none", () => {
    expect(estimateIn("## Size\n\nEstimate: 2 agent hours, 70% sure.")).toBeNull();
    expect(estimateIn("Estimate: 12 steps, 70% sure.")).toBeNull();
    expect(estimateIn("Estimate: $15.")).toBeNull();
    expect(estimateIn("We ran 12 steps for $15 last time.")).toBeNull();
    expect(estimateIn("estimate 12 steps and $15.50")).toEqual({ steps: 12, dollars: 15.5 });
  });

  // pinned: chain records on disk from before 0076 carry no fault, no dollars and no stop.
  it("pinned: a chain record written before 0076 still reads, with no fault and no dollars", () => {
    const old = {
      lane: "p14",
      pr: null,
      landed: null,
      steps: [
        {
          round: 1,
          step: "tests",
          note: "",
          startedAt: "2026-11-09T23:36:00.000Z",
          endedAt: "2026-11-09T23:37:00.000Z",
          line: { outcome: "stuck:fetch_failed", head: "", reason: "fetch failed", report: null, box: "b", exit: 30 },
          judged: null,
        },
      ],
    };
    const read = Schema.decodeUnknownSync(ChainRecord)(old);
    expect(read.steps[0]?.line).toMatchObject({ fault: null, listUsd: null });
    expect(read.stop).toBeUndefined();
  });

  it("property: drive's line gives its fault and dollars, and a line without a fault gets one from its outcome", () => {
    fc.assert(
      fc.property(outcome, word, fc.option(fc.integer({ min: 0, max: 9_999 })), (o, reason, usd) => {
        const fault = faultFrom(o, reason);
        const sent = lineOf(JSON.stringify({ outcome: o, reason, fault, listUsd: usd }), 0);
        expect(sent).toMatchObject({ fault, listUsd: usd });
        expect(lineOf(JSON.stringify({ outcome: o, reason }), 0)).toMatchObject({ fault, listUsd: null });
      }),
      options,
    );
  });

  it("scenario: a backstop's question names the limit it passed and what was spent", () => {
    expect(
      stopReason({
        _tag: "backstop",
        passed: "dollars",
        backstop: { steps: 24, dollars: 30 },
        steps: 9,
        dollars: 31.4,
      }),
    ).toBe(
      "backstop: the lane reached $30.00, its backstop (24 steps, $30.00). Spent so far: 9 steps, $31.40. Answer redo, cut scope or drop (0076).",
    );
  });
});
