import type {Pack, Places} from "@kampus/pipeline/asks/packs";
import {Effect, Schema} from "effect";
import {commentView} from "./comment.ts";
import {markdownView} from "./markdown.ts";
import {answersFor} from "./pages.ts";
import {deskProgram} from "./program.ts";

// The pack, as the host loads it: `packs = ["@tea-fabrika/owner-desk"]` in
// the repository's fabrika.toml. Its own table picks the view and the folder
// it writes to:
//
//   [pack."@tea-fabrika/owner-desk"]
//   view = "comment"     # or "markdown", the default
//   dir = "desk"         # where the pages go, from fabrika.toml's folder; the host's folder for the pack when left out
//
// In a shell (tsh's `desk` and `answer`) it takes the owner's replies as
// typed, and says where its pages are. The core hears none of this.

const Settings = Schema.Struct({
	view: Schema.optional(Schema.Literals(["markdown", "comment"])),
	dir: Schema.optional(Schema.String),
});
type Settings = typeof Settings.Type;

/** The folder the pages go in: `dir` from the config's folder, or the pack's own folder. Pure. */
const folderOf = ({dir}: Settings, places: Places): string =>
	dir === undefined ? places.home : dir.startsWith("/") ? dir : `${places.folder}/${dir}`;

const pack: Pack = {
	program: deskProgram,
	listens: {waiting: "waiting", settled: "settled", refused: "refused"},
	answers: {answer: "answer"},
	layer: (settings, places) =>
		Schema.decodeUnknownEffect(Settings)(settings).pipe(
			Effect.mapError((error) => error.message),
			Effect.map((s) =>
				s.view === "comment" ? commentView(folderOf(s, places)) : markdownView(folderOf(s, places)),
			),
		),
	shell: {
		typed: "typed",
		unread: "unread",
		replies: answersFor,
		// The folder: `inbox.md` and `asks/` in it for markdown, the stand-in threads for comment.
		pages: (settings, places) => {
			const read = Schema.decodeUnknownOption(Settings)(settings);
			return read._tag === "None" ? null : folderOf(read.value, places);
		},
	},
};

export default pack;
