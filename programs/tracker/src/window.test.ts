import type { Suggested } from "@kampus/pipeline/tickets/area";
import type { Entry } from "@kampus/pipeline/tickets/ticket";
import { describe, expect, it } from "vitest";
// made up: `firstAreasOf` exported from the window, for this test; today it is the window's own.
import { agentOf, firstAreasOf, whenOf } from "./window.tsx";

// Who wrote a row, as the window says it after the writer's id.

describe("who", () => {
  const fact = { type: "commented", body: "Seen it." } as const;
  const row = (by: Entry["by"], whose?: string): Entry => ({
    pos: 1,
    ticket: 1,
    by,
    at: 0,
    fact,
    ...(whose === undefined ? {} : { whose }),
  });
  it("says whose agent it is, by the person's name on this ledger, or their id", () => {
    expect(agentOf(row({ kind: "agent", id: "old-host", for: "github:7" }, "alice"))).toBe("alice's agent");
    expect(agentOf(row({ kind: "agent", id: "old-host", for: "github:7" }))).toBe("github:7's agent");
  });
  it("says only agent for a row from before the door, and nothing for a person", () => {
    expect(agentOf(row({ kind: "agent", id: "review" }))).toBe("agent");
    expect(agentOf(row({ kind: "user", id: "github:7" }))).toBeNull();
  });
});

// When a fact was written, as the window says it: short today, longer the further back it is.

describe("when", () => {
  const now = new Date(2026, 9, 25, 16, 30).getTime();
  it("is the time today, yesterday and the time, the day this year, and the year before that", () => {
    expect(
      [
        new Date(2026, 9, 25, 9, 5),
        new Date(2026, 9, 24, 23, 59),
        new Date(2026, 2, 3, 12, 0),
        new Date(2025, 11, 31, 8, 0),
      ].map((d) => whenOf(d.getTime(), now)),
    ).toEqual(["09:05", "yesterday 23:59", "3 Mar 12:00", "31 Dec 2025 08:00"]);
  });
});

// Areas PR 1, round 2 (from the mutation step): what Enter on the onboarding makes. The ticked
// suggestions in the order shown, each with what it was, then the typed name unless a ticked one
// has it, ignoring case. The keys themselves are the shots'.

describe("the first areas Enter makes", () => {
  const lane: Suggested = { _tag: "titles", word: "lane", tickets: 3 };
  const fabrika: Suggested = { _tag: "folder", path: "apps/fabrika" };
  const tracker: Suggested = { _tag: "folder", path: "programs/tracker" };
  const shown = [lane, fabrika, tracker];

  it("are the ticked ones, in the order shown, each keeping what it was suggested from", () => {
    expect(firstAreasOf(shown, new Set(["tracker", "lane"]), "")).toEqual([
      { name: "lane", suggested: lane },
      { name: "tracker", suggested: tracker },
    ]);
  });

  it("names a folder by its last part", () => {
    expect(firstAreasOf(shown, new Set(["fabrika"]), "")).toEqual([{ name: "fabrika", suggested: fabrika }]);
  });

  it("add the typed name, trimmed, with no suggestion", () => {
    expect(firstAreasOf(shown, new Set(["lane"]), "  desk ")).toStrictEqual([
      { name: "lane", suggested: lane },
      { name: "desk" },
    ]);
  });

  it("leave out a typed name a ticked one has, in any case, and a blank one", () => {
    expect(firstAreasOf(shown, new Set(["lane"]), "LANE")).toEqual([{ name: "lane", suggested: lane }]);
    expect(firstAreasOf(shown, new Set(["lane"]), "   ")).toEqual([{ name: "lane", suggested: lane }]);
  });

  it("are nothing when nothing is ticked or typed, so Enter makes nothing", () => {
    expect(firstAreasOf(shown, new Set(), "")).toEqual([]);
  });
});
