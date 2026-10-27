import {describe, expect, it} from "vitest";
import type {Entry} from "./ticket.ts";
import {agentOf, whenOf} from "./window.tsx";

// Who wrote a row, as the window says it after the writer's id.

describe("who", () => {
	const fact = {type: "commented", body: "Seen it."} as const;
	const row = (by: Entry["by"], whose?: string): Entry => ({
		pos: 1,
		ticket: 1,
		by,
		at: 0,
		fact,
		...(whose === undefined ? {} : {whose}),
	});
	it("says whose agent it is, by the person's name on this ledger, or their id", () => {
		expect(agentOf(row({kind: "agent", id: "old-host", for: "github:7"}, "alice"))).toBe(
			"alice's agent",
		);
		expect(agentOf(row({kind: "agent", id: "old-host", for: "github:7"}))).toBe("github:7's agent");
	});
	it("says only agent for a row from before the door, and nothing for a person", () => {
		expect(agentOf(row({kind: "agent", id: "review"}))).toBe("agent");
		expect(agentOf(row({kind: "user", id: "github:7"}))).toBeNull();
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
