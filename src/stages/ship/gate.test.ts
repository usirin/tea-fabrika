import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ShipFacts } from "./facts.ts";
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
  { name: "already merged", patch: { state: "merged" }, outcome: { kind: "landed", commit: "abc1234" } },
  { name: "not ours", patch: { ours: false }, outcome: { kind: "not_ours" } },
  { name: "conflicts with main", patch: { mergeable: "conflicts" }, outcome: { kind: "back_to_builder", why: "conflicts_with_main" } },
  { name: "a failed review", patch: { reviews: "failed" }, outcome: { kind: "back_to_builder", why: "review_failed" } },
  { name: "a missing review", patch: { reviews: "missing" }, outcome: { kind: "back_to_reviewer" } },
  { name: "red checks", patch: { checks: "red" }, outcome: { kind: "back_to_builder", why: "checks_red" } },
  {
    name: "a person's open comment",
    patch: { comments: [person] },
    outcome: { kind: "waiting_on_person", who: "the commenter", forWhat: "resolve your comment" },
  },
  { name: "a bot's open comment", patch: { comments: [bot] }, outcome: { kind: "back_to_builder", why: "bot_comment" } },
  {
    name: "a missing approval",
    patch: { approval: "missing" },
    outcome: { kind: "waiting_on_person", who: "an owner", forWhat: "approve this pull request" },
  },
  { name: "checks still running", patch: { checks: "pending" }, outcome: { kind: "cannot_tell" } },
  { name: "stuck checks", patch: { checks: "stuck" }, outcome: { kind: "cannot_tell" } },
  { name: "mergeable not known", patch: { mergeable: "unknown" }, outcome: { kind: "cannot_tell" } },
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
    expect(outcomeOf({ state: "merged", ticket: "part_of_it" })).toEqual({ kind: "landed_part", commit: "abc1234" });
    expect(outcomeOf({ state: "merged", ticket: "none" })).toEqual({ kind: "landed", commit: "abc1234" });
  });
});

describe("the order of the lines", () => {
  it("an earlier line wins over every later one", () => {
    const checked: string[] = [];
    LINES.forEach((first, i) => {
      for (const later of LINES.slice(i + 1)) {
        const patch = both(first.patch, later.patch);
        // Two lines with the same answer (the three ways to "cannot tell") have no order to pin.
        if (patch === null || JSON.stringify(first.outcome) === JSON.stringify(later.outcome)) continue;
        expect(outcomeOf(patch), `${first.name} + ${later.name}`).toEqual(first.outcome);
        checked.push(`${first.name} > ${later.name}`);
      }
    });

    // 66 pairs of lines, less 5 that cannot hold together and 2 with the same answer.
    expect(checked).toHaveLength(59);
  });

  it("a merged pull request is a landing even when it is not ours", () => {
    expect(outcomeOf({ state: "merged", ours: false })).toEqual({ kind: "landed", commit: "abc1234" });
  });

  it("conflicts beat a failed review", () => {
    expect(outcomeOf({ mergeable: "conflicts", reviews: "failed" })).toEqual({ kind: "back_to_builder", why: "conflicts_with_main" });
  });

  it("a failed or missing review is answered before red checks", () => {
    expect(outcomeOf({ reviews: "failed", checks: "red" })).toEqual({ kind: "back_to_builder", why: "review_failed" });
    expect(outcomeOf({ reviews: "missing", checks: "red" })).toEqual({ kind: "back_to_reviewer" });
  });

  it("a person's comment beats a bot's, in either order", () => {
    const asked = { kind: "waiting_on_person", who: "the commenter", forWhat: "resolve your comment" };

    expect(outcomeOf({ comments: [person, bot] })).toEqual(asked);
    expect(outcomeOf({ comments: [bot, person] })).toEqual(asked);
  });

  it("asks for a missing approval only after the comments", () => {
    expect(outcomeOf({ approval: "missing", comments: [person] })).toMatchObject({ who: "the commenter" });
    expect(outcomeOf({ approval: "missing", comments: [bot] })).toEqual({ kind: "back_to_builder", why: "bot_comment" });
    expect(outcomeOf({ approval: "missing" })).toMatchObject({ who: "an owner" });
  });

  it("asks for a missing approval before it says it cannot tell", () => {
    expect(outcomeOf({ approval: "missing", checks: "pending" })).toMatchObject({ kind: "waiting_on_person", who: "an owner" });
    expect(outcomeOf({ approval: "missing", mergeable: "unknown" })).toMatchObject({ kind: "waiting_on_person", who: "an owner" });
  });
});

describe("landedAs", () => {
  it("a pull request that closes its ticket, or names none, lands whole", () => {
    expect(landedAs(facts({ ticket: "closes_it" }))).toEqual({ kind: "landed", commit: "abc1234" });
    expect(landedAs(facts({ ticket: "none", head: "fff0000" }))).toEqual({ kind: "landed", commit: "fff0000" });
  });

  it("a pull request that is part of its ticket lands as a part", () => {
    expect(landedAs(facts({ ticket: "part_of_it" }))).toEqual({ kind: "landed_part", commit: "abc1234" });
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
                  every.push({ head: "abc1234", state, ours, ticket, approval, reviews, checks, mergeable, comments });
  const decode = Schema.decodeUnknownSync(ShipOutcome);

  it("the facts themselves decode with the ShipFacts schema", () => {
    expect(every).toHaveLength(10_368);
    expect(Schema.decodeUnknownSync(ShipFacts)(clear)).toEqual(clear);
    expect(() => Schema.decodeUnknownSync(ShipFacts)({ ...clear, checks: "yellow" })).toThrow();
  });

  it("every outcome decodes with the ShipOutcome schema", () => {
    const kinds = new Set<string>();
    const whys = new Set<string>();
    for (const f of every) {
      const gate = shipGate(f);
      if (gate.go) continue;
      expect(decode(gate.outcome)).toEqual(gate.outcome);
      kinds.add(gate.outcome.kind);
      if (gate.outcome.kind === "back_to_builder") whys.add(gate.outcome.why);
    }

    // All seven kinds. `thrown_out_of_queue` is the one reason the gate never gives: the queue does.
    expect([...kinds].sort()).toEqual(["back_to_builder", "back_to_reviewer", "cannot_tell", "landed", "landed_part", "not_ours", "waiting_on_person"]);
    expect([...whys].sort()).toEqual(["bot_comment", "checks_red", "conflicts_with_main", "review_failed"]);
  });

  it("go means every line passed, and its landing agrees with landedAs", () => {
    for (const f of every) {
      const gate = shipGate(f);
      if (!gate.go) continue;
      expect(f).toMatchObject({ ours: true, reviews: "passed", checks: "green", mergeable: "clean", comments: [] });
      expect(f.approval).not.toBe("missing");
      expect(gate.head).toBe(f.head);
      expect(landedAs(f).kind).toBe(gate.landing === "part" ? "landed_part" : "landed");
    }
  });

  it("the schema refuses an outcome that is not one of the seven", () => {
    expect(() => decode({ kind: "queued" })).toThrow();
    expect(() => decode({ kind: "back_to_builder", why: "head_behind_base" })).toThrow();
    expect(() => decode({ kind: "landed" })).toThrow();
  });
});
