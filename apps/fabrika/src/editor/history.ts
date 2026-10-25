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
