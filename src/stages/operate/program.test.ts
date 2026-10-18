import {Deferred, Effect, Layer, Stream} from "effect";
import {describe, expect, it} from "vitest";
import {codeHostOn} from "../../code-host-github.ts";
import {ear} from "../../program/ear.ts";
import {type RunOf, start, tell} from "../../program/program.ts";
import {memoryStorage, type Storage} from "../../program/storage.ts";
import {SANDBOX_URL} from "../../sandbox.ts";
import {CodeHost, CodeHostWrites} from "../../services.ts";
import {buildProgram} from "../build/program.ts";
import {built, builtBy, scriptedBuilder} from "../build/scripted.ts";
import {BuildHost, BuildWrites} from "../build/services.ts";
import {READY, type Ticket} from "../build/ticket.ts";
import type {Brief} from "../review/gate.ts";
import type {Drafted} from "../review/reviewer.ts";
import {
	changed,
	HEADS,
	RUBRICS,
	recorded,
	recordedGh,
	scriptedReviewer,
} from "../review/scripted.ts";
import type {Form} from "../review/sheet.ts";
import type {ShipFacts} from "../ship/facts.ts";
import {type Ended, operateProgram, type Step} from "./program.ts";
import {ReviewWrites, type Verdict} from "./writes.ts";

// The operate program, started from code the way tsh starts it: the loop, the
// build, review and ship machines and their handlers are the real ones. What
// stands in: the builder and the reviewer (scripted), and the world they
// write to (fakes that keep every write). The review reads a real recorded
// pull request through the real GitHub reader.

const TICKET = `${SANDBOX_URL}/issues/1`;
const PR = `${SANDBOX_URL}/pull/9`;
const FLAGS = {
	rubrics: RUBRICS,
	model: "opus",
	effort: "medium",
	budget: 1,
	rounds: 3,
	ship: "write",
} as const;

const ticket: Ticket = {
	url: TICKET,
	number: 1,
	state: "open",
	title: "stop() hangs when the store's save never ends",
	body: "- [ ] it ends",
	labels: [READY],
	criteria: [{n: 1, text: "it ends", checked: false, evidence: null}],
	prs: [],
};

/** A pull request ship would land. */
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

const passing = (brief: Brief): Form => ({
	rows: brief.criteria.map((criterion) => ({
		n: criterion.n,
		grade: "pass" as const,
		where: [{file: "packages/code-graph/src/api/cli.ts", first: 1, last: 2}],
		says: "It does.",
		limit: null,
	})),
	findings: [],
	skipped: [],
});
/** Criterion 4 fails, with one finding that says what would close it. */
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
const RAN = {
	spend: {costUsd: 0.25, tokens: 1000, context: 1000, turns: 2, minutes: 0.1},
	tools: [],
	refused: [],
	links: 0,
};
const drafts =
	(form: (brief: Brief) => Form) =>
	(brief: Brief): Drafted => ({answer: "form", form: form(brief), ...RAN});

/** The recorded pull request, open, with its merged head as its head now. */
const opened = changed(recorded("change-final.json"), (repo) => {
	repo.pullRequest.state = "OPEN";
	repo.pullRequest.headRefOid = HEADS.final;
});

/**
 * The world one start writes to, as fakes that keep each write in order.
 * `reviews`: what the reviewer answers, one per review, the last again after.
 * `hold`: a review that never ends, by its number from 1.
 */
function world(reviews: readonly ((brief: Brief) => Form)[], more: {readonly hold?: number} = {}) {
	const writes: string[] = [];
	const posted: Verdict[] = [];
	let pushes = 0;
	let reviewed = 0;
	const held = Deferred.makeUnsafe<void>();
	const host = Layer.succeed(CodeHost, {
		prFacts: () => Effect.succeed(clear),
		change: (pr, head) => {
			const {gh} = recordedGh("final", {now: HEADS.final, change: opened});
			return codeHostOn(gh, {own: [], reviewers: []}).change(pr, head);
		},
		checksSettled: () => Stream.make(undefined),
		leftQueue: () => Stream.make({reading: "landed" as const, commit: "c".repeat(40)}),
	});
	const shipWrites = Layer.succeed(CodeHostWrites, {
		enqueue: (pr, head) => {
			writes.push(`enqueue ${pr} ${head}`);
			return Effect.succeed("queued" as const);
		},
		rerunChecks: () => Effect.die("no checks are red here"),
	});
	const buildHost = Layer.succeed(BuildHost, {ticket: () => Effect.succeed(ticket)});
	const buildWrites = Layer.succeed(BuildWrites, {
		copy: (_, number) =>
			Effect.succeed({
				tree: `/work/trees/${number}`,
				branch: `build/${number}`,
				base: "b".repeat(40),
			}),
		push: () =>
			Effect.sync(() => {
				pushes += 1;
				writes.push(`push ${pushes}`);
				return {head: String(pushes).repeat(40), changed: true};
			}),
		open: () =>
			Effect.sync(() => {
				writes.push(`open ${PR}`);
				return PR;
			}),
	});
	const reviewWrites = Layer.succeed(ReviewWrites, {
		post: (v) =>
			Effect.sync(() => {
				posted.push(v);
				writes.push(`post ${v.kind} ${v.verdict}`);
			}),
	});
	const builder = scriptedBuilder((brief) => built(builtBy(`round ${brief.round}`)));
	const reviewer = scriptedReviewer(
		(brief) => {
			const form = reviews[Math.min(reviewed, reviews.length) - 1] ?? passing;
			return drafts(form)(brief);
		},
		{
			hold: Effect.suspend(() => {
				reviewed += 1;
				return reviewed === more.hold
					? Deferred.succeed(held, undefined).pipe(Effect.andThen(Effect.never))
					: Effect.void;
			}),
		},
	);
	const services = Layer.mergeAll(
		host,
		shipWrites,
		buildHost,
		buildWrites,
		reviewWrites,
		builder.layer,
		reviewer.layer,
	);
	return {services, writes, posted, briefs: builder.briefs, held: Deferred.await(held)};
}

type OperateRun = RunOf<typeof operateProgram>;
type Heard = {
	readonly steps: ReturnType<typeof ear<Step>>;
	readonly ended: ReturnType<typeof ear<Ended>>;
};

/** One start of the run on `storage` under one id: `body` runs, then the scope closes, as a crash would close it. */
const once = <A>(
	w: ReturnType<typeof world>,
	storage: Storage,
	body: (run: OperateRun, heard: Heard, close: (name: "ticket") => void) => Effect.Effect<A>,
	flags:
		| typeof FLAGS
		| {readonly [K in keyof typeof FLAGS]: (typeof FLAGS)[K] | number | string} = FLAGS,
) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const steps = ear<Step>();
			const ended = ear<Ended>();
			const started = yield* start(
				operateProgram,
				flags as typeof FLAGS,
				{step: steps.hear, ended: ended.hear},
				{id: "operate:test", storage},
			);
			if (started.kind !== "running") return yield* Effect.die(`did not start: ${started.why}`);
			return yield* body(started.run, {steps, ended}, started.close);
		}).pipe(Effect.scoped, Effect.provide(w.services), Effect.timeout("5 seconds")),
	);

/** Tell it the ticket, close its input, and hear how the loop ended. */
const toTheEnd = (run: OperateRun, heard: Heard, close: (name: "ticket") => void) =>
	Effect.gen(function* () {
		expect(tell(run, "ticket", TICKET)).toBe("queued");
		close("ticket");
		const [end] = yield* heard.ended.upTo(1);
		return end as Ended;
	});

describe("operate: the user's job", () => {
	it("one ticket: round 1 leaves a criterion open, round 2 is told it and closes it, the verdicts are posted, and ship lands it; three runs, one answer", async () => {
		const run = async () => {
			const w = world([failing, passing]);
			const end = await once(w, memoryStorage(), toTheEnd);
			return {end, w};
		};
		const {end, w} = await run();
		expect(end.name).toBe("done");
		expect(end.outcome).toMatchObject({kind: "done", pr: PR, head: "c".repeat(40), rounds: 2});
		expect(end.rounds.map((r) => [r.n, r.built, r.reviewed, r.open])).toEqual([
			[1, "done", "send:builder:review_failed", 1],
			[2, "done", "done", 0],
		]);
		// Round 2's builder was told what round 1's review left open, in its words.
		expect(w.briefs.map((b) => b.round)).toEqual([1, 2]);
		expect(w.briefs[0]?.open).toEqual([]);
		expect(w.briefs[1]?.open).toMatchObject([{n: 4, wants: ["The page names exit 3."]}]);
		// One pull request, brought up to date each round; a FAIL then a PASS posted; one enqueue.
		expect(w.writes.filter((x) => x.startsWith("open"))).toEqual([`open ${PR}`, `open ${PR}`]);
		expect(w.posted.map((p) => p.verdict)).toContain("fail");
		expect(w.posted.at(-1)?.verdict).toBe("pass");
		expect(w.writes.filter((x) => x.startsWith("enqueue"))).toEqual([
			`enqueue ${PR} ${HEADS.final}`,
		]);
		const again = [await run(), await run()].map((r) => r.end);
		expect(again).toEqual([end, end]);
	});

	it("the stop rule: a round that leaves the open list no smaller stops the loop, says so, and ships nothing", async () => {
		const w = world([failing]);
		const end = await once(w, memoryStorage(), toTheEnd);
		expect(end.outcome).toEqual({kind: "ask", who: "owner", for: "no_progress"});
		expect(end.said).toBe("send:builder:review_failed");
		expect(end.rounds.map((r) => r.open)).toEqual([1, 1]);
		expect(w.writes.filter((x) => x.startsWith("enqueue"))).toEqual([]);
	});

	it("the cap: with one round allowed, a review that leaves something open ends the loop at the cap", async () => {
		const w = world([failing]);
		const end = await once(w, memoryStorage(), toTheEnd, {...FLAGS, rounds: 1});
		expect(end.outcome).toEqual({kind: "ask", who: "owner", for: "rounds"});
		expect(end.rounds).toHaveLength(1);
		expect(w.briefs).toHaveLength(1);
	});

	it("each stage of each round is said on step, in order", async () => {
		const w = world([failing, passing]);
		const steps = await once(w, memoryStorage(), (run, heard, close) =>
			toTheEnd(run, heard, close).pipe(Effect.as(heard.steps.values)),
		);
		expect(steps.map((s) => `${s.round} ${s.stage} ${s.name}`)).toEqual([
			"1 build done",
			"1 review send:builder:review_failed",
			"2 build done",
			"2 review done",
			"2 ship done",
		]);
		// Each step says why in the stage's words: the open criterion after a failed review, nothing once all pass.
		const said = (round: number, stage: string) =>
			steps.find((s) => s.round === round && s.stage === stage)?.says;
		expect(said(1, "review")).toEqual([expect.stringMatching(/^4\. .+: .+/)]);
		expect(said(2, "review")).toEqual([]);
		expect(said(2, "ship")).toEqual([]);
		expect(said(1, "build")?.length).toBeGreaterThan(0);
	});
});

describe("operate: only the sandbox", () => {
	it("a demlik ticket is refused when it is decoded: bad_shape, and nothing is read or written", async () => {
		const w = world([passing]);
		const words = await once(w, memoryStorage(), (run) =>
			Effect.succeed([
				tell(run, "ticket", "https://github.com/kamp-us/demlik/issues/670"),
				tell(run, "ticket", "https://github.com/kamp-us/demlik/pull/691"),
				tell(run, "ticket", `${SANDBOX_URL}-x/issues/1`),
				tell(run, "ticket", `${SANDBOX_URL}/issues/1?https://github.com/kamp-us/demlik/issues/1`),
			]),
		);
		expect(words).toEqual(["bad_shape", "bad_shape", "bad_shape", "bad_shape"]);
		expect(w.writes).toEqual([]);
		expect(w.briefs).toEqual([]);
	});

	it("the input's shape names why, for operate and for build", () => {
		const demlik = "https://github.com/kamp-us/demlik/issues/670";
		for (const shape of [operateProgram.inputs.ticket.shape, buildProgram.inputs.ticket.shape]) {
			expect(shape.problem(demlik)).toContain("not a ticket in the sandbox");
			expect(shape.check(TICKET)).toBe(true);
		}
	});
});

describe("operate: kept across a restart", () => {
	it("stopped mid round 2's review, the next start goes on from round 2: no build runs again, no second pull request, one enqueue", async () => {
		const storage = memoryStorage();
		const before = world([failing, passing], {hold: 2});
		await once(before, storage, (run, _, close) =>
			Effect.gen(function* () {
				tell(run, "ticket", TICKET);
				close("ticket");
				// Round 2's reviewer has started, and does not answer.
				yield* before.held;
			}),
		);
		expect(before.writes.filter((x) => x.startsWith("open"))).toHaveLength(2);

		// The next start is told nothing: it finds the loop where it stood.
		const after = world([passing]);
		const end = await once(after, storage, (_, heard) =>
			heard.ended.upTo(1).pipe(Effect.map(([e]) => e as Ended)),
		);
		expect(end.name).toBe("done");
		expect(end.rounds.map((r) => r.n)).toEqual([1, 2]);
		expect(after.briefs).toEqual([]);
		expect(after.writes.filter((x) => x.startsWith("open") || x.startsWith("push"))).toEqual([]);
		expect(after.writes.filter((x) => x.startsWith("enqueue"))).toHaveLength(1);
	});
});
