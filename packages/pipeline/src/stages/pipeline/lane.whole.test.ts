import { ATTR } from "@kampus/fabrika-old";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FactOf } from "../../tickets/ticket.ts";
import { nameOf as outcomeName } from "../outcome.ts";
import { LANE } from "../traced.ts";
import { YES, TIMED_OUT, KILLED, lane, keptAtStart, onMain, codexRuns, WHOLE, askedFor } from "./lane-harness.ts";
import { askedFor as kindOfAsk, PICKS } from "./machine.ts";

// A lane, whole, on the local host: every step in order, the checks it runs itself, a person's no,
// and a resume after a kill. The shared setup is in ./lane-harness.ts. Today's version.

describe("a lane, whole", () => {
  beforeEach(() => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("CODEX_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("runs every step in order and ends on a merge, on a person's yes", async () => {
    const ran = await lane({ picks: YES });
    expect(ran.stages, ran.lines.join("\n")).toEqual(WHOLE);
    expect(ran.lines.at(-1)).toContain("ended: done");
    expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
    expect(onMain(ran.remote, "src/lower.test.ts")).toContain("lowers capitals");
    expect(onMain(ran.remote, "src/lower-spaces.test.ts")).toContain("cuts spaces");

    // Each agent's run names its brief at the start, and its model and tokens at the end.
    const started = ran.facts.filter((f) => f.type === "started" && f.stage === "plan");
    expect(started[0]).toMatchObject({
      brief: "plan.md",
      harness: "codex",
      model: "gpt-6-astra",
      effort: "high",
    });
    expect(String(started[0]?.hash)).toMatch(/^[0-9a-f]{8,}$/);
    const plan = ran.facts.find((f) => f.type === "ended" && f.stage === "plan");
    // gpt-6-astra at OpenAI's list price, short context, read 2026-11-02: $10 a million in, $1
    // cached, $50 out (ticket 141). 800 fresh, 200 cached, 100 out.
    expect(plan).toMatchObject({
      input: 1000,
      cached: 200,
      output: 100,
      listUsd: expect.closeTo((10 * 800 + 1 * 200 + 50 * 100) / 1e6, 9),
      billed: 0,
    });

    // The real adapter ran the fake: the model from `fabrika.toml`, read-only and no key in reach.
    const runs = codexRuns(ran.dir);
    expect(runs.map((r) => r.step)).toEqual(["triage", "plan", "tests", "build", "mutants", "review"]);

    for (const run of runs) {
      expect(run.args).toContain("gpt-6-astra");
      expect(run.keys).toEqual([]);
    }
  });

  it("ties each ask to its lane's trace, and tags each step's span and each wait's span by name, never with a note (ticket 141, P1 to P3)", async () => {
    const NOTE = "Looks right to me, go on";
    const ran = await lane({ picks: YES, notes: { approve: NOTE }, traced: true });
    expect(ran.stages, ran.lines.join("\n")).toEqual(WHOLE);

    // P1: every ask carries the trace id its lane's `started` facts carry, the one before it.
    let lastTrace: string | undefined;
    const pairs: [string | undefined, string | undefined][] = [];

    for (const e of ran.entries) {
      if (e.fact.type === "started") {
        lastTrace = e.fact.trace;
      }

      if (e.fact.type === "asked") {
        pairs.push([e.fact.trace, lastTrace]);
      }
    }

    expect(pairs.length).toBeGreaterThan(0);

    for (const [asked, started] of pairs) {
      expect(started).toMatch(/^[0-9a-f]{32}$/);
      expect(asked).toBe(started);
    }

    // P2: one "run a step" span per run that ended, tagged with its run, its step and its outcome's
    // name; its model and tokens by the names a trace viewer reads; dollars only when known.
    // The model and harness are on a run's `started`, not its `ended`.
    const startedBy = new Map(
      ran.entries.flatMap((e): [string, FactOf<"started">][] =>
        e.fact.type === "started" ? [[e.fact.run, e.fact]] : [],
      ),
    );
    const stepSpans = ran.spans.filter((s) => s.name === "run a step");
    let agentSteps = 0;

    for (const e of ran.entries) {
      if (e.fact.type !== "ended") {
        continue;
      }

      const ended = e.fact;
      const mine = stepSpans.filter((s) => s.attributes[LANE.run] === ended.run);
      expect(mine, ended.run).toHaveLength(1);
      const tags = mine[0]?.attributes ?? {};
      expect(tags[LANE.step]).toBe(ended.stage);
      expect(tags[ATTR.outcome]).toBe(outcomeName(ended.outcome));
      const model = startedBy.get(ended.run)?.model;

      // A code step names no model, and no tokens or price are said for it here.
      if (model === undefined) {
        continue;
      }

      agentSteps++;
      // Known as L6 knows it: a list price, else what claude billed. Else none is written.
      const known =
        typeof ended.listUsd === "number"
          ? ended.listUsd
          : startedBy.get(ended.run)?.harness === "claude" && typeof ended.billed === "number"
            ? ended.billed
            : null;

      if (known === null) {
        expect(tags[ATTR.costUsd], ended.run).toBeUndefined();
      } else {
        expect(tags[ATTR.costUsd], ended.run).toBeCloseTo(known, 4);
      }

      expect(tags["gen_ai.request.model"]).toBe(model);
      expect(tags["gen_ai.usage.input_tokens"]).toBe(ended.input);
      expect(tags["gen_ai.usage.output_tokens"]).toBe(ended.output);
      expect(tags["gen_ai.usage.cache_read.input_tokens"]).toBe(ended.cached ?? 0);
    }

    // Astra's steps were seen, each at its list price once the table has it.
    expect(agentSteps).toBeGreaterThan(0);

    // P3: each answer's "wait for the answer" span names the ask, what it was for, the pick and
    // who answered. `tea.ask.for` is in the plan's span tags (section 1, review B1).
    const waitSpans = ran.spans.filter((s) => s.name === "wait for the answer");
    const answers = ran.entries.flatMap((e) => (e.fact.type === "answered" ? [{ fact: e.fact, by: e.by.id }] : []));
    expect(answers.length).toBeGreaterThan(0);

    for (const { fact, by } of answers) {
      const heard = waitSpans.filter(
        (s) => s.attributes[LANE.ask] === fact.ask && s.attributes[LANE.pick] !== undefined,
      );
      expect(heard, fact.ask).toHaveLength(1);
      const what = kindOfAsk(fact.ask);
      expect(what, fact.ask).not.toBeNull();
      expect(heard[0]?.attributes["tea.ask.for"], fact.ask).toBe(what);
      expect(heard[0]?.attributes[LANE.pick]).toBe(fact.pick);
      expect(heard[0]?.attributes[LANE.by]).toBe(by);
    }

    // The note is a value a person typed: no wait span, or event on one, holds it.
    const values = waitSpans.flatMap((s) => [
      ...Object.values(s.attributes),
      ...s.events.flatMap((ev) => Object.values(ev.attributes ?? {})),
    ]);
    expect(values.filter((v) => String(v).includes(NOTE))).toEqual([]);
  });

  it("lands rule changes in their own pull request before the test writer starts", async () => {
    const ran = await lane({ title: "[rules] Read names in one form", picks: YES });
    expect(ran.stages).toEqual([
      "triage",
      "plan",
      "exam",
      // Self-fix PR 10: the exam's pull request is reviewed before the person is asked.
      "exam_review",
      "exam_merge",
      "test_writer",
      "build",
      "mutation",
      "mutants",
      "review",
      "push",
      "merge",
    ]);
    expect(onMain(ran.remote, ".oxlintrc.json")).toContain("rules");
    expect(ran.lines.at(-1)).toContain("ended: done");
    expect(codexRuns(ran.dir).map((r) => r.step)).toContain("exam");
  });

  // Self-fix PR 5: a touched exam is the person's call now, with two picks. The person here leaves
  // it unanswered, so the lane waits on it, and the line ends there.
  it("keeps nothing of a build that changes a test the writer wrote, and asks the person", async () => {
    const ran = await lane({
      title: "[touch-exam] Read names in one form",
      picks: { approve: "approve" },
      leave: ["exam_touched"],
    });
    expect(ran.stages).toEqual(["triage", "plan", "exam", "test_writer", "build"]);
    expect(ran.names.build).toContain("exam_touched");
    const asked = ran.facts.filter((f) => f.type === "asked" && String(f.ask).startsWith("a-exam_touched-"));
    expect(asked).toHaveLength(1);
    expect(asked[0]?.picks).toEqual(PICKS.exam_touched);
    expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
    const said = ran.facts.filter((f) => f.type === "commented").map((f) => String(f.body));
    expect(said.some((body) => body.includes("src/lower.test.ts"))).toBe(true);
  });

  // Self-fix PR 3's whole-lane case, as PR 4 has it: each build leaves a test that fails, so code's
  // checks after the build find the head red three times. No mutation step, no review: it stops at
  // the rounds' question.
  it("sends a red head back to the builder with the failing test's name, and asks once the rounds are spent", async () => {
    const NAME = "src/red.test.ts > a planted red > stays red";
    /** A build's own test that fails, a little different each round so each build changes something. */
    const red = (n: number) => [
      {
        path: "src/red.test.ts",
        text: `import {describe, expect, it} from "vitest";\n\ndescribe("a planted red", () => {\n\tit("stays red", () => {\n\t\texpect(1).toBe(${n});\n\t});\n});\n`,
      },
    ];
    const ran = await lane({
      within: 50,
      picks: { approve: "approve", rounds_spent: "stop" },
      fake: { writesAt: { build: { 0: red(2), 1: red(3), 2: red(4) } } },
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    expect(ran.stages, said).toEqual(["triage", "plan", "exam", "test_writer", "build", "build", "build"]);

    // The ticket keeps the name each time the head was red: on the build's end, and on code's
    // `checked` at each head the builder left.
    const reds = ran.facts.filter((f) => f.type === "ended" && f.stage === "build");
    expect(reds).toHaveLength(3);

    for (const end of reds) {
      expect(end.outcome).toEqual({ kind: "send", to: "builder", why: "checks_red" });
      expect(end.failed).toEqual([NAME]);
    }

    const checked = ran.facts.filter((f) => f.type === "checked");
    expect(checked).toHaveLength(3);

    for (const fact of checked) {
      expect(fact).toMatchObject({ result: "red", failed: [NAME] });
    }

    expect(new Set(checked.map((f) => f.head)).size).toBe(3);
    // A comment lists it, with the first line of its error.
    const comments = ran.facts.filter((f) => f.type === "commented").map((f) => String(f.body));
    expect(comments.some((c) => c.includes(NAME) && c.includes("expected 1 to be 2"))).toBe(true);

    // Round 2's builder is told it; round 1's had nothing to be told.
    const builds = codexRuns(ran.dir).filter((r) => r.step === "build");
    expect(builds).toHaveLength(3);
    expect(builds[0]?.prompt).not.toContain(NAME);
    expect(builds[1]?.prompt).toContain(NAME);
    // The tests command as an agent runs it by hand: no JSON report, which only code reads.
    expect(builds[0]?.prompt).toContain("`- node_modules/.bin/vitest run`");
    expect(builds[0]?.prompt).not.toContain("{out}");
    expect(builds[0]?.prompt).not.toContain("--reporter=json");

    // The question: asked once, with what is still red and what the rounds cost, then a stop. The
    // fake's model, gpt-6-astra, has a list price since ticket 141; either way an unknown price
    // never reads as free.
    const asked = ran.facts.filter((f) => f.type === "asked");
    const spent = asked.filter((f) => String(f.ask).includes("rounds_spent"));
    expect(spent).toHaveLength(1);
    expect(spent[0]?.picks).toEqual(["again", "stop"]);
    const cost = /\$\d|price unknown/;
    expect(comments.some((c) => c.includes(NAME) && cost.test(c))).toBe(true);
    expect(ran.lines.at(-1)).toContain("ended: stuck:rounds_spent");
  });

  // Self-fix PR 4, the one whole-lane case: code runs `[build] checks` at the head after every build,
  // and code decides, not the builder's form. Round 1's builder leaves a failing test and says its
  // checks passed: red, back to the builder with the name. Round 2's fixes it and says its checks
  // failed: green, so the lane goes on, and the mutation step trusts those checks in place of its
  // own suite run, and says so.
  it("runs the checks itself after each build: red goes back with the name, green goes on whatever the form says", async () => {
    const NAME = "src/red.test.ts > a planted red > stays red";
    const planted = (n: number) => [
      {
        path: "src/red.test.ts",
        text: `import {describe, expect, it} from "vitest";\n\ndescribe("a planted red", () => {\n\tit("stays red", () => {\n\t\texpect(1).toBe(${n});\n\t});\n});\n`,
      },
    ];
    const ran = await lane({
      within: 50,
      picks: YES,
      fake: {
        writesAt: { build: { 0: planted(2), 1: planted(1) } },
        answers: { build: [null, { with: { ran: [{ command: "pnpm test", passed: false }] } }] },
      },
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    expect(ran.stages, said).toEqual([
      "triage",
      "plan",
      "exam",
      "test_writer",
      "build",
      "build",
      "mutation",
      "mutants",
      "review",
      "push",
      "merge",
    ]);
    expect(ran.lines.at(-1)).toContain("ended: done");

    // The first build's end: red, with the name. The second's: done.
    const builds = ran.facts.filter((f) => f.type === "ended" && f.stage === "build");
    expect(builds[0]).toMatchObject({
      outcome: { kind: "send", to: "builder", why: "checks_red" },
      failed: [NAME],
    });
    expect(builds[1]?.outcome).toEqual({ kind: "done", part: false });
    const prompts = codexRuns(ran.dir).filter((r) => r.step === "build");
    expect(prompts[1]?.prompt).toContain(NAME);

    // The ticket keeps what code found at each head the builder left: red, then green.
    const checked = ran.facts.filter((f) => f.type === "checked");
    expect(checked.slice(0, 2)).toMatchObject([
      { result: "red", failed: [NAME] },
      { result: "green", failed: [] },
    ]);
    expect(checked[0]?.head).not.toBe(checked[1]?.head);
    expect(checked[1]?.commands).toEqual([
      {
        command: "node_modules/.bin/vitest run --reporter=json --outputFile={out}",
        code: 0,
        ms: expect.any(Number),
      },
    ]);

    // The mutation step ran no suite of its own, and its end names the green checks it trusted.
    const mutation = ran.facts.find((f) => f.type === "ended" && f.stage === "mutation");
    const { type: _, ...green } = checked[1] ?? { type: "" };
    expect(mutation?.trusted).toEqual(green);
  });

  // Self-fix PR 4: a red head with more failing tests than the ticket keeps. The fact, the build's
  // end and the carry hold the first 50; the comment names those and says how many more.
  it("keeps the first 50 failing tests of a red head, and a comment says how many more", async () => {
    const name = (n: number) => `src/many.test.ts > many > case ${n}`;
    const failed = Array.from({ length: 51 }, (_, i) => name(i));
    /** A build that changes something each round, so each round's head is new. */
    const round = (n: number) => [{ path: "src/round.ts", text: `export const round = ${n};\n` }];
    const ran = await lane({
      within: 50,
      picks: { approve: "approve", rounds_spent: "stop" },
      fake: { writesAt: { build: { 0: round(1), 1: round(2), 2: round(3) } } },
      checksSay: (head) => ({
        head,
        commands: [
          {
            command: "node_modules/.bin/vitest run --reporter=json --outputFile={out}",
            code: 1,
            ms: 8_120,
          },
        ],
        result: "red",
        failed,
        tail: `${name(0)}: AssertionError: expected 1 to be 2`,
      }),
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    expect(ran.stages.slice(4), said).toEqual(["build", "build", "build"]);
    const fifty = failed.slice(0, 50);
    const checked = ran.facts.filter((f) => f.type === "checked");
    expect(checked).toHaveLength(3);

    for (const fact of checked) {
      expect(fact.failed).toEqual(fifty);
    }

    const builds = ran.facts.filter((f) => f.type === "ended" && f.stage === "build");

    for (const end of builds) {
      expect(end.failed).toEqual(fifty);
    }

    // One comment per red head, from code's checks: each name as a code span, and the rest counted.
    const red = ran.facts
      .filter((f) => f.type === "commented")
      .map((f) => String(f.body))
      .filter((body) => body.includes("The repository's own tests fail at this head:"));
    expect(red).toHaveLength(3);

    for (const body of red) {
      expect(body).toContain(`\`${name(49)}\``);
      expect(body).not.toContain(`\`${name(50)}\``);
      expect(body).toContain("And 1 more.");
      expect(body).toContain("expected 1 to be 2");
    }

    expect(ran.lines.at(-1)).toContain("ended: stuck:rounds_spent");
  });

  // Self-fix PR 4: the mutants job's commit is a new head, and code runs the checks there too. Red
  // there is kept as red: the review never reads that head, and the lane is never done. Self-fix PR
  // 11, the guard after the mutants job: red there is `back("build", "names")`, so the builder gets
  // the failing test, a round up, and the lane does not stop there.
  it("runs the checks again on the mutants job's commit, and red there goes back to the build, a round up, with the failing test, before any review", async () => {
    const NAME = "src/lower-spaces.test.ts > lower > cuts spaces";
    const VITEST = "node_modules/.bin/vitest run --reporter=json --outputFile={out}";
    const ran = await lane({
      within: 50,
      // Every head after the first is red, so the rounds run out: the person stops there.
      picks: { ...YES, rounds_spent: "stop" },
      checksSay: (head, nth) =>
        nth === 0
          ? {
              head,
              commands: [{ command: VITEST, code: 0, ms: 8_120 }],
              result: "green",
              failed: [],
              tail: "",
            }
          : {
              head,
              commands: [{ command: VITEST, code: 1, ms: 8_120 }],
              result: "red",
              failed: [NAME],
              tail: `${NAME}: boom`,
            },
    });
    const said = ran.lines.join("\n");
    expect(ran.lines, said).not.toContain(TIMED_OUT);
    expect(ran.stages.slice(4, 8), said).toEqual(["build", "mutation", "mutants", "build"]);
    // No review ever reads a red head.
    expect(ran.stages, said).not.toContain("review");
    const checked = ran.facts.filter((f) => f.type === "checked");
    expect(checked.slice(0, 2).map((f) => f.result)).toEqual(["green", "red"]);
    expect(checked[1]?.failed).toEqual([NAME]);
    expect(checked[1]?.head).not.toBe(checked[0]?.head);
    // The red comment for the mutants job's head names its test.
    const red = ran.facts
      .filter((f) => f.type === "commented")
      .map((f) => String(f.body))
      .filter((body) => body.includes("The repository's own tests fail at this head:"));
    expect(red[0]).toContain(`\`${NAME}\``);
    // The build after it is the next round, and is told the test that fails.
    const builds = ran.facts.filter((f) => f.type === "started" && f.stage === "build");
    expect(builds[1]?.round, said).toBe(2);
    expect(codexRuns(ran.dir).filter((r) => r.step === "build")[1]?.prompt).toContain(NAME);
    // Red is red, never `checks_not_run`, and the lane does not stop on it: only the spent rounds ask.
    expect(said).not.toContain("checks_not_run");
    expect(said).not.toContain("stuck:checks_red");
    expect(askedFor(ran, "rounds_spent")).toHaveLength(1);
    expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
  });

  // Self-fix PR 3: read once, as the lane starts, so a later edit cannot change a run.
  it("keeps the repository's `[build] send_back` in the lane as it starts", async () => {
    expect(await keptAtStart(false)).toMatchObject({ sendBack: false });
    expect(await keptAtStart(true)).toMatchObject({ sendBack: true });
  });

  it("does not merge when the person says no", async () => {
    const ran = await lane({ picks: { approve: "approve", merge: "no" } });
    expect(onMain(ran.remote, "src/lower.ts")).toBeNull();
    expect(ran.stages).not.toContain("merge");
    expect(ran.lines.at(-1)).not.toContain("ended: done");
  });

  it("refuses a ticket someone else filed, before any agent starts", async () => {
    const ran = await lane({ writer: "user:someone" });
    expect(ran.stages).toEqual([]);
    expect(ran.lines.join("\n")).toMatch(/not_yours/);
    expect(codexRuns(ran.dir)).toEqual([]);
  });

  it("says what is missing when its checkout has no origin", async () => {
    const ran = await lane({ noOrigin: true });
    expect(ran.stages).toEqual([]);
    expect(ran.lines.join("\n")).toMatch(/ended: stuck:step_failed\. .* has no origin/);
    expect(codexRuns(ran.dir)).toEqual([]);
  });

  it("resumes after a kill inside an agent's run, and ends each step once", async () => {
    const ran = await lane({
      title: "[slow-build] Read names in one form",
      killAt: "test_writer: done",
      picks: YES,
    });
    expect(ran.lines).toContain(KILLED);
    expect(ran.stages).toEqual(WHOLE);
    expect(ran.lines.at(-1)).toContain("ended: done");
    expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");
    const steps = codexRuns(ran.dir).map((r) => r.step);
    expect(steps.filter((s) => s === "plan")).toHaveLength(1);
    expect(steps.filter((s) => s === "tests")).toHaveLength(1);
    // The run the kill cut short starts over: one that was killed, one that ended. Never a third.
    expect(steps.filter((s) => s === "build").length).toBeLessThanOrEqual(2);
  });

  it("resumes after a kill and does no step twice", async () => {
    const ran = await lane({ killAt: "build: done", picks: YES });
    expect(ran.lines).toContain(KILLED);
    expect(ran.stages).toEqual(WHOLE);
    expect(ran.lines.at(-1)).toContain("ended: done");
    const steps = codexRuns(ran.dir).map((r) => r.step);
    expect(steps.filter((s) => s === "plan")).toHaveLength(1);
    expect(steps.filter((s) => s === "build")).toHaveLength(1);
    expect(ran.facts.filter((f) => f.type === "asked" && String(f.ask).startsWith("a-approve"))).toHaveLength(1);
  });
});
