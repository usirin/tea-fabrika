import "./box.sh?raw";
import "./leakgrep.sh?raw";
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
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import fc from "fast-check";
import {afterAll, describe, expect, it} from "vitest";
import {leftIn, machine} from "./drive.ts";

// Today's tooling. The machine is pure and stepped by hand here; leftIn reads a real git box.
const options = {seed: 119120, numRuns: 300};
const ask = {
	lane: "l",
	step: "build" as const,
	agent: "codex" as const,
	model: "",
	session: "",
	ticket: "1",
	plan: "p",
	branch: "fabrikalfa/l",
	base: "b".repeat(40),
	root: "b".repeat(40),
	box: "l-build1",
	run: "r",
	prompt: "",
	report: "",
	events: "",
	err: "",
	minutes: 60,
};
const answer = fc.constantFrom(
	"answer: done laws: green",
	"answer: send tests a law looks wrong",
	"answer: send plan",
	"answer: ask which version",
	"answer: stuck no network",
	"no answer at all",
);
const left = fc.array(fc.constantFrom("10 uncommitted files", "2 commits off fabrikalfa/l"), {
	maxLength: 2,
});

/** The record command the machine ends on, stepping through the backup push when it asks one. */
const recorded = (report: string, commits: number, held: readonly string[]) => {
	const value = {
		head: commits > 0 ? "c".repeat(40) : ask.base,
		commits,
		unsigned: [],
		exam: [],
		leaks: [],
		left: held,
		plancheck: null,
		report,
		problem: null,
	};
	const [read, cmds] = machine.update.step_read_ok({phase: "reading", ask}, {
		type: "step_read_ok",
		value,
	} as never);
	if (read.phase !== "pushing") return {state: read, cmd: cmds[0] as {keep: boolean; why: string}};
	const [state, after] = machine.update.backup_push_ok(read, {
		type: "backup_push_ok",
		value: {ok: true, detail: ""},
	} as never);
	return {state, cmd: after[0] as {keep: boolean; why: string}};
};

describe("drive keeps a box that holds work, today's tooling", () => {
	// Plant: keep only a stuck box, as before. layers build2, 2026-11-09: a send back removed a box
	// with 10 uncommitted files (field note 2026-11-09-42).
	it("never removes a box with uncommitted or unpushed work, whatever the step answered", () => {
		fc.assert(
			fc.property(answer, fc.nat({max: 2}), left, (report, commits, held) => {
				const {state, cmd} = recorded(report, commits, held);
				expect(state.phase).toBe("recording");
				if (state.phase !== "recording") return;
				const stuck = state.outcome.kind === "stuck";
				expect(cmd.keep).toBe(stuck || held.length > 0);
				expect(state.kept).toBe(cmd.keep);
				// The outcome line's reason says what was kept.
				for (const what of held) expect(cmd.why).toContain(what);
				if (held.length === 0) expect(cmd.why).not.toContain("box kept");
			}),
			options,
		);
	});
});

describe("leftIn reads a real box, today's tooling", () => {
	const root = mkdtempSync(join(tmpdir(), "drive-left-"));
	afterAll(() => rmSync(root, {recursive: true, force: true}));
	const git = (box: string, ...args: string[]) =>
		spawnSync("git", ["-C", box, ...args], {encoding: "utf8"});
	const fresh = (name: string) => {
		const box = join(root, name);
		spawnSync("git", ["init", "-q", "-b", "fabrikalfa/l", box]);
		git(box, "config", "user.email", "t@example.com");
		git(box, "config", "user.name", "t");
		writeFileSync(join(box, "a.ts"), "1\n");
		git(box, "add", "a.ts");
		git(box, "commit", "-q", "-m", "base");
		return box;
	};

	// Plants: drop the status read; drop untracked files; drop commits on another branch.
	it("counts edited and untracked files, and commits the step's branch lacks", () => {
		const clean = fresh("clean");
		expect(leftIn(clean, "fabrikalfa/l")).toEqual([]);

		const dirty = fresh("dirty");
		writeFileSync(join(dirty, "a.ts"), "2\n");
		writeFileSync(join(dirty, "new.ts"), "3\n");
		expect(leftIn(dirty, "fabrikalfa/l")).toEqual(["2 uncommitted files"]);

		const off = fresh("off");
		git(off, "switch", "-q", "-c", "side");
		writeFileSync(join(off, "b.ts"), "4\n");
		git(off, "add", "b.ts");
		git(off, "commit", "-q", "-m", "side");
		expect(leftIn(off, "fabrikalfa/l")).toEqual(["1 commits off fabrikalfa/l"]);

		// A clone's own main, ahead of the step's branch but on its remote, is not the box's work.
		// themes build5, 2026-11-09: kept for "21 commits off" that were its local main.
		const cloned = join(root, "cloned");
		spawnSync("git", ["clone", "-q", "-b", "fabrikalfa/l", clean, cloned]);
		git(clean, "switch", "-q", "-c", "main");
		writeFileSync(join(clean, "m.ts"), "5\n");
		git(clean, "add", "m.ts");
		git(clean, "commit", "-q", "-m", "main moved");
		git(clean, "switch", "-q", "fabrikalfa/l");
		git(cloned, "fetch", "-q", "origin", "main:main");
		expect(leftIn(cloned, "fabrikalfa/l")).toEqual([]);

		// A branch the box does not have is a state drive cannot read, so the box stays.
		expect(leftIn(clean, "fabrikalfa/missing")).toEqual(["a git state drive could not read"]);
		expect(leftIn(join(root, "gone"), "fabrikalfa/l")).toEqual([]);
	});
});
