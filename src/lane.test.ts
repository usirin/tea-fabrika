import { replay } from "@demlik/tea";
import { drive } from "@demlik/tea/testing/effect";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { interpret } from "./handlers.ts";
import type { Issue } from "./issue.ts";
import { type Lane, lane, MAX_ATTEMPTS } from "./lane.ts";
import {
  SCRIPTED_SESSION,
  type ScriptedVerdict,
  scriptedBuilder,
  scriptedJev,
  scriptedWorkspace,
} from "./scripted.ts";
import type { CheckResult } from "./services.ts";

const issue: Issue = {
  id: "1",
  title: "slugify turns a title into a URL slug",
  body: "Add slugify(title) to src/slugify.ts.",
  criteria: [
    { id: "lower", text: "The slug is lower case" },
    { id: "dashes", text: "Spaces become single dashes" },
    { id: "ascii", text: "Characters outside a-z and 0-9 are dropped" },
  ],
};

const green: CheckResult = { passed: true, output: "3 passed", diff: "+ slugify" };
const red: CheckResult = { passed: false, output: "1 failed: dashes", diff: "" };
const sure = (verdict: ScriptedVerdict[0]): ScriptedVerdict => [verdict, 0.95];

interface Script {
  readonly builder: readonly ("ok" | "fail")[];
  readonly checks: readonly CheckResult[];
  readonly verdicts: Readonly<Record<string, readonly ScriptedVerdict[]>>;
}

/** Start one lane on the issue and drive it until it goes quiet. No model, no network. */
async function runLane(script: Script) {
  const builder = scriptedBuilder(script.builder);
  const layers = Layer.mergeAll(
    builder.layer,
    scriptedWorkspace(script.checks),
    scriptedJev(script.verdicts),
  );
  const initial: Lane = { phase: "idle" };
  const result = await Effect.runPromise(
    drive(lane, initial, { type: "start", issue }, interpret).pipe(
      Effect.provide(layers),
    ),
  );
  return {
    ...result,
    feedback: builder.requests.map((request) => request.feedback),
    sessions: builder.requests.map((request) => request.session),
  };
}

const allMet = {
  "The slug is lower case": [sure("met")],
  "Spaces become single dashes": [sure("met")],
  "Characters outside a-z and 0-9 are dropped": [sure("met")],
};

describe("a lane", () => {
  it("builds, checks, judges every criterion and finishes", async () => {
    const { state, trace } = await runLane({
      builder: ["ok"],
      checks: [green],
      verdicts: allMet,
    });

    expect(state).toMatchObject({ phase: "done", attempt: 1 });
    // One build, one test run, and one Jev call per criterion.
    expect(
      trace.flatMap((entry) => (entry.kind === "cmd" ? [entry.cmd.type] : [])),
    ).toEqual(["build", "check", "resilient_run", "resilient_run", "resilient_run"]);
  });

  it("sends failing tests back to the builder with the output", async () => {
    const { state, feedback, sessions } = await runLane({
      builder: ["ok", "ok"],
      checks: [red, green],
      verdicts: allMet,
    });

    expect(state).toMatchObject({ phase: "done", attempt: 2 });
    expect(feedback).toEqual([null, "Tests failed:\n1 failed: dashes"]);
    // The retry goes back into the conversation the first build handed over.
    expect(sessions).toEqual([null, SCRIPTED_SESSION]);
    expect(state).toMatchObject({ session: SCRIPTED_SESSION });
  });

  it("rebuilds when the judge says a criterion is not met", async () => {
    const { state, feedback } = await runLane({
      builder: ["ok", "ok"],
      checks: [green, green],
      verdicts: {
        ...allMet,
        "Spaces become single dashes": [sure("not_met"), sure("met")],
        "The slug is lower case": [sure("met"), sure("met")],
        "Characters outside a-z and 0-9 are dropped": [sure("met"), sure("met")],
      },
    });

    expect(state).toMatchObject({ phase: "done", attempt: 2 });
    expect(feedback).toEqual([null, "Not met: Spaces become single dashes"]);
  });

  it("parks on a person when the judge is not sure", async () => {
    const { state, feedback } = await runLane({
      builder: ["ok"],
      checks: [green],
      verdicts: { ...allMet, "The slug is lower case": [["not_met", 0.55]] },
    });

    expect(state).toMatchObject({
      phase: "parked",
      why: {
        kind: "judge_unsure",
        answers: [{ id: "lower", choice: "not_met", confidence: 0.55 }],
      },
    });
    // An unsure "not met" is not a reason to rebuild.
    expect(feedback).toEqual([null]);
  });

  it("parks when the judge cannot tell from the diff", async () => {
    const { state } = await runLane({
      builder: ["ok"],
      checks: [green],
      verdicts: { ...allMet, "Spaces become single dashes": [sure("cannot_tell")] },
    });

    expect(state).toMatchObject({
      phase: "parked",
      why: { kind: "judge_unsure", answers: [{ id: "dashes", choice: "cannot_tell" }] },
    });
  });

  it("parks once the attempts are spent", async () => {
    const { state, feedback } = await runLane({
      builder: ["ok", "ok", "ok"],
      checks: [red, red, red],
      verdicts: {},
    });

    expect(state).toMatchObject({
      phase: "parked",
      attempt: MAX_ATTEMPTS,
      why: { kind: "out_of_attempts" },
    });
    expect(feedback).toHaveLength(MAX_ATTEMPTS);
  });

  it("parks when the builder fails", async () => {
    const { state } = await runLane({ builder: ["fail"], checks: [], verdicts: {} });

    expect(state).toMatchObject({ phase: "parked", why: { kind: "builder_failed" } });
  });

  it("replays to the same state from its Msgs alone", async () => {
    const { state, trace } = await runLane({
      builder: ["ok", "ok"],
      checks: [red, green],
      verdicts: allMet,
    });

    const msgs = trace.flatMap((entry) => (entry.kind === "msg" ? [entry.msg] : []));
    const replayed = replay(lane, { msgs, ctx: undefined });

    expect(replayed.state).toEqual(state);
  });
});
