// fabsh in a tile, slice 1, next/: the line reader's laws L1, L2 (its reader half) and L15 of the
// approved plan (docs/plan/lanes/fabsh-PLAN.md, "Laws"), S1 of the summon guidelines. Written before
// `read.ts`, which the build creates; until it does, this file fails on its missing import.
//
// The shape these laws hold `read.ts` to, from the plan's "The reader" (the build may add more):
// - `read(line, known)`, pure: `{ spans, expects }`. A span is `{start, end, role, reason?}` over the
//   line's string indices, `role` one of `verb`, `keyword`, `name-new`, `word`, `unknown`, and only an
//   `unknown` span carries a `reason` (`no_word`, `extra`, `no_name`, `bad_name`, `ambiguous`).
//   `expects` is the roles the grammar takes next, after the whole line.
// - `complete(draft, known)`, pure: Tab. The word at the cursor, completed from what `read` expects
//   there, or `null` when nothing changes.
// - `builtins`: the built-in words the reader knows. Slice 1 has `help`, `clear` and `history`.
// - `Known` is `{builtins, programs}`; a program word is a program's last part or its whole name.
//
// S1's law, which L1 and L2 carry: every character sits in at most one span, and a refused line has
// exactly one `unknown` span, at its refusal.
import { describe, expect, it } from "@effect/vitest";
import * as fc from "fast-check";
import { builtins, complete, read } from "./read.ts";

const SEED = 119120;

/** The slice 1 built-ins, as the plan's grammar lists them. */
const SLICE_1 = ["help", "clear", "history"] as const;

/** Program names over two packs, so a bare word can match one, two or none (slice 2 reads them). */
const PROGRAMS = ["fabrika/counter", "fabrika/checklist", "other/counter", "other/notes"] as const;

const known = fc.record({
  builtins: fc.constant([...builtins]),
  programs: fc.subarray([...PROGRAMS]),
});

/** A word a line is made of: a built-in, `as`, a program word, a name, or junk. */
const word = fc.oneof(
  fc.constantFrom(...SLICE_1),
  fc.constant("as"),
  fc.constantFrom("counter", "notes", "fabrika/counter", "other/notes", "checklist"),
  fc.stringMatching(/^[a-z][a-z0-9-]{0,10}(:[0-9]{1,3})?$/),
  fc.string({ unit: "grapheme", minLength: 1, maxLength: 12 }).filter((s) => !/\s/.test(s)),
);

/** A run of spaces between words, one to three long. */
const gap = fc.integer({ min: 1, max: 3 }).map((n) => " ".repeat(n));

/** A line of words and runs of spaces, sometimes with spaces before or after. */
const wordy = fc
  .record({
    words: fc.array(word, { minLength: 0, maxLength: 8 }),
    gaps: fc.array(gap, { minLength: 9, maxLength: 9 }),
    lead: fc.constantFrom("", " ", "   "),
    tail: fc.constantFrom("", " ", "  "),
  })
  .map(({ words, gaps, lead, tail }) => lead + words.map((w, i) => (i === 0 ? w : gaps[i]! + w)).join("") + tail);

/** L1's generator: graphemes up to 300, mixed with built-in words, `as` and runs of spaces. */
const lines = fc.oneof(
  wordy,
  fc.string({ unit: "grapheme", maxLength: 300 }),
  fc
    .array(fc.oneof(word, gap, fc.string({ unit: "grapheme", maxLength: 20 })), { maxLength: 30 })
    .map((p) => p.join("")),
);

const isSpace = (c: string) => /\s/.test(c);

describe("L1: read's spans sit in the line, in order, never overlap, and cover every non-space character", () => {
  it("L1: for any line and any known lists, the spans are sorted, inside the line, disjoint, and cover every non-space character (S1)", () => {
    const seen = { spans: 0, unknown: 0, blank: 0 };
    fc.assert(
      fc.property(lines, known, (line, k) => {
        const { spans } = read(line, k);
        let at = 0;

        for (const s of spans) {
          expect(Number.isInteger(s.start) && Number.isInteger(s.end), "a span's ends are whole indices").toBe(true);
          expect(s.start, "a span starts inside the line, after the one before it ends").toBeGreaterThanOrEqual(at);
          expect(s.end, "a span holds at least one character").toBeGreaterThan(s.start);
          expect(s.end, "a span ends inside the line").toBeLessThanOrEqual(line.length);
          at = s.end;
        }

        for (let i = 0; i < line.length; i++) {
          const covered = spans.some((s) => s.start <= i && i < s.end);
          expect(covered || isSpace(line[i]!), `character ${i} of ${JSON.stringify(line)} is in no span`).toBe(true);
        }

        const unknown = spans.filter((s) => s.role === "unknown");
        expect(unknown.length, "S1: a line has at most one unknown span").toBeLessThanOrEqual(1);
        expect(
          spans.every((s) => (s.role === "unknown") === (s.reason !== undefined)),
          "only an unknown span carries a reason, and every unknown span does",
        ).toBe(true);
        seen.spans += spans.length;
        seen.unknown += unknown.length;
        seen.blank += line.trim() === "" ? 1 : 0;
      }),
      { seed: SEED, numRuns: 1000 },
    );
    expect(seen.spans).toBeGreaterThan(0);
    expect(seen.unknown, "some lines were refused").toBeGreaterThan(0);
    expect(seen.blank, "some lines were blank").toBeGreaterThan(0);
  });

  it("L1: read is pure: the same line and lists give the same spans and expects", () => {
    fc.assert(
      fc.property(lines, known, (line, k) => {
        expect(read(line, k)).toEqual(read(line, { builtins: [...k.builtins], programs: [...k.programs] }));
      }),
      { seed: SEED, numRuns: 300 },
    );
  });
});

/** L2's generator: 1 to 6 words drawn from built-ins, `as`, valid names and junk, joined by 1 to 3 spaces. */
const joined = fc
  .record({
    words: fc.array(word, { minLength: 1, maxLength: 6 }),
    gaps: fc.array(gap, { minLength: 6, maxLength: 6 }),
  })
  .map(({ words, gaps }) => words.map((w, i) => (i === 0 ? w : gaps[i]! + w)).join(""));

describe("L2, the reader's half: a line is refused by its one unknown span", () => {
  it("L2: the built-ins slice 1 has are verbs, alone and with their words", () => {
    expect([...builtins].sort(), "slice 1's built-ins").toEqual(expect.arrayContaining([...SLICE_1].sort()));
    fc.assert(
      fc.property(fc.constantFrom(...SLICE_1), known, gap, (verb, k, space) => {
        const alone = read(verb, k);
        expect(alone.spans).toEqual([{ start: 0, end: verb.length, role: "verb" }]);
        const padded = read(`${space}${verb}${space}`, k);
        expect(padded.spans).toEqual([{ start: space.length, end: space.length + verb.length, role: "verb" }]);
      }),
      { seed: SEED, numRuns: 100 },
    );
  });

  it("L2: a word that is no built-in and no program starts a refused line, marked no_word over that word", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9]{0,10}$/).filter((w) => !SLICE_1.includes(w as never) && w !== "as"),
        known,
        (junk, k) => {
          const named = k.programs.some((p) => p === junk || p.split("/").at(-1) === junk);
          fc.pre(!named && !builtins.includes(junk));
          expect(read(junk, k).spans).toEqual([{ start: 0, end: junk.length, role: "unknown", reason: "no_word" }]);
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
  });

  it("L2: in any joined line, the first word that breaks the grammar is the one unknown span, and no span before it is unknown", () => {
    const seen = { refused: 0, run: 0 };
    fc.assert(
      fc.property(joined, known, (line, k) => {
        const { spans } = read(line, k);
        const unknown = spans.filter((s) => s.role === "unknown");
        expect(unknown.length).toBeLessThanOrEqual(1);

        if (unknown.length === 0) {
          seen.run++;
          expect(spans.length, "a line that runs has a span per word").toBe(line.split(/ +/).length);
          return;
        }

        seen.refused++;
        const u = unknown[0]!;
        // The words before the refusal read on their own as a line the grammar takes so far.
        const before = read(line.slice(0, u.start), k);
        expect(
          before.spans.some((s) => s.role === "unknown"),
          "the refusal is the first place the line breaks",
        ).toBe(false);
      }),
      { seed: SEED, numRuns: 500 },
    );
    expect(seen.refused).toBeGreaterThan(0);
    expect(seen.run).toBeGreaterThan(0);
  });
});

/** The words a role takes from the known lists: verbs are built-ins and program words, a keyword is `as`. */
const candidates = (
  roles: ReadonlyArray<string>,
  k: { builtins: ReadonlyArray<string>; programs: ReadonlyArray<string> },
) => [
  ...new Set([
    ...(roles.includes("verb") ? [...k.builtins, ...k.programs, ...k.programs.map((p) => p.split("/").at(-1)!)] : []),
    ...(roles.includes("keyword") ? ["as"] : []),
  ]),
];

const commonPrefix = (words: ReadonlyArray<string>): string =>
  words.reduce((p, w) => {
    let i = 0;

    while (i < p.length && i < w.length && p[i] === w[i]) {
      i++;
    }

    return p.slice(0, i);
  });

/** L15's generator: a line, a cursor at a word's end or after a space, and known lists. */
const tabbed = fc
  .record({
    line: fc.oneof(
      wordy,
      fc.constantFrom("h", "he", "hi", "c", "cl", "his", "help c", "help h", "co", "counter a", "counter as n", ""),
    ),
    pick: fc.nat(),
    n: fc.nat({ max: 1000 }),
  })
  .map(({ line, pick, n }) => {
    // A cursor at the end of a word, or at a space: never inside a word, so the rest after it is unambiguous.
    const ends = [...line.matchAll(/\S+/g)].map((m) => m.index + m[0].length);
    const spaces = [...line.matchAll(/ /g)].map((m) => m.index);
    const stops = [...new Set([...ends, ...spaces, line.length])];
    return { text: line, cursor: stops[pick % stops.length]!, n };
  });

describe("L15: Tab completes only a word read expects at the cursor", () => {
  it("L15: Tab extends the word at the cursor to the longest prefix its expected candidates share, and changes nothing when there is none", () => {
    const seen = { completed: 0, none: 0, unique: 0 };
    fc.assert(
      fc.property(tabbed, known, (draft, k) => {
        const start = draft.text.lastIndexOf(" ", draft.cursor - 1) + 1;
        const prefix = draft.text.slice(start, draft.cursor);
        const rest = draft.text.slice(draft.cursor);
        const expects = read(draft.text.slice(0, start), k).expects;
        const matching = candidates(expects, k).filter((w) => w.startsWith(prefix));
        const extended = matching.length === 0 ? prefix : commonPrefix(matching);
        const result = complete(draft, k);

        if (extended.length <= prefix.length) {
          seen.none++;
          expect(result, `Tab changed ${JSON.stringify(draft)} with nothing to complete`).toBeNull();
          return;
        }

        seen.completed++;
        // A single candidate may take one space after it, as bash and fish add, unless one is there.
        const unique = matching.length === 1 && extended === matching[0] && !rest.startsWith(" ");
        seen.unique += unique ? 1 : 0;
        const plain = draft.text.slice(0, start) + extended + rest;
        const spaced = `${draft.text.slice(0, start) + extended} ${rest}`;
        expect(result, "Tab completed nothing although candidates share a longer prefix").not.toBeNull();
        expect(unique ? [plain, spaced] : [plain], "Tab's line").toContain(result!.text);
        expect(result!.cursor, "the cursor sits after what Tab wrote").toBe(
          start + extended.length + (result!.text === spaced && unique ? 1 : 0),
        );
      }),
      {
        seed: SEED,
        numRuns: 300,
        // pinned: the plan's traced value, `hlep` fixed and Tab on `he`, and a word with two candidates.
        examples: [
          [
            { text: "he", cursor: 2, n: 1 },
            { builtins: [...builtins], programs: [] },
          ],
          [
            { text: "h", cursor: 1, n: 1 },
            { builtins: [...builtins], programs: [] },
          ],
        ],
      },
    );
    expect(seen.completed).toBeGreaterThan(0);
    expect(seen.none).toBeGreaterThan(0);
    expect(seen.unique).toBeGreaterThan(0);
  });

  it("L15: Tab never completes a word to one its role does not take: a word after a built-in that takes none stays", () => {
    fc.assert(
      fc.property(fc.constantFrom("clear", "history"), gap, fc.constantFrom("h", "c", "he"), (verb, space, typed) => {
        const text = `${verb}${space}${typed}`;
        const k = { builtins: [...builtins], programs: [] };
        const expects = read(`${verb}${space}`, k).expects;
        expect(expects, `${verb} takes no further word`).toEqual([]);
        expect(complete({ text, cursor: text.length, n: 1 }, k)).toBeNull();
      }),
      { seed: SEED, numRuns: 50 },
    );
  });
});
