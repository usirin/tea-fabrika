import { readFileSync } from "node:fs";
import { Effect, Schema } from "effect";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { property, unicode } from "../ask-desk.test-support.ts";
import { Answer, Asked, Rec, answerOf, blindDraw, questionLine, sealAsk, type Asked as Sealed } from "./ask.ts";
import { Fact } from "./ticket.ts";

const { DRAFT, NONE, NOW, REC, TOOK } = JSON.parse(
  readFileSync(new URL("../../../../fixtures/ask-desk/cases.json", import.meta.url), "utf8"),
);

const policyFor = (
  ask: string,
  hidden: boolean,
  choose: (ask: string, seed: number, policy: number) => { hidden: boolean },
) => {
  for (let seed = 119120; seed < 120120; seed++) {
    if (choose(ask, seed, 1).hidden === hidden) {
      return { seed };
    }
  }

  throw new Error("the blind policy produces no matching case in 1000 seeds");
};

// These call signatures specify the new public contract; they implement no product behavior.
const seal: (draft: unknown, policy?: { seed: number }) => Effect.Effect<Sealed, unknown> = sealAsk;
const resolve: (asked: Sealed, answer: unknown) => { pick: string; note: string } | null = answerOf;
const draw: (ask: string, seed: number, policy: number) => { policy: number; hidden: boolean } = blindDraw;
const sealed = (draft = DRAFT) => Effect.runPromise(seal(draft, policyFor(draft.ask, false, draw)));
const idInput = { id: Asked.fields.ask };
const recInput = { sure: Rec.cases.pick.fields.sure };

describe("ask desk P1: a sealed ask is complete", () => {
  property(
    "keeps every recorded field and builds display rec from the sole sealed rec",
    { what: Asked.fields.shows.fields.what.check(unicode) },
    async ({ what }) => {
      const ask = await sealed({ ...DRAFT, what });
      expect(ask).toMatchObject({
        type: "asked",
        format: 1,
        ask: DRAFT.ask,
        for: "approve",
        step: "plan",
        repo: DRAFT.repo,
        why: null,
        rec: REC,
        until: null,
      });
      expect(ask.shows).toEqual({
        what,
        picks: DRAFT.picks,
        ticket: DRAFT.ticket,
        evidence: DRAFT.evidence,
        rec: REC,
      });
      expect(ask.saw).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(Schema.is(Asked)(ask)).toBe(true);
      expect(Schema.decodeUnknownSync(Fact)(ask)).toEqual(ask);
    },
  );
  describe.each([
    ["unoffered rec", { ...DRAFT, rec: { ...REC, pick: "merge" } }],
    ["long question", { ...DRAFT, what: "x".repeat(121) }],
    ["blank question", { ...DRAFT, what: "   " }],
    ["multiline question", { ...DRAFT, what: "Approve?\nReally?" }],
    ["missing effects", { ...DRAFT, picks: [{ pick: "approve" }, { pick: "no" }] }],
    ["no picks", { ...DRAFT, picks: [] }],
    ["no full plan", { ...DRAFT, evidence: { _tag: "plan", version: 2 } }],
    ["missing repo", { ...DRAFT, repo: undefined }],
    ["missing reason", { ...DRAFT, why: undefined }],
  ])("%s", (_name, draft) => {
    property("refuses malformed asks for every identity", idInput, async ({ id }) => {
      expect(await Effect.runPromise(Effect.exit(seal({ ...draft, ask: id })))).toMatchObject({
        _tag: "Failure",
      });
    });
  });
  it("refuses confidence outside the finite percentage range", () => {
    fc.assert(
      fc.property(
        fc.double().filter((n) => !Number.isFinite(n) || n < 0 || n > 100),
        (sure) => {
          for (const invalid of [-1, 101, Number.NaN, Infinity, sure]) {
            expect(Schema.is(Rec)({ ...REC, sure: invalid })).toBe(false);
          }
        },
      ),
      { seed: 119120 },
    );
  });
  property(
    "keeps unknown confidence and an absent recommendation honest",
    { why: Rec.cases.none.fields.why.check(unicode) },
    async ({ why }) => {
      expect(Schema.is(Rec)({ ...REC, sure: null })).toBe(true);
      const rec = { ...NONE, why };
      const ask = await Effect.runPromise(seal({ ...DRAFT, rec }));
      expect(ask.shows.rec).toEqual(rec);
    },
  );
});

describe("ask desk P7: what an answer means", () => {
  property(
    "rec resolves to this ask's recommendation, including when it recommends stop",
    recInput,
    async ({ sure }) => {
      const ask = await sealed({ ...DRAFT, rec: { ...REC, sure } });
      expect(resolve(ask, { _tag: "rec" })).toEqual({ pick: "approve", note: "" });
      const stopped = await Effect.runPromise(
        seal({ ...DRAFT, rec: { ...REC, sure, pick: "no" } }, policyFor(DRAFT.ask, false, draw)),
      );
      expect(resolve(stopped, { _tag: "rec" })).toEqual({ pick: "no", note: "" });
      expect(resolve(stopped, { _tag: "against", pick: "approve", note: "Keep going" })).toEqual({
        pick: "approve",
        note: "Keep going",
      });
    },
  );
  it("against rejects every blank, multiline or overlong note", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.array(fc.constantFrom(" ", "\t", "\n")).map((xs) => xs.join("")),
          fc.string({ minLength: 121 }),
        ),
        (note) => {
          for (const invalid of ["", " ", "\t", "\n", "x".repeat(121), note]) {
            expect(Schema.is(Answer)({ _tag: "against", pick: "no", note: invalid })).toBe(false);
          }
        },
      ),
      { seed: 119120 },
    );
  });
  property("chose keeps an optional note exactly", { value: Answer.cases.chose }, ({ value }) => {
    for (const note of [undefined, value.note]) {
      const answer = { _tag: "chose", pick: "no", ...(note === undefined ? {} : { note }) };
      expect(Schema.is(Answer)(answer)).toBe(true);
      expect(Schema.decodeUnknownSync(Answer)(JSON.parse(JSON.stringify(answer)))).toStrictEqual(answer);
    }
  });
  it("chose rejects every blank, multiline or overlong note", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.array(fc.constantFrom(" ", "\t", "\n")).map((xs) => xs.join("")),
          fc.string({ minLength: 121 }),
        ),
        (note) => {
          for (const invalid of ["", " ", "\t", "\n", "x".repeat(121), note]) {
            expect(Schema.is(Answer)({ _tag: "chose", pick: "no", note: invalid })).toBe(false);
          }
        },
      ),
      { seed: 119120 },
    );
  });
  property(
    "resolves a chose note with hidden or absent rec",
    { note: Answer.cases.against.fields.note, hidden: Schema.Boolean },
    async ({ note, hidden }) => {
      const ask = await Effect.runPromise(
        seal(
          hidden ? { ...DRAFT, for: "step", rec: REC } : { ...DRAFT, rec: NONE },
          policyFor(DRAFT.ask, hidden, draw),
        ),
      );
      expect(resolve(ask, { _tag: "chose", pick: "no", note })).toEqual({
        pick: "no",
        note,
      });
      expect(resolve(ask, { _tag: "chose", pick: "no" })).toEqual({ pick: "no", note: "" });
    },
  );
  property(
    "refuses foreign picks, rec without a visible rec, and chose when the rec was shown",
    recInput,
    async ({ sure }) => {
      const ask = await sealed({ ...DRAFT, rec: { ...REC, sure } });
      expect(resolve(ask, { _tag: "against", pick: "merge", note: "No" })).toBeNull();
      expect(resolve(ask, { _tag: "chose", pick: "approve" })).toBeNull();
      const absent = await Effect.runPromise(seal({ ...DRAFT, rec: NONE }));
      expect(resolve(absent, { _tag: "rec" })).toBeNull();
    },
  );
});

describe("ask desk P8/P9: blind asks", () => {
  property(
    "an ask with no rec records no hidden recommendation, even when its draw is blind",
    idInput,
    async ({ id }) => {
      const ask = await Effect.runPromise(
        seal({ ...DRAFT, ask: id, for: "step", rec: NONE }, policyFor(id, true, draw)),
      );
      expect(ask.blind.hidden).toBe(false);
      expect(ask.shows.rec).toEqual(NONE);
    },
  );
  property(
    "never hands a hidden rec to the display and keeps a blind answer chose after reveal",
    idInput,
    async ({ id }) => {
      // A step's ask: an approve ask is never drawn blind (review 2, medium 2, below).
      const ask = await Effect.runPromise(seal({ ...DRAFT, ask: id, for: "step" }, policyFor(id, true, draw)));
      expect(ask.rec).toEqual(REC);
      expect(ask.shows.rec).toEqual({ _tag: "hidden" });
      expect(JSON.stringify(ask.shows)).not.toContain(REC.why);
      expect(resolve(ask, { _tag: "rec" })).toBeNull();
      const fact = {
        type: "answered",
        format: 1,
        ask: ask.ask,
        answer: { _tag: "chose", pick: "no" },
        saw: ask.saw,
        via: { _tag: "window", took: { ...TOOK, rec: "hidden" } },
      };
      expect(resolve(ask, fact.answer)).toEqual({ pick: "no", note: "" });
      expect(Schema.decodeUnknownSync(Fact)(JSON.parse(JSON.stringify(fact)))).toEqual(fact);
    },
  );
  it("uses a stable seeded one-in-five draw, with its policy recorded across restarts", async () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 60 }), (id) => {
        expect(draw(id, 119120, 1)).toEqual(draw(JSON.parse(JSON.stringify(id)), 119120, 1));
      }),
      { seed: 119120, numRuns: 100 },
    );
    const draws = Array.from({ length: 1000 }, (_, i) => draw(`ask-${i}`, 119120, 1));
    expect(draws.every((d) => d.policy === 1)).toBe(true);
    // Decided p=1/5. Our binomial calculation: mean 200, sd sqrt(1000*.2*.8)=12.65.
    // This fixed sample allows about four standard deviations and catches biased draws.
    expect(draws.filter((d) => d.hidden).length).toBeGreaterThan(150);
    expect(draws.filter((d) => d.hidden).length).toBeLessThan(250);
    const first = await Effect.runPromise(seal(DRAFT, { seed: 119120 }));
    const restarted = await Effect.runPromise(seal(JSON.parse(JSON.stringify(DRAFT)), { seed: 119120 }));
    expect(restarted).toEqual(first);
    expect(first.blind).toEqual(draw(DRAFT.ask, 119120, 1));
  });
});

describe("ask desk review 2, medium 2: a rec that can only be one pick is never blind", () => {
  // The lane's approve rec comes only from the plan's leans, and it can only ever be approve
  // (recOfLeans): hiding it would hide nothing. The lead's decision: such a kind is never drawn
  // blind, and the sealed fact says it was not.
  property(
    "an approve ask whose draw would hide its rec shows the rec, and records blind as not hidden",
    idInput,
    async ({ id }) => {
      const ask = await Effect.runPromise(seal({ ...DRAFT, ask: id }, policyFor(id, true, draw)));
      expect(ask.for).toBe("approve");
      expect(ask.blind.hidden).toBe(false);
      expect(ask.shows.rec).toEqual(REC);
      expect(resolve(ask, { _tag: "rec" })).toEqual({ pick: "approve", note: "" });
    },
  );
  property("an approve ask is not blind for any seed", { value: Schema.Int }, async ({ value }) => {
    for (const seed of [value, ...Array.from({ length: 20 }, (_, i) => 119120 + i)]) {
      const ask = await Effect.runPromise(seal(DRAFT, { seed }));
      expect(ask.blind.hidden).toBe(false);
      expect(ask.shows.rec).toEqual(REC);
    }
  });
  property("another kind with the same draw stays blind", idInput, async ({ id }) => {
    const ask = await Effect.runPromise(seal({ ...DRAFT, ask: id, for: "step" }, policyFor(id, true, draw)));
    expect(ask.blind.hidden).toBe(true);
    expect(ask.shows.rec).toEqual({ _tag: "hidden" });
  });
});

describe("ask desk P17: needed is optional data", () => {
  property("round-trips needed without collapsing states", idInput, async ({ id }) => {
    for (const needed of [undefined, true, false]) {
      const ask = await sealed({ ...DRAFT, ask: id });
      const fact = {
        type: "answered",
        format: 1,
        ask: ask.ask,
        answer: { _tag: "rec" },
        saw: ask.saw,
        via: { _tag: "window", took: TOOK },
        ...(needed === undefined ? {} : { needed }),
      };
      const read = Schema.decodeUnknownSync(Fact)(JSON.parse(JSON.stringify(fact)));
      expect(read).toStrictEqual(fact);
      expect(Object.hasOwn(read, "needed")).toBe(needed !== undefined);
    }
  });
  property("accepts chat without made-up timing, but requires timing for a window answer", idInput, async ({ id }) => {
    const ask = await sealed({ ...DRAFT, ask: id });
    const fact = { type: "answered", format: 1, ask: ask.ask, answer: { _tag: "rec" }, saw: ask.saw };
    expect(Schema.is(Fact)({ ...fact, via: { _tag: "chat", session: "session-1" } })).toBe(true);
    expect(Schema.is(Fact)({ ...fact, via: { _tag: "window" } })).toBe(false);
    expect(Schema.is(Fact)({ ...fact, via: { _tag: "window", took: { ...TOOK, ms: -1 } } })).toBe(false);
    expect(NOW).toBe(TOOK.said);
  });
});

describe("ask desk P1: an ask id is one word, whole", () => {
  describe.each([
    ["a space inside", "a b"],
    ["a space at the end", "a-1 "],
    ["129 characters", "x".repeat(129)],
  ])("%s", (_name, id) => {
    property("refuses invalid ask and replacement ids for any rec", recInput, async ({ sure }) => {
      const ask = await sealed({ ...DRAFT, rec: { ...REC, sure } });
      expect(Schema.is(Asked)({ ...ask, ask: id })).toBe(false);
      expect(Schema.is(Asked)({ ...ask, replaces: id })).toBe(false);
    });
  });
  property("keeps an id of 128 characters", recInput, async ({ sure }) => {
    const ask = await sealed({ ...DRAFT, rec: { ...REC, sure } });
    expect(Schema.is(Asked)({ ...ask, ask: "x".repeat(128) })).toBe(true);
  });
});

describe("ask desk P21: a replacement names the ask it replaces", () => {
  property("keeps replaces on the sealed fact, and leaves it out when the draft has none", idInput, async ({ id }) => {
    const replacing = await Effect.runPromise(seal({ ...DRAFT, replaces: id }));
    expect(replacing.replaces).toBe(id);
    expect(Object.hasOwn(await sealed(), "replaces")).toBe(false);
  });
});

describe("ask desk P1: any question as one line", () => {
  property(
    "joins every run of whitespace into one space",
    { space: Schema.String.check(Schema.isPattern(/^[ \t\n\r]+$/)) },
    ({ space }) => {
      expect(questionLine(`a${space}b${space}c`)).toBe("a b c");
      expect(questionLine("a\n  b\tc")).toBe("a b c");
      expect(questionLine("  Approve?  ")).toBe("Approve?");
    },
  );
  property(
    "keeps a line of 120 characters, and cuts a longer one at a word with an ellipsis",
    { letter: Schema.String.check(Schema.isPattern(/^[a-z]$/)) },
    ({ letter }) => {
      expect(questionLine(letter.repeat(120))).toBe(letter.repeat(120));
      expect(questionLine(letter.repeat(130))).toBe(`${letter.repeat(119)}…`);
      expect(questionLine("x".repeat(120))).toBe("x".repeat(120));
      const line = questionLine(`${"word ".repeat(30)}end`);
      expect(line.length).toBeLessThanOrEqual(120);
      expect(line.endsWith("word…")).toBe(true);
      expect(questionLine("x".repeat(130))).toBe(`${"x".repeat(119)}…`);
    },
  );
});
