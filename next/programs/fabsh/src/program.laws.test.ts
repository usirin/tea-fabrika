// fabsh in a tile, slice 1, next/: the program's laws L2 (its process half), L7 (its program half),
// L8 (fabsh's own draft check), L13 and L14 of the approved plan (docs/plan/lanes/fabsh-PLAN.md,
// "Laws"). Written before `program.ts` and `read.ts`, which the build creates; until it does, this
// file fails on its missing imports. Every step goes through the library's real `stepper`, the
// pure steps the runner calls, so a refusal is the program's own and a fold is the saved fold.
//
// The shape these laws hold `program.ts` to, from the plan's "fabsh, the program" (the build may add
// more):
// - `fabsh`: `Program.make({ name: "fabrika/fabsh", ..., draft: { schema: Draft, refuse } })`.
// - `fabshMachine`: its tea machine. Its one person input in slice 1 is `{type: "submitted", line}`.
// - `Draft`: `{text, cursor, n}`, what one draft frame carries.
// - `LINE_MOST`: the longest line, so that the letter `{type: "submitted", line}` of a line that long
//   fits one letter row (`INPUT_BYTES`).
// - The view is `{history, scroll, programs}`: `history` the submitted lines, newest last, at most
//   500; `scroll` the entries, newest last, at most 2,000, each `answered {line, says}` or `refused
//   {line, start, end, reason}`; `programs` what may be started (empty in slice 1).
// - `refuse`: a line holding a newline is `bad_line`, one longer than `LINE_MOST` is `too_long`.
// - A submitted line is decided by `read(line, {builtins, programs})`: a line with an unknown span is
//   a `refused` entry with that span; any other line runs. A valid `clear` empties the scrollback.
// `fabshWindow.refused(m, reason)` (`window.tsx`) says a refusal in words.
import { applyCell } from "@demlik/tea";
import { arbMsgSequence } from "@demlik/tea/pbt";
import { describe, expect, it } from "@effect/vitest";
import { stepper, type Step } from "@kampus/libfabrika";
import { INPUT_BYTES } from "@kampus/libfabrika/processes/Children";
import { Result, Schema } from "effect";
import * as fc from "fast-check";
import { Draft, fabsh, fabshMachine, LINE_MOST } from "./program.ts";
import { builtins, read } from "./read.ts";
import { fabshWindow } from "./window.tsx";

const SEED = 119120;

/** The plan's caps, from their makers' defaults: bash's `HISTSIZE` and tmux's `history-limit`. */
const HISTORY = 500;
const SCROLL = 2_000;

type Entry =
  | { readonly _tag: "answered"; readonly line: string; readonly says: ReadonlyArray<string> }
  | {
      readonly _tag: "refused";
      readonly line: string;
      readonly start: number;
      readonly end: number;
      readonly reason: string;
    };

type View = {
  readonly history: ReadonlyArray<string>;
  readonly scroll: ReadonlyArray<Entry>;
  readonly programs: ReadonlyArray<string>;
};

const steps = Result.getOrThrow(stepper(fabsh));

const decodeView = Schema.decodeUnknownSync(
  Schema.Struct({
    history: Schema.Array(Schema.String),
    scroll: Schema.Array(Schema.Unknown),
    programs: Schema.Array(Schema.String),
  }),
);

const shown = (step: Step): View => {
  expect(step._tag, "the step ran").toBe("stepped");
  return decodeView(step._tag === "stepped" ? step.view : null) as View;
};

const boot = () => steps.init(null);

const stepped = (step: Step) => (step._tag === "stepped" ? step : expect.fail(`refused ${JSON.stringify(step)}`));

const submit = (line: string) => ({ type: "submitted", line });

const known = (v: View) => ({ builtins: [...builtins], programs: [...v.programs] });

const word = fc.oneof(
  fc.constantFrom("help", "clear", "history", "as"),
  fc.constantFrom("counter", "notes", "fabrika/counter"),
  fc.stringMatching(/^[a-z][a-z0-9-]{0,10}(:[0-9]{1,3})?$/),
  fc.string({ unit: "grapheme", minLength: 1, maxLength: 12 }).filter((s) => !/\s/.test(s)),
);

/** L2's generator: 1 to 6 words drawn from built-ins, `as`, valid names and junk, joined by 1 to 3 spaces. */
const joined = fc
  .record({
    words: fc.array(word, { minLength: 1, maxLength: 6 }),
    gaps: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 6, maxLength: 6 }),
  })
  .map(({ words, gaps }) => words.map((w, i) => (i === 0 ? w : " ".repeat(gaps[i]!) + w)).join(""));

describe("L2, the process's half: the process refuses a line exactly when read gives it an unknown span", () => {
  it("L2: a submitted line with an unknown span is a refused entry holding that span; any other line runs (S1)", () => {
    const seen = { refused: 0, answered: 0, cleared: 0 };
    fc.assert(
      fc.property(fc.array(joined, { minLength: 1, maxLength: 20 }), (lines) => {
        let model = stepped(boot()).model;

        for (const line of lines) {
          const before = shown(steps.init(model));
          const r = read(line, known(before));
          const unknown = r.spans.find((s) => s.role === "unknown");
          const next = stepped(steps.step(model, submit(line)));
          const view = shown(next);
          model = next.model;

          if (unknown !== undefined) {
            seen.refused++;
            expect(view.scroll.at(-1), `${JSON.stringify(line)}'s entry`).toEqual({
              _tag: "refused",
              line,
              start: unknown.start,
              end: unknown.end,
              reason: unknown.reason,
            });
            continue;
          }

          if (line.split(" ")[0] === "clear") {
            seen.cleared++;
            expect(view.scroll, "a clear empties the scrollback").toEqual([]);
            continue;
          }

          seen.answered++;
          expect(view.scroll.at(-1), `${JSON.stringify(line)} ran`).toMatchObject({ _tag: "answered", line });
        }
      }),
      { seed: SEED, numRuns: 500 },
    );
    expect(seen.refused).toBeGreaterThan(0);
    expect(seen.answered).toBeGreaterThan(0);
    expect(seen.cleared).toBeGreaterThan(0);
  });
});

/** One move of L7's walk: a submitted letter, or a draft frame that reaches the step as if it were one. */
const mixed = fc.oneof(
  joined.map((line) => ({ type: "submitted" as const, line })),
  fc
    .record({ text: fc.string({ maxLength: 40 }), n: fc.nat({ max: 1000 }) })
    .map(({ text, n }) => ({ type: "draft" as const, text, cursor: text.length, n })),
);

describe("L7, the program's half: the saved fold does not depend on drafts", () => {
  it("L7: a draft is not a letter the machine takes, so folding only the saved letters gives the live model (0229)", () => {
    const seen = { drafts: 0 };
    fc.assert(
      fc.property(arbMsgSequence(mixed, { minLength: 1, maxLength: 30, size: "max" }), (list) => {
        let live = stepped(boot()).model;
        const saved: Array<unknown> = [];

        for (const m of list) {
          const step = steps.step(live, m);

          if (m.type === "draft") {
            seen.drafts++;
            expect(step, "a draft frame given as a letter is not a Msg of the program").toEqual({
              _tag: "refused",
              reason: "bad_msg",
            });
            continue;
          }

          live = stepped(step).model;
          saved.push(m);
        }

        let folded = stepped(boot()).model;

        for (const m of saved) {
          folded = stepped(steps.fold(folded, m)).model;
        }

        expect(folded, "the replayed fold is the live model").toEqual(live);
        expect(stepped(steps.init(live)).model, "a wake from the saved model is the same model").toEqual(live);
      }),
      { seed: SEED, numRuns: 300 },
    );
    expect(seen.drafts).toBeGreaterThan(0);
  });
});

describe("L8, fabsh's own draft check", () => {
  const draft = fabsh.draft!;
  const decode = Schema.decodeUnknownResult(draft.schema);
  const check = (m: unknown): "ok" | "bad_draft" | "refused" => {
    const decoded = decode(m);
    return Result.isFailure(decoded) ? "bad_draft" : draft.refuse(decoded.success) === null ? "ok" : "refused";
  };

  it("L8: a draft longer than one letter row, holding a newline, or with its cursor outside the text never passes; any other does", () => {
    const seen = { ok: 0, long: 0, newline: 0, cursor: 0 };
    fc.assert(
      fc.property(
        fc.record({
          size: fc.oneof(fc.nat({ max: 80 }), fc.constantFrom(LINE_MOST - 1, LINE_MOST, LINE_MOST + 1, 2 * LINE_MOST)),
          newline: fc.boolean(),
          shift: fc.integer({ min: -2, max: 2 }),
          at: fc.nat(),
          n: fc.nat({ max: 1_000_000 }),
        }),
        ({ size, newline, shift, at, n }) => {
          const body = "x".repeat(size);
          const text = newline && size > 0 ? `${body.slice(0, at % size)}\n${body.slice((at % size) + 1)}` : body;
          const cursor = shift < 0 ? shift : shift > 0 ? text.length + shift : at % (text.length + 1);
          const bad = text.length > LINE_MOST || text.includes("\n") || cursor < 0 || cursor > text.length;
          const result = check({ text, cursor, n });

          if (!bad) {
            seen.ok++;
            expect(result, `${text.length} characters, cursor ${cursor}`).toBe("ok");
            return;
          }

          seen.long += text.length > LINE_MOST ? 1 : 0;
          seen.newline += text.includes("\n") ? 1 : 0;
          seen.cursor += cursor < 0 || cursor > text.length ? 1 : 0;
          expect(result, `${text.length} characters, cursor ${cursor}, newline ${text.includes("\n")}`).not.toBe("ok");
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.ok).toBeGreaterThan(0);
    expect(seen.long).toBeGreaterThan(0);
    expect(seen.newline).toBeGreaterThan(0);
    expect(seen.cursor).toBeGreaterThan(0);
  });

  it("scenario: L8 the program declares its draft schema as the plan's Draft", () => {
    expect(fabsh.draft?.schema).toBe(Draft);
  });
});

describe("L13: a submitted line is the whole line as typed, taken from the letter", () => {
  it("L13: the entry and the history hold the letter's line exactly, spaces and all", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            joined,
            fc.string({ unit: "grapheme", maxLength: 200 }).filter((s) => !s.includes("\n") && s.trim() !== ""),
            joined.map((l) => `  ${l}  `),
          ),
          { minLength: 1, maxLength: 20 },
        ),
        (lines) => {
          let model = stepped(boot()).model;

          for (const line of lines) {
            const next = stepped(steps.step(model, submit(line)));
            model = next.model;
            const view = shown(next);
            expect(view.history.at(-1), "history keeps the line as typed").toBe(line);

            if (view.scroll.length > 0) {
              expect(view.scroll.at(-1)!.line, "the entry keeps the line as typed").toBe(line);
            }
          }
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
  });
});

/** Lines that always run and always add one entry: `help`, `help <word>` and `history`. */
const answered = fc.oneof(
  fc.constant("help"),
  fc.constant("history"),
  fc.stringMatching(/^[a-z]{1,8}$/).map((w) => `help ${w}`),
);

describe("L14: the caps hold", () => {
  it("L14: history keeps the newest 500 lines and the scrollback the newest 2,000 entries", () => {
    const seen = { history: 0, scroll: 0 };
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3_000 }).chain((size) => fc.array(answered, { minLength: size, maxLength: size })),
        (lines) => {
          // The machine's own update, as the runner's step calls it, so a long walk encodes its view once.
          let model = fabshMachine.init(null, {})[0];

          for (const line of lines) {
            model = applyCell(fabshMachine, model, submit(line) as never)[0];
          }

          const view = fabsh.view.select(model) as View;
          expect(view.history).toEqual(lines.slice(-HISTORY));
          expect(view.scroll.map((e) => e.line)).toEqual(lines.slice(-SCROLL));
          seen.history += lines.length > HISTORY ? 1 : 0;
          seen.scroll += lines.length > SCROLL ? 1 : 0;
        },
      ),
      { seed: SEED, numRuns: 30, examples: [[Array.from({ length: SCROLL + 1 }, () => "help")]] },
    );
    expect(seen.history, "some runs passed the history cap").toBeGreaterThan(0);
    expect(seen.scroll, "some runs passed the scrollback cap").toBeGreaterThan(0);
  });

  it("L14: a line longer than one letter row is refused too_long, with its reason in words, and the longest line's letter fits a row", () => {
    const encoder = new TextEncoder();
    expect(
      encoder.encode(JSON.stringify(submit("x".repeat(LINE_MOST)))).length,
      "the longest line's letter fits one letter row",
    ).toBeLessThanOrEqual(INPUT_BYTES);
    fc.assert(
      fc.property(fc.constantFrom(LINE_MOST - 1, LINE_MOST, LINE_MOST + 1, LINE_MOST + 7, 2 * LINE_MOST), (size) => {
        const line = `help ${"x".repeat(Math.max(0, size - 5))}`;
        const model = stepped(boot()).model;
        const step = steps.step(model, submit(line));

        if (line.length <= LINE_MOST) {
          expect(step._tag, `${line.length} characters fit`).toBe("stepped");
          return;
        }

        expect(step).toEqual({ _tag: "refused", reason: "too_long" });
        const said = fabshWindow.refused!(submit(line) as never, "too_long");
        expect(said.length, "the reason is shown in words").toBeGreaterThan(0);
        expect(said.includes(line.slice(0, 40)), "the words never echo the line").toBe(false);
      }),
      { seed: SEED, numRuns: 20 },
    );
  });

  it("L14: a line holding a newline is refused bad_line", () => {
    fc.assert(
      fc.property(joined, joined, (a, b) => {
        expect(steps.step(stepped(boot()).model, submit(`${a}\n${b}`))).toEqual({
          _tag: "refused",
          reason: "bad_line",
        });
      }),
      { seed: SEED, numRuns: 50 },
    );
  });

  it("scenario: L14 the program is fabrika/fabsh on its own machine", () => {
    expect(fabsh.machine).toBe(fabshMachine);
    expect(fabsh.name).toBe("fabrika/fabsh");
  });
});
