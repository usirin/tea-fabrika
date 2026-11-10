import type { Entry } from "@kampus/pipeline/tickets/ticket";
import { describe, expect, it } from "vitest";
import { rowOf } from "./rows.ts";

// Self-fix PR 5: a stuck lane restarts, and the ticket shows one row for it, with who, when, from
// which step, and the old and new base. Who and when are the entry's; the rest is the fact's.

const LANE = { kind: "agent", id: "lane", for: "owner" } as const;
const BASE = "5d38d582aa11bb22cc33dd44ee55ff6677889900";
const ONTO = "9f3c2e1aa11bb22cc33dd44ee55ff6677889900";

const restarted = (base: string | null, onto: string): Entry => ({
  pos: 41,
  ticket: 117,
  by: LANE,
  at: 1_762_000_000_000,
  fact: { type: "restarted", from: "mutation", base, onto },
});

const words = (entry: Entry) => {
  const row = rowOf(entry, [entry]);
  return `${row.text} ${row.more}`;
};

describe("the ticket's row for a restart", () => {
  it("names the step it went on from, and both bases when main moved", () => {
    const entry = restarted(BASE, ONTO);
    const row = rowOf(entry, [entry]);
    expect(row).toMatchObject({ type: "restarted", by: LANE, at: entry.at });
    expect(words(entry)).toContain("mutation");
    expect(words(entry)).toContain(BASE.slice(0, 7));
    expect(words(entry)).toContain(ONTO.slice(0, 7));
  });

  it("names the base once when main had not moved", () => {
    const entry = restarted(BASE, BASE);
    expect(words(entry)).toContain("mutation");
    expect(words(entry).split(BASE.slice(0, 7))).toHaveLength(2);
  });

  it("names the new base when the lane had none", () => {
    const entry = restarted(null, ONTO);
    expect(words(entry)).toContain("mutation");
    expect(words(entry)).toContain(ONTO.slice(0, 7));
  });
});
