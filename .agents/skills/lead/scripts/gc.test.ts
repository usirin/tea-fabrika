import "./box.sh?raw";
import "./leakgrep.sh?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./drive.ts?raw";
// oxlint-disable-next-line fabrika/use-import-extensions -- Vitest reads this exact file as text through ?raw.
import "./agents.ts?raw";
import "./fieldrow.py?raw";
import "./runplan.sh?raw";
import "./env.sh?raw";
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
import {mkdtempSync, rmSync, statSync, utimesSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import fc from "fast-check";
import {afterAll, describe, expect, it} from "vitest";
import {
	backupsOf,
	deadFacts,
	decide,
	decideWorktree,
	dirtyIn,
	IDLE,
	lastTouched,
	type Seen,
	type SeenWorktree,
	STUCK,
} from "./gc.ts";

// Today's tooling. The decision is pure; the world (lsof, git, gh, botpush) is not run here.
const sha = fc.stringMatching(/^[0-9a-f]{40}$/);

const seen = fc.record({
	name: fc.stringMatching(/^[a-z][a-z0-9]{0,12}$/),
	git: fc.option(
		fc.record({
			head: fc.option(sha, {nil: null}),
			branch: fc.option(fc.stringMatching(/^(fabrikalfa|person)\/[a-z0-9-]{1,10}(-wip)?$/), {
				nil: null,
			}),
		}),
		{nil: null},
	),
	busy: fc.array(fc.nat(), {maxLength: 2}),
	idle: fc.integer({min: 0, max: 3 * STUCK}),
	stuck: fc.option(fc.integer({min: 0, max: 3 * STUCK}), {nil: null}),
	merged: fc.boolean(),
	onRemote: fc.boolean(),
	dirty: fc.option(fc.nat({max: 12}), {nil: null}),
}) satisfies fc.Arbitrary<Seen>;

const options = {seed: 119120, numRuns: 300};

describe("box gc, today's tooling", () => {
	// Plants: drop the busy check; drop the 2 h wait; drop the 24 h wait on a kept stuck box. Once its
	// lane merged a stuck box is not held: p12's 22 stuck boxes outlived PR 530 (field note 2026-11-09-254).
	it("never touches a box in use, touched in the last 2 h, or kept stuck under 24 h before its lane lands", () => {
		fc.assert(
			fc.property(seen, (s) => {
				const v = decide(s);
				const young =
					s.busy.length > 0 || s.idle < IDLE || (s.stuck !== null && s.stuck < STUCK && !s.merged);
				const mustKeep = young || s.git === null || s.git.head === null;
				expect(mustKeep && v._tag !== "keep", JSON.stringify(s)).toBe(false);
			}),
			options,
		);
	});

	// Plants: remove a box whose HEAD is on no remote and has no merged pull request.
	it("removes outright only what a merged pull request or a remote branch already holds", () => {
		fc.assert(
			fc.property(seen, (s) => {
				const v = decide(s);
				const held = s.merged || s.onRemote;
				expect(v._tag === "remove" && !held).toBe(false);
				expect(v._tag === "backup" && (held || v.to.length === 0)).toBe(false);
			}),
			options,
		);
	});

	// Plants: keep an idle box forever; skip the backup of unpushed work.
	it("an idle box with a HEAD is always removed or backed up, never kept", () => {
		fc.assert(
			fc.property(seen, sha, (s, head) => {
				const idle = {...s, git: {head, branch: s.git?.branch ?? null}, busy: [], dirty: 0};
				const v = decide({...idle, idle: IDLE + s.idle, stuck: s.stuck === null ? null : STUCK});
				expect(v._tag === "remove" || v._tag === "backup").toBe(true);
			}),
			options,
		);
	});

	// Plants: back up or remove a box with uncommitted files, or one git could not read. A backup
	// pushes HEAD only (field note 2026-11-09-42: a box went with 10 uncommitted product files).
	it("never removes or backs up a box holding uncommitted files, or one it could not read", () => {
		fc.assert(
			fc.property(
				seen,
				sha,
				fc.option(fc.integer({min: 1, max: 12}), {nil: null}),
				(s, head, dirty) => {
					const idle = {...s, git: {head, branch: s.git?.branch ?? null}, busy: []};
					const v = decide({...idle, idle: IDLE + s.idle, stuck: null, dirty});
					expect(v._tag).toBe("keep");
				},
			),
			options,
		);
	});

	// Plants: back up to a branch the bot may not push; drop the -wip; double the -wip.
	it("backups go to a fabrikalfa/ -wip branch, the box's own branch first", () => {
		fc.assert(
			fc.property(seen, ({name, git}) => {
				const to = backupsOf(name, git?.branch ?? null);
				for (const b of to) expect(b).toMatch(/^fabrikalfa\/.+(?<!-wip)-wip$/);
				expect(to.at(-1)).toBe(`fabrikalfa/${name}-wip`);
				expect(new Set(to).size).toBe(to.length);
				const base = git?.branch?.replace(/(-wip)+$/, "");
				if (base?.startsWith("fabrikalfa/")) expect(to[0]).toBe(`${base}-wip`);
			}),
			options,
		);
	});

	// Plants: keep a dead box's facts; remove a live box's; remove a file that is not a box's facts.
	// themes tests, 2026-11-09: a stale themes-tests3.box was read by stepcommit after its box went.
	it("removes exactly the state/*.box files whose box folder is gone", () => {
		const name = fc.stringMatching(/^[a-z][a-z0-9-]{0,10}$/);
		fc.assert(
			fc.property(fc.uniqueArray(name), fc.uniqueArray(name), (facts, dirs) => {
				const files = [...facts.map((f) => `${f}.box`), ...facts.map((f) => `${f}.rows.jsonl`)];
				const live = new Set(dirs);
				const dead = deadFacts(files, live);
				expect(dead.sort()).toEqual(
					facts
						.filter((f) => !live.has(f))
						.map((f) => `${f}.box`)
						.sort(),
				);
			}),
			options,
		);
	});
});

const prState = fc.constantFrom("OPEN" as const, "MERGED" as const, "CLOSED" as const);

const worktree = fc.record({
	branch: fc.option(fc.stringMatching(/^(fabrikalfa|person)\/[a-z0-9-]{1,10}(-wip)?$/), {
		nil: null,
	}),
	locked: fc.boolean(),
	busy: fc.array(fc.nat(), {maxLength: 2}),
	idle: fc.integer({min: 0, max: 3 * STUCK}),
	dirty: fc.option(fc.nat({max: 12}), {nil: null}),
	prs: fc.array(prState, {maxLength: 3}),
}) satisfies fc.Arbitrary<SeenWorktree>;

describe("worktree gc, today's tooling", () => {
	// Plants: drop the lock, busy, 2 h, branch or dirty check; remove under an open pull request.
	it("removes a worktree only when it is clean, idle, unlocked and its lane landed", () => {
		fc.assert(
			fc.property(worktree, (w) => {
				const v = decideWorktree(w);
				const free =
					!w.locked && w.busy.length === 0 && w.idle >= IDLE && w.branch !== null && w.dirty === 0;
				const landed = !w.prs.includes("OPEN") && w.prs.length > 0;
				expect(v._tag === "remove", JSON.stringify(w)).toBe(free && landed);
				expect(v._tag).not.toBe("backup");
			}),
			options,
		);
	});
});

describe("dirtyIn reads a real box, today's tooling", () => {
	const root = mkdtempSync(join(tmpdir(), "gc-dirty-"));
	afterAll(() => rmSync(root, {recursive: true, force: true}));
	// Plants: drop the status read; drop untracked files; count a clean box as dirty.
	it("counts edited and untracked files in a box with separate git data", () => {
		const box = join(root, "box");
		const data = join(root, "box-gitdata");
		spawnSync("git", ["init", "-q", `--separate-git-dir=${data}`, box]);
		const git = (...args: string[]) => spawnSync("git", ["-C", box, ...args], {encoding: "utf8"});
		git("config", "user.email", "t@example.com");
		git("config", "user.name", "t");
		writeFileSync(join(box, "a.ts"), "1\n");
		git("add", "a.ts");
		git("commit", "-q", "-m", "base");
		expect(dirtyIn(data, box)).toBe(0);
		writeFileSync(join(box, "a.ts"), "2\n");
		writeFileSync(join(box, "new.ts"), "3\n");
		expect(dirtyIn(data, box)).toBe(2);
		expect(dirtyIn(join(root, "missing"), box)).toBeNull();
	});

	// Plants: measure from the git data folder, which every git command's lock files touch; let
	// git status refresh the index. Before this law, gc's own status reset every box's idle age, so
	// no box was ever 2 h idle (field note 2026-11-09-254).
	it("a gc read of a box does not change when the box was last touched", () => {
		const box = join(root, "quiet");
		const data = join(root, "quiet-gitdata");
		spawnSync("git", ["init", "-q", `--separate-git-dir=${data}`, box]);
		const old = new Date(Date.now() - 3 * 3_600_000);
		// The HEAD log stamps each entry with the committer's time.
		const env = {...process.env, GIT_COMMITTER_DATE: old.toISOString()};
		const git = (...args: string[]) =>
			spawnSync("git", ["-C", box, ...args], {encoding: "utf8", env});
		git("config", "user.email", "t@example.com");
		git("config", "user.name", "t");
		writeFileSync(join(box, "a.ts"), "1\n");
		git("add", "a.ts");
		git("commit", "-q", "-m", "base");
		// Three hours ago, then a stat change with no content change: plain git status rewrites the
		// index for that, and makes index.lock in the git data folder.
		for (const p of [join(box, "a.ts"), join(data, "index"), join(data, "logs", "HEAD"), data, box])
			utimesSync(p, old, old);
		utimesSync(join(box, "a.ts"), new Date(), new Date());
		utimesSync(box, old, old);
		const before = lastTouched(box, data);
		expect(dirtyIn(data, box)).toBe(0);
		expect(dirtyIn(data, box)).toBe(0);
		expect(lastTouched(box, data)).toBe(before);
		expect(Date.now() - before).toBeGreaterThanOrEqual(IDLE);
		expect(statSync(join(data, "index")).mtimeMs).toBe(old.getTime());
		// git gc's reflog expiry rewrites the HEAD log: its file time is not work in the box.
		utimesSync(join(data, "logs", "HEAD"), new Date(), new Date());
		expect(lastTouched(box, data)).toBe(before);
	});
});
