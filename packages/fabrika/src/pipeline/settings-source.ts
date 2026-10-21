import {Effect, FileSystem, Path} from "effect";
import type {ChildProcessSpawner} from "effect/process";
import {type Exited, runChild, runLow} from "./child.ts";
import {hostEnv} from "./env.ts";
import {
	DEFAULT_SETTINGS,
	readSettings,
	SETTINGS_FILE,
	type Settings,
	type SettingsInvalid,
	settingsFrom,
} from "./settings.ts";

// Where fabrika.toml is read from: one place, never two
// (docs/direction/one-fabrika-toml-per-repo.md).
//
//   a target repo   tsh.toml names one (`repo`, or `clone`): the file as it is
//                   committed on that repository's default branch, read in its
//                   clone. The clone is made the way build makes it, once:
//
//                     git clone --no-checkout <url> <clone>          (when it is not there)
//                     git -C <clone> fetch --prune origin
//                     git -C <clone> remote set-head origin --auto   (the default branch)
//                     git -C <clone> cat-file blob <commit>:fabrika.toml
//
//   no target       the folder tsh starts in, or the root of the repository
//                   it is in (./settings.ts, `repoOf`).
//
// Committed, never a working tree: a lane's own branch, or a file left in the
// clone's folder, cannot change the settings the lane runs under. A
// `--no-checkout` clone has no working tree to read anyway.
//
// git runs through Effect's `ChildProcess`, under `hostEnv` (it may need the
// login to fetch a private repository), with the repository's hooks off.

/** The repository fabrika works on, as tsh.toml names it. */
export interface Target {
	/** How the start line names it: `<owner>/<name>`, or the clone's folder when only a clone is named. */
	readonly name: string;
	/** Its clone on this machine. */
	readonly clone: string;
	/** Where to clone it from when the clone is not there yet. `null`: nowhere, so a missing clone fails. */
	readonly url: string | null;
}

/** Where to read fabrika.toml. */
export type Where =
	| {readonly from: "repo"; readonly target: Target}
	| {readonly from: "folder"; readonly folder: string};

/** Where it was read, as the start line says it. `found: false`: no file there, so every default. */
export type Source =
	| {
			readonly from: "repo";
			readonly name: string;
			readonly branch: string;
			readonly commit: string;
			readonly found: boolean;
	  }
	| {readonly from: "folder"; readonly file: string; readonly found: boolean};

/** The settings, and the one place they came from. */
export interface Loaded {
	readonly settings: Settings;
	readonly source: Source;
}

/** The one line tsh prints at start: which file it read. */
export const sourceLine = (source: Source): string => {
	const at =
		source.from === "repo"
			? `${source.name}@${source.branch} (${source.commit.slice(0, 7)})`
			: source.file;
	return `${SETTINGS_FILE}: ${at}${source.found ? "" : ", not there: every default"}`;
};

/** Every git call: no hook of the repository's, no pager, no prompt. */
const GIT_FIRST = ["-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat"];

const invalid = (why: string): SettingsInvalid => ({_tag: "settings_invalid", why});

/** The file as committed on the target's default branch, read in its clone. */
const fromRepo = (
	target: Target,
): Effect.Effect<
	Loaded,
	SettingsInvalid,
	FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const env = {...hostEnv(), GIT_TERMINAL_PROMPT: "0"};
		const {clone, name} = target;
		/** What git printed when it answered 0; any other answer stops the read, saying which step. */
		const said = (what: string) => (ran: Exited) =>
			ran.code === 0
				? Effect.succeed(ran.out.trim())
				: Effect.fail(
						invalid(
							`${SETTINGS_FILE}: cannot ${what} ${name} in ${clone}: ${ran.err.trim().split("\n")[0] ?? ""}`,
						),
					);
		const git = (what: string, args: readonly string[]) =>
			runChild("git", [...GIT_FIRST, "-C", clone, ...args], {env}).pipe(Effect.flatMap(said(what)));

		const there = yield* fs
			.exists(path.join(clone, ".git"))
			.pipe(Effect.orElseSucceed(() => false));
		if (!there) {
			if (target.url === null)
				return yield* Effect.fail(
					invalid(`${SETTINGS_FILE}: no clone of ${name} at ${clone} to read it from`),
				);
			yield* fs
				.makeDirectory(path.dirname(clone), {recursive: true})
				.pipe(Effect.mapError((error) => invalid(`${SETTINGS_FILE}: ${error.message}`)));
			yield* runLow(
				"git",
				[...GIT_FIRST, "clone", "--quiet", "--no-checkout", "--", target.url, clone],
				{env},
			).pipe(Effect.flatMap(said("clone")));
		}
		yield* runLow("git", [...GIT_FIRST, "-C", clone, "fetch", "--quiet", "--prune", "origin"], {
			env,
		}).pipe(Effect.flatMap(said("fetch")));
		yield* git("find the default branch of", ["remote", "set-head", "origin", "--auto"]);
		const head = yield* git("find the default branch of", [
			"symbolic-ref",
			"--short",
			"refs/remotes/origin/HEAD",
		]);
		const branch = head.startsWith("origin/") ? head.slice("origin/".length) : head;
		const commit = yield* git("read the default branch of", [
			"rev-parse",
			"--verify",
			"--quiet",
			"refs/remotes/origin/HEAD^{commit}",
		]);
		const listed = yield* git("list the files of", [
			"ls-tree",
			"--name-only",
			commit,
			"--",
			SETTINGS_FILE,
		]);
		if (listed !== SETTINGS_FILE)
			return {
				settings: DEFAULT_SETTINGS,
				source: {from: "repo", name, branch, commit, found: false},
			};
		const text = yield* runChild(
			"git",
			[...GIT_FIRST, "-C", clone, "cat-file", "blob", `${commit}:${SETTINGS_FILE}`],
			{env},
		).pipe(
			Effect.flatMap((ran) =>
				ran.code === 0 ? Effect.succeed(ran.out) : said(`read ${SETTINGS_FILE} of`)(ran),
			),
		);
		const settings = yield* settingsFrom(text).pipe(
			Effect.mapError((error) => invalid(`${name}@${branch}:${SETTINGS_FILE}: ${error.why}`)),
		);
		return {settings, source: {from: "repo", name, branch, commit, found: true}};
	});

/** The file in a folder, from where tsh starts. */
const fromFolder = (
	folder: string,
): Effect.Effect<Loaded, SettingsInvalid, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const file = path.join(folder, SETTINGS_FILE);
		const found = yield* fs.exists(file).pipe(Effect.orElseSucceed(() => false));
		const settings = yield* readSettings(file);
		return {settings, source: {from: "folder", file, found}};
	});

/** Read fabrika.toml from the one place `where` names. A missing file is every default. */
export const loadSettings = (
	where: Where,
): Effect.Effect<
	Loaded,
	SettingsInvalid,
	FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> => (where.from === "repo" ? fromRepo(where.target) : fromFolder(where.folder));
