// fabsh's line reader, next/: S1 of the summon guidelines, one grammar every view reads. `read`
// turns a line into spans with roles; the process decides with it, and the tile colors, Tab and the
// error mark read the same spans, never a regex of their own. Pure: no clock, no service.
//
//   line      blank | builtin | run
//   builtin   'help' [word] | 'clear' | 'history'
//   run       program ['as' name]      program: one known program, by its last part or whole name
import { ProcessName } from "@kampus/libfabrika/processes/Process";
import { Schema } from "effect";

/** A span's role, S1's names: the subset this grammar needs. */
export const Role = Schema.Literals(["verb", "keyword", "name-new", "word", "unknown"]);
export type Role = typeof Role.Type;

/** Why the reader refused a line, on its one `unknown` span. */
export const Reason = Schema.Literals(["no_word", "extra", "no_name", "bad_name", "ambiguous"]);
export type Reason = typeof Reason.Type;

/** One run of a line's characters, `start` to `end` in string indices. Only `unknown` has a reason. */
export const Span = Schema.Struct({
  start: Schema.Int,
  end: Schema.Int,
  role: Role,
  reason: Schema.optionalKey(Reason),
});
export type Span = typeof Span.Type;

/** What the reader knows: the built-in words, and the programs that may be started. */
export type Known = { readonly builtins: ReadonlyArray<string>; readonly programs: ReadonlyArray<string> };

/** The line being typed, as a draft frame carries it. */
type Line = { readonly text: string; readonly cursor: number; readonly n: number };

/** The built-in words of this slice. */
export const builtins: ReadonlyArray<string> = ["help", "clear", "history"];

/** How many words each built-in takes after itself, at most. */
const TAKES: Readonly<Record<string, number>> = { help: 1, clear: 0, history: 0 };

const isName = Schema.is(ProcessName);

type Word = { readonly start: number; readonly end: number; readonly text: string };

const words = (line: string): ReadonlyArray<Word> =>
  [...line.matchAll(/\S+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));

/** A program's last part: `counter` of `fabrika/counter`. */
const last = (program: string): string => program.slice(program.lastIndexOf("/") + 1);

/** The programs a verb word names: its whole name, else every program whose last part it is. */
const named = (word: string, programs: ReadonlyArray<string>): ReadonlyArray<string> =>
  programs.includes(word) ? [word] : programs.filter((p) => last(p) === word);

type Reading = { readonly spans: ReadonlyArray<Span>; readonly expects: ReadonlyArray<Role> };

/**
 * Reads one line. The spans are in order, inside the line, never share a character, and cover
 * every word; a line the grammar refuses has exactly one `unknown` span, at the first word that
 * breaks it, and the words after it are plain `word`s. `expects` is what the grammar takes next,
 * after the whole line: nothing once it has refused.
 */
export const read = (line: string, known: Known): Reading => {
  const ws = words(line);
  const spans: Array<Span> = [];
  const span = (w: Word, role: Role): Span => ({ start: w.start, end: w.end, role });
  const refused = (at: Word, reason: Reason): Reading => ({
    spans: [
      ...spans,
      { start: at.start, end: at.end, role: "unknown", reason },
      ...ws.filter((w) => w.start > at.start).map((w) => span(w, "word")),
    ],
    expects: [],
  });
  const first = ws[0];

  if (first === undefined) {
    return { spans, expects: ["verb"] };
  }

  if (known.builtins.includes(first.text)) {
    const takes = TAKES[first.text] ?? 0;
    spans.push(span(first, "verb"));

    for (const [i, w] of ws.entries()) {
      if (i > takes) {
        return refused(w, "extra");
      }

      if (i > 0) {
        spans.push(span(w, "word"));
      }
    }

    return { spans, expects: ws.length - 1 < takes ? ["word"] : [] };
  }

  const programs = named(first.text, known.programs);

  if (programs.length !== 1) {
    return refused(first, programs.length === 0 ? "no_word" : "ambiguous");
  }

  spans.push(span(first, "verb"));
  const as = ws[1];

  if (as === undefined) {
    return { spans, expects: ["keyword"] };
  }

  if (as.text !== "as") {
    return refused(as, "extra");
  }

  spans.push(span(as, "keyword"));
  const name = ws[2];

  // A line that ends at `as` is not refused yet: the grammar takes it so far, and waits for a name.
  if (name === undefined) {
    return { spans, expects: ["name-new"] };
  }

  if (!isName(name.text)) {
    return refused(name, "bad_name");
  }

  spans.push(span(name, "name-new"));
  const extra = ws[3];
  return extra === undefined ? { spans, expects: [] } : refused(extra, "extra");
};

/** The words a role takes from what the reader knows: a verb is a built-in or a program, `as` a keyword. */
const candidates = (roles: ReadonlyArray<Role>, known: Known): ReadonlyArray<string> => [
  ...new Set([
    ...(roles.includes("verb") ? [...known.builtins, ...known.programs, ...known.programs.map(last)] : []),
    ...(roles.includes("keyword") ? ["as"] : []),
  ]),
];

const shared = (all: ReadonlyArray<string>): string =>
  all.reduce((p, w) => {
    let i = 0;

    while (i < p.length && i < w.length && p[i] === w[i]) {
      i++;
    }

    return p.slice(0, i);
  });

/**
 * Tab: the word before the cursor, completed from what `read` expects there, to the longest prefix
 * its candidates share. One candidate takes a space after it, as bash and fish add, unless one is
 * there. `null` when nothing would change.
 */
export const complete = (draft: Line, known: Known): Line | null => {
  const start = draft.text.lastIndexOf(" ", draft.cursor - 1) + 1;
  const prefix = draft.text.slice(start, draft.cursor);
  const rest = draft.text.slice(draft.cursor);
  const before = draft.text.slice(0, start);
  const matching = candidates(read(before, known).expects, known).filter((w) => w.startsWith(prefix));

  if (matching.length === 0) {
    return null;
  }

  const extended = shared(matching);

  if (extended.length <= prefix.length) {
    return null;
  }

  const space = matching.length === 1 && !rest.startsWith(" ") ? " " : "";
  const text = `${before}${extended}${space}${rest}`;
  return { text, cursor: start + extended.length + space.length, n: draft.n };
};

/**
 * Up and Down over the submitted lines, newest last. Back from a line not in the history is its
 * newest line; forward from the newest is an empty line. The tile predicts with it.
 */
export const recall = (draft: Line, history: ReadonlyArray<string>, to: "back" | "forward"): Line => {
  const at = history.lastIndexOf(draft.text);
  const index = to === "back" ? (at === -1 ? history.length - 1 : at - 1) : at === -1 ? -2 : at + 1;

  if (index === -2 || (to === "back" && index < 0)) {
    return draft;
  }

  const text = history[index] ?? "";
  return text === draft.text ? draft : { text, cursor: text.length, n: draft.n };
};
