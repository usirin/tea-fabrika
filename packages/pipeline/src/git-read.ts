import {Effect} from "effect";
import type {Exited} from "./child.ts";

// What a commit holds, read with git. Not there and git failing are two answers, never one:
//
//   git ls-tree   exit 0 and nothing listed: not there. Any other exit: git could not say.
//   git cat-file  run only on a path `ls-tree` listed, so any non-zero exit is a read that broke.
//
// `git show` cannot tell them apart: it exits 128 for a missing file and for a lost object alike.
// A failure carries how git ended, and the caller says what that means for it.

/** One git command, run however the caller runs git. Every path is from the repository's root. */
type Git<R> = (args: readonly string[]) => Effect.Effect<Exited, never, R>;

const printed = (ran: Exited): Effect.Effect<string, Exited> =>
	ran.code === 0 ? Effect.succeed(ran.out) : Effect.fail(ran);

/** The paths of `paths` that are there at `commit`, files and folders alike. */
export const listedAt = <R>(
	git: Git<R>,
	commit: string,
	paths: readonly string[],
): Effect.Effect<ReadonlySet<string>, Exited, R> =>
	git(["ls-tree", "-z", "--name-only", "--full-tree", commit, "--", ...paths]).pipe(
		Effect.flatMap(printed),
		Effect.map((out) => new Set(out.split("\0").filter((name) => name !== ""))),
	);

/** A file's text at `commit`, to its last newline. `null`: it is not there. */
export const textAt = <R>(
	git: Git<R>,
	commit: string,
	file: string,
): Effect.Effect<string | null, Exited, R> =>
	listedAt(git, commit, [file]).pipe(
		Effect.flatMap((there) =>
			there.size === 0
				? Effect.succeed(null)
				: git(["cat-file", "blob", `${commit}:${file}`]).pipe(Effect.flatMap(printed)),
		),
	);
