import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { type Name, nameOf, outcomesOf, type Parts, partsOf } from "./outcome.ts";
import { isShipName, SHIP_NAMES, type ShipName, ShipOutcome } from "./ship/outcome.ts";

// The one shape every stage answers in, and how an answer is spelled
// (docs/direction/outcome-names.md). The ship machine's outcomes are the
// worked example; a second, made-up stage shows that a stage writes only its
// own words.

/** Every outcome the ship machine can hand back, one of each name. */
const EVERY: readonly ShipOutcome[] = [
  { kind: "done", part: false, commit: "d694f6b", cleanup: "done" },
  { kind: "done", part: true, commit: "d694f6b", cleanup: "done" },
  { kind: "send", to: "builder", why: "review_failed" },
  { kind: "send", to: "builder", why: "checks_red" },
  { kind: "send", to: "builder", why: "conflicts" },
  { kind: "send", to: "builder", why: "ejected" },
  { kind: "send", to: "builder", why: "bot_comment" },
  { kind: "send", to: "reviewer", why: "no_review" },
  { kind: "ask", who: "owner", for: "approval" },
  { kind: "ask", who: "commenter", for: "comment" },
  { kind: "skip", why: "closed" },
  { kind: "skip", why: "draft" },
  { kind: "skip", why: "not_ours" },
  { kind: "stuck", why: "read_failed" },
  { kind: "stuck", why: "enqueue_failed" },
  { kind: "stuck", why: "head_moving" },
  { kind: "stuck", why: "checks_stuck" },
  { kind: "stuck", why: "queue_silent" },
  { kind: "stuck", why: "merge_unknown" },
  { kind: "stuck", why: "approval_unknown" },
  { kind: "stuck", why: "reviews_unknown" },
];

/** The same list as names, written out by hand: what a log line, a ledger line or a drawing shows. */
const NAMES: readonly ShipName[] = [
  "done",
  "done:part",
  "send:builder:review_failed",
  "send:builder:checks_red",
  "send:builder:conflicts",
  "send:builder:ejected",
  "send:builder:bot_comment",
  "send:reviewer:no_review",
  "ask:owner:approval",
  "ask:commenter:comment",
  "skip:closed",
  "skip:draft",
  "skip:not_ours",
  "stuck:read_failed",
  "stuck:enqueue_failed",
  "stuck:head_moving",
  "stuck:checks_stuck",
  "stuck:queue_silent",
  "stuck:merge_unknown",
  "stuck:approval_unknown",
  "stuck:reviews_unknown",
];

describe("how an outcome is spelled", () => {
  it("prints every ship outcome by the one grammar", () => {
    expect(EVERY.map((outcome) => nameOf(outcome))).toEqual(NAMES);
  });

  it("passing on says who, then why; ending says why; a whole done has nothing to add", () => {
    expect(nameOf({ kind: "send", to: "builder", why: "checks_red" })).toBe("send:builder:checks_red");
    expect(nameOf({ kind: "ask", who: "owner", for: "approval" })).toBe("ask:owner:approval");
    expect(nameOf({ kind: "done", part: false })).toBe("done");
    expect(nameOf({ kind: "done", part: true })).toBe("done:part");
    expect(nameOf({ kind: "skip", why: "closed" })).toBe("skip:closed");
    expect(nameOf({ kind: "stuck", why: "read_failed" })).toBe("stuck:read_failed");
  });

  it("a name does not hold the rest of the data: two landings at two commits have one name", () => {
    const first: ShipOutcome = { kind: "done", part: false, commit: "aaaaaaa", cleanup: "done" };
    const second: ShipOutcome = { kind: "done", part: false, commit: "bbbbbbb", cleanup: "failed" };

    expect(nameOf(first)).toBe(nameOf(second));
  });

  it("the stage's own list of names is every name its outcomes print, and no other", () => {
    expect([...SHIP_NAMES].sort()).toEqual([...NAMES].sort());
    expect(new Set(SHIP_NAMES).size).toBe(21);
  });
});

describe("a name read back", () => {
  it("reads every ship name into its verb, who and why", () => {
    expect(NAMES.map((name) => partsOf(name))).toEqual([
      { verb: "done", who: null, why: null },
      { verb: "done", who: null, why: "part" },
      { verb: "send", who: "builder", why: "review_failed" },
      { verb: "send", who: "builder", why: "checks_red" },
      { verb: "send", who: "builder", why: "conflicts" },
      { verb: "send", who: "builder", why: "ejected" },
      { verb: "send", who: "builder", why: "bot_comment" },
      { verb: "send", who: "reviewer", why: "no_review" },
      { verb: "ask", who: "owner", why: "approval" },
      { verb: "ask", who: "commenter", why: "comment" },
      { verb: "skip", who: null, why: "closed" },
      { verb: "skip", who: null, why: "draft" },
      { verb: "skip", who: null, why: "not_ours" },
      { verb: "stuck", who: null, why: "read_failed" },
      { verb: "stuck", who: null, why: "enqueue_failed" },
      { verb: "stuck", who: null, why: "head_moving" },
      { verb: "stuck", who: null, why: "checks_stuck" },
      { verb: "stuck", who: null, why: "queue_silent" },
      { verb: "stuck", who: null, why: "merge_unknown" },
      { verb: "stuck", who: null, why: "approval_unknown" },
      { verb: "stuck", who: null, why: "reviews_unknown" },
    ]);
  });

  it("the round trip: the parts of an outcome's name are the outcome's own words", () => {
    for (const outcome of EVERY) {
      const { verb, who, why } = partsOf(nameOf(outcome));

      expect(verb).toBe(outcome.kind);
      expect(who).toBe(outcome.kind === "send" ? outcome.to : outcome.kind === "ask" ? outcome.who : null);
      expect(why).toBe(outcome.kind === "done" ? (outcome.part ? "part" : null) : outcome.kind === "ask" ? outcome.for : outcome.why);
      // And the parts spell the same name again.
      expect([verb, who, why].filter((part) => part !== null).join(":")).toBe(nameOf(outcome));
    }
  });

  it("the second part of a passing-on name is always who gets it next", () => {
    for (const name of NAMES) {
      const { verb, who } = partsOf(name);
      expect(who !== null, name).toBe(verb === "send" || verb === "ask");
    }
  });

  it("tells a ship name from any other text, for a name read from a log", () => {
    expect(NAMES.every(isShipName)).toBe(true);
    for (const text of ["", "done:whole", "send:builder", "send:reviewer:checks_red", "ask:owner:comment", "ask:builder:approval", "stuck", "skip:merged", "landed", "send_builder_checks_red"]) {
      expect(isShipName(text), text).toBe(false);
    }
  });
});

describe("the name's pattern is a type", () => {
  it("a right name compiles, and a wrong one does not", () => {
    const right: ShipName[] = ["send:builder:checks_red", "ask:owner:approval", "done", "done:part", "skip:closed", "stuck:read_failed"];
    const wrong: ShipName[] = [
      // @ts-expect-error a misspelled word
      "send:builder:checks_read",
      // @ts-expect-error a why said to the wrong stage
      "send:reviewer:checks_red",
      // @ts-expect-error the wrong joint
      "send_builder_checks_red",
      // @ts-expect-error who is missing
      "send:checks_red",
      // @ts-expect-error an ending has no who
      "stuck:builder:read_failed",
      // @ts-expect-error a person asked for what the other is asked
      "ask:owner:comment",
      // @ts-expect-error an old name
      "back_to_builder",
      // @ts-expect-error a sixth verb
      "wait:checks",
    ];

    expect(right.every(isShipName)).toBe(true);
    expect(wrong.some(isShipName)).toBe(false);
  });

  it("an outcome that pairs a word with the wrong one does not compile either", () => {
    // @ts-expect-error red checks are the builder's, not the reviewer's
    const sent: ShipOutcome = { kind: "send", to: "reviewer", why: "checks_red" };
    // @ts-expect-error an owner is asked for an approval, not a comment
    const asked: ShipOutcome = { kind: "ask", who: "owner", for: "comment" };
    // @ts-expect-error a landing names its commit
    const done: ShipOutcome = { kind: "done", part: false };

    const decode = Schema.decodeUnknownOption(ShipOutcome);
    expect([sent, asked, done].map((outcome) => decode(outcome)._tag)).toEqual(["None", "None", "None"]);
  });

  it("the parts of a name are typed from the name", () => {
    const sent: Parts<"send:builder:checks_red"> = partsOf("send:builder:checks_red");
    const ended: Parts<"stuck:read_failed"> = partsOf("stuck:read_failed");
    const whole: Parts<"done"> = partsOf("done");
    // @ts-expect-error the who of this name is the builder
    const reviewer: "reviewer" = sent.who;

    expect([sent.who, ended.who, whole.why, reviewer]).toEqual(["builder", null, null, "builder"]);
  });
});

describe("a new stage writes only its words", () => {
  // A stage that is not built: a review that passes, sends back, asks, skips or is stuck.
  const review = outcomesOf({
    done: { verdict: Schema.Literals(["pass"]) },
    send: { builder: ["finding", "tests_red"] },
    ask: { owner: ["ruling"] },
    skip: ["no_diff"],
    stuck: ["diff_unreadable"],
  });
  type ReviewOutcome = typeof review.schema.Type;

  it("gets the schema, the names and the test for a name from its word lists", () => {
    const decode = Schema.decodeUnknownSync(review.schema);
    const found: ReviewOutcome = { kind: "send", to: "builder", why: "finding" };

    expect(decode(found)).toEqual(found);
    expect(decode({ kind: "done", part: false, verdict: "pass" })).toEqual({ kind: "done", part: false, verdict: "pass" });
    expect(() => decode({ kind: "send", to: "builder", why: "checks_red" })).toThrow();
    expect(review.names).toEqual(["done", "done:part", "send:builder:finding", "send:builder:tests_red", "ask:owner:ruling", "skip:no_diff", "stuck:diff_unreadable"]);
    expect(review.isName("send:builder:finding")).toBe(true);
    expect(review.isName("send:builder:checks_red")).toBe(false);
  });

  it("its names are its own: another stage's name does not compile as one of them", () => {
    const own: Name<ReviewOutcome> = nameOf({ kind: "ask", who: "owner", for: "ruling" } satisfies ReviewOutcome);
    // @ts-expect-error a ship name, not a review name
    const others: Name<ReviewOutcome> = "ask:owner:approval";

    expect([own, others]).toEqual(["ask:owner:ruling", "ask:owner:approval"]);
  });
});
