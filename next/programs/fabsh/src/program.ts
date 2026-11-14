// fabsh, next/: the shell as a regular program (0275, 0432). A submitted line is the one letter a
// person sends, and the only thing that decides: the process reads it again with `read` and folds
// its answer into the scrollback. The line being typed rides the ephemeral lane as a draft, which
// the runner checks with `draft` and never saves, so the saved model holds only what lines made.
// A line that names a program starts it in that line's own step, so the start's cause is the
// member's letter and it is checked against that member (0170): fabsh holds no start grant.
import { Machine } from "@demlik/tea/effect";
import { Program, type Refusal } from "@kampus/libfabrika";
import { programs } from "@kampus/libfabrika/runtime/Programs";
import { startChild } from "@kampus/libfabrika/runtime/StartChild";
import { Schema } from "effect";
import { builtins, type Known, read, run } from "./read.ts";

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

/**
 * One scrollback entry: a built-in's lines, a refused line with its one unknown span, or a start.
 * A start is `starting` until its answer settles it, once, as `started` (a live process, `fresh`
 * when this start made it) or `failed` with the host's reason.
 */
const Entry = Schema.TaggedUnion({
  answered: { line: Line, says: Schema.Array(Schema.String) },
  refused: { line: Line, start: Schema.Int, end: Schema.Int, reason: Schema.String },
  starting: { line: Line, program: Schema.String, name: Schema.String },
  started: { line: Line, process: Schema.String, name: Schema.String, fresh: Schema.Boolean },
  failed: { line: Line, reason: Schema.String },
});
type Entry = typeof Entry.Type;

/** Whether this process still owes the runner its one `programs` ask: `due` until its timer sends it. */
const Ask = Schema.Literals(["due", "sent"]);

const Model = Schema.Struct({
  history: Schema.Array(Line).check(Schema.isMaxLength(HISTORY_MOST)),
  scroll: Schema.Array(Entry).check(Schema.isMaxLength(SCROLL_MOST)),
  programs: Schema.Array(Schema.String),
  ask: Ask,
});
type Model = typeof Model.Type;

// The line stays a plain string here, so a long one is the program's own `too_long`, said in words.
// The timer is the runner's own letter, at the wake this model asks for; no person sends it.
const Msg = Schema.Union([
  Schema.Struct({ type: Schema.Literal("submitted"), line: Schema.String }),
  Schema.Struct({ type: Schema.Literal("timer"), at: Schema.Number, arrivedAt: Schema.optionalKey(Schema.Number) }),
]);

/** What `help` says of each built-in. */
const HELP: Readonly<Record<string, string>> = {
  help: "help [word]   the words fabsh knows, or what one of them does",
  clear: "clear         empty the scrollback",
  history: `history       the newest ${LISTED} lines you ran`,
  programs: "programs      the programs a line can start",
};

/** What `help` says of a line that starts a program. */
const RUN = "<program> [as <name>]   start a program; its process is <program>:1 unless you name it";

const known = (m: Model): Known => ({ builtins, programs: m.programs });

/** A built-in's answer to a line `read` took, as the lines it says. */
const says = (m: Model, words: ReadonlyArray<string>): ReadonlyArray<string> => {
  const [verb, word] = words;

  if (verb === "history") {
    const listed = m.history.slice(-LISTED);
    const first = m.history.length - listed.length + 1;
    return listed.map((line, i) => `${String(first + i).padStart(5)}  ${line}`);
  }

  if (verb === "programs") {
    return m.programs.length === 0 ? ["fabsh knows no program it can start."] : m.programs;
  }

  // `read` refused every other first word, and `clear` says nothing, so this is `help`.
  if (word === undefined) {
    return [...builtins.map((b) => HELP[b] ?? b), RUN];
  }

  const started = run(word, known(m));
  return [
    HELP[word] ??
      (started === null
        ? `${word} is not a word fabsh knows. Type help to see them.`
        : `${word} starts ${started.program} as ${started.name}; add as <name> to name its process.`),
  ];
};

const keep = <A>(all: ReadonlyArray<A>, most: number): ReadonlyArray<A> => (all.length > most ? all.slice(-most) : all);

const push = (m: Model, line: string, entry: Entry | null): Model => ({
  ...m,
  history: keep([...m.history, line], HISTORY_MOST),
  scroll: entry === null ? [] : keep([...m.scroll, entry], SCROLL_MOST),
});

/** Settles the oldest `starting` entry `waits` takes with `settled`; no such entry changes nothing,
 *  so an answer folded again adds nothing. */
const settle = (
  m: Model,
  waits: (e: typeof Entry.cases.starting.Type) => boolean,
  settled: (e: typeof Entry.cases.starting.Type) => Entry,
): Model => {
  const at = m.scroll.findIndex((e) => e._tag === "starting" && waits(e));
  const entry = m.scroll[at];
  return entry?._tag === "starting" ? { ...m, scroll: m.scroll.with(at, settled(entry)) } : m;
};

export const fabshMachine = Machine.make({
  model: Model,
  msg: Msg,
  cmds: [startChild, programs],
  init: (loaded) => [loaded ?? { history: [], scroll: [], programs: [], ask: "due" }, []],
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

      if (words[0] === "clear") {
        return [push(m, line, null), []];
      }

      if (builtins.includes(words[0] ?? "")) {
        return [push(m, line, Entry.cases.answered.make({ line, says: says(m, words) })), []];
      }

      // A program word. The start goes out from this letter's own step and from no other (L20).
      const start = run(line, known(m));

      if (start === null) {
        // `read` takes a line that ends at `as` so far, but it names no process yet.
        const as = read(line, known(m)).spans.find((s) => s.role === "keyword");
        const entry = Entry.cases.refused.make({
          line,
          start: as?.start ?? 0,
          end: as?.end ?? line.length,
          reason: "no_name",
        });
        return [push(m, line, entry), []];
      }

      return [push(m, line, Entry.cases.starting.make({ line, ...start })), [startChild(start)]];
    },
    // The runner's timer at the wake `due` asks for: the one ask of what can be started.
    timer: (m) => (m.ask === "due" ? [{ ...m, ask: "sent" }, [programs({})]] : [m, []]),
    programs_ok: (m, msg) => [{ ...m, programs: [...msg.value] }, []],
    programs_err: (m) => [m, []],
    // The runner answers its Cmds in the order they went, and an ok echoes the start it answers.
    start_child_ok: (m, msg) => [
      settle(
        m,
        (e) => e.program === msg.cmd.program && e.name === msg.cmd.name,
        (e) =>
          msg.value._tag === "already_present"
            ? Entry.cases.failed.make({ line: e.line, reason: msg.value._tag })
            : Entry.cases.started.make({
                line: e.line,
                process: msg.value.process,
                name: msg.value.name,
                fresh: msg.value._tag === "started",
              }),
      ),
      [],
    ],
    // A refusal echoes no start, so it settles the oldest start still waiting.
    start_child_err: (m, msg) => [
      settle(
        m,
        () => true,
        (e) => Entry.cases.failed.make({ line: e.line, reason: msg.error._tag }),
      ),
      [],
    ],
  },
});

/** `bad_line` for a line holding a newline, `too_long` for one past `LINE_MOST`. The timer is the
 *  runner's own, never a person's, so it has nothing to refuse. */
const refuse = (_m: Model, msg: typeof Msg.Type): Refusal | null =>
  msg.type !== "submitted"
    ? null
    : msg.line.includes("\n")
      ? { reason: "bad_line" }
      : msg.line.length > LINE_MOST
        ? { reason: "too_long" }
        : null;

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
  wake: (m) => (m.ask === "due" ? 0 : null),
});
