import {Deferred, Effect, Fiber, Layer, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {codeHostOn} from "../../code-host-github.ts";
import type {Spend} from "../../draft.ts";
import {ear} from "../../program/ear.ts";
import {defineProgram, pipe, start, tell} from "../../program/program.ts";
import {input, output} from "../../program/shape.ts";
import {memoryStorage} from "../../program/storage.ts";
import {CodeHost} from "../../services.ts";
import type {ShipFacts} from "../ship/facts.ts";
import {noWrites} from "../ship/launch.ts";
import type {Look} from "../ship/look.ts";
import {shipProgram} from "../ship/program.ts";
import type {Brief} from "./gate.ts";
import {checked, launch, planOf} from "./launch.ts";
import {createReview, type Review} from "./machine.ts";
import {
	askOf,
	createReviewProgram,
	type Filed,
	type Reviewed,
	ReviewTarget,
	reviewProgram,
} from "./program.ts";
import {HEADINGS} from "./render.ts";
import type {Drafted} from "./reviewer.ts";
import {
	type Answers,
	changed,
	HEADS,
	PR,
	RUBRICS,
	recorded,
	recordedGh,
	recordedHost,
	type Script,
	scriptedReviewer,
	type Which,
} from "./scripted.ts";
import type {Form} from "./sheet.ts";
import type {Note} from "./tools.ts";

// The review program, started from code the way a parent would start it: the
// pull request is read from recorded answers of a real one, through the real
// GitHub reader; the gate, the machine, the verdict and the printout are the
// real ones; only the agent is scripted, and it runs through the live
// reviewer's own stream, doors and all. No call leaves the process.

const FLAGS = {rubrics: RUBRICS, model: "opus", effort: "medium", budget: 2} as const;
/** No test here starts a run twice: each keeps its machines in memory, and says so. */
const kept = (id: string) => ({id, storage: memoryStorage()});
const SPEND: Spend = {costUsd: 0.5, tokens: 300_000, context: 60_000, turns: 9, minutes: 1.5};
const RAN = {spend: SPEND, tools: ["Read", "Grep", "Read"], refused: [], links: 0};

/** A form that passes every criterion of the brief it is handed. */
const passing = (brief: Brief): Form => ({
	rows: brief.criteria.map((criterion) => ({
		n: criterion.n,
		grade: "pass" as const,
		where: [{file: "packages/code-graph/src/api/cli.ts", first: 1, last: 2}],
		says: "It does.",
		limit: null,
	})),
	findings: [],
	skipped: [{what: "The test run", why: "No shell."}],
});
const failing = (brief: Brief): Form => ({
	...passing(brief),
	rows: passing(brief).rows.map((row) =>
		row.n === 4
			? {n: 4, grade: "fail" as const, where: [], says: "The reference page does not name it."}
			: row,
	),
	findings: [
		{
			kind: "review-doc",
			from: {source: "criterion", n: 4},
			fault: "The CLI reference does not name exit 3.",
			at: null,
			proof: "Grep finds no `3` in the exits table.",
			wants: "The page names exit 3.",
		},
	],
});
/** Every criterion met, and one real problem no criterion names: a rubric's standing check. */
const standing = (brief: Brief): Form => ({
	...passing(brief),
	findings: [
		{
			kind: "review-code",
			from: {source: "check", name: "tests-prove-it"},
			fault: "No test fails without the change.",
			at: {file: "packages/code-graph/src/api/cli.test.ts", first: 10, last: 20},
			proof: "The new test passes at the base too.",
			wants: "A test that fails at the base.",
		},
	],
});
/**
 * A form TypeScript takes and its schema does not: a line that is not a
 * number. What an agent's answer can look like once it has crossed a
 * process, where no compiler stands.
 */
const offTheLines = (form: Form): Form => ({
	...form,
	findings: [
		{
			kind: "review-code",
			from: {source: "check", name: "x"},
			fault: "x",
			at: {file: "a.ts", first: Number.NaN, last: 1},
			proof: "x",
			wants: "x",
		},
	],
});
const drafts =
	(form: (brief: Brief) => Form) =>
	(brief: Brief): Drafted => ({answer: "form", form: form(brief), ...RAN});
const never = (): Drafted => {
	throw new Error("the reviewer was started");
};

const NOTE: Note = {
	title: "The README still names the removed --json flag",
	body: "Line 3 of the README shows `--json`, which this repo dropped before this change. It is not this change's doing.",
	at: {file: "README.md", first: 3, last: 3},
};

/**
 * The recorded pull request as if it were open with `which` as its head now:
 * what a live upstream hands on. The recordings were made after it merged.
 */
const opened = (which: Which) =>
	changed(recorded(`change-${which}.json`), (repo) => {
		repo.pullRequest.state = "OPEN";
		repo.pullRequest.headRefOid = HEADS[which];
	});

/** Everything one run of the review program said, and what its machine showed. */
interface Seen {
	readonly verdicts: readonly Reviewed[];
	readonly passed: readonly string[];
	readonly notes: readonly Filed[];
	readonly phases: readonly string[];
	readonly states: readonly Review[];
}

/** Start the program, tell it `urls`, close its input, and wait for its end, watching its machine all the way. */
const reviewAll = (
	urls: readonly string[],
	services: Layer.Layer<CodeHost | import("./reviewer.ts").Reviewer>,
	program = reviewProgram,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const verdicts = ear<Reviewed>();
			const passed = ear<string>();
			const notes = ear<Filed>();
			const started = yield* start(
				program,
				FLAGS,
				{verdict: verdicts.hear, passed: passed.hear, note: notes.hear},
				kept("review:test"),
			);
			if (started.kind !== "running") return yield* Effect.die(`did not start: ${started.why}`);
			const {run, close} = started;
			const watching = yield* run.machines.review.changes.pipe(
				Stream.filter((state) => state !== null),
				Stream.runCollect,
				Effect.forkChild,
			);
			for (const url of urls) tell(run, "pr", url);
			close("pr");
			const ended = yield* run.ended;
			if (ended.kind !== "ended") return yield* Effect.die(`it ended ${ended.kind}`);
			const states = [...(yield* Fiber.join(watching))] as Review[];
			return {
				verdicts: verdicts.values,
				passed: passed.values,
				notes: notes.values,
				phases: states.map((s) => s.phase).filter((p, i, all) => p !== all[i - 1]),
				states,
			} satisfies Seen;
		}).pipe(Effect.scoped, Effect.provide(services)),
	);

/** One review of the recorded pull request, at the commit named by `url`. */
function reviewOn(
	which: Which,
	answer: (brief: Brief) => Drafted,
	more: {
		readonly answers?: Answers;
		readonly url?: string;
		readonly script?: Script;
		readonly program?: typeof reviewProgram;
	} = {},
) {
	const {gh, calls} = recordedGh(which, more.answers ?? {});
	const reviewer = scriptedReviewer(answer, more.script);
	const seen = reviewAll(
		[more.url ?? `${PR}/commits/${HEADS[which]}`],
		Layer.mergeAll(recordedHost(gh), reviewer.layer),
		more.program,
	).then((all) => ({...all, verdict: all.verdicts[0] as Reviewed}));
	return {seen, calls, briefs: reviewer.briefs, heard: reviewer.heard};
}

// ---------------------------------------------------------------- the user's job

const url = (n: number) => `https://github.com/example/repo/pull/${n}`;

/** A pull request ship would land: nothing in its way. */
const clear: ShipFacts = {
	head: HEADS.final,
	state: "open",
	ours: true,
	ticket: "closes_it",
	approval: "not_needed",
	reviews: "passed",
	reviewKinds: [],
	checks: "green",
	mergeable: "clean",
	comments: [],
};

/**
 * Four pull requests shaped like the recorded one, each its own world: its
 * text, ticket, files and diff are the real recorded ones, open.
 *   11  the head that merged; the reviewer passes it, and files a note on the way
 *   12  its first head: the required check is red, so no reviewer is started
 *   13  the head that merged; the reviewer fails criterion 4
 *   14  the head that merged; the reviewer passes it
 */
const FOUR = new Map<string, {which: Which; answer: (brief: Brief) => Drafted; notes?: Note[]}>([
	[url(11), {which: "final", answer: drafts(passing), notes: [NOTE, NOTE]}],
	[url(12), {which: "first", answer: never}],
	[url(13), {which: "final", answer: drafts(failing)}],
	[url(14), {which: "final", answer: drafts(passing)}],
]);

/** `CodeHost` over the four worlds. Ship's facts are a clear pull request for each; review's change is read from the recordings. */
function fourWorlds() {
	const of = (pr: string) => {
		const world = FOUR.get(pr);
		if (world === undefined) throw new Error(`no world for ${pr}`);
		return world;
	};
	const shipReads: string[] = [];
	const host = Layer.succeed(CodeHost, {
		prFacts: (pr) =>
			Effect.sync(() => {
				shipReads.push(pr);
				return clear;
			}),
		change: (pr, head) => {
			const {which} = of(pr);
			const {gh} = recordedGh(which, {now: HEADS[which], change: opened(which)});
			return codeHostOn(gh, {own: [], reviewers: []}).change(pr, head);
		},
		checksSettled: () => Stream.make(undefined),
		leftQueue: () => Stream.never,
	});
	const reviewer = scriptedReviewer((brief) => of(brief.pr).answer(brief), {
		notes: (brief) => of(brief.pr).notes ?? [],
	});
	// Ship runs in read mode: it is given no write side at all.
	return {services: Layer.mergeAll(host, reviewer.layer, noWrites), reviewer, shipReads};
}

/**
 * The upstream: a stand-in for whatever tells review what to review (a
 * builder that opened pull requests, a person). It passes each url on.
 */
const upstream = defineProgram({
	name: "upstream",
	description: "A stand-in for what feeds review: passes on each pull request it is told.",
	inputs: {pr: input(ReviewTarget, "A pull request that is ready for review.")},
	outputs: {pr: output(ReviewTarget, "The same pull request, for review.")},
	main: ({inputs, send}) => inputs.pr.pipe(Stream.runForEach((pr) => send("pr", pr))),
});

describe("upstream | review | ship: the user's job", () => {
	it("four real-shaped pull requests: only the two that met every criterion reach ship, in order; the note the reviewer filed is in the machine's state and in the verdict; the pipe ends on its own; three runs, one answer", async () => {
		const once = async () => {
			const world = fourWorlds();
			const seen = await Effect.runPromise(
				Effect.gen(function* () {
					const found = ear<Look>();
					const verdicts = ear<Reviewed>();
					const notes = ear<Filed>();
					const ship = yield* start(
						shipProgram,
						{mode: "read"},
						{found: found.hear},
						kept("ship:test"),
					);
					if (ship.kind !== "running") return yield* Effect.die("ship did not start");
					const review = yield* pipe(
						{
							program: reviewProgram,
							flags: FLAGS,
							listeners: {verdict: verdicts.hear, note: notes.hear},
							keeping: kept("review:test"),
						},
						"passed",
						ship,
						"pr",
					);
					if (review.kind !== "running") return yield* Effect.die("review did not start");
					const watching = yield* review.run.machines.review.changes.pipe(
						Stream.filter((state) => state !== null),
						Stream.runCollect,
						Effect.forkChild,
					);
					const up = yield* pipe({program: upstream, flags: {}}, "pr", review, "pr");
					if (up.kind !== "running") return yield* Effect.die("upstream did not start");

					const told = [11, 12, 13, 14].map((n) => tell(up.run, "pr", url(n)));
					up.close("pr");
					const ends = [yield* up.run.ended, yield* review.run.ended, yield* ship.run.ended];
					const states = [...(yield* Fiber.join(watching))] as Review[];
					return {
						told,
						ends,
						states,
						found: found.values,
						verdicts: verdicts.values,
						notes: notes.values,
					};
				}).pipe(Effect.scoped, Effect.provide(world.services)),
			);
			return {
				...seen,
				briefs: world.reviewer.briefs.map((b) => b.pr),
				heard: world.reviewer.heard,
				shipReads: world.shipReads,
			};
		};

		const runs = [await once(), await once(), await once()];
		for (const seen of runs) {
			expect(seen.told).toEqual(["queued", "queued", "queued", "queued"]);
			// Upstream's end closed review's input; review's end closed ship's. Nobody stopped anything.
			expect(seen.ends).toEqual([{kind: "ended"}, {kind: "ended"}, {kind: "ended"}]);

			// Review: one verdict per pull request, in order.
			expect(seen.verdicts.map((v) => [v.pr, v.name])).toEqual([
				[url(11), "done"],
				[url(12), "send:builder:checks_red"],
				[url(13), "send:builder:review_failed"],
				[url(14), "done"],
			]);
			// The red one never started the reviewer.
			expect(seen.briefs).toEqual([url(11), url(13), url(14)]);

			// Ship heard only the two that passed, in order, and read only those.
			expect(seen.found.map((f) => [f.pr, f.wouldSend?.type ?? null])).toEqual([
				[url(11), "ship_enqueue"],
				[url(14), "ship_enqueue"],
			]);
			expect(seen.shipReads).toEqual([url(11), url(14)]);

			// The note: filed twice by the agent, kept once, both calls heard "taken".
			expect(seen.heard).toEqual(["taken", "taken"]);
			const noted = seen.states.find(
				(s) => s.phase === "reviewing" && s.brief.pr === url(11) && s.notes.length > 0,
			);
			expect(noted).toMatchObject({phase: "reviewing", notes: [{note: NOTE}]});
			expect(seen.verdicts[0]?.notes).toEqual([
				{id: expect.stringMatching(/^note-[0-9a-f]{8}$/), ...NOTE, state: "kept"},
			]);
			expect(seen.notes).toEqual([{pr: url(11), id: seen.verdicts[0]?.notes[0]?.id, ...NOTE}]);
			for (const v of seen.verdicts.slice(1)) expect(v.notes).toEqual([]);

			// Each criterion is met or open, nothing else.
			expect(seen.verdicts[0]?.criteria.map((c) => c.state)).toEqual([
				"met",
				"met",
				"met",
				"met",
				"met",
			]);
			expect(seen.verdicts[2]?.criteria.filter((c) => c.state === "open").map((c) => c.n)).toEqual([
				4,
			]);
		}
		const plain = (seen: (typeof runs)[number]) =>
			JSON.stringify({...seen, states: seen.states.length});
		expect(plain(runs[1] as (typeof runs)[number])).toEqual(
			plain(runs[0] as (typeof runs)[number]),
		);
		expect(plain(runs[2] as (typeof runs)[number])).toEqual(
			plain(runs[0] as (typeof runs)[number]),
		);
	});

	it("an output of review's that is not a pull request's url does not fit ship's `pr`: the pipe starts nothing", async () => {
		const answer = await Effect.runPromise(
			Effect.gen(function* () {
				const ship = yield* start(shipProgram, {mode: "read"}, {}, kept("ship:test"));
				if (ship.kind !== "running") return yield* Effect.die("ship did not start");
				const misfit = yield* pipe(
					{program: reviewProgram, flags: FLAGS, keeping: kept("review:test")},
					"verdict",
					ship,
					"pr" as never,
				);
				ship.close("pr");
				return misfit.kind;
			}).pipe(Effect.scoped, Effect.provide(fourWorlds().services)),
		);
		expect(answer).toBe("does_not_fit");
	});
});

// ---------------------------------------------------------------- one mechanism at a time

describe("the review program, one pull request at a time", () => {
	it("stops at a red required check, and starts no agent: the machine never reviews", async () => {
		const {seen, briefs} = reviewOn("first", never);
		const {verdict, phases, passed} = await seen;
		expect(verdict.name).toBe("send:builder:checks_red");
		expect(verdict.ran).toBeNull();
		expect(verdict.runs).toBe(0);
		expect(briefs).toEqual([]);
		expect(phases).toEqual(["idle", "gathering", "over"]);
		expect(passed).toEqual([]);
	});

	it("reaching its limit in dollars is a declared outcome, with what it cost kept, not a crash", async () => {
		const {seen} = reviewOn("final", () => ({answer: "over_budget", ...RAN}));
		const {verdict, passed} = await seen;
		expect(verdict.name).toBe("stuck:over_budget");
		expect(verdict.ran).toEqual(RAN);
		expect(verdict.problems).toEqual(["the reviewer reached its limit of 2 dollars"]);
		expect(passed).toEqual([]);
	});

	it("a real problem no criterion covers becomes a criterion of its own, open, and the review does not pass", async () => {
		const {seen} = reviewOn("final", drafts(standing), {
			answers: {change: opened("final"), now: HEADS.final},
			url: PR,
		});
		const {verdict, passed} = await seen;
		expect(
			verdict.criteria.slice(0, 5).every((c) => c.state === "met" && c.from === "ticket"),
		).toBe(true);
		expect(verdict.criteria[5]).toMatchObject({
			n: 6,
			from: "review",
			state: "open",
			text: "A test that fails at the base.",
			says: "No test fails without the change.",
		});
		expect(verdict.name).toBe("send:builder:review_failed");
		expect(passed).toEqual([]);
	});

	it("the handle shows the machine's phase change, from idle to over, through reviewing", async () => {
		const {seen} = reviewOn("final", drafts(passing));
		expect((await seen).phases).toEqual(["idle", "gathering", "reviewing", "over"]);
	});

	it("a note is in the machine's state while the reviewer is still running, and goes out before the verdict", async () => {
		const release = Deferred.makeUnsafe<void>();
		const {gh} = recordedGh("final");
		const reviewer = scriptedReviewer(drafts(passing), {
			notes: () => [NOTE],
			hold: Deferred.await(release),
		});
		const seen = await Effect.runPromise(
			Effect.gen(function* () {
				const notes = ear<Filed>();
				const verdicts = ear<Reviewed>();
				const started = yield* start(
					reviewProgram,
					FLAGS,
					{note: notes.hear, verdict: verdicts.hear},
					kept("review:test"),
				);
				if (started.kind !== "running") return yield* Effect.die("did not start");
				const {run, close} = started;
				tell(run, "pr", `${PR}/commits/${HEADS.final}`);
				close("pr");
				yield* notes.upTo(1);
				const during = yield* run.machines.review.changes.pipe(
					// The note in the state, and the Act that filed it answered: all while the agent is still at work.
					Stream.filter(
						(s): s is Review =>
							s !== null && s.phase === "reviewing" && s.notes.some((n) => n.state === "kept"),
					),
					Stream.take(1),
					Stream.runCollect,
				);
				const verdictsBefore = verdicts.values.length;
				yield* Deferred.succeed(release, undefined);
				yield* run.ended;
				return {during: [...during][0], verdictsBefore, verdict: verdicts.values[0]};
			}).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(recordedHost(gh), reviewer.layer))),
		);
		expect(seen.during).toMatchObject({phase: "reviewing", notes: [{note: NOTE, state: "kept"}]});
		expect(seen.verdictsBefore).toBe(0);
		expect(seen.verdict?.notes).toHaveLength(1);
	});

	it("passes the head that merged, replayed: the report, a verdict per kind, a comment per kind, done, and nothing on `passed`", async () => {
		const {seen, briefs} = reviewOn("final", drafts(passing));
		const {verdict, passed} = await seen;
		expect(verdict.name).toBe("done");
		expect(verdict.outcome).toEqual({kind: "done", part: false, head: HEADS.final});
		expect(verdict).toMatchObject({pr: PR, head: HEADS.final, replay: true, runs: 1, ran: RAN});
		expect(verdict.verdicts).toEqual([
			{kind: "review-code", verdict: "pass"},
			{kind: "review-doc", verdict: "pass"},
		]);
		expect(verdict.comments.map((c) => c.kind)).toEqual(["review-code", "review-doc"]);
		expect(verdict.comments[0]?.text).toContain(`${HEADINGS.change}\n\nNothing.`);
		// A replay is a look back: ship would ship the head now, which is not what was reviewed.
		expect(passed).toEqual([]);
		expect(briefs).toHaveLength(1);
		expect(briefs[0]?.criteria).toHaveLength(5);
		expect(briefs[0]?.diff).toBe(recorded("compare-final.diff"));
	});

	it("sends it back when a criterion failed: that criterion is open, with its finding", async () => {
		const {verdict} = await reviewOn("final", drafts(failing)).seen;
		expect(verdict.name).toBe("send:builder:review_failed");
		expect(verdict.criteria[3]).toMatchObject({n: 4, state: "open", from: "ticket"});
		expect(verdict.criteria[3]?.findings).toHaveLength(1);
		expect(verdict.criteria.filter((c) => c.state === "met")).toHaveLength(4);
	});

	it("stops, and passes nothing, when a criterion could not be seen: it is open", async () => {
		const unseen = (brief: Brief): Form => ({
			...passing(brief),
			rows: passing(brief).rows.map((row) =>
				row.n === 1 ? {n: 1, grade: "unseen" as const, says: "The fixture run is elsewhere."} : row,
			),
		});
		const {verdict} = await reviewOn("final", drafts(unseen)).seen;
		expect(verdict.name).toBe("stuck:unseen");
		expect(verdict.criteria[0]).toMatchObject({
			state: "open",
			says: "The fixture run is elsewhere.",
		});
	});

	it("is done in part when the change owes a review this stage does not do", async () => {
		const files = JSON.stringify({
			files: [
				{filename: "packages/code-graph/src/api/cli.ts"},
				{filename: ".github/workflows/build.yaml"},
			],
		});
		const {verdict} = await reviewOn("final", drafts(passing), {answers: {files}}).seen;
		expect(verdict.name).toBe("done:part");
		expect(verdict.left).toEqual(["governance"]);
	});

	it.each<[string, (brief: Brief) => Drafted, string]>([
		[
			"the reviewer broke",
			() => ({answer: "broke", error: "the run ended with no result", ...RAN}),
			"the run ended with no result",
		],
		["it handed back no form", () => ({answer: "misfit", ...RAN}), "does not read as a form"],
		[
			"what it handed back does not fit the form's schema",
			(brief: Brief) => ({answer: "form", form: offTheLines(passing(brief)), ...RAN}),
			"does not read as a form",
		],
		[
			"its form left a criterion out",
			drafts((brief) => ({...passing(brief), rows: passing(brief).rows.slice(1)})),
			"criterion 1 has no row",
		],
	])("is stuck, with what the run cost kept, when %s", async (_name, answer, problem) => {
		const {verdict} = await reviewOn("final", answer).seen;
		expect(verdict.name).toBe("stuck:draft_failed");
		expect(verdict.problems.join("\n")).toContain(problem);
		expect(verdict.ran?.spend).toEqual(SPEND);
	});

	it.each<[string, Answers, string]>([
		["the pull request cannot be read at all", {change: "breaks"}, "stuck:read_failed"],
		["the ticket cannot be read", {ticket: "breaks"}, "stuck:ticket_unknown"],
		["the diff cannot be read", {diff: "breaks"}, "stuck:diff_unknown"],
		[
			"the text names no ticket",
			{
				change: changed(recorded("change-final.json"), (repo) => {
					repo.pullRequest.body = "A change.";
				}),
			},
			"send:builder:no_ticket",
		],
		[
			"a skill page changed and the folder has no skill rubric",
			{files: JSON.stringify({files: [{filename: "skills/x/SKILL.md"}]})},
			"stuck:rubric_unknown",
		],
	])("stops before the reviewer when %s", async (_name, answers, expected) => {
		const {seen, briefs} = reviewOn("final", never, {answers});
		expect((await seen).verdict.name).toBe(expected);
		expect(briefs).toEqual([]);
	});

	it("skips a merged pull request told without a commit", async () => {
		const {verdict} = await reviewOn("final", never, {url: PR}).seen;
		expect(verdict.name).toBe("skip:merged");
		expect(verdict.replay).toBe(false);
	});

	it("waits while a required check runs, reads again when it settles, and goes on", async () => {
		const running = changed(recorded("change-final.json"), (repo) => {
			for (const check of repo.commit.statusCheckRollup.contexts.nodes)
				Object.assign(check, {status: "IN_PROGRESS", conclusion: null});
		});
		const pending = codeHostOn(recordedGh("final", {change: running}).gh, {own: [], reviewers: []});
		const green = codeHostOn(recordedGh("final").gh, {own: [], reviewers: []});
		let reads = 0;
		const host = Layer.succeed(CodeHost, {
			...green,
			change: (pr, head) => (reads++ === 0 ? pending : green).change(pr, head),
			checksSettled: () => Stream.make(undefined),
		});
		const reviewer = scriptedReviewer(drafts(passing));
		const seen = await reviewAll(
			[`${PR}/commits/${HEADS.final}`],
			Layer.mergeAll(host, reviewer.layer),
		);
		expect(seen.phases).toEqual(["idle", "gathering", "waiting", "gathering", "reviewing", "over"]);
		expect(seen.verdicts[0]?.name).toBe("done");
	});

	it("is stuck when a required check runs past the machine's limit, with no agent started", async () => {
		const running = changed(recorded("change-final.json"), (repo) => {
			for (const check of repo.commit.statusCheckRollup.contexts.nodes)
				Object.assign(check, {status: "IN_PROGRESS", conclusion: null});
		});
		const {gh} = recordedGh("final", {change: running});
		const host = Layer.succeed(CodeHost, {
			...codeHostOn(gh, {own: [], reviewers: []}),
			checksSettled: () => Stream.never,
		});
		const reviewer = scriptedReviewer(never);
		const hasty = createReviewProgram(createReview({waits: {checksMs: 5}}));
		const seen = await reviewAll(
			[`${PR}/commits/${HEADS.final}`],
			Layer.mergeAll(host, reviewer.layer),
			hasty,
		);
		expect(seen.verdicts[0]?.name).toBe("stuck:checks_stuck");
		expect(reviewer.briefs).toEqual([]);
	});

	it("only ever reads: no call it makes writes to the code host", async () => {
		const {seen, calls} = reviewOn("final", drafts(passing), {script: {notes: () => [NOTE]}});
		await seen;
		expect(calls).toHaveLength(5);
		for (const call of calls) {
			expect(call[0]).toBe("api");
			expect(call.some((arg) => ["-X", "--method", "--input"].includes(arg))).toBe(false);
		}
	});

	it("a url names a pull request, or one whole commit of it to review again; nothing else is taken", () => {
		const fits = reviewProgram.inputs.pr.shape.check;
		expect(fits(PR)).toBe(true);
		expect(fits(`${PR}/commits/${HEADS.first}`)).toBe(true);
		expect(fits(`${PR}/commits/6f4907a`)).toBe(false);
		expect(fits(`${PR}/files`)).toBe(false);
		expect(fits("https://github.com/example/repo/issues/3")).toBe(false);
		expect(askOf(`${PR}/commits/${HEADS.first}`, "r")).toEqual({
			pr: PR,
			head: HEADS.first,
			rubrics: "r",
		});
		expect(askOf(PR, "r")).toEqual({pr: PR, head: null, rubrics: "r"});
	});
});

describe("the command line", () => {
	const BASE = [PR, "--rubrics", "rubrics", "--repo", "clone"];

	it("reads the urls, the two folders, and today's reviewer's settings when none is named", () => {
		expect(planOf(BASE)).toEqual({
			prs: [PR],
			rubrics: "rubrics",
			repo: "clone",
			model: "opus",
			effort: "medium",
			budget: 2,
		});
		const both = planOf([
			PR,
			`${PR}/commits/${HEADS.first}`,
			"--rubrics",
			"r",
			"--repo",
			"c",
			"--budget",
			"0.5",
			"--effort",
			"low",
		]);
		expect(both).toMatchObject({
			prs: [PR, `${PR}/commits/${HEADS.first}`],
			budget: 0.5,
			effort: "low",
		});
	});

	it.each([
		["no pull request", ["--rubrics", "rubrics", "--repo", "clone"]],
		["no rubric folder", [PR, "--repo", "clone"]],
		["no clone", [PR, "--rubrics", "rubrics"]],
		["a flag with nothing after it", [PR, "--rubrics", "--repo", "clone"]],
	])("refuses %s", (_name, argv) => {
		expect(planOf(argv)).toBeNull();
	});

	it.each([
		["a link that is not a pull request", ["https://github.com/example/repo/issues/3"], [], "pr"],
		["a commit not named whole", [`${PR}/commits/6f4907a`], [], "pr"],
		["an effort that is not one", [PR], ["--effort", "max"], "effort"],
		["a budget that is not a number", [PR], ["--budget", "two"], "budget"],
		["a budget of nothing", [PR], ["--budget", "0"], "budget"],
	])("answers bad_shape, before any service is made, for %s", async (_name, urls, more, name) => {
		const plan = planOf([...urls, "--rubrics", "r", "--repo", "c", ...more]);
		if (plan === null) throw new Error("not read");
		expect(checked(plan)).toMatchObject({kind: "bad_shape", name});
		const made: string[] = [];
		const answer = await Effect.runPromise(
			launch(
				plan,
				{
					reads: () => {
						made.push("reads");
						return recordedHost(recordedGh("final").gh);
					},
					reviewer: () => {
						made.push("reviewer");
						return scriptedReviewer(never).layer;
					},
				},
				{},
			),
		);
		expect(answer).toMatchObject({kind: "bad_shape", name});
		expect(made).toEqual([]);
	});

	it("launches: tells each url in order, closes the input, and ends when the last is answered", async () => {
		const plan = planOf([
			`${PR}/commits/${HEADS.first}`,
			`${PR}/commits/${HEADS.final}`,
			"--rubrics",
			RUBRICS,
			"--repo",
			"c",
		]);
		if (plan === null) throw new Error("not read");
		const names: string[] = [];
		const recordings = {first: recordedGh("first").gh, final: recordedGh("final").gh};
		const host = Layer.succeed(CodeHost, {
			...codeHostOn(recordings.final, {own: [], reviewers: []}),
			change: (pr, head) =>
				codeHostOn(head === HEADS.first ? recordings.first : recordings.final, {
					own: [],
					reviewers: [],
				}).change(pr, head),
		});
		const answer = await Effect.runPromise(
			launch(
				plan,
				{reads: () => host, reviewer: () => scriptedReviewer(drafts(passing)).layer},
				{
					verdict: (v) => names.push(v.name),
				},
			),
		);
		expect(answer).toEqual({kind: "ran"});
		expect(names).toEqual(["send:builder:checks_red", "done"]);
	});
});
