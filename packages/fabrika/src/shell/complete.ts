import { type Jobs, jobNamed } from "../host/jobs.ts";
import type { Entry } from "../program/listed.ts";
import type { Flag, Input } from "../program/shape.ts";
import { hasTable, own, wire } from "./check.ts";
import { choices } from "./decode.ts";
import { ALL_WORD, BUILTINS, HELP_WORDS, parse } from "./grammar.ts";
import type { ProgramList } from "./programs.ts";
import { NO_TALK, type Talk } from "./summon.ts";
import { type Token, words } from "./words.ts";

// Tab completion, from the line as typed so far and nothing else: the program
// list's declarations and the job table. Pure, so the launcher calls it from
// readline's completer, and a test calls it with a string.
//
//   complete("sh", …)                       ship                 a program, or a built-in
//   complete("ship --m", …)                 --mode               a flag ship declares
//   complete("ship --mode ", …)             read write           the values its shape takes
//   complete("ship --mode read p", …)       pr=                  an input, told on the line
//   complete("ship --h", …)                 --help               every program's help
//   complete("ship --help ", …)             --mode pr >found …   the parts it can show whole
//   complete("seq --to 3 | ", …)            double tally         after a pipe: programs seq can feed
//   complete("tell ", …)                    %1 tally:3f2a…       the jobs in the table
//   complete("tell %1 ", …)                 add                  the inputs of the job's program
//   complete("summon ", …)                  claude codex         the agents a person can summon
//   complete("summon claude ", …)           as fake-small …      `as`, and the settings it offered
//   complete("@sc", …)                      @scout               the names summoned now
//
// The answer is what readline wants: the candidates, and the part of the line
// they replace.

export interface Completed {
  /** Every candidate, whole: readline puts the one picked in place of `word`. */
  readonly candidates: readonly string[];
  /** The end of the line the candidates replace: the word under the cursor, as typed. */
  readonly word: string;
}

const none = (word: string): Completed => ({ candidates: [], word });

/** The candidates that start with what was typed, each once, in order. */
const matching = (typed: string, all: Iterable<string>): readonly string[] => [
  ...new Set([...all].filter((c) => c.startsWith(typed))),
];

/** Complete the line, as typed up to the cursor. */
export function complete(line: string, list: ProgramList, jobs: Jobs, talk: Talk = NO_TALK): Completed {
  // A said line (S2): only its `@name` is a word. What is said after it is the agent's, as typed,
  // so no program, built-in or operator is offered in it.
  const lead = line.trimStart();

  if (lead.startsWith("@")) {
    if (/\s/.test(lead)) {
      return none(lead.slice(lead.search(/\S*$/)));
    }

    return {
      candidates: matching(
        lead,
        talk.names.map((n) => `@${n}`),
      ),
      word: lead,
    };
  }

  const { tokens, open, trailing } = words(line);

  // Inside an open quote the word's text is not what is on the line: no guess beats a wrong one.
  if (open) {
    return none("");
  }

  const last = tokens.at(-1);
  const current: Extract<Token, { kind: "word" }> | undefined = !trailing && last?.kind === "word" ? last : undefined;
  const typed = current?.text ?? "";
  const raw = current === undefined ? "" : line.slice(current.start);

  // A word with quotes or escapes in it reads differently from how it is typed: leave it be.
  if (typed !== raw) {
    return none(raw);
  }

  // The words of the command the cursor is in, before the cursor's own word.
  const before = current === undefined ? tokens : tokens.slice(0, -1);
  const cut = before.findLastIndex((t) => t.kind === "op");
  const opener = before[cut];
  const args = before.slice(cut + 1).flatMap((t) => (t.kind === "word" ? [t.text] : []));
  const [head, ...rest] = args;

  if (head === undefined) {
    // The program's own name. After `|` or `$(` a built-in cannot stand,
    // and after `|` only a program the stage before can feed.
    const op = opener?.kind === "op" ? opener.op : null;
    const feeds = op === "|" ? feeding(line, before, cut, list) : null;
    const programs = [...list.values()].filter((b) => feeds === null || canWire(feeds, b)).map((b) => b.program.name);
    const inPipe = op === "|" || op === "$(";
    return { candidates: matching(typed, [...programs, ...(inPipe ? [] : BUILTINS)]), word: raw };
  }

  if (head === "summon") {
    return summonWord(rest, typed, talk);
  }

  if (head === "dismiss") {
    return rest.length === 0 ? { candidates: matching(typed, talk.names), word: raw } : none(raw);
  }

  if ((BUILTINS as readonly string[]).includes(head)) {
    return builtinWord(head, rest, typed, list, jobs);
  }

  const entry = list.get(head);

  if (entry === undefined) {
    return none(raw);
  }

  const { program } = entry;
  const valuesOf = (schema: Record<string, unknown> | undefined) => choices(schema).map(String);

  // A value after `--flag ` (the flag's word before this one, with no `=`).
  const prior = rest.at(-1);

  if (prior !== undefined && HELP_WORDS.has(prior)) {
    const parts = [
      ...Object.keys(program.flags).map((f) => `--${f}`),
      ...Object.keys(program.inputs),
      ...Object.keys(program.outputs).map((o) => `>${o}`),
    ];
    return { candidates: matching(typed, parts), word: raw };
  }

  // `--all` takes no value: the word after it is any other.
  if (prior?.startsWith("--") && prior !== ALL_WORD && !prior.includes("=")) {
    const flag: Flag<unknown> | undefined = own(program.flags, prior.slice(2));
    return { candidates: matching(typed, valuesOf(flag?.shape.json)), word: raw };
  }

  const given = new Set(rest.filter((w) => w.startsWith("--")).map((w) => w.slice(2).split("=")[0]));

  if (typed.startsWith("--") && typed.includes("=")) {
    const name = typed.slice(2, typed.indexOf("="));
    const flag: Flag<unknown> | undefined = own(program.flags, name);
    const values = valuesOf(flag?.shape.json).map((v) => `--${name}=${v}`);
    return { candidates: matching(typed, values), word: raw };
  }

  if (typed.startsWith(">")) {
    return {
      candidates: matching(
        typed,
        Object.keys(program.outputs).map((o) => `>${o}`),
      ),
      word: raw,
    };
  }

  if (typed.startsWith("<")) {
    return {
      candidates: matching(
        typed,
        Object.keys(program.inputs).map((i) => `<${i}`),
      ),
      word: raw,
    };
  }

  if (!typed.startsWith("-") && typed.includes("=")) {
    const name = typed.slice(0, typed.indexOf("="));
    const into: Input<unknown> | undefined = own(program.inputs, name);
    const values = valuesOf(into?.shape.json).map((v) => `${name}=${v}`);
    return { candidates: matching(typed, values), word: raw };
  }

  const flags = Object.keys(program.flags)
    .filter((f) => !given.has(f))
    .map((f) => `--${f}`);
  const inputs = typed.startsWith("-") ? [] : Object.keys(program.inputs).map((i) => `${i}=`);
  // `--help` on an empty command, or once a dash is typed: anywhere else it would only crowd the inputs.
  const help = rest.length === 0 || typed.startsWith("-") ? ["--help"] : [];
  const all = typed.startsWith("-") && hasTable(entry) && !given.has("all") ? [ALL_WORD] : [];
  return { candidates: matching(typed, [...flags, ...all, ...help, ...inputs]), word: raw };
}

/** The stage before a `|`: its program, and the output it names with `>out`, if any. */
interface Feeds {
  readonly entry: Entry;
  readonly out: string | null;
}

/**
 * The stage before the `|` at `bar`, read by the grammar itself from the
 * stage's own text. `null` when it is not one command of a program the list
 * knows: nothing is ruled out then.
 *
 *   seq --to 3 |                     seq, every output
 *   seq --to 3 >n |                  seq, n
 *   upper text=$(say --text hi) |    upper: the `$( )` is part of the stage
 */
function feeding(line: string, tokens: readonly Token[], bar: number, list: ProgramList): Feeds | null {
  // Where the stage starts: back from the bar to the operator before it, a `$( )` inside the
  // stage passed over whole.
  let start = tokens[bar]?.start ?? 0;
  let depth = 0;

  for (const token of tokens.slice(0, bar).reverse()) {
    if (token.kind === "op" && token.op === ")") {
      depth += 1;
    } else if (token.kind === "op" && token.op === "$(" && depth > 0) {
      depth -= 1;
    } else if (token.kind === "op" && depth === 0) {
      break;
    }

    start = token.start;
  }

  const parsed = parse(line.slice(start, tokens[bar]?.start));
  const [statement] = parsed.kind === "parsed" ? parsed.statements : [];
  const [command, ...more] = statement?.kind === "run" ? statement.pipeline.commands : [];
  const entry = command === undefined ? undefined : list.get(command.program.name);

  if (entry === undefined || more.length > 0) {
    return null;
  }

  return { entry, out: command?.out?.name ?? null };
}

/** Whether `b` can follow the `|`: `wire` wires it as typed, or once its `<in` is named. */
const canWire = ({ entry, out }: Feeds, b: Entry): boolean =>
  [null, ...Object.keys(b.program.inputs)].some((into) => wire(entry, out, b, into).kind === "wired");

/**
 * `summon`'s words: an agent first, then up to two of the settings its harness offered, and `as`
 * before the name. Nothing after `as`: the name is the person's to choose.
 *
 *   summon                         claude codex
 *   summon claude                  as fake-small fake-large low medium high
 *   summon claude fake-large       as low medium high
 *   summon claude as               (nothing)
 */
function summonWord(rest: readonly string[], typed: string, talk: Talk): Completed {
  const [agent, ...more] = rest;

  if (agent === undefined) {
    return { candidates: matching(typed, talk.agents), word: typed };
  }

  const at = more.indexOf("as");

  if (at !== -1) {
    return none(typed);
  }

  const offered = (talk.offers[agent] ?? []).filter((w) => !more.includes(w));
  return {
    candidates: matching(typed, more.length >= 2 ? ["as"] : ["as", ...offered]),
    word: typed,
  };
}

/** A built-in's words: a job first, then (for tell and close) one of its program's inputs, then (for tell) values. */
function builtinWord(name: string, rest: readonly string[], typed: string, list: ProgramList, jobs: Jobs): Completed {
  if (name === "help") {
    return rest.length === 0 ? { candidates: matching(typed, list.keys()), word: typed } : none(typed);
  }

  const onJob = name === "tell" || name === "close" || name === "stop" || name === "attach";

  if (!onJob) {
    return none(typed);
  }

  const [jobWord, inputWord] = rest;

  if (jobWord === undefined) {
    return {
      candidates: matching(
        typed,
        jobs.jobs.flatMap((job) => [`%${job.n}`, ...job.stages.map((s) => s.run)]),
      ),
      word: typed,
    };
  }

  if (name !== "tell" && name !== "close") {
    return none(typed);
  }

  const job = jobNamed(jobs, jobWord);
  const stage = job?.stages.find((s) => s.run === jobWord) ?? job?.stages[0];
  const program = stage === undefined ? undefined : list.get(stage.program)?.program;

  if (program === undefined) {
    return none(typed);
  }

  if (inputWord === undefined) {
    return { candidates: matching(typed, Object.keys(program.inputs)), word: typed };
  }

  if (name === "close") {
    return none(typed);
  }

  const into: Input<unknown> | undefined = own(program.inputs, inputWord);
  return { candidates: matching(typed, choices(into?.shape.json).map(String)), word: typed };
}
