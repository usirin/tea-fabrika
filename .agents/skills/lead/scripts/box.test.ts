import {spawnSync} from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import fc from "fast-check";
import {describe, expect, it} from "vitest";

const script = join(import.meta.dirname, "box.sh");
const input = fc.record({
	name: fc.stringMatching(/^[a-z]{2,8}$/),
	value: fc.stringMatching(/^[a-z]{1,12}$/),
	space: fc.boolean(),
	depth: fc.integer({min: 1, max: 3}),
	descendant: fc.boolean(),
});
type Input = {name: string; value: string; space: boolean; depth: number; descendant: boolean};
const fixture = (v: Input, body: (f: ReturnType<typeof setup>) => void, clone = false) => {
	const f = setup(v, clone);
	try {
		body(f);
	} finally {
		rmSync(f.dir, {recursive: true, force: true});
	}
};
const setup = (v: Input, clone: boolean) => {
	const dir = mkdtempSync(join(tmpdir(), "box-law-")),
		main = join(dir, "main"),
		boxes = join(dir, "boxes");
	const name = `${v.name}${v.space ? " with space" : ""}`;
	const work = join(boxes, name),
		data = `${work}-gitdata`,
		home = join(dir, "home");
	for (const path of [main, boxes, home]) mkdirSync(path);
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
			timeout: 5_000,
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
	const origin = join(dir, "origin.git");
	git(main, "clone", "-q", "--bare", "--no-hardlinks", main, origin);
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
	expect(git(main, "remote")).toBe("");
	expect(git(work, "remote")).toBe("origin");
	const run = (chosen = name, extra: Record<string, string> = {}) => {
		const ran = spawnSync("sh", [script, "rm", chosen], {
			cwd: main,
			encoding: "utf8",
			env: {...env, ...extra},
			timeout: 5_000,
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
						if (kind === "annotated")
							f.git(f.work, "tag", "-a", parts.join("/"), tip, "-m", v.value);
						else
							f.git(
								f.work,
								"update-ref",
								`refs/${kind === "lightweight" ? "tags" : parts.join("/")}/${v.name}`,
								tip,
							);
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
					for (let i = 0; i < depth; i++)
						if (i !== missing)
							f.git(
								f.main,
								"fetch",
								"-q",
								f.data,
								`${f.git(f.work, "rev-parse", `stash@{${i}}`)}:refs/keep/stash-${i}`,
							);
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
						if (i !== total - 1) continue;
						writeFileSync(join(linked, "tracked"), `${v.value} saved`);
						f.git(linked, "add", "tracked");
						if (kind === "detached") f.git(linked, "commit", "-qm", v.value);
						else writeFileSync(join(linked, "tracked"), readFileSync(join(f.main, "tracked")));
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
							if (kind.endsWith("child")) mkdirSync(main, {recursive: true});
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
					for (const path of [`${f.name}-neighbor`, "state"])
						expect(readFileSync(join(f.boxes, path, "saved.md"), "utf8")).toBe(v.value);
					expect(f.run()).toEqual({code: 0, text: `absent box ${f.name}`});
				}),
			),
			{seed: 3186, numRuns: 4},
		);
	});

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
				])
					fixture(v, (f) => {
						expect.hasAssertions();
						const tracked = join(f.work, "tracked");
						if (change === "staged" || change === "unstaged") {
							writeFileSync(tracked, `changed ${v.value}`);
							if (change === "staged") f.git(f.work, "add", "tracked");
						}
						if (change === "addition") {
							writeFileSync(join(f.work, "added"), v.value);
							f.git(f.work, "add", "added");
						}
						if (change.includes("deletion")) {
							rmSync(tracked);
							if (change === "staged-deletion") f.git(f.work, "add", "tracked");
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
						if (change === "status-failed")
							writeFileSync(join(f.data, "index"), "unreadable index bytes");
						kept(f);
					});
			}),
			{seed: 3187, numRuns: 3},
		);
	});

	// Plants: check HEAD alone; accept objects or remote-tracking refs without retained MAIN ancestry.
	it("T318 each local branch detached HEAD stash and step-note needs MAIN retention", () => {
		fc.assert(
			fc.property(input, (v) => {
				for (const kind of ["branch", "detached", "stash", "notes", "remote-only", "objects-only"])
					for (const retain of [false, true])
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
								if (kind === "objects-only")
									f.git(f.main, "update-ref", "-d", "refs/remotes/fixture/extra");
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
				])
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
							if (kind === "missing-data" || kind === "data-link")
								rmSync(f.data, {recursive: true});
							if (kind === "missing-work" || kind === "work-link")
								rmSync(f.work, {recursive: true});
							if (kind === "data-link") symlinkSync(outside, f.data);
							if (kind === "work-link") symlinkSync(outside, f.work);
							if (kind === "metadata") writeFileSync(join(f.data, "HEAD"), "not git metadata");
							if (kind === "outside-pointer")
								writeFileSync(join(f.work, ".git"), `gitdir: ${outside}\n`);
							const got = f.run();
							expect(got.code, got.text).toBe(1);
							expect(got.text).toMatch(/^kept box /);
							expect(existsSync(f.work)).toBe(kind !== "missing-work");
							expect(existsSync(f.data)).toBe(kind !== "missing-data");
						}
						expect(readFileSync(join(outside, "keep"), "utf8")).toBe(v.value);
					});
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
				for (const kind of ["pointer", "refs", "objects"])
					fixture(v, (f) => {
						if (kind === "pointer") writeFileSync(join(f.work, ".git"), text);
						else rmSync(join(f.data, kind), {recursive: true});
						kept(f);
					});
			}),
			{seed: 3194, numRuns: 6},
		);
	});

	// Plant: use the box's original gitdir/config and observe its fsmonitor/filter/include marker run.
	it("T318 inspection never executes box or inherited Git programs or writes its index", () => {
		fc.assert(
			fc.property(input, (v) => {
				for (const kind of ["hook", "fsmonitor", "filter", "include", "inherited"])
					for (const dirty of [false, true])
						fixture(v, (f) => {
							const marker = join(f.dir, "executed"),
								program = join(f.dir, "program");
							writeFileSync(program, `#!/bin/sh\nprintf bad >> '${marker}'\ncat\n`, {mode: 0o755});
							const include = join(f.dir, "included-config");
							writeFileSync(include, `[core]\nfsmonitor = ${program}\n`);
							if (kind === "fsmonitor") f.git(f.work, "config", "core.fsmonitor", program);
							if (kind === "hook") f.git(f.work, "config", "core.hooksPath", f.dir);
							if (kind === "include") f.git(f.work, "config", "include.path", include);
							if (kind === "filter") {
								f.git(f.work, "config", "filter.fixture.clean", program);
								writeFileSync(join(f.work, ".gitattributes"), "tracked filter=fixture\n");
							}
							writeFileSync(join(f.work, "tracked"), readFileSync(join(f.work, "tracked")));
							if (dirty) writeFileSync(join(f.work, "tracked"), `dirty ${v.value}`);
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
							if (dirty) expect(readFileSync(join(f.data, "index"))).toEqual(index);
						});
			}),
			{seed: 3190, numRuns: 4},
		);
	});
});
