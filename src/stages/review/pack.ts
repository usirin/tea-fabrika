import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { CodeHost } from "../../services.ts";
import { ReviewKind } from "../ship/facts.ts";

// The pack: everything a reviewer needs for one pull request at one commit,
// as one typed value. Code reads all of it; no agent is asked for any part.
//
//   change   what the code host knows: the head, the ticket and its criteria,
//            the files, the diff, the builder's deviations, the required checks
//   rubrics  the text each kind of review is graded by: a setting, read from
//            a folder given at run time. No rubric is kept in this repo.
//
// Where a part could not be read it is `null` (or `unknown`, for a fact that
// is one word), never a guess. The gate (`gate.ts`) turns each of those into
// a stop, so a reviewer is only ever started on a pack with nothing missing.

/** A kind of review, by today's fabrika's names. The ship stage reads the same list. */
export const Kind = ReviewKind.fields.kind;
export type Kind = typeof Kind.Type;

/** The kinds this stage does: the ones graded by reading text against a rubric. The other two belong to other gates. */
export const TEXT_KINDS = ["review-code", "review-doc", "review-skill"] as const;
export const TextKind = Schema.Literals(TEXT_KINDS);
export type TextKind = typeof TextKind.Type;
export const isTextKind = (kind: Kind): kind is TextKind => (TEXT_KINDS as readonly string[]).includes(kind);

/** One acceptance criterion of the ticket. */
export const Criterion = Schema.Struct({
  /** Its number in the ticket's list, from 1. A row and a finding name a criterion by it. */
  n: Schema.Finite,
  text: Schema.String,
  /** Whether its box is ticked in the ticket today. */
  checked: Schema.Boolean,
  /** A trailing `[evidence: …]` mark: where its proof lives when the diff cannot show it. `null`: no mark. */
  evidence: Schema.NullOr(Schema.String),
});
export type Criterion = typeof Criterion.Type;

/** One changed file, and the text review that reads it. */
export const ChangedFile = Schema.Struct({ path: Schema.String, kind: TextKind });
export type ChangedFile = typeof ChangedFile.Type;

/** The `## Deviations` section of the pull request's text: what the builder says it did differently. */
export const Deviations = Schema.Union([
  /** No such section, or nothing under it. */
  Schema.Struct({ state: Schema.Literal("absent") }),
  /** The section says there are none. That is a claim, and a reviewer may hold the diff against it. */
  Schema.Struct({ state: Schema.Literal("none") }),
  Schema.Struct({ state: Schema.Literal("listed"), text: Schema.String }),
]);
export type Deviations = typeof Deviations.Type;

const CheckState = Schema.Literals(["green", "red", "pending"]);

/** The checks the base branch requires, as they stand at the head. */
export const Checks = Schema.Struct({
  /**
   * Any red is `red`; else any still running is `pending`; else `green`.
   * `pending` too when no required check has reported: that cannot be told
   * from "none will". `unknown`: the list could not be read whole.
   */
  state: Schema.Literals(["green", "red", "pending", "unknown"]),
  required: Schema.Array(Schema.Struct({ name: Schema.String, state: CheckState })),
});
export type Checks = typeof Checks.Type;

/** What the code host knows about one pull request at one commit. */
export const Change = Schema.Struct({
  pr: Schema.String,
  /** The commit under review. */
  head: Schema.String,
  /** The caller named the commit, to review an older head again. `state` is still today's, so the gate does not read it. */
  replay: Schema.Boolean,
  state: Schema.Literals(["open", "merged", "closed", "draft"]),
  /** The ticket the pull request's text names with a closing word or "Part of". `none`: it names no ticket. */
  ticket: Schema.Union([Schema.Literal("none"), Schema.Struct({ id: Schema.String, link: Schema.Literals(["closes_it", "part_of_it"]) })]),
  /** The ticket's acceptance criteria, numbered. Empty: the ticket has no such list. `null`: the ticket could not be read, or none is named. */
  criteria: Schema.NullOr(Schema.Array(Criterion)),
  /** `null`: the list could not be read whole. */
  files: Schema.NullOr(Schema.Array(ChangedFile)),
  /** Every kind of review the change owes, this stage's or not. `null`: the files or the repo's rules could not be read. */
  kinds: Schema.NullOr(Schema.Array(Kind)),
  /** The whole diff from where the branch left its base to the head. `null`: it could not be read whole. */
  diff: Schema.NullOr(Schema.String),
  deviations: Deviations,
  checks: Checks,
});
export type Change = typeof Change.Type;

/** A rubric's text. `null`: the folder has no readable file for that kind. */
export const Rubric = Schema.Struct({ kind: TextKind, text: Schema.NullOr(Schema.String) });
export type Rubric = typeof Rubric.Type;

export const Pack = Schema.Struct({
  ...Change.fields,
  /** One per text review the change owes. */
  rubrics: Schema.Array(Rubric),
});
export type Pack = typeof Pack.Type;

/**
 * What this pack cannot say, though the part has a value. Shown beside a
 * pack wherever one is printed.
 */
export const NOT_IN_THE_PACK: readonly string[] = [
  "ticket, deviations: the ticket's text and the pull request's text are read as they are today. On a replay of an older head they are not what stood then.",
  "ticket: the first one the pull request's text names. A second closing line is not read.",
  "criteria: the checklist only. The owner's rulings in the ticket's comments, and the rest of the thread, are not read.",
  "criteria: a criterion whose `[evidence: …]` mark points at the pull request's text cannot be graded here: only the deviations section of that text is in the pack.",
  "deviations: the section's text as written. Its entries are not parsed, and the diff is not scanned for a change nobody declared.",
  "kinds: worked out by a copy of today's fabrika's path rules over the repo's own `.fabrika.jsonc`. It is not asked of fabrika, so the two can drift.",
  "files: the first 300. With more, the files, the kinds and the diff are not read.",
  "checks: read once, never waited for and never run again. A repo that requires no check reads as `pending` for ever.",
  "verdicts already posted on the pull request are not read.",
];

// ---------------------------------------------------------------- reading a ticket's text

const FENCE = /^ {0,3}(```|~~~)/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const DETAILS_OPEN = /^[ \t]*<details(?:[ \t][^>]*)?>[ \t]*$/;
const DETAILS_CLOSE = /^[ \t]*<\/details>[ \t]*$/;
const BOX = /^[ \t]*[-*+][ \t]+\[([ xX])\][ \t]*(.*)$/;
/** A line that starts a block of its own beside a list item: a bullet, a numbered item, a quote, a rule. */
const NEW_BLOCK = /^[ \t]*(?:[-*+][ \t]+|\d{1,9}[.)][ \t]+|>|(?:[-*_][ \t]*){3,}$)/;
/** Hidden marks a tool left after a criterion. They are not part of what it says. */
const TRAILING_COMMENTS = /(?:\s*<!--(?:[^-]|-(?!->))*-->)+\s*$/;
const EVIDENCE = /\s*\[\s*evidence\s*:\s*([^\]]*?)\s*\]\s*$/i;

/**
 * The lines under the first heading that `named` accepts, up to the next
 * heading that ends it or a folded `<details>` block. A heading inside a code
 * fence or inside `<details>` is not a heading: a folded block is an appendix
 * (fabrika keeps the report as filed there), never the contract. `null`: no
 * such heading.
 */
function sectionUnder(text: string, named: (heading: string) => boolean, ends: (level: number, own: number) => boolean): readonly string[] | null {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let fence: string | null = null;
  let folded = 0;
  let own: number | null = null;
  const section: string[] = [];
  for (const line of lines) {
    const mark = FENCE.exec(line)?.[1];
    if (mark !== undefined) fence = fence === null ? mark : fence === mark ? null : fence;
    const plain = fence === null && mark === undefined;
    if (plain && DETAILS_OPEN.test(line)) {
      if (own !== null) return section;
      folded += 1;
      continue;
    }
    if (plain && DETAILS_CLOSE.test(line)) {
      folded = Math.max(0, folded - 1);
      continue;
    }
    if (folded > 0) continue;
    const heading = plain ? HEADING.exec(line) : null;
    if (heading !== null) {
      const level = (heading[1] as string).length;
      if (own !== null && ends(level, own)) return section;
      if (own === null) {
        if (named((heading[2] as string).trim())) own = level;
        continue;
      }
    }
    if (own !== null) section.push(line);
  }
  return own === null ? null : section;
}

const isNamed = (name: string) => (heading: string) => heading.replace(/:$/, "").trim().toLowerCase() === name;

/**
 * The acceptance criteria a ticket's text lists: the checkbox items under its
 * "Acceptance criteria" heading, numbered from 1 in the order written. A
 * criterion that wraps onto more lines is one criterion. A nested box is a
 * criterion of its own. Empty: no such heading, or no box under it.
 */
export function criteriaIn(body: string): readonly Criterion[] {
  const section = sectionUnder(body, isNamed("acceptance criteria"), () => true) ?? [];
  const items: { checked: boolean; parts: string[] }[] = [];
  let open: { checked: boolean; parts: string[] } | null = null;
  let fenced = false;
  for (const line of section) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      open = null;
      continue;
    }
    if (fenced) continue;
    const box = BOX.exec(line);
    if (box !== null) {
      open = { checked: box[1] !== " ", parts: [(box[2] as string).trim()] };
      items.push(open);
    } else if (line.trim() === "" || NEW_BLOCK.test(line)) {
      open = null;
    } else if (open !== null) {
      open.parts.push(line.trim());
    }
  }
  return items
    .map((item) => ({ checked: item.checked, said: item.parts.join(" ").replace(TRAILING_COMMENTS, "").trim() }))
    .filter((item) => item.said !== "")
    .map((item, at) => {
      const source = EVIDENCE.exec(item.said)?.[1] ?? "";
      // A mark that names no source is left in the text, where a reader will see it.
      return source === ""
        ? { n: at + 1, text: item.said, checked: item.checked, evidence: null }
        : { n: at + 1, text: item.said.replace(EVIDENCE, "").trim(), checked: item.checked, evidence: source };
    });
}

/** The line a tool signs a pull request with, and the link it may put under it. A pull request's text ends with them, whatever its last section is. */
const SIGNED = /\n+[ \t]*🤖 Generated with [^\n]*(?:\n+[ \t]*https:\/\/\S+[ \t]*)?$/u;

/**
 * The `Deviations` section of a pull request's text, as written. It runs to
 * the next heading of its own level or above. Only "None", alone, counts as
 * the builder saying there are none.
 */
export function deviationsIn(body: string): Deviations {
  const section = (sectionUnder(body, isNamed("deviations"), (level, own) => level <= own) ?? []).join("\n").trim();
  const text = `\n${section}`.replace(SIGNED, "").trim();
  if (text === "") return { state: "absent" };
  return /^[*_]*none\.?[*_]*$/i.test(text) ? { state: "none" } : { state: "listed", text };
}

// ---------------------------------------------------------------- the Gather

/** The file a kind's rubric is read from, in the rubric folder. */
export const RUBRIC_FILE: Readonly<Record<TextKind, string>> = { "review-code": "code.md", "review-doc": "doc.md", "review-skill": "skill.md" };

/** One kind's rubric, from a folder. A file that is not there, or is empty, is `null`. */
export const readRubric = (folder: string, kind: TextKind): Effect.Effect<Rubric> =>
  Effect.tryPromise(() => readFile(join(folder, RUBRIC_FILE[kind]), "utf8")).pipe(
    Effect.match({ onSuccess: (text) => ({ kind, text: text.trim() === "" ? null : text }), onFailure: () => ({ kind, text: null }) }),
  );

/** What one review is asked for. `head: null`: the pull request's head now. */
export interface Ask {
  readonly pr: string;
  readonly head: string | null;
  /** The folder the rubrics are read from. */
  readonly rubrics: string;
}

/** Gather the pack: the change from the code host, then one rubric per text review it owes. */
export const readPack = (ask: Ask): Effect.Effect<Pack, { readonly _tag: "unknown" }, CodeHost> =>
  Effect.gen(function* () {
    const change = yield* (yield* CodeHost).change(ask.pr, ask.head);
    const rubrics = yield* Effect.forEach((change.kinds ?? []).filter(isTextKind), (kind) => readRubric(ask.rubrics, kind));
    return { ...change, rubrics };
  });
