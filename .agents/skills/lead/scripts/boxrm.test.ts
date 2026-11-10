import "./box.sh?raw";
import "./keepruns.sh?raw";
import "./leakgrep.sh?raw";
import "./catchup.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
import "./fieldrow.py?raw";
import "./runplan.sh?raw";
import "./env.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./gc.ts?raw";
import "./redact.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./botpush.mjs?raw";
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
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join, relative} from "node:path";
import fc from "fast-check";
import {describe, expect, it} from "vitest";

const script = join(import.meta.dirname, "box.sh");

const storageFiles = (root: string) => {
	const files: Record<string, string> = {};
	const visit = (path: string, name: string) => {
		const info = lstatSync(path);
		files[name] = info.isSymbolicLink()
			? `link:${readlinkSync(path)}`
			: info.isFile()
				? `file:${readFileSync(path).toString("base64")}`
				: "directory";

		if (info.isDirectory()) {
			for (const child of readdirSync(path)) {
				visit(join(path, child), `${name}/${child}`);
			}
		}
	};
	visit(root, ".");
	return files;
};

const input = fc.record({
	name: fc.stringMatching(/^[a-z]{2,8}$/),
	value: fc.stringMatching(/^[a-z]{1,12}$/),
	space: fc.boolean(),
	depth: fc.integer({min: 1, max: 3}),
	descendant: fc.boolean(),
});

type Input = {name: string; value: string; space: boolean; depth: number; descendant: boolean};
type Remote = {branches: string[]; local: number};

const fixture = (
	v: Input,
	body: (f: ReturnType<typeof setup>) => void,
	clone = false,
	remote?: Remote,
) => {
	const dir = mkdtempSync(join(tmpdir(), "box-law-"));

	try {
		body(setup(v, clone, dir, remote));
	} finally {
		rmSync(dir, {recursive: true, force: true});
	}
};

const setup = (v: Input, clone: boolean, dir: string, remote?: Remote) => {
	const main = join(dir, "main"),
		boxes = join(dir, "boxes");
	const name = `${v.name}${v.space ? " with space" : ""}`;
	const work = join(boxes, name),
		data = `${work}-gitdata`,
		home = join(dir, "home");

	for (const path of [main, boxes, home]) {
		mkdirSync(path);
	}

	const env = {
		...process.env,
		HOME: home,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		MAIN: main,
		BOXES: boxes,
		REMOTE: "unused",
		GH_REPO: "fixture/repo",
		FABRIKA_COAUTHOR: "Fixture <fixture@example.test>",
		TYPESAFE_API_KEY: undefined,
	};
	const git = (at: string, ...args: string[]) => {
		const ran = spawnSync("/usr/bin/git", ["-C", at, ...args], {
			encoding: "utf8",
			env,
			timeout: 15_000,
		});
		expect(ran.error).toBeUndefined();
		expect(ran.status, ran.stderr).toBe(0);
		return ran.stdout.trim();
	};
	git(main, "init", "-q", "--initial-branch=main");
	git(main, "config", "user.name", "Fixture");
	git(main, "config", "user.email", "fixture@example.test");
	writeFileSync(join(main, "tracked"), `base ${v.value}\n`);
	writeFileSync(join(main, ".gitignore"), "node_modules/\n");
	git(main, "add", ".");
	git(main, "commit", "-qm", "base");

	if (remote) {
		const base = git(main, "rev-parse", "HEAD"),
			tree = git(main, "rev-parse", "HEAD^{tree}");

		for (const branch of remote.branches) {
			const tip = git(main, "commit-tree", tree, "-p", base, "-m", `${v.value} ${branch}`);
			git(main, "update-ref", `refs/heads/${branch}`, tip);
		}
	}

	const origin = join(dir, "origin.git");
	git(main, "clone", "-q", "--bare", "--no-hardlinks", main, origin);

	if (remote) {
		rmSync(main, {recursive: true});
		git(dir, "clone", "-q", "--no-hardlinks", origin, main);
		git(main, "config", "user.name", "Fixture");
		git(main, "config", "user.email", "fixture@example.test");

		for (const branch of remote.branches.slice(0, remote.local)) {
			git(main, "branch", branch, `origin/${branch}`);
		}
	}

	if (clone) {
		git(main, "clone", "-q", "--reference", main, `--separate-git-dir=${data}`, origin, work);
	} else {
		// Build metadata directly to test refusals independently of the symbolic-ref bug.
		// The real clone law below keeps the normal origin/HEAD, too.
		mkdirSync(work);
		git(work, "init", "-q", "--initial-branch=main", `--separate-git-dir=${data}`);
		git(work, "remote", "add", "origin", origin);
		git(work, "fetch", "-q", "origin", "main");
		git(work, "checkout", "-q", "-B", "main", "FETCH_HEAD");
	}

	git(work, "config", "user.name", "Fixture");
	git(work, "config", "user.email", "fixture@example.test");
	expect(git(main, "remote")).toBe(remote ? "origin" : "");
	expect(git(work, "remote")).toBe("origin");
	const run = (
		chosen = name,
		extra: Record<string, string> = {},
		entry: "direct" | "catchup" = "direct",
	) => {
		let command = [script, "rm", chosen];

		if (entry === "catchup") {
			const bin = join(dir, "cleanup-bin");
			mkdirSync(bin, {recursive: true});
			mkdirSync(join(boxes, "catchup-900/node_modules"), {recursive: true});
			const tip = git(main, "rev-parse", "HEAD");
			// Run the real catch-up caller and real local cleanup. Only remote reads and the
			// pre-merge checkout are stubbed. No signing or pushing is reached.
			const stub = `
const {spawnSync} = require("node:child_process");
const cmd = require("node:path").basename(process.argv[1]);
const args = process.argv.slice(2);
if (cmd === "gh") {
  // After the merge (0015): merged at the tip, with a description that names no ticket.
  if (args[0] === "pr" && args[1] === "view" && args.includes("state,mergeCommit")) console.log("MERGED " + ${JSON.stringify(tip)});
  else if (args[0] === "pr" && args[1] === "view" && args.includes("body")) console.log("");
  else if (args[0] === "pr" && args[1] === "view") console.log("main");
  else if (args[0] === "pr" && args[1] === "merge") process.exit(0);
  else if (args[0] === "run") console.log("commits\\tcheck\\t2026-11-08T00:00:00Z commits: 1 commits, ticket 318");
  else if (args[1].includes("check_name=")) console.log("github-actions");
  else if (args[1].includes("check-runs?")) console.log(["check", "e2e", "next", "commits"].map(n => n + "\\tcompleted\\tsuccess").join("\\n"));
  else if (args[1].includes("actions/runs?")) console.log("71\\tpull_request_target\\tcompleted\\tsuccess\\t81");
  else process.exit(1);
} else if (cmd === "git") {
  if (["fetch", "checkout", "merge-base"].includes(args[0])) process.exit(0);
  if (args[0] === "rev-parse") console.log(args.includes("--short") ? ${JSON.stringify(tip.slice(0, 7))} : ${JSON.stringify(tip)});
  else {
    const got = spawnSync("/usr/bin/git", args, {encoding: "utf8"});
    process.stdout.write(got.stdout || ""); process.stderr.write(got.stderr || "");
    process.exit(got.status ?? 1);
  }
} else process.exit(1);
`;

			for (const tool of ["gh", "git"]) {
				writeFileSync(join(bin, tool), `#!${process.execPath}\n${stub}`, {mode: 0o755});
			}

			extra = {...extra, PATH: `${bin}:/usr/bin:/bin`};
			command = [join(import.meta.dirname, "catchup.sh"), "900", "318"];
		}

		const ran = spawnSync("sh", command, {
			cwd: main,
			encoding: "utf8",
			env: {...env, ...extra},
			timeout: 15_000,
		});
		expect(ran.error).toBeUndefined();
		expect(ran.signal).toBeNull();
		return {code: ran.status, text: (ran.stdout + ran.stderr).trim()};
	};
	const commit = () => {
		git(work, "add", ".");
		git(work, "commit", "-qm", v.value);
		return git(work, "rev-parse", "HEAD");
	};
	const retained = (ref: string) => git(main, "fetch", "-q", data, `${ref}:refs/keep/${v.name}`);
	return {dir, main, boxes, name, work, data, git, run, commit, retained, env};
};

const kept = (f: ReturnType<typeof setup>, code = 1) => {
	const got = f.run();
	expect(got.code, got.text).toBe(code);
	expect(got.text).toMatch(new RegExp(`^kept box ${f.name}: [^\\n]+$`));
	expect(existsSync(f.work)).toBe(true);
	expect(existsSync(f.data)).toBe(true);
};

describe("box rm, today's tooling", () => {
	// Plant: review3's root-only walk misses a symlink anywhere below MAIN storage.
	// Arbitrary paths matter too: an unfamiliar storage name must fail closed.
	it.each(
		(["direct", "catchup"] as const).flatMap((entry) =>
			(["gitdir", "common", "alternate"] as const).flatMap((root) =>
				[false, true].flatMap((data) =>
					[
						"objects/pack",
						"loose",
						"refs",
						"packed-refs",
						"logs",
						"index",
						"generated-file",
						"generated-folder",
					].map((kind) => ({entry, root, data, kind})),
				),
			),
		),
	)(
		"T318 review3 $entry keeps nested MAIN $root $kind in box data $data",
		({entry, root: rootKind, data, kind}) => {
			fc.assert(
				fc.property(
					input,
					fc.record({
						parts: fc.array(fc.stringMatching(/^[a-z]{1,8}$/), {minLength: 1, maxLength: 6}),
						through: fc.boolean(),
						relative: fc.boolean(),
					}),
					(v, path) =>
						fixture(v, (f) => {
							const original = join(f.main, ".git");
							f.git(f.main, "pack-refs", "--all");

							if (kind === "objects/pack") {
								f.git(f.main, "repack", "-ad");
							}

							if (kind === "refs") {
								f.git(f.main, "update-ref", "refs/keep/storage", "HEAD");
							}

							const history = f.git(f.main, "rev-list", "--objects", "--all");
							let root = original;

							if (rootKind === "common") {
								root = join(f.dir, "main-common");
								cpSync(original, root, {recursive: true});
								writeFileSync(
									join(original, "commondir"),
									`${path.relative ? relative(original, root) : root}\n`,
								);
							}

							if (rootKind === "alternate") {
								root = join(f.dir, "main-alternate");
								renameSync(join(original, "objects"), root);
								mkdirSync(join(original, "objects/info"), {recursive: true});
								writeFileSync(
									join(original, "objects/info/alternates"),
									`${path.relative ? relative(join(original, "objects"), root) : root}\n`,
								);
							}

							const source = join(
								root,
								kind === "loose"
									? `${rootKind === "alternate" ? "" : "objects/"}${f.git(f.main, "rev-parse", "HEAD").slice(0, 2)}`
									: kind.startsWith("generated")
										? join("extra", ...path.parts, "saved")
										: rootKind === "alternate"
											? kind.replace(/^objects\//, "")
											: kind,
							);

							if (!existsSync(source)) {
								mkdirSync(join(source, ".."), {recursive: true});

								if (kind === "generated-file" || kind === "packed-refs" || kind === "index") {
									writeFileSync(source, v.value);
								} else {
									mkdirSync(source);
								}
							}

							const target = join(
								data ? join(f.data, "objects/info") : join(f.work, "node_modules"),
								...path.parts,
								"borrowed",
							);
							mkdirSync(join(target, ".."), {recursive: true});
							const stored = path.through ? join(f.dir, "outside-storage") : target;
							renameSync(source, stored);
							const name = (from: string, to: string) => (path.relative ? relative(from, to) : to);

							if (path.through) {
								symlinkSync(name(join(target, ".."), stored), target);
							}

							symlinkSync(name(join(source, ".."), target), source);
							const saved = storageFiles(stored);
							expect(f.git(f.main, "rev-list", "--objects", "--all")).toBe(history);
							const got = f.run(f.name, {}, entry);
							expect(got.code, got.text).toBe(entry === "direct" ? 1 : 0);
							expect(got.text).toMatch(new RegExp(`^kept box ${f.name}: [^\\n]+$`, "m"));
							expect(existsSync(f.work), got.text).toBe(true);
							expect(existsSync(f.data), got.text).toBe(true);
							expect(existsSync(target), got.text).toBe(true);
							expect(storageFiles(stored)).toEqual(expect.objectContaining(saved));
							expect(f.git(f.main, "rev-list", "--objects", "--all")).toBe(history);
						}),
				),
				{seed: 31860, numRuns: 3, endOnFailure: true},
			);
		},
	);

	// Plant: ignore a walk error below an object root, leaving uncertainty treated as safe.
	it.each(["direct", "catchup"] as const)(
		"T318 review3 %s keeps the pair when MAIN cannot be fully walked",
		(entry) => {
			fc.assert(
				fc.property(
					input,
					fc.array(fc.stringMatching(/^[a-z]{1,8}$/), {minLength: 1, maxLength: 6}),
					(v, parts) =>
						fixture(v, (f) => {
							const path = join(f.main, ".git/objects/pack", ...parts);
							mkdirSync(join(path, ".."), {recursive: true});
							symlinkSync(join(f.dir, "missing-storage"), path);
							const got = f.run(f.name, {}, entry);
							expect(got.code, got.text).toBe(entry === "direct" ? 1 : 0);
							expect(got.text).toMatch(new RegExp(`^kept box ${f.name}: [^\\n]+$`, "m"));
							expect(existsSync(f.work), got.text).toBe(true);
							expect(existsSync(f.data), got.text).toBe(true);
						}),
				),
				{seed: 31861, numRuns: 3, endOnFailure: true},
			);
		},
	);

	// Plant: today's guard protects only MAIN's checkout, so borrowed storage is deleted.
	// Cover nested alternates and intermediate links through both public callers.
	it.each(
		(["direct", "catchup"] as const).flatMap((entry) =>
			(
				[
					"gitdir-root",
					"shared",
					"gitdir",
					"commondir",
					"objects",
					"alternates",
					"alternates-file",
				] as const
			).flatMap((binding) =>
				(binding === "gitdir-root" || binding === "shared"
					? (["data"] as const)
					: (["work", "data"] as const)
				).flatMap((location) =>
					(binding === "gitdir-root" || binding === "shared" || binding === "alternates-file"
						? [false]
						: [false, true]
					).map((through) => ({entry, binding, location, through})),
				),
			),
		),
	)(
		"T318 $entry keeps MAIN storage reached by $binding in $location through link $through",
		({entry, binding, location, through}) => {
			fc.assert(
				fc.property(
					input,
					fc.record({
						parts: fc.array(fc.stringMatching(/^[a-z]{1,8}$/), {minLength: 1, maxLength: 5}),
						relative: fc.boolean(),
						hops: fc.integer({min: 2, max: 4}),
					}),
					(v, path) =>
						fixture(v, (f) => {
							const original = join(f.main, ".git");
							const history = f.git(f.main, "rev-list", "--objects", "--all");
							const target = join(
								location === "work" ? join(f.work, "node_modules") : join(f.data, "objects/info"),
								...path.parts,
								"storage",
							);
							const name = (from: string, to: string) => (path.relative ? relative(from, to) : to);
							mkdirSync(join(target, ".."), {recursive: true});

							if (binding === "gitdir-root") {
								rmSync(original, {recursive: true});
								writeFileSync(join(f.main, ".git"), `gitdir: ${name(f.main, f.data)}\n`);
							} else if (binding === "shared") {
								const borrower = join(f.dir, "borrower");
								f.git(f.dir, "clone", "-q", "--shared", f.work, borrower);
								rmSync(original, {recursive: true});
								renameSync(join(borrower, ".git"), original);
								expect(readFileSync(join(original, "objects/info/alternates"), "utf8")).toContain(
									join(f.data, "objects"),
								);
							} else if (binding === "alternates-file") {
								// The objects stay outside the box. Losing this borrowed metadata still
								// breaks MAIN, even though realpath(objects) points outside the pair.
								const outside = join(f.dir, "outside-objects");
								renameSync(join(original, "objects"), outside);
								mkdirSync(join(original, "objects/info"), {recursive: true});
								writeFileSync(target, `${name(join(original, "objects"), outside)}\n`);
								symlinkSync(
									name(join(original, "objects/info"), target),
									join(original, "objects/info/alternates"),
								);
							} else {
								const source = ["gitdir", "commondir"].includes(binding)
									? original
									: join(original, "objects");
								const stored = through ? join(f.dir, "outside-storage") : target;
								renameSync(source, stored);

								if (through) {
									symlinkSync(name(join(target, ".."), stored), target);
								}

								if (binding === "gitdir") {
									writeFileSync(original, `gitdir: ${name(f.main, target)}\n`);
								}

								if (binding === "commondir") {
									mkdirSync(original);
									writeFileSync(join(original, "HEAD"), readFileSync(join(stored, "HEAD")));
									writeFileSync(join(original, "commondir"), `${name(original, target)}\n`);
								}

								if (binding === "objects") {
									symlinkSync(name(original, target), source);
								}

								if (binding === "alternates") {
									let next = target;

									for (let i = 0; i < path.hops; i++) {
										const objects = i === path.hops - 1 ? source : join(f.dir, `alternate-${i}`);
										mkdirSync(join(objects, "info"), {recursive: true});
										writeFileSync(join(objects, "info/alternates"), `${name(objects, next)}\n`);
										next = objects;
									}
								}
							}

							expect(f.git(f.main, "rev-list", "--objects", "--all")).toBe(history);
							const got = f.run(f.name, {}, entry);
							expect(got.code, got.text).toBe(entry === "direct" ? 1 : 0);
							expect(got.text).toMatch(new RegExp(`^kept box ${f.name}: [^\\n]+$`, "m"));
							expect(existsSync(f.work)).toBe(true);
							expect(existsSync(f.data)).toBe(true);
							expect(f.git(f.main, "rev-list", "--objects", "--all")).toBe(history);
						}),
				),
				{seed: 31840, numRuns: 4, endOnFailure: true},
			);
		},
	);

	// Plant: peel a tag to its commit and accept it without retaining its annotation object.
	// Signature bytes are saved content here, not a claim about signature validity. No key is used.
	it.each(
		(["direct", "catchup"] as const).flatMap((entry) =>
			(["plain", "signed", "nested"] as const).flatMap((kind) =>
				(kind === "nested"
					? (["commit-only", "objects-only", "different-tag", "inner-only", "retained"] as const)
					: (["commit-only", "objects-only", "different-tag", "retained"] as const)
				).map((retention) => ({entry, kind, retention})),
			),
		),
	)(
		"T318 $entry preserves $kind annotation objects with $retention retention",
		({entry, kind, retention}) => {
			fc.assert(
				fc.property(
					input,
					fc.record({
						messages: fc.array(fc.string({unit: "grapheme", maxLength: 80}), {
							minLength: 0,
							maxLength: 5,
						}),
						depth: fc.integer({min: 2, max: 5}),
						signedInner: fc.boolean(),
					}),
					(v, annotation) =>
						fixture(v, (f) => {
							const commit = f.git(f.work, "rev-parse", "HEAD");
							const objects: string[] = [];
							const raw: string[] = [];
							const tag = (target: string, message: string, signed: boolean, label = v.name) => {
								const text = `object ${target}\ntype ${target === commit ? "commit" : "tag"}\ntag ${label}\ntagger Fixture <fixture@example.test> 1794096000 +0000\n\n${message}${signed ? `\n-----BEGIN PGP SIGNATURE-----\n${Buffer.from(v.value).toString("base64")}\n-----END PGP SIGNATURE-----\n` : ""}`;
								const made = spawnSync("/usr/bin/git", ["-C", f.work, "mktag"], {
									input: text,
									encoding: "utf8",
									env: f.env,
								});
								expect(made.status, made.stderr).toBe(0);
								return {oid: made.stdout.trim(), text};
							};
							let target = commit;

							for (let i = 0; i < (kind === "nested" ? annotation.depth : 1); i++) {
								const made = tag(
									target,
									annotation.messages.join("\n"),
									kind === "signed" || (kind === "nested" && annotation.signedInner),
								);
								objects.push(made.oid);
								raw.push(made.text);
								target = made.oid;
							}

							const ref = `refs/tags/${v.name}`;
							f.git(f.work, "update-ref", ref, target);
							const retainTag = (source: string) =>
								f.git(f.main, "fetch", "-q", "--no-tags", f.data, `${source}:refs/keep/${v.name}`);

							if (retention === "retained" || retention === "objects-only") {
								retainTag(ref);

								if (retention === "objects-only") {
									f.git(f.main, "update-ref", "-d", `refs/keep/${v.name}`);
								}
							}

							if (retention === "different-tag") {
								const other = tag(commit, annotation.messages.join("\n"), false, `other-${v.name}`);
								f.git(f.work, "update-ref", `refs/tags/other-${v.name}`, other.oid);
								retainTag(`refs/tags/other-${v.name}`);
							}

							if (retention === "inner-only") {
								retainTag(objects.at(-2)!);
							}

							const reachable = f
								.git(f.main, "rev-list", "--objects", "--all")
								.split("\n")
								.map((line) => line.split(" ")[0]);
							expect(reachable.includes(target)).toBe(retention === "retained");

							if (retention === "commit-only") {
								const absent = spawnSync("/usr/bin/git", ["-C", f.main, "cat-file", "-e", target], {
									env: f.env,
									encoding: "utf8",
								});
								expect(absent.status).not.toBe(0);
							}

							const got = f.run(f.name, {}, entry);
							const remove = retention === "retained";
							expect(got.code, got.text).toBe(entry === "catchup" || remove ? 0 : 1);
							expect(got.text).toMatch(
								new RegExp(
									`^${remove ? "removed" : "kept"} box ${f.name}${remove ? "$" : ": [^\\n]+$"}`,
									"m",
								),
							);
							expect(existsSync(f.work)).toBe(!remove);
							expect(existsSync(f.data)).toBe(!remove);

							for (const [i, oid] of objects.entries()) {
								const at = remove ? f.main : f.work;
								const read = spawnSync("/usr/bin/git", ["-C", at, "cat-file", "tag", oid], {
									env: f.env,
									encoding: "utf8",
								});
								expect(read.status, read.stderr).toBe(0);
								expect(read.stdout).toBe(raw[i]);
							}
						}),
				),
				{seed: 31841, numRuns: 3, endOnFailure: true},
			);
		},
	);

	// Plants: count fetched refs, remote reflogs or FETCH_HEAD as saved work; reject ORIG_HEAD
	// or config.worktree after a completed merge. All are normal in boxes made by box.sh new.
	it.each([false, true])(
		"T318 a fetched box branch removes with remote copies and config.worktree %s",
		(worktreeConfig) => {
			const branches = fc.uniqueArray(fc.stringMatching(/^[a-z]{2,8}$/), {
				minLength: 2,
				maxLength: 4,
			});
			fc.assert(
				fc.property(input, branches, fc.nat(), (v, names, choice) => {
					const remote = {
						branches: names.map((name) => `topic-${name}`),
						local: choice % names.length,
					};
					fixture(
						v,
						(f) => {
							const origin = join(f.dir, "origin.git"),
								branch = `step-${v.name}`,
								base = f.git(f.work, "rev-parse", "HEAD"),
								tree = f.git(f.main, "rev-parse", "HEAD^{tree}"),
								changed = remote.branches[remote.branches.length - 1]!;
							const packed = readFileSync(join(f.data, "packed-refs"), "utf8");

							for (const name of remote.branches) {
								expect(packed).toContain(` refs/remotes/origin/${name}\n`);
							}

							expect(f.git(f.main, "for-each-ref", "--format=%(refname)", "refs/heads")).toBe(
								["main", ...remote.branches.slice(0, remote.local)]
									.sort()
									.map((name) => `refs/heads/${name}`)
									.join("\n"),
							);
							f.git(f.work, "checkout", "-qb", branch);

							for (let i = 0; i < v.depth; i++) {
								writeFileSync(join(f.work, "tracked"), `${v.value} step ${i}`);
								f.commit();
							}

							const step = f.git(f.work, "rev-parse", "HEAD");

							// Move origin/main and one topic after both clones. The topic's older packed
							// tip, loose tip and remote reflog are all fetched copies, absent from MAIN's
							// retained history. FETCH_HEAD records every remote branch, too.
							for (const name of ["main", changed]) {
								const parent = f.git(f.main, "rev-parse", `origin/${name}`),
									tip = f.git(f.main, "commit-tree", tree, "-p", parent, "-m", `advance ${name}`);
								f.git(origin, "fetch", "-q", f.main, `${tip}:refs/heads/${name}`);
							}

							f.git(f.main, "fetch", "-q", "origin");
							f.git(f.work, "fetch", "-q", "origin");
							f.git(f.work, "merge", "-qm", `${v.value} merge`, "origin/main");
							expect(f.git(f.work, "rev-parse", "ORIG_HEAD")).toBe(step);
							expect(f.git(f.work, "rev-parse", "HEAD^2")).not.toBe(base);
							const fetched = f.git(f.work, "rev-parse", `origin/${changed}`);
							expect(
								readFileSync(join(f.data, "refs/remotes/origin", changed), "utf8").trim(),
							).toBe(fetched);
							expect(
								readFileSync(join(f.data, "logs/refs/remotes/origin", changed), "utf8"),
							).toContain(fetched);
							const fetchHead = readFileSync(join(f.data, "FETCH_HEAD"), "utf8");
							expect(fetchHead.trim().split("\n")).toHaveLength(remote.branches.length + 1);
							expect(fetchHead).toContain(fetched);

							if (worktreeConfig) {
								f.git(f.work, "config", "extensions.worktreeConfig", "true");
								f.git(f.work, "config", "--worktree", "user.name", "Fixture");
								expect(existsSync(join(f.data, "config.worktree"))).toBe(true);
							}

							f.retained(`refs/heads/${branch}`);
							expect(
								f
									.git(f.main, "rev-list", "--branches", "--tags", `refs/keep/${v.name}`)
									.split("\n"),
							).not.toContain(fetched);
							expect(f.run()).toEqual({code: 0, text: `removed box ${f.name}`});
							expect(existsSync(f.work)).toBe(false);
							expect(existsSync(f.data)).toBe(false);
						},
						true,
						remote,
					);
				}),
				{seed: 31828, numRuns: 4, endOnFailure: true},
			);
		},
	);

	// Plant: allow ORIG_HEAD as ordinary metadata but never read its saved commit.
	it("T318 a local commit saved only by ORIG_HEAD keeps the pair", () => {
		fc.assert(
			fc.property(input, (v) =>
				fixture(v, (f) => {
					const base = f.git(f.work, "rev-parse", "HEAD");

					for (let i = 0; i < v.depth; i++) {
						writeFileSync(join(f.work, "tracked"), `${v.value} saved ${i}`);
						f.commit();
					}

					const saved = f.git(f.work, "rev-parse", "HEAD");
					f.git(f.work, "checkout", "-q", "--detach", base);
					f.git(f.work, "branch", "-f", "main", base);
					rmSync(join(f.data, "logs"), {recursive: true});
					f.git(f.work, "update-ref", "ORIG_HEAD", saved);
					expect(f.git(f.work, "rev-list", "HEAD", "--all").split("\n")).not.toContain(saved);
					expect(existsSync(join(f.data, "logs"))).toBe(false);
					expect(f.git(f.work, "rev-parse", "ORIG_HEAD")).toBe(saved);
					kept(f);
				}),
			),
			{seed: 31829, numRuns: 4, endOnFailure: true},
		);
	});

	// Plant: skip every reflog, or skip names that merely start with refs/remotes.
	it.each([
		"HEAD",
		"refs/heads/saved",
		"refs/notes/saved",
		"refs/custom/saved",
		"refs/remotes-copy/saved",
	])("T318 a local commit saved only by the %s reflog keeps the pair", (ref) => {
		fc.assert(
			fc.property(input, (v) =>
				fixture(v, (f) => {
					const base = f.git(f.work, "rev-parse", "HEAD");

					for (let i = 0; i < v.depth; i++) {
						writeFileSync(join(f.work, "tracked"), `${v.value} saved ${i}`);
						f.commit();
					}

					const saved = f.git(f.work, "rev-parse", "HEAD");
					f.git(f.work, "checkout", "-q", "--detach", base);
					f.git(f.work, "branch", "-f", "main", base);
					rmSync(join(f.data, "logs"), {recursive: true});
					const name = ref === "HEAD" ? ref : `${ref}/${v.name}`,
						path = join(f.data, "logs", name);
					f.git(f.work, "update-ref", "--create-reflog", name, saved);
					f.git(f.work, "update-ref", "--create-reflog", name, base);

					if (name !== "HEAD") {
						rmSync(join(f.data, name));
					}

					expect(f.git(f.work, "rev-list", "HEAD", "--all").split("\n")).not.toContain(saved);
					expect(existsSync(join(f.data, "ORIG_HEAD"))).toBe(false);
					expect(readFileSync(path, "utf8")).toContain(saved);
					kept(f);
				}),
			),
			{seed: 31830, numRuns: 4, endOnFailure: true},
		);
	});

	// Plant: refuse the symbolic origin/HEAD that box.sh new creates.
	it("T318 a normal separate-gitdir clone keeps origin and removes cleanly", () => {
		fc.assert(
			fc.property(input, (v) =>
				fixture(
					v,
					(f) => {
						expect(f.git(f.work, "symbolic-ref", "refs/remotes/origin/HEAD")).toBe(
							"refs/remotes/origin/main",
						);
						expect(f.run()).toEqual({code: 0, text: `removed box ${f.name}`});
						expect(existsSync(f.work)).toBe(false);
						expect(existsSync(f.data)).toBe(false);
					},
					true,
				),
			),
			{seed: 31820, numRuns: 4, endOnFailure: true},
		);
	});

	// Plant: enumerate only heads/stash/notes, dropping tags and other namespaces.
	it.each(["lightweight", "annotated", "custom"])(
		"T318 every %s ref saves unretained work",
		(kind) => {
			const namespace = fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/), {
				minLength: 1,
				maxLength: 5,
			});
			fc.assert(
				fc.property(input, namespace, (v, parts) =>
					fixture(v, (f) => {
						const base = f.git(f.work, "rev-parse", "HEAD");
						writeFileSync(join(f.work, "tracked"), v.value);
						const tip = f.commit();
						f.git(f.work, "checkout", "-q", "--detach", base);
						f.git(f.work, "branch", "-f", "main", base);

						if (kind === "annotated") {
							f.git(f.work, "tag", "-a", parts.join("/"), tip, "-m", v.value);
						} else {
							f.git(
								f.work,
								"update-ref",
								`refs/${kind === "lightweight" ? "tags" : parts.join("/")}/${v.name}`,
								tip,
							);
						}

						kept(f);
					}),
				),
				{seed: 31821, numRuns: 5, endOnFailure: true},
			);
		},
	);

	// Plant: inspect refs/stash alone instead of every saved entry in its reflog.
	it("T318 every stash depth stays when only newer entries are retained", () => {
		fc.assert(
			fc.property(input, fc.integer({min: 2, max: 9}), fc.nat(), (v, depth, choice) =>
				fixture(v, (f) => {
					const missing = 1 + (choice % (depth - 1));

					for (let i = 0; i < depth; i++) {
						writeFileSync(join(f.work, "tracked"), `${v.value} ${i}`);
						f.git(f.work, "stash", "push", "-qm", `${v.name}-${i}`);
					}

					for (let i = 0; i < depth; i++) {
						if (i !== missing) {
							f.git(
								f.main,
								"fetch",
								"-q",
								f.data,
								`${f.git(f.work, "rev-parse", `stash@{${i}}`)}:refs/keep/stash-${i}`,
							);
						}
					}

					kept(f);
				}),
			),
			{seed: 31822, numRuns: 5, endOnFailure: true},
		);
	});

	// Plant: ignore operation state, including an unretained MERGE_AUTOSTASH.
	it("T318 every operation-state file keeps the pair", () => {
		const states = fc.oneof(
			fc.constantFrom(
				"MERGE_AUTOSTASH",
				"MERGE_HEAD",
				"CHERRY_PICK_HEAD",
				"REVERT_HEAD",
				"REBASE_HEAD",
				"AUTO_MERGE",
				"rebase-merge/autostash",
				"rebase-apply/autostash",
				"sequencer/head",
				"BISECT_START",
			),
			fc.stringMatching(/^[A-Z]{2,12}$/).map((s) => `${s}_HEAD`),
		);
		fc.assert(
			fc.property(input, states, (v, state) =>
				fixture(v, (f) => {
					const base = f.git(f.work, "rev-parse", "HEAD");
					writeFileSync(join(f.work, "tracked"), v.value);
					const tip = f.commit();
					f.git(f.work, "checkout", "-q", "--detach", base);
					f.git(f.work, "branch", "-f", "main", base);
					const path = join(f.data, state);
					mkdirSync(join(path, ".."), {recursive: true});
					writeFileSync(path, `${tip}\n`);
					kept(f);
				}),
			),
			{seed: 31823, numRuns: 12, endOnFailure: true},
		);
	});

	// Plants: inspect only the primary HEAD/index; ignore a linked worktree's saved index.
	it.each(["detached", "staged"])("T318 linked worktrees keep %s work", (kind) => {
		fc.assert(
			fc.property(input, fc.integer({min: 1, max: 4}), fc.boolean(), (v, total, inside) =>
				fixture(v, (f) => {
					for (let i = 0; i < total; i++) {
						const linked = join(inside ? f.work : f.dir, `${v.name}-linked-${i}`);
						f.git(f.work, "worktree", "add", "-q", "--detach", linked, "HEAD");

						if (i !== total - 1) {
							continue;
						}

						writeFileSync(join(linked, "tracked"), `${v.value} saved`);
						f.git(linked, "add", "tracked");

						if (kind === "detached") {
							f.git(linked, "commit", "-qm", v.value);
						} else {
							writeFileSync(join(linked, "tracked"), readFileSync(join(f.main, "tracked")));
						}
					}

					kept(f);
				}),
			),
			{seed: 31824, numRuns: 4, endOnFailure: true},
		);
	});

	// Plant: accept a valid pair even though it holds MAIN or BOXES/state.
	it.each(["main-work", "main-data", "main-child", "main-data-child", "state"])(
		"T318 protected %s locations survive direct removal",
		(kind) => {
			fc.assert(
				fc.property(input, (v) =>
					fixture(kind === "state" ? {...v, name: "state", space: false} : v, (f) => {
						let main = f.main;

						if (kind.startsWith("main")) {
							main =
								kind === "main-work"
									? f.work
									: kind === "main-data"
										? f.data
										: join(
												kind === "main-data-child" ? f.data : f.work,
												...Array.from({length: v.depth}, (_, i) => `child-${v.value}-${i}`),
											);

							if (kind.endsWith("child")) {
								mkdirSync(main, {recursive: true});
							}
						}

						const saved = join(kind === "state" ? f.work : main, "saved.md");
						writeFileSync(saved, v.value);
						const got = f.run(f.name, {MAIN: main});
						expect(got.code, got.text).toBe(1);
						expect(got.text).toMatch(/^kept box .*: [^\n]+$/);
						expect(existsSync(f.work)).toBe(true);
						expect(existsSync(f.data)).toBe(true);
						expect(readFileSync(saved, "utf8")).toBe(v.value);
					}),
				),
				{seed: 31825, numRuns: 3, endOnFailure: true},
			);
		},
	);

	// Plants: use exists() for commondir/shallow; omit the sharedindex guard.
	it.each(["commondir", "shallow", "sharedindex"])(
		"T318 dangling %s metadata keeps both paths",
		(kind) => {
			fc.assert(
				fc.property(input, fc.stringMatching(/^[0-9a-f]{40}$/), (v, hash) =>
					fixture(v, (f) => {
						symlinkSync(
							join(f.dir, `${v.value}-missing`),
							join(f.data, kind === "sharedindex" ? `sharedindex.${hash}` : kind),
						);
						kept(f);
					}),
				),
				{seed: 31826, numRuns: 4, endOnFailure: true},
			);
		},
	);

	// Plant: ignore only status's failed exit while ls-files still succeeds.
	it("T318 failed status alone keeps both paths", () => {
		fc.assert(
			fc.property(input, (v) =>
				fixture(v, (f) => {
					const bin = join(f.dir, "bin"),
						log = join(f.dir, "git-calls");
					mkdirSync(bin);
					writeFileSync(
						join(bin, "git"),
						`#!/bin/sh\nfor arg do\n case "$arg" in status) echo status >> '${log}'; exit 1;; ls-files) echo ls-files >> '${log}';; esac\ndone\nexec /usr/bin/git "$@"\n`,
						{mode: 0o755},
					);
					const got = f.run(f.name, {PATH: `${bin}:/usr/bin:/bin`});
					expect(got.code, got.text).toBe(1);
					expect(got.text).toMatch(/^kept box .*: [^\n]+$/);
					expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["ls-files", "status"]);
					expect(existsSync(f.work)).toBe(true);
					expect(existsSync(f.data)).toBe(true);
				}),
			),
			{seed: 31827, numRuns: 4, endOnFailure: true},
		);
	});
	// Plants: split a space-containing name; reject untracked-only files; delete a neighbor.
	it("T318 rm deletes exactly a clean pair including spaces and untracked-only contents and repeats", () => {
		fc.assert(
			fc.property(input, (v) =>
				fixture({...v, space: true}, (f) => {
					for (const path of [join(f.boxes, `${f.name}-neighbor`), join(f.boxes, "state")]) {
						mkdirSync(path);
						writeFileSync(join(path, "saved.md"), v.value);
					}

					writeFileSync(join(f.work, `${v.value}.untracked`), v.value);
					mkdirSync(join(f.work, "node_modules"));
					writeFileSync(join(f.work, "node_modules/install"), v.value);
					const got = f.run();
					expect(got.code, got.text).toBe(0);
					expect(got.text).toBe(`removed box ${f.name}`);
					expect(existsSync(f.work)).toBe(false);
					expect(existsSync(f.data)).toBe(false);

					for (const path of [`${f.name}-neighbor`, "state"]) {
						expect(readFileSync(join(f.boxes, path, "saved.md"), "utf8")).toBe(v.value);
					}

					expect(f.run()).toEqual({code: 0, text: `absent box ${f.name}`});
				}),
			),
			{seed: 3186, numRuns: 4},
		);
	});

	// Plant: drop the keepruns.sh call; the box's runs/ goes with the folder (field note 2026-11-09:
	// experiment 244's raw answers were lost that way).
	it.each(["direct", "catchup"] as const)(
		"T475 %s rm moves the box's runs/ into MAIN's runs/<box>/ before the box goes",
		(entry) => {
			fc.assert(
				fc.property(input, (v) =>
					fixture({...v, space: true}, (f) => {
						mkdirSync(join(f.work, "runs", v.value), {recursive: true});
						writeFileSync(join(f.work, "runs", v.value, "answers.jsonl"), v.value);
						const got = f.run(f.name, {}, entry);
						expect(got.code, got.text).toBe(0);
						expect(got.text).toContain(`kept runs of ${f.name} at runs/${f.name}`);
						expect(got.text).toContain(`removed box ${f.name}`);
						expect(existsSync(f.work)).toBe(false);
						expect(
							readFileSync(join(f.main, "runs", f.name, v.value, "answers.jsonl"), "utf8"),
						).toBe(v.value);
					}),
				),
				{seed: 3186, numRuns: 3},
			);
		},
	);

	// Plants: inspect only unstaged changes; treat an unsuccessful status as empty output.
	it("T318 every tracked change and failed status keep both paths", () => {
		fc.assert(
			fc.property(input, (v) => {
				for (const change of [
					"staged",
					"unstaged",
					"addition",
					"deletion",
					"staged-deletion",
					"conflict",
					"status-failed",
				]) {
					fixture(v, (f) => {
						expect.hasAssertions();
						const tracked = join(f.work, "tracked");

						if (change === "staged" || change === "unstaged") {
							writeFileSync(tracked, `changed ${v.value}`);

							if (change === "staged") {
								f.git(f.work, "add", "tracked");
							}
						}

						if (change === "addition") {
							writeFileSync(join(f.work, "added"), v.value);
							f.git(f.work, "add", "added");
						}

						if (change.includes("deletion")) {
							rmSync(tracked);

							if (change === "staged-deletion") {
								f.git(f.work, "add", "tracked");
							}
						}

						if (change === "conflict") {
							const hash = f.git(f.work, "rev-parse", "HEAD:tracked");
							f.git(f.work, "update-index", "--force-remove", "tracked");
							const ran = spawnSync(
								"/usr/bin/git",
								["-C", f.work, "update-index", "--index-info"],
								{
									input: `100644 ${hash} 1\ttracked\n100644 ${hash} 2\ttracked\n100644 ${hash} 3\ttracked\n`,
									encoding: "utf8",
									env: f.env,
								},
							);
							expect(ran.status).toBe(0);
						}

						if (change === "status-failed") {
							writeFileSync(join(f.data, "index"), "unreadable index bytes");
						}

						kept(f);
					});
				}
			}),
			{seed: 3187, numRuns: 3},
		);
	});

	// Plants: check HEAD alone; accept objects or remote-tracking refs without retained MAIN ancestry.
	it("T318 each local branch detached HEAD stash and step-note needs MAIN retention", () => {
		fc.assert(
			fc.property(input, (v) => {
				for (const kind of [
					"branch",
					"detached",
					"stash",
					"notes",
					"remote-only",
					"objects-only",
				]) {
					for (const retain of [false, true]) {
						fixture(v, (f) => {
							const base = f.git(f.work, "rev-parse", "HEAD");

							for (let i = 0; i < v.depth; i++) {
								writeFileSync(join(f.work, "tracked"), `extra ${v.value} ${i}`);
								f.commit();
							}

							const tip = f.git(f.work, "rev-parse", "HEAD");
							let ref = "refs/heads/extra";

							if (kind === "detached") {
								f.git(f.work, "checkout", "-q", "--detach", tip);
								f.git(f.work, "branch", "-f", "main", base);
								ref = "HEAD";
							} else {
								f.git(f.work, "branch", "extra", tip);
								f.git(f.work, "checkout", "-q", "--detach", base);
								f.git(f.work, "branch", "-f", "main", base);

								if (kind === "stash" || kind === "notes") {
									ref = kind === "stash" ? "refs/stash" : "refs/notes/fabrika";
									f.git(f.work, "update-ref", ref, tip);
									f.git(f.work, "branch", "-D", "extra");
								}
							}

							if (kind === "objects-only" || kind === "remote-only") {
								f.git(f.main, "fetch", "-q", f.data, `${ref}:refs/remotes/fixture/extra`);

								if (kind === "objects-only") {
									f.git(f.main, "update-ref", "-d", "refs/remotes/fixture/extra");
								}
							}

							if (retain) {
								f.retained(ref);

								if (v.descendant) {
									const kept = `refs/keep/${v.name}`,
										tree = f.git(f.main, "rev-parse", `${kept}^{tree}`);
									const child = f.git(
										f.main,
										"commit-tree",
										tree,
										"-p",
										tip,
										"-m",
										"retained descendant",
									);
									f.git(f.main, "update-ref", kept, child);
								}
							}

							const got = f.run();
							expect(got.code, `${kind}: ${got.text}`).toBe(retain ? 0 : 1);
							expect(got.text).toMatch(retain ? /^removed box / : /^kept box /);
							expect(existsSync(f.work)).toBe(!retain);
							expect(existsSync(f.data)).toBe(!retain);
						});
					}
				}
			}),
			{seed: 3188, numRuns: 3},
		);
	});

	// Plants: follow a symlink/escaping name, or delete one half before validating the other.
	it("T318 invalid names partial pairs malformed metadata and symlinks keep all other paths", () => {
		fc.assert(
			fc.property(input, (v) => {
				for (const kind of [
					"name",
					"missing-data",
					"missing-work",
					"metadata",
					"data-link",
					"work-link",
					"outside-pointer",
				]) {
					fixture(v, (f) => {
						const outside = join(f.dir, "outside");
						mkdirSync(outside);
						writeFileSync(join(outside, "keep"), v.value);

						if (kind === "name") {
							for (const name of [
								"",
								".",
								"..",
								`../${v.name}`,
								`x/${v.name}`,
								`x\\${v.name}`,
								`${v.name}\n`,
								`${v.name}\t`,
								`${v.name}\u0001`,
								outside,
							]) {
								const got = f.run(name);
								expect(got.code, got.text).toBe(2);
								expect(existsSync(f.work)).toBe(true);
								expect(existsSync(f.data)).toBe(true);
							}
						} else {
							if (kind === "missing-data" || kind === "data-link") {
								rmSync(f.data, {recursive: true});
							}

							if (kind === "missing-work" || kind === "work-link") {
								rmSync(f.work, {recursive: true});
							}

							if (kind === "data-link") {
								symlinkSync(outside, f.data);
							}

							if (kind === "work-link") {
								symlinkSync(outside, f.work);
							}

							if (kind === "metadata") {
								writeFileSync(join(f.data, "HEAD"), "not git metadata");
							}

							if (kind === "outside-pointer") {
								writeFileSync(join(f.work, ".git"), `gitdir: ${outside}\n`);
							}

							const got = f.run();
							expect(got.code, got.text).toBe(1);
							expect(got.text).toMatch(/^kept box /);
							expect(existsSync(f.work)).toBe(kind !== "missing-work");
							expect(existsSync(f.data)).toBe(kind !== "missing-data");
						}

						expect(readFileSync(join(outside, "keep"), "utf8")).toBe(v.value);
					});
				}
			}),
			{seed: 3189, numRuns: 3},
		);
	});

	// Plant (mutation, seed 119120): skip the keep on a malformed gitdir pointer, which ends in a
	// traceback. Missing refs or objects must keep too; a later guard also catches those.
	it("T318 a malformed pointer or missing refs or objects keeps the pair with one result line", () => {
		const word = fc.stringMatching(/^[a-z]{1,12}$/);
		const pointer = fc.oneof(
			fc.constant(""),
			word,
			word.map((s) => `gitdir:${s}`),
			word.map((s) => `gitdir: ${s}\n\n`),
			word.map((s) => `gitdir: a\0${s}`),
		);
		fc.assert(
			fc.property(input, pointer, (v, text) => {
				for (const kind of ["pointer", "refs", "objects"]) {
					fixture(v, (f) => {
						if (kind === "pointer") {
							writeFileSync(join(f.work, ".git"), text);
						} else {
							rmSync(join(f.data, kind), {recursive: true});
						}

						kept(f);
					});
				}
			}),
			{seed: 3194, numRuns: 6},
		);
	});

	// Plant: use the box's original gitdir/config and observe its fsmonitor/filter/include marker run.
	it("T318 inspection never executes box or inherited Git programs or writes its index", () => {
		fc.assert(
			fc.property(input, (v) => {
				for (const kind of ["hook", "fsmonitor", "filter", "include", "inherited"]) {
					for (const dirty of [false, true]) {
						fixture(v, (f) => {
							const marker = join(f.dir, "executed"),
								program = join(f.dir, "program");
							writeFileSync(program, `#!/bin/sh\nprintf bad >> '${marker}'\ncat\n`, {mode: 0o755});
							const include = join(f.dir, "included-config");
							writeFileSync(include, `[core]\nfsmonitor = ${program}\n`);

							if (kind === "fsmonitor") {
								f.git(f.work, "config", "core.fsmonitor", program);
							}

							if (kind === "hook") {
								f.git(f.work, "config", "core.hooksPath", f.dir);
							}

							if (kind === "include") {
								f.git(f.work, "config", "include.path", include);
							}

							if (kind === "filter") {
								f.git(f.work, "config", "filter.fixture.clean", program);
								writeFileSync(join(f.work, ".gitattributes"), "tracked filter=fixture\n");
							}

							writeFileSync(join(f.work, "tracked"), readFileSync(join(f.work, "tracked")));

							if (dirty) {
								writeFileSync(join(f.work, "tracked"), `dirty ${v.value}`);
							}

							writeFileSync(join(f.dir, "post-index-change"), readFileSync(program), {mode: 0o755});
							const index = readFileSync(join(f.data, "index"));
							const got = f.run(
								f.name,
								kind === "inherited"
									? {
											GIT_CONFIG_COUNT: "1",
											GIT_CONFIG_KEY_0: "core.fsmonitor",
											GIT_CONFIG_VALUE_0: program,
										}
									: {},
							);
							expect(got.code, got.text).toBe(dirty ? 1 : 0);
							expect(got.text).toMatch(dirty ? /^kept box / : /^removed box /);
							expect(existsSync(marker)).toBe(false);

							if (dirty) {
								expect(readFileSync(join(f.data, "index"))).toEqual(index);
							}
						});
					}
				}
			}),
			{seed: 3190, numRuns: 4},
		);
	});
});
