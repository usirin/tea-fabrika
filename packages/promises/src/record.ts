import {Schema} from "effect";

// One promise a formal check keeps, as data (experiment 117). A file under
// `promises/` at the top of the repo holds one record; its name, without
// `.json`, is the promise's id.
//
//   {
//     "promise": "An ended ship run sends nothing.",
//     "harm": "A run that already ended could enqueue or merge again, with nobody watching.",
//     "tool": "search",
//     "check": "node packages/pipeline/src/laws/promise-check.ts ship \"an ended run sends nothing\"",
//     "plant": {"name": "actsAfterTheEnd", "what": "A restart after the end reads again."},
//     "covers": ["packages/pipeline/src/stages/ship/machine.ts#createShip"],
//     "exam": ["packages/pipeline/src/laws/ship.ts#shipLaws"],
//     "confirmed": {"commit": "1e73124...", "prints": {"packages/...#createShip": "3f9c..."}}
//   }

/**
 * A piece of code, by name: a file, or one top-level block in it.
 * `path/to/file.ts#name` is every top-level statement that declares `name`
 * (a function, a const, a type of that name); `path/to/file.ts` is the whole
 * file. A name, not a line range, so code that moves up or down stays the same
 * piece.
 */
export const Piece = Schema.String.check(
	Schema.isPattern(/^(?!\/)(?!(?:.*\/)?\.\.(?:\/|$))[^#\s]+(?:#[A-Za-z_$][\w$]*)?$/, {
		message: "a path inside the repository, then optionally # and a top-level name",
	}),
);
export type Piece = typeof Piece.Type;

/**
 * Which kind of check keeps the promise.
 * - `search`: every order of messages to a bound, on the real reducer (`explore.ts`).
 * - `tla`: a TLA+ model run by a model checker.
 * - `property`: generated inputs on the real code.
 * - `proof`: a proof, for any size.
 */
export const Tool = Schema.Literals(["search", "tla", "property", "proof"]);
export type Tool = typeof Tool.Type;

/** The break planted to show the check can fail: the check runs again with `PROMISE_PLANT=<name>`. */
export const Plant = Schema.Struct({name: Schema.String, what: Schema.String});

/** When someone last said the check still describes the code, and what the code was then. */
export const Confirmed = Schema.Struct({
	/** The commit `pnpm promises confirm` ran at. A pointer for people: a squash merge drops it. */
	commit: Schema.String,
	/** One print per piece, of `covers` and `exam` alike: what the gate holds the code to. */
	prints: Schema.Record(Schema.String, Schema.String),
});
export type Confirmed = typeof Confirmed.Type;

export const Entry = Schema.Struct({
	/** What must always be true, in one plain sentence. */
	promise: Schema.String,
	/** What goes wrong for someone if it is not, in one plain sentence. */
	harm: Schema.String,
	tool: Tool,
	/** The command that runs the check. Its last line on stdout is a `Verdict`. */
	check: Schema.String,
	plant: Plant,
	/** The code the promise is about. */
	covers: Schema.Array(Piece),
	/** The check itself: the law, the plant, the world it walks, the checker. Changing it is the owner's call. */
	exam: Schema.Array(Piece),
	confirmed: Confirmed,
});
export type Entry = typeof Entry.Type;

export const decodeEntry = Schema.decodeUnknownExit(Schema.fromJsonString(Entry));

/** What a check command prints last: did the promise hold, on which plant if any. */
export const Verdict = Schema.Struct({
	held: Schema.Boolean,
	/** What it checked, in its own words: a law's name. */
	checked: Schema.String,
	plant: Schema.NullOr(Schema.String),
	/** How far it looked, in words. */
	bound: Schema.String,
	/** The shortest breaking sequence, one line per step. Empty when it held. */
	path: Schema.Array(Schema.String),
	why: Schema.NullOr(Schema.String),
});
export type Verdict = typeof Verdict.Type;

export const decodeVerdict = Schema.decodeUnknownExit(Schema.fromJsonString(Verdict));

/** Every piece a record names, `covers` first. */
export const piecesOf = (e: Entry): readonly Piece[] => [...e.covers, ...e.exam];
