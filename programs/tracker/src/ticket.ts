import { hashOf, Text } from "@kampus/pipeline/tickets/approval";
import {
  AreaName,
  AreaNumber,
  type AreaFact,
  type Areas,
  areaRefused,
  nextArea,
  Suggested,
} from "@kampus/pipeline/tickets/area";
import { Answer as Choice, Answered } from "@kampus/pipeline/tickets/ask";
import {
  Asks,
  Body,
  type Fact,
  type FactOf,
  From,
  Id,
  Said,
  Says,
  State,
  type Ticket,
  TicketNumber,
  Title,
} from "@kampus/pipeline/tickets/ticket";
import { Effect, Schema } from "effect";

// What a person does to a ticket in the window, and how the list sums one up. The facts
// themselves, and the fold, are the pipeline's (`@kampus/pipeline/tickets/ticket`), so a lane
// writes the same facts this window shows.
//
//   comment {ticket: 3, body: "Skip part 2.", asks: "changes"}
//   // tracker/ticket/3/inbox  {type: "commented", body: "Skip part 2.", asks: "changes"}
//   answer {ticket: 3, ask: "a-1", pick: "approve", note: "", saw: {title, body}}
//   // tracker/ticket/3/inbox  {type: "answered", ..., text: "sha256:…"}: the hash of what it saw
//   make_area {name: "lane"}
//   // tracker/areas/inbox  {_tag: "area_made", area: 1, name: "lane"}: the next number
//
// Each command is its own struct, the value of the tracker's input of the same name (./index.ts).
// Inside the machine a write is one tagged union, `Write`, as an Elm Msg is: the input's name
// becomes the tag there, and only there.

/** A new ticket: its title and body, and where it came from if the filer knows. Becomes its `filed`. */
export const File = Schema.Struct({ title: Title, body: Body, from: Schema.optionalKey(From) });
export type File = typeof File.Type;

/** A comment. `asks: "changes"`: the "Request changes" button, not "Comment". Becomes one `commented`. */
export const Comment = Schema.Struct({
  ticket: TicketNumber,
  body: Said,
  asks: Schema.optionalKey(Asks),
});
export type Comment = typeof Comment.Type;

/** One ticket, by its number: what `close` and `reopen` take. Becomes its `closed` or `reopened`. */
export const OneTicket = Schema.Struct({ ticket: TicketNumber });
export type OneTicket = typeof OneTicket.Type;

/**
 * A click on an ask's box: one of its picks, the note typed beside it, and the ticket's title and
 * body as the person saw them, so the answer names the text it covers. Becomes one `answered`.
 */
const LegacyAnswer = Schema.Struct({
  ticket: TicketNumber,
  ask: Id,
  pick: Title,
  note: Body,
  saw: Text,
});

export const AskAnswer = Schema.Struct({
  ticket: TicketNumber,
  ask: Id,
  answer: Choice,
  saw: Answered.fields.saw,
  via: Answered.fields.via,
  needed: Answered.fields.needed,
});
export type AskAnswer = typeof AskAnswer.Type;
export const Answer = Schema.Union([AskAnswer, LegacyAnswer]);
export type Answer = typeof Answer.Type;

/** Accept or dismiss on a duplicate hint: is `ticket` the same as `of`? Advice: nothing closes. */
export const RateDuplicate = Schema.Struct({ ticket: TicketNumber, of: TicketNumber, says: Says });
export type RateDuplicate = typeof RateDuplicate.Type;

/**
 * A new area: its name, and the suggestion it came from when a person ticked one. Becomes one
 * `area_made`, with the next number. A person only.
 */
export const MakeArea = Schema.Struct({ name: AreaName, suggested: Schema.optionalKey(Suggested) });
export type MakeArea = typeof MakeArea.Type;

/** A live area's new name. Becomes one `area_renamed`; no ticket changes. A person only. */
export const RenameArea = Schema.Struct({ area: AreaNumber, name: AreaName });
export type RenameArea = typeof RenameArea.Type;

/** One live area into another: every ticket in `area` reads `into`. Becomes one `area_merged`. */
export const MergeArea = Schema.Struct({ area: AreaNumber, into: AreaNumber });
export type MergeArea = typeof MergeArea.Type;

const TicketWrite = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("file"), ...File.fields }),
  Schema.Struct({ kind: Schema.Literal("comment"), ...Comment.fields }),
  Schema.Struct({ kind: Schema.Literal("close"), ...OneTicket.fields }),
  Schema.Struct({ kind: Schema.Literal("reopen"), ...OneTicket.fields }),
  Schema.Struct({ kind: Schema.Literal("answer"), ...AskAnswer.fields }),
  Schema.Struct({ kind: Schema.Literal("answer"), ...LegacyAnswer.fields }),
  Schema.Struct({ kind: Schema.Literal("rate_duplicate"), ...RateDuplicate.fields }),
]);
/** A write to one ticket's stream. */
export type TicketWrite = typeof TicketWrite.Type;

const AreaWrite = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("make_area"), ...MakeArea.fields }),
  Schema.Struct({ kind: Schema.Literal("rename_area"), ...RenameArea.fields }),
  Schema.Struct({ kind: Schema.Literal("merge_area"), ...MergeArea.fields }),
]);
/** A write to the project's areas, on their own stream. */
export type AreaWrite = typeof AreaWrite.Type;

/** One change a person asks for, as the machine holds it: the command, tagged by its input's name. */
export const Write = Schema.Union([...TicketWrite.members, ...AreaWrite.members]);
export type Write = typeof Write.Type;

export const isAreaWrite = (write: Write): write is AreaWrite =>
  write.kind === "make_area" || write.kind === "rename_area" || write.kind === "merge_area";

/**
 * The fact an area write puts on the areas' stream, a new area numbered `next`. Not checked: the
 * save's answer gives the number a new area landed as, and the ledger checked it.
 *
 *   areaFact({kind: "make_area", name: "lane"}, 2)   // {_tag: "area_made", area: 2, name: "lane"}
 */
export const areaFact = (write: AreaWrite, next: AreaNumber): AreaFact =>
  write.kind === "make_area"
    ? {
        _tag: "area_made",
        area: next,
        name: write.name,
        ...(write.suggested === undefined ? {} : { suggested: write.suggested }),
      }
    : write.kind === "rename_area"
      ? { _tag: "area_renamed", area: write.area, name: write.name }
      : { _tag: "area_merged", area: write.area, into: write.into };

/**
 * The fact an area write puts on the areas' stream, onto the areas as they stand, or why it does
 * not fit them, in words. A new area takes the next number. Pure.
 *
 *   areaFactOf({kind: "make_area", name: "lane"}, {live: {1: "desk"}, into: {}})
 *   // {fact: {_tag: "area_made", area: 2, name: "lane"}}
 *   areaFactOf({kind: "make_area", name: "Desk"}, same)
 *   // {why: 'the area "desk" has that name already'}
 */
export const areaFactOf = (write: AreaWrite, areas: Areas): { readonly fact: AreaFact } | { readonly why: string } => {
  const fact = areaFact(write, nextArea(areas));
  const why = areaRefused(areas, fact);
  return why === null ? { fact } : { why };
};

/** An answer written before sealed asks: a pick, a note, and the text seen. */
type LegacyAnswerWrite = Extract<TicketWrite, { kind: "answer"; pick: string }>;
/** Its fact: the pick and note as they were, and the hash of the text seen. */
type LegacyAnswered = Exclude<FactOf<"answered">, { format: 1 }>;

/** The fact a write puts on a ticket's stream. An answer's text goes in as its hash. */
export function factOf(write: LegacyAnswerWrite): Effect.Effect<LegacyAnswered>;
export function factOf(write: TicketWrite): Effect.Effect<Fact>;
export function factOf(write: TicketWrite): Effect.Effect<Fact> {
  switch (write.kind) {
    case "file":
      return Effect.succeed({
        type: "filed",
        title: write.title,
        body: write.body,
        ...(write.from === undefined ? {} : { from: write.from }),
      });
    case "comment":
      return Effect.succeed({
        type: "commented",
        body: write.body,
        ...(write.asks === undefined ? {} : { asks: write.asks }),
      });
    case "close":
      return Effect.succeed({ type: "closed" });
    case "reopen":
      return Effect.succeed({ type: "reopened" });
    case "answer":
      if ("answer" in write) {
        return Effect.succeed({
          type: "answered",
          format: 1,
          ask: write.ask,
          answer: write.answer,
          saw: write.saw,
          via: write.via,
          ...(write.needed === undefined ? {} : { needed: write.needed }),
        });
      }

      return Effect.map(hashOf(write.saw), (text) => ({
        type: "answered" as const,
        ask: write.ask,
        pick: write.pick,
        note: write.note,
        text,
      }));
    case "rate_duplicate":
      return Effect.succeed({ type: "duplicate_rated", of: write.of, says: write.says });
  }
}

/** A ticket as the list shows it: no timeline, but how many comments and when it last moved. */
export const Summary = Schema.Struct({
  number: TicketNumber,
  title: Title,
  state: State,
  comments: Schema.Int,
  at: Schema.Finite,
});
export type Summary = typeof Summary.Type;

export const summaryOf = (ticket: Ticket): Summary => ({
  number: ticket.number,
  title: ticket.title,
  state: ticket.state,
  comments: ticket.timeline.filter((e) => e.fact.type === "commented").length,
  at: ticket.timeline.at(-1)?.at ?? 0,
});
