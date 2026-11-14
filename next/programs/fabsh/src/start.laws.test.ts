// fabsh slice 2a, next/: the program's start laws L20, L22 and L23 (without its `show` part) of the
// approved plan (docs/plan/lanes/fabsh-PLAN.md, "Laws", and amendment A6). Written before slice 2a's
// build; until it lands, each law fails on the behavior it names: fabsh asks no `programs`, so it
// knows no program, and a program line starts nothing. Every step goes through the library's real
// `stepper`, the pure steps the runner calls: a submitted line is a fresh letter (`step`), and a
// Cmd's answer is a saved letter the runner wrote (`fold`), as the runner folds it.
//
// The shape these laws hold slice 2a to, from the plan's "Slice 2: the start, the desk and 953":
// - fabsh's machine declares `start_child` (`@kampus/libfabrika/runtime/StartChild`) and the runner
//   built-in `programs` (`@kampus/libfabrika/runtime/Programs`). Its `programs_ok` answer's `value`
//   is the names it can start, an array of strings; fabsh keeps it as the view's `programs`, and
//   `read` reads it. When fabsh asks is not pinned here: the plan says at init, but the stepper drops
//   `init`'s Cmds (`runtime/Program.ts`, `init`), so the build picks the step; L28 checks on a real
//   instance that fabsh knows the table before a person's first line.
// - A submitted line that `read` takes as a run returns one `{type: "start_child", program, name}`
//   in that submitted step, and no other step returns a `start_child` (L20).
// - A bare word is the one program in `programs` whose last part it is, a whole `pack/program`
//   always resolves, two matches start nothing (`ambiguous`), no `as` names `<last part>:1`, and a
//   name after `as` must be a ProcessName (L22).
// - Each answer settles its start's scrollback entry once: `started {line, process, name, fresh}`
//   for `started` (fresh) and `already_started`, and `failed {line, reason}` for `already_present`
//   and each `StartRefusal`. A start that waits is not an outcome, and the same answer folded again
//   adds nothing (L23). The window says each outcome in words in the scrollback.
// - The runner's answers have its shape (`runtime/Runner.ts`, `ok` and `err`): `{type:
//   "start_child_ok", cmd: {type, program, name}, value, at}`, and `{type: "start_child_err", cmd:
//   {type}, error: {_tag: reason}, reason, at}`, whose echo names no start.
import { describe, expect, it } from "@effect/vitest";
import { stepper, type Step } from "@kampus/libfabrika";
import { ProcessName } from "@kampus/libfabrika/processes/Process";
import { StartRefusal } from "@kampus/libfabrika/runtime/StartChild";
import { Result, Schema } from "effect";
import * as fc from "fast-check";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fabsh } from "./program.ts";
import { builtins, read } from "./read.ts";
import { tile } from "./tile.ts";
import { fabshWindow } from "./window.tsx";

const SEED = 119120;

const steps = Result.getOrThrow(stepper(fabsh));

type Entry = { readonly _tag: string; readonly line: string } & Readonly<Record<string, unknown>>;

type View = {
  readonly history: ReadonlyArray<string>;
  readonly scroll: ReadonlyArray<Entry>;
  readonly programs: ReadonlyArray<string>;
};

type Cmd = { readonly type: string } & Readonly<Record<string, unknown>>;

const stepped = (step: Step) => (step._tag === "stepped" ? step : expect.fail(`refused ${JSON.stringify(step)}`));
const viewed = (step: Step) => stepped(step).view as View;
const sentBy = (step: Step) => stepped(step).cmds as ReadonlyArray<Cmd>;
const starts = (step: Step) => sentBy(step).filter((c) => c.type === "start_child");

const submit = (line: string) => ({ type: "submitted", line });

/** The runner's answers, in the shape `runtime/Runner.ts` writes them. */
const programsOk = (names: ReadonlyArray<string>, at = 1) => ({
  type: "programs_ok",
  cmd: { type: "programs" },
  value: [...names],
  at,
});

const startOk = (cmd: Cmd, value: unknown, at = 1) => ({
  type: "start_child_ok",
  cmd: { type: "start_child", program: cmd["program"], name: cmd["name"] },
  value,
  at,
});

const startErr = (reason: string, at = 1) => ({
  type: "start_child_err",
  cmd: { type: "start_child" },
  error: { _tag: reason },
  reason,
  at,
});

/** fabsh booted and told `table` by the runner's programs answer: the model a person's line meets.
 *  When fabsh asks is the build's (see the header); the answer is folded as the runner folds it. */
const told = (table: ReadonlyArray<string>) => {
  const boot = steps.init(null);
  const next = stepped(steps.fold(stepped(boot).model, programsOk(table)));
  expect(viewed(next).programs, "fabsh keeps the names it was told").toEqual([...table]);
  return next.model;
};

/** Packs and program words, so a bare word sometimes names two programs. No word is a built-in. */
const POOL = [
  "fabrika/counter",
  "p42/counter",
  "fabrika/notes",
  "p42/notes2",
  "fabrika/checklist",
  "p42/child",
  "fabrika/fabsh",
] as const;

const last = (program: string) => program.slice(program.lastIndexOf("/") + 1);
const isName = Schema.is(ProcessName);

const Table = fc.subarray([...POOL], { minLength: 0, maxLength: 6 });

/** A word in the program's place: a whole name, a last part, or a word no program has. */
const Word = fc.oneof(
  fc.constantFrom(...POOL),
  fc.constantFrom(...POOL.map(last)),
  fc.constantFrom("counterx", "p43/counter", "notes3"),
);

/** A word in the name's place: a ProcessName or one that is not. */
const Named = fc.oneof(
  fc.stringMatching(/^[a-z0-9][a-z0-9._:-]{0,12}$/),
  fc.constantFrom("Notes", "-x", "a/b", "gateway", "client:x", "_x"),
);

/** A program line: a word alone, `<word> as <name>`, `<word> as`, or a word with something else after it. */
const ProgramLine = fc.oneof(
  Word,
  fc.tuple(Word, Named).map(([w, n]) => `${w} as ${n}`),
  Word.map((w) => `${w} as`),
  fc.tuple(Word, Named).map(([w, n]) => `${w} ${n}`),
  fc.tuple(Word, Named, Named).map(([w, n, m]) => `${w} as ${n} ${m}`),
);

/** What the plan says a line starts, worked out here without fabsh's reader: a start or nothing. */
const expected = (line: string, table: ReadonlyArray<string>): { program: string; name: string } | null => {
  const words = line.trim().split(/\s+/);
  const [first, keyword, name, extra] = words;

  if (first === undefined || builtins.includes(first)) {
    return null;
  }

  const found = table.includes(first) ? [first] : table.filter((p) => last(p) === first);
  const program = found.length === 1 ? found[0] : undefined;

  if (program === undefined) {
    return null;
  }

  if (keyword === undefined) {
    return { program, name: `${last(program)}:1` };
  }

  return keyword === "as" && name !== undefined && extra === undefined && isName(name) ? { program, name } : null;
};

const processAt = (n: number) => `process_0000000000e008${n.toString(16).padStart(12, "0")}`;

/** One answer a start may get: each of `Started`'s three, and each refusal. */
const OUTCOMES = ["started", "already_started", "already_present", ...StartRefusal.literals] as const;
type Outcome = (typeof OUTCOMES)[number];

const answer = (outcome: Outcome, cmd: Cmd, process: string, at: number) =>
  outcome === "started"
    ? startOk(cmd, { _tag: "started", process, name: cmd["name"], rev: at }, at)
    : outcome === "already_started" || outcome === "already_present"
      ? startOk(cmd, { _tag: outcome, process, name: cmd["name"] }, at)
      : startErr(outcome, at);

/** One move of L20's walk. The fold reads its `pick` against the state it reached: a line, an answer
 *  to a start that is really waiting, or the runner's programs answer with a new table. */
const Move = fc.record({
  pick: fc.nat({ max: 1_000 }),
  line: fc.oneof(ProgramLine, fc.constantFrom("help", "history", "clear")),
  outcome: fc.constantFrom(...OUTCOMES),
  table: Table,
});

describe("L20: a start comes from the submitted step", () => {
  it("L20: for any walk of lines and answers, only a submitted line's own step returns start_child, so its parent is the member's input", () => {
    const seen = { starts: 0, programs: 0, answers: 0 };
    fc.assert(
      fc.property(Table, fc.array(Move, { minLength: 1, maxLength: 40, size: "max" }), (table, moves) => {
        let model = told(table);
        const waiting: Array<Cmd> = [];

        for (const move of moves) {
          const kind = move.pick % 3;

          if (kind === 0 || (kind === 1 && waiting.length === 0)) {
            const known = viewed(steps.init(model)).programs;
            const step = steps.step(model, submit(move.line));
            const begun = starts(step);
            const want = expected(move.line, known);
            seen.starts += begun.length;
            expect(
              begun.map((c) => c["program"]),
              `${JSON.stringify(move.line)} over ${JSON.stringify(known)}`,
            ).toEqual(want === null ? [] : [want.program]);

            if (begun.length > 0) {
              const r = read(move.line, { builtins: [...builtins], programs: [...known] });
              expect(
                r.spans.some((s) => s.role === "unknown"),
                "a start comes only from a line read takes",
              ).toBe(false);
            }

            waiting.push(...begun);
            model = stepped(step).model;
            continue;
          }

          const reply =
            kind === 1
              ? answer(move.outcome, waiting.splice(move.pick % waiting.length, 1)[0]!, processAt(move.pick), move.pick)
              : programsOk(move.table, move.pick);
          seen[kind === 1 ? "answers" : "programs"]++;
          const step = steps.fold(model, reply);
          expect(starts(step), `the ${reply.type} step returned a start`).toEqual([]);
          model = stepped(step).model;
        }
      }),
      { seed: SEED, numRuns: 200 },
    );
    expect(seen.starts, "some lines started a program").toBeGreaterThan(0);
    expect(seen.programs, "some programs answers were folded").toBeGreaterThan(0);
    expect(seen.answers, "some start answers were folded").toBeGreaterThan(0);
  });
});

describe("L22: words to a start", () => {
  it("L22: a bare word is the one program whose last part matches, pack/program always resolves, two matches start nothing, no as names <program>:1, and as needs a ProcessName", () => {
    const seen = { bare: 0, whole: 0, named: 0, ambiguous: 0, bad: 0 };
    fc.assert(
      fc.property(Table, fc.array(ProgramLine, { minLength: 1, maxLength: 8 }), (table, lines) => {
        let model = told(table);

        for (const line of lines) {
          const step = steps.step(model, submit(line));
          const want = expected(line, table);
          const begun = starts(step).map((c) => ({ program: c["program"], name: c["name"] }));
          expect(begun, `${JSON.stringify(line)} over ${JSON.stringify(table)}`).toEqual(want === null ? [] : [want]);
          const [first = "", keyword, name] = line.trim().split(/\s+/);
          const matches = table.includes(first) ? 1 : table.filter((p) => last(p) === first).length;
          seen.ambiguous += matches > 1 ? 1 : 0;
          seen.bad += matches === 1 && keyword === "as" && name !== undefined && !isName(name) ? 1 : 0;

          if (want !== null) {
            seen[keyword === undefined ? (first.includes("/") ? "whole" : "bare") : "named"]++;
          }

          model = stepped(step).model;
        }
      }),
      { seed: SEED, numRuns: 300 },
    );

    for (const [reached, n] of Object.entries(seen)) {
      expect(n, `the walk reached ${reached}`).toBeGreaterThan(0);
    }
  });
});

const render = (view: View) =>
  renderToStaticMarkup(
    createElement(fabshWindow.View, {
      data: view as never,
      refusal: null,
      press: () => {
        throw new Error("render pressed");
      },
      tile: tile.init(null, {})[0],
      send: () => {
        throw new Error("render sent");
      },
    }),
  );

const unescape = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/** What the window says of `entry` in words, beside its line: the page's text with the line taken out. */
const words = (view: View, entry: Entry): string =>
  unescape(render({ ...view, scroll: [entry] }).replace(/<[^>]*>/g, " "))
    .replaceAll(entry.line, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("L23: every start answer reaches the scrollback once", () => {
  it("L23: each answer settles its own start once, started and already_started name the process, already_present and each refusal give their reason, and a resend adds nothing", () => {
    const seen = new Set<string>();
    const said = new Map<string, Set<string>>();
    fc.assert(
      fc.property(
        fc.array(fc.record({ outcome: fc.constantFrom(...OUTCOMES), n: fc.nat({ max: 1_000 }), again: fc.nat(2) }), {
          minLength: 1,
          maxLength: 4,
        }),
        (cells) => {
          let model = told([...POOL]);
          const asked: Array<{ line: string; cmd: Cmd }> = [];

          for (const [i, _cell] of cells.entries()) {
            const line = `fabrika/counter as s${i}`;
            const step = steps.step(model, submit(line));
            const [cmd] = starts(step);
            expect(cmd, `${line} starts a program`).toBeDefined();
            asked.push({ line, cmd: cmd! });
            model = stepped(step).model;
          }

          // The runner answers its Cmds in the order they were sent; each answer may come again.
          for (const [i, cell] of cells.entries()) {
            const { line, cmd } = asked[i]!;
            const process = processAt(cell.n);
            const reply = answer(cell.outcome, cmd, process, i + 2);
            model = stepped(steps.fold(model, reply)).model;
            const view = viewed(steps.init(model));
            const mine = view.scroll.filter((e) => e.line === line);
            const fresh = cell.outcome === "started";
            const shows = fresh || cell.outcome === "already_started";
            expect(mine, `${line}, answered ${cell.outcome}, has one entry`).toHaveLength(1);
            expect(mine[0], `${line}, answered ${cell.outcome}`).toEqual(
              shows
                ? { _tag: "started", line, process, name: cmd["name"], fresh }
                : { _tag: "failed", line, reason: cell.outcome },
            );
            seen.add(cell.outcome);
            const text = words(view, mine[0]!);

            if (shows) {
              expect(text, "the scrollback names the process").toContain(String(cmd["name"]));
            } else {
              expect(text.split(" ").length, `${cell.outcome} is said in words`).toBeGreaterThanOrEqual(3);
              said.set(
                cell.outcome,
                (said.get(cell.outcome) ?? new Set()).add(text.replaceAll(String(cmd["name"]), "")),
              );
            }

            // A refusal's answer names no start, so a resend is tried only when no other start waits.
            const resend = shows || cell.outcome === "already_present" || i === cells.length - 1;

            for (let k = 0; k < (resend ? cell.again : 0); k++) {
              const again = stepped(steps.fold(model, reply));
              expect(again.model, `the same ${cell.outcome} answer again adds nothing`).toEqual(model);
              expect(starts(again), "a resend starts nothing").toEqual([]);
            }
          }
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
    expect([...seen].sort(), "every outcome was answered").toEqual([...OUTCOMES].sort());
    const reasons = [...said.entries()].map(([outcome, texts]) => [outcome, [...texts][0]] as const);
    expect(new Set(reasons.map(([, text]) => text)).size, "each reason is said in its own words").toBe(reasons.length);
  });
});
