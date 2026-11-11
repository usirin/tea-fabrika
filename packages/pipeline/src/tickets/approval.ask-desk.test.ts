import { readFileSync } from "node:fs";
import type { Writer } from "@kampus/fabrika-old";
import { Effect, Schema } from "effect";
import { describe, expect } from "vitest";
import { property, unicode } from "../ask-desk.test-support.ts";
import { covers, hashOf, textOf, Text } from "./approval.ts";
import { sealAsk } from "./ask.ts";
import { type Entry, Fact, type FactOf, type Ticket } from "./ticket.ts";

// Today's version. What an answer approves (P4): an old title-and-body hash never approves a
// planned ticket or a change, and a sealed answer the ask refuses covers nothing.
const { DRAFT, FILED, HEAD, TOOK } = JSON.parse(
  readFileSync(new URL("../../../../fixtures/ask-desk/cases.json", import.meta.url), "utf8"),
);

const OWNER: Writer = { kind: "user", id: "owner" };
const LANE: Writer = { kind: "agent", id: "lane", for: "owner" };

const textInput = Schema.Struct({
  title: Text.fields.title.check(unicode),
  body: Text.fields.body.check(unicode),
});

const ticketOf = (facts: readonly (readonly [Writer, unknown])[], title = FILED.title): Ticket => ({
  number: 117,
  title,
  state: "open",
  timeline: facts.map(([by, fact], i): Entry => ({
    pos: i + 1,
    ticket: 117,
    by,
    at: i,
    fact: Schema.decodeUnknownSync(Fact)(fact),
  })),
});

const answered = (fact: unknown): FactOf<"answered"> => {
  const read = Schema.decodeUnknownSync(Fact)(fact);

  if (read.type !== "answered") {
    throw new Error("not an answer");
  }

  return read;
};

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect);

describe("ask desk P4: an old text hash approves only a plain ticket", () => {
  const legacy = { type: "asked", ask: "a-approve-2", what: "Approve?", picks: ["approve", "no"] };
  const old = async (text: Text, more: Record<string, unknown> = {}) =>
    answered({
      type: "answered",
      ask: "a-approve-2",
      pick: "approve",
      note: "",
      text: await run(hashOf(text)),
      ...more,
    });

  property(
    "approves when the title and body read the same and nothing was planned",
    { text: textInput },
    async ({ text }) => {
      const ticket = ticketOf(
        [
          [OWNER, { ...FILED, ...text }],
          [LANE, legacy],
        ],
        text.title,
      );
      expect(await run(hashOf(textOf(ticket)))).toBe(await run(hashOf(text)));
      expect(await run(covers(await old(text), ticket))).toBe(true);
    },
  );
  property("does not approve once the ticket has a planned fact", { text: textInput }, async ({ text }) => {
    const ticket = ticketOf(
      [
        [OWNER, { ...FILED, ...text }],
        [LANE, { type: "planned", version: 1, tasks: [] }],
        [LANE, legacy],
      ],
      text.title,
    );
    expect(await run(covers(await old(text), ticket))).toBe(false);
  });
  property("does not approve an answer that names a head", { text: textInput }, async ({ text }) => {
    const ticket = ticketOf(
      [
        [OWNER, { ...FILED, ...text }],
        [LANE, legacy],
      ],
      text.title,
    );
    expect(await run(covers(await old(text, { head: HEAD }), ticket))).toBe(false);
  });
});

describe("ask desk P4: a sealed answer the ask refuses covers nothing", () => {
  const seeded = async (ticket: Text) => {
    const ask = await run(sealAsk({ ...DRAFT, ticket }));
    const answer = (value: unknown) =>
      answered({
        type: "answered",
        format: 1,
        ask: ask.ask,
        answer: value,
        saw: ask.saw,
        via: { _tag: "window", took: TOOK },
      });
    return { ask, answer };
  };
  property("covers with the shown hash and an offered pick", { text: textInput }, async ({ text }) => {
    const { ask, answer } = await seeded(text);
    const ticket = ticketOf(
      [
        [OWNER, { ...FILED, ...text }],
        [LANE, { type: "planned", version: 2, tasks: [] }],
        [LANE, ask],
      ],
      text.title,
    );
    expect(await run(covers(answer({ _tag: "rec" }), ticket))).toBe(true);
  });
  property(
    "does not cover a pick the ask never offered, though the hash matches",
    { text: textInput },
    async ({ text }) => {
      const { ask, answer } = await seeded(text);
      const ticket = ticketOf(
        [
          [OWNER, { ...FILED, ...text }],
          [LANE, { type: "planned", version: 2, tasks: [] }],
          [LANE, ask],
        ],
        text.title,
      );
      expect(await run(covers(answer({ _tag: "against", pick: "merge", note: "Wrong pick" }), ticket))).toBe(false);
    },
  );
  property("does not cover once the plan moved on, though the hash matches", { text: textInput }, async ({ text }) => {
    const { ask, answer } = await seeded(text);
    const ticket = ticketOf(
      [
        [OWNER, { ...FILED, ...text }],
        [LANE, { type: "planned", version: 2, tasks: [] }],
        [LANE, ask],
        [LANE, { type: "planned", version: 3, tasks: [] }],
      ],
      text.title,
    );
    expect(await run(covers(answer({ _tag: "rec" }), ticket))).toBe(false);
  });
});
