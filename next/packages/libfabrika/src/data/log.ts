// The log's shapes: what a writer hands in, what the referee keeps, and what it answers. Tier 1,
// P6 (laws p68 and p92). The one file `no-hand-tag` lets write `_tag`: the log stores any fact and
// knows no cases, so a line's `_tag` is an open string, the case as the writer's own schema wrote it.
// `lineFor` and `valueFor` turn a schema's value into a line and an entry back, so no other file
// writes the key.
import {type Brand, Schema} from "effect";

/** A place in the log or in a stream. Both count from 1; 0 means before the first. */
export const Rev = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export type Rev = typeof Rev.Type;

/** An input id's text form, as the door writes it (p68). Kept as text: nothing here makes an `InputId`. */
export const CauseText = Schema.String.check(Schema.isPattern(/^in-[0-9a-f]{8}-[1-9][0-9]*$/));

/** The door's input id. A type only: P10's door makes one, and nothing in `./data` does. */
export type InputId = Brand.Branded<string, "InputId">;

const Text = Schema.NonEmptyString;

/** What a writer hands in to `append`. Every key is required, so a writer can leave none out (p92). */
export const Line = Schema.Struct({
	/** Who wrote it, stamped by the door from the checked key. */
	by: Text,
	/** The person the writer works for, from its grant. */
	for: Text,
	/** The writer's own clock, as it sent it. Shown, never decides. */
	sentAt: Schema.String,
	/** The last rev the writer had folded (S1). */
	seen: Rev,
	/** The input that made this write, or null for an own write (p68). */
	cause: Schema.NullOr(CauseText),
	/** The build of the code that wrote it (H6). */
	build: Text,
	/** The fact's case. */
	_tag: Text,
	/** The fact's fields, kept as JSON. */
	body: Schema.Json,
});
export type Line = typeof Line.Type;

/** A value a schema made, as a line: its case as the line's case, the rest as its body. */
export const lineFor = <A extends {readonly _tag: string} & Schema.JsonObject>(
	from: Omit<Line, "_tag" | "body">,
	{_tag, ...body}: A,
) => ({...from, _tag, body});

/** The reverse of `lineFor`: an entry as the value its schema made, for that schema to decode. */
export const valueFor = (entry: Entry): unknown =>
	Object.assign({}, entry.body, {_tag: entry._tag});

/** One entry: the line, plus what only the referee knows. */
export const Entry = Schema.Struct({
	id: Text,
	stream: Text,
	/** Its place in its stream. */
	pos: Rev,
	/** Its place in the whole log. */
	rev: Rev,
	/** The referee's clock when it arrived, in ms since 1970. Never goes back along rev. */
	arrivedAt: Schema.Int,
	...Line.fields,
});
export type Entry = typeof Entry.Type;

/** An entry as its row holds it: the body as JSON text. */
export const Row = Schema.Struct({...Entry.fields, body: Schema.fromJsonString(Schema.Json)});

/** What `append` answers. A resend gets its first placing again. */
export const Appended = Schema.TaggedUnion({
	placed: {rev: Rev, pos: Rev},
	refused: {why: Schema.Literals(["bad_line", "bad_cause", "seen_ahead", "id_reused", "too_big"])},
});
export type Appended = typeof Appended.Type;

/** What `wait` answers, at once: the stream's newest rev, or parked until a ring. */
export const Waited = Schema.TaggedUnion({ready: {rev: Rev}, parked: {}});
export type Waited = typeof Waited.Type;

/** The most entries one read answers. A guess: far under an object call's message for small facts. */
export const PAGE = 256;
