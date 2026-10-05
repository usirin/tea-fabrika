import { replay } from "@demlik/tea";
import { drive } from "@demlik/tea/testing/effect";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { interpret } from "./handlers.ts";
import type { Issue } from "./issue.ts";
import { type Lane, type LaneMsg, lane, type ParkAnswer } from "./lane.ts";
import { type ScriptedVerdict, scriptedBuilder, scriptedJev, scriptedWorkspace } from "./scripted.ts";
import type { CheckResult } from "./services.ts";

// Kill the lane after every step and boot it again from what was saved. tea
// saves the state after each step and before that step's Cmds run, so a kill
// leaves the state holding Cmds whose answers never came. On boot the host
// sends `resume`, and the lane asks for them again.

const issue: Issue = {
  id: "1",
  title: "slugify turns a title into a URL slug",
  goal: "slugify turns a title into a URL slug",
  body: "Add slugify(title) to src/slugify.ts.",
  criteria: [
    { id: "lower", text: "The slug is lower case" },
    { id: "dashes", text: "Spaces become single dashes" },
  ],
};
const SESSION = "lane-session";

const green: CheckResult = { passed: true, output: "2 passed", diff: "+ slugify", passingTests: ["lower", "dashes"] };
const red: CheckResult = { passed: false, output: "1 failed: dashes", diff: "", passingTests: ["lower"] };
const sure = (verdict: ScriptedVerdict[0]): ScriptedVerdict => [verdict, 0.95];

interface Script {
  readonly builder: readonly ("ok" | "fail")[];
  readonly checks: readonly CheckResult[];
  readonly verdicts: Readonly<Record<string, readonly ScriptedVerdict[]>>;
}

/** Drive the lane from `from` with `msg` against the script, and count the work each service did. */
async function driveFrom(from: Lane, msg: LaneMsg, script: Script) {
  const builder = scriptedBuilder(script.builder);
  const layers = Layer.mergeAll(builder.layer, scriptedWorkspace(script.checks), scriptedJev(script.verdicts));
  const result = await Effect.runPromise(drive(lane, from, msg, interpret).pipe(Effect.provide(layers)));
  const cmds = result.trace.flatMap((entry) => (entry.kind === "cmd" ? [entry.cmd] : []));
  return { ...result, builds: builder.requests, checks: cmds.filter((c) => c.type === "check").length, asks: cmds.filter((c) => c.type === "resilient_run").length };
}

/** A Msg as the trace holds it: the lane's own, or a Cmd's answer. */
type Folded = { readonly type: string; readonly cmd?: object };

/** The criterion a Jev answer is about: its Cmd's key. */
const keyOf = (m: Folded) => (m.cmd !== undefined && "key" in m.cmd ? m.cmd.key : undefined);

/** What is left of the script once `msgs` have been folded: each answer is used once. */
function rest(script: Script, msgs: readonly Folded[]): Script {
  const count = (type: string) => msgs.filter((m) => m.type === type).length;
  const builds = count("build_ok") + count("build_err");
  const checks = count("check_ok") + count("check_err");
  const asked = (text: string) => {
    const id = issue.criteria.find((c) => c.text === text)?.id;
    return msgs.filter((m) => m.type === "resilient_run_ok" && keyOf(m) === id).length;
  };
  return {
    builder: script.builder.slice(builds),
    checks: script.checks.slice(checks),
    verdicts: Object.fromEntries(Object.entries(script.verdicts).map(([text, queue]) => [text, queue.slice(asked(text))])),
  };
}

/** The part of a finished lane that says how it ended. */
const ending = (s: Lane) =>
  s.phase === "idle" ? s : { phase: s.phase, attempt: s.attempt, session: s.session, ...("why" in s ? { why: s.why } : {}) };

/** The Cmds still waiting on an answer in a saved state: the ones a kill can make run twice. */
const inFlight = (s: Lane): readonly string[] =>
  s.phase === "building"
    ? ["build"]
    : s.phase === "checking"
      ? ["check"]
      : s.phase === "judging"
        ? Object.values(s.judge.calls).flatMap((c) => (c.phase === "running" ? ["resilient_run"] : []))
        : [];

const scripts: Readonly<Record<string, Script>> = {
  "done on the first try": {
    builder: ["ok"],
    checks: [green],
    verdicts: { "The slug is lower case": [sure("met")], "Spaces become single dashes": [sure("met")] },
  },
  "a failed test run, then done": {
    builder: ["ok", "ok"],
    checks: [red, green],
    verdicts: { "The slug is lower case": [sure("met")], "Spaces become single dashes": [sure("met")] },
  },
  "a judge's not met, then done": {
    builder: ["ok", "ok"],
    checks: [green, green],
    verdicts: {
      "The slug is lower case": [sure("met"), sure("met")],
      "Spaces become single dashes": [sure("not_met"), sure("met")],
    },
  },
  "parked when the judge is unsure": {
    builder: ["ok"],
    checks: [green],
    verdicts: { "The slug is lower case": [["met", 0.55]], "Spaces become single dashes": [sure("met")] },
  },
  "parked when the builder fails": { builder: ["fail"], checks: [], verdicts: {} },
};

describe("a lane killed after any step", () => {
  for (const [name, script] of Object.entries(scripts)) {
    it(`${name}: ends the same, and only the work in flight runs again`, async () => {
      const whole = await driveFrom({ phase: "idle" }, { type: "start", issue, session: SESSION }, script);
      const msgs = whole.trace.flatMap((entry) => (entry.kind === "msg" ? [entry.msg] : []));

      for (let step = 1; step < msgs.length; step++) {
        const before = msgs.slice(0, step);
        // What a kill right after this step leaves on disk: JSON, read back.
        const saved = JSON.parse(JSON.stringify(replay(lane, { msgs: before, ctx: undefined }).state)) as Lane;
        const left = rest(script, before);
        const at = `killed after step ${step} (${msgs[step - 1]?.type})`;
        const again = await driveFrom(saved, { type: "resume", at: Date.now() }, left).catch((error: unknown) => {
          throw new Error(`${at}: ${String(error)}`, { cause: error });
        });

        expect(ending(again.state), at).toEqual(ending(whole.state));
        // The first thing the booted lane does is ask again for exactly what
        // was in flight: those, and only those, may have run twice.
        const resent = again.trace.flatMap((entry) => (entry.kind === "cmd" ? [entry.cmd.type] : [])).slice(0, inFlight(saved).length);
        expect(resent, at).toEqual(inFlight(saved));
        // Work that finished before the kill is never done again: the answers
        // before it and after it add up to one uninterrupted run.
        const answered = (type: string) => before.filter((m) => m.type === `${type}_ok` || m.type === `${type}_err`).length;
        expect(answered("build") + again.builds.length, at).toBe(whole.builds.length);
        expect(answered("check") + again.checks, at).toBe(whole.checks);
        expect(answered("resilient_run") + again.asks, at).toBe(whole.asks);
      }
    });
  }

  it("a killed first build comes back in the same conversation", async () => {
    const script = scripts["done on the first try"] as Script;
    const saved = replay(lane, { msgs: [{ type: "start", issue, session: SESSION }], ctx: undefined }).state;
    const again = await driveFrom(saved, { type: "resume", at: Date.now() }, script);

    // `continues` is a guess: the conversation may or may not have been saved
    // before the kill, and the builder tries the other way if it is wrong.
    expect(again.builds.map((b) => b.session)).toEqual([{ id: SESSION, continues: true }]);
    expect(again.state.phase).toBe("done");
  });

  it("a finished lane does nothing on resume", async () => {
    const script = scripts["done on the first try"] as Script;
    const whole = await driveFrom({ phase: "idle" }, { type: "start", issue, session: SESSION }, script);
    const again = await driveFrom(whole.state, { type: "resume", at: Date.now() }, { builder: [], checks: [], verdicts: {} });

    expect(again.state).toEqual(whole.state);
    expect(again.trace.filter((entry) => entry.kind === "cmd")).toEqual([]);
  });
});

describe("a parked lane", () => {
  const parkedOn = async (script: Script) =>
    (await driveFrom({ phase: "idle" }, { type: "start", issue, session: SESSION }, script)).state;
  const answer = (a: ParkAnswer): LaneMsg => ({ type: "answer", answer: a, at: Date.now() });
  const unsure = scripts["parked when the judge is unsure"] as Script;

  it("ignores an answer meant for another kind of park", async () => {
    const parked = await parkedOn(unsure);
    const after = await driveFrom(parked, answer({ park: "builder_failed", answer: { kind: "retry" } }), { builder: [], checks: [], verdicts: {} });

    expect(after.state).toEqual(parked);
  });

  it("finishes when a person accepts an unsure verdict", async () => {
    const parked = await parkedOn(unsure);
    const after = await driveFrom(parked, answer({ park: "judge_unsure", answer: { kind: "accept" } }), { builder: [], checks: [], verdicts: {} });

    expect(after.state.phase).toBe("done");
  });

  it("rebuilds with a person's feedback, in the same conversation", async () => {
    const parked = await parkedOn(unsure);
    const after = await driveFrom(
      parked,
      answer({ park: "judge_unsure", answer: { kind: "rebuild", feedback: "keep the dashes" } }),
      { builder: ["ok"], checks: [green], verdicts: { "The slug is lower case": [sure("met")], "Spaces become single dashes": [sure("met")] } },
    );

    expect(after.builds.map((b) => [b.feedback, b.session])).toEqual([["keep the dashes", { id: SESSION, continues: true }]]);
    expect(after.state).toMatchObject({ phase: "done", attempt: 2 });
  });

  it("retries a failed builder, and stops when told to drop", async () => {
    const parked = await parkedOn(scripts["parked when the builder fails"] as Script);
    const retried = await driveFrom(parked, answer({ park: "builder_failed", answer: { kind: "retry" } }), {
      builder: ["ok"],
      checks: [green],
      verdicts: { "The slug is lower case": [sure("met")], "Spaces become single dashes": [sure("met")] },
    });
    const dropped = await driveFrom(parked, answer({ park: "builder_failed", answer: { kind: "drop" } }), { builder: [], checks: [], verdicts: {} });

    expect(retried.state.phase).toBe("done");
    expect(dropped.state).toMatchObject({ phase: "dropped", why: { kind: "builder_failed" } });
  });

  it("gets more attempts when a person grants them", async () => {
    const parked = await parkedOn({ builder: ["ok", "ok", "ok"], checks: [red, red, red], verdicts: {} });
    const after = await driveFrom(parked, answer({ park: "out_of_attempts", answer: { kind: "more", attempts: 1 } }), {
      builder: ["ok"],
      checks: [green],
      verdicts: { "The slug is lower case": [sure("met")], "Spaces become single dashes": [sure("met")] },
    });

    expect(parked).toMatchObject({ phase: "parked", why: { kind: "out_of_attempts" } });
    expect(after.state).toMatchObject({ phase: "done", attempt: 4, limit: 4 });
  });
});
