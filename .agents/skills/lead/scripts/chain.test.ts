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
  briefOf,
  ChainRecord,
  roundsIn,
  exitOf,
  judgedOf,
  type Line,
  lineOf,
  makeMachine,
  judgedMove,
  moveFrom,
  moveOf,
  RetriesExhausted,
  sectionsOf,
  slotRefusal,
  slotSchedule,
  STEPS,
  type StepName,
  stepsTable,
} from "./chain.ts";

// Today's tooling. The lane machine is pure and stepped by hand here; nothing runs an agent.
const options = { seed: 119120, numRuns: 300 };
const step = fc.constantFrom(...STEPS);
const sha = fc.stringMatching(/^[0-9a-f]{40}$/);
const word = fc.stringMatching(/^[a-z][a-z ]{0,30}[a-z]$/);

const outcome = fc.oneof(
  fc.constant("done"),
  fc.constant("skip:step_said"),
  fc.constantFrom("send:tests:step_said", "send:build:step_said", "send:tests:exam_paths"),
  fc.constant("send:plan:plancheck"),
  fc.constantFrom("ask:lead:question", "ask:lead:lockfile"),
  fc.constantFrom("refused:agent_cap", "refused:low_disk"),
  fc.constantFrom("refused:plan_unapproved", "refused:shared_ticket", "refused:branch_checked_out"),
  fc.constantFrom("stuck:timeout", "stuck:no_answer", "stuck:crash", "stuck:fetch_failed"),
);

const line = (o: string, head: string, reason = "why"): Line => ({
  outcome: o,
  head,
  reason,
  report: null,
  box: "b",
  exit: 0,
});

describe("T341 the chain's moves follow the five verbs, today's tooling", () => {
  it("done walks tests -> build -> mutation -> review -> open; skip walks the same way", () => {
    const walk: Record<StepName, string> = {
      tests: "build",
      build: "mutation",
      mutation: "review",
      review: "open",
    };

    for (const s of STEPS) {
      for (const o of ["done", "skip:step_said"]) {
        const m = moveOf(s, line(o, "h"), 0, 3);
        expect(m._tag === "step" ? m.step : m._tag).toBe(walk[s]);

        if (m._tag === "step") {
          expect(m.note).toBe("");
        }
      }
    }
  });

  it("a send goes to the step it names with the sender's word; a send to plan parks", () => {
    fc.assert(
      fc.property(step, step, word, (from, to, why) => {
        const m = moveOf(from, line(`send:${to}:step_said`, "h", why), 0, 3);
        expect(m).toMatchObject({ _tag: "step", step: to });

        if (m._tag === "step") {
          expect(m.note).toContain(why);
        }

        expect(moveOf(from, line("send:plan:plancheck", "h", why), 0, 3)._tag).toBe("park");
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
  it("reads the last answer line: a send names a step and carries its note; park carries its why", () => {
    fc.assert(
      fc.property(step, word, word, (s, note, chatter) => {
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

  it("no answer line, or one naming a step that is not a step, parks", () => {
    expect(judgedOf("I think the build should run again").toString()).toBe(judgedOf("").toString());
    expect(judgedOf("answer: send plan fix it")._tag).toBe("park");
    expect(judgedOf("")._tag).toBe("park");
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
});

describe("T341 drive's last line is what the chain reads, today's tooling", () => {
  it("takes the last JSON line with an outcome, over gc chatter before it, and none is null", () => {
    fc.assert(
      fc.property(outcome, sha, word, fc.integer({ min: 0, max: 40 }), (o, head, reason, exit) => {
        const out = `keep box x: busy\n${JSON.stringify({ outcome: "plan-only" })}\n${JSON.stringify({ outcome: o, head, reason, report: null, box: "b", exit })}\n`;
        expect(lineOf(out, 1)).toEqual({ outcome: o, head, reason, report: null, box: "b", exit });
        expect(lineOf("nothing here\n", 30)).toBeNull();
      }),
      options,
    );
  });
});

describe("T341 the lane machine, stepped by hand, today's tooling", () => {
  const machine = makeMachine({ maxSteps: 16, maxStucks: 3 });
  const start = () => {
    const [idle] = machine.init(null, undefined);
    return machine.update.start(idle, { type: "start", step: "tests" });
  };
  const ran = (m: ReturnType<typeof start>[0], l: Line) =>
    machine.update.step_run_ok(m, { type: "step_run_ok", value: l } as never);

  it("a clean lane runs the four steps, opens the PR and lands it, with exit 0", () => {
    let [m, cmds] = start();
    expect(cmds[0]).toMatchObject({ type: "step_run", step: "tests", round: 1 });
    const heads: string[] = [];

    for (const [i, s] of STEPS.entries()) {
      expect(m).toMatchObject({ phase: "stepping", step: s });
      const head = String(i + 1).repeat(40);
      heads.push(head);
      [m, cmds] = ran(m, line("done", head));
    }

    expect(m.phase).toBe("opening");
    expect(cmds[0]).toMatchObject({ type: "pr_open", head: heads[3] });
    [m, cmds] = machine.update.pr_open_ok(m, {
      type: "pr_open_ok",
      value: { pr: 42, detail: "opened" },
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
        mutation: heads[2],
        review: heads[3],
      });
    }
  });

  it("a send back reruns the named step with the sender's word in its note", () => {
    fc.assert(
      fc.property(step, word, (to, why) => {
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
      fc.property(step, word, (to, why) => {
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
    const small = makeMachine({ maxSteps: 2, maxStucks: 3 });
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
      fc.property(step, word, (s, note) => {
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
