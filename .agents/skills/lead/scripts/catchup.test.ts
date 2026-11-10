import "./catchup.sh?raw";
import "./leakgrep.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
import "./env.sh?raw";
import "./box.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
import "./fieldrow.py?raw";
import "./runplan.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gc.ts?raw";
import "./redact.sh?raw";
import "./clauderow.py?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./lane.ts?raw";
import "../../plan/scripts/plancheck.sh?raw";
import "../../step-commit/scripts/exam.py?raw";
import "../../step-commit/scripts/stepcommit.sh?raw";
import {spawnSync} from "node:child_process";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {basename, join, relative} from "node:path";
import fc from "fast-check";
import {describe, expect, it} from "vitest";

// YAML belongs to the CI workspace package, not the lead scripts' package.
const {parse} = createRequire(new URL("../../../../.github/ci/package.json", import.meta.url))(
	"yaml",
) as {parse: (text: string) => {jobs: {next: {strategy: {matrix: {shard: number[]}}}}}};

// Today's tooling. GitHub, signing and pushes are stubbed. Cleanup uses disposable local Git.
const script = join(import.meta.dirname, "catchup.sh");
const tip = "0123456789abcdef0123456789abcdef01234567";
const workflow = parse(
	readFileSync(join(import.meta.dirname, "../../../../.github/workflows/check.yaml"), "utf8"),
);
const nextNames: string[] = workflow.jobs.next.strategy.matrix.shard.map(
	(index: number) => `next (${index})`,
);
type Check = {name: string; status: string; conclusion: string};
const success = (name: string): Check => ({name, status: "completed", conclusion: "success"});
const matrixChecks = ["check", "e2e", "commits", ...nextNames].map(success);
const storageFiles = (root: string) => {
	const files: Record<string, string> = {};
	const visit = (path: string, name: string) => {
		const info = lstatSync(path);
		files[name] = info.isSymbolicLink()
			? `link:${readlinkSync(path)}`
			: info.isFile()
				? `file:${readFileSync(path).toString("base64")}`
				: "directory";
		if (info.isDirectory())
			for (const child of readdirSync(path)) visit(join(path, child), `${name}/${child}`);
	};
	visit(root, ".");
	return files;
};
const reads = ["head", "checks", "trust", "apps", "logs"] as const;
const options = {seed: 520, numRuns: 12};
type Call = {cmd: string; args: string[]; key?: string};
type Setup = {
	checks?: Check[];
	repo?: string;
	failures: number[];
	pending: number;
	answer: "green" | "red" | "event" | "duplicate" | "startup" | "app" | "ticket" | "trust-red";
	branch: string;
	merge: boolean;
	refused: "none" | "notes" | "branch";
	cleanup?: "clean" | "dirty" | "locked" | "unsaved" | "malformed" | "error";
	mergeFails?: boolean;
	// Cleanup trouble: worktree listing fails, keeping the head fails, the catch-up checkout is
	// not registered, or two forced worktrees share the PR branch.
	trouble?: "list" | "keep" | "unregistered" | "twins" | "missing";
	protected?: "main-work" | "main-data" | "main-child" | "main-data-child" | "state";
	protectedDepth?: number;
	storage?: {
		binding: "gitdir" | "commondir" | "objects" | "alternates" | "alternates-file";
		worktree: "catchup-900" | "driver";
		parts: string[];
		through: boolean;
		relative: boolean;
		hops: number;
	};
	deepStorage?: {
		worktree: "catchup-900" | "driver";
		location: "work" | "admin";
		kind: string;
		root: "gitdir" | "common" | "alternate";
		parts: string[];
		through: boolean;
		relative: boolean;
	};
	sharedAdmin?: "catchup-900" | "driver";
	unwalkable?: {worktree: "catchup-900" | "driver"; parts: string[]};
	// In a gh stack: `gh pr merge` refuses, and the head read again is `moved` or not.
	stack?: "none" | "same" | "moved";
	// Seconds since the start, read by `date` after that many check reads (the last one repeats).
	clock?: number[];
};
const green: Setup = {
	failures: [0, 0, 0, 0, 0],
	pending: 0,
	answer: "green",
	branch: "fabrikalfa/tests-520",
	merge: false,
	refused: "none",
};
// The stub uses the platform's absolute Node executable. Its PATH never contains a real gh,
// node or pnpm, and each write-capable command is refused unless handled here.
const stub = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const dir = process.env.CATCHUP_FIXTURE;
const setup = JSON.parse(fs.readFileSync(path.join(dir, "setup.json"), "utf8"));
const stateFile = path.join(dir, "state.json");
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {};
const cmd = path.basename(process.argv[1]);
const args = process.argv.slice(2);
let key;
if (cmd === "gh") {
  if (args[0] === "pr" && args[1] === "view") key = args.includes("headRefOid") ? "oid" : "head";
  else if (args[0] === "stack" && args[1] === "merge") key = "stack";
  else if (args[0] === "pr" && args[1] === "merge") key = "merge";
  else if (args[0] === "run" && args[1] === "view") key = "logs";
  else if (args[0] === "api" && args[1].includes("check_name=")) key = "apps";
  else if (args[0] === "api" && args[1].includes("check-runs?")) key = "checks";
  else if (args[0] === "api" && args[1].includes("actions/runs?")) key = "trust";
}
fs.appendFileSync(path.join(dir, "calls.jsonl"), JSON.stringify({cmd, args, key}) + "\n");
const die = (text) => { console.error(text); process.exit(1); };
if (cmd === "gh") {
  if (!key) die("unhandled gh command");
  const n = state[key] || 0;
  state[key] = n + 1;
  fs.writeFileSync(stateFile, JSON.stringify(state));
  const index = ["head", "checks", "trust", "apps", "logs"].indexOf(key);
  if (index >= 0 && n < setup.failures[index]) {
    // Failed logs can still print a plausible result. Exit status must win.
    if (key === "logs") console.log("commits\tcheck\t2026-11-08T00:00:00Z commits: 3 commits, ticket 520");
    die("temporary " + key + " read failure");
  }
  if (key === "head") console.log(setup.branch);
  if (key === "oid") console.log(setup.stack === "moved" ? "f".repeat(40) : process.env.CATCHUP_TIP);
  if (key === "merge" && setup.stack && setup.stack !== "none")
    die("This pull request is part of a stack and must be merged using the asynchronous merge REST API");
  if (key === "checks") {
    const pending = n - setup.failures[index] < setup.pending;
    if (setup.checks) {
      for (const check of setup.checks) console.log(check.name + "\t" + check.status + "\t" + check.conclusion);
    } else for (const name of ["check", "e2e", "commits", ...${JSON.stringify(nextNames)}, "next"]) {
      const red = setup.answer === "red" && name === "check";
      // Existing non-waiter laws also provide a skipped bare job while the waiter changes.
      // T376's isolated laws below never add this compatibility check to a matrix answer.
      console.log(name + "\t" + (pending ? "in_progress\t" : "completed\t" + (red ? "failure" : name === "next" ? "skipped" : "success")));
    }
  }
  if (key === "trust") {
    const event = setup.answer === "event" ? "push" : "pull_request_target";
    const result = setup.answer === "trust-red" ? "failure" : "success";
    if (setup.answer === "startup") console.log("70\tpull_request_target\tcompleted\tstartup_failure\t80");
    console.log("71\t" + event + "\tcompleted\t" + result + "\t81");
    if (setup.answer === "duplicate") console.log("72\tpull_request_target\tcompleted\tsuccess\t82");
  }
  if (key === "apps") console.log(setup.answer === "app" ? "impostor" : "github-actions");
  if (key === "logs") console.log("commits\tcheck\t2026-11-08T00:00:00Z commits: 3 commits, ticket " + (setup.answer === "ticket" ? "521" : "520"));
  if (key === "merge" && setup.mergeFails) die("merge refused");
  process.exit(0);
}
if (cmd === "git") {
  if (setup.repo && (args.includes("merge-base") || args.includes("merge"))) {
    const at = args.includes("merge-base") ? args.indexOf("merge-base") : args.indexOf("merge");
    const ran = require("node:child_process").spawnSync("/usr/bin/git", ["-C", setup.repo, ...args.slice(at)], {encoding: "utf8"});
    process.stdout.write(ran.stdout || ""); process.stderr.write(ran.stderr || "");
    process.exit(ran.status ?? 1);
  }
  if (args.includes("merge-base")) process.exit(setup.merge ? 1 : 0);
  const op = args[0] === "-C" ? args.slice(2) : args;
  const local = ["update-ref", "worktree", "rev-parse", "for-each-ref", "status", "cat-file", "show-ref", "symbolic-ref", "rev-list", "config", "ls-files", "log"];
  if (setup.cleanup && args.some(a => local.includes(a)) && !["fetch", "checkout", "push"].includes(op[0]) && !args.includes("merge")) {
    if (setup.cleanup === "error" && args.includes("remove") && args.some(a => a.endsWith("driver"))) die("planted worktree removal failure");
    if (setup.trouble === "list" && args.includes("worktree") && args.includes("list")) die("planted worktree list failure");
    if (setup.trouble === "keep" && args.includes("refs/keep/pr/900")) die("planted keep ref failure");
    const ran = require("node:child_process").spawnSync("/usr/bin/git", args, {encoding: "utf8"});
    process.stdout.write(ran.stdout || ""); process.stderr.write(ran.stderr || ""); process.exit(ran.status ?? 1);
  }
  if (!setup.cleanup && (args.includes("update-ref") || args.includes("worktree"))) process.exit(0);
  if (args[0] === "rev-parse") console.log(args.includes("--short") ? process.env.CATCHUP_TIP.slice(0, 7) : process.env.CATCHUP_TIP);
  else if (args[0] === "push" && setup.refused === "branch") die("branch push refused");
  else if (!["fetch", "checkout", "push", "rev-parse"].includes(args[0]) && !args.includes("merge")) die("unhandled git command");
  process.exit(0);
}
if (cmd === "node") {
  if (!args[0].endsWith("/botpush.mjs")) die("unhandled node command");
  if (setup.refused === "notes" || setup.refused === "branch" && setup.branch.startsWith("fabrikalfa/")) die("atomic push refused");
  process.exit(0);
}
if (cmd === "pnpm" || cmd === "nice") process.exit(0);
if (cmd === "sleep") process.exit(0);
if (cmd === "date") {
  const clock = setup.clock || [0];
  console.log(String(1794096000 + clock[Math.min(state.checks || 0, clock.length - 1)]));
  process.exit(0);
}
die("unhandled tool: " + cmd);
`;
const run = (setup: Setup, args: string[] = []) => {
	const dir = mkdtempSync(join(tmpdir(), "cu-"));
	try {
		const bin = join(dir, "bin");
		mkdirSync(bin);
		mkdirSync(join(dir, "home"));
		mkdirSync(join(dir, "boxes/catchup-900/node_modules"), {recursive: true});
		const localEnv = {
			...process.env,
			HOME: join(dir, "home"),
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: "/dev/null",
			TYPESAFE_API_KEY: undefined,
		};
		const git = (at: string, ...commands: string[]) => {
			const got = spawnSync("/usr/bin/git", ["-C", at, ...commands], {
				encoding: "utf8",
				env: localEnv,
				timeout: 5_000,
			});
			expect(got.status, got.stderr).toBe(0);
			return got.stdout.trim();
		};
		let checkedTip = tip;
		let main = dir;
		let storage = "",
			history = "";
		let admin = "";
		let stored = "";
		let savedStorage: Record<string, string> = {};
		let protectedWork = "",
			protectedData = "",
			saved = "";
		if (setup.cleanup) {
			git(dir, "init", "-q", "--initial-branch=main");
			git(dir, "config", "user.name", "Fixture");
			git(dir, "config", "user.email", "fixture@example.test");
			writeFileSync(join(dir, "tracked"), "base\n");
			writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
			git(dir, "add", "tracked", ".gitignore");
			git(dir, "commit", "-qm", "base");
			const base = git(dir, "rev-parse", "HEAD");
			git(dir, "checkout", "-qb", setup.branch);
			writeFileSync(join(dir, "tracked"), setup.branch);
			git(dir, "commit", "-qam", "checked head");
			checkedTip = git(dir, "rev-parse", "HEAD");
			git(dir, "checkout", "-q", "main");
			git(dir, "update-ref", "refs/remotes/origin/main", base);
			// Simulate a squash: the checked head is not an ancestor of main.
			writeFileSync(join(dir, "tracked"), `squashed ${setup.branch}`);
			git(dir, "commit", "-qam", "landed squash");
			rmSync(join(dir, "boxes/catchup-900"), {recursive: true});
			git(dir, "worktree", "add", "-q", "--detach", join(dir, "boxes/catchup-900"), checkedTip);
			mkdirSync(join(dir, "boxes/catchup-900/node_modules"));
			git(dir, "worktree", "add", "-q", join(dir, "boxes/driver"), setup.branch);
			git(dir, "branch", `${setup.branch}-sibling`, checkedTip);
			git(dir, "worktree", "add", "-q", join(dir, "boxes/sibling"), `${setup.branch}-sibling`);
			for (const [name, branch] of [
				["exact box", setup.branch],
				["sibling box", `${setup.branch}-sibling`],
				["later box", setup.branch],
			]) {
				const work = join(dir, "boxes", name!),
					data = `${work}-gitdata`;
				// Isolate cleanup from the normal clone's symbolic-ref bug, tested in box.test.ts.
				mkdirSync(work);
				git(work, "init", "-q", "--initial-branch=main", `--separate-git-dir=${data}`);
				git(work, "remote", "add", "origin", dir);
				git(work, "fetch", "-q", "origin", `${branch}:refs/heads/${branch}`);
				git(work, "checkout", "-q", branch!);
				expect(git(work, "remote")).toBe("origin");
				git(work, "config", "user.name", "Fixture");
				git(work, "config", "user.email", "fixture@example.test");
				if (name === "exact box") {
					if (setup.cleanup === "dirty") writeFileSync(join(work, "tracked"), "dirty");
					if (setup.cleanup === "unsaved") {
						writeFileSync(join(work, "tracked"), "unsaved");
						git(work, "commit", "-qam", "unsaved");
					}
					if (setup.cleanup === "malformed") writeFileSync(join(data, "HEAD"), "malformed");
				}
			}
			if (setup.cleanup === "dirty") writeFileSync(join(dir, "boxes/driver/tracked"), "dirty");
			if (setup.cleanup === "locked") git(dir, "worktree", "lock", join(dir, "boxes/driver"));
			if (setup.trouble === "unregistered") {
				git(dir, "worktree", "remove", "--force", join(dir, "boxes/catchup-900"));
				mkdirSync(join(dir, "boxes/catchup-900/node_modules"), {recursive: true});
			}
			if (setup.trouble === "twins")
				git(dir, "worktree", "add", "-q", "-f", join(dir, "boxes/driver twin"), setup.branch);
			if (setup.trouble === "missing") rmSync(join(dir, "boxes/driver"), {recursive: true});
			mkdirSync(join(dir, "boxes/state"));
			writeFileSync(join(dir, "boxes/state/driver.md"), "saved wait");
			if (setup.protected) {
				protectedWork = join(dir, "boxes", setup.protected === "state" ? "state" : "protected");
				protectedData = `${protectedWork}-gitdata`;
				mkdirSync(protectedWork, {recursive: true});
				git(protectedWork, "init", "-q", `--separate-git-dir=${protectedData}`);
				git(protectedWork, "remote", "add", "origin", dir);
				git(protectedWork, "fetch", "-q", "origin", `${setup.branch}:refs/heads/${setup.branch}`);
				git(protectedWork, "checkout", "-q", setup.branch);
				if (setup.protected !== "state") {
					main =
						setup.protected === "main-work"
							? protectedWork
							: setup.protected === "main-data"
								? protectedData
								: join(
										setup.protected === "main-data-child" ? protectedData : protectedWork,
										...Array.from({length: setup.protectedDepth ?? 1}, (_, i) => `nested-${i}`),
									);
					mkdirSync(main, {recursive: true});
				}
				saved = join(setup.protected === "state" ? protectedWork : main, "saved.md");
				writeFileSync(saved, setup.branch);
			}
			expect(git(dir, "remote")).toBe("");
			if (setup.deepStorage || setup.sharedAdmin || setup.unwalkable) {
				const original = join(dir, ".git");
				const worktree =
					setup.deepStorage?.worktree ?? setup.sharedAdmin ?? setup.unwalkable!.worktree;
				admin = git(join(dir, "boxes", worktree), "rev-parse", "--absolute-git-dir");
				history = git(dir, "rev-list", "--objects", "--all");
				if (setup.sharedAdmin) {
					// A worktree removal deletes its admin directory outside the work folder.
					// MAIN is another reader of that exact directory, with the same common store.
					const common = join(dir, "main-common");
					renameSync(original, common);
					for (const name of ["catchup-900", "driver", "sibling"]) {
						writeFileSync(
							join(dir, "boxes", name, ".git"),
							`gitdir: ${join(common, "worktrees", name)}\n`,
						);
					}
					admin = join(common, "worktrees", worktree);
					writeFileSync(original, `gitdir: ${admin}\n`);
					storage = admin;
					stored = admin;
				} else if (setup.unwalkable) {
					storage = join(original, "objects/pack", ...setup.unwalkable.parts);
					mkdirSync(join(storage, ".."), {recursive: true});
					symlinkSync(join(dir, "missing-storage"), storage);
				} else {
					const path = setup.deepStorage!;
					git(dir, "pack-refs", "--all");
					if (path.kind === "objects/pack") git(dir, "repack", "-ad");
					if (path.kind === "refs") git(dir, "update-ref", "refs/keep/storage", "HEAD");
					history = git(dir, "rev-list", "--objects", "--all");
					let root = original;
					if (path.root === "common") {
						root = join(dir, "main-common");
						cpSync(original, root, {recursive: true});
						rmSync(join(root, "worktrees"), {recursive: true});
						symlinkSync(join(original, "worktrees"), join(root, "worktrees"));
						writeFileSync(
							join(original, "commondir"),
							`${path.relative ? relative(original, root) : root}\n`,
						);
					}
					if (path.root === "alternate") {
						root = join(dir, "main-alternate");
						renameSync(join(original, "objects"), root);
						mkdirSync(join(original, "objects/info"), {recursive: true});
						writeFileSync(
							join(original, "objects/info/alternates"),
							`${path.relative ? relative(join(original, "objects"), root) : root}\n`,
						);
					}
					const source = join(
						root,
						path.kind === "loose"
							? `${path.root === "alternate" ? "" : "objects/"}${git(dir, "rev-parse", "HEAD").slice(0, 2)}`
							: path.kind.startsWith("generated")
								? join("extra", ...path.parts, "saved")
								: path.root === "alternate"
									? path.kind.replace(/^objects\//, "")
									: path.kind,
					);
					if (!existsSync(source)) {
						mkdirSync(join(source, ".."), {recursive: true});
						if (["generated-file", "packed-refs", "index"].includes(path.kind))
							writeFileSync(source, setup.branch);
						else mkdirSync(source);
					}
					storage = join(
						path.location === "admin" ? admin : join(dir, "boxes", path.worktree, "node_modules"),
						...path.parts,
						"borrowed",
					);
					mkdirSync(join(storage, ".."), {recursive: true});
					stored = path.through ? join(dir, "outside-storage") : storage;
					renameSync(source, stored);
					// Git names the admin folder by its real path; a relative link must use real paths
					// on both ends, or a linked temp folder (macOS /var) breaks it.
					const real = (at: string) => join(realpathSync(join(at, "..")), basename(at));
					const name = (from: string, to: string) =>
						path.relative ? relative(realpathSync(from), real(to)) : to;
					if (path.through) symlinkSync(name(join(storage, ".."), stored), storage);
					symlinkSync(name(join(source, ".."), storage), source);
				}
				if (stored) savedStorage = storageFiles(stored);
				expect(git(dir, "rev-list", "--objects", "--all")).toBe(history);
				const registered = git(dir, "worktree", "list", "--porcelain", "-z");
				expect(registered).toContain(`worktree ${realpathSync(join(dir, "boxes", worktree))}\0`);
			}
			if (setup.storage) {
				const path = setup.storage;
				const original = join(dir, ".git");
				storage = join(dir, "boxes", path.worktree, "node_modules", ...path.parts, "storage");
				mkdirSync(join(storage, ".."), {recursive: true});
				const name = (from: string, to: string) => (path.relative ? relative(from, to) : to);
				history = git(dir, "rev-list", "--objects", "--all");
				if (path.binding === "alternates-file") {
					const outside = join(dir, "outside-objects");
					renameSync(join(original, "objects"), outside);
					mkdirSync(join(original, "objects/info"), {recursive: true});
					writeFileSync(storage, `${name(join(original, "objects"), outside)}\n`);
					symlinkSync(
						name(join(original, "objects/info"), storage),
						join(original, "objects/info/alternates"),
					);
				} else {
					const source = ["gitdir", "commondir"].includes(path.binding)
						? original
						: join(original, "objects");
					const stored = path.through ? join(dir, "outside-storage") : storage;
					renameSync(source, stored);
					if (path.through) symlinkSync(name(join(storage, ".."), stored), storage);
					if (path.binding === "gitdir") symlinkSync(name(dir, storage), original);
					if (path.binding === "commondir") {
						mkdirSync(original);
						writeFileSync(join(original, "HEAD"), readFileSync(join(stored, "HEAD")));
						writeFileSync(join(original, "commondir"), `${name(original, storage)}\n`);
						// Linked worktrees already point through MAIN/.git/worktrees. Keep that
						// spelling valid while the common directory is borrowed from a worktree.
						symlinkSync(name(original, join(storage, "worktrees")), join(original, "worktrees"));
					}
					if (path.binding === "objects") symlinkSync(name(original, storage), source);
					if (path.binding === "alternates") {
						let next = storage;
						for (let i = 0; i < path.hops; i++) {
							const objects = i === path.hops - 1 ? source : join(dir, `alternate-${i}`);
							mkdirSync(join(objects, "info"), {recursive: true});
							writeFileSync(join(objects, "info/alternates"), `${name(objects, next)}\n`);
							next = objects;
						}
					}
				}
				expect(git(dir, "rev-list", "--objects", "--all")).toBe(history);
				expect(git(dir, "check-ignore", storage)).toBe(storage);
				const registered = git(dir, "worktree", "list", "--porcelain", "-z");
				for (const worktree of ["catchup-900", "driver"])
					expect(registered).toContain(`worktree ${realpathSync(join(dir, "boxes", worktree))}\0`);
			}
		}
		writeFileSync(join(dir, "setup.json"), JSON.stringify(setup));
		for (const cmd of ["gh", "git", "node", "pnpm", "nice", "sleep", "date"]) {
			writeFileSync(join(bin, cmd), `#!${process.execPath}\n${stub}`, {mode: 0o755});
		}
		const ran = spawnSync("sh", [script, "900", "520", ...args], {
			encoding: "utf8",
			timeout: 15_000,
			env: {
				...process.env,
				PATH: `${bin}:/usr/bin:/bin`,
				HOME: join(dir, "home"),
				FABRIKA_HOME: join(dir, "fh"),
				FABRIKA_COAUTHOR: "Fixture <fixture@example.test>",
				MAIN: main,
				BOXES: join(dir, "boxes"),
				REMOTE: "https://github.com/fixture/repo.git",
				GH_REPO: "fixture/repo",
				CATCHUP_FIXTURE: dir,
				CATCHUP_TIP: checkedTip,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
				TYPESAFE_API_KEY: undefined,
			},
		});
		expect(ran.error).toBeUndefined();
		expect(ran.signal).toBeNull();
		const calls: Call[] = (
			existsSync(join(dir, "calls.jsonl")) ? readFileSync(join(dir, "calls.jsonl"), "utf8") : ""
		)
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		expect(existsSync(join(dir, "boxes/catchup.lock"))).toBe(false);
		// Its own checkout is gone once the run passed the usage check, success or failure, unless it
		// holds MAIN's Git storage, or MAIN cannot be read to tell: then a line says why it stayed.
		if (calls.length > 0) {
			const guarded =
				/^kept worktree catchup-900: (holds MAIN Git storage|cannot read MAIN Git storage|MAIN, saved state or symlinked target|symlinked target)$/m.test(
					ran.stdout,
				);
			expect(existsSync(join(dir, "boxes/catchup-900")), ran.stdout).toBe(guarded);
			// A plain real MAIN, with no storage moved anywhere, never keeps it.
			const planted =
				setup.protected ??
				setup.storage ??
				setup.deepStorage ??
				setup.sharedAdmin ??
				setup.unwalkable;
			if (setup.cleanup && planted === undefined) expect(guarded, ran.stdout).toBe(false);
		}
		const remaining = readdirSync(join(dir, "boxes"));
		const keptHead = setup.cleanup
			? spawnSync("/usr/bin/git", ["-C", dir, "rev-parse", "--verify", "refs/keep/pr/900"], {
					encoding: "utf8",
					env: localEnv,
				}).stdout.trim()
			: "";
		const state =
			setup.cleanup && existsSync(join(dir, "boxes/state/driver.md"))
				? readFileSync(join(dir, "boxes/state/driver.md"), "utf8")
				: "";
		const inspectStorage =
			setup.storage || setup.deepStorage || setup.sharedAdmin || setup.unwalkable;
		const registrations = inspectStorage
			? spawnSync("/usr/bin/git", ["-C", dir, "worktree", "list", "--porcelain", "-z"], {
					encoding: "utf8",
					env: localEnv,
				}).stdout
			: setup.cleanup
				? git(dir, "worktree", "list", "--porcelain", "-z")
				: "";
		const after = inspectStorage
			? spawnSync("/usr/bin/git", ["-C", dir, "rev-list", "--objects", "--all"], {
					encoding: "utf8",
					env: localEnv,
				})
			: undefined;
		return {
			code: ran.status,
			text: ran.stdout + ran.stderr,
			calls,
			remaining,
			keptHead,
			checkedTip,
			state,
			registrations,
			storage: {
				exists: existsSync(storage),
				admin: existsSync(admin),
				saved: savedStorage,
				files: stored && existsSync(stored) ? storageFiles(stored) : {},
				history,
				code: after?.status,
				after: after?.stdout.trim(),
				error: after?.stderr,
			},
			protectedPair: [protectedWork, protectedData].map((path) => existsSync(path)),
			saved: saved && existsSync(saved) ? readFileSync(saved, "utf8") : "",
		};
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
};
const merges = (calls: Call[]) => calls.filter((c) => c.key === "merge");
const assertHead = (calls: Call[]) => {
	for (const call of merges(calls)) {
		expect(call.args).toContain("--match-head-commit");
		expect(call.args[call.args.indexOf("--match-head-commit") + 1]).toBe(tip);
	}
	for (const call of calls.filter((c) => c.key && ["checks", "trust", "apps"].includes(c.key))) {
		expect(call.args[1]).toContain(tip);
	}
};

describe("catchup, today's tooling", () => {
	// T376: generated check-run data comes from GitHub, without a domain Schema.
	// Plants: require bare next, match a name prefix, or accept five green machines.
	it("T376 accepts a complete green matrix or a lone completed skipped next job in any order", () => {
		fc.assert(
			fc.property(
				fc.shuffledSubarray(matrixChecks, {
					minLength: matrixChecks.length,
					maxLength: matrixChecks.length,
				}),
				(checks) => {
					for (const list of [
						checks,
						[
							...checks.filter((check) => !nextNames.includes(check.name)),
							{name: "next", status: "completed", conclusion: "skipped"},
						],
					]) {
						const got = run({...green, checks: list, clock: [0, 1, 3601]});
						expect(got.code, got.text).toBe(0);
						expect(merges(got.calls)).toHaveLength(1);
						assertHead(got.calls);
					}
				},
			),
			{seed: 119120, numRuns: 12},
		);
	});
	it("T376 every missing, pending, failed or canceled shard blocks even beside a bare next", () => {
		fc.assert(
			fc.property(
				fc.record({
					order: fc.shuffledSubarray(matrixChecks, {
						minLength: matrixChecks.length,
						maxLength: matrixChecks.length,
					}),
					bare: fc.constantFrom("success", "skipped"),
				}),
				({order, bare}) => {
					for (const name of nextNames)
						for (const fault of [
							"missing",
							"in_progress",
							"failure",
							"cancelled",
							"prefix",
						] as const) {
							const checks = order.flatMap((check): Check[] =>
								check.name !== name
									? [check]
									: fault === "missing"
										? []
										: [
												{
													...check,
													name: fault === "prefix" ? `${name} extra` : name,
													status: fault === "in_progress" ? "in_progress" : "completed",
													conclusion:
														fault === "failure" || fault === "cancelled" ? fault : "success",
												},
											],
							);
							checks.push({name: "next", status: "completed", conclusion: bare});
							const got = run({...green, checks, clock: [0, 1, 3601]});
							expect(got.code, `${name}: ${fault}\n${got.text}`).toBe(1);
							expect(merges(got.calls)).toHaveLength(0);
							assertHead(got.calls);
						}
				},
			),
			{seed: 119120, numRuns: 2},
		);
	});
	it("T376 bare success and unfinished bare skips cannot stand in for the matrix", () => {
		fc.assert(
			fc.property(
				fc.shuffledSubarray(matrixChecks, {
					minLength: matrixChecks.length,
					maxLength: matrixChecks.length,
				}),
				(order) => {
					for (const check of [
						success("next"),
						{name: "next", status: "in_progress", conclusion: "skipped"},
					]) {
						const got = run({
							...green,
							checks: [...order.filter((row) => !nextNames.includes(row.name)), check],
							clock: [0, 1, 3601],
						});
						expect(got.code, got.text).toBe(1);
						expect(merges(got.calls)).toHaveLength(0);
						assertHead(got.calls);
					}
				},
			),
			{seed: 119120, numRuns: 2},
		);
	});
	// Plant: review3's guard walks selected roots only and compares only the work folder.
	// Generate storage in both the work folder and the admin directory Git also removes.
	it.each(
		(["catchup-900", "driver"] as const).flatMap((worktree) =>
			(["work", "admin"] as const).flatMap((location) =>
				(["gitdir", "common", "alternate"] as const).flatMap((root) =>
					[
						"objects/pack",
						"loose",
						"refs",
						"packed-refs",
						"logs",
						"index",
						"generated-file",
						"generated-folder",
					].map((kind) => ({worktree, location, root, kind})),
				),
			),
		),
	)(
		"T318 review3 $worktree keeps nested MAIN $root $kind in its $location storage",
		({worktree, location, root, kind}) => {
			fc.assert(
				fc.property(
					fc.record({
						branch: fc.stringMatching(/^[a-z]{2,10}$/),
						parts: fc.array(fc.stringMatching(/^[a-z]{1,8}$/), {minLength: 1, maxLength: 6}),
						through: fc.boolean(),
						relative: fc.boolean(),
					}),
					({branch, ...path}) => {
						const got = run({
							...green,
							branch: `fabrikalfa/${branch}`,
							cleanup: "clean",
							deepStorage: {worktree, location, root, kind, ...path},
						});
						expect(got.code, got.text).toBe(0);
						expect(merges(got.calls)).toHaveLength(1);
						expect(got.remaining, got.text).toContain(worktree);
						expect(got.storage.admin, got.text).toBe(true);
						expect(got.storage.exists, got.text).toBe(true);
						expect(got.storage.files).toEqual(expect.objectContaining(got.storage.saved));
						expect(got.storage.code, got.storage.error).toBe(0);
						expect(got.storage.after).toBe(got.storage.history);
						expect(got.registrations).toContain(`/${worktree}\0`);
						expect(got.text).toMatch(new RegExp(`^kept worktree ${worktree}: [^\\n]+$`, "m"));
						expect(
							got.calls.some(
								(c) =>
									c.cmd === "git" &&
									c.args.includes("remove") &&
									c.args.some((a) => a.endsWith(`/${worktree}`)),
							),
						).toBe(false);
						expect(got.keptHead).toBe(got.checkedTip);
						expect(got.state).toBe("saved wait");
					},
				),
				{seed: 31862, numRuns: 3, endOnFailure: true},
			);
		},
	);

	// Plant: protect the worktree path while forgetting the separate admin directory it deletes.
	it.each(["catchup-900", "driver"] as const)(
		"T318 review3 MAIN sharing %s admin data prevents worktree removal",
		(worktree) => {
			fc.assert(
				fc.property(fc.stringMatching(/^[a-z]{2,10}$/), (branch) => {
					const got = run({
						...green,
						branch: `fabrikalfa/${branch}`,
						cleanup: "clean",
						sharedAdmin: worktree,
					});
					expect(got.code, got.text).toBe(0);
					expect(merges(got.calls)).toHaveLength(1);
					expect(got.remaining, got.text).toContain(worktree);
					expect(got.storage.admin, got.text).toBe(true);
					expect(got.storage.exists, got.text).toBe(true);
					expect(got.storage.files).toEqual(expect.objectContaining(got.storage.saved));
					expect(got.storage.code, got.storage.error).toBe(0);
					expect(got.storage.after).toBe(got.storage.history);
					expect(got.text).toMatch(new RegExp(`^kept worktree ${worktree}: [^\\n]+$`, "m"));
					expect(
						got.calls.some(
							(c) =>
								c.cmd === "git" &&
								c.args.includes("remove") &&
								c.args.some((a) => a.endsWith(`/${worktree}`)),
						),
					).toBe(false);
				}),
				{seed: 31863, numRuns: 3, endOnFailure: true},
			);
		},
	);

	// Plant: ignore a nested walk failure and remove a candidate without proving independence.
	it.each(["catchup-900", "driver"] as const)(
		"T318 review3 %s stays when MAIN cannot be fully walked",
		(worktree) => {
			fc.assert(
				fc.property(
					fc.array(fc.stringMatching(/^[a-z]{1,8}$/), {minLength: 1, maxLength: 6}),
					(parts) => {
						const got = run({...green, cleanup: "clean", unwalkable: {worktree, parts}});
						expect(got.code, got.text).toBe(0);
						expect(got.remaining, got.text).toContain(worktree);
						expect(got.storage.admin, got.text).toBe(true);
						expect(got.text).toMatch(new RegExp(`^kept worktree ${worktree}: [^\\n]+$`, "m"));
					},
				),
				{seed: 31864, numRuns: 3, endOnFailure: true},
			);
		},
	);

	// Plant: today's guard protects MAIN's folder alone and removes borrowed Git storage.
	// Both worktree-removal calls must keep nested alternates and intermediate links, too.
	it.each(
		(["catchup-900", "driver"] as const).flatMap((worktree) =>
			(["gitdir", "commondir", "objects", "alternates", "alternates-file"] as const).flatMap(
				(binding) =>
					(binding === "alternates-file" ? [false] : [false, true]).map((through) => ({
						worktree,
						binding,
						through,
					})),
			),
		),
	)(
		"T318 $worktree keeps MAIN storage reached by $binding through link $through",
		({worktree, binding, through}) => {
			fc.assert(
				fc.property(
					fc.record({
						branch: fc.stringMatching(/^[a-z]{2,10}$/),
						parts: fc.array(fc.stringMatching(/^[a-z]{1,8}$/), {minLength: 1, maxLength: 5}),
						relative: fc.boolean(),
						hops: fc.integer({min: 2, max: 4}),
					}),
					({branch, ...path}) => {
						const got = run({
							...green,
							branch: `fabrikalfa/${branch}`,
							cleanup: "clean",
							storage: {worktree, binding, through, ...path},
						});
						expect(got.code, got.text).toBe(0);
						expect(merges(got.calls)).toHaveLength(1);
						expect(got.remaining, got.text).toContain(worktree);
						expect(got.storage.exists, got.text).toBe(true);
						expect(got.storage.code, got.storage.error).toBe(0);
						expect(got.storage.after).toBe(got.storage.history);
						expect(got.registrations).toContain(`/${worktree}\0`);
						expect(got.text).toMatch(new RegExp(`^kept worktree ${worktree}: [^\\n]+$`, "m"));
						expect(got.state).toBe("saved wait");
						expect(got.keptHead).toBe(got.checkedTip);
					},
				),
				{seed: 31842, numRuns: 3, endOnFailure: true},
			);
		},
	);

	// Plant: box removal accepts a pair holding MAIN or saved driver state.
	it.each(["main-work", "main-data", "main-child", "main-data-child", "state"] as const)(
		"T318 cleanup preserves protected %s pairs",
		(protectedLocation) => {
			fc.assert(
				fc.property(
					fc.stringMatching(/^[a-z]{2,12}$/),
					fc.integer({min: 1, max: 4}),
					(name, depth) => {
						const branch = `fabrikalfa/${name}`;
						const got = run({
							...green,
							branch,
							cleanup: "clean",
							protected: protectedLocation,
							protectedDepth: depth,
						});
						expect(got.code, got.text).toBe(0);
						expect(merges(got.calls)).toHaveLength(1);
						expect(got.protectedPair, got.text).toEqual([true, true]);
						expect(got.saved).toBe(branch);
						expect(got.state).toBe("saved wait");
						expect(got.text).toMatch(
							new RegExp(
								`^kept box ${protectedLocation === "state" ? "state" : "protected"}: [^\\n]+$`,
								"m",
							),
						);
					},
				),
				{seed: 31828, numRuns: 3, endOnFailure: true},
			);
		},
	);

	// Plant: remove the locked/prunable guard, formerly catchup.sh line 175.
	it("T318 missing registered worktrees keep their registration and print a reason", () => {
		fc.assert(
			fc.property(fc.stringMatching(/^[a-z]{2,12}$/), (name) => {
				const branch = `fabrikalfa/${name}`;
				const got = run({...green, branch, cleanup: "clean", trouble: "missing"});
				expect(got.code, got.text).toBe(0);
				expect(merges(got.calls)).toHaveLength(1);
				expect(got.registrations).toContain(`branch refs/heads/${branch}\0`);
				expect(got.text).toMatch(/^kept worktree driver: [^\n]+$/m);
				expect(
					got.calls.some(
						(c) =>
							c.cmd === "git" &&
							c.args.includes("remove") &&
							c.args.some((arg) => arg.endsWith("/driver")),
					),
				).toBe(false);
				expect(got.remaining).not.toContain("later box");
				expect(got.state).toBe("saved wait");
			}),
			{seed: 31829, numRuns: 4, endOnFailure: true},
		);
	});

	// Plants: merge without --squash; omit the head pin; do work after extra options; skip the head
	// read before a stack merge; stack-merge a PR whose head moved.
	it("T300 squash only, pinned to the checked head, and a stack lands by gh stack merge", () => {
		fc.assert(
			fc.property(
				fc.record({
					merge: fc.boolean(),
					answer: fc.constantFrom<Setup["answer"]>("green", "red", "ticket"),
					pending: fc.integer({min: 0, max: 1}),
					stack: fc.constantFrom<NonNullable<Setup["stack"]>>("none", "same", "moved"),
				}),
				({merge, answer: outcome, pending, stack}) => {
					for (const answer of new Set<Setup["answer"]>(["green", outcome])) {
						const got = run({...green, merge, answer, pending, stack});
						const reached = answer === "green";
						const lands = reached && stack !== "moved";
						expect(got.code, got.text).toBe(lands ? 0 : 1);
						const tried = merges(got.calls);
						expect(tried).toHaveLength(reached ? 1 : 0);
						for (const call of tried) {
							expect(
								call.args.filter((a) => a.startsWith("--") && a !== "--match-head-commit"),
							).toEqual(["--squash"]);
						}
						const stacked = got.calls.filter((c) => c.key === "stack");
						expect(stacked.map((c) => c.args)).toEqual(
							reached && stack === "same" ? [["stack", "merge", "900", "--squash", "--yes"]] : [],
						);
						expect(got.calls.filter((c) => c.key === "oid")).toHaveLength(
							reached && stack !== "none" ? 1 : 0,
						);
						assertHead(got.calls);
					}
					for (const args of [
						["--merge-method", "squash"],
						["--merge-method", "merge"],
						["--unknown"],
					]) {
						const got = run(green, args);
						expect(got.code, got.text).toBe(1);
						expect(got.calls).toEqual([]);
					}
				},
			),
			{seed: 300, numRuns: 5},
		);
	});

	// Plants: remove union; retain one side; deduplicate IDs. Plain conflicts must still abort.
	it("T300 real git preserves both field logs and aborts other conflicts without a push", () => {
		fc.assert(
			fc.property(
				fc.array(
					fc.record({
						id: fc.integer({min: 0, max: 2}),
						text: fc.stringMatching(/^[a-z]{1,8}$/),
					}),
					{minLength: 1, maxLength: 3},
				),
				(rows) => {
					for (const conflict of [false, true]) {
						const dir = mkdtempSync(join(tmpdir(), "cu-log-"));
						const git = (...args: string[]) => {
							const ran = spawnSync("/usr/bin/git", ["-C", dir, ...args], {
								encoding: "utf8",
								timeout: 5_000,
								env: {
									...process.env,
									GIT_CONFIG_NOSYSTEM: "1",
									GIT_CONFIG_GLOBAL: "/dev/null",
									GIT_ATTR_NOSYSTEM: "1",
									GIT_TERMINAL_PROMPT: "0",
								},
							});
							expect(ran.error).toBeUndefined();
							expect(ran.status, ran.stderr).toBe(0);
							return ran.stdout.trim();
						};
						try {
							git("init", "-q", "--initial-branch=main");
							git("config", "user.name", "Fixture");
							git("config", "user.email", "fixture@example.test");
							git("config", "core.attributesFile", "/dev/null");
							expect(git("remote")).toBe("");
							mkdirSync(join(dir, "field"));
							writeFileSync(
								join(dir, ".gitattributes"),
								readFileSync(join(import.meta.dirname, "../../../../.gitattributes")),
							);
							const prefix = rows.map((r) => JSON.stringify({...r, side: "base"}));
							const tails = ["ours", "theirs"].map((side) =>
								rows.map((r) => JSON.stringify({...r, side})),
							);
							const logs = ["runs", "notes"].map((name) => join(dir, `field/${name}.jsonl`));
							for (const log of logs) writeFileSync(log, `${prefix.join("\n")}\n`);
							writeFileSync(join(dir, "ordinary.txt"), "base\n");
							git("add", ".");
							git("commit", "-qm", "base");
							git("branch", "peer");
							for (const [i, branch] of ["main", "peer"].entries()) {
								git("checkout", "-q", branch);
								for (const log of logs)
									writeFileSync(log, `${[...prefix, ...tails[i]!].join("\n")}\n`);
								if (conflict) writeFileSync(join(dir, "ordinary.txt"), `${branch}\n`);
								git("add", ".");
								git("commit", "-qm", branch);
							}
							git("update-ref", "refs/remotes/origin/main", "peer");
							git("checkout", "-q", "main");
							const before = git("rev-parse", "HEAD");
							const got = run({...green, merge: true, repo: dir});
							expect(got.code, got.text).toBe(conflict ? 1 : 0);
							if (conflict) {
								expect(git("rev-parse", "HEAD")).toBe(before);
								expect(git("status", "--porcelain")).toBe("");
								expect(
									got.calls.some(
										(c) =>
											c.cmd === "node" ||
											c.cmd === "pnpm" ||
											c.args[0] === "push" ||
											c.key === "merge",
									),
								).toBe(false);
							} else
								for (const log of logs) {
									const actual = readFileSync(log, "utf8").trimEnd().split("\n");
									expect(actual.sort()).toEqual([...prefix, ...tails.flat()].sort());
									for (const line of actual) expect(() => JSON.parse(line)).not.toThrow();
								}
						} finally {
							rmSync(dir, {recursive: true, force: true});
						}
					}
				},
			),
			{seed: 300, numRuns: 5},
		);
	});
	// Plant: clean before a successful merge, including after checks, trust, pushes or merge fail.
	it("T318 cleanup starts only after a successful merge", () => {
		fc.assert(
			fc.property(
				fc.record({
					suffix: fc.nat({max: 99}),
					answer: fc.constantFrom<Setup["answer"]>("red", "event", "app", "ticket", "trust-red"),
				}),
				({suffix, answer}) => {
					for (const patch of [
						{answer},
						{merge: true, refused: "notes" as const},
						{mergeFails: true},
					]) {
						const got = run({
							...green,
							branch: `fabrikalfa/cleanup-${suffix}`,
							cleanup: "clean",
							...patch,
						});
						expect(got.code, got.text).toBe(1);
						for (const path of ["exact box", "exact box-gitdata", "later box", "driver", "sibling"])
							expect(got.remaining).toContain(path);
						// The catch-up checkout holds nothing of MAIN's, so the EXIT trap force-removes it.
						expect(got.remaining).not.toContain("catchup-900");
						expect(got.keptHead).toBe("");
						const touched = got.calls.filter(
							(c) =>
								c.cmd === "git" && (c.args.includes("remove") || c.args.includes("update-ref")),
						);
						expect(touched).toHaveLength(1);
						for (const call of touched) {
							expect(call.args).toContain("--force");
							expect(call.args.at(-1)).toMatch(/\/catchup-900$/);
						}
					}
					// Positive case keeps this law red until cleanup exists; absence alone is insufficient.
					const landed = run({...green, branch: `fabrikalfa/cleanup-${suffix}`, cleanup: "clean"});
					expect(landed.code, landed.text).toBe(0);
					expect(landed.remaining).not.toContain("catchup-900");
					const mergedAt = landed.calls.findIndex((c) => c.key === "merge");
					for (const [i, c] of landed.calls.entries())
						if (c.cmd === "git" && (c.args.includes("remove") || c.args.includes("update-ref")))
							expect(i).toBeGreaterThan(mergedAt);
				},
			),
			{seed: 3191, numRuns: 3},
		);
	});

	// Plants: match a branch prefix, omit refs/keep, or leave the catch-up/driver checkout registered.
	it("T318 cleanup retains the checked head and removes only exact branch boxes and registered worktrees", () => {
		fc.assert(
			fc.property(fc.record({suffix: fc.stringMatching(/^[a-z]{2,8}$/)}), ({suffix}) => {
				// Every PR squash-merges (0004), so the run takes no merge method.
				const got = run({...green, branch: `fabrikalfa/${suffix}`, cleanup: "clean"});
				expect(got.code, got.text).toBe(0);
				expect(got.keptHead).toBe(got.checkedTip);
				for (const path of [
					"exact box",
					"exact box-gitdata",
					"later box",
					"later box-gitdata",
					"catchup-900",
					"driver",
				])
					expect(got.remaining).not.toContain(path);
				for (const path of ["sibling box", "sibling box-gitdata", "sibling", "state"])
					expect(got.remaining).toContain(path);
				expect(got.state).toBe("saved wait");
				const removes = got.calls.filter(
					(c) => c.cmd === "git" && c.args.includes("worktree") && c.args.includes("remove"),
				);
				// The driver goes only when Git agrees; the catch-up checkout is forced, last, by EXIT.
				expect(removes).toHaveLength(2);
				expect(
					removes.map((c) => [c.args.at(-1)?.split("/").at(-1), c.args.includes("--force")]),
				).toEqual([
					["driver", false],
					["catchup-900", true],
				]);
				expect(
					got.calls.some(
						(c) =>
							c.cmd === "git" &&
							c.args.includes("list") &&
							c.args.includes("--porcelain") &&
							c.args.includes("-z"),
					),
				).toBe(true);
				const keepAt = got.calls.findIndex((c) => c.args.includes("refs/keep/pr/900"));
				const firstRemove = got.calls.findIndex((c) => c.args.includes("remove"));
				expect(keepAt).toBeGreaterThan(-1);
				expect(keepAt).toBeLessThan(firstRemove);
			}),
			{seed: 3192, numRuns: 3},
		);
	});

	// Plants: propagate cleanup failure into merge status; stop after the first kept candidate.
	it("T318 kept dirty unsaved locked malformed or failed candidates never stop later cleanup or turn merge red", () => {
		fc.assert(
			fc.property(fc.nat({max: 99}), (suffix) => {
				for (const cleanup of ["dirty", "unsaved", "locked", "malformed", "error"] as const) {
					const got = run({...green, branch: `fabrikalfa/kept-${suffix}`, cleanup});
					expect(got.code, got.text).toBe(0);
					expect(merges(got.calls)).toHaveLength(1);
					expect(got.keptHead).toBe(got.checkedTip);
					expect(got.remaining).not.toContain("later box");
					expect(got.remaining).not.toContain("later box-gitdata");
					expect(got.remaining).not.toContain("catchup-900");
					const keepBox = ["dirty", "unsaved", "malformed"].includes(cleanup);
					expect(got.remaining.includes("exact box")).toBe(keepBox);
					expect(got.remaining.includes("exact box-gitdata")).toBe(keepBox);
					expect(got.remaining.includes("driver")).toBe(
						["dirty", "locked", "error"].includes(cleanup),
					);
					expect(got.text).toMatch(/kept [^\n]+: [^\n]+/);
					expect(got.state).toBe("saved wait");
				}
			}),
			{seed: 3193, numRuns: 3},
		);
	});

	// Plants (mutation, seed 119120): drop the line for a failed worktree listing; remove
	// worktrees after the keep ref failed; skip an unregistered catch-up checkout silently; or
	// remove one of two worktrees that share the PR branch.
	it("T318 listing keep-ref registration and shared-branch trouble each keep with a line and stay green", () => {
		fc.assert(
			fc.property(fc.stringMatching(/^[a-z]{2,8}$/), (suffix) => {
				for (const trouble of ["list", "keep", "unregistered", "twins"] as const) {
					const got = run({...green, branch: `fabrikalfa/${suffix}`, cleanup: "clean", trouble});
					expect(got.code, got.text).toBe(0);
					expect(merges(got.calls)).toHaveLength(1);
					expect(got.state).toBe("saved wait");
					const has = (path: string) => got.remaining.includes(path);
					// The catch-up checkout holds nothing of MAIN's here, so whatever the trouble, EXIT
					// force-removes it; only the branch's other worktrees and boxes wait on the trouble.
					expect(has("catchup-900")).toBe(false);
					if (trouble === "list") {
						expect(got.text).toMatch(/^kept worktrees: [^\n]+$/m);
						expect(got.keptHead).toBe(got.checkedTip);
						for (const path of ["driver", "sibling"]) expect(has(path)).toBe(true);
						for (const path of ["exact box", "later box"]) expect(has(path)).toBe(false);
					}
					if (trouble === "keep") {
						expect(got.keptHead).toBe("");
						expect(got.text).toMatch(/^kept worktree driver: [^\n]+$/m);
						expect(got.text).toMatch(/^kept box exact box: [^\n]+$/m);
						for (const path of ["driver", "exact box", "later box"]) expect(has(path)).toBe(true);
					}
					if (trouble === "unregistered") {
						for (const path of ["driver", "exact box", "later box"]) expect(has(path)).toBe(false);
					}
					if (trouble === "twins") {
						for (const path of ["driver", "driver twin"]) {
							expect(has(path)).toBe(true);
							expect(got.text).toMatch(new RegExp(`^kept worktree ${path}: [^\\n]+$`, "m"));
						}
						for (const path of ["catchup-900", "exact box", "later box"])
							expect(has(path)).toBe(false);
					}
				}
			}),
			{seed: 3195, numRuns: 2},
		);
	});

	// Plant: exit on the first read failure, or allow a fourth attempt.
	it("brief read failures recover within the three-attempt budget", () => {
		fc.assert(
			fc.property(
				fc.array(fc.integer({min: 0, max: 4}), {minLength: 5, maxLength: 5}),
				(failures) => {
					const got = run({...green, failures});
					const stopped = failures.findIndex((n) => n >= 3);
					expect(got.code, got.text).toBe(stopped < 0 ? 0 : 1);
					for (const [i, key] of reads.entries()) {
						const expected = stopped >= 0 && i > stopped ? 0 : Math.min(failures[i]! + 1, 3);
						expect(got.calls.filter((c) => c.key === key).length, key).toBe(expected);
					}
					const waits = failures
						.slice(0, stopped < 0 ? 5 : stopped + 1)
						.flatMap((n) => (n === 0 ? [] : n === 1 ? ["1"] : ["1", "2"]));
					expect(got.calls.filter((c) => c.cmd === "sleep").map((c) => c.args[0])).toEqual(waits);
					expect(merges(got.calls)).toHaveLength(stopped < 0 ? 1 : 0);
					if (stopped > 0) expect(got.text).toContain(tip);
					if (stopped >= 0) expect(got.text).toContain("gh");
					assertHead(got.calls);
				},
			),
			options,
		);
	});

	// Plant: retry a successful red answer, mask failed logs, or use a different merge head.
	// A run that never started (startup_failure) neither blocks nor counts as a second run.
	it("red and untrusted answers never merge or get retried as transport failures", () => {
		fc.assert(
			fc.property(
				fc.record({
					answer: fc.constantFrom<Setup["answer"]>(
						"green",
						"red",
						"event",
						"duplicate",
						"startup",
						"app",
						"ticket",
						"trust-red",
					),
					pending: fc.integer({min: 0, max: 2}),
					logFailures: fc.integer({min: 3, max: 4}),
					failures: fc.array(fc.integer({min: 0, max: 2}), {minLength: 5, maxLength: 5}),
				}),
				({answer, pending, failures, logFailures}) => {
					const failedLogs = run({...green, failures: [0, 0, 0, 0, logFailures]});
					expect(failedLogs.code, failedLogs.text).toBe(1);
					expect(merges(failedLogs.calls)).toHaveLength(0);
					expect(failedLogs.calls.filter((c) => c.key === "logs")).toHaveLength(3);
					const got = run({...green, answer, pending, failures});
					const stop = {
						green: 5,
						red: 1,
						event: 2,
						duplicate: 2,
						startup: 5,
						app: 3,
						ticket: 4,
						"trust-red": 2,
					}[answer];
					const merged = answer === "green" || answer === "startup";
					expect(got.code, got.text).toBe(merged ? 0 : 1);
					expect(merges(got.calls)).toHaveLength(merged ? 1 : 0);
					for (const [i, key] of reads.entries()) {
						const count = i > stop ? 0 : failures[i]! + 1 + (key === "checks" ? pending : 0);
						expect(got.calls.filter((c) => c.key === key).length, key).toBe(count);
					}
					assertHead(got.calls);
				},
			),
			options,
		);
	});

	// Plant: test the deadline only after the green-and-complete break, as review round 4 found.
	// The clock moves with each check read, so the law holds wherever the script reads `date`.
	it("no merge once the clock is past the hour, and a green answer in time still merges", () => {
		fc.assert(
			fc.property(
				fc.record({
					pending: fc.integer({min: 0, max: 3}),
					// One step per check read. 3,600 itself is left out: the law is about either side.
					steps: fc.array(fc.integer({min: 0, max: 2500}), {minLength: 4, maxLength: 4}),
				}),
				({pending, steps}) => {
					const clock = [0];
					for (const step of steps) clock.push(clock.at(-1)! + step);
					const seconds = clock.map((t) => (t === 3600 ? 3601 : t));
					// The green answer is the check read after the pending ones.
					const late = seconds[pending + 1]! >= 3600;
					const got = run({...green, pending, clock: seconds});
					expect(got.code, got.text).toBe(late ? 1 : 0);
					expect(merges(got.calls)).toHaveLength(late ? 0 : 1);
					if (late) expect(got.text).toMatch(/not done .* after an hour/);
					else expect(got.text).not.toContain("after an hour");
					assertHead(got.calls);
				},
			),
			{
				...options,
				// pinned: ticket 520 review round 4, a green answer at 3,601 seconds still merged.
				examples: [[{pending: 0, steps: [3601, 0, 0, 0]}]],
			},
		);
	});

	// Plant: push a branch twice, or continue after either push is refused.
	it("each push sends its intended refs once and refusal stops", () => {
		fc.assert(
			fc.property(
				fc.record({
					bot: fc.boolean(),
					suffix: fc.nat({max: 99}),
					merge: fc.boolean(),
					refused: fc.constantFrom<Setup["refused"]>("none", "notes", "branch"),
				}),
				({bot, suffix, merge, refused: outcome}) => {
					for (const refused of new Set<Setup["refused"]>(["none", outcome])) {
						const branch = `${bot ? "fabrikalfa" : "person"}/tests-${suffix}`;
						const got = run({...green, branch, merge, refused});
						const denied = merge && refused !== "none";
						expect(got.code, got.text).toBe(denied ? 1 : 0);
						const botpush = got.calls.filter((c) => c.cmd === "node");
						expect(botpush.map((c) => c.args.slice(1))).toEqual(
							!merge ? [] : bot ? [[".", branch, tip]] : [[".", "-"]],
						);
						const pushes = got.calls.filter((c) => c.cmd === "git" && c.args[0] === "push");
						expect(pushes.map((c) => c.args)).toEqual(
							merge && !bot && refused !== "notes"
								? [["push", "-q", "origin", `${tip}:refs/heads/${branch}`]]
								: [],
						);
						expect(merges(got.calls)).toHaveLength(denied ? 0 : 1);
						assertHead(got.calls);
					}
				},
			),
			{...options, numRuns: 8},
		);
	});
});
