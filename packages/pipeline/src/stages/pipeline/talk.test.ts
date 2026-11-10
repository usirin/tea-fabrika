import { describe, expect, it } from "vitest";
import type { Outcome } from "../../tickets/ticket.ts";
import { MAX_ROUNDS } from "./machine.ts";
import { endTalk } from "./talk.ts";

// What a step's end says on the ticket. A stuck the lane turns into a question is no stuck to a
// person: they get the question, and what the step found beside it, never "is stuck".
describe("what a step's end says on the ticket", () => {
  const SAYS = ["The builder changed nothing in round 3 of 3, and the new test is still failing."];
  const SPENT: Outcome = { kind: "stuck", why: "rounds_spent" };

  it("a build stuck on its rounds, which the lane asks about, says what it found and not that it is stuck", () => {
    expect(endTalk("build", SPENT, MAX_ROUNDS, SAYS)).toEqual({ kind: "found", body: SAYS[0] });
  });

  it("a stuck the lane ends on says so, with why", () => {
    expect(endTalk("build", { kind: "stuck", why: "no_change" }, 1, SAYS)).toEqual({
      kind: "stuck",
      body: `build is stuck. ${SAYS[0]}`,
    });
  });

  it("an ask says what it found, and an end with nothing found says nothing", () => {
    const ask: Outcome = { kind: "ask", who: "owner", for: "still_red" };
    expect(endTalk("build", ask, 2, SAYS)).toEqual({ kind: "found", body: SAYS[0] });
    expect(endTalk("build", SPENT, MAX_ROUNDS, [])).toBeNull();
    expect(endTalk("build", { kind: "done", part: false }, 1, SAYS)).toBeNull();
  });
});
