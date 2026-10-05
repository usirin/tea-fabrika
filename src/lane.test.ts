import { replay } from "@demlik/tea";
import { drive } from "@demlik/tea/testing/effect";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { interpret } from "./handlers.ts";
import { type Issue, testNames } from "./issue.ts";
import { type Lane, lane, MAX_ATTEMPTS } from "./lane.ts";
import { type ScriptedBuild, scriptedBuilder, scriptedWorkspace } from "./scripted.ts";
import { type CheckResult, type Prepared, Workspace } from "./services.ts";

const slugify = { file: "slugify.js", name: "slugify" } as const;

const issue: Issue = {
  id: "1",
  title: "slugify turns a title into a URL slug",
  goal: "slugify turns a title into a URL slug",
  body: "Make slugify(title) in slugify.js return a URL slug.",
  criteria: [
    { kind: "example", id: "lower", rule: "The slug is lower case", ...slugify, examples: [{ call: `slugify("Hello")`, result: `"hello"` }] },
    { kind: "example", id: "dashes", rule: "Spaces become single dashes", ...slugify, examples: [{ call: `slugify("a  b")`, result: `"a-b"` }] },
    { kind: "example", id: "ascii", rule: "Characters outside a-z and 0-9 are dropped", ...slugify, examples: [{ call: `slugify("é1")`, result: `"1"` }] },
  ],
};

const green: CheckResult = { passed: true, output: "3 passed", diff: "+ slugify", passingTests: testNames(issue), touched: [] };
const red: CheckResult = { passed: false, output: "1 failed: dashes", diff: "", passingTests: [], touched: [] };
/** The builder's conversation, named by whoever starts the lane. */
const SESSION = "lane-session";

interface Script {
  readonly issue?: Issue;
  readonly prepared?: readonly Prepared[];
  readonly builder: readonly ScriptedBuild[];
  readonly checks: readonly CheckResult[];
}

/** Start one lane on the issue and drive it until it goes quiet. No model, no network. */
async function runLane(script: Script) {
  const builder = scriptedBuilder(script.builder);
  const layers = Layer.mergeAll(builder.layer, scriptedWorkspace(script.checks, script.prepared));
  const initial: Lane = { phase: "idle" };
  const result = await Effect.runPromise(
    drive(lane, initial, { type: "start", issue: script.issue ?? issue, session: SESSION }, interpret).pipe(
      Effect.provide(layers),
    ),
  );
  return {
    ...result,
    cmds: result.trace.flatMap((entry) => (entry.kind === "cmd" ? [entry.cmd.type] : [])),
    feedback: builder.requests.map((request) => request.feedback),
    sessions: builder.requests.map((request) => request.session),
  };
}

describe("a lane", () => {
  it("writes the tests, builds, runs them and finishes, with no model judging", async () => {
    const { state, cmds } = await runLane({ builder: ["ok"], checks: [green] });

    expect(state).toMatchObject({ phase: "done", attempt: 1 });
    expect(cmds).toEqual(["prepare", "build", "check"]);
  });

  it("sends failing tests back to the builder with the output", async () => {
    const { state, feedback, sessions } = await runLane({ builder: ["ok", "ok"], checks: [red, green] });

    expect(state).toMatchObject({ phase: "done", attempt: 2 });
    expect(feedback).toEqual([null, "Tests failed:\n1 failed: dashes"]);
    // The lane names the conversation up front; only the first build starts it.
    expect(sessions).toEqual([
      { id: SESSION, continues: false },
      { id: SESSION, continues: true },
    ]);
  });

  it("sends back a change to a locked test, even when everything passed", async () => {
    const { state, feedback } = await runLane({
      builder: ["ok", "ok"],
      checks: [{ ...green, touched: ["criteria.test.js"] }, green],
    });

    expect(state).toMatchObject({ phase: "done", attempt: 2 });
    expect(feedback[1]).toContain("You changed criteria.test.js");
  });

  it("parks once the attempts are spent", async () => {
    const { state, feedback } = await runLane({ builder: ["ok", "ok", "ok"], checks: [red, red, red] });

    expect(state).toMatchObject({ phase: "parked", attempt: MAX_ATTEMPTS, why: { kind: "out_of_attempts" } });
    expect(feedback).toHaveLength(MAX_ATTEMPTS);
  });

  it("parks when the builder fails", async () => {
    const { state } = await runLane({ builder: ["fail"], checks: [] });

    expect(state).toMatchObject({ phase: "parked", why: { kind: "builder_failed" } });
  });

  it("parks on a contradiction, with the rule and the example side by side", async () => {
    const { state, cmds } = await runLane({
      builder: [{ kind: "contradiction", criterion: "ascii", call: `slugify("é1")`, why: "é is a letter" }],
      checks: [],
    });

    expect(state).toMatchObject({
      phase: "parked",
      why: {
        kind: "contradiction",
        criterion: "ascii",
        rule: "Characters outside a-z and 0-9 are dropped",
        call: `slugify("é1")`,
        result: `"1"`,
        why: "é is a letter",
      },
    });
    // Nothing was run against code built to a disputed example.
    expect(cmds).toEqual(["prepare", "build"]);
  });

  it("sends back a contradiction that names an example the issue does not have", async () => {
    const { state, feedback } = await runLane({
      builder: [{ kind: "contradiction", criterion: "ascii", call: `slugify("x")`, why: "?" }, "ok"],
      checks: [green],
    });

    expect(state).toMatchObject({ phase: "done", attempt: 2 });
    expect(feedback[1]).toContain("has no such example");
  });

  it("parks when the builder says it is blocked", async () => {
    const { state } = await runLane({ builder: [{ kind: "blocked", why: "slugify.js is generated" }], checks: [] });

    expect(state).toMatchObject({ phase: "parked", why: { kind: "builder_blocked", why: "slugify.js is generated" } });
  });

  it("parks before writing any test when a rule has no check yet", async () => {
    const { state, cmds } = await runLane({
      issue: { ...issue, criteria: [...issue.criteria, { kind: "unchecked", id: "docs", rule: "The README says so", why: "it is about docs" }] },
      builder: [],
      checks: [],
    });

    expect(state).toMatchObject({ phase: "parked", why: { kind: "unchecked", criteria: ["docs"] } });
    expect(cmds).toEqual([]);
  });

  it("parks when every example holds before any change", async () => {
    const { state, cmds } = await runLane({
      prepared: [{ passing: testNames(issue), failing: [], output: "" }],
      builder: [],
      checks: [],
    });

    expect(state).toMatchObject({ phase: "parked", why: { kind: "nothing_to_build" } });
    expect(cmds).toEqual(["prepare"]);
  });

  it("keeps an example that holds already as a guard, and builds for the rest", async () => {
    const [lower, ...rest] = testNames(issue);
    const { state } = await runLane({
      prepared: [{ passing: [lower ?? ""], failing: rest, output: "" }],
      builder: ["ok"],
      checks: [green],
    });

    expect(state).toMatchObject({ phase: "done" });
  });

  it("parks when an example's test did not run at all", async () => {
    const [lower, dashes] = testNames(issue);
    const { state } = await runLane({
      prepared: [{ passing: [], failing: [lower ?? "", dashes ?? ""], output: "SyntaxError" }],
      builder: [],
      checks: [],
    });

    expect(state).toMatchObject({ phase: "parked", why: { kind: "tests_broken", missing: [`ascii: slugify("é1")`], output: "SyntaxError" } });
  });

  it("parks when the tests could not be written or run", async () => {
    const failing = Layer.mergeAll(
      scriptedBuilder([]).layer,
      Layer.succeed(Workspace, {
        prepare: () => Effect.fail({ _tag: "could_not_run" as const }),
        check: () => Effect.die("unused"),
      }),
    );
    const { state } = await Effect.runPromise(
      drive(lane, { phase: "idle" }, { type: "start", issue, session: SESSION }, interpret).pipe(Effect.provide(failing)),
    );

    expect(state).toMatchObject({ phase: "parked", why: { kind: "could_not_run", step: "prepare" } });
  });

  it("replays to the same state from its Msgs alone", async () => {
    const { state, trace } = await runLane({ builder: ["ok", "ok"], checks: [red, green] });

    const msgs = trace.flatMap((entry) => (entry.kind === "msg" ? [entry.msg] : []));
    const replayed = replay(lane, { msgs, ctx: undefined });

    expect(replayed.state).toEqual(state);
  });
});
