import type {Pack} from "@tea-fabrika/wip/asks/packs";
import {Effect, Schema} from "effect";
import {commentView} from "./comment.ts";
import {markdownView} from "./markdown.ts";
import {deskProgram} from "./program.ts";

// The pack, as the host loads it: `packs = ["@tea-fabrika/owner-desk"]` in
// tsh.toml. Its own table picks the view and the folder it writes to:
//
//   [pack."@tea-fabrika/owner-desk"]
//   view = "comment"     # or "markdown", the default
//   dir = ".desk"        # where the pages go
//
// The core hears none of this.

const Settings = Schema.Struct({
	view: Schema.optional(Schema.Literals(["markdown", "comment"])),
	dir: Schema.optional(Schema.String),
});

const pack: Pack = {
	program: deskProgram,
	listens: {ask: "ask", settled: "settled", refused: "refused"},
	answers: {answer: "answer"},
	layer: (settings) =>
		Schema.decodeUnknownEffect(Settings)(settings).pipe(
			Effect.mapError((error) => error.message),
			Effect.map(({view = "markdown", dir = ".desk"}) =>
				view === "comment" ? commentView(dir) : markdownView(dir),
			),
		),
};

export default pack;
