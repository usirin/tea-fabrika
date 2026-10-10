import { replay } from "@demlik/tea";
import { drive } from "@demlik/tea/testing/effect";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { interpret } from "./handlers.ts";
import { type ExampleCriterion, type Issue, testNames } from "./issue.ts";
import { type Lane, type LaneKnobs, type LaneMsg, lane } from "./lane.ts";
import type { MissingAnswer } from "./review.ts";
import { DEFAULT_SETTINGS, knobsOf } from "./settings.ts";
import type { Reading } from "./comments.ts";
import type { Comment } from "./tracker.ts";
import {
  type ScriptedBuild,
  scriptedBuilder,
  scriptedCommentReader,
  scriptedFailureReader,
  scriptedMatcher,
  scriptedMissingReader,
  scriptedReviewer,
  scriptedRouter,
  scriptedTracker,
  scriptedWorkspace,
} from "./scripted.ts";
import {
  type CheckResult,
  type FailureCause,
  type FreshRun,
  type Prepared,
  type Relation,
  type ReviewReport,
  Workspace,
} from "./services.ts";

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
  openDecision: null,
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
/** What a lane starts with when `fabrika.toml` sets nothing. */
const KNOBS = knobsOf(DEFAULT_SETTINGS).lane;
const MAX_ATTEMPTS = KNOBS.attempts;

interface Script {
  readonly issue?: Issue;
  readonly prepared?: readonly Prepared[];
  /** Each fresh copy's run. Left out, every fresh copy passes. */
  readonly fresh?: readonly FreshRun[];
  readonly builder: readonly ScriptedBuild[];
  readonly checks: readonly CheckResult[];
  /** What the router says about each text it is asked about. */
  readonly routes?: Readonly<Record<string, Relation>>;
  /** What the reviewer finds each round. Left out, every review is clean. */
  readonly reviews?: readonly ReviewReport[];
  /** Which decided finding each new finding's text repeats. */
  readonly matches?: Readonly<Record<string, string>>;
  /** What the tracker hands back on each fetch of the owner's comments. Left out, there are none. */
  readonly comments?: readonly (readonly Comment[] | "fail")[];
  /** What the reader says each comment's text does. */
  readonly readings?: Readonly<Record<string, Reading | "fail">>;
  /** Whose failure each failed run is. Left out, every one is the builder's change. */
  readonly failures?: readonly (FailureCause | "fail")[];
  /** What the missing-file check answers each round. Left out, it flags nothing. */
  readonly missing?: readonly (MissingAnswer | "fail")[];
  /** What the lane starts with. Left out, today's defaults. */
  readonly knobs?: Partial<LaneKnobs>;
}

/** Every service but the builder and the workspace, answering nothing unless told. */
const reviewLayers = (
  script: Pick<Script, "routes" | "reviews" | "matches" | "comments" | "readings" | "failures" | "missing"> = {},
) => {
  const router = scriptedRouter(script.routes);
  const reviewer = scriptedReviewer(script.reviews);
  const matcher = scriptedMatcher(script.matches);
  const tracker = scriptedTracker(script.comments);
  const reader = scriptedCommentReader(script.readings);
  const failureReader = scriptedFailureReader(script.failures);
  const missingReader = scriptedMissingReader(script.missing);
  return {
    router,
    reviewer,
    matcher,
    tracker,
    reader,
    failureReader,
    layer: Layer.mergeAll(
      router.layer,
      reviewer.layer,
      matcher.layer,
      tracker.layer,
      reader.layer,
      failureReader.layer,
      missingReader.layer,
    ),
  };
};

/** Start one lane on the issue and drive it until it goes quiet. No model, no network. */
async function runLane(script: Script) {
  const builder = scriptedBuilder(script.builder);
  const { router, reviewer, reader, failureReader, layer } = reviewLayers(script);
  const layers = Layer.mergeAll(builder.layer, layer, scriptedWorkspace(script.checks, script.prepared, script.fresh));
  const initial: Lane = { phase: "idle" };
  const result = await Effect.runPromise(
    drive(
      lane,
      initial,
      { type: "start", issue: script.issue ?? issue, session: SESSION, knobs: { ...KNOBS, ...script.knobs } },
      interpret,
    ).pipe(
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
    read: reader.asked,
    failureReader,
  };
}

/** Answer a parked lane and drive it until it goes quiet. */
async function answerLane(parked: Lane, answer: Extract<LaneMsg, { type: "answer" }>["answer"], script: Partial<Script> = {}) {
  const builder = scriptedBuilder(script.builder ?? []);
  const workspace = scriptedWorkspace(script.checks ?? [], script.prepared);
  const { state, trace } = await Effect.runPromise(
    drive(lane, parked, { type: "answer", answer, at: 0 }, interpret).pipe(
      Effect.provide(Layer.mergeAll(builder.layer, reviewLayers(script).layer, workspace)),
    ),
  );
  return {
    state,
    feedback: builder.requests.map((r) => r.feedback),
    cmds: trace.flatMap((entry) => (entry.kind === "cmd" ? [entry.cmd.type] : [])),
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

  describe("a file the missing-file check flags", () => {
    const flagged: MissingAnswer = { kind: "checked", asked: 9, flagged: [{ file: "index.js", yes: 0.84 }] };
    const nothing: MissingAnswer = { kind: "checked", asked: 9, flagged: [] };

    it("goes back to the builder, and the lane finishes once the change touches it", async () => {
      const exports = { file: "index.js", why: "re-exports slugify" };
      const { state, feedback } = await runLane({
        builder: ["ok", { kind: "done", summary: "index.js too", deviations: [exports] }],
        checks: [green, { ...green, changed: ["slugify.js", "index.js"] }],
        routes: { [exports.why]: "related" },
        missing: [flagged, nothing],
      });

      expect(feedback[1]).toContain("[r1-m1] index.js:");
      expect(state).toMatchObject({ phase: "done", attempt: 2, open: [] });
    });

    it("can be disputed with a reason, like any finding, and a person decides", async () => {
      const { state } = await runLane({
        builder: ["ok", { kind: "dispute", finding: "r1-m1", why: "index.js re-exports everything already" }],
        checks: [green],
        missing: [flagged],
      });

      expect(state).toMatchObject({
        phase: "parked",
        why: { kind: "finding_disputed", finding: { kind: "missed", file: "index.js" } },
      });
    });
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
    // Withdrawing says the builder was right, so the build it spent disputing is given back.
    // The disputing build still shows: three builds ran, two were charged.
    expect(state).toMatchObject({ phase: "done", attempt: 2, builds: 3, withdrawn: [{ id: "r1-1" }] });
  });

  it("finishes at the frozen round when each review finds something new", async () => {
    const lines = ["export function slugify(title) {", "  return title;", "}", ""];
    const version = (body: string) => seeing([lines[0], body, lines[2], lines[3]].join("\n"));
    const at = (body: string, problem: string) => ({ file: "slugify.js", line: 2, quote: body.trim(), problem });
    const [one, two, three] = ["  return a;", "  return b;", "  return c;"] as const;
    const { state, cmds } = await runLane({
      builder: ["ok", "ok", "ok"],
      checks: [one, two, three].map((body) => ({ ...green, snapshot: version(body) })),
      // Each round fixes the last finding and turns up a smaller new one.
      reviews: [
        found(at(one, "first point")),
        { findings: [at(two, "second point")], rechecks: [{ id: "r1-1", fixed: true }] },
        { findings: [at(three, "third point")], rechecks: [{ id: "r2-1", fixed: true }] },
      ],
      routes: { "first point": "related", "second point": "related", "third point": "related" },
    });

    expect(state).toMatchObject({ phase: "done", attempt: MAX_ATTEMPTS, notes: [{ id: "r3-1", problem: "third point" }] });
    // The third point was never routed: in a frozen round nothing new can block.
    expect(cmds.filter((c) => c === "route")).toHaveLength(2);
  });

  it("parks instead of building past the limit when a person says a finding stands", async () => {
    const { state: parked } = await runLane({
      builder: ["ok", "ok", { kind: "dispute", finding: "r1-1", why: "it is fine" }],
      checks: [green, green],
      reviews: [found(spaces), found()],
      routes: { [spaces.problem]: "related" },
    });
    const builder = scriptedBuilder([]);
    const { state } = await Effect.runPromise(
      drive(lane, parked, { type: "answer", answer: { park: "finding_disputed", answer: { kind: "stands", note: "" } }, at: 0 }, interpret).pipe(
        Effect.provide(Layer.mergeAll(builder.layer, reviewLayers().layer, scriptedWorkspace([]))),
      ),
    );

    expect(parked).toMatchObject({ phase: "parked", attempt: MAX_ATTEMPTS, why: { kind: "finding_disputed" } });
    expect(builder.requests).toHaveLength(0);
    expect(state).toMatchObject({
      phase: "parked",
      attempt: MAX_ATTEMPTS,
      why: { kind: "out_of_attempts", feedback: expect.stringContaining("it stands") },
    });
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

describe("the owner's comments", () => {
  const thanks = { id: "c1", text: "Thanks, looks good" };
  const change = { id: "c2", text: "Actually, a  b should keep both dashes: a--b" };
  const answerWith = answerLane;

  it("finishes when a comment surely changes nothing, without asking anyone", async () => {
    const { state, read } = await runLane({
      builder: ["ok"],
      checks: [green],
      comments: [[thanks]],
      readings: { [thanks.text]: { kind: "none" } },
    });

    expect(read).toEqual([thanks.text]);
    expect(state).toMatchObject({ phase: "done", comments: [{ id: "c1", state: { kind: "settled", by: "reader" } }] });
  });

  it("parks on a comment that changes a rule, with the rule beside it", async () => {
    const { state } = await runLane({
      builder: ["ok"],
      checks: [green],
      comments: [[thanks, change]],
      readings: { [thanks.text]: { kind: "none" }, [change.text]: { kind: "changes", criterion: "dashes" } },
    });

    expect(state).toMatchObject({
      phase: "parked",
      why: {
        kind: "comment_changes_rule",
        comment: { id: "c2", text: change.text },
        criterion: { id: "dashes", rule: "Spaces become single dashes" },
      },
    });
  });

  it("rewrites the tests from a person's example, and the builder goes on without spending an attempt", async () => {
    const script = {
      builder: ["ok"] as const,
      checks: [green],
      comments: [[change]],
      readings: { [change.text]: { kind: "changes", criterion: "dashes" } as const },
    };
    const { state: parked } = await runLane({ ...script, builder: ["ok"] });
    const { state, feedback } = await answerWith(
      parked,
      { park: "comment_changes_rule", answer: { kind: "example", criterion: "dashes", call: `slugify("a  b")`, result: `"a--b"` } },
      { ...script, builder: ["ok"] },
    );

    expect(feedback[0]).toContain(`The ticket's owner commented: "${change.text}"`);
    expect(feedback[0]).toContain(`slugify("a  b") -> "a--b"`);
    expect(state).toMatchObject({
      phase: "done",
      attempt: 1,
      builds: 2,
      comments: [{ id: "c2", state: { kind: "settled", by: "person" } }],
    });
    const dashes = state.phase === "done" ? state.issue.criteria.find((c) => c.id === "dashes") : undefined;
    expect(dashes).toMatchObject({ examples: [{ call: `slugify("a  b")`, result: `"a--b"` }] });
  });

  it("adds a new rule when a comment asks for behaviour no rule covers", async () => {
    const trim = { id: "c4", text: "Spaces at the ends should not become dashes" };
    const newRule: ExampleCriterion = {
      kind: "example",
      id: "trim",
      rule: "Spaces at the ends are dropped",
      ...slugify,
      examples: [{ call: `slugify(" a ")`, result: `"a"` }],
    };
    const script = { builder: ["ok"] as const, checks: [green], comments: [[trim]], readings: { [trim.text]: { kind: "adds" } as const } };
    const { state: parked } = await runLane({ ...script, builder: ["ok"] });
    const { state, feedback } = await answerWith(
      parked,
      { park: "comment_changes_rule", answer: { kind: "rule", criterion: newRule } },
      { ...script, builder: ["ok"] },
    );
    const again = await answerWith(parked, {
      park: "comment_changes_rule",
      answer: { kind: "rule", criterion: { ...newRule, id: "dashes" } },
    });

    expect(feedback[0]).toContain(`A person made it a new rule, "Spaces at the ends are dropped": slugify(" a ") -> "a"`);
    expect(state).toMatchObject({ phase: "done", attempt: 1 });
    expect(state.phase === "done" ? state.issue.criteria.map((c) => c.id) : []).toEqual(["lower", "dashes", "ascii", "trim"]);
    // A rule whose id is taken would clash with that rule's tests: the lane stays parked.
    expect(again.state).toEqual(parked);
  });

  it("sends an unsure comment, or one the reader could not read, to a person", async () => {
    const unsure = await runLane({ builder: ["ok"], checks: [green], comments: [[change]] });
    const failed = await runLane({ builder: ["ok"], checks: [green], comments: [[change]], readings: { [change.text]: "fail" } });

    expect(unsure.state).toMatchObject({ phase: "parked", why: { kind: "comment_changes_rule", criterion: null } });
    expect(failed.state).toMatchObject({
      phase: "parked",
      why: { kind: "comment_changes_rule", comment: { state: { kind: "open", reading: { kind: "unread" } } } },
    });
  });

  it("reads a comment left while a person was ruling on another, before finishing", async () => {
    const later = { id: "c3", text: "Also, please keep it fast" };
    const { state: parked } = await runLane({ builder: ["ok"], checks: [green], comments: [[change]] });
    const { state } = await answerWith(parked, { park: "comment_changes_rule", answer: { kind: "note" } }, {
      comments: [[change, later]],
      readings: { [later.text]: { kind: "none" } },
    });

    expect(state).toMatchObject({
      phase: "done",
      comments: [
        { id: "c2", state: { kind: "settled", by: "person" } },
        { id: "c3", state: { kind: "settled", by: "reader" } },
      ],
    });
  });

  it("does not finish when the comments cannot be fetched, and fetches again on retry", async () => {
    const { state: parked } = await runLane({ builder: ["ok"], checks: [green], comments: ["fail"] });
    const { state } = await answerWith(parked, { park: "tracker_failed", answer: { kind: "retry" } });

    expect(parked).toMatchObject({ phase: "parked", why: { kind: "tracker_failed" } });
    expect(state).toMatchObject({ phase: "done" });
  });
});

describe("a lane", () => {
  it("writes the tests, builds, runs them, has it reviewed and finishes", async () => {
    const { state, cmds } = await runLane({ builder: ["ok"], checks: [green] });

    expect(state).toMatchObject({ phase: "done", attempt: 1 });
    expect(cmds).toEqual(["prepare", "build", "check", "fresh_check", "inspect", "find_missing", "fetch_comments"]);
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

  it("sends back a change whose tests pass in the builder's folder but not on a fresh copy", async () => {
    const { state, feedback, cmds } = await runLane({
      builder: ["ok", "ok"],
      checks: [green, green],
      fresh: [{ passed: false, output: "Cannot find module './local-pattern.js'" }, { passed: true, output: "" }],
    });

    expect(feedback[1]).toContain("fail on a fresh copy of your change");
    expect(feedback[1]).toContain("Cannot find module './local-pattern.js'");
    // Review only ever reads a change that passed on a fresh copy.
    expect(cmds).toEqual([
      "prepare", "build", "check", "fresh_check", "diagnose", "build", "check", "fresh_check", "inspect", "find_missing", "fetch_comments",
    ]);
    expect(state).toMatchObject({ phase: "done", attempt: 2 });
  });

  describe("a failed run", () => {
    const red = { ...green, passed: false, output: "Error: spawn git ENOENT" };

    it("asks whose failure it is, with the change's diff and the run's output, before sending it back", async () => {
      const { state, feedback, cmds, failureReader } = await runLane({ builder: ["ok", "ok"], checks: [red, green] });

      expect(cmds.slice(0, 5)).toEqual(["prepare", "build", "check", "diagnose", "build"]);
      expect(failureReader.read).toEqual([{ command: "node --test", diff: red.diff, output: red.output }]);
      expect(feedback[1]).toContain("Tests failed:\nError: spawn git ENOENT");
      expect(state).toMatchObject({ phase: "done", attempt: 2 });
    });

    it("parks a sure setup or test-file failure, and spends no attempt on it", async () => {
      for (const cause of ["environment", "test_file"] as const) {
        const { state, feedback } = await runLane({ builder: ["ok"], checks: [red], failures: [cause] });

        expect(state).toMatchObject({
          phase: "parked",
          attempt: 1,
          why: { kind: "run_failed", step: "check", cause, output: red.output },
        });
        expect(feedback).toEqual([null]);
      }
    });

    it("sends an unsure reading back to the builder, and so a reader that failed", async () => {
      for (const failure of ["unsure", "fail"] as const) {
        const { state, feedback } = await runLane({ builder: ["ok", "ok"], checks: [red, green], failures: [failure] });

        expect(feedback[1]).toContain("Tests failed:");
        expect(state).toMatchObject({ phase: "done", attempt: 2 });
      }
    });

    it("parks an unsure reading, and a reader that failed, when the lane says to park them", async () => {
      for (const [failure, cause] of [["unsure", "unsure"], ["fail", "unread"]] as const) {
        const { state, feedback } = await runLane({
          builder: ["ok"],
          checks: [red],
          failures: [failure],
          knobs: { onUnsure: "park" },
        });

        expect(state).toMatchObject({ phase: "parked", attempt: 1, why: { kind: "run_failed", cause, output: red.output } });
        expect(feedback).toEqual([null]);
      }
    });

    it("still sends a sure change back when the lane parks unsure ones", async () => {
      const { state } = await runLane({
        builder: ["ok", "ok"],
        checks: [red, green],
        failures: ["change"],
        knobs: { onUnsure: "park" },
      });

      expect(state).toMatchObject({ phase: "done", attempt: 2 });
    });

    it("reads a failure on a fresh copy against the diff the check saw", async () => {
      const { state, failureReader } = await runLane({
        builder: ["ok"],
        checks: [green],
        fresh: [{ passed: false, output: "ENOENT: no such file or directory, mkdir '/nonexistent/tmp'" }],
        failures: ["environment"],
      });

      expect(failureReader.read[0]?.diff).toBe(green.diff);
      expect(state).toMatchObject({ phase: "parked", why: { kind: "run_failed", step: "fresh", cause: "environment" } });
    });

    it("on retry, runs the tests again on the same attempt; on rebuild, sends the run back and spends one", async () => {
      const parked = await runLane({ builder: ["ok"], checks: [red], failures: ["environment"] });
      const retried = await answerLane(parked.state, { park: "run_failed", answer: { kind: "retry" } }, { checks: [green] });
      const rebuilt = await answerLane(
        parked.state,
        { park: "run_failed", answer: { kind: "rebuild", feedback: "git is there; the code shells out wrong" } },
        { builder: ["ok"], checks: [green] },
      );

      expect(retried.cmds[0]).toBe("check");
      expect(retried.state).toMatchObject({ phase: "done", attempt: 1 });
      expect(rebuilt.feedback[0]).toContain("git is there; the code shells out wrong\n\nThe run:\nError: spawn git ENOENT");
      expect(rebuilt.state).toMatchObject({ phase: "done", attempt: 2 });
    });
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

  it("parks at the try limit it started with", async () => {
    const one = await runLane({ builder: ["ok"], checks: [red], knobs: { attempts: 1 } });
    const five = await runLane({ builder: ["ok", "ok", "ok", "ok", "ok"], checks: [red, red, red, red, green], knobs: { attempts: 5 } });

    expect(one.state).toMatchObject({ phase: "parked", attempt: 1, limit: 1, why: { kind: "out_of_attempts" } });
    expect(five.state).toMatchObject({ phase: "done", attempt: 5 });
  });

  it("freezes review's findings from the last round its try limit allows", async () => {
    const script = {
      builder: ["ok", "ok"],
      checks: [green, { ...green, snapshot: seeing(secondTry) }],
      reviews: [found(spaces), fixedNow("r1-1")],
      routes: { [spaces.problem]: "related" },
    } as const;
    const frozen = await runLane({ ...script, knobs: { attempts: 1 } });
    const open = await runLane(script);

    // With one try, the first round is the last: a new finding is filed, not sent back.
    expect(frozen.state).toMatchObject({ phase: "done", attempt: 1, notes: [{ problem: spaces.problem }] });
    expect(open.state).toMatchObject({ phase: "done", attempt: 2 });
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
        testCommand: "node --test",
        baseFiles: () => Effect.die("unused"),
        baseFile: () => Effect.die("unused"),
        currentFile: () => Effect.die("unused"),
        prepare: () => Effect.fail({ _tag: "could_not_run" as const }),
        check: () => Effect.die("unused"),
        freshCheck: () => Effect.die("unused"),
      }),
    );
    const { state } = await Effect.runPromise(
      drive(lane, { phase: "idle" }, { type: "start", issue, session: SESSION, knobs: KNOBS }, interpret).pipe(
        Effect.provide(failing),
      ),
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
