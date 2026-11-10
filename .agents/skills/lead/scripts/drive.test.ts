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
import {nameOf} from "@kampus/pipeline/stages/outcome";
import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {NO_SPENT} from "./agents.ts";
import {
	agentTail,
	changesOf,
	commitsSaid,
	decide,
	endName,
	freshBox,
	holdsElectron,
	machine,
	reportOf,
	rowOf,
	startedOf,
} from "./drive.ts";

// Today's tooling. The machine is pure and stepped by hand here; nothing runs an agent.
const options = {seed: 119120, numRuns: 300};

const ask = {
	lane: "l",
	step: "build" as const,
	agent: "codex" as const,
	model: "gpt-6-astra",
	effort: "medium",
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
	started: 0,
};

const answer = fc.constantFrom(
	"answer: done laws: green",
	"answer: send tests a law looks wrong",
	"answer: send plan",
	"answer: ask which version",
	"answer: skip no product file changed",
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
		manifests: [],
		plancheck: null,
		changed: 0,
		report,
		problem: null,
	};
	const [read, cmds] = machine.update.step_read_ok(
		{phase: "reading", ask, answer: null, spent: NO_SPENT},
		{
			type: "step_read_ok",
			value,
		} as never,
	);
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

describe("drive takes a skip answer, today's tooling", () => {
	const why = fc.stringMatching(/^[a-z][a-z ]{0,30}[a-z]$/);
	const steps = fc.constantFrom("tests", "build", "mutation", "review") as fc.Arbitrary<
		"tests" | "build" | "mutation" | "review"
	>;
	const read = (step: "tests" | "build" | "mutation" | "review", report: string) =>
		machine.update.step_read_ok({phase: "reading", ask: {...ask, step}}, {
			type: "step_read_ok",
			value: {
				head: ask.base,
				commits: 0,
				unsigned: [],
				exam: [],
				leaks: [],
				left: [],
				manifests: [],
				plancheck: null,
				changed: 0,
				report,
				problem: null,
			},
		} as never);

	// Plant: drop skip from the answer line, so it reads as no_answer and is stuck (t374 mutation1,
	// 2026-11-09: "answer: skip no product file changed" was recorded as stuck:no_answer).
	it("a skip answer is a skip outcome with exit 40 and the step's why, and the box goes", () => {
		fc.assert(
			fc.property(steps, why, fc.constantFrom("", "`", "**"), (step, text, wrap) => {
				const [s, cmds] = read(step, `report body\n\n${wrap}answer: skip ${text}${wrap}`);
				expect(s.phase).toBe("recording");
				if (s.phase !== "recording") return;
				expect(s.outcome).toEqual({kind: "skip", why: "step_said"});
				expect(s.why).toBe(text);
				expect(s.kept).toBe(false);
				const cmd = cmds[0] as {outcome: string; exit: number; keep: boolean};
				expect(cmd.outcome).toBe("skip:step_said");
				expect(cmd.exit).toBe(40);
				expect(cmd.keep).toBe(false);
			}),
			options,
		);
	});

	// Plant: map skip to stopped, so box.sh's review order check refuses a skipped mutation step.
	it("a skip's field row says skip, and no other outcome's does", () => {
		const names = [
			"done",
			"send:tests:exam_paths",
			"send:build:step_said",
			"ask:lead:question",
			"skip:step_said",
			"stuck:no_answer",
			"stuck:record_failed",
		];
		for (const name of names) {
			const want = {done: "pass", send: "fail", ask: "parked", skip: "skip"}[
				name.split(":")[0] as "done"
			];
			expect(rowOf(name)).toBe(want ?? "stopped");
		}
		expect(names.filter((n) => rowOf(n) === "skip")).toEqual(["skip:step_said"]);
	});

	// Plant: give skip the stuck code. Each verb keeps an exit code of its own.
	it("each answer verb gets its own exit code", () => {
		const exits = new Map<string, number>();
		for (const line of [
			"answer: done",
			"answer: send tests x",
			"answer: send build x",
			"answer: send plan x",
			"answer: ask x",
			"answer: skip x",
			"answer: stuck x",
		]) {
			const [, cmds] = read("review", line);
			exits.set(line, (cmds[0] as {exit: number}).exit);
		}
		expect(new Set(exits.values()).size).toBe(exits.size);
		expect(exits.get("answer: skip x")).toBe(40);
		expect(exits.get("answer: stuck x")).toBe(30);
	});
});

describe("T428 a start check's no is a refusal, not a stuck step, today's tooling", () => {
	const checks = [
		"plan_unapproved",
		"base_not_signed",
		"shared_ticket",
		"root_not_ancestor",
	] as const;
	const check = fc.constantFrom(...checks);
	const detail = fc.stringMatching(/^[a-z0-9](?:[a-z0-9 /|.-]{0,40}[a-z0-9])?$/);
	const noise = fc.array(fc.stringMatching(/^[a-z ]{0,20}$/), {maxLength: 3});
	const boxNewOk = (value: ReturnType<typeof startedOf>) =>
		machine.update.box_new_ok({phase: "starting", ask: {...ask, step: "tests"}}, {
			type: "box_new_ok",
			value,
		} as never);

	// Plants: read any non-zero exit as a refusal; take a check name box.sh never prints; drop the
	// detail. 28 of 72 stuck results on 2026-11-09 were box.sh new saying no before any agent ran.
	it("box.sh new's exit 3 with a refused line names the check; any other failure is the box failing", () => {
		fc.assert(
			fc.property(check, detail, noise, fc.constantFrom(0, 1, 2, 3, 127), (c, d, before, code) => {
				const err = [...before, `refused ${c}: ${d}`, ""].join("\n");
				const got = startedOf(code, err);
				if (code === 0) expect(got).toEqual({_tag: "made"});
				else if (code === 3) expect(got).toEqual({_tag: "refused", check: c, detail: d});
				else expect(got._tag).toBe("failed");
				// A stuck line, or an unknown check, is never a refusal.
				expect(startedOf(3, `stuck ${c}: ${d}\n`)._tag).toBe("failed");
				expect(startedOf(3, `refused not_a_check_${c}: ${d}\n`)._tag).toBe("failed");
			}),
			options,
		);
	});

	// Plants: record a refusal as stuck:box_failed, give it the stuck exit, keep its box, or let it
	// move the lane's head. The stuck rate then counts steps no agent ran.
	it("a refusal ends at once as refused:<check>, exit 3, nothing kept, and never reads as stuck", () => {
		fc.assert(
			fc.property(check, detail, (c, d) => {
				const [state, cmds] = boxNewOk({_tag: "refused", check: c, detail: d});
				expect(state.phase).toBe("recording");
				const cmd = cmds[0] as {outcome: string; exit: number; keep: boolean; why: string};
				expect(cmd.outcome).toBe(`refused:${c}`);
				expect(cmd.outcome.startsWith("stuck")).toBe(false);
				expect(cmd.exit).toBe(3);
				expect(cmd.keep).toBe(false);
				expect(cmd.why).toBe(d);
				expect(rowOf(cmd.outcome)).not.toBe("pass");
			}),
			options,
		);
	});

	// Plant: let a refusal swallow a real box failure (a clone or install that broke).
	it("a box that failed to start is still stuck:box_failed and kept for the lead", () => {
		fc.assert(
			fc.property(detail, (d) => {
				const [, cmds] = boxNewOk({_tag: "failed", detail: d});
				const cmd = cmds[0] as {outcome: string; exit: number; keep: boolean};
				expect(cmd.outcome).toBe("stuck:box_failed");
				expect(cmd.exit).toBe(30);
				expect(cmd.keep).toBe(true);
			}),
			options,
		);
	});

	// Plant: give drive's own refusals and box.sh's checks names that clash with a step outcome.
	it("format: every refusal prints as refused:<check>, apart from the five step verbs", () => {
		for (const c of [...checks, "agent_cap", "low_disk", "branch_checked_out"] as const) {
			const name = endName({kind: "refused", check: c});
			expect(name).toBe(`refused:${c}`);
			expect(name.split(":")[0]).not.toMatch(/^(done|send|ask|skip|stuck)$/);
		}
	});
});

describe("T429 drive names the commits check's rule and commit, today's tooling", () => {
	const rule = fc.constantFrom(
		"unsigned_commit",
		"build_touched_exam",
		"broken_chain",
		"stale_link",
	);
	const answer = fc.record({
		why: rule,
		sha: fc.stringMatching(/^[0-9a-f]{40}$/),
		step: fc.option(fc.constantFrom("tests", "build", "lead"), {nil: undefined}),
	});
	const lane = new Set(["tests", "build"]);
	const held = (a: {why: string; step?: string}) =>
		!(a.why === "stale_link" && !(a.step !== undefined && lane.has(a.step)));

	// Plants: print only the last lines of JSON; drop the commit; name a waived stale link.
	it("each held answer is named as rule, commit and step, and a waived stale link is not", () => {
		fc.assert(
			fc.property(fc.array(answer, {minLength: 1, maxLength: 7}), (answers) => {
				const out = answers.map((a) => JSON.stringify({_tag: "stuck", ...a})).join("\n");
				const said = commitsSaid({code: 1, out, err: "commits: stuck ..."}, lane);
				const named = answers
					.filter(held)
					.map((a) => `${a.why} ${a.sha.slice(0, 8)}${a.step ? ` step ${a.step}` : ""}`);
				if (named.length === 0) {
					expect(said).toMatch(/^commits check exit 1: /);
					return;
				}
				const more = named.length > 5 ? `; and ${named.length - 5} more` : "";
				expect(said).toBe(`commits check: ${named.slice(0, 5).join("; ")}${more}`);
			}),
			options,
		);
	});
});

describe("drive asks the lead for the lockfile, today's tooling", () => {
	const read = (report: string, manifests: readonly string[]) =>
		machine.update.step_read_ok({phase: "reading", ask, answer: null, spent: NO_SPENT}, {
			type: "step_read_ok",
			value: {
				head: "c".repeat(40),
				commits: 1,
				unsigned: [],
				exam: [],
				leaks: [],
				left: [],
				manifests,
				plancheck: null,
				changed: 0,
				report,
				problem: null,
			},
		} as never)[0];
	const manifest = fc.constantFrom(
		"package.json",
		"apps/fabrika/package.json",
		"pnpm-workspace.yaml",
	);

	// Plant: trust the step's own answer. themes build2 (ticket 385): a box could not refresh the
	// lockfile, answered send tests, and the lane looped build -> tests -> build.
	it("a lockfile left behind is an ask for the lead, whatever the step answered, and names each manifest", () => {
		fc.assert(
			fc.property(answer, fc.uniqueArray(manifest, {minLength: 1}), (report, paths) => {
				const s = read(report, paths);
				expect(s.phase).toBe("pushing");
				if (s.phase !== "pushing") return;
				expect(s.outcome).toEqual({kind: "ask", who: "lead", for: "lockfile"});
				for (const p of paths) expect(s.why).toContain(p);
				expect(s.why).toContain("fabrikalfa/l-wip");
			}),
			options,
		);
	});

	// Plant: ask on every step. With nothing behind, the step's own answer decides as before.
	it("with no manifest behind, no answer becomes a lockfile ask", () => {
		fc.assert(
			fc.property(answer, (report) => {
				const s = read(report, []);
				expect(["pushing", "recording"]).toContain(s.phase);
				const outcome = s.phase === "pushing" || s.phase === "recording" ? s.outcome : null;
				expect(outcome).not.toEqual({kind: "ask", who: "lead", for: "lockfile"});
			}),
			options,
		);
	});
});

describe("the box's changes are read from its status, today's tooling", () => {
	it("each NUL-ended status entry is one file with its letters, so a deleted one is told apart", () => {
		const out = " M a.ts\0?? b/c.ts\0 D gone.ts\0";
		expect(changesOf(out)).toEqual([
			{xy: " M", path: "a.ts"},
			{xy: "??", path: "b/c.ts"},
			{xy: " D", path: "gone.ts"},
		]);
		expect(changesOf("")).toEqual([]);
	});

	it("a review that left a changed file is stuck:review_committed, whatever it answered", () => {
		fc.assert(
			fc.property(answer, fc.integer({min: 1, max: 9}), (report, changed) => {
				const read = {
					head: ask.base,
					commits: 0,
					unsigned: [],
					exam: [],
					leaks: [],
					left: [],
					manifests: [],
					plancheck: null,
					changed,
					report,
					problem: null,
				};
				const j = decide({...ask, step: "review"}, read);
				expect(j.outcome).toEqual({kind: "stuck", why: "review_committed"});
			}),
			options,
		);
	});

	it("the typed answer wins over the report's answer line, and a build with no commit needs its laws", () => {
		const read = {
			head: ask.base,
			commits: 0,
			unsigned: [],
			exam: [],
			leaks: [],
			left: [],
			manifests: [],
			plancheck: null,
			changed: 0,
			report: "answer: stuck no network",
			problem: null,
		};
		expect(decide(ask, read, {verb: "done", to: null, why: "", laws: null}).outcome).toEqual({
			kind: "stuck",
			why: "no_commit",
		});
		expect(decide(ask, read, {verb: "done", to: null, why: "", laws: "a.test.ts"}).outcome).toEqual(
			{kind: "done", part: false, head: ask.base},
		);
		expect(decide(ask, read, {verb: "send", to: "tests", why: "a law", laws: null})).toEqual({
			outcome: {kind: "send", to: "tests", why: "step_said"},
			why: "a law",
		});
		expect(decide(ask, read).outcome).toEqual({kind: "stuck", why: "step_said"});
	});
});

describe("T383 drive never passes off an older run's report, today's tooling", () => {
	const suffixes = [
		"",
		"-gitdata",
		"-prompt.md",
		".md",
		".jsonl",
		".err",
		".log",
		"-plan.md",
		"-plan.jsonl",
	];
	// Plants: check only the box folder and prompt, as before; skip a free number; start below n.
	// p12 review5, 2026-11-09: box.sh refused the run, and drive returned p12-review5.md from
	// 2026-11-08, written for another head, as the step's report (field note 2026-11-09-205).
	it("picks the first box number from n up that no older file holds", () => {
		const left = fc.array(fc.tuple(fc.integer({min: 1, max: 6}), fc.constantFrom(...suffixes)));
		fc.assert(
			fc.property(
				fc.constantFrom("plan", "review", "build"),
				fc.integer({min: 1, max: 4}),
				left,
				(step, n, files) => {
					const taken = new Set(files.map(([i, suffix]) => `p12-${step}${i}${suffix}`));
					const box = freshBox("p12", step, n, (name) => taken.has(name));
					const i = Number(box.slice(`p12-${step}`.length));
					expect(box).toBe(`p12-${step}${i}`);
					expect(i).toBeGreaterThanOrEqual(n);
					for (const suffix of suffixes) expect(taken.has(`${box}${suffix}`)).toBe(false);
					for (let j = n; j < i; j += 1)
						expect(suffixes.some((suffix) => taken.has(`p12-${step}${j}${suffix}`))).toBe(true);
				},
			),
			options,
		);
	});

	// Plants: return the path whenever the file exists; compare to the ms without the whole second.
	it("gives a report only when this run wrote it, never one from before its start", () => {
		const started = fc.integer({min: 1_000_000, max: 2_000_000_000_000});
		const mtime = fc.option(fc.integer({min: -10_000_000, max: 10_000_000}), {nil: null});
		fc.assert(
			fc.property(started, mtime, (at, offset) => {
				const written = offset === null ? null : at + offset;
				const got = reportOf("r.md", at, written);
				const second = Math.floor(at / 1000) * 1000;
				expect(got).toBe(written !== null && written >= second ? "r.md" : null);
				if (written !== null && written >= at) expect(got).toBe("r.md");
				if (written !== null && written < second) expect(got).toBeNull();
			}),
			options,
		);
	});
});

describe("T388 drive accepts a step once its backup push lands, today's tooling", () => {
	// Plants: a landed push still recorded stuck; the head left at the base; a refused push accepted.
	// ci375 build, 2026-11-09: a signed, green build came back stuck:push_failed on a notes race
	// that botpush now retries once, so the push result alone decides the step.
	it("records the step's own answer at the pushed head, and stuck:push_failed when refused", () => {
		fc.assert(
			fc.property(answer, fc.integer({min: 1, max: 3}), fc.boolean(), (report, commits, landed) => {
				const value = {
					head: "c".repeat(40),
					commits,
					unsigned: [],
					exam: [],
					leaks: [],
					left: [],
					manifests: [],
					plancheck: null,
					changed: 0,
					report,
					problem: null,
				};
				const [read] = machine.update.step_read_ok(
					{phase: "reading", ask, answer: null, spent: NO_SPENT},
					{
						type: "step_read_ok",
						value,
					} as never,
				);
				// A stuck answer is never pushed.
				if (read.phase !== "pushing") {
					expect(read.phase === "recording" && read.outcome.kind).toBe("stuck");
					return;
				}
				const [state, cmds] = machine.update.backup_push_ok(read, {
					type: "backup_push_ok",
					value: {ok: landed, detail: landed ? "pushed" : "botpush: push refused"},
				} as never);
				const cmd = cmds[0] as {outcome: string; head: string};
				expect(state.phase).toBe("recording");
				expect(cmd.head).toBe(value.head);
				if (landed) expect(cmd.outcome).toBe(nameOf(read.outcome));
				else expect(cmd.outcome).toBe("stuck:push_failed");
			}),
			options,
		);
	});
});

describe("drive holds the Electron lock outside the box, today's tooling", () => {
	const steps = fc.constantFrom("plan", "tests", "build", "mutation", "review") as fc.Arbitrary<
		"plan" | "tests" | "build" | "mutation" | "review"
	>;

	it("holds it for mutation always, and for any other step only when started with --electron", () => {
		fc.assert(
			fc.property(steps, fc.boolean(), (step, flagged) => {
				expect(holdsElectron(step, flagged)).toBe(step === "mutation" || flagged);
			}),
			options,
		);
	});

	it("tells the agent the lock is held exactly when drive holds it", () => {
		fc.assert(
			fc.property(steps, fc.boolean(), (step, flagged) => {
				const told = agentTail({step, ticket: "1"}, flagged).includes("state/electron.lock");
				expect(told).toBe(holdsElectron(step, flagged));
			}),
			options,
		);
	});

	it("scenario: --electron on a Codex box is refused before anything starts", () => {
		const dir = mkdtempSync(join(tmpdir(), "drive-electron-"));
		const brief = join(dir, "brief.md");
		writeFileSync(brief, "brief");
		const r = spawnSync(
			process.execPath,
			[join(import.meta.dirname, "drive.ts"), "l", "build", brief, "--electron"],
			{encoding: "utf8", env: {...process.env, BOXES: join(dir, "boxes")}},
		);
		rmSync(dir, {recursive: true, force: true});
		expect(r.status).toBe(2);
		expect(r.stderr).toContain("--electron is for --agent claude");
	});
});
