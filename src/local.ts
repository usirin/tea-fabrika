import {execFile} from "node:child_process";
import {access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {Effect, Layer} from "effect";
import {z} from "zod";
import {compareSurfaces, type Surface, surfaceOf} from "./declarations.ts";
import {runEnv} from "./env.ts";
import {PublishedApi, Repo, Tracker, Workspace} from "./factory-services.ts";
import type {GitHubIssue, IssueRef} from "./github.ts";
import {existingName, Issue, RawIssue} from "./issue.ts";
import type {Snapshot} from "./review.ts";
import {Jev} from "./services.ts";
import {
	bareOf,
	type Command,
	nodeTests,
	type TestFlavour,
	type TestNames,
	type TypeCheck,
	typesFor,
} from "./tests.ts";
import {Comment} from "./tracker.ts";
import {
	classify,
	classifySnippets,
	examplesOf,
	existingTestsOf,
	namedBy,
	type SnippetVerdict,
	snippetResults,
	snippetsOf,
	type TestVerdict,
	type Vetted,
} from "./vetting.ts";

interface Ran {
	readonly code: number;
	readonly output: string;
}

/** Run a program in `env` and keep its exit code. Only a program that never started rejects. */
const execIn = (env: NodeJS.ProcessEnv, cwd: string, file: string, args: readonly string[]) =>
	new Promise<Ran>((resolve, reject) => {
		execFile(file, args, {cwd, env, maxBuffer: 8 * 1024 * 1024}, (error, stdout, stderr) => {
			if (error !== null && typeof error.code !== "number") reject(error);
			else resolve({code: error === null ? 0 : (error.code as number), output: stdout + stderr});
		});
	});

/**
 * Run a program in a working copy. What runs there is code a ticket or an
 * agent wrote (a test file, an install, a typecheck), so it is handed the
 * short environment (src/env.ts) and never this process's whole one.
 */
const exec = (cwd: string, file: string, args: readonly string[]) =>
	execIn(runEnv(), cwd, file, args);

/**
 * Typecheck `files` in `dir` the flavour's way: what its setup needs is
 * written first and taken out after, so the folder is left as it was. A run
 * that failed without reporting a single type error never ran at all.
 */
async function typecheckIn(
	dir: string,
	check: TypeCheck,
	files: readonly string[],
): Promise<string> {
	const setup = check.setup(files);
	try {
		for (const [path, text] of Object.entries(setup)) await writeFile(join(dir, path), text);
		const [checker, ...flags] = check.run;
		const ran = await exec(dir, checker, flags);
		if (ran.code !== 0 && !/error TS\d+/.test(ran.output))
			throw new Error(`the typecheck did not run: ${ran.output}`);
		return ran.output;
	} finally {
		for (const path of Object.keys(setup)) await rm(join(dir, path), {force: true});
	}
}

/**
 * The checks an issue's criteria add beside its examples' tests, run in `dir`:
 * its type snippets, typechecked in their own file as prepare wrote it, and
 * each existing test, run alone. A check is passing or failing by its name;
 * one the flavour cannot run is in neither list. `output` says what failed.
 */
async function criteriaChecks(
	dir: string,
	issue: Issue,
	tests: TestFlavour,
): Promise<TestNames & {readonly output: string}> {
	const passing: string[] = [];
	const failing: string[] = [];
	const said: string[] = [];
	const check = tests.typecheck;
	if (check !== undefined && snippetsOf(issue).length > 0) {
		const errors = check.read(await typecheckIn(dir, check, [check.snippets]), check.snippets);
		const results = snippetResults(issue, typesFor(check.snippets)(issue), errors);
		passing.push(...results.passing);
		failing.push(...results.failing);
		if (results.failing.length > 0) {
			said.push(
				`Type snippets that do not hold, in ${check.snippets}:\n${errors.map((e) => `line ${e.line}: ${e.message}`).join("\n")}`,
			);
		}
	}
	for (const criterion of existingTestsOf(issue)) {
		const command = tests.runTest(criterion.test);
		if (command === null) continue;
		const [runner, ...flags] = command;
		const ran = await exec(dir, runner, flags);
		(ran.code === 0 ? passing : failing).push(existingName(criterion));
		if (ran.code !== 0)
			said.push(`The existing test ${criterion.test} fails:\n${tests.brief(ran.output)}`);
	}
	return {passing, failing, output: said.join("\n\n")};
}

/** Outputs one after the other, the empty ones left out. */
const joined = (...outputs: readonly string[]) => outputs.filter((o) => o !== "").join("\n\n");

/** Commit everything staged in `dir`, if anything is. */
async function commit(dir: string, message: string) {
	const staged = await exec(dir, "git", ["diff", "--cached", "--quiet"]);
	if (staged.code === 0) return;
	await exec(dir, "git", [
		"-c",
		"user.name=tea-fabrika",
		"-c",
		"user.email=tea-fabrika@localhost",
		"commit",
		"-q",
		"-m",
		message,
	]);
}

/**
 * The lines a staged diff touched in `file`, on the new side: each hunk header
 * `@@ -a,b +c,d @@` covers lines c to c+d-1, and a missing `d` means one line.
 */
export const touchedLines = (diff: string): number[] =>
	[...diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].flatMap((m) => {
		const from = Number(m[1]);
		const count = m[2] === undefined ? 1 : Number(m[2]);
		return Array.from({length: count}, (_, i) => from + i);
	});

/** What review needs of each changed file that still exists: its text, and the lines the diff touched. */
async function snapshotOf(dir: string, changed: readonly string[]): Promise<Snapshot> {
	const entries = await Promise.all(
		changed.map(async (file) => {
			const text = await readFile(join(dir, file), "utf8").catch(() => null);
			if (text === null) return [];
			const diff = await exec(dir, "git", ["diff", "--cached", "-U0", "HEAD", "--", file]);
			return [[file, {text, lines: touchedLines(diff.output)}] as const];
		}),
	);
	return Object.fromEntries(entries.flat());
}

export interface LocalWorkspaceOptions {
	/** The command that runs the tests: the repo's own and the issue's. Its report must read with `tests`. */
	readonly test: Command;
	/** How the issue's tests are written, run and read back. A toy's node:test file when left out. */
	readonly tests?: TestFlavour;
	/**
	 * Files the builder does not get to change, as git pathspecs. They are put
	 * back as they were committed before every test run, so editing a test to
	 * make it pass changes nothing.
	 */
	readonly protect?: readonly string[];
	/**
	 * A folder of tests the builder never sees. Its files are copied in for the
	 * test run and taken out again, so they are in neither the folder the
	 * builder reads nor the diff the judge reads.
	 */
	readonly hidden?: string;
	/**
	 * The command that installs what the tests need, run in a fresh copy before
	 * its tests, such as `pnpm install --frozen-lockfile`. Installed packages are
	 * not in git, so a repo with any needs one. A fresh copy whose install fails
	 * could not run: that is more often the network than the change.
	 */
	readonly install?: Command;
}

/**
 * A workspace on this machine: the tests run in `dir`, and the diff is
 * everything that changed since the last commit, new files included. The
 * issue's own tests are committed before the builder starts, so they are
 * locked like any protected file and never show in the diff.
 */
export function localWorkspace(dir: string, options: LocalWorkspaceOptions) {
	const [file, ...args] = options.test;
	const tests = options.tests ?? nodeTests;
	const protect = [
		...(options.protect ?? []),
		tests.file,
		...(tests.typecheck === undefined ? [] : [tests.typecheck.snippets]),
	];
	return Layer.succeed(Workspace, {
		testCommand: options.test.join(" "),
		// HEAD is where the change started: the builder's work is never committed until it is sealed.
		baseFiles: () =>
			Effect.tryPromise({
				try: async () => {
					const all = (await git(dir, "ls-tree", "-r", "--name-only", "HEAD")).split("\n");
					const locked = new Set(
						(await git(dir, "ls-tree", "-r", "--name-only", "HEAD", "--", ...protect)).split("\n"),
					);
					return all.filter((path) => path !== "" && !locked.has(path));
				},
				catch: () => ({_tag: "could_not_run" as const}),
			}),
		baseFile: (path) =>
			Effect.tryPromise({
				try: () => git(dir, "show", `HEAD:${path}`),
				catch: () => ({_tag: "could_not_run" as const}),
			}),
		// The builder's work is the folder itself.
		currentFile: (path) =>
			Effect.tryPromise({
				try: () =>
					readFile(join(dir, path), "utf8").catch((error: NodeJS.ErrnoException) => {
						if (error.code === "ENOENT") return "";
						throw error;
					}),
				catch: () => ({_tag: "could_not_run" as const}),
			}),
		vet: (issue) =>
			Effect.tryPromise({
				try: () => vetAtHead(dir, issue, options),
				catch: () => ({_tag: "could_not_run" as const}),
			}),
		prepare: (issue) =>
			Effect.tryPromise({
				try: async () => {
					const written = await writeIssueFiles(dir, issue, tests);
					await exec(dir, "git", ["add", ...written.map((w) => w.path)]);
					await commit(dir, "the issue's tests");
					const [runner, ...flags] = tests.run;
					const ran = examplesOf(issue).length === 0 ? null : await exec(dir, runner, flags);
					const own = ran === null ? {passing: [], failing: []} : tests.read(ran.output);
					const more = await criteriaChecks(dir, issue, tests);
					return {
						passing: [...own.passing, ...more.passing],
						failing: [...own.failing, ...more.failing],
						output: joined(ran === null ? "" : tests.brief(ran.output), more.output),
					};
				},
				catch: () => ({_tag: "could_not_run" as const}),
			}),
		check: (issue) =>
			Effect.tryPromise({
				try: async () => {
					const changed = await exec(dir, "git", ["diff", "--name-only", "HEAD", "--", ...protect]);
					const touched = changed.output.split("\n").filter((line) => line !== "");
					// Only what HEAD holds can be put back: an issue with no examples has no examples' file.
					const locked = (await git(dir, "ls-tree", "-r", "--name-only", "HEAD", "--", ...protect))
						.split("\n")
						.filter((p) => p !== "");
					if (locked.length > 0) await exec(dir, "git", ["checkout", "HEAD", "--", ...locked]);
					const hidden =
						options.hidden === undefined ? [] : await readdir(options.hidden, {recursive: true});
					if (options.hidden !== undefined) {
						await cp(options.hidden, dir, {recursive: true});
					}
					const ran = await exec(dir, file, args);
					// The type snippets and existing tests are run on their own too: the repo's command may not reach them.
					const more = await criteriaChecks(dir, issue, tests);
					for (const path of hidden) {
						await rm(join(dir, path), {recursive: true, force: true});
					}
					await exec(dir, "git", ["add", "-A"]);
					const diff = await exec(dir, "git", ["diff", "--cached", "HEAD"]);
					const names = await exec(dir, "git", ["diff", "--cached", "--name-only", "HEAD"]);
					const files = names.output.split("\n").filter((line) => line !== "");
					return {
						passed: ran.code === 0 && more.failing.length === 0,
						output: joined(tests.brief(ran.output), more.output),
						diff: diff.output,
						passingTests: [...tests.read(ran.output).passing, ...more.passing],
						touched,
						changed: files,
						snapshot: await snapshotOf(dir, files),
					};
				},
				catch: () => ({_tag: "could_not_run" as const}),
			}),
		freshCheck: (issue) =>
			Effect.tryPromise({
				try: async () =>
					freshRun(dir, await sealIndex(dir, "the change, for a fresh check"), options, issue),
				catch: () => ({_tag: "could_not_run" as const}),
			}),
	});
}

/**
 * Write the files an issue's checks are made of into `dir`: its examples'
 * tests when it has examples (a test file with none fails to load), and its
 * type snippets when it has any and the flavour can typecheck them, with the
 * bare copy beside them when `bare`. Hands back what was written, and where.
 */
async function writeIssueFiles(
	dir: string,
	issue: Issue,
	tests: TestFlavour,
	bare = false,
): Promise<readonly {readonly path: string; readonly text: string}[]> {
	const snippets = tests.typecheck?.snippets;
	const files = [
		...(examplesOf(issue).length === 0 ? [] : [{path: tests.file, text: tests.write(issue)}]),
		...(snippets === undefined || snippetsOf(issue).length === 0
			? []
			: [
					{path: snippets, text: typesFor(snippets)(issue)},
					...(bare
						? [{path: bareOf(snippets), text: typesFor(bareOf(snippets))(issue, true)}]
						: []),
				]),
	];
	for (const {path, text} of files) {
		await mkdir(dirname(join(dir, path)), {recursive: true});
		await writeFile(join(dir, path), text);
	}
	return files;
}

/** Run git and hand back its output, or throw with it: for the steps where any failure is the step's. */
async function git(dir: string, ...args: string[]): Promise<string> {
	const ran = await exec(dir, "git", [
		"-c",
		"user.name=tea-fabrika",
		"-c",
		"user.email=tea-fabrika@localhost",
		...args,
	]);
	if (ran.code !== 0) throw new Error(ran.output);
	return ran.output.trim();
}

/**
 * The change as git holds it, committed on top of HEAD without moving the
 * branch: review still reads the whole change against where it started.
 */
async function sealIndex(dir: string, message: string): Promise<string> {
	await git(dir, "add", "-A");
	return git(dir, "commit-tree", await git(dir, "write-tree"), "-p", "HEAD", "-m", message);
}

/**
 * Check one commit out into an empty folder, install what it needs, and hand
 * the folder to `work`. The folder and git's record of it are gone afterwards,
 * whatever `work` did; `dir` and its branch are never touched.
 */
async function inFreshCopy<A>(
	dir: string,
	sha: string,
	install: Command | undefined,
	work: (fresh: string) => Promise<A>,
): Promise<A> {
	const fresh = await mkdtemp(join(tmpdir(), "tea-fabrika-fresh-"));
	try {
		await git(dir, "worktree", "add", "-q", "--detach", fresh, sha);
		if (install !== undefined) {
			const [installer, ...flags] = install;
			const installed = await exec(fresh, installer, flags);
			if (installed.code !== 0) throw new Error(installed.output);
		}
		return await work(fresh);
	} finally {
		await exec(dir, "git", ["worktree", "remove", "--force", fresh]);
		await rm(fresh, {recursive: true, force: true});
	}
}

/**
 * Check one commit out into an empty folder, install, add the hidden tests,
 * and run the tests there; with an issue, its type snippets and existing tests too.
 */
function freshRun(
	dir: string,
	sha: string,
	options: LocalWorkspaceOptions,
	issue: Issue | null = null,
) {
	const [file, ...args] = options.test;
	const tests = options.tests ?? nodeTests;
	return inFreshCopy(dir, sha, options.install, async (fresh) => {
		if (options.hidden !== undefined) await cp(options.hidden, fresh, {recursive: true});
		const ran = await exec(fresh, file, args);
		const more =
			issue === null ? {failing: [], output: ""} : await criteriaChecks(fresh, issue, tests);
		return {
			passed: ran.code === 0 && more.failing.length === 0,
			output: joined(tests.brief(ran.output), more.output),
		};
	});
}

/** How long a failing existing test's run may be when vetting keeps it. */
const KEPT_RUN = 2000;

/**
 * Vet a draft on HEAD, in a fresh copy: the files its criteria name that HEAD
 * does not hold; each example written the way `tests` writes it, typechecked
 * when the flavour can, and run; each type snippet typechecked, as written
 * and bare; and each existing test that is at HEAD run alone. An issue with
 * nothing to run needs no copy.
 */
async function vetAtHead(
	dir: string,
	issue: Issue,
	options: LocalWorkspaceOptions,
): Promise<Vetted> {
	const tests = options.tests ?? nodeTests;
	const atHead = new Set((await git(dir, "ls-tree", "-r", "--name-only", "HEAD")).split("\n"));
	const missing = namedBy(issue).filter((n) => !atHead.has(n.file));
	const existing = existingTestsOf(issue).filter((c) => atHead.has(c.test));
	const nothing = {missing, examples: [], snippets: [], tests: []};
	if (examplesOf(issue).length === 0 && snippetsOf(issue).length === 0 && existing.length === 0)
		return nothing;
	return inFreshCopy(
		dir,
		await git(dir, "rev-parse", "HEAD"),
		options.install,
		async (fresh): Promise<Vetted> => {
			const written = await writeIssueFiles(fresh, issue, tests, true);
			const check = tests.typecheck;
			const typed =
				check === undefined || written.length === 0
					? ""
					: await typecheckIn(
							fresh,
							check,
							written.map((w) => w.path),
						);
			const textOf = (path: string) => written.find((w) => w.path === path)?.text ?? "";
			let examples: Vetted["examples"] = [];
			if (examplesOf(issue).length > 0) {
				const [runner, ...flags] = tests.run;
				const ran = await exec(fresh, runner, flags);
				examples = classify(
					issue,
					textOf(tests.file),
					tests.outcomes(ran.output),
					check?.read(typed, tests.file) ?? [],
				);
			}
			const snippets: readonly SnippetVerdict[] =
				check === undefined
					? snippetsOf(issue).map((s) => ({
							criterion: s.criterion,
							snippet: s.snippet,
							verdict: "broken" as const,
							detail: "cannot be checked: this repo is not typechecked here",
						}))
					: classifySnippets(issue, {
							written: textOf(check.snippets),
							errors: check.read(typed, check.snippets),
							bare: check.read(typed, bareOf(check.snippets)),
						});
			const ran: TestVerdict[] = [];
			for (const criterion of existing) {
				const verdict = {criterion: criterion.id, test: criterion.test};
				const command = tests.runTest(criterion.test);
				if (command === null) {
					ran.push({
						...verdict,
						verdict: "cannot_run",
						detail:
							"the workspace runs no test there; it may be outside the package the lane works in",
					});
					continue;
				}
				const [runner, ...flags] = command;
				const run = await exec(fresh, runner, flags);
				ran.push(
					run.code === 0
						? {...verdict, verdict: "passes", detail: ""}
						: {...verdict, verdict: "fails", detail: tests.brief(run.output).slice(-KEPT_RUN)},
				);
			}
			return {missing, examples, snippets, tests: ran};
		},
	);
}

/**
 * The compiler, asked for declaration files only, without comments, into
 * `out`: run in the package's folder with its own tsconfig and its own
 * TypeScript. A type error does not stop the emit, so the exit code is not read.
 */
const DECLARATIONS: Command = [
	"pnpm",
	"exec",
	"tsc",
	"-p",
	"tsconfig.json",
	"--noEmit",
	"false",
	"--declaration",
	"--emitDeclarationOnly",
	"--removeComments",
	"--outDir",
];

/** What a package in `root` publishes, from a declaration emit into a throwaway folder. */
async function emitSurface(root: string, pkg: string, emit: Command): Promise<Surface> {
	const out = await mkdtemp(join(tmpdir(), "tea-fabrika-api-"));
	try {
		const [file, ...args] = emit;
		await exec(join(root, pkg), file, [...args, out]);
		const manifest = JSON.parse(await readFile(join(root, pkg, "package.json"), "utf8")) as {
			readonly exports?: unknown;
		};
		const surface = await surfaceOf(manifest.exports, out);
		if (surface.size === 0)
			throw new Error(`no export-map entry of ${pkg} has a declaration file in the emit`);
		return surface;
	} finally {
		await rm(out, {recursive: true, force: true});
	}
}

/**
 * The published-API check on this machine, for the package `pkg` (relative
 * to `dir`): its surface where the change started, emitted once per HEAD in a
 * fresh copy, against its surface in the builder's folder as it is.
 * `emit` is the declaration emit, the folder last; {@link DECLARATIONS} by default.
 */
export function localPublishedApi(
	dir: string,
	options: {readonly package: string; readonly install?: Command; readonly emit?: Command},
) {
	const emit = options.emit ?? DECLARATIONS;
	let atHead: {readonly sha: string; readonly surface: Surface} | null = null;
	return Layer.succeed(PublishedApi, {
		diff: () =>
			Effect.tryPromise({
				try: async () => {
					const sha = await git(dir, "rev-parse", "HEAD");
					if (atHead?.sha !== sha) {
						const surface = await inFreshCopy(dir, sha, options.install, (fresh) =>
							emitSurface(fresh, options.package, emit),
						);
						atHead = {sha, surface};
					}
					const changes = compareSurfaces(
						atHead.surface,
						await emitSurface(dir, options.package, emit),
					);
					return {kind: "compared" as const, package: options.package, changes};
				},
				catch: (error) => ({
					kind: "skipped" as const,
					why: `the declaration emit failed: ${String(error).split("\n")[0]}`,
				}),
			}).pipe(
				// A check that could not run is an answer too, not a failure of the machine.
				Effect.catch((skipped) => Effect.succeed(skipped)),
			),
	});
}

/** Where the sealed change is kept, so git never collects it before it lands. */
const SEALED = "refs/tea-fabrika/sealed";

/**
 * The repo on this machine. The builder works on its own branch in `dir`;
 * `base` is the branch the change lands in, and nobody has it checked out, so
 * moving it disturbs no folder.
 */
export function localRepo(dir: string, options: LocalWorkspaceOptions & {readonly base: string}) {
	const base = `refs/heads/${options.base}`;
	const failed = () => ({_tag: "repo_failed" as const});
	return Layer.succeed(Repo, {
		seal: (message) =>
			Effect.tryPromise({
				try: async () => {
					const head = await sealIndex(dir, message);
					await git(dir, "update-ref", SEALED, head);
					return {head, stat: await git(dir, "diff", "--stat", base, head)};
				},
				catch: failed,
			}),
		land: (head) =>
			Effect.tryPromise({
				try: async () => {
					const tip = await git(dir, "rev-parse", base);
					const holds = await exec(dir, "git", ["merge-base", "--is-ancestor", tip, head]);
					if (holds.code !== 0) return {kind: "behind" as const};
					// Moves the base only if it is still where it was read: a base that moved meanwhile fails, and is read again.
					await git(dir, "update-ref", base, head, tip);
					return {kind: "landed" as const, sha: head};
				},
				catch: failed,
			}),
		catchUp: (head) =>
			Effect.tryPromise({
				try: async () => {
					const merged = await exec(dir, "git", [
						"merge-tree",
						"--write-tree",
						"--name-only",
						base,
						head,
					]);
					// Exit 1 is a conflict: the tree, then the conflicted files, then a blank line and git's messages.
					const [tree = "", ...rest] = merged.output.split("\n");
					if (merged.code === 1) {
						const files = rest
							.slice(0, rest.indexOf("") === -1 ? undefined : rest.indexOf(""))
							.filter((f) => f !== "");
						return {kind: "conflicted" as const, files};
					}
					if (merged.code !== 0) throw new Error(merged.output);
					const merge = await git(
						dir,
						"commit-tree",
						tree.trim(),
						"-p",
						head,
						"-p",
						base,
						"-m",
						`Merge ${options.base}`,
					);
					return {kind: "merged" as const, head: merge};
				},
				catch: failed,
			}),
		retest: (head) =>
			Effect.tryPromise({
				try: () => freshRun(dir, head, options),
				catch: failed,
			}),
	});
}

/** The branch a toy's changes land in. */
export const TOY_BASE = "main";

export interface Toy {
	/** The fresh folder the builder works in. */
	readonly dir: string;
	/** The issue as somebody filed it. Triage starts here. */
	readonly raw: RawIssue;
	/** A hand-written rewrite of it, for runs with no real enricher. */
	readonly issue: Issue;
	/** The toy's hidden tests, if it has any. */
	readonly hidden: string | undefined;
}

/**
 * Check a toy out of `fixtures/<name>/`: `repo/` is copied into a fresh folder
 * and committed as the base, `raw.json` and `issue.json` are the work before
 * and after triage, and `hidden/` holds the tests the builder does not get to read.
 * `without` names files of `repo/` to leave out, for a run nobody may read them in.
 */
export async function checkoutToy(
	name: string,
	options: {readonly without?: readonly string[]} = {},
): Promise<Toy> {
	const fixture = join(import.meta.dirname, "..", "fixtures", name);
	const dir = await mkdtemp(join(tmpdir(), `tea-fabrika-${name}-`));
	await cp(join(fixture, "repo"), dir, {recursive: true});
	// Left out before the first commit, so the files are not in the history either.
	for (const file of options.without ?? []) await rm(join(dir, file), {force: true});
	await exec(dir, "git", ["init", "-q", "-b", TOY_BASE]);
	await exec(dir, "git", ["add", "-A"]);
	await commit(dir, "base");
	// The builder works on a branch of its own; the change lands in the base when it ships.
	await exec(dir, "git", ["checkout", "-q", "-b", "lane"]);
	return openToy(name, dir);
}

/** A toy already checked out in `dir`, as a run that was stopped finds it again. */
export async function openToy(name: string, dir: string): Promise<Toy> {
	const fixture = join(import.meta.dirname, "..", "fixtures", name);
	const read = async (file: string) =>
		JSON.parse(await readFile(join(fixture, file), "utf8")) as unknown;
	const hidden = await access(join(fixture, "hidden")).then(
		() => join(fixture, "hidden"),
		() => undefined,
	);
	return {
		dir,
		raw: RawIssue.parse(await read("raw.json")),
		issue: Issue.parse(await read("issue.json")),
		hidden,
	};
}

/** One ticket as a file tracker keeps it: what was filed, and the comments under it. */
export const TicketFile = RawIssue.omit({id: true}).extend({
	comments: z.array(Comment).default([]),
});
export type TicketFile = z.input<typeof TicketFile>;

/**
 * A tracker kept in a folder: one `<issue id>.json` per ticket, holding the
 * ticket and its comments, the way an issue holds both on GitHub. A person
 * edits the file to comment. A missing or unreadable file is a failure, never
 * "no comments": the lane must not finish on a misread.
 */
export function fileTracker(dir: string) {
	const read = (issue: string) =>
		Effect.tryPromise({
			try: async () =>
				TicketFile.parse(JSON.parse(await readFile(join(dir, `${issue}.json`), "utf8"))),
			catch: () => ({_tag: "tracker_failed" as const}),
		});
	return Layer.succeed(Tracker, {
		ticket: (issue) =>
			read(issue).pipe(Effect.map(({title, body, filedBy}) => ({id: issue, title, body, filedBy}))),
		comments: (issue) => read(issue).pipe(Effect.map((ticket) => ticket.comments)),
	});
}

/** Put a ticket into a file tracker's folder, unless it is there already: a kept run keeps its comments. */
export async function seedTicket(dir: string, raw: RawIssue): Promise<void> {
	await mkdir(dir, {recursive: true});
	const {id, ...filed} = raw;
	const ticket: TicketFile = {...filed, comments: []};
	await writeFile(join(dir, `${id}.json`), `${JSON.stringify(ticket, null, 2)}\n`, {
		flag: "wx",
	}).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "EEXIST") throw error;
	});
}

/**
 * One GitHub issue, read with `gh`. Read-only: nothing is ever written back.
 * It is this process's own read and runs no code from a working copy, so `gh`
 * keeps this process's environment: its login may be a variable there.
 */
export async function githubIssue(ref: IssueRef): Promise<GitHubIssue> {
	const ran = await execIn(process.env, ".", "gh", [
		"issue",
		"view",
		String(ref.number),
		"-R",
		ref.repo,
		"--json",
		"title,body,author",
	]);
	if (ran.code !== 0) throw new Error(`gh could not read ${ref.repo}#${ref.number}: ${ran.output}`);
	return JSON.parse(ran.output) as GitHubIssue;
}

/**
 * A branch a change can land in: it exists, and no folder has it checked out,
 * so moving it disturbs nobody's files. Throws with why otherwise.
 */
export async function checkBase(dir: string, base: string): Promise<void> {
	await git(dir, "rev-parse", "--verify", "--quiet", `refs/heads/${base}`).catch(() => {
		throw new Error(`there is no branch ${base} in ${dir}`);
	});
	const worktrees = await git(dir, "worktree", "list", "--porcelain");
	if (worktrees.split("\n").includes(`branch refs/heads/${base}`)) {
		throw new Error(
			`${base} is checked out in a folder; the base must be a branch nobody has checked out`,
		);
	}
}

/** Whether `dir` has nothing uncommitted: a run starts from a clean folder, so the diff is only the builder's. */
export async function isClean(dir: string): Promise<boolean> {
	return (await git(dir, "status", "--porcelain")) === "";
}

/** Jev over HTTP. The key stays in this Layer and never reaches the machine. */
export function liveJev(key: string, endpoint: string) {
	return Layer.succeed(Jev, {
		call: (request) =>
			Effect.tryPromise({
				try: async () => {
					const response = await fetch(endpoint, {
						method: "POST",
						headers: {
							authorization: `Bearer ${key}`,
							"content-type": "application/json",
						},
						body: JSON.stringify(request),
					});
					return {
						status: response.status,
						body: await response.json().catch(() => ({})),
					};
				},
				catch: (cause) => ({_tag: "jev_call_failed" as const, cause}),
			}),
	});
}
