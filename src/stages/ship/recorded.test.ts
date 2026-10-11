import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { type CompiledLane, compileLane, parseLog, walk } from "../../lane-log.ts";
import { issueWorkflow, log } from "../../lane-scripted.ts";
import { ShipOutcome } from "./outcome.ts";
import { endingOf, type Mapped, outcomeOf, type RecordedEnding } from "./recorded.ts";

// Recorded shipper endings, set beside the ship machine's outcomes. The logs
// here are written by hand in fabrika's shape; no real lane's data is in here.

/** Fold a log, and give back how each stay in `ship` ended. */
function endings(...lines: readonly string[]): RecordedEnding[] {
  const walked = walk(compileLane(issueWorkflow()) as CompiledLane, parseLog(log(...lines)).entries);
  return Object.values(walked.steps)
    .flat()
    .flatMap((step) => endingOf(step) ?? []);
}
const toShip = ["WIP", "DONE", "PASS"] as const;

describe("reading a shipper's ending off the log", () => {
  it("reads each of the seven endings", () => {
    expect(endings(...toShip, "DONE")).toEqual([{ ending: "merged" }]);
    expect(endings(...toShip, 'DONE {"partial":true}')).toEqual([{ ending: "merged_issue_open" }]);
    expect(endings(...toShip, "WIP")).toEqual([{ ending: "queued" }]);
    expect(endings(...toShip, 'BLOCKED {"cause":"head-behind-base"}')).toEqual([{ ending: "parked", cause: "head-behind-base" }]);
    expect(endings(...toShip, "FAIL")).toEqual([{ ending: "sent_back" }]);
    expect(endings(...toShip, 'LAP {"cause":"base-conflicted"}')).toEqual([{ ending: "lap", cause: "base-conflicted" }]);
    expect(endings(...toShip, "LANDED")).toEqual([{ ending: "board_ended", how: "landed" }]);
  });

  it("keeps a park with no cause as a park with no cause", () => {
    expect(endings(...toShip, "BLOCKED")).toEqual([{ ending: "parked", cause: null }]);
  });

  it("counts one ending for each stay in ship, and none for what the queue did after", () => {
    // Parked in ship, unparked back into it, queued, merged from the queue: two stays, two endings.
    expect(endings(...toShip, 'BLOCKED {"cause":"head-ci-red"}', "UNBLOCKED", "WIP", "DONE")).toEqual([
      { ending: "parked", cause: "head-ci-red" },
      { ending: "queued" },
    ]);
  });

  it("does not count a lap that leaves the task in ship", () => {
    expect(endings(...toShip, 'LAP {"cause":"queue-ejected"}', "DONE")).toEqual([{ ending: "merged" }]);
  });

  it("reads nothing off a lane that never reached ship", () => {
    expect(endings("WIP", "DONE", "FAIL", "DONE")).toEqual([]);
  });
});

describe("the outcome a recorded ending stands for", () => {
  it.each<[RecordedEnding, Mapped]>([
    [{ ending: "merged" }, { mapped: true, kind: "landed" }],
    [{ ending: "merged_issue_open" }, { mapped: true, kind: "landed_part" }],
    [{ ending: "sent_back" }, { mapped: true, kind: "back_to_builder", why: null }],
    [{ ending: "lap", cause: "base-conflicted" }, { mapped: true, kind: "back_to_builder", why: "conflicts_with_main" }],
    [{ ending: "parked", cause: "awaiting-cp-approval" }, { mapped: true, kind: "waiting_on_person", for: "owner_approval" }],
    [{ ending: "parked", cause: "head-ci-red" }, { mapped: true, kind: "back_to_builder", why: "checks_red" }],
  ])("%j fits one outcome", (ending, mapped) => {
    expect(outcomeOf(ending)).toEqual(mapped);
  });

  it.each<[RecordedEnding, Mapped]>([
    [{ ending: "queued" }, { mapped: false, reason: "not_an_ending" }],
    [{ ending: "parked", cause: "head-behind-base" }, { mapped: false, reason: "no_outcome_fits" }],
    [{ ending: "parked", cause: null }, { mapped: false, reason: "line_does_not_say" }],
    [{ ending: "parked", cause: "a-new-word" }, { mapped: false, reason: "unknown_cause" }],
    [{ ending: "lap", cause: null }, { mapped: false, reason: "line_does_not_say" }],
    [{ ending: "lap", cause: "queue-ejected" }, { mapped: false, reason: "unknown_cause" }],
    [{ ending: "board_ended", how: "landed" }, { mapped: false, reason: "fits_two", kinds: ["landed", "landed_part"] }],
    [{ ending: "board_ended", how: "cancelled" }, { mapped: false, reason: "no_outcome_fits" }],
    [{ ending: "other", event: "PASS" }, { mapped: false, reason: "no_outcome_fits" }],
  ])("%j is left unmapped", (ending, mapped) => {
    expect(outcomeOf(ending)).toEqual(mapped);
  });

  it("a cause that is a property of every object is still an unknown cause", () => {
    expect(outcomeOf({ ending: "parked", cause: "constructor" })).toEqual({ mapped: false, reason: "unknown_cause" });
    expect(outcomeOf({ ending: "lap", cause: "toString" })).toEqual({ mapped: false, reason: "unknown_cause" });
  });

  it("maps only onto kinds the ShipOutcome schema knows", () => {
    const kinds = new Set(ShipOutcome.members.map((member) => member.fields.kind.literal));
    const all: RecordedEnding[] = [
      { ending: "merged" },
      { ending: "merged_issue_open" },
      { ending: "queued" },
      { ending: "sent_back" },
      { ending: "lap", cause: "base-conflicted" },
      { ending: "parked", cause: "awaiting-cp-approval" },
      { ending: "parked", cause: "head-ci-red" },
      { ending: "parked", cause: "head-behind-base" },
      { ending: "parked", cause: null },
      { ending: "board_ended", how: "landed" },
      { ending: "board_ended", how: "cancelled" },
    ];
    const reached = new Set<string>();
    for (const ending of all) {
      const mapped = outcomeOf(ending);
      if (mapped.mapped) {
        expect(kinds.has(mapped.kind)).toBe(true);
        reached.add(mapped.kind);
      } else if (mapped.reason === "fits_two") expect(mapped.kinds.every((kind) => kinds.has(kind))).toBe(true);
    }
    // No logged ending is `nothing_to_ship`, `cannot_tell`, `back_to_reviewer` or `not_ours`: today's shipper has no word for them.
    expect([...reached].sort()).toEqual(["back_to_builder", "landed", "landed_part", "waiting_on_person"]);
    // A named reason is one the schema takes.
    const sent = outcomeOf({ ending: "parked", cause: "head-ci-red" });
    expect(sent.mapped && sent.kind === "back_to_builder" && Schema.decodeUnknownSync(ShipOutcome)({ kind: sent.kind, why: sent.why })).toEqual({
      kind: "back_to_builder",
      why: "checks_red",
    });
  });
});
