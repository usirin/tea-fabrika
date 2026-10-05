import { replay } from "@demlik/tea";
import { drive } from "@demlik/tea/testing/effect";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { interpret } from "./handlers.ts";
import { type Issue, testNames } from "./issue.ts";
import { type Lane, lane, MAX_ATTEMPTS } from "./lane.ts";
import {
  type ScriptedBuild,
  scriptedBuilder,
  scriptedMatcher,
  scriptedReviewer,
  scriptedRouter,
  scriptedWorkspace,
} from "./scripted.ts";
import { type CheckResult, type Prepared, type Relation, type ReviewReport, Workspace } from "./services.ts";

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

const firstTry = 'export function slugify(title) {\n  return title.toLowerCase().split(" ").join("-");\n}\n';
const secondTry = 'export function slugify(title) {\n  return title.toLowerCase().split(/ +/).join("-");\n}\n';
const seeing = (text: string) => ({ "slugify.js": { text, lines: [1, 2, 3] } });

const green: CheckResult = {
  passed: true,
  output: "3 passed",
  diff: "+ slugify",
  passingTests: testNames(issue),
  touched: [],
  changed: ["slugify.js"],
  snapshot: seeing(firstTry),
};
const red: CheckResult = { ...green, passed: false, output: "1 failed: dashes", passingTests: [] };
/** The builder's conversation, named by whoever starts the lane. */
const SESSION = "lane-session";

interface Script {
  readonly issue?: Issue;
  readonly prepared?: readonly Prepared[];
  readonly builder: readonly ScriptedBuild[];
  readonly checks: readonly CheckResult[];
  /** What the router says about each text it is asked about. */
  readonly routes?: Readonly<Record<string, Relation>>;
  /** What the reviewer finds each round. Left out, every review is clean. */
  readonly reviews?: readonly ReviewReport[];
  /** Which decided finding each new finding's text repeats. */
  readonly matches?: Readonly<Record<string, string>>;
}

/** Every service but the builder and the workspace, answering nothing unless told. */
const reviewLayers = (script: Pick<Script, "routes" | "reviews" | "matches"> = {}) => {
  const router = scriptedRouter(script.routes);
  const reviewer = scriptedReviewer(script.reviews);
  const matcher = scriptedMatcher(script.matches);
  return { router, reviewer, matcher, layer: Layer.mergeAll(router.layer, reviewer.layer, matcher.layer) };
};

/** Start one lane on the issue and drive it until it goes quiet. No model, no network. */
async function runLane(script: Script) {
  const builder = scriptedBuilder(script.builder);
  const { router, reviewer, layer } = reviewLayers(script);
  const layers = Layer.mergeAll(builder.layer, layer, scriptedWorkspace(script.checks, script.prepared));
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
    asked: router.asked,
    reviews: reviewer.requests,
  };
}

// Review on its own is tested in review.test.ts. Here: the lane hands it the
// change and acts on how it ends.

const spaces = { file: "slugify.js", line: 2, quote: 'split(" ")', problem: "Two spaces in a row make two dashes" };
const found = (...findings: ReviewReport["findings"]): ReviewReport => ({ findings, rechecks: [] });
const fixedNow = (id: string): ReviewReport => ({ findings: [], rechecks: [{ id, fixed: true }] });

describe("a lane with review in it", () => {
  it("sends a change review fails back to the builder, and finishes once review passes", async () => {
    const { state, feedback, reviews } = await runLane({
      builder: ["ok", "ok"],
      checks: [green, { ...green, snapshot: seeing(secondTry) }],
      reviews: [found(spaces), fixedNow("r1-1")],
      routes: { [spaces.problem]: "related" },
    });

    expect(feedback[1]).toContain("[r1-1] slugify.js:2");
    // The second review was asked about the open finding, and closed it.
    expect(reviews[1]?.open.map((f) => f.id)).toEqual(["r1-1"]);
    expect(state).toMatchObject({ phase: "done", attempt: 2, open: [] });
  });

  it("keeps a filed finding on the finished lane for the person who reads it", async () => {
    const { state } = await runLane({
      builder: ["ok"],
      checks: [green],
      reviews: [found(spaces)],
      routes: { [spaces.problem]: "unrelated" },
    });

    expect(state).toMatchObject({ phase: "done", notes: [{ id: "r1-1", problem: spaces.problem }] });
  });

  it("parks a disputed finding, and withdraws it when a person agrees with the builder", async () => {
    const { state: parked } = await runLane({
      builder: ["ok", { kind: "dispute", finding: "r1-1", why: "double spaces are out of scope" }],
      checks: [green],
      reviews: [found(spaces)],
      routes: { [spaces.problem]: "related" },
    });
    const builder = scriptedBuilder(["ok"]);
    const { reviewer, layer } = reviewLayers();
    const { state } = await Effect.runPromise(
      drive(lane, parked, { type: "answer", answer: { park: "finding_disputed", answer: { kind: "withdraw" } }, at: 0 }, interpret).pipe(
        Effect.provide(Layer.mergeAll(builder.layer, layer, scriptedWorkspace([green]))),
      ),
    );

    expect(parked).toMatchObject({
      phase: "parked",
      why: { kind: "finding_disputed", finding: { id: "r1-1" }, why: "double spaces are out of scope" },
    });
    expect(builder.requests[0]?.feedback).toBe("A person agreed finding r1-1 was wrong, and withdrew it.");
    expect(reviewer.requests[0]?.open).toEqual([]);
    // The next review is told it was withdrawn, so it does not come back.
    expect(reviewer.requests[0]?.decided).toMatchObject([{ id: "r1-1", decision: "withdrawn" }]);
    expect(state).toMatchObject({ phase: "done", withdrawn: [{ id: "r1-1" }] });
  });

  it("does not park again on a filed finding the next round raises in other words", async () => {
    const again = { file: "slugify.js", line: 2, quote: "split(/ +/)", problem: "Runs of spaces become runs of dashes" };
    const empty = { file: "slugify.js", line: 2, quote: "toLowerCase()", problem: "An empty title gives an empty slug" };
    const { state, reviews, asked, cmds } = await runLane({
      builder: ["ok", "ok"],
      checks: [green, { ...green, snapshot: seeing(secondTry) }],
      // Round 1: the double-space point (filed) and an empty-title point (to fix).
      // Round 2: the empty-title one is fixed, and the double-space one comes back in other words.
      reviews: [found(spaces, empty), { findings: [again], rechecks: [{ id: "r1-2", fixed: true }] }],
      routes: { [spaces.problem]: "unrelated", [empty.problem]: "related" },
      matches: { [again.problem]: "r1-1" },
    });

    expect(reviews[1]?.decided).toMatchObject([{ id: "r1-1", decision: "filed" }]);
    // The repeat was matched and never routed, so nobody was asked about it.
    expect(asked).not.toContain(again.problem);
    expect(cmds.filter((c) => c === "match")).toHaveLength(1);
    expect(state).toMatchObject({
      phase: "done",
      attempt: 2,
      notes: [{ id: "r1-1" }],
      matched: [{ finding: { id: "r2-1", problem: again.problem }, to: "r1-1" }],
    });
  });

  it("passes a person's answer down to a parked review", async () => {
    const helper = { file: "util.js", why: "a trim helper slugify uses" };
    const { state: parked } = await runLane({
      builder: [{ kind: "done", summary: "built", deviations: [helper] }],
      checks: [{ ...green, changed: ["slugify.js", "util.js"] }],
    });
    const { state } = await Effect.runPromise(
      drive(lane, parked, { type: "answer", answer: { park: "scope_unsure", answer: { kind: "accept" } }, at: 0 }, interpret).pipe(
        Effect.provide(Layer.mergeAll(scriptedBuilder([]).layer, reviewLayers().layer, scriptedWorkspace([]))),
      ),
    );

    expect(parked).toMatchObject({ phase: "reviewing", review: { phase: "parked", why: { kind: "scope_unsure" } } });
    expect(state).toMatchObject({ phase: "done", deviations: [helper] });
  });
});

describe("a lane", () => {
  it("writes the tests, builds, runs them, has it reviewed and finishes", async () => {
    const { state, cmds } = await runLane({ builder: ["ok"], checks: [green] });

    expect(state).toMatchObject({ phase: "done", attempt: 1 });
    expect(cmds).toEqual(["prepare", "build", "check", "inspect"]);
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
      reviewLayers().layer,
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
