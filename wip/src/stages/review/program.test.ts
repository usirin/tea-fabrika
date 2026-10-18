import {
	defineProgram,
	pipe,
	type RunningOf,
	type RunOf,
	start,
	tell,
} from "@tea-fabrika/tea-program";
import {ear} from "@tea-fabrika/tea-program/ear";
import {type BeforeWrite, type Life, mortalDisk} from "@tea-fabrika/tea-program/mortal";
import {input, output} from "@tea-fabrika/tea-program/shape";
import {memoryStorage, type Storage} from "@tea-fabrika/tea-program/storage";
import {Deferred, Effect, Fiber, Layer, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {codeHostOn} from "../../code-host-github.ts";
import type {Spend} from "../../draft.ts";
import {CodeHost, CodeHostWrites} from "../../services.ts";
import type {ShipFacts} from "../ship/facts.ts";
import {noWrites} from "../ship/launch.ts";
import type {Look} from "../ship/look.ts";
import {keyOf, type Passed, shipProgram} from "../ship/program.ts";
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
	readonly passed: readonly Passed[];
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
			const passed = ear<Passed>();
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
			expect(seen.ends).toEqual([
				{kind: "ended", unread: {}},
				{kind: "ended", unread: {}},
				{kind: "ended", unread: {}},
			]);

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

describe("killed (kill -9) while the reviewer works, and started again", () => {
	/** One life of the process on `life`'s storage, under one id, with its own `gh` and reviewer; `body` run, then the scope closes. */
	const lifeOn = <A>(
		life: Life,
		reviewer: ReturnType<typeof scriptedReviewer>,
		body: (
			started: {readonly run: RunOf<typeof reviewProgram>; readonly close: (name: "pr") => void},
			heard: {
				readonly notes: ReturnType<typeof ear<Filed>>;
				readonly verdicts: ReturnType<typeof ear<Reviewed>>;
			},
		) => Effect.Effect<A>,
	) => {
		const {gh, calls} = recordedGh("final");
		const seen = Effect.runPromise(
			Effect.gen(function* () {
				const notes = ear<Filed>();
				const verdicts = ear<Reviewed>();
				const started = yield* start(
					reviewProgram,
					FLAGS,
					{note: notes.hear, verdict: verdicts.hear},
					{id: "review:mortal", storage: life.storage},
				);
				if (started.kind !== "running") return yield* Effect.die("did not start");
				return yield* body(started, {notes, verdicts});
			}).pipe(
				Effect.scoped,
				Effect.provide(Layer.mergeAll(recordedHost(gh), reviewer.layer)),
				Effect.timeout("2 seconds"),
			),
		);
		return {seen, calls};
	};

	it("goes on from reviewing: nothing is read again, the reviewer starts once, the note it already filed is not sent again, and one verdict goes out", async () => {
		const disk = mortalDisk();
		const first = disk.life();
		// The reviewer files its note, then works on until the kill.
		const before = scriptedReviewer(drafts(passing), {notes: () => [NOTE], hold: Effect.never});
		const one = lifeOn(first, before, ({run}, {notes}) =>
			Effect.gen(function* () {
				tell(run, "pr", `${PR}/commits/${HEADS.final}`);
				yield* notes.upTo(1);
				yield* run.machines.review.changes.pipe(
					Stream.filter((s) => s?.phase === "reviewing" && s.notes.some((n) => n.state === "kept")),
					Stream.take(1),
					Stream.runDrain,
				);
				first.kill();
			}),
		);
		await one.seen;
		expect(before.briefs).toHaveLength(1);

		// The next start is told nothing. Its reviewer, run again from the start, files the same note.
		const after = scriptedReviewer(drafts(passing), {notes: () => [NOTE]});
		const two = lifeOn(disk.life(), after, ({run, close}, {notes, verdicts}) =>
			Effect.gen(function* () {
				close("pr");
				const ended = yield* run.ended;
				return {ended, notes: notes.values, verdicts: verdicts.values};
			}),
		);
		const seen = await two.seen;
		expect(seen.ended).toEqual({kind: "ended", unread: {}});
		expect(two.calls).toEqual([]);
		expect(after.briefs).toHaveLength(1);
		expect(seen.notes).toEqual([]);
		expect(seen.verdicts).toHaveLength(1);
		expect(seen.verdicts[0]).toMatchObject({pr: PR, name: "done", runs: 2});
		expect(seen.verdicts[0]?.notes).toHaveLength(1);
	});
});

// ---------------------------------------------------------------- review | ship, killed and started again

const THREE = [url(11), url(14), url(15)];

/**
 * What happened in the world, in order, across every life of one test:
 * `review <pr>` (a reviewer ran), `facts <pr>` (ship read GitHub),
 * `enqueue <pr>` (ship put it in the merge queue). Only a live process adds
 * to it.
 */
const worldLog = () => {
	const lines: string[] = [];
	const times = (line: string, from = 0) => lines.slice(from).filter((l) => l === line).length;
	return {lines, times};
};

interface World {
	/** Pull requests that stay in the merge queue. */
	readonly held?: ReadonlySet<string>;
	/** Done before the reviewer answers on a pull request: a test holds one review back with it. */
	readonly hold?: (pr: string) => Effect.Effect<void>;
	/** Done before review reads a pull request: a test holds every review back with it, before any reviewer starts. */
	readonly reading?: Effect.Effect<void>;
}

/**
 * The world one life sees: review reads the recorded change, and ship's
 * pull requests are clear and never merged, so GitHub never says "merged" and
 * only what ship kept can stop a second enqueue. Those in `held` stay in the
 * merge queue.
 */
const worldOf = (log: string[], alive: () => boolean, world: World) => {
	const note = (line: string) => {
		if (alive()) log.push(line);
	};
	const host = Layer.succeed(CodeHost, {
		prFacts: (pr) => Effect.sync(() => note(`facts ${pr}`)).pipe(Effect.as(clear)),
		change: (pr, head) => {
			const {gh} = recordedGh("final", {now: HEADS.final, change: opened("final")});
			return (world.reading ?? Effect.void).pipe(
				Effect.andThen(codeHostOn(gh, {own: [], reviewers: []}).change(pr, head)),
			);
		},
		checksSettled: () => Stream.make(undefined),
		leftQueue: (pr) =>
			world.held?.has(pr) === true
				? Stream.never
				: Stream.make({reading: "landed" as const, commit: `merged-${pr.slice(-2)}`}),
	});
	const writes = Layer.succeed(CodeHostWrites, {
		enqueue: (pr) => Effect.sync(() => note(`enqueue ${pr}`)).pipe(Effect.as("queued" as const)),
		rerunChecks: () => Effect.succeed([]),
	});
	// The reviewer works one pull request at a time: the one it noted last is the one it holds.
	let reviewing = "";
	const reviewer = scriptedReviewer(drafts(passing), {
		notes: (brief) => {
			reviewing = brief.pr;
			note(`review ${brief.pr}`);
			return [];
		},
		hold: Effect.suspend(() => world.hold?.(reviewing) ?? Effect.void),
	});
	return Layer.mergeAll(host, writes, reviewer.layer);
};

interface Pipe {
	readonly review: RunningOf<typeof reviewProgram>;
	readonly ship: RunningOf<typeof shipProgram>;
	readonly verdicts: ReturnType<typeof ear<Reviewed>>;
	/** kill -9: the disk takes no more writes, and the world hears no more from this life. */
	readonly kill: () => void;
}

interface LifeOptions extends World {
	/**
	 * Review and ship each on a storage value of their own over the one disk,
	 * so each has its own write lock, as two disks or two processes would. Left
	 * out: one storage value for both, as tsh gives a job.
	 */
	readonly apart?: boolean;
	/** Before each of review's writes reaches the disk (with `apart`, only review's). */
	readonly reviewWrites?: BeforeWrite;
	/** Before each of ship's writes reaches the disk. Needs `apart`. */
	readonly shipWrites?: BeforeWrite;
	/**
	 * Heard as review sends each verdict, before it goes on: a kill here falls
	 * after the review was kept over and before `passed` is sent.
	 */
	readonly onVerdict?: (verdict: Reviewed, kill: () => void) => void;
}

/** One life of the process: review piped into ship in write mode, each run under its own id on the shared disk. */
const lifeOn = (disk: ReturnType<typeof mortalDisk>, log: string[], options: LifeOptions = {}) => {
	const reviewLife = disk.life(options.reviewWrites);
	const shipLife = options.apart === true ? disk.life(options.shipWrites) : reviewLife;
	let dead = false;
	const kill = () => {
		reviewLife.kill();
		shipLife.kill();
		dead = true;
	};
	const shipped: string[] = [];
	const go = (body: (pipe: Pipe) => Effect.Effect<void>) =>
		Effect.runPromise(
			Effect.gen(function* () {
				const verdicts = ear<Reviewed>();
				const ship = yield* start(
					shipProgram,
					{mode: "write"},
					{
						outcome: (o) => {
							if (!dead) shipped.push(o.pr);
						},
					},
					{id: "ship:kill", storage: shipLife.storage},
				);
				if (ship.kind !== "running") return yield* Effect.die("ship did not start");
				const review = yield* pipe(
					{
						program: reviewProgram,
						flags: FLAGS,
						listeners: {
							verdict: (v) => {
								if (dead) return;
								verdicts.hear(v);
								options.onVerdict?.(v, kill);
							},
						},
						keeping: {id: "review:kill", storage: reviewLife.storage},
					},
					"passed",
					ship,
					"pr",
				);
				if (review.kind !== "running") return yield* Effect.die("review did not start");
				yield* body({review, ship, verdicts, kill});
			}).pipe(
				Effect.scoped,
				Effect.provide(worldOf(log, () => !dead, options)),
				Effect.timeout("5 seconds"),
			),
		).then(() => shipped);
	return {go, kill, review: reviewLife.storage, ship: shipLife.storage};
};

/** Until `ready` holds, a little at a time. */
const until = (ready: () => boolean) =>
	Effect.gen(function* () {
		while (!ready()) yield* Effect.sleep("5 millis");
	});

/** The ids of the machine runs of `machine` a run's index lists. */
const keptIds = (storage: Storage, run: string, machine: string) =>
	Effect.runPromise(storage.record(run)).then((record) =>
		(record?.machines ?? []).filter((m) => m.machine === machine).map((m) => m.id),
	);

describe("review | ship, killed (kill -9) twice and started again: the user's job", () => {
	it("three pull requests, killed once the first review had finished and again mid ship: each is reviewed once, queued once, and said shipped once; review keeps nothing, ship keeps each at the head it shipped", async () => {
		const disk = mortalDisk();
		const {lines: log, times} = worldLog();

		// Life 1: killed as the first verdict goes out, before `passed` is sent and before review's queue
		// hears its work ended. The kill is in the verdict's listener, so it falls at that exact point.
		const one = lifeOn(disk, log, {onVerdict: (_, kill) => kill()});
		const first = await one.go(({review, verdicts}) =>
			Effect.gen(function* () {
				for (const pr of THREE) tell(review.run, "pr", pr);
				yield* verdicts.upTo(1);
			}),
		);

		// Life 2, told nothing: the first is said again from what was kept, and shipped. Killed with the
		// second in the merge queue and the third reviewed, its verdict going out. The third's reviewer is
		// held until the second is in the merge queue, so the two happen in that order every time.
		const queued = Effect.runSync(Deferred.make<void>());
		const two = lifeOn(disk, log, {
			held: new Set([url(14)]),
			hold: (pr) => (pr === url(15) ? Deferred.await(queued) : Effect.void),
			onVerdict: (v, kill) => {
				if (v.pr === url(15)) kill();
			},
		});
		const second = await two.go(({ship, verdicts}) =>
			Effect.gen(function* () {
				yield* ship.run.machines.ship.changes.pipe(
					Stream.filter((s) => s?.phase === "queued" && s.pr === url(14)),
					Stream.take(1),
					Stream.runDrain,
				);
				yield* Deferred.succeed(queued, undefined);
				yield* until(() => verdicts.values.some((v) => v.pr === url(15)));
			}),
		);

		// Life 3: the input closed, and every run let end.
		const three = lifeOn(disk, log);
		const ends: unknown[] = [];
		const third = await three.go(({review, ship}) =>
			Effect.gen(function* () {
				review.close("pr");
				ends.push(yield* review.run.ended, yield* ship.run.ended);
			}),
		);

		expect(ends).toEqual([
			{kind: "ended", unread: {}},
			{kind: "ended", unread: {}},
		]);
		for (const pr of THREE)
			expect([times(`review ${pr}`), times(`enqueue ${pr}`)], pr).toEqual([1, 1]);
		expect({first, second, third}).toEqual({
			first: [],
			second: [url(11)],
			third: [url(14), url(15)],
		});
		const left = await Effect.runPromise(
			Effect.all([three.review.record("review:kill"), three.ship.record("ship:kill")], {
				concurrency: 1,
			}),
		);
		// Ship keeps each run at a head until a `forget`, so a repeat of it is caught by its id (75c).
		expect(left.map((r) => r?.machines.map((m) => m.id))).toEqual([
			[],
			THREE.map((pr) => keyOf({pr, head: HEADS.final})),
		]);
	});
});

describe("review | ship: review says `passed` again after ship has finished that pull request (experiment 75c)", () => {
	// The bad moment 75b named and did not prove: ship has shipped a pull request and taken it off its
	// queue, and review's record that its work on it ended has not reached the disk. At the next start
	// review finds that work unfinished and says `passed` again. GitHub here never says "merged", so
	// nothing but what ship kept can stop a second enqueue. Before 75c ship dropped the run of a pull
	// request it was piped once it was over, and #14 went into the merge queue twice in both tests
	// below. Now `passed` carries the head, and ship keeps the run under the url of that commit.

	/** One gate a test opens: writes wait on it once armed. Opened, every waiting write goes on. */
	const gate = () => {
		let armed = false;
		const open = Effect.runSync(Deferred.make<void>());
		return {
			arm: () => {
				armed = true;
			},
			release: () => Deferred.doneUnsafe(open, Effect.void),
			before: (): Effect.Effect<void> => (armed ? Deferred.await(open) : Effect.void),
		};
	};

	/** Life 2: told nothing, its input closed, every run let end. What it said, and where the log stood when it began. */
	const startAgain = async (disk: ReturnType<typeof mortalDisk>, log: string[]) => {
		const from = log.length;
		const life = lifeOn(disk, log, {apart: true});
		const ends: unknown[] = [];
		const said = await life.go(({review, ship}) =>
			Effect.gen(function* () {
				review.close("pr");
				ends.push(yield* review.run.ended, yield* ship.run.ended);
			}),
		);
		return {from, said, ends, life};
	};

	it("review's save that its work on #14 ended is slow; ship ships #14 and takes it off its queue; killed there; started again: each of three pull requests is put in the merge queue once", async () => {
		const disk = mortalDisk();
		const {lines: log, times} = worldLog();
		// Review's queue saves wait once the verdict on #14 is out: the save that its work on #14 ended
		// is the first to wait, as on a slow disk. Its outbox, in its run's record, is not held, so
		// `passed` reaches ship (75d: a send returns once the outbox has kept it). Ship has a disk of
		// its own and goes on.
		const slow = gate();
		const one = lifeOn(disk, log, {
			apart: true,
			reviewWrites: (key) =>
				key?.includes("/machine/queue/") === true ? slow.before() : Effect.void,
			onVerdict: (v) => {
				if (v.pr === url(14)) slow.arm();
			},
		});
		const first = await one.go(({review, ship, kill}) =>
			Effect.gen(function* () {
				for (const pr of THREE) tell(review.run, "pr", pr);
				// Ship has finished #14 and taken it off its queue: the bad moment. Before the fix, ship had
				// dropped #14's run here too, so nothing it kept could tell a repeat of #14.
				yield* until(() => {
					const waiting = ship.run.machines.queue.state();
					return (
						log.includes(`enqueue ${url(14)}`) &&
						waiting !== null &&
						waiting.items.length === 0 &&
						waiting.clearing.length === 0
					);
				});
				kill();
				slow.release();
			}),
		);
		expect(first).toEqual([url(11), url(14)]);

		const {from, said, ends, life} = await startAgain(disk, log);
		expect(ends).toEqual([
			{kind: "ended", unread: {}},
			{kind: "ended", unread: {}},
		]);
		const counts = THREE.map((pr) => [pr, times(`review ${pr}`), times(`enqueue ${pr}`)]);
		expect(counts).toEqual(THREE.map((pr) => [pr, 1, 1]));
		// #14 came again at the same head, and was answered from what ship kept under that head:
		// GitHub was not read for it again, and it was said shipped again, as an ask told twice is.
		expect(times(`facts ${url(14)}`, from)).toBe(0);
		expect(said).toEqual([url(14), url(15)]);
		expect(await keptIds(life.ship, "ship:kill", "ship")).toEqual(
			THREE.map((pr) => keyOf({pr, head: HEADS.final})),
		);
	});

	it("#14 told to review again, at the same head, after ship has finished it: it is put in the merge queue once", async () => {
		const disk = mortalDisk();
		const {lines: log, times} = worldLog();
		// No kill and no timing: the same pull request, at the same head, told to review again once ship
		// has finished it, the way an upstream that sends twice would.
		const one = lifeOn(disk, log);
		const ends: unknown[] = [];
		let from = 0;
		await one.go(({review, ship}) =>
			Effect.gen(function* () {
				for (const pr of THREE) tell(review.run, "pr", pr);
				yield* until(() => {
					const waiting = ship.run.machines.queue.state();
					return (
						log.includes(`enqueue ${url(15)}`) &&
						waiting !== null &&
						waiting.items.length === 0 &&
						waiting.clearing.length === 0
					);
				});
				from = log.length;
				tell(review.run, "pr", url(14));
				review.close("pr");
				ends.push(yield* review.run.ended, yield* ship.run.ended);
			}),
		);
		expect(ends).toEqual([
			{kind: "ended", unread: {}},
			{kind: "ended", unread: {}},
		]);
		const counts = THREE.map((pr) => [pr, times(`review ${pr}`), times(`enqueue ${pr}`)]);
		// Review takes a pull request told after its work ended as new work, and runs its reviewer again.
		expect(counts).toEqual([
			[url(11), 1, 1],
			[url(14), 2, 1],
			[url(15), 1, 1],
		]);
		expect(times(`facts ${url(14)}`, from)).toBe(0);
	});
});

describe("review | ship: the other side of the same moment, a pull request lost (experiments 75c and 75d)", () => {
	// Review's record that its work on a pull request ended can reach the disk before ship has kept
	// that pull request on its own queue. Before 75d `send` only handed the value over in memory, so a
	// kill between the two lost it: review never said it again, and ship never had it (#14 reviewed
	// once, queued 0 times). 75b's kill test hit this window now and then under load. Now the value
	// waits in review's outbox until ship's queue has kept it: review's "ended" still lands first, and
	// the next start sends #14 again from the outbox, not from a second review.

	it("ship's save of #14 on its queue is slow, review's save that its work on #14 ended is not; killed there: #14 is reviewed once and shipped once, sent again from review's outbox", async () => {
		const disk = mortalDisk();
		const {lines: log, times} = worldLog();
		let armed = false;
		const open = Effect.runSync(Deferred.make<void>());
		const idle = Effect.runSync(Deferred.make<void>());
		const one = lifeOn(disk, log, {
			apart: true,
			shipWrites: () => (armed ? Deferred.await(open) : Effect.void),
			// #14 is reviewed only once ship has finished #11, so what waits is #14 and nothing else.
			hold: (pr) => (pr === url(14) ? Deferred.await(idle) : Effect.void),
			onVerdict: (v, kill) => {
				if (v.pr === url(14)) armed = true;
				// Review's save that #14 ended has landed, since it went on to #15: kill.
				if (v.pr === url(15)) {
					kill();
					Deferred.doneUnsafe(open, Effect.void);
				}
			},
		});
		await one.go(({review, ship, verdicts}) =>
			Effect.gen(function* () {
				for (const pr of THREE) tell(review.run, "pr", pr);
				yield* until(() => {
					const waiting = ship.run.machines.queue.state();
					return (
						log.includes(`enqueue ${url(11)}`) &&
						waiting !== null &&
						waiting.items.length === 0 &&
						waiting.clearing.length === 0
					);
				});
				yield* Deferred.succeed(idle, undefined);
				yield* verdicts.upTo(3);
			}),
		);

		const again = lifeOn(disk, log, {apart: true});
		const ends: unknown[] = [];
		await again.go(({review, ship}) =>
			Effect.gen(function* () {
				review.close("pr");
				ends.push(yield* review.run.ended, yield* ship.run.ended);
			}),
		);
		expect(ends).toEqual([
			{kind: "ended", unread: {}},
			{kind: "ended", unread: {}},
		]);
		const counts = THREE.map((pr) => [pr, times(`review ${pr}`), times(`enqueue ${pr}`)]);
		// Reviewed once: review's "ended" for #14 had landed, so the second #14 came from the outbox.
		expect(counts).toEqual([
			[url(11), 1, 1],
			[url(14), 1, 1],
			[url(15), 1, 1],
		]);
	});
});

describe("review | ship, killed at every write in turn (experiment 75d): the user's job", () => {
	// Three pull requests sit on review's kept queue. The process is started, and killed (kill -9)
	// just before its k-th write reaches the disk, for every k from the first write to the last;
	// then started again and let end. GitHub never says "merged", so only what the two runs kept
	// stops a second enqueue, and nothing but review's outbox brings back a pass ship never kept.

	/** A write's key, said short: whose it is, and what. */
	const labelOf = (key: string | null) => {
		if (key === null) return "clear";
		const [, run, what, machine, id] = key.split("/").map(decodeURIComponent);
		const who = run?.split(":")[0] ?? "?";
		if (what === "record") return `${who} record`;
		const pr = /pull\/(\d+)/.exec(id ?? "")?.[1];
		return `${who} ${machine}${pr === undefined ? "" : ` #${pr}`}`;
	};

	/**
	 * One run of the sweep: life 0 puts the three on review's queue and stops cleanly; life 1 is
	 * killed before its `k`-th write (`null`: never); life 2 runs to the end. Answers each pull
	 * request's enqueues, and what life 1 wrote, in order.
	 */
	const sweep = async (k: number | null, apart: boolean) => {
		const disk = mortalDisk();
		const {lines: log, times} = worldLog();

		// Life 0: told the three, held before the first is read (so no reviewer has run: review gives
		// a pull request two reviewer runs, and a kill mid-run spends one), stopped once review's queue
		// holds all three.
		const zero = lifeOn(disk, [], {apart, reading: Effect.never});
		await zero.go(({review}) =>
			Effect.gen(function* () {
				for (const pr of THREE) tell(review.run, "pr", pr);
				review.close("pr");
				yield* until(() => review.run.machines.queue.state()?.items.length === THREE.length);
			}),
		);

		// Life 1: every write counted, on both sides; the k-th never lands.
		const writes: string[] = [];
		const killed = Effect.runSync(Deferred.make<void>());
		let life: ReturnType<typeof lifeOn> | undefined;
		// The pull request ship had just put in the merge queue when the kill came, before the write
		// that keeps that it did: the Act's own window, not the pipe's (see `act window` below).
		let window: string | null = null;
		/** By pull request: how long the world log was at its last write. */
		const wroteAt = new Map<string, number>();
		const count: BeforeWrite = (key) =>
			Effect.sync(() => {
				writes.push(labelOf(key));
				const pr = THREE.find((p) => key?.includes(encodeURIComponent(p)) === true);
				// Its first write since its enqueue, which was the last thing to happen in the world.
				const first =
					pr !== undefined && log.at(-1) === `enqueue ${pr}` && wroteAt.get(pr) !== log.length;
				if (pr !== undefined) wroteAt.set(pr, log.length);
				if (writes.length === k) {
					if (first) window = pr ?? null;
					life?.kill();
					Deferred.doneUnsafe(killed, Effect.void);
				}
			});
		life = lifeOn(disk, log, {apart, reviewWrites: count, shipWrites: count});
		await life.go(({review, ship}) =>
			Deferred.await(killed).pipe(
				Effect.raceFirst(
					Effect.all([review.run.ended, ship.run.ended], {discard: true, concurrency: "unbounded"}),
				),
			),
		);

		// Life 2: told nothing, let end.
		const ends: unknown[] = [];
		await lifeOn(disk, log, {apart}).go(({review, ship}) =>
			Effect.gen(function* () {
				review.close("pr");
				ends.push(yield* review.run.ended, yield* ship.run.ended);
			}),
		);
		return {
			ends,
			enqueued: THREE.map((pr) => times(`enqueue ${pr}`)),
			killedAt: k === null ? "none" : (writes[k - 1] ?? "after the last"),
			window: window as string | null,
			writes,
		};
	};

	// The act window: a kill after ship's `enqueue` reached GitHub and before ship kept that it did
	// sends the enqueue again at the next start. That is the Act's at-least-once, as 68a found it, and
	// GitHub absorbs it (the live enqueue reads first, and finds its own first write: in the queue, or
	// merged). The fake world here never says either, so it counts the repeat; this sweep says where.

	it.each([
		["one storage for both, as tsh gives a job", false],
		["a storage each, as two disks or two processes", true],
	])(
		"%s: each of three pull requests is put in the merge queue exactly once, whichever write the kill lands before",
		async (_name, apart) => {
			const whole = await sweep(null, apart);
			expect(whole.enqueued).toEqual([1, 1, 1]);
			const rows: string[] = [];
			const wrong: string[] = [];
			for (let k = 1; k <= whole.writes.length; k++) {
				const seen = await sweep(k, apart);
				const row = `${String(k).padStart(3)}  ${seen.killedAt.padEnd(22)}  ${seen.enqueued.join(" ")}${seen.window === null ? "" : "  act window"}`;
				rows.push(row);
				// Once each, never 0; twice only for the one whose enqueue the kill came right after.
				const owed = THREE.map((pr) => (pr === seen.window ? 2 : 1));
				if (seen.enqueued.join() !== owed.join() || seen.ends.length !== 2) wrong.push(row);
			}
			console.log(
				[
					`kill before write  (${apart ? "apart" : "one storage"})  enqueued #11 #14 #15`,
					...rows,
				].join("\n"),
			);
			expect(wrong).toEqual([]);
		},
		120_000,
	);
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
