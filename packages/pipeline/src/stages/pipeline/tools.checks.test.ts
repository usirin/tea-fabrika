import {execFileSync} from "node:child_process";
import {
	appendFileSync,
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Duration, Effect, Fiber, Layer} from "effect";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {memoryLedger} from "../../asks/ledger.ts";
import type {Settings} from "../../settings.ts";
import {ticketsOnLedger} from "../../tickets/tickets.ts";
import {CheckRunner} from "./checks.ts";
import {formatAt} from "./format.ts";
import {makeLaneHome} from "./lane-fixture.ts";
import {laneCheckRunner} from "./tools.ts";
import {LaneHome, LaneWork, laneWork} from "./work.ts";

// Today's version. Tracker ticket 184: the lane checks a head in a real checkout of it, as CI does
// with actions/checkout, not in a copy that `git archive` and `tar` made. A check that asks git
// anything (this repo's `pnpm lint` does, since #226) fails in a copy with no `.git`, so on ticket
// 117 the lane's checks were red at a head that GitHub's CI found green.
//
//   checks at head h   a detached worktree of the lane's clone at h, made for this run alone
//   the run ends       ok, red, timed out or stopped: the worktree is removed and pruned
//
// On real git over a bare remote, through the lane's own `LaneWork` and `laneCheckRunner`. Each check
// command writes down where it ran, outside the folder, so the test can read it after the folder goes.

const IDENTITY = {
	GIT_AUTHOR_NAME: "fixture",
	GIT_AUTHOR_EMAIL: "fixture@fabrika.invalid",
	GIT_COMMITTER_NAME: "fixture",
	GIT_COMMITTER_EMAIL: "fixture@fabrika.invalid",
};

const git = (cwd: string, ...args: readonly string[]) =>
	execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		env: {...process.env, ...IDENTITY},
		stdio: "pipe",
	});

type Command = NonNullable<NonNullable<Settings["build"]>["checks"]>[number];

/**
 * A check that writes one line to `file`: the folder it ran in, the top of the git repository there,
 * and that repository's `HEAD`. It ends non-zero when git finds no repository, as `lint.ts` does.
 */
const recordTo = (file: string): Command => [
	"sh",
	"-c",
	'set -e; top=$(git -C "$PWD" rev-parse --show-toplevel); at=$(git -C "$PWD" rev-parse HEAD); printf "%s %s %s\\n" "$(pwd -P)" "$top" "$at" >> "$1"',
	"sh",
	file,
];

/**
 * A check that writes only the folder it ran in to `file`, then waits `seconds`. It asks git nothing,
 * so what it shows does not hang on the law above.
 */
const folderTo = (file: string, seconds = 0): Command => [
	"sh",
	"-c",
	'pwd -P >> "$1"; sleep "$2"',
	"sh",
	file,
	String(seconds),
];

/** The folders a check wrote with `folderTo`. */
const foldersIn = (file: string) =>
	readFileSync(file, "utf8")
		.split("\n")
		.filter((line) => line !== "");

/** The lines a check wrote with `recordTo`, each read as where it ran. */
const recorded = (file: string) =>
	readFileSync(file, "utf8")
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => {
			const [folder = "", top = "", head = ""] = line.split(" ");
			return {folder, top, head};
		});

/** The clone's worktrees, by path, as git lists them. */
const worktreeList = (home: string) =>
	git(join(home, "work", "clone"), "worktree", "list", "--porcelain")
		.split("\n")
		.filter((line) => line.startsWith("worktree "))
		.map((line) => line.slice("worktree ".length));

/** What `git worktree prune` would still take away: nothing, when every worktree that went was pruned. */
const unpruned = (home: string) =>
	git(join(home, "work", "clone"), "worktree", "prune", "--dry-run", "--verbose").trim();

/** Until `file` is there: a check that writes it has started. */
const appeared = (file: string) =>
	Effect.gen(function* () {
		while (!existsSync(file)) yield* Effect.sleep(Duration.millis(50));
	}).pipe(Effect.timeout(Duration.seconds(30)));

describe("the folder the lane runs its checks in (tracker ticket 184)", () => {
	let dir: string;
	beforeEach(() => {
		dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-checkout-")));
	});
	afterEach(() => rmSync(dir, {recursive: true, force: true}));

	/** The fixture's lane home, and one lane's real `LaneWork` on it whose `[build] checks` are `commands`. */
	const laneWith = (made: ReturnType<typeof makeLaneHome>, commands: readonly Command[]) => {
		const real = laneWork.pipe(
			Layer.provide(
				Layer.succeed(LaneHome, {
					home: made.home,
					checkout: made.seed,
					briefs: "",
					person: "owner",
				}),
			),
		);
		const work = Layer.effect(
			LaneWork,
			Effect.gen(function* () {
				const lane = yield* LaneWork;
				return {
					...lane,
					settings: Effect.map(lane.settings, (s) => ({
						...s,
						build: {...s.build, checks: [...commands]},
					})),
				};
			}),
		).pipe(Layer.provide(real));
		return Layer.provideMerge(laneCheckRunner, work);
	};
	const newHome = () => makeLaneHome({dir, nodeModules: join(dir, "no-modules")});

	// The law: whatever head the lane checks, its checks run at the top of a git repository whose
	// `HEAD` is that head. Over main's tip and two commits of the lane's own on top of it.
	it("is a git repository whose HEAD is the head it checks, at every head", async () => {
		const made = newHome();
		const ranIn = join(dir, "ran-in");
		const {heads, runs} = await Effect.runPromise(
			Effect.gen(function* () {
				const lane = yield* LaneWork;
				const {tree, base} = yield* lane.tree(1);
				const first = yield* lane.commit(
					tree,
					[{path: "src/a.ts", text: "export const a = 1;\n"}],
					"a",
				);
				const second = yield* lane.commit(
					tree,
					[{path: "src/b.ts", text: "export const b = 2;\n"}],
					"b",
				);
				const heads = [base, first, second];
				const checks = yield* CheckRunner;
				const runs = yield* Effect.forEach(heads, (head) => checks.run(head), {concurrency: 1});
				return {heads, runs};
			}).pipe(Effect.provide(laneWith(made, [recordTo(ranIn)]))),
		);
		expect(
			runs.map((run) => run.result),
			"git found a repository in every checks folder",
		).toEqual(["green", "green", "green"]);
		const lines = recorded(ranIn);
		expect(lines.map((line) => line.head)).toEqual(heads);
		for (const line of lines)
			expect(line.top, "the repository's top is the folder itself").toBe(line.folder);
	});

	// A check that calls git passes there. The second is the call `oxlint-plugins/lint.ts` makes.
	it.each<[string, Command]>([
		["git ls-files --error-unmatch", ["git", "ls-files", "--error-unmatch", "src/slug.ts"]],
		[
			"lint.ts's read of what a .gitignore hides",
			[
				"sh",
				"-c",
				'set -e; hidden=$(git ls-files -ci --exclude-per-directory=.gitignore); test -z "$hidden"',
			],
		],
	])("a check that calls git ends with 0: %s", async (_, command) => {
		const made = newHome();
		const checked = await Effect.runPromise(
			Effect.gen(function* () {
				const {base} = yield* (yield* LaneWork).tree(1);
				return yield* (yield* CheckRunner).run(base);
			}).pipe(Effect.provide(laneWith(made, [command]))),
		);
		expect(checked.commands.map((ran) => ran.code)).toEqual([0]);
		expect(checked.result).toBe("green");
	});

	// Leave nothing behind: a stopped lane holds no worktree on the head, and git keeps no stale entry.
	describe("is removed and pruned once the checks end", () => {
		it.each<[string, (ranIn: string) => readonly Command[], string]>([
			["green", (ranIn) => [folderTo(ranIn)], "green"],
			["red", (ranIn) => [folderTo(ranIn), ["false"]], "red"],
		])("%s", async (_, commands, result) => {
			const made = newHome();
			const ranIn = join(dir, "ran-in");
			const checked = await Effect.runPromise(
				Effect.gen(function* () {
					const {base} = yield* (yield* LaneWork).tree(1);
					return yield* (yield* CheckRunner).run(base);
				}).pipe(Effect.provide(laneWith(made, commands(ranIn)))),
			);
			expect(checked.result).toBe(result);
			const [folder = ""] = foldersIn(ranIn);
			expect(folder).not.toBe("");
			expect(existsSync(folder), `${folder} is still there`).toBe(false);
			expect(worktreeList(made.home)).not.toContain(folder);
			expect(unpruned(made.home)).toBe("");
		});

		it("when the lane is stopped mid-check", {timeout: 60_000}, async () => {
			const made = newHome();
			const ranIn = join(dir, "ran-in");
			const slow = folderTo(ranIn, 30);
			await Effect.runPromise(
				Effect.scoped(
					Effect.gen(function* () {
						const {base} = yield* (yield* LaneWork).tree(1);
						const running = yield* Effect.forkScoped((yield* CheckRunner).run(base));
						yield* appeared(ranIn);
						yield* Fiber.interrupt(running);
					}),
				).pipe(Effect.provide(laneWith(made, [slow]))),
			);
			const folder = readFileSync(ranIn, "utf8").trim();
			expect(folder).not.toBe("");
			expect(existsSync(folder), `${folder} is still there`).toBe(false);
			expect(worktreeList(made.home)).not.toContain(folder);
			expect(unpruned(made.home)).toBe("");
		});
	});

	// Two lanes at once, or one lane at the same head twice, each get a folder of their own: a check
	// in one never sees what a check in the other writes, and one ending never takes the other's away.
	describe("is a folder of its own for each run", () => {
		/** A check that writes where it ran, then stays a moment, so two runs overlap. */
		const overlapping = (ranIn: string): readonly Command[] => [folderTo(ranIn, 2)];

		it("for two lanes at the same head at once", {timeout: 60_000}, async () => {
			const made = newHome();
			const ranIn = join(dir, "ran-in");
			// The clone and main's tip, made first: two lanes cloning at once is not what this test asks.
			const base = await Effect.runPromise(
				Effect.gen(function* () {
					return (yield* (yield* LaneWork).tree(1)).base;
				}).pipe(Effect.provide(laneWith(made, []))),
			);
			const checkAs = (n: number) =>
				Effect.runPromise(
					Effect.gen(function* () {
						yield* (yield* LaneWork).servingLane(n);
						return yield* (yield* CheckRunner).run(base);
					}).pipe(Effect.provide(laneWith(made, overlapping(ranIn)))),
				);
			const runs = await Promise.all([checkAs(1), checkAs(2)]);
			expect(runs.map((run) => run.result)).toEqual(["green", "green"]);
			const folders = foldersIn(ranIn);
			expect(folders).toHaveLength(2);
			expect(new Set(folders).size, "two lanes ran in one folder").toBe(2);
			for (const folder of folders)
				expect(existsSync(folder), `${folder} is still there`).toBe(false);
			expect(unpruned(made.home)).toBe("");
		});

		it("for one lane at the same head twice at once", {timeout: 60_000}, async () => {
			const made = newHome();
			const ranIn = join(dir, "ran-in");
			const runs = await Effect.runPromise(
				Effect.gen(function* () {
					const {base} = yield* (yield* LaneWork).tree(1);
					const checks = yield* CheckRunner;
					return yield* Effect.all([checks.run(base), checks.run(base)], {concurrency: 2});
				}).pipe(Effect.provide(laneWith(made, overlapping(ranIn)))),
			);
			expect(runs.map((run) => run.result)).toEqual(["green", "green"]);
			const folders = foldersIn(ranIn);
			expect(folders).toHaveLength(2);
			expect(new Set(folders).size, "two runs shared one folder").toBe(2);
		});
	});
});

// The format step runs in a git repository with the head's install, and its fix lands as a commit.
// On ticket 117 the format step "ended with 2": `oxlint-plugins/format.ts` ends with 2 when it cannot
// start oxfmt, which lives under `node_modules`. The exam's side tree is a worktree of the clone, so
// git is there, but nothing installs into it. This formatter stands for format.ts: it is reached
// through the install, and it asks git what a `.gitignore` hides before it formats, as lint.ts does.
describe("the exam's format step (tracker ticket 184)", () => {
	let dir: string;
	beforeEach(() => {
		dir = realpathSync(mkdtempSync(join(tmpdir(), "lane-checkout-fmt-")));
	});
	afterEach(() => rmSync(dir, {recursive: true, force: true}));

	const FORMATTER = [
		`#!${process.execPath}`,
		'import {execFileSync} from "node:child_process";',
		'import {readFileSync, writeFileSync} from "node:fs";',
		'execFileSync("git", ["ls-files", "-ci", "--exclude-per-directory=.gitignore"]);',
		"for (const file of process.argv.slice(2))",
		'\twriteFileSync(file, readFileSync(file, "utf8").replace(/^(?: {2})+/gm, (s) => "\\t".repeat(s.length / 2)));',
		"",
	].join("\n");

	it("formats a rule file in a git repository, and commits the fix", async () => {
		const modules = join(dir, "modules");
		mkdirSync(join(modules, ".bin"), {recursive: true});
		writeFileSync(join(modules, ".bin", "fmt"), FORMATTER);
		chmodSync(join(modules, ".bin", "fmt"), 0o755);
		const made = makeLaneHome({dir, nodeModules: modules});
		appendFileSync(
			join(made.seed, ".fabrika", "fabrika.toml"),
			`\n[format]\nrun = ${JSON.stringify(["node_modules/.bin/fmt", "{files}"])}\n`,
		);
		git(made.seed, "add", "-A");
		git(made.seed, "commit", "--quiet", "-m", "name the formatter");
		git(made.seed, "push", "--quiet", "origin", "main");
		const work = laneWork.pipe(
			Layer.provide(
				Layer.succeed(LaneHome, {
					home: made.home,
					checkout: made.seed,
					briefs: "",
					person: "owner",
				}),
			),
		);
		const tickets = ticketsOnLedger({kind: "agent", id: "lane", for: "owner"});
		const all = Layer.mergeAll(work, tickets).pipe(
			Layer.provideMerge(Layer.fresh(memoryLedger().layer)),
		);
		const RULE = "docs/rules.md";
		const {written, after, text} = await Effect.runPromise(
			Effect.gen(function* () {
				const lane = yield* LaneWork;
				const side = yield* lane.side("exam-1");
				const written = yield* lane.commit(
					side.tree,
					[{path: RULE, text: "rules:\n  one\n"}],
					"rule changes for ticket 1",
				);
				const after = yield* formatAt(1, side.tree, [RULE], {
					what: "the rule changes",
					message: "format the rule changes for ticket 1",
				});
				return {written, after, text: yield* lane.show(after ?? written, RULE)};
			}).pipe(Effect.provide(all)),
		);
		expect(after, "the formatter's fix is a commit of its own").not.toBeNull();
		expect(after).not.toBe(written);
		expect(text).toBe("rules:\n\tone\n");
	});
});
