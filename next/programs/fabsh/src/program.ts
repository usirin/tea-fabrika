// fabsh, next/: the shell as a regular program (0275, 0432). A submitted line is the one letter a
// person sends, and the only thing that decides: the process reads it again with `read` and folds
// its answer into the scrollback. The line being typed rides the ephemeral lane as a draft, which
// the runner checks with `draft` and never saves, so the saved model holds only what lines made.
import { Machine } from "@demlik/tea/effect";
import { Program, type Refusal } from "@kampus/libfabrika";
import { Schema } from "effect";
import { builtins, type Known, read } from "./read.ts";

/** The longest line, in string indices: the tty line discipline's own buffer (Linux
 *  `N_TTY_BUF_SIZE`, 4096). Its letter fits one letter row with room to spare. */
export const LINE_MOST = 4096;

/** How many submitted lines history keeps: bash's default `HISTSIZE`. */
const HISTORY_MOST = 500;

/** How many entries the scrollback keeps: tmux's default `history-limit`. */
const SCROLL_MOST = 2_000;

/** How many lines `history` lists: the newest 16, as bash's `fc -l` does by default. */
const LISTED = 16;

const Line = Schema.String.check(Schema.isMaxLength(LINE_MOST));

/** What one draft frame carries: the whole line, its cursor, and the tile's own count `n`, so an
 *  echo names the edit it confirms. */
export const Draft = Schema.Struct({ text: Line, cursor: Schema.Int, n: Schema.Int });

/** One scrollback entry: a built-in's lines, or a refused line with its one unknown span. */
const Entry = Schema.TaggedUnion({
  answered: { line: Line, says: Schema.Array(Schema.String) },
  refused: { line: Line, start: Schema.Int, end: Schema.Int, reason: Schema.String },
});
type Entry = typeof Entry.Type;

const Model = Schema.Struct({
  history: Schema.Array(Line).check(Schema.isMaxLength(HISTORY_MOST)),
  scroll: Schema.Array(Entry).check(Schema.isMaxLength(SCROLL_MOST)),
  programs: Schema.Array(Schema.String),
});
type Model = typeof Model.Type;

// The line stays a plain string here, so a long one is the program's own `too_long`, said in words.
const Msg = Schema.Union([Schema.Struct({ type: Schema.Literal("submitted"), line: Schema.String })]);

/** What `help` says of each built-in. */
const HELP: Readonly<Record<string, string>> = {
  help: "help [word]   the words fabsh knows, or what one of them does",
  clear: "clear         empty the scrollback",
  history: `history       the newest ${LISTED} lines you ran`,
};

const known = (m: Model): Known => ({ builtins, programs: m.programs });

/** A built-in's answer to a line `read` took, as the lines it says. */
const says = (m: Model, words: ReadonlyArray<string>): ReadonlyArray<string> => {
  const [verb, word] = words;

  if (verb === "history") {
    const listed = m.history.slice(-LISTED);
    const first = m.history.length - listed.length + 1;
    return listed.map((line, i) => `${String(first + i).padStart(5)}  ${line}`);
  }

  // `read` refused every other first word, and `clear` says nothing, so this is `help`.
  return word === undefined
    ? builtins.map((b) => HELP[b] ?? b)
    : [HELP[word] ?? `${word} is not a word fabsh knows. Type help to see them.`];
};

const keep = <A>(all: ReadonlyArray<A>, most: number): ReadonlyArray<A> => (all.length > most ? all.slice(-most) : all);

const push = (m: Model, line: string, entry: Entry | null): Model => ({
  history: keep([...m.history, line], HISTORY_MOST),
  scroll: entry === null ? [] : keep([...m.scroll, entry], SCROLL_MOST),
  programs: m.programs,
});

export const fabshMachine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [],
  init: (loaded) => [loaded ?? { history: [], scroll: [], programs: [] }, []],
  update: {
    // The process decides: it reads the letter's line again, never the tile's prediction.
    submitted: (m, msg) => {
      const line = msg.line;

      if (line.trim() === "") {
        return [m, []];
      }

      const unknown = read(line, known(m)).spans.find((s) => s.role === "unknown");

      if (unknown !== undefined) {
        const entry = Entry.cases.refused.make({
          line,
          start: unknown.start,
          end: unknown.end,
          reason: unknown.reason ?? "no_word",
        });
        return [push(m, line, entry), []];
      }

      const words = line.trim().split(/\s+/);
      return words[0] === "clear"
        ? [push(m, line, null), []]
        : [push(m, line, Entry.cases.answered.make({ line, says: says(m, words) })), []];
    },
  },
});

/** `bad_line` for a line holding a newline, `too_long` for one past `LINE_MOST`. */
const refuse = (_m: Model, msg: typeof Msg.Type): Refusal | null =>
  msg.line.includes("\n") ? { reason: "bad_line" } : msg.line.length > LINE_MOST ? { reason: "too_long" } : null;

export const fabsh = Program.make({
  name: "fabrika/fabsh",
  machine: fabshMachine,
  state: { v: 1, upgrades: [] },
  view: (m) => ({ history: m.history, scroll: m.scroll, programs: m.programs }),
  refuse,
  inputs: { submitted: { description: "A line typed in the shell", personOnly: true } },
  draft: {
    schema: Draft,
    refuse: (d) =>
      d.text.includes("\n")
        ? { reason: "bad_line" }
        : d.cursor < 0 || d.cursor > d.text.length
          ? { reason: "bad_cursor" }
          : null,
  },
  outputs: {},
  writes: {},
  wake: () => null,
});
