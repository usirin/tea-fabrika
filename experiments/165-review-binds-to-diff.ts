// Experiment 165: should a review verdict be tied to the PR's diff instead of its head commit?
// The diff's name is `git patch-id --stable` of the PR's whole diff against the point where it
// left main. Does that name stay the same when it should, and change when it must?
//
// Run with
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 \
//     node experiments/165-review-binds-to-diff.ts          # every part
//   ... node experiments/165-review-binds-to-diff.ts cases    # parts 1 to 4 only, no network
//   ... node experiments/165-review-binds-to-diff.ts real     # part 5 only
//   ... node experiments/165-review-binds-to-diff.ts gen      # part 6a only, no network
//   ... node experiments/165-review-binds-to-diff.ts stack    # part 6b only, no network
//
// Parts 1 to 4 build throwaway git repos in one temp folder and remove it at the end.
// Part 6 makes cases with fast-check (seed 165; RUNS=<n> cases for 6a, 2000 by default,
// STACK_RUNS=<n> for 6b, 600 by default). 6a stores them in one bare repo, 6b restacks them with
// `git rebase` in one work repo; each in a temp folder, removed at the end. Each wrong "same" it
// finds is found again by fc.check and shrunk to the smallest case.
// `results/165-review-binds-to-diff-gen.json` and `-stack.json` hold part 6's counts.
// Part 5 clones https://github.com/usirin/tea-fabrika into a temp folder (removed at the end; WORK=<dir>
// keeps it there instead), fetches every PR head and every force-pushed-away commit it can, and
// reads the PR list and force-push events through `gh` (read-only).
// `results/165-review-binds-to-diff.json` holds part 5's rows.
//
// No model, no key, $0. Every git call runs with the user's own git config switched off, so
// settings like `diff.renames` cannot change an answer.
//
// Node at the edge, said out loud: `node:child_process` for `git` and `gh`, `node:fs` for the
// temp repos and the result file.
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import * as fc from "fast-check";

const here = import.meta.dirname;
/** The repo part 5 reads. REPO=<another GitHub URL> reads another one. */
const REPO = process.env.REPO ?? "https://github.com/usirin/tea-fabrika";
const RESULTS = join(here, "results", "165-review-binds-to-diff.json");
const GEN_RESULTS = join(here, "results", "165-review-binds-to-diff-gen.json");
const STACK_RESULTS = join(here, "results", "165-review-binds-to-diff-stack.json");

// ---------------------------------------------------------------- running git

const ENV = {
	...process.env,
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "exp",
	GIT_AUTHOR_EMAIL: "exp@example.com",
	GIT_COMMITTER_NAME: "exp",
	GIT_COMMITTER_EMAIL: "exp@example.com",
	GIT_TERMINAL_PROMPT: "0",
};

type Ran = {ok: boolean; out: string; err: string};

const sh = (
	cmd: string,
	args: readonly string[],
	cwd: string,
	input?: string,
	env: NodeJS.ProcessEnv = ENV,
): Ran => {
	const r = spawnSync(cmd, args, {cwd, input, env, encoding: "utf8", maxBuffer: 1 << 28});
	return {ok: r.status === 0, out: r.stdout ?? "", err: r.stderr ?? ""};
};

const git = (cwd: string, ...args: string[]): string => {
	const r = sh("git", args, cwd);
	if (!r.ok) throw new Error(`git ${args.join(" ")}: ${r.err.slice(0, 300)}`);
	return r.out.trim();
};

// ---------------------------------------------------------------- the id

/**
 * Five ways to name a diff. `stable` is the proposal. The others show what each knob buys:
 * `verbatim` keeps whitespace (patch-id drops it by default), `u0` drops the context lines,
 * `u0v` does both. `fn` is not patch-id: a sha256 of the `-U0` diff with whitespace kept, the
 * line numbers dropped from each `@@` line, and the function name git prints after it kept.
 */
const WAYS = {
	stable: {diff: [], id: ["--stable"]},
	// `--verbatim` implies `--stable`; git 2.40 refuses the two together.
	verbatim: {diff: [], id: ["--verbatim"]},
	u0: {diff: ["-U0"], id: ["--stable"]},
	u0v: {diff: ["-U0"], id: ["--verbatim"]},
	fn: {diff: ["-U0"], id: []},
} as const;
type Way = keyof typeof WAYS;
const WAY_NAMES: readonly Way[] = ["stable", "verbatim", "u0", "u0v", "fn"];
/** The five ids, then the replay check (below). */
type Column = Way | "replay";
const ALL: readonly Column[] = [...WAY_NAMES, "replay"];

const DIFF = ["diff", "--no-color", "--no-ext-diff", "--full-index", "--binary", "-M"];

/** `fn`: drop `index` lines and hunk line numbers, keep everything else, hash it. */
const fnId = (diff: string) =>
	createHash("sha256")
		.update(
			diff
				.split("\n")
				.filter((l) => !l.startsWith("index "))
				.map((l) => l.replace(/^@@ [^@]* @@/, "@@"))
				.join("\n"),
		)
		.digest("hex");

/** The id of `base..head`, or `empty` when the diff has no lines. */
const patchId = (cwd: string, base: string, head: string, way: Way, diffArgs = DIFF): string => {
	const diff = git(cwd, ...diffArgs, ...WAYS[way].diff, base, head);
	if (diff === "") return "empty";
	if (way === "fn") return fnId(diff);
	const r = sh("git", ["patch-id", ...WAYS[way].id], cwd, `${diff}\n`);
	if (!r.ok) throw new Error(`patch-id: ${r.err}`);
	const id = r.out.trim().split(" ")[0] ?? "";
	return id === "" ? "empty" : id;
};

const mergeBase = (cwd: string, a: string, b: string) => git(cwd, "merge-base", a, b);

/** The proposal: the PR's whole diff against the point where it left main. */
const diffId = (cwd: string, head: string, way: Way, main = "main") =>
	patchId(cwd, mergeBase(cwd, main, head), head, way);

/**
 * Not an id but a check between two versions: is `b` exactly what a clean replay of the reviewed
 * `a` onto `b`'s base gives? `git merge-tree` (git 2.40 for `--merge-base`) applies `baseA..a` on
 * `baseB` without a work tree. A conflict is a no. Close to Gerrit's TRIVIAL_REBASE.
 */
const replays = (cwd: string, a: string, baseA: string, b: string, baseB: string) => {
	const r = sh("git", ["merge-tree", "--write-tree", `--merge-base=${baseA}`, baseB, a], cwd);
	if (!r.ok) return false;
	return (r.out.split("\n")[0] ?? "").trim() === git(cwd, "rev-parse", `${b}^{tree}`);
};

/** `replays`, with both bases taken from main. */
const replaysOnMain = (cwd: string, a: string, b: string) =>
	replays(cwd, a, mergeBase(cwd, "main", a), b, mergeBase(cwd, "main", b));

/** What `git range-diff` says of two versions of a branch: `n of m` commits paired as equal. */
const rangeDiff = (cwd: string, a: string, b: string, main = "main") =>
	rangeBetween(cwd, mergeBase(cwd, main, a), a, mergeBase(cwd, main, b), b);

/** `rangeDiff`, with each version's base given. */
const rangeBetween = (cwd: string, baseA: string, a: string, baseB: string, b: string) => {
	// range-diff refuses an empty range. A side with no commits pairs nothing with the other.
	if (baseA === a || baseB === b) {
		const n = Number(
			git(cwd, "rev-list", "--count", baseA === a ? `${baseB}..${b}` : `${baseA}..${a}`),
		);
		return `0 of ${Math.max(n, 1)} =`;
	}
	const out = git(cwd, "range-diff", "--no-color", `${baseA}..${a}`, `${baseB}..${b}`);
	const lines = out.split("\n").filter((l) => /^\s*(\d+|-):\s+\S+\s+[=!<>]/.test(l));
	const same = lines.filter((l) => /^\s*\d+:\s+\S+\s+=/.test(l)).length;
	return `${same} of ${lines.length} =`;
};

// ---------------------------------------------------------------- throwaway repos

const LIB = [
	"export function add(a, b) {",
	"\treturn a + b;",
	"}",
	"",
	"export function sub(a, b) {",
	"\treturn a - b;",
	"}",
	"",
	"export function mul(a, b) {",
	"\treturn a * b;",
	"}",
	"",
	"export function div(a, b) {",
	"\treturn a / b;",
	"}",
	"",
	"export function greet(name) {",
	'\treturn "hello " + name;',
	"}",
	"",
].join("\n");

const CONFIG = ["server:", "  port: 8080", "  debug: false", ""].join("\n");

let root = "";
let count = 0;

/** A fresh repo with `lib.js`, `config.yaml`, `other.txt` and a binary `logo.bin` on main. */
const freshRepo = () => {
	count += 1;
	const dir = join(root, `case-${count}`);
	mkdirSync(dir);
	git(dir, "init", "-q", "-b", "main");
	put(dir, "lib.js", LIB);
	put(dir, "config.yaml", CONFIG);
	put(dir, "other.txt", "one\n");
	writeFileSync(join(dir, "logo.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
	commit(dir, "base");
	return dir;
};

const put = (dir: string, file: string, text: string) => {
	mkdirSync(dirname(join(dir, file)), {recursive: true});
	writeFileSync(join(dir, file), text);
};

const edit = (dir: string, file: string, from: string, to: string) => {
	const text = readFileSync(join(dir, file), "utf8");
	if (!text.includes(from)) throw new Error(`${file} has no ${JSON.stringify(from)}`);
	put(dir, file, text.replace(from, to));
};

const commit = (dir: string, msg: string) => {
	git(dir, "add", "-A");
	git(dir, "commit", "-q", "--allow-empty", "-m", msg);
	return git(dir, "rev-parse", "HEAD");
};

const on = (dir: string, ref: string) => git(dir, "checkout", "-q", ref);

/** Start a PR branch at main. */
const branch = (dir: string, name: string) => git(dir, "checkout", "-q", "-B", name, "main");

/** Rebase the current branch onto main; throws on a conflict. */
const rebase = (dir: string) => {
	git(dir, "rebase", "-q", "main");
	return git(dir, "rev-parse", "HEAD");
};

/** The cases where git stopped a rebase as a conflict, by name. */
const conflicted = new Set<string>();

/**
 * Rebase onto main; on a conflict, make the PR again on main with `redo`, the way a person
 * resolving it by keeping both sides would, and note the case.
 */
const rebaseOrRedo = (dir: string, name: string, redo: () => void) => {
	if (sh("git", ["rebase", "-q", "main"], dir).ok) return git(dir, "rev-parse", "HEAD");
	git(dir, "rebase", "--abort");
	conflicted.add(name);
	git(dir, "checkout", "-q", "-B", "pr", "main");
	redo();
	return commit(dir, "redone on main");
};

/** Move main by one commit made by `change`, then come back to `back`. */
const moveMain = (dir: string, back: string, change: () => void, msg = "main moves") => {
	on(dir, "main");
	change();
	commit(dir, msg);
	on(dir, back);
};

// The PR used by most cases: a guard in `div`.
const GUARD = '\tif (b === 0) throw new Error("divide by zero");\n\treturn a / b;';
const prGuard = (dir: string) => {
	branch(dir, "pr");
	edit(dir, "lib.js", "\treturn a / b;", GUARD);
	return commit(dir, "guard div");
};

type Expect = "same" | "changed";
type Case = {
	group: 1 | 2 | 3;
	name: string;
	expect: Expect;
	dir: string;
	a: string;
	b: string;
};

const cases = (): Case[] => {
	const out: Case[] = [];
	const add = (c: Case) => out.push(c);

	// ---- 1. kept when it should be

	{
		const dir = freshRepo();
		const a = prGuard(dir);
		moveMain(dir, "pr", () => put(dir, "other.txt", "one\ntwo\n"));
		add({
			group: 1,
			name: "rebase, main changed another file",
			expect: "same",
			dir,
			a,
			b: rebase(dir),
		});
	}
	{
		const dir = freshRepo();
		const a = prGuard(dir);
		moveMain(dir, "pr", () =>
			edit(dir, "lib.js", "\treturn a + b;", "\t// adds two numbers\n\treturn a + b;"),
		);
		add({
			group: 1,
			name: "rebase, main changed the same file 12 lines up",
			expect: "same",
			dir,
			a,
			b: rebase(dir),
		});
	}
	{
		const dir = freshRepo();
		branch(dir, "pr");
		edit(dir, "lib.js", "\treturn a / b;", GUARD);
		commit(dir, "guard div");
		edit(dir, "lib.js", "\treturn a * b;", "\treturn Math.imul(a, b);");
		commit(dir, "imul");
		put(dir, "notes.md", "# notes\n");
		commit(dir, "notes");
		edit(dir, "lib.js", "\treturn a - b;", "\treturn a - b; // sub");
		const a = commit(dir, "comment");
		const base = mergeBase(dir, "main", a);
		git(dir, "reset", "-q", "--soft", base);
		add({group: 1, name: "squash 4 commits into 1", expect: "same", dir, a, b: commit(dir, "one")});
	}
	{
		const dir = freshRepo();
		const a = prGuard(dir);
		let b = a;
		for (const n of [1, 2, 3]) {
			moveMain(dir, "pr", () => put(dir, `main-${n}.txt`, `${n}\n`));
			b = rebase(dir);
			add({
				group: 1,
				name: `rebase ${n} of 3 in a row, against the first`,
				expect: "same",
				dir,
				a,
				b,
			});
		}
	}
	{
		const dir = freshRepo();
		const a = prGuard(dir);
		git(dir, "commit", "-q", "--amend", "-m", "guard div, better words");
		add({
			group: 1,
			name: "amend the message only",
			expect: "same",
			dir,
			a,
			b: git(dir, "rev-parse", "HEAD"),
		});
	}
	{
		const dir = freshRepo();
		branch(dir, "pr");
		edit(dir, "lib.js", "\treturn a / b;", GUARD);
		commit(dir, "guard div");
		put(dir, "notes.md", "# notes\n");
		const a = commit(dir, "notes");
		moveMain(dir, "pr", () => put(dir, "other.txt", "one\ntwo\n"));
		rebase(dir);
		git(dir, "reset", "-q", "--soft", "main");
		add({
			group: 1,
			name: "rebase and squash at once",
			expect: "same",
			dir,
			a,
			b: commit(dir, "one"),
		});
	}

	// ---- 2. lost when it should be

	{
		const dir = freshRepo();
		const a = prGuard(dir);
		edit(dir, "lib.js", "b === 0", "b === 0 || b === undefined");
		git(dir, "add", "-A");
		git(dir, "commit", "-q", "--amend", "--no-edit");
		add({
			group: 2,
			name: "force-push a real code change",
			expect: "changed",
			dir,
			a,
			b: git(dir, "rev-parse", "HEAD"),
		});
	}
	{
		const dir = freshRepo();
		const a = prGuard(dir);
		edit(dir, "lib.js", "divide by zero", "divide by 0");
		git(dir, "add", "-A");
		git(dir, "commit", "-q", "--amend", "--no-edit");
		add({
			group: 2,
			name: "force-push one word in a string",
			expect: "changed",
			dir,
			a,
			b: git(dir, "rev-parse", "HEAD"),
		});
	}
	{
		const dir = freshRepo();
		const a = prGuard(dir);
		put(dir, "extra.js", "export const x = 1;\n");
		add({
			group: 2,
			name: "force-push with one more file",
			expect: "changed",
			dir,
			a,
			b: commit(dir, "extra"),
		});
	}
	{
		// Both sides change the line `return a * b;`. The rebase has to pick.
		const dir = freshRepo();
		branch(dir, "pr");
		edit(dir, "lib.js", "\treturn a * b;", "\treturn Math.imul(a, b);");
		const a = commit(dir, "imul");
		moveMain(dir, "pr", () => edit(dir, "lib.js", "\treturn a * b;", "\treturn a * b; // fast"));
		const keepBoth = (text: string) => {
			on(dir, "main");
			git(dir, "checkout", "-q", "-B", "pr");
			edit(dir, "lib.js", "\treturn a * b; // fast", text);
			return commit(dir, "imul, rebased");
		};
		const b = keepBoth("\treturn Math.imul(a, b); // fast");
		const c = keepBoth("\treturn Math.imul(a, b);");
		add({
			group: 2,
			name: "conflict resolved, against before the rebase",
			expect: "changed",
			dir,
			a,
			b,
		});
		add({
			group: 2,
			name: "conflict resolved two different ways",
			expect: "changed",
			dir,
			a: b,
			b: c,
		});
	}

	// ---- 3. edge cases

	// Main edits a line near the PR's hunk (`return a / b;`, line 14). The PR's own lines stay.
	const near = [
		[
			"the line right above the hunk",
			"export function div(a, b) {",
			"export function div(a, b = 1) {",
		],
		[
			"only spaces, right above the hunk",
			"export function div(a, b) {",
			"export  function  div(a, b)  {",
		],
		[
			"a line 2 lines above, inside the context",
			"\n\nexport function div",
			"\n// x\nexport function div",
		],
		[
			"a line 3 lines above, inside the context",
			"}\n\nexport function div",
			"} // mul\n\nexport function div",
		],
		["a line 4 lines above, just outside the context", "\treturn a * b;", "\treturn a * b; // x"],
		["a line 8 lines above", "\treturn a - b;", "\treturn a - b; // x"],
	] as const;
	for (const [where, from, to] of near) {
		const dir = freshRepo();
		const a = prGuard(dir);
		moveMain(dir, "pr", () => edit(dir, "lib.js", from, to));
		const name = `main changed ${where}`;
		const b = rebaseOrRedo(dir, name, () => edit(dir, "lib.js", "\treturn a / b;", GUARD));
		add({group: 3, name, expect: "same", dir, a, b});
	}
	{
		// The same guard line, put in `mul` instead of `div`: the code is different.
		const dir = freshRepo();
		const a = prGuard(dir);
		branch(dir, "pr2");
		edit(
			dir,
			"lib.js",
			"\treturn a * b;",
			'\tif (b === 0) throw new Error("divide by zero");\n\treturn a * b;',
		);
		add({
			group: 3,
			name: "the same added line, in another function",
			expect: "changed",
			dir,
			a,
			b: commit(dir, "guard mul"),
		});
	}
	{
		const dir = freshRepo();
		const a = prGuard(dir);
		edit(dir, "lib.js", "\tif (b === 0)", "        if (b === 0)");
		git(dir, "add", "-A");
		git(dir, "commit", "-q", "--amend", "--no-edit");
		add({
			group: 3,
			name: "force-push: only the indent of a JS line",
			expect: "changed",
			dir,
			a,
			b: git(dir, "rev-parse", "HEAD"),
		});
	}
	{
		// YAML: the indent is the meaning. `debug` moves out of `server`.
		const dir = freshRepo();
		branch(dir, "pr");
		edit(dir, "config.yaml", "  debug: false", "  debug: true");
		const a = commit(dir, "debug on");
		edit(dir, "config.yaml", "  debug: true", "debug: true");
		git(dir, "add", "-A");
		git(dir, "commit", "-q", "--amend", "--no-edit");
		add({
			group: 3,
			name: "force-push: a YAML key moved out by its indent",
			expect: "changed",
			dir,
			a,
			b: git(dir, "rev-parse", "HEAD"),
		});
	}
	{
		const dir = freshRepo();
		const a = prGuard(dir);
		edit(dir, "lib.js", "divide by zero", "divideby zero");
		git(dir, "add", "-A");
		git(dir, "commit", "-q", "--amend", "--no-edit");
		add({
			group: 3,
			name: "force-push: one space gone inside a string",
			expect: "changed",
			dir,
			a,
			b: git(dir, "rev-parse", "HEAD"),
		});
	}
	{
		const dir = freshRepo();
		branch(dir, "pr");
		git(dir, "mv", "other.txt", "renamed.txt");
		const a = commit(dir, "rename");
		moveMain(dir, "pr", () => put(dir, "main-1.txt", "1\n"));
		add({group: 3, name: "a rename, rebased", expect: "same", dir, a, b: rebase(dir)});
	}
	{
		const dir = freshRepo();
		branch(dir, "pr");
		git(dir, "mv", "other.txt", "renamed.txt");
		const a = commit(dir, "rename");
		branch(dir, "pr2");
		git(dir, "mv", "other.txt", "moved.txt");
		add({
			group: 3,
			name: "a rename to another name",
			expect: "changed",
			dir,
			a,
			b: commit(dir, "rename"),
		});
	}
	{
		const dir = freshRepo();
		branch(dir, "pr");
		edit(dir, "lib.js", "\treturn a / b;", GUARD);
		chmodSync(join(dir, "lib.js"), 0o755);
		const a = commit(dir, "guard, and executable");
		branch(dir, "pr2");
		edit(dir, "lib.js", "\treturn a / b;", GUARD);
		add({
			group: 3,
			name: "same lines, one also chmod +x",
			expect: "changed",
			dir,
			a,
			b: commit(dir, "guard"),
		});
	}
	{
		const dir = freshRepo();
		branch(dir, "pr");
		chmodSync(join(dir, "other.txt"), 0o755);
		const a = commit(dir, "executable");
		moveMain(dir, "pr", () => put(dir, "main-1.txt", "1\n"));
		add({group: 3, name: "a mode change only, rebased", expect: "same", dir, a, b: rebase(dir)});
	}
	{
		const dir = freshRepo();
		branch(dir, "pr");
		writeFileSync(join(dir, "logo.bin"), Buffer.from([0, 1, 2, 3, 0, 254]));
		const a = commit(dir, "logo v2");
		branch(dir, "pr2");
		writeFileSync(join(dir, "logo.bin"), Buffer.from([0, 1, 2, 3, 0, 253]));
		add({
			group: 3,
			name: "a binary file changed two ways",
			expect: "changed",
			dir,
			a,
			b: commit(dir, "logo v3"),
		});
	}
	{
		const dir = freshRepo();
		branch(dir, "pr");
		const a = commit(dir, "nothing yet");
		moveMain(dir, "pr", () => put(dir, "main-1.txt", "1\n"));
		add({group: 3, name: "an empty diff, rebased", expect: "same", dir, a, b: rebase(dir)});
	}
	{
		const dir = freshRepo();
		branch(dir, "pr");
		const a = commit(dir, "nothing yet");
		branch(dir, "pr2");
		put(dir, "lib.js", `${LIB}`);
		add({
			group: 3,
			name: "an empty diff, against another empty one",
			expect: "same",
			dir,
			a,
			b: commit(dir, "still nothing"),
		});
	}
	return out;
};

// ---------------------------------------------------------------- 4. the known catch

/** Main renames `add` to `sum`; the PR calls `add` in a new file. The rebase is clean. */
const catchCase = () => {
	const dir = freshRepo();
	put(dir, "package.json", '{"type": "module"}\n');
	commit(dir, "esm");
	branch(dir, "pr");
	put(dir, "use.js", 'import {add} from "./lib.js";\nconsole.log(add(2, 3));\n');
	const a = commit(dir, "use add");
	moveMain(dir, "pr", () => {
		edit(dir, "lib.js", "export function add(a, b) {", "export function sum(a, b) {");
	});
	const b = rebase(dir);
	const check = (sha: string) => {
		on(dir, sha);
		const r = sh("node", ["use.js"], dir);
		on(dir, "pr");
		const why = r.err.split("\n").find((l) => l.startsWith("SyntaxError")) ?? r.err.slice(0, 80);
		return r.ok ? `pass (prints ${r.out.trim()})` : `fail (${why.trim()})`;
	};
	return {
		idA: diffId(dir, a, "stable"),
		idB: diffId(dir, b, "stable"),
		allSame: WAY_NAMES.every((w) => diffId(dir, a, w) === diffId(dir, b, w)),
		replay: replaysOnMain(dir, a, b),
		checkA: check(a),
		checkB: check(b),
	};
};

/** Does the `--binary` flag matter? Two PRs that change one binary file to two different bytes. */
const binaryProbe = () => {
	const dir = freshRepo();
	const heads = [254, 253].map((last) => {
		branch(dir, `bin-${last}`);
		writeFileSync(join(dir, "logo.bin"), Buffer.from([0, 1, 2, 3, 0, last]));
		return commit(dir, "logo");
	});
	const plain = DIFF.filter((a) => a !== "--binary");
	const ids = (args: readonly string[]) =>
		heads.map((h) => patchId(dir, mergeBase(dir, "main", h), h, "stable", args));
	const [w0, w1] = ids(DIFF);
	const [p0, p1] = ids(plain);
	return {withBinary: w0 !== w1, withoutBinary: p0 !== p1};
};

// ---------------------------------------------------------------- printing

const short = (id: string) => (id === "empty" ? "empty" : id.slice(0, 7));

const runCases = () => {
	root = mkdtempSync(join(tmpdir(), "exp165-"));
	const rows: string[] = [];
	const tally: Record<string, {right: number; of: number}> = {};
	const bump = (group: number, way: Column | "sha", right: boolean) => {
		const k = `${group}:${way}`;
		tally[k] ??= {right: 0, of: 0};
		tally[k].of += 1;
		if (right) tally[k].right += 1;
	};
	for (const c of cases()) {
		const cell = (way: Way) => {
			const got: Expect = diffId(c.dir, c.a, way) === diffId(c.dir, c.b, way) ? "same" : "changed";
			bump(c.group, way, got === c.expect);
			return got === c.expect ? got : `${got} ✗`;
		};
		const cells = WAY_NAMES.map(cell).join(" | ");
		const replay: Expect = replaysOnMain(c.dir, c.a, c.b) ? "same" : "changed";
		bump(c.group, "replay", replay === c.expect);
		const rp = replay === c.expect ? replay : `${replay} ✗`;
		const shaGot: Expect = c.a === c.b ? "same" : "changed";
		bump(c.group, "sha", shaGot === c.expect);
		const sha = shaGot === c.expect ? shaGot : `${shaGot} ✗`;
		const name = conflicted.has(c.name) ? `${c.name} (git: conflict)` : c.name;
		rows.push(
			`| ${c.group} | ${name} | ${c.expect} | ${sha} | ${cells} | ${rp} | ${rangeDiff(c.dir, c.a, c.b)} |`,
		);
	}
	const heads = ALL.join(" | ");
	console.log(
		"## Parts 1 to 3: two versions of a PR, and whether each name for its diff changed\n",
	);
	console.log(
		"✗ marks a wrong answer. `sha` is the head commit: today's binding. `stable` is the proposal.\n",
	);
	console.log(`| group | case | should be | sha | ${heads} | range-diff |`);
	console.log(`|---|---|---|---|${ALL.map(() => "---|").join("")}---|`);
	for (const r of rows) console.log(r);
	console.log(`\n| group | sha | ${heads} |`);
	console.log(`|---|---|${ALL.map(() => "---|").join("")}`);
	for (const g of [1, 2, 3]) {
		const t = (w: string) => `${tally[`${g}:${w}`]?.right} of ${tally[`${g}:${w}`]?.of}`;
		console.log(`| ${g} | ${t("sha")} | ${ALL.map(t).join(" | ")} |`);
	}
	const bin = binaryProbe();
	console.log(
		`\nBinary probe, two different new bytes: ids differ with --binary: ${bin.withBinary}; without it: ${bin.withoutBinary}.`,
	);
	const k = catchCase();
	console.log("\n## Part 4: main breaks the PR, the PR's diff does not change\n");
	console.log("| version | diff id (stable) | `node use.js` at the head |");
	console.log("|---|---|---|");
	console.log(`| before the rebase | ${short(k.idA)} | ${k.checkA} |`);
	console.log(`| after the rebase | ${short(k.idB)} | ${k.checkB} |`);
	console.log(
		`\nSame stable id: ${k.idA === k.idB}; same under all five ids: ${k.allSame}; a clean replay: ${k.replay}. The review carries over; only a check run at the new head sees the break.`,
	);
	rmSync(root, {recursive: true, force: true});
	console.log(`\n(${count} throwaway repos, removed.)\n`);
};

// ---------------------------------------------------------------- 5. real data

const QUERY = `query($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, first: 50, after: $cursor, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number headRefOid baseRefName
        mergeCommit { oid parents(first: 3) { totalCount } }
        timelineItems(itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT], first: 100) {
          nodes { ... on HeadRefForcePushedEvent { beforeCommit { oid } afterCommit { oid } } }
        }
      }
    }
  }
}`;

type Pr = {
	number: number;
	headRefOid: string;
	baseRefName: string;
	mergeCommit: {oid: string; parents: {totalCount: number}} | null;
	timelineItems: {nodes: {beforeCommit: {oid: string} | null; afterCommit: {oid: string} | null}[]};
};

const readPrs = (): Pr[] => {
	const prs: Pr[] = [];
	let cursor: string | null = null;
	for (;;) {
		const [owner = "", name = ""] = new URL(REPO).pathname.split("/").filter(Boolean);
		const args = [
			"api",
			"graphql",
			"-f",
			`query=${QUERY}`,
			"-f",
			`owner=${owner}`,
			"-f",
			`name=${name}`,
		];
		if (cursor !== null) args.push("-f", `cursor=${cursor}`);
		const r = sh("gh", args, here);
		if (!r.ok) throw new Error(`gh: ${r.err}`);
		const page = JSON.parse(r.out).data.repository.pullRequests;
		prs.push(...page.nodes);
		if (!page.pageInfo.hasNextPage) return prs;
		cursor = page.pageInfo.endCursor;
	}
};

const runReal = () => {
	const keep = process.env.WORK;
	const work = keep ?? mkdtempSync(join(tmpdir(), "exp165-real-"));
	const repo = join(work, "repo.git");
	if (sh("git", ["rev-parse", "--git-dir"], repo).ok === false) {
		mkdirSync(work, {recursive: true});
		git(work, "clone", "-q", "--bare", `${REPO}.git`, repo);
	}
	git(
		repo,
		"fetch",
		"-q",
		"origin",
		"+refs/heads/main:refs/heads/main",
		"+refs/pull/*/head:refs/pull/*/head",
	);
	const prs = readPrs();
	const has = (sha: string) => sh("git", ["cat-file", "-e", `${sha}^{commit}`], repo).ok;
	const fetchSha = (sha: string) =>
		has(sha) || (sh("git", ["fetch", "-q", "origin", sha], repo).ok && has(sha));

	// The landing check: the PR's final diff against the commit main got.
	// A squash commit's diff is against its one parent. A merge commit's is against its first
	// parent, main before the merge: the PR's net change as main saw it.
	type Kind = "squash" | "merge";
	type Same = Record<Column, boolean>;
	const sameUnder = (ida: (w: Way) => string, idb: (w: Way) => string, replay: boolean): Same => ({
		stable: ida("stable") === idb("stable"),
		verbatim: ida("verbatim") === idb("verbatim"),
		u0: ida("u0") === idb("u0"),
		u0v: ida("u0v") === idb("u0v"),
		fn: ida("fn") === idb("fn"),
		replay,
	});
	const landed: {pr: number; kind: Kind; same: Same}[] = [];
	let missing = 0;
	for (const pr of prs) {
		const m = pr.mergeCommit;
		if (m === null || !has(pr.headRefOid) || !has(m.oid)) {
			missing += 1;
			continue;
		}
		const parent = git(repo, "rev-parse", `${m.oid}^1`);
		landed.push({
			pr: pr.number,
			kind: m.parents.totalCount > 1 ? "merge" : "squash",
			same: sameUnder(
				(w) => diffId(repo, pr.headRefOid, w, parent),
				(w) => patchId(repo, parent, m.oid, w),
				replays(repo, pr.headRefOid, mergeBase(repo, parent, pr.headRefOid), m.oid, parent),
			),
		});
	}

	// The force pushes.
	const push = {events: 0, prs: 0, fetched: 0, missing: 0};
	type Pair = {pr: number; before: string; after: string} & (
		| {fetched: false}
		| {fetched: true; rebased: boolean; same: Same; rangeDiff: string}
	);
	const pairs: Pair[] = [];
	for (const pr of prs) {
		const events = pr.timelineItems.nodes;
		if (events.length > 0) push.prs += 1;
		for (const e of events) {
			push.events += 1;
			const before = e.beforeCommit?.oid ?? "";
			const after = e.afterCommit?.oid ?? "";
			if (before === "" || after === "" || !fetchSha(before) || !fetchSha(after)) {
				push.missing += 1;
				pairs.push({pr: pr.number, before, after, fetched: false});
				continue;
			}
			push.fetched += 1;
			pairs.push({
				pr: pr.number,
				before,
				after,
				fetched: true,
				rebased: mergeBase(repo, "main", before) !== mergeBase(repo, "main", after),
				same: sameUnder(
					(w) => diffId(repo, before, w),
					(w) => diffId(repo, after, w),
					replaysOnMain(repo, before, after),
				),
				rangeDiff: rangeDiff(repo, before, after),
			});
		}
	}

	const ok = (b: boolean) => (b ? "same" : "changed");
	const heads = ALL.join(" | ");
	const bar = ALL.map(() => "---|").join("");
	console.log(`## Part 5: ${REPO}, every merged PR\n`);
	console.log(`${prs.length} merged PRs read. Head or merge commit not fetchable: ${missing}.\n`);
	console.log("PRs whose final diff has the same id as the commit main got:\n");
	console.log(`| landed as | PRs | ${heads} |`);
	console.log(`|---|---|${bar}`);
	for (const kind of ["squash", "merge"] as const) {
		const rows = landed.filter((r) => r.kind === kind);
		const n = (w: Column) => rows.filter((r) => r.same[w]).length;
		console.log(`| ${kind} commit | ${rows.length} | ${ALL.map(n).join(" | ")} |`);
	}
	const off = landed.filter((r) => ALL.some((w) => !r.same[w]));
	console.log(
		`\nLanded with any column changed: ${off.map((r) => `#${r.pr} (${r.kind}; ${ALL.map((w) => `${w} ${ok(r.same[w])}`).join(", ")})`).join("; ") || "none"}`,
	);
	console.log(
		`\n${push.events} force-push events on ${push.prs} PRs; both shas fetched for ${push.fetched}, a sha not fetchable for ${push.missing}.\n`,
	);
	console.log(`| PR | before | after | base moved | ${heads} | range-diff |`);
	console.log(`|---|---|---|---|${bar}---|`);
	for (const p of pairs) {
		const head = `| #${p.pr} | ${p.before.slice(0, 7)} | ${p.after.slice(0, 7)} |`;
		if (!p.fetched) console.log(`${head} not fetched |${ALL.map(() => " |").join("")} |`);
		else
			console.log(
				`${head} ${p.rebased ? "yes" : "no"} | ${ALL.map((w) => ok(p.same[w])).join(" | ")} | ${p.rangeDiff} |`,
			);
	}
	console.log("");
	const fetched = pairs.filter((p) => p.fetched);
	for (const w of ALL) {
		const kept = fetched.filter((p) => p.same[w]);
		console.log(
			`Head changed, ${w} said same: ${kept.length} of ${fetched.length} (base moved in ${kept.filter((p) => p.rebased).length}).`,
		);
	}
	writeFileSync(RESULTS, `${JSON.stringify({missing, landed, push, pairs}, null, "\t")}\n`);
	if (keep === undefined) rmSync(work, {recursive: true, force: true});
};

// ---------------------------------------------------------------- 6. generated cases

// Parts 1 to 3 only find the holes someone thought to look for. Part 6 makes cases at random
// and knows each answer by how the case was made. One file, `file.txt`, with code-ish and
// YAML-ish blocks. Each line knows which it is, because only in YAML is the indent the meaning.

/** The fixed seed, so a rerun makes the very same cases. */
const SEED = 165;
/** How many cases to make. */
const RUNS = Number(process.env.RUNS ?? 2000);

type Kind = "code" | "yaml";
type Line = {text: string; kind: Kind};

const NAMES = ["add", "sub", "div", "greet", "server", "build"] as const;
const CODE_INDENTS = ["\t", "  ", "    "] as const;
const YAML_INDENTS = ["  ", "    ", "   "] as const;
type Lines = (i: string) => string[];
const CODE: readonly Lines[] = [
	(i) => [`${i}return a + b;`],
	(i) => [`${i}const s = "hello " + a;`],
	(i) => [`${i}if (a > 0) {`, `${i}${i}a = a - 1;`, `${i}}`],
	(i) => [`${i}log("value is", a);`],
	(i) => [`${i}let n = 0;`],
	(i) => [`${i}return a;`],
];
const YAML: readonly Lines[] = [
	(i) => [`${i}port: 8080`],
	(i) => [`${i}debug: false`],
	(i) => [`${i}name: "app one"`],
	(i) => [`${i}env:`, `${i}${i}mode: "a b"`],
	(i) => [`${i}retries: 3`],
	(i) => [`${i}host: "x y"`],
];
/** Lines a PR or main may add, in the indent of the line they go under. */
const NEW_CODE: readonly ((i: string) => string)[] = [
	(i) => `${i}check(a);`,
	(i) => `${i}if (b === 0) throw new Error("divide by zero");`,
	(i) => `${i}return a;`,
	() => "}",
	() => "",
];
const NEW_YAML: readonly ((i: string) => string)[] = [
	(i) => `${i}retries: 3`,
	(i) => `${i}name: "app one"`,
	(i) => `${i}debug: true`,
	() => "",
];

/**
 * One edit to one line. Three change its words; four change only whitespace. Of those four,
 * `reindent` on a YAML line and `inString` anywhere change the meaning; `reindent` on a code
 * line, `between` and `trailing` do not. A mut that does not fit its line adds a comment.
 */
type Mut = "word" | "number" | "append" | "reindent" | "inString" | "between" | "trailing";
const MUTS: readonly Mut[] = [
	"word",
	"number",
	"append",
	"reindent",
	"inString",
	"between",
	"trailing",
];
const WS_ONLY: ReadonlySet<Mut> = new Set(["reindent", "inString", "between", "trailing"]);

const lead = (t: string) => /^\s*/.exec(t)?.[0] ?? "";

const mutate = (l: Line, m: Mut): Line => {
	const t = l.text;
	const to = (text: string): Line => ({text, kind: l.kind});
	const append = () => to(`${t}${l.kind === "code" ? " // edited" : " # edited"}`);
	switch (m) {
		case "word": {
			const w = /[A-Za-z_]+/.exec(t);
			return w ? to(`${t.slice(0, w.index)}${w[0]}x${t.slice(w.index + w[0].length)}`) : append();
		}
		case "number": {
			const n = /\d+/.exec(t);
			return n
				? to(`${t.slice(0, n.index)}${Number(n[0]) + 1}${t.slice(n.index + n[0].length)}`)
				: append();
		}
		case "append":
			return append();
		case "reindent": {
			if (t.trim() === "") return append();
			const ws = lead(t);
			return to(`${ws.startsWith("\t") ? `    ${ws.slice(1)}` : `${ws}  `}${t.slice(ws.length)}`);
		}
		case "inString": {
			const q = t.indexOf('"');
			return q < 0 ? append() : to(`${t.slice(0, q + 1)} ${t.slice(q + 1)}`);
		}
		case "between": {
			let quoted = false;
			for (let k = lead(t).length; k < t.length; k += 1) {
				if (t[k] === '"') quoted = !quoted;
				if (t[k] === " " && !quoted) return to(`${t.slice(0, k)} ${t.slice(k)}`);
			}
			return append();
		}
		case "trailing":
			return to(`${t} `);
	}
};

/** An edit on the base file: a line replaced by 0, 1 or 2 lines, or lines put into a gap. */
type Op =
	| {kind: "replace"; line: number; to: Line[]}
	| {kind: "insert"; gap: number; lines: Line[]};

const spot = (o: Op) => (o.kind === "insert" ? `g${o.gap}` : `l${o.line}`);

/**
 * How many untouched base lines sit between two edits. -1 is the same line; 0 is right next to
 * it, or the same gap. 3 or more is outside git's 3 lines of context: "4 lines away" in part 3.
 */
const between = (x: Op, y: Op): number => {
	if (x.kind === "replace" && y.kind === "replace") return Math.abs(x.line - y.line) - 1;
	if (x.kind === "insert" && y.kind === "insert") return Math.abs(x.gap - y.gap);
	const r = x.kind === "replace" ? x : (y as Extract<Op, {kind: "replace"}>);
	const s = x.kind === "insert" ? x : (y as Extract<Op, {kind: "insert"}>);
	return r.line < s.gap ? s.gap - r.line - 1 : r.line - s.gap;
};

const apply = (base: readonly Line[], ops: readonly Op[]): Line[] => {
	const out: Line[] = [];
	for (let g = 0; g <= base.length; g += 1) {
		for (const o of ops) if (o.kind === "insert" && o.gap === g) out.push(...o.lines);
		const line = base[g];
		if (line === undefined) continue;
		const r = ops.find((o) => o.kind === "replace" && o.line === g);
		out.push(...(r?.kind === "replace" ? r.to : [line]));
	}
	return out;
};

// ---- what fast-check makes: small numbers, read by `build` below

type BlockSpec = {kind: Kind; name: number; indent: number; body: number[]};
type OpSpec = {op: "change" | "delete" | "insert"; at: number; mut: Mut; lines: number[]};
type MainSpec = OpSpec & {aim: "far" | "touch" | "any"; keep: "pr" | "main" | "both"};
type How = "same" | "split" | "tweak" | "extra" | "move" | "drop";
type Spec = {
	blocks: BlockSpec[];
	pr: OpSpec[];
	push:
		| {kind: "rebase"; main: MainSpec[]}
		| {kind: "remake"; how: How; at: number; mut: Mut; extra: OpSpec; main: MainSpec[]};
};

const opArb = fc.record({
	op: fc.constantFrom("change", "delete", "insert"),
	at: fc.nat({max: 999}),
	mut: fc.constantFrom(...MUTS),
	lines: fc.array(fc.nat({max: 4}), {minLength: 1, maxLength: 2}),
});
const mainArb = fc.record({
	op: fc.constantFrom("change", "delete", "insert"),
	at: fc.nat({max: 999}),
	mut: fc.constantFrom(...MUTS),
	lines: fc.array(fc.nat({max: 4}), {minLength: 1, maxLength: 2}),
	aim: fc.constantFrom("far", "touch", "any"),
	keep: fc.constantFrom("pr", "main", "both"),
});
const blocksArb: fc.Arbitrary<BlockSpec[]> = fc.array(
	fc.record({
		kind: fc.constantFrom("code", "yaml"),
		name: fc.nat({max: NAMES.length - 1}),
		indent: fc.nat({max: 2}),
		body: fc.array(fc.nat({max: 5}), {minLength: 1, maxLength: 4}),
	}),
	{minLength: 2, maxLength: 5},
);
const specArb: fc.Arbitrary<Spec> = fc.record({
	blocks: blocksArb,
	pr: fc.array(opArb, {minLength: 1, maxLength: 3}),
	push: fc.oneof(
		fc.record({
			kind: fc.constant("rebase" as const),
			main: fc.array(mainArb, {minLength: 1, maxLength: 2}),
		}),
		fc.record({
			kind: fc.constant("remake" as const),
			how: fc.constantFrom("same", "split", "tweak", "extra", "move", "drop"),
			at: fc.nat({max: 999}),
			mut: fc.constantFrom(...MUTS),
			extra: opArb,
			main: fc.array(mainArb, {maxLength: 2}),
		}),
	),
});

// ---- reading a spec into a case whose answer is known

const pick = <T>(xs: readonly T[], n: number): T => xs[n % xs.length] as T;

const blockLines = (b: BlockSpec): Line[] => {
	const name = pick(NAMES, b.name);
	const text =
		b.kind === "code"
			? [
					`function ${name}(a, b) {`,
					...b.body.flatMap((s) => pick(CODE, s)(pick(CODE_INDENTS, b.indent))),
					"}",
					"",
				]
			: [`${name}:`, ...b.body.flatMap((s) => pick(YAML, s)(pick(YAML_INDENTS, b.indent))), ""];
	return text.map((t) => ({text: t, kind: b.kind}));
};

const newLines = (base: readonly Line[], gap: number, picks: readonly number[]): Line[] => {
	const near = base[gap - 1] ?? base[gap] ?? {text: "", kind: "code"};
	const indent = lead(near.text) || (near.kind === "code" ? "\t" : "  ");
	const made = near.kind === "code" ? NEW_CODE : NEW_YAML;
	return picks.map((p) => ({text: pick(made, p)(indent), kind: near.kind}));
};

/** Every edit `s` could make, one per line (change, delete) or one per gap (insert). */
const choices = (base: readonly Line[], s: OpSpec): Op[] =>
	s.op === "insert"
		? Array.from({length: base.length + 1}, (_, gap) => ({
				kind: "insert",
				gap,
				lines: newLines(base, gap, s.lines),
			}))
		: base.map((line, k) => ({
				kind: "replace",
				line: k,
				to: s.op === "delete" ? [] : [mutate(line, s.mut)],
			}));

const addOnce = (ops: Op[], o: Op | undefined) => {
	if (o !== undefined && !ops.some((p) => spot(p) === spot(o))) ops.push(o);
};

/**
 * Main's edits. `far` picks a spot at least 3 untouched lines from every edit in `avoid`;
 * `touch` changes the words of a line the PR changed; `any` picks any spot.
 */
const mainOps = (
	base: readonly Line[],
	specs: readonly MainSpec[],
	avoid: readonly Op[],
	touch: boolean,
) => {
	const out: Op[] = [];
	const touchable = avoid.flatMap((o) => (o.kind === "replace" ? [o.line] : []));
	for (const s of specs) {
		if (s.aim === "touch" && touch && touchable.length > 0) {
			const line = pick(touchable, s.at);
			const mut = WS_ONLY.has(s.mut) ? "append" : s.mut;
			addOnce(out, {kind: "replace", line, to: [mutate(base[line] as Line, mut)]});
			continue;
		}
		const all = choices(base, s);
		const far = all.filter((c) => avoid.every((a) => between(a, c) >= 3));
		addOnce(out, pick(s.aim === "far" && far.length > 0 ? far : all, s.at));
	}
	return out;
};

/** The PR made again: the same, split in two commits, or one thing different. */
const remakeOps = (
	base: readonly Line[],
	p: readonly Op[],
	push: Extract<Spec["push"], {kind: "remake"}>,
) => {
	const extra = (): {how: How; ops: Op[]} => {
		const free = choices(base, push.extra).filter((c) => !p.some((x) => spot(x) === spot(c)));
		return free.length === 0
			? {how: "same", ops: [...p]}
			: {how: "extra", ops: [...p, pick(free, push.at)]};
	};
	switch (push.how) {
		case "same":
		case "split":
			return {how: push.how, ops: [...p]};
		case "extra":
			return extra();
		case "tweak": {
			const spots = p.flatMap((o, k) =>
				(o.kind === "insert" ? o.lines : o.to).map((_, j) => [k, j] as const),
			);
			if (spots.length === 0) return extra();
			const [k, j] = pick(spots, push.at);
			const ops = p.map((o, n) => {
				if (n !== k) return o;
				const lines = (o.kind === "insert" ? o.lines : o.to).map((l, m) =>
					m === j ? mutate(l, push.mut) : l,
				);
				return o.kind === "insert" ? {...o, lines} : {...o, to: lines};
			});
			return {how: "tweak" as How, ops};
		}
		case "move": {
			const moves = p.filter((o) => o.kind === "insert");
			if (moves.length === 0) return extra();
			const m = pick(moves, push.at);
			const gaps = Array.from({length: base.length + 1}, (_, g) => g).filter(
				(g) => !p.some((o) => o.kind === "insert" && o.gap === g),
			);
			if (gaps.length === 0) return extra();
			const gap = pick(gaps, Math.floor(push.at / moves.length));
			return {how: "move" as How, ops: p.map((o) => (o === m ? {...m, gap} : o))};
		}
		case "drop":
			return {how: "drop" as How, ops: p.filter((_, k) => k !== push.at % p.length)};
	}
};

const norm = (ls: readonly Line[]) =>
	ls.map((l) => l.text.replace(/\s+/g, "")).filter((t) => t !== "");
const strings = (t: string) => (t.match(/"[^"]*"/g) ?? []).join("|");
const sameText = (x: readonly Line[], y: readonly Line[]) =>
	x.length === y.length && x.every((l, k) => l.text === y[k]?.text);

/** Two files that differ only in whitespace: does any of it sit where it means something? */
const meaningfulWhitespace = (x: readonly Line[], y: readonly Line[]) => {
	const nx = x.filter((l) => l.text.trim() !== "");
	const ny = y.filter((l) => l.text.trim() !== "");
	return nx.some((l, k) => {
		const m = ny[k];
		if (m === undefined || l.text === m.text) return false;
		return (
			(l.kind === "yaml" && lead(l.text) !== lead(m.text)) || strings(l.text) !== strings(m.text)
		);
	});
};

/**
 * The PR's edits `p`, made again over `e`: edits made under it, by main or by a parent branch.
 * Far apart, the PR is the same. Next to each other, the answer is unclear. On a line both
 * changed, the rebase stops and a person resolves it: the PR is not the same any more.
 */
type Over =
	| {kind: "far"; ops: Op[]}
	| {kind: "near"}
	| {kind: "same_change"}
	| {kind: "touch"; kept: MainSpec["keep"]; ops: Op[]};

const replayOver = (
	base: readonly Line[],
	p: readonly Op[],
	e: readonly Op[],
	keep: MainSpec["keep"],
): Over => {
	const touches = (x: Op) =>
		x.kind === "replace" && p.some((y) => y.kind === "replace" && y.line === x.line);
	const touched = e.filter(touches);
	if (touched.length === 0) {
		if (e.some((x) => p.some((y) => between(x, y) < 3))) return {kind: "near"};
		return {kind: "far", ops: [...e, ...p]};
	}
	const ops: Op[] = e.filter((x) => !touches(x));
	let kept = keep;
	for (const y of p) {
		const x = touched.find(
			(t) => t.kind === "replace" && y.kind === "replace" && t.line === y.line,
		);
		if (x === undefined || x.kind !== "replace" || y.kind !== "replace") {
			ops.push(y);
			continue;
		}
		if (sameText(x.to, y.to)) return {kind: "same_change"};
		// Keeping the other side drops the PR's change. Fine when that change had words in it.
		const words = y.to.length === 0 || norm(y.to).join() !== norm([base[y.line] as Line]).join();
		kept = keep === "main" && !words ? "pr" : keep;
		const to = kept === "pr" ? y.to : kept === "main" ? x.to : [...y.to, ...x.to];
		ops.push({kind: "replace", line: y.line, to});
	}
	return {kind: "touch", kept, ops};
};

type Label = "keep" | "drop" | "skip";
type Built = {
	base: Line[];
	a: Line[];
	main: Line[] | null;
	b: Line[];
	split: Line[] | null;
	label: Label;
	why: string;
};

/** Read a spec into the base file, the reviewed PR, main's move, the new head and its answer. */
const build = (spec: Spec): Built => {
	const base = spec.blocks.flatMap(blockLines);
	const p: Op[] = [];
	for (const s of spec.pr) addOnce(p, pick(choices(base, s), s.at));
	const a = apply(base, p);
	const push = spec.push;
	const out = (
		b: Line[],
		e: Op[],
		label: Label,
		why: string,
		split: Line[] | null = null,
	): Built => ({
		base,
		a,
		main: e.length > 0 ? apply(base, e) : null,
		b,
		split,
		label,
		why,
	});

	if (push.kind === "rebase") {
		const e = mainOps(base, push.main, p, true);
		const o = replayOver(base, p, e, push.main[0]?.keep ?? "pr");
		switch (o.kind) {
			case "near":
				return out([], e, "skip", "main edit 1 to 3 lines from a PR edit");
			case "same_change":
				return out([], e, "skip", "both sides made the same change");
			case "far":
				return out(apply(base, o.ops), e, "keep", "rebase, main 4+ lines away");
			case "touch":
				return out(apply(base, o.ops), e, "drop", `main changed a PR line, kept ${o.kept}`);
		}
	}

	const q = remakeOps(base, p, push);
	const e = mainOps(base, push.main, [...p, ...q.ops], false);
	const rebased = e.length > 0 ? ", rebased" : "";
	const why = `force push: ${q.how}${rebased}`;
	if (e.some((x) => [...p, ...q.ops].some((y) => between(x, y) < 3)))
		return out([], e, "skip", "main edit 1 to 3 lines from a PR edit");
	const b = apply(base, [...e, ...q.ops]);
	const split =
		q.how === "split" ? apply(base, [...e, ...q.ops.slice(0, Math.floor(q.ops.length / 2))]) : null;
	const before = a;
	const after = apply(base, q.ops);
	if (sameText(before, after)) return out(b, e, "keep", why, split);
	if (norm(before).join("\n") !== norm(after).join("\n")) return out(b, e, "drop", `${why}, words`);
	if (meaningfulWhitespace(before, after))
		return out(b, e, "drop", `${why}, whitespace in YAML indent or a string`);
	return out([], e, "skip", "whitespace only, where it means nothing to the program");
};

// ---- asking git

/** Every way 165 compares, `sha` first. */
const GEN_WAYS = ["sha", ...ALL, "range-diff"] as const;

/** What git said of a case, or why the case was dropped after all. */
type Asked = {same: Record<string, boolean>; show: () => string; note?: string} | {skip: string};

const fileText = (lines: readonly Line[]) =>
	lines.length === 0 ? "" : `${lines.map((l) => l.text).join("\n")}\n`;

/**
 * Fixed dates, so the same file and parent always give the same commit. The new head keeps the
 * PR's message, as a rebase does, and gets a later committer date, as a rebase does.
 */
const AT = {first: "2026-01-01T00:00:00Z", later: "2026-01-02T00:00:00Z"} as const;

const store = (
	repo: string,
	lines: readonly Line[],
	parent: string | null,
	msg: string,
	at: keyof typeof AT = "first",
) => {
	const blob = sh("git", ["hash-object", "-w", "--stdin"], repo, fileText(lines)).out.trim();
	const tree = sh("git", ["mktree"], repo, `100644 blob ${blob}\tfile.txt\n`).out.trim();
	const args = ["commit-tree", tree, ...(parent === null ? [] : ["-p", parent]), "-m", msg];
	const env = {...ENV, GIT_AUTHOR_DATE: AT.first, GIT_COMMITTER_DATE: AT[at]};
	const r = sh("git", args, repo, undefined, env);
	if (!r.ok) throw new Error(`commit-tree: ${r.err}`);
	return r.out.trim();
};

/** A diff for a reader: no `diff --git`, `index`, `---` or `+++` lines. */
const shownDiff = (repo: string, from: string, to: string) =>
	git(repo, "diff", "--no-color", from, to)
		.split("\n")
		.filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l))
		.join("\n") || "(empty)";

/** Every way's answer for two versions, each read against its own base. */
const waysBetween = (repo: string, baseA: string, a: string, baseB: string, b: string) => {
	const ids = Object.fromEntries(
		WAY_NAMES.map((w) => [w, patchId(repo, baseA, a, w) === patchId(repo, baseB, b, w)]),
	);
	const [paired, , of] = rangeBetween(repo, baseA, a, baseB, b).split(" ");
	return {
		...ids,
		replay: replays(repo, a, baseA, b, baseB),
		"range-diff": paired === of && of !== "0",
	} as Record<Column | "range-diff", boolean>;
};

const asked = new Map<string, Asked>();
const once = (key: unknown, ask: () => Asked) => {
	const k = JSON.stringify(key);
	const seen = asked.get(k);
	if (seen !== undefined) return seen;
	const got = ask();
	asked.set(k, got);
	return got;
};

/** Part 6a: store the case as commits, then ask every way, each base from main. */
const askFlat = (repo: string, c: Built): Asked =>
	once(["flat", c.base, c.a, c.main, c.b, c.split], () => {
		const m0 = store(repo, c.base, null, "base");
		const a = store(repo, c.a, m0, "pr");
		const m1 = c.main === null ? m0 : store(repo, c.main, m0, "main moves");
		git(repo, "update-ref", "refs/heads/main", m1);
		const b =
			c.split === null
				? store(repo, c.b, m1, "pr", "later")
				: store(repo, c.b, store(repo, c.split, m1, "pr, 1 of 2", "later"), "pr, 2 of 2", "later");
		const same = {
			sha: a === b,
			...waysBetween(repo, mergeBase(repo, "main", a), a, mergeBase(repo, "main", b), b),
		};
		const show = () =>
			[
				"reviewed PR, against its base:",
				shownDiff(repo, m0, a),
				...(m1 === m0 ? [] : ["main moved:", shownDiff(repo, m0, m1)]),
				"new head, against its base:",
				shownDiff(repo, m1, b),
			].join("\n");
		return {same, show};
	});

// ---- 6b. stacked PRs

// A child PR sits on a parent PR's branch, so its diff is read against the parent, not main.
// Three moves under it: the parent gets a new commit (1a, and 3a when that commit changes a
// child line), main moves and the whole stack is restacked (1b), or the parent is squash-merged
// into main and the child moves onto main (2, and 3b when the parent's last fix changed a child
// line). Every way is asked twice: with each base taken from main, as 6a does, and with each
// base taken from the PR's base branch, the parent while it is stacked and main after.

type Move = "parent_commit" | "main_moves" | "squash_merge";
type StackSpec = {
	blocks: BlockSpec[];
	parent: OpSpec[];
	child: OpSpec[];
	move: Move;
	fix: MainSpec[];
};

const stackArb: fc.Arbitrary<StackSpec> = fc.record({
	blocks: blocksArb,
	parent: fc.array(opArb, {minLength: 1, maxLength: 2}),
	child: fc.array(opArb, {minLength: 1, maxLength: 2}),
	move: fc.constantFrom("parent_commit", "main_moves", "squash_merge"),
	fix: fc.array(mainArb, {maxLength: 2}),
});

type Stack = {
	base: Line[];
	parent: Line[];
	child: Line[];
	move: Move;
	/** The parent's new tip (1a, 3a), or main's new tip (1b, 2, 3b). */
	moved: Line[];
	/** The child's new head, as the case expects git to make it. */
	b: Line[];
	label: Label;
	why: string;
};

const SIDE = {pr: "the child's side", main: "the parent's side", both: "both"} as const;

const buildStack = (s: StackSpec): Stack => {
	const base = s.blocks.flatMap(blockLines);
	const p1: Op[] = [];
	for (const o of s.parent) addOnce(p1, pick(choices(base, o), o.at));
	const free = (ops: readonly Op[]) => ops.filter((o) => !p1.some((x) => spot(x) === spot(o)));
	const c: Op[] = [];
	for (const o of s.child) {
		const left = free(choices(base, o));
		if (left.length > 0) addOnce(c, pick(left, o.at));
	}
	const out = (moved: Line[], b: Line[], label: Label, why: string): Stack => ({
		base,
		parent: apply(base, p1),
		child: apply(base, [...p1, ...c]),
		move: s.move,
		moved,
		b,
		label,
		why,
	});
	if (c.length === 0) return out([], [], "skip", "the child has no edit of its own");

	if (s.move === "main_moves") {
		const e = free(mainOps(base, s.fix, [...p1, ...c], false));
		if (e.length === 0) return out([], [], "skip", "nothing moved");
		if (e.some((x) => [...p1, ...c].some((y) => between(x, y) < 3)))
			return out([], [], "skip", "an edit 1 to 3 lines from a PR edit");
		const why = "1b. main moved, the whole stack restacked with --update-refs";
		return out(apply(base, e), apply(base, [...e, ...p1, ...c]), "keep", why);
	}
	const p2 = free(mainOps(base, s.fix, c, true));
	if (s.move === "parent_commit" && p2.length === 0) return out([], [], "skip", "nothing moved");
	const moved = apply(base, [...p1, ...p2]);
	const o: Over =
		p2.length === 0 ? {kind: "far", ops: c} : replayOver(base, c, p2, s.fix[0]?.keep ?? "pr");
	const squash = s.move === "squash_merge";
	switch (o.kind) {
		case "near":
			return out([], [], "skip", "an edit 1 to 3 lines from a PR edit");
		case "same_change":
			return out([], [], "skip", "both sides made the same change");
		case "far": {
			const why = squash
				? `2. parent squash-merged, child restacked with --onto${p2.length > 0 ? ", after a parent fix" : ""}`
				: "1a. parent got a new commit, child restacked with --update-refs";
			return out(moved, apply(base, [...p1, ...o.ops]), "keep", why);
		}
		case "touch": {
			const why = squash
				? `3b. parent's last fix changed a child line, then squash-merged; kept ${SIDE[o.kept]}`
				: `3a. parent's new commit changed a child line; kept ${SIDE[o.kept]}`;
			return out(moved, apply(base, [...p1, ...o.ops]), "drop", why);
		}
	}
};

const STACK_WAYS = [
	"sha",
	...[...ALL, "range-diff"].flatMap((w) => [`${w} (main)`, `${w} (branch)`]),
] as const;

/** Rebase prompts answered the way a person who changes nothing answers them. */
const EDIT = {...ENV, GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true"};

/**
 * Part 6b: build the stack as commits, then restack it with git itself: `rebase --update-refs`
 * or `rebase --onto main <old parent tip>`. On a conflict, write the file the case expects, as a
 * person resolving it would, and go on. If git's own result is not the file the case expects,
 * the case is dropped: its answer is no longer certain.
 */
const askStack = (work: string, c: Stack): Asked =>
	once(["stack", c.base, c.parent, c.child, c.move, c.moved, c.b], () => {
		sh("git", ["rebase", "--abort"], work);
		const m0 = store(work, c.base, null, "base");
		const t1 = store(work, c.parent, m0, "parent");
		const a = store(work, c.child, t1, "child");
		git(work, "checkout", "-q", "-f", "--detach", m0);
		git(work, "update-ref", "refs/heads/main", m0);
		git(work, "update-ref", "refs/heads/parent", t1);
		git(work, "update-ref", "refs/heads/child", a);
		git(work, "checkout", "-q", "-f", "child");
		const step = {
			parent_commit: () => {
				const moved = store(work, c.moved, t1, "parent, more");
				git(work, "update-ref", "refs/heads/parent", moved);
				return {args: ["--update-refs", "parent"], onto: "parent", from: t1, moved};
			},
			main_moves: () => {
				const moved = store(work, c.moved, m0, "main moves");
				git(work, "update-ref", "refs/heads/main", moved);
				return {args: ["--update-refs", "main"], onto: "parent", from: m0, moved};
			},
			squash_merge: () => {
				const moved = store(work, c.moved, m0, "parent, squashed");
				git(work, "update-ref", "refs/heads/main", moved);
				return {args: ["--onto", "main", t1], onto: "main", from: m0, moved};
			},
		}[c.move]();
		const ran = sh("git", ["rebase", "-q", ...step.args], work, undefined, EDIT);
		let conflict = false;
		if (!ran.ok) {
			conflict = true;
			if (c.move === "main_moves") {
				sh("git", ["rebase", "--abort"], work);
				return {skip: "git: the restack of the whole stack stopped on a conflict"};
			}
			put(work, "file.txt", fileText(c.b));
			git(work, "add", "file.txt");
			// A resolution that leaves the child's commit empty: git wants --skip, not --continue.
			const next =
				sh("git", ["rebase", "--continue"], work, undefined, EDIT).ok ||
				sh("git", ["rebase", "--skip"], work, undefined, EDIT).ok;
			if (!next) {
				sh("git", ["rebase", "--abort"], work);
				return {skip: "git: the rebase did not go on after the conflict was resolved"};
			}
		}
		const b = git(work, "rev-parse", "HEAD");
		if (sh("git", ["show", `${b}:file.txt`], work).out !== fileText(c.b))
			return {skip: "git: its restack gave another file than the case expects"};
		const baseB = mergeBase(work, step.onto, b);
		const onMain = waysBetween(work, mergeBase(work, "main", a), a, mergeBase(work, "main", b), b);
		const onBranch = waysBetween(work, t1, a, baseB, b);
		const same: Record<string, boolean> = {sha: a === b};
		for (const [w, v] of Object.entries(onMain)) same[`${w} (main)`] = v;
		for (const [w, v] of Object.entries(onBranch)) same[`${w} (branch)`] = v;
		const show = () =>
			[
				"parent PR, against main:",
				shownDiff(work, m0, t1),
				"child PR as reviewed, against the parent:",
				shownDiff(work, t1, a),
				c.move === "parent_commit" ? "the parent's new commit:" : "main moved:",
				shownDiff(work, step.from, step.moved),
				`child's new head, against its base branch (${step.onto}):`,
				shownDiff(work, baseB, b),
			].join("\n");
		return {same, show, note: conflict ? "git stopped on a conflict" : "git restacked it cleanly"};
	});

// ---- scoring either family

type Scored = {label: Label; why: string};

const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
const total = (m: Map<string, number>) => [...m.values()].reduce((x, y) => x + y, 0);
const list = (m: Map<string, number>) =>
	[...m.entries()]
		.sort((x, y) => y[1] - x[1])
		.map(([k, n]) => `${n} ${k}`)
		.join("; ") || "none";

/**
 * Make `runs` cases from `arb` with the fixed seed, ask git, and count per way the wrong "same"
 * answers (a review kept over a real change) and the wrong "stale" ones (a review thrown away
 * for nothing). Then, for each wrong "same", and each wrong "stale" under the ways in `stale`,
 * let fast-check find one again and shrink it to the smallest case.
 */
const score = <S, C extends Scored>(o: {
	title: string;
	arb: fc.Arbitrary<S>;
	runs: number;
	build: (s: S) => C;
	ask: (c: C) => Asked;
	ways: readonly string[];
	stale: readonly string[];
	kind?: (c: C) => string;
}) => {
	const skipped = new Map<string, number>();
	const made = new Map<string, number>();
	const wrong = new Map(
		o.ways.map((w) => [w, {same: new Map<string, number>(), stale: new Map<string, number>()}]),
	);
	const saidSame = new Map<string, number>();
	const ofKind = new Map<string, number>();
	const notes = new Map<string, number>();
	let keep = 0;
	let drop = 0;
	for (const s of fc.sample(o.arb, {seed: SEED, numRuns: o.runs})) {
		const c = o.build(s);
		if (c.label === "skip") {
			bump(skipped, c.why);
			continue;
		}
		const got = o.ask(c);
		if ("skip" in got) {
			bump(skipped, got.skip);
			continue;
		}
		bump(made, `${c.label === "keep" ? "same" : "changed"} | ${c.why}`);
		if (c.label === "keep") keep += 1;
		else drop += 1;
		const k = o.kind?.(c);
		if (k !== undefined) bump(ofKind, k);
		if (got.note !== undefined) bump(notes, `${k ?? c.why}: ${got.note}`);
		for (const w of o.ways) {
			const m = wrong.get(w);
			if (m === undefined) continue;
			if (c.label === "drop" && got.same[w]) bump(m.same, c.why);
			if (c.label === "keep" && !got.same[w]) bump(m.stale, c.why);
			if (k !== undefined && got.same[w]) bump(saidSame, `${w}|${k}`);
		}
	}
	const w0 = (w: string) => wrong.get(w) ?? {same: new Map(), stale: new Map()};

	console.log(`## ${o.title} (fast-check, seed ${SEED}, ${o.runs} cases)\n`);
	console.log(
		`${o.runs} made, ${total(skipped)} skipped, ${keep + drop} scored: ${keep} should stay the same, ${drop} should change.\n`,
	);
	console.log("| skipped, because | cases |\n|---|---|");
	for (const [k, n] of [...skipped.entries()].sort((x, y) => y[1] - x[1]))
		console.log(`| ${k} | ${n} |`);
	console.log("\n| should be | how the case was made | cases |\n|---|---|---|");
	for (const [k, n] of [...made.entries()].sort()) console.log(`| ${k} | ${n} |`);
	console.log(`\n| way | wrong "same" (of ${drop}) | wrong "stale" (of ${keep}) |\n|---|---|---|`);
	for (const w of o.ways) console.log(`| ${w} | ${total(w0(w).same)} | ${total(w0(w).stale)} |`);
	if (o.kind !== undefined) {
		const kinds = [...ofKind.keys()].sort();
		console.log(`\nSaid "same", by kind of case:\n`);
		console.log(`| way | ${kinds.join(" | ")} |\n|---|${kinds.map(() => "---|").join("")}`);
		for (const w of o.ways)
			console.log(
				`| ${w} | ${kinds.map((k) => `${saidSame.get(`${w}|${k}`) ?? 0} of ${ofKind.get(k)}`).join(" | ")} |`,
			);
	}
	if (notes.size > 0)
		console.log(
			`\nNotes: ${[...notes.entries()]
				.sort()
				.map(([k, n]) => `${k}, ${n}`)
				.join("; ")}.`,
		);
	console.log("\nWhere the wrong answers came from:\n");
	for (const w of o.ways)
		console.log(`- ${w}: wrong "same": ${list(w0(w).same)}. Wrong "stale": ${list(w0(w).stale)}.`);

	const smallest: Record<string, string> = {};
	const shrink = (w: string, side: "same" | "stale") => {
		const r = fc.check(
			fc.property(o.arb, (s) => {
				const c = o.build(s);
				if (c.label === "skip") return true;
				const got = o.ask(c);
				if ("skip" in got) return true;
				return side === "same"
					? c.label !== "drop" || !got.same[w]
					: c.label !== "keep" || got.same[w] === true;
			}),
			{seed: SEED, numRuns: o.runs},
		);
		const s = r.counterexample?.[0];
		const head = `Smallest wrong "${side}" under ${w}`;
		if (!r.failed || s === undefined) {
			console.log(`\n### ${head}: fc.check did not find one again in ${o.runs} cases`);
			return;
		}
		const c = o.build(s);
		const got = o.ask(c);
		if ("skip" in got) return;
		const shown = `should be: ${c.label === "keep" ? "same" : "changed"} (${c.why})\n${got.show()}`;
		smallest[`${side}: ${w}`] = shown;
		console.log(`\n### ${head} (first found at case ${r.numRuns}, then ${r.numShrinks} shrinks)\n`);
		console.log(`\`\`\`diff\n${shown}\n\`\`\``);
	};
	for (const w of o.ways) if (total(w0(w).same) > 0) shrink(w, "same");
	for (const w of o.stale) if (total(w0(w).stale) > 0) shrink(w, "stale");
	console.log("");
	return {
		seed: SEED,
		runs: o.runs,
		skipped: Object.fromEntries(skipped),
		made: Object.fromEntries(made),
		wrong: Object.fromEntries(
			o.ways.map((w) => [
				w,
				{same: Object.fromEntries(w0(w).same), stale: Object.fromEntries(w0(w).stale)},
			]),
		),
		saidSame: Object.fromEntries(saidSame),
		notes: Object.fromEntries(notes),
		smallest,
	};
};

/** One repo in a temp folder for a whole family, removed at the end. */
const withRepo = <T>(name: string, bare: boolean, f: (repo: string) => T): T => {
	const repo = mkdtempSync(join(tmpdir(), `exp165-${name}-`));
	try {
		git(repo, "init", "-q", ...(bare ? ["--bare"] : []), "-b", "main");
		git(repo, "config", "gc.auto", "0");
		return f(repo);
	} finally {
		rmSync(repo, {recursive: true, force: true});
	}
};

/** How many stacked cases to make. */
const STACK_RUNS = Number(process.env.STACK_RUNS ?? 600);

const runGenerated = () => {
	const flat = withRepo("gen", true, (repo) =>
		score({
			title: "Part 6a: generated cases, one PR on main",
			arb: specArb,
			runs: RUNS,
			build,
			ask: (c) => askFlat(repo, c),
			ways: GEN_WAYS,
			stale: ["stable", "verbatim", "u0", "u0v", "fn", "replay"],
		}),
	);
	writeFileSync(GEN_RESULTS, `${JSON.stringify(flat, null, "\t")}\n`);
	console.log(`(${asked.size} cases asked of git, in one bare repo, removed.)\n`);
};

const runStacked = () => {
	const stacked = withRepo("stack", false, (work) =>
		score({
			title: "Part 6b: generated cases, a child PR stacked on a parent PR",
			arb: stackArb,
			runs: STACK_RUNS,
			build: buildStack,
			ask: (c) => askStack(work, c),
			ways: STACK_WAYS,
			stale: ["verbatim (branch)", "u0v (branch)", "replay (branch)"],
			kind: (c) => c.why.slice(0, c.why.indexOf(".")),
		}),
	);
	writeFileSync(STACK_RESULTS, `${JSON.stringify(stacked, null, "\t")}\n`);
	console.log("(One work repo for the stacked cases, removed.)\n");
};

// ---------------------------------------------------------------- main

const part = process.argv[2] ?? "all";
if (part === "all" || part === "cases") runCases();
if (part === "all" || part === "gen") runGenerated();
if (part === "all" || part === "stack") runStacked();
if (part === "all" || part === "real") runReal();
