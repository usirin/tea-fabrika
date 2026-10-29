// Experiment 165: should a review verdict be tied to the PR's diff instead of its head commit?
// The diff's name is `git patch-id --stable` of the PR's whole diff against the point where it
// left main. Does that name stay the same when it should, and change when it must?
//
// Run with
//   env -u TYPESAFE_API_KEY -u OPENAI_API_KEY -u CODEX_API_KEY nice -n 15 \
//     node experiments/165-review-binds-to-diff.ts          # cases, then real data
//   ... node experiments/165-review-binds-to-diff.ts cases    # parts 1 to 4 only, no network
//   ... node experiments/165-review-binds-to-diff.ts real     # part 5 only
//
// Parts 1 to 4 build throwaway git repos in one temp folder and remove it at the end.
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

const here = import.meta.dirname;
/** The repo part 5 reads. REPO=<another GitHub URL> reads another one. */
const REPO = process.env.REPO ?? "https://github.com/usirin/tea-fabrika";
const RESULTS = join(here, "results", "165-review-binds-to-diff.json");

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

const sh = (cmd: string, args: readonly string[], cwd: string, input?: string): Ran => {
	const r = spawnSync(cmd, args, {cwd, input, env: ENV, encoding: "utf8", maxBuffer: 1 << 28});
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
const rangeDiff = (cwd: string, a: string, b: string, main = "main") => {
	const out = git(
		cwd,
		"range-diff",
		"--no-color",
		`${mergeBase(cwd, main, a)}..${a}`,
		`${mergeBase(cwd, main, b)}..${b}`,
	);
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

// ---------------------------------------------------------------- main

const part = process.argv[2] ?? "all";
if (part === "all" || part === "cases") runCases();
if (part === "all" || part === "real") runReal();
