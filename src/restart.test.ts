import { applyCell, replay } from "@demlik/tea";
import { drive } from "@demlik/tea/testing/effect";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { interpret } from "./handlers.ts";
import { type Issue, testNames } from "./issue.ts";
import { type Lane, type LaneCmd, type LaneKnobs, type LaneMsg, lane, type ParkAnswer } from "./lane.ts";
import { DEFAULT_SETTINGS, knobsOf } from "./settings.ts";
import type { ReviewParkAnswer } from "./review.ts";
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
import type { CheckResult, ReviewReport } from "./services.ts";

// Kill the lane after every step and boot it again from what was saved. tea
// saves the state after each step and before that step's Cmds run, so a kill
// leaves the state holding Cmds whose answers never came. On boot the host
// sends `resume`, and the lane asks for them again.

const slugify = { file: "slugify.js", name: "slugify" } as const;
const issue: Issue = {
  id: "1",
  title: "slugify turns a title into a URL slug",
  goal: "slugify turns a title into a URL slug",
  body: "Make slugify(title) in slugify.js return a URL slug.",
  criteria: [
    { kind: "example", id: "lower", rule: "The slug is lower case", ...slugify, examples: [{ call: `slugify("Hello")`, result: `"hello"` }] },
    { kind: "example", id: "dashes", rule: "Spaces become single dashes", ...slugify, examples: [{ call: `slugify("a  b")`, result: `"a-b"` }] },
  ],
  openDecision: null,
};
const SESSION = "lane-session";
const KNOBS = knobsOf(DEFAULT_SETTINGS).lane;
const start = (on: Issue = issue, knobs: LaneKnobs = KNOBS): LaneMsg => ({ type: "start", issue: on, session: SESSION, knobs });

const seeing = (text: string) => ({ "slugify.js": { text, lines: [1, 2, 3] } });
const green: CheckResult = {
  passed: true,
  output: "2 passed",
  diff: "+ slugify",
  passingTests: testNames(issue),
  touched: [],
  changed: ["slugify.js"],
  snapshot: seeing('export function slugify(title) {\n  return title.toLowerCase().split(" ").join("-");\n}\n'),
};
const red: CheckResult = { ...green, passed: false, output: "1 failed: dashes", passingTests: [] };
const greenAgain: CheckResult = {
  ...green,
  snapshot: seeing('export function slugify(title) {\n  return title.toLowerCase().split(/ +/).join("-");\n}\n'),
};

const helpers = [
  { file: "trim.js", why: "a trim helper slugify uses" },
  { file: "ascii.js", why: "a table of letters slugify keeps" },
];
const spaces = { file: "slugify.js", line: 2, quote: 'split(" ")', problem: "Two spaces in a row make two dashes" };
/** A point the router files in round 1, and the reviewer raises again in round 2. */
const accents = { file: "slugify.js", line: 2, quote: "toLowerCase()", problem: "Accented letters are kept as they are" };
const accentsAgain = { ...accents, problem: "Letters like é survive into the slug" };

interface Script {
  readonly builder: readonly ScriptedBuild[];
  readonly checks: readonly CheckResult[];
  /** What the reviewer says each round. Left out, every review is clean. */
  readonly reviews?: readonly ReviewReport[];
  /** The owner's comments on the ticket. They stay put, so fetching twice is safe. */
  readonly comments?: readonly Comment[];
}

/** What the reader says each comment does: a table, so asking twice is safe. */
const readings: Readonly<Record<string, Reading>> = {
  "Thanks, looks good so far": { kind: "none" },
  "Is this going out this week?": { kind: "none" },
};
const nothing: Script = { builder: [], checks: [] };

/** Drive the lane from `from` with `msg` against the script, and count the work each service did. */
async function driveFrom(from: Lane, msg: LaneMsg, script: Script) {
  const builder = scriptedBuilder(script.builder);
  // The router's answers are a table, not a queue: asking twice is safe.
  const router = scriptedRouter({
    ...Object.fromEntries(helpers.map((h) => [h.why, "related" as const])),
    [spaces.problem]: "related",
    [accents.problem]: "unrelated",
  });
  const reviewer = scriptedReviewer(script.reviews);
  const matcher = scriptedMatcher({ [accentsAgain.problem]: "r1-2" });
  const layers = Layer.mergeAll(
    builder.layer,
    router.layer,
    reviewer.layer,
    matcher.layer,
    scriptedTracker([script.comments ?? []]).layer,
    scriptedCommentReader(readings).layer,
    scriptedFailureReader().layer,
    scriptedMissingReader().layer,
    scriptedWorkspace(script.checks),
  );
  const result = await Effect.runPromise(drive(lane, from, msg, interpret).pipe(Effect.provide(layers)));
  const cmds = result.trace.flatMap((entry) => (entry.kind === "cmd" ? [entry.cmd.type] : []));
  const count = (type: string) => cmds.filter((c) => c === type).length;
  return {
    ...result,
    cmds,
    builds: builder.requests,
    work: {
      prepare: count("prepare"),
      build: count("build"),
      check: count("check"),
      fresh_check: count("fresh_check"),
      route: count("route"),
      inspect: count("inspect"),
      match: count("match"),
      find_missing: count("find_missing"),
      fetch_comments: count("fetch_comments"),
      weigh: count("weigh"),
    },
  };
}

/** What is left of the script once `msgs` have been folded: each answer is used once. */
function rest(script: Script, msgs: readonly { readonly type: string }[]): Script {
  const answered = (type: string) => msgs.filter((m) => m.type === `${type}_ok` || m.type === `${type}_err`).length;
  return {
    builder: script.builder.slice(answered("build")),
    checks: script.checks.slice(answered("check")),
    ...(script.reviews === undefined ? {} : { reviews: script.reviews.slice(answered("inspect")) }),
    ...(script.comments === undefined ? {} : { comments: script.comments }),
  };
}

/** The part of a finished lane that says how it ended. */
const ending = (s: Lane) =>
  s.phase === "idle" ? s : { phase: s.phase, attempt: s.attempt, session: s.session, ...("why" in s ? { why: s.why } : {}) };

/** The Cmds still waiting on an answer in a saved state: the ones a kill can make run twice. */
const inFlight = (s: Lane): readonly string[] => {
  switch (s.phase) {
    case "preparing":
      return ["prepare"];
    case "building":
      return ["build"];
    case "checking":
      return ["check"];
    case "checking_fresh":
      return ["fresh_check"];
    case "reviewing": {
      const r = s.review;
      if (r.phase === "reading") {
        return [...(r.report === null ? ["inspect"] : []), ...(r.missing === null ? ["find_missing"] : [])];
      }
      if (r.phase === "scoping" || r.phase === "sorting") {
        return Object.values(r.routed).flatMap((relation) => (relation === null ? ["route"] : []));
      }
      if (r.phase === "matching") {
        return Object.values(r.matches).flatMap((to) => (to === null ? ["match"] : []));
      }
      return [];
    }
    case "finishing":
      return s.fetched ? s.comments.flatMap((c) => (c.state.kind === "reading" ? ["weigh"] : [])) : ["fetch_comments"];
    default:
      return [];
  }
};

const scripts: Readonly<Record<string, Script>> = {
  "done on the first try": { builder: ["ok"], checks: [green] },
  "a failed test run, then done": { builder: ["ok", "ok"], checks: [red, green] },
  "a locked test changed, then done": { builder: ["ok", "ok"], checks: [{ ...green, touched: ["criteria.test.js"] }, green] },
  "parked on a contradiction": {
    builder: [{ kind: "contradiction", criterion: "dashes", call: `slugify("a  b")`, why: "two spaces" }],
    checks: [],
  },
  "parked when the builder fails": { builder: ["fail"], checks: [] },
  "two extra changes, both serving the ticket": {
    builder: [{ kind: "done", summary: "built", deviations: helpers }],
    checks: [{ ...green, changed: ["slugify.js", ...helpers.map((h) => h.file)] }],
  },
  "a review finding, fixed on the second try": {
    builder: ["ok", "ok"],
    checks: [green, greenAgain],
    reviews: [
      { findings: [spaces], rechecks: [] },
      { findings: [], rechecks: [{ id: "r1-1", fixed: true }] },
    ],
  },
  "a filed finding raised again, matched instead of parking": {
    builder: ["ok", "ok"],
    checks: [green, greenAgain],
    reviews: [
      { findings: [spaces, accents], rechecks: [] },
      { findings: [accentsAgain], rechecks: [{ id: "r1-1", fixed: true }] },
    ],
  },
  "two owner comments that change nothing": {
    builder: ["ok"],
    checks: [green],
    comments: [
      { id: "c1", text: "Thanks, looks good so far" },
      { id: "c2", text: "Is this going out this week?" },
    ],
  },
};

describe("a lane killed after any step", () => {
  for (const [name, script] of Object.entries(scripts)) {
    it(`${name}: ends the same, and only the work in flight runs again`, async () => {
      const whole = await driveFrom({ phase: "idle" }, start(), script);
      const msgs = whole.trace.flatMap((entry) => (entry.kind === "msg" ? [entry.msg] : []));

      for (let step = 1; step < msgs.length; step++) {
        const before = msgs.slice(0, step);
        // What a kill right after this step leaves on disk: JSON, read back.
        const saved = JSON.parse(JSON.stringify(replay(lane, { msgs: before, ctx: undefined }).state)) as Lane;
        const at = `killed after step ${step} (${msgs[step - 1]?.type})`;
        const again = await driveFrom(saved, { type: "resume", at: Date.now() }, rest(script, before)).catch((error: unknown) => {
          throw new Error(`${at}: ${String(error)}`, { cause: error });
        });

        expect(ending(again.state), at).toEqual(ending(whole.state));
        // The first thing the booted lane does is ask again for exactly what
        // was in flight: that, and only that, may have run twice.
        expect(again.cmds.slice(0, inFlight(saved).length), at).toEqual(inFlight(saved));
        // Work that finished before the kill is never done again: the answers
        // before it and after it add up to one uninterrupted run.
        const answered = (type: string) => before.filter((m) => m.type === `${type}_ok` || m.type === `${type}_err`).length;
        for (const type of ["prepare", "build", "check", "fresh_check", "route", "inspect", "match", "find_missing", "fetch_comments", "weigh"] as const) {
          expect(answered(type) + again.work[type], `${at}: ${type}`).toBe(whole.work[type]);
        }
      }
    });
  }

  it("a killed first build comes back in the same conversation", async () => {
    const script = scripts["done on the first try"] as Script;
    const whole = await driveFrom({ phase: "idle" }, start(), script);
    // Killed once the tests were written: the first build is in flight.
    const msgs = whole.trace.flatMap((entry) => (entry.kind === "msg" ? [entry.msg] : [])).slice(0, 2);
    const saved = replay(lane, { msgs, ctx: undefined }).state;
    const again = await driveFrom(saved, { type: "resume", at: Date.now() }, script);

    expect(saved.phase).toBe("building");
    // `continues` is a guess: the conversation may or may not have been saved
    // before the kill, and the builder tries the other way if it is wrong.
    expect(again.builds.map((b) => b.session)).toEqual([{ id: SESSION, continues: true }]);
    expect(again.state.phase).toBe("done");
  });

  it("a finished lane does nothing on resume", async () => {
    const whole = await driveFrom({ phase: "idle" }, start(), scripts["done on the first try"] as Script);
    const again = await driveFrom(whole.state, { type: "resume", at: Date.now() }, nothing);

    expect(again.state).toEqual(whole.state);
    expect(again.cmds).toEqual([]);
  });

  it("keeps the knobs it started with, whatever the settings say on boot", async () => {
    const script: Script = { builder: ["ok", "ok"], checks: [red, green] };
    const whole = await driveFrom({ phase: "idle" }, start(issue, { attempts: 1, onUnsure: "rebuild" }), script);
    // Killed once the tests were written, and booted again where the settings allow three tries:
    // the lane reads its limit from what it saved, never from the settings.
    const msgs = whole.trace.flatMap((entry) => (entry.kind === "msg" ? [entry.msg] : [])).slice(0, 2);
    const saved = JSON.parse(JSON.stringify(replay(lane, { msgs, ctx: undefined }).state)) as Lane;
    const again = await driveFrom(saved, { type: "resume", at: Date.now() }, script);

    expect(KNOBS.attempts).toBe(3);
    expect(whole.state).toMatchObject({ phase: "parked", attempt: 1, why: { kind: "out_of_attempts" } });
    expect(again.state).toEqual(whole.state);
  });
});

describe("a parked lane", () => {
  const parkedOn = async (script: Script, on: Issue = issue) =>
    (await driveFrom({ phase: "idle" }, start(on), script)).state;
  const answer = (a: ParkAnswer | ReviewParkAnswer): LaneMsg => ({ type: "answer", answer: a, at: Date.now() });
  const contradiction = scripts["parked on a contradiction"] as Script;

  it("ignores an answer meant for another kind of park", async () => {
    const parked = await parkedOn(contradiction);
    const after = await driveFrom(parked, answer({ park: "builder_failed", answer: { kind: "retry" } }), nothing);

    expect(after.state).toEqual(parked);
  });

  it("tells the builder an example stands, in the same conversation", async () => {
    const parked = await parkedOn(contradiction);
    const after = await driveFrom(parked, answer({ park: "contradiction", answer: { kind: "keep", note: "Collapse runs of spaces." } }), {
      builder: ["ok"],
      checks: [green],
    });

    expect(after.builds.map((b) => b.session)).toEqual([{ id: SESSION, continues: true }]);
    expect(after.builds[0]?.feedback).toBe(
      `A person checked slugify("a  b") -> "a-b" against "Spaces become single dashes": the example stands. Collapse runs of spaces.`,
    );
    expect(after.state).toMatchObject({ phase: "done", attempt: 2 });
  });

  it("fixes a wrong example, rewrites its test, and tells the builder in the same conversation", async () => {
    const parked = await parkedOn(contradiction);
    const after = await driveFrom(parked, answer({ park: "contradiction", answer: { kind: "fix", result: `"a--b"` } }), {
      builder: ["ok"],
      checks: [green],
    });

    // The tests are written again from the fixed issue before anyone builds.
    expect(after.cmds).toEqual(["prepare", "build", "check", "fresh_check", "inspect", "find_missing", "fetch_comments"]);
    const fixed = after.builds[0]?.issue.criteria.find((c) => c.id === "dashes");
    expect(fixed).toMatchObject({ examples: [{ call: `slugify("a  b")`, result: `"a--b"` }] });
    expect(after.builds[0]?.session).toEqual({ id: SESSION, continues: true });
    expect(after.builds[0]?.feedback).toBe(
      `You were right: slugify("a  b") -> "a-b" broke "Spaces become single dashes". A person fixed it to slugify("a  b") -> "a--b", and the test now says so.`,
    );
    // The ticket was wrong, not the builder: the attempt is given back.
    expect(after.state).toMatchObject({ phase: "done", attempt: 1, builds: 2 });
  });

  it("a fix killed before its tests were rewritten picks up the same way", async () => {
    const parked = await parkedOn(contradiction);
    const fix = answer({ park: "contradiction", answer: { kind: "fix", result: `"a--b"` } });
    // One step: the answer is folded and saved, and the kill comes before its Cmd runs.
    const [stepped] = applyCell<Lane, LaneMsg, LaneCmd>(lane, parked, fix);
    const saved = JSON.parse(JSON.stringify(stepped)) as Lane;

    expect(saved).toMatchObject({ phase: "preparing", feedback: expect.stringContaining("You were right") });
    const again = await driveFrom(saved, { type: "resume", at: Date.now() }, { builder: ["ok"], checks: [green] });

    expect(again.cmds).toEqual(["prepare", "build", "check", "fresh_check", "inspect", "find_missing", "fetch_comments"]);
    expect(again.builds[0]?.feedback).toContain("You were right");
    expect(again.state.phase).toBe("done");
  });

  it("retries a failed builder, and stops when told to drop", async () => {
    const parked = await parkedOn(scripts["parked when the builder fails"] as Script);
    const retried = await driveFrom(parked, answer({ park: "builder_failed", answer: { kind: "retry" } }), { builder: ["ok"], checks: [green] });
    const dropped = await driveFrom(parked, answer({ park: "builder_failed", answer: { kind: "drop" } }), nothing);

    expect(retried.state.phase).toBe("done");
    expect(dropped.state).toMatchObject({ phase: "dropped", why: { kind: "builder_failed" } });
  });

  it("gets more attempts when a person grants them", async () => {
    const parked = await parkedOn({ builder: ["ok", "ok", "ok"], checks: [red, red, red] });
    const after = await driveFrom(parked, answer({ park: "out_of_attempts", answer: { kind: "more", attempts: 1 } }), { builder: ["ok"], checks: [green] });

    expect(parked).toMatchObject({ phase: "parked", why: { kind: "out_of_attempts" } });
    expect(after.state).toMatchObject({ phase: "done", attempt: 4, limit: 4 });
  });

  it("rebuilds a blocked builder with a person's words", async () => {
    const parked = await parkedOn({ builder: [{ kind: "blocked", why: "which file?" }], checks: [] });
    const after = await driveFrom(parked, answer({ park: "builder_blocked", answer: { kind: "rebuild", feedback: "slugify.js" } }), {
      builder: ["ok"],
      checks: [green],
    });

    expect(after.builds[0]?.feedback).toBe("slugify.js");
    expect(after.state.phase).toBe("done");
  });

  it("lets an extra change stay when a person accepts what the router was unsure about", async () => {
    const unknown = { file: "notes.md", why: "wrote down why" };
    const parked = await parkedOn({
      builder: [{ kind: "done", summary: "built", deviations: [unknown] }],
      checks: [{ ...green, changed: ["slugify.js", "notes.md"] }],
    });
    const after = await driveFrom(parked, answer({ park: "scope_unsure", answer: { kind: "accept" } }), nothing);

    // Review parked, inside the lane; the answer reaches it through the lane.
    expect(parked).toMatchObject({ phase: "reviewing", review: { phase: "parked", why: { kind: "scope_unsure" } } });
    expect(after.state).toMatchObject({ phase: "done", deviations: [unknown] });
  });

  it("skips rules with no check when a person says so", async () => {
    const withDocs: Issue = { ...issue, criteria: [...issue.criteria, { kind: "unchecked", id: "docs", rule: "The README says so", why: "docs" }] };
    const parked = await parkedOn(nothing, withDocs);
    const after = await driveFrom(parked, answer({ park: "unchecked", answer: { kind: "skip" } }), { builder: ["ok"], checks: [green] });

    expect(after.cmds).toEqual(["prepare", "build", "check", "fresh_check", "inspect", "find_missing", "fetch_comments"]);
    expect(after.state.phase).toBe("done");
  });
});
