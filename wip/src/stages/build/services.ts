import {Context, type Effect, Schema} from "effect";
import type {Ticket} from "./ticket";

// The build stage's two services besides its builder, kept apart by what
// each may do, the way `CodeHost` and `CodeHostWrites` are:
//
//   BuildHost    reads the ticket. It cannot write.
//   BuildWrites  the three writes: make the working copy, push the branch,
//                open the pull request. Each takes the ticket's url, and the
//                live one (./github.ts) writes to the sandbox and nowhere
//                else: it has no repository to be told.

type Failed = {readonly _tag: "unknown"};

/** A working copy made for one ticket. `base`: the commit it stood at when the round began. */
export const Copied = Schema.Struct({
	tree: Schema.String,
	branch: Schema.String,
	base: Schema.String,
});
export type Copied = typeof Copied.Type;

/** A push. `head`: the branch's commit now. `changed`: it is not the round's `base`. */
export const Pushed = Schema.Struct({head: Schema.String, changed: Schema.Boolean});
export type Pushed = typeof Pushed.Type;

export class BuildHost extends Context.Service<
	BuildHost,
	{readonly ticket: (url: string, number: number) => Effect.Effect<Ticket, Failed>}
>()("BuildHost") {}

export class BuildWrites extends Context.Service<
	BuildWrites,
	{
		/** A working copy on the ticket's branch: made, or found from an earlier round, and installed. */
		readonly copy: (ticket: string, number: number) => Effect.Effect<Copied, Failed>;
		/**
		 * Commit what is in the copy, if anything, and push the branch. Sent
		 * again after a restart it finds its own first write: nothing to
		 * commit, and a push that changes nothing.
		 */
		readonly push: (
			ticket: string,
			copied: Copied,
			message: string,
		) => Effect.Effect<Pushed, Failed>;
		/**
		 * The pull request from the ticket's branch: the open one, with its
		 * text made this round's, or a new one. Read before written, so a
		 * second send opens no second pull request. Answers its url.
		 */
		readonly open: (
			ticket: string,
			number: number,
			title: string,
			body: string,
		) => Effect.Effect<string, Failed>;
	}
>()("BuildWrites") {}
