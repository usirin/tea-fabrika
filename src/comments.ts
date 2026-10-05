import { Cmd } from "@demlik/tea";
import { z } from "zod";
import type { Criterion, Issue } from "./issue.ts";

// Comments the ticket's owner leaves while the work is under way. A comment
// can change what "done" means, so before a lane finishes it reads them:
//
//   tracker  where the comments live: GitHub, another tracker, a file, a script
//   reader   does this comment change a rule, add one, or change nothing?
//   person   everything but a sure "changes nothing"
//
// Reading never interrupts a build. The lane asks the tracker when it is about
// to finish, so a comment left mid-build is read at the end of that build.

/** A comment as the tracker hands it over. `id` is the tracker's, stable across reads. */
export const Comment = z.object({ id: z.string(), text: z.string() });
export type Comment = z.infer<typeof Comment>;

/** Ask the tracker for every comment on the ticket so far. */
export const fetchComments = Cmd.define("fetch_comments", {
  input: z.object({ issue: z.string() }),
  ok: z.object({ comments: z.array(Comment).readonly() }),
  err: ["tracker_failed"],
});

/** What the reader said a comment does. */
export const Reading = z.discriminatedUnion("kind", [
  /** Asks for something other than what this criterion's rule says. */
  z.object({ kind: z.literal("changes"), criterion: z.string() }),
  /** Asks for behaviour no criterion covers. */
  z.object({ kind: z.literal("adds") }),
  /** A question, thanks, a status note: nothing a rule has to answer to. */
  z.object({ kind: z.literal("none") }),
  /** The reader was not sure enough to say. */
  z.object({ kind: z.literal("unsure") }),
]);
export type Reading = z.infer<typeof Reading>;

/** Ask the reader what one comment does to the ticket's rules. */
export const weigh = Cmd.define("weigh", {
  input: z.object({
    key: z.string(),
    text: z.string(),
    rules: z.array(z.object({ id: z.string(), rule: z.string() })).readonly(),
  }),
  ok: z.object({ key: z.string(), reading: Reading, confidence: z.number() }),
  err: ["reader_failed"],
});

/**
 * Where a comment stands. `reading`: the reader is asked. `settled`: it
 * changes nothing, by the reader's sure word or a person's. `open`: a person
 * has to rule, because it may change a rule or could not be read.
 */
export type CommentState =
  | { readonly kind: "reading" }
  | { readonly kind: "settled"; readonly by: "reader" | "person" }
  | { readonly kind: "open"; readonly reading: Reading | { readonly kind: "unread" } };

export type OwnerComment = Comment & { readonly state: CommentState };

/** The question for one comment, against the ticket as it is now. */
export const weighFor = (issue: Issue, c: Comment) =>
  weigh({ key: c.id, text: c.text, rules: issue.criteria.map((r) => ({ id: r.id, rule: ruleOf(r) })) });

/** A criterion as the reader sees it: its rule, and its first example when it has one. */
const ruleOf = (c: Criterion): string =>
  c.kind === "example" ? `${c.rule} (${c.examples[0].call} -> ${c.examples[0].result})` : c.rule;

/** The reader's answer: only a "changes nothing" settles a comment; anything else waits for a person. */
export const afterReading = (reading: Reading): CommentState =>
  reading.kind === "none" ? { kind: "settled", by: "reader" } : { kind: "open", reading };

export const withState = (comments: readonly OwnerComment[], id: string, state: CommentState): readonly OwnerComment[] =>
  comments.map((c) => (c.id === id ? { ...c, state } : c));

/** The comments the tracker has that the lane has not seen yet, to be read. */
export const unseen = (known: readonly OwnerComment[], fetched: readonly Comment[]): readonly OwnerComment[] =>
  fetched.filter((c) => !known.some((k) => k.id === c.id)).map((c) => ({ ...c, state: { kind: "reading" } }));
