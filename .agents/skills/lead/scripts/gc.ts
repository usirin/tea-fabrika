// gc.ts: `box.sh gc [--dry-run]`. Remove the boxes whose work is safe somewhere else, so dead boxes
// never fill the disk again. Today's lead tooling, run on our own laptop; it is not product.
//
//   a box is kept while   a process has its cwd there, or its git index, HEAD log or folder changed
//                         in the last 2 h (lastTouched; gc's own reads write none of them),
//                         or drive kept it stuck less than 24 h ago and its lane has not landed,
//                         or it holds uncommitted
//                         or untracked files (a backup saves only HEAD, so they would be lost)
//   else it is removed    when its branch (minus -wip) has a merged pull request, or its HEAD is
//                         on a remote branch; else its HEAD is pushed as the bot to <branch>-wip
//                         first (fabrikalfa/<box>-wip when that is refused), and kept if both fail
//   then                  every state/<box>.box whose box folder is gone is removed too, and every
//                         linked worktree of the main checkout outside the boxes folder whose
//                         lane landed (decideWorktree): its branch stays in the main checkout
//
// Every keep is printed with its reason, so a box that never goes is seen (field note
// 2026-11-09-254: gc's own git status reset the idle clock, so for a day no box was ever removed).
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
	/** The processes whose working folder is in the box. */
	readonly busy: readonly number[];
	/** Milliseconds since lastTouched. */
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
	if (s.busy.length > 0)
		return {_tag: "keep", reason: `a process is working in it (pid ${s.busy.join(", ")})`};
	if (s.idle < IDLE)
		return {_tag: "keep", reason: `touched ${Math.round(s.idle / 60_000)} min ago`};
	// A stuck box is kept for the lead to read, until its lane lands (0019).
	if (s.stuck !== null && s.stuck < STUCK && !s.merged)
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

/** What gc saw of one linked worktree of the main checkout, outside the boxes folder. */
export type SeenWorktree = {
	readonly branch: string | null;
	readonly locked: boolean;
	readonly busy: readonly number[];
	readonly idle: number;
	readonly dirty: number | null;
	/** The pull requests holding its work (worktreePrs): what state each is in. */
	readonly prs: readonly PrState[];
};

export type PrState = "OPEN" | "MERGED" | "CLOSED";

/** The pull requests holding a worktree's work: those of its own branch (minus -wip), of every
 * remote branch whose tip is its HEAD, and every one whose head commit is its HEAD. A lead's
 * worktree is often pushed under another name (botpush to fabrikalfa/<lane>), so its own branch
 * name alone missed a merged lane and gc kept it for good (2026-11-09: PR 623's worktree). */
export const worktreePrs = (
	w: {
		readonly branch: string | null;
		readonly head: string | null;
		readonly tips: readonly string[];
	},
	byRef: ReadonlyMap<string, readonly PrState[]>,
	byHead: ReadonlyMap<string, readonly PrState[]>,
): PrState[] => [
	...(w.branch === null ? [] : (byRef.get(w.branch.replace(/(-wip)+$/, "")) ?? [])),
	...w.tips.flatMap((t) => byRef.get(t.replace(/(-wip)+$/, "")) ?? []),
	...(w.head === null ? [] : (byHead.get(w.head) ?? [])),
];

/** A worktree goes once its lane landed, clean and idle. Its branch stays in the main checkout, so
 * only the folder goes; a worktree with no lane branch is someone's own and stays. */
export const decideWorktree = (w: SeenWorktree): Verdict => {
	if (w.locked) return {_tag: "keep", reason: "locked"};
	if (w.busy.length > 0)
		return {_tag: "keep", reason: `a process is working in it (pid ${w.busy.join(", ")})`};
	if (w.idle < IDLE)
		return {_tag: "keep", reason: `touched ${Math.round(w.idle / 60_000)} min ago`};
	if (w.branch === null) return {_tag: "keep", reason: "no branch checked out"};
	if (w.dirty === null) return {_tag: "keep", reason: "its files could not be read"};
	if (w.dirty > 0) return {_tag: "keep", reason: `${w.dirty} uncommitted files`};
	if (w.prs.includes("OPEN")) return {_tag: "keep", reason: "its pull request is open"};
	if (w.prs.includes("MERGED")) return {_tag: "remove", reason: "merged"};
	if (w.prs.includes("CLOSED")) return {_tag: "remove", reason: "closed"};
	return {_tag: "keep", reason: "no pull request yet"};
};

// ---------------------------------------------------------------- the world

// GIT_OPTIONAL_LOCKS=0: git status then never refreshes the index or makes index.lock, so a read
// leaves every mtime lastTouched reads as it was.
const sh = (cmd: string, args: readonly string[], cwd?: string) => {
	const r = spawnSync(cmd, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		env: {...process.env, GIT_OPTIONAL_LOCKS: "0"},
	});
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

/** When the HEAD log's newest entry was written, from its own time stamp, in ms; 0 when none. Not
 * the file's mtime: git gc's reflog expiry rewrites every worktree's log and so changes that. */
export const lastLogged = (log: string): number => {
	if (!existsSync(log)) return 0;
	const last = readFileSync(log, "utf8").trimEnd().split("\n").at(-1) ?? "";
	const m = / (\d+) [+-]\d{4}\t/.exec(last);
	return m?.[1] ? Number(m[1]) * 1000 : 0;
};

/** When work last happened in a box: the newest of its folder (a box being made), its index (an
 * add, a checkout) and its HEAD log's newest entry (a commit, a reset). Never the git data folder
 * itself: any git command's lock files change that. */
export const lastTouched = (box: string, gitDir: string | null): number =>
	Math.max(
		mtime(box),
		gitDir === null
			? 0
			: Math.max(mtime(join(gitDir, "index")), lastLogged(join(gitDir, "logs", "HEAD"))),
	);

/** Every working folder some process sits in, with its pid, from one lsof call. */
const cwds = (): {readonly pid: number; readonly path: string}[] => {
	const out: {pid: number; path: string}[] = [];
	let pid = 0;
	for (const l of sh("lsof", ["-a", "-d", "cwd", "-Fpn"]).out.split("\n")) {
		if (l.startsWith("p")) pid = Number(l.slice(1));
		else if (l.startsWith("n/")) out.push({pid, path: l.slice(1)});
	}
	return out;
};

const pidsIn = (busyIn: readonly {pid: number; path: string}[], dir: string) => [
	...new Set(
		busyIn.filter((c) => c.path === dir || c.path.startsWith(`${dir}/`)).map((c) => c.pid),
	),
];

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
	const prsOf = new Map<string, PrState[]>();
	const prsAt = new Map<string, PrState[]>();
	const listed = sh("gh", [
		"pr",
		"list",
		"-R",
		env.GH_REPO,
		"--state",
		"all",
		"--limit",
		"5000",
		"--json",
		"headRefName,headRefOid,state",
		"-q",
		'.[] | "\\(.state) \\(.headRefName) \\(.headRefOid)"',
	]);
	if (listed.code !== 0) {
		console.error(`gc: gh could not list pull requests: ${listed.err.trim()}`);
		process.exit(1);
	}
	for (const line of listed.out.split("\n")) {
		const [state, ref, oid] = line.split(" ");
		if (state !== "OPEN" && state !== "MERGED" && state !== "CLOSED") continue;
		if (ref) prsOf.set(ref, [...(prsOf.get(ref) ?? []), state]);
		if (oid) prsAt.set(oid, [...(prsAt.get(oid) ?? []), state]);
	}
	const merged = new Set([...prsOf].filter(([, s]) => s.includes("MERGED")).map(([r]) => r));
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
			busy: pidsIn(busyIn, box),
			idle: now - lastTouched(box, gitDir),
			stuck: kept.has(name) ? now - (kept.get(name) ?? now) : null,
			merged: branch !== null && merged.has(branch),
			onRemote,
			dirty: gitDir === null ? null : dirtyIn(gitDir, box),
		};
		const verdict = decide(seen);
		if (verdict._tag === "keep") {
			console.log(`keep ${name}: ${verdict.reason}`);
			keptCount += 1;
			continue;
		}
		let why: string = verdict._tag === "remove" ? verdict.reason : "";
		// A merged lane's box may hold commits no remote has: keep its HEAD in the main checkout.
		if (verdict._tag === "remove" && !onRemote && !dry) {
			if (repo("fetch", "-q", "-f", box, `HEAD:refs/keep/box/${name}`).code !== 0) {
				console.log(`keep ${name}: could not save its HEAD`);
				keptCount += 1;
				continue;
			}
			why += `, HEAD kept at refs/keep/box/${name}`;
		}
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
	// Linked worktrees outside the boxes folder: a lead's or an agent's own checkout of a lane.
	let trees = 0;
	const blocks = repo("worktree", "list", "--porcelain").out.split("\n\n").filter(Boolean);
	for (const block of blocks.slice(1)) {
		const lines = block.split("\n");
		const path = lines.find((l) => l.startsWith("worktree "))?.slice(9) ?? "";
		if (!path || path === env.MAIN || path.startsWith(`${env.BOXES}/`) || !existsSync(path))
			continue;
		const ref = lines.find((l) => l.startsWith("branch "))?.slice("branch refs/heads/".length);
		const gitDir = gitDirOf(path);
		const branch = ref ?? null;
		const head = lines.find((l) => l.startsWith("HEAD "))?.slice(5) ?? null;
		const tips =
			head === null
				? []
				: repo(
						"for-each-ref",
						"--points-at",
						head,
						"--format=%(refname:lstrip=3)",
						"refs/remotes/origin",
					)
						.out.split("\n")
						.filter(Boolean);
		const verdict = decideWorktree({
			branch,
			locked: lines.some((l) => l === "locked" || l.startsWith("locked ")),
			busy: pidsIn(busyIn, path),
			idle: now - lastTouched(path, gitDir),
			dirty: gitDir === null ? null : dirtyIn(gitDir, path),
			prs: worktreePrs({branch, head, tips}, prsOf, prsAt),
		});
		if (verdict._tag !== "remove") {
			console.log(`keep worktree ${path}: ${verdict._tag === "keep" ? verdict.reason : ""}`);
			keptCount += 1;
			continue;
		}
		const mb = sizeMb([path]);
		// Without --force: git itself refuses a worktree with changes, a second guard.
		if (!dry && repo("worktree", "remove", path).code !== 0) {
			console.log(`keep worktree ${path}: git worktree remove refused`);
			keptCount += 1;
			continue;
		}
		trees += 1;
		freed += mb;
		console.log(
			`${dry ? "would remove" : "removed"} worktree ${path}: ${verdict.reason}, ${mb} MB`,
		);
	}
	console.log(
		`gc: ${dry ? "would remove" : "removed"} ${removed} boxes and ${trees} worktrees, ${freed} MB; kept ${keptCount}`,
	);
};

if (import.meta.main) main();
