import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { reviewsOf, ShipFacts } from "./facts.ts";
import { landedAs, shipGate } from "./gate.ts";
import { ShipOutcome } from "./outcome.ts";

// The gate on its own: facts in, go or one outcome out. No machine, no Cmd.

/** A pull request with nothing in its way. */
const clear: ShipFacts = {
  head: "abc1234",
  state: "open",
  ours: true,
  ticket: "closes_it",
  approval: "not_needed",
  reviews: "passed",
  reviewKinds: [],
  checks: "green",
  mergeable: "clean",
  comments: [],
};
const person = { id: "c1", by: "person" } as const;
const bot = { id: "c2", by: "bot" } as const;
const facts = (patch: Partial<ShipFacts> = {}): ShipFacts => ({ ...clear, ...patch });
const outcomeOf = (patch: Partial<ShipFacts>): ShipOutcome | "go" => {
  const gate = shipGate(facts(patch));
  return gate.go ? "go" : gate.outcome;
};

/** The gate's lines, top to bottom: the facts that trip each one, and what it answers. */
const LINES: readonly { readonly name: string; readonly patch: Partial<ShipFacts>; readonly outcome: ShipOutcome }[] = [
  { name: "already merged", patch: { state: "merged" }, outcome: { kind: "landed", commit: "abc1234", cleanup: "not_run" } },
  { name: "a closed pull request", patch: { state: "closed" }, outcome: { kind: "nothing_to_ship", why: "closed" } },
  { name: "a draft", patch: { state: "draft" }, outcome: { kind: "nothing_to_ship", why: "draft" } },
  { name: "not ours", patch: { ours: false }, outcome: { kind: "not_ours" } },
  { name: "conflicts with main", patch: { mergeable: "conflicts" }, outcome: { kind: "back_to_builder", why: "conflicts_with_main" } },
  { name: "a failed review", patch: { reviews: "failed" }, outcome: { kind: "back_to_builder", why: "review_failed" } },
  { name: "a missing review", patch: { reviews: "missing" }, outcome: { kind: "back_to_reviewer" } },
  { name: "reviews nobody could read", patch: { reviews: "unknown" }, outcome: { kind: "cannot_tell", why: "reviews_unknown" } },
  { name: "red checks", patch: { checks: "red" }, outcome: { kind: "back_to_builder", why: "checks_red" } },
  { name: "a person's open comment", patch: { comments: [person] }, outcome: { kind: "waiting_on_person", forWhat: "resolve_comment" } },
  { name: "a bot's open comment", patch: { comments: [bot] }, outcome: { kind: "back_to_builder", why: "bot_comment" } },
  { name: "a missing approval", patch: { approval: "missing" }, outcome: { kind: "waiting_on_person", forWhat: "owner_approval" } },
  { name: "an approval nobody could read", patch: { approval: "unknown" }, outcome: { kind: "cannot_tell", why: "approval_unknown" } },
  { name: "checks still running", patch: { checks: "pending" }, outcome: { kind: "cannot_tell", why: "checks_pending" } },
  { name: "stuck checks", patch: { checks: "stuck" }, outcome: { kind: "cannot_tell", why: "checks_stuck" } },
  { name: "mergeable not known", patch: { mergeable: "unknown" }, outcome: { kind: "cannot_tell", why: "mergeable_unknown" } },
];

/** Two lines tripped at once. `null`: both set the same fact to different values, so they cannot hold together. */
function both(a: Partial<ShipFacts>, b: Partial<ShipFacts>): Partial<ShipFacts> | null {
  for (const key of Object.keys(a) as (keyof ShipFacts)[]) {
    if (key !== "comments" && key in b && a[key] !== b[key]) return null;
  }
  return { ...a, ...b, comments: [...(a.comments ?? []), ...(b.comments ?? [])] };
}

describe("the ship gate, line by line", () => {
  it("says go when nothing is in the way, and carries the head and the kind of landing", () => {
    expect(shipGate(clear)).toEqual({ go: true, head: "abc1234", landing: "whole" });
    expect(shipGate(facts({ ticket: "part_of_it" }))).toEqual({ go: true, head: "abc1234", landing: "part" });
    expect(shipGate(facts({ ticket: "none", approval: "given" }))).toEqual({ go: true, head: "abc1234", landing: "whole" });
  });

  it.each(LINES)("$name stops it", ({ patch, outcome }) => {
    expect(outcomeOf(patch)).toEqual(outcome);
  });

  it("answers an already merged pull request by the kind of landing it was", () => {
    expect(outcomeOf({ state: "merged", ticket: "part_of_it" })).toEqual({ kind: "landed_part", commit: "abc1234", cleanup: "not_run" });
    expect(outcomeOf({ state: "merged", ticket: "none" })).toEqual({ kind: "landed", commit: "abc1234", cleanup: "not_run" });
  });

  it("never ships a closed pull request or a draft, however clear the rest is", () => {
    expect(outcomeOf({ state: "closed" })).toEqual({ kind: "nothing_to_ship", why: "closed" });
    expect(outcomeOf({ state: "draft" })).toEqual({ kind: "nothing_to_ship", why: "draft" });
  });
});

describe("the order of the lines", () => {
  it("an earlier line wins over every later one", () => {
    const checked: string[] = [];
    LINES.forEach((first, i) => {
      for (const later of LINES.slice(i + 1)) {
        const patch = both(first.patch, later.patch);
        if (patch === null) continue;
        expect(outcomeOf(patch), `${first.name} + ${later.name}`).toEqual(first.outcome);
        checked.push(`${first.name} > ${later.name}`);
      }
    });

    // 120 pairs of lines, less 11 that cannot hold together: 3 on the state, 3 on reviews, 1 on the approval, 3 on checks, 1 on mergeable.
    expect(checked).toHaveLength(109);
  });

  it("a merged pull request is a landing even when it is not ours", () => {
    expect(outcomeOf({ state: "merged", ours: false })).toEqual({ kind: "landed", commit: "abc1234", cleanup: "not_run" });
  });

  it("a closed pull request or a draft answers nothing to ship, whatever else is wrong with it", () => {
    for (const state of ["closed", "draft"] as const) {
      const nothing = { kind: "nothing_to_ship", why: state };

      expect(outcomeOf({ state, ours: false })).toEqual(nothing);
      expect(outcomeOf({ state, mergeable: "conflicts" })).toEqual(nothing);
      expect(outcomeOf({ state, checks: "red" })).toEqual(nothing);
      expect(outcomeOf({ state, reviews: "failed", comments: [person], approval: "missing" })).toEqual(nothing);
    }
  });

  it("conflicts beat a failed review", () => {
    expect(outcomeOf({ mergeable: "conflicts", reviews: "failed" })).toEqual({ kind: "back_to_builder", why: "conflicts_with_main" });
  });

  it("a failed or missing review is answered before red checks", () => {
    expect(outcomeOf({ reviews: "failed", checks: "red" })).toEqual({ kind: "back_to_builder", why: "review_failed" });
    expect(outcomeOf({ reviews: "missing", checks: "red" })).toEqual({ kind: "back_to_reviewer" });
  });

  it("a person's comment beats a bot's, in either order", () => {
    const asked = { kind: "waiting_on_person", forWhat: "resolve_comment" };

    expect(outcomeOf({ comments: [person, bot] })).toEqual(asked);
    expect(outcomeOf({ comments: [bot, person] })).toEqual(asked);
  });

  it("asks for a missing approval only after the comments", () => {
    expect(outcomeOf({ approval: "missing", comments: [person] })).toEqual({ kind: "waiting_on_person", forWhat: "resolve_comment" });
    expect(outcomeOf({ approval: "missing", comments: [bot] })).toEqual({ kind: "back_to_builder", why: "bot_comment" });
    expect(outcomeOf({ approval: "missing" })).toEqual({ kind: "waiting_on_person", forWhat: "owner_approval" });
  });

  it("asks for a missing approval before it says it cannot tell", () => {
    expect(outcomeOf({ approval: "missing", checks: "pending" })).toEqual({ kind: "waiting_on_person", forWhat: "owner_approval" });
    expect(outcomeOf({ approval: "missing", mergeable: "unknown" })).toEqual({ kind: "waiting_on_person", forWhat: "owner_approval" });
  });

  it("reviews nobody could read stop where the other review lines do, and send nobody back", () => {
    const unread = { kind: "cannot_tell", why: "reviews_unknown" };

    expect(outcomeOf({ reviews: "unknown" })).toEqual(unread);
    expect(outcomeOf({ reviews: "unknown", mergeable: "conflicts" })).toEqual({ kind: "back_to_builder", why: "conflicts_with_main" });
    // Before red checks, comments and the approval: a pull request that may be half reviewed goes no further.
    expect(outcomeOf({ reviews: "unknown", checks: "red" })).toEqual(unread);
    expect(outcomeOf({ reviews: "unknown", comments: [person], approval: "missing" })).toEqual(unread);
    expect(outcomeOf({ reviews: "unknown", approval: "unknown" })).toEqual(unread);
  });

  it("an approval nobody could read stops where a missing one would, and asks nobody", () => {
    const unread = { kind: "cannot_tell", why: "approval_unknown" };

    expect(outcomeOf({ approval: "unknown" })).toEqual(unread);
    // After the comments, like the missing one.
    expect(outcomeOf({ approval: "unknown", comments: [person] })).toEqual({ kind: "waiting_on_person", forWhat: "resolve_comment" });
    expect(outcomeOf({ approval: "unknown", comments: [bot] })).toEqual({ kind: "back_to_builder", why: "bot_comment" });
    expect(outcomeOf({ approval: "unknown", checks: "red" })).toEqual({ kind: "back_to_builder", why: "checks_red" });
    // Before the other things it cannot tell.
    expect(outcomeOf({ approval: "unknown", checks: "pending" })).toEqual(unread);
    expect(outcomeOf({ approval: "unknown", mergeable: "unknown" })).toEqual(unread);
  });

  it("names the checks before the merge when it cannot tell either", () => {
    expect(outcomeOf({ checks: "pending", mergeable: "unknown" })).toEqual({ kind: "cannot_tell", why: "checks_pending" });
    expect(outcomeOf({ checks: "stuck", mergeable: "unknown" })).toEqual({ kind: "cannot_tell", why: "checks_stuck" });
  });
});

describe("the reviews as one word", () => {
  it("is passed only when every kind passed", () => {
    expect(reviewsOf([{ kind: "review-code", verdict: "passed" }, { kind: "governance", verdict: "passed" }])).toBe("passed");
    expect(reviewsOf([{ kind: "review-code", verdict: "passed" }, { kind: "governance", verdict: "missing" }])).toBe("missing");
    expect(reviewsOf([{ kind: "review-code", verdict: "missing" }, { kind: "governance", verdict: "failed" }])).toBe("failed");
  });
});

describe("landedAs", () => {
  it("a pull request that closes its ticket, or names none, lands whole", () => {
    expect(landedAs(facts({ ticket: "closes_it" }))).toEqual({ kind: "landed", commit: "abc1234", cleanup: "not_run" });
    expect(landedAs(facts({ ticket: "none", head: "fff0000" }))).toEqual({ kind: "landed", commit: "fff0000", cleanup: "not_run" });
  });

  it("a pull request that is part of its ticket lands as a part", () => {
    expect(landedAs(facts({ ticket: "part_of_it" }))).toEqual({ kind: "landed_part", commit: "abc1234", cleanup: "not_run" });
  });
});

describe("every answer of the gate, over every set of facts", () => {
  const every: ShipFacts[] = [];
  for (const state of ShipFacts.fields.state.literals)
    for (const ours of [true, false])
      for (const ticket of ShipFacts.fields.ticket.literals)
        for (const approval of ShipFacts.fields.approval.literals)
          for (const reviews of ShipFacts.fields.reviews.literals)
            for (const checks of ShipFacts.fields.checks.literals)
              for (const mergeable of ShipFacts.fields.mergeable.literals)
                for (const comments of [[], [person], [bot], [bot, person]])
                  every.push({ head: "abc1234", state, ours, ticket, approval, reviews, reviewKinds: [], checks, mergeable, comments });
  const decode = Schema.decodeUnknownSync(ShipOutcome);

  it("the facts themselves decode with the ShipFacts schema", () => {
    expect(every).toHaveLength(18_432);
    expect(Schema.decodeUnknownSync(ShipFacts)(clear)).toEqual(clear);
    expect(() => Schema.decodeUnknownSync(ShipFacts)({ ...clear, checks: "yellow" })).toThrow();
  });

  it("every outcome decodes with the ShipOutcome schema", () => {
    const kinds = new Set<string>();
    const tags = new Set<string>();
    for (const f of every) {
      const gate = shipGate(f);
      if (gate.go) continue;
      expect(decode(gate.outcome)).toEqual(gate.outcome);
      kinds.add(gate.outcome.kind);
      if ("why" in gate.outcome) tags.add(`${gate.outcome.kind}/${gate.outcome.why}`);
      if (gate.outcome.kind === "waiting_on_person") tags.add(`${gate.outcome.kind}/${gate.outcome.forWhat}`);
    }

    // All eight kinds.
    expect([...kinds].sort()).toEqual([
      "back_to_builder",
      "back_to_reviewer",
      "cannot_tell",
      "landed",
      "landed_part",
      "not_ours",
      "nothing_to_ship",
      "waiting_on_person",
    ]);
    // Every tag but the ones only the machine gives: a pull request thrown out of the queue, and its own failures.
    expect([...tags].sort()).toEqual([
      "back_to_builder/bot_comment",
      "back_to_builder/checks_red",
      "back_to_builder/conflicts_with_main",
      "back_to_builder/review_failed",
      "cannot_tell/approval_unknown",
      "cannot_tell/checks_pending",
      "cannot_tell/checks_stuck",
      "cannot_tell/mergeable_unknown",
      "cannot_tell/reviews_unknown",
      "nothing_to_ship/closed",
      "nothing_to_ship/draft",
      "waiting_on_person/owner_approval",
      "waiting_on_person/resolve_comment",
    ]);
  });

  it("go means every line passed, and its landing agrees with landedAs", () => {
    for (const f of every) {
      const gate = shipGate(f);
      if (!gate.go) continue;
      expect(f).toMatchObject({ state: "open", ours: true, reviews: "passed", checks: "green", mergeable: "clean", comments: [] });
      expect(["not_needed", "given"]).toContain(f.approval);
      expect(gate.head).toBe(f.head);
      expect(landedAs(f).kind).toBe(gate.landing === "part" ? "landed_part" : "landed");
    }
  });

  it("the schema refuses an outcome that is not one of the eight, or a tag it does not know", () => {
    expect(() => decode({ kind: "queued" })).toThrow();
    expect(() => decode({ kind: "back_to_builder", why: "head_behind_base" })).toThrow();
    expect(() => decode({ kind: "landed", commit: "abc1234" })).toThrow();
    expect(() => decode({ kind: "nothing_to_ship", why: "merged" })).toThrow();
    expect(() => decode({ kind: "waiting_on_person", forWhat: "resolve your comment" })).toThrow();
    expect(() => decode({ kind: "cannot_tell" })).toThrow();
  });
});
