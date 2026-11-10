import { Ledger, listed, Shell } from "@kampus/fabrika-old";
import { callOf, toolsOf } from "@kampus/fabrika-old/mcp";
import { memoryService } from "@kampus/fabrika-old/memory";
import { covers, hashOf, textOf } from "@kampus/pipeline/tickets/approval";
import { type Entry, type Fact, fold } from "@kampus/pipeline/tickets/ticket";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { Author, pullRequestsOf, tracker } from "./index.ts";
import { factOf, summaryOf } from "./ticket.ts";

// What a person's write puts on the ledger, and a ticket as the list sums it up.

const owner = { kind: "user", id: "owner" } as const;

const entry = (pos: number, fact: Fact): Entry => ({
  pos,
  ticket: 1,
  by: owner,
  at: pos * 1000,
  fact,
});

describe("a write", () => {
  it("is a comment, or one that asks for changes: the button says which", async () => {
    const plain = await Effect.runPromise(factOf({ kind: "comment", ticket: 1, body: "Seen it." }));
    const changes = await Effect.runPromise(
      factOf({ kind: "comment", ticket: 1, body: "Skip part 2.", asks: "changes" }),
    );
    expect([plain, changes]).toEqual([
      { type: "commented", body: "Seen it." },
      { type: "commented", body: "Skip part 2.", asks: "changes" },
    ]);
  });

  it("answers with the hash of the text the person saw", async () => {
    const saw = { title: "Login fails", body: "On main." };
    const [fact, hash] = await Effect.runPromise(
      Effect.all([factOf({ kind: "answer", ticket: 1, ask: "a-1", pick: "approve", note: "", saw }), hashOf(saw)], {
        concurrency: "unbounded",
      }),
    );
    expect(fact).toEqual({ type: "answered", ask: "a-1", pick: "approve", note: "", text: hash });
  });
});

describe("the list", () => {
  it("sums a ticket up: its comments, and when it last moved", () => {
    const [ticket] = fold(
      [],
      [
        entry(1, { type: "filed", title: "Login fails", body: "" }),
        entry(2, { type: "commented", body: "One." }),
        entry(3, { type: "closed" }),
        entry(4, { type: "commented", body: "Two." }),
      ],
    ).tickets;
    expect(ticket && summaryOf(ticket)).toEqual({
      number: 1,
      title: "Login fails",
      state: "closed",
      comments: 2,
      at: 4000,
    });
  });
});

// Ticket 196: a filing records where it came from (docs/direction/a-ticket-says-where-it-came-from.md).
// An agent files through `tracker_file`, a tool made from `File`'s own schema; what it puts on the
// ledger is the `filed` fact `factOf` makes. PR 352 and its mutation step are ticket 188's.

const FROM = {
  _tag: "pr",
  url: "https://github.com/usirin/tea-fabrika/pull/352",
  step: "mutation",
} as const;

describe("a filing's `from`", () => {
  // p2, the write side
  it("goes onto the `filed` fact as written, and a filing without one has no `from` key", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const withFrom = yield* factOf({
          kind: "file",
          title: "Mutation runner",
          body: "",
          from: FROM,
        });
        const without = yield* factOf({ kind: "file", title: "Mutation runner", body: "" });
        expect(withFrom).toStrictEqual({
          type: "filed",
          title: "Mutation runner",
          body: "",
          from: FROM,
        });
        expect(without).toStrictEqual({ type: "filed", title: "Mutation runner", body: "" });
      }),
    ));
});

describe("the agents' `tracker_file` tool", () => {
  const agent = { kind: "agent", id: "review", for: "owner" } as const;
  const list = () =>
    Shell.programList([
      listed(
        tracker,
        Layer.mergeAll(Layer.succeed(Ledger, memoryService()), Layer.succeed(Author, agent), pullRequestsOf([])),
      ),
    ]);
  const call = (from: unknown) =>
    callOf(list(), "tracker_file", { value: { title: "Mutation runner", body: "", from } });

  // p3
  it("takes a `from` of each case, and tells the agent to fill it in", () => {
    for (const from of [
      FROM,
      { _tag: "run", ticket: 117, run: "r-test_writer-26" },
      { _tag: "run", ticket: 117, run: "r-test_writer-25", head: "b5b969a0" },
      { _tag: "walk", url: "https://github.com/usirin/tea-fabrika/pull/332" },
    ]) {
      expect(call(from)).toEqual({
        kind: "input",
        program: "tracker",
        input: "file",
        value: { title: "Mutation runner", body: "", from },
      });
    }

    const tool = toolsOf(list()).find((t) => t.name === "tracker_file");
    expect(tracker.inputs.file.description).toMatch(/\bfrom\b/);
    expect(JSON.stringify(tool?.inputSchema)).toContain('"from"');
  });

  // p3
  const bad: readonly (readonly [string, unknown, RegExp])[] = [
    ["an unknown `_tag`", { _tag: "job", url: FROM.url }, /\["from"\]/],
    [
      "a `pr` url that is not a pull request",
      { _tag: "pr", url: "https://github.com/usirin/tea-fabrika/issues/352" },
      /\["from"\]\["url"\]/,
    ],
    ["a `run` on ticket 0", { _tag: "run", ticket: 0, run: "r-1" }, /\["from"\]\["ticket"\]/],
    ["a `run` at a short sha", { _tag: "run", ticket: 117, run: "r-1", head: "b5b96" }, /\["from"\]\["head"\]/],
  ];
  it.each(bad)("refuses %s before anything is told, and says what in it is wrong", (_, from, where) => {
    const read = call(from);
    expect(read.kind).toBe("refused");
    const why = read.kind === "refused" ? read.why : "";
    // Not refused as a key the tool does not know: refused for what the value holds.
    expect(why).not.toMatch(/excess/);
    expect(why).toMatch(where);
  });
});

describe("an approval of a filing with a `from`", () => {
  // p7
  it("covers its title and body only, as for a filing without one", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const filed = (fact: Fact) => fold([], [entry(1, fact)]).tickets[0];
        const withFrom = filed({ type: "filed", title: "Login fails", body: "On main.", from: FROM });
        const without = filed({ type: "filed", title: "Login fails", body: "On main." });

        if (withFrom === undefined || without === undefined) {
          return yield* Effect.die("the fold made no ticket");
        }

        expect(textOf(withFrom)).toStrictEqual({ title: "Login fails", body: "On main." });
        const answer = yield* factOf({
          kind: "answer",
          ticket: 1,
          ask: "a-1",
          pick: "approve",
          note: "",
          saw: textOf(withFrom),
        });

        if (answer.type !== "answered") {
          return yield* Effect.die("not an answer");
        }

        expect(answer.text).toBe(yield* hashOf({ title: "Login fails", body: "On main." }));
        expect([yield* covers(answer, withFrom), yield* covers(answer, without)]).toEqual([true, true]);
      }),
    ));
});
