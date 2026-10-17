import {createHash} from "node:crypto";
import {type Effect, Schema} from "effect";
import {Place} from "./sheet.ts";

// The tools the review machine opens to its agent, beyond its reads.
//
// The reviewer reads with Read, Grep and Glob: typed reads that change
// nothing. Anything else it may do is an input of the machine, listed here
// and nowhere else. Each call becomes one Msg the machine folds into its
// state, so it is saved, replays, and shows on the run's handle while the
// agent is still working. A tool that is not in `OPENED` cannot be given to
// the agent: the reviewer builds its tools from this table and nothing else.
//
// The reviewer's run is a Sub of the machine, on while it is reviewing. Its
// runner is a stream of Msgs, and the doors of these tools are made inside
// that stream, beside the line its Msgs go out on. Nothing is filled in later.
//
//   agent calls file_note({title, body, at})
//     -> its door puts {kind: "note", note} on the run's line
//     -> the Sub's runner turns it into the Msg {type: "review_note", note}
//     -> the machine, if it is reviewing, keeps the note and sends a Cmd to file it
//     -> later, the same line carries the run's end, once: the form, or why there is none
//
// There is one so far, `file_note`: the reviewer saw something worth fixing
// that this change did not cause and no criterion covers.

/** Something the reviewer saw that does not belong to this change. */
export const Note = Schema.Struct({
	/** One line, like an issue's title. */
	title: Schema.String,
	/** What it saw and why it matters, in a few sentences. */
	body: Schema.String,
	/** Where, when it is in a file. `null`: nowhere in particular. */
	at: Schema.NullOr(Place),
});
export type Note = typeof Note.Type;

/** The inputs the machine opens to the agent, by tool name: what each takes, and what the agent is told it is for. */
export const OPENED = {
	file_note: {
		input: Note,
		says: "File a note about something worth fixing that this pull request did not cause and that no criterion covers: an old bug you passed, a stale doc, a missing test elsewhere. It is kept apart from your review and counts neither for nor against this change. Never use it for something this change has to fix: that is a finding on your form. Call it once per thing, whenever you see it.",
	},
} as const;

export type ToolName = keyof typeof OPENED;

/** What a tool call hears back. `taken`: it is on its way to the machine. `refused`: the run is over. */
export type Heard = "taken" | "refused";

/**
 * One door per opened tool. Each run makes its own, inside its stream; the
 * reviewer hands each call through its door and tells the agent what came
 * back.
 */
export type Tools = {
	readonly [K in ToolName]: (input: (typeof OPENED)[K]["input"]["Type"]) => Effect.Effect<Heard>;
};

/** The name of the in-process server the opened tools are served from. */
export const SERVER = "review";

/** A tool's name as the agent sees it. */
export const toolName = (name: ToolName) => `mcp__${SERVER}__${name}`;

/** Every opened tool, as the agent sees it. */
export const OPENED_NAMES: readonly string[] = Object.keys(OPENED).map((name) =>
	toolName(name as ToolName),
);

const plain = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * A note's id: `note-` and eight characters made from its title. The same
 * title gives the same id, so a note filed twice (a reviewer that says it
 * again, or a run started again after a restart) is kept once.
 */
export const noteIdOf = (note: Note): string =>
	`note-${createHash("sha256").update(plain(note.title)).digest("hex").slice(0, 8)}`;
