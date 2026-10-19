import {Schema} from "effect";
import {CriterionId} from "./book.ts";

// How a criterion's id and version are written where people read it: a
// ticket's box opens with them, in code, `c3 v2`, and its words follow.
//
//   - [ ] `c3 v2` When a host runs three programs, every span starts on time
//
// The view is made from the book (../stages/plan/render.ts) and read back by
// a review (../stages/review/pack.ts), which judges the words it read under
// the id and version it read.

const MARK = /^`(c[1-9][0-9]*) v([1-9][0-9]*)`[ \t]*/;

const decodeId = Schema.decodeUnknownOption(CriterionId);

/** The mark for a criterion: its id and version, in code. */
export const markOf = (c: {readonly id: CriterionId; readonly version: number}): string =>
	`\`${c.id} v${c.version}\``;

/** The id and version a box's text opens with, and the words after them. `null`: it opens with no mark. */
export function readMark(
	text: string,
): {readonly id: CriterionId; readonly version: number; readonly words: string} | null {
	const found = MARK.exec(text);
	if (found === null) return null;
	const id = decodeId(found[1]);
	if (id._tag === "None") return null;
	return {id: id.value, version: Number(found[2]), words: text.slice(found[0].length).trim()};
}

/** Words as they are compared: runs of space as one, and no full stop at the end. */
export const wordsOf = (text: string): string =>
	text.replace(/\s+/g, " ").trim().replace(/\.$/, "");
