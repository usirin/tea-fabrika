import {Effect, Schema} from "effect";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {Inputs, keyOf} from "./key.ts";
import {
	YES,
	TIMED_OUT,
	keptAsLegacy,
	pushToMain,
	closeTicket,
	lane,
	onMain,
	codexRuns,
	WHOLE,
	remoteGit,
	heldAt,
	foldsAsSaved,
	secondLine,
	askedFor,
	holds,
	changedBy,
	roundsOf,
	moveMain,
	restartOf,
	headBefore,
	TOUCHED,
	REDONE_MARK,
	REDO,
	SEE,
} from "./lane-harness.ts";
import {PICKS} from "./machine.ts";

// A stopped lane, typed again: a rebase onto a moved main, a person's stop or no, and an exam file
// touched. The shared setup is in ./lane-harness.ts.

// Self-fix PR 5: a stopped lane goes on where it stopped when the same line is typed again. On the
// local host fixture, the lane stops, something happens while it waits, and the line is typed again.
// Today's version.

describe("a stopped lane, typed again", () => {
	beforeEach(() => {
		vi.stubEnv("TYPESAFE_API_KEY", "");
		vi.stubEnv("OPENAI_API_KEY", "");
		vi.stubEnv("CODEX_API_KEY", "");
	});
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("stuck at mutation while main moves one commit: it rebases, writes `restarted` with both bases, runs the checks, then mutation, and lands", async () => {
		const bases: string[] = [];
		const ran = await lane({
			within: 50,
			picks: YES,
			failMutation: true,
			fold: true,
			again: [
				{
					between: (where) =>
						Effect.sync(() => {
							bases.push(remoteGit(where.remote, "rev-parse", "main"));
							pushToMain(where, [{path: "docs/elsewhere.md", text: "Written elsewhere.\n"}]);
							bases.push(remoteGit(where.remote, "rev-parse", "main"));
						}),
				},
			],
		});
		const said = ran.lines.join("\n");
		expect(ran.lines, said).not.toContain(TIMED_OUT);
		expect(ran.names.mutation, said).toBeDefined();

		// The first line stopped at mutation, and saved its `Held` and where it goes on.
		expect(heldAt(ran, 0)?.at, said).toEqual({_tag: "run", step: "mutation"});
		foldsAsSaved(ran, 0);

		// The second line says it restarts, and from where. The ticket keeps one row with both bases.
		expect(secondLine(ran)).toMatch(/restart: #1 from mutation\b/);
		const [base, onto] = bases;
		// The head the lane goes on from: the rebased one, where the restart ran the checks.
		const at = ran.facts.findIndex((f) => f.type === "restarted");
		const to = ran.facts.slice(at).find((f) => f.type === "checked")?.head;
		expect(to, said).toMatch(/^[0-9a-f]{40}$/);
		expect(to).not.toBe(headBefore(ran));
		expect(ran.facts.filter((f) => f.type === "restarted")).toEqual([
			{
				type: "restarted",
				from: "mutation",
				base,
				onto,
				head: headBefore(ran),
				to,
				conflicts: [],
			},
		]);

		// No step that ended done runs again: each agent once, the plan's yes once.
		expect(codexRuns(ran.dir).map((r) => r.step)).toEqual([
			"triage",
			"plan",
			"tests",
			"build",
			"mutants",
			"review",
		]);
		expect(askedFor(ran, "approve")).toHaveLength(1);
		expect(ran.stages.filter((s) => s !== "mutation")).toEqual(
			WHOLE.filter((s) => s !== "mutation"),
		);
		expect(ran.stages.slice(ran.stages.lastIndexOf("mutation"))).toEqual([
			"mutation",
			"mutants",
			"review",
			"push",
			"merge",
		]);

		// After the rebase the head is new, so code's checks run there before mutation starts again.
		const restarted = ran.facts.findIndex((f) => f.type === "restarted");
		expect(restarted).toBeGreaterThan(-1);
		const checkedAgain = ran.facts.findIndex((f, i) => i > restarted && f.type === "checked");
		const mutationAgain = ran.facts.findIndex(
			(f, i) => i > restarted && f.type === "started" && f.stage === "mutation",
		);
		expect(checkedAgain).toBeGreaterThan(restarted);
		expect(mutationAgain).toBeGreaterThan(checkedAgain);
		const firstChecked = ran.facts.find((f) => f.type === "checked");
		expect(ran.facts[checkedAgain]).toMatchObject({result: "green"});
		expect(ran.facts[checkedAgain]?.head).not.toBe(firstChecked?.head);

		expect(ran.lines.at(-1)).toContain("ended: done");
		expect(onMain(ran.remote, "docs/elsewhere.md")).toContain("Written elsewhere.");
		expect(onMain(ran.remote, "src/lower.ts")).toContain("toLowerCase");

		// Every `done` keeps its input key (P7).
		const done = ran.facts.filter(
			(f) => f.type === "ended" && JSON.stringify(f.outcome).includes('"kind":"done"'),
		);
		expect(done.length).toBeGreaterThan(0);

		for (const end of done) {
			expect(String(end.key), String(end.stage)).toMatch(/^sha256:[0-9a-f]{64}$/);
		}
	});

	it("a lane saved before this change, with no `Held`: the fold gives the carry from its facts, and it goes on at mutation with no done step again", async () => {
		const ran = await lane({
			within: 50,
			picks: YES,
			failMutation: true,
			again: [{between: ({home}) => keptAsLegacy(home)}],
		});
		const said = ran.lines.join("\n");
		expect(ran.lines, said).not.toContain(TIMED_OUT);
		expect(secondLine(ran)).toMatch(/restart: #1 from mutation\b/);
		expect(ran.facts.filter((f) => f.type === "restarted")).toMatchObject([
			{type: "restarted", from: "mutation"},
		]);
		expect(codexRuns(ran.dir).map((r) => r.step)).toEqual([
			"triage",
			"plan",
			"tests",
			"build",
			"mutants",
			"review",
		]);
		expect(askedFor(ran, "approve")).toHaveLength(1);
		expect(ran.lines.at(-1)).toContain("ended: done");
	});

	it("main changes an exam file while the lane is stuck: the restart asks exam_conflict with the file, and `again` reruns the test writer, then build", async () => {
		const ON_MAIN =
			'import {expect, it} from "vitest";\n\nit("lowers on main", () => {\n\texpect("AB".toLowerCase()).toBe("ab");\n});\n';
		const ran = await lane({
			within: 50,
			picks: {...YES, exam_conflict: "again"},
			failMutation: true,
			again: [
				{
					between: (where) =>
						Effect.sync(() => pushToMain(where, [{path: "src/lower.test.ts", text: ON_MAIN}])),
				},
			],
		});
		const said = ran.lines.join("\n");
		expect(ran.lines, said).not.toContain(TIMED_OUT);

		// Asked once, with the file, and the picks its definition gives.
		const asked = askedFor(ran, "exam_conflict");
		expect(asked, said).toHaveLength(1);
		expect(asked[0]?.picks).toEqual(PICKS.exam_conflict);
		const told = [
			String(asked[0]?.what),
			...ran.facts.filter((f) => f.type === "commented").map((f) => String(f.body)),
		];
		expect(told.filter((text) => text.includes("src/lower.test.ts"))).not.toEqual([]);

		// After the restart: the test writer, told the file, then build. No triage, plan or yes again.
		const restarted = ran.facts.findIndex((f) => f.type === "restarted");
		expect(restarted).toBeGreaterThan(-1);
		const after = ran.facts
			.slice(restarted)
			.filter((f) => f.type === "started")
			.map((f) => String(f.stage));
		expect(after.slice(0, 2)).toEqual(["test_writer", "build"]);
		const runs = codexRuns(ran.dir);
		expect(runs.filter((r) => r.step === "triage" || r.step === "plan").map((r) => r.step)).toEqual(
			["triage", "plan"],
		);
		const writers = runs.filter((r) => r.step === "tests");
		expect(writers).toHaveLength(2);
		expect(writers[1]?.prompt).toContain("src/lower.test.ts");
		expect(runs.filter((r) => r.step === "build")).toHaveLength(2);
		expect(askedFor(ran, "approve")).toHaveLength(1);
	});

	it("a `stop` on rounds_spent, then the same line: build runs once more, as the next round, and the lane lands", async () => {
		/** A build's own test: red for any `n` but 1, a little different each round. */
		const planted = (n: number) => [
			{
				path: "src/red.test.ts",
				text: `import {describe, expect, it} from "vitest";\n\ndescribe("a planted red", () => {\n\tit("stays red", () => {\n\t\texpect(1).toBe(${n});\n\t});\n});\n`,
			},
		];
		const ran = await lane({
			within: 50,
			picks: {...YES, rounds_spent: "stop"},
			fold: true,
			fake: {writesAt: {build: {0: planted(2), 1: planted(3), 2: planted(4), 3: planted(1)}}},
			again: [{}],
		});
		const said = ran.lines.join("\n");
		expect(ran.lines, said).not.toContain(TIMED_OUT);
		expect(heldAt(ran, 0)?.at, said).toEqual({_tag: "run", step: "build"});
		foldsAsSaved(ran, 0);
		expect(askedFor(ran, "rounds_spent")).toHaveLength(1);
		const runs = codexRuns(ran.dir).map((r) => r.step);
		expect(runs.filter((step) => step === "build")).toHaveLength(4);
		expect(runs.filter((step) => step !== "build").slice(0, 3)).toEqual([
			"triage",
			"plan",
			"tests",
		]);
		expect(runs.filter((step) => step === "tests")).toHaveLength(1);
		expect(ran.lines.at(-1)).toContain("ended: done");
	});

	it("a `no` on the plan's yes, then the same line: the plan runs again with the person's note, and triage does not", async () => {
		const NOTE = "Keep it to ASCII.";
		const ran = await lane({
			within: 50,
			picks: YES,
			queues: {approve: ["no", "approve"]},
			notes: {approve: NOTE},
			fold: true,
			again: [{}],
		});
		const said = ran.lines.join("\n");
		expect(ran.lines, said).not.toContain(TIMED_OUT);
		expect(heldAt(ran, 0)?.at, said).toEqual({_tag: "run", step: "plan"});
		foldsAsSaved(ran, 0);
		const runs = codexRuns(ran.dir);
		expect(runs.filter((r) => r.step === "triage")).toHaveLength(1);
		const plans = runs.filter((r) => r.step === "plan");
		expect(plans).toHaveLength(2);
		expect(plans[1]?.prompt).toContain(NOTE);
		expect(ran.lines.at(-1)).toContain("ended: done");
	});

	it("a ticket closed while the lane is paused: the same line ends skip:closed and runs no step", async () => {
		const ran = await lane({
			within: 50,
			picks: YES,
			queues: {approve: ["no"]},
			again: [{between: () => closeTicket}],
		});
		const said = ran.lines.join("\n");
		expect(ran.lines, said).not.toContain(TIMED_OUT);
		// The `no` paused the lane: it kept its `Held`.
		expect(heldAt(ran, 0), said).not.toBeNull();
		const closed = ran.facts.findIndex((f) => f.type === "closed");
		expect(ran.facts.slice(closed).filter((f) => f.type === "started")).toEqual([]);
		expect(codexRuns(ran.dir).map((r) => r.step)).toEqual(["triage", "plan"]);
		expect(askedFor(ran, "approve")).toHaveLength(1);
		expect(ran.lines.at(-1)).toContain("skip:closed");
	});

	// Round 2 of the tests for self-fix PR 5: what the plan says of the fresh read and of the exam's
	// two questions, which the first round left unpinned.

	/** The test writer's test, as the plain fake writes it. */
	const WRITTEN = 'expect(lower("AB"))';

	it("after a rebase onto a moved main, code runs the test writer's check again, on the test writer's commit put on main", async () => {
		const ran = await lane({
			within: 50,
			picks: YES,
			failMutation: true,
			again: [{between: moveMain}],
		});
		const said = ran.lines.join("\n");
		expect(ran.lines, said).not.toContain(TIMED_OUT);
		const writers = (line: number) =>
			ran.onBase.filter((c) => c.line === line && c.files.includes("src/lower.test.ts"));
		expect(writers(0), said).toHaveLength(1);
		const [again] = writers(1);
		expect(again, said).toBeDefined();
		const commit = again?.commit ?? "";
		expect(again?.files).toEqual(writers(0)[0]?.files);
		expect(commit).not.toBe(writers(0)[0]?.commit);
		// Main's new commit is under it, and the builder's work is not: the test writer's own commit, on main.
		expect(holds(ran, commit, "docs/elsewhere.md")).toBe(true);
		expect(holds(ran, commit, "src/lower.test.ts")).toBe(true);
		expect(holds(ran, commit, "src/lower.ts")).toBe(false);
		expect(ran.lines.at(-1)).toContain("ended: done");
		// Round 4, record wide: the restart keeps the lane's head before and after, and where main won.
		const moved = restartOf(ran);
		expect(moved, said).toMatchObject({head: headBefore(ran), conflicts: []});
		expect(moved?.to).toMatch(/^[0-9a-f]{40}$/);
		expect(moved?.to).not.toBe(moved?.head);
	});

	it("exam_touched, `builder_wrong`: the touched file goes back to the test writer's, on top of the builder's head, and build runs there as the next round", async () => {
		const ran = await lane({
			within: 50,
			// Answered once: a second exam_touched fails the test at once, out loud.
			picks: YES,
			queues: {exam_touched: ["builder_wrong"]},
			fake: {writesAt: {build: {0: [{path: "src/lower.test.ts", text: TOUCHED}]}}, see: SEE},
		});
		const said = ran.lines.join("\n");
		expect(ran.lines, said).not.toContain(TIMED_OUT);
		expect(askedFor(ran, "exam_touched"), said).toHaveLength(1);
		const runs = codexRuns(ran.dir);
		const builds = runs.filter((r) => r.step === "build");
		expect(builds, said).toHaveLength(2);
		// The builder's own work stands, and the test it touched is the test writer's again.
		expect(builds[1]?.seen["src/lower.ts"]).toContain("toLowerCase");
		expect(builds[1]?.seen["src/lower.test.ts"]).toContain(WRITTEN);
		expect(runs.filter((r) => r.step === "tests")).toHaveLength(1);
		expect(roundsOf(ran, "build")).toEqual([1, 2]);
		expect(ran.lines.at(-1)).toContain("ended: done");
		expect(onMain(ran.remote, "src/lower.test.ts")).toContain(WRITTEN);
		// Each build keeps the key of what it read (P7). The second read another head, so its key is another.
		const keys = ran.facts
			.filter((f) => f.type === "ended" && f.stage === "build")
			.map((f) => String(f.key));
		expect(keys, said).toHaveLength(2);
		expect(keys[1]).not.toBe(keys[0]);
	});

	it("exam_touched, `test_wrong`: the test writer redoes the touched file alone, told the note, its check runs, and build goes on from the builder's head as the next round", async () => {
		const NOTE = "Keep the capitals test, and add one with mixed case.";
		const ran = await lane({
			within: 50,
			// Answered once: a second exam_touched fails the test at once, out loud.
			picks: YES,
			queues: {exam_touched: ["test_wrong"]},
			notes: {exam_touched: NOTE},
			fake: {
				writesAt: {build: {0: [{path: "src/lower.test.ts", text: TOUCHED}]}},
				answers: REDO,
				see: SEE,
			},
		});
		const said = ran.lines.join("\n");
		expect(ran.lines, said).not.toContain(TIMED_OUT);
		expect(askedFor(ran, "exam_touched"), said).toHaveLength(1);
		const runs = codexRuns(ran.dir);
		const writers = runs.filter((r) => r.step === "tests");
		expect(writers, said).toHaveLength(2);
		expect(writers[1]?.prompt).toContain(NOTE);
		expect(writers[1]?.prompt).toContain("src/lower.test.ts");
		// Its check ran on the redo, and the redo's commit changes the touched file and nothing else.
		const checks = ran.onBase.filter((c) => c.files.includes("src/lower.test.ts"));
		expect(checks, said).toHaveLength(2);
		expect(changedBy(ran, checks[1]?.commit ?? "")).toEqual(["src/lower.test.ts"]);
		expect(holds(ran, checks[1]?.commit ?? "", "src/lower.ts")).toBe(false);
		// The build goes on from the builder's head, with the redone test in it.
		const builds = runs.filter((r) => r.step === "build");
		expect(builds, said).toHaveLength(2);
		expect(builds[1]?.seen["src/lower.ts"]).toContain("toLowerCase");
		expect(builds[1]?.seen["src/lower.test.ts"]).toContain(REDONE_MARK);
		expect(roundsOf(ran, "build")).toEqual([1, 2]);
		expect(ran.lines.at(-1)).toContain("ended: done");
		expect(onMain(ran.remote, "src/lower.test.ts")).toContain(REDONE_MARK);
		// The redo's rows stand in for the old ones of the files it wrote again: no test is listed twice.
		const redone = ran.facts.filter((f) => f.type === "ended" && f.stage === "test_writer").at(-1);
		const {written} = Schema.decodeUnknownSync(
			Schema.Struct({written: Schema.Struct({tests: Schema.Array(Schema.Unknown)})}),
		)(redone?.carry);
		expect(written.tests).toEqual([
			{property: "p1", file: "src/lower.test.ts", name: "lowers capitals"},
		]);
	});

	// Record wide (AGENTS.md): a key alone never says which input changed, and an end written without
	// its inputs never gets them. Each `ended` keeps the inputs its key was made of, as `inputs`.
	it("each end keeps the inputs its key was made of: two builds on two test writer's commits show two `exam` inputs", async () => {
		const ran = await lane({
			within: 50,
			picks: YES,
			queues: {exam_touched: ["test_wrong"]},
			fake: {
				writesAt: {build: {0: [{path: "src/lower.test.ts", text: TOUCHED}]}},
				answers: REDO,
			},
		});
		const said = ran.lines.join("\n");
		expect(ran.lines, said).not.toContain(TIMED_OUT);
		// Every end that keeps a key: a step that broke before it read anything keeps neither.
		const ends = ran.facts.flatMap((f, at) =>
			f.type === "ended" && f.key !== undefined ? [{f, at}] : [],
		);

		for (const {f} of ends) {
			expect(f.inputs, `${String(f.stage)}'s end keeps no inputs`).toBeDefined();
			const inputs = Schema.decodeUnknownSync(Inputs)(f.inputs);
			expect(await Effect.runPromise(keyOf(inputs)), String(f.stage)).toBe(f.key);
			// Values and hashes only: no path from this machine.
			const paths = Object.values(inputs).filter((v) => typeof v === "string" && v.includes("/"));
			expect(paths, String(f.stage)).toEqual([]);
		}

		// A build's `exam` is the commit the test writer's last end left before it.
		const builds = ends.filter(({f}) => f.stage === "build");
		expect(builds, said).toHaveLength(2);
		const exams = builds.map(({f, at}) => {
			const writer = ends.filter((e) => e.at < at && e.f.stage === "test_writer").at(-1);
			const {head} = Schema.decodeUnknownSync(Schema.Struct({head: Schema.String}))(
				writer?.f.carry,
			);
			const {exam} = Schema.decodeUnknownSync(Inputs)(f.inputs);
			expect(exam).toBe(head);
			return exam;
		});
		expect(exams[1]).not.toBe(exams[0]);
		expect(builds[1]?.f.key).not.toBe(builds[0]?.f.key);
	});
});
