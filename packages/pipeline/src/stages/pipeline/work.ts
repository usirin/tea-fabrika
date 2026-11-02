import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {hostEnv, runEnv} from "@kampus/fabrika-old/agents/sandbox";
import {Context, Effect, FileSystem, Layer, Path, type Scope, Semaphore} from "effect";
import {ChildProcessSpawner} from "effect/process";
import {type Exited, runChild} from "../../child.ts";
import {listedAt, textAt} from "../../git-read.ts";
import {
	DEFAULT_SETTINGS,
	readSettings,
	SETTINGS_FILE,
	SETTINGS_PATHS,
	type Settings,
	settingsRefusal,
} from "../../settings.ts";
import {shippedRubrics} from "../../setup.ts";
import {titleOf} from "../../tickets/ticket.ts";

// Where a lane works, on the machine it runs on. The repository is the one the checkout's `origin`
// names, the checkout the app was started from, as `gh` reads a repository off the folder it runs in.
// Read when a step needs it, so a checkout with no origin starts the lane and ends it on a named state
// that says so. The home holds only the lane's own work:
//
//   <checkout>               git's `remote.origin.url`: the repository, its remote and which host
//   <home>/work/clone        the repository, fetched before each read
//   <home>/work/trees/<n>    ticket n's working copy, on branch lane/<n>: tests, then the build
//   <home>/work/copies/<c>   the code at commit c, plain files with no .git: what tests run in
//   <home>/work/judges/<c>   the same, with what an agent loads by itself put back as main has it:
//                            what a read-only agent sees
//   <home>/work/<place>/<c>.done   beside a copy, once it is whole: a head's files cannot write it
//   <home>/work/main-<name>  main's tip, with nothing installed, while rubrics are read from it
//   <home>/work/pulls.json   the pull requests of the lane
//   <home>/work/holds/<n>    what lane n uses that other lanes may share, a path a line: a lane that
//                            ends takes only what no other lane's file names
//
// The tree's commits stay on this machine until the push step. So what the builder does, what the
// mutation step tests and what the review reads are one local head.

type Failed = {readonly _tag: "unknown"; readonly says?: string};
const failed = (says: string): Failed => ({_tag: "unknown", says});

/**
 * Where this lane's files are: the app's home, the checkout it was started from, whose `origin` names
 * the repository, and the folder its brief files were put in. `person`:
 * who is running it, by the id the tracker knows them by. `ignorer`: the mutation step's ignorer
 * plugin, where a bundle put it. Left out: beside its source. `shipped`: the rubrics fabrika ships,
 * where a bundle put them. Left out: beside their source.
 */
export class LaneHome extends Context.Service<
	LaneHome,
	{
		readonly home: string;
		readonly checkout: string;
		readonly briefs: string;
		readonly person: string;
		readonly ignorer?: string;
		readonly shipped?: string;
	}
>()("LaneHome") {}

/**
 * The folder of rubrics that judges a change. One the file names is read from main's tip, so a head
 * cannot rewrite its own judge. Left out: the ones fabrika ships. Pure.
 */
export const rubricsFolder = (
	named: string | undefined,
	places: {readonly main: string; readonly shipped: string},
): string => (named === undefined ? places.shipped : `${places.main}/${named}`);

/**
 * What an agent loads by itself from the folder it runs in, before it reads anything it was asked to.
 * In a head, each of these is the head telling its judge how to judge.
 *
 * Codex, from its docs and `codex exec --help` at 0.165.0: `AGENTS.override.md` and `AGENTS.md` from
 * the project root down to its folder, `.codex/` (config, hooks, rules) and `.agents/skills`. Claude
 * (`agents/claude/rules.ts`): `CLAUDE.md`, `CLAUDE.local.md`, `.claude/`, `.mcp.json`, and `AGENTS.md`
 * through a plugin, with a nested `CLAUDE.md` loaded once a file beside it is read. So these count at
 * any depth, and in any case or compatibility form, since a Mac's disk opens `agents.md` and a name
 * spelled with a long s (U+017F) as `AGENTS.md`.
 */
const LOADED_FILES = new Set([
	"agents.md",
	"agents.override.md",
	"claude.md",
	"claude.local.md",
	".mcp.json",
]);
const LOADED_FOLDERS = new Set([".codex", ".agents", ".claude"]);

/** Does an agent load this file by itself? Pure. */
const loadsItself = (file: string): boolean => {
	const parts = file.normalize("NFKC").toLowerCase().split("/");
	return LOADED_FILES.has(parts.at(-1) ?? "") || parts.some((part) => LOADED_FOLDERS.has(part));
};

/**
 * The repository a lane works on, read off its checkout's `origin`. `host`: `local` is a bare git
 * remote on this disk and a file of pull requests.
 */
export interface Origin {
	/** `owner/name`: names the ticket's id, never read from a code host. */
	readonly repo: string;
	/** The url as origin has it: what the lane clones, fetches and pushes, through git's own config. */
	readonly remote: string;
	readonly host: "local" | "github";
}

/** GitHub's three ways to name a repository to git: https, ssh, and ssh's short form. */
const ON_GITHUB = [
	/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/,
	/^ssh:\/\/git@github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/,
	/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/,
];

/** A folder on this disk, by its whole path: its last two parts are the owner and the name. */
const ON_DISK = /^(?:file:\/\/)?\/(?:.*\/)?([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/;

/**
 * What an origin's url names, as written in git's config, before any `insteadOf`. `null`: a host
 * this lane does not know, or a relative path, which git would read from wherever it runs. Pure.
 *
 *   readOrigin("git@github.com:acme/web.git")   // {repo: "acme/web", host: "github", remote: ...}
 *   readOrigin("/srv/git/acme/web.git")         // {repo: "acme/web", host: "local", remote: ...}
 *   readOrigin("https://gitlab.com/acme/web")   // null
 */
export const readOrigin = (url: string): Origin | null => {
	for (const form of ON_GITHUB) {
		const m = form.exec(url);
		if (m !== null) return {repo: `${m[1]}/${m[2]}`, remote: url, host: "github"};
	}
	const m = ON_DISK.exec(url);
	return m === null ? null : {repo: `${m[1]}/${m[2]}`, remote: url, host: "local"};
};

const GIT = [
	"-c",
	"core.hooksPath=/dev/null",
	"-c",
	"core.pager=cat",
	// A name as the disk has it, never git's quoted form of one.
	"-c",
	"core.quotepath=off",
];
const IDENTITY = {
	GIT_AUTHOR_NAME: "fabrika lane",
	GIT_AUTHOR_EMAIL: "lane@fabrika.invalid",
	GIT_COMMITTER_NAME: "fabrika lane",
	GIT_COMMITTER_EMAIL: "lane@fabrika.invalid",
	GIT_TERMINAL_PROMPT: "0",
};

export interface Tree {
	readonly tree: string;
	readonly branch: string;
	/** Where the branch left main. */
	readonly base: string;
}

export interface PlainFile {
	readonly path: string;
	readonly text: string;
}

export class LaneWork extends Context.Service<
	LaneWork,
	{
		/** The repository the checkout's `origin` names. No origin, or one `readOrigin` does not know, fails it. */
		readonly origin: Effect.Effect<Origin, Failed>;
		/** Fetch, and answer main's tip now. */
		readonly main: Effect.Effect<string, Failed>;
		/** The repository's `.fabrika/fabrika.toml`, at main. An old file `settingsRefusal` refuses fails it, and so does a read that broke. */
		readonly settings: Effect.Effect<Settings, Failed>;
		/** Ticket `n`'s working copy: found, or made from main now. */
		readonly tree: (n: number) => Effect.Effect<Tree, Failed>;
		/** A branch of its own, from main, in a working copy of its own: the exam's. */
		readonly side: (name: string) => Effect.Effect<Tree, Failed>;
		readonly head: (folder: string) => Effect.Effect<string, Failed>;
		/** Write `files`, then commit everything changed in `folder`. Nothing changed: the head as it is. */
		readonly commit: (
			folder: string,
			files: readonly PlainFile[],
			message: string,
		) => Effect.Effect<string, Failed>;
		/** Stage everything, and name what differs from `from`: the agent's own commits count too. */
		readonly staged: (folder: string, from: string) => Effect.Effect<readonly string[], Failed>;
		/** The names `commit` itself changed. */
		readonly filesOf: (folder: string, commit: string) => Effect.Effect<readonly string[], Failed>;
		/** Every file at `commit`. */
		readonly listAt: (folder: string, commit: string) => Effect.Effect<readonly string[], Failed>;
		/** A file's text at a commit. `null`: it is not there. Git failing is not that: it fails, with the reason. */
		readonly show: (commit: string, path: string) => Effect.Effect<string | null, Failed>;
		/** The code at `commit`, as plain files with no history and no links, installed once. Where its tests run. */
		readonly copy: (commit: string) => Effect.Effect<string, Failed>;
		/**
		 * The same, for an agent that reads a head: every file an agent loads by itself is main's, or
		 * gone when main has none. So the head's files cannot tell its judge how to judge. A change to one
		 * still shows in the diff, which comes from git. It does not hold back the head's running code.
		 */
		readonly judgeCopy: (commit: string) => Effect.Effect<string, Failed>;
		/** The files of `commit` its judge's copy really holds: the head's, and main's that an agent loads. */
		readonly judgedFiles: (commit: string) => Effect.Effect<readonly string[], Failed>;
		/**
		 * The folder of rubrics that judges a change, on this machine: `rubricsFolder`, read now. One from
		 * main lasts as long as the scope. `name`: a kept review holds the path, so the same read comes
		 * back at the same place.
		 */
		readonly rubrics: (name: string) => Effect.Effect<string, Failed, Scope.Scope>;
		/** An empty folder: for an agent with no reason to see code. */
		readonly empty: Effect.Effect<string, Failed>;
		/** `head` on the remote's branch `branch`. Never main. */
		readonly pushTo: (folder: string, head: string, branch: string) => Effect.Effect<void, Failed>;
		/** `head` onto main, only when main is its parent line. `moved`: main went on, and nothing was written. */
		readonly land: (head: string) => Effect.Effect<"landed" | "moved", Failed>;
		/** A branch's commit on the remote. `null`: no such branch. */
		readonly remoteHead: (branch: string) => Effect.Effect<string | null, Failed>;
		readonly mergeBase: (a: string, b: string) => Effect.Effect<string, Failed>;
		/** The text of `git diff --unified=0` from `from` to `to`. */
		/** The files a change touches, each named as the disk has it. */
		readonly changedFiles: (from: string, to: string) => Effect.Effect<readonly string[], Failed>;
		/** What a change does to one of them, as `git diff --unified=0`. */
		readonly diff: (from: string, to: string, file: string) => Effect.Effect<string, Failed>;
		/** The commits after `from` up to `to`, oldest first. */
		readonly commits: (
			from: string,
			to: string,
		) => Effect.Effect<readonly {readonly sha: string; readonly title: string}[], Failed>;
		/** Whether `head` can merge onto main. */
		readonly mergeable: (head: string) => Effect.Effect<"clean" | "conflicts", Failed>;
		/** A branch off the remote. Only a lane's own, and only once it has merged. */
		readonly dropBranch: (branch: string) => Effect.Effect<void, Failed>;
		/** The lane whose copies and homes these are, from now on. One `LaneWork` serves one lane. */
		readonly servingLane: (n: number) => Effect.Effect<void>;
		/** A folder this lane made that another lane may share: `leave` removes it once no lane holds it. */
		readonly hold: (folder: string) => Effect.Effect<void, Failed>;
		/**
		 * What lane `n` holds, off this machine, unless another lane holds it too. `trees`: its working
		 * copies and their branches as well. Answers what could not go. Never fails, and never touches the
		 * clone, the pulls file or another lane's anything.
		 */
		readonly leave: (
			n: number,
			parts: {readonly trees: boolean},
		) => Effect.Effect<readonly string[]>;
		readonly at: (...parts: readonly string[]) => string;
	}
>()("LaneWork") {}

/** Who may make the copy at a path, in this process. Each lane has its own `LaneWork`, so it is here. */
const makers = new Map<string, Semaphore.Semaphore>();
const makerOf = (tree: string): Semaphore.Semaphore => {
	const known = makers.get(tree);
	if (known !== undefined) return known;
	const made = Semaphore.makeUnsafe(1);
	makers.set(tree, made);
	return made;
};

/** `LaneWork` on this machine: git, as a program, under `hostEnv`, and what is installed under `runEnv`. */
export const laneWork: Layer.Layer<LaneWork, never, LaneHome> = Layer.effect(
	LaneWork,
	Effect.gen(function* () {
		const {home, checkout, shipped} = yield* LaneHome;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const at = (...parts: readonly string[]) => path.join(home, "work", ...parts);
		const clone = at("clone");
		const on = <A, E>(effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>) =>
			Effect.provideService(effect, ChildProcessSpawner.ChildProcessSpawner, spawner);

		// `hostEnv`, as the build's git has: a remote may need the person's ssh key. Hooks are off, but
		// the clone's git config is not held: a head's install and checks run as the person and can change
		// it, and this git obeys it.
		const gitIn = (dir: string, args: readonly string[]) =>
			on(runChild("git", [...GIT, "-C", dir, ...args], {env: {...hostEnv(), ...IDENTITY}}));
		const said = (step: string, ran: Exited) =>
			failed(`git ${step}: ${ran.err.trim().slice(0, 300)}`);
		const gitOut = (dir: string, args: readonly string[]) =>
			gitIn(dir, args).pipe(
				Effect.flatMap((ran) =>
					ran.code === 0 ? Effect.succeed(ran.out) : Effect.fail(said(args[0] ?? "", ran)),
				),
			);
		const git = (dir: string, args: readonly string[]) =>
			gitOut(dir, args).pipe(Effect.map((out) => out.trim()));
		/** File names, read with `-z`: each as the disk has it, whatever letters or spaces it holds. */
		const names = (dir: string, args: readonly string[]) =>
			gitOut(dir, [...args, "-z"]).pipe(
				Effect.map((out) => out.split("\0").filter((name) => name !== "")),
			);
		const inClone = (args: readonly string[]) => gitIn(clone, args);
		const lines = (out: string) => out.split("\n").filter((line) => line !== "");
		const quiet = <A, E extends {readonly message: string}>(effect: Effect.Effect<A, E>) =>
			effect.pipe(Effect.mapError((e) => failed(e.message)));

		// The url as written, with `--local` so a person's own config is not read as the checkout's.
		// `get-url` would apply `insteadOf` first, and name the folder a rewrite points at, not the repo.
		// git exits 1 when the key is not there; any other failure is no checkout at all.
		const START = "start the app from a checkout of the repository";
		const origin = Effect.gen(function* () {
			const ran = yield* gitIn(checkout, ["config", "--local", "--get", "remote.origin.url"]);
			if (ran.code === 1) return yield* Effect.fail(failed(`${checkout} has no origin: ${START}`));
			if (ran.code !== 0)
				return yield* Effect.fail(failed(`${checkout} is not a git checkout: ${START}`));
			const url = ran.out.trim();
			const read = readOrigin(url);
			if (read === null)
				return yield* Effect.fail(
					failed(`origin ${url} is not on GitHub or a folder on this disk: ${START}`),
				);
			return read;
		});

		const fetched = Effect.gen(function* () {
			const {remote} = yield* origin;
			if (!(yield* fs.exists(clone).pipe(Effect.orElseSucceed(() => false)))) {
				yield* quiet(fs.makeDirectory(at(), {recursive: true}));
				yield* git(at(), ["clone", "--quiet", remote, clone]);
			}
			yield* git(clone, ["fetch", "--quiet", "origin"]);
		});
		const main = Effect.andThen(fetched, git(clone, ["rev-parse", "origin/main"]));

		const show = (commit: string, file: string) =>
			textAt(inClone, commit, file).pipe(Effect.mapError((ran) => said(`read of ${file}`, ran)));

		const settings: Effect.Effect<Settings, Failed> = Effect.gen(function* () {
			const tip = yield* main;
			const refused = settingsRefusal(
				yield* listedAt(inClone, tip, SETTINGS_PATHS).pipe(
					Effect.mapError((ran) => said("read of the settings", ran)),
				),
			);
			if (refused !== null) return yield* Effect.fail(failed(refused));
			const file = at("settings", tip, SETTINGS_FILE);
			const text = yield* show(tip, SETTINGS_FILE);
			if (text === null) return DEFAULT_SETTINGS;
			yield* quiet(fs.makeDirectory(path.dirname(file), {recursive: true}));
			yield* quiet(fs.writeFileString(file, text));
			return yield* readSettings(file).pipe(
				Effect.provideService(FileSystem.FileSystem, fs),
				Effect.mapError((e) => failed(e.why)),
			);
		});

		const made = (name: string, branch: string) =>
			Effect.gen(function* () {
				const tip = yield* main;
				const tree = at("trees", name);
				if (!(yield* fs.exists(tree).pipe(Effect.orElseSucceed(() => false)))) {
					yield* quiet(fs.makeDirectory(at("trees"), {recursive: true}));
					yield* git(clone, ["worktree", "add", "--quiet", "-B", branch, tree, tip]);
				}
				const base = yield* git(tree, ["merge-base", "origin/main", "HEAD"]);
				return {tree: yield* quiet(fs.realPath(tree)), branch, base};
			});

		const head = (folder: string) => git(folder, ["rev-parse", "HEAD"]);

		const commit = (folder: string, files: readonly PlainFile[], message: string) =>
			Effect.gen(function* () {
				for (const file of files) {
					const to = path.join(folder, file.path);
					yield* quiet(fs.makeDirectory(path.dirname(to), {recursive: true}));
					yield* quiet(fs.writeFileString(to, file.text));
				}
				yield* git(folder, ["add", "-A"]);
				const same = yield* gitIn(folder, ["diff", "--cached", "--quiet"]);
				if (same.code !== 0) yield* git(folder, ["commit", "--quiet", "-m", message]);
				return yield* head(folder);
			});

		const install = (tree: string) =>
			Effect.gen(function* () {
				const words = (yield* settings).build?.install ?? [];
				const [program, ...args] = words;
				if (program === undefined) return;
				const ran = yield* on(runChild(program, args, {cwd: tree, env: runEnv()}));
				if (ran.code !== 0)
					return yield* Effect.fail(failed(`[build] install: ${ran.err.trim().slice(0, 300)}`));
			});

		/** `paths` at `sha`, or all of it when none are named, unpacked into `tree`. Its tar goes either way. */
		const unpacked = (tree: string, sha: string, paths: readonly string[] = []) => {
			const packed = `${tree}.tar`;
			return Effect.gen(function* () {
				// A commit a tree holds is in the clone's own object store: every tree is one of its worktrees.
				yield* git(clone, [
					"archive",
					"--format=tar",
					"-o",
					packed,
					sha,
					...paths.map((file) => `:(literal)${file}`),
				]);
				const untar = yield* on(runChild("tar", ["-xf", packed, "-C", tree], {env: runEnv()}));
				if (untar.code !== 0)
					return yield* Effect.fail(failed(`the code at ${sha} could not be copied`));
			}).pipe(Effect.ensuring(Effect.ignore(fs.remove(packed, {force: true}))));
		};

		/** Which lane this `LaneWork` serves. `null`: none is on yet, so nothing is held for one. */
		let serving: number | null = null;
		const holds = at("holds");
		const holdBy = (n: number | null, folder: string) =>
			n === null
				? Effect.void
				: Effect.gen(function* () {
						yield* quiet(fs.makeDirectory(holds, {recursive: true}));
						yield* quiet(
							fs.writeFileString(path.join(holds, String(n)), `${folder}\n`, {flag: "a"}),
						);
					});
		const heldIn = (name: string) =>
			fs.readFileString(path.join(holds, name)).pipe(
				Effect.map(lines),
				Effect.orElseSucceed((): readonly string[] => []),
			);
		/** Every folder under this one open: a try may have left one shut, and nothing leaves a shut one. */
		const opened = (folder: string) =>
			on(
				runChild("find", [folder, "-type", "d", "-exec", "chmod", "u+rwx", "{}", ";"], {
					env: runEnv(),
				}),
			).pipe(Effect.ignore);
		const cleared = (folder: string) =>
			Effect.andThen(opened(folder), quiet(fs.remove(folder, {recursive: true, force: true})));
		/** What could not be done, in words, or nothing. */
		const orSaid = <E>(words: string, effect: Effect.Effect<unknown, E>) =>
			effect.pipe(
				Effect.as<readonly string[]>([]),
				Effect.orElseSucceed((): readonly string[] => [words]),
			);
		/** The mark goes first, so a removal cut short is a try that broke, never a whole copy. */
		const leaveHeld = (n: number, folder: string) =>
			Effect.gen(function* () {
				const names = yield* fs
					.readDirectory(holds)
					.pipe(Effect.orElseSucceed((): readonly string[] => []));
				const others = yield* Effect.forEach(
					names.filter((name) => name !== String(n)),
					heldIn,
					{concurrency: 1},
				);
				if (others.flat().includes(folder)) return [];
				return yield* orSaid(
					folder,
					Effect.andThen(quiet(fs.remove(`${folder}.done`, {force: true})), cleared(folder)),
				);
			}).pipe(makerOf(folder).withPermits(1));
		/** One working copy off the clone, with its branch and what the clone keeps of the remote's. */
		const leaveTree = (name: string, branch: string) =>
			Effect.gen(function* () {
				const tree = at("trees", name);
				yield* opened(tree);
				yield* gitIn(clone, ["worktree", "remove", "--force", tree]).pipe(Effect.ignore);
				const left = yield* orSaid(tree, cleared(tree));
				yield* gitIn(clone, ["worktree", "prune"]).pipe(Effect.ignore);
				yield* gitIn(clone, ["branch", "-D", branch]).pipe(Effect.ignore);
				yield* gitIn(clone, ["update-ref", "-d", `refs/remotes/origin/${branch}`]).pipe(
					Effect.ignore,
				);
				yield* fs.remove(`${tree}.installed`, {force: true}).pipe(Effect.ignore);
				return left;
			});
		const leave = (n: number, parts: {readonly trees: boolean}) =>
			Effect.gen(function* () {
				const trees = parts.trees
					? [
							...(yield* leaveTree(String(n), `lane/${n}`)),
							...(yield* leaveTree(`exam-${n}`, `exam/${n}`)),
						]
					: [];
				const held = [...new Set(yield* heldIn(String(n)))];
				const folders = yield* Effect.forEach(held, (folder) => leaveHeld(n, folder), {
					concurrency: 1,
				});
				yield* fs.remove(path.join(holds, String(n)), {force: true}).pipe(Effect.ignore);
				return [...trees, ...folders.flat()];
			});

		/**
		 * The code at `sha`, as plain files with no links, in `<place>/<sha>`, and `ready` run in it, once.
		 * The mark that says it is whole lies beside it, where no file of the head lands. No mark: anything
		 * there is a try that broke, so it starts over. One at a time, so a second lane never clears a copy
		 * the first is still making.
		 */
		const copyTo = (
			place: string,
			sha: string,
			ready: (tree: string) => Effect.Effect<void, Failed>,
		) => {
			const tree = at(place, sha);
			const mark = `${tree}.done`;
			return Effect.gen(function* () {
				// Under the permit: a lane that is leaving reads the holds under it too, so it sees this one.
				yield* holdBy(serving, tree);
				if (yield* fs.exists(mark).pipe(Effect.orElseSucceed(() => false)))
					return yield* quiet(fs.realPath(tree));
				yield* cleared(tree);
				yield* quiet(fs.makeDirectory(tree, {recursive: true}));
				yield* unpacked(tree, sha);
				const unlinked = yield* on(
					runChild("find", [tree, "-type", "l", "-delete"], {env: runEnv()}),
				);
				if (unlinked.code !== 0)
					return yield* Effect.fail(failed(`the code at ${sha} could not be copied`));
				yield* ready(tree);
				yield* quiet(fs.writeFileString(mark, ""));
				return yield* quiet(fs.realPath(tree));
			}).pipe(makerOf(tree).withPermits(1));
		};

		const copy = (sha: string) => copyTo("copies", sha, install);

		/** The plain files at `sha`: no link, and no folder a submodule stands for. */
		const plainAt = (sha: string) =>
			gitIn(clone, ["ls-tree", "-r", "-z", sha]).pipe(
				Effect.flatMap((ran) =>
					ran.code === 0
						? Effect.succeed(
								ran.out
									.split("\0")
									.filter((row) => /^100(644|755) /.test(row))
									.map((row) => row.slice(row.indexOf("\t") + 1)),
							)
						: Effect.fail(said("ls-tree", ran)),
				),
			);

		// After the install, since the install runs the head's own code and it can write these too. This
		// tidies this one copy, and that is all it does about that code: it runs with no box.
		// `find`, since it stays out of a link where Node's recursive read goes through one and would find
		// files outside the copy. `remove` takes a link away and leaves what it points at.
		const judgeCopy = (sha: string) =>
			copyTo("judges", sha, (tree) =>
				Effect.gen(function* () {
					yield* install(tree);
					const found = yield* on(runChild("find", [tree, "-print0"], {env: runEnv()}));
					if (found.code !== 0)
						return yield* Effect.fail(failed(`the copy at ${sha} could not be read`));
					const files = found.out.split("\0").map((file) => file.slice(tree.length + 1));
					for (const file of files.filter(loadsItself))
						yield* quiet(fs.remove(path.join(tree, file), {recursive: true, force: true}));
					const tip = yield* main;
					const kept = (yield* plainAt(tip)).filter(loadsItself);
					if (kept.length > 0) yield* unpacked(tree, tip, kept);
				}),
			);

		// By what is on disk, so a link, or a head's file the copy took out, is not named.
		const judgedFiles = (sha: string) =>
			Effect.gen(function* () {
				const folder = yield* judgeCopy(sha);
				const fromMain = (yield* plainAt(yield* main)).filter(loadsItself);
				const named = new Set([...(yield* plainAt(sha)), ...fromMain]);
				return yield* Effect.filter([...named], (file) =>
					fs.exists(path.join(folder, file)).pipe(Effect.orElseSucceed(() => false)),
				);
			});

		const rubrics = (name: string) =>
			Effect.gen(function* () {
				const named = (yield* settings).review?.rubrics;
				// Left out, nothing reads main, so no copy of it is made.
				const fromMain =
					named === undefined
						? ""
						: yield* Effect.gen(function* () {
								const tree = at(`main-${name}`);
								const gone = fs.remove(tree, {recursive: true, force: true});
								yield* Effect.addFinalizer(() => Effect.ignore(gone));
								// A hard kill leaves the last one here.
								yield* quiet(gone);
								yield* quiet(fs.makeDirectory(tree, {recursive: true}));
								// Rubrics are plain text, so this copy installs nothing.
								yield* unpacked(tree, yield* main);
								return yield* quiet(fs.realPath(tree));
							});
				return rubricsFolder(named, {
					main: fromMain,
					shipped:
						shipped ?? (yield* shippedRubrics().pipe(Effect.provideService(Path.Path, path))),
				});
			});

		const empty = Effect.gen(function* () {
			const folder = at("empty");
			yield* quiet(fs.makeDirectory(folder, {recursive: true}));
			return yield* quiet(fs.realPath(folder));
		});

		return {
			origin,
			main,
			settings,
			tree: (n) =>
				Effect.gen(function* () {
					const made_ = yield* made(String(n), `lane/${n}`);
					const mark = at("trees", `${n}.installed`);
					if (!(yield* fs.exists(mark).pipe(Effect.orElseSucceed(() => false)))) {
						yield* install(made_.tree);
						yield* quiet(fs.writeFileString(mark, ""));
					}
					return made_;
				}),
			side: (name) => made(name, name.replace(/-/, "/")),
			head,
			commit,
			staged: (folder, from) =>
				Effect.gen(function* () {
					yield* git(folder, ["add", "-A"]);
					return yield* names(folder, ["diff", "--cached", "--no-renames", "--name-only", from]);
				}),
			filesOf: (folder, sha) =>
				names(folder, ["show", "--no-renames", "--format=", "--name-only", sha]),
			listAt: (folder, sha) => names(folder, ["ls-tree", "-r", "--name-only", sha]),
			show,
			copy,
			judgeCopy,
			judgedFiles,
			rubrics,
			empty,
			pushTo: (folder, sha, branch) =>
				git(folder, ["push", "--quiet", "--force", "origin", `${sha}:refs/heads/${branch}`]).pipe(
					Effect.asVoid,
				),
			land: (sha) =>
				Effect.gen(function* () {
					yield* fetched;
					const ran = yield* gitIn(clone, ["push", "--quiet", "origin", `${sha}:refs/heads/main`]);
					return ran.code === 0 ? ("landed" as const) : ("moved" as const);
				}),
			remoteHead: (branch) =>
				Effect.gen(function* () {
					yield* fetched;
					const ran = yield* gitIn(clone, ["rev-parse", "--verify", "--quiet", `origin/${branch}`]);
					return ran.code === 0 ? ran.out.trim() : null;
				}),
			mergeBase: (a, b) => git(clone, ["merge-base", a, b]),
			changedFiles: (from, to) => names(clone, ["diff", "--no-renames", "--name-only", from, to]),
			diff: (from, to, file) =>
				gitOut(clone, [
					"diff",
					"--unified=0",
					"--no-color",
					"--no-renames",
					from,
					to,
					"--",
					`:(literal)${file}`,
				]),
			commits: (from, to) =>
				git(clone, ["log", "--reverse", "--format=%H%x09%s", `${from}..${to}`]).pipe(
					Effect.map((out) =>
						lines(out).map((line) => {
							const [sha = "", ...title] = line.split("\t");
							return {sha, title: titleOf(title.join(" "))};
						}),
					),
				),
			mergeable: (sha) =>
				gitIn(clone, ["merge-tree", "--write-tree", "origin/main", sha]).pipe(
					Effect.map((ran) => (ran.code === 0 ? ("clean" as const) : ("conflicts" as const))),
				),
			dropBranch: (branch) =>
				git(clone, ["push", "--quiet", "origin", "--delete", branch]).pipe(Effect.asVoid),
			servingLane: (n) =>
				Effect.sync(() => {
					serving = n;
				}),
			hold: (folder) => Effect.suspend(() => holdBy(serving, folder)),
			leave,
			at,
		};
	}),
).pipe(Layer.provide(nodeServices));
