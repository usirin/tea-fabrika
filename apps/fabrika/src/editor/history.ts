import {Effect, FileSystem} from "effect";

// Where the line editor's history is kept between starts: a file of lines, oldest first, one
// line each, as bash's ~/.bash_history. The editor holds the history (editor.ts) and asks for it
// to be kept whole on each change; this is only where it goes.
//
//   const history = yield* fileHistory("<home>/history");
//   yield* history.load              ["seq --to 3", "counter"]
//   yield* history.save(["counter"]) the file now holds "counter\n"
//
// A file that is not there yet, or cannot be read, is an empty history: a shell with no history
// still starts. A save that fails is let go the same way, and said on the error log.

export interface History {
	/** The lines kept, oldest first. */
	readonly load: Effect.Effect<readonly string[]>;
	/** Keep these lines, in place of what was kept. */
	readonly save: (lines: readonly string[]) => Effect.Effect<void>;
}

/** A history in memory, for a test: it starts with `lines`. */
export const memoryHistory = (
	lines: readonly string[] = [],
): History & {readonly kept: () => readonly string[]} => {
	let kept = lines;
	return {
		load: Effect.sync(() => kept),
		save: (next) =>
			Effect.sync(() => {
				kept = next;
			}),
		kept: () => kept,
	};
};

/** A history in the file at `path`, written whole on each save. */
export const fileHistory = (path: string) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const history: History = {
			load: fs.readFileString(path).pipe(
				Effect.map((text) => text.split("\n").filter((line) => line !== "")),
				Effect.orElseSucceed((): readonly string[] => []),
			),
			save: (lines) =>
				fs
					.writeFileString(path, lines.map((line) => `${line}\n`).join(""))
					.pipe(
						Effect.catch((e) =>
							Effect.logError(`fabrika: could not keep the history: ${e.message}`),
						),
					),
		};
		return history;
	});

/** One history for every tile's editor: a save from one is told to each that follows it. */
export interface SharedHistory extends History {
	/** Hear each save from now on, the follower's own too. Answers how to stop hearing them. */
	readonly follow: (heard: (lines: readonly string[]) => void) => () => void;
}

/**
 * Share `kept` among the tiles, as fish shares its history among its shells: a line typed in one
 * tile is in every tile's Up and Ctrl-R from then on. Read once here; each save writes it whole.
 *
 *   const history = yield* sharedHistory(yield* fileHistory("<home>/history"));
 *   history.follow((lines) => editorOfTile2.dispatch({type: "history", lines}));
 *   yield* history.save(["counter"])   // tile 2's editor hears ["counter"]
 *
 * Two tiles that keep a line in the same instant each save their own whole list, and the later
 * one wins: one of the two lines is lost. A person types in one tile at a time, so this is let be.
 */
export const sharedHistory = (kept: History) =>
	Effect.gen(function* () {
		let lines = yield* kept.load;
		const followers = new Set<(lines: readonly string[]) => void>();
		const history: SharedHistory = {
			load: Effect.sync(() => lines),
			save: (next) =>
				Effect.sync(() => {
					lines = next;
					for (const heard of followers) heard(next);
				}).pipe(Effect.andThen(kept.save(next))),
			follow: (heard) => {
				followers.add(heard);
				return () => {
					followers.delete(heard);
				};
			},
		};
		return history;
	});
