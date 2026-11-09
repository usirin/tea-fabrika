// gc.ts: `box.sh gc [--dry-run]`. Remove the boxes whose work is safe somewhere else, so dead boxes
// never fill the disk again. Today's lead tooling, run on our own laptop; it is not product.
//
//   a box is kept while   a process has its cwd there, or its git index changed in the last 2 h
//                         (or its git data or folder did, so a box being made is safe),
//                         or drive kept it stuck less than 24 h ago, or it holds uncommitted
//                         or untracked files (a backup saves only HEAD, so they would be lost)
//   else it is removed    when its branch (minus -wip) has a merged pull request, or its HEAD is
//                         on a remote branch; else its HEAD is pushed as the bot to <branch>-wip
//                         first (fabrikalfa/<box>-wip when that is refused), and kept if both fail
//   then                  every state/<box>.box whose box folder is gone is removed too
//
// It never runs a command inside a box: it reads the box's git data with hooks off, and fetches
// from it into the main checkout, as `box.sh fetch` does. One line per box removed, then a total.

import {spawnSync} from "node:child_process";
import {existsSync, readdirSync, readFileSync, rmSync, statSync} from "node:fs";
import {isAbsolute, join, resolve} from "node:path";
import {wipOf} from "./lane.ts";

const HOUR = 3_600_000;
export const IDLE = 2 * HOUR;
export const STUCK = 24 * HOUR;

/** What gc saw of one box. All of it is read before anything is decided. */
export type Seen = {
	readonly name: string;
	/** `null`: no `.git` here, so it is not a box (a log folder, a half-made box). */
	readonly git: {readonly head: string | null; readonly branch: string | null} | null;
	readonly busy: boolean;
	/** Milliseconds since the git index (or the git data, when there is no index) last changed. */
	readonly idle: number;
	/** Milliseconds since drive kept this box stuck; `null` when drive did not keep it. */
	readonly stuck: number | null;
	readonly merged: boolean;
	readonly onRemote: boolean;
	/** Uncommitted and untracked files in the box; `null` when git could not say. */
	readonly dirty: number | null;
};

export type Verdict =
	| {readonly _tag: "keep"; readonly reason: string}
	| {readonly _tag: "remove"; readonly reason: "merged" | "on_remote"}
	| {readonly _tag: "backup"; readonly to: readonly string[]};

/** The branch a box's commits are backed up to, best first. */
export const backupsOf = (name: string, branch: string | null): string[] => {
	const own = `fabrikalfa/${name}-wip`;
	const wip = branch === null ? null : wipOf(branch);
	return wip?.startsWith("fabrikalfa/") && wip !== own ? [wip, own] : [own];
};

/** The `state/*.box` files whose box folder is gone: facts of a dead box, which stepcommit would
 * otherwise still read. A box saves its facts only after its folder exists, so none is half made. */
export const deadFacts = (files: readonly string[], boxes: ReadonlySet<string>): string[] =>
	files.filter((f) => f.endsWith(".box") && !boxes.has(f.slice(0, -".box".length)));

/** The Check, pure. */
export const decide = (s: Seen): Verdict => {
	if (s.git === null) return {_tag: "keep", reason: "not a git checkout"};
	if (s.busy) return {_tag: "keep", reason: "a process is working in it"};
	if (s.idle < IDLE)
		return {_tag: "keep", reason: `touched ${Math.round(s.idle / 60_000)} min ago`};
	if (s.stuck !== null && s.stuck < STUCK)
		return {_tag: "keep", reason: `stuck, kept by drive ${Math.round(s.stuck / HOUR)} h ago`};
	if (s.git.head === null) return {_tag: "keep", reason: "no HEAD commit"};
	// A backup pushes HEAD only, so files never committed would go with the folder (field note
	// 2026-11-09-42: a box removed with 10 uncommitted product files). The lead saves or drops them.
	if (s.dirty === null) return {_tag: "keep", reason: "its files could not be read"};
	if (s.dirty > 0) return {_tag: "keep", reason: `${s.dirty} uncommitted files`};
	if (s.merged) return {_tag: "remove", reason: "merged"};
	if (s.onRemote) return {_tag: "remove", reason: "on_remote"};
	return {_tag: "backup", to: backupsOf(s.name, s.git.branch)};
};

// ---------------------------------------------------------------- the world

const sh = (cmd: string, args: readonly string[], cwd?: string) => {
	const r = spawnSync(cmd, args, {cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
	return {code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? ""};
};
const SAFE = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];

type Env = {readonly MAIN: string; readonly BOXES: string; readonly GH_REPO: string};

const loadEnv = (): Env => {
	const r = sh("sh", [
		"-c",
		'. "$0" && printf "%s\\n%s\\n%s\\n" "$MAIN" "$BOXES" "$GH_REPO"',
		join(import.meta.dirname, "env.sh"),
	]);
	const [MAIN = "", BOXES = "", GH_REPO = ""] = r.out.split("\n");
	if (r.code !== 0 || !MAIN || !BOXES) throw new Error(`env.sh failed: ${r.err}`);
	return {MAIN, BOXES, GH_REPO};
};

/** How many uncommitted and untracked files a box holds, read from its git data with hooks and
 * fsmonitor off; `null` when git cannot say. */
export const dirtyIn = (gitDir: string, box: string): number | null => {
	const r = sh("git", [
		...SAFE,
		"-c",
		"status.renames=false",
		`--git-dir=${gitDir}`,
		`--work-tree=${box}`,
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=all",
	]);
	// No rename pairs, so each NUL-ended entry is one file.
	return r.code === 0 ? r.out.split("\0").filter(Boolean).length : null;
};

/** The folder a box's `.git` file points at, or the `.git` folder itself. */
const gitDirOf = (box: string): string | null => {
	const dot = join(box, ".git");
	if (!existsSync(dot)) return null;
	if (statSync(dot).isDirectory()) return dot;
	const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dot, "utf8"));
	if (!m?.[1]) return null;
	return isAbsolute(m[1].trim()) ? m[1].trim() : resolve(box, m[1].trim());
};

const mtime = (path: string) => (existsSync(path) ? statSync(path).mtimeMs : 0);

/** Every working folder some process sits in, from one lsof call. */
const cwds = (): string[] =>
	sh("lsof", ["-a", "-d", "cwd", "-Fn"])
		.out.split("\n")
		.filter((l) => l.startsWith("n/"))
		.map((l) => l.slice(1));

/** Box name to when drive kept it stuck, from `state/<lane>.json`. */
const keptByDrive = (boxes: string): Map<string, number> => {
	const kept = new Map<string, number>();
	const dir = join(boxes, "state");
	if (!existsSync(dir)) return kept;
	for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
		try {
			const lane = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
				steps?: {box?: string; kept?: boolean; ended?: string}[];
			};
			for (const step of lane.steps ?? [])
				if (step.kept && step.box) kept.set(step.box, Date.parse(step.ended ?? "") || Date.now());
		} catch {}
	}
	return kept;
};

const sizeMb = (paths: readonly string[]) => {
	const there = paths.filter(existsSync);
	if (there.length === 0) return 0;
	const r = sh("du", ["-sk", ...there]);
	return Math.round(
		r.out
			.split("\n")
			.filter(Boolean)
			.reduce((n, l) => n + Number(l.split("\t")[0] ?? 0), 0) / 1024,
	);
};

const main = () => {
	const args = process.argv.slice(2);
	const dry = args.includes("--dry-run");
	if (args.some((a) => a !== "--dry-run")) {
		console.error("usage: box.sh gc [--dry-run]");
		process.exit(2);
	}
	const env = loadEnv();
	if (!existsSync(env.BOXES)) {
		console.log("gc: no boxes folder");
		return;
	}
	const repo = (...a: string[]) => sh("git", ["-C", env.MAIN, ...SAFE, ...a]);
	const common = resolve(env.MAIN, repo("rev-parse", "--git-common-dir").out.trim());
	repo("fetch", "-q", "origin");
	const merged = new Set(
		sh("gh", [
			"pr",
			"list",
			"-R",
			env.GH_REPO,
			"--state",
			"merged",
			"--limit",
			"1000",
			"--json",
			"headRefName",
			"-q",
			".[].headRefName",
		]).out.split("\n"),
	);
	merged.delete("");
	const busyIn = cwds();
	const kept = keptByDrive(env.BOXES);
	const now = Date.now();
	let removed = 0;
	let freed = 0;
	let keptCount = 0;
	const names = readdirSync(env.BOXES, {withFileTypes: true})
		.filter((d) => d.isDirectory() && d.name !== "state" && !d.name.endsWith("-gitdata"))
		.map((d) => d.name)
		.sort();
	for (const name of names) {
		const box = join(env.BOXES, name);
		const gitDir = gitDirOf(box);
		const git =
			gitDir === null
				? null
				: (() => {
						const g = (...a: string[]) => sh("git", [...SAFE, `--git-dir=${gitDir}`, ...a]);
						const head = g("rev-parse", "--verify", "-q", "HEAD^{commit}").out.trim() || null;
						const branch = g("symbolic-ref", "-q", "--short", "HEAD").out.trim() || null;
						return {head, branch};
					})();
		const head = git?.head ?? null;
		const inMain = head !== null && repo("cat-file", "-e", `${head}^{commit}`).code === 0;
		const onRemote =
			inMain &&
			repo("for-each-ref", "--count=1", "--contains", head, "refs/remotes/origin").out.trim() !==
				"";
		const branch = git?.branch?.replace(/(-wip)+$/, "") ?? null;
		const seen: Seen = {
			name,
			git,
			busy: busyIn.some((p) => p === box || p.startsWith(`${box}/`)),
			// The newest of the index, the git data and the box folder, so a box still being made counts.
			idle:
				now -
				Math.max(mtime(box), gitDir ? Math.max(mtime(gitDir), mtime(join(gitDir, "index"))) : 0),
			stuck: kept.has(name) ? now - (kept.get(name) ?? now) : null,
			merged: branch !== null && merged.has(branch),
			onRemote,
			dirty: gitDir === null ? null : dirtyIn(gitDir, box),
		};
		const verdict = decide(seen);
		if (verdict._tag === "keep") {
			keptCount += 1;
			continue;
		}
		let why: string = verdict._tag === "remove" ? verdict.reason : "";
		if (verdict._tag === "backup") {
			if (dry) why = `would back up to ${verdict.to[0]}`;
			else {
				// Fetch the box's HEAD and step notes into the main checkout, then push from there.
				const ref = `refs/gc/${name}`;
				if (repo("fetch", "-q", "-f", box, `HEAD:${ref}`).code !== 0) {
					console.log(`keep ${name}: could not fetch its HEAD`);
					keptCount += 1;
					continue;
				}
				if (repo("fetch", "-q", "-f", box, `refs/notes/fabrika:refs/notes/box-${name}`).code === 0)
					repo("notes", "--ref=fabrika", "merge", "-q", "-s", "cat_sort_uniq", `box-${name}`);
				const pushed = verdict.to.find(
					(to) =>
						sh("node", [join(import.meta.dirname, "botpush.mjs"), env.MAIN, to, ref]).code === 0,
				);
				repo("update-ref", "-d", ref);
				if (pushed === undefined) {
					console.log(`keep ${name}: backup push refused (${verdict.to.join(", ")})`);
					keptCount += 1;
					continue;
				}
				why = `backed up to ${pushed}`;
			}
		}
		const twin = gitDir === join(env.BOXES, `${name}-gitdata`) ? [gitDir] : [];
		const mb = sizeMb([box, ...twin]);
		if (!dry) {
			if (gitDir?.startsWith(`${join(common, "worktrees")}/`))
				repo("worktree", "remove", "--force", "--force", box);
			rmSync(box, {recursive: true, force: true});
			for (const t of twin) rmSync(t, {recursive: true, force: true});
		}
		removed += 1;
		freed += mb;
		console.log(`${dry ? "would remove" : "removed"} ${name}: ${why}, ${mb} MB`);
	}
	const state = join(env.BOXES, "state");
	const left = new Set(
		readdirSync(env.BOXES, {withFileTypes: true})
			.filter((d) => d.isDirectory())
			.map((d) => d.name),
	);
	const dead = existsSync(state) ? deadFacts(readdirSync(state), left) : [];
	for (const f of dead) {
		if (!dry) rmSync(join(state, f), {force: true});
		console.log(`${dry ? "would remove" : "removed"} state/${f}: its box is gone`);
	}
	if (!dry) repo("worktree", "prune");
	console.log(
		`gc: ${dry ? "would remove" : "removed"} ${removed} boxes, ${freed} MB; kept ${keptCount}`,
	);
};

if (import.meta.main) main();
