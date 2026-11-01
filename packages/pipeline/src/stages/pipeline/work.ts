import {layer as nodeServices} from "@effect/platform-node/NodeServices";
import {hostEnv, runEnv} from "@kampus/fabrika-old/agents/sandbox";
import {Context, Effect, FileSystem, Layer, Path, Schema, type Scope} from "effect";
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

// Where a lane works, on the machine it runs on. Read when a step needs it, so a home with no
// config starts the lane and ends it on a named state that says which file to write.
//
//   <home>/pipeline.json     {"repo": "owner/name", "remote": "<a git url>", "host": "local"}
//   <home>/work/clone        the repository, fetched before each read
//   <home>/work/trees/<n>    ticket n's working copy, on branch lane/<n>: tests, then the build
//   <home>/work/copies/<c>   the code at commit c, plain files with no .git: what tests run in
//   <home>/work/judges/<c>   the same, with what an agent loads by itself put back as main has it:
//                            what a read-only agent sees
//   <home>/work/main-<name>  main's tip, with nothing installed, while rubrics are read from it
//   <home>/work/pulls.json   the pull requests of the lane
//
// The tree's commits stay on this machine until the push step. So what the builder does, what the
// mutation step tests and what the review reads are one local head.

type Failed = {readonly _tag: "unknown"; readonly says?: string};
const failed = (says: string): Failed => ({_tag: "unknown", says});

/**
 * Where this lane's files are: the app's home, and the folder its brief files were put in. `person`:
 * who is running it, by the id the tracker knows them by. `ignorer`: the mutation step's ignorer
 * plugin, where a bundle put it. Left out: beside its source. `shipped`: the rubrics fabrika ships,
 * where a bundle put them. Left out: beside their source.
 */
export class LaneHome extends Context.Service<
	LaneHome,
	{
		readonly home: string;
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
 * any depth, and in any case, since a Mac's disk opens `agents.md` as `AGENTS.md`.
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
	const parts = file.toLowerCase().split("/");
	return LOADED_FILES.has(parts.at(-1) ?? "") || parts.some((part) => LOADED_FOLDERS.has(part));
};

/** `<home>/pipeline.json`. `host`: `local` is a bare git remote and a file of pull requests. */
export const LaneConfig = Schema.Struct({
	/** `owner/name`: names the ticket's id, never read from a code host. */
	repo: Schema.String.check(Schema.isPattern(/^[^/\s]+\/[^/\s]+$/)),
	remote: Schema.String,
	host: Schema.Literals(["local", "github"]),
	/** The `codex` to run. Left out: `codex` on the path. */
	codex: Schema.optionalKey(Schema.String),
});
export type LaneConfig = typeof LaneConfig.Type;

const GIT = ["-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat"];
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
		readonly config: Effect.Effect<LaneConfig, Failed>;
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
		 * gone when main has none. So the head cannot tell its judge how to judge. A change to one still
		 * shows in the diff, which comes from git.
		 */
		readonly judgeCopy: (commit: string) => Effect.Effect<string, Failed>;
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
		readonly diff: (from: string, to: string) => Effect.Effect<string, Failed>;
		/** The commits after `from` up to `to`, oldest first. */
		readonly commits: (
			from: string,
			to: string,
		) => Effect.Effect<readonly {readonly sha: string; readonly title: string}[], Failed>;
		/** Whether `head` can merge onto main. */
		readonly mergeable: (head: string) => Effect.Effect<"clean" | "conflicts", Failed>;
		readonly at: (...parts: readonly string[]) => string;
	}
>()("LaneWork") {}

/** `LaneWork` on this machine: git, as a program, under `hostEnv`, and what is installed under `runEnv`. */
export const laneWork: Layer.Layer<LaneWork, never, LaneHome> = Layer.effect(
	LaneWork,
	Effect.gen(function* () {
		const {home, shipped} = yield* LaneHome;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
		const at = (...parts: readonly string[]) => path.join(home, "work", ...parts);
		const clone = at("clone");
		const on = <A, E>(effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>) =>
			Effect.provideService(effect, ChildProcessSpawner.ChildProcessSpawner, spawner);

		// `hostEnv`, as the build's git has: a remote may need the person's ssh key. No head's code runs
		// here, since hooks are off.
		const gitIn = (dir: string, args: readonly string[]) =>
			on(runChild("git", [...GIT, "-C", dir, ...args], {env: {...hostEnv(), ...IDENTITY}}));
		const said = (step: string, ran: Exited) =>
			failed(`git ${step}: ${ran.err.trim().slice(0, 300)}`);
		const git = (dir: string, args: readonly string[]) =>
			gitIn(dir, args).pipe(
				Effect.flatMap((ran) =>
					ran.code === 0 ? Effect.succeed(ran.out.trim()) : Effect.fail(said(args[0] ?? "", ran)),
				),
			);
		const inClone = (args: readonly string[]) => gitIn(clone, args);
		const lines = (out: string) => out.split("\n").filter((line) => line !== "");
		const quiet = <A, E extends {readonly message: string}>(effect: Effect.Effect<A, E>) =>
			effect.pipe(Effect.mapError((e) => failed(e.message)));

		const config = Effect.gen(function* () {
			const file = path.join(home, "pipeline.json");
			const text = yield* fs
				.readFileString(file)
				.pipe(Effect.mapError(() => failed(`write ${file}: {"repo", "remote", "host"}`)));
			return yield* Schema.decodeEffect(Schema.fromJsonString(LaneConfig))(text).pipe(
				Effect.mapError(() => failed(`${file} does not fit: {"repo", "remote", "host"}`)),
			);
		});

		const fetched = Effect.gen(function* () {
			const {remote} = yield* config;
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

		/** The code at `sha`, as plain files with no links, in `<place>/<sha>`, and `ready` run in it, once. */
		const copyTo = (
			place: string,
			sha: string,
			ready: (tree: string) => Effect.Effect<void, Failed>,
		) =>
			Effect.gen(function* () {
				const tree = at(place, sha);
				if (yield* fs.exists(path.join(tree, ".done")).pipe(Effect.orElseSucceed(() => false)))
					return yield* quiet(fs.realPath(tree));
				yield* quiet(fs.makeDirectory(tree, {recursive: true}));
				yield* unpacked(tree, sha);
				const unlinked = yield* on(
					runChild("find", [tree, "-type", "l", "-delete"], {env: runEnv()}),
				);
				if (unlinked.code !== 0)
					return yield* Effect.fail(failed(`the code at ${sha} could not be copied`));
				yield* ready(tree);
				yield* quiet(fs.writeFileString(path.join(tree, ".done"), ""));
				return yield* quiet(fs.realPath(tree));
			});

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

		// After the install, since the install runs the head's own code and it can write these too.
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
			config,
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
					return lines(
						yield* git(folder, ["diff", "--cached", "--no-renames", "--name-only", from]),
					);
				}),
			filesOf: (folder, sha) =>
				git(folder, ["show", "--no-renames", "--format=", "--name-only", sha]).pipe(
					Effect.map(lines),
				),
			listAt: (folder, sha) =>
				git(folder, ["ls-tree", "-r", "--name-only", sha]).pipe(Effect.map(lines)),
			show,
			copy,
			judgeCopy,
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
			diff: (from, to) =>
				git(clone, ["diff", "--unified=0", "--no-color", "--no-renames", from, to]),
			commits: (from, to) =>
				git(clone, ["log", "--reverse", "--format=%H%x09%s", `${from}..${to}`]).pipe(
					Effect.map((out) =>
						lines(out).map((line) => {
							const [sha = "", ...title] = line.split("\t");
							return {sha, title: title.join(" ").slice(0, 200) || "(no title)"};
						}),
					),
				),
			mergeable: (sha) =>
				gitIn(clone, ["merge-tree", "--write-tree", "origin/main", sha]).pipe(
					Effect.map((ran) => (ran.code === 0 ? ("clean" as const) : ("conflicts" as const))),
				),
			at,
		};
	}),
).pipe(Layer.provide(nodeServices));
