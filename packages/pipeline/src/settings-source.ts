import {hostEnv} from "@kampus/fabrika-old/agents/sandbox";
import {Effect, FileSystem, Path} from "effect";
import type {ChildProcessSpawner} from "effect/process";
import {type Exited, runChild, runLow} from "./child.ts";
import {listedAt} from "./git-read.ts";
import {
	DEFAULT_SETTINGS,
	readSettings,
	SETTINGS_FILE,
	SETTINGS_PATHS,
	type Settings,
	type SettingsInvalid,
	settingsFrom,
	settingsRefusal,
} from "./settings.ts";
import {ASKED, type Holds, RUBRIC_FILES} from "./setup.ts";

// Where .fabrika/fabrika.toml is read from: one place, never two
// (docs/direction/one-fabrika-toml-per-repo.md).
//
//   a target repo   tsh.toml names one (`repo`, or `clone`): the file as it is
//                   committed on that repository's default branch, read in its
//                   clone. The clone is made the way build makes it, once:
//
//                     git clone --no-checkout <url> <clone>          (when it is not there)
//                     git -C <clone> fetch --prune origin
//                     git -C <clone> remote set-head origin --auto   (the default branch)
//                     git -C <clone> cat-file blob <commit>:.fabrika/fabrika.toml
//
//   no target       the folder tsh starts in, or the root of the repository
//                   it is in (./settings.ts, `repoOf`).
//
// Committed, never a working tree: a lane's own branch, or a file left in the
// clone's folder, cannot change the settings the lane runs under. A
// `--no-checkout` clone has no working tree to read anyway.
//
// In that same one place, an old file stops the read with one line that says to
// move it (`settingsRefusal`): a `fabrika.toml` at the root, with the new file
// there or not, since two spellings must not stand side by side, and a
// `.fabrika.jsonc` with no new file, since its governed folders would read as none.
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

/** Where to read .fabrika/fabrika.toml. */
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

/** The settings, the one place they came from, and what the repository holds beside them. */
export interface Loaded {
	readonly settings: Settings;
	readonly source: Source;
	/** At the same commit (a target) or in the same folder: what each step's named default is worked out from (./setup.ts). */
	readonly holds: Holds;
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
		/** A read that broke stops the read of the file, saying which step. */
		const stopped = (what: string) => (ran: Exited) =>
			Effect.fail(
				invalid(
					`${SETTINGS_FILE}: cannot ${what} ${name} in ${clone}: ${ran.err.trim().split("\n")[0] ?? ""}`,
				),
			);
		/** What git printed when it answered 0. */
		const said = (what: string) => (ran: Exited) =>
			ran.code === 0 ? Effect.succeed(ran.out.trim()) : stopped(what)(ran);
		const inClone = (args: readonly string[]) =>
			runChild("git", [...GIT_FIRST, "-C", clone, ...args], {env});
		const git = (what: string, args: readonly string[]) =>
			inClone(args).pipe(Effect.flatMap(said(what)));

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
		/** The paths of `asked` that are there at the commit. */
		const present = (asked: readonly string[]) =>
			listedAt(inClone, commit, asked).pipe(Effect.catch(stopped("list the files of")));
		/** A file's text at the commit, read only when `present` listed it. */
		const blob = (file: string) =>
			inClone(["cat-file", "blob", `${commit}:${file}`]).pipe(
				Effect.flatMap((ran) =>
					ran.code === 0 ? Effect.succeed(ran.out) : stopped(`read ${file} of`)(ran),
				),
			);
		const listed = yield* present(SETTINGS_PATHS);
		const refused = settingsRefusal(listed);
		if (refused !== null) return yield* Effect.fail(invalid(`${name}@${branch}: ${refused}`));
		const found = listed.has(SETTINGS_FILE);
		const settings = found
			? yield* settingsFrom(yield* blob(SETTINGS_FILE)).pipe(
					Effect.mapError((error) => invalid(`${name}@${branch}:${SETTINGS_FILE}: ${error.why}`)),
				)
			: DEFAULT_SETTINGS;
		const files = yield* present(ASKED);
		const folder = settings.review?.rubrics;
		const rubrics: Record<string, string> = {};
		if (folder !== undefined) {
			const inFolder = RUBRIC_FILES.map((file) => `${folder.replace(/\/+$/, "")}/${file}`);
			const there = yield* present(inFolder);
			for (const [i, file] of RUBRIC_FILES.entries()) {
				const at = inFolder[i] as string;
				if (there.has(at)) rubrics[file] = yield* blob(at);
			}
		}
		return {
			settings,
			source: {from: "repo", name, branch, commit, found},
			holds: {files, rubrics},
		};
	});

/** The file in a folder, from where tsh starts. */
const fromFolder = (
	folder: string,
): Effect.Effect<Loaded, SettingsInvalid, FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const file = path.join(folder, SETTINGS_FILE);
		const exists = (at: string) => fs.exists(at).pipe(Effect.orElseSucceed(() => false));
		const listed = new Set<string>();
		for (const asked of SETTINGS_PATHS)
			if (yield* exists(path.join(folder, asked))) listed.add(asked);
		const refused = settingsRefusal(listed);
		if (refused !== null) return yield* Effect.fail(invalid(`${folder}: ${refused}`));
		const found = listed.has(SETTINGS_FILE);
		const settings = yield* readSettings(file);
		const files = new Set<string>();
		for (const asked of ASKED) if (yield* exists(path.join(folder, asked))) files.add(asked);
		const rubrics: Record<string, string> = {};
		const named = settings.review?.rubrics;
		if (named !== undefined)
			for (const name of RUBRIC_FILES) {
				const text = yield* fs
					.readFileString(path.join(folder, named, name))
					.pipe(Effect.orElseSucceed(() => null));
				if (text !== null) rubrics[name] = text;
			}
		return {settings, source: {from: "folder", file, found}, holds: {files, rubrics}};
	});

/** Read .fabrika/fabrika.toml from the one place `where` names. A missing file is every default. */
export const loadSettings = (
	where: Where,
): Effect.Effect<
	Loaded,
	SettingsInvalid,
	FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> => (where.from === "repo" ? fromRepo(where.target) : fromFolder(where.folder));
