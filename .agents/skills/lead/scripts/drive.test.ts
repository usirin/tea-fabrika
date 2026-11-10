import "./box.sh?raw";
import "./keepruns.sh?raw";
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
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {Agent} from "@kampus/fabrika-old";
import {nameOf} from "@kampus/pipeline/stages/outcome";
import {Effect, Stream} from "effect";
import fc from "fast-check";
import {describe, expect, it} from "vitest";
import {NO_SPENT} from "./agents.ts";
import {
	agentsDraft,
	agentTail,
	boxChanges,
	changedFiles,
	commitSubject,
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

	if (read.phase !== "pushing") {
		return {state: read, cmd: cmds[0] as {keep: boolean; why: string}};
	}

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

				if (state.phase !== "recording") {
					return;
				}

				const stuck = state.outcome.kind === "stuck";
				expect(cmd.keep).toBe(stuck || held.length > 0);
				expect(state.kept).toBe(cmd.keep);

				// The outcome line's reason says what was kept.
				for (const what of held) {
					expect(cmd.why).toContain(what);
				}

				if (held.length === 0) {
					expect(cmd.why).not.toContain("box kept");
				}
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
		machine.update.step_read_ok(
			{phase: "reading", ask: {...ask, step}, answer: null, spent: NO_SPENT},
			{
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
			} as never,
		);

	// Plant: drop skip from the answer line, so it reads as no_answer and is stuck (t374 mutation1,
	// 2026-11-09: "answer: skip no product file changed" was recorded as stuck:no_answer).
	it("a skip answer is a skip outcome with exit 40 and the step's why, and the box goes", () => {
		fc.assert(
			fc.property(steps, why, fc.constantFrom("", "`", "**"), (step, text, wrap) => {
				const [s, cmds] = read(step, `report body\n\n${wrap}answer: skip ${text}${wrap}`);
				expect(s.phase).toBe("recording");

				if (s.phase !== "recording") {
					return;
				}

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

				if (code === 0) {
					expect(got).toEqual({_tag: "made"});
				} else if (code === 3) {
					expect(got).toEqual({_tag: "refused", check: c, detail: d});
				} else {
					expect(got._tag).toBe("failed");
				}

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
	const held = (a: {why: string; step: string | undefined}) =>
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

				if (s.phase !== "pushing") {
					return;
				}

				expect(s.outcome).toEqual({kind: "ask", who: "lead", for: "lockfile"});

				for (const p of paths) {
					expect(s.why).toContain(p);
				}

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
		expect(changedFiles(out)).toEqual([
			{xy: " M", path: "a.ts"},
			{xy: "??", path: "b/c.ts"},
			{xy: " D", path: "gone.ts"},
		]);
		expect(changedFiles("")).toEqual([]);
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

describe("T341 a step commit's subject says what the step did, today's tooling", () => {
	const text = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ,.]{0,100}[a-z]$/);
	const step = fc.constantFrom("tests", "build", "mutation") as fc.Arbitrary<
		"tests" | "build" | "mutation"
	>;

	// The dry run of 2026-11-10 (ticket 522): a report that was the JSON answer alone gave the
	// subject "the step's work", which says nothing in the log.
	// Plants: skip the answer's why; take the JSON line as the subject; let the subject run long.
	it("is the report's first prose line, else the answer's why, on one line that names the ticket and step", () => {
		fc.assert(
			fc.property(text, text, step, fc.boolean(), (prose, why, s, alone) => {
				const answer = JSON.stringify({verb: "done", to: null, why, laws: null});
				const subject = commitSubject(
					{ticket: "7", step: s},
					alone ? `${answer}\n` : `\n## ${prose}\n\nmore\n${answer}\n`,
				);
				expect(subject).toBe(`T7 ${s}: ${(alone ? why : prose).slice(0, 72)}`);
				expect(subject).not.toContain("\n");
				expect(subject).not.toContain("{");
			}),
			options,
		);
	});

	it("pinned: a report with no prose and no answer still gets a subject", () => {
		// pinned: an agent that ended with nothing to say (the turn's report is empty).
		expect(commitSubject({ticket: "7", step: "build"}, "")).toBe("T7 build: the step's work");
	});
});

describe("T341 drive reads what a box holds from outside it, today's tooling", () => {
	const root = mkdtempSync(join(tmpdir(), "drive-box-"));
	const env = {BOXES: root};
	const git = (...args: string[]) =>
		spawnSync(
			"git",
			[
				`--git-dir=${join(root, "b-gitdata")}`,
				`--work-tree=${join(root, "b")}`,
				"-c",
				"user.email=t@example.com",
				"-c",
				"user.name=t",
				...args,
			],
			{encoding: "utf8"},
		);

	// scenario: a real box with its git data beside it, as box.sh new makes one. The agent cannot
	// commit any more, so the files it left are all the work a box holds, and each must be named for
	// collect to copy it. It takes over from the removed "counts edited and untracked files, and
	// commits the step's branch lacks", which read a real box the same way.
	// Plants: drop --untracked-files=all; read through the box's own `.git` file; call a box whose
	// data is gone a box with no changes.
	it("scenario: every edited, deleted and new file is named, a new folder file by file, whatever the box's `.git` file says", () => {
		const box = join(root, "b");
		spawnSync("git", ["init", "-q", "--separate-git-dir", join(root, "b-gitdata"), box]);
		writeFileSync(join(box, "a.ts"), "1\n");
		writeFileSync(join(box, "gone.ts"), "1\n");
		git("add", "a.ts", "gone.ts");
		git("commit", "-q", "-m", "base");
		expect(boxChanges(env, "b")).toMatchObject({code: 0, changes: []});

		writeFileSync(join(box, "a.ts"), "2\n");
		rmSync(join(box, "gone.ts"));
		mkdirSync(join(box, "new", "deep"), {recursive: true});
		writeFileSync(join(box, "new", "deep", "c.ts"), "3\n");
		writeFileSync(join(box, "new", "d.ts"), "4\n");
		// The agent can rewrite this file; drive reads the data folder by name and never follows it.
		writeFileSync(join(box, ".git"), `gitdir: ${join(root, "nowhere")}\n`);
		const read = boxChanges(env, "b");
		expect(read.code).toBe(0);
		expect(read.changes.toSorted((x, y) => x.path.localeCompare(y.path))).toEqual([
			{xy: " M", path: "a.ts"},
			{xy: " D", path: "gone.ts"},
			{xy: "??", path: "new/d.ts"},
			{xy: "??", path: "new/deep/c.ts"},
		]);

		// A box whose data cannot be read is a failed read, which drive keeps as stuck.
		const lost = boxChanges(env, "no-such-box");
		expect(lost.code).not.toBe(0);
		expect(lost.changes).toEqual([]);
		rmSync(root, {recursive: true, force: true});
	});
});

describe("T341 a step's agent runs in its own box, on the row its step allows, today's tooling", () => {
	const dir = mkdtempSync(join(tmpdir(), "drive-row-"));
	const env = {
		MAIN: join(dir, "main"),
		BOXES: join(dir, "boxes"),
		GH_REPO: "",
		CODEX_MODEL: "",
		CODEX_EFFORT: "",
	};
	const prompt = join(dir, "prompt.md");
	writeFileSync(prompt, "do the step");
	const steps = fc.constantFrom("plan", "tests", "build", "mutation", "review") as fc.Arbitrary<
		"plan" | "tests" | "build" | "mutation" | "review"
	>;
	const agent = fc.constantFrom("codex", "claude") as fc.Arbitrary<"codex" | "claude">;
	const lane = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,20}$/);
	const drafted = (
		step: "plan" | "tests" | "build" | "mutation" | "review",
		who: "codex" | "claude",
		box: string,
	) =>
		Effect.gen(function* () {
			const rows = {
				codex: Agent.fakeAdapter(() => Agent.saying("done")),
				"codex-read": Agent.fakeAdapter(() => Agent.saying("done")),
				claude: Agent.fakeAdapter(() => Agent.saying("done")),
			};
			const agents = Agent.makeAgents({
				adapters: rows,
				sessions: Agent.memorySessions(),
				reaper: Agent.noReaper,
			});
			const sub = {
				deps: {
					...ask,
					step,
					agent: who,
					box,
					prompt,
					events: join(dir, "events.jsonl"),
					report: join(dir, "report.md"),
				},
			};
			yield* Stream.runDrain(agentsDraft(env, agents)(sub as never));
			return rows;
		});

	// The harness closes everything beside the folder a turn names (packages/fabrika/src/agents/acp/
	// harness.test.ts, "the folder's siblings closed"), so the folder drive names is what keeps an
	// agent out of BOXES/state, the lock, the step keys and the other boxes. These take over from the
	// removed "never lets the box write the lock or anything else in BOXES/state" and "pinned: the
	// profile allows writes only to the box, its git data and the caches", which read drive's own
	// sandbox profile; drive has none now.
	// Plants: run every step in BOXES; run a plan in a box; run a review on the row that writes.
	it("a plan reads the main checkout and every other step works in its own box, never in a folder above it", () =>
		fc.assert(
			fc.asyncProperty(steps, agent, lane, fc.integer({min: 1, max: 99}), (step, who, name, n) =>
				drafted(step, who, `${name}-${step}${n}`).pipe(
					Effect.tap((rows) =>
						Effect.sync(() => {
							const started = Object.values(rows).flatMap((row) => row.seen.started);
							expect(started.length).toBe(1);
							const folder = started[0]?.folder ?? "";
							expect(folder).toBe(
								step === "plan" ? env.MAIN : join(env.BOXES, `${name}-${step}${n}`),
							);
							expect(env.BOXES.startsWith(folder)).toBe(false);
							expect(folder.startsWith(join(env.BOXES, "state"))).toBe(false);
						}),
					),
					Effect.asVoid,
					Effect.runPromise,
				),
			),
			options,
		));

	it("on Codex a plan and a review start on the row that only reads, and a Claude step never starts on a Codex row", () =>
		fc.assert(
			fc.asyncProperty(steps, agent, lane, (step, who, name) =>
				drafted(step, who, `${name}-${step}1`).pipe(
					Effect.tap((rows) =>
						Effect.sync(() => {
							const count = (row: keyof typeof rows) => rows[row].seen.started.length;

							if (step === "plan" || step === "review") {
								expect(count("codex")).toBe(0);
							}

							expect(count("claude")).toBe(who === "claude" ? 1 : 0);
							expect(count("codex") + count("codex-read")).toBe(who === "codex" ? 1 : 0);
						}),
					),
					Effect.asVoid,
					Effect.runPromise,
				),
			),
			options,
		));
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

					for (const suffix of suffixes) {
						expect(taken.has(`${box}${suffix}`)).toBe(false);
					}

					for (let j = n; j < i; j += 1) {
						expect(suffixes.some((suffix) => taken.has(`p12-${step}${j}${suffix}`))).toBe(true);
					}
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

				if (written !== null && written >= at) {
					expect(got).toBe("r.md");
				}

				if (written !== null && written < second) {
					expect(got).toBeNull();
				}
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

				if (landed) {
					expect(cmd.outcome).toBe(nameOf(read.outcome));
				} else {
					expect(cmd.outcome).toBe("stuck:push_failed");
				}
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
