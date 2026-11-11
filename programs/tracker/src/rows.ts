import { Writer } from "@kampus/fabrika-old";
import { endedAs } from "@kampus/pipeline/stages/status";
import {
  type Check,
  closedAsks,
  type Entry,
  type Fact,
  readAnswer,
  questionOf,
  picksOf,
} from "@kampus/pipeline/tickets/ticket";
import { Schema } from "effect";
import { openAsksOf, prRefOf, words } from "./head.ts";

// One short row per fact on a ticket's timeline (docs/direction/what-a-ticket-shows.md,
// section 2). A row is a view of its fact, and nothing reads it back:
//
//   {type: "ended", stage: "build", outcome: {kind: "send", to: "review", why: "built"}, usd: 0.41, turns: 14, ...}
//   // {text: "build: sent to review: built", more: "$0.41, 14 turns"}
//
// An outcome is spelled by the pipeline's `endedAs`, the same words `jobs` shows. Made on the host,
// in `shownOf`, so the window draws words and never the pipeline's code.

export const Row = Schema.Struct({
  /** The fact's place on the ledger: the row's key. */
  pos: Schema.Int,
  type: Schema.String,
  by: Writer,
  /** For an agent's row: the name its person goes by on this ledger (the entry's `whose`). */
  whose: Schema.optional(Schema.String),
  at: Schema.Finite,
  /** What happened, in a few words. */
  text: Schema.String,
  /** A second, quieter part: cost, counts, checks. "" when there is none. */
  more: Schema.String,
  /** Text a person or an agent wrote, shown under the row: a body, a comment, an answer's note. */
  body: Schema.NullOr(Schema.String),
});
export type Row = typeof Row.Type;

/** A count with its noun: `1 task`, `2 tasks`. */
const counted = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const FAILED: ReadonlySet<Check["conclusion"]> = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "stale",
]);

/** A pull request's checks in one line: failed (and which), running, or passed. */
export const checksLine = (checks: readonly Check[]): string => {
  if (checks.length === 0) {
    return "no checks";
  }

  const failed = checks.filter((c) => FAILED.has(c.conclusion)).map((c) => c.name);

  if (failed.length > 0) {
    return `checks failed (${failed.join(", ")})`;
  }

  if (checks.some((c) => c.status !== "completed")) {
    return "checks running";
  }

  return "checks passed";
};

const short = (sha: string) => sha.slice(0, 7);

/** Why a yes still stands at a new head, in words (packages/pipeline/src/stages/pipeline/carry.ts). */
const CARRIED = {
  same_head: "the same head",
  replayed: "the same change, on a moved main",
  formatted: "only the formatter changed it",
  glanced: "a glance found the meaning the same",
} as const;

type Said = Pick<Row, "text" | "more" | "body">;

const said = (text: string, more = "", body: string | null = null): Said => ({ text, more, body });

/** An ask's question in quotes, by its id: a row names it in words, never by id. */
const askedOf = (timeline: readonly Entry[], ask: string, earlier: ReadonlySet<string>): string => {
  const asked = timeline.find((e) => e.fact.type === "asked" && e.fact.ask === ask)?.fact;
  return asked?.type === "asked" ? `${earlier.has(ask) ? "earlier ask " : ""}"${questionOf(asked)}"` : "a question";
};

/** A fact's words. `timeline`: the ticket's, for an answer to name what it answered. */
const saidOf = (fact: Fact, timeline: readonly Entry[], earlier: ReadonlySet<string>): Said => {
  switch (fact.type) {
    case "filed":
      return said("filed it", "", fact.body === "" ? null : fact.body);
    case "commented":
      return said(fact.asks === "changes" ? "asked for changes" : "commented", "", fact.body);
    case "closed":
      return said("closed it");
    case "reopened":
      return said("reopened it");
    case "started":
      return said(fact.task === null ? `${fact.stage} started` : `${fact.stage} started, task ${fact.task}`);
    case "session":
      return said("its agent opened a session", fact.id);
    case "ended":
      return said(
        `${fact.stage}: ${endedAs(fact.outcome, "done")}`,
        `$${fact.usd.toFixed(2)}, ${counted(fact.turns, "turn")}`,
      );
    case "checked":
      return said(
        `checks at ${short(fact.head)}: ${fact.result === "not_run" ? "could not run" : fact.result}`,
        fact.failed.length === 0 ? "" : counted(fact.failed.length, "failing test"),
      );
    case "restarted":
      return said(
        `restarted the lane from ${fact.from}`,
        fact.base === null
          ? `on ${short(fact.onto)}`
          : fact.base === fact.onto
            ? `main still at ${short(fact.onto)}`
            : `main moved: ${short(fact.base)} to ${short(fact.onto)}`,
      );
    case "planned":
      return said(`plan v${fact.version}`, counted(fact.tasks.length, "task"));
    case "pushed": {
      const last = fact.commits.at(-1);
      return said(
        counted(fact.commits.length, "commit"),
        last === undefined ? short(fact.head) : `${short(last.sha)} ${last.title}`,
      );
    }
    case "reviewed":
      return said(
        `review at ${short(fact.head)}: ${fact.met} of ${fact.of} met`,
        counted(fact.findings.length, "finding"),
      );
    case "carried":
      return said(`what was said at ${short(fact.from)} still stands at ${short(fact.to)}`, CARRIED[fact.why]);
    case "pr":
      return said(`PR ${prRefOf(fact.url)} ${fact.state}`, checksLine(fact.checks));
    case "asked":
      return said(
        `${earlier.has(fact.ask) ? "earlier ask" : "asks you"}: ${questionOf(fact)}`,
        picksOf(fact).join(" / "),
      );
    case "withdrawn":
      return said(`withdrew ${askedOf(timeline, fact.ask, earlier)}`, fact.why);
    case "stopped":
      return said(`stopped: ${words(fact.why)}`, `resume at ${fact.resume}`);
    case "answered": {
      const answer = readAnswer(timeline, fact);
      return said(
        `answered ${askedOf(timeline, fact.ask, earlier)}: ${answer?.pick ?? "unknown"}`,
        "",
        answer?.note || null,
      );
    }
    case "rated":
      return said(`rated finding ${fact.finding}: ${words(fact.says)}`);
    case "maybe_duplicate":
      return said(`maybe the same as #${fact.of}`, `Jev ${fact.yes.toFixed(2)}`);
    case "duplicate_rated":
      return said(
        fact.says === "accept" ? `accepted: the same as #${fact.of}` : `dismissed: not the same as #${fact.of}`,
      );
  }
};

/** Closed asks that could be mistaken for the first open ask, which the ticket's bar holds. */
const earlierAsks = (timeline: readonly Entry[]): ReadonlySet<string> => {
  const open = openAsksOf(timeline)[0];
  const closed = closedAsks(timeline);
  return new Set(
    timeline.flatMap(({ fact }) =>
      fact.type === "asked" && closed.has(fact.ask) && questionOf(fact) === open?.what ? [fact.ask] : [],
    ),
  );
};

const row = (entry: Entry, timeline: readonly Entry[], earlier: ReadonlySet<string>): Row => ({
  pos: entry.pos,
  type: entry.fact.type,
  by: entry.by,
  ...(entry.whose === undefined ? {} : { whose: entry.whose }),
  at: entry.at,
  ...saidOf(entry.fact, timeline, earlier),
});

/** One entry's row. */
export const rowOf = (entry: Entry, timeline: readonly Entry[]): Row => row(entry, timeline, earlierAsks(timeline));

/** Every row of a timeline, oldest first. */
export const rowsOf = (timeline: readonly Entry[]): readonly Row[] => {
  const earlier = earlierAsks(timeline);
  return timeline.map((e) => row(e, timeline, earlier));
};
